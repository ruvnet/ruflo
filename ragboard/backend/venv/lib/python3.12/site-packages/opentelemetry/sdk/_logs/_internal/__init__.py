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
import atexit
import base64
import concurrent.futures
import json
import logging
import threading
import traceback
import warnings
from os import environ
from threading import Lock
from time import time_ns
from typing import Any, Callable, Tuple, Union, cast, overload  # noqa

from typing_extensions import deprecated

from opentelemetry._logs import Logger as APILogger
from opentelemetry._logs import LoggerProvider as APILoggerProvider
from opentelemetry._logs import LogRecord as APILogRecord
from opentelemetry._logs import (
    NoOpLogger,
    SeverityNumber,
    get_logger,
    get_logger_provider,
)
from opentelemetry.attributes import _VALID_ANY_VALUE_TYPES, BoundedAttributes
from opentelemetry.context import get_current
from opentelemetry.context.context import Context
from opentelemetry.sdk.environment_variables import (
    OTEL_ATTRIBUTE_COUNT_LIMIT,
    OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT,
    OTEL_SDK_DISABLED,
)
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.util import ns_to_iso_str
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from opentelemetry.semconv._incubating.attributes import code_attributes
from opentelemetry.semconv.attributes import exception_attributes
from opentelemetry.trace import (
    format_span_id,
    format_trace_id,
    get_current_span,
)
from opentelemetry.trace.span import TraceFlags
from opentelemetry.util.types import AnyValue, _ExtendedAttributes

_logger = logging.getLogger(__name__)

_DEFAULT_OTEL_ATTRIBUTE_COUNT_LIMIT = 128
_ENV_VALUE_UNSET = ""


class BytesEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, bytes):
            return base64.b64encode(o).decode()
        return super().default(o)


class LogDroppedAttributesWarning(UserWarning):
    """Custom warning to indicate dropped log attributes due to limits.

    This class is used to filter and handle these specific warnings separately
    from other warnings, ensuring that they are only shown once without
    interfering with default user warnings.
    """


warnings.simplefilter("once", LogDroppedAttributesWarning)


class LogDeprecatedInitWarning(UserWarning):
    """Custom warning to indicate deprecated LogRecord init was used.

    This class is used to filter and handle these specific warnings separately
    from other warnings, ensuring that they are only shown once without
    interfering with default user warnings.
    """


warnings.simplefilter("once", LogDeprecatedInitWarning)


class LogLimits:
    """This class is based on a SpanLimits class in the Tracing module.

    This class represents the limits that should be enforced on recorded data such as events, links, attributes etc.

    This class does not enforce any limits itself. It only provides a way to read limits from env,
    default values and from user provided arguments.

    All limit arguments must be either a non-negative integer, ``None`` or ``LogLimits.UNSET``.

    - All limit arguments are optional.
    - If a limit argument is not set, the class will try to read its value from the corresponding
      environment variable.
    - If the environment variable is not set, the default value, if any, will be used.

    Limit precedence:

    - If a model specific limit is set, it will be used.
    - Else if the corresponding global limit is set, it will be used.
    - Else if the model specific limit has a default value, the default value will be used.
    - Else if the global limit has a default value, the default value will be used.

    Args:
        max_attributes: Maximum number of attributes that can be added to a span, event, and link.
            Environment variable: ``OTEL_ATTRIBUTE_COUNT_LIMIT``
            Default: {_DEFAULT_OTEL_ATTRIBUTE_COUNT_LIMIT}
        max_attribute_length: Maximum length an attribute value can have. Values longer than
            the specified length will be truncated.
    """

    UNSET = -1

    def __init__(
        self,
        max_attributes: int | None = None,
        max_attribute_length: int | None = None,
    ):
        # attribute count
        global_max_attributes = self._from_env_if_absent(
            max_attributes, OTEL_ATTRIBUTE_COUNT_LIMIT
        )
        self.max_attributes = (
            global_max_attributes
            if global_max_attributes is not None
            else _DEFAULT_OTEL_ATTRIBUTE_COUNT_LIMIT
        )

        # attribute length
        self.max_attribute_length = self._from_env_if_absent(
            max_attribute_length,
            OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT,
        )

    def __repr__(self):
        return f"{type(self).__name__}(max_attributes={self.max_attributes}, max_attribute_length={self.max_attribute_length})"

    @classmethod
    def _from_env_if_absent(
        cls, value: int | None, env_var: str, default: int | None = None
    ) -> int | None:
        if value == cls.UNSET:
            return None

        err_msg = "{} must be a non-negative integer but got {}"

        # if no value is provided for the limit, try to load it from env
        if value is None:
            # return default value if env var is not set
            if env_var not in environ:
                return default

            str_value = environ.get(env_var, "").strip().lower()
            if str_value == _ENV_VALUE_UNSET:
                return None

            try:
                value = int(str_value)
            except ValueError:
                raise ValueError(err_msg.format(env_var, str_value))

        if value < 0:
            raise ValueError(err_msg.format(env_var, value))
        return value


_UnsetLogLimits = LogLimits(
    max_attributes=LogLimits.UNSET,
    max_attribute_length=LogLimits.UNSET,
)


class LogRecord(APILogRecord):
    """A LogRecord instance represents an event being logged.

    LogRecord instances are created and emitted via `Logger`
    every time something is logged. They contain all the information
    pertinent to the event being logged.
    """

    @overload
    def __init__(
        self,
        timestamp: int | None = None,
        observed_timestamp: int | None = None,
        context: Context | None = None,
        severity_text: str | None = None,
        severity_number: SeverityNumber | None = None,
        body: AnyValue | None = None,
        resource: Resource | None = None,
        attributes: _ExtendedAttributes | None = None,
        limits: LogLimits | None = _UnsetLogLimits,
        event_name: str | None = None,
    ): ...

    @overload
    @deprecated(
        "LogRecord init with `trace_id`, `span_id`, and/or `trace_flags` is deprecated since 1.35.0. Use `context` instead."  # noqa: E501
    )
    def __init__(
        self,
        timestamp: int | None = None,
        observed_timestamp: int | None = None,
        trace_id: int | None = None,
        span_id: int | None = None,
        trace_flags: TraceFlags | None = None,
        severity_text: str | None = None,
        severity_number: SeverityNumber | None = None,
        body: AnyValue | None = None,
        resource: Resource | None = None,
        attributes: _ExtendedAttributes | None = None,
        limits: LogLimits | None = _UnsetLogLimits,
    ): ...

    def __init__(  # pylint:disable=too-many-locals
        self,
        timestamp: int | None = None,
        observed_timestamp: int | None = None,
        context: Context | None = None,
        trace_id: int | None = None,
        span_id: int | None = None,
        trace_flags: TraceFlags | None = None,
        severity_text: str | None = None,
        severity_number: SeverityNumber | None = None,
        body: AnyValue | None = None,
        resource: Resource | None = None,
        attributes: _ExtendedAttributes | None = None,
        limits: LogLimits | None = _UnsetLogLimits,
        event_name: str | None = None,
    ):
        if trace_id or span_id or trace_flags:
            warnings.warn(
                "LogRecord init with `trace_id`, `span_id`, and/or `trace_flags` is deprecated since 1.35.0. Use `context` instead.",
                LogDeprecatedInitWarning,
                stacklevel=2,
            )

        if not context:
            context = get_current()

        span = get_current_span(context)
        span_context = span.get_span_context()

        super().__init__(
            **{
                "timestamp": timestamp,
                "observed_timestamp": observed_timestamp,
                "context": context,
                "trace_id": trace_id or span_context.trace_id,
                "span_id": span_id or span_context.span_id,
                "trace_flags": trace_flags or span_context.trace_flags,
                "severity_text": severity_text,
                "severity_number": severity_number,
                "body": body,
                "attributes": BoundedAttributes(
                    maxlen=limits.max_attributes,
                    attributes=attributes if bool(attributes) else None,
                    immutable=False,
                    max_value_len=limits.max_attribute_length,
                    extended_attributes=True,
                ),
                "event_name": event_name,
            }
        )
        self.resource = (
            resource if isinstance(resource, Resource) else Resource.create({})
        )
        if self.dropped_attributes > 0:
            warnings.warn(
                "Log record attributes were dropped due to limits",
                LogDroppedAttributesWarning,
                stacklevel=2,
            )

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, LogRecord):
            return NotImplemented
        return self.__dict__ == other.__dict__

    def to_json(self, indent: int | None = 4) -> str:
        return json.dumps(
            {
                "body": self.body,
                "severity_number": self.severity_number.value
                if self.severity_number is not None
                else None,
                "severity_text": self.severity_text,
                "attributes": (
                    dict(self.attributes) if bool(self.attributes) else None
                ),
                "dropped_attributes": self.dropped_attributes,
                "timestamp": ns_to_iso_str(self.timestamp),
                "observed_timestamp": ns_to_iso_str(self.observed_timestamp),
                "trace_id": (
                    f"0x{format_trace_id(self.trace_id)}"
                    if self.trace_id is not None
                    else ""
                ),
                "span_id": (
                    f"0x{format_span_id(self.span_id)}"
                    if self.span_id is not None
                    else ""
                ),
                "trace_flags": self.trace_flags,
                "resource": json.loads(self.resource.to_json()),
                "event_name": self.event_name if self.event_name else "",
            },
            indent=indent,
            cls=BytesEncoder,
        )

    @property
    def dropped_attributes(self) -> int:
        attributes: BoundedAttributes = cast(
            BoundedAttributes, self.attributes
        )
        if attributes:
            return attributes.dropped
        return 0


class LogData:
    """Readable LogRecord data plus associated InstrumentationLibrary."""

    def __init__(
        self,
        log_record: LogRecord,
        instrumentation_scope: InstrumentationScope,
    ):
        self.log_record = log_record
        self.instrumentation_scope = instrumentation_scope


class LogRecordProcessor(abc.ABC):
    """Interface to hook the log record emitting action.

    Log processors can be registered directly using
    :func:`LoggerProvider.add_log_record_processor` and they are invoked
    in the same order as they were registered.
    """

    @abc.abstractmethod
    def on_emit(self, log_data: LogData):
        """Emits the `LogData`"""

    @abc.abstractmethod
    def shutdown(self):
        """Called when a :class:`opentelemetry.sdk._logs.Logger` is shutdown"""

    @abc.abstractmethod
    def force_flush(self, timeout_millis: int = 30000):
        """Export all the received logs to the configured Exporter that have not yet
        been exported.

        Args:
            timeout_millis: The maximum amount of time to wait for logs to be
                exported.

        Returns:
            False if the timeout is exceeded, True otherwise.
        """


# Temporary fix until https://github.com/PyCQA/pylint/issues/4098 is resolved
# pylint:disable=no-member
class SynchronousMultiLogRecordProcessor(LogRecordProcessor):
    """Implementation of class:`LogRecordProcessor` that forwards all received
    events to a list of log processors sequentially.

    The underlying log processors are called in sequential order as they were
    added.
    """

    def __init__(self):
        # use a tuple to avoid race conditions when adding a new log and
        # iterating through it on "emit".
        self._log_record_processors = ()  # type: Tuple[LogRecordProcessor, ...]
        self._lock = threading.Lock()

    def add_log_record_processor(
        self, log_record_processor: LogRecordProcessor
    ) -> None:
        """Adds a Logprocessor to the list of log processors handled by this instance"""
        with self._lock:
            self._log_record_processors += (log_record_processor,)

    def on_emit(self, log_data: LogData) -> None:
        for lp in self._log_record_processors:
            lp.on_emit(log_data)

    def shutdown(self) -> None:
        """Shutdown the log processors one by one"""
        for lp in self._log_record_processors:
            lp.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        """Force flush the log processors one by one

        Args:
            timeout_millis: The maximum amount of time to wait for logs to be
                exported. If the first n log processors exceeded the timeout
                then remaining log processors will not be flushed.

        Returns:
            True if all the log processors flushes the logs within timeout,
            False otherwise.
        """
        deadline_ns = time_ns() + timeout_millis * 1000000
        for lp in self._log_record_processors:
            current_ts = time_ns()
            if current_ts >= deadline_ns:
                return False

            if not lp.force_flush((deadline_ns - current_ts) // 1000000):
                return False

        return True


class ConcurrentMultiLogRecordProcessor(LogRecordProcessor):
    """Implementation of :class:`LogRecordProcessor` that forwards all received
    events to a list of log processors in parallel.

    Calls to the underlying log processors are forwarded in parallel by
    submitting them to a thread pool executor and waiting until each log
    processor finished its work.

    Args:
        max_workers: The number of threads managed by the thread pool executor
            and thus defining how many log processors can work in parallel.
    """

    def __init__(self, max_workers: int = 2):
        # use a tuple to avoid race conditions when adding a new log and
        # iterating through it on "emit".
        self._log_record_processors = ()  # type: Tuple[LogRecordProcessor, ...]
        self._lock = threading.Lock()
        self._executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=max_workers
        )

    def add_log_record_processor(
        self, log_record_processor: LogRecordProcessor
    ):
        with self._lock:
            self._log_record_processors += (log_record_processor,)

    def _submit_and_wait(
        self,
        func: Callable[[LogRecordProcessor], Callable[..., None]],
        *args: Any,
        **kwargs: Any,
    ):
        futures = []
        for lp in self._log_record_processors:
            future = self._executor.submit(func(lp), *args, **kwargs)
            futures.append(future)
        for future in futures:
            future.result()

    def on_emit(self, log_data: LogData):
        self._submit_and_wait(lambda lp: lp.on_emit, log_data)

    def shutdown(self):
        self._submit_and_wait(lambda lp: lp.shutdown)

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        """Force flush the log processors in parallel.

        Args:
            timeout_millis: The maximum amount of time to wait for logs to be
                exported.

        Returns:
            True if all the log processors flushes the logs within timeout,
            False otherwise.
        """
        futures = []
        for lp in self._log_record_processors:
            future = self._executor.submit(lp.force_flush, timeout_millis)
            futures.append(future)

        done_futures, not_done_futures = concurrent.futures.wait(
            futures, timeout_millis / 1e3
        )

        if not_done_futures:
            return False

        for future in done_futures:
            if not future.result():
                return False

        return True


# skip natural LogRecord attributes
# http://docs.python.org/library/logging.html#logrecord-attributes
_RESERVED_ATTRS = frozenset(
    (
        "asctime",
        "args",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "getMessage",
        "message",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "thread",
        "threadName",
        "taskName",
    )
)


class LoggingHandler(logging.Handler):
    """A handler class which writes logging records, in OTLP format, to
    a network destination or file. Supports signals from the `logging` module.
    https://docs.python.org/3/library/logging.html
    """

    def __init__(
        self,
        level=logging.NOTSET,
        logger_provider=None,
    ) -> None:
        super().__init__(level=level)
        self._logger_provider = logger_provider or get_logger_provider()

    @staticmethod
    def _get_attributes(record: logging.LogRecord) -> _ExtendedAttributes:
        attributes = {
            k: v for k, v in vars(record).items() if k not in _RESERVED_ATTRS
        }

        # Add standard code attributes for logs.
        attributes[code_attributes.CODE_FILE_PATH] = record.pathname
        attributes[code_attributes.CODE_FUNCTION_NAME] = record.funcName
        attributes[code_attributes.CODE_LINE_NUMBER] = record.lineno

        if record.exc_info:
            exctype, value, tb = record.exc_info
            if exctype is not None:
                attributes[exception_attributes.EXCEPTION_TYPE] = (
                    exctype.__name__
                )
            if value is not None and value.args:
                attributes[exception_attributes.EXCEPTION_MESSAGE] = str(
                    value.args[0]
                )
            if tb is not None:
                # https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-spans/#stacktrace-representation
                attributes[exception_attributes.EXCEPTION_STACKTRACE] = (
                    "".join(traceback.format_exception(*record.exc_info))
                )
        return attributes

    def _translate(self, record: logging.LogRecord) -> LogRecord:
        timestamp = int(record.created * 1e9)
        observered_timestamp = time_ns()
        attributes = self._get_attributes(record)
        severity_number = std_to_otel(record.levelno)
        if self.formatter:
            body = self.format(record)
        else:
            # `record.getMessage()` uses `record.msg` as a template to format
            # `record.args` into. There is a special case in `record.getMessage()`
            # where it will only attempt formatting if args are provided,
            # otherwise, it just stringifies `record.msg`.
            #
            # Since the OTLP body field has a type of 'any' and the logging module
            # is sometimes used in such a way that objects incorrectly end up
            # set as record.msg, in those cases we would like to bypass
            # `record.getMessage()` completely and set the body to the object
            # itself instead of its string representation.
            # For more background, see: https://github.com/open-telemetry/opentelemetry-python/pull/4216
            if not record.args and not isinstance(record.msg, str):
                #  if record.msg is not a value we can export, cast it to string
                if not isinstance(record.msg, _VALID_ANY_VALUE_TYPES):
                    body = str(record.msg)
                else:
                    body = record.msg
            else:
                body = record.getMessage()

        # related to https://github.com/open-telemetry/opentelemetry-python/issues/3548
        # Severity Text = WARN as defined in https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md#displaying-severity.
        level_name = (
            "WARN" if record.levelname == "WARNING" else record.levelname
        )

        logger = get_logger(record.name, logger_provider=self._logger_provider)
        return LogRecord(
            timestamp=timestamp,
            observed_timestamp=observered_timestamp,
            context=get_current() or None,
            severity_text=level_name,
            severity_number=severity_number,
            body=body,
            resource=logger.resource,
            attributes=attributes,
        )

    def emit(self, record: logging.LogRecord) -> None:
        """
        Emit a record. Skip emitting if logger is NoOp.

        The record is translated to OTel format, and then sent across the pipeline.
        """
        logger = get_logger(record.name, logger_provider=self._logger_provider)
        if not isinstance(logger, NoOpLogger):
            logger.emit(self._translate(record))

    def flush(self) -> None:
        """
        Flushes the logging output. Skip flushing if logging_provider has no force_flush method.
        """
        if hasattr(self._logger_provider, "force_flush") and callable(
            self._logger_provider.force_flush
        ):
            self._logger_provider.force_flush()


class Logger(APILogger):
    def __init__(
        self,
        resource: Resource,
        multi_log_record_processor: Union[
            SynchronousMultiLogRecordProcessor,
            ConcurrentMultiLogRecordProcessor,
        ],
        instrumentation_scope: InstrumentationScope,
    ):
        super().__init__(
            instrumentation_scope.name,
            instrumentation_scope.version,
            instrumentation_scope.schema_url,
            instrumentation_scope.attributes,
        )
        self._resource = resource
        self._multi_log_record_processor = multi_log_record_processor
        self._instrumentation_scope = instrumentation_scope

    @property
    def resource(self):
        return self._resource

    def emit(self, record: LogRecord):
        """Emits the :class:`LogData` by associating :class:`LogRecord`
        and instrumentation info.
        """
        log_data = LogData(record, self._instrumentation_scope)
        self._multi_log_record_processor.on_emit(log_data)


class LoggerProvider(APILoggerProvider):
    def __init__(
        self,
        resource: Resource | None = None,
        shutdown_on_exit: bool = True,
        multi_log_record_processor: SynchronousMultiLogRecordProcessor
        | ConcurrentMultiLogRecordProcessor
        | None = None,
    ):
        if resource is None:
            self._resource = Resource.create({})
        else:
            self._resource = resource
        self._multi_log_record_processor = (
            multi_log_record_processor or SynchronousMultiLogRecordProcessor()
        )
        disabled = environ.get(OTEL_SDK_DISABLED, "")
        self._disabled = disabled.lower().strip() == "true"
        self._at_exit_handler = None
        if shutdown_on_exit:
            self._at_exit_handler = atexit.register(self.shutdown)
        self._logger_cache = {}
        self._logger_cache_lock = Lock()

    @property
    def resource(self):
        return self._resource

    def _get_logger_no_cache(
        self,
        name: str,
        version: str | None = None,
        schema_url: str | None = None,
        attributes: _ExtendedAttributes | None = None,
    ) -> Logger:
        return Logger(
            self._resource,
            self._multi_log_record_processor,
            InstrumentationScope(
                name,
                version,
                schema_url,
                attributes,
            ),
        )

    def _get_logger_cached(
        self,
        name: str,
        version: str | None = None,
        schema_url: str | None = None,
    ) -> Logger:
        with self._logger_cache_lock:
            key = (name, version, schema_url)
            if key in self._logger_cache:
                return self._logger_cache[key]

            self._logger_cache[key] = self._get_logger_no_cache(
                name, version, schema_url
            )
            return self._logger_cache[key]

    def get_logger(
        self,
        name: str,
        version: str | None = None,
        schema_url: str | None = None,
        attributes: _ExtendedAttributes | None = None,
    ) -> Logger:
        if self._disabled:
            return NoOpLogger(
                name,
                version=version,
                schema_url=schema_url,
                attributes=attributes,
            )
        if attributes is None:
            return self._get_logger_cached(name, version, schema_url)
        return self._get_logger_no_cache(name, version, schema_url, attributes)

    def add_log_record_processor(
        self, log_record_processor: LogRecordProcessor
    ):
        """Registers a new :class:`LogRecordProcessor` for this `LoggerProvider` instance.

        The log processors are invoked in the same order they are registered.
        """
        self._multi_log_record_processor.add_log_record_processor(
            log_record_processor
        )

    def shutdown(self):
        """Shuts down the log processors."""
        self._multi_log_record_processor.shutdown()
        if self._at_exit_handler is not None:
            atexit.unregister(self._at_exit_handler)
            self._at_exit_handler = None

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        """Force flush the log processors.

        Args:
            timeout_millis: The maximum amount of time to wait for logs to be
                exported.

        Returns:
            True if all the log processors flushes the logs within timeout,
            False otherwise.
        """
        return self._multi_log_record_processor.force_flush(timeout_millis)


_STD_TO_OTEL = {
    10: SeverityNumber.DEBUG,
    11: SeverityNumber.DEBUG2,
    12: SeverityNumber.DEBUG3,
    13: SeverityNumber.DEBUG4,
    14: SeverityNumber.DEBUG4,
    15: SeverityNumber.DEBUG4,
    16: SeverityNumber.DEBUG4,
    17: SeverityNumber.DEBUG4,
    18: SeverityNumber.DEBUG4,
    19: SeverityNumber.DEBUG4,
    20: SeverityNumber.INFO,
    21: SeverityNumber.INFO2,
    22: SeverityNumber.INFO3,
    23: SeverityNumber.INFO4,
    24: SeverityNumber.INFO4,
    25: SeverityNumber.INFO4,
    26: SeverityNumber.INFO4,
    27: SeverityNumber.INFO4,
    28: SeverityNumber.INFO4,
    29: SeverityNumber.INFO4,
    30: SeverityNumber.WARN,
    31: SeverityNumber.WARN2,
    32: SeverityNumber.WARN3,
    33: SeverityNumber.WARN4,
    34: SeverityNumber.WARN4,
    35: SeverityNumber.WARN4,
    36: SeverityNumber.WARN4,
    37: SeverityNumber.WARN4,
    38: SeverityNumber.WARN4,
    39: SeverityNumber.WARN4,
    40: SeverityNumber.ERROR,
    41: SeverityNumber.ERROR2,
    42: SeverityNumber.ERROR3,
    43: SeverityNumber.ERROR4,
    44: SeverityNumber.ERROR4,
    45: SeverityNumber.ERROR4,
    46: SeverityNumber.ERROR4,
    47: SeverityNumber.ERROR4,
    48: SeverityNumber.ERROR4,
    49: SeverityNumber.ERROR4,
    50: SeverityNumber.FATAL,
    51: SeverityNumber.FATAL2,
    52: SeverityNumber.FATAL3,
    53: SeverityNumber.FATAL4,
}


def std_to_otel(levelno: int) -> SeverityNumber:
    """
    Map python log levelno as defined in https://docs.python.org/3/library/logging.html#logging-levels
    to OTel log severity number as defined here: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md#field-severitynumber
    """
    if levelno < 10:
        return SeverityNumber.UNSPECIFIED
    if levelno > 53:
        return SeverityNumber.FATAL4
    return _STD_TO_OTEL[levelno]
