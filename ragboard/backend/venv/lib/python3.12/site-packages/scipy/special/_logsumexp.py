import numpy as np
from scipy._lib._array_api import (
    array_namespace,
    xp_capabilities,
    xp_device,
    xp_size,
    xp_promote,
    xp_float_to_complex,
)
from scipy._lib import array_api_extra as xpx

__all__ = ["logsumexp", "softmax", "log_softmax"]


@xp_capabilities()
def logsumexp(a, axis=None, b=None, keepdims=False, return_sign=False):
    """Compute the log of the sum of exponentials of input elements.

    Parameters
    ----------
    a : array_like
        Input array.
    axis : None or int or tuple of ints, optional
        Axis or axes over which the sum is taken. By default `axis` is None,
        and all elements are summed.

        .. versionadded:: 0.11.0
    b : array-like, optional
        Scaling factor for exp(`a`) must be of the same shape as `a` or
        broadcastable to `a`. These values may be negative in order to
        implement subtraction.

        .. versionadded:: 0.12.0
    keepdims : bool, optional
        If this is set to True, the axes which are reduced are left in the
        result as dimensions with size one. With this option, the result
        will broadcast correctly against the original array.

        .. versionadded:: 0.15.0
    return_sign : bool, optional
        If this is set to True, the result will be a pair containing sign
        information; if False, results that are negative will be returned
        as NaN. Default is False (no sign information).

        .. versionadded:: 0.16.0

    Returns
    -------
    res : ndarray
        The result, ``np.log(np.sum(np.exp(a)))`` calculated in a numerically
        more stable way. If `b` is given then ``np.log(np.sum(b*np.exp(a)))``
        is returned. If ``return_sign`` is True, ``res`` contains the log of
        the absolute value of the argument.
    sgn : ndarray
        If ``return_sign`` is True, this will be an array of floating-point
        numbers matching res containing +1, 0, -1 (for real-valued inputs)
        or a complex phase (for complex inputs). This gives the sign of the
        argument of the logarithm in ``res``.
        If ``return_sign`` is False, only one result is returned.

    See Also
    --------
    :data:`numpy.logaddexp`
    :data:`numpy.logaddexp2`

    Notes
    -----
    NumPy has a logaddexp function which is very similar to `logsumexp`, but
    only handles two arguments. `logaddexp.reduce` is similar to this
    function, but may be less stable.

    The logarithm is a multivalued function: for each :math:`x` there is an
    infinite number of :math:`z` such that :math:`exp(z) = x`. The convention
    is to return the :math:`z` whose imaginary part lies in :math:`(-pi, pi]`.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.special import logsumexp
    >>> a = np.arange(10)
    >>> logsumexp(a)
    9.4586297444267107
    >>> np.log(np.sum(np.exp(a)))
    9.4586297444267107

    With weights

    >>> a = np.arange(10)
    >>> b = np.arange(10, 0, -1)
    >>> logsumexp(a, b=b)
    9.9170178533034665
    >>> np.log(np.sum(b*np.exp(a)))
    9.9170178533034647

    Returning a sign flag

    >>> logsumexp([1,2],b=[1,-1],return_sign=True)
    (1.5413248546129181, -1.0)

    Notice that `logsumexp` does not directly support masked arrays. To use it
    on a masked array, convert the mask into zero weights:

    >>> a = np.ma.array([np.log(2), 2, np.log(3)],
    ...                  mask=[False, True, False])
    >>> b = (~a.mask).astype(int)
    >>> logsumexp(a.data, b=b), np.log(5)
    1.6094379124341005, 1.6094379124341005

    """
    xp = array_namespace(a, b)
    a, b = xp_promote(a, b, broadcast=True, force_floating=True, xp=xp)
    a = xpx.atleast_nd(a, ndim=1, xp=xp)
    b = xpx.atleast_nd(b, ndim=1, xp=xp) if b is not None else b
    axis = tuple(range(a.ndim)) if axis is None else axis

    if xp_size(a) != 0:
        with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
            # Where result is infinite, we use the direct logsumexp calculation to
            # delegate edge case handling to the behavior of `xp.log` and `xp.exp`,
            # which should follow the C99 standard for complex values.
            b_exp_a = xp.exp(a) if b is None else b * xp.exp(a)
            sum_ = xp.sum(b_exp_a, axis=axis, keepdims=True)
            sgn_inf = _sign(sum_, xp=xp) if return_sign else None
            sum_ = xp.abs(sum_) if return_sign else sum_
            out_inf = xp.log(sum_)

        with np.errstate(divide='ignore', invalid='ignore'):  # log of zero is OK
            out, sgn = _logsumexp(a, b, axis=axis, return_sign=return_sign, xp=xp)

        # Replace infinite results. This probably could be done with an
        # `apply_where`-like strategy to avoid redundant calculation, but currently
        # `apply_where` itself is only for elementwise functions.
        out_finite = xp.isfinite(out)
        out = xp.where(out_finite, out, out_inf)
        sgn = xp.where(out_finite, sgn, sgn_inf) if return_sign else sgn
    else:
        shape = np.asarray(a.shape)  # NumPy is convenient for shape manipulation
        shape[axis] = 1
        out = xp.full(tuple(shape), -xp.inf, dtype=a.dtype, device=xp_device(a))
        sgn = xp.sign(out)

    if xp.isdtype(out.dtype, 'complex floating'):
        if return_sign:
            real = xp.real(sgn)
            imag = xp_float_to_complex(_wrap_radians(xp.imag(sgn), xp=xp), xp=xp)
            sgn = real + imag*1j
        else:
            real = xp.real(out)
            imag = xp_float_to_complex(_wrap_radians(xp.imag(out), xp=xp), xp=xp)
            out = real + imag*1j

    # Deal with shape details - reducing dimensions and convert 0-D to scalar for NumPy
    out = xp.squeeze(out, axis=axis) if not keepdims else out
    sgn = xp.squeeze(sgn, axis=axis) if (sgn is not None and not keepdims) else sgn
    out = out[()] if out.ndim == 0 else out
    sgn = sgn[()] if (sgn is not None and sgn.ndim == 0) else sgn

    return (out, sgn) if return_sign else out


def _wrap_radians(x, *, xp):
    # Wrap radians to (-pi, pi] interval
    wrapped = -((-x + xp.pi) % (2 * xp.pi) - xp.pi)
    # preserve relative precision
    no_wrap = xp.abs(x) < xp.pi
    return xp.where(no_wrap, x, wrapped)


def _elements_and_indices_with_max_real(a, *, axis=-1, xp):
    # This is an array-API compatible `max` function that works something
    # like `np.max` for complex input. The important part is that it finds
    # the element with maximum real part. When there are multiple complex values
    # with this real part, it doesn't matter which we choose.
    # We could use `argmax` on real component, but array API doesn't yet have
    # `take_along_axis`, and even if it did, we would have problems with axis tuples.
    # Feel free to rewrite! It's ugly, but it's not the purpose of the PR, and
    # it gets the job done.

    if xp.isdtype(a.dtype, "complex floating"):
        # select all elements with max real part.
        real_a = xp.real(a)
        max_ = xp.max(real_a, axis=axis, keepdims=True)
        mask = real_a == max_

        # Of those, choose one arbitrarily. This is a reasonably
        # simple, array-API compatible way of doing so that doesn't
        # have a problem with `axis` being a tuple or None.
        i = xp.reshape(xp.arange(xp_size(a), device=xp_device(a)), a.shape)
        i = xpx.at(i, ~mask).set(-1)
        max_i = xp.max(i, axis=axis, keepdims=True)
        mask = i == max_i
        a = xp.where(mask, a, 0.)
        max_ = xp.sum(a, axis=axis, dtype=a.dtype, keepdims=True)
    else:
        max_ = xp.max(a, axis=axis, keepdims=True)
        mask = a == max_

    return max_, mask


def _sign(x, *, xp):
    return x / xp.where(x == 0, 1., xp.abs(x))


def _logsumexp(a, b, *, axis, return_sign, xp):
    # This has been around for about a decade, so let's consider it a feature:
    # Even if element of `a` is infinite or NaN, it adds nothing to the sum if
    # the corresponding weight is zero.
    if b is not None:
        a = xpx.at(a, b == 0).set(-xp.inf, copy=True)

    # Find element with maximum real part, since this is what affects the magnitude
    # of the exponential. Possible enhancement: include log of `b` magnitude in `a`.
    a_max, i_max = _elements_and_indices_with_max_real(a, axis=axis, xp=xp)

    # for precision, these terms are separated out of the main sum.
    a = xpx.at(a, i_max).set(-xp.inf, copy=True if b is None else None)
    i_max_dt = xp.astype(i_max, a.dtype)
    # This is an inefficient way of getting `m` because it is the sum of a sparse
    # array; however, this is the simplest way I can think of to get the right shape.
    b_i_max = i_max_dt if b is None else b * i_max_dt
    m = xp.sum(b_i_max, axis=axis, keepdims=True, dtype=a.dtype)

    # Shift, exponentiate, scale, and sum
    exp = b * xp.exp(a - a_max) if b is not None else xp.exp(a - a_max)
    s = xp.sum(exp, axis=axis, keepdims=True, dtype=exp.dtype)
    s = xp.where(s == 0, s, s/m)

    # Separate sign/magnitude information
    # Originally, this was only performed if `return_sign=True`.
    # However, this is also needed if any elements of `m < 0` or `s < -1`.
    # An improvement would be to perform the calculations only on these entries.

    # Use the numpy>=2.0 convention for sign.
    # When all array libraries agree, this can become sng = xp.sign(s).
    sgn = _sign(s + 1, xp=xp) * _sign(m, xp=xp)

    if xp.isdtype(s.dtype, "real floating"):
        # The log functions need positive arguments
        s = xp.where(s < -1, -s - 2, s)
        m = xp.abs(m)
    else:
        # `a_max` can have a sign component for complex input
        sgn = sgn * xp.exp(xp.imag(a_max) * 1.0j)

    # Take log and undo shift
    out = xp.log1p(s) + xp.log(m) + a_max

    if return_sign:
        out = xp.real(out)
    elif xp.isdtype(out.dtype, 'real floating'):
        out = xpx.at(out)[sgn < 0].set(xp.nan)

    return out, sgn


@xp_capabilities()
def softmax(x, axis=None):
    r"""Compute the softmax function.

    The softmax function transforms each element of a collection by
    computing the exponential of each element divided by the sum of the
    exponentials of all the elements. That is, if `x` is a one-dimensional
    numpy array::

        softmax(x) = np.exp(x)/sum(np.exp(x))

    Parameters
    ----------
    x : array_like
        Input array.
    axis : int or tuple of ints, optional
        Axis to compute values along. Default is None and softmax will be
        computed over the entire array `x`.

    Returns
    -------
    s : ndarray
        An array the same shape as `x`. The result will sum to 1 along the
        specified axis.

    Notes
    -----
    The formula for the softmax function :math:`\sigma(x)` for a vector
    :math:`x = \{x_0, x_1, ..., x_{n-1}\}` is

    .. math:: \sigma(x)_j = \frac{e^{x_j}}{\sum_k e^{x_k}}

    The `softmax` function is the gradient of `logsumexp`.

    The implementation uses shifting to avoid overflow. See [1]_ for more
    details.

    .. versionadded:: 1.2.0

    References
    ----------
    .. [1] P. Blanchard, D.J. Higham, N.J. Higham, "Accurately computing the
       log-sum-exp and softmax functions", IMA Journal of Numerical Analysis,
       Vol.41(4), :doi:`10.1093/imanum/draa038`.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.special import softmax
    >>> np.set_printoptions(precision=5)

    >>> x = np.array([[1, 0.5, 0.2, 3],
    ...               [1,  -1,   7, 3],
    ...               [2,  12,  13, 3]])
    ...

    Compute the softmax transformation over the entire array.

    >>> m = softmax(x)
    >>> m
    array([[  4.48309e-06,   2.71913e-06,   2.01438e-06,   3.31258e-05],
           [  4.48309e-06,   6.06720e-07,   1.80861e-03,   3.31258e-05],
           [  1.21863e-05,   2.68421e-01,   7.29644e-01,   3.31258e-05]])

    >>> m.sum()
    1.0

    Compute the softmax transformation along the first axis (i.e., the
    columns).

    >>> m = softmax(x, axis=0)

    >>> m
    array([[  2.11942e-01,   1.01300e-05,   2.75394e-06,   3.33333e-01],
           [  2.11942e-01,   2.26030e-06,   2.47262e-03,   3.33333e-01],
           [  5.76117e-01,   9.99988e-01,   9.97525e-01,   3.33333e-01]])

    >>> m.sum(axis=0)
    array([ 1.,  1.,  1.,  1.])

    Compute the softmax transformation along the second axis (i.e., the rows).

    >>> m = softmax(x, axis=1)
    >>> m
    array([[  1.05877e-01,   6.42177e-02,   4.75736e-02,   7.82332e-01],
           [  2.42746e-03,   3.28521e-04,   9.79307e-01,   1.79366e-02],
           [  1.22094e-05,   2.68929e-01,   7.31025e-01,   3.31885e-05]])

    >>> m.sum(axis=1)
    array([ 1.,  1.,  1.])

    """
    xp = array_namespace(x)
    x = xp.asarray(x)
    x_max = xp.max(x, axis=axis, keepdims=True)
    exp_x_shifted = xp.exp(x - x_max)
    return exp_x_shifted / xp.sum(exp_x_shifted, axis=axis, keepdims=True)


@xp_capabilities()
def log_softmax(x, axis=None):
    r"""Compute the logarithm of the softmax function.

    In principle::

        log_softmax(x) = log(softmax(x))

    but using a more accurate implementation.

    Parameters
    ----------
    x : array_like
        Input array.
    axis : int or tuple of ints, optional
        Axis to compute values along. Default is None and softmax will be
        computed over the entire array `x`.

    Returns
    -------
    s : ndarray or scalar
        An array with the same shape as `x`. Exponential of the result will
        sum to 1 along the specified axis. If `x` is a scalar, a scalar is
        returned.

    Notes
    -----
    `log_softmax` is more accurate than ``np.log(softmax(x))`` with inputs that
    make `softmax` saturate (see examples below).

    .. versionadded:: 1.5.0

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.special import log_softmax
    >>> from scipy.special import softmax
    >>> np.set_printoptions(precision=5)

    >>> x = np.array([1000.0, 1.0])

    >>> y = log_softmax(x)
    >>> y
    array([   0., -999.])

    >>> with np.errstate(divide='ignore'):
    ...   y = np.log(softmax(x))
    ...
    >>> y
    array([  0., -inf])

    """
    xp = array_namespace(x)
    x = xp.asarray(x)

    x_max = xp.max(x, axis=axis, keepdims=True)

    if x_max.ndim > 0:
        x_max = xpx.at(x_max, ~xp.isfinite(x_max)).set(0)
    elif not xp.isfinite(x_max):
        x_max = 0

    tmp = x - x_max
    exp_tmp = xp.exp(tmp)

    # suppress warnings about log of zero
    with np.errstate(divide='ignore'):
        s = xp.sum(exp_tmp, axis=axis, keepdims=True)
        out = xp.log(s)

    return tmp - out
