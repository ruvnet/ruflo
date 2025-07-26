import abc
import logging
import re
import types as python_types
import typing
import warnings

from opentelemetry.trace.status import Status, StatusCode
from opentelemetry.util import types

# The key MUST begin with a lowercase letter or a digit,
# and can only contain lowercase letters (a-z), digits (0-9),
# underscores (_), dashes (-), asterisks (*), and forward slashes (/).
# For multi-tenant vendor scenarios, an at sign (@) can be used to
# prefix the vendor name. Vendors SHOULD set the tenant ID
# at the beginning of the key.

# key = ( lcalpha ) 0*255( lcalpha / DIGIT / "_" / "-"/ "*" / "/" )
# key = ( lcalpha / DIGIT ) 0*240( lcalpha / DIGIT / "_" / "-"/ "*" / "/" ) "@" lcalpha 0*13( lcalpha / DIGIT / "_" / "-"/ "*" / "/" )
# lcalpha = %x61-7A ; a-z

_KEY_FORMAT = (
    r"[a-z][_0-9a-z\-\*\/]{0,255}|"
    r"[a-z0-9][_0-9a-z\-\*\/]{0,240}@[a-z][_0-9a-z\-\*\/]{0,13}"
)
_KEY_PATTERN = re.compile(_KEY_FORMAT)

# The value is an opaque string containing up to 256 printable
# ASCII [RFC0020] characters (i.e., the range 0x20 to 0x7E)
# except comma (,) and (=).
# value    = 0*255(chr) nblk-chr
# nblk-chr = %x21-2B / %x2D-3C / %x3E-7E
# chr      = %x20 / nblk-chr

_VALUE_FORMAT = (
    r"[\x20-\x2b\x2d-\x3c\x3e-\x7e]{0,255}[\x21-\x2b\x2d-\x3c\x3e-\x7e]"
)
_VALUE_PATTERN = re.compile(_VALUE_FORMAT)


_TRACECONTEXT_MAXIMUM_TRACESTATE_KEYS = 32
_delimiter_pattern = re.compile(r"[ \t]*,[ \t]*")
_member_pattern = re.compile(f"({_KEY_FORMAT})(=)({_VALUE_FORMAT})[ \t]*")
_logger = logging.getLogger(__name__)


def _is_valid_pair(key: str, value: str) -> bool:
    return (
        isinstance(key, str)
        and _KEY_PATTERN.fullmatch(key) is not None
        and isinstance(value, str)
        and _VALUE_PATTERN.fullmatch(value) is not None
    )


class Span(abc.ABC):
    """A span represents a single operation within a trace."""

    @abc.abstractmethod
    def end(self, end_time: typing.Optional[int] = None) -> None:
        """Sets the current time as the span's end time.

        The span's end time is the wall time at which the operation finished.

        Only the first call to `end` should modify the span, and
        implementations are free to ignore or raise on further calls.
        """

    @abc.abstractmethod
    def get_span_context(self) -> "SpanContext":
        """Gets the span's SpanContext.

        Get an immutable, serializable identifier for this span that can be
        used to create new child spans.

        Returns:
            A :class:`opentelemetry.trace.SpanContext` with a copy of this span's immutable state.
        """

    @abc.abstractmethod
    def set_attributes(
        self, attributes: typing.Mapping[str, types.AttributeValue]
    ) -> None:
        """Sets Attributes.

        Sets Attributes with the key and value passed as arguments dict.

        Note: The behavior of `None` value attributes is undefined, and hence
        strongly discouraged. It is also preferred to set attributes at span
        creation, instead of calling this method later since samplers can only
        consider information already present during span creation.
        """

    @abc.abstractmethod
    def set_attribute(self, key: str, value: types.AttributeValue) -> None:
        """Sets an Attribute.

        Sets a single Attribute with the key and value passed as arguments.

        Note: The behavior of `None` value attributes is undefined, and hence
        strongly discouraged. It is also preferred to set attributes at span
        creation, instead of calling this method later since samplers can only
        consider information already present during span creation.
        """

    @abc.abstractmethod
    def add_event(
        self,
        name: str,
        attributes: types.Attributes = None,
        timestamp: typing.Optional[int] = None,
    ) -> None:
        """Adds an `Event`.

        Adds a single `Event` with the name and, optionally, a timestamp and
        attributes passed as arguments. Implementations should generate a
        timestamp if the `timestamp` argument is omitted.
        """

    def add_link(  # pylint: disable=no-self-use
        self,
        context: "SpanContext",
        attributes: types.Attributes = None,
    ) -> None:
        """Adds a `Link`.

        Adds a single `Link` with the `SpanContext` of the span to link to and,
        optionally, attributes passed as arguments. Implementations may ignore
        calls with an invalid span context if both attributes and TraceState
        are empty.

        Note: It is preferred to add links at span creation, instead of calling
        this method later since samplers can only consider information already
        present during span creation.
        """
        warnings.warn(
            "Span.add_link() not implemented and will be a no-op. "
            "Use opentelemetry-sdk >= 1.23 to add links after span creation"
        )

    @abc.abstractmethod
    def update_name(self, name: str) -> None:
        """Updates the `Span` name.

        This will override the name provided via :func:`opentelemetry.trace.Tracer.start_span`.

        Upon this update, any sampling behavior based on Span name will depend
        on the implementation.
        """

    @abc.abstractmethod
    def is_recording(self) -> bool:
        """Returns whether this span will be recorded.

        Returns true if this Span is active and recording information like
        events with the add_event operation and attributes using set_attribute.
        """

    @abc.abstractmethod
    def set_status(
        self,
        status: typing.Union[Status, StatusCode],
        description: typing.Optional[str] = None,
    ) -> None:
        """Sets the Status of the Span. If used, this will override the default
        Span status.
        """

    @abc.abstractmethod
    def record_exception(
        self,
        exception: BaseException,
        attributes: types.Attributes = None,
        timestamp: typing.Optional[int] = None,
        escaped: bool = False,
    ) -> None:
        """Records an exception as a span event."""

    def __enter__(self) -> "Span":
        """Invoked when `Span` is used as a context manager.

        Returns the `Span` itself.
        """
        return self

    def __exit__(
        self,
        exc_type: typing.Optional[typing.Type[BaseException]],
        exc_val: typing.Optional[BaseException],
        exc_tb: typing.Optional[python_types.TracebackType],
    ) -> None:
        """Ends context manager and calls `end` on the `Span`."""

        self.end()


class TraceFlags(int):
    """A bitmask that represents options specific to the trace.

    The only supported option is the "sampled" flag (``0x01``). If set, this
    flag indicates that the trace may have been sampled upstream.

    See the `W3C Trace Context - Traceparent`_ spec for details.

    .. _W3C Trace Context - Traceparent:
        https://www.w3.org/TR/trace-context/#trace-flags
    """

    DEFAULT = 0x00
    SAMPLED = 0x01

    @classmethod
    def get_default(cls) -> "TraceFlags":
        return cls(cls.DEFAULT)

    @property
    def sampled(self) -> bool:
        return bool(self & TraceFlags.SAMPLED)


DEFAULT_TRACE_OPTIONS = TraceFlags.get_default()


class TraceState(typing.Mapping[str, str]):
    """A list of key-value pairs representing vendor-specific trace info.

    Keys and values are strings of up to 256 printable US-ASCII characters.
    Implementations should conform to the `W3C Trace Context - Tracestate`_
    spec, which describes additional restrictions on valid field values.

    .. _W3C Trace Context - Tracestate:
        https://www.w3.org/TR/trace-context/#tracestate-field
    """

    def __init__(
        self,
        entries: typing.Optional[
            typing.Sequence[typing.Tuple[str, str]]
        ] = None,
    ) -> None:
        self._dict = {}  # type: dict[str, str]
        if entries is None:
            return
        if len(entries) > _TRACECONTEXT_MAXIMUM_TRACESTATE_KEYS:
            _logger.warning(
                "There can't be more than %s key/value pairs.",
                _TRACECONTEXT_MAXIMUM_TRACESTATE_KEYS,
            )
            return

        for key, value in entries:
            if _is_valid_pair(key, value):
                if key in self._dict:
                    _logger.warning("Duplicate key: %s found.", key)
                    continue
                self._dict[key] = value
            else:
                _logger.warning(
                    "Invalid key/value pair (%s, %s) found.", key, value
                )

    def __contains__(self, item: object) -> bool:
        return item in self._dict

    def __getitem__(self, key: str) -> str:
        return self._dict[key]

    def __iter__(self) -> typing.Iterator[str]:
        return iter(self._dict)

    def __len__(self) -> int:
        return len(self._dict)

    def __repr__(self) -> str:
        pairs = [
            f"{{key={key}, value={value}}}"
            for key, value in self._dict.items()
        ]
        return str(pairs)

    def add(self, key: str, value: str) -> "TraceState":
        """Adds a key-value pair to tracestate. The provided pair should
        adhere to w3c tracestate identifiers format.

        Args:
            key: A valid tracestate key to add
            value: A valid tracestate value to add

        Returns:
            A new TraceState with the modifications applied.

            If the provided key-value pair is invalid or results in tracestate
            that violates tracecontext specification, they are discarded and
            same tracestate will be returned.
        """
        if not _is_valid_pair(key, value):
            _logger.warning(
                "Invalid key/value pair (%s, %s) found.", key, value
            )
            return self
        # There can be a maximum of 32 pairs
        if len(self) >= _TRACECONTEXT_MAXIMUM_TRACESTATE_KEYS:
            _logger.warning("There can't be more 32 key/value pairs.")
            return self
        # Duplicate entries are not allowed
        if key in self._dict:
            _logger.warning("The provided key %s already exists.", key)
            return self
        new_state = [(key, value)] + list(self._dict.items())
        return TraceState(new_state)

    def update(self, key: str, value: str) -> "TraceState":
        """Updates a key-value pair in tracestate. The provided pair should
        adhere to w3c tracestate identifiers format.

        Args:
            key: A valid tracestate key to update
            value: A valid tracestate value to update for key

        Returns:
            A new TraceState with the modifications applied.

            If the provided key-value pair is invalid or results in tracestate
            that violates tracecontext specification, they are discarded and
            same tracestate will be returned.
        """
        if not _is_valid_pair(key, value):
            _logger.warning(
                "Invalid key/value pair (%s, %s) found.", key, value
            )
            return self
        prev_state = self._dict.copy()
        prev_state.pop(key, None)
        new_state = [(key, value), *prev_state.items()]
        return TraceState(new_state)

    def delete(self, key: str) -> "TraceState":
        """Deletes a key-value from tracestate.

        Args:
            key: A valid tracestate key to remove key-value pair from tracestate

        Returns:
            A new TraceState with the modifications applied.

            If the provided key-value pair is invalid or results in tracestate
            that violates tracecontext specification, they are discarded and
            same tracestate will be returned.
        """
        if key not in self._dict:
            _logger.warning("The provided key %s doesn't exist.", key)
            return self
        prev_state = self._dict.copy()
        prev_state.pop(key)
        new_state = list(prev_state.items())
        return TraceState(new_state)

    def to_header(self) -> str:
        """Creates a w3c tracestate header from a TraceState.

        Returns:
            A string that adheres to the w3c tracestate
            header format.
        """
        return ",".join(key + "=" + value for key, value in self._dict.items())

    @classmethod
    def from_header(cls, header_list: typing.List[str]) -> "TraceState":
        """Parses one or more w3c tracestate header into a TraceState.

        Args:
            header_list: one or more w3c tracestate headers.

        Returns:
            A valid TraceState that contains values extracted from
            the tracestate header.

            If the format of one headers is illegal, all values will
            be discarded and an empty tracestate will be returned.

            If the number of keys is beyond the maximum, all values
            will be discarded and an empty tracestate will be returned.
        """
        pairs = {}  # type: dict[str, str]
        for header in header_list:
            members: typing.List[str] = re.split(_delimiter_pattern, header)
            for member in members:
                # empty members are valid, but no need to process further.
                if not member:
                    continue
                match = _member_pattern.fullmatch(member)
                if not match:
                    _logger.warning(
                        "Member doesn't match the w3c identifiers format %s",
                        member,
                    )
                    return cls()
                groups: typing.Tuple[str, ...] = match.groups()
                key, _eq, value = groups
                # duplicate keys are not legal in header
                if key in pairs:
                    return cls()
                pairs[key] = value
        return cls(list(pairs.items()))

    @classmethod
    def get_default(cls) -> "TraceState":
        return cls()

    def keys(self) -> typing.KeysView[str]:
        return self._dict.keys()

    def items(self) -> typing.ItemsView[str, str]:
        return self._dict.items()

    def values(self) -> typing.ValuesView[str]:
        return self._dict.values()


DEFAULT_TRACE_STATE = TraceState.get_default()
_TRACE_ID_MAX_VALUE = 2**128 - 1
_SPAN_ID_MAX_VALUE = 2**64 - 1


class SpanContext(
    typing.Tuple[int, int, bool, "TraceFlags", "TraceState", bool]
):
    """The state of a Span to propagate between processes.

    This class includes the immutable attributes of a :class:`.Span` that must
    be propagated to a span's children and across process boundaries.

    Args:
        trace_id: The ID of the trace that this span belongs to.
        span_id: This span's ID.
        is_remote: True if propagated from a remote parent.
        trace_flags: Trace options to propagate.
        trace_state: Tracing-system-specific info to propagate.
    """

    def __new__(
        cls,
        trace_id: int,
        span_id: int,
        is_remote: bool,
        trace_flags: typing.Optional["TraceFlags"] = DEFAULT_TRACE_OPTIONS,
        trace_state: typing.Optional["TraceState"] = DEFAULT_TRACE_STATE,
    ) -> "SpanContext":
        if trace_flags is None:
            trace_flags = DEFAULT_TRACE_OPTIONS
        if trace_state is None:
            trace_state = DEFAULT_TRACE_STATE

        is_valid = (
            INVALID_TRACE_ID < trace_id <= _TRACE_ID_MAX_VALUE
            and INVALID_SPAN_ID < span_id <= _SPAN_ID_MAX_VALUE
        )

        return tuple.__new__(
            cls,
            (trace_id, span_id, is_remote, trace_flags, trace_state, is_valid),
        )

    def __getnewargs__(
        self,
    ) -> typing.Tuple[int, int, bool, "TraceFlags", "TraceState"]:
        return (
            self.trace_id,
            self.span_id,
            self.is_remote,
            self.trace_flags,
            self.trace_state,
        )

    @property
    def trace_id(self) -> int:
        return self[0]  # pylint: disable=unsubscriptable-object

    @property
    def span_id(self) -> int:
        return self[1]  # pylint: disable=unsubscriptable-object

    @property
    def is_remote(self) -> bool:
        return self[2]  # pylint: disable=unsubscriptable-object

    @property
    def trace_flags(self) -> "TraceFlags":
        return self[3]  # pylint: disable=unsubscriptable-object

    @property
    def trace_state(self) -> "TraceState":
        return self[4]  # pylint: disable=unsubscriptable-object

    @property
    def is_valid(self) -> bool:
        return self[5]  # pylint: disable=unsubscriptable-object

    def __setattr__(self, *args: str) -> None:
        _logger.debug(
            "Immutable type, ignoring call to set attribute", stack_info=True
        )

    def __delattr__(self, *args: str) -> None:
        _logger.debug(
            "Immutable type, ignoring call to set attribute", stack_info=True
        )

    def __repr__(self) -> str:
        return f"{type(self).__name__}(trace_id=0x{format_trace_id(self.trace_id)}, span_id=0x{format_span_id(self.span_id)}, trace_flags=0x{self.trace_flags:02x}, trace_state={self.trace_state!r}, is_remote={self.is_remote})"


class NonRecordingSpan(Span):
    """The Span that is used when no Span implementation is available.

    All operations are no-op except context propagation.
    """

    def __init__(self, context: "SpanContext") -> None:
        self._context = context

    def get_span_context(self) -> "SpanContext":
        return self._context

    def is_recording(self) -> bool:
        return False

    def end(self, end_time: typing.Optional[int] = None) -> None:
        pass

    def set_attributes(
        self, attributes: typing.Mapping[str, types.AttributeValue]
    ) -> None:
        pass

    def set_attribute(self, key: str, value: types.AttributeValue) -> None:
        pass

    def add_event(
        self,
        name: str,
        attributes: types.Attributes = None,
        timestamp: typing.Optional[int] = None,
    ) -> None:
        pass

    def add_link(
        self,
        context: "SpanContext",
        attributes: types.Attributes = None,
    ) -> None:
        pass

    def update_name(self, name: str) -> None:
        pass

    def set_status(
        self,
        status: typing.Union[Status, StatusCode],
        description: typing.Optional[str] = None,
    ) -> None:
        pass

    def record_exception(
        self,
        exception: BaseException,
        attributes: types.Attributes = None,
        timestamp: typing.Optional[int] = None,
        escaped: bool = False,
    ) -> None:
        pass

    def __repr__(self) -> str:
        return f"NonRecordingSpan({self._context!r})"


INVALID_SPAN_ID = 0x0000000000000000
INVALID_TRACE_ID = 0x00000000000000000000000000000000
INVALID_SPAN_CONTEXT = SpanContext(
    trace_id=INVALID_TRACE_ID,
    span_id=INVALID_SPAN_ID,
    is_remote=False,
    trace_flags=DEFAULT_TRACE_OPTIONS,
    trace_state=DEFAULT_TRACE_STATE,
)
INVALID_SPAN = NonRecordingSpan(INVALID_SPAN_CONTEXT)


def format_trace_id(trace_id: int) -> str:
    """Convenience trace ID formatting method
    Args:
        trace_id: Trace ID int

    Returns:
        The trace ID (16 bytes) cast to a 32-character hexadecimal string
    """
    return format(trace_id, "032x")


def format_span_id(span_id: int) -> str:
    """Convenience span ID formatting method
    Args:
        span_id: Span ID int

    Returns:
        The span ID (8 bytes) cast to a 16-character hexadecimal string
    """
    return format(span_id, "016x")
