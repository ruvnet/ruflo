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
"""
The OpenTelemetry logging API describes the classes used to generate logs and events.

The :class:`.LoggerProvider` provides users access to the :class:`.Logger`.

This module provides abstract (i.e. unimplemented) classes required for
logging, and a concrete no-op implementation :class:`.NoOpLogger` that allows applications
to use the API package alone without a supporting implementation.

To get a logger, you need to provide the package name from which you are
calling the logging APIs to OpenTelemetry by calling `LoggerProvider.get_logger`
with the calling module name and the version of your package.

The following code shows how to obtain a logger using the global :class:`.LoggerProvider`::

    from opentelemetry._logs import get_logger

    logger = get_logger("example-logger")

.. versionadded:: 1.15.0
"""

from abc import ABC, abstractmethod
from logging import getLogger
from os import environ
from time import time_ns
from typing import Optional, cast, overload

from typing_extensions import deprecated

from opentelemetry._logs.severity import SeverityNumber
from opentelemetry.context import get_current
from opentelemetry.context.context import Context
from opentelemetry.environment_variables import _OTEL_PYTHON_LOGGER_PROVIDER
from opentelemetry.trace import get_current_span
from opentelemetry.trace.span import TraceFlags
from opentelemetry.util._once import Once
from opentelemetry.util._providers import _load_provider
from opentelemetry.util.types import AnyValue, _ExtendedAttributes

_logger = getLogger(__name__)


class LogRecord(ABC):
    """A LogRecord instance represents an event being logged.

    LogRecord instances are created and emitted via `Logger`
    every time something is logged. They contain all the information
    pertinent to the event being logged.
    """

    @overload
    def __init__(
        self,
        *,
        timestamp: Optional[int] = None,
        observed_timestamp: Optional[int] = None,
        context: Optional[Context] = None,
        severity_text: Optional[str] = None,
        severity_number: Optional[SeverityNumber] = None,
        body: AnyValue = None,
        attributes: Optional[_ExtendedAttributes] = None,
        event_name: Optional[str] = None,
    ) -> None: ...

    @overload
    @deprecated(
        "LogRecord init with `trace_id`, `span_id`, and/or `trace_flags` is deprecated since 1.35.0. Use `context` instead."
    )
    def __init__(
        self,
        *,
        timestamp: Optional[int] = None,
        observed_timestamp: Optional[int] = None,
        trace_id: Optional[int] = None,
        span_id: Optional[int] = None,
        trace_flags: Optional["TraceFlags"] = None,
        severity_text: Optional[str] = None,
        severity_number: Optional[SeverityNumber] = None,
        body: AnyValue = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> None: ...

    def __init__(
        self,
        *,
        timestamp: Optional[int] = None,
        observed_timestamp: Optional[int] = None,
        context: Optional[Context] = None,
        trace_id: Optional[int] = None,
        span_id: Optional[int] = None,
        trace_flags: Optional["TraceFlags"] = None,
        severity_text: Optional[str] = None,
        severity_number: Optional[SeverityNumber] = None,
        body: AnyValue = None,
        attributes: Optional[_ExtendedAttributes] = None,
        event_name: Optional[str] = None,
    ) -> None:
        if not context:
            context = get_current()
        span_context = get_current_span(context).get_span_context()
        self.timestamp = timestamp
        if observed_timestamp is None:
            observed_timestamp = time_ns()
        self.observed_timestamp = observed_timestamp
        self.context = context
        self.trace_id = trace_id or span_context.trace_id
        self.span_id = span_id or span_context.span_id
        self.trace_flags = trace_flags or span_context.trace_flags
        self.severity_text = severity_text
        self.severity_number = severity_number
        self.body = body
        self.attributes = attributes
        self.event_name = event_name


class Logger(ABC):
    """Handles emitting events and logs via `LogRecord`."""

    def __init__(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> None:
        super().__init__()
        self._name = name
        self._version = version
        self._schema_url = schema_url
        self._attributes = attributes

    @abstractmethod
    def emit(self, record: "LogRecord") -> None:
        """Emits a :class:`LogRecord` representing a log to the processing pipeline."""


class NoOpLogger(Logger):
    """The default Logger used when no Logger implementation is available.

    All operations are no-op.
    """

    def emit(self, record: "LogRecord") -> None:
        pass


class ProxyLogger(Logger):
    def __init__(  # pylint: disable=super-init-not-called
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
        self._real_logger: Optional[Logger] = None
        self._noop_logger = NoOpLogger(name)

    @property
    def _logger(self) -> Logger:
        if self._real_logger:
            return self._real_logger

        if _LOGGER_PROVIDER:
            self._real_logger = _LOGGER_PROVIDER.get_logger(
                self._name,
                self._version,
                self._schema_url,
                self._attributes,
            )
            return self._real_logger
        return self._noop_logger

    def emit(self, record: LogRecord) -> None:
        self._logger.emit(record)


class LoggerProvider(ABC):
    """
    LoggerProvider is the entry point of the API. It provides access to Logger instances.
    """

    @abstractmethod
    def get_logger(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> Logger:
        """Returns a `Logger` for use by the given instrumentation library.

        For any two calls with identical parameters, it is undefined whether the same
        or different `Logger` instances are returned.

        This function may return different `Logger` types (e.g. a no-op logger
        vs. a functional logger).

        Args:
            name: The name of the instrumenting module, package or class.
                This should *not* be the name of the module, package or class that is
                instrumented but the name of the code doing the instrumentation.
                E.g., instead of ``"requests"``, use
                ``"opentelemetry.instrumentation.requests"``.

                For log sources which define a logger name (e.g. logging.Logger.name)
                the Logger Name should be recorded as the instrumentation scope name.

            version: Optional. The version string of the
                instrumenting library.  Usually this should be the same as
                ``importlib.metadata.version(instrumenting_library_name)``.

            schema_url: Optional. Specifies the Schema URL of the emitted telemetry.

            attributes: Optional. Specifies the instrumentation scope attributes to
                associate with emitted telemetry.
        """


class NoOpLoggerProvider(LoggerProvider):
    """The default LoggerProvider used when no LoggerProvider implementation is available."""

    def get_logger(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> Logger:
        """Returns a NoOpLogger."""
        return NoOpLogger(
            name, version=version, schema_url=schema_url, attributes=attributes
        )


class ProxyLoggerProvider(LoggerProvider):
    def get_logger(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[_ExtendedAttributes] = None,
    ) -> Logger:
        if _LOGGER_PROVIDER:
            return _LOGGER_PROVIDER.get_logger(
                name,
                version=version,
                schema_url=schema_url,
                attributes=attributes,
            )
        return ProxyLogger(
            name,
            version=version,
            schema_url=schema_url,
            attributes=attributes,
        )


_LOGGER_PROVIDER_SET_ONCE = Once()
_LOGGER_PROVIDER: Optional[LoggerProvider] = None
_PROXY_LOGGER_PROVIDER = ProxyLoggerProvider()


def get_logger_provider() -> LoggerProvider:
    """Gets the current global :class:`~.LoggerProvider` object."""
    global _LOGGER_PROVIDER  # pylint: disable=global-variable-not-assigned
    if _LOGGER_PROVIDER is None:
        if _OTEL_PYTHON_LOGGER_PROVIDER not in environ:
            return _PROXY_LOGGER_PROVIDER

        logger_provider: LoggerProvider = _load_provider(  # type: ignore
            _OTEL_PYTHON_LOGGER_PROVIDER, "logger_provider"
        )
        _set_logger_provider(logger_provider, log=False)

    # _LOGGER_PROVIDER will have been set by one thread
    return cast("LoggerProvider", _LOGGER_PROVIDER)


def _set_logger_provider(logger_provider: LoggerProvider, log: bool) -> None:
    def set_lp() -> None:
        global _LOGGER_PROVIDER  # pylint: disable=global-statement
        _LOGGER_PROVIDER = logger_provider

    did_set = _LOGGER_PROVIDER_SET_ONCE.do_once(set_lp)

    if log and not did_set:
        _logger.warning("Overriding of current LoggerProvider is not allowed")


def set_logger_provider(logger_provider: LoggerProvider) -> None:
    """Sets the current global :class:`~.LoggerProvider` object.

    This can only be done once, a warning will be logged if any further attempt
    is made.
    """
    _set_logger_provider(logger_provider, log=True)


def get_logger(
    instrumenting_module_name: str,
    instrumenting_library_version: str = "",
    logger_provider: Optional[LoggerProvider] = None,
    schema_url: Optional[str] = None,
    attributes: Optional[_ExtendedAttributes] = None,
) -> "Logger":
    """Returns a `Logger` for use within a python process.

    This function is a convenience wrapper for
    opentelemetry.sdk._logs.LoggerProvider.get_logger.

    If logger_provider param is omitted the current configured one is used.
    """
    if logger_provider is None:
        logger_provider = get_logger_provider()
    return logger_provider.get_logger(
        instrumenting_module_name,
        instrumenting_library_version,
        schema_url,
        attributes,
    )
