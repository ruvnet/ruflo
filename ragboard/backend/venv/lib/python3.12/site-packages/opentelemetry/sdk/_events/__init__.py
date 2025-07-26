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
import logging
from time import time_ns
from typing import Optional

from opentelemetry import trace
from opentelemetry._events import Event
from opentelemetry._events import EventLogger as APIEventLogger
from opentelemetry._events import EventLoggerProvider as APIEventLoggerProvider
from opentelemetry._logs import NoOpLogger, SeverityNumber, get_logger_provider
from opentelemetry.sdk._logs import Logger, LoggerProvider, LogRecord
from opentelemetry.util.types import _ExtendedAttributes

_logger = logging.getLogger(__name__)


class EventLogger(APIEventLogger):
    def __init__(
        self,
        logger_provider: LoggerProvider,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ):
        super().__init__(
            name=name,
            version=version,
            schema_url=schema_url,
            attributes=attributes,
        )
        self._logger: Logger = logger_provider.get_logger(
            name, version, schema_url, attributes
        )

    def emit(self, event: Event) -> None:
        if isinstance(self._logger, NoOpLogger):
            # Do nothing if SDK is disabled
            return
        span_context = trace.get_current_span().get_span_context()
        log_record = LogRecord(
            timestamp=event.timestamp or time_ns(),
            observed_timestamp=None,
            trace_id=event.trace_id or span_context.trace_id,
            span_id=event.span_id or span_context.span_id,
            trace_flags=event.trace_flags or span_context.trace_flags,
            severity_text=None,
            severity_number=event.severity_number or SeverityNumber.INFO,
            body=event.body,
            resource=getattr(self._logger, "resource", None),
            attributes=event.attributes,
        )
        self._logger.emit(log_record)


class EventLoggerProvider(APIEventLoggerProvider):
    def __init__(self, logger_provider: Optional[LoggerProvider] = None):
        self._logger_provider = logger_provider or get_logger_provider()

    def get_event_logger(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> EventLogger:
        if not name:
            _logger.warning("EventLogger created with invalid name: %s", name)
        return EventLogger(
            self._logger_provider, name, version, schema_url, attributes
        )

    def shutdown(self):
        self._logger_provider.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        self._logger_provider.force_flush(timeout_millis)
