# Author: Travis Oliphant
# 2003
#
# Feb. 2010: Updated by Warren Weckesser:
#   Rewrote much of chirp()
#   Added sweep_poly()
import numpy as np
from numpy import asarray, zeros, place, nan, mod, pi, extract, log, sqrt, \
    exp, cos, sin, polyval, polyint


__all__ = ['sawtooth', 'square', 'gausspulse', 'chirp', 'sweep_poly',
           'unit_impulse']


def sawtooth(t, width=1):
    """
    Return a periodic sawtooth or triangle waveform.

    The sawtooth waveform has a period ``2*pi``, rises from -1 to 1 on the
    interval 0 to ``width*2*pi``, then drops from 1 to -1 on the interval
    ``width*2*pi`` to ``2*pi``. `width` must be in the interval [0, 1].

    Note that this is not band-limited.  It produces an infinite number
    of harmonics, which are aliased back and forth across the frequency
    spectrum.

    Parameters
    ----------
    t : array_like
        Time.
    width : array_like, optional
        Width of the rising ramp as a proportion of the total cycle.
        Default is 1, producing a rising ramp, while 0 produces a falling
        ramp.  `width` = 0.5 produces a triangle wave.
        If an array, causes wave shape to change over time, and must be the
        same length as t.

    Returns
    -------
    y : ndarray
        Output array containing the sawtooth waveform.

    Examples
    --------
    A 5 Hz waveform sampled at 500 Hz for 1 second:

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> t = np.linspace(0, 1, 500)
    >>> plt.plot(t, signal.sawtooth(2 * np.pi * 5 * t))

    """
    t, w = asarray(t), asarray(width)
    w = asarray(w + (t - t))
    t = asarray(t + (w - w))
    y = zeros(t.shape, dtype="d")

    # width must be between 0 and 1 inclusive
    mask1 = (w > 1) | (w < 0)
    place(y, mask1, nan)

    # take t modulo 2*pi
    tmod = mod(t, 2 * pi)

    # on the interval 0 to width*2*pi function is
    #  tmod / (pi*w) - 1
    mask2 = (1 - mask1) & (tmod < w * 2 * pi)
    tsub = extract(mask2, tmod)
    wsub = extract(mask2, w)
    place(y, mask2, tsub / (pi * wsub) - 1)

    # on the interval width*2*pi to 2*pi function is
    #  (pi*(w+1)-tmod) / (pi*(1-w))

    mask3 = (1 - mask1) & (1 - mask2)
    tsub = extract(mask3, tmod)
    wsub = extract(mask3, w)
    place(y, mask3, (pi * (wsub + 1) - tsub) / (pi * (1 - wsub)))
    return y


def square(t, duty=0.5):
    """
    Return a periodic square-wave waveform.

    The square wave has a period ``2*pi``, has value +1 from 0 to
    ``2*pi*duty`` and -1 from ``2*pi*duty`` to ``2*pi``. `duty` must be in
    the interval [0,1].

    Note that this is not band-limited.  It produces an infinite number
    of harmonics, which are aliased back and forth across the frequency
    spectrum.

    Parameters
    ----------
    t : array_like
        The input time array.
    duty : array_like, optional
        Duty cycle.  Default is 0.5 (50% duty cycle).
        If an array, causes wave shape to change over time, and must be the
        same length as t.

    Returns
    -------
    y : ndarray
        Output array containing the square waveform.

    Examples
    --------
    A 5 Hz waveform sampled at 500 Hz for 1 second:

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> t = np.linspace(0, 1, 500, endpoint=False)
    >>> plt.plot(t, signal.square(2 * np.pi * 5 * t))
    >>> plt.ylim(-2, 2)

    A pulse-width modulated sine wave:

    >>> plt.figure()
    >>> sig = np.sin(2 * np.pi * t)
    >>> pwm = signal.square(2 * np.pi * 30 * t, duty=(sig + 1)/2)
    >>> plt.subplot(2, 1, 1)
    >>> plt.plot(t, sig)
    >>> plt.subplot(2, 1, 2)
    >>> plt.plot(t, pwm)
    >>> plt.ylim(-1.5, 1.5)

    """
    t, w = asarray(t), asarray(duty)
    w = asarray(w + (t - t))
    t = asarray(t + (w - w))
    y = zeros(t.shape, dtype="d")

    # width must be between 0 and 1 inclusive
    mask1 = (w > 1) | (w < 0)
    place(y, mask1, nan)

    # on the interval 0 to duty*2*pi function is 1
    tmod = mod(t, 2 * pi)
    mask2 = (1 - mask1) & (tmod < w * 2 * pi)
    place(y, mask2, 1)

    # on the interval duty*2*pi to 2*pi function is
    #  (pi*(w+1)-tmod) / (pi*(1-w))
    mask3 = (1 - mask1) & (1 - mask2)
    place(y, mask3, -1)
    return y


def gausspulse(t, fc=1000, bw=0.5, bwr=-6, tpr=-60, retquad=False,
               retenv=False):
    """
    Return a Gaussian modulated sinusoid:

        ``exp(-a t^2) exp(1j*2*pi*fc*t).``

    If `retquad` is True, then return the real and imaginary parts
    (in-phase and quadrature).
    If `retenv` is True, then return the envelope (unmodulated signal).
    Otherwise, return the real part of the modulated sinusoid.

    Parameters
    ----------
    t : ndarray or the string 'cutoff'
        Input array.
    fc : float, optional
        Center frequency (e.g. Hz).  Default is 1000.
    bw : float, optional
        Fractional bandwidth in frequency domain of pulse (e.g. Hz).
        Default is 0.5.
    bwr : float, optional
        Reference level at which fractional bandwidth is calculated (dB).
        Default is -6.
    tpr : float, optional
        If `t` is 'cutoff', then the function returns the cutoff
        time for when the pulse amplitude falls below `tpr` (in dB).
        Default is -60.
    retquad : bool, optional
        If True, return the quadrature (imaginary) as well as the real part
        of the signal.  Default is False.
    retenv : bool, optional
        If True, return the envelope of the signal.  Default is False.

    Returns
    -------
    yI : ndarray
        Real part of signal.  Always returned.
    yQ : ndarray
        Imaginary part of signal.  Only returned if `retquad` is True.
    yenv : ndarray
        Envelope of signal.  Only returned if `retenv` is True.

    Examples
    --------
    Plot real component, imaginary component, and envelope for a 5 Hz pulse,
    sampled at 100 Hz for 2 seconds:

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> t = np.linspace(-1, 1, 2 * 100, endpoint=False)
    >>> i, q, e = signal.gausspulse(t, fc=5, retquad=True, retenv=True)
    >>> plt.plot(t, i, t, q, t, e, '--')

    """
    if fc < 0:
        raise ValueError(f"Center frequency (fc={fc:.2f}) must be >=0.")
    if bw <= 0:
        raise ValueError(f"Fractional bandwidth (bw={bw:.2f}) must be > 0.")
    if bwr >= 0:
        raise ValueError(f"Reference level for bandwidth (bwr={bwr:.2f}) "
                         "must be < 0 dB")

    # exp(-a t^2) <->  sqrt(pi/a) exp(-pi^2/a * f^2)  = g(f)

    ref = pow(10.0, bwr / 20.0)
    # fdel = fc*bw/2:  g(fdel) = ref --- solve this for a
    #
    # pi^2/a * fc^2 * bw^2 /4=-log(ref)
    a = -(pi * fc * bw) ** 2 / (4.0 * log(ref))

    if isinstance(t, str):
        if t == 'cutoff':  # compute cut_off point
            #  Solve exp(-a tc**2) = tref  for tc
            #   tc = sqrt(-log(tref) / a) where tref = 10^(tpr/20)
            if tpr >= 0:
                raise ValueError("Reference level for time cutoff must "
                                 "be < 0 dB")
            tref = pow(10.0, tpr / 20.0)
            return sqrt(-log(tref) / a)
        else:
            raise ValueError("If `t` is a string, it must be 'cutoff'")

    yenv = exp(-a * t * t)
    yI = yenv * cos(2 * pi * fc * t)
    yQ = yenv * sin(2 * pi * fc * t)
    if not retquad and not retenv:
        return yI
    if not retquad and retenv:
        return yI, yenv
    if retquad and not retenv:
        return yI, yQ
    if retquad and retenv:
        return yI, yQ, yenv


def chirp(t, f0, t1, f1, method='linear', phi=0, vertex_zero=True, *,
          complex=False):
    r"""Frequency-swept cosine generator.

    In the following, 'Hz' should be interpreted as 'cycles per unit';
    there is no requirement here that the unit is one second.  The
    important distinction is that the units of rotation are cycles, not
    radians. Likewise, `t` could be a measurement of space instead of time.

    Parameters
    ----------
    t : array_like
        Times at which to evaluate the waveform.
    f0 : float
        Frequency (e.g. Hz) at time t=0.
    t1 : float
        Time at which `f1` is specified.
    f1 : float
        Frequency (e.g. Hz) of the waveform at time `t1`.
    method : {'linear', 'quadratic', 'logarithmic', 'hyperbolic'}, optional
        Kind of frequency sweep.  If not given, `linear` is assumed.  See
        Notes below for more details.
    phi : float, optional
        Phase offset, in degrees. Default is 0.
    vertex_zero : bool, optional
        This parameter is only used when `method` is 'quadratic'.
        It determines whether the vertex of the parabola that is the graph
        of the frequency is at t=0 or t=t1.
    complex : bool, optional
        This parameter creates a complex-valued analytic signal instead of a
        real-valued signal. It allows the use of complex baseband (in communications
        domain). Default is False.

        .. versionadded:: 1.15.0

    Returns
    -------
    y : ndarray
        A numpy array containing the signal evaluated at `t` with the requested
        time-varying frequency.  More precisely, the function returns
        ``exp(1j*phase + 1j*(pi/180)*phi) if complex else cos(phase + (pi/180)*phi)``
        where `phase` is the integral (from 0 to `t`) of ``2*pi*f(t)``.
        The instantaneous frequency ``f(t)`` is defined below.

    See Also
    --------
    sweep_poly

    Notes
    -----
    There are four possible options for the parameter `method`, which have a (long)
    standard form and some allowed abbreviations. The formulas for the instantaneous
    frequency :math:`f(t)` of the generated signal are as follows:

    1. Parameter `method` in ``('linear', 'lin', 'li')``:

       .. math::
           f(t) = f_0 + \beta\, t           \quad\text{with}\quad
           \beta = \frac{f_1 - f_0}{t_1}

       Frequency :math:`f(t)` varies linearly over time with a constant rate
       :math:`\beta`.

    2. Parameter `method` in ``('quadratic', 'quad', 'q')``:

       .. math::
            f(t) =
            \begin{cases}
              f_0 + \beta\, t^2          & \text{if vertex_zero is True,}\\
              f_1 + \beta\, (t_1 - t)^2  & \text{otherwise,}
            \end{cases}
            \quad\text{with}\quad
            \beta = \frac{f_1 - f_0}{t_1^2}

       The graph of the frequency f(t) is a parabola through :math:`(0, f_0)` and
       :math:`(t_1, f_1)`.  By default, the vertex of the parabola is at
       :math:`(0, f_0)`. If `vertex_zero` is ``False``, then the vertex is at
       :math:`(t_1, f_1)`.
       To use a more general quadratic function, or an arbitrary
       polynomial, use the function `scipy.signal.sweep_poly`.

    3. Parameter `method` in ``('logarithmic', 'log', 'lo')``:

       .. math::
            f(t) = f_0  \left(\frac{f_1}{f_0}\right)^{t/t_1}

       :math:`f_0` and :math:`f_1` must be nonzero and have the same sign.
       This signal is also known as a geometric or exponential chirp.

    4. Parameter `method` in ``('hyperbolic', 'hyp')``:

       .. math::
              f(t) = \frac{\alpha}{\beta\, t + \gamma} \quad\text{with}\quad
              \alpha = f_0 f_1 t_1, \ \beta = f_0 - f_1, \ \gamma = f_1 t_1

       :math:`f_0` and :math:`f_1` must be nonzero.


    Examples
    --------
    For the first example, a linear chirp ranging from 6 Hz to 1 Hz over 10 seconds is
    plotted:

    >>> import numpy as np
    >>> from matplotlib.pyplot import tight_layout
    >>> from scipy.signal import chirp, square, ShortTimeFFT
    >>> from scipy.signal.windows import gaussian
    >>> import matplotlib.pyplot as plt
    ...
    >>> N, T = 1000, 0.01  # number of samples and sampling interval for 10 s signal
    >>> t = np.arange(N) * T  # timestamps
    ...
    >>> x_lin = chirp(t, f0=6, f1=1, t1=10, method='linear')
    ...
    >>> fg0, ax0 = plt.subplots()
    >>> ax0.set_title(r"Linear Chirp from $f(0)=6\,$Hz to $f(10)=1\,$Hz")
    >>> ax0.set(xlabel="Time $t$ in Seconds", ylabel=r"Amplitude $x_\text{lin}(t)$")
    >>> ax0.plot(t, x_lin)
    >>> plt.show()

    The following four plots each show the short-time Fourier transform of a chirp
    ranging from 45 Hz to 5 Hz with different values for the parameter `method`
    (and `vertex_zero`):

    >>> x_qu0 = chirp(t, f0=45, f1=5, t1=N*T, method='quadratic', vertex_zero=True)
    >>> x_qu1 = chirp(t, f0=45, f1=5, t1=N*T, method='quadratic', vertex_zero=False)
    >>> x_log = chirp(t, f0=45, f1=5, t1=N*T, method='logarithmic')
    >>> x_hyp = chirp(t, f0=45, f1=5, t1=N*T, method='hyperbolic')
    ...
    >>> win = gaussian(50, std=12, sym=True)
    >>> SFT = ShortTimeFFT(win, hop=2, fs=1/T, mfft=800, scale_to='magnitude')
    >>> ts = ("'quadratic', vertex_zero=True", "'quadratic', vertex_zero=False",
    ...       "'logarithmic'", "'hyperbolic'")
    >>> fg1, ax1s = plt.subplots(2, 2, sharex='all', sharey='all',
    ...                          figsize=(6, 5),  layout="constrained")
    >>> for x_, ax_, t_ in zip([x_qu0, x_qu1, x_log, x_hyp], ax1s.ravel(), ts):
    ...     aSx = abs(SFT.stft(x_))
    ...     im_ = ax_.imshow(aSx, origin='lower', aspect='auto', extent=SFT.extent(N),
    ...                      cmap='plasma')
    ...     ax_.set_title(t_)
    ...     if t_ == "'hyperbolic'":
    ...         fg1.colorbar(im_, ax=ax1s, label='Magnitude $|S_z(t,f)|$')
    >>> _ = fg1.supxlabel("Time $t$ in Seconds")  # `_ =` is needed to pass doctests
    >>> _ = fg1.supylabel("Frequency $f$ in Hertz")
    >>> plt.show()

    Finally, the short-time Fourier transform of a complex-valued linear chirp
    ranging from -30 Hz to 30 Hz is depicted:

    >>> z_lin = chirp(t, f0=-30, f1=30, t1=N*T, method="linear", complex=True)
    >>> SFT.fft_mode = 'centered'  # needed to work with complex signals
    >>> aSz = abs(SFT.stft(z_lin))
    ...
    >>> fg2, ax2 = plt.subplots()
    >>> ax2.set_title(r"Linear Chirp from $-30\,$Hz to $30\,$Hz")
    >>> ax2.set(xlabel="Time $t$ in Seconds", ylabel="Frequency $f$ in Hertz")
    >>> im2 = ax2.imshow(aSz, origin='lower', aspect='auto',
    ...                  extent=SFT.extent(N), cmap='viridis')
    >>> fg2.colorbar(im2, label='Magnitude $|S_z(t,f)|$')
    >>> plt.show()

    Note that using negative frequencies makes only sense with complex-valued signals.
    Furthermore, the magnitude of the complex exponential function is one whereas the
    magnitude of the real-valued cosine function is only 1/2.
    """
    # 'phase' is computed in _chirp_phase, to make testing easier.
    phase = _chirp_phase(t, f0, t1, f1, method, vertex_zero) + np.deg2rad(phi)
    return np.exp(1j*phase) if complex else np.cos(phase)


def _chirp_phase(t, f0, t1, f1, method='linear', vertex_zero=True):
    """
    Calculate the phase used by `chirp` to generate its output.

    See `chirp` for a description of the arguments.

    """
    t = asarray(t)
    f0 = float(f0)
    t1 = float(t1)
    f1 = float(f1)
    if method in ['linear', 'lin', 'li']:
        beta = (f1 - f0) / t1
        phase = 2 * pi * (f0 * t + 0.5 * beta * t * t)

    elif method in ['quadratic', 'quad', 'q']:
        beta = (f1 - f0) / (t1 ** 2)
        if vertex_zero:
            phase = 2 * pi * (f0 * t + beta * t ** 3 / 3)
        else:
            phase = 2 * pi * (f1 * t + beta * ((t1 - t) ** 3 - t1 ** 3) / 3)

    elif method in ['logarithmic', 'log', 'lo']:
        if f0 * f1 <= 0.0:
            raise ValueError("For a logarithmic chirp, f0 and f1 must be "
                             "nonzero and have the same sign.")
        if f0 == f1:
            phase = 2 * pi * f0 * t
        else:
            beta = t1 / log(f1 / f0)
            phase = 2 * pi * beta * f0 * (pow(f1 / f0, t / t1) - 1.0)

    elif method in ['hyperbolic', 'hyp']:
        if f0 == 0 or f1 == 0:
            raise ValueError("For a hyperbolic chirp, f0 and f1 must be "
                             "nonzero.")
        if f0 == f1:
            # Degenerate case: constant frequency.
            phase = 2 * pi * f0 * t
        else:
            # Singular point: the instantaneous frequency blows up
            # when t == sing.
            sing = -f1 * t1 / (f0 - f1)
            phase = 2 * pi * (-sing * f0) * log(np.abs(1 - t/sing))

    else:
        raise ValueError("method must be 'linear', 'quadratic', 'logarithmic', "
                         f"or 'hyperbolic', but a value of {method!r} was given.")

    return phase


def sweep_poly(t, poly, phi=0):
    """
    Frequency-swept cosine generator, with a time-dependent frequency.

    This function generates a sinusoidal function whose instantaneous
    frequency varies with time.  The frequency at time `t` is given by
    the polynomial `poly`.

    Parameters
    ----------
    t : ndarray
        Times at which to evaluate the waveform.
    poly : 1-D array_like or instance of numpy.poly1d
        The desired frequency expressed as a polynomial.  If `poly` is
        a list or ndarray of length n, then the elements of `poly` are
        the coefficients of the polynomial, and the instantaneous
        frequency is

          ``f(t) = poly[0]*t**(n-1) + poly[1]*t**(n-2) + ... + poly[n-1]``

        If `poly` is an instance of numpy.poly1d, then the
        instantaneous frequency is

          ``f(t) = poly(t)``

    phi : float, optional
        Phase offset, in degrees, Default: 0.

    Returns
    -------
    sweep_poly : ndarray
        A numpy array containing the signal evaluated at `t` with the
        requested time-varying frequency.  More precisely, the function
        returns ``cos(phase + (pi/180)*phi)``, where `phase` is the integral
        (from 0 to t) of ``2 * pi * f(t)``; ``f(t)`` is defined above.

    See Also
    --------
    chirp

    Notes
    -----
    .. versionadded:: 0.8.0

    If `poly` is a list or ndarray of length `n`, then the elements of
    `poly` are the coefficients of the polynomial, and the instantaneous
    frequency is:

        ``f(t) = poly[0]*t**(n-1) + poly[1]*t**(n-2) + ... + poly[n-1]``

    If `poly` is an instance of `numpy.poly1d`, then the instantaneous
    frequency is:

          ``f(t) = poly(t)``

    Finally, the output `s` is:

        ``cos(phase + (pi/180)*phi)``

    where `phase` is the integral from 0 to `t` of ``2 * pi * f(t)``,
    ``f(t)`` as defined above.

    Examples
    --------
    Compute the waveform with instantaneous frequency::

        f(t) = 0.025*t**3 - 0.36*t**2 + 1.25*t + 2

    over the interval 0 <= t <= 10.

    >>> import numpy as np
    >>> from scipy.signal import sweep_poly
    >>> p = np.poly1d([0.025, -0.36, 1.25, 2.0])
    >>> t = np.linspace(0, 10, 5001)
    >>> w = sweep_poly(t, p)

    Plot it:

    >>> import matplotlib.pyplot as plt
    >>> plt.subplot(2, 1, 1)
    >>> plt.plot(t, w)
    >>> plt.title("Sweep Poly\\nwith frequency " +
    ...           "$f(t) = 0.025t^3 - 0.36t^2 + 1.25t + 2$")
    >>> plt.subplot(2, 1, 2)
    >>> plt.plot(t, p(t), 'r', label='f(t)')
    >>> plt.legend()
    >>> plt.xlabel('t')
    >>> plt.tight_layout()
    >>> plt.show()

    """
    # 'phase' is computed in _sweep_poly_phase, to make testing easier.
    phase = _sweep_poly_phase(t, poly)
    # Convert to radians.
    phi *= pi / 180
    return cos(phase + phi)


def _sweep_poly_phase(t, poly):
    """
    Calculate the phase used by sweep_poly to generate its output.

    See `sweep_poly` for a description of the arguments.

    """
    # polyint handles lists, ndarrays and instances of poly1d automatically.
    intpoly = polyint(poly)
    phase = 2 * pi * polyval(intpoly, t)
    return phase


def unit_impulse(shape, idx=None, dtype=float):
    r"""
    Unit impulse signal (discrete delta function) or unit basis vector.

    Parameters
    ----------
    shape : int or tuple of int
        Number of samples in the output (1-D), or a tuple that represents the
        shape of the output (N-D).
    idx : None or int or tuple of int or 'mid', optional
        Index at which the value is 1.  If None, defaults to the 0th element.
        If ``idx='mid'``, the impulse will be centered at ``shape // 2`` in
        all dimensions.  If an int, the impulse will be at `idx` in all
        dimensions.
    dtype : data-type, optional
        The desired data-type for the array, e.g., ``numpy.int8``.  Default is
        ``numpy.float64``.

    Returns
    -------
    y : ndarray
        Output array containing an impulse signal.

    Notes
    -----
    In digital signal processing literature the unit impulse signal is often
    represented by the Kronecker delta. [1]_ I.e., a signal :math:`u_k[n]`,
    which is zero everywhere except being one at the :math:`k`-th sample,
    can be expressed as

    .. math::

        u_k[n] = \delta[n-k] \equiv \delta_{n,k}\ .

    Furthermore, the unit impulse is frequently interpreted as the discrete-time
    version of the continuous-time Dirac distribution. [2]_

    References
    ----------
    .. [1] "Kronecker delta", *Wikipedia*,
           https://en.wikipedia.org/wiki/Kronecker_delta#Digital_signal_processing
    .. [2] "Dirac delta function" *Wikipedia*,
           https://en.wikipedia.org/wiki/Dirac_delta_function#Relationship_to_the_Kronecker_delta

    .. versionadded:: 0.19.0

    Examples
    --------
    An impulse at the 0th element (:math:`\\delta[n]`):

    >>> from scipy import signal
    >>> signal.unit_impulse(8)
    array([ 1.,  0.,  0.,  0.,  0.,  0.,  0.,  0.])

    Impulse offset by 2 samples (:math:`\\delta[n-2]`):

    >>> signal.unit_impulse(7, 2)
    array([ 0.,  0.,  1.,  0.,  0.,  0.,  0.])

    2-dimensional impulse, centered:

    >>> signal.unit_impulse((3, 3), 'mid')
    array([[ 0.,  0.,  0.],
           [ 0.,  1.,  0.],
           [ 0.,  0.,  0.]])

    Impulse at (2, 2), using broadcasting:

    >>> signal.unit_impulse((4, 4), 2)
    array([[ 0.,  0.,  0.,  0.],
           [ 0.,  0.,  0.,  0.],
           [ 0.,  0.,  1.,  0.],
           [ 0.,  0.,  0.,  0.]])

    Plot the impulse response of a 4th-order Butterworth lowpass filter:

    >>> imp = signal.unit_impulse(100, 'mid')
    >>> b, a = signal.butter(4, 0.2)
    >>> response = signal.lfilter(b, a, imp)

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> plt.plot(np.arange(-50, 50), imp)
    >>> plt.plot(np.arange(-50, 50), response)
    >>> plt.margins(0.1, 0.1)
    >>> plt.xlabel('Time [samples]')
    >>> plt.ylabel('Amplitude')
    >>> plt.grid(True)
    >>> plt.show()

    """
    out = zeros(shape, dtype)

    shape = np.atleast_1d(shape)

    if idx is None:
        idx = (0,) * len(shape)
    elif idx == 'mid':
        idx = tuple(shape // 2)
    elif not hasattr(idx, "__iter__"):
        idx = (idx,) * len(shape)

    out[idx] = 1
    return out
