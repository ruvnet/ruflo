#
# Author: Travis Oliphant, March 2002
#
import warnings
from itertools import product

import numpy as np
from numpy import (dot, diag, prod, logical_not, ravel, transpose,
                   conjugate, absolute, amax, sign, isfinite, triu)

from scipy._lib._util import _apply_over_batch
from scipy._lib.deprecation import _NoValue

# Local imports
from scipy.linalg import LinAlgError, bandwidth, LinAlgWarning
from ._misc import norm
from ._basic import solve, inv
from ._decomp_svd import svd
from ._decomp_schur import schur, rsf2csf
from ._expm_frechet import expm_frechet, expm_cond
from ._matfuncs_schur_sqrtm import recursive_schur_sqrtm
from ._matfuncs_expm import pick_pade_structure, pade_UV_calc
from ._linalg_pythran import _funm_loops  # type: ignore[import-not-found]

__all__ = ['expm', 'cosm', 'sinm', 'tanm', 'coshm', 'sinhm', 'tanhm', 'logm',
           'funm', 'signm', 'sqrtm', 'fractional_matrix_power', 'expm_frechet',
           'expm_cond', 'khatri_rao']

eps = np.finfo('d').eps
feps = np.finfo('f').eps

_array_precision = {'i': 1, 'l': 1, 'f': 0, 'd': 1, 'F': 0, 'D': 1}


###############################################################################
# Utility functions.


def _asarray_square(A):
    """
    Wraps asarray with the extra requirement that the input be a square matrix.

    The motivation is that the matfuncs module has real functions that have
    been lifted to square matrix functions.

    Parameters
    ----------
    A : array_like
        A square matrix.

    Returns
    -------
    out : ndarray
        An ndarray copy or view or other representation of A.

    """
    A = np.asarray(A)
    if len(A.shape) != 2 or A.shape[0] != A.shape[1]:
        raise ValueError('expected square array_like input')
    return A


def _maybe_real(A, B, tol=None):
    """
    Return either B or the real part of B, depending on properties of A and B.

    The motivation is that B has been computed as a complicated function of A,
    and B may be perturbed by negligible imaginary components.
    If A is real and B is complex with small imaginary components,
    then return a real copy of B.  The assumption in that case would be that
    the imaginary components of B are numerical artifacts.

    Parameters
    ----------
    A : ndarray
        Input array whose type is to be checked as real vs. complex.
    B : ndarray
        Array to be returned, possibly without its imaginary part.
    tol : float
        Absolute tolerance.

    Returns
    -------
    out : real or complex array
        Either the input array B or only the real part of the input array B.

    """
    # Note that booleans and integers compare as real.
    if np.isrealobj(A) and np.iscomplexobj(B):
        if tol is None:
            tol = {0: feps*1e3, 1: eps*1e6}[_array_precision[B.dtype.char]]
        if np.allclose(B.imag, 0.0, atol=tol):
            B = B.real
    return B


###############################################################################
# Matrix functions.


@_apply_over_batch(('A', 2))
def fractional_matrix_power(A, t):
    """
    Compute the fractional power of a matrix.

    Proceeds according to the discussion in section (6) of [1]_.

    Parameters
    ----------
    A : (N, N) array_like
        Matrix whose fractional power to evaluate.
    t : float
        Fractional power.

    Returns
    -------
    X : (N, N) array_like
        The fractional power of the matrix.

    References
    ----------
    .. [1] Nicholas J. Higham and Lijing lin (2011)
           "A Schur-Pade Algorithm for Fractional Powers of a Matrix."
           SIAM Journal on Matrix Analysis and Applications,
           32 (3). pp. 1056-1078. ISSN 0895-4798

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import fractional_matrix_power
    >>> a = np.array([[1.0, 3.0], [1.0, 4.0]])
    >>> b = fractional_matrix_power(a, 0.5)
    >>> b
    array([[ 0.75592895,  1.13389342],
           [ 0.37796447,  1.88982237]])
    >>> np.dot(b, b)      # Verify square root
    array([[ 1.,  3.],
           [ 1.,  4.]])

    """
    # This fixes some issue with imports;
    # this function calls onenormest which is in scipy.sparse.
    A = _asarray_square(A)
    import scipy.linalg._matfuncs_inv_ssq
    return scipy.linalg._matfuncs_inv_ssq._fractional_matrix_power(A, t)


@_apply_over_batch(('A', 2))
def logm(A, disp=_NoValue):
    """
    Compute matrix logarithm.

    The matrix logarithm is the inverse of
    expm: expm(logm(`A`)) == `A`

    Parameters
    ----------
    A : (N, N) array_like
        Matrix whose logarithm to evaluate
    disp : bool, optional
        Emit warning if error in the result is estimated large
        instead of returning estimated error. (Default: True)

        .. deprecated:: 1.16.0
            The `disp` argument is deprecated and will be
            removed in SciPy 1.18.0. The previously returned error estimate
            can be computed as ``norm(expm(logm(A)) - A, 1) / norm(A, 1)``.

    Returns
    -------
    logm : (N, N) ndarray
        Matrix logarithm of `A`
    errest : float
        (if disp == False)

        1-norm of the estimated error, ||err||_1 / ||A||_1

    References
    ----------
    .. [1] Awad H. Al-Mohy and Nicholas J. Higham (2012)
           "Improved Inverse Scaling and Squaring Algorithms
           for the Matrix Logarithm."
           SIAM Journal on Scientific Computing, 34 (4). C152-C169.
           ISSN 1095-7197

    .. [2] Nicholas J. Higham (2008)
           "Functions of Matrices: Theory and Computation"
           ISBN 978-0-898716-46-7

    .. [3] Nicholas J. Higham and Lijing lin (2011)
           "A Schur-Pade Algorithm for Fractional Powers of a Matrix."
           SIAM Journal on Matrix Analysis and Applications,
           32 (3). pp. 1056-1078. ISSN 0895-4798

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import logm, expm
    >>> a = np.array([[1.0, 3.0], [1.0, 4.0]])
    >>> b = logm(a)
    >>> b
    array([[-1.02571087,  2.05142174],
           [ 0.68380725,  1.02571087]])
    >>> expm(b)         # Verify expm(logm(a)) returns a
    array([[ 1.,  3.],
           [ 1.,  4.]])

    """
    if disp is _NoValue:
        disp = True
    else:
        warnings.warn("The `disp` argument is deprecated "
                      "and will be removed in SciPy 1.18.0.",
                      DeprecationWarning, stacklevel=2)
    A = np.asarray(A)  # squareness checked in `_logm`
    # Avoid circular import ... this is OK, right?
    import scipy.linalg._matfuncs_inv_ssq
    F = scipy.linalg._matfuncs_inv_ssq._logm(A)
    F = _maybe_real(A, F)
    errtol = 1000*eps
    # TODO use a better error approximation
    with np.errstate(divide='ignore', invalid='ignore'):
        errest = norm(expm(F)-A, 1) / np.asarray(norm(A, 1), dtype=A.dtype).real[()]
    if disp:
        if not isfinite(errest) or errest >= errtol:
            message = f"logm result may be inaccurate, approximate err = {errest}"
            warnings.warn(message, RuntimeWarning, stacklevel=2)
        return F
    else:
        return F, errest


def expm(A):
    """Compute the matrix exponential of an array.

    Parameters
    ----------
    A : ndarray
        Input with last two dimensions are square ``(..., n, n)``.

    Returns
    -------
    eA : ndarray
        The resulting matrix exponential with the same shape of ``A``

    Notes
    -----
    Implements the algorithm given in [1], which is essentially a Pade
    approximation with a variable order that is decided based on the array
    data.

    For input with size ``n``, the memory usage is in the worst case in the
    order of ``8*(n**2)``. If the input data is not of single and double
    precision of real and complex dtypes, it is copied to a new array.

    For cases ``n >= 400``, the exact 1-norm computation cost, breaks even with
    1-norm estimation and from that point on the estimation scheme given in
    [2] is used to decide on the approximation order.

    References
    ----------
    .. [1] Awad H. Al-Mohy and Nicholas J. Higham, (2009), "A New Scaling
           and Squaring Algorithm for the Matrix Exponential", SIAM J. Matrix
           Anal. Appl. 31(3):970-989, :doi:`10.1137/09074721X`

    .. [2] Nicholas J. Higham and Francoise Tisseur (2000), "A Block Algorithm
           for Matrix 1-Norm Estimation, with an Application to 1-Norm
           Pseudospectra." SIAM J. Matrix Anal. Appl. 21(4):1185-1201,
           :doi:`10.1137/S0895479899356080`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import expm, sinm, cosm

    Matrix version of the formula exp(0) = 1:

    >>> expm(np.zeros((3, 2, 2)))
    array([[[1., 0.],
            [0., 1.]],
    <BLANKLINE>
           [[1., 0.],
            [0., 1.]],
    <BLANKLINE>
           [[1., 0.],
            [0., 1.]]])

    Euler's identity (exp(i*theta) = cos(theta) + i*sin(theta))
    applied to a matrix:

    >>> a = np.array([[1.0, 2.0], [-1.0, 3.0]])
    >>> expm(1j*a)
    array([[ 0.42645930+1.89217551j, -2.13721484-0.97811252j],
           [ 1.06860742+0.48905626j, -1.71075555+0.91406299j]])
    >>> cosm(a) + 1j*sinm(a)
    array([[ 0.42645930+1.89217551j, -2.13721484-0.97811252j],
           [ 1.06860742+0.48905626j, -1.71075555+0.91406299j]])

    """
    a = np.asarray(A)
    if a.size == 1 and a.ndim < 2:
        return np.array([[np.exp(a.item())]])

    if a.ndim < 2:
        raise LinAlgError('The input array must be at least two-dimensional')
    if a.shape[-1] != a.shape[-2]:
        raise LinAlgError('Last 2 dimensions of the array must be square')

    # Empty array
    if min(*a.shape) == 0:
        dtype = expm(np.eye(2, dtype=a.dtype)).dtype
        return np.empty_like(a, dtype=dtype)

    # Scalar case
    if a.shape[-2:] == (1, 1):
        return np.exp(a)

    if not np.issubdtype(a.dtype, np.inexact):
        a = a.astype(np.float64)
    elif a.dtype == np.float16:
        a = a.astype(np.float32)

    # An explicit formula for 2x2 case exists (formula (2.2) in [1]). However, without
    # Kahan's method, numerical instabilities can occur (See gh-19584). Hence removed
    # here until we have a more stable implementation.

    n = a.shape[-1]
    eA = np.empty(a.shape, dtype=a.dtype)
    # working memory to hold intermediate arrays
    Am = np.empty((5, n, n), dtype=a.dtype)

    # Main loop to go through the slices of an ndarray and passing to expm
    for ind in product(*[range(x) for x in a.shape[:-2]]):
        aw = a[ind]

        lu = bandwidth(aw)
        if not any(lu):  # a is diagonal?
            eA[ind] = np.diag(np.exp(np.diag(aw)))
            continue

        # Generic/triangular case; copy the slice into scratch and send.
        # Am will be mutated by pick_pade_structure
        # If s != 0, scaled Am will be returned from pick_pade_structure.
        Am[0, :, :] = aw
        m, s = pick_pade_structure(Am)
        if (m < 0):
            raise MemoryError("scipy.linalg.expm could not allocate sufficient"
                              " memory while trying to compute the Pade "
                              f"structure (error code {m}).")
        info = pade_UV_calc(Am, m)
        if info != 0:
            if info <= -11:
                # We raise it from failed mallocs; negative LAPACK codes > -7
                raise MemoryError("scipy.linalg.expm could not allocate "
                              "sufficient memory while trying to compute the "
                              f"exponential (error code {info}).")
            else:
                # LAPACK wrong argument error or exact singularity.
                # Neither should happen.
                raise RuntimeError("scipy.linalg.expm got an internal LAPACK "
                                   "error during the exponential computation "
                                   f"(error code {info})")
        eAw = Am[0]

        if s != 0:  # squaring needed

            if (lu[1] == 0) or (lu[0] == 0):  # lower/upper triangular
                # This branch implements Code Fragment 2.1 of [1]

                diag_aw = np.diag(aw)
                # einsum returns a writable view
                np.einsum('ii->i', eAw)[:] = np.exp(diag_aw * 2**(-s))
                # super/sub diagonal
                sd = np.diag(aw, k=-1 if lu[1] == 0 else 1)

                for i in range(s-1, -1, -1):
                    eAw = eAw @ eAw

                    # diagonal
                    np.einsum('ii->i', eAw)[:] = np.exp(diag_aw * 2.**(-i))
                    exp_sd = _exp_sinch(diag_aw * (2.**(-i))) * (sd * 2**(-i))
                    if lu[1] == 0:  # lower
                        np.einsum('ii->i', eAw[1:, :-1])[:] = exp_sd
                    else:  # upper
                        np.einsum('ii->i', eAw[:-1, 1:])[:] = exp_sd

            else:  # generic
                for _ in range(s):
                    eAw = eAw @ eAw

        # Zero out the entries from np.empty in case of triangular input
        if (lu[0] == 0) or (lu[1] == 0):
            eA[ind] = np.triu(eAw) if lu[0] == 0 else np.tril(eAw)
        else:
            eA[ind] = eAw

    return eA


def _exp_sinch(x):
    # Higham's formula (10.42), might overflow, see GH-11839
    lexp_diff = np.diff(np.exp(x))
    l_diff = np.diff(x)
    mask_z = l_diff == 0.
    lexp_diff[~mask_z] /= l_diff[~mask_z]
    lexp_diff[mask_z] = np.exp(x[:-1][mask_z])
    return lexp_diff


def sqrtm(A, disp=_NoValue, blocksize=_NoValue):
    """
    Compute, if exists, the matrix square root.

    The matrix square root of ``A`` is a matrix ``X`` such that ``X @ X = A``.
    Every square matrix is not guaranteed to have a matrix square root, for
    example, the array ``[[0, 1], [0, 0]]`` does not have a square root.

    Moreover, not every real matrix has a real square root. Hence, for
    real-valued matrices the return type can be complex if, numerically, there
    is an eigenvalue on the negative real axis.

    Parameters
    ----------
    A : ndarray
        Input with last two dimensions are square ``(..., n, n)``.
    disp : bool, optional
        Print warning if error in the result is estimated large
        instead of returning estimated error. (Default: True)

        .. deprecated:: 1.16.0
            The `disp` argument is deprecated and will be
            removed in SciPy 1.18.0. The previously returned error estimate
            can be computed as ``norm(X @ X - A, 'fro')**2 / norm(A, 'fro')``

    blocksize : integer, optional

        .. deprecated:: 1.16.0
            The `blocksize` argument is deprecated as it is unused by the algorithm
            and will be removed in SciPy 1.18.0.

    Returns
    -------
    sqrtm : ndarray
        Computed matrix squareroot of `A` with same size ``(..., n, n)``.

    errest : float
        Frobenius norm of the estimated error, ||err||_F / ||A||_F. Only
        returned, if ``disp`` is set to ``False``. This return argument will be
        removed in version 1.20.0 and only the sqrtm result will be returned.

        .. deprecated:: 1.16.0

    Notes
    -----
    This function uses the Schur decomposition method to compute the matrix
    square root following [1]_ and for real matrices [2]_. Moreover, note
    that, there exist matrices that have square roots that are not polynomials
    in ``A``. For a classical example from [2]_, the matrix satisfies::

            [ a, a**2 + 1]**2     [-1,  0]
            [-1,       -a]     =  [ 0, -1]

    for any scalar ``a`` but it is not a polynomial in ``-I``. Thus, they will
    not be found by this function.

    References
    ----------
    .. [1] Edvin Deadman, Nicholas J. Higham, Rui Ralha (2013)
           "Blocked Schur Algorithms for Computing the Matrix Square Root,
           Lecture Notes in Computer Science, 7782. pp. 171-182.
           :doi:`10.1016/0024-3795(87)90118-2`
    .. [2] Nicholas J. Higham (1987) "Computing real square roots of a real
           matrix", Linear Algebra and its Applications, 88/89:405-430.
           :doi:`10.1016/0024-3795(87)90118-2`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import sqrtm
    >>> a = np.array([[1.0, 3.0], [1.0, 4.0]])
    >>> r = sqrtm(a)
    >>> r
    array([[ 0.75592895,  1.13389342],
           [ 0.37796447,  1.88982237]])
    >>> r.dot(r)
    array([[ 1.,  3.],
           [ 1.,  4.]])

    """
    if disp is _NoValue:
        disp = True
    else:
        warnings.warn("The `disp` argument is deprecated and will be removed in SciPy "
                      "1.18.0.",
                      DeprecationWarning, stacklevel=2)
    if blocksize is not _NoValue:
        warnings.warn("The `blocksize` argument is deprecated and will be removed in "
                      "SciPy 1.18.0.",
                      DeprecationWarning, stacklevel=2)

    a = np.asarray(A)
    if a.size == 1 and a.ndim < 2:
        return np.array([[np.exp(a.item())]])

    if a.ndim < 2:
        raise LinAlgError('The input array must be at least two-dimensional')
    if a.shape[-1] != a.shape[-2]:
        raise LinAlgError('Last 2 dimensions of the array must be square')

    # Empty array
    if min(*a.shape) == 0:
        dtype = sqrtm(np.eye(2, dtype=a.dtype)).dtype
        return np.empty_like(a, dtype=dtype)

    # Scalar case
    if a.shape[-2:] == (1, 1):
        return np.emath.sqrt(a)

    if not np.issubdtype(a.dtype, np.inexact):
        a = a.astype(np.float64)
    elif a.dtype == np.float16:
        a = a.astype(np.float32)
    elif a.dtype.char in 'G':
        a = a.astype(np.complex128)
    elif a.dtype.char in 'g':
        a = a.astype(np.float64)

    if a.dtype.char not in 'fdFD':
        raise TypeError("scipy.linalg.sqrtm is not supported for the data type"
                        f" {a.dtype}")

    res, isIllconditioned, isSingular, info = recursive_schur_sqrtm(a)
    if info < 0:
        raise LinAlgError(f"Internal error in scipy.linalg.sqrtm: {info}")

    if isSingular or isIllconditioned:
        if isSingular:
            msg = ("Matrix is singular. The result might be inaccurate or the"
                   " array might not have a square root.")
        else:
            msg = ("Matrix is ill-conditioned. The result might be inaccurate"
                   " or the array might not have a square root.")
        warnings.warn(msg, LinAlgWarning, stacklevel=2)

    if disp is False:
        try:
            arg2 = norm(res @ res - A, 'fro')**2 / norm(A, 'fro')
        except ValueError:
            # NaNs in matrix
            arg2 = np.inf
        return res, arg2
    else:
        return res


@_apply_over_batch(('A', 2))
def cosm(A):
    """
    Compute the matrix cosine.

    This routine uses expm to compute the matrix exponentials.

    Parameters
    ----------
    A : (N, N) array_like
        Input array

    Returns
    -------
    cosm : (N, N) ndarray
        Matrix cosine of A

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import expm, sinm, cosm

    Euler's identity (exp(i*theta) = cos(theta) + i*sin(theta))
    applied to a matrix:

    >>> a = np.array([[1.0, 2.0], [-1.0, 3.0]])
    >>> expm(1j*a)
    array([[ 0.42645930+1.89217551j, -2.13721484-0.97811252j],
           [ 1.06860742+0.48905626j, -1.71075555+0.91406299j]])
    >>> cosm(a) + 1j*sinm(a)
    array([[ 0.42645930+1.89217551j, -2.13721484-0.97811252j],
           [ 1.06860742+0.48905626j, -1.71075555+0.91406299j]])

    """
    A = _asarray_square(A)
    if np.iscomplexobj(A):
        return 0.5*(expm(1j*A) + expm(-1j*A))
    else:
        return expm(1j*A).real


@_apply_over_batch(('A', 2))
def sinm(A):
    """
    Compute the matrix sine.

    This routine uses expm to compute the matrix exponentials.

    Parameters
    ----------
    A : (N, N) array_like
        Input array.

    Returns
    -------
    sinm : (N, N) ndarray
        Matrix sine of `A`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import expm, sinm, cosm

    Euler's identity (exp(i*theta) = cos(theta) + i*sin(theta))
    applied to a matrix:

    >>> a = np.array([[1.0, 2.0], [-1.0, 3.0]])
    >>> expm(1j*a)
    array([[ 0.42645930+1.89217551j, -2.13721484-0.97811252j],
           [ 1.06860742+0.48905626j, -1.71075555+0.91406299j]])
    >>> cosm(a) + 1j*sinm(a)
    array([[ 0.42645930+1.89217551j, -2.13721484-0.97811252j],
           [ 1.06860742+0.48905626j, -1.71075555+0.91406299j]])

    """
    A = _asarray_square(A)
    if np.iscomplexobj(A):
        return -0.5j*(expm(1j*A) - expm(-1j*A))
    else:
        return expm(1j*A).imag


@_apply_over_batch(('A', 2))
def tanm(A):
    """
    Compute the matrix tangent.

    This routine uses expm to compute the matrix exponentials.

    Parameters
    ----------
    A : (N, N) array_like
        Input array.

    Returns
    -------
    tanm : (N, N) ndarray
        Matrix tangent of `A`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import tanm, sinm, cosm
    >>> a = np.array([[1.0, 3.0], [1.0, 4.0]])
    >>> t = tanm(a)
    >>> t
    array([[ -2.00876993,  -8.41880636],
           [ -2.80626879, -10.42757629]])

    Verify tanm(a) = sinm(a).dot(inv(cosm(a)))

    >>> s = sinm(a)
    >>> c = cosm(a)
    >>> s.dot(np.linalg.inv(c))
    array([[ -2.00876993,  -8.41880636],
           [ -2.80626879, -10.42757629]])

    """
    A = _asarray_square(A)
    return _maybe_real(A, solve(cosm(A), sinm(A)))


@_apply_over_batch(('A', 2))
def coshm(A):
    """
    Compute the hyperbolic matrix cosine.

    This routine uses expm to compute the matrix exponentials.

    Parameters
    ----------
    A : (N, N) array_like
        Input array.

    Returns
    -------
    coshm : (N, N) ndarray
        Hyperbolic matrix cosine of `A`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import tanhm, sinhm, coshm
    >>> a = np.array([[1.0, 3.0], [1.0, 4.0]])
    >>> c = coshm(a)
    >>> c
    array([[ 11.24592233,  38.76236492],
           [ 12.92078831,  50.00828725]])

    Verify tanhm(a) = sinhm(a).dot(inv(coshm(a)))

    >>> t = tanhm(a)
    >>> s = sinhm(a)
    >>> t - s.dot(np.linalg.inv(c))
    array([[  2.72004641e-15,   4.55191440e-15],
           [  0.00000000e+00,  -5.55111512e-16]])

    """
    A = _asarray_square(A)
    return _maybe_real(A, 0.5 * (expm(A) + expm(-A)))


@_apply_over_batch(('A', 2))
def sinhm(A):
    """
    Compute the hyperbolic matrix sine.

    This routine uses expm to compute the matrix exponentials.

    Parameters
    ----------
    A : (N, N) array_like
        Input array.

    Returns
    -------
    sinhm : (N, N) ndarray
        Hyperbolic matrix sine of `A`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import tanhm, sinhm, coshm
    >>> a = np.array([[1.0, 3.0], [1.0, 4.0]])
    >>> s = sinhm(a)
    >>> s
    array([[ 10.57300653,  39.28826594],
           [ 13.09608865,  49.86127247]])

    Verify tanhm(a) = sinhm(a).dot(inv(coshm(a)))

    >>> t = tanhm(a)
    >>> c = coshm(a)
    >>> t - s.dot(np.linalg.inv(c))
    array([[  2.72004641e-15,   4.55191440e-15],
           [  0.00000000e+00,  -5.55111512e-16]])

    """
    A = _asarray_square(A)
    return _maybe_real(A, 0.5 * (expm(A) - expm(-A)))


@_apply_over_batch(('A', 2))
def tanhm(A):
    """
    Compute the hyperbolic matrix tangent.

    This routine uses expm to compute the matrix exponentials.

    Parameters
    ----------
    A : (N, N) array_like
        Input array

    Returns
    -------
    tanhm : (N, N) ndarray
        Hyperbolic matrix tangent of `A`

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import tanhm, sinhm, coshm
    >>> a = np.array([[1.0, 3.0], [1.0, 4.0]])
    >>> t = tanhm(a)
    >>> t
    array([[ 0.3428582 ,  0.51987926],
           [ 0.17329309,  0.86273746]])

    Verify tanhm(a) = sinhm(a).dot(inv(coshm(a)))

    >>> s = sinhm(a)
    >>> c = coshm(a)
    >>> t - s.dot(np.linalg.inv(c))
    array([[  2.72004641e-15,   4.55191440e-15],
           [  0.00000000e+00,  -5.55111512e-16]])

    """
    A = _asarray_square(A)
    return _maybe_real(A, solve(coshm(A), sinhm(A)))


@_apply_over_batch(('A', 2))
def funm(A, func, disp=True):
    """
    Evaluate a matrix function specified by a callable.

    Returns the value of matrix-valued function ``f`` at `A`. The
    function ``f`` is an extension of the scalar-valued function `func`
    to matrices.

    Parameters
    ----------
    A : (N, N) array_like
        Matrix at which to evaluate the function
    func : callable
        Callable object that evaluates a scalar function f.
        Must be vectorized (eg. using vectorize).
    disp : bool, optional
        Print warning if error in the result is estimated large
        instead of returning estimated error. (Default: True)

    Returns
    -------
    funm : (N, N) ndarray
        Value of the matrix function specified by func evaluated at `A`
    errest : float
        (if disp == False)

        1-norm of the estimated error, ||err||_1 / ||A||_1

    Notes
    -----
    This function implements the general algorithm based on Schur decomposition
    (Algorithm 9.1.1. in [1]_).

    If the input matrix is known to be diagonalizable, then relying on the
    eigendecomposition is likely to be faster. For example, if your matrix is
    Hermitian, you can do

    >>> from scipy.linalg import eigh
    >>> def funm_herm(a, func, check_finite=False):
    ...     w, v = eigh(a, check_finite=check_finite)
    ...     ## if you further know that your matrix is positive semidefinite,
    ...     ## you can optionally guard against precision errors by doing
    ...     # w = np.maximum(w, 0)
    ...     w = func(w)
    ...     return (v * w).dot(v.conj().T)

    References
    ----------
    .. [1] Gene H. Golub, Charles F. van Loan, Matrix Computations 4th ed.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import funm
    >>> a = np.array([[1.0, 3.0], [1.0, 4.0]])
    >>> funm(a, lambda x: x*x)
    array([[  4.,  15.],
           [  5.,  19.]])
    >>> a.dot(a)
    array([[  4.,  15.],
           [  5.,  19.]])

    """
    A = _asarray_square(A)
    # Perform Shur decomposition (lapack ?gees)
    T, Z = schur(A)
    T, Z = rsf2csf(T, Z)
    n, n = T.shape
    F = diag(func(diag(T)))  # apply function to diagonal elements
    F = F.astype(T.dtype.char)  # e.g., when F is real but T is complex

    minden = abs(T[0, 0])

    # implement Algorithm 11.1.1 from Golub and Van Loan
    #                 "matrix Computations."
    F, minden = _funm_loops(F, T, n, minden)

    F = dot(dot(Z, F), transpose(conjugate(Z)))
    F = _maybe_real(A, F)

    tol = {0: feps, 1: eps}[_array_precision[F.dtype.char]]
    if minden == 0.0:
        minden = tol
    err = min(1, max(tol, (tol/minden)*norm(triu(T, 1), 1)))
    if prod(ravel(logical_not(isfinite(F))), axis=0):
        err = np.inf
    if disp:
        if err > 1000*tol:
            print("funm result may be inaccurate, approximate err =", err)
        return F
    else:
        return F, err


@_apply_over_batch(('A', 2))
def signm(A, disp=_NoValue):
    """
    Matrix sign function.

    Extension of the scalar sign(x) to matrices.

    Parameters
    ----------
    A : (N, N) array_like
        Matrix at which to evaluate the sign function
    disp : bool, optional
        Print warning if error in the result is estimated large
        instead of returning estimated error. (Default: True)

        .. deprecated:: 1.16.0
            The `disp` argument is deprecated and will be
            removed in SciPy 1.18.0. The previously returned error estimate
            can be computed as ``norm(signm @ signm - signm, 1)``.

    Returns
    -------
    signm : (N, N) ndarray
        Value of the sign function at `A`
    errest : float
        (if disp == False)

        1-norm of the estimated error, ||err||_1 / ||A||_1

    Examples
    --------
    >>> from scipy.linalg import signm, eigvals
    >>> a = [[1,2,3], [1,2,1], [1,1,1]]
    >>> eigvals(a)
    array([ 4.12488542+0.j, -0.76155718+0.j,  0.63667176+0.j])
    >>> eigvals(signm(a))
    array([-1.+0.j,  1.+0.j,  1.+0.j])

    """
    if disp is _NoValue:
        disp = True
    else:
        warnings.warn("The `disp` argument is deprecated "
                      "and will be removed in SciPy 1.18.0.",
                      DeprecationWarning, stacklevel=2)

    A = _asarray_square(A)

    def rounded_sign(x):
        rx = np.real(x)
        if rx.dtype.char == 'f':
            c = 1e3*feps*amax(x)
        else:
            c = 1e3*eps*amax(x)
        return sign((absolute(rx) > c) * rx)
    result, errest = funm(A, rounded_sign, disp=0)
    errtol = {0: 1e3*feps, 1: 1e3*eps}[_array_precision[result.dtype.char]]
    if errest < errtol:
        return result

    # Handle signm of defective matrices:

    # See "E.D.Denman and J.Leyva-Ramos, Appl.Math.Comp.,
    # 8:237-250,1981" for how to improve the following (currently a
    # rather naive) iteration process:

    # a = result # sometimes iteration converges faster but where??

    # Shifting to avoid zero eigenvalues. How to ensure that shifting does
    # not change the spectrum too much?
    vals = svd(A, compute_uv=False)
    max_sv = np.amax(vals)
    # min_nonzero_sv = vals[(vals>max_sv*errtol).tolist().count(1)-1]
    # c = 0.5/min_nonzero_sv
    c = 0.5/max_sv
    S0 = A + c*np.identity(A.shape[0])
    prev_errest = errest
    for i in range(100):
        iS0 = inv(S0)
        S0 = 0.5*(S0 + iS0)
        Pp = 0.5*(dot(S0, S0)+S0)
        errest = norm(dot(Pp, Pp)-Pp, 1)
        if errest < errtol or prev_errest == errest:
            break
        prev_errest = errest
    if disp:
        if not isfinite(errest) or errest >= errtol:
            print("signm result may be inaccurate, approximate err =", errest)
        return S0
    else:
        return S0, errest


@_apply_over_batch(('a', 2), ('b', 2))
def khatri_rao(a, b):
    r"""
    Khatri-rao product

    A column-wise Kronecker product of two matrices

    Parameters
    ----------
    a : (n, k) array_like
        Input array
    b : (m, k) array_like
        Input array

    Returns
    -------
    c:  (n*m, k) ndarray
        Khatri-rao product of `a` and `b`.

    Notes
    -----
    The mathematical definition of the Khatri-Rao product is:

    .. math::

        (A_{ij}  \bigotimes B_{ij})_{ij}

    which is the Kronecker product of every column of A and B, e.g.::

        c = np.vstack([np.kron(a[:, k], b[:, k]) for k in range(b.shape[1])]).T

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import linalg
    >>> a = np.array([[1, 2, 3], [4, 5, 6]])
    >>> b = np.array([[3, 4, 5], [6, 7, 8], [2, 3, 9]])
    >>> linalg.khatri_rao(a, b)
    array([[ 3,  8, 15],
           [ 6, 14, 24],
           [ 2,  6, 27],
           [12, 20, 30],
           [24, 35, 48],
           [ 8, 15, 54]])

    """
    a = np.asarray(a)
    b = np.asarray(b)

    if not (a.ndim == 2 and b.ndim == 2):
        raise ValueError("The both arrays should be 2-dimensional.")

    if not a.shape[1] == b.shape[1]:
        raise ValueError("The number of columns for both arrays "
                         "should be equal.")

    # accommodate empty arrays
    if a.size == 0 or b.size == 0:
        m = a.shape[0] * b.shape[0]
        n = a.shape[1]
        return np.empty_like(a, shape=(m, n))

    # c = np.vstack([np.kron(a[:, k], b[:, k]) for k in range(b.shape[1])]).T
    c = a[..., :, np.newaxis, :] * b[..., np.newaxis, :, :]
    return c.reshape((-1,) + c.shape[2:])
