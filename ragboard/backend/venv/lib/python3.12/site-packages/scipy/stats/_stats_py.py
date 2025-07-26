# Copyright 2002 Gary Strangman.  All rights reserved
# Copyright 2002-2016 The SciPy Developers
#
# The original code from Gary Strangman was heavily adapted for
# use in SciPy by Travis Oliphant.  The original code came with the
# following disclaimer:
#
# This software is provided "as-is".  There are no expressed or implied
# warranties of any kind, including, but not limited to, the warranties
# of merchantability and fitness for a given application.  In no event
# shall Gary Strangman be liable for any direct, indirect, incidental,
# special, exemplary or consequential damages (including, but not limited
# to, loss of use, data or profits, or business interruption) however
# caused and on any theory of liability, whether in contract, strict
# liability or tort (including negligence or otherwise) arising in any way
# out of the use of this software, even if advised of the possibility of
# such damage.

"""
A collection of basic statistical functions for Python.

References
----------
.. [CRCProbStat2000] Zwillinger, D. and Kokoska, S. (2000). CRC Standard
   Probability and Statistics Tables and Formulae. Chapman & Hall: New
   York. 2000.

"""
import functools
import math
import operator
import warnings
from collections import namedtuple
from collections.abc import Sequence

import numpy as np
from numpy import array, asarray, ma

from scipy import sparse
from scipy.spatial import distance_matrix

from scipy.optimize import milp, LinearConstraint
from scipy._lib._util import (check_random_state, _get_nan,
                              _rename_parameter, _contains_nan,
                              normalize_axis_index, np_vecdot, AxisError)
from scipy._lib.deprecation import _deprecate_positional_args, _deprecated

import scipy.special as special
# Import unused here but needs to stay until end of deprecation periode
# See https://github.com/scipy/scipy/issues/15765#issuecomment-1875564522
from scipy import linalg  # noqa: F401
from . import distributions
from . import _mstats_basic as mstats_basic

from ._stats_mstats_common import _find_repeats, theilslopes, siegelslopes
from ._stats import _kendall_dis, _toint64, _weightedrankedtau

from dataclasses import dataclass, field
from ._hypotests import _all_partitions
from ._stats_pythran import _compute_outer_prob_inside_method
from ._resampling import (MonteCarloMethod, PermutationMethod, BootstrapMethod,
                          monte_carlo_test, permutation_test, bootstrap,
                          _batch_generator)
from ._axis_nan_policy import (_axis_nan_policy_factory,
                               _broadcast_concatenate, _broadcast_shapes,
                               _broadcast_array_shapes_remove_axis, SmallSampleWarning,
                               too_small_1d_not_omit, too_small_1d_omit,
                               too_small_nd_not_omit, too_small_nd_omit)
from ._binomtest import _binary_search_for_binom_tst as _binary_search
from scipy._lib._bunch import _make_tuple_bunch
from scipy import stats
from scipy.optimize import root_scalar
from scipy._lib._array_api import (
    _asarray,
    array_namespace,
    is_lazy_array,
    is_numpy,
    is_marray,
    is_cupy,
    xp_size,
    xp_vector_norm,
    xp_promote,
    xp_capabilities,
    xp_ravel,
    xp_swapaxes,
    xp_default_dtype,
)
import scipy._lib.array_api_extra as xpx



# Functions/classes in other files should be added in `__init__.py`, not here
__all__ = ['find_repeats', 'gmean', 'hmean', 'pmean', 'mode', 'tmean', 'tvar',
           'tmin', 'tmax', 'tstd', 'tsem', 'moment',
           'skew', 'kurtosis', 'describe', 'skewtest', 'kurtosistest',
           'normaltest', 'jarque_bera',
           'scoreatpercentile', 'percentileofscore',
           'cumfreq', 'relfreq', 'obrientransform',
           'sem', 'zmap', 'zscore', 'gzscore', 'iqr', 'gstd',
           'median_abs_deviation',
           'sigmaclip', 'trimboth', 'trim1', 'trim_mean',
           'f_oneway', 'pearsonr', 'fisher_exact',
           'spearmanr', 'pointbiserialr',
           'kendalltau', 'weightedtau',
           'linregress', 'siegelslopes', 'theilslopes', 'ttest_1samp',
           'ttest_ind', 'ttest_ind_from_stats', 'ttest_rel',
           'kstest', 'ks_1samp', 'ks_2samp',
           'chisquare', 'power_divergence',
           'tiecorrect', 'ranksums', 'kruskal', 'friedmanchisquare',
           'rankdata', 'combine_pvalues', 'quantile_test',
           'wasserstein_distance', 'wasserstein_distance_nd', 'energy_distance',
           'brunnermunzel', 'alexandergovern',
           'expectile', 'lmoment']


def _chk_asarray(a, axis, *, xp=None):
    if xp is None:
        xp = array_namespace(a)

    if axis is None:
        a = xp.reshape(a, (-1,))
        outaxis = 0
    else:
        a = xp.asarray(a)
        outaxis = axis

    if a.ndim == 0:
        a = xp.reshape(a, (-1,))

    return a, outaxis


def _chk2_asarray(a, b, axis):
    if axis is None:
        a = np.ravel(a)
        b = np.ravel(b)
        outaxis = 0
    else:
        a = np.asarray(a)
        b = np.asarray(b)
        outaxis = axis

    if a.ndim == 0:
        a = np.atleast_1d(a)
    if b.ndim == 0:
        b = np.atleast_1d(b)

    return a, b, outaxis


SignificanceResult = _make_tuple_bunch('SignificanceResult',
                                       ['statistic', 'pvalue'], [])
# Let's call a SignificanceResult with legacy :correlation" attribute a
# "CorrelationResult". Don't add to `extra_field_names`- shouldn't be in repr.


def _pack_CorrelationResult(statistic, pvalue, correlation):
    res = SignificanceResult(statistic, pvalue)
    res.correlation = correlation
    return res


def _unpack_CorrelationResult(res, _):
    return res.statistic, res.pvalue, res.correlation


# note that `weights` are paired with `x`
@xp_capabilities()
@_axis_nan_policy_factory(
        lambda x: x, n_samples=1, n_outputs=1, too_small=0, paired=True,
        result_to_tuple=lambda x, _: (x,), kwd_samples=['weights'])
def gmean(a, axis=0, dtype=None, weights=None):
    r"""Compute the weighted geometric mean along the specified axis.

    The weighted geometric mean of the array :math:`a_i` associated to weights
    :math:`w_i` is:

    .. math::

        \exp \left( \frac{ \sum_{i=1}^n w_i \ln a_i }{ \sum_{i=1}^n w_i }
                   \right) \, ,

    and, with equal weights, it gives:

    .. math::

        \sqrt[n]{ \prod_{i=1}^n a_i } \, .

    Parameters
    ----------
    a : array_like
        Input array or object that can be converted to an array.
    axis : int or None, optional
        Axis along which the geometric mean is computed. Default is 0.
        If None, compute over the whole array `a`.
    dtype : dtype, optional
        Type to which the input arrays are cast before the calculation is
        performed.
    weights : array_like, optional
        The `weights` array must be broadcastable to the same shape as `a`.
        Default is None, which gives each value a weight of 1.0.

    Returns
    -------
    gmean : ndarray
        See `dtype` parameter above.

    See Also
    --------
    numpy.mean : Arithmetic average
    numpy.average : Weighted average
    hmean : Harmonic mean

    Notes
    -----
    The sample geometric mean is the exponential of the mean of the natural
    logarithms of the observations.
    Negative observations will produce NaNs in the output because the *natural*
    logarithm (as opposed to the *complex* logarithm) is defined only for
    non-negative reals.

    References
    ----------
    .. [1] "Weighted Geometric Mean", *Wikipedia*,
           https://en.wikipedia.org/wiki/Weighted_geometric_mean.
    .. [2] Grossman, J., Grossman, M., Katz, R., "Averages: A New Approach",
           Archimedes Foundation, 1983

    Examples
    --------
    >>> from scipy.stats import gmean
    >>> gmean([1, 4])
    2.0
    >>> gmean([1, 2, 3, 4, 5, 6, 7])
    3.3800151591412964
    >>> gmean([1, 4, 7], weights=[3, 1, 3])
    2.80668351922014

    """
    xp = array_namespace(a, weights)
    a = xp.asarray(a, dtype=dtype)

    if weights is not None:
        weights = xp.asarray(weights, dtype=dtype)

    with np.errstate(divide='ignore'):
        log_a = xp.log(a)

    return xp.exp(_xp_mean(log_a, axis=axis, weights=weights))


@xp_capabilities(jax_jit=False, allow_dask_compute=1)
@_axis_nan_policy_factory(
        lambda x: x, n_samples=1, n_outputs=1, too_small=0, paired=True,
        result_to_tuple=lambda x, _: (x,), kwd_samples=['weights'])
def hmean(a, axis=0, dtype=None, *, weights=None):
    r"""Calculate the weighted harmonic mean along the specified axis.

    The weighted harmonic mean of the array :math:`a_i` associated to weights
    :math:`w_i` is:

    .. math::

        \frac{ \sum_{i=1}^n w_i }{ \sum_{i=1}^n \frac{w_i}{a_i} } \, ,

    and, with equal weights, it gives:

    .. math::

        \frac{ n }{ \sum_{i=1}^n \frac{1}{a_i} } \, .

    Parameters
    ----------
    a : array_like
        Input array, masked array or object that can be converted to an array.
    axis : int or None, optional
        Axis along which the harmonic mean is computed. Default is 0.
        If None, compute over the whole array `a`.
    dtype : dtype, optional
        Type of the returned array and of the accumulator in which the
        elements are summed. If `dtype` is not specified, it defaults to the
        dtype of `a`, unless `a` has an integer `dtype` with a precision less
        than that of the default platform integer. In that case, the default
        platform integer is used.
    weights : array_like, optional
        The weights array can either be 1-D (in which case its length must be
        the size of `a` along the given `axis`) or of the same shape as `a`.
        Default is None, which gives each value a weight of 1.0.

        .. versionadded:: 1.9

    Returns
    -------
    hmean : ndarray
        See `dtype` parameter above.

    See Also
    --------
    numpy.mean : Arithmetic average
    numpy.average : Weighted average
    gmean : Geometric mean

    Notes
    -----
    The sample harmonic mean is the reciprocal of the mean of the reciprocals
    of the observations.

    The harmonic mean is computed over a single dimension of the input
    array, axis=0 by default, or all values in the array if axis=None.
    float64 intermediate and return values are used for integer inputs.

    The harmonic mean is only defined if all observations are non-negative;
    otherwise, the result is NaN.

    References
    ----------
    .. [1] "Weighted Harmonic Mean", *Wikipedia*,
           https://en.wikipedia.org/wiki/Harmonic_mean#Weighted_harmonic_mean
    .. [2] Ferger, F., "The nature and use of the harmonic mean", Journal of
           the American Statistical Association, vol. 26, pp. 36-40, 1931

    Examples
    --------
    >>> from scipy.stats import hmean
    >>> hmean([1, 4])
    1.6000000000000001
    >>> hmean([1, 2, 3, 4, 5, 6, 7])
    2.6997245179063363
    >>> hmean([1, 4, 7], weights=[3, 1, 3])
    1.9029126213592233

    """
    xp = array_namespace(a, weights)
    a = xp.asarray(a, dtype=dtype)

    if weights is not None:
        weights = xp.asarray(weights, dtype=dtype)

    negative_mask = a < 0
    if xp.any(negative_mask):
        # `where` avoids having to be careful about dtypes and will work with
        # JAX. This is the exceptional case, so it's OK to be a little slower.
        # Won't work for array_api_strict for now, but see data-apis/array-api#807
        a = xp.where(negative_mask, xp.nan, a)
        message = ("The harmonic mean is only defined if all elements are "
                   "non-negative; otherwise, the result is NaN.")
        warnings.warn(message, RuntimeWarning, stacklevel=2)

    with np.errstate(divide='ignore'):
        return 1.0 / _xp_mean(1.0 / a, axis=axis, weights=weights)


@xp_capabilities(jax_jit=False, allow_dask_compute=1)
@_axis_nan_policy_factory(
        lambda x: x, n_samples=1, n_outputs=1, too_small=0, paired=True,
        result_to_tuple=lambda x, _: (x,), kwd_samples=['weights'])
def pmean(a, p, *, axis=0, dtype=None, weights=None):
    r"""Calculate the weighted power mean along the specified axis.

    The weighted power mean of the array :math:`a_i` associated to weights
    :math:`w_i` is:

    .. math::

        \left( \frac{ \sum_{i=1}^n w_i a_i^p }{ \sum_{i=1}^n w_i }
              \right)^{ 1 / p } \, ,

    and, with equal weights, it gives:

    .. math::

        \left( \frac{ 1 }{ n } \sum_{i=1}^n a_i^p \right)^{ 1 / p }  \, .

    When ``p=0``, it returns the geometric mean.

    This mean is also called generalized mean or Hölder mean, and must not be
    confused with the Kolmogorov generalized mean, also called
    quasi-arithmetic mean or generalized f-mean [3]_.

    Parameters
    ----------
    a : array_like
        Input array, masked array or object that can be converted to an array.
    p : int or float
        Exponent.
    axis : int or None, optional
        Axis along which the power mean is computed. Default is 0.
        If None, compute over the whole array `a`.
    dtype : dtype, optional
        Type of the returned array and of the accumulator in which the
        elements are summed. If `dtype` is not specified, it defaults to the
        dtype of `a`, unless `a` has an integer `dtype` with a precision less
        than that of the default platform integer. In that case, the default
        platform integer is used.
    weights : array_like, optional
        The weights array can either be 1-D (in which case its length must be
        the size of `a` along the given `axis`) or of the same shape as `a`.
        Default is None, which gives each value a weight of 1.0.

    Returns
    -------
    pmean : ndarray, see `dtype` parameter above.
        Output array containing the power mean values.

    See Also
    --------
    numpy.average : Weighted average
    gmean : Geometric mean
    hmean : Harmonic mean

    Notes
    -----
    The power mean is computed over a single dimension of the input
    array, ``axis=0`` by default, or all values in the array if ``axis=None``.
    float64 intermediate and return values are used for integer inputs.

    The power mean is only defined if all observations are non-negative;
    otherwise, the result is NaN.

    .. versionadded:: 1.9

    References
    ----------
    .. [1] "Generalized Mean", *Wikipedia*,
           https://en.wikipedia.org/wiki/Generalized_mean
    .. [2] Norris, N., "Convexity properties of generalized mean value
           functions", The Annals of Mathematical Statistics, vol. 8,
           pp. 118-120, 1937
    .. [3] Bullen, P.S., Handbook of Means and Their Inequalities, 2003

    Examples
    --------
    >>> from scipy.stats import pmean, hmean, gmean
    >>> pmean([1, 4], 1.3)
    2.639372938300652
    >>> pmean([1, 2, 3, 4, 5, 6, 7], 1.3)
    4.157111214492084
    >>> pmean([1, 4, 7], -2, weights=[3, 1, 3])
    1.4969684896631954

    For p=-1, power mean is equal to harmonic mean:

    >>> pmean([1, 4, 7], -1, weights=[3, 1, 3])
    1.9029126213592233
    >>> hmean([1, 4, 7], weights=[3, 1, 3])
    1.9029126213592233

    For p=0, power mean is defined as the geometric mean:

    >>> pmean([1, 4, 7], 0, weights=[3, 1, 3])
    2.80668351922014
    >>> gmean([1, 4, 7], weights=[3, 1, 3])
    2.80668351922014

    """
    if not isinstance(p, int | float):
        raise ValueError("Power mean only defined for exponent of type int or "
                         "float.")
    if p == 0:
        return gmean(a, axis=axis, dtype=dtype, weights=weights)

    xp = array_namespace(a, weights)
    a = xp.asarray(a, dtype=dtype)

    if weights is not None:
        weights = xp.asarray(weights, dtype=dtype)

    negative_mask = a < 0
    if xp.any(negative_mask):
        # `where` avoids having to be careful about dtypes and will work with
        # JAX. This is the exceptional case, so it's OK to be a little slower.
        # Won't work for array_api_strict for now, but see data-apis/array-api#807
        a = xp.where(negative_mask, np.nan, a)
        message = ("The power mean is only defined if all elements are "
                   "non-negative; otherwise, the result is NaN.")
        warnings.warn(message, RuntimeWarning, stacklevel=2)

    with np.errstate(divide='ignore', invalid='ignore'):
        return _xp_mean(a**float(p), axis=axis, weights=weights)**(1/p)


ModeResult = namedtuple('ModeResult', ('mode', 'count'))


def _mode_result(mode, count):
    # When a slice is empty, `_axis_nan_policy` automatically produces
    # NaN for `mode` and `count`. This is a reasonable convention for `mode`,
    # but `count` should not be NaN; it should be zero.
    i = np.isnan(count)
    if i.shape == ():
        count = np.asarray(0, dtype=count.dtype)[()] if i else count
    else:
        count[i] = 0
    return ModeResult(mode, count)


@_axis_nan_policy_factory(_mode_result, override={'nan_propagation': False})
def mode(a, axis=0, nan_policy='propagate', keepdims=False):
    r"""Return an array of the modal (most common) value in the passed array.

    If there is more than one such value, only one is returned.
    The bin-count for the modal bins is also returned.

    Parameters
    ----------
    a : array_like
        Numeric, n-dimensional array of which to find mode(s).
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over
        the whole array `a`.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': treats nan as it would treat any other value
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values
    keepdims : bool, optional
        If set to ``False``, the `axis` over which the statistic is taken
        is consumed (eliminated from the output array). If set to ``True``,
        the `axis` is retained with size one, and the result will broadcast
        correctly against the input array.

    Returns
    -------
    mode : ndarray
        Array of modal values.
    count : ndarray
        Array of counts for each mode.

    Notes
    -----
    The mode  is calculated using `numpy.unique`.
    In NumPy versions 1.21 and after, all NaNs - even those with different
    binary representations - are treated as equivalent and counted as separate
    instances of the same value.

    By convention, the mode of an empty array is NaN, and the associated count
    is zero.

    Examples
    --------
    >>> import numpy as np
    >>> a = np.array([[3, 0, 3, 7],
    ...               [3, 2, 6, 2],
    ...               [1, 7, 2, 8],
    ...               [3, 0, 6, 1],
    ...               [3, 2, 5, 5]])
    >>> from scipy import stats
    >>> stats.mode(a, keepdims=True)
    ModeResult(mode=array([[3, 0, 6, 1]]), count=array([[4, 2, 2, 1]]))

    To get mode of whole array, specify ``axis=None``:

    >>> stats.mode(a, axis=None, keepdims=True)
    ModeResult(mode=[[3]], count=[[5]])
    >>> stats.mode(a, axis=None, keepdims=False)
    ModeResult(mode=3, count=5)

    """
    # `axis`, `nan_policy`, and `keepdims` are handled by `_axis_nan_policy`
    if not np.issubdtype(a.dtype, np.number):
        message = ("Argument `a` is not recognized as numeric. "
                   "Support for input that cannot be coerced to a numeric "
                   "array was deprecated in SciPy 1.9.0 and removed in SciPy "
                   "1.11.0. Please consider `np.unique`.")
        raise TypeError(message)

    if a.size == 0:
        NaN = _get_nan(a)
        return ModeResult(*np.array([NaN, 0], dtype=NaN.dtype))

    if a.ndim == 1:
        vals, cnts = np.unique(a, return_counts=True)
        modes, counts = vals[cnts.argmax()], cnts.max()
        return ModeResult(modes[()], counts[()])

    # `axis` is always -1 after the `_axis_nan_policy` decorator
    y = np.sort(a, axis=-1)
    # Get boolean array of elements that are different from the previous element
    i = np.concatenate([np.ones(y.shape[:-1] + (1,), dtype=bool),
                        (y[..., :-1] != y[..., 1:]) & ~np.isnan(y[..., :-1])], axis=-1)
    # Get linear integer indices of these elements in a raveled array
    indices = np.arange(y.size)[i.ravel()]
    # The difference between integer indices is the number of repeats
    counts = np.diff(indices, append=y.size)
    # Now we form an array of `counts` corresponding with each element of `y`...
    counts = np.reshape(np.repeat(counts, counts), y.shape)
    # ... so we can get the argmax of *each slice* separately.
    k = np.argmax(counts, axis=-1, keepdims=True)
    # Extract the corresponding element/count, and eliminate the reduced dimension
    modes = np.take_along_axis(y, k, axis=-1)[..., 0]
    counts = np.take_along_axis(counts, k, axis=-1)[..., 0]
    return ModeResult(modes[()], counts[()])


def _put_val_to_limits(a, limits, inclusive, val=np.nan, xp=None):
    """Replace elements outside limits with a value.

    This is primarily a utility function.

    Parameters
    ----------
    a : array
    limits : (float or None, float or None)
        A tuple consisting of the (lower limit, upper limit).  Elements in the
        input array less than the lower limit or greater than the upper limit
        will be replaced with `val`. None implies no limit.
    inclusive : (bool, bool)
        A tuple consisting of the (lower flag, upper flag).  These flags
        determine whether values exactly equal to lower or upper are allowed.
    val : float, default: NaN
        The value with which extreme elements of the array are replaced.

    """
    xp = array_namespace(a) if xp is None else xp
    mask = xp.zeros_like(a, dtype=xp.bool)
    if limits is None:
        return a, mask
    lower_limit, upper_limit = limits
    lower_include, upper_include = inclusive
    if lower_limit is not None:
        mask |= (a < lower_limit) if lower_include else a <= lower_limit
    if upper_limit is not None:
        mask |= (a > upper_limit) if upper_include else a >= upper_limit
    lazy = is_lazy_array(mask)
    if not lazy and xp.all(mask):
        raise ValueError("No array values within given limits")
    if lazy or xp.any(mask):
        a = xp.where(mask, val, a)
    return a, mask


@xp_capabilities()
@_axis_nan_policy_factory(
    lambda x: x, n_outputs=1, default_axis=None,
    result_to_tuple=lambda x, _: (x,)
)
def tmean(a, limits=None, inclusive=(True, True), axis=None):
    """Compute the trimmed mean.

    This function finds the arithmetic mean of given values, ignoring values
    outside the given `limits`.

    Parameters
    ----------
    a : array_like
        Array of values.
    limits : None or (lower limit, upper limit), optional
        Values in the input array less than the lower limit or greater than the
        upper limit will be ignored.  When limits is None (default), then all
        values are used.  Either of the limit values in the tuple can also be
        None representing a half-open interval.
    inclusive : (bool, bool), optional
        A tuple consisting of the (lower flag, upper flag).  These flags
        determine whether values exactly equal to the lower or upper limits
        are included.  The default value is (True, True).
    axis : int or None, optional
        Axis along which to compute test. Default is None.

    Returns
    -------
    tmean : ndarray
        Trimmed mean.

    See Also
    --------
    trim_mean : Returns mean after trimming a proportion from both tails.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = np.arange(20)
    >>> stats.tmean(x)
    9.5
    >>> stats.tmean(x, (3,17))
    10.0

    """
    xp = array_namespace(a)
    a, mask = _put_val_to_limits(a, limits, inclusive, val=0., xp=xp)
    # explicit dtype specification required due to data-apis/array-api-compat#152
    sum = xp.sum(a, axis=axis, dtype=a.dtype)
    n = xp.sum(xp.asarray(~mask, dtype=a.dtype), axis=axis, dtype=a.dtype)
    mean = xpx.apply_where(n != 0, (sum, n), operator.truediv, fill_value=xp.nan)
    return mean[()] if mean.ndim == 0 else mean


@xp_capabilities()
@_axis_nan_policy_factory(
    lambda x: x, n_outputs=1, result_to_tuple=lambda x, _: (x,)
)
def tvar(a, limits=None, inclusive=(True, True), axis=0, ddof=1):
    """Compute the trimmed variance.

    This function computes the sample variance of an array of values,
    while ignoring values which are outside of given `limits`.

    Parameters
    ----------
    a : array_like
        Array of values.
    limits : None or (lower limit, upper limit), optional
        Values in the input array less than the lower limit or greater than the
        upper limit will be ignored. When limits is None, then all values are
        used. Either of the limit values in the tuple can also be None
        representing a half-open interval.  The default value is None.
    inclusive : (bool, bool), optional
        A tuple consisting of the (lower flag, upper flag).  These flags
        determine whether values exactly equal to the lower or upper limits
        are included.  The default value is (True, True).
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over the
        whole array `a`.
    ddof : int, optional
        Delta degrees of freedom.  Default is 1.

    Returns
    -------
    tvar : float
        Trimmed variance.

    Notes
    -----
    `tvar` computes the unbiased sample variance, i.e. it uses a correction
    factor ``n / (n - 1)``.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = np.arange(20)
    >>> stats.tvar(x)
    35.0
    >>> stats.tvar(x, (3,17))
    20.0

    """
    xp = array_namespace(a)
    a, _ = _put_val_to_limits(a, limits, inclusive, xp=xp)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SmallSampleWarning)
        # Currently, this behaves like nan_policy='omit' for alternative array
        # backends, but nan_policy='propagate' will be handled for other backends
        # by the axis_nan_policy decorator shortly.
        return _xp_var(a, correction=ddof, axis=axis, nan_policy='omit', xp=xp)


@xp_capabilities()
@_axis_nan_policy_factory(
    lambda x: x, n_outputs=1, result_to_tuple=lambda x, _: (x,)
)
def tmin(a, lowerlimit=None, axis=0, inclusive=True, nan_policy='propagate'):
    """Compute the trimmed minimum.

    This function finds the minimum value of an array `a` along the
    specified axis, but only considering values greater than a specified
    lower limit.

    Parameters
    ----------
    a : array_like
        Array of values.
    lowerlimit : None or float, optional
        Values in the input array less than the given limit will be ignored.
        When lowerlimit is None, then all values are used. The default value
        is None.
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over the
        whole array `a`.
    inclusive : {True, False}, optional
        This flag determines whether values exactly equal to the lower limit
        are included.  The default value is True.

    Returns
    -------
    tmin : float, int or ndarray
        Trimmed minimum.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = np.arange(20)
    >>> stats.tmin(x)
    0

    >>> stats.tmin(x, 13)
    13

    >>> stats.tmin(x, 13, inclusive=False)
    14

    """
    xp = array_namespace(a)

    max_ = xp.iinfo(a.dtype).max if xp.isdtype(a.dtype, 'integral') else xp.inf
    a, mask = _put_val_to_limits(a, (lowerlimit, None), (inclusive, None),
                                 val=max_, xp=xp)

    res = xp.min(a, axis=axis)
    invalid = xp.all(mask, axis=axis)  # All elements are below lowerlimit

    # For eager backends, output dtype is data-dependent
    if is_lazy_array(invalid) or xp.any(invalid):
        # Possible loss of precision for int types
        res = xp_promote(res, force_floating=True, xp=xp)
        res = xp.where(invalid, xp.nan, res)

    return res[()] if res.ndim == 0 else res


@xp_capabilities()
@_axis_nan_policy_factory(
    lambda x: x, n_outputs=1, result_to_tuple=lambda x, _: (x,)
)
def tmax(a, upperlimit=None, axis=0, inclusive=True, nan_policy='propagate'):
    """Compute the trimmed maximum.

    This function computes the maximum value of an array along a given axis,
    while ignoring values larger than a specified upper limit.

    Parameters
    ----------
    a : array_like
        Array of values.
    upperlimit : None or float, optional
        Values in the input array greater than the given limit will be ignored.
        When upperlimit is None, then all values are used. The default value
        is None.
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over the
        whole array `a`.
    inclusive : {True, False}, optional
        This flag determines whether values exactly equal to the upper limit
        are included.  The default value is True.

    Returns
    -------
    tmax : float, int or ndarray
        Trimmed maximum.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = np.arange(20)
    >>> stats.tmax(x)
    19

    >>> stats.tmax(x, 13)
    13

    >>> stats.tmax(x, 13, inclusive=False)
    12

    """
    xp = array_namespace(a)

    min_ = xp.iinfo(a.dtype).min if xp.isdtype(a.dtype, 'integral') else -xp.inf
    a, mask = _put_val_to_limits(a, (None, upperlimit), (None, inclusive),
                                 val=min_, xp=xp)

    res = xp.max(a, axis=axis)
    invalid = xp.all(mask, axis=axis)  # All elements are above upperlimit

    # For eager backends, output dtype is data-dependent
    if is_lazy_array(invalid) or xp.any(invalid):
        # Possible loss of precision for int types
        res = xp_promote(res, force_floating=True, xp=xp)
        res = xp.where(invalid, xp.nan, res)

    return res[()] if res.ndim == 0 else res


@xp_capabilities()
@_axis_nan_policy_factory(
    lambda x: x, n_outputs=1, result_to_tuple=lambda x, _: (x,)
)
def tstd(a, limits=None, inclusive=(True, True), axis=0, ddof=1):
    """Compute the trimmed sample standard deviation.

    This function finds the sample standard deviation of given values,
    ignoring values outside the given `limits`.

    Parameters
    ----------
    a : array_like
        Array of values.
    limits : None or (lower limit, upper limit), optional
        Values in the input array less than the lower limit or greater than the
        upper limit will be ignored. When limits is None, then all values are
        used. Either of the limit values in the tuple can also be None
        representing a half-open interval.  The default value is None.
    inclusive : (bool, bool), optional
        A tuple consisting of the (lower flag, upper flag).  These flags
        determine whether values exactly equal to the lower or upper limits
        are included.  The default value is (True, True).
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over the
        whole array `a`.
    ddof : int, optional
        Delta degrees of freedom.  Default is 1.

    Returns
    -------
    tstd : float
        Trimmed sample standard deviation.

    Notes
    -----
    `tstd` computes the unbiased sample standard deviation, i.e. it uses a
    correction factor ``n / (n - 1)``.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = np.arange(20)
    >>> stats.tstd(x)
    5.9160797830996161
    >>> stats.tstd(x, (3,17))
    4.4721359549995796

    """
    return tvar(a, limits, inclusive, axis, ddof, _no_deco=True)**0.5


@xp_capabilities()
@_axis_nan_policy_factory(
    lambda x: x, n_outputs=1, result_to_tuple=lambda x, _: (x,)
)
def tsem(a, limits=None, inclusive=(True, True), axis=0, ddof=1):
    """Compute the trimmed standard error of the mean.

    This function finds the standard error of the mean for given
    values, ignoring values outside the given `limits`.

    Parameters
    ----------
    a : array_like
        Array of values.
    limits : None or (lower limit, upper limit), optional
        Values in the input array less than the lower limit or greater than the
        upper limit will be ignored. When limits is None, then all values are
        used. Either of the limit values in the tuple can also be None
        representing a half-open interval.  The default value is None.
    inclusive : (bool, bool), optional
        A tuple consisting of the (lower flag, upper flag).  These flags
        determine whether values exactly equal to the lower or upper limits
        are included.  The default value is (True, True).
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over the
        whole array `a`.
    ddof : int, optional
        Delta degrees of freedom.  Default is 1.

    Returns
    -------
    tsem : float
        Trimmed standard error of the mean.

    Notes
    -----
    `tsem` uses unbiased sample standard deviation, i.e. it uses a
    correction factor ``n / (n - 1)``.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = np.arange(20)
    >>> stats.tsem(x)
    1.3228756555322954
    >>> stats.tsem(x, (3,17))
    1.1547005383792515

    """
    xp = array_namespace(a)
    a, _ = _put_val_to_limits(a, limits, inclusive, xp=xp)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SmallSampleWarning)
        # Currently, this behaves like nan_policy='omit' for alternative array
        # backends, but nan_policy='propagate' will be handled for other backends
        # by the axis_nan_policy decorator shortly.
        sd = _xp_var(a, correction=ddof, axis=axis, nan_policy='omit', xp=xp)**0.5

    not_nan = xp.astype(~xp.isnan(a), a.dtype)
    n_obs = xp.sum(not_nan, axis=axis, dtype=sd.dtype)
    return sd / n_obs**0.5


#####################################
#              MOMENTS              #
#####################################


def _moment_outputs(kwds, default_order=1):
    order = np.atleast_1d(kwds.get('order', default_order))
    message = "`order` must be a scalar or a non-empty 1D array."
    if order.size == 0 or order.ndim > 1:
        raise ValueError(message)
    return len(order)


def _moment_result_object(*args):
    if len(args) == 1:
        return args[0]
    return np.asarray(args)


# When `order` is array-like with size > 1, moment produces an *array*
# rather than a tuple, but the zeroth dimension is to be treated like
# separate outputs. It is important to make the distinction between
# separate outputs when adding the reduced axes back (`keepdims=True`).
def _moment_tuple(x, n_out):
    return tuple(x) if n_out > 1 else (x,)


# `moment` fits into the `_axis_nan_policy` pattern, but it is a bit unusual
# because the number of outputs is variable. Specifically,
# `result_to_tuple=lambda x: (x,)` may be surprising for a function that
# can produce more than one output, but it is intended here.
# When `moment is called to produce the output:
# - `result_to_tuple` packs the returned array into a single-element tuple,
# - `_moment_result_object` extracts and returns that single element.
# However, when the input array is empty, `moment` is never called. Instead,
# - `_check_empty_inputs` is used to produce an empty array with the
#   appropriate dimensions.
# - A list comprehension creates the appropriate number of copies of this
#   array, depending on `n_outputs`.
# - This list - which may have multiple elements - is passed into
#   `_moment_result_object`.
# - If there is a single output, `_moment_result_object` extracts and returns
#   the single output from the list.
# - If there are multiple outputs, and therefore multiple elements in the list,
#   `_moment_result_object` converts the list of arrays to a single array and
#   returns it.
# Currently, this leads to a slight inconsistency: when the input array is
# empty, there is no distinction between the `moment` function being called
# with parameter `order=1` and `order=[1]`; the latter *should* produce
# the same as the former but with a singleton zeroth dimension.
@xp_capabilities(jax_jit=False, allow_dask_compute=True)
@_rename_parameter('moment', 'order')
@_axis_nan_policy_factory(  # noqa: E302
    _moment_result_object, n_samples=1, result_to_tuple=_moment_tuple,
    n_outputs=_moment_outputs
)
def moment(a, order=1, axis=0, nan_policy='propagate', *, center=None):
    r"""Calculate the nth moment about the mean for a sample.

    A moment is a specific quantitative measure of the shape of a set of
    points. It is often used to calculate coefficients of skewness and kurtosis
    due to its close relationship with them.

    Parameters
    ----------
    a : array_like
       Input array.
    order : int or 1-D array_like of ints, optional
       Order of central moment that is returned. Default is 1.
    axis : int or None, optional
       Axis along which the central moment is computed. Default is 0.
       If None, compute over the whole array `a`.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values

    center : float or None, optional
       The point about which moments are taken. This can be the sample mean,
       the origin, or any other be point. If `None` (default) compute the
       center as the sample mean.

    Returns
    -------
    n-th moment about the `center` : ndarray or float
       The appropriate moment along the given axis or over all values if axis
       is None. The denominator for the moment calculation is the number of
       observations, no degrees of freedom correction is done.

    See Also
    --------
    kurtosis, skew, describe

    Notes
    -----
    The k-th moment of a data sample is:

    .. math::

        m_k = \frac{1}{n} \sum_{i = 1}^n (x_i - c)^k

    Where `n` is the number of samples, and `c` is the center around which the
    moment is calculated. This function uses exponentiation by squares [1]_ for
    efficiency.

    Note that, if `a` is an empty array (``a.size == 0``), array `moment` with
    one element (`moment.size == 1`) is treated the same as scalar `moment`
    (``np.isscalar(moment)``). This might produce arrays of unexpected shape.

    References
    ----------
    .. [1] https://eli.thegreenplace.net/2009/03/21/efficient-integer-exponentiation-algorithms

    Examples
    --------
    >>> from scipy.stats import moment
    >>> moment([1, 2, 3, 4, 5], order=1)
    0.0
    >>> moment([1, 2, 3, 4, 5], order=2)
    2.0

    """
    xp = array_namespace(a)
    a, axis = _chk_asarray(a, axis, xp=xp)

    a = xp_promote(a, force_floating=True, xp=xp)

    order = xp.asarray(order, dtype=a.dtype)
    if xp_size(order) == 0:
        # This is tested by `_moment_outputs`, which is run by the `_axis_nan_policy`
        # decorator. Currently, the `_axis_nan_policy` decorator is skipped when `a`
        # is a non-NumPy array, so we need to check again. When the decorator is
        # updated for array API compatibility, we can remove this second check.
        raise ValueError("`order` must be a scalar or a non-empty 1D array.")
    if xp.any(order != xp.round(order)):
        raise ValueError("All elements of `order` must be integral.")
    order = order[()] if order.ndim == 0 else order

    # for array_like order input, return a value for each.
    if order.ndim > 0:
        # Calculated the mean once at most, and only if it will be used
        calculate_mean = center is None and xp.any(order > 1)
        mean = xp.mean(a, axis=axis, keepdims=True) if calculate_mean else None
        mmnt = []
        for i in range(order.shape[0]):
            order_i = order[i]
            if center is None and order_i > 1:
                mmnt.append(_moment(a, order_i, axis, mean=mean)[np.newaxis, ...])
            else:
                mmnt.append(_moment(a, order_i, axis, mean=center)[np.newaxis, ...])
        return xp.concat(mmnt, axis=0)
    else:
        return _moment(a, order, axis, mean=center)


def _demean(a, mean, axis, *, xp, precision_warning=True):
    # subtracts `mean` from `a` and returns the result,
    # warning if there is catastrophic cancellation. `mean`
    # must be the mean of `a` along axis with `keepdims=True`.
    # Used in e.g. `_moment`, `_zscore`, `_xp_var`. See gh-15905.
    a_zero_mean = a - mean

    if (xp_size(a_zero_mean) == 0 or not precision_warning
        or is_lazy_array(a_zero_mean)):
        return a_zero_mean

    eps = xp.finfo(mean.dtype).eps * 10

    with np.errstate(divide='ignore', invalid='ignore'):
        rel_diff = xp.max(xp.abs(a_zero_mean), axis=axis,
                          keepdims=True) / xp.abs(mean)

    n = _length_nonmasked(a, axis, xp=xp)
    with np.errstate(invalid='ignore'):
        precision_loss = xp.any(xp.asarray(rel_diff < eps) & xp.asarray(n > 1))

    if precision_loss:
        message = ("Precision loss occurred in moment calculation due to "
                   "catastrophic cancellation. This occurs when the data "
                   "are nearly identical. Results may be unreliable.")
        warnings.warn(message, RuntimeWarning, stacklevel=5)
    return a_zero_mean


def _moment(a, order, axis, *, mean=None, xp=None):
    """Vectorized calculation of raw moment about specified center

    When `mean` is None, the mean is computed and used as the center;
    otherwise, the provided value is used as the center.

    """
    xp = array_namespace(a) if xp is None else xp

    a = xp_promote(a, force_floating=True, xp=xp)
    dtype = a.dtype

    # moment of empty array is the same regardless of order
    if xp_size(a) == 0:
        return xp.mean(a, axis=axis)

    if order == 0 or (order == 1 and mean is None):
        # By definition the zeroth moment is always 1, and the first *central*
        # moment is 0.
        shape = list(a.shape)
        del shape[axis]

        temp = (xp.ones(shape, dtype=dtype) if order == 0
                else xp.zeros(shape, dtype=dtype))
        return temp[()] if temp.ndim == 0 else temp

    # Exponentiation by squares: form exponent sequence
    n_list = [order]
    current_n = order
    while current_n > 2:
        if current_n % 2:
            current_n = (current_n - 1) / 2
        else:
            current_n /= 2
        n_list.append(current_n)

    # Starting point for exponentiation by squares
    mean = (xp.mean(a, axis=axis, keepdims=True) if mean is None
            else xp.asarray(mean, dtype=dtype))
    mean = mean[()] if mean.ndim == 0 else mean
    a_zero_mean = _demean(a, mean, axis, xp=xp)

    if n_list[-1] == 1:
        s = xp.asarray(a_zero_mean, copy=True)
    else:
        s = a_zero_mean**2

    # Perform multiplications
    for n in n_list[-2::-1]:
        s = s**2
        if n % 2:
            s *= a_zero_mean
    return xp.mean(s, axis=axis)


def _var(x, axis=0, ddof=0, mean=None, xp=None):
    # Calculate variance of sample, warning if precision is lost
    xp = array_namespace(x) if xp is None else xp
    var = _moment(x, 2, axis, mean=mean, xp=xp)
    if ddof != 0:
        n = _length_nonmasked(x, axis, xp=xp)
        var *= np.divide(n, n-ddof)  # to avoid error on division by zero
    return var


def _length_nonmasked(x, axis, keepdims=False, xp=None):
    xp = array_namespace(x) if xp is None else xp
    if is_marray(xp):
        if np.iterable(axis):
            message = '`axis` must be an integer or None for use with `MArray`.'
            raise NotImplementedError(message)
        return xp.astype(xp.count(x, axis=axis, keepdims=keepdims), x.dtype)
    return (xp_size(x) if axis is None else
            # compact way to deal with axis tuples or ints
            int(np.prod(np.asarray(x.shape)[np.asarray(axis)])))


def _share_masks(*args, xp):
    if is_marray(xp):
        mask = functools.reduce(operator.or_, (arg.mask for arg in args))
        args = [xp.asarray(arg.data, mask=mask) for arg in args]
    return args[0] if len(args) == 1 else args


@xp_capabilities(jax_jit=False, allow_dask_compute=2)
@_axis_nan_policy_factory(
    lambda x: x, result_to_tuple=lambda x, _: (x,), n_outputs=1
)
# nan_policy handled by `_axis_nan_policy`, but needs to be left
# in signature to preserve use as a positional argument
def skew(a, axis=0, bias=True, nan_policy='propagate'):
    r"""Compute the sample skewness of a data set.

    For normally distributed data, the skewness should be about zero. For
    unimodal continuous distributions, a skewness value greater than zero means
    that there is more weight in the right tail of the distribution. The
    function `skewtest` can be used to determine if the skewness value
    is close enough to zero, statistically speaking.

    Parameters
    ----------
    a : ndarray
        Input array.
    axis : int or None, optional
        Axis along which skewness is calculated. Default is 0.
        If None, compute over the whole array `a`.
    bias : bool, optional
        If False, then the calculations are corrected for statistical bias.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    skewness : ndarray
        The skewness of values along an axis, returning NaN where all values
        are equal.

    Notes
    -----
    The sample skewness is computed as the Fisher-Pearson coefficient
    of skewness, i.e.

    .. math::

        g_1=\frac{m_3}{m_2^{3/2}}

    where

    .. math::

        m_i=\frac{1}{N}\sum_{n=1}^N(x[n]-\bar{x})^i

    is the biased sample :math:`i\texttt{th}` central moment, and
    :math:`\bar{x}` is
    the sample mean.  If ``bias`` is False, the calculations are
    corrected for bias and the value computed is the adjusted
    Fisher-Pearson standardized moment coefficient, i.e.

    .. math::

        G_1=\frac{k_3}{k_2^{3/2}}=
            \frac{\sqrt{N(N-1)}}{N-2}\frac{m_3}{m_2^{3/2}}.

    References
    ----------
    .. [1] Zwillinger, D. and Kokoska, S. (2000). CRC Standard
       Probability and Statistics Tables and Formulae. Chapman & Hall: New
       York. 2000.
       Section 2.2.24.1

    Examples
    --------
    >>> from scipy.stats import skew
    >>> skew([1, 2, 3, 4, 5])
    0.0
    >>> skew([2, 8, 0, 4, 1, 9, 9, 0])
    0.2650554122698573

    """
    xp = array_namespace(a)
    a, axis = _chk_asarray(a, axis, xp=xp)
    n = _length_nonmasked(a, axis, xp=xp)

    mean = xp.mean(a, axis=axis, keepdims=True)
    mean_reduced = xp.squeeze(mean, axis=axis)  # needed later
    m2 = _moment(a, 2, axis, mean=mean, xp=xp)
    m3 = _moment(a, 3, axis, mean=mean, xp=xp)
    with np.errstate(all='ignore'):
        eps = xp.finfo(m2.dtype).eps
        zero = m2 <= (eps * mean_reduced)**2
        vals = xp.where(zero, xp.nan, m3 / m2**1.5)
    if not bias:
        can_correct = ~zero & (n > 2)
        if is_lazy_array(can_correct) or xp.any(can_correct):
            nval = ((n - 1.0) * n)**0.5 / (n - 2.0) * m3 / m2**1.5
            vals = xp.where(can_correct, nval, vals)

    return vals[()] if vals.ndim == 0 else vals


@xp_capabilities(jax_jit=False, allow_dask_compute=2)
@_axis_nan_policy_factory(
    lambda x: x, result_to_tuple=lambda x, _: (x,), n_outputs=1
)
# nan_policy handled by `_axis_nan_policy`, but needs to be left
# in signature to preserve use as a positional argument
def kurtosis(a, axis=0, fisher=True, bias=True, nan_policy='propagate'):
    """Compute the kurtosis (Fisher or Pearson) of a dataset.

    Kurtosis is the fourth central moment divided by the square of the
    variance. If Fisher's definition is used, then 3.0 is subtracted from
    the result to give 0.0 for a normal distribution.

    If bias is False then the kurtosis is calculated using k statistics to
    eliminate bias coming from biased moment estimators

    Use `kurtosistest` to see if result is close enough to normal.

    Parameters
    ----------
    a : array
        Data for which the kurtosis is calculated.
    axis : int or None, optional
        Axis along which the kurtosis is calculated. Default is 0.
        If None, compute over the whole array `a`.
    fisher : bool, optional
        If True, Fisher's definition is used (normal ==> 0.0). If False,
        Pearson's definition is used (normal ==> 3.0).
    bias : bool, optional
        If False, then the calculations are corrected for statistical bias.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan. 'propagate' returns nan,
        'raise' throws an error, 'omit' performs the calculations ignoring nan
        values. Default is 'propagate'.

    Returns
    -------
    kurtosis : array
        The kurtosis of values along an axis, returning NaN where all values
        are equal.

    References
    ----------
    .. [1] Zwillinger, D. and Kokoska, S. (2000). CRC Standard
       Probability and Statistics Tables and Formulae. Chapman & Hall: New
       York. 2000.

    Examples
    --------
    In Fisher's definition, the kurtosis of the normal distribution is zero.
    In the following example, the kurtosis is close to zero, because it was
    calculated from the dataset, not from the continuous distribution.

    >>> import numpy as np
    >>> from scipy.stats import norm, kurtosis
    >>> data = norm.rvs(size=1000, random_state=3)
    >>> kurtosis(data)
    -0.06928694200380558

    The distribution with a higher kurtosis has a heavier tail.
    The zero valued kurtosis of the normal distribution in Fisher's definition
    can serve as a reference point.

    >>> import matplotlib.pyplot as plt
    >>> import scipy.stats as stats
    >>> from scipy.stats import kurtosis

    >>> x = np.linspace(-5, 5, 100)
    >>> ax = plt.subplot()
    >>> distnames = ['laplace', 'norm', 'uniform']

    >>> for distname in distnames:
    ...     if distname == 'uniform':
    ...         dist = getattr(stats, distname)(loc=-2, scale=4)
    ...     else:
    ...         dist = getattr(stats, distname)
    ...     data = dist.rvs(size=1000)
    ...     kur = kurtosis(data, fisher=True)
    ...     y = dist.pdf(x)
    ...     ax.plot(x, y, label="{}, {}".format(distname, round(kur, 3)))
    ...     ax.legend()

    The Laplace distribution has a heavier tail than the normal distribution.
    The uniform distribution (which has negative kurtosis) has the thinnest
    tail.

    """
    xp = array_namespace(a)
    a, axis = _chk_asarray(a, axis, xp=xp)

    n = _length_nonmasked(a, axis, xp=xp)
    mean = xp.mean(a, axis=axis, keepdims=True)
    mean_reduced = xp.squeeze(mean, axis=axis)  # needed later
    m2 = _moment(a, 2, axis, mean=mean, xp=xp)
    m4 = _moment(a, 4, axis, mean=mean, xp=xp)
    with np.errstate(all='ignore'):
        zero = m2 <= (xp.finfo(m2.dtype).eps * mean_reduced)**2
        vals = xp.where(zero, xp.nan, m4 / m2**2.0)

    if not bias:
        can_correct = ~zero & (n > 3)
        if is_lazy_array(can_correct) or xp.any(can_correct):
            nval = 1.0/(n-2)/(n-3) * ((n**2-1.0)*m4/m2**2.0 - 3*(n-1)**2.0)
            vals = xp.where(can_correct, nval + 3.0, vals)

    vals = vals - 3 if fisher else vals
    return vals[()] if vals.ndim == 0 else vals


DescribeResult = namedtuple('DescribeResult',
                            ('nobs', 'minmax', 'mean', 'variance', 'skewness',
                             'kurtosis'))


@xp_capabilities(jax_jit=False, allow_dask_compute=True)
def describe(a, axis=0, ddof=1, bias=True, nan_policy='propagate'):
    """Compute several descriptive statistics of the passed array.

    Parameters
    ----------
    a : array_like
        Input data.
    axis : int or None, optional
        Axis along which statistics are calculated. Default is 0.
        If None, compute over the whole array `a`.
    ddof : int, optional
        Delta degrees of freedom (only for variance).  Default is 1.
    bias : bool, optional
        If False, then the skewness and kurtosis calculations are corrected
        for statistical bias.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

        * 'propagate': returns nan
        * 'raise': throws an error
        * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    nobs : int or ndarray of ints
        Number of observations (length of data along `axis`).
        When 'omit' is chosen as nan_policy, the length along each axis
        slice is counted separately.
    minmax: tuple of ndarrays or floats
        Minimum and maximum value of `a` along the given axis.
    mean : ndarray or float
        Arithmetic mean of `a` along the given axis.
    variance : ndarray or float
        Unbiased variance of `a` along the given axis; denominator is number
        of observations minus one.
    skewness : ndarray or float
        Skewness of `a` along the given axis, based on moment calculations
        with denominator equal to the number of observations, i.e. no degrees
        of freedom correction.
    kurtosis : ndarray or float
        Kurtosis (Fisher) of `a` along the given axis.  The kurtosis is
        normalized so that it is zero for the normal distribution.  No
        degrees of freedom are used.

    Raises
    ------
    ValueError
        If size of `a` is 0.

    See Also
    --------
    skew, kurtosis

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> a = np.arange(10)
    >>> stats.describe(a)
    DescribeResult(nobs=10, minmax=(0, 9), mean=4.5,
                   variance=9.166666666666666, skewness=0.0,
                   kurtosis=-1.2242424242424244)
    >>> b = [[1, 2], [3, 4]]
    >>> stats.describe(b)
    DescribeResult(nobs=2, minmax=(array([1, 2]), array([3, 4])),
                   mean=array([2., 3.]), variance=array([2., 2.]),
                   skewness=array([0., 0.]), kurtosis=array([-2., -2.]))

    """
    xp = array_namespace(a)
    a, axis = _chk_asarray(a, axis, xp=xp)

    contains_nan = _contains_nan(a, nan_policy)

    # Test nan_policy before the implicit call to bool(contains_nan)
    # to avoid raising on lazy xps on the default nan_policy='propagate'
    if nan_policy == 'omit' and contains_nan:
        # only NumPy gets here; `_contains_nan` raises error for the rest
        a = ma.masked_invalid(a)
        return mstats_basic.describe(a, axis, ddof, bias)

    if xp_size(a) == 0:
        raise ValueError("The input must not be empty.")

    # use xp.astype when data-apis/array-api-compat#226 is resolved
    n = xp.asarray(_length_nonmasked(a, axis, xp=xp), dtype=xp.int64)
    n = n[()] if n.ndim == 0 else n
    mm = (xp.min(a, axis=axis), xp.max(a, axis=axis))
    m = xp.mean(a, axis=axis)
    v = _var(a, axis=axis, ddof=ddof, xp=xp)
    sk = skew(a, axis, bias=bias)
    kurt = kurtosis(a, axis, bias=bias)

    return DescribeResult(n, mm, m, v, sk, kurt)

#####################################
#         NORMALITY TESTS           #
#####################################


def _get_pvalue(statistic, distribution, alternative, symmetric=True, xp=None):
    """Get p-value given the statistic, (continuous) distribution, and alternative"""
    xp = array_namespace(statistic) if xp is None else xp

    if alternative == 'less':
        pvalue = distribution.cdf(statistic)
    elif alternative == 'greater':
        pvalue = distribution.sf(statistic)
    elif alternative == 'two-sided':
        pvalue = 2 * (distribution.sf(xp.abs(statistic)) if symmetric
                      else xp.minimum(distribution.cdf(statistic),
                                      distribution.sf(statistic)))
    else:
        message = "`alternative` must be 'less', 'greater', or 'two-sided'."
        raise ValueError(message)

    return pvalue


SkewtestResult = namedtuple('SkewtestResult', ('statistic', 'pvalue'))


@xp_capabilities(jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(SkewtestResult, n_samples=1, too_small=7)
# nan_policy handled by `_axis_nan_policy`, but needs to be left
# in signature to preserve use as a positional argument
def skewtest(a, axis=0, nan_policy='propagate', alternative='two-sided'):
    r"""Test whether the skew is different from the normal distribution.

    This function tests the null hypothesis that the skewness of
    the population that the sample was drawn from is the same
    as that of a corresponding normal distribution.

    Parameters
    ----------
    a : array
        The data to be tested. Must contain at least eight observations.
    axis : int or None, optional
       Axis along which statistics are calculated. Default is 0.
       If None, compute over the whole array `a`.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

        * 'propagate': returns nan
        * 'raise': throws an error
        * 'omit': performs the calculations ignoring nan values

    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis. Default is 'two-sided'.
        The following options are available:

        * 'two-sided': the skewness of the distribution underlying the sample
          is different from that of the normal distribution (i.e. 0)
        * 'less': the skewness of the distribution underlying the sample
          is less than that of the normal distribution
        * 'greater': the skewness of the distribution underlying the sample
          is greater than that of the normal distribution

        .. versionadded:: 1.7.0

    Returns
    -------
    statistic : float
        The computed z-score for this test.
    pvalue : float
        The p-value for the hypothesis test.

    See Also
    --------
    :ref:`hypothesis_skewtest` : Extended example

    Notes
    -----
    The sample size must be at least 8.

    References
    ----------
    .. [1] R. B. D'Agostino, A. J. Belanger and R. B. D'Agostino Jr.,
            "A suggestion for using powerful and informative tests of
            normality", American Statistician 44, pp. 316-321, 1990.

    Examples
    --------

    >>> from scipy.stats import skewtest
    >>> skewtest([1, 2, 3, 4, 5, 6, 7, 8])
    SkewtestResult(statistic=1.0108048609177787, pvalue=0.3121098361421897)
    >>> skewtest([2, 8, 0, 4, 1, 9, 9, 0])
    SkewtestResult(statistic=0.44626385374196975, pvalue=0.6554066631275459)
    >>> skewtest([1, 2, 3, 4, 5, 6, 7, 8000])
    SkewtestResult(statistic=3.571773510360407, pvalue=0.0003545719905823133)
    >>> skewtest([100, 100, 100, 100, 100, 100, 100, 101])
    SkewtestResult(statistic=3.5717766638478072, pvalue=0.000354567720281634)
    >>> skewtest([1, 2, 3, 4, 5, 6, 7, 8], alternative='less')
    SkewtestResult(statistic=1.0108048609177787, pvalue=0.8439450819289052)
    >>> skewtest([1, 2, 3, 4, 5, 6, 7, 8], alternative='greater')
    SkewtestResult(statistic=1.0108048609177787, pvalue=0.15605491807109484)

    For a more detailed example, see :ref:`hypothesis_skewtest`.
    """
    xp = array_namespace(a)
    a, axis = _chk_asarray(a, axis, xp=xp)

    b2 = skew(a, axis, _no_deco=True)

    n = xp.asarray(_length_nonmasked(a, axis), dtype=b2.dtype)
    n = xpx.at(n, n < 8).set(xp.nan)
    if xp.any(xp.isnan(n)):
        message = ("`skewtest` requires at least 8 valid observations;"
                   "slices with fewer observations will produce NaNs.")
        warnings.warn(message, SmallSampleWarning, stacklevel=2)

    with np.errstate(divide='ignore', invalid='ignore'):
        y = b2 * xp.sqrt(((n + 1) * (n + 3)) / (6.0 * (n - 2)))
        beta2 = (3.0 * (n**2 + 27*n - 70) * (n+1) * (n+3) /
                 ((n-2.0) * (n+5) * (n+7) * (n+9)))
        W2 = -1 + xp.sqrt(2 * (beta2 - 1))
        delta = 1 / xp.sqrt(0.5 * xp.log(W2))
        alpha = xp.sqrt(2.0 / (W2 - 1))
        y = xp.where(y == 0, 1., y)
        Z = delta * xp.log(y / alpha + xp.sqrt((y / alpha)**2 + 1))
        pvalue = _get_pvalue(Z, _SimpleNormal(), alternative, xp=xp)

    Z = Z[()] if Z.ndim == 0 else Z
    pvalue = pvalue[()] if pvalue.ndim == 0 else pvalue
    return SkewtestResult(Z, pvalue)


KurtosistestResult = namedtuple('KurtosistestResult', ('statistic', 'pvalue'))


@xp_capabilities(jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(KurtosistestResult, n_samples=1, too_small=4)
def kurtosistest(a, axis=0, nan_policy='propagate', alternative='two-sided'):
    r"""Test whether a dataset has normal kurtosis.

    This function tests the null hypothesis that the kurtosis
    of the population from which the sample was drawn is that
    of the normal distribution.

    Parameters
    ----------
    a : array
        Array of the sample data. Must contain at least five observations.
    axis : int or None, optional
       Axis along which to compute test. Default is 0. If None,
       compute over the whole array `a`.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

        * 'propagate': returns nan
        * 'raise': throws an error
        * 'omit': performs the calculations ignoring nan values
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis.
        The following options are available (default is 'two-sided'):

        * 'two-sided': the kurtosis of the distribution underlying the sample
          is different from that of the normal distribution
        * 'less': the kurtosis of the distribution underlying the sample
          is less than that of the normal distribution
        * 'greater': the kurtosis of the distribution underlying the sample
          is greater than that of the normal distribution

        .. versionadded:: 1.7.0

    Returns
    -------
    statistic : float
        The computed z-score for this test.
    pvalue : float
        The p-value for the hypothesis test.

    See Also
    --------
    :ref:`hypothesis_kurtosistest` : Extended example

    Notes
    -----
    Valid only for n>20. This function uses the method described in [1]_.

    References
    ----------
    .. [1] F. J. Anscombe, W. J. Glynn, "Distribution of the kurtosis
       statistic b2 for normal samples", Biometrika, vol. 70, pp. 227-234, 1983.

    Examples
    --------

    >>> import numpy as np
    >>> from scipy.stats import kurtosistest
    >>> kurtosistest(list(range(20)))
    KurtosistestResult(statistic=-1.7058104152122062, pvalue=0.08804338332528348)
    >>> kurtosistest(list(range(20)), alternative='less')
    KurtosistestResult(statistic=-1.7058104152122062, pvalue=0.04402169166264174)
    >>> kurtosistest(list(range(20)), alternative='greater')
    KurtosistestResult(statistic=-1.7058104152122062, pvalue=0.9559783083373583)
    >>> rng = np.random.default_rng()
    >>> s = rng.normal(0, 1, 1000)
    >>> kurtosistest(s)
    KurtosistestResult(statistic=-1.475047944490622, pvalue=0.14019965402996987)

    For a more detailed example, see :ref:`hypothesis_kurtosistest`.
    """
    xp = array_namespace(a)
    a, axis = _chk_asarray(a, axis, xp=xp)

    b2 = kurtosis(a, axis, fisher=False, _no_deco=True)

    n = xp.asarray(_length_nonmasked(a, axis), dtype=b2.dtype)
    n = xpx.at(n, n < 5).set(xp.nan)
    if xp.any(xp.isnan(n)):
        message = ("`kurtosistest` requires at least 5 valid observations; "
                   "slices with fewer observations will produce NaNs.")
        warnings.warn(message, SmallSampleWarning, stacklevel=2)

    E = 3.0*(n-1) / (n+1)
    varb2 = 24.0*n*(n-2)*(n-3) / ((n+1)*(n+1.)*(n+3)*(n+5))  # [1]_ Eq. 1
    x = (b2-E) / varb2**0.5  # [1]_ Eq. 4
    # [1]_ Eq. 2:
    sqrtbeta1 = 6.0*(n*n-5*n+2)/((n+7)*(n+9)) * ((6.0*(n+3)*(n+5))
                                                 / (n*(n-2)*(n-3)))**0.5
    # [1]_ Eq. 3:
    A = 6.0 + 8.0/sqrtbeta1 * (2.0/sqrtbeta1 + (1+4.0/(sqrtbeta1**2))**0.5)
    term1 = 1 - 2/(9.0*A)
    denom = 1 + x * (2/(A-4.0))**0.5
    term2 = xp.sign(denom) * xp.where(denom == 0.0, xp.nan,
                                      ((1-2.0/A)/xp.abs(denom))**(1/3))
    if xp.any(denom == 0):
        msg = ("Test statistic not defined in some cases due to division by "
               "zero. Return nan in that case...")
        warnings.warn(msg, RuntimeWarning, stacklevel=2)

    Z = (term1 - term2) / (2/(9.0*A))**0.5  # [1]_ Eq. 5
    pvalue = _get_pvalue(Z, _SimpleNormal(), alternative, xp=xp)

    Z = Z[()] if Z.ndim == 0 else Z
    pvalue = pvalue[()] if pvalue.ndim == 0 else pvalue
    return KurtosistestResult(Z, pvalue)


NormaltestResult = namedtuple('NormaltestResult', ('statistic', 'pvalue'))


@xp_capabilities(jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(NormaltestResult, n_samples=1, too_small=7)
def normaltest(a, axis=0, nan_policy='propagate'):
    r"""Test whether a sample differs from a normal distribution.

    This function tests the null hypothesis that a sample comes
    from a normal distribution.  It is based on D'Agostino and
    Pearson's [1]_, [2]_ test that combines skew and kurtosis to
    produce an omnibus test of normality.

    Parameters
    ----------
    a : array_like
        The array containing the sample to be tested. Must contain
        at least eight observations.
    axis : int or None, optional
        Axis along which to compute test. Default is 0. If None,
        compute over the whole array `a`.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

            * 'propagate': returns nan
            * 'raise': throws an error
            * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    statistic : float or array
        ``s^2 + k^2``, where ``s`` is the z-score returned by `skewtest` and
        ``k`` is the z-score returned by `kurtosistest`.
    pvalue : float or array
        A 2-sided chi squared probability for the hypothesis test.

    See Also
    --------
    :ref:`hypothesis_normaltest` : Extended example

    References
    ----------
    .. [1] D'Agostino, R. B. (1971), "An omnibus test of normality for
            moderate and large sample size", Biometrika, 58, 341-348
    .. [2] D'Agostino, R. and Pearson, E. S. (1973), "Tests for departure from
            normality", Biometrika, 60, 613-622

    Examples
    --------

    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng()
    >>> pts = 1000
    >>> a = rng.normal(0, 1, size=pts)
    >>> b = rng.normal(2, 1, size=pts)
    >>> x = np.concatenate((a, b))
    >>> res = stats.normaltest(x)
    >>> res.statistic
    53.619...  # random
    >>> res.pvalue
    2.273917413209226e-12  # random

    For a more detailed example, see :ref:`hypothesis_normaltest`.
    """
    xp = array_namespace(a)

    s, _ = skewtest(a, axis, _no_deco=True)
    k, _ = kurtosistest(a, axis, _no_deco=True)
    statistic = s*s + k*k

    chi2 = _SimpleChi2(xp.asarray(2., dtype=statistic.dtype))
    pvalue = _get_pvalue(statistic, chi2, alternative='greater', symmetric=False, xp=xp)

    statistic = statistic[()] if statistic.ndim == 0 else statistic
    pvalue = pvalue[()] if pvalue.ndim == 0 else pvalue

    return NormaltestResult(statistic, pvalue)


@xp_capabilities(jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(SignificanceResult, default_axis=None)
def jarque_bera(x, *, axis=None):
    r"""Perform the Jarque-Bera goodness of fit test on sample data.

    The Jarque-Bera test tests whether the sample data has the skewness and
    kurtosis matching a normal distribution.

    Note that this test only works for a large enough number of data samples
    (>2000) as the test statistic asymptotically has a Chi-squared distribution
    with 2 degrees of freedom.

    Parameters
    ----------
    x : array_like
        Observations of a random variable.
    axis : int or None, default: 0
        If an int, the axis of the input along which to compute the statistic.
        The statistic of each axis-slice (e.g. row) of the input will appear in
        a corresponding element of the output.
        If ``None``, the input will be raveled before computing the statistic.

    Returns
    -------
    result : SignificanceResult
        An object with the following attributes:

        statistic : float
            The test statistic.
        pvalue : float
            The p-value for the hypothesis test.

    See Also
    --------
    :ref:`hypothesis_jarque_bera` : Extended example

    References
    ----------
    .. [1] Jarque, C. and Bera, A. (1980) "Efficient tests for normality,
           homoscedasticity and serial independence of regression residuals",
           6 Econometric Letters 255-259.

    Examples
    --------

    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng()
    >>> x = rng.normal(0, 1, 100000)
    >>> jarque_bera_test = stats.jarque_bera(x)
    >>> jarque_bera_test
    Jarque_beraResult(statistic=3.3415184718131554, pvalue=0.18810419594996775)
    >>> jarque_bera_test.statistic
    3.3415184718131554
    >>> jarque_bera_test.pvalue
    0.18810419594996775

    For a more detailed example, see :ref:`hypothesis_jarque_bera`.
    """
    xp = array_namespace(x)
    x, axis = _chk_asarray(x, axis, xp=xp)

    mu = _xp_mean(x, axis=axis, keepdims=True)
    diffx = x - mu
    s = skew(diffx, axis=axis, _no_deco=True)
    k = kurtosis(diffx, axis=axis, _no_deco=True)

    n = xp.asarray(_length_nonmasked(x, axis), dtype=mu.dtype)
    statistic = n / 6 * (s**2 + k**2 / 4)

    chi2 = _SimpleChi2(xp.asarray(2., dtype=mu.dtype))
    pvalue = _get_pvalue(statistic, chi2, alternative='greater', symmetric=False, xp=xp)

    statistic = statistic[()] if statistic.ndim == 0 else statistic
    pvalue = pvalue[()] if pvalue.ndim == 0 else pvalue

    return SignificanceResult(statistic, pvalue)


#####################################
#        FREQUENCY FUNCTIONS        #
#####################################


def scoreatpercentile(a, per, limit=(), interpolation_method='fraction',
                      axis=None):
    """Calculate the score at a given percentile of the input sequence.

    For example, the score at ``per=50`` is the median. If the desired quantile
    lies between two data points, we interpolate between them, according to
    the value of `interpolation`. If the parameter `limit` is provided, it
    should be a tuple (lower, upper) of two values.

    Parameters
    ----------
    a : array_like
        A 1-D array of values from which to extract score.
    per : array_like
        Percentile(s) at which to extract score.  Values should be in range
        [0,100].
    limit : tuple, optional
        Tuple of two scalars, the lower and upper limits within which to
        compute the percentile. Values of `a` outside
        this (closed) interval will be ignored.
    interpolation_method : {'fraction', 'lower', 'higher'}, optional
        Specifies the interpolation method to use,
        when the desired quantile lies between two data points `i` and `j`
        The following options are available (default is 'fraction'):

          * 'fraction': ``i + (j - i) * fraction`` where ``fraction`` is the
            fractional part of the index surrounded by ``i`` and ``j``
          * 'lower': ``i``
          * 'higher': ``j``

    axis : int, optional
        Axis along which the percentiles are computed. Default is None. If
        None, compute over the whole array `a`.

    Returns
    -------
    score : float or ndarray
        Score at percentile(s).

    See Also
    --------
    percentileofscore, numpy.percentile

    Notes
    -----
    This function will become obsolete in the future.
    For NumPy 1.9 and higher, `numpy.percentile` provides all the functionality
    that `scoreatpercentile` provides.  And it's significantly faster.
    Therefore it's recommended to use `numpy.percentile` for users that have
    numpy >= 1.9.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> a = np.arange(100)
    >>> stats.scoreatpercentile(a, 50)
    49.5

    """
    # adapted from NumPy's percentile function.  When we require numpy >= 1.8,
    # the implementation of this function can be replaced by np.percentile.
    a = np.asarray(a)
    if a.size == 0:
        # empty array, return nan(s) with shape matching `per`
        if np.isscalar(per):
            return np.nan
        else:
            return np.full(np.asarray(per).shape, np.nan, dtype=np.float64)

    if limit:
        a = a[(limit[0] <= a) & (a <= limit[1])]

    sorted_ = np.sort(a, axis=axis)
    if axis is None:
        axis = 0

    return _compute_qth_percentile(sorted_, per, interpolation_method, axis)


# handle sequence of per's without calling sort multiple times
def _compute_qth_percentile(sorted_, per, interpolation_method, axis):
    if not np.isscalar(per):
        score = [_compute_qth_percentile(sorted_, i,
                                         interpolation_method, axis)
                 for i in per]
        return np.array(score)

    if not (0 <= per <= 100):
        raise ValueError("percentile must be in the range [0, 100]")

    indexer = [slice(None)] * sorted_.ndim
    idx = per / 100. * (sorted_.shape[axis] - 1)

    if int(idx) != idx:
        # round fractional indices according to interpolation method
        if interpolation_method == 'lower':
            idx = int(np.floor(idx))
        elif interpolation_method == 'higher':
            idx = int(np.ceil(idx))
        elif interpolation_method == 'fraction':
            pass  # keep idx as fraction and interpolate
        else:
            raise ValueError("interpolation_method can only be 'fraction', "
                             "'lower' or 'higher'")

    i = int(idx)
    if i == idx:
        indexer[axis] = slice(i, i + 1)
        weights = array(1)
        sumval = 1.0
    else:
        indexer[axis] = slice(i, i + 2)
        j = i + 1
        weights = array([(j - idx), (idx - i)], float)
        wshape = [1] * sorted_.ndim
        wshape[axis] = 2
        weights.shape = wshape
        sumval = weights.sum()

    # Use np.add.reduce (== np.sum but a little faster) to coerce data type
    return np.add.reduce(sorted_[tuple(indexer)] * weights, axis=axis) / sumval


def percentileofscore(a, score, kind='rank', nan_policy='propagate'):
    """Compute the percentile rank of a score relative to a list of scores.

    A `percentileofscore` of, for example, 80% means that 80% of the
    scores in `a` are below the given score. In the case of gaps or
    ties, the exact definition depends on the optional keyword, `kind`.

    Parameters
    ----------
    a : array_like
        A 1-D array to which `score` is compared.
    score : array_like
        Scores to compute percentiles for.
    kind : {'rank', 'weak', 'strict', 'mean'}, optional
        Specifies the interpretation of the resulting score.
        The following options are available (default is 'rank'):

          * 'rank': Average percentage ranking of score.  In case of multiple
            matches, average the percentage rankings of all matching scores.
          * 'weak': This kind corresponds to the definition of a cumulative
            distribution function.  A percentileofscore of 80% means that 80%
            of values are less than or equal to the provided score.
          * 'strict': Similar to "weak", except that only values that are
            strictly less than the given score are counted.
          * 'mean': The average of the "weak" and "strict" scores, often used
            in testing.  See https://en.wikipedia.org/wiki/Percentile_rank
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Specifies how to treat `nan` values in `a`.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan (for each value in `score`).
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    pcos : float
        Percentile-position of score (0-100) relative to `a`.

    See Also
    --------
    numpy.percentile
    scipy.stats.scoreatpercentile, scipy.stats.rankdata

    Examples
    --------
    Three-quarters of the given values lie below a given score:

    >>> import numpy as np
    >>> from scipy import stats
    >>> stats.percentileofscore([1, 2, 3, 4], 3)
    75.0

    With multiple matches, note how the scores of the two matches, 0.6
    and 0.8 respectively, are averaged:

    >>> stats.percentileofscore([1, 2, 3, 3, 4], 3)
    70.0

    Only 2/5 values are strictly less than 3:

    >>> stats.percentileofscore([1, 2, 3, 3, 4], 3, kind='strict')
    40.0

    But 4/5 values are less than or equal to 3:

    >>> stats.percentileofscore([1, 2, 3, 3, 4], 3, kind='weak')
    80.0

    The average between the weak and the strict scores is:

    >>> stats.percentileofscore([1, 2, 3, 3, 4], 3, kind='mean')
    60.0

    Score arrays (of any dimensionality) are supported:

    >>> stats.percentileofscore([1, 2, 3, 3, 4], [2, 3])
    array([40., 70.])

    The inputs can be infinite:

    >>> stats.percentileofscore([-np.inf, 0, 1, np.inf], [1, 2, np.inf])
    array([75., 75., 100.])

    If `a` is empty, then the resulting percentiles are all `nan`:

    >>> stats.percentileofscore([], [1, 2])
    array([nan, nan])
    """

    a = np.asarray(a)
    n = len(a)
    score = np.asarray(score)

    # Nan treatment
    cna = _contains_nan(a, nan_policy)
    cns = _contains_nan(score, nan_policy)

    if cns:
        # If a score is nan, then the output should be nan
        # (also if nan_policy is "omit", because it only applies to `a`)
        score = ma.masked_where(np.isnan(score), score)

    if cna:
        if nan_policy == "omit":
            # Don't count nans
            a = ma.masked_where(np.isnan(a), a)
            n = a.count()

        if nan_policy == "propagate":
            # All outputs should be nans
            n = 0

    # Cannot compare to empty list ==> nan
    if n == 0:
        perct = np.full_like(score, np.nan, dtype=np.float64)

    else:
        # Prepare broadcasting
        score = score[..., None]

        def count(x):
            return np.count_nonzero(x, -1)

        # Main computations/logic
        if kind == 'rank':
            left = count(a < score)
            right = count(a <= score)
            plus1 = left < right
            perct = (left + right + plus1) * (50.0 / n)
        elif kind == 'strict':
            perct = count(a < score) * (100.0 / n)
        elif kind == 'weak':
            perct = count(a <= score) * (100.0 / n)
        elif kind == 'mean':
            left = count(a < score)
            right = count(a <= score)
            perct = (left + right) * (50.0 / n)
        else:
            raise ValueError(
                "kind can only be 'rank', 'strict', 'weak' or 'mean'")

    # Re-insert nan values
    perct = ma.filled(perct, np.nan)

    if perct.ndim == 0:
        return perct[()]
    return perct


HistogramResult = namedtuple('HistogramResult',
                             ('count', 'lowerlimit', 'binsize', 'extrapoints'))


def _histogram(a, numbins=10, defaultlimits=None, weights=None,
               printextras=False):
    """Create a histogram.

    Separate the range into several bins and return the number of instances
    in each bin.

    Parameters
    ----------
    a : array_like
        Array of scores which will be put into bins.
    numbins : int, optional
        The number of bins to use for the histogram. Default is 10.
    defaultlimits : tuple (lower, upper), optional
        The lower and upper values for the range of the histogram.
        If no value is given, a range slightly larger than the range of the
        values in a is used. Specifically ``(a.min() - s, a.max() + s)``,
        where ``s = (1/2)(a.max() - a.min()) / (numbins - 1)``.
    weights : array_like, optional
        The weights for each value in `a`. Default is None, which gives each
        value a weight of 1.0
    printextras : bool, optional
        If True, if there are extra points (i.e. the points that fall outside
        the bin limits) a warning is raised saying how many of those points
        there are.  Default is False.

    Returns
    -------
    count : ndarray
        Number of points (or sum of weights) in each bin.
    lowerlimit : float
        Lowest value of histogram, the lower limit of the first bin.
    binsize : float
        The size of the bins (all bins have the same size).
    extrapoints : int
        The number of points outside the range of the histogram.

    See Also
    --------
    numpy.histogram

    Notes
    -----
    This histogram is based on numpy's histogram but has a larger range by
    default if default limits is not set.

    """
    a = np.ravel(a)
    if defaultlimits is None:
        if a.size == 0:
            # handle empty arrays. Undetermined range, so use 0-1.
            defaultlimits = (0, 1)
        else:
            # no range given, so use values in `a`
            data_min = a.min()
            data_max = a.max()
            # Have bins extend past min and max values slightly
            s = (data_max - data_min) / (2. * (numbins - 1.))
            defaultlimits = (data_min - s, data_max + s)

    # use numpy's histogram method to compute bins
    hist, bin_edges = np.histogram(a, bins=numbins, range=defaultlimits,
                                   weights=weights)
    # hist are not always floats, convert to keep with old output
    hist = np.array(hist, dtype=float)
    # fixed width for bins is assumed, as numpy's histogram gives
    # fixed width bins for int values for 'bins'
    binsize = bin_edges[1] - bin_edges[0]
    # calculate number of extra points
    extrapoints = len([v for v in a
                       if defaultlimits[0] > v or v > defaultlimits[1]])
    if extrapoints > 0 and printextras:
        warnings.warn(f"Points outside given histogram range = {extrapoints}",
                      stacklevel=3,)

    return HistogramResult(hist, defaultlimits[0], binsize, extrapoints)


CumfreqResult = namedtuple('CumfreqResult',
                           ('cumcount', 'lowerlimit', 'binsize',
                            'extrapoints'))


def cumfreq(a, numbins=10, defaultreallimits=None, weights=None):
    """Return a cumulative frequency histogram, using the histogram function.

    A cumulative histogram is a mapping that counts the cumulative number of
    observations in all of the bins up to the specified bin.

    Parameters
    ----------
    a : array_like
        Input array.
    numbins : int, optional
        The number of bins to use for the histogram. Default is 10.
    defaultreallimits : tuple (lower, upper), optional
        The lower and upper values for the range of the histogram.
        If no value is given, a range slightly larger than the range of the
        values in `a` is used. Specifically ``(a.min() - s, a.max() + s)``,
        where ``s = (1/2)(a.max() - a.min()) / (numbins - 1)``.
    weights : array_like, optional
        The weights for each value in `a`. Default is None, which gives each
        value a weight of 1.0

    Returns
    -------
    cumcount : ndarray
        Binned values of cumulative frequency.
    lowerlimit : float
        Lower real limit
    binsize : float
        Width of each bin.
    extrapoints : int
        Extra points.

    Examples
    --------
    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy import stats
    >>> rng = np.random.default_rng()
    >>> x = [1, 4, 2, 1, 3, 1]
    >>> res = stats.cumfreq(x, numbins=4, defaultreallimits=(1.5, 5))
    >>> res.cumcount
    array([ 1.,  2.,  3.,  3.])
    >>> res.extrapoints
    3

    Create a normal distribution with 1000 random values

    >>> samples = stats.norm.rvs(size=1000, random_state=rng)

    Calculate cumulative frequencies

    >>> res = stats.cumfreq(samples, numbins=25)

    Calculate space of values for x

    >>> x = res.lowerlimit + np.linspace(0, res.binsize*res.cumcount.size,
    ...                                  res.cumcount.size)

    Plot histogram and cumulative histogram

    >>> fig = plt.figure(figsize=(10, 4))
    >>> ax1 = fig.add_subplot(1, 2, 1)
    >>> ax2 = fig.add_subplot(1, 2, 2)
    >>> ax1.hist(samples, bins=25)
    >>> ax1.set_title('Histogram')
    >>> ax2.bar(x, res.cumcount, width=res.binsize)
    >>> ax2.set_title('Cumulative histogram')
    >>> ax2.set_xlim([x.min(), x.max()])

    >>> plt.show()

    """
    h, l, b, e = _histogram(a, numbins, defaultreallimits, weights=weights)
    cumhist = np.cumsum(h * 1, axis=0)
    return CumfreqResult(cumhist, l, b, e)


RelfreqResult = namedtuple('RelfreqResult',
                           ('frequency', 'lowerlimit', 'binsize',
                            'extrapoints'))


def relfreq(a, numbins=10, defaultreallimits=None, weights=None):
    """Return a relative frequency histogram, using the histogram function.

    A relative frequency  histogram is a mapping of the number of
    observations in each of the bins relative to the total of observations.

    Parameters
    ----------
    a : array_like
        Input array.
    numbins : int, optional
        The number of bins to use for the histogram. Default is 10.
    defaultreallimits : tuple (lower, upper), optional
        The lower and upper values for the range of the histogram.
        If no value is given, a range slightly larger than the range of the
        values in a is used. Specifically ``(a.min() - s, a.max() + s)``,
        where ``s = (1/2)(a.max() - a.min()) / (numbins - 1)``.
    weights : array_like, optional
        The weights for each value in `a`. Default is None, which gives each
        value a weight of 1.0

    Returns
    -------
    frequency : ndarray
        Binned values of relative frequency.
    lowerlimit : float
        Lower real limit.
    binsize : float
        Width of each bin.
    extrapoints : int
        Extra points.

    Examples
    --------
    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy import stats
    >>> rng = np.random.default_rng()
    >>> a = np.array([2, 4, 1, 2, 3, 2])
    >>> res = stats.relfreq(a, numbins=4)
    >>> res.frequency
    array([ 0.16666667, 0.5       , 0.16666667,  0.16666667])
    >>> np.sum(res.frequency)  # relative frequencies should add up to 1
    1.0

    Create a normal distribution with 1000 random values

    >>> samples = stats.norm.rvs(size=1000, random_state=rng)

    Calculate relative frequencies

    >>> res = stats.relfreq(samples, numbins=25)

    Calculate space of values for x

    >>> x = res.lowerlimit + np.linspace(0, res.binsize*res.frequency.size,
    ...                                  res.frequency.size)

    Plot relative frequency histogram

    >>> fig = plt.figure(figsize=(5, 4))
    >>> ax = fig.add_subplot(1, 1, 1)
    >>> ax.bar(x, res.frequency, width=res.binsize)
    >>> ax.set_title('Relative frequency histogram')
    >>> ax.set_xlim([x.min(), x.max()])

    >>> plt.show()

    """
    a = np.asanyarray(a)
    h, l, b, e = _histogram(a, numbins, defaultreallimits, weights=weights)
    h = h / a.shape[0]

    return RelfreqResult(h, l, b, e)


#####################################
#        VARIABILITY FUNCTIONS      #
#####################################

def obrientransform(*samples):
    """Compute the O'Brien transform on input data (any number of arrays).

    Used to test for homogeneity of variance prior to running one-way stats.
    Each array in ``*samples`` is one level of a factor.
    If `f_oneway` is run on the transformed data and found significant,
    the variances are unequal.  From Maxwell and Delaney [1]_, p.112.

    Parameters
    ----------
    sample1, sample2, ... : array_like
        Any number of arrays.

    Returns
    -------
    obrientransform : ndarray
        Transformed data for use in an ANOVA.  The first dimension
        of the result corresponds to the sequence of transformed
        arrays.  If the arrays given are all 1-D of the same length,
        the return value is a 2-D array; otherwise it is a 1-D array
        of type object, with each element being an ndarray.

    Raises
    ------
    ValueError
        If the mean of the transformed data is not equal to the original
        variance, indicating a lack of convergence in the O'Brien transform.

    References
    ----------
    .. [1] S. E. Maxwell and H. D. Delaney, "Designing Experiments and
           Analyzing Data: A Model Comparison Perspective", Wadsworth, 1990.

    Examples
    --------
    We'll test the following data sets for differences in their variance.

    >>> x = [10, 11, 13, 9, 7, 12, 12, 9, 10]
    >>> y = [13, 21, 5, 10, 8, 14, 10, 12, 7, 15]

    Apply the O'Brien transform to the data.

    >>> from scipy.stats import obrientransform
    >>> tx, ty = obrientransform(x, y)

    Use `scipy.stats.f_oneway` to apply a one-way ANOVA test to the
    transformed data.

    >>> from scipy.stats import f_oneway
    >>> F, p = f_oneway(tx, ty)
    >>> p
    0.1314139477040335

    If we require that ``p < 0.05`` for significance, we cannot conclude
    that the variances are different.

    """
    TINY = np.sqrt(np.finfo(float).eps)

    # `arrays` will hold the transformed arguments.
    arrays = []
    sLast = None

    for sample in samples:
        a = np.asarray(sample)
        n = len(a)
        mu = np.mean(a)
        sq = (a - mu)**2
        sumsq = sq.sum()

        # The O'Brien transform.
        t = ((n - 1.5) * n * sq - 0.5 * sumsq) / ((n - 1) * (n - 2))

        # Check that the mean of the transformed data is equal to the
        # original variance.
        var = sumsq / (n - 1)
        if abs(var - np.mean(t)) > TINY:
            raise ValueError('Lack of convergence in obrientransform.')

        arrays.append(t)
        sLast = a.shape

    if sLast:
        for arr in arrays[:-1]:
            if sLast != arr.shape:
                return np.array(arrays, dtype=object)
    return np.array(arrays)


@xp_capabilities()
@_axis_nan_policy_factory(
    lambda x: x, result_to_tuple=lambda x, _: (x,), n_outputs=1, too_small=1
)
def sem(a, axis=0, ddof=1, nan_policy='propagate'):
    """Compute standard error of the mean.

    Calculate the standard error of the mean (or standard error of
    measurement) of the values in the input array.

    Parameters
    ----------
    a : array_like
        An array containing the values for which the standard error is
        returned. Must contain at least two observations.
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over
        the whole array `a`.
    ddof : int, optional
        Delta degrees-of-freedom. How many degrees of freedom to adjust
        for bias in limited samples relative to the population estimate
        of variance. Defaults to 1.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    s : ndarray or float
        The standard error of the mean in the sample(s), along the input axis.

    Notes
    -----
    The default value for `ddof` is different to the default (0) used by other
    ddof containing routines, such as np.std and np.nanstd.

    Examples
    --------
    Find standard error along the first axis:

    >>> import numpy as np
    >>> from scipy import stats
    >>> a = np.arange(20).reshape(5,4)
    >>> stats.sem(a)
    array([ 2.8284,  2.8284,  2.8284,  2.8284])

    Find standard error across the whole array, using n degrees of freedom:

    >>> stats.sem(a, axis=None, ddof=0)
    1.2893796958227628

    """
    xp = array_namespace(a)
    if axis is None:
        a = xp.reshape(a, (-1,))
        axis = 0
    a = xpx.atleast_nd(xp.asarray(a), ndim=1, xp=xp)
    n = _length_nonmasked(a, axis, xp=xp)
    s = xp.std(a, axis=axis, correction=ddof) / n**0.5
    return s


def _isconst(x):
    """
    Check if all values in x are the same.  nans are ignored.

    x must be a 1d array.

    The return value is a 1d array with length 1, so it can be used
    in np.apply_along_axis.
    """
    y = x[~np.isnan(x)]
    if y.size == 0:
        return np.array([True])
    else:
        return (y[0] == y).all(keepdims=True)


@xp_capabilities()
def zscore(a, axis=0, ddof=0, nan_policy='propagate'):
    """
    Compute the z score.

    Compute the z score of each value in the sample, relative to the
    sample mean and standard deviation.

    Parameters
    ----------
    a : array_like
        An array like object containing the sample data.
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over
        the whole array `a`.
    ddof : int, optional
        Degrees of freedom correction in the calculation of the
        standard deviation. Default is 0.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan. 'propagate' returns nan,
        'raise' throws an error, 'omit' performs the calculations ignoring nan
        values. Default is 'propagate'.  Note that when the value is 'omit',
        nans in the input also propagate to the output, but they do not affect
        the z-scores computed for the non-nan values.

    Returns
    -------
    zscore : array_like
        The z-scores, standardized by mean and standard deviation of
        input array `a`.

    See Also
    --------
    numpy.mean : Arithmetic average
    numpy.std : Arithmetic standard deviation
    scipy.stats.gzscore : Geometric standard score

    Notes
    -----
    This function preserves ndarray subclasses, and works also with
    matrices and masked arrays (it uses `asanyarray` instead of
    `asarray` for parameters).

    References
    ----------
    .. [1] "Standard score", *Wikipedia*,
           https://en.wikipedia.org/wiki/Standard_score.
    .. [2] Huck, S. W., Cross, T. L., Clark, S. B, "Overcoming misconceptions
           about Z-scores", Teaching Statistics, vol. 8, pp. 38-40, 1986

    Examples
    --------
    >>> import numpy as np
    >>> a = np.array([ 0.7972,  0.0767,  0.4383,  0.7866,  0.8091,
    ...                0.1954,  0.6307,  0.6599,  0.1065,  0.0508])
    >>> from scipy import stats
    >>> stats.zscore(a)
    array([ 1.1273, -1.247 , -0.0552,  1.0923,  1.1664, -0.8559,  0.5786,
            0.6748, -1.1488, -1.3324])

    Computing along a specified axis, using n-1 degrees of freedom
    (``ddof=1``) to calculate the standard deviation:

    >>> b = np.array([[ 0.3148,  0.0478,  0.6243,  0.4608],
    ...               [ 0.7149,  0.0775,  0.6072,  0.9656],
    ...               [ 0.6341,  0.1403,  0.9759,  0.4064],
    ...               [ 0.5918,  0.6948,  0.904 ,  0.3721],
    ...               [ 0.0921,  0.2481,  0.1188,  0.1366]])
    >>> stats.zscore(b, axis=1, ddof=1)
    array([[-0.19264823, -1.28415119,  1.07259584,  0.40420358],
           [ 0.33048416, -1.37380874,  0.04251374,  1.00081084],
           [ 0.26796377, -1.12598418,  1.23283094, -0.37481053],
           [-0.22095197,  0.24468594,  1.19042819, -1.21416216],
           [-0.82780366,  1.4457416 , -0.43867764, -0.1792603 ]])

    An example with ``nan_policy='omit'``:

    >>> x = np.array([[25.11, 30.10, np.nan, 32.02, 43.15],
    ...               [14.95, 16.06, 121.25, 94.35, 29.81]])
    >>> stats.zscore(x, axis=1, nan_policy='omit')
    array([[-1.13490897, -0.37830299,         nan, -0.08718406,  1.60039602],
           [-0.91611681, -0.89090508,  1.4983032 ,  0.88731639, -0.5785977 ]])
    """
    return zmap(a, a, axis=axis, ddof=ddof, nan_policy=nan_policy)


@xp_capabilities()
def gzscore(a, *, axis=0, ddof=0, nan_policy='propagate'):
    """
    Compute the geometric standard score.

    Compute the geometric z score of each strictly positive value in the
    sample, relative to the geometric mean and standard deviation.
    Mathematically the geometric z score can be evaluated as::

        gzscore = log(a/gmu) / log(gsigma)

    where ``gmu`` (resp. ``gsigma``) is the geometric mean (resp. standard
    deviation).

    Parameters
    ----------
    a : array_like
        Sample data.
    axis : int or None, optional
        Axis along which to operate. Default is 0. If None, compute over
        the whole array `a`.
    ddof : int, optional
        Degrees of freedom correction in the calculation of the
        standard deviation. Default is 0.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan. 'propagate' returns nan,
        'raise' throws an error, 'omit' performs the calculations ignoring nan
        values. Default is 'propagate'.  Note that when the value is 'omit',
        nans in the input also propagate to the output, but they do not affect
        the geometric z scores computed for the non-nan values.

    Returns
    -------
    gzscore : array_like
        The geometric z scores, standardized by geometric mean and geometric
        standard deviation of input array `a`.

    See Also
    --------
    gmean : Geometric mean
    gstd : Geometric standard deviation
    zscore : Standard score

    Notes
    -----
    This function preserves ndarray subclasses, and works also with
    matrices and masked arrays (it uses ``asanyarray`` instead of
    ``asarray`` for parameters).

    .. versionadded:: 1.8

    References
    ----------
    .. [1] "Geometric standard score", *Wikipedia*,
           https://en.wikipedia.org/wiki/Geometric_standard_deviation#Geometric_standard_score.

    Examples
    --------
    Draw samples from a log-normal distribution:

    >>> import numpy as np
    >>> from scipy.stats import zscore, gzscore
    >>> import matplotlib.pyplot as plt

    >>> rng = np.random.default_rng()
    >>> mu, sigma = 3., 1.  # mean and standard deviation
    >>> x = rng.lognormal(mu, sigma, size=500)

    Display the histogram of the samples:

    >>> fig, ax = plt.subplots()
    >>> ax.hist(x, 50)
    >>> plt.show()

    Display the histogram of the samples standardized by the classical zscore.
    Distribution is rescaled but its shape is unchanged.

    >>> fig, ax = plt.subplots()
    >>> ax.hist(zscore(x), 50)
    >>> plt.show()

    Demonstrate that the distribution of geometric zscores is rescaled and
    quasinormal:

    >>> fig, ax = plt.subplots()
    >>> ax.hist(gzscore(x), 50)
    >>> plt.show()

    """
    xp = array_namespace(a)
    a = xp_promote(a, force_floating=True, xp=xp)
    log = ma.log if isinstance(a, ma.MaskedArray) else xp.log
    return zscore(log(a), axis=axis, ddof=ddof, nan_policy=nan_policy)


@xp_capabilities()
def zmap(scores, compare, axis=0, ddof=0, nan_policy='propagate'):
    """
    Calculate the relative z-scores.

    Return an array of z-scores, i.e., scores that are standardized to
    zero mean and unit variance, where mean and variance are calculated
    from the comparison array.

    Parameters
    ----------
    scores : array_like
        The input for which z-scores are calculated.
    compare : array_like
        The input from which the mean and standard deviation of the
        normalization are taken; assumed to have the same dimension as
        `scores`.
    axis : int or None, optional
        Axis over which mean and variance of `compare` are calculated.
        Default is 0. If None, compute over the whole array `scores`.
    ddof : int, optional
        Degrees of freedom correction in the calculation of the
        standard deviation. Default is 0.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle the occurrence of nans in `compare`.
        'propagate' returns nan, 'raise' raises an exception, 'omit'
        performs the calculations ignoring nan values. Default is
        'propagate'. Note that when the value is 'omit', nans in `scores`
        also propagate to the output, but they do not affect the z-scores
        computed for the non-nan values.

    Returns
    -------
    zscore : array_like
        Z-scores, in the same shape as `scores`.

    Notes
    -----
    This function preserves ndarray subclasses, and works also with
    matrices and masked arrays (it uses `asanyarray` instead of
    `asarray` for parameters).

    Examples
    --------
    >>> from scipy.stats import zmap
    >>> a = [0.5, 2.0, 2.5, 3]
    >>> b = [0, 1, 2, 3, 4]
    >>> zmap(a, b)
    array([-1.06066017,  0.        ,  0.35355339,  0.70710678])

    """
    # The docstring explicitly states that it preserves subclasses.
    # Let's table deprecating that and just get the array API version
    # working.

    like_zscore = (scores is compare)
    xp = array_namespace(scores, compare)
    scores, compare = xp_promote(scores, compare, force_floating=True, xp=xp)

    with warnings.catch_warnings():
        if like_zscore:  # zscore should not emit SmallSampleWarning
            warnings.simplefilter('ignore', SmallSampleWarning)

        mn = _xp_mean(compare, axis=axis, keepdims=True, nan_policy=nan_policy)
        std = _xp_var(compare, axis=axis, correction=ddof,
                      keepdims=True, nan_policy=nan_policy)**0.5

    with np.errstate(invalid='ignore', divide='ignore'):
        z = _demean(scores, mn, axis, xp=xp, precision_warning=False) / std

    # If we know that scores and compare are identical, we can infer that
    # some slices should have NaNs.
    if like_zscore:
        eps = xp.finfo(z.dtype).eps
        zero = std <= xp.abs(eps * mn)
        zero = xp.broadcast_to(zero, z.shape)
        z = xpx.at(z, zero).set(xp.nan)

    return z


@xp_capabilities()
def gstd(a, axis=0, ddof=1, *, keepdims=False, nan_policy='propagate'):
    r"""
    Calculate the geometric standard deviation of an array.

    The geometric standard deviation describes the spread of a set of numbers
    where the geometric mean is preferred. It is a multiplicative factor, and
    so a dimensionless quantity.

    It is defined as the exponential of the standard deviation of the
    natural logarithms of the observations.

    Parameters
    ----------
    a : array_like
        An array containing finite, strictly positive, real numbers.
    axis : int, tuple or None, optional
        Axis along which to operate. Default is 0. If None, compute over
        the whole array `a`.
    ddof : int, optional
        Degree of freedom correction in the calculation of the
        geometric standard deviation. Default is 1.
    keepdims : boolean, optional
        If this is set to ``True``, the axes which are reduced are left
        in the result as dimensions with length one. With this option,
        the result will broadcast correctly against the input array.
    nan_policy : {'propagate', 'omit', 'raise'}, default: 'propagate'
        Defines how to handle input NaNs.

        - ``propagate``: if a NaN is present in the axis slice (e.g. row) along
          which the statistic is computed, the corresponding entry of the output
          will be NaN.
        - ``omit``: NaNs will be omitted when performing the calculation.
          If insufficient data remains in the axis slice along which the
          statistic is computed, the corresponding entry of the output will be
          NaN.
        - ``raise``: if a NaN is present, a ``ValueError`` will be raised.

    Returns
    -------
    gstd : ndarray or float
        An array of the geometric standard deviation. If `axis` is None or `a`
        is a 1d array a float is returned.

    See Also
    --------
    gmean : Geometric mean
    numpy.std : Standard deviation
    gzscore : Geometric standard score

    Notes
    -----
    Mathematically, the sample geometric standard deviation :math:`s_G` can be
    defined in terms of the natural logarithms of the observations
    :math:`y_i = \log(x_i)`:

    .. math::

        s_G = \exp(s), \quad s = \sqrt{\frac{1}{n - d} \sum_{i=1}^n (y_i - \bar y)^2}

    where :math:`n` is the number of observations, :math:`d` is the adjustment `ddof`
    to the degrees of freedom, and :math:`\bar y` denotes the mean of the natural
    logarithms of the observations. Note that the default ``ddof=1`` is different from
    the default value used by similar functions, such as `numpy.std` and `numpy.var`.

    When an observation is infinite, the geometric standard deviation is
    NaN (undefined). Non-positive observations will also produce NaNs in the
    output because the *natural* logarithm (as opposed to the *complex*
    logarithm) is defined and finite only for positive reals.
    The geometric standard deviation is sometimes confused with the exponential
    of the standard deviation, ``exp(std(a))``. Instead, the geometric standard
    deviation is ``exp(std(log(a)))``.

    References
    ----------
    .. [1] "Geometric standard deviation", *Wikipedia*,
           https://en.wikipedia.org/wiki/Geometric_standard_deviation.
    .. [2] Kirkwood, T. B., "Geometric means and measures of dispersion",
           Biometrics, vol. 35, pp. 908-909, 1979

    Examples
    --------
    Find the geometric standard deviation of a log-normally distributed sample.
    Note that the standard deviation of the distribution is one; on a
    log scale this evaluates to approximately ``exp(1)``.

    >>> import numpy as np
    >>> from scipy.stats import gstd
    >>> rng = np.random.default_rng()
    >>> sample = rng.lognormal(mean=0, sigma=1, size=1000)
    >>> gstd(sample)
    2.810010162475324

    Compute the geometric standard deviation of a multidimensional array and
    of a given axis.

    >>> a = np.arange(1, 25).reshape(2, 3, 4)
    >>> gstd(a, axis=None)
    2.2944076136018947
    >>> gstd(a, axis=2)
    array([[1.82424757, 1.22436866, 1.13183117],
           [1.09348306, 1.07244798, 1.05914985]])
    >>> gstd(a, axis=(1,2))
    array([2.12939215, 1.22120169])

    """
    xp = array_namespace(a)
    a = xp_promote(a, force_floating=True, xp=xp)

    kwargs = dict(axis=axis, correction=ddof, keepdims=keepdims, nan_policy=nan_policy)
    with np.errstate(invalid='ignore', divide='ignore'):
        res = xp.exp(_xp_var(xp.log(a), **kwargs)**0.5)

    if not is_lazy_array(a) and xp.any(a <= 0):
        message = ("The geometric standard deviation is only defined if all elements "
                   "are greater than or equal to zero; otherwise, the result is NaN.")
        warnings.warn(message, RuntimeWarning, stacklevel=2)

    return res

# Private dictionary initialized only once at module level
# See https://en.wikipedia.org/wiki/Robust_measures_of_scale
_scale_conversions = {'normal': special.erfinv(0.5) * 2.0 * math.sqrt(2.0)}


@_axis_nan_policy_factory(
    lambda x: x, result_to_tuple=lambda x, _: (x,), n_outputs=1,
    default_axis=None, override={'nan_propagation': False}
)
def iqr(x, axis=None, rng=(25, 75), scale=1.0, nan_policy='propagate',
        interpolation='linear', keepdims=False):
    r"""
    Compute the interquartile range of the data along the specified axis.

    The interquartile range (IQR) is the difference between the 75th and
    25th percentile of the data. It is a measure of the dispersion
    similar to standard deviation or variance, but is much more robust
    against outliers [2]_.

    The ``rng`` parameter allows this function to compute other
    percentile ranges than the actual IQR. For example, setting
    ``rng=(0, 100)`` is equivalent to `numpy.ptp`.

    The IQR of an empty array is `np.nan`.

    .. versionadded:: 0.18.0

    Parameters
    ----------
    x : array_like
        Input array or object that can be converted to an array.
    axis : int or sequence of int, optional
        Axis along which the range is computed. The default is to
        compute the IQR for the entire array.
    rng : Two-element sequence containing floats in range of [0,100] optional
        Percentiles over which to compute the range. Each must be
        between 0 and 100, inclusive. The default is the true IQR:
        ``(25, 75)``. The order of the elements is not important.
    scale : scalar or str or array_like of reals, optional
        The numerical value of scale will be divided out of the final
        result. The following string value is also recognized:

          * 'normal' : Scale by
            :math:`2 \sqrt{2} erf^{-1}(\frac{1}{2}) \approx 1.349`.

        The default is 1.0.
        Array-like `scale` of real dtype is also allowed, as long
        as it broadcasts correctly to the output such that
        ``out / scale`` is a valid operation. The output dimensions
        depend on the input array, `x`, the `axis` argument, and the
        `keepdims` flag.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values
    interpolation : str, optional

        Specifies the interpolation method to use when the percentile
        boundaries lie between two data points ``i`` and ``j``.
        The following options are available (default is 'linear'):

          * 'linear': ``i + (j - i)*fraction``, where ``fraction`` is the
            fractional part of the index surrounded by ``i`` and ``j``.
          * 'lower': ``i``.
          * 'higher': ``j``.
          * 'nearest': ``i`` or ``j`` whichever is nearest.
          * 'midpoint': ``(i + j)/2``.

        For NumPy >= 1.22.0, the additional options provided by the ``method``
        keyword of `numpy.percentile` are also valid.

    keepdims : bool, optional
        If this is set to True, the reduced axes are left in the
        result as dimensions with size one. With this option, the result
        will broadcast correctly against the original array `x`.

    Returns
    -------
    iqr : scalar or ndarray
        If ``axis=None``, a scalar is returned. If the input contains
        integers or floats of smaller precision than ``np.float64``, then the
        output data-type is ``np.float64``. Otherwise, the output data-type is
        the same as that of the input.

    See Also
    --------
    numpy.std, numpy.var

    References
    ----------
    .. [1] "Interquartile range" https://en.wikipedia.org/wiki/Interquartile_range
    .. [2] "Robust measures of scale" https://en.wikipedia.org/wiki/Robust_measures_of_scale
    .. [3] "Quantile" https://en.wikipedia.org/wiki/Quantile

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.stats import iqr
    >>> x = np.array([[10, 7, 4], [3, 2, 1]])
    >>> x
    array([[10,  7,  4],
           [ 3,  2,  1]])
    >>> iqr(x)
    4.0
    >>> iqr(x, axis=0)
    array([ 3.5,  2.5,  1.5])
    >>> iqr(x, axis=1)
    array([ 3.,  1.])
    >>> iqr(x, axis=1, keepdims=True)
    array([[ 3.],
           [ 1.]])

    """
    x = asarray(x)

    # This check prevents percentile from raising an error later. Also, it is
    # consistent with `np.var` and `np.std`.
    if not x.size:
        return _get_nan(x)

    # An error may be raised here, so fail-fast, before doing lengthy
    # computations, even though `scale` is not used until later
    if isinstance(scale, str):
        scale_key = scale.lower()
        if scale_key not in _scale_conversions:
            raise ValueError(f"{scale} not a valid scale for `iqr`")
        scale = _scale_conversions[scale_key]

    # Select the percentile function to use based on nans and policy
    contains_nan = _contains_nan(x, nan_policy)

    if nan_policy == 'omit' and contains_nan:
        percentile_func = np.nanpercentile
    else:
        percentile_func = np.percentile

    if len(rng) != 2:
        raise TypeError("quantile range must be two element sequence")

    if np.isnan(rng).any():
        raise ValueError("range must not contain NaNs")

    rng = sorted(rng)
    pct = percentile_func(x, rng, axis=axis, method=interpolation,
                          keepdims=keepdims)
    out = np.subtract(pct[1], pct[0])

    if scale != 1.0:
        out /= scale

    return out


def _mad_1d(x, center, nan_policy):
    # Median absolute deviation for 1-d array x.
    # This is a helper function for `median_abs_deviation`; it assumes its
    # arguments have been validated already.  In particular,  x must be a
    # 1-d numpy array, center must be callable, and if nan_policy is not
    # 'propagate', it is assumed to be 'omit', because 'raise' is handled
    # in `median_abs_deviation`.
    # No warning is generated if x is empty or all nan.
    isnan = np.isnan(x)
    if isnan.any():
        if nan_policy == 'propagate':
            return np.nan
        x = x[~isnan]
    if x.size == 0:
        # MAD of an empty array is nan.
        return np.nan
    # Edge cases have been handled, so do the basic MAD calculation.
    med = center(x)
    mad = np.median(np.abs(x - med))
    return mad


def median_abs_deviation(x, axis=0, center=np.median, scale=1.0,
                         nan_policy='propagate'):
    r"""
    Compute the median absolute deviation of the data along the given axis.

    The median absolute deviation (MAD, [1]_) computes the median over the
    absolute deviations from the median. It is a measure of dispersion
    similar to the standard deviation but more robust to outliers [2]_.

    The MAD of an empty array is ``np.nan``.

    .. versionadded:: 1.5.0

    Parameters
    ----------
    x : array_like
        Input array or object that can be converted to an array.
    axis : int or None, optional
        Axis along which the range is computed. Default is 0. If None, compute
        the MAD over the entire array.
    center : callable, optional
        A function that will return the central value. The default is to use
        np.median. Any user defined function used will need to have the
        function signature ``func(arr, axis)``.
    scale : scalar or str, optional
        The numerical value of scale will be divided out of the final
        result. The default is 1.0. The string "normal" is also accepted,
        and results in `scale` being the inverse of the standard normal
        quantile function at 0.75, which is approximately 0.67449.
        Array-like scale is also allowed, as long as it broadcasts correctly
        to the output such that ``out / scale`` is a valid operation. The
        output dimensions depend on the input array, `x`, and the `axis`
        argument.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

        * 'propagate': returns nan
        * 'raise': throws an error
        * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    mad : scalar or ndarray
        If ``axis=None``, a scalar is returned. If the input contains
        integers or floats of smaller precision than ``np.float64``, then the
        output data-type is ``np.float64``. Otherwise, the output data-type is
        the same as that of the input.

    See Also
    --------
    numpy.std, numpy.var, numpy.median, scipy.stats.iqr, scipy.stats.tmean,
    scipy.stats.tstd, scipy.stats.tvar

    Notes
    -----
    The `center` argument only affects the calculation of the central value
    around which the MAD is calculated. That is, passing in ``center=np.mean``
    will calculate the MAD around the mean - it will not calculate the *mean*
    absolute deviation.

    The input array may contain `inf`, but if `center` returns `inf`, the
    corresponding MAD for that data will be `nan`.

    References
    ----------
    .. [1] "Median absolute deviation",
           https://en.wikipedia.org/wiki/Median_absolute_deviation
    .. [2] "Robust measures of scale",
           https://en.wikipedia.org/wiki/Robust_measures_of_scale

    Examples
    --------
    When comparing the behavior of `median_abs_deviation` with ``np.std``,
    the latter is affected when we change a single value of an array to have an
    outlier value while the MAD hardly changes:

    >>> import numpy as np
    >>> from scipy import stats
    >>> x = stats.norm.rvs(size=100, scale=1, random_state=123456)
    >>> x.std()
    0.9973906394005013
    >>> stats.median_abs_deviation(x)
    0.82832610097857
    >>> x[0] = 345.6
    >>> x.std()
    34.42304872314415
    >>> stats.median_abs_deviation(x)
    0.8323442311590675

    Axis handling example:

    >>> x = np.array([[10, 7, 4], [3, 2, 1]])
    >>> x
    array([[10,  7,  4],
           [ 3,  2,  1]])
    >>> stats.median_abs_deviation(x)
    array([3.5, 2.5, 1.5])
    >>> stats.median_abs_deviation(x, axis=None)
    2.0

    Scale normal example:

    >>> x = stats.norm.rvs(size=1000000, scale=2, random_state=123456)
    >>> stats.median_abs_deviation(x)
    1.3487398527041636
    >>> stats.median_abs_deviation(x, scale='normal')
    1.9996446978061115

    """
    if not callable(center):
        raise TypeError("The argument 'center' must be callable. The given "
                        f"value {repr(center)} is not callable.")

    # An error may be raised here, so fail-fast, before doing lengthy
    # computations, even though `scale` is not used until later
    if isinstance(scale, str):
        if scale.lower() == 'normal':
            scale = 0.6744897501960817  # special.ndtri(0.75)
        else:
            raise ValueError(f"{scale} is not a valid scale value.")

    x = asarray(x)

    # Consistent with `np.var` and `np.std`.
    if not x.size:
        if axis is None:
            return np.nan
        nan_shape = tuple(item for i, item in enumerate(x.shape) if i != axis)
        if nan_shape == ():
            # Return nan, not array(nan)
            return np.nan
        return np.full(nan_shape, np.nan)

    contains_nan = _contains_nan(x, nan_policy)

    if contains_nan:
        if axis is None:
            mad = _mad_1d(x.ravel(), center, nan_policy)
        else:
            mad = np.apply_along_axis(_mad_1d, axis, x, center, nan_policy)
    else:
        if axis is None:
            med = center(x, axis=None)
            mad = np.median(np.abs(x - med))
        else:
            # Wrap the call to center() in expand_dims() so it acts like
            # keepdims=True was used.
            med = np.expand_dims(center(x, axis=axis), axis)
            mad = np.median(np.abs(x - med), axis=axis)

    return mad / scale


#####################################
#         TRIMMING FUNCTIONS        #
#####################################


SigmaclipResult = namedtuple('SigmaclipResult', ('clipped', 'lower', 'upper'))


def sigmaclip(a, low=4., high=4.):
    """Perform iterative sigma-clipping of array elements.

    Starting from the full sample, all elements outside the critical range are
    removed, i.e. all elements of the input array `c` that satisfy either of
    the following conditions::

        c < mean(c) - std(c)*low
        c > mean(c) + std(c)*high

    The iteration continues with the updated sample until no
    elements are outside the (updated) range.

    Parameters
    ----------
    a : array_like
        Data array, will be raveled if not 1-D.
    low : float, optional
        Lower bound factor of sigma clipping. Default is 4.
    high : float, optional
        Upper bound factor of sigma clipping. Default is 4.

    Returns
    -------
    clipped : ndarray
        Input array with clipped elements removed.
    lower : float
        Lower threshold value use for clipping.
    upper : float
        Upper threshold value use for clipping.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.stats import sigmaclip
    >>> a = np.concatenate((np.linspace(9.5, 10.5, 31),
    ...                     np.linspace(0, 20, 5)))
    >>> fact = 1.5
    >>> c, low, upp = sigmaclip(a, fact, fact)
    >>> c
    array([  9.96666667,  10.        ,  10.03333333,  10.        ])
    >>> c.var(), c.std()
    (0.00055555555555555165, 0.023570226039551501)
    >>> low, c.mean() - fact*c.std(), c.min()
    (9.9646446609406727, 9.9646446609406727, 9.9666666666666668)
    >>> upp, c.mean() + fact*c.std(), c.max()
    (10.035355339059327, 10.035355339059327, 10.033333333333333)

    >>> a = np.concatenate((np.linspace(9.5, 10.5, 11),
    ...                     np.linspace(-100, -50, 3)))
    >>> c, low, upp = sigmaclip(a, 1.8, 1.8)
    >>> (c == np.linspace(9.5, 10.5, 11)).all()
    True

    """
    c = np.asarray(a).ravel()
    delta = 1
    while delta:
        c_std = c.std()
        c_mean = c.mean()
        size = c.size
        critlower = c_mean - c_std * low
        critupper = c_mean + c_std * high
        c = c[(c >= critlower) & (c <= critupper)]
        delta = size - c.size

    return SigmaclipResult(c, critlower, critupper)


def trimboth(a, proportiontocut, axis=0):
    """Slice off a proportion of items from both ends of an array.

    Slice off the passed proportion of items from both ends of the passed
    array (i.e., with `proportiontocut` = 0.1, slices leftmost 10% **and**
    rightmost 10% of scores). The trimmed values are the lowest and
    highest ones.
    Slice off less if proportion results in a non-integer slice index (i.e.
    conservatively slices off `proportiontocut`).

    Parameters
    ----------
    a : array_like
        Data to trim.
    proportiontocut : float
        Proportion (in range 0-1) of total data set to trim of each end.
    axis : int or None, optional
        Axis along which to trim data. Default is 0. If None, compute over
        the whole array `a`.

    Returns
    -------
    out : ndarray
        Trimmed version of array `a`. The order of the trimmed content
        is undefined.

    See Also
    --------
    trim_mean

    Examples
    --------
    Create an array of 10 values and trim 10% of those values from each end:

    >>> import numpy as np
    >>> from scipy import stats
    >>> a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    >>> stats.trimboth(a, 0.1)
    array([1, 3, 2, 4, 5, 6, 7, 8])

    Note that the elements of the input array are trimmed by value, but the
    output array is not necessarily sorted.

    The proportion to trim is rounded down to the nearest integer. For
    instance, trimming 25% of the values from each end of an array of 10
    values will return an array of 6 values:

    >>> b = np.arange(10)
    >>> stats.trimboth(b, 1/4).shape
    (6,)

    Multidimensional arrays can be trimmed along any axis or across the entire
    array:

    >>> c = [2, 4, 6, 8, 0, 1, 3, 5, 7, 9]
    >>> d = np.array([a, b, c])
    >>> stats.trimboth(d, 0.4, axis=0).shape
    (1, 10)
    >>> stats.trimboth(d, 0.4, axis=1).shape
    (3, 2)
    >>> stats.trimboth(d, 0.4, axis=None).shape
    (6,)

    """
    a = np.asarray(a)

    if a.size == 0:
        return a

    if axis is None:
        a = a.ravel()
        axis = 0

    nobs = a.shape[axis]
    lowercut = int(proportiontocut * nobs)
    uppercut = nobs - lowercut
    if (lowercut >= uppercut):
        raise ValueError("Proportion too big.")

    atmp = np.partition(a, (lowercut, uppercut - 1), axis)

    sl = [slice(None)] * atmp.ndim
    sl[axis] = slice(lowercut, uppercut)
    return atmp[tuple(sl)]


def trim1(a, proportiontocut, tail='right', axis=0):
    """Slice off a proportion from ONE end of the passed array distribution.

    If `proportiontocut` = 0.1, slices off 'leftmost' or 'rightmost'
    10% of scores. The lowest or highest values are trimmed (depending on
    the tail).
    Slice off less if proportion results in a non-integer slice index
    (i.e. conservatively slices off `proportiontocut` ).

    Parameters
    ----------
    a : array_like
        Input array.
    proportiontocut : float
        Fraction to cut off of 'left' or 'right' of distribution.
    tail : {'left', 'right'}, optional
        Defaults to 'right'.
    axis : int or None, optional
        Axis along which to trim data. Default is 0. If None, compute over
        the whole array `a`.

    Returns
    -------
    trim1 : ndarray
        Trimmed version of array `a`. The order of the trimmed content is
        undefined.

    Examples
    --------
    Create an array of 10 values and trim 20% of its lowest values:

    >>> import numpy as np
    >>> from scipy import stats
    >>> a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    >>> stats.trim1(a, 0.2, 'left')
    array([2, 4, 3, 5, 6, 7, 8, 9])

    Note that the elements of the input array are trimmed by value, but the
    output array is not necessarily sorted.

    The proportion to trim is rounded down to the nearest integer. For
    instance, trimming 25% of the values from an array of 10 values will
    return an array of 8 values:

    >>> b = np.arange(10)
    >>> stats.trim1(b, 1/4).shape
    (8,)

    Multidimensional arrays can be trimmed along any axis or across the entire
    array:

    >>> c = [2, 4, 6, 8, 0, 1, 3, 5, 7, 9]
    >>> d = np.array([a, b, c])
    >>> stats.trim1(d, 0.8, axis=0).shape
    (1, 10)
    >>> stats.trim1(d, 0.8, axis=1).shape
    (3, 2)
    >>> stats.trim1(d, 0.8, axis=None).shape
    (6,)

    """
    a = np.asarray(a)
    if axis is None:
        a = a.ravel()
        axis = 0

    nobs = a.shape[axis]

    # avoid possible corner case
    if proportiontocut >= 1:
        return []

    if tail.lower() == 'right':
        lowercut = 0
        uppercut = nobs - int(proportiontocut * nobs)

    elif tail.lower() == 'left':
        lowercut = int(proportiontocut * nobs)
        uppercut = nobs

    atmp = np.partition(a, (lowercut, uppercut - 1), axis)

    sl = [slice(None)] * atmp.ndim
    sl[axis] = slice(lowercut, uppercut)
    return atmp[tuple(sl)]


def trim_mean(a, proportiontocut, axis=0):
    """Return mean of array after trimming a specified fraction of extreme values

    Removes the specified proportion of elements from *each* end of the
    sorted array, then computes the mean of the remaining elements.

    Parameters
    ----------
    a : array_like
        Input array.
    proportiontocut : float
        Fraction of the most positive and most negative elements to remove.
        When the specified proportion does not result in an integer number of
        elements, the number of elements to trim is rounded down.
    axis : int or None, default: 0
        Axis along which the trimmed means are computed.
        If None, compute over the raveled array.

    Returns
    -------
    trim_mean : ndarray
        Mean of trimmed array.

    See Also
    --------
    trimboth : Remove a proportion of elements from each end of an array.
    tmean : Compute the mean after trimming values outside specified limits.

    Notes
    -----
    For 1-D array `a`, `trim_mean` is approximately equivalent to the following
    calculation::

        import numpy as np
        a = np.sort(a)
        m = int(proportiontocut * len(a))
        np.mean(a[m: len(a) - m])

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = [1, 2, 3, 5]
    >>> stats.trim_mean(x, 0.25)
    2.5

    When the specified proportion does not result in an integer number of
    elements, the number of elements to trim is rounded down.

    >>> stats.trim_mean(x, 0.24999) == np.mean(x)
    True

    Use `axis` to specify the axis along which the calculation is performed.

    >>> x2 = [[1, 2, 3, 5],
    ...       [10, 20, 30, 50]]
    >>> stats.trim_mean(x2, 0.25)
    array([ 5.5, 11. , 16.5, 27.5])
    >>> stats.trim_mean(x2, 0.25, axis=1)
    array([ 2.5, 25. ])

    """
    a = np.asarray(a)

    if a.size == 0:
        return np.nan

    if axis is None:
        a = a.ravel()
        axis = 0

    nobs = a.shape[axis]
    lowercut = int(proportiontocut * nobs)
    uppercut = nobs - lowercut
    if (lowercut > uppercut):
        raise ValueError("Proportion too big.")

    atmp = np.partition(a, (lowercut, uppercut - 1), axis)

    sl = [slice(None)] * atmp.ndim
    sl[axis] = slice(lowercut, uppercut)
    return np.mean(atmp[tuple(sl)], axis=axis)


F_onewayResult = namedtuple('F_onewayResult', ('statistic', 'pvalue'))


def _create_f_oneway_nan_result(shape, axis, samples):
    """
    This is a helper function for f_oneway for creating the return values
    in certain degenerate conditions.  It creates return values that are
    all nan with the appropriate shape for the given `shape` and `axis`.
    """
    axis = normalize_axis_index(axis, len(shape))
    shp = shape[:axis] + shape[axis+1:]
    f = np.full(shp, fill_value=_get_nan(*samples))
    prob = f.copy()
    return F_onewayResult(f[()], prob[()])


def _first(arr, axis):
    """Return arr[..., 0:1, ...] where 0:1 is in the `axis` position."""
    return np.take_along_axis(arr, np.array(0, ndmin=arr.ndim), axis)


def _f_oneway_is_too_small(samples, kwargs=None, axis=-1):
    message = f"At least two samples are required; got {len(samples)}."
    if len(samples) < 2:
        raise TypeError(message)

    # Check this after forming alldata, so shape errors are detected
    # and reported before checking for 0 length inputs.
    if any(sample.shape[axis] == 0 for sample in samples):
        return True

    # Must have at least one group with length greater than 1.
    if all(sample.shape[axis] == 1 for sample in samples):
        msg = ('all input arrays have length 1.  f_oneway requires that at '
               'least one input has length greater than 1.')
        warnings.warn(SmallSampleWarning(msg), stacklevel=2)
        return True

    return False


@_axis_nan_policy_factory(
    F_onewayResult, n_samples=None, too_small=_f_oneway_is_too_small)
def f_oneway(*samples, axis=0, equal_var=True):
    """Perform one-way ANOVA.

    The one-way ANOVA tests the null hypothesis that two or more groups have
    the same population mean.  The test is applied to samples from two or
    more groups, possibly with differing sizes.

    Parameters
    ----------
    sample1, sample2, ... : array_like
        The sample measurements for each group.  There must be at least
        two arguments.  If the arrays are multidimensional, then all the
        dimensions of the array must be the same except for `axis`.
    axis : int, optional
        Axis of the input arrays along which the test is applied.
        Default is 0.
    equal_var: bool, optional
        If True (default), perform a standard one-way ANOVA test that
        assumes equal population variances [2]_.
        If False, perform Welch's ANOVA test, which does not assume
        equal population variances [4]_.

        .. versionadded:: 1.15.0

    Returns
    -------
    statistic : float
        The computed F statistic of the test.
    pvalue : float
        The associated p-value from the F distribution.

    Warns
    -----
    `~scipy.stats.ConstantInputWarning`
        Emitted if all values within each of the input arrays are identical.
        In this case the F statistic is either infinite or isn't defined,
        so ``np.inf`` or ``np.nan`` is returned.

    RuntimeWarning
        Emitted if the length of any input array is 0, or if all the input
        arrays have length 1.  ``np.nan`` is returned for the F statistic
        and the p-value in these cases.

    Notes
    -----
    The ANOVA test has important assumptions that must be satisfied in order
    for the associated p-value to be valid.

    1. The samples are independent.
    2. Each sample is from a normally distributed population.
    3. The population standard deviations of the groups are all equal.  This
       property is known as homoscedasticity.

    If these assumptions are not true for a given set of data, it may still
    be possible to use the Kruskal-Wallis H-test (`scipy.stats.kruskal`) or
    the Alexander-Govern test (`scipy.stats.alexandergovern`) although with
    some loss of power.

    The length of each group must be at least one, and there must be at
    least one group with length greater than one.  If these conditions
    are not satisfied, a warning is generated and (``np.nan``, ``np.nan``)
    is returned.

    If all values in each group are identical, and there exist at least two
    groups with different values, the function generates a warning and
    returns (``np.inf``, 0).

    If all values in all groups are the same, function generates a warning
    and returns (``np.nan``, ``np.nan``).

    The algorithm is from Heiman [2]_, pp.394-7.

    References
    ----------
    .. [1] R. Lowry, "Concepts and Applications of Inferential Statistics",
           Chapter 14, 2014, http://vassarstats.net/textbook/

    .. [2] G.W. Heiman, "Understanding research methods and statistics: An
           integrated introduction for psychology", Houghton, Mifflin and
           Company, 2001.

    .. [3] G.H. McDonald, "Handbook of Biological Statistics", One-way ANOVA.
           http://www.biostathandbook.com/onewayanova.html

    .. [4] B. L. Welch, "On the Comparison of Several Mean Values:
           An Alternative Approach", Biometrika, vol. 38, no. 3/4,
           pp. 330-336, 1951, doi: 10.2307/2332579.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.stats import f_oneway

    Here are some data [3]_ on a shell measurement (the length of the anterior
    adductor muscle scar, standardized by dividing by length) in the mussel
    Mytilus trossulus from five locations: Tillamook, Oregon; Newport, Oregon;
    Petersburg, Alaska; Magadan, Russia; and Tvarminne, Finland, taken from a
    much larger data set used in McDonald et al. (1991).

    >>> tillamook = [0.0571, 0.0813, 0.0831, 0.0976, 0.0817, 0.0859, 0.0735,
    ...              0.0659, 0.0923, 0.0836]
    >>> newport = [0.0873, 0.0662, 0.0672, 0.0819, 0.0749, 0.0649, 0.0835,
    ...            0.0725]
    >>> petersburg = [0.0974, 0.1352, 0.0817, 0.1016, 0.0968, 0.1064, 0.105]
    >>> magadan = [0.1033, 0.0915, 0.0781, 0.0685, 0.0677, 0.0697, 0.0764,
    ...            0.0689]
    >>> tvarminne = [0.0703, 0.1026, 0.0956, 0.0973, 0.1039, 0.1045]
    >>> f_oneway(tillamook, newport, petersburg, magadan, tvarminne)
    F_onewayResult(statistic=7.121019471642447, pvalue=0.0002812242314534544)

    `f_oneway` accepts multidimensional input arrays.  When the inputs
    are multidimensional and `axis` is not given, the test is performed
    along the first axis of the input arrays.  For the following data, the
    test is performed three times, once for each column.

    >>> a = np.array([[9.87, 9.03, 6.81],
    ...               [7.18, 8.35, 7.00],
    ...               [8.39, 7.58, 7.68],
    ...               [7.45, 6.33, 9.35],
    ...               [6.41, 7.10, 9.33],
    ...               [8.00, 8.24, 8.44]])
    >>> b = np.array([[6.35, 7.30, 7.16],
    ...               [6.65, 6.68, 7.63],
    ...               [5.72, 7.73, 6.72],
    ...               [7.01, 9.19, 7.41],
    ...               [7.75, 7.87, 8.30],
    ...               [6.90, 7.97, 6.97]])
    >>> c = np.array([[3.31, 8.77, 1.01],
    ...               [8.25, 3.24, 3.62],
    ...               [6.32, 8.81, 5.19],
    ...               [7.48, 8.83, 8.91],
    ...               [8.59, 6.01, 6.07],
    ...               [3.07, 9.72, 7.48]])
    >>> F = f_oneway(a, b, c)
    >>> F.statistic
    array([1.75676344, 0.03701228, 3.76439349])
    >>> F.pvalue
    array([0.20630784, 0.96375203, 0.04733157])

    Welch ANOVA will be performed if `equal_var` is False.

    """
    if len(samples) < 2:
        raise TypeError('at least two inputs are required;'
                        f' got {len(samples)}.')

    # ANOVA on N groups, each in its own array
    num_groups = len(samples)

    # We haven't explicitly validated axis, but if it is bad, this call of
    # np.concatenate will raise np.exceptions.AxisError. The call will raise
    # ValueError if the dimensions of all the arrays, except the axis
    # dimension, are not the same.
    alldata = np.concatenate(samples, axis=axis)
    bign = alldata.shape[axis]

    # Check if the inputs are too small
    if _f_oneway_is_too_small(samples):
        return _create_f_oneway_nan_result(alldata.shape, axis, samples)

    # Check if all values within each group are identical, and if the common
    # value in at least one group is different from that in another group.
    # Based on https://github.com/scipy/scipy/issues/11669

    # If axis=0, say, and the groups have shape (n0, ...), (n1, ...), ...,
    # then is_const is a boolean array with shape (num_groups, ...).
    # It is True if the values within the groups along the axis slice are
    # identical. In the typical case where each input array is 1-d, is_const is
    # a 1-d array with length num_groups.
    is_const = np.concatenate(
        [(_first(sample, axis) == sample).all(axis=axis,
                                              keepdims=True)
         for sample in samples],
        axis=axis
    )

    # all_const is a boolean array with shape (...) (see previous comment).
    # It is True if the values within each group along the axis slice are
    # the same (e.g. [[3, 3, 3], [5, 5, 5, 5], [4, 4, 4]]).
    all_const = is_const.all(axis=axis)
    if all_const.any():
        msg = ("Each of the input arrays is constant; "
               "the F statistic is not defined or infinite")
        warnings.warn(stats.ConstantInputWarning(msg), stacklevel=2)

    # all_same_const is True if all the values in the groups along the axis=0
    # slice are the same (e.g. [[3, 3, 3], [3, 3, 3, 3], [3, 3, 3]]).
    all_same_const = (_first(alldata, axis) == alldata).all(axis=axis)

    if not isinstance(equal_var, bool):
        raise TypeError("Expected a boolean value for 'equal_var'")

    if equal_var:
        # Determine the mean of the data, and subtract that from all inputs to a
        # variance (via sum_of_sq / sq_of_sum) calculation.  Variance is invariant
        # to a shift in location, and centering all data around zero vastly
        # improves numerical stability.
        offset = alldata.mean(axis=axis, keepdims=True)
        alldata = alldata - offset

        normalized_ss = _square_of_sums(alldata, axis=axis) / bign

        sstot = _sum_of_squares(alldata, axis=axis) - normalized_ss

        ssbn = 0
        for sample in samples:
            smo_ss = _square_of_sums(sample - offset, axis=axis)
            ssbn = ssbn + smo_ss / sample.shape[axis]

        # Naming: variables ending in bn/b are for "between treatments", wn/w are
        # for "within treatments"
        ssbn = ssbn - normalized_ss
        sswn = sstot - ssbn
        dfbn = num_groups - 1
        dfwn = bign - num_groups
        msb = ssbn / dfbn
        msw = sswn / dfwn
        with np.errstate(divide='ignore', invalid='ignore'):
            f = msb / msw

        prob = special.fdtrc(dfbn, dfwn, f)   # equivalent to stats.f.sf

    else:
        # calculate basic statistics for each sample
        # Beginning of second paragraph [4] page 1:
        # "As a particular case $y_t$ may be the means ... of samples
        y_t = np.asarray([np.mean(sample, axis=axis) for sample in samples])
        # "... of $n_t$ observations..."
        n_t = np.asarray([sample.shape[axis] for sample in samples])
        n_t = np.reshape(n_t, (-1,) + (1,) * (y_t.ndim - 1))
        # "... from $k$ different normal populations..."
        k = len(samples)
        # "The separate samples provide estimates $s_t^2$ of the $\sigma_t^2$."
        s_t2= np.asarray([np.var(sample, axis=axis, ddof=1) for sample in samples])

        # calculate weight by number of data and variance
        # "we have $\lambda_t = 1 / n_t$ ... where w_t = 1 / {\lambda_t s_t^2}$"
        w_t = n_t / s_t2
        # sum of w_t
        s_w_t = np.sum(w_t, axis=0)

        # calculate adjusted grand mean
        # "... and $\hat{y} = \sum w_t y_t / \sum w_t$. When all..."
        y_hat = np_vecdot(w_t, y_t, axis=0) / np.sum(w_t, axis=0)

        # adjust f statistic
        # ref.[4] p.334 eq.29
        numerator =  np_vecdot(w_t, (y_t - y_hat)**2, axis=0) / (k - 1)
        denominator = (
                1 + 2 * (k - 2) / (k**2 - 1) *
                np_vecdot(1 / (n_t - 1), (1 - w_t / s_w_t)**2, axis=0)
        )
        f = numerator / denominator

        # degree of freedom 1
        # ref.[4] p.334 eq.30
        hat_f1 = k - 1

        # adjusted degree of freedom 2
        # ref.[4] p.334 eq.30
        hat_f2 = (
                (k**2 - 1) /
                (3 * np_vecdot(1 / (n_t - 1), (1 - w_t / s_w_t)**2, axis=0))
        )

        # calculate p value
        # ref.[4] p.334 eq.28
        prob = stats.f.sf(f, hat_f1, hat_f2)

    # Fix any f values that should be inf or nan because the corresponding
    # inputs were constant.
    if np.isscalar(f):
        if all_same_const:
            f = np.nan
            prob = np.nan
        elif all_const:
            f = np.inf
            prob = 0.0
    else:
        f[all_const] = np.inf
        prob[all_const] = 0.0
        f[all_same_const] = np.nan
        prob[all_same_const] = np.nan

    return F_onewayResult(f, prob)


@dataclass
class AlexanderGovernResult:
    statistic: float
    pvalue: float


@_axis_nan_policy_factory(
    AlexanderGovernResult, n_samples=None,
    result_to_tuple=lambda x, _: (x.statistic, x.pvalue),
    too_small=1
)
def alexandergovern(*samples, nan_policy='propagate', axis=0):
    """Performs the Alexander Govern test.

    The Alexander-Govern approximation tests the equality of k independent
    means in the face of heterogeneity of variance. The test is applied to
    samples from two or more groups, possibly with differing sizes.

    Parameters
    ----------
    sample1, sample2, ... : array_like
        The sample measurements for each group.  There must be at least
        two samples, and each sample must contain at least two observations.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

        * 'propagate': returns nan
        * 'raise': throws an error
        * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    res : AlexanderGovernResult
        An object with attributes:

        statistic : float
            The computed A statistic of the test.
        pvalue : float
            The associated p-value from the chi-squared distribution.

    Warns
    -----
    `~scipy.stats.ConstantInputWarning`
        Raised if an input is a constant array.  The statistic is not defined
        in this case, so ``np.nan`` is returned.

    See Also
    --------
    f_oneway : one-way ANOVA

    Notes
    -----
    The use of this test relies on several assumptions.

    1. The samples are independent.
    2. Each sample is from a normally distributed population.
    3. Unlike `f_oneway`, this test does not assume on homoscedasticity,
       instead relaxing the assumption of equal variances.

    Input samples must be finite, one dimensional, and with size greater than
    one.

    References
    ----------
    .. [1] Alexander, Ralph A., and Diane M. Govern. "A New and Simpler
           Approximation for ANOVA under Variance Heterogeneity." Journal
           of Educational Statistics, vol. 19, no. 2, 1994, pp. 91-101.
           JSTOR, www.jstor.org/stable/1165140. Accessed 12 Sept. 2020.

    Examples
    --------
    >>> from scipy.stats import alexandergovern

    Here are some data on annual percentage rate of interest charged on
    new car loans at nine of the largest banks in four American cities
    taken from the National Institute of Standards and Technology's
    ANOVA dataset.

    We use `alexandergovern` to test the null hypothesis that all cities
    have the same mean APR against the alternative that the cities do not
    all have the same mean APR. We decide that a significance level of 5%
    is required to reject the null hypothesis in favor of the alternative.

    >>> atlanta = [13.75, 13.75, 13.5, 13.5, 13.0, 13.0, 13.0, 12.75, 12.5]
    >>> chicago = [14.25, 13.0, 12.75, 12.5, 12.5, 12.4, 12.3, 11.9, 11.9]
    >>> houston = [14.0, 14.0, 13.51, 13.5, 13.5, 13.25, 13.0, 12.5, 12.5]
    >>> memphis = [15.0, 14.0, 13.75, 13.59, 13.25, 12.97, 12.5, 12.25,
    ...           11.89]
    >>> alexandergovern(atlanta, chicago, houston, memphis)
    AlexanderGovernResult(statistic=4.65087071883494,
                          pvalue=0.19922132490385214)

    The p-value is 0.1992, indicating a nearly 20% chance of observing
    such an extreme value of the test statistic under the null hypothesis.
    This exceeds 5%, so we do not reject the null hypothesis in favor of
    the alternative.

    """
    samples = _alexandergovern_input_validation(samples, nan_policy, axis)

    # The following formula numbers reference the equation described on
    # page 92 by Alexander, Govern. Formulas 5, 6, and 7 describe other
    # tests that serve as the basis for equation (8) but are not needed
    # to perform the test.

    # precalculate mean and length of each sample
    lengths = [sample.shape[-1] for sample in samples]
    means = np.asarray([_xp_mean(sample, axis=-1) for sample in samples])

    # (1) determine standard error of the mean for each sample
    se2 = [(_xp_var(sample, correction=1, axis=-1) / length)
           for sample, length in zip(samples, lengths)]
    standard_errors_squared = np.asarray(se2)
    standard_errors = standard_errors_squared**0.5

    # Special case: statistic is NaN when variance is zero
    eps = np.finfo(standard_errors.dtype).eps
    zero = standard_errors <= np.abs(eps * means)
    NaN = np.asarray(np.nan, dtype=standard_errors.dtype)
    standard_errors = np.where(zero, NaN, standard_errors)

    # (2) define a weight for each sample
    inv_sq_se = 1 / standard_errors_squared
    weights = inv_sq_se / np.sum(inv_sq_se, axis=0, keepdims=True)

    # (3) determine variance-weighted estimate of the common mean
    # Consider replacing with vecdot when data-apis/array-api#910 is resolved
    var_w = np.sum(weights * means, axis=0, keepdims=True)

    # (4) determine one-sample t statistic for each group
    t_stats = _demean(means, var_w, axis=0, xp=np) / standard_errors

    # calculate parameters to be used in transformation
    v = np.asarray(lengths) - 1
    # align along 0th axis, which corresponds with separate samples
    v = np.reshape(v, (-1,) + (1,)*(t_stats.ndim-1))
    a = v - .5
    b = 48 * a**2
    c = (a * np.log(1 + (t_stats ** 2)/v))**.5

    # (8) perform a normalizing transformation on t statistic
    z = (c + ((c**3 + 3*c)/b) -
         ((4*c**7 + 33*c**5 + 240*c**3 + 855*c) /
          (b**2*10 + 8*b*c**4 + 1000*b)))

    # (9) calculate statistic
    A = np_vecdot(z, z, axis=0)

    # "[the p value is determined from] central chi-square random deviates
    # with k - 1 degrees of freedom". Alexander, Govern (94)
    df = len(samples) - 1
    chi2 = _SimpleChi2(df)
    p = _get_pvalue(A, chi2, alternative='greater', symmetric=False, xp=np)
    return AlexanderGovernResult(A, p)


def _alexandergovern_input_validation(samples, nan_policy, axis):
    if len(samples) < 2:
        raise TypeError(f"2 or more inputs required, got {len(samples)}")

    for sample in samples:
        if sample.shape[axis] <= 1:
            raise ValueError("Input sample size must be greater than one.")

    samples = [np.moveaxis(sample, axis, -1) for sample in samples]

    return samples


def _pearsonr_fisher_ci(r, n, confidence_level, alternative):
    """
    Compute the confidence interval for Pearson's R.

    Fisher's transformation is used to compute the confidence interval
    (https://en.wikipedia.org/wiki/Fisher_transformation).
    """
    xp = array_namespace(r)

    with np.errstate(divide='ignore'):
        zr = xp.atanh(r)

    ones = xp.ones_like(r)
    n = xp.asarray(n, dtype=r.dtype)
    confidence_level = xp.asarray(confidence_level, dtype=r.dtype)
    if n > 3:
        se = xp.sqrt(1 / (n - 3))
        if alternative == "two-sided":
            h = special.ndtri(0.5 + confidence_level/2)
            zlo = zr - h*se
            zhi = zr + h*se
            rlo = xp.tanh(zlo)
            rhi = xp.tanh(zhi)
        elif alternative == "less":
            h = special.ndtri(confidence_level)
            zhi = zr + h*se
            rhi = xp.tanh(zhi)
            rlo = -ones
        else:
            # alternative == "greater":
            h = special.ndtri(confidence_level)
            zlo = zr - h*se
            rlo = xp.tanh(zlo)
            rhi = ones
    else:
        rlo, rhi = -ones, ones

    rlo = rlo[()] if rlo.ndim == 0 else rlo
    rhi = rhi[()] if rhi.ndim == 0 else rhi
    return ConfidenceInterval(low=rlo, high=rhi)


def _pearsonr_bootstrap_ci(confidence_level, method, x, y, alternative, axis):
    """
    Compute the confidence interval for Pearson's R using the bootstrap.
    """
    def statistic(x, y, axis):
        statistic, _ = pearsonr(x, y, axis=axis)
        return statistic

    res = bootstrap((x, y), statistic, confidence_level=confidence_level, axis=axis,
                    paired=True, alternative=alternative, **method._asdict())
    # for one-sided confidence intervals, bootstrap gives +/- inf on one side
    res.confidence_interval = np.clip(res.confidence_interval, -1, 1)

    return ConfidenceInterval(*res.confidence_interval)


ConfidenceInterval = namedtuple('ConfidenceInterval', ['low', 'high'])

PearsonRResultBase = _make_tuple_bunch('PearsonRResultBase',
                                       ['statistic', 'pvalue'], [])


class PearsonRResult(PearsonRResultBase):
    """
    Result of `scipy.stats.pearsonr`

    Attributes
    ----------
    statistic : float
        Pearson product-moment correlation coefficient.
    pvalue : float
        The p-value associated with the chosen alternative.

    Methods
    -------
    confidence_interval
        Computes the confidence interval of the correlation
        coefficient `statistic` for the given confidence level.

    """
    def __init__(self, statistic, pvalue, alternative, n, x, y, axis):
        super().__init__(statistic, pvalue)
        self._alternative = alternative
        self._n = n
        self._x = x
        self._y = y
        self._axis = axis

        # add alias for consistency with other correlation functions
        self.correlation = statistic

    def confidence_interval(self, confidence_level=0.95, method=None):
        """
        The confidence interval for the correlation coefficient.

        Compute the confidence interval for the correlation coefficient
        ``statistic`` with the given confidence level.

        If `method` is not provided,
        The confidence interval is computed using the Fisher transformation
        F(r) = arctanh(r) [1]_.  When the sample pairs are drawn from a
        bivariate normal distribution, F(r) approximately follows a normal
        distribution with standard error ``1/sqrt(n - 3)``, where ``n`` is the
        length of the original samples along the calculation axis. When
        ``n <= 3``, this approximation does not yield a finite, real standard
        error, so we define the confidence interval to be -1 to 1.

        If `method` is an instance of `BootstrapMethod`, the confidence
        interval is computed using `scipy.stats.bootstrap` with the provided
        configuration options and other appropriate settings. In some cases,
        confidence limits may be NaN due to a degenerate resample, and this is
        typical for very small samples (~6 observations).

        Parameters
        ----------
        confidence_level : float
            The confidence level for the calculation of the correlation
            coefficient confidence interval. Default is 0.95.

        method : BootstrapMethod, optional
            Defines the method used to compute the confidence interval. See
            method description for details.

            .. versionadded:: 1.11.0

        Returns
        -------
        ci : namedtuple
            The confidence interval is returned in a ``namedtuple`` with
            fields `low` and `high`.

        References
        ----------
        .. [1] "Pearson correlation coefficient", Wikipedia,
               https://en.wikipedia.org/wiki/Pearson_correlation_coefficient
        """
        if isinstance(method, BootstrapMethod):
            xp = array_namespace(self._x)
            message = ('`method` must be `None` if `pearsonr` '
                       'arguments were not NumPy arrays.')
            if not is_numpy(xp):
                raise ValueError(message)

            ci = _pearsonr_bootstrap_ci(confidence_level, method, self._x, self._y,
                                        self._alternative, self._axis)
        elif method is None:
            ci = _pearsonr_fisher_ci(self.statistic, self._n, confidence_level,
                                     self._alternative)
        else:
            message = ('`method` must be an instance of `BootstrapMethod` '
                       'or None.')
            raise ValueError(message)
        return ci


@xp_capabilities(cpu_only=True, exceptions=['cupy'],
                 jax_jit=False, allow_dask_compute=True)
def pearsonr(x, y, *, alternative='two-sided', method=None, axis=0):
    r"""
    Pearson correlation coefficient and p-value for testing non-correlation.

    The Pearson correlation coefficient [1]_ measures the linear relationship
    between two datasets. Like other correlation
    coefficients, this one varies between -1 and +1 with 0 implying no
    correlation. Correlations of -1 or +1 imply an exact linear relationship.
    Positive correlations imply that as x increases, so does y. Negative
    correlations imply that as x increases, y decreases.

    This function also performs a test of the null hypothesis that the
    distributions underlying the samples are uncorrelated and normally
    distributed. (See Kowalski [3]_
    for a discussion of the effects of non-normality of the input on the
    distribution of the correlation coefficient.)
    The p-value roughly indicates the probability of an uncorrelated system
    producing datasets that have a Pearson correlation at least as extreme
    as the one computed from these datasets.

    Parameters
    ----------
    x : array_like
        Input array.
    y : array_like
        Input array.
    axis : int or None, default
        Axis along which to perform the calculation. Default is 0.
        If None, ravel both arrays before performing the calculation.

        .. versionadded:: 1.14.0
    alternative : {'two-sided', 'greater', 'less'}, optional
        Defines the alternative hypothesis. Default is 'two-sided'.
        The following options are available:

        * 'two-sided': the correlation is nonzero
        * 'less': the correlation is negative (less than zero)
        * 'greater':  the correlation is positive (greater than zero)

        .. versionadded:: 1.9.0
    method : ResamplingMethod, optional
        Defines the method used to compute the p-value. If `method` is an
        instance of `PermutationMethod`/`MonteCarloMethod`, the p-value is
        computed using
        `scipy.stats.permutation_test`/`scipy.stats.monte_carlo_test` with the
        provided configuration options and other appropriate settings.
        Otherwise, the p-value is computed as documented in the notes.

        .. versionadded:: 1.11.0

    Returns
    -------
    result : `~scipy.stats._result_classes.PearsonRResult`
        An object with the following attributes:

        statistic : float
            Pearson product-moment correlation coefficient.
        pvalue : float
            The p-value associated with the chosen alternative.

        The object has the following method:

        confidence_interval(confidence_level, method)
            This computes the confidence interval of the correlation
            coefficient `statistic` for the given confidence level.
            The confidence interval is returned in a ``namedtuple`` with
            fields `low` and `high`. If `method` is not provided, the
            confidence interval is computed using the Fisher transformation
            [1]_. If `method` is an instance of `BootstrapMethod`, the
            confidence interval is computed using `scipy.stats.bootstrap` with
            the provided configuration options and other appropriate settings.
            In some cases, confidence limits may be NaN due to a degenerate
            resample, and this is typical for very small samples (~6
            observations).

    Raises
    ------
    ValueError
        If `x` and `y` do not have length at least 2.

    Warns
    -----
    `~scipy.stats.ConstantInputWarning`
        Raised if an input is a constant array.  The correlation coefficient
        is not defined in this case, so ``np.nan`` is returned.

    `~scipy.stats.NearConstantInputWarning`
        Raised if an input is "nearly" constant.  The array ``x`` is considered
        nearly constant if ``norm(x - mean(x)) < 1e-13 * abs(mean(x))``.
        Numerical errors in the calculation ``x - mean(x)`` in this case might
        result in an inaccurate calculation of r.

    See Also
    --------
    spearmanr : Spearman rank-order correlation coefficient.
    kendalltau : Kendall's tau, a correlation measure for ordinal data.
    :ref:`hypothesis_pearsonr` : Extended example

    Notes
    -----
    The correlation coefficient is calculated as follows:

    .. math::

        r = \frac{\sum (x - m_x) (y - m_y)}
                 {\sqrt{\sum (x - m_x)^2 \sum (y - m_y)^2}}

    where :math:`m_x` is the mean of the vector x and :math:`m_y` is
    the mean of the vector y.

    Under the assumption that x and y are drawn from
    independent normal distributions (so the population correlation coefficient
    is 0), the probability density function of the sample correlation
    coefficient r is ([1]_, [2]_):

    .. math::
        f(r) = \frac{{(1-r^2)}^{n/2-2}}{\mathrm{B}(\frac{1}{2},\frac{n}{2}-1)}

    where n is the number of samples, and B is the beta function.  This
    is sometimes referred to as the exact distribution of r.  This is
    the distribution that is used in `pearsonr` to compute the p-value when
    the `method` parameter is left at its default value (None).
    The distribution is a beta distribution on the interval [-1, 1],
    with equal shape parameters a = b = n/2 - 1.  In terms of SciPy's
    implementation of the beta distribution, the distribution of r is::

        dist = scipy.stats.beta(n/2 - 1, n/2 - 1, loc=-1, scale=2)

    The default p-value returned by `pearsonr` is a two-sided p-value. For a
    given sample with correlation coefficient r, the p-value is
    the probability that abs(r') of a random sample x' and y' drawn from
    the population with zero correlation would be greater than or equal
    to abs(r). In terms of the object ``dist`` shown above, the p-value
    for a given r and length n can be computed as::

        p = 2*dist.cdf(-abs(r))

    When n is 2, the above continuous distribution is not well-defined.
    One can interpret the limit of the beta distribution as the shape
    parameters a and b approach a = b = 0 as a discrete distribution with
    equal probability masses at r = 1 and r = -1.  More directly, one
    can observe that, given the data x = [x1, x2] and y = [y1, y2], and
    assuming x1 != x2 and y1 != y2, the only possible values for r are 1
    and -1.  Because abs(r') for any sample x' and y' with length 2 will
    be 1, the two-sided p-value for a sample of length 2 is always 1.

    For backwards compatibility, the object that is returned also behaves
    like a tuple of length two that holds the statistic and the p-value.

    References
    ----------
    .. [1] "Pearson correlation coefficient", Wikipedia,
           https://en.wikipedia.org/wiki/Pearson_correlation_coefficient
    .. [2] Student, "Probable error of a correlation coefficient",
           Biometrika, Volume 6, Issue 2-3, 1 September 1908, pp. 302-310.
    .. [3] C. J. Kowalski, "On the Effects of Non-Normality on the Distribution
           of the Sample Product-Moment Correlation Coefficient"
           Journal of the Royal Statistical Society. Series C (Applied
           Statistics), Vol. 21, No. 1 (1972), pp. 1-12.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x, y = [1, 2, 3, 4, 5, 6, 7], [10, 9, 2.5, 6, 4, 3, 2]
    >>> res = stats.pearsonr(x, y)
    >>> res
    PearsonRResult(statistic=-0.828503883588428, pvalue=0.021280260007523286)

    To perform an exact permutation version of the test:

    >>> rng = np.random.default_rng(7796654889291491997)
    >>> method = stats.PermutationMethod(n_resamples=np.inf, random_state=rng)
    >>> stats.pearsonr(x, y, method=method)
    PearsonRResult(statistic=-0.828503883588428, pvalue=0.028174603174603175)

    To perform the test under the null hypothesis that the data were drawn from
    *uniform* distributions:

    >>> method = stats.MonteCarloMethod(rvs=(rng.uniform, rng.uniform))
    >>> stats.pearsonr(x, y, method=method)
    PearsonRResult(statistic=-0.828503883588428, pvalue=0.0188)

    To produce an asymptotic 90% confidence interval:

    >>> res.confidence_interval(confidence_level=0.9)
    ConfidenceInterval(low=-0.9644331982722841, high=-0.3460237473272273)

    And for a bootstrap confidence interval:

    >>> method = stats.BootstrapMethod(method='BCa', rng=rng)
    >>> res.confidence_interval(confidence_level=0.9, method=method)
    ConfidenceInterval(low=-0.9983163756488651, high=-0.22771001702132443)  # may vary

    If N-dimensional arrays are provided, multiple tests are performed in a
    single call according to the same conventions as most `scipy.stats` functions:

    >>> rng = np.random.default_rng(2348246935601934321)
    >>> x = rng.standard_normal((8, 15))
    >>> y = rng.standard_normal((8, 15))
    >>> stats.pearsonr(x, y, axis=0).statistic.shape  # between corresponding columns
    (15,)
    >>> stats.pearsonr(x, y, axis=1).statistic.shape  # between corresponding rows
    (8,)

    To perform all pairwise comparisons between slices of the arrays,
    use standard NumPy broadcasting techniques. For instance, to compute the
    correlation between all pairs of rows:

    >>> stats.pearsonr(x[:, np.newaxis, :], y, axis=-1).statistic.shape
    (8, 8)

    There is a linear dependence between x and y if y = a + b*x + e, where
    a,b are constants and e is a random error term, assumed to be independent
    of x. For simplicity, assume that x is standard normal, a=0, b=1 and let
    e follow a normal distribution with mean zero and standard deviation s>0.

    >>> rng = np.random.default_rng()
    >>> s = 0.5
    >>> x = stats.norm.rvs(size=500, random_state=rng)
    >>> e = stats.norm.rvs(scale=s, size=500, random_state=rng)
    >>> y = x + e
    >>> stats.pearsonr(x, y).statistic
    0.9001942438244763

    This should be close to the exact value given by

    >>> 1/np.sqrt(1 + s**2)
    0.8944271909999159

    For s=0.5, we observe a high level of correlation. In general, a large
    variance of the noise reduces the correlation, while the correlation
    approaches one as the variance of the error goes to zero.

    It is important to keep in mind that no correlation does not imply
    independence unless (x, y) is jointly normal. Correlation can even be zero
    when there is a very simple dependence structure: if X follows a
    standard normal distribution, let y = abs(x). Note that the correlation
    between x and y is zero. Indeed, since the expectation of x is zero,
    cov(x, y) = E[x*y]. By definition, this equals E[x*abs(x)] which is zero
    by symmetry. The following lines of code illustrate this observation:

    >>> y = np.abs(x)
    >>> stats.pearsonr(x, y)
    PearsonRResult(statistic=-0.05444919272687482, pvalue=0.22422294836207743)

    A non-zero correlation coefficient can be misleading. For example, if X has
    a standard normal distribution, define y = x if x < 0 and y = 0 otherwise.
    A simple calculation shows that corr(x, y) = sqrt(2/Pi) = 0.797...,
    implying a high level of correlation:

    >>> y = np.where(x < 0, x, 0)
    >>> stats.pearsonr(x, y)
    PearsonRResult(statistic=0.861985781588, pvalue=4.813432002751103e-149)

    This is unintuitive since there is no dependence of x and y if x is larger
    than zero which happens in about half of the cases if we sample x and y.

    For a more detailed example, see :ref:`hypothesis_pearsonr`.

    """
    xp = array_namespace(x, y)
    x, y = xp_promote(x, y, force_floating=True, xp=xp)
    dtype = x.dtype

    if not is_numpy(xp) and method is not None:
        method = 'invalid'

    if axis is None:
        x = xp.reshape(x, (-1,))
        y = xp.reshape(y, (-1,))
        axis = -1

    axis_int = int(axis)
    if axis_int != axis:
        raise ValueError('`axis` must be an integer.')
    axis = axis_int

    try:
        np.broadcast_shapes(x.shape, y.shape)
        # For consistency with other `stats` functions, we need to
        # match the dimensionalities before looking at `axis`.
        # (Note: this is not the NEP 5 / gufunc order of operations;
        #  see TestPearsonr::test_different_dimensionality for more information.)
        ndim = max(x.ndim, y.ndim)
        x = xp.reshape(x, (1,) * (ndim - x.ndim) + x.shape)
        y = xp.reshape(y, (1,) * (ndim - y.ndim) + y.shape)

    except (ValueError, RuntimeError) as e:
        message = '`x` and `y` must be broadcastable.'
        raise ValueError(message) from e

    n = x.shape[axis]
    if n != y.shape[axis]:
        raise ValueError('`x` and `y` must have the same length along `axis`.')

    if n < 2:
        raise ValueError('`x` and `y` must have length at least 2.')

    x = xp.moveaxis(x, axis, -1)
    y = xp.moveaxis(y, axis, -1)
    axis = -1

    if xp.isdtype(dtype, "complex floating"):
        raise ValueError('This function does not support complex data')

    x = xp.astype(x, dtype, copy=False)
    y = xp.astype(y, dtype, copy=False)
    threshold = xp.finfo(dtype).eps ** 0.75

    # If an input is constant, the correlation coefficient is not defined.
    const_x = xp.all(x == x[..., 0:1], axis=-1)
    const_y = xp.all(y == y[..., 0:1], axis=-1)
    const_xy = const_x | const_y
    if xp.any(const_xy):
        msg = ("An input array is constant; the correlation coefficient "
               "is not defined.")
        warnings.warn(stats.ConstantInputWarning(msg), stacklevel=2)
        x = xp.where(const_x[..., xp.newaxis], xp.nan, x)
        y = xp.where(const_y[..., xp.newaxis], xp.nan, y)

    if isinstance(method, PermutationMethod):
        def statistic(y, axis):
            statistic, _ = pearsonr(x, y, axis=axis, alternative=alternative)
            return statistic

        res = permutation_test((y,), statistic, permutation_type='pairings',
                               axis=axis, alternative=alternative, **method._asdict())

        return PearsonRResult(statistic=res.statistic, pvalue=res.pvalue, n=n,
                              alternative=alternative, x=x, y=y, axis=axis)
    elif isinstance(method, MonteCarloMethod):
        def statistic(x, y, axis):
            statistic, _ = pearsonr(x, y, axis=axis, alternative=alternative)
            return statistic

        # `monte_carlo_test` accepts an `rvs` tuple of callables, not an `rng`
        # If the user specified an `rng`, replace it with the appropriate callables
        method = method._asdict()
        if (rng := method.pop('rng', None)) is not None:  # goo-goo g'joob
            rng = np.random.default_rng(rng)
            method['rvs'] = rng.normal, rng.normal

        res = monte_carlo_test((x, y,), statistic=statistic, axis=axis,
                               alternative=alternative, **method)

        return PearsonRResult(statistic=res.statistic, pvalue=res.pvalue, n=n,
                              alternative=alternative, x=x, y=y, axis=axis)
    elif method == 'invalid':
        message = '`method` must be `None` if arguments are not NumPy arrays.'
        raise ValueError(message)
    elif method is not None:
        message = ('`method` must be an instance of `PermutationMethod`,'
                   '`MonteCarloMethod`, or None.')
        raise ValueError(message)

    xmean = xp.mean(x, axis=axis, keepdims=True)
    ymean = xp.mean(y, axis=axis, keepdims=True)
    xm = x - xmean
    ym = y - ymean

    # scipy.linalg.norm(xm) avoids premature overflow when xm is e.g.
    # [-5e210, 5e210, 3e200, -3e200]
    # but not when `axis` is provided, so scale manually. scipy.linalg.norm
    # also raises an error with NaN input rather than returning NaN, so
    # use np.linalg.norm.
    xmax = xp.max(xp.abs(xm), axis=axis, keepdims=True)
    ymax = xp.max(xp.abs(ym), axis=axis, keepdims=True)
    with np.errstate(invalid='ignore', divide='ignore'):
        normxm = xmax * xp_vector_norm(xm/xmax, axis=axis, keepdims=True)
        normym = ymax * xp_vector_norm(ym/ymax, axis=axis, keepdims=True)

    nconst_x = xp.any(normxm < threshold*xp.abs(xmean), axis=axis)
    nconst_y = xp.any(normym < threshold*xp.abs(ymean), axis=axis)
    nconst_xy = nconst_x | nconst_y
    if xp.any(nconst_xy & (~const_xy)):
        # If all the values in x (likewise y) are very close to the mean,
        # the loss of precision that occurs in the subtraction xm = x - xmean
        # might result in large errors in r.
        msg = ("An input array is nearly constant; the computed "
               "correlation coefficient may be inaccurate.")
        warnings.warn(stats.NearConstantInputWarning(msg), stacklevel=2)

    with np.errstate(invalid='ignore', divide='ignore'):
        r = xp.vecdot(xm / normxm, ym / normym, axis=axis)

    # Presumably, if abs(r) > 1, then it is only some small artifact of
    # floating point arithmetic.
    r = xp.clip(r, -1., 1.)
    r = xpx.at(r, const_xy).set(xp.nan)

    # Make sure we return exact 1.0 or -1.0 values for n == 2 case as promised
    # in the docs.
    if n == 2:
        r = xp.round(r)
        one = xp.asarray(1, dtype=dtype)
        pvalue = xp.where(xp.asarray(xp.isnan(r)), xp.nan*one, one)
    else:
        # As explained in the docstring, the distribution of `r` under the null
        # hypothesis is the beta distribution on (-1, 1) with a = b = n/2 - 1.
        ab = xp.asarray(n/2 - 1)
        dist = _SimpleBeta(ab, ab, loc=-1, scale=2)
        pvalue = _get_pvalue(r, dist, alternative, xp=xp)

    r = r[()] if r.ndim == 0 else r
    pvalue = pvalue[()] if pvalue.ndim == 0 else pvalue
    return PearsonRResult(statistic=r, pvalue=pvalue, n=n,
                          alternative=alternative, x=x, y=y, axis=axis)


def fisher_exact(table, alternative=None, *, method=None):
    """Perform a Fisher exact test on a contingency table.

    For a 2x2 table,
    the null hypothesis is that the true odds ratio of the populations
    underlying the observations is one, and the observations were sampled
    from these populations under a condition: the marginals of the
    resulting table must equal those of the observed table.
    The statistic is the unconditional maximum likelihood estimate of the odds
    ratio, and the p-value is the probability under the null hypothesis of
    obtaining a table at least as extreme as the one that was actually
    observed.

    For other table sizes, or if `method` is provided, the null hypothesis
    is that the rows and columns of the tables have fixed sums and are
    independent; i.e., the table was sampled from a `scipy.stats.random_table`
    distribution with the observed marginals. The statistic is the
    probability mass of this distribution evaluated at `table`, and the
    p-value is the percentage of the population of tables with statistic at
    least as extreme (small) as that of `table`. There is only one alternative
    hypothesis available: the rows and columns are not independent.

    There are other possible choices of statistic and two-sided
    p-value definition associated with Fisher's exact test; please see the
    Notes for more information.

    Parameters
    ----------
    table : array_like of ints
        A contingency table.  Elements must be non-negative integers.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis for 2x2 tables; unused for other
        table sizes.
        The following options are available (default is 'two-sided'):

        * 'two-sided': the odds ratio of the underlying population is not one
        * 'less': the odds ratio of the underlying population is less than one
        * 'greater': the odds ratio of the underlying population is greater
          than one

        See the Notes for more details.

    method : ResamplingMethod, optional
        Defines the method used to compute the p-value.
        If `method` is an instance of `PermutationMethod`/`MonteCarloMethod`,
        the p-value is computed using
        `scipy.stats.permutation_test`/`scipy.stats.monte_carlo_test` with the
        provided configuration options and other appropriate settings.
        Note that if `method` is an instance of `MonteCarloMethod`, the ``rvs``
        attribute must be left unspecified; Monte Carlo samples are always drawn
        using the ``rvs`` method of `scipy.stats.random_table`.
        Otherwise, the p-value is computed as documented in the notes.

        .. versionadded:: 1.15.0

    Returns
    -------
    res : SignificanceResult
        An object containing attributes:

        statistic : float
            For a 2x2 table with default `method`, this is the odds ratio - the
            prior odds ratio not a posterior estimate. In all other cases, this
            is the probability density of obtaining the observed table under the
            null hypothesis of independence with marginals fixed.
        pvalue : float
            The probability under the null hypothesis of obtaining a
            table at least as extreme as the one that was actually observed.

    Raises
    ------
    ValueError
        If `table` is not two-dimensional or has negative entries.

    See Also
    --------
    chi2_contingency : Chi-square test of independence of variables in a
        contingency table.  This can be used as an alternative to
        `fisher_exact` when the numbers in the table are large.
    contingency.odds_ratio : Compute the odds ratio (sample or conditional
        MLE) for a 2x2 contingency table.
    barnard_exact : Barnard's exact test, which is a more powerful alternative
        than Fisher's exact test for 2x2 contingency tables.
    boschloo_exact : Boschloo's exact test, which is a more powerful
        alternative than Fisher's exact test for 2x2 contingency tables.
    :ref:`hypothesis_fisher_exact` : Extended example

    Notes
    -----
    *Null hypothesis and p-values*

    The null hypothesis is that the true odds ratio of the populations
    underlying the observations is one, and the observations were sampled at
    random from these populations under a condition: the marginals of the
    resulting table must equal those of the observed table. Equivalently,
    the null hypothesis is that the input table is from the hypergeometric
    distribution with parameters (as used in `hypergeom`)
    ``M = a + b + c + d``, ``n = a + b`` and ``N = a + c``, where the
    input table is ``[[a, b], [c, d]]``.  This distribution has support
    ``max(0, N + n - M) <= x <= min(N, n)``, or, in terms of the values
    in the input table, ``min(0, a - d) <= x <= a + min(b, c)``.  ``x``
    can be interpreted as the upper-left element of a 2x2 table, so the
    tables in the distribution have form::

        [  x           n - x     ]
        [N - x    M - (n + N) + x]

    For example, if::

        table = [6  2]
                [1  4]

    then the support is ``2 <= x <= 7``, and the tables in the distribution
    are::

        [2 6]   [3 5]   [4 4]   [5 3]   [6 2]  [7 1]
        [5 0]   [4 1]   [3 2]   [2 3]   [1 4]  [0 5]

    The probability of each table is given by the hypergeometric distribution
    ``hypergeom.pmf(x, M, n, N)``.  For this example, these are (rounded to
    three significant digits)::

        x       2      3      4      5       6        7
        p  0.0163  0.163  0.408  0.326  0.0816  0.00466

    These can be computed with::

        >>> import numpy as np
        >>> from scipy.stats import hypergeom
        >>> table = np.array([[6, 2], [1, 4]])
        >>> M = table.sum()
        >>> n = table[0].sum()
        >>> N = table[:, 0].sum()
        >>> start, end = hypergeom.support(M, n, N)
        >>> hypergeom.pmf(np.arange(start, end+1), M, n, N)
        array([0.01631702, 0.16317016, 0.40792541, 0.32634033, 0.08158508,
               0.004662  ])

    The two-sided p-value is the probability that, under the null hypothesis,
    a random table would have a probability equal to or less than the
    probability of the input table.  For our example, the probability of
    the input table (where ``x = 6``) is 0.0816.  The x values where the
    probability does not exceed this are 2, 6 and 7, so the two-sided p-value
    is ``0.0163 + 0.0816 + 0.00466 ~= 0.10256``::

        >>> from scipy.stats import fisher_exact
        >>> res = fisher_exact(table, alternative='two-sided')
        >>> res.pvalue
        0.10256410256410257

    The one-sided p-value for ``alternative='greater'`` is the probability
    that a random table has ``x >= a``, which in our example is ``x >= 6``,
    or ``0.0816 + 0.00466 ~= 0.08626``::

        >>> res = fisher_exact(table, alternative='greater')
        >>> res.pvalue
        0.08624708624708627

    This is equivalent to computing the survival function of the
    distribution at ``x = 5`` (one less than ``x`` from the input table,
    because we want to include the probability of ``x = 6`` in the sum)::

        >>> hypergeom.sf(5, M, n, N)
        0.08624708624708627

    For ``alternative='less'``, the one-sided p-value is the probability
    that a random table has ``x <= a``, (i.e. ``x <= 6`` in our example),
    or ``0.0163 + 0.163 + 0.408 + 0.326 + 0.0816 ~= 0.9949``::

        >>> res = fisher_exact(table, alternative='less')
        >>> res.pvalue
        0.9953379953379957

    This is equivalent to computing the cumulative distribution function
    of the distribution at ``x = 6``:

        >>> hypergeom.cdf(6, M, n, N)
        0.9953379953379957

    *Odds ratio*

    The calculated odds ratio is different from the value computed by the
    R function ``fisher.test``.  This implementation returns the "sample"
    or "unconditional" maximum likelihood estimate, while ``fisher.test``
    in R uses the conditional maximum likelihood estimate.  To compute the
    conditional maximum likelihood estimate of the odds ratio, use
    `scipy.stats.contingency.odds_ratio`.

    References
    ----------
    .. [1] Fisher, Sir Ronald A, "The Design of Experiments:
           Mathematics of a Lady Tasting Tea." ISBN 978-0-486-41151-4, 1935.
    .. [2] "Fisher's exact test",
           https://en.wikipedia.org/wiki/Fisher's_exact_test

    Examples
    --------

    >>> from scipy.stats import fisher_exact
    >>> res = fisher_exact([[8, 2], [1, 5]])
    >>> res.statistic
    20.0
    >>> res.pvalue
    0.034965034965034975

    For tables with shape other than ``(2, 2)``, provide an instance of
    `scipy.stats.MonteCarloMethod` or `scipy.stats.PermutationMethod` for the
    `method` parameter:

    >>> import numpy as np
    >>> from scipy.stats import MonteCarloMethod
    >>> rng = np.random.default_rng(4507195762371367)
    >>> method = MonteCarloMethod(rng=rng)
    >>> fisher_exact([[8, 2, 3], [1, 5, 4]], method=method)
    SignificanceResult(statistic=np.float64(0.005782), pvalue=np.float64(0.0603))

    For a more detailed example, see :ref:`hypothesis_fisher_exact`.
    """
    hypergeom = distributions.hypergeom
    # int32 is not enough for the algorithm
    c = np.asarray(table, dtype=np.int64)
    if not c.ndim == 2:
        raise ValueError("The input `table` must have two dimensions.")

    if np.any(c < 0):
        raise ValueError("All values in `table` must be nonnegative.")

    if not c.shape == (2, 2) or method is not None:
        return _fisher_exact_rxc(c, alternative, method)
    alternative = 'two-sided' if alternative is None else alternative

    if 0 in c.sum(axis=0) or 0 in c.sum(axis=1):
        # If both values in a row or column are zero, the p-value is 1 and
        # the odds ratio is NaN.
        return SignificanceResult(np.nan, 1.0)

    if c[1, 0] > 0 and c[0, 1] > 0:
        oddsratio = c[0, 0] * c[1, 1] / (c[1, 0] * c[0, 1])
    else:
        oddsratio = np.inf

    n1 = c[0, 0] + c[0, 1]
    n2 = c[1, 0] + c[1, 1]
    n = c[0, 0] + c[1, 0]

    def pmf(x):
        return hypergeom.pmf(x, n1 + n2, n1, n)

    if alternative == 'less':
        pvalue = hypergeom.cdf(c[0, 0], n1 + n2, n1, n)
    elif alternative == 'greater':
        # Same formula as the 'less' case, but with the second column.
        pvalue = hypergeom.cdf(c[0, 1], n1 + n2, n1, c[0, 1] + c[1, 1])
    elif alternative == 'two-sided':
        mode = int((n + 1) * (n1 + 1) / (n1 + n2 + 2))
        pexact = hypergeom.pmf(c[0, 0], n1 + n2, n1, n)
        pmode = hypergeom.pmf(mode, n1 + n2, n1, n)

        epsilon = 1e-14
        gamma = 1 + epsilon

        if np.abs(pexact - pmode) / np.maximum(pexact, pmode) <= epsilon:
            return SignificanceResult(oddsratio, 1.)

        elif c[0, 0] < mode:
            plower = hypergeom.cdf(c[0, 0], n1 + n2, n1, n)
            if hypergeom.pmf(n, n1 + n2, n1, n) > pexact * gamma:
                return SignificanceResult(oddsratio, plower)

            guess = _binary_search(lambda x: -pmf(x), -pexact * gamma, mode, n)
            pvalue = plower + hypergeom.sf(guess, n1 + n2, n1, n)
        else:
            pupper = hypergeom.sf(c[0, 0] - 1, n1 + n2, n1, n)
            if hypergeom.pmf(0, n1 + n2, n1, n) > pexact * gamma:
                return SignificanceResult(oddsratio, pupper)

            guess = _binary_search(pmf, pexact * gamma, 0, mode)
            pvalue = pupper + hypergeom.cdf(guess, n1 + n2, n1, n)
    else:
        msg = "`alternative` should be one of {'two-sided', 'less', 'greater'}"
        raise ValueError(msg)

    pvalue = min(pvalue, 1.0)

    return SignificanceResult(oddsratio, pvalue)


def _fisher_exact_rxc(table, alternative, method):
    if alternative is not None:
        message = ('`alternative` must be the default (None) unless '
                  '`table` has shape `(2, 2)` and `method is None`.')
        raise ValueError(message)

    if table.size == 0:
        raise ValueError("`table` must have at least one row and one column.")

    if table.shape[0] == 1 or table.shape[1] == 1 or np.all(table == 0):
        # Only one such table with those marginals
        return SignificanceResult(1.0, 1.0)

    if method is None:
        method = stats.MonteCarloMethod()

    if isinstance(method, stats.PermutationMethod):
        res = _fisher_exact_permutation_method(table, method)
    elif isinstance(method, stats.MonteCarloMethod):
        res = _fisher_exact_monte_carlo_method(table, method)
    else:
        message = (f'`{method=}` not recognized; if provided, `method` must be an '
                   'instance of `PermutationMethod` or `MonteCarloMethod`.')
        raise ValueError(message)

    return SignificanceResult(np.clip(res.statistic, None, 1.0), res.pvalue)


def _fisher_exact_permutation_method(table, method):
    x, y = _untabulate(table)
    colsums = np.sum(table, axis=0)
    rowsums = np.sum(table, axis=1)
    X = stats.random_table(rowsums, colsums)

    # `permutation_test` with `permutation_type='pairings' permutes the order of `x`,
    # which pairs observations in `x` with different observations in `y`.
    def statistic(x):
        # crosstab the resample and compute the statistic
        table = stats.contingency.crosstab(x, y)[1]
        return X.pmf(table)

    # tables with *smaller* probability mass are considered to be more extreme
    return stats.permutation_test((x,), statistic, permutation_type='pairings',
                                  alternative='less', **method._asdict())


def _fisher_exact_monte_carlo_method(table, method):
    method = method._asdict()

    if method.pop('rvs', None) is not None:
        message = ('If the `method` argument of `fisher_exact` is an '
                   'instance of `MonteCarloMethod`, its `rvs` attribute '
                   'must be unspecified. Use the `MonteCarloMethod` `rng` argument '
                   'to control the random state.')
        raise ValueError(message)
    rng = np.random.default_rng(method.pop('rng', None))

    # `random_table.rvs` produces random contingency tables with the given marginals
    # under the null hypothesis of independence
    shape = table.shape
    colsums = np.sum(table, axis=0)
    rowsums = np.sum(table, axis=1)
    totsum = np.sum(table)
    X = stats.random_table(rowsums, colsums, seed=rng)

    def rvs(size):
        n_resamples = size[0]
        return X.rvs(size=n_resamples).reshape(size)

    # axis signals to `monte_carlo_test` that statistic is vectorized, but we know
    # how it will pass the table(s), so we don't need to use `axis` explicitly.
    def statistic(table, axis):
        shape_ = (-1,) + shape if table.size > totsum else shape
        return X.pmf(table.reshape(shape_))

    # tables with *smaller* probability mass are considered to be more extreme
    return stats.monte_carlo_test(table.ravel(), rvs, statistic,
                                  alternative='less', **method)


def _untabulate(table):
    # converts a contingency table to paired samples indicating the
    # correspondence between row and column indices
    r, c = table.shape
    x, y = [], []
    for i in range(r):
        for j in range(c):
            x.append([i] * table[i, j])
            y.append([j] * table[i, j])
    return np.concatenate(x), np.concatenate(y)


def spearmanr(a, b=None, axis=0, nan_policy='propagate',
              alternative='two-sided'):
    r"""Calculate a Spearman correlation coefficient with associated p-value.

    The Spearman rank-order correlation coefficient is a nonparametric measure
    of the monotonicity of the relationship between two datasets.
    Like other correlation coefficients,
    this one varies between -1 and +1 with 0 implying no correlation.
    Correlations of -1 or +1 imply an exact monotonic relationship. Positive
    correlations imply that as x increases, so does y. Negative correlations
    imply that as x increases, y decreases.

    The p-value roughly indicates the probability of an uncorrelated system
    producing datasets that have a Spearman correlation at least as extreme
    as the one computed from these datasets. Although calculation of the
    p-value does not make strong assumptions about the distributions underlying
    the samples, it is only accurate for very large samples (>500
    observations). For smaller sample sizes, consider a permutation test (see
    Examples section below).

    Parameters
    ----------
    a, b : 1D or 2D array_like, b is optional
        One or two 1-D or 2-D arrays containing multiple variables and
        observations. When these are 1-D, each represents a vector of
        observations of a single variable. For the behavior in the 2-D case,
        see under ``axis``, below.
        Both arrays need to have the same length in the ``axis`` dimension.
    axis : int or None, optional
        If axis=0 (default), then each column represents a variable, with
        observations in the rows. If axis=1, the relationship is transposed:
        each row represents a variable, while the columns contain observations.
        If axis=None, then both arrays will be raveled.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

        * 'propagate': returns nan
        * 'raise': throws an error
        * 'omit': performs the calculations ignoring nan values

    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis. Default is 'two-sided'.
        The following options are available:

        * 'two-sided': the correlation is nonzero
        * 'less': the correlation is negative (less than zero)
        * 'greater':  the correlation is positive (greater than zero)

        .. versionadded:: 1.7.0

    Returns
    -------
    res : SignificanceResult
        An object containing attributes:

        statistic : float or ndarray (2-D square)
            Spearman correlation matrix or correlation coefficient (if only 2
            variables are given as parameters). Correlation matrix is square
            with length equal to total number of variables (columns or rows) in
            ``a`` and ``b`` combined.
        pvalue : float
            The p-value for a hypothesis test whose null hypothesis
            is that two samples have no ordinal correlation. See
            `alternative` above for alternative hypotheses. `pvalue` has the
            same shape as `statistic`.

    Raises
    ------
    ValueError
        If `axis` is not 0, 1 or None, or if the number of dimensions of `a`
        is greater than 2, or if `b` is None and the number of dimensions of
        `a` is less than 2.

    Warns
    -----
    `~scipy.stats.ConstantInputWarning`
        Raised if an input is a constant array.  The correlation coefficient
        is not defined in this case, so ``np.nan`` is returned.

    See Also
    --------
    :ref:`hypothesis_spearmanr` : Extended example

    References
    ----------
    .. [1] Zwillinger, D. and Kokoska, S. (2000). CRC Standard
       Probability and Statistics Tables and Formulae. Chapman & Hall: New
       York. 2000.
       Section  14.7
    .. [2] Kendall, M. G. and Stuart, A. (1973).
       The Advanced Theory of Statistics, Volume 2: Inference and Relationship.
       Griffin. 1973.
       Section 31.18

    Examples
    --------

    >>> import numpy as np
    >>> from scipy import stats
    >>> res = stats.spearmanr([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])
    >>> res.statistic
    0.8207826816681233
    >>> res.pvalue
    0.08858700531354381

    >>> rng = np.random.default_rng()
    >>> x2n = rng.standard_normal((100, 2))
    >>> y2n = rng.standard_normal((100, 2))
    >>> res = stats.spearmanr(x2n)
    >>> res.statistic, res.pvalue
    (-0.07960396039603959, 0.4311168705769747)

    >>> res = stats.spearmanr(x2n[:, 0], x2n[:, 1])
    >>> res.statistic, res.pvalue
    (-0.07960396039603959, 0.4311168705769747)

    >>> res = stats.spearmanr(x2n, y2n)
    >>> res.statistic
    array([[ 1. , -0.07960396, -0.08314431, 0.09662166],
           [-0.07960396, 1. , -0.14448245, 0.16738074],
           [-0.08314431, -0.14448245, 1. , 0.03234323],
           [ 0.09662166, 0.16738074, 0.03234323, 1. ]])
    >>> res.pvalue
    array([[0. , 0.43111687, 0.41084066, 0.33891628],
           [0.43111687, 0. , 0.15151618, 0.09600687],
           [0.41084066, 0.15151618, 0. , 0.74938561],
           [0.33891628, 0.09600687, 0.74938561, 0. ]])

    >>> res = stats.spearmanr(x2n.T, y2n.T, axis=1)
    >>> res.statistic
    array([[ 1. , -0.07960396, -0.08314431, 0.09662166],
           [-0.07960396, 1. , -0.14448245, 0.16738074],
           [-0.08314431, -0.14448245, 1. , 0.03234323],
           [ 0.09662166, 0.16738074, 0.03234323, 1. ]])

    >>> res = stats.spearmanr(x2n, y2n, axis=None)
    >>> res.statistic, res.pvalue
    (0.044981624540613524, 0.5270803651336189)

    >>> res = stats.spearmanr(x2n.ravel(), y2n.ravel())
    >>> res.statistic, res.pvalue
    (0.044981624540613524, 0.5270803651336189)

    >>> rng = np.random.default_rng()
    >>> xint = rng.integers(10, size=(100, 2))
    >>> res = stats.spearmanr(xint)
    >>> res.statistic, res.pvalue
    (0.09800224850707953, 0.3320271757932076)

    For small samples, consider performing a permutation test instead of
    relying on the asymptotic p-value. Note that to calculate the null
    distribution of the statistic (for all possibly pairings between
    observations in sample ``x`` and ``y``), only one of the two inputs needs
    to be permuted.

    >>> x = [1.76405235, 0.40015721, 0.97873798,
    ... 2.2408932, 1.86755799, -0.97727788]
    >>> y = [2.71414076, 0.2488, 0.87551913,
    ... 2.6514917, 2.01160156, 0.47699563]

    >>> def statistic(x): # permute only `x`
    ...     return stats.spearmanr(x, y).statistic
    >>> res_exact = stats.permutation_test((x,), statistic,
    ...     permutation_type='pairings')
    >>> res_asymptotic = stats.spearmanr(x, y)
    >>> res_exact.pvalue, res_asymptotic.pvalue # asymptotic pvalue is too low
    (0.10277777777777777, 0.07239650145772594)

    For a more detailed example, see :ref:`hypothesis_spearmanr`.
    """
    if axis is not None and axis > 1:
        raise ValueError("spearmanr only handles 1-D or 2-D arrays, "
                         f"supplied axis argument {axis}, please use only "
                         "values 0, 1 or None for axis")

    a, axisout = _chk_asarray(a, axis)
    if a.ndim > 2:
        raise ValueError("spearmanr only handles 1-D or 2-D arrays")

    if b is None:
        if a.ndim < 2:
            raise ValueError("`spearmanr` needs at least 2 "
                             "variables to compare")
    else:
        # Concatenate a and b, so that we now only have to handle the case
        # of a 2-D `a`.
        b, _ = _chk_asarray(b, axis)
        if axisout == 0:
            a = np.column_stack((a, b))
        else:
            a = np.vstack((a, b))

    n_vars = a.shape[1 - axisout]
    n_obs = a.shape[axisout]
    if n_obs <= 1:
        # Handle empty arrays or single observations.
        res = SignificanceResult(np.nan, np.nan)
        res.correlation = np.nan
        return res

    warn_msg = ("An input array is constant; the correlation coefficient "
                "is not defined.")
    if axisout == 0:
        if (a[:, 0][0] == a[:, 0]).all() or (a[:, 1][0] == a[:, 1]).all():
            # If an input is constant, the correlation coefficient
            # is not defined.
            warnings.warn(stats.ConstantInputWarning(warn_msg), stacklevel=2)
            res = SignificanceResult(np.nan, np.nan)
            res.correlation = np.nan
            return res
    else:  # case when axisout == 1 b/c a is 2 dim only
        if (a[0, :][0] == a[0, :]).all() or (a[1, :][0] == a[1, :]).all():
            # If an input is constant, the correlation coefficient
            # is not defined.
            warnings.warn(stats.ConstantInputWarning(warn_msg), stacklevel=2)
            res = SignificanceResult(np.nan, np.nan)
            res.correlation = np.nan
            return res

    a_contains_nan = _contains_nan(a, nan_policy)
    variable_has_nan = np.zeros(n_vars, dtype=bool)
    if a_contains_nan:
        if nan_policy == 'omit':
            return mstats_basic.spearmanr(a, axis=axis, nan_policy=nan_policy,
                                          alternative=alternative)
        elif nan_policy == 'propagate':
            if a.ndim == 1 or n_vars <= 2:
                res = SignificanceResult(np.nan, np.nan)
                res.correlation = np.nan
                return res
            else:
                # Keep track of variables with NaNs, set the outputs to NaN
                # only for those variables
                variable_has_nan = np.isnan(a).any(axis=axisout)

    a_ranked = np.apply_along_axis(rankdata, axisout, a)
    rs = np.corrcoef(a_ranked, rowvar=axisout)
    dof = n_obs - 2  # degrees of freedom

    # rs can have elements equal to 1, so avoid zero division warnings
    with np.errstate(divide='ignore'):
        # clip the small negative values possibly caused by rounding
        # errors before taking the square root
        t = rs * np.sqrt((dof/((rs+1.0)*(1.0-rs))).clip(0))

    dist = _SimpleStudentT(dof)
    prob = _get_pvalue(t, dist, alternative, xp=np)

    # For backwards compatibility, return scalars when comparing 2 columns
    if rs.shape == (2, 2):
        res = SignificanceResult(rs[1, 0], prob[1, 0])
        res.correlation = rs[1, 0]
        return res
    else:
        rs[variable_has_nan, :] = np.nan
        rs[:, variable_has_nan] = np.nan
        res = SignificanceResult(rs[()], prob[()])
        res.correlation = rs
        return res


@_axis_nan_policy_factory(_pack_CorrelationResult, n_samples=2,
                          result_to_tuple=_unpack_CorrelationResult, paired=True,
                          too_small=1, n_outputs=3)
def pointbiserialr(x, y):
    r"""Calculate a point biserial correlation coefficient and its p-value.

    The point biserial correlation is used to measure the relationship
    between a binary variable, x, and a continuous variable, y. Like other
    correlation coefficients, this one varies between -1 and +1 with 0
    implying no correlation. Correlations of -1 or +1 imply a determinative
    relationship.

    This function may be computed using a shortcut formula but produces the
    same result as `pearsonr`.

    Parameters
    ----------
    x : array_like of bools
        Input array.
    y : array_like
        Input array.

    Returns
    -------
    res: SignificanceResult
        An object containing attributes:

        statistic : float
            The R value.
        pvalue : float
            The two-sided p-value.

    Notes
    -----
    `pointbiserialr` uses a t-test with ``n-1`` degrees of freedom.
    It is equivalent to `pearsonr`.

    The value of the point-biserial correlation can be calculated from:

    .. math::

        r_{pb} = \frac{\overline{Y_1} - \overline{Y_0}}
                      {s_y}
                 \sqrt{\frac{N_0 N_1}
                            {N (N - 1)}}

    Where :math:`\overline{Y_{0}}` and :math:`\overline{Y_{1}}` are means
    of the metric observations coded 0 and 1 respectively; :math:`N_{0}` and
    :math:`N_{1}` are number of observations coded 0 and 1 respectively;
    :math:`N` is the total number of observations and :math:`s_{y}` is the
    standard deviation of all the metric observations.

    A value of :math:`r_{pb}` that is significantly different from zero is
    completely equivalent to a significant difference in means between the two
    groups. Thus, an independent groups t Test with :math:`N-2` degrees of
    freedom may be used to test whether :math:`r_{pb}` is nonzero. The
    relation between the t-statistic for comparing two independent groups and
    :math:`r_{pb}` is given by:

    .. math::

        t = \sqrt{N - 2}\frac{r_{pb}}{\sqrt{1 - r^{2}_{pb}}}

    References
    ----------
    .. [1] J. Lev, "The Point Biserial Coefficient of Correlation", Ann. Math.
           Statist., Vol. 20, no.1, pp. 125-126, 1949.

    .. [2] R.F. Tate, "Correlation Between a Discrete and a Continuous
           Variable. Point-Biserial Correlation.", Ann. Math. Statist., Vol. 25,
           np. 3, pp. 603-607, 1954.

    .. [3] D. Kornbrot "Point Biserial Correlation", In Wiley StatsRef:
           Statistics Reference Online (eds N. Balakrishnan, et al.), 2014.
           :doi:`10.1002/9781118445112.stat06227`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> a = np.array([0, 0, 0, 1, 1, 1, 1])
    >>> b = np.arange(7)
    >>> stats.pointbiserialr(a, b)
    (0.8660254037844386, 0.011724811003954652)
    >>> stats.pearsonr(a, b)
    (0.86602540378443871, 0.011724811003954626)
    >>> np.corrcoef(a, b)
    array([[ 1.       ,  0.8660254],
           [ 0.8660254,  1.       ]])

    """
    rpb, prob = pearsonr(x, y)
    # create result object with alias for backward compatibility
    res = SignificanceResult(rpb, prob)
    res.correlation = rpb
    return res


@_axis_nan_policy_factory(_pack_CorrelationResult, default_axis=None, n_samples=2,
                          result_to_tuple=_unpack_CorrelationResult, paired=True,
                          too_small=1, n_outputs=3)
def kendalltau(x, y, *, nan_policy='propagate',
               method='auto', variant='b', alternative='two-sided'):
    r"""Calculate Kendall's tau, a correlation measure for ordinal data.

    Kendall's tau is a measure of the correspondence between two rankings.
    Values close to 1 indicate strong agreement, and values close to -1
    indicate strong disagreement. This implements two variants of Kendall's
    tau: tau-b (the default) and tau-c (also known as Stuart's tau-c). These
    differ only in how they are normalized to lie within the range -1 to 1;
    the hypothesis tests (their p-values) are identical. Kendall's original
    tau-a is not implemented separately because both tau-b and tau-c reduce
    to tau-a in the absence of ties.

    Parameters
    ----------
    x, y : array_like
        Arrays of rankings, of the same shape. If arrays are not 1-D, they
        will be flattened to 1-D.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

        * 'propagate': returns nan
        * 'raise': throws an error
        * 'omit': performs the calculations ignoring nan values

    method : {'auto', 'asymptotic', 'exact'}, optional
        Defines which method is used to calculate the p-value [5]_.
        The following options are available (default is 'auto'):

        * 'auto': selects the appropriate method based on a trade-off
          between speed and accuracy
        * 'asymptotic': uses a normal approximation valid for large samples
        * 'exact': computes the exact p-value, but can only be used if no ties
          are present. As the sample size increases, the 'exact' computation
          time may grow and the result may lose some precision.

    variant : {'b', 'c'}, optional
        Defines which variant of Kendall's tau is returned. Default is 'b'.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis. Default is 'two-sided'.
        The following options are available:

        * 'two-sided': the rank correlation is nonzero
        * 'less': the rank correlation is negative (less than zero)
        * 'greater': the rank correlation is positive (greater than zero)

    Returns
    -------
    res : SignificanceResult
        An object containing attributes:

        statistic : float
           The tau statistic.
        pvalue : float
           The p-value for a hypothesis test whose null hypothesis is
           an absence of association, tau = 0.

    Raises
    ------
    ValueError
        If `nan_policy` is 'omit' and `variant` is not 'b' or
        if `method` is 'exact' and there are ties between `x` and `y`.

    See Also
    --------
    spearmanr : Calculates a Spearman rank-order correlation coefficient.
    theilslopes : Computes the Theil-Sen estimator for a set of points (x, y).
    weightedtau : Computes a weighted version of Kendall's tau.
    :ref:`hypothesis_kendalltau` : Extended example

    Notes
    -----
    The definition of Kendall's tau that is used is [2]_::

      tau_b = (P - Q) / sqrt((P + Q + T) * (P + Q + U))

      tau_c = 2 (P - Q) / (n**2 * (m - 1) / m)

    where P is the number of concordant pairs, Q the number of discordant
    pairs, T the number of tied pairs only in `x`, and U the number of tied pairs only
    in `y`.  If a tie occurs for the same pair in both `x` and `y`, it is not
    added to either T or U. n is the total number of samples, and m is the
    number of unique values in either `x` or `y`, whichever is smaller.

    References
    ----------
    .. [1] Maurice G. Kendall, "A New Measure of Rank Correlation", Biometrika
           Vol. 30, No. 1/2, pp. 81-93, 1938.
    .. [2] Maurice G. Kendall, "The treatment of ties in ranking problems",
           Biometrika Vol. 33, No. 3, pp. 239-251. 1945.
    .. [3] Gottfried E. Noether, "Elements of Nonparametric Statistics", John
           Wiley & Sons, 1967.
    .. [4] Peter M. Fenwick, "A new data structure for cumulative frequency
           tables", Software: Practice and Experience, Vol. 24, No. 3,
           pp. 327-336, 1994.
    .. [5] Maurice G. Kendall, "Rank Correlation Methods" (4th Edition),
           Charles Griffin & Co., 1970.

    Examples
    --------

    >>> from scipy import stats
    >>> x1 = [12, 2, 1, 12, 2]
    >>> x2 = [1, 4, 7, 1, 0]
    >>> res = stats.kendalltau(x1, x2)
    >>> res.statistic
    -0.47140452079103173
    >>> res.pvalue
    0.2827454599327748

    For a more detailed example, see :ref:`hypothesis_kendalltau`.
    """
    x = np.asarray(x).ravel()
    y = np.asarray(y).ravel()

    if x.size != y.size:
        raise ValueError("Array shapes are incompatible for broadcasting.")
    elif not x.size or not y.size:
        # Return NaN if arrays are empty
        NaN = _get_nan(x, y)
        res = SignificanceResult(NaN, NaN)
        res.correlation = NaN
        return res

    def count_rank_tie(ranks):
        cnt = np.bincount(ranks).astype('int64', copy=False)
        cnt = cnt[cnt > 1]
        # Python ints to avoid overflow down the line
        return (int((cnt * (cnt - 1) // 2).sum()),
                int((cnt * (cnt - 1.) * (cnt - 2)).sum()),
                int((cnt * (cnt - 1.) * (2*cnt + 5)).sum()))

    size = x.size
    perm = np.argsort(y)  # sort on y and convert y to dense ranks
    x, y = x[perm], y[perm]
    y = np.r_[True, y[1:] != y[:-1]].cumsum(dtype=np.intp)

    # stable sort on x and convert x to dense ranks
    perm = np.argsort(x, kind='mergesort')
    x, y = x[perm], y[perm]
    x = np.r_[True, x[1:] != x[:-1]].cumsum(dtype=np.intp)

    dis = _kendall_dis(x, y)  # discordant pairs

    obs = np.r_[True, (x[1:] != x[:-1]) | (y[1:] != y[:-1]), True]
    cnt = np.diff(np.nonzero(obs)[0]).astype('int64', copy=False)

    ntie = int((cnt * (cnt - 1) // 2).sum())  # joint ties
    xtie, x0, x1 = count_rank_tie(x)     # ties in x, stats
    ytie, y0, y1 = count_rank_tie(y)     # ties in y, stats

    tot = (size * (size - 1)) // 2

    if xtie == tot or ytie == tot:
        NaN = _get_nan(x, y)
        res = SignificanceResult(NaN, NaN)
        res.correlation = NaN
        return res

    # Note that tot = con + dis + (xtie - ntie) + (ytie - ntie) + ntie
    #               = con + dis + xtie + ytie - ntie
    con_minus_dis = tot - xtie - ytie + ntie - 2 * dis
    if variant == 'b':
        tau = con_minus_dis / np.sqrt(tot - xtie) / np.sqrt(tot - ytie)
    elif variant == 'c':
        minclasses = min(len(set(x)), len(set(y)))
        tau = 2*con_minus_dis / (size**2 * (minclasses-1)/minclasses)
    else:
        raise ValueError(f"Unknown variant of the method chosen: {variant}. "
                         "variant must be 'b' or 'c'.")

    # Limit range to fix computational errors
    tau = np.minimum(1., max(-1., tau))

    # The p-value calculation is the same for all variants since the p-value
    # depends only on con_minus_dis.
    if method == 'exact' and (xtie != 0 or ytie != 0):
        raise ValueError("Ties found, exact method cannot be used.")

    if method == 'auto':
        if (xtie == 0 and ytie == 0) and (size <= 33 or
                                          min(dis, tot-dis) <= 1):
            method = 'exact'
        else:
            method = 'asymptotic'

    if xtie == 0 and ytie == 0 and method == 'exact':
        pvalue = mstats_basic._kendall_p_exact(size, tot-dis, alternative)
    elif method == 'asymptotic':
        # con_minus_dis is approx normally distributed with this variance [3]_
        m = size * (size - 1.)
        var = ((m * (2*size + 5) - x1 - y1) / 18 +
               (2 * xtie * ytie) / m + x0 * y0 / (9 * m * (size - 2)))
        z = con_minus_dis / np.sqrt(var)
        pvalue = _get_pvalue(z, _SimpleNormal(), alternative, xp=np)
    else:
        raise ValueError(f"Unknown method {method} specified.  Use 'auto', "
                         "'exact' or 'asymptotic'.")

    # create result object with alias for backward compatibility
    res = SignificanceResult(tau[()], pvalue[()])
    res.correlation = tau[()]
    return res


def _weightedtau_n_samples(kwargs):
    rank = kwargs.get('rank', False)
    return 2 if (isinstance(rank, bool) or rank is None) else 3


@_axis_nan_policy_factory(_pack_CorrelationResult, default_axis=None,
                          n_samples=_weightedtau_n_samples,
                          result_to_tuple=_unpack_CorrelationResult, paired=True,
                          too_small=1, n_outputs=3, override={'nan_propagation': False})
def weightedtau(x, y, rank=True, weigher=None, additive=True):
    r"""Compute a weighted version of Kendall's :math:`\tau`.

    The weighted :math:`\tau` is a weighted version of Kendall's
    :math:`\tau` in which exchanges of high weight are more influential than
    exchanges of low weight. The default parameters compute the additive
    hyperbolic version of the index, :math:`\tau_\mathrm h`, which has
    been shown to provide the best balance between important and
    unimportant elements [1]_.

    The weighting is defined by means of a rank array, which assigns a
    nonnegative rank to each element (higher importance ranks being
    associated with smaller values, e.g., 0 is the highest possible rank),
    and a weigher function, which assigns a weight based on the rank to
    each element. The weight of an exchange is then the sum or the product
    of the weights of the ranks of the exchanged elements. The default
    parameters compute :math:`\tau_\mathrm h`: an exchange between
    elements with rank :math:`r` and :math:`s` (starting from zero) has
    weight :math:`1/(r+1) + 1/(s+1)`.

    Specifying a rank array is meaningful only if you have in mind an
    external criterion of importance. If, as it usually happens, you do
    not have in mind a specific rank, the weighted :math:`\tau` is
    defined by averaging the values obtained using the decreasing
    lexicographical rank by (`x`, `y`) and by (`y`, `x`). This is the
    behavior with default parameters. Note that the convention used
    here for ranking (lower values imply higher importance) is opposite
    to that used by other SciPy statistical functions.

    Parameters
    ----------
    x, y : array_like
        Arrays of scores, of the same shape. If arrays are not 1-D, they will
        be flattened to 1-D.
    rank : array_like of ints or bool, optional
        A nonnegative rank assigned to each element. If it is None, the
        decreasing lexicographical rank by (`x`, `y`) will be used: elements of
        higher rank will be those with larger `x`-values, using `y`-values to
        break ties (in particular, swapping `x` and `y` will give a different
        result). If it is False, the element indices will be used
        directly as ranks. The default is True, in which case this
        function returns the average of the values obtained using the
        decreasing lexicographical rank by (`x`, `y`) and by (`y`, `x`).
    weigher : callable, optional
        The weigher function. Must map nonnegative integers (zero
        representing the most important element) to a nonnegative weight.
        The default, None, provides hyperbolic weighing, that is,
        rank :math:`r` is mapped to weight :math:`1/(r+1)`.
    additive : bool, optional
        If True, the weight of an exchange is computed by adding the
        weights of the ranks of the exchanged elements; otherwise, the weights
        are multiplied. The default is True.

    Returns
    -------
    res: SignificanceResult
        An object containing attributes:

        statistic : float
           The weighted :math:`\tau` correlation index.
        pvalue : float
           Presently ``np.nan``, as the null distribution of the statistic is
           unknown (even in the additive hyperbolic case).

    See Also
    --------
    kendalltau : Calculates Kendall's tau.
    spearmanr : Calculates a Spearman rank-order correlation coefficient.
    theilslopes : Computes the Theil-Sen estimator for a set of points (x, y).

    Notes
    -----
    This function uses an :math:`O(n \log n)`, mergesort-based algorithm
    [1]_ that is a weighted extension of Knight's algorithm for Kendall's
    :math:`\tau` [2]_. It can compute Shieh's weighted :math:`\tau` [3]_
    between rankings without ties (i.e., permutations) by setting
    `additive` and `rank` to False, as the definition given in [1]_ is a
    generalization of Shieh's.

    NaNs are considered the smallest possible score.

    .. versionadded:: 0.19.0

    References
    ----------
    .. [1] Sebastiano Vigna, "A weighted correlation index for rankings with
           ties", Proceedings of the 24th international conference on World
           Wide Web, pp. 1166-1176, ACM, 2015.
    .. [2] W.R. Knight, "A Computer Method for Calculating Kendall's Tau with
           Ungrouped Data", Journal of the American Statistical Association,
           Vol. 61, No. 314, Part 1, pp. 436-439, 1966.
    .. [3] Grace S. Shieh. "A weighted Kendall's tau statistic", Statistics &
           Probability Letters, Vol. 39, No. 1, pp. 17-24, 1998.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> x = [12, 2, 1, 12, 2]
    >>> y = [1, 4, 7, 1, 0]
    >>> res = stats.weightedtau(x, y)
    >>> res.statistic
    -0.56694968153682723
    >>> res.pvalue
    nan
    >>> res = stats.weightedtau(x, y, additive=False)
    >>> res.statistic
    -0.62205716951801038

    NaNs are considered the smallest possible score:

    >>> x = [12, 2, 1, 12, 2]
    >>> y = [1, 4, 7, 1, np.nan]
    >>> res = stats.weightedtau(x, y)
    >>> res.statistic
    -0.56694968153682723

    This is exactly Kendall's tau:

    >>> x = [12, 2, 1, 12, 2]
    >>> y = [1, 4, 7, 1, 0]
    >>> res = stats.weightedtau(x, y, weigher=lambda x: 1)
    >>> res.statistic
    -0.47140452079103173

    >>> x = [12, 2, 1, 12, 2]
    >>> y = [1, 4, 7, 1, 0]
    >>> stats.weightedtau(x, y, rank=None)
    SignificanceResult(statistic=-0.4157652301037516, pvalue=nan)
    >>> stats.weightedtau(y, x, rank=None)
    SignificanceResult(statistic=-0.7181341329699028, pvalue=nan)

    """
    x = np.asarray(x).ravel()
    y = np.asarray(y).ravel()
    NaN = _get_nan(x, y)

    if x.size != y.size:
        raise ValueError("Array shapes are incompatible for broadcasting.")
    if not x.size:
        # Return NaN if arrays are empty
        res = SignificanceResult(NaN, NaN)
        res.correlation = NaN
        return res

    # If there are NaNs we apply _toint64()
    if np.isnan(np.sum(x)):
        x = _toint64(x)
    if np.isnan(np.sum(y)):
        y = _toint64(y)

    # Reduce to ranks unsupported types
    if x.dtype != y.dtype:
        if x.dtype != np.int64:
            x = _toint64(x)
        if y.dtype != np.int64:
            y = _toint64(y)
    else:
        if x.dtype not in (np.int32, np.int64, np.float32, np.float64):
            x = _toint64(x)
            y = _toint64(y)

    if rank is True:
        tau = np.asarray(
            _weightedrankedtau(x, y, None, weigher, additive) +
            _weightedrankedtau(y, x, None, weigher, additive)
        )[()] / 2
        res = SignificanceResult(tau, NaN)
        res.correlation = tau
        return res

    if rank is False:
        rank = np.arange(x.size, dtype=np.intp)
    elif rank is not None:
        rank = np.asarray(rank).ravel()
        rank = _toint64(rank).astype(np.intp)
        if rank.size != x.size:
            raise ValueError(
                "All inputs to `weightedtau` must be of the same size, "
                f"found x-size {x.size} and rank-size {rank.size}"
            )

    tau = np.asarray(_weightedrankedtau(x, y, rank, weigher, additive))[()]
    res = SignificanceResult(tau, NaN)
    res.correlation = tau
    return res


#####################################
#       INFERENTIAL STATISTICS      #
#####################################

TtestResultBase = _make_tuple_bunch('TtestResultBase',
                                    ['statistic', 'pvalue'], ['df'])


class TtestResult(TtestResultBase):
    """
    Result of a t-test.

    See the documentation of the particular t-test function for more
    information about the definition of the statistic and meaning of
    the confidence interval.

    Attributes
    ----------
    statistic : float or array
        The t-statistic of the sample.
    pvalue : float or array
        The p-value associated with the given alternative.
    df : float or array
        The number of degrees of freedom used in calculation of the
        t-statistic; this is one less than the size of the sample
        (``a.shape[axis]-1`` if there are no masked elements or omitted NaNs).

    Methods
    -------
    confidence_interval
        Computes a confidence interval around the population statistic
        for the given confidence level.
        The confidence interval is returned in a ``namedtuple`` with
        fields `low` and `high`.

    """

    def __init__(self, statistic, pvalue, df,  # public
                 alternative, standard_error, estimate,  # private
                 statistic_np=None, xp=None):  # private
        super().__init__(statistic, pvalue, df=df)
        self._alternative = alternative
        self._standard_error = standard_error  # denominator of t-statistic
        self._estimate = estimate  # point estimate of sample mean
        self._statistic_np = statistic if statistic_np is None else statistic_np
        self._dtype = statistic.dtype
        self._xp = array_namespace(statistic, pvalue) if xp is None else xp


    def confidence_interval(self, confidence_level=0.95):
        """
        Parameters
        ----------
        confidence_level : float
            The confidence level for the calculation of the population mean
            confidence interval. Default is 0.95.

        Returns
        -------
        ci : namedtuple
            The confidence interval is returned in a ``namedtuple`` with
            fields `low` and `high`.

        """
        low, high = _t_confidence_interval(self.df, self._statistic_np,
                                           confidence_level, self._alternative,
                                           self._dtype, self._xp)
        low = low * self._standard_error + self._estimate
        high = high * self._standard_error + self._estimate
        return ConfidenceInterval(low=low, high=high)


def pack_TtestResult(statistic, pvalue, df, alternative, standard_error,
                     estimate):
    # this could be any number of dimensions (including 0d), but there is
    # at most one unique non-NaN value
    alternative = np.atleast_1d(alternative)  # can't index 0D object
    alternative = alternative[np.isfinite(alternative)]
    alternative = alternative[0] if alternative.size else np.nan
    return TtestResult(statistic, pvalue, df=df, alternative=alternative,
                       standard_error=standard_error, estimate=estimate)


def unpack_TtestResult(res, _):
    return (res.statistic, res.pvalue, res.df, res._alternative,
            res._standard_error, res._estimate)


@xp_capabilities(cpu_only=True, exceptions=["cupy", "jax.numpy"],
                 jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(pack_TtestResult, default_axis=0, n_samples=2,
                          result_to_tuple=unpack_TtestResult, n_outputs=6)
# nan_policy handled by `_axis_nan_policy`, but needs to be left
# in signature to preserve use as a positional argument
def ttest_1samp(a, popmean, axis=0, nan_policy="propagate", alternative="two-sided"):
    """Calculate the T-test for the mean of ONE group of scores.

    This is a test for the null hypothesis that the expected value
    (mean) of a sample of independent observations `a` is equal to the given
    population mean, `popmean`.

    Parameters
    ----------
    a : array_like
        Sample observations.
    popmean : float or array_like
        Expected value in null hypothesis. If array_like, then its length along
        `axis` must equal 1, and it must otherwise be broadcastable with `a`.
    axis : int or None, optional
        Axis along which to compute test; default is 0. If None, compute over
        the whole array `a`.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values

    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis.
        The following options are available (default is 'two-sided'):

        * 'two-sided': the mean of the underlying distribution of the sample
          is different than the given population mean (`popmean`)
        * 'less': the mean of the underlying distribution of the sample is
          less than the given population mean (`popmean`)
        * 'greater': the mean of the underlying distribution of the sample is
          greater than the given population mean (`popmean`)

    Returns
    -------
    result : `~scipy.stats._result_classes.TtestResult`
        An object with the following attributes:

        statistic : float or array
            The t-statistic.
        pvalue : float or array
            The p-value associated with the given alternative.
        df : float or array
            The number of degrees of freedom used in calculation of the
            t-statistic; this is one less than the size of the sample
            (``a.shape[axis]``).

            .. versionadded:: 1.10.0

        The object also has the following method:

        confidence_interval(confidence_level=0.95)
            Computes a confidence interval around the population
            mean for the given confidence level.
            The confidence interval is returned in a ``namedtuple`` with
            fields `low` and `high`.

            .. versionadded:: 1.10.0

    Notes
    -----
    The statistic is calculated as ``(np.mean(a) - popmean)/se``, where
    ``se`` is the standard error. Therefore, the statistic will be positive
    when the sample mean is greater than the population mean and negative when
    the sample mean is less than the population mean.

    Examples
    --------
    Suppose we wish to test the null hypothesis that the mean of a population
    is equal to 0.5. We choose a confidence level of 99%; that is, we will
    reject the null hypothesis in favor of the alternative if the p-value is
    less than 0.01.

    When testing random variates from the standard uniform distribution, which
    has a mean of 0.5, we expect the data to be consistent with the null
    hypothesis most of the time.

    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng()
    >>> rvs = stats.uniform.rvs(size=50, random_state=rng)
    >>> stats.ttest_1samp(rvs, popmean=0.5)
    TtestResult(statistic=2.456308468440, pvalue=0.017628209047638, df=49)

    As expected, the p-value of 0.017 is not below our threshold of 0.01, so
    we cannot reject the null hypothesis.

    When testing data from the standard *normal* distribution, which has a mean
    of 0, we would expect the null hypothesis to be rejected.

    >>> rvs = stats.norm.rvs(size=50, random_state=rng)
    >>> stats.ttest_1samp(rvs, popmean=0.5)
    TtestResult(statistic=-7.433605518875, pvalue=1.416760157221e-09, df=49)

    Indeed, the p-value is lower than our threshold of 0.01, so we reject the
    null hypothesis in favor of the default "two-sided" alternative: the mean
    of the population is *not* equal to 0.5.

    However, suppose we were to test the null hypothesis against the
    one-sided alternative that the mean of the population is *greater* than
    0.5. Since the mean of the standard normal is less than 0.5, we would not
    expect the null hypothesis to be rejected.

    >>> stats.ttest_1samp(rvs, popmean=0.5, alternative='greater')
    TtestResult(statistic=-7.433605518875, pvalue=0.99999999929, df=49)

    Unsurprisingly, with a p-value greater than our threshold, we would not
    reject the null hypothesis.

    Note that when working with a confidence level of 99%, a true null
    hypothesis will be rejected approximately 1% of the time.

    >>> rvs = stats.uniform.rvs(size=(100, 50), random_state=rng)
    >>> res = stats.ttest_1samp(rvs, popmean=0.5, axis=1)
    >>> np.sum(res.pvalue < 0.01)
    1

    Indeed, even though all 100 samples above were drawn from the standard
    uniform distribution, which *does* have a population mean of 0.5, we would
    mistakenly reject the null hypothesis for one of them.

    `ttest_1samp` can also compute a confidence interval around the population
    mean.

    >>> rvs = stats.norm.rvs(size=50, random_state=rng)
    >>> res = stats.ttest_1samp(rvs, popmean=0)
    >>> ci = res.confidence_interval(confidence_level=0.95)
    >>> ci
    ConfidenceInterval(low=-0.3193887540880017, high=0.2898583388980972)

    The bounds of the 95% confidence interval are the
    minimum and maximum values of the parameter `popmean` for which the
    p-value of the test would be 0.05.

    >>> res = stats.ttest_1samp(rvs, popmean=ci.low)
    >>> np.testing.assert_allclose(res.pvalue, 0.05)
    >>> res = stats.ttest_1samp(rvs, popmean=ci.high)
    >>> np.testing.assert_allclose(res.pvalue, 0.05)

    Under certain assumptions about the population from which a sample
    is drawn, the confidence interval with confidence level 95% is expected
    to contain the true population mean in 95% of sample replications.

    >>> rvs = stats.norm.rvs(size=(50, 1000), loc=1, random_state=rng)
    >>> res = stats.ttest_1samp(rvs, popmean=0)
    >>> ci = res.confidence_interval()
    >>> contains_pop_mean = (ci.low < 1) & (ci.high > 1)
    >>> contains_pop_mean.sum()
    953

    """
    xp = array_namespace(a)
    a, axis = _chk_asarray(a, axis, xp=xp)

    n = _length_nonmasked(a, axis)
    df = n - 1

    if a.shape[axis] == 0:
        # This is really only needed for *testing* _axis_nan_policy decorator
        # It won't happen when the decorator is used.
        NaN = _get_nan(a)
        return TtestResult(NaN, NaN, df=NaN, alternative=NaN,
                           standard_error=NaN, estimate=NaN)

    mean = xp.mean(a, axis=axis)
    try:
        popmean = xp.asarray(popmean)
        popmean = xp.squeeze(popmean, axis=axis) if popmean.ndim > 0 else popmean
    except ValueError as e:
        raise ValueError("`popmean.shape[axis]` must equal 1.") from e
    d = mean - popmean
    v = _var(a, axis=axis, ddof=1)
    denom = xp.sqrt(v / n)

    with np.errstate(divide='ignore', invalid='ignore'):
        t = xp.divide(d, denom)
        t = t[()] if t.ndim == 0 else t

    dist = _SimpleStudentT(xp.asarray(df, dtype=t.dtype))
    prob = _get_pvalue(t, dist, alternative, xp=xp)
    prob = prob[()] if prob.ndim == 0 else prob

    # when nan_policy='omit', `df` can be different for different axis-slices
    df = xp.broadcast_to(xp.asarray(df), t.shape)
    df = df[()] if df.ndim == 0 else df
    # _axis_nan_policy decorator doesn't play well with strings
    alternative_num = {"less": -1, "two-sided": 0, "greater": 1}[alternative]
    return TtestResult(t, prob, df=df, alternative=alternative_num,
                       standard_error=denom, estimate=mean,
                       statistic_np=xp.asarray(t), xp=xp)


def _t_confidence_interval(df, t, confidence_level, alternative, dtype=None, xp=None):
    # Input validation on `alternative` is already done
    # We just need IV on confidence_level
    dtype = t.dtype if dtype is None else dtype
    xp = array_namespace(t) if xp is None else xp

    if confidence_level < 0 or confidence_level > 1:
        message = "`confidence_level` must be a number between 0 and 1."
        raise ValueError(message)

    confidence_level = xp.asarray(confidence_level, dtype=dtype)
    inf = xp.asarray(xp.inf, dtype=dtype)

    if alternative < 0:  # 'less'
        p = confidence_level
        low, high = xp.broadcast_arrays(-inf, special.stdtrit(df, p))
    elif alternative > 0:  # 'greater'
        p = 1 - confidence_level
        low, high = xp.broadcast_arrays(special.stdtrit(df, p), inf)
    elif alternative == 0:  # 'two-sided'
        tail_probability = (1 - confidence_level)/2
        p = xp.stack((tail_probability, 1-tail_probability))
        # axis of p must be the zeroth and orthogonal to all the rest
        p = xp.reshape(p, tuple([2] + [1]*xp.asarray(df).ndim))
        ci = special.stdtrit(df, p)
        low, high = ci[0, ...], ci[1, ...]
    else:  # alternative is NaN when input is empty (see _axis_nan_policy)
        nan = xp.asarray(xp.nan)
        p, nans = xp.broadcast_arrays(t, nan)
        low, high = nans, nans

    low = xp.asarray(low, dtype=dtype)
    low = low[()] if low.ndim == 0 else low
    high = xp.asarray(high, dtype=dtype)
    high = high[()] if high.ndim == 0 else high
    return low, high


def _ttest_ind_from_stats(mean1, mean2, denom, df, alternative, xp=None):
    xp = array_namespace(mean1, mean2, denom) if xp is None else xp

    d = mean1 - mean2
    with np.errstate(divide='ignore', invalid='ignore'):
        t = xp.divide(d, denom)

    dist = _SimpleStudentT(xp.asarray(df, dtype=t.dtype))
    prob = _get_pvalue(t, dist, alternative, xp=xp)
    prob = prob[()] if prob.ndim == 0 else prob

    t = t[()] if t.ndim == 0 else t
    prob = prob[()] if prob.ndim == 0 else prob
    return t, prob


def _unequal_var_ttest_denom(v1, n1, v2, n2, xp=None):
    xp = array_namespace(v1, v2) if xp is None else xp
    vn1 = v1 / n1
    vn2 = v2 / n2
    with np.errstate(divide='ignore', invalid='ignore'):
        df = (vn1 + vn2)**2 / (vn1**2 / (n1 - 1) + vn2**2 / (n2 - 1))

    # If df is undefined, variances are zero (assumes n1 > 0 & n2 > 0).
    # Hence it doesn't matter what df is as long as it's not NaN.
    df = xp.where(xp.isnan(df), 1., df)
    denom = xp.sqrt(vn1 + vn2)
    return df, denom


def _equal_var_ttest_denom(v1, n1, v2, n2, xp=None):
    xp = array_namespace(v1, v2) if xp is None else xp

    # If there is a single observation in one sample, this formula for pooled
    # variance breaks down because the variance of that sample is undefined.
    # The pooled variance is still defined, though, because the (n-1) in the
    # numerator should cancel with the (n-1) in the denominator, leaving only
    # the sum of squared differences from the mean: zero.
    v1 = xp.where(xp.asarray(n1 == 1), 0., v1)
    v2 = xp.where(xp.asarray(n2 == 1), 0., v2)

    df = n1 + n2 - 2.0
    svar = ((n1 - 1) * v1 + (n2 - 1) * v2) / df
    denom = xp.sqrt(svar * (1.0 / n1 + 1.0 / n2))
    df = xp.asarray(df, dtype=denom.dtype)
    return df, denom


Ttest_indResult = namedtuple('Ttest_indResult', ('statistic', 'pvalue'))


@xp_capabilities(cpu_only=True, exceptions=["cupy", "jax.numpy"])
def ttest_ind_from_stats(mean1, std1, nobs1, mean2, std2, nobs2,
                         equal_var=True, alternative="two-sided"):
    r"""
    T-test for means of two independent samples from descriptive statistics.

    This is a test for the null hypothesis that two independent
    samples have identical average (expected) values.

    Parameters
    ----------
    mean1 : array_like
        The mean(s) of sample 1.
    std1 : array_like
        The corrected sample standard deviation of sample 1 (i.e. ``ddof=1``).
    nobs1 : array_like
        The number(s) of observations of sample 1.
    mean2 : array_like
        The mean(s) of sample 2.
    std2 : array_like
        The corrected sample standard deviation of sample 2 (i.e. ``ddof=1``).
    nobs2 : array_like
        The number(s) of observations of sample 2.
    equal_var : bool, optional
        If True (default), perform a standard independent 2 sample test
        that assumes equal population variances [1]_.
        If False, perform Welch's t-test, which does not assume equal
        population variance [2]_.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis.
        The following options are available (default is 'two-sided'):

        * 'two-sided': the means of the distributions are unequal.
        * 'less': the mean of the first distribution is less than the
          mean of the second distribution.
        * 'greater': the mean of the first distribution is greater than the
          mean of the second distribution.

        .. versionadded:: 1.6.0

    Returns
    -------
    statistic : float or array
        The calculated t-statistics.
    pvalue : float or array
        The two-tailed p-value.

    See Also
    --------
    scipy.stats.ttest_ind

    Notes
    -----
    The statistic is calculated as ``(mean1 - mean2)/se``, where ``se`` is the
    standard error. Therefore, the statistic will be positive when `mean1` is
    greater than `mean2` and negative when `mean1` is less than `mean2`.

    This method does not check whether any of the elements of `std1` or `std2`
    are negative. If any elements of the `std1` or `std2` parameters are
    negative in a call to this method, this method will return the same result
    as if it were passed ``numpy.abs(std1)`` and ``numpy.abs(std2)``,
    respectively, instead; no exceptions or warnings will be emitted.

    References
    ----------
    .. [1] https://en.wikipedia.org/wiki/T-test#Independent_two-sample_t-test

    .. [2] https://en.wikipedia.org/wiki/Welch%27s_t-test

    Examples
    --------
    Suppose we have the summary data for two samples, as follows (with the
    Sample Variance being the corrected sample variance)::

                         Sample   Sample
                   Size   Mean   Variance
        Sample 1    13    15.0     87.5
        Sample 2    11    12.0     39.0

    Apply the t-test to this data (with the assumption that the population
    variances are equal):

    >>> import numpy as np
    >>> from scipy.stats import ttest_ind_from_stats
    >>> ttest_ind_from_stats(mean1=15.0, std1=np.sqrt(87.5), nobs1=13,
    ...                      mean2=12.0, std2=np.sqrt(39.0), nobs2=11)
    Ttest_indResult(statistic=0.9051358093310269, pvalue=0.3751996797581487)

    For comparison, here is the data from which those summary statistics
    were taken.  With this data, we can compute the same result using
    `scipy.stats.ttest_ind`:

    >>> a = np.array([1, 3, 4, 6, 11, 13, 15, 19, 22, 24, 25, 26, 26])
    >>> b = np.array([2, 4, 6, 9, 11, 13, 14, 15, 18, 19, 21])
    >>> from scipy.stats import ttest_ind
    >>> ttest_ind(a, b)
    TtestResult(statistic=0.905135809331027,
                pvalue=0.3751996797581486,
                df=22.0)

    Suppose we instead have binary data and would like to apply a t-test to
    compare the proportion of 1s in two independent groups::

                          Number of    Sample     Sample
                    Size    ones        Mean     Variance
        Sample 1    150      30         0.2        0.161073
        Sample 2    200      45         0.225      0.175251

    The sample mean :math:`\hat{p}` is the proportion of ones in the sample
    and the variance for a binary observation is estimated by
    :math:`\hat{p}(1-\hat{p})`.

    >>> ttest_ind_from_stats(mean1=0.2, std1=np.sqrt(0.161073), nobs1=150,
    ...                      mean2=0.225, std2=np.sqrt(0.175251), nobs2=200)
    Ttest_indResult(statistic=-0.5627187905196761, pvalue=0.5739887114209541)

    For comparison, we could compute the t statistic and p-value using
    arrays of 0s and 1s and `scipy.stat.ttest_ind`, as above.

    >>> group1 = np.array([1]*30 + [0]*(150-30))
    >>> group2 = np.array([1]*45 + [0]*(200-45))
    >>> ttest_ind(group1, group2)
    TtestResult(statistic=-0.5627179589855622,
                pvalue=0.573989277115258,
                df=348.0)

    """
    xp = array_namespace(mean1, std1, mean2, std2)

    mean1 = xp.asarray(mean1)
    std1 = xp.asarray(std1)
    mean2 = xp.asarray(mean2)
    std2 = xp.asarray(std2)

    if equal_var:
        df, denom = _equal_var_ttest_denom(std1**2, nobs1, std2**2, nobs2, xp=xp)
    else:
        df, denom = _unequal_var_ttest_denom(std1**2, nobs1, std2**2, nobs2, xp=xp)

    res = _ttest_ind_from_stats(mean1, mean2, denom, df, alternative)
    return Ttest_indResult(*res)


_ttest_ind_dep_msg = "Use ``method`` to perform a permutation test."


@xp_capabilities(cpu_only=True, exceptions=["cupy", "jax.numpy"])
@_deprecate_positional_args(version='1.17.0',
                            deprecated_args={'permutations', 'random_state'},
                            custom_message=_ttest_ind_dep_msg)
@_axis_nan_policy_factory(pack_TtestResult, default_axis=0, n_samples=2,
                          result_to_tuple=unpack_TtestResult, n_outputs=6)
def ttest_ind(a, b, *, axis=0, equal_var=True, nan_policy='propagate',
              permutations=None, random_state=None, alternative="two-sided",
              trim=0, method=None):
    """
    Calculate the T-test for the means of *two independent* samples of scores.

    This is a test for the null hypothesis that 2 independent samples
    have identical average (expected) values. This test assumes that the
    populations have identical variances by default.

    Parameters
    ----------
    a, b : array_like
        The arrays must have the same shape, except in the dimension
        corresponding to `axis` (the first, by default).
    axis : int or None, optional
        Axis along which to compute test. If None, compute over the whole
        arrays, `a`, and `b`.
    equal_var : bool, optional
        If True (default), perform a standard independent 2 sample test
        that assumes equal population variances [1]_.
        If False, perform Welch's t-test, which does not assume equal
        population variance [2]_.

        .. versionadded:: 0.11.0

    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values

        The 'omit' option is not currently available for permutation tests or
        one-sided asymptotic tests.

    permutations : non-negative int, np.inf, or None (default), optional
        If 0 or None (default), use the t-distribution to calculate p-values.
        Otherwise, `permutations` is  the number of random permutations that
        will be used to estimate p-values using a permutation test. If
        `permutations` equals or exceeds the number of distinct partitions of
        the pooled data, an exact test is performed instead (i.e. each
        distinct partition is used exactly once). See Notes for details.

        .. deprecated:: 1.17.0
            `permutations` is deprecated and will be removed in SciPy 1.7.0.
            Use the `n_resamples` argument of `PermutationMethod`, instead,
            and pass the instance as the `method` argument.

    random_state : {None, int, `numpy.random.Generator`,
            `numpy.random.RandomState`}, optional

        If `seed` is None (or `np.random`), the `numpy.random.RandomState`
        singleton is used.
        If `seed` is an int, a new ``RandomState`` instance is used,
        seeded with `seed`.
        If `seed` is already a ``Generator`` or ``RandomState`` instance then
        that instance is used.

        Pseudorandom number generator state used to generate permutations
        (used only when `permutations` is not None).

        .. deprecated:: 1.17.0
            `random_state` is deprecated and will be removed in SciPy 1.7.0.
            Use the `rng` argument of `PermutationMethod`, instead,
            and pass the instance as the `method` argument.

    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis.
        The following options are available (default is 'two-sided'):

        * 'two-sided': the means of the distributions underlying the samples
          are unequal.
        * 'less': the mean of the distribution underlying the first sample
          is less than the mean of the distribution underlying the second
          sample.
        * 'greater': the mean of the distribution underlying the first
          sample is greater than the mean of the distribution underlying
          the second sample.

    trim : float, optional
        If nonzero, performs a trimmed (Yuen's) t-test.
        Defines the fraction of elements to be trimmed from each end of the
        input samples. If 0 (default), no elements will be trimmed from either
        side. The number of trimmed elements from each tail is the floor of the
        trim times the number of elements. Valid range is [0, .5).
    method : ResamplingMethod, optional
        Defines the method used to compute the p-value. If `method` is an
        instance of `PermutationMethod`/`MonteCarloMethod`, the p-value is
        computed using
        `scipy.stats.permutation_test`/`scipy.stats.monte_carlo_test` with the
        provided configuration options and other appropriate settings.
        Otherwise, the p-value is computed by comparing the test statistic
        against a theoretical t-distribution.

        .. versionadded:: 1.15.0

    Returns
    -------
    result : `~scipy.stats._result_classes.TtestResult`
        An object with the following attributes:

        statistic : float or ndarray
            The t-statistic.
        pvalue : float or ndarray
            The p-value associated with the given alternative.
        df : float or ndarray
            The number of degrees of freedom used in calculation of the
            t-statistic. This is always NaN for a permutation t-test.

            .. versionadded:: 1.11.0

        The object also has the following method:

        confidence_interval(confidence_level=0.95)
            Computes a confidence interval around the difference in
            population means for the given confidence level.
            The confidence interval is returned in a ``namedtuple`` with
            fields ``low`` and ``high``.
            When a permutation t-test is performed, the confidence interval
            is not computed, and fields ``low`` and ``high`` contain NaN.

            .. versionadded:: 1.11.0

    Notes
    -----
    Suppose we observe two independent samples, e.g. flower petal lengths, and
    we are considering whether the two samples were drawn from the same
    population (e.g. the same species of flower or two species with similar
    petal characteristics) or two different populations.

    The t-test quantifies the difference between the arithmetic means
    of the two samples. The p-value quantifies the probability of observing
    as or more extreme values assuming the null hypothesis, that the
    samples are drawn from populations with the same population means, is true.
    A p-value larger than a chosen threshold (e.g. 5% or 1%) indicates that
    our observation is not so unlikely to have occurred by chance. Therefore,
    we do not reject the null hypothesis of equal population means.
    If the p-value is smaller than our threshold, then we have evidence
    against the null hypothesis of equal population means.

    By default, the p-value is determined by comparing the t-statistic of the
    observed data against a theoretical t-distribution.

    (In the following, note that the argument `permutations` itself is
    deprecated, but a nearly identical test may be performed by creating
    an instance of `scipy.stats.PermutationMethod` with ``n_resamples=permutuations``
    and passing it as the `method` argument.)
    When ``1 < permutations < binom(n, k)``, where

    * ``k`` is the number of observations in `a`,
    * ``n`` is the total number of observations in `a` and `b`, and
    * ``binom(n, k)`` is the binomial coefficient (``n`` choose ``k``),

    the data are pooled (concatenated), randomly assigned to either group `a`
    or `b`, and the t-statistic is calculated. This process is performed
    repeatedly (`permutation` times), generating a distribution of the
    t-statistic under the null hypothesis, and the t-statistic of the observed
    data is compared to this distribution to determine the p-value.
    Specifically, the p-value reported is the "achieved significance level"
    (ASL) as defined in 4.4 of [3]_. Note that there are other ways of
    estimating p-values using randomized permutation tests; for other
    options, see the more general `permutation_test`.

    When ``permutations >= binom(n, k)``, an exact test is performed: the data
    are partitioned between the groups in each distinct way exactly once.

    The permutation test can be computationally expensive and not necessarily
    more accurate than the analytical test, but it does not make strong
    assumptions about the shape of the underlying distribution.

    Use of trimming is commonly referred to as the trimmed t-test. At times
    called Yuen's t-test, this is an extension of Welch's t-test, with the
    difference being the use of winsorized means in calculation of the variance
    and the trimmed sample size in calculation of the statistic. Trimming is
    recommended if the underlying distribution is long-tailed or contaminated
    with outliers [4]_.

    The statistic is calculated as ``(np.mean(a) - np.mean(b))/se``, where
    ``se`` is the standard error. Therefore, the statistic will be positive
    when the sample mean of `a` is greater than the sample mean of `b` and
    negative when the sample mean of `a` is less than the sample mean of
    `b`.

    References
    ----------
    .. [1] https://en.wikipedia.org/wiki/T-test#Independent_two-sample_t-test

    .. [2] https://en.wikipedia.org/wiki/Welch%27s_t-test

    .. [3] B. Efron and T. Hastie. Computer Age Statistical Inference. (2016).

    .. [4] Yuen, Karen K. "The Two-Sample Trimmed t for Unequal Population
           Variances." Biometrika, vol. 61, no. 1, 1974, pp. 165-170. JSTOR,
           www.jstor.org/stable/2334299. Accessed 30 Mar. 2021.

    .. [5] Yuen, Karen K., and W. J. Dixon. "The Approximate Behaviour and
           Performance of the Two-Sample Trimmed t." Biometrika, vol. 60,
           no. 2, 1973, pp. 369-374. JSTOR, www.jstor.org/stable/2334550.
           Accessed 30 Mar. 2021.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng()

    Test with sample with identical means:

    >>> rvs1 = stats.norm.rvs(loc=5, scale=10, size=500, random_state=rng)
    >>> rvs2 = stats.norm.rvs(loc=5, scale=10, size=500, random_state=rng)
    >>> stats.ttest_ind(rvs1, rvs2)
    TtestResult(statistic=-0.4390847099199348,
                pvalue=0.6606952038870015,
                df=998.0)
    >>> stats.ttest_ind(rvs1, rvs2, equal_var=False)
    TtestResult(statistic=-0.4390847099199348,
                pvalue=0.6606952553131064,
                df=997.4602304121448)

    `ttest_ind` underestimates p for unequal variances:

    >>> rvs3 = stats.norm.rvs(loc=5, scale=20, size=500, random_state=rng)
    >>> stats.ttest_ind(rvs1, rvs3)
    TtestResult(statistic=-1.6370984482905417,
                pvalue=0.1019251574705033,
                df=998.0)
    >>> stats.ttest_ind(rvs1, rvs3, equal_var=False)
    TtestResult(statistic=-1.637098448290542,
                pvalue=0.10202110497954867,
                df=765.1098655246868)

    When ``n1 != n2``, the equal variance t-statistic is no longer equal to the
    unequal variance t-statistic:

    >>> rvs4 = stats.norm.rvs(loc=5, scale=20, size=100, random_state=rng)
    >>> stats.ttest_ind(rvs1, rvs4)
    TtestResult(statistic=-1.9481646859513422,
                pvalue=0.05186270935842703,
                df=598.0)
    >>> stats.ttest_ind(rvs1, rvs4, equal_var=False)
    TtestResult(statistic=-1.3146566100751664,
                pvalue=0.1913495266513811,
                df=110.41349083985212)

    T-test with different means, variance, and n:

    >>> rvs5 = stats.norm.rvs(loc=8, scale=20, size=100, random_state=rng)
    >>> stats.ttest_ind(rvs1, rvs5)
    TtestResult(statistic=-2.8415950600298774,
                pvalue=0.0046418707568707885,
                df=598.0)
    >>> stats.ttest_ind(rvs1, rvs5, equal_var=False)
    TtestResult(statistic=-1.8686598649188084,
                pvalue=0.06434714193919686,
                df=109.32167496550137)

    Take these two samples, one of which has an extreme tail.

    >>> a = (56, 128.6, 12, 123.8, 64.34, 78, 763.3)
    >>> b = (1.1, 2.9, 4.2)

    Use the `trim` keyword to perform a trimmed (Yuen) t-test. For example,
    using 20% trimming, ``trim=.2``, the test will reduce the impact of one
    (``np.floor(trim*len(a))``) element from each tail of sample `a`. It will
    have no effect on sample `b` because ``np.floor(trim*len(b))`` is 0.

    >>> stats.ttest_ind(a, b, trim=.2)
    TtestResult(statistic=3.4463884028073513,
                pvalue=0.01369338726499547,
                df=6.0)
    """
    xp = array_namespace(a, b)

    a, b = xp_promote(a, b, force_floating=True, xp=xp)

    if axis is None:
        a, b, axis = xp_ravel(a), xp_ravel(b), 0

    if not (0 <= trim < .5):
        raise ValueError("Trimming percentage should be 0 <= `trim` < .5.")

    if not isinstance(method, PermutationMethod | MonteCarloMethod | None):
        message = ("`method` must be an instance of `PermutationMethod`, an instance "
                   "of `MonteCarloMethod`, or None (default).")
        raise ValueError(message)

    if not is_numpy(xp) and method is not None:
        message = "Use of resampling methods is compatible only with NumPy arrays."
        raise NotImplementedError(message)

    result_shape = _broadcast_array_shapes_remove_axis((a, b), axis=axis)
    NaN = _get_nan(a, b, shape=result_shape, xp=xp)
    if xp_size(a) == 0 or xp_size(b) == 0:
        return TtestResult(NaN, NaN, df=NaN, alternative=NaN,
                           standard_error=NaN, estimate=NaN)

    alternative_nums = {"less": -1, "two-sided": 0, "greater": 1}

    # This probably should be deprecated and replaced with a `method` argument
    if permutations is not None and permutations != 0:
        message = "Use of `permutations` is compatible only with NumPy arrays."
        if not is_numpy(xp):
            raise NotImplementedError(message)

        message = "Use of `permutations` is incompatible with with use of `trim`."
        if trim != 0:
            raise NotImplementedError(message)

        t, prob = _permutation_ttest(a, b, permutations=permutations,
                                     axis=axis, equal_var=equal_var,
                                     nan_policy=nan_policy,
                                     random_state=random_state,
                                     alternative=alternative)
        df, denom, estimate = NaN, NaN, NaN

        # _axis_nan_policy decorator doesn't play well with strings
        return TtestResult(t, prob, df=df, alternative=alternative_nums[alternative],
                           standard_error=denom, estimate=estimate)

    n1 = _length_nonmasked(a, axis)
    n2 = _length_nonmasked(b, axis)

    if trim == 0:
        with np.errstate(divide='ignore', invalid='ignore'):
            v1 = _var(a, axis, ddof=1, xp=xp)
            v2 = _var(b, axis, ddof=1, xp=xp)

        m1 = xp.mean(a, axis=axis)
        m2 = xp.mean(b, axis=axis)
    else:
        message = "Use of `trim` is compatible only with NumPy arrays."
        if not is_numpy(xp):
            raise NotImplementedError(message)

        v1, m1, n1 = _ttest_trim_var_mean_len(a, trim, axis)
        v2, m2, n2 = _ttest_trim_var_mean_len(b, trim, axis)

    if equal_var:
        df, denom = _equal_var_ttest_denom(v1, n1, v2, n2, xp=xp)
    else:
        df, denom = _unequal_var_ttest_denom(v1, n1, v2, n2, xp=xp)

    if method is None:
        t, prob = _ttest_ind_from_stats(m1, m2, denom, df, alternative)
    else:
        # nan_policy is taken care of by axis_nan_policy decorator
        ttest_kwargs = dict(equal_var=equal_var, trim=trim)
        t, prob = _ttest_resampling(a, b, axis, alternative, ttest_kwargs, method)

    # when nan_policy='omit', `df` can be different for different axis-slices
    df = xp.broadcast_to(df, t.shape)
    df = df[()] if df.ndim ==0 else df
    estimate = m1 - m2

    return TtestResult(t, prob, df=df, alternative=alternative_nums[alternative],
                       standard_error=denom, estimate=estimate)


def _ttest_resampling(x, y, axis, alternative, ttest_kwargs, method):
    def statistic(x, y, axis):
        return ttest_ind(x, y, axis=axis, **ttest_kwargs).statistic

    test = (permutation_test if isinstance(method, PermutationMethod)
            else monte_carlo_test)
    method = method._asdict()

    if test is monte_carlo_test:
        # `monte_carlo_test` accepts an `rvs` tuple of callables, not an `rng`
        # If the user specified an `rng`, replace it with the default callables
        if (rng := method.pop('rng', None)) is not None:
            rng = np.random.default_rng(rng)
            method['rvs'] = rng.normal, rng.normal

    res = test((x, y,), statistic=statistic, axis=axis,
               alternative=alternative, **method)

    return res.statistic, res.pvalue


def _ttest_trim_var_mean_len(a, trim, axis):
    """Variance, mean, and length of winsorized input along specified axis"""
    # for use with `ttest_ind` when trimming.
    # further calculations in this test assume that the inputs are sorted.
    # From [4] Section 1 "Let x_1, ..., x_n be n ordered observations..."
    a = np.sort(a, axis=axis)

    # `g` is the number of elements to be replaced on each tail, converted
    # from a percentage amount of trimming
    n = a.shape[axis]
    g = int(n * trim)

    # Calculate the Winsorized variance of the input samples according to
    # specified `g`
    v = _calculate_winsorized_variance(a, g, axis)

    # the total number of elements in the trimmed samples
    n -= 2 * g

    # calculate the g-times trimmed mean, as defined in [4] (1-1)
    m = trim_mean(a, trim, axis=axis)
    return v, m, n


def _calculate_winsorized_variance(a, g, axis):
    """Calculates g-times winsorized variance along specified axis"""
    # it is expected that the input `a` is sorted along the correct axis
    if g == 0:
        return _var(a, ddof=1, axis=axis)
    # move the intended axis to the end that way it is easier to manipulate
    a_win = np.moveaxis(a, axis, -1)

    # save where NaNs are for later use.
    nans_indices = np.any(np.isnan(a_win), axis=-1)

    # Winsorization and variance calculation are done in one step in [4]
    # (1-3), but here winsorization is done first; replace the left and
    # right sides with the repeating value. This can be see in effect in (
    # 1-3) in [4], where the leftmost and rightmost tails are replaced with
    # `(g + 1) * x_{g + 1}` on the left and `(g + 1) * x_{n - g}` on the
    # right. Zero-indexing turns `g + 1` to `g`, and `n - g` to `- g - 1` in
    # array indexing.
    a_win[..., :g] = a_win[..., [g]]
    a_win[..., -g:] = a_win[..., [-g - 1]]

    # Determine the variance. In [4], the degrees of freedom is expressed as
    # `h - 1`, where `h = n - 2g` (unnumbered equations in Section 1, end of
    # page 369, beginning of page 370). This is converted to NumPy's format,
    # `n - ddof` for use with `np.var`. The result is converted to an
    # array to accommodate indexing later.
    var_win = np.asarray(_var(a_win, ddof=(2 * g + 1), axis=-1))

    # with `nan_policy='propagate'`, NaNs may be completely trimmed out
    # because they were sorted into the tail of the array. In these cases,
    # replace computed variances with `np.nan`.
    var_win[nans_indices] = np.nan
    return var_win


def _permutation_distribution_t(data, permutations, size_a, equal_var,
                                random_state=None):
    """Generation permutation distribution of t statistic"""

    random_state = check_random_state(random_state)

    # prepare permutation indices
    size = data.shape[-1]
    # number of distinct combinations
    n_max = special.comb(size, size_a)

    if permutations < n_max:
        perm_generator = (random_state.permutation(size)
                          for i in range(permutations))
    else:
        permutations = n_max
        perm_generator = (np.concatenate(z)
                          for z in _all_partitions(size_a, size-size_a))

    t_stat = []
    for indices in _batch_generator(perm_generator, batch=50):
        # get one batch from perm_generator at a time as a list
        indices = np.array(indices)
        # generate permutations
        data_perm = data[..., indices]
        # move axis indexing permutations to position 0 to broadcast
        # nicely with t_stat_observed, which doesn't have this dimension
        data_perm = np.moveaxis(data_perm, -2, 0)

        a = data_perm[..., :size_a]
        b = data_perm[..., size_a:]
        t_stat.append(_calc_t_stat(a, b, equal_var))

    t_stat = np.concatenate(t_stat, axis=0)

    return t_stat, permutations, n_max


def _calc_t_stat(a, b, equal_var, axis=-1):
    """Calculate the t statistic along the given dimension."""
    na = a.shape[axis]
    nb = b.shape[axis]
    avg_a = np.mean(a, axis=axis)
    avg_b = np.mean(b, axis=axis)
    var_a = _var(a, axis=axis, ddof=1)
    var_b = _var(b, axis=axis, ddof=1)

    if not equal_var:
        _, denom = _unequal_var_ttest_denom(var_a, na, var_b, nb)
    else:
        _, denom = _equal_var_ttest_denom(var_a, na, var_b, nb)

    return (avg_a-avg_b)/denom


def _permutation_ttest(a, b, permutations, axis=0, equal_var=True,
                       nan_policy='propagate', random_state=None,
                       alternative="two-sided"):
    """
    Calculates the T-test for the means of TWO INDEPENDENT samples of scores
    using permutation methods.

    This test is similar to `stats.ttest_ind`, except it doesn't rely on an
    approximate normality assumption since it uses a permutation test.
    This function is only called from ttest_ind when permutations is not None.

    Parameters
    ----------
    a, b : array_like
        The arrays must be broadcastable, except along the dimension
        corresponding to `axis` (the zeroth, by default).
    axis : int, optional
        The axis over which to operate on a and b.
    permutations : int, optional
        Number of permutations used to calculate p-value. If greater than or
        equal to the number of distinct permutations, perform an exact test.
    equal_var : bool, optional
        If False, an equal variance (Welch's) t-test is conducted.  Otherwise,
        an ordinary t-test is conducted.
    random_state : {None, int, `numpy.random.Generator`}, optional
        If `seed` is None the `numpy.random.Generator` singleton is used.
        If `seed` is an int, a new ``Generator`` instance is used,
        seeded with `seed`.
        If `seed` is already a ``Generator`` instance then that instance is
        used.
        Pseudorandom number generator state used for generating random
        permutations.

    Returns
    -------
    statistic : float or array
        The calculated t-statistic.
    pvalue : float or array
        The p-value.

    """
    if permutations < 0 or (np.isfinite(permutations) and
                            int(permutations) != permutations):
        raise ValueError("Permutations must be a non-negative integer.")

    random_state = check_random_state(random_state)

    t_stat_observed = _calc_t_stat(a, b, equal_var, axis=axis)

    na = a.shape[axis]
    mat = _broadcast_concatenate((a, b), axis=axis)
    mat = np.moveaxis(mat, axis, -1)

    t_stat, permutations, n_max = _permutation_distribution_t(
        mat, permutations, size_a=na, equal_var=equal_var,
        random_state=random_state)

    compare = {"less": np.less_equal,
               "greater": np.greater_equal,
               "two-sided": lambda x, y: (x <= -np.abs(y)) | (x >= np.abs(y))}

    # Calculate the p-values
    cmps = compare[alternative](t_stat, t_stat_observed)
    # Randomized test p-value calculation should use biased estimate; see e.g.
    # https://www.degruyter.com/document/doi/10.2202/1544-6115.1585/
    adjustment = 1 if n_max > permutations else 0
    pvalues = (cmps.sum(axis=0) + adjustment) / (permutations + adjustment)

    # nans propagate naturally in statistic calculation, but need to be
    # propagated manually into pvalues
    if nan_policy == 'propagate' and np.isnan(t_stat_observed).any():
        if np.ndim(pvalues) == 0:
            pvalues = np.float64(np.nan)
        else:
            pvalues[np.isnan(t_stat_observed)] = np.nan

    return (t_stat_observed, pvalues)


def _get_len(a, axis, msg):
    try:
        n = a.shape[axis]
    except IndexError:
        raise AxisError(axis, a.ndim, msg) from None
    return n


@xp_capabilities(cpu_only=True, exceptions=["cupy", "jax.numpy"],
                 jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(pack_TtestResult, default_axis=0, n_samples=2,
                          result_to_tuple=unpack_TtestResult, n_outputs=6,
                          paired=True)
def ttest_rel(a, b, axis=0, nan_policy='propagate', alternative="two-sided"):
    """Calculate the t-test on TWO RELATED samples of scores, a and b.

    This is a test for the null hypothesis that two related or
    repeated samples have identical average (expected) values.

    Parameters
    ----------
    a, b : array_like
        The arrays must have the same shape.
    axis : int or None, optional
        Axis along which to compute test. If None, compute over the whole
        arrays, `a`, and `b`.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis.
        The following options are available (default is 'two-sided'):

        * 'two-sided': the means of the distributions underlying the samples
          are unequal.
        * 'less': the mean of the distribution underlying the first sample
          is less than the mean of the distribution underlying the second
          sample.
        * 'greater': the mean of the distribution underlying the first
          sample is greater than the mean of the distribution underlying
          the second sample.

        .. versionadded:: 1.6.0

    Returns
    -------
    result : `~scipy.stats._result_classes.TtestResult`
        An object with the following attributes:

        statistic : float or array
            The t-statistic.
        pvalue : float or array
            The p-value associated with the given alternative.
        df : float or array
            The number of degrees of freedom used in calculation of the
            t-statistic; this is one less than the size of the sample
            (``a.shape[axis]``).

            .. versionadded:: 1.10.0

        The object also has the following method:

        confidence_interval(confidence_level=0.95)
            Computes a confidence interval around the difference in
            population means for the given confidence level.
            The confidence interval is returned in a ``namedtuple`` with
            fields `low` and `high`.

            .. versionadded:: 1.10.0

    Notes
    -----
    Examples for use are scores of the same set of student in
    different exams, or repeated sampling from the same units. The
    test measures whether the average score differs significantly
    across samples (e.g. exams). If we observe a large p-value, for
    example greater than 0.05 or 0.1 then we cannot reject the null
    hypothesis of identical average scores. If the p-value is smaller
    than the threshold, e.g. 1%, 5% or 10%, then we reject the null
    hypothesis of equal averages. Small p-values are associated with
    large t-statistics.

    The t-statistic is calculated as ``np.mean(a - b)/se``, where ``se`` is the
    standard error. Therefore, the t-statistic will be positive when the sample
    mean of ``a - b`` is greater than zero and negative when the sample mean of
    ``a - b`` is less than zero.

    References
    ----------
    https://en.wikipedia.org/wiki/T-test#Dependent_t-test_for_paired_samples

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng()

    >>> rvs1 = stats.norm.rvs(loc=5, scale=10, size=500, random_state=rng)
    >>> rvs2 = (stats.norm.rvs(loc=5, scale=10, size=500, random_state=rng)
    ...         + stats.norm.rvs(scale=0.2, size=500, random_state=rng))
    >>> stats.ttest_rel(rvs1, rvs2)
    TtestResult(statistic=-0.4549717054410304, pvalue=0.6493274702088672, df=499)
    >>> rvs3 = (stats.norm.rvs(loc=8, scale=10, size=500, random_state=rng)
    ...         + stats.norm.rvs(scale=0.2, size=500, random_state=rng))
    >>> stats.ttest_rel(rvs1, rvs3)
    TtestResult(statistic=-5.879467544540889, pvalue=7.540777129099917e-09, df=499)

    """
    return ttest_1samp(a - b, popmean=0., axis=axis, alternative=alternative,
                       _no_deco=True)


# Map from names to lambda_ values used in power_divergence().
_power_div_lambda_names = {
    "pearson": 1,
    "log-likelihood": 0,
    "freeman-tukey": -0.5,
    "mod-log-likelihood": -1,
    "neyman": -2,
    "cressie-read": 2/3,
}


Power_divergenceResult = namedtuple('Power_divergenceResult',
                                    ('statistic', 'pvalue'))


def _pd_nsamples(kwargs):
    return 2 if kwargs.get('f_exp', None) is not None else 1


@xp_capabilities(jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(Power_divergenceResult, paired=True, n_samples=_pd_nsamples,
                          too_small=-1)
def power_divergence(f_obs, f_exp=None, ddof=0, axis=0, lambda_=None):
    """Cressie-Read power divergence statistic and goodness of fit test.

    This function tests the null hypothesis that the categorical data
    has the given frequencies, using the Cressie-Read power divergence
    statistic.

    Parameters
    ----------
    f_obs : array_like
        Observed frequencies in each category.
    f_exp : array_like, optional
        Expected frequencies in each category.  By default the categories are
        assumed to be equally likely.
    ddof : int, optional
        "Delta degrees of freedom": adjustment to the degrees of freedom
        for the p-value.  The p-value is computed using a chi-squared
        distribution with ``k - 1 - ddof`` degrees of freedom, where `k`
        is the number of observed frequencies.  The default value of `ddof`
        is 0.
    axis : int or None, optional
        The axis of the broadcast result of `f_obs` and `f_exp` along which to
        apply the test.  If axis is None, all values in `f_obs` are treated
        as a single data set.  Default is 0.
    lambda_ : float or str, optional
        The power in the Cressie-Read power divergence statistic.  The default
        is 1.  For convenience, `lambda_` may be assigned one of the following
        strings, in which case the corresponding numerical value is used:

        * ``"pearson"`` (value 1)
            Pearson's chi-squared statistic. In this case, the function is
            equivalent to `chisquare`.
        * ``"log-likelihood"`` (value 0)
            Log-likelihood ratio. Also known as the G-test [3]_.
        * ``"freeman-tukey"`` (value -1/2)
            Freeman-Tukey statistic.
        * ``"mod-log-likelihood"`` (value -1)
            Modified log-likelihood ratio.
        * ``"neyman"`` (value -2)
            Neyman's statistic.
        * ``"cressie-read"`` (value 2/3)
            The power recommended in [5]_.

    Returns
    -------
    res: Power_divergenceResult
        An object containing attributes:

        statistic : float or ndarray
            The Cressie-Read power divergence test statistic.  The value is
            a float if `axis` is None or if` `f_obs` and `f_exp` are 1-D.
        pvalue : float or ndarray
            The p-value of the test.  The value is a float if `ddof` and the
            return value `stat` are scalars.

    See Also
    --------
    chisquare

    Notes
    -----
    This test is invalid when the observed or expected frequencies in each
    category are too small.  A typical rule is that all of the observed
    and expected frequencies should be at least 5.

    Also, the sum of the observed and expected frequencies must be the same
    for the test to be valid; `power_divergence` raises an error if the sums
    do not agree within a relative tolerance of ``eps**0.5``, where ``eps``
    is the precision of the input dtype.

    When `lambda_` is less than zero, the formula for the statistic involves
    dividing by `f_obs`, so a warning or error may be generated if any value
    in `f_obs` is 0.

    Similarly, a warning or error may be generated if any value in `f_exp` is
    zero when `lambda_` >= 0.

    The default degrees of freedom, k-1, are for the case when no parameters
    of the distribution are estimated. If p parameters are estimated by
    efficient maximum likelihood then the correct degrees of freedom are
    k-1-p. If the parameters are estimated in a different way, then the
    dof can be between k-1-p and k-1. However, it is also possible that
    the asymptotic distribution is not a chisquare, in which case this
    test is not appropriate.

    References
    ----------
    .. [1] Lowry, Richard.  "Concepts and Applications of Inferential
           Statistics". Chapter 8.
           https://web.archive.org/web/20171015035606/http://faculty.vassar.edu/lowry/ch8pt1.html
    .. [2] "Chi-squared test", https://en.wikipedia.org/wiki/Chi-squared_test
    .. [3] "G-test", https://en.wikipedia.org/wiki/G-test
    .. [4] Sokal, R. R. and Rohlf, F. J. "Biometry: the principles and
           practice of statistics in biological research", New York: Freeman
           (1981)
    .. [5] Cressie, N. and Read, T. R. C., "Multinomial Goodness-of-Fit
           Tests", J. Royal Stat. Soc. Series B, Vol. 46, No. 3 (1984),
           pp. 440-464.

    Examples
    --------
    (See `chisquare` for more examples.)

    When just `f_obs` is given, it is assumed that the expected frequencies
    are uniform and given by the mean of the observed frequencies.  Here we
    perform a G-test (i.e. use the log-likelihood ratio statistic):

    >>> import numpy as np
    >>> from scipy.stats import power_divergence
    >>> power_divergence([16, 18, 16, 14, 12, 12], lambda_='log-likelihood')
    (2.006573162632538, 0.84823476779463769)

    The expected frequencies can be given with the `f_exp` argument:

    >>> power_divergence([16, 18, 16, 14, 12, 12],
    ...                  f_exp=[16, 16, 16, 16, 16, 8],
    ...                  lambda_='log-likelihood')
    (3.3281031458963746, 0.6495419288047497)

    When `f_obs` is 2-D, by default the test is applied to each column.

    >>> obs = np.array([[16, 18, 16, 14, 12, 12], [32, 24, 16, 28, 20, 24]]).T
    >>> obs.shape
    (6, 2)
    >>> power_divergence(obs, lambda_="log-likelihood")
    (array([ 2.00657316,  6.77634498]), array([ 0.84823477,  0.23781225]))

    By setting ``axis=None``, the test is applied to all data in the array,
    which is equivalent to applying the test to the flattened array.

    >>> power_divergence(obs, axis=None)
    (23.31034482758621, 0.015975692534127565)
    >>> power_divergence(obs.ravel())
    (23.31034482758621, 0.015975692534127565)

    `ddof` is the change to make to the default degrees of freedom.

    >>> power_divergence([16, 18, 16, 14, 12, 12], ddof=1)
    (2.0, 0.73575888234288467)

    The calculation of the p-values is done by broadcasting the
    test statistic with `ddof`.

    >>> power_divergence([16, 18, 16, 14, 12, 12], ddof=[0,1,2])
    (2.0, array([ 0.84914504,  0.73575888,  0.5724067 ]))

    `f_obs` and `f_exp` are also broadcast.  In the following, `f_obs` has
    shape (6,) and `f_exp` has shape (2, 6), so the result of broadcasting
    `f_obs` and `f_exp` has shape (2, 6).  To compute the desired chi-squared
    statistics, we must use ``axis=1``:

    >>> power_divergence([16, 18, 16, 14, 12, 12],
    ...                  f_exp=[[16, 16, 16, 16, 16, 8],
    ...                         [8, 20, 20, 16, 12, 12]],
    ...                  axis=1)
    (array([ 3.5 ,  9.25]), array([ 0.62338763,  0.09949846]))

    """
    return _power_divergence(f_obs, f_exp=f_exp, ddof=ddof, axis=axis, lambda_=lambda_)


def _power_divergence(f_obs, f_exp, ddof, axis, lambda_, sum_check=True):
    xp = array_namespace(f_obs, f_exp)
    f_obs, f_exp = xp_promote(f_obs, f_exp, force_floating=True, xp=xp)

    # Convert the input argument `lambda_` to a numerical value.
    if isinstance(lambda_, str):
        if lambda_ not in _power_div_lambda_names:
            names = repr(list(_power_div_lambda_names.keys()))[1:-1]
            raise ValueError(f"invalid string for lambda_: {lambda_!r}. "
                             f"Valid strings are {names}")
        lambda_ = _power_div_lambda_names[lambda_]
    elif lambda_ is None:
        lambda_ = 1

    if f_exp is not None:
        # not sure why we force to float64, but not going to touch it
        f_obs_float = xp.asarray(f_obs, dtype=xp.float64)
        bshape = _broadcast_shapes((f_obs_float.shape, f_exp.shape))
        f_obs_float = xp.broadcast_to(f_obs_float, bshape)
        f_exp = xp.broadcast_to(f_exp, bshape)
        f_obs_float, f_exp = _share_masks(f_obs_float, f_exp, xp=xp)

        if sum_check:
            dtype_res = xp.result_type(f_obs.dtype, f_exp.dtype)
            rtol = xp.finfo(dtype_res).eps**0.5  # to pass existing tests
            with np.errstate(invalid='ignore'):
                f_obs_sum = xp.sum(f_obs_float, axis=axis)
                f_exp_sum = xp.sum(f_exp, axis=axis)
                relative_diff = (xp.abs(f_obs_sum - f_exp_sum) /
                                 xp.minimum(f_obs_sum, f_exp_sum))
                diff_gt_tol = xp.any(relative_diff > rtol, axis=None)
            if diff_gt_tol:
                msg = (f"For each axis slice, the sum of the observed "
                       f"frequencies must agree with the sum of the "
                       f"expected frequencies to a relative tolerance "
                       f"of {rtol}, but the percent differences are:\n"
                       f"{relative_diff}")
                raise ValueError(msg)

    else:
        # Avoid warnings with the edge case of a data set with length 0
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            f_exp = xp.mean(f_obs, axis=axis, keepdims=True)

    # `terms` is the array of terms that are summed along `axis` to create
    # the test statistic.  We use some specialized code for a few special
    # cases of lambda_.
    if lambda_ == 1:
        # Pearson's chi-squared statistic
        terms = (f_obs - f_exp)**2 / f_exp
    elif lambda_ == 0:
        # Log-likelihood ratio (i.e. G-test)
        terms = 2.0 * special.xlogy(f_obs, f_obs / f_exp)
    elif lambda_ == -1:
        # Modified log-likelihood ratio
        terms = 2.0 * special.xlogy(f_exp, f_exp / f_obs)
    else:
        # General Cressie-Read power divergence.
        terms = f_obs * ((f_obs / f_exp)**lambda_ - 1)
        terms /= 0.5 * lambda_ * (lambda_ + 1)

    stat = xp.sum(terms, axis=axis)

    num_obs = xp.asarray(_length_nonmasked(terms, axis))

    df = num_obs - 1 - ddof
    chi2 = _SimpleChi2(df)
    pvalue = _get_pvalue(stat, chi2 , alternative='greater', symmetric=False, xp=xp)

    stat = stat[()] if stat.ndim == 0 else stat
    pvalue = pvalue[()] if pvalue.ndim == 0 else pvalue

    return Power_divergenceResult(stat, pvalue)



@xp_capabilities(jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(Power_divergenceResult, paired=True, n_samples=_pd_nsamples,
                          too_small=-1)
def chisquare(f_obs, f_exp=None, ddof=0, axis=0, *, sum_check=True):
    """Perform Pearson's chi-squared test.

    Pearson's chi-squared test [1]_ is a goodness-of-fit test for a multinomial
    distribution with given probabilities; that is, it assesses the null hypothesis
    that the observed frequencies (counts) are obtained by independent
    sampling of *N* observations from a categorical distribution with given
    expected frequencies.

    Parameters
    ----------
    f_obs : array_like
        Observed frequencies in each category.
    f_exp : array_like, optional
        Expected frequencies in each category. By default, the categories are
        assumed to be equally likely.
    ddof : int, optional
        "Delta degrees of freedom": adjustment to the degrees of freedom
        for the p-value.  The p-value is computed using a chi-squared
        distribution with ``k - 1 - ddof`` degrees of freedom, where ``k``
        is the number of categories.  The default value of `ddof` is 0.
    axis : int or None, optional
        The axis of the broadcast result of `f_obs` and `f_exp` along which to
        apply the test.  If axis is None, all values in `f_obs` are treated
        as a single data set.  Default is 0.
    sum_check : bool, optional
        Whether to perform a check that ``sum(f_obs) - sum(f_exp) == 0``. If True,
        (default) raise an error when the relative difference exceeds the square root
        of the precision of the data type. See Notes for rationale and possible
        exceptions.

    Returns
    -------
    res: Power_divergenceResult
        An object containing attributes:

        statistic : float or ndarray
            The chi-squared test statistic.  The value is a float if `axis` is
            None or `f_obs` and `f_exp` are 1-D.
        pvalue : float or ndarray
            The p-value of the test.  The value is a float if `ddof` and the
            result attribute `statistic` are scalars.

    See Also
    --------
    scipy.stats.power_divergence
    scipy.stats.fisher_exact : Fisher exact test on a 2x2 contingency table.
    scipy.stats.barnard_exact : An unconditional exact test. An alternative
        to chi-squared test for small sample sizes.
    :ref:`hypothesis_chisquare` : Extended example

    Notes
    -----
    This test is invalid when the observed or expected frequencies in each
    category are too small.  A typical rule is that all of the observed
    and expected frequencies should be at least 5. According to [2]_, the
    total number of observations is recommended to be greater than 13,
    otherwise exact tests (such as Barnard's Exact test) should be used
    because they do not overreject.

    The default degrees of freedom, k-1, are for the case when no parameters
    of the distribution are estimated. If p parameters are estimated by
    efficient maximum likelihood then the correct degrees of freedom are
    k-1-p. If the parameters are estimated in a different way, then the
    dof can be between k-1-p and k-1. However, it is also possible that
    the asymptotic distribution is not chi-square, in which case this test
    is not appropriate.

    For Pearson's chi-squared test, the total observed and expected counts must match
    for the p-value to accurately reflect the probability of observing such an extreme
    value of the statistic under the null hypothesis.
    This function may be used to perform other statistical tests that do not require
    the total counts to be equal. For instance, to test the null hypothesis that
    ``f_obs[i]`` is Poisson-distributed with expectation ``f_exp[i]``, set ``ddof=-1``
    and ``sum_check=False``. This test follows from the fact that a Poisson random
    variable with mean and variance ``f_exp[i]`` is approximately normal with the
    same mean and variance; the chi-squared statistic standardizes, squares, and sums
    the observations; and the sum of ``n`` squared standard normal variables follows
    the chi-squared distribution with ``n`` degrees of freedom.

    References
    ----------
    .. [1] "Pearson's chi-squared test".
           *Wikipedia*. https://en.wikipedia.org/wiki/Pearson%27s_chi-squared_test
    .. [2] Pearson, Karl. "On the criterion that a given system of deviations from the probable
           in the case of a correlated system of variables is such that it can be reasonably
           supposed to have arisen from random sampling", Philosophical Magazine. Series 5. 50
           (1900), pp. 157-175.

    Examples
    --------
    When only the mandatory `f_obs` argument is given, it is assumed that the
    expected frequencies are uniform and given by the mean of the observed
    frequencies:

    >>> import numpy as np
    >>> from scipy.stats import chisquare
    >>> chisquare([16, 18, 16, 14, 12, 12])
    Power_divergenceResult(statistic=2.0, pvalue=0.84914503608460956)

    The optional `f_exp` argument gives the expected frequencies.

    >>> chisquare([16, 18, 16, 14, 12, 12], f_exp=[16, 16, 16, 16, 16, 8])
    Power_divergenceResult(statistic=3.5, pvalue=0.62338762774958223)

    When `f_obs` is 2-D, by default the test is applied to each column.

    >>> obs = np.array([[16, 18, 16, 14, 12, 12], [32, 24, 16, 28, 20, 24]]).T
    >>> obs.shape
    (6, 2)
    >>> chisquare(obs)
    Power_divergenceResult(statistic=array([2.        , 6.66666667]), pvalue=array([0.84914504, 0.24663415]))

    By setting ``axis=None``, the test is applied to all data in the array,
    which is equivalent to applying the test to the flattened array.

    >>> chisquare(obs, axis=None)
    Power_divergenceResult(statistic=23.31034482758621, pvalue=0.015975692534127565)
    >>> chisquare(obs.ravel())
    Power_divergenceResult(statistic=23.310344827586206, pvalue=0.01597569253412758)

    `ddof` is the change to make to the default degrees of freedom.

    >>> chisquare([16, 18, 16, 14, 12, 12], ddof=1)
    Power_divergenceResult(statistic=2.0, pvalue=0.7357588823428847)

    The calculation of the p-values is done by broadcasting the
    chi-squared statistic with `ddof`.

    >>> chisquare([16, 18, 16, 14, 12, 12], ddof=[0, 1, 2])
    Power_divergenceResult(statistic=2.0, pvalue=array([0.84914504, 0.73575888, 0.5724067 ]))

    `f_obs` and `f_exp` are also broadcast.  In the following, `f_obs` has
    shape (6,) and `f_exp` has shape (2, 6), so the result of broadcasting
    `f_obs` and `f_exp` has shape (2, 6).  To compute the desired chi-squared
    statistics, we use ``axis=1``:

    >>> chisquare([16, 18, 16, 14, 12, 12],
    ...           f_exp=[[16, 16, 16, 16, 16, 8], [8, 20, 20, 16, 12, 12]],
    ...           axis=1)
    Power_divergenceResult(statistic=array([3.5 , 9.25]), pvalue=array([0.62338763, 0.09949846]))

    For a more detailed example, see :ref:`hypothesis_chisquare`.
    """  # noqa: E501
    return _power_divergence(f_obs, f_exp=f_exp, ddof=ddof, axis=axis,
                             lambda_="pearson", sum_check=sum_check)


KstestResult = _make_tuple_bunch('KstestResult', ['statistic', 'pvalue'],
                                 ['statistic_location', 'statistic_sign'])


def _compute_dplus(cdfvals, x):
    """Computes D+ as used in the Kolmogorov-Smirnov test.

    Parameters
    ----------
    cdfvals : array_like
        Sorted array of CDF values between 0 and 1
    x: array_like
        Sorted array of the stochastic variable itself

    Returns
    -------
    res: Pair with the following elements:
        - The maximum distance of the CDF values below Uniform(0, 1).
        - The location at which the maximum is reached.

    """
    n = len(cdfvals)
    dplus = (np.arange(1.0, n + 1) / n - cdfvals)
    amax = dplus.argmax()
    loc_max = x[amax]
    return (dplus[amax], loc_max)


def _compute_dminus(cdfvals, x):
    """Computes D- as used in the Kolmogorov-Smirnov test.

    Parameters
    ----------
    cdfvals : array_like
        Sorted array of CDF values between 0 and 1
    x: array_like
        Sorted array of the stochastic variable itself

    Returns
    -------
    res: Pair with the following elements:
        - Maximum distance of the CDF values above Uniform(0, 1)
        - The location at which the maximum is reached.
    """
    n = len(cdfvals)
    dminus = (cdfvals - np.arange(0.0, n)/n)
    amax = dminus.argmax()
    loc_max = x[amax]
    return (dminus[amax], loc_max)


def _tuple_to_KstestResult(statistic, pvalue,
                           statistic_location, statistic_sign):
    return KstestResult(statistic, pvalue,
                        statistic_location=statistic_location,
                        statistic_sign=statistic_sign)


def _KstestResult_to_tuple(res, _):
    return *res, res.statistic_location, res.statistic_sign


@_axis_nan_policy_factory(_tuple_to_KstestResult, n_samples=1, n_outputs=4,
                          result_to_tuple=_KstestResult_to_tuple)
@_rename_parameter("mode", "method")
def ks_1samp(x, cdf, args=(), alternative='two-sided', method='auto'):
    """
    Performs the one-sample Kolmogorov-Smirnov test for goodness of fit.

    This test compares the underlying distribution F(x) of a sample
    against a given continuous distribution G(x). See Notes for a description
    of the available null and alternative hypotheses.

    Parameters
    ----------
    x : array_like
        a 1-D array of observations of iid random variables.
    cdf : callable
        callable used to calculate the cdf.
    args : tuple, sequence, optional
        Distribution parameters, used with `cdf`.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the null and alternative hypotheses. Default is 'two-sided'.
        Please see explanations in the Notes below.
    method : {'auto', 'exact', 'approx', 'asymp'}, optional
        Defines the distribution used for calculating the p-value.
        The following options are available (default is 'auto'):

          * 'auto' : selects one of the other options.
          * 'exact' : uses the exact distribution of test statistic.
          * 'approx' : approximates the two-sided probability with twice
            the one-sided probability
          * 'asymp': uses asymptotic distribution of test statistic

    Returns
    -------
    res: KstestResult
        An object containing attributes:

        statistic : float
            KS test statistic, either D+, D-, or D (the maximum of the two)
        pvalue : float
            One-tailed or two-tailed p-value.
        statistic_location : float
            Value of `x` corresponding with the KS statistic; i.e., the
            distance between the empirical distribution function and the
            hypothesized cumulative distribution function is measured at this
            observation.
        statistic_sign : int
            +1 if the KS statistic is the maximum positive difference between
            the empirical distribution function and the hypothesized cumulative
            distribution function (D+); -1 if the KS statistic is the maximum
            negative difference (D-).


    See Also
    --------
    ks_2samp, kstest

    Notes
    -----
    There are three options for the null and corresponding alternative
    hypothesis that can be selected using the `alternative` parameter.

    - `two-sided`: The null hypothesis is that the two distributions are
      identical, F(x)=G(x) for all x; the alternative is that they are not
      identical.

    - `less`: The null hypothesis is that F(x) >= G(x) for all x; the
      alternative is that F(x) < G(x) for at least one x.

    - `greater`: The null hypothesis is that F(x) <= G(x) for all x; the
      alternative is that F(x) > G(x) for at least one x.

    Note that the alternative hypotheses describe the *CDFs* of the
    underlying distributions, not the observed values. For example,
    suppose x1 ~ F and x2 ~ G. If F(x) > G(x) for all x, the values in
    x1 tend to be less than those in x2.

    Examples
    --------
    Suppose we wish to test the null hypothesis that a sample is distributed
    according to the standard normal.
    We choose a confidence level of 95%; that is, we will reject the null
    hypothesis in favor of the alternative if the p-value is less than 0.05.

    When testing uniformly distributed data, we would expect the
    null hypothesis to be rejected.

    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng()
    >>> stats.ks_1samp(stats.uniform.rvs(size=100, random_state=rng),
    ...                stats.norm.cdf)
    KstestResult(statistic=0.5001899973268688,
                 pvalue=1.1616392184763533e-23,
                 statistic_location=0.00047625268963724654,
                 statistic_sign=-1)

    Indeed, the p-value is lower than our threshold of 0.05, so we reject the
    null hypothesis in favor of the default "two-sided" alternative: the data
    are *not* distributed according to the standard normal.

    When testing random variates from the standard normal distribution, we
    expect the data to be consistent with the null hypothesis most of the time.

    >>> x = stats.norm.rvs(size=100, random_state=rng)
    >>> stats.ks_1samp(x, stats.norm.cdf)
    KstestResult(statistic=0.05345882212970396,
                 pvalue=0.9227159037744717,
                 statistic_location=-1.2451343873745018,
                 statistic_sign=1)

    As expected, the p-value of 0.92 is not below our threshold of 0.05, so
    we cannot reject the null hypothesis.

    Suppose, however, that the random variates are distributed according to
    a normal distribution that is shifted toward greater values. In this case,
    the cumulative density function (CDF) of the underlying distribution tends
    to be *less* than the CDF of the standard normal. Therefore, we would
    expect the null hypothesis to be rejected with ``alternative='less'``:

    >>> x = stats.norm.rvs(size=100, loc=0.5, random_state=rng)
    >>> stats.ks_1samp(x, stats.norm.cdf, alternative='less')
    KstestResult(statistic=0.17482387821055168,
                 pvalue=0.001913921057766743,
                 statistic_location=0.3713830565352756,
                 statistic_sign=-1)

    and indeed, with p-value smaller than our threshold, we reject the null
    hypothesis in favor of the alternative.

    """
    mode = method

    alternative = {'t': 'two-sided', 'g': 'greater', 'l': 'less'}.get(
        alternative.lower()[0], alternative)
    if alternative not in ['two-sided', 'greater', 'less']:
        raise ValueError(f"Unexpected value {alternative=}")

    N = len(x)
    x = np.sort(x)
    cdfvals = cdf(x, *args)
    np_one = np.int8(1)

    if alternative == 'greater':
        Dplus, d_location = _compute_dplus(cdfvals, x)
        return KstestResult(Dplus, distributions.ksone.sf(Dplus, N),
                            statistic_location=d_location,
                            statistic_sign=np_one)

    if alternative == 'less':
        Dminus, d_location = _compute_dminus(cdfvals, x)
        return KstestResult(Dminus, distributions.ksone.sf(Dminus, N),
                            statistic_location=d_location,
                            statistic_sign=-np_one)

    # alternative == 'two-sided':
    Dplus, dplus_location = _compute_dplus(cdfvals, x)
    Dminus, dminus_location = _compute_dminus(cdfvals, x)
    if Dplus > Dminus:
        D = Dplus
        d_location = dplus_location
        d_sign = np_one
    else:
        D = Dminus
        d_location = dminus_location
        d_sign = -np_one

    if mode == 'auto':  # Always select exact
        mode = 'exact'
    if mode == 'exact':
        prob = distributions.kstwo.sf(D, N)
    elif mode == 'asymp':
        prob = distributions.kstwobign.sf(D * np.sqrt(N))
    else:
        # mode == 'approx'
        prob = 2 * distributions.ksone.sf(D, N)
    prob = np.clip(prob, 0, 1)
    return KstestResult(D, prob,
                        statistic_location=d_location,
                        statistic_sign=d_sign)


Ks_2sampResult = KstestResult


def _compute_prob_outside_square(n, h):
    """
    Compute the proportion of paths that pass outside the two diagonal lines.

    Parameters
    ----------
    n : integer
        n > 0
    h : integer
        0 <= h <= n

    Returns
    -------
    p : float
        The proportion of paths that pass outside the lines x-y = +/-h.

    """
    # Compute Pr(D_{n,n} >= h/n)
    # Prob = 2 * ( binom(2n, n-h) - binom(2n, n-2a) + binom(2n, n-3a) - ... )
    # / binom(2n, n)
    # This formulation exhibits subtractive cancellation.
    # Instead divide each term by binom(2n, n), then factor common terms
    # and use a Horner-like algorithm
    # P = 2 * A0 * (1 - A1*(1 - A2*(1 - A3*(1 - A4*(...)))))

    P = 0.0
    k = int(np.floor(n / h))
    while k >= 0:
        p1 = 1.0
        # Each of the Ai terms has numerator and denominator with
        # h simple terms.
        for j in range(h):
            p1 = (n - k * h - j) * p1 / (n + k * h + j + 1)
        P = p1 * (1.0 - P)
        k -= 1
    return 2 * P


def _count_paths_outside_method(m, n, g, h):
    """Count the number of paths that pass outside the specified diagonal.

    Parameters
    ----------
    m : integer
        m > 0
    n : integer
        n > 0
    g : integer
        g is greatest common divisor of m and n
    h : integer
        0 <= h <= lcm(m,n)

    Returns
    -------
    p : float
        The number of paths that go low.
        The calculation may overflow - check for a finite answer.

    Notes
    -----
    Count the integer lattice paths from (0, 0) to (m, n), which at some
    point (x, y) along the path, satisfy:
      m*y <= n*x - h*g
    The paths make steps of size +1 in either positive x or positive y
    directions.

    We generally follow Hodges' treatment of Drion/Gnedenko/Korolyuk.
    Hodges, J.L. Jr.,
    "The Significance Probability of the Smirnov Two-Sample Test,"
    Arkiv fiur Matematik, 3, No. 43 (1958), 469-86.

    """
    # Compute #paths which stay lower than x/m-y/n = h/lcm(m,n)
    # B(x, y) = #{paths from (0,0) to (x,y) without
    #             previously crossing the boundary}
    #         = binom(x, y) - #{paths which already reached the boundary}
    # Multiply by the number of path extensions going from (x, y) to (m, n)
    # Sum.

    # Probability is symmetrical in m, n.  Computation below assumes m >= n.
    if m < n:
        m, n = n, m
    mg = m // g
    ng = n // g

    # Not every x needs to be considered.
    # xj holds the list of x values to be checked.
    # Wherever n*x/m + ng*h crosses an integer
    lxj = n + (mg-h)//mg
    xj = [(h + mg * j + ng-1)//ng for j in range(lxj)]
    # B is an array just holding a few values of B(x,y), the ones needed.
    # B[j] == B(x_j, j)
    if lxj == 0:
        return special.binom(m + n, n)
    B = np.zeros(lxj)
    B[0] = 1
    # Compute the B(x, y) terms
    for j in range(1, lxj):
        Bj = special.binom(xj[j] + j, j)
        for i in range(j):
            bin = special.binom(xj[j] - xj[i] + j - i, j-i)
            Bj -= bin * B[i]
        B[j] = Bj
    # Compute the number of path extensions...
    num_paths = 0
    for j in range(lxj):
        bin = special.binom((m-xj[j]) + (n - j), n-j)
        term = B[j] * bin
        num_paths += term
    return num_paths


def _attempt_exact_2kssamp(n1, n2, g, d, alternative):
    """Attempts to compute the exact 2sample probability.

    n1, n2 are the sample sizes
    g is the gcd(n1, n2)
    d is the computed max difference in ECDFs

    Returns (success, d, probability)
    """
    lcm = (n1 // g) * n2
    h = int(np.round(d * lcm))
    d = h * 1.0 / lcm
    if h == 0:
        return True, d, 1.0
    saw_fp_error, prob = False, np.nan
    try:
        with np.errstate(invalid="raise", over="raise"):
            if alternative == 'two-sided':
                if n1 == n2:
                    prob = _compute_prob_outside_square(n1, h)
                else:
                    prob = _compute_outer_prob_inside_method(n1, n2, g, h)
            else:
                if n1 == n2:
                    # prob = binom(2n, n-h) / binom(2n, n)
                    # Evaluating in that form incurs roundoff errors
                    # from special.binom. Instead calculate directly
                    jrange = np.arange(h)
                    prob = np.prod((n1 - jrange) / (n1 + jrange + 1.0))
                else:
                    with np.errstate(over='raise'):
                        num_paths = _count_paths_outside_method(n1, n2, g, h)
                    bin = special.binom(n1 + n2, n1)
                    if num_paths > bin or np.isinf(bin):
                        saw_fp_error = True
                    else:
                        prob = num_paths / bin

    except (FloatingPointError, OverflowError):
        saw_fp_error = True

    if saw_fp_error:
        return False, d, np.nan
    if not (0 <= prob <= 1):
        return False, d, prob
    return True, d, prob


@_axis_nan_policy_factory(_tuple_to_KstestResult, n_samples=2, n_outputs=4,
                          result_to_tuple=_KstestResult_to_tuple)
@_rename_parameter("mode", "method")
def ks_2samp(data1, data2, alternative='two-sided', method='auto'):
    """
    Performs the two-sample Kolmogorov-Smirnov test for goodness of fit.

    This test compares the underlying continuous distributions F(x) and G(x)
    of two independent samples.  See Notes for a description of the available
    null and alternative hypotheses.

    Parameters
    ----------
    data1, data2 : array_like, 1-Dimensional
        Two arrays of sample observations assumed to be drawn from a continuous
        distribution, sample sizes can be different.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the null and alternative hypotheses. Default is 'two-sided'.
        Please see explanations in the Notes below.
    method : {'auto', 'exact', 'asymp'}, optional
        Defines the method used for calculating the p-value.
        The following options are available (default is 'auto'):

          * 'auto' : use 'exact' for small size arrays, 'asymp' for large
          * 'exact' : use exact distribution of test statistic
          * 'asymp' : use asymptotic distribution of test statistic

    Returns
    -------
    res: KstestResult
        An object containing attributes:

        statistic : float
            KS test statistic.
        pvalue : float
            One-tailed or two-tailed p-value.
        statistic_location : float
            Value from `data1` or `data2` corresponding with the KS statistic;
            i.e., the distance between the empirical distribution functions is
            measured at this observation.
        statistic_sign : int
            +1 if the empirical distribution function of `data1` exceeds
            the empirical distribution function of `data2` at
            `statistic_location`, otherwise -1.

    See Also
    --------
    kstest, ks_1samp, epps_singleton_2samp, anderson_ksamp

    Notes
    -----
    There are three options for the null and corresponding alternative
    hypothesis that can be selected using the `alternative` parameter.

    - `less`: The null hypothesis is that F(x) >= G(x) for all x; the
      alternative is that F(x) < G(x) for at least one x. The statistic
      is the magnitude of the minimum (most negative) difference between the
      empirical distribution functions of the samples.

    - `greater`: The null hypothesis is that F(x) <= G(x) for all x; the
      alternative is that F(x) > G(x) for at least one x. The statistic
      is the maximum (most positive) difference between the empirical
      distribution functions of the samples.

    - `two-sided`: The null hypothesis is that the two distributions are
      identical, F(x)=G(x) for all x; the alternative is that they are not
      identical. The statistic is the maximum absolute difference between the
      empirical distribution functions of the samples.

    Note that the alternative hypotheses describe the *CDFs* of the
    underlying distributions, not the observed values of the data. For example,
    suppose x1 ~ F and x2 ~ G. If F(x) > G(x) for all x, the values in
    x1 tend to be less than those in x2.

    If the KS statistic is large, then the p-value will be small, and this may
    be taken as evidence against the null hypothesis in favor of the
    alternative.

    If ``method='exact'``, `ks_2samp` attempts to compute an exact p-value,
    that is, the probability under the null hypothesis of obtaining a test
    statistic value as extreme as the value computed from the data.
    If ``method='asymp'``, the asymptotic Kolmogorov-Smirnov distribution is
    used to compute an approximate p-value.
    If ``method='auto'``, an exact p-value computation is attempted if both
    sample sizes are less than 10000; otherwise, the asymptotic method is used.
    In any case, if an exact p-value calculation is attempted and fails, a
    warning will be emitted, and the asymptotic p-value will be returned.

    The 'two-sided' 'exact' computation computes the complementary probability
    and then subtracts from 1.  As such, the minimum probability it can return
    is about 1e-16.  While the algorithm itself is exact, numerical
    errors may accumulate for large sample sizes.   It is most suited to
    situations in which one of the sample sizes is only a few thousand.

    We generally follow Hodges' treatment of Drion/Gnedenko/Korolyuk [1]_.

    References
    ----------
    .. [1] Hodges, J.L. Jr.,  "The Significance Probability of the Smirnov
           Two-Sample Test," Arkiv fiur Matematik, 3, No. 43 (1958), 469-486.

    Examples
    --------
    Suppose we wish to test the null hypothesis that two samples were drawn
    from the same distribution.
    We choose a confidence level of 95%; that is, we will reject the null
    hypothesis in favor of the alternative if the p-value is less than 0.05.

    If the first sample were drawn from a uniform distribution and the second
    were drawn from the standard normal, we would expect the null hypothesis
    to be rejected.

    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng()
    >>> sample1 = stats.uniform.rvs(size=100, random_state=rng)
    >>> sample2 = stats.norm.rvs(size=110, random_state=rng)
    >>> stats.ks_2samp(sample1, sample2)
    KstestResult(statistic=0.5454545454545454,
                 pvalue=7.37417839555191e-15,
                 statistic_location=-0.014071496412861274,
                 statistic_sign=-1)


    Indeed, the p-value is lower than our threshold of 0.05, so we reject the
    null hypothesis in favor of the default "two-sided" alternative: the data
    were *not* drawn from the same distribution.

    When both samples are drawn from the same distribution, we expect the data
    to be consistent with the null hypothesis most of the time.

    >>> sample1 = stats.norm.rvs(size=105, random_state=rng)
    >>> sample2 = stats.norm.rvs(size=95, random_state=rng)
    >>> stats.ks_2samp(sample1, sample2)
    KstestResult(statistic=0.10927318295739348,
                 pvalue=0.5438289009927495,
                 statistic_location=-0.1670157701848795,
                 statistic_sign=-1)

    As expected, the p-value of 0.54 is not below our threshold of 0.05, so
    we cannot reject the null hypothesis.

    Suppose, however, that the first sample were drawn from
    a normal distribution shifted toward greater values. In this case,
    the cumulative density function (CDF) of the underlying distribution tends
    to be *less* than the CDF underlying the second sample. Therefore, we would
    expect the null hypothesis to be rejected with ``alternative='less'``:

    >>> sample1 = stats.norm.rvs(size=105, loc=0.5, random_state=rng)
    >>> stats.ks_2samp(sample1, sample2, alternative='less')
    KstestResult(statistic=0.4055137844611529,
                 pvalue=3.5474563068855554e-08,
                 statistic_location=-0.13249370614972575,
                 statistic_sign=-1)

    and indeed, with p-value smaller than our threshold, we reject the null
    hypothesis in favor of the alternative.

    """
    mode = method

    if mode not in ['auto', 'exact', 'asymp']:
        raise ValueError(f'Invalid value for mode: {mode}')
    alternative = {'t': 'two-sided', 'g': 'greater', 'l': 'less'}.get(
        alternative.lower()[0], alternative)
    if alternative not in ['two-sided', 'less', 'greater']:
        raise ValueError(f'Invalid value for alternative: {alternative}')
    MAX_AUTO_N = 10000  # 'auto' will attempt to be exact if n1,n2 <= MAX_AUTO_N
    if np.ma.is_masked(data1):
        data1 = data1.compressed()
    if np.ma.is_masked(data2):
        data2 = data2.compressed()
    data1 = np.sort(data1)
    data2 = np.sort(data2)
    n1 = data1.shape[0]
    n2 = data2.shape[0]
    if min(n1, n2) == 0:
        raise ValueError('Data passed to ks_2samp must not be empty')

    data_all = np.concatenate([data1, data2])
    # using searchsorted solves equal data problem
    cdf1 = np.searchsorted(data1, data_all, side='right') / n1
    cdf2 = np.searchsorted(data2, data_all, side='right') / n2
    cddiffs = cdf1 - cdf2

    # Identify the location of the statistic
    argminS = np.argmin(cddiffs)
    argmaxS = np.argmax(cddiffs)
    loc_minS = data_all[argminS]
    loc_maxS = data_all[argmaxS]

    # Ensure sign of minS is not negative.
    minS = np.clip(-cddiffs[argminS], 0, 1)
    maxS = cddiffs[argmaxS]

    if alternative == 'less' or (alternative == 'two-sided' and minS > maxS):
        d = minS
        d_location = loc_minS
        d_sign = -1
    else:
        d = maxS
        d_location = loc_maxS
        d_sign = 1
    g = math.gcd(n1, n2)
    n1g = n1 // g
    n2g = n2 // g
    prob = -np.inf
    if mode == 'auto':
        mode = 'exact' if max(n1, n2) <= MAX_AUTO_N else 'asymp'
    elif mode == 'exact':
        # If lcm(n1, n2) is too big, switch from exact to asymp
        if n1g >= np.iinfo(np.int32).max / n2g:
            mode = 'asymp'
            warnings.warn(
                f"Exact ks_2samp calculation not possible with samples sizes "
                f"{n1} and {n2}. Switching to 'asymp'.", RuntimeWarning,
                stacklevel=3)

    if mode == 'exact':
        success, d, prob = _attempt_exact_2kssamp(n1, n2, g, d, alternative)
        if not success:
            mode = 'asymp'
            warnings.warn(f"ks_2samp: Exact calculation unsuccessful. "
                          f"Switching to method={mode}.", RuntimeWarning,
                          stacklevel=3)

    if mode == 'asymp':
        # The product n1*n2 is large.  Use Smirnov's asymptotic formula.
        # Ensure float to avoid overflow in multiplication
        # sorted because the one-sided formula is not symmetric in n1, n2
        m, n = sorted([float(n1), float(n2)], reverse=True)
        en = m * n / (m + n)
        if alternative == 'two-sided':
            prob = distributions.kstwo.sf(d, np.round(en))
        else:
            z = np.sqrt(en) * d
            # Use Hodges' suggested approximation Eqn 5.3
            # Requires m to be the larger of (n1, n2)
            expt = -2 * z**2 - 2 * z * (m + 2*n)/np.sqrt(m*n*(m+n))/3.0
            prob = np.exp(expt)

    prob = np.clip(prob, 0, 1)
    # Currently, `d` is a Python float. We want it to be a NumPy type, so
    # float64 is appropriate. An enhancement would be for `d` to respect the
    # dtype of the input.
    return KstestResult(np.float64(d), prob, statistic_location=d_location,
                        statistic_sign=np.int8(d_sign))


def _parse_kstest_args(data1, data2, args, N):
    # kstest allows many different variations of arguments.
    # Pull out the parsing into a separate function
    # (xvals, yvals, )  # 2sample
    # (xvals, cdf function,..)
    # (xvals, name of distribution, ...)
    # (name of distribution, name of distribution, ...)

    # Returns xvals, yvals, cdf
    # where cdf is a cdf function, or None
    # and yvals is either an array_like of values, or None
    # and xvals is array_like.
    rvsfunc, cdf = None, None
    if isinstance(data1, str):
        rvsfunc = getattr(distributions, data1).rvs
    elif callable(data1):
        rvsfunc = data1

    if isinstance(data2, str):
        cdf = getattr(distributions, data2).cdf
        data2 = None
    elif callable(data2):
        cdf = data2
        data2 = None

    data1 = np.sort(rvsfunc(*args, size=N) if rvsfunc else data1)
    return data1, data2, cdf


def _kstest_n_samples(kwargs):
    cdf = kwargs['cdf']
    return 1 if (isinstance(cdf, str) or callable(cdf)) else 2


@_axis_nan_policy_factory(_tuple_to_KstestResult, n_samples=_kstest_n_samples,
                          n_outputs=4, result_to_tuple=_KstestResult_to_tuple)
@_rename_parameter("mode", "method")
def kstest(rvs, cdf, args=(), N=20, alternative='two-sided', method='auto'):
    """
    Performs the (one-sample or two-sample) Kolmogorov-Smirnov test for
    goodness of fit.

    The one-sample test compares the underlying distribution F(x) of a sample
    against a given distribution G(x). The two-sample test compares the
    underlying distributions of two independent samples. Both tests are valid
    only for continuous distributions.

    Parameters
    ----------
    rvs : str, array_like, or callable
        If an array, it should be a 1-D array of observations of random
        variables.
        If a callable, it should be a function to generate random variables;
        it is required to have a keyword argument `size`.
        If a string, it should be the name of a distribution in `scipy.stats`,
        which will be used to generate random variables.
    cdf : str, array_like or callable
        If array_like, it should be a 1-D array of observations of random
        variables, and the two-sample test is performed
        (and rvs must be array_like).
        If a callable, that callable is used to calculate the cdf.
        If a string, it should be the name of a distribution in `scipy.stats`,
        which will be used as the cdf function.
    args : tuple, sequence, optional
        Distribution parameters, used if `rvs` or `cdf` are strings or
        callables.
    N : int, optional
        Sample size if `rvs` is string or callable.  Default is 20.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the null and alternative hypotheses. Default is 'two-sided'.
        Please see explanations in the Notes below.
    method : {'auto', 'exact', 'approx', 'asymp'}, optional
        Defines the distribution used for calculating the p-value.
        The following options are available (default is 'auto'):

          * 'auto' : selects one of the other options.
          * 'exact' : uses the exact distribution of test statistic.
          * 'approx' : approximates the two-sided probability with twice the
            one-sided probability
          * 'asymp': uses asymptotic distribution of test statistic

    Returns
    -------
    res: KstestResult
        An object containing attributes:

        statistic : float
            KS test statistic, either D+, D-, or D (the maximum of the two)
        pvalue : float
            One-tailed or two-tailed p-value.
        statistic_location : float
            In a one-sample test, this is the value of `rvs`
            corresponding with the KS statistic; i.e., the distance between
            the empirical distribution function and the hypothesized cumulative
            distribution function is measured at this observation.

            In a two-sample test, this is the value from `rvs` or `cdf`
            corresponding with the KS statistic; i.e., the distance between
            the empirical distribution functions is measured at this
            observation.
        statistic_sign : int
            In a one-sample test, this is +1 if the KS statistic is the
            maximum positive difference between the empirical distribution
            function and the hypothesized cumulative distribution function
            (D+); it is -1 if the KS statistic is the maximum negative
            difference (D-).

            In a two-sample test, this is +1 if the empirical distribution
            function of `rvs` exceeds the empirical distribution
            function of `cdf` at `statistic_location`, otherwise -1.

    See Also
    --------
    ks_1samp, ks_2samp

    Notes
    -----
    There are three options for the null and corresponding alternative
    hypothesis that can be selected using the `alternative` parameter.

    - `two-sided`: The null hypothesis is that the two distributions are
      identical, F(x)=G(x) for all x; the alternative is that they are not
      identical.

    - `less`: The null hypothesis is that F(x) >= G(x) for all x; the
      alternative is that F(x) < G(x) for at least one x.

    - `greater`: The null hypothesis is that F(x) <= G(x) for all x; the
      alternative is that F(x) > G(x) for at least one x.

    Note that the alternative hypotheses describe the *CDFs* of the
    underlying distributions, not the observed values. For example,
    suppose x1 ~ F and x2 ~ G. If F(x) > G(x) for all x, the values in
    x1 tend to be less than those in x2.


    Examples
    --------
    Suppose we wish to test the null hypothesis that a sample is distributed
    according to the standard normal.
    We choose a confidence level of 95%; that is, we will reject the null
    hypothesis in favor of the alternative if the p-value is less than 0.05.

    When testing uniformly distributed data, we would expect the
    null hypothesis to be rejected.

    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng()
    >>> stats.kstest(stats.uniform.rvs(size=100, random_state=rng),
    ...              stats.norm.cdf)
    KstestResult(statistic=0.5001899973268688,
                 pvalue=1.1616392184763533e-23,
                 statistic_location=0.00047625268963724654,
                 statistic_sign=-1)

    Indeed, the p-value is lower than our threshold of 0.05, so we reject the
    null hypothesis in favor of the default "two-sided" alternative: the data
    are *not* distributed according to the standard normal.

    When testing random variates from the standard normal distribution, we
    expect the data to be consistent with the null hypothesis most of the time.

    >>> x = stats.norm.rvs(size=100, random_state=rng)
    >>> stats.kstest(x, stats.norm.cdf)
    KstestResult(statistic=0.05345882212970396,
                 pvalue=0.9227159037744717,
                 statistic_location=-1.2451343873745018,
                 statistic_sign=1)


    As expected, the p-value of 0.92 is not below our threshold of 0.05, so
    we cannot reject the null hypothesis.

    Suppose, however, that the random variates are distributed according to
    a normal distribution that is shifted toward greater values. In this case,
    the cumulative density function (CDF) of the underlying distribution tends
    to be *less* than the CDF of the standard normal. Therefore, we would
    expect the null hypothesis to be rejected with ``alternative='less'``:

    >>> x = stats.norm.rvs(size=100, loc=0.5, random_state=rng)
    >>> stats.kstest(x, stats.norm.cdf, alternative='less')
    KstestResult(statistic=0.17482387821055168,
                 pvalue=0.001913921057766743,
                 statistic_location=0.3713830565352756,
                 statistic_sign=-1)

    and indeed, with p-value smaller than our threshold, we reject the null
    hypothesis in favor of the alternative.

    For convenience, the previous test can be performed using the name of the
    distribution as the second argument.

    >>> stats.kstest(x, "norm", alternative='less')
    KstestResult(statistic=0.17482387821055168,
                 pvalue=0.001913921057766743,
                 statistic_location=0.3713830565352756,
                 statistic_sign=-1)

    The examples above have all been one-sample tests identical to those
    performed by `ks_1samp`. Note that `kstest` can also perform two-sample
    tests identical to those performed by `ks_2samp`. For example, when two
    samples are drawn from the same distribution, we expect the data to be
    consistent with the null hypothesis most of the time.

    >>> sample1 = stats.laplace.rvs(size=105, random_state=rng)
    >>> sample2 = stats.laplace.rvs(size=95, random_state=rng)
    >>> stats.kstest(sample1, sample2)
    KstestResult(statistic=0.11779448621553884,
                 pvalue=0.4494256912629795,
                 statistic_location=0.6138814275424155,
                 statistic_sign=1)

    As expected, the p-value of 0.45 is not below our threshold of 0.05, so
    we cannot reject the null hypothesis.

    """
    # to not break compatibility with existing code
    if alternative == 'two_sided':
        alternative = 'two-sided'
    if alternative not in ['two-sided', 'greater', 'less']:
        raise ValueError(f"Unexpected alternative: {alternative}")
    xvals, yvals, cdf = _parse_kstest_args(rvs, cdf, args, N)
    if cdf:
        return ks_1samp(xvals, cdf, args=args, alternative=alternative,
                        method=method, _no_deco=True)
    return ks_2samp(xvals, yvals, alternative=alternative, method=method,
                    _no_deco=True)


def tiecorrect(rankvals):
    """Tie correction factor for Mann-Whitney U and Kruskal-Wallis H tests.

    Parameters
    ----------
    rankvals : array_like
        A 1-D sequence of ranks.  Typically this will be the array
        returned by `~scipy.stats.rankdata`.

    Returns
    -------
    factor : float
        Correction factor for U or H.

    See Also
    --------
    rankdata : Assign ranks to the data
    mannwhitneyu : Mann-Whitney rank test
    kruskal : Kruskal-Wallis H test

    References
    ----------
    .. [1] Siegel, S. (1956) Nonparametric Statistics for the Behavioral
           Sciences.  New York: McGraw-Hill.

    Examples
    --------
    >>> from scipy.stats import tiecorrect, rankdata
    >>> tiecorrect([1, 2.5, 2.5, 4])
    0.9
    >>> ranks = rankdata([1, 3, 2, 4, 5, 7, 2, 8, 4])
    >>> ranks
    array([ 1. ,  4. ,  2.5,  5.5,  7. ,  8. ,  2.5,  9. ,  5.5])
    >>> tiecorrect(ranks)
    0.9833333333333333

    """
    arr = np.sort(rankvals)
    idx = np.nonzero(np.r_[True, arr[1:] != arr[:-1], True])[0]
    cnt = np.diff(idx).astype(np.float64)

    size = np.float64(arr.size)
    return 1.0 if size < 2 else 1.0 - (cnt**3 - cnt).sum() / (size**3 - size)


RanksumsResult = namedtuple('RanksumsResult', ('statistic', 'pvalue'))


@_axis_nan_policy_factory(RanksumsResult, n_samples=2)
def ranksums(x, y, alternative='two-sided'):
    """Compute the Wilcoxon rank-sum statistic for two samples.

    The Wilcoxon rank-sum test tests the null hypothesis that two sets
    of measurements are drawn from the same distribution.  The alternative
    hypothesis is that values in one sample are more likely to be
    larger than the values in the other sample.

    This test should be used to compare two samples from continuous
    distributions.  It does not handle ties between measurements
    in x and y.  For tie-handling and an optional continuity correction
    see `scipy.stats.mannwhitneyu`.

    Parameters
    ----------
    x,y : array_like
        The data from the two samples.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis. Default is 'two-sided'.
        The following options are available:

        * 'two-sided': one of the distributions (underlying `x` or `y`) is
          stochastically greater than the other.
        * 'less': the distribution underlying `x` is stochastically less
          than the distribution underlying `y`.
        * 'greater': the distribution underlying `x` is stochastically greater
          than the distribution underlying `y`.

        .. versionadded:: 1.7.0

    Returns
    -------
    statistic : float
        The test statistic under the large-sample approximation that the
        rank sum statistic is normally distributed.
    pvalue : float
        The p-value of the test.

    References
    ----------
    .. [1] https://en.wikipedia.org/wiki/Wilcoxon_rank-sum_test

    Examples
    --------
    We can test the hypothesis that two independent unequal-sized samples are
    drawn from the same distribution with computing the Wilcoxon rank-sum
    statistic.

    >>> import numpy as np
    >>> from scipy.stats import ranksums
    >>> rng = np.random.default_rng()
    >>> sample1 = rng.uniform(-1, 1, 200)
    >>> sample2 = rng.uniform(-0.5, 1.5, 300) # a shifted distribution
    >>> ranksums(sample1, sample2)
    RanksumsResult(statistic=-7.887059,
                   pvalue=3.09390448e-15) # may vary
    >>> ranksums(sample1, sample2, alternative='less')
    RanksumsResult(statistic=-7.750585297581713,
                   pvalue=4.573497606342543e-15) # may vary
    >>> ranksums(sample1, sample2, alternative='greater')
    RanksumsResult(statistic=-7.750585297581713,
                   pvalue=0.9999999999999954) # may vary

    The p-value of less than ``0.05`` indicates that this test rejects the
    hypothesis at the 5% significance level.

    """
    x, y = map(np.asarray, (x, y))
    n1 = len(x)
    n2 = len(y)
    alldata = np.concatenate((x, y))
    ranked = rankdata(alldata)
    x = ranked[:n1]
    s = np.sum(x, axis=0)
    expected = n1 * (n1+n2+1) / 2.0
    z = (s - expected) / np.sqrt(n1*n2*(n1+n2+1)/12.0)
    pvalue = _get_pvalue(z, _SimpleNormal(), alternative, xp=np)

    return RanksumsResult(z[()], pvalue[()])


KruskalResult = namedtuple('KruskalResult', ('statistic', 'pvalue'))


@_axis_nan_policy_factory(KruskalResult, n_samples=None)
def kruskal(*samples, nan_policy='propagate'):
    """Compute the Kruskal-Wallis H-test for independent samples.

    The Kruskal-Wallis H-test tests the null hypothesis that the population
    median of all of the groups are equal.  It is a non-parametric version of
    ANOVA.  The test works on 2 or more independent samples, which may have
    different sizes.  Note that rejecting the null hypothesis does not
    indicate which of the groups differs.  Post hoc comparisons between
    groups are required to determine which groups are different.

    Parameters
    ----------
    sample1, sample2, ... : array_like
       Two or more arrays with the sample measurements can be given as
       arguments. Samples must be one-dimensional.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    statistic : float
       The Kruskal-Wallis H statistic, corrected for ties.
    pvalue : float
       The p-value for the test using the assumption that H has a chi
       square distribution. The p-value returned is the survival function of
       the chi square distribution evaluated at H.

    See Also
    --------
    f_oneway : 1-way ANOVA.
    mannwhitneyu : Mann-Whitney rank test on two samples.
    friedmanchisquare : Friedman test for repeated measurements.

    Notes
    -----
    Due to the assumption that H has a chi square distribution, the number
    of samples in each group must not be too small.  A typical rule is
    that each sample must have at least 5 measurements.

    References
    ----------
    .. [1] W. H. Kruskal & W. W. Wallis, "Use of Ranks in
       One-Criterion Variance Analysis", Journal of the American Statistical
       Association, Vol. 47, Issue 260, pp. 583-621, 1952.
    .. [2] https://en.wikipedia.org/wiki/Kruskal-Wallis_one-way_analysis_of_variance

    Examples
    --------
    >>> from scipy import stats
    >>> x = [1, 3, 5, 7, 9]
    >>> y = [2, 4, 6, 8, 10]
    >>> stats.kruskal(x, y)
    KruskalResult(statistic=0.2727272727272734, pvalue=0.6015081344405895)

    >>> x = [1, 1, 1]
    >>> y = [2, 2, 2]
    >>> z = [2, 2]
    >>> stats.kruskal(x, y, z)
    KruskalResult(statistic=7.0, pvalue=0.0301973834223185)

    """
    samples = list(map(np.asarray, samples))

    num_groups = len(samples)
    if num_groups < 2:
        raise ValueError("Need at least two groups in stats.kruskal()")

    n = np.asarray(list(map(len, samples)))

    alldata = np.concatenate(samples)
    ranked = rankdata(alldata)
    ties = tiecorrect(ranked)
    if ties == 0:
        raise ValueError('All numbers are identical in kruskal')

    # Compute sum^2/n for each group and sum
    j = np.insert(np.cumsum(n), 0, 0)
    ssbn = 0
    for i in range(num_groups):
        ssbn += _square_of_sums(ranked[j[i]:j[i+1]]) / n[i]

    totaln = np.sum(n, dtype=float)
    h = 12.0 / (totaln * (totaln + 1)) * ssbn - 3 * (totaln + 1)
    df = num_groups - 1
    h /= ties

    chi2 = _SimpleChi2(df)
    pvalue = _get_pvalue(h, chi2, alternative='greater', symmetric=False, xp=np)
    return KruskalResult(h, pvalue)


FriedmanchisquareResult = namedtuple('FriedmanchisquareResult',
                                     ('statistic', 'pvalue'))


@_axis_nan_policy_factory(FriedmanchisquareResult, n_samples=None, paired=True)
def friedmanchisquare(*samples):
    """Compute the Friedman test for repeated samples.

    The Friedman test tests the null hypothesis that repeated samples of
    the same individuals have the same distribution.  It is often used
    to test for consistency among samples obtained in different ways.
    For example, if two sampling techniques are used on the same set of
    individuals, the Friedman test can be used to determine if the two
    sampling techniques are consistent.

    Parameters
    ----------
    sample1, sample2, sample3... : array_like
        Arrays of observations.  All of the arrays must have the same number
        of elements.  At least three samples must be given.

    Returns
    -------
    statistic : float
        The test statistic, correcting for ties.
    pvalue : float
        The associated p-value assuming that the test statistic has a chi
        squared distribution.

    See Also
    --------
    :ref:`hypothesis_friedmanchisquare` : Extended example

    Notes
    -----
    Due to the assumption that the test statistic has a chi squared
    distribution, the p-value is only reliable for n > 10 and more than
    6 repeated samples.

    References
    ----------
    .. [1] https://en.wikipedia.org/wiki/Friedman_test
    .. [2] Demsar, J. (2006). Statistical comparisons of classifiers over
           multiple data sets. Journal of Machine Learning Research, 7, 1-30.

    Examples
    --------

    >>> import numpy as np
    >>> rng = np.random.default_rng(seed=18)
    >>> x = rng.random((6, 10))
    >>> from scipy.stats import friedmanchisquare
    >>> res = friedmanchisquare(x[0], x[1], x[2], x[3], x[4], x[5])
    >>> res.statistic, res.pvalue
    (11.428571428571416, 0.043514520866727614)

    The p-value is less than 0.05; however, as noted above, the results may not
    be reliable since we have a small number of repeated samples.

    For a more detailed example, see :ref:`hypothesis_friedmanchisquare`.
    """
    k = len(samples)
    if k < 3:
        raise ValueError('At least 3 sets of samples must be given '
                         f'for Friedman test, got {k}.')

    n = len(samples[0])
    for i in range(1, k):
        if len(samples[i]) != n:
            raise ValueError('Unequal N in friedmanchisquare.  Aborting.')

    # Rank data
    data = np.vstack(samples).T
    data = data.astype(float)
    for i in range(len(data)):
        data[i] = rankdata(data[i])

    # Handle ties
    ties = 0
    for d in data:
        _, repnum = _find_repeats(np.array(d, dtype=np.float64))
        for t in repnum:
            ties += t * (t*t - 1)
    c = 1 - ties / (k*(k*k - 1)*n)

    ssbn = np.sum(data.sum(axis=0)**2)
    statistic = (12.0 / (k*n*(k+1)) * ssbn - 3*n*(k+1)) / c

    chi2 = _SimpleChi2(k - 1)
    pvalue = _get_pvalue(statistic, chi2, alternative='greater', symmetric=False, xp=np)
    return FriedmanchisquareResult(statistic, pvalue)


BrunnerMunzelResult = namedtuple('BrunnerMunzelResult',
                                 ('statistic', 'pvalue'))


@_axis_nan_policy_factory(BrunnerMunzelResult, n_samples=2)
def brunnermunzel(x, y, alternative="two-sided", distribution="t",
                  nan_policy='propagate'):
    """Compute the Brunner-Munzel test on samples x and y.

    The Brunner-Munzel test is a nonparametric test of the null hypothesis that
    when values are taken one by one from each group, the probabilities of
    getting large values in both groups are equal.
    Unlike the Wilcoxon-Mann-Whitney's U test, this does not require the
    assumption of equivariance of two groups. Note that this does not assume
    the distributions are same. This test works on two independent samples,
    which may have different sizes.

    Parameters
    ----------
    x, y : array_like
        Array of samples, should be one-dimensional.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis.
        The following options are available (default is 'two-sided'):

          * 'two-sided'
          * 'less': one-sided
          * 'greater': one-sided
    distribution : {'t', 'normal'}, optional
        Defines how to get the p-value.
        The following options are available (default is 't'):

          * 't': get the p-value by t-distribution
          * 'normal': get the p-value by standard normal distribution.
    nan_policy : {'propagate', 'raise', 'omit'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': returns nan
          * 'raise': throws an error
          * 'omit': performs the calculations ignoring nan values

    Returns
    -------
    statistic : float
        The Brunner-Munzer W statistic.
    pvalue : float
        p-value assuming an t distribution. One-sided or
        two-sided, depending on the choice of `alternative` and `distribution`.

    See Also
    --------
    mannwhitneyu : Mann-Whitney rank test on two samples.

    Notes
    -----
    Brunner and Munzel recommended to estimate the p-value by t-distribution
    when the size of data is 50 or less. If the size is lower than 10, it would
    be better to use permuted Brunner Munzel test (see [2]_).

    References
    ----------
    .. [1] Brunner, E. and Munzel, U. "The nonparametric Benhrens-Fisher
           problem: Asymptotic theory and a small-sample approximation".
           Biometrical Journal. Vol. 42(2000): 17-25.
    .. [2] Neubert, K. and Brunner, E. "A studentized permutation test for the
           non-parametric Behrens-Fisher problem". Computational Statistics and
           Data Analysis. Vol. 51(2007): 5192-5204.

    Examples
    --------
    >>> from scipy import stats
    >>> x1 = [1,2,1,1,1,1,1,1,1,1,2,4,1,1]
    >>> x2 = [3,3,4,3,1,2,3,1,1,5,4]
    >>> w, p_value = stats.brunnermunzel(x1, x2)
    >>> w
    3.1374674823029505
    >>> p_value
    0.0057862086661515377

    """
    nx = len(x)
    ny = len(y)

    rankc = rankdata(np.concatenate((x, y)))
    rankcx = rankc[0:nx]
    rankcy = rankc[nx:nx+ny]
    rankcx_mean = np.mean(rankcx)
    rankcy_mean = np.mean(rankcy)
    rankx = rankdata(x)
    ranky = rankdata(y)
    rankx_mean = np.mean(rankx)
    ranky_mean = np.mean(ranky)

    temp_x = rankcx - rankx - rankcx_mean + rankx_mean
    Sx = np_vecdot(temp_x, temp_x)
    Sx /= nx - 1
    temp_y = rankcy - ranky - rankcy_mean + ranky_mean
    Sy = np_vecdot(temp_y, temp_y)
    Sy /= ny - 1

    wbfn = nx * ny * (rankcy_mean - rankcx_mean)
    wbfn /= (nx + ny) * np.sqrt(nx * Sx + ny * Sy)

    if distribution == "t":
        df_numer = np.power(nx * Sx + ny * Sy, 2.0)
        df_denom = np.power(nx * Sx, 2.0) / (nx - 1)
        df_denom += np.power(ny * Sy, 2.0) / (ny - 1)
        df = df_numer / df_denom

        if (df_numer == 0) and (df_denom == 0):
            message = ("p-value cannot be estimated with `distribution='t' "
                       "because degrees of freedom parameter is undefined "
                       "(0/0). Try using `distribution='normal'")
            warnings.warn(message, RuntimeWarning, stacklevel=2)

        distribution = _SimpleStudentT(df)
    elif distribution == "normal":
        distribution = _SimpleNormal()
    else:
        raise ValueError(
            "distribution should be 't' or 'normal'")

    p = _get_pvalue(-wbfn, distribution, alternative, xp=np)

    return BrunnerMunzelResult(wbfn, p)


@xp_capabilities(cpu_only=True, exceptions=['cupy', 'jax.numpy'],
    reason='Delegation for `special.stdtr` only implemented for CuPy and JAX.',
    jax_jit=False, allow_dask_compute=True)
@_axis_nan_policy_factory(SignificanceResult, kwd_samples=['weights'], paired=True)
def combine_pvalues(pvalues, method='fisher', weights=None, *, axis=0):
    """
    Combine p-values from independent tests that bear upon the same hypothesis.

    These methods are intended only for combining p-values from hypothesis
    tests based upon continuous distributions.

    Each method assumes that under the null hypothesis, the p-values are
    sampled independently and uniformly from the interval [0, 1]. A test
    statistic (different for each method) is computed and a combined
    p-value is calculated based upon the distribution of this test statistic
    under the null hypothesis.

    Parameters
    ----------
    pvalues : array_like
        Array of p-values assumed to come from independent tests based on
        continuous distributions.
    method : {'fisher', 'pearson', 'tippett', 'stouffer', 'mudholkar_george'}

        Name of method to use to combine p-values.

        The available methods are (see Notes for details):

        * 'fisher': Fisher's method (Fisher's combined probability test)
        * 'pearson': Pearson's method
        * 'mudholkar_george': Mudholkar's and George's method
        * 'tippett': Tippett's method
        * 'stouffer': Stouffer's Z-score method
    weights : array_like, optional
        Optional array of weights used only for Stouffer's Z-score method.
        Ignored by other methods.

    Returns
    -------
    res : SignificanceResult
        An object containing attributes:

        statistic : float
            The statistic calculated by the specified method.
        pvalue : float
            The combined p-value.

    Examples
    --------
    Suppose we wish to combine p-values from four independent tests
    of the same null hypothesis using Fisher's method (default).

    >>> from scipy.stats import combine_pvalues
    >>> pvalues = [0.1, 0.05, 0.02, 0.3]
    >>> combine_pvalues(pvalues)
    SignificanceResult(statistic=20.828626352604235, pvalue=0.007616871850449092)

    When the individual p-values carry different weights, consider Stouffer's
    method.

    >>> weights = [1, 2, 3, 4]
    >>> res = combine_pvalues(pvalues, method='stouffer', weights=weights)
    >>> res.pvalue
    0.009578891494533616

    Notes
    -----
    If this function is applied to tests with a discrete statistics such as
    any rank test or contingency-table test, it will yield systematically
    wrong results, e.g. Fisher's method will systematically overestimate the
    p-value [1]_. This problem becomes less severe for large sample sizes
    when the discrete distributions become approximately continuous.

    The differences between the methods can be best illustrated by their
    statistics and what aspects of a combination of p-values they emphasise
    when considering significance [2]_. For example, methods emphasising large
    p-values are more sensitive to strong false and true negatives; conversely
    methods focussing on small p-values are sensitive to positives.

    * The statistics of Fisher's method (also known as Fisher's combined
      probability test) [3]_ is :math:`-2\\sum_i \\log(p_i)`, which is
      equivalent (as a test statistics) to the product of individual p-values:
      :math:`\\prod_i p_i`. Under the null hypothesis, this statistics follows
      a :math:`\\chi^2` distribution. This method emphasises small p-values.
    * Pearson's method uses :math:`-2\\sum_i\\log(1-p_i)`, which is equivalent
      to :math:`\\prod_i \\frac{1}{1-p_i}` [2]_.
      It thus emphasises large p-values.
    * Mudholkar and George compromise between Fisher's and Pearson's method by
      averaging their statistics [4]_. Their method emphasises extreme
      p-values, both close to 1 and 0.
    * Stouffer's method [5]_ uses Z-scores and the statistic:
      :math:`\\sum_i \\Phi^{-1} (p_i)`, where :math:`\\Phi` is the CDF of the
      standard normal distribution. The advantage of this method is that it is
      straightforward to introduce weights, which can make Stouffer's method
      more powerful than Fisher's method when the p-values are from studies
      of different size [6]_ [7]_.
    * Tippett's method uses the smallest p-value as a statistic.
      (Mind that this minimum is not the combined p-value.)

    Fisher's method may be extended to combine p-values from dependent tests
    [8]_. Extensions such as Brown's method and Kost's method are not currently
    implemented.

    .. versionadded:: 0.15.0

    References
    ----------
    .. [1] Kincaid, W. M., "The Combination of Tests Based on Discrete
           Distributions." Journal of the American Statistical Association 57,
           no. 297 (1962), 10-19.
    .. [2] Heard, N. and Rubin-Delanchey, P. "Choosing between methods of
           combining p-values."  Biometrika 105.1 (2018): 239-246.
    .. [3] https://en.wikipedia.org/wiki/Fisher%27s_method
    .. [4] George, E. O., and G. S. Mudholkar. "On the convolution of logistic
           random variables." Metrika 30.1 (1983): 1-13.
    .. [5] https://en.wikipedia.org/wiki/Fisher%27s_method#Relation_to_Stouffer.27s_Z-score_method
    .. [6] Whitlock, M. C. "Combining probability from independent tests: the
           weighted Z-method is superior to Fisher's approach." Journal of
           Evolutionary Biology 18, no. 5 (2005): 1368-1373.
    .. [7] Zaykin, Dmitri V. "Optimally weighted Z-test is a powerful method
           for combining probabilities in meta-analysis." Journal of
           Evolutionary Biology 24, no. 8 (2011): 1836-1841.
    .. [8] https://en.wikipedia.org/wiki/Extensions_of_Fisher%27s_method

    """
    xp = array_namespace(pvalues, weights)
    pvalues, weights = xp_promote(pvalues, weights, broadcast=True,
                                  force_floating=True, xp=xp)

    if xp_size(pvalues) == 0:
        # This is really only needed for *testing* _axis_nan_policy decorator
        # It won't happen when the decorator is used.
        NaN = _get_nan(pvalues)
        return SignificanceResult(NaN, NaN)

    n = _length_nonmasked(pvalues, axis)
    n = xp.asarray(n, dtype=pvalues.dtype)

    if method == 'fisher':
        statistic = -2 * xp.sum(xp.log(pvalues), axis=axis)
        chi2 = _SimpleChi2(2*n)
        pval = _get_pvalue(statistic, chi2, alternative='greater',
                           symmetric=False, xp=xp)
    elif method == 'pearson':
        statistic = 2 * xp.sum(xp.log1p(-pvalues), axis=axis)
        chi2 = _SimpleChi2(2*n)
        pval = _get_pvalue(-statistic, chi2, alternative='less', symmetric=False, xp=xp)
    elif method == 'mudholkar_george':
        normalizing_factor = xp.sqrt(3/n)/xp.pi
        statistic = (-xp.sum(xp.log(pvalues), axis=axis)
                     + xp.sum(xp.log1p(-pvalues), axis=axis))
        nu = 5*n + 4
        approx_factor = xp.sqrt(nu / (nu - 2))
        t = _SimpleStudentT(nu)
        pval = _get_pvalue(statistic * normalizing_factor * approx_factor, t,
                           alternative="greater", xp=xp)
    elif method == 'tippett':
        statistic = xp.min(pvalues, axis=axis)
        beta = _SimpleBeta(xp.ones_like(n), n)
        pval = _get_pvalue(statistic, beta, alternative='less', symmetric=False, xp=xp)
    elif method == 'stouffer':
        if weights is None:
            weights = xp.ones_like(pvalues, dtype=pvalues.dtype)
        pvalues, weights = _share_masks(pvalues, weights, xp=xp)

        norm = _SimpleNormal()
        Zi = norm.isf(pvalues)
        # Consider `vecdot` when data-apis/array-api#910 is resolved
        statistic = (xp.sum(weights * Zi, axis=axis)
                     / xp_vector_norm(weights, axis=axis))
        pval = _get_pvalue(statistic, norm, alternative="greater", xp=xp)

    else:
        raise ValueError(
            f"Invalid method {method!r}. Valid methods are 'fisher', "
            "'pearson', 'mudholkar_george', 'tippett', and 'stouffer'"
        )

    return SignificanceResult(statistic, pval)


@dataclass
class QuantileTestResult:
    r"""
    Result of `scipy.stats.quantile_test`.

    Attributes
    ----------
    statistic: float
        The statistic used to calculate the p-value; either ``T1``, the
        number of observations less than or equal to the hypothesized quantile,
        or ``T2``, the number of observations strictly less than the
        hypothesized quantile. Two test statistics are required to handle the
        possibility the data was generated from a discrete or mixed
        distribution.

    statistic_type : int
        ``1`` or ``2`` depending on which of ``T1`` or ``T2`` was used to
        calculate the p-value respectively. ``T1`` corresponds to the
        ``"greater"`` alternative hypothesis and ``T2`` to the ``"less"``.  For
        the ``"two-sided"`` case, the statistic type that leads to smallest
        p-value is used.  For significant tests, ``statistic_type = 1`` means
        there is evidence that the population quantile is significantly greater
        than the hypothesized value and ``statistic_type = 2`` means there is
        evidence that it is significantly less than the hypothesized value.

    pvalue : float
        The p-value of the hypothesis test.
    """
    statistic: float
    statistic_type: int
    pvalue: float
    _alternative: list[str] = field(repr=False)
    _x : np.ndarray = field(repr=False)
    _p : float = field(repr=False)

    def confidence_interval(self, confidence_level=0.95):
        """
        Compute the confidence interval of the quantile.

        Parameters
        ----------
        confidence_level : float, default: 0.95
            Confidence level for the computed confidence interval
            of the quantile. Default is 0.95.

        Returns
        -------
        ci : ``ConfidenceInterval`` object
            The object has attributes ``low`` and ``high`` that hold the
            lower and upper bounds of the confidence interval.

        Examples
        --------
        >>> import numpy as np
        >>> import scipy.stats as stats
        >>> p = 0.75  # quantile of interest
        >>> q = 0  # hypothesized value of the quantile
        >>> x = np.exp(np.arange(0, 1.01, 0.01))
        >>> res = stats.quantile_test(x, q=q, p=p, alternative='less')
        >>> lb, ub = res.confidence_interval()
        >>> lb, ub
        (-inf, 2.293318740264183)
        >>> res = stats.quantile_test(x, q=q, p=p, alternative='two-sided')
        >>> lb, ub = res.confidence_interval(0.9)
        >>> lb, ub
        (1.9542373206359396, 2.293318740264183)
        """

        alternative = self._alternative
        p = self._p
        x = np.sort(self._x)
        n = len(x)
        bd = stats.binom(n, p)

        if confidence_level <= 0 or confidence_level >= 1:
            message = "`confidence_level` must be a number between 0 and 1."
            raise ValueError(message)

        low_index = np.nan
        high_index = np.nan

        if alternative == 'less':
            p = 1 - confidence_level
            low = -np.inf
            high_index = int(bd.isf(p))
            high = x[high_index] if high_index < n else np.nan
        elif alternative == 'greater':
            p = 1 - confidence_level
            low_index = int(bd.ppf(p)) - 1
            low = x[low_index] if low_index >= 0 else np.nan
            high = np.inf
        elif alternative == 'two-sided':
            p = (1 - confidence_level) / 2
            low_index = int(bd.ppf(p)) - 1
            low = x[low_index] if low_index >= 0 else np.nan
            high_index = int(bd.isf(p))
            high = x[high_index] if high_index < n else np.nan

        return ConfidenceInterval(low, high)


def quantile_test_iv(x, q, p, alternative):

    x = np.atleast_1d(x)
    message = '`x` must be a one-dimensional array of numbers.'
    if x.ndim != 1 or not np.issubdtype(x.dtype, np.number):
        raise ValueError(message)

    q = np.array(q)[()]
    message = "`q` must be a scalar."
    if q.ndim != 0 or not np.issubdtype(q.dtype, np.number):
        raise ValueError(message)

    p = np.array(p)[()]
    message = "`p` must be a float strictly between 0 and 1."
    if p.ndim != 0 or p >= 1 or p <= 0:
        raise ValueError(message)

    alternatives = {'two-sided', 'less', 'greater'}
    message = f"`alternative` must be one of {alternatives}"
    if alternative not in alternatives:
        raise ValueError(message)

    return x, q, p, alternative


def quantile_test(x, *, q=0, p=0.5, alternative='two-sided'):
    r"""
    Perform a quantile test and compute a confidence interval of the quantile.

    This function tests the null hypothesis that `q` is the value of the
    quantile associated with probability `p` of the population underlying
    sample `x`. For example, with default parameters, it tests that the
    median of the population underlying `x` is zero. The function returns an
    object including the test statistic, a p-value, and a method for computing
    the confidence interval around the quantile.

    Parameters
    ----------
    x : array_like
        A one-dimensional sample.
    q : float, default: 0
        The hypothesized value of the quantile.
    p : float, default: 0.5
        The probability associated with the quantile; i.e. the proportion of
        the population less than `q` is `p`. Must be strictly between 0 and
        1.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis.
        The following options are available (default is 'two-sided'):

        * 'two-sided': the quantile associated with the probability `p`
          is not `q`.
        * 'less': the quantile associated with the probability `p` is less
          than `q`.
        * 'greater': the quantile associated with the probability `p` is
          greater than `q`.

    Returns
    -------
    result : QuantileTestResult
        An object with the following attributes:

        statistic : float
            One of two test statistics that may be used in the quantile test.
            The first test statistic, ``T1``, is the proportion of samples in
            `x` that are less than or equal to the hypothesized quantile
            `q`. The second test statistic, ``T2``, is the proportion of
            samples in `x` that are strictly less than the hypothesized
            quantile `q`.

            When ``alternative = 'greater'``, ``T1`` is used to calculate the
            p-value and ``statistic`` is set to ``T1``.

            When ``alternative = 'less'``, ``T2`` is used to calculate the
            p-value and ``statistic`` is set to ``T2``.

            When ``alternative = 'two-sided'``, both ``T1`` and ``T2`` are
            considered, and the one that leads to the smallest p-value is used.

        statistic_type : int
            Either `1` or `2` depending on which of ``T1`` or ``T2`` was
            used to calculate the p-value.

        pvalue : float
            The p-value associated with the given alternative.

        The object also has the following method:

        confidence_interval(confidence_level=0.95)
            Computes a confidence interval around the the
            population quantile associated with the probability `p`. The
            confidence interval is returned in a ``namedtuple`` with
            fields `low` and `high`.  Values are `nan` when there are
            not enough observations to compute the confidence interval at
            the desired confidence.

    Notes
    -----
    This test and its method for computing confidence intervals are
    non-parametric. They are valid if and only if the observations are i.i.d.

    The implementation of the test follows Conover [1]_. Two test statistics
    are considered.

    ``T1``: The number of observations in `x` less than or equal to `q`.

        ``T1 = (x <= q).sum()``

    ``T2``: The number of observations in `x` strictly less than `q`.

        ``T2 = (x < q).sum()``

    The use of two test statistics is necessary to handle the possibility that
    `x` was generated from a discrete or mixed distribution.

    The null hypothesis for the test is:

        H0: The :math:`p^{\mathrm{th}}` population quantile is `q`.

    and the null distribution for each test statistic is
    :math:`\mathrm{binom}\left(n, p\right)`. When ``alternative='less'``,
    the alternative hypothesis is:

        H1: The :math:`p^{\mathrm{th}}` population quantile is less than `q`.

    and the p-value is the probability that the binomial random variable

    .. math::
        Y \sim \mathrm{binom}\left(n, p\right)

    is greater than or equal to the observed value ``T2``.

    When ``alternative='greater'``, the alternative hypothesis is:

        H1: The :math:`p^{\mathrm{th}}` population quantile is greater than `q`

    and the p-value is the probability that the binomial random variable Y
    is less than or equal to the observed value ``T1``.

    When ``alternative='two-sided'``, the alternative hypothesis is

        H1: `q` is not the :math:`p^{\mathrm{th}}` population quantile.

    and the p-value is twice the smaller of the p-values for the ``'less'``
    and ``'greater'`` cases. Both of these p-values can exceed 0.5 for the same
    data, so the value is clipped into the interval :math:`[0, 1]`.

    The approach for confidence intervals is attributed to Thompson [2]_ and
    later proven to be applicable to any set of i.i.d. samples [3]_. The
    computation is based on the observation that the probability of a quantile
    :math:`q` to be larger than any observations :math:`x_m (1\leq m \leq N)`
    can be computed as

    .. math::

        \mathbb{P}(x_m \leq q) = 1 - \sum_{k=0}^{m-1} \binom{N}{k}
        q^k(1-q)^{N-k}

    By default, confidence intervals are computed for a 95% confidence level.
    A common interpretation of a 95% confidence intervals is that if i.i.d.
    samples are drawn repeatedly from the same population and confidence
    intervals are formed each time, the confidence interval will contain the
    true value of the specified quantile in approximately 95% of trials.

    A similar function is available in the QuantileNPCI R package [4]_. The
    foundation is the same, but it computes the confidence interval bounds by
    doing interpolations between the sample values, whereas this function uses
    only sample values as bounds. Thus, ``quantile_test.confidence_interval``
    returns more conservative intervals (i.e., larger).

    The same computation of confidence intervals for quantiles is included in
    the confintr package [5]_.

    Two-sided confidence intervals are not guaranteed to be optimal; i.e.,
    there may exist a tighter interval that may contain the quantile of
    interest with probability larger than the confidence level.
    Without further assumption on the samples (e.g., the nature of the
    underlying distribution), the one-sided intervals are optimally tight.

    References
    ----------
    .. [1] W. J. Conover. Practical Nonparametric Statistics, 3rd Ed. 1999.
    .. [2] W. R. Thompson, "On Confidence Ranges for the Median and Other
       Expectation Distributions for Populations of Unknown Distribution
       Form," The Annals of Mathematical Statistics, vol. 7, no. 3,
       pp. 122-128, 1936, Accessed: Sep. 18, 2019. [Online]. Available:
       https://www.jstor.org/stable/2957563.
    .. [3] H. A. David and H. N. Nagaraja, "Order Statistics in Nonparametric
       Inference" in Order Statistics, John Wiley & Sons, Ltd, 2005, pp.
       159-170. Available:
       https://onlinelibrary.wiley.com/doi/10.1002/0471722162.ch7.
    .. [4] N. Hutson, A. Hutson, L. Yan, "QuantileNPCI: Nonparametric
       Confidence Intervals for Quantiles," R package,
       https://cran.r-project.org/package=QuantileNPCI
    .. [5] M. Mayer, "confintr: Confidence Intervals," R package,
       https://cran.r-project.org/package=confintr


    Examples
    --------

    Suppose we wish to test the null hypothesis that the median of a population
    is equal to 0.5. We choose a confidence level of 99%; that is, we will
    reject the null hypothesis in favor of the alternative if the p-value is
    less than 0.01.

    When testing random variates from the standard uniform distribution, which
    has a median of 0.5, we expect the data to be consistent with the null
    hypothesis most of the time.

    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng(6981396440634228121)
    >>> rvs = stats.uniform.rvs(size=100, random_state=rng)
    >>> stats.quantile_test(rvs, q=0.5, p=0.5)
    QuantileTestResult(statistic=45, statistic_type=1, pvalue=0.36820161732669576)

    As expected, the p-value is not below our threshold of 0.01, so
    we cannot reject the null hypothesis.

    When testing data from the standard *normal* distribution, which has a
    median of 0, we would expect the null hypothesis to be rejected.

    >>> rvs = stats.norm.rvs(size=100, random_state=rng)
    >>> stats.quantile_test(rvs, q=0.5, p=0.5)
    QuantileTestResult(statistic=67, statistic_type=2, pvalue=0.0008737198369123724)

    Indeed, the p-value is lower than our threshold of 0.01, so we reject the
    null hypothesis in favor of the default "two-sided" alternative: the median
    of the population is *not* equal to 0.5.

    However, suppose we were to test the null hypothesis against the
    one-sided alternative that the median of the population is *greater* than
    0.5. Since the median of the standard normal is less than 0.5, we would not
    expect the null hypothesis to be rejected.

    >>> stats.quantile_test(rvs, q=0.5, p=0.5, alternative='greater')
    QuantileTestResult(statistic=67, statistic_type=1, pvalue=0.9997956114162866)

    Unsurprisingly, with a p-value greater than our threshold, we would not
    reject the null hypothesis in favor of the chosen alternative.

    The quantile test can be used for any quantile, not only the median. For
    example, we can test whether the third quartile of the distribution
    underlying the sample is greater than 0.6.

    >>> rvs = stats.uniform.rvs(size=100, random_state=rng)
    >>> stats.quantile_test(rvs, q=0.6, p=0.75, alternative='greater')
    QuantileTestResult(statistic=64, statistic_type=1, pvalue=0.00940696592998271)

    The p-value is lower than the threshold. We reject the null hypothesis in
    favor of the alternative: the third quartile of the distribution underlying
    our sample is greater than 0.6.

    `quantile_test` can also compute confidence intervals for any quantile.

    >>> rvs = stats.norm.rvs(size=100, random_state=rng)
    >>> res = stats.quantile_test(rvs, q=0.6, p=0.75)
    >>> ci = res.confidence_interval(confidence_level=0.95)
    >>> ci
    ConfidenceInterval(low=0.284491604437432, high=0.8912531024914844)

    When testing a one-sided alternative, the confidence interval contains
    all observations such that if passed as `q`, the p-value of the
    test would be greater than 0.05, and therefore the null hypothesis
    would not be rejected. For example:

    >>> rvs.sort()
    >>> q, p, alpha = 0.6, 0.75, 0.95
    >>> res = stats.quantile_test(rvs, q=q, p=p, alternative='less')
    >>> ci = res.confidence_interval(confidence_level=alpha)
    >>> for x in rvs[rvs <= ci.high]:
    ...     res = stats.quantile_test(rvs, q=x, p=p, alternative='less')
    ...     assert res.pvalue > 1-alpha
    >>> for x in rvs[rvs > ci.high]:
    ...     res = stats.quantile_test(rvs, q=x, p=p, alternative='less')
    ...     assert res.pvalue < 1-alpha

    Also, if a 95% confidence interval is repeatedly generated for random
    samples, the confidence interval will contain the true quantile value in
    approximately 95% of replications.

    >>> dist = stats.rayleigh() # our "unknown" distribution
    >>> p = 0.2
    >>> true_stat = dist.ppf(p) # the true value of the statistic
    >>> n_trials = 1000
    >>> quantile_ci_contains_true_stat = 0
    >>> for i in range(n_trials):
    ...     data = dist.rvs(size=100, random_state=rng)
    ...     res = stats.quantile_test(data, p=p)
    ...     ci = res.confidence_interval(0.95)
    ...     if ci[0] < true_stat < ci[1]:
    ...         quantile_ci_contains_true_stat += 1
    >>> quantile_ci_contains_true_stat >= 950
    True

    This works with any distribution and any quantile, as long as the samples
    are i.i.d.
    """
    # Implementation carefully follows [1] 3.2
    # "H0: the p*th quantile of X is x*"
    # To facilitate comparison with [1], we'll use variable names that
    # best match Conover's notation
    X, x_star, p_star, H1 = quantile_test_iv(x, q, p, alternative)

    # "We will use two test statistics in this test. Let T1 equal "
    # "the number of observations less than or equal to x*, and "
    # "let T2 equal the number of observations less than x*."
    T1 = np.count_nonzero(X <= x_star)
    T2 = np.count_nonzero(X < x_star)

    # "The null distribution of the test statistics T1 and T2 is "
    # "the binomial distribution, with parameters n = sample size, and "
    # "p = p* as given in the null hypothesis.... Y has the binomial "
    # "distribution with parameters n and p*."
    n = len(X)
    Y = stats.binom(n=n, p=p_star)

    # "H1: the p* population quantile is less than x*"
    if H1 == 'less':
        # "The p-value is the probability that a binomial random variable Y "
        # "is greater than *or equal to* the observed value of T2...using p=p*"
        pvalue = Y.sf(T2-1)  # Y.pmf(T2) + Y.sf(T2)
        statistic = T2
        statistic_type = 2
    # "H1: the p* population quantile is greater than x*"
    elif H1 == 'greater':
        # "The p-value is the probability that a binomial random variable Y "
        # "is less than or equal to the observed value of T1... using p = p*"
        pvalue = Y.cdf(T1)
        statistic = T1
        statistic_type = 1
    # "H1: x* is not the p*th population quantile"
    elif H1 == 'two-sided':
        # "The p-value is twice the smaller of the probabilities that a
        # binomial random variable Y is less than or equal to the observed
        # value of T1 or greater than or equal to the observed value of T2
        # using p=p*."
        # Note: both one-sided p-values can exceed 0.5 for the same data, so
        # `clip`
        pvalues = [Y.cdf(T1), Y.sf(T2 - 1)]  # [greater, less]
        sorted_idx = np.argsort(pvalues)
        pvalue = np.clip(2*pvalues[sorted_idx[0]], 0, 1)
        if sorted_idx[0]:
            statistic, statistic_type = T2, 2
        else:
            statistic, statistic_type = T1, 1

    return QuantileTestResult(
        statistic=statistic,
        statistic_type=statistic_type,
        pvalue=pvalue,
        _alternative=H1,
        _x=X,
        _p=p_star
    )


#####################################
#       STATISTICAL DISTANCES       #
#####################################


def wasserstein_distance_nd(u_values, v_values, u_weights=None, v_weights=None):
    r"""
    Compute the Wasserstein-1 distance between two N-D discrete distributions.

    The Wasserstein distance, also called the Earth mover's distance or the
    optimal transport distance, is a similarity metric between two probability
    distributions [1]_. In the discrete case, the Wasserstein distance can be
    understood as the cost of an optimal transport plan to convert one
    distribution into the other. The cost is calculated as the product of the
    amount of probability mass being moved and the distance it is being moved.
    A brief and intuitive introduction can be found at [2]_.

    .. versionadded:: 1.13.0

    Parameters
    ----------
    u_values : 2d array_like
        A sample from a probability distribution or the support (set of all
        possible values) of a probability distribution. Each element along
        axis 0 is an observation or possible value, and axis 1 represents the
        dimensionality of the distribution; i.e., each row is a vector
        observation or possible value.

    v_values : 2d array_like
        A sample from or the support of a second distribution.

    u_weights, v_weights : 1d array_like, optional
        Weights or counts corresponding with the sample or probability masses
        corresponding with the support values. Sum of elements must be positive
        and finite. If unspecified, each value is assigned the same weight.

    Returns
    -------
    distance : float
        The computed distance between the distributions.

    Notes
    -----
    Given two probability mass functions, :math:`u`
    and :math:`v`, the first Wasserstein distance between the distributions
    using the Euclidean norm is:

    .. math::

        l_1 (u, v) = \inf_{\pi \in \Gamma (u, v)} \int \| x-y \|_2 \mathrm{d} \pi (x, y)

    where :math:`\Gamma (u, v)` is the set of (probability) distributions on
    :math:`\mathbb{R}^n \times \mathbb{R}^n` whose marginals are :math:`u` and
    :math:`v` on the first and second factors respectively. For a given value
    :math:`x`, :math:`u(x)` gives the probability of :math:`u` at position
    :math:`x`, and the same for :math:`v(x)`.

    This is also called the optimal transport problem or the Monge problem.
    Let the finite point sets :math:`\{x_i\}` and :math:`\{y_j\}` denote
    the support set of probability mass function :math:`u` and :math:`v`
    respectively. The Monge problem can be expressed as follows,

    Let :math:`\Gamma` denote the transport plan, :math:`D` denote the
    distance matrix and,

    .. math::

        x = \text{vec}(\Gamma)          \\
        c = \text{vec}(D)               \\
        b = \begin{bmatrix}
                u\\
                v\\
            \end{bmatrix}

    The :math:`\text{vec}()` function denotes the Vectorization function
    that transforms a matrix into a column vector by vertically stacking
    the columns of the matrix.
    The transport plan :math:`\Gamma` is a matrix :math:`[\gamma_{ij}]` in
    which :math:`\gamma_{ij}` is a positive value representing the amount of
    probability mass transported from :math:`u(x_i)` to :math:`v(y_i)`.
    Summing over the rows of :math:`\Gamma` should give the source distribution
    :math:`u` : :math:`\sum_j \gamma_{ij} = u(x_i)` holds for all :math:`i`
    and summing over the columns of :math:`\Gamma` should give the target
    distribution :math:`v`: :math:`\sum_i \gamma_{ij} = v(y_j)` holds for all
    :math:`j`.
    The distance matrix :math:`D` is a matrix :math:`[d_{ij}]`, in which
    :math:`d_{ij} = d(x_i, y_j)`.

    Given :math:`\Gamma`, :math:`D`, :math:`b`, the Monge problem can be
    transformed into a linear programming problem by
    taking :math:`A x = b` as constraints and :math:`z = c^T x` as minimization
    target (sum of costs) , where matrix :math:`A` has the form

    .. math::

        \begin{array} {rrrr|rrrr|r|rrrr}
            1 & 1 & \dots & 1 & 0 & 0 & \dots & 0 & \dots & 0 & 0 & \dots &
                0 \cr
            0 & 0 & \dots & 0 & 1 & 1 & \dots & 1 & \dots & 0 & 0 &\dots &
                0 \cr
            \vdots & \vdots & \ddots & \vdots & \vdots & \vdots & \ddots
                & \vdots & \vdots & \vdots & \vdots & \ddots & \vdots  \cr
            0 & 0 & \dots & 0 & 0 & 0 & \dots & 0 & \dots & 1 & 1 & \dots &
                1 \cr \hline

            1 & 0 & \dots & 0 & 1 & 0 & \dots & \dots & \dots & 1 & 0 & \dots &
                0 \cr
            0 & 1 & \dots & 0 & 0 & 1 & \dots & \dots & \dots & 0 & 1 & \dots &
                0 \cr
            \vdots & \vdots & \ddots & \vdots & \vdots & \vdots & \ddots &
                \vdots & \vdots & \vdots & \vdots & \ddots & \vdots \cr
            0 & 0 & \dots & 1 & 0 & 0 & \dots & 1 & \dots & 0 & 0 & \dots & 1
        \end{array}

    By solving the dual form of the above linear programming problem (with
    solution :math:`y^*`), the Wasserstein distance :math:`l_1 (u, v)` can
    be computed as :math:`b^T y^*`.

    The above solution is inspired by Vincent Herrmann's blog [3]_ . For a
    more thorough explanation, see [4]_ .

    The input distributions can be empirical, therefore coming from samples
    whose values are effectively inputs of the function, or they can be seen as
    generalized functions, in which case they are weighted sums of Dirac delta
    functions located at the specified values.

    References
    ----------
    .. [1] "Wasserstein metric",
           https://en.wikipedia.org/wiki/Wasserstein_metric
    .. [2] Lili Weng, "What is Wasserstein distance?", Lil'log,
           https://lilianweng.github.io/posts/2017-08-20-gan/#what-is-wasserstein-distance.
    .. [3] Hermann, Vincent. "Wasserstein GAN and the Kantorovich-Rubinstein
           Duality". https://vincentherrmann.github.io/blog/wasserstein/.
    .. [4] Peyré, Gabriel, and Marco Cuturi. "Computational optimal
           transport." Center for Research in Economics and Statistics
           Working Papers 2017-86 (2017).

    See Also
    --------
    wasserstein_distance: Compute the Wasserstein-1 distance between two
        1D discrete distributions.

    Examples
    --------
    Compute the Wasserstein distance between two three-dimensional samples,
    each with two observations.

    >>> from scipy.stats import wasserstein_distance_nd
    >>> wasserstein_distance_nd([[0, 2, 3], [1, 2, 5]], [[3, 2, 3], [4, 2, 5]])
    3.0

    Compute the Wasserstein distance between two two-dimensional distributions
    with three and two weighted observations, respectively.

    >>> wasserstein_distance_nd([[0, 2.75], [2, 209.3], [0, 0]],
    ...                      [[0.2, 0.322], [4.5, 25.1808]],
    ...                      [0.4, 5.2, 0.114], [0.8, 1.5])
    174.15840245217169
    """
    m, n = len(u_values), len(v_values)
    u_values = asarray(u_values)
    v_values = asarray(v_values)

    if u_values.ndim > 2 or v_values.ndim > 2:
        raise ValueError('Invalid input values. The inputs must have either '
                         'one or two dimensions.')
    # if dimensions are not equal throw error
    if u_values.ndim != v_values.ndim:
        raise ValueError('Invalid input values. Dimensions of inputs must be '
                         'equal.')
    # if data is 1D then call the cdf_distance function
    if u_values.ndim == 1 and v_values.ndim == 1:
        return _cdf_distance(1, u_values, v_values, u_weights, v_weights)

    u_values, u_weights = _validate_distribution(u_values, u_weights)
    v_values, v_weights = _validate_distribution(v_values, v_weights)
    # if number of columns is not equal throw error
    if u_values.shape[1] != v_values.shape[1]:
        raise ValueError('Invalid input values. If two-dimensional, '
                         '`u_values` and `v_values` must have the same '
                         'number of columns.')

    # if data contains np.inf then return inf or nan
    if np.any(np.isinf(u_values)) ^ np.any(np.isinf(v_values)):
        return np.inf
    elif np.any(np.isinf(u_values)) and np.any(np.isinf(v_values)):
        return np.nan

    # create constraints
    A_upper_part = sparse.block_diag((np.ones((1, n)), ) * m)
    A_lower_part = sparse.hstack((sparse.eye(n), ) * m)
    # sparse constraint matrix of size (m + n)*(m * n)
    A = sparse.vstack((A_upper_part, A_lower_part))
    A = sparse.coo_array(A)

    # get cost matrix
    D = distance_matrix(u_values, v_values, p=2)
    cost = D.ravel()

    # create the minimization target
    p_u = np.full(m, 1/m) if u_weights is None else u_weights/np.sum(u_weights)
    p_v = np.full(n, 1/n) if v_weights is None else v_weights/np.sum(v_weights)
    b = np.concatenate((p_u, p_v), axis=0)

    # solving LP
    constraints = LinearConstraint(A=A.T, ub=cost)
    opt_res = milp(c=-b, constraints=constraints, bounds=(-np.inf, np.inf))
    return -opt_res.fun


def wasserstein_distance(u_values, v_values, u_weights=None, v_weights=None):
    r"""
    Compute the Wasserstein-1 distance between two 1D discrete distributions.

    The Wasserstein distance, also called the Earth mover's distance or the
    optimal transport distance, is a similarity metric between two probability
    distributions [1]_. In the discrete case, the Wasserstein distance can be
    understood as the cost of an optimal transport plan to convert one
    distribution into the other. The cost is calculated as the product of the
    amount of probability mass being moved and the distance it is being moved.
    A brief and intuitive introduction can be found at [2]_.

    .. versionadded:: 1.0.0

    Parameters
    ----------
    u_values : 1d array_like
        A sample from a probability distribution or the support (set of all
        possible values) of a probability distribution. Each element is an
        observation or possible value.

    v_values : 1d array_like
        A sample from or the support of a second distribution.

    u_weights, v_weights : 1d array_like, optional
        Weights or counts corresponding with the sample or probability masses
        corresponding with the support values. Sum of elements must be positive
        and finite. If unspecified, each value is assigned the same weight.

    Returns
    -------
    distance : float
        The computed distance between the distributions.

    Notes
    -----
    Given two 1D probability mass functions, :math:`u` and :math:`v`, the first
    Wasserstein distance between the distributions is:

    .. math::

        l_1 (u, v) = \inf_{\pi \in \Gamma (u, v)} \int_{\mathbb{R} \times
        \mathbb{R}} |x-y| \mathrm{d} \pi (x, y)

    where :math:`\Gamma (u, v)` is the set of (probability) distributions on
    :math:`\mathbb{R} \times \mathbb{R}` whose marginals are :math:`u` and
    :math:`v` on the first and second factors respectively. For a given value
    :math:`x`, :math:`u(x)` gives the probability of :math:`u` at position
    :math:`x`, and the same for :math:`v(x)`.

    If :math:`U` and :math:`V` are the respective CDFs of :math:`u` and
    :math:`v`, this distance also equals to:

    .. math::

        l_1(u, v) = \int_{-\infty}^{+\infty} |U-V|

    See [3]_ for a proof of the equivalence of both definitions.

    The input distributions can be empirical, therefore coming from samples
    whose values are effectively inputs of the function, or they can be seen as
    generalized functions, in which case they are weighted sums of Dirac delta
    functions located at the specified values.

    References
    ----------
    .. [1] "Wasserstein metric", https://en.wikipedia.org/wiki/Wasserstein_metric
    .. [2] Lili Weng, "What is Wasserstein distance?", Lil'log,
           https://lilianweng.github.io/posts/2017-08-20-gan/#what-is-wasserstein-distance.
    .. [3] Ramdas, Garcia, Cuturi "On Wasserstein Two Sample Testing and Related
           Families of Nonparametric Tests" (2015). :arXiv:`1509.02237`.

    See Also
    --------
    wasserstein_distance_nd: Compute the Wasserstein-1 distance between two N-D
        discrete distributions.

    Examples
    --------
    >>> from scipy.stats import wasserstein_distance
    >>> wasserstein_distance([0, 1, 3], [5, 6, 8])
    5.0
    >>> wasserstein_distance([0, 1], [0, 1], [3, 1], [2, 2])
    0.25
    >>> wasserstein_distance([3.4, 3.9, 7.5, 7.8], [4.5, 1.4],
    ...                      [1.4, 0.9, 3.1, 7.2], [3.2, 3.5])
    4.0781331438047861

    """
    return _cdf_distance(1, u_values, v_values, u_weights, v_weights)


def energy_distance(u_values, v_values, u_weights=None, v_weights=None):
    r"""Compute the energy distance between two 1D distributions.

    .. versionadded:: 1.0.0

    Parameters
    ----------
    u_values, v_values : array_like
        Values observed in the (empirical) distribution.
    u_weights, v_weights : array_like, optional
        Weight for each value. If unspecified, each value is assigned the same
        weight.
        `u_weights` (resp. `v_weights`) must have the same length as
        `u_values` (resp. `v_values`). If the weight sum differs from 1, it
        must still be positive and finite so that the weights can be normalized
        to sum to 1.

    Returns
    -------
    distance : float
        The computed distance between the distributions.

    Notes
    -----
    The energy distance between two distributions :math:`u` and :math:`v`, whose
    respective CDFs are :math:`U` and :math:`V`, equals to:

    .. math::

        D(u, v) = \left( 2\mathbb E|X - Y| - \mathbb E|X - X'| -
        \mathbb E|Y - Y'| \right)^{1/2}

    where :math:`X` and :math:`X'` (resp. :math:`Y` and :math:`Y'`) are
    independent random variables whose probability distribution is :math:`u`
    (resp. :math:`v`).

    Sometimes the square of this quantity is referred to as the "energy
    distance" (e.g. in [2]_, [4]_), but as noted in [1]_ and [3]_, only the
    definition above satisfies the axioms of a distance function (metric).

    As shown in [2]_, for one-dimensional real-valued variables, the energy
    distance is linked to the non-distribution-free version of the Cramér-von
    Mises distance:

    .. math::

        D(u, v) = \sqrt{2} l_2(u, v) = \left( 2 \int_{-\infty}^{+\infty} (U-V)^2
        \right)^{1/2}

    Note that the common Cramér-von Mises criterion uses the distribution-free
    version of the distance. See [2]_ (section 2), for more details about both
    versions of the distance.

    The input distributions can be empirical, therefore coming from samples
    whose values are effectively inputs of the function, or they can be seen as
    generalized functions, in which case they are weighted sums of Dirac delta
    functions located at the specified values.

    References
    ----------
    .. [1] Rizzo, Szekely "Energy distance." Wiley Interdisciplinary Reviews:
           Computational Statistics, 8(1):27-38 (2015).
    .. [2] Szekely "E-statistics: The energy of statistical samples." Bowling
           Green State University, Department of Mathematics and Statistics,
           Technical Report 02-16 (2002).
    .. [3] "Energy distance", https://en.wikipedia.org/wiki/Energy_distance
    .. [4] Bellemare, Danihelka, Dabney, Mohamed, Lakshminarayanan, Hoyer,
           Munos "The Cramer Distance as a Solution to Biased Wasserstein
           Gradients" (2017). :arXiv:`1705.10743`.

    Examples
    --------
    >>> from scipy.stats import energy_distance
    >>> energy_distance([0], [2])
    2.0000000000000004
    >>> energy_distance([0, 8], [0, 8], [3, 1], [2, 2])
    1.0000000000000002
    >>> energy_distance([0.7, 7.4, 2.4, 6.8], [1.4, 8. ],
    ...                 [2.1, 4.2, 7.4, 8. ], [7.6, 8.8])
    0.88003340976158217

    """
    return np.sqrt(2) * _cdf_distance(2, u_values, v_values,
                                      u_weights, v_weights)


def _cdf_distance(p, u_values, v_values, u_weights=None, v_weights=None):
    r"""
    Compute, between two one-dimensional distributions :math:`u` and
    :math:`v`, whose respective CDFs are :math:`U` and :math:`V`, the
    statistical distance that is defined as:

    .. math::

        l_p(u, v) = \left( \int_{-\infty}^{+\infty} |U-V|^p \right)^{1/p}

    p is a positive parameter; p = 1 gives the Wasserstein distance, p = 2
    gives the energy distance.

    Parameters
    ----------
    u_values, v_values : array_like
        Values observed in the (empirical) distribution.
    u_weights, v_weights : array_like, optional
        Weight for each value. If unspecified, each value is assigned the same
        weight.
        `u_weights` (resp. `v_weights`) must have the same length as
        `u_values` (resp. `v_values`). If the weight sum differs from 1, it
        must still be positive and finite so that the weights can be normalized
        to sum to 1.

    Returns
    -------
    distance : float
        The computed distance between the distributions.

    Notes
    -----
    The input distributions can be empirical, therefore coming from samples
    whose values are effectively inputs of the function, or they can be seen as
    generalized functions, in which case they are weighted sums of Dirac delta
    functions located at the specified values.

    References
    ----------
    .. [1] Bellemare, Danihelka, Dabney, Mohamed, Lakshminarayanan, Hoyer,
           Munos "The Cramer Distance as a Solution to Biased Wasserstein
           Gradients" (2017). :arXiv:`1705.10743`.

    """
    u_values, u_weights = _validate_distribution(u_values, u_weights)
    v_values, v_weights = _validate_distribution(v_values, v_weights)

    u_sorter = np.argsort(u_values)
    v_sorter = np.argsort(v_values)

    all_values = np.concatenate((u_values, v_values))
    all_values.sort(kind='mergesort')

    # Compute the differences between pairs of successive values of u and v.
    deltas = np.diff(all_values)

    # Get the respective positions of the values of u and v among the values of
    # both distributions.
    u_cdf_indices = u_values[u_sorter].searchsorted(all_values[:-1], 'right')
    v_cdf_indices = v_values[v_sorter].searchsorted(all_values[:-1], 'right')

    # Calculate the CDFs of u and v using their weights, if specified.
    if u_weights is None:
        u_cdf = u_cdf_indices / u_values.size
    else:
        u_sorted_cumweights = np.concatenate(([0],
                                              np.cumsum(u_weights[u_sorter])))
        u_cdf = u_sorted_cumweights[u_cdf_indices] / u_sorted_cumweights[-1]

    if v_weights is None:
        v_cdf = v_cdf_indices / v_values.size
    else:
        v_sorted_cumweights = np.concatenate(([0],
                                              np.cumsum(v_weights[v_sorter])))
        v_cdf = v_sorted_cumweights[v_cdf_indices] / v_sorted_cumweights[-1]

    # Compute the value of the integral based on the CDFs.
    # If p = 1 or p = 2, we avoid using np.power, which introduces an overhead
    # of about 15%.
    if p == 1:
        return np_vecdot(np.abs(u_cdf - v_cdf), deltas)
    if p == 2:
        return np.sqrt(np_vecdot(np.square(u_cdf - v_cdf), deltas))
    return np.power(np_vecdot(np.power(np.abs(u_cdf - v_cdf), p), deltas), 1/p)


def _validate_distribution(values, weights):
    """
    Validate the values and weights from a distribution input of `cdf_distance`
    and return them as ndarray objects.

    Parameters
    ----------
    values : array_like
        Values observed in the (empirical) distribution.
    weights : array_like
        Weight for each value.

    Returns
    -------
    values : ndarray
        Values as ndarray.
    weights : ndarray
        Weights as ndarray.

    """
    # Validate the value array.
    values = np.asarray(values, dtype=float)
    if len(values) == 0:
        raise ValueError("Distribution can't be empty.")

    # Validate the weight array, if specified.
    if weights is not None:
        weights = np.asarray(weights, dtype=float)
        if len(weights) != len(values):
            raise ValueError('Value and weight array-likes for the same '
                             'empirical distribution must be of the same size.')
        if np.any(weights < 0):
            raise ValueError('All weights must be non-negative.')
        if not 0 < np.sum(weights) < np.inf:
            raise ValueError('Weight array-like sum must be positive and '
                             'finite. Set as None for an equal distribution of '
                             'weight.')

        return values, weights

    return values, None


#####################################
#         SUPPORT FUNCTIONS         #
#####################################

RepeatedResults = namedtuple('RepeatedResults', ('values', 'counts'))


@_deprecated("`scipy.stats.find_repeats` is deprecated as of SciPy 1.15.0 "
             "and will be removed in SciPy 1.17.0. Please use "
             "`numpy.unique`/`numpy.unique_counts` instead.")
def find_repeats(arr):
    """Find repeats and repeat counts.

    .. deprecated:: 1.15.0

        This function is deprecated as of SciPy 1.15.0 and will be removed
        in SciPy 1.17.0. Please use `numpy.unique` / `numpy.unique_counts` instead.

    Parameters
    ----------
    arr : array_like
        Input array. This is cast to float64.

    Returns
    -------
    values : ndarray
        The unique values from the (flattened) input that are repeated.

    counts : ndarray
        Number of times the corresponding 'value' is repeated.

    Notes
    -----
    In numpy >= 1.9 `numpy.unique` provides similar functionality. The main
    difference is that `find_repeats` only returns repeated values.

    Examples
    --------
    >>> from scipy import stats
    >>> stats.find_repeats([2, 1, 2, 3, 2, 2, 5])
    RepeatedResults(values=array([2.]), counts=array([4]))

    >>> stats.find_repeats([[10, 20, 1, 2], [5, 5, 4, 4]])
    RepeatedResults(values=array([4.,  5.]), counts=array([2, 2]))

    """
    # Note: always copies.
    return RepeatedResults(*_find_repeats(np.array(arr, dtype=np.float64)))


def _sum_of_squares(a, axis=0):
    """Square each element of the input array, and return the sum(s) of that.

    Parameters
    ----------
    a : array_like
        Input array.
    axis : int or None, optional
        Axis along which to calculate. Default is 0. If None, compute over
        the whole array `a`.

    Returns
    -------
    sum_of_squares : ndarray
        The sum along the given axis for (a**2).

    See Also
    --------
    _square_of_sums : The square(s) of the sum(s) (the opposite of
        `_sum_of_squares`).

    """
    a, axis = _chk_asarray(a, axis)
    return np_vecdot(a, a, axis=axis)


def _square_of_sums(a, axis=0):
    """Sum elements of the input array, and return the square(s) of that sum.

    Parameters
    ----------
    a : array_like
        Input array.
    axis : int or None, optional
        Axis along which to calculate. Default is 0. If None, compute over
        the whole array `a`.

    Returns
    -------
    square_of_sums : float or ndarray
        The square of the sum over `axis`.

    See Also
    --------
    _sum_of_squares : The sum of squares (the opposite of `square_of_sums`).

    """
    a, axis = _chk_asarray(a, axis)
    s = np.sum(a, axis)
    if not np.isscalar(s):
        return s.astype(float) * s
    else:
        return float(s) * s


@xp_capabilities(skip_backends=[("torch", "no `repeat`"),
                                ("cupy", "`repeat` can't handle array second arg"),
                                ("dask.array", "no `take_along_axis`")],
                 jax_jit=False, allow_dask_compute=True)
def rankdata(a, method='average', *, axis=None, nan_policy='propagate'):
    """Assign ranks to data, dealing with ties appropriately.

    By default (``axis=None``), the data array is first flattened, and a flat
    array of ranks is returned. Separately reshape the rank array to the
    shape of the data array if desired (see Examples).

    Ranks begin at 1.  The `method` argument controls how ranks are assigned
    to equal values.  See [1]_ for further discussion of ranking methods.

    Parameters
    ----------
    a : array_like
        The array of values to be ranked.
    method : {'average', 'min', 'max', 'dense', 'ordinal'}, optional
        The method used to assign ranks to tied elements.
        The following methods are available (default is 'average'):

          * 'average': The average of the ranks that would have been assigned to
            all the tied values is assigned to each value.
          * 'min': The minimum of the ranks that would have been assigned to all
            the tied values is assigned to each value.  (This is also
            referred to as "competition" ranking.)
          * 'max': The maximum of the ranks that would have been assigned to all
            the tied values is assigned to each value.
          * 'dense': Like 'min', but the rank of the next highest element is
            assigned the rank immediately after those assigned to the tied
            elements.
          * 'ordinal': All values are given a distinct rank, corresponding to
            the order that the values occur in `a`.
    axis : {None, int}, optional
        Axis along which to perform the ranking. If ``None``, the data array
        is first flattened.
    nan_policy : {'propagate', 'omit', 'raise'}, optional
        Defines how to handle when input contains nan.
        The following options are available (default is 'propagate'):

          * 'propagate': propagates nans through the rank calculation
          * 'omit': performs the calculations ignoring nan values
          * 'raise': raises an error

        .. note::

            When `nan_policy` is 'propagate', the output is an array of *all*
            nans because ranks relative to nans in the input are undefined.
            When `nan_policy` is 'omit', nans in `a` are ignored when ranking
            the other values, and the corresponding locations of the output
            are nan.

        .. versionadded:: 1.10

    Returns
    -------
    ranks : ndarray
         An array of size equal to the size of `a`, containing rank
         scores.

    References
    ----------
    .. [1] "Ranking", https://en.wikipedia.org/wiki/Ranking

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.stats import rankdata
    >>> rankdata([0, 2, 3, 2])
    array([ 1. ,  2.5,  4. ,  2.5])
    >>> rankdata([0, 2, 3, 2], method='min')
    array([ 1,  2,  4,  2])
    >>> rankdata([0, 2, 3, 2], method='max')
    array([ 1,  3,  4,  3])
    >>> rankdata([0, 2, 3, 2], method='dense')
    array([ 1,  2,  3,  2])
    >>> rankdata([0, 2, 3, 2], method='ordinal')
    array([ 1,  2,  4,  3])
    >>> rankdata([[0, 2], [3, 2]]).reshape(2,2)
    array([[1. , 2.5],
          [4. , 2.5]])
    >>> rankdata([[0, 2, 2], [3, 2, 5]], axis=1)
    array([[1. , 2.5, 2.5],
           [2. , 1. , 3. ]])
    >>> rankdata([0, 2, 3, np.nan, -2, np.nan], nan_policy="propagate")
    array([nan, nan, nan, nan, nan, nan])
    >>> rankdata([0, 2, 3, np.nan, -2, np.nan], nan_policy="omit")
    array([ 2.,  3.,  4., nan,  1., nan])

    """
    methods = ('average', 'min', 'max', 'dense', 'ordinal')
    if method not in methods:
        raise ValueError(f'unknown method "{method}"')

    xp = array_namespace(a)
    x = xp.asarray(a)

    if axis is None:
        x = xp_ravel(x)
        axis = -1

    if xp_size(x) == 0:
        dtype = xp.asarray(1.).dtype if method == 'average' else xp.asarray(1).dtype
        return xp.empty(x.shape, dtype=dtype)

    contains_nan = _contains_nan(x, nan_policy)

    x = xp_swapaxes(x, axis, -1, xp=xp)
    ranks = _rankdata(x, method, xp=xp)

    if contains_nan:
        default_float = xp_default_dtype(xp)
        i_nan = (xp.isnan(x) if nan_policy == 'omit'
                 else xp.any(xp.isnan(x), axis=-1))
        ranks = xp.asarray(ranks, dtype=default_float)  # copy=False when implemented
        ranks[i_nan] = xp.nan

    ranks = xp_swapaxes(ranks, axis, -1, xp=xp)
    return ranks


def _order_ranks(ranks, j, *, xp):
    # Reorder ascending order `ranks` according to `j`
    xp = array_namespace(ranks) if xp is None else xp
    if is_numpy(xp) or is_cupy(xp):
        ordered_ranks = xp.empty(j.shape, dtype=ranks.dtype)
        xp.put_along_axis(ordered_ranks, j, ranks, axis=-1)
    else:
        # `put_along_axis` not in array API (data-apis/array-api#177)
        #  so argsort the argsort and take_along_axis...
        j_inv = xp.argsort(j, axis=-1)
        ordered_ranks = xp.take_along_axis(ranks, j_inv, axis=-1)
    return ordered_ranks


def _rankdata(x, method, return_ties=False, xp=None):
    # Rank data `x` by desired `method`; `return_ties` if desired
    xp = array_namespace(x) if xp is None else xp
    shape = x.shape
    dtype = xp.asarray(1.).dtype if method == 'average' else xp.asarray(1).dtype

    # Get sort order
    j = xp.argsort(x, axis=-1)
    ordinal_ranks = xp.broadcast_to(xp.arange(1, shape[-1]+1, dtype=dtype), shape)

    # Ordinal ranks is very easy because ties don't matter. We're done.
    if method == 'ordinal':
        return _order_ranks(ordinal_ranks, j, xp=xp)  # never return ties

    # Sort array
    y = xp.take_along_axis(x, j, axis=-1)
    # Logical indices of unique elements
    i = xp.concat([xp.ones(shape[:-1] + (1,), dtype=xp.bool),
                   y[..., :-1] != y[..., 1:]], axis=-1)

    # Integer indices of unique elements
    indices = xp.arange(xp_size(y))[xp.reshape(i, (-1,))]  # i gets raveled
    # Counts of unique elements
    counts = xp.diff(indices, append=xp.asarray([xp_size(y)], dtype=indices.dtype))

    # Compute `'min'`, `'max'`, and `'mid'` ranks of unique elements
    if method == 'min':
        ranks = ordinal_ranks[i]
    elif method == 'max':
        ranks = ordinal_ranks[i] + counts - 1
    elif method == 'average':
        # array API doesn't promote integers to floats
        ranks = ordinal_ranks[i] + (xp.asarray(counts, dtype=dtype) - 1)/2
    elif method == 'dense':
        ranks = xp.cumulative_sum(xp.astype(i, dtype, copy=False), axis=-1)[i]

    ranks = xp.reshape(xp.repeat(ranks, counts), shape)
    ranks = _order_ranks(ranks, j, xp=xp)

    if return_ties:
        # Tie information is returned in a format that is useful to functions that
        # rely on this (private) function. Example:
        # >>> x = np.asarray([3, 2, 1, 2, 2, 2, 1])
        # >>> _, t = _rankdata(x, 'average', return_ties=True)
        # >>> t  # array([2., 0., 4., 0., 0., 0., 1.])  # two 1s, four 2s, and one 3
        # Unlike ranks, tie counts are *not* reordered to correspond with the order of
        # the input; e.g. the number of appearances of the lowest rank element comes
        # first. This is a useful format because:
        # - The shape of the result is the shape of the input. Different slices can
        #   have different numbers of tied elements but not result in a ragged array.
        # - Functions that use `t` usually don't need to which each element of the
        #   original array is associated with each tie count; they perform a reduction
        #   over the tie counts onnly. The tie counts are naturally computed in a
        #   sorted order, so this does not unnecessarily reorder them.
        # - One exception is `wilcoxon`, which needs the number of zeros. Zeros always
        #   have the lowest rank, so it is easy to find them at the zeroth index.
        t = xp.zeros(shape, dtype=xp.float64)
        t[i] = counts
        return ranks, t
    return ranks


def expectile(a, alpha=0.5, *, weights=None):
    r"""Compute the expectile at the specified level.

    Expectiles are a generalization of the expectation in the same way as
    quantiles are a generalization of the median. The expectile at level
    `alpha = 0.5` is the mean (average). See Notes for more details.

    Parameters
    ----------
    a : array_like
        Array containing numbers whose expectile is desired.
    alpha : float, default: 0.5
        The level of the expectile; e.g., ``alpha=0.5`` gives the mean.
    weights : array_like, optional
        An array of weights associated with the values in `a`.
        The `weights` must be broadcastable to the same shape as `a`.
        Default is None, which gives each value a weight of 1.0.
        An integer valued weight element acts like repeating the corresponding
        observation in `a` that many times. See Notes for more details.

    Returns
    -------
    expectile : ndarray
        The empirical expectile at level `alpha`.

    See Also
    --------
    numpy.mean : Arithmetic average
    numpy.quantile : Quantile

    Notes
    -----
    In general, the expectile at level :math:`\alpha` of a random variable
    :math:`X` with cumulative distribution function (CDF) :math:`F` is given
    by the unique solution :math:`t` of:

    .. math::

        \alpha E((X - t)_+) = (1 - \alpha) E((t - X)_+) \,.

    Here, :math:`(x)_+ = \max(0, x)` is the positive part of :math:`x`.
    This equation can be equivalently written as:

    .. math::

        \alpha \int_t^\infty (x - t)\mathrm{d}F(x)
        = (1 - \alpha) \int_{-\infty}^t (t - x)\mathrm{d}F(x) \,.

    The empirical expectile at level :math:`\alpha` (`alpha`) of a sample
    :math:`a_i` (the array `a`) is defined by plugging in the empirical CDF of
    `a`. Given sample or case weights :math:`w` (the array `weights`), it
    reads :math:`F_a(x) = \frac{1}{\sum_i w_i} \sum_i w_i 1_{a_i \leq x}`
    with indicator function :math:`1_{A}`. This leads to the definition of the
    empirical expectile at level `alpha` as the unique solution :math:`t` of:

    .. math::

        \alpha \sum_{i=1}^n w_i (a_i - t)_+ =
            (1 - \alpha) \sum_{i=1}^n w_i (t - a_i)_+ \,.

    For :math:`\alpha=0.5`, this simplifies to the weighted average.
    Furthermore, the larger :math:`\alpha`, the larger the value of the
    expectile.

    As a final remark, the expectile at level :math:`\alpha` can also be
    written as a minimization problem. One often used choice is

    .. math::

        \operatorname{argmin}_t
        E(\lvert 1_{t\geq X} - \alpha\rvert(t - X)^2) \,.

    References
    ----------
    .. [1] W. K. Newey and J. L. Powell (1987), "Asymmetric Least Squares
           Estimation and Testing," Econometrica, 55, 819-847.
    .. [2] T. Gneiting (2009). "Making and Evaluating Point Forecasts,"
           Journal of the American Statistical Association, 106, 746 - 762.
           :doi:`10.48550/arXiv.0912.0902`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.stats import expectile
    >>> a = [1, 4, 2, -1]
    >>> expectile(a, alpha=0.5) == np.mean(a)
    True
    >>> expectile(a, alpha=0.2)
    0.42857142857142855
    >>> expectile(a, alpha=0.8)
    2.5714285714285716
    >>> weights = [1, 3, 1, 1]
    >>> expectile(a, alpha=0.8, weights=weights)
    3.3333333333333335
    """
    if alpha < 0 or alpha > 1:
        raise ValueError(
            "The expectile level alpha must be in the range [0, 1]."
        )
    a = np.asarray(a)

    if weights is not None:
        weights = np.broadcast_to(weights, a.shape)

    # This is the empirical equivalent of Eq. (13) with identification
    # function from Table 9 (omitting a factor of 2) in [2] (their y is our
    # data a, their x is our t)
    def first_order(t):
        return np.average(np.abs((a <= t) - alpha) * (t - a), weights=weights)

    if alpha >= 0.5:
        x0 = np.average(a, weights=weights)
        x1 = np.amax(a)
    else:
        x1 = np.average(a, weights=weights)
        x0 = np.amin(a)

    if x0 == x1:
        # a has a single unique element
        return x0

    # Note that the expectile is the unique solution, so no worries about
    # finding a wrong root.
    res = root_scalar(first_order, x0=x0, x1=x1)
    return res.root


def _lmoment_iv(sample, order, axis, sorted, standardize):
    # input validation/standardization for `lmoment`
    sample = np.asarray(sample)
    message = "`sample` must be an array of real numbers."
    if np.issubdtype(sample.dtype, np.integer):
        sample = sample.astype(np.float64)
    if not np.issubdtype(sample.dtype, np.floating):
        raise ValueError(message)

    message = "`order` must be a scalar or a non-empty array of positive integers."
    order = np.arange(1, 5) if order is None else np.asarray(order)
    if not np.issubdtype(order.dtype, np.integer) or np.any(order <= 0):
        raise ValueError(message)

    axis = np.asarray(axis)[()]
    message = "`axis` must be an integer."
    if not np.issubdtype(axis.dtype, np.integer) or axis.ndim != 0:
        raise ValueError(message)

    sorted = np.asarray(sorted)[()]
    message = "`sorted` must be True or False."
    if not np.issubdtype(sorted.dtype, np.bool_) or sorted.ndim != 0:
        raise ValueError(message)

    standardize = np.asarray(standardize)[()]
    message = "`standardize` must be True or False."
    if not np.issubdtype(standardize.dtype, np.bool_) or standardize.ndim != 0:
        raise ValueError(message)

    sample = np.moveaxis(sample, axis, -1)
    sample = np.sort(sample, axis=-1) if not sorted else sample

    return sample, order, axis, sorted, standardize


def _br(x, *, r=0):
    n = x.shape[-1]
    x = np.expand_dims(x, axis=-2)
    x = np.broadcast_to(x, x.shape[:-2] + (len(r), n))
    x = np.triu(x)
    j = np.arange(n, dtype=x.dtype)
    n = np.asarray(n, dtype=x.dtype)[()]
    return (np_vecdot(special.binom(j, r[:, np.newaxis]), x, axis=-1)
            / special.binom(n-1, r) / n)


def _prk(r, k):
    # Writen to match [1] Equation 27 closely to facilitate review.
    # This does not protect against overflow, so improvements to
    # robustness would be a welcome follow-up.
    return (-1)**(r-k)*special.binom(r, k)*special.binom(r+k, k)


@_axis_nan_policy_factory(  # noqa: E302
    _moment_result_object, n_samples=1, result_to_tuple=_moment_tuple,
    n_outputs=lambda kwds: _moment_outputs(kwds, [1, 2, 3, 4])
)
def lmoment(sample, order=None, *, axis=0, sorted=False, standardize=True):
    r"""Compute L-moments of a sample from a continuous distribution

    The L-moments of a probability distribution are summary statistics with
    uses similar to those of conventional moments, but they are defined in
    terms of the expected values of order statistics.
    Sample L-moments are defined analogously to population L-moments, and
    they can serve as estimators of population L-moments. They tend to be less
    sensitive to extreme observations than conventional moments.

    Parameters
    ----------
    sample : array_like
        The real-valued sample whose L-moments are desired.
    order : array_like, optional
        The (positive integer) orders of the desired L-moments.
        Must be a scalar or non-empty 1D array. Default is [1, 2, 3, 4].
    axis : int or None, default=0
        If an int, the axis of the input along which to compute the statistic.
        The statistic of each axis-slice (e.g. row) of the input will appear
        in a corresponding element of the output. If None, the input will be
        raveled before computing the statistic.
    sorted : bool, default=False
        Whether `sample` is already sorted in increasing order along `axis`.
        If False (default), `sample` will be sorted.
    standardize : bool, default=True
        Whether to return L-moment ratios for orders 3 and higher.
        L-moment ratios are analogous to standardized conventional
        moments: they are the non-standardized L-moments divided
        by the L-moment of order 2.

    Returns
    -------
    lmoments : ndarray
        The sample L-moments of order `order`.

    See Also
    --------
    moment

    References
    ----------
    .. [1] D. Bilkova. "L-Moments and TL-Moments as an Alternative Tool of
           Statistical Data Analysis". Journal of Applied Mathematics and
           Physics. 2014. :doi:`10.4236/jamp.2014.210104`
    .. [2] J. R. M. Hosking. "L-Moments: Analysis and Estimation of Distributions
           Using Linear Combinations of Order Statistics". Journal of the Royal
           Statistical Society. 1990. :doi:`10.1111/j.2517-6161.1990.tb01775.x`
    .. [3] "L-moment". *Wikipedia*. https://en.wikipedia.org/wiki/L-moment.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng(328458568356392)
    >>> sample = rng.exponential(size=100000)
    >>> stats.lmoment(sample)
    array([1.00124272, 0.50111437, 0.3340092 , 0.16755338])

    Note that the first four standardized population L-moments of the standard
    exponential distribution are 1, 1/2, 1/3, and 1/6; the sample L-moments
    provide reasonable estimates.

    """
    args = _lmoment_iv(sample, order, axis, sorted, standardize)
    sample, order, axis, sorted, standardize = args

    n_moments = np.max(order)
    k = np.arange(n_moments, dtype=sample.dtype)
    prk = _prk(np.expand_dims(k, tuple(range(1, sample.ndim+1))), k)
    bk = _br(sample, r=k)

    n = sample.shape[-1]
    bk[..., n:] = 0  # remove NaNs due to n_moments > n

    lmoms = np_vecdot(prk, bk, axis=-1)
    if standardize and n_moments > 2:
        lmoms[2:] /= lmoms[1]

    lmoms[n:] = np.nan  # add NaNs where appropriate
    return lmoms[order-1]


LinregressResult = _make_tuple_bunch('LinregressResult',
                                     ['slope', 'intercept', 'rvalue',
                                      'pvalue', 'stderr'],
                                     extra_field_names=['intercept_stderr'])


def _pack_LinregressResult(slope, intercept, rvalue, pvalue, stderr, intercept_stderr):
    return LinregressResult(slope, intercept, rvalue, pvalue, stderr,
                            intercept_stderr=intercept_stderr)


def _unpack_LinregressResult(res, _):
    return tuple(res) + (res.intercept_stderr,)


@_axis_nan_policy_factory(_pack_LinregressResult, n_samples=2,
                          result_to_tuple=_unpack_LinregressResult, paired=True,
                          too_small=1, n_outputs=6)
def linregress(x, y, alternative='two-sided'):
    """
    Calculate a linear least-squares regression for two sets of measurements.

    Parameters
    ----------
    x, y : array_like
        Two sets of measurements.  Both arrays should have the same length N.
    alternative : {'two-sided', 'less', 'greater'}, optional
        Defines the alternative hypothesis. Default is 'two-sided'.
        The following options are available:

        * 'two-sided': the slope of the regression line is nonzero
        * 'less': the slope of the regression line is less than zero
        * 'greater':  the slope of the regression line is greater than zero

        .. versionadded:: 1.7.0

    Returns
    -------
    result : ``LinregressResult`` instance
        The return value is an object with the following attributes:

        slope : float
            Slope of the regression line.
        intercept : float
            Intercept of the regression line.
        rvalue : float
            The Pearson correlation coefficient. The square of ``rvalue``
            is equal to the coefficient of determination.
        pvalue : float
            The p-value for a hypothesis test whose null hypothesis is
            that the slope is zero, using Wald Test with t-distribution of
            the test statistic. See `alternative` above for alternative
            hypotheses.
        stderr : float
            Standard error of the estimated slope (gradient), under the
            assumption of residual normality.
        intercept_stderr : float
            Standard error of the estimated intercept, under the assumption
            of residual normality.

    See Also
    --------
    scipy.optimize.curve_fit :
        Use non-linear least squares to fit a function to data.
    scipy.optimize.leastsq :
        Minimize the sum of squares of a set of equations.

    Notes
    -----
    For compatibility with older versions of SciPy, the return value acts
    like a ``namedtuple`` of length 5, with fields ``slope``, ``intercept``,
    ``rvalue``, ``pvalue`` and ``stderr``, so one can continue to write::

        slope, intercept, r, p, se = linregress(x, y)

    With that style, however, the standard error of the intercept is not
    available.  To have access to all the computed values, including the
    standard error of the intercept, use the return value as an object
    with attributes, e.g.::

        result = linregress(x, y)
        print(result.intercept, result.intercept_stderr)

    Examples
    --------
    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy import stats
    >>> rng = np.random.default_rng()

    Generate some data:

    >>> x = rng.random(10)
    >>> y = 1.6*x + rng.random(10)

    Perform the linear regression:

    >>> res = stats.linregress(x, y)

    Coefficient of determination (R-squared):

    >>> print(f"R-squared: {res.rvalue**2:.6f}")
    R-squared: 0.717533

    Plot the data along with the fitted line:

    >>> plt.plot(x, y, 'o', label='original data')
    >>> plt.plot(x, res.intercept + res.slope*x, 'r', label='fitted line')
    >>> plt.legend()
    >>> plt.show()

    Calculate 95% confidence interval on slope and intercept:

    >>> # Two-sided inverse Students t-distribution
    >>> # p - probability, df - degrees of freedom
    >>> from scipy.stats import t
    >>> tinv = lambda p, df: abs(t.ppf(p/2, df))

    >>> ts = tinv(0.05, len(x)-2)
    >>> print(f"slope (95%): {res.slope:.6f} +/- {ts*res.stderr:.6f}")
    slope (95%): 1.453392 +/- 0.743465
    >>> print(f"intercept (95%): {res.intercept:.6f}"
    ...       f" +/- {ts*res.intercept_stderr:.6f}")
    intercept (95%): 0.616950 +/- 0.544475

    """
    TINY = 1.0e-20
    x = np.asarray(x)
    y = np.asarray(y)

    if x.size == 0 or y.size == 0:
        raise ValueError("Inputs must not be empty.")

    if np.amax(x) == np.amin(x) and len(x) > 1:
        raise ValueError("Cannot calculate a linear regression "
                         "if all x values are identical")

    n = len(x)
    xmean = np.mean(x, None)
    ymean = np.mean(y, None)

    # Average sums of square differences from the mean
    #   ssxm = mean( (x-mean(x))^2 )
    #   ssxym = mean( (x-mean(x)) * (y-mean(y)) )
    ssxm, ssxym, _, ssym = np.cov(x, y, bias=1).flat

    # R-value
    #   r = ssxym / sqrt( ssxm * ssym )
    if ssxm == 0.0 or ssym == 0.0:
        # If the denominator was going to be 0
        r = np.asarray(np.nan if ssxym == 0 else 0.0)[()]
    else:
        r = ssxym / np.sqrt(ssxm * ssym)
        # Test for numerical error propagation (make sure -1 < r < 1)
        if r > 1.0:
            r = 1.0
        elif r < -1.0:
            r = -1.0

    slope = ssxym / ssxm
    intercept = ymean - slope*xmean
    if n == 2:
        # handle case when only two points are passed in
        if y[0] == y[1]:
            prob = 1.0
        else:
            prob = 0.0
        slope_stderr = 0.0
        intercept_stderr = 0.0
    else:
        df = n - 2  # Number of degrees of freedom
        # n-2 degrees of freedom because 2 has been used up
        # to estimate the mean and standard deviation
        t = r * np.sqrt(df / ((1.0 - r + TINY)*(1.0 + r + TINY)))

        dist = _SimpleStudentT(df)
        prob = _get_pvalue(t, dist, alternative, xp=np)
        prob = prob[()] if prob.ndim == 0 else prob

        slope_stderr = np.sqrt((1 - r**2) * ssym / ssxm / df)

        # Also calculate the standard error of the intercept
        # The following relationship is used:
        #   ssxm = mean( (x-mean(x))^2 )
        #        = ssx - sx*sx
        #        = mean( x^2 ) - mean(x)^2
        intercept_stderr = slope_stderr * np.sqrt(ssxm + xmean**2)

    return LinregressResult(slope=slope, intercept=intercept, rvalue=r,
                            pvalue=prob, stderr=slope_stderr,
                            intercept_stderr=intercept_stderr)


def _xp_mean(x, /, *, axis=None, weights=None, keepdims=False, nan_policy='propagate',
             dtype=None, xp=None):
    r"""Compute the arithmetic mean along the specified axis.

    Parameters
    ----------
    x : real array
        Array containing real numbers whose mean is desired.
    axis : int or tuple of ints, default: None
        If an int or tuple of ints, the axis or axes of the input along which
        to compute the statistic. The statistic of each axis-slice (e.g. row)
        of the input will appear in a corresponding element of the output.
        If ``None``, the input will be raveled before computing the statistic.
    weights : real array, optional
        If specified, an array of weights associated with the values in `x`;
        otherwise ``1``. If `weights` and `x` do not have the same shape, the
        arrays will be broadcasted before performing the calculation. See
        Notes for details.
    keepdims : boolean, optional
        If this is set to ``True``, the axes which are reduced are left
        in the result as dimensions with length one. With this option,
        the result will broadcast correctly against the input array.
    nan_policy : {'propagate', 'omit', 'raise'}, default: 'propagate'
        Defines how to handle input NaNs.

        - ``propagate``: if a NaN is present in the axis slice (e.g. row) along
          which the statistic is computed, the corresponding entry of the output
          will be NaN.
        - ``omit``: NaNs will be omitted when performing the calculation.
          If insufficient data remains in the axis slice along which the
          statistic is computed, the corresponding entry of the output will be
          NaN.
        - ``raise``: if a NaN is present, a ``ValueError`` will be raised.

    dtype : dtype, optional
        Type to use in computing the mean. For integer inputs, the default is
        the default float type of the array library; for floating point inputs,
        the dtype is that of the input.

    Returns
    -------
    out : array
        The mean of each slice

    Notes
    -----
    Let :math:`x_i` represent element :math:`i` of data `x` and let :math:`w_i`
    represent the corresponding element of `weights` after broadcasting. Then the
    (weighted) mean :math:`\bar{x}_w` is given by:

    .. math::

        \bar{x}_w = \frac{ \sum_{i=0}^{n-1} w_i x_i }
                         { \sum_{i=0}^{n-1} w_i }

    where :math:`n` is the number of elements along a slice. Note that this simplifies
    to the familiar :math:`(\sum_i x_i) / n` when the weights are all ``1`` (default).

    The behavior of this function with respect to weights is somewhat different
    from that of `np.average`. For instance,
    `np.average` raises an error when `axis` is not specified and the shapes of `x`
    and the `weights` array are not the same; `xp_mean` simply broadcasts the two.
    Also, `np.average` raises an error when weights sum to zero along a slice;
    `xp_mean` computes the appropriate result. The intent is for this function's
    interface to be consistent with the rest of `scipy.stats`.

    Note that according to the formula, including NaNs with zero weights is not
    the same as *omitting* NaNs with ``nan_policy='omit'``; in the former case,
    the NaNs will continue to propagate through the calculation whereas in the
    latter case, the NaNs are excluded entirely.

    """
    # ensure that `x` and `weights` are array-API compatible arrays of identical shape
    xp = array_namespace(x) if xp is None else xp
    x = _asarray(x, dtype=dtype, subok=True)
    weights = xp.asarray(weights, dtype=dtype) if weights is not None else weights

    # to ensure that this matches the behavior of decorated functions when one of the
    # arguments has size zero, it's easiest to call a similar decorated function.
    if is_numpy(xp) and (xp_size(x) == 0
                         or (weights is not None and xp_size(weights) == 0)):
        return gmean(x, weights=weights, axis=axis, keepdims=keepdims)

    x, weights = xp_promote(x, weights, broadcast=True, force_floating=True, xp=xp)
    if weights is not None:
        x, weights = _share_masks(x, weights, xp=xp)

    # handle the special case of zero-sized arrays
    message = (too_small_1d_not_omit if (x.ndim == 1 or axis is None)
               else too_small_nd_not_omit)
    if xp_size(x) == 0:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            res = xp.mean(x, axis=axis, keepdims=keepdims)
        if xp_size(res) != 0:
            warnings.warn(message, SmallSampleWarning, stacklevel=2)
        return res

    contains_nan = _contains_nan(x, nan_policy, xp_omit_okay=True, xp=xp)
    if weights is not None:
        contains_nan_w = _contains_nan(weights, nan_policy, xp_omit_okay=True, xp=xp)
        contains_nan = contains_nan | contains_nan_w

    # Handle `nan_policy='omit'` by giving zero weight to NaNs, whether they
    # appear in `x` or `weights`. Emit warning if there is an all-NaN slice.
    # Test nan_policy before the implicit call to bool(contains_nan)
    # to avoid raising on lazy xps on the default nan_policy='propagate'
    lazy = is_lazy_array(x)
    if nan_policy == 'omit' and (lazy or contains_nan):
        nan_mask = xp.isnan(x)
        if weights is not None:
            nan_mask |= xp.isnan(weights)
        if not lazy and xp.any(xp.all(nan_mask, axis=axis)):
            message = (too_small_1d_omit if (x.ndim == 1 or axis is None)
                       else too_small_nd_omit)
            warnings.warn(message, SmallSampleWarning, stacklevel=2)
        weights = xp.ones_like(x) if weights is None else weights
        x = xp.where(nan_mask, 0., x)
        weights = xp.where(nan_mask, 0., weights)

    # Perform the mean calculation itself
    if weights is None:
        return xp.mean(x, axis=axis, keepdims=keepdims)

    # consider using `vecdot` if `axis` tuple support is added (data-apis/array-api#910)
    norm = xp.sum(weights, axis=axis)
    wsum = xp.sum(x * weights, axis=axis)
    with np.errstate(divide='ignore', invalid='ignore'):
        res = wsum/norm

    # Respect `keepdims` and convert NumPy 0-D arrays to scalars
    if keepdims:

        if axis is None:
            final_shape = (1,) * len(x.shape)
        else:
            # axis can be a scalar or sequence
            axes = (axis,) if not isinstance(axis, Sequence) else axis
            final_shape = list(x.shape)
            for i in axes:
                final_shape[i] = 1

        res = xp.reshape(res, tuple(final_shape))

    return res[()] if res.ndim == 0 else res


def _xp_var(x, /, *, axis=None, correction=0, keepdims=False, nan_policy='propagate',
            dtype=None, xp=None):
    # an array-api compatible function for variance with scipy.stats interface
    # and features (e.g. `nan_policy`).
    xp = array_namespace(x) if xp is None else xp
    x = _asarray(x, subok=True)

    # use `_xp_mean` instead of `xp.var` for desired warning behavior
    # it would be nice to combine this with `_var`, which uses `_moment`
    # and therefore warns when precision is lost, but that does not support
    # `axis` tuples or keepdims. Eventually, `_axis_nan_policy` will simplify
    # `axis` tuples and implement `keepdims` for non-NumPy arrays; then it will
    # be easy.
    kwargs = dict(axis=axis, nan_policy=nan_policy, dtype=dtype, xp=xp)
    mean = _xp_mean(x, keepdims=True, **kwargs)
    x = _asarray(x, dtype=mean.dtype, subok=True)
    x_mean = _demean(x, mean, axis, xp=xp)
    x_mean_conj = (xp.conj(x_mean) if xp.isdtype(x_mean.dtype, 'complex floating')
                   else x_mean)  # crossref data-apis/array-api#824
    var = _xp_mean(x_mean * x_mean_conj, keepdims=keepdims, **kwargs)

    if correction != 0:
        n = _length_nonmasked(x, axis, xp=xp)
        # Or two lines with ternaries : )
        # axis = range(x.ndim) if axis is None else axis
        # n = math.prod(x.shape[i] for i in axis) if iterable(axis) else x.shape[axis]

        n = xp.asarray(n, dtype=var.dtype)

        if nan_policy == 'omit':
            nan_mask = xp.astype(xp.isnan(x), var.dtype)
            n = n - xp.sum(nan_mask, axis=axis, keepdims=keepdims)

        # Produce NaNs silently when n - correction <= 0
        nc = n - correction
        factor = xpx.apply_where(nc > 0, (n, nc), operator.truediv, fill_value=xp.nan)
        var *= factor

    return var[()] if var.ndim == 0 else var


class _SimpleNormal:
    # A very simple, array-API compatible normal distribution for use in
    # hypothesis tests. May be replaced by new infrastructure Normal
    # distribution in due time.

    def cdf(self, x):
        return special.ndtr(x)

    def sf(self, x):
        return special.ndtr(-x)

    def isf(self, x):
        return -special.ndtri(x)


class _SimpleChi2:
    # A very simple, array-API compatible chi-squared distribution for use in
    # hypothesis tests. May be replaced by new infrastructure chi-squared
    # distribution in due time.
    def __init__(self, df):
        self.df = df

    def cdf(self, x):
        return special.chdtr(self.df, x)

    def sf(self, x):
        return special.chdtrc(self.df, x)


class _SimpleBeta:
    # A very simple, array-API compatible beta distribution for use in
    # hypothesis tests. May be replaced by new infrastructure beta
    # distribution in due time.
    def __init__(self, a, b, *, loc=None, scale=None):
        self.a = a
        self.b = b
        self.loc = loc
        self.scale = scale

    def cdf(self, x):
        if self.loc is not None or self.scale is not None:
            loc = 0 if self.loc is None else self.loc
            scale = 1 if self.scale is None else self.scale
            return special.betainc(self.a, self.b, (x - loc)/scale)
        return special.betainc(self.a, self.b, x)

    def sf(self, x):
        if self.loc is not None or self.scale is not None:
            loc = 0 if self.loc is None else self.loc
            scale = 1 if self.scale is None else self.scale
            return special.betaincc(self.a, self.b, (x - loc)/scale)
        return special.betaincc(self.a, self.b, x)


class _SimpleStudentT:
    # A very simple, array-API compatible t distribution for use in
    # hypothesis tests. May be replaced by new infrastructure t
    # distribution in due time.
    def __init__(self, df):
        self.df = df

    def cdf(self, t):
        return special.stdtr(self.df, t)

    def sf(self, t):
        return special.stdtr(self.df, -t)
