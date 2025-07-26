import warnings
import numpy as np

from scipy._lib._util import check_random_state, MapWrapper, rng_integers, _contains_nan
from scipy._lib._bunch import _make_tuple_bunch
from scipy.spatial.distance import cdist
from scipy.ndimage import _measurements

from ._stats import _local_correlations  # type: ignore[import-not-found]
from . import distributions

__all__ = ['multiscale_graphcorr']

# FROM MGCPY: https://github.com/neurodata/mgcpy


class _ParallelP:
    """Helper function to calculate parallel p-value."""

    def __init__(self, x, y, random_states):
        self.x = x
        self.y = y
        self.random_states = random_states

    def __call__(self, index):
        order = self.random_states[index].permutation(self.y.shape[0])
        permy = self.y[order][:, order]

        # calculate permuted stats, store in null distribution
        perm_stat = _mgc_stat(self.x, permy)[0]

        return perm_stat


def _perm_test(x, y, stat, reps=1000, workers=-1, random_state=None):
    r"""Helper function that calculates the p-value. See below for uses.

    Parameters
    ----------
    x, y : ndarray
        `x` and `y` have shapes ``(n, p)`` and ``(n, q)``.
    stat : float
        The sample test statistic.
    reps : int, optional
        The number of replications used to estimate the null when using the
        permutation test. The default is 1000 replications.
    workers : int or map-like callable, optional
        If `workers` is an int the population is subdivided into `workers`
        sections and evaluated in parallel (uses
        `multiprocessing.Pool <multiprocessing>`). Supply `-1` to use all cores
        available to the Process. Alternatively supply a map-like callable,
        such as `multiprocessing.Pool.map` for evaluating the population in
        parallel. This evaluation is carried out as `workers(func, iterable)`.
        Requires that `func` be pickleable.
    random_state : {None, int, `numpy.random.Generator`,
                    `numpy.random.RandomState`}, optional

        If `seed` is None (or `np.random`), the `numpy.random.RandomState`
        singleton is used.
        If `seed` is an int, a new ``RandomState`` instance is used,
        seeded with `seed`.
        If `seed` is already a ``Generator`` or ``RandomState`` instance then
        that instance is used.

    Returns
    -------
    pvalue : float
        The sample test p-value.
    null_dist : list
        The approximated null distribution.

    """
    # generate seeds for each rep (change to new parallel random number
    # capabilities in numpy >= 1.17+)
    random_state = check_random_state(random_state)
    random_states = [np.random.RandomState(rng_integers(random_state, 1 << 32,
                     size=4, dtype=np.uint32)) for _ in range(reps)]

    # parallelizes with specified workers over number of reps and set seeds
    parallelp = _ParallelP(x=x, y=y, random_states=random_states)
    with MapWrapper(workers) as mapwrapper:
        null_dist = np.array(list(mapwrapper(parallelp, range(reps))))

    # calculate p-value and significant permutation map through list
    pvalue = (1 + (null_dist >= stat).sum()) / (1 + reps)

    return pvalue, null_dist


def _euclidean_dist(x):
    return cdist(x, x)


MGCResult = _make_tuple_bunch('MGCResult',
                              ['statistic', 'pvalue', 'mgc_dict'], [])


def multiscale_graphcorr(x, y, compute_distance=_euclidean_dist, reps=1000,
                         workers=1, is_twosamp=False, random_state=None):
    r"""Computes the Multiscale Graph Correlation (MGC) test statistic.

    Specifically, for each point, MGC finds the :math:`k`-nearest neighbors for
    one property (e.g. cloud density), and the :math:`l`-nearest neighbors for
    the other property (e.g. grass wetness) [1]_. This pair :math:`(k, l)` is
    called the "scale". A priori, however, it is not know which scales will be
    most informative. So, MGC computes all distance pairs, and then efficiently
    computes the distance correlations for all scales. The local correlations
    illustrate which scales are relatively informative about the relationship.
    The key, therefore, to successfully discover and decipher relationships
    between disparate data modalities is to adaptively determine which scales
    are the most informative, and the geometric implication for the most
    informative scales. Doing so not only provides an estimate of whether the
    modalities are related, but also provides insight into how the
    determination was made. This is especially important in high-dimensional
    data, where simple visualizations do not reveal relationships to the
    unaided human eye. Characterizations of this implementation in particular
    have been derived from and benchmarked within in [2]_.

    Parameters
    ----------
    x, y : ndarray
        If ``x`` and ``y`` have shapes ``(n, p)`` and ``(n, q)`` where `n` is
        the number of samples and `p` and `q` are the number of dimensions,
        then the MGC independence test will be run.  Alternatively, ``x`` and
        ``y`` can have shapes ``(n, n)`` if they are distance or similarity
        matrices, and ``compute_distance`` must be sent to ``None``. If ``x``
        and ``y`` have shapes ``(n, p)`` and ``(m, p)``, an unpaired
        two-sample MGC test will be run.
    compute_distance : callable, optional
        A function that computes the distance or similarity among the samples
        within each data matrix. Set to ``None`` if ``x`` and ``y`` are
        already distance matrices. The default uses the euclidean norm metric.
        If you are calling a custom function, either create the distance
        matrix before-hand or create a function of the form
        ``compute_distance(x)`` where `x` is the data matrix for which
        pairwise distances are calculated.
    reps : int, optional
        The number of replications used to estimate the null when using the
        permutation test. The default is ``1000``.
    workers : int or map-like callable, optional
        If ``workers`` is an int the population is subdivided into ``workers``
        sections and evaluated in parallel (uses ``multiprocessing.Pool
        <multiprocessing>``). Supply ``-1`` to use all cores available to the
        Process. Alternatively supply a map-like callable, such as
        ``multiprocessing.Pool.map`` for evaluating the p-value in parallel.
        This evaluation is carried out as ``workers(func, iterable)``.
        Requires that `func` be pickleable. The default is ``1``.
    is_twosamp : bool, optional
        If `True`, a two sample test will be run. If ``x`` and ``y`` have
        shapes ``(n, p)`` and ``(m, p)``, this optional will be overridden and
        set to ``True``. Set to ``True`` if ``x`` and ``y`` both have shapes
        ``(n, p)`` and a two sample test is desired. The default is ``False``.
        Note that this will not run if inputs are distance matrices.
    random_state : {None, int, `numpy.random.Generator`,
                    `numpy.random.RandomState`}, optional

        If `seed` is None (or `np.random`), the `numpy.random.RandomState`
        singleton is used.
        If `seed` is an int, a new ``RandomState`` instance is used,
        seeded with `seed`.
        If `seed` is already a ``Generator`` or ``RandomState`` instance then
        that instance is used.

    Returns
    -------
    res : MGCResult
        An object containing attributes:

        statistic : float
            The sample MGC test statistic within ``[-1, 1]``.
        pvalue : float
            The p-value obtained via permutation.
        mgc_dict : dict
            Contains additional useful results:

                - mgc_map : ndarray
                    A 2D representation of the latent geometry of the
                    relationship.
                - opt_scale : (int, int)
                    The estimated optimal scale as a ``(x, y)`` pair.
                - null_dist : list
                    The null distribution derived from the permuted matrices.

    See Also
    --------
    pearsonr : Pearson correlation coefficient and p-value for testing
               non-correlation.
    kendalltau : Calculates Kendall's tau.
    spearmanr : Calculates a Spearman rank-order correlation coefficient.

    Notes
    -----
    A description of the process of MGC and applications on neuroscience data
    can be found in [1]_. It is performed using the following steps:

    #. Two distance matrices :math:`D^X` and :math:`D^Y` are computed and
       modified to be mean zero columnwise. This results in two
       :math:`n \times n` distance matrices :math:`A` and :math:`B` (the
       centering and unbiased modification) [3]_.

    #. For all values :math:`k` and :math:`l` from :math:`1, ..., n`,

       * The :math:`k`-nearest neighbor and :math:`l`-nearest neighbor graphs
         are calculated for each property. Here, :math:`G_k (i, j)` indicates
         the :math:`k`-smallest values of the :math:`i`-th row of :math:`A`
         and :math:`H_l (i, j)` indicates the :math:`l` smallested values of
         the :math:`i`-th row of :math:`B`

       * Let :math:`\circ` denotes the entry-wise matrix product, then local
         correlations are summed and normalized using the following statistic:

    .. math::

        c^{kl} = \frac{\sum_{ij} A G_k B H_l}
                      {\sqrt{\sum_{ij} A^2 G_k \times \sum_{ij} B^2 H_l}}

    #. The MGC test statistic is the smoothed optimal local correlation of
       :math:`\{ c^{kl} \}`. Denote the smoothing operation as :math:`R(\cdot)`
       (which essentially set all isolated large correlations) as 0 and
       connected large correlations the same as before, see [3]_.) MGC is,

    .. math::

        MGC_n (x, y) = \max_{(k, l)} R \left(c^{kl} \left( x_n, y_n \right)
                                                    \right)

    The test statistic returns a value between :math:`(-1, 1)` since it is
    normalized.

    The p-value returned is calculated using a permutation test. This process
    is completed by first randomly permuting :math:`y` to estimate the null
    distribution and then calculating the probability of observing a test
    statistic, under the null, at least as extreme as the observed test
    statistic.

    MGC requires at least 5 samples to run with reliable results. It can also
    handle high-dimensional data sets.
    In addition, by manipulating the input data matrices, the two-sample
    testing problem can be reduced to the independence testing problem [4]_.
    Given sample data :math:`U` and :math:`V` of sizes :math:`p \times n`
    :math:`p \times m`, data matrix :math:`X` and :math:`Y` can be created as
    follows:

    .. math::

        X = [U | V] \in \mathcal{R}^{p \times (n + m)}
        Y = [0_{1 \times n} | 1_{1 \times m}] \in \mathcal{R}^{(n + m)}

    Then, the MGC statistic can be calculated as normal. This methodology can
    be extended to similar tests such as distance correlation [4]_.

    .. versionadded:: 1.4.0

    References
    ----------
    .. [1] Vogelstein, J. T., Bridgeford, E. W., Wang, Q., Priebe, C. E.,
           Maggioni, M., & Shen, C. (2019). Discovering and deciphering
           relationships across disparate data modalities. ELife.
    .. [2] Panda, S., Palaniappan, S., Xiong, J., Swaminathan, A.,
           Ramachandran, S., Bridgeford, E. W., ... Vogelstein, J. T. (2019).
           mgcpy: A Comprehensive High Dimensional Independence Testing Python
           Package. :arXiv:`1907.02088`
    .. [3] Shen, C., Priebe, C.E., & Vogelstein, J. T. (2019). From distance
           correlation to multiscale graph correlation. Journal of the American
           Statistical Association.
    .. [4] Shen, C. & Vogelstein, J. T. (2018). The Exact Equivalence of
           Distance and Kernel Methods for Hypothesis Testing.
           :arXiv:`1806.05514`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.stats import multiscale_graphcorr
    >>> x = np.arange(100)
    >>> y = x
    >>> res = multiscale_graphcorr(x, y)
    >>> res.statistic, res.pvalue
    (1.0, 0.001)

    To run an unpaired two-sample test,

    >>> x = np.arange(100)
    >>> y = np.arange(79)
    >>> res = multiscale_graphcorr(x, y)
    >>> res.statistic, res.pvalue  # doctest: +SKIP
    (0.033258146255703246, 0.023)

    or, if shape of the inputs are the same,

    >>> x = np.arange(100)
    >>> y = x
    >>> res = multiscale_graphcorr(x, y, is_twosamp=True)
    >>> res.statistic, res.pvalue  # doctest: +SKIP
    (-0.008021809890200488, 1.0)

    """
    if not isinstance(x, np.ndarray) or not isinstance(y, np.ndarray):
        raise ValueError("x and y must be ndarrays")

    # convert arrays of type (n,) to (n, 1)
    if x.ndim == 1:
        x = x[:, np.newaxis]
    elif x.ndim != 2:
        raise ValueError(f"Expected a 2-D array `x`, found shape {x.shape}")
    if y.ndim == 1:
        y = y[:, np.newaxis]
    elif y.ndim != 2:
        raise ValueError(f"Expected a 2-D array `y`, found shape {y.shape}")

    nx, px = x.shape
    ny, py = y.shape

    # check for NaNs
    _contains_nan(x, nan_policy='raise')
    _contains_nan(y, nan_policy='raise')

    # check for positive or negative infinity and raise error
    if np.sum(np.isinf(x)) > 0 or np.sum(np.isinf(y)) > 0:
        raise ValueError("Inputs contain infinities")

    if nx != ny:
        if px == py:
            # reshape x and y for two sample testing
            is_twosamp = True
        else:
            raise ValueError("Shape mismatch, x and y must have shape [n, p] "
                             "and [n, q] or have shape [n, p] and [m, p].")

    if nx < 5 or ny < 5:
        raise ValueError("MGC requires at least 5 samples to give reasonable "
                         "results.")

    # convert x and y to float
    x = x.astype(np.float64)
    y = y.astype(np.float64)

    # check if compute_distance_matrix if a callable()
    if not callable(compute_distance) and compute_distance is not None:
        raise ValueError("Compute_distance must be a function.")

    # check if number of reps exists, integer, or > 0 (if under 1000 raises
    # warning)
    if not isinstance(reps, int) or reps < 0:
        raise ValueError("Number of reps must be an integer greater than 0.")
    elif reps < 1000:
        msg = ("The number of replications is low (under 1000), and p-value "
               "calculations may be unreliable. Use the p-value result, with "
               "caution!")
        warnings.warn(msg, RuntimeWarning, stacklevel=2)

    if is_twosamp:
        if compute_distance is None:
            raise ValueError("Cannot run if inputs are distance matrices")
        x, y = _two_sample_transform(x, y)

    if compute_distance is not None:
        # compute distance matrices for x and y
        x = compute_distance(x)
        y = compute_distance(y)

    # calculate MGC stat
    stat, stat_dict = _mgc_stat(x, y)
    stat_mgc_map = stat_dict["stat_mgc_map"]
    opt_scale = stat_dict["opt_scale"]

    # calculate permutation MGC p-value
    pvalue, null_dist = _perm_test(x, y, stat, reps=reps, workers=workers,
                                   random_state=random_state)

    # save all stats (other than stat/p-value) in dictionary
    mgc_dict = {"mgc_map": stat_mgc_map,
                "opt_scale": opt_scale,
                "null_dist": null_dist}

    # create result object with alias for backward compatibility
    res = MGCResult(stat, pvalue, mgc_dict)
    res.stat = stat
    return res


def _mgc_stat(distx, disty):
    r"""Helper function that calculates the MGC stat. See above for use.

    Parameters
    ----------
    distx, disty : ndarray
        `distx` and `disty` have shapes ``(n, p)`` and ``(n, q)`` or
        ``(n, n)`` and ``(n, n)``
        if distance matrices.

    Returns
    -------
    stat : float
        The sample MGC test statistic within ``[-1, 1]``.
    stat_dict : dict
        Contains additional useful additional returns containing the following
        keys:

            - stat_mgc_map : ndarray
                MGC-map of the statistics.
            - opt_scale : (float, float)
                The estimated optimal scale as a ``(x, y)`` pair.

    """
    # calculate MGC map and optimal scale
    stat_mgc_map = _local_correlations(distx, disty, global_corr='mgc')

    n, m = stat_mgc_map.shape
    if m == 1 or n == 1:
        # the global scale at is the statistic calculated at maximal nearest
        # neighbors. There is not enough local scale to search over, so
        # default to global scale
        stat = stat_mgc_map[m - 1][n - 1]
        opt_scale = m * n
    else:
        samp_size = len(distx) - 1

        # threshold to find connected region of significant local correlations
        sig_connect = _threshold_mgc_map(stat_mgc_map, samp_size)

        # maximum within the significant region
        stat, opt_scale = _smooth_mgc_map(sig_connect, stat_mgc_map)

    stat_dict = {"stat_mgc_map": stat_mgc_map,
                 "opt_scale": opt_scale}

    return stat, stat_dict


def _threshold_mgc_map(stat_mgc_map, samp_size):
    r"""
    Finds a connected region of significance in the MGC-map by thresholding.

    Parameters
    ----------
    stat_mgc_map : ndarray
        All local correlations within ``[-1,1]``.
    samp_size : int
        The sample size of original data.

    Returns
    -------
    sig_connect : ndarray
        A binary matrix with 1's indicating the significant region.

    """
    m, n = stat_mgc_map.shape

    # 0.02 is simply an empirical threshold, this can be set to 0.01 or 0.05
    # with varying levels of performance. Threshold is based on a beta
    # approximation.
    per_sig = 1 - (0.02 / samp_size)  # Percentile to consider as significant
    threshold = samp_size * (samp_size - 3)/4 - 1/2  # Beta approximation
    threshold = distributions.beta.ppf(per_sig, threshold, threshold) * 2 - 1

    # the global scale at is the statistic calculated at maximal nearest
    # neighbors. Threshold is the maximum on the global and local scales
    threshold = max(threshold, stat_mgc_map[m - 1][n - 1])

    # find the largest connected component of significant correlations
    sig_connect = stat_mgc_map > threshold
    if np.sum(sig_connect) > 0:
        sig_connect, _ = _measurements.label(sig_connect)
        _, label_counts = np.unique(sig_connect, return_counts=True)

        # skip the first element in label_counts, as it is count(zeros)
        max_label = np.argmax(label_counts[1:]) + 1
        sig_connect = sig_connect == max_label
    else:
        sig_connect = np.array([[False]])

    return sig_connect


def _smooth_mgc_map(sig_connect, stat_mgc_map):
    """Finds the smoothed maximal within the significant region R.

    If area of R is too small it returns the last local correlation. Otherwise,
    returns the maximum within significant_connected_region.

    Parameters
    ----------
    sig_connect : ndarray
        A binary matrix with 1's indicating the significant region.
    stat_mgc_map : ndarray
        All local correlations within ``[-1, 1]``.

    Returns
    -------
    stat : float
        The sample MGC statistic within ``[-1, 1]``.
    opt_scale: (float, float)
        The estimated optimal scale as an ``(x, y)`` pair.

    """
    m, n = stat_mgc_map.shape

    # the global scale at is the statistic calculated at maximal nearest
    # neighbors. By default, statistic and optimal scale are global.
    stat = stat_mgc_map[m - 1][n - 1]
    opt_scale = [m, n]

    if np.linalg.norm(sig_connect) != 0:
        # proceed only when the connected region's area is sufficiently large
        # 0.02 is simply an empirical threshold, this can be set to 0.01 or 0.05
        # with varying levels of performance
        if np.sum(sig_connect) >= np.ceil(0.02 * max(m, n)) * min(m, n):
            max_corr = max(stat_mgc_map[sig_connect])

            # find all scales within significant_connected_region that maximize
            # the local correlation
            max_corr_index = np.where((stat_mgc_map >= max_corr) & sig_connect)

            if max_corr >= stat:
                stat = max_corr

                k, l = max_corr_index
                one_d_indices = k * n + l  # 2D to 1D indexing
                k = np.max(one_d_indices) // n
                l = np.max(one_d_indices) % n
                opt_scale = [k+1, l+1]  # adding 1s to match R indexing

    return stat, opt_scale


def _two_sample_transform(u, v):
    """Helper function that concatenates x and y for two sample MGC stat.

    See above for use.

    Parameters
    ----------
    u, v : ndarray
        `u` and `v` have shapes ``(n, p)`` and ``(m, p)``.

    Returns
    -------
    x : ndarray
        Concatenate `u` and `v` along the ``axis = 0``. `x` thus has shape
        ``(2n, p)``.
    y : ndarray
        Label matrix for `x` where 0 refers to samples that comes from `u` and
        1 refers to samples that come from `v`. `y` thus has shape ``(2n, 1)``.

    """
    nx = u.shape[0]
    ny = v.shape[0]
    x = np.concatenate([u, v], axis=0)
    y = np.concatenate([np.zeros(nx), np.ones(ny)], axis=0).reshape(-1, 1)
    return x, y
