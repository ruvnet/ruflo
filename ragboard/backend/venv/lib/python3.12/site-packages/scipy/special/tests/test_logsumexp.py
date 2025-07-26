import itertools as it
import math
import pytest

import numpy as np

from scipy._lib._array_api import (is_array_api_strict, make_xp_test_case,
                                   xp_default_dtype, xp_device)
from scipy._lib._array_api_no_0d import (xp_assert_equal, xp_assert_close,
                                         xp_assert_less)

from scipy.special import log_softmax, logsumexp, softmax
from scipy.special._logsumexp import _wrap_radians


dtypes = ['float32', 'float64', 'int32', 'int64', 'complex64', 'complex128']
integral_dtypes = ['int32', 'int64']


def test_wrap_radians(xp):
    x = xp.asarray([-math.pi-1, -math.pi, -1, -1e-300,
                    0, 1e-300, 1, math.pi, math.pi+1])
    ref = xp.asarray([math.pi-1, math.pi, -1, -1e-300,
                    0, 1e-300, 1, math.pi, -math.pi+1])
    res = _wrap_radians(x, xp=xp)
    xp_assert_close(res, ref, atol=0)


# numpy warning filters don't work for dask (dask/dask#3245)
# (also we should not expect the numpy warning filter to work for any Array API
# library)
@pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning")
@pytest.mark.filterwarnings("ignore:divide by zero encountered:RuntimeWarning")
@pytest.mark.filterwarnings("ignore:overflow encountered:RuntimeWarning")
@make_xp_test_case(logsumexp)
class TestLogSumExp:
    def test_logsumexp(self, xp):
        # Test with zero-size array
        a = xp.asarray([])
        desired = xp.asarray(-xp.inf)
        xp_assert_equal(logsumexp(a), desired)

        # Test whether logsumexp() function correctly handles large inputs.
        a = xp.arange(200., dtype=xp.float64)
        desired = xp.log(xp.sum(xp.exp(a)))
        xp_assert_close(logsumexp(a), desired)

        # Now test with large numbers
        b = xp.asarray([1000., 1000.])
        desired = xp.asarray(1000.0 + math.log(2.0))
        xp_assert_close(logsumexp(b), desired)

        n = 1000
        b = xp.full((n,), 10000)
        desired = xp.asarray(10000.0 + math.log(n))
        xp_assert_close(logsumexp(b), desired)

        x = xp.asarray([1e-40] * 1000000)
        logx = xp.log(x)
        X = xp.stack([x, x])
        logX = xp.stack([logx, logx])
        xp_assert_close(xp.exp(logsumexp(logX)), xp.sum(X))
        xp_assert_close(xp.exp(logsumexp(logX, axis=0)), xp.sum(X, axis=0))
        xp_assert_close(xp.exp(logsumexp(logX, axis=1)), xp.sum(X, axis=1))

        # Handling special values properly
        inf = xp.asarray([xp.inf])
        nan = xp.asarray([xp.nan])
        xp_assert_equal(logsumexp(inf), inf[0])
        xp_assert_equal(logsumexp(-inf), -inf[0])
        xp_assert_equal(logsumexp(nan), nan[0])
        xp_assert_equal(logsumexp(xp.asarray([-xp.inf, -xp.inf])), -inf[0])

        # Handling an array with different magnitudes on the axes
        a = xp.asarray([[1e10, 1e-10],
                        [-1e10, -np.inf]])
        ref = xp.asarray([1e10, -1e10])
        xp_assert_close(logsumexp(a, axis=-1), ref)

        # Test keeping dimensions
        ref = xp.expand_dims(ref, axis=-1)
        xp_assert_close(logsumexp(a, axis=-1, keepdims=True), ref)

        # Test multiple axes
        xp_assert_close(logsumexp(a, axis=(-1, -2)), xp.asarray(1e10))

    def test_logsumexp_b(self, xp):
        a = xp.arange(200., dtype=xp.float64)
        b = xp.arange(200., 0., -1.)
        desired = xp.log(xp.sum(b*xp.exp(a)))
        xp_assert_close(logsumexp(a, b=b), desired)

        a = xp.asarray([1000, 1000])
        b = xp.asarray([1.2, 1.2])
        desired = xp.asarray(1000 + math.log(2 * 1.2))
        xp_assert_close(logsumexp(a, b=b), desired)

        x = xp.asarray([1e-40] * 100000)
        b = xp.linspace(1, 1000, 100000)
        logx = xp.log(x)
        X = xp.stack((x, x))
        logX = xp.stack((logx, logx))
        B = xp.stack((b, b))
        xp_assert_close(xp.exp(logsumexp(logX, b=B)), xp.sum(B * X))
        xp_assert_close(xp.exp(logsumexp(logX, b=B, axis=0)), xp.sum(B * X, axis=0))
        xp_assert_close(xp.exp(logsumexp(logX, b=B, axis=1)), xp.sum(B * X, axis=1))

    def test_logsumexp_sign(self, xp):
        a = xp.asarray([1, 1, 1])
        b = xp.asarray([1, -1, -1])

        r, s = logsumexp(a, b=b, return_sign=True)
        xp_assert_close(r, xp.asarray(1.))
        xp_assert_equal(s, xp.asarray(-1.))

    def test_logsumexp_sign_zero(self, xp):
        a = xp.asarray([1, 1])
        b = xp.asarray([1, -1])

        r, s = logsumexp(a, b=b, return_sign=True)
        assert not xp.isfinite(r)
        assert not xp.isnan(r)
        assert r < 0
        assert s == 0

    def test_logsumexp_sign_shape(self, xp):
        a = xp.ones((1, 2, 3, 4))
        b = xp.ones_like(a)

        r, s = logsumexp(a, axis=2, b=b, return_sign=True)
        assert r.shape == s.shape == (1, 2, 4)

        r, s = logsumexp(a, axis=(1, 3), b=b, return_sign=True)
        assert r.shape == s.shape == (1,3)

    def test_logsumexp_complex_sign(self, xp):
        a = xp.asarray([1 + 1j, 2 - 1j, -2 + 3j])

        r, s = logsumexp(a, return_sign=True)

        expected_sumexp = xp.sum(xp.exp(a))
        # This is the numpy>=2.0 convention for np.sign
        expected_sign = expected_sumexp / xp.abs(expected_sumexp)

        xp_assert_close(s, expected_sign)
        xp_assert_close(s * xp.exp(r), expected_sumexp)

    def test_logsumexp_shape(self, xp):
        a = xp.ones((1, 2, 3, 4))
        b = xp.ones_like(a)

        r = logsumexp(a, axis=2, b=b)
        assert r.shape == (1, 2, 4)

        r = logsumexp(a, axis=(1, 3), b=b)
        assert r.shape == (1, 3)

    def test_logsumexp_b_zero(self, xp):
        a = xp.asarray([1, 10000])
        b = xp.asarray([1, 0])

        xp_assert_close(logsumexp(a, b=b), xp.asarray(1.))

    def test_logsumexp_b_shape(self, xp):
        a = xp.zeros((4, 1, 2, 1))
        b = xp.ones((3, 1, 5))

        logsumexp(a, b=b)

    @pytest.mark.parametrize('arg', (1, [1, 2, 3]))
    def test_xp_invalid_input(self, arg):
        assert logsumexp(arg) == logsumexp(np.asarray(np.atleast_1d(arg)))

    def test_array_like(self):
        a = [1000, 1000]
        desired = np.asarray(1000.0 + math.log(2.0))
        xp_assert_close(logsumexp(a), desired)

    @pytest.mark.parametrize('dtype', dtypes)
    def test_dtypes_a(self, dtype, xp):
        dtype = getattr(xp, dtype)
        a = xp.asarray([1000., 1000.], dtype=dtype)
        desired_dtype = (xp.asarray(1.).dtype if xp.isdtype(dtype, 'integral')
                         else dtype)  # true for all libraries tested
        desired = xp.asarray(1000.0 + math.log(2.0), dtype=desired_dtype)
        xp_assert_close(logsumexp(a), desired)

    @pytest.mark.parametrize('dtype_a', dtypes)
    @pytest.mark.parametrize('dtype_b', dtypes)
    def test_dtypes_ab(self, dtype_a, dtype_b, xp):
        xp_dtype_a = getattr(xp, dtype_a)
        xp_dtype_b = getattr(xp, dtype_b)
        a = xp.asarray([2, 1], dtype=xp_dtype_a)
        b = xp.asarray([1, -1], dtype=xp_dtype_b)
        if is_array_api_strict(xp):
            # special-case for `TypeError: array_api_strict.float32 and
            # and array_api_strict.int64 cannot be type promoted together`
            xp_float_dtypes = [dtype for dtype in [xp_dtype_a, xp_dtype_b]
                               if not xp.isdtype(dtype, 'integral')]
            if len(xp_float_dtypes) < 2:  # at least one is integral
                xp_float_dtypes.append(xp.asarray(1.).dtype)
            desired_dtype = xp.result_type(*xp_float_dtypes)
        else:
            desired_dtype = xp.result_type(xp_dtype_a, xp_dtype_b)
            if xp.isdtype(desired_dtype, 'integral'):
               desired_dtype = xp_default_dtype(xp)
        desired = xp.asarray(math.log(math.exp(2) - math.exp(1)), dtype=desired_dtype)
        xp_assert_close(logsumexp(a, b=b), desired)

    def test_gh18295(self, xp):
        # gh-18295 noted loss of precision when real part of one element is much
        # larger than the rest. Check that this is resolved.
        a = xp.asarray([0.0, -40.0])
        res = logsumexp(a)
        ref = xp.logaddexp(a[0], a[1])
        xp_assert_close(res, ref)

    @pytest.mark.parametrize('dtype', ['complex64', 'complex128'])
    def test_gh21610(self, xp, dtype):
        # gh-21610 noted that `logsumexp` could return imaginary components
        # outside the range (-pi, pi]. Check that this is resolved.
        # While working on this, I noticed that all other tests passed even
        # when the imaginary component of the result was zero. This suggested
        # the need of a stronger test with imaginary dtype.
        rng = np.random.default_rng(324984329582349862)
        dtype = getattr(xp, dtype)
        shape = (10, 100)
        x = rng.uniform(1, 40, shape) + 1.j * rng.uniform(1, 40, shape)
        x = xp.asarray(x, dtype=dtype)

        res = logsumexp(x, axis=1)
        ref = xp.log(xp.sum(xp.exp(x), axis=1))
        max = xp.full_like(xp.imag(res), xp.pi)
        xp_assert_less(xp.abs(xp.imag(res)), max)
        xp_assert_close(res, ref)

        out, sgn = logsumexp(x, return_sign=True, axis=1)
        ref = xp.sum(xp.exp(x), axis=1)
        xp_assert_less(xp.abs(xp.imag(sgn)), max)
        xp_assert_close(out, xp.real(xp.log(ref)))
        xp_assert_close(sgn, ref/xp.abs(ref))

    def test_gh21709_small_imaginary(self, xp):
        # Test that `logsumexp` does not lose relative precision of
        # small imaginary components
        x = xp.asarray([0, 0.+2.2204460492503132e-17j])
        res = logsumexp(x)
        # from mpmath import mp
        # mp.dps = 100
        # x, y = mp.mpc(0), mp.mpc('0', '2.2204460492503132e-17')
        # ref = complex(mp.log(mp.exp(x) + mp.exp(y)))
        ref = xp.asarray(0.6931471805599453+1.1102230246251566e-17j)
        xp_assert_close(xp.real(res), xp.real(ref))
        xp_assert_close(xp.imag(res), xp.imag(ref), atol=0, rtol=1e-15)


    @pytest.mark.parametrize('x,y', it.product(
        [
            -np.inf,
            np.inf,
            complex(-np.inf, 0.),
            complex(-np.inf, -0.),
            complex(-np.inf, np.inf),
            complex(-np.inf, -np.inf),
            complex(np.inf, 0.),
            complex(np.inf, -0.),
            complex(np.inf, np.inf),
            complex(np.inf, -np.inf),
            # Phase in each quadrant.
            complex(-np.inf, 0.7533),
            complex(-np.inf, 2.3562),
            complex(-np.inf, 3.9270),
            complex(-np.inf, 5.4978),
            complex(np.inf, 0.7533),
            complex(np.inf, 2.3562),
            complex(np.inf, 3.9270),
            complex(np.inf, 5.4978),
        ], repeat=2)
    )
    def test_gh22601_infinite_elements(self, x, y, xp):
        # Test that `logsumexp` does reasonable things in the presence of
        # real and complex infinities.
        res = logsumexp(xp.asarray([x, y]))
        ref = xp.log(xp.sum(xp.exp(xp.asarray([x, y]))))
        xp_assert_equal(res, ref)

    def test_no_writeback(self, xp):
        """Test that logsumexp doesn't accidentally write back to its parameters."""
        a = xp.asarray([5., 4.])
        b = xp.asarray([3., 2.])
        logsumexp(a)
        logsumexp(a, b=b)
        xp_assert_equal(a, xp.asarray([5., 4.]))
        xp_assert_equal(b, xp.asarray([3., 2.]))

    @pytest.mark.parametrize("x_raw", [1.0, 1.0j, []])
    def test_device(self, x_raw, xp, devices):
        """Test input device propagation to output."""
        for d in devices:
            x = xp.asarray(x_raw, device=d)
            assert xp_device(logsumexp(x)) == xp_device(x)
            assert xp_device(logsumexp(x, b=x)) == xp_device(x)

    def test_gh22903(self, xp):
        # gh-22903 reported that `logsumexp` produced NaN where the weight associated
        # with the max magnitude element was negative and `return_sign=False`, even if
        # the net result should be the log of a positive number.

        # result is log of positive number
        a = xp.asarray([3.06409428, 0.37251854, 3.87471931])
        b = xp.asarray([1.88190708, 2.84174795, -0.85016884])
        xp_assert_close(logsumexp(a, b=b), logsumexp(a, b=b, return_sign=True)[0])

        # result is log of negative number
        b = xp.asarray([1.88190708, 2.84174795, -3.85016884])
        xp_assert_close(logsumexp(a, b=b), xp.asarray(xp.nan))


@make_xp_test_case(softmax)
class TestSoftmax:
    def test_softmax_fixtures(self, xp):
        xp_assert_close(softmax(xp.asarray([1000., 0., 0., 0.])),
                        xp.asarray([1., 0., 0., 0.]), rtol=1e-13)
        xp_assert_close(softmax(xp.asarray([1., 1.])),
                        xp.asarray([.5, .5]), rtol=1e-13)
        xp_assert_close(softmax(xp.asarray([0., 1.])),
                        xp.asarray([1., np.e])/(1 + np.e),
                        rtol=1e-13)

        # Expected value computed using mpmath (with mpmath.mp.dps = 200) and then
        # converted to float.
        x = xp.arange(4, dtype=xp.float64)
        expected = xp.asarray([0.03205860328008499,
                               0.08714431874203256,
                               0.23688281808991013,
                               0.6439142598879722], dtype=xp.float64)

        xp_assert_close(softmax(x), expected, rtol=1e-13)

        # Translation property.  If all the values are changed by the same amount,
        # the softmax result does not change.
        xp_assert_close(softmax(x + 100), expected, rtol=1e-13)

        # When axis=None, softmax operates on the entire array, and preserves
        # the shape.
        xp_assert_close(softmax(xp.reshape(x, (2, 2))),
                        xp.reshape(expected, (2, 2)), rtol=1e-13)

    def test_softmax_multi_axes(self, xp):
        xp_assert_close(softmax(xp.asarray([[1000., 0.], [1000., 0.]]), axis=0),
                        xp.asarray([[.5, .5], [.5, .5]]), rtol=1e-13)
        xp_assert_close(softmax(xp.asarray([[1000., 0.], [1000., 0.]]), axis=1),
                        xp.asarray([[1., 0.], [1., 0.]]), rtol=1e-13)

        # Expected value computed using mpmath (with mpmath.mp.dps = 200) and then
        # converted to float.
        x = xp.asarray([[-25.,   0.,  25.,  50.],
                        [  1., 325., 749., 750.]])
        expected = xp.asarray([[2.678636961770877e-33,
                                1.9287498479371314e-22,
                                1.3887943864771144e-11,
                                0.999999999986112],
                               [0.0,
                                1.9444526359919372e-185,
                                0.2689414213699951,
                                0.7310585786300048]])
        xp_assert_close(softmax(x, axis=1), expected, rtol=1e-13)
        xp_assert_close(softmax(x.T, axis=0), expected.T, rtol=1e-13)

        # 3-d input, with a tuple for the axis.
        x3d = xp.reshape(x, (2, 2, 2))
        xp_assert_close(softmax(x3d, axis=(1, 2)),
                        xp.reshape(expected, (2, 2, 2)), rtol=1e-13)

    @pytest.mark.xfail_xp_backends("array_api_strict", reason="int->float promotion")
    def test_softmax_int_array(self, xp):
        xp_assert_close(softmax(xp.asarray([1000, 0, 0, 0])),
                        xp.asarray([1., 0., 0., 0.]), rtol=1e-13)

    def test_softmax_scalar(self):
        xp_assert_close(softmax(1000), np.asarray(1.), rtol=1e-13)

    def test_softmax_array_like(self):
        xp_assert_close(softmax([1000, 0, 0, 0]),
                        np.asarray([1., 0., 0., 0.]), rtol=1e-13)


@make_xp_test_case(log_softmax)
class TestLogSoftmax:
    def test_log_softmax_basic(self, xp):
        xp_assert_close(log_softmax(xp.asarray([1000., 1.])),
                        xp.asarray([0., -999.]), rtol=1e-13)

    @pytest.mark.xfail_xp_backends("array_api_strict", reason="int->float promotion")
    def test_log_softmax_int_array(self, xp):
        xp_assert_close(log_softmax(xp.asarray([1000, 1])),
                        xp.asarray([0., -999.]), rtol=1e-13)

    def test_log_softmax_scalar(self):
        xp_assert_close(log_softmax(1.0), 0.0, rtol=1e-13)

    def test_log_softmax_array_like(self):
        xp_assert_close(log_softmax([1000, 1]),
                        np.asarray([0., -999.]), rtol=1e-13)

    @staticmethod
    def data_1d(xp):
        x = xp.arange(4, dtype=xp.float64)
        # Expected value computed using mpmath (with mpmath.mp.dps = 200)
        expect = [-3.4401896985611953,
                  -2.4401896985611953,
                  -1.4401896985611953,
                  -0.44018969856119533]
        return x, xp.asarray(expect, dtype=xp.float64)

    @staticmethod
    def data_2d(xp):
        x = xp.reshape(xp.arange(8, dtype=xp.float64), (2, 4))

        # Expected value computed using mpmath (with mpmath.mp.dps = 200)
        expect = [[-3.4401896985611953,
                   -2.4401896985611953,
                   -1.4401896985611953,
                   -0.44018969856119533],
                  [-3.4401896985611953,
                   -2.4401896985611953,
                   -1.4401896985611953,
                   -0.44018969856119533]]
        return x, xp.asarray(expect, dtype=xp.float64)

    @pytest.mark.parametrize("offset", [0, 100])
    def test_log_softmax_translation(self, offset, xp):
        # Translation property.  If all the values are changed by the same amount,
        # the softmax result does not change.
        x, expect = self.data_1d(xp)
        x += offset
        xp_assert_close(log_softmax(x), expect, rtol=1e-13)

    def test_log_softmax_noneaxis(self, xp):
        # When axis=None, softmax operates on the entire array, and preserves
        # the shape.
        x, expect = self.data_1d(xp)
        x = xp.reshape(x, (2, 2))
        expect = xp.reshape(expect, (2, 2))
        xp_assert_close(log_softmax(x), expect, rtol=1e-13)

    @pytest.mark.parametrize('axis_2d, expected_2d', [
        (0, np.log(0.5) * np.ones((2, 2))),
        (1, [[0., -999.], [0., -999.]]),
    ])
    def test_axes(self, axis_2d, expected_2d, xp):
        x = xp.asarray([[1000., 1.], [1000., 1.]])
        xp_assert_close(log_softmax(x, axis=axis_2d),
                        xp.asarray(expected_2d, dtype=x.dtype), rtol=1e-13)

    def test_log_softmax_2d_axis1(self, xp):
        x, expect = self.data_2d(xp)
        xp_assert_close(log_softmax(x, axis=1), expect, rtol=1e-13)

    def test_log_softmax_2d_axis0(self, xp):
        x, expect = self.data_2d(xp)
        xp_assert_close(log_softmax(x.T, axis=0), expect.T, rtol=1e-13)

    def test_log_softmax_3d(self, xp):
        # 3D input, with a tuple for the axis.
        x, expect = self.data_2d(xp)
        x = xp.reshape(x, (2, 2, 2))
        expect = xp.reshape(expect, (2, 2, 2))
        xp_assert_close(log_softmax(x, axis=(1, 2)), expect, rtol=1e-13)
