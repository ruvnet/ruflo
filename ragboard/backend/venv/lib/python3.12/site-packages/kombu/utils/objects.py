"""Object Utilities."""

from __future__ import annotations

from threading import RLock

__all__ = ('cached_property',)

try:
    from functools import cached_property as _cached_property
except ImportError:
    # TODO: Remove this fallback once we drop support for Python < 3.8
    from cached_property import threaded_cached_property as _cached_property

_NOT_FOUND = object()


class cached_property(_cached_property):
    """Implementation of Cached property."""

    def __init__(self, fget=None, fset=None, fdel=None):
        super().__init__(fget)
        self.__set = fset
        self.__del = fdel

        if not hasattr(self, 'attrname'):
            # This is a backport so we set this ourselves.
            self.attrname = self.func.__name__

        if not hasattr(self, 'lock'):
            # Prior to Python 3.12, functools.cached_property has an
            # undocumented lock which is required for thread-safe __set__
            # and __delete__. Create one if it isn't already present.
            self.lock = RLock()

    def __get__(self, instance, owner=None):
        # TODO: Remove this after we drop support for Python<3.8
        #  or fix the signature in the cached_property package
        with self.lock:
            return super().__get__(instance, owner)

    def __set__(self, instance, value):
        if instance is None:
            return self

        with self.lock:
            if self.__set is not None:
                value = self.__set(instance, value)

            cache = instance.__dict__
            cache[self.attrname] = value

    def __delete__(self, instance):
        if instance is None:
            return self

        with self.lock:
            value = instance.__dict__.pop(self.attrname, _NOT_FOUND)

            if self.__del and value is not _NOT_FOUND:
                self.__del(instance, value)

    def setter(self, fset):
        return self.__class__(self.func, fset, self.__del)

    def deleter(self, fdel):
        return self.__class__(self.func, self.__set, fdel)
