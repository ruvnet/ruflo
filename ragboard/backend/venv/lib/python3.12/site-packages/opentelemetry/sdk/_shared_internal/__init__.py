# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

import collections
import enum
import logging
import os
import threading
import weakref
from abc import abstractmethod
from typing import (
    Generic,
    Optional,
    Protocol,
    TypeVar,
)

from opentelemetry.context import (
    _SUPPRESS_INSTRUMENTATION_KEY,
    attach,
    detach,
    set_value,
)
from opentelemetry.util._once import Once


class BatchExportStrategy(enum.Enum):
    EXPORT_ALL = 0
    EXPORT_WHILE_BATCH_EXCEEDS_THRESHOLD = 1
    EXPORT_AT_LEAST_ONE_BATCH = 2


Telemetry = TypeVar("Telemetry")


class Exporter(Protocol[Telemetry]):
    @abstractmethod
    def export(self, batch: list[Telemetry], /):
        raise NotImplementedError

    @abstractmethod
    def shutdown(self):
        raise NotImplementedError


class BatchProcessor(Generic[Telemetry]):
    """This class can be used with exporter's that implement the above
    Exporter interface to buffer and send telemetry in batch through
     the exporter."""

    def __init__(
        self,
        exporter: Exporter[Telemetry],
        schedule_delay_millis: float,
        max_export_batch_size: int,
        export_timeout_millis: float,
        max_queue_size: int,
        exporting: str,
    ):
        self._bsp_reset_once = Once()
        self._exporter = exporter
        self._max_queue_size = max_queue_size
        self._schedule_delay_millis = schedule_delay_millis
        self._schedule_delay = schedule_delay_millis / 1e3
        self._max_export_batch_size = max_export_batch_size
        # Not used. No way currently to pass timeout to export.
        # TODO(https://github.com/open-telemetry/opentelemetry-python/issues/4555): figure out what this should do.
        self._export_timeout_millis = export_timeout_millis
        # Deque is thread safe.
        self._queue = collections.deque([], max_queue_size)
        self._worker_thread = threading.Thread(
            name=f"OtelBatch{exporting}RecordProcessor",
            target=self.worker,
            daemon=True,
        )
        self._logger = logging.getLogger(__name__)
        self._exporting = exporting

        self._shutdown = False
        self._export_lock = threading.Lock()
        self._worker_awaken = threading.Event()
        self._worker_thread.start()
        if hasattr(os, "register_at_fork"):
            weak_reinit = weakref.WeakMethod(self._at_fork_reinit)
            os.register_at_fork(after_in_child=lambda: weak_reinit()())  # pyright: ignore[reportOptionalCall] pylint: disable=unnecessary-lambda
        self._pid = os.getpid()

    def _should_export_batch(
        self, batch_strategy: BatchExportStrategy, num_iterations: int
    ) -> bool:
        if not self._queue:
            return False
        # Always continue to export while queue length exceeds max batch size.
        if len(self._queue) >= self._max_export_batch_size:
            return True
        if batch_strategy is BatchExportStrategy.EXPORT_ALL:
            return True
        if batch_strategy is BatchExportStrategy.EXPORT_AT_LEAST_ONE_BATCH:
            return num_iterations == 0
        return False

    def _at_fork_reinit(self):
        self._export_lock = threading.Lock()
        self._worker_awaken = threading.Event()
        self._queue.clear()
        self._worker_thread = threading.Thread(
            name=f"OtelBatch{self._exporting}RecordProcessor",
            target=self.worker,
            daemon=True,
        )
        self._worker_thread.start()
        self._pid = os.getpid()

    def worker(self):
        while not self._shutdown:
            # Lots of strategies in the spec for setting next timeout.
            # https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/sdk.md#batching-processor.
            # Shutdown will interrupt this sleep. Emit will interrupt this sleep only if the queue is bigger then threshold.
            sleep_interrupted = self._worker_awaken.wait(self._schedule_delay)
            if self._shutdown:
                break
            self._export(
                BatchExportStrategy.EXPORT_WHILE_BATCH_EXCEEDS_THRESHOLD
                if sleep_interrupted
                else BatchExportStrategy.EXPORT_AT_LEAST_ONE_BATCH
            )
            self._worker_awaken.clear()
        self._export(BatchExportStrategy.EXPORT_ALL)

    def _export(self, batch_strategy: BatchExportStrategy) -> None:
        with self._export_lock:
            iteration = 0
            # We could see concurrent export calls from worker and force_flush. We call _should_export_batch
            # once the lock is obtained to see if we still need to make the requested export.
            while self._should_export_batch(batch_strategy, iteration):
                iteration += 1
                token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
                try:
                    self._exporter.export(
                        [
                            # Oldest records are at the back, so pop from there.
                            self._queue.pop()
                            for _ in range(
                                min(
                                    self._max_export_batch_size,
                                    len(self._queue),
                                )
                            )
                        ]
                    )
                except Exception:  # pylint: disable=broad-exception-caught
                    self._logger.exception(
                        "Exception while exporting %s.", self._exporting
                    )
                detach(token)

    # Do not add any logging.log statements to this function, they can be being routed back to this `emit` function,
    # resulting in endless recursive calls that crash the program.
    # See https://github.com/open-telemetry/opentelemetry-python/issues/4261
    def emit(self, data: Telemetry) -> None:
        if self._shutdown:
            return
        if self._pid != os.getpid():
            self._bsp_reset_once.do_once(self._at_fork_reinit)
        # This will drop a log from the right side if the queue is at _max_queue_length.
        self._queue.appendleft(data)
        if len(self._queue) >= self._max_export_batch_size:
            self._worker_awaken.set()

    def shutdown(self):
        if self._shutdown:
            return
        # Prevents emit and force_flush from further calling export.
        self._shutdown = True
        # Interrupts sleep in the worker, if it's sleeping.
        self._worker_awaken.set()
        # Main worker loop should exit after one final export call with flush all strategy.
        self._worker_thread.join()
        self._exporter.shutdown()

    # TODO: Fix force flush so the timeout is used https://github.com/open-telemetry/opentelemetry-python/issues/4568.
    def force_flush(self, timeout_millis: Optional[int] = None) -> bool:
        if self._shutdown:
            return False
        # Blocking call to export.
        self._export(BatchExportStrategy.EXPORT_ALL)
        return True
