import math
import numpy as np

from scipy._lib._array_api import (
    xp_assert_equal,
    assert_array_almost_equal,
    assert_almost_equal,
    is_cupy,
)

import pytest

from scipy import ndimage

skip_xp_backends = pytest.mark.skip_xp_backends
pytestmark = [skip_xp_backends(cpu_only=True, exceptions=['cupy', 'jax.numpy'])]


@skip_xp_backends('jax.numpy', reason="jax-ml/jax#23827")
class TestNdimageFourier:

    @pytest.mark.parametrize('shape', [(32, 16), (31, 15), (1, 10)])
    @pytest.mark.parametrize('dtype, dec', [("float32", 6), ("float64", 14)])
    def test_fourier_gaussian_real01(self, shape, dtype, dec, xp):
        fft = getattr(xp, 'fft')

        a = np.zeros(shape, dtype=dtype)
        a[0, 0] = 1.0
        a = xp.asarray(a)

        a = fft.rfft(a, n=shape[0], axis=0)
        a = fft.fft(a, n=shape[1], axis=1)
        a = ndimage.fourier_gaussian(a, [5.0, 2.5], shape[0], 0)
        a = fft.ifft(a, n=shape[1], axis=1)
        a = fft.irfft(a, n=shape[0], axis=0)
        assert_almost_equal(ndimage.sum(a), xp.asarray(1), decimal=dec,
                            check_0d=False)

    @pytest.mark.parametrize('shape', [(32, 16), (31, 15)])
    @pytest.mark.parametrize('dtype, dec', [("complex64", 6), ("complex128", 14)])
    def test_fourier_gaussian_complex01(self, shape, dtype, dec, xp):
        fft = getattr(xp, 'fft')

        a = np.zeros(shape, dtype=dtype)
        a[0, 0] = 1.0
        a = xp.asarray(a)

        a = fft.fft(a, n=shape[0], axis=0)
        a = fft.fft(a, n=shape[1], axis=1)
        a = ndimage.fourier_gaussian(a, [5.0, 2.5], -1, 0)
        a = fft.ifft(a, n=shape[1], axis=1)
        a = fft.ifft(a, n=shape[0], axis=0)
        assert_almost_equal(ndimage.sum(xp.real(a)), xp.asarray(1.0), decimal=dec,
                            check_0d=False)

    @pytest.mark.parametrize('shape', [(32, 16), (31, 15), (1, 10)])
    @pytest.mark.parametrize('dtype, dec', [("float32", 6), ("float64", 14)])
    def test_fourier_uniform_real01(self, shape, dtype, dec, xp):
        fft = getattr(xp, 'fft')

        a = np.zeros(shape, dtype=dtype)
        a[0, 0] = 1.0
        a = xp.asarray(a)

        a = fft.rfft(a, n=shape[0], axis=0)
        a = fft.fft(a, n=shape[1], axis=1)
        a = ndimage.fourier_uniform(a, [5.0, 2.5], shape[0], 0)
        a = fft.ifft(a, n=shape[1], axis=1)
        a = fft.irfft(a, n=shape[0], axis=0)
        assert_almost_equal(ndimage.sum(a), xp.asarray(1.0), decimal=dec,
                            check_0d=False)

    @pytest.mark.parametrize('shape', [(32, 16), (31, 15)])
    @pytest.mark.parametrize('dtype, dec', [("complex64", 6), ("complex128", 14)])
    def test_fourier_uniform_complex01(self, shape, dtype, dec, xp):
        fft = getattr(xp, 'fft')

        a = np.zeros(shape, dtype=dtype)
        a[0, 0] = 1.0
        a = xp.asarray(a)

        a = fft.fft(a, n=shape[0], axis=0)
        a = fft.fft(a, n=shape[1], axis=1)
        a = ndimage.fourier_uniform(a, [5.0, 2.5], -1, 0)
        a = fft.ifft(a, n=shape[1], axis=1)
        a = fft.ifft(a, n=shape[0], axis=0)
        assert_almost_equal(ndimage.sum(xp.real(a)), xp.asarray(1.0), decimal=dec,
                            check_0d=False)

    @pytest.mark.parametrize('shape', [(32, 16), (31, 15)])
    @pytest.mark.parametrize('dtype, dec', [("float32", 4), ("float64", 11)])
    def test_fourier_shift_real01(self, shape, dtype, dec, xp):
        fft = getattr(xp, 'fft')

        expected = np.arange(shape[0] * shape[1], dtype=dtype).reshape(shape)
        expected = xp.asarray(expected)

        a = fft.rfft(expected, n=shape[0], axis=0)
        a = fft.fft(a, n=shape[1], axis=1)
        a = ndimage.fourier_shift(a, [1, 1], shape[0], 0)
        a = fft.ifft(a, n=shape[1], axis=1)
        a = fft.irfft(a, n=shape[0], axis=0)
        assert_array_almost_equal(a[1:, 1:], expected[:-1, :-1], decimal=dec)

    @pytest.mark.parametrize('shape', [(32, 16), (31, 15)])
    @pytest.mark.parametrize('dtype, dec', [("complex64", 4), ("complex128", 11)])
    def test_fourier_shift_complex01(self, shape, dtype, dec, xp):
        fft = getattr(xp, 'fft')

        expected = np.arange(shape[0] * shape[1], dtype=dtype).reshape(shape)
        expected = xp.asarray(expected)

        a = fft.fft(expected, n=shape[0], axis=0)
        a = fft.fft(a, n=shape[1], axis=1)
        a = ndimage.fourier_shift(a, [1, 1], -1, 0)
        a = fft.ifft(a, n=shape[1], axis=1)
        a = fft.ifft(a, n=shape[0], axis=0)
        assert_array_almost_equal(xp.real(a)[1:, 1:], expected[:-1, :-1], decimal=dec)
        assert_array_almost_equal(xp.imag(a), xp.zeros(shape), decimal=dec)

    @pytest.mark.parametrize('shape', [(32, 16), (31, 15), (1, 10)])
    @pytest.mark.parametrize('dtype, dec', [("float32", 5), ("float64", 14)])
    def test_fourier_ellipsoid_real01(self, shape, dtype, dec, xp):
        fft = getattr(xp, 'fft')

        a = np.zeros(shape, dtype=dtype)
        a[0, 0] = 1.0
        a = xp.asarray(a)

        a = fft.rfft(a, n=shape[0], axis=0)
        a = fft.fft(a, n=shape[1], axis=1)
        a = ndimage.fourier_ellipsoid(a, [5.0, 2.5], shape[0], 0)
        a = fft.ifft(a, n=shape[1], axis=1)
        a = fft.irfft(a, n=shape[0], axis=0)
        assert_almost_equal(ndimage.sum(a), xp.asarray(1.0), decimal=dec,
                            check_0d=False)

    @pytest.mark.parametrize('shape', [(32, 16), (31, 15)])
    @pytest.mark.parametrize('dtype, dec', [("complex64", 5), ("complex128", 14)])
    def test_fourier_ellipsoid_complex01(self, shape, dtype, dec, xp):
        fft = getattr(xp, 'fft')

        a = np.zeros(shape, dtype=dtype)
        a[0, 0] = 1.0
        a = xp.asarray(a)

        a = fft.fft(a, n=shape[0], axis=0)
        a = fft.fft(a, n=shape[1], axis=1)
        a = ndimage.fourier_ellipsoid(a, [5.0, 2.5], -1, 0)
        a = fft.ifft(a, n=shape[1], axis=1)
        a = fft.ifft(a, n=shape[0], axis=0)
        assert_almost_equal(ndimage.sum(xp.real(a)), xp.asarray(1.0), decimal=dec,
                            check_0d=False)

    def test_fourier_ellipsoid_unimplemented_ndim(self, xp):
        # arrays with ndim > 3 raise NotImplementedError
        x = xp.ones((4, 6, 8, 10), dtype=xp.complex128)
        with pytest.raises(NotImplementedError):
            ndimage.fourier_ellipsoid(x, 3)

    def test_fourier_ellipsoid_1d_complex(self, xp):
        # expected result of 1d ellipsoid is the same as for fourier_uniform
        for shape in [(32, ), (31, )]:
            for type_, dec in zip([xp.complex64, xp.complex128], [5, 14]):
                x = xp.ones(shape, dtype=type_)
                a = ndimage.fourier_ellipsoid(x, 5, -1, 0)
                b = ndimage.fourier_uniform(x, 5, -1, 0)
                assert_array_almost_equal(a, b, decimal=dec)

    @pytest.mark.parametrize('shape', [(0, ), (0, 10), (10, 0)])
    @pytest.mark.parametrize('dtype', ["float32", "float64",
                                       "complex64", "complex128"])
    @pytest.mark.parametrize('test_func',
                             [ndimage.fourier_ellipsoid,
                              ndimage.fourier_gaussian,
                              ndimage.fourier_uniform])
    def test_fourier_zero_length_dims(self, shape, dtype, test_func, xp):
        if (
            is_cupy(xp)
            and test_func.__name__ == "fourier_ellipsoid" 
            and math.prod(shape) == 0
        ):
            pytest.xfail("CuPy's fourier_ellipsoid does not accept size==0 arrays")
        dtype = getattr(xp, dtype)
        a = xp.ones(shape, dtype=dtype)
        b = test_func(a, 3)
        xp_assert_equal(a, b)
