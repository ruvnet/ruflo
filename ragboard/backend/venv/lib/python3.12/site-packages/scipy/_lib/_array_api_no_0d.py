"""
Extra testing functions that forbid 0d-input, see #21044

While the xp_assert_* functions generally aim to follow the conventions of the
underlying `xp` library, NumPy in particular is inconsistent in its handling
of scalars vs. 0d-arrays, see https://github.com/numpy/numpy/issues/24897.

For example, this means that the following operations (as of v2.0.1) currently
return scalars, even though a 0d-array would often be more appropriate:

    import numpy as np
    np.array(0) * 2     # scalar, not 0d array
    - np.array(0)       # scalar, not 0d-array
    np.sin(np.array(0)) # scalar, not 0d array
    np.mean([1, 2, 3])  # scalar, not 0d array

Libraries like CuPy tend to return a 0d-array in scenarios like those above,
and even `xp.asarray(0)[()]` remains a 0d-array there. To deal with the reality
of the inconsistencies present in NumPy, as well as 20+ years of code on top,
the `xp_assert_*` functions here enforce consistency in the only way that
doesn't go against the tide, i.e. by forbidding 0d-arrays as the return type.

However, when scalars are not generally the expected NumPy return type,
it remains preferable to use the assert functions from
the `scipy._lib._array_api` module, which have less surprising behaviour.
"""
from scipy._lib._array_api import array_namespace, is_numpy
from scipy._lib._array_api import (xp_assert_close as xp_assert_close_base,
                                   xp_assert_equal as xp_assert_equal_base,
                                   xp_assert_less as xp_assert_less_base)

__all__: list[str] = []


def _check_scalar(actual, desired, *, xp=None, **kwargs):
    __tracebackhide__ = True  # Hide traceback for py.test

    if xp is None:
        xp = array_namespace(actual)

    # necessary to handle non-numpy scalars, e.g. bare `0.0` has no shape
    desired = xp.asarray(desired)

    # Only NumPy distinguishes between scalars and arrays;
    # shape check in xp_assert_* is sufficient except for shape == ()
    if not (is_numpy(xp) and desired.shape == ()):
        return

    _msg = ("Result is a NumPy 0d-array. Many SciPy functions intend to follow "
            "the convention of many NumPy functions, returning a scalar when a "
            "0d-array would be correct. The specialized `xp_assert_*` functions "
            "in the `scipy._lib._array_api_no_0d` module err on the side of "
            "caution and do not accept 0d-arrays by default. If the correct "
            "result may legitimately be a 0d-array, pass `check_0d=True`, "
            "or use the `xp_assert_*` functions from `scipy._lib._array_api`.")
    assert xp.isscalar(actual), _msg


def xp_assert_equal(actual, desired, *, check_0d=False, **kwargs):
    # in contrast to xp_assert_equal_base, this defaults to check_0d=False,
    # but will do an extra check in that case, which forbids 0d-arrays for `actual`
    __tracebackhide__ = True  # Hide traceback for py.test

    # array-ness (check_0d == True) is taken care of by the *_base functions
    if not check_0d:
        _check_scalar(actual, desired, **kwargs)
    return xp_assert_equal_base(actual, desired, check_0d=check_0d, **kwargs)


def xp_assert_close(actual, desired, *, check_0d=False, **kwargs):
    # as for xp_assert_equal
    __tracebackhide__ = True

    if not check_0d:
        _check_scalar(actual, desired, **kwargs)
    return xp_assert_close_base(actual, desired, check_0d=check_0d, **kwargs)


def xp_assert_less(actual, desired, *, check_0d=False, **kwargs):
    # as for xp_assert_equal
    __tracebackhide__ = True

    if not check_0d:
        _check_scalar(actual, desired, **kwargs)
    return xp_assert_less_base(actual, desired, check_0d=check_0d, **kwargs)


def assert_array_almost_equal(actual, desired, decimal=6, *args, **kwds):
    """Backwards compatible replacement. In new code, use xp_assert_close instead.
    """
    rtol, atol = 0, 1.5*10**(-decimal)
    return xp_assert_close(actual, desired,
                           atol=atol, rtol=rtol, check_dtype=False, check_shape=False,
                           *args, **kwds)


def assert_almost_equal(actual, desired, decimal=7, *args, **kwds):
    """Backwards compatible replacement. In new code, use xp_assert_close instead.
    """
    rtol, atol = 0, 1.5*10**(-decimal)
    return xp_assert_close(actual, desired,
                           atol=atol, rtol=rtol, check_dtype=False, check_shape=False,
                           *args, **kwds)
