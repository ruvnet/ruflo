"""Implementation of an FFT-based Short-time Fourier Transform. """

# Implementation Notes for this file (as of 2023-07)
# --------------------------------------------------
# * MyPy version 1.1.1 does not seem to support decorated property methods
#   properly. Hence, applying ``@property`` to methods decorated with `@cache``
#   (as tried with the ``lower_border_end`` method) causes a mypy error when
#   accessing it as an index (e.g., ``SFT.lower_border_end[0]``).
# * Since the method `stft` and `istft` have identical names as the legacy
#   functions in the signal module, referencing them as HTML link in the
#   docstrings has to be done by an explicit `~ShortTimeFFT.stft` instead of an
#   ambiguous `stft` (The ``~`` hides the class / module name).
# * The HTML documentation currently renders each method/property on a separate
#   page without reference to the parent class. Thus, a link to `ShortTimeFFT`
#   was added to the "See Also" section of each method/property. These links
#   can be removed, when SciPy updates ``pydata-sphinx-theme`` to >= 0.13.3
#   (currently 0.9). Consult Issue 18512 and PR 16660 for further details.


# Provides typing union operator ``|`` in Python 3.9:
# Linter does not allow to import ``Generator`` from ``typing`` module:
from collections.abc import Generator, Callable
from functools import cache, lru_cache, partial
from typing import get_args, Literal

import numpy as np

import scipy.fft as fft_lib
from scipy.signal._signaltools import detrend
from scipy.signal.windows import get_window

__all__ = ['closest_STFT_dual_window', 'ShortTimeFFT']


#: Allowed values for parameter `padding` of method `ShortTimeFFT.stft()`:
PAD_TYPE = Literal['zeros', 'edge', 'even', 'odd']

#: Allowed values for property `ShortTimeFFT.fft_mode`:
FFT_MODE_TYPE = Literal['twosided', 'centered', 'onesided', 'onesided2X']


def _calc_dual_canonical_window(win: np.ndarray, hop: int) -> np.ndarray:
    """Calculate canonical dual window for 1d window `win` and a time step
    of `hop` samples.

    A ``ValueError`` is raised if the inversion fails.

    This is a separate function not a method, since it is also used in the
    class method ``ShortTimeFFT.from_dual()``.
    """
    if hop > len(win):
        raise ValueError(f"{hop=} is larger than window length of {len(win)}" +
                         " => STFT not invertible!")
    if issubclass(win.dtype.type, np.integer):
        raise ValueError("Parameter 'win' cannot be of integer type, but " +
                         f"{win.dtype=} => STFT not invertible!")
        # The calculation of `relative_resolution` does not work for ints.
        # Furthermore, `win / DD` casts the integers away, thus an implicit
        # cast is avoided, which can always cause confusion when using 32-Bit
        # floats.

    w2 = win.real**2 + win.imag**2  # win*win.conj() does not ensure w2 is real
    DD = w2.copy()
    for k_ in range(hop, len(win), hop):
        DD[k_:] += w2[:-k_]
        DD[:-k_] += w2[k_:]

    # check DD > 0:
    relative_resolution = np.finfo(win.dtype).resolution * max(DD)
    if not np.all(DD >= relative_resolution):
        raise ValueError("Short-time Fourier Transform not invertible!")

    return win / DD


def closest_STFT_dual_window(win: np.ndarray, hop: int,
                             desired_dual: np.ndarray | None = None, *,
                             scaled: bool = True) \
        -> tuple[np.ndarray, float | complex]:
    r"""Calculate the STFT dual window of a given window closest to a desired dual
        window.

        For a given short-time Fourier transform window `win` incremented by `hop`
        samples, the dual window is calculated, which minimizes
        ``abs(dual_win - desired_dual)**2`` when `scaled` is ``False``. For `scaled`
        set to ``True``, ``abs(alpha*dual_win - desired_dual)**2`` is minimized with
        `alpha` being the optimal scaling factor.
        A ``ValueError`` is raised if no valid dual window can be determined.


        Parameters
        ----------
        win : np.ndarray
            The window must be a real- or complex-valued 1d array.
        hop : int
            The increment in samples by which the window is shifted in each step.
        desired_dual: np.ndarray | None
            The desired dual window must be a 1d array of the same length as `win`.
            If set to ``None`` (default), then `desired_dual` is assumed to be the
            rectangular window, i.e., ``np.ones_like(win)``.
        scaled : bool
            If set (default), the closest scaled version instead of closest dual window
            is calculated.

        Returns
        -------
        dual_win : np.ndarray
            A dual window of ``alpha*win`` (with hop interval `hop`), which is closest
            to `desired_dual`. Note that the dual window of `win` is `dual_win/alpha`
            and that the dual window of `dual_win` is `alpha*win`.
            `dual_win` has the same shape as `win` and `desired_win`.
        alpha : float | complex
            Scale factor for `win`. It is always one if `scaled` is set to ``False``.

        Notes
        -----
        For a given window and `hop` interval, all possible dual windows are expressed
        by the `hop` linear conditions of Eq. :math:numref:`eq_STFT_AllDualWinsCond` in
        the :ref:`tutorial_stft` section of the :ref:`user_guide`. Hence, decreasing
        `hop`, increases the number of degrees of freedom of the set of all possible
        dual windows, improving the ability to better approximate a `desired_dual`.

        This function can also be used to determine windows which fulfill the
        so-called "Constant OverLap Add" (COLA) condition [1]_. It states that summing
        all touching window values at any given sample position results in the same
        constant :math:`\alpha`. Eq. :math:numref:`eq_STFT_AllDualWinsCond` shows that
        this is equal to having a rectangular dual window, i.e., the dual being
        ``alpha*np.ones(m)``.

        Some examples of windows that satisfy COLA (taken from [2]_):

        - Rectangular window at overlap of 0, 1/2, 2/3, 3/4, ...
        - Bartlett window at overlap of 1/2, 3/4, 5/6, ...
        - Hann window at 1/2, 2/3, 3/4, ...
        - Any Blackman family window at 2/3 overlap
        - Any window with ``hop=1``

        References
        ----------
        .. [1] Julius O. Smith III, "Spectral Audio Signal Processing",
               online book, 2011, https://www.dsprelated.com/freebooks/sasp/
        .. [2] G. Heinzel, A. Ruediger and R. Schilling, "Spectrum and spectral density
               estimation by the Discrete Fourier transform (DFT), including a
               comprehensive list of window functions and some new at-top windows",
               2002, http://hdl.handle.net/11858/00-001M-0000-0013-557A-5

        Examples
        --------
        Let's show that a Bartlett window with 75% overlap fulfills the COLA condition:

        >>> import matplotlib.pyplot as plt
        >>> import numpy as np
        >>> from scipy.signal import closest_STFT_dual_window, windows
        ...
        >>> m = 24
        >>> win, w_rect = windows.bartlett(m, sym=False), np.ones(m)
        >>> d_win, alpha = closest_STFT_dual_window(win, m//4, w_rect, scaled=True)
        >>> print(f"COLA: {np.allclose(d_win, w_rect*alpha)}, {alpha = :g}")
        COLA: True, alpha = 0.5

        We can also determine for which hop intervals the COLA condition is fulfilled:

        >>> hops, deviations, alphas = np.arange(1, 16, dtype=int), [], []
        >>> for h_ in hops:
        ...     w_cola, alpha = closest_STFT_dual_window(w_rect, h_, win, scaled=True)
        ...     deviations.append(np.linalg.norm(w_cola - win*alpha))
        ...     alphas.append(alpha)
        ...
        >>> fg0, (ax0, ax1) = plt.subplots(2, 1, sharex='all', tight_layout=True)
        >>> ax0.set_title(f"COLA Window closest to a {m}-Sample Bartlett Window")
        >>> ax0.set(ylabel=r"$||w_\text{cola}-\alpha w||$", xlim=(0, hops[-1]-.5))
        >>> ax1.set(xlabel="Hop Interval", ylabel=r"Scaling factor $\alpha$",
        ...         ylim=(0, 1.25))
        >>> ax0.plot(hops, deviations, 'C0.-')
        >>> ax1.plot(hops, alphas, 'C1.-')
        >>> for ax_ in (ax0, ax1):
        ...     ax_.grid()
        >>> plt.show()

        The lower plot shows the calculated scaling factor :math:`\alpha` for different
        `hops` whereas the upper displays the  :math:`L^2`-norm of the difference
        between the scaled Bartlett window and the calculated window. Since for `hops`
        1 to 4 as well as for 6 and 12 the :math:`L^2`-norm of the difference is
        practically zero, the COLA condition is fulfilled for those.

        See Also
        --------
        ShortTimeFFT: Short-time Fourier transform which is able to utilize a dual
                      window for calculating the inverse.
        ShortTimeFFT.from_win_equals_dual: Create instance where the window and its
                                           dual are equal.

    """
    if desired_dual is None:  # default is rectangular window
        desired_dual = np.ones_like(win)
    if not (win.ndim == 1 and win.shape == desired_dual.shape):
        raise ValueError("Parameters `win` and `desired_dual` are not 1d arrays of " +
                         f"equal length ({win.shape=}, {desired_dual.shape=})!")
    if not all(np.isfinite(win)):
        raise ValueError("Parameter win must have finite entries!")
    if not all(np.isfinite(desired_dual)):
        raise ValueError("Parameter desired_dual must have finite entries!")
    if not (1 <= hop <= len(win) and isinstance(hop, int | np.integer)):
        raise ValueError(f"Parameter {hop=} is not an integer between 1 and " +
                         f"{len(win)=}!")

    w_d = _calc_dual_canonical_window(win, hop)
    wdd = win.conjugate() * desired_dual
    q_d = wdd.copy()
    for k_ in range(hop, len(win), hop):
        q_d[k_:] += wdd[:-k_]
        q_d[:-k_] += wdd[k_:]
    q_d = w_d * q_d

    if not scaled:
        return w_d + desired_dual - q_d, 1.

    numerator = q_d.conjugate().T @ w_d
    denominator = q_d.T.real @ q_d.real + q_d.T.imag @ q_d.imag  # always >= 0
    if not (abs(numerator) > 0 and denominator > np.finfo(w_d.dtype).resolution):
        raise ValueError(
            "Unable to calculate scaled closest dual window due to numerically " +
            "unstable scaling factor! Try setting parameter `scaled` to False.")
    alpha = numerator / denominator
    return w_d + alpha * (desired_dual - q_d), alpha


# noinspection PyShadowingNames
class ShortTimeFFT:
    r"""Provide a parametrized discrete Short-time Fourier transform (stft)
    and its inverse (istft).

    .. currentmodule:: scipy.signal.ShortTimeFFT

    The `~ShortTimeFFT.stft` calculates sequential FFTs by sliding a
    window (`win`) over an input signal by `hop` increments. It can be used to
    quantify the change of the spectrum over time.

    The `~ShortTimeFFT.stft` is represented by a complex-valued matrix S[q,p]
    where the p-th column represents an FFT with the window centered at the
    time t[p] = p * `delta_t` = p * `hop` * `T` where `T` is  the sampling
    interval of the input signal. The q-th row represents the values at the
    frequency f[q] = q * `delta_f` with `delta_f` = 1 / (`mfft` * `T`) being
    the bin width of the FFT.

    The inverse STFT `~ShortTimeFFT.istft` is calculated by reversing the steps
    of the STFT: Take the IFFT of the p-th slice of S[q,p] and multiply the
    result with the so-called dual window (see `dual_win`). Shift the result by
    p * `delta_t` and add the result to previous shifted results to reconstruct
    the signal. If only the dual window is known and the STFT is invertible,
    `from_dual` can be used to instantiate this class.

    By default, the so-called canonical dual window is used. It is the window with
    minimal energy among all possible dual windows. `from_win_equals_dual` and
    `~scipy.signal.closest_STFT_dual_window` provide means for utilizing alterantive
    dual windows. Note that `win` is also always a dual window of `dual_win`.

    Due to the convention of time t = 0 being at the first sample of the input
    signal, the STFT values typically have negative time slots. Hence,
    negative indexes like `p_min` or `k_min` do not indicate counting
    backwards from an array's end like in standard Python indexing but being
    left of t = 0.

    More detailed information can be found in the :ref:`tutorial_stft`
    section of the :ref:`user_guide`.

    Note that all parameters of the initializer, except `scale_to` (which uses
    `scaling`) have identical named attributes.

    Parameters
    ----------
    win : np.ndarray
        The window must be a real- or complex-valued 1d array.
    hop : int
        The increment in samples, by which the window is shifted in each step.
    fs : float
        Sampling frequency of input signal and window. Its relation to the
        sampling interval `T` is ``T = 1 / fs``.
    fft_mode : 'twosided', 'centered', 'onesided', 'onesided2X'
        Mode of FFT to be used (default 'onesided').
        See property `fft_mode` for details.
    mfft: int | None
        Length of the FFT used, if a zero padded FFT is desired.
        If ``None`` (default), the length of the window `win` is used.
    dual_win : np.ndarray | None
        The dual window of `win`. If set to ``None``, it is calculated if
        needed.
    scale_to : 'magnitude', 'psd' | None
        If not ``None`` (default) the window function is scaled, so each STFT
        column represents either a 'magnitude' or a power spectral density
        ('psd') spectrum. This parameter sets the property `scaling` to the
        same value. See method `scale_to` for details.
    phase_shift : int | None
        If set, add a linear phase `phase_shift` / `mfft` * `f` to each
        frequency `f`. The default value of 0 ensures that there is no phase shift
        on the zeroth slice (in which t=0 is centered). See property
        `phase_shift` for more details.

    Notes
    -----
    A typical STFT application is the creation of various types of time-frequency
    plots, often subsumed under the term "spectrogram". Note that this term is also
    used to explecitly refer to the absolute square of a STFT [11]_, as done in
    :meth:`spectrogram`.

    The STFT can also be used for filtering and filter banks as discussed in [12]_.


    References
    ----------
    .. [11] Karlheinz Gröchenig: "Foundations of Time-Frequency Analysis",
           Birkhäuser Boston 2001, `10.1007/978-1-4612-0003-1`
    .. [12] Julius O. Smith III, "Spectral Audio Signal Processing", online book, 2011,
           https://www.dsprelated.com/freebooks/sasp/


    Examples
    --------
    The following example shows the magnitude of the STFT of a sine with
    varying frequency :math:`f_i(t)` (marked by a red dashed line in the plot):

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy.signal import ShortTimeFFT
    >>> from scipy.signal.windows import gaussian
    ...
    >>> T_x, N = 1 / 20, 1000  # 20 Hz sampling rate for 50 s signal
    >>> t_x = np.arange(N) * T_x  # time indexes for signal
    >>> f_i = 1 * np.arctan((t_x - t_x[N // 2]) / 2) + 5  # varying frequency
    >>> x = np.sin(2*np.pi*np.cumsum(f_i)*T_x) # the signal

    The utilized Gaussian window is 50 samples or 2.5 s long. The parameter
    ``mfft=200`` in `ShortTimeFFT` causes the spectrum to be oversampled
    by a factor of 4:

    >>> g_std = 8  # standard deviation for Gaussian window in samples
    >>> w = gaussian(50, std=g_std, sym=True)  # symmetric Gaussian window
    >>> SFT = ShortTimeFFT(w, hop=10, fs=1/T_x, mfft=200, scale_to='magnitude')
    >>> Sx = SFT.stft(x)  # perform the STFT

    In the plot, the time extent of the signal `x` is marked by vertical dashed
    lines. Note that the SFT produces values outside the time range of `x`. The
    shaded areas on the left and the right indicate border effects caused
    by the window slices in that area not fully being inside time range of
    `x`:

    >>> fig1, ax1 = plt.subplots(figsize=(6., 4.))  # enlarge plot a bit
    >>> t_lo, t_hi = SFT.extent(N)[:2]  # time range of plot
    >>> ax1.set_title(rf"STFT ({SFT.m_num*SFT.T:g}$\,s$ Gaussian window, " +
    ...               rf"$\sigma_t={g_std*SFT.T}\,$s)")
    >>> ax1.set(xlabel=f"Time $t$ in seconds ({SFT.p_num(N)} slices, " +
    ...                rf"$\Delta t = {SFT.delta_t:g}\,$s)",
    ...         ylabel=f"Freq. $f$ in Hz ({SFT.f_pts} bins, " +
    ...                rf"$\Delta f = {SFT.delta_f:g}\,$Hz)",
    ...         xlim=(t_lo, t_hi))
    ...
    >>> im1 = ax1.imshow(abs(Sx), origin='lower', aspect='auto',
    ...                  extent=SFT.extent(N), cmap='viridis')
    >>> ax1.plot(t_x, f_i, 'r--', alpha=.5, label='$f_i(t)$')
    >>> fig1.colorbar(im1, label="Magnitude $|S_x(t, f)|$")
    ...
    >>> # Shade areas where window slices stick out to the side:
    >>> for t0_, t1_ in [(t_lo, SFT.lower_border_end[0] * SFT.T),
    ...                  (SFT.upper_border_begin(N)[0] * SFT.T, t_hi)]:
    ...     ax1.axvspan(t0_, t1_, color='w', linewidth=0, alpha=.2)
    >>> for t_ in [0, N * SFT.T]:  # mark signal borders with vertical line:
    ...     ax1.axvline(t_, color='y', linestyle='--', alpha=0.5)
    >>> ax1.legend()
    >>> fig1.tight_layout()
    >>> plt.show()

    Reconstructing the signal with the `~ShortTimeFFT.istft` is
    straightforward, but note that the length of `x1` should be specified,
    since the STFT length increases in `hop` steps:

    >>> SFT.invertible  # check if invertible
    True
    >>> x1 = SFT.istft(Sx, k1=N)
    >>> np.allclose(x, x1)
    True

    It is possible to calculate the STFT of signal parts:

    >>> N2 = SFT.nearest_k_p(N // 2)
    >>> Sx0 = SFT.stft(x[:N2])
    >>> Sx1 = SFT.stft(x[N2:])

    When assembling sequential STFT parts together, the overlap needs to be
    considered:

    >>> p0_ub = SFT.upper_border_begin(N2)[1] - SFT.p_min
    >>> p1_le = SFT.lower_border_end[1] - SFT.p_min
    >>> Sx01 = np.hstack((Sx0[:, :p0_ub],
    ...                   Sx0[:, p0_ub:] + Sx1[:, :p1_le],
    ...                   Sx1[:, p1_le:]))
    >>> np.allclose(Sx01, Sx)  # Compare with SFT of complete signal
    True

    It is also possible to calculate the `itsft` for signal parts:

    >>> y_p = SFT.istft(Sx, N//3, N//2)
    >>> np.allclose(y_p, x[N//3:N//2])
    True

    """
    # immutable attributes (only have getters but no setters):
    _win: np.ndarray  # window
    _dual_win: np.ndarray | None = None  # canonical dual window
    _hop: int  # Step of STFT in number of samples

    # mutable attributes:
    _fs: float  # sampling frequency of input signal and window
    _fft_mode: FFT_MODE_TYPE = 'onesided'  # Mode of FFT to use
    _mfft: int  # length of FFT used - defaults to len(win)
    _scaling: Literal['magnitude', 'psd', 'unitary'] | None = None  # Scaling of _win
    _phase_shift: int | None  # amount to shift phase of FFT in samples

    # attributes for caching calculated values:
    _fac_mag: float | None = None
    _fac_psd: float | None = None
    _lower_border_end: tuple[int, int] | None = None

    def __init__(self, win: np.ndarray, hop: int, fs: float, *,
                 fft_mode: FFT_MODE_TYPE = 'onesided',
                 mfft: int | None = None,
                 dual_win: np.ndarray | None = None,
                 scale_to: Literal['magnitude', 'psd'] | None = None,
                 phase_shift: int | None = 0):
        if not (win.ndim == 1 and win.size > 0):
            raise ValueError(f"Parameter win must be 1d, but {win.shape=}!")
        if not all(np.isfinite(win)):
            raise ValueError("Parameter win must have finite entries!")
        if not (hop >= 1 and isinstance(hop, int | np.integer)):
            raise ValueError(f"Parameter {hop=} is not an integer >= 1!")

        self._win, self._hop, self.fs = win, hop, fs
        self.win.setflags(write=False)
        self.mfft = len(win) if mfft is None else mfft

        if dual_win is not None:
            if dual_win.shape != win.shape:
                raise ValueError(f"{dual_win.shape=} must equal {win.shape=}!")
            if not all(np.isfinite(dual_win)):
                raise ValueError("Parameter dual_win must be a finite array!")
            dual_win.setflags(write=False)
        self._dual_win = dual_win  # needs to be set before scaling

        if scale_to is not None:  # needs to be set before fft_mode
            self.scale_to(scale_to)

        self.fft_mode, self.phase_shift = fft_mode, phase_shift

    @classmethod
    def from_dual(cls, dual_win: np.ndarray, hop: int, fs: float, *,
                  fft_mode: FFT_MODE_TYPE = 'onesided',
                  mfft: int | None = None,
                  scale_to: Literal['magnitude', 'psd'] | None = None,
                  phase_shift: int | None = 0):
        r"""Instantiate a `ShortTimeFFT` by only providing a dual window.

        If an STFT is invertible, it is possible to calculate the window `win`
        from a given dual window `dual_win`. All other parameters have the
        same meaning as in the initializer of `ShortTimeFFT`.

        As explained in the :ref:`tutorial_stft` section of the
        :ref:`user_guide`, an invertible STFT can be interpreted as series
        expansion of time-shifted and frequency modulated dual windows. E.g.,
        the series coefficient S[q,p] belongs to the term, which shifted
        `dual_win` by p * `delta_t` and multiplied it by
        exp( 2 * j * pi * t * q * `delta_f`).


        Examples
        --------
        The following example discusses decomposing a signal into time- and
        frequency-shifted Gaussians. A Gaussian with standard deviation of
        one made up of 51 samples will be used:

        >>> import numpy as np
        >>> import matplotlib.pyplot as plt
        >>> from scipy.signal import ShortTimeFFT
        >>> from scipy.signal.windows import gaussian
        ...
        >>> T, N = 0.1, 51
        >>> d_win = gaussian(N, std=1/T, sym=True)  # symmetric Gaussian window
        >>> t = T * (np.arange(N) - N//2)
        ...
        >>> fg1, ax1 = plt.subplots()
        >>> ax1.set_title(r"Dual Window: Gaussian with $\sigma_t=1$")
        >>> ax1.set(xlabel=f"Time $t$ in seconds ({N} samples, $T={T}$ s)",
        ...        xlim=(t[0], t[-1]), ylim=(0, 1.1*np.max(d_win)))
        >>> ax1.plot(t, d_win, 'C0-')

        The following plot with the overlap of 41, 11 and 2 samples show how
        the `hop` interval affects the shape of the window `win`:

        >>> fig2, axx = plt.subplots(3, 1, sharex='all')
        ...
        >>> axx[0].set_title(r"Windows for hop$\in\{10, 40, 49\}$")
        >>> for c_, h_ in enumerate([10, 40, 49]):
        ...     SFT = ShortTimeFFT.from_dual(d_win, h_, 1/T)
        ...     axx[c_].plot(t + h_ * T, SFT.win, 'k--', alpha=.3, label=None)
        ...     axx[c_].plot(t - h_ * T, SFT.win, 'k:', alpha=.3, label=None)
        ...     axx[c_].plot(t, SFT.win, f'C{c_+1}',
        ...                     label=r"$\Delta t=%0.1f\,$s" % SFT.delta_t)
        ...     axx[c_].set_ylim(0, 1.1*max(SFT.win))
        ...     axx[c_].legend(loc='center')
        >>> axx[-1].set(xlabel=f"Time $t$ in seconds ({N} samples, $T={T}$ s)",
        ...             xlim=(t[0], t[-1]))
        >>> plt.show()

        Beside the window `win` centered at t = 0 the previous (t = -`delta_t`)
        and following window (t = `delta_t`) are depicted. It can be seen that
        for small `hop` intervals, the window is compact and smooth, having a
        good time-frequency concentration in the STFT. For the large `hop`
        interval of 4.9 s, the window has small values around t = 0, which are
        not covered by the overlap of the adjacent windows, which could lead to
        numeric inaccuracies. Furthermore, the peaky shape at the beginning and
        the end of the window points to a higher bandwidth, resulting in a
        poorer time-frequency resolution of the STFT.
        Hence, the choice of the `hop` interval will be a compromise between
        a time-frequency resolution and memory requirements demanded by small
        `hop` sizes.

        See Also
        --------
        from_window: Create instance by wrapping `get_window`.
        ShortTimeFFT: Create instance using standard initializer.
        """
        win = _calc_dual_canonical_window(dual_win, hop)
        return cls(win=win, hop=hop, fs=fs, fft_mode=fft_mode, mfft=mfft,
                   dual_win=dual_win, scale_to=scale_to,
                   phase_shift=phase_shift)

    @classmethod
    def from_window(cls, win_param: str | tuple | float,
                    fs: float, nperseg: int, noverlap: int, *,
                    symmetric_win: bool = False,
                    fft_mode: FFT_MODE_TYPE = 'onesided',
                    mfft: int | None = None,
                    scale_to: Literal['magnitude', 'psd'] | None = None,
                    phase_shift: int | None = 0):
        """Instantiate `ShortTimeFFT` by using `get_window`.

        The method `get_window` is used to create a window of length
        `nperseg`. The parameter names `noverlap`, and `nperseg` are used here,
        since they more inline with other classical STFT libraries.

        Parameters
        ----------
        win_param: Union[str, tuple, float],
            Parameters passed to `get_window`. For windows with no parameters,
            it may be a string (e.g., ``'hann'``), for parametrized windows a
            tuple, (e.g., ``('gaussian', 2.)``) or a single float specifying
            the shape parameter of a kaiser window (i.e. ``4.``  and
            ``('kaiser', 4.)`` are equal. See `get_window` for more details.
        fs : float
            Sampling frequency of input signal. Its relation to the
            sampling interval `T` is ``T = 1 / fs``.
        nperseg: int
            Window length in samples, which corresponds to the `m_num`.
        noverlap: int
            Window overlap in samples. It relates to the `hop` increment by
            ``hop = npsereg - noverlap``.
        symmetric_win: bool
            If ``True`` then a symmetric window is generated, else a periodic
            window is generated (default). Though symmetric windows seem for
            most applications to be more sensible, the default of a periodic
            windows was chosen to correspond to the default of `get_window`.
        fft_mode : 'twosided', 'centered', 'onesided', 'onesided2X'
            Mode of FFT to be used (default 'onesided').
            See property `fft_mode` for details.
        mfft: int | None
            Length of the FFT used, if a zero padded FFT is desired.
            If ``None`` (default), the length of the window `win` is used.
        scale_to : 'magnitude', 'psd' | None
            If not ``None`` (default) the window function is scaled, so each
            STFT column represents  either a 'magnitude' or a power spectral
            density ('psd') spectrum. This parameter sets the property
            `scaling` to the same value. See method `scale_to` for details.
        phase_shift : int | None
            If set, add a linear phase `phase_shift` / `mfft` * `f` to each
            frequency `f`. The default value 0 ensures that there is no phase
            shift on the zeroth slice (in which t=0 is centered). See property
            `phase_shift` for more details.

        Examples
        --------
        The following instances ``SFT0`` and ``SFT1`` are equivalent:

        >>> from scipy.signal import ShortTimeFFT, get_window
        >>> nperseg = 9  # window length
        >>> w = get_window(('gaussian', 2.), nperseg)
        >>> fs = 128  # sampling frequency
        >>> hop = 3  # increment of STFT time slice
        >>> SFT0 = ShortTimeFFT(w, hop, fs=fs)
        >>> SFT1 = ShortTimeFFT.from_window(('gaussian', 2.), fs, nperseg,
        ...                                 noverlap=nperseg-hop)

        See Also
        --------
        scipy.signal.get_window: Return a window of a given length and type.
        from_dual: Create instance using dual window.
        ShortTimeFFT: Create instance using standard initializer.
        """
        win = get_window(win_param, nperseg, fftbins=not symmetric_win)
        return cls(win, hop=nperseg-noverlap, fs=fs, fft_mode=fft_mode,
                   mfft=mfft, scale_to=scale_to, phase_shift=phase_shift)

    @classmethod
    def from_win_equals_dual(
            cls, desired_win: np.ndarray, hop: int, fs: float, *,
            fft_mode: FFT_MODE_TYPE = 'onesided', mfft: int | None = None,
            scale_to: Literal['magnitude', 'psd', 'unitary'] | None = None,
            phase_shift: int | None = 0):
        r"""Create instance where the window and its dual are equal up to a
        scaling factor.

        An instance is created were window and dual window are equal as well as being
        closest to the parameter `desired_win` in the least-squares sense, i.e.,
        minimizing ``abs(win-desired_win)**2``. Hence, `win` has the same length as
        `desired_win`. Then a scaling factor is applied accoring to the `scale_to`
        parameter.

        All other parameters have the identical meaning as in the initializer.

        To be able to calculate a valid window, `desired_win` needs to have a valid
        dual STFT window for the given `hop` interval.
        If this is not the case, a ``ValueError`` is raised.

        Parameters
        ----------
        desired_win : np.ndarray
            A real-valued or complex-valued 1d array containing the sample of the
            desired window.
        hop : int
            The increment in samples, by which the window is shifted in each step.
        fs : float
            Sampling frequency of input signal and window. Its relation to the
            sampling interval `T` is ``T = 1 / fs``.
        fft_mode : 'twosided', 'centered', 'onesided', 'onesided2X'
            Mode of FFT to be used (default 'onesided').
            See property `fft_mode` for details.
        mfft: int | None
            Length of the FFT used, if a zero padded FFT is desired.
            If ``None`` (default), the length of the window `win` is used.
        scale_to : 'magnitude' | 'psd' | 'unitary' | None
            If not ``None`` (default) the window function is scaled, so each STFT
            column represents either a 'magnitude' or a power spectral density ('psd')
            spectrum, Alternatively, the STFT can be scaled to a`unitary` mapping,
            i.e., dividing the window by ``np.sqrt(mfft)`` and multiplying the dual
            window by the same amount.
        phase_shift : int | None
            If set, add a linear phase `phase_shift` / `mfft` * `f` to each
            frequency `f`. The default value of 0 ensures that there is no phase shift
            on the zeroth slice (in which t=0 is centered). See property
            `phase_shift` for more details.


        Notes
        -----
        The set of all possible windows with identical dual is defined by the set of
        linear constraints of Eq. :math:numref:`eq_STFT_AllDualWinsCond` in the
        :ref:`tutorial_stft` section of the :ref:`user_guide`. There it is also
        derived that ``ShortTimeFFT.dual_win == ShortTimeFFT.m_pts * ShortTimeFFT.win``
        needs to hold for an STFT to be a unitary mapping.

        A unitary mapping preserves the value of the scalar product, i.e.,

        .. math::

            \langle x, y\rangle = \sum_k x[k]\, \overline{y[k]}
            \stackrel{\stackrel{\text{unitary}}{\downarrow}}{=}
            \sum_{q,p} S_x[q,p]\, \overline{S_y[q,p]}
            = \langle S_x[q,p], S_y[q,p]\rangle\ ,

        with :math:`S_{x,y}` being the STFT of :math:`x,y`. Hence, the energy
        :math:`E_x=T\sum_k |x[k]|^2` of a signal is also preserved. This is also
        illustrated in the example below.

        Thie reason of distinguishing between no scaling (i.e., parameter `scale_to` is
        ``None``) and unitary scaling (i.e., ``scale_to = 'unitary'``) is due to the
        utilized FFT function not being unitary (i.e., using the default value
        ``'backward'`` for the `~scipy.fft.fft` parameter `norm`).


        See Also
        --------
        closest_STFT_dual_window: Calculate the STFT dual window of a given window
                                  closest to a desired dual window.
        ShortTimeFFT.spectrogram: Calculate squared STFTs
        ShortTimeFFT: Class this property belongs to.

        Examples
        --------
        The following example shows that an STFT can be indeed unitary:

        >>> import matplotlib.pyplot as plt
        >>> import numpy as np
        >>> from scipy.signal import ShortTimeFFT, windows
        ...
        >>> m, hop, std = 36, 8, 5
        >>> desired_win = windows.gaussian(m, std, sym=True)
        >>> SFT = ShortTimeFFT.from_win_equals_dual(desired_win, hop, fs=1/m,
        ...                                         fft_mode='twosided',
        ...                                         scale_to='unitary')
        >>> np.allclose(SFT.dual_win, SFT.win * SFT.m_num)  # check if STFT is unitary
        True
        >>> x1, x2 = np.tile([-1, -1, 1, 1], 5), np.tile([1, -1, -1, 1], 5)
        >>> np.sum(x1*x2) # scalar product is zero -> orthogonal signals
        0
        >>> np.sum(x1**2)  # scalar product of x1 with itself
        20
        >>> Sx11, Sx12 = SFT.spectrogram(x1), SFT.spectrogram(x1, x2)
        >>> np.sum(Sx12)  # STFT scalar product is also zero
        -4.163336342344337e-16+0j  # may vary
        >>> np.sum(Sx11)  # == np.sum(x1**2)
        19.999999999999996  # may vary
        ...
        ... # Do the plotting:
        >>> fg1, (ax11, ax12) = plt.subplots(1, 2, tight_layout=True, figsize=(8, 4))
        >>> s_fac = np.sqrt(SFT.mfft)
        >>> _ = fg1.suptitle(f"Scaled Unitary Window of {m} Sample Gaussian with " +
        ...                  rf"{hop=}, $\sigma={std}$, Scale factor: {s_fac}")
        >>> ax11.set(ylabel="Amplitude", xlabel="Samples", xlim=(0, m))
        >>> ax12.set(xlabel="Frequency Bins", ylabel="Magnitude Spectrum",
        ...          xlim=(0, 15), ylim=(1e-5, 1.5))
        >>> u_win_str = rf"Unitary $\times{s_fac:g}$"
        >>> for x_, n_ in zip((desired_win, SFT.win*s_fac), ('Desired', u_win_str)):
        ...     ax11.plot(x_, '.-', alpha=0.5, label=n_)
        ...     X_ = np.fft.rfft(x_) / np.sum(abs(x_))
        ...     ax12.semilogy(abs(X_), '.-', alpha=0.5, label=n_)
        >>> for ax_ in (ax11, ax12):
        ...     ax_.grid(True)
        ...     ax_.legend()
        >>> plt.show()

        Note that ``fftmode='twosided'`` is used, since we need sum over the complete
        time frequency plane. Due to passing ``scale_to='unitary'`` the window
        ``SFT.win`` is scaled by ``1/np.sqrt(SFT.mfft)``. Hence, ``SFT.win`` needs to
        be scaled by `s_fac` in the plot above.
        """
        if not (desired_win.ndim == 1 and desired_win.size > 0):
            raise ValueError(f"Parameter desired_win is not 1d, but "
                             f"{desired_win.shape=}!")
        if issubclass(desired_win.dtype.type, np.integer):
            raise ValueError("Parameter desired_win cannot be of integer type, " +
                             f"but {desired_win.dtype=} => cast to float | complex ")
        if not all(np.isfinite(desired_win)):
            raise ValueError("Parameter desired_win must have finite entries!")
        if not (1 <= hop <= len(desired_win) and isinstance(hop, int | np.integer)):
            raise ValueError(f"Parameter {hop=} is not an integer between 1 and " +
                             f"{len(desired_win)=}!")
        if scale_to not in ['magnitude', 'psd', 'unitary', None]:
            raise ValueError(f"Parameter {scale_to=} not in " +
                             "['magnitude', 'psd', 'unitary', None]!")

        mfft = len(desired_win) if mfft is None else mfft
        s_fac = np.sqrt(mfft) if scale_to == 'unitary' else 1

        win = desired_win.copy()  # we do not want to modify input parameters
        relative_resolution = np.finfo(win.dtype).resolution * max(win)
        for m in range(hop):
            a = np.linalg.norm(desired_win[m::hop])
            if not (a > relative_resolution):
                raise ValueError("Parameter desired_win does not have valid STFT dual "
                                 f"window for {hop=}!")
            win[m::hop] /= a

        SFT = cls(win=win/s_fac, hop=hop, fs=fs, fft_mode=fft_mode, mfft=mfft,
                  dual_win=win*s_fac, phase_shift=phase_shift,
                  scale_to=None if scale_to=='unitary' else scale_to)

        if scale_to == 'unitary':
            SFT._scaling = scale_to
        return SFT


    @property
    def win(self) -> np.ndarray:
        """Window function as real- or complex-valued 1d array.

        This attribute is read-only, since `dual_win` depends on it.
        To make this array immutable, its WRITEABLE flag is set to ``FALSE``.

        See Also
        --------
        dual_win: Dual window.
        m_num: Number of samples in window `win`.
        m_num_mid: Center index of window `win`.
        mfft: Length of input for the FFT used - may be larger than `m_num`.
        hop: ime increment in signal samples for sliding window.
        win: Window function as real- or complex-valued 1d array.
        numpy.ndarray.setflags: Modify array flags.
        ShortTimeFFT: Class this property belongs to.
        """
        return self._win

    @property
    def hop(self) -> int:
        """Time increment in signal samples for sliding window.

        This attribute is read only, since `dual_win` depends on it.

        See Also
        --------
        delta_t: Time increment of STFT (``hop*T``)
        m_num: Number of samples in window `win`.
        m_num_mid: Center index of window `win`.
        mfft: Length of input for the FFT used - may be larger than `m_num`.
        T: Sampling interval of input signal and of the window.
        win: Window function as real- or complex-valued 1d array.
        ShortTimeFFT: Class this property belongs to.
        """
        return self._hop

    @property
    def T(self) -> float:
        """Sampling interval of input signal and of the window.

        A ``ValueError`` is raised if it is set to a non-positive value.

        See Also
        --------
        delta_t: Time increment of STFT (``hop*T``)
        hop: Time increment in signal samples for sliding window.
        fs: Sampling frequency (being ``1/T``)
        t: Times of STFT for an input signal with `n` samples.
        ShortTimeFFT: Class this property belongs to.
        """
        return 1 / self._fs

    @T.setter
    def T(self, v: float):
        """Sampling interval of input signal and of the window.

        A ``ValueError`` is raised if it is set to a non-positive value.
        """
        if not (v > 0):
            raise ValueError(f"Sampling interval T={v} must be positive!")
        self._fs = 1 / v

    @property
    def fs(self) -> float:
        """Sampling frequency of input signal and of the window.

        The sampling frequency is the inverse of the sampling interval `T`.
        A ``ValueError`` is raised if it is set to a non-positive value.

        See Also
        --------
        delta_t: Time increment of STFT (``hop*T``)
        hop: Time increment in signal samples for sliding window.
        T: Sampling interval of input signal and of the window (``1/fs``).
        ShortTimeFFT: Class this property belongs to.
        """
        return self._fs

    @fs.setter
    def fs(self, v: float):
        """Sampling frequency of input signal and of the window.

        The sampling frequency is the inverse of the sampling interval `T`.
        A ``ValueError`` is raised if it is set to a non-positive value.
        """
        if not (v > 0):
            raise ValueError(f"Sampling frequency fs={v} must be positive!")
        self._fs = v

    @property
    def fft_mode(self) -> FFT_MODE_TYPE:
        """Mode of utilized FFT ('twosided', 'centered', 'onesided' or
        'onesided2X').

        It can have the following values:

        'twosided':
            Two-sided FFT, where values for the negative frequencies are in
            upper half of the array. Corresponds to :func:`~scipy.fft.fft()`.
        'centered':
            Two-sided FFT with the values being ordered along monotonically
            increasing frequencies. Corresponds to applying
            :func:`~scipy.fft.fftshift()` to :func:`~scipy.fft.fft()`.
        'onesided':
            Calculates only values for non-negative frequency values.
            Corresponds to :func:`~scipy.fft.rfft()`.
        'onesided2X':
            Like `onesided`, but the non-zero frequencies are doubled if
            `scaling` is set to 'magnitude' or multiplied by ``sqrt(2)`` if
            set to 'psd'. If `scaling` is ``None``, setting `fft_mode` to
            `onesided2X` is not allowed.
            If the FFT length `mfft` is even, the last FFT value is not paired,
            and thus it is not scaled.

        Note that `onesided` and `onesided2X` do not work for complex-valued signals or
        complex-valued windows. Furthermore, the frequency values can be obtained by
        reading the `f` property, and the number of samples by accessing the `f_pts`
        property.

        See Also
        --------
        delta_f: Width of the frequency bins of the STFT.
        f: Frequencies values of the STFT.
        f_pts: Width of the frequency bins of the STFT.
        onesided_fft: True if a one-sided FFT is used.
        scaling: Normalization applied to the window function
        ShortTimeFFT: Class this property belongs to.
        """
        return self._fft_mode

    @fft_mode.setter
    def fft_mode(self, t: FFT_MODE_TYPE):
        """Set mode of FFT.

        Allowed values are 'twosided', 'centered', 'onesided', 'onesided2X'.
        See the property `fft_mode` for more details.
        """
        if t not in (fft_mode_types := get_args(FFT_MODE_TYPE)):
            raise ValueError(f"fft_mode='{t}' not in {fft_mode_types}!")

        if t in {'onesided', 'onesided2X'} and np.iscomplexobj(self.win):
            raise ValueError(f"One-sided spectra, i.e., fft_mode='{t}', " +
                             "are not allowed for complex-valued windows!")

        if t == 'onesided2X' and self.scaling is None:
            raise ValueError(f"For scaling is None, fft_mode='{t}' is invalid!"
                             "Do scale_to('psd') or scale_to('magnitude')!")
        self._fft_mode = t

    @property
    def mfft(self) -> int:
        """Length of input for the FFT used - may be larger than window
        length `m_num`.

        If not set, `mfft` defaults to the window length `m_num`.

        See Also
        --------
        f_pts: Number of points along the frequency axis.
        f: Frequencies values of the STFT.
        m_num: Number of samples in window `win`.
        ShortTimeFFT: Class this property belongs to.
        """
        return self._mfft

    @mfft.setter
    def mfft(self, n_: int):
        """Setter for the length of FFT utilized.

        See the property `mfft` for further details.
        """
        if not (n_ >= self.m_num):
            raise ValueError(f"Attribute mfft={n_} needs to be at least the " +
                             f"window length m_num={self.m_num}!")
        self._mfft = n_

    @property
    def scaling(self) -> Literal['magnitude', 'psd', 'unitary'] | None:
        """Normalization applied to the window function
        ('magnitude', 'psd', 'unitary', or ``None``).

        If not ``None``, the FFT slices may be either interpreted as a `magnitude` or
        a power spectral density spectrum (`psd`). If set to `unitary`, the STFT may be
        interpreted as a unitary mapping, i.e., preserving the value of the scalar
        product.

        The window function can be scaled by calling the `scale_to` method,
        or it is set by the initializer parameter ``scale_to``. Note that a
        window cannot to be scaled to be `unitary`.  Use `from_win_equals_dual`
        to create a unitary `ShortTimeFFT` instance.

        See Also
        --------
        fac_magnitude: Scaling factor for to a magnitude spectrum.
        fac_psd: Scaling factor for to  a power spectral density spectrum.
        fft_mode: Mode of utilized FFT
        scale_to: Scale window to obtain 'magnitude' or 'psd' scaling.
        from_win_equals_dual: Class-method for creating a unitary instance.
        ShortTimeFFT: Class this property belongs to.
        """
        return self._scaling

    def scale_to(self, scaling: Literal['magnitude', 'psd']):
        """Scale window to obtain 'magnitude' or 'psd' scaling for the STFT.

        The window of a 'magnitude' spectrum has an integral of one, i.e., unit
        area for non-negative windows. This ensures that absolute the values of
        spectrum does not change if the length of the window changes (given
        the input signal is stationary).

        To represent the power spectral density ('psd') for varying length
        windows the area of the absolute square of the window needs to be
        unity.

        The `scaling` property shows the current scaling. The properties
        `fac_magnitude` and `fac_psd` show the scaling factors required to
        scale the STFT values to a magnitude or a psd spectrum.

        Note that a window cannot to be scaled to be `unitary`. Use
        `from_win_equals_dual` to create a unitary `ShortTimeFFT` instance.

        This method is called, if the initializer parameter `scale_to` is set.

        See Also
        --------
        fac_magnitude: Scaling factor for to  a magnitude spectrum.
        fac_psd: Scaling factor for to  a power spectral density spectrum.
        fft_mode: Mode of utilized FFT
        scaling: Normalization applied to the window function.
        ShortTimeFFT: Class this method belongs to.
        """
        if scaling not in (scaling_values := {'magnitude', 'psd'}):
            raise ValueError(f"{scaling=} not in {scaling_values}!")
        if self._scaling == scaling:  # do nothing
            return

        s_fac = self.fac_psd if scaling == 'psd' else self.fac_magnitude
        self._win = self._win * s_fac
        self.win.setflags(write=False)
        if self._dual_win is not None:
            self._dual_win = self._dual_win / s_fac
            self.dual_win.setflags(write=False)
        self._fac_mag, self._fac_psd = None, None  # reset scaling factors
        self._scaling = scaling

    @property
    def phase_shift(self) -> int | None:
        """If set, add linear phase `phase_shift` / `mfft` * `f` to each FFT
        slice of frequency `f`.

        Shifting (more precisely `rolling`) an `mfft`-point FFT input by
        `phase_shift` samples results in a multiplication of the output by
        ``np.exp(2j*np.pi*q*phase_shift/mfft)`` at the frequency q * `delta_f`.

        The default value 0 ensures that there is no phase shift on the
        zeroth slice (in which t=0 is centered).
        No phase shift (``phase_shift is None``) is equivalent to
        ``phase_shift = -mfft//2``. In this case slices are not shifted
        before calculating the FFT.

        The absolute value of `phase_shift` is limited to be less than `mfft`.

        See Also
        --------
        delta_f: Width of the frequency bins of the STFT.
        f: Frequencies values of the STFT.
        mfft: Length of input for the FFT used
        ShortTimeFFT: Class this property belongs to.
        """
        return self._phase_shift

    @phase_shift.setter
    def phase_shift(self, v: int | None):
        """The absolute value of the phase shift needs to be less than mfft
        samples.

        See the `phase_shift` getter method for more details.
        """
        if v is None:
            self._phase_shift = v
            return
        if not isinstance(v, int | np.integer):
            raise ValueError(f"phase_shift={v} has the unit samples. Hence " +
                             "it needs to be an int or it may be None!")
        if not (-self.mfft < v < self.mfft):
            raise ValueError("-mfft < phase_shift < mfft does not hold " +
                             f"for mfft={self.mfft}, phase_shift={v}!")
        self._phase_shift = v

    def _x_slices(self, x: np.ndarray, k_off: int, p0: int, p1: int,
                  padding: PAD_TYPE) -> Generator[np.ndarray, None, None]:
        """Generate signal slices along last axis of `x`.

        This method is only used by `stft_detrend`. The parameters are
        described in `~ShortTimeFFT.stft`.
        """
        if padding not in (padding_types := get_args(PAD_TYPE)):
            raise ValueError(f"Parameter {padding=} not in {padding_types}!")
        pad_kws: dict[str, dict] = {  # possible keywords to pass to np.pad:
            'zeros': dict(mode='constant', constant_values=(0, 0)),
            'edge': dict(mode='edge'),
            'even': dict(mode='reflect', reflect_type='even'),
            'odd': dict(mode='reflect', reflect_type='odd'),
           }  # typing of pad_kws is needed to make mypy happy

        n, n1 = x.shape[-1], (p1 - p0) * self.hop
        k0 = p0 * self.hop - self.m_num_mid + k_off  # start sample
        k1 = k0 + n1 + self.m_num  # end sample

        i0, i1 = max(k0, 0), min(k1, n)  # indexes to shorten x
        # dimensions for padding x:
        pad_width = [(0, 0)] * (x.ndim-1) + [(-min(k0, 0), max(k1 - n, 0))]

        x1 = np.pad(x[..., i0:i1], pad_width, **pad_kws[padding])
        for k_ in range(0, n1, self.hop):
            yield x1[..., k_:k_ + self.m_num]

    def stft(self, x: np.ndarray, p0: int | None = None,
             p1: int | None = None, *, k_offset: int = 0,
             padding: PAD_TYPE = 'zeros', axis: int = -1) \
            -> np.ndarray:
        """Perform the short-time Fourier transform.

        A two-dimensional matrix with ``p1-p0`` columns is calculated.
        The `f_pts` rows represent value at the frequencies `f`. The q-th
        column of the windowed FFT with the window `win` is centered at t[q].
        The columns represent the values at the frequencies `f`.

        Parameters
        ----------
        x : np.ndarray
            The input signal as real or complex valued array. For complex values, the
            property `fft_mode` must be set to 'twosided' or 'centered'.
        p0 : int | None
            The first element of the range of slices to calculate. If ``None``
            then it is set to :attr:`p_min`, which is the smallest possible
            slice.
        p1 : int | None
            The end of the array. If ``None`` then `p_max(n)` is used.
        k_offset : int
            Index of first sample (t = 0) in `x`.
        padding : 'zeros' | 'edge' | 'even' | 'odd'
            Kind of values which are added, when the sliding window sticks out
            on either the lower or upper end of the input `x`. Zeros are added
            if the default 'zeros' is set. For 'edge' either the first or the
            last value of `x` is used. 'even' pads by reflecting the
            signal on the first or last sample and 'odd' additionally
            multiplies it with -1.
        axis : int
            The axis of `x` over which to compute the STFT.
            If not given, the last axis is used.

        Returns
        -------
        S : np.ndarray
            A complex array is returned with the dimension always being larger
            by one than of `x`. The last axis always represents the time slices
            of the STFT. `axis` defines the frequency axis (default second to
            last). E.g., for a one-dimensional `x`, a complex 2d array is
            returned, with axis 0 representing frequency and axis 1 the time
            slices.

        See Also
        --------
        delta_f: Width of the frequency bins of the STFT.
        delta_t: Time increment of STFT
        f: Frequencies values of the STFT.
        invertible: Check if STFT is invertible.
        :meth:`~ShortTimeFFT.istft`: Inverse short-time Fourier transform.
        p_range: Determine and validate slice index range.
        stft_detrend: STFT with detrended segments.
        t: Times of STFT for an input signal with `n` samples.
        :class:`scipy.signal.ShortTimeFFT`: Class this method belongs to.
        """
        return self.stft_detrend(x, None, p0, p1, k_offset=k_offset,
                                 padding=padding, axis=axis)

    def stft_detrend(self, x: np.ndarray,
                     detr: Callable[[np.ndarray], np.ndarray] | Literal['linear', 'constant'] | None,  # noqa: E501
                     p0: int | None = None, p1: int | None = None, *,
                     k_offset: int = 0, padding: PAD_TYPE = 'zeros',
                     axis: int = -1) \
            -> np.ndarray:
        """Calculate short-time Fourier transform with a trend being subtracted from
        each segment beforehand.

        When the parameter `detr` is ``None``, this method's behavior is identical to
        the `~ShortTimeFFT.stft` method. Note that due to the detrending, the original
        signal cannot be reconstructed by the `~ShortTimeFFT.istft`.

        Parameters
        ----------
        x : np.ndarray
            The input signal as real or complex valued array. For complex values, the
            property `fft_mode` must be set to 'twosided' or 'centered'.
        detr : 'linear' |  'constant' |  Callable[[np.ndarray], np.ndarray] | None
            If 'constant', the mean is subtracted, if set to "linear", the linear
            trend is removed from each segment. This is achieved by calling
            `~scipy.signal.detrend`. If `detr` is a function with one parameter, `detr`
            is applied to each segment.
        p0 : int | None
            The first element of the range of slices to calculate. If ``None``
            then it is set to :attr:`p_min`, which is the smallest possible
            slice.
        p1 : int | None
            The end of the array. If ``None`` then `p_max(n)` is used.
        k_offset : int
            Index of first sample (t = 0) in `x`.
        padding : 'zeros' | 'edge' | 'even' | 'odd'
            Kind of values which are added, when the sliding window sticks out
            on either the lower or upper end of the input `x`. Zeros are added
            if the default 'zeros' is set. For 'edge' either the first or the
            last value of `x` is used. 'even' pads by reflecting the
            signal on the first or last sample and 'odd' additionally
            multiplies it with -1.
        axis: int
            The axis of `x` over which to compute the STFT.
            If not given, the last axis is used.

        Returns
        -------
        S : np.ndarray
            A complex array is returned with the dimension always being larger
            by one than of `x`. The last axis always represents the time slices
            of the STFT. `axis` defines the frequency axis (default second to
            last). E.g., for a one-dimensional `x`, a complex 2d array is
            returned, with axis 0 representing frequency and axis 1 the time
            slices.

        See Also
        --------
        invertible: Check if STFT is invertible.
        :meth:`~ShortTimeFFT.istft`: Inverse short-time Fourier transform.
        :meth:`~ShortTimeFFT.stft`: Short-time Fourier transform
                                   (without detrending).
        :class:`scipy.signal.ShortTimeFFT`: Class this method belongs to.
        """
        if self.onesided_fft and np.iscomplexobj(x):
            raise ValueError(f"Complex-valued `x` not allowed for {self.fft_mode=}'! "
                             "Set property `fft_mode` to 'twosided' or 'centered'.")
        if isinstance(detr, str):
            detr = partial(detrend, type=detr)
        elif not (detr is None or callable(detr)):
            raise ValueError(f"Parameter {detr=} is not a str, function or " +
                             "None!")
        n = x.shape[axis]
        if not (n >= (m2p := self.m_num-self.m_num_mid)):
            e_str = f'{len(x)=}' if x.ndim == 1 else f'of {axis=} of {x.shape}'
            raise ValueError(f"{e_str} must be >= ceil(m_num/2) = {m2p}!")

        if x.ndim > 1:  # motivated by the NumPy broadcasting mechanisms:
            x = np.moveaxis(x, axis, -1)
        # determine slice index range:
        p0, p1 = self.p_range(n, p0, p1)
        S_shape_1d = (self.f_pts, p1 - p0)
        S_shape = x.shape[:-1] + S_shape_1d if x.ndim > 1 else S_shape_1d
        S = np.zeros(S_shape, dtype=complex)
        for p_, x_ in enumerate(self._x_slices(x, k_offset, p0, p1, padding)):
            if detr is not None:
                x_ = detr(x_)
            S[..., :, p_] = self._fft_func(x_ * self.win.conj())
        if x.ndim > 1:
            return np.moveaxis(S, -2, axis if axis >= 0 else axis-1)
        return S

    def spectrogram(self, x: np.ndarray, y: np.ndarray | None = None,
                    detr: Callable[[np.ndarray], np.ndarray] | Literal['linear', 'constant'] | None = None,  # noqa: E501
                    *,
                    p0: int | None = None, p1: int | None = None,
                    k_offset: int = 0, padding: PAD_TYPE = 'zeros',
                    axis: int = -1) \
            -> np.ndarray:
        r"""Calculate spectrogram or cross-spectrogram.

        The spectrogram is the absolute square of the STFT, i.e., it is
        ``abs(S[q,p])**2`` for given ``S[q,p]`` and thus is always
        non-negative.
        For two STFTs ``Sx[q,p], Sy[q,p]``, the cross-spectrogram is defined
        as ``Sx[q,p] * np.conj(Sy[q,p])`` and is complex-valued.
        This is a convenience function for calling `~ShortTimeFFT.stft` /
        `stft_detrend`, hence all parameters are discussed there.

        Parameters
        ----------
        x : np.ndarray
            The input signal as real or complex valued array. For complex values, the
            property `fft_mode` must be set to 'twosided' or 'centered'.
        y : np.ndarray
            The second input signal of the same shape as `x`. If ``None``, it is
            assumed to be `x`. For complex values, the property `fft_mode` must be
            set to 'twosided' or 'centered'.
        detr : 'linear' |  'constant' |  Callable[[np.ndarray], np.ndarray] | None
            If 'constant', the mean is subtracted, if set to "linear", the linear
            trend is removed from each segment. This is achieved by calling
            `~scipy.signal.detrend`. If `detr` is a function with one parameter, `detr`
            is applied to each segment. For ``None`` (default), no trends are removed.
        p0 : int | None
            The first element of the range of slices to calculate. If ``None``
            then it is set to :attr:`p_min`, which is the smallest possible
            slice.
        p1 : int | None
            The end of the array. If ``None`` then `p_max(n)` is used.
        k_offset : int
            Index of first sample (t = 0) in `x`.
        padding : 'zeros' | 'edge' | 'even' | 'odd'
            Kind of values which are added, when the sliding window sticks out
            on either the lower or upper end of the input `x`. Zeros are added
            if the default 'zeros' is set. For 'edge' either the first or the
            last value of `x` is used. 'even' pads by reflecting the
            signal on the first or last sample and 'odd' additionally
            multiplies it with -1.
        axis : int
            The axis of `x` over which to compute the STFT.
            If not given, the last axis is used.

        Returns
        -------
        S_xy : np.ndarray
            A real-valued array with non-negative values is returned, if ``x is y`` or
            `y` is ``None``. The dimension is always by one larger than of `x`. The
            last axis always represents the time slices of the spectrogram. `axis`
            defines the frequency axis (default second to last). E.g., for a
            one-dimensional `x`, a complex 2d array is returned, with axis 0
            representing frequency and axis 1 the time slices.

        Notes
        -----
        The cross-spectrogram may be interpreted as the time-frequency analogon of the
        cross-spectral density (consult `csd`). The absolute square `|Sxy|²` of a
        cross-spectrogram `Sxy` divided by the spectrograms `Sxx` and `Syy` can be
        interpreted as a coherence spectrogram ``Cxy := abs(Sxy)**2 / (Sxx*Syy)``,
        which is the time-frequency analogon to `~coherence`.

        If the STFT is parametrized to be a unitary transform, i.e., utilitzing
        `~from_win_equals_dual`, then the value of the scalar product, hence also the
        energy, is preserved.

        Examples
        --------
        The following example shows the spectrogram of a square wave with varying
        frequency :math:`f_i(t)` (marked by a green dashed line in the plot) sampled
        with 20 Hz. The utilized Gaussian window is 50 samples or 2.5 s long. For the
        `ShortTimeFFT`, the parameter ``mfft=800`` (oversampling factor 16) and the
        `hop` interval of 2 in was chosen to produce a sufficient number of points.

        The plot's colormap is logarithmically scaled as the power spectral
        density is in dB. The time extent of the signal `x` is marked by
        vertical dashed lines, and the shaded areas mark the presence of border
        effects.

        >>> import matplotlib.pyplot as plt
        >>> import numpy as np
        >>> from scipy.signal import square, ShortTimeFFT
        >>> from scipy.signal.windows import gaussian
        ...
        >>> T_x, N = 1 / 20, 1000  # 20 Hz sampling rate for 50 s signal
        >>> t_x = np.arange(N) * T_x  # time indexes for signal
        >>> f_i = 5e-3*(t_x - t_x[N // 3])**2 + 1  # varying frequency
        >>> x = square(2*np.pi*np.cumsum(f_i)*T_x)  # the signal
        ...
        >>> g_std = 12  # standard deviation for Gaussian window in samples
        >>> win = gaussian(50, std=g_std, sym=True)  # symmetric Gaussian wind.
        >>> SFT = ShortTimeFFT(win, hop=2, fs=1/T_x, mfft=800, scale_to='psd')
        >>> Sx2 = SFT.spectrogram(x)  # calculate absolute square of STFT
        ...
        >>> fig1, ax1 = plt.subplots(figsize=(6., 4.))  # enlarge plot a bit
        >>> t_lo, t_hi = SFT.extent(N)[:2]  # time range of plot
        >>> ax1.set_title(rf"Spectrogram ({SFT.m_num*SFT.T:g}$\,s$ Gaussian " +
        ...               rf"window, $\sigma_t={g_std*SFT.T:g}\,$s)")
        >>> ax1.set(xlabel=f"Time $t$ in seconds ({SFT.p_num(N)} slices, " +
        ...                rf"$\Delta t = {SFT.delta_t:g}\,$s)",
        ...         ylabel=f"Freq. $f$ in Hz ({SFT.f_pts} bins, " +
        ...                rf"$\Delta f = {SFT.delta_f:g}\,$Hz)",
        ...         xlim=(t_lo, t_hi))
        >>> Sx_dB = 10 * np.log10(np.fmax(Sx2, 1e-4))  # limit range to -40 dB
        >>> im1 = ax1.imshow(Sx_dB, origin='lower', aspect='auto',
        ...                  extent=SFT.extent(N), cmap='magma')
        >>> ax1.plot(t_x, f_i, 'g--', alpha=.5, label='$f_i(t)$')
        >>> fig1.colorbar(im1, label='Power Spectral Density ' +
        ...                          r"$20\,\log_{10}|S_x(t, f)|$ in dB")
        ...
        >>> # Shade areas where window slices stick out to the side:
        >>> for t0_, t1_ in [(t_lo, SFT.lower_border_end[0] * SFT.T),
        ...                  (SFT.upper_border_begin(N)[0] * SFT.T, t_hi)]:
        ...     ax1.axvspan(t0_, t1_, color='w', linewidth=0, alpha=.3)
        >>> for t_ in [0, N * SFT.T]:  # mark signal borders with vertical line
        ...     ax1.axvline(t_, color='c', linestyle='--', alpha=0.5)
        >>> ax1.legend()
        >>> fig1.tight_layout()
        >>> plt.show()

        The logarithmic scaling reveals the odd harmonics of the square wave,
        which are reflected at the Nyquist frequency of 10 Hz. This aliasing
        is also the main source of the noise artifacts in the plot.

        See Also
        --------
        :meth:`~ShortTimeFFT.stft`: Perform the short-time Fourier transform.
        stft_detrend: STFT with a trend subtracted from each segment.
        :class:`scipy.signal.ShortTimeFFT`: Class this method belongs to.
        """
        Sx = self.stft_detrend(x, detr, p0, p1, k_offset=k_offset,
                               padding=padding, axis=axis)
        if y is None or y is x:  # do spectrogram:
            return Sx.real**2 + Sx.imag**2
        # Cross-spectrogram:
        Sy = self.stft_detrend(y, detr, p0, p1, k_offset=k_offset,
                               padding=padding, axis=axis)
        return Sx * Sy.conj()

    @property
    def dual_win(self) -> np.ndarray:
        """Dual window (canonical dual window by default).

        A STFT can be interpreted as the input signal being expressed as a
        weighted sum of modulated and time-shifted dual windows. If no dual window is
        given on instantiation, the canonical dual window, i.e., the window with the
        minimal energy (i.e., minimal L²-norm) is calculated. Alternative means for
        determining dual windows are provided by `closest_STFT_dual_window` and the
        `from_win_equals_dual` class-method. Note that `win` is also always a
        dual window of `dual_win`.

        `dual_win` has same length as `win`, namely `m_num` samples.

        If the dual window cannot be calculated a ``ValueError`` is raised.
        This attribute is read only and calculated lazily.
        To make this array immutable, its WRITEABLE flag is set to ``FALSE``.

        See Also
        --------
        m_num: Number of samples in window `win` and `dual_win`.
        win: Window function as real- or complex-valued 1d array.
        from_win_equals_dual: Create instance where `win` and `dual_win` are equal.
        closest_STFT_dual_window: Calculate dual window closest to a desired window.
        numpy.ndarray.setflags: Modify array flags.
        ShortTimeFFT: Class this property belongs to.
        """
        if self._dual_win is None:
            self._dual_win = _calc_dual_canonical_window(self.win, self.hop)
            self.dual_win.setflags(write=False)
        return self._dual_win

    @property
    def invertible(self) -> bool:
        """Check if STFT is invertible.

        This is achieved by trying to calculate the canonical dual window.

        See Also
        --------
        :meth:`~ShortTimeFFT.istft`: Inverse short-time Fourier transform.
        m_num: Number of samples in window `win` and `dual_win`.
        dual_win: Dual window.
        win: Window for STFT.
        ShortTimeFFT: Class this property belongs to.
        """
        try:
            return len(self.dual_win) > 0  # call self.dual_win()
        except ValueError:
            return False

    def istft(self, S: np.ndarray, k0: int = 0, k1: int | None = None, *,
              f_axis: int = -2, t_axis: int = -1) \
            -> np.ndarray:
        """Inverse short-time Fourier transform.

        It returns an array of dimension ``S.ndim - 1``  which is real
        if `onesided_fft` is set, else complex. If the STFT is not
        `invertible`, or the parameters are out of bounds  a ``ValueError`` is
        raised.

        Parameters
        ----------
        S
            A complex valued array where `f_axis` denotes the frequency
            values and the `t-axis` dimension the temporal values of the
            STFT values.
        k0, k1
            The start and the end index of the reconstructed signal. The
            default (``k0 = 0``, ``k1 = None``) assumes that the maximum length
            signal should be reconstructed.
        f_axis, t_axis
            The axes in `S` denoting the frequency and the time dimension.

        Notes
        -----
        It is required that `S` has `f_pts` entries along the `f_axis`. For
        the `t_axis` it is assumed that the first entry corresponds to
        `p_min` * `delta_t` (being <= 0). The length of `t_axis` needs to be
        compatible with `k1`. I.e., ``S.shape[t_axis] >= self.p_max(k1)`` must
        hold, if `k1` is not ``None``. Else `k1` is set to `k_max` with::

            q_max = S.shape[t_range] + self.p_min
            k_max = (q_max - 1) * self.hop + self.m_num - self.m_num_mid

        The :ref:`tutorial_stft` section of the :ref:`user_guide` discussed the
        slicing behavior by means of an example.

        See Also
        --------
        invertible: Check if STFT is invertible.
        :meth:`~ShortTimeFFT.stft`: Perform Short-time Fourier transform.
        :class:`scipy.signal.ShortTimeFFT`: Class this method belongs to.
        """
        if f_axis == t_axis:
            raise ValueError(f"{f_axis=} may not be equal to {t_axis=}!")
        if S.shape[f_axis] != self.f_pts:
            raise ValueError(f"{S.shape[f_axis]=} must be equal to " +
                             f"{self.f_pts=} ({S.shape=})!")
        n_min = self.m_num-self.m_num_mid  # minimum signal length
        if not (S.shape[t_axis] >= (q_num := self.p_num(n_min))):
            raise ValueError(f"{S.shape[t_axis]=} needs to have at least " +
                             f"{q_num} slices ({S.shape=})!")
        if t_axis != S.ndim - 1 or f_axis != S.ndim - 2:
            t_axis = S.ndim + t_axis if t_axis < 0 else t_axis
            f_axis = S.ndim + f_axis if f_axis < 0 else f_axis
            S = np.moveaxis(S, (f_axis, t_axis), (-2, -1))

        q_max = S.shape[-1] + self.p_min
        k_max = (q_max - 1) * self.hop + self.m_num - self.m_num_mid

        k1 = k_max if k1 is None else k1
        if not (self.k_min <= k0 < k1 <= k_max):
            raise ValueError(f"({self.k_min=}) <= ({k0=}) < ({k1=}) <= " +
                             f"({k_max=}) is false!")
        if not (num_pts := k1 - k0) >= n_min:
            raise ValueError(f"({k1=}) - ({k0=}) = {num_pts} has to be at " +
                             f"least the half the window length {n_min}!")

        q0 = (k0 // self.hop + self.p_min if k0 >= 0 else  # p_min always <= 0
              k0 // self.hop)
        q1 = min(self.p_max(k1), q_max)
        k_q0, k_q1 = self.nearest_k_p(k0), self.nearest_k_p(k1, left=False)
        n_pts = k_q1 - k_q0 + self.m_num - self.m_num_mid
        x = np.zeros(S.shape[:-2] + (n_pts,),
                     dtype=float if self.onesided_fft else complex)
        for q_ in range(q0, q1):
            xs = self._ifft_func(S[..., :, q_ - self.p_min]) * self.dual_win
            i0 = q_ * self.hop - self.m_num_mid
            i1 = min(i0 + self.m_num, n_pts+k0)
            j0, j1 = 0, i1 - i0
            if i0 < k0:  # xs sticks out to the left on x:
                j0 += k0 - i0
                i0 = k0
            x[..., i0-k0:i1-k0] += xs[..., j0:j1]
        x = x[..., :k1-k0]
        if x.ndim > 1:
            x = np.moveaxis(x, -1, f_axis if f_axis < x.ndim else t_axis)
        return x

    @property
    def fac_magnitude(self) -> float:
        """Factor to multiply the STFT values by to scale each frequency slice
        to a magnitude spectrum.

        It is 1 if attribute ``scaling == 'magnitude'``.
        The window can be scaled to a magnitude spectrum by using the method
        `scale_to`.

        See Also
        --------
        fac_psd: Scaling factor for to a power spectral density spectrum.
        scale_to: Scale window to obtain 'magnitude' or 'psd' scaling.
        scaling: Normalization applied to the window function.
        ShortTimeFFT: Class this property belongs to.
        """
        if self.scaling == 'magnitude':
            return 1
        if self._fac_mag is None:
            self._fac_mag = 1 / abs(sum(self.win))
        return self._fac_mag

    @property
    def fac_psd(self) -> float:
        """Factor to multiply the STFT values by to scale each frequency slice
        to a power spectral density (PSD).

        It is 1 if attribute ``scaling == 'psd'``.
        The window can be scaled to a psd spectrum by using the method
        `scale_to`.

        See Also
        --------
        fac_magnitude: Scaling factor for to a magnitude spectrum.
        scale_to: Scale window to obtain 'magnitude' or 'psd' scaling.
        scaling: Normalization applied to the window function.
        ShortTimeFFT: Class this property belongs to.
        """
        if self.scaling == 'psd':
            return 1
        if self._fac_psd is None:
            self._fac_psd = 1 / np.sqrt(
                sum(self.win.real**2+self.win.imag**2) / self.T)
        return self._fac_psd

    @property
    def m_num(self) -> int:
        """Number of samples in window `win`.

        Note that the FFT can be oversampled by zero-padding. This is achieved
        by setting the `mfft` property.

        See Also
        --------
        m_num_mid: Center index of window `win`.
        mfft: Length of input for the FFT used - may be larger than `m_num`.
        hop: Time increment in signal samples for sliding window.
        win: Window function as real- or complex-valued 1d array.
        ShortTimeFFT: Class this property belongs to.
        """
        return len(self.win)

    @property
    def m_num_mid(self) -> int:
        """Center index of window `win`.

        For odd `m_num`, ``(m_num - 1) / 2`` is returned and
        for even `m_num` (per definition) ``m_num / 2`` is returned.

        See Also
        --------
        m_num: Number of samples in window `win`.
        mfft: Length of input for the FFT used - may be larger than `m_num`.
        hop: ime increment in signal samples for sliding window.
        win: Window function as real- or complex-valued 1d array.
        ShortTimeFFT: Class this property belongs to.
        """
        return self.m_num // 2

    @cache
    def _pre_padding(self) -> tuple[int, int]:
        """Smallest signal index and slice index due to padding.

         Since, per convention, for time t=0, n,q is zero, the returned values
         are negative or zero.
         """
        w2 = self.win.real**2 + self.win.imag**2
        # move window to the left until the overlap with t >= 0 vanishes:
        n0 = -self.m_num_mid
        for q_, n_ in enumerate(range(n0, n0-self.m_num-1, -self.hop)):
            n_next = n_ - self.hop
            if n_next + self.m_num <= 0 or all(w2[n_next:] == 0):
                return n_, -q_
        raise RuntimeError("This is code line should not have been reached!")
        # If this case is reached, it probably means the first slice should be
        # returned, i.e.: return n0, 0

    @property
    def k_min(self) -> int:
        """The smallest possible signal index of the STFT.

        `k_min` is the index of the left-most non-zero value of the lowest
        slice `p_min`. Since the zeroth slice is centered over the zeroth
        sample of the input signal, `k_min` is never positive.
        A detailed example is provided in the :ref:`tutorial_stft_sliding_win`
        section of the :ref:`user_guide`.

        See Also
        --------
        k_max: First sample index after signal end not touched by a time slice.
        lower_border_end: Where pre-padding effects end.
        p_min: The smallest possible slice index.
        p_max: Index of first non-overlapping upper time slice.
        p_num: Number of time slices, i.e., `p_max` - `p_min`.
        p_range: Determine and validate slice index range.
        upper_border_begin: Where post-padding effects start.
        ShortTimeFFT: Class this property belongs to.
        """
        return self._pre_padding()[0]

    @property
    def p_min(self) -> int:
        """The smallest possible slice index.

        `p_min` is the index of the left-most slice, where the window still
        sticks into the signal, i.e., has non-zero part for t >= 0.
        `k_min` is the smallest index where the window function of the slice
        `p_min` is non-zero.

        Since, per convention the zeroth slice is centered at t=0,
        `p_min` <= 0 always holds.
        A detailed example is provided in the :ref:`tutorial_stft_sliding_win`
        section of the :ref:`user_guide`.

        See Also
        --------
        k_min: The smallest possible signal index.
        k_max: First sample index after signal end not touched by a time slice.
        p_max: Index of first non-overlapping upper time slice.
        p_num: Number of time slices, i.e., `p_max` - `p_min`.
        p_range: Determine and validate slice index range.
        ShortTimeFFT: Class this property belongs to.
        """
        return self._pre_padding()[1]

    @lru_cache(maxsize=256)
    def _post_padding(self, n: int) -> tuple[int, int]:
        """Largest signal index and slice index due to padding.

        Parameters
        ----------
        n : int
            Number of samples of input signal (must be ≥ half of the window length).
        """
        if not (n >= (m2p := self.m_num - self.m_num_mid)):
            raise ValueError(f"Parameter n must be >= ceil(m_num/2) = {m2p}!")
        w2 = self.win.real**2 + self.win.imag**2
        # move window to the right until the overlap for t < t[n] vanishes:
        q1 = n // self.hop   # last slice index with t[p1] <= t[n]
        k1 = q1 * self.hop - self.m_num_mid
        for q_, k_ in enumerate(range(k1, n+self.m_num, self.hop), start=q1):
            n_next = k_ + self.hop
            if n_next >= n or all(w2[:n-n_next] == 0):
                return k_ + self.m_num, q_ + 1
        raise RuntimeError("This is code line should not have been reached!")
        # If this case is reached, it probably means the last slice should be
        # returned, i.e.: return k1 + self.m_num - self.m_num_mid, q1 + 1

    def k_max(self, n: int) -> int:
        """First sample index after signal end not touched by a time slice.

        `k_max` - 1 is the largest sample index of the slice `p_max` for a
        given input signal of `n` samples.
        A detailed example is provided in the :ref:`tutorial_stft_sliding_win`
        section of the :ref:`user_guide`.

        Parameters
        ----------
        n : int
            Number of samples of input signal (must be ≥ half of the window length).

        See Also
        --------
        k_min: The smallest possible signal index.
        p_min: The smallest possible slice index.
        p_max: Index of first non-overlapping upper time slice.
        p_num: Number of time slices, i.e., `p_max` - `p_min`.
        p_range: Determine and validate slice index range.
        ShortTimeFFT: Class this method belongs to.
        """
        return self._post_padding(n)[0]

    def p_max(self, n: int) -> int:
        """Index of first non-overlapping upper time slice for `n` sample
        input.

        Note that center point t[p_max] = (p_max(n)-1) * `delta_t` is typically
        larger than last time index t[n-1] == (`n`-1) * `T`. The upper border
        of samples indexes covered by the window slices is given by `k_max`.
        Furthermore, `p_max` does not denote the number of slices `p_num` since
        `p_min` is typically less than zero.
        A detailed example is provided in the :ref:`tutorial_stft_sliding_win`
        section of the :ref:`user_guide`.

        See Also
        --------
        k_min: The smallest possible signal index.
        k_max: First sample index after signal end not touched by a time slice.
        p_min: The smallest possible slice index.
        p_num: Number of time slices, i.e., `p_max` - `p_min`.
        p_range: Determine and validate slice index range.
        ShortTimeFFT: Class this method belongs to.
        """
        return self._post_padding(n)[1]

    def p_num(self, n: int) -> int:
        """Number of time slices for an input signal with `n` samples.

        It is given by `p_num` = `p_max` - `p_min` with `p_min` typically
        being negative.
        A detailed example is provided in the :ref:`tutorial_stft_sliding_win`
        section of the :ref:`user_guide`.

        See Also
        --------
        k_min: The smallest possible signal index.
        k_max: First sample index after signal end not touched by a time slice.
        lower_border_end: Where pre-padding effects end.
        p_min: The smallest possible slice index.
        p_max: Index of first non-overlapping upper time slice.
        p_range: Determine and validate slice index range.
        upper_border_begin: Where post-padding effects start.
        ShortTimeFFT: Class this method belongs to.
        """
        return self.p_max(n) - self.p_min

    @property
    def lower_border_end(self) -> tuple[int, int]:
        """First signal index and first slice index unaffected by pre-padding.

        Describes the point where the window does not stick out to the left
        of the signal domain.
        A detailed example is provided in the :ref:`tutorial_stft_sliding_win`
        section of the :ref:`user_guide`.

        See Also
        --------
        k_min: The smallest possible signal index.
        k_max: First sample index after signal end not touched by a time slice.
        lower_border_end: Where pre-padding effects end.
        p_min: The smallest possible slice index.
        p_max: Index of first non-overlapping upper time slice.
        p_num: Number of time slices, i.e., `p_max` - `p_min`.
        p_range: Determine and validate slice index range.
        upper_border_begin: Where post-padding effects start.
        ShortTimeFFT: Class this property belongs to.
        """
        # not using @cache decorator due to MyPy limitations
        if self._lower_border_end is not None:
            return self._lower_border_end

        # first non-zero element in self.win:
        m0 = np.flatnonzero(self.win.real**2 + self.win.imag**2)[0]

        # move window to the right until does not stick out to the left:
        k0 = -self.m_num_mid + m0
        for q_, k_ in enumerate(range(k0, self.hop + 1, self.hop)):
            if k_ + self.hop >= 0:  # next entry does not stick out anymore
                self._lower_border_end = (k_ + self.m_num, q_ + 1)
                return self._lower_border_end
        self._lower_border_end = (0, max(self.p_min, 0))  # ends at first slice
        return self._lower_border_end

    @lru_cache(maxsize=256)
    def upper_border_begin(self, n: int) -> tuple[int, int]:
        """First signal index and first slice index affected by post-padding.

        Describes the point where the window does begin stick out to the right
        of the signal domain.
        A detailed example is given :ref:`tutorial_stft_sliding_win` section
        of the :ref:`user_guide`.

        Parameters
        ----------
        n : int
            Number of samples of input signal (must be ≥ half of the window length).

        Returns
        -------
        k_ub : int
            Lowest signal index, where a touching time slice sticks out past the
            signal end.
        p_ub : int
            Lowest index of time slice of which the end sticks out past the signal end.

        See Also
        --------
        k_min: The smallest possible signal index.
        k_max: First sample index after signal end not touched by a time slice.
        lower_border_end: Where pre-padding effects end.
        p_min: The smallest possible slice index.
        p_max: Index of first non-overlapping upper time slice.
        p_num: Number of time slices, i.e., `p_max` - `p_min`.
        p_range: Determine and validate slice index range.
        ShortTimeFFT: Class this method belongs to.
        """
        if not (n >= (m2p := self.m_num - self.m_num_mid)):
            raise ValueError(f"Parameter n must be >= ceil(m_num/2) = {m2p}!")
        w2 = self.win.real**2 + self.win.imag**2
        q2 = n // self.hop + 1  # first t[q] >= t[n]
        q1 = max((n-self.m_num) // self.hop - 1, -1)
        # move window left until does not stick out to the right:
        for q_ in range(q2, q1, -1):
            k_ = q_ * self.hop + (self.m_num - self.m_num_mid)
            if k_ <= n or all(w2[n-k_:] == 0):
                return (q_ + 1) * self.hop - self.m_num_mid, q_ + 1
        return 0, 0  # border starts at first slice

    @property
    def delta_t(self) -> float:
        """Time increment of STFT.

        The time increment `delta_t` = `T` * `hop` represents the sample
        increment `hop` converted to time based on the sampling interval `T`.

        See Also
        --------
        delta_f: Width of the frequency bins of the STFT.
        hop: Hop size in signal samples for sliding window.
        t: Times of STFT for an input signal with `n` samples.
        T: Sampling interval of input signal and window `win`.
        ShortTimeFFT: Class this property belongs to
        """
        return self.T * self.hop

    def p_range(self, n: int, p0: int | None = None,
                p1: int | None = None) -> tuple[int, int]:
        """Determine and validate slice index range.

        Parameters
        ----------
        n : int
            Number of samples of input signal, assuming t[0] = 0.
        p0 : int | None
            First slice index. If 0 then the first slice is centered at t = 0.
            If ``None`` then `p_min` is used. Note that p0 may be < 0 if
            slices are left of t = 0.
        p1 : int | None
            End of interval (last value is p1-1).
            If ``None`` then `p_max(n)` is used.


        Returns
        -------
        p0_ : int
            The fist slice index
        p1_ : int
            End of interval (last value is p1-1).

        Notes
        -----
        A ``ValueError`` is raised if ``p_min <= p0 < p1 <= p_max(n)`` does not
        hold.

        See Also
        --------
        k_min: The smallest possible signal index.
        k_max: First sample index after signal end not touched by a time slice.
        lower_border_end: Where pre-padding effects end.
        p_min: The smallest possible slice index.
        p_max: Index of first non-overlapping upper time slice.
        p_num: Number of time slices, i.e., `p_max` - `p_min`.
        upper_border_begin: Where post-padding effects start.
        ShortTimeFFT: Class this property belongs to.
        """
        p_max = self.p_max(n)  # shorthand
        p0_ = self.p_min if p0 is None else p0
        p1_ = p_max if p1 is None else p1
        if not (self.p_min <= p0_ < p1_ <= p_max):
            raise ValueError(f"Invalid Parameter {p0=}, {p1=}, i.e., " +
                             f"{self.p_min=} <= p0 < p1 <= {p_max=} " +
                             f"does not hold for signal length {n=}!")
        return p0_, p1_

    @lru_cache(maxsize=1)
    def t(self, n: int, p0: int | None = None, p1: int | None = None,
          k_offset: int = 0) -> np.ndarray:
        """Times of STFT for an input signal with `n` samples.

        Returns a 1d array with times of the `~ShortTimeFFT.stft` values with
        the same  parametrization. Note that the slices are
        ``delta_t = hop * T`` time units apart.

        Parameters
        ----------
        n
            Number of sample of the input signal.
        p0
            The first element of the range of slices to calculate. If ``None``
            then it is set to :attr:`p_min`, which is the smallest possible
            slice.
        p1
            The end of the array. If ``None`` then `p_max(n)` is used.
        k_offset
            Index of first sample (t = 0) in `x`.


        See Also
        --------
        delta_t: Time increment of STFT (``hop*T``)
        hop: Time increment in signal samples for sliding window.
        nearest_k_p: Nearest sample index k_p for which t[k_p] == t[p] holds.
        T: Sampling interval of input signal and of the window (``1/fs``).
        fs: Sampling frequency (being ``1/T``)
        ShortTimeFFT: Class this method belongs to.
        """
        p0, p1 = self.p_range(n, p0, p1)
        return np.arange(p0, p1) * self.delta_t + k_offset * self.T

    def nearest_k_p(self, k: int, left: bool = True) -> int:
        """Return nearest sample index k_p for which t[k_p] == t[p] holds.

        The nearest next smaller time sample p (where t[p] is the center
        position of the window of the p-th slice) is p_k = k // `hop`.
        If `hop` is a divisor of `k` then `k` is returned.
        If `left` is set then p_k * `hop` is returned else (p_k+1) * `hop`.

        This method can be used to slice an input signal into chunks for
        calculating the STFT and iSTFT incrementally.

        See Also
        --------
        delta_t: Time increment of STFT (``hop*T``)
        hop: Time increment in signal samples for sliding window.
        T: Sampling interval of input signal and of the window (``1/fs``).
        fs: Sampling frequency (being ``1/T``)
        t: Times of STFT for an input signal with `n` samples.
        ShortTimeFFT: Class this method belongs to.
        """
        p_q, remainder = divmod(k, self.hop)
        if remainder == 0:
            return k
        return p_q * self.hop if left else (p_q + 1) * self.hop

    @property
    def delta_f(self) -> float:
        """Width of the frequency bins of the STFT.

        Return the frequency interval `delta_f` = 1 / (`mfft` * `T`).

        See Also
        --------
        delta_t: Time increment of STFT.
        f_pts: Number of points along the frequency axis.
        f: Frequencies values of the STFT.
        mfft: Length of the input for FFT used.
        T: Sampling interval.
        t: Times of STFT for an input signal with `n` samples.
        ShortTimeFFT: Class this property belongs to.
        """
        return 1 / (self.mfft * self.T)

    @property
    def f_pts(self) -> int:
        """Number of points along the frequency axis.

        See Also
        --------
        delta_f: Width of the frequency bins of the STFT.
        f: Frequencies values of the STFT.
        mfft: Length of the input for FFT used.
        ShortTimeFFT: Class this property belongs to.
        """
        return self.mfft // 2 + 1 if self.onesided_fft else self.mfft

    @property
    def onesided_fft(self) -> bool:
        """Return True if a one-sided FFT is used.

        Returns ``True`` if `fft_mode` is either 'onesided' or 'onesided2X'.

        See Also
        --------
        fft_mode: Utilized FFT ('twosided', 'centered', 'onesided' or
                 'onesided2X')
        ShortTimeFFT: Class this property belongs to.
        """
        return self.fft_mode in {'onesided', 'onesided2X'}

    @property
    def f(self) -> np.ndarray:
        """Frequencies values of the STFT.

        A 1d array of length `f_pts` with `delta_f` spaced entries is returned.

        See Also
        --------
        delta_f: Width of the frequency bins of the STFT.
        f_pts: Number of points along the frequency axis.
        mfft: Length of the input for FFT used.
        ShortTimeFFT: Class this property belongs to.
        """
        if self.fft_mode in {'onesided', 'onesided2X'}:
            return fft_lib.rfftfreq(self.mfft, self.T)
        elif self.fft_mode == 'twosided':
            return fft_lib.fftfreq(self.mfft, self.T)
        elif self.fft_mode == 'centered':
            return fft_lib.fftshift(fft_lib.fftfreq(self.mfft, self.T))
        # This should never happen but makes the Linters happy:
        fft_modes = get_args(FFT_MODE_TYPE)
        raise RuntimeError(f"{self.fft_mode=} not in {fft_modes}!")

    def _fft_func(self, x: np.ndarray) -> np.ndarray:
        """FFT based on the `fft_mode`, `mfft`, `scaling` and `phase_shift`
        attributes.

        For multidimensional arrays the transformation is carried out on the
        last axis.
        """
        if self.phase_shift is not None:
            if x.shape[-1] < self.mfft:  # zero pad if needed
                z_shape = list(x.shape)
                z_shape[-1] = self.mfft - x.shape[-1]
                x = np.hstack((x, np.zeros(z_shape, dtype=x.dtype)))
            p_s = (self.phase_shift + self.m_num_mid) % self.m_num
            x = np.roll(x, -p_s, axis=-1)

        if self.fft_mode == 'twosided':
            return fft_lib.fft(x, n=self.mfft, axis=-1)
        if self.fft_mode == 'centered':
            return fft_lib.fftshift(fft_lib.fft(x, self.mfft, axis=-1), axes=-1)
        if self.fft_mode == 'onesided':
            return fft_lib.rfft(x, n=self.mfft, axis=-1)
        if self.fft_mode == 'onesided2X':
            X = fft_lib.rfft(x, n=self.mfft, axis=-1)
            # Either squared magnitude (psd) or magnitude is doubled:
            fac = np.sqrt(2) if self.scaling == 'psd' else 2
            # For even input length, the last entry is unpaired:
            X[..., 1: -1 if self.mfft % 2 == 0 else None] *= fac
            return X
        # This should never happen but makes the Linter happy:
        fft_modes = get_args(FFT_MODE_TYPE)
        raise RuntimeError(f"{self.fft_mode=} not in {fft_modes}!")

    def _ifft_func(self, X: np.ndarray) -> np.ndarray:
        """Inverse to `_fft_func`.

        Returned is an array of length `m_num`. If the FFT is `onesided`
        then a float array is returned else a complex array is returned.
        For multidimensional arrays the transformation is carried out on the
        last axis.
        """
        if self.fft_mode == 'twosided':
            x = fft_lib.ifft(X, n=self.mfft, axis=-1)
        elif self.fft_mode == 'centered':
            x = fft_lib.ifft(fft_lib.ifftshift(X, axes=-1), n=self.mfft, axis=-1)
        elif self.fft_mode == 'onesided':
            x = fft_lib.irfft(X, n=self.mfft, axis=-1)
        elif self.fft_mode == 'onesided2X':
            Xc = X.copy()  # we do not want to modify function parameters
            fac = np.sqrt(2) if self.scaling == 'psd' else 2
            # For even length X the last value is not paired with a negative
            # value on the two-sided FFT:
            q1 = -1 if self.mfft % 2 == 0 else None
            Xc[..., 1:q1] /= fac
            x = fft_lib.irfft(Xc, n=self.mfft, axis=-1)
        else:  # This should never happen but makes the Linter happy:
            error_str = f"{self.fft_mode=} not in {get_args(FFT_MODE_TYPE)}!"
            raise RuntimeError(error_str)

        if self.phase_shift is None:
            return x[..., :self.m_num]
        p_s = (self.phase_shift + self.m_num_mid) % self.m_num
        return np.roll(x, p_s, axis=-1)[..., :self.m_num]

    def extent(self, n: int, axes_seq: Literal['tf', 'ft'] = 'tf',
               center_bins: bool = False) -> tuple[float, float, float, float]:
        """Return minimum and maximum values time-frequency values.

        A tuple with four floats  ``(t0, t1, f0, f1)`` for 'tf' and
        ``(f0, f1, t0, t1)`` for 'ft' is returned describing the corners
        of the time-frequency domain of the `~ShortTimeFFT.stft`.
        That tuple can be passed to `matplotlib.pyplot.imshow` as a parameter
        with the same name.

        Parameters
        ----------
        n : int
            Number of samples in input signal.
        axes_seq : {'tf', 'ft'}
            Return time extent first and then frequency extent or vice versa.
        center_bins: bool
            If set (default ``False``), the values of the time slots and
            frequency bins are moved from the side the middle. This is useful,
            when plotting the `~ShortTimeFFT.stft` values as step functions,
            i.e., with no interpolation.

        See Also
        --------
        :func:`matplotlib.pyplot.imshow`: Display data as an image.
        :class:`scipy.signal.ShortTimeFFT`: Class this method belongs to.

        Examples
        --------
        The following two plots illustrate the effect of the parameter `center_bins`:
        The grid lines represent the three time and the four frequency values of the
        STFT.
        The left plot, where ``(t0, t1, f0, f1) = (0, 3, 0, 4)`` is passed as parameter
        ``extent`` to `~matplotlib.pyplot.imshow`, shows the standard behavior of the
        time and frequency values being at the lower edge of the corrsponding bin.
        The right plot, with ``(t0, t1, f0, f1) = (-0.5, 2.5, -0.5, 3.5)``, shows that
        the bins are centered over the respective values when passing
        ``center_bins=True``.

        >>> import matplotlib.pyplot as plt
        >>> import numpy as np
        >>> from scipy.signal import ShortTimeFFT
        ...
        >>> n, m = 12, 6
        >>> SFT = ShortTimeFFT.from_window('hann', fs=m, nperseg=m, noverlap=0)
        >>> Sxx = SFT.stft(np.cos(np.arange(n)))  # produces a colorful plot
        ...
        >>> fig, axx = plt.subplots(1, 2, tight_layout=True, figsize=(6., 4.))
        >>> for ax_, center_bins in zip(axx, (False, True)):
        ...     ax_.imshow(abs(Sxx), origin='lower', interpolation=None, aspect='equal',
        ...                cmap='viridis', extent=SFT.extent(n, 'tf', center_bins))
        ...     ax_.set_title(f"{center_bins=}")
        ...     ax_.set_xlabel(f"Time ({SFT.p_num(n)} points, Δt={SFT.delta_t})")
        ...     ax_.set_ylabel(f"Frequency ({SFT.f_pts} points, Δf={SFT.delta_f})")
        ...     ax_.set_xticks(SFT.t(n))  # vertical grid line are timestamps
        ...     ax_.set_yticks(SFT.f)  # horizontal grid line are frequency values
        ...     ax_.grid(True)
        >>> plt.show()

        Note that the step-like behavior with the constant colors is caused by passing
        ``interpolation=None`` to `~matplotlib.pyplot.imshow`.
        """
        if axes_seq not in ('tf', 'ft'):
            raise ValueError(f"Parameter {axes_seq=} not in ['tf', 'ft']!")

        if self.onesided_fft:
            q0, q1 = 0, self.f_pts
        elif self.fft_mode == 'centered':
            q0 = -(self.mfft // 2)
            q1 = self.mfft // 2 if self.mfft % 2 == 0 else self.mfft // 2 + 1
        else:
            raise ValueError(f"Attribute fft_mode={self.fft_mode} must be " +
                             "in ['centered', 'onesided', 'onesided2X']")

        p0, p1 = self.p_min, self.p_max(n)  # shorthand
        if center_bins:
            t0, t1 = self.delta_t * (p0 - 0.5), self.delta_t * (p1 - 0.5)
            f0, f1 = self.delta_f * (q0 - 0.5), self.delta_f * (q1 - 0.5)
        else:
            t0, t1 = self.delta_t * p0, self.delta_t * p1
            f0, f1 = self.delta_f * q0, self.delta_f * q1
        return (t0, t1, f0, f1) if axes_seq == 'tf' else (f0, f1, t0, t1)
