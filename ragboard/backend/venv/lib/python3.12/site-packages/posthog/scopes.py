import contextvars
from contextlib import contextmanager
from typing import Optional, Any, Callable, Dict, TypeVar, cast


class ContextScope:
    def __init__(
        self,
        parent=None,
        fresh: bool = False,
        capture_exceptions: bool = True,
    ):
        self.parent = parent
        self.fresh = fresh
        self.capture_exceptions = capture_exceptions
        self.session_id: Optional[str] = None
        self.distinct_id: Optional[str] = None
        self.tags: Dict[str, Any] = {}

    def set_session_id(self, session_id: str):
        self.session_id = session_id

    def set_distinct_id(self, distinct_id: str):
        self.distinct_id = distinct_id

    def add_tag(self, key: str, value: Any):
        self.tags[key] = value

    def get_parent(self):
        return self.parent

    def get_session_id(self) -> Optional[str]:
        if self.session_id is not None:
            return self.session_id
        if self.parent is not None and not self.fresh:
            return self.parent.get_session_id()
        return None

    def get_distinct_id(self) -> Optional[str]:
        if self.distinct_id is not None:
            return self.distinct_id
        if self.parent is not None and not self.fresh:
            return self.parent.get_distinct_id()
        return None

    def collect_tags(self) -> Dict[str, Any]:
        tags = self.tags.copy()
        if self.parent and not self.fresh:
            # We want child tags to take precedence over parent tags,
            # so we can't use a simple update here, instead collecting
            # the parent tags and then updating with the child tags.
            new_tags = self.parent.collect_tags()
            tags.update(new_tags)
        return tags


_context_stack: contextvars.ContextVar[Optional[ContextScope]] = contextvars.ContextVar(
    "posthog_context_stack", default=None
)


def _get_current_context() -> Optional[ContextScope]:
    return _context_stack.get()


@contextmanager
def new_context(fresh=False, capture_exceptions=True):
    """
    Create a new context scope that will be active for the duration of the with block.
    Any tags set within this scope will be isolated to this context. Any exceptions raised
    or events captured within the context will be tagged with the context tags.

    Args:
        fresh: Whether to start with a fresh context (default: False).
               If False, inherits tags, identity and session id's from parent context.
               If True, starts with no state
        capture_exceptions: Whether to capture exceptions raised within the context (default: True).
               If True, captures exceptions and tags them with the context tags before propagating them.
               If False, exceptions will propagate without being tagged or captured.

    Examples:
        # Inherit parent context tags
        with posthog.new_context():
            posthog.tag("request_id", "123")
            # Both this event and the exception will be tagged with the context tags
            posthog.capture("event_name", {"property": "value"})
            raise ValueError("Something went wrong")

        # Start with fresh context (no inherited tags)
        with posthog.new_context(fresh=True):
            posthog.tag("request_id", "123")
            # Both this event and the exception will be tagged with the context tags
            posthog.capture("event_name", {"property": "value"})
            raise ValueError("Something went wrong")

    """
    from posthog import capture_exception

    current_context = _get_current_context()
    new_context = ContextScope(current_context, fresh, capture_exceptions)
    _context_stack.set(new_context)

    try:
        yield
    except Exception as e:
        if new_context.capture_exceptions:
            capture_exception(e)
        raise
    finally:
        _context_stack.set(new_context.get_parent())


def tag(key: str, value: Any) -> None:
    """
    Add a tag to the current context.

    Args:
        key: The tag key
        value: The tag value

    Example:
        posthog.tag("user_id", "123")
    """
    current_context = _get_current_context()
    if current_context:
        current_context.add_tag(key, value)


# NOTE: we should probably also remove this - there's no reason for the user to ever
# need to manually interact with the current tag set
def get_tags() -> Dict[str, Any]:
    """
    Get all tags from the current context. Note, modifying
    the returned dictionary will not affect the current context.

    Returns:
        Dict of all tags in the current context
    """
    current_context = _get_current_context()
    if current_context:
        return current_context.collect_tags()
    return {}


# NOTE: We should probably remove this function - the way to clear scope context
# is by entering a new, fresh context, rather than by clearing the tags or other
# scope data directly.
def clear_tags() -> None:
    """Clear all tags in the current context. Does not clear parent tags"""
    current_context = _get_current_context()
    if current_context:
        current_context.tags.clear()


def identify_context(distinct_id: str) -> None:
    """
    Identify the current context with a distinct ID, associating all events captured in this or
    child contexts with the given distinct ID (unless identify_context is called again). This is overridden by
    distinct id's passed directly to posthog.capture and related methods (identify, set etc). Entering a
    fresh context will clear the context-level distinct ID.

    Args:
        distinct_id: The distinct ID to associate with the current context and its children.
    """
    current_context = _get_current_context()
    if current_context:
        current_context.set_distinct_id(distinct_id)


def set_context_session(session_id: str) -> None:
    """
    Set the session ID for the current context, associating all events captured in this or
    child contexts with the given session ID (unless set_context_session is called again).
    Entering a fresh context will clear the context-level session ID.

    Args:
        session_id: The session ID to associate with the current context and its children. See https://posthog.com/docs/data/sessions
    """
    current_context = _get_current_context()
    if current_context:
        current_context.set_session_id(session_id)


def get_context_session_id() -> Optional[str]:
    """
    Get the session ID for the current context.

    Returns:
        The session ID if set, None otherwise
    """
    current_context = _get_current_context()
    if current_context:
        return current_context.get_session_id()
    return None


def get_context_distinct_id() -> Optional[str]:
    """
    Get the distinct ID for the current context.

    Returns:
        The distinct ID if set, None otherwise
    """
    current_context = _get_current_context()
    if current_context:
        return current_context.get_distinct_id()
    return None


F = TypeVar("F", bound=Callable[..., Any])


def scoped(fresh=False, capture_exceptions=True):
    """
    Decorator that creates a new context for the function. Simply wraps
    the function in a with posthog.new_context(): block.

    Args:
        fresh: Whether to start with a fresh context (default: False)
        capture_exceptions: Whether to capture and track exceptions with posthog error tracking (default: True)

    Example:
        @posthog.scoped()
        def process_payment(payment_id):
            posthog.tag("payment_id", payment_id)
            posthog.tag("payment_method", "credit_card")

            # This event will be captured with tags
            posthog.capture("payment_started")
            # If this raises an exception, it will be captured with tags
            # and then re-raised
            some_risky_function()
    """

    def decorator(func: F) -> F:
        from functools import wraps

        @wraps(func)
        def wrapper(*args, **kwargs):
            with new_context(fresh=fresh, capture_exceptions=capture_exceptions):
                return func(*args, **kwargs)

        return cast(F, wrapper)

    return decorator
