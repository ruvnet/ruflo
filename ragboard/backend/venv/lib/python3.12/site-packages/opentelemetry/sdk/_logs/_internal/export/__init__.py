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

import abc
import enum
import logging
import sys
from os import environ, linesep
from typing import IO, Callable, Optional, Sequence

from opentelemetry.context import (
    _SUPPRESS_INSTRUMENTATION_KEY,
    attach,
    detach,
    set_value,
)
from opentelemetry.sdk._logs import LogData, LogRecord, LogRecordProcessor
from opentelemetry.sdk._shared_internal import BatchProcessor
from opentelemetry.sdk.environment_variables import (
    OTEL_BLRP_EXPORT_TIMEOUT,
    OTEL_BLRP_MAX_EXPORT_BATCH_SIZE,
    OTEL_BLRP_MAX_QUEUE_SIZE,
    OTEL_BLRP_SCHEDULE_DELAY,
)

_DEFAULT_SCHEDULE_DELAY_MILLIS = 5000
_DEFAULT_MAX_EXPORT_BATCH_SIZE = 512
_DEFAULT_EXPORT_TIMEOUT_MILLIS = 30000
_DEFAULT_MAX_QUEUE_SIZE = 2048
_ENV_VAR_INT_VALUE_ERROR_MESSAGE = (
    "Unable to parse value for %s as integer. Defaulting to %s."
)
_logger = logging.getLogger(__name__)


class LogExportResult(enum.Enum):
    SUCCESS = 0
    FAILURE = 1


class LogExporter(abc.ABC):
    """Interface for exporting logs.
    Interface to be implemented by services that want to export logs received
    in their own format.
    To export data this MUST be registered to the :class`opentelemetry.sdk._logs.Logger` using a
    log processor.
    """

    @abc.abstractmethod
    def export(self, batch: Sequence[LogData]):
        """Exports a batch of logs.
        Args:
            batch: The list of `LogData` objects to be exported
        Returns:
            The result of the export
        """

    @abc.abstractmethod
    def shutdown(self):
        """Shuts down the exporter.

        Called when the SDK is shut down.
        """


class ConsoleLogExporter(LogExporter):
    """Implementation of :class:`LogExporter` that prints log records to the
    console.

    This class can be used for diagnostic purposes. It prints the exported
    log records to the console STDOUT.
    """

    def __init__(
        self,
        out: IO = sys.stdout,
        formatter: Callable[[LogRecord], str] = lambda record: record.to_json()
        + linesep,
    ):
        self.out = out
        self.formatter = formatter

    def export(self, batch: Sequence[LogData]):
        for data in batch:
            self.out.write(self.formatter(data.log_record))
        self.out.flush()
        return LogExportResult.SUCCESS

    def shutdown(self):
        pass


class SimpleLogRecordProcessor(LogRecordProcessor):
    """This is an implementation of LogRecordProcessor which passes
    received logs in the export-friendly LogData representation to the
    configured LogExporter, as soon as they are emitted.
    """

    def __init__(self, exporter: LogExporter):
        self._exporter = exporter
        self._shutdown = False

    def on_emit(self, log_data: LogData):
        if self._shutdown:
            _logger.warning("Processor is already shutdown, ignoring call")
            return
        token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
        try:
            self._exporter.export((log_data,))
        except Exception:  # pylint: disable=broad-exception-caught
            _logger.exception("Exception while exporting logs.")
        detach(token)

    def shutdown(self):
        self._shutdown = True
        self._exporter.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:  # pylint: disable=no-self-use
        return True


class BatchLogRecordProcessor(LogRecordProcessor):
    """This is an implementation of LogRecordProcessor which creates batches of
    received logs in the export-friendly LogData representation and
    send to the configured LogExporter, as soon as they are emitted.

    `BatchLogRecordProcessor` is configurable with the following environment
    variables which correspond to constructor parameters:

    - :envvar:`OTEL_BLRP_SCHEDULE_DELAY`
    - :envvar:`OTEL_BLRP_MAX_QUEUE_SIZE`
    - :envvar:`OTEL_BLRP_MAX_EXPORT_BATCH_SIZE`
    - :envvar:`OTEL_BLRP_EXPORT_TIMEOUT`

    All the logic for emitting logs, shutting down etc. resides in the BatchProcessor class.
    """

    def __init__(
        self,
        exporter: LogExporter,
        schedule_delay_millis: float | None = None,
        max_export_batch_size: int | None = None,
        export_timeout_millis: float | None = None,
        max_queue_size: int | None = None,
    ):
        if max_queue_size is None:
            max_queue_size = BatchLogRecordProcessor._default_max_queue_size()

        if schedule_delay_millis is None:
            schedule_delay_millis = (
                BatchLogRecordProcessor._default_schedule_delay_millis()
            )

        if max_export_batch_size is None:
            max_export_batch_size = (
                BatchLogRecordProcessor._default_max_export_batch_size()
            )
        # Not used. No way currently to pass timeout to export.
        if export_timeout_millis is None:
            export_timeout_millis = (
                BatchLogRecordProcessor._default_export_timeout_millis()
            )

        BatchLogRecordProcessor._validate_arguments(
            max_queue_size, schedule_delay_millis, max_export_batch_size
        )
        # Initializes BatchProcessor
        self._batch_processor = BatchProcessor(
            exporter,
            schedule_delay_millis,
            max_export_batch_size,
            export_timeout_millis,
            max_queue_size,
            "Log",
        )

    def on_emit(self, log_data: LogData) -> None:
        return self._batch_processor.emit(log_data)

    def shutdown(self):
        return self._batch_processor.shutdown()

    def force_flush(self, timeout_millis: Optional[int] = None) -> bool:
        return self._batch_processor.force_flush(timeout_millis)

    @staticmethod
    def _default_max_queue_size():
        try:
            return int(
                environ.get(OTEL_BLRP_MAX_QUEUE_SIZE, _DEFAULT_MAX_QUEUE_SIZE)
            )
        except ValueError:
            _logger.exception(
                _ENV_VAR_INT_VALUE_ERROR_MESSAGE,
                OTEL_BLRP_MAX_QUEUE_SIZE,
                _DEFAULT_MAX_QUEUE_SIZE,
            )
            return _DEFAULT_MAX_QUEUE_SIZE

    @staticmethod
    def _default_schedule_delay_millis():
        try:
            return int(
                environ.get(
                    OTEL_BLRP_SCHEDULE_DELAY, _DEFAULT_SCHEDULE_DELAY_MILLIS
                )
            )
        except ValueError:
            _logger.exception(
                _ENV_VAR_INT_VALUE_ERROR_MESSAGE,
                OTEL_BLRP_SCHEDULE_DELAY,
                _DEFAULT_SCHEDULE_DELAY_MILLIS,
            )
            return _DEFAULT_SCHEDULE_DELAY_MILLIS

    @staticmethod
    def _default_max_export_batch_size():
        try:
            return int(
                environ.get(
                    OTEL_BLRP_MAX_EXPORT_BATCH_SIZE,
                    _DEFAULT_MAX_EXPORT_BATCH_SIZE,
                )
            )
        except ValueError:
            _logger.exception(
                _ENV_VAR_INT_VALUE_ERROR_MESSAGE,
                OTEL_BLRP_MAX_EXPORT_BATCH_SIZE,
                _DEFAULT_MAX_EXPORT_BATCH_SIZE,
            )
            return _DEFAULT_MAX_EXPORT_BATCH_SIZE

    @staticmethod
    def _default_export_timeout_millis():
        try:
            return int(
                environ.get(
                    OTEL_BLRP_EXPORT_TIMEOUT, _DEFAULT_EXPORT_TIMEOUT_MILLIS
                )
            )
        except ValueError:
            _logger.exception(
                _ENV_VAR_INT_VALUE_ERROR_MESSAGE,
                OTEL_BLRP_EXPORT_TIMEOUT,
                _DEFAULT_EXPORT_TIMEOUT_MILLIS,
            )
            return _DEFAULT_EXPORT_TIMEOUT_MILLIS

    @staticmethod
    def _validate_arguments(
        max_queue_size, schedule_delay_millis, max_export_batch_size
    ):
        if max_queue_size <= 0:
            raise ValueError("max_queue_size must be a positive integer.")

        if schedule_delay_millis <= 0:
            raise ValueError("schedule_delay_millis must be positive.")

        if max_export_batch_size <= 0:
            raise ValueError(
                "max_export_batch_size must be a positive integer."
            )

        if max_export_batch_size > max_queue_size:
            raise ValueError(
                "max_export_batch_size must be less than or equal to max_queue_size."
            )
