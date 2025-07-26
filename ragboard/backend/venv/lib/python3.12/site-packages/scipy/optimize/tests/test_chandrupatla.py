import math
import pytest
import numpy as np
from copy import deepcopy

from scipy import stats, special
import scipy._lib._elementwise_iterative_method as eim
import scipy._lib.array_api_extra as xpx
from scipy._lib._array_api import array_namespace, is_cupy, is_numpy, xp_ravel, xp_size
from scipy._lib._array_api_no_0d import (xp_assert_close, xp_assert_equal,
                                         xp_assert_less)

from scipy.optimize.elementwise import find_minimum, find_root
from scipy.optimize._tstutils import _CHANDRUPATLA_TESTS

from itertools import permutations


def _vectorize(xp):
    # xp-compatible version of np.vectorize
    # assumes arguments are all arrays of the same shape
    def decorator(f):
        def wrapped(*arg_arrays):
            shape = arg_arrays[0].shape
            arg_arrays = [xp_ravel(arg_array, xp=xp) for arg_array in arg_arrays]
            res = []
            for i in range(math.prod(shape)):
                arg_scalars = [arg_array[i] for arg_array in arg_arrays]
                res.append(f(*arg_scalars))
            return res

        return wrapped

    return decorator


# These tests were originally written for the private `optimize._chandrupatla`
# interfaces, but now we want the tests to check the behavior of the public
# `optimize.elementwise` interfaces. Therefore, rather than importing
# `_chandrupatla`/`_chandrupatla_minimize` from `_chandrupatla.py`, we import
# `find_root`/`find_minimum` from `optimize.elementwise` and wrap those
# functions to conform to the private interface. This may look a little strange,
# since it effectively just inverts the interface transformation done within the
# `find_root`/`find_minimum` functions, but it allows us to run the original,
# unmodified tests on the public interfaces, simplifying the PR that adds
# the public interfaces. We'll refactor this when we want to @parametrize the
# tests over multiple `method`s.
def _wrap_chandrupatla(func):
    def _chandrupatla_wrapper(f, *bracket, **kwargs):
        # avoid passing arguments to `find_minimum` to this function
        tol_keys = {'xatol', 'xrtol', 'fatol', 'frtol'}
        tolerances = {key: kwargs.pop(key) for key in tol_keys if key in kwargs}
        _callback = kwargs.pop('callback', None)
        if callable(_callback):
            def callback(res):
                if func == find_root:
                    res.xl, res.xr = res.bracket
                    res.fl, res.fr = res.f_bracket
                else:
                    res.xl, res.xm, res.xr = res.bracket
                    res.fl, res.fm, res.fr = res.f_bracket
                res.fun = res.f_x
                del res.bracket
                del res.f_bracket
                del res.f_x
                return _callback(res)
        else:
            callback = _callback

        res = func(f, bracket, tolerances=tolerances, callback=callback, **kwargs)
        if func == find_root:
            res.xl, res.xr = res.bracket
            res.fl, res.fr = res.f_bracket
        else:
            res.xl, res.xm, res.xr = res.bracket
            res.fl, res.fm, res.fr = res.f_bracket
        res.fun = res.f_x
        del res.bracket
        del res.f_bracket
        del res.f_x
        return res
    return _chandrupatla_wrapper


_chandrupatla_minimize = _wrap_chandrupatla(find_minimum)


def f1(x):
    return 100*(1 - x**3.)**2 + (1-x**2.) + 2*(1-x)**2.


def f2(x):
    return 5 + (x - 2.)**6


def f3(x):
    xp = array_namespace(x)
    return xp.exp(x) - 5*x


def f4(x):
    return x**5. - 5*x**3. - 20.*x + 5.


def f5(x):
    return 8*x**3 - 2*x**2 - 7*x + 3


def _bracket_minimum(func, x1, x2):
    phi = 1.61803398875
    maxiter = 100
    f1 = func(x1)
    f2 = func(x2)
    step = x2 - x1
    x1, x2, f1, f2, step = ((x2, x1, f2, f1, -step) if f2 > f1
                            else (x1, x2, f1, f2, step))

    for i in range(maxiter):
        step *= phi
        x3 = x2 + step
        f3 = func(x3)
        if f3 < f2:
            x1, x2, f1, f2 = x2, x3, f2, f3
        else:
            break
    return x1, x2, x3, f1, f2, f3


cases = [
    (f1, -1, 11),
    (f1, -2, 13),
    (f1, -4, 13),
    (f1, -8, 15),
    (f1, -16, 16),
    (f1, -32, 19),
    (f1, -64, 20),
    (f1, -128, 21),
    (f1, -256, 21),
    (f1, -512, 19),
    (f1, -1024, 24),
    (f2, -1, 8),
    (f2, -2, 6),
    (f2, -4, 6),
    (f2, -8, 7),
    (f2, -16, 8),
    (f2, -32, 8),
    (f2, -64, 9),
    (f2, -128, 11),
    (f2, -256, 13),
    (f2, -512, 12),
    (f2, -1024, 13),
    (f3, -1, 11),
    (f3, -2, 11),
    (f3, -4, 11),
    (f3, -8, 10),
    (f3, -16, 14),
    (f3, -32, 12),
    (f3, -64, 15),
    (f3, -128, 18),
    (f3, -256, 18),
    (f3, -512, 19),
    (f3, -1024, 19),
    (f4, -0.05, 9),
    (f4, -0.10, 11),
    (f4, -0.15, 11),
    (f4, -0.20, 11),
    (f4, -0.25, 11),
    (f4, -0.30, 9),
    (f4, -0.35, 9),
    (f4, -0.40, 9),
    (f4, -0.45, 10),
    (f4, -0.50, 10),
    (f4, -0.55, 10),
    (f5, -0.05, 6),
    (f5, -0.10, 7),
    (f5, -0.15, 8),
    (f5, -0.20, 10),
    (f5, -0.25, 9),
    (f5, -0.30, 8),
    (f5, -0.35, 7),
    (f5, -0.40, 7),
    (f5, -0.45, 9),
    (f5, -0.50, 9),
    (f5, -0.55, 8)
]


@pytest.mark.skip_xp_backends('dask.array', reason='no take_along_axis')
@pytest.mark.skip_xp_backends('jax.numpy',
                              reason='JAX arrays do not support item assignment.')
@pytest.mark.skip_xp_backends('array_api_strict',
                              reason='Currently uses fancy indexing assignment.')
class TestChandrupatlaMinimize:

    def f(self, x, loc):
        xp = array_namespace(x, loc)
        res = -xp.exp(-1/2 * (x-loc)**2) / (2*xp.pi)**0.5
        return xp.asarray(res, dtype=x.dtype)[()]

    @pytest.mark.parametrize('dtype', ('float32', 'float64'))
    @pytest.mark.parametrize('loc', [0.6, np.linspace(-1.05, 1.05, 10)])
    def test_basic(self, loc, xp, dtype):
        # Find mode of normal distribution. Compare mode against location
        # parameter and value of pdf at mode against expected pdf.
        rtol = {'float32': 5e-3, 'float64': 5e-7}[dtype]
        dtype = getattr(xp, dtype)
        bracket = (xp.asarray(xi, dtype=dtype) for xi in (-5, 0, 5))
        loc = xp.asarray(loc, dtype=dtype)
        fun = xp.broadcast_to(xp.asarray(-stats.norm.pdf(0), dtype=dtype), loc.shape)

        res = _chandrupatla_minimize(self.f, *bracket, args=(loc,))
        xp_assert_close(res.x, loc, rtol=rtol)
        xp_assert_equal(res.fun, fun)

    @pytest.mark.parametrize('shape', [tuple(), (12,), (3, 4), (3, 2, 2)])
    def test_vectorization(self, shape, xp):
        # Test for correct functionality, output shapes, and dtypes for various
        # input shapes.
        loc = xp.linspace(-0.05, 1.05, 12).reshape(shape) if shape else xp.asarray(0.6)
        args = (loc,)
        bracket = xp.asarray(-5.), xp.asarray(0.), xp.asarray(5.)

        @_vectorize(xp)
        def chandrupatla_single(loc_single):
            return _chandrupatla_minimize(self.f, *bracket, args=(loc_single,))

        def f(*args, **kwargs):
            f.f_evals += 1
            return self.f(*args, **kwargs)
        f.f_evals = 0

        res = _chandrupatla_minimize(f, *bracket, args=args)
        refs = chandrupatla_single(loc)

        attrs = ['x', 'fun', 'success', 'status', 'nfev', 'nit',
                 'xl', 'xm', 'xr', 'fl', 'fm', 'fr']
        for attr in attrs:
            ref_attr = xp.stack([getattr(ref, attr) for ref in refs])
            res_attr = xp_ravel(getattr(res, attr))
            xp_assert_equal(res_attr, ref_attr)
            assert getattr(res, attr).shape == shape

        xp_assert_equal(res.fun, self.f(res.x, *args))
        xp_assert_equal(res.fl, self.f(res.xl, *args))
        xp_assert_equal(res.fm, self.f(res.xm, *args))
        xp_assert_equal(res.fr, self.f(res.xr, *args))
        assert xp.max(res.nfev) == f.f_evals
        assert xp.max(res.nit) == f.f_evals - 3

        assert xp.isdtype(res.success.dtype, 'bool')
        assert xp.isdtype(res.status.dtype, 'integral')
        assert xp.isdtype(res.nfev.dtype, 'integral')
        assert xp.isdtype(res.nit.dtype, 'integral')


    def test_flags(self, xp):
        # Test cases that should produce different status flags; show that all
        # can be produced simultaneously.
        def f(xs, js):
            funcs = [lambda x: (x - 2.5) ** 2,
                     lambda x: x - 10,
                     lambda x: (x - 2.5) ** 4,
                     lambda x: xp.full_like(x, xp.asarray(xp.nan))]
            res = []
            for i in range(xp_size(js)):
                x = xs[i, ...]
                j = int(xp_ravel(js)[i])
                res.append(funcs[j](x))
            return xp.stack(res)

        args = (xp.arange(4, dtype=xp.int64),)
        bracket = (xp.asarray([0]*4, dtype=xp.float64),
                   xp.asarray([2]*4, dtype=xp.float64),
                   xp.asarray([np.pi]*4, dtype=xp.float64))
        res = _chandrupatla_minimize(f, *bracket, args=args, maxiter=10)

        ref_flags = xp.asarray([eim._ECONVERGED, eim._ESIGNERR, eim._ECONVERR,
                                eim._EVALUEERR], dtype=xp.int32)
        xp_assert_equal(res.status, ref_flags)

    def test_convergence(self, xp):
        # Test that the convergence tolerances behave as expected
        rng = np.random.default_rng(2585255913088665241)
        p = xp.asarray(rng.random(size=3))
        bracket = (xp.asarray(-5, dtype=xp.float64), xp.asarray(0), xp.asarray(5))
        args = (p,)
        kwargs0 = dict(args=args, xatol=0, xrtol=0, fatol=0, frtol=0)

        kwargs = kwargs0.copy()
        kwargs['xatol'] = 1e-3
        res1 = _chandrupatla_minimize(self.f, *bracket, **kwargs)
        j1 = xp.abs(res1.xr - res1.xl)
        tol = xp.asarray(4*kwargs['xatol'], dtype=p.dtype)
        xp_assert_less(j1, xp.full((3,), tol, dtype=p.dtype))
        kwargs['xatol'] = 1e-6
        res2 = _chandrupatla_minimize(self.f, *bracket, **kwargs)
        j2 = xp.abs(res2.xr - res2.xl)
        tol = xp.asarray(4*kwargs['xatol'], dtype=p.dtype)
        xp_assert_less(j2, xp.full((3,), tol, dtype=p.dtype))
        xp_assert_less(j2, j1)

        kwargs = kwargs0.copy()
        kwargs['xrtol'] = 1e-3
        res1 = _chandrupatla_minimize(self.f, *bracket, **kwargs)
        j1 = xp.abs(res1.xr - res1.xl)
        tol = xp.asarray(4*kwargs['xrtol']*xp.abs(res1.x), dtype=p.dtype)
        xp_assert_less(j1, tol)
        kwargs['xrtol'] = 1e-6
        res2 = _chandrupatla_minimize(self.f, *bracket, **kwargs)
        j2 = xp.abs(res2.xr - res2.xl)
        tol = xp.asarray(4*kwargs['xrtol']*xp.abs(res2.x), dtype=p.dtype)
        xp_assert_less(j2, tol)
        xp_assert_less(j2, j1)

        kwargs = kwargs0.copy()
        kwargs['fatol'] = 1e-3
        res1 = _chandrupatla_minimize(self.f, *bracket, **kwargs)
        h1 = xp.abs(res1.fl - 2 * res1.fm + res1.fr)
        tol = xp.asarray(2*kwargs['fatol'], dtype=p.dtype)
        xp_assert_less(h1, xp.full((3,), tol, dtype=p.dtype))
        kwargs['fatol'] = 1e-6
        res2 = _chandrupatla_minimize(self.f, *bracket, **kwargs)
        h2 = xp.abs(res2.fl - 2 * res2.fm + res2.fr)
        tol = xp.asarray(2*kwargs['fatol'], dtype=p.dtype)
        xp_assert_less(h2, xp.full((3,), tol, dtype=p.dtype))
        xp_assert_less(h2, h1)

        kwargs = kwargs0.copy()
        kwargs['frtol'] = 1e-3
        res1 = _chandrupatla_minimize(self.f, *bracket, **kwargs)
        h1 = xp.abs(res1.fl - 2 * res1.fm + res1.fr)
        tol = xp.asarray(2*kwargs['frtol']*xp.abs(res1.fun), dtype=p.dtype)
        xp_assert_less(h1, tol)
        kwargs['frtol'] = 1e-6
        res2 = _chandrupatla_minimize(self.f, *bracket, **kwargs)
        h2 = xp.abs(res2.fl - 2 * res2.fm + res2.fr)
        tol = xp.asarray(2*kwargs['frtol']*abs(res2.fun), dtype=p.dtype)
        xp_assert_less(h2, tol)
        xp_assert_less(h2, h1)

    def test_maxiter_callback(self, xp):
        # Test behavior of `maxiter` parameter and `callback` interface
        loc = xp.asarray(0.612814)
        bracket = (xp.asarray(-5), xp.asarray(0), xp.asarray(5))
        maxiter = 5

        res = _chandrupatla_minimize(self.f, *bracket, args=(loc,),
                                     maxiter=maxiter)
        assert not xp.any(res.success)
        assert xp.all(res.nfev == maxiter+3)
        assert xp.all(res.nit == maxiter)

        def callback(res):
            callback.iter += 1
            callback.res = res
            assert hasattr(res, 'x')
            if callback.iter == 0:
                # callback is called once with initial bracket
                assert (res.xl, res.xm, res.xr) == bracket
            else:
                changed_xr = (res.xl == callback.xl) & (res.xr != callback.xr)
                changed_xl = (res.xl != callback.xl) & (res.xr == callback.xr)
                assert xp.all(changed_xr | changed_xl)

            callback.xl = res.xl
            callback.xr = res.xr
            assert res.status == eim._EINPROGRESS
            xp_assert_equal(self.f(res.xl, loc), res.fl)
            xp_assert_equal(self.f(res.xm, loc), res.fm)
            xp_assert_equal(self.f(res.xr, loc), res.fr)
            xp_assert_equal(self.f(res.x, loc), res.fun)
            if callback.iter == maxiter:
                raise StopIteration

        callback.xl = xp.nan
        callback.xr = xp.nan
        callback.iter = -1  # callback called once before first iteration
        callback.res = None

        res2 = _chandrupatla_minimize(self.f, *bracket, args=(loc,),
                                      callback=callback)

        # terminating with callback is identical to terminating due to maxiter
        # (except for `status`)
        for key in res.keys():
            if key == 'status':
                assert res[key] == eim._ECONVERR
                # assert callback.res[key] == eim._EINPROGRESS
                assert res2[key] == eim._ECALLBACK
            else:
                assert res2[key] == callback.res[key] == res[key]

    @pytest.mark.parametrize('case', cases)
    def test_nit_expected(self, case, xp):
        # Test that `_chandrupatla` implements Chandrupatla's algorithm:
        # in all 55 test cases, the number of iterations performed
        # matches the number reported in the original paper.
        func, x1, nit = case

        # Find bracket using the algorithm in the paper
        step = 0.2
        x2 = x1 + step
        x1, x2, x3, f1, f2, f3 = _bracket_minimum(func, x1, x2)

        # Use tolerances from original paper
        xatol = 0.0001
        fatol = 0.000001
        xrtol = 1e-16
        frtol = 1e-16

        bracket = xp.asarray(x1), xp.asarray(x2), xp.asarray(x3, dtype=xp.float64)
        res = _chandrupatla_minimize(func, *bracket, xatol=xatol,
                                     fatol=fatol, xrtol=xrtol, frtol=frtol)
        xp_assert_equal(res.nit, xp.asarray(nit, dtype=xp.int32))

    @pytest.mark.parametrize("loc", (0.65, [0.65, 0.7]))
    @pytest.mark.parametrize("dtype", ('float16', 'float32', 'float64'))
    def test_dtype(self, loc, dtype, xp):
        # Test that dtypes are preserved
        dtype = getattr(xp, dtype)

        loc = xp.asarray(loc, dtype=dtype)
        bracket = (xp.asarray(-3, dtype=dtype),
                   xp.asarray(1, dtype=dtype),
                   xp.asarray(5, dtype=dtype))

        def f(x, loc):
            assert x.dtype == dtype
            return xp.astype((x - loc)**2, dtype)

        res = _chandrupatla_minimize(f, *bracket, args=(loc,))
        assert res.x.dtype == dtype
        xp_assert_close(res.x, loc, rtol=math.sqrt(xp.finfo(dtype).eps))

    def test_input_validation(self, xp):
        # Test input validation for appropriate error messages

        message = '`func` must be callable.'
        bracket = xp.asarray(-4), xp.asarray(0), xp.asarray(4)
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(None, *bracket)

        message = 'Abscissae and function output must be real numbers.'
        bracket = xp.asarray(-4 + 1j), xp.asarray(0), xp.asarray(4)
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: x, *bracket)

        message = "...be broadcast..."
        bracket = xp.asarray([-2, -3]), xp.asarray([0, 0]), xp.asarray([3, 4, 5])
        # raised by `np.broadcast, but the traceback is readable IMO
        with pytest.raises((ValueError, RuntimeError), match=message):
            _chandrupatla_minimize(lambda x: x, *bracket)

        message = "The shape of the array returned by `func` must be the same"
        bracket = xp.asarray([-3, -3]), xp.asarray([0, 0]), xp.asarray([5, 5])
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: [x[0, ...], x[1, ...], x[1, ...]],
                                   *bracket)

        message = 'Tolerances must be non-negative scalars.'
        bracket = xp.asarray(-4), xp.asarray(0), xp.asarray(4)
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: x, *bracket, xatol=-1)
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: x, *bracket, xrtol=xp.nan)
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: x, *bracket, fatol='ekki')
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: x, *bracket, frtol=xp.nan)

        message = '`maxiter` must be a non-negative integer.'
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: x, *bracket, maxiter=1.5)
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: x, *bracket, maxiter=-1)

        message = '`callback` must be callable.'
        with pytest.raises(ValueError, match=message):
            _chandrupatla_minimize(lambda x: x, *bracket, callback='shrubbery')

    def test_bracket_order(self, xp):
        # Confirm that order of points in bracket doesn't
        loc = xp.linspace(-1, 1, 6)[:, xp.newaxis]
        brackets = xp.asarray(list(permutations([-5, 0, 5]))).T
        res = _chandrupatla_minimize(self.f, *brackets, args=(loc,))
        assert xp.all(xpx.isclose(res.x, loc) | (res.fun == self.f(loc, loc)))
        ref = res.x[:, 0]  # all columns should be the same
        xp_assert_close(*xp.broadcast_arrays(res.x.T, ref), rtol=1e-15)

    def test_special_cases(self, xp):
        # Test edge cases and other special cases

        # Test that integers are not passed to `f`
        def f(x):
            assert xp.isdtype(x.dtype, "real floating")
            return (x - 1)**2

        bracket = xp.asarray(-7), xp.asarray(0), xp.asarray(8)
        with np.errstate(invalid='ignore'):
            res = _chandrupatla_minimize(f, *bracket, fatol=0, frtol=0)
        assert res.success
        xp_assert_close(res.x, xp.asarray(1.), rtol=1e-3)
        xp_assert_close(res.fun, xp.asarray(0.), atol=1e-200)

        # Test that if all elements of bracket equal minimizer, algorithm
        # reports convergence
        def f(x):
            return (x-1)**2

        bracket = xp.asarray(1), xp.asarray(1), xp.asarray(1)
        res = _chandrupatla_minimize(f, *bracket)
        assert res.success
        xp_assert_equal(res.x, xp.asarray(1.))

        # Test maxiter = 0. Should do nothing to bracket.
        def f(x):
            return (x-1)**2

        bracket = xp.asarray(-3), xp.asarray(1.1), xp.asarray(5)
        res = _chandrupatla_minimize(f, *bracket, maxiter=0)
        assert res.xl, res.xr == bracket
        assert res.nit == 0
        assert res.nfev == 3
        assert res.status == -2
        assert res.x == 1.1  # best so far

        # Test scalar `args` (not in tuple)
        def f(x, c):
            return (x-c)**2 - 1

        bracket = xp.asarray(-1), xp.asarray(0), xp.asarray(1)
        c = xp.asarray(1/3)
        res = _chandrupatla_minimize(f, *bracket, args=(c,))
        xp_assert_close(res.x, c)

        # Test zero tolerances
        def f(x):
            return -xp.sin(x)

        bracket = xp.asarray(0), xp.asarray(1), xp.asarray(xp.pi)
        res = _chandrupatla_minimize(f, *bracket, xatol=0, xrtol=0, fatol=0, frtol=0)
        assert res.success
        # found a minimum exactly (according to floating point arithmetic)
        assert res.xl < res.xm < res.xr
        assert f(res.xl) == f(res.xm) == f(res.xr)


@pytest.mark.skip_xp_backends('dask.array', reason='boolean indexing assignment')
@pytest.mark.skip_xp_backends('array_api_strict',
                              reason='Currently uses fancy indexing assignment.')
@pytest.mark.skip_xp_backends('jax.numpy',
                              reason='JAX arrays do not support item assignment.')
class TestFindRoot:

    def f(self, q, p):
        return special.ndtr(q) - p

    @pytest.mark.parametrize('p', [0.6, np.linspace(-0.05, 1.05, 10)])
    def test_basic(self, p, xp):
        # Invert distribution CDF and compare against distribution `ppf`
        a, b = xp.asarray(-5.), xp.asarray(5.)
        res = find_root(self.f, (a, b), args=(xp.asarray(p),))
        ref = xp.asarray(stats.norm().ppf(p), dtype=xp.asarray(p).dtype)
        xp_assert_close(res.x, ref)

    @pytest.mark.parametrize('shape', [tuple(), (12,), (3, 4), (3, 2, 2)])
    def test_vectorization(self, shape, xp):
        # Test for correct functionality, output shapes, and dtypes for various
        # input shapes.
        p = (np.linspace(-0.05, 1.05, 12).reshape(shape) if shape
             else np.float64(0.6))
        p_xp = xp.asarray(p)
        args_xp = (p_xp,)
        dtype = p_xp.dtype

        @np.vectorize
        def find_root_single(p):
            return find_root(self.f, (-5, 5), args=(p,))

        def f(*args, **kwargs):
            f.f_evals += 1
            return self.f(*args, **kwargs)
        f.f_evals = 0

        bracket = xp.asarray(-5., dtype=xp.float64), xp.asarray(5., dtype=xp.float64)
        res = find_root(f, bracket, args=args_xp)
        refs = find_root_single(p).ravel()

        ref_x = [ref.x for ref in refs]
        ref_x = xp.reshape(xp.asarray(ref_x, dtype=dtype), shape)
        xp_assert_close(res.x, ref_x)

        ref_f = [ref.f_x for ref in refs]
        ref_f = xp.reshape(xp.asarray(ref_f, dtype=dtype), shape)
        xp_assert_close(res.f_x, ref_f, atol=1e-15)
        xp_assert_equal(res.f_x, self.f(res.x, *args_xp))

        ref_success = [bool(ref.success) for ref in refs]
        ref_success = xp.reshape(xp.asarray(ref_success, dtype=xp.bool), shape)
        xp_assert_equal(res.success, ref_success)

        ref_status = [ref.status for ref in refs]
        ref_status = xp.reshape(xp.asarray(ref_status, dtype=xp.int32), shape)
        xp_assert_equal(res.status, ref_status)

        ref_nfev = [ref.nfev for ref in refs]
        ref_nfev = xp.reshape(xp.asarray(ref_nfev, dtype=xp.int32), shape)
        if is_numpy(xp):
            xp_assert_equal(res.nfev, ref_nfev)
            assert xp.max(res.nfev) == f.f_evals
        else:  # different backend may lead to different nfev
            assert res.nfev.shape == shape
            assert res.nfev.dtype == xp.int32

        ref_nit = [ref.nit for ref in refs]
        ref_nit = xp.reshape(xp.asarray(ref_nit, dtype=xp.int32), shape)
        if is_numpy(xp):
            xp_assert_equal(res.nit, ref_nit)
            assert xp.max(res.nit) == f.f_evals-2
        else:
            assert res.nit.shape == shape
            assert res.nit.dtype == xp.int32

        ref_xl = [ref.bracket[0] for ref in refs]
        ref_xl = xp.reshape(xp.asarray(ref_xl, dtype=dtype), shape)
        xp_assert_close(res.bracket[0], ref_xl)

        ref_xr = [ref.bracket[1] for ref in refs]
        ref_xr = xp.reshape(xp.asarray(ref_xr, dtype=dtype), shape)
        xp_assert_close(res.bracket[1], ref_xr)

        xp_assert_less(res.bracket[0], res.bracket[1])
        finite = xp.isfinite(res.x)
        assert xp.all((res.x[finite] == res.bracket[0][finite])
                      | (res.x[finite] == res.bracket[1][finite]))

        # PyTorch and CuPy don't solve to the same accuracy as NumPy - that's OK.
        atol = 1e-15 if is_numpy(xp) else 1e-9

        ref_fl = [ref.f_bracket[0] for ref in refs]
        ref_fl = xp.reshape(xp.asarray(ref_fl, dtype=dtype), shape)
        xp_assert_close(res.f_bracket[0], ref_fl, atol=atol)
        xp_assert_equal(res.f_bracket[0], self.f(res.bracket[0], *args_xp))

        ref_fr = [ref.f_bracket[1] for ref in refs]
        ref_fr = xp.reshape(xp.asarray(ref_fr, dtype=dtype), shape)
        xp_assert_close(res.f_bracket[1], ref_fr, atol=atol)
        xp_assert_equal(res.f_bracket[1], self.f(res.bracket[1], *args_xp))

        assert xp.all(xp.abs(res.f_x[finite]) ==
                      xp.minimum(xp.abs(res.f_bracket[0][finite]),
                                 xp.abs(res.f_bracket[1][finite])))

    def test_flags(self, xp):
        # Test cases that should produce different status flags; show that all
        # can be produced simultaneously.
        def f(xs, js):
            # Note that full_like and int(j) shouldn't really be required. CuPy
            # is just really picky here, so I'm making it a special case to
            # make sure the other backends work when the user is less careful.
            assert js.dtype == xp.int64
            if is_cupy(xp):
                funcs = [lambda x: x - 2.5,
                         lambda x: x - 10,
                         lambda x: (x - 0.1)**3,
                         lambda x: xp.full_like(x, xp.asarray(xp.nan))]
                return [funcs[int(j)](x) for x, j in zip(xs, js)]

            funcs = [lambda x: x - 2.5,
                     lambda x: x - 10,
                     lambda x: (x - 0.1) ** 3,
                     lambda x: xp.nan]
            return [funcs[j](x) for x, j in zip(xs, js)]

        args = (xp.arange(4, dtype=xp.int64),)
        a, b = xp.asarray([0.]*4), xp.asarray([xp.pi]*4)
        res = find_root(f, (a, b), args=args, maxiter=2)

        ref_flags = xp.asarray([eim._ECONVERGED,
                                eim._ESIGNERR,
                                eim._ECONVERR,
                                eim._EVALUEERR], dtype=xp.int32)
        xp_assert_equal(res.status, ref_flags)

    def test_convergence(self, xp):
        # Test that the convergence tolerances behave as expected
        rng = np.random.default_rng(2585255913088665241)
        p = xp.asarray(rng.random(size=3))
        bracket = (-xp.asarray(5.), xp.asarray(5.))
        args = (p,)
        kwargs0 = dict(args=args, tolerances=dict(xatol=0, xrtol=0, fatol=0, frtol=0))

        kwargs = deepcopy(kwargs0)
        kwargs['tolerances']['xatol'] = 1e-3
        res1 = find_root(self.f, bracket, **kwargs)
        xp_assert_less(res1.bracket[1] - res1.bracket[0],
                       xp.full_like(p, xp.asarray(1e-3)))
        kwargs['tolerances']['xatol'] = 1e-6
        res2 = find_root(self.f, bracket, **kwargs)
        xp_assert_less(res2.bracket[1] - res2.bracket[0],
                       xp.full_like(p, xp.asarray(1e-6)))
        xp_assert_less(res2.bracket[1] - res2.bracket[0],
                       res1.bracket[1] - res1.bracket[0])

        kwargs = deepcopy(kwargs0)
        kwargs['tolerances']['xrtol'] = 1e-3
        res1 = find_root(self.f, bracket, **kwargs)
        xp_assert_less(res1.bracket[1] - res1.bracket[0], 1e-3 * xp.abs(res1.x))
        kwargs['tolerances']['xrtol'] = 1e-6
        res2 = find_root(self.f, bracket, **kwargs)
        xp_assert_less(res2.bracket[1] - res2.bracket[0],
                       1e-6 * xp.abs(res2.x))
        xp_assert_less(res2.bracket[1] - res2.bracket[0],
                       res1.bracket[1] - res1.bracket[0])

        kwargs = deepcopy(kwargs0)
        kwargs['tolerances']['fatol'] = 1e-3
        res1 = find_root(self.f, bracket, **kwargs)
        xp_assert_less(xp.abs(res1.f_x), xp.full_like(p, xp.asarray(1e-3)))
        kwargs['tolerances']['fatol'] = 1e-6
        res2 = find_root(self.f, bracket, **kwargs)
        xp_assert_less(xp.abs(res2.f_x), xp.full_like(p, xp.asarray(1e-6)))
        xp_assert_less(xp.abs(res2.f_x), xp.abs(res1.f_x))

        kwargs = deepcopy(kwargs0)
        kwargs['tolerances']['frtol'] = 1e-3
        x1, x2 = bracket
        f0 = xp.minimum(xp.abs(self.f(x1, *args)), xp.abs(self.f(x2, *args)))
        res1 = find_root(self.f, bracket, **kwargs)
        xp_assert_less(xp.abs(res1.f_x), 1e-3*f0)
        kwargs['tolerances']['frtol'] = 1e-6
        res2 = find_root(self.f, bracket, **kwargs)
        xp_assert_less(xp.abs(res2.f_x), 1e-6*f0)
        xp_assert_less(xp.abs(res2.f_x), xp.abs(res1.f_x))

    def test_maxiter_callback(self, xp):
        # Test behavior of `maxiter` parameter and `callback` interface
        p = xp.asarray(0.612814)
        bracket = (xp.asarray(-5.), xp.asarray(5.))
        maxiter = 5

        def f(q, p):
            res = special.ndtr(q) - p
            f.x = q
            f.f_x = res
            return res
        f.x = None
        f.f_x = None

        res = find_root(f, bracket, args=(p,), maxiter=maxiter)
        assert not xp.any(res.success)
        assert xp.all(res.nfev == maxiter+2)
        assert xp.all(res.nit == maxiter)

        def callback(res):
            callback.iter += 1
            callback.res = res
            assert hasattr(res, 'x')
            if callback.iter == 0:
                # callback is called once with initial bracket
                assert (res.bracket[0], res.bracket[1]) == bracket
            else:
                changed = (((res.bracket[0] == callback.bracket[0])
                            & (res.bracket[1] != callback.bracket[1]))
                           | ((res.bracket[0] != callback.bracket[0])
                              & (res.bracket[1] == callback.bracket[1])))
                assert xp.all(changed)

            callback.bracket[0] = res.bracket[0]
            callback.bracket[1] = res.bracket[1]
            assert res.status == eim._EINPROGRESS
            xp_assert_equal(self.f(res.bracket[0], p), res.f_bracket[0])
            xp_assert_equal(self.f(res.bracket[1], p), res.f_bracket[1])
            xp_assert_equal(self.f(res.x, p), res.f_x)
            if callback.iter == maxiter:
                raise StopIteration
        callback.iter = -1  # callback called once before first iteration
        callback.res = None
        callback.bracket = [None, None]

        res2 = find_root(f, bracket, args=(p,), callback=callback)

        # terminating with callback is identical to terminating due to maxiter
        # (except for `status`)
        for key in res.keys():
            if key == 'status':
                xp_assert_equal(res[key], xp.asarray(eim._ECONVERR, dtype=xp.int32))
                xp_assert_equal(res2[key], xp.asarray(eim._ECALLBACK, dtype=xp.int32))
            elif key in {'bracket', 'f_bracket'}:
                xp_assert_equal(res2[key][0], res[key][0])
                xp_assert_equal(res2[key][1], res[key][1])
            elif key.startswith('_'):
                continue
            else:
                xp_assert_equal(res2[key], res[key])

    @pytest.mark.parametrize('case', _CHANDRUPATLA_TESTS)
    def test_nit_expected(self, case, xp):
        # Test that `_chandrupatla` implements Chandrupatla's algorithm:
        # in all 40 test cases, the number of iterations performed
        # matches the number reported in the original paper.
        f, bracket, root, nfeval, id = case
        # Chandrupatla's criterion is equivalent to
        # abs(x2-x1) < 4*abs(xmin)*xrtol + xatol, but we use the more standard
        # abs(x2-x1) < abs(xmin)*xrtol + xatol. Therefore, set xrtol to 4x
        # that used by Chandrupatla in tests.
        bracket = (xp.asarray(bracket[0], dtype=xp.float64),
                   xp.asarray(bracket[1], dtype=xp.float64))
        root = xp.asarray(root, dtype=xp.float64)

        res = find_root(f, bracket, tolerances=dict(xrtol=4e-10, xatol=1e-5))
        xp_assert_close(res.f_x, xp.asarray(f(root), dtype=xp.float64),
                        rtol=1e-8, atol=2e-3)
        xp_assert_equal(res.nfev, xp.asarray(nfeval, dtype=xp.int32))

    @pytest.mark.parametrize("root", (0.622, [0.622, 0.623]))
    @pytest.mark.parametrize("dtype", ('float16', 'float32', 'float64'))
    def test_dtype(self, root, dtype, xp):
        # Test that dtypes are preserved
        not_numpy = not is_numpy(xp)
        if not_numpy and dtype == 'float16':
            pytest.skip("`float16` dtype only supported for NumPy arrays.")

        dtype = getattr(xp, dtype, None)
        if dtype is None:
            pytest.skip(f"{xp} does not support {dtype}")

        def f(x, root):
            res = (x - root) ** 3.
            if is_numpy(xp):  # NumPy does not preserve dtype
                return xp.asarray(res, dtype=dtype)
            return res

        a, b = xp.asarray(-3, dtype=dtype), xp.asarray(3, dtype=dtype)
        root = xp.asarray(root, dtype=dtype)
        res = find_root(f, (a, b), args=(root,), tolerances={'xatol': 1e-3})
        try:
            xp_assert_close(res.x, root, atol=1e-3)
        except AssertionError:
            assert res.x.dtype == dtype
            xp.all(res.f_x == 0)

    def test_input_validation(self, xp):
        # Test input validation for appropriate error messages

        def func(x):
            return x

        message = '`func` must be callable.'
        with pytest.raises(ValueError, match=message):
            bracket = xp.asarray(-4), xp.asarray(4)
            find_root(None, bracket)

        message = 'Abscissae and function output must be real numbers.'
        with pytest.raises(ValueError, match=message):
            bracket = xp.asarray(-4+1j), xp.asarray(4)
            find_root(func, bracket)

        # raised by `np.broadcast, but the traceback is readable IMO
        message = "...not be broadcast..."  # all messages include this part
        with pytest.raises((ValueError, RuntimeError), match=message):
            bracket = xp.asarray([-2, -3]), xp.asarray([3, 4, 5])
            find_root(func, bracket)

        message = "The shape of the array returned by `func`..."
        with pytest.raises(ValueError, match=message):
            bracket = xp.asarray([-3, -3]), xp.asarray([5, 5])
            find_root(lambda x: [x[0], x[1], x[1]], bracket)

        message = 'Tolerances must be non-negative scalars.'
        bracket = xp.asarray(-4), xp.asarray(4)
        with pytest.raises(ValueError, match=message):
            find_root(func, bracket, tolerances=dict(xatol=-1))
        with pytest.raises(ValueError, match=message):
            find_root(func, bracket, tolerances=dict(xrtol=xp.nan))
        with pytest.raises(ValueError, match=message):
            find_root(func, bracket, tolerances=dict(fatol='ekki'))
        with pytest.raises(ValueError, match=message):
            find_root(func, bracket, tolerances=dict(frtol=xp.nan))

        message = '`maxiter` must be a non-negative integer.'
        with pytest.raises(ValueError, match=message):
            find_root(func, bracket, maxiter=1.5)
        with pytest.raises(ValueError, match=message):
            find_root(func, bracket, maxiter=-1)

        message = '`callback` must be callable.'
        with pytest.raises(ValueError, match=message):
            find_root(func, bracket, callback='shrubbery')

    def test_special_cases(self, xp):
        # Test edge cases and other special cases

        # Test infinite function values
        def f(x):
            return 1 / x + 1 - 1 / (-x + 1)

        a, b = xp.asarray([0.1, 0., 0., 0.1]),  xp.asarray([0.9, 1.0, 0.9, 1.0])

        with np.errstate(divide='ignore', invalid='ignore'):
            res = find_root(f, (a, b))

        assert xp.all(res.success)
        xp_assert_close(res.x[1:], xp.full((3,), res.x[0]))

        # Test that integers are not passed to `f`
        # (otherwise this would overflow)
        def f(x):
            assert xp.isdtype(x.dtype, "real floating")
            # this would overflow if x were an xp integer dtype
            return x ** 31 - 1

        # note that all inputs are integer type; result is automatically default float
        res = find_root(f, (xp.asarray(-7), xp.asarray(5)))
        assert res.success
        xp_assert_close(res.x, xp.asarray(1.))

        # Test that if both ends of bracket equal root, algorithm reports
        # convergence.
        def f(x, root):
            return x**2 - root

        root = xp.asarray([0, 1])
        res = find_root(f, (xp.asarray(1), xp.asarray(1)), args=(root,))
        xp_assert_equal(res.success, xp.asarray([False, True]))
        xp_assert_equal(res.x, xp.asarray([xp.nan, 1.]))

        def f(x):
            return 1/x

        with np.errstate(invalid='ignore'):
            inf = xp.asarray(xp.inf)
            res = find_root(f, (inf, inf))
        assert res.success
        xp_assert_equal(res.x, xp.asarray(xp.inf))

        # Test maxiter = 0. Should do nothing to bracket.
        def f(x):
            return x**3 - 1

        a, b = xp.asarray(-3.), xp.asarray(5.)
        res = find_root(f, (a, b), maxiter=0)
        xp_assert_equal(res.success, xp.asarray(False))
        xp_assert_equal(res.status, xp.asarray(-2, dtype=xp.int32))
        xp_assert_equal(res.nit, xp.asarray(0, dtype=xp.int32))
        xp_assert_equal(res.nfev, xp.asarray(2, dtype=xp.int32))
        xp_assert_equal(res.bracket[0], a)
        xp_assert_equal(res.bracket[1], b)
        # The `x` attribute is the one with the smaller function value
        xp_assert_equal(res.x, a)
        # Reverse bracket; check that this is still true
        res = find_root(f, (-b, -a), maxiter=0)
        xp_assert_equal(res.x, -a)

        # Test maxiter = 1
        res = find_root(f, (a, b), maxiter=1)
        xp_assert_equal(res.success, xp.asarray(True))
        xp_assert_equal(res.status, xp.asarray(0, dtype=xp.int32))
        xp_assert_equal(res.nit, xp.asarray(1, dtype=xp.int32))
        xp_assert_equal(res.nfev, xp.asarray(3, dtype=xp.int32))
        xp_assert_close(res.x, xp.asarray(1.))

        # Test scalar `args` (not in tuple)
        def f(x, c):
            return c*x - 1

        res = find_root(f, (xp.asarray(-1), xp.asarray(1)), args=xp.asarray(3))
        xp_assert_close(res.x, xp.asarray(1/3))

        # # TODO: Test zero tolerance
        # # ~~What's going on here - why are iterations repeated?~~
        # # tl goes to zero when xatol=xrtol=0. When function is nearly linear,
        # # this causes convergence issues.
        # def f(x):
        #     return np.cos(x)
        #
        # res = _chandrupatla_root(f, 0, np.pi, xatol=0, xrtol=0)
        # assert res.nit < 100
        # xp = np.nextafter(res.x, np.inf)
        # xm = np.nextafter(res.x, -np.inf)
        # assert np.abs(res.fun) < np.abs(f(xp))
        # assert np.abs(res.fun) < np.abs(f(xm))
