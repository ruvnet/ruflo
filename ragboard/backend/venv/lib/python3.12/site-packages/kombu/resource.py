"""Generic resource pool implementation."""

from __future__ import annotations

import os
from collections import deque
from queue import Empty
from queue import LifoQueue as _LifoQueue
from typing import TYPE_CHECKING

from . import exceptions
from .utils.compat import register_after_fork
from .utils.functional import lazy

if TYPE_CHECKING:
    from types import TracebackType


def _after_fork_cleanup_resource(resource):
    try:
        resource.force_close_all()
    except Exception:
        pass


class LifoQueue(_LifoQueue):
    """Last in first out version of Queue."""

    def _init(self, maxsize):
        self.queue = deque()


class Resource:
    """Pool of resources."""

    LimitExceeded = exceptions.LimitExceeded

    close_after_fork = False

    def __init__(self, limit=None, preload=None, close_after_fork=None):
        self._limit = limit
        self.preload = preload or 0
        self._closed = False
        self.close_after_fork = (
            close_after_fork
            if close_after_fork is not None else self.close_after_fork
        )

        self._resource = LifoQueue()
        self._dirty = set()
        if self.close_after_fork and register_after_fork is not None:
            register_after_fork(self, _after_fork_cleanup_resource)
        self.setup()

    def setup(self):
        raise NotImplementedError('subclass responsibility')

    def _add_when_empty(self):
        if self.limit and len(self._dirty) >= self.limit:
            raise self.LimitExceeded(self.limit)
        # All taken, put new on the queue and
        # try get again, this way the first in line
        # will get the resource.
        self._resource.put_nowait(self.new())

    def acquire(self, block=False, timeout=None):
        """Acquire resource.

        Arguments:
        ---------
            block (bool): If the limit is exceeded,
                then block until there is an available item.
            timeout (float): Timeout to wait
                if ``block`` is true.  Default is :const:`None` (forever).

        Raises
        ------
            LimitExceeded: if block is false and the limit has been exceeded.
        """
        if self._closed:
            raise RuntimeError('Acquire on closed pool')
        if self.limit:
            while 1:
                try:
                    R = self._resource.get(block=block, timeout=timeout)
                except Empty:
                    self._add_when_empty()
                else:
                    try:
                        R = self.prepare(R)
                    except BaseException:
                        if isinstance(R, lazy):
                            # not evaluated yet, just put it back
                            self._resource.put_nowait(R)
                        else:
                            # evaluated so must try to release/close first.
                            self.release(R)
                        raise
                    self._dirty.add(R)
                    break
        else:
            R = self.prepare(self.new())

        def release():
            """Release resource so it can be used by another thread.

            Warnings:
            --------
                The caller is responsible for discarding the object,
                and to never use the resource again.  A new resource must
                be acquired if so needed.
            """
            self.release(R)
        R.release = release

        return R

    def prepare(self, resource):
        return resource

    def close_resource(self, resource):
        resource.close()

    def release_resource(self, resource):
        pass

    def replace(self, resource):
        """Replace existing resource with a new instance.

        This can be used in case of defective resources.
        """
        if self.limit:
            self._dirty.discard(resource)
        self.close_resource(resource)

    def release(self, resource):
        if self.limit:
            self._dirty.discard(resource)
            self._resource.put_nowait(resource)
            self.release_resource(resource)
        else:
            self.close_resource(resource)

    def collect_resource(self, resource):
        pass

    def force_close_all(self, close_pool=True):
        """Close and remove all resources in the pool (also those in use).

        Used to close resources from parent processes after fork
        (e.g. sockets/connections).

        Arguments:
        ---------
            close_pool (bool): If True (default) then the pool is marked
                as closed. In case of False the pool can be reused.
        """
        if self._closed:
            return
        self._closed = close_pool
        dirty = self._dirty
        resource = self._resource
        while 1:  # - acquired
            try:
                dres = dirty.pop()
            except KeyError:
                break
            try:
                self.collect_resource(dres)
            except AttributeError:  # Issue #78
                pass
        while 1:  # - available
            # deque supports '.clear', but lists do not, so for that
            # reason we use pop here, so that the underlying object can
            # be any object supporting '.pop' and '.append'.
            try:
                res = resource.queue.pop()
            except IndexError:
                break
            try:
                self.collect_resource(res)
            except AttributeError:
                pass  # Issue #78

    def resize(self, limit, force=False, ignore_errors=False, reset=False):
        prev_limit = self._limit
        if (self._dirty and 0 < limit < self._limit) and not ignore_errors:
            if not force:
                raise RuntimeError(
                    "Can't shrink pool when in use: was={} now={}".format(
                        self._limit, limit))
            reset = True
        self._limit = limit
        if reset:
            try:
                self.force_close_all(close_pool=False)
            except Exception:
                pass
        self.setup()
        if limit < prev_limit:
            self._shrink_down(collect=limit > 0)

    def _shrink_down(self, collect=True):
        class Noop:
            def __enter__(self):
                pass

            def __exit__(
                self,
                exc_type: type,
                exc_val: Exception,
                exc_tb: TracebackType
            ) -> None:
                pass

        resource = self._resource
        # Items to the left are last recently used, so we remove those first.
        with getattr(resource, 'mutex', Noop()):
            # keep in mind the dirty resources are not shrinking
            while len(resource.queue) and \
                    (len(resource.queue) + len(self._dirty)) > self.limit:
                R = resource.queue.popleft()
                if collect:
                    self.collect_resource(R)

    @property
    def limit(self):
        return self._limit

    @limit.setter
    def limit(self, limit):
        self.resize(limit)

    if os.environ.get('KOMBU_DEBUG_POOL'):  # pragma: no cover
        _orig_acquire = acquire
        _orig_release = release

        _next_resource_id = 0

        def acquire(self, *args, **kwargs):
            import traceback
            id = self._next_resource_id = self._next_resource_id + 1
            print(f'+{id} ACQUIRE {self.__class__.__name__}')
            r = self._orig_acquire(*args, **kwargs)
            r._resource_id = id
            print(f'-{id} ACQUIRE {self.__class__.__name__}')
            if not hasattr(r, 'acquired_by'):
                r.acquired_by = []
            r.acquired_by.append(traceback.format_stack())
            return r

        def release(self, resource):
            id = resource._resource_id
            print(f'+{id} RELEASE {self.__class__.__name__}')
            r = self._orig_release(resource)
            print(f'-{id} RELEASE {self.__class__.__name__}')
            self._next_resource_id -= 1
            return r
