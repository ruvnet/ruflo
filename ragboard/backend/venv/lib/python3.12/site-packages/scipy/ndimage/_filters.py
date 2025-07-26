# Copyright (C) 2003-2005 Peter J. Verveer
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions
# are met:
#
# 1. Redistributions of source code must retain the above copyright
#    notice, this list of conditions and the following disclaimer.
#
# 2. Redistributions in binary form must reproduce the above
#    copyright notice, this list of conditions and the following
#    disclaimer in the documentation and/or other materials provided
#    with the distribution.
#
# 3. The name of the author may not be used to endorse or promote
#    products derived from this software without specific prior
#    written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS
# OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
# WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
# DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
# DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
# GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
# WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
# NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
# SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

from collections.abc import Iterable
import numbers
import warnings
import numpy as np
import operator
import math

from scipy._lib._util import normalize_axis_index
from scipy._lib._array_api import array_namespace, is_cupy, xp_size
from . import _ni_support
from . import _nd_image
from . import _ni_docstrings
from . import _rank_filter_1d

__all__ = ['correlate1d', 'convolve1d', 'gaussian_filter1d', 'gaussian_filter',
           'prewitt', 'sobel', 'generic_laplace', 'laplace',
           'gaussian_laplace', 'generic_gradient_magnitude',
           'gaussian_gradient_magnitude', 'correlate', 'convolve',
           'uniform_filter1d', 'uniform_filter', 'minimum_filter1d',
           'maximum_filter1d', 'minimum_filter', 'maximum_filter',
           'rank_filter', 'median_filter', 'percentile_filter',
           'generic_filter1d', 'generic_filter', 'vectorized_filter']


def _vectorized_filter_iv(input, function, size, footprint, output, mode, cval, origin,
                          axes, batch_memory):
    xp = array_namespace(input, footprint, output)

    # vectorized_filter input validation and standardization
    input = xp.asarray(input)

    if not callable(function):
        raise ValueError("`function` must be a callable.")

    if size is None and footprint is None:
        raise ValueError("Either `size` or `footprint` must be provided.")

    if size is not None and footprint is not None:
        raise ValueError("Either `size` or `footprint` may be provided, not both.")

    if axes is None:
        axes = tuple(range(-input.ndim, 0))
    elif np.isscalar(axes):
        axes = (axes,)
    n_axes = len(axes)
    n_batch = input.ndim - n_axes

    if n_axes > input.ndim:
        message = ("The length of `axes` may not exceed the dimensionality of `input`"
                   "(`input.ndim`).")
        raise ValueError(message)

    # Either footprint or size must be provided
    footprinted_function = function
    if size is not None:
        # If provided, size must be an integer or tuple of integers.
        size = (size,)*n_axes if np.isscalar(size) else tuple(size)
        valid = [xp.isdtype(xp.asarray(i).dtype, 'integral') and i > 0 for i in size]
        if not all(valid):
            raise ValueError("All elements of `size` must be positive integers.")
    else:
        # If provided, `footprint` must be array-like
        footprint = xp.asarray(footprint, dtype=xp.bool)
        size = footprint.shape
        def footprinted_function(input, *args, axis=-1, **kwargs):
            return function(input[..., footprint], *args, axis=-1, **kwargs)

    # And by now, the dimensionality of the footprint must equal the number of axes
    if n_axes != len(size):
        message = ("`axes` must be compatible with the dimensionality "
                   "of the window specified by `size` or `footprint`.")
        raise ValueError(message)

    # If this is not *equal* to the dimensionality of `input`, then `axes`
    # must be a provided tuple, and its length must equal the core dimensionality.
    elif n_axes < input.ndim:
        if axes is None:
            message = ("`axes` must be provided if the dimensionality of the window "
                       "(`len(size)` or `footprint.ndim`) does not equal the number "
                       "of axes of `input` (`input.ndim`).")
            raise ValueError(message)
    else:
        axes = tuple(range(-n_axes, 0)) if axes is None else axes

    axes = (axes,) if np.isscalar(axes) else axes

    # If `origin` is provided, then it must be "broadcastable" to a tuple with length
    # equal to the core dimensionality.
    if origin is None:
        origin = (0,) * n_axes
    else:
        origin = (origin,)*n_axes if np.isscalar(origin) else tuple(origin)
        integral = [xp.isdtype(xp.asarray(i).dtype, 'integral') for i in origin]
        if not all(integral):
            raise ValueError("All elements of `origin` must be integers.")
        if not len(origin) == n_axes:
            message = ("`origin` must be an integer or tuple of integers with length "
                       "equal to the number of axes.")
            raise ValueError(message)

    # mode must be one of the allowed strings, and we should convert it to the
    # value required by `np.pad`/`cp.pad` here.
    valid_modes = {'reflect', 'constant', 'nearest', 'mirror', 'wrap',
                   'grid-mirror', 'grid-constant', 'grid-wrap', 'valid'}
    if mode not in valid_modes:
        raise ValueError(f"`mode` must be one of {valid_modes}.")
    mode_map = {'nearest': 'edge', 'reflect': 'symmetric', 'mirror': 'reflect',
                'grid-mirror': 'reflect', 'grid-constant': 'constant',
                'grid-wrap': 'wrap'}
    mode = mode_map.get(mode, mode)

    if mode == 'valid' and any(origin):
        raise ValueError("`mode='valid'` is incompatible with use of `origin`.")

    if cval is None:
        cval = 0.0
    elif mode != 'constant':
        raise ValueError("Use of `cval` is compatible only with `mode='constant'`.")

    # `cval` must be a scalar or "broadcastable" to a tuple with the same
    # dimensionality of `input`. (Full input validation done by `np.pad`/`cp.pad`.)
    if not xp.isdtype(xp.asarray(cval).dtype, 'numeric'):
        raise ValueError("`cval` must include only numbers.")

    # `batch_memory` must be a positive number.
    temp = xp.asarray(batch_memory)
    if temp.ndim != 0 or (not xp.isdtype(temp.dtype, 'numeric')) or temp <= 0:
        raise ValueError("`batch_memory` must be positive number.")

    # For simplicity, work with `axes` at the end.
    working_axes = tuple(range(-n_axes, 0))
    input = xp.moveaxis(input, axes, working_axes)
    output = (xp.moveaxis(output, axes, working_axes)
              if output is not None else output)

    # Wrap the function to limit maximum memory usage, deal with `footprint`,
    # and populate `output`. The latter requires some verbosity because we
    # don't know the output dtype.
    def wrapped_function(view, output=output):
        kwargs = {'axis': working_axes}

        if working_axes == ():
            return footprinted_function(xp.asarray(view), **kwargs)

        # for now, assume we only have to iterate over zeroth axis
        chunk_size = math.prod(view.shape[1:]) * view.dtype.itemsize
        slices_per_batch = min(view.shape[0], batch_memory // chunk_size)
        if slices_per_batch < 1:
            raise ValueError("`batch_memory` is insufficient for minimum chunk size.")

        elif slices_per_batch == view.shape[0]:
            if output is None:
                return footprinted_function(xp.asarray(view), **kwargs)
            else:
                output[...] = footprinted_function(xp.asarray(view), **kwargs)
                return output

        for i in range(0, view.shape[0], slices_per_batch):
            i2 = min(i + slices_per_batch, view.shape[0])
            if output is None:
                # Look at the dtype before allocating the array. (In a follow-up, we
                # can also look at the shape to support non-scalar elements.)
                temp = footprinted_function(xp.asarray(view[i:i2]), **kwargs)
                output = xp.empty(view.shape[:-n_axes], dtype=temp.dtype)
                output[i:i2, ...] = temp
            else:
                output[i:i2, ...] = footprinted_function(xp.asarray(view[i:i2]),
                                                         **kwargs)
        return output

    return (input, wrapped_function, size, mode, cval, origin,
            working_axes, axes, n_axes, n_batch, xp)


@_ni_docstrings.docfiller
def vectorized_filter(input, function, *, size=None, footprint=None, output=None,
                      mode='reflect', cval=None, origin=None, axes=None,
                      batch_memory=2**30):
    """Filter an array with a vectorized Python callable as the kernel

    Parameters
    ----------
    %(input)s
    function : callable
        Kernel to apply over a window centered at each element of `input`.
        Callable must have signature::

            function(window: ndarray, *, axis: int | tuple) -> scalar

        where ``axis`` specifies the axis (or axes) of ``window`` along which
        the filter function is evaluated.
    size : scalar or tuple, optional
        See `footprint` below. Ignored if `footprint` is given.
    footprint : array, optional
        Either `size` or `footprint` must be defined. `size` gives
        the shape that is taken from the input array, at every element
        position, to define the input to the filter function.
        `footprint` is a boolean array that specifies (implicitly) a
        shape, but also which of the elements within this shape will get
        passed to the filter function. Thus ``size=(n, m)`` is equivalent
        to ``footprint=np.ones((n, m))``.
        We adjust `size` to the number of dimensions indicated by `axes`.
        For instance, if `axes` is ``(0, 2, 1)`` and ``n`` is passed for ``size``,
        then the effective `size` is ``(n, n, n)``.
    %(output)s
    mode : {'reflect', 'constant', 'nearest', 'mirror', 'wrap'}, optional
        The `mode` parameter determines how the input array is extended
        beyond its boundaries. Default is 'reflect'. Behavior for each valid
        value is as follows:

        'reflect' (`d c b a | a b c d | d c b a`)
            The input is extended by reflecting about the edge of the last
            pixel. This mode is also sometimes referred to as half-sample
            symmetric.

        'constant' (`k k k k | a b c d | k k k k`)
            The input is extended by filling all values beyond the edge with
            the same constant value, defined by the `cval` parameter.

        'nearest' (`a a a a | a b c d | d d d d`)
            The input is extended by replicating the last pixel.

        'mirror' (`d c b | a b c d | c b a`)
            The input is extended by reflecting about the center of the last
            pixel. This mode is also sometimes referred to as whole-sample
            symmetric.

        'wrap' (`a b c d | a b c d | a b c d`)
            The input is extended by wrapping around to the opposite edge.

        'valid' (`| a b c d |`)
            The input is not extended; rather, the output shape is reduced depending
            on the window size according to the following calculation::

                window_size = np.asarray(size if size is not None else footprint.shape)
                output_shape = np.asarray(input.shape)
                output_shape[np.asarray(axes)] -= (window_size - 1)

    %(cval)s
    %(origin_multiple)s
    axes : tuple of int, optional
        If None, `input` is filtered along all axes. Otherwise, `input` is filtered
        along the specified axes. When `axes` is specified, the dimensionality of
        `footprint` and the length of any tuples used for `size` or `origin` must
        match the length of `axes`. The ith axis of `footprint` and the ith element
        in these tuples corresponds to the ith element of `axes`.
    batch_memory : int, default: 2**30
        The maximum number of bytes occupied by data in the ``window``
        array passed to ``function``.

    Returns
    -------
    output : ndarray
        Filtered array. The dtype is the output dtype of `function`. If `function` is
        scalar-valued when applied to a single window, the shape of the output is that
        of `input` (unless ``mode=='valid'``; see `mode` documentation). If `function`
        is multi-valued when applied to a single window, the placement of the
        corresponding dimensions within the output shape depends entirely on the
        behavior of `function`; see Examples.

    See Also
    --------
    scipy.ndimage.generic_filter

    Notes
    -----
    This function works by padding `input` according to `mode`, then calling the
    provided `function` on chunks of a sliding window view over the padded array.
    This approach is very simple and flexible, and so the function has many features
    not offered by some other filter functions (e.g. memory control, ``float16``
    and complex dtype support, and any NaN-handling features provided by the
    `function` argument).

    However, this brute-force approach may perform considerable redundant work.
    Use a specialized filter (e.g. `minimum_filter` instead of this function with
    `numpy.min` as the callable; `uniform_filter` instead of this function with
    `numpy.mean` as the callable) when possible, as it may use a more efficient
    algorithm.

    When a specialized filter is not available, this function is ideal when `function`
    is a vectorized, pure-Python callable. Even better performance may be possible
    by passing a `scipy.LowLevelCallable` to `generic_filter`. `generic_filter` may
    also be preferred for expensive callables with large filter footprints and
    callables that are not vectorized (i.e. those without ``axis`` support).

    This function does not provide the ``extra_arguments`` or ``extra_keywords``
    arguments provided by some `ndimage` functions. There are two reasons:

    - The passthrough functionality can be achieved by the user: simply wrap the
      original callable in another function that provides the required arguments;
      e.g., ``function=lambda input, axis: function(input, *extra_arguments, axis=axis, **extra_keywords)``.
    - There are use cases for `function` to be passed additional *sliding-window data*
      to `function` besides `input`. This is not yet implemented, but we reserve
      these argument names for such a feature, which would add capability rather than
      providing a duplicate interface to existing capability.

    Examples
    --------
    Suppose we wish to perform a median filter with even window size on a ``float16``
    image. Furthermore, the image has NaNs that we wish to be ignored (and effectively
    removed by the filter). `median_filter` does not support ``float16`` data, its
    behavior when NaNs are present is not defined, and for even window sizes, it does
    not return the usual sample median - the average of the two middle elements. This
    would be an excellent use case for `vectorized_filter` with
    ``function=np.nanmedian``, which supports the required interface: it accepts a
    data array of any shape as the first positional argument, and tuple of axes as
    keyword argument ``axis``.

    >>> import numpy as np
    >>> from scipy import datasets, ndimage
    >>> from scipy.ndimage import vectorized_filter
    >>> import matplotlib.pyplot as plt
    >>> ascent = ndimage.zoom(datasets.ascent(), 0.5).astype(np.float16)
    >>> ascent[::16, ::16] = np.nan
    >>> result = vectorized_filter(ascent, function=np.nanmedian, size=4)

    Plot the original and filtered images.

    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> fig.tight_layout()
    >>> plt.show()

    Another need satisfied by `vectorized_filter` is to perform multi-output
    filters. For instance, suppose we wish to filter an image according to the 25th
    and 75th percentiles in addition to the median. We could perform the three
    filters separately.

    >>> ascent = ndimage.zoom(datasets.ascent(), 0.5)
    >>> def get_quantile_fun(p):
    ...     return lambda x, axis: np.quantile(x, p, axis=axis)
    >>> ref1 = vectorized_filter(ascent, get_quantile_fun(0.25), size=4)
    >>> ref2 = vectorized_filter(ascent, get_quantile_fun(0.50), size=4)
    >>> ref3 = vectorized_filter(ascent, get_quantile_fun(0.75), size=4)
    >>> ref = np.stack([ref1, ref2, ref3])

    However, `vectorized_filter` also supports filters that return multiple outputs
    as long as `output` is unspecified and `batch_memory` is sufficiently high to
    perform the calculation in a single chunk.

    >>> def quartiles(x, axis):
    ...     return np.quantile(x, [0.25, 0.50, 0.75], axis=axis)
    >>> res = vectorized_filter(ascent, quartiles, size=4, batch_memory=np.inf)
    >>> np.all(np.isclose(res, ref))
    np.True_

    The placement of the additional dimension(s) corresponding with multiple outputs
    is at the discretion of `function`. `quartiles` happens to prepend one dimension
    corresponding with the three outputs simply because that is the behavior of
    `np.quantile`:

    >>> res.shape == (3,) + ascent.shape
    True

    If we wished for this dimension to be appended:

    >>> def quartiles(x, axis):
    ...     return np.moveaxis(np.quantile(x, [0.25, 0.50, 0.75], axis=axis), 0, -1)
    >>> res = vectorized_filter(ascent, quartiles, size=4, batch_memory=np.inf)
    >>> res.shape == ascent.shape + (3,)
    True

    Suppose we wish to implment a "mode" filter - a filter that selects the most
    frequently occuring value within the window. A simple (but rather slow)
    approach is to use `generic_filter` with `scipy.stats.mode`.

    >>> from scipy import stats
    >>> rng = np.random.default_rng(3195824598724609246)
    >>> input = rng.integers(255, size=(50, 50)).astype(np.uint8)
    >>> def simple_mode(input):
    ...     return stats.mode(input, axis=None).mode
    >>> ref = ndimage.generic_filter(input, simple_mode, size=5)

    If speed is important, `vectorized_filter` can take advantage of the performance
    benefit of a vectorized callable.

    >>> def vectorized_mode(x, axis=(-1,)):
    ...     n_axes = 1 if np.isscalar(axis) else len(axis)
    ...     x = np.moveaxis(x, axis, tuple(range(-n_axes, 0)))
    ...     x = np.reshape(x, x.shape[:-n_axes] + (-1,))
    ...     y = np.sort(x, axis=-1)
    ...     i = np.concatenate([np.ones(y.shape[:-1] + (1,), dtype=bool),
    ...                         y[..., :-1] != y[..., 1:]], axis=-1)
    ...     indices = np.arange(y.size)[i.ravel()]
    ...     counts = np.diff(indices, append=y.size)
    ...     counts = np.reshape(np.repeat(counts, counts), y.shape)
    ...     k = np.argmax(counts, axis=-1, keepdims=True)
    ...     return np.take_along_axis(y, k, axis=-1)[..., 0]
    >>> res = vectorized_filter(input, vectorized_mode, size=5)
    >>> np.all(res == ref)
    np.True_

    Depending on the machine, the `vectorized_filter` version may be as much as
    100x faster.

    """  # noqa: E501

    (input, function, size, mode, cval, origin, working_axes, axes, n_axes, n_batch, xp
     ) = _vectorized_filter_iv(input, function, size, footprint, output, mode, cval,
        origin, axes, batch_memory)

    # `np.pad`/`cp.pad` raises with these sorts of cases, but the best result is
    # probably to return the original array. It could be argued that we should call
    # the function on the empty array with `axis=None` just to determine the output
    # dtype, but I can also see rationale against that.
    if xp_size(input) == 0:
        return xp.asarray(input)

    # This seems to be defined.
    if input.ndim == 0 and size == ():
        return xp.asarray(function(input) if footprint is None
                          else function(input[footprint]))

    if is_cupy(xp):
        # CuPy is the only GPU backend that has `pad` (with all modes)
        # and `sliding_window_view`. An enhancement would be to use
        # no-copy conversion to CuPy whenever the data is on the GPU.
        cp = xp  # let there be no ambiguity!
        swv = cp.lib.stride_tricks.sliding_window_view
        pad = cp.pad
    else:
        # Try to perform no-copy conversion to NumPy for padding and
        # `sliding_window_view`. (If that fails, fine - for now, the only
        # GPU backend we support is CuPy.)
        swv = np.lib.stride_tricks.sliding_window_view
        pad = np.pad
        input = np.asarray(input)
        cval = np.asarray(cval)[()] if mode == 'constant' else None

    # Border the image according to `mode` and `offset`.
    if mode != 'valid':
        kwargs = {'constant_values': cval} if mode == 'constant' else {}
        borders = tuple((i//2 + j, (i-1)//2 - j) for i, j in zip(size, origin))
        bordered_input = pad(input, ((0, 0),)*n_batch + borders, mode=mode, **kwargs)
    else:
        bordered_input = input

    # Evaluate function with sliding window view. Function is already wrapped to
    # manage memory, deal with `footprint`, populate `output`, etc.
    view = swv(bordered_input, size, working_axes)
    res = function(view)

    # move working_axes back to original positions
    return xp.moveaxis(res, working_axes, axes)


def _invalid_origin(origin, lenw):
    return (origin < -(lenw // 2)) or (origin > (lenw - 1) // 2)


def _complex_via_real_components(func, input, weights, output, cval, **kwargs):
    """Complex convolution via a linear combination of real convolutions."""
    complex_input = input.dtype.kind == 'c'
    complex_weights = weights.dtype.kind == 'c'
    if complex_input and complex_weights:
        # real component of the output
        func(input.real, weights.real, output=output.real,
             cval=np.real(cval), **kwargs)
        output.real -= func(input.imag, weights.imag, output=None,
                            cval=np.imag(cval), **kwargs)
        # imaginary component of the output
        func(input.real, weights.imag, output=output.imag,
             cval=np.real(cval), **kwargs)
        output.imag += func(input.imag, weights.real, output=None,
                            cval=np.imag(cval), **kwargs)
    elif complex_input:
        func(input.real, weights, output=output.real, cval=np.real(cval),
             **kwargs)
        func(input.imag, weights, output=output.imag, cval=np.imag(cval),
             **kwargs)
    else:
        if np.iscomplexobj(cval):
            raise ValueError("Cannot provide a complex-valued cval when the "
                             "input is real.")
        func(input, weights.real, output=output.real, cval=cval, **kwargs)
        func(input, weights.imag, output=output.imag, cval=cval, **kwargs)
    return output


def _expand_origin(ndim_image, axes, origin):
    num_axes = len(axes)
    origins = _ni_support._normalize_sequence(origin, num_axes)
    if num_axes < ndim_image:
        # set origin = 0 for any axes not being filtered
        origins_temp = [0,] * ndim_image
        for o, ax in zip(origins, axes):
            origins_temp[ax] = o
        origins = origins_temp
    return origins


def _expand_footprint(ndim_image, axes, footprint,
                      footprint_name="footprint"):
    num_axes = len(axes)
    if num_axes < ndim_image:
        if footprint.ndim != num_axes:
            raise RuntimeError(f"{footprint_name}.ndim ({footprint.ndim}) "
                               f"must match len(axes) ({num_axes})")

        footprint = np.expand_dims(
            footprint,
            tuple(ax for ax in range(ndim_image) if ax not in axes)
        )
    return footprint


def _expand_mode(ndim_image, axes, mode):
    num_axes = len(axes)
    if not isinstance(mode, str) and isinstance(mode, Iterable):
        # set mode = 'constant' for any axes not being filtered
        modes = _ni_support._normalize_sequence(mode, num_axes)
        modes_temp = ['constant'] * ndim_image
        for m, ax in zip(modes, axes):
            modes_temp[ax] = m
        mode = modes_temp
    return mode


@_ni_docstrings.docfiller
def correlate1d(input, weights, axis=-1, output=None, mode="reflect",
                cval=0.0, origin=0):
    """Calculate a 1-D correlation along the given axis.

    The lines of the array along the given axis are correlated with the
    given weights.

    Parameters
    ----------
    %(input)s
    weights : array
        1-D sequence of numbers.
    %(axis)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin)s

    Returns
    -------
    result : ndarray
        Correlation result. Has the same shape as `input`.

    Examples
    --------
    >>> from scipy.ndimage import correlate1d
    >>> correlate1d([2, 8, 0, 4, 1, 9, 9, 0], weights=[1, 3])
    array([ 8, 26,  8, 12,  7, 28, 36,  9])
    """
    input = np.asarray(input)
    weights = np.asarray(weights)
    complex_input = input.dtype.kind == 'c'
    complex_weights = weights.dtype.kind == 'c'
    if complex_input or complex_weights:
        if complex_weights:
            weights = weights.conj()
            weights = weights.astype(np.complex128, copy=False)
        kwargs = dict(axis=axis, mode=mode, origin=origin)
        output = _ni_support._get_output(output, input, complex_output=True)
        return _complex_via_real_components(correlate1d, input, weights,
                                            output, cval, **kwargs)

    output = _ni_support._get_output(output, input)
    weights = np.asarray(weights, dtype=np.float64)
    if weights.ndim != 1 or weights.shape[0] < 1:
        raise RuntimeError('no filter weights given')
    if not weights.flags.contiguous:
        weights = weights.copy()
    axis = normalize_axis_index(axis, input.ndim)
    if _invalid_origin(origin, len(weights)):
        raise ValueError('Invalid origin; origin must satisfy '
                         '-(len(weights) // 2) <= origin <= '
                         '(len(weights)-1) // 2')
    mode = _ni_support._extend_mode_to_code(mode)
    _nd_image.correlate1d(input, weights, axis, output, mode, cval,
                          origin)
    return output


@_ni_docstrings.docfiller
def convolve1d(input, weights, axis=-1, output=None, mode="reflect",
               cval=0.0, origin=0):
    """Calculate a 1-D convolution along the given axis.

    The lines of the array along the given axis are convolved with the
    given weights.

    Parameters
    ----------
    %(input)s
    weights : ndarray
        1-D sequence of numbers.
    %(axis)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin)s

    Returns
    -------
    convolve1d : ndarray
        Convolved array with same shape as input

    Examples
    --------
    >>> from scipy.ndimage import convolve1d
    >>> convolve1d([2, 8, 0, 4, 1, 9, 9, 0], weights=[1, 3])
    array([14, 24,  4, 13, 12, 36, 27,  0])
    """
    weights = np.asarray(weights)
    weights = weights[::-1]
    origin = -origin
    if not weights.shape[0] & 1:
        origin -= 1
    if weights.dtype.kind == 'c':
        # pre-conjugate here to counteract the conjugation in correlate1d
        weights = weights.conj()
    return correlate1d(input, weights, axis, output, mode, cval, origin)


def _gaussian_kernel1d(sigma, order, radius):
    """
    Computes a 1-D Gaussian convolution kernel.
    """
    if order < 0:
        raise ValueError('order must be non-negative')
    exponent_range = np.arange(order + 1)
    sigma2 = sigma * sigma
    x = np.arange(-radius, radius+1)
    phi_x = np.exp(-0.5 / sigma2 * x ** 2)
    phi_x = phi_x / phi_x.sum()

    if order == 0:
        return phi_x
    else:
        # f(x) = q(x) * phi(x) = q(x) * exp(p(x))
        # f'(x) = (q'(x) + q(x) * p'(x)) * phi(x)
        # p'(x) = -1 / sigma ** 2
        # Implement q'(x) + q(x) * p'(x) as a matrix operator and apply to the
        # coefficients of q(x)
        q = np.zeros(order + 1)
        q[0] = 1
        D = np.diag(exponent_range[1:], 1)  # D @ q(x) = q'(x)
        P = np.diag(np.ones(order)/-sigma2, -1)  # P @ q(x) = q(x) * p'(x)
        Q_deriv = D + P
        for _ in range(order):
            q = Q_deriv.dot(q)
        q = (x[:, None] ** exponent_range).dot(q)
        return q * phi_x


@_ni_docstrings.docfiller
def gaussian_filter1d(input, sigma, axis=-1, order=0, output=None,
                      mode="reflect", cval=0.0, truncate=4.0, *, radius=None):
    """1-D Gaussian filter.

    Parameters
    ----------
    %(input)s
    sigma : scalar
        standard deviation for Gaussian kernel
    %(axis)s
    order : int, optional
        An order of 0 corresponds to convolution with a Gaussian
        kernel. A positive order corresponds to convolution with
        that derivative of a Gaussian.
    %(output)s
    %(mode_reflect)s
    %(cval)s
    truncate : float, optional
        Truncate the filter at this many standard deviations.
        Default is 4.0.
    radius : None or int, optional
        Radius of the Gaussian kernel. If specified, the size of
        the kernel will be ``2*radius + 1``, and `truncate` is ignored.
        Default is None.

    Returns
    -------
    gaussian_filter1d : ndarray

    Notes
    -----
    The Gaussian kernel will have size ``2*radius + 1`` along each axis. If
    `radius` is None, a default ``radius = round(truncate * sigma)`` will be
    used.

    Examples
    --------
    >>> from scipy.ndimage import gaussian_filter1d
    >>> import numpy as np
    >>> gaussian_filter1d([1.0, 2.0, 3.0, 4.0, 5.0], 1)
    array([ 1.42704095,  2.06782203,  3.        ,  3.93217797,  4.57295905])
    >>> gaussian_filter1d([1.0, 2.0, 3.0, 4.0, 5.0], 4)
    array([ 2.91948343,  2.95023502,  3.        ,  3.04976498,  3.08051657])
    >>> import matplotlib.pyplot as plt
    >>> rng = np.random.default_rng()
    >>> x = rng.standard_normal(101).cumsum()
    >>> y3 = gaussian_filter1d(x, 3)
    >>> y6 = gaussian_filter1d(x, 6)
    >>> plt.plot(x, 'k', label='original data')
    >>> plt.plot(y3, '--', label='filtered, sigma=3')
    >>> plt.plot(y6, ':', label='filtered, sigma=6')
    >>> plt.legend()
    >>> plt.grid()
    >>> plt.show()

    """
    sd = float(sigma)
    # make the radius of the filter equal to truncate standard deviations
    lw = int(truncate * sd + 0.5)
    if radius is not None:
        lw = radius
    if not isinstance(lw, numbers.Integral) or lw < 0:
        raise ValueError('Radius must be a nonnegative integer.')
    # Since we are calling correlate, not convolve, revert the kernel
    weights = _gaussian_kernel1d(sigma, order, lw)[::-1]
    return correlate1d(input, weights, axis, output, mode, cval, 0)


@_ni_docstrings.docfiller
def gaussian_filter(input, sigma, order=0, output=None,
                    mode="reflect", cval=0.0, truncate=4.0, *, radius=None,
                    axes=None):
    """Multidimensional Gaussian filter.

    Parameters
    ----------
    %(input)s
    sigma : scalar or sequence of scalars
        Standard deviation for Gaussian kernel. The standard
        deviations of the Gaussian filter are given for each axis as a
        sequence, or as a single number, in which case it is equal for
        all axes.
    order : int or sequence of ints, optional
        The order of the filter along each axis is given as a sequence
        of integers, or as a single number. An order of 0 corresponds
        to convolution with a Gaussian kernel. A positive order
        corresponds to convolution with that derivative of a Gaussian.
    %(output)s
    %(mode_multiple)s
    %(cval)s
    truncate : float, optional
        Truncate the filter at this many standard deviations.
        Default is 4.0.
    radius : None or int or sequence of ints, optional
        Radius of the Gaussian kernel. The radius are given for each axis
        as a sequence, or as a single number, in which case it is equal
        for all axes. If specified, the size of the kernel along each axis
        will be ``2*radius + 1``, and `truncate` is ignored.
        Default is None.
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `sigma`, `order`, `mode` and/or `radius`
        must match the length of `axes`. The ith entry in any of these tuples
        corresponds to the ith entry in `axes`.

    Returns
    -------
    gaussian_filter : ndarray
        Returned array of same shape as `input`.

    Notes
    -----
    The multidimensional filter is implemented as a sequence of
    1-D convolution filters. The intermediate arrays are
    stored in the same data type as the output. Therefore, for output
    types with a limited precision, the results may be imprecise
    because intermediate results may be stored with insufficient
    precision.

    The Gaussian kernel will have size ``2*radius + 1`` along each axis. If
    `radius` is None, the default ``radius = round(truncate * sigma)`` will be
    used.

    Examples
    --------
    >>> from scipy.ndimage import gaussian_filter
    >>> import numpy as np
    >>> a = np.arange(50, step=2).reshape((5,5))
    >>> a
    array([[ 0,  2,  4,  6,  8],
           [10, 12, 14, 16, 18],
           [20, 22, 24, 26, 28],
           [30, 32, 34, 36, 38],
           [40, 42, 44, 46, 48]])
    >>> gaussian_filter(a, sigma=1)
    array([[ 4,  6,  8,  9, 11],
           [10, 12, 14, 15, 17],
           [20, 22, 24, 25, 27],
           [29, 31, 33, 34, 36],
           [35, 37, 39, 40, 42]])

    >>> from scipy import datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = gaussian_filter(ascent, sigma=5)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    input = np.asarray(input)
    output = _ni_support._get_output(output, input)

    axes = _ni_support._check_axes(axes, input.ndim)
    num_axes = len(axes)
    orders = _ni_support._normalize_sequence(order, num_axes)
    sigmas = _ni_support._normalize_sequence(sigma, num_axes)
    modes = _ni_support._normalize_sequence(mode, num_axes)
    radiuses = _ni_support._normalize_sequence(radius, num_axes)
    axes = [(axes[ii], sigmas[ii], orders[ii], modes[ii], radiuses[ii])
            for ii in range(num_axes) if sigmas[ii] > 1e-15]
    if len(axes) > 0:
        for axis, sigma, order, mode, radius in axes:
            gaussian_filter1d(input, sigma, axis, order, output,
                              mode, cval, truncate, radius=radius)
            input = output
    else:
        output[...] = input[...]
    return output


@_ni_docstrings.docfiller
def prewitt(input, axis=-1, output=None, mode="reflect", cval=0.0):
    """Calculate a Prewitt filter.

    Parameters
    ----------
    %(input)s
    %(axis)s
    %(output)s
    %(mode_multiple)s
    %(cval)s

    Returns
    -------
    prewitt : ndarray
        Filtered array. Has the same shape as `input`.

    See Also
    --------
    sobel: Sobel filter

    Notes
    -----
    This function computes the one-dimensional Prewitt filter.
    Horizontal edges are emphasised with the horizontal transform (axis=0),
    vertical edges with the vertical transform (axis=1), and so on for higher
    dimensions. These can be combined to give the magnitude.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> import numpy as np
    >>> ascent = datasets.ascent()
    >>> prewitt_h = ndimage.prewitt(ascent, axis=0)
    >>> prewitt_v = ndimage.prewitt(ascent, axis=1)
    >>> magnitude = np.sqrt(prewitt_h ** 2 + prewitt_v ** 2)
    >>> magnitude *= 255 / np.max(magnitude) # Normalization
    >>> fig, axes = plt.subplots(2, 2, figsize = (8, 8))
    >>> plt.gray()
    >>> axes[0, 0].imshow(ascent)
    >>> axes[0, 1].imshow(prewitt_h)
    >>> axes[1, 0].imshow(prewitt_v)
    >>> axes[1, 1].imshow(magnitude)
    >>> titles = ["original", "horizontal", "vertical", "magnitude"]
    >>> for i, ax in enumerate(axes.ravel()):
    ...     ax.set_title(titles[i])
    ...     ax.axis("off")
    >>> plt.show()

    """
    input = np.asarray(input)
    axis = normalize_axis_index(axis, input.ndim)
    output = _ni_support._get_output(output, input)
    modes = _ni_support._normalize_sequence(mode, input.ndim)
    correlate1d(input, [-1, 0, 1], axis, output, modes[axis], cval, 0)
    axes = [ii for ii in range(input.ndim) if ii != axis]
    for ii in axes:
        correlate1d(output, [1, 1, 1], ii, output, modes[ii], cval, 0,)
    return output


@_ni_docstrings.docfiller
def sobel(input, axis=-1, output=None, mode="reflect", cval=0.0):
    """Calculate a Sobel filter.

    Parameters
    ----------
    %(input)s
    %(axis)s
    %(output)s
    %(mode_multiple)s
    %(cval)s

    Returns
    -------
    sobel : ndarray
        Filtered array. Has the same shape as `input`.

    Notes
    -----
    This function computes the axis-specific Sobel gradient.
    The horizontal edges can be emphasised with the horizontal transform (axis=0),
    the vertical edges with the vertical transform (axis=1) and so on for higher
    dimensions. These can be combined to give the magnitude.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> import numpy as np
    >>> ascent = datasets.ascent().astype('int32')
    >>> sobel_h = ndimage.sobel(ascent, 0)  # horizontal gradient
    >>> sobel_v = ndimage.sobel(ascent, 1)  # vertical gradient
    >>> magnitude = np.sqrt(sobel_h**2 + sobel_v**2)
    >>> magnitude *= 255.0 / np.max(magnitude)  # normalization
    >>> fig, axs = plt.subplots(2, 2, figsize=(8, 8))
    >>> plt.gray()  # show the filtered result in grayscale
    >>> axs[0, 0].imshow(ascent)
    >>> axs[0, 1].imshow(sobel_h)
    >>> axs[1, 0].imshow(sobel_v)
    >>> axs[1, 1].imshow(magnitude)
    >>> titles = ["original", "horizontal", "vertical", "magnitude"]
    >>> for i, ax in enumerate(axs.ravel()):
    ...     ax.set_title(titles[i])
    ...     ax.axis("off")
    >>> plt.show()

    """
    input = np.asarray(input)
    axis = normalize_axis_index(axis, input.ndim)
    output = _ni_support._get_output(output, input)
    modes = _ni_support._normalize_sequence(mode, input.ndim)
    correlate1d(input, [-1, 0, 1], axis, output, modes[axis], cval, 0)
    axes = [ii for ii in range(input.ndim) if ii != axis]
    for ii in axes:
        correlate1d(output, [1, 2, 1], ii, output, modes[ii], cval, 0)
    return output


@_ni_docstrings.docfiller
def generic_laplace(input, derivative2, output=None, mode="reflect",
                    cval=0.0,
                    extra_arguments=(),
                    extra_keywords=None,
                    *, axes=None):
    """
    N-D Laplace filter using a provided second derivative function.

    Parameters
    ----------
    %(input)s
    derivative2 : callable
        Callable with the following signature::

            derivative2(input, axis, output, mode, cval,
                        *extra_arguments, **extra_keywords)

        See `extra_arguments`, `extra_keywords` below.
    %(output)s
    %(mode_multiple)s
    %(cval)s
    %(extra_keywords)s
    %(extra_arguments)s
    axes : tuple of int or None
        The axes over which to apply the filter. If a `mode` tuple is
        provided, its length must match the number of axes.

    Returns
    -------
    generic_laplace : ndarray
        Filtered array. Has the same shape as `input`.

    """
    if extra_keywords is None:
        extra_keywords = {}
    input = np.asarray(input)
    output = _ni_support._get_output(output, input)
    axes = _ni_support._check_axes(axes, input.ndim)
    if len(axes) > 0:
        modes = _ni_support._normalize_sequence(mode, len(axes))
        derivative2(input, axes[0], output, modes[0], cval,
                    *extra_arguments, **extra_keywords)
        for ii in range(1, len(axes)):
            tmp = derivative2(input, axes[ii], output.dtype, modes[ii], cval,
                              *extra_arguments, **extra_keywords)
            output += tmp
    else:
        output[...] = input[...]
    return output


@_ni_docstrings.docfiller
def laplace(input, output=None, mode="reflect", cval=0.0, *, axes=None):
    """N-D Laplace filter based on approximate second derivatives.

    Parameters
    ----------
    %(input)s
    %(output)s
    %(mode_multiple)s
    %(cval)s
    axes : tuple of int or None
        The axes over which to apply the filter. If a `mode` tuple is
        provided, its length must match the number of axes.

    Returns
    -------
    laplace : ndarray
        Filtered array. Has the same shape as `input`.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = ndimage.laplace(ascent)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    def derivative2(input, axis, output, mode, cval):
        return correlate1d(input, [1, -2, 1], axis, output, mode, cval, 0)
    return generic_laplace(input, derivative2, output, mode, cval, axes=axes)


@_ni_docstrings.docfiller
def gaussian_laplace(input, sigma, output=None, mode="reflect",
                     cval=0.0, *, axes=None, **kwargs):
    """Multidimensional Laplace filter using Gaussian second derivatives.

    Parameters
    ----------
    %(input)s
    sigma : scalar or sequence of scalars
        The standard deviations of the Gaussian filter are given for
        each axis as a sequence, or as a single number, in which case
        it is equal for all axes.
    %(output)s
    %(mode_multiple)s
    %(cval)s
    axes : tuple of int or None
        The axes over which to apply the filter. If `sigma` or `mode` tuples
        are provided, their length must match the number of axes.
    Extra keyword arguments will be passed to gaussian_filter().

    Returns
    -------
    gaussian_laplace : ndarray
        Filtered array. Has the same shape as `input`.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> ascent = datasets.ascent()

    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side

    >>> result = ndimage.gaussian_laplace(ascent, sigma=1)
    >>> ax1.imshow(result)

    >>> result = ndimage.gaussian_laplace(ascent, sigma=3)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    input = np.asarray(input)

    def derivative2(input, axis, output, mode, cval, sigma, **kwargs):
        order = [0] * input.ndim
        order[axis] = 2
        return gaussian_filter(input, sigma, order, output, mode, cval,
                               **kwargs)

    axes = _ni_support._check_axes(axes, input.ndim)
    num_axes = len(axes)
    sigma = _ni_support._normalize_sequence(sigma, num_axes)
    if num_axes < input.ndim:
        # set sigma = 0 for any axes not being filtered
        sigma_temp = [0,] * input.ndim
        for s, ax in zip(sigma, axes):
            sigma_temp[ax] = s
        sigma = sigma_temp

    return generic_laplace(input, derivative2, output, mode, cval,
                           extra_arguments=(sigma,),
                           extra_keywords=kwargs,
                           axes=axes)


@_ni_docstrings.docfiller
def generic_gradient_magnitude(input, derivative, output=None,
                               mode="reflect", cval=0.0,
                               extra_arguments=(), extra_keywords=None,
                               *, axes=None):
    """Gradient magnitude using a provided gradient function.

    Parameters
    ----------
    %(input)s
    derivative : callable
        Callable with the following signature::

            derivative(input, axis, output, mode, cval,
                       *extra_arguments, **extra_keywords)

        See `extra_arguments`, `extra_keywords` below.
        `derivative` can assume that `input` and `output` are ndarrays.
        Note that the output from `derivative` is modified inplace;
        be careful to copy important inputs before returning them.
    %(output)s
    %(mode_multiple)s
    %(cval)s
    %(extra_keywords)s
    %(extra_arguments)s
    axes : tuple of int or None
        The axes over which to apply the filter. If a `mode` tuple is
        provided, its length must match the number of axes.

    Returns
    -------
    generic_gradient_magnitude : ndarray
        Filtered array. Has the same shape as `input`.

    """
    if extra_keywords is None:
        extra_keywords = {}
    input = np.asarray(input)
    output = _ni_support._get_output(output, input)
    axes = _ni_support._check_axes(axes, input.ndim)
    if len(axes) > 0:
        modes = _ni_support._normalize_sequence(mode, len(axes))
        derivative(input, axes[0], output, modes[0], cval,
                   *extra_arguments, **extra_keywords)
        np.multiply(output, output, output)
        for ii in range(1, len(axes)):
            tmp = derivative(input, axes[ii], output.dtype, modes[ii], cval,
                             *extra_arguments, **extra_keywords)
            np.multiply(tmp, tmp, tmp)
            output += tmp
        # This allows the sqrt to work with a different default casting
        np.sqrt(output, output, casting='unsafe')
    else:
        output[...] = input[...]
    return output


@_ni_docstrings.docfiller
def gaussian_gradient_magnitude(input, sigma, output=None,
                                mode="reflect", cval=0.0, *, axes=None,
                                **kwargs):
    """Multidimensional gradient magnitude using Gaussian derivatives.

    Parameters
    ----------
    %(input)s
    sigma : scalar or sequence of scalars
        The standard deviations of the Gaussian filter are given for
        each axis as a sequence, or as a single number, in which case
        it is equal for all axes.
    %(output)s
    %(mode_multiple)s
    %(cval)s
    axes : tuple of int or None
        The axes over which to apply the filter. If `sigma` or `mode` tuples
        are provided, their length must match the number of axes.
    Extra keyword arguments will be passed to gaussian_filter().

    Returns
    -------
    gaussian_gradient_magnitude : ndarray
        Filtered array. Has the same shape as `input`.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = ndimage.gaussian_gradient_magnitude(ascent, sigma=5)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    input = np.asarray(input)

    def derivative(input, axis, output, mode, cval, sigma, **kwargs):
        order = [0] * input.ndim
        order[axis] = 1
        return gaussian_filter(input, sigma, order, output, mode,
                               cval, **kwargs)

    return generic_gradient_magnitude(input, derivative, output, mode,
                                      cval, extra_arguments=(sigma,),
                                      extra_keywords=kwargs, axes=axes)


def _correlate_or_convolve(input, weights, output, mode, cval, origin,
                           convolution, axes):
    input = np.asarray(input)
    weights = np.asarray(weights)
    complex_input = input.dtype.kind == 'c'
    complex_weights = weights.dtype.kind == 'c'
    if complex_input or complex_weights:
        if complex_weights and not convolution:
            # As for np.correlate, conjugate weights rather than input.
            weights = weights.conj()
        kwargs = dict(
            mode=mode, origin=origin, convolution=convolution, axes=axes
        )
        output = _ni_support._get_output(output, input, complex_output=True)

        return _complex_via_real_components(_correlate_or_convolve, input,
                                            weights, output, cval, **kwargs)

    axes = _ni_support._check_axes(axes, input.ndim)
    weights = np.asarray(weights, dtype=np.float64)

    # expand weights and origins if num_axes < input.ndim
    weights = _expand_footprint(input.ndim, axes, weights, "weights")
    origins = _expand_origin(input.ndim, axes, origin)

    wshape = [ii for ii in weights.shape if ii > 0]
    if len(wshape) != input.ndim:
        raise RuntimeError(f"weights.ndim ({len(wshape)}) must match "
                           f"len(axes) ({len(axes)})")
    if convolution:
        weights = weights[tuple([slice(None, None, -1)] * weights.ndim)]
        for ii in range(len(origins)):
            origins[ii] = -origins[ii]
            if not weights.shape[ii] & 1:
                origins[ii] -= 1
    for origin, lenw in zip(origins, wshape):
        if _invalid_origin(origin, lenw):
            raise ValueError('Invalid origin; origin must satisfy '
                             '-(weights.shape[k] // 2) <= origin[k] <= '
                             '(weights.shape[k]-1) // 2')

    if not weights.flags.contiguous:
        weights = weights.copy()
    output = _ni_support._get_output(output, input)
    temp_needed = np.may_share_memory(input, output)
    if temp_needed:
        # input and output arrays cannot share memory
        temp = output
        output = _ni_support._get_output(output.dtype, input)
    if not isinstance(mode, str) and isinstance(mode, Iterable):
        raise RuntimeError("A sequence of modes is not supported")
    mode = _ni_support._extend_mode_to_code(mode)
    _nd_image.correlate(input, weights, output, mode, cval, origins)
    if temp_needed:
        temp[...] = output
        output = temp
    return output


@_ni_docstrings.docfiller
def correlate(input, weights, output=None, mode='reflect', cval=0.0,
              origin=0, *, axes=None):
    """
    Multidimensional correlation.

    The array is correlated with the given kernel.

    Parameters
    ----------
    %(input)s
    weights : ndarray
        array of weights, same number of dimensions as input
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin_multiple)s
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `mode` or `origin` must match the length
        of `axes`. The ith entry in any of these tuples corresponds to the ith
        entry in `axes`.

    Returns
    -------
    result : ndarray
        The result of correlation of `input` with `weights`.

    See Also
    --------
    convolve : Convolve an image with a kernel.

    Examples
    --------
    Correlation is the process of moving a filter mask often referred to
    as kernel over the image and computing the sum of products at each location.

    >>> from scipy.ndimage import correlate
    >>> import numpy as np
    >>> input_img = np.arange(25).reshape(5,5)
    >>> print(input_img)
    [[ 0  1  2  3  4]
    [ 5  6  7  8  9]
    [10 11 12 13 14]
    [15 16 17 18 19]
    [20 21 22 23 24]]

    Define a kernel (weights) for correlation. In this example, it is for sum of
    center and up, down, left and right next elements.

    >>> weights = [[0, 1, 0],
    ...            [1, 1, 1],
    ...            [0, 1, 0]]

    We can calculate a correlation result:
    For example, element ``[2,2]`` is ``7 + 11 + 12 + 13 + 17 = 60``.

    >>> correlate(input_img, weights)
    array([[  6,  10,  15,  20,  24],
        [ 26,  30,  35,  40,  44],
        [ 51,  55,  60,  65,  69],
        [ 76,  80,  85,  90,  94],
        [ 96, 100, 105, 110, 114]])

    """
    return _correlate_or_convolve(input, weights, output, mode, cval,
                                  origin, False, axes)


@_ni_docstrings.docfiller
def convolve(input, weights, output=None, mode='reflect', cval=0.0,
             origin=0, *, axes=None):
    """
    Multidimensional convolution.

    The array is convolved with the given kernel.

    Parameters
    ----------
    %(input)s
    weights : array_like
        Array of weights, same number of dimensions as input
    %(output)s
    %(mode_reflect)s
    cval : scalar, optional
        Value to fill past edges of input if `mode` is 'constant'. Default
        is 0.0
    origin : int or sequence, optional
        Controls the placement of the filter on the input array's pixels.
        A value of 0 (the default) centers the filter over the pixel, with
        positive values shifting the filter to the right, and negative ones
        to the left. By passing a sequence of origins with length equal to
        the number of dimensions of the input array, different shifts can
        be specified along each axis.
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `mode` or `origin` must match the length
        of `axes`. The ith entry in any of these tuples corresponds to the ith
        entry in `axes`.

    Returns
    -------
    result : ndarray
        The result of convolution of `input` with `weights`.

    See Also
    --------
    correlate : Correlate an image with a kernel.

    Notes
    -----
    Each value in result is :math:`C_i = \\sum_j{I_{i+k-j} W_j}`, where
    W is the `weights` kernel,
    j is the N-D spatial index over :math:`W`,
    I is the `input` and k is the coordinate of the center of
    W, specified by `origin` in the input parameters.

    Examples
    --------
    Perhaps the simplest case to understand is ``mode='constant', cval=0.0``,
    because in this case borders (i.e., where the `weights` kernel, centered
    on any one value, extends beyond an edge of `input`) are treated as zeros.

    >>> import numpy as np
    >>> a = np.array([[1, 2, 0, 0],
    ...               [5, 3, 0, 4],
    ...               [0, 0, 0, 7],
    ...               [9, 3, 0, 0]])
    >>> k = np.array([[1,1,1],[1,1,0],[1,0,0]])
    >>> from scipy import ndimage
    >>> ndimage.convolve(a, k, mode='constant', cval=0.0)
    array([[11, 10,  7,  4],
           [10,  3, 11, 11],
           [15, 12, 14,  7],
           [12,  3,  7,  0]])

    Setting ``cval=1.0`` is equivalent to padding the outer edge of `input`
    with 1.0's (and then extracting only the original region of the result).

    >>> ndimage.convolve(a, k, mode='constant', cval=1.0)
    array([[13, 11,  8,  7],
           [11,  3, 11, 14],
           [16, 12, 14, 10],
           [15,  6, 10,  5]])

    With ``mode='reflect'`` (the default), outer values are reflected at the
    edge of `input` to fill in missing values.

    >>> b = np.array([[2, 0, 0],
    ...               [1, 0, 0],
    ...               [0, 0, 0]])
    >>> k = np.array([[0,1,0], [0,1,0], [0,1,0]])
    >>> ndimage.convolve(b, k, mode='reflect')
    array([[5, 0, 0],
           [3, 0, 0],
           [1, 0, 0]])

    This includes diagonally at the corners.

    >>> k = np.array([[1,0,0],[0,1,0],[0,0,1]])
    >>> ndimage.convolve(b, k)
    array([[4, 2, 0],
           [3, 2, 0],
           [1, 1, 0]])

    With ``mode='nearest'``, the single nearest value in to an edge in
    `input` is repeated as many times as needed to match the overlapping
    `weights`.

    >>> c = np.array([[2, 0, 1],
    ...               [1, 0, 0],
    ...               [0, 0, 0]])
    >>> k = np.array([[0, 1, 0],
    ...               [0, 1, 0],
    ...               [0, 1, 0],
    ...               [0, 1, 0],
    ...               [0, 1, 0]])
    >>> ndimage.convolve(c, k, mode='nearest')
    array([[7, 0, 3],
           [5, 0, 2],
           [3, 0, 1]])

    """
    return _correlate_or_convolve(input, weights, output, mode, cval,
                                  origin, True, axes)


@_ni_docstrings.docfiller
def uniform_filter1d(input, size, axis=-1, output=None,
                     mode="reflect", cval=0.0, origin=0):
    """Calculate a 1-D uniform filter along the given axis.

    The lines of the array along the given axis are filtered with a
    uniform filter of given size.

    Parameters
    ----------
    %(input)s
    size : int
        length of uniform filter
    %(axis)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin)s

    Returns
    -------
    result : ndarray
        Filtered array. Has same shape as `input`.

    Examples
    --------
    >>> from scipy.ndimage import uniform_filter1d
    >>> uniform_filter1d([2, 8, 0, 4, 1, 9, 9, 0], size=3)
    array([4, 3, 4, 1, 4, 6, 6, 3])
    """
    input = np.asarray(input)
    axis = normalize_axis_index(axis, input.ndim)
    if size < 1:
        raise RuntimeError('incorrect filter size')
    complex_output = input.dtype.kind == 'c'
    output = _ni_support._get_output(output, input,
                                     complex_output=complex_output)
    if (size // 2 + origin < 0) or (size // 2 + origin >= size):
        raise ValueError('invalid origin')
    mode = _ni_support._extend_mode_to_code(mode)
    if not complex_output:
        _nd_image.uniform_filter1d(input, size, axis, output, mode, cval,
                                   origin)
    else:
        _nd_image.uniform_filter1d(input.real, size, axis, output.real, mode,
                                   np.real(cval), origin)
        _nd_image.uniform_filter1d(input.imag, size, axis, output.imag, mode,
                                   np.imag(cval), origin)
    return output


@_ni_docstrings.docfiller
def uniform_filter(input, size=3, output=None, mode="reflect",
                   cval=0.0, origin=0, *, axes=None):
    """Multidimensional uniform filter.

    Parameters
    ----------
    %(input)s
    size : int or sequence of ints, optional
        The sizes of the uniform filter are given for each axis as a
        sequence, or as a single number, in which case the size is
        equal for all axes.
    %(output)s
    %(mode_multiple)s
    %(cval)s
    %(origin_multiple)s
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `size`, `origin`, and/or `mode`
        must match the length of `axes`. The ith entry in any of these tuples
        corresponds to the ith entry in `axes`.

    Returns
    -------
    uniform_filter : ndarray
        Filtered array. Has the same shape as `input`.

    Notes
    -----
    The multidimensional filter is implemented as a sequence of
    1-D uniform filters. The intermediate arrays are stored
    in the same data type as the output. Therefore, for output types
    with a limited precision, the results may be imprecise because
    intermediate results may be stored with insufficient precision.

    %(nan)s

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = ndimage.uniform_filter(ascent, size=20)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    input = np.asarray(input)
    output = _ni_support._get_output(output, input,
                                     complex_output=input.dtype.kind == 'c')
    axes = _ni_support._check_axes(axes, input.ndim)
    num_axes = len(axes)
    sizes = _ni_support._normalize_sequence(size, num_axes)
    origins = _ni_support._normalize_sequence(origin, num_axes)
    modes = _ni_support._normalize_sequence(mode, num_axes)
    axes = [(axes[ii], sizes[ii], origins[ii], modes[ii])
            for ii in range(num_axes) if sizes[ii] > 1]
    if len(axes) > 0:
        for axis, size, origin, mode in axes:
            uniform_filter1d(input, int(size), axis, output, mode,
                             cval, origin)
            input = output
    else:
        output[...] = input[...]
    return output


@_ni_docstrings.docfiller
def minimum_filter1d(input, size, axis=-1, output=None,
                     mode="reflect", cval=0.0, origin=0):
    """Calculate a 1-D minimum filter along the given axis.

    The lines of the array along the given axis are filtered with a
    minimum filter of given size.

    Parameters
    ----------
    %(input)s
    size : int
        length along which to calculate 1D minimum
    %(axis)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin)s

    Returns
    -------
    result : ndarray.
        Filtered image. Has the same shape as `input`.

    Notes
    -----
    This function implements the MINLIST algorithm [1]_, as described by
    Richard Harter [2]_, and has a guaranteed O(n) performance, `n` being
    the `input` length, regardless of filter size.

    References
    ----------
    .. [1] http://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.42.2777
    .. [2] http://www.richardhartersworld.com/cri/2001/slidingmin.html


    Examples
    --------
    >>> from scipy.ndimage import minimum_filter1d
    >>> minimum_filter1d([2, 8, 0, 4, 1, 9, 9, 0], size=3)
    array([2, 0, 0, 0, 1, 1, 0, 0])
    """
    input = np.asarray(input)
    if np.iscomplexobj(input):
        raise TypeError('Complex type not supported')
    axis = normalize_axis_index(axis, input.ndim)
    if size < 1:
        raise RuntimeError('incorrect filter size')
    output = _ni_support._get_output(output, input)
    if (size // 2 + origin < 0) or (size // 2 + origin >= size):
        raise ValueError('invalid origin')
    mode = _ni_support._extend_mode_to_code(mode)
    _nd_image.min_or_max_filter1d(input, size, axis, output, mode, cval,
                                  origin, 1)
    return output


@_ni_docstrings.docfiller
def maximum_filter1d(input, size, axis=-1, output=None,
                     mode="reflect", cval=0.0, origin=0):
    """Calculate a 1-D maximum filter along the given axis.

    The lines of the array along the given axis are filtered with a
    maximum filter of given size.

    Parameters
    ----------
    %(input)s
    size : int
        Length along which to calculate the 1-D maximum.
    %(axis)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin)s

    Returns
    -------
    maximum1d : ndarray, None
        Maximum-filtered array with same shape as input.
        None if `output` is not None

    Notes
    -----
    This function implements the MAXLIST algorithm [1]_, as described by
    Richard Harter [2]_, and has a guaranteed O(n) performance, `n` being
    the `input` length, regardless of filter size.

    References
    ----------
    .. [1] http://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.42.2777
    .. [2] http://www.richardhartersworld.com/cri/2001/slidingmin.html

    Examples
    --------
    >>> from scipy.ndimage import maximum_filter1d
    >>> maximum_filter1d([2, 8, 0, 4, 1, 9, 9, 0], size=3)
    array([8, 8, 8, 4, 9, 9, 9, 9])
    """
    input = np.asarray(input)
    if np.iscomplexobj(input):
        raise TypeError('Complex type not supported')
    axis = normalize_axis_index(axis, input.ndim)
    if size < 1:
        raise RuntimeError('incorrect filter size')
    output = _ni_support._get_output(output, input)
    if (size // 2 + origin < 0) or (size // 2 + origin >= size):
        raise ValueError('invalid origin')
    mode = _ni_support._extend_mode_to_code(mode)
    _nd_image.min_or_max_filter1d(input, size, axis, output, mode, cval,
                                  origin, 0)
    return output


def _min_or_max_filter(input, size, footprint, structure, output, mode,
                       cval, origin, minimum, axes=None):
    if (size is not None) and (footprint is not None):
        warnings.warn("ignoring size because footprint is set",
                      UserWarning, stacklevel=3)
    if structure is None:
        if footprint is None:
            if size is None:
                raise RuntimeError("no footprint provided")
            separable = True
        else:
            footprint = np.asarray(footprint, dtype=bool)
            if not footprint.any():
                raise ValueError("All-zero footprint is not supported.")
            if footprint.all():
                size = footprint.shape
                footprint = None
                separable = True
            else:
                separable = False
    else:
        structure = np.asarray(structure, dtype=np.float64)
        separable = False
        if footprint is None:
            footprint = np.ones(structure.shape, bool)
        else:
            footprint = np.asarray(footprint, dtype=bool)
    input = np.asarray(input)
    if np.iscomplexobj(input):
        raise TypeError("Complex type not supported")
    output = _ni_support._get_output(output, input)
    temp_needed = np.may_share_memory(input, output)
    if temp_needed:
        # input and output arrays cannot share memory
        temp = output
        output = _ni_support._get_output(output.dtype, input)
    axes = _ni_support._check_axes(axes, input.ndim)
    num_axes = len(axes)
    if separable:
        origins = _ni_support._normalize_sequence(origin, num_axes)
        sizes = _ni_support._normalize_sequence(size, num_axes)
        modes = _ni_support._normalize_sequence(mode, num_axes)
        axes = [(axes[ii], sizes[ii], origins[ii], modes[ii])
                for ii in range(len(axes)) if sizes[ii] > 1]
        if minimum:
            filter_ = minimum_filter1d
        else:
            filter_ = maximum_filter1d
        if len(axes) > 0:
            for axis, size, origin, mode in axes:
                filter_(input, int(size), axis, output, mode, cval, origin)
                input = output
        else:
            output[...] = input[...]
    else:
        # expand origins and footprint if num_axes < input.ndim
        footprint = _expand_footprint(input.ndim, axes, footprint)
        origins = _expand_origin(input.ndim, axes, origin)

        fshape = [ii for ii in footprint.shape if ii > 0]
        if len(fshape) != input.ndim:
            raise RuntimeError(f"footprint.ndim ({footprint.ndim}) must match "
                               f"len(axes) ({len(axes)})")
        for origin, lenf in zip(origins, fshape):
            if (lenf // 2 + origin < 0) or (lenf // 2 + origin >= lenf):
                raise ValueError("invalid origin")
        if not footprint.flags.contiguous:
            footprint = footprint.copy()
        if structure is not None:
            if len(structure.shape) != num_axes:
                raise RuntimeError("structure array has incorrect shape")
            if num_axes != structure.ndim:
                structure = np.expand_dims(
                    structure,
                    tuple(ax for ax in range(structure.ndim) if ax not in axes)
                )
            if not structure.flags.contiguous:
                structure = structure.copy()
        if not isinstance(mode, str) and isinstance(mode, Iterable):
            raise RuntimeError(
                "A sequence of modes is not supported for non-separable "
                "footprints")
        mode = _ni_support._extend_mode_to_code(mode)
        _nd_image.min_or_max_filter(input, footprint, structure, output,
                                    mode, cval, origins, minimum)
    if temp_needed:
        temp[...] = output
        output = temp
    return output


@_ni_docstrings.docfiller
def minimum_filter(input, size=None, footprint=None, output=None,
                   mode="reflect", cval=0.0, origin=0, *, axes=None):
    """Calculate a multidimensional minimum filter.

    Parameters
    ----------
    %(input)s
    %(size_foot)s
    %(output)s
    %(mode_multiple)s
    %(cval)s
    %(origin_multiple)s
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `size`, `origin`, and/or `mode`
        must match the length of `axes`. The ith entry in any of these tuples
        corresponds to the ith entry in `axes`.

    Returns
    -------
    minimum_filter : ndarray
        Filtered array. Has the same shape as `input`.

    Notes
    -----
    A sequence of modes (one per axis) is only supported when the footprint is
    separable. Otherwise, a single mode string must be provided.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = ndimage.minimum_filter(ascent, size=20)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    return _min_or_max_filter(input, size, footprint, None, output, mode,
                              cval, origin, 1, axes)


@_ni_docstrings.docfiller
def maximum_filter(input, size=None, footprint=None, output=None,
                   mode="reflect", cval=0.0, origin=0, *, axes=None):
    """Calculate a multidimensional maximum filter.

    Parameters
    ----------
    %(input)s
    %(size_foot)s
    %(output)s
    %(mode_multiple)s
    %(cval)s
    %(origin_multiple)s
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `size`, `origin`, and/or `mode`
        must match the length of `axes`. The ith entry in any of these tuples
        corresponds to the ith entry in `axes`.

    Returns
    -------
    maximum_filter : ndarray
        Filtered array. Has the same shape as `input`.

    Notes
    -----
    A sequence of modes (one per axis) is only supported when the footprint is
    separable. Otherwise, a single mode string must be provided.

    %(nan)s

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = ndimage.maximum_filter(ascent, size=20)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    return _min_or_max_filter(input, size, footprint, None, output, mode,
                              cval, origin, 0, axes)


@_ni_docstrings.docfiller
def _rank_filter(input, rank, size=None, footprint=None, output=None,
                 mode="reflect", cval=0.0, origin=0, operation='rank',
                 axes=None):
    if (size is not None) and (footprint is not None):
        warnings.warn("ignoring size because footprint is set",
                      UserWarning, stacklevel=3)
    input = np.asarray(input)
    if np.iscomplexobj(input):
        raise TypeError('Complex type not supported')
    axes = _ni_support._check_axes(axes, input.ndim)
    num_axes = len(axes)
    if footprint is None:
        if size is None:
            raise RuntimeError("no footprint or filter size provided")
        sizes = _ni_support._normalize_sequence(size, num_axes)
        footprint = np.ones(sizes, dtype=bool)
    else:
        footprint = np.asarray(footprint, dtype=bool)
    # expand origins, footprint and modes if num_axes < input.ndim
    footprint = _expand_footprint(input.ndim, axes, footprint)
    origins = _expand_origin(input.ndim, axes, origin)
    mode = _expand_mode(input.ndim, axes, mode)

    fshape = [ii for ii in footprint.shape if ii > 0]
    if len(fshape) != input.ndim:
        raise RuntimeError(f"footprint.ndim ({footprint.ndim}) must match "
                           f"len(axes) ({len(axes)})")
    for origin, lenf in zip(origins, fshape):
        if (lenf // 2 + origin < 0) or (lenf // 2 + origin >= lenf):
            raise ValueError('invalid origin')
    if not footprint.flags.contiguous:
        footprint = footprint.copy()
    filter_size = np.where(footprint, 1, 0).sum()
    if operation == 'median':
        rank = filter_size // 2
    elif operation == 'percentile':
        percentile = rank
        if percentile < 0.0:
            percentile += 100.0
        if percentile < 0 or percentile > 100:
            raise RuntimeError('invalid percentile')
        if percentile == 100.0:
            rank = filter_size - 1
        else:
            rank = int(float(filter_size) * percentile / 100.0)
    if rank < 0:
        rank += filter_size
    if rank < 0 or rank >= filter_size:
        raise RuntimeError('rank not within filter footprint size')
    if rank == 0:
        return minimum_filter(input, None, footprint, output, mode, cval,
                              origins, axes=None)
    elif rank == filter_size - 1:
        return maximum_filter(input, None, footprint, output, mode, cval,
                              origins, axes=None)
    else:
        output = _ni_support._get_output(output, input)
        temp_needed = np.may_share_memory(input, output)
        if temp_needed:
            # input and output arrays cannot share memory
            temp = output
            output = _ni_support._get_output(output.dtype, input)
        if not isinstance(mode, str) and isinstance(mode, Iterable):
            raise RuntimeError(
                "A sequence of modes is not supported by non-separable rank "
                "filters")
        mode = _ni_support._extend_mode_to_code(mode, is_filter=True)
        if input.ndim == 1:
            if input.dtype in (np.int64, np.float64, np.float32):
                x = input
                x_out = output
            elif input.dtype == np.float16:
                x = input.astype('float32')
                x_out = np.empty(x.shape, dtype='float32')
            elif np.result_type(input, np.int64) == np.int64:
                x = input.astype('int64')
                x_out = np.empty(x.shape, dtype='int64')
            elif input.dtype.kind in 'biu':
                # cast any other boolean, integer or unsigned type to int64
                x = input.astype('int64')
                x_out = np.empty(x.shape, dtype='int64')
            else:
                raise RuntimeError('Unsupported array type')
            cval = x.dtype.type(cval)
            _rank_filter_1d.rank_filter(x, rank, footprint.size, x_out, mode, cval,
                                        origin)
            if input.dtype not in (np.int64, np.float64, np.float32):
                np.copyto(output, x_out, casting='unsafe')
        else:
            _nd_image.rank_filter(input, rank, footprint, output, mode, cval, origins)
        if temp_needed:
            temp[...] = output
            output = temp
        return output


@_ni_docstrings.docfiller
def rank_filter(input, rank, size=None, footprint=None, output=None,
                mode="reflect", cval=0.0, origin=0, *, axes=None):
    """Calculate a multidimensional rank filter.

    Parameters
    ----------
    %(input)s
    rank : int
        The rank parameter may be less than zero, i.e., rank = -1
        indicates the largest element.
    %(size_foot)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin_multiple)s
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `size`, `origin`, and/or `mode`
        must match the length of `axes`. The ith entry in any of these tuples
        corresponds to the ith entry in `axes`.

    Returns
    -------
    rank_filter : ndarray
        Filtered array. Has the same shape as `input`.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = ndimage.rank_filter(ascent, rank=42, size=20)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    rank = operator.index(rank)
    return _rank_filter(input, rank, size, footprint, output, mode, cval,
                        origin, 'rank', axes=axes)


@_ni_docstrings.docfiller
def median_filter(input, size=None, footprint=None, output=None,
                  mode="reflect", cval=0.0, origin=0, *, axes=None):
    """
    Calculate a multidimensional median filter.

    Parameters
    ----------
    %(input)s
    %(size_foot)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin_multiple)s
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `size`, `origin`, and/or `mode`
        must match the length of `axes`. The ith entry in any of these tuples
        corresponds to the ith entry in `axes`.

    Returns
    -------
    median_filter : ndarray
        Filtered array. Has the same shape as `input`.

    See Also
    --------
    scipy.signal.medfilt2d

    Notes
    -----
    For 2-dimensional images with ``uint8``, ``float32`` or ``float64`` dtypes
    the specialised function `scipy.signal.medfilt2d` may be faster. It is
    however limited to constant mode with ``cval=0``.

    The filter always returns the argument that would appear at index ``n // 2`` in
    a sorted array, where ``n`` is the number of elements in the footprint of the
    filter. Note that this differs from the conventional definition of the median
    when ``n`` is even. Also, this function does not support the ``float16`` dtype,
    behavior in the presence of NaNs is undefined, and memory consumption scales with
    ``n**4``. For ``float16`` support, greater control over the definition of the
    filter, and to limit memory usage, consider using `vectorized_filter` with
    NumPy functions `np.median` or `np.nanmedian`.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = ndimage.median_filter(ascent, size=20)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    return _rank_filter(input, 0, size, footprint, output, mode, cval,
                        origin, 'median', axes=axes)


@_ni_docstrings.docfiller
def percentile_filter(input, percentile, size=None, footprint=None,
                      output=None, mode="reflect", cval=0.0, origin=0, *,
                      axes=None):
    """Calculate a multidimensional percentile filter.

    Parameters
    ----------
    %(input)s
    percentile : scalar
        The percentile parameter may be less than zero, i.e.,
        percentile = -20 equals percentile = 80
    %(size_foot)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin_multiple)s
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `size`, `origin`, and/or `mode`
        must match the length of `axes`. The ith entry in any of these tuples
        corresponds to the ith entry in `axes`.

    Returns
    -------
    percentile_filter : ndarray
        Filtered array. Has the same shape as `input`.

    Examples
    --------
    >>> from scipy import ndimage, datasets
    >>> import matplotlib.pyplot as plt
    >>> fig = plt.figure()
    >>> plt.gray()  # show the filtered result in grayscale
    >>> ax1 = fig.add_subplot(121)  # left side
    >>> ax2 = fig.add_subplot(122)  # right side
    >>> ascent = datasets.ascent()
    >>> result = ndimage.percentile_filter(ascent, percentile=20, size=20)
    >>> ax1.imshow(ascent)
    >>> ax2.imshow(result)
    >>> plt.show()
    """
    return _rank_filter(input, percentile, size, footprint, output, mode,
                        cval, origin, 'percentile', axes=axes)


@_ni_docstrings.docfiller
def generic_filter1d(input, function, filter_size, axis=-1,
                     output=None, mode="reflect", cval=0.0, origin=0,
                     extra_arguments=(), extra_keywords=None):
    """Calculate a 1-D filter along the given axis.

    `generic_filter1d` iterates over the lines of the array, calling the
    given function at each line. The arguments of the line are the
    input line, and the output line. The input and output lines are 1-D
    double arrays. The input line is extended appropriately according
    to the filter size and origin. The output line must be modified
    in-place with the result.

    Parameters
    ----------
    %(input)s
    function : {callable, scipy.LowLevelCallable}
        Function to apply along given axis.
    filter_size : scalar
        Length of the filter.
    %(axis)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin)s
    %(extra_arguments)s
    %(extra_keywords)s

    Returns
    -------
    generic_filter1d : ndarray
        Filtered array. Has the same shape as `input`.

    Notes
    -----
    This function also accepts low-level callback functions with one of
    the following signatures and wrapped in `scipy.LowLevelCallable`:

    .. code:: c

       int function(double *input_line, npy_intp input_length,
                    double *output_line, npy_intp output_length,
                    void *user_data)
       int function(double *input_line, intptr_t input_length,
                    double *output_line, intptr_t output_length,
                    void *user_data)

    The calling function iterates over the lines of the input and output
    arrays, calling the callback function at each line. The current line
    is extended according to the border conditions set by the calling
    function, and the result is copied into the array that is passed
    through ``input_line``. The length of the input line (after extension)
    is passed through ``input_length``. The callback function should apply
    the filter and store the result in the array passed through
    ``output_line``. The length of the output line is passed through
    ``output_length``. ``user_data`` is the data pointer provided
    to `scipy.LowLevelCallable` as-is.

    The callback function must return an integer error status that is zero
    if something went wrong and one otherwise. If an error occurs, you should
    normally set the python error status with an informative message
    before returning, otherwise a default error message is set by the
    calling function.

    In addition, some other low-level function pointer specifications
    are accepted, but these are for backward compatibility only and should
    not be used in new code.

    """
    if extra_keywords is None:
        extra_keywords = {}
    input = np.asarray(input)
    if np.iscomplexobj(input):
        raise TypeError('Complex type not supported')
    output = _ni_support._get_output(output, input)
    if filter_size < 1:
        raise RuntimeError('invalid filter size')
    axis = normalize_axis_index(axis, input.ndim)
    if (filter_size // 2 + origin < 0) or (filter_size // 2 + origin >=
                                           filter_size):
        raise ValueError('invalid origin')
    mode = _ni_support._extend_mode_to_code(mode)
    _nd_image.generic_filter1d(input, function, filter_size, axis, output,
                               mode, cval, origin, extra_arguments,
                               extra_keywords)
    return output


@_ni_docstrings.docfiller
def generic_filter(input, function, size=None, footprint=None,
                   output=None, mode="reflect", cval=0.0, origin=0,
                   extra_arguments=(), extra_keywords=None, *, axes=None):
    """Calculate a multidimensional filter using the given function.

    At each element the provided function is called. The input values
    within the filter footprint at that element are passed to the function
    as a 1-D array of double values.

    Parameters
    ----------
    %(input)s
    function : {callable, scipy.LowLevelCallable}
        Function to apply at each element.
    %(size_foot)s
    %(output)s
    %(mode_reflect)s
    %(cval)s
    %(origin_multiple)s
    %(extra_arguments)s
    %(extra_keywords)s
    axes : tuple of int or None, optional
        If None, `input` is filtered along all axes. Otherwise,
        `input` is filtered along the specified axes. When `axes` is
        specified, any tuples used for `size` or `origin` must match the length
        of `axes`. The ith entry in any of these tuples corresponds to the ith
        entry in `axes`.

    Returns
    -------
    output : ndarray
        Filtered array. Has the same shape as `input`.

    See Also
    --------
    vectorized_filter : similar functionality, but optimized for vectorized callables

    Notes
    -----
    This function is ideal for use with instances of `scipy.LowLevelCallable`;
    for vectorized, pure-Python callables, consider `vectorized_filter` for improved
    performance.

    Low-level callback functions must have one of the following signatures:

    .. code:: c

       int callback(double *buffer, npy_intp filter_size,
                    double *return_value, void *user_data)
       int callback(double *buffer, intptr_t filter_size,
                    double *return_value, void *user_data)

    The calling function iterates over the elements of the input and
    output arrays, calling the callback function at each element. The
    elements within the footprint of the filter at the current element are
    passed through the ``buffer`` parameter, and the number of elements
    within the footprint through ``filter_size``. The calculated value is
    returned in ``return_value``. ``user_data`` is the data pointer provided
    to `scipy.LowLevelCallable` as-is.

    The callback function must return an integer error status that is zero
    if something went wrong and one otherwise. If an error occurs, you should
    normally set the python error status with an informative message
    before returning, otherwise a default error message is set by the
    calling function.

    In addition, some other low-level function pointer specifications
    are accepted, but these are for backward compatibility only and should
    not be used in new code.

    Examples
    --------
    Import the necessary modules and load the example image used for
    filtering.

    >>> import numpy as np
    >>> from scipy import datasets
    >>> from scipy.ndimage import zoom, generic_filter
    >>> import matplotlib.pyplot as plt
    >>> ascent = zoom(datasets.ascent(), 0.5)

    Compute a maximum filter with kernel size 5 by passing a simple NumPy
    aggregation function as argument to `function`.

    >>> maximum_filter_result = generic_filter(ascent, np.amax, [5, 5])

    While a maximum filter could also directly be obtained using
    `maximum_filter`, `generic_filter` allows generic Python function or
    `scipy.LowLevelCallable` to be used as a filter. Here, we compute the
    range between maximum and minimum value as an example for a kernel size
    of 5.

    >>> def custom_filter(image):
    ...     return np.amax(image) - np.amin(image)
    >>> custom_filter_result = generic_filter(ascent, custom_filter, [5, 5])

    Plot the original and filtered images.

    >>> fig, axes = plt.subplots(3, 1, figsize=(3, 9))
    >>> plt.gray()  # show the filtered result in grayscale
    >>> top, middle, bottom = axes
    >>> for ax in axes:
    ...     ax.set_axis_off()  # remove coordinate system
    >>> top.imshow(ascent)
    >>> top.set_title("Original image")
    >>> middle.imshow(maximum_filter_result)
    >>> middle.set_title("Maximum filter, Kernel: 5x5")
    >>> bottom.imshow(custom_filter_result)
    >>> bottom.set_title("Custom filter, Kernel: 5x5")
    >>> fig.tight_layout()

    """
    if (size is not None) and (footprint is not None):
        warnings.warn("ignoring size because footprint is set",
                      UserWarning, stacklevel=2)
    if extra_keywords is None:
        extra_keywords = {}
    input = np.asarray(input)
    if np.iscomplexobj(input):
        raise TypeError('Complex type not supported')
    axes = _ni_support._check_axes(axes, input.ndim)
    num_axes = len(axes)
    if footprint is None:
        if size is None:
            raise RuntimeError("no footprint or filter size provided")
        sizes = _ni_support._normalize_sequence(size, num_axes)
        footprint = np.ones(sizes, dtype=bool)
    else:
        footprint = np.asarray(footprint, dtype=bool)

    # expand origins, footprint if num_axes < input.ndim
    footprint = _expand_footprint(input.ndim, axes, footprint)
    origins = _expand_origin(input.ndim, axes, origin)

    fshape = [ii for ii in footprint.shape if ii > 0]
    if len(fshape) != input.ndim:
        raise RuntimeError(f"footprint.ndim ({footprint.ndim}) "
                           f"must match len(axes) ({num_axes})")
    for origin, lenf in zip(origins, fshape):
        if (lenf // 2 + origin < 0) or (lenf // 2 + origin >= lenf):
            raise ValueError('invalid origin')
    if not footprint.flags.contiguous:
        footprint = footprint.copy()
    output = _ni_support._get_output(output, input)

    mode = _ni_support._extend_mode_to_code(mode)
    _nd_image.generic_filter(input, function, footprint, output, mode,
                             cval, origins, extra_arguments, extra_keywords)
    return output
