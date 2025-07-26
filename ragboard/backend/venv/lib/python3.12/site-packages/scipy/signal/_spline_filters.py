import math

from numpy import (zeros_like, array, tan, arange, floor,
                   r_, atleast_1d, greater, cos, add, sin,
                   moveaxis, abs, complex64, float32)
import numpy as np

from scipy._lib._array_api import array_namespace, xp_promote

from scipy._lib._util import normalize_axis_index

# From splinemodule.c
from ._spline import sepfir2d, symiirorder1_ic, symiirorder2_ic_fwd, symiirorder2_ic_bwd
from ._signaltools import lfilter, sosfilt, lfiltic
from ._arraytools import axis_slice, axis_reverse

from scipy.interpolate import BSpline


__all__ = ['spline_filter', 'gauss_spline',
           'cspline1d', 'qspline1d', 'qspline2d', 'cspline2d',
           'cspline1d_eval', 'qspline1d_eval', 'symiirorder1', 'symiirorder2']


def spline_filter(Iin, lmbda=5.0):
    """Smoothing spline (cubic) filtering of a rank-2 array.

    Filter an input data set, `Iin`, using a (cubic) smoothing spline of
    fall-off `lmbda`.

    Parameters
    ----------
    Iin : array_like
        input data set
    lmbda : float, optional
        spline smoothing fall-off value, default is `5.0`.

    Returns
    -------
    res : ndarray
        filtered input data

    Examples
    --------
    We can filter an multi dimensional signal (ex: 2D image) using cubic
    B-spline filter:

    >>> import numpy as np
    >>> from scipy.signal import spline_filter
    >>> import matplotlib.pyplot as plt
    >>> orig_img = np.eye(20)  # create an image
    >>> orig_img[10, :] = 1.0
    >>> sp_filter = spline_filter(orig_img, lmbda=0.1)
    >>> f, ax = plt.subplots(1, 2, sharex=True)
    >>> for ind, data in enumerate([[orig_img, "original image"],
    ...                             [sp_filter, "spline filter"]]):
    ...     ax[ind].imshow(data[0], cmap='gray_r')
    ...     ax[ind].set_title(data[1])
    >>> plt.tight_layout()
    >>> plt.show()

    """
    xp = array_namespace(Iin)
    Iin = np.asarray(Iin)

    if Iin.dtype not in [np.float32, np.float64, np.complex64, np.complex128]:
        raise TypeError(f"Invalid data type for Iin: {Iin.dtype = }")

    # XXX: note that complex-valued computations are done in single precision
    # this is historic, and the root reason is unclear,
    # see https://github.com/scipy/scipy/issues/9209
    # Attempting to work in complex double precision leads to symiirorder1
    # failing to converge for the boundary conditions.
    intype = Iin.dtype
    hcol = array([1.0, 4.0, 1.0], np.float32) / 6.0
    if intype == np.complex128:
        Iin = Iin.astype(np.complex64)

    ck = cspline2d(Iin, lmbda)
    out = sepfir2d(ck, hcol, hcol)
    out = out.astype(intype)
    return xp.asarray(out)


_splinefunc_cache = {}


def gauss_spline(x, n):
    r"""Gaussian approximation to B-spline basis function of order n.

    Parameters
    ----------
    x : array_like
        a knot vector
    n : int
        The order of the spline. Must be non-negative, i.e., n >= 0

    Returns
    -------
    res : ndarray
        B-spline basis function values approximated by a zero-mean Gaussian
        function.

    Notes
    -----
    The B-spline basis function can be approximated well by a zero-mean
    Gaussian function with standard-deviation equal to :math:`\sigma=(n+1)/12`
    for large `n` :

    .. math::  \frac{1}{\sqrt {2\pi\sigma^2}}exp(-\frac{x^2}{2\sigma})

    References
    ----------
    .. [1] Bouma H., Vilanova A., Bescos J.O., ter Haar Romeny B.M., Gerritsen
       F.A. (2007) Fast and Accurate Gaussian Derivatives Based on B-Splines. In:
       Sgallari F., Murli A., Paragios N. (eds) Scale Space and Variational
       Methods in Computer Vision. SSVM 2007. Lecture Notes in Computer
       Science, vol 4485. Springer, Berlin, Heidelberg
    .. [2] http://folk.uio.no/inf3330/scripting/doc/python/SciPy/tutorial/old/node24.html

    Examples
    --------
    We can calculate B-Spline basis functions approximated by a gaussian
    distribution:

    >>> import numpy as np
    >>> from scipy.signal import gauss_spline
    >>> knots = np.array([-1.0, 0.0, -1.0])
    >>> gauss_spline(knots, 3)
    array([0.15418033, 0.6909883, 0.15418033])  # may vary

    """
    xp = array_namespace(x)
    x = xp.asarray(x)
    signsq = (n + 1) / 12.0
    return 1 / math.sqrt(2 * math.pi * signsq) * xp.exp(-x ** 2 / 2 / signsq)


def _cubic(x):
    xp = array_namespace(x)

    x = np.asarray(x, dtype=float)
    b = BSpline.basis_element([-2, -1, 0, 1, 2], extrapolate=False)
    out = b(x)
    out[(x < -2) | (x > 2)] = 0
    return xp.asarray(out)


def _quadratic(x):
    xp = array_namespace(x)

    x = abs(np.asarray(x, dtype=float))
    b = BSpline.basis_element([-1.5, -0.5, 0.5, 1.5], extrapolate=False)
    out = b(x)
    out[(x < -1.5) | (x > 1.5)] = 0
    return xp.asarray(out)


def _coeff_smooth(lam):
    xi = 1 - 96 * lam + 24 * lam * math.sqrt(3 + 144 * lam)
    omeg = math.atan2(math.sqrt(144 * lam - 1), math.sqrt(xi))
    rho = (24 * lam - 1 - math.sqrt(xi)) / (24 * lam)
    rho = rho * math.sqrt((48 * lam + 24 * lam * math.sqrt(3 + 144 * lam)) / xi)
    return rho, omeg


def _hc(k, cs, rho, omega):
    return (cs / sin(omega) * (rho ** k) * sin(omega * (k + 1)) *
            greater(k, -1))


def _hs(k, cs, rho, omega):
    c0 = (cs * cs * (1 + rho * rho) / (1 - rho * rho) /
          (1 - 2 * rho * rho * cos(2 * omega) + rho ** 4))
    gamma = (1 - rho * rho) / (1 + rho * rho) / tan(omega)
    ak = abs(k)
    return c0 * rho ** ak * (cos(omega * ak) + gamma * sin(omega * ak))


def _cubic_smooth_coeff(signal, lamb):
    signal = np.asarray(signal)

    rho, omega = _coeff_smooth(lamb)
    cs = 1 - 2 * rho * cos(omega) + rho * rho
    K = len(signal)
    k = arange(K)

    zi_2 = (_hc(0, cs, rho, omega) * signal[0] +
            add.reduce(_hc(k + 1, cs, rho, omega) * signal))
    zi_1 = (_hc(0, cs, rho, omega) * signal[0] +
            _hc(1, cs, rho, omega) * signal[1] +
            add.reduce(_hc(k + 2, cs, rho, omega) * signal))

    # Forward filter:
    # for n in range(2, K):
    #     yp[n] = (cs * signal[n] + 2 * rho * cos(omega) * yp[n - 1] -
    #              rho * rho * yp[n - 2])
    zi = lfiltic(cs, r_[1, -2 * rho * cos(omega), rho * rho], r_[zi_1, zi_2])
    zi = zi.reshape(1, -1)

    sos = r_[cs, 0, 0, 1, -2 * rho * cos(omega), rho * rho]
    sos = sos.reshape(1, -1)

    yp, _ = sosfilt(sos, signal[2:], zi=zi)
    yp = r_[zi_2, zi_1, yp]

    # Reverse filter:
    # for n in range(K - 3, -1, -1):
    #     y[n] = (cs * yp[n] + 2 * rho * cos(omega) * y[n + 1] -
    #             rho * rho * y[n + 2])

    zi_2 = add.reduce((_hs(k, cs, rho, omega) +
                       _hs(k + 1, cs, rho, omega)) * signal[::-1])
    zi_1 = add.reduce((_hs(k - 1, cs, rho, omega) +
                       _hs(k + 2, cs, rho, omega)) * signal[::-1])

    zi = lfiltic(cs, r_[1, -2 * rho * cos(omega), rho * rho], r_[zi_1, zi_2])
    zi = zi.reshape(1, -1)
    y, _ = sosfilt(sos, yp[-3::-1], zi=zi)
    y = r_[y[::-1], zi_1, zi_2]
    return y


def _cubic_coeff(signal):
    signal = np.asarray(signal)

    zi = -2 + math.sqrt(3)
    K = len(signal)
    powers = zi ** np.arange(K)

    if K == 1:
        yplus = signal[0] + zi * add.reduce(powers * signal)
        output = zi / (zi - 1) * yplus
        return atleast_1d(output)

    # Forward filter:
    # yplus[0] = signal[0] + zi * add.reduce(powers * signal)
    # for k in range(1, K):
    #     yplus[k] = signal[k] + zi * yplus[k - 1]

    state = lfiltic(1, np.r_[1, -zi], np.atleast_1d(add.reduce(powers * signal)))

    b = np.ones(1)
    a = np.r_[1, -zi]
    yplus, _ = lfilter(b, a, signal, zi=state)

    # Reverse filter:
    # output[K - 1] = zi / (zi - 1) * yplus[K - 1]
    # for k in range(K - 2, -1, -1):
    #     output[k] = zi * (output[k + 1] - yplus[k])
    out_last = zi / (zi - 1) * yplus[K - 1]
    state = lfiltic(-zi, r_[1, -zi], np.atleast_1d(out_last))

    b = np.asarray([-zi])
    output, _ = lfilter(b, a, yplus[-2::-1], zi=state)
    output = np.r_[output[::-1], out_last]
    return output * 6.0


def _quadratic_coeff(signal):
    signal = np.asarray(signal)

    zi = -3 + 2 * math.sqrt(2.0)
    K = len(signal)
    powers = zi ** np.arange(K)

    if K == 1:
        yplus = signal[0] + zi * np.add.reduce(powers * signal)
        output = zi / (zi - 1) * yplus
        return atleast_1d(output)

    # Forward filter:
    # yplus[0] = signal[0] + zi * add.reduce(powers * signal)
    # for k in range(1, K):
    #     yplus[k] = signal[k] + zi * yplus[k - 1]

    state = lfiltic(1, np.r_[1, -zi], np.atleast_1d(np.add.reduce(powers * signal)))

    b = np.ones(1)
    a = np.r_[1, -zi]
    yplus, _ = lfilter(b, a, signal, zi=state)

    # Reverse filter:
    # output[K - 1] = zi / (zi - 1) * yplus[K - 1]
    # for k in range(K - 2, -1, -1):
    #     output[k] = zi * (output[k + 1] - yplus[k])
    out_last = zi / (zi - 1) * yplus[K - 1]
    state = lfiltic(-zi, r_[1, -zi], np.atleast_1d(out_last))

    b = np.asarray([-zi])
    output, _ = lfilter(b, a, yplus[-2::-1], zi=state)
    output = np.r_[output[::-1], out_last]
    return output * 8.0


def compute_root_from_lambda(lamb):
    tmp = math.sqrt(3 + 144 * lamb)
    xi = 1 - 96 * lamb + 24 * lamb * tmp
    omega = math.atan(math.sqrt((144 * lamb - 1.0) / xi))
    tmp2 = math.sqrt(xi)
    r = ((24 * lamb - 1 - tmp2) / (24 * lamb) *
         math.sqrt(48*lamb + 24 * lamb * tmp) / tmp2)
    return r, omega


def cspline1d(signal, lamb=0.0):
    """
    Compute cubic spline coefficients for rank-1 array.

    Find the cubic spline coefficients for a 1-D signal assuming
    mirror-symmetric boundary conditions. To obtain the signal back from the
    spline representation mirror-symmetric-convolve these coefficients with a
    length 3 FIR window [1.0, 4.0, 1.0]/ 6.0 .

    Parameters
    ----------
    signal : ndarray
        A rank-1 array representing samples of a signal.
    lamb : float, optional
        Smoothing coefficient, default is 0.0.

    Returns
    -------
    c : ndarray
        Cubic spline coefficients.

    See Also
    --------
    cspline1d_eval : Evaluate a cubic spline at the new set of points.

    Examples
    --------
    We can filter a signal to reduce and smooth out high-frequency noise with
    a cubic spline:

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy.signal import cspline1d, cspline1d_eval
    >>> rng = np.random.default_rng()
    >>> sig = np.repeat([0., 1., 0.], 100)
    >>> sig += rng.standard_normal(len(sig))*0.05  # add noise
    >>> time = np.linspace(0, len(sig))
    >>> filtered = cspline1d_eval(cspline1d(sig), time)
    >>> plt.plot(sig, label="signal")
    >>> plt.plot(time, filtered, label="filtered")
    >>> plt.legend()
    >>> plt.show()

    """
    xp = array_namespace(signal)

    if lamb != 0.0:
        ret = _cubic_smooth_coeff(signal, lamb)
    else:
        ret = _cubic_coeff(signal)
    return xp.asarray(ret)


def qspline1d(signal, lamb=0.0):
    """Compute quadratic spline coefficients for rank-1 array.

    Parameters
    ----------
    signal : ndarray
        A rank-1 array representing samples of a signal.
    lamb : float, optional
        Smoothing coefficient (must be zero for now).

    Returns
    -------
    c : ndarray
        Quadratic spline coefficients.

    See Also
    --------
    qspline1d_eval : Evaluate a quadratic spline at the new set of points.

    Notes
    -----
    Find the quadratic spline coefficients for a 1-D signal assuming
    mirror-symmetric boundary conditions. To obtain the signal back from the
    spline representation mirror-symmetric-convolve these coefficients with a
    length 3 FIR window [1.0, 6.0, 1.0]/ 8.0 .

    Examples
    --------
    We can filter a signal to reduce and smooth out high-frequency noise with
    a quadratic spline:

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy.signal import qspline1d, qspline1d_eval
    >>> rng = np.random.default_rng()
    >>> sig = np.repeat([0., 1., 0.], 100)
    >>> sig += rng.standard_normal(len(sig))*0.05  # add noise
    >>> time = np.linspace(0, len(sig))
    >>> filtered = qspline1d_eval(qspline1d(sig), time)
    >>> plt.plot(sig, label="signal")
    >>> plt.plot(time, filtered, label="filtered")
    >>> plt.legend()
    >>> plt.show()

    """
    xp = array_namespace(signal)

    if lamb != 0.0:
        raise ValueError("Smoothing quadratic splines not supported yet.")
    else:
        return xp.asarray(_quadratic_coeff(signal))


def collapse_2d(x, axis):
    x = moveaxis(x, axis, -1)
    x_shape = x.shape
    x = x.reshape(-1, x.shape[-1])
    if not x.flags.c_contiguous:
        x = x.copy()
    return x, x_shape


def symiirorder_nd(func, input, *args, axis=-1, **kwargs):
    axis = normalize_axis_index(axis, input.ndim)
    input_shape = input.shape
    input_ndim = input.ndim
    if input.ndim > 1:
        input, input_shape = collapse_2d(input, axis)

    out = func(input, *args, **kwargs)

    if input_ndim > 1:
        out = out.reshape(input_shape)
        out = moveaxis(out, -1, axis)
        if not out.flags.c_contiguous:
            out = out.copy()
    return out


def qspline2d(signal, lamb=0.0, precision=-1.0):
    """
    Coefficients for 2-D quadratic (2nd order) B-spline.

    Return the second-order B-spline coefficients over a regularly spaced
    input grid for the two-dimensional input image.

    Parameters
    ----------
    input : ndarray
        The input signal.
    lamb : float
        Specifies the amount of smoothing in the transfer function.
    precision : float
        Specifies the precision for computing the infinite sum needed to apply
        mirror-symmetric boundary conditions.

    Returns
    -------
    output : ndarray
        The filtered signal.
    """
    if precision < 0.0 or precision >= 1.0:
        if signal.dtype in [float32, complex64]:
            precision = 1e-3
        else:
            precision = 1e-6

    if lamb > 0:
        raise ValueError('lambda must be negative or zero')

    # normal quadratic spline
    r = -3 + 2 * math.sqrt(2.0)
    c0 = -r * 8.0
    z1 = r

    out = symiirorder_nd(symiirorder1, signal, c0, z1, precision, axis=-1)
    out = symiirorder_nd(symiirorder1, out, c0, z1, precision, axis=0)
    return out


def cspline2d(signal, lamb=0.0, precision=-1.0):
    """
    Coefficients for 2-D cubic (3rd order) B-spline.

    Return the third-order B-spline coefficients over a regularly spaced
    input grid for the two-dimensional input image.

    Parameters
    ----------
    input : ndarray
        The input signal.
    lamb : float
        Specifies the amount of smoothing in the transfer function.
    precision : float
        Specifies the precision for computing the infinite sum needed to apply
        mirror-symmetric boundary conditions.

    Returns
    -------
    output : ndarray
        The filtered signal.
    """
    xp = array_namespace(signal)
    signal = np.asarray(signal)

    if precision < 0.0 or precision >= 1.0:
        if signal.dtype in [np.float32, np.complex64]:
            precision = 1e-3
        else:
            precision = 1e-6

    if lamb <= 1 / 144.0:
        # Normal cubic spline
        r = -2 + math.sqrt(3.0)
        out = symiirorder_nd(
            symiirorder1, signal, -r * 6.0, r, precision=precision, axis=-1)
        out = symiirorder_nd(
            symiirorder1, out, -r * 6.0, r, precision=precision, axis=0)
        return out

    r, omega = compute_root_from_lambda(lamb)
    out = symiirorder_nd(symiirorder2, signal, r, omega,
                         precision=precision, axis=-1)
    out = symiirorder_nd(symiirorder2, out, r, omega,
                         precision=precision, axis=0)
    return xp.asarray(out)


def cspline1d_eval(cj, newx, dx=1.0, x0=0):
    """Evaluate a cubic spline at the new set of points.

    `dx` is the old sample-spacing while `x0` was the old origin. In
    other-words the old-sample points (knot-points) for which the `cj`
    represent spline coefficients were at equally-spaced points of:

      oldx = x0 + j*dx  j=0...N-1, with N=len(cj)

    Edges are handled using mirror-symmetric boundary conditions.

    Parameters
    ----------
    cj : ndarray
        cublic spline coefficients
    newx : ndarray
        New set of points.
    dx : float, optional
        Old sample-spacing, the default value is 1.0.
    x0 : int, optional
        Old origin, the default value is 0.

    Returns
    -------
    res : ndarray
        Evaluated a cubic spline points.

    See Also
    --------
    cspline1d : Compute cubic spline coefficients for rank-1 array.

    Examples
    --------
    We can filter a signal to reduce and smooth out high-frequency noise with
    a cubic spline:

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy.signal import cspline1d, cspline1d_eval
    >>> rng = np.random.default_rng()
    >>> sig = np.repeat([0., 1., 0.], 100)
    >>> sig += rng.standard_normal(len(sig))*0.05  # add noise
    >>> time = np.linspace(0, len(sig))
    >>> filtered = cspline1d_eval(cspline1d(sig), time)
    >>> plt.plot(sig, label="signal")
    >>> plt.plot(time, filtered, label="filtered")
    >>> plt.legend()
    >>> plt.show()

    """
    xp = array_namespace(cj, newx)

    newx = (np.asarray(newx) - x0) / float(dx)
    cj = np.asarray(cj)

    if cj.size == 0:
        raise ValueError("Spline coefficients 'cj' must not be empty.")

    res = zeros_like(newx, dtype=cj.dtype)
    if res.size == 0:
        return xp.asarray(res)
    N = len(cj)
    cond1 = newx < 0
    cond2 = newx > (N - 1)
    cond3 = ~(cond1 | cond2)
    # handle general mirror-symmetry
    res[cond1] = cspline1d_eval(cj, -newx[cond1])
    res[cond2] = cspline1d_eval(cj, 2 * (N - 1) - newx[cond2])
    newx = newx[cond3]
    if newx.size == 0:
        return xp.asarray(res)
    result = zeros_like(newx, dtype=cj.dtype)
    jlower = floor(newx - 2).astype(int) + 1
    for i in range(4):
        thisj = jlower + i
        indj = thisj.clip(0, N - 1)  # handle edge cases
        result += cj[indj] * _cubic(newx - thisj)
    res[cond3] = result
    return xp.asarray(res)


def qspline1d_eval(cj, newx, dx=1.0, x0=0):
    """Evaluate a quadratic spline at the new set of points.

    Parameters
    ----------
    cj : ndarray
        Quadratic spline coefficients
    newx : ndarray
        New set of points.
    dx : float, optional
        Old sample-spacing, the default value is 1.0.
    x0 : int, optional
        Old origin, the default value is 0.

    Returns
    -------
    res : ndarray
        Evaluated a quadratic spline points.

    See Also
    --------
    qspline1d : Compute quadratic spline coefficients for rank-1 array.

    Notes
    -----
    `dx` is the old sample-spacing while `x0` was the old origin. In
    other-words the old-sample points (knot-points) for which the `cj`
    represent spline coefficients were at equally-spaced points of::

      oldx = x0 + j*dx  j=0...N-1, with N=len(cj)

    Edges are handled using mirror-symmetric boundary conditions.

    Examples
    --------
    We can filter a signal to reduce and smooth out high-frequency noise with
    a quadratic spline:

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy.signal import qspline1d, qspline1d_eval
    >>> rng = np.random.default_rng()
    >>> sig = np.repeat([0., 1., 0.], 100)
    >>> sig += rng.standard_normal(len(sig))*0.05  # add noise
    >>> time = np.linspace(0, len(sig))
    >>> filtered = qspline1d_eval(qspline1d(sig), time)
    >>> plt.plot(sig, label="signal")
    >>> plt.plot(time, filtered, label="filtered")
    >>> plt.legend()
    >>> plt.show()

    """
    xp = array_namespace(newx, cj)

    newx = (np.asarray(newx) - x0) / dx
    res = np.zeros_like(newx)
    if res.size == 0:
        return xp.asarray(res)

    cj = np.asarray(cj)
    if cj.size == 0:
        raise ValueError("Spline coefficients 'cj' must not be empty.")
    
    N = len(cj)
    cond1 = newx < 0
    cond2 = newx > (N - 1)
    cond3 = ~(cond1 | cond2)
    # handle general mirror-symmetry
    res[cond1] = qspline1d_eval(cj, -newx[cond1])
    res[cond2] = qspline1d_eval(cj, 2 * (N - 1) - newx[cond2])
    newx = newx[cond3]
    if newx.size == 0:
        return xp.asarray(res)
    result = zeros_like(newx)
    jlower = floor(newx - 1.5).astype(int) + 1
    for i in range(3):
        thisj = jlower + i
        indj = thisj.clip(0, N - 1)  # handle edge cases
        result += cj[indj] * _quadratic(newx - thisj)
    res[cond3] = result
    return xp.asarray(res)


def symiirorder1(signal, c0, z1, precision=-1.0):
    """
    Implement a smoothing IIR filter with mirror-symmetric boundary conditions
    using a cascade of first-order sections.

    The second section uses a reversed sequence.  This implements a system with
    the following transfer function and mirror-symmetric boundary conditions::

                           c0
           H(z) = ---------------------
                   (1-z1/z) (1 - z1 z)

    The resulting signal will have mirror symmetric boundary conditions
    as well.

    Parameters
    ----------
    signal : ndarray
        The input signal. If 2D, then the filter will be applied in a batched
        fashion across the last axis.
    c0, z1 : scalar
        Parameters in the transfer function.
    precision :
        Specifies the precision for calculating initial conditions
        of the recursive filter based on mirror-symmetric input.

    Returns
    -------
    output : ndarray
        The filtered signal.
    """
    xp = array_namespace(signal)
    signal = xp_promote(signal, force_floating=True, xp=xp)
    # This function uses C internals
    signal = np.asarray(signal)

    if abs(z1) >= 1:
        raise ValueError('|z1| must be less than 1.0')

    if signal.ndim > 2:
        raise ValueError('Input must be 1D or 2D')

    squeeze_dim = False
    if signal.ndim == 1:
        signal = signal[None, :]
        squeeze_dim = True

    y0 = symiirorder1_ic(signal, z1, precision)

    # Apply first the system 1 / (1 - z1 * z^-1)
    b = np.ones(1, dtype=signal.dtype)
    a = np.r_[1, -z1]
    a = a.astype(signal.dtype)

    # Compute the initial state for lfilter.
    zii = y0 * z1

    y1, _ = lfilter(b, a, axis_slice(signal, 1), zi=zii)
    y1 = np.c_[y0, y1]

    # Compute backward symmetric condition and apply the system
    # c0 / (1 - z1 * z)
    b = np.asarray([c0], dtype=signal.dtype)
    out_last = -c0 / (z1 - 1.0) * axis_slice(y1, -1)

    # Compute the initial state for lfilter.
    zii = out_last * z1

    # Apply the system c0 / (1 - z1 * z) by reversing the output of the previous stage
    out, _ = lfilter(b, a, axis_slice(y1, -2, step=-1), zi=zii)
    out = np.c_[axis_reverse(out), out_last]

    if squeeze_dim:
        out = out[0]

    return xp.asarray(out)


def symiirorder2(input, r, omega, precision=-1.0):
    """
    Implement a smoothing IIR filter with mirror-symmetric boundary conditions
    using a cascade of second-order sections.

    The second section uses a reversed sequence.  This implements the following
    transfer function::

                                  cs^2
         H(z) = ---------------------------------------
                (1 - a2/z - a3/z^2) (1 - a2 z - a3 z^2 )

    where::

          a2 = 2 * r * cos(omega)
          a3 = - r ** 2
          cs = 1 - 2 * r * cos(omega) + r ** 2

    Parameters
    ----------
    input : ndarray
        The input signal.
    r, omega : float
        Parameters in the transfer function.
    precision : float
        Specifies the precision for calculating initial conditions
        of the recursive filter based on mirror-symmetric input.

    Returns
    -------
    output : ndarray
        The filtered signal.
    """
    xp = array_namespace(input)
    input = xp_promote(input, force_floating=True, xp=xp)
    # This function uses C internals
    input = np.ascontiguousarray(input)

    if r >= 1.0:
        raise ValueError('r must be less than 1.0')

    if input.ndim > 2:
        raise ValueError('Input must be 1D or 2D')

    squeeze_dim = False
    if input.ndim == 1:
        input = input[None, :]
        squeeze_dim = True

    rsq = r * r
    a2 = 2 * r * math.cos(omega)
    a3 = -rsq
    cs = 1 - 2 * r * math.cos(omega) + rsq
    sos = np.asarray([cs, 0, 0, 1, -a2, -a3], dtype=input.dtype)

    # Find the starting (forward) conditions.
    ic_fwd = symiirorder2_ic_fwd(input, r, omega, precision)

    # Apply first the system cs / (1 - a2 * z^-1 - a3 * z^-2)
    # Compute the initial conditions in the form expected by sosfilt
    # coef = np.asarray([[a3, a2], [0, a3]], dtype=input.dtype)
    coef = np.asarray([[a3, a2], [0, a3]], dtype=input.dtype)
    zi = np.matmul(coef, ic_fwd[:, :, None])[:, :, 0]

    y_fwd, _ = sosfilt(sos, axis_slice(input, 2), zi=zi[None])
    y_fwd = np.c_[ic_fwd, y_fwd]

    # Then compute the symmetric backward starting conditions
    ic_bwd = symiirorder2_ic_bwd(input, r, omega, precision)

    # Apply the system cs / (1 - a2 * z^1 - a3 * z^2)
    # Compute the initial conditions in the form expected by sosfilt
    zi = np.matmul(coef, ic_bwd[:, :, None])[:, :, 0]
    y, _ = sosfilt(sos, axis_slice(y_fwd, -3, step=-1), zi=zi[None])
    out = np.c_[axis_reverse(y), axis_reverse(ic_bwd)]

    if squeeze_dim:
        out = out[0]

    return xp.asarray(out)
