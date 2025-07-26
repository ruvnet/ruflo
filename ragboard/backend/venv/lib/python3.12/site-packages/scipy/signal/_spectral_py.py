"""Tools for spectral analysis.
"""
import numpy as np
import numpy.typing as npt
from scipy import fft as sp_fft
from . import _signaltools
from ._short_time_fft import ShortTimeFFT, FFT_MODE_TYPE
from .windows import get_window
from ._arraytools import const_ext, even_ext, odd_ext, zero_ext
import warnings
from typing import cast, Literal


__all__ = ['periodogram', 'welch', 'lombscargle', 'csd', 'coherence',
           'spectrogram', 'stft', 'istft', 'check_COLA', 'check_NOLA']


def lombscargle(
    x: npt.ArrayLike,
    y: npt.ArrayLike,
    freqs: npt.ArrayLike,
    precenter: bool = False,
    normalize: bool | Literal["power", "normalize", "amplitude"] = False,
    *,
    weights: npt.NDArray | None = None,
    floating_mean: bool = False,
) -> npt.NDArray:
    """
    Compute the generalized Lomb-Scargle periodogram.

    The Lomb-Scargle periodogram was developed by Lomb [1]_ and further
    extended by Scargle [2]_ to find, and test the significance of weak
    periodic signals with uneven temporal sampling. The algorithm used
    here is based on a weighted least-squares fit of the form
    ``y(ω) = a*cos(ω*x) + b*sin(ω*x) + c``, where the fit is calculated for
    each frequency independently. This algorithm was developed by Zechmeister
    and Kürster which improves the Lomb-Scargle periodogram by enabling
    the weighting of individual samples and calculating an unknown y offset
    (also called a "floating-mean" model) [3]_. For more details, and practical
    considerations, see the excellent reference on the Lomb-Scargle periodogram [4]_.

    When *normalize* is False (or "power") (default) the computed periodogram
    is unnormalized, it takes the value ``(A**2) * N/4`` for a harmonic
    signal with amplitude A for sufficiently large N. Where N is the length of x or y.

    When *normalize* is True (or "normalize") the computed periodogram is normalized
    by the residuals of the data around a constant reference model (at zero).

    When *normalize* is "amplitude" the computed periodogram is the complex
    representation of the amplitude and phase.

    Input arrays should be 1-D of a real floating data type, which are converted into
    float64 arrays before processing.

    Parameters
    ----------
    x : array_like
        Sample times.
    y : array_like
        Measurement values. Values are assumed to have a baseline of ``y = 0``. If
        there is a possibility of a y offset, it is recommended to set `floating_mean`
        to True.
    freqs : array_like
        Angular frequencies (e.g., having unit rad/s=2π/s for `x` having unit s) for
        output periodogram. Frequencies are normally >= 0, as any peak at ``-freq`` will
        also exist at ``+freq``.
    precenter : bool, optional
        Pre-center measurement values by subtracting the mean, if True. This is
        a legacy parameter and unnecessary if `floating_mean` is True.
    normalize : bool | str, optional
        Compute normalized or complex (amplitude + phase) periodogram.
        Valid options are: ``False``/``"power"``, ``True``/``"normalize"``, or
        ``"amplitude"``.
    weights : array_like, optional
        Weights for each sample. Weights must be nonnegative.
    floating_mean : bool, optional
        Determines a y offset for each frequency independently, if True.
        Else the y offset is assumed to be `0`.

    Returns
    -------
    pgram : array_like
        Lomb-Scargle periodogram.

    Raises
    ------
    ValueError
        If any of the input arrays x, y, freqs, or weights are not 1D, or if any are
        zero length. Or, if the input arrays x, y, and weights do not have the same
        shape as each other.
    ValueError
        If any weight is < 0, or the sum of the weights is <= 0.
    ValueError
        If the normalize parameter is not one of the allowed options.

    See Also
    --------
    periodogram: Power spectral density using a periodogram
    welch: Power spectral density by Welch's method
    csd: Cross spectral density by Welch's method

    Notes
    -----
    The algorithm used will not automatically account for any unknown y offset, unless
    floating_mean is True. Therefore, for most use cases, if there is a possibility of
    a y offset, it is recommended to set floating_mean to True. If precenter is True,
    it performs the operation ``y -= y.mean()``. However, precenter is a legacy
    parameter, and unnecessary when floating_mean is True. Furthermore, the mean
    removed by precenter does not account for sample weights, nor will it correct for
    any bias due to consistently missing observations at peaks and/or troughs. When the
    normalize parameter is "amplitude", for any frequency in freqs that is below
    ``(2*pi)/(x.max() - x.min())``, the predicted amplitude will tend towards infinity.
    The concept of a "Nyquist frequency" limit (see Nyquist-Shannon sampling theorem)
    is not generally applicable to unevenly sampled data. Therefore, with unevenly
    sampled data, valid frequencies in freqs can often be much higher than expected.

    References
    ----------
    .. [1] N.R. Lomb "Least-squares frequency analysis of unequally spaced
           data", Astrophysics and Space Science, vol 39, pp. 447-462, 1976
           :doi:`10.1007/bf00648343`

    .. [2] J.D. Scargle "Studies in astronomical time series analysis. II -
           Statistical aspects of spectral analysis of unevenly spaced data",
           The Astrophysical Journal, vol 263, pp. 835-853, 1982
           :doi:`10.1086/160554`

    .. [3] M. Zechmeister and M. Kürster, "The generalised Lomb-Scargle periodogram.
           A new formalism for the floating-mean and Keplerian periodograms,"
           Astronomy and Astrophysics, vol. 496, pp. 577-584, 2009
           :doi:`10.1051/0004-6361:200811296`

    .. [4] J.T. VanderPlas, "Understanding the Lomb-Scargle Periodogram,"
           The Astrophysical Journal Supplement Series, vol. 236, no. 1, p. 16,
           May 2018
           :doi:`10.3847/1538-4365/aab766`


    Examples
    --------
    >>> import numpy as np
    >>> rng = np.random.default_rng()

    First define some input parameters for the signal:

    >>> A = 2.  # amplitude
    >>> c = 2.  # offset
    >>> w0 = 1.  # rad/sec
    >>> nin = 150
    >>> nout = 1002

    Randomly generate sample times:

    >>> x = rng.uniform(0, 10*np.pi, nin)

    Plot a sine wave for the selected times:

    >>> y = A * np.cos(w0*x) + c

    Define the array of frequencies for which to compute the periodogram:

    >>> w = np.linspace(0.25, 10, nout)

    Calculate Lomb-Scargle periodogram for each of the normalize options:

    >>> from scipy.signal import lombscargle
    >>> pgram_power = lombscargle(x, y, w, normalize=False)
    >>> pgram_norm = lombscargle(x, y, w, normalize=True)
    >>> pgram_amp = lombscargle(x, y, w, normalize='amplitude')
    ...
    >>> pgram_power_f = lombscargle(x, y, w, normalize=False, floating_mean=True)
    >>> pgram_norm_f = lombscargle(x, y, w, normalize=True, floating_mean=True)
    >>> pgram_amp_f = lombscargle(x, y, w, normalize='amplitude', floating_mean=True)

    Now make a plot of the input data:

    >>> import matplotlib.pyplot as plt
    >>> fig, (ax_t, ax_p, ax_n, ax_a) = plt.subplots(4, 1, figsize=(5, 6))
    >>> ax_t.plot(x, y, 'b+')
    >>> ax_t.set_xlabel('Time [s]')
    >>> ax_t.set_ylabel('Amplitude')

    Then plot the periodogram for each of the normalize options, as well as with and
    without floating_mean=True:

    >>> ax_p.plot(w, pgram_power, label='default')
    >>> ax_p.plot(w, pgram_power_f, label='floating_mean=True')
    >>> ax_p.set_xlabel('Angular frequency [rad/s]')
    >>> ax_p.set_ylabel('Power')
    >>> ax_p.legend(prop={'size': 7})
    ...
    >>> ax_n.plot(w, pgram_norm, label='default')
    >>> ax_n.plot(w, pgram_norm_f, label='floating_mean=True')
    >>> ax_n.set_xlabel('Angular frequency [rad/s]')
    >>> ax_n.set_ylabel('Normalized')
    >>> ax_n.legend(prop={'size': 7})
    ...
    >>> ax_a.plot(w, np.abs(pgram_amp), label='default')
    >>> ax_a.plot(w, np.abs(pgram_amp_f), label='floating_mean=True')
    >>> ax_a.set_xlabel('Angular frequency [rad/s]')
    >>> ax_a.set_ylabel('Amplitude')
    >>> ax_a.legend(prop={'size': 7})
    ...
    >>> plt.tight_layout()
    >>> plt.show()

    """

    # if no weights are provided, assume all data points are equally important
    if weights is None:
        weights = np.ones_like(y, dtype=np.float64)
    else:
        # if provided, make sure weights is an array and cast to float64
        weights = np.asarray(weights, dtype=np.float64)

    # make sure other inputs are arrays and cast to float64
    # done before validation, in case they were not arrays
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    freqs = np.asarray(freqs, dtype=np.float64)

    # validate input shapes
    if not (x.ndim == 1 and x.size > 0 and x.shape == y.shape == weights.shape):
        raise ValueError("Parameters x, y, weights must be 1-D arrays of "
                         "equal non-zero length!")
    if not (freqs.ndim == 1 and freqs.size > 0):
        raise ValueError("Parameter freqs must be a 1-D array of non-zero length!")

    # validate weights
    if not (np.all(weights >= 0) and np.sum(weights) > 0):
        raise ValueError("Parameter weights must have only non-negative entries "
                         "which sum to a positive value!")

    # validate normalize parameter
    if isinstance(normalize, bool):
        # if bool, convert to str literal
        normalize = "normalize" if normalize else "power"

    if normalize not in ["power", "normalize", "amplitude"]:
        raise ValueError(
            "Normalize must be: False (or 'power'), True (or 'normalize'), "
            "or 'amplitude'."
        )

    # weight vector must sum to 1
    weights *= 1.0 / weights.sum()

    # if requested, perform precenter
    if precenter:
        y -= y.mean()

    # transform arrays
    # row vector
    freqs = freqs.reshape(1, -1)
    # column vectors
    x = x.reshape(-1, 1)
    y = y.reshape(-1, 1)
    weights = weights.reshape(-1, 1)

    # store frequent intermediates
    weights_y = weights * y
    freqst = freqs * x
    coswt = np.cos(freqst)
    sinwt = np.sin(freqst)

    Y = np.dot(weights.T, y)  # Eq. 7
    CC = np.dot(weights.T, coswt * coswt)  # Eq. 13
    SS = 1.0 - CC  # trig identity: S^2 = 1 - C^2  Eq.14
    CS = np.dot(weights.T, coswt * sinwt)  # Eq. 15

    if floating_mean:
        C = np.dot(weights.T, coswt)  # Eq. 8
        S = np.dot(weights.T, sinwt)  # Eq. 9
        CC -= C * C  # Eq. 13
        SS -= S * S  # Eq. 14
        CS -= C * S  # Eq. 15

    # calculate tau (phase offset to eliminate CS variable)
    tau = 0.5 * np.arctan2(2.0 * CS, CC - SS)  # Eq. 19
    freqst_tau = freqst - tau

    # coswt and sinwt are now offset by tau, which eliminates CS
    coswt_tau = np.cos(freqst_tau)
    sinwt_tau = np.sin(freqst_tau)

    YC = np.dot(weights_y.T, coswt_tau)  # Eq. 11
    YS = np.dot(weights_y.T, sinwt_tau)  # Eq. 12
    CC = np.dot(weights.T, coswt_tau * coswt_tau)  # Eq. 13, CC range is [0.5, 1.0]
    SS = 1.0 - CC  # trig identity: S^2 = 1 - C^2    Eq. 14, SS range is [0.0, 0.5]

    if floating_mean:
        C = np.dot(weights.T, coswt_tau)  # Eq. 8
        S = np.dot(weights.T, sinwt_tau)  # Eq. 9
        YC -= Y * C  # Eq. 11
        YS -= Y * S  # Eq. 12
        CC -= C * C  # Eq. 13, CC range is now [0.0, 1.0]
        SS -= S * S  # Eq. 14, SS range is now [0.0, 0.5]

    # to prevent division by zero errors with a and b, as well as correcting for
    # numerical precision errors that lead to CC or SS being approximately -0.0,
    # make sure CC and SS are both > 0
    epsneg = np.finfo(dtype=y.dtype).epsneg
    CC[CC < epsneg] = epsneg
    SS[SS < epsneg] = epsneg

    # calculate a and b
    # where: y(w) = a*cos(w) + b*sin(w) + c
    a = YC / CC  # Eq. A.4 and 6, eliminating CS
    b = YS / SS  # Eq. A.4 and 6, eliminating CS
    # c = Y - a * C - b * S

    # store final value as power in A^2 (i.e., (y units)^2)
    pgram = 2.0 * (a * YC + b * YS)

    # squeeze back to a vector
    pgram = np.squeeze(pgram)

    if normalize == "power":  # (default)
        # return the legacy power units ((A**2) * N/4)

        pgram *= float(x.shape[0]) / 4.0

    elif normalize == "normalize":
        # return the normalized power (power at current frequency wrt the entire signal)
        # range will be [0, 1]

        YY = np.dot(weights_y.T, y)  # Eq. 10
        if floating_mean:
            YY -= Y * Y  # Eq. 10

        pgram *= 0.5 / np.squeeze(YY)  # Eq. 20

    else:  # normalize == "amplitude":
        # return the complex representation of the best-fit amplitude and phase

        # squeeze back to vectors
        a = np.squeeze(a)
        b = np.squeeze(b)
        tau = np.squeeze(tau)

        # calculate the complex representation, and correct for tau rotation
        pgram = (a + 1j * b) * np.exp(1j * tau)

    return pgram


def periodogram(x, fs=1.0, window='boxcar', nfft=None, detrend='constant',
                return_onesided=True, scaling='density', axis=-1):
    """
    Estimate power spectral density using a periodogram.

    Parameters
    ----------
    x : array_like
        Time series of measurement values
    fs : float, optional
        Sampling frequency of the `x` time series. Defaults to 1.0.
    window : str or tuple or array_like, optional
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be equal to the length
        of the axis over which the periodogram is computed. Defaults
        to 'boxcar'.
    nfft : int, optional
        Length of the FFT used. If `None` the length of `x` will be
        used.
    detrend : str or function or `False`, optional
        Specifies how to detrend each segment. If `detrend` is a
        string, it is passed as the `type` argument to the `detrend`
        function. If it is a function, it takes a segment and returns a
        detrended segment. If `detrend` is `False`, no detrending is
        done. Defaults to 'constant'.
    return_onesided : bool, optional
        If `True`, return a one-sided spectrum for real data. If
        `False` return a two-sided spectrum. Defaults to `True`, but for
        complex data, a two-sided spectrum is always returned.
    scaling : { 'density', 'spectrum' }, optional
        Selects between computing the power spectral density ('density')
        where `Pxx` has units of V²/Hz and computing the squared magnitude
        spectrum ('spectrum') where `Pxx` has units of V², if `x`
        is measured in V and `fs` is measured in Hz. Defaults to
        'density'
    axis : int, optional
        Axis along which the periodogram is computed; the default is
        over the last axis (i.e. ``axis=-1``).

    Returns
    -------
    f : ndarray
        Array of sample frequencies.
    Pxx : ndarray
        Power spectral density or power spectrum of `x`.

    See Also
    --------
    welch: Estimate power spectral density using Welch's method
    lombscargle: Lomb-Scargle periodogram for unevenly sampled data

    Notes
    -----
    The ratio of the squared magnitude (``scaling='spectrum'``) divided by the spectral
    power density (``scaling='density'``) is the constant factor of
    ``sum(abs(window)**2)*fs / abs(sum(window))**2``.
    If `return_onesided` is ``True``, the values of the negative frequencies are added
    to values of the corresponding positive ones.

    Consult the :ref:`tutorial_SpectralAnalysis` section of the :ref:`user_guide`
    for a discussion of the scalings of the power spectral density and
    the magnitude (squared) spectrum.

    .. versionadded:: 0.12.0

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()

    Generate a test signal, a 2 Vrms sine wave at 1234 Hz, corrupted by
    0.001 V**2/Hz of white noise sampled at 10 kHz.

    >>> fs = 10e3
    >>> N = 1e5
    >>> amp = 2*np.sqrt(2)
    >>> freq = 1234.0
    >>> noise_power = 0.001 * fs / 2
    >>> time = np.arange(N) / fs
    >>> x = amp*np.sin(2*np.pi*freq*time)
    >>> x += rng.normal(scale=np.sqrt(noise_power), size=time.shape)

    Compute and plot the power spectral density.

    >>> f, Pxx_den = signal.periodogram(x, fs)
    >>> plt.semilogy(f, Pxx_den)
    >>> plt.ylim([1e-7, 1e2])
    >>> plt.xlabel('frequency [Hz]')
    >>> plt.ylabel('PSD [V**2/Hz]')
    >>> plt.show()

    If we average the last half of the spectral density, to exclude the
    peak, we can recover the noise power on the signal.

    >>> np.mean(Pxx_den[25000:])
    0.000985320699252543

    Now compute and plot the power spectrum.

    >>> f, Pxx_spec = signal.periodogram(x, fs, 'flattop', scaling='spectrum')
    >>> plt.figure()
    >>> plt.semilogy(f, np.sqrt(Pxx_spec))
    >>> plt.ylim([1e-4, 1e1])
    >>> plt.xlabel('frequency [Hz]')
    >>> plt.ylabel('Linear spectrum [V RMS]')
    >>> plt.show()

    The peak height in the power spectrum is an estimate of the RMS
    amplitude.

    >>> np.sqrt(Pxx_spec.max())
    2.0077340678640727

    """
    x = np.asarray(x)

    if x.size == 0:
        return np.empty(x.shape), np.empty(x.shape)

    if window is None:
        window = 'boxcar'

    if nfft is None:
        nperseg = x.shape[axis]
    elif nfft == x.shape[axis]:
        nperseg = nfft
    elif nfft > x.shape[axis]:
        nperseg = x.shape[axis]
    elif nfft < x.shape[axis]:
        s = [np.s_[:]]*len(x.shape)
        s[axis] = np.s_[:nfft]
        x = x[tuple(s)]
        nperseg = nfft
        nfft = None

    if hasattr(window, 'size'):
        if window.size != nperseg:
            raise ValueError('the size of the window must be the same size '
                             'of the input on the specified axis')

    return welch(x, fs=fs, window=window, nperseg=nperseg, noverlap=0,
                 nfft=nfft, detrend=detrend, return_onesided=return_onesided,
                 scaling=scaling, axis=axis)


def welch(x, fs=1.0, window='hann', nperseg=None, noverlap=None, nfft=None,
          detrend='constant', return_onesided=True, scaling='density',
          axis=-1, average='mean'):
    r"""
    Estimate power spectral density using Welch's method.

    Welch's method [1]_ computes an estimate of the power spectral
    density by dividing the data into overlapping segments, computing a
    modified periodogram for each segment and averaging the
    periodograms.

    Parameters
    ----------
    x : array_like
        Time series of measurement values
    fs : float, optional
        Sampling frequency of the `x` time series. Defaults to 1.0.
    window : str or tuple or array_like, optional
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg. Defaults
        to a Hann window.
    nperseg : int, optional
        Length of each segment. Defaults to None, but if window is str or
        tuple, is set to 256, and if window is array_like, is set to the
        length of the window.
    noverlap : int, optional
        Number of points to overlap between segments. If `None`,
        ``noverlap = nperseg // 2``. Defaults to `None`.
    nfft : int, optional
        Length of the FFT used, if a zero padded FFT is desired. If
        `None`, the FFT length is `nperseg`. Defaults to `None`.
    detrend : str or function or `False`, optional
        Specifies how to detrend each segment. If `detrend` is a
        string, it is passed as the `type` argument to the `detrend`
        function. If it is a function, it takes a segment and returns a
        detrended segment. If `detrend` is `False`, no detrending is
        done. Defaults to 'constant'.
    return_onesided : bool, optional
        If `True`, return a one-sided spectrum for real data. If
        `False` return a two-sided spectrum. Defaults to `True`, but for
        complex data, a two-sided spectrum is always returned.
    scaling : { 'density', 'spectrum' }, optional
        Selects between computing the power spectral density ('density')
        where `Pxx` has units of V**2/Hz and computing the squared magnitude
        spectrum ('spectrum') where `Pxx` has units of V**2, if `x`
        is measured in V and `fs` is measured in Hz. Defaults to
        'density'
    axis : int, optional
        Axis along which the periodogram is computed; the default is
        over the last axis (i.e. ``axis=-1``).
    average : { 'mean', 'median' }, optional
        Method to use when averaging periodograms. Defaults to 'mean'.

        .. versionadded:: 1.2.0

    Returns
    -------
    f : ndarray
        Array of sample frequencies.
    Pxx : ndarray
        Power spectral density or power spectrum of x.

    See Also
    --------
    csd: Cross power spectral density using Welch's method
    periodogram: Simple, optionally modified periodogram
    lombscargle: Lomb-Scargle periodogram for unevenly sampled data

    Notes
    -----
    An appropriate amount of overlap will depend on the choice of window
    and on your requirements. For the default Hann window an overlap of
    50% is a reasonable trade-off between accurately estimating the
    signal power, while not over counting any of the data. Narrower
    windows may require a larger overlap. If `noverlap` is 0, this
    method is equivalent to Bartlett's method [2]_.

    The ratio of the squared magnitude (``scaling='spectrum'``) divided by the spectral
    power density (``scaling='density'``) is the constant factor of
    ``sum(abs(window)**2)*fs / abs(sum(window))**2``.
    If `return_onesided` is ``True``, the values of the negative frequencies are added
    to values of the corresponding positive ones.

    Consult the :ref:`tutorial_SpectralAnalysis` section of the :ref:`user_guide`
    for a discussion of the scalings of the power spectral density and
    the (squared) magnitude spectrum.

    .. versionadded:: 0.12.0

    References
    ----------
    .. [1] P. Welch, "The use of the fast Fourier transform for the
           estimation of power spectra: A method based on time averaging
           over short, modified periodograms", IEEE Trans. Audio
           Electroacoust. vol. 15, pp. 70-73, 1967.
    .. [2] M.S. Bartlett, "Periodogram Analysis and Continuous Spectra",
           Biometrika, vol. 37, pp. 1-16, 1950.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()

    Generate a test signal, a 2 Vrms sine wave at 1234 Hz, corrupted by
    0.001 V**2/Hz of white noise sampled at 10 kHz.

    >>> fs = 10e3
    >>> N = 1e5
    >>> amp = 2*np.sqrt(2)
    >>> freq = 1234.0
    >>> noise_power = 0.001 * fs / 2
    >>> time = np.arange(N) / fs
    >>> x = amp*np.sin(2*np.pi*freq*time)
    >>> x += rng.normal(scale=np.sqrt(noise_power), size=time.shape)

    Compute and plot the power spectral density.

    >>> f, Pxx_den = signal.welch(x, fs, nperseg=1024)
    >>> plt.semilogy(f, Pxx_den)
    >>> plt.ylim([0.5e-3, 1])
    >>> plt.xlabel('frequency [Hz]')
    >>> plt.ylabel('PSD [V**2/Hz]')
    >>> plt.show()

    If we average the last half of the spectral density, to exclude the
    peak, we can recover the noise power on the signal.

    >>> np.mean(Pxx_den[256:])
    0.0009924865443739191

    Now compute and plot the power spectrum.

    >>> f, Pxx_spec = signal.welch(x, fs, 'flattop', 1024, scaling='spectrum')
    >>> plt.figure()
    >>> plt.semilogy(f, np.sqrt(Pxx_spec))
    >>> plt.xlabel('frequency [Hz]')
    >>> plt.ylabel('Linear spectrum [V RMS]')
    >>> plt.show()

    The peak height in the power spectrum is an estimate of the RMS
    amplitude.

    >>> np.sqrt(Pxx_spec.max())
    2.0077340678640727

    If we now introduce a discontinuity in the signal, by increasing the
    amplitude of a small portion of the signal by 50, we can see the
    corruption of the mean average power spectral density, but using a
    median average better estimates the normal behaviour.

    >>> x[int(N//2):int(N//2)+10] *= 50.
    >>> f, Pxx_den = signal.welch(x, fs, nperseg=1024)
    >>> f_med, Pxx_den_med = signal.welch(x, fs, nperseg=1024, average='median')
    >>> plt.semilogy(f, Pxx_den, label='mean')
    >>> plt.semilogy(f_med, Pxx_den_med, label='median')
    >>> plt.ylim([0.5e-3, 1])
    >>> plt.xlabel('frequency [Hz]')
    >>> plt.ylabel('PSD [V**2/Hz]')
    >>> plt.legend()
    >>> plt.show()

    """
    freqs, Pxx = csd(x, x, fs=fs, window=window, nperseg=nperseg,
                     noverlap=noverlap, nfft=nfft, detrend=detrend,
                     return_onesided=return_onesided, scaling=scaling,
                     axis=axis, average=average)

    return freqs, Pxx.real


def csd(x, y, fs=1.0, window='hann', nperseg=None, noverlap=None, nfft=None,
        detrend='constant', return_onesided=True, scaling='density',
        axis=-1, average='mean'):
    r"""
    Estimate the cross power spectral density, Pxy, using Welch's method.

    Parameters
    ----------
    x : array_like
        Time series of measurement values
    y : array_like
        Time series of measurement values
    fs : float, optional
        Sampling frequency of the `x` and `y` time series. Defaults
        to 1.0.
    window : str or tuple or array_like, optional
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg. Defaults
        to a Hann window.
    nperseg : int, optional
        Length of each segment. Defaults to None, but if window is str or
        tuple, is set to 256, and if window is array_like, is set to the
        length of the window.
    noverlap: int, optional
        Number of points to overlap between segments. If `None`,
        ``noverlap = nperseg // 2``. Defaults to `None` and may
        not be greater than `nperseg`.
    nfft : int, optional
        Length of the FFT used, if a zero padded FFT is desired. If
        `None`, the FFT length is `nperseg`. Defaults to `None`.
    detrend : str or function or `False`, optional
        Specifies how to detrend each segment. If `detrend` is a
        string, it is passed as the `type` argument to the `detrend`
        function. If it is a function, it takes a segment and returns a
        detrended segment. If `detrend` is `False`, no detrending is
        done. Defaults to 'constant'.
    return_onesided : bool, optional
        If `True`, return a one-sided spectrum for real data. If
        `False` return a two-sided spectrum. Defaults to `True`, but for
        complex data, a two-sided spectrum is always returned.
    scaling : { 'density', 'spectrum' }, optional
        Selects between computing the cross spectral density ('density')
        where `Pxy` has units of V**2/Hz and computing the cross spectrum
        ('spectrum') where `Pxy` has units of V**2, if `x` and `y` are
        measured in V and `fs` is measured in Hz. Defaults to 'density'
    axis : int, optional
        Axis along which the CSD is computed for both inputs; the
        default is over the last axis (i.e. ``axis=-1``).
    average : { 'mean', 'median' }, optional
        Method to use when averaging periodograms. If the spectrum is
        complex, the average is computed separately for the real and
        imaginary parts. Defaults to 'mean'.

        .. versionadded:: 1.2.0

    Returns
    -------
    f : ndarray
        Array of sample frequencies.
    Pxy : ndarray
        Cross spectral density or cross power spectrum of x,y.

    See Also
    --------
    periodogram: Simple, optionally modified periodogram
    lombscargle: Lomb-Scargle periodogram for unevenly sampled data
    welch: Power spectral density by Welch's method. [Equivalent to
           csd(x,x)]
    coherence: Magnitude squared coherence by Welch's method.

    Notes
    -----
    By convention, Pxy is computed with the conjugate FFT of X
    multiplied by the FFT of Y.

    If the input series differ in length, the shorter series will be
    zero-padded to match.

    An appropriate amount of overlap will depend on the choice of window
    and on your requirements. For the default Hann window an overlap of
    50% is a reasonable trade-off between accurately estimating the
    signal power, while not over counting any of the data. Narrower
    windows may require a larger overlap.

    The ratio of the cross spectrum (``scaling='spectrum'``) divided by the cross
    spectral density (``scaling='density'``) is the constant factor of
    ``sum(abs(window)**2)*fs / abs(sum(window))**2``.
    If `return_onesided` is ``True``, the values of the negative frequencies are added
    to values of the corresponding positive ones.

    Consult the :ref:`tutorial_SpectralAnalysis` section of the :ref:`user_guide`
    for a discussion of the scalings of a spectral density and an (amplitude) spectrum.

    Welch's method may be interpreted as taking the average over the time slices of a
    (cross-) spectrogram. Internally, this function utilizes the  `ShortTimeFFT`  to
    determine the required (cross-) spectrogram. An example below illustrates that it
    is straightforward to calculate `Pxy` directly with the `ShortTimeFFT`. However,
    there are some notable differences in the behavior of the `ShortTimeFFT`:

    * There is no direct `ShortTimeFFT` equivalent for the `csd` parameter
      combination ``return_onesided=True, scaling='density'``, since
      ``fft_mode='onesided2X'`` requires ``'psd'`` scaling. The is due to `csd`
      returning the doubled squared magnitude in this case, which does not have a
      sensible interpretation.
    * `ShortTimeFFT` uses `float64` / `complex128` internally, which is due to the
      behavior of the utilized `~scipy.fft` module. Thus, those are the dtypes being
      returned. The `csd` function casts the return values to `float32` / `complex64`
      if the input is `float32` / `complex64` as well.
    * The `csd` function calculates ``np.conj(Sx[q,p]) * Sy[q,p]``, whereas
      `~ShortTimeFFT.spectrogram` calculates ``Sx[q,p] * np.conj(Sy[q,p])`` where
      ``Sx[q,p]``, ``Sy[q,p]`` are the STFTs of `x` and `y`. Also, the window
      positioning is different.

    .. versionadded:: 0.16.0

    References
    ----------
    .. [1] P. Welch, "The use of the fast Fourier transform for the
           estimation of power spectra: A method based on time averaging
           over short, modified periodograms", IEEE Trans. Audio
           Electroacoust. vol. 15, pp. 70-73, 1967.
    .. [2] Rabiner, Lawrence R., and B. Gold. "Theory and Application of
           Digital Signal Processing" Prentice-Hall, pp. 414-419, 1975

    Examples
    --------
    The following example plots the cross power spectral density of two signals with
    some common features:

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()
    ...
    ... # Generate two test signals with some common features:
    >>> N, fs = 100_000, 10e3  # number of samples and sampling frequency
    >>> amp, freq = 20, 1234.0  # amplitude and frequency of utilized sine signal
    >>> noise_power = 0.001 * fs / 2
    >>> time = np.arange(N) / fs
    >>> b, a = signal.butter(2, 0.25, 'low')
    >>> x = rng.normal(scale=np.sqrt(noise_power), size=time.shape)
    >>> y = signal.lfilter(b, a, x)
    >>> x += amp*np.sin(2*np.pi*freq*time)
    >>> y += rng.normal(scale=0.1*np.sqrt(noise_power), size=time.shape)
    ...
    ... # Compute and plot the magnitude of the cross spectral density:
    >>> nperseg, noverlap, win = 1024, 512, 'hann'
    >>> f, Pxy = signal.csd(x, y, fs, win, nperseg, noverlap)
    >>> fig0, ax0 = plt.subplots(tight_layout=True)
    >>> ax0.set_title(f"CSD ({win.title()}-window, {nperseg=}, {noverlap=})")
    >>> ax0.set(xlabel="Frequency $f$ in kHz", ylabel="CSD Magnitude in V²/Hz")
    >>> ax0.semilogy(f/1e3, np.abs(Pxy))
    >>> ax0.grid()
    >>> plt.show()

    The cross spectral density is calculated by taking the average over the time slices
    of a spectrogram:

    >>> SFT = signal.ShortTimeFFT.from_window('hann', fs, nperseg, noverlap,
    ...                                       scale_to='psd', fft_mode='onesided2X',
    ...                                       phase_shift=None)
    >>> Sxy1 = SFT.spectrogram(y, x, detr='constant', k_offset=nperseg//2,
    ...                        p0=0, p1=(N-noverlap) // SFT.hop)
    >>> Pxy1 = Sxy1.mean(axis=-1)
    >>> np.allclose(Pxy, Pxy1)  # same result as with csd()
    True

    As discussed in the Notes section, the results of using an approach analogous to
    the code snippet above and the `csd` function may deviate due to implementation
    details.

    Note that the code snippet above can be easily adapted to determine other
    statistical properties than the mean value.
    """
    # The following lines are resembling the behavior of the originally utilized
    # `_spectral_helper()` function:
    same_data, axis = y is x, int(axis)
    x = np.asarray(x)

    if not same_data:
        y = np.asarray(y)
        # Check if we can broadcast the outer axes together
        x_outer, y_outer  = list(x.shape), list(y.shape)
        x_outer.pop(axis)
        y_outer.pop(axis)
        try:
            outer_shape = np.broadcast_shapes(x_outer, y_outer)
        except ValueError as e:
            raise ValueError('x and y cannot be broadcast together.') from e
        if x.size == 0 or y.size == 0:
            out_shape = outer_shape + (min([x.shape[axis], y.shape[axis]]),)
            empty_out = np.moveaxis(np.empty(out_shape), -1, axis)
            return empty_out, empty_out
        out_dtype = np.result_type(x, y, np.complex64)
    else:  # x is y:
        if x.size == 0:
            return np.empty(x.shape), np.empty(x.shape)
        out_dtype = np.result_type(x, np.complex64)

    n = x.shape[axis] if same_data else max(x.shape[axis], y.shape[axis])
    if isinstance(window, str) or isinstance(window, tuple):
        nperseg = int(nperseg) if nperseg is not None else 256
        if nperseg < 1:
            raise ValueError(f"Parameter {nperseg=} is not a positive integer!")
        elif n < nperseg:
            warnings.warn(f"{nperseg=} is greater than signal length max(len(x), " +
                          f"len(y)) = {n}, using nperseg = {n}", stacklevel=3)
            nperseg = n
        win = get_window(window, nperseg)
    else:
        win = np.asarray(window)
        if nperseg is None:
            nperseg = len(win)
    if nperseg != len(win):
        raise ValueError(f"{nperseg=} does not equal {len(win)=}")

    nfft = int(nfft) if nfft is not None else nperseg
    if nfft < nperseg:
        raise ValueError(f"{nfft=} must be greater than or equal to {nperseg=}!")
    noverlap = int(noverlap) if noverlap is not None else nperseg // 2
    if noverlap >= nperseg:
        raise ValueError(f"{noverlap=} must be less than {nperseg=}!")
    if np.iscomplexobj(x) and return_onesided:
        return_onesided = False

    if x.shape[axis] < y.shape[axis]:  # zero-pad x to shape of y:
        z_shape = list(y.shape)
        z_shape[axis] = y.shape[axis] - x.shape[axis]
        x = np.concatenate((x, np.zeros(z_shape)), axis=axis)
    elif y.shape[axis] < x.shape[axis]:  # zero-pad y to shape of x:
        z_shape = list(x.shape)
        z_shape[axis] = x.shape[axis] - y.shape[axis]
        y = np.concatenate((y, np.zeros(z_shape)), axis=axis)

    # using cast() to make mypy happy:
    fft_mode = cast(FFT_MODE_TYPE, 'onesided' if return_onesided else 'twosided')
    if scaling not in (scales := {'spectrum': 'magnitude', 'density': 'psd'}):
        raise ValueError(f"Parameter {scaling=} not in {scales}!")

    SFT = ShortTimeFFT(win, nperseg - noverlap, fs, fft_mode=fft_mode, mfft=nfft,
                       scale_to=scales[scaling], phase_shift=None)
    # csd() calculates X.conj()*Y instead of X*Y.conj():
    Pxy = SFT.spectrogram(y, x, detr=None if detrend is False else detrend,
                          p0=0, p1=(n - noverlap) // SFT.hop, k_offset=nperseg // 2,
                          axis=axis)

    # Note:
    # 'onesided2X' scaling of ShortTimeFFT conflicts with the
    # scaling='spectrum' parameter, since it doubles the squared magnitude,
    # which in the view of the ShortTimeFFT implementation does not make sense.
    # Hence, the doubling of the square is implemented here:
    if return_onesided:
        f_axis = Pxy.ndim - 1 + axis if axis < 0 else axis
        Pxy = np.moveaxis(Pxy, f_axis, -1)
        Pxy[..., 1:-1 if SFT.mfft % 2 == 0 else None] *= 2
        Pxy = np.moveaxis(Pxy, -1, f_axis)

    # Average over windows.
    if Pxy.shape[-1] > 1:
        if average == 'median':
            # np.median must be passed real arrays for the desired result
            bias = _median_bias(Pxy.shape[-1])
            if np.iscomplexobj(Pxy):
                Pxy = (np.median(np.real(Pxy), axis=-1) +
                       np.median(np.imag(Pxy), axis=-1) * 1j)
            else:
                Pxy = np.median(Pxy, axis=-1)
            Pxy /= bias
        elif average == 'mean':
            Pxy = Pxy.mean(axis=-1)
        else:
            raise ValueError(f"Parameter {average=} must be 'median' or 'mean'!")
    else:
        Pxy = np.reshape(Pxy, Pxy.shape[:-1])

    # cast output type;
    Pxy = Pxy.astype(out_dtype)
    if same_data:
        Pxy = Pxy.real
    return SFT.f, Pxy


def spectrogram(x, fs=1.0, window=('tukey', .25), nperseg=None, noverlap=None,
                nfft=None, detrend='constant', return_onesided=True,
                scaling='density', axis=-1, mode='psd'):
    """Compute a spectrogram with consecutive Fourier transforms (legacy function).

    Spectrograms can be used as a way of visualizing the change of a
    nonstationary signal's frequency content over time.

    .. legacy:: function

        :class:`ShortTimeFFT` is a newer STFT / ISTFT implementation with more
        features also including a :meth:`~ShortTimeFFT.spectrogram` method.
        A :ref:`comparison <tutorial_stft_legacy_stft>` between the
        implementations can be found in the :ref:`tutorial_stft` section of
        the :ref:`user_guide`.

    Parameters
    ----------
    x : array_like
        Time series of measurement values
    fs : float, optional
        Sampling frequency of the `x` time series. Defaults to 1.0.
    window : str or tuple or array_like, optional
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg.
        Defaults to a Tukey window with shape parameter of 0.25.
    nperseg : int, optional
        Length of each segment. Defaults to None, but if window is str or
        tuple, is set to 256, and if window is array_like, is set to the
        length of the window.
    noverlap : int, optional
        Number of points to overlap between segments. If `None`,
        ``noverlap = nperseg // 8``. Defaults to `None`.
    nfft : int, optional
        Length of the FFT used, if a zero padded FFT is desired. If
        `None`, the FFT length is `nperseg`. Defaults to `None`.
    detrend : str or function or `False`, optional
        Specifies how to detrend each segment. If `detrend` is a
        string, it is passed as the `type` argument to the `detrend`
        function. If it is a function, it takes a segment and returns a
        detrended segment. If `detrend` is `False`, no detrending is
        done. Defaults to 'constant'.
    return_onesided : bool, optional
        If `True`, return a one-sided spectrum for real data. If
        `False` return a two-sided spectrum. Defaults to `True`, but for
        complex data, a two-sided spectrum is always returned.
    scaling : { 'density', 'spectrum' }, optional
        Selects between computing the power spectral density ('density')
        where `Sxx` has units of V**2/Hz and computing the power
        spectrum ('spectrum') where `Sxx` has units of V**2, if `x`
        is measured in V and `fs` is measured in Hz. Defaults to
        'density'.
    axis : int, optional
        Axis along which the spectrogram is computed; the default is over
        the last axis (i.e. ``axis=-1``).
    mode : str, optional
        Defines what kind of return values are expected. Options are
        ['psd', 'complex', 'magnitude', 'angle', 'phase']. 'complex' is
        equivalent to the output of `stft` with no padding or boundary
        extension. 'magnitude' returns the absolute magnitude of the
        STFT. 'angle' and 'phase' return the complex angle of the STFT,
        with and without unwrapping, respectively.

    Returns
    -------
    f : ndarray
        Array of sample frequencies.
    t : ndarray
        Array of segment times.
    Sxx : ndarray
        Spectrogram of x. By default, the last axis of Sxx corresponds
        to the segment times.

    See Also
    --------
    periodogram: Simple, optionally modified periodogram
    lombscargle: Lomb-Scargle periodogram for unevenly sampled data
    welch: Power spectral density by Welch's method.
    csd: Cross spectral density by Welch's method.
    ShortTimeFFT: Newer STFT/ISTFT implementation providing more features,
                  which also includes a :meth:`~ShortTimeFFT.spectrogram`
                  method.

    Notes
    -----
    An appropriate amount of overlap will depend on the choice of window
    and on your requirements. In contrast to welch's method, where the
    entire data stream is averaged over, one may wish to use a smaller
    overlap (or perhaps none at all) when computing a spectrogram, to
    maintain some statistical independence between individual segments.
    It is for this reason that the default window is a Tukey window with
    1/8th of a window's length overlap at each end.


    .. versionadded:: 0.16.0

    References
    ----------
    .. [1] Oppenheim, Alan V., Ronald W. Schafer, John R. Buck
           "Discrete-Time Signal Processing", Prentice Hall, 1999.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal
    >>> from scipy.fft import fftshift
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()

    Generate a test signal, a 2 Vrms sine wave whose frequency is slowly
    modulated around 3kHz, corrupted by white noise of exponentially
    decreasing magnitude sampled at 10 kHz.

    >>> fs = 10e3
    >>> N = 1e5
    >>> amp = 2 * np.sqrt(2)
    >>> noise_power = 0.01 * fs / 2
    >>> time = np.arange(N) / float(fs)
    >>> mod = 500*np.cos(2*np.pi*0.25*time)
    >>> carrier = amp * np.sin(2*np.pi*3e3*time + mod)
    >>> noise = rng.normal(scale=np.sqrt(noise_power), size=time.shape)
    >>> noise *= np.exp(-time/5)
    >>> x = carrier + noise

    Compute and plot the spectrogram.

    >>> f, t, Sxx = signal.spectrogram(x, fs)
    >>> plt.pcolormesh(t, f, Sxx, shading='gouraud')
    >>> plt.ylabel('Frequency [Hz]')
    >>> plt.xlabel('Time [sec]')
    >>> plt.show()

    Note, if using output that is not one sided, then use the following:

    >>> f, t, Sxx = signal.spectrogram(x, fs, return_onesided=False)
    >>> plt.pcolormesh(t, fftshift(f), fftshift(Sxx, axes=0), shading='gouraud')
    >>> plt.ylabel('Frequency [Hz]')
    >>> plt.xlabel('Time [sec]')
    >>> plt.show()

    """
    modelist = ['psd', 'complex', 'magnitude', 'angle', 'phase']
    if mode not in modelist:
        raise ValueError(f'unknown value for mode {mode}, must be one of {modelist}')

    # need to set default for nperseg before setting default for noverlap below
    window, nperseg = _triage_segments(window, nperseg,
                                       input_length=x.shape[axis])

    # Less overlap than welch, so samples are more statistically independent
    if noverlap is None:
        noverlap = nperseg // 8

    if mode == 'psd':
        freqs, time, Sxx = _spectral_helper(x, x, fs, window, nperseg,
                                            noverlap, nfft, detrend,
                                            return_onesided, scaling, axis,
                                            mode='psd')

    else:
        freqs, time, Sxx = _spectral_helper(x, x, fs, window, nperseg,
                                            noverlap, nfft, detrend,
                                            return_onesided, scaling, axis,
                                            mode='stft')

        if mode == 'magnitude':
            Sxx = np.abs(Sxx)
        elif mode in ['angle', 'phase']:
            Sxx = np.angle(Sxx)
            if mode == 'phase':
                # Sxx has one additional dimension for time strides
                if axis < 0:
                    axis -= 1
                Sxx = np.unwrap(Sxx, axis=axis)

        # mode =='complex' is same as `stft`, doesn't need modification

    return freqs, time, Sxx


def check_COLA(window, nperseg, noverlap, tol=1e-10):
    r"""Check whether the Constant OverLap Add (COLA) constraint is met
    (legacy function).

    .. legacy:: function

        The COLA constraint is equivalent of having a constant dual window, i.e.,
        ``all(ShortTimeFFT.dual_win == ShortTimeFFT.dual_win[0])``. Hence,
        `closest_STFT_dual_window` generalizes this function, as the following
        example shows:

        >>> import numpy as np
        >>> from scipy.signal import check_COLA, closest_STFT_dual_window, windows
        ...
        >>> w, w_rect, hop = windows.hann(12, sym=False), np.ones(12), 6
        >>> dual_win, alpha = closest_STFT_dual_window(w, hop, w_rect, scaled=True)
        >>> np.allclose(dual_win/alpha, w_rect, atol=1e-10, rtol=0)
        True
        >>> check_COLA(w, len(w), len(w) - hop)  # equivalent legacy function call
        True


    Parameters
    ----------
    window : str or tuple or array_like
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg.
    nperseg : int
        Length of each segment.
    noverlap : int
        Number of points to overlap between segments.
    tol : float, optional
        The allowed variance of a bin's weighted sum from the median bin
        sum.

    Returns
    -------
    verdict : bool
        `True` if chosen combination satisfies COLA within `tol`,
        `False` otherwise

    See Also
    --------
    closest_STFT_dual_window: Allows determining the closest window meeting the
                              COLA constraint for a given window
    check_NOLA: Check whether the Nonzero Overlap Add (NOLA) constraint is met
    ShortTimeFFT: Provide short-time Fourier transform and its inverse
    stft: Short-time Fourier transform (legacy)
    istft: Inverse Short-time Fourier transform (legacy)

    Notes
    -----
    In order to invert a short-time Fourier transfrom (STFT) with the so-called
    "overlap-add method", the signal windowing must obey the constraint of
    "Constant OverLap Add" (COLA). This ensures that every point in the input
    data is equally weighted, thereby avoiding aliasing and allowing full
    reconstruction. Note that the algorithms implemented in `ShortTimeFFT.istft`
    and in `istft` (legacy) only require that the weaker "nonzero overlap-add"
    condition (as in `check_NOLA`) is met.

    Some examples of windows that satisfy COLA:
        - Rectangular window at overlap of 0, 1/2, 2/3, 3/4, ...
        - Bartlett window at overlap of 1/2, 3/4, 5/6, ...
        - Hann window at 1/2, 2/3, 3/4, ...
        - Any Blackman family window at 2/3 overlap
        - Any window with ``noverlap = nperseg-1``

    A very comprehensive list of other windows may be found in [2]_,
    wherein the COLA condition is satisfied when the "Amplitude
    Flatness" is unity.

    .. versionadded:: 0.19.0

    References
    ----------
    .. [1] Julius O. Smith III, "Spectral Audio Signal Processing", W3K
           Publishing, 2011,ISBN 978-0-9745607-3-1.
    .. [2] G. Heinzel, A. Ruediger and R. Schilling, "Spectrum and
           spectral density estimation by the Discrete Fourier transform
           (DFT), including a comprehensive list of window functions and
           some new at-top windows", 2002,
           http://hdl.handle.net/11858/00-001M-0000-0013-557A-5

    Examples
    --------
    >>> from scipy import signal

    Confirm COLA condition for rectangular window of 75% (3/4) overlap:

    >>> signal.check_COLA(signal.windows.boxcar(100), 100, 75)
    True

    COLA is not true for 25% (1/4) overlap, though:

    >>> signal.check_COLA(signal.windows.boxcar(100), 100, 25)
    False

    "Symmetrical" Hann window (for filter design) is not COLA:

    >>> signal.check_COLA(signal.windows.hann(120, sym=True), 120, 60)
    False

    "Periodic" or "DFT-even" Hann window (for FFT analysis) is COLA for
    overlap of 1/2, 2/3, 3/4, etc.:

    >>> signal.check_COLA(signal.windows.hann(120, sym=False), 120, 60)
    True

    >>> signal.check_COLA(signal.windows.hann(120, sym=False), 120, 80)
    True

    >>> signal.check_COLA(signal.windows.hann(120, sym=False), 120, 90)
    True

    """
    nperseg = int(nperseg)

    if nperseg < 1:
        raise ValueError('nperseg must be a positive integer')

    if noverlap >= nperseg:
        raise ValueError('noverlap must be less than nperseg.')
    noverlap = int(noverlap)

    if isinstance(window, str) or type(window) is tuple:
        win = get_window(window, nperseg)
    else:
        win = np.asarray(window)
        if len(win.shape) != 1:
            raise ValueError('window must be 1-D')
        if win.shape[0] != nperseg:
            raise ValueError('window must have length of nperseg')

    step = nperseg - noverlap
    binsums = sum(win[ii*step:(ii+1)*step] for ii in range(nperseg//step))

    if nperseg % step != 0:
        binsums[:nperseg % step] += win[-(nperseg % step):]

    deviation = binsums - np.median(binsums)
    return np.max(np.abs(deviation)) < tol


def check_NOLA(window, nperseg, noverlap, tol=1e-10):
    r"""Check whether the Nonzero Overlap Add (NOLA) constraint is met.

    Parameters
    ----------
    window : str or tuple or array_like
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg.
    nperseg : int
        Length of each segment.
    noverlap : int
        Number of points to overlap between segments.
    tol : float, optional
        The allowed variance of a bin's weighted sum from the median bin
        sum.

    Returns
    -------
    verdict : bool
        `True` if chosen combination satisfies the NOLA constraint within
        `tol`, `False` otherwise

    See Also
    --------
    check_COLA: Check whether the Constant OverLap Add (COLA) constraint is met
    stft: Short Time Fourier Transform
    istft: Inverse Short Time Fourier Transform

    Notes
    -----
    In order to enable inversion of an STFT via the inverse STFT in
    `istft`, the signal windowing must obey the constraint of "nonzero
    overlap add" (NOLA):

    .. math:: \sum_{t}w^{2}[n-tH] \ne 0

    for all :math:`n`, where :math:`w` is the window function, :math:`t` is the
    frame index, and :math:`H` is the hop size (:math:`H` = `nperseg` -
    `noverlap`).

    This ensures that the normalization factors in the denominator of the
    overlap-add inversion equation are not zero. Only very pathological windows
    will fail the NOLA constraint.

    .. versionadded:: 1.2.0

    References
    ----------
    .. [1] Julius O. Smith III, "Spectral Audio Signal Processing", W3K
           Publishing, 2011,ISBN 978-0-9745607-3-1.
    .. [2] G. Heinzel, A. Ruediger and R. Schilling, "Spectrum and
           spectral density estimation by the Discrete Fourier transform
           (DFT), including a comprehensive list of window functions and
           some new at-top windows", 2002,
           http://hdl.handle.net/11858/00-001M-0000-0013-557A-5

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal

    Confirm NOLA condition for rectangular window of 75% (3/4) overlap:

    >>> signal.check_NOLA(signal.windows.boxcar(100), 100, 75)
    True

    NOLA is also true for 25% (1/4) overlap:

    >>> signal.check_NOLA(signal.windows.boxcar(100), 100, 25)
    True

    "Symmetrical" Hann window (for filter design) is also NOLA:

    >>> signal.check_NOLA(signal.windows.hann(120, sym=True), 120, 60)
    True

    As long as there is overlap, it takes quite a pathological window to fail
    NOLA:

    >>> w = np.ones(64, dtype="float")
    >>> w[::2] = 0
    >>> signal.check_NOLA(w, 64, 32)
    False

    If there is not enough overlap, a window with zeros at the ends will not
    work:

    >>> signal.check_NOLA(signal.windows.hann(64), 64, 0)
    False
    >>> signal.check_NOLA(signal.windows.hann(64), 64, 1)
    False
    >>> signal.check_NOLA(signal.windows.hann(64), 64, 2)
    True

    """
    nperseg = int(nperseg)

    if nperseg < 1:
        raise ValueError('nperseg must be a positive integer')

    if noverlap >= nperseg:
        raise ValueError('noverlap must be less than nperseg')
    if noverlap < 0:
        raise ValueError('noverlap must be a nonnegative integer')
    noverlap = int(noverlap)

    if isinstance(window, str) or type(window) is tuple:
        win = get_window(window, nperseg)
    else:
        win = np.asarray(window)
        if len(win.shape) != 1:
            raise ValueError('window must be 1-D')
        if win.shape[0] != nperseg:
            raise ValueError('window must have length of nperseg')

    step = nperseg - noverlap
    binsums = sum(win[ii*step:(ii+1)*step]**2 for ii in range(nperseg//step))

    if nperseg % step != 0:
        binsums[:nperseg % step] += win[-(nperseg % step):]**2

    return np.min(binsums) > tol


def stft(x, fs=1.0, window='hann', nperseg=256, noverlap=None, nfft=None,
         detrend=False, return_onesided=True, boundary='zeros', padded=True,
         axis=-1, scaling='spectrum'):
    r"""Compute the Short Time Fourier Transform (legacy function).

    STFTs can be used as a way of quantifying the change of a
    nonstationary signal's frequency and phase content over time.

    .. legacy:: function

        `ShortTimeFFT` is a newer STFT / ISTFT implementation with more
        features. A :ref:`comparison <tutorial_stft_legacy_stft>` between the
        implementations can be found in the :ref:`tutorial_stft` section of the
        :ref:`user_guide`.

    Parameters
    ----------
    x : array_like
        Time series of measurement values
    fs : float, optional
        Sampling frequency of the `x` time series. Defaults to 1.0.
    window : str or tuple or array_like, optional
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg. Defaults
        to a Hann window.
    nperseg : int, optional
        Length of each segment. Defaults to 256.
    noverlap : int, optional
        Number of points to overlap between segments. If `None`,
        ``noverlap = nperseg // 2``. Defaults to `None`. When
        specified, the COLA constraint must be met (see Notes below).
    nfft : int, optional
        Length of the FFT used, if a zero padded FFT is desired. If
        `None`, the FFT length is `nperseg`. Defaults to `None`.
    detrend : str or function or `False`, optional
        Specifies how to detrend each segment. If `detrend` is a
        string, it is passed as the `type` argument to the `detrend`
        function. If it is a function, it takes a segment and returns a
        detrended segment. If `detrend` is `False`, no detrending is
        done. Defaults to `False`.
    return_onesided : bool, optional
        If `True`, return a one-sided spectrum for real data. If
        `False` return a two-sided spectrum. Defaults to `True`, but for
        complex data, a two-sided spectrum is always returned.
    boundary : str or None, optional
        Specifies whether the input signal is extended at both ends, and
        how to generate the new values, in order to center the first
        windowed segment on the first input point. This has the benefit
        of enabling reconstruction of the first input point when the
        employed window function starts at zero. Valid options are
        ``['even', 'odd', 'constant', 'zeros', None]``. Defaults to
        'zeros', for zero padding extension. I.e. ``[1, 2, 3, 4]`` is
        extended to ``[0, 1, 2, 3, 4, 0]`` for ``nperseg=3``.
    padded : bool, optional
        Specifies whether the input signal is zero-padded at the end to
        make the signal fit exactly into an integer number of window
        segments, so that all of the signal is included in the output.
        Defaults to `True`. Padding occurs after boundary extension, if
        `boundary` is not `None`, and `padded` is `True`, as is the
        default.
    axis : int, optional
        Axis along which the STFT is computed; the default is over the
        last axis (i.e. ``axis=-1``).
    scaling: {'spectrum', 'psd'}
        The default 'spectrum' scaling allows each frequency line of `Zxx` to
        be interpreted as a magnitude spectrum. The 'psd' option scales each
        line to a power spectral density - it allows to calculate the signal's
        energy by numerically integrating over ``abs(Zxx)**2``.

        .. versionadded:: 1.9.0

    Returns
    -------
    f : ndarray
        Array of sample frequencies.
    t : ndarray
        Array of segment times.
    Zxx : ndarray
        STFT of `x`. By default, the last axis of `Zxx` corresponds
        to the segment times.

    See Also
    --------
    istft: Inverse Short Time Fourier Transform
    ShortTimeFFT: Newer STFT/ISTFT implementation providing more features.
    check_COLA: Check whether the Constant OverLap Add (COLA) constraint
                is met
    check_NOLA: Check whether the Nonzero Overlap Add (NOLA) constraint is met
    welch: Power spectral density by Welch's method.
    spectrogram: Spectrogram by Welch's method.
    csd: Cross spectral density by Welch's method.
    lombscargle: Lomb-Scargle periodogram for unevenly sampled data

    Notes
    -----
    In order to enable inversion of an STFT via the inverse STFT in
    `istft`, the signal windowing must obey the constraint of "Nonzero
    OverLap Add" (NOLA), and the input signal must have complete
    windowing coverage (i.e. ``(x.shape[axis] - nperseg) %
    (nperseg-noverlap) == 0``). The `padded` argument may be used to
    accomplish this.

    Given a time-domain signal :math:`x[n]`, a window :math:`w[n]`, and a hop
    size :math:`H` = `nperseg - noverlap`, the windowed frame at time index
    :math:`t` is given by

    .. math:: x_{t}[n]=x[n]w[n-tH]

    The overlap-add (OLA) reconstruction equation is given by

    .. math:: x[n]=\frac{\sum_{t}x_{t}[n]w[n-tH]}{\sum_{t}w^{2}[n-tH]}

    The NOLA constraint ensures that every normalization term that appears
    in the denominator of the OLA reconstruction equation is nonzero. Whether a
    choice of `window`, `nperseg`, and `noverlap` satisfy this constraint can
    be tested with `check_NOLA`.


    .. versionadded:: 0.19.0

    References
    ----------
    .. [1] Oppenheim, Alan V., Ronald W. Schafer, John R. Buck
           "Discrete-Time Signal Processing", Prentice Hall, 1999.
    .. [2] Daniel W. Griffin, Jae S. Lim "Signal Estimation from
           Modified Short-Time Fourier Transform", IEEE 1984,
           10.1109/TASSP.1984.1164317

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()

    Generate a test signal, a 2 Vrms sine wave whose frequency is slowly
    modulated around 3kHz, corrupted by white noise of exponentially
    decreasing magnitude sampled at 10 kHz.

    >>> fs = 10e3
    >>> N = 1e5
    >>> amp = 2 * np.sqrt(2)
    >>> noise_power = 0.01 * fs / 2
    >>> time = np.arange(N) / float(fs)
    >>> mod = 500*np.cos(2*np.pi*0.25*time)
    >>> carrier = amp * np.sin(2*np.pi*3e3*time + mod)
    >>> noise = rng.normal(scale=np.sqrt(noise_power),
    ...                    size=time.shape)
    >>> noise *= np.exp(-time/5)
    >>> x = carrier + noise

    Compute and plot the STFT's magnitude.

    >>> f, t, Zxx = signal.stft(x, fs, nperseg=1000)
    >>> plt.pcolormesh(t, f, np.abs(Zxx), vmin=0, vmax=amp, shading='gouraud')
    >>> plt.title('STFT Magnitude')
    >>> plt.ylabel('Frequency [Hz]')
    >>> plt.xlabel('Time [sec]')
    >>> plt.show()

    Compare the energy of the signal `x` with the energy of its STFT:

    >>> E_x = sum(x**2) / fs  # Energy of x
    >>> # Calculate a two-sided STFT with PSD scaling:
    >>> f, t, Zxx = signal.stft(x, fs, nperseg=1000, return_onesided=False,
    ...                         scaling='psd')
    >>> # Integrate numerically over abs(Zxx)**2:
    >>> df, dt = f[1] - f[0], t[1] - t[0]
    >>> E_Zxx = sum(np.sum(Zxx.real**2 + Zxx.imag**2, axis=0) * df) * dt
    >>> # The energy is the same, but the numerical errors are quite large:
    >>> np.isclose(E_x, E_Zxx, rtol=1e-2)
    True

    """
    if scaling == 'psd':
        scaling = 'density'
    elif scaling != 'spectrum':
        raise ValueError(f"Parameter {scaling=} not in ['spectrum', 'psd']!")

    freqs, time, Zxx = _spectral_helper(x, x, fs, window, nperseg, noverlap,
                                        nfft, detrend, return_onesided,
                                        scaling=scaling, axis=axis,
                                        mode='stft', boundary=boundary,
                                        padded=padded)

    return freqs, time, Zxx


def istft(Zxx, fs=1.0, window='hann', nperseg=None, noverlap=None, nfft=None,
          input_onesided=True, boundary=True, time_axis=-1, freq_axis=-2,
          scaling='spectrum'):
    r"""Perform the inverse Short Time Fourier transform (legacy function).

    .. legacy:: function

        `ShortTimeFFT` is a newer STFT / ISTFT implementation with more
        features. A :ref:`comparison <tutorial_stft_legacy_stft>` between the
        implementations can be found in the :ref:`tutorial_stft` section of the
        :ref:`user_guide`.

    Parameters
    ----------
    Zxx : array_like
        STFT of the signal to be reconstructed. If a purely real array
        is passed, it will be cast to a complex data type.
    fs : float, optional
        Sampling frequency of the time series. Defaults to 1.0.
    window : str or tuple or array_like, optional
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg. Defaults
        to a Hann window. Must match the window used to generate the
        STFT for faithful inversion.
    nperseg : int, optional
        Number of data points corresponding to each STFT segment. This
        parameter must be specified if the number of data points per
        segment is odd, or if the STFT was padded via ``nfft >
        nperseg``. If `None`, the value depends on the shape of
        `Zxx` and `input_onesided`. If `input_onesided` is `True`,
        ``nperseg=2*(Zxx.shape[freq_axis] - 1)``. Otherwise,
        ``nperseg=Zxx.shape[freq_axis]``. Defaults to `None`.
    noverlap : int, optional
        Number of points to overlap between segments. If `None`, half
        of the segment length. Defaults to `None`. When specified, the
        COLA constraint must be met (see Notes below), and should match
        the parameter used to generate the STFT. Defaults to `None`.
    nfft : int, optional
        Number of FFT points corresponding to each STFT segment. This
        parameter must be specified if the STFT was padded via ``nfft >
        nperseg``. If `None`, the default values are the same as for
        `nperseg`, detailed above, with one exception: if
        `input_onesided` is True and
        ``nperseg==2*Zxx.shape[freq_axis] - 1``, `nfft` also takes on
        that value. This case allows the proper inversion of an
        odd-length unpadded STFT using ``nfft=None``. Defaults to
        `None`.
    input_onesided : bool, optional
        If `True`, interpret the input array as one-sided FFTs, such
        as is returned by `stft` with ``return_onesided=True`` and
        `numpy.fft.rfft`. If `False`, interpret the input as a a
        two-sided FFT. Defaults to `True`.
    boundary : bool, optional
        Specifies whether the input signal was extended at its
        boundaries by supplying a non-`None` ``boundary`` argument to
        `stft`. Defaults to `True`.
    time_axis : int, optional
        Where the time segments of the STFT is located; the default is
        the last axis (i.e. ``axis=-1``).
    freq_axis : int, optional
        Where the frequency axis of the STFT is located; the default is
        the penultimate axis (i.e. ``axis=-2``).
    scaling: {'spectrum', 'psd'}
        The default 'spectrum' scaling allows each frequency line of `Zxx` to
        be interpreted as a magnitude spectrum. The 'psd' option scales each
        line to a power spectral density - it allows to calculate the signal's
        energy by numerically integrating over ``abs(Zxx)**2``.

    Returns
    -------
    t : ndarray
        Array of output data times.
    x : ndarray
        iSTFT of `Zxx`.

    See Also
    --------
    stft: Short Time Fourier Transform
    ShortTimeFFT: Newer STFT/ISTFT implementation providing more features.
    check_COLA: Check whether the Constant OverLap Add (COLA) constraint
                is met
    check_NOLA: Check whether the Nonzero Overlap Add (NOLA) constraint is met

    Notes
    -----
    In order to enable inversion of an STFT via the inverse STFT with
    `istft`, the signal windowing must obey the constraint of "nonzero
    overlap add" (NOLA):

    .. math:: \sum_{t}w^{2}[n-tH] \ne 0

    This ensures that the normalization factors that appear in the denominator
    of the overlap-add reconstruction equation

    .. math:: x[n]=\frac{\sum_{t}x_{t}[n]w[n-tH]}{\sum_{t}w^{2}[n-tH]}

    are not zero. The NOLA constraint can be checked with the `check_NOLA`
    function.

    An STFT which has been modified (via masking or otherwise) is not
    guaranteed to correspond to a exactly realizible signal. This
    function implements the iSTFT via the least-squares estimation
    algorithm detailed in [2]_, which produces a signal that minimizes
    the mean squared error between the STFT of the returned signal and
    the modified STFT.


    .. versionadded:: 0.19.0

    References
    ----------
    .. [1] Oppenheim, Alan V., Ronald W. Schafer, John R. Buck
           "Discrete-Time Signal Processing", Prentice Hall, 1999.
    .. [2] Daniel W. Griffin, Jae S. Lim "Signal Estimation from
           Modified Short-Time Fourier Transform", IEEE 1984,
           10.1109/TASSP.1984.1164317

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()

    Generate a test signal, a 2 Vrms sine wave at 50Hz corrupted by
    0.001 V**2/Hz of white noise sampled at 1024 Hz.

    >>> fs = 1024
    >>> N = 10*fs
    >>> nperseg = 512
    >>> amp = 2 * np.sqrt(2)
    >>> noise_power = 0.001 * fs / 2
    >>> time = np.arange(N) / float(fs)
    >>> carrier = amp * np.sin(2*np.pi*50*time)
    >>> noise = rng.normal(scale=np.sqrt(noise_power),
    ...                    size=time.shape)
    >>> x = carrier + noise

    Compute the STFT, and plot its magnitude

    >>> f, t, Zxx = signal.stft(x, fs=fs, nperseg=nperseg)
    >>> plt.figure()
    >>> plt.pcolormesh(t, f, np.abs(Zxx), vmin=0, vmax=amp, shading='gouraud')
    >>> plt.ylim([f[1], f[-1]])
    >>> plt.title('STFT Magnitude')
    >>> plt.ylabel('Frequency [Hz]')
    >>> plt.xlabel('Time [sec]')
    >>> plt.yscale('log')
    >>> plt.show()

    Zero the components that are 10% or less of the carrier magnitude,
    then convert back to a time series via inverse STFT

    >>> Zxx = np.where(np.abs(Zxx) >= amp/10, Zxx, 0)
    >>> _, xrec = signal.istft(Zxx, fs)

    Compare the cleaned signal with the original and true carrier signals.

    >>> plt.figure()
    >>> plt.plot(time, x, time, xrec, time, carrier)
    >>> plt.xlim([2, 2.1])
    >>> plt.xlabel('Time [sec]')
    >>> plt.ylabel('Signal')
    >>> plt.legend(['Carrier + Noise', 'Filtered via STFT', 'True Carrier'])
    >>> plt.show()

    Note that the cleaned signal does not start as abruptly as the original,
    since some of the coefficients of the transient were also removed:

    >>> plt.figure()
    >>> plt.plot(time, x, time, xrec, time, carrier)
    >>> plt.xlim([0, 0.1])
    >>> plt.xlabel('Time [sec]')
    >>> plt.ylabel('Signal')
    >>> plt.legend(['Carrier + Noise', 'Filtered via STFT', 'True Carrier'])
    >>> plt.show()

    """
    # Make sure input is an ndarray of appropriate complex dtype
    Zxx = np.asarray(Zxx) + 0j
    freq_axis = int(freq_axis)
    time_axis = int(time_axis)

    if Zxx.ndim < 2:
        raise ValueError('Input stft must be at least 2d!')

    if freq_axis == time_axis:
        raise ValueError('Must specify differing time and frequency axes!')

    nseg = Zxx.shape[time_axis]

    if input_onesided:
        # Assume even segment length
        n_default = 2*(Zxx.shape[freq_axis] - 1)
    else:
        n_default = Zxx.shape[freq_axis]

    # Check windowing parameters
    if nperseg is None:
        nperseg = n_default
    else:
        nperseg = int(nperseg)
        if nperseg < 1:
            raise ValueError('nperseg must be a positive integer')

    if nfft is None:
        if (input_onesided) and (nperseg == n_default + 1):
            # Odd nperseg, no FFT padding
            nfft = nperseg
        else:
            nfft = n_default
    elif nfft < nperseg:
        raise ValueError('nfft must be greater than or equal to nperseg.')
    else:
        nfft = int(nfft)

    if noverlap is None:
        noverlap = nperseg//2
    else:
        noverlap = int(noverlap)
    if noverlap >= nperseg:
        raise ValueError('noverlap must be less than nperseg.')
    nstep = nperseg - noverlap

    # Rearrange axes if necessary
    if time_axis != Zxx.ndim-1 or freq_axis != Zxx.ndim-2:
        # Turn negative indices to positive for the call to transpose
        if freq_axis < 0:
            freq_axis = Zxx.ndim + freq_axis
        if time_axis < 0:
            time_axis = Zxx.ndim + time_axis
        zouter = list(range(Zxx.ndim))
        for ax in sorted([time_axis, freq_axis], reverse=True):
            zouter.pop(ax)
        Zxx = np.transpose(Zxx, zouter+[freq_axis, time_axis])

    # Get window as array
    if isinstance(window, str) or type(window) is tuple:
        win = get_window(window, nperseg)
    else:
        win = np.asarray(window)
        if len(win.shape) != 1:
            raise ValueError('window must be 1-D')
        if win.shape[0] != nperseg:
            raise ValueError(f'window must have length of {nperseg}')

    ifunc = sp_fft.irfft if input_onesided else sp_fft.ifft
    xsubs = ifunc(Zxx, axis=-2, n=nfft)[..., :nperseg, :]

    # Initialize output and normalization arrays
    outputlength = nperseg + (nseg-1)*nstep
    x = np.zeros(list(Zxx.shape[:-2])+[outputlength], dtype=xsubs.dtype)
    norm = np.zeros(outputlength, dtype=xsubs.dtype)

    if np.result_type(win, xsubs) != xsubs.dtype:
        win = win.astype(xsubs.dtype)

    if scaling == 'spectrum':
        xsubs *= win.sum()
    elif scaling == 'psd':
        xsubs *= np.sqrt(fs * sum(win**2))
    else:
        raise ValueError(f"Parameter {scaling=} not in ['spectrum', 'psd']!")

    # Construct the output from the ifft segments
    # This loop could perhaps be vectorized/strided somehow...
    for ii in range(nseg):
        # Window the ifft
        x[..., ii*nstep:ii*nstep+nperseg] += xsubs[..., ii] * win
        norm[..., ii*nstep:ii*nstep+nperseg] += win**2

    # Remove extension points
    if boundary:
        x = x[..., nperseg//2:-(nperseg//2)]
        norm = norm[..., nperseg//2:-(nperseg//2)]

    # Divide out normalization where non-tiny
    if np.sum(norm > 1e-10) != len(norm):
        warnings.warn(
            "NOLA condition failed, STFT may not be invertible."
            + (" Possibly due to missing boundary" if not boundary else ""),
            stacklevel=2
        )
    x /= np.where(norm > 1e-10, norm, 1.0)

    if input_onesided:
        x = x.real

    # Put axes back
    if x.ndim > 1:
        if time_axis != Zxx.ndim-1:
            if freq_axis < time_axis:
                time_axis -= 1
            x = np.moveaxis(x, -1, time_axis)

    time = np.arange(x.shape[0])/float(fs)
    return time, x


def coherence(x, y, fs=1.0, window='hann', nperseg=None, noverlap=None,
              nfft=None, detrend='constant', axis=-1):
    r"""
    Estimate the magnitude squared coherence estimate, Cxy, of
    discrete-time signals X and Y using Welch's method.

    ``Cxy = abs(Pxy)**2/(Pxx*Pyy)``, where `Pxx` and `Pyy` are power
    spectral density estimates of X and Y, and `Pxy` is the cross
    spectral density estimate of X and Y.

    Parameters
    ----------
    x : array_like
        Time series of measurement values
    y : array_like
        Time series of measurement values
    fs : float, optional
        Sampling frequency of the `x` and `y` time series. Defaults
        to 1.0.
    window : str or tuple or array_like, optional
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg. Defaults
        to a Hann window.
    nperseg : int, optional
        Length of each segment. Defaults to None, but if window is str or
        tuple, is set to 256, and if window is array_like, is set to the
        length of the window.
    noverlap: int, optional
        Number of points to overlap between segments. If `None`,
        ``noverlap = nperseg // 2``. Defaults to `None`.
    nfft : int, optional
        Length of the FFT used, if a zero padded FFT is desired. If
        `None`, the FFT length is `nperseg`. Defaults to `None`.
    detrend : str or function or `False`, optional
        Specifies how to detrend each segment. If `detrend` is a
        string, it is passed as the `type` argument to the `detrend`
        function. If it is a function, it takes a segment and returns a
        detrended segment. If `detrend` is `False`, no detrending is
        done. Defaults to 'constant'.
    axis : int, optional
        Axis along which the coherence is computed for both inputs; the
        default is over the last axis (i.e. ``axis=-1``).

    Returns
    -------
    f : ndarray
        Array of sample frequencies.
    Cxy : ndarray
        Magnitude squared coherence of x and y.

    See Also
    --------
    periodogram: Simple, optionally modified periodogram
    lombscargle: Lomb-Scargle periodogram for unevenly sampled data
    welch: Power spectral density by Welch's method.
    csd: Cross spectral density by Welch's method.

    Notes
    -----
    An appropriate amount of overlap will depend on the choice of window
    and on your requirements. For the default Hann window an overlap of
    50% is a reasonable trade-off between accurately estimating the
    signal power, while not over counting any of the data. Narrower
    windows may require a larger overlap.

    .. versionadded:: 0.16.0

    References
    ----------
    .. [1] P. Welch, "The use of the fast Fourier transform for the
           estimation of power spectra: A method based on time averaging
           over short, modified periodograms", IEEE Trans. Audio
           Electroacoust. vol. 15, pp. 70-73, 1967.
    .. [2] Stoica, Petre, and Randolph Moses, "Spectral Analysis of
           Signals" Prentice Hall, 2005

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()

    Generate two test signals with some common features.

    >>> fs = 10e3
    >>> N = 1e5
    >>> amp = 20
    >>> freq = 1234.0
    >>> noise_power = 0.001 * fs / 2
    >>> time = np.arange(N) / fs
    >>> b, a = signal.butter(2, 0.25, 'low')
    >>> x = rng.normal(scale=np.sqrt(noise_power), size=time.shape)
    >>> y = signal.lfilter(b, a, x)
    >>> x += amp*np.sin(2*np.pi*freq*time)
    >>> y += rng.normal(scale=0.1*np.sqrt(noise_power), size=time.shape)

    Compute and plot the coherence.

    >>> f, Cxy = signal.coherence(x, y, fs, nperseg=1024)
    >>> plt.semilogy(f, Cxy)
    >>> plt.xlabel('frequency [Hz]')
    >>> plt.ylabel('Coherence')
    >>> plt.show()

    """
    freqs, Pxx = welch(x, fs=fs, window=window, nperseg=nperseg,
                       noverlap=noverlap, nfft=nfft, detrend=detrend,
                       axis=axis)
    _, Pyy = welch(y, fs=fs, window=window, nperseg=nperseg, noverlap=noverlap,
                   nfft=nfft, detrend=detrend, axis=axis)
    _, Pxy = csd(x, y, fs=fs, window=window, nperseg=nperseg,
                 noverlap=noverlap, nfft=nfft, detrend=detrend, axis=axis)

    Cxy = np.abs(Pxy)**2 / Pxx / Pyy

    return freqs, Cxy


def _spectral_helper(x, y, fs=1.0, window='hann', nperseg=None, noverlap=None,
                     nfft=None, detrend='constant', return_onesided=True,
                     scaling='density', axis=-1, mode='psd', boundary=None,
                     padded=False):
    """Calculate various forms of windowed FFTs for PSD, CSD, etc.

    .. legacy:: function

        This function is soley used by the legacy functions `spectrogram` and `stft`
        (which are also in this same source file `scipy/signal/_spectral_py.py`).

    This is a helper function that implements the commonality between
    the stft, psd, csd, and spectrogram functions. It is not designed to
    be called externally. The windows are not averaged over; the result
    from each window is returned.

    Parameters
    ----------
    x : array_like
        Array or sequence containing the data to be analyzed.
    y : array_like
        Array or sequence containing the data to be analyzed. If this is
        the same object in memory as `x` (i.e. ``_spectral_helper(x,
        x, ...)``), the extra computations are spared.
    fs : float, optional
        Sampling frequency of the time series. Defaults to 1.0.
    window : str or tuple or array_like, optional
        Desired window to use. If `window` is a string or tuple, it is
        passed to `get_window` to generate the window values, which are
        DFT-even by default. See `get_window` for a list of windows and
        required parameters. If `window` is array_like it will be used
        directly as the window and its length must be nperseg. Defaults
        to a Hann window.
    nperseg : int, optional
        Length of each segment. Defaults to None, but if window is str or
        tuple, is set to 256, and if window is array_like, is set to the
        length of the window.
    noverlap : int, optional
        Number of points to overlap between segments. If `None`,
        ``noverlap = nperseg // 2``. Defaults to `None`.
    nfft : int, optional
        Length of the FFT used, if a zero padded FFT is desired. If
        `None`, the FFT length is `nperseg`. Defaults to `None`.
    detrend : str or function or `False`, optional
        Specifies how to detrend each segment. If `detrend` is a
        string, it is passed as the `type` argument to the `detrend`
        function. If it is a function, it takes a segment and returns a
        detrended segment. If `detrend` is `False`, no detrending is
        done. Defaults to 'constant'.
    return_onesided : bool, optional
        If `True`, return a one-sided spectrum for real data. If
        `False` return a two-sided spectrum. Defaults to `True`, but for
        complex data, a two-sided spectrum is always returned.
    scaling : { 'density', 'spectrum' }, optional
        Selects between computing the cross spectral density ('density')
        where `Pxy` has units of V²/Hz and computing the cross
        spectrum ('spectrum') where `Pxy` has units of V², if `x`
        and `y` are measured in V and `fs` is measured in Hz.
        Defaults to 'density'
    axis : int, optional
        Axis along which the FFTs are computed; the default is over the
        last axis (i.e. ``axis=-1``).
    mode: str {'psd', 'stft'}, optional
        Defines what kind of return values are expected. Defaults to
        'psd'.
    boundary : str or None, optional
        Specifies whether the input signal is extended at both ends, and
        how to generate the new values, in order to center the first
        windowed segment on the first input point. This has the benefit
        of enabling reconstruction of the first input point when the
        employed window function starts at zero. Valid options are
        ``['even', 'odd', 'constant', 'zeros', None]``. Defaults to
        `None`.
    padded : bool, optional
        Specifies whether the input signal is zero-padded at the end to
        make the signal fit exactly into an integer number of window
        segments, so that all of the signal is included in the output.
        Defaults to `False`. Padding occurs after boundary extension, if
        `boundary` is not `None`, and `padded` is `True`.

    Returns
    -------
    freqs : ndarray
        Array of sample frequencies.
    t : ndarray
        Array of times corresponding to each data segment
    result : ndarray
        Array of output data, contents dependent on *mode* kwarg.

    Notes
    -----
    Adapted from matplotlib.mlab

    .. versionadded:: 0.16.0
    """
    if mode not in ['psd', 'stft']:
        raise ValueError(f"Unknown value for mode {mode}, must be one of: "
                         "{'psd', 'stft'}")

    boundary_funcs = {'even': even_ext,
                      'odd': odd_ext,
                      'constant': const_ext,
                      'zeros': zero_ext,
                      None: None}

    if boundary not in boundary_funcs:
        raise ValueError(f"Unknown boundary option '{boundary}', "
                         f"must be one of: {list(boundary_funcs.keys())}")

    # If x and y are the same object we can save ourselves some computation.
    same_data = y is x

    if not same_data and mode != 'psd':
        raise ValueError("x and y must be equal if mode is 'stft'")

    axis = int(axis)

    # Ensure we have np.arrays, get outdtype
    x = np.asarray(x)
    if not same_data:
        y = np.asarray(y)
        outdtype = np.result_type(x, y, np.complex64)
    else:
        outdtype = np.result_type(x, np.complex64)

    if not same_data:
        # Check if we can broadcast the outer axes together
        xouter = list(x.shape)
        youter = list(y.shape)
        xouter.pop(axis)
        youter.pop(axis)
        try:
            outershape = np.broadcast(np.empty(xouter), np.empty(youter)).shape
        except ValueError as e:
            raise ValueError('x and y cannot be broadcast together.') from e

    if same_data:
        if x.size == 0:
            return np.empty(x.shape), np.empty(x.shape), np.empty(x.shape)
    else:
        if x.size == 0 or y.size == 0:
            outshape = outershape + (min([x.shape[axis], y.shape[axis]]),)
            emptyout = np.moveaxis(np.empty(outshape), -1, axis)
            return emptyout, emptyout, emptyout

    if x.ndim > 1:
        if axis != -1:
            x = np.moveaxis(x, axis, -1)
            if not same_data and y.ndim > 1:
                y = np.moveaxis(y, axis, -1)

    # Check if x and y are the same length, zero-pad if necessary
    if not same_data:
        if x.shape[-1] != y.shape[-1]:
            if x.shape[-1] < y.shape[-1]:
                pad_shape = list(x.shape)
                pad_shape[-1] = y.shape[-1] - x.shape[-1]
                x = np.concatenate((x, np.zeros(pad_shape)), -1)
            else:
                pad_shape = list(y.shape)
                pad_shape[-1] = x.shape[-1] - y.shape[-1]
                y = np.concatenate((y, np.zeros(pad_shape)), -1)

    if nperseg is not None:  # if specified by user
        nperseg = int(nperseg)
        if nperseg < 1:
            raise ValueError('nperseg must be a positive integer')

    # parse window; if array like, then set nperseg = win.shape
    win, nperseg = _triage_segments(window, nperseg, input_length=x.shape[-1])

    if nfft is None:
        nfft = nperseg
    elif nfft < nperseg:
        raise ValueError('nfft must be greater than or equal to nperseg.')
    else:
        nfft = int(nfft)

    if noverlap is None:
        noverlap = nperseg//2
    else:
        noverlap = int(noverlap)
    if noverlap >= nperseg:
        raise ValueError('noverlap must be less than nperseg.')
    nstep = nperseg - noverlap

    # Padding occurs after boundary extension, so that the extended signal ends
    # in zeros, instead of introducing an impulse at the end.
    # I.e. if x = [..., 3, 2]
    # extend then pad -> [..., 3, 2, 2, 3, 0, 0, 0]
    # pad then extend -> [..., 3, 2, 0, 0, 0, 2, 3]

    if boundary is not None:
        ext_func = boundary_funcs[boundary]
        x = ext_func(x, nperseg//2, axis=-1)
        if not same_data:
            y = ext_func(y, nperseg//2, axis=-1)

    if padded:
        # Pad to integer number of windowed segments
        # I.e. make x.shape[-1] = nperseg + (nseg-1)*nstep, with integer nseg
        nadd = (-(x.shape[-1]-nperseg) % nstep) % nperseg
        zeros_shape = list(x.shape[:-1]) + [nadd]
        x = np.concatenate((x, np.zeros(zeros_shape)), axis=-1)
        if not same_data:
            zeros_shape = list(y.shape[:-1]) + [nadd]
            y = np.concatenate((y, np.zeros(zeros_shape)), axis=-1)

    # Handle detrending and window functions
    if not detrend:
        def detrend_func(d):
            return d
    elif not hasattr(detrend, '__call__'):
        def detrend_func(d):
            return _signaltools.detrend(d, type=detrend, axis=-1)
    elif axis != -1:
        # Wrap this function so that it receives a shape that it could
        # reasonably expect to receive.
        def detrend_func(d):
            d = np.moveaxis(d, -1, axis)
            d = detrend(d)
            return np.moveaxis(d, axis, -1)
    else:
        detrend_func = detrend

    if np.result_type(win, np.complex64) != outdtype:
        win = win.astype(outdtype)

    if scaling == 'density':
        scale = 1.0 / (fs * (win*win).sum())
    elif scaling == 'spectrum':
        scale = 1.0 / win.sum()**2
    else:
        raise ValueError(f'Unknown scaling: {scaling!r}')

    if mode == 'stft':
        scale = np.sqrt(scale)

    if return_onesided:
        if np.iscomplexobj(x):
            sides = 'twosided'
            warnings.warn('Input data is complex, switching to return_onesided=False',
                          stacklevel=3)
        else:
            sides = 'onesided'
            if not same_data:
                if np.iscomplexobj(y):
                    sides = 'twosided'
                    warnings.warn('Input data is complex, switching to '
                                  'return_onesided=False',
                                  stacklevel=3)
    else:
        sides = 'twosided'

    if sides == 'twosided':
        freqs = sp_fft.fftfreq(nfft, 1/fs)
    elif sides == 'onesided':
        freqs = sp_fft.rfftfreq(nfft, 1/fs)

    # Perform the windowed FFTs
    result = _fft_helper(x, win, detrend_func, nperseg, noverlap, nfft, sides)

    if not same_data:
        # All the same operations on the y data
        result_y = _fft_helper(y, win, detrend_func, nperseg, noverlap, nfft,
                               sides)
        result = np.conjugate(result) * result_y
    elif mode == 'psd':
        result = np.conjugate(result) * result

    result *= scale
    if sides == 'onesided' and mode == 'psd':
        if nfft % 2:
            result[..., 1:] *= 2
        else:
            # Last point is unpaired Nyquist freq point, don't double
            result[..., 1:-1] *= 2

    time = np.arange(nperseg/2, x.shape[-1] - nperseg/2 + 1,
                     nperseg - noverlap)/float(fs)
    if boundary is not None:
        time -= (nperseg/2) / fs

    result = result.astype(outdtype)

    # All imaginary parts are zero anyways
    if same_data and mode != 'stft':
        result = result.real

    # Output is going to have new last axis for time/window index, so a
    # negative axis index shifts down one
    if axis < 0:
        axis -= 1

    # Roll frequency axis back to axis where the data came from
    result = np.moveaxis(result, -1, axis)

    return freqs, time, result


def _fft_helper(x, win, detrend_func, nperseg, noverlap, nfft, sides):
    """
    Calculate windowed FFT, for internal use by
    `scipy.signal._spectral_helper`.

    .. legacy:: function

        This function is solely used by the legacy `_spectral_helper` function,
        which is located also in this file.

    This is a helper function that does the main FFT calculation for
    `_spectral helper`. All input validation is performed there, and the
    data axis is assumed to be the last axis of x. It is not designed to
    be called externally. The windows are not averaged over; the result
    from each window is returned.

    Returns
    -------
    result : ndarray
        Array of FFT data

    Notes
    -----
    Adapted from matplotlib.mlab

    .. versionadded:: 0.16.0
    """
    # Created sliding window view of array
    if nperseg == 1 and noverlap == 0:
        result = x[..., np.newaxis]
    else:
        step = nperseg - noverlap
        result = np.lib.stride_tricks.sliding_window_view(
            x, window_shape=nperseg, axis=-1, writeable=True
        )
        result = result[..., 0::step, :]

    # Detrend each data segment individually
    result = detrend_func(result)

    # Apply window by multiplication
    result = win * result

    # Perform the fft. Acts on last axis by default. Zero-pads automatically
    if sides == 'twosided':
        func = sp_fft.fft
    else:
        result = result.real
        func = sp_fft.rfft
    result = func(result, n=nfft)

    return result


def _triage_segments(window, nperseg, input_length):
    """
    Parses window and nperseg arguments for spectrogram and _spectral_helper.
    This is a helper function, not meant to be called externally.

    .. legacy:: function

        This function is soley used by the legacy functions `spectrogram` and
        `_spectral_helper` (which are also in this file).

    Parameters
    ----------
    window : string, tuple, or ndarray
        If window is specified by a string or tuple and nperseg is not
        specified, nperseg is set to the default of 256 and returns a window of
        that length.
        If instead the window is array_like and nperseg is not specified, then
        nperseg is set to the length of the window. A ValueError is raised if
        the user supplies both an array_like window and a value for nperseg but
        nperseg does not equal the length of the window.

    nperseg : int
        Length of each segment

    input_length: int
        Length of input signal, i.e. x.shape[-1]. Used to test for errors.

    Returns
    -------
    win : ndarray
        window. If function was called with string or tuple than this will hold
        the actual array used as a window.

    nperseg : int
        Length of each segment. If window is str or tuple, nperseg is set to
        256. If window is array_like, nperseg is set to the length of the
        window.
    """
    # parse window; if array like, then set nperseg = win.shape
    if isinstance(window, str) or isinstance(window, tuple):
        # if nperseg not specified
        if nperseg is None:
            nperseg = 256  # then change to default
        if nperseg > input_length:
            warnings.warn(f'nperseg = {nperseg:d} is greater than input length '
                          f' = {input_length:d}, using nperseg = {input_length:d}',
                          stacklevel=3)
            nperseg = input_length
        win = get_window(window, nperseg)
    else:
        win = np.asarray(window)
        if len(win.shape) != 1:
            raise ValueError('window must be 1-D')
        if input_length < win.shape[-1]:
            raise ValueError('window is longer than input signal')
        if nperseg is None:
            nperseg = win.shape[0]
        elif nperseg is not None:
            if nperseg != win.shape[0]:
                raise ValueError("value specified for nperseg is different"
                                 " from length of window")
    return win, nperseg


def _median_bias(n):
    """
    Returns the bias of the median of a set of periodograms relative to
    the mean.

    See Appendix B from [1]_ for details.

    Parameters
    ----------
    n : int
        Numbers of periodograms being averaged.

    Returns
    -------
    bias : float
        Calculated bias.

    References
    ----------
    .. [1] B. Allen, W.G. Anderson, P.R. Brady, D.A. Brown, J.D.E. Creighton.
           "FINDCHIRP: an algorithm for detection of gravitational waves from
           inspiraling compact binaries", Physical Review D 85, 2012,
           :arxiv:`gr-qc/0509116`
    """
    ii_2 = 2 * np.arange(1., (n-1) // 2 + 1)
    return 1 + np.sum(1. / (ii_2 + 1) - 1. / ii_2)
