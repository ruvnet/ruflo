"""Python compatibility utilities."""
from functools import WRAPPER_ASSIGNMENTS, WRAPPER_UPDATES, partial
from functools import update_wrapper as _update_wrapper

__all__ = ['update_wrapper', 'wraps']


def update_wrapper(wrapper, wrapped, *args, **kwargs):
    """Update wrapper, also setting .__wrapped__."""
    wrapper = _update_wrapper(wrapper, wrapped, *args, **kwargs)
    wrapper.__wrapped__ = wrapped
    return wrapper


def wraps(wrapped,
          assigned=WRAPPER_ASSIGNMENTS,
          updated=WRAPPER_UPDATES):
    """Backport of Python 3.5 wraps that adds .__wrapped__."""
    return partial(update_wrapper, wrapped=wrapped,
                   assigned=assigned, updated=updated)


def reraise(tp, value, tb=None):
    """Reraise exception."""
    if value.__traceback__ is not tb:
        raise value.with_traceback(tb)
    raise value
