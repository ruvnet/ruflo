# mypy: disable-error-code="attr-defined"
import os
import pytest
import math

import numpy as np
from numpy.testing import assert_allclose

import scipy._lib._elementwise_iterative_method as eim
from scipy._lib._array_api_no_0d import xp_assert_close, xp_assert_equal
from scipy._lib._array_api import array_namespace, xp_size, xp_ravel, xp_copy, is_numpy
from scipy import special, stats
from scipy.integrate import quad_vec, nsum, tanhsinh as _tanhsinh
from scipy.integrate._tanhsinh import _pair_cache
from scipy.stats._discrete_distns import _gen_harmonic_gt1


def norm_pdf(x, xp=None):
    xp = array_namespace(x) if xp is None else xp
    return 1/(2*xp.pi)**0.5 * xp.exp(-x**2/2)


def norm_logpdf(x, xp=None):
    xp = array_namespace(x) if xp is None else xp
    return -0.5*math.log(2*xp.pi) - x**2/2


def _vectorize(xp):
    # xp-compatible version of np.vectorize
    # assumes arguments are all arrays of the same shape
    def decorator(f):
        def wrapped(*arg_arrays):
            shape = arg_arrays[0].shape
            arg_arrays = [xp_ravel(arg_array) for arg_array in arg_arrays]
            res = []
            for i in range(math.prod(shape)):
                arg_scalars = [arg_array[i] for arg_array in arg_arrays]
                res.append(f(*arg_scalars))
            return res

        return wrapped

    return decorator


@pytest.mark.skip_xp_backends(
    'array_api_strict', reason='Currently uses fancy indexing assignment.'
)
@pytest.mark.skip_xp_backends(
    'dask.array', reason='boolean indexing assignment'
)
@pytest.mark.skip_xp_backends(
    'jax.numpy', reason='JAX arrays do not support item assignment.'
)
class TestTanhSinh:

    # Test problems from [1] Section 6
    def f1(self, t):
        return t * np.log(1 + t)

    f1.ref = 0.25
    f1.b = 1

    def f2(self, t):
        return t ** 2 * np.arctan(t)

    f2.ref = (np.pi - 2 + 2 * np.log(2)) / 12
    f2.b = 1

    def f3(self, t):
        return np.exp(t) * np.cos(t)

    f3.ref = (np.exp(np.pi / 2) - 1) / 2
    f3.b = np.pi / 2

    def f4(self, t):
        a = np.sqrt(2 + t ** 2)
        return np.arctan(a) / ((1 + t ** 2) * a)

    f4.ref = 5 * np.pi ** 2 / 96
    f4.b = 1

    def f5(self, t):
        return np.sqrt(t) * np.log(t)

    f5.ref = -4 / 9
    f5.b = 1

    def f6(self, t):
        return np.sqrt(1 - t ** 2)

    f6.ref = np.pi / 4
    f6.b = 1

    def f7(self, t):
        return np.sqrt(t) / np.sqrt(1 - t ** 2)

    f7.ref = 2 * np.sqrt(np.pi) * special.gamma(3 / 4) / special.gamma(1 / 4)
    f7.b = 1

    def f8(self, t):
        return np.log(t) ** 2

    f8.ref = 2
    f8.b = 1

    def f9(self, t):
        return np.log(np.cos(t))

    f9.ref = -np.pi * np.log(2) / 2
    f9.b = np.pi / 2

    def f10(self, t):
        return np.sqrt(np.tan(t))

    f10.ref = np.pi * np.sqrt(2) / 2
    f10.b = np.pi / 2

    def f11(self, t):
        return 1 / (1 + t ** 2)

    f11.ref = np.pi / 2
    f11.b = np.inf

    def f12(self, t):
        return np.exp(-t) / np.sqrt(t)

    f12.ref = np.sqrt(np.pi)
    f12.b = np.inf

    def f13(self, t):
        return np.exp(-t ** 2 / 2)

    f13.ref = np.sqrt(np.pi / 2)
    f13.b = np.inf

    def f14(self, t):
        return np.exp(-t) * np.cos(t)

    f14.ref = 0.5
    f14.b = np.inf

    def f15(self, t):
        return np.sin(t) / t

    f15.ref = np.pi / 2
    f15.b = np.inf

    def error(self, res, ref, log=False, xp=None):
        xp = array_namespace(res, ref) if xp is None else xp
        err = abs(res - ref)

        if not log:
            return err

        with np.errstate(divide='ignore'):
            return xp.log10(err)

    def test_input_validation(self, xp):
        f = self.f1

        zero = xp.asarray(0)
        f_b = xp.asarray(f.b)

        message = '`f` must be callable.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(42, zero, f_b)

        message = '...must be True or False.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, log=2)

        message = '...must be real numbers.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, xp.asarray(1+1j), f_b)
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, atol='ekki')
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, rtol=pytest)

        message = '...must be non-negative and finite.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, rtol=-1)
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, atol=xp.inf)

        message = '...may not be positive infinity.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, rtol=xp.inf, log=True)
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, atol=xp.inf, log=True)

        message = '...must be integers.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, maxlevel=object())
        # with pytest.raises(ValueError, match=message):  # unused for now
        #     _tanhsinh(f, zero, f_b, maxfun=1+1j)
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, minlevel="migratory coconut")

        message = '...must be non-negative.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, maxlevel=-1)
        # with pytest.raises(ValueError, match=message):  # unused for now
        #     _tanhsinh(f, zero, f_b, maxfun=-1)
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, minlevel=-1)

        message = '...must be True or False.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, preserve_shape=2)

        message = '...must be callable.'
        with pytest.raises(ValueError, match=message):
            _tanhsinh(f, zero, f_b, callback='elderberry')

    @pytest.mark.parametrize("limits, ref", [
        [(0, math.inf), 0.5],  # b infinite
        [(-math.inf, 0), 0.5],  # a infinite
        [(-math.inf, math.inf), 1.],  # a and b infinite
        [(math.inf, -math.inf), -1.],  # flipped limits
        [(1, -1), stats.norm.cdf(-1.) -  stats.norm.cdf(1.)],  # flipped limits
    ])
    def test_integral_transforms(self, limits, ref, xp):
        # Check that the integral transforms are behaving for both normal and
        # log integration
        limits = [xp.asarray(limit) for limit in limits]
        dtype = xp.asarray(float(limits[0])).dtype
        ref = xp.asarray(ref, dtype=dtype)

        res = _tanhsinh(norm_pdf, *limits)
        xp_assert_close(res.integral, ref)

        logres = _tanhsinh(norm_logpdf, *limits, log=True)
        xp_assert_close(xp.exp(logres.integral), ref, check_dtype=False)
        # Transformation should not make the result complex unnecessarily
        assert (xp.isdtype(logres.integral.dtype, "real floating") if ref > 0
                else xp.isdtype(logres.integral.dtype, "complex floating"))

        atol = 2 * xp.finfo(res.error.dtype).eps
        xp_assert_close(xp.exp(logres.error), res.error, atol=atol, check_dtype=False)

    # 15 skipped intentionally; it's very difficult numerically
    @pytest.mark.skip_xp_backends(np_only=True,
                                  reason='Cumbersome to convert everything.')
    @pytest.mark.parametrize('f_number', range(1, 15))
    def test_basic(self, f_number, xp):
        f = getattr(self, f"f{f_number}")
        rtol = 2e-8
        res = _tanhsinh(f, 0, f.b, rtol=rtol)
        assert_allclose(res.integral, f.ref, rtol=rtol)
        if f_number not in {7, 12, 14}:  # mildly underestimates error here
            true_error = abs(self.error(res.integral, f.ref)/res.integral)
            assert true_error < res.error

        if f_number in {7, 10, 12}:  # succeeds, but doesn't know it
            return

        assert res.success
        assert res.status == 0

    @pytest.mark.skip_xp_backends(np_only=True,
                                  reason="Distributions aren't xp-compatible.")
    @pytest.mark.parametrize('ref', (0.5, [0.4, 0.6]))
    @pytest.mark.parametrize('case', stats._distr_params.distcont)
    def test_accuracy(self, ref, case, xp):
        distname, params = case
        if distname in {'dgamma', 'dweibull', 'laplace', 'kstwo'}:
            # should split up interval at first-derivative discontinuity
            pytest.skip('tanh-sinh is not great for non-smooth integrands')
        if (distname in {'studentized_range', 'levy_stable'}
                and not int(os.getenv('SCIPY_XSLOW', 0))):
            pytest.skip('This case passes, but it is too slow.')
        dist = getattr(stats, distname)(*params)
        x = dist.interval(ref)
        res = _tanhsinh(dist.pdf, *x)
        assert_allclose(res.integral, ref)

    @pytest.mark.parametrize('shape', [tuple(), (12,), (3, 4), (3, 2, 2)])
    def test_vectorization(self, shape, xp):
        # Test for correct functionality, output shapes, and dtypes for various
        # input shapes.
        rng = np.random.default_rng(82456839535679456794)
        a = xp.asarray(rng.random(shape))
        b = xp.asarray(rng.random(shape))
        p = xp.asarray(rng.random(shape))
        n = math.prod(shape)

        def f(x, p):
            f.ncall += 1
            f.feval += 1 if (xp_size(x) == n or x.ndim <= 1) else x.shape[-1]
            return x**p
        f.ncall = 0
        f.feval = 0

        @_vectorize(xp)
        def _tanhsinh_single(a, b, p):
            return _tanhsinh(lambda x: x**p, a, b)

        res = _tanhsinh(f, a, b, args=(p,))
        refs = _tanhsinh_single(a, b, p)

        attrs = ['integral', 'error', 'success', 'status', 'nfev', 'maxlevel']
        for attr in attrs:
            ref_attr = xp.stack([getattr(ref, attr) for ref in refs])
            res_attr = xp_ravel(getattr(res, attr))
            xp_assert_close(res_attr, ref_attr, rtol=1e-15)
            assert getattr(res, attr).shape == shape

        assert xp.isdtype(res.success.dtype, 'bool')
        assert xp.isdtype(res.status.dtype, 'integral')
        assert xp.isdtype(res.nfev.dtype, 'integral')
        assert xp.isdtype(res.maxlevel.dtype, 'integral')
        assert xp.max(res.nfev) == f.feval
        # maxlevel = 2 -> 3 function calls (2 initialization, 1 work)
        assert xp.max(res.maxlevel) >= 2
        assert xp.max(res.maxlevel) == f.ncall

    def test_flags(self, xp):
        # Test cases that should produce different status flags; show that all
        # can be produced simultaneously.
        def f(xs, js):
            f.nit += 1
            funcs = [lambda x: xp.exp(-x**2),  # converges
                     lambda x: xp.exp(x),  # reaches maxiter due to order=2
                     lambda x: xp.full_like(x, xp.nan)]  # stops due to NaN
            res = []
            for i in range(xp_size(js)):
                x = xs[i, ...]
                j = int(xp_ravel(js)[i])
                res.append(funcs[j](x))
            return xp.stack(res)
        f.nit = 0

        args = (xp.arange(3, dtype=xp.int64),)
        a = xp.asarray([xp.inf]*3)
        b = xp.asarray([-xp.inf] * 3)
        res = _tanhsinh(f, a, b, maxlevel=5, args=args)
        ref_flags = xp.asarray([0, -2, -3], dtype=xp.int32)
        xp_assert_equal(res.status, ref_flags)

    def test_flags_preserve_shape(self, xp):
        # Same test as above but using `preserve_shape` option to simplify.
        def f(x):
            res = [xp.exp(-x[0]**2),  # converges
                   xp.exp(x[1]),  # reaches maxiter due to order=2
                   xp.full_like(x[2], xp.nan)]  # stops due to NaN
            return xp.stack(res)

        a = xp.asarray([xp.inf] * 3)
        b = xp.asarray([-xp.inf] * 3)
        res = _tanhsinh(f, a, b, maxlevel=5, preserve_shape=True)
        ref_flags = xp.asarray([0, -2, -3], dtype=xp.int32)
        xp_assert_equal(res.status, ref_flags)

    def test_preserve_shape(self, xp):
        # Test `preserve_shape` option
        def f(x, xp):
            return xp.stack([xp.stack([x, xp.sin(10 * x)]),
                             xp.stack([xp.cos(30 * x), x * xp.sin(100 * x)])])

        ref = quad_vec(lambda x: f(x, np), 0, 1)
        res = _tanhsinh(lambda x: f(x, xp), xp.asarray(0), xp.asarray(1),
                        preserve_shape=True)
        dtype = xp.asarray(0.).dtype
        xp_assert_close(res.integral, xp.asarray(ref[0], dtype=dtype))

    def test_convergence(self, xp):
        # demonstrate that number of accurate digits doubles each iteration
        dtype = xp.float64  # this only works with good precision
        def f(t):
            return t * xp.log(1 + t)
        ref = xp.asarray(0.25, dtype=dtype)
        a, b = xp.asarray(0., dtype=dtype), xp.asarray(1., dtype=dtype)

        last_logerr = 0
        for i in range(4):
            res = _tanhsinh(f, a, b, minlevel=0, maxlevel=i)
            logerr = self.error(res.integral, ref, log=True, xp=xp)
            assert (logerr < last_logerr * 2 or logerr < -15.5)
            last_logerr = logerr

    def test_options_and_result_attributes(self, xp):
        # demonstrate that options are behaving as advertised and status
        # messages are as intended
        def f(x):
            f.calls += 1
            f.feval += xp_size(xp.asarray(x))
            return x**2 * xp.atan(x)

        f.ref = xp.asarray((math.pi - 2 + 2 * math.log(2)) / 12, dtype=xp.float64)

        default_rtol = 1e-12
        default_atol = f.ref * default_rtol  # effective default absolute tol

        # Keep things simpler by leaving tolerances fixed rather than
        # having to make them dtype-dependent
        a = xp.asarray(0., dtype=xp.float64)
        b = xp.asarray(1., dtype=xp.float64)

        # Test default options
        f.feval, f.calls = 0, 0
        ref = _tanhsinh(f, a, b)
        assert self.error(ref.integral, f.ref) < ref.error < default_atol
        assert ref.nfev == f.feval
        ref.calls = f.calls  # reference number of function calls
        assert ref.success
        assert ref.status == 0

        # Test `maxlevel` equal to required max level
        # We should get all the same results
        f.feval, f.calls = 0, 0
        maxlevel = int(ref.maxlevel)
        res = _tanhsinh(f, a, b, maxlevel=maxlevel)
        res.calls = f.calls
        assert res == ref

        # Now reduce the maximum level. We won't meet tolerances.
        f.feval, f.calls = 0, 0
        maxlevel -= 1
        assert maxlevel >= 2  # can't compare errors otherwise
        res = _tanhsinh(f, a, b, maxlevel=maxlevel)
        assert self.error(res.integral, f.ref) < res.error > default_atol
        assert res.nfev == f.feval < ref.nfev
        assert f.calls == ref.calls - 1
        assert not res.success
        assert res.status == eim._ECONVERR

        # `maxfun` is currently not enforced

        # # Test `maxfun` equal to required number of function evaluations
        # # We should get all the same results
        # f.feval, f.calls = 0, 0
        # maxfun = ref.nfev
        # res = _tanhsinh(f, 0, f.b, maxfun = maxfun)
        # assert res == ref
        #
        # # Now reduce `maxfun`. We won't meet tolerances.
        # f.feval, f.calls = 0, 0
        # maxfun -= 1
        # res = _tanhsinh(f, 0, f.b, maxfun=maxfun)
        # assert self.error(res.integral, f.ref) < res.error > default_atol
        # assert res.nfev == f.feval < ref.nfev
        # assert f.calls == ref.calls - 1
        # assert not res.success
        # assert res.status == 2

        # Take this result to be the new reference
        ref = res
        ref.calls = f.calls

        # Test `atol`
        f.feval, f.calls = 0, 0
        # With this tolerance, we should get the exact same result as ref
        atol = np.nextafter(float(ref.error), np.inf)
        res = _tanhsinh(f, a, b, rtol=0, atol=atol)
        assert res.integral == ref.integral
        assert res.error == ref.error
        assert res.nfev == f.feval == ref.nfev
        assert f.calls == ref.calls
        # Except the result is considered to be successful
        assert res.success
        assert res.status == 0

        f.feval, f.calls = 0, 0
        # With a tighter tolerance, we should get a more accurate result
        atol = np.nextafter(float(ref.error), -np.inf)
        res = _tanhsinh(f, a, b, rtol=0, atol=atol)
        assert self.error(res.integral, f.ref) < res.error < atol
        assert res.nfev == f.feval > ref.nfev
        assert f.calls > ref.calls
        assert res.success
        assert res.status == 0

        # Test `rtol`
        f.feval, f.calls = 0, 0
        # With this tolerance, we should get the exact same result as ref
        rtol = np.nextafter(float(ref.error/ref.integral), np.inf)
        res = _tanhsinh(f, a, b, rtol=rtol)
        assert res.integral == ref.integral
        assert res.error == ref.error
        assert res.nfev == f.feval == ref.nfev
        assert f.calls == ref.calls
        # Except the result is considered to be successful
        assert res.success
        assert res.status == 0

        f.feval, f.calls = 0, 0
        # With a tighter tolerance, we should get a more accurate result
        rtol = np.nextafter(float(ref.error/ref.integral), -np.inf)
        res = _tanhsinh(f, a, b, rtol=rtol)
        assert self.error(res.integral, f.ref)/f.ref < res.error/res.integral < rtol
        assert res.nfev == f.feval > ref.nfev
        assert f.calls > ref.calls
        assert res.success
        assert res.status == 0

    @pytest.mark.skip_xp_backends('torch', reason=
            'https://github.com/scipy/scipy/pull/21149#issuecomment-2330477359',
    )
    @pytest.mark.parametrize('rtol', [1e-4, 1e-14])
    def test_log(self, rtol, xp):
        # Test equivalence of log-integration and regular integration
        test_tols = dict(atol=1e-18, rtol=1e-15)

        # Positive integrand (real log-integrand)
        a = xp.asarray(-1., dtype=xp.float64)
        b = xp.asarray(2., dtype=xp.float64)
        res = _tanhsinh(norm_logpdf, a, b, log=True, rtol=math.log(rtol))
        ref = _tanhsinh(norm_pdf, a, b, rtol=rtol)
        xp_assert_close(xp.exp(res.integral), ref.integral, **test_tols)
        xp_assert_close(xp.exp(res.error), ref.error, **test_tols)
        assert res.nfev == ref.nfev

        # Real integrand (complex log-integrand)
        def f(x):
            return -norm_logpdf(x)*norm_pdf(x)

        def logf(x):
            return xp.log(norm_logpdf(x) + 0j) + norm_logpdf(x) + xp.pi * 1j

        a = xp.asarray(-xp.inf, dtype=xp.float64)
        b = xp.asarray(xp.inf, dtype=xp.float64)
        res = _tanhsinh(logf, a, b, log=True)
        ref = _tanhsinh(f, a, b)
        # In gh-19173, we saw `invalid` warnings on one CI platform.
        # Silencing `all` because I can't reproduce locally and don't want
        # to risk the need to run CI again.
        with np.errstate(all='ignore'):
            xp_assert_close(xp.exp(res.integral), ref.integral, **test_tols,
                            check_dtype=False)
            xp_assert_close(xp.exp(res.error), ref.error, **test_tols,
                            check_dtype=False)
        assert res.nfev == ref.nfev

    def test_complex(self, xp):
        # Test integration of complex integrand
        # Finite limits
        def f(x):
            return xp.exp(1j * x)

        a, b = xp.asarray(0.), xp.asarray(xp.pi/4)
        res = _tanhsinh(f, a, b)
        ref = math.sqrt(2)/2 + (1-math.sqrt(2)/2)*1j
        xp_assert_close(res.integral, xp.asarray(ref))

        # Infinite limits
        def f(x):
            return norm_pdf(x) + 1j/2*norm_pdf(x/2)

        a, b = xp.asarray(xp.inf), xp.asarray(-xp.inf)
        res = _tanhsinh(f, a, b)
        xp_assert_close(res.integral, xp.asarray(-(1+1j)))

    @pytest.mark.parametrize("maxlevel", range(4))
    def test_minlevel(self, maxlevel, xp):
        # Verify that minlevel does not change the values at which the
        # integrand is evaluated or the integral/error estimates, only the
        # number of function calls

        def f(x):
            f.calls += 1
            f.feval += xp_size(xp.asarray(x))
            f.x = xp.concat((f.x, xp_ravel(x)))
            return x**2 * xp.atan(x)

        f.feval, f.calls, f.x = 0, 0, xp.asarray([])

        a = xp.asarray(0, dtype=xp.float64)
        b = xp.asarray(1, dtype=xp.float64)
        ref = _tanhsinh(f, a, b, minlevel=0, maxlevel=maxlevel)
        ref_x = xp.sort(f.x)

        for minlevel in range(0, maxlevel + 1):
            f.feval, f.calls, f.x = 0, 0, xp.asarray([])
            options = dict(minlevel=minlevel, maxlevel=maxlevel)
            res = _tanhsinh(f, a, b, **options)
            # Should be very close; all that has changed is the order of values
            xp_assert_close(res.integral, ref.integral, rtol=4e-16)
            # Difference in absolute errors << magnitude of integral
            xp_assert_close(res.error, ref.error, atol=4e-16 * ref.integral)
            assert res.nfev == f.feval == f.x.shape[0]
            assert f.calls == maxlevel - minlevel + 1 + 1  # 1 validation call
            assert res.status == ref.status
            xp_assert_equal(ref_x, xp.sort(f.x))

    def test_improper_integrals(self, xp):
        # Test handling of infinite limits of integration (mixed with finite limits)
        def f(x):
            x[xp.isinf(x)] = xp.nan
            return xp.exp(-x**2)
        a = xp.asarray([-xp.inf, 0, -xp.inf, xp.inf, -20, -xp.inf, -20])
        b = xp.asarray([xp.inf, xp.inf, 0, -xp.inf, 20, 20, xp.inf])
        ref = math.sqrt(math.pi)
        ref = xp.asarray([ref, ref/2, ref/2, -ref, ref, ref, ref])
        res = _tanhsinh(f, a, b)
        xp_assert_close(res.integral, ref)

    @pytest.mark.parametrize("limits", ((0, 3), ([-math.inf, 0], [3, 3])))
    @pytest.mark.parametrize("dtype", ('float32', 'float64'))
    def test_dtype(self, limits, dtype, xp):
        # Test that dtypes are preserved
        dtype = getattr(xp, dtype)
        a, b = xp.asarray(limits, dtype=dtype)

        def f(x):
            assert x.dtype == dtype
            return xp.exp(x)

        rtol = 1e-12 if dtype == xp.float64 else 1e-5
        res = _tanhsinh(f, a, b, rtol=rtol)
        assert res.integral.dtype == dtype
        assert res.error.dtype == dtype
        assert xp.all(res.success)
        xp_assert_close(res.integral, xp.exp(b)-xp.exp(a))

    def test_maxiter_callback(self, xp):
        # Test behavior of `maxiter` parameter and `callback` interface
        a, b = xp.asarray(-xp.inf), xp.asarray(xp.inf)
        def f(x):
            return xp.exp(-x*x)

        minlevel, maxlevel = 0, 2
        maxiter = maxlevel - minlevel + 1
        kwargs = dict(minlevel=minlevel, maxlevel=maxlevel, rtol=1e-15)
        res = _tanhsinh(f, a, b, **kwargs)
        assert not res.success
        assert res.maxlevel == maxlevel

        def callback(res):
            callback.iter += 1
            callback.res = res
            assert hasattr(res, 'integral')
            assert res.status == 1
            if callback.iter == maxiter:
                raise StopIteration
        callback.iter = -1  # callback called once before first iteration
        callback.res = None

        del kwargs['maxlevel']
        res2 = _tanhsinh(f, a, b, **kwargs, callback=callback)
        # terminating with callback is identical to terminating due to maxiter
        # (except for `status`)
        for key in res.keys():
            if key == 'status':
                assert res[key] == -2
                assert res2[key] == -4
            else:
                assert res2[key] == callback.res[key] == res[key]

    def test_jumpstart(self, xp):
        # The intermediate results at each level i should be the same as the
        # final results when jumpstarting at level i; i.e. minlevel=maxlevel=i
        a = xp.asarray(-xp.inf, dtype=xp.float64)
        b = xp.asarray(xp.inf, dtype=xp.float64)

        def f(x):
            return xp.exp(-x*x)

        def callback(res):
            callback.integrals.append(xp_copy(res.integral)[()])
            callback.errors.append(xp_copy(res.error)[()])
        callback.integrals = []
        callback.errors = []

        maxlevel = 4
        _tanhsinh(f, a, b, minlevel=0, maxlevel=maxlevel, callback=callback)

        for i in range(maxlevel + 1):
            res = _tanhsinh(f, a, b, minlevel=i, maxlevel=i)
            xp_assert_close(callback.integrals[1+i], res.integral, rtol=1e-15)
            xp_assert_close(callback.errors[1+i], res.error, rtol=1e-15, atol=1e-16)

    def test_special_cases(self, xp):
        # Test edge cases and other special cases
        a, b = xp.asarray(0), xp.asarray(1)

        def f(x):
            assert xp.isdtype(x.dtype, "real floating")
            return x

        res = _tanhsinh(f, a, b)
        assert res.success
        xp_assert_close(res.integral, xp.asarray(0.5))

        # Test levels 0 and 1; error is NaN
        res = _tanhsinh(f, a, b, maxlevel=0)
        assert res.integral > 0
        xp_assert_equal(res.error, xp.asarray(xp.nan))
        res = _tanhsinh(f, a, b, maxlevel=1)
        assert res.integral > 0
        xp_assert_equal(res.error, xp.asarray(xp.nan))

        # Test equal left and right integration limits
        res = _tanhsinh(f, b, b)
        assert res.success
        assert res.maxlevel == -1
        xp_assert_close(res.integral, xp.asarray(0.))

        # Test scalar `args` (not in tuple)
        def f(x, c):
            return x**c

        res = _tanhsinh(f, a, b, args=29)
        xp_assert_close(res.integral, xp.asarray(1/30))

        # Test NaNs
        a = xp.asarray([xp.nan, 0, 0, 0])
        b = xp.asarray([1, xp.nan, 1, 1])
        c = xp.asarray([1, 1, xp.nan, 1])
        res = _tanhsinh(f, a, b, args=(c,))
        xp_assert_close(res.integral, xp.asarray([xp.nan, xp.nan, xp.nan, 0.5]))
        xp_assert_equal(res.error[:3], xp.full((3,), xp.nan))
        xp_assert_equal(res.status, xp.asarray([-3, -3, -3, 0], dtype=xp.int32))
        xp_assert_equal(res.success, xp.asarray([False, False, False, True]))
        xp_assert_equal(res.nfev[:3], xp.full((3,), 1, dtype=xp.int32))

        # Test complex integral followed by real integral
        # Previously, h0 was of the result dtype. If the `dtype` were complex,
        # this could lead to complex cached abscissae/weights. If these get
        # cast to real dtype for a subsequent real integral, we would get a
        # ComplexWarning. Check that this is avoided.
        _pair_cache.xjc = xp.empty(0)
        _pair_cache.wj = xp.empty(0)
        _pair_cache.indices = [0]
        _pair_cache.h0 = None
        a, b = xp.asarray(0), xp.asarray(1)
        res = _tanhsinh(lambda x: xp.asarray(x*1j), a, b)
        xp_assert_close(res.integral, xp.asarray(0.5*1j))
        res = _tanhsinh(lambda x: x, a, b)
        xp_assert_close(res.integral, xp.asarray(0.5))

        # Test zero-size
        shape = (0, 3)
        res = _tanhsinh(lambda x: x, xp.asarray(0), xp.zeros(shape))
        attrs = ['integral', 'error', 'success', 'status', 'nfev', 'maxlevel']
        for attr in attrs:
            assert res[attr].shape == shape

    @pytest.mark.skip_xp_backends(np_only=True)
    def test_compress_nodes_weights_gh21496(self, xp):
        # See discussion in:
        # https://github.com/scipy/scipy/pull/21496#discussion_r1878681049
        # This would cause "ValueError: attempt to get argmax of an empty sequence"
        # Check that this has been resolved.
        x = np.full(65, 3)
        x[-1] = 1000
        _tanhsinh(np.sin, 1, x)

    def test_gh_22681_finite_error(self, xp):
        # gh-22681 noted a case in which the error was NaN on some platforms;
        # check that this does in fact fail in CI.
        c1 = complex(12, -10)
        c2 = complex(12, 39)
        def f(t):
            return xp.sin(c1 * (1 - t) + c2 * t)
        a, b = xp.asarray(0., dtype=xp.float64), xp.asarray(1., dtype=xp.float64)
        ref = _tanhsinh(f, a, b, atol=0, rtol=0, maxlevel=10)
        assert xp.isfinite(ref.error)
        # Previously, tanhsinh would not detect convergence
        res = _tanhsinh(f, a, b, rtol=1e-14)
        assert res.success
        assert res.maxlevel < 5
        xp_assert_close(res.integral, ref.integral, rtol=1e-15)


@pytest.mark.skip_xp_backends('torch', reason='data-apis/array-api-compat#271')
@pytest.mark.skip_xp_backends('array_api_strict', reason='No fancy indexing.')
@pytest.mark.skip_xp_backends('jax.numpy', reason='No mutation.')
@pytest.mark.skip_xp_backends(
    'dask.array',
    reason='Data-dependent shapes in boolean index assignment'
)
class TestNSum:
    rng = np.random.default_rng(5895448232066142650)
    p = rng.uniform(1, 10, size=10).tolist()

    def f1(self, k):
        # Integers are never passed to `f1`; if they were, we'd get
        # integer to negative integer power error
        return k**(-2)

    f1.ref = np.pi**2/6
    f1.a = 1
    f1.b = np.inf
    f1.args = tuple()

    def f2(self, k, p):
        return 1 / k**p

    f2.ref = special.zeta(p, 1)
    f2.a = 1.
    f2.b = np.inf
    f2.args = (p,)

    def f3(self, k, p):
        return 1 / k**p

    f3.a = 1
    f3.b = rng.integers(5, 15, size=(3, 1))
    f3.ref = _gen_harmonic_gt1(f3.b, p)
    f3.args = (p,)

    def test_input_validation(self, xp):
        f = self.f1
        a, b = xp.asarray(f.a), xp.asarray(f.b)

        message = '`f` must be callable.'
        with pytest.raises(ValueError, match=message):
            nsum(42, a, b)

        message = '...must be True or False.'
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, log=2)

        message = '...must be real numbers.'
        with pytest.raises(ValueError, match=message):
            nsum(f, xp.asarray(1+1j), b)
        with pytest.raises(ValueError, match=message):
            nsum(f, a, xp.asarray(1+1j))
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, step=xp.asarray(1+1j))
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, tolerances=dict(atol='ekki'))
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, tolerances=dict(rtol=pytest))

        with (np.errstate(all='ignore')):
            res = nsum(f, xp.asarray([np.nan, np.inf]), xp.asarray(1.))
            assert (res.status[0] == -1) and not res.success[0]
            assert xp.isnan(res.sum[0]) and xp.isnan(res.error[0])
            assert (res.status[1] == 0) and res.success[1]
            assert res.sum[1] == res.error[1]
            assert xp.all(res.nfev[0] == 1)

            res = nsum(f, xp.asarray(10.), xp.asarray([np.nan, 1]))
            assert (res.status[0] == -1) and not res.success[0]
            assert xp.isnan(res.sum[0]) and xp.isnan(res.error[0])
            assert (res.status[1] == 0) and res.success[1]
            assert res.sum[1] == res.error[1]
            assert xp.all(res.nfev[0] == 1)

            res = nsum(f, xp.asarray(1.), xp.asarray(10.),
                       step=xp.asarray([xp.nan, -xp.inf, xp.inf, -1, 0]))
            assert xp.all((res.status == -1) & xp.isnan(res.sum)
                          & xp.isnan(res.error) & ~res.success & res.nfev == 1)

        message = '...must be non-negative and finite.'
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, tolerances=dict(rtol=-1))
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, tolerances=dict(atol=np.inf))

        message = '...may not be positive infinity.'
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, tolerances=dict(rtol=np.inf), log=True)
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, tolerances=dict(atol=np.inf), log=True)

        message = '...must be a non-negative integer.'
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, maxterms=3.5)
        with pytest.raises(ValueError, match=message):
            nsum(f, a, b, maxterms=-2)

    @pytest.mark.parametrize('f_number', range(1, 4))
    def test_basic(self, f_number, xp):
        dtype = xp.asarray(1.).dtype
        f = getattr(self, f"f{f_number}")
        a, b = xp.asarray(f.a), xp.asarray(f.b),
        args = tuple(xp.asarray(arg) for arg in f.args)
        ref = xp.asarray(f.ref, dtype=dtype)
        res = nsum(f, a, b, args=args)
        xp_assert_close(res.sum, ref)
        xp_assert_equal(res.status, xp.zeros(ref.shape, dtype=xp.int32))
        xp_assert_equal(res.success, xp.ones(ref.shape, dtype=xp.bool))

        with np.errstate(divide='ignore'):
            logres = nsum(lambda *args: xp.log(f(*args)),
                           a, b, log=True, args=args)
        xp_assert_close(xp.exp(logres.sum), res.sum)
        xp_assert_close(xp.exp(logres.error), res.error, atol=1e-15)
        xp_assert_equal(logres.status, res.status)
        xp_assert_equal(logres.success, res.success)

    @pytest.mark.parametrize('maxterms', [0, 1, 10, 20, 100])
    def test_integral(self, maxterms, xp):
        # test precise behavior of integral approximation
        f = self.f1

        def logf(x):
            return -2*xp.log(x)

        def F(x):
            return -1 / x

        a = xp.asarray([1, 5], dtype=xp.float64)[:, xp.newaxis]
        b = xp.asarray([20, 100, xp.inf], dtype=xp.float64)[:, xp.newaxis, xp.newaxis]
        step = xp.asarray([0.5, 1, 2], dtype=xp.float64).reshape((-1, 1, 1, 1))
        nsteps = xp.floor((b - a)/step)
        b_original = b
        b = a + nsteps*step

        k = a + maxterms*step
        # partial sum
        direct = xp.sum(f(a + xp.arange(maxterms)*step), axis=-1, keepdims=True)
        integral = (F(b) - F(k))/step  # integral approximation of remainder
        low = direct + integral + f(b)  # theoretical lower bound
        high = direct + integral + f(k)  # theoretical upper bound
        ref_sum = (low + high)/2  # nsum uses average of the two
        ref_err = (high - low)/2  # error (assuming perfect quadrature)

        # correct reference values where number of terms < maxterms
        a, b, step = xp.broadcast_arrays(a, b, step)
        for i in np.ndindex(a.shape):
            ai, bi, stepi = float(a[i]), float(b[i]), float(step[i])
            if (bi - ai)/stepi + 1 <= maxterms:
                direct = xp.sum(f(xp.arange(ai, bi+stepi, stepi, dtype=xp.float64)))
                ref_sum[i] = direct
                ref_err[i] = direct * xp.finfo(direct.dtype).eps

        rtol = 1e-12
        res = nsum(f, a, b_original, step=step, maxterms=maxterms,
                   tolerances=dict(rtol=rtol))
        xp_assert_close(res.sum, ref_sum, rtol=10*rtol)
        xp_assert_close(res.error, ref_err, rtol=100*rtol)

        i = ((b_original - a)/step + 1 <= maxterms)
        xp_assert_close(res.sum[i], ref_sum[i], rtol=1e-15)
        xp_assert_close(res.error[i], ref_err[i], rtol=1e-15)

        logres = nsum(logf, a, b_original, step=step, log=True,
                      tolerances=dict(rtol=math.log(rtol)), maxterms=maxterms)
        xp_assert_close(xp.exp(logres.sum), res.sum)
        xp_assert_close(xp.exp(logres.error), res.error)

    @pytest.mark.parametrize('shape', [tuple(), (12,), (3, 4), (3, 2, 2)])
    def test_vectorization(self, shape, xp):
        # Test for correct functionality, output shapes, and dtypes for various
        # input shapes.
        rng = np.random.default_rng(82456839535679456794)
        a = rng.integers(1, 10, size=shape)
        # when the sum can be computed directly or `maxterms` is large enough
        # to meet `atol`, there are slight differences (for good reason)
        # between vectorized call and looping.
        b = np.inf
        p = rng.random(shape) + 1
        n = math.prod(shape)

        def f(x, p):
            f.feval += 1 if (x.size == n or x.ndim <= 1) else x.shape[-1]
            return 1 / x ** p

        f.feval = 0

        @np.vectorize
        def nsum_single(a, b, p, maxterms):
            return nsum(lambda x: 1 / x**p, a, b, maxterms=maxterms)

        res = nsum(f, xp.asarray(a), xp.asarray(b), maxterms=1000,
                   args=(xp.asarray(p),))
        refs = nsum_single(a, b, p, maxterms=1000).ravel()

        attrs = ['sum', 'error', 'success', 'status', 'nfev']
        for attr in attrs:
            ref_attr = [xp.asarray(getattr(ref, attr)) for ref in refs]
            res_attr = getattr(res, attr)
            xp_assert_close(xp_ravel(res_attr), xp.asarray(ref_attr), rtol=1e-15)
            assert res_attr.shape == shape

        assert xp.isdtype(res.success.dtype, 'bool')
        assert xp.isdtype(res.status.dtype, 'integral')
        assert xp.isdtype(res.nfev.dtype, 'integral')
        if is_numpy(xp):  # other libraries might have different number
            assert int(xp.max(res.nfev)) == f.feval

    def test_status(self, xp):
        f = self.f2

        p = [2, 2, 0.9, 1.1, 2, 2]
        a = xp.asarray([0, 0, 1, 1, 1, np.nan], dtype=xp.float64)
        b = xp.asarray([10, np.inf, np.inf, np.inf, np.inf, np.inf], dtype=xp.float64)
        ref = special.zeta(p, 1)
        p = xp.asarray(p, dtype=xp.float64)

        with np.errstate(divide='ignore'):  # intentionally dividing by zero
            res = nsum(f, a, b, args=(p,))

        ref_success = xp.asarray([False, False, False, False, True, False])
        ref_status = xp.asarray([-3, -3, -2, -4, 0, -1], dtype=xp.int32)
        xp_assert_equal(res.success, ref_success)
        xp_assert_equal(res.status, ref_status)
        xp_assert_close(res.sum[res.success], xp.asarray(ref)[res.success])

    def test_nfev(self, xp):
        def f(x):
            f.nfev += xp_size(x)
            return 1 / x**2

        f.nfev = 0
        res = nsum(f, xp.asarray(1), xp.asarray(10))
        assert res.nfev == f.nfev

        f.nfev = 0
        res = nsum(f, xp.asarray(1), xp.asarray(xp.inf), tolerances=dict(atol=1e-6))
        assert res.nfev == f.nfev

    def test_inclusive(self, xp):
        # There was an edge case off-by one bug when `_direct` was called with
        # `inclusive=True`. Check that this is resolved.
        a = xp.asarray([1, 4])
        b = xp.asarray(xp.inf)
        res = nsum(lambda k: 1 / k ** 2, a, b,
                   maxterms=500, tolerances=dict(atol=0.1))
        ref = nsum(lambda k: 1 / k ** 2, a, b)
        assert xp.all(res.sum > (ref.sum - res.error))
        assert xp.all(res.sum < (ref.sum + res.error))

    @pytest.mark.parametrize('log', [True, False])
    def test_infinite_bounds(self, log, xp):
        a = xp.asarray([1, -np.inf, -np.inf])
        b = xp.asarray([np.inf, -1, np.inf])
        c = xp.asarray([1, 2, 3])

        def f(x, a):
            return (xp.log(xp.tanh(a / 2)) - a*xp.abs(x) if log
                    else xp.tanh(a/2) * xp.exp(-a*xp.abs(x)))

        res = nsum(f, a, b, args=(c,), log=log)
        ref = xp.asarray([stats.dlaplace.sf(0, 1), stats.dlaplace.sf(0, 2), 1])
        ref = xp.log(ref) if log else ref
        atol = (1e-10 if a.dtype==xp.float64 else 1e-5) if log else 0
        xp_assert_close(res.sum, xp.asarray(ref, dtype=a.dtype), atol=atol)

        # # Make sure the sign of `x` passed into `f` is correct.
        def f(x, c):
            return -3*xp.log(c*x) if log else 1 / (c*x)**3

        a = xp.asarray([1, -np.inf])
        b = xp.asarray([np.inf, -1])
        arg = xp.asarray([1, -1])
        res = nsum(f, a, b, args=(arg,), log=log)
        ref = np.log(special.zeta(3)) if log else special.zeta(3)
        xp_assert_close(res.sum, xp.full(a.shape, ref, dtype=a.dtype))

    def test_decreasing_check(self, xp):
        # Test accuracy when we start sum on an uphill slope.
        # Without the decreasing check, the terms would look small enough to
        # use the integral approximation. Because the function is not decreasing,
        # the error is not bounded by the magnitude of the last term of the
        # partial sum. In this case, the error would be  ~1e-4, causing the test
        # to fail.
        def f(x):
            return xp.exp(-x ** 2)

        a, b = xp.asarray(-25, dtype=xp.float64), xp.asarray(np.inf, dtype=xp.float64)
        res = nsum(f, a, b)

        # Reference computed with mpmath:
        # from mpmath import mp
        # mp.dps = 50
        # def fmp(x): return mp.exp(-x**2)
        # ref = mp.nsum(fmp, (-25, 0)) + mp.nsum(fmp, (1, mp.inf))
        ref = xp.asarray(1.772637204826652, dtype=xp.float64)

        xp_assert_close(res.sum, ref, rtol=1e-15)

    def test_special_case(self, xp):
        # test equal lower/upper limit
        f = self.f1
        a = b = xp.asarray(2)
        res = nsum(f, a, b)
        xp_assert_equal(res.sum, xp.asarray(f(2)))

        # Test scalar `args` (not in tuple)
        res = nsum(self.f2, xp.asarray(1), xp.asarray(np.inf), args=xp.asarray(2))
        xp_assert_close(res.sum, xp.asarray(self.f1.ref))  # f1.ref is correct w/ args=2

        # Test 0 size input
        a = xp.empty((3, 1, 1))  # arbitrary broadcastable shapes
        b = xp.empty((0, 1))  # could use Hypothesis
        p = xp.empty(4)  # but it's overkill
        shape = np.broadcast_shapes(a.shape, b.shape, p.shape)
        res = nsum(self.f2, a, b, args=(p,))
        assert res.sum.shape == shape
        assert res.status.shape == shape
        assert res.nfev.shape == shape

        # Test maxterms=0
        def f(x):
            with np.errstate(divide='ignore'):
                return 1 / x

        res = nsum(f, xp.asarray(0), xp.asarray(10), maxterms=0)
        assert xp.isinf(res.sum)
        assert xp.isinf(res.error)
        assert res.status == -2

        res = nsum(f, xp.asarray(0), xp.asarray(10), maxterms=1)
        assert xp.isnan(res.sum)
        assert xp.isnan(res.error)
        assert res.status == -3

        # Test NaNs
        # should skip both direct and integral methods if there are NaNs
        a = xp.asarray([xp.nan, 1, 1, 1])
        b = xp.asarray([xp.inf, xp.nan, xp.inf, xp.inf])
        p = xp.asarray([2, 2, xp.nan, 2])
        res = nsum(self.f2, a, b, args=(p,))
        xp_assert_close(res.sum, xp.asarray([xp.nan, xp.nan, xp.nan, self.f1.ref]))
        xp_assert_close(res.error[:3], xp.full((3,), xp.nan))
        xp_assert_equal(res.status, xp.asarray([-1, -1, -3, 0], dtype=xp.int32))
        xp_assert_equal(res.success, xp.asarray([False, False, False, True]))
        # Ideally res.nfev[2] would be 1, but `tanhsinh` has some function evals
        xp_assert_equal(res.nfev[:2], xp.full((2,), 1, dtype=xp.int32))

    @pytest.mark.parametrize('dtype', ['float32', 'float64'])
    def test_dtype(self, dtype, xp):
        dtype = getattr(xp, dtype)

        def f(k):
            assert k.dtype == dtype
            return 1 / k ** xp.asarray(2, dtype=dtype)

        a = xp.asarray(1, dtype=dtype)
        b = xp.asarray([10, xp.inf], dtype=dtype)
        res = nsum(f, a, b)
        assert res.sum.dtype == dtype
        assert res.error.dtype == dtype

        rtol = 1e-12 if dtype == xp.float64 else 1e-6
        ref = _gen_harmonic_gt1(np.asarray([10, xp.inf]), 2)
        xp_assert_close(res.sum, xp.asarray(ref, dtype=dtype), rtol=rtol)

    @pytest.mark.parametrize('case', [(10, 100), (100, 10)])
    def test_nondivisible_interval(self, case, xp):
        # When the limits of the sum are such that (b - a)/step
        # is not exactly integral, check that only floor((b - a)/step)
        # terms are included.
        n, maxterms = case

        def f(k):
            return 1 / k ** 2

        a = np.e
        step = 1 / 3
        b0 = a + n * step
        i = np.arange(-2, 3)
        b = b0 + i * np.spacing(b0)
        ns = np.floor((b - a) / step)
        assert len(set(ns)) == 2

        a, b = xp.asarray(a, dtype=xp.float64), xp.asarray(b, dtype=xp.float64)
        step, ns = xp.asarray(step, dtype=xp.float64), xp.asarray(ns, dtype=xp.float64)
        res = nsum(f, a, b, step=step, maxterms=maxterms)
        xp_assert_equal(xp.diff(ns) > 0, xp.diff(res.sum) > 0)
        xp_assert_close(res.sum[-1], res.sum[0] + f(b0))

    @pytest.mark.skip_xp_backends(np_only=True, reason='Needs beta function.')
    def test_logser_kurtosis_gh20648(self, xp):
        # Some functions return NaN at infinity rather than 0 like they should.
        # Check that this is accounted for.
        ref = stats.yulesimon.moment(4, 5)
        def f(x):
            return stats.yulesimon._pmf(x, 5) * x**4

        with np.errstate(invalid='ignore'):
            assert np.isnan(f(np.inf))

        res = nsum(f, 1, np.inf)
        assert_allclose(res.sum, ref)
