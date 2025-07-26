import numpy as np
from scipy import stats
from scipy.stats._stats_py import _SimpleNormal, SignificanceResult, _get_pvalue
from scipy.stats._axis_nan_policy import _axis_nan_policy_factory


__all__ = ['chatterjeexi']


# TODO:
# - Adjust to respect dtype


def _xi_statistic(x, y, y_continuous):
    # Compute xi correlation statistic

    # `axis=-1` is guaranteed by _axis_nan_policy decorator
    n = x.shape[-1]

    # "Rearrange the data as (X(1), Y(1)), . . . ,(X(n), Y(n))
    # such that X(1) ≤ ··· ≤ X(n)"
    j = np.argsort(x, axis=-1)
    j, y = np.broadcast_arrays(j, y)
    y = np.take_along_axis(y, j, axis=-1)

    # "Let ri be the rank of Y(i), that is, the number of j such that Y(j) ≤ Y(i)"
    r = stats.rankdata(y, method='max', axis=-1)
    # " additionally define li to be the number of j such that Y(j) ≥ Y(i)"
    # Could probably compute this from r, but that can be an enhancement
    l = stats.rankdata(-y, method='max', axis=-1)

    num = np.sum(np.abs(np.diff(r, axis=-1)), axis=-1)
    if y_continuous:  # [1] Eq. 1.1
        statistic = 1 - 3 * num / (n ** 2 - 1)
    else:  # [1] Eq. 1.2
        den = 2 * np.sum((n - l) * l, axis=-1)
        statistic = 1 - n * num / den

    return statistic, r, l


def _xi_std(r, l, y_continuous):
    # Compute asymptotic standard deviation of xi under null hypothesis of independence

    # `axis=-1` is guaranteed by _axis_nan_policy decorator
    n = np.float64(r.shape[-1])

    # "Suppose that X and Y are independent and Y is continuous. Then
    # √n·ξn(X, Y) → N(0, 2/5) in distribution as n → ∞"
    if y_continuous:  # [1] Theorem 2.1
        return np.sqrt(2 / 5) / np.sqrt(n)

    # "Suppose that X and Y are independent. Then √n·ξn(X, Y)
    # converges to N(0, τ²) in distribution as n → ∞
    # [1] Eq. 2.2 and surrounding math
    i = np.arange(1, n + 1)
    u = np.sort(r, axis=-1)
    v = np.cumsum(u, axis=-1)
    an = 1 / n**4 * np.sum((2*n - 2*i + 1) * u**2, axis=-1)
    bn = 1 / n**5 * np.sum((v + (n - i)*u)**2, axis=-1)
    cn = 1 / n**3 * np.sum((2*n - 2*i + 1) * u, axis=-1)
    dn = 1 / n**3 * np.sum((l * (n - l)), axis=-1)
    tau2 = (an - 2*bn + cn**2) / dn**2

    return np.sqrt(tau2) / np.sqrt(n)


def _chatterjeexi_iv(y_continuous, method):
    # Input validation for `chatterjeexi`
    # x, y, `axis` input validation taken care of by decorator

    if y_continuous not in {True, False}:
        raise ValueError('`y_continuous` must be boolean.')

    if not isinstance(method, stats.PermutationMethod):
        method = method.lower()
        message = "`method` must be 'asymptotic' or a `PermutationMethod` instance."
        if method != 'asymptotic':
            raise ValueError(message)

    return y_continuous, method


def _unpack(res, _):
    return res.statistic, res.pvalue


@_axis_nan_policy_factory(SignificanceResult, paired=True, n_samples=2,
                          result_to_tuple=_unpack, n_outputs=2, too_small=1)
def chatterjeexi(x, y, *, axis=0, y_continuous=False, method='asymptotic'):
    r"""Compute the xi correlation and perform a test of independence

    The xi correlation coefficient is a measure of association between two
    variables; the value tends to be close to zero when the variables are
    independent and close to 1 when there is a strong association. Unlike
    other correlation coefficients, the xi correlation is effective even
    when the association is not monotonic.

    Parameters
    ----------
    x, y : array-like
        The samples: corresponding observations of the independent and
        dependent variable. The (N-d) arrays must be broadcastable.
    axis : int, default: 0
        Axis along which to perform the test.
    method : 'asymptotic' or `PermutationMethod` instance, optional
        Selects the method used to calculate the *p*-value.
        Default is 'asymptotic'. The following options are available.

        * ``'asymptotic'``: compares the standardized test statistic
          against the normal distribution.
        * `PermutationMethod` instance. In this case, the p-value
          is computed using `permutation_test` with the provided
          configuration options and other appropriate settings.

    y_continuous : bool, default: False
        Whether `y` is assumed to be drawn from a continuous distribution.
        If `y` is drawn from a continuous distribution, results are valid
        whether this is assumed or not, but enabling this assumption will
        result in faster computation and typically produce similar results.

    Returns
    -------
    res : SignificanceResult
        An object containing attributes:

        statistic : float
            The xi correlation statistic.
        pvalue : float
            The associated *p*-value: the probability of a statistic at least as
            high as the observed value under the null hypothesis of independence.

    See Also
    --------
    scipy.stats.pearsonr, scipy.stats.spearmanr, scipy.stats.kendalltau

    Notes
    -----
    There is currently no special handling of ties in `x`; they are broken arbitrarily
    by the implementation.

    [1]_ notes that the statistic is not symmetric in `x` and `y` *by design*:
    "...we may want to understand if :math:`Y` is a function :math:`X`, and not just
    if one of the variables is a function of the other." See [1]_ Remark 1.

    References
    ----------
    .. [1] Chatterjee, Sourav. "A new coefficient of correlation." Journal of
           the American Statistical Association 116.536 (2021): 2009-2022.
           :doi:`10.1080/01621459.2020.1758115`.

    Examples
    --------
    Generate perfectly correlated data, and observe that the xi correlation is
    nearly 1.0.

    >>> import numpy as np
    >>> from scipy import stats
    >>> rng = np.random.default_rng(348932549825235)
    >>> x = rng.uniform(0, 10, size=100)
    >>> y = np.sin(x)
    >>> res = stats.chatterjeexi(x, y)
    >>> res.statistic
    np.float64(0.9012901290129013)

    The probability of observing such a high value of the statistic under the
    null hypothesis of independence is very low.

    >>> res.pvalue
    np.float64(2.2206974648177804e-46)

    As noise is introduced, the correlation coefficient decreases.

    >>> noise = rng.normal(scale=[[0.1], [0.5], [1]], size=(3, 100))
    >>> res = stats.chatterjeexi(x, y + noise, axis=-1)
    >>> res.statistic
    array([0.79507951, 0.41824182, 0.16651665])

    Because the distribution of `y` is continuous, it is valid to pass
    ``y_continuous=True``. The statistic is identical, and the p-value
    (not shown) is only slightly different.

    >>> stats.chatterjeexi(x, y + noise, y_continuous=True, axis=-1).statistic
    array([0.79507951, 0.41824182, 0.16651665])

    """
    # x, y, `axis` input validation taken care of by decorator
    # In fact, `axis` is guaranteed to be -1
    y_continuous, method = _chatterjeexi_iv(y_continuous, method)

    # A highly negative statistic is possible, e.g.
    # x = np.arange(100.), y = (x % 2 == 0)
    # Unclear whether we should expose `alternative`, though.
    alternative = 'greater'

    if method == 'asymptotic':
        xi, r, l = _xi_statistic(x, y, y_continuous)
        std = _xi_std(r, l, y_continuous)
        norm = _SimpleNormal()
        pvalue = _get_pvalue(xi / std, norm, alternative=alternative)
    elif isinstance(method, stats.PermutationMethod):
        res = stats.permutation_test(
            # Could be faster if we just permuted the ranks; for now, keep it simple.
            data=(y,), statistic=lambda y, axis: _xi_statistic(x, y, y_continuous)[0],
            alternative=alternative, permutation_type='pairings', **method._asdict(),
            axis=-1)  # `axis=-1` is guaranteed by _axis_nan_policy decorator

        xi, pvalue = res.statistic, res.pvalue

    return SignificanceResult(xi, pvalue)
