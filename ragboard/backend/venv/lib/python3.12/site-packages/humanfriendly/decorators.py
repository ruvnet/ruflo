# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: March 2, 2020
# URL: https://humanfriendly.readthedocs.io

"""Simple function decorators to make Python programming easier."""

# Standard library modules.
import functools

# Public identifiers that require documentation.
__all__ = ('RESULTS_ATTRIBUTE', 'cached')

RESULTS_ATTRIBUTE = 'cached_results'
"""The name of the property used to cache the return values of functions (a string)."""


def cached(function):
    """
    Rudimentary caching decorator for functions.

    :param function: The function whose return value should be cached.
    :returns: The decorated function.

    The given function will only be called once, the first time the wrapper
    function is called. The return value is cached by the wrapper function as
    an attribute of the given function and returned on each subsequent call.

    .. note:: Currently no function arguments are supported because only a
              single return value can be cached. Accepting any function
              arguments at all would imply that the cache is parametrized on
              function arguments, which is not currently the case.
    """
    @functools.wraps(function)
    def wrapper():
        try:
            return getattr(wrapper, RESULTS_ATTRIBUTE)
        except AttributeError:
            result = function()
            setattr(wrapper, RESULTS_ATTRIBUTE, result)
            return result
    return wrapper
