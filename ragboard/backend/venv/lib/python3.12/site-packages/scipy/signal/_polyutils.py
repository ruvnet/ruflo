"""Partial replacements for numpy polynomial routines, with Array API compatibility.

This module contains both "old-style", np.poly1d, routines from the main numpy
namespace, and "new-style", np.polynomial.polynomial, routines.

To distinguish the two sets, the "new-style" routine names start with `npp_`
"""
import scipy._lib.array_api_extra as xpx
from scipy._lib._array_api import xp_promote, xp_default_dtype


def _sort_cmplx(arr, xp):
    # xp.sort is undefined for complex dtypes. Here we only need some
    # consistent way to sort a complex array, including equal magnitude elements.
    arr = xp.asarray(arr)
    if xp.isdtype(arr.dtype, 'complex floating'):
        sorter = abs(arr) + xp.real(arr) + xp.imag(arr)**3
    else:
        sorter = arr

    idxs = xp.argsort(sorter)
    return arr[idxs]


def polyroots(coef, *, xp):
    """numpy.roots, best-effor replacement
    """
    if coef.shape[0] < 2:
        return xp.asarray([], dtype=coef.dtype)

    root_func = getattr(xp, 'roots', None)
    if root_func:
        # NB: cupy.roots is broken in CuPy 13.x, but CuPy is handled via delegation
        # so we never hit this code path with xp being cupy
        return root_func(coef)

    # companion matrix
    n = coef.shape[0]
    a = xp.eye(n - 1, n - 1, k=-1, dtype=coef.dtype)
    a[:, -1] = -xp.flip(coef[1:]) / coef[0]

    # non-symmetric eigenvalue problem is not in the spec but is available on e.g. torch
    if hasattr(xp.linalg, 'eigvals'):
        return xp.linalg.eigvals(a)
    else:
        import numpy as np
        return xp.asarray(np.linalg.eigvals(np.asarray(a)))


# https://github.com/numpy/numpy/blob/v2.1.0/numpy/lib/_function_base_impl.py#L1874-L1925
def _trim_zeros(filt, trim='fb'):
    first = 0
    trim = trim.upper()
    if 'F' in trim:
        for i in filt:
            if i != 0.:
                break
            else:
                first = first + 1
    last = filt.shape[0]
    if 'B' in trim:
        for i in filt[::-1]:
            if i != 0.:
                break
            else:
                last = last - 1
    return filt[first:last]


# ### Old-style routines ###


# https://github.com/numpy/numpy/blob/v2.2.0/numpy/lib/_polynomial_impl.py#L1232
def _poly1d(c_or_r, *, xp):
    """ Constructor of np.poly1d object from an array of coefficients (r=False)
    """
    c_or_r = xpx.atleast_nd(c_or_r, ndim=1, xp=xp)
    if c_or_r.ndim > 1:
        raise ValueError("Polynomial must be 1d only.")
    c_or_r = _trim_zeros(c_or_r, trim='f')
    if c_or_r.shape[0] == 0:
        c_or_r = xp.asarray([0], dtype=c_or_r.dtype)
    return c_or_r


# https://github.com/numpy/numpy/blob/v2.2.0/numpy/lib/_polynomial_impl.py#L702-L779
def polyval(p, x, *, xp):
    """ Old-style polynomial, `np.polyval`
    """
    y = xp.zeros_like(x)

    for pv in p:
        y = y * x + pv
    return y


# https://github.com/numpy/numpy/blob/v2.2.0/numpy/lib/_polynomial_impl.py#L34-L157
def poly(seq_of_zeros, *, xp):
    # Only reproduce the 1D variant of np.poly
    seq_of_zeros = xp.asarray(seq_of_zeros)
    seq_of_zeros = xpx.atleast_nd(seq_of_zeros, ndim=1, xp=xp)

    if seq_of_zeros.shape[0] == 0:
        return 1.0

    # prefer np.convolve etc, if available
    convolve_func = getattr(xp, 'convolve', None)
    if convolve_func is None:
        from scipy.signal import convolve as convolve_func

    dt = seq_of_zeros.dtype
    a = xp.ones((1,), dtype=dt)
    one = xp.ones_like(seq_of_zeros[0])
    for zero in seq_of_zeros:
        a = convolve_func(a, xp.stack((one, -zero)), mode='full')

    if xp.isdtype(a.dtype, 'complex floating'):
        # if complex roots are all complex conjugates, the roots are real.
        roots = xp.asarray(seq_of_zeros, dtype=xp.complex128)
        if xp.all(_sort_cmplx(roots, xp) == _sort_cmplx(xp.conj(roots), xp)):
            a = xp.asarray(xp.real(a), copy=True)

    return a


# https://github.com/numpy/numpy/blob/v2.2.0/numpy/lib/_polynomial_impl.py#L912
def polymul(a1, a2, *, xp):
    a1, a2 = _poly1d(a1, xp=xp), _poly1d(a2, xp=xp)

    # prefer np.convolve etc, if available
    convolve_func = getattr(xp, 'convolve', None)
    if convolve_func is None:
        from scipy.signal import convolve as convolve_func

    val = convolve_func(a1, a2)
    return val


# ### New-style routines ###


# https://github.com/numpy/numpy/blob/v2.2.0/numpy/polynomial/polynomial.py#L663
def npp_polyval(x, c, *, xp, tensor=True):
    if xp.isdtype(c.dtype, 'integral'):
        c = xp.astype(c, xp_default_dtype(xp))

    c = xpx.atleast_nd(c, ndim=1, xp=xp)
    if isinstance(x, tuple | list):
        x = xp.asarray(x)
    if tensor:
        c = xp.reshape(c, (c.shape + (1,)*x.ndim))

    c0, _ = xp_promote(c[-1, ...], x, broadcast=True, xp=xp)
    for i in range(2, c.shape[0] + 1):
        c0 = c[-i, ...] + c0*x
    return c0


# https://github.com/numpy/numpy/blob/v2.2.0/numpy/polynomial/polynomial.py#L758-L842
def npp_polyvalfromroots(x, r, *, xp, tensor=True):
    r = xpx.atleast_nd(r, ndim=1, xp=xp)
    # if r.dtype.char in '?bBhHiIlLqQpP':
    #    r = r.astype(np.double)

    if isinstance(x, tuple | list):
        x = xp.asarray(x)

    if tensor:
        r = xp.reshape(r, r.shape + (1,) * x.ndim)
    elif x.ndim >= r.ndim:
        raise ValueError("x.ndim must be < r.ndim when tensor == False")
    return xp.prod(x - r, axis=0)
