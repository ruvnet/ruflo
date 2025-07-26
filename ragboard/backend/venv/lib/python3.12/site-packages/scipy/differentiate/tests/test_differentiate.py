import math
import pytest

import numpy as np

import scipy._lib._elementwise_iterative_method as eim
import scipy._lib.array_api_extra as xpx
from scipy._lib._array_api_no_0d import xp_assert_close, xp_assert_equal, xp_assert_less
from scipy._lib._array_api import is_numpy, is_torch

from scipy import stats, optimize, special
from scipy.differentiate import derivative, jacobian, hessian
from scipy.differentiate._differentiate import _EERRORINCREASE

array_api_strict_skip_reason = 'Array API does not support fancy indexing assignment.'


@pytest.mark.skip_xp_backends('array_api_strict', reason=array_api_strict_skip_reason)
@pytest.mark.skip_xp_backends('dask.array', reason='boolean indexing assignment')
class TestDerivative:

    def f(self, x):
        return special.ndtr(x)

    @pytest.mark.parametrize('x', [0.6, np.linspace(-0.05, 1.05, 10)])
    def test_basic(self, x, xp):
        # Invert distribution CDF and compare against distribution `ppf`
        default_dtype = xp.asarray(1.).dtype
        res = derivative(self.f, xp.asarray(x, dtype=default_dtype))
        ref = xp.asarray(stats.norm().pdf(x), dtype=default_dtype)
        xp_assert_close(res.df, ref)
        # This would be nice, but doesn't always work out. `error` is an
        # estimate, not a bound.
        if not is_torch(xp):
            xp_assert_less(xp.abs(res.df - ref), res.error)

    @pytest.mark.skip_xp_backends(np_only=True)
    @pytest.mark.parametrize('case', stats._distr_params.distcont)
    def test_accuracy(self, case, xp):
        distname, params = case
        dist = getattr(stats, distname)(*params)
        x = dist.median() + 0.1
        res = derivative(dist.cdf, x)
        ref = dist.pdf(x)
        xp_assert_close(res.df, ref, atol=1e-10)

    @pytest.mark.parametrize('order', [1, 6])
    @pytest.mark.parametrize('shape', [tuple(), (12,), (3, 4), (3, 2, 2)])
    def test_vectorization(self, order, shape, xp):
        # Test for correct functionality, output shapes, and dtypes for various
        # input shapes.
        x = np.linspace(-0.05, 1.05, 12).reshape(shape) if shape else 0.6
        n = np.size(x)
        state = {}

        @np.vectorize
        def _derivative_single(x):
            return derivative(self.f, x, order=order)

        def f(x, *args, **kwargs):
            state['nit'] += 1
            state['feval'] += 1 if (x.size == n or x.ndim <=1) else x.shape[-1]
            return self.f(x, *args, **kwargs)

        state['nit'] = -1
        state['feval'] = 0

        res = derivative(f, xp.asarray(x, dtype=xp.float64), order=order)
        refs = _derivative_single(x).ravel()

        ref_x = [ref.x for ref in refs]
        xp_assert_close(xp.reshape(res.x, (-1,)), xp.asarray(ref_x))

        ref_df = [ref.df for ref in refs]
        xp_assert_close(xp.reshape(res.df, (-1,)), xp.asarray(ref_df))

        ref_error = [ref.error for ref in refs]
        xp_assert_close(xp.reshape(res.error, (-1,)), xp.asarray(ref_error),
                        atol=1e-12)

        ref_success = [bool(ref.success) for ref in refs]
        xp_assert_equal(xp.reshape(res.success, (-1,)), xp.asarray(ref_success))

        ref_flag = [np.int32(ref.status) for ref in refs]
        xp_assert_equal(xp.reshape(res.status, (-1,)), xp.asarray(ref_flag))

        ref_nfev = [np.int32(ref.nfev) for ref in refs]
        xp_assert_equal(xp.reshape(res.nfev, (-1,)), xp.asarray(ref_nfev))
        if is_numpy(xp):  # can't expect other backends to be exactly the same
            assert xp.max(res.nfev) == state['feval']

        ref_nit = [np.int32(ref.nit) for ref in refs]
        xp_assert_equal(xp.reshape(res.nit, (-1,)), xp.asarray(ref_nit))
        if is_numpy(xp):  # can't expect other backends to be exactly the same
            assert xp.max(res.nit) == state['nit']

    def test_flags(self, xp):
        # Test cases that should produce different status flags; show that all
        # can be produced simultaneously.
        rng = np.random.default_rng(5651219684984213)
        def f(xs, js):
            f.nit += 1
            funcs = [lambda x: x - 2.5,  # converges
                     lambda x: xp.exp(x)*rng.random(),  # error increases
                     lambda x: xp.exp(x),  # reaches maxiter due to order=2
                     lambda x: xp.full_like(x, xp.nan)]  # stops due to NaN
            res = [funcs[int(j)](x) for x, j in zip(xs, xp.reshape(js, (-1,)))]
            return xp.stack(res)
        f.nit = 0

        args = (xp.arange(4, dtype=xp.int64),)
        res = derivative(f, xp.ones(4, dtype=xp.float64),
                         tolerances=dict(rtol=1e-14),
                         order=2, args=args)

        ref_flags = xp.asarray([eim._ECONVERGED,
                                _EERRORINCREASE,
                                eim._ECONVERR,
                                eim._EVALUEERR], dtype=xp.int32)
        xp_assert_equal(res.status, ref_flags)

    def test_flags_preserve_shape(self, xp):
        # Same test as above but using `preserve_shape` option to simplify.
        rng = np.random.default_rng(5651219684984213)
        def f(x):
            out = [x - 2.5,  # converges
                   xp.exp(x)*rng.random(),  # error increases
                   xp.exp(x),  # reaches maxiter due to order=2
                   xp.full_like(x, xp.nan)]  # stops due to NaN
            return xp.stack(out)

        res = derivative(f, xp.asarray(1, dtype=xp.float64),
                         tolerances=dict(rtol=1e-14),
                         order=2, preserve_shape=True)

        ref_flags = xp.asarray([eim._ECONVERGED,
                                _EERRORINCREASE,
                                eim._ECONVERR,
                                eim._EVALUEERR], dtype=xp.int32)
        xp_assert_equal(res.status, ref_flags)

    def test_preserve_shape(self, xp):
        # Test `preserve_shape` option
        def f(x):
            out = [x, xp.sin(3*x), x+xp.sin(10*x), xp.sin(20*x)*(x-1)**2]
            return xp.stack(out)

        x = xp.asarray(0.)
        ref = xp.asarray([xp.asarray(1), 3*xp.cos(3*x), 1+10*xp.cos(10*x),
                          20*xp.cos(20*x)*(x-1)**2 + 2*xp.sin(20*x)*(x-1)])
        res = derivative(f, x, preserve_shape=True)
        xp_assert_close(res.df, ref)

    def test_convergence(self, xp):
        # Test that the convergence tolerances behave as expected
        x = xp.asarray(1., dtype=xp.float64)
        f = special.ndtr
        ref = float(stats.norm.pdf(1.))
        tolerances0 = dict(atol=0, rtol=0)

        tolerances = tolerances0.copy()
        tolerances['atol'] = 1e-3
        res1 = derivative(f, x, tolerances=tolerances, order=4)
        assert abs(res1.df - ref) < 1e-3
        tolerances['atol'] = 1e-6
        res2 = derivative(f, x, tolerances=tolerances, order=4)
        assert abs(res2.df - ref) < 1e-6
        assert abs(res2.df - ref) < abs(res1.df - ref)

        tolerances = tolerances0.copy()
        tolerances['rtol'] = 1e-3
        res1 = derivative(f, x, tolerances=tolerances, order=4)
        assert abs(res1.df - ref) < 1e-3 * ref
        tolerances['rtol'] = 1e-6
        res2 = derivative(f, x, tolerances=tolerances, order=4)
        assert abs(res2.df - ref) < 1e-6 * ref
        assert abs(res2.df - ref) < abs(res1.df - ref)

    def test_step_parameters(self, xp):
        # Test that step factors have the expected effect on accuracy
        x = xp.asarray(1., dtype=xp.float64)
        f = special.ndtr
        ref = float(stats.norm.pdf(1.))

        res1 = derivative(f, x, initial_step=0.5, maxiter=1)
        res2 = derivative(f, x, initial_step=0.05, maxiter=1)
        assert abs(res2.df - ref) < abs(res1.df - ref)

        res1 = derivative(f, x, step_factor=2, maxiter=1)
        res2 = derivative(f, x, step_factor=20, maxiter=1)
        assert abs(res2.df - ref) < abs(res1.df - ref)

        # `step_factor` can be less than 1: `initial_step` is the minimum step
        kwargs = dict(order=4, maxiter=1, step_direction=0)
        res = derivative(f, x, initial_step=0.5, step_factor=0.5, **kwargs)
        ref = derivative(f, x, initial_step=1, step_factor=2, **kwargs)
        xp_assert_close(res.df, ref.df, rtol=5e-15)

        # This is a similar test for one-sided difference
        kwargs = dict(order=2, maxiter=1, step_direction=1)
        res = derivative(f, x, initial_step=1, step_factor=2, **kwargs)
        ref = derivative(f, x, initial_step=1/np.sqrt(2), step_factor=0.5, **kwargs)
        xp_assert_close(res.df, ref.df, rtol=5e-15)

        kwargs['step_direction'] = -1
        res = derivative(f, x, initial_step=1, step_factor=2, **kwargs)
        ref = derivative(f, x, initial_step=1/np.sqrt(2), step_factor=0.5, **kwargs)
        xp_assert_close(res.df, ref.df, rtol=5e-15)

    def test_step_direction(self, xp):
        # test that `step_direction` works as expected
        def f(x):
            y = xp.exp(x)
            y = xpx.at(y)[(x < 0) + (x > 2)].set(xp.nan)
            return y

        x = xp.linspace(0, 2, 10)
        step_direction = xp.zeros_like(x)
        step_direction = xpx.at(step_direction)[x < 0.6].set(1)
        step_direction = xpx.at(step_direction)[x > 1.4].set(-1)
        res = derivative(f, x, step_direction=step_direction)
        xp_assert_close(res.df, xp.exp(x))
        assert xp.all(res.success)

    def test_vectorized_step_direction_args(self, xp):
        # test that `step_direction` and `args` are vectorized properly
        def f(x, p):
            return x ** p

        def df(x, p):
            return p * x ** (p - 1)

        x = xp.reshape(xp.asarray([1, 2, 3, 4]), (-1, 1, 1))
        hdir = xp.reshape(xp.asarray([-1, 0, 1]), (1, -1, 1))
        p = xp.reshape(xp.asarray([2, 3]), (1, 1, -1))
        res = derivative(f, x, step_direction=hdir, args=(p,))
        ref = xp.broadcast_to(df(x, p), res.df.shape)
        ref = xp.asarray(ref, dtype=xp.asarray(1.).dtype)
        xp_assert_close(res.df, ref)

    def test_initial_step(self, xp):
        # Test that `initial_step` works as expected and is vectorized
        def f(x):
            return xp.exp(x)

        x = xp.asarray(0., dtype=xp.float64)
        step_direction = xp.asarray([-1, 0, 1])
        h0 = xp.reshape(xp.logspace(-3, 0, 10), (-1, 1))
        res = derivative(f, x, initial_step=h0, order=2, maxiter=1,
                         step_direction=step_direction)
        err = xp.abs(res.df - f(x))

        # error should be smaller for smaller step sizes
        assert xp.all(err[:-1, ...] < err[1:, ...])

        # results of vectorized call should match results with
        # initial_step taken one at a time
        for i in range(h0.shape[0]):
            ref = derivative(f, x, initial_step=h0[i, 0], order=2, maxiter=1,
                             step_direction=step_direction)
            xp_assert_close(res.df[i, :], ref.df, rtol=1e-14)

    def test_maxiter_callback(self, xp):
        # Test behavior of `maxiter` parameter and `callback` interface
        x = xp.asarray(0.612814, dtype=xp.float64)
        maxiter = 3

        def f(x):
            res = special.ndtr(x)
            return res

        default_order = 8
        res = derivative(f, x, maxiter=maxiter, tolerances=dict(rtol=1e-15))
        assert not xp.any(res.success)
        assert xp.all(res.nfev == default_order + 1 + (maxiter - 1)*2)
        assert xp.all(res.nit == maxiter)

        def callback(res):
            callback.iter += 1
            callback.res = res
            assert hasattr(res, 'x')
            assert float(res.df) not in callback.dfs
            callback.dfs.add(float(res.df))
            assert res.status == eim._EINPROGRESS
            if callback.iter == maxiter:
                raise StopIteration
        callback.iter = -1  # callback called once before first iteration
        callback.res = None
        callback.dfs = set()

        res2 = derivative(f, x, callback=callback, tolerances=dict(rtol=1e-15))
        # terminating with callback is identical to terminating due to maxiter
        # (except for `status`)
        for key in res.keys():
            if key == 'status':
                assert res[key] == eim._ECONVERR
                assert res2[key] == eim._ECALLBACK
            else:
                assert res2[key] == callback.res[key] == res[key]

    @pytest.mark.parametrize("hdir", (-1, 0, 1))
    @pytest.mark.parametrize("x", (0.65, [0.65, 0.7]))
    @pytest.mark.parametrize("dtype", ('float16', 'float32', 'float64'))
    def test_dtype(self, hdir, x, dtype, xp):
        if dtype == 'float16' and not is_numpy(xp):
            pytest.skip('float16 not tested for alternative backends')

        # Test that dtypes are preserved
        dtype = getattr(xp, dtype)
        x = xp.asarray(x, dtype=dtype)

        def f(x):
            assert x.dtype == dtype
            return xp.exp(x)

        def callback(res):
            assert res.x.dtype == dtype
            assert res.df.dtype == dtype
            assert res.error.dtype == dtype

        res = derivative(f, x, order=4, step_direction=hdir, callback=callback)
        assert res.x.dtype == dtype
        assert res.df.dtype == dtype
        assert res.error.dtype == dtype
        eps = xp.finfo(dtype).eps
        # not sure why torch is less accurate here; might be worth investigating
        rtol = eps**0.5 * 50 if is_torch(xp) else eps**0.5
        xp_assert_close(res.df, xp.exp(res.x), rtol=rtol)

    def test_input_validation(self, xp):
        # Test input validation for appropriate error messages
        one = xp.asarray(1)

        message = '`f` must be callable.'
        with pytest.raises(ValueError, match=message):
            derivative(None, one)

        message = 'Abscissae and function output must be real numbers.'
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, xp.asarray(-4+1j))

        message = "When `preserve_shape=False`, the shape of the array..."
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: [1, 2, 3], xp.asarray([-2, -3]))

        message = 'Tolerances and step parameters must be non-negative...'
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, tolerances=dict(atol=-1))
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, tolerances=dict(rtol='ekki'))
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, step_factor=object())

        message = '`maxiter` must be a positive integer.'
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, maxiter=1.5)
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, maxiter=0)

        message = '`order` must be a positive integer'
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, order=1.5)
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, order=0)

        message = '`preserve_shape` must be True or False.'
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, preserve_shape='herring')

        message = '`callback` must be callable.'
        with pytest.raises(ValueError, match=message):
            derivative(lambda x: x, one, callback='shrubbery')

    def test_special_cases(self, xp):
        # Test edge cases and other special cases

        # Test that integers are not passed to `f`
        # (otherwise this would overflow)
        def f(x):
            assert xp.isdtype(x.dtype, 'real floating')
            return x ** 99 - 1

        if not is_torch(xp):  # torch defaults to float32
            res = derivative(f, xp.asarray(7), tolerances=dict(rtol=1e-10))
            assert res.success
            xp_assert_close(res.df, xp.asarray(99*7.**98))

        # Test invalid step size and direction
        res = derivative(xp.exp, xp.asarray(1), step_direction=xp.nan)
        xp_assert_equal(res.df, xp.asarray(xp.nan))
        xp_assert_equal(res.status, xp.asarray(-3, dtype=xp.int32))

        res = derivative(xp.exp, xp.asarray(1), initial_step=0)
        xp_assert_equal(res.df, xp.asarray(xp.nan))
        xp_assert_equal(res.status, xp.asarray(-3, dtype=xp.int32))

        # Test that if success is achieved in the correct number
        # of iterations if function is a polynomial. Ideally, all polynomials
        # of order 0-2 would get exact result with 0 refinement iterations,
        # all polynomials of order 3-4 would be differentiated exactly after
        # 1 iteration, etc. However, it seems that `derivative` needs an
        # extra iteration to detect convergence based on the error estimate.

        for n in range(6):
            x = xp.asarray(1.5, dtype=xp.float64)
            def f(x):
                return 2*x**n

            ref = 2*n*x**(n-1)

            res = derivative(f, x, maxiter=1, order=max(1, n))
            xp_assert_close(res.df, ref, rtol=1e-15)
            xp_assert_equal(res.error, xp.asarray(xp.nan, dtype=xp.float64))

            res = derivative(f, x, order=max(1, n))
            assert res.success
            assert res.nit == 2
            xp_assert_close(res.df, ref, rtol=1e-15)

        # Test scalar `args` (not in tuple)
        def f(x, c):
            return c*x - 1

        res = derivative(f, xp.asarray(2), args=xp.asarray(3))
        xp_assert_close(res.df, xp.asarray(3.))

    # no need to run a test on multiple backends if it's xfailed
    @pytest.mark.skip_xp_backends(np_only=True)
    @pytest.mark.xfail
    @pytest.mark.parametrize("case", (  # function, evaluation point
        (lambda x: (x - 1) ** 3, 1),
        (lambda x: np.where(x > 1, (x - 1) ** 5, (x - 1) ** 3), 1)
    ))
    def test_saddle_gh18811(self, case, xp):
        # With default settings, `derivative` will not always converge when
        # the true derivative is exactly zero. This tests that specifying a
        # (tight) `atol` alleviates the problem. See discussion in gh-18811.
        atol = 1e-16
        res = derivative(*case, step_direction=[-1, 0, 1], atol=atol)
        assert np.all(res.success)
        xp_assert_close(res.df, 0, atol=atol)


class JacobianHessianTest:
    def test_iv(self, xp):
        jh_func = self.jh_func.__func__

        # Test input validation
        message = "Argument `x` must be at least 1-D."
        with pytest.raises(ValueError, match=message):
            jh_func(xp.sin, 1, tolerances=dict(atol=-1))

        # Confirm that other parameters are being passed to `derivative`,
        # which raises an appropriate error message.
        x = xp.ones(3)
        func = optimize.rosen
        message = 'Tolerances and step parameters must be non-negative scalars.'
        with pytest.raises(ValueError, match=message):
            jh_func(func, x, tolerances=dict(atol=-1))
        with pytest.raises(ValueError, match=message):
            jh_func(func, x, tolerances=dict(rtol=-1))
        with pytest.raises(ValueError, match=message):
            jh_func(func, x, step_factor=-1)

        message = '`order` must be a positive integer.'
        with pytest.raises(ValueError, match=message):
            jh_func(func, x, order=-1)

        message = '`maxiter` must be a positive integer.'
        with pytest.raises(ValueError, match=message):
            jh_func(func, x, maxiter=-1)


@pytest.mark.skip_xp_backends('array_api_strict', reason=array_api_strict_skip_reason)
@pytest.mark.skip_xp_backends('dask.array', reason='boolean indexing assignment')
class TestJacobian(JacobianHessianTest):
    jh_func = jacobian

    # Example functions and Jacobians from Wikipedia:
    # https://en.wikipedia.org/wiki/Jacobian_matrix_and_determinant#Examples

    def f1(z, xp):
        x, y = z
        return xp.stack([x ** 2 * y, 5 * x + xp.sin(y)])

    def df1(z):
        x, y = z
        return [[2 * x * y, x ** 2], [np.full_like(x, 5), np.cos(y)]]

    f1.mn = 2, 2  # type: ignore[attr-defined]
    f1.ref = df1  # type: ignore[attr-defined]

    def f2(z, xp):
        r, phi = z
        return xp.stack([r * xp.cos(phi), r * xp.sin(phi)])

    def df2(z):
        r, phi = z
        return [[np.cos(phi), -r * np.sin(phi)],
                [np.sin(phi), r * np.cos(phi)]]

    f2.mn = 2, 2  # type: ignore[attr-defined]
    f2.ref = df2  # type: ignore[attr-defined]

    def f3(z, xp):
        r, phi, th = z
        return xp.stack([r * xp.sin(phi) * xp.cos(th), r * xp.sin(phi) * xp.sin(th),
                         r * xp.cos(phi)])

    def df3(z):
        r, phi, th = z
        return [[np.sin(phi) * np.cos(th), r * np.cos(phi) * np.cos(th),
                 -r * np.sin(phi) * np.sin(th)],
                [np.sin(phi) * np.sin(th), r * np.cos(phi) * np.sin(th),
                 r * np.sin(phi) * np.cos(th)],
                [np.cos(phi), -r * np.sin(phi), np.zeros_like(r)]]

    f3.mn = 3, 3  # type: ignore[attr-defined]
    f3.ref = df3  # type: ignore[attr-defined]

    def f4(x, xp):
        x1, x2, x3 = x
        return xp.stack([x1, 5 * x3, 4 * x2 ** 2 - 2 * x3, x3 * xp.sin(x1)])

    def df4(x):
        x1, x2, x3 = x
        one = np.ones_like(x1)
        return [[one, 0 * one, 0 * one],
                [0 * one, 0 * one, 5 * one],
                [0 * one, 8 * x2, -2 * one],
                [x3 * np.cos(x1), 0 * one, np.sin(x1)]]

    f4.mn = 3, 4  # type: ignore[attr-defined]
    f4.ref = df4  # type: ignore[attr-defined]

    def f5(x, xp):
        x1, x2, x3 = x
        return xp.stack([5 * x2, 4 * x1 ** 2 - 2 * xp.sin(x2 * x3), x2 * x3])

    def df5(x):
        x1, x2, x3 = x
        one = np.ones_like(x1)
        return [[0 * one, 5 * one, 0 * one],
                [8 * x1, -2 * x3 * np.cos(x2 * x3), -2 * x2 * np.cos(x2 * x3)],
                [0 * one, x3, x2]]

    f5.mn = 3, 3  # type: ignore[attr-defined]
    f5.ref = df5  # type: ignore[attr-defined]

    def rosen(x, _): return optimize.rosen(x)
    rosen.mn = 5, 1  # type: ignore[attr-defined]
    rosen.ref = optimize.rosen_der  # type: ignore[attr-defined]

    @pytest.mark.parametrize('dtype', ('float32', 'float64'))
    @pytest.mark.parametrize('size', [(), (6,), (2, 3)])
    @pytest.mark.parametrize('func', [f1, f2, f3, f4, f5, rosen])
    def test_examples(self, dtype, size, func, xp):
        atol = 1e-10 if dtype == 'float64' else 1.99e-3
        dtype = getattr(xp, dtype)
        rng = np.random.default_rng(458912319542)
        m, n = func.mn
        x = rng.random(size=(m,) + size)
        res = jacobian(lambda x: func(x , xp), xp.asarray(x, dtype=dtype))
        # convert list of arrays to single array before converting to xp array
        ref = xp.asarray(np.asarray(func.ref(x)), dtype=dtype)
        xp_assert_close(res.df, ref, atol=atol)

    def test_attrs(self, xp):
        # Test attributes of result object
        z = xp.asarray([0.5, 0.25])

        # case in which some elements of the Jacobian are harder
        # to calculate than others
        def df1(z):
            x, y = z
            return xp.stack([xp.cos(0.5*x) * xp.cos(y), xp.sin(2*x) * y**2])

        def df1_0xy(x, y):
            return xp.cos(0.5*x) * xp.cos(y)

        def df1_1xy(x, y):
            return xp.sin(2*x) * y**2

        res = jacobian(df1, z, initial_step=10)
        # FIXME https://github.com/scipy/scipy/pull/22320#discussion_r1914898175
        if not is_torch(xp):
            assert xpx.nunique(res.nit) == 4
            assert xpx.nunique(res.nfev) == 4

        res00 = jacobian(lambda x: df1_0xy(x, z[1]), z[0:1], initial_step=10)
        res01 = jacobian(lambda y: df1_0xy(z[0], y), z[1:2], initial_step=10)
        res10 = jacobian(lambda x: df1_1xy(x, z[1]), z[0:1], initial_step=10)
        res11 = jacobian(lambda y: df1_1xy(z[0], y), z[1:2], initial_step=10)
        ref = optimize.OptimizeResult()
        for attr in ['success', 'status', 'df', 'nit', 'nfev']:
            ref_attr = xp.asarray([[getattr(res00, attr), getattr(res01, attr)],
                                   [getattr(res10, attr), getattr(res11, attr)]])
            ref[attr] = xp.squeeze(
                ref_attr,
                axis=tuple(ax for ax, size in enumerate(ref_attr.shape) if size == 1)
            )
            rtol = 1.5e-5 if res[attr].dtype == xp.float32 else 1.5e-14
            xp_assert_close(res[attr], ref[attr], rtol=rtol)

    def test_step_direction_size(self, xp):
        # Check that `step_direction` and `initial_step` can be used to ensure that
        # the usable domain of a function is respected.
        rng = np.random.default_rng(23892589425245)
        b = rng.random(3)
        eps = 1e-7  # torch needs wiggle room?

        def f(x):
            x = xpx.at(x)[0, x[0] < b[0]].set(xp.nan)
            x = xpx.at(x)[0, x[0] > b[0] + 0.25].set(xp.nan)
            x = xpx.at(x)[1, x[1] > b[1]].set(xp.nan)
            x = xpx.at(x)[1, x[1] < b[1] - 0.1-eps].set(xp.nan)
            return TestJacobian.f5(x, xp)

        dir = [1, -1, 0]
        h0 = [0.25, 0.1, 0.5]
        atol = {'atol': 1e-8}
        res = jacobian(f, xp.asarray(b, dtype=xp.float64), initial_step=h0,
                       step_direction=dir, tolerances=atol)
        ref = xp.asarray(TestJacobian.df5(b), dtype=xp.float64)
        xp_assert_close(res.df, ref, atol=1e-8)
        assert xp.all(xp.isfinite(ref))


@pytest.mark.skip_xp_backends('array_api_strict', reason=array_api_strict_skip_reason)
@pytest.mark.skip_xp_backends('dask.array', reason='boolean indexing assignment')
class TestHessian(JacobianHessianTest):
    jh_func = hessian

    @pytest.mark.parametrize('shape', [(), (4,), (2, 4)])
    def test_example(self, shape, xp):
        rng = np.random.default_rng(458912319542)
        m = 3
        x = xp.asarray(rng.random((m,) + shape), dtype=xp.float64)
        res = hessian(optimize.rosen, x)
        if shape:
            x = xp.reshape(x, (m, -1))
            ref = xp.stack([optimize.rosen_hess(xi) for xi in x.T])
            ref = xp.moveaxis(ref, 0, -1)
            ref = xp.reshape(ref, (m, m,) + shape)
        else:
            ref = optimize.rosen_hess(x)
        xp_assert_close(res.ddf, ref, atol=1e-8)

        # # Removed symmetry enforcement; consider adding back in as a feature
        # # check symmetry
        # for key in ['ddf', 'error', 'nfev', 'success', 'status']:
        #     assert_equal(res[key], np.swapaxes(res[key], 0, 1))

    def test_float32(self, xp):
        rng = np.random.default_rng(458912319542)
        x = xp.asarray(rng.random(3), dtype=xp.float32)
        res = hessian(optimize.rosen, x)
        ref = optimize.rosen_hess(x)
        mask = (ref != 0)
        xp_assert_close(res.ddf[mask], ref[mask])
        atol = 1e-2 * xp.abs(xp.min(ref[mask]))
        xp_assert_close(res.ddf[~mask], ref[~mask], atol=atol)

    def test_nfev(self, xp):
        z = xp.asarray([0.5, 0.25])

        def f1(z):
            x, y = xp.broadcast_arrays(*z)
            f1.nfev = f1.nfev + (math.prod(x.shape[2:]) if x.ndim > 2 else 1)
            return xp.sin(x) * y ** 3
        f1.nfev = 0


        res = hessian(f1, z, initial_step=10)
        f1.nfev = 0
        res00 = hessian(lambda x: f1([x[0], z[1]]), z[0:1], initial_step=10)
        assert res.nfev[0, 0] == f1.nfev == res00.nfev[0, 0]

        f1.nfev = 0
        res11 = hessian(lambda y: f1([z[0], y[0]]), z[1:2], initial_step=10)
        assert res.nfev[1, 1] == f1.nfev == res11.nfev[0, 0]

        # Removed symmetry enforcement; consider adding back in as a feature
        # assert_equal(res.nfev, res.nfev.T)  # check symmetry
        # assert np.unique(res.nfev).size == 3


    @pytest.mark.thread_unsafe
    @pytest.mark.skip_xp_backends(np_only=True,
                                  reason='Python list input uses NumPy backend')
    def test_small_rtol_warning(self, xp):
        message = 'The specified `rtol=1e-15`, but...'
        with pytest.warns(RuntimeWarning, match=message):
            hessian(xp.sin, [1.], tolerances=dict(rtol=1e-15))
