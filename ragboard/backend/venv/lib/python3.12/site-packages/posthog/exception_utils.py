# Portions of this file are derived from getsentry/sentry-javascript by Software, Inc. dba Sentry
# Licensed under the MIT License

# copied and adapted from https://github.com/getsentry/sentry-python/blob/269d96d6e9821122fbff280e6a26956e5ed03c0b/sentry_sdk/utils.py#L689
# 💖open source (under MIT License)
# We want to keep payloads as similar to Sentry as possible for easy interoperability

import linecache
import os
import re
import sys
import types
from datetime import datetime
from typing import TYPE_CHECKING

try:
    # Python 3.11
    from builtins import BaseExceptionGroup
except ImportError:
    # Python 3.10 and below
    BaseExceptionGroup = None  # type: ignore


DEFAULT_MAX_VALUE_LENGTH = 1024


if TYPE_CHECKING:
    from types import FrameType, TracebackType
    from typing import (  # noqa: F401
        Any,
        Callable,
        Dict,
        Iterator,
        List,
        Literal,
        Optional,
        Set,
        Tuple,
        Type,
        TypedDict,
        TypeVar,
        Union,
        cast,
    )

    ExcInfo = Union[
        Tuple[Type[BaseException], BaseException, Optional[TracebackType]],
        Tuple[None, None, None],
    ]
    LogLevelStr = Literal["fatal", "critical", "error", "warning", "info", "debug"]

    Event = TypedDict(
        "Event",
        {
            "breadcrumbs": Dict[
                Literal["values"], List[Dict[str, Any]]
            ],  # TODO: We can expand on this type
            "check_in_id": str,
            "contexts": Dict[str, Dict[str, object]],
            "dist": str,
            "duration": Optional[float],
            "environment": str,
            "errors": List[Dict[str, Any]],  # TODO: We can expand on this type
            "event_id": str,
            "exception": Dict[
                Literal["values"], List[Dict[str, Any]]
            ],  # TODO: We can expand on this type
            # "extra": MutableMapping[str, object],
            # "fingerprint": List[str],
            "level": LogLevelStr,
            # "logentry": Mapping[str, object],
            "logger": str,
            # "measurements": Dict[str, MeasurementValue],
            "message": str,
            "modules": Dict[str, str],
            # "monitor_config": Mapping[str, object],
            "monitor_slug": Optional[str],
            "platform": Literal["python"],
            "profile": object,
            "release": str,
            "request": Dict[str, object],
            # "sdk": Mapping[str, object],
            "server_name": str,
            "spans": List[Dict[str, object]],
            "stacktrace": Dict[
                str, object
            ],  # We access this key in the code, but I am unsure whether we ever set it
            "start_timestamp": datetime,
            "status": Optional[str],
            # "tags": MutableMapping[
            #     str, str
            # ],  # Tags must be less than 200 characters each
            "threads": Dict[
                Literal["values"], List[Dict[str, Any]]
            ],  # TODO: We can expand on this type
            "timestamp": Optional[datetime],  # Must be set before sending the event
            "transaction": str,
            # "transaction_info": Mapping[str, Any],  # TODO: We can expand on this type
            "type": Literal["check_in", "transaction"],
            "user": Dict[str, object],
            "_metrics_summary": Dict[str, object],
        },
        total=False,
    )


epoch = datetime(1970, 1, 1)


BASE64_ALPHABET = re.compile(r"^[a-zA-Z0-9/+=]*$")

SENSITIVE_DATA_SUBSTITUTE = "[Filtered]"


def to_timestamp(value):
    # type: (datetime) -> float
    return (value - epoch).total_seconds()


def format_timestamp(value):
    # type: (datetime) -> str
    return value.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def event_hint_with_exc_info(exc_info=None):
    # type: (Optional[ExcInfo]) -> Dict[str, Optional[ExcInfo]]
    """Creates a hint with the exc info filled in."""
    if exc_info is None:
        exc_info = sys.exc_info()
    else:
        exc_info = exc_info_from_error(exc_info)
    if exc_info[0] is None:
        exc_info = None
    return {"exc_info": exc_info}


class AnnotatedValue:
    """
    Meta information for a data field in the event payload.
    """

    __slots__ = ("value", "metadata")

    def __init__(self, value, metadata):
        # type: (Optional[Any], Dict[str, Any]) -> None
        self.value = value
        self.metadata = metadata

    def __eq__(self, other):
        # type: (Any) -> bool
        if not isinstance(other, AnnotatedValue):
            return False

        return self.value == other.value and self.metadata == other.metadata

    @classmethod
    def removed_because_raw_data(cls):
        # type: () -> AnnotatedValue
        """The value was removed because it could not be parsed. This is done for request body values that are not json nor a form."""
        return AnnotatedValue(
            value="",
            metadata={
                "rem": [  # Remark
                    [
                        "!raw",  # Unparsable raw data
                        "x",  # The fields original value was removed
                    ]
                ]
            },
        )

    @classmethod
    def removed_because_over_size_limit(cls):
        # type: () -> AnnotatedValue
        """The actual value was removed because the size of the field exceeded the configured maximum size (specified with the max_request_body_size sdk option)"""
        return AnnotatedValue(
            value="",
            metadata={
                "rem": [  # Remark
                    [
                        "!config",  # Because of configured maximum size
                        "x",  # The fields original value was removed
                    ]
                ]
            },
        )

    @classmethod
    def substituted_because_contains_sensitive_data(cls):
        # type: () -> AnnotatedValue
        """The actual value was removed because it contained sensitive information."""
        return AnnotatedValue(
            value=SENSITIVE_DATA_SUBSTITUTE,
            metadata={
                "rem": [  # Remark
                    [
                        "!config",  # Because of SDK configuration (in this case the config is the hard coded removal of certain django cookies)
                        "s",  # The fields original value was substituted
                    ]
                ]
            },
        )


if TYPE_CHECKING:
    T = TypeVar("T")
    Annotated = Union[AnnotatedValue, T]


def get_type_name(cls):
    # type: (Optional[type]) -> Optional[str]
    return getattr(cls, "__qualname__", None) or getattr(cls, "__name__", None)


def get_type_module(cls):
    # type: (Optional[type]) -> Optional[str]
    mod = getattr(cls, "__module__", None)
    if mod not in (None, "builtins", "__builtins__"):
        return mod
    return None


def should_hide_frame(frame: "FrameType") -> bool:
    try:
        mod = frame.f_globals["__name__"]
        if mod.startswith("sentry_sdk."):
            return True
    except (AttributeError, KeyError):
        pass

    for flag_name in "__traceback_hide__", "__tracebackhide__":
        try:
            if frame.f_locals[flag_name]:
                return True
        except Exception:
            pass

    return False


def iter_stacks(tb):
    # type: (Optional[TracebackType]) -> Iterator[TracebackType]
    tb_ = tb  # type: Optional[TracebackType]
    while tb_ is not None:
        if not should_hide_frame(tb_.tb_frame):
            yield tb_
        tb_ = tb_.tb_next


def get_lines_from_file(
    filename,  # type: str
    lineno,  # type: int
    max_length=None,  # type: Optional[int]
    loader=None,  # type: Optional[Any]
    module=None,  # type: Optional[str]
):
    # type: (...) -> Tuple[List[Annotated[str]], Optional[Annotated[str]], List[Annotated[str]]]
    context_lines = 5
    source = None
    if loader is not None and hasattr(loader, "get_source"):
        try:
            source_str = loader.get_source(module)  # type: Optional[str]
        except (ImportError, IOError):
            source_str = None
        if source_str is not None:
            source = source_str.splitlines()

    if source is None:
        try:
            source = linecache.getlines(filename)
        except (OSError, IOError):
            return [], None, []

    if not source:
        return [], None, []

    lower_bound = max(0, lineno - context_lines)
    upper_bound = min(lineno + 1 + context_lines, len(source))

    try:
        pre_context = [
            strip_string(line.strip("\r\n"), max_length=max_length)
            for line in source[lower_bound:lineno]
        ]
        context_line = strip_string(source[lineno].strip("\r\n"), max_length=max_length)
        post_context = [
            strip_string(line.strip("\r\n"), max_length=max_length)
            for line in source[(lineno + 1) : upper_bound]  # noqa: E203
        ]
        return pre_context, context_line, post_context
    except IndexError:
        # the file may have changed since it was loaded into memory
        return [], None, []


def get_source_context(
    frame,  # type: FrameType
    tb_lineno,  # type: int
    max_value_length=None,  # type: Optional[int]
):
    # type: (...) -> Tuple[List[Annotated[str]], Optional[Annotated[str]], List[Annotated[str]]]
    try:
        abs_path = frame.f_code.co_filename  # type: Optional[str]
    except Exception:
        abs_path = None
    try:
        module = frame.f_globals["__name__"]
    except Exception:
        return [], None, []
    try:
        loader = frame.f_globals["__loader__"]
    except Exception:
        loader = None
    lineno = tb_lineno - 1
    if lineno is not None and abs_path:
        return get_lines_from_file(
            abs_path, lineno, max_value_length, loader=loader, module=module
        )
    return [], None, []


def safe_str(value):
    # type: (Any) -> str
    try:
        return str(value)
    except Exception:
        return safe_repr(value)


def safe_repr(value):
    # type: (Any) -> str
    try:
        return repr(value)
    except Exception:
        return "<broken repr>"


def filename_for_module(module, abs_path):
    # type: (Optional[str], Optional[str]) -> Optional[str]
    if not abs_path or not module:
        return abs_path

    try:
        if abs_path.endswith(".pyc"):
            abs_path = abs_path[:-1]

        base_module = module.split(".", 1)[0]
        if base_module == module:
            return os.path.basename(abs_path)

        base_module_path = sys.modules[base_module].__file__
        if not base_module_path:
            return abs_path

        return abs_path.split(base_module_path.rsplit(os.sep, 2)[0], 1)[-1].lstrip(
            os.sep
        )
    except Exception:
        return abs_path


def serialize_frame(
    frame,
    tb_lineno=None,
    include_local_variables=True,
    include_source_context=True,
    max_value_length=None,
    custom_repr=None,
):
    # type: (FrameType, Optional[int], bool, bool, Optional[int], Optional[Callable[..., Optional[str]]]) -> Dict[str, Any]
    f_code = getattr(frame, "f_code", None)
    if not f_code:
        abs_path = None
        function = None
    else:
        abs_path = frame.f_code.co_filename
        function = frame.f_code.co_name
    try:
        module = frame.f_globals["__name__"]
    except Exception:
        module = None

    if tb_lineno is None:
        tb_lineno = frame.f_lineno

    rv = {
        "platform": "python",
        "filename": filename_for_module(module, abs_path) or None,
        "abs_path": os.path.abspath(abs_path) if abs_path else None,
        "function": function or "<unknown>",
        "module": module,
        "lineno": tb_lineno,
    }  # type: Dict[str, Any]

    if include_source_context:
        rv["pre_context"], rv["context_line"], rv["post_context"] = get_source_context(
            frame, tb_lineno, max_value_length
        )

    if include_local_variables:
        # TODO - we don't support local variables, yet
        pass

    return rv


def current_stacktrace(
    include_local_variables=True,  # type: bool
    include_source_context=True,  # type: bool
    max_value_length=None,  # type: Optional[int]
):
    # type: (...) -> Dict[str, Any]
    __tracebackhide__ = True
    frames = []

    f = sys._getframe()  # type: Optional[FrameType]
    while f is not None:
        if not should_hide_frame(f):
            frames.append(
                serialize_frame(
                    f,
                    include_local_variables=include_local_variables,
                    include_source_context=include_source_context,
                    max_value_length=max_value_length,
                )
            )
        f = f.f_back

    frames.reverse()

    return {"frames": frames, "type": "raw"}


def get_errno(exc_value):
    # type: (BaseException) -> Optional[Any]
    return getattr(exc_value, "errno", None)


def get_error_message(exc_value):
    # type: (Optional[BaseException]) -> str
    message = (
        getattr(exc_value, "message", "")
        or getattr(exc_value, "detail", "")
        or exc_value
    )

    return safe_str(message)


def single_exception_from_error_tuple(
    exc_type,  # type: Optional[type]
    exc_value,  # type: Optional[BaseException]
    tb,  # type: Optional[TracebackType]
    client_options=None,  # type: Optional[Dict[str, Any]]
    mechanism=None,  # type: Optional[Dict[str, Any]]
    exception_id=None,  # type: Optional[int]
    parent_id=None,  # type: Optional[int]
    source=None,  # type: Optional[str]
):
    # type: (...) -> Dict[str, Any]
    """
    Creates a dict that goes into the events `exception.values` list
    """
    exception_value = {}  # type: Dict[str, Any]
    exception_value["mechanism"] = (
        mechanism.copy() if mechanism else {"type": "generic", "handled": True}
    )
    if exception_id is not None:
        exception_value["mechanism"]["exception_id"] = exception_id

    if exc_value is not None:
        errno = get_errno(exc_value)
    else:
        errno = None

    if errno is not None:
        exception_value["mechanism"].setdefault("meta", {}).setdefault(
            "errno", {}
        ).setdefault("number", errno)

    if source is not None:
        exception_value["mechanism"]["source"] = source

    is_root_exception = exception_id == 0
    if not is_root_exception and parent_id is not None:
        exception_value["mechanism"]["parent_id"] = parent_id
        exception_value["mechanism"]["type"] = "chained"

    if is_root_exception and "type" not in exception_value["mechanism"]:
        exception_value["mechanism"]["type"] = "generic"

    is_exception_group = BaseExceptionGroup is not None and isinstance(
        exc_value, BaseExceptionGroup
    )
    if is_exception_group:
        exception_value["mechanism"]["is_exception_group"] = True

    exception_value["module"] = get_type_module(exc_type)
    exception_value["type"] = get_type_name(exc_type)
    exception_value["value"] = get_error_message(exc_value)

    if client_options is None:
        include_local_variables = True
        include_source_context = True
        max_value_length = DEFAULT_MAX_VALUE_LENGTH  # fallback
        custom_repr = None
    else:
        include_local_variables = client_options["include_local_variables"]
        include_source_context = client_options["include_source_context"]
        max_value_length = client_options["max_value_length"]
        custom_repr = client_options.get("custom_repr")

    frames = [
        serialize_frame(
            tb.tb_frame,
            tb_lineno=tb.tb_lineno,
            include_local_variables=include_local_variables,
            include_source_context=include_source_context,
            max_value_length=max_value_length,
            custom_repr=custom_repr,
        )
        for tb in iter_stacks(tb)
    ]

    if frames:
        exception_value["stacktrace"] = {"frames": frames, "type": "raw"}

    return exception_value


HAS_CHAINED_EXCEPTIONS = hasattr(Exception, "__suppress_context__")

if HAS_CHAINED_EXCEPTIONS:

    def walk_exception_chain(exc_info):
        # type: (ExcInfo) -> Iterator[ExcInfo]
        exc_type, exc_value, tb = exc_info

        seen_exceptions = []
        seen_exception_ids = set()  # type: Set[int]

        while (
            exc_type is not None
            and exc_value is not None
            and id(exc_value) not in seen_exception_ids
        ):
            yield exc_type, exc_value, tb

            # Avoid hashing random types we don't know anything
            # about. Use the list to keep a ref so that the `id` is
            # not used for another object.
            seen_exceptions.append(exc_value)
            seen_exception_ids.add(id(exc_value))

            if exc_value.__suppress_context__:
                cause = exc_value.__cause__
            else:
                cause = exc_value.__context__
            if cause is None:
                break
            exc_type = type(cause)
            exc_value = cause
            tb = getattr(cause, "__traceback__", None)

else:

    def walk_exception_chain(exc_info):
        # type: (ExcInfo) -> Iterator[ExcInfo]
        yield exc_info


def exceptions_from_error(
    exc_type,  # type: Optional[type]
    exc_value,  # type: Optional[BaseException]
    tb,  # type: Optional[TracebackType]
    client_options=None,  # type: Optional[Dict[str, Any]]
    mechanism=None,  # type: Optional[Dict[str, Any]]
    exception_id=0,  # type: int
    parent_id=0,  # type: int
    source=None,  # type: Optional[str]
):
    # type: (...) -> Tuple[int, List[Dict[str, Any]]]
    """
    Creates the list of exceptions.
    This can include chained exceptions and exceptions from an ExceptionGroup.
    """

    parent = single_exception_from_error_tuple(
        exc_type=exc_type,
        exc_value=exc_value,
        tb=tb,
        client_options=client_options,
        mechanism=mechanism,
        exception_id=exception_id,
        parent_id=parent_id,
        source=source,
    )
    exceptions = [parent]

    parent_id = exception_id
    exception_id += 1

    should_supress_context = (
        hasattr(exc_value, "__suppress_context__") and exc_value.__suppress_context__  # type: ignore
    )
    if should_supress_context:
        # Add direct cause.
        # The field `__cause__` is set when raised with the exception (using the `from` keyword).
        exception_has_cause = (
            exc_value
            and hasattr(exc_value, "__cause__")
            and exc_value.__cause__ is not None
        )
        if exception_has_cause:
            cause = exc_value.__cause__  # type: ignore
            (exception_id, child_exceptions) = exceptions_from_error(
                exc_type=type(cause),
                exc_value=cause,
                tb=getattr(cause, "__traceback__", None),
                client_options=client_options,
                mechanism=mechanism,
                exception_id=exception_id,
                source="__cause__",
            )
            exceptions.extend(child_exceptions)

    else:
        # Add indirect cause.
        # The field `__context__` is assigned if another exception occurs while handling the exception.
        exception_has_content = (
            exc_value
            and hasattr(exc_value, "__context__")
            and exc_value.__context__ is not None
        )
        if exception_has_content:
            context = exc_value.__context__  # type: ignore
            (exception_id, child_exceptions) = exceptions_from_error(
                exc_type=type(context),
                exc_value=context,
                tb=getattr(context, "__traceback__", None),
                client_options=client_options,
                mechanism=mechanism,
                exception_id=exception_id,
                source="__context__",
            )
            exceptions.extend(child_exceptions)

    # Add exceptions from an ExceptionGroup.
    is_exception_group = exc_value and hasattr(exc_value, "exceptions")
    if is_exception_group:
        for idx, e in enumerate(exc_value.exceptions):  # type: ignore
            (exception_id, child_exceptions) = exceptions_from_error(
                exc_type=type(e),
                exc_value=e,
                tb=getattr(e, "__traceback__", None),
                client_options=client_options,
                mechanism=mechanism,
                exception_id=exception_id,
                parent_id=parent_id,
                source="exceptions[%s]" % idx,
            )
            exceptions.extend(child_exceptions)

    return (exception_id, exceptions)


def exceptions_from_error_tuple(
    exc_info,  # type: ExcInfo
    client_options=None,  # type: Optional[Dict[str, Any]]
    mechanism=None,  # type: Optional[Dict[str, Any]]
):
    # type: (...) -> List[Dict[str, Any]]
    exc_type, exc_value, tb = exc_info

    is_exception_group = BaseExceptionGroup is not None and isinstance(
        exc_value, BaseExceptionGroup
    )

    if is_exception_group:
        (_, exceptions) = exceptions_from_error(
            exc_type=exc_type,
            exc_value=exc_value,
            tb=tb,
            client_options=client_options,
            mechanism=mechanism,
            exception_id=0,
            parent_id=0,
        )

    else:
        exceptions = []
        for exc_type, exc_value, tb in walk_exception_chain(exc_info):
            exceptions.append(
                single_exception_from_error_tuple(
                    exc_type, exc_value, tb, client_options, mechanism
                )
            )

    exceptions.reverse()

    return exceptions


def to_string(value):
    # type: (str) -> str
    try:
        return str(value)
    except UnicodeDecodeError:
        return repr(value)[1:-1]


def iter_event_stacktraces(event):
    # type: (Event) -> Iterator[Dict[str, Any]]
    if "stacktrace" in event:
        yield event["stacktrace"]
    if "threads" in event:
        for thread in event["threads"].get("values") or ():
            if "stacktrace" in thread:
                yield thread["stacktrace"]
    if "exception" in event:
        for exception in event["exception"].get("values") or ():
            if "stacktrace" in exception:
                yield exception["stacktrace"]


def iter_event_frames(event):
    # type: (Event) -> Iterator[Dict[str, Any]]
    for stacktrace in iter_event_stacktraces(event):
        for frame in stacktrace.get("frames") or ():
            yield frame


def handle_in_app(event, in_app_exclude=None, in_app_include=None, project_root=None):
    # type: (Event, Optional[List[str]], Optional[List[str]], Optional[str]) -> Event
    for stacktrace in iter_event_stacktraces(event):
        set_in_app_in_frames(
            stacktrace.get("frames"),
            in_app_exclude=in_app_exclude,
            in_app_include=in_app_include,
            project_root=project_root,
        )

    return event


def set_in_app_in_frames(frames, in_app_exclude, in_app_include, project_root=None):
    # type: (Any, Optional[List[str]], Optional[List[str]], Optional[str]) -> Optional[Any]
    if not frames:
        return None

    for frame in frames:
        # if frame has already been marked as in_app, skip it
        current_in_app = frame.get("in_app")
        if current_in_app is not None:
            continue

        module = frame.get("module")

        # check if module in frame is in the list of modules to include
        if _module_in_list(module, in_app_include):
            frame["in_app"] = True
            continue

        # check if module in frame is in the list of modules to exclude
        if _module_in_list(module, in_app_exclude):
            frame["in_app"] = False
            continue

        # if frame has no abs_path, skip further checks
        abs_path = frame.get("abs_path")
        if abs_path is None:
            continue

        if _is_external_source(abs_path):
            frame["in_app"] = False
            continue

        if _is_in_project_root(abs_path, project_root):
            frame["in_app"] = True
            continue

    return frames


def exception_is_already_captured(error):
    # type: (Union[BaseException, ExcInfo]) -> bool
    if isinstance(error, BaseException):
        return hasattr(error, "__posthog_exception_captured")
    # Autocaptured exceptions are passed as a tuple from our system hooks,
    # the second item is the exception value (the first is the exception type)
    elif isinstance(error, tuple) and len(error) > 1:
        return error[1] is not None and hasattr(
            error[1], "__posthog_exception_captured"
        )
    else:
        return False  # type: ignore[unreachable]


def mark_exception_as_captured(error):
    # type: (Union[BaseException, ExcInfo]) -> None
    if isinstance(error, BaseException):
        setattr(error, "__posthog_exception_captured", True)
    # Autocaptured exceptions are passed as a tuple from our system hooks,
    # the second item is the exception value (the first is the exception type)
    elif isinstance(error, tuple) and len(error) > 1:
        if error[1] is not None:
            setattr(error[1], "__posthog_exception_captured", True)


def exc_info_from_error(error):
    # type: (Union[BaseException, ExcInfo]) -> ExcInfo
    if isinstance(error, tuple) and len(error) == 3:
        exc_type, exc_value, tb = error
    elif isinstance(error, BaseException):
        try:
            construct_artificial_traceback(error)
        except Exception:
            pass
        tb = getattr(error, "__traceback__", None)
        if tb is not None:
            exc_type = type(error)
            exc_value = error
        else:
            exc_type, exc_value, tb = sys.exc_info()
            if exc_value is not error:
                tb = None
                exc_value = error
                exc_type = type(error)

    else:
        raise ValueError("Expected Exception object to report, got %s!" % type(error))

    exc_info = (exc_type, exc_value, tb)

    if TYPE_CHECKING:
        # This cast is safe because exc_type and exc_value are either both
        # None or both not None.
        exc_info = cast(ExcInfo, exc_info)

    return exc_info


def construct_artificial_traceback(e):
    # type: (BaseException) -> None
    if getattr(e, "__traceback__", None) is not None:
        return

    depth = 0
    frames = []
    while True:
        try:
            frame = sys._getframe(depth)
            depth += 1
        except ValueError:
            break

        frames.append(frame)

    frames.reverse()

    tb = None
    for frame in frames:
        tb = types.TracebackType(tb, frame, frame.f_lasti, frame.f_lineno)

    setattr(e, "__traceback__", tb)


def event_from_exception(
    exc_info,  # type: Union[BaseException, ExcInfo]
    client_options=None,  # type: Optional[Dict[str, Any]]
    mechanism=None,  # type: Optional[Dict[str, Any]]
):
    # type: (...) -> Tuple[Event, Dict[str, Any]]
    exc_info = exc_info_from_error(exc_info)
    hint = event_hint_with_exc_info(exc_info)
    return (
        {
            "level": "error",
            "exception": {
                "values": exceptions_from_error_tuple(
                    exc_info, client_options, mechanism
                )
            },
        },
        hint,
    )


def _module_in_list(name, items):
    # type: (str | None, Optional[List[str]]) -> bool
    if name is None:
        return False

    if not items:
        return False

    for item in items:
        if item == name or name.startswith(item + "."):
            return True

    return False


def _is_external_source(abs_path):
    # type: (str) -> bool
    # check if frame is in 'site-packages' or 'dist-packages'
    external_source = (
        re.search(r"[\\/](?:dist|site)-packages[\\/]", abs_path) is not None
    )
    return external_source


def _is_in_project_root(abs_path, project_root):
    # type: (str, Optional[str]) -> bool
    if project_root is None:
        return False

    # check if path is in the project root
    if abs_path.startswith(project_root):
        return True

    return False


def _truncate_by_bytes(string, max_bytes):
    # type: (str, int) -> str
    """
    Truncate a UTF-8-encodable string to the last full codepoint so that it fits in max_bytes.
    """
    truncated = string.encode("utf-8")[: max_bytes - 3].decode("utf-8", errors="ignore")

    return truncated + "..."


def _get_size_in_bytes(value):
    # type: (str) -> Optional[int]
    try:
        return len(value.encode("utf-8"))
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None


def strip_string(value, max_length=None):
    # type: (str, Optional[int]) -> Union[AnnotatedValue, str]
    if not value:
        return value

    if max_length is None:
        max_length = DEFAULT_MAX_VALUE_LENGTH

    byte_size = _get_size_in_bytes(value)
    text_size = len(value)

    if byte_size is not None and byte_size > max_length:
        # truncate to max_length bytes, preserving code points
        truncated_value = _truncate_by_bytes(value, max_length)
    elif text_size is not None and text_size > max_length:
        # fallback to truncating by string length
        truncated_value = value[: max_length - 3] + "..."
    else:
        return value

    return AnnotatedValue(
        value=truncated_value,
        metadata={
            "len": byte_size or text_size,
            "rem": [["!limit", "x", max_length - 3, max_length]],
        },
    )
