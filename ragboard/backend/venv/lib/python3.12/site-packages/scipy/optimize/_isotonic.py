from typing import TYPE_CHECKING

import numpy as np

from ._optimize import OptimizeResult
from ._pava_pybind import pava

if TYPE_CHECKING:
    import numpy.typing as npt


__all__ = ["isotonic_regression"]


def isotonic_regression(
    y: "npt.ArrayLike",
    *,
    weights: "npt.ArrayLike | None" = None,
    increasing: bool = True,
) -> OptimizeResult:
    r"""Nonparametric isotonic regression.

    A (not strictly) monotonically increasing array `x` with the same length
    as `y` is calculated by the pool adjacent violators algorithm (PAVA), see
    [1]_. See the Notes section for more details.

    Parameters
    ----------
    y : (N,) array_like
        Response variable.
    weights : (N,) array_like or None
        Case weights.
    increasing : bool
        If True, fit monotonic increasing, i.e. isotonic, regression.
        If False, fit a monotonic decreasing, i.e. antitonic, regression.
        Default is True.

    Returns
    -------
    res : OptimizeResult
        The optimization result represented as a ``OptimizeResult`` object.
        Important attributes are:

        - ``x``: The isotonic regression solution, i.e. an increasing (or
          decreasing) array of the same length than y, with elements in the
          range from min(y) to max(y).
        - ``weights`` : Array with the sum of case weights for each block
          (or pool) B.
        - ``blocks``: Array of length B+1 with the indices of the start
          positions of each block (or pool) B. The j-th block is given by
          ``x[blocks[j]:blocks[j+1]]`` for which all values are the same.

    Notes
    -----
    Given data :math:`y` and case weights :math:`w`, the isotonic regression
    solves the following optimization problem:

    .. math::

        \operatorname{argmin}_{x_i} \sum_i w_i (y_i - x_i)^2 \quad
        \text{subject to } x_i \leq x_j \text{ whenever } i \leq j \,.

    For every input value :math:`y_i`, it generates a value :math:`x_i` such
    that :math:`x` is increasing (but not strictly), i.e.
    :math:`x_i \leq x_{i+1}`. This is accomplished by the PAVA.
    The solution consists of pools or blocks, i.e. neighboring elements of
    :math:`x`, e.g. :math:`x_i` and :math:`x_{i+1}`, that all have the same
    value.

    Most interestingly, the solution stays the same if the squared loss is
    replaced by the wide class of Bregman functions which are the unique
    class of strictly consistent scoring functions for the mean, see [2]_
    and references therein.

    The implemented version of PAVA according to [1]_ has a computational
    complexity of O(N) with input size N.

    References
    ----------
    .. [1] Busing, F. M. T. A. (2022).
           Monotone Regression: A Simple and Fast O(n) PAVA Implementation.
           Journal of Statistical Software, Code Snippets, 102(1), 1-25.
           :doi:`10.18637/jss.v102.c01`
    .. [2] Jordan, A.I., Mühlemann, A. & Ziegel, J.F.
           Characterizing the optimal solutions to the isotonic regression
           problem for identifiable functionals.
           Ann Inst Stat Math 74, 489-514 (2022).
           :doi:`10.1007/s10463-021-00808-0`

    Examples
    --------
    This example demonstrates that ``isotonic_regression`` really solves a
    constrained optimization problem.

    >>> import numpy as np
    >>> from scipy.optimize import isotonic_regression, minimize
    >>> y = [1.5, 1.0, 4.0, 6.0, 5.7, 5.0, 7.8, 9.0, 7.5, 9.5, 9.0]
    >>> def objective(yhat, y):
    ...     return np.sum((yhat - y)**2)
    >>> def constraint(yhat, y):
    ...     # This is for a monotonically increasing regression.
    ...     return np.diff(yhat)
    >>> result = minimize(objective, x0=y, args=(y,),
    ...                   constraints=[{'type': 'ineq',
    ...                                 'fun': lambda x: constraint(x, y)}])
    >>> result.x
    array([1.25      , 1.25      , 4.        , 5.56666667, 5.56666667,
           5.56666667, 7.8       , 8.25      , 8.25      , 9.25      ,
           9.25      ])
    >>> result = isotonic_regression(y)
    >>> result.x
    array([1.25      , 1.25      , 4.        , 5.56666667, 5.56666667,
           5.56666667, 7.8       , 8.25      , 8.25      , 9.25      ,
           9.25      ])

    The big advantage of ``isotonic_regression`` compared to calling
    ``minimize`` is that it is more user friendly, i.e. one does not need to
    define objective and constraint functions, and that it is orders of
    magnitudes faster. On commodity hardware (in 2023), for normal distributed
    input y of length 1000, the minimizer takes about 4 seconds, while
    ``isotonic_regression`` takes about 200 microseconds.
    """
    yarr = np.atleast_1d(y)  # Check yarr.ndim == 1 is implicit (pybind11) in pava.
    order = slice(None) if increasing else slice(None, None, -1)
    x = np.array(yarr[order], order="C", dtype=np.float64, copy=True)
    if weights is None:
        wx = np.ones_like(yarr, dtype=np.float64)
    else:
        warr = np.atleast_1d(weights)

        if not (yarr.ndim == warr.ndim == 1 and yarr.shape[0] == warr.shape[0]):
            raise ValueError(
                "Input arrays y and w must have one dimension of equal length."
            )
        if np.any(warr <= 0):
            raise ValueError("Weights w must be strictly positive.")

        wx = np.array(warr[order], order="C", dtype=np.float64, copy=True)
    n = x.shape[0]
    r = np.full(shape=n + 1, fill_value=-1, dtype=np.intp)
    x, wx, r, b = pava(x, wx, r)
    # Now that we know the number of blocks b, we only keep the relevant part
    # of r and wx.
    # As information: Due to the pava implementation, after the last block
    # index, there might be smaller numbers appended to r, e.g.
    # r = [0, 10, 8, 7] which in the end should be r = [0, 10].
    r = r[:b + 1]  # type: ignore[assignment]
    wx = wx[:b]
    if not increasing:
        x = x[::-1]
        wx = wx[::-1]
        r = r[-1] - r[::-1]
    return OptimizeResult(
        x=x,
        weights=wx,
        blocks=r,
    )
