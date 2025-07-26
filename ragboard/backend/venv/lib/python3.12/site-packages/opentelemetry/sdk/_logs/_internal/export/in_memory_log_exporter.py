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

import threading
import typing

from opentelemetry.sdk._logs import LogData
from opentelemetry.sdk._logs.export import LogExporter, LogExportResult


class InMemoryLogExporter(LogExporter):
    """Implementation of :class:`.LogExporter` that stores logs in memory.

    This class can be used for testing purposes. It stores the exported logs
    in a list in memory that can be retrieved using the
    :func:`.get_finished_logs` method.
    """

    def __init__(self):
        self._logs = []
        self._lock = threading.Lock()
        self._stopped = False

    def clear(self) -> None:
        with self._lock:
            self._logs.clear()

    def get_finished_logs(self) -> typing.Tuple[LogData, ...]:
        with self._lock:
            return tuple(self._logs)

    def export(self, batch: typing.Sequence[LogData]) -> LogExportResult:
        if self._stopped:
            return LogExportResult.FAILURE
        with self._lock:
            self._logs.extend(batch)
        return LogExportResult.SUCCESS

    def shutdown(self) -> None:
        self._stopped = True
