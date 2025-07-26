"""Threading primitives and utilities."""
import os
import socket
import sys
import threading
import traceback
from contextlib import contextmanager
from threading import TIMEOUT_MAX as THREAD_TIMEOUT_MAX

from celery.local import Proxy

try:
    from greenlet import getcurrent as get_ident
except ImportError:
    try:
        from _thread import get_ident
    except ImportError:
        try:
            from thread import get_ident
        except ImportError:
            try:
                from _dummy_thread import get_ident
            except ImportError:
                from dummy_thread import get_ident


__all__ = (
    'bgThread', 'Local', 'LocalStack', 'LocalManager',
    'get_ident', 'default_socket_timeout',
)

USE_FAST_LOCALS = os.environ.get('USE_FAST_LOCALS')


@contextmanager
def default_socket_timeout(timeout):
    """Context temporarily setting the default socket timeout."""
    prev = socket.getdefaulttimeout()
    socket.setdefaulttimeout(timeout)
    yield
    socket.setdefaulttimeout(prev)


class bgThread(threading.Thread):
    """Background service thread."""

    def __init__(self, name=None, **kwargs):
        super().__init__()
        self.__is_shutdown = threading.Event()
        self.__is_stopped = threading.Event()
        self.daemon = True
        self.name = name or self.__class__.__name__

    def body(self):
        raise NotImplementedError()

    def on_crash(self, msg, *fmt, **kwargs):
        print(msg.format(*fmt), file=sys.stderr)
        traceback.print_exc(None, sys.stderr)

    def run(self):
        body = self.body
        shutdown_set = self.__is_shutdown.is_set
        try:
            while not shutdown_set():
                try:
                    body()
                except Exception as exc:  # pylint: disable=broad-except
                    try:
                        self.on_crash('{0!r} crashed: {1!r}', self.name, exc)
                        self._set_stopped()
                    finally:
                        sys.stderr.flush()
                        os._exit(1)  # exiting by normal means won't work
        finally:
            self._set_stopped()

    def _set_stopped(self):
        try:
            self.__is_stopped.set()
        except TypeError:  # pragma: no cover
            # we lost the race at interpreter shutdown,
            # so gc collected built-in modules.
            pass

    def stop(self):
        """Graceful shutdown."""
        self.__is_shutdown.set()
        self.__is_stopped.wait()
        if self.is_alive():
            self.join(THREAD_TIMEOUT_MAX)


def release_local(local):
    """Release the contents of the local for the current context.

    This makes it possible to use locals without a manager.

    With this function one can release :class:`Local` objects as well as
    :class:`StackLocal` objects.  However it's not possible to
    release data held by proxies that way, one always has to retain
    a reference to the underlying local object in order to be able
    to release it.

    Example:
        >>> loc = Local()
        >>> loc.foo = 42
        >>> release_local(loc)
        >>> hasattr(loc, 'foo')
        False
    """
    local.__release_local__()


class Local:
    """Local object."""

    __slots__ = ('__storage__', '__ident_func__')

    def __init__(self):
        object.__setattr__(self, '__storage__', {})
        object.__setattr__(self, '__ident_func__', get_ident)

    def __iter__(self):
        return iter(self.__storage__.items())

    def __call__(self, proxy):
        """Create a proxy for a name."""
        return Proxy(self, proxy)

    def __release_local__(self):
        self.__storage__.pop(self.__ident_func__(), None)

    def __getattr__(self, name):
        try:
            return self.__storage__[self.__ident_func__()][name]
        except KeyError:
            raise AttributeError(name)

    def __setattr__(self, name, value):
        ident = self.__ident_func__()
        storage = self.__storage__
        try:
            storage[ident][name] = value
        except KeyError:
            storage[ident] = {name: value}

    def __delattr__(self, name):
        try:
            del self.__storage__[self.__ident_func__()][name]
        except KeyError:
            raise AttributeError(name)


class _LocalStack:
    """Local stack.

    This class works similar to a :class:`Local` but keeps a stack
    of objects instead.  This is best explained with an example::

        >>> ls = LocalStack()
        >>> ls.push(42)
        >>> ls.top
        42
        >>> ls.push(23)
        >>> ls.top
        23
        >>> ls.pop()
        23
        >>> ls.top
        42

    They can be force released by using a :class:`LocalManager` or with
    the :func:`release_local` function but the correct way is to pop the
    item from the stack after using.  When the stack is empty it will
    no longer be bound to the current context (and as such released).

    By calling the stack without arguments it will return a proxy that
    resolves to the topmost item on the stack.
    """

    def __init__(self):
        self._local = Local()

    def __release_local__(self):
        self._local.__release_local__()

    def _get__ident_func__(self):
        return self._local.__ident_func__

    def _set__ident_func__(self, value):
        object.__setattr__(self._local, '__ident_func__', value)
    __ident_func__ = property(_get__ident_func__, _set__ident_func__)
    del _get__ident_func__, _set__ident_func__

    def __call__(self):
        def _lookup():
            rv = self.top
            if rv is None:
                raise RuntimeError('object unbound')
            return rv
        return Proxy(_lookup)

    def push(self, obj):
        """Push a new item to the stack."""
        rv = getattr(self._local, 'stack', None)
        if rv is None:
            # pylint: disable=assigning-non-slot
            # This attribute is defined now.
            self._local.stack = rv = []
        rv.append(obj)
        return rv

    def pop(self):
        """Remove the topmost item from the stack.

        Note:
            Will return the old value or `None` if the stack was already empty.
        """
        stack = getattr(self._local, 'stack', None)
        if stack is None:
            return None
        elif len(stack) == 1:
            release_local(self._local)
            return stack[-1]
        else:
            return stack.pop()

    def __len__(self):
        stack = getattr(self._local, 'stack', None)
        return len(stack) if stack else 0

    @property
    def stack(self):
        # get_current_worker_task uses this to find
        # the original task that was executed by the worker.
        stack = getattr(self._local, 'stack', None)
        if stack is not None:
            return stack
        return []

    @property
    def top(self):
        """The topmost item on the stack.

        Note:
            If the stack is empty, :const:`None` is returned.
        """
        try:
            return self._local.stack[-1]
        except (AttributeError, IndexError):
            return None


class LocalManager:
    """Local objects cannot manage themselves.

    For that you need a local manager.
    You can pass a local manager multiple locals or add them
    later by appending them to ``manager.locals``.  Every time the manager
    cleans up, it will clean up all the data left in the locals for this
    context.

    The ``ident_func`` parameter can be added to override the default ident
    function for the wrapped locals.
    """

    def __init__(self, locals=None, ident_func=None):
        if locals is None:
            self.locals = []
        elif isinstance(locals, Local):
            self.locals = [locals]
        else:
            self.locals = list(locals)
        if ident_func is not None:
            self.ident_func = ident_func
            for local in self.locals:
                object.__setattr__(local, '__ident_func__', ident_func)
        else:
            self.ident_func = get_ident

    def get_ident(self):
        """Return context identifier.

        This is the identifier the local objects use internally
        for this context.  You cannot override this method to change the
        behavior but use it to link other context local objects (such as
        SQLAlchemy's scoped sessions) to the Werkzeug locals.
        """
        return self.ident_func()

    def cleanup(self):
        """Manually clean up the data in the locals for this context.

        Call this at the end of the request or use ``make_middleware()``.
        """
        for local in self.locals:
            release_local(local)

    def __repr__(self):
        return '<{} storages: {}>'.format(
            self.__class__.__name__, len(self.locals))


class _FastLocalStack(threading.local):

    def __init__(self):
        self.stack = []
        self.push = self.stack.append
        self.pop = self.stack.pop
        super().__init__()

    @property
    def top(self):
        try:
            return self.stack[-1]
        except (AttributeError, IndexError):
            return None

    def __len__(self):
        return len(self.stack)


if USE_FAST_LOCALS:  # pragma: no cover
    LocalStack = _FastLocalStack
else:  # pragma: no cover
    # - See #706
    # since each thread has its own greenlet we can just use those as
    # identifiers for the context.  If greenlets aren't available we
    # fall back to the  current thread ident.
    LocalStack = _LocalStack
