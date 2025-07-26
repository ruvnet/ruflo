import functools
import operator
from collections.abc import Callable
from dataclasses import dataclass
from types import ModuleType

import numpy as np
from scipy._lib._array_api import (
    array_namespace, scipy_namespace_for, is_numpy, is_dask, is_marray,
    xp_promote, xp_capabilities, SCIPY_ARRAY_API
)
import scipy._lib.array_api_extra as xpx
from . import _ufuncs


@dataclass
class _FuncInfo:
    # NumPy-only function. IT MUST BE ELEMENTWISE.
    func: Callable
    # Number of arguments, not counting out=
    # This is for testing purposes only, due to the fact that
    # inspect.signature() just returns *args for ufuncs.
    n_args: int
    # @xp_capabilities decorator, for the purpose of
    # documentation and unit testing. Omit to indicate
    # full support for all backends.
    xp_capabilities: Callable[[Callable], Callable] | None = None
    # Generic implementation to fall back on if there is no native dispatch
    # available. This is a function that accepts (main namespace, scipy namespace)
    # and returns the final callable, or None if not available.
    generic_impl: Callable[
        [ModuleType, ModuleType | None], Callable | None
    ] | None = None

    @property
    def name(self):
        return self.func.__name__

    # These are needed by @lru_cache below
    def __hash__(self):
        return hash(self.func)

    def __eq__(self, other):
        return isinstance(other, _FuncInfo) and self.func == other.func

    @property
    def wrapper(self):
        if self.name in globals():
            # Already initialised. We are likely in a unit test.
            # Return function potentially overridden by xpx.testing.lazy_xp_function.
            import scipy.special
            return getattr(scipy.special, self.name)

        if SCIPY_ARRAY_API:
            @functools.wraps(self.func)
            def wrapped(*args, **kwargs):
                xp = array_namespace(*args)
                return self._wrapper_for(xp)(*args, **kwargs)

            # Allow pickling the function. Normally this is done by @wraps,
            # but in this case it doesn't work because self.func is a ufunc.
            wrapped.__module__ = "scipy.special"
            wrapped.__qualname__ = self.name
            func = wrapped
        else:
            func = self.func

        capabilities = self.xp_capabilities or xp_capabilities()
        # In order to retain a naked ufunc when SCIPY_ARRAY_API is
        # disabled, xp_capabilities must apply its changes in place.
        cap_func = capabilities(func)
        assert cap_func is func
        return func

    @functools.lru_cache(1000)
    def _wrapper_for(self, xp):
        if is_numpy(xp):
            return self.func

        # If a native implementation is available, use that
        spx = scipy_namespace_for(xp)
        f = _get_native_func(xp, spx, self.name)
        if f is not None:
            return f

        # If generic Array API implementation is available, use that
        if self.generic_impl is not None:
            f = self.generic_impl(xp, spx)
            if f is not None:
                return f

        if is_marray(xp):
            # Unwrap the array, apply the function on the wrapped namespace,
            # and then re-wrap it.
            # IMPORTANT: this only works because all functions in this module
            # are elementwise. Otherwise, we would not be able to define a
            # general rule for mask propagation.

            _f = globals()[self.name]  # Allow nested wrapping
            def f(*args, _f=_f, xp=xp, **kwargs):
                data_args = [arg.data for arg in args]
                out = _f(*data_args, **kwargs)
                mask = functools.reduce(operator.or_, (arg.mask for arg in args))
                return xp.asarray(out, mask=mask)

            return f

        if is_dask(xp):
            # Apply the function to each block of the Dask array.
            # IMPORTANT: map_blocks works only because all functions in this module
            # are elementwise. It would be a grave mistake to apply this to gufuncs
            # or any other function with reductions, as they would change their
            # output depending on chunking!

            _f = globals()[self.name]  # Allow nested wrapping
            def f(*args, _f=_f, xp=xp, **kwargs):
                # Hide dtype kwarg from map_blocks
                return xp.map_blocks(functools.partial(_f, **kwargs), *args)

            return f

        # As a final resort, use the NumPy/SciPy implementation
        _f = self.func
        def f(*args, _f=_f, xp=xp, **kwargs):
            # TODO use xpx.lazy_apply to add jax.jit support
            # (but dtype propagation can be non-trivial)
            args = [np.asarray(arg) for arg in args]
            out = _f(*args, **kwargs)
            return xp.asarray(out)

        return f


def _get_native_func(xp, spx, f_name):
    f = getattr(spx.special, f_name, None) if spx else None
    if f is None and hasattr(xp, 'special'):
        # Currently dead branch, in anticipation of 'special' Array API extension
        # https://github.com/data-apis/array-api/issues/725
        f = getattr(xp.special, f_name, None)
    return f


def _rel_entr(xp, spx):
    def __rel_entr(x, y, *, xp=xp):
        # https://github.com/data-apis/array-api-extra/issues/160
        mxp = array_namespace(x._meta, y._meta) if is_dask(xp) else xp
        x, y = xp_promote(x, y, broadcast=True, force_floating=True, xp=xp)
        xy_pos = (x > 0) & (y > 0)
        xy_inf = xp.isinf(x) & xp.isinf(y)
        res = xpx.apply_where(
            xy_pos & ~xy_inf,
            (x, y),
            # Note: for very large x, this can overflow.
            lambda x, y: x * (mxp.log(x) - mxp.log(y)),
            fill_value=xp.inf
        )
        res = xpx.at(res)[(x == 0) & (y >= 0)].set(0)
        res = xpx.at(res)[xp.isnan(x) | xp.isnan(y) | (xy_pos & xy_inf)].set(xp.nan)
        return res

    return __rel_entr


def _xlogy(xp, spx):
    def __xlogy(x, y, *, xp=xp):
        x, y = xp_promote(x, y, force_floating=True, xp=xp)
        with np.errstate(divide='ignore', invalid='ignore'):
            temp = x * xp.log(y)
        return xp.where(x == 0., 0., temp)
    return __xlogy



def _chdtr(xp, spx):
    # The difference between this and just using `gammainc`
    # defined by `get_array_special_func` is that if `gammainc`
    # isn't found, we don't want to use the SciPy version; we'll
    # return None here and use the SciPy version of `chdtr`.
    gammainc = _get_native_func(xp, spx, 'gammainc')
    if gammainc is None:
        return None

    def __chdtr(v, x):
        res = gammainc(v / 2, x / 2)  # this is almost all we need
        # The rest can be removed when google/jax#20507 is resolved
        mask = (v == 0) & (x > 0)  # JAX returns NaN
        res = xp.where(mask, 1., res)
        mask = xp.isinf(v) & xp.isinf(x)  # JAX returns 1.0
        return xp.where(mask, xp.nan, res)
    return __chdtr


def _chdtrc(xp, spx):
    # The difference between this and just using `gammaincc`
    # defined by `get_array_special_func` is that if `gammaincc`
    # isn't found, we don't want to use the SciPy version; we'll
    # return None here and use the SciPy version of `chdtrc`.
    gammaincc = _get_native_func(xp, spx, 'gammaincc')
    if gammaincc is None:
        return None

    def __chdtrc(v, x):
        res = xp.where(x >= 0, gammaincc(v/2, x/2), 1)
        i_nan = ((x == 0) & (v == 0)) | xp.isnan(x) | xp.isnan(v) | (v <= 0)
        res = xp.where(i_nan, xp.nan, res)
        return res
    return __chdtrc


def _betaincc(xp, spx):
    betainc = _get_native_func(xp, spx, 'betainc')
    if betainc is None:
        return None

    def __betaincc(a, b, x):
        # not perfect; might want to just rely on SciPy
        return betainc(b, a, 1-x)
    return __betaincc


def _stdtr(xp, spx):
    betainc = _get_native_func(xp, spx, 'betainc')
    if betainc is None:
        return None

    def __stdtr(df, t):
        x = df / (t ** 2 + df)
        tail = betainc(df / 2, 0.5, x) / 2
        return xp.where(t < 0, tail, 1 - tail)

    return __stdtr


def _stdtrit(xp, spx):
    # Need either native stdtr or native betainc
    stdtr = _get_native_func(xp, spx, 'stdtr') or _stdtr(xp, spx)
    # If betainc is not defined, the root-finding would be done with `xp`
    # despite `stdtr` being evaluated with SciPy/NumPy `stdtr`. Save the
    # conversions: in this case, just evaluate `stdtrit` with SciPy/NumPy.
    if stdtr is None:
        return None

    from scipy.optimize.elementwise import bracket_root, find_root

    def __stdtrit(df, p):
        def fun(t, df, p):  return stdtr(df, t) - p
        res_bracket = bracket_root(fun, xp.zeros_like(p), args=(df, p))
        res_root = find_root(fun, res_bracket.bracket, args=(df, p))
        return res_root.x

    return __stdtrit


# Inventory of automatically dispatched functions
# IMPORTANT: these must all be **elementwise** functions!

# PyTorch doesn't implement `betainc`.
# On torch CPU we can fall back to NumPy, but on GPU it won't work.
_needs_betainc = xp_capabilities(cpu_only=True, exceptions=['jax.numpy', 'cupy'])

_special_funcs = (
    _FuncInfo(_ufuncs.betainc, 3, _needs_betainc),
    _FuncInfo(_ufuncs.betaincc, 3, _needs_betainc, generic_impl=_betaincc),
    _FuncInfo(_ufuncs.chdtr, 2, generic_impl=_chdtr),
    _FuncInfo(_ufuncs.chdtrc, 2, generic_impl=_chdtrc),
    _FuncInfo(_ufuncs.erf, 1),
    _FuncInfo(_ufuncs.erfc, 1),
    _FuncInfo(_ufuncs.entr, 1),
    _FuncInfo(_ufuncs.expit, 1),
    _FuncInfo(_ufuncs.i0, 1),
    _FuncInfo(_ufuncs.i0e, 1),
    _FuncInfo(_ufuncs.i1, 1),
    _FuncInfo(_ufuncs.i1e, 1),
    _FuncInfo(_ufuncs.log_ndtr, 1),
    _FuncInfo(_ufuncs.logit, 1),
    _FuncInfo(_ufuncs.gammaln, 1),
    _FuncInfo(_ufuncs.gammainc, 2),
    _FuncInfo(_ufuncs.gammaincc, 2),
    _FuncInfo(_ufuncs.ndtr, 1),
    _FuncInfo(_ufuncs.ndtri, 1),
    _FuncInfo(_ufuncs.rel_entr, 2, generic_impl=_rel_entr),
    _FuncInfo(_ufuncs.stdtr,  2, _needs_betainc, generic_impl=_stdtr),
    _FuncInfo(_ufuncs.stdtrit, 2,
              xp_capabilities(
                  cpu_only=True, exceptions=['cupy'],  # needs betainc
                  skip_backends=[("jax.numpy", "no scipy.optimize support")]),
              generic_impl=_stdtrit),
    _FuncInfo(_ufuncs.xlogy, 2, generic_impl=_xlogy),
)

# Override ufuncs.
# When SCIPY_ARRAY_API is disabled, this exclusively updates the docstrings in place
# and populates the xp_capabilities table, while retaining the original ufuncs.
globals().update({nfo.func.__name__: nfo.wrapper for nfo in _special_funcs})
__all__ = [nfo.func.__name__ for nfo in _special_funcs]
