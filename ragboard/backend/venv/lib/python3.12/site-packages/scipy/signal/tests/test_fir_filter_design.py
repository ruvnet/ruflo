import math
import numpy as np

from numpy.testing import assert_warns
from pytest import raises as assert_raises
import pytest

import scipy._lib.array_api_extra as xpx
from scipy._lib._array_api import (
    xp_assert_close, xp_assert_equal, assert_almost_equal, assert_array_almost_equal,
    array_namespace, xp_default_dtype
)
from scipy.fft import fft, fft2
from scipy.signal import (kaiser_beta, kaiser_atten, kaiserord,
    firwin, firwin2, freqz, remez, firls, minimum_phase, convolve2d, firwin_2d
)

skip_xp_backends = pytest.mark.skip_xp_backends
xfail_xp_backends = pytest.mark.xfail_xp_backends


def test_kaiser_beta():
    b = kaiser_beta(58.7)
    assert_almost_equal(b, 0.1102 * 50.0)
    b = kaiser_beta(22.0)
    assert_almost_equal(b, 0.5842 + 0.07886)
    b = kaiser_beta(21.0)
    assert b == 0.0
    b = kaiser_beta(10.0)
    assert b == 0.0


def test_kaiser_atten():
    a = kaiser_atten(1, 1.0)
    assert a == 7.95
    a = kaiser_atten(2, 1/np.pi)
    assert a == 2.285 + 7.95


def test_kaiserord():
    assert_raises(ValueError, kaiserord, 1.0, 1.0)
    numtaps, beta = kaiserord(2.285 + 7.95 - 0.001, 1/np.pi)
    assert (numtaps, beta) == (2, 0.0)


class TestFirwin:

    def check_response(self, h, expected_response, tol=.05):
        xp = array_namespace(h)
        N = h.shape[0]
        alpha = 0.5 * (N-1)
        m = xp.arange(0, N) - alpha   # time indices of taps
        for freq, expected in expected_response:
            actual = abs(xp.sum(h * xp.exp(-1j * xp.pi * m * freq)))
            mse = abs(actual - expected)**2
            assert mse < tol, f'response not as expected, mse={mse:g} > {tol:g}'

    def test_response(self, xp):
        N = 51
        f = .5

        # increase length just to try even/odd
        h = firwin(N, f)  # low-pass from 0 to f
        self.check_response(h, [(.25,1), (.75,0)])

        h = firwin(N+1, f, window='nuttall')  # specific window
        self.check_response(h, [(.25,1), (.75,0)])

        h = firwin(N+2, f, pass_zero=False)  # stop from 0 to f --> high-pass
        self.check_response(h, [(.25,0), (.75,1)])

        f1, f2, f3, f4 = .2, .4, .6, .8
        h = firwin(N+3, [f1, f2], pass_zero=False)  # band-pass filter
        self.check_response(h, [(.1,0), (.3,1), (.5,0)])

        h = firwin(N+4, [f1, f2])  # band-stop filter
        self.check_response(h, [(.1,1), (.3,0), (.5,1)])

        h = firwin(N+5, [f1, f2, f3, f4], pass_zero=False, scale=False)
        self.check_response(h, [(.1,0), (.3,1), (.5,0), (.7,1), (.9,0)])

        h = firwin(N+6, [f1, f2, f3, f4])  # multiband filter
        self.check_response(h, [(.1,1), (.3,0), (.5,1), (.7,0), (.9,1)])

        h = firwin(N+7, 0.1, width=.03)  # low-pass
        self.check_response(h, [(.05,1), (.75,0)])

        h = firwin(N+8, 0.1, pass_zero=False)  # high-pass
        self.check_response(h, [(.05,0), (.75,1)])

    def mse(self, h, bands):
        """Compute mean squared error versus ideal response across frequency
        band.
          h -- coefficients
          bands -- list of (left, right) tuples relative to 1==Nyquist of
            passbands
        """
        w, H = freqz(h, worN=1024)
        f = w/np.pi
        passIndicator = np.zeros(len(w), bool)
        for left, right in bands:
            passIndicator |= (f >= left) & (f < right)
        Hideal = np.where(passIndicator, 1, 0)
        mse = np.mean(abs(abs(H)-Hideal)**2)
        return mse

    def test_scaling(self, xp):
        """
        For one lowpass, bandpass, and highpass example filter, this test
        checks two things:
          - the mean squared error over the frequency domain of the unscaled
            filter is smaller than the scaled filter (true for rectangular
            window)
          - the response of the scaled filter is exactly unity at the center
            of the first passband
        """
        N = 11
        cases = [
            ([.5], True, (0, 1)),
            ([0.2, .6], False, (.4, 1)),
            ([.5], False, (1, 1)),
        ]
        for cutoff, pass_zero, expected_response in cases:
            h = firwin(N, cutoff, scale=False, pass_zero=pass_zero, window='ones')
            hs = firwin(N, cutoff, scale=True, pass_zero=pass_zero, window='ones')
            if len(cutoff) == 1:
                if pass_zero:
                    cutoff = [0] + cutoff
                else:
                    cutoff = cutoff + [1]
            msg = 'least squares violation'
            assert self.mse(h, [cutoff]) < self.mse(hs, [cutoff]), msg
            self.check_response(hs, [expected_response], 1e-12)

    def test_fs_validation(self):
        with pytest.raises(ValueError, match="Sampling.*single scalar"):
            firwin(51, .5, fs=np.array([10, 20]))


class TestFirWinMore:
    """Different author, different style, different tests..."""

    def test_lowpass(self, xp):
        width = 0.04
        ntaps, beta = kaiserord(120, width)
        cutoff = xp.asarray(0.5)
        kwargs = dict(cutoff=cutoff, window=('kaiser', beta), scale=False)
        taps = firwin(ntaps, **kwargs)

        # Check the symmetry of taps.
        assert_array_almost_equal(taps[:ntaps//2], xp.flip(taps)[:ntaps//2])

        # Check the gain at a few samples where
        # we know it should be approximately 0 or 1.
        freq_samples = xp.asarray([0.0, 0.25, 0.5-width/2, 0.5+width/2, 0.75, 1.0])
        freqs, response = freqz(taps, worN=xp.pi*freq_samples)

        assert_array_almost_equal(
            xp.abs(response),
            xp.asarray([1.0, 1.0, 1.0, 0.0, 0.0, 0.0]), decimal=5
        )

        taps_str = firwin(ntaps, pass_zero='lowpass', **kwargs)
        xp_assert_close(taps, taps_str)

    def test_highpass(self, xp):
        width = 0.04
        ntaps, beta = kaiserord(120, width)

        # Ensure that ntaps is odd.
        ntaps |= 1

        cutoff = xp.asarray(0.5)
        kwargs = dict(cutoff=cutoff, window=('kaiser', beta), scale=False)
        taps = firwin(ntaps, pass_zero=False, **kwargs)

        # Check the symmetry of taps.
        assert_array_almost_equal(taps[:ntaps//2], xp.flip(taps)[:ntaps//2])

        # Check the gain at a few samples where
        # we know it should be approximately 0 or 1.
        freq_samples = xp.asarray([0.0, 0.25, 0.5 - width/2, 0.5 + width/2, 0.75, 1.0])
        freqs, response = freqz(taps, worN=np.pi*freq_samples)

        assert_array_almost_equal(xp.abs(response),
                                  xp.asarray([0.0, 0.0, 0.0, 1.0, 1.0, 1.0]), decimal=5)

        taps_str = firwin(ntaps, pass_zero='highpass', **kwargs)
        xp_assert_close(taps, taps_str)

    def test_bandpass(self, xp):
        width = 0.04
        ntaps, beta = kaiserord(120, width)
        kwargs = dict(
            cutoff=xp.asarray([0.3, 0.7]), window=('kaiser', beta), scale=False
        )
        taps = firwin(ntaps, pass_zero=False, **kwargs)

        # Check the symmetry of taps.
        assert_array_almost_equal(taps[:ntaps//2], xp.flip(taps)[:ntaps//2])

        # Check the gain at a few samples where
        # we know it should be approximately 0 or 1.
        freq_samples = xp.asarray([0.0, 0.2, 0.3 - width/2, 0.3 + width/2, 0.5,
                                   0.7 - width/2, 0.7 + width/2, 0.8, 1.0])
        freqs, response = freqz(taps, worN=np.pi*freq_samples)

        assert_array_almost_equal(xp.abs(response),
                xp.asarray([0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]), decimal=5)

        taps_str = firwin(ntaps, pass_zero='bandpass', **kwargs)
        xp_assert_close(taps, taps_str)

    def test_bandstop_multi(self, xp):
        width = 0.04
        ntaps, beta = kaiserord(120, width)
        kwargs = dict(cutoff=xp.asarray([0.2, 0.5, 0.8]), window=('kaiser', beta),
                      scale=False)
        taps = firwin(ntaps, **kwargs)

        # Check the symmetry of taps.
        assert_array_almost_equal(taps[:ntaps//2], xp.flip(taps)[:ntaps//2])

        # Check the gain at a few samples where
        # we know it should be approximately 0 or 1.
        freq_samples = xp.asarray([0.0, 0.1, 0.2 - width/2, 0.2 + width/2, 0.35,
                                   0.5 - width/2, 0.5 + width/2, 0.65,
                                   0.8 - width/2, 0.8 + width/2, 0.9, 1.0])
        freqs, response = freqz(taps, worN=np.pi*freq_samples)

        assert_array_almost_equal(
            xp.abs(response),
            xp.asarray([1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]),
            decimal=5
        )

        taps_str = firwin(ntaps, pass_zero='bandstop', **kwargs)
        xp_assert_close(taps, taps_str)

    def test_fs_nyq(self, xp):
        """Test the fs and nyq keywords."""
        nyquist = 1000
        width = 40.0
        relative_width = width/nyquist
        ntaps, beta = kaiserord(120, relative_width)
        taps = firwin(ntaps, cutoff=xp.asarray([300, 700]), window=('kaiser', beta),
                        pass_zero=False, scale=False, fs=2*nyquist)

        # Check the symmetry of taps.
        assert_array_almost_equal(taps[:ntaps//2], xp.flip(taps)[:ntaps//2])

        # Check the gain at a few samples where
        # we know it should be approximately 0 or 1.
        freq_samples = xp.asarray([0.0, 200, 300 - width/2, 300 + width/2, 500,
                                   700 - width/2, 700 + width/2, 800, 1000])
        freqs, response = freqz(taps, worN=np.pi*freq_samples/nyquist)

        assert_array_almost_equal(xp.abs(response),
                xp.asarray([0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]), decimal=5)

    def test_array_cutoff(self, xp):
        taps = firwin(3, xp.asarray([.1, .2]))
        # smoke test against the value computed by scipy==1.5.2
        xp_assert_close(
            taps, xp.asarray([-0.00801395, 1.0160279, -0.00801395]), atol=1e-8
        )

    def test_bad_cutoff(self):
        """Test that invalid cutoff argument raises ValueError."""
        # cutoff values must be greater than 0 and less than 1.
        assert_raises(ValueError, firwin, 99, -0.5)
        assert_raises(ValueError, firwin, 99, 1.5)
        # Don't allow 0 or 1 in cutoff.
        assert_raises(ValueError, firwin, 99, [0, 0.5])
        assert_raises(ValueError, firwin, 99, [0.5, 1])
        # cutoff values must be strictly increasing.
        assert_raises(ValueError, firwin, 99, [0.1, 0.5, 0.2])
        assert_raises(ValueError, firwin, 99, [0.1, 0.5, 0.5])
        # Must have at least one cutoff value.
        assert_raises(ValueError, firwin, 99, [])
        # 2D array not allowed.
        assert_raises(ValueError, firwin, 99, [[0.1, 0.2],[0.3, 0.4]])
        # cutoff values must be less than nyq.
        assert_raises(ValueError, firwin, 99, 50.0, fs=80)
        assert_raises(ValueError, firwin, 99, [10, 20, 30], fs=50)

    def test_even_highpass_raises_value_error(self):
        """Test that attempt to create a highpass filter with an even number
        of taps raises a ValueError exception."""
        assert_raises(ValueError, firwin, 40, 0.5, pass_zero=False)
        assert_raises(ValueError, firwin, 40, [.25, 0.5])

    def test_bad_pass_zero(self):
        """Test degenerate pass_zero cases."""
        with assert_raises(ValueError, match="^Parameter pass_zero='foo' not in "):
            firwin(41, 0.5, pass_zero='foo')
        with assert_raises(ValueError, match="^Parameter pass_zero=1.0 not in "):
            firwin(41, 0.5, pass_zero=1.)
        for pass_zero in ('lowpass', 'highpass'):
            with assert_raises(ValueError, match='cutoff must have one'):
                firwin(41, [0.5, 0.6], pass_zero=pass_zero)
        for pass_zero in ('bandpass', 'bandstop'):
            with assert_raises(ValueError, match='must have at least two'):
                firwin(41, [0.5], pass_zero=pass_zero)

    def test_fs_validation(self):
        with pytest.raises(ValueError, match="Sampling.*single scalar"):
            firwin2(51, .5, 1, fs=np.array([10, 20]))


@skip_xp_backends(cpu_only=True, reason="firwin2 uses np.interp")
class TestFirwin2:

    def test_invalid_args(self):
        # `freq` and `gain` have different lengths.
        with assert_raises(ValueError, match='must be of same length'):
            firwin2(50, [0, 0.5, 1], [0.0, 1.0])
        # `nfreqs` is less than `ntaps`.
        with assert_raises(ValueError, match='ntaps must be less than nfreqs'):
            firwin2(50, [0, 0.5, 1], [0.0, 1.0, 1.0], nfreqs=33)
        # Decreasing value in `freq`
        with assert_raises(ValueError, match='must be nondecreasing'):
            firwin2(50, [0, 0.5, 0.4, 1.0], [0, .25, .5, 1.0])
        # Value in `freq` repeated more than once.
        with assert_raises(ValueError, match='must not occur more than twice'):
            firwin2(50, [0, .1, .1, .1, 1.0], [0.0, 0.5, 0.75, 1.0, 1.0])
        # `freq` does not start at 0.0.
        with assert_raises(ValueError, match='start with 0'):
            firwin2(50, [0.5, 1.0], [0.0, 1.0])
        # `freq` does not end at fs/2.
        with assert_raises(ValueError, match='end with fs/2'):
            firwin2(50, [0.0, 0.5], [0.0, 1.0])
        # Value 0 is repeated in `freq`
        with assert_raises(ValueError, match='0 must not be repeated'):
            firwin2(50, [0.0, 0.0, 0.5, 1.0], [1.0, 1.0, 0.0, 0.0])
        # Value fs/2 is repeated in `freq`
        with assert_raises(ValueError, match='fs/2 must not be repeated'):
            firwin2(50, [0.0, 0.5, 1.0, 1.0], [1.0, 1.0, 0.0, 0.0])
        # Value in `freq` that is too close to a repeated number
        with assert_raises(ValueError, match='cannot contain numbers '
                                             'that are too close'):
            firwin2(50, [0.0, 0.5 - np.finfo(float).eps * 0.5, 0.5, 0.5, 1.0],
                        [1.0, 1.0, 1.0, 0.0, 0.0])

        # Type II filter, but the gain at nyquist frequency is not zero.
        with assert_raises(ValueError, match='Type II filter'):
            firwin2(16, [0.0, 0.5, 1.0], [0.0, 1.0, 1.0])

        # Type III filter, but the gains at nyquist and zero rate are not zero.
        with assert_raises(ValueError, match='Type III filter'):
            firwin2(17, [0.0, 0.5, 1.0], [0.0, 1.0, 1.0], antisymmetric=True)
        with assert_raises(ValueError, match='Type III filter'):
            firwin2(17, [0.0, 0.5, 1.0], [1.0, 1.0, 0.0], antisymmetric=True)
        with assert_raises(ValueError, match='Type III filter'):
            firwin2(17, [0.0, 0.5, 1.0], [1.0, 1.0, 1.0], antisymmetric=True)

        # Type IV filter, but the gain at zero rate is not zero.
        with assert_raises(ValueError, match='Type IV filter'):
            firwin2(16, [0.0, 0.5, 1.0], [1.0, 1.0, 0.0], antisymmetric=True)

    def test01(self, xp):
        width = 0.04
        beta = 12.0
        ntaps = 400
        # Filter is 1 from w=0 to w=0.5, then decreases linearly from 1 to 0 as w
        # increases from w=0.5 to w=1  (w=1 is the Nyquist frequency).
        freq = xp.asarray([0.0, 0.5, 1.0])
        gain = xp.asarray([1.0, 1.0, 0.0])
        taps = firwin2(ntaps, freq, gain, window=('kaiser', beta))
        freq_samples = xp.asarray([0.0, 0.25, 0.5 - width/2, 0.5 + width/2,
                                                        0.75, 1.0 - width/2])
        freqs, response = freqz(taps, worN=np.pi*freq_samples)
        freqs, response = xp.asarray(freqs), xp.asarray(response)
        assert_array_almost_equal(
            xp.abs(response),
            xp.asarray([1.0, 1.0, 1.0, 1.0 - width, 0.5, width]), decimal=5
        )

    @skip_xp_backends("jax.numpy", reason="immutable arrays")
    def test02(self, xp):
        width = 0.04
        beta = 12.0
        # ntaps must be odd for positive gain at Nyquist.
        ntaps = 401
        # An ideal highpass filter.
        freq = xp.asarray([0.0, 0.5, 0.5, 1.0])
        gain = xp.asarray([0.0, 0.0, 1.0, 1.0])
        taps = firwin2(ntaps, freq, gain, window=('kaiser', beta))
        freq_samples = np.array([0.0, 0.25, 0.5 - width, 0.5 + width, 0.75, 1.0])
        freqs, response = freqz(taps, worN=np.pi*freq_samples)
        freqs, response = xp.asarray(freqs), xp.asarray(response)
        assert_array_almost_equal(
            xp.abs(response),
            xp.asarray([0.0, 0.0, 0.0, 1.0, 1.0, 1.0]), decimal=5
        )

    @skip_xp_backends("jax.numpy", reason="immutable arrays")
    def test03(self, xp):
        width = 0.02
        ntaps, beta = kaiserord(120, width)
        # ntaps must be odd for positive gain at Nyquist.
        ntaps = int(ntaps) | 1
        freq = xp.asarray([0.0, 0.4, 0.4, 0.5, 0.5, 1.0])
        gain = xp.asarray([1.0, 1.0, 0.0, 0.0, 1.0, 1.0])
        taps = firwin2(ntaps, freq, gain, window=('kaiser', beta))
        freq_samples = np.array([0.0, 0.4 - width, 0.4 + width, 0.45,
                                    0.5 - width, 0.5 + width, 0.75, 1.0])
        freqs, response = freqz(taps, worN=np.pi*freq_samples)
        freqs, response = xp.asarray(freqs), xp.asarray(response)
        assert_array_almost_equal(
            xp.abs(response),
            xp.asarray([1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0]), decimal=5
        )

    @skip_xp_backends("jax.numpy", reason="immutable arrays")
    def test04(self, xp):
        """Test firwin2 when window=None."""
        ntaps = 5
        # Ideal lowpass: gain is 1 on [0,0.5], and 0 on [0.5, 1.0]
        freq = xp.asarray([0.0, 0.5, 0.5, 1.0])
        gain = xp.asarray([1.0, 1.0, 0.0, 0.0])

        taps = firwin2(ntaps, freq, gain, window=None, nfreqs=8193)
        alpha = 0.5 * (ntaps - 1)
        m = xp.arange(0, ntaps, dtype=freq.dtype) - alpha
        h = 0.5 * xpx.sinc(0.5 * m)
        assert_array_almost_equal(h, taps)

    def test05(self, xp):
        """Test firwin2 for calculating Type IV filters"""
        ntaps = 1500

        freq = xp.asarray([0.0, 1.0])
        gain = xp.asarray([0.0, 1.0])
        taps = firwin2(ntaps, freq, gain, window=None, antisymmetric=True)

        flip = array_namespace(freq).flip
        dec = {'decimal': 4.5} if xp_default_dtype(xp) == xp.float32 else {}
        assert_array_almost_equal(taps[: ntaps // 2], flip(-taps[ntaps // 2:]), **dec)

        freqs, response = freqz(np.asarray(taps), worN=2048)    # XXX convert freqz
        assert_array_almost_equal(abs(xp.asarray(response)),
                                  xp.asarray(freqs / np.pi), decimal=4)

    @skip_xp_backends("jax.numpy", reason="immutable arrays")
    def test06(self, xp):
        """Test firwin2 for calculating Type III filters"""
        ntaps = 1501

        freq = xp.asarray([0.0, 0.5, 0.55, 1.0])
        gain = xp.asarray([0.0, 0.5, 0.0, 0.0])
        taps = firwin2(ntaps, freq, gain, window=None, antisymmetric=True)
        assert taps[ntaps // 2] == 0.0

        flip = array_namespace(freq).flip
        dec = {'decimal': 4.5} if xp_default_dtype(xp) == xp.float32 else {}
        assert_array_almost_equal(taps[: ntaps // 2],
                                  flip(-taps[ntaps // 2 + 1:]), **dec
        )

        freqs, response1 = freqz(np.asarray(taps), worN=2048)  # XXX convert freqz
        response1 = xp.asarray(response1)
        response2 = xp.asarray(
            np.interp(np.asarray(freqs) / np.pi, np.asarray(freq), np.asarray(gain))
        )
        assert_array_almost_equal(abs(response1), response2, decimal=3)

    def test_fs_nyq(self, xp):
        taps1 = firwin2(80, xp.asarray([0.0, 0.5, 1.0]), xp.asarray([1.0, 1.0, 0.0]))
        taps2 = firwin2(80, xp.asarray([0.0, 30.0, 60.0]), xp.asarray([1.0, 1.0, 0.0]),
                        fs=120.0)
        assert_array_almost_equal(taps1, taps2)

    def test_tuple(self):
        taps1 = firwin2(150, (0.0, 0.5, 0.5, 1.0), (1.0, 1.0, 0.0, 0.0))
        taps2 = firwin2(150, [0.0, 0.5, 0.5, 1.0], [1.0, 1.0, 0.0, 0.0])
        assert_array_almost_equal(taps1, taps2)

    @skip_xp_backends("jax.numpy", reason="immutable arrays")
    def test_input_modyfication(self, xp):
        freq1 = xp.asarray([0.0, 0.5, 0.5, 1.0])
        freq2 = xp.asarray(freq1)
        firwin2(80, freq1, xp.asarray([1.0, 1.0, 0.0, 0.0]))
        xp_assert_equal(freq1, freq2)


@skip_xp_backends(cpu_only=True)
class TestRemez:

    def test_bad_args(self):
        assert_raises(ValueError, remez, 11, [0.1, 0.4], [1], type='pooka')

    def test_hilbert(self):
        N = 11  # number of taps in the filter
        a = 0.1  # width of the transition band

        # design an unity gain hilbert bandpass filter from w to 0.5-w
        h = remez(11, [a, 0.5-a], [1], type='hilbert')

        # make sure the filter has correct # of taps
        assert len(h) == N, "Number of Taps"

        # make sure it is type III (anti-symmetric tap coefficients)
        assert_array_almost_equal(h[:(N-1)//2], -h[:-(N-1)//2-1:-1])

        # Since the requested response is symmetric, all even coefficients
        # should be zero (or in this case really small)
        assert (abs(h[1::2]) < 1e-15).all(), "Even Coefficients Equal Zero"

        # now check the frequency response
        w, H = freqz(h, 1)
        f = w/2/np.pi
        Hmag = abs(H)

        # should have a zero at 0 and pi (in this case close to zero)
        assert (Hmag[[0, -1]] < 0.02).all(), "Zero at zero and pi"

        # check that the pass band is close to unity
        idx = np.logical_and(f > a, f < 0.5-a)
        assert (abs(Hmag[idx] - 1) < 0.015).all(), "Pass Band Close To Unity"

    def test_compare(self, xp):
        # test comparison to MATLAB
        k = [0.024590270518440, -0.041314581814658, -0.075943803756711,
             -0.003530911231040, 0.193140296954975, 0.373400753484939,
             0.373400753484939, 0.193140296954975, -0.003530911231040,
             -0.075943803756711, -0.041314581814658, 0.024590270518440]
        h = remez(12, xp.asarray([0, 0.3, 0.5, 1]), xp.asarray([1, 0]), fs=2.)
        atol_arg = {'atol': 1e-8} if xp_default_dtype(xp) == xp.float32 else {}
        xp_assert_close(h, xp.asarray(k, dtype=xp.float64), **atol_arg)

        h = [-0.038976016082299, 0.018704846485491, -0.014644062687875,
             0.002879152556419, 0.016849978528150, -0.043276706138248,
             0.073641298245579, -0.103908158578635, 0.129770906801075,
             -0.147163447297124, 0.153302248456347, -0.147163447297124,
             0.129770906801075, -0.103908158578635, 0.073641298245579,
             -0.043276706138248, 0.016849978528150, 0.002879152556419,
             -0.014644062687875, 0.018704846485491, -0.038976016082299]
        atol_arg = {'atol': 3e-8} if xp_default_dtype(xp) == xp.float32 else {}
        xp_assert_close(
            remez(21, xp.asarray([0, 0.8, 0.9, 1]), xp.asarray([0, 1]), fs=2.),
            xp.asarray(h, dtype=xp.float64), **atol_arg
        )

    def test_fs_validation(self):
        with pytest.raises(ValueError, match="Sampling.*single scalar"):
            remez(11, .1, 1, fs=np.array([10, 20]))



@skip_xp_backends(cpu_only=True, reason="lstsq")
class TestFirls:

    def test_bad_args(self):
        # even numtaps
        assert_raises(ValueError, firls, 10, [0.1, 0.2], [0, 0])
        # odd bands
        assert_raises(ValueError, firls, 11, [0.1, 0.2, 0.4], [0, 0, 0])
        # len(bands) != len(desired)
        assert_raises(ValueError, firls, 11, [0.1, 0.2, 0.3, 0.4], [0, 0, 0])
        # non-monotonic bands
        assert_raises(ValueError, firls, 11, [0.2, 0.1], [0, 0])
        assert_raises(ValueError, firls, 11, [0.1, 0.2, 0.3, 0.3], [0] * 4)
        assert_raises(ValueError, firls, 11, [0.3, 0.4, 0.1, 0.2], [0] * 4)
        assert_raises(ValueError, firls, 11, [0.1, 0.3, 0.2, 0.4], [0] * 4)
        # negative desired
        assert_raises(ValueError, firls, 11, [0.1, 0.2], [-1, 1])
        # len(weight) != len(pairs)
        assert_raises(ValueError, firls, 11, [0.1, 0.2], [0, 0], weight=[1, 2])
        # negative weight
        assert_raises(ValueError, firls, 11, [0.1, 0.2], [0, 0], weight=[-1])

    @skip_xp_backends("dask.array", reason="dask fancy indexing shape=(nan,)")
    def test_firls(self, xp):
        N = 11  # number of taps in the filter
        a = 0.1  # width of the transition band

        # design a halfband symmetric low-pass filter
        h = firls(11, xp.asarray([0, a, 0.5 - a, 0.5]), xp.asarray([1, 1, 0, 0]),
                  fs=1.0)

        # make sure the filter has correct # of taps
        assert h.shape[0] == N

        # make sure it is symmetric
        midx = (N-1) // 2
        flip = array_namespace(h).flip
        assert_array_almost_equal(h[:midx],  flip(h[midx+1:])) # h[:-midx-1:-1])

        # make sure the center tap is 0.5
        assert math.isclose(h[midx], 0.5, abs_tol=1e-8) 

        # For halfband symmetric, odd coefficients (except the center)
        # should be zero (really small)
        hodd = xp.stack((h[1:midx:2], h[-midx+1::2]))
        assert_array_almost_equal(hodd, xp.zeros_like(hodd))

        # now check the frequency response
        w, H = freqz(np.asarray(h), 1)
        w, H = xp.asarray(w), xp.asarray(H)
        f = w/2/xp.pi
        Hmag = xp.abs(H)

        # check that the pass band is close to unity
        idx = xp.logical_and(f > 0, f < a)
        assert_array_almost_equal(Hmag[idx], xp.ones_like(Hmag[idx]), decimal=3)

        # check that the stop band is close to zero
        idx = xp.logical_and(f > 0.5 - a, f < 0.5)
        assert_array_almost_equal(Hmag[idx], xp.zeros_like(Hmag[idx]), decimal=3)

    def test_compare(self, xp):
        # compare to OCTAVE output
        taps = firls(9, xp.asarray([0, 0.5, 0.55, 1]),
                    xp.asarray([1, 1, 0, 0]), weight=xp.asarray([1, 2]))
        # >> taps = firls(8, [0 0.5 0.55 1], [1 1 0 0], [1, 2]);
        known_taps = [-6.26930101730182e-04, -1.03354450635036e-01,
                      -9.81576747564301e-03, 3.17271686090449e-01,
                      5.11409425599933e-01, 3.17271686090449e-01,
                      -9.81576747564301e-03, -1.03354450635036e-01,
                      -6.26930101730182e-04]
        atol_arg = {'atol': 5e-8} if xp_default_dtype(xp) == xp.float32 else {}
        known_taps = xp.asarray(known_taps, dtype=xp.float64)
        xp_assert_close(taps, known_taps, **atol_arg)

        # compare to MATLAB output
        taps = firls(11, xp.asarray([0, 0.5, 0.5, 1]),
                     xp.asarray([1, 1, 0, 0]), weight=xp.asarray([1, 2]))
        # >> taps = firls(10, [0 0.5 0.5 1], [1 1 0 0], [1, 2]);
        known_taps = [
            0.058545300496815, -0.014233383714318, -0.104688258464392,
            0.012403323025279, 0.317930861136062, 0.488047220029700,
            0.317930861136062, 0.012403323025279, -0.104688258464392,
            -0.014233383714318, 0.058545300496815]
        known_taps = xp.asarray(known_taps, dtype=xp.float64)
        atol_arg = {'atol': 3e-8} if xp_default_dtype(xp) == xp.float32 else {}
        xp_assert_close(taps, known_taps, **atol_arg)

        # With linear changes:
        taps = firls(7, xp.asarray((0, 1, 2, 3, 4, 5)),
                     xp.asarray([1, 0, 0, 1, 1, 0]), fs=20)
        # >> taps = firls(6, [0, 0.1, 0.2, 0.3, 0.4, 0.5], [1, 0, 0, 1, 1, 0])
        known_taps = [
            1.156090832768218, -4.1385894727395849, 7.5288619164321826,
            -8.5530572592947856, 7.5288619164321826, -4.1385894727395849,
            1.156090832768218]
        known_taps = xp.asarray(known_taps, dtype=xp.float64)
        xp_assert_close(taps, known_taps)

    def test_rank_deficient(self, xp):
        # solve() runs but warns (only sometimes, so here we don't use match)
        x = firls(21, xp.asarray([0, 0.1, 0.9, 1]), xp.asarray([1, 1, 0, 0]))
        w, h = freqz(np.asarray(x), fs=2.)
        w, h = map(xp.asarray, (w, h))   # XXX convert freqz
        absh2 = xp.abs(h[:2])
        xp_assert_close(absh2, xp.ones_like(absh2), atol=1e-5)
        absh2 = xp.abs(h[-2:])
        xp_assert_close(absh2, xp.zeros_like(absh2), atol=1e-6, rtol=1e-7)
        # switch to pinvh (tolerances could be higher with longer
        # filters, but using shorter ones is faster computationally and
        # the idea is the same)
        x = firls(101, xp.asarray([0, 0.01, 0.99, 1]), xp.asarray([1, 1, 0, 0]))
        w, h = freqz(np.asarray(x), fs=2.)
        w, h = map(xp.asarray, (w, h))   # XXX convert freqz
        mask = xp.asarray(w < 0.01)
        h = xp.asarray(h)
        assert xp.sum(xp.astype(mask, xp.int64)) > 3
        habs = xp.abs(h[mask])
        xp_assert_close(habs, xp.ones_like(habs), atol=1e-4)
        mask = xp.asarray(w > 0.99)
        assert xp.sum(xp.astype(mask, xp.int64)) > 3
        habs = xp.abs(h[mask])
        xp_assert_close(habs, xp.zeros_like(habs), atol=1e-4)

    def test_fs_validation(self):
        with pytest.raises(ValueError, match="Sampling.*single scalar"):
            firls(11, .1, 1, fs=np.array([10, 20]))

class TestMinimumPhase:

    @pytest.mark.thread_unsafe
    def test_bad_args(self):
        # not enough taps
        assert_raises(ValueError, minimum_phase, [1.])
        assert_raises(ValueError, minimum_phase, [1., 1.])
        assert_raises(ValueError, minimum_phase, np.full(10, 1j))
        assert_raises((ValueError, TypeError), minimum_phase, 'foo')
        assert_raises(ValueError, minimum_phase, np.ones(10), n_fft=8)
        assert_raises(ValueError, minimum_phase, np.ones(10), method='foo')
        assert_warns(RuntimeWarning, minimum_phase, np.arange(3))
        with pytest.raises(ValueError, match="is only supported when"):
            minimum_phase(np.ones(3), method='hilbert', half=False)

    def test_homomorphic(self):
        # check that it can recover frequency responses of arbitrary
        # linear-phase filters

        # for some cases we can get the actual filter back
        h = [1, -1]
        h_new = minimum_phase(np.convolve(h, h[::-1]))
        xp_assert_close(h_new, np.asarray(h, dtype=np.float64), rtol=0.05)

        # but in general we only guarantee we get the magnitude back
        rng = np.random.RandomState(0)
        for n in (2, 3, 10, 11, 15, 16, 17, 20, 21, 100, 101):
            h = rng.randn(n)
            h_linear = np.convolve(h, h[::-1])
            h_new = minimum_phase(h_linear)
            xp_assert_close(np.abs(fft(h_new)), np.abs(fft(h)), rtol=1e-4)
            h_new = minimum_phase(h_linear, half=False)
            assert len(h_linear) == len(h_new)
            xp_assert_close(np.abs(fft(h_new)), np.abs(fft(h_linear)), rtol=1e-4)

    @skip_xp_backends("dask.array", reason="too slow")
    @skip_xp_backends("jax.numpy", reason="immutable arrays")
    def test_hilbert(self, xp):
        # compare to MATLAB output of reference implementation

        # f=[0 0.3 0.5 1];
        # a=[1 1 0 0];
        # h=remez(11,f,a);
        h = remez(12, [0, 0.3, 0.5, 1], [1, 0], fs=2.)
        k = [0.349585548646686, 0.373552164395447, 0.326082685363438,
             0.077152207480935, -0.129943946349364, -0.059355880509749]
        h = xp.asarray(h)
        k = xp.asarray(k, dtype=xp.float64)
        m = minimum_phase(h, 'hilbert')
        xp_assert_close(m, k, rtol=5e-3)

        # f=[0 0.8 0.9 1];
        # a=[0 0 1 1];
        # h=remez(20,f,a);
        h = remez(21, [0, 0.8, 0.9, 1], [0, 1], fs=2.)
        k = [0.232486803906329, -0.133551833687071, 0.151871456867244,
             -0.157957283165866, 0.151739294892963, -0.129293146705090,
             0.100787844523204, -0.065832656741252, 0.035361328741024,
             -0.014977068692269, -0.158416139047557]
        h = xp.asarray(h)
        k = xp.asarray(k, dtype=xp.float64)
        m = minimum_phase(h, 'hilbert', n_fft=2**19)
        xp_assert_close(m, k, rtol=2e-3)


class Testfirwin_2d:
    def test_invalid_args(self):
        with pytest.raises(ValueError,
                           match="hsize must be a 2-element tuple or list"):
            firwin_2d((50,), window=(("kaiser", 5.0), "boxcar"), fc=0.4)

        with pytest.raises(ValueError,
                           match="window must be a 2-element tuple or list"):
            firwin_2d((51, 51), window=("hamming",), fc=0.5)

        with pytest.raises(ValueError,
                           match="window must be a 2-element tuple or list"):
            firwin_2d((51, 51), window="invalid_window", fc=0.5)

    def test_filter_design(self):
        hsize = (51, 51)
        window = (("kaiser", 8.0), ("kaiser", 8.0))
        fc = 0.4
        taps_kaiser = firwin_2d(hsize, window, fc=fc)
        assert taps_kaiser.shape == (51, 51)

        window = ("hamming", "hamming")
        taps_hamming = firwin_2d(hsize, window, fc=fc)
        assert taps_hamming.shape == (51, 51)

    def test_impulse_response(self):
        hsize = (31, 31)
        window = ("hamming", "hamming")
        fc = 0.4
        taps = firwin_2d(hsize, window, fc=fc)

        impulse = np.zeros((63, 63))
        impulse[31, 31] = 1

        response = convolve2d(impulse, taps, mode='same')

        expected_response = taps
        xp_assert_close(response[16:47, 16:47], expected_response, rtol=1e-5)

    def test_frequency_response(self):
        """Compare 1d and 2d frequency response. """
        hsize = (31, 31)
        windows = ("hamming", "hamming")
        fc = 0.4
        taps_1d = firwin(numtaps=hsize[0], cutoff=fc, window=windows[0])
        taps_2d = firwin_2d(hsize, windows, fc=fc)

        f_resp_1d = fft(taps_1d)
        f_resp_2d = fft2(taps_2d)

        xp_assert_close(f_resp_2d[0, :], f_resp_1d,
                        err_msg='DC Gain at (0, f1) is not unity!')
        xp_assert_close(f_resp_2d[:, 0], f_resp_1d,
                        err_msg='DC Gain at (f0, 0) is not unity!')
        xp_assert_close(f_resp_2d, np.outer(f_resp_1d, f_resp_1d),
                        atol=np.finfo(f_resp_2d.dtype).resolution,
                        err_msg='2d frequency response is not product of 1d responses')

    def test_symmetry(self):
        hsize = (51, 51)
        window = ("hamming", "hamming")
        fc = 0.4
        taps = firwin_2d(hsize, window, fc=fc)
        xp_assert_close(taps, np.flip(taps), rtol=1e-5)

    def test_circular_symmetry(self):
        hsize = (51, 51)
        window = "hamming"
        taps = firwin_2d(hsize, window, circular=True, fc=0.5)
        center = hsize[0] // 2
        for i in range(hsize[0]):
            for j in range(hsize[1]):
                xp_assert_close(taps[i, j], 
                                taps[center - (i - center), center - (j - center)], 
                                rtol=1e-5)

    def test_edge_case_circular(self):
        hsize = (3, 3)
        window = "hamming"
        taps_small = firwin_2d(hsize, window, circular=True, fc=0.5)
        assert taps_small.shape == (3, 3)

        hsize = (101, 101)
        taps_large = firwin_2d(hsize, window, circular=True, fc=0.5)
        assert taps_large.shape == (101, 101)

    def test_known_result(self):
        hsize = (5, 5)
        window = ('kaiser', 8.0)
        fc = 0.1
        fs = 2

        row_filter = firwin(hsize[0], cutoff=fc, window=window, fs=fs)
        col_filter = firwin(hsize[1], cutoff=fc, window=window, fs=fs)
        known_result = np.outer(row_filter, col_filter)

        taps = firwin_2d(hsize, (window, window), fc=fc)
        assert taps.shape == known_result.shape, (
            f"Shape mismatch: {taps.shape} vs {known_result.shape}"
        )
        assert np.allclose(taps, known_result, rtol=1e-1), (
            f"Filter shape mismatch: {taps} vs {known_result}"
        )
