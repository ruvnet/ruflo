"""Synchronization primitives."""
from .abstract import Thenable
from .promises import promise

__all__ = ['barrier']


class barrier:
    """Barrier.

    Synchronization primitive to call a callback after a list
    of promises have been fulfilled.

    Example:

    .. code-block:: python

        # Request supports the .then() method.
        p1 = http.Request('http://a')
        p2 = http.Request('http://b')
        p3 = http.Request('http://c')
        requests = [p1, p2, p3]

        def all_done():
            pass  # all requests complete

        b = barrier(requests).then(all_done)

        # oops, we forgot we want another request
        b.add(http.Request('http://d'))

    Note that you cannot add new promises to a barrier after
    the barrier is fulfilled.
    """

    def __init__(self, promises=None, args=None, kwargs=None,
                 callback=None, size=None):
        self.p = promise()
        self.args = args or ()
        self.kwargs = kwargs or {}
        self._value = 0
        self.size = size or 0
        if not self.size and promises:
            # iter(l) calls len(l) so generator wrappers
            # can only return NotImplemented in the case the
            # generator is not fully consumed yet.
            plen = promises.__len__()
            if plen is not NotImplemented:
                self.size = plen
        self.ready = self.failed = False
        self.reason = None
        self.cancelled = False
        self.finalized = False

        [self.add_noincr(p) for p in promises or []]
        self.finalized = bool(promises or self.size)
        if callback:
            self.then(callback)

        __slots__ = (  # noqa
            'p', 'args', 'kwargs', '_value', 'size',
            'ready', 'reason', 'cancelled', 'finalized',
            '__weakref__',
            # adding '__dict__' to get dynamic assignment
            "__dict__",
        )

    def __call__(self, *args, **kwargs):
        if not self.ready and not self.cancelled:
            self._value += 1
            if self.finalized and self._value >= self.size:
                self.ready = True
                self.p(*self.args, **self.kwargs)

    def finalize(self):
        if not self.finalized and self._value >= self.size:
            self.p(*self.args, **self.kwargs)
        self.finalized = True

    def cancel(self):
        self.cancelled = True
        self.p.cancel()

    def add_noincr(self, p):
        if not self.cancelled:
            if self.ready:
                raise ValueError('Cannot add promise to full barrier')
            p.then(self)

    def add(self, p):
        if not self.cancelled:
            self.add_noincr(p)
            self.size += 1

    def then(self, callback, errback=None):
        self.p.then(callback, errback)

    def throw(self, *args, **kwargs):
        if not self.cancelled:
            self.p.throw(*args, **kwargs)
    throw1 = throw


Thenable.register(barrier)
