"""Deprecation utilities."""
import warnings

from vine.utils import wraps

from celery.exceptions import CDeprecationWarning, CPendingDeprecationWarning

__all__ = ('Callable', 'Property', 'warn')


PENDING_DEPRECATION_FMT = """
    {description} is scheduled for deprecation in \
    version {deprecation} and removal in version v{removal}. \
    {alternative}
"""

DEPRECATION_FMT = """
    {description} is deprecated and scheduled for removal in
    version {removal}. {alternative}
"""


def warn(description=None, deprecation=None,
         removal=None, alternative=None, stacklevel=2):
    """Warn of (pending) deprecation."""
    ctx = {'description': description,
           'deprecation': deprecation, 'removal': removal,
           'alternative': alternative}
    if deprecation is not None:
        w = CPendingDeprecationWarning(PENDING_DEPRECATION_FMT.format(**ctx))
    else:
        w = CDeprecationWarning(DEPRECATION_FMT.format(**ctx))
    warnings.warn(w, stacklevel=stacklevel)


def Callable(deprecation=None, removal=None,
             alternative=None, description=None):
    """Decorator for deprecated functions.

    A deprecation warning will be emitted when the function is called.

    Arguments:
        deprecation (str): Version that marks first deprecation, if this
            argument isn't set a ``PendingDeprecationWarning`` will be
            emitted instead.
        removal (str): Future version when this feature will be removed.
        alternative (str): Instructions for an alternative solution (if any).
        description (str): Description of what's being deprecated.
    """
    def _inner(fun):

        @wraps(fun)
        def __inner(*args, **kwargs):
            from .imports import qualname
            warn(description=description or qualname(fun),
                 deprecation=deprecation,
                 removal=removal,
                 alternative=alternative,
                 stacklevel=3)
            return fun(*args, **kwargs)
        return __inner
    return _inner


def Property(deprecation=None, removal=None,
             alternative=None, description=None):
    """Decorator for deprecated properties."""
    def _inner(fun):
        return _deprecated_property(
            fun, deprecation=deprecation, removal=removal,
            alternative=alternative, description=description or fun.__name__)
    return _inner


class _deprecated_property:

    def __init__(self, fget=None, fset=None, fdel=None, doc=None, **depreinfo):
        self.__get = fget
        self.__set = fset
        self.__del = fdel
        self.__name__, self.__module__, self.__doc__ = (
            fget.__name__, fget.__module__, fget.__doc__,
        )
        self.depreinfo = depreinfo
        self.depreinfo.setdefault('stacklevel', 3)

    def __get__(self, obj, type=None):
        if obj is None:
            return self
        warn(**self.depreinfo)
        return self.__get(obj)

    def __set__(self, obj, value):
        if obj is None:
            return self
        if self.__set is None:
            raise AttributeError('cannot set attribute')
        warn(**self.depreinfo)
        self.__set(obj, value)

    def __delete__(self, obj):
        if obj is None:
            return self
        if self.__del is None:
            raise AttributeError('cannot delete attribute')
        warn(**self.depreinfo)
        self.__del(obj)

    def setter(self, fset):
        return self.__class__(self.__get, fset, self.__del, **self.depreinfo)

    def deleter(self, fdel):
        return self.__class__(self.__get, self.__set, fdel, **self.depreinfo)
