# Author: Travis Oliphant
# 1999 -- 2002

from __future__ import annotations  # Provides typing union operator `|` in Python 3.9
import operator
import math
from math import prod as _prod
import timeit
import warnings
from typing import Literal

from numpy._typing import ArrayLike

from scipy.spatial import cKDTree
from . import _sigtools
from ._ltisys import dlti
from ._upfirdn import upfirdn, _output_len, _upfirdn_modes
from scipy import linalg, fft as sp_fft
from scipy import ndimage
from scipy.fft._helper import _init_nd_shape_and_axes
import numpy as np
from scipy.special import lambertw
from .windows import get_window
from ._arraytools import axis_slice, axis_reverse, odd_ext, even_ext, const_ext
from ._filter_design import cheby1, _validate_sos, zpk2sos
from ._fir_filter_design import firwin
from ._sosfilt import _sosfilt

from scipy._lib._array_api import (
    array_namespace, is_torch, is_numpy, xp_copy, xp_size, xp_default_dtype

)
from scipy._lib.array_api_compat import is_array_api_obj
import scipy._lib.array_api_compat.numpy as np_compat
import scipy._lib.array_api_extra as xpx


__all__ = ['correlate', 'correlation_lags', 'correlate2d',
           'convolve', 'convolve2d', 'fftconvolve', 'oaconvolve',
           'order_filter', 'medfilt', 'medfilt2d', 'wiener', 'lfilter',
           'lfiltic', 'sosfilt', 'deconvolve', 'hilbert', 'hilbert2', 'envelope',
           'unique_roots', 'invres', 'invresz', 'residue',
           'residuez', 'resample', 'resample_poly', 'detrend',
           'lfilter_zi', 'sosfilt_zi', 'sosfiltfilt', 'choose_conv_method',
           'filtfilt', 'decimate', 'vectorstrength']


_modedict = {'valid': 0, 'same': 1, 'full': 2}

_boundarydict = {'fill': 0, 'pad': 0, 'wrap': 2, 'circular': 2, 'symm': 1,
                 'symmetric': 1, 'reflect': 4}


def _valfrommode(mode):
    try:
        return _modedict[mode]
    except KeyError as e:
        raise ValueError("Acceptable mode flags are 'valid',"
                         " 'same', or 'full'.") from e


def _bvalfromboundary(boundary):
    try:
        return _boundarydict[boundary] << 2
    except KeyError as e:
        raise ValueError("Acceptable boundary flags are 'fill', 'circular' "
                         "(or 'wrap'), and 'symmetric' (or 'symm').") from e


def _inputs_swap_needed(mode, shape1, shape2, axes=None):
    """Determine if inputs arrays need to be swapped in `"valid"` mode.

    If in `"valid"` mode, returns whether or not the input arrays need to be
    swapped depending on whether `shape1` is at least as large as `shape2` in
    every calculated dimension.

    This is important for some of the correlation and convolution
    implementations in this module, where the larger array input needs to come
    before the smaller array input when operating in this mode.

    Note that if the mode provided is not 'valid', False is immediately
    returned.

    """
    if mode != 'valid':
        return False

    if not shape1:
        return False

    if axes is None:
        axes = range(len(shape1))

    ok1 = all(shape1[i] >= shape2[i] for i in axes)
    ok2 = all(shape2[i] >= shape1[i] for i in axes)

    if not (ok1 or ok2):
        raise ValueError("For 'valid' mode, one must be at least "
                         "as large as the other in every dimension")

    return not ok1


def _reject_objects(arr, name):
    """Warn if arr.dtype is object or longdouble.
    """
    dt = np.asarray(arr).dtype
    if not (np.issubdtype(dt, np.integer)
            or dt in [np.bool_, np.float16, np.float32, np.float64,
                      np.complex64, np.complex128]
    ):
        msg = (
            f"dtype={dt} is not supported by {name} and will raise an error in "
            f"SciPy 1.17.0. Supported dtypes are: boolean, integer, `np.float16`,"
            f"`np.float32`, `np.float64`, `np.complex64`, `np.complex128`."
        )
        warnings.warn(msg, category=DeprecationWarning, stacklevel=3)


def correlate(in1, in2, mode='full', method='auto'):
    r"""
    Cross-correlate two N-dimensional arrays.

    Cross-correlate `in1` and `in2`, with the output size determined by the
    `mode` argument.

    Parameters
    ----------
    in1 : array_like
        First input.
    in2 : array_like
        Second input. Should have the same number of dimensions as `in1`.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output:

        ``full``
           The output is the full discrete linear cross-correlation
           of the inputs. (Default)
        ``valid``
           The output consists only of those elements that do not
           rely on the zero-padding. In 'valid' mode, either `in1` or `in2`
           must be at least as large as the other in every dimension.
        ``same``
           The output is the same size as `in1`, centered
           with respect to the 'full' output.
    method : str {'auto', 'direct', 'fft'}, optional
        A string indicating which method to use to calculate the correlation.

        ``direct``
           The correlation is determined directly from sums, the definition of
           correlation.
        ``fft``
           The Fast Fourier Transform is used to perform the correlation more
           quickly (only available for numerical arrays.)
        ``auto``
           Automatically chooses direct or Fourier method based on an estimate
           of which is faster (default).  See `convolve` Notes for more detail.

           .. versionadded:: 0.19.0

    Returns
    -------
    correlate : array
        An N-dimensional array containing a subset of the discrete linear
        cross-correlation of `in1` with `in2`.

    See Also
    --------
    choose_conv_method : contains more documentation on `method`.
    correlation_lags : calculates the lag / displacement indices array for 1D
        cross-correlation.

    Notes
    -----
    The correlation z of two d-dimensional arrays x and y is defined as::

        z[...,k,...] = sum[..., i_l, ...] x[..., i_l,...] * conj(y[..., i_l - k,...])

    This way, if ``x`` and ``y`` are 1-D arrays and ``z = correlate(x, y, 'full')``
    then

    .. math::

          z[k] = \sum_{l=0}^{N-1} x_l \, y_{l-k}^{*}

    for :math:`k = -(M-1), \dots, (N-1)`, where :math:`N` is the length of ``x``, 
    :math:`M` is the length of ``y``, and :math:`y_m = 0` when :math:`m` is outside the 
    valid range :math:`[0, M-1]`. The size of :math:`z` is :math:`N + M - 1` and 
    :math:`y^*` denotes the complex conjugate of :math:`y`.
    
    ``method='fft'`` only works for numerical arrays as it relies on
    `fftconvolve`. In certain cases (i.e., arrays of objects or when
    rounding integers can lose precision), ``method='direct'`` is always used.

    When using ``mode='same'`` with even-length inputs, the outputs of `correlate`
    and `correlate2d` differ: There is a 1-index offset between them.

    Examples
    --------
    Implement a matched filter using cross-correlation, to recover a signal
    that has passed through a noisy channel.

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()

    >>> sig = np.repeat([0., 1., 1., 0., 1., 0., 0., 1.], 128)
    >>> sig_noise = sig + rng.standard_normal(len(sig))
    >>> corr = signal.correlate(sig_noise, np.ones(128), mode='same') / 128

    >>> clock = np.arange(64, len(sig), 128)
    >>> fig, (ax_orig, ax_noise, ax_corr) = plt.subplots(3, 1, sharex=True)
    >>> ax_orig.plot(sig)
    >>> ax_orig.plot(clock, sig[clock], 'ro')
    >>> ax_orig.set_title('Original signal')
    >>> ax_noise.plot(sig_noise)
    >>> ax_noise.set_title('Signal with noise')
    >>> ax_corr.plot(corr)
    >>> ax_corr.plot(clock, corr[clock], 'ro')
    >>> ax_corr.axhline(0.5, ls=':')
    >>> ax_corr.set_title('Cross-correlated with rectangular pulse')
    >>> ax_orig.margins(0, 0.1)
    >>> fig.tight_layout()
    >>> plt.show()

    Compute the cross-correlation of a noisy signal with the original signal.

    >>> x = np.arange(128) / 128
    >>> sig = np.sin(2 * np.pi * x)
    >>> sig_noise = sig + rng.standard_normal(len(sig))
    >>> corr = signal.correlate(sig_noise, sig)
    >>> lags = signal.correlation_lags(len(sig), len(sig_noise))
    >>> corr /= np.max(corr)

    >>> fig, (ax_orig, ax_noise, ax_corr) = plt.subplots(3, 1, figsize=(4.8, 4.8))
    >>> ax_orig.plot(sig)
    >>> ax_orig.set_title('Original signal')
    >>> ax_orig.set_xlabel('Sample Number')
    >>> ax_noise.plot(sig_noise)
    >>> ax_noise.set_title('Signal with noise')
    >>> ax_noise.set_xlabel('Sample Number')
    >>> ax_corr.plot(lags, corr)
    >>> ax_corr.set_title('Cross-correlated signal')
    >>> ax_corr.set_xlabel('Lag')
    >>> ax_orig.margins(0, 0.1)
    >>> ax_noise.margins(0, 0.1)
    >>> ax_corr.margins(0, 0.1)
    >>> fig.tight_layout()
    >>> plt.show()

    """
    try:
        xp = array_namespace(in1, in2)
    except TypeError:
        # either in1 or in2 are object arrays
        xp = np_compat

    if is_numpy(xp):
        _reject_objects(in1, 'correlate')
        _reject_objects(in2, 'correlate')

    in1 = xp.asarray(in1)
    in2 = xp.asarray(in2)

    if in1.ndim == in2.ndim == 0:
        in2_conj = (xp.conj(in2)
                    if xp.isdtype(in2.dtype, 'complex floating')
                    else in2)
        return in1 * in2_conj
    elif in1.ndim != in2.ndim:
        raise ValueError("in1 and in2 should have the same dimensionality")

    # Don't use _valfrommode, since correlate should not accept numeric modes
    try:
        val = _modedict[mode]
    except KeyError as e:
        raise ValueError("Acceptable mode flags are 'valid',"
                         " 'same', or 'full'.") from e

    # this either calls fftconvolve or this function with method=='direct'
    if method in ('fft', 'auto'):
        return convolve(in1, _reverse_and_conj(in2, xp), mode, method)

    elif method == 'direct':
        # fastpath to faster numpy.correlate for 1d inputs when possible
        if _np_conv_ok(in1, in2, mode, xp):
            a_in1 = np.asarray(in1)
            a_in2 = np.asarray(in2)
            out = np.correlate(a_in1, a_in2, mode)
            return xp.asarray(out)

        # _correlateND is far slower when in2.size > in1.size, so swap them
        # and then undo the effect afterward if mode == 'full'.  Also, it fails
        # with 'valid' mode if in2 is larger than in1, so swap those, too.
        # Don't swap inputs for 'same' mode, since shape of in1 matters.
        swapped_inputs = ((mode == 'full') and (xp_size(in2) > xp_size(in1)) or
                          _inputs_swap_needed(mode, in1.shape, in2.shape))

        if swapped_inputs:
            in1, in2 = in2, in1

        # convert to numpy & back for _sigtools._correlateND
        a_in1 = np.asarray(in1)
        a_in2 = np.asarray(in2)

        if mode == 'valid':
            ps = [i - j + 1 for i, j in zip(in1.shape, in2.shape)]
            out = np.empty(ps, a_in1.dtype)

            z = _sigtools._correlateND(a_in1, a_in2, out, val)

        else:
            ps = [i + j - 1 for i, j in zip(in1.shape, in2.shape)]

            # zero pad input
            in1zpadded = np.zeros(ps, a_in1.dtype)
            sc = tuple(slice(0, i) for i in in1.shape)
            in1zpadded[sc] = a_in1.copy()

            if mode == 'full':
                out = np.empty(ps, a_in1.dtype)
            elif mode == 'same':
                out = np.empty(in1.shape, a_in1.dtype)

            z = _sigtools._correlateND(in1zpadded, a_in2, out, val)

        z = xp.asarray(z)

        if swapped_inputs:
            # Reverse and conjugate to undo the effect of swapping inputs
            z = _reverse_and_conj(z, xp)

        return z

    else:
        raise ValueError("Acceptable method flags are 'auto',"
                         " 'direct', or 'fft'.")


def correlation_lags(in1_len, in2_len, mode='full'):
    r"""
    Calculates the lag / displacement indices array for 1D cross-correlation.

    Parameters
    ----------
    in1_len : int
        First input size.
    in2_len : int
        Second input size.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output.
        See the documentation `correlate` for more information.

    Returns
    -------
    lags : array
        Returns an array containing cross-correlation lag/displacement indices.
        Indices can be indexed with the np.argmax of the correlation to return
        the lag/displacement.

    See Also
    --------
    correlate : Compute the N-dimensional cross-correlation.

    Notes
    -----
    Cross-correlation for continuous functions :math:`f` and :math:`g` is
    defined as:

    .. math::

        \left ( f\star g \right )\left ( \tau \right )
        \triangleq \int_{t_0}^{t_0 +T}
        \overline{f\left ( t \right )}g\left ( t+\tau \right )dt

    Where :math:`\tau` is defined as the displacement, also known as the lag.

    Cross correlation for discrete functions :math:`f` and :math:`g` is
    defined as:

    .. math::
        \left ( f\star g \right )\left [ n \right ]
        \triangleq \sum_{-\infty}^{\infty}
        \overline{f\left [ m \right ]}g\left [ m+n \right ]

    Where :math:`n` is the lag.

    Examples
    --------
    Cross-correlation of a signal with its time-delayed self.

    >>> import numpy as np
    >>> from scipy import signal
    >>> rng = np.random.default_rng()
    >>> x = rng.standard_normal(1000)
    >>> y = np.concatenate([rng.standard_normal(100), x])
    >>> correlation = signal.correlate(x, y, mode="full")
    >>> lags = signal.correlation_lags(x.size, y.size, mode="full")
    >>> lag = lags[np.argmax(correlation)]
    """

    # calculate lag ranges in different modes of operation
    if mode == "full":
        # the output is the full discrete linear convolution
        # of the inputs. (Default)
        lags = np.arange(-in2_len + 1, in1_len)
    elif mode == "same":
        # the output is the same size as `in1`, centered
        # with respect to the 'full' output.
        # calculate the full output
        lags = np.arange(-in2_len + 1, in1_len)
        # determine the midpoint in the full output
        mid = lags.size // 2
        # determine lag_bound to be used with respect
        # to the midpoint
        lag_bound = in1_len // 2
        # calculate lag ranges for even and odd scenarios
        if in1_len % 2 == 0:
            lags = lags[(mid-lag_bound):(mid+lag_bound)]
        else:
            lags = lags[(mid-lag_bound):(mid+lag_bound)+1]
    elif mode == "valid":
        # the output consists only of those elements that do not
        # rely on the zero-padding. In 'valid' mode, either `in1` or `in2`
        # must be at least as large as the other in every dimension.

        # the lag_bound will be either negative or positive
        # this let's us infer how to present the lag range
        lag_bound = in1_len - in2_len
        if lag_bound >= 0:
            lags = np.arange(lag_bound + 1)
        else:
            lags = np.arange(lag_bound, 1)
    else:
        raise ValueError(f"Mode {mode} is invalid")
    return lags


def _centered(arr, newshape):
    # Return the center newshape portion of the array.
    newshape = np.asarray(newshape)
    currshape = np.array(arr.shape)
    startind = (currshape - newshape) // 2
    endind = startind + newshape
    myslice = [slice(startind[k], endind[k]) for k in range(len(endind))]
    return arr[tuple(myslice)]


def _init_freq_conv_axes(in1, in2, mode, axes, sorted_axes=False):
    """Handle the axes argument for frequency-domain convolution.

    Returns the inputs and axes in a standard form, eliminating redundant axes,
    swapping the inputs if necessary, and checking for various potential
    errors.

    Parameters
    ----------
    in1 : array
        First input.
    in2 : array
        Second input.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output.
        See the documentation `fftconvolve` for more information.
    axes : list of ints
        Axes over which to compute the FFTs.
    sorted_axes : bool, optional
        If `True`, sort the axes.
        Default is `False`, do not sort.

    Returns
    -------
    in1 : array
        The first input, possible swapped with the second input.
    in2 : array
        The second input, possible swapped with the first input.
    axes : list of ints
        Axes over which to compute the FFTs.

    """
    s1 = in1.shape
    s2 = in2.shape
    noaxes = axes is None

    _, axes = _init_nd_shape_and_axes(in1, shape=None, axes=axes)

    if not noaxes and not len(axes):
        raise ValueError("when provided, axes cannot be empty")

    # Axes of length 1 can rely on broadcasting rules for multiply,
    # no fft needed.
    axes = [a for a in axes if s1[a] != 1 and s2[a] != 1]

    if sorted_axes:
        axes.sort()

    if not all(s1[a] == s2[a] or s1[a] == 1 or s2[a] == 1
               for a in range(in1.ndim) if a not in axes):
        raise ValueError("incompatible shapes for in1 and in2:"
                         f" {s1} and {s2}")

    # Check that input sizes are compatible with 'valid' mode.
    if _inputs_swap_needed(mode, s1, s2, axes=axes):
        # Convolution is commutative; order doesn't have any effect on output.
        in1, in2 = in2, in1

    return in1, in2, axes


def _freq_domain_conv(xp, in1, in2, axes, shape, calc_fast_len=False):
    """Convolve two arrays in the frequency domain.

    This function implements only base the FFT-related operations.
    Specifically, it converts the signals to the frequency domain, multiplies
    them, then converts them back to the time domain.  Calculations of axes,
    shapes, convolution mode, etc. are implemented in higher level-functions,
    such as `fftconvolve` and `oaconvolve`.  Those functions should be used
    instead of this one.

    Parameters
    ----------
    in1 : array_like
        First input.
    in2 : array_like
        Second input. Should have the same number of dimensions as `in1`.
    axes : array_like of ints
        Axes over which to compute the FFTs.
    shape : array_like of ints
        The sizes of the FFTs.
    calc_fast_len : bool, optional
        If `True`, set each value of `shape` to the next fast FFT length.
        Default is `False`, use `axes` as-is.

    Returns
    -------
    out : array
        An N-dimensional array containing the discrete linear convolution of
        `in1` with `in2`.

    """
    if not len(axes):
        return in1 * in2

    complex_result = (xp.isdtype(in1.dtype, 'complex floating') or
                      xp.isdtype(in2.dtype, 'complex floating'))

    if calc_fast_len:
        # Speed up FFT by padding to optimal size.
        fshape = [
            sp_fft.next_fast_len(shape[a], not complex_result) for a in axes]
    else:
        fshape = shape

    if not complex_result:
        fft, ifft = sp_fft.rfftn, sp_fft.irfftn
    else:
        fft, ifft = sp_fft.fftn, sp_fft.ifftn

    if xp.isdtype(in1.dtype, 'integral'):
        in1 = xp.astype(in1, xp.float64)
    if xp.isdtype(in2.dtype, 'integral'):
        in2 = xp.astype(in2, xp.float64)

    sp1 = fft(in1, fshape, axes=axes)
    sp2 = fft(in2, fshape, axes=axes)

    ret = ifft(sp1 * sp2, fshape, axes=axes)

    if calc_fast_len:
        fslice = tuple([slice(sz) for sz in shape])
        ret = ret[fslice]

    return ret


def _apply_conv_mode(ret, s1, s2, mode, axes, xp):
    """Calculate the convolution result shape based on the `mode` argument.

    Returns the result sliced to the correct size for the given mode.

    Parameters
    ----------
    ret : array
        The result array, with the appropriate shape for the 'full' mode.
    s1 : list of int
        The shape of the first input.
    s2 : list of int
        The shape of the second input.
    mode : str {'full', 'valid', 'same'}
        A string indicating the size of the output.
        See the documentation `fftconvolve` for more information.
    axes : list of ints
        Axes over which to compute the convolution.

    Returns
    -------
    ret : array
        A copy of `res`, sliced to the correct size for the given `mode`.

    """
    if mode == "full":
        return xp_copy(ret, xp=xp)
    elif mode == "same":
        return xp_copy(_centered(ret, s1), xp=xp)
    elif mode == "valid":
        shape_valid = [ret.shape[a] if a not in axes else s1[a] - s2[a] + 1
                       for a in range(ret.ndim)]
        return xp_copy(_centered(ret, shape_valid), xp=xp)
    else:
        raise ValueError("acceptable mode flags are 'valid',"
                         " 'same', or 'full'")


def fftconvolve(in1, in2, mode="full", axes=None):
    """Convolve two N-dimensional arrays using FFT.

    Convolve `in1` and `in2` using the fast Fourier transform method, with
    the output size determined by the `mode` argument.

    This is generally much faster than `convolve` for large arrays (n > ~500),
    but can be slower when only a few output values are needed, and can only
    output float arrays (int or object array inputs will be cast to float).

    As of v0.19, `convolve` automatically chooses this method or the direct
    method based on an estimation of which is faster.

    Parameters
    ----------
    in1 : array_like
        First input.
    in2 : array_like
        Second input. Should have the same number of dimensions as `in1`.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output:

        ``full``
           The output is the full discrete linear convolution
           of the inputs. (Default)
        ``valid``
           The output consists only of those elements that do not
           rely on the zero-padding. In 'valid' mode, either `in1` or `in2`
           must be at least as large as the other in every dimension.
        ``same``
           The output is the same size as `in1`, centered
           with respect to the 'full' output.
    axes : int or array_like of ints or None, optional
        Axes over which to compute the convolution.
        The default is over all axes.

    Returns
    -------
    out : array
        An N-dimensional array containing a subset of the discrete linear
        convolution of `in1` with `in2`.

    See Also
    --------
    convolve : Uses the direct convolution or FFT convolution algorithm
               depending on which is faster.
    oaconvolve : Uses the overlap-add method to do convolution, which is
                 generally faster when the input arrays are large and
                 significantly different in size.

    Examples
    --------
    Autocorrelation of white noise is an impulse.

    >>> import numpy as np
    >>> from scipy import signal
    >>> rng = np.random.default_rng()
    >>> sig = rng.standard_normal(1000)
    >>> autocorr = signal.fftconvolve(sig, sig[::-1], mode='full')

    >>> import matplotlib.pyplot as plt
    >>> fig, (ax_orig, ax_mag) = plt.subplots(2, 1)
    >>> ax_orig.plot(sig)
    >>> ax_orig.set_title('White noise')
    >>> ax_mag.plot(np.arange(-len(sig)+1,len(sig)), autocorr)
    >>> ax_mag.set_title('Autocorrelation')
    >>> fig.tight_layout()
    >>> fig.show()

    Gaussian blur implemented using FFT convolution.  Notice the dark borders
    around the image, due to the zero-padding beyond its boundaries.
    The `convolve2d` function allows for other types of image boundaries,
    but is far slower.

    >>> from scipy import datasets
    >>> face = datasets.face(gray=True)
    >>> kernel = np.outer(signal.windows.gaussian(70, 8),
    ...                   signal.windows.gaussian(70, 8))
    >>> blurred = signal.fftconvolve(face, kernel, mode='same')

    >>> fig, (ax_orig, ax_kernel, ax_blurred) = plt.subplots(3, 1,
    ...                                                      figsize=(6, 15))
    >>> ax_orig.imshow(face, cmap='gray')
    >>> ax_orig.set_title('Original')
    >>> ax_orig.set_axis_off()
    >>> ax_kernel.imshow(kernel, cmap='gray')
    >>> ax_kernel.set_title('Gaussian kernel')
    >>> ax_kernel.set_axis_off()
    >>> ax_blurred.imshow(blurred, cmap='gray')
    >>> ax_blurred.set_title('Blurred')
    >>> ax_blurred.set_axis_off()
    >>> fig.show()

    """
    xp = array_namespace(in1, in2)

    in1 = xp.asarray(in1)
    in2 = xp.asarray(in2)

    if in1.ndim == in2.ndim == 0:  # scalar inputs
        return in1 * in2
    elif in1.ndim != in2.ndim:
        raise ValueError("in1 and in2 should have the same dimensionality")
    elif xp_size(in1) == 0 or xp_size(in2) == 0:  # empty arrays
        return xp.asarray([])

    in1, in2, axes = _init_freq_conv_axes(in1, in2, mode, axes,
                                          sorted_axes=False)

    s1 = in1.shape
    s2 = in2.shape

    shape = [max((s1[i], s2[i])) if i not in axes else s1[i] + s2[i] - 1
             for i in range(in1.ndim)]

    ret = _freq_domain_conv(xp, in1, in2, axes, shape, calc_fast_len=True)

    return _apply_conv_mode(ret, s1, s2, mode, axes, xp=xp)


def _calc_oa_lens(s1, s2):
    """Calculate the optimal FFT lengths for overlap-add convolution.

    The calculation is done for a single dimension.

    Parameters
    ----------
    s1 : int
        Size of the dimension for the first array.
    s2 : int
        Size of the dimension for the second array.

    Returns
    -------
    block_size : int
        The size of the FFT blocks.
    overlap : int
        The amount of overlap between two blocks.
    in1_step : int
        The size of each step for the first array.
    in2_step : int
        The size of each step for the first array.

    """
    # Set up the arguments for the conventional FFT approach.
    fallback = (s1+s2-1, None, s1, s2)

    # Use conventional FFT convolve if sizes are same.
    if s1 == s2 or s1 == 1 or s2 == 1:
        return fallback

    if s2 > s1:
        s1, s2 = s2, s1
        swapped = True
    else:
        swapped = False

    # There cannot be a useful block size if s2 is more than half of s1.
    if s2 >= s1/2:
        return fallback

    # Derivation of optimal block length
    # For original formula see:
    # https://en.wikipedia.org/wiki/Overlap-add_method
    #
    # Formula:
    # K = overlap = s2-1
    # N = block_size
    # C = complexity
    # e = exponential, exp(1)
    #
    # C = (N*(log2(N)+1))/(N-K)
    # C = (N*log2(2N))/(N-K)
    # C = N/(N-K) * log2(2N)
    # C1 = N/(N-K)
    # C2 = log2(2N) = ln(2N)/ln(2)
    #
    # dC1/dN = (1*(N-K)-N)/(N-K)^2 = -K/(N-K)^2
    # dC2/dN = 2/(2*N*ln(2)) = 1/(N*ln(2))
    #
    # dC/dN = dC1/dN*C2 + dC2/dN*C1
    # dC/dN = -K*ln(2N)/(ln(2)*(N-K)^2) + N/(N*ln(2)*(N-K))
    # dC/dN = -K*ln(2N)/(ln(2)*(N-K)^2) + 1/(ln(2)*(N-K))
    # dC/dN = -K*ln(2N)/(ln(2)*(N-K)^2) + (N-K)/(ln(2)*(N-K)^2)
    # dC/dN = (-K*ln(2N) + (N-K)/(ln(2)*(N-K)^2)
    # dC/dN = (N - K*ln(2N) - K)/(ln(2)*(N-K)^2)
    #
    # Solve for minimum, where dC/dN = 0
    # 0 = (N - K*ln(2N) - K)/(ln(2)*(N-K)^2)
    # 0 * ln(2)*(N-K)^2 = N - K*ln(2N) - K
    # 0 = N - K*ln(2N) - K
    # 0 = N - K*(ln(2N) + 1)
    # 0 = N - K*ln(2Ne)
    # N = K*ln(2Ne)
    # N/K = ln(2Ne)
    #
    # e^(N/K) = e^ln(2Ne)
    # e^(N/K) = 2Ne
    # 1/e^(N/K) = 1/(2*N*e)
    # e^(N/-K) = 1/(2*N*e)
    # e^(N/-K) = K/N*1/(2*K*e)
    # N/K*e^(N/-K) = 1/(2*e*K)
    # N/-K*e^(N/-K) = -1/(2*e*K)
    #
    # Using Lambert W function
    # https://en.wikipedia.org/wiki/Lambert_W_function
    # x = W(y) It is the solution to y = x*e^x
    # x = N/-K
    # y = -1/(2*e*K)
    #
    # N/-K = W(-1/(2*e*K))
    #
    # N = -K*W(-1/(2*e*K))
    overlap = s2-1
    opt_size = -overlap*lambertw(-1/(2*math.e*overlap), k=-1).real
    block_size = sp_fft.next_fast_len(math.ceil(opt_size))

    # Use conventional FFT convolve if there is only going to be one block.
    if block_size >= s1:
        return fallback

    if not swapped:
        in1_step = block_size-s2+1
        in2_step = s2
    else:
        in1_step = s2
        in2_step = block_size-s2+1

    return block_size, overlap, in1_step, in2_step


def _swapaxes(x, ax1, ax2, xp):
    """np.swapaxes"""
    shp = list(range(x.ndim))
    shp[ax1], shp[ax2] = shp[ax2], shp[ax1]
    return xp.permute_dims(x, shp)


# may want to look at moving _swapaxes and this to array-api-extra,
# cross-ref https://github.com/data-apis/array-api-extra/issues/97
def _split(x, indices_or_sections, axis, xp):
    """A simplified version of np.split, with `indices` being an list.
    """
    # https://github.com/numpy/numpy/blob/v2.2.0/numpy/lib/_shape_base_impl.py#L743
    Ntotal = x.shape[axis]

    # handle array case.
    Nsections = len(indices_or_sections) + 1
    div_points = [0] + list(indices_or_sections) + [Ntotal]    

    sub_arys = []
    sary = _swapaxes(x, axis, 0, xp=xp)
    for i in range(Nsections):
        st = div_points[i]
        end = div_points[i + 1]
        sub_arys.append(_swapaxes(sary[st:end, ...], axis, 0, xp=xp))

    return sub_arys


def oaconvolve(in1, in2, mode="full", axes=None):
    """Convolve two N-dimensional arrays using the overlap-add method.

    Convolve `in1` and `in2` using the overlap-add method, with
    the output size determined by the `mode` argument.

    This is generally much faster than `convolve` for large arrays (n > ~500),
    and generally much faster than `fftconvolve` when one array is much
    larger than the other, but can be slower when only a few output values are
    needed or when the arrays are very similar in shape, and can only
    output float arrays (int or object array inputs will be cast to float).

    Parameters
    ----------
    in1 : array_like
        First input.
    in2 : array_like
        Second input. Should have the same number of dimensions as `in1`.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output:

        ``full``
           The output is the full discrete linear convolution
           of the inputs. (Default)
        ``valid``
           The output consists only of those elements that do not
           rely on the zero-padding. In 'valid' mode, either `in1` or `in2`
           must be at least as large as the other in every dimension.
        ``same``
           The output is the same size as `in1`, centered
           with respect to the 'full' output.
    axes : int or array_like of ints or None, optional
        Axes over which to compute the convolution.
        The default is over all axes.

    Returns
    -------
    out : array
        An N-dimensional array containing a subset of the discrete linear
        convolution of `in1` with `in2`.

    See Also
    --------
    convolve : Uses the direct convolution or FFT convolution algorithm
               depending on which is faster.
    fftconvolve : An implementation of convolution using FFT.

    Notes
    -----
    .. versionadded:: 1.4.0

    References
    ----------
    .. [1] Wikipedia, "Overlap-add_method".
           https://en.wikipedia.org/wiki/Overlap-add_method
    .. [2] Richard G. Lyons. Understanding Digital Signal Processing,
           Third Edition, 2011. Chapter 13.10.
           ISBN 13: 978-0137-02741-5

    Examples
    --------
    Convolve a 100,000 sample signal with a 512-sample filter.

    >>> import numpy as np
    >>> from scipy import signal
    >>> rng = np.random.default_rng()
    >>> sig = rng.standard_normal(100000)
    >>> filt = signal.firwin(512, 0.01)
    >>> fsig = signal.oaconvolve(sig, filt)

    >>> import matplotlib.pyplot as plt
    >>> fig, (ax_orig, ax_mag) = plt.subplots(2, 1)
    >>> ax_orig.plot(sig)
    >>> ax_orig.set_title('White noise')
    >>> ax_mag.plot(fsig)
    >>> ax_mag.set_title('Filtered noise')
    >>> fig.tight_layout()
    >>> fig.show()

    """
    xp = array_namespace(in1, in2)

    in1 = xp.asarray(in1)
    in2 = xp.asarray(in2)

    if in1.ndim == in2.ndim == 0:  # scalar inputs
        return in1 * in2
    elif in1.ndim != in2.ndim:
        raise ValueError("in1 and in2 should have the same dimensionality")
    elif in1.size == 0 or in2.size == 0:  # empty arrays
        return xp.asarray([])
    elif in1.shape == in2.shape:  # Equivalent to fftconvolve
        return fftconvolve(in1, in2, mode=mode, axes=axes)

    in1, in2, axes = _init_freq_conv_axes(in1, in2, mode, axes,
                                          sorted_axes=True)

    s1 = in1.shape
    s2 = in2.shape

    if not axes:
        ret = in1 * in2
        return _apply_conv_mode(ret, s1, s2, mode, axes, xp)

    # Calculate this now since in1 is changed later
    shape_final = [None if i not in axes else
                   s1[i] + s2[i] - 1 for i in range(in1.ndim)]

    # Calculate the block sizes for the output, steps, first and second inputs.
    # It is simpler to calculate them all together than doing them in separate
    # loops due to all the special cases that need to be handled.
    optimal_sizes = ((-1, -1, s1[i], s2[i]) if i not in axes else
                     _calc_oa_lens(s1[i], s2[i]) for i in range(in1.ndim))
    block_size, overlaps, \
        in1_step, in2_step = zip(*optimal_sizes)

    # Fall back to fftconvolve if there is only one block in every dimension.
    if in1_step == s1 and in2_step == s2:
        return fftconvolve(in1, in2, mode=mode, axes=axes)

    # Figure out the number of steps and padding.
    # This would get too complicated in a list comprehension.
    nsteps1 = []
    nsteps2 = []
    pad_size1 = []
    pad_size2 = []
    for i in range(in1.ndim):
        if i not in axes:
            pad_size1 += [(0, 0)]
            pad_size2 += [(0, 0)]
            continue

        if s1[i] > in1_step[i]:
            curnstep1 = math.ceil((s1[i]+1)/in1_step[i])
            if (block_size[i] - overlaps[i])*curnstep1 < shape_final[i]:
                curnstep1 += 1

            curpad1 = curnstep1*in1_step[i] - s1[i]
        else:
            curnstep1 = 1
            curpad1 = 0

        if s2[i] > in2_step[i]:
            curnstep2 = math.ceil((s2[i]+1)/in2_step[i])
            if (block_size[i] - overlaps[i])*curnstep2 < shape_final[i]:
                curnstep2 += 1

            curpad2 = curnstep2*in2_step[i] - s2[i]
        else:
            curnstep2 = 1
            curpad2 = 0

        nsteps1 += [curnstep1]
        nsteps2 += [curnstep2]
        pad_size1 += [(0, curpad1)]
        pad_size2 += [(0, curpad2)]

    # Pad the array to a size that can be reshaped to the desired shape
    # if necessary.
    if not all(curpad == (0, 0) for curpad in pad_size1):
        in1 = xpx.pad(in1, pad_size1, mode='constant', constant_values=0, xp=xp)

    if not all(curpad == (0, 0) for curpad in pad_size2):
         in2 = xpx.pad(in2, pad_size2, mode='constant', constant_values=0, xp=xp)

    # Reshape the overlap-add parts to input block sizes.
    split_axes = [iax+i for i, iax in enumerate(axes)]
    fft_axes = [iax+1 for iax in split_axes]

    # We need to put each new dimension before the corresponding dimension
    # being reshaped in order to get the data in the right layout at the end.
    reshape_size1 = list(in1_step)
    reshape_size2 = list(in2_step)
    for i, iax in enumerate(split_axes):
        reshape_size1.insert(iax, nsteps1[i])
        reshape_size2.insert(iax, nsteps2[i])

    in1 = xp.reshape(in1, tuple(reshape_size1))
    in2 = xp.reshape(in2, tuple(reshape_size2))

    # Do the convolution.
    fft_shape = [block_size[i] for i in axes]
    ret = _freq_domain_conv(xp, in1, in2, fft_axes, fft_shape, calc_fast_len=False)

    # Do the overlap-add.
    for ax, ax_fft, ax_split in zip(axes, fft_axes, split_axes):
        overlap = overlaps[ax]
        if overlap is None:
            continue

        ret, overpart = _split(ret, [-overlap], ax_fft, xp=xp)
        overpart = _split(overpart, [-1], ax_split, xp=xp)[0]

        ret_overpart = _split(ret, [overlap], ax_fft, xp=xp)[0]
        ret_overpart = _split(ret_overpart, [1], ax_split, xp)[1]
        ret_overpart += overpart

    # Reshape back to the correct dimensionality.
    shape_ret = [ret.shape[i] if i not in fft_axes else
                 ret.shape[i]*ret.shape[i-1]
                 for i in range(ret.ndim) if i not in split_axes]
    ret = xp.reshape(ret, shape_ret)

    # Slice to the correct size.
    slice_final = tuple([slice(islice) for islice in shape_final])
    ret = ret[slice_final]

    return _apply_conv_mode(ret, s1, s2, mode, axes, xp)


def _numeric_arrays(arrays, kinds='buifc', xp=None):
    """
    See if a list of arrays are all numeric.

    Parameters
    ----------
    arrays : array or list of arrays
        arrays to check if numeric.
    kinds : string-like
        The dtypes of the arrays to be checked. If the dtype.kind of
        the ndarrays are not in this string the function returns False and
        otherwise returns True.
    """
    if xp is None:
        xp = array_namespace(*arrays)
    if not is_numpy(xp):
        return True

    if type(arrays) is np.ndarray:
        return arrays.dtype.kind in kinds
    for array_ in arrays:
        if array_.dtype.kind not in kinds:
            return False
    return True


def _conv_ops(x_shape, h_shape, mode):
    """
    Find the number of operations required for direct/fft methods of
    convolution. The direct operations were recorded by making a dummy class to
    record the number of operations by overriding ``__mul__`` and ``__add__``.
    The FFT operations rely on the (well-known) computational complexity of the
    FFT (and the implementation of ``_freq_domain_conv``).

    """
    if mode == "full":
        out_shape = [n + k - 1 for n, k in zip(x_shape, h_shape)]
    elif mode == "valid":
        out_shape = [abs(n - k) + 1 for n, k in zip(x_shape, h_shape)]
    elif mode == "same":
        out_shape = x_shape
    else:
        raise ValueError("Acceptable mode flags are 'valid',"
                         f" 'same', or 'full', not mode={mode}")

    s1, s2 = x_shape, h_shape
    if len(x_shape) == 1:
        s1, s2 = s1[0], s2[0]
        if mode == "full":
            direct_ops = s1 * s2
        elif mode == "valid":
            direct_ops = (s2 - s1 + 1) * s1 if s2 >= s1 else (s1 - s2 + 1) * s2
        elif mode == "same":
            direct_ops = (s1 * s2 if s1 < s2 else
                          s1 * s2 - (s2 // 2) * ((s2 + 1) // 2))
    else:
        if mode == "full":
            direct_ops = min(_prod(s1), _prod(s2)) * _prod(out_shape)
        elif mode == "valid":
            direct_ops = min(_prod(s1), _prod(s2)) * _prod(out_shape)
        elif mode == "same":
            direct_ops = _prod(s1) * _prod(s2)

    full_out_shape = [n + k - 1 for n, k in zip(x_shape, h_shape)]
    N = _prod(full_out_shape)
    fft_ops = 3 * N * np.log(N)  # 3 separate FFTs of size full_out_shape
    return fft_ops, direct_ops


def _fftconv_faster(x, h, mode):
    """
    See if using fftconvolve or convolve is faster.

    Parameters
    ----------
    x : np.ndarray
        Signal
    h : np.ndarray
        Kernel
    mode : str
        Mode passed to convolve

    Returns
    -------
    fft_faster : bool

    Notes
    -----
    See docstring of `choose_conv_method` for details on tuning hardware.

    See pull request 11031 for more detail:
    https://github.com/scipy/scipy/pull/11031.

    """
    fft_ops, direct_ops = _conv_ops(x.shape, h.shape, mode)
    offset = -1e-3 if x.ndim == 1 else -1e-4
    constants = {
            "valid": (1.89095737e-9, 2.1364985e-10, offset),
            "full": (1.7649070e-9, 2.1414831e-10, offset),
            "same": (3.2646654e-9, 2.8478277e-10, offset)
            if h.size <= x.size
            else (3.21635404e-9, 1.1773253e-8, -1e-5),
    } if x.ndim == 1 else {
            "valid": (1.85927e-9, 2.11242e-8, offset),
            "full": (1.99817e-9, 1.66174e-8, offset),
            "same": (2.04735e-9, 1.55367e-8, offset),
    }
    O_fft, O_direct, O_offset = constants[mode]
    return O_fft * fft_ops < O_direct * direct_ops + O_offset


def _reverse_and_conj(x, xp):
    """
    Reverse array `x` in all dimensions and perform the complex conjugate
    """
    if not is_torch(xp):
        reverse = (slice(None, None, -1),) * x.ndim
        x_rev = x[reverse]
    else:
        # NB: is a copy, not a view as torch does not allow negative indices
        # in slices, x-ref https://github.com/pytorch/pytorch/issues/59786
        x_rev = xp.flip(x)

    # cf https://github.com/data-apis/array-api/issues/824
    if xp.isdtype(x.dtype, 'complex floating'):
        return xp.conj(x_rev)
    else:
        return x_rev


def _np_conv_ok(volume, kernel, mode, xp):
    """
    See if numpy supports convolution of `volume` and `kernel` (i.e. both are
    1D ndarrays and of the appropriate shape).  NumPy's 'same' mode uses the
    size of the larger input, while SciPy's uses the size of the first input.

    Invalid mode strings will return False and be caught by the calling func.
    """
    if volume.ndim == kernel.ndim == 1:
        if mode in ('full', 'valid'):
            return True
        elif mode == 'same':
            return xp_size(volume) >= xp_size(kernel)
    else:
        return False


def _timeit_fast(stmt="pass", setup="pass", repeat=3):
    """
    Returns the time the statement/function took, in seconds.

    Faster, less precise version of IPython's timeit. `stmt` can be a statement
    written as a string or a callable.

    Will do only 1 loop (like IPython's timeit) with no repetitions
    (unlike IPython) for very slow functions.  For fast functions, only does
    enough loops to take 5 ms, which seems to produce similar results (on
    Windows at least), and avoids doing an extraneous cycle that isn't
    measured.

    """
    timer = timeit.Timer(stmt, setup)

    # determine number of calls per rep so total time for 1 rep >= 5 ms
    x = 0
    for p in range(0, 10):
        number = 10**p
        x = timer.timeit(number)  # seconds
        if x >= 5e-3 / 10:  # 5 ms for final test, 1/10th that for this one
            break
    if x > 1:  # second
        # If it's macroscopic, don't bother with repetitions
        best = x
    else:
        number *= 10
        r = timer.repeat(repeat, number)
        best = min(r)

    sec = best / number
    return sec


def choose_conv_method(in1, in2, mode='full', measure=False):
    """
    Find the fastest convolution/correlation method.

    This primarily exists to be called during the ``method='auto'`` option in
    `convolve` and `correlate`. It can also be used to determine the value of
    ``method`` for many different convolutions of the same dtype/shape.
    In addition, it supports timing the convolution to adapt the value of
    ``method`` to a particular set of inputs and/or hardware.

    Parameters
    ----------
    in1 : array_like
        The first argument passed into the convolution function.
    in2 : array_like
        The second argument passed into the convolution function.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output:

        ``full``
           The output is the full discrete linear convolution
           of the inputs. (Default)
        ``valid``
           The output consists only of those elements that do not
           rely on the zero-padding.
        ``same``
           The output is the same size as `in1`, centered
           with respect to the 'full' output.
    measure : bool, optional
        If True, run and time the convolution of `in1` and `in2` with both
        methods and return the fastest. If False (default), predict the fastest
        method using precomputed values.

    Returns
    -------
    method : str
        A string indicating which convolution method is fastest, either
        'direct' or 'fft'
    times : dict, optional
        A dictionary containing the times (in seconds) needed for each method.
        This value is only returned if ``measure=True``.

    See Also
    --------
    convolve
    correlate

    Notes
    -----
    Generally, this method is 99% accurate for 2D signals and 85% accurate
    for 1D signals for randomly chosen input sizes. For precision, use
    ``measure=True`` to find the fastest method by timing the convolution.
    This can be used to avoid the minimal overhead of finding the fastest
    ``method`` later, or to adapt the value of ``method`` to a particular set
    of inputs.

    Experiments were run on an Amazon EC2 r5a.2xlarge machine to test this
    function. These experiments measured the ratio between the time required
    when using ``method='auto'`` and the time required for the fastest method
    (i.e., ``ratio = time_auto / min(time_fft, time_direct)``). In these
    experiments, we found:

    * There is a 95% chance of this ratio being less than 1.5 for 1D signals
      and a 99% chance of being less than 2.5 for 2D signals.
    * The ratio was always less than 2.5/5 for 1D/2D signals respectively.
    * This function is most inaccurate for 1D convolutions that take between 1
      and 10 milliseconds with ``method='direct'``. A good proxy for this
      (at least in our experiments) is ``1e6 <= in1.size * in2.size <= 1e7``.

    The 2D results almost certainly generalize to 3D/4D/etc because the
    implementation is the same (the 1D implementation is different).

    All the numbers above are specific to the EC2 machine. However, we did find
    that this function generalizes fairly decently across hardware. The speed
    tests were of similar quality (and even slightly better) than the same
    tests performed on the machine to tune this function's numbers (a mid-2014
    15-inch MacBook Pro with 16GB RAM and a 2.5GHz Intel i7 processor).

    There are cases when `fftconvolve` supports the inputs but this function
    returns `direct` (e.g., to protect against floating point integer
    precision).

    .. versionadded:: 0.19

    Examples
    --------
    Estimate the fastest method for a given input:

    >>> import numpy as np
    >>> from scipy import signal
    >>> rng = np.random.default_rng()
    >>> img = rng.random((32, 32))
    >>> filter = rng.random((8, 8))
    >>> method = signal.choose_conv_method(img, filter, mode='same')
    >>> method
    'fft'

    This can then be applied to other arrays of the same dtype and shape:

    >>> img2 = rng.random((32, 32))
    >>> filter2 = rng.random((8, 8))
    >>> corr2 = signal.correlate(img2, filter2, mode='same', method=method)
    >>> conv2 = signal.convolve(img2, filter2, mode='same', method=method)

    The output of this function (``method``) works with `correlate` and
    `convolve`.

    """
    try:
        xp = array_namespace(in1, in2)
    except TypeError:
        # either in1 or in2 are object arrays
        xp = np_compat

    if is_numpy(xp):
        _reject_objects(in1, 'choose_conv_method')
        _reject_objects(in2, 'choose_conv_method')

    volume = xp.asarray(in1)
    kernel = xp.asarray(in2)

    if measure:
        times = {}
        for method in ['fft', 'direct']:
            times[method] = _timeit_fast(lambda: convolve(volume, kernel,
                                         mode=mode, method=method))

        chosen_method = 'fft' if times['fft'] < times['direct'] else 'direct'
        return chosen_method, times

    # for integer input,
    # catch when more precision required than float provides (representing an
    # integer as float can lose precision in fftconvolve if larger than 2**52)
    if any([_numeric_arrays([x], kinds='ui', xp=xp) for x in [volume, kernel]]):
        max_value = int(xp.max(xp.abs(volume))) * int(xp.max(xp.abs(kernel)))
        max_value *= int(min(xp_size(volume), xp_size(kernel)))
        if max_value > 2**np.finfo('float').nmant - 1:
            return 'direct'

    if _numeric_arrays([volume, kernel], kinds='b', xp=xp):
        return 'direct'

    if _numeric_arrays([volume, kernel], xp=xp):
        if _fftconv_faster(volume, kernel, mode):
            return 'fft'

    return 'direct'


def convolve(in1, in2, mode='full', method='auto'):
    """
    Convolve two N-dimensional arrays.

    Convolve `in1` and `in2`, with the output size determined by the
    `mode` argument.

    Parameters
    ----------
    in1 : array_like
        First input.
    in2 : array_like
        Second input. Should have the same number of dimensions as `in1`.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output:

        ``full``
           The output is the full discrete linear convolution
           of the inputs. (Default)
        ``valid``
           The output consists only of those elements that do not
           rely on the zero-padding. In 'valid' mode, either `in1` or `in2`
           must be at least as large as the other in every dimension.
        ``same``
           The output is the same size as `in1`, centered
           with respect to the 'full' output.
    method : str {'auto', 'direct', 'fft'}, optional
        A string indicating which method to use to calculate the convolution.

        ``direct``
           The convolution is determined directly from sums, the definition of
           convolution.
        ``fft``
           The Fourier Transform is used to perform the convolution by calling
           `fftconvolve`.
        ``auto``
           Automatically chooses direct or Fourier method based on an estimate
           of which is faster (default).  See Notes for more detail.

           .. versionadded:: 0.19.0

    Returns
    -------
    convolve : array
        An N-dimensional array containing a subset of the discrete linear
        convolution of `in1` with `in2`.

    Warns
    -----
    RuntimeWarning
        Use of the FFT convolution on input containing NAN or INF will lead
        to the entire output being NAN or INF. Use method='direct' when your
        input contains NAN or INF values.

    See Also
    --------
    numpy.polymul : performs polynomial multiplication (same operation, but
                    also accepts poly1d objects)
    choose_conv_method : chooses the fastest appropriate convolution method
    fftconvolve : Always uses the FFT method.
    oaconvolve : Uses the overlap-add method to do convolution, which is
                 generally faster when the input arrays are large and
                 significantly different in size.

    Notes
    -----
    By default, `convolve` and `correlate` use ``method='auto'``, which calls
    `choose_conv_method` to choose the fastest method using pre-computed
    values (`choose_conv_method` can also measure real-world timing with a
    keyword argument). Because `fftconvolve` relies on floating point numbers,
    there are certain constraints that may force ``method='direct'`` (more detail
    in `choose_conv_method` docstring).

    Examples
    --------
    Smooth a square pulse using a Hann window:

    >>> import numpy as np
    >>> from scipy import signal
    >>> sig = np.repeat([0., 1., 0.], 100)
    >>> win = signal.windows.hann(50)
    >>> filtered = signal.convolve(sig, win, mode='same') / sum(win)

    >>> import matplotlib.pyplot as plt
    >>> fig, (ax_orig, ax_win, ax_filt) = plt.subplots(3, 1, sharex=True)
    >>> ax_orig.plot(sig)
    >>> ax_orig.set_title('Original pulse')
    >>> ax_orig.margins(0, 0.1)
    >>> ax_win.plot(win)
    >>> ax_win.set_title('Filter impulse response')
    >>> ax_win.margins(0, 0.1)
    >>> ax_filt.plot(filtered)
    >>> ax_filt.set_title('Filtered signal')
    >>> ax_filt.margins(0, 0.1)
    >>> fig.tight_layout()
    >>> fig.show()

    """
    try:
        xp = array_namespace(in1, in2)
    except TypeError:
        # either in1 or in2 are object arrays
        xp = np_compat

    if is_numpy(xp):
        _reject_objects(in1, 'correlate')
        _reject_objects(in2, 'correlate')

    volume = xp.asarray(in1)
    kernel = xp.asarray(in2)

    if volume.ndim == kernel.ndim == 0:
        return volume * kernel
    elif volume.ndim != kernel.ndim:
        raise ValueError("volume and kernel should have the same "
                         "dimensionality")

    if _inputs_swap_needed(mode, volume.shape, kernel.shape):
        # Convolution is commutative; order doesn't have any effect on output
        volume, kernel = kernel, volume

    if method == 'auto':
        method = choose_conv_method(volume, kernel, mode=mode)

    if method == 'fft':
        out = fftconvolve(volume, kernel, mode=mode)
        result_type = xp.result_type(volume, kernel)
        if xp.isdtype(result_type, 'integral'):
            out = xp.round(out)

        if xp.isnan(xp.reshape(out, (-1,))[0]) or xp.isinf(xp.reshape(out, (-1,))[0]):
            warnings.warn("Use of fft convolution on input with NAN or inf"
                          " results in NAN or inf output. Consider using"
                          " method='direct' instead.",
                          category=RuntimeWarning, stacklevel=2)

        return xp.astype(out, result_type)
    elif method == 'direct':
        # fastpath to faster numpy.convolve for 1d inputs when possible
        if _np_conv_ok(volume, kernel, mode, xp):
            # convert to numpy and back
            a_volume = np.asarray(volume)
            a_kernel = np.asarray(kernel)
            out = np.convolve(a_volume, a_kernel, mode)
            return xp.asarray(out)

        return correlate(volume, _reverse_and_conj(kernel, xp), mode, 'direct')
    else:
        raise ValueError("Acceptable method flags are 'auto',"
                         " 'direct', or 'fft'.")


def order_filter(a, domain, rank):
    """
    Perform an order filter on an N-D array.

    Perform an order filter on the array in. The domain argument acts as a
    mask centered over each pixel. The non-zero elements of domain are
    used to select elements surrounding each input pixel which are placed
    in a list. The list is sorted, and the output for that pixel is the
    element corresponding to rank in the sorted list.

    Parameters
    ----------
    a : ndarray
        The N-dimensional input array.
    domain : array_like
        A mask array with the same number of dimensions as `a`.
        Each dimension should have an odd number of elements.
    rank : int
        A non-negative integer which selects the element from the
        sorted list (0 corresponds to the smallest element, 1 is the
        next smallest element, etc.).

    Returns
    -------
    out : ndarray
        The results of the order filter in an array with the same
        shape as `a`.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal
    >>> x = np.arange(25).reshape(5, 5)
    >>> domain = np.identity(3)
    >>> x
    array([[ 0,  1,  2,  3,  4],
           [ 5,  6,  7,  8,  9],
           [10, 11, 12, 13, 14],
           [15, 16, 17, 18, 19],
           [20, 21, 22, 23, 24]])
    >>> signal.order_filter(x, domain, 0)
    array([[  0,   0,   0,   0,   0],
           [  0,   0,   1,   2,   0],
           [  0,   5,   6,   7,   0],
           [  0,  10,  11,  12,   0],
           [  0,   0,   0,   0,   0]])
    >>> signal.order_filter(x, domain, 2)
    array([[  6,   7,   8,   9,   4],
           [ 11,  12,  13,  14,   9],
           [ 16,  17,  18,  19,  14],
           [ 21,  22,  23,  24,  19],
           [ 20,  21,  22,  23,  24]])

    """
    xp = array_namespace(a, domain)

    domain = xp.asarray(domain)
    for dimsize in domain.shape:
        if (dimsize % 2) != 1:
            raise ValueError("Each dimension of domain argument "
                             "should have an odd number of elements.")

    a = xp.asarray(a)
    if not (
        xp.isdtype(a.dtype, "integral") or a.dtype in (xp.float32, xp.float64)
    ):
        raise ValueError(f"dtype={a.dtype} is not supported by order_filter")
    result = ndimage.rank_filter(a, rank, footprint=domain, mode='constant')
    return result


def medfilt(volume, kernel_size=None):
    """
    Perform a median filter on an N-dimensional array.

    Apply a median filter to the input array using a local window-size
    given by `kernel_size`. The array will automatically be zero-padded.

    Parameters
    ----------
    volume : array_like
        An N-dimensional input array.
    kernel_size : array_like, optional
        A scalar or an N-length list giving the size of the median filter
        window in each dimension.  Elements of `kernel_size` should be odd.
        If `kernel_size` is a scalar, then this scalar is used as the size in
        each dimension. Default size is 3 for each dimension.

    Returns
    -------
    out : ndarray
        An array the same size as input containing the median filtered
        result.

    Warns
    -----
    UserWarning
        If array size is smaller than kernel size along any dimension

    See Also
    --------
    scipy.ndimage.median_filter
    scipy.signal.medfilt2d

    Notes
    -----
    The more general function `scipy.ndimage.median_filter` has a more
    efficient implementation of a median filter and therefore runs much faster.

    For 2-dimensional images with ``uint8``, ``float32`` or ``float64`` dtypes,
    the specialised function `scipy.signal.medfilt2d` may be faster.

    """
    xp = array_namespace(volume)
    volume = xp.asarray(volume)
    if volume.ndim == 0:
        volume = xpx.atleast_nd(volume, ndim=1, xp=xp)

    if not (xp.isdtype(volume.dtype, "integral") or
            volume.dtype in [xp.float32, xp.float64]):
        raise ValueError(f"dtype={volume.dtype} is not supported by medfilt")

    if kernel_size is None:
        kernel_size = [3] * volume.ndim
    kernel_size = xp.asarray(kernel_size)
    if kernel_size.shape == ():
        kernel_size = xp.repeat(kernel_size, volume.ndim)

    for k in range(volume.ndim):
        if (kernel_size[k] % 2) != 1:
            raise ValueError("Each element of kernel_size should be odd.")
    if any(k > s for k, s in zip(kernel_size, volume.shape)):
        warnings.warn('kernel_size exceeds volume extent: the volume will be '
                      'zero-padded.',
                      stacklevel=2)

    size = math.prod(kernel_size)
    result = ndimage.rank_filter(volume, size // 2, size=kernel_size,
                                 mode='constant')

    return result


def wiener(im, mysize=None, noise=None):
    """
    Perform a Wiener filter on an N-dimensional array.

    Apply a Wiener filter to the N-dimensional array `im`.

    Parameters
    ----------
    im : ndarray
        An N-dimensional array.
    mysize : int or array_like, optional
        A scalar or an N-length list giving the size of the Wiener filter
        window in each dimension.  Elements of mysize should be odd.
        If mysize is a scalar, then this scalar is used as the size
        in each dimension.
    noise : float, optional
        The noise-power to use. If None, then noise is estimated as the
        average of the local variance of the input.

    Returns
    -------
    out : ndarray
        Wiener filtered result with the same shape as `im`.

    Notes
    -----
    This implementation is similar to wiener2 in Matlab/Octave.
    For more details see [1]_

    References
    ----------
    .. [1] Lim, Jae S., Two-Dimensional Signal and Image Processing,
           Englewood Cliffs, NJ, Prentice Hall, 1990, p. 548.

    Examples
    --------
    >>> from scipy.datasets import face
    >>> from scipy.signal import wiener
    >>> import matplotlib.pyplot as plt
    >>> import numpy as np
    >>> rng = np.random.default_rng()
    >>> img = rng.random((40, 40))    #Create a random image
    >>> filtered_img = wiener(img, (5, 5))  #Filter the image
    >>> f, (plot1, plot2) = plt.subplots(1, 2)
    >>> plot1.imshow(img)
    >>> plot2.imshow(filtered_img)
    >>> plt.show()

    """
    xp = array_namespace(im)

    im = xp.asarray(im)
    if mysize is None:
        mysize = [3] * im.ndim
    mysize_arr = xp.asarray(mysize)
    if mysize_arr.shape == ():
        mysize = [mysize] * im.ndim

    # Estimate the local mean
    size = math.prod(mysize)
    lMean = correlate(im, xp.ones(mysize), 'same')
    lsize = float(size)
    lMean = lMean / lsize

    # Estimate the local variance
    lVar = (correlate(im ** 2, xp.ones(mysize), 'same') / lsize - lMean ** 2)

    # Estimate the noise power if needed.
    if noise is None:
        noise = xp.mean(xp.reshape(lVar, (-1,)), axis=0)

    res = (im - lMean)
    res *= (1 - noise / lVar)
    res += lMean
    out = xp.where(lVar < noise, lMean, res)

    return out


def convolve2d(in1, in2, mode='full', boundary='fill', fillvalue=0):
    """
    Convolve two 2-dimensional arrays.

    Convolve `in1` and `in2` with output size determined by `mode`, and
    boundary conditions determined by `boundary` and `fillvalue`.

    Parameters
    ----------
    in1 : array_like
        First input.
    in2 : array_like
        Second input. Should have the same number of dimensions as `in1`.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output:

        ``full``
           The output is the full discrete linear convolution
           of the inputs. (Default)
        ``valid``
           The output consists only of those elements that do not
           rely on the zero-padding. In 'valid' mode, either `in1` or `in2`
           must be at least as large as the other in every dimension.
        ``same``
           The output is the same size as `in1`, centered
           with respect to the 'full' output.
    boundary : str {'fill', 'wrap', 'symm'}, optional
        A flag indicating how to handle boundaries:

        ``fill``
           pad input arrays with fillvalue. (default)
        ``wrap``
           circular boundary conditions.
        ``symm``
           symmetrical boundary conditions.

    fillvalue : scalar, optional
        Value to fill pad input arrays with. Default is 0.

    Returns
    -------
    out : ndarray
        A 2-dimensional array containing a subset of the discrete linear
        convolution of `in1` with `in2`.

    Examples
    --------
    Compute the gradient of an image by 2D convolution with a complex Scharr
    operator.  (Horizontal operator is real, vertical is imaginary.)  Use
    symmetric boundary condition to avoid creating edges at the image
    boundaries.

    >>> import numpy as np
    >>> from scipy import signal
    >>> from scipy import datasets
    >>> ascent = datasets.ascent()
    >>> scharr = np.array([[ -3-3j, 0-10j,  +3 -3j],
    ...                    [-10+0j, 0+ 0j, +10 +0j],
    ...                    [ -3+3j, 0+10j,  +3 +3j]]) # Gx + j*Gy
    >>> grad = signal.convolve2d(ascent, scharr, boundary='symm', mode='same')

    >>> import matplotlib.pyplot as plt
    >>> fig, (ax_orig, ax_mag, ax_ang) = plt.subplots(3, 1, figsize=(6, 15))
    >>> ax_orig.imshow(ascent, cmap='gray')
    >>> ax_orig.set_title('Original')
    >>> ax_orig.set_axis_off()
    >>> ax_mag.imshow(np.absolute(grad), cmap='gray')
    >>> ax_mag.set_title('Gradient magnitude')
    >>> ax_mag.set_axis_off()
    >>> ax_ang.imshow(np.angle(grad), cmap='hsv') # hsv is cyclic, like angles
    >>> ax_ang.set_title('Gradient orientation')
    >>> ax_ang.set_axis_off()
    >>> fig.show()

    """
    xp = array_namespace(in1, in2)

    # NB: do work in NumPy, only convert the output

    in1 = np.asarray(in1)
    in2 = np.asarray(in2)

    if not in1.ndim == in2.ndim == 2:
        raise ValueError('convolve2d inputs must both be 2-D arrays')

    if _inputs_swap_needed(mode, in1.shape, in2.shape):
        in1, in2 = in2, in1

    val = _valfrommode(mode)
    bval = _bvalfromboundary(boundary)
    out = _sigtools._convolve2d(in1, in2, 1, val, bval, fillvalue)
    return xp.asarray(out)


def correlate2d(in1, in2, mode='full', boundary='fill', fillvalue=0):
    """
    Cross-correlate two 2-dimensional arrays.

    Cross correlate `in1` and `in2` with output size determined by `mode`, and
    boundary conditions determined by `boundary` and `fillvalue`.

    Parameters
    ----------
    in1 : array_like
        First input.
    in2 : array_like
        Second input. Should have the same number of dimensions as `in1`.
    mode : str {'full', 'valid', 'same'}, optional
        A string indicating the size of the output:

        ``full``
           The output is the full discrete linear cross-correlation
           of the inputs. (Default)
        ``valid``
           The output consists only of those elements that do not
           rely on the zero-padding. In 'valid' mode, either `in1` or `in2`
           must be at least as large as the other in every dimension.
        ``same``
           The output is the same size as `in1`, centered
           with respect to the 'full' output.
    boundary : str {'fill', 'wrap', 'symm'}, optional
        A flag indicating how to handle boundaries:

        ``fill``
           pad input arrays with fillvalue. (default)
        ``wrap``
           circular boundary conditions.
        ``symm``
           symmetrical boundary conditions.

    fillvalue : scalar, optional
        Value to fill pad input arrays with. Default is 0.

    Returns
    -------
    correlate2d : ndarray
        A 2-dimensional array containing a subset of the discrete linear
        cross-correlation of `in1` with `in2`.

    Notes
    -----
    When using "same" mode with even-length inputs, the outputs of `correlate`
    and `correlate2d` differ: There is a 1-index offset between them.

    Examples
    --------
    Use 2D cross-correlation to find the location of a template in a noisy
    image:

    >>> import numpy as np
    >>> from scipy import signal, datasets, ndimage
    >>> rng = np.random.default_rng()
    >>> face = datasets.face(gray=True) - datasets.face(gray=True).mean()
    >>> face = ndimage.zoom(face[30:500, 400:950], 0.5)  # extract the face
    >>> template = np.copy(face[135:165, 140:175])  # right eye
    >>> template -= template.mean()
    >>> face = face + rng.standard_normal(face.shape) * 50  # add noise
    >>> corr = signal.correlate2d(face, template, boundary='symm', mode='same')
    >>> y, x = np.unravel_index(np.argmax(corr), corr.shape)  # find the match

    >>> import matplotlib.pyplot as plt
    >>> fig, (ax_orig, ax_template, ax_corr) = plt.subplots(3, 1,
    ...                                                     figsize=(6, 15))
    >>> ax_orig.imshow(face, cmap='gray')
    >>> ax_orig.set_title('Original')
    >>> ax_orig.set_axis_off()
    >>> ax_template.imshow(template, cmap='gray')
    >>> ax_template.set_title('Template')
    >>> ax_template.set_axis_off()
    >>> ax_corr.imshow(corr, cmap='gray')
    >>> ax_corr.set_title('Cross-correlation')
    >>> ax_corr.set_axis_off()
    >>> ax_orig.plot(x, y, 'ro')
    >>> fig.show()

    """
    xp = array_namespace(in1, in2)
    in1 = np.asarray(in1)
    in2 = np.asarray(in2)

    if not in1.ndim == in2.ndim == 2:
        raise ValueError('correlate2d inputs must both be 2-D arrays')

    swapped_inputs = _inputs_swap_needed(mode, in1.shape, in2.shape)
    if swapped_inputs:
        in1, in2 = in2, in1

    val = _valfrommode(mode)
    bval = _bvalfromboundary(boundary)
    out = _sigtools._convolve2d(in1, in2.conj(), 0, val, bval, fillvalue)

    if swapped_inputs:
        out = out[::-1, ::-1]

    return xp.asarray(out)


def medfilt2d(input, kernel_size=3):
    """
    Median filter a 2-dimensional array.

    Apply a median filter to the `input` array using a local window-size
    given by `kernel_size` (must be odd). The array is zero-padded
    automatically.

    Parameters
    ----------
    input : array_like
        A 2-dimensional input array.
    kernel_size : array_like, optional
        A scalar or a list of length 2, giving the size of the
        median filter window in each dimension.  Elements of
        `kernel_size` should be odd.  If `kernel_size` is a scalar,
        then this scalar is used as the size in each dimension.
        Default is a kernel of size (3, 3).

    Returns
    -------
    out : ndarray
        An array the same size as input containing the median filtered
        result.

    See Also
    --------
    scipy.ndimage.median_filter

    Notes
    -----
    This is faster than `medfilt` when the input dtype is ``uint8``,
    ``float32``, or ``float64``; for other types, this falls back to
    `medfilt`. In some situations, `scipy.ndimage.median_filter` may be
    faster than this function.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import signal
    >>> x = np.arange(25).reshape(5, 5)
    >>> x
    array([[ 0,  1,  2,  3,  4],
           [ 5,  6,  7,  8,  9],
           [10, 11, 12, 13, 14],
           [15, 16, 17, 18, 19],
           [20, 21, 22, 23, 24]])

    # Replaces i,j with the median out of 5*5 window

    >>> signal.medfilt2d(x, kernel_size=5)
    array([[ 0,  0,  2,  0,  0],
           [ 0,  3,  7,  4,  0],
           [ 2,  8, 12,  9,  4],
           [ 0,  8, 12,  9,  0],
           [ 0,  0, 12,  0,  0]])

    # Replaces i,j with the median out of default 3*3 window

    >>> signal.medfilt2d(x)
    array([[ 0,  1,  2,  3,  0],
           [ 1,  6,  7,  8,  4],
           [ 6, 11, 12, 13,  9],
           [11, 16, 17, 18, 14],
           [ 0, 16, 17, 18,  0]])

    # Replaces i,j with the median out of default 5*3 window

    >>> signal.medfilt2d(x, kernel_size=[5,3])
    array([[ 0,  1,  2,  3,  0],
           [ 0,  6,  7,  8,  3],
           [ 5, 11, 12, 13,  8],
           [ 5, 11, 12, 13,  8],
           [ 0, 11, 12, 13,  0]])

    # Replaces i,j with the median out of default 3*5 window

    >>> signal.medfilt2d(x, kernel_size=[3,5])
    array([[ 0,  0,  2,  1,  0],
           [ 1,  5,  7,  6,  3],
           [ 6, 10, 12, 11,  8],
           [11, 15, 17, 16, 13],
           [ 0, 15, 17, 16,  0]])

    # As seen in the examples,
    # kernel numbers must be odd and not exceed original array dim

    """
    xp = array_namespace(input)

    image = np.asarray(input)

    # checking dtype.type, rather than just dtype, is necessary for
    # excluding np.longdouble with MS Visual C.
    if image.dtype.type not in (np.ubyte, np.float32, np.float64):
        return xp.asarray(medfilt(image, kernel_size))

    if kernel_size is None:
        kernel_size = [3] * 2
    kernel_size = np.asarray(kernel_size)
    if kernel_size.shape == ():
        kernel_size = np.repeat(kernel_size.item(), 2)

    for size in kernel_size:
        if (size % 2) != 1:
            raise ValueError("Each element of kernel_size should be odd.")

    result_np = _sigtools._medfilt2d(image, kernel_size)
    return xp.asarray(result_np)


def lfilter(b, a, x, axis=-1, zi=None):
    """
    Filter data along one-dimension with an IIR or FIR filter.

    Filter a data sequence, `x`, using a digital filter.  This works for many
    fundamental data types (including Object type).  The filter is a direct
    form II transposed implementation of the standard difference equation
    (see Notes).

    The function `sosfilt` (and filter design using ``output='sos'``) should be
    preferred over `lfilter` for most filtering tasks, as second-order sections
    have fewer numerical problems.

    Parameters
    ----------
    b : array_like
        The numerator coefficient vector in a 1-D sequence.
    a : array_like
        The denominator coefficient vector in a 1-D sequence.  If ``a[0]``
        is not 1, then both `a` and `b` are normalized by ``a[0]``.
    x : array_like
        An N-dimensional input array.
    axis : int, optional
        The axis of the input data array along which to apply the
        linear filter. The filter is applied to each subarray along
        this axis.  Default is -1.
    zi : array_like, optional
        Initial conditions for the filter delays.  It is a vector
        (or array of vectors for an N-dimensional input) of length
        ``max(len(a), len(b)) - 1``.  If `zi` is None or is not given then
        initial rest is assumed.  See `lfiltic` for more information.

    Returns
    -------
    y : array
        The output of the digital filter.
    zf : array, optional
        If `zi` is None, this is not returned, otherwise, `zf` holds the
        final filter delay values.

    See Also
    --------
    lfiltic : Construct initial conditions for `lfilter`.
    lfilter_zi : Compute initial state (steady state of step response) for
                 `lfilter`.
    filtfilt : A forward-backward filter, to obtain a filter with zero phase.
    savgol_filter : A Savitzky-Golay filter.
    sosfilt: Filter data using cascaded second-order sections.
    sosfiltfilt: A forward-backward filter using second-order sections.

    Notes
    -----
    The filter function is implemented as a direct II transposed structure.
    This means that the filter implements::

       a[0]*y[n] = b[0]*x[n] + b[1]*x[n-1] + ... + b[M]*x[n-M]
                             - a[1]*y[n-1] - ... - a[N]*y[n-N]

    where `M` is the degree of the numerator, `N` is the degree of the
    denominator, and `n` is the sample number.  It is implemented using
    the following difference equations (assuming M = N)::

         a[0]*y[n] = b[0] * x[n]               + d[0][n-1]
           d[0][n] = b[1] * x[n] - a[1] * y[n] + d[1][n-1]
           d[1][n] = b[2] * x[n] - a[2] * y[n] + d[2][n-1]
         ...
         d[N-2][n] = b[N-1]*x[n] - a[N-1]*y[n] + d[N-1][n-1]
         d[N-1][n] = b[N] * x[n] - a[N] * y[n]

    where `d` are the state variables.

    The rational transfer function describing this filter in the
    z-transform domain is::

                             -1              -M
                 b[0] + b[1]z  + ... + b[M] z
         Y(z) = -------------------------------- X(z)
                             -1              -N
                 a[0] + a[1]z  + ... + a[N] z

    Examples
    --------
    Generate a noisy signal to be filtered:

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()
    >>> t = np.linspace(-1, 1, 201)
    >>> x = (np.sin(2*np.pi*0.75*t*(1-t) + 2.1) +
    ...      0.1*np.sin(2*np.pi*1.25*t + 1) +
    ...      0.18*np.cos(2*np.pi*3.85*t))
    >>> xn = x + rng.standard_normal(len(t)) * 0.08

    Create an order 3 lowpass butterworth filter:

    >>> b, a = signal.butter(3, 0.05)

    Apply the filter to xn.  Use lfilter_zi to choose the initial condition of
    the filter:

    >>> zi = signal.lfilter_zi(b, a)
    >>> z, _ = signal.lfilter(b, a, xn, zi=zi*xn[0])

    Apply the filter again, to have a result filtered at an order the same as
    filtfilt:

    >>> z2, _ = signal.lfilter(b, a, z, zi=zi*z[0])

    Use filtfilt to apply the filter:

    >>> y = signal.filtfilt(b, a, xn)

    Plot the original signal and the various filtered versions:

    >>> plt.figure
    >>> plt.plot(t, xn, 'b', alpha=0.75)
    >>> plt.plot(t, z, 'r--', t, z2, 'r', t, y, 'k')
    >>> plt.legend(('noisy signal', 'lfilter, once', 'lfilter, twice',
    ...             'filtfilt'), loc='best')
    >>> plt.grid(True)
    >>> plt.show()

    """
    try:
        xp = array_namespace(b, a, x, zi)
    except TypeError:
        # either in1 or in2 are object arrays
        xp = np_compat

    if is_numpy(xp):
        _reject_objects(x, 'lfilter')
        _reject_objects(a, 'lfilter')
        _reject_objects(b, 'lfilter')

    b = np.atleast_1d(b)
    a = np.atleast_1d(a)
    x = np.asarray(x)
    if zi is not None:
       zi = np.asarray(zi)

    if len(a) == 1:
        # This path only supports types fdgFDGO to mirror _linear_filter below.
        # Any of b, a, x, or zi can set the dtype, but there is no default
        # casting of other types; instead a NotImplementedError is raised.
        b = np.asarray(b)
        a = np.asarray(a)
        if b.ndim != 1 and a.ndim != 1:
            raise ValueError('object of too small depth for desired array')
        x = _validate_x(x)
        inputs = [b, a, x]
        if zi is not None:
            # _linear_filter does not broadcast zi, but does do expansion of
            # singleton dims.
            zi = np.asarray(zi)
            if zi.ndim != x.ndim:
                raise ValueError('object of too small depth for desired array')
            expected_shape = list(x.shape)
            expected_shape[axis] = b.shape[0] - 1
            expected_shape = tuple(expected_shape)
            # check the trivial case where zi is the right shape first
            if zi.shape != expected_shape:
                strides = zi.ndim * [None]
                if axis < 0:
                    axis += zi.ndim
                for k in range(zi.ndim):
                    if k == axis and zi.shape[k] == expected_shape[k]:
                        strides[k] = zi.strides[k]
                    elif k != axis and zi.shape[k] == expected_shape[k]:
                        strides[k] = zi.strides[k]
                    elif k != axis and zi.shape[k] == 1:
                        strides[k] = 0
                    else:
                        raise ValueError('Unexpected shape for zi: expected '
                                         f'{expected_shape}, found {zi.shape}.')
                zi = np.lib.stride_tricks.as_strided(zi, expected_shape,
                                                     strides)
            inputs.append(zi)
        dtype = np.result_type(*inputs)

        if dtype.char not in 'fdgFDGO':
            raise NotImplementedError(f"input type '{dtype}' not supported")

        b = np.array(b, dtype=dtype)
        a = np.asarray(a, dtype=dtype)
        b /= a[0]
        x = np.asarray(x, dtype=dtype)

        out_full = np.apply_along_axis(lambda y: np.convolve(b, y), axis, x)
        ind = out_full.ndim * [slice(None)]
        if zi is not None:
            ind[axis] = slice(zi.shape[axis])
            out_full[tuple(ind)] += zi

        ind[axis] = slice(out_full.shape[axis] - len(b) + 1)
        out = out_full[tuple(ind)]

        if zi is None:
            return xp.asarray(out)
        else:
            ind[axis] = slice(out_full.shape[axis] - len(b) + 1, None)
            zf = out_full[tuple(ind)]
            return xp.asarray(out), xp.asarray(zf)
    else:
        if zi is None:
            result =_sigtools._linear_filter(b, a, x, axis)
            return xp.asarray(result)
        else:
            out, zf = _sigtools._linear_filter(b, a, x, axis, zi)
            return xp.asarray(out), xp.asarray(zf)


def lfiltic(b, a, y, x=None):
    """
    Construct initial conditions for lfilter given input and output vectors.

    Given a linear filter (b, a) and initial conditions on the output `y`
    and the input `x`, return the initial conditions on the state vector zi
    which is used by `lfilter` to generate the output given the input.

    Parameters
    ----------
    b : array_like
        Linear filter term.
    a : array_like
        Linear filter term.
    y : array_like
        Initial conditions.

        If ``N = len(a) - 1``, then ``y = {y[-1], y[-2], ..., y[-N]}``.

        If `y` is too short, it is padded with zeros.
    x : array_like, optional
        Initial conditions.

        If ``M = len(b) - 1``, then ``x = {x[-1], x[-2], ..., x[-M]}``.

        If `x` is not given, its initial conditions are assumed zero.

        If `x` is too short, it is padded with zeros.

    Returns
    -------
    zi : ndarray
        The state vector ``zi = {z_0[-1], z_1[-1], ..., z_K-1[-1]}``,
        where ``K = max(M, N)``.

    See Also
    --------
    lfilter, lfilter_zi

    """
    try:
        xp = array_namespace(a, b, y, x)
    except TypeError:
        xp = np_compat

    if is_numpy(xp):
        _reject_objects(a, 'lfiltic')
        _reject_objects(b, 'lfiltic')
        _reject_objects(y, 'lfiltic')
        if x is not None:
            _reject_objects(x, 'lfiltic')

    a = xpx.atleast_nd(xp.asarray(a), ndim=1, xp=xp)
    b = xpx.atleast_nd(xp.asarray(b), ndim=1, xp=xp)
    if a.ndim > 1:
        raise ValueError('Filter coefficients `a` must be 1-D.')
    if b.ndim > 1:
        raise ValueError('Filter coefficients `b` must be 1-D.')
    N = a.shape[0] - 1
    M = b.shape[0] - 1
    K = max(M, N)
    y = xp.asarray(y)

    if N < 0:
        raise ValueError("There must be at least one `a` coefficient.")

    if x is None:
        result_type = xp.result_type(b, a, y)
        if xp.isdtype(result_type, ('bool', 'integral')):  #'bui':
            result_type = xp.float64
        x = xp.zeros(M, dtype=result_type)
    else:
        x = xp.asarray(x)

        result_type = xp.result_type(b, a, y, x)
        if xp.isdtype(result_type, ('bool', 'integral')):  #'bui':
            result_type = xp.float64
        x = xp.astype(x, result_type)

        L = xp_size(x)
        if L < M:
            x = xp.concat((x, xp.zeros(M - L)))

    y = xp.astype(y, result_type)
    zi = xp.zeros(K, dtype=result_type)

    L = xp_size(y)
    if L < N:
        y = xp.concat((y, xp.zeros(N - L)))

    for m in range(M):
        zi[m] = xp.sum(b[m + 1:] * x[:M - m], axis=0)

    for m in range(N):
        zi[m] -= xp.sum(a[m + 1:] * y[:N - m], axis=0)

    if a[0] != 1.:
        if a[0] == 0.:
            raise ValueError("First `a` filter coefficient must be non-zero.")
        zi /= a[0]

    return zi


def deconvolve(signal, divisor):
    """Deconvolves ``divisor`` out of ``signal`` using inverse filtering.

    Returns the quotient and remainder such that
    ``signal = convolve(divisor, quotient) + remainder``

    Parameters
    ----------
    signal : (N,) array_like
        Signal data, typically a recorded signal
    divisor : (N,) array_like
        Divisor data, typically an impulse response or filter that was
        applied to the original signal

    Returns
    -------
    quotient : ndarray
        Quotient, typically the recovered original signal
    remainder : ndarray
        Remainder

    See Also
    --------
    numpy.polydiv : performs polynomial division (same operation, but
                    also accepts poly1d objects)

    Examples
    --------
    Deconvolve a signal that's been filtered:

    >>> from scipy import signal
    >>> original = [0, 1, 0, 0, 1, 1, 0, 0]
    >>> impulse_response = [2, 1]
    >>> recorded = signal.convolve(impulse_response, original)
    >>> recorded
    array([0, 2, 1, 0, 2, 3, 1, 0, 0])
    >>> recovered, remainder = signal.deconvolve(recorded, impulse_response)
    >>> recovered
    array([ 0.,  1.,  0.,  0.,  1.,  1.,  0.,  0.])

    """
    xp = array_namespace(signal, divisor)

    num = xpx.atleast_nd(xp.asarray(signal), ndim=1, xp=xp)
    den = xpx.atleast_nd(xp.asarray(divisor), ndim=1, xp=xp)
    if num.ndim > 1:
        raise ValueError("signal must be 1-D.")
    if den.ndim > 1:
        raise ValueError("divisor must be 1-D.")
    N = num.shape[0]
    D = den.shape[0]
    if D > N:
        quot = []
        rem = num
    else:
        input = xp.zeros(N - D + 1, dtype=xp.float64)
        input[0] = 1
        quot = lfilter(num, den, input)
        rem = num - convolve(den, quot, mode='full')
    return quot, rem


def hilbert(x, N=None, axis=-1):
    r"""FFT-based computation of the analytic signal.

    The analytic signal is calculated by filtering out the negative frequencies and
    doubling the amplitudes of the positive frequencies in the FFT domain.
    The imaginary part of the result is the hilbert transform of the real-valued input
    signal.
    
    The transformation is done along the last axis by default.

    Parameters
    ----------
    x : array_like
        Signal data.  Must be real.
    N : int, optional
        Number of Fourier components.  Default: ``x.shape[axis]``
    axis : int, optional
        Axis along which to do the transformation.  Default: -1.

    Returns
    -------
    xa : ndarray
        Analytic signal of `x`, of each 1-D array along `axis`

    Notes
    -----
    The analytic signal ``x_a(t)`` of a real-valued signal ``x(t)``
    can be expressed as [1]_

    .. math:: x_a = F^{-1}(F(x) 2U) = x + i y\ ,

    where `F` is the Fourier transform, `U` the unit step function,
    and `y` the Hilbert transform of `x`. [2]_

    In other words, the negative half of the frequency spectrum is zeroed
    out, turning the real-valued signal into a complex-valued signal.  The Hilbert
    transformed signal can be obtained from ``np.imag(hilbert(x))``, and the
    original signal from ``np.real(hilbert(x))``.

    References
    ----------
    .. [1] Wikipedia, "Analytic signal".
           https://en.wikipedia.org/wiki/Analytic_signal
    .. [2] Wikipedia, "Hilbert Transform".
           https://en.wikipedia.org/wiki/Hilbert_transform
    .. [3] Leon Cohen, "Time-Frequency Analysis", 1995. Chapter 2.
    .. [4] Alan V. Oppenheim, Ronald W. Schafer. Discrete-Time Signal
           Processing, Third Edition, 2009. Chapter 12.
           ISBN 13: 978-1292-02572-8

    See Also
    --------
    envelope: Compute envelope of a real- or complex-valued signal.

    Examples
    --------
    In this example we use the Hilbert transform to determine the amplitude
    envelope and instantaneous frequency of an amplitude-modulated signal.

    Let's create a chirp of which the frequency increases from 20 Hz to 100 Hz and
    apply an amplitude modulation:

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy.signal import hilbert, chirp
    ...
    >>> duration, fs = 1, 400  # 1 s signal with sampling frequency of 400 Hz
    >>> t = np.arange(int(fs*duration)) / fs  # timestamps of samples
    >>> signal = chirp(t, 20.0, t[-1], 100.0)
    >>> signal *= (1.0 + 0.5 * np.sin(2.0*np.pi*3.0*t) )

    The amplitude envelope is given by the magnitude of the analytic signal. The
    instantaneous frequency can be obtained by differentiating the
    instantaneous phase in respect to time. The instantaneous phase corresponds
    to the phase angle of the analytic signal.

    >>> analytic_signal = hilbert(signal)
    >>> amplitude_envelope = np.abs(analytic_signal)
    >>> instantaneous_phase = np.unwrap(np.angle(analytic_signal))
    >>> instantaneous_frequency = np.diff(instantaneous_phase) / (2.0*np.pi) * fs
    ...
    >>> fig, (ax0, ax1) = plt.subplots(nrows=2, sharex='all', tight_layout=True)
    >>> ax0.set_title("Amplitude-modulated Chirp Signal")
    >>> ax0.set_ylabel("Amplitude")
    >>> ax0.plot(t, signal, label='Signal')
    >>> ax0.plot(t, amplitude_envelope, label='Envelope')
    >>> ax0.legend()
    >>> ax1.set(xlabel="Time in seconds", ylabel="Phase in rad", ylim=(0, 120))
    >>> ax1.plot(t[1:], instantaneous_frequency, 'C2-', label='Instantaneous Phase')
    >>> ax1.legend()
    >>> plt.show()

    """
    xp = array_namespace(x)

    x = xp.asarray(x)
    if xp.isdtype(x.dtype, 'complex floating'):
        raise ValueError("x must be real.")

    if N is None:
        N = x.shape[axis]
    if N <= 0:
        raise ValueError("N must be positive.")

    Xf = sp_fft.fft(x, N, axis=axis)
    h = xp.zeros(N, dtype=Xf.dtype)
    if N % 2 == 0:
        h[0] = h[N // 2] = 1
        h[1:N // 2] = 2
    else:
        h[0] = 1
        h[1:(N + 1) // 2] = 2

    if x.ndim > 1:
        ind = [xp.newaxis] * x.ndim
        ind[axis] = slice(None)
        h = h[tuple(ind)]
    x = sp_fft.ifft(Xf * h, axis=axis)
    return x


def hilbert2(x, N=None):
    """
    Compute the '2-D' analytic signal of `x`

    Parameters
    ----------
    x : array_like
        2-D signal data.
    N : int or tuple of two ints, optional
        Number of Fourier components. Default is ``x.shape``

    Returns
    -------
    xa : ndarray
        Analytic signal of `x` taken along axes (0,1).

    References
    ----------
    .. [1] Wikipedia, "Analytic signal",
        https://en.wikipedia.org/wiki/Analytic_signal

    """
    xp = array_namespace(x)
    x = xpx.atleast_nd(xp.asarray(x), ndim=2, xp=xp)
    if x.ndim > 2:
        raise ValueError("x must be 2-D.")
    if xp.isdtype(x.dtype, 'complex floating'):
        raise ValueError("x must be real.")

    if N is None:
        N = x.shape
    elif isinstance(N, int):
        if N <= 0:
            raise ValueError("N must be positive.")
        N = (N, N)
    elif len(N) != 2 or xp.any(xp.asarray(N) <= 0):
        raise ValueError("When given as a tuple, N must hold exactly "
                         "two positive integers")

    Xf = sp_fft.fft2(x, N, axes=(0, 1))
    h1 = xp.zeros(N[0], dtype=Xf.dtype)
    h2 = xp.zeros(N[1], dtype=Xf.dtype)
    for h in (h1, h2):
        N1 = h.shape[0]
        if N1 % 2 == 0:
            h[0] = h[N1 // 2] = 1
            h[1:N1 // 2] = 2
        else:
            h[0] = 1
            h[1:(N1 + 1) // 2] = 2

    h = h1[:, xp.newaxis] * h2[xp.newaxis, :]
    k = x.ndim
    while k > 2:
        h = h[:, xp.newaxis]
        k -= 1
    x = sp_fft.ifft2(Xf * h, axes=(0, 1))
    return x


def envelope(z, bp_in: tuple[int | None, int | None] = (1, None), *,
             n_out: int | None = None, squared: bool = False,
             residual: Literal['lowpass', 'all', None] = 'lowpass',
             axis: int = -1):
    r"""Compute the envelope of a real- or complex-valued signal.

    Parameters
    ----------
    z : ndarray
        Real- or complex-valued input signal, which is assumed to be made up of ``n``
        samples and having sampling interval ``T``. `z` may also be a multidimensional
        array with the time axis being defined by `axis`.
    bp_in : tuple[int | None, int | None], optional
        2-tuple defining the frequency band ``bp_in[0]:bp_in[1]`` of the input filter.
        The corner frequencies are specified as integer multiples of ``1/(n*T)`` with
        ``-n//2 <= bp_in[0] < bp_in[1] <= (n+1)//2`` being the allowed frequency range.
        ``None`` entries are replaced with ``-n//2`` or ``(n+1)//2`` respectively. The
        default of ``(1, None)`` removes the mean value as well as the negative
        frequency components.
    n_out : int | None, optional
        If not ``None`` the output will be resampled to `n_out` samples. The default
        of ``None`` sets the output to the same length as the input `z`.
    squared : bool, optional
        If set, the square of the envelope is returned. The bandwidth of the squared
        envelope is often smaller than the non-squared envelope bandwidth due to the
        nonlinear nature of the utilized absolute value function. I.e., the embedded
        square root function typically produces addiational harmonics.
        The default is ``False``.
    residual : Literal['lowpass', 'all', None], optional
        This option determines what kind of residual, i.e., the signal part which the
        input bandpass filter removes, is returned. ``'all'`` returns everything except
        the contents of the frequency band ``bp_in[0]:bp_in[1]``, ``'lowpass'``
        returns the contents of the frequency band ``< bp_in[0]``. If ``None`` then
        only the envelope is returned. Default: ``'lowpass'``.
    axis : int, optional
       Axis of `z` over which to compute the envelope. Default is last the axis.

    Returns
    -------
    ndarray
        If parameter `residual` is ``None`` then an array ``z_env`` with the same shape
        as the input `z` is returned, containing its envelope. Otherwise, an array with
        shape ``(2, *z.shape)``, containing the arrays ``z_env`` and ``z_res``, stacked
        along the first axis, is returned.
        It allows unpacking, i.e., ``z_env, z_res = envelope(z, residual='all')``.
        The residual ``z_res`` contains the signal part which the input bandpass filter
        removed, depending on the parameter `residual`. Note that for real-valued
        signals, a real-valued residual is returned. Hence, the negative frequency
        components of `bp_in` are ignored.

    Notes
    -----
    Any complex-valued signal :math:`z(t)` can be described by a real-valued
    instantaneous amplitude :math:`a(t)` and a real-valued instantaneous phase
    :math:`\phi(t)`, i.e., :math:`z(t) = a(t) \exp\!\big(j \phi(t)\big)`. The
    envelope is defined as the absolute value of the amplitude :math:`|a(t)| = |z(t)|`,
    which is at the same time the absolute value of the signal. Hence, :math:`|a(t)|`
    "envelopes" the class of all signals with amplitude :math:`a(t)` and arbitrary
    phase :math:`\phi(t)`.
    For real-valued signals, :math:`x(t) = a(t) \cos\!\big(\phi(t)\big)` is the
    analogous formulation. Hence, :math:`|a(t)|` can be determined by converting
    :math:`x(t)` into an analytic signal :math:`z_a(t)` by means of a Hilbert
    transform, i.e.,
    :math:`z_a(t) = a(t) \cos\!\big(\phi(t)\big) + j a(t) \sin\!\big(\phi(t) \big)`,
    which produces a complex-valued signal with the same envelope :math:`|a(t)|`.

    The implementation is based on computing the FFT of the input signal and then
    performing the necessary operations in Fourier space. Hence, the typical FFT
    caveats need to be taken into account:

    * The signal is assumed to be periodic. Discontinuities between signal start and
      end can lead to unwanted results due to Gibbs phenomenon.
    * The FFT is slow if the signal length is prime or very long. Also, the memory
      demands are typically higher than a comparable FIR/IIR filter based
      implementation.
    * The frequency spacing ``1 / (n*T)`` for corner frequencies of the bandpass filter
      corresponds to the frequencies produced by ``scipy.fft.fftfreq(len(z), T)``.

    If the envelope of a complex-valued signal `z` with no bandpass filtering is
    desired, i.e., ``bp_in=(None, None)``, then the envelope corresponds to the
    absolute value. Hence, it is more efficient to use ``np.abs(z)`` instead of this
    function.

    Although computing the envelope based on the analytic signal [1]_ is the natural
    method for real-valued signals, other methods are also frequently used. The most
    popular alternative is probably the so-called "square-law" envelope detector and
    its relatives [2]_. They do not always compute the correct result for all kinds of
    signals, but are usually correct and typically computationally more efficient for
    most kinds of narrowband signals. The definition for an envelope presented here is
    common where instantaneous amplitude and phase are of interest (e.g., as described
    in [3]_). There exist also other concepts, which rely on the general mathematical
    idea of an envelope [4]_: A pragmatic approach is to determine all upper and lower
    signal peaks and use a spline interpolation to determine the curves [5]_.


    References
    ----------
    .. [1] "Analytic Signal", Wikipedia,
       https://en.wikipedia.org/wiki/Analytic_signal
    .. [2] Lyons, Richard, "Digital envelope detection: The good, the bad, and the
       ugly", IEEE Signal Processing Magazine 34.4 (2017): 183-187.
       `PDF <https://community.infineon.com/gfawx74859/attachments/gfawx74859/psoc135/46469/1/R.%20Lyons_envelope_detection_v3.pdf>`__
    .. [3] T.G. Kincaid, "The complex representation of signals.",
       TIS R67# MH5, General Electric Co. (1966).
       `PDF <https://apps.dtic.mil/sti/tr/pdf/ADA953296.pdf>`__
    .. [4] "Envelope (mathematics)", Wikipedia,
       https://en.wikipedia.org/wiki/Envelope_(mathematics)
    .. [5] Yang, Yanli. "A signal theoretic approach for envelope analysis of
       real-valued signals." IEEE Access 5 (2017): 5623-5630.
       `PDF <https://ieeexplore.ieee.org/iel7/6287639/6514899/07891054.pdf>`__


    See Also
    --------
    hilbert: Compute analytic signal by means of Hilbert transform.


    Examples
    --------
    The following plot illustrates the envelope of a signal with variable frequency and
    a low-frequency drift. To separate the drift from the envelope, a 4 Hz highpass
    filter is used. The low-pass residuum of the input bandpass filter is utilized to
    determine an asymmetric upper and lower bound to enclose the signal. Due to the
    smoothness of the resulting envelope, it is down-sampled from 500 to 40 samples.
    Note that the instantaneous amplitude ``a_x`` and the computed envelope ``x_env``
    are not perfectly identical. This is due to the signal not being perfectly periodic
    as well as the existence of some spectral overlapping of ``x_carrier`` and
    ``x_drift``. Hence, they cannot be completely separated by a bandpass filter.

    >>> import matplotlib.pyplot as plt
    >>> import numpy as np
    >>> from scipy.signal.windows import gaussian
    >>> from scipy.signal import envelope
    ...
    >>> n, n_out = 500, 40  # number of signal samples and envelope samples
    >>> T = 2 / n  # sampling interval for 2 s duration
    >>> t = np.arange(n) * T  # time stamps
    >>> a_x = gaussian(len(t), 0.4/T)  # instantaneous amplitude
    >>> phi_x = 30*np.pi*t + 35*np.cos(2*np.pi*0.25*t)  # instantaneous phase
    >>> x_carrier = a_x * np.cos(phi_x)
    >>> x_drift = 0.3 * gaussian(len(t), 0.4/T)  # drift
    >>> x = x_carrier + x_drift
    ...
    >>> bp_in = (int(4 * (n*T)), None)  # 4 Hz highpass input filter
    >>> x_env, x_res = envelope(x, bp_in, n_out=n_out)
    >>> t_out = np.arange(n_out) * (n / n_out) * T
    ...
    >>> fg0, ax0 = plt.subplots(1, 1, tight_layout=True)
    >>> ax0.set_title(r"$4\,$Hz Highpass Envelope of Drifting Signal")
    >>> ax0.set(xlabel="Time in seconds", xlim=(0, n*T), ylabel="Amplitude")
    >>> ax0.plot(t, x, 'C0-', alpha=0.5, label="Signal")
    >>> ax0.plot(t, x_drift, 'C2--', alpha=0.25, label="Drift")
    >>> ax0.plot(t_out, x_res+x_env, 'C1.-', alpha=0.5, label="Envelope")
    >>> ax0.plot(t_out, x_res-x_env, 'C1.-', alpha=0.5, label=None)
    >>> ax0.grid(True)
    >>> ax0.legend()
    >>> plt.show()

    The second example provides a geometric envelope interpretation of complex-valued
    signals: The following two plots show the complex-valued signal as a blue
    3d-trajectory and the envelope as an orange round tube with varying diameter, i.e.,
    as :math:`|a(t)| \exp(j\rho(t))`, with :math:`\rho(t)\in[-\pi,\pi]`. Also, the
    projection into the 2d real and imaginary coordinate planes of trajectory and tube
    is depicted. Every point of the complex-valued signal touches the tube's surface.

    The left plot shows an analytic signal, i.e, the phase difference between
    imaginary and real part is always 90 degrees, resulting in a spiraling trajectory.
    It can be seen that in this case the real part has also the expected envelope,
    i.e., representing the absolute value of the instantaneous amplitude.

    The right plot shows the real part of that analytic signal being interpreted
    as a complex-vauled signal, i.e., having zero imaginary part. There the resulting
    envelope is not as smooth as in the analytic case and the instantaneous amplitude
    in the real plane is not recovered. If ``z_re`` had been passed as a real-valued
    signal, i.e., as ``z_re = z.real`` instead of ``z_re = z.real + 0j``, the result
    would have been identical to the left plot. The reason for this is that real-valued
    signals are interpreted as being the real part of a complex-valued analytic signal.

    >>> import matplotlib.pyplot as plt
    >>> import numpy as np
    >>> from scipy.signal.windows import gaussian
    >>> from scipy.signal import envelope
    ...
    >>> n, T = 1000, 1/1000  # number of samples and sampling interval
    >>> t = np.arange(n) * T  # time stamps for 1 s duration
    >>> f_c = 3  # Carrier frequency for signal
    >>> z = gaussian(len(t), 0.3/T) * np.exp(2j*np.pi*f_c*t)  # analytic signal
    >>> z_re = z.real + 0j  # complex signal with zero imaginary part
    ...
    >>> e_a, e_r = (envelope(z_, (None, None), residual=None) for z_ in (z, z_re))
    ...
    >>> # Generate grids to visualize envelopes as 2d and 3d surfaces:
    >>> E2d_t, E2_amp = np.meshgrid(t, [-1, 1])
    >>> E2d_1 = np.ones_like(E2_amp)
    >>> E3d_t, E3d_phi = np.meshgrid(t, np.linspace(-np.pi, np.pi, 300))
    >>> ma = 1.8  # maximum axis values in real and imaginary direction
    ...
    >>> fg0 = plt.figure(figsize=(6.2, 4.))
    >>> ax00 = fg0.add_subplot(1, 2, 1, projection='3d')
    >>> ax01 = fg0.add_subplot(1, 2, 2, projection='3d', sharex=ax00,
    ...                        sharey=ax00, sharez=ax00)
    >>> ax00.set_title("Analytic Signal")
    >>> ax00.set(xlim=(0, 1), ylim=(-ma, ma), zlim=(-ma, ma))
    >>> ax01.set_title("Real-valued Signal")
    >>> for z_, e_, ax_ in zip((z, z.real), (e_a, e_r), (ax00, ax01)):
    ...     ax_.set(xlabel="Time $t$", ylabel="Real Amp. $x(t)$",
    ...             zlabel="Imag. Amp. $y(t)$")
    ...     ax_.plot(t, z_.real, 'C0-', zs=-ma, zdir='z', alpha=0.5, label="Real")
    ...     ax_.plot_surface(E2d_t, e_*E2_amp, -ma*E2d_1, color='C1', alpha=0.25)
    ...     ax_.plot(t, z_.imag, 'C0-', zs=+ma, zdir='y', alpha=0.5, label="Imag.")
    ...     ax_.plot_surface(E2d_t, ma*E2d_1, e_*E2_amp, color='C1', alpha=0.25)
    ...     ax_.plot(t, z_.real, z_.imag, 'C0-', label="Signal")
    ...     ax_.plot_surface(E3d_t, e_*np.cos(E3d_phi), e_*np.sin(E3d_phi),
    ...                      color='C1', alpha=0.5, shade=True, label="Envelope")
    ...     ax_.view_init(elev=22.7, azim=-114.3)
    >>> fg0.subplots_adjust(left=0.08, right=0.97, wspace=0.15)
    >>> plt.show()
    """
    xp = array_namespace(z)
    if not (-z.ndim <= axis < z.ndim):
        raise ValueError(f"Invalid parameter {axis=} for {z.shape=}!")
    if not (z.shape[axis] > 0):
        raise ValueError(f"z.shape[axis] not > 0 for {z.shape=}, {axis=}!")
    if len(bp_in) != 2 or not all((isinstance(b_, int) or b_ is None) for b_ in bp_in):
        raise ValueError(f"{bp_in=} isn't a 2-tuple of type (int | None, int | None)!")
    if not ((isinstance(n_out, int) and 0 < n_out) or n_out is None):
        raise ValueError(f"{n_out=} is not a positive integer or None!")
    if residual not in ('lowpass', 'all', None):
        raise ValueError(f"{residual=} not in ['lowpass', 'all', None]!")

    n = z.shape[axis]  # number of time samples of input
    n_out = n if n_out is None else n_out
    fak = n_out / n  # scaling factor for resampling

    bp = slice(bp_in[0] if bp_in[0] is not None else -(n//2),
               bp_in[1] if bp_in[1] is not None else (n+1)//2)
    if not (-n//2 <= bp.start < bp.stop <= (n+1)//2):
        raise ValueError("`-n//2 <= bp_in[0] < bp_in[1] <= (n+1)//2` does not hold " +
                         f"for n={z.shape[axis]=} and {bp_in=}!")

    # moving active axis to end allows to use `...` for indexing:
    z = xp.moveaxis(z, axis, -1)

    if xp.isdtype(z.dtype, 'complex floating'):
        Z = sp_fft.fft(z)
    else:  # avoid calculating negative frequency bins for real signals:
        dt = sp_fft.rfft(z[..., :1]).dtype
        Z = xp.zeros_like(z, dtype=dt)
        Z[..., :n//2 + 1] = sp_fft.rfft(z)
        if bp.start > 0:  # make signal analytic within bp_in band:
            Z[..., bp] *= 2
        elif bp.stop > 0:
            Z[..., 1:bp.stop] *= 2
    if not (bp.start <= 0 < bp.stop):  # envelope is invariant to freq. shifts.
        z_bb = sp_fft.ifft(Z[..., bp], n=n_out) * fak  # baseband signal
    else:
        bp_shift = slice(bp.start + n//2, bp.stop + n//2)
        z_bb = sp_fft.ifft(sp_fft.fftshift(Z, axes=-1)[..., bp_shift], n=n_out) * fak

    z_env = xp.abs(z_bb) if not squared else xp.real(z_bb) ** 2 + xp.imag(z_bb) ** 2
    z_env = xp.moveaxis(z_env, -1, axis)

    # Calculate the residual from the input bandpass filter:
    if residual is None:
        return z_env
    if not (bp.start <= 0 < bp.stop):
        Z[..., bp] = 0
    else:
        Z[..., :bp.stop], Z[..., bp.start:] = 0, 0
    if residual == 'lowpass':
        if bp.stop > 0:
            Z[..., bp.stop:(n+1) // 2] = 0
        else:
            Z[..., bp.start:], Z[..., 0:(n + 1) // 2] = 0, 0

    if xp.isdtype(z.dtype, 'complex floating'):  # resample accounts for unpaired bins:
        z_res = resample(Z, n_out, axis=-1, domain='freq')  # ifft() with corrections
    else:  # account for unpaired bin at m//2 before doing irfft():
        if n_out != n and (m := min(n, n_out)) % 2 == 0:
            Z[..., m//2] *= 2 if n_out < n else 0.5
        z_res = fak * sp_fft.irfft(Z, n=n_out)
    return xp.stack((z_env, xp.moveaxis(z_res, -1, axis)), axis=0)


def _cmplx_sort(p):
    """Sort roots based on magnitude.

    Parameters
    ----------
    p : array_like
        The roots to sort, as a 1-D array.

    Returns
    -------
    p_sorted : ndarray
        Sorted roots.
    indx : ndarray
        Array of indices needed to sort the input `p`.

    Examples
    --------
    >>> from scipy import signal
    >>> vals = [1, 4, 1+1.j, 3]
    >>> p_sorted, indx = signal.cmplx_sort(vals)
    >>> p_sorted
    array([1.+0.j, 1.+1.j, 3.+0.j, 4.+0.j])
    >>> indx
    array([0, 2, 3, 1])
    """
    p = np.asarray(p)
    indx = np.argsort(abs(p))
    return np.take(p, indx, 0), indx


def unique_roots(p, tol=1e-3, rtype='min'):
    """Determine unique roots and their multiplicities from a list of roots.

    Parameters
    ----------
    p : array_like
        The list of roots.
    tol : float, optional
        The tolerance for two roots to be considered equal in terms of
        the distance between them. Default is 1e-3. Refer to Notes about
        the details on roots grouping.
    rtype : {'max', 'maximum', 'min', 'minimum', 'avg', 'mean'}, optional
        How to determine the returned root if multiple roots are within
        `tol` of each other.

          - 'max', 'maximum': pick the maximum of those roots
          - 'min', 'minimum': pick the minimum of those roots
          - 'avg', 'mean': take the average of those roots

        When finding minimum or maximum among complex roots they are compared
        first by the real part and then by the imaginary part.

    Returns
    -------
    unique : ndarray
        The list of unique roots.
    multiplicity : ndarray
        The multiplicity of each root.

    Notes
    -----
    If we have 3 roots ``a``, ``b`` and ``c``, such that ``a`` is close to
    ``b`` and ``b`` is close to ``c`` (distance is less than `tol`), then it
    doesn't necessarily mean that ``a`` is close to ``c``. It means that roots
    grouping is not unique. In this function we use "greedy" grouping going
    through the roots in the order they are given in the input `p`.

    This utility function is not specific to roots but can be used for any
    sequence of values for which uniqueness and multiplicity has to be
    determined. For a more general routine, see `numpy.unique`.

    Examples
    --------
    >>> from scipy import signal
    >>> vals = [0, 1.3, 1.31, 2.8, 1.25, 2.2, 10.3]
    >>> uniq, mult = signal.unique_roots(vals, tol=2e-2, rtype='avg')

    Check which roots have multiplicity larger than 1:

    >>> uniq[mult > 1]
    array([ 1.305])
    """
    if rtype in ['max', 'maximum']:
        reduce = np.max
    elif rtype in ['min', 'minimum']:
        reduce = np.min
    elif rtype in ['avg', 'mean']:
        reduce = np.mean
    else:
        raise ValueError("`rtype` must be one of "
                         "{'max', 'maximum', 'min', 'minimum', 'avg', 'mean'}")

    p = np.asarray(p)

    points = np.empty((len(p), 2))
    points[:, 0] = np.real(p)
    points[:, 1] = np.imag(p)
    tree = cKDTree(points)

    p_unique = []
    p_multiplicity = []
    used = np.zeros(len(p), dtype=bool)
    for i in range(len(p)):
        if used[i]:
            continue

        group = tree.query_ball_point(points[i], tol)
        group = [x for x in group if not used[x]]

        p_unique.append(reduce(p[group]))
        p_multiplicity.append(len(group))

        used[group] = True

    return np.asarray(p_unique), np.asarray(p_multiplicity)


def invres(r, p, k, tol=1e-3, rtype='avg'):
    """Compute b(s) and a(s) from partial fraction expansion.

    If `M` is the degree of numerator `b` and `N` the degree of denominator
    `a`::

              b(s)     b[0] s**(M) + b[1] s**(M-1) + ... + b[M]
      H(s) = ------ = ------------------------------------------
              a(s)     a[0] s**(N) + a[1] s**(N-1) + ... + a[N]

    then the partial-fraction expansion H(s) is defined as::

               r[0]       r[1]             r[-1]
           = -------- + -------- + ... + --------- + k(s)
             (s-p[0])   (s-p[1])         (s-p[-1])

    If there are any repeated roots (closer together than `tol`), then H(s)
    has terms like::

          r[i]      r[i+1]              r[i+n-1]
        -------- + ----------- + ... + -----------
        (s-p[i])  (s-p[i])**2          (s-p[i])**n

    This function is used for polynomials in positive powers of s or z,
    such as analog filters or digital filters in controls engineering.  For
    negative powers of z (typical for digital filters in DSP), use `invresz`.

    Parameters
    ----------
    r : array_like
        Residues corresponding to the poles. For repeated poles, the residues
        must be ordered to correspond to ascending by power fractions.
    p : array_like
        Poles. Equal poles must be adjacent.
    k : array_like
        Coefficients of the direct polynomial term.
    tol : float, optional
        The tolerance for two roots to be considered equal in terms of
        the distance between them. Default is 1e-3. See `unique_roots`
        for further details.
    rtype : {'avg', 'min', 'max'}, optional
        Method for computing a root to represent a group of identical roots.
        Default is 'avg'. See `unique_roots` for further details.

    Returns
    -------
    b : ndarray
        Numerator polynomial coefficients.
    a : ndarray
        Denominator polynomial coefficients.

    See Also
    --------
    residue, invresz, unique_roots

    """
    r = np.atleast_1d(r)
    p = np.atleast_1d(p)
    k = np.trim_zeros(np.atleast_1d(k), 'f')

    unique_poles, multiplicity = _group_poles(p, tol, rtype)
    factors, denominator = _compute_factors(unique_poles, multiplicity,
                                            include_powers=True)

    if len(k) == 0:
        numerator = 0
    else:
        numerator = np.polymul(k, denominator)

    for residue, factor in zip(r, factors):
        numerator = np.polyadd(numerator, residue * factor)

    return numerator, denominator


def _compute_factors(roots, multiplicity, include_powers=False):
    """Compute the total polynomial divided by factors for each root."""
    current = np.array([1])
    suffixes = [current]
    for pole, mult in zip(roots[-1:0:-1], multiplicity[-1:0:-1]):
        monomial = np.array([1, -pole])
        for _ in range(mult):
            current = np.polymul(current, monomial)
        suffixes.append(current)
    suffixes = suffixes[::-1]

    factors = []
    current = np.array([1])
    for pole, mult, suffix in zip(roots, multiplicity, suffixes):
        monomial = np.array([1, -pole])
        block = []
        for i in range(mult):
            if i == 0 or include_powers:
                block.append(np.polymul(current, suffix))
            current = np.polymul(current, monomial)
        factors.extend(reversed(block))

    return factors, current


def _compute_residues(poles, multiplicity, numerator):
    denominator_factors, _ = _compute_factors(poles, multiplicity)
    numerator = numerator.astype(poles.dtype)

    residues = []
    for pole, mult, factor in zip(poles, multiplicity,
                                  denominator_factors):
        if mult == 1:
            residues.append(np.polyval(numerator, pole) /
                            np.polyval(factor, pole))
        else:
            numer = numerator.copy()
            monomial = np.array([1, -pole])
            factor, d = np.polydiv(factor, monomial)

            block = []
            for _ in range(mult):
                numer, n = np.polydiv(numer, monomial)
                r = n[0] / d[0]
                numer = np.polysub(numer, r * factor)
                block.append(r)

            residues.extend(reversed(block))

    return np.asarray(residues)


def residue(b, a, tol=1e-3, rtype='avg'):
    """Compute partial-fraction expansion of b(s) / a(s).

    If `M` is the degree of numerator `b` and `N` the degree of denominator
    `a`::

              b(s)     b[0] s**(M) + b[1] s**(M-1) + ... + b[M]
      H(s) = ------ = ------------------------------------------
              a(s)     a[0] s**(N) + a[1] s**(N-1) + ... + a[N]

    then the partial-fraction expansion H(s) is defined as::

               r[0]       r[1]             r[-1]
           = -------- + -------- + ... + --------- + k(s)
             (s-p[0])   (s-p[1])         (s-p[-1])

    If there are any repeated roots (closer together than `tol`), then H(s)
    has terms like::

          r[i]      r[i+1]              r[i+n-1]
        -------- + ----------- + ... + -----------
        (s-p[i])  (s-p[i])**2          (s-p[i])**n

    This function is used for polynomials in positive powers of s or z,
    such as analog filters or digital filters in controls engineering.  For
    negative powers of z (typical for digital filters in DSP), use `residuez`.

    See Notes for details about the algorithm.

    Parameters
    ----------
    b : array_like
        Numerator polynomial coefficients.
    a : array_like
        Denominator polynomial coefficients.
    tol : float, optional
        The tolerance for two roots to be considered equal in terms of
        the distance between them. Default is 1e-3. See `unique_roots`
        for further details.
    rtype : {'avg', 'min', 'max'}, optional
        Method for computing a root to represent a group of identical roots.
        Default is 'avg'. See `unique_roots` for further details.

    Returns
    -------
    r : ndarray
        Residues corresponding to the poles. For repeated poles, the residues
        are ordered to correspond to ascending by power fractions.
    p : ndarray
        Poles ordered by magnitude in ascending order.
    k : ndarray
        Coefficients of the direct polynomial term.

    See Also
    --------
    invres, residuez, numpy.poly, unique_roots

    Notes
    -----
    The "deflation through subtraction" algorithm is used for
    computations --- method 6 in [1]_.

    The form of partial fraction expansion depends on poles multiplicity in
    the exact mathematical sense. However there is no way to exactly
    determine multiplicity of roots of a polynomial in numerical computing.
    Thus you should think of the result of `residue` with given `tol` as
    partial fraction expansion computed for the denominator composed of the
    computed poles with empirically determined multiplicity. The choice of
    `tol` can drastically change the result if there are close poles.

    References
    ----------
    .. [1] J. F. Mahoney, B. D. Sivazlian, "Partial fractions expansion: a
           review of computational methodology and efficiency", Journal of
           Computational and Applied Mathematics, Vol. 9, 1983.
    """
    b = np.asarray(b)
    a = np.asarray(a)
    if (np.issubdtype(b.dtype, np.complexfloating)
            or np.issubdtype(a.dtype, np.complexfloating)):
        b = b.astype(complex)
        a = a.astype(complex)
    else:
        b = b.astype(float)
        a = a.astype(float)

    b = np.trim_zeros(np.atleast_1d(b), 'f')
    a = np.trim_zeros(np.atleast_1d(a), 'f')

    if a.size == 0:
        raise ValueError("Denominator `a` is zero.")

    poles = np.roots(a)
    if b.size == 0:
        return np.zeros(poles.shape), _cmplx_sort(poles)[0], np.array([])

    if len(b) < len(a):
        k = np.empty(0)
    else:
        k, b = np.polydiv(b, a)

    unique_poles, multiplicity = unique_roots(poles, tol=tol, rtype=rtype)
    unique_poles, order = _cmplx_sort(unique_poles)
    multiplicity = multiplicity[order]

    residues = _compute_residues(unique_poles, multiplicity, b)

    index = 0
    for pole, mult in zip(unique_poles, multiplicity):
        poles[index:index + mult] = pole
        index += mult

    return residues / a[0], poles, k


def residuez(b, a, tol=1e-3, rtype='avg'):
    """Compute partial-fraction expansion of b(z) / a(z).

    If `M` is the degree of numerator `b` and `N` the degree of denominator
    `a`::

                b(z)     b[0] + b[1] z**(-1) + ... + b[M] z**(-M)
        H(z) = ------ = ------------------------------------------
                a(z)     a[0] + a[1] z**(-1) + ... + a[N] z**(-N)

    then the partial-fraction expansion H(z) is defined as::

                 r[0]                   r[-1]
         = --------------- + ... + ---------------- + k[0] + k[1]z**(-1) ...
           (1-p[0]z**(-1))         (1-p[-1]z**(-1))

    If there are any repeated roots (closer than `tol`), then the partial
    fraction expansion has terms like::

             r[i]              r[i+1]                    r[i+n-1]
        -------------- + ------------------ + ... + ------------------
        (1-p[i]z**(-1))  (1-p[i]z**(-1))**2         (1-p[i]z**(-1))**n

    This function is used for polynomials in negative powers of z,
    such as digital filters in DSP.  For positive powers, use `residue`.

    See Notes of `residue` for details about the algorithm.

    Parameters
    ----------
    b : array_like
        Numerator polynomial coefficients.
    a : array_like
        Denominator polynomial coefficients.
    tol : float, optional
        The tolerance for two roots to be considered equal in terms of
        the distance between them. Default is 1e-3. See `unique_roots`
        for further details.
    rtype : {'avg', 'min', 'max'}, optional
        Method for computing a root to represent a group of identical roots.
        Default is 'avg'. See `unique_roots` for further details.

    Returns
    -------
    r : ndarray
        Residues corresponding to the poles. For repeated poles, the residues
        are ordered to correspond to ascending by power fractions.
    p : ndarray
        Poles ordered by magnitude in ascending order.
    k : ndarray
        Coefficients of the direct polynomial term.

    See Also
    --------
    invresz, residue, unique_roots
    """
    b = np.asarray(b)
    a = np.asarray(a)
    if (np.issubdtype(b.dtype, np.complexfloating)
            or np.issubdtype(a.dtype, np.complexfloating)):
        b = b.astype(complex)
        a = a.astype(complex)
    else:
        b = b.astype(float)
        a = a.astype(float)

    b = np.trim_zeros(np.atleast_1d(b), 'b')
    a = np.trim_zeros(np.atleast_1d(a), 'b')

    if a.size == 0:
        raise ValueError("Denominator `a` is zero.")
    elif a[0] == 0:
        raise ValueError("First coefficient of determinant `a` must be "
                         "non-zero.")

    poles = np.roots(a)
    if b.size == 0:
        return np.zeros(poles.shape), _cmplx_sort(poles)[0], np.array([])

    b_rev = b[::-1]
    a_rev = a[::-1]

    if len(b_rev) < len(a_rev):
        k_rev = np.empty(0)
    else:
        k_rev, b_rev = np.polydiv(b_rev, a_rev)

    unique_poles, multiplicity = unique_roots(poles, tol=tol, rtype=rtype)
    unique_poles, order = _cmplx_sort(unique_poles)
    multiplicity = multiplicity[order]

    residues = _compute_residues(1 / unique_poles, multiplicity, b_rev)

    index = 0
    powers = np.empty(len(residues), dtype=int)
    for pole, mult in zip(unique_poles, multiplicity):
        poles[index:index + mult] = pole
        powers[index:index + mult] = 1 + np.arange(mult)
        index += mult

    residues *= (-poles) ** powers / a_rev[0]

    return residues, poles, k_rev[::-1]


def _group_poles(poles, tol, rtype):
    if rtype in ['max', 'maximum']:
        reduce = np.max
    elif rtype in ['min', 'minimum']:
        reduce = np.min
    elif rtype in ['avg', 'mean']:
        reduce = np.mean
    else:
        raise ValueError("`rtype` must be one of "
                         "{'max', 'maximum', 'min', 'minimum', 'avg', 'mean'}")

    unique = []
    multiplicity = []

    pole = poles[0]
    block = [pole]
    for i in range(1, len(poles)):
        if abs(poles[i] - pole) <= tol:
            block.append(pole)
        else:
            unique.append(reduce(block))
            multiplicity.append(len(block))
            pole = poles[i]
            block = [pole]

    unique.append(reduce(block))
    multiplicity.append(len(block))

    return np.asarray(unique), np.asarray(multiplicity)


def invresz(r, p, k, tol=1e-3, rtype='avg'):
    """Compute b(z) and a(z) from partial fraction expansion.

    If `M` is the degree of numerator `b` and `N` the degree of denominator
    `a`::

                b(z)     b[0] + b[1] z**(-1) + ... + b[M] z**(-M)
        H(z) = ------ = ------------------------------------------
                a(z)     a[0] + a[1] z**(-1) + ... + a[N] z**(-N)

    then the partial-fraction expansion H(z) is defined as::

                 r[0]                   r[-1]
         = --------------- + ... + ---------------- + k[0] + k[1]z**(-1) ...
           (1-p[0]z**(-1))         (1-p[-1]z**(-1))

    If there are any repeated roots (closer than `tol`), then the partial
    fraction expansion has terms like::

             r[i]              r[i+1]                    r[i+n-1]
        -------------- + ------------------ + ... + ------------------
        (1-p[i]z**(-1))  (1-p[i]z**(-1))**2         (1-p[i]z**(-1))**n

    This function is used for polynomials in negative powers of z,
    such as digital filters in DSP.  For positive powers, use `invres`.

    Parameters
    ----------
    r : array_like
        Residues corresponding to the poles. For repeated poles, the residues
        must be ordered to correspond to ascending by power fractions.
    p : array_like
        Poles. Equal poles must be adjacent.
    k : array_like
        Coefficients of the direct polynomial term.
    tol : float, optional
        The tolerance for two roots to be considered equal in terms of
        the distance between them. Default is 1e-3. See `unique_roots`
        for further details.
    rtype : {'avg', 'min', 'max'}, optional
        Method for computing a root to represent a group of identical roots.
        Default is 'avg'. See `unique_roots` for further details.

    Returns
    -------
    b : ndarray
        Numerator polynomial coefficients.
    a : ndarray
        Denominator polynomial coefficients.

    See Also
    --------
    residuez, unique_roots, invres

    """
    r = np.atleast_1d(r)
    p = np.atleast_1d(p)
    k = np.trim_zeros(np.atleast_1d(k), 'b')

    unique_poles, multiplicity = _group_poles(p, tol, rtype)
    factors, denominator = _compute_factors(unique_poles, multiplicity,
                                            include_powers=True)

    if len(k) == 0:
        numerator = 0
    else:
        numerator = np.polymul(k[::-1], denominator[::-1])

    for residue, factor in zip(r, factors):
        numerator = np.polyadd(numerator, residue * factor[::-1])

    return numerator[::-1], denominator


def resample(x, num, t=None, axis=0, window=None, domain='time'):
    r"""Resample `x` to `num` samples using the Fourier method along the given `axis`.

    The resampling is performed by shortening or zero-padding the FFT of `x`. This has
    the advantages of providing an ideal antialiasing filter and allowing arbitrary
    up- or down-sampling ratios. The main drawback is the requirement of assuming `x`
    to be a periodic signal.

    Parameters
    ----------
    x : array_like
        The input signal made up of equidistant samples. If `x` is a multidimensional
        array, the parameter `axis` specifies the time/frequency axis. It is assumed
        here that ``n_x = x.shape[axis]`` specifies the number of samples and ``T`` the
        sampling interval.
    num : int
        The number of samples of the resampled output signal. It may be larger or
        smaller than ``n_x``.
    t : array_like, optional
        If `t` is not ``None``, then the timestamps of the resampled signal are also
        returned. `t` must contain at least the first two timestamps of the input
        signal `x` (all others are ignored). The timestamps of the output signal are
        determined by ``t[0] + T * n_x / num * np.arange(num)`` with
        ``T = t[1] - t[0]``. Default is ``None``.
    axis : int, optional
        The time/frequency axis of `x` along which the resampling take place.
        The Default is 0.
    window : array_like, callable, string, float, or tuple, optional
        If not ``None``, it specifies a filter in the Fourier domain, which is applied
        before resampling. I.e., the FFT ``X`` of `x` is calculated by
        ``X = W * fft(x, axis=axis)``. ``W`` may be interpreted as a spectral windowing
        function ``W(f_X)`` which consumes the frequencies ``f_X = fftfreq(n_x, T)``.

        If `window` is a 1d array of length ``n_x`` then ``W=window``.
        If `window` is a callable  then ``W = window(f_X)``.
        Otherwise, `window` is passed to `~scipy.signal.get_window`, i.e.,
        ``W = fftshift(signal.get_window(window, n_x))``. Default is ``None``.

    domain : 'time' | 'freq', optional
        If set to ``'time'`` (default) then an FFT is applied to `x`, otherwise
        (``'freq'``) it is asssmued that an FFT was already applied, i.e.,
        ``x = fft(x_t, axis=axis)`` with ``x_t`` being the input signal in the time
        domain.

    Returns
    -------
    x_r : ndarray
        The resampled signal made up of `num` samples and sampling interval
        ``T * n_x / num``.
    t_r : ndarray, optional
        The `num` equidistant timestamps of `x_r`.
        This is only returned if paramater `t` is not ``None``.

    See Also
    --------
    decimate : Downsample a (periodic/non-periodic) signal after applying an FIR
               or IIR filter.
    resample_poly : Resample a (periodic/non-periodic) signal using polyphase filtering
                    and an FIR filter.

    Notes
    -----
    This function uses the more efficient one-sided FFT, i.e. `~scipy.fft.rfft` /
    `~scipy.fft.irfft`, if `x` is real-valued and in the time domain.
    Else, the two-sided FFT, i.e., `~scipy.fft.fft` / `~scipy.fft.ifft`, is used
    (all FFT functions are taken from the `scipy.fft` module).

    If a `window` is applied to a real-valued `x`, the one-sided spectral windowing
    function is determined by taking the average of the negative and the positive
    frequency component. This ensures that real-valued signals and complex signals with
    zero imaginary part are treated identically. I.e., passing `x` or passing
    ``x.astype(np.complex128)`` produce the same numeric result.

    If the number of input  or output samples are prime or have few prime factors, this
    function may be slow due to utilizing FFTs. Consult `~scipy.fft.prev_fast_len` and
    `~scipy.fft.next_fast_len` for determining efficient signals lengths.
    Alternatively, utilizing `resample_poly` to calculate an intermediate signal (as
    illustrated in the example below) can result in significant speed increases.

    `resample` is intended to be used for periodic signals with equidistant sampling
    intervals. For non-periodic signals, `resample_poly` may be a better choice.
    Consult the `scipy.interpolate` module for methods of resampling signals with
    non-constant sampling intervals.

    Examples
    --------
    The following example depicts a signal being up-sampled from 20 samples to 100
    samples. The ringing at the beginning of the up-sampled signal is due to
    interpreting the signal being periodic. The red square in the plot illustrates that
    periodictiy by showing the first sample of the next cycle of the signal.

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy.signal import resample
    ...
    >>> n0, n1 = 20, 100  # number of samples
    >>> t0 = np.linspace(0, 10, n0, endpoint=False)  # input time stamps
    >>> x0 = np.cos(-t0**2/6)  # input signal
    ...
    >>> x1 = resample(x0, n1)  # resampled signal
    >>> t1 = np.linspace(0, 10, n1, endpoint=False)  # timestamps of x1
    ...
    >>> fig0, ax0 = plt.subplots(1, 1, tight_layout=True)
    >>> ax0.set_title(f"Resampling $x(t)$ from {n0} samples to {n1} samples")
    >>> ax0.set(xlabel="Time $t$", ylabel="Amplitude $x(t)$")
    >>> ax0.plot(t1, x1, '.-', alpha=.5, label=f"Resampled")
    >>> ax0.plot(t0, x0, 'o-', alpha=.5, label="Original")
    >>> ax0.plot(10, x0[0], 'rs', alpha=.5, label="Next Cycle")
    >>> ax0.legend(loc='best')
    >>> ax0.grid(True)
    >>> plt.show()

    The following example compares this function with a naive `~scipy.fft.rfft` /
    `~scipy.fft.irfft` combination: An input signal with a sampling interval of one
    second is upsampled by a factor of eight. The first figure depicts an odd number of
    input samples whereas the second figure an even number. The upper subplots show the
    signals over time: The input samples are marked by large green dots, the upsampled
    signals by a continuous and a dashed line. The lower subplots show the magnitude
    spectrum: The FFT values of the input are depicted by large green dots, which lie
    in the frequency interval [-0.5, 0.5] Hz, whereas the frequency interval of the
    upsampled signal is [-4, 4] Hz. The continuous green line depicts the upsampled
    spectrum without antialiasing filter, which is a periodic continuation of the input
    spectrum. The blue x's and orange dots depict the FFT values of the signal created
    by the naive approach as well as this function's result.

    >>> import matplotlib.pyplot as plt
    >>> import numpy as np
    >>> from scipy.fft import fftshift, fftfreq, fft, rfft, irfft
    >>> from scipy.signal import resample, resample_poly
    ... 
    >>> fac, T0, T1 = 8, 1, 1/8  # upsampling factor and sampling intervals
    >>> for n0 in (15, 16):  # number of samples of input signal
    ...     n1 = fac * n0  # number of samples of upsampled signal
    ...     t0, t1 = T0 * np.arange(n0), T1 * np.arange(n1)  # time stamps
    ...     x0 = np.zeros(n0)  # input signal has two non-zero sample values
    ...     x0[n0//2], x0[n0//2+1] = n0 // 2, -(n0 // 2)
    ... 
    ...     x1n = irfft(rfft(x0), n=n1) * n1 / n0  # naive resampling
    ...     x1r = resample(x0, n1)  # resample signal
    ... 
    ...     # Determine magnitude spectrum:
    ...     x0_up = np.zeros_like(x1r)  # upsampling without antialiasing filter
    ...     x0_up[::n1 // n0] = x0
    ...     X0, X0_up = (fftshift(fft(x_)) / n0 for x_ in (x0, x0_up))
    ...     XX1 = (fftshift(fft(x_)) / n1 for x_ in (x1n, x1r))
    ...     f0, f1 = fftshift(fftfreq(n0, T0)), fftshift(fftfreq(n1, T1))  # frequencies
    ...     df = f0[1] - f0[0]  # frequency resolution
    ... 
    ...     fig, (ax0, ax1) = plt.subplots(2, 1, layout='constrained', figsize=(5, 4))
    ...     ax0.set_title(rf"Upsampling ${fac}\times$ from {n0} to {n1} samples")
    ...     ax0.set(xlabel="Time $t$ in seconds", ylabel="Amplitude $x(t)$", 
    ...             xlim=(0, n1*T1))
    ...     ax0.step(t0, x0, 'C2o-', where='post', alpha=.3, linewidth=2, 
    ...              label="$x_0(t)$ / $X_0(f)$")
    ...     for x_, l_ in zip((x1n, x1r), ('C0--', 'C1-')):
    ...         ax0.plot(t1, x_, l_, alpha=.5, label=None)
    ...     ax0.grid()
    ...     ax1.set(xlabel=rf"Frequency $f$ in hertz ($\Delta f = {df*1e3:.1f}\,$mHz)", 
    ...             ylabel="Magnitude $|X(f)|$", xlim=(-0.7, 0.7))
    ...     ax1.axvspan(0.5/T0, f1[-1], color='gray', alpha=.2)
    ...     ax1.axvspan(f1[0], -0.5/T0, color='gray', alpha=.2)
    ...     ax1.plot(f1, abs(X0_up), 'C2-', f0, abs(X0),  'C2o', alpha=.3, linewidth=2)
    ...     for X_, n_, l_ in zip(XX1, ("naive", "resample"), ('C0x--', 'C1.-')): 
    ...         ax1.plot(f1, abs(X_), l_, alpha=.5, label=n_)
    ...     ax1.grid()
    ...     fig.legend(loc='outside lower center', ncols=4)    
    >>> plt.show()

    The first figure shows that upsampling an odd number of samples produces identical
    results. The second figure illustrates that the signal produced with the naive
    approach (dashed blue line) from an even number of samples does not touch all
    original samples. This deviation is due to `resample` correctly treating unpaired
    frequency bins. I.e., the input `x1` has a bin pair ±0.5 Hz, whereas the output has
    only one unpaired bin at -0.5 Hz, which demands rescaling of that bin pair.
    Generally, special treatment is required if ``n_x != num`` and ``min(n_x, num)`` is
    even. If the bin values at `±m` are zero, obviously, no special treatment is
    needed. Consult the source code of `resample` for details.

    The final example shows how to utilize `resample_poly` to speed up the
    down-sampling: The input signal a non-zero value at :math:`t=0` and is downsampled
    from 19937 to 128 samples. Since 19937 is prime, the FFT is expected to be slow. To
    speed matters up, `resample_poly` is used to downsample first by a factor of ``n0
    // n1 = 155`` and then pass the result to `resample`. Two parameterization of 
    `resample_poly` are used: Passing ``padtype='wrap'`` treats the input as being
    periodic wheras the default parametrization performs zero-padding. The upper
    subplot shows the resulting signals over time whereas the lower subplot depicts the
    resulting one-sided magnitude spectra.

    >>> import matplotlib.pyplot as plt
    >>> import numpy as np
    >>> from scipy.fft import rfftfreq, rfft
    >>> from scipy.signal import resample, resample_poly
    ... 
    >>> n0 = 19937 # number of input samples - prime
    >>> n1 = 128  # number of output samples - fast FFT length
    >>> T0, T1 = 1/n0, 1/n1  # sampling intervals
    >>> t0, t1 = np.arange(n0)*T0, np.arange(n1)*T1  # time stamps
    ... 
    >>> x0 = np.zeros(n0)  # Input has one non-zero sample
    >>> x0[0] = n0
    >>> 
    >>> x1r = resample(x0, n1)  # slow due to n0 being prime
    >>> # This is faster:
    >>> x1p = resample(resample_poly(x0, 1, n0 // n1, padtype='wrap'), n1)  # periodic 
    >>> x2p = resample(resample_poly(x0, 1, n0 // n1), n1)  # with zero-padding
    ... 
    >>> X0 = rfft(x0) / n0 
    >>> X1r, X1p, X2p = rfft(x1r) / n1, rfft(x1p) / n1, rfft(x2p) / n1
    >>> f0, f1 = rfftfreq(n0, T0), rfftfreq(n1, T1)
    ... 
    >>> fig, (ax0, ax1) = plt.subplots(2, 1, layout='constrained', figsize=(5, 4))
    >>> ax0.set_title(f"Dowsampled Impulse response (from {n0} to {n1} samples)")
    >>> ax0.set(xlabel="Time $t$ in seconds", ylabel="Amplitude $x(t)$", xlim=(-T1, 1)) 
    >>> for x_ in (x1r, x1p, x2p):
    ...     ax0.plot(t1, x_, alpha=.5)
    >>> ax0.grid()
    >>> ax1.set(xlabel=rf"Frequency $f$ in hertz ($\Delta f = {f1[1]}\,$Hz)", 
    ...         ylabel="Magnitude $|X(f)|$", xlim=(0, 0.55/T1))
    >>> ax1.axvspan(0.5/T1, f0[-1], color='gray', alpha=.2)
    >>> ax1.plot(f1, abs(X1r), 'C0.-', alpha=.5, label="resample")
    >>> ax1.plot(f1, abs(X1p), 'C1.-', alpha=.5, label="resample_poly(padtype='wrap')")
    >>> ax1.plot(f1, abs(X2p), 'C2x-', alpha=.5, label="resample_poly")
    >>> ax1.grid()
    >>> fig.legend(loc='outside lower center', ncols=2)
    >>> plt.show()    

    The plots show that the results of the "pure" `resample` and the usage of the
    default parameters of `resample_poly` agree well.  The periodic padding of
    `resample_poly` (``padtype='wrap'``) on the other hand produces significant
    deviations. This is caused by the disconiuity at the beginning of the signal, for
    which the default filter of `resample_poly` is not suited well. This example
    illustrates that for some use cases, adpating the `resample_poly` parameters may
    be beneficial. `resample` has a big advantage in this regard: It uses the ideal
    antialiasing filter with the maximum bandwidth by default.

    Note that the doubled spectral magnitude at the Nyqist frequency of 64 Hz is due the
    even number of ``n1=128`` output samples, which requires a special treatment as 
    discussed in the previous example. 
    """
    if domain not in ('time', 'freq'):
        raise ValueError(f"Parameter {domain=} not in ('time', 'freq')!")

    xp = array_namespace(x, t)
    x = xp.asarray(x)
    if x.ndim > 1:  # moving active axis to end allows to use `...` in indexing:
        x = xp.moveaxis(x, axis, -1)
    n_x = x.shape[-1]  # number of samples along the time/frequency axis
    s_fac = n_x / num  # scaling factor represents sample interval dilatation
    m = min(num, n_x)  # number of relevant frequency bins
    m2 = m // 2 + 1  # number of relevant frequency bins of a one-sided FFT

    if window is None: # Determine spectral windowing function:
        W = None
    elif callable(window):
        W = window(sp_fft.fftfreq(n_x))
    elif hasattr(window, 'shape'): # must be an array object
        if window.shape != (n_x,):
            raise ValueError(f"{window.shape=} != ({n_x},), i.e., window length " +
                             "is not equal to number of frequency bins!")
        W = xp.asarray(window, copy=True)  # prevent modifying the function parameters
    else:
        W = sp_fft.fftshift(get_window(window, n_x, xp=xp))
        W = xp.astype(W, xp_default_dtype(xp))   # get_window always returns float64

    if domain == 'time' and not xp.isdtype(x.dtype, 'complex floating'):  # use rfft():
        X = sp_fft.rfft(x)
        if W is not None:  # fold window, i.e., W1[l] = (W[l] + W[-l]) / 2 for l > 0
            n_X = X.shape[-1]
            W[1:n_X] += xp.flip(W[-n_X+1:])  #W[:-n_X:-1]
            W[1:n_X] /= 2
            X *= W[:n_X]  # apply window
        X = X[..., :m2]  # extract relevant data
        if m % 2 == 0 and num != n_x:  # Account for unpaired bin at m//2:
            X[..., m//2] *= 2 if num < n_x else 0.5
        x_r = sp_fft.irfft(X / s_fac, n=num, overwrite_x=True)
    else:  # use standard two-sided FFT:
        X = sp_fft.fft(x) if domain == 'time' else x
        if W is not None:
            X = X * W  # writing X *= W could modify parameter x
        Y = xp.zeros(X.shape[:-1] + (num,), dtype=X.dtype)
        Y[..., :m2] = X[..., :m2]  # copy part up to Nyquist frequency
        if m2 < m:  # == m > 2
            Y[..., m2-m:] = X[..., m2-m:]  # copy negative frequency part
        if m % 2 == 0:  # Account for unpaired bin at m//2:
            if num < n_x:  # down-sampling: unite bin pair into one unpaired bin
                Y[..., -m//2] += X[..., -m//2]
            elif n_x < num:  # up-sampling: split unpaired bin into bin pair
                Y[..., m//2] /= 2
                Y[..., num-m//2] = Y[..., m//2]
        x_r = sp_fft.ifft(Y / s_fac, n=num, overwrite_x=True)

    if x_r.ndim > 1:  # moving active axis back to original position:
        x_r = xp.moveaxis(x_r, -1, axis)
    if t is not None:
        return x_r, t[0] + (t[1] - t[0]) * s_fac * xp.arange(num)
    return x_r


def resample_poly(x, up, down, axis=0, window=('kaiser', 5.0),
                  padtype='constant', cval=None):
    """
    Resample `x` along the given axis using polyphase filtering.

    The signal `x` is upsampled by the factor `up`, a zero-phase low-pass
    FIR filter is applied, and then it is downsampled by the factor `down`.
    The resulting sample rate is ``up / down`` times the original sample
    rate. By default, values beyond the boundary of the signal are assumed
    to be zero during the filtering step.

    Parameters
    ----------
    x : array_like
        The data to be resampled.
    up : int
        The upsampling factor.
    down : int
        The downsampling factor.
    axis : int, optional
        The axis of `x` that is resampled. Default is 0.
    window : string, tuple, or array_like, optional
        Desired window to use to design the low-pass filter, or the FIR filter
        coefficients to employ. See below for details.
    padtype : string, optional
        `constant`, `line`, `mean`, `median`, `maximum`, `minimum` or any of
        the other signal extension modes supported by `scipy.signal.upfirdn`.
        Changes assumptions on values beyond the boundary. If `constant`,
        assumed to be `cval` (default zero). If `line` assumed to continue a
        linear trend defined by the first and last points. `mean`, `median`,
        `maximum` and `minimum` work as in `np.pad` and assume that the values
        beyond the boundary are the mean, median, maximum or minimum
        respectively of the array along the axis.

        .. versionadded:: 1.4.0
    cval : float, optional
        Value to use if `padtype='constant'`. Default is zero.

        .. versionadded:: 1.4.0

    Returns
    -------
    resampled_x : array
        The resampled array.

    See Also
    --------
    decimate : Downsample the signal after applying an FIR or IIR filter.
    resample : Resample up or down using the FFT method.

    Notes
    -----
    This polyphase method will likely be faster than the Fourier method
    in `scipy.signal.resample` when the number of samples is large and
    prime, or when the number of samples is large and `up` and `down`
    share a large greatest common denominator. The length of the FIR
    filter used will depend on ``max(up, down) // gcd(up, down)``, and
    the number of operations during polyphase filtering will depend on
    the filter length and `down` (see `scipy.signal.upfirdn` for details).

    The argument `window` specifies the FIR low-pass filter design.

    If `window` is an array_like it is assumed to be the FIR filter
    coefficients. Note that the FIR filter is applied after the upsampling
    step, so it should be designed to operate on a signal at a sampling
    frequency higher than the original by a factor of `up//gcd(up, down)`.
    This function's output will be centered with respect to this array, so it
    is best to pass a symmetric filter with an odd number of samples if, as
    is usually the case, a zero-phase filter is desired.

    For any other type of `window`, the functions `scipy.signal.get_window`
    and `scipy.signal.firwin` are called to generate the appropriate filter
    coefficients.

    The first sample of the returned vector is the same as the first
    sample of the input vector. The spacing between samples is changed
    from ``dx`` to ``dx * down / float(up)``.

    Examples
    --------
    By default, the end of the resampled data rises to meet the first
    sample of the next cycle for the FFT method, and gets closer to zero
    for the polyphase method:

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt

    >>> x = np.linspace(0, 10, 20, endpoint=False)
    >>> y = np.cos(-x**2/6.0)
    >>> f_fft = signal.resample(y, 100)
    >>> f_poly = signal.resample_poly(y, 100, 20)
    >>> xnew = np.linspace(0, 10, 100, endpoint=False)

    >>> plt.plot(xnew, f_fft, 'b.-', xnew, f_poly, 'r.-')
    >>> plt.plot(x, y, 'ko-')
    >>> plt.plot(10, y[0], 'bo', 10, 0., 'ro')  # boundaries
    >>> plt.legend(['resample', 'resamp_poly', 'data'], loc='best')
    >>> plt.show()

    This default behaviour can be changed by using the padtype option:

    >>> N = 5
    >>> x = np.linspace(0, 1, N, endpoint=False)
    >>> y = 2 + x**2 - 1.7*np.sin(x) + .2*np.cos(11*x)
    >>> y2 = 1 + x**3 + 0.1*np.sin(x) + .1*np.cos(11*x)
    >>> Y = np.stack([y, y2], axis=-1)
    >>> up = 4
    >>> xr = np.linspace(0, 1, N*up, endpoint=False)

    >>> y2 = signal.resample_poly(Y, up, 1, padtype='constant')
    >>> y3 = signal.resample_poly(Y, up, 1, padtype='mean')
    >>> y4 = signal.resample_poly(Y, up, 1, padtype='line')

    >>> for i in [0,1]:
    ...     plt.figure()
    ...     plt.plot(xr, y4[:,i], 'g.', label='line')
    ...     plt.plot(xr, y3[:,i], 'y.', label='mean')
    ...     plt.plot(xr, y2[:,i], 'r.', label='constant')
    ...     plt.plot(x, Y[:,i], 'k-')
    ...     plt.legend()
    >>> plt.show()

    """
    xp = array_namespace(x)

    x = xp.asarray(x)
    if up != int(up):
        raise ValueError("up must be an integer")
    if down != int(down):
        raise ValueError("down must be an integer")
    up = int(up)
    down = int(down)
    if up < 1 or down < 1:
        raise ValueError('up and down must be >= 1')
    if cval is not None and padtype != 'constant':
        raise ValueError('cval has no effect when padtype is ', padtype)

    # Determine our up and down factors
    # Use a rational approximation to save computation time on really long
    # signals
    g_ = math.gcd(up, down)
    up //= g_
    down //= g_
    if up == down == 1:
        return xp.asarray(x, copy=True)
    n_in = x.shape[axis]
    n_out = n_in * up
    n_out = n_out // down + bool(n_out % down)

    if isinstance(window, list) or is_array_api_obj(window):
        window = xp.asarray(window, copy=True)  # force a copy (we modify `window`)
        if window.ndim > 1:
            raise ValueError('window must be 1-D')
        half_len = (xp_size(window) - 1) // 2
        h = window
    else:
        # Design a linear-phase low-pass FIR filter
        max_rate = max(up, down)
        f_c = 1. / max_rate  # cutoff of FIR filter (rel. to Nyquist)
        half_len = 10 * max_rate  # reasonable cutoff for sinc-like function
        if xp.isdtype(x.dtype, ("real floating", "complex floating")):
            h = firwin(2 * half_len + 1, f_c, window=window)
            h = xp.asarray(h, dtype=x.dtype)    # match dtype of x
        else:
            h = firwin(2 * half_len + 1, f_c, window=window)
            h = xp.asarray(h)

    h *= up

    # Zero-pad our filter to put the output samples at the center
    n_pre_pad = (down - half_len % down)
    n_post_pad = 0
    n_pre_remove = (half_len + n_pre_pad) // down
    # We should rarely need to do this given our filter lengths...
    while _output_len(h.shape[0] + n_pre_pad + n_post_pad, n_in,
                      up, down) < n_out + n_pre_remove:
        n_post_pad += 1
    h = xp.concat((xp.zeros(n_pre_pad, dtype=h.dtype), h,
                   xp.zeros(n_post_pad, dtype=h.dtype)))
    n_pre_remove_end = n_pre_remove + n_out

    # XXX consider using stats.quantile, which is natively Array API compatible
    def _median(x, *args, **kwds):
        return xp.asarray(np.median(np.asarray(x), *args, **kwds))

    # Remove background depending on the padtype option
    funcs = {'mean': xp.mean, 'median': _median,
             'minimum': xp.min, 'maximum': xp.max}
    upfirdn_kwargs = {'mode': 'constant', 'cval': 0}
    if padtype in funcs:
        background_values = funcs[padtype](x, axis=axis, keepdims=True)
    elif padtype in _upfirdn_modes:
        upfirdn_kwargs = {'mode': padtype}
        if padtype == 'constant':
            if cval is None:
                cval = 0
            upfirdn_kwargs['cval'] = cval
    else:
        raise ValueError(
            'padtype must be one of: maximum, mean, median, minimum, ' +
            ', '.join(_upfirdn_modes))

    if padtype in funcs:
        x = x - background_values

    # filter then remove excess
    y = upfirdn(h, x, up, down, axis=axis, **upfirdn_kwargs)
    keep = [slice(None), ]*x.ndim
    keep[axis] = slice(n_pre_remove, n_pre_remove_end)
    y_keep = y[tuple(keep)]

    # Add background back
    if padtype in funcs:
        y_keep += background_values

    return y_keep


def _angle(z, xp):
    """np.angle replacement
    """
    # XXX: https://github.com/data-apis/array-api/issues/595
    zimag = xp.imag(z) if xp.isdtype(z.dtype, 'complex floating') else 0.
    a = xp.atan2(zimag, xp.real(z))
    return a


def vectorstrength(events, period):
    '''
    Determine the vector strength of the events corresponding to the given
    period.

    The vector strength is a measure of phase synchrony, how well the
    timing of the events is synchronized to a single period of a periodic
    signal.

    If multiple periods are used, calculate the vector strength of each.
    This is called the "resonating vector strength".

    Parameters
    ----------
    events : 1D array_like
        An array of time points containing the timing of the events.
    period : float or array_like
        The period of the signal that the events should synchronize to.
        The period is in the same units as `events`.  It can also be an array
        of periods, in which case the outputs are arrays of the same length.

    Returns
    -------
    strength : float or 1D array
        The strength of the synchronization.  1.0 is perfect synchronization
        and 0.0 is no synchronization.  If `period` is an array, this is also
        an array with each element containing the vector strength at the
        corresponding period.
    phase : float or array
        The phase that the events are most strongly synchronized to in radians.
        If `period` is an array, this is also an array with each element
        containing the phase for the corresponding period.

    References
    ----------
    van Hemmen, JL, Longtin, A, and Vollmayr, AN. Testing resonating vector
        strength: Auditory system, electric fish, and noise.
        Chaos 21, 047508 (2011);
        :doi:`10.1063/1.3670512`.
    van Hemmen, JL.  Vector strength after Goldberg, Brown, and von Mises:
        biological and mathematical perspectives.  Biol Cybern.
        2013 Aug;107(4):385-96. :doi:`10.1007/s00422-013-0561-7`.
    van Hemmen, JL and Vollmayr, AN.  Resonating vector strength: what happens
        when we vary the "probing" frequency while keeping the spike times
        fixed.  Biol Cybern. 2013 Aug;107(4):491-94.
        :doi:`10.1007/s00422-013-0560-8`.
    '''
    xp = array_namespace(events, period)

    events = xp.asarray(events)
    period = xp.asarray(period)
    if xp.isdtype(period.dtype, 'integral'):
        period = xp.astype(period, xp.float64)

    if events.ndim > 1:
        raise ValueError('events cannot have dimensions more than 1')
    if period.ndim > 1:
        raise ValueError('period cannot have dimensions more than 1')

    # we need to know later if period was originally a scalar
    scalarperiod = not period.ndim

    events = xpx.atleast_nd(events, ndim=2, xp=xp)
    period = xpx.atleast_nd(period, ndim=2, xp=xp)
    if xp.any(period <= 0):
        raise ValueError('periods must be positive')

    # this converts the times to vectors
    events_ = xp.astype(events, period.dtype)
    vectors = xp.exp(2j * (xp.pi / period.T @ events_))

    # the vector strength is just the magnitude of the mean of the vectors
    # the vector phase is the angle of the mean of the vectors
    vectormean = xp.mean(vectors, axis=1)
    strength = xp.abs(vectormean)
    phase = _angle(vectormean, xp)

    # if the original period was a scalar, return scalars
    if scalarperiod:
        strength = strength[0]
        phase = phase[0]
    return strength, phase


def detrend(data: np.ndarray, axis: int = -1,
            type: Literal['linear', 'constant'] = 'linear',
            bp: ArrayLike | int = 0, overwrite_data: bool = False) -> np.ndarray:
    r"""Remove linear or constant trend along axis from data.

    Parameters
    ----------
    data : array_like
        The input data.
    axis : int, optional
        The axis along which to detrend the data. By default this is the
        last axis (-1).
    type : {'linear', 'constant'}, optional
        The type of detrending. If ``type == 'linear'`` (default),
        the result of a linear least-squares fit to `data` is subtracted
        from `data`.
        If ``type == 'constant'``, only the mean of `data` is subtracted.
    bp : array_like of ints, optional
        A sequence of break points. If given, an individual linear fit is
        performed for each part of `data` between two break points.
        Break points are specified as indices into `data`. This parameter
        only has an effect when ``type == 'linear'``.
    overwrite_data : bool, optional
        If True, perform in place detrending and avoid a copy. Default is False

    Returns
    -------
    ret : ndarray
        The detrended input data.

    Notes
    -----
    Detrending can be interpreted as subtracting a least squares fit polynomial:
    Setting the parameter `type` to 'constant' corresponds to fitting a zeroth degree
    polynomial, 'linear' to a first degree polynomial. Consult the example below.

    See Also
    --------
    numpy.polynomial.polynomial.Polynomial.fit: Create least squares fit polynomial.


    Examples
    --------
    The following example detrends the function :math:`x(t) = \sin(\pi t) + 1/4`:

    >>> import matplotlib.pyplot as plt
    >>> import numpy as np
    >>> from scipy.signal import detrend
    ...
    >>> t = np.linspace(-0.5, 0.5, 21)
    >>> x = np.sin(np.pi*t) + 1/4
    ...
    >>> x_d_const = detrend(x, type='constant')
    >>> x_d_linear = detrend(x, type='linear')
    ...
    >>> fig1, ax1 = plt.subplots()
    >>> ax1.set_title(r"Detrending $x(t)=\sin(\pi t) + 1/4$")
    >>> ax1.set(xlabel="t", ylabel="$x(t)$", xlim=(t[0], t[-1]))
    >>> ax1.axhline(y=0, color='black', linewidth=.5)
    >>> ax1.axvline(x=0, color='black', linewidth=.5)
    >>> ax1.plot(t, x, 'C0.-',  label="No detrending")
    >>> ax1.plot(t, x_d_const, 'C1x-', label="type='constant'")
    >>> ax1.plot(t, x_d_linear, 'C2+-', label="type='linear'")
    >>> ax1.legend()
    >>> plt.show()

    Alternatively, NumPy's `~numpy.polynomial.polynomial.Polynomial` can be used for
    detrending as well:

    >>> pp0 = np.polynomial.Polynomial.fit(t, x, deg=0)  # fit degree 0 polynomial
    >>> np.allclose(x_d_const, x - pp0(t))  # compare with constant detrend
    True
    >>> pp1 = np.polynomial.Polynomial.fit(t, x, deg=1)  # fit degree 1 polynomial
    >>> np.allclose(x_d_linear, x - pp1(t))  # compare with linear detrend
    True

    Note that `~numpy.polynomial.polynomial.Polynomial` also allows fitting higher
    degree polynomials. Consult its documentation on how to extract the polynomial
    coefficients.
    """
    if type not in ['linear', 'l', 'constant', 'c']:
        raise ValueError("Trend type must be 'linear' or 'constant'.")

    # XXX simplify when data-apis/array-api-compat#147 is available
    if isinstance(bp, int):
       xp = array_namespace(data)
    else:
       xp = array_namespace(data, bp)

    data = np.asarray(data)
    dtype = data.dtype.char
    if dtype not in 'dfDF':
        dtype = 'd'
    if type in ['constant', 'c']:
        ret = data - np.mean(data, axis, keepdims=True)
        return xp.asarray(ret)
    else:
        dshape = data.shape
        N = dshape[axis]
        bp = np.asarray(bp)
        bp = np.sort(np.unique(np.concatenate(np.atleast_1d(0, bp, N))))
        if np.any(bp > N):
            raise ValueError("Breakpoints must be less than length "
                             "of data along given axis.")

        # Restructure data so that axis is along first dimension and
        #  all other dimensions are collapsed into second dimension
        rnk = len(dshape)
        if axis < 0:
            axis = axis + rnk
        newdata = np.moveaxis(data, axis, 0)
        newdata_shape = newdata.shape
        newdata = newdata.reshape(N, -1)

        if not overwrite_data:
            newdata = newdata.copy()  # make sure we have a copy
        if newdata.dtype.char not in 'dfDF':
            newdata = newdata.astype(dtype)

#        Nreg = len(bp) - 1
        # Find leastsq fit and remove it for each piece
        for m in range(len(bp) - 1):
            Npts = bp[m + 1] - bp[m]
            A = np.ones((Npts, 2), dtype)
            A[:, 0] = np.arange(1, Npts + 1, dtype=dtype) / Npts
            sl = slice(bp[m], bp[m + 1])
            coef, resids, rank, s = linalg.lstsq(A, newdata[sl])
            newdata[sl] = newdata[sl] - A @ coef

        # Put data back in original shape.
        newdata = newdata.reshape(newdata_shape)
        ret = np.moveaxis(newdata, 0, axis)
        return xp.asarray(ret)


def lfilter_zi(b, a):
    """
    Construct initial conditions for lfilter for step response steady-state.

    Compute an initial state `zi` for the `lfilter` function that corresponds
    to the steady state of the step response.

    A typical use of this function is to set the initial state so that the
    output of the filter starts at the same value as the first element of
    the signal to be filtered.

    Parameters
    ----------
    b, a : array_like (1-D)
        The IIR filter coefficients. See `lfilter` for more
        information.

    Returns
    -------
    zi : 1-D ndarray
        The initial state for the filter.

    See Also
    --------
    lfilter, lfiltic, filtfilt

    Notes
    -----
    A linear filter with order m has a state space representation (A, B, C, D),
    for which the output y of the filter can be expressed as::

        z(n+1) = A*z(n) + B*x(n)
        y(n)   = C*z(n) + D*x(n)

    where z(n) is a vector of length m, A has shape (m, m), B has shape
    (m, 1), C has shape (1, m) and D has shape (1, 1) (assuming x(n) is
    a scalar).  lfilter_zi solves::

        zi = A*zi + B

    In other words, it finds the initial condition for which the response
    to an input of all ones is a constant.

    Given the filter coefficients `a` and `b`, the state space matrices
    for the transposed direct form II implementation of the linear filter,
    which is the implementation used by scipy.signal.lfilter, are::

        A = scipy.linalg.companion(a).T
        B = b[1:] - a[1:]*b[0]

    assuming ``a[0]`` is 1.0; if ``a[0]`` is not 1, `a` and `b` are first
    divided by a[0].

    Examples
    --------
    The following code creates a lowpass Butterworth filter. Then it
    applies that filter to an array whose values are all 1.0; the
    output is also all 1.0, as expected for a lowpass filter.  If the
    `zi` argument of `lfilter` had not been given, the output would have
    shown the transient signal.

    >>> from numpy import array, ones
    >>> from scipy.signal import lfilter, lfilter_zi, butter
    >>> b, a = butter(5, 0.25)
    >>> zi = lfilter_zi(b, a)
    >>> y, zo = lfilter(b, a, ones(10), zi=zi)
    >>> y
    array([1.,  1.,  1.,  1.,  1.,  1.,  1.,  1.,  1.,  1.])

    Another example:

    >>> x = array([0.5, 0.5, 0.5, 0.0, 0.0, 0.0, 0.0])
    >>> y, zf = lfilter(b, a, x, zi=zi*x[0])
    >>> y
    array([ 0.5       ,  0.5       ,  0.5       ,  0.49836039,  0.48610528,
        0.44399389,  0.35505241])

    Note that the `zi` argument to `lfilter` was computed using
    `lfilter_zi` and scaled by ``x[0]``.  Then the output `y` has no
    transient until the input drops from 0.5 to 0.0.

    """
    xp = array_namespace(b, a)

    # FIXME: Can this function be replaced with an appropriate
    # use of lfiltic?  For example, when b,a = butter(N,Wn),
    #    lfiltic(b, a, y=numpy.ones_like(a), x=numpy.ones_like(b)).
    #

    # We could use scipy.signal.normalize, but it uses warnings in
    # cases where a ValueError is more appropriate, and it allows
    # b to be 2D.
    b = xpx.atleast_nd(xp.asarray(b), ndim=1, xp=xp)
    if b.ndim != 1:
        raise ValueError("Numerator b must be 1-D.")
    a = xpx.atleast_nd(xp.asarray(a), ndim=1, xp=xp)
    if a.ndim != 1:
        raise ValueError("Denominator a must be 1-D.")

    while a.shape[0] > 1 and a[0] == 0.0:
        a = a[1:]
    if xp_size(a) < 1:
        raise ValueError("There must be at least one nonzero `a` coefficient.")

    if a[0] != 1.0:
        # Normalize the coefficients so a[0] == 1.
        b = b / a[0]
        a = a / a[0]

    n = max(a.shape[0], b.shape[0])

    # Pad a or b with zeros so they are the same length.
    if a.shape[0] < n:
        a = xp.concat((a, xp.zeros(n - a.shape[0], dtype=a.dtype)))
    elif b.shape[0] < n:
        b = xp.concat((b, xp.zeros(n - b.shape[0], dtype=b.dtype)))

    dt = xp.result_type(a, b)
    IminusA = np.eye(n - 1) - linalg.companion(a).T
    IminusA = xp.asarray(IminusA, dtype=dt)
    B = b[1:] - a[1:] * b[0]
    # Solve zi = A*zi + B
    zi = xp.linalg.solve(IminusA, B)

    # For future reference: we could also use the following
    # explicit formulas to solve the linear system:
    #
    # zi = np.zeros(n - 1)
    # zi[0] = B.sum() / IminusA[:,0].sum()
    # asum = 1.0
    # csum = 0.0
    # for k in range(1,n-1):
    #     asum += a[k]
    #     csum += b[k] - a[k]*b[0]
    #     zi[k] = asum*zi[0] - csum

    return zi


def sosfilt_zi(sos):
    """
    Construct initial conditions for sosfilt for step response steady-state.

    Compute an initial state `zi` for the `sosfilt` function that corresponds
    to the steady state of the step response.

    A typical use of this function is to set the initial state so that the
    output of the filter starts at the same value as the first element of
    the signal to be filtered.

    Parameters
    ----------
    sos : array_like
        Array of second-order filter coefficients, must have shape
        ``(n_sections, 6)``. See `sosfilt` for the SOS filter format
        specification.

    Returns
    -------
    zi : ndarray
        Initial conditions suitable for use with ``sosfilt``, shape
        ``(n_sections, 2)``.

    See Also
    --------
    sosfilt, zpk2sos

    Notes
    -----
    .. versionadded:: 0.16.0

    Examples
    --------
    Filter a rectangular pulse that begins at time 0, with and without
    the use of the `zi` argument of `scipy.signal.sosfilt`.

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt

    >>> sos = signal.butter(9, 0.125, output='sos')
    >>> zi = signal.sosfilt_zi(sos)
    >>> x = (np.arange(250) < 100).astype(int)
    >>> f1 = signal.sosfilt(sos, x)
    >>> f2, zo = signal.sosfilt(sos, x, zi=zi)

    >>> plt.plot(x, 'k--', label='x')
    >>> plt.plot(f1, 'b', alpha=0.5, linewidth=2, label='filtered')
    >>> plt.plot(f2, 'g', alpha=0.25, linewidth=4, label='filtered with zi')
    >>> plt.legend(loc='best')
    >>> plt.show()

    """
    xp = array_namespace(sos)

    sos = xp.asarray(sos)
    if sos.ndim != 2 or sos.shape[1] != 6:
        raise ValueError('sos must be shape (n_sections, 6)')

    if xp.isdtype(sos.dtype, ("integral", "bool")):
        sos = xp.astype(sos, xp.float64)

    n_sections = sos.shape[0]
    zi = xp.empty((n_sections, 2), dtype=sos.dtype)
    scale = 1.0
    for section in range(n_sections):
        b = sos[section, :3]
        a = sos[section, 3:]
        zi[section, ...] = scale * lfilter_zi(b, a)
        # If H(z) = B(z)/A(z) is this section's transfer function, then
        # b.sum()/a.sum() is H(1), the gain at omega=0.  That's the steady
        # state value of this section's step response.
        scale *= xp.sum(b) / xp.sum(a)

    return zi


def _filtfilt_gust(b, a, x, axis=-1, irlen=None):
    """Forward-backward IIR filter that uses Gustafsson's method.

    Apply the IIR filter defined by ``(b,a)`` to `x` twice, first forward
    then backward, using Gustafsson's initial conditions [1]_.

    Let ``y_fb`` be the result of filtering first forward and then backward,
    and let ``y_bf`` be the result of filtering first backward then forward.
    Gustafsson's method is to compute initial conditions for the forward
    pass and the backward pass such that ``y_fb == y_bf``.

    Parameters
    ----------
    b : scalar or 1-D ndarray
        Numerator coefficients of the filter.
    a : scalar or 1-D ndarray
        Denominator coefficients of the filter.
    x : ndarray
        Data to be filtered.
    axis : int, optional
        Axis of `x` to be filtered.  Default is -1.
    irlen : int or None, optional
        The length of the nonnegligible part of the impulse response.
        If `irlen` is None, or if the length of the signal is less than
        ``2 * irlen``, then no part of the impulse response is ignored.

    Returns
    -------
    y : ndarray
        The filtered data.
    x0 : ndarray
        Initial condition for the forward filter.
    x1 : ndarray
        Initial condition for the backward filter.

    Notes
    -----
    Typically the return values `x0` and `x1` are not needed by the
    caller.  The intended use of these return values is in unit tests.

    References
    ----------
    .. [1] F. Gustaffson. Determining the initial states in forward-backward
           filtering. Transactions on Signal Processing, 46(4):988-992, 1996.

    """
    # In the comments, "Gustafsson's paper" and [1] refer to the
    # paper referenced in the docstring.

    b = np.atleast_1d(b)
    a = np.atleast_1d(a)

    order = max(len(b), len(a)) - 1
    if order == 0:
        # The filter is just scalar multiplication, with no state.
        scale = (b[0] / a[0])**2
        y = scale * x
        return y, np.array([]), np.array([])

    if axis != -1 or axis != x.ndim - 1:
        # Move the axis containing the data to the end.
        x = np.swapaxes(x, axis, x.ndim - 1)

    # n is the number of samples in the data to be filtered.
    n = x.shape[-1]

    if irlen is None or n <= 2*irlen:
        m = n
    else:
        m = irlen

    # Create Obs, the observability matrix (called O in the paper).
    # This matrix can be interpreted as the operator that propagates
    # an arbitrary initial state to the output, assuming the input is
    # zero.
    # In Gustafsson's paper, the forward and backward filters are not
    # necessarily the same, so he has both O_f and O_b.  We use the same
    # filter in both directions, so we only need O. The same comment
    # applies to S below.
    Obs = np.zeros((m, order))
    zi = np.zeros(order)
    zi[0] = 1
    Obs[:, 0] = lfilter(b, a, np.zeros(m), zi=zi)[0]
    for k in range(1, order):
        Obs[k:, k] = Obs[:-k, 0]

    # Obsr is O^R (Gustafsson's notation for row-reversed O)
    Obsr = Obs[::-1]

    # Create S.  S is the matrix that applies the filter to the reversed
    # propagated initial conditions.  That is,
    #     out = S.dot(zi)
    # is the same as
    #     tmp, _ = lfilter(b, a, zeros(), zi=zi)  # Propagate ICs.
    #     out = lfilter(b, a, tmp[::-1])          # Reverse and filter.

    # Equations (5) & (6) of [1]
    S = lfilter(b, a, Obs[::-1], axis=0)

    # Sr is S^R (row-reversed S)
    Sr = S[::-1]

    # M is [(S^R - O), (O^R - S)]
    if m == n:
        M = np.hstack((Sr - Obs, Obsr - S))
    else:
        # Matrix described in section IV of [1].
        M = np.zeros((2*m, 2*order))
        M[:m, :order] = Sr - Obs
        M[m:, order:] = Obsr - S

    # Naive forward-backward and backward-forward filters.
    # These have large transients because the filters use zero initial
    # conditions.
    y_f = lfilter(b, a, x)
    y_fb = lfilter(b, a, y_f[..., ::-1])[..., ::-1]

    y_b = lfilter(b, a, x[..., ::-1])[..., ::-1]
    y_bf = lfilter(b, a, y_b)

    delta_y_bf_fb = y_bf - y_fb
    if m == n:
        delta = delta_y_bf_fb
    else:
        start_m = delta_y_bf_fb[..., :m]
        end_m = delta_y_bf_fb[..., -m:]
        delta = np.concatenate((start_m, end_m), axis=-1)

    # ic_opt holds the "optimal" initial conditions.
    # The following code computes the result shown in the formula
    # of the paper between equations (6) and (7).
    if delta.ndim == 1:
        ic_opt = linalg.lstsq(M, delta)[0]
    else:
        # Reshape delta so it can be used as an array of multiple
        # right-hand-sides in linalg.lstsq.
        delta2d = delta.reshape(-1, delta.shape[-1]).T
        ic_opt0 = linalg.lstsq(M, delta2d)[0].T
        ic_opt = ic_opt0.reshape(delta.shape[:-1] + (M.shape[-1],))

    # Now compute the filtered signal using equation (7) of [1].
    # First, form [S^R, O^R] and call it W.
    if m == n:
        W = np.hstack((Sr, Obsr))
    else:
        W = np.zeros((2*m, 2*order))
        W[:m, :order] = Sr
        W[m:, order:] = Obsr

    # Equation (7) of [1] says
    #     Y_fb^opt = Y_fb^0 + W * [x_0^opt; x_{N-1}^opt]
    # `wic` is (almost) the product on the right.
    # W has shape (m, 2*order), and ic_opt has shape (..., 2*order),
    # so we can't use W.dot(ic_opt).  Instead, we dot ic_opt with W.T,
    # so wic has shape (..., m).
    wic = ic_opt.dot(W.T)

    # `wic` is "almost" the product of W and the optimal ICs in equation
    # (7)--if we're using a truncated impulse response (m < n), `wic`
    # contains only the adjustments required for the ends of the signal.
    # Here we form y_opt, taking this into account if necessary.
    y_opt = y_fb
    if m == n:
        y_opt += wic
    else:
        y_opt[..., :m] += wic[..., :m]
        y_opt[..., -m:] += wic[..., -m:]

    x0 = ic_opt[..., :order]
    x1 = ic_opt[..., -order:]
    if axis != -1 or axis != x.ndim - 1:
        # Restore the data axis to its original position.
        x0 = np.swapaxes(x0, axis, x.ndim - 1)
        x1 = np.swapaxes(x1, axis, x.ndim - 1)
        y_opt = np.swapaxes(y_opt, axis, x.ndim - 1)

    return y_opt, x0, x1


def filtfilt(b, a, x, axis=-1, padtype='odd', padlen=None, method='pad',
             irlen=None):
    """
    Apply a digital filter forward and backward to a signal.

    This function applies a linear digital filter twice, once forward and
    once backwards.  The combined filter has zero phase and a filter order
    twice that of the original.

    The function provides options for handling the edges of the signal.

    The function `sosfiltfilt` (and filter design using ``output='sos'``)
    should be preferred over `filtfilt` for most filtering tasks, as
    second-order sections have fewer numerical problems.

    Parameters
    ----------
    b : (N,) array_like
        The numerator coefficient vector of the filter.
    a : (N,) array_like
        The denominator coefficient vector of the filter.  If ``a[0]``
        is not 1, then both `a` and `b` are normalized by ``a[0]``.
    x : array_like
        The array of data to be filtered.
    axis : int, optional
        The axis of `x` to which the filter is applied.
        Default is -1.
    padtype : str or None, optional
        Must be 'odd', 'even', 'constant', or None.  This determines the
        type of extension to use for the padded signal to which the filter
        is applied.  If `padtype` is None, no padding is used.  The default
        is 'odd'.
    padlen : int or None, optional
        The number of elements by which to extend `x` at both ends of
        `axis` before applying the filter.  This value must be less than
        ``x.shape[axis] - 1``.  ``padlen=0`` implies no padding.
        The default value is ``3 * max(len(a), len(b))``.
    method : str, optional
        Determines the method for handling the edges of the signal, either
        "pad" or "gust".  When `method` is "pad", the signal is padded; the
        type of padding is determined by `padtype` and `padlen`, and `irlen`
        is ignored.  When `method` is "gust", Gustafsson's method is used,
        and `padtype` and `padlen` are ignored.
    irlen : int or None, optional
        When `method` is "gust", `irlen` specifies the length of the
        impulse response of the filter.  If `irlen` is None, no part
        of the impulse response is ignored.  For a long signal, specifying
        `irlen` can significantly improve the performance of the filter.

    Returns
    -------
    y : ndarray
        The filtered output with the same shape as `x`.

    See Also
    --------
    sosfiltfilt, lfilter_zi, lfilter, lfiltic, savgol_filter, sosfilt

    Notes
    -----
    When `method` is "pad", the function pads the data along the given axis
    in one of three ways: odd, even or constant.  The odd and even extensions
    have the corresponding symmetry about the end point of the data.  The
    constant extension extends the data with the values at the end points. On
    both the forward and backward passes, the initial condition of the
    filter is found by using `lfilter_zi` and scaling it by the end point of
    the extended data.

    When `method` is "gust", Gustafsson's method [1]_ is used.  Initial
    conditions are chosen for the forward and backward passes so that the
    forward-backward filter gives the same result as the backward-forward
    filter.

    The option to use Gustaffson's method was added in scipy version 0.16.0.

    References
    ----------
    .. [1] F. Gustaffson, "Determining the initial states in forward-backward
           filtering", Transactions on Signal Processing, Vol. 46, pp. 988-992,
           1996.

    Examples
    --------
    The examples will use several functions from `scipy.signal`.

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt

    First we create a one second signal that is the sum of two pure sine
    waves, with frequencies 5 Hz and 250 Hz, sampled at 2000 Hz.

    >>> t = np.linspace(0, 1.0, 2001)
    >>> xlow = np.sin(2 * np.pi * 5 * t)
    >>> xhigh = np.sin(2 * np.pi * 250 * t)
    >>> x = xlow + xhigh

    Now create a lowpass Butterworth filter with a cutoff of 0.125 times
    the Nyquist frequency, or 125 Hz, and apply it to ``x`` with `filtfilt`.
    The result should be approximately ``xlow``, with no phase shift.

    >>> b, a = signal.butter(8, 0.125)
    >>> y = signal.filtfilt(b, a, x, padlen=150)
    >>> np.abs(y - xlow).max()
    9.1086182074789912e-06

    We get a fairly clean result for this artificial example because
    the odd extension is exact, and with the moderately long padding,
    the filter's transients have dissipated by the time the actual data
    is reached.  In general, transient effects at the edges are
    unavoidable.

    The following example demonstrates the option ``method="gust"``.

    First, create a filter.

    >>> b, a = signal.ellip(4, 0.01, 120, 0.125)  # Filter to be applied.

    `sig` is a random input signal to be filtered.

    >>> rng = np.random.default_rng()
    >>> n = 60
    >>> sig = rng.standard_normal(n)**3 + 3*rng.standard_normal(n).cumsum()

    Apply `filtfilt` to `sig`, once using the Gustafsson method, and
    once using padding, and plot the results for comparison.

    >>> fgust = signal.filtfilt(b, a, sig, method="gust")
    >>> fpad = signal.filtfilt(b, a, sig, padlen=50)
    >>> plt.plot(sig, 'k-', label='input')
    >>> plt.plot(fgust, 'b-', linewidth=4, label='gust')
    >>> plt.plot(fpad, 'c-', linewidth=1.5, label='pad')
    >>> plt.legend(loc='best')
    >>> plt.show()

    The `irlen` argument can be used to improve the performance
    of Gustafsson's method.

    Estimate the impulse response length of the filter.

    >>> z, p, k = signal.tf2zpk(b, a)
    >>> eps = 1e-9
    >>> r = np.max(np.abs(p))
    >>> approx_impulse_len = int(np.ceil(np.log(eps) / np.log(r)))
    >>> approx_impulse_len
    137

    Apply the filter to a longer signal, with and without the `irlen`
    argument.  The difference between `y1` and `y2` is small.  For long
    signals, using `irlen` gives a significant performance improvement.

    >>> x = rng.standard_normal(4000)
    >>> y1 = signal.filtfilt(b, a, x, method='gust')
    >>> y2 = signal.filtfilt(b, a, x, method='gust', irlen=approx_impulse_len)
    >>> print(np.max(np.abs(y1 - y2)))
    2.875334415008979e-10

    """
    xp = array_namespace(b, a, x)

    b = np.atleast_1d(b)
    a = np.atleast_1d(a)
    x = np.asarray(x)

    if method not in ["pad", "gust"]:
        raise ValueError("method must be 'pad' or 'gust'.")

    if method == "gust":
        y, z1, z2 = _filtfilt_gust(b, a, x, axis=axis, irlen=irlen)
        return xp.asarray(y)

    # method == "pad"
    edge, ext = _validate_pad(padtype, padlen, x, axis,
                              ntaps=max(len(a), len(b)))

    # Get the steady state of the filter's step response.
    zi = lfilter_zi(b, a)

    # Reshape zi and create x0 so that zi*x0 broadcasts
    # to the correct value for the 'zi' keyword argument
    # to lfilter.
    zi_shape = [1] * x.ndim
    zi_shape[axis] = zi.size
    zi = np.reshape(zi, zi_shape)
    x0 = axis_slice(ext, stop=1, axis=axis)

    # Forward filter.
    (y, zf) = lfilter(b, a, ext, axis=axis, zi=zi * x0)

    # Backward filter.
    # Create y0 so zi*y0 broadcasts appropriately.
    y0 = axis_slice(y, start=-1, axis=axis)
    (y, zf) = lfilter(b, a, axis_reverse(y, axis=axis), axis=axis, zi=zi * y0)

    # Reverse y.
    y = axis_reverse(y, axis=axis)

    if edge > 0:
        # Slice the actual signal from the extended signal.
        y = axis_slice(y, start=edge, stop=-edge, axis=axis)
        if is_torch(xp):
            y = y.copy()    #  pytorch/pytorch#59786 : no negative strides in pytorch

    return xp.asarray(y)


def _validate_pad(padtype, padlen, x, axis, ntaps):
    """Helper to validate padding for filtfilt"""
    if padtype not in ['even', 'odd', 'constant', None]:
        raise ValueError(f"Unknown value '{padtype}' given to padtype. "
                         "padtype must be 'even', 'odd', 'constant', or None.")

    if padtype is None:
        padlen = 0

    if padlen is None:
        # Original padding; preserved for backwards compatibility.
        edge = ntaps * 3
    else:
        edge = padlen

    # x's 'axis' dimension must be bigger than edge.
    if x.shape[axis] <= edge:
        raise ValueError(
            f"The length of the input vector x must be greater than padlen, "
            f"which is {edge}."
        )

    if padtype is not None and edge > 0:
        # Make an extension of length `edge` at each
        # end of the input array.
        if padtype == 'even':
            ext = even_ext(x, edge, axis=axis)
        elif padtype == 'odd':
            ext = odd_ext(x, edge, axis=axis)
        else:
            ext = const_ext(x, edge, axis=axis)
    else:
        ext = x
    return edge, ext


def _validate_x(x):
    x = np.asarray(x)
    if x.ndim == 0:
        raise ValueError('x must be at least 1-D')
    return x


def sosfilt(sos, x, axis=-1, zi=None):
    """
    Filter data along one dimension using cascaded second-order sections.

    Filter a data sequence, `x`, using a digital IIR filter defined by
    `sos`.

    Parameters
    ----------
    sos : array_like
        Array of second-order filter coefficients, must have shape
        ``(n_sections, 6)``. Each row corresponds to a second-order
        section, with the first three columns providing the numerator
        coefficients and the last three providing the denominator
        coefficients.
    x : array_like
        An N-dimensional input array.
    axis : int, optional
        The axis of the input data array along which to apply the
        linear filter. The filter is applied to each subarray along
        this axis.  Default is -1.
    zi : array_like, optional
        Initial conditions for the cascaded filter delays.  It is a (at
        least 2D) vector of shape ``(n_sections, ..., 2, ...)``, where
        ``..., 2, ...`` denotes the shape of `x`, but with ``x.shape[axis]``
        replaced by 2.  If `zi` is None or is not given then initial rest
        (i.e. all zeros) is assumed.
        Note that these initial conditions are *not* the same as the initial
        conditions given by `lfiltic` or `lfilter_zi`.

    Returns
    -------
    y : ndarray
        The output of the digital filter.
    zf : ndarray, optional
        If `zi` is None, this is not returned, otherwise, `zf` holds the
        final filter delay values.

    See Also
    --------
    zpk2sos, sos2zpk, sosfilt_zi, sosfiltfilt, freqz_sos

    Notes
    -----
    The filter function is implemented as a series of second-order filters
    with direct-form II transposed structure. It is designed to minimize
    numerical precision errors for high-order filters.

    .. versionadded:: 0.16.0

    Examples
    --------
    Plot a 13th-order filter's impulse response using both `lfilter` and
    `sosfilt`, showing the instability that results from trying to do a
    13th-order filter in a single stage (the numerical error pushes some poles
    outside of the unit circle):

    >>> import matplotlib.pyplot as plt
    >>> from scipy import signal
    >>> b, a = signal.ellip(13, 0.009, 80, 0.05, output='ba')
    >>> sos = signal.ellip(13, 0.009, 80, 0.05, output='sos')
    >>> x = signal.unit_impulse(700)
    >>> y_tf = signal.lfilter(b, a, x)
    >>> y_sos = signal.sosfilt(sos, x)
    >>> plt.plot(y_tf, 'r', label='TF')
    >>> plt.plot(y_sos, 'k', label='SOS')
    >>> plt.legend(loc='best')
    >>> plt.show()

    """
    try:
        xp = array_namespace(sos, x, zi)
    except TypeError:
        # either in1 or in2 are object arrays
        xp = np_compat

    if is_numpy(xp):
        _reject_objects(sos, 'sosfilt')
        _reject_objects(x, 'sosfilt')
        if zi is not None:
            _reject_objects(zi, 'sosfilt')

    x = _validate_x(x)
    sos, n_sections = _validate_sos(sos)
    x_zi_shape = list(x.shape)
    x_zi_shape[axis] = 2
    x_zi_shape = tuple([n_sections] + x_zi_shape)
    inputs = [sos, x]
    if zi is not None:
        inputs.append(np.asarray(zi))
    dtype = np.result_type(*inputs)
    if dtype.char not in 'fdgFDGO':
        raise NotImplementedError(f"input type '{dtype}' not supported")
    if zi is not None:
        zi = np.asarray(zi, dtype=dtype)

        # make a copy so that we can operate in place
        # NB: 1. use xp_copy to paper over numpy 1/2 copy= keyword
        #     2. make sure the copied zi remains a numpy array
        zi = xp_copy(zi, xp=array_namespace(zi))
        if zi.shape != x_zi_shape:
            raise ValueError(
                f"Invalid zi shape. With axis={axis!r}, "
                f"an input with shape {x.shape!r}, "
                f"and an sos array with {n_sections} sections, zi must have "
                f"shape {x_zi_shape!r}, got {zi.shape!r}."
            )
        return_zi = True
    else:
        zi = np.zeros(x_zi_shape, dtype=dtype)
        return_zi = False
    axis = axis % x.ndim  # make positive
    x = np.moveaxis(x, axis, -1)
    zi = np.moveaxis(zi, (0, axis + 1), (-2, -1))
    x_shape, zi_shape = x.shape, zi.shape
    x = np.reshape(x, (-1, x.shape[-1]))
    x = np.array(x, dtype, order='C')  # make a copy, can modify in place
    zi = np.ascontiguousarray(np.reshape(zi, (-1, n_sections, 2)))
    sos = sos.astype(dtype, copy=False)
    _sosfilt(sos, x, zi)
    x.shape = x_shape
    x = np.moveaxis(x, -1, axis)
    if return_zi:
        zi.shape = zi_shape
        zi = np.moveaxis(zi, (-2, -1), (0, axis + 1))
        out = (xp.asarray(x), xp.asarray(zi))
    else:
        out = xp.asarray(x)
    return out


def sosfiltfilt(sos, x, axis=-1, padtype='odd', padlen=None):
    """
    A forward-backward digital filter using cascaded second-order sections.

    See `filtfilt` for more complete information about this method.

    Parameters
    ----------
    sos : array_like
        Array of second-order filter coefficients, must have shape
        ``(n_sections, 6)``. Each row corresponds to a second-order
        section, with the first three columns providing the numerator
        coefficients and the last three providing the denominator
        coefficients.
    x : array_like
        The array of data to be filtered.
    axis : int, optional
        The axis of `x` to which the filter is applied.
        Default is -1.
    padtype : str or None, optional
        Must be 'odd', 'even', 'constant', or None.  This determines the
        type of extension to use for the padded signal to which the filter
        is applied.  If `padtype` is None, no padding is used.  The default
        is 'odd'.
    padlen : int or None, optional
        The number of elements by which to extend `x` at both ends of
        `axis` before applying the filter.  This value must be less than
        ``x.shape[axis] - 1``.  ``padlen=0`` implies no padding.
        The default value is::

            3 * (2 * len(sos) + 1 - min((sos[:, 2] == 0).sum(),
                                        (sos[:, 5] == 0).sum()))

        The extra subtraction at the end attempts to compensate for poles
        and zeros at the origin (e.g. for odd-order filters) to yield
        equivalent estimates of `padlen` to those of `filtfilt` for
        second-order section filters built with `scipy.signal` functions.

    Returns
    -------
    y : ndarray
        The filtered output with the same shape as `x`.

    See Also
    --------
    filtfilt, sosfilt, sosfilt_zi, freqz_sos

    Notes
    -----
    .. versionadded:: 0.18.0

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.signal import sosfiltfilt, butter
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()

    Create an interesting signal to filter.

    >>> n = 201
    >>> t = np.linspace(0, 1, n)
    >>> x = 1 + (t < 0.5) - 0.25*t**2 + 0.05*rng.standard_normal(n)

    Create a lowpass Butterworth filter, and use it to filter `x`.

    >>> sos = butter(4, 0.125, output='sos')
    >>> y = sosfiltfilt(sos, x)

    For comparison, apply an 8th order filter using `sosfilt`.  The filter
    is initialized using the mean of the first four values of `x`.

    >>> from scipy.signal import sosfilt, sosfilt_zi
    >>> sos8 = butter(8, 0.125, output='sos')
    >>> zi = x[:4].mean() * sosfilt_zi(sos8)
    >>> y2, zo = sosfilt(sos8, x, zi=zi)

    Plot the results.  Note that the phase of `y` matches the input, while
    `y2` has a significant phase delay.

    >>> plt.plot(t, x, alpha=0.5, label='x(t)')
    >>> plt.plot(t, y, label='y(t)')
    >>> plt.plot(t, y2, label='y2(t)')
    >>> plt.legend(framealpha=1, shadow=True)
    >>> plt.grid(alpha=0.25)
    >>> plt.xlabel('t')
    >>> plt.show()

    """
    xp = array_namespace(sos, x)

    sos, n_sections = _validate_sos(sos)
    x = _validate_x(x)

    # `method` is "pad"...
    ntaps = 2 * n_sections + 1
    ntaps -= min((sos[:, 2] == 0).sum(), (sos[:, 5] == 0).sum())
    edge, ext = _validate_pad(padtype, padlen, x, axis,
                              ntaps=ntaps)

    # These steps follow the same form as filtfilt with modifications
    zi = sosfilt_zi(sos)  # shape (n_sections, 2) --> (n_sections, ..., 2, ...)
    zi_shape = [1] * x.ndim
    zi_shape[axis] = 2
    zi.shape = [n_sections] + zi_shape
    x_0 = axis_slice(ext, stop=1, axis=axis)
    (y, zf) = sosfilt(sos, ext, axis=axis, zi=zi * x_0)
    y_0 = axis_slice(y, start=-1, axis=axis)
    (y, zf) = sosfilt(sos, axis_reverse(y, axis=axis), axis=axis, zi=zi * y_0)
    y = axis_reverse(y, axis=axis)
    if edge > 0:
        y = axis_slice(y, start=edge, stop=-edge, axis=axis)
    return xp.asarray(y)


def decimate(x, q, n=None, ftype='iir', axis=-1, zero_phase=True):
    """
    Downsample the signal after applying an anti-aliasing filter.

    By default, an order 8 Chebyshev type I filter is used. A 30 point FIR
    filter with Hamming window is used if `ftype` is 'fir'.

    Parameters
    ----------
    x : array_like
        The input signal made up of equidistant samples. If `x` is a multidimensional
        array, the parameter `axis` specifies the time axis.
    q : int
        The downsampling factor, which is a postive integer. When using IIR
        downsampling, it is recommended to call `decimate` multiple times for
        downsampling factors higher than 13.
    n : int, optional
        The order of the filter (1 less than the length for 'fir'). Defaults to
        8 for 'iir' and 20 times the downsampling factor for 'fir'.
    ftype : str {'iir', 'fir'} or ``dlti`` instance, optional
        If 'iir' or 'fir', specifies the type of lowpass filter. If an instance
        of an `dlti` object, uses that object to filter before downsampling.
    axis : int, optional
        The axis along which to decimate.
    zero_phase : bool, optional
        Prevent phase shift by filtering with `filtfilt` instead of `lfilter`
        when using an IIR filter, and shifting the outputs back by the filter's
        group delay when using an FIR filter. The default value of ``True`` is
        recommended, since a phase shift is generally not desired.

        .. versionadded:: 0.18.0

    Returns
    -------
    y : ndarray
        The down-sampled signal.

    See Also
    --------
    resample : Resample up or down using the FFT method.
    resample_poly : Resample using polyphase filtering and an FIR filter.

    Notes
    -----
    For non-integer downsampling factors, `~scipy.signal.resample` can be used. Consult
    the `scipy.interpolate` module for methods of resampling signals with non-constant
    sampling intervals.

    The ``zero_phase`` keyword was added in 0.18.0.
    The possibility to use instances of ``dlti`` as ``ftype`` was added in
    0.18.0.

    Examples
    --------

    >>> import numpy as np
    >>> from scipy import signal
    >>> import matplotlib.pyplot as plt

    Define wave parameters.

    >>> wave_duration = 3
    >>> sample_rate = 100
    >>> freq = 2
    >>> q = 5

    Calculate number of samples.

    >>> samples = wave_duration*sample_rate
    >>> samples_decimated = int(samples/q)

    Create cosine wave.

    >>> x = np.linspace(0, wave_duration, samples, endpoint=False)
    >>> y = np.cos(x*np.pi*freq*2)

    Decimate cosine wave.

    >>> ydem = signal.decimate(y, q)
    >>> xnew = np.linspace(0, wave_duration, samples_decimated, endpoint=False)

    Plot original and decimated waves.

    >>> plt.plot(x, y, '.-', xnew, ydem, 'o-')
    >>> plt.xlabel('Time, Seconds')
    >>> plt.legend(['data', 'decimated'], loc='best')
    >>> plt.show()

    """

    x = np.asarray(x)
    q = operator.index(q)

    if n is not None:
        n = operator.index(n)

    result_type = x.dtype
    if not np.issubdtype(result_type, np.inexact) \
       or result_type.type == np.float16:
        # upcast integers and float16 to float64
        result_type = np.float64

    if ftype == 'fir':
        if n is None:
            half_len = 10 * q  # reasonable cutoff for our sinc-like function
            n = 2 * half_len
        b, a = firwin(n+1, 1. / q, window='hamming'), 1.
        b = np.asarray(b, dtype=result_type)
        a = np.asarray(a, dtype=result_type)
    elif ftype == 'iir':
        iir_use_sos = True
        if n is None:
            n = 8
        sos = cheby1(n, 0.05, 0.8 / q, output='sos')
        sos = np.asarray(sos, dtype=result_type)
    elif isinstance(ftype, dlti):
        system = ftype._as_zpk()
        if system.poles.shape[0] == 0:
            # FIR
            system = ftype._as_tf()
            b, a = system.num, system.den
            ftype = 'fir'
        elif (any(np.iscomplex(system.poles))
              or any(np.iscomplex(system.poles))
              or np.iscomplex(system.gain)):
            # sosfilt & sosfiltfilt don't handle complex coeffs
            iir_use_sos = False
            system = ftype._as_tf()
            b, a = system.num, system.den
        else:
            iir_use_sos = True
            sos = zpk2sos(system.zeros, system.poles, system.gain)
            sos = np.asarray(sos, dtype=result_type)
    else:
        raise ValueError('invalid ftype')

    sl = [slice(None)] * x.ndim

    if ftype == 'fir':
        b = b / a
        if zero_phase:
            y = resample_poly(x, 1, q, axis=axis, window=b)
        else:
            # upfirdn is generally faster than lfilter by a factor equal to the
            # downsampling factor, since it only calculates the needed outputs
            n_out = x.shape[axis] // q + bool(x.shape[axis] % q)
            y = upfirdn(b, x, up=1, down=q, axis=axis)
            sl[axis] = slice(None, n_out, None)

    else:  # IIR case
        if zero_phase:
            if iir_use_sos:
                y = sosfiltfilt(sos, x, axis=axis)
            else:
                y = filtfilt(b, a, x, axis=axis)
        else:
            if iir_use_sos:
                y = sosfilt(sos, x, axis=axis)
            else:
                y = lfilter(b, a, x, axis=axis)

        sl[axis] = slice(None, None, q)

    return y[tuple(sl)]
