"""Unit tests for module `_short_time_fft`.

This file's structure loosely groups the tests into the following sequential
categories:

1. Test function `_calc_dual_canonical_window`.
2. Test for invalid parameters and exceptions in `ShortTimeFFT` (until the
    `test_from_window` function).
3. Test algorithmic properties of STFT/ISTFT. Some tests were ported from
   ``test_spectral.py``.

Notes
-----
* Mypy 0.990 does interpret the line::

        from scipy.stats import norm as normal_distribution

  incorrectly (but the code works), hence a ``type: ignore`` was appended.
"""
import math
from itertools import product
from typing import cast, get_args, Literal

import numpy as np
import pytest
from scipy._lib._array_api import xp_assert_close, xp_assert_equal
from scipy.fft import fftshift
from scipy.stats import norm as normal_distribution  # type: ignore
from scipy.signal import check_COLA, get_window, welch, stft, istft, spectrogram

from scipy.signal._short_time_fft import FFT_MODE_TYPE, \
    _calc_dual_canonical_window, closest_STFT_dual_window, ShortTimeFFT, PAD_TYPE
from scipy.signal.windows import blackman, gaussian, hamming, nuttall, triang


def test__calc_dual_canonical_window_roundtrip():
    """Test dual window calculation with a round trip to verify duality.

    Note that this works only for canonical window pairs (having minimal
    energy) like a Gaussian.

    The window is the same as in the example of `from ShortTimeFFT.from_dual`.
    """
    win = gaussian(51, std=10, sym=True)
    d_win = _calc_dual_canonical_window(win, 10)
    win2 = _calc_dual_canonical_window(d_win, 10)
    xp_assert_close(win2, win)


def test__calc_dual_canonical_window_exceptions():
    """Raise all exceptions in `_calc_dual_canonical_window`."""
    # Verify that calculation can fail:
    with pytest.raises(ValueError, match="hop=5 is larger than window len.*"):
        _calc_dual_canonical_window(np.ones(4), 5)
    with pytest.raises(ValueError, match=".* Transform not invertible!"):
        _calc_dual_canonical_window(np.array([.1, .2, .3, 0]), 4)

    # Verify that parameter `win` may not be integers:
    with pytest.raises(ValueError, match="Parameter 'win' cannot be of int.*"):
        _calc_dual_canonical_window(np.ones(4, dtype=int), 1)

def test_closest_STFT_dual_window_exceptions():
    """Raise all exceptions in `closest_STFT_dual_window`."""
    with pytest.raises(ValueError, match="Parameters `win` and `desired_dual` are.*"):
        closest_STFT_dual_window(np.ones(4), 2, np.ones(5))
    with pytest.raises(ValueError, match="Parameters `win` and `desired_dual` are.*"):
        closest_STFT_dual_window(np.ones((4, 1)), 2, np.ones(4))
    with pytest.raises(ValueError, match="Parameter win must have finite entries!"):
        closest_STFT_dual_window(np.ones(4)*np.nan, 2, np.ones(4))
    with pytest.raises(ValueError, match="Parameter desired_dual must have finite.*"):
        closest_STFT_dual_window(np.ones(4), 2, np.ones(4)*np.nan)
    with pytest.raises(ValueError, match="Parameter hop=20 is not an integer.*"):
        closest_STFT_dual_window(np.ones(4), 20, np.ones(4))
    with pytest.raises(ValueError, match="Parameter hop=2.0 is not an integer.*"):
        # noinspection PyTypeChecker
        closest_STFT_dual_window(np.ones(4), 2., np.ones(4))

    with pytest.raises(ValueError, match="Unable to calculate scaled closest dual.*"):
        closest_STFT_dual_window(np.ones(4), 2, np.zeros(4), scaled=True)


@pytest.mark.parametrize("scaled", (True, False))
@pytest.mark.parametrize('sym_win', (False, True))
@pytest.mark.parametrize('hop', (8, 9))
@pytest.mark.parametrize('m', (16, 17))
@pytest.mark.parametrize('win_name', ('hann', 'hamming'))
def test_closest_STFT_dual_window_roundtrip(win_name, m, hop, sym_win, scaled):
    """Do roundtrip, i.e., compare dual of dual windows.

    The  default for parameter `desired_dual` is also verified.
    """
    win = get_window(win_name, m, not sym_win)
    d1, s1 = closest_STFT_dual_window(win, hop, np.ones_like(win), scaled=scaled)
    d2, s2 = closest_STFT_dual_window(win, hop, scaled=scaled)  # equals d1, s1
    d3, s3 = closest_STFT_dual_window(d1, hop, win * s1, scaled=True)  # roundtrip

    # Validate default for parameter `desired_dual` works (hard coded => assert ok):
    xp_assert_equal(d2, d1, err_msg="Default for parameter `desired_dual` is not ok!")
    assert s2 == s1, "Default for parameter `desired_dual` is not ok!"

    res = np.finfo(win.dtype).resolution * 5
    xp_assert_close(s1*s3, 1., atol=res, err_msg="Invalid Scale factors")
    xp_assert_close(d3, win, atol=res, err_msg="Roundtrip failed!")

    if scaled:  # check that scaling factor is correct:
        d3, _ = closest_STFT_dual_window(win, hop, np.ones(m) * s1, scaled=False)
        xp_assert_close(d3, d1, atol=res, err_msg="Roundtrip failed!")


@pytest.mark.parametrize('scaled', (False, True))
def test_closest_STFT_dual_window_STFT_roundtrip(scaled):
    """STFT Roundtrip correctness of closest dual window. """
    np.random.seed(5613830)
    n, m_num, hop = 15, 7, 3
    w, desires_dual = hamming(m_num), triang(m_num)
    d, _ = closest_STFT_dual_window(w, hop, desires_dual, scaled=scaled)

    SFT = ShortTimeFFT(w, hop=hop, dual_win=d, fs=1, scale_to=None, phase_shift=None)
    x = 10 * np.random.randn(n)
    Sx = SFT.stft(x)
    y = SFT.istft(Sx, 0, n)

    atol = np.finfo(w.dtype).resolution * 10
    xp_assert_close(y, x, atol=atol, err_msg="Invalid closest window")


@pytest.mark.parametrize('scaled', (False, True))
def test_closest_STFT_dual_window_STFT_roundtrip_complex(scaled):
    """STFT Roundtrip correctness of closest dual window with complex values. """
    np.random.seed(34905436)
    n, m_num, hop = 15, 7, 3
    win = 1j*hamming(m_num) + nuttall(m_num)
    desires_dual = 1j*triang(m_num) + blackman(m_num)
    dual, s = closest_STFT_dual_window(win, hop, desires_dual, scaled=scaled)

    SFT = ShortTimeFFT(win, hop=hop, dual_win=dual, fs=1, fft_mode='twosided',
                       scale_to=None, phase_shift=None)
    x = 10 * np.random.randn(n) + 10j * np.random.randn(n)
    Sx = SFT.stft(x)
    y = SFT.istft(Sx, 0, n)

    atol = np.finfo(win.dtype).resolution * 10
    xp_assert_close(y, x, atol=atol, err_msg=f"Invalid complex closest window ({s=})")


@pytest.mark.parametrize("win_name, nperseg, noverlap, scale_fac", ([
                         ('boxcar',      16,        8,       1/2),
                         ('boxcar',      18,       12,       1/3),
                         ('boxcar',      16,       12,       1/4),
                         ('bartlett',    16,        8,        1.),
                         ('bartlett',    16,       12,       1/2),
                         ('bartlett',    30,       25,       1/3),
                         ('hann',        16,        8,        1.),
                         ('hann',        18,       12,       2/3),
                         ('hann',        16,       12,       1/2),
                         ('blackman',     9,        6,     50/63),
                         ('boxcar',       8,        7,       1/8)]))  # hop = 1
def test_closest_STFT_dual_window_cola(win_name, nperseg, noverlap, scale_fac):
    """Test if `closest_STFT_dual_window` generalizes `check_COLA`.

    The parameters were taken from the `check_COLA` documentation.
    Note that `check_COLA` only guarantees the existence of a dual window with constant
    values but not that those values are unity (which is clear, when investigating the
    'boxcar' examples). The values for `scale_fac` were determined empirically.
    """
    desired_dual = get_window(win_name, nperseg, fftbins=True)
    assert check_COLA(desired_dual, nperseg, noverlap), "COLA cond. violated!"

    win = np.ones(nperseg)  # check scaled window:
    d_s, s = closest_STFT_dual_window(win, nperseg-noverlap, desired_dual, scaled=True)

    res = np.finfo(desired_dual.dtype).resolution
    rel_tol_d = max(abs(d_s))*res*3
    xp_assert_close(s, scale_fac, atol=res*10,
                    err_msg=f"Scale factor off by {s/scale_fac}")
    xp_assert_close(d_s, desired_dual*scale_fac, atol=res*10, rtol=rel_tol_d,
                    err_msg="Calculated incorrect scaled window!")

    # check unscaled window:
    d_u, u = closest_STFT_dual_window(win * scale_fac, nperseg - noverlap,
                                      desired_dual, scaled=False)

    # this should be hard-coded not computed, so no need for allclose
    assert u == 1., "Scaling factor not 1 for parameter `scaled=True`!"
    xp_assert_close(d_u, desired_dual, atol=res*10, rtol=rel_tol_d,
                    err_msg="Calculated incorrect unscaled window!")


def test_invalid_initializer_parameters():
    """Verify that exceptions get raised on invalid parameters when
    instantiating ShortTimeFFT. """
    with pytest.raises(ValueError, match=r"Parameter win must be 1d, " +
                                         r"but win.shape=\(2, 2\)!"):
        ShortTimeFFT(np.ones((2, 2)), hop=4, fs=1)
    with pytest.raises(ValueError, match="Parameter win must have " +
                                         "finite entries"):
        ShortTimeFFT(np.array([1, np.inf, 2, 3]), hop=4, fs=1)
    with pytest.raises(ValueError, match="Parameter hop=0 is not " +
                                         "an integer >= 1!"):
        ShortTimeFFT(np.ones(4), hop=0, fs=1)
    with pytest.raises(ValueError, match="Parameter hop=2.0 is not " +
                                         "an integer >= 1!"):
        # noinspection PyTypeChecker
        ShortTimeFFT(np.ones(4), hop=2.0, fs=1)
    with pytest.raises(ValueError, match=r"dual_win.shape=\(5,\) must equal " +
                                         r"win.shape=\(4,\)!"):
        ShortTimeFFT(np.ones(4), hop=2, fs=1, dual_win=np.ones(5))
    with pytest.raises(ValueError, match="Parameter dual_win must be " +
                                         "a finite array!"):
        ShortTimeFFT(np.ones(3), hop=2, fs=1,
                     dual_win=np.array([np.nan, 2, 3]))


def test_exceptions_properties_methods():
    """Verify that exceptions get raised when setting properties or calling
    method of ShortTimeFFT to/with invalid values."""
    SFT = ShortTimeFFT(np.ones(8), hop=4, fs=1)
    with pytest.raises(ValueError, match="Sampling interval T=-1 must be " +
                                         "positive!"):
        SFT.T = -1
    with pytest.raises(ValueError, match="Sampling frequency fs=-1 must be " +
                                         "positive!"):
        SFT.fs = -1
    with pytest.raises(ValueError, match="fft_mode='invalid_typ' not in " +
                                         r"\('twosided', 'centered', " +
                                         r"'onesided', 'onesided2X'\)!"):
        SFT.fft_mode = 'invalid_typ'
    with pytest.raises(ValueError, match="For scaling is None, " +
                                         "fft_mode='onesided2X' is invalid.*"):
        SFT.fft_mode = 'onesided2X'
    with pytest.raises(ValueError, match="Attribute mfft=7 needs to be " +
                                         "at least the window length.*"):
        SFT.mfft = 7
    with pytest.raises(ValueError, match="scaling='invalid' not in.*"):
        # noinspection PyTypeChecker
        SFT.scale_to('invalid')
    with pytest.raises(ValueError, match="phase_shift=3.0 has the unit .*"):
        SFT.phase_shift = 3.0
    with pytest.raises(ValueError, match="-mfft < phase_shift < mfft " +
                                         "does not hold.*"):
        SFT.phase_shift = 2*SFT.mfft
    with pytest.raises(ValueError, match="Parameter padding='invalid' not.*"):
        # noinspection PyTypeChecker
        g = SFT._x_slices(np.zeros(16), k_off=0, p0=0, p1=1, padding='invalid')
        next(g)  # execute generator
    with pytest.raises(ValueError, match="Trend type must be 'linear' " +
                                         "or 'constant'"):
        # noinspection PyTypeChecker
        SFT.stft_detrend(np.zeros(16), detr='invalid')
    with pytest.raises(ValueError, match="Parameter detr=nan is not a str, " +
                                         "function or None!"):
        # noinspection PyTypeChecker
        SFT.stft_detrend(np.zeros(16), detr=np.nan)
    with pytest.raises(ValueError, match="Invalid Parameter p0=0, p1=200.*"):
        SFT.p_range(100, 0, 200)

    with pytest.raises(ValueError, match="f_axis=0 may not be equal to " +
                                         "t_axis=0!"):
        SFT.istft(np.zeros((SFT.f_pts, 2)), t_axis=0, f_axis=0)
    with pytest.raises(ValueError, match=r"S.shape\[f_axis\]=2 must be equal" +
                                         " to self.f_pts=5.*"):
        SFT.istft(np.zeros((2, 2)))
    with pytest.raises(ValueError, match=r"S.shape\[t_axis\]=1 needs to have" +
                                         " at least 2 slices.*"):
        SFT.istft(np.zeros((SFT.f_pts, 1)))
    with pytest.raises(ValueError, match=r".*\(k1=100\) <= \(k_max=12\) " +
                                         "is false!$"):
        SFT.istft(np.zeros((SFT.f_pts, 3)), k1=100)
    with pytest.raises(ValueError, match=r"\(k1=1\) - \(k0=0\) = 1 has to " +
                                         "be at least.* length 4!"):
        SFT.istft(np.zeros((SFT.f_pts, 3)), k0=0, k1=1)

    with pytest.raises(ValueError, match=r"Parameter axes_seq='invalid' " +
                                         r"not in \['tf', 'ft'\]!"):
        # noinspection PyTypeChecker
        SFT.extent(n=100, axes_seq='invalid')
    with pytest.raises(ValueError, match="Attribute fft_mode=twosided must.*"):
        SFT.fft_mode = 'twosided'
        SFT.extent(n=100)


@pytest.mark.parametrize('m', ('onesided', 'onesided2X'))
def test_exceptions_fft_mode_complex_win(m: FFT_MODE_TYPE):
    """Verify that one-sided spectra are not allowed with complex-valued
    windows or with complex-valued signals.

    The reason being, the `rfft` function only accepts real-valued input.
    """
    with pytest.raises(ValueError,
                       match=f"One-sided spectra, i.e., fft_mode='{m}'.*"):
        ShortTimeFFT(np.ones(8)*1j, hop=4, fs=1, fft_mode=m)

    SFT = ShortTimeFFT(np.ones(8)*1j, hop=4, fs=1, fft_mode='twosided')
    with pytest.raises(ValueError,
                       match=f"One-sided spectra, i.e., fft_mode='{m}'.*"):
        SFT.fft_mode = m

    SFT = ShortTimeFFT(np.ones(8), hop=4, fs=1, scale_to='psd', fft_mode='onesided')
    with pytest.raises(ValueError, match="Complex-valued `x` not allowed for self.*"):
        SFT.stft(np.ones(8)*1j)
    SFT.fft_mode = 'onesided2X'
    with pytest.raises(ValueError, match="Complex-valued `x` not allowed for self.*"):
        SFT.stft(np.ones(8)*1j)


def test_invalid_fft_mode_RuntimeError():
    """Ensure exception gets raised when property `fft_mode` is invalid. """
    SFT = ShortTimeFFT(np.ones(8), hop=4, fs=1)
    # noinspection PyTypeChecker
    SFT._fft_mode = 'invalid_typ'

    with pytest.raises(RuntimeError):
        _ = SFT.f
    with pytest.raises(RuntimeError):
        SFT._fft_func(np.ones(8))
    with pytest.raises(RuntimeError):
        SFT._ifft_func(np.ones(8))


@pytest.mark.parametrize('win_params, Nx', [(('gaussian', 2.), 9),  # in docstr
                                            ('triang', 7),
                                            (('kaiser', 4.0), 9),
                                            (('exponential', None, 1.), 9),
                                            (4.0, 9)])
def test_from_window(win_params, Nx: int):
    """Verify that `from_window()` handles parameters correctly.

    The window parameterizations are documented in the `get_window` docstring.
    """
    w_sym, fs = get_window(win_params, Nx, fftbins=False), 16.
    w_per = get_window(win_params, Nx, fftbins=True)
    SFT0 = ShortTimeFFT(w_sym, hop=3, fs=fs, fft_mode='twosided',
                        scale_to='psd', phase_shift=1)
    nperseg = len(w_sym)
    noverlap = nperseg - SFT0.hop
    SFT1 = ShortTimeFFT.from_window(win_params, fs, nperseg, noverlap,
                                    symmetric_win=True, fft_mode='twosided',
                                    scale_to='psd', phase_shift=1)
    # periodic window:
    SFT2 = ShortTimeFFT.from_window(win_params, fs, nperseg, noverlap,
                                    symmetric_win=False, fft_mode='twosided',
                                    scale_to='psd', phase_shift=1)
    # Be informative when comparing instances:
    xp_assert_equal(SFT1.win, SFT0.win)
    xp_assert_close(SFT2.win, w_per / np.sqrt(sum(w_per**2) * fs))
    for n_ in ('hop', 'T', 'fft_mode', 'mfft', 'scaling', 'phase_shift'):
        v0, v1, v2 = (getattr(SFT_, n_) for SFT_ in (SFT0, SFT1, SFT2))
        assert v1 == v0, f"SFT1.{n_}={v1} does not equal SFT0.{n_}={v0}"
        assert v2 == v0, f"SFT2.{n_}={v2} does not equal SFT0.{n_}={v0}"


def test_from_win_equals_dual_exceptions():
    """Raise all occurring exceptions in `ShortTimeFFT.from_closest_win_equals_dual`.
    """
    with pytest.raises(ValueError, match="Parameter desired_win is not 1d, but.*"):
        ShortTimeFFT.from_win_equals_dual(np.ones((3, 4)), hop=1, fs=1)
    with pytest.raises(ValueError, match="Parameter desired_win cannot be of int.*"):
        ShortTimeFFT.from_win_equals_dual(np.ones(4, dtype=int), hop=1, fs=1)
    with pytest.raises(ValueError, match="Parameter desired_win is not 1d, but.*"):
        ShortTimeFFT.from_win_equals_dual(np.array([]), hop=1, fs=1)
    with pytest.raises(ValueError, match="Parameter desired_win must have finite.*"):
        ShortTimeFFT.from_win_equals_dual(np.ones(3) * np.inf, hop=1, fs=1)
    with pytest.raises(ValueError, match="Parameter hop=0 is not an integer .*"):
        ShortTimeFFT.from_win_equals_dual(np.ones(4), hop=0, fs=1)
    with pytest.raises(ValueError, match="Parameter hop=5 is not an integer .*"):
        ShortTimeFFT.from_win_equals_dual(np.ones(4), hop=5, fs=1)

    with pytest.raises(ValueError, match="P.+ desired_win does not have valid.*"):
        w = np.array([1, 0, 1, 0, 1], dtype=float)
        ShortTimeFFT.from_win_equals_dual(w, hop=2, fs=1)
    with pytest.raises(ValueError, match="Parameter scale_to='invalid' not in.*"):
        # noinspection PyTypeChecker
        ShortTimeFFT.from_win_equals_dual(w, hop=2, fs=1, scale_to='invalid')

@pytest.mark.parametrize('fft_bins', (True, False))
@pytest.mark.parametrize('m, hop', [(16, 8), (16, 7), (17, 8), (17, 9), (16, 16)])
def test_from_win_equals_dual_params(m, hop, fft_bins):
    """Test windows parameterizations for `ShortTimeFFT.from_closest_win_equals_dual`.

    The flattop window is used since it also has negative values.
    """
    desired_win = get_window('flattop', m, fftbins=fft_bins)
    SFT0 = ShortTimeFFT.from_win_equals_dual(desired_win, hop, fs=1)
    xp_assert_close(SFT0.dual_win, SFT0.win, err_msg="win must equals dual window!")

    SFT1 = ShortTimeFFT(SFT0.win, hop, fs=1)
    xp_assert_close(SFT1.dual_win, SFT0.win, err_msg="dual win isn't canonical win!")


@pytest.mark.parametrize('fft_bins', (True, False))
@pytest.mark.parametrize('m, hop', [(16, 8), (16, 7), (17, 8), (17, 9), (16, 16)])
@pytest.mark.parametrize('scale_to', (None, 'unitary'))
def test_from_win_equals_dual_roundtrip(m, hop, fft_bins, scale_to):
    """Testing roundtrip verifies that the dual window is correct.
    """
    desired_win = get_window('flattop', m, fftbins=fft_bins)
    SFT0 = ShortTimeFFT.from_win_equals_dual(desired_win, hop, fs=1)

    x = np.cos(np.arange(2*m)**2)
    x1 = SFT0.istft(SFT0.stft(x), 0, len(x))
    xp_assert_close(x1, x, err_msg="Roundtrip for win equaling its dual failed!")


def test_from_win_equals_dual_unitary():
    """Check that STFT can be unitary mapping. """
    m, hop = 8, 4
    des_win = get_window('hann', m)
    SFT = ShortTimeFFT.from_win_equals_dual(des_win, hop, 1, fft_mode='twosided',
                                            scale_to='unitary')
    # Orthogonal signals:
    x, y = np.tile([-1, -1, 1, 1], 4), np.tile([1, -1, -1, 1], 4)
    Sxx, Sxy = SFT.spectrogram(x), SFT.spectrogram(x, y)

    atol = np.finfo(Sxx.dtype).resolution
    assert sum(x * y) == 0
    xp_assert_close(np.sum(Sxx), np.sum(x ** 2, dtype=Sxx.dtype), atol=atol,
                    err_msg="Energies do not match!")
    xp_assert_close(np.sum(Sxy), 0.0j, atol=atol,
                    err_msg="STFT scalar product of Sx and Sy not 0!")
    xp_assert_close(SFT.dual_win, SFT.win*SFT.m_num, atol=atol,
                    err_msg="Wrong factor for dual_win/win!")


def test_dual_win_roundtrip():
    """Verify the duality of `win` and `dual_win`.

    Note that this test does not work for arbitrary windows, since dual windows
    are not unique. It always works for invertible STFTs if the windows do not
    overlap.
    """
    # Non-standard values for keyword arguments (except for `scale_to`):
    kw = dict(hop=4, fs=1, fft_mode='twosided', mfft=8, scale_to=None,
              phase_shift=2)
    SFT0 = ShortTimeFFT(np.ones(4), **kw)
    SFT1 = ShortTimeFFT.from_dual(SFT0.dual_win, **kw)
    xp_assert_close(SFT1.dual_win, SFT0.win)


@pytest.mark.parametrize('scale_to, fac_psd, fac_mag',
                         [(None, 0.25, 0.125),
                          ('magnitude', 2.0, 1),
                          ('psd', 1, 0.5)])
def test_scaling(scale_to: Literal['magnitude', 'psd'], fac_psd, fac_mag):
    """Verify scaling calculations.

    * Verify passing `scale_to`parameter  to ``__init__().
    * Roundtrip while changing scaling factor.
    """
    SFT = ShortTimeFFT(np.ones(4) * 2, hop=4, fs=1, scale_to=scale_to)
    assert SFT.fac_psd == fac_psd
    assert SFT.fac_magnitude == fac_mag
    # increase coverage by accessing properties twice:
    assert SFT.fac_psd == fac_psd
    assert SFT.fac_magnitude == fac_mag

    x = np.fft.irfft([0, 0, 7, 0, 0, 0, 0])  # periodic signal
    Sx = SFT.stft(x)
    Sx_mag, Sx_psd = Sx * SFT.fac_magnitude, Sx * SFT.fac_psd

    SFT.scale_to('magnitude')
    x_mag = SFT.istft(Sx_mag, k1=len(x))
    xp_assert_close(x_mag, x)

    SFT.scale_to('psd')
    x_psd = SFT.istft(Sx_psd, k1=len(x))
    xp_assert_close(x_psd, x)


def test_scale_to():
    """Verify `scale_to()` method."""
    SFT = ShortTimeFFT(np.ones(4) * 2, hop=4, fs=1, scale_to=None)

    SFT.scale_to('magnitude')
    assert SFT.scaling == 'magnitude'
    assert SFT.fac_psd == 2.0
    assert SFT.fac_magnitude == 1

    SFT.scale_to('psd')
    assert SFT.scaling == 'psd'
    assert SFT.fac_psd == 1
    assert SFT.fac_magnitude == 0.5

    SFT.scale_to('psd')  # needed for coverage

    for scale, s_fac in zip(('magnitude', 'psd'), (8, 4)):
        SFT = ShortTimeFFT(np.ones(4) * 2, hop=4, fs=1, scale_to=None)
        dual_win = SFT.dual_win.copy()

        SFT.scale_to(cast(Literal['magnitude', 'psd'], scale))
        xp_assert_close(SFT.dual_win, dual_win * s_fac)


def test_x_slices_padding():
    """Verify padding.

    The reference arrays were taken from  the docstrings of `zero_ext`,
    `const_ext`, `odd_ext()`, and `even_ext()` from the _array_tools module.
    """
    SFT = ShortTimeFFT(np.ones(5), hop=4, fs=1)
    x = np.array([[1, 2, 3, 4, 5], [0, 1, 4, 9, 16]], dtype=float)
    d = {'zeros': [[[0, 0, 1, 2, 3], [0, 0, 0, 1, 4]],
                   [[3, 4, 5, 0, 0], [4, 9, 16, 0, 0]]],
         'edge': [[[1, 1, 1, 2, 3], [0, 0, 0, 1, 4]],
                  [[3, 4, 5, 5, 5], [4, 9, 16, 16, 16]]],
         'even': [[[3, 2, 1, 2, 3], [4, 1, 0, 1, 4]],
                  [[3, 4, 5, 4, 3], [4, 9, 16, 9, 4]]],
         'odd': [[[-1, 0, 1, 2, 3], [-4, -1, 0, 1, 4]],
                 [[3, 4, 5, 6, 7], [4, 9, 16, 23, 28]]]}
    for p_, xx in d.items():
        gen = SFT._x_slices(np.array(x), 0, 0, 2, padding=cast(PAD_TYPE, p_))
        yy = np.array([y_.copy() for y_ in gen])  # due to inplace copying
        xx = np.asarray(xx, dtype=np.float64)
        xp_assert_equal(yy, xx, err_msg=f"Failed '{p_}' padding.")


def test_invertible():
    """Verify `invertible` property. """
    SFT = ShortTimeFFT(np.ones(8), hop=4, fs=1)
    assert SFT.invertible
    SFT = ShortTimeFFT(np.ones(8), hop=9, fs=1)
    assert not SFT.invertible


def test_border_values():
    """Ensure that minimum and maximum values of slices are correct."""
    SFT = ShortTimeFFT(np.ones(8), hop=4, fs=1)
    assert SFT.p_min == 0
    assert SFT.k_min == -4
    assert SFT.lower_border_end == (4, 1)
    assert SFT.lower_border_end == (4, 1)  # needed to test caching
    assert SFT.p_max(10) == 4
    assert SFT.k_max(10) == 16
    assert SFT.upper_border_begin(10) == (4, 2)
    # Raise exceptions:
    with pytest.raises(ValueError, match="^Parameter n must be"):
        SFT.upper_border_begin(3)
    with pytest.raises(ValueError, match="^Parameter n must be"):
        SFT._post_padding(3)

def test_border_values_exotic():
    """Ensure that the border calculations are correct for windows with
    zeros. """
    w = np.array([0, 0, 0, 0, 0, 0, 0, 1.])
    SFT = ShortTimeFFT(w, hop=1, fs=1)
    assert SFT.lower_border_end == (0, 0)

    SFT = ShortTimeFFT(np.flip(w), hop=20, fs=1)
    assert SFT.upper_border_begin(4) == (16, 1)
    assert SFT.upper_border_begin(5) == (16, 1)
    assert SFT.upper_border_begin(23) == (36, 2)
    assert SFT.upper_border_begin(24) == (36, 2)
    assert SFT.upper_border_begin(25) == (36, 2)

    SFT._hop = -1  # provoke unreachable line
    with pytest.raises(RuntimeError):
        _ = SFT.k_max(4)
    with pytest.raises(RuntimeError):
        _ = SFT.k_min


def test_t():
    """Verify that the times of the slices are correct. """
    SFT = ShortTimeFFT(np.ones(8), hop=4, fs=2)
    assert SFT.T == 1/2
    assert SFT.fs == 2.
    assert SFT.delta_t == 4 * 1/2
    t_stft = np.arange(0, SFT.p_max(10)) * SFT.delta_t
    xp_assert_equal(SFT.t(10), t_stft)
    xp_assert_equal(SFT.t(10, 1, 3), t_stft[1:3])
    SFT.T = 1/4
    assert SFT.T == 1/4
    assert SFT.fs == 4
    SFT.fs = 1/8
    assert SFT.fs == 1/8
    assert SFT.T == 8


@pytest.mark.parametrize('fft_mode, f',
                         [('onesided', [0., 1., 2.]),
                          ('onesided2X', [0., 1., 2.]),
                          ('twosided', [0., 1., 2., -2., -1.]),
                          ('centered', [-2., -1., 0., 1., 2.])])
def test_f(fft_mode: FFT_MODE_TYPE, f):
    """Verify the frequency values property `f`."""
    SFT = ShortTimeFFT(np.ones(5), hop=4, fs=5, fft_mode=fft_mode,
                       scale_to='psd')
    xp_assert_equal(SFT.f, f)


@pytest.mark.parametrize('n', [20, 21])
@pytest.mark.parametrize('m', [5, 6])
@pytest.mark.parametrize('fft_mode', ['onesided', 'centered'])
def test_extent(n, m, fft_mode: FFT_MODE_TYPE):
    """Ensure that the `extent()` method is correct. """
    SFT = ShortTimeFFT(np.ones(m), hop=m, fs=m, fft_mode=fft_mode)

    t0 = SFT.t(n)[0]  # first timestamp
    t1 = SFT.t(n)[-1] + SFT.delta_t  # last timestamp + 1
    t0c, t1c = t0 - SFT.delta_t / 2, t1 - SFT.delta_t / 2  # centered timestamps

    f0 = SFT.f[0]  # first frequency
    f1 = SFT.f[-1] + SFT.delta_f  # last frequency + 1
    f0c, f1c = f0 - SFT.delta_f / 2, f1 - SFT.delta_f / 2  # centered frequencies

    assert SFT.extent(n, 'tf', False) == (t0, t1, f0, f1)
    assert SFT.extent(n, 'ft', False) == (f0, f1, t0, t1)
    assert SFT.extent(n, 'tf', True) == (t0c, t1c, f0c, f1c)
    assert SFT.extent(n, 'ft', True) == (f0c, f1c, t0c, t1c)


def test_spectrogram():
    """Verify spectrogram and cross-spectrogram methods. """
    SFT = ShortTimeFFT(np.ones(8), hop=4, fs=1)
    x, y = np.ones(10), np.arange(10)
    X, Y = SFT.stft(x), SFT.stft(y)
    xp_assert_close(SFT.spectrogram(x), X.real**2+X.imag**2)
    xp_assert_close(SFT.spectrogram(x, y), X * Y.conj())


@pytest.mark.parametrize('n', [8, 9])
def test_fft_func_roundtrip(n: int):
    """Test roundtrip `ifft_func(fft_func(x)) == x` for all permutations of
    relevant parameters. """
    np.random.seed(2394795)
    x0 = np.random.rand(n)
    w, h_n = np.ones(n), 4

    pp = dict(
        fft_mode=get_args(FFT_MODE_TYPE),
        mfft=[None, n, n+1, n+2],
        scaling=[None, 'magnitude', 'psd'],
        phase_shift=[None, -n+1, 0, n // 2, n-1])
    for f_typ, mfft, scaling, phase_shift in product(*pp.values()):
        if f_typ == 'onesided2X' and scaling is None:
            continue  # this combination is forbidden
        SFT = ShortTimeFFT(w, h_n, fs=n, fft_mode=f_typ, mfft=mfft,
                           scale_to=scaling, phase_shift=phase_shift)
        X0 = SFT._fft_func(x0)
        x1 = SFT._ifft_func(X0)
        xp_assert_close(x0.astype(x1.dtype), x1,
                        err_msg="_fft_func() roundtrip failed for " +
                        f"{f_typ=}, {mfft=}, {scaling=}, {phase_shift=}")

    SFT = ShortTimeFFT(w, h_n, fs=1)
    SFT._fft_mode = 'invalid_fft'  # type: ignore
    with pytest.raises(RuntimeError):
        SFT._fft_func(x0)
    with pytest.raises(RuntimeError):
        SFT._ifft_func(x0)


@pytest.mark.parametrize('i', range(19))
def test_impulse_roundtrip(i):
    """Roundtrip for an impulse being at different positions `i`."""
    n = 19
    w, h_n = np.ones(8), 3
    x = np.zeros(n)
    x[i] = 1

    SFT = ShortTimeFFT(w, hop=h_n, fs=1, scale_to=None, phase_shift=None)
    Sx = SFT.stft(x)
    # test slicing the input signal into two parts:
    n_q = SFT.nearest_k_p(n // 2)
    Sx0 = SFT.stft(x[:n_q], padding='zeros')
    Sx1 = SFT.stft(x[n_q:], padding='zeros')
    q0_ub = SFT.upper_border_begin(n_q)[1] - SFT.p_min
    q1_le = SFT.lower_border_end[1] - SFT.p_min
    xp_assert_close(Sx0[:, :q0_ub], Sx[:, :q0_ub], err_msg=f"{i=}")
    xp_assert_close(Sx1[:, q1_le:], Sx[:, q1_le-Sx1.shape[1]:],
                    err_msg=f"{i=}")

    Sx01 = np.hstack((Sx0[:, :q0_ub],
                      Sx0[:, q0_ub:] + Sx1[:, :q1_le],
                      Sx1[:, q1_le:]))
    xp_assert_close(Sx, Sx01, atol=1e-8, err_msg=f"{i=}")

    y = SFT.istft(Sx, 0, n)
    xp_assert_close(y, x, atol=1e-8, err_msg=f"{i=}")
    y0 = SFT.istft(Sx, 0, n//2)
    xp_assert_close(x[:n//2], y0, atol=1e-8, err_msg=f"{i=}")
    y1 = SFT.istft(Sx, n // 2, n)
    xp_assert_close(x[n // 2:], y1, atol=1e-8, err_msg=f"{i=}")


@pytest.mark.parametrize('hop', [1, 7, 8])
def test_asymmetric_window_roundtrip(hop: int):
    """An asymmetric window could uncover indexing problems. """
    np.random.seed(23371)

    w = np.arange(16) / 8  # must be of type float
    w[len(w)//2:] = 1
    SFT = ShortTimeFFT(w, hop, fs=1)

    x = 10 * np.random.randn(64)
    Sx = SFT.stft(x)
    x1 = SFT.istft(Sx, k1=len(x))
    xp_assert_close(x1, x1, err_msg="Roundtrip for asymmetric window with " +
                                    f" {hop=} failed!")


@pytest.mark.parametrize('m_num', [6, 7])
def test_minimal_length_signal(m_num):
    """Verify that the shortest allowed signal works. """
    SFT = ShortTimeFFT(np.ones(m_num), m_num//2, fs=1)
    n = math.ceil(m_num/2)
    x = np.ones(n)
    Sx = SFT.stft(x)
    x1 = SFT.istft(Sx, k1=n)
    xp_assert_close(x1, x, err_msg=f"Roundtrip minimal length signal ({n=})" +
                                   f" for {m_num} sample window failed!")
    with pytest.raises(ValueError, match=rf"len\(x\)={n-1} must be >= ceil.*"):
        SFT.stft(x[:-1])
    with pytest.raises(ValueError, match=rf"S.shape\[t_axis\]={Sx.shape[1]-1}"
                       f" needs to have at least {Sx.shape[1]} slices"):
        SFT.istft(Sx[:, :-1], k1=n)


def test_compare_stft_detrend():
    """Test the detrending in `ShortTimeFFT.stft_detrend()`. """
    SFT = ShortTimeFFT(np.ones(4), 4, fs=1)
    x0 = np.zeros(4) # signal without trend
    x1 = x0 + 3  # signal with constant trend
    x2 = x0 + np.arange(len(x0))  # signal with linear trend

    kw = dict(k_offset=2, p1=1)  # we want only one slice
    Sx0 = SFT.stft(x0, **kw)  # no trend
    Sx1 = SFT.stft_detrend(x1, detr='constant', **kw)
    Sx2 = SFT.stft_detrend(x2, detr='linear', **kw)
    Sx3 = SFT.stft_detrend(x1, detr=lambda x: x - np.mean(x), **kw)

    atol = np.finfo(Sx0.dtype).resolution * 5  # needed to compare with array of zeros
    xp_assert_close(Sx1, Sx0, atol=atol, err_msg="Constant detrending failed!")
    xp_assert_close(Sx0, Sx2, atol=atol, err_msg="Linear detrending failed!")
    xp_assert_close(Sx0, Sx3, atol=atol, err_msg="Detrending using a function failed!")


def test_tutorial_stft_sliding_win():
    """Verify example in "Sliding Windows" subsection from the "User Guide".

    In :ref:`tutorial_stft_sliding_win` (file ``signal.rst``) of the
    :ref:`user_guide` the behavior the border behavior of
    ``ShortTimeFFT(np.ones(6), 2, fs=1)`` with a 50 sample signal is discussed.
    This test verifies the presented indexes.
    """
    SFT = ShortTimeFFT(np.ones(6), 2, fs=1)

    # Lower border:
    assert SFT.m_num_mid == 3, f"Slice middle is not 3 but {SFT.m_num_mid=}"
    assert SFT.p_min == -1, f"Lowest slice {SFT.p_min=} is not -1"
    assert SFT.k_min == -5, f"Lowest slice sample {SFT.p_min=} is not -5"
    k_lb, p_lb = SFT.lower_border_end
    assert p_lb == 2, f"First unaffected slice {p_lb=} is not 2"
    assert k_lb == 5, f"First unaffected sample {k_lb=} is not 5"

    n = 50  # upper signal border
    assert (p_max := SFT.p_max(n)) == 27, f"Last slice {p_max=} must be 27"
    assert (k_max := SFT.k_max(n)) == 55, f"Last sample {k_max=} must be 55"
    k_ub, p_ub = SFT.upper_border_begin(n)
    assert p_ub == 24, f"First upper border slice {p_ub=} must be 24"
    assert k_ub == 45, f"First upper border slice {k_ub=} must be 45"


def test_tutorial_stft_legacy_stft():
    """Verify STFT example in "Comparison with Legacy Implementation" from the
    "User Guide".

    In :ref:`tutorial_stft_legacy_stft` (file ``signal.rst``) of the
    :ref:`user_guide` the legacy and the new implementation are compared.
    """
    fs, N = 200, 1001  # # 200 Hz sampling rate for 5 s signal
    t_z = np.arange(N) / fs  # time indexes for signal
    z = np.exp(2j*np.pi * 70 * (t_z - 0.2 * t_z ** 2))  # complex-valued chirp

    nperseg, noverlap = 50, 40
    win = ('gaussian', 1e-2 * fs)  # Gaussian with 0.01 s standard deviation

    # Legacy STFT:
    f0_u, t0, Sz0_u = stft(z, fs, win, nperseg, noverlap,
                           return_onesided=False, scaling='spectrum')
    Sz0 = fftshift(Sz0_u, axes=0)

    # New STFT:
    SFT = ShortTimeFFT.from_window(win, fs, nperseg, noverlap,
                                   fft_mode='centered',
                                   scale_to='magnitude', phase_shift=None)
    Sz1 = SFT.stft(z)

    xp_assert_close(Sz0, Sz1[:, 2:-1])

    xp_assert_close((abs(Sz1[:, 1]).min(), abs(Sz1[:, 1]).max()),
                    (6.925060911593139e-07, 8.00271269218721e-07))

    t0_r, z0_r = istft(Sz0_u, fs, win, nperseg, noverlap, input_onesided=False,
                       scaling='spectrum')
    z1_r = SFT.istft(Sz1, k1=N)
    assert len(z0_r) == N + 9
    xp_assert_close(z0_r[:N], z)
    xp_assert_close(z1_r, z)

    #  Spectrogram is just the absolute square of th STFT:
    xp_assert_close(SFT.spectrogram(z), abs(Sz1) ** 2)


def test_tutorial_stft_legacy_spectrogram():
    """Verify spectrogram example in "Comparison with Legacy Implementation"
    from the "User Guide".

    In :ref:`tutorial_stft_legacy_stft` (file ``signal.rst``) of the
    :ref:`user_guide` the legacy and the new implementation are compared.
    """
    fs, N = 200, 1001  # 200 Hz sampling rate for almost 5 s signal
    t_z = np.arange(N) / fs  # time indexes for signal
    z = np.exp(2j*np.pi*70 * (t_z - 0.2*t_z**2))  # complex-valued sweep

    nperseg, noverlap = 50, 40
    win = ('gaussian', 1e-2 * fs)  # Gaussian with 0.01 s standard dev.

    # Legacy spectrogram:
    f2_u, t2, Sz2_u = spectrogram(z, fs, win, nperseg, noverlap, detrend=None,
                                  return_onesided=False, scaling='spectrum',
                                  mode='complex')

    f2, Sz2 = fftshift(f2_u), fftshift(Sz2_u, axes=0)

    # New STFT:
    SFT = ShortTimeFFT.from_window(win, fs, nperseg, noverlap,
                                   fft_mode='centered', scale_to='magnitude',
                                   phase_shift=None)
    Sz3 = SFT.stft(z, p0=0, p1=(N-noverlap) // SFT.hop, k_offset=nperseg // 2)
    t3 = SFT.t(N, p0=0, p1=(N-noverlap) // SFT.hop, k_offset=nperseg // 2)

    xp_assert_close(t2, t3)
    xp_assert_close(f2, SFT.f)
    xp_assert_close(Sz2, Sz3)


def test_permute_axes():
    """Verify correctness of four-dimensional signal by permuting its
    shape. """
    n = 25
    SFT = ShortTimeFFT(np.ones(8)/8, hop=3, fs=n)
    x0 = np.arange(n, dtype=np.float64)
    Sx0 = SFT.stft(x0)
    Sx0 = Sx0.reshape((Sx0.shape[0], 1, 1, 1, Sx0.shape[-1]))
    SxT = np.moveaxis(Sx0, (0, -1), (-1, 0))

    atol = 2 * np.finfo(SFT.win.dtype).resolution
    for i in range(4):
        y = np.reshape(x0, np.roll((n, 1, 1, 1), i))
        Sy = SFT.stft(y, axis=i)
        xp_assert_close(Sy, np.moveaxis(Sx0, 0, i))

        yb0 = SFT.istft(Sy, k1=n, f_axis=i)
        xp_assert_close(yb0, y, atol=atol)
        # explicit t-axis parameter (for coverage):
        yb1 = SFT.istft(Sy, k1=n, f_axis=i, t_axis=Sy.ndim-1)
        xp_assert_close(yb1, y, atol=atol)

        SyT = np.moveaxis(Sy, (i, -1), (-1, i))
        xp_assert_close(SyT, np.moveaxis(SxT, 0, i))

        ybT = SFT.istft(SyT, k1=n, t_axis=i, f_axis=-1)
        xp_assert_close(ybT, y, atol=atol)


@pytest.mark.parametrize("fft_mode",
                         ('twosided', 'centered', 'onesided', 'onesided2X'))
def test_roundtrip_multidimensional(fft_mode: FFT_MODE_TYPE):
    """Test roundtrip of a multidimensional input signal versus its components.

    This test can uncover potential problems with `fftshift()`.
    """
    n = 9
    x = np.arange(4*n*2, dtype=np.float64).reshape(4, n, 2)
    SFT = ShortTimeFFT(get_window('hann', 4), hop=2, fs=1,
                       scale_to='magnitude', fft_mode=fft_mode)
    Sx = SFT.stft(x, axis=1)
    y = SFT.istft(Sx, k1=n, f_axis=1, t_axis=-1)
    xp_assert_close(y, x.astype(y.dtype), err_msg='Multidim. roundtrip failed!')

    for i, j in product(range(x.shape[0]), range(x.shape[2])):
        y_ = SFT.istft(Sx[i, :, j, :], k1=n)
        xp_assert_close(y_, x[i, :, j].astype(y_.dtype),
                        err_msg="Multidim. roundtrip for component " +
                        f"x[{i}, :, {j}] and {fft_mode=} failed!")

@pytest.mark.parametrize("phase_shift", (0, 4,  None))
def test_roundtrip_two_dimensional(phase_shift: int|None):
    """Test roundtrip of a 2 channel input signal with `mfft` set with different
    values for `phase_shift`

    Tests for Issue https://github.com/scipy/scipy/issues/21671
    """
    n = 21
    SFT = ShortTimeFFT.from_window('hann', fs=1, nperseg=13, noverlap=7,
                                   mfft=16, phase_shift=phase_shift)
    x = np.arange(2*n, dtype=float).reshape(2, n)
    Sx = SFT.stft(x)
    y = SFT.istft(Sx, k1=n)
    xp_assert_close(y, x, atol=2 * np.finfo(SFT.win.dtype).resolution,
                    err_msg='2-dim. roundtrip failed!')


@pytest.mark.parametrize('window, n, nperseg, noverlap',
                         [('boxcar', 100, 10, 0),     # Test no overlap
                          ('boxcar', 100, 10, 9),     # Test high overlap
                          ('bartlett', 101, 51, 26),  # Test odd nperseg
                          ('hann', 1024, 256, 128),   # Test defaults
                          (('tukey', 0.5), 1152, 256, 64),  # Test Tukey
                          ('hann', 1024, 256, 255),   # Test overlapped hann
                          ('boxcar', 100, 10, 3),     # NOLA True, COLA False
                          ('bartlett', 101, 51, 37),  # NOLA True, COLA False
                          ('hann', 1024, 256, 127),   # NOLA True, COLA False
                          # NOLA True, COLA False:
                          (('tukey', 0.5), 1152, 256, 14),
                          ('hann', 1024, 256, 5)])    # NOLA True, COLA False
def test_roundtrip_windows(window, n: int, nperseg: int, noverlap: int):
    """Roundtrip test adapted from `test_spectral.TestSTFT`.

    The parameters are taken from the methods test_roundtrip_real(),
    test_roundtrip_nola_not_cola(), test_roundtrip_float32(),
    test_roundtrip_complex().
    """
    np.random.seed(2394655)

    w = get_window(window, nperseg)
    SFT = ShortTimeFFT(w, nperseg - noverlap, fs=1, fft_mode='twosided',
                       phase_shift=None)

    z = 10 * np.random.randn(n) + 10j * np.random.randn(n)
    Sz = SFT.stft(z)
    z1 = SFT.istft(Sz, k1=len(z))
    xp_assert_close(z, z1, err_msg="Roundtrip for complex values failed")

    x = 10 * np.random.randn(n)
    Sx = SFT.stft(x)
    x1 = SFT.istft(Sx, k1=len(z))
    xp_assert_close(x.astype(np.complex128), x1,
                    err_msg="Roundtrip for float values failed")

    x32 = x.astype(np.float32)
    Sx32 = SFT.stft(x32)
    x32_1 = SFT.istft(Sx32, k1=len(x32))
    x32_1_r = x32_1.real
    xp_assert_close(x32, x32_1_r.astype(np.float32),
                    err_msg="Roundtrip for 32 Bit float values failed")
    xp_assert_close(x32.imag, np.zeros_like(x32.imag),
                    err_msg="Roundtrip for 32 Bit float values failed")


@pytest.mark.parametrize('signal_type', ('real', 'complex'))
def test_roundtrip_complex_window(signal_type):
    """Test roundtrip for complex-valued window function

    The purpose of this test is to check if the dual window is calculated
    correctly for complex-valued windows.
    """
    np.random.seed(1354654)
    win = np.exp(2j*np.linspace(0, np.pi, 8))
    SFT = ShortTimeFFT(win, 3, fs=1, fft_mode='twosided')

    z = 10 * np.random.randn(11)
    if signal_type == 'complex':
        z = z + 2j * z
    Sz = SFT.stft(z)
    z1 = SFT.istft(Sz, k1=len(z))
    xp_assert_close(z.astype(np.complex128), z1,
                    err_msg="Roundtrip for complex-valued window failed")


def test_average_all_segments():
    """Compare `welch` function with stft mean.

    Ported from `TestSpectrogram.test_average_all_segments` from file
    ``test__spectral.py``.
    """
    x = np.random.randn(1024)

    fs = 1.0
    window = ('tukey', 0.25)
    nperseg, noverlap = 16, 2
    fw, Pw = welch(x, fs, window, nperseg, noverlap)
    SFT = ShortTimeFFT.from_window(window, fs, nperseg, noverlap,
                                   fft_mode='onesided2X', scale_to='psd',
                                   phase_shift=None)
    # `welch` positions the window differently than the STFT:
    P = SFT.spectrogram(x, detr='constant', p0=0,
                        p1=(len(x)-noverlap)//SFT.hop, k_offset=nperseg//2)

    xp_assert_close(SFT.f, fw)
    xp_assert_close(np.mean(P, axis=-1), Pw)


@pytest.mark.parametrize('window, N, nperseg, noverlap, mfft',
                         # from test_roundtrip_padded_FFT:
                         [('hann', 1024, 256, 128, 512),
                          ('hann', 1024, 256, 128, 501),
                          ('boxcar', 100, 10, 0, 33),
                          (('tukey', 0.5), 1152, 256, 64, 1024),
                          # from test_roundtrip_padded_signal:
                          ('boxcar', 101, 10, 0, None),
                          ('hann', 1000, 256, 128, None),
                          # from test_roundtrip_boundary_extension:
                          ('boxcar', 100, 10, 0, None),
                          ('boxcar', 100, 10, 9, None)])
@pytest.mark.parametrize('padding', get_args(PAD_TYPE))
def test_stft_padding_roundtrip(window, N: int, nperseg: int, noverlap: int,
                                mfft: int, padding):
    """Test the parameter 'padding' of `stft` with roundtrips.

    The STFT parametrizations were taken from the methods
    `test_roundtrip_padded_FFT`, `test_roundtrip_padded_signal` and
    `test_roundtrip_boundary_extension` from class `TestSTFT` in  file
    ``test_spectral.py``. Note that the ShortTimeFFT does not need the
    concept of "boundary extension".
    """
    x = normal_distribution.rvs(size=N, random_state=2909)  # real signal
    z = x * np.exp(1j * np.pi / 4)  # complex signal

    SFT = ShortTimeFFT.from_window(window, 1, nperseg, noverlap,
                                   fft_mode='twosided', mfft=mfft)
    Sx = SFT.stft(x, padding=padding)
    x1 = SFT.istft(Sx, k1=N)
    xp_assert_close(x1, x.astype(np.complex128),
                    err_msg=f"Failed real roundtrip with '{padding}' padding")

    Sz = SFT.stft(z, padding=padding)
    z1 = SFT.istft(Sz, k1=N)
    xp_assert_close(z1, z, err_msg="Failed complex roundtrip with " +
                    f" '{padding}' padding")


@pytest.mark.parametrize('N_x', (128, 129, 255, 256, 1337))  # signal length
@pytest.mark.parametrize('w_size', (128, 256))  # window length
@pytest.mark.parametrize('t_step', (4, 64))  # SFT time hop
@pytest.mark.parametrize('f_c', (7., 23.))  # frequency of input sine
def test_energy_conservation(N_x: int, w_size: int, t_step: int, f_c: float):
    """Test if a `psd`-scaled STFT conserves the L2 norm.

    This test is adapted from MNE-Python [1]_. Besides being battle-tested,
    this test has the benefit of using non-standard window including
    non-positive values and a 2d input signal.

    Since `ShortTimeFFT` requires the signal length `N_x` to be at least the
    window length `w_size`, the parameter `N_x` was changed from
    ``(127, 128, 255, 256, 1337)`` to ``(128, 129, 255, 256, 1337)`` to be
    more useful.

    .. [1] File ``test_stft.py`` of MNE-Python
        https://github.com/mne-tools/mne-python/blob/main/mne/time_frequency/tests/test_stft.py
    """
    window = np.sin(np.arange(.5, w_size + .5) / w_size * np.pi)
    SFT = ShortTimeFFT(window, t_step, fs=1000, fft_mode='onesided2X',
                       scale_to='psd')
    atol = 2*np.finfo(window.dtype).resolution
    N_x = max(N_x, w_size)  # minimal sing
    # Test with low frequency signal
    t = np.arange(N_x).astype(np.float64)
    x = np.sin(2 * np.pi * f_c * t * SFT.T)
    x = np.array([x, x + 1.])
    X = SFT.stft(x)
    xp = SFT.istft(X, k1=N_x)

    max_freq = SFT.f[np.argmax(np.sum(np.abs(X[0]) ** 2, axis=1))]

    assert X.shape[1] == SFT.f_pts
    assert np.all(SFT.f >= 0.)
    assert np.abs(max_freq - f_c) < 1.
    xp_assert_close(x, xp, atol=atol)

    # check L2-norm squared (i.e., energy) conservation:
    E_x = np.sum(x**2, axis=-1) * SFT.T  # numerical integration
    aX2 = X.real**2 + X.imag.real**2
    E_X = np.sum(np.sum(aX2, axis=-1) * SFT.delta_t, axis=-1) * SFT.delta_f
    xp_assert_close(E_X, E_x, atol=atol)

    # Test with random signal
    np.random.seed(2392795)
    x = np.random.randn(2, N_x)
    X = SFT.stft(x)
    xp = SFT.istft(X, k1=N_x)

    assert X.shape[1] == SFT.f_pts
    assert np.all(SFT.f >= 0.)
    assert np.abs(max_freq - f_c) < 1.
    xp_assert_close(x, xp, atol=atol)

    # check L2-norm squared (i.e., energy) conservation:
    E_x = np.sum(x**2, axis=-1) * SFT.T  # numeric integration
    aX2 = X.real ** 2 + X.imag.real ** 2
    E_X = np.sum(np.sum(aX2, axis=-1) * SFT.delta_t, axis=-1) * SFT.delta_f
    xp_assert_close(E_X, E_x, atol=atol)

    # Try with empty array
    x = np.zeros((0, N_x))
    X = SFT.stft(x)
    xp = SFT.istft(X, k1=N_x)
    assert xp.shape == x.shape
