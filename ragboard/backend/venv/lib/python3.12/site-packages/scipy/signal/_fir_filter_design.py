"""Functions for FIR filter design."""

from math import ceil, log, log2
import warnings
from typing import Literal

import numpy as np
from scipy.fft import irfft, fft, ifft
from scipy.linalg import (toeplitz, hankel, solve, LinAlgError, LinAlgWarning,
                          lstsq)
from scipy.signal._arraytools import _validate_fs

from . import _sigtools

from scipy._lib._array_api import array_namespace, xp_size, xp_default_dtype
import scipy._lib.array_api_extra as xpx


__all__ = ['kaiser_beta', 'kaiser_atten', 'kaiserord',
           'firwin', 'firwin2', 'firwin_2d', 'remez', 'firls', 'minimum_phase']


# Some notes on function parameters:
#
# `cutoff` and `width` are given as numbers between 0 and 1.  These are
# relative frequencies, expressed as a fraction of the Nyquist frequency.
# For example, if the Nyquist frequency is 2 KHz, then width=0.15 is a width
# of 300 Hz.
#
# The `order` of a FIR filter is one less than the number of taps.
# This is a potential source of confusion, so in the following code,
# we will always use the number of taps as the parameterization of
# the 'size' of the filter. The "number of taps" means the number
# of coefficients, which is the same as the length of the impulse
# response of the filter.


def kaiser_beta(a):
    """Compute the Kaiser parameter `beta`, given the attenuation `a`.

    Parameters
    ----------
    a : float
        The desired attenuation in the stopband and maximum ripple in
        the passband, in dB.  This should be a *positive* number.

    Returns
    -------
    beta : float
        The `beta` parameter to be used in the formula for a Kaiser window.

    References
    ----------
    Oppenheim, Schafer, "Discrete-Time Signal Processing", p.475-476.

    Examples
    --------
    Suppose we want to design a lowpass filter, with 65 dB attenuation
    in the stop band.  The Kaiser window parameter to be used in the
    window method is computed by ``kaiser_beta(65)``:

    >>> from scipy.signal import kaiser_beta
    >>> kaiser_beta(65)
    6.20426

    """
    if a > 50:
        beta = 0.1102 * (a - 8.7)
    elif a > 21:
        beta = 0.5842 * (a - 21) ** 0.4 + 0.07886 * (a - 21)
    else:
        beta = 0.0
    return beta


def kaiser_atten(numtaps, width):
    """Compute the attenuation of a Kaiser FIR filter.

    Given the number of taps `N` and the transition width `width`, compute the
    attenuation `a` in dB, given by Kaiser's formula:

        a = 2.285 * (N - 1) * pi * width + 7.95

    Parameters
    ----------
    numtaps : int
        The number of taps in the FIR filter.
    width : float
        The desired width of the transition region between passband and
        stopband (or, in general, at any discontinuity) for the filter,
        expressed as a fraction of the Nyquist frequency.

    Returns
    -------
    a : float
        The attenuation of the ripple, in dB.

    See Also
    --------
    kaiserord, kaiser_beta

    Examples
    --------
    Suppose we want to design a FIR filter using the Kaiser window method
    that will have 211 taps and a transition width of 9 Hz for a signal that
    is sampled at 480 Hz. Expressed as a fraction of the Nyquist frequency,
    the width is 9/(0.5*480) = 0.0375. The approximate attenuation (in dB)
    is computed as follows:

    >>> from scipy.signal import kaiser_atten
    >>> kaiser_atten(211, 0.0375)
    64.48099630593983

    """
    a = 2.285 * (numtaps - 1) * np.pi * width + 7.95
    return a


def kaiserord(ripple, width):
    """
    Determine the filter window parameters for the Kaiser window method.

    The parameters returned by this function are generally used to create
    a finite impulse response filter using the window method, with either
    `firwin` or `firwin2`.

    Parameters
    ----------
    ripple : float
        Upper bound for the deviation (in dB) of the magnitude of the
        filter's frequency response from that of the desired filter (not
        including frequencies in any transition intervals). That is, if w
        is the frequency expressed as a fraction of the Nyquist frequency,
        A(w) is the actual frequency response of the filter and D(w) is the
        desired frequency response, the design requirement is that::

            abs(A(w) - D(w))) < 10**(-ripple/20)

        for 0 <= w <= 1 and w not in a transition interval.
    width : float
        Width of transition region, normalized so that 1 corresponds to pi
        radians / sample. That is, the frequency is expressed as a fraction
        of the Nyquist frequency.

    Returns
    -------
    numtaps : int
        The length of the Kaiser window.
    beta : float
        The beta parameter for the Kaiser window.

    See Also
    --------
    kaiser_beta, kaiser_atten

    Notes
    -----
    There are several ways to obtain the Kaiser window:

    - ``signal.windows.kaiser(numtaps, beta, sym=True)``
    - ``signal.get_window(beta, numtaps)``
    - ``signal.get_window(('kaiser', beta), numtaps)``

    The empirical equations discovered by Kaiser are used.

    References
    ----------
    Oppenheim, Schafer, "Discrete-Time Signal Processing", pp.475-476.

    Examples
    --------
    We will use the Kaiser window method to design a lowpass FIR filter
    for a signal that is sampled at 1000 Hz.

    We want at least 65 dB rejection in the stop band, and in the pass
    band the gain should vary no more than 0.5%.

    We want a cutoff frequency of 175 Hz, with a transition between the
    pass band and the stop band of 24 Hz. That is, in the band [0, 163],
    the gain varies no more than 0.5%, and in the band [187, 500], the
    signal is attenuated by at least 65 dB.

    >>> import numpy as np
    >>> from scipy.signal import kaiserord, firwin, freqz
    >>> import matplotlib.pyplot as plt
    >>> fs = 1000.0
    >>> cutoff = 175
    >>> width = 24

    The Kaiser method accepts just a single parameter to control the pass
    band ripple and the stop band rejection, so we use the more restrictive
    of the two. In this case, the pass band ripple is 0.005, or 46.02 dB,
    so we will use 65 dB as the design parameter.

    Use `kaiserord` to determine the length of the filter and the
    parameter for the Kaiser window.

    >>> numtaps, beta = kaiserord(65, width/(0.5*fs))
    >>> numtaps
    167
    >>> beta
    6.20426

    Use `firwin` to create the FIR filter.

    >>> taps = firwin(numtaps, cutoff, window=('kaiser', beta),
    ...               scale=False, fs=fs)

    Compute the frequency response of the filter.  ``w`` is the array of
    frequencies, and ``h`` is the corresponding complex array of frequency
    responses.

    >>> w, h = freqz(taps, worN=8000)
    >>> w *= 0.5*fs/np.pi  # Convert w to Hz.

    Compute the deviation of the magnitude of the filter's response from
    that of the ideal lowpass filter. Values in the transition region are
    set to ``nan``, so they won't appear in the plot.

    >>> ideal = w < cutoff  # The "ideal" frequency response.
    >>> deviation = np.abs(np.abs(h) - ideal)
    >>> deviation[(w > cutoff - 0.5*width) & (w < cutoff + 0.5*width)] = np.nan

    Plot the deviation. A close look at the left end of the stop band shows
    that the requirement for 65 dB attenuation is violated in the first lobe
    by about 0.125 dB. This is not unusual for the Kaiser window method.

    >>> plt.plot(w, 20*np.log10(np.abs(deviation)))
    >>> plt.xlim(0, 0.5*fs)
    >>> plt.ylim(-90, -60)
    >>> plt.grid(alpha=0.25)
    >>> plt.axhline(-65, color='r', ls='--', alpha=0.3)
    >>> plt.xlabel('Frequency (Hz)')
    >>> plt.ylabel('Deviation from ideal (dB)')
    >>> plt.title('Lowpass Filter Frequency Response')
    >>> plt.show()

    """
    A = abs(ripple)  # in case somebody is confused as to what's meant
    if A < 8:
        # Formula for N is not valid in this range.
        raise ValueError("Requested maximum ripple attenuation "
                         f"{A:f} is too small for the Kaiser formula.")
    beta = kaiser_beta(A)

    # Kaiser's formula (as given in Oppenheim and Schafer) is for the filter
    # order, so we have to add 1 to get the number of taps.
    numtaps = (A - 7.95) / 2.285 / (np.pi * width) + 1

    return int(ceil(numtaps)), beta


def firwin(numtaps, cutoff, *, width=None, window='hamming', pass_zero=True,
           scale=True, fs=None):
    """
    FIR filter design using the window method.

    This function computes the coefficients of a finite impulse response
    filter. The filter will have linear phase; it will be Type I if
    `numtaps` is odd and Type II if `numtaps` is even.

    Type II filters always have zero response at the Nyquist frequency, so a
    ValueError exception is raised if firwin is called with `numtaps` even and
    having a passband whose right end is at the Nyquist frequency.

    Parameters
    ----------
    numtaps : int
        Length of the filter (number of coefficients, i.e. the filter
        order + 1).  `numtaps` must be odd if a passband includes the
        Nyquist frequency.
    cutoff : float or 1-D array_like
        Cutoff frequency of filter (expressed in the same units as `fs`)
        OR an array of cutoff frequencies (that is, band edges). In the 
        former case, as a float, the cutoff frequency should correspond 
        with the half-amplitude point, where the attenuation will be -6dB. 
        In the latter case, the frequencies in `cutoff` should be positive 
        and monotonically increasing between 0 and `fs/2`. The values 0 
        and `fs/2` must not be included in `cutoff`. It should be noted 
        that this is different than the behavior of `scipy.signal.iirdesign`, 
        where the cutoff is the half-power point (-3dB).
    width : float or None, optional
        If `width` is not None, then assume it is the approximate width
        of the transition region (expressed in the same units as `fs`)
        for use in Kaiser FIR filter design. In this case, the `window`
        argument is ignored.
    window : string or tuple of string and parameter values, optional
        Desired window to use. See `scipy.signal.get_window` for a list
        of windows and required parameters.
    pass_zero : {True, False, 'bandpass', 'lowpass', 'highpass', 'bandstop'}, optional
        If True, the gain at the frequency 0 (i.e., the "DC gain") is 1.
        If False, the DC gain is 0. Can also be a string argument for the
        desired filter type (equivalent to ``btype`` in IIR design functions).

        .. versionadded:: 1.3.0
           Support for string arguments.
    scale : bool, optional
        Set to True to scale the coefficients so that the frequency
        response is exactly unity at a certain frequency.
        That frequency is either:

        - 0 (DC) if the first passband starts at 0 (i.e. pass_zero
          is True)
        - `fs/2` (the Nyquist frequency) if the first passband ends at
          `fs/2` (i.e the filter is a single band highpass filter);
          center of first passband otherwise

    fs : float, optional
        The sampling frequency of the signal. Each frequency in `cutoff`
        must be between 0 and ``fs/2``.  Default is 2.

    Returns
    -------
    h : (numtaps,) ndarray
        Coefficients of length `numtaps` FIR filter.

    Raises
    ------
    ValueError
        If any value in `cutoff` is less than or equal to 0 or greater
        than or equal to ``fs/2``, if the values in `cutoff` are not strictly
        monotonically increasing, or if `numtaps` is even but a passband
        includes the Nyquist frequency.

    See Also
    --------
    firwin2
    firwin_2d
    firls
    minimum_phase
    remez

    Examples
    --------
    Low-pass from 0 to f:

    >>> from scipy import signal
    >>> numtaps = 3
    >>> f = 0.1
    >>> signal.firwin(numtaps, f)
    array([ 0.06799017,  0.86401967,  0.06799017])

    Use a specific window function:

    >>> signal.firwin(numtaps, f, window='nuttall')
    array([  3.56607041e-04,   9.99286786e-01,   3.56607041e-04])

    High-pass ('stop' from 0 to f):

    >>> signal.firwin(numtaps, f, pass_zero=False)
    array([-0.00859313,  0.98281375, -0.00859313])

    Band-pass:

    >>> f1, f2 = 0.1, 0.2
    >>> signal.firwin(numtaps, [f1, f2], pass_zero=False)
    array([ 0.06301614,  0.88770441,  0.06301614])

    Band-stop:

    >>> signal.firwin(numtaps, [f1, f2])
    array([-0.00801395,  1.0160279 , -0.00801395])

    Multi-band (passbands are [0, f1], [f2, f3] and [f4, 1]):

    >>> f3, f4 = 0.3, 0.4
    >>> signal.firwin(numtaps, [f1, f2, f3, f4])
    array([-0.01376344,  1.02752689, -0.01376344])

    Multi-band (passbands are [f1, f2] and [f3,f4]):

    >>> signal.firwin(numtaps, [f1, f2, f3, f4], pass_zero=False)
    array([ 0.04890915,  0.91284326,  0.04890915])

    """
    # NB: scipy's version of array_namespace returns `np_compat` for int or floats
    xp = array_namespace(cutoff)

    # The major enhancements to this function added in November 2010 were
    # developed by Tom Krauss (see ticket #902).
    fs = _validate_fs(fs, allow_none=True)
    fs = 2 if fs is None else fs

    nyq = 0.5 * fs

    cutoff = xp.asarray(cutoff, dtype=xp_default_dtype(xp))
    cutoff = xpx.atleast_nd(cutoff, ndim=1, xp=xp) / float(nyq)

    # Check for invalid input.
    if cutoff.ndim > 1:
        raise ValueError("The cutoff argument must be at most "
                         "one-dimensional.")
    if xp_size(cutoff) == 0:
        raise ValueError("At least one cutoff frequency must be given.")
    if xp.min(cutoff) <= 0 or xp.max(cutoff) >= 1:
        raise ValueError("Invalid cutoff frequency: frequencies must be "
                         "greater than 0 and less than fs/2.")
    if xp.any(cutoff[1:] - cutoff[:-1] <= 0):
        raise ValueError("Invalid cutoff frequencies: the frequencies "
                         "must be strictly increasing.")

    if width is not None:
        # A width was given.  Find the beta parameter of the Kaiser window
        # and set `window`.  This overrides the value of `window` passed in.
        atten = kaiser_atten(numtaps, float(width) / nyq)
        beta = kaiser_beta(atten)
        window = ('kaiser', beta)

    if pass_zero in ('bandstop', 'lowpass'):
        if pass_zero == 'lowpass':
            if xp_size(cutoff) != 1:
                raise ValueError('cutoff must have one element if '
                                 f'pass_zero=="lowpass", got {cutoff.shape}')
        elif xp_size(cutoff) <= 1:
            raise ValueError('cutoff must have at least two elements if '
                             f'pass_zero=="bandstop", got {cutoff.shape}')
        pass_zero = True
    elif pass_zero in ('bandpass', 'highpass'):
        if pass_zero == 'highpass':
            if xp_size(cutoff) != 1:
                raise ValueError('cutoff must have one element if '
                                 f'pass_zero=="highpass", got {cutoff.shape}')
        elif xp_size(cutoff) <= 1:
            raise ValueError('cutoff must have at least two elements if '
                             f'pass_zero=="bandpass", got {cutoff.shape}')
        pass_zero = False
    elif not (pass_zero is True or pass_zero is False):
        raise ValueError(f"Parameter {pass_zero=} not in (True, False, 'bandpass', " +
                         "'lowpass', 'highpass', 'bandstop')")

    pass_nyquist = (xp_size(cutoff) % 2 == 0) == pass_zero
    if pass_nyquist and numtaps % 2 == 0:
        raise ValueError("A filter with an even number of coefficients must "
                         "have zero response at the Nyquist frequency.")

    # Insert 0 and/or 1 at the ends of cutoff so that the length of cutoff
    # is even, and each pair in cutoff corresponds to passband.
    cutoff = xp.concat((xp.zeros(int(pass_zero)), cutoff, xp.ones(int(pass_nyquist))))


    # `bands` is a 2-D array; each row gives the left and right edges of
    # a passband.
    bands = xp.reshape(cutoff, (-1, 2))

    # Build up the coefficients.
    alpha = 0.5 * (numtaps - 1)
    m = xp.arange(0, numtaps, dtype=cutoff.dtype) - alpha
    h = 0
    for j in range(bands.shape[0]):
        left, right = bands[j, 0], bands[j, 1]
        h += right * xpx.sinc(right * m, xp=xp)
        h -= left * xpx.sinc(left * m, xp=xp)

    # Get and apply the window function.
    from .windows import get_window
    win = get_window(window, numtaps, fftbins=False, xp=xp)
    h *= win

    # Now handle scaling if desired.
    if scale:
        # Get the first passband.
        left, right = bands[0, ...]
        if left == 0:
            scale_frequency = 0.0
        elif right == 1:
            scale_frequency = 1.0
        else:
            scale_frequency = 0.5 * (left + right)
        c = xp.cos(xp.pi * m * scale_frequency)
        s = xp.sum(h * c)
        h /= s

    return h


# Original version of firwin2 from scipy ticket #457, submitted by "tash".
#
# Rewritten by Warren Weckesser, 2010.
def firwin2(numtaps, freq, gain, *, nfreqs=None, window='hamming',
            antisymmetric=False, fs=None):
    """
    FIR filter design using the window method.

    From the given frequencies `freq` and corresponding gains `gain`,
    this function constructs an FIR filter with linear phase and
    (approximately) the given frequency response.

    Parameters
    ----------
    numtaps : int
        The number of taps in the FIR filter.  `numtaps` must be less than
        `nfreqs`.
    freq : array_like, 1-D
        The frequency sampling points. Typically 0.0 to 1.0 with 1.0 being
        Nyquist.  The Nyquist frequency is half `fs`.
        The values in `freq` must be nondecreasing. A value can be repeated
        once to implement a discontinuity. The first value in `freq` must
        be 0, and the last value must be ``fs/2``. Values 0 and ``fs/2`` must
        not be repeated.
    gain : array_like
        The filter gains at the frequency sampling points. Certain
        constraints to gain values, depending on the filter type, are applied,
        see Notes for details.
    nfreqs : int, optional
        The size of the interpolation mesh used to construct the filter.
        For most efficient behavior, this should be a power of 2 plus 1
        (e.g, 129, 257, etc). The default is one more than the smallest
        power of 2 that is not less than `numtaps`. `nfreqs` must be greater
        than `numtaps`.
    window : string or (string, float) or float, or None, optional
        Window function to use. Default is "hamming". See
        `scipy.signal.get_window` for the complete list of possible values.
        If None, no window function is applied.
    antisymmetric : bool, optional
        Whether resulting impulse response is symmetric/antisymmetric.
        See Notes for more details.
    fs : float, optional
        The sampling frequency of the signal. Each frequency in `cutoff`
        must be between 0 and ``fs/2``. Default is 2.

    Returns
    -------
    taps : ndarray
        The filter coefficients of the FIR filter, as a 1-D array of length
        `numtaps`.

    See Also
    --------
    firls
    firwin
    minimum_phase
    remez

    Notes
    -----
    From the given set of frequencies and gains, the desired response is
    constructed in the frequency domain. The inverse FFT is applied to the
    desired response to create the associated convolution kernel, and the
    first `numtaps` coefficients of this kernel, scaled by `window`, are
    returned.

    The FIR filter will have linear phase. The type of filter is determined by
    the value of 'numtaps` and `antisymmetric` flag.
    There are four possible combinations:

       - odd  `numtaps`, `antisymmetric` is False, type I filter is produced
       - even `numtaps`, `antisymmetric` is False, type II filter is produced
       - odd  `numtaps`, `antisymmetric` is True, type III filter is produced
       - even `numtaps`, `antisymmetric` is True, type IV filter is produced

    Magnitude response of all but type I filters are subjects to following
    constraints:

       - type II  -- zero at the Nyquist frequency
       - type III -- zero at zero and Nyquist frequencies
       - type IV  -- zero at zero frequency

    .. versionadded:: 0.9.0

    References
    ----------
    .. [1] Oppenheim, A. V. and Schafer, R. W., "Discrete-Time Signal
       Processing", Prentice-Hall, Englewood Cliffs, New Jersey (1989).
       (See, for example, Section 7.4.)

    .. [2] Smith, Steven W., "The Scientist and Engineer's Guide to Digital
       Signal Processing", Ch. 17. http://www.dspguide.com/ch17/1.htm

    Examples
    --------
    A lowpass FIR filter with a response that is 1 on [0.0, 0.5], and
    that decreases linearly on [0.5, 1.0] from 1 to 0:

    >>> from scipy import signal
    >>> taps = signal.firwin2(150, [0.0, 0.5, 1.0], [1.0, 1.0, 0.0])
    >>> print(taps[72:78])
    [-0.02286961 -0.06362756  0.57310236  0.57310236 -0.06362756 -0.02286961]

    """
    xp = array_namespace(freq, gain)
    freq, gain = xp.asarray(freq), xp.asarray(gain)

    fs = _validate_fs(fs, allow_none=True)
    fs = 2 if fs is None else fs
    nyq = 0.5 * fs

    if freq.shape[0] != gain.shape[0]:
        raise ValueError('freq and gain must be of same length.')

    if nfreqs is not None and numtaps >= nfreqs:
        raise ValueError(
            f'ntaps must be less than nfreqs, but firwin2 was called with '
            f'ntaps={numtaps} and nfreqs={nfreqs}'
        )

    if freq[0] != 0 or freq[-1] != nyq:
        raise ValueError('freq must start with 0 and end with fs/2.')
    d = freq[1:] - freq[:-1]
    if xp.any(d < 0):
        raise ValueError('The values in freq must be nondecreasing.')
    d2 = d[:-1] + d[1:]
    if xp.any(d2 == 0):
        raise ValueError('A value in freq must not occur more than twice.')
    if freq[1] == 0:
        raise ValueError('Value 0 must not be repeated in freq')
    if freq[-2] == nyq:
        raise ValueError('Value fs/2 must not be repeated in freq')

    if antisymmetric:
        if numtaps % 2 == 0:
            ftype = 4
        else:
            ftype = 3
    else:
        if numtaps % 2 == 0:
            ftype = 2
        else:
            ftype = 1

    if ftype == 2 and gain[-1] != 0.0:
        raise ValueError("A Type II filter must have zero gain at the "
                         "Nyquist frequency.")
    elif ftype == 3 and (gain[0] != 0.0 or gain[-1] != 0.0):
        raise ValueError("A Type III filter must have zero gain at zero "
                         "and Nyquist frequencies.")
    elif ftype == 4 and gain[0] != 0.0:
        raise ValueError("A Type IV filter must have zero gain at zero "
                         "frequency.")

    if nfreqs is None:
        nfreqs = 1 + 2 ** int(ceil(log(numtaps, 2)))

    if xp.any(d == 0):
        # Tweak any repeated values in freq so that interp works.
        freq = xp.asarray(freq, copy=True)
        eps = xp.finfo(xp_default_dtype(xp)).eps * nyq
        for k in range(freq.shape[0] - 1):
            if freq[k] == freq[k + 1]:
                freq[k] = freq[k] - eps
                freq[k + 1] = freq[k + 1] + eps
        # Check if freq is strictly increasing after tweak
        d = freq[1:] - freq[:-1]
        if xp.any(d <= 0):
            raise ValueError("freq cannot contain numbers that are too close "
                             "(within eps * (fs/2): "
                             f"{eps}) to a repeated value")

    # Linearly interpolate the desired response on a uniform mesh `x`.
    x = np.linspace(0.0, nyq, nfreqs)
    fx = np.interp(x, np.asarray(freq), np.asarray(gain))  # XXX array-api-extra#193
    x = xp.asarray(x)
    fx = xp.asarray(fx)

    # Adjust the phases of the coefficients so that the first `ntaps` of the
    # inverse FFT are the desired filter coefficients.
    shift = xp.exp(-(numtaps - 1) / 2. * 1j * xp.pi * x / nyq)
    if ftype > 2:
        shift *= 1j

    fx2 = fx * shift

    # Use irfft to compute the inverse FFT.
    out_full = irfft(fx2)

    if window is not None:
        # Create the window to apply to the filter coefficients.
        from .windows import get_window
        wind = get_window(window, numtaps, fftbins=False, xp=xp)
    else:
        wind = 1

    # Keep only the first `numtaps` coefficients in `out`, and multiply by
    # the window.
    out = out_full[:numtaps] * wind

    if ftype == 3:
        out[xp_size(out) // 2] = 0.0

    return out


def remez(numtaps, bands, desired, *, weight=None, type='bandpass',
          maxiter=25, grid_density=16, fs=None):
    """
    Calculate the minimax optimal filter using the Remez exchange algorithm.

    Calculate the filter-coefficients for the finite impulse response
    (FIR) filter whose transfer function minimizes the maximum error
    between the desired gain and the realized gain in the specified
    frequency bands using the Remez exchange algorithm.

    Parameters
    ----------
    numtaps : int
        The desired number of taps in the filter. The number of taps is
        the number of terms in the filter, or the filter order plus one.
    bands : array_like
        A monotonic sequence containing the band edges.
        All elements must be non-negative and less than half the sampling
        frequency as given by `fs`.
    desired : array_like
        A sequence half the size of bands containing the desired gain
        in each of the specified bands.
    weight : array_like, optional
        A relative weighting to give to each band region. The length of
        `weight` has to be half the length of `bands`.
    type : {'bandpass', 'differentiator', 'hilbert'}, optional
        The type of filter:

          * 'bandpass' : flat response in bands. This is the default.

          * 'differentiator' : frequency proportional response in bands.

          * 'hilbert' : filter with odd symmetry, that is, type III
                        (for even order) or type IV (for odd order)
                        linear phase filters.

    maxiter : int, optional
        Maximum number of iterations of the algorithm. Default is 25.
    grid_density : int, optional
        Grid density. The dense grid used in `remez` is of size
        ``(numtaps + 1) * grid_density``. Default is 16.
    fs : float, optional
        The sampling frequency of the signal.  Default is 1.

    Returns
    -------
    out : ndarray
        A rank-1 array containing the coefficients of the optimal
        (in a minimax sense) filter.

    See Also
    --------
    firls
    firwin
    firwin2
    minimum_phase

    References
    ----------
    .. [1] J. H. McClellan and T. W. Parks, "A unified approach to the
           design of optimum FIR linear phase digital filters",
           IEEE Trans. Circuit Theory, vol. CT-20, pp. 697-701, 1973.
    .. [2] J. H. McClellan, T. W. Parks and L. R. Rabiner, "A Computer
           Program for Designing Optimum FIR Linear Phase Digital
           Filters", IEEE Trans. Audio Electroacoust., vol. AU-21,
           pp. 506-525, 1973.

    Examples
    --------
    In these examples, `remez` is used to design low-pass, high-pass,
    band-pass and band-stop filters.  The parameters that define each filter
    are the filter order, the band boundaries, the transition widths of the
    boundaries, the desired gains in each band, and the sampling frequency.

    We'll use a sample frequency of 22050 Hz in all the examples.  In each
    example, the desired gain in each band is either 0 (for a stop band)
    or 1 (for a pass band).

    `freqz` is used to compute the frequency response of each filter, and
    the utility function ``plot_response`` defined below is used to plot
    the response.

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt

    >>> fs = 22050   # Sample rate, Hz

    >>> def plot_response(w, h, title):
    ...     "Utility function to plot response functions"
    ...     fig = plt.figure()
    ...     ax = fig.add_subplot(111)
    ...     ax.plot(w, 20*np.log10(np.abs(h)))
    ...     ax.set_ylim(-40, 5)
    ...     ax.grid(True)
    ...     ax.set_xlabel('Frequency (Hz)')
    ...     ax.set_ylabel('Gain (dB)')
    ...     ax.set_title(title)

    The first example is a low-pass filter, with cutoff frequency 8 kHz.
    The filter length is 325, and the transition width from pass to stop
    is 100 Hz.

    >>> cutoff = 8000.0    # Desired cutoff frequency, Hz
    >>> trans_width = 100  # Width of transition from pass to stop, Hz
    >>> numtaps = 325      # Size of the FIR filter.
    >>> taps = signal.remez(numtaps, [0, cutoff, cutoff + trans_width, 0.5*fs],
    ...                     [1, 0], fs=fs)
    >>> w, h = signal.freqz(taps, [1], worN=2000, fs=fs)
    >>> plot_response(w, h, "Low-pass Filter")
    >>> plt.show()

    This example shows a high-pass filter:

    >>> cutoff = 2000.0    # Desired cutoff frequency, Hz
    >>> trans_width = 250  # Width of transition from pass to stop, Hz
    >>> numtaps = 125      # Size of the FIR filter.
    >>> taps = signal.remez(numtaps, [0, cutoff - trans_width, cutoff, 0.5*fs],
    ...                     [0, 1], fs=fs)
    >>> w, h = signal.freqz(taps, [1], worN=2000, fs=fs)
    >>> plot_response(w, h, "High-pass Filter")
    >>> plt.show()

    This example shows a band-pass filter with a pass-band from 2 kHz to
    5 kHz.  The transition width is 260 Hz and the length of the filter
    is 63, which is smaller than in the other examples:

    >>> band = [2000, 5000]  # Desired pass band, Hz
    >>> trans_width = 260    # Width of transition from pass to stop, Hz
    >>> numtaps = 63         # Size of the FIR filter.
    >>> edges = [0, band[0] - trans_width, band[0], band[1],
    ...          band[1] + trans_width, 0.5*fs]
    >>> taps = signal.remez(numtaps, edges, [0, 1, 0], fs=fs)
    >>> w, h = signal.freqz(taps, [1], worN=2000, fs=fs)
    >>> plot_response(w, h, "Band-pass Filter")
    >>> plt.show()

    The low order leads to higher ripple and less steep transitions.

    The next example shows a band-stop filter.

    >>> band = [6000, 8000]  # Desired stop band, Hz
    >>> trans_width = 200    # Width of transition from pass to stop, Hz
    >>> numtaps = 175        # Size of the FIR filter.
    >>> edges = [0, band[0] - trans_width, band[0], band[1],
    ...          band[1] + trans_width, 0.5*fs]
    >>> taps = signal.remez(numtaps, edges, [1, 0, 1], fs=fs)
    >>> w, h = signal.freqz(taps, [1], worN=2000, fs=fs)
    >>> plot_response(w, h, "Band-stop Filter")
    >>> plt.show()

    """
    xp = array_namespace(bands, desired, weight)
    bands = np.asarray(bands)
    desired = np.asarray(desired)
    if weight:
        weight = np.asarray(weight)

    fs = _validate_fs(fs, allow_none=True)
    fs = 1.0 if fs is None else fs

    # Convert type
    try:
        tnum = {'bandpass': 1, 'differentiator': 2, 'hilbert': 3}[type]
    except KeyError as e:
        raise ValueError("Type must be 'bandpass', 'differentiator', "
                         "or 'hilbert'") from e

    # Convert weight
    if weight is None:
        weight = [1] * len(desired)

    bands = np.asarray(bands).copy()
    result = _sigtools._remez(numtaps, bands, desired, weight, tnum, fs,
                              maxiter, grid_density)
    return xp.asarray(result)


def firls(numtaps, bands, desired, *, weight=None, fs=None):
    """
    FIR filter design using least-squares error minimization.

    Calculate the filter coefficients for the linear-phase finite
    impulse response (FIR) filter which has the best approximation
    to the desired frequency response described by `bands` and
    `desired` in the least squares sense (i.e., the integral of the
    weighted mean-squared error within the specified bands is
    minimized).

    Parameters
    ----------
    numtaps : int
        The number of taps in the FIR filter. `numtaps` must be odd.
    bands : array_like
        A monotonic nondecreasing sequence containing the band edges in
        Hz. All elements must be non-negative and less than or equal to
        the Nyquist frequency given by `nyq`. The bands are specified as
        frequency pairs, thus, if using a 1D array, its length must be
        even, e.g., `np.array([0, 1, 2, 3, 4, 5])`. Alternatively, the
        bands can be specified as an nx2 sized 2D array, where n is the
        number of bands, e.g, `np.array([[0, 1], [2, 3], [4, 5]])`.
    desired : array_like
        A sequence the same size as `bands` containing the desired gain
        at the start and end point of each band.
    weight : array_like, optional
        A relative weighting to give to each band region when solving
        the least squares problem. `weight` has to be half the size of
        `bands`.
    fs : float, optional
        The sampling frequency of the signal. Each frequency in `bands`
        must be between 0 and ``fs/2`` (inclusive). Default is 2.

    Returns
    -------
    coeffs : ndarray
        Coefficients of the optimal (in a least squares sense) FIR filter.

    See Also
    --------
    firwin
    firwin2
    minimum_phase
    remez

    Notes
    -----
    This implementation follows the algorithm given in [1]_.
    As noted there, least squares design has multiple advantages:

        1. Optimal in a least-squares sense.
        2. Simple, non-iterative method.
        3. The general solution can obtained by solving a linear
           system of equations.
        4. Allows the use of a frequency dependent weighting function.

    This function constructs a Type I linear phase FIR filter, which
    contains an odd number of `coeffs` satisfying for :math:`n < numtaps`:

    .. math:: coeffs(n) = coeffs(numtaps - 1 - n)

    The odd number of coefficients and filter symmetry avoid boundary
    conditions that could otherwise occur at the Nyquist and 0 frequencies
    (e.g., for Type II, III, or IV variants).

    .. versionadded:: 0.18

    References
    ----------
    .. [1] Ivan Selesnick, Linear-Phase Fir Filter Design By Least Squares.
           OpenStax CNX. Aug 9, 2005.
           https://eeweb.engineering.nyu.edu/iselesni/EL713/firls/firls.pdf

    Examples
    --------
    We want to construct a band-pass filter. Note that the behavior in the
    frequency ranges between our stop bands and pass bands is unspecified,
    and thus may overshoot depending on the parameters of our filter:

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> fig, axs = plt.subplots(2)
    >>> fs = 10.0  # Hz
    >>> desired = (0, 0, 1, 1, 0, 0)
    >>> for bi, bands in enumerate(((0, 1, 2, 3, 4, 5), (0, 1, 2, 4, 4.5, 5))):
    ...     fir_firls = signal.firls(73, bands, desired, fs=fs)
    ...     fir_remez = signal.remez(73, bands, desired[::2], fs=fs)
    ...     fir_firwin2 = signal.firwin2(73, bands, desired, fs=fs)
    ...     hs = list()
    ...     ax = axs[bi]
    ...     for fir in (fir_firls, fir_remez, fir_firwin2):
    ...         freq, response = signal.freqz(fir)
    ...         hs.append(ax.semilogy(0.5*fs*freq/np.pi, np.abs(response))[0])
    ...     for band, gains in zip(zip(bands[::2], bands[1::2]),
    ...                            zip(desired[::2], desired[1::2])):
    ...         ax.semilogy(band, np.maximum(gains, 1e-7), 'k--', linewidth=2)
    ...     if bi == 0:
    ...         ax.legend(hs, ('firls', 'remez', 'firwin2'),
    ...                   loc='lower center', frameon=False)
    ...     else:
    ...         ax.set_xlabel('Frequency (Hz)')
    ...     ax.grid(True)
    ...     ax.set(title='Band-pass %d-%d Hz' % bands[2:4], ylabel='Magnitude')
    ...
    >>> fig.tight_layout()
    >>> plt.show()

    """
    xp = array_namespace(bands, desired)
    bands = np.asarray(bands)
    desired = np.asarray(desired)

    fs = _validate_fs(fs, allow_none=True)
    fs = 2 if fs is None else fs
    nyq = 0.5 * fs

    numtaps = int(numtaps)
    if numtaps % 2 == 0 or numtaps < 1:
        raise ValueError("numtaps must be odd and >= 1")
    M = (numtaps-1) // 2

    # normalize bands 0->1 and make it 2 columns
    nyq = float(nyq)
    if nyq <= 0:
        raise ValueError(f'nyq must be positive, got {nyq} <= 0.')
    bands = np.asarray(bands).flatten() / nyq
    if len(bands) % 2 != 0:
        raise ValueError("bands must contain frequency pairs.")
    if (bands < 0).any() or (bands > 1).any():
        raise ValueError("bands must be between 0 and 1 relative to Nyquist")
    bands.shape = (-1, 2)

    # check remaining params
    desired = np.asarray(desired).flatten()
    if bands.size != desired.size:
        raise ValueError(
            f"desired must have one entry per frequency, got {desired.size} "
            f"gains for {bands.size} frequencies."
        )
    desired.shape = (-1, 2)
    if (np.diff(bands) <= 0).any() or (np.diff(bands[:, 0]) < 0).any():
        raise ValueError("bands must be monotonically nondecreasing and have "
                         "width > 0.")
    if (bands[:-1, 1] > bands[1:, 0]).any():
        raise ValueError("bands must not overlap.")
    if (desired < 0).any():
        raise ValueError("desired must be non-negative.")
    if weight is None:
        weight = np.ones(len(desired))
    weight = np.asarray(weight).flatten()
    if len(weight) != len(desired):
        raise ValueError("weight must be the same size as the number of "
                         f"band pairs ({len(bands)}).")
    if (weight < 0).any():
        raise ValueError("weight must be non-negative.")

    # Set up the linear matrix equation to be solved, Qa = b

    # We can express Q(k,n) = 0.5 Q1(k,n) + 0.5 Q2(k,n)
    # where Q1(k,n)=q(k-n) and Q2(k,n)=q(k+n), i.e. a Toeplitz plus Hankel.

    # We omit the factor of 0.5 above, instead adding it during coefficient
    # calculation.

    # We also omit the 1/π from both Q and b equations, as they cancel
    # during solving.

    # We have that:
    #     q(n) = 1/π ∫W(ω)cos(nω)dω (over 0->π)
    # Using our normalization ω=πf and with a constant weight W over each
    # interval f1->f2 we get:
    #     q(n) = W∫cos(πnf)df (0->1) = Wf sin(πnf)/πnf
    # integrated over each f1->f2 pair (i.e., value at f2 - value at f1).
    n = np.arange(numtaps)[:, np.newaxis, np.newaxis]
    q = np.dot(np.diff(np.sinc(bands * n) * bands, axis=2)[:, :, 0], weight)

    # Now we assemble our sum of Toeplitz and Hankel
    Q1 = toeplitz(q[:M+1])
    Q2 = hankel(q[:M+1], q[M:])
    Q = Q1 + Q2

    # Now for b(n) we have that:
    #     b(n) = 1/π ∫ W(ω)D(ω)cos(nω)dω (over 0->π)
    # Using our normalization ω=πf and with a constant weight W over each
    # interval and a linear term for D(ω) we get (over each f1->f2 interval):
    #     b(n) = W ∫ (mf+c)cos(πnf)df
    #          = f(mf+c)sin(πnf)/πnf + mf**2 cos(nπf)/(πnf)**2
    # integrated over each f1->f2 pair (i.e., value at f2 - value at f1).
    n = n[:M + 1]  # only need this many coefficients here
    # Choose m and c such that we are at the start and end weights
    m = (np.diff(desired, axis=1) / np.diff(bands, axis=1))
    c = desired[:, [0]] - bands[:, [0]] * m
    b = bands * (m*bands + c) * np.sinc(bands * n)
    # Use L'Hospital's rule here for cos(nπf)/(πnf)**2 @ n=0
    b[0] -= m * bands * bands / 2.
    b[1:] += m * np.cos(n[1:] * np.pi * bands) / (np.pi * n[1:]) ** 2
    b = np.dot(np.diff(b, axis=2)[:, :, 0], weight)

    # Now we can solve the equation
    try:  # try the fast way
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter('always')
            a = solve(Q, b, assume_a="pos", check_finite=False)
        for ww in w:
            if (ww.category == LinAlgWarning and
                    str(ww.message).startswith('Ill-conditioned matrix')):
                raise LinAlgError(str(ww.message))
    except LinAlgError:  # in case Q is rank deficient
        # This is faster than pinvh, even though we don't explicitly use
        # the symmetry here. gelsy was faster than gelsd and gelss in
        # some non-exhaustive tests.
        a = lstsq(Q, b, lapack_driver='gelsy')[0]

    # make coefficients symmetric (linear phase)
    coeffs = np.hstack((a[:0:-1], 2 * a[0], a[1:]))
    return xp.asarray(coeffs)


def _dhtm(mag, xp):
    """Compute the modified 1-D discrete Hilbert transform

    Parameters
    ----------
    mag : ndarray
        The magnitude spectrum. Should be 1-D with an even length, and
        preferably a fast length for FFT/IFFT.
    """
    # Adapted based on code by Niranjan Damera-Venkata,
    # Brian L. Evans and Shawn R. McCaslin (see refs for `minimum_phase`)
    sig = xp.zeros(mag.shape[0])
    # Leave Nyquist and DC at 0, knowing np.abs(fftfreq(N)[midpt]) == 0.5
    midpt = mag.shape[0] // 2
    sig[1:midpt] = 1
    sig[midpt+1:] = -1
    # eventually if we want to support complex filters, we will need a
    # np.abs() on the mag inside the log, and should remove the .real
    recon = xp.real(ifft(mag * xp.exp(fft(sig * ifft(xp.log(mag))))))
    return recon


def minimum_phase(h,
                  method: Literal['homomorphic', 'hilbert'] = 'homomorphic',
                  n_fft: int | None = None, *, half: bool = True):
    """Convert a linear-phase FIR filter to minimum phase

    Parameters
    ----------
    h : array
        Linear-phase FIR filter coefficients.
    method : {'hilbert', 'homomorphic'}
        The provided methods are:

            'homomorphic' (default)
                This method [4]_ [5]_ works best with filters with an
                odd number of taps, and the resulting minimum phase filter
                will have a magnitude response that approximates the square
                root of the original filter's magnitude response using half
                the number of taps when ``half=True`` (default), or the
                original magnitude spectrum using the same number of taps
                when ``half=False``.

            'hilbert'
                This method [1]_ is designed to be used with equiripple
                filters (e.g., from `remez`) with unity or zero gain
                regions.

    n_fft : int
        The number of points to use for the FFT. Should be at least a
        few times larger than the signal length (see Notes).
    half : bool
        If ``True``, create a filter that is half the length of the original, with a
        magnitude spectrum that is the square root of the original. If ``False``,
        create a filter that is the same length as the original, with a magnitude
        spectrum that is designed to match the original (only supported when
        ``method='homomorphic'``).

        .. versionadded:: 1.14.0

    Returns
    -------
    h_minimum : array
        The minimum-phase version of the filter, with length
        ``(len(h) + 1) // 2`` when ``half is True`` or ``len(h)`` otherwise.

    See Also
    --------
    firwin
    firwin2
    remez

    Notes
    -----
    Both the Hilbert [1]_ or homomorphic [4]_ [5]_ methods require selection
    of an FFT length to estimate the complex cepstrum of the filter.

    In the case of the Hilbert method, the deviation from the ideal
    spectrum ``epsilon`` is related to the number of stopband zeros
    ``n_stop`` and FFT length ``n_fft`` as::

        epsilon = 2. * n_stop / n_fft

    For example, with 100 stopband zeros and a FFT length of 2048,
    ``epsilon = 0.0976``. If we conservatively assume that the number of
    stopband zeros is one less than the filter length, we can take the FFT
    length to be the next power of 2 that satisfies ``epsilon=0.01`` as::

        n_fft = 2 ** int(np.ceil(np.log2(2 * (len(h) - 1) / 0.01)))

    This gives reasonable results for both the Hilbert and homomorphic
    methods, and gives the value used when ``n_fft=None``.

    Alternative implementations exist for creating minimum-phase filters,
    including zero inversion [2]_ and spectral factorization [3]_ [4]_.
    For more information, see `this DSPGuru page
    <http://dspguru.com/dsp/howtos/how-to-design-minimum-phase-fir-filters>`__.

    References
    ----------
    .. [1] N. Damera-Venkata and B. L. Evans, "Optimal design of real and
           complex minimum phase digital FIR filters," Acoustics, Speech,
           and Signal Processing, 1999. Proceedings., 1999 IEEE International
           Conference on, Phoenix, AZ, 1999, pp. 1145-1148 vol.3.
           :doi:`10.1109/ICASSP.1999.756179`
    .. [2] X. Chen and T. W. Parks, "Design of optimal minimum phase FIR
           filters by direct factorization," Signal Processing,
           vol. 10, no. 4, pp. 369-383, Jun. 1986.
    .. [3] T. Saramaki, "Finite Impulse Response Filter Design," in
           Handbook for Digital Signal Processing, chapter 4,
           New York: Wiley-Interscience, 1993.
    .. [4] J. S. Lim, Advanced Topics in Signal Processing.
           Englewood Cliffs, N.J.: Prentice Hall, 1988.
    .. [5] A. V. Oppenheim, R. W. Schafer, and J. R. Buck,
           "Discrete-Time Signal Processing," 3rd edition.
           Upper Saddle River, N.J.: Pearson, 2009.

    Examples
    --------
    Create an optimal linear-phase low-pass filter `h` with a transition band of
    [0.2, 0.3] (assuming a Nyquist frequency of 1):

    >>> import numpy as np
    >>> from scipy.signal import remez, minimum_phase, freqz, group_delay
    >>> import matplotlib.pyplot as plt
    >>> freq = [0, 0.2, 0.3, 1.0]
    >>> desired = [1, 0]
    >>> h_linear = remez(151, freq, desired, fs=2)

    Convert it to minimum phase:

    >>> h_hil = minimum_phase(h_linear, method='hilbert')
    >>> h_hom = minimum_phase(h_linear, method='homomorphic')
    >>> h_hom_full = minimum_phase(h_linear, method='homomorphic', half=False)

    Compare the impulse and frequency response of the four filters:

    >>> fig0, ax0 = plt.subplots(figsize=(6, 3), tight_layout=True)
    >>> fig1, axs = plt.subplots(3, sharex='all', figsize=(6, 6), tight_layout=True)
    >>> ax0.set_title("Impulse response")
    >>> ax0.set(xlabel='Samples', ylabel='Amplitude', xlim=(0, len(h_linear) - 1))
    >>> axs[0].set_title("Frequency Response")
    >>> axs[0].set(xlim=(0, .65), ylabel="Magnitude / dB")
    >>> axs[1].set(ylabel="Phase / rad")
    >>> axs[2].set(ylabel="Group Delay / samples", ylim=(-31, 81),
    ...             xlabel='Normalized Frequency (Nyqist frequency: 1)')
    >>> for h, lb in ((h_linear,   f'Linear ({len(h_linear)})'),
    ...               (h_hil,      f'Min-Hilbert ({len(h_hil)})'),
    ...               (h_hom,      f'Min-Homomorphic ({len(h_hom)})'),
    ...               (h_hom_full, f'Min-Homom. Full ({len(h_hom_full)})')):
    ...     w_H, H = freqz(h, fs=2)
    ...     w_gd, gd = group_delay((h, 1), fs=2)
    ...
    ...     alpha = 1.0 if lb == 'linear' else 0.5  # full opacity for 'linear' line
    ...     ax0.plot(h, '.-', alpha=alpha, label=lb)
    ...     axs[0].plot(w_H, 20 * np.log10(np.abs(H)), alpha=alpha)
    ...     axs[1].plot(w_H, np.unwrap(np.angle(H)), alpha=alpha, label=lb)
    ...     axs[2].plot(w_gd, gd, alpha=alpha)
    >>> ax0.grid(True)
    >>> ax0.legend(title='Filter Phase (Order)')
    >>> axs[1].legend(title='Filter Phase (Order)', loc='lower right')
    >>> for ax_ in axs:  # shade transition band:
    ...     ax_.axvspan(freq[1], freq[2], color='y', alpha=.25)
    ...     ax_.grid(True)
    >>> plt.show()

    The impulse response and group delay plot depict the 75 sample delay of the linear
    phase filter `h`. The phase should also be linear in the stop band--due to the small
    magnitude, numeric noise dominates there. Furthermore, the plots show that the
    minimum phase filters clearly show a reduced (negative) phase slope in the pass and
    transition band. The plots also illustrate that the filter with parameters
    ``method='homomorphic', half=False`` has same order and magnitude response as the
    linear filter `h` whereas the other minimum phase filters have only half the order
    and the square root  of the magnitude response.
    """
    xp = array_namespace(h)

    h = xp.asarray(h)
    if xp.isdtype(h.dtype, "complex floating"):
        raise ValueError('Complex filters not supported')
    if h.ndim != 1 or h.shape[0] <= 2:
        raise ValueError('h must be 1-D and at least 2 samples long')
    n_half = h.shape[0] // 2

    if not xp.any(xp.flip(h[-n_half:]) - h[:n_half] <= 1e-8 + 1e-6*abs(h[:n_half])):
        warnings.warn('h does not appear to by symmetric, conversion may fail',
                      RuntimeWarning, stacklevel=2)
    if not isinstance(method, str) or method not in \
            ('homomorphic', 'hilbert',):
        raise ValueError(f'method must be "homomorphic" or "hilbert", got {method!r}')
    if method == "hilbert" and not half:
        raise ValueError("`half=False` is only supported when `method='homomorphic'`")
    if n_fft is None:
        n_fft = 2 ** int(ceil(log2(2 * (h.shape[0] - 1) / 0.01)))
    n_fft = int(n_fft)
    if n_fft < h.shape[0]:
        raise ValueError(f'n_fft must be at least len(h)=={len(h)}')

    if method == 'hilbert':
        w = xp.arange(n_fft, dtype=xp.float64) * (2 * xp.pi / n_fft * n_half)
        H = xp.real(fft(h, n_fft) * xp.exp(1j * w))
        dp = max(H) - 1
        ds = 0 - min(H)
        S = 4. / (xp.sqrt(1+dp+ds) + xp.sqrt(1-dp+ds)) ** 2
        H += ds
        H *= S
        H = xp.sqrt(H)
        H += 1e-10  # ensure that the log does not explode
        h_minimum = _dhtm(H, xp)
    else:  # method == 'homomorphic'
        # zero-pad; calculate the DFT
        h_temp = xp.abs(fft(h, n_fft))
        # take 0.25*log(|H|**2) = 0.5*log(|H|)
        h_temp += 1e-7 * xp.min(h_temp[h_temp > 0])  # don't let log blow up
        h_temp = xp.log(h_temp)
        if half:  # halving of magnitude spectrum optional
            h_temp *= 0.5
        # IDFT
        h_temp = xp.real(ifft(h_temp))
        # multiply pointwise by the homomorphic filter
        # lmin[n] = 2u[n] - d[n]
        # i.e., double the positive frequencies and zero out the negative ones;
        # Oppenheim+Shafer 3rd ed p991 eq13.42b and p1004 fig13.7
        win = xp.zeros(n_fft)
        win[0] = 1
        stop = n_fft // 2
        win[1:stop] = 2
        if n_fft % 2:
            win[stop] = 1
        h_temp *= win
        h_temp = ifft(xp.exp(fft(h_temp)))
        h_minimum = h_temp.real
    n_out = (n_half + h.shape[0] % 2) if half else h.shape[0]
    return h_minimum[:n_out]


def firwin_2d(hsize, window, *, fc=None, fs=2, circular=False,
              pass_zero=True, scale=True):
    """
    2D FIR filter design using the window method.

    This function computes the coefficients of a 2D finite impulse response
    filter. The filter is separable with linear phase; it will be designed
    as a product of two 1D filters with dimensions defined by `hsize`.
    Additionally, it can create approximately circularly symmetric 2-D windows.
    
    Parameters
    ----------
    hsize : tuple or list of length 2
        Lengths of the filter in each dimension. `hsize[0]` specifies the
        number of coefficients in the row direction and `hsize[1]` specifies
        the number of coefficients in the column direction.
    window : tuple or list of length 2 or string
        Desired window to use for each 1D filter or a single window type 
        for creating circularly symmetric 2-D windows. Each element should be
        a string or tuple of string and parameter values. See
        `~scipy.signal.get_window` for a list of windows and required
        parameters.
    fc : float or 1-D array_like, optional
        Cutoff frequency of the filter in the same units as `fs`. This defines
        the frequency at which the filter's gain drops to approximately -6 dB
        (half power) in a low-pass or high-pass filter. For multi-band filters,
        `fc` can be an array of cutoff frequencies (i.e., band edges) in the 
        range [0, fs/2], with each band specified in pairs. Required if 
        `circular` is False.
    fs : float, optional
        The sampling frequency of the signal. Default is 2.
    circular : bool, optional
        Whether to create a circularly symmetric 2-D window. Default is ``False``.
    pass_zero : {True, False, 'bandpass', 'lowpass', 'highpass', 'bandstop'}, optional
        This parameter is directly passed to `firwin` for each scalar frequency axis.
        Hence, if ``True``, the DC gain, i.e., the gain at frequency (0, 0), is 1.
        If ``False``, the DC gain is 0 at frequency (0, 0) if `circular` is ``True``. 
        If `circular` is ``False`` the frequencies (0, f1) and (f0, 0) will
        have gain 0.
        It can also be a string argument for the desired filter type 
        (equivalent to ``btype`` in IIR design functions).
    scale : bool, optional
        This parameter is directly passed to `firwin` for each scalar frequency axis.
        Set to ``True`` to scale the coefficients so that the frequency
        response is exactly unity at a certain frequency on one frequency axis.
        That frequency is either:
        
        - 0 (DC) if the first passband starts at 0 (i.e. pass_zero is ``True``)
        - `fs`/2 (the Nyquist frequency) if the first passband ends at `fs`/2
          (i.e., the filter is a single band highpass filter);
          center of first passband otherwise

    Returns
    -------
    filter_2d : (hsize[0], hsize[1]) ndarray
        Coefficients of 2D FIR filter.

    Raises
    ------
    ValueError
        - If `hsize` and `window` are not 2-element tuples or lists.
        - If `cutoff` is None when `circular` is True.
        - If `cutoff` is outside the range [0, `fs`/2] and `circular` is ``False``.
        - If any of the elements in `window` are not recognized.
    RuntimeError
        If `firwin` fails to converge when designing the filter.

    See Also
    --------
    firwin: FIR filter design using the window method for 1d arrays.
    get_window: Return a window of a given length and type.

    Examples
    --------
    Generate a 5x5 low-pass filter with cutoff frequency 0.1:

    >>> import numpy as np
    >>> from scipy.signal import get_window
    >>> from scipy.signal import firwin_2d
    >>> hsize = (5, 5)
    >>> window = (("kaiser", 5.0), ("kaiser", 5.0))
    >>> fc = 0.1
    >>> filter_2d = firwin_2d(hsize, window, fc=fc)
    >>> filter_2d
    array([[0.00025366, 0.00401662, 0.00738617, 0.00401662, 0.00025366],
           [0.00401662, 0.06360159, 0.11695714, 0.06360159, 0.00401662],
           [0.00738617, 0.11695714, 0.21507283, 0.11695714, 0.00738617],
           [0.00401662, 0.06360159, 0.11695714, 0.06360159, 0.00401662],
           [0.00025366, 0.00401662, 0.00738617, 0.00401662, 0.00025366]])

    Generate a circularly symmetric 5x5 low-pass filter with Hamming window:

    >>> filter_2d = firwin_2d((5, 5), 'hamming', fc=fc, circular=True)
    >>> filter_2d
    array([[-0.00020354, -0.00020354, -0.00020354, -0.00020354, -0.00020354],
           [-0.00020354,  0.01506844,  0.09907658,  0.01506844, -0.00020354],
           [-0.00020354,  0.09907658, -0.00020354,  0.09907658, -0.00020354],
           [-0.00020354,  0.01506844,  0.09907658,  0.01506844, -0.00020354],
           [-0.00020354, -0.00020354, -0.00020354, -0.00020354, -0.00020354]])

    Generate Plots comparing the product of two 1d filters with a circular
    symmetric filter:

    >>> import matplotlib.pyplot as plt
    >>> hsize, fc = (50, 50), 0.05
    >>> window = (("kaiser", 5.0), ("kaiser", 5.0))
    >>> filter0_2d = firwin_2d(hsize, window, fc=fc)
    >>> filter1_2d = firwin_2d((50, 50), 'hamming', fc=fc, circular=True)
    ...
    >>> fg, (ax0, ax1) = plt.subplots(1, 2, tight_layout=True, figsize=(6.5, 3.5))
    >>> ax0.set_title("Product of 2 Windows")
    >>> im0 = ax0.imshow(filter0_2d, cmap='viridis', origin='lower', aspect='equal')
    >>> fg.colorbar(im0, ax=ax0, shrink=0.7)
    >>> ax1.set_title("Circular Window")
    >>> im1 = ax1.imshow(filter1_2d, cmap='plasma', origin='lower', aspect='equal')
    >>> fg.colorbar(im1, ax=ax1, shrink=0.7)
    >>> plt.show()
    """
    if len(hsize) != 2:
            raise ValueError("hsize must be a 2-element tuple or list")

    if circular:
        if fc is None:
            raise ValueError("Cutoff frequency `fc` must be "
                             "provided when `circular` is True")
        
        n_r = max(hsize[0], hsize[1]) * 8  # oversample 1d window by factor 8
        
        win_r = firwin(n_r, cutoff=fc, window=window, fs=fs)

        f1, f2 = np.meshgrid(np.linspace(-1, 1, hsize[0]), np.linspace(-1, 1, hsize[1]))
        r = np.sqrt(f1**2 + f2**2)

        win_2d = np.interp(r, np.linspace(0, 1, n_r), win_r)
        return win_2d

    if len(window) != 2:
        raise ValueError("window must be a 2-element tuple or list")

    row_filter = firwin(hsize[0], cutoff=fc, window=window[0], fs=fs)
    col_filter = firwin(hsize[1], cutoff=fc, window=window[1], fs=fs)

    return np.outer(row_filter, col_filter)
