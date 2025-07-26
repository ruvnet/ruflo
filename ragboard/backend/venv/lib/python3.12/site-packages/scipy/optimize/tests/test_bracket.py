import pytest

import numpy as np

from scipy.optimize._bracket import _ELIMITS
from scipy.optimize.elementwise import bracket_root, bracket_minimum
import scipy._lib._elementwise_iterative_method as eim
from scipy import stats
from scipy._lib._array_api_no_0d import (xp_assert_close, xp_assert_equal,
                                         xp_assert_less)
from scipy._lib._array_api import xp_ravel


# These tests were originally written for the private `optimize._bracket`
# interfaces, but now we want the tests to check the behavior of the public
# `optimize.elementwise` interfaces. Therefore, rather than importing
# `_bracket_root`/`_bracket_minimum` from `_bracket.py`, we import
# `bracket_root`/`bracket_minimum` from `optimize.elementwise` and wrap those
# functions to conform to the private interface. This may look a little strange,
# since it effectively just inverts the interface transformation done within the
# `bracket_root`/`bracket_minimum` functions, but it allows us to run the original,
# unmodified tests on the public interfaces, simplifying the PR that adds
# the public interfaces. We'll refactor this when we want to @parametrize the
# tests over multiple `method`s.
def _bracket_root(*args, **kwargs):
    res = bracket_root(*args, **kwargs)
    res.xl, res.xr = res.bracket
    res.fl, res.fr = res.f_bracket
    del res.bracket
    del res.f_bracket
    return res


def _bracket_minimum(*args, **kwargs):
    res = bracket_minimum(*args, **kwargs)
    res.xl, res.xm, res.xr = res.bracket
    res.fl, res.fm, res.fr = res.f_bracket
    del res.bracket
    del res.f_bracket
    return res


array_api_strict_skip_reason = 'Array API does not support fancy indexing assignment.'
boolean_index_skip_reason = 'JAX/Dask arrays do not support boolean assignment.'

@pytest.mark.skip_xp_backends('array_api_strict', reason=array_api_strict_skip_reason)
@pytest.mark.skip_xp_backends('jax.numpy', reason=boolean_index_skip_reason)
@pytest.mark.skip_xp_backends('dask.array', reason=boolean_index_skip_reason)
class TestBracketRoot:
    @pytest.mark.parametrize("seed", (615655101, 3141866013, 238075752))
    @pytest.mark.parametrize("use_xmin", (False, True))
    @pytest.mark.parametrize("other_side", (False, True))
    @pytest.mark.parametrize("fix_one_side", (False, True))
    def test_nfev_expected(self, seed, use_xmin, other_side, fix_one_side, xp):
        # Property-based test to confirm that _bracket_root is behaving as
        # expected. The basic case is when root < a < b.
        # The number of times bracket expands (per side) can be found by
        # setting the expression for the left endpoint of the bracket to the
        # root of f (x=0), solving for i, and rounding up. The corresponding
        # lower and upper ends of the bracket are found by plugging this back
        # into the expression for the ends of the bracket.
        # `other_side=True` is the case that a < b < root
        # Special cases like a < root < b are tested separately
        rng = np.random.default_rng(seed)
        xl0, d, factor = xp.asarray(rng.random(size=3) * [1e5, 10, 5])
        factor = 1 + factor  # factor must be greater than 1
        xr0 = xl0 + d  # xr0 must be greater than a in basic case

        def f(x):
            f.count += 1
            return x  # root is 0

        if use_xmin:
            xmin = xp.asarray(-rng.random())
            n = xp.ceil(xp.log(-(xl0 - xmin) / xmin) / xp.log(factor))
            l, u = xmin + (xl0 - xmin)*factor**-n, xmin + (xl0 - xmin)*factor**-(n - 1)
            kwargs = dict(xl0=xl0, xr0=xr0, factor=factor, xmin=xmin)
        else:
            n = xp.ceil(xp.log(xr0/d) / xp.log(factor))
            l, u = xr0 - d*factor**n, xr0 - d*factor**(n-1)
            kwargs = dict(xl0=xl0, xr0=xr0, factor=factor)

        if other_side:
            kwargs['xl0'], kwargs['xr0'] = -kwargs['xr0'], -kwargs['xl0']
            l, u = -u, -l
            if 'xmin' in kwargs:
                kwargs['xmax'] = -kwargs.pop('xmin')

        if fix_one_side:
            if other_side:
                kwargs['xmin'] = -xr0
            else:
                kwargs['xmax'] = xr0

        f.count = 0
        res = _bracket_root(f, **kwargs)

        # Compare reported number of function evaluations `nfev` against
        # reported `nit`, actual function call count `f.count`, and theoretical
        # number of expansions `n`.
        # When both sides are free, these get multiplied by 2 because function
        # is evaluated on the left and the right each iteration.
        # When one side is fixed, however, we add one: on the right side, the
        # function gets evaluated once at b.
        # Add 1 to `n` and `res.nit` because function evaluations occur at
        # iterations *0*, 1, ..., `n`. Subtract 1 from `f.count` because
        # function is called separately for left and right in iteration 0.
        if not fix_one_side:
            assert res.nfev == 2*(res.nit+1) == 2*(f.count-1) == 2*(n + 1)
        else:
            assert res.nfev == (res.nit+1)+1 == (f.count-1)+1 == (n+1)+1

        # Compare reported bracket to theoretical bracket and reported function
        # values to function evaluated at bracket.
        bracket = xp.asarray([res.xl, res.xr])
        xp_assert_close(bracket, xp.asarray([l, u]))
        f_bracket = xp.asarray([res.fl, res.fr])
        xp_assert_close(f_bracket, f(bracket))

        # Check that bracket is valid and that status and success are correct
        assert res.xr > res.xl
        signs = xp.sign(f_bracket)
        assert signs[0] == -signs[1]
        assert res.status == 0
        assert res.success

    def f(self, q, p):
        return stats._stats_py._SimpleNormal().cdf(q) - p

    @pytest.mark.parametrize('p', [0.6, np.linspace(0.05, 0.95, 10)])
    @pytest.mark.parametrize('xmin', [-5, None])
    @pytest.mark.parametrize('xmax', [5, None])
    @pytest.mark.parametrize('factor', [1.2, 2])
    def test_basic(self, p, xmin, xmax, factor, xp):
        # Test basic functionality to bracket root (distribution PPF)
        res = _bracket_root(self.f, xp.asarray(-0.01), 0.01, xmin=xmin, xmax=xmax,
                            factor=factor, args=(xp.asarray(p),))
        xp_assert_equal(-xp.sign(res.fl), xp.sign(res.fr))

    @pytest.mark.parametrize('shape', [tuple(), (12,), (3, 4), (3, 2, 2)])
    def test_vectorization(self, shape, xp):
        # Test for correct functionality, output shapes, and dtypes for various
        # input shapes.
        p = np.linspace(-0.05, 1.05, 12).reshape(shape) if shape else np.float64(0.6)
        args = (p,)
        maxiter = 10

        @np.vectorize
        def bracket_root_single(xl0, xr0, xmin, xmax, factor, p):
            return _bracket_root(self.f, xl0, xr0, xmin=xmin, xmax=xmax,
                                 factor=factor, args=(p,),
                                 maxiter=maxiter)

        def f(*args, **kwargs):
            f.f_evals += 1
            return self.f(*args, **kwargs)
        f.f_evals = 0

        rng = np.random.default_rng(2348234)
        xl0 = -rng.random(size=shape)
        xr0 = rng.random(size=shape)
        xmin, xmax = 1e3*xl0, 1e3*xr0
        if shape:  # make some elements un
            i = rng.random(size=shape) > 0.5
            xmin[i], xmax[i] = -np.inf, np.inf
        factor = rng.random(size=shape) + 1.5
        refs = bracket_root_single(xl0, xr0, xmin, xmax, factor, p).ravel()
        xl0, xr0, xmin, xmax, factor = (xp.asarray(xl0), xp.asarray(xr0),
                                        xp.asarray(xmin), xp.asarray(xmax),
                                        xp.asarray(factor))
        args = tuple(map(xp.asarray, args))
        res = _bracket_root(f, xl0, xr0, xmin=xmin, xmax=xmax, factor=factor,
                            args=args, maxiter=maxiter)

        attrs = ['xl', 'xr', 'fl', 'fr', 'success', 'nfev', 'nit']
        for attr in attrs:
            ref_attr = [xp.asarray(getattr(ref, attr)) for ref in refs]
            res_attr = getattr(res, attr)
            xp_assert_close(xp_ravel(res_attr, xp=xp), xp.stack(ref_attr))
            assert res_attr.shape == shape

        assert res.success.dtype == xp.bool
        if shape:
            assert xp.all(res.success[1:-1])
        assert res.status.dtype == xp.int32
        assert res.nfev.dtype == xp.int32
        assert res.nit.dtype == xp.int32
        assert xp.max(res.nit) == f.f_evals - 2
        xp_assert_less(res.xl, res.xr)
        xp_assert_close(res.fl, xp.asarray(self.f(res.xl, *args)))
        xp_assert_close(res.fr, xp.asarray(self.f(res.xr, *args)))

    def test_flags(self, xp):
        # Test cases that should produce different status flags; show that all
        # can be produced simultaneously.
        def f(xs, js):
            funcs = [lambda x: x - 1.5,
                     lambda x: x - 1000,
                     lambda x: x - 1000,
                     lambda x: x * xp.nan,
                     lambda x: x]

            return [funcs[int(j)](x) for x, j in zip(xs, js)]

        args = (xp.arange(5, dtype=xp.int64),)
        res = _bracket_root(f,
                            xl0=xp.asarray([-1., -1., -1., -1., 4.]),
                            xr0=xp.asarray([1, 1, 1, 1, -4]),
                            xmin=xp.asarray([-xp.inf, -1, -xp.inf, -xp.inf, 6]),
                            xmax=xp.asarray([xp.inf, 1, xp.inf, xp.inf, 2]),
                            args=args, maxiter=3)

        ref_flags = xp.asarray([eim._ECONVERGED,
                                _ELIMITS,
                                eim._ECONVERR,
                                eim._EVALUEERR,
                                eim._EINPUTERR],
                               dtype=xp.int32)

        xp_assert_equal(res.status, ref_flags)

    @pytest.mark.parametrize("root", (0.622, [0.622, 0.623]))
    @pytest.mark.parametrize('xmin', [-5, None])
    @pytest.mark.parametrize('xmax', [5, None])
    @pytest.mark.parametrize("dtype", ("float16", "float32", "float64"))
    def test_dtype(self, root, xmin, xmax, dtype, xp):
        # Test that dtypes are preserved
        dtype = getattr(xp, dtype)
        xmin = xmin if xmin is None else xp.asarray(xmin, dtype=dtype)
        xmax = xmax if xmax is None else xp.asarray(xmax, dtype=dtype)
        root = xp.asarray(root, dtype=dtype)
        def f(x, root):
            return xp.astype((x - root) ** 3, dtype)

        bracket = xp.asarray([-0.01, 0.01], dtype=dtype)
        res = _bracket_root(f, *bracket, xmin=xmin, xmax=xmax, args=(root,))
        assert xp.all(res.success)
        assert res.xl.dtype == res.xr.dtype == dtype
        assert res.fl.dtype == res.fr.dtype == dtype

    def test_input_validation(self, xp):
        # Test input validation for appropriate error messages

        message = '`func` must be callable.'
        with pytest.raises(ValueError, match=message):
            _bracket_root(None, -4, 4)

        message = '...must be numeric and real.'
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4+1j, 4)
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4, 4+1j)
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4, 4, xmin=4+1j)
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4, 4, xmax=4+1j)
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4, 4, factor=4+1j)

        message = "All elements of `factor` must be greater than 1."
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4, 4, factor=0.5)

        message = "broadcast"
        # raised by `xp.broadcast, but the traceback is readable IMO
        with pytest.raises(Exception, match=message):
            _bracket_root(lambda x: x, xp.asarray([-2, -3]), xp.asarray([3, 4, 5]))
        # Consider making this give a more readable error message
        # with pytest.raises(ValueError, match=message):
        #     _bracket_root(lambda x: [x[0], x[1], x[1]], [-3, -3], [5, 5])

        message = '`maxiter` must be a non-negative integer.'
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4, 4, maxiter=1.5)
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4, 4, maxiter=-1)
        with pytest.raises(ValueError, match=message):
            _bracket_root(lambda x: x, -4, 4, maxiter="shrubbery")

    def test_special_cases(self, xp):
        # Test edge cases and other special cases
        # Test that integers are not passed to `f`
        # (otherwise this would overflow)
        def f(x):
            assert xp.isdtype(x.dtype, "real floating")
            return x ** 99 - 1

        res = _bracket_root(f, xp.asarray(-7.), xp.asarray(5.))
        assert res.success

        # Test maxiter = 0. Should do nothing to bracket.
        def f(x):
            return x - 10

        bracket = (xp.asarray(-3.), xp.asarray(5.))
        res = _bracket_root(f, *bracket, maxiter=0)
        assert res.xl, res.xr == bracket
        assert res.nit == 0
        assert res.nfev == 2
        assert res.status == -2

        # Test scalar `args` (not in tuple)
        def f(x, c):
            return c*x - 1

        res = _bracket_root(f, xp.asarray(-1.), xp.asarray(1.),
                            args=xp.asarray(3.))
        assert res.success
        xp_assert_close(res.fl, f(res.xl, 3))

        # Test other edge cases

        def f(x):
            f.count += 1
            return x

        # 1. root lies within guess of bracket
        f.count = 0
        _bracket_root(f, xp.asarray(-10), xp.asarray(20))
        assert f.count == 2

        # 2. bracket endpoint hits root exactly
        f.count = 0
        res = _bracket_root(f, xp.asarray(5.), xp.asarray(10.),
                            factor=2)

        assert res.nfev == 4
        xp_assert_close(res.xl, xp.asarray(0.), atol=1e-15)
        xp_assert_close(res.xr, xp.asarray(5.), atol=1e-15)

        # 3. bracket limit hits root exactly
        with np.errstate(over='ignore'):
            res = _bracket_root(f, xp.asarray(5.), xp.asarray(10.),
                                xmin=0)
        xp_assert_close(res.xl, xp.asarray(0.), atol=1e-15)

        with np.errstate(over='ignore'):
            res = _bracket_root(f, xp.asarray(-10.), xp.asarray(-5.),
                                xmax=0)
        xp_assert_close(res.xr, xp.asarray(0.), atol=1e-15)

        # 4. bracket not within min, max
        with np.errstate(over='ignore'):
            res = _bracket_root(f, xp.asarray(5.), xp.asarray(10.),
                                xmin=1)
        assert not res.success

    def test_bug_fixes(self):
        # 1. Bug in double sided bracket search.
        # Happened in some cases where there are terminations on one side
        # after corresponding searches on other side failed due to reaching the
        # boundary.

        # https://github.com/scipy/scipy/pull/22560#discussion_r1962853839
        def f(x, p):
            return np.exp(x) - p

        p = np.asarray([0.29, 0.35])
        res = _bracket_root(f, xl0=-1, xmin=-np.inf, xmax=0, args=(p, ))

        # https://github.com/scipy/scipy/pull/22560/files#r1962952517
        def f(x, p, c):
            return np.exp(x*c) - p

        p = [0.32061201, 0.39175242, 0.40047535, 0.50527218, 0.55654373,
             0.11911647, 0.37507896, 0.66554191]
        c = [1., -1., 1., 1., -1., 1., 1., 1.]
        xl0 = [-7.63108551,  3.27840947, -8.36968526, -1.78124372,
               0.92201295, -2.48930123, -0.66733533, -0.44606749]
        xr0 = [-6.63108551,  4.27840947, -7.36968526, -0.78124372,
               1.92201295, -1.48930123, 0., 0.]
        xmin = [-np.inf, 0., -np.inf, -np.inf, 0., -np.inf, -np.inf,
                -np.inf]
        xmax = [0., np.inf, 0., 0., np.inf, 0., 0., 0.]

        res = _bracket_root(f, xl0=xl0, xr0=xr0, xmin=xmin, xmax=xmax, args=(p, c))

        # 2. Default xl0 + 1 for xr0 exceeds xmax.
        # https://github.com/scipy/scipy/pull/22560#discussion_r1962947434
        res = _bracket_root(lambda x: x + 0.25, xl0=-0.5, xmin=-np.inf, xmax=0)
        assert res.success


@pytest.mark.skip_xp_backends('torch', reason='data-apis/array-api-compat#271')
@pytest.mark.skip_xp_backends('array_api_strict', reason=array_api_strict_skip_reason)
@pytest.mark.skip_xp_backends('jax.numpy', reason=boolean_index_skip_reason)
@pytest.mark.skip_xp_backends('dask.array', reason=boolean_index_skip_reason)
class TestBracketMinimum:
    def init_f(self):
        def f(x, a, b):
            f.count += 1
            return (x - a)**2 + b
        f.count = 0
        return f

    def assert_valid_bracket(self, result, xp):
        assert xp.all(
            (result.xl < result.xm) & (result.xm < result.xr)
        )
        assert xp.all(
            (result.fl >= result.fm) & (result.fr > result.fm)
            | (result.fl > result.fm) & (result.fr > result.fm)
        )

    def get_kwargs(
            self, *, xl0=None, xr0=None, factor=None, xmin=None, xmax=None, args=None
    ):
        names = ("xl0", "xr0", "xmin", "xmax", "factor", "args")
        return {
            name: val for name, val in zip(names, (xl0, xr0, xmin, xmax, factor, args))
            if val is not None
        }

    @pytest.mark.parametrize(
        "seed",
        (
            307448016549685229886351382450158984917,
            11650702770735516532954347931959000479,
            113767103358505514764278732330028568336,
        )
    )
    @pytest.mark.parametrize("use_xmin", (False, True))
    @pytest.mark.parametrize("other_side", (False, True))
    def test_nfev_expected(self, seed, use_xmin, other_side, xp):
        rng = np.random.default_rng(seed)
        args = (xp.asarray(0.), xp.asarray(0.))  # f(x) = x^2 with minimum at 0
        # xl0, xm0, xr0 are chosen such that the initial bracket is to
        # the right of the minimum, and the bracket will expand
        # downhill towards zero.
        xl0, d1, d2, factor = xp.asarray(rng.random(size=4) * [1e5, 10, 10, 5])
        xm0 = xl0 + d1
        xr0 = xm0 + d2
        # Factor should be greater than one.
        factor += 1

        if use_xmin:
            xmin = xp.asarray(-rng.random() * 5, dtype=xp.float64)
            n = int(xp.ceil(xp.log(-(xl0 - xmin) / xmin) / xp.log(factor)))
            lower = xmin + (xl0 - xmin)*factor**-n
            middle = xmin + (xl0 - xmin)*factor**-(n-1)
            upper = xmin + (xl0 - xmin)*factor**-(n-2) if n > 1 else xm0
            # It may be the case the lower is below the minimum, but we still
            # don't have a valid bracket.
            if middle**2 > lower**2:
                n += 1
                lower, middle, upper = (
                    xmin + (xl0 - xmin)*factor**-n, lower, middle
                )
        else:
            xmin = None
            n = int(xp.ceil(xp.log(xl0 / d1) / xp.log(factor)))
            lower = xl0 - d1*factor**n
            middle = xl0 - d1*factor**(n-1) if n > 1 else xl0
            upper = xl0 - d1*factor**(n-2) if n > 1 else xm0
            # It may be the case the lower is below the minimum, but we still
            # don't have a valid bracket.
            if middle**2 > lower**2:
                n += 1
                lower, middle, upper = (
                    xl0 - d1*factor**n, lower, middle
                )
        f = self.init_f()

        xmax = None
        if other_side:
            xl0, xm0, xr0 = -xr0, -xm0, -xl0
            xmin, xmax = None, -xmin if xmin is not None else None
            lower, middle, upper = -upper, -middle, -lower

        kwargs = self.get_kwargs(
            xl0=xl0, xr0=xr0, xmin=xmin, xmax=xmax, factor=factor, args=args
        )
        result = _bracket_minimum(f, xp.asarray(xm0), **kwargs)

        # Check that `nfev` and `nit` have the correct relationship
        assert result.nfev == result.nit + 3
        # Check that `nfev` reports the correct number of function evaluations.
        assert result.nfev == f.count
        # Check that the number of iterations matches the theoretical value.
        assert result.nit == n

        # Compare reported bracket to theoretical bracket and reported function
        # values to function evaluated at bracket.
        xp_assert_close(result.xl, lower)
        xp_assert_close(result.xm, middle)
        xp_assert_close(result.xr, upper)
        xp_assert_close(result.fl, f(lower, *args))
        xp_assert_close(result.fm, f(middle, *args))
        xp_assert_close(result.fr, f(upper, *args))

        self.assert_valid_bracket(result, xp)
        assert result.status == 0
        assert result.success

    def test_flags(self, xp):
        # Test cases that should produce different status flags; show that all
        # can be produced simultaneously
        def f(xs, js):
            funcs = [lambda x: (x - 1.5)**2,
                     lambda x: x,
                     lambda x: x,
                     lambda x: xp.asarray(xp.nan),
                     lambda x: x**2]

            return [funcs[int(j)](x) for x, j in zip(xs, js)]

        args = (xp.arange(5, dtype=xp.int64),)
        xl0 = xp.asarray([-1.0, -1.0, -1.0, -1.0, 6.0])
        xm0 = xp.asarray([0.0, 0.0, 0.0, 0.0, 4.0])
        xr0 = xp.asarray([1.0, 1.0, 1.0, 1.0, 2.0])
        xmin = xp.asarray([-xp.inf, -1.0, -xp.inf, -xp.inf, 8.0])

        result = _bracket_minimum(f, xm0, xl0=xl0, xr0=xr0, xmin=xmin,
                                  args=args, maxiter=3)

        reference_flags = xp.asarray([eim._ECONVERGED, _ELIMITS,
                                      eim._ECONVERR, eim._EVALUEERR,
                                      eim._EINPUTERR], dtype=xp.int32)
        xp_assert_equal(result.status, reference_flags)

    @pytest.mark.parametrize("minimum", (0.622, [0.622, 0.623]))
    @pytest.mark.parametrize("dtype", ("float16", "float32", "float64"))
    @pytest.mark.parametrize("xmin", [-5, None])
    @pytest.mark.parametrize("xmax", [5, None])
    def test_dtypes(self, minimum, xmin, xmax, dtype, xp):
        dtype = getattr(xp, dtype)
        xmin = xmin if xmin is None else xp.asarray(xmin, dtype=dtype)
        xmax = xmax if xmax is None else xp.asarray(xmax, dtype=dtype)
        minimum = xp.asarray(minimum, dtype=dtype)

        def f(x, minimum):
            return xp.astype((x - minimum)**2, dtype)

        xl0, xm0, xr0 = [-0.01, 0.0, 0.01]
        result = _bracket_minimum(
            f, xp.asarray(xm0, dtype=dtype), xl0=xp.asarray(xl0, dtype=dtype),
            xr0=xp.asarray(xr0, dtype=dtype), xmin=xmin, xmax=xmax, args=(minimum, )
        )
        assert xp.all(result.success)
        assert result.xl.dtype == result.xm.dtype == result.xr.dtype == dtype
        assert result.fl.dtype == result.fm.dtype == result.fr.dtype == dtype

    @pytest.mark.skip_xp_backends(np_only=True, reason="str/object arrays")
    def test_input_validation(self, xp):
        # Test input validation for appropriate error messages

        message = '`func` must be callable.'
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(None, -4, xl0=4)

        message = '...must be numeric and real.'
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(4+1j))
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(-4), xl0=4+1j)
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(-4), xr0=4+1j)
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(-4), xmin=4+1j)
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(-4), xmax=4+1j)
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(-4), factor=4+1j)

        message = "All elements of `factor` must be greater than 1."
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x, xp.asarray(-4), factor=0.5)

        message = "Array shapes are incompatible for broadcasting."
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray([-2, -3]), xl0=[-3, -4, -5])

        message = '`maxiter` must be a non-negative integer.'
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(-4), xr0=4, maxiter=1.5)
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(-4), xr0=4, maxiter=-1)
        with pytest.raises(ValueError, match=message):
            _bracket_minimum(lambda x: x**2, xp.asarray(-4), xr0=4, maxiter="ekki")

    @pytest.mark.parametrize("xl0", [0.0, None])
    @pytest.mark.parametrize("xm0", (0.05, 0.1, 0.15))
    @pytest.mark.parametrize("xr0", (0.2, 0.4, 0.6, None))
    # Minimum is ``a`` for each tuple ``(a, b)`` below. Tests cases where minimum
    # is within, or at varying distances to the left or right of the initial
    # bracket.
    @pytest.mark.parametrize(
        "args",
        (
            (1.2, 0), (-0.5, 0), (0.1, 0), (0.2, 0), (3.6, 0), (21.4, 0),
            (121.6, 0), (5764.1, 0), (-6.4, 0), (-12.9, 0), (-146.2, 0)
        )
    )
    def test_scalar_no_limits(self, xl0, xm0, xr0, args, xp):
        f = self.init_f()
        kwargs = self.get_kwargs(xl0=xl0, xr0=xr0, args=tuple(map(xp.asarray, args)))
        result = _bracket_minimum(f, xp.asarray(xm0, dtype=xp.float64), **kwargs)
        self.assert_valid_bracket(result, xp)
        assert result.status == 0
        assert result.success
        assert result.nfev == f.count

    @pytest.mark.parametrize(
        # xmin is set at 0.0 in all cases.
        "xl0,xm0,xr0,xmin",
        (
            # Initial bracket at varying distances from the xmin.
            (0.5, 0.75, 1.0, 0.0),
            (1.0, 2.5, 4.0, 0.0),
            (2.0, 4.0, 6.0, 0.0),
            (12.0, 16.0, 20.0, 0.0),
            # Test default initial left endpoint selection. It should not
            # be below xmin.
            (None, 0.75, 1.0, 0.0),
            (None, 2.5, 4.0, 0.0),
            (None, 4.0, 6.0, 0.0),
            (None, 16.0, 20.0, 0.0),
        )
    )
    @pytest.mark.parametrize(
        "args", (
            (0.0, 0.0), # Minimum is directly at xmin.
            (1e-300, 0.0), # Minimum is extremely close to xmin.
            (1e-20, 0.0), # Minimum is very close to xmin.
            # Minimum at varying distances from xmin.
            (0.1, 0.0),
            (0.2, 0.0),
            (0.4, 0.0)
        )
    )
    def test_scalar_with_limit_left(self, xl0, xm0, xr0, xmin, args, xp):
        f = self.init_f()
        kwargs = self.get_kwargs(xl0=xl0, xr0=xr0, xmin=xmin,
                                 args=tuple(map(xp.asarray, args)))
        result = _bracket_minimum(f, xp.asarray(xm0), **kwargs)
        self.assert_valid_bracket(result, xp)
        assert result.status == 0
        assert result.success
        assert result.nfev == f.count

    @pytest.mark.parametrize(
        #xmax is set to 1.0 in all cases.
        "xl0,xm0,xr0,xmax",
        (
            # Bracket at varying distances from xmax.
            (0.2, 0.3, 0.4, 1.0),
            (0.05, 0.075, 0.1, 1.0),
            (-0.2, -0.1, 0.0, 1.0),
            (-21.2, -17.7, -14.2, 1.0),
            # Test default right endpoint selection. It should not exceed xmax.
            (0.2, 0.3, None, 1.0),
            (0.05, 0.075, None, 1.0),
            (-0.2, -0.1, None, 1.0),
            (-21.2, -17.7, None, 1.0),
        )
    )
    @pytest.mark.parametrize(
        "args", (
            (0.9999999999999999, 0.0), # Minimum very close to xmax.
            # Minimum at varying distances from xmax.
            (0.9, 0.0),
            (0.7, 0.0),
            (0.5, 0.0)
        )
    )
    def test_scalar_with_limit_right(self, xl0, xm0, xr0, xmax, args, xp):
        f = self.init_f()
        args = tuple(xp.asarray(arg, dtype=xp.float64) for arg in args)
        kwargs = self.get_kwargs(xl0=xl0, xr0=xr0, xmax=xmax, args=args)
        result = _bracket_minimum(f, xp.asarray(xm0, dtype=xp.float64), **kwargs)
        self.assert_valid_bracket(result, xp)
        assert result.status == 0
        assert result.success
        assert result.nfev == f.count

    @pytest.mark.parametrize(
        "xl0,xm0,xr0,xmin,xmax,args",
        (
            (   # Case 1:
                # Initial bracket.
                0.2,
                0.3,
                0.4,
                # Function slopes down to the right from the bracket to a minimum
                # at 1.0. xmax is also at 1.0
                None,
                1.0,
                (1.0, 0.0)
            ),
            (   # Case 2:
                # Initial bracket.
                1.4,
                1.95,
                2.5,
                # Function slopes down to the left from the bracket to a minimum at
                # 0.3 with xmin set to 0.3.
                0.3,
                None,
                (0.3, 0.0)
            ),
            (
                # Case 3:
                # Initial bracket.
                2.6,
                3.25,
                3.9,
                # Function slopes down and to the right to a minimum at 99.4 with xmax
                # at 99.4. Tests case where minimum is at xmax relatively further from
                # the bracket.
                None,
                99.4,
                (99.4, 0)
            ),
            (
                # Case 4:
                # Initial bracket.
                4,
                4.5,
                5,
                # Function slopes down and to the left away from the bracket with a
                # minimum at -26.3 with xmin set to -26.3. Tests case where minimum is
                # at xmin relatively far from the bracket.
                -26.3,
                None,
                (-26.3, 0)
            ),
            (
                # Case 5:
                # Similar to Case 1 above, but tests default values of xl0 and xr0.
                None,
                0.3,
                None,
                None,
                1.0,
                (1.0, 0.0)
            ),
            (   # Case 6:
                # Similar to Case 2 above, but tests default values of xl0 and xr0.
                None,
                1.95,
                None,
                0.3,
                None,
                (0.3, 0.0)
            ),
            (
                # Case 7:
                # Similar to Case 3 above, but tests default values of xl0 and xr0.
                None,
                3.25,
                None,
                None,
                99.4,
                (99.4, 0)
            ),
            (
                # Case 8:
                # Similar to Case 4 above, but tests default values of xl0 and xr0.
                None,
                4.5,
                None,
                -26.3,
                None,
                (-26.3, 0)
            ),
        )
    )
    def test_minimum_at_boundary_point(self, xl0, xm0, xr0, xmin, xmax, args, xp):
        f = self.init_f()
        kwargs = self.get_kwargs(xr0=xr0, xmin=xmin, xmax=xmax,
                                 args=tuple(map(xp.asarray, args)))
        result = _bracket_minimum(f, xp.asarray(xm0), **kwargs)
        assert result.status == -1
        assert args[0] in (result.xl, result.xr)
        assert result.nfev == f.count

    @pytest.mark.parametrize('shape', [tuple(), (12, ), (3, 4), (3, 2, 2)])
    def test_vectorization(self, shape, xp):
        # Test for correct functionality, output shapes, and dtypes for
        # various input shapes.
        a = np.linspace(-0.05, 1.05, 12).reshape(shape) if shape else 0.6
        args = (a, 0.)
        maxiter = 10

        @np.vectorize
        def bracket_minimum_single(xm0, xl0, xr0, xmin, xmax, factor, a):
            return _bracket_minimum(self.init_f(), xm0, xl0=xl0, xr0=xr0, xmin=xmin,
                                    xmax=xmax, factor=factor, maxiter=maxiter,
                                    args=(a, 0.0))

        f = self.init_f()

        rng = np.random.default_rng(2348234)
        xl0 = -rng.random(size=shape)
        xr0 = rng.random(size=shape)
        xm0 = xl0 + rng.random(size=shape) * (xr0 - xl0)
        xmin, xmax = 1e3*xl0, 1e3*xr0
        if shape:  # make some elements un
            i = rng.random(size=shape) > 0.5
            xmin[i], xmax[i] = -np.inf, np.inf
        factor = rng.random(size=shape) + 1.5
        refs = bracket_minimum_single(xm0, xl0, xr0, xmin, xmax, factor, a).ravel()
        args = tuple(xp.asarray(arg, dtype=xp.float64) for arg in args)
        res = _bracket_minimum(f, xp.asarray(xm0), xl0=xp.asarray(xl0),
                               xr0=xp.asarray(xr0), xmin=xp.asarray(xmin),
                               xmax=xp.asarray(xmax), factor=xp.asarray(factor),
                               args=args, maxiter=maxiter)

        attrs = ['xl', 'xm', 'xr', 'fl', 'fm', 'fr', 'success', 'nfev', 'nit']
        for attr in attrs:
            ref_attr = [xp.asarray(getattr(ref, attr)) for ref in refs]
            res_attr = getattr(res, attr)
            xp_assert_close(xp_ravel(res_attr, xp=xp), xp.stack(ref_attr))
            assert res_attr.shape == shape

        assert res.success.dtype == xp.bool
        if shape:
            assert xp.all(res.success[1:-1])
        assert res.status.dtype == xp.int32
        assert res.nfev.dtype == xp.int32
        assert res.nit.dtype == xp.int32
        assert xp.max(res.nit) == f.count - 3
        self.assert_valid_bracket(res, xp)
        xp_assert_close(res.fl, f(res.xl, *args))
        xp_assert_close(res.fm, f(res.xm, *args))
        xp_assert_close(res.fr, f(res.xr, *args))

    def test_special_cases(self, xp):
        # Test edge cases and other special cases.

        # Test that integers are not passed to `f`
        # (otherwise this would overflow)
        def f(x):
            assert xp.isdtype(x.dtype, "numeric")
            return x ** 98 - 1

        result = _bracket_minimum(f, xp.asarray(-7., dtype=xp.float64), xr0=5)
        assert result.success

        # Test maxiter = 0. Should do nothing to bracket.
        def f(x):
            return x**2 - 10

        xl0, xm0, xr0 = xp.asarray(-3.), xp.asarray(-1.), xp.asarray(2.)
        result = _bracket_minimum(f, xm0, xl0=xl0, xr0=xr0, maxiter=0)
        xp_assert_equal(result.xl, xl0)
        xp_assert_equal(result.xm, xm0)
        xp_assert_equal(result.xr, xr0)

        # Test scalar `args` (not in tuple)
        def f(x, c):
            return c*x**2 - 1

        result = _bracket_minimum(f, xp.asarray(-1.), args=xp.asarray(3.))
        assert result.success
        xp_assert_close(result.fl, f(result.xl, 3))

        # Initial bracket is valid.
        f = self.init_f()
        xl0, xm0, xr0 = xp.asarray(-1.0), xp.asarray(-0.2), xp.asarray(1.0)
        args = (xp.asarray(0.), xp.asarray(0.))
        result = _bracket_minimum(f, xm0, xl0=xl0, xr0=xr0, args=args)
        assert f.count == 3

        xp_assert_equal(result.xl, xl0)
        xp_assert_equal(result.xm , xm0)
        xp_assert_equal(result.xr, xr0)
        xp_assert_equal(result.fl, f(xl0, *args))
        xp_assert_equal(result.fm, f(xm0, *args))
        xp_assert_equal(result.fr, f(xr0, *args))

    def test_gh_20562_left(self, xp):
        # Regression test for https://github.com/scipy/scipy/issues/20562
        # minimum of f in [xmin, xmax] is at xmin.
        xmin, xmax = xp.asarray(0.21933608), xp.asarray(1.39713606)

        def f(x):
            log_a, log_b = xp.log(xmin), xp.log(xmax)
            return -((log_b - log_a)*x)**-1

        result = _bracket_minimum(f, xp.asarray(0.5535723499480897), xmin=xmin,
                                  xmax=xmax)
        xp_assert_close(result.xl, xmin)

    def test_gh_20562_right(self, xp):
        # Regression test for https://github.com/scipy/scipy/issues/20562
        # minimum of f in [xmin, xmax] is at xmax.
        xmin, xmax = xp.asarray(-1.39713606), xp.asarray(-0.21933608)

        def f(x):
            log_a, log_b = xp.log(-xmax), xp.log(-xmin)
            return ((log_b - log_a)*x)**-1

        result = _bracket_minimum(f, xp.asarray(-0.5535723499480897),
                                  xmin=xmin, xmax=xmax)
        xp_assert_close(result.xr, xmax)
