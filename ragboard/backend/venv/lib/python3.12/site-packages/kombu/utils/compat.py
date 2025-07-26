"""Python Compatibility Utilities."""

from __future__ import annotations

import numbers
import sys
from contextlib import contextmanager
from functools import wraps
from importlib import metadata as importlib_metadata
from io import UnsupportedOperation

from kombu.exceptions import reraise

FILENO_ERRORS = (AttributeError, ValueError, UnsupportedOperation)

try:
    from billiard.util import register_after_fork
except ImportError:  # pragma: no cover
    try:
        from multiprocessing.util import register_after_fork
    except ImportError:
        register_after_fork = None


_environment = None


def coro(gen):
    """Decorator to mark generator as co-routine."""
    @wraps(gen)
    def wind_up(*args, **kwargs):
        it = gen(*args, **kwargs)
        next(it)
        return it
    return wind_up


def _detect_environment():
    # ## -eventlet-
    if 'eventlet' in sys.modules:
        try:
            import socket

            from eventlet.patcher import is_monkey_patched as is_eventlet

            if is_eventlet(socket):
                return 'eventlet'
        except ImportError:
            pass

    # ## -gevent-
    if 'gevent' in sys.modules:
        try:
            import socket

            from gevent import socket as _gsocket

            if socket.socket is _gsocket.socket:
                return 'gevent'
        except ImportError:
            pass

    return 'default'


def detect_environment():
    """Detect the current environment: default, eventlet, or gevent."""
    global _environment
    if _environment is None:
        _environment = _detect_environment()
    return _environment


def entrypoints(namespace):
    """Return setuptools entrypoints for namespace."""
    if sys.version_info >= (3,10):
        entry_points = importlib_metadata.entry_points(group=namespace)
    else:
        entry_points = importlib_metadata.entry_points()
        try:
            entry_points = entry_points.get(namespace, [])
        except AttributeError:
            entry_points = entry_points.select(group=namespace)

    return (
        (ep, ep.load())
        for ep in entry_points
    )


def fileno(f):
    """Get fileno from file-like object."""
    if isinstance(f, numbers.Integral):
        return f
    return f.fileno()


def maybe_fileno(f):
    """Get object fileno, or :const:`None` if not defined."""
    try:
        return fileno(f)
    except FILENO_ERRORS:
        pass


@contextmanager
def nested(*managers):  # pragma: no cover
    """Nest context managers."""
    # flake8: noqa
    exits = []
    vars = []
    exc = (None, None, None)
    try:
        try:
            for mgr in managers:
                exit = mgr.__exit__
                enter = mgr.__enter__
                vars.append(enter())
                exits.append(exit)
            yield vars
        except:
            exc = sys.exc_info()
        finally:
            while exits:
                exit = exits.pop()
                try:
                    if exit(*exc):
                        exc = (None, None, None)
                except:
                    exc = sys.exc_info()
            if exc != (None, None, None):
                # Don't rely on sys.exc_info() still containing
                # the right information.  Another exception may
                # have been raised and caught by an exit method
                reraise(exc[0], exc[1], exc[2])
    finally:
        del(exc)
