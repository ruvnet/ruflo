import numpy as np
from ._slsqplib import nnls as _nnls
from scipy._lib.deprecation import _deprecate_positional_args, _NoValue


__all__ = ['nnls']


@_deprecate_positional_args(version='1.18.0',
                            deprecated_args={'atol'})
def nnls(A, b, *, maxiter=None, atol=_NoValue):
    """
    Solve ``argmin_x || Ax - b ||_2`` for ``x>=0``.

    This problem, often called as NonNegative Least Squares, is a convex
    optimization problem with convex constraints. It typically arises when
    the ``x`` models quantities for which only nonnegative values are
    attainable; weight of ingredients, component costs and so on.

    Parameters
    ----------
    A : (m, n) ndarray
        Coefficient array
    b : (m,) ndarray, float
        Right-hand side vector.
    maxiter: int, optional
        Maximum number of iterations, optional. Default value is ``3 * n``.
    atol : float, optional
        .. deprecated:: 1.18.0
            This parameter is deprecated and will be removed in SciPy 1.18.0.
            It is not used in the implementation.

    Returns
    -------
    x : ndarray
        Solution vector.
    rnorm : float
        The 2-norm of the residual, ``|| Ax-b ||_2``.

    See Also
    --------
    lsq_linear : Linear least squares with bounds on the variables

    Notes
    -----
    The code is based on the classical algorithm of [1]_. It utilizes an active
    set method and solves the KKK (Karush-Kuhn-Tucker) conditions for the
    non-negative least squares problem.

    References
    ----------
    .. [1] : Lawson C., Hanson R.J., "Solving Least Squares Problems", SIAM,
       1995, :doi:`10.1137/1.9781611971217`

     Examples
    --------
    >>> import numpy as np
    >>> from scipy.optimize import nnls
    ...
    >>> A = np.array([[1, 0], [1, 0], [0, 1]])
    >>> b = np.array([2, 1, 1])
    >>> nnls(A, b)
    (array([1.5, 1. ]), 0.7071067811865475)

    >>> b = np.array([-1, -1, -1])
    >>> nnls(A, b)
    (array([0., 0.]), 1.7320508075688772)

    """

    A = np.asarray_chkfinite(A, dtype=np.float64, order='C')
    b = np.asarray_chkfinite(b, dtype=np.float64)

    if len(A.shape) != 2:
        raise ValueError(f"Expected a 2D array, but the shape of A is {A.shape}")

    if (b.ndim > 2) or ((b.ndim == 2) and (b.shape[1] != 1)):
        raise ValueError("Expected a 1D array,(or 2D with one column), but the,"
                         f" shape of b is {b.shape}")
    elif (b.ndim == 2) and (b.shape[1] == 1):
        b = b.ravel()

    m, n = A.shape

    if m != b.shape[0]:
        raise ValueError(
                "Incompatible dimensions. The first dimension of " +
                f"A is {m}, while the shape of b is {(b.shape[0], )}")

    if not maxiter:
        maxiter = 3*n
    x, rnorm, info = _nnls(A, b, maxiter)
    if info == 3:
        raise RuntimeError("Maximum number of iterations reached.")

    return x, rnorm
