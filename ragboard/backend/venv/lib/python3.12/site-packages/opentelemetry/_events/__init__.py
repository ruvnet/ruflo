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

from abc import ABC, abstractmethod
from logging import getLogger
from os import environ
from typing import Optional, cast

from opentelemetry._logs import LogRecord
from opentelemetry._logs.severity import SeverityNumber
from opentelemetry.environment_variables import (
    _OTEL_PYTHON_EVENT_LOGGER_PROVIDER,
)
from opentelemetry.trace.span import TraceFlags
from opentelemetry.util._once import Once
from opentelemetry.util._providers import _load_provider
from opentelemetry.util.types import AnyValue, _ExtendedAttributes

_logger = getLogger(__name__)


class Event(LogRecord):
    def __init__(
        self,
        name: str,
        timestamp: Optional[int] = None,
        trace_id: Optional[int] = None,
        span_id: Optional[int] = None,
        trace_flags: Optional["TraceFlags"] = None,
        body: Optional[AnyValue] = None,
        severity_number: Optional[SeverityNumber] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ):
        attributes = attributes or {}
        event_attributes = {
            **attributes,
            "event.name": name,
        }
        super().__init__(
            timestamp=timestamp,
            trace_id=trace_id,
            span_id=span_id,
            trace_flags=trace_flags,
            body=body,
            severity_number=severity_number,
            attributes=event_attributes,
        )
        self.name = name


class EventLogger(ABC):
    def __init__(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ):
        self._name = name
        self._version = version
        self._schema_url = schema_url
        self._attributes = attributes

    @abstractmethod
    def emit(self, event: "Event") -> None:
        """Emits a :class:`Event` representing an event."""


class NoOpEventLogger(EventLogger):
    def emit(self, event: Event) -> None:
        pass


class ProxyEventLogger(EventLogger):
    def __init__(
        self,
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
        self._real_event_logger: Optional[EventLogger] = None
        self._noop_event_logger = NoOpEventLogger(name)

    @property
    def _event_logger(self) -> EventLogger:
        if self._real_event_logger:
            return self._real_event_logger

        if _EVENT_LOGGER_PROVIDER:
            self._real_event_logger = _EVENT_LOGGER_PROVIDER.get_event_logger(
                self._name,
                self._version,
                self._schema_url,
                self._attributes,
            )
            return self._real_event_logger
        return self._noop_event_logger

    def emit(self, event: Event) -> None:
        self._event_logger.emit(event)


class EventLoggerProvider(ABC):
    @abstractmethod
    def get_event_logger(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> EventLogger:
        """Returns an EventLoggerProvider for use."""


class NoOpEventLoggerProvider(EventLoggerProvider):
    def get_event_logger(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> EventLogger:
        return NoOpEventLogger(
            name, version=version, schema_url=schema_url, attributes=attributes
        )


class ProxyEventLoggerProvider(EventLoggerProvider):
    def get_event_logger(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> EventLogger:
        if _EVENT_LOGGER_PROVIDER:
            return _EVENT_LOGGER_PROVIDER.get_event_logger(
                name,
                version=version,
                schema_url=schema_url,
                attributes=attributes,
            )
        return ProxyEventLogger(
            name,
            version=version,
            schema_url=schema_url,
            attributes=attributes,
        )


_EVENT_LOGGER_PROVIDER_SET_ONCE = Once()
_EVENT_LOGGER_PROVIDER: Optional[EventLoggerProvider] = None
_PROXY_EVENT_LOGGER_PROVIDER = ProxyEventLoggerProvider()


def get_event_logger_provider() -> EventLoggerProvider:
    global _EVENT_LOGGER_PROVIDER  # pylint: disable=global-variable-not-assigned
    if _EVENT_LOGGER_PROVIDER is None:
        if _OTEL_PYTHON_EVENT_LOGGER_PROVIDER not in environ:
            return _PROXY_EVENT_LOGGER_PROVIDER

        event_logger_provider: EventLoggerProvider = _load_provider(  # type: ignore
            _OTEL_PYTHON_EVENT_LOGGER_PROVIDER, "event_logger_provider"
        )

        _set_event_logger_provider(event_logger_provider, log=False)

    return cast("EventLoggerProvider", _EVENT_LOGGER_PROVIDER)


def _set_event_logger_provider(
    event_logger_provider: EventLoggerProvider, log: bool
) -> None:
    def set_elp() -> None:
        global _EVENT_LOGGER_PROVIDER  # pylint: disable=global-statement
        _EVENT_LOGGER_PROVIDER = event_logger_provider

    did_set = _EVENT_LOGGER_PROVIDER_SET_ONCE.do_once(set_elp)

    if log and not did_set:
        _logger.warning(
            "Overriding of current EventLoggerProvider is not allowed"
        )


def set_event_logger_provider(
    event_logger_provider: EventLoggerProvider,
) -> None:
    _set_event_logger_provider(event_logger_provider, log=True)


def get_event_logger(
    name: str,
    version: Optional[str] = None,
    schema_url: Optional[str] = None,
    attributes: Optional[_ExtendedAttributes] = None,
    event_logger_provider: Optional[EventLoggerProvider] = None,
) -> "EventLogger":
    if event_logger_provider is None:
        event_logger_provider = get_event_logger_provider()
    return event_logger_provider.get_event_logger(
        name,
        version,
        schema_url,
        attributes,
    )
