import sys
import math

from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal
from itertools import product
from math import gcd

import pytest
from pytest import raises as assert_raises
from numpy.testing import (
    assert_allclose,    # until object arrays are gone
    suppress_warnings)
import numpy as np
from numpy.exceptions import ComplexWarning

from scipy import fft as sp_fft
from scipy.ndimage import correlate1d
from scipy.optimize import fmin, linear_sum_assignment
from scipy import signal
from scipy.signal import (
    correlate, correlate2d, correlation_lags, convolve, convolve2d,
    fftconvolve, oaconvolve, choose_conv_method, envelope,
    hilbert, hilbert2, lfilter, lfilter_zi, filtfilt, butter, zpk2tf, zpk2sos,
    invres, invresz, vectorstrength, lfiltic, tf2sos, sosfilt, sosfiltfilt,
    sosfilt_zi, tf2zpk, BadCoefficients, detrend, unique_roots, residue,
    residuez)
from scipy.signal.windows import hann
from scipy.signal._signaltools import (_filtfilt_gust, _compute_factors,
                                      _group_poles)
from scipy.signal._upfirdn import _upfirdn_modes
from scipy._lib import _testutils

from scipy._lib._array_api import (
    xp_assert_close, xp_assert_equal, is_numpy, is_torch, is_jax, is_cupy,
    assert_array_almost_equal, assert_almost_equal,
    xp_copy, xp_size, xp_default_dtype, array_namespace
)
skip_xp_backends = pytest.mark.skip_xp_backends
xfail_xp_backends = pytest.mark.xfail_xp_backends


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestConvolve:

    @skip_xp_backends("jax.numpy",
        reason="jax returns floats; scipy returns ints; cf gh-6076")
    def test_basic(self, xp):
        a = xp.asarray([3, 4, 5, 6, 5, 4])
        b = xp.asarray([1, 2, 3])
        c = convolve(a, b)
        xp_assert_equal(c, xp.asarray([3, 10, 22, 28, 32, 32, 23, 12]))

    @skip_xp_backends("jax.numpy",
        reason="jax returns floats; scipy returns ints; cf gh-6076")
    def test_same(self, xp):
        a = xp.asarray([3, 4, 5])
        b = xp.asarray([1, 2, 3, 4])
        c = convolve(a, b, mode="same")
        xp_assert_equal(c, xp.asarray([10, 22, 34]))

    @skip_xp_backends("jax.numpy",
        reason="jax returns floats; scipy returns ints; cf gh-6076")
    def test_same_eq(self, xp):
        a = xp.asarray([3, 4, 5])
        b = xp.asarray([1, 2, 3])
        c = convolve(a, b, mode="same")
        xp_assert_equal(c, xp.asarray([10, 22, 22]))

    def test_complex(self, xp):
        x = xp.asarray([1 + 1j, 2 + 1j, 3 + 1j])
        y = xp.asarray([1 + 1j, 2 + 1j])
        z = convolve(x, y)
        xp_assert_equal(z, xp.asarray([2j, 2 + 6j, 5 + 8j, 5 + 5j]))

    @xfail_xp_backends("jax.numpy", reason="wrong output dtype")
    def test_zero_rank(self, xp):
        a = xp.asarray(1289)
        b = xp.asarray(4567)
        c = convolve(a, b)
        xp_assert_equal(c, a * b)

    @skip_xp_backends(np_only=True, reason="pure python")
    def test_zero_rank_python_scalars(self, xp):
        a = 1289
        b = 4567
        c = convolve(a, b)
        assert c == a * b

    def test_broadcastable(self, xp):
        a = xp.reshape(xp.arange(27), (3, 3, 3))
        b = xp.arange(3)
        for i in range(3):
            b_shape = [1]*3
            b_shape[i] = 3

            x = convolve(a, xp.reshape(b, b_shape), method='direct')
            y = convolve(a, xp.reshape(b, b_shape), method='fft')
            xp_assert_close(x, y, atol=1e-14)

    @xfail_xp_backends("jax.numpy", reason="wrong output dtype")
    def test_single_element(self, xp):
        a = xp.asarray([4967])
        b = xp.asarray([3920])
        c = convolve(a, b)
        xp_assert_equal(c, a * b)

    @skip_xp_backends("jax.numpy",)
    @skip_xp_backends("cupy")
    def test_2d_arrays(self, xp):
        a = xp.asarray([[1, 2, 3], [3, 4, 5]])
        b = xp.asarray([[2, 3, 4], [4, 5, 6]])
        c = convolve(a, b)
        d = xp.asarray([[2, 7, 16, 17, 12],
                   [10, 30, 62, 58, 38],
                   [12, 31, 58, 49, 30]])
        xp_assert_equal(c, d)

    @skip_xp_backends("torch")
    @skip_xp_backends("cupy")
    def test_input_swapping(self, xp):
        small = xp.reshape(xp.arange(8), (2, 2, 2))
        big = 1j * xp.reshape(xp.arange(27, dtype=xp.complex128), (3, 3, 3))
        big += xp.reshape(xp.arange(27, dtype=xp.complex128)[::-1], (3, 3, 3))

        out_array = xp.asarray(
            [[[0 + 0j, 26 + 0j, 25 + 1j, 24 + 2j],
              [52 + 0j, 151 + 5j, 145 + 11j, 93 + 11j],
              [46 + 6j, 133 + 23j, 127 + 29j, 81 + 23j],
              [40 + 12j, 98 + 32j, 93 + 37j, 54 + 24j]],

             [[104 + 0j, 247 + 13j, 237 + 23j, 135 + 21j],
              [282 + 30j, 632 + 96j, 604 + 124j, 330 + 86j],
              [246 + 66j, 548 + 180j, 520 + 208j, 282 + 134j],
              [142 + 66j, 307 + 161j, 289 + 179j, 153 + 107j]],

             [[68 + 36j, 157 + 103j, 147 + 113j, 81 + 75j],
              [174 + 138j, 380 + 348j, 352 + 376j, 186 + 230j],
              [138 + 174j, 296 + 432j, 268 + 460j, 138 + 278j],
              [70 + 138j, 145 + 323j, 127 + 341j, 63 + 197j]],

             [[32 + 72j, 68 + 166j, 59 + 175j, 30 + 100j],
              [68 + 192j, 139 + 433j, 117 + 455j, 57 + 255j],
              [38 + 222j, 73 + 499j, 51 + 521j, 21 + 291j],
              [12 + 144j, 20 + 318j, 7 + 331j, 0 + 182j]]])

        xp_assert_equal(convolve(small, big, 'full'), out_array)
        xp_assert_equal(convolve(big, small, 'full'), out_array)
        xp_assert_equal(convolve(small, big, 'same'),
                           out_array[1:3, 1:3, 1:3])
        xp_assert_equal(convolve(big, small, 'same'),
                           out_array[0:3, 0:3, 0:3])
        xp_assert_equal(convolve(small, big, 'valid'),
                           out_array[1:3, 1:3, 1:3])
        xp_assert_equal(convolve(big, small, 'valid'),
                           out_array[1:3, 1:3, 1:3])

    def test_invalid_params(self, xp):
        a = xp.asarray([3, 4, 5])
        b = xp.asarray([1, 2, 3])
        assert_raises(ValueError, convolve, a, b, mode='spam')
        assert_raises(ValueError, convolve, a, b, mode='eggs', method='fft')
        assert_raises(ValueError, convolve, a, b, mode='ham', method='direct')
        assert_raises(ValueError, convolve, a, b, mode='full', method='bacon')
        assert_raises(ValueError, convolve, a, b, mode='same', method='bacon')

    @skip_xp_backends("jax.numpy", reason="dtypes do not match")
    def test_valid_mode2(self, xp):
        # See gh-5897
        a = xp.asarray([1, 2, 3, 6, 5, 3])
        b = xp.asarray([2, 3, 4, 5, 3, 4, 2, 2, 1])
        expected = xp.asarray([70, 78, 73, 65])

        out = convolve(a, b, 'valid')
        xp_assert_equal(out, expected)

        out = convolve(b, a, 'valid')
        xp_assert_equal(out, expected)

        a = xp.asarray([1 + 5j, 2 - 1j, 3 + 0j])
        b = xp.asarray([2 - 3j, 1 + 0j])
        expected = xp.asarray([2 - 3j, 8 - 10j])

        out = convolve(a, b, 'valid')
        xp_assert_equal(out, expected)

        out = convolve(b, a, 'valid')
        xp_assert_equal(out, expected)

    @skip_xp_backends("jax.numpy", reason="dtypes do not match")
    def test_same_mode(self, xp):
        a = xp.asarray([1, 2, 3, 3, 1, 2])
        b = xp.asarray([1, 4, 3, 4, 5, 6, 7, 4, 3, 2, 1, 1, 3])
        c = convolve(a, b, 'same')
        d = xp.asarray([57, 61, 63, 57, 45, 36])
        xp_assert_equal(c, d)

    @skip_xp_backends("cupy", reason="different exception")
    def test_invalid_shapes(self, xp):
        # By "invalid," we mean that no one
        # array has dimensions that are all at
        # least as large as the corresponding
        # dimensions of the other array. This
        # setup should throw a ValueError.
        a = xp.reshape(xp.arange(1, 7), (2, 3))
        b = xp.reshape(xp.arange(-6, 0), (3, 2))

        assert_raises(ValueError, convolve, *(a, b), **{'mode': 'valid'})
        assert_raises(ValueError, convolve, *(b, a), **{'mode': 'valid'})

    @skip_xp_backends(np_only=True, reason="TODO: convert this test")
    def test_convolve_method(self, xp, n=100):
        # this types data structure was manually encoded instead of
        # using custom filters on the soon-to-be-removed np.sctypes
        types = {'uint16', 'uint64', 'int64', 'int32',
                 'complex128', 'float64', 'float16',
                 'complex64', 'float32', 'int16',
                 'uint8', 'uint32', 'int8', 'bool'}
        args = [(t1, t2, mode) for t1 in types for t2 in types
                               for mode in ['valid', 'full', 'same']]

        # These are random arrays, which means test is much stronger than
        # convolving testing by convolving two np.ones arrays
        rng = np.random.RandomState(42)
        array_types = {'i': rng.choice([0, 1], size=n),
                       'f': rng.randn(n)}
        array_types['b'] = array_types['u'] = array_types['i']
        array_types['c'] = array_types['f'] + 0.5j*array_types['f']

        for t1, t2, mode in args:
            x1 = array_types[np.dtype(t1).kind].astype(t1)
            x2 = array_types[np.dtype(t2).kind].astype(t2)

            results = {key: convolve(x1, x2, method=key, mode=mode)
                       for key in ['fft', 'direct']}

            assert results['fft'].dtype == results['direct'].dtype

            if 'bool' in t1 and 'bool' in t2:
                assert choose_conv_method(x1, x2) == 'direct' 
                continue

            # Found by experiment. Found approx smallest value for (rtol, atol)
            # threshold to have tests pass.
            if any([t in {'complex64', 'float32'} for t in [t1, t2]]):
                kwargs = {'rtol': 1.0e-4, 'atol': 1e-6}
            elif 'float16' in [t1, t2]:
                # atol is default for np.allclose
                kwargs = {'rtol': 1e-3, 'atol': 1e-3}
            else:
                # defaults for np.allclose (different from assert_allclose)
                kwargs = {'rtol': 1e-5, 'atol': 1e-8}

            xp_assert_close(results['fft'], results['direct'], **kwargs)

    @skip_xp_backends("jax.numpy", reason="dtypes do not match")
    def test_convolve_method_large_input(self, xp):
        # This is really a test that convolving two large integers goes to the
        # direct method even if they're in the fft method.
        for n in [10, 20, 50, 51, 52, 53, 54, 60, 62]:
            z = xp.asarray([2**n], dtype=xp.int64)
            fft = convolve(z, z, method='fft')
            direct = convolve(z, z, method='direct')

            # this is the case when integer precision gets to us
            # issue #6076 has more detail, hopefully more tests after resolved
            # # XXX: revisit check_dtype under np 2.0: 32bit linux & windows
            if n < 50:
                val = xp.asarray([2**(2*n)])
                xp_assert_equal(fft, direct)
                xp_assert_equal(fft, val, check_dtype=False)
                xp_assert_equal(direct, val, check_dtype=False)

    @skip_xp_backends(np_only=True)
    def test_mismatched_dims(self, xp):
        # Input arrays should have the same number of dimensions
        assert_raises(ValueError, convolve, [1], 2, method='direct')
        assert_raises(ValueError, convolve, 1, [2], method='direct')
        assert_raises(ValueError, convolve, [1], 2, method='fft')
        assert_raises(ValueError, convolve, 1, [2], method='fft')
        assert_raises(ValueError, convolve, [1], [[2]])
        assert_raises(ValueError, convolve, [3], 2)

    @pytest.mark.thread_unsafe
    @skip_xp_backends(np_only=True)
    def test_dtype_deprecation(self, xp):
        # gh-21211
        a = np.asarray([1, 2, 3, 6, 5, 3], dtype=object)
        b = np.asarray([2, 3, 4, 5, 3, 4, 2, 2, 1], dtype=object)
        with pytest.deprecated_call(match="dtype=object is not supported"):
            convolve(a, b)


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestConvolve2d:

    @skip_xp_backends("jax.numpy", reason="dtypes do not match")
    def test_2d_arrays(self, xp):
        a = xp.asarray([[1, 2, 3], [3, 4, 5]])
        b = xp.asarray([[2, 3, 4], [4, 5, 6]])
        d = xp.asarray([[2, 7, 16, 17, 12],
                   [10, 30, 62, 58, 38],
                   [12, 31, 58, 49, 30]])
        e = convolve2d(a, b)
        xp_assert_equal(e, d)

    @skip_xp_backends("jax.numpy", reason="dtypes do not match")
    def test_valid_mode(self, xp):
        e = xp.asarray([[2, 3, 4, 5, 6, 7, 8], [4, 5, 6, 7, 8, 9, 10]])
        f = xp.asarray([[1, 2, 3], [3, 4, 5]])
        h = xp.asarray([[62, 80, 98, 116, 134]])

        g = convolve2d(e, f, 'valid')
        xp_assert_equal(g, h)

        # See gh-5897
        g = convolve2d(f, e, 'valid')
        xp_assert_equal(g, h)

    @skip_xp_backends("torch", reason="dtypes do not match")
    def test_valid_mode_complx(self, xp):
        e = xp.asarray([[2, 3, 4, 5, 6, 7, 8], [4, 5, 6, 7, 8, 9, 10]])
        f = xp.asarray([[1, 2, 3], [3, 4, 5]], dtype=xp.complex128) + 1j
        h = xp.asarray([[62.+24.j, 80.+30.j, 98.+36.j, 116.+42.j, 134.+48.j]])

        g = convolve2d(e, f, 'valid')
        xp_assert_close(g, h)

        # See gh-5897
        g = convolve2d(f, e, 'valid')
        xp_assert_equal(g, h)

    @skip_xp_backends("jax.numpy", reason="jax only allows fillvalue=0")
    def test_fillvalue(self, xp):
        a = xp.asarray([[1, 2, 3], [3, 4, 5]])
        b = xp.asarray([[2, 3, 4], [4, 5, 6]])
        fillval = 1
        c = convolve2d(a, b, 'full', 'fill', fillval)
        d = xp.asarray([[24, 26, 31, 34, 32],
                   [28, 40, 62, 64, 52],
                   [32, 46, 67, 62, 48]])
        xp_assert_equal(c, d)

    def test_fillvalue_errors(self, xp):
        msg = "could not cast `fillvalue` directly to the output "
        with np.testing.suppress_warnings() as sup:
            sup.filter(ComplexWarning, "Casting complex values")
            with assert_raises(ValueError, match=msg):
                convolve2d([[1]], [[1, 2]], fillvalue=1j)

        msg = "`fillvalue` must be scalar or an array with "
        with assert_raises(ValueError, match=msg):
            convolve2d([[1]], [[1, 2]], fillvalue=[1, 2])

    def test_fillvalue_empty(self, xp):
        # Check that fillvalue being empty raises an error:
        assert_raises(ValueError, convolve2d, [[1]], [[1, 2]],
                      fillvalue=[])

    @skip_xp_backends("jax.numpy", reason="jax only supports boundary='fill'")
    def test_wrap_boundary(self, xp):
        a = xp.asarray([[1, 2, 3], [3, 4, 5]])
        b = xp.asarray([[2, 3, 4], [4, 5, 6]])
        c = convolve2d(a, b, 'full', 'wrap')
        d = xp.asarray([[80, 80, 74, 80, 80],
                   [68, 68, 62, 68, 68],
                   [80, 80, 74, 80, 80]])
        xp_assert_equal(c, d)

    @skip_xp_backends("jax.numpy", reason="jax only supports boundary='fill'")
    def test_sym_boundary(self, xp):
        a = xp.asarray([[1, 2, 3], [3, 4, 5]])
        b = xp.asarray([[2, 3, 4], [4, 5, 6]])
        c = convolve2d(a, b, 'full', 'symm')
        d = xp.asarray([[34, 30, 44, 62, 66],
                   [52, 48, 62, 80, 84],
                   [82, 78, 92, 110, 114]])
        xp_assert_equal(c, d)

    @skip_xp_backends("jax.numpy", reason="jax only supports boundary='fill'")
    @pytest.mark.parametrize('func', [convolve2d, correlate2d])
    @pytest.mark.parametrize('boundary, expected',
                             [('symm', [[37.0, 42.0, 44.0, 45.0]]),
                              ('wrap', [[43.0, 44.0, 42.0, 39.0]])])
    def test_same_with_boundary(self, func, boundary, expected, xp):
        # Test boundary='symm' and boundary='wrap' with a "long" kernel.
        # The size of the kernel requires that the values in the "image"
        # be extended more than once to handle the requested boundary method.
        # This is a regression test for gh-8684 and gh-8814.
        image = xp.asarray([[2.0, -1.0, 3.0, 4.0]])
        kernel = xp.ones((1, 21))
        result = func(image, kernel, mode='same', boundary=boundary)
        # The expected results were calculated "by hand".  Because the
        # kernel is all ones, the same result is expected for convolve2d
        # and correlate2d.
        xp_assert_equal(result, xp.asarray(expected))

    @skip_xp_backends("jax.numpy", reason="jax only supports boundary='fill'")
    def test_boundary_extension_same(self, xp):
        # Regression test for gh-12686.
        # Use ndimage.convolve with appropriate arguments to create the
        # expected result.
        import scipy.ndimage as ndi
        a = xp.reshape(xp.arange(1, 10*3+1, dtype=xp.float64), (10, 3))
        b = xp.reshape(xp.arange(1, 10*10+1, dtype=xp.float64), (10, 10))
        c = convolve2d(a, b, mode='same', boundary='wrap')
        xp_assert_equal(c, ndi.convolve(a, b, mode='wrap', origin=(-1, -1)))

    @skip_xp_backends("jax.numpy", reason="jax only supports boundary='fill'")
    def test_boundary_extension_full(self, xp):
        # Regression test for gh-12686.
        # Use ndimage.convolve with appropriate arguments to create the
        # expected result.
        import scipy.ndimage as ndi
        a = xp.reshape(xp.arange(1, 3*3+1, dtype=xp.float64), (3, 3))
        b = xp.reshape(xp.arange(1, 6*6+1, dtype=xp.float64), (6, 6))
        c = convolve2d(a, b, mode='full', boundary='wrap')

        a_np = np.arange(1, 3*3 +1, dtype=float).reshape(3, 3)
        apad_np = np.pad(a_np, ((3, 3), (3, 3)), 'wrap')
        apad = xp.asarray(apad_np)
        xp_assert_equal(c, xp.asarray(ndi.convolve(apad, b, mode='wrap')[:-1, :-1]))

    def test_invalid_shapes(self, xp):
        # By "invalid," we mean that no one
        # array has dimensions that are all at
        # least as large as the corresponding
        # dimensions of the other array. This
        # setup should throw a ValueError.
        a = xp.reshape(xp.arange(1, 7), (2, 3))
        b = xp.reshape(xp.arange(-6, 0), (3, 2))

        assert_raises(ValueError, convolve2d, *(a, b), **{'mode': 'valid'})
        assert_raises(ValueError, convolve2d, *(b, a), **{'mode': 'valid'})

    @skip_xp_backends("jax.numpy", 
        reason="jax returns floats; scipy returns ints; cf gh-6076")
    def test_same_mode(self, xp):
        e = xp.asarray([[1, 2, 3], [3, 4, 5]])
        f = xp.asarray([[2, 3, 4, 5, 6, 7, 8], [4, 5, 6, 7, 8, 9, 10]])
        g = convolve2d(e, f, 'same')
        h = xp.asarray([[22, 28, 34],
                   [80, 98, 116]])
        xp_assert_equal(g, h)

    @skip_xp_backends("jax.numpy",
        reason="jax returns floats; scipy returns ints; cf gh-6076")
    def test_valid_mode2(self, xp):
        # See gh-5897
        e = xp.asarray([[1, 2, 3], [3, 4, 5]])
        f = xp.asarray([[2, 3, 4, 5, 6, 7, 8], [4, 5, 6, 7, 8, 9, 10]])
        expected = xp.asarray([[62, 80, 98, 116, 134]])

        out = convolve2d(e, f, 'valid')
        xp_assert_equal(out, expected)

        out = convolve2d(f, e, 'valid')
        xp_assert_equal(out, expected)

        e = xp.asarray([[1 + 1j, 2 - 3j], [3 + 1j, 4 + 0j]])
        f = xp.asarray([[2 - 1j, 3 + 2j, 4 + 0j], [4 - 0j, 5 + 1j, 6 - 3j]])
        expected = xp.asarray([[27 - 1j, 46. + 2j]])

        out = convolve2d(e, f, 'valid')
        xp_assert_equal(out, expected)

        # See gh-5897
        out = convolve2d(f, e, 'valid')
        xp_assert_equal(out, expected)

    @skip_xp_backends("torch",
        reason="only integer tensors of a single element can be converted"
    )
    def test_consistency_convolve_funcs(self, xp):
        # Compare np.convolve, signal.convolve, signal.convolve2d
        a_np = np.arange(5)
        b_np = np.asarray([3.2, 1.4, 3])
        a = xp.asarray(a_np)
        b = xp.asarray(b_np)

        for mode in ['full', 'valid', 'same']:
            xp_assert_close(
                xp.asarray(np.convolve(a_np, b_np, mode=mode)),
                signal.convolve(a, b, mode=mode)
            )
            xp_assert_close(
                xp.squeeze(
                    signal.convolve2d(a[None, :], b[None, :], mode=mode),
                    axis=0
                ),
                signal.convolve(a, b, mode=mode)
            )

    def test_invalid_dims(self, xp):
        assert_raises(ValueError, convolve2d, 3, 4)
        assert_raises(ValueError, convolve2d, [3], [4])
        assert_raises(ValueError, convolve2d, [[[3]]], [[[4]]])

    @pytest.mark.slow
    @pytest.mark.xfail_on_32bit("Can't create large array for test")
    @skip_xp_backends(np_only=True, reason="stride_tricks")
    def test_large_array(self, xp):
        # Test indexing doesn't overflow an int (gh-10761)
        n = 2**31 // (1000 * xp.int64().itemsize)
        _testutils.check_free_memory(2 * n * 1001 * np.int64().itemsize / 1e6)

        # Create a chequered pattern of 1s and 0s
        a = xp.zeros(1001 * n, dtype=xp.int64)
        a[::2] = 1
        a = np.lib.stride_tricks.as_strided(a, shape=(n, 1000), strides=(8008, 8))

        count = signal.convolve2d(a, [[1, 1]])
        fails = np.where(count > 1)
        assert fails[0].size == 0


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestFFTConvolve:

    @skip_xp_backends("torch", reason="dtypes do not match")
    @pytest.mark.parametrize('axes', ['', None, 0, [0], -1, [-1]])
    def test_real(self, axes, xp):
        a = xp.asarray([1, 2, 3])
        expected = xp.asarray([1, 4, 10, 12, 9.])

        if axes == '':
            out = fftconvolve(a, a)
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(a, a, axes=axes)

        xp_assert_close(out, expected, atol=1.5e-6)

    @skip_xp_backends("torch", reason="dtypes do not match")
    @pytest.mark.parametrize('axes', [1, [1], -1, [-1]])
    def test_real_axes(self, axes, xp):
        a = xp.asarray([1, 2, 3])
        expected = xp.asarray([1, 4, 10, 12, 9.])

        a = xp.asarray(np.tile(a, [2, 1]))
        expected = xp.asarray(np.tile(expected, [2, 1]))

        if isinstance(axes, list):
            axes = tuple(axes)

        out = fftconvolve(a, a, axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

    @pytest.mark.parametrize('axes', ['', None, 0, [0], -1, [-1]])
    def test_complex(self, axes, xp):
        a = xp.asarray([1 + 1j, 2 + 2j, 3 + 3j])
        expected = xp.asarray([0 + 2j, 0 + 8j, 0 + 20j, 0 + 24j, 0 + 18j])

        if axes == '':
            out = fftconvolve(a, a)
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(a, a, axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

    @pytest.mark.parametrize('axes', [1, [1], -1, [-1]])
    def test_complex_axes(self, axes, xp):
        a = xp.asarray([1 + 1j, 2 + 2j, 3 + 3j])
        expected = xp.asarray([0 + 2j, 0 + 8j, 0 + 20j, 0 + 24j, 0 + 18j])

        a = xp.asarray(np.tile(a, [2, 1]))
        expected = xp.asarray(np.tile(expected, [2, 1]))

        if isinstance(axes, list):
            axes = tuple(axes)

        out = fftconvolve(a, a, axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

    @pytest.mark.parametrize('axes', ['',
                                      None,
                                      [0, 1],
                                      [1, 0],
                                      [0, -1],
                                      [-1, 0],
                                      [-2, 1],
                                      [1, -2],
                                      [-2, -1],
                                      [-1, -2]])
    def test_2d_real_same(self, axes, xp):
        a = xp.asarray([[1.0, 2, 3],
                        [4, 5, 6]])
        expected = xp.asarray([[1.0, 4, 10, 12, 9],
                               [8, 26, 56, 54, 36],
                               [16, 40, 73, 60, 36]])

        if axes == '':
            out = fftconvolve(a, a)
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(a, a, axes=axes)
        xp_assert_close(out, expected)

    @pytest.mark.parametrize('axes', [[1, 2],
                                      [2, 1],
                                      [1, -1],
                                      [-1, 1],
                                      [-2, 2],
                                      [2, -2],
                                      [-2, -1],
                                      [-1, -2]])
    def test_2d_real_same_axes(self, axes, xp):
        a = xp.asarray([[1, 2, 3],
                   [4, 5, 6]])
        expected = xp.asarray([[1, 4, 10, 12, 9],
                          [8, 26, 56, 54, 36],
                          [16, 40, 73, 60, 36]])

        a = xp.asarray(np.tile(a, [2, 1, 1]))
        expected = xp.asarray(np.tile(expected, [2, 1, 1]))

        if isinstance(axes, list):
            axes = tuple(axes)

        out = fftconvolve(a, a, axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6, check_dtype=False)

    @pytest.mark.parametrize('axes', ['',
                                      None,
                                      [0, 1],
                                      [1, 0],
                                      [0, -1],
                                      [-1, 0],
                                      [-2, 1],
                                      [1, -2],
                                      [-2, -1],
                                      [-1, -2]])
    def test_2d_complex_same(self, axes, xp):
        a = xp.asarray([[1 + 2j, 3 + 4j, 5 + 6j],
                   [2 + 1j, 4 + 3j, 6 + 5j]])
        expected = xp.asarray([
            [-3 + 4j, -10 + 20j, -21 + 56j, -18 + 76j, -11 + 60j],
            [10j, 44j, 118j, 156j, 122j],
            [3 + 4j, 10 + 20j, 21 + 56j, 18 + 76j, 11 + 60j]
            ])

        if axes == '':
            out = fftconvolve(a, a)
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(a, a, axes=axes)

        xp_assert_close(out, expected, atol=1.5e-6)

    @pytest.mark.parametrize('axes', [[1, 2],
                                      [2, 1],
                                      [1, -1],
                                      [-1, 1],
                                      [-2, 2],
                                      [2, -2],
                                      [-2, -1],
                                      [-1, -2]])
    def test_2d_complex_same_axes(self, axes, xp):
        a = xp.asarray([[1 + 2j, 3 + 4j, 5 + 6j],
                   [2 + 1j, 4 + 3j, 6 + 5j]])
        expected = xp.asarray([
            [-3 + 4j, -10 + 20j, -21 + 56j, -18 + 76j, -11 + 60j],
            [10j, 44j, 118j, 156j, 122j],
            [3 + 4j, 10 + 20j, 21 + 56j, 18 + 76j, 11 + 60j]
            ])

        a = xp.asarray(np.tile(a, [2, 1, 1]))
        expected = xp.asarray(np.tile(expected, [2, 1, 1]))

        if isinstance(axes, list):
            axes = tuple(axes)

        out = fftconvolve(a, a, axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

    @skip_xp_backends("torch", reason="dtypes do not match")
    @pytest.mark.parametrize('axes', ['', None, 0, [0], -1, [-1]])
    def test_real_same_mode(self, axes, xp):
        a = xp.asarray([1, 2, 3])
        b = xp.asarray([3, 3, 5, 6, 8, 7, 9, 0, 1])
        expected_1 = xp.asarray([35., 41., 47.])
        expected_2 = xp.asarray([9., 20., 25., 35., 41., 47., 39., 28., 2.])

        if axes == '':
            out = fftconvolve(a, b, 'same')
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(a, b, 'same', axes=axes)
        xp_assert_close(out, expected_1)

        if axes == '':
            out = fftconvolve(b, a, 'same')
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(b, a, 'same', axes=axes)
        xp_assert_close(out, expected_2, atol=1.5e-6)

    @skip_xp_backends("torch", reason="dtypes do not match")
    @pytest.mark.parametrize('axes', [1, -1, [1], [-1]])
    def test_real_same_mode_axes(self, axes, xp):
        a = xp.asarray([1, 2, 3])
        b = xp.asarray([3, 3, 5, 6, 8, 7, 9, 0, 1])
        expected_1 = xp.asarray([35., 41., 47.])
        expected_2 = xp.asarray([9., 20., 25., 35., 41., 47., 39., 28., 2.])

        a = xp.asarray(np.tile(a, [2, 1]))
        b = xp.asarray(np.tile(b, [2, 1]))
        expected_1 = xp.asarray(np.tile(expected_1, [2, 1]))
        expected_2 = xp.asarray(np.tile(expected_2, [2, 1]))

        if isinstance(axes, list):
            axes = tuple(axes)

        out = fftconvolve(a, b, 'same', axes=axes)
        xp_assert_close(out, expected_1, atol=1.5e-6)

        out = fftconvolve(b, a, 'same', axes=axes)
        xp_assert_close(out, expected_2, atol=1.5e-6)

    @skip_xp_backends("torch", reason="dtypes do not match")
    @pytest.mark.parametrize('axes', ['', None, 0, [0], -1, [-1]])
    def test_valid_mode_real(self, axes, xp):
        # See gh-5897
        a = xp.asarray([3, 2, 1])
        b = xp.asarray([3, 3, 5, 6, 8, 7, 9, 0, 1])
        expected = xp.asarray([24., 31., 41., 43., 49., 25., 12.])

        if axes == '':
            out = fftconvolve(a, b, 'valid')
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(a, b, 'valid', axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

        if axes == '':
            out = fftconvolve(b, a, 'valid')
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(b, a, 'valid', axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

    @skip_xp_backends("torch", reason="dtypes do not match")
    @pytest.mark.parametrize('axes', [1, [1]])
    def test_valid_mode_real_axes(self, axes, xp):
        # See gh-5897
        a = xp.asarray([3, 2, 1])
        b = xp.asarray([3, 3, 5, 6, 8, 7, 9, 0, 1])
        expected = xp.asarray([24., 31., 41., 43., 49., 25., 12.])

        a = xp.asarray(np.tile(a, [2, 1]))
        b = xp.asarray(np.tile(b, [2, 1]))
        expected = xp.asarray(np.tile(expected, [2, 1]))

        if isinstance(axes, list):
            axes = tuple(axes)

        out = fftconvolve(a, b, 'valid', axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

    @pytest.mark.parametrize('axes', ['', None, 0, [0], -1, [-1]])
    def test_valid_mode_complex(self, axes, xp):
        a = xp.asarray([3 - 1j, 2 + 7j, 1 + 0j])
        b = xp.asarray([3 + 2j, 3 - 3j, 5 + 0j, 6 - 1j, 8 + 0j])
        expected = xp.asarray([45. + 12.j, 30. + 23.j, 48 + 32.j])

        if axes == '':
            out = fftconvolve(a, b, 'valid')
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(a, b, 'valid', axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

        if axes == '':
            out = fftconvolve(b, a, 'valid')
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(b, a, 'valid', axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

    @pytest.mark.parametrize('axes', [1, [1], -1, [-1]])
    def test_valid_mode_complex_axes(self, axes, xp):
        a = xp.asarray([3 - 1j, 2 + 7j, 1 + 0j])
        b = xp.asarray([3 + 2j, 3 - 3j, 5 + 0j, 6 - 1j, 8 + 0j])
        expected = xp.asarray([45. + 12.j, 30. + 23.j, 48 + 32.j])

        a = xp.asarray(np.tile(a, [2, 1]))
        b = xp.asarray(np.tile(b, [2, 1]))
        expected = xp.asarray(np.tile(expected, [2, 1]))

        if isinstance(axes, list):
            axes = tuple(axes)

        out = fftconvolve(a, b, 'valid', axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

        out = fftconvolve(b, a, 'valid', axes=axes)
        xp_assert_close(out, expected, atol=1.5e-6)

    @skip_xp_backends("jax.numpy", reason="mapped axes must have same shape")
    @skip_xp_backends("torch", reason="dtypes do not match")
    def test_valid_mode_ignore_nonaxes(self, xp):
        # See gh-5897
        a = xp.asarray([3, 2, 1])
        b = xp.asarray([3, 3, 5, 6, 8, 7, 9, 0, 1])
        expected = xp.asarray([24., 31., 41., 43., 49., 25., 12.])

        a = xp.asarray(np.tile(a, [2, 1]))
        b = xp.asarray(np.tile(b, [1, 1]))
        expected = xp.asarray(np.tile(expected, [2, 1]))

        out = fftconvolve(a, b, 'valid', axes=1)
        xp_assert_close(out, expected, atol=1.5e-6)

    @xfail_xp_backends("cupy", reason="dtypes do not match")
    @xfail_xp_backends("jax.numpy", reason="assorted error messages")
    @pytest.mark.parametrize("a,b", [([], []), ([5, 6], []), ([], [7])])
    def test_empty(self, a, b, xp):
        # Regression test for #1745: crashes with 0-length input.
        xp_assert_equal(
            fftconvolve(xp.asarray(a), xp.asarray(b)),
            xp.asarray([]),
        )

    @skip_xp_backends("jax.numpy", reason="jnp.pad: pad_width with nd=0")
    def test_zero_rank(self, xp):
        a = xp.asarray(4967)
        b = xp.asarray(3920)
        out = fftconvolve(a, b)
        xp_assert_equal(out, a * b)

    def test_single_element(self, xp):
        a = xp.asarray([4967])
        b = xp.asarray([3920])
        out = fftconvolve(a, b)
        xp_assert_equal(out,
                        xp.asarray(a * b, dtype=out.dtype))

    @pytest.mark.parametrize('axes', ['', None, 0, [0], -1, [-1]])
    def test_random_data(self, axes, xp):
        np.random.seed(1234)
        a_np = np.random.rand(1233) + 1j * np.random.rand(1233)
        b_np = np.random.rand(1321) + 1j * np.random.rand(1321)
        expected = xp.asarray(np.convolve(a_np, b_np, 'full'))
        a = xp.asarray(a_np)
        b = xp.asarray(b_np)

        if axes == '':
            out = fftconvolve(a, b, 'full')
        else:
            if isinstance(axes, list):
                axes = tuple(axes)
            out = fftconvolve(a, b, 'full', axes=axes)
        xp_assert_close(out, expected, rtol=1e-10)

    @pytest.mark.parametrize('axes', [1, [1], -1, [-1]])
    def test_random_data_axes(self, axes, xp):
        np.random.seed(1234)
        a_np = np.random.rand(1233) + 1j * np.random.rand(1233)
        b_np = np.random.rand(1321) + 1j * np.random.rand(1321)
        expected = np.convolve(a_np, b_np, 'full')
        a_np = np.tile(a_np, [2, 1])
        b_np = np.tile(b_np, [2, 1])
        expected = xp.asarray(np.tile(expected, [2, 1]))

        a = xp.asarray(a_np)
        b = xp.asarray(b_np)

        if isinstance(axes, list):
            axes = tuple(axes)

        out = fftconvolve(a, b, 'full', axes=axes)
        xp_assert_close(out, expected, rtol=1e-10)

    @xfail_xp_backends(np_only=True, reason="TODO: swapaxes")
    @pytest.mark.parametrize('axes', [[1, 4],
                                      [4, 1],
                                      [1, -1],
                                      [-1, 1],
                                      [-4, 4],
                                      [4, -4],
                                      [-4, -1],
                                      [-1, -4]])
    def test_random_data_multidim_axes(self, axes, xp):
        a_shape, b_shape = (123, 22), (132, 11)
        np.random.seed(1234)
        a = xp.asarray(np.random.rand(*a_shape) + 1j * np.random.rand(*a_shape))
        b = xp.asarray(np.random.rand(*b_shape) + 1j * np.random.rand(*b_shape))
        expected = convolve2d(a, b, 'full')

        a = a[:, :, None, None, None]
        b = b[:, :, None, None, None]
        expected = expected[:, :, None, None, None]

        a = xp.moveaxis(a.swapaxes(0, 2), 1, 4)
        b = xp.moveaxis(b.swapaxes(0, 2), 1, 4)
        expected = xp.moveaxis(expected.swapaxes(0, 2), 1, 4)

        # use 1 for dimension 2 in a and 3 in b to test broadcasting
        a = xp.asarray(np.tile(a, [2, 1, 3, 1, 1]))
        b = xp.asarray(np.tile(b, [2, 1, 1, 4, 1]))
        expected = xp.asarray(np.tile(expected, [2, 1, 3, 4, 1]))

        out = fftconvolve(a, b, 'full', axes=axes)
        xp_assert_close(out, expected, rtol=1e-10, atol=1e-10)

    @pytest.mark.slow
    @pytest.mark.parametrize(
        'n',
        list(range(1, 100)) +
        list(range(1000, 1500)) +
        np.random.RandomState(1234).randint(1001, 10000, 5).tolist())
    def test_many_sizes(self, n, xp):
        a_np = np.random.rand(n) + 1j * np.random.rand(n)
        b_np = np.random.rand(n) + 1j * np.random.rand(n)
        expected = xp.asarray(np.convolve(a_np, b_np, 'full'))
        a = xp.asarray(a_np)
        b = xp.asarray(b_np)

        out = fftconvolve(a, b, 'full')
        xp_assert_close(out, expected, atol=1e-10)

        out = fftconvolve(a, b, 'full', axes=[0])
        xp_assert_close(out, expected, atol=1e-10)

    @pytest.mark.thread_unsafe
    @skip_xp_backends(np_only=True)
    def test_fft_nan(self, xp):
        n = 1000
        rng = np.random.default_rng(43876432987)
        sig_nan = xp.asarray(rng.standard_normal(n))

        for val in [np.nan, np.inf]:
            sig_nan[100] = val
            coeffs = xp.asarray(signal.firwin(200, 0.2))

            msg = "Use of fft convolution.*|invalid value encountered.*"
            with pytest.warns(RuntimeWarning, match=msg):
                signal.convolve(sig_nan, coeffs, mode='same', method='fft')


def fftconvolve_err(*args, **kwargs):
    raise RuntimeError('Fell back to fftconvolve')


def gen_oa_shapes(sizes):
    return [(a, b) for a, b in product(sizes, repeat=2)
            if abs(a - b) > 3]


def gen_oa_shapes_2d(sizes):
    shapes0 = gen_oa_shapes(sizes)
    shapes1 = gen_oa_shapes(sizes)
    shapes = [ishapes0+ishapes1 for ishapes0, ishapes1 in
              zip(shapes0, shapes1)]

    modes = ['full', 'valid', 'same']
    return [ishapes+(imode,) for ishapes, imode in product(shapes, modes)
            if imode != 'valid' or
            (ishapes[0] > ishapes[1] and ishapes[2] > ishapes[3]) or
            (ishapes[0] < ishapes[1] and ishapes[2] < ishapes[3])]


def gen_oa_shapes_eq(sizes):
    return [(a, b) for a, b in product(sizes, repeat=2)
            if a >= b]


@skip_xp_backends("jax.numpy", reason="fails all around")
@xfail_xp_backends("dask.array", reason="wrong answer")
class TestOAConvolve:
    @pytest.mark.slow()
    @pytest.mark.parametrize('shape_a_0, shape_b_0',
                             gen_oa_shapes_eq(list(range(1, 100, 1)) +
                                              list(range(100, 1000, 23)))
                             )
    def test_real_manylens(self, shape_a_0, shape_b_0, xp):
        a = np.random.rand(shape_a_0)
        b = np.random.rand(shape_b_0)
        a = xp.asarray(a)
        b = xp.asarray(b)

        expected = fftconvolve(a, b)
        out = oaconvolve(a, b)

        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('shape_a_0, shape_b_0',
                             gen_oa_shapes([50, 47, 6, 4, 1]))
    @pytest.mark.parametrize('is_complex', [True, False])
    @pytest.mark.parametrize('mode', ['full', 'valid', 'same'])
    def test_1d_noaxes(self, shape_a_0, shape_b_0,
                       is_complex, mode, monkeypatch, xp):
        a = np.random.rand(shape_a_0)
        b = np.random.rand(shape_b_0)
        if is_complex:
            a = a + 1j*np.random.rand(shape_a_0)
            b = b + 1j*np.random.rand(shape_b_0)

        a = xp.asarray(a)
        b = xp.asarray(b)

        expected = fftconvolve(a, b, mode=mode)

        monkeypatch.setattr(signal._signaltools, 'fftconvolve',
                            fftconvolve_err)
        out = oaconvolve(a, b, mode=mode)

        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('axes', [0, 1])
    @pytest.mark.parametrize('shape_a_0, shape_b_0',
                             gen_oa_shapes([50, 47, 6, 4]))
    @pytest.mark.parametrize('shape_a_extra', [1, 3])
    @pytest.mark.parametrize('shape_b_extra', [1, 3])
    @pytest.mark.parametrize('is_complex', [True, False])
    @pytest.mark.parametrize('mode', ['full', 'valid', 'same'])
    def test_1d_axes(self, axes, shape_a_0, shape_b_0,
                     shape_a_extra, shape_b_extra,
                     is_complex, mode, monkeypatch, xp):
        ax_a = [shape_a_extra]*2
        ax_b = [shape_b_extra]*2
        ax_a[axes] = shape_a_0
        ax_b[axes] = shape_b_0

        a = np.random.rand(*ax_a)
        b = np.random.rand(*ax_b)
        if is_complex:
            a = a + 1j*np.random.rand(*ax_a)
            b = b + 1j*np.random.rand(*ax_b)

        a = xp.asarray(a)
        b = xp.asarray(b)

        expected = fftconvolve(a, b, mode=mode, axes=axes)

        monkeypatch.setattr(signal._signaltools, 'fftconvolve',
                            fftconvolve_err)
        out = oaconvolve(a, b, mode=mode, axes=axes)

        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('shape_a_0, shape_b_0, '
                             'shape_a_1, shape_b_1, mode',
                             gen_oa_shapes_2d([50, 47, 6, 4]))
    @pytest.mark.parametrize('is_complex', [True, False])
    def test_2d_noaxes(self, shape_a_0, shape_b_0,
                       shape_a_1, shape_b_1, mode,
                       is_complex, monkeypatch, xp):
        a = np.random.rand(shape_a_0, shape_a_1)
        b = np.random.rand(shape_b_0, shape_b_1)
        if is_complex:
            a = a + 1j*np.random.rand(shape_a_0, shape_a_1)
            b = b + 1j*np.random.rand(shape_b_0, shape_b_1)

        a = xp.asarray(a)
        b = xp.asarray(b)

        expected = fftconvolve(a, b, mode=mode)

        monkeypatch.setattr(signal._signaltools, 'fftconvolve',
                            fftconvolve_err)
        out = oaconvolve(a, b, mode=mode)

        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('axes', [[0, 1], [0, 2], [1, 2]])
    @pytest.mark.parametrize('shape_a_0, shape_b_0, '
                             'shape_a_1, shape_b_1, mode',
                             gen_oa_shapes_2d([50, 47, 6, 4]))
    @pytest.mark.parametrize('shape_a_extra', [1, 3])
    @pytest.mark.parametrize('shape_b_extra', [1, 3])
    @pytest.mark.parametrize('is_complex', [True, False])
    def test_2d_axes(self, axes, shape_a_0, shape_b_0,
                     shape_a_1, shape_b_1, mode,
                     shape_a_extra, shape_b_extra,
                     is_complex, monkeypatch, xp):
        ax_a = [shape_a_extra]*3
        ax_b = [shape_b_extra]*3
        ax_a[axes[0]] = shape_a_0
        ax_b[axes[0]] = shape_b_0
        ax_a[axes[1]] = shape_a_1
        ax_b[axes[1]] = shape_b_1

        a = np.random.rand(*ax_a)
        b = np.random.rand(*ax_b)
        if is_complex:
            a = a + 1j*np.random.rand(*ax_a)
            b = b + 1j*np.random.rand(*ax_b)

        a = xp.asarray(a)
        b = xp.asarray(b)

        axes = tuple(axes)   # XXX for CuPy
        expected = fftconvolve(a, b, mode=mode, axes=axes)

        monkeypatch.setattr(signal._signaltools, 'fftconvolve',
                            fftconvolve_err)
        out = oaconvolve(a, b, mode=mode, axes=axes)

        assert_array_almost_equal(out, expected)

    @xfail_xp_backends("torch", reason="ValueError: Target length must be positive")
    @pytest.mark.parametrize("a,b", [([], []), ([5, 6], []), ([], [7])])
    def test_empty(self, a, b, xp):
        # Regression test for #1745: crashes with 0-length input.
        xp_assert_equal(
            oaconvolve(xp.asarray(a), xp.asarray(b)),
            xp.asarray([]), check_dtype=False
        )

    def test_zero_rank(self, xp):
        a = xp.asarray(4967)
        b = xp.asarray(3920)
        out = oaconvolve(a, b)
        xp_assert_equal(out, a * b)

    def test_single_element(self, xp):
        a = xp.asarray([4967])
        b = xp.asarray([3920])
        out = oaconvolve(a, b)
        xp_assert_equal(out, a * b)


@skip_xp_backends(np_only=True, reason="assertions may differ on backends")
class TestAllFreqConvolves:

    @pytest.mark.parametrize('convapproach',
                             [fftconvolve, oaconvolve])
    def test_invalid_shapes(self, convapproach, xp):
        a = np.arange(1, 7).reshape((2, 3))
        b = np.arange(-6, 0).reshape((3, 2))
        with assert_raises(ValueError,
                           match="For 'valid' mode, one must be at least "
                           "as large as the other in every dimension"):
            convapproach(a, b, mode='valid')

    @pytest.mark.parametrize('convapproach',
                             [fftconvolve, oaconvolve])
    def test_invalid_shapes_axes(self, convapproach, xp):
        a = np.zeros([5, 6, 2, 1])
        b = np.zeros([5, 6, 3, 1])
        with assert_raises(ValueError,
                           match=r"incompatible shapes for in1 and in2:"
                           r" \(5L?, 6L?, 2L?, 1L?\) and"
                           r" \(5L?, 6L?, 3L?, 1L?\)"):
            convapproach(a, b, axes=[0, 1])

    @pytest.mark.parametrize('a,b',
                             [([1], 2),
                              (1, [2]),
                              ([3], [[2]])])
    @pytest.mark.parametrize('convapproach',
                             [fftconvolve, oaconvolve])
    def test_mismatched_dims(self, a, b, convapproach, xp):
        with assert_raises(ValueError,
                           match="in1 and in2 should have the same"
                           " dimensionality"):
            convapproach(a, b)

    @pytest.mark.parametrize('convapproach',
                             [fftconvolve, oaconvolve])
    def test_invalid_flags(self, convapproach, xp):
        with assert_raises(ValueError,
                           match="acceptable mode flags are 'valid',"
                           " 'same', or 'full'"):
            convapproach([1], [2], mode='chips')

        with assert_raises(ValueError,
                           match="when provided, axes cannot be empty"):
            convapproach([1], [2], axes=[])

        with assert_raises(ValueError, match="axes must be a scalar or "
                           "iterable of integers"):
            convapproach([1], [2], axes=[[1, 2], [3, 4]])

        with assert_raises(ValueError, match="axes must be a scalar or "
                           "iterable of integers"):
            convapproach([1], [2], axes=[1., 2., 3., 4.])

        with assert_raises(ValueError,
                           match="axes exceeds dimensionality of input"):
            convapproach([1], [2], axes=[1])

        with assert_raises(ValueError,
                           match="axes exceeds dimensionality of input"):
            convapproach([1], [2], axes=[-2])

        with assert_raises(ValueError,
                           match="all axes must be unique"):
            convapproach([1], [2], axes=[0, 0])

    @pytest.mark.filterwarnings('ignore::DeprecationWarning')
    @pytest.mark.parametrize('dtype', [np.longdouble, np.clongdouble])
    def test_longdtype_input(self, dtype, xp):
        x = np.random.random((27, 27)).astype(dtype)
        y = np.random.random((4, 4)).astype(dtype)
        if np.iscomplexobj(dtype()):
            x += .1j
            y -= .1j

        res = fftconvolve(x, y)
        xp_assert_close(res, convolve(x, y, method='direct'))
        assert res.dtype == dtype


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestMedFilt:

    IN = [[50, 50, 50, 50, 50, 92, 18, 27, 65, 46],
          [50, 50, 50, 50, 50, 0, 72, 77, 68, 66],
          [50, 50, 50, 50, 50, 46, 47, 19, 64, 77],
          [50, 50, 50, 50, 50, 42, 15, 29, 95, 35],
          [50, 50, 50, 50, 50, 46, 34, 9, 21, 66],
          [70, 97, 28, 68, 78, 77, 61, 58, 71, 42],
          [64, 53, 44, 29, 68, 32, 19, 68, 24, 84],
          [3, 33, 53, 67, 1, 78, 74, 55, 12, 83],
          [7, 11, 46, 70, 60, 47, 24, 43, 61, 26],
          [32, 61, 88, 7, 39, 4, 92, 64, 45, 61]]

    OUT = [[0, 50, 50, 50, 42, 15, 15, 18, 27, 0],
           [0, 50, 50, 50, 50, 42, 19, 21, 29, 0],
           [50, 50, 50, 50, 50, 47, 34, 34, 46, 35],
           [50, 50, 50, 50, 50, 50, 42, 47, 64, 42],
           [50, 50, 50, 50, 50, 50, 46, 55, 64, 35],
           [33, 50, 50, 50, 50, 47, 46, 43, 55, 26],
           [32, 50, 50, 50, 50, 47, 46, 45, 55, 26],
           [7, 46, 50, 50, 47, 46, 46, 43, 45, 21],
           [0, 32, 33, 39, 32, 32, 43, 43, 43, 0],
           [0, 7, 11, 7, 4, 4, 19, 19, 24, 0]]

    KERNEL_SIZE = [7,3]

    def test_basic(self, xp):

        in_ = xp.asarray(self.IN)
        out_ = xp.asarray(self.OUT)
        kernel_size = xp.asarray(self.KERNEL_SIZE)

        d = signal.medfilt(in_, kernel_size)
        e = signal.medfilt2d(xp.asarray(in_, dtype=xp.float64), kernel_size)
        xp_assert_equal(d, out_)
        xp_assert_equal(d, e, check_dtype=False)

    @pytest.mark.parametrize('dtype', ["uint8", "int8", "uint16", "int16",
                                       "uint32", "int32", "uint64", "int64",
                                       "float32", "float64"])
    def test_types(self, dtype, xp):
        # volume input and output types match
        if is_torch(xp) and dtype in ["uint16", "uint32", "uint64"]:
            pytest.skip("torch does not support unisigned ints")

        dtype = getattr(xp, dtype)
        in_typed = xp.asarray(self.IN, dtype=dtype)
        assert signal.medfilt(in_typed).dtype == dtype
        assert signal.medfilt2d(in_typed).dtype == dtype

    @skip_xp_backends(np_only=True, reason="assertions may differ")
    @pytest.mark.parametrize('dtype', [np.bool_, np.complex64, np.complex128,
                                       np.clongdouble, np.float16,
                                       "float96", "float128"])
    def test_invalid_dtypes(self, dtype, xp):
        # We can only test this on platforms that support a native type of float96 or
        # float128; comparing to np.longdouble allows us to filter out non-native types
        if (dtype in ["float96", "float128"]
                and np.finfo(np.longdouble).dtype != dtype):
            pytest.skip(f"Platform does not support {dtype}")

        in_typed = np.array(self.IN, dtype=dtype)
        with pytest.raises(ValueError, match="not supported"):
            signal.medfilt(in_typed)

        with pytest.raises(ValueError, match="not supported"):
            signal.medfilt2d(in_typed)

    @skip_xp_backends(np_only=True, reason="object arrays")
    def test_none(self, xp):
        # gh-1651, trac #1124. Ensure this does not segfault.
        with assert_raises((ValueError, TypeError)):
            signal.medfilt(None)

    @skip_xp_backends(np_only=True, reason="strides are only writeable in NumPy")
    def test_odd_strides(self, xp):
        # Avoid a regression with possible contiguous
        # numpy arrays that have odd strides. The stride value below gets
        # us into wrong memory if used (but it does not need to be used)
        dummy = xp.arange(10, dtype=xp.float64)
        a = dummy[5:6]
        a = np.lib.stride_tricks.as_strided(a, strides=(16,))
        xp_assert_close(signal.medfilt(a, 1),  xp.asarray([5.]))

    @skip_xp_backends(
        "jax.numpy",
        reason="chunk assignment does not work on jax immutable arrays"
    )
    @pytest.mark.parametrize("dtype", ["uint8", "float32", "float64"])
    def test_medfilt2d_parallel(self, dtype, xp):
        dtype = getattr(xp, dtype)
        in_typed = xp.asarray(self.IN, dtype=dtype)
        expected = xp.asarray(self.OUT, dtype=dtype)

        # This is used to simplify the indexing calculations.
        assert in_typed.shape == expected.shape

        # We'll do the calculation in four chunks. M1 and N1 are the dimensions
        # of the first output chunk. We have to extend the input by half the
        # kernel size to be able to calculate the full output chunk.
        M1 = expected.shape[0] // 2
        N1 = expected.shape[1] // 2
        offM = self.KERNEL_SIZE[0] // 2 + 1
        offN = self.KERNEL_SIZE[1] // 2 + 1

        def apply(chunk):
            # in = slice of in_typed to use.
            # sel = slice of output to crop it to the correct region.
            # out = slice of output array to store in.
            M, N = chunk
            if M == 0:
                Min = slice(0, M1 + offM)
                Msel = slice(0, -offM)
                Mout = slice(0, M1)
            else:
                Min = slice(M1 - offM, None)
                Msel = slice(offM, None)
                Mout = slice(M1, None)
            if N == 0:
                Nin = slice(0, N1 + offN)
                Nsel = slice(0, -offN)
                Nout = slice(0, N1)
            else:
                Nin = slice(N1 - offN, None)
                Nsel = slice(offN, None)
                Nout = slice(N1, None)

            # Do the calculation, but do not write to the output in the threads.
            chunk_data = in_typed[Min, Nin]
            med = signal.medfilt2d(chunk_data, self.KERNEL_SIZE)
            return med[Msel, Nsel], Mout, Nout

        # Give each chunk to a different thread.
        output = xp.zeros_like(expected)
        with ThreadPoolExecutor(max_workers=4) as pool:
            chunks = {(0, 0), (0, 1), (1, 0), (1, 1)}
            futures = {pool.submit(apply, chunk) for chunk in chunks}

            # Store each result in the output as it arrives.
            for future in as_completed(futures):
                data, Mslice, Nslice = future.result()
                output[Mslice, Nslice] = data

        xp_assert_equal(output, expected)


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestWiener:

    @skip_xp_backends("cupy", reason="XXX: can_cast in cupy <= 13.2")
    def test_basic(self, xp):
        g = xp.asarray([[5, 6, 4, 3],
                        [3, 5, 6, 2],
                        [2, 3, 5, 6],
                        [1, 6, 9, 7]], dtype=xp.float64)
        h = xp.asarray([[2.16374269, 3.2222222222, 2.8888888889, 1.6666666667],
                        [2.666666667, 4.33333333333, 4.44444444444, 2.8888888888],
                        [2.222222222, 4.4444444444, 5.4444444444, 4.801066874837],
                        [1.33333333333, 3.92735042735, 6.0712560386, 5.0404040404]])
        assert_array_almost_equal(signal.wiener(g), h, decimal=6)
        assert_array_almost_equal(signal.wiener(g, mysize=3), h, decimal=6)


padtype_options = ["mean", "median", "minimum", "maximum", "line"]
padtype_options += _upfirdn_modes


@skip_xp_backends("dask.array", reason="XXX something in dask")
class TestResample:

    @skip_xp_backends("jax.numpy", reason="immutable arrays")
    @skip_xp_backends(
        cpu_only=True, reason="resample_poly/upfirdn is CPU only"
    )
    def test_basic(self, xp):
        # Some basic tests

        # Regression test for issue #3603.
        # window.shape must equal to sig.shape[0]
        sig = xp.arange(128, dtype=xp.float64)
        num = 256
        win = signal.get_window(('kaiser', 8.0), 160)
        assert_raises(ValueError, signal.resample, sig, num, window=win)
        assert_raises(ValueError, signal.resample, sig, num, domain='INVALID')

        # Other degenerate conditions
        assert_raises(ValueError, signal.resample_poly, sig, 'yo', 1)
        assert_raises(ValueError, signal.resample_poly, sig, 1, 0)
        assert_raises(ValueError, signal.resample_poly, sig, 1.3, 2)
        assert_raises(ValueError, signal.resample_poly, sig, 2, 1.3)
        assert_raises(ValueError, signal.resample_poly, sig, 2, 1, padtype='')
        assert_raises(ValueError, signal.resample_poly, sig, 2, 1,
                      padtype='mean', cval=10)
        assert_raises(ValueError, signal.resample_poly, sig, 2, 1, window=np.eye(2))

        # test for issue #6505 - should not modify window.shape when axis ≠ 0
        sig2 = xp.tile(xp.arange(160, dtype=xp.float64), (2, 1))
        signal.resample(sig2, num, axis=-1, window=win)
        assert win.shape == (160,)

        # Ensure coverage for parameter cval=None and cval != None:
        x_ref = signal.resample_poly(sig, 2, 1)
        x0 = signal.resample_poly(sig, 2, 1, padtype='constant')
        x1 = signal.resample_poly(sig, 2, 1, padtype='constant', cval=0)
        xp_assert_equal(x1, x_ref)
        xp_assert_equal(x0, x_ref)

    @pytest.mark.parametrize('window', (None, 'hamming'))
    @pytest.mark.parametrize('N', (20, 19))
    @pytest.mark.parametrize('num', (100, 101, 10, 11))
    @skip_xp_backends('jax.numpy', reason='immutable arrays')
    def test_rfft(self, N, num, window, xp):
        # Make sure the speed up using rfft gives the same result as the normal
        # way using fft
        dt_r = xp_default_dtype(xp)
        dt_c = xp.complex64 if dt_r == xp.float32 else xp.complex128

        x = xp.linspace(0, 10, N, endpoint=False)
        y = xp.cos(-x**2/6.0)
        desired = signal.resample(xp.astype(y, dt_c), num, window=window)
        xp_assert_close(signal.resample(y, num, window=window),
                        xp.real(desired))

        y = xp.stack([xp.cos(-x**2/6.0), xp.sin(-x**2/6.0)])
        y_complex = xp.astype(y, dt_c)
        resampled = signal.resample(y_complex, num, axis=1, window=window)

        atol = 1e-9 if dt_r == xp.float64 else 3e-7

        xp_assert_close(
            signal.resample(y, num, axis=1, window=window),
            xp.real(resampled),
            atol=atol)

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    def test_input_domain(self, xp):
        # Test if both input domain modes produce the same results.
        tsig = xp.astype(xp.arange(256), xp.complex128)
        fsig = sp_fft.fft(tsig)
        num = 256
        xp_assert_close(
            signal.resample(fsig, num, domain='freq'),
            signal.resample(tsig, num, domain='time'),
            atol=1e-9)

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    @pytest.mark.parametrize('nx', (1, 2, 3, 5, 8))
    @pytest.mark.parametrize('ny', (1, 2, 3, 5, 8))
    @pytest.mark.parametrize('dtype', ('float64', 'complex128'))
    def test_dc(self, nx, ny, dtype, xp):
        dtype = getattr(xp, dtype)
        x = xp.asarray([1] * nx, dtype=dtype)
        y = signal.resample(x, ny)
        xp_assert_close(y, xp.asarray([1] * ny, dtype=y.dtype))

    @skip_xp_backends(cpu_only=True, reason="resample_poly/upfirdn is CPU only")
    @pytest.mark.parametrize('padtype', padtype_options)
    def test_mutable_window(self, padtype, xp):
        # Test that a mutable window is not modified
        impulse = xp.zeros(3)
        window = xp.asarray(np.random.RandomState(0).randn(2))
        window_orig = xp.asarray(window, copy=True)
        signal.resample_poly(impulse, 5, 1, window=window, padtype=padtype)
        xp_assert_equal(window, window_orig)

    @skip_xp_backends(
        cpu_only=True, reason="resample_poly/upfirdn is CPU only"
    )
    @pytest.mark.parametrize('padtype', padtype_options)
    def test_output_float32(self, padtype, xp):
        # Test that float32 inputs yield a float32 output
        x = xp.arange(10, dtype=xp.float32)
        h = xp.asarray([1, 1, 1], dtype=xp.float32)
        y = signal.resample_poly(x, 1, 2, window=h, padtype=padtype)
        assert y.dtype == xp.float32


    @skip_xp_backends(
        cpu_only=True, reason="resample_poly/upfirdn is CPU only"
    )
    @pytest.mark.parametrize('padtype', padtype_options)
    @pytest.mark.parametrize('dtype', ['float32', 'float64'])
    def test_output_match_dtype(self, padtype, dtype, xp):
        # Test that the dtype of x is preserved per issue #14733
        dtype = getattr(xp, dtype)
        x = xp.arange(10, dtype=dtype)
        y = signal.resample_poly(x, 1, 2, padtype=padtype)
        assert y.dtype == x.dtype

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    @skip_xp_backends(
        cpu_only=True, reason="resample_poly/upfirdn is CPU only"
    )
    @pytest.mark.parametrize(
        "method, ext, padtype",
        [("fft", False, None)]
        + list(
            product(
                ["polyphase"], [False, True], padtype_options,
            )
        ),
    )
    def test_resample_methods(self, method, ext, padtype, xp):
        # Test resampling of sinusoids and random noise (1-sec)
        rate = 100
        rates_to = [49, 50, 51, 99, 100, 101, 199, 200, 201]

        # Sinusoids, windowed to avoid edge artifacts
        t = xp.arange(rate, dtype=xp.float64) / float(rate)
        freqs = xp.asarray((1., 10., 40.))[:, xp.newaxis]
        x = xp.sin(2 * xp.pi * freqs * t) * hann(rate, xp=xp)

        for rate_to in rates_to:
            t_to = xp.arange(rate_to, dtype=xp.float64) / float(rate_to)
            y_tos = xp.sin(2 * xp.pi * freqs * t_to) * hann(rate_to, xp=xp)
            if method == 'fft':
                y_resamps = signal.resample(x, rate_to, axis=-1)
            else:
                if ext and rate_to != rate:
                    # Match default window design
                    g = gcd(rate_to, rate)
                    up = rate_to // g
                    down = rate // g
                    max_rate = max(up, down)
                    f_c = 1. / max_rate
                    half_len = 10 * max_rate
                    window = signal.firwin(2 * half_len + 1, f_c,
                                           window=('kaiser', 5.0))
                    polyargs = {'window': window, 'padtype': padtype}
                else:
                    polyargs = {'padtype': padtype}

                y_resamps = signal.resample_poly(x, rate_to, rate, axis=-1,
                                                 **polyargs)

            for i in range(y_tos.shape[0]):
                y_to = y_tos[i, :]
                y_resamp = y_resamps[i, :]
                freq = float(freqs[i, 0])
                if freq >= 0.5 * rate_to:
                    #y_to.fill(0.)  # mostly low-passed away
                    y_to = xp.zeros_like(y_to)  # mostly low-passed away
                    if padtype in ['minimum', 'maximum']:
                        xp_assert_close(y_resamp, y_to, atol=3e-1)
                    else:
                        xp_assert_close(y_resamp, y_to, atol=1e-3)
                else:
                    assert y_to.shape == y_resamp.shape
                    corr = np.corrcoef(y_to, y_resamp)[0, 1]
                    assert corr > 0.99, (corr, rate, rate_to)

        # Random data
        rng = np.random.RandomState(0)
        x = hann(rate) * np.cumsum(rng.randn(rate))  # low-pass, wind
        x = xp.asarray(x)
        for rate_to in rates_to:
            # random data
            t_to = xp.arange(rate_to, dtype=xp.float64) / float(rate_to)
            y_to = np.interp(t_to, t, x)
            if method == 'fft':
                y_resamp = signal.resample(x, rate_to)
            else:
                y_resamp = signal.resample_poly(x, rate_to, rate,
                                                padtype=padtype)
            assert y_to.shape == y_resamp.shape
            corr = xp.asarray(np.corrcoef(y_to, np.asarray(y_resamp))[0, 1])
            assert corr > 0.99, corr

        # More tests of fft method (Master 0.18.1 fails these)
        if method == 'fft':
            x1 = xp.asarray([1.+0.j, 0.+0.j])
            y1_test = signal.resample(x1, 4)
            # upsampling a complex array
            y1_true = xp.asarray([1.+0.j, 0.5+0.j, 0.+0.j, 0.5+0.j])
            xp_assert_close(y1_test, y1_true, atol=1e-12)
            x2 = xp.asarray([1., 0.5, 0., 0.5])
            y2_test = signal.resample(x2, 2)  # downsampling a real array
            y2_true = xp.asarray([1., 0.])
            xp_assert_close(y2_test, y2_true, atol=1e-12)

    @pytest.mark.parametrize("n_in", (8, 9))
    @pytest.mark.parametrize("n_out", (3, 4))
    def test_resample_win_func(self, n_in, n_out):
        """Test callable window function. """
        x_in = np.ones(n_in)

        def win(freqs):
            """Scale input by 1/2"""
            return 0.5 * np.ones_like(freqs)

        y0 = signal.resample(x_in, n_out)
        y1 = signal.resample(x_in, n_out, window=win)

        xp_assert_close(2*y1, y0, atol=1e-12)

    @pytest.mark.parametrize("n_in", (6, 12))
    @pytest.mark.parametrize("n_out", (3, 4))
    def test__resample_param_t(self, n_in, n_out):
        """Verify behavior for parameter `t`.

        Note that only `t[0]` and `t[1]` are utilized.
        """
        t0, dt = 10, 2
        x_in = np.ones(n_in)

        y0 = signal.resample(x_in, n_out)
        y1, t1 = signal.resample(x_in, n_out, t=[t0, t0+dt])
        t_ref = 10 + np.arange(len(y0)) * dt * n_in / n_out

        xp_assert_equal(y1, y0)  # no influence of `t`
        xp_assert_close(t1, t_ref, atol=1e-12)

    @pytest.mark.parametrize("n1", (2, 3, 7, 8))
    @pytest.mark.parametrize("n0", (2, 3, 7, 8))
    def test_resample_nyquist(self, n0, n1):
        """Test behavior at Nyquist frequency to ensure issue #14569 is fixed. """
        f_ny = min(n0, n1) // 2
        tt = (np.arange(n_) / n_ for n_ in (n0, n1))
        x0, x1 = (np.cos(2 * np.pi * f_ny * t_) for t_ in tt)

        y1_r = signal.resample(x0, n1)
        y1_c = signal.resample(x0 + 0j, n1)

        xp_assert_close(y1_r, x1, atol=1e-12)
        xp_assert_close(y1_c.real, x1, atol=1e-12)

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    @skip_xp_backends(
        cpu_only=True, exceptions=["cupy"], reason="filtfilt is CPU-only"
    )
    @pytest.mark.parametrize('down_factor', [2, 11, 79])
    def test_poly_vs_filtfilt(self, down_factor, xp):
        # Check that up=1.0 gives same answer as filtfilt + slicing
        random_state = np.random.RandomState(17)
        try_types = (int, np.float32, np.complex64, float, complex)
        size = 10000

        for dtype in try_types:
            x = random_state.randn(size).astype(dtype)
            if dtype in (np.complex64, np.complex128):
                x += 1j * random_state.randn(size)
            x = xp.asarray(x)

            # resample_poly assumes zeros outside of signl, whereas filtfilt
            # can only constant-pad. Make them equivalent:
            x[0] = 0
            x[-1] = 0

            h = signal.firwin(31, 1. / down_factor, window='hamming')
            h = xp.asarray(h)   # XXX: convert firwin
            yf = filtfilt(h, 1.0, x, padtype='constant')[::down_factor]

            # Need to pass convolved version of filter to resample_poly,
            # since filtfilt does forward and backward, but resample_poly
            # only goes forward
            hc = convolve(h, xp.flip(h))
            y = signal.resample_poly(x, 1, down_factor, window=hc)
            xp_assert_close(yf, y, atol=1e-7, rtol=1e-7)

    @skip_xp_backends(
        cpu_only=True, exceptions=["cupy"], reason="correlate1d is CPU-only"
    )
    def test_correlate1d(self, xp):
        for down in [2, 4]:
            for nx in range(1, 40, down):
                for nweights in (32, 33):
                    x = np.random.random((nx,))
                    weights = np.random.random((nweights,))
                    x, weights = map(xp.asarray, (x, weights))
                    flip = array_namespace(x).flip
                    y_g = correlate1d(x, flip(weights), mode='constant')
                    y_s = signal.resample_poly(
                        x, up=1, down=down, window=weights)
                    xp_assert_close(y_g[::down], y_s)

    @skip_xp_backends(
        cpu_only=True, reason="resample_poly/upfirdn is CPU only"
    )
    @pytest.mark.parametrize('dtype', ['int32', 'float32'])
    def test_gh_15620(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([0, 1, 2, 3, 2, 1, 0], dtype=dtype)
        actual = signal.resample_poly(data,
                                      up=2,
                                      down=1,
                                      padtype='smooth')
        assert np.count_nonzero(actual) > 0


@skip_xp_backends(np_only=True)
class TestCSpline1DEval:

    def test_basic(self, xp):
        y = np.array([1, 2, 3, 4, 3, 2, 1, 2, 3.0])
        x = np.arange(len(y))
        dx = x[1] - x[0]
        cj = signal.cspline1d(y)

        x2 = np.arange(len(y) * 10.0) / 10.0
        y2 = signal.cspline1d_eval(cj, x2, dx=dx, x0=x[0])

        # make sure interpolated values are on knot points
        assert_array_almost_equal(y2[::10], y, decimal=5)

    def test_complex(self, xp):
        #  create some smoothly varying complex signal to interpolate
        x = np.arange(2)
        y = np.zeros(x.shape, dtype=np.complex64)
        T = 10.0
        f = 1.0 / T
        y = np.exp(2.0J * np.pi * f * x)

        # get the cspline transform
        cy = signal.cspline1d(y)

        # determine new test x value and interpolate
        xnew = np.array([0.5])
        ynew = signal.cspline1d_eval(cy, xnew)

        assert ynew.dtype == y.dtype


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestOrderFilt:

    def test_basic(self, xp):
        actual = signal.order_filter(xp.asarray([1, 2, 3]), xp.asarray([1, 0, 1]), 1)
        expect = xp.asarray([2, 3, 2])
        xp_assert_equal(actual, expect)

    def test_doc_example(self, xp):
        x = xp.reshape(xp.arange(25, dtype=xp_default_dtype(xp)), (5, 5))
        domain = xp.eye(3, dtype=xp_default_dtype(xp))

        # minimum of elements 1,3,9 (zero-padded) on phone pad
        # 7,5,3 on numpad
        expected = xp.asarray(
            [[0., 0., 0., 0., 0.],
             [0., 0., 1., 2., 0.],
             [0., 5., 6., 7., 0.],
             [0., 10., 11., 12., 0.],
             [0., 0., 0., 0., 0.]],
            dtype=xp_default_dtype(xp)
        )
        xp_assert_close(signal.order_filter(x, domain, 0), expected)

        # maximum of elements 1,3,9 (zero-padded) on phone pad
        # 7,5,3 on numpad
        expected = xp.asarray(
            [[6., 7., 8., 9., 4.],
             [11., 12., 13., 14., 9.],
             [16., 17., 18., 19., 14.],
             [21., 22., 23., 24., 19.],
             [20., 21., 22., 23., 24.]],
        )
        xp_assert_close(signal.order_filter(x, domain, 2), expected)

        # and, just to complete the set, median of zero-padded elements
        expected = xp.asarray(
            [[0, 1, 2, 3, 0],
             [5, 6, 7, 8, 3],
             [10, 11, 12, 13, 8],
             [15, 16, 17, 18, 13],
             [0, 15, 16, 17, 18]],
            dtype=xp_default_dtype(xp)
        )
        xp_assert_close(signal.order_filter(x, domain, 1), expected)

    @xfail_xp_backends('dask.array', reason='repeat requires an axis')
    @xfail_xp_backends('torch', reason='array-api-compat#292')
    def test_medfilt_order_filter(self, xp):
        x = xp.reshape(xp.arange(25), (5, 5))

        # median of zero-padded elements 1,5,9 on phone pad
        # 7,5,3 on numpad
        expected = xp.asarray(
            [[0, 1, 2, 3, 0],
             [1, 6, 7, 8, 4],
             [6, 11, 12, 13, 9],
             [11, 16, 17, 18, 14],
             [0, 16, 17, 18, 0]],
        )
        xp_assert_close(signal.medfilt(x, 3), expected)

        xp_assert_close(
            signal.order_filter(x, xp.ones((3, 3)), 4),
            expected
        )

    def test_order_filter_asymmetric(self, xp):
        x = xp.reshape(xp.arange(25), (5, 5))
        domain = xp.asarray(
            [[1, 1, 0],
             [0, 1, 0],
             [0, 0, 0]],
        )

        expected = xp.asarray(
            [[0, 0, 0, 0, 0],
             [0, 0, 1, 2, 3],
             [0, 5, 6, 7, 8],
             [0, 10, 11, 12, 13],
             [0, 15, 16, 17, 18]]
        )
        xp_assert_close(signal.order_filter(x, domain, 0), expected)

        expected = xp.asarray(
            [[0, 0, 0, 0, 0],
             [0, 1, 2, 3, 4],
             [5, 6, 7, 8, 9],
             [10, 11, 12, 13, 14],
             [15, 16, 17, 18, 19]]
        )
        xp_assert_close(signal.order_filter(x, domain, 1), expected)


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class _TestLinearFilter:

    def setup_method(self):
        if self.dtype == object:
            self.assert_close = np.testing.assert_allclose
            self.assert_equal = np.testing.assert_equal
            self.assert_array_almost_equal = np.testing.assert_array_almost_equal
        else:
            self.assert_close = xp_assert_close
            self.assert_equal = xp_assert_equal
            self.assert_array_almost_equal = assert_array_almost_equal

    def generate(self, shape, xp):
        prodshape = shape if isinstance(shape, int) else math.prod(shape)
        x = xp.linspace(0, prodshape - 1, prodshape)
        if not isinstance(shape, int):
            x = xp.reshape(x, shape)
        return self.convert_dtype(x, xp)

    def convert_dtype(self, arr, xp):
        if self.dtype == np.dtype('O'):
            arr = np.asarray(arr)
            out = np.empty(arr.shape, self.dtype)
            iter = np.nditer([arr, out], ['refs_ok','zerosize_ok'],
                        [['readonly'],['writeonly']])
            for x, y in iter:
                y[...] = self.type(x[()])
            return out
        else:
            dtype = (getattr(xp, self.dtype)
                     if isinstance(self.dtype, str)
                     else self.dtype)
            return xp.asarray(arr, dtype=dtype)

    def test_rank_1_IIR(self, xp):
        x = self.generate((6,), xp)
        b = self.convert_dtype([1, -1], xp)
        a = self.convert_dtype([0.5, -0.5], xp)
        y_r = self.convert_dtype([0, 2, 4, 6, 8, 10.], xp)
        self.assert_array_almost_equal(lfilter(b, a, x), y_r)

    def test_rank_1_FIR(self, xp):
        x = self.generate((6,), xp)
        b = self.convert_dtype([1, 1], xp)
        a = self.convert_dtype([1], xp)
        y_r = self.convert_dtype([0, 1, 3, 5, 7, 9.], xp)
        self.assert_array_almost_equal(lfilter(b, a, x), y_r)

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_rank_1_IIR_init_cond(self, xp):
        x = self.generate((6,), xp)
        b = self.convert_dtype([1, 0, -1], xp)
        a = self.convert_dtype([0.5, -0.5], xp)
        zi = self.convert_dtype([1, 2], xp)
        y_r = self.convert_dtype([1, 5, 9, 13, 17, 21], xp)
        zf_r = self.convert_dtype([13, -10], xp)
        y, zf = lfilter(b, a, x, zi=zi)
        self.assert_array_almost_equal(y, y_r)
        self.assert_array_almost_equal(zf, zf_r)

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_rank_1_FIR_init_cond(self, xp):
        x = self.generate((6,), xp)
        b = self.convert_dtype([1, 1, 1], xp)
        a = self.convert_dtype([1], xp)
        zi = self.convert_dtype([1, 1], xp)
        y_r = self.convert_dtype([1, 2, 3, 6, 9, 12.], xp)
        zf_r = self.convert_dtype([9, 5], xp)
        y, zf = lfilter(b, a, x, zi=zi)
        self.assert_array_almost_equal(y, y_r)
        self.assert_array_almost_equal(zf, zf_r)

    def test_rank_2_IIR_axis_0(self, xp):
        x = self.generate((4, 3), xp)
        b = self.convert_dtype([1, -1], xp)
        a = self.convert_dtype([0.5, 0.5], xp)
        y_r2_a0 = self.convert_dtype([[0, 2, 4], [6, 4, 2], [0, 2, 4],
                                      [6, 4, 2]], xp)
        y = lfilter(b, a, x, axis=0)
        self.assert_array_almost_equal(y_r2_a0, y)

    def test_rank_2_IIR_axis_1(self, xp):
        x = self.generate((4, 3), xp)
        b = self.convert_dtype([1, -1], xp)
        a = self.convert_dtype([0.5, 0.5], xp)
        y_r2_a1 = self.convert_dtype([[0, 2, 0], [6, -4, 6], [12, -10, 12],
                            [18, -16, 18]], xp)
        y = lfilter(b, a, x, axis=1)
        self.assert_array_almost_equal(y_r2_a1, y)

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_rank_2_IIR_axis_0_init_cond(self, xp):
        x = self.generate((4, 3), xp)
        b = self.convert_dtype([1, -1], xp)
        a = self.convert_dtype([0.5, 0.5], xp)
        zi = self.convert_dtype(np.ones((4,1)), xp)

        y_r2_a0_1 = self.convert_dtype([[1, 1, 1], [7, -5, 7], [13, -11, 13],
                              [19, -17, 19]], xp)
        zf_r = self.convert_dtype([-5, -17, -29, -41], xp)[:, np.newaxis]
        y, zf = lfilter(b, a, x, axis=1, zi=zi)
        self.assert_array_almost_equal(y_r2_a0_1, y)
        self.assert_array_almost_equal(zf, zf_r)

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_rank_2_IIR_axis_1_init_cond(self, xp):
        x = self.generate((4, 3), xp)
        b = self.convert_dtype([1, -1], xp)
        a = self.convert_dtype([0.5, 0.5], xp)
        zi = self.convert_dtype(np.ones((1, 3)), xp)

        y_r2_a0_0 = self.convert_dtype([[1, 3, 5], [5, 3, 1],
                                        [1, 3, 5], [5, 3, 1]], xp)
        zf_r = self.convert_dtype([[-23, -23, -23]], xp)
        y, zf = lfilter(b, a, x, axis=0, zi=zi)
        self.assert_array_almost_equal(y_r2_a0_0, y)
        self.assert_array_almost_equal(zf, zf_r)

    @skip_xp_backends(np_only=True, reason='np.apply_along_axis is np only')
    def test_rank_3_IIR(self, xp):
        x = self.generate((4, 3, 2), xp)
        b = self.convert_dtype([1, -1], xp)
        a = self.convert_dtype([0.5, 0.5], xp)

        a_np, b_np, x_np = np.asarray(a), np.asarray(b), np.asarray(x)
        for axis in range(x.ndim):
            y = lfilter(b, a, x, axis)
            y_r = np.apply_along_axis(lambda w: lfilter(b_np, a_np, w), axis, x_np)
            self.assert_array_almost_equal(y, xp.asarray(y_r))

    @skip_xp_backends(np_only=True, reason='np.apply_along_axis is np only')
    def test_rank_3_IIR_init_cond(self, xp):
        x = self.generate((4, 3, 2), xp)
        b = self.convert_dtype([1, -1], xp)
        a = self.convert_dtype([0.5, 0.5], xp)

        for axis in range(x.ndim):
            zi_shape = list(x.shape)
            zi_shape[axis] = 1
            zi = self.convert_dtype(xp.ones(zi_shape), xp)
            zi1 = self.convert_dtype([1], xp)
            y, zf = lfilter(b, a, x, axis, zi)
            def lf0(w):
                return np.asarray(lfilter(b, a, w, zi=zi1)[0])
            def lf1(w):
                return np.asarray(lfilter(b, a, w, zi=zi1)[1])
            y_r = np.apply_along_axis(lf0, axis, np.asarray(x))
            zf_r = np.apply_along_axis(lf1, axis, np.asarray(x))
            self.assert_array_almost_equal(y, xp.asarray(y_r))
            self.assert_array_almost_equal(zf, xp.asarray(zf_r))

    @skip_xp_backends(np_only=True, reason='np.apply_along_axis is np only')
    def test_rank_3_FIR(self, xp):
        x = self.generate((4, 3, 2), xp)
        b = self.convert_dtype([1, 0, -1], xp)
        a = self.convert_dtype([1], xp)

        a_np, b_np, x_np = np.asarray(a), np.asarray(b), np.asarray(x)
        for axis in range(x.ndim):
            y = lfilter(b, a, x, axis)
            y_r = np.apply_along_axis(lambda w: lfilter(b_np, a_np, w), axis, x_np)
            self.assert_array_almost_equal(y, xp.asarray(y_r))

    @skip_xp_backends(np_only=True, reason='np.apply_along_axis is np only')
    def test_rank_3_FIR_init_cond(self, xp):
        x = self.generate((4, 3, 2), xp)
        b = self.convert_dtype([1, 0, -1], xp)
        a = self.convert_dtype([1], xp)

        x_np = np.asarray(x)
        for axis in range(x.ndim):
            zi_shape = list(x.shape)
            zi_shape[axis] = 2
            zi = self.convert_dtype(xp.ones(zi_shape), xp)
            zi1 = self.convert_dtype([1, 1], xp)
            y, zf = lfilter(b, a, x, axis, zi)
            def lf0(w):
                return np.asarray(lfilter(b, a, w, zi=zi1)[0])
            def lf1(w):
                return np.asarray(lfilter(b, a, w, zi=zi1)[1])
            y_r = np.apply_along_axis(lf0, axis, x_np)
            zf_r = np.apply_along_axis(lf1, axis, x_np)
            self.assert_array_almost_equal(y, xp.asarray(y_r))
            self.assert_array_almost_equal(zf, xp.asarray(zf_r))

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_zi_pseudobroadcast(self, xp):
        x = self.generate((4, 5, 20), xp)
        b, a = signal.butter(8, 0.2, output='ba')
        b = self.convert_dtype(b, xp)
        a = self.convert_dtype(a, xp)
        zi_size = b.shape[0] - 1

        # lfilter requires x.ndim == zi.ndim exactly.  However, zi can have
        # length 1 dimensions.
        zi_full = self.convert_dtype(xp.ones((4, 5, zi_size)), xp)
        zi_sing = self.convert_dtype(xp.ones((1, 1, zi_size)), xp)

        y_full, zf_full = lfilter(b, a, x, zi=zi_full)
        y_sing, zf_sing = lfilter(b, a, x, zi=zi_sing)

        self.assert_array_almost_equal(y_sing, y_full)
        self.assert_array_almost_equal(zf_full, zf_sing)

        # lfilter does not prepend ones
        assert_raises(ValueError, lfilter, b, a, x, -1, xp.ones(zi_size))

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_scalar_a(self, xp):
        # a can be a scalar.
        x = self.generate(6, xp)
        b = self.convert_dtype([1, 0, -1], xp)
        a = self.convert_dtype([1], xp)
        y_r = self.convert_dtype([0, 1, 2, 2, 2, 2], xp)

        y = lfilter(b, a[0], x)
        self.assert_array_almost_equal(y, y_r)

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_zi_some_singleton_dims(self, xp):
        # lfilter doesn't really broadcast (no prepending of 1's).  But does
        # do singleton expansion if x and zi have the same ndim.  This was
        # broken only if a subset of the axes were singletons (gh-4681).
        x = self.convert_dtype(xp.zeros((3, 2, 5), dtype=xp.int64), xp)
        b = self.convert_dtype(xp.ones(5, dtype=xp.int64), xp)
        a = self.convert_dtype(xp.asarray([1, 0, 0]), xp)
        zi = np.ones((3, 1, 4), dtype=np.int64)
        zi[1, :, :] *= 2
        zi[2, :, :] *= 3
        zi = xp.asarray(zi)
        zi = self.convert_dtype(zi, xp)

        zf_expected = self.convert_dtype(xp.zeros((3, 2, 4), dtype=xp.int64), xp)
        y_expected = np.zeros((3, 2, 5), dtype=np.int64)
        y_expected[:, :, :4] = [[[1]], [[2]], [[3]]]
        y_expected = xp.asarray(y_expected)
        y_expected = self.convert_dtype(y_expected, xp)

        # IIR
        y_iir, zf_iir = lfilter(b, a, x, -1, zi)
        self.assert_array_almost_equal(y_iir, y_expected)
        self.assert_array_almost_equal(zf_iir, zf_expected)

        # FIR
        y_fir, zf_fir = lfilter(b, a[0], x, -1, zi)
        self.assert_array_almost_equal(y_fir, y_expected)
        self.assert_array_almost_equal(zf_fir, zf_expected)

    def base_bad_size_zi(self, b, a, x, axis, zi, xp):
        b = self.convert_dtype(b, xp)
        a = self.convert_dtype(a, xp)
        x = self.convert_dtype(x, xp)
        zi = self.convert_dtype(zi, xp)
        assert_raises(ValueError, lfilter, b, a, x, axis, zi)

    @skip_xp_backends('cupy', reason='cupy does not raise')
    def test_bad_size_zi(self, xp):
        # rank 1
        x1 = xp.arange(6)
        self.base_bad_size_zi([1], [1], x1, -1, [1], xp)
        self.base_bad_size_zi([1, 1], [1], x1, -1, [0, 1], xp)
        self.base_bad_size_zi([1, 1], [1], x1, -1, [[0]], xp)
        self.base_bad_size_zi([1, 1], [1], x1, -1, [0, 1, 2], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x1, -1, [[0]], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x1, -1, [0, 1, 2], xp)
        self.base_bad_size_zi([1], [1, 1], x1, -1, [0, 1], xp)
        self.base_bad_size_zi([1], [1, 1], x1, -1, [[0]], xp)
        self.base_bad_size_zi([1], [1, 1], x1, -1, [0, 1, 2], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x1, -1, [0], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x1, -1, [[0], [1]], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x1, -1, [0, 1, 2], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x1, -1, [0, 1, 2, 3], xp)
        self.base_bad_size_zi([1, 1], [1, 1, 1], x1, -1, [0], xp)
        self.base_bad_size_zi([1, 1], [1, 1, 1], x1, -1, [[0], [1]], xp)
        self.base_bad_size_zi([1, 1], [1, 1, 1], x1, -1, [0, 1, 2], xp)
        self.base_bad_size_zi([1, 1], [1, 1, 1], x1, -1, [0, 1, 2, 3], xp)

        # rank 2
        x2 = np.arange(12).reshape((4,3))
        x2 = xp.asarray(x2)
        # for axis=0 zi.shape should == (max(len(a),len(b))-1, 3)
        self.base_bad_size_zi([1], [1], x2, 0, [0], xp)

        # for each of these there are 5 cases tested (in this order):
        # 1. not deep enough, right # elements
        # 2. too deep, right # elements
        # 3. right depth, right # elements, transposed
        # 4. right depth, too few elements
        # 5. right depth, too many elements

        self.base_bad_size_zi([1, 1], [1], x2, 0, [0, 1, 2], xp)
        self.base_bad_size_zi([1, 1], [1], x2, 0, [[[0, 1, 2]]], xp)
        self.base_bad_size_zi([1, 1], [1], x2, 0, [[0], [1], [2]], xp)
        self.base_bad_size_zi([1, 1], [1], x2, 0, [[0, 1]], xp)
        self.base_bad_size_zi([1, 1], [1], x2, 0, [[0, 1, 2, 3]], xp)

        self.base_bad_size_zi([1, 1, 1], [1], x2, 0, [0, 1, 2, 3, 4, 5], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x2, 0, [[[0, 1, 2], [3, 4, 5]]], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x2, 0, [[0, 1], [2, 3], [4, 5]], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x2, 0, [[0, 1], [2, 3]], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x2, 0, [[0, 1, 2, 3], [4, 5, 6, 7]], xp)

        self.base_bad_size_zi([1], [1, 1], x2, 0, [0, 1, 2], xp)
        self.base_bad_size_zi([1], [1, 1], x2, 0, [[[0, 1, 2]]], xp)
        self.base_bad_size_zi([1], [1, 1], x2, 0, [[0], [1], [2]], xp)
        self.base_bad_size_zi([1], [1, 1], x2, 0, [[0, 1]], xp)
        self.base_bad_size_zi([1], [1, 1], x2, 0, [[0, 1, 2, 3]], xp)

        self.base_bad_size_zi([1], [1, 1, 1], x2, 0, [0, 1, 2, 3, 4, 5], xp)
        self.base_bad_size_zi([1], [1, 1, 1], x2, 0, [[[0, 1, 2], [3, 4, 5]]], xp)
        self.base_bad_size_zi([1], [1, 1, 1], x2, 0, [[0, 1], [2, 3], [4, 5]], xp)
        self.base_bad_size_zi([1], [1, 1, 1], x2, 0, [[0, 1], [2, 3]], xp)
        self.base_bad_size_zi([1], [1, 1, 1], x2, 0, [[0, 1, 2, 3], [4, 5, 6, 7]], xp)

        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 0, [0, 1, 2, 3, 4, 5], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 0, [[[0, 1, 2], [3, 4, 5]]], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 0, [[0, 1], [2, 3], [4, 5]], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 0, [[0, 1], [2, 3]], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 0,
                              [[0, 1, 2, 3], [4, 5, 6, 7]], xp)

        # for axis=1 zi.shape should == (4, max(len(a),len(b))-1)
        self.base_bad_size_zi([1], [1], x2, 1, [0], xp)

        self.base_bad_size_zi([1, 1], [1], x2, 1, [0, 1, 2, 3], xp)
        self.base_bad_size_zi([1, 1], [1], x2, 1, [[[0], [1], [2], [3]]], xp)
        self.base_bad_size_zi([1, 1], [1], x2, 1, [[0, 1, 2, 3]], xp)
        self.base_bad_size_zi([1, 1], [1], x2, 1, [[0], [1], [2]], xp)
        self.base_bad_size_zi([1, 1], [1], x2, 1, [[0], [1], [2], [3], [4]], xp)

        self.base_bad_size_zi([1, 1, 1], [1], x2, 1, [0, 1, 2, 3, 4, 5, 6, 7], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x2, 1,
                              [[[0, 1], [2, 3], [4, 5], [6, 7]]], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x2, 1, [[0, 1, 2, 3], [4, 5, 6, 7]], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x2, 1, [[0, 1], [2, 3], [4, 5]], xp)
        self.base_bad_size_zi([1, 1, 1], [1], x2, 1,
                              [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]], xp)

        self.base_bad_size_zi([1], [1, 1], x2, 1, [0, 1, 2, 3], xp)
        self.base_bad_size_zi([1], [1, 1], x2, 1, [[[0], [1], [2], [3]]], xp)
        self.base_bad_size_zi([1], [1, 1], x2, 1, [[0, 1, 2, 3]], xp)
        self.base_bad_size_zi([1], [1, 1], x2, 1, [[0], [1], [2]], xp)
        self.base_bad_size_zi([1], [1, 1], x2, 1, [[0], [1], [2], [3], [4]], xp)

        self.base_bad_size_zi([1], [1, 1, 1], x2, 1, [0, 1, 2, 3, 4, 5, 6, 7], xp)
        self.base_bad_size_zi([1], [1, 1, 1], x2, 1,
                              [[[0, 1], [2, 3], [4, 5], [6, 7]]], xp)
        self.base_bad_size_zi([1], [1, 1, 1], x2, 1, [[0, 1, 2, 3], [4, 5, 6, 7]], xp)
        self.base_bad_size_zi([1], [1, 1, 1], x2, 1, [[0, 1], [2, 3], [4, 5]], xp)
        self.base_bad_size_zi([1], [1, 1, 1], x2, 1, [[0, 1],
                              [2, 3], [4, 5], [6, 7], [8, 9]], xp)

        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 1, [0, 1, 2, 3, 4, 5, 6, 7], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 1,
                              [[[0, 1], [2, 3], [4, 5], [6, 7]]], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 1,
                              [[0, 1, 2, 3], [4, 5, 6, 7]], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 1, [[0, 1], [2, 3], [4, 5]], xp)
        self.base_bad_size_zi([1, 1, 1], [1, 1], x2, 1,
                              [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]], xp)

    def test_empty_zi(self, xp):
        # Regression test for #880: empty array for zi crashes.
        x = self.generate((5,), xp)
        a = self.convert_dtype([1], xp)
        b = self.convert_dtype([1], xp)
        zi = self.convert_dtype([], xp)
        y, zf = lfilter(b, a, x, zi=zi)
        self.assert_array_almost_equal(y, x)
        assert zf.dtype == (getattr(xp, self.dtype)
                            if isinstance(self.dtype, str)
                            else self.dtype)
        assert xp_size(zf) == 0

    @skip_xp_backends('jax.numpy', reason='jax does not support inplace ops')
    @pytest.mark.parametrize('a', (1, [1], [1, .5, 1.5], 2, [2], [2, 1, 3]),
                             ids=str)
    def test_lfiltic(self, a, xp):
        # Test for #22470: lfiltic does not handle `a[0] != 1`
        # and, more in general, test that lfiltic behaves consistently with lfilter
        if is_cupy(xp) and isinstance(a, int | float):
            pytest.skip('cupy does not supoprt scalar filter coefficients')
        x = self.generate(6, xp)  # arbitrary input
        b = self.convert_dtype([.5, 1., .2], xp)  # arbitrary b
        a = self.convert_dtype(a, xp)
        N = xp_size(a) - 1
        M = xp_size(b) - 1
        K = M + N if is_cupy(xp) else max(N, M)
        # compute reference initial conditions as final conditions of lfilter
        y1, zi_1 = lfilter(b, a, x, zi=self.generate(K, xp))
        # copute initial conditions from lfiltic
        zi_2 = lfiltic(b, a, xp.flip(y1), xp.flip(x))
        # compare lfiltic's output with reference
        self.assert_array_almost_equal(zi_1, zi_2)

    def test_lfiltic_bad_coeffs(xp):
        # Test for invalid filter coefficients (wrong shape or zero `a[0]`)
        assert_raises(ValueError, lfiltic, [1, 2], [], [0, 0], [0, 1])
        assert_raises(ValueError, lfiltic, [1, 2], [0, 2], [0, 0], [0, 1])
        assert_raises(ValueError, lfiltic, [1, 2], [[1], [2]], [0, 0], [0, 1])
        assert_raises(ValueError, lfiltic, [[1], [2]], [1], [0, 0], [0, 1])

    @skip_xp_backends(
        'array_api_strict', reason='int64 and float64 cannot be promoted together'
    )
    @skip_xp_backends('jax.numpy', reason='jax dtype defaults differ')
    def test_lfiltic_bad_zi(self, xp):
        # Regression test for #3699: bad initial conditions
        a = self.convert_dtype([1], xp)
        b = self.convert_dtype([1], xp)
        # "y" sets the datatype of zi, so it truncates if int
        zi = lfiltic(b, a, xp.asarray([1., 0]))
        zi_1 = lfiltic(b, a, xp.asarray([1.0, 0]))
        zi_2 = lfiltic(b, a, xp.asarray([True, False]))
        self.assert_equal(zi, zi_1)

        check_dtype_arg = {} if self.dtype == object else {'check_dtype': False}
        self.assert_equal(zi, zi_2, **check_dtype_arg)

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_short_x_FIR(self, xp):
        # regression test for #5116
        # x shorter than b, with non None zi fails
        a = self.convert_dtype([1], xp)
        b = self.convert_dtype([1, 0, -1], xp)
        zi = self.convert_dtype([2, 7], xp)
        x = self.convert_dtype([72], xp)
        ye = self.convert_dtype([74], xp)
        zfe = self.convert_dtype([7, -72], xp)
        y, zf = lfilter(b, a, x, zi=zi)
        self.assert_array_almost_equal(y, ye)
        self.assert_array_almost_equal(zf, zfe)

    @skip_xp_backends('cupy', reason='XXX https://github.com/cupy/cupy/pull/8677')
    def test_short_x_IIR(self, xp):
        # regression test for #5116
        # x shorter than b, with non None zi fails
        a = self.convert_dtype([1, 1], xp)
        b = self.convert_dtype([1, 0, -1], xp)
        zi = self.convert_dtype([2, 7], xp)
        x = self.convert_dtype([72], xp)
        ye = self.convert_dtype([74], xp)
        zfe = self.convert_dtype([-67, -72], xp)
        y, zf = lfilter(b, a, x, zi=zi)
        self.assert_array_almost_equal(y, ye)
        self.assert_array_almost_equal(zf, zfe)

    def test_do_not_modify_a_b_IIR(self, xp):
        x = self.generate((6,), xp)
        b = self.convert_dtype([1, -1], xp)
        b0 = xp_copy(b, xp=xp)
        a = self.convert_dtype([0.5, -0.5], xp)
        a0 = xp_copy(a, xp=xp)
        y_r = self.convert_dtype([0, 2, 4, 6, 8, 10.], xp)
        y_f = lfilter(b, a, x)
        self.assert_array_almost_equal(y_f, y_r)
        self.assert_equal(b, b0)
        self.assert_equal(a, a0)

    def test_do_not_modify_a_b_FIR(self, xp):
        x = self.generate((6,), xp)
        b = self.convert_dtype([1, 0, 1], xp)
        b0 = xp_copy(b, xp=xp)
        a = self.convert_dtype([2], xp)
        a0 = xp_copy(a, xp=xp)
        y_r = self.convert_dtype([0, 0.5, 1, 2, 3, 4.], xp)
        y_f = lfilter(b, a, x)
        self.assert_array_almost_equal(y_f, y_r)
        self.assert_equal(b, b0)
        self.assert_equal(a, a0)

    @skip_xp_backends(np_only=True)
    @pytest.mark.parametrize("a", [1.0, [1.0], np.array(1.0)])
    @pytest.mark.parametrize("b", [1.0, [1.0], np.array(1.0)])
    def test_scalar_input(self, a, b, xp):
        data = np.random.randn(10)
        data = xp.asarray(data)
        self.assert_close(
            lfilter(xp.asarray([1.0]), xp.asarray([1.0]), data),
            lfilter(b, a, data)
        )

    @skip_xp_backends(np_only=True)
    @pytest.mark.thread_unsafe
    def test_dtype_deprecation(self, xp):
        # gh-21211
        a = np.asarray([1, 2, 3, 6, 5, 3], dtype=object)
        b = np.asarray([2, 3, 4, 5, 3, 4, 2, 2, 1], dtype=object)
        with pytest.deprecated_call(match="dtype=object is not supported"):
            lfilter(a, b, [1, 2, 3, 4])


class TestLinearFilterFloat32(_TestLinearFilter):
    dtype = 'float32'


class TestLinearFilterFloat64(_TestLinearFilter):
    dtype = 'float64'


@pytest.mark.filterwarnings('ignore::DeprecationWarning')
@skip_xp_backends(np_only=True)
class TestLinearFilterFloatExtended(_TestLinearFilter):
    dtype = np.dtype('g')


class TestLinearFilterComplex64(_TestLinearFilter):
    dtype = 'complex64'


class TestLinearFilterComplex128(_TestLinearFilter):
    dtype = 'complex128'


@pytest.mark.filterwarnings('ignore::DeprecationWarning')
@skip_xp_backends(np_only=True)
class TestLinearFilterComplexExtended(_TestLinearFilter):
    dtype = np.dtype('G')


@pytest.mark.filterwarnings('ignore::DeprecationWarning')
@skip_xp_backends(np_only=True, reason="object arrays")
class TestLinearFilterDecimal(_TestLinearFilter):
    dtype = np.dtype('O')

    def type(self, x):
        return Decimal(str(x))


@pytest.mark.filterwarnings('ignore::DeprecationWarning')
@skip_xp_backends(np_only=True, reason="object arrays")
class TestLinearFilterObject(_TestLinearFilter):
    dtype = np.dtype('O')
    type = float


@pytest.mark.filterwarnings('ignore::DeprecationWarning')
@skip_xp_backends(np_only=True)
def test_lfilter_bad_object(xp):
    # lfilter: object arrays with non-numeric objects raise TypeError.
    # Regression test for ticket #1452.
    if hasattr(sys, 'abiflags') and 'd' in sys.abiflags:
        pytest.skip('test is flaky when run with python3-dbg')
    assert_raises(TypeError, lfilter, [1.0], [1.0], [1.0, None, 2.0])
    assert_raises(TypeError, lfilter, [1.0], [None], [1.0, 2.0, 3.0])
    assert_raises(TypeError, lfilter, [None], [1.0], [1.0, 2.0, 3.0])


@skip_xp_backends(np_only=True)
def test_lfilter_notimplemented_input(xp):
    # Should not crash, gh-7991
    assert_raises(NotImplementedError, lfilter, [2,3], [4,5], [1,2,3,4,5])


class _TestCorrelateReal:

    def _get_assertion(self, dt):
        """Use np.testing while object arrays are a thing."""
        if dt == Decimal:
            return np.testing.assert_array_almost_equal
        else:
            return assert_array_almost_equal

    def _setup_rank1(self, dt, xp):
        a = xp.linspace(0, 3, 4, dtype=dt)
        b = xp.linspace(1, 2, 2, dtype=dt)

        y_r = xp.asarray([0, 2, 5, 8, 3], dtype=dt)
        return a, b, y_r

    def equal_tolerance(self, res_dt):
        # default value of keyword
        decimal = 6
        try:
            dt_info = np.finfo(res_dt)
            if hasattr(dt_info, 'resolution'):
                decimal = int(-0.5*np.log10(dt_info.resolution))
        except Exception:
            pass
        return decimal

    def equal_tolerance_fft(self, res_dt):
        # FFT implementations convert longdouble arguments down to
        # double so don't expect better precision, see gh-9520
        if res_dt == np.longdouble:
            return self.equal_tolerance(np.float64)
        else:
            return self.equal_tolerance(res_dt)

    @skip_xp_backends(np_only=True, reason="order='F'")
    def test_method(self, dt, xp):
        if dt == Decimal:
            method = choose_conv_method([Decimal(4)], [Decimal(3)])
            assert method == 'direct'
        else:
            dt = getattr(xp, dt)

            a, b, y_r = self._setup_rank3(dt, xp)
            y_fft = correlate(a, b, method='fft')
            y_direct = correlate(a, b, method='direct')

            assert_array_almost_equal(y_r,
                                      y_fft,
                                      decimal=self.equal_tolerance_fft(y_fft.dtype),)
            assert_array_almost_equal(y_r,
                                      y_direct,
                                      decimal=self.equal_tolerance(y_direct.dtype),)
            assert y_fft.dtype == dt
            assert y_direct.dtype == dt

    def test_rank1_valid(self, dt, xp):
        if is_torch(xp) and dt in ["uint16", "uint32", "uint64"]:
           pytest.skip("torch does not support unsigned ints")

        dt = getattr(xp, dt) if isinstance(dt, str) else dt
        _assert_almost_equal = self._get_assertion(dt)
        a, b, y_r = self._setup_rank1(dt, xp)
        y = correlate(a, b, 'valid')
        _assert_almost_equal(y, y_r[1:4])
        assert y.dtype == dt

        # See gh-5897
        y = correlate(b, a, 'valid')
        if  y_r.dtype != object:
            _assert_almost_equal(y, xp.flip(y_r[1:4]))
        else:
            _assert_almost_equal(y, y_r[1:4][::-1])
        assert y.dtype == dt

    def test_rank1_same(self, dt, xp):
        if is_torch(xp) and dt in ["uint16", "uint32", "uint64"]:
           pytest.skip("torch does not support unsigned ints")

        dt = getattr(xp, dt) if isinstance(dt, str) else dt

        a, b, y_r = self._setup_rank1(dt, xp)
        y = correlate(a, b, 'same')
        _assert_almost_equal = self._get_assertion(dt)
        _assert_almost_equal(y, y_r[:-1])
        assert y.dtype == dt

    def test_rank1_full(self, dt, xp):
        if is_torch(xp) and dt in ["uint16", "uint32", "uint64"]:
           pytest.skip("torch does not support unsigned ints")

        dt = getattr(xp, dt) if isinstance(dt, str) else dt

        a, b, y_r = self._setup_rank1(dt, xp)
        y = correlate(a, b, 'full')
        _assert_almost_equal = self._get_assertion(dt)
        _assert_almost_equal(y, y_r)
        assert y.dtype == dt

    def _setup_rank3(self, dt, xp):
        a = np.linspace(0, 39, 40).reshape((2, 4, 5), order='F').astype(
            dt)
        b = np.linspace(0, 23, 24).reshape((2, 3, 4), order='F').astype(
            dt)

        y_r = np.array([[[0., 184., 504., 912., 1360., 888., 472., 160.],
                      [46., 432., 1062., 1840., 2672., 1698., 864., 266.],
                      [134., 736., 1662., 2768., 3920., 2418., 1168., 314.],
                      [260., 952., 1932., 3056., 4208., 2580., 1240., 332.],
                      [202., 664., 1290., 1984., 2688., 1590., 712., 150.],
                      [114., 344., 642., 960., 1280., 726., 296., 38.]],

                     [[23., 400., 1035., 1832., 2696., 1737., 904., 293.],
                      [134., 920., 2166., 3680., 5280., 3306., 1640., 474.],
                      [325., 1544., 3369., 5512., 7720., 4683., 2192., 535.],
                      [571., 1964., 3891., 6064., 8272., 4989., 2324., 565.],
                      [434., 1360., 2586., 3920., 5264., 3054., 1312., 230.],
                      [241., 700., 1281., 1888., 2496., 1383., 532., 39.]],

                     [[22., 214., 528., 916., 1332., 846., 430., 132.],
                      [86., 484., 1098., 1832., 2600., 1602., 772., 206.],
                      [188., 802., 1698., 2732., 3788., 2256., 1018., 218.],
                      [308., 1006., 1950., 2996., 4052., 2400., 1078., 230.],
                      [230., 692., 1290., 1928., 2568., 1458., 596., 78.],
                      [126., 354., 636., 924., 1212., 654., 234., 0.]]],
                    dtype=np.float64).astype(dt)

        return a, b, y_r

    @skip_xp_backends(np_only=True, reason="order='F'")
    def test_rank3_valid(self, dt, xp):
        dt = getattr(xp, dt) if isinstance(dt, str) else dt
        a, b, y_r = self._setup_rank3(dt, xp)
        y = correlate(a, b, "valid")
        _assert_almost_equal = self._get_assertion(dt)
        _assert_almost_equal(y, y_r[1:2, 2:4, 3:5])
        assert y.dtype == dt

        # See gh-5897
        y = correlate(b, a, "valid")
        _assert_almost_equal = self._get_assertion(dt)
        _assert_almost_equal(y, y_r[1:2, 2:4, 3:5][::-1, ::-1, ::-1])
        assert y.dtype == dt

    @skip_xp_backends(np_only=True, reason="order='F'")
    def test_rank3_same(self, dt, xp):
        dt = getattr(xp, dt) if isinstance(dt, str) else dt
        a, b, y_r = self._setup_rank3(dt, xp)
        y = correlate(a, b, "same")
        _assert_almost_equal = self._get_assertion(dt)
        _assert_almost_equal(y, y_r[0:-1, 1:-1, 1:-2])
        assert y.dtype == dt

    @skip_xp_backends(np_only=True, reason="order='F'")
    def test_rank3_all(self, dt, xp):
        dt = getattr(xp, dt) if isinstance(dt, str) else dt
        a, b, y_r = self._setup_rank3(dt, xp)
        y = correlate(a, b)
        _assert_almost_equal = self._get_assertion(dt)
        _assert_almost_equal(y, y_r)
        assert y.dtype == dt


@pytest.mark.parametrize('dt', ["uint8", "int8", "uint16", "int16",
                                "uint32", "int32",
                                "uint64", "int64",
                                "float32", "float64",
                               ])
@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
@skip_xp_backends("jax.numpy", reason="fails all around")
class TestCorrelateReal(_TestCorrelateReal):
    pass


@pytest.mark.filterwarnings('ignore::DeprecationWarning')
@skip_xp_backends(np_only=True, reason="object arrays")
@pytest.mark.parametrize('dt', [Decimal])
class TestCorrelateRealDecimal(_TestCorrelateReal):
    pass


class TestCorrelate:
    # Tests that don't depend on dtype

    @skip_xp_backends(np_only=True)
    def test_invalid_shapes(self, xp):
        # By "invalid," we mean that no one
        # array has dimensions that are all at
        # least as large as the corresponding
        # dimensions of the other array. This
        # setup should throw a ValueError.
        a = np.arange(1, 7).reshape((2, 3))
        b = np.arange(-6, 0).reshape((3, 2))

        assert_raises(ValueError, correlate, *(a, b), **{'mode': 'valid'})
        assert_raises(ValueError, correlate, *(b, a), **{'mode': 'valid'})

    @skip_xp_backends(np_only=True)
    def test_invalid_params(self, xp):
        a = [3, 4, 5]
        b = [1, 2, 3]
        assert_raises(ValueError, correlate, a, b, mode='spam')
        assert_raises(ValueError, correlate, a, b, mode='eggs', method='fft')
        assert_raises(ValueError, correlate, a, b, mode='ham', method='direct')
        assert_raises(ValueError, correlate, a, b, mode='full', method='bacon')
        assert_raises(ValueError, correlate, a, b, mode='same', method='bacon')

    @skip_xp_backends(np_only=True)
    def test_mismatched_dims(self, xp):
        # Input arrays should have the same number of dimensions
        assert_raises(ValueError, correlate, [1], 2, method='direct')
        assert_raises(ValueError, correlate, 1, [2], method='direct')
        assert_raises(ValueError, correlate, [1], 2, method='fft')
        assert_raises(ValueError, correlate, 1, [2], method='fft')
        assert_raises(ValueError, correlate, [1], [[2]])
        assert_raises(ValueError, correlate, [3], 2)

    @skip_xp_backends(cpu_only=True, exceptions=['cupy'])
    @skip_xp_backends("jax.numpy", reason="dtype differs")
    def test_numpy_fastpath(self, xp):
        a = xp.asarray([1, 2, 3])
        b = xp.asarray([4, 5])
        xp_assert_close(correlate(a, b, mode='same'), xp.asarray([5, 14, 23]))

        a = xp.asarray([1, 2, 3])
        b = xp.asarray([4, 5, 6])
        xp_assert_close(correlate(a, b, mode='same'), xp.asarray([17, 32, 23]))
        xp_assert_close(correlate(a, b, mode='full'), xp.asarray([6, 17, 32, 23, 12]))
        xp_assert_close(correlate(a, b, mode='valid'), xp.asarray([32]))

    @pytest.mark.thread_unsafe
    @skip_xp_backends(np_only=True)
    def test_dtype_deprecation(self, xp):
        # gh-21211
        a = np.asarray([1, 2, 3, 6, 5, 3], dtype=object)
        b = np.asarray([2, 3, 4, 5, 3, 4, 2, 2, 1], dtype=object)
        with pytest.deprecated_call(match="dtype=object is not supported"):
            correlate(a, b)


@skip_xp_backends(np_only=True, reason="accepts ints, return numpy array")
@pytest.mark.parametrize("mode", ["valid", "same", "full"])
@pytest.mark.parametrize("behind", [True, False])
@pytest.mark.parametrize("input_size", [100, 101, 1000, 1001,
                                        pytest.param(10000, marks=[pytest.mark.slow]),
                                        pytest.param(10001, marks=[pytest.mark.slow])]
)
def test_correlation_lags(mode, behind, input_size, xp):
    # generate random data
    rng = np.random.RandomState(0)
    in1 = rng.standard_normal(input_size)
    offset = int(input_size/10)
    # generate offset version of array to correlate with
    if behind:
        # y is behind x
        in2 = np.concatenate([rng.standard_normal(offset), in1])
        expected = -offset
    else:
        # y is ahead of x
        in2 = in1[offset:]
        expected = offset
    # cross correlate, returning lag information
    correlation = correlate(in1, in2, mode=mode)
    lags = correlation_lags(in1.size, in2.size, mode=mode)
    # identify the peak
    lag_index = np.argmax(correlation)
    # Check as expected
    xp_assert_equal(lags[lag_index], expected)
    # Correlation and lags shape should match
    assert lags.shape == correlation.shape


@skip_xp_backends(np_only=True)
def test_correlation_lags_invalid_mode(xp):
    with pytest.raises(ValueError, match="Mode asdfgh is invalid"):
        correlation_lags(100, 100, mode="asdfgh")


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
@pytest.mark.parametrize('dt_name', ['complex64', 'complex128'])
class TestCorrelateComplex:
    # The decimal precision to be used for comparing results.
    # This value will be passed as the 'decimal' keyword argument of
    # assert_array_almost_equal().
    # Since correlate may chose to use FFT method which converts
    # longdoubles to doubles internally don't expect better precision
    # for longdouble than for double (see gh-9520).

    def decimal(self, dt, xp):
        if is_numpy(xp) and dt == np.clongdouble:
            dt = np.cdouble

        # emulate np.finfo(dt).precision for complex64 and complex128
        prec = {64: 15, 32: 6}[xp.finfo(dt).bits]
        return int(2 * prec / 3)

    def _setup_rank1(self, dt, mode, xp):
        np.random.seed(9)
        a = np.random.randn(10).astype(dt)
        a += 1j * np.random.randn(10).astype(dt)
        b = np.random.randn(8).astype(dt)
        b += 1j * np.random.randn(8).astype(dt)

        y_r = (correlate(a.real, b.real, mode=mode) +
               correlate(a.imag, b.imag, mode=mode)).astype(dt)
        y_r += 1j * (-correlate(a.real, b.imag, mode=mode) +
                     correlate(a.imag, b.real, mode=mode))

        a, b, y_r = xp.asarray(a), xp.asarray(b), xp.asarray(y_r)
        return a, b, y_r

    def test_rank1_valid(self, dt_name, xp):
        a, b, y_r = self._setup_rank1(dt_name, 'valid', xp)
        dt = getattr(xp, dt_name)
        y = correlate(a, b, 'valid')
        assert_array_almost_equal(y, y_r, decimal=self.decimal(dt, xp))
        assert y.dtype == dt

        # See gh-5897
        y = correlate(b, a, 'valid')
        assert_array_almost_equal(y, xp.conj(xp.flip(y_r)),
                                  decimal=self.decimal(dt, xp))
        assert y.dtype == dt

    def test_rank1_same(self, dt_name, xp):
        a, b, y_r = self._setup_rank1(dt_name, 'same', xp)
        dt = getattr(xp, dt_name)

        y = correlate(a, b, 'same')
        assert_array_almost_equal(y, y_r, decimal=self.decimal(dt, xp))
        assert y.dtype == dt

    def test_rank1_full(self, dt_name, xp):
        a, b, y_r = self._setup_rank1(dt_name, 'full', xp)
        dt = getattr(xp, dt_name)
        y = correlate(a, b, 'full')
        assert_array_almost_equal(y, y_r, decimal=self.decimal(dt, xp))
        assert y.dtype == dt

    def test_swap_full(self, dt_name, xp):
        dt = getattr(xp, dt_name)
        d = xp.asarray([0.+0.j, 1.+1.j, 2.+2.j], dtype=dt)
        k = xp.asarray([1.+3.j, 2.+4.j, 3.+5.j, 4.+6.j], dtype=dt)
        y = correlate(d, k)
        xp_assert_close(
            y, xp.asarray([0.+0.j, 10.-2.j, 28.-6.j, 22.-6.j, 16.-6.j, 8.-4.j]),
            atol=1e-6, check_dtype=False
        )

    def test_swap_same(self, dt_name, xp):
        d = xp.asarray([0.+0.j, 1.+1.j, 2.+2.j])
        k = xp.asarray([1.+3.j, 2.+4.j, 3.+5.j, 4.+6.j])
        y = correlate(d, k, mode="same")
        xp_assert_close(y, xp.asarray([10.-2.j, 28.-6.j, 22.-6.j]))

    @skip_xp_backends("cupy", reason="notimplementederror")
    def test_rank3(self, dt_name, xp):
        a = np.random.randn(10, 8, 6).astype(dt_name)
        a += 1j * np.random.randn(10, 8, 6).astype(dt_name)
        b = np.random.randn(8, 6, 4).astype(dt_name)
        b += 1j * np.random.randn(8, 6, 4).astype(dt_name)

        y_r = (correlate(a.real, b.real)
               + correlate(a.imag, b.imag)).astype(dt_name)
        y_r += 1j * (-correlate(a.real, b.imag) + correlate(a.imag, b.real))

        a, b, y_r = xp.asarray(a), xp.asarray(b), xp.asarray(y_r)
        dt = getattr(xp, dt_name)

        y = correlate(a, b, 'full')
        assert_array_almost_equal(y, y_r, decimal=self.decimal(dt, xp) - 1)
        assert y.dtype == dt

    @skip_xp_backends(np_only=True)  # XXX: check 0D/scalars on backends.
    def test_rank0(self, dt_name, xp):
        a = np.array(np.random.randn()).astype(dt_name)
        a += 1j * np.array(np.random.randn()).astype(dt_name)
        b = np.array(np.random.randn()).astype(dt_name)
        b += 1j * np.array(np.random.randn()).astype(dt_name)
        dt = getattr(xp, dt_name)

        y_r = (correlate(a.real, b.real)
               + correlate(a.imag, b.imag)).astype(dt)
        y_r += 1j * np.array(-correlate(a.real, b.imag) +
                             correlate(a.imag, b.real))

        a, b = xp.asarray(a), xp.asarray(b)

        y = correlate(a, b, 'full')
        assert_array_almost_equal(y, y_r, decimal=self.decimal(dt, xp) - 1)
        assert y.dtype == dt

        xp_assert_equal(correlate([1], [2j]), np.asarray(correlate(1, 2j)),
                        check_shape=False)
        xp_assert_equal(correlate([2j], [3j]), np.asarray(correlate(2j, 3j)),
                        check_shape=False)
        xp_assert_equal(correlate([3j], [4]), np.asarray(correlate(3j, 4)),
                        check_shape=False)


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestCorrelate2d:

    def test_consistency_correlate_funcs(self, xp):
        # Compare np.correlate, signal.correlate, signal.correlate2d
        a = np.arange(5)
        b = np.array([3.2, 1.4, 3])
        for mode in ['full', 'valid', 'same']:
            a_xp, b_xp = xp.asarray(a), xp.asarray(b)
            np_corr_result = np.correlate(a, b, mode=mode)
            assert_almost_equal(signal.correlate(a_xp, b_xp, mode=mode),
                                xp.asarray(np_corr_result))

            # See gh-5897
            if mode == 'valid':
                np_corr_result = np.correlate(b, a, mode=mode)
                assert_almost_equal(signal.correlate(b_xp, a_xp, mode=mode),
                                    xp.asarray(np_corr_result))

    @skip_xp_backends(np_only=True)  # XXX
    def test_consistency_correlate_funcs_2(self, xp):
        # Compare np.correlate, signal.correlate, signal.correlate2d
        a = np.arange(5)
        b = np.array([3.2, 1.4, 3])
        for mode in ['full', 'valid', 'same']:
            assert_almost_equal(np.squeeze(signal.correlate2d([a], [b],
                                                              mode=mode)),
                                signal.correlate(a, b, mode=mode))

            # See gh-5897
            if mode == 'valid':
                assert_almost_equal(np.squeeze(signal.correlate2d([b], [a],
                                                                  mode=mode)),
                                    signal.correlate(b, a, mode=mode))


    @skip_xp_backends(np_only=True)
    def test_invalid_shapes(self, xp):
        # By "invalid," we mean that no one
        # array has dimensions that are all at
        # least as large as the corresponding
        # dimensions of the other array. This
        # setup should throw a ValueError.
        a = np.arange(1, 7).reshape((2, 3))
        b = np.arange(-6, 0).reshape((3, 2))

        assert_raises(ValueError, signal.correlate2d, *(a, b), **{'mode': 'valid'})
        assert_raises(ValueError, signal.correlate2d, *(b, a), **{'mode': 'valid'})

    def test_complex_input(self, xp):
        xp_assert_equal(signal.correlate2d(xp.asarray([[1]]), xp.asarray([[2j]])),
                        xp.asarray([-2j]), check_shape=False, check_dtype=False)
        xp_assert_equal(signal.correlate2d(xp.asarray([[2j]]), xp.asarray([[3j]])),
                        xp.asarray([6+0j]), check_shape=False, check_dtype=False)
        xp_assert_equal(signal.correlate2d(xp.asarray([[3j]]), xp.asarray([[4]])),
                        xp.asarray([12j]), check_shape=False, check_dtype=False)


@skip_xp_backends(cpu_only=True)
@skip_xp_backends('cupy', reason='lfilter_zi is incompatible')
class TestLFilterZI:

    @skip_xp_backends(np_only=True, reason='list inputs are numpy specific')
    def test_array_like(self, xp):
        zi_expected = xp.asarray([5.0, -1.0])
        zi = lfilter_zi([1.0, 0.0, 2.0], [1.0, -1.0, 0.5])
        assert_array_almost_equal(zi, zi_expected)

    def test_basic(self, xp):
        a = xp.asarray([1.0, -1.0, 0.5])
        b = xp.asarray([1.0, 0.0, 2.0])
        zi_expected = xp.asarray([5.0, -1.0])
        zi = lfilter_zi(b, a)
        assert_array_almost_equal(zi, zi_expected)

    def test_scale_invariance(self, xp):
        # Regression test.  There was a bug in which b was not correctly
        # rescaled when a[0] was nonzero.
        b = xp.asarray([2.0, 8, 5])
        a = xp.asarray([1.0, 1, 8])
        zi1 = lfilter_zi(b, a)
        zi2 = lfilter_zi(2*b, 2*a)
        xp_assert_close(zi2, zi1, rtol=1e-12)

    @pytest.mark.parametrize('dtype', ['float32', 'float64'])
    def test_types(self, dtype, xp):
        dtype = getattr(xp, dtype)
        b = xp.zeros((8), dtype=dtype)
        a = xp.asarray([1], dtype=dtype)
        assert signal.lfilter_zi(b, a).dtype == dtype


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestFiltFilt:
    filtfilt_kind = 'tf'

    def filtfilt(self, zpk, x, axis=-1, padtype='odd', padlen=None,
                 method='pad', irlen=None, xp=None):
        if self.filtfilt_kind == 'tf':
            b, a = zpk2tf(*zpk)
            b, a = xp.asarray(b), xp.asarray(a)
            return filtfilt(b, a, x, axis, padtype, padlen, method, irlen)
        elif self.filtfilt_kind == 'sos':
            sos = zpk2sos(*zpk)
            sos = xp.asarray(sos)
            return sosfiltfilt(sos, x, axis, padtype, padlen)

    @skip_xp_backends('torch', reason='negative strides')
    def test_basic(self, xp):
        if is_jax(xp) and self.filtfilt_kind == 'sos':
            pytest.skip(reason='sosfilt works in-place')

        zpk = tf2zpk([1, 2, 3], [1, 2, 3])
        out = self.filtfilt(zpk, xp.arange(12), xp=xp)
        atol= 3e-9 if is_cupy(xp) else 5.28e-11
        xp_assert_close(out, xp.arange(12, dtype=xp.float64), atol=atol)

    @skip_xp_backends('torch', reason='negative strides')
    def test_sine(self, xp):
        if is_jax(xp) and self.filtfilt_kind == 'sos':
            pytest.skip(reason='sosfilt works in-place')

        rate = 2000
        t = xp.linspace(0, 1.0, rate + 1)
        # A signal with low frequency and a high frequency.
        xlow = xp.sin(5 * 2 * np.pi * t)
        xhigh = xp.sin(250 * 2 * np.pi * t)
        x = xlow + xhigh

        zpk = butter(8, 0.125, output='zpk')
        # r is the magnitude of the largest pole.
        r = np.abs(zpk[1]).max()
        eps = 1e-5
        # n estimates the number of steps for the
        # transient to decay by a factor of eps.
        n = int(np.ceil(np.log(eps) / np.log(r)))

        # High order lowpass filter...
        y = self.filtfilt(zpk, x, padlen=n, xp=xp)
        # Result should be just xlow.
        err = np.abs(y - xlow).max()
        assert err < 1e-4

        # A 2D case.
        x2d = xp.asarray(np.vstack([xlow, xlow + xhigh]))
        y2d = self.filtfilt(zpk, x2d, padlen=n, axis=1, xp=xp)
        assert y2d.shape == x2d.shape
        err = np.abs(y2d - xlow).max()
        assert err < 1e-4

        # Use the previous result to check the use of the axis keyword.
        # (Regression test for ticket #1620)
        y2dt = self.filtfilt(zpk, x2d.T, padlen=n, axis=0, xp=xp)
        xp_assert_equal(y2d, y2dt.T)

    @skip_xp_backends('torch', reason='negative strides')
    def test_axis(self, xp):
        if is_jax(xp) and self.filtfilt_kind == 'sos':
            pytest.skip(reason='sosfilt works in-place')

        # Test the 'axis' keyword on a 3D array.
        x = np.arange(10.0 * 11.0 * 12.0).reshape(10, 11, 12)
        x = xp.asarray(x)
        zpk = butter(3, 0.125, output='zpk')
        y0 = self.filtfilt(zpk, x, padlen=0, axis=0, xp=xp)
        y1 = self.filtfilt(
            zpk, xp.asarray(np.swapaxes(x, 0, 1)), padlen=0, axis=1, xp=xp
        )
        xp_assert_equal(y0, xp.asarray(np.swapaxes(y1, 0, 1)))
        y2 = self.filtfilt(
            zpk, xp.asarray(np.swapaxes(x, 0, 2)), padlen=0, axis=2, xp=xp
        )
        xp_assert_equal(y0, xp.asarray(np.swapaxes(y2, 0, 2)))

    @skip_xp_backends(np_only=True,
                      reason='python scalars in array_namespace are np-only')
    def test_acoeff(self, xp):
        if self.filtfilt_kind != 'tf':
            return  # only necessary for TF
        # test for 'a' coefficient as single number
        out = signal.filtfilt(
            xp.asarray([.5, .5]), 1, xp.arange(10, dtype=xp.float64)
        )
        xp_assert_close(out, xp.arange(10, dtype=xp.float64), rtol=1e-14, atol=1e-14)

    @skip_xp_backends(np_only=True, reason='_filtfilt_gust is np-only')
    def test_gust_simple(self, xp):
        if self.filtfilt_kind != 'tf':
            pytest.skip('gust only implemented for TF systems')
        # The input array has length 2.  The exact solution for this case
        # was computed "by hand".
        x = xp.asarray([1.0, 2.0])
        b = xp.asarray([0.5])
        a = xp.asarray([1.0, -0.5])
        y, z1, z2 = _filtfilt_gust(b, a, x)
        xp_assert_close(z1[0], 0.3*x[0] + 0.2*x[1])
        xp_assert_close(z2[0], 0.2*x[0] + 0.3*x[1])
        xp_assert_close(y,
                        xp.asarray([z1[0] + 0.25*z2[0] + 0.25*x[0] + 0.125*x[1],
                                    0.25*z1[0] + z2[0] + 0.125*x[0] + 0.25*x[1]])
        )

    @skip_xp_backends(np_only=True,
                      reason='python scalars in array_namespace are np-only')
    def test_gust_scalars(self, xp):
        if self.filtfilt_kind != 'tf':
            pytest.skip('gust only implemented for TF systems')
        # The filter coefficients are both scalars, so the filter simply
        # multiplies its input by b/a.  When it is used in filtfilt, the
        # factor is (b/a)**2.
        x = xp.arange(12)
        b = 3.0
        a = 2.0
        y = filtfilt(b, a, x, method="gust")
        expected = (b/a)**2 * x
        xp_assert_close(y, expected)


@skip_xp_backends(
    "dask.array", reason=(
        "sosfiltfilt directly sets shape attributes on arrays "
        "which dask doesn't like"
    )
)
@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestSOSFiltFilt(TestFiltFilt):
    filtfilt_kind = 'sos'

    @skip_xp_backends('jax.numpy', reason='sosfilt works in-place')
    @skip_xp_backends('torch', reason='negative strides')
    def test_equivalence(self, xp):
        """Test equivalence between sosfiltfilt and filtfilt"""
        x = np.random.RandomState(0).randn(1000)
        x = xp.asarray(x)
        for order in range(1, 6):
            zpk = signal.butter(order, 0.35, output='zpk')
            b, a = zpk2tf(*zpk)
            sos = zpk2sos(*zpk)

            b, a, sos = map(xp.asarray, (b, a, sos))
            y = filtfilt(b, a, x)
            y_sos = sosfiltfilt(sos, x)
            xp_assert_close(y, y_sos, atol=1e-12, err_msg=f'order={order}')


def filtfilt_gust_opt(b, a, x):
    """
    An alternative implementation of filtfilt with Gustafsson edges.

    This function computes the same result as
    `scipy.signal._signaltools._filtfilt_gust`, but only 1-d arrays
    are accepted.  The problem is solved using `fmin` from `scipy.optimize`.
    `_filtfilt_gust` is significantly faster than this implementation.
    """
    def filtfilt_gust_opt_func(ics, b, a, x):
        """Objective function used in filtfilt_gust_opt."""
        m = max(len(a), len(b)) - 1
        z0f = ics[:m]
        z0b = ics[m:]
        y_f = lfilter(b, a, x, zi=z0f)[0]
        y_fb = lfilter(b, a, y_f[::-1], zi=z0b)[0][::-1]

        y_b = lfilter(b, a, x[::-1], zi=z0b)[0][::-1]
        y_bf = lfilter(b, a, y_b, zi=z0f)[0]
        value = np.sum((y_fb - y_bf)**2)
        return value

    m = max(len(a), len(b)) - 1
    zi = lfilter_zi(b, a)
    ics = np.concatenate((x[:m].mean()*zi, x[-m:].mean()*zi))
    result = fmin(filtfilt_gust_opt_func, ics, args=(b, a, x),
                  xtol=1e-10, ftol=1e-12,
                  maxfun=10000, maxiter=10000,
                  full_output=True, disp=False)
    opt, fopt, niter, funcalls, warnflag = result
    if warnflag > 0:
        raise RuntimeError(
            f"minimization failed in filtfilt_gust_opt: warnflag={warnflag}"
        )
    z0f = opt[:m]
    z0b = opt[m:]

    # Apply the forward-backward filter using the computed initial
    # conditions.
    y_b = lfilter(b, a, x[::-1], zi=z0b)[0][::-1]
    y = lfilter(b, a, y_b, zi=z0f)[0]

    return y, z0f, z0b


def check_filtfilt_gust(b, a, shape, axis, irlen=None):
    # Generate x, the data to be filtered.
    np.random.seed(123)
    x = np.random.randn(*shape)

    # Apply filtfilt to x. This is the main calculation to be checked.
    y = filtfilt(b, a, x, axis=axis, method="gust", irlen=irlen)

    # Also call the private function so we can test the ICs.
    yg, zg1, zg2 = _filtfilt_gust(b, a, x, axis=axis, irlen=irlen)

    # filtfilt_gust_opt is an independent implementation that gives the
    # expected result, but it only handles 1-D arrays, so use some looping
    # and reshaping shenanigans to create the expected output arrays.
    xx = np.swapaxes(x, axis, -1)
    out_shape = xx.shape[:-1]
    yo = np.empty_like(xx)
    m = max(len(a), len(b)) - 1
    zo1 = np.empty(out_shape + (m,))
    zo2 = np.empty(out_shape + (m,))
    for indx in product(*[range(d) for d in out_shape]):
        yo[indx], zo1[indx], zo2[indx] = filtfilt_gust_opt(b, a, xx[indx])
    yo = np.swapaxes(yo, -1, axis)
    zo1 = np.swapaxes(zo1, -1, axis)
    zo2 = np.swapaxes(zo2, -1, axis)

    xp_assert_close(y, yo, rtol=1e-8, atol=1e-9)
    xp_assert_close(yg, yo, rtol=1e-8, atol=1e-9)
    xp_assert_close(zg1, zo1, rtol=1e-8, atol=1e-9)
    xp_assert_close(zg2, zo2, rtol=1e-8, atol=1e-9)


@pytest.mark.filterwarnings('ignore::DeprecationWarning')
@skip_xp_backends(np_only=True)
@pytest.mark.fail_slow(10)
def test_choose_conv_method(xp):
    for mode in ['valid', 'same', 'full']:
        for ndim in [1, 2]:
            n, k, true_method = 8, 6, 'direct'
            x = np.random.randn(*((n,) * ndim))
            h = np.random.randn(*((k,) * ndim))

            method = choose_conv_method(x, h, mode=mode)
            assert method == true_method

            method_try, times = choose_conv_method(x, h, mode=mode, measure=True)
            assert method_try in {'fft', 'direct'}
            assert isinstance(times, dict)
            assert 'fft' in times.keys() and 'direct' in times.keys()

        n = 10
        for not_fft_conv_supp in ["complex256", "complex192"]:
            if hasattr(np, not_fft_conv_supp):
                x = np.ones(n, dtype=not_fft_conv_supp)
                h = x.copy()
                assert choose_conv_method(x, h, mode=mode) == 'direct'

        x = np.array([2**51], dtype=np.int64)
        h = x.copy()
        assert choose_conv_method(x, h, mode=mode) == 'direct'


@pytest.mark.thread_unsafe
@skip_xp_backends(np_only=True)
def test_choose_conv_dtype_deprecation(xp):
    # gh-21211
    a = np.asarray([1, 2, 3, 6, 5, 3], dtype=object)
    b = np.asarray([2, 3, 4, 5, 3, 4, 2, 2, 1], dtype=object)
    with pytest.deprecated_call(match="dtype=object is not supported"):
        choose_conv_method(a, b)


@skip_xp_backends(np_only=True)
@pytest.mark.filterwarnings('ignore::DeprecationWarning')
def test_choose_conv_method_2(xp):
    for mode in ['valid', 'same', 'full']:
        x = [Decimal(3), Decimal(2)]
        h = [Decimal(1), Decimal(4)]
        assert choose_conv_method(x, h, mode=mode) == 'direct'

        n = 10
        for not_fft_conv_supp in ["complex256", "complex192"]:
            if hasattr(np, not_fft_conv_supp):
                x = np.ones(n, dtype=not_fft_conv_supp)
                h = x.copy()
                assert choose_conv_method(x, h, mode=mode) == 'direct'


@skip_xp_backends(np_only=True)
@pytest.mark.fail_slow(10)
def test_filtfilt_gust(xp):
    # Design a filter.
    z, p, k = signal.ellip(3, 0.01, 120, 0.0875, output='zpk')

    # Find the approximate impulse response length of the filter.
    eps = 1e-10
    r = np.max(np.abs(p))
    approx_impulse_len = int(np.ceil(np.log(eps) / np.log(r)))

    np.random.seed(123)

    b, a = zpk2tf(z, p, k)
    for irlen in [None, approx_impulse_len]:
        signal_len = 5 * approx_impulse_len

        # 1-d test case
        check_filtfilt_gust(b, a, (signal_len,), 0, irlen)

        # 3-d test case; test each axis.
        for axis in range(3):
            shape = [2, 2, 2]
            shape[axis] = signal_len
            check_filtfilt_gust(b, a, shape, axis, irlen)

    # Test case with length less than 2*approx_impulse_len.
    # In this case, `filtfilt_gust` should behave the same as if
    # `irlen=None` was given.
    length = 2*approx_impulse_len - 50
    check_filtfilt_gust(b, a, (length,), 0, approx_impulse_len)


@skip_xp_backends(np_only=True)
class TestDecimate:
    def test_bad_args(self, xp):
        x = np.arange(12)
        assert_raises(TypeError, signal.decimate, x, q=0.5, n=1)
        assert_raises(TypeError, signal.decimate, x, q=2, n=0.5)

    def test_basic_IIR(self, xp):
        x = np.arange(12)
        y = signal.decimate(x, 2, n=1, ftype='iir', zero_phase=False).round()
        xp_assert_equal(y, x[::2].astype(float))

    def test_basic_FIR(self, xp):
        x = np.arange(12)
        y = signal.decimate(x, 2, n=1, ftype='fir', zero_phase=False).round()
        xp_assert_equal(y, x[::2].astype(float))

    def test_shape(self, xp):
        # Regression test for ticket #1480.
        z = np.zeros((30, 30))
        d0 = signal.decimate(z, 2, axis=0, zero_phase=False)
        assert d0.shape == (15, 30)
        d1 = signal.decimate(z, 2, axis=1, zero_phase=False)
        assert d1.shape == (30, 15)

    def test_phaseshift_FIR(self, xp):
        with suppress_warnings() as sup:
            sup.filter(BadCoefficients, "Badly conditioned filter")
            self._test_phaseshift(method='fir', zero_phase=False)

    def test_zero_phase_FIR(self, xp):
        with suppress_warnings() as sup:
            sup.filter(BadCoefficients, "Badly conditioned filter")
            self._test_phaseshift(method='fir', zero_phase=True)

    def test_phaseshift_IIR(self, xp):
        self._test_phaseshift(method='iir', zero_phase=False)

    def test_zero_phase_IIR(self, xp):
        self._test_phaseshift(method='iir', zero_phase=True)

    def _test_phaseshift(self, method, zero_phase):
        rate = 120
        rates_to = [15, 20, 30, 40]  # q = 8, 6, 4, 3

        t_tot = 100  # Need to let antialiasing filters settle
        t = np.arange(rate*t_tot+1) / float(rate)

        # Sinusoids at 0.8*nyquist, windowed to avoid edge artifacts
        freqs = np.array(rates_to) * 0.8 / 2
        d = (np.exp(1j * 2 * np.pi * freqs[:, np.newaxis] * t)
             * signal.windows.tukey(t.size, 0.1))

        for rate_to in rates_to:
            q = rate // rate_to
            t_to = np.arange(rate_to*t_tot+1) / float(rate_to)
            d_tos = (np.exp(1j * 2 * np.pi * freqs[:, np.newaxis] * t_to)
                     * signal.windows.tukey(t_to.size, 0.1))

            # Set up downsampling filters, match v0.17 defaults
            if method == 'fir':
                n = 30
                system = signal.dlti(signal.firwin(n + 1, 1. / q,
                                                   window='hamming'), 1.)
            elif method == 'iir':
                n = 8
                wc = 0.8*np.pi/q
                system = signal.dlti(*signal.cheby1(n, 0.05, wc/np.pi))

            # Calculate expected phase response, as unit complex vector
            if zero_phase is False:
                _, h_resps = signal.freqz(system.num, system.den,
                                          freqs/rate*2*np.pi)
                h_resps /= np.abs(h_resps)
            else:
                h_resps = np.ones_like(freqs)

            y_resamps = signal.decimate(d.real, q, n, ftype=system,
                                        zero_phase=zero_phase)

            # Get phase from complex inner product, like CSD
            h_resamps = np.sum(d_tos.conj() * y_resamps, axis=-1)
            h_resamps /= np.abs(h_resamps)
            subnyq = freqs < 0.5*rate_to

            # Complex vectors should be aligned, only compare below nyquist
            result = np.angle(h_resps.conj()*h_resamps)[subnyq]
            xp_assert_close(result, np.zeros_like(result),
                            atol=1e-3, rtol=1e-3)

    def test_auto_n(self, xp):
        # Test that our value of n is a reasonable choice (depends on
        # the downsampling factor)
        sfreq = 100.
        n = 1000
        t = np.arange(n) / sfreq
        # will alias for decimations (>= 15)
        x = np.sqrt(2. / n) * np.sin(2 * np.pi * (sfreq / 30.) * t)
        xp_assert_close(np.linalg.norm(x), 1., rtol=1e-3)
        x_out = signal.decimate(x, 30, ftype='fir')
        assert np.linalg.norm(x_out) < 0.01

    def test_long_float32(self, xp):
        # regression: gh-15072.  With 32-bit float and either lfilter
        # or filtfilt, this is numerically unstable
        x = signal.decimate(np.ones(10_000, dtype=np.float32), 10)
        assert not any(np.isnan(x))

    def test_float16_upcast(self, xp):
        # float16 must be upcast to float64
        x = signal.decimate(np.ones(100, dtype=np.float16), 10)
        assert x.dtype.type == np.float64

    def test_complex_iir_dlti(self, xp):
        # regression: gh-17845
        # centre frequency for filter [Hz]
        fcentre = 50
        # filter passband width [Hz]
        fwidth = 5
        # sample rate [Hz]
        fs = 1e3

        z, p, k = signal.butter(2, 2*np.pi*fwidth/2, output='zpk', fs=fs)
        z = z.astype(complex) * np.exp(2j * np.pi * fcentre/fs)
        p = p.astype(complex) * np.exp(2j * np.pi * fcentre/fs)
        system = signal.dlti(z, p, k)

        t = np.arange(200) / fs

        # input
        u = (np.exp(2j * np.pi * fcentre * t)
             + 0.5 * np.exp(-2j * np.pi * fcentre * t))

        ynzp = signal.decimate(u, 2, ftype=system, zero_phase=False)
        ynzpref = signal.lfilter(*signal.zpk2tf(z, p, k),
                                 u)[::2]

        xp_assert_equal(ynzp, ynzpref)

        yzp = signal.decimate(u, 2, ftype=system, zero_phase=True)
        yzpref = signal.filtfilt(*signal.zpk2tf(z, p, k),
                                 u)[::2]

        xp_assert_close(yzp, yzpref, rtol=1e-10, atol=1e-13)

    def test_complex_fir_dlti(self, xp):
        # centre frequency for filter [Hz]
        fcentre = 50
        # filter passband width [Hz]
        fwidth = 5
        # sample rate [Hz]
        fs = 1e3
        numtaps = 20

        # FIR filter about 0Hz
        bbase = signal.firwin(numtaps, fwidth/2, fs=fs)

        # rotate these to desired frequency
        zbase = np.roots(bbase)
        zrot = zbase * np.exp(2j * np.pi * fcentre/fs)
        # FIR filter about 50Hz, maintaining passband gain of 0dB
        bz = bbase[0] * np.poly(zrot)

        system = signal.dlti(bz, 1)

        t = np.arange(200) / fs

        # input
        u = (np.exp(2j * np.pi * fcentre * t)
             + 0.5 * np.exp(-2j * np.pi * fcentre * t))

        ynzp = signal.decimate(u, 2, ftype=system, zero_phase=False)
        ynzpref = signal.upfirdn(bz, u, up=1, down=2)[:100]

        xp_assert_equal(ynzp, ynzpref)

        yzp = signal.decimate(u, 2, ftype=system, zero_phase=True)
        yzpref = signal.resample_poly(u, 1, 2, window=bz)

        xp_assert_equal(yzp, yzpref)


@skip_xp_backends("jax.numpy",
   reason="jax arrays do not support item assignment")
class TestHilbert:

    def test_bad_args(self, xp):
        x = xp.asarray([1.0 + 0.0j])
        assert_raises(ValueError, hilbert, x)
        x = xp.arange(8.0)
        assert_raises(ValueError, hilbert, x, N=0)

    def test_hilbert_theoretical(self, xp):
        # test cases by Ariel Rokem
        decimal = 14

        pi = xp.pi
        t = xp.arange(0, 2 * pi, pi / 256, dtype=xp.float64)
        a0 = xp.sin(t)
        a1 = xp.cos(t)
        a2 = xp.sin(2 * t)
        a3 = xp.cos(2 * t)
        a = xp.stack([a0, a1, a2, a3])

        h = hilbert(a)
        h_abs = xp.abs(h)

        h_angle = xp.atan2(xp.imag(h), xp.real(h)) #  np.angle(h)
        h_real = xp.real(h)

        # The real part should be equal to the original signals:
        assert_almost_equal(h_real, a, decimal)
        # The absolute value should be one everywhere, for this input:
        assert_almost_equal(h_abs, xp.ones(a.shape), decimal)
        # For the 'slow' sine - the phase should go from -pi/2 to pi/2 in
        # the first 256 bins:
        assert_almost_equal(h_angle[0, :256],
                            xp.arange(-pi / 2, pi / 2, pi / 256, dtype=xp.float64),
                            decimal)
        # For the 'slow' cosine - the phase should go from 0 to pi in the
        # same interval:
        assert_almost_equal(
            h_angle[1, :256], xp.arange(0, pi, pi / 256, dtype=xp.float64), decimal)
        # The 'fast' sine should make this phase transition in half the time:
        assert_almost_equal(h_angle[2, :128],
                            xp.arange(-pi / 2, pi / 2, pi / 128, dtype=xp.float64),
                            decimal)
        # Ditto for the 'fast' cosine:
        assert_almost_equal(
            h_angle[3, :128], xp.arange(0, pi, pi / 128, dtype=xp.float64), decimal)

        # The imaginary part of hilbert(cos(t)) = sin(t) Wikipedia
        assert_almost_equal(xp.imag(h[1, :]), a0, decimal)

    def test_hilbert_axisN(self, xp):
        # tests for axis and N arguments
        a = xp.reshape(xp.arange(18, dtype=xp.float64), (3, 6))
        # test axis
        aa = hilbert(a, axis=-1)
        xp_assert_equal(hilbert(a.T, axis=0), aa.T)
        # test 1d
        assert_almost_equal(hilbert(a[0, :]), aa[0, :], 14)

        # test N
        aan = hilbert(a, N=20, axis=-1)
        assert aan.shape == (3, 20)
        assert hilbert(a.T, N=20, axis=0).shape == (20, 3)
        # the next test is just a regression test,
        # no idea whether numbers make sense
        a0hilb = np.array([0.000000000000000e+00 - 1.72015830311905j,
                           1.000000000000000e+00 - 2.047794505137069j,
                           1.999999999999999e+00 - 2.244055555687583j,
                           3.000000000000000e+00 - 1.262750302935009j,
                           4.000000000000000e+00 - 1.066489252384493j,
                           5.000000000000000e+00 + 2.918022706971047j,
                           8.881784197001253e-17 + 3.845658908989067j,
                          -9.444121133484362e-17 + 0.985044202202061j,
                          -1.776356839400251e-16 + 1.332257797702019j,
                          -3.996802888650564e-16 + 0.501905089898885j,
                           1.332267629550188e-16 + 0.668696078880782j,
                          -1.192678053963799e-16 + 0.235487067862679j,
                          -1.776356839400251e-16 + 0.286439612812121j,
                           3.108624468950438e-16 + 0.031676888064907j,
                           1.332267629550188e-16 - 0.019275656884536j,
                          -2.360035624836702e-16 - 0.1652588660287j,
                           0.000000000000000e+00 - 0.332049855010597j,
                           3.552713678800501e-16 - 0.403810179797771j,
                           8.881784197001253e-17 - 0.751023775297729j,
                           9.444121133484362e-17 - 0.79252210110103j])
        a0hilb = xp.asarray(a0hilb)
        assert_almost_equal(aan[0, :], a0hilb, 14, err_msg='N regression')

    @pytest.mark.parametrize('dtype', ['float32', 'float64'])
    def test_hilbert_types(self, dtype, xp):
        dtype = getattr(xp, dtype)
        in_typed = xp.zeros(8, dtype=dtype)
        assert xp.real(hilbert(in_typed)).dtype == dtype


@skip_xp_backends("jax.numpy",
   reason="jax arrays do not support item assignment")
class TestHilbert2:

    @skip_xp_backends(np_only=True, reason='list inputs are numpy-specific')
    def test_array_like(self, xp):
        hilbert2([[1, 2, 3], [4, 5, 6]])

    def test_bad_args(self, xp):
        # x must be real.
        x = xp.asarray([[1.0 + 0.0j]])
        assert_raises(ValueError, hilbert2, x)

        # x must be rank 2.
        x = xp.reshape(xp.arange(24), (2, 3, 4))
        assert_raises(ValueError, hilbert2, x)

        # Bad value for N.
        x = xp.reshape(xp.arange(16), (4, 4))
        assert_raises(ValueError, hilbert2, x, N=0)
        assert_raises(ValueError, hilbert2, x, N=(2, 0))
        assert_raises(ValueError, hilbert2, x, N=(2,))

    @pytest.mark.parametrize('dtype', ['float32', 'float64'])
    def test_hilbert2_types(self, dtype, xp):
        dtype = getattr(xp, dtype)
        in_typed = xp.zeros((2, 32), dtype=dtype)
        assert xp.real(signal.hilbert2(in_typed)).dtype == dtype


class TestEnvelope:
    """Unit tests for function `._signaltools.envelope()`. """

    @staticmethod
    def assert_close(actual, desired, msg, xp):
        a_r_tol = ({'atol': 1e-12, 'rtol': 1e-12}
                   if xp_default_dtype(xp) == xp.float64
                   else {'atol': 1e-5, 'rtol': 1e-5}
        )

        """Little helper to compare to arrays with proper tolerances"""
        xp_assert_close(actual, desired, **a_r_tol, err_msg=msg)

    def test_envelope_invalid_parameters(self, xp):
        """For `envelope()` Raise all exceptions that are used to verify function
        parameters. """
        with pytest.raises(ValueError,
                           match=r"Invalid parameter axis=2 for z.shape=.*"):
            envelope(np.ones(3), axis=2)
        with pytest.raises(ValueError,
                           match=r"z.shape\[axis\] not > 0 for z.shape=.*"):
            envelope(xp.ones((3, 0)), axis=1)
        for bp_in in [(0, 1, 2), (0, 2.), (None, 2.)]:
            ts = ', '.join(map(str, bp_in))
            with pytest.raises(ValueError,
                               match=rf"bp_in=\({ts}\) isn't a 2-tuple of.*"):
                # noinspection PyTypeChecker
                envelope(xp.ones(4), bp_in=bp_in)
        with pytest.raises(ValueError,
                           match="n_out=10.0 is not a positive integer or.*"):
            # noinspection PyTypeChecker
            envelope(xp.ones(4), n_out=10.)
        for bp_in in [(-1, 3), (1, 1), (0, 10)]:
            with pytest.raises(ValueError,
                               match=r"`-n//2 <= bp_in\[0\] < bp_in\[1\] <=.*"):
                envelope(xp.ones(4), bp_in=bp_in)
        with pytest.raises(ValueError, match="residual='undefined' not in .*"):
            # noinspection PyTypeChecker
            envelope(xp.ones(4), residual='undefined')

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    def test_envelope_verify_parameters(self, xp):
        """Ensure that the various parametrizations produce compatible results. """
        dt_r = xp_default_dtype(xp)
        dt_c = xp.complex64 if dt_r == xp.float32 else xp.complex128

        Z = xp.asarray([4.0, 2, 2, 3, 0], dtype=dt_r)
        Zr_a = xp.asarray([4.0, 0, 0, 6, 0, 0, 0, 0], dtype=dt_r)
        z = sp_fft.irfft(Z)
        n = z.shape[0]

        # the reference envelope:
        ze2_0, zr_0 = xp.unstack(envelope(z, (1, 3), residual='all', squared=True))
        self.assert_close(sp_fft.rfft(ze2_0),
                          xp.asarray([4, 2, 0, 0, 0], dtype=dt_c),
                          msg="Envelope calculation error", xp=xp)
        self.assert_close(sp_fft.rfft(zr_0),
                          xp.asarray([4, 0, 0, 3, 0], dtype=dt_c),
                          msg="Residual calculation error", xp=xp)

        ze_1, zr_1 = xp.unstack(envelope(z, (1, 3), residual='all', squared=False))
        self.assert_close(ze_1**2, ze2_0,
                          msg="Unsquared versus Squared envelope calculation error",
                          xp=xp)
        self.assert_close(zr_1, zr_0,
                          msg="Unsquared versus Squared residual calculation error",
                          xp=xp)

        ze2_2, zr_2 = xp.unstack(
            envelope(z, (1, 3), residual='all', squared=True, n_out=3*n)
        )
        self.assert_close(ze2_2[::3], ze2_0,
                          msg="3x up-sampled envelope calculation error", xp=xp)
        self.assert_close(zr_2[::3], zr_0,
                          msg="3x up-sampled residual calculation error", xp=xp)

        ze2_3, zr_3 = xp.unstack(envelope(z, (1, 3), residual='lowpass', squared=True))
        self.assert_close(ze2_3, ze2_0,
                          msg="`residual='lowpass'` envelope calculation error", xp=xp)
        self.assert_close(sp_fft.rfft(zr_3),
                          xp.asarray([4, 0, 0, 0, 0], dtype=dt_c),
                          msg="`residual='lowpass'` residual calculation error", xp=xp)

        ze2_4 = envelope(z, (1, 3), residual=None, squared=True)
        self.assert_close(ze2_4, ze2_0,
                          msg="`residual=None` envelope calculation error", xp=xp)

        # compare complex analytic signal to real version
        Z_a = xp.asarray(Z, copy=True)
        Z_a[1:] *= 2
        z_a = sp_fft.ifft(Z_a, n=n)  # analytic signal of Z
        self.assert_close(xp.real(z_a), z,
                          msg="Reference analytic signal error", xp=xp)
        ze2_a, zr_a = xp.unstack(envelope(z_a, (1, 3), residual='all', squared=True))
        self.assert_close(ze2_a, xp.astype(ze2_0, dt_c),  # dtypes must match
                          msg="Complex envelope calculation error", xp=xp)
        self.assert_close(sp_fft.fft(zr_a), xp.asarray(Zr_a, dtype=dt_c),
                          msg="Complex residual calculation error", xp=xp)

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    @pytest.mark.parametrize(
        "               Z,        bp_in,     Ze2_desired,      Zr_desired",
        [([1, 0, 2, 2, 0],    (1, None), [4, 2, 0, 0, 0], [1, 0, 0, 0, 0]),
         ([4, 0, 2, 0, 0],    (0, None), [4, 0, 2, 0, 0], [0, 0, 0, 0, 0]),
         ([4, 0, 0, 2, 0], (None, None), [4, 0, 0, 2, 0], [0, 0, 0, 0, 0]),
         ([0, 0, 2, 2, 0],       (1, 3), [2, 0, 0, 0, 0], [0, 0, 0, 2, 0]),
         ([4, 0, 2, 2, 0],      (-3, 3), [4, 0, 2, 0, 0], [0, 0, 0, 2, 0]),
         ([4, 0, 3, 4, 0],    (None, 1), [2, 0, 0, 0, 0], [0, 0, 3, 4, 0]),
         ([4, 0, 3, 4, 0],    (None, 0), [0, 0, 0, 0, 0], [4, 0, 3, 4, 0])])
    def test_envelope_real_signals(self, Z, bp_in, Ze2_desired, Zr_desired, xp):
        """Test envelope calculation with real-valued test signals.

        The comparisons are performed in the Fourier space, since it makes evaluating
        the bandpass filter behavior straightforward. Note that also the squared
        envelope can be easily calculated by hand, if one recalls that coefficients of
        a complex-valued Fourier series representing the signal can be directly
        determined by an FFT and that the absolute square of a Fourier series is again
        a Fourier series.
        """
        Z = xp.asarray(Z, dtype=xp.float64)
        Ze2_desired = xp.asarray(Ze2_desired, dtype=xp.float64)
        Zr_desired = xp.asarray(Zr_desired, dtype=xp.float64)

        z = sp_fft.irfft(Z)
        ze2, zr = xp.unstack(envelope(z, bp_in, residual='all', squared=True))
        ze2_lp, zr_lp = xp.unstack(envelope(z, bp_in, residual='lowpass', squared=True))
        Ze2, Zr, Ze2_lp, Zr_lp = (sp_fft.rfft(z_) for z_ in (ze2, zr, ze2_lp, zr_lp))

        Ze2_desired = xp.asarray(Ze2_desired, dtype=xp.complex128)
        Zr_desired = xp.asarray(Zr_desired, dtype=xp.complex128)
        self.assert_close(Ze2, Ze2_desired,
                          msg="Envelope calculation error (residual='all')", xp=xp)
        self.assert_close(Zr, Zr_desired,
                          msg="Residual calculation error (residual='all')", xp=xp)

        if bp_in[1] is not None:
            Zr_desired[bp_in[1]:] = 0
        self.assert_close(Ze2_lp, Ze2_desired,
                          msg="Envelope calculation error (residual='lowpass')", xp=xp)
        self.assert_close(Zr_lp, Zr_desired,
                          msg="Residual calculation error (residual='lowpass')", xp=xp)

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    @pytest.mark.parametrize(
        "               Z,        bp_in,         Ze2_desired,         Zr_desired",
        [([0, 5, 0, 5, 0], (None, None),    [5, 0, 10, 0, 5],    [0, 0, 0, 0, 0]),
         ([1, 5, 0, 5, 2],      (-1, 2),    [5, 0, 10, 0, 5],    [1, 0, 0, 0, 2]),
         ([1, 2, 6, 0, 6, 3],   (-1, 2), [0, 6, 0, 12, 0, 6], [1, 2, 0, 0, 0, 3])
         ])
    def test_envelope_complex_signals(self, Z, bp_in, Ze2_desired, Zr_desired, xp):
        """Test envelope calculation with complex-valued test signals.

        We only need to test for the complex envelope here, since the ``Nones``s in the
        bandpass filter were already tested in the previous test.
        """
        Z = xp.asarray(Z, dtype=xp.float64)
        Ze2_desired = xp.asarray(Ze2_desired, dtype=xp.complex128)
        Zr_desired = xp.asarray(Zr_desired, dtype=xp.complex128)

        z = sp_fft.ifft(sp_fft.ifftshift(Z))
        ze2, zr = xp.unstack(envelope(z, bp_in, residual='all', squared=True))
        Ze2, Zr = (sp_fft.fftshift(sp_fft.fft(z_)) for z_ in (ze2, zr))

        self.assert_close(Ze2, Ze2_desired,
                          msg="Envelope calculation error", xp=xp)
        self.assert_close(Zr, Zr_desired,
                          msg="Residual calculation error", xp=xp)

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    def test_envelope_verify_axis_parameter(self, xp):
        """Test for multi-channel envelope calculations. """
        dt_r = xp_default_dtype(xp)
        dt_c = xp.complex64 if dt_r == xp.float32 else xp.complex128

        z = sp_fft.irfft(xp.asarray([[1.0, 0, 2, 2, 0], [7, 0, 4, 4, 0]], dtype=dt_r))
        Ze2_desired = xp.asarray([[4, 2, 0, 0, 0], [16, 8, 0, 0, 0]],
                                 dtype=dt_c)
        Zr_desired = xp.asarray([[1, 0, 0, 0, 0], [7, 0, 0, 0, 0]], dtype=dt_c)

        ze2, zr = xp.unstack(envelope(z, squared=True, axis=1))
        ye2T, yrT = xp.unstack(envelope(z.T, squared=True, axis=0))
        Ze2, Ye2, Zr, Yr = (sp_fft.rfft(z_) for z_ in (ze2, ye2T.T, zr, yrT.T))

        self.assert_close(Ze2, Ze2_desired, msg="2d envelope calculation error", xp=xp)
        self.assert_close(Zr, Zr_desired,  msg="2d residual calculation error", xp=xp)
        self.assert_close(
            Ye2, Ze2_desired, msg="Transposed 2d envelope calc. error", xp=xp
        )
        self.assert_close(
            Yr, Zr_desired, msg="Transposed 2d residual calc. error", xp=xp
        )

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    def test_envelope_verify_axis_parameter_complex(self, xp):
        """Test for multi-channel envelope calculations with complex values. """
        dt_r = xp_default_dtype(xp)
        dt_c = xp.complex64 if dt_r == xp.float32 else xp.complex128
        inp = xp.asarray([[1.0, 5, 0, 5, 2], [1, 10, 0, 10, 2]], dtype=dt_r)
        z = sp_fft.ifft(sp_fft.ifftshift(inp, axes=1))
        Ze2_des = xp.asarray([[5, 0, 10, 0, 5], [20, 0, 40, 0, 20],], dtype=dt_c)
        Zr_des = xp.asarray([[1, 0, 0, 0, 2], [1, 0, 0, 0, 2]], dtype=dt_c)

        kw = dict(bp_in=(-1, 2), residual='all', squared=True)
        ze2, zr = xp.unstack(envelope(z, axis=1, **kw))
        ye2T, yrT = xp.unstack(envelope(z.T, axis=0, **kw))
        Ze2, Ye2, Zr, Yr = (sp_fft.fftshift(sp_fft.fft(z_), axes=1)
                            for z_ in (ze2, ye2T.T, zr, yrT.T))

        self.assert_close(Ze2, Ze2_des, msg="2d envelope calculation error", xp=xp)
        self.assert_close(Zr, Zr_des, msg="2d residual calculation error", xp=xp)
        self.assert_close(
            Ye2, Ze2_des,  msg="Transposed 2d envelope calc. error", xp=xp
        )
        self.assert_close(Yr, Zr_des,  msg="Transposed 2d residual calc. error", xp=xp)

    @skip_xp_backends("jax.numpy", reason="XXX: immutable arrays")
    @pytest.mark.parametrize('X', [[4, 0, 0, 1, 2], [4, 0, 0, 2, 1, 2]])
    def test_compare_envelope_hilbert(self, X, xp):
        """Compare output of `envelope()` and `hilbert()`. """
        X = xp.asarray(X, dtype=xp.float64)
        x = sp_fft.irfft(X)
        e_hil = xp.abs(hilbert(x))
        e_env = envelope(x, (None, None), residual=None)
        self.assert_close(e_hil, e_env, msg="Hilbert-Envelope comparison error", xp=xp)

    def test_nyquist(self):
        """Test behavior when input is a cosine at the Nyquist frequency.

        Resampling even length signals, requires accounting for unpaired bins at the
        Nyquist frequency (consults the source code of `resample`).

        Since `envelope` excludes the Nyquist frequency from the envelope calculation,
        only the residues need to be investigated.
        """
        x4 = sp_fft.irfft([0, 0, 8])  # = [2, -2, 2, -2]
        x6 = signal.resample(x4, num=6)  # = [2, -1, -1, 2, -1, -1]
        y6, y6_res = envelope(x4, n_out=6, residual='all')  # real-valued case
        z6, z6_res = envelope(x4 + 0j, n_out=6, residual='all')  # complex-valued case

        xp_assert_close(y6, np.zeros(6), atol=1e-12)
        xp_assert_close(y6_res, x6, atol=1e-12)

        xp_assert_close(z6, np.zeros(6, dtype=z6.dtype), atol=1e-12)
        xp_assert_close(z6_res, x6.astype(z6.dtype), atol=1e-12)

@skip_xp_backends(np_only=True)
class TestPartialFractionExpansion:
    @staticmethod
    def assert_rp_almost_equal(r, p, r_true, p_true, decimal=7):
        r_true = np.asarray(r_true)
        p_true = np.asarray(p_true)

        distance = np.hypot(abs(p[:, None] - p_true),
                            abs(r[:, None] - r_true))

        rows, cols = linear_sum_assignment(distance)
        assert_almost_equal(p[rows], p_true[cols], decimal=decimal)
        assert_almost_equal(r[rows], r_true[cols], decimal=decimal)

    def test_compute_factors(self, xp):
        factors, poly = _compute_factors([1, 2, 3], [3, 2, 1])
        assert len(factors) == 3
        assert_almost_equal(factors[0], np.poly([2, 2, 3]))
        assert_almost_equal(factors[1], np.poly([1, 1, 1, 3]))
        assert_almost_equal(factors[2], np.poly([1, 1, 1, 2, 2]))
        assert_almost_equal(poly, np.poly([1, 1, 1, 2, 2, 3]))

        factors, poly = _compute_factors([1, 2, 3], [3, 2, 1],
                                         include_powers=True)
        assert len(factors) == 6
        assert_almost_equal(factors[0], np.poly([1, 1, 2, 2, 3]))
        assert_almost_equal(factors[1], np.poly([1, 2, 2, 3]))
        assert_almost_equal(factors[2], np.poly([2, 2, 3]))
        assert_almost_equal(factors[3], np.poly([1, 1, 1, 2, 3]))
        assert_almost_equal(factors[4], np.poly([1, 1, 1, 3]))
        assert_almost_equal(factors[5], np.poly([1, 1, 1, 2, 2]))
        assert_almost_equal(poly, np.poly([1, 1, 1, 2, 2, 3]))

    def test_group_poles(self, xp):
        unique, multiplicity = _group_poles(
            [1.0, 1.001, 1.003, 2.0, 2.003, 3.0], 0.1, 'min')
        xp_assert_close(unique, [1.0, 2.0, 3.0])
        xp_assert_close(multiplicity, [3, 2, 1])

    def test_residue_general(self, xp):
        # Test are taken from issue #4464, note that poles in scipy are
        # in increasing by absolute value order, opposite to MATLAB.
        r, p, k = residue([5, 3, -2, 7], [-4, 0, 8, 3])
        assert_almost_equal(r, [1.3320, -0.6653, -1.4167], decimal=4)
        assert_almost_equal(p, [-0.4093, -1.1644, 1.5737], decimal=4)
        assert_almost_equal(k, [-1.2500], decimal=4)

        r, p, k = residue([-4, 8], [1, 6, 8])
        assert_almost_equal(r, [8, -12])
        assert_almost_equal(p, [-2, -4])
        assert k.size == 0

        r, p, k = residue([4, 1], [1, -1, -2])
        assert_almost_equal(r, [1, 3])
        assert_almost_equal(p, [-1, 2])
        assert k.size == 0

        r, p, k = residue([4, 3], [2, -3.4, 1.98, -0.406])
        self.assert_rp_almost_equal(
            r, p, [-18.125 - 13.125j, -18.125 + 13.125j, 36.25],
            [0.5 - 0.2j, 0.5 + 0.2j, 0.7])
        assert k.size == 0

        r, p, k = residue([2, 1], [1, 5, 8, 4])
        self.assert_rp_almost_equal(r, p, [-1, 1, 3], [-1, -2, -2])
        assert k.size == 0

        r, p, k = residue([3, -1.1, 0.88, -2.396, 1.348],
                          [1, -0.7, -0.14, 0.048])
        assert_almost_equal(r, [-3, 4, 1])
        assert_almost_equal(p, [0.2, -0.3, 0.8])
        assert_almost_equal(k, [3, 1])

        r, p, k = residue([1], [1, 2, -3])
        assert_almost_equal(r, [0.25, -0.25])
        assert_almost_equal(p, [1, -3])
        assert k.size == 0

        r, p, k = residue([1, 0, -5], [1, 0, 0, 0, -1])
        self.assert_rp_almost_equal(r, p,
                                    [1, 1.5j, -1.5j, -1], [-1, -1j, 1j, 1])
        assert k.size == 0

        r, p, k = residue([3, 8, 6], [1, 3, 3, 1])
        self.assert_rp_almost_equal(r, p, [1, 2, 3], [-1, -1, -1])
        assert k.size == 0

        r, p, k = residue([3, -1], [1, -3, 2])
        assert_almost_equal(r, [-2, 5])
        assert_almost_equal(p, [1, 2])
        assert k.size == 0

        r, p, k = residue([2, 3, -1], [1, -3, 2])
        assert_almost_equal(r, [-4, 13])
        assert_almost_equal(p, [1, 2])
        assert_almost_equal(k, [2])

        r, p, k = residue([7, 2, 3, -1], [1, -3, 2])
        assert_almost_equal(r, [-11, 69])
        assert_almost_equal(p, [1, 2])
        assert_almost_equal(k, [7, 23])

        r, p, k = residue([2, 3, -1], [1, -3, 4, -2])
        self.assert_rp_almost_equal(r, p, [4, -1 + 3.5j, -1 - 3.5j],
                                    [1, 1 - 1j, 1 + 1j])
        assert k.size == 0

    def test_residue_leading_zeros(self, xp):
        # Leading zeros in numerator or denominator must not affect the answer.
        r0, p0, k0 = residue([5, 3, -2, 7], [-4, 0, 8, 3])
        r1, p1, k1 = residue([0, 5, 3, -2, 7], [-4, 0, 8, 3])
        r2, p2, k2 = residue([5, 3, -2, 7], [0, -4, 0, 8, 3])
        r3, p3, k3 = residue([0, 0, 5, 3, -2, 7], [0, 0, 0, -4, 0, 8, 3])
        assert_almost_equal(r0, r1)
        assert_almost_equal(r0, r2)
        assert_almost_equal(r0, r3)
        assert_almost_equal(p0, p1)
        assert_almost_equal(p0, p2)
        assert_almost_equal(p0, p3)
        assert_almost_equal(k0, k1)
        assert_almost_equal(k0, k2)
        assert_almost_equal(k0, k3)

    def test_resiude_degenerate(self, xp):
        # Several tests for zero numerator and denominator.
        r, p, k = residue([0, 0], [1, 6, 8])
        assert_almost_equal(r, [0, 0])
        assert_almost_equal(p, [-2, -4])
        assert k.size == 0

        r, p, k = residue(0, 1)
        assert r.size == 0
        assert p.size == 0
        assert k.size == 0

        with pytest.raises(ValueError, match="Denominator `a` is zero."):
            residue(1, 0)

    def test_residuez_general(self, xp):
        r, p, k = residuez([1, 6, 6, 2], [1, -(2 + 1j), (1 + 2j), -1j])
        self.assert_rp_almost_equal(r, p, [-2+2.5j, 7.5+7.5j, -4.5-12j],
                                    [1j, 1, 1])
        assert_almost_equal(k, [2j])

        r, p, k = residuez([1, 2, 1], [1, -1, 0.3561])
        self.assert_rp_almost_equal(r, p,
                                    [-0.9041 - 5.9928j, -0.9041 + 5.9928j],
                                    [0.5 + 0.3257j, 0.5 - 0.3257j],
                                    decimal=4)
        assert_almost_equal(k, [2.8082], decimal=4)

        r, p, k = residuez([1, -1], [1, -5, 6])
        assert_almost_equal(r, [-1, 2])
        assert_almost_equal(p, [2, 3])
        assert k.size == 0

        r, p, k = residuez([2, 3, 4], [1, 3, 3, 1])
        self.assert_rp_almost_equal(r, p, [4, -5, 3], [-1, -1, -1])
        assert k.size == 0

        r, p, k = residuez([1, -10, -4, 4], [2, -2, -4])
        assert_almost_equal(r, [0.5, -1.5])
        assert_almost_equal(p, [-1, 2])
        assert_almost_equal(k, [1.5, -1])

        r, p, k = residuez([18], [18, 3, -4, -1])
        self.assert_rp_almost_equal(r, p,
                                    [0.36, 0.24, 0.4], [0.5, -1/3, -1/3])
        assert k.size == 0

        r, p, k = residuez([2, 3], np.polymul([1, -1/2], [1, 1/4]))
        assert_almost_equal(r, [-10/3, 16/3])
        assert_almost_equal(p, [-0.25, 0.5])
        assert k.size == 0

        r, p, k = residuez([1, -2, 1], [1, -1])
        assert_almost_equal(r, [0])
        assert_almost_equal(p, [1])
        assert_almost_equal(k, [1, -1])

        r, p, k = residuez(1, [1, -1j])
        assert_almost_equal(r, [1])
        assert_almost_equal(p, [1j])
        assert k.size == 0

        r, p, k = residuez(1, [1, -1, 0.25])
        assert_almost_equal(r, [0, 1])
        assert_almost_equal(p, [0.5, 0.5])
        assert k.size == 0

        r, p, k = residuez(1, [1, -0.75, .125])
        assert_almost_equal(r, [-1, 2])
        assert_almost_equal(p, [0.25, 0.5])
        assert k.size == 0

        r, p, k = residuez([1, 6, 2], [1, -2, 1])
        assert_almost_equal(r, [-10, 9])
        assert_almost_equal(p, [1, 1])
        assert_almost_equal(k, [2])

        r, p, k = residuez([6, 2], [1, -2, 1])
        assert_almost_equal(r, [-2, 8])
        assert_almost_equal(p, [1, 1])
        assert k.size == 0

        r, p, k = residuez([1, 6, 6, 2], [1, -2, 1])
        assert_almost_equal(r, [-24, 15])
        assert_almost_equal(p, [1, 1])
        assert_almost_equal(k, [10, 2])

        r, p, k = residuez([1, 0, 1], [1, 0, 0, 0, 0, -1])
        self.assert_rp_almost_equal(r, p,
                                    [0.2618 + 0.1902j, 0.2618 - 0.1902j,
                                     0.4, 0.0382 - 0.1176j, 0.0382 + 0.1176j],
                                    [-0.8090 + 0.5878j, -0.8090 - 0.5878j,
                                     1.0, 0.3090 + 0.9511j, 0.3090 - 0.9511j],
                                    decimal=4)
        assert k.size == 0

    def test_residuez_trailing_zeros(self, xp):
        # Trailing zeros in numerator or denominator must not affect the
        # answer.
        r0, p0, k0 = residuez([5, 3, -2, 7], [-4, 0, 8, 3])
        r1, p1, k1 = residuez([5, 3, -2, 7, 0], [-4, 0, 8, 3])
        r2, p2, k2 = residuez([5, 3, -2, 7], [-4, 0, 8, 3, 0])
        r3, p3, k3 = residuez([5, 3, -2, 7, 0, 0], [-4, 0, 8, 3, 0, 0, 0])
        assert_almost_equal(r0, r1)
        assert_almost_equal(r0, r2)
        assert_almost_equal(r0, r3)
        assert_almost_equal(p0, p1)
        assert_almost_equal(p0, p2)
        assert_almost_equal(p0, p3)
        assert_almost_equal(k0, k1)
        assert_almost_equal(k0, k2)
        assert_almost_equal(k0, k3)

    def test_residuez_degenerate(self, xp):
        r, p, k = residuez([0, 0], [1, 6, 8])
        assert_almost_equal(r, [0, 0])
        assert_almost_equal(p, [-2, -4])
        assert k.size == 0

        r, p, k = residuez(0, 1)
        assert r.size == 0
        assert p.size == 0
        assert k.size == 0

        with pytest.raises(ValueError, match="Denominator `a` is zero."):
            residuez(1, 0)

        with pytest.raises(ValueError,
                           match="First coefficient of determinant `a` must "
                                 "be non-zero."):
            residuez(1, [0, 1, 2, 3])

    def test_inverse_unique_roots_different_rtypes(self, xp):
        # This test was inspired by github issue 2496.
        r = [3 / 10, -1 / 6, -2 / 15]
        p = [0, -2, -5]
        k = []
        b_expected = [0.0, 1, 3]
        a_expected = [1, 7, 10, 0]

        # With the default tolerance, the rtype does not matter
        # for this example.
        for rtype in ('avg', 'mean', 'min', 'minimum', 'max', 'maximum'):
            b, a = invres(r, p, k, rtype=rtype)
            xp_assert_close(b, b_expected)
            xp_assert_close(a, a_expected, check_dtype=False)

            b, a = invresz(r, p, k, rtype=rtype)
            xp_assert_close(b, b_expected)
            xp_assert_close(a, a_expected, check_dtype=False)

    def test_inverse_repeated_roots_different_rtypes(self, xp):
        r = [3 / 20, -7 / 36, -1 / 6, 2 / 45]
        p = [0, -2, -2, -5]
        k = []
        b_expected = [0.0, 0, 1, 3]
        b_expected_z = [-1/6, -2/3, 11/6, 3]
        a_expected = [1, 9, 24, 20, 0]

        for rtype in ('avg', 'mean', 'min', 'minimum', 'max', 'maximum'):
            b, a = invres(r, p, k, rtype=rtype)
            xp_assert_close(b, b_expected, atol=1e-14)
            xp_assert_close(a, a_expected, check_dtype=False)

            b, a = invresz(r, p, k, rtype=rtype)
            xp_assert_close(b, b_expected_z, atol=1e-14)
            xp_assert_close(a, a_expected, check_dtype=False)

    def test_inverse_bad_rtype(self, xp):
        r = [3 / 20, -7 / 36, -1 / 6, 2 / 45]
        p = [0, -2, -2, -5]
        k = []
        with pytest.raises(ValueError, match="`rtype` must be one of"):
            invres(r, p, k, rtype='median')
        with pytest.raises(ValueError, match="`rtype` must be one of"):
            invresz(r, p, k, rtype='median')

    def test_invresz_one_coefficient_bug(self, xp):
        # Regression test for issue in gh-4646.
        r = [1]
        p = [2]
        k = [0]
        b, a = invresz(r, p, k)
        xp_assert_close(b, [1])
        xp_assert_close(a, [1.0, -2.0])

    def test_invres(self, xp):
        b, a = invres([1], [1], [])
        assert_almost_equal(b, [1])
        assert_almost_equal(a, [1, -1])

        b, a = invres([1 - 1j, 2, 0.5 - 3j], [1, 0.5j, 1 + 1j], [])
        assert_almost_equal(b, [3.5 - 4j, -8.5 + 0.25j, 3.5 + 3.25j])
        assert_almost_equal(a, [1, -2 - 1.5j, 0.5 + 2j, 0.5 - 0.5j])

        b, a = invres([0.5, 1], [1 - 1j, 2 + 2j], [1, 2, 3])
        assert_almost_equal(b, [1, -1 - 1j, 1 - 2j, 0.5 - 3j, 10])
        assert_almost_equal(a, [1, -3 - 1j, 4])

        b, a = invres([-1, 2, 1j, 3 - 1j, 4, -2],
                      [-1, 2 - 1j, 2 - 1j, 3, 3, 3], [])
        assert_almost_equal(b, [4 - 1j, -28 + 16j, 40 - 62j, 100 + 24j,
                                -292 + 219j, 192 - 268j])
        assert_almost_equal(a, [1, -12 + 2j, 53 - 20j, -96 + 68j, 27 - 72j,
                                108 - 54j, -81 + 108j])

        b, a = invres([-1, 1j], [1, 1], [1, 2])
        assert_almost_equal(b, [1, 0, -4, 3 + 1j])
        assert_almost_equal(a, [1, -2, 1])

    def test_invresz(self, xp):
        b, a = invresz([1], [1], [])
        assert_almost_equal(b, [1])
        assert_almost_equal(a, [1, -1])

        b, a = invresz([1 - 1j, 2, 0.5 - 3j], [1, 0.5j, 1 + 1j], [])
        assert_almost_equal(b, [3.5 - 4j, -8.5 + 0.25j, 3.5 + 3.25j])
        assert_almost_equal(a, [1, -2 - 1.5j, 0.5 + 2j, 0.5 - 0.5j])

        b, a = invresz([0.5, 1], [1 - 1j, 2 + 2j], [1, 2, 3])
        assert_almost_equal(b, [2.5, -3 - 1j, 1 - 2j, -1 - 3j, 12])
        assert_almost_equal(a, [1, -3 - 1j, 4])

        b, a = invresz([-1, 2, 1j, 3 - 1j, 4, -2],
                       [-1, 2 - 1j, 2 - 1j, 3, 3, 3], [])
        assert_almost_equal(b, [6, -50 + 11j, 100 - 72j, 80 + 58j,
                                -354 + 228j, 234 - 297j])
        assert_almost_equal(a, [1, -12 + 2j, 53 - 20j, -96 + 68j, 27 - 72j,
                                108 - 54j, -81 + 108j])

        b, a = invresz([-1, 1j], [1, 1], [1, 2])
        assert_almost_equal(b, [1j, 1, -3, 2])
        assert_almost_equal(a, [1, -2, 1])

    def test_inverse_scalar_arguments(self, xp):
        b, a = invres(1, 1, 1)
        assert_almost_equal(b, [1, 0])
        assert_almost_equal(a, [1, -1])

        b, a = invresz(1, 1, 1)
        assert_almost_equal(b, [2, -1])
        assert_almost_equal(a, [1, -1])


class TestVectorstrength:

    def test_single_1dperiod(self, xp):
        events = xp.asarray([.5])
        period = 5.
        targ_strength = 1.
        targ_phase = .1

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 0
        assert phase.ndim == 0

        assert math.isclose(strength, targ_strength, abs_tol=1.5e-7)
        assert math.isclose(phase, 2 * math.pi * targ_phase, abs_tol=1.5e-7)

    @xfail_xp_backends('torch', reason="phase modulo 2*pi")
    def test_single_2dperiod(self, xp):
        events = xp.asarray([.5])
        period = xp.asarray([1, 2, 5.])
        targ_strength = xp.asarray([1.] * 3)
        targ_phase = xp.asarray([.5, .25, .1])

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 1
        assert phase.ndim == 1
        assert_array_almost_equal(strength, targ_strength)
        assert_almost_equal(phase, 2 * xp.pi * targ_phase)

    def test_equal_1dperiod(self, xp):
        events = xp.asarray([.25, .25, .25, .25, .25, .25])
        period = 2
        targ_strength = 1.
        targ_phase = .125

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 0
        assert phase.ndim == 0

        assert math.isclose(strength, targ_strength, abs_tol=1.5e-7)
        assert math.isclose(phase, 2 * math.pi * targ_phase, abs_tol=1.5e-7)

    def test_equal_2dperiod(self, xp):
        events = xp.asarray([.25, .25, .25, .25, .25, .25])
        period = xp.asarray([1, 2, ])
        targ_strength = xp.asarray([1.] * 2)
        targ_phase = xp.asarray([.25, .125])

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 1
        assert phase.ndim == 1
        assert_almost_equal(strength, targ_strength)
        assert_almost_equal(phase, 2 * xp.pi * targ_phase)

    def test_spaced_1dperiod(self, xp):
        events = xp.asarray([.1, 1.1, 2.1, 4.1, 10.1])
        period = 1
        targ_strength = 1.
        targ_phase = .1

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 0
        assert phase.ndim == 0

        assert math.isclose(strength, targ_strength, abs_tol=1.5e-7)
        assert math.isclose(phase, 2 * math.pi * targ_phase, abs_tol=1.5e-6)

    def test_spaced_2dperiod(self, xp):
        events = xp.asarray([.1, 1.1, 2.1, 4.1, 10.1])
        period = xp.asarray([1, .5])
        targ_strength = xp.asarray([1.] * 2)
        targ_phase = xp.asarray([.1, .2])

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 1
        assert phase.ndim == 1
        assert_almost_equal(strength, targ_strength)
        rtol_kw = {'rtol': 2e-6} if xp_default_dtype(xp) == xp.float32 else {}
        xp_assert_close(phase, 2 * xp.pi * targ_phase, **rtol_kw)

    def test_partial_1dperiod(self, xp):
        events = xp.asarray([.25, .5, .75])
        period = 1
        targ_strength = 1. / 3.
        targ_phase = .5

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 0
        assert phase.ndim == 0

        assert math.isclose(strength, targ_strength)
        assert math.isclose(phase, 2 * math.pi * targ_phase)


    @xfail_xp_backends("torch", reason="phase modulo 2*pi")
    def test_partial_2dperiod(self, xp):
        events = xp.asarray([.25, .5, .75])
        period = xp.asarray([1., 1., 1., 1.])
        targ_strength = xp.asarray([1. / 3.] * 4)
        targ_phase = xp.asarray([.5, .5, .5, .5])

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 1
        assert phase.ndim == 1
        assert_almost_equal(strength, targ_strength)
        assert_almost_equal(phase, 2 * xp.pi * targ_phase)

    def test_opposite_1dperiod(self, xp):
        events = xp.asarray([0, .25, .5, .75])
        period = 1.
        targ_strength = 0

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 0
        assert phase.ndim == 0
        assert math.isclose(strength, targ_strength, abs_tol=1.5e-7)

    def test_opposite_2dperiod(self, xp):
        events = xp.asarray([0, .25, .5, .75])
        period = xp.asarray([1.] * 10)
        targ_strength = xp.asarray([0.] * 10)

        strength, phase = vectorstrength(events, period)

        assert strength.ndim == 1
        assert phase.ndim == 1
        assert_almost_equal(strength, targ_strength)

    def test_2d_events_ValueError(self, xp):
        events = xp.asarray([[1, 2]])
        period = 1.
        assert_raises(ValueError, vectorstrength, events, period)

    def test_2d_period_ValueError(self, xp):
        events = 1.
        period = xp.asarray([[1]])
        assert_raises(ValueError, vectorstrength, events, period)

    def test_zero_period_ValueError(self, xp):
        events = 1.
        period = 0
        assert_raises(ValueError, vectorstrength, events, period)

    def test_negative_period_ValueError(self, xp):
        events = 1.
        period = -1
        assert_raises(ValueError, vectorstrength, events, period)


@pytest.mark.filterwarnings('ignore::DeprecationWarning')
@skip_xp_backends(np_only=True)
@pytest.mark.parametrize('func', (sosfilt, lfilter))
def test_nonnumeric_dtypes(func, xp):
    x = [Decimal(1), Decimal(2), Decimal(3)]
    b = [Decimal(1), Decimal(2), Decimal(3)]
    a = [Decimal(1), Decimal(2), Decimal(3)]
    x = np.array(x)
    assert x.dtype.kind == 'O'
    desired = lfilter(np.array(b, float), np.array(a, float), x.astype(float))
    if func is sosfilt:
        actual = sosfilt([b + a], x)
    else:
        actual = lfilter(b, a, x)
    assert all(isinstance(x, Decimal) for x in actual)
    assert_allclose(actual.astype(float), desired.astype(float))
    # Degenerate cases
    if func is lfilter:
        args = [1., 1.]
    else:
        args = [tf2sos(1., 1.)]

    with pytest.raises(ValueError, match='must be at least 1-D'):
        func(*args, x=1.)


# XXX: restore testing on CuPy, where possible. Multiple issues in this test:
#  1. _zi functions deliberately incompatible in cupy
#     (https://github.com/scipy/scipy/pull/21713#issuecomment-2417494443)
#  2. a CuPy issue to be fixed in 14.0 only
#      (https://github.com/cupy/cupy/pull/8677)
#  3. an issue with CuPy's __array__ not numpy-2.0 compatible
@skip_xp_backends(cpu_only=True)
@pytest.mark.parametrize('dt', ['float32', 'float64', 'complex64', 'complex128'])
class TestSOSFilt:

    # The test_rank* tests are pulled from _TestLinearFilter
    @skip_xp_backends('jax.numpy', reason='buffer array is read-only')
    def test_rank1(self, dt, xp):
        dt = getattr(xp, dt)
        x = xp.linspace(0, 5, 6, dtype=dt)
        b = xp.asarray([1, -1], dtype=dt)
        a = xp.asarray([0.5, -0.5], dtype=dt)

        # Test simple IIR
        y_r = xp.asarray([0, 2, 4, 6, 8, 10.], dtype=dt)
        bb, aa = map(np.asarray, (b, a))
        sos = tf2sos(bb, aa)
        sos = xp.asarray(sos)   # XXX while tf2sos is numpy only
        assert_array_almost_equal(sosfilt(sos, x), y_r)

        # Test simple FIR
        b = xp.asarray([1, 1], dtype=dt)
        # NOTE: This was changed (rel. to TestLinear...) to add a pole @zero:
        a = xp.asarray([1, 0], dtype=dt)
        y_r = xp.asarray([0, 1, 3, 5, 7, 9.], dtype=dt)
        bb, aa = map(np.asarray, (b, a))
        sos = tf2sos(bb, aa)
        sos = xp.asarray(sos)   # XXX while tf2sos is numpy only
        assert_array_almost_equal(sosfilt(sos, x), y_r)

        b = xp.asarray([1.0, 1, 0])
        a = xp.asarray([1.0, 0, 0])
        x = xp.ones(8)

        sos = xp.concat((b, a))
        sos = xp.reshape(sos, (1, 6))
        y = sosfilt(sos, x)
        xp_assert_close(y, xp.asarray([1.0, 2, 2, 2, 2, 2, 2, 2]))

    @skip_xp_backends('jax.numpy', reason='buffer array is read-only')
    def test_rank2(self, dt, xp):
        dt = getattr(xp, dt)
        shape = (4, 3)
        prodshape = math.prod(shape)
        x = xp.linspace(0, prodshape - 1, prodshape, dtype=dt)
        x = xp.reshape(x, shape)

        b = xp.asarray([1, -1], dtype=dt)
        a = xp.asarray([0.5, 0.5], dtype=dt)

        y_r2_a0 = xp.asarray([[0, 2, 4], [6, 4, 2], [0, 2, 4], [6, 4, 2]],
                           dtype=dt)

        y_r2_a1 = xp.asarray([[0, 2, 0], [6, -4, 6], [12, -10, 12],
                            [18, -16, 18]], dtype=dt)

        bb, aa = map(np.asarray, (b, a))
        sos = tf2sos(bb, aa)
        sos = xp.asarray(sos)   # XXX
        y = sosfilt(sos, x, axis=0)
        assert_array_almost_equal(y_r2_a0, y)

        sos = tf2sos(bb, aa)
        sos = xp.asarray(sos)   # XXX
        y = sosfilt(sos, x, axis=1)
        assert_array_almost_equal(y_r2_a1, y)

    @skip_xp_backends('jax.numpy', reason='buffer array is read-only')
    def test_rank3(self, dt, xp):
        dt = getattr(xp, dt)
        shape = (4, 3, 2)
        prodshape = math.prod(shape)
        x = xp.linspace(0, prodshape - 1, prodshape)
        x = xp.reshape(x, shape)

        b = xp.asarray([1, -1], dtype=dt)
        a = xp.asarray([0.5, 0.5], dtype=dt)

        # Test last axis
        bb, aa = map(np.asarray, (b, a))  # XXX until tf2sos is array api compatible
        sos = tf2sos(bb, aa)
        sos = xp.asarray(sos)   # XXX
        y = sosfilt(sos, x)
        for i in range(x.shape[0]):
            for j in range(x.shape[1]):
                assert_array_almost_equal(y[i, j, ...], lfilter(b, a, x[i, j, ...]))

    def _get_ab_sos(self, xp):
        b1, a1 = signal.butter(2, 0.25, 'low')
        b2, a2 = signal.butter(2, 0.75, 'low')
        b3, a3 = signal.butter(2, 0.75, 'low')
        b = np.convolve(np.convolve(b1, b2), b3)
        a = np.convolve(np.convolve(a1, a2), a3)
        sos = np.array((np.r_[b1, a1], np.r_[b2, a2], np.r_[b3, a3]))

        a, b, sos = map(xp.asarray, (a, b, sos))
        return a, b, sos

    @skip_xp_backends('jax.numpy', reason='item assignment')
    def test_initial_conditions(self, dt, xp):
        a, b, sos = self._get_ab_sos(xp)

        x = np.random.rand(50).astype(dt)
        x = xp.asarray(x)

        dt = getattr(xp, dt)

        # Stopping filtering and continuing
        y_true, zi = lfilter(b, a, x[:20], zi=xp.zeros(6))
        y_true = xp.concat((y_true, lfilter(b, a, x[20:], zi=zi)[0]))
        xp_assert_close(y_true, lfilter(b, a, x))

        y_sos, zi = sosfilt(sos, x[:20], zi=xp.zeros((3, 2)))
        y_sos = xp.concat((y_sos, sosfilt(sos, x[20:], zi=zi)[0]))
        xp_assert_close(y_true, y_sos)

        # Use a step function
        zi = sosfilt_zi(sos)
        x = xp.ones(8, dtype=dt)
        y, zf = sosfilt(sos, x, zi=zi)

        xp_assert_close(y, xp.ones(8), check_dtype=False)
        xp_assert_close(zf, zi, check_dtype=False)

    @skip_xp_backends('jax.numpy', reason='item assignment')
    @skip_xp_backends('array_api_strict', reason='fancy indexing not supported')
    def test_initial_conditions_2(self, dt, xp):
        dt = getattr(xp, dt)
        x = xp.ones(8, dtype=dt)

        _, _, sos = self._get_ab_sos(xp)
        zi = sosfilt_zi(sos)

        # Initial condition shape matching
        x = xp.reshape(x, (1, 1) + x.shape)  # 3D
        with pytest.raises(ValueError):
            sosfilt(sos, x, zi=zi)

        zi_nd = xp_copy(zi, xp=xp)
        zi_nd = xp.reshape(zi_nd, (zi.shape[0], 1, 1, zi.shape[-1]))

        with pytest.raises(ValueError):
            sosfilt(sos, x, zi=zi_nd[:, :, :, [0, 1, 1]])

        y, zf = sosfilt(sos, x, zi=zi_nd)
        xp_assert_close(y[0, 0], xp.ones(8), check_dtype=False)
        xp_assert_close(zf[:, 0, 0, :], zi, check_dtype=False)

    @skip_xp_backends('jax.numpy', reason='item assignment')
    def test_initial_conditions_3d_axis1(self, dt, xp):
        # Test the use of zi when sosfilt is applied to axis 1 of a 3-d input.

        # Input array is x.
        x = np.random.RandomState(159).randint(0, 5, size=(2, 15, 3))
        x = x.astype(dt)
        x = xp.asarray(x)

        # Design a filter in ZPK format and convert to SOS
        zpk = signal.butter(6, 0.35, output='zpk')
        sos = zpk2sos(*zpk)
        sos = xp.asarray(sos)   # XXX while zpk2sos is numpy-only

        nsections = sos.shape[0]

        # Filter along this axis.
        axis = 1

        # Initial conditions, all zeros.
        shp = list(x.shape)
        shp[axis] = 2
        shp = tuple([nsections] + shp)
        z0 = xp.zeros(shp)

        # Apply the filter to x.
        yf, zf = sosfilt(sos, x, axis=axis, zi=z0)

        # Apply the filter to x in two stages.
        y1, z1 = sosfilt(sos, x[:, :5, :], axis=axis, zi=z0)
        y2, z2 = sosfilt(sos, x[:, 5:, :], axis=axis, zi=z1)

        # y should equal yf, and z2 should equal zf.
        y = xp.concat((y1, y2), axis=axis)
        xp_assert_close(y, yf, rtol=1e-10, atol=1e-13)
        xp_assert_close(z2, zf, rtol=1e-10, atol=1e-13)

        # let's try the "step" initial condition
        zi = sosfilt_zi(sos)
        zi = xp.reshape(zi, (nsections, 1, 2, 1))
        zi = zi * x[:, 0:1, :]
        y = sosfilt(sos, x, axis=axis, zi=zi)[0]
        # check it against the TF form
        b, a = zpk2tf(*zpk)
        b, a = xp.asarray(b), xp.asarray(a)    # XXX while zpk2tf is numpy-only

        zi = lfilter_zi(b, a)
        zi = xp.reshape(zi, (1, xp_size(zi), 1))
        zi = zi * x[:, 0:1, :]
        y_tf = lfilter(b, a, x, axis=axis, zi=zi)[0]
        xp_assert_close(y, y_tf, rtol=1e-10, atol=1e-13)

    @skip_xp_backends('torch', reason='issues a RuntimeWarning')
    @skip_xp_backends('jax.numpy', reason='item assignment')
    def test_bad_zi_shape(self, dt, xp):
        dt = getattr(xp, dt)
        # The shape of zi is checked before using any values in the
        # arguments, so np.empty is fine for creating the arguments.
        x = xp.empty((3, 15, 3), dtype=dt)
        sos = xp.zeros((4, 6))
        zi = xp.empty((4, 3, 3, 2))  # Correct shape is (4, 3, 2, 3)
        with pytest.raises(ValueError, match='should be all ones'):
            sosfilt(sos, x, zi=zi, axis=1)
        sos[:, 3] = 1.
        with pytest.raises(ValueError, match='Invalid zi shape'):
            sosfilt(sos, x, zi=zi, axis=1)

    @skip_xp_backends('jax.numpy', reason='item assignment')
    def test_sosfilt_zi(self, dt, xp):
        dt = getattr(xp, dt)
        sos = signal.butter(6, 0.2, output='sos')
        sos = xp.asarray(sos)   # XXX while butter is np-only
        zi = sosfilt_zi(sos)

        y, zf = sosfilt(sos, xp.ones(40, dtype=dt), zi=zi)
        xp_assert_close(zf, zi, rtol=1e-13, check_dtype=False)

        # Expected steady state value of the step response of this filter:
        ss = xp.prod(xp.sum(sos[:, :3], axis=-1) / xp.sum(sos[:, 3:], axis=-1))
        xp_assert_close(y, ss * xp.ones_like(y), rtol=1e-13)

    @skip_xp_backends(np_only=True)
    def test_sosfilt_zi_2(self, dt, xp):
        # zi as array-like
        dt = getattr(xp, dt)
        sos = signal.butter(6, 0.2, output='sos')
        sos = xp.asarray(sos)   # XXX while butter is np-only
        zi = sosfilt_zi(sos)

        _, zf = sosfilt(sos, xp.ones(40, dtype=dt), zi=zi.tolist())
        xp_assert_close(zf, zi, rtol=1e-13, check_dtype=False)

    @pytest.mark.thread_unsafe
    @skip_xp_backends(np_only=True)
    def test_dtype_deprecation(self, dt, xp):
        # gh-21211
        sos = np.asarray([1, 2, 3, 1, 5, 3], dtype=object).reshape(1, 6)
        x = np.asarray([2, 3, 4, 5, 3, 4, 2, 2, 1], dtype=object)
        with pytest.deprecated_call(match="dtype=object is not supported"):
            sosfilt(sos, x)


@skip_xp_backends(cpu_only=True, reason='lfilter is CPU-only compiled code')
@skip_xp_backends('jax.numpy', reason='item assignment')
class TestDeconvolve:

    @skip_xp_backends(np_only=True, reason="list inputs are numpy-specific")
    def test_array_like(self, xp):
        # From docstring example: with lists
        original = [0.0, 1, 0, 0, 1, 1, 0, 0]
        impulse_response = [2, 1]
        recorded = xp.asarray([0.0, 2, 1, 0, 2, 3, 1, 0, 0])
        recovered, remainder = signal.deconvolve(recorded, impulse_response)
        xp_assert_close(recovered, original)

    def test_basic(self, xp):
        # From docstring example
        original = xp.asarray([0.0, 1, 0, 0, 1, 1, 0, 0], dtype=xp.float64)
        impulse_response = xp.asarray([2, 1])
        recorded = xp.asarray([0.0, 2, 1, 0, 2, 3, 1, 0, 0])
        recovered, remainder = signal.deconvolve(recorded, impulse_response)
        xp_assert_close(recovered, original)

    def test_n_dimensional_signal(self, xp):
        recorded = xp.asarray([[0, 0], [0, 0]])
        impulse_response = xp.asarray([0, 0])
        with pytest.raises(ValueError, match="signal must be 1-D."):
            quotient, remainder = signal.deconvolve(recorded, impulse_response)

    def test_n_dimensional_divisor(self, xp):
        recorded = xp.asarray([0, 0])
        impulse_response = xp.asarray([[0, 0], [0, 0]])
        with pytest.raises(ValueError, match="divisor must be 1-D."):
            quotient, remainder = signal.deconvolve(recorded, impulse_response)


@skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestDetrend:

    def test_basic(self, xp):
        detrended = detrend(xp.asarray([1, 2, 3]))
        detrended_exact = xp.asarray([0, 0, 0])
        assert_array_almost_equal(detrended, detrended_exact)

    @skip_xp_backends("jax.numpy", reason="overwrite_data not implemented")
    def test_copy(self, xp):
        x = xp.asarray([1, 1.2, 1.5, 1.6, 2.4])
        copy_array = detrend(x, overwrite_data=False)
        inplace = detrend(x, overwrite_data=True)
        assert_array_almost_equal(copy_array, inplace)

    @pytest.mark.parametrize('kind', ['linear', 'constant'])
    @pytest.mark.parametrize('axis', [0, 1, 2])
    def test_axis(self, axis, kind, xp):
        data = xp.reshape(xp.arange(5*6*7), (5, 6, 7))
        detrended = detrend(data, type=kind, axis=axis)
        assert detrended.shape == data.shape

    def test_bp(self, xp):
        data = [0, 1, 2] + [5, 0, -5, -10]
        data = xp.asarray(data)
        detrended = detrend(data, type='linear', bp=3)
        xp_assert_close(detrended, xp.zeros_like(detrended), atol=1e-14)

        # repeat with ndim > 1 and axis
        data = xp.asarray(data)[None, :, None]

        detrended = detrend(data, type="linear", bp=3, axis=1)
        xp_assert_close(detrended, xp.zeros_like(detrended), atol=1e-14)

        # breakpoint index > shape[axis]: raises
        with assert_raises(ValueError):
            detrend(data, type="linear", bp=3)

    @pytest.mark.parametrize('bp', [np.array([0, 2]), [0, 2]])
    def test_detrend_array_bp(self, bp, xp):
        # regression test for https://github.com/scipy/scipy/issues/18675
        rng = np.random.RandomState(12345)
        x = rng.rand(10)
        x = xp.asarray(x, dtype=xp_default_dtype(xp))
        if isinstance(bp, np.ndarray):
            bp = xp.asarray(bp)
        else:
            if not is_numpy(xp):
                pytest.skip("list bp is numpy-only")

        res = detrend(x, bp=bp)
        res_scipy_191 = xp.asarray([-4.44089210e-16, -2.22044605e-16,
            -1.11128506e-01, -1.69470553e-01,  1.14710683e-01,  6.35468419e-02,
            3.53533144e-01, -3.67877935e-02, -2.00417675e-02, -1.94362049e-01])

        atol = 3e-7 if xp_default_dtype(xp) == xp.float32 else 1e-14
        xp_assert_close(res, res_scipy_191, atol=atol)


@skip_xp_backends(np_only=True)
class TestUniqueRoots:
    def test_real_no_repeat(self, xp):
        p = [-1.0, -0.5, 0.3, 1.2, 10.0]
        unique, multiplicity = unique_roots(p)
        assert_almost_equal(unique, p, decimal=15)
        xp_assert_equal(multiplicity, np.ones(len(p), dtype=int))

    def test_real_repeat(self, xp):
        p = [-1.0, -0.95, -0.89, -0.8, 0.5, 1.0, 1.05]

        unique, multiplicity = unique_roots(p, tol=1e-1, rtype='min')
        assert_almost_equal(unique, [-1.0, -0.89, 0.5, 1.0], decimal=15)
        xp_assert_equal(multiplicity, [2, 2, 1, 2])

        unique, multiplicity = unique_roots(p, tol=1e-1, rtype='max')
        assert_almost_equal(unique, [-0.95, -0.8, 0.5, 1.05], decimal=15)
        xp_assert_equal(multiplicity, [2, 2, 1, 2])

        unique, multiplicity = unique_roots(p, tol=1e-1, rtype='avg')
        assert_almost_equal(unique, [-0.975, -0.845, 0.5, 1.025], decimal=15)
        xp_assert_equal(multiplicity, [2, 2, 1, 2])

    def test_complex_no_repeat(self, xp):
        p = [-1.0, 1.0j, 0.5 + 0.5j, -1.0 - 1.0j, 3.0 + 2.0j]
        unique, multiplicity = unique_roots(p)
        assert_almost_equal(unique, p, decimal=15)
        xp_assert_equal(multiplicity, np.ones(len(p), dtype=int))

    def test_complex_repeat(self, xp):
        p = [-1.0, -1.0 + 0.05j, -0.95 + 0.15j, -0.90 + 0.15j, 0.0,
             0.5 + 0.5j, 0.45 + 0.55j]

        unique, multiplicity = unique_roots(p, tol=1e-1, rtype='min')
        assert_almost_equal(unique, [-1.0, -0.95 + 0.15j, 0.0, 0.45 + 0.55j],
                            decimal=15)
        xp_assert_equal(multiplicity, [2, 2, 1, 2])

        unique, multiplicity = unique_roots(p, tol=1e-1, rtype='max')
        assert_almost_equal(unique,
                            [-1.0 + 0.05j, -0.90 + 0.15j, 0.0, 0.5 + 0.5j],
                            decimal=15)
        xp_assert_equal(multiplicity, [2, 2, 1, 2])

        unique, multiplicity = unique_roots(p, tol=1e-1, rtype='avg')
        assert_almost_equal(
            unique, [-1.0 + 0.025j, -0.925 + 0.15j, 0.0, 0.475 + 0.525j],
            decimal=15)
        xp_assert_equal(multiplicity, [2, 2, 1, 2])

    def test_gh_4915(self, xp):
        p = np.roots(np.convolve(np.ones(5), np.ones(5)))
        true_roots = [-(-1)**(1/5), (-1)**(4/5), -(-1)**(3/5), (-1)**(2/5)]

        unique, multiplicity = unique_roots(p)
        unique = np.sort(unique)

        assert_almost_equal(np.sort(unique), true_roots, decimal=7)
        xp_assert_equal(multiplicity, [2, 2, 2, 2])

    def test_complex_roots_extra(self, xp):
        unique, multiplicity = unique_roots([1.0, 1.0j, 1.0])
        assert_almost_equal(unique, [1.0, 1.0j], decimal=15)
        xp_assert_equal(multiplicity, [2, 1])

        unique, multiplicity = unique_roots([1, 1 + 2e-9, 1e-9 + 1j], tol=0.1)
        assert_almost_equal(unique, [1.0, 1e-9 + 1.0j], decimal=15)
        xp_assert_equal(multiplicity, [2, 1])

    def test_single_unique_root(self, xp):
        p = np.random.rand(100) + 1j * np.random.rand(100)
        unique, multiplicity = unique_roots(p, 2)
        assert_almost_equal(unique, [np.min(p)], decimal=15)
        xp_assert_equal(multiplicity, [100])


def test_gh_22684():
    actual = signal.resample_poly(np.arange(2000, dtype=np.complex64), 6, 4)
    assert actual.dtype == np.complex64
