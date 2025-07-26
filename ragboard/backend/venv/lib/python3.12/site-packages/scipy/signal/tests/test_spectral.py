import sys

import numpy as np
from numpy.testing import (assert_,
                           assert_allclose, assert_array_equal, assert_equal,
                           assert_array_almost_equal_nulp, suppress_warnings)
import pytest
from pytest import raises as assert_raises

from scipy import signal
from scipy._lib._array_api import xp_assert_close
from scipy.fft import fftfreq, rfftfreq, fft, irfft
from scipy.integrate import trapezoid
from scipy.signal import (periodogram, welch, lombscargle, coherence, csd,
                          spectrogram, check_COLA, check_NOLA)
from scipy.signal.windows import hann
from scipy.signal._spectral_py import _spectral_helper

# Compare ShortTimeFFT.stft() / ShortTimeFFT.istft() with stft() / istft():
from scipy.signal.tests._scipy_spectral_test_shim import stft_compare as stft
from scipy.signal.tests._scipy_spectral_test_shim import istft_compare as istft


class TestPeriodogram:
    def test_real_onesided_even(self):
        x = np.zeros(16)
        x[0] = 1
        f, p = periodogram(x)
        assert_allclose(f, np.linspace(0, 0.5, 9))
        q = np.ones(9)
        q[0] = 0
        q[-1] /= 2.0
        q /= 8
        assert_allclose(p, q)

    def test_real_onesided_odd(self):
        x = np.zeros(15)
        x[0] = 1
        f, p = periodogram(x)
        assert_allclose(f, np.arange(8.0)/15.0)
        q = np.ones(8)
        q[0] = 0
        q *= 2.0/15.0
        assert_allclose(p, q, atol=1e-15)

    def test_real_twosided(self):
        x = np.zeros(16)
        x[0] = 1
        f, p = periodogram(x, return_onesided=False)
        assert_allclose(f, fftfreq(16, 1.0))
        q = np.full(16, 1/16.0)
        q[0] = 0
        assert_allclose(p, q)

    def test_real_spectrum(self):
        x = np.zeros(16)
        x[0] = 1
        f, p = periodogram(x, scaling='spectrum')
        g, q = periodogram(x, scaling='density')
        assert_allclose(f, np.linspace(0, 0.5, 9))
        assert_allclose(p, q/16.0)

    def test_integer_even(self):
        x = np.zeros(16, dtype=int)
        x[0] = 1
        f, p = periodogram(x)
        assert_allclose(f, np.linspace(0, 0.5, 9))
        q = np.ones(9)
        q[0] = 0
        q[-1] /= 2.0
        q /= 8
        assert_allclose(p, q)

    def test_integer_odd(self):
        x = np.zeros(15, dtype=int)
        x[0] = 1
        f, p = periodogram(x)
        assert_allclose(f, np.arange(8.0)/15.0)
        q = np.ones(8)
        q[0] = 0
        q *= 2.0/15.0
        assert_allclose(p, q, atol=1e-15)

    def test_integer_twosided(self):
        x = np.zeros(16, dtype=int)
        x[0] = 1
        f, p = periodogram(x, return_onesided=False)
        assert_allclose(f, fftfreq(16, 1.0))
        q = np.full(16, 1/16.0)
        q[0] = 0
        assert_allclose(p, q)

    def test_complex(self):
        x = np.zeros(16, np.complex128)
        x[0] = 1.0 + 2.0j
        f, p = periodogram(x, return_onesided=False)
        assert_allclose(f, fftfreq(16, 1.0))
        q = np.full(16, 5.0/16.0)
        q[0] = 0
        assert_allclose(p, q)

    def test_unk_scaling(self):
        assert_raises(ValueError, periodogram, np.zeros(4, np.complex128),
                scaling='foo')

    @pytest.mark.skipif(
        sys.maxsize <= 2**32,
        reason="On some 32-bit tolerance issue"
    )
    def test_nd_axis_m1(self):
        x = np.zeros(20, dtype=np.float64)
        x = x.reshape((2,1,10))
        x[:,:,0] = 1.0
        f, p = periodogram(x)
        assert_array_equal(p.shape, (2, 1, 6))
        assert_array_almost_equal_nulp(p[0,0,:], p[1,0,:], 60)
        f0, p0 = periodogram(x[0,0,:])
        assert_array_almost_equal_nulp(p0[np.newaxis,:], p[1,:], 60)

    @pytest.mark.skipif(
        sys.maxsize <= 2**32,
        reason="On some 32-bit tolerance issue"
    )
    def test_nd_axis_0(self):
        x = np.zeros(20, dtype=np.float64)
        x = x.reshape((10,2,1))
        x[0,:,:] = 1.0
        f, p = periodogram(x, axis=0)
        assert_array_equal(p.shape, (6,2,1))
        assert_array_almost_equal_nulp(p[:,0,0], p[:,1,0], 60)
        f0, p0 = periodogram(x[:,0,0])
        assert_array_almost_equal_nulp(p0, p[:,1,0])

    def test_window_external(self):
        x = np.zeros(16)
        x[0] = 1
        f, p = periodogram(x, 10, 'hann')
        win = signal.get_window('hann', 16)
        fe, pe = periodogram(x, 10, win)
        assert_array_almost_equal_nulp(p, pe)
        assert_array_almost_equal_nulp(f, fe)
        win_err = signal.get_window('hann', 32)
        assert_raises(ValueError, periodogram, x,
                      10, win_err)  # win longer than signal

    def test_padded_fft(self):
        x = np.zeros(16)
        x[0] = 1
        f, p = periodogram(x)
        fp, pp = periodogram(x, nfft=32)
        assert_allclose(f, fp[::2])
        assert_allclose(p, pp[::2])
        assert_array_equal(pp.shape, (17,))

    def test_empty_input(self):
        f, p = periodogram([])
        assert_array_equal(f.shape, (0,))
        assert_array_equal(p.shape, (0,))
        for shape in [(0,), (3,0), (0,5,2)]:
            f, p = periodogram(np.empty(shape))
            assert_array_equal(f.shape, shape)
            assert_array_equal(p.shape, shape)

    def test_empty_input_other_axis(self):
        for shape in [(3,0), (0,5,2)]:
            f, p = periodogram(np.empty(shape), axis=1)
            assert_array_equal(f.shape, shape)
            assert_array_equal(p.shape, shape)

    def test_short_nfft(self):
        x = np.zeros(18)
        x[0] = 1
        f, p = periodogram(x, nfft=16)
        assert_allclose(f, np.linspace(0, 0.5, 9))
        q = np.ones(9)
        q[0] = 0
        q[-1] /= 2.0
        q /= 8
        assert_allclose(p, q)

    def test_nfft_is_xshape(self):
        x = np.zeros(16)
        x[0] = 1
        f, p = periodogram(x, nfft=16)
        assert_allclose(f, np.linspace(0, 0.5, 9))
        q = np.ones(9)
        q[0] = 0
        q[-1] /= 2.0
        q /= 8
        assert_allclose(p, q)

    def test_real_onesided_even_32(self):
        x = np.zeros(16, 'f')
        x[0] = 1
        f, p = periodogram(x)
        assert_allclose(f, np.linspace(0, 0.5, 9))
        q = np.ones(9, 'f')
        q[0] = 0
        q[-1] /= 2.0
        q /= 8
        assert_allclose(p, q)
        assert_(p.dtype == q.dtype)

    def test_real_onesided_odd_32(self):
        x = np.zeros(15, 'f')
        x[0] = 1
        f, p = periodogram(x)
        assert_allclose(f, np.arange(8.0)/15.0)
        q = np.ones(8, 'f')
        q[0] = 0
        q *= 2.0/15.0
        assert_allclose(p, q, atol=1e-7)
        assert_(p.dtype == q.dtype)

    def test_real_twosided_32(self):
        x = np.zeros(16, 'f')
        x[0] = 1
        f, p = periodogram(x, return_onesided=False)
        assert_allclose(f, fftfreq(16, 1.0))
        q = np.full(16, 1/16.0, 'f')
        q[0] = 0
        assert_allclose(p, q)
        assert_(p.dtype == q.dtype)

    def test_complex_32(self):
        x = np.zeros(16, 'F')
        x[0] = 1.0 + 2.0j
        f, p = periodogram(x, return_onesided=False)
        assert_allclose(f, fftfreq(16, 1.0))
        q = np.full(16, 5.0/16.0, 'f')
        q[0] = 0
        assert_allclose(p, q)
        assert_(p.dtype == q.dtype)

    def test_shorter_window_error(self):
        x = np.zeros(16)
        x[0] = 1
        win = signal.get_window('hann', 10)
        expected_msg = ('the size of the window must be the same size '
                        'of the input on the specified axis')
        with assert_raises(ValueError, match=expected_msg):
            periodogram(x, window=win)


class TestWelch:
    def test_real_onesided_even(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=8)
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([0.08333333, 0.15277778, 0.22222222, 0.22222222,
                      0.11111111])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_real_onesided_odd(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=9)
        assert_allclose(f, np.arange(5.0)/9.0)
        q = np.array([0.12477455, 0.23430933, 0.17072113, 0.17072113,
                      0.17072113])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_real_twosided(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.08333333, 0.07638889, 0.11111111, 0.11111111,
                      0.11111111, 0.11111111, 0.11111111, 0.07638889])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_real_spectrum(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=8, scaling='spectrum')
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([0.015625, 0.02864583, 0.04166667, 0.04166667,
                      0.02083333])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_integer_onesided_even(self):
        x = np.zeros(16, dtype=int)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=8)
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([0.08333333, 0.15277778, 0.22222222, 0.22222222,
                      0.11111111])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_integer_onesided_odd(self):
        x = np.zeros(16, dtype=int)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=9)
        assert_allclose(f, np.arange(5.0)/9.0)
        q = np.array([0.12477455, 0.23430933, 0.17072113, 0.17072113,
                      0.17072113])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_integer_twosided(self):
        x = np.zeros(16, dtype=int)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.08333333, 0.07638889, 0.11111111, 0.11111111,
                      0.11111111, 0.11111111, 0.11111111, 0.07638889])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_complex(self):
        x = np.zeros(16, np.complex128)
        x[0] = 1.0 + 2.0j
        x[8] = 1.0 + 2.0j
        f, p = welch(x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.41666667, 0.38194444, 0.55555556, 0.55555556,
                      0.55555556, 0.55555556, 0.55555556, 0.38194444])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_unk_scaling(self):
        assert_raises(ValueError, welch, np.zeros(4, np.complex128),
                      scaling='foo', nperseg=4)

    def test_detrend_linear(self):
        x = np.arange(10, dtype=np.float64) + 0.04
        f, p = welch(x, nperseg=10, detrend='linear')
        assert_allclose(p, np.zeros_like(p), atol=1e-15)

    def test_no_detrending(self):
        x = np.arange(10, dtype=np.float64) + 0.04
        f1, p1 = welch(x, nperseg=10, detrend=False)
        f2, p2 = welch(x, nperseg=10, detrend=lambda x: x)
        assert_allclose(f1, f2, atol=1e-15)
        assert_allclose(p1, p2, atol=1e-15)

    def test_detrend_external(self):
        x = np.arange(10, dtype=np.float64) + 0.04
        f, p = welch(x, nperseg=10,
                     detrend=lambda seg: signal.detrend(seg, type='l'))
        assert_allclose(p, np.zeros_like(p), atol=1e-15)

    def test_detrend_external_nd_m1(self):
        x = np.arange(40, dtype=np.float64) + 0.04
        x = x.reshape((2,2,10))
        f, p = welch(x, nperseg=10,
                     detrend=lambda seg: signal.detrend(seg, type='l'))
        assert_allclose(p, np.zeros_like(p), atol=1e-15)

    def test_detrend_external_nd_0(self):
        x = np.arange(20, dtype=np.float64) + 0.04
        x = x.reshape((2,1,10))
        x = np.moveaxis(x, 2, 0)
        f, p = welch(x, nperseg=10, axis=0,
                     detrend=lambda seg: signal.detrend(seg, axis=0, type='l'))
        assert_allclose(p, np.zeros_like(p), atol=1e-15)

    def test_nd_axis_m1(self):
        x = np.arange(20, dtype=np.float64) + 0.04
        x = x.reshape((2,1,10))
        f, p = welch(x, nperseg=10)
        assert_array_equal(p.shape, (2, 1, 6))
        assert_allclose(p[0,0,:], p[1,0,:], atol=1e-13, rtol=1e-13)
        f0, p0 = welch(x[0,0,:], nperseg=10)
        assert_allclose(p0[np.newaxis,:], p[1,:], atol=1e-13, rtol=1e-13)

    def test_nd_axis_0(self):
        x = np.arange(20, dtype=np.float64) + 0.04
        x = x.reshape((10,2,1))
        f, p = welch(x, nperseg=10, axis=0)
        assert_array_equal(p.shape, (6,2,1))
        assert_allclose(p[:,0,0], p[:,1,0], atol=1e-13, rtol=1e-13)
        f0, p0 = welch(x[:,0,0], nperseg=10)
        assert_allclose(p0, p[:,1,0], atol=1e-13, rtol=1e-13)

    def test_window_external(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, 10, 'hann', nperseg=8)
        win = signal.get_window('hann', 8)
        fe, pe = welch(x, 10, win, nperseg=None)
        assert_array_almost_equal_nulp(p, pe)
        assert_array_almost_equal_nulp(f, fe)
        assert_array_equal(fe.shape, (5,))  # because win length used as nperseg
        assert_array_equal(pe.shape, (5,))
        assert_raises(ValueError, welch, x,
                      10, win, nperseg=4)  # because nperseg != win.shape[-1]
        win_err = signal.get_window('hann', 32)
        assert_raises(ValueError, welch, x,
                      10, win_err, nperseg=None)  # win longer than signal

    def test_empty_input(self):
        f, p = welch([])
        assert_array_equal(f.shape, (0,))
        assert_array_equal(p.shape, (0,))
        for shape in [(0,), (3,0), (0,5,2)]:
            f, p = welch(np.empty(shape))
            assert_array_equal(f.shape, shape)
            assert_array_equal(p.shape, shape)

    def test_empty_input_other_axis(self):
        for shape in [(3,0), (0,5,2)]:
            f, p = welch(np.empty(shape), axis=1)
            assert_array_equal(f.shape, shape)
            assert_array_equal(p.shape, shape)

    def test_short_data(self):
        x = np.zeros(8)
        x[0] = 1
        #for string-like window, input signal length < nperseg value gives
        #UserWarning, sets nperseg to x.shape[-1]
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "nperseg=256 is greater than signal.*")
            f, p = welch(x,window='hann')  # default nperseg
            f1, p1 = welch(x,window='hann', nperseg=256)  # user-specified nperseg
        f2, p2 = welch(x, nperseg=8)  # valid nperseg, doesn't give warning
        assert_allclose(f, f2)
        assert_allclose(p, p2)
        assert_allclose(f1, f2)
        assert_allclose(p1, p2)

    def test_window_long_or_nd(self):
        assert_raises(ValueError, welch, np.zeros(4), 1, np.array([1,1,1,1,1]))
        assert_raises(ValueError, welch, np.zeros(4), 1,
                      np.arange(6).reshape((2,3)))

    def test_nondefault_noverlap(self):
        x = np.zeros(64)
        x[::8] = 1
        f, p = welch(x, nperseg=16, noverlap=4)
        q = np.array([0, 1./12., 1./3., 1./5., 1./3., 1./5., 1./3., 1./5.,
                      1./6.])
        assert_allclose(p, q, atol=1e-12)

    def test_bad_noverlap(self):
        assert_raises(ValueError, welch, np.zeros(4), 1, 'hann', 2, 7)

    def test_nfft_too_short(self):
        assert_raises(ValueError, welch, np.ones(12), nfft=3, nperseg=4)

    def test_real_onesided_even_32(self):
        x = np.zeros(16, 'f')
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=8)
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([0.08333333, 0.15277778, 0.22222222, 0.22222222,
                      0.11111111], 'f')
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)
        assert_(p.dtype == q.dtype)

    def test_real_onesided_odd_32(self):
        x = np.zeros(16, 'f')
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=9)
        assert_allclose(f, np.arange(5.0)/9.0)
        q = np.array([0.12477458, 0.23430935, 0.17072113, 0.17072116,
                      0.17072113], 'f')
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)
        assert_(p.dtype == q.dtype)

    def test_real_twosided_32(self):
        x = np.zeros(16, 'f')
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.08333333, 0.07638889, 0.11111111,
                      0.11111111, 0.11111111, 0.11111111, 0.11111111,
                      0.07638889], 'f')
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)
        assert_(p.dtype == q.dtype)

    def test_complex_32(self):
        x = np.zeros(16, 'F')
        x[0] = 1.0 + 2.0j
        x[8] = 1.0 + 2.0j
        f, p = welch(x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.41666666, 0.38194442, 0.55555552, 0.55555552,
                      0.55555558, 0.55555552, 0.55555552, 0.38194442], 'f')
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)
        assert_(p.dtype == q.dtype,
                f'dtype mismatch, {p.dtype}, {q.dtype}')

    def test_padded_freqs(self):
        x = np.zeros(12)

        nfft = 24
        f = fftfreq(nfft, 1.0)[:nfft//2+1]
        f[-1] *= -1
        fodd, _ = welch(x, nperseg=5, nfft=nfft)
        feven, _ = welch(x, nperseg=6, nfft=nfft)
        assert_allclose(f, fodd)
        assert_allclose(f, feven)

        nfft = 25
        f = fftfreq(nfft, 1.0)[:(nfft + 1)//2]
        fodd, _ = welch(x, nperseg=5, nfft=nfft)
        feven, _ = welch(x, nperseg=6, nfft=nfft)
        assert_allclose(f, fodd)
        assert_allclose(f, feven)

    def test_window_correction(self):
        A = 20
        fs = 1e4
        nperseg = int(fs//10)
        fsig = 300
        ii = int(fsig*nperseg//fs)  # Freq index of fsig

        tt = np.arange(fs)/fs
        x = A*np.sin(2*np.pi*fsig*tt)

        for window in ['hann', 'bartlett', ('tukey', 0.1), 'flattop']:
            _, p_spec = welch(x, fs=fs, nperseg=nperseg, window=window,
                              scaling='spectrum')
            freq, p_dens = welch(x, fs=fs, nperseg=nperseg, window=window,
                                 scaling='density')

            # Check peak height at signal frequency for 'spectrum'
            assert_allclose(p_spec[ii], A**2/2.0)
            # Check integrated spectrum RMS for 'density'
            assert_allclose(np.sqrt(trapezoid(p_dens, freq)), A*np.sqrt(2)/2,
                            rtol=1e-3)

    def test_axis_rolling(self):
        np.random.seed(1234)

        x_flat = np.random.randn(1024)
        _, p_flat = welch(x_flat)

        for a in range(3):
            newshape = [1,]*3
            newshape[a] = -1
            x = x_flat.reshape(newshape)

            _, p_plus = welch(x, axis=a)  # Positive axis index
            _, p_minus = welch(x, axis=a-x.ndim)  # Negative axis index

            assert_equal(p_flat, p_plus.squeeze(), err_msg=a)
            assert_equal(p_flat, p_minus.squeeze(), err_msg=a-x.ndim)

    def test_average(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = welch(x, nperseg=8, average='median')
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([.1, .05, 0., 1.54074396e-33, 0.])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

        assert_raises(ValueError, welch, x, nperseg=8,
                      average='unrecognised-average')

    def test_ratio_scale_to(self):
        """Verify the factor of ``sum(abs(window)**2)*fs / abs(sum(window))**2``
        used in the `welch`  and `csd` docstrs. """
        x, win, fs = np.array([1., 0, 0, 0]), np.ones(4), 12
        params = dict(fs=fs, window=win, return_onesided=False, detrend=None)
        p_dens = welch(x, scaling='density', **params)[1]
        p_spec = welch(x, scaling='spectrum', **params)[1]
        p_fac = sum(win**2)*fs / abs(sum(win))**2
        assert_allclose(p_spec / p_dens, p_fac)

class TestCSD:
    def test_pad_shorter_x(self):
        x = np.zeros(8)
        y = np.zeros(12)

        f = np.linspace(0, 0.5, 7)
        c = np.zeros(7,dtype=np.complex128)
        f1, c1 = csd(x, y, nperseg=12)

        assert_allclose(f, f1)
        assert_allclose(c, c1)

    def test_pad_shorter_y(self):
        x = np.zeros(12)
        y = np.zeros(8)

        f = np.linspace(0, 0.5, 7)
        c = np.zeros(7,dtype=np.complex128)
        f1, c1 = csd(x, y, nperseg=12)

        assert_allclose(f, f1)
        assert_allclose(c, c1)

    def test_unequal_length_input_1D(self):
        """Test zero-padding for input `x.shape[axis] != y.shape[axis]` for 1d arrays.

        This test ensures that issue 23036 is fixed.
        """
        x = np.tile([4, 0, -4, 0], 4)

        kw = dict(fs=len(x), window='boxcar', nperseg=4)
        X0 = signal.csd(x, np.copy(x), **kw)[1]  # `x is x` must be False
        X1 = signal.csd(x, x[:8], **kw)[1]
        X2 = signal.csd(x[:8], x, **kw)[1]
        xp_assert_close(X1, X0 / 2)
        xp_assert_close(X2, X0 / 2)

    def test_unequal_length_input_3D(self):
        """Test zero-padding for input `x.shape[axis] != y.shape[axis]` for 3d arrays.

        This test ensures that issue 23036 is fixed.
        """
        n = 8
        x = np.zeros(2 * 3 * n).reshape(2, n, 3)
        x[:, 0, :] = n

        kw = dict(fs=n, window='boxcar', nperseg=n, detrend=None, axis=1)
        X0 = signal.csd(x, x.copy(), **kw)[1]  # `x is x` must be False
        X1 = signal.csd(x, x[:, :2, :], **kw)[1]
        X2 = signal.csd(x[:, :2, :], x, **kw)[1]
        xp_assert_close(X1, X0)
        xp_assert_close(X2, X0)

    def test_real_onesided_even(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=8)
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([0.08333333, 0.15277778, 0.22222222, 0.22222222,
                      0.11111111])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_real_onesided_odd(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=9)
        assert_allclose(f, np.arange(5.0)/9.0)
        q = np.array([0.12477455, 0.23430933, 0.17072113, 0.17072113,
                      0.17072113])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_real_twosided(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.08333333, 0.07638889, 0.11111111, 0.11111111,
                      0.11111111, 0.11111111, 0.11111111, 0.07638889])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_real_spectrum(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=8, scaling='spectrum')
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([0.015625, 0.02864583, 0.04166667, 0.04166667,
                      0.02083333])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_integer_onesided_even(self):
        x = np.zeros(16, dtype=int)
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=8)
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([0.08333333, 0.15277778, 0.22222222, 0.22222222,
                      0.11111111])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_integer_onesided_odd(self):
        x = np.zeros(16, dtype=int)
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=9)
        assert_allclose(f, np.arange(5.0)/9.0)
        q = np.array([0.12477455, 0.23430933, 0.17072113, 0.17072113,
                      0.17072113])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_integer_twosided(self):
        x = np.zeros(16, dtype=int)
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.08333333, 0.07638889, 0.11111111, 0.11111111,
                      0.11111111, 0.11111111, 0.11111111, 0.07638889])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_complex(self):
        x = np.zeros(16, np.complex128)
        x[0] = 1.0 + 2.0j
        x[8] = 1.0 + 2.0j
        f, p = csd(x, x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.41666667, 0.38194444, 0.55555556, 0.55555556,
                      0.55555556, 0.55555556, 0.55555556, 0.38194444])
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)

    def test_unk_scaling(self):
        assert_raises(ValueError, csd, np.zeros(4, np.complex128),
                      np.ones(4, np.complex128), scaling='foo', nperseg=4)

    def test_detrend_linear(self):
        x = np.arange(10, dtype=np.float64) + 0.04
        f, p = csd(x, x, nperseg=10, detrend='linear')
        assert_allclose(p, np.zeros_like(p), atol=1e-15)

    def test_no_detrending(self):
        x = np.arange(10, dtype=np.float64) + 0.04
        f1, p1 = csd(x, x, nperseg=10, detrend=False)
        f2, p2 = csd(x, x, nperseg=10, detrend=lambda x: x)
        assert_allclose(f1, f2, atol=1e-15)
        assert_allclose(p1, p2, atol=1e-15)

    def test_detrend_external(self):
        x = np.arange(10, dtype=np.float64) + 0.04
        f, p = csd(x, x, nperseg=10,
                   detrend=lambda seg: signal.detrend(seg, type='l'))
        assert_allclose(p, np.zeros_like(p), atol=1e-15)

    def test_detrend_external_nd_m1(self):
        x = np.arange(40, dtype=np.float64) + 0.04
        x = x.reshape((2,2,10))
        f, p = csd(x, x, nperseg=10,
                   detrend=lambda seg: signal.detrend(seg, type='l'))
        assert_allclose(p, np.zeros_like(p), atol=1e-15)

    def test_detrend_external_nd_0(self):
        x = np.arange(20, dtype=np.float64) + 0.04
        x = x.reshape((2,1,10))
        x = np.moveaxis(x, 2, 0)
        f, p = csd(x, x, nperseg=10, axis=0,
                   detrend=lambda seg: signal.detrend(seg, axis=0, type='l'))
        assert_allclose(p, np.zeros_like(p), atol=1e-15)

    def test_nd_axis_m1(self):
        x = np.arange(20, dtype=np.float64) + 0.04
        x = x.reshape((2,1,10))
        f, p = csd(x, x, nperseg=10)
        assert_array_equal(p.shape, (2, 1, 6))
        assert_allclose(p[0,0,:], p[1,0,:], atol=1e-13, rtol=1e-13)
        f0, p0 = csd(x[0,0,:], x[0,0,:], nperseg=10)
        assert_allclose(p0[np.newaxis,:], p[1,:], atol=1e-13, rtol=1e-13)

    def test_nd_axis_0(self):
        x = np.arange(20, dtype=np.float64) + 0.04
        x = x.reshape((10,2,1))
        f, p = csd(x, x, nperseg=10, axis=0)
        assert_array_equal(p.shape, (6,2,1))
        assert_allclose(p[:,0,0], p[:,1,0], atol=1e-13, rtol=1e-13)
        f0, p0 = csd(x[:,0,0], x[:,0,0], nperseg=10)
        assert_allclose(p0, p[:,1,0], atol=1e-13, rtol=1e-13)

    def test_window_external(self):
        x = np.zeros(16)
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, 10, 'hann', 8)
        win = signal.get_window('hann', 8)
        fe, pe = csd(x, x, 10, win, nperseg=None)
        assert_array_almost_equal_nulp(p, pe)
        assert_array_almost_equal_nulp(f, fe)
        assert_array_equal(fe.shape, (5,))  # because win length used as nperseg
        assert_array_equal(pe.shape, (5,))
        assert_raises(ValueError, csd, x, x,
                      10, win, nperseg=256)  # because nperseg != win.shape[-1]
        win_err = signal.get_window('hann', 32)
        assert_raises(ValueError, csd, x, x,
              10, win_err, nperseg=None)  # because win longer than signal
        with pytest.raises(ValueError, match="Parameter nperseg=0.*"):
            csd(x, x, 0, nperseg=0)

    def test_empty_input(self):
        f, p = csd([],np.zeros(10))
        assert_array_equal(f.shape, (0,))
        assert_array_equal(p.shape, (0,))

        f, p = csd(np.zeros(10),[])
        assert_array_equal(f.shape, (0,))
        assert_array_equal(p.shape, (0,))

        for shape in [(0,), (3,0), (0,5,2)]:
            f, p = csd(np.empty(shape), np.empty(shape))
            assert_array_equal(f.shape, shape)
            assert_array_equal(p.shape, shape)

        f, p = csd(np.ones(10), np.empty((5,0)))
        assert_array_equal(f.shape, (5,0))
        assert_array_equal(p.shape, (5,0))

        f, p = csd(np.empty((5,0)), np.ones(10))
        assert_array_equal(f.shape, (5,0))
        assert_array_equal(p.shape, (5,0))

    def test_empty_input_other_axis(self):
        for shape in [(3,0), (0,5,2)]:
            f, p = csd(np.empty(shape), np.empty(shape), axis=1)
            assert_array_equal(f.shape, shape)
            assert_array_equal(p.shape, shape)

        f, p = csd(np.empty((10,10,3)), np.zeros((10,0,1)), axis=1)
        assert_array_equal(f.shape, (10,0,3))
        assert_array_equal(p.shape, (10,0,3))

        f, p = csd(np.empty((10,0,1)), np.zeros((10,10,3)), axis=1)
        assert_array_equal(f.shape, (10,0,3))
        assert_array_equal(p.shape, (10,0,3))

    def test_short_data(self):
        x = np.zeros(8)
        x[0] = 1

        #for string-like window, input signal length < nperseg value gives
        #UserWarning, sets nperseg to x.shape[-1]
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "nperseg=256 is greater than signal length.*")
            f, p = csd(x, x, window='hann')  # default nperseg
            f1, p1 = csd(x, x, window='hann', nperseg=256)  # user-specified nperseg
        f2, p2 = csd(x, x, nperseg=8)  # valid nperseg, doesn't give warning
        assert_allclose(f, f2)
        assert_allclose(p, p2)
        assert_allclose(f1, f2)
        assert_allclose(p1, p2)

    def test_window_long_or_nd(self):
        assert_raises(ValueError, csd, np.zeros(4), np.ones(4), 1,
                      np.array([1,1,1,1,1]))
        assert_raises(ValueError, csd, np.zeros(4), np.ones(4), 1,
                      np.arange(6).reshape((2,3)))

    def test_nondefault_noverlap(self):
        x = np.zeros(64)
        x[::8] = 1
        f, p = csd(x, x, nperseg=16, noverlap=4)
        q = np.array([0, 1./12., 1./3., 1./5., 1./3., 1./5., 1./3., 1./5.,
                      1./6.])
        assert_allclose(p, q, atol=1e-12)

    def test_bad_noverlap(self):
        assert_raises(ValueError, csd, np.zeros(4), np.ones(4), 1, 'hann',
                      2, 7)

    def test_nfft_too_short(self):
        assert_raises(ValueError, csd, np.ones(12), np.zeros(12), nfft=3,
                      nperseg=4)

    def test_incompatible_inputs(self):
        with pytest.raises(ValueError, match='x and y cannot be broadcast.*'):
            csd(np.ones((1, 8, 1)), np.ones((2, 8)), nperseg=4)


    def test_real_onesided_even_32(self):
        x = np.zeros(16, 'f')
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=8)
        assert_allclose(f, np.linspace(0, 0.5, 5))
        q = np.array([0.08333333, 0.15277778, 0.22222222, 0.22222222,
                      0.11111111], 'f')
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)
        assert_(p.dtype == q.dtype)

    def test_real_onesided_odd_32(self):
        x = np.zeros(16, 'f')
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=9)
        assert_allclose(f, np.arange(5.0)/9.0)
        q = np.array([0.12477458, 0.23430935, 0.17072113, 0.17072116,
                      0.17072113], 'f')
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)
        assert_(p.dtype == q.dtype)

    def test_real_twosided_32(self):
        x = np.zeros(16, 'f')
        x[0] = 1
        x[8] = 1
        f, p = csd(x, x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.08333333, 0.07638889, 0.11111111,
                      0.11111111, 0.11111111, 0.11111111, 0.11111111,
                      0.07638889], 'f')
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)
        assert_(p.dtype == q.dtype)

    def test_complex_32(self):
        x = np.zeros(16, 'F')
        x[0] = 1.0 + 2.0j
        x[8] = 1.0 + 2.0j
        f, p = csd(x, x, nperseg=8, return_onesided=False)
        assert_allclose(f, fftfreq(8, 1.0))
        q = np.array([0.41666666, 0.38194442, 0.55555552, 0.55555552,
                      0.55555558, 0.55555552, 0.55555552, 0.38194442], 'f')
        assert_allclose(p, q, atol=1e-7, rtol=1e-7)
        assert_(p.dtype == q.dtype,
                f'dtype mismatch, {p.dtype}, {q.dtype}')

    def test_padded_freqs(self):
        x = np.zeros(12)
        y = np.ones(12)

        nfft = 24
        f = fftfreq(nfft, 1.0)[:nfft//2+1]
        f[-1] *= -1
        fodd, _ = csd(x, y, nperseg=5, nfft=nfft)
        feven, _ = csd(x, y, nperseg=6, nfft=nfft)
        assert_allclose(f, fodd)
        assert_allclose(f, feven)

        nfft = 25
        f = fftfreq(nfft, 1.0)[:(nfft + 1)//2]
        fodd, _ = csd(x, y, nperseg=5, nfft=nfft)
        feven, _ = csd(x, y, nperseg=6, nfft=nfft)
        assert_allclose(f, fodd)
        assert_allclose(f, feven)

    def test_copied_data(self):
        x = np.random.randn(64)
        y = x.copy()

        _, p_same = csd(x, x, nperseg=8, average='mean',
                        return_onesided=False)
        _, p_copied = csd(x, y, nperseg=8, average='mean',
                          return_onesided=False)
        assert_allclose(p_same, p_copied)

        _, p_same = csd(x, x, nperseg=8, average='median',
                        return_onesided=False)
        _, p_copied = csd(x, y, nperseg=8, average='median',
                          return_onesided=False)
        assert_allclose(p_same, p_copied)


class TestCoherence:
    def test_identical_input(self):
        x = np.random.randn(20)
        y = np.copy(x)  # So `y is x` -> False

        f = np.linspace(0, 0.5, 6)
        C = np.ones(6)
        f1, C1 = coherence(x, y, nperseg=10)

        assert_allclose(f, f1)
        assert_allclose(C, C1)

    def test_phase_shifted_input(self):
        x = np.random.randn(20)
        y = -x

        f = np.linspace(0, 0.5, 6)
        C = np.ones(6)
        f1, C1 = coherence(x, y, nperseg=10)

        assert_allclose(f, f1)
        assert_allclose(C, C1)


class TestSpectrogram:
    def test_average_all_segments(self):
        x = np.random.randn(1024)

        fs = 1.0
        window = ('tukey', 0.25)
        nperseg = 16
        noverlap = 2

        f, _, P = spectrogram(x, fs, window, nperseg, noverlap)
        fw, Pw = welch(x, fs, window, nperseg, noverlap)
        assert_allclose(f, fw)
        assert_allclose(np.mean(P, axis=-1), Pw)

    def test_window_external(self):
        x = np.random.randn(1024)

        fs = 1.0
        window = ('tukey', 0.25)
        nperseg = 16
        noverlap = 2
        f, _, P = spectrogram(x, fs, window, nperseg, noverlap)

        win = signal.get_window(('tukey', 0.25), 16)
        fe, _, Pe = spectrogram(x, fs, win, nperseg=None, noverlap=2)
        assert_array_equal(fe.shape, (9,))  # because win length used as nperseg
        assert_array_equal(Pe.shape, (9,73))
        assert_raises(ValueError, spectrogram, x,
                      fs, win, nperseg=8)  # because nperseg != win.shape[-1]
        win_err = signal.get_window(('tukey', 0.25), 2048)
        assert_raises(ValueError, spectrogram, x,
                      fs, win_err, nperseg=None)  # win longer than signal

    def test_short_data(self):
        x = np.random.randn(1024)
        fs = 1.0

        #for string-like window, input signal length < nperseg value gives
        #UserWarning, sets nperseg to x.shape[-1]
        f, _, p = spectrogram(x, fs, window=('tukey',0.25))  # default nperseg
        with suppress_warnings() as sup:
            sup.filter(UserWarning,
                       "nperseg = 1025 is greater than input length  = 1024, "
                       "using nperseg = 1024",)
            f1, _, p1 = spectrogram(x, fs, window=('tukey',0.25),
                                    nperseg=1025)  # user-specified nperseg
        f2, _, p2 = spectrogram(x, fs, nperseg=256)  # to compare w/default
        f3, _, p3 = spectrogram(x, fs, nperseg=1024)  # compare w/user-spec'd
        assert_allclose(f, f2)
        assert_allclose(p, p2)
        assert_allclose(f1, f3)
        assert_allclose(p1, p3)

class TestLombscargle:
    def test_frequency(self):
        """Test if frequency location of peak corresponds to frequency of
        generated input signal.
        """

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0.5 * np.pi
        nin = 100
        nout = 1000
        p = 0.7  # Fraction of points to select

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a sine wave for the selected times
        y = ampl * np.sin(w*t + phi)

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0.01, 10., nout)

        # Calculate Lomb-Scargle periodogram
        P = lombscargle(t, y, f)

        # Check if difference between found frequency maximum and input
        # frequency is less than accuracy
        delta = f[1] - f[0]
        assert(w - f[np.argmax(P)] < (delta/2.))

        # also, check that it works with weights
        P = lombscargle(t, y, f, weights=np.ones_like(t, dtype=f.dtype))

        # Check if difference between found frequency maximum and input
        # frequency is less than accuracy
        delta = f[1] - f[0]
        assert(w - f[np.argmax(P)] < (delta/2.))


    def test_amplitude(self):
        # Test if height of peak in unnormalized Lomb-Scargle periodogram
        # corresponds to amplitude of the generated input signal.

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0.5 * np.pi
        nin = 1000
        nout = 1000
        p = 0.7  # Fraction of points to select

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a sine wave for the selected times
        y = ampl * np.sin(w*t + phi)

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0.01, 10., nout)

        # Calculate Lomb-Scargle periodogram
        pgram = lombscargle(t, y, f)

        # convert to the amplitude
        pgram = np.sqrt(4.0 * pgram / t.shape[0])

        # Check if amplitude is correct (this will not exactly match, due to
        # numerical differences when data is removed)
        assert_allclose(pgram[f==w], ampl, rtol=5e-2)

    def test_precenter(self):
        # Test if precenter gives the same result as manually precentering
        # (for a very simple offset)

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0.5 * np.pi
        nin = 100
        nout = 1000
        p = 0.7  # Fraction of points to select
        offset = 0.15  # Offset to be subtracted in pre-centering

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a sine wave for the selected times
        y = ampl * np.sin(w*t + phi) + offset

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0.01, 10., nout)

        # Calculate Lomb-Scargle periodogram
        pgram = lombscargle(t, y, f, precenter=True)
        pgram2 = lombscargle(t, y - y.mean(), f, precenter=False)

        # check if centering worked
        assert_allclose(pgram, pgram2)

        # do this again, but with floating_mean=True

        # Calculate Lomb-Scargle periodogram
        pgram = lombscargle(t, y, f, precenter=True, floating_mean=True)
        pgram2 = lombscargle(t, y - y.mean(), f, precenter=False, floating_mean=True)

        # check if centering worked
        assert_allclose(pgram, pgram2)

    def test_normalize(self):
        # Test normalize option of Lomb-Scarge.

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0.5 * np.pi
        nin = 100
        nout = 1000
        p = 0.7  # Fraction of points to select

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a sine wave for the selected times
        y = ampl * np.sin(w*t + phi)

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0.01, 10., nout)

        # Calculate Lomb-Scargle periodogram
        pgram = lombscargle(t, y, f)
        pgram2 = lombscargle(t, y, f, normalize=True)

        # Calculate the scale to convert from unnormalized to normalized
        weights = np.ones_like(t)/float(t.shape[0])
        YY_hat = (weights * y * y).sum()
        YY = YY_hat  # correct formula for floating_mean=False
        scale_to_use = 2/(YY*t.shape[0])

        # check if normalization works as expected
        assert_allclose(pgram * scale_to_use, pgram2)
        assert_allclose(np.max(pgram2), 1.0)

    def test_wrong_shape(self):

        # different length t and y
        t = np.linspace(0, 1, 1)
        y = np.linspace(0, 1, 2)
        f = np.linspace(0, 1, 3) + 0.1
        assert_raises(ValueError, lombscargle, t, y, f)

        # t is 2D, with both axes length > 1
        t = np.repeat(np.expand_dims(np.linspace(0, 1, 2), 1), 2, axis=1)
        y = np.linspace(0, 1, 2)
        f = np.linspace(0, 1, 3) + 0.1
        assert_raises(ValueError, lombscargle, t, y, f)

        # y is 2D, with both axes length > 1
        t = np.linspace(0, 1, 2)
        y = np.repeat(np.expand_dims(np.linspace(0, 1, 2), 1), 2, axis=1)
        f = np.linspace(0, 1, 3) + 0.1
        assert_raises(ValueError, lombscargle, t, y, f)

        # f is 2D, with both axes length > 1
        t = np.linspace(0, 1, 2)
        y = np.linspace(0, 1, 2)
        f = np.repeat(np.expand_dims(np.linspace(0, 1, 3), 1) + 0.1, 2, axis=1)
        assert_raises(ValueError, lombscargle, t, y, f)

        # weights is 2D, with both axes length > 1
        t = np.linspace(0, 1, 2)
        y = np.linspace(0, 1, 2)
        f = np.linspace(0, 1, 3) + 0.1
        weights = np.repeat(np.expand_dims(np.linspace(0, 1, 2), 1), 2, axis=1)
        assert_raises(ValueError, lombscargle, t, y, f, weights=weights)

    def test_lombscargle_atan_vs_atan2(self):
        # https://github.com/scipy/scipy/issues/3787
        # This raised a ZeroDivisionError.
        t = np.linspace(0, 10, 1000, endpoint=False)
        y = np.sin(4*t)
        f = np.linspace(0, 50, 500, endpoint=False) + 0.1
        lombscargle(t, y, f*2*np.pi)

    def test_wrong_shape_weights(self):
        # Weights must be the same shape as t

        t = np.linspace(0, 1, 1)
        y = np.linspace(0, 1, 1)
        f = np.linspace(0, 1, 3) + 0.1
        weights = np.linspace(1, 2, 2)
        assert_raises(ValueError, lombscargle, t, y, f, weights=weights)

    def test_zero_division_weights(self):
        # Weights cannot sum to 0

        t = np.zeros(1)
        y = np.zeros(1)
        f = np.ones(1)
        weights = np.zeros(1)
        assert_raises(ValueError, lombscargle, t, y, f, weights=weights)

    def test_normalize_parameter(self):
        # Test the validity of the normalize parameter input

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0
        nin = 100
        nout = 1000
        p = 0.7  # Fraction of points to select

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a sine wave for the selected times
        y = ampl * np.sin(w*t + phi)

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0.01, 10., nout)

        # check each of the valid inputs
        pgram_false = lombscargle(t, y, f, normalize=False)
        pgram_true = lombscargle(t, y, f, normalize=True)
        pgram_power = lombscargle(t, y, f, normalize='power')
        pgram_norm = lombscargle(t, y, f, normalize='normalize')
        pgram_amp = lombscargle(t, y, f, normalize='amplitude')

        # validate the results that should be the same
        assert_allclose(pgram_false, pgram_power)
        assert_allclose(pgram_true, pgram_norm)

        # validate that the power and norm outputs are proper wrt each other
        weights = np.ones_like(y)/float(y.shape[0])
        YY_hat = (weights * y * y).sum()
        YY = YY_hat  # correct formula for floating_mean=False
        assert_allclose(pgram_power * 2.0 / (float(t.shape[0]) * YY), pgram_norm)

        # validate that the amp output is correct for the given input
        f_i = np.where(f==w)[0][0]
        assert_allclose(np.abs(pgram_amp[f_i]), ampl)

        # check invalid inputs
        #  1) a string that is not allowed
        assert_raises(ValueError, lombscargle, t, y, f, normalize='lomb')
        #  2) something besides a bool or str
        assert_raises(ValueError, lombscargle, t, y, f, normalize=2)

    def test_offset_removal(self):
        # Verify that the amplitude is the same, even with an offset
        # must use floating_mean=True, otherwise it will not remove an offset

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0.5 * np.pi
        nin = 100
        nout = 1000
        p = 0.7  # Fraction of points to select
        offset = 2.15  # Large offset

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a sine wave for the selected times
        y = ampl * np.sin(w*t + phi)

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0.01, 10., nout)

        # Calculate Lomb-Scargle periodogram
        pgram = lombscargle(t, y, f, floating_mean=True)
        pgram_offset = lombscargle(t, y + offset, f, floating_mean=True)

        # check if offset removal works as expected
        assert_allclose(pgram, pgram_offset)

    def test_floating_mean_false(self):
        # Verify that when disabling the floating_mean, the calculations are correct

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0
        nin = 1000
        nout = 1000
        p = 0.7  # Fraction of points to select
        offset = 2  # Large offset

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a cos wave for the selected times
        y = ampl * np.cos(w*t + phi)

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0.01, 10., nout)

        # Calculate Lomb-Scargle periodogram
        pgram = lombscargle(t, y, f, normalize=True, floating_mean=False)
        pgram_offset = lombscargle(t, y + offset, f, normalize=True,
                                   floating_mean=False)

        # check if disabling floating_mean works as expected
        # nearly-zero for no offset, exact value will change based on seed
        assert(pgram[0] < 0.01)
        # significant value with offset, exact value will change based on seed
        assert(pgram_offset[0] > 0.5)

    def test_amplitude_is_correct(self):
        # Verify that the amplitude is correct (when normalize='amplitude')

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0.12
        nin = 100
        nout = 1000
        p = 0.7  # Fraction of points to select
        offset = 2.15  # Large offset

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a sine wave for the selected times
        y = ampl * np.cos(w*t + phi) + offset

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0.01, 10., nout)

        # Get the index of where the exact result should be
        f_indx = np.where(f==w)[0][0]

        # Calculate Lomb-Scargle periodogram (amplitude + phase)
        pgram = lombscargle(t, y, f, normalize='amplitude', floating_mean=True)

        # Check if amplitude is correct
        assert_allclose(np.abs(pgram[f_indx]), ampl)

        # Check if phase is correct
        # (phase angle is the negative of the phase offset)
        assert_allclose(-np.angle(pgram[f_indx]), phi)

    def test_negative_weight(self):
        # Test that a negative weight produces an error

        t = np.zeros(1)
        y = np.zeros(1)
        f = np.ones(1)
        weights = -np.ones(1)
        assert_raises(ValueError, lombscargle, t, y, f, weights=weights)

    def test_list_input(self):
        # Test that input can be passsed in as lists and with a numerical issue
        # https://github.com/scipy/scipy/issues/8787

        t = [1.98201652e+09, 1.98201752e+09, 1.98201852e+09, 1.98201952e+09,
            1.98202052e+09, 1.98202152e+09, 1.98202252e+09, 1.98202352e+09,
            1.98202452e+09, 1.98202552e+09, 1.98202652e+09, 1.98202752e+09,
            1.98202852e+09, 1.98202952e+09, 1.98203052e+09, 1.98203152e+09,
            1.98203252e+09, 1.98203352e+09, 1.98203452e+09, 1.98203552e+09,
            1.98205452e+09, 1.98205552e+09, 1.98205652e+09, 1.98205752e+09,
            1.98205852e+09, 1.98205952e+09, 1.98206052e+09, 1.98206152e+09,
            1.98206252e+09, 1.98206352e+09, 1.98206452e+09, 1.98206552e+09,
            1.98206652e+09, 1.98206752e+09, 1.98206852e+09, 1.98206952e+09,
            1.98207052e+09, 1.98207152e+09, 1.98207252e+09, 1.98207352e+09,
            1.98209652e+09, 1.98209752e+09, 1.98209852e+09, 1.98209952e+09,
            1.98210052e+09, 1.98210152e+09, 1.98210252e+09, 1.98210352e+09,
            1.98210452e+09, 1.98210552e+09, 1.98210652e+09, 1.98210752e+09,
            1.98210852e+09, 1.98210952e+09, 1.98211052e+09, 1.98211152e+09,
            1.98211252e+09, 1.98211352e+09, 1.98211452e+09, 1.98211552e+09,
            1.98217252e+09, 1.98217352e+09, 1.98217452e+09, 1.98217552e+09,
            1.98217652e+09, 1.98217752e+09, 1.98217852e+09, 1.98217952e+09,
            1.98218052e+09, 1.98218152e+09, 1.98218252e+09, 1.98218352e+09,
            1.98218452e+09, 1.98218552e+09, 1.98218652e+09, 1.98218752e+09,
            1.98218852e+09, 1.98218952e+09, 1.98219052e+09, 1.98219152e+09,
            1.98219352e+09, 1.98219452e+09, 1.98219552e+09, 1.98219652e+09,
            1.98219752e+09, 1.98219852e+09, 1.98219952e+09, 1.98220052e+09,
            1.98220152e+09, 1.98220252e+09, 1.98220352e+09, 1.98220452e+09,
            1.98220552e+09, 1.98220652e+09, 1.98220752e+09, 1.98220852e+09,
            1.98220952e+09, 1.98221052e+09, 1.98221152e+09, 1.98221252e+09,
            1.98222752e+09, 1.98222852e+09, 1.98222952e+09, 1.98223052e+09,
            1.98223152e+09, 1.98223252e+09, 1.98223352e+09, 1.98223452e+09,
            1.98223552e+09, 1.98223652e+09, 1.98223752e+09, 1.98223852e+09,
            1.98223952e+09, 1.98224052e+09, 1.98224152e+09, 1.98224252e+09,
            1.98224352e+09, 1.98224452e+09, 1.98224552e+09, 1.98224652e+09,
            1.98224752e+09]
        y = [2.97600000e+03, 3.18200000e+03, 3.74900000e+03, 4.53500000e+03,
            5.43300000e+03, 6.38000000e+03, 7.34000000e+03, 8.29200000e+03,
            9.21900000e+03, 1.01120000e+04, 1.09620000e+04, 1.17600000e+04,
            1.25010000e+04, 1.31790000e+04, 1.37900000e+04, 1.43290000e+04,
            1.47940000e+04, 1.51800000e+04, 1.54870000e+04, 1.57110000e+04,
            5.74200000e+03, 4.82300000e+03, 3.99100000e+03, 3.33600000e+03,
            2.99600000e+03, 3.08400000e+03, 3.56700000e+03, 4.30700000e+03,
            5.18200000e+03, 6.11900000e+03, 7.07900000e+03, 8.03400000e+03,
            8.97000000e+03, 9.87300000e+03, 1.07350000e+04, 1.15480000e+04,
            1.23050000e+04, 1.30010000e+04, 1.36300000e+04, 1.41890000e+04,
            6.00000000e+03, 5.06800000e+03, 4.20500000e+03, 3.49000000e+03,
            3.04900000e+03, 3.01600000e+03, 3.40400000e+03, 4.08800000e+03,
            4.93500000e+03, 5.86000000e+03, 6.81700000e+03, 7.77500000e+03,
            8.71800000e+03, 9.63100000e+03, 1.05050000e+04, 1.13320000e+04,
            1.21050000e+04, 1.28170000e+04, 1.34660000e+04, 1.40440000e+04,
            1.32730000e+04, 1.26040000e+04, 1.18720000e+04, 1.10820000e+04,
            1.02400000e+04, 9.35300000e+03, 8.43000000e+03, 7.48100000e+03,
            6.52100000e+03, 5.57000000e+03, 4.66200000e+03, 3.85400000e+03,
            3.24600000e+03, 2.97900000e+03, 3.14700000e+03, 3.68800000e+03,
            4.45900000e+03, 5.35000000e+03, 6.29400000e+03, 7.25400000e+03,
            9.13800000e+03, 1.00340000e+04, 1.08880000e+04, 1.16910000e+04,
            1.24370000e+04, 1.31210000e+04, 1.37380000e+04, 1.42840000e+04,
            1.47550000e+04, 1.51490000e+04, 1.54630000e+04, 1.56950000e+04,
            1.58430000e+04, 1.59070000e+04, 1.58860000e+04, 1.57800000e+04,
            1.55910000e+04, 1.53190000e+04, 1.49650000e+04, 1.45330000e+04,
            3.01000000e+03, 3.05900000e+03, 3.51200000e+03, 4.23400000e+03,
            5.10000000e+03, 6.03400000e+03, 6.99300000e+03, 7.95000000e+03,
            8.88800000e+03, 9.79400000e+03, 1.06600000e+04, 1.14770000e+04,
            1.22400000e+04, 1.29410000e+04, 1.35770000e+04, 1.41430000e+04,
            1.46350000e+04, 1.50500000e+04, 1.53850000e+04, 1.56400000e+04,
            1.58110000e+04]

        periods = np.linspace(400, 120, 1000)
        angular_freq = 2 * np.pi / periods

        lombscargle(t, y, angular_freq, precenter=True, normalize=True)

    def test_zero_freq(self):
        # Verify that function works when freqs includes 0
        # The value at f=0 will depend on the seed

        # Input parameters
        ampl = 2.
        w = 1.
        phi = 0.12
        nin = 100
        nout = 1001
        p = 0.7  # Fraction of points to select
        offset = 0

        # Randomly select a fraction of an array with timesteps
        rng = np.random.RandomState(2353425)
        r = rng.rand(nin)
        t = np.linspace(0.01*np.pi, 10.*np.pi, nin)[r >= p]

        # Plot a sine wave for the selected times
        y = ampl * np.cos(w*t + phi) + offset

        # Define the array of frequencies for which to compute the periodogram
        f = np.linspace(0, 10., nout)

        # Calculate Lomb-Scargle periodogram
        pgram = lombscargle(t, y, f, normalize=True, floating_mean=True)

        # exact value will change based on seed
        # testing to make sure it is very small
        assert(pgram[0] < 1e-4)

    def test_simple_div_zero(self):
        # these are bare-minimum examples that would, without the eps adjustments,
        # cause division-by-zero errors

        # first, test with example that will cause first SS sum to be 0.0
        t = [t + 1 for t in range(0, 32)]
        y = np.ones(len(t))
        freqs = [2.0*np.pi] * 2  # must have 2+ elements
        lombscargle(t, y, freqs)

        # second, test with example that will cause first CC sum to be 0.0
        t = [t*4 + 1 for t in range(0, 32)]
        y = np.ones(len(t))
        freqs = [np.pi/2.0] * 2  # must have 2+ elements

        lombscargle(t, y, freqs)


class TestSTFT:
    @pytest.mark.thread_unsafe
    def test_input_validation(self):

        def chk_VE(match):
            """Assert for a ValueError matching regexp `match`.

            This little wrapper allows a more concise code layout.
            """
            return pytest.raises(ValueError, match=match)

        # Checks for check_COLA():
        with chk_VE('nperseg must be a positive integer'):
            check_COLA('hann', -10, 0)
        with chk_VE('noverlap must be less than nperseg.'):
            check_COLA('hann', 10, 20)
        with chk_VE('window must be 1-D'):
            check_COLA(np.ones((2, 2)), 10, 0)
        with chk_VE('window must have length of nperseg'):
            check_COLA(np.ones(20), 10, 0)

        # Checks for check_NOLA():
        with chk_VE('nperseg must be a positive integer'):
            check_NOLA('hann', -10, 0)
        with chk_VE('noverlap must be less than nperseg'):
            check_NOLA('hann', 10, 20)
        with chk_VE('window must be 1-D'):
            check_NOLA(np.ones((2, 2)), 10, 0)
        with chk_VE('window must have length of nperseg'):
            check_NOLA(np.ones(20), 10, 0)
        with chk_VE('noverlap must be a nonnegative integer'):
            check_NOLA('hann', 64, -32)

        x = np.zeros(1024)
        z = stft(x)[2]

        # Checks for stft():
        with chk_VE('window must be 1-D'):
            stft(x, window=np.ones((2, 2)))
        with chk_VE('value specified for nperseg is different ' +
                    'from length of window'):
            stft(x, window=np.ones(10), nperseg=256)
        with chk_VE('nperseg must be a positive integer'):
            stft(x, nperseg=-256)
        with chk_VE('noverlap must be less than nperseg.'):
            stft(x, nperseg=256, noverlap=1024)
        with chk_VE('nfft must be greater than or equal to nperseg.'):
            stft(x, nperseg=256, nfft=8)

        # Checks for istft():
        with chk_VE('Input stft must be at least 2d!'):
            istft(x)
        with chk_VE('window must be 1-D'):
            istft(z, window=np.ones((2, 2)))
        with chk_VE('window must have length of 256'):
            istft(z, window=np.ones(10), nperseg=256)
        with chk_VE('nperseg must be a positive integer'):
            istft(z, nperseg=-256)
        with chk_VE('noverlap must be less than nperseg.'):
            istft(z, nperseg=256, noverlap=1024)
        with chk_VE('nfft must be greater than or equal to nperseg.'):
            istft(z, nperseg=256, nfft=8)
        with pytest.warns(UserWarning, match="NOLA condition failed, " +
                          "STFT may not be invertible"):
            istft(z, nperseg=256, noverlap=0, window='hann')
        with chk_VE('Must specify differing time and frequency axes!'):
            istft(z, time_axis=0, freq_axis=0)

        # Checks for _spectral_helper():
        with chk_VE("Unknown value for mode foo, must be one of: " +
                    r"\{'psd', 'stft'\}"):
            _spectral_helper(x, x, mode='foo')
        with chk_VE("x and y must be equal if mode is 'stft'"):
            _spectral_helper(x[:512], x[512:], mode='stft')
        with chk_VE("Unknown boundary option 'foo', must be one of: " +
                    r"\['even', 'odd', 'constant', 'zeros', None\]"):
            _spectral_helper(x, x, boundary='foo')

        scaling = "not_valid"
        with chk_VE(fr"Parameter {scaling=} not in \['spectrum', 'psd'\]!"):
            stft(x, scaling=scaling)
        with chk_VE(fr"Parameter {scaling=} not in \['spectrum', 'psd'\]!"):
            istft(z, scaling=scaling)

    def test_check_COLA(self):
        settings = [
                    ('boxcar', 10, 0),
                    ('boxcar', 10, 9),
                    ('bartlett', 51, 26),
                    ('hann', 256, 128),
                    ('hann', 256, 192),
                    ('blackman', 300, 200),
                    (('tukey', 0.5), 256, 64),
                    ('hann', 256, 255),
                    ]

        for setting in settings:
            msg = '{}, {}, {}'.format(*setting)
            assert_equal(True, check_COLA(*setting), err_msg=msg)

    def test_check_NOLA(self):
        settings_pass = [
                    ('boxcar', 10, 0),
                    ('boxcar', 10, 9),
                    ('boxcar', 10, 7),
                    ('bartlett', 51, 26),
                    ('bartlett', 51, 10),
                    ('hann', 256, 128),
                    ('hann', 256, 192),
                    ('hann', 256, 37),
                    ('blackman', 300, 200),
                    ('blackman', 300, 123),
                    (('tukey', 0.5), 256, 64),
                    (('tukey', 0.5), 256, 38),
                    ('hann', 256, 255),
                    ('hann', 256, 39),
                    ]
        for setting in settings_pass:
            msg = '{}, {}, {}'.format(*setting)
            assert_equal(True, check_NOLA(*setting), err_msg=msg)

        w_fail = np.ones(16)
        w_fail[::2] = 0
        settings_fail = [
                    (w_fail, len(w_fail), len(w_fail) // 2),
                    ('hann', 64, 0),
        ]
        for setting in settings_fail:
            msg = '{}, {}, {}'.format(*setting)
            assert_equal(False, check_NOLA(*setting), err_msg=msg)

    def test_average_all_segments(self):
        rng = np.random.RandomState(1234)
        x = rng.randn(1024)

        fs = 1.0
        window = 'hann'
        nperseg = 16
        noverlap = 8

        # Compare twosided, because onesided welch doubles non-DC terms to
        # account for power at negative frequencies. stft doesn't do this,
        # because it breaks invertibility.
        f, _, Z = stft(x, fs, window, nperseg, noverlap, padded=False,
                       return_onesided=False, boundary=None)
        fw, Pw = welch(x, fs, window, nperseg, noverlap, return_onesided=False,
                       scaling='spectrum', detrend=False)

        assert_allclose(f, fw)
        assert_allclose(np.mean(np.abs(Z)**2, axis=-1), Pw)

    def test_permute_axes(self):
        rng = np.random.RandomState(1234)
        x = rng.randn(1024)

        fs = 1.0
        window = 'hann'
        nperseg = 16
        noverlap = 8

        f1, t1, Z1 = stft(x, fs, window, nperseg, noverlap)
        f2, t2, Z2 = stft(x.reshape((-1, 1, 1)), fs, window, nperseg, noverlap,
                          axis=0)

        t3, x1 = istft(Z1, fs, window, nperseg, noverlap)
        t4, x2 = istft(Z2.T, fs, window, nperseg, noverlap, time_axis=0,
                       freq_axis=-1)

        assert_allclose(f1, f2)
        assert_allclose(t1, t2)
        assert_allclose(t3, t4)
        assert_allclose(Z1, Z2[:, 0, 0, :])
        assert_allclose(x1, x2[:, 0, 0])

    @pytest.mark.parametrize('scaling', ['spectrum', 'psd'])
    def test_roundtrip_real(self, scaling):
        rng = np.random.RandomState(1234)

        settings = [
                    ('boxcar', 100, 10, 0),           # Test no overlap
                    ('boxcar', 100, 10, 9),           # Test high overlap
                    ('bartlett', 101, 51, 26),        # Test odd nperseg
                    ('hann', 1024, 256, 128),         # Test defaults
                    (('tukey', 0.5), 1152, 256, 64),  # Test Tukey
                    ('hann', 1024, 256, 255),         # Test overlapped hann
                    ]

        for window, N, nperseg, noverlap in settings:
            t = np.arange(N)
            x = 10*rng.randn(t.size)

            _, _, zz = stft(x, nperseg=nperseg, noverlap=noverlap,
                            window=window, detrend=None, padded=False,
                            scaling=scaling)

            tr, xr = istft(zz, nperseg=nperseg, noverlap=noverlap,
                           window=window, scaling=scaling)

            msg = f'{window}, {noverlap}'
            assert_allclose(t, tr, err_msg=msg)
            assert_allclose(x, xr, err_msg=msg)

    @pytest.mark.thread_unsafe
    def test_roundtrip_not_nola(self):
        rng = np.random.RandomState(1234)

        w_fail = np.ones(16)
        w_fail[::2] = 0
        settings = [
                    (w_fail, 256, len(w_fail), len(w_fail) // 2),
                    ('hann', 256, 64, 0),
        ]

        for window, N, nperseg, noverlap in settings:
            msg = f'{window}, {N}, {nperseg}, {noverlap}'
            assert not check_NOLA(window, nperseg, noverlap), msg

            t = np.arange(N)
            x = 10 * rng.randn(t.size)

            _, _, zz = stft(x, nperseg=nperseg, noverlap=noverlap,
                            window=window, detrend=None, padded=True,
                            boundary='zeros')
            with pytest.warns(UserWarning, match='NOLA'):
                tr, xr = istft(zz, nperseg=nperseg, noverlap=noverlap,
                               window=window, boundary=True)

            assert np.allclose(t, tr[:len(t)]), msg
            assert not np.allclose(x, xr[:len(x)]), msg

    def test_roundtrip_nola_not_cola(self):
        rng = np.random.RandomState(1234)

        settings = [
                    ('boxcar', 100, 10, 3),           # NOLA True, COLA False
                    ('bartlett', 101, 51, 37),        # NOLA True, COLA False
                    ('hann', 1024, 256, 127),         # NOLA True, COLA False
                    (('tukey', 0.5), 1152, 256, 14),  # NOLA True, COLA False
                    ('hann', 1024, 256, 5),           # NOLA True, COLA False
                    ]

        for window, N, nperseg, noverlap in settings:
            msg = f'{window}, {nperseg}, {noverlap}'
            assert check_NOLA(window, nperseg, noverlap), msg
            assert not check_COLA(window, nperseg, noverlap), msg

            t = np.arange(N)
            x = 10 * rng.randn(t.size)

            _, _, zz = stft(x, nperseg=nperseg, noverlap=noverlap,
                            window=window, detrend=None, padded=True,
                            boundary='zeros')

            tr, xr = istft(zz, nperseg=nperseg, noverlap=noverlap,
                           window=window, boundary=True)

            msg = f'{window}, {noverlap}'
            assert_allclose(t, tr[:len(t)], err_msg=msg)
            assert_allclose(x, xr[:len(x)], err_msg=msg)

    def test_roundtrip_float32(self):
        rng = np.random.RandomState(1234)

        settings = [('hann', 1024, 256, 128)]

        for window, N, nperseg, noverlap in settings:
            t = np.arange(N)
            x = 10*rng.randn(t.size)
            x = x.astype(np.float32)

            _, _, zz = stft(x, nperseg=nperseg, noverlap=noverlap,
                            window=window, detrend=None, padded=False)

            tr, xr = istft(zz, nperseg=nperseg, noverlap=noverlap,
                           window=window)

            msg = f'{window}, {noverlap}'
            assert_allclose(t, t, err_msg=msg)
            assert_allclose(x, xr, err_msg=msg, rtol=1e-4, atol=1e-5)
            assert_(x.dtype == xr.dtype)

    @pytest.mark.thread_unsafe
    @pytest.mark.parametrize('scaling', ['spectrum', 'psd'])
    def test_roundtrip_complex(self, scaling):
        rng = np.random.RandomState(1234)

        settings = [
                    ('boxcar', 100, 10, 0),           # Test no overlap
                    ('boxcar', 100, 10, 9),           # Test high overlap
                    ('bartlett', 101, 51, 26),        # Test odd nperseg
                    ('hann', 1024, 256, 128),         # Test defaults
                    (('tukey', 0.5), 1152, 256, 64),  # Test Tukey
                    ('hann', 1024, 256, 255),         # Test overlapped hann
                    ]

        for window, N, nperseg, noverlap in settings:
            t = np.arange(N)
            x = 10*rng.randn(t.size) + 10j*rng.randn(t.size)

            _, _, zz = stft(x, nperseg=nperseg, noverlap=noverlap,
                            window=window, detrend=None, padded=False,
                            return_onesided=False, scaling=scaling)

            tr, xr = istft(zz, nperseg=nperseg, noverlap=noverlap,
                           window=window, input_onesided=False,
                           scaling=scaling)

            msg = f'{window}, {nperseg}, {noverlap}'
            assert_allclose(t, tr, err_msg=msg)
            assert_allclose(x, xr, err_msg=msg)

        # Check that asking for onesided switches to twosided
        with suppress_warnings() as sup:
            sup.filter(UserWarning,
                       "Input data is complex, switching to return_onesided=False")
            _, _, zz = stft(x, nperseg=nperseg, noverlap=noverlap,
                            window=window, detrend=None, padded=False,
                            return_onesided=True, scaling=scaling)

        tr, xr = istft(zz, nperseg=nperseg, noverlap=noverlap,
                       window=window, input_onesided=False, scaling=scaling)

        msg = f'{window}, {nperseg}, {noverlap}'
        assert_allclose(t, tr, err_msg=msg)
        assert_allclose(x, xr, err_msg=msg)

    def test_roundtrip_boundary_extension(self):
        rng = np.random.RandomState(1234)

        # Test against boxcar, since window is all ones, and thus can be fully
        # recovered with no boundary extension

        settings = [
                    ('boxcar', 100, 10, 0),           # Test no overlap
                    ('boxcar', 100, 10, 9),           # Test high overlap
                    ]

        for window, N, nperseg, noverlap in settings:
            t = np.arange(N)
            x = 10*rng.randn(t.size)

            _, _, zz = stft(x, nperseg=nperseg, noverlap=noverlap,
                           window=window, detrend=None, padded=True,
                           boundary=None)

            _, xr = istft(zz, noverlap=noverlap, window=window, boundary=False)

            for boundary in ['even', 'odd', 'constant', 'zeros']:
                _, _, zz_ext = stft(x, nperseg=nperseg, noverlap=noverlap,
                                window=window, detrend=None, padded=True,
                                boundary=boundary)

                _, xr_ext = istft(zz_ext, noverlap=noverlap, window=window,
                                boundary=True)

                msg = f'{window}, {noverlap}, {boundary}'
                assert_allclose(x, xr, err_msg=msg)
                assert_allclose(x, xr_ext, err_msg=msg)

    def test_roundtrip_padded_signal(self):
        rng = np.random.RandomState(1234)

        settings = [
                    ('boxcar', 101, 10, 0),
                    ('hann', 1000, 256, 128),
                    ]

        for window, N, nperseg, noverlap in settings:
            t = np.arange(N)
            x = 10*rng.randn(t.size)

            _, _, zz = stft(x, nperseg=nperseg, noverlap=noverlap,
                            window=window, detrend=None, padded=True)

            tr, xr = istft(zz, noverlap=noverlap, window=window)

            msg = f'{window}, {noverlap}'
            # Account for possible zero-padding at the end
            assert_allclose(t, tr[:t.size], err_msg=msg)
            assert_allclose(x, xr[:x.size], err_msg=msg)

    def test_roundtrip_padded_FFT(self):
        rng = np.random.RandomState(1234)

        settings = [
                    ('hann', 1024, 256, 128, 512),
                    ('hann', 1024, 256, 128, 501),
                    ('boxcar', 100, 10, 0, 33),
                    (('tukey', 0.5), 1152, 256, 64, 1024),
                    ]

        for window, N, nperseg, noverlap, nfft in settings:
            t = np.arange(N)
            x = 10*rng.randn(t.size)
            xc = x*np.exp(1j*np.pi/4)

            # real signal
            _, _, z = stft(x, nperseg=nperseg, noverlap=noverlap, nfft=nfft,
                            window=window, detrend=None, padded=True)

            # complex signal
            _, _, zc = stft(xc, nperseg=nperseg, noverlap=noverlap, nfft=nfft,
                            window=window, detrend=None, padded=True,
                            return_onesided=False)

            tr, xr = istft(z, nperseg=nperseg, noverlap=noverlap, nfft=nfft,
                           window=window)

            tr, xcr = istft(zc, nperseg=nperseg, noverlap=noverlap, nfft=nfft,
                            window=window, input_onesided=False)

            msg = f'{window}, {noverlap}'
            assert_allclose(t, tr, err_msg=msg)
            assert_allclose(x, xr, err_msg=msg)
            assert_allclose(xc, xcr, err_msg=msg)

    def test_axis_rolling(self):
        rng = np.random.RandomState(1234)

        x_flat = rng.randn(1024)
        _, _, z_flat = stft(x_flat)

        for a in range(3):
            newshape = [1,]*3
            newshape[a] = -1
            x = x_flat.reshape(newshape)

            _, _, z_plus = stft(x, axis=a)  # Positive axis index
            _, _, z_minus = stft(x, axis=a-x.ndim)  # Negative axis index

            assert_equal(z_flat, z_plus.squeeze(), err_msg=a)
            assert_equal(z_flat, z_minus.squeeze(), err_msg=a-x.ndim)

        # z_flat has shape [n_freq, n_time]

        # Test vs. transpose
        _, x_transpose_m = istft(z_flat.T, time_axis=-2, freq_axis=-1)
        _, x_transpose_p = istft(z_flat.T, time_axis=0, freq_axis=1)

        assert_allclose(x_flat, x_transpose_m, err_msg='istft transpose minus')
        assert_allclose(x_flat, x_transpose_p, err_msg='istft transpose plus')

    def test_roundtrip_scaling(self):
        """Verify behavior of scaling parameter. """
        # Create 1024 sample cosine signal with amplitude 2:
        X = np.zeros(513, dtype=complex)
        X[256] = 1024
        x = np.fft.irfft(X)
        power_x = sum(x**2) / len(x)  # power of signal x is 2

        # Calculate magnitude-scaled STFT:
        Zs = stft(x, boundary='even', scaling='spectrum')[2]

        # Test round trip:
        x1 = istft(Zs, boundary=True, scaling='spectrum')[1]
        assert_allclose(x1, x)

        # For a Hann-windowed 256 sample length FFT, we expect a peak at
        # frequency 64 (since it is 1/4 the length of X) with a height of 1
        # (half the amplitude). A Hann window of a perfectly centered sine has
        # the magnitude [..., 0, 0, 0.5, 1, 0.5, 0, 0, ...].
        # Note that in this case the 'even' padding works for the beginning
        # but not for the end of the STFT.
        assert_allclose(abs(Zs[63, :-1]), 0.5)
        assert_allclose(abs(Zs[64, :-1]), 1)
        assert_allclose(abs(Zs[65, :-1]), 0.5)
        # All other values should be zero:
        Zs[63:66, :-1] = 0
        # Note since 'rtol' does not have influence here, atol needs to be set:
        assert_allclose(Zs[:, :-1], 0, atol=np.finfo(Zs.dtype).resolution)

        # Calculate two-sided psd-scaled STFT:
        #  - using 'even' padding since signal is axis symmetric - this ensures
        #    stationary behavior on the boundaries
        #  - using the two-sided transform allows determining the spectral
        #    power by `sum(abs(Zp[:, k])**2) / len(f)` for the k-th time slot.
        Zp = stft(x, return_onesided=False, boundary='even', scaling='psd')[2]

        # Calculate spectral power of Zd by summing over the frequency axis:
        psd_Zp = np.sum(Zp.real**2 + Zp.imag**2, axis=0) / Zp.shape[0]
        # Spectral power of Zp should be equal to the signal's power:
        assert_allclose(psd_Zp, power_x)

        # Test round trip:
        x1 = istft(Zp, input_onesided=False, boundary=True, scaling='psd')[1]
        assert_allclose(x1, x)

        # The power of the one-sided psd-scaled STFT can be determined
        # analogously (note that the two sides are not of equal shape):
        Zp0 = stft(x, return_onesided=True, boundary='even', scaling='psd')[2]

        # Since x is real, its Fourier transform is conjugate symmetric, i.e.,
        # the missing 'second side' can be expressed through the 'first side':
        Zp1 = np.conj(Zp0[-2:0:-1, :])  # 'second side' is conjugate reversed
        assert_allclose(Zp[:129, :], Zp0)
        assert_allclose(Zp[129:, :], Zp1)

        # Calculate the spectral power:
        s2 = (np.sum(Zp0.real ** 2 + Zp0.imag ** 2, axis=0) +
              np.sum(Zp1.real ** 2 + Zp1.imag ** 2, axis=0))
        psd_Zp01 = s2 / (Zp0.shape[0] + Zp1.shape[0])
        assert_allclose(psd_Zp01, power_x)

        # Test round trip:
        x1 = istft(Zp0, input_onesided=True, boundary=True, scaling='psd')[1]
        assert_allclose(x1, x)


class TestSampledSpectralRepresentations:
    """Check energy/power relations from `Spectral Analysis` section in the user guide.

    A 32 sample cosine signal is used to compare the numerical to the expected results
    stated in :ref:`tutorial_SpectralAnalysis` in
    file ``doc/source/tutorial/signal.rst``
    """
    n: int = 32  #: number of samples
    T: float = 1/16  #: sampling interval
    a_ref: float = 3  #: amplitude of reference
    l_a: int = 3  #: index in fft for defining frequency of test signal

    x_ref: np.ndarray  #: reference signal
    X_ref: np.ndarray  #: two-sided FFT of x_ref
    E_ref: float  #: energy of signal
    P_ref: float  #: power of signal

    def setup_method(self):
        """Create Cosine signal with amplitude a from spectrum. """
        f = rfftfreq(self.n, self.T)
        X_ref = np.zeros_like(f)
        self.l_a = 3
        X_ref[self.l_a] = self.a_ref/2 * self.n  # set amplitude
        self.x_ref = irfft(X_ref)
        self.X_ref = fft(self.x_ref)

        # Closed form expression for continuous-time signal:
        self.E_ref = self.tau * self.a_ref**2 / 2  # energy of signal
        self.P_ref = self.a_ref**2 / 2  # power of signal

    @property
    def tau(self) -> float:
        """Duration of signal. """
        return self.n * self.T

    @property
    def delta_f(self) -> float:
        """Bin width """
        return 1 / (self.n * self.T)

    def test_reference_signal(self):
        """Test energy and power formulas. """
        # Verify that amplitude is a:
        assert_allclose(2*self.a_ref, np.ptp(self.x_ref), rtol=0.1)
        # Verify that energy expression for sampled signal:
        assert_allclose(self.T * sum(self.x_ref ** 2), self.E_ref)

        # Verify that spectral energy and power formulas are correct:
        sum_X_ref_squared = sum(self.X_ref.real**2 + self.X_ref.imag**2)
        assert_allclose(self.T/self.n * sum_X_ref_squared, self.E_ref)
        assert_allclose(1/self.n**2 * sum_X_ref_squared, self.P_ref)

    def test_windowed_DFT(self):
        """Verify spectral representations of windowed DFT.

        Furthermore, the scalings of `periodogram` and `welch` are verified.
        """
        w = hann(self.n, sym=False)
        c_amp, c_rms = abs(sum(w)), np.sqrt(sum(w.real**2 + w.imag**2))
        Xw = fft(self.x_ref*w)  # unnormalized windowed DFT

        # Verify that the *spectrum* peak is consistent:
        assert_allclose(self.tau * Xw[self.l_a] / c_amp, self.a_ref * self.tau / 2)
        # Verify that the *amplitude spectrum* peak is consistent:
        assert_allclose(Xw[self.l_a] / c_amp, self.a_ref/2)

        # Verify spectral power/energy equals signal's power/energy:
        X_ESD = self.tau * self.T * abs(Xw / c_rms)**2  # Energy Spectral Density
        X_PSD = self.T * abs(Xw / c_rms)**2  # Power Spectral Density
        assert_allclose(self.delta_f * sum(X_ESD), self.E_ref)
        assert_allclose(self.delta_f * sum(X_PSD), self.P_ref)

        # Verify scalings of periodogram:
        kw = dict(fs=1/self.T, window=w, detrend=False, return_onesided=False)
        _, P_mag = periodogram(self.x_ref, scaling='spectrum', **kw)
        _, P_psd = periodogram(self.x_ref, scaling='density', **kw)

        # Verify that periodogram calculates a squared magnitude spectrum:
        float_res = np.finfo(P_mag.dtype).resolution
        assert_allclose(P_mag, abs(Xw/c_amp)**2, atol=float_res*max(P_mag))
        # Verify that periodogram calculates a PSD:
        assert_allclose(P_psd, X_PSD, atol=float_res*max(P_psd))

        # Ensure that scaling of welch is the same as of periodogram:
        kw = dict(nperseg=len(self.x_ref), noverlap=0, **kw)
        assert_allclose(welch(self.x_ref, scaling='spectrum', **kw)[1], P_mag,
                        atol=float_res*max(P_mag))
        assert_allclose(welch(self.x_ref, scaling='density', **kw)[1], P_psd,
                        atol=float_res*max(P_psd))
