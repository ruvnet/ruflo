import numpy as np
from scipy.special import betainc
from scipy._lib._array_api import xp_ravel, array_namespace, xp_promote
import scipy._lib.array_api_extra as xpx
from scipy.stats._axis_nan_policy import _broadcast_arrays, _contains_nan
from scipy.stats._stats_py import _length_nonmasked


def _quantile_iv(x, p, method, axis, nan_policy, keepdims):
    xp = array_namespace(x, p)

    if not xp.isdtype(xp.asarray(x).dtype, ('integral', 'real floating')):
        raise ValueError("`x` must have real dtype.")

    if not xp.isdtype(xp.asarray(p).dtype, 'real floating'):
        raise ValueError("`p` must have real floating dtype.")

    x, p = xp_promote(x, p, force_floating=True, xp=xp)
    dtype = x.dtype

    axis_none = axis is None
    ndim = max(x.ndim, p.ndim)
    if axis_none:
        x = xp_ravel(x)
        p = xp_ravel(p)
        axis = 0
    elif np.iterable(axis) or int(axis) != axis:
        message = "`axis` must be an integer or None."
        raise ValueError(message)
    elif (axis >= ndim) or (axis < -ndim):
        message = "`axis` is not compatible with the shapes of the inputs."
        raise ValueError(message)
    axis = int(axis)

    methods = {'inverted_cdf', 'averaged_inverted_cdf', 'closest_observation',
               'hazen', 'interpolated_inverted_cdf', 'linear',
               'median_unbiased', 'normal_unbiased', 'weibull',
               'harrell-davis'}
    if method not in methods:
        message = f"`method` must be one of {methods}"
        raise ValueError(message)

    contains_nans = _contains_nan(x, nan_policy, xp_omit_okay=True, xp=xp)

    if keepdims not in {None, True, False}:
        message = "If specified, `keepdims` must be True or False."
        raise ValueError(message)

    # If data has length zero along `axis`, the result will be an array of NaNs just
    # as if the data had length 1 along axis and were filled with NaNs. This is treated
    # naturally below whether `nan_policy` is `'propagate'` or `'omit'`.
    if x.shape[axis] == 0:
        shape = list(x.shape)
        shape[axis] = 1
        x = xp.full(shape, xp.asarray(xp.nan, dtype=dtype))

    y = xp.sort(x, axis=axis)
    y, p = _broadcast_arrays((y, p), axis=axis)

    if (keepdims is False) and (p.shape[axis] != 1):
        message = "`keepdims` may be False only if the length of `p` along `axis` is 1."
        raise ValueError(message)
    keepdims = (p.shape[axis] != 1) if keepdims is None else keepdims

    y = xp.moveaxis(y, axis, -1)
    p = xp.moveaxis(p, axis, -1)

    n = _length_nonmasked(y, -1, xp=xp, keepdims=True)
    n = xp.asarray(n, dtype=dtype)
    if contains_nans:
        nans = xp.isnan(y)

        # Note that if length along `axis` were 0 to begin with,
        # it is now length 1 and filled with NaNs.
        if nan_policy == 'propagate':
            nan_out = xp.any(nans, axis=-1)
        else:  # 'omit'
            non_nan = xp.astype(~nans, xp.uint64)
            n_int = xp.sum(non_nan, axis=-1, keepdims=True)
            n = xp.astype(n_int, dtype)
            # NaNs are produced only if slice is empty after removing NaNs
            nan_out = xp.any(n == 0, axis=-1)
            n = xpx.at(n, nan_out).set(y.shape[-1])  # avoids pytorch/pytorch#146211

        if xp.any(nan_out):
            y = xp.asarray(y, copy=True)  # ensure writable
            y = xpx.at(y, nan_out).set(xp.nan)
        elif xp.any(nans) and method == 'harrell-davis':
            y = xp.asarray(y, copy=True)  # ensure writable
            y = xpx.at(y, nans).set(0)  # any non-nan will prevent NaN from propagating

    p_mask = (p > 1) | (p < 0) | xp.isnan(p)
    if xp.any(p_mask):
        p = xp.asarray(p, copy=True)
        p = xpx.at(p, p_mask).set(0.5)  # these get NaN-ed out at the end

    return y, p, method, axis, nan_policy, keepdims, n, axis_none, ndim, p_mask, xp


def quantile(x, p, *, method='linear', axis=0, nan_policy='propagate', keepdims=None):
    """
    Compute the p-th quantile of the data along the specified axis.

    Parameters
    ----------
    x : array_like of real numbers
        Data array.
    p : array_like of float
        Probability or sequence of probabilities of the quantiles to compute.
        Values must be between 0 and 1 (inclusive).
        Must have length 1 along `axis` unless ``keepdims=True``.
    method : str, default: 'linear'
        The method to use for estimating the quantile.
        The available options, numbered as they appear in [1]_, are:

        1. 'inverted_cdf'
        2. 'averaged_inverted_cdf'
        3. 'closest_observation'
        4. 'interpolated_inverted_cdf'
        5. 'hazen'
        6. 'weibull'
        7. 'linear'  (default)
        8. 'median_unbiased'
        9. 'normal_unbiased'

        'harrell-davis' is also available to compute the quantile estimate
        according to [2]_.
        See Notes for details.
    axis : int or None, default: 0
        Axis along which the quantiles are computed.
        ``None`` ravels both `x` and `p` before performing the calculation,
        without checking whether the original shapes were compatible.
    nan_policy : str, default: 'propagate'
        Defines how to handle NaNs in the input data `x`.

        - ``propagate``: if a NaN is present in the axis slice (e.g. row) along
          which the  statistic is computed, the corresponding slice of the output
          will contain NaN(s).
        - ``omit``: NaNs will be omitted when performing the calculation.
          If insufficient data remains in the axis slice along which the
          statistic is computed, the corresponding slice of the output will
          contain NaN(s).
        - ``raise``: if a NaN is present, a ``ValueError`` will be raised.

        If NaNs are present in `p`, a ``ValueError`` will be raised.
    keepdims : bool, optional
        Consider the case in which `x` is 1-D and `p` is a scalar: the quantile
        is a reducing statistic, and the default behavior is to return a scalar.
        If `keepdims` is set to True, the axis will not be reduced away, and the
        result will be a 1-D array with one element.

        The general case is more subtle, since multiple quantiles may be
        requested for each axis-slice of `x`. For instance, if both `x` and `p`
        are 1-D and ``p.size > 1``, no axis can be reduced away; there must be an
        axis to contain the number of quantiles given by ``p.size``. Therefore:

        - By default, the axis will be reduced away if possible (i.e. if there is
          exactly one element of `q` per axis-slice of `x`).
        - If `keepdims` is set to True, the axis will not be reduced away.
        - If `keepdims` is set to False, the axis will be reduced away
          if possible, and an error will be raised otherwise.

    Returns
    -------
    quantile : scalar or ndarray
        The resulting quantile(s). The dtype is the result dtype of `x` and `p`.

    Notes
    -----
    Given a sample `x` from an underlying distribution, `quantile` provides a
    nonparametric estimate of the inverse cumulative distribution function.

    By default, this is done by interpolating between adjacent elements in
    ``y``, a sorted copy of `x`::

        (1-g)*y[j] + g*y[j+1]

    where the index ``j`` and coefficient ``g`` are the integral and
    fractional components of ``p * (n-1)``, and ``n`` is the number of
    elements in the sample.

    This is a special case of Equation 1 of H&F [1]_. More generally,

    - ``j = (p*n + m - 1) // 1``, and
    - ``g = (p*n + m - 1) % 1``,

    where ``m`` may be defined according to several different conventions.
    The preferred convention may be selected using the ``method`` parameter:

    =============================== =============== ===============
    ``method``                      number in H&F   ``m``
    =============================== =============== ===============
    ``interpolated_inverted_cdf``   4               ``0``
    ``hazen``                       5               ``1/2``
    ``weibull``                     6               ``p``
    ``linear`` (default)            7               ``1 - p``
    ``median_unbiased``             8               ``p/3 + 1/3``
    ``normal_unbiased``             9               ``p/4 + 3/8``
    =============================== =============== ===============

    Note that indices ``j`` and ``j + 1`` are clipped to the range ``0`` to
    ``n - 1`` when the results of the formula would be outside the allowed
    range of non-negative indices. When ``j`` is clipped to zero, ``g`` is
    set to zero as well. The ``-1`` in the formulas for ``j`` and ``g``
    accounts for Python's 0-based indexing.

    The table above includes only the estimators from [1]_ that are continuous
    functions of probability `p` (estimators 4-9). SciPy also provides the
    three discontinuous estimators from [1]_ (estimators 1-3), where ``j`` is
    defined as above, ``m`` is defined as follows, and ``g`` is ``0`` when
    ``index = p*n + m - 1`` is less than ``0`` and otherwise is defined below.

    1. ``inverted_cdf``: ``m = 0`` and ``g = int(index - j > 0)``
    2. ``averaged_inverted_cdf``: ``m = 0`` and
       ``g = (1 + int(index - j > 0)) / 2``
    3. ``closest_observation``: ``m = -1/2`` and
       ``g = 1 - int((index == j) & (j%2 == 1))``

    A different strategy for computing quantiles from [2]_, ``method='harrell-davis'``,
    uses a weighted combination of all elements. The weights are computed as:

    .. math::

        w_{n, i} = I_{i/n}(a, b) - I_{(i - 1)/n}(a, b)

    where :math:`n` is the number of elements in the sample,
    :math:`i` are the indices :math:`1, 2, ..., n-1, n` of the sorted elements,
    :math:`a = p (n + 1)`, :math:`b = (1 - p)(n + 1)`,
    :math:`p` is the probability of the quantile, and
    :math:`I` is the regularized, lower incomplete beta function
    (`scipy.special.betainc`).

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = np.asarray([[10, 8, 7, 5, 4],
    ...                 [0, 1, 2, 3, 5]])

    Take the median along the last axis.

    >>> stats.quantile(x, 0.5, axis=-1)
    array([7.,  2.])

    Take a different quantile along each axis.

    >>> stats.quantile(x, [[0.25], [0.75]], axis=-1, keepdims=True)
    array([[5.],
           [3.]])

    Take multiple quantiles along each axis.

    >>> stats.quantile(x, [0.25, 0.75], axis=-1)
    array([[5., 8.],
           [1., 3.]])

    References
    ----------
    .. [1] R. J. Hyndman and Y. Fan,
       "Sample quantiles in statistical packages,"
       The American Statistician, 50(4), pp. 361-365, 1996
    .. [2] Harrell, Frank E., and C. E. Davis.
       "A new distribution-free quantile estimator."
       Biometrika 69.3 (1982): 635-640.

    """
    # Input validation / standardization

    temp = _quantile_iv(x, p, method, axis, nan_policy, keepdims)
    y, p, method, axis, nan_policy, keepdims, n, axis_none, ndim, p_mask, xp = temp

    if method in {'inverted_cdf', 'averaged_inverted_cdf', 'closest_observation',
                  'hazen', 'interpolated_inverted_cdf', 'linear',
                  'median_unbiased', 'normal_unbiased', 'weibull'}:
        res = _quantile_hf(y, p, n, method, xp)
    elif method in {'harrell-davis'}:
        res = _quantile_hd(y, p, n, xp)

    res = xpx.at(res, p_mask).set(xp.nan)

    # Reshape per axis/keepdims
    if axis_none and keepdims:
        shape = (1,)*(ndim - 1) + res.shape
        res = xp.reshape(res, shape)
        axis = -1

    res = xp.moveaxis(res, -1, axis)

    if not keepdims:
        res = xp.squeeze(res, axis=axis)

    return res[()] if res.ndim == 0 else res


def _quantile_hf(y, p, n, method, xp):
    ms = dict(inverted_cdf=0, averaged_inverted_cdf=0, closest_observation=-0.5,
              interpolated_inverted_cdf=0, hazen=0.5, weibull=p, linear=1 - p,
              median_unbiased=p/3 + 1/3, normal_unbiased=p/4 + 3/8)
    m = ms[method]
    jg = p*n + m - 1
    j = jg // 1
    g = jg % 1
    if method == 'inverted_cdf':
        g = xp.astype((g > 0), jg.dtype)
    elif method == 'averaged_inverted_cdf':
        g = (1 + xp.astype((g > 0), jg.dtype)) / 2
    elif method == 'closest_observation':
        g = (1 - xp.astype((g == 0) & (j % 2 == 1), jg.dtype))
    if method in {'inverted_cdf', 'averaged_inverted_cdf', 'closest_observation'}:
        g = xp.asarray(g)
        g = xpx.at(g, jg < 0).set(0)

    g[j < 0] = 0
    j = xp.clip(j, 0., n - 1)
    jp1 = xp.clip(j + 1, 0., n - 1)

    return ((1 - g) * xp.take_along_axis(y, xp.astype(j, xp.int64), axis=-1)
            + g * xp.take_along_axis(y, xp.astype(jp1, xp.int64), axis=-1))


def _quantile_hd(y, p, n, xp):
    # RE axis handling: We need to perform a reducing operation over rows of `y` for
    # each element in the corresponding row of `p` (a la Cartesian product). Strategy:
    # move rows of `p` to an axis at the front that is orthogonal to all the rest,
    # perform the reducing operating over the last axis, then move the front axis back
    # to the end.
    p = xp.moveaxis(p, -1, 0)[..., xp.newaxis]
    a = p * (n + 1)
    b = (1 - p) * (n + 1)
    i = xp.arange(y.shape[-1] + 1, dtype=y.dtype)
    w = betainc(a, b, i / n)
    w = w[..., 1:] - w[..., :-1]
    w = xpx.at(w, xp.isnan(w)).set(0)
    res = xp.vecdot(w, y, axis=-1)
    return xp.moveaxis(res, 0, -1)
