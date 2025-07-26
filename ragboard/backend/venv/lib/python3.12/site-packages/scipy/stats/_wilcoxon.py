import numpy as np

from scipy import stats
from ._stats_py import _get_pvalue, _rankdata, _SimpleNormal
from . import _morestats
from ._axis_nan_policy import _broadcast_arrays
from ._hypotests import _get_wilcoxon_distr
from scipy._lib._util import _get_nan
import scipy._lib.array_api_extra as xpx


class WilcoxonDistribution:

    def __init__(self, n):
        n = np.asarray(n).astype(int, copy=False)
        self.n = n
        self._dists = {ni: _get_wilcoxon_distr(ni) for ni in np.unique(n)}

    def _cdf1(self, k, n):
        pmfs = self._dists[n]
        return pmfs[:k + 1].sum()

    def _cdf(self, k, n):
        return np.vectorize(self._cdf1, otypes=[float])(k, n)

    def _sf1(self, k, n):
        pmfs = self._dists[n]
        return pmfs[k:].sum()

    def _sf(self, k, n):
        return np.vectorize(self._sf1, otypes=[float])(k, n)

    def mean(self):
        return self.n * (self.n + 1) / 4

    def _prep(self, k):
        k = np.asarray(k).astype(int, copy=False)
        mn = self.mean()
        out = np.empty(k.shape, dtype=np.float64)
        return k, mn, out

    def cdf(self, k):
        k, mn, out = self._prep(k)
        return xpx.apply_where(
            k <= mn, (k, self.n),
            self._cdf,
            lambda k, n: 1 - self._sf(k+1, n))[()]

    def sf(self, k):
        k, mn, out = self._prep(k)
        return xpx.apply_where(
            k <= mn, (k, self.n),
            self._sf,
            lambda k, n: 1 - self._cdf(k-1, n))[()]


def _wilcoxon_iv(x, y, zero_method, correction, alternative, method, axis):

    axis = np.asarray(axis)[()]
    message = "`axis` must be an integer."
    if not np.issubdtype(axis.dtype, np.integer) or axis.ndim != 0:
        raise ValueError(message)

    message = '`axis` must be compatible with the shape(s) of `x` (and `y`)'
    AxisError = getattr(np, 'AxisError', None) or np.exceptions.AxisError
    try:
        if y is None:
            x = np.asarray(x)
            d = x
        else:
            x, y = _broadcast_arrays((x, y), axis=axis)
            d = x - y
        d = np.moveaxis(d, axis, -1)
    except AxisError as e:
        raise AxisError(message) from e

    message = "`x` and `y` must have the same length along `axis`."
    if y is not None and x.shape[axis] != y.shape[axis]:
        raise ValueError(message)

    message = "`x` (and `y`, if provided) must be an array of real numbers."
    if np.issubdtype(d.dtype, np.integer):
        d = d.astype(np.float64)
    if not np.issubdtype(d.dtype, np.floating):
        raise ValueError(message)

    zero_method = str(zero_method).lower()
    zero_methods = {"wilcox", "pratt", "zsplit"}
    message = f"`zero_method` must be one of {zero_methods}."
    if zero_method not in zero_methods:
        raise ValueError(message)

    corrections = {True, False}
    message = f"`correction` must be one of {corrections}."
    if correction not in corrections:
        raise ValueError(message)

    alternative = str(alternative).lower()
    alternatives = {"two-sided", "less", "greater"}
    message = f"`alternative` must be one of {alternatives}."
    if alternative not in alternatives:
        raise ValueError(message)

    if not isinstance(method, stats.PermutationMethod):
        methods = {"auto", "asymptotic", "exact"}
        message = (f"`method` must be one of {methods} or "
                   "an instance of `stats.PermutationMethod`.")
        if method not in methods:
            raise ValueError(message)
    output_z = True if method == 'asymptotic' else False

    # For small samples, we decide later whether to perform an exact test or a
    # permutation test. The reason is that the presence of ties is not
    # known at the input validation stage.
    n_zero = np.sum(d == 0)
    if method == "auto" and d.shape[-1] > 50:
        method = "asymptotic"

    return d, zero_method, correction, alternative, method, axis, output_z, n_zero


def _wilcoxon_statistic(d, method, zero_method='wilcox'):

    i_zeros = (d == 0)

    if zero_method == 'wilcox':
        # Wilcoxon's method for treating zeros was to remove them from
        # the calculation. We do this by replacing 0s with NaNs, which
        # are ignored anyway.
        if not d.flags['WRITEABLE']:
            d = d.copy()
        d[i_zeros] = np.nan

    i_nan = np.isnan(d)
    n_nan = np.sum(i_nan, axis=-1)
    count = d.shape[-1] - n_nan

    r, t = _rankdata(abs(d), 'average', return_ties=True)

    r_plus = np.sum((d > 0) * r, axis=-1)
    r_minus = np.sum((d < 0) * r, axis=-1)

    has_ties = (t == 0).any()

    if zero_method == "zsplit":
        # The "zero-split" method for treating zeros is to add half their contribution
        # to r_plus and half to r_minus.
        # See gh-2263 for the origin of this method.
        r_zero_2 = np.sum(i_zeros * r, axis=-1) / 2
        r_plus += r_zero_2
        r_minus += r_zero_2

    mn = count * (count + 1.) * 0.25
    se = count * (count + 1.) * (2. * count + 1.)

    if zero_method == "pratt":
        # Pratt's method for treating zeros was just to modify the z-statistic.

        # normal approximation needs to be adjusted, see Cureton (1967)
        n_zero = i_zeros.sum(axis=-1)
        mn -= n_zero * (n_zero + 1.) * 0.25
        se -= n_zero * (n_zero + 1.) * (2. * n_zero + 1.)

        # zeros are not to be included in tie-correction.
        # any tie counts corresponding with zeros are in the 0th column
        t[i_zeros.any(axis=-1), 0] = 0

    tie_correct = (t**3 - t).sum(axis=-1)
    se -= tie_correct/2
    se = np.sqrt(se / 24)

    # se = 0 means that no non-zero values are left in d. we only need z
    # if method is asymptotic. however, if method="auto", the switch to
    # asymptotic might only happen after the statistic is calculated, so z
    # needs to be computed. in all other cases, avoid division by zero warning
    # (z is not needed anyways)
    if method in ["asymptotic", "auto"]:
        z = (r_plus - mn) / se
    else:
        z = np.nan

    return r_plus, r_minus, se, z, count, has_ties


def _correction_sign(z, alternative):
    if alternative == 'greater':
        return 1
    elif alternative == 'less':
        return -1
    else:
        return np.sign(z)


def _wilcoxon_nd(x, y=None, zero_method='wilcox', correction=True,
                 alternative='two-sided', method='auto', axis=0):

    temp = _wilcoxon_iv(x, y, zero_method, correction, alternative, method, axis)
    d, zero_method, correction, alternative, method, axis, output_z, n_zero = temp

    if d.size == 0:
        NaN = _get_nan(d)
        res = _morestats.WilcoxonResult(statistic=NaN, pvalue=NaN)
        if method == 'asymptotic':
            res.zstatistic = NaN
        return res

    r_plus, r_minus, se, z, count, has_ties = _wilcoxon_statistic(
        d, method, zero_method
    )

    # we only know if there are ties after computing the statistic and not
    # at the input validation stage. if the original method was auto and
    # the decision was to use an exact test, we override this to
    # a permutation test now (since method='exact' is not exact in the
    # presence of ties)
    if method == "auto":
        if not (has_ties or n_zero > 0):
            method = "exact"
        elif d.shape[-1] <= 13:
            # the possible outcomes to be simulated by the permutation test
            # are 2**n, where n is the sample size.
            # if n <= 13, the p-value is deterministic since 2**13 is less
            # than 9999, the default number of n_resamples
            method = stats.PermutationMethod()
        else:
            # if there are ties and the sample size is too large to
            # run a deterministic permutation test, fall back to asymptotic
            method = "asymptotic"

    if method == 'asymptotic':
        if correction:
            sign = _correction_sign(z, alternative)
            z -= sign * 0.5 / se
        p = _get_pvalue(z, _SimpleNormal(), alternative, xp=np)
    elif method == 'exact':
        dist = WilcoxonDistribution(count)
        # The null distribution in `dist` is exact only if there are no ties
        # or zeros. If there are ties or zeros, the statistic can be non-
        # integral, but the null distribution is only defined for integral
        # values of the statistic. Therefore, we're conservative: round
        # non-integral statistic up before computing CDF and down before
        # computing SF. This preserves symmetry w.r.t. alternatives and
        # order of the input arguments. See gh-19872.
        if alternative == 'less':
            p = dist.cdf(np.ceil(r_plus))
        elif alternative == 'greater':
            p = dist.sf(np.floor(r_plus))
        else:
            p = 2 * np.minimum(dist.sf(np.floor(r_plus)),
                               dist.cdf(np.ceil(r_plus)))
            p = np.clip(p, 0, 1)
    else:  # `PermutationMethod` instance (already validated)
        p = stats.permutation_test(
            (d,), lambda d: _wilcoxon_statistic(d, method, zero_method)[0],
            permutation_type='samples', **method._asdict(),
            alternative=alternative, axis=-1).pvalue

    # for backward compatibility...
    statistic = np.minimum(r_plus, r_minus) if alternative=='two-sided' else r_plus
    z = -np.abs(z) if (alternative == 'two-sided' and method == 'asymptotic') else z

    res = _morestats.WilcoxonResult(statistic=statistic, pvalue=p[()])
    if output_z:
        res.zstatistic = z[()]
    return res
