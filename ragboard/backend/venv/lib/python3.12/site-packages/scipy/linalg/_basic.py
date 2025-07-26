#
# Author: Pearu Peterson, March 2002
#
# w/ additions by Travis Oliphant, March 2002
#              and Jake Vanderplas, August 2012

import warnings
from warnings import warn
from itertools import product
import numpy as np
from numpy import atleast_1d, atleast_2d
from scipy._lib._util import _apply_over_batch
from .lapack import get_lapack_funcs, _compute_lwork
from ._misc import LinAlgError, _datacopied, LinAlgWarning
from ._decomp import _asarray_validated
from . import _decomp, _decomp_svd
from ._solve_toeplitz import levinson
from ._cythonized_array_utils import (find_det_from_lu, bandwidth, issymmetric,
                                      ishermitian)

__all__ = ['solve', 'solve_triangular', 'solveh_banded', 'solve_banded',
           'solve_toeplitz', 'solve_circulant', 'inv', 'det', 'lstsq',
           'pinv', 'pinvh', 'matrix_balance', 'matmul_toeplitz']


# The numpy facilities for type-casting checks are too slow for small sized
# arrays and eat away the time budget for the checkups. Here we set a
# precomputed dict container of the numpy.can_cast() table.

# It can be used to determine quickly what a dtype can be cast to LAPACK
# compatible types, i.e., 'float32, float64, complex64, complex128'.
# Then it can be checked via "casting_dict[arr.dtype.char]"
lapack_cast_dict = {x: ''.join([y for y in 'fdFD' if np.can_cast(x, y)])
                    for x in np.typecodes['All']}


# Linear equations
def _solve_check(n, info, lamch=None, rcond=None):
    """ Check arguments during the different steps of the solution phase """
    if info < 0:
        raise ValueError(f'LAPACK reported an illegal value in {-info}-th argument.')
    elif 0 < info or rcond == 0:
        raise LinAlgError('Matrix is singular.')

    if lamch is None:
        return
    E = lamch('E')
    if not (rcond >= E):  # `rcond < E` doesn't handle NaN
        warn(f'Ill-conditioned matrix (rcond={rcond:.6g}): '
             'result may not be accurate.',
             LinAlgWarning, stacklevel=3)


def _find_matrix_structure(a):
    n = a.shape[0]
    n_below, n_above = bandwidth(a)

    if n_below == n_above == 0:
        kind = 'diagonal'
    elif n_above == 0:
        kind = 'lower triangular'
    elif n_below == 0:
        kind = 'upper triangular'
    elif n_above <= 1 and n_below <= 1 and n > 3:
        kind = 'tridiagonal'
    elif np.issubdtype(a.dtype, np.complexfloating) and ishermitian(a):
        kind = 'hermitian'
    elif issymmetric(a):
        kind = 'symmetric'
    else:
        kind = 'general'

    return kind, n_below, n_above


@_apply_over_batch(('a', 2), ('b', '1|2'))
def solve(a, b, lower=False, overwrite_a=False,
          overwrite_b=False, check_finite=True, assume_a=None,
          transposed=False):
    """
    Solve the equation ``a @ x = b`` for  ``x``,
    where `a` is a square matrix.

    If the data matrix is known to be a particular type then supplying the
    corresponding string to ``assume_a`` key chooses the dedicated solver.
    The available options are

    =============================  ================================
     diagonal                       'diagonal'
     tridiagonal                    'tridiagonal'
     banded                         'banded'
     upper triangular               'upper triangular'
     lower triangular               'lower triangular'
     symmetric                      'symmetric' (or 'sym')
     hermitian                      'hermitian' (or 'her')
     symmetric positive definite    'positive definite' (or 'pos')
     general                        'general' (or 'gen')
    =============================  ================================

    Parameters
    ----------
    a : (N, N) array_like
        Square input data
    b : (N, NRHS) array_like
        Input data for the right hand side.
    lower : bool, default: False
        Ignored unless ``assume_a`` is one of ``'sym'``, ``'her'``, or ``'pos'``.
        If True, the calculation uses only the data in the lower triangle of `a`;
        entries above the diagonal are ignored. If False (default), the
        calculation uses only the data in the upper triangle of `a`; entries
        below the diagonal are ignored.
    overwrite_a : bool, default: False
        Allow overwriting data in `a` (may enhance performance).
    overwrite_b : bool, default: False
        Allow overwriting data in `b` (may enhance performance).
    check_finite : bool, default: True
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.
    assume_a : str, optional
        Valid entries are described above.
        If omitted or ``None``, checks are performed to identify structure so the
        appropriate solver can be called.
    transposed : bool, default: False
        If True, solve ``a.T @ x == b``. Raises `NotImplementedError`
        for complex `a`.

    Returns
    -------
    x : (N, NRHS) ndarray
        The solution array.

    Raises
    ------
    ValueError
        If size mismatches detected or input a is not square.
    LinAlgError
        If the computation fails because of matrix singularity.
    LinAlgWarning
        If an ill-conditioned input a is detected.
    NotImplementedError
        If transposed is True and input a is a complex matrix.

    Notes
    -----
    If the input b matrix is a 1-D array with N elements, when supplied
    together with an NxN input a, it is assumed as a valid column vector
    despite the apparent size mismatch. This is compatible with the
    numpy.dot() behavior and the returned result is still 1-D array.

    The general, symmetric, Hermitian and positive definite solutions are
    obtained via calling ?GESV, ?SYSV, ?HESV, and ?POSV routines of
    LAPACK respectively.

    The datatype of the arrays define which solver is called regardless
    of the values. In other words, even when the complex array entries have
    precisely zero imaginary parts, the complex solver will be called based
    on the data type of the array.

    Examples
    --------
    Given `a` and `b`, solve for `x`:

    >>> import numpy as np
    >>> a = np.array([[3, 2, 0], [1, -1, 0], [0, 5, 1]])
    >>> b = np.array([2, 4, -1])
    >>> from scipy import linalg
    >>> x = linalg.solve(a, b)
    >>> x
    array([ 2., -2.,  9.])
    >>> np.dot(a, x) == b
    array([ True,  True,  True], dtype=bool)

    """
    # Flags for 1-D or N-D right-hand side
    b_is_1D = False

    # check finite after determining structure
    a1 = atleast_2d(_asarray_validated(a, check_finite=False))
    b1 = atleast_1d(_asarray_validated(b, check_finite=False))
    a1, b1 = _ensure_dtype_cdsz(a1, b1)
    n = a1.shape[0]

    overwrite_a = overwrite_a or _datacopied(a1, a)
    overwrite_b = overwrite_b or _datacopied(b1, b)

    if a1.shape[0] != a1.shape[1]:
        raise ValueError('Input a needs to be a square matrix.')

    if n != b1.shape[0]:
        # Last chance to catch 1x1 scalar a and 1-D b arrays
        if not (n == 1 and b1.size != 0):
            raise ValueError('Input b has to have same number of rows as '
                             'input a')

    # accommodate empty arrays
    if b1.size == 0:
        dt = solve(np.eye(2, dtype=a1.dtype), np.ones(2, dtype=b1.dtype)).dtype
        return np.empty_like(b1, dtype=dt)

    # regularize 1-D b arrays to 2D
    if b1.ndim == 1:
        if n == 1:
            b1 = b1[None, :]
        else:
            b1 = b1[:, None]
        b_is_1D = True

    if assume_a not in {None, 'diagonal', 'tridiagonal', 'banded', 'lower triangular',
                        'upper triangular', 'symmetric', 'hermitian',
                        'positive definite', 'general', 'sym', 'her', 'pos', 'gen'}:
        raise ValueError(f'{assume_a} is not a recognized matrix structure')

    # for a real matrix, describe it as "symmetric", not "hermitian"
    # (lapack doesn't know what to do with real hermitian matrices)
    if assume_a in {'hermitian', 'her'} and not np.iscomplexobj(a1):
        assume_a = 'symmetric'

    n_below, n_above = None, None
    if assume_a is None:
        assume_a, n_below, n_above = _find_matrix_structure(a1)

    # Get the correct lamch function.
    # The LAMCH functions only exists for S and D
    # So for complex values we have to convert to real/double.
    if a1.dtype.char in 'fF':  # single precision
        lamch = get_lapack_funcs('lamch', dtype='f')
    else:
        lamch = get_lapack_funcs('lamch', dtype='d')


    # Since the I-norm and 1-norm are the same for symmetric matrices
    # we can collect them all in this one call
    # Note however, that when issuing 'gen' and form!='none', then
    # the I-norm should be used
    if transposed:
        trans = 1
        norm = 'I'
        if np.iscomplexobj(a1):
            raise NotImplementedError('scipy.linalg.solve can currently '
                                      'not solve a^T x = b or a^H x = b '
                                      'for complex matrices.')
    else:
        trans = 0
        norm = '1'

    # Currently we do not have the other forms of the norm calculators
    #   lansy, lanpo, lanhe.
    # However, in any case they only reduce computations slightly...
    if assume_a == 'diagonal':
        anorm = _matrix_norm_diagonal(a1, check_finite)
    elif assume_a == 'tridiagonal':
        anorm = _matrix_norm_tridiagonal(norm, a1, check_finite)
    elif assume_a == 'banded':
        n_below, n_above = bandwidth(a1) if n_below is None else (n_below, n_above)
        a2, n_below, n_above = ((a1.T, n_above, n_below) if transposed
                                else (a1, n_below, n_above))
        ab = _to_banded(n_below, n_above, a2)
        anorm = _matrix_norm_banded(n_below, n_above, norm, ab, check_finite)
    elif assume_a in {'lower triangular', 'upper triangular'}:
        anorm = _matrix_norm_triangular(assume_a, norm, a1, check_finite)
    else:
        anorm = _matrix_norm_general(norm, a1, check_finite)

    info, rcond = 0, np.inf

    # Generalized case 'gesv'
    if assume_a in {'general', 'gen'}:
        gecon, getrf, getrs = get_lapack_funcs(('gecon', 'getrf', 'getrs'),
                                               (a1, b1))
        lu, ipvt, info = getrf(a1, overwrite_a=overwrite_a)
        _solve_check(n, info)
        x, info = getrs(lu, ipvt, b1,
                        trans=trans, overwrite_b=overwrite_b)
        _solve_check(n, info)
        rcond, info = gecon(lu, anorm, norm=norm)
    # Hermitian case 'hesv'
    elif assume_a in {'hermitian', 'her'}:
        hecon, hesv, hesv_lw = get_lapack_funcs(('hecon', 'hesv',
                                                 'hesv_lwork'), (a1, b1))
        lwork = _compute_lwork(hesv_lw, n, lower)
        lu, ipvt, x, info = hesv(a1, b1, lwork=lwork,
                                 lower=lower,
                                 overwrite_a=overwrite_a,
                                 overwrite_b=overwrite_b)
        _solve_check(n, info)
        rcond, info = hecon(lu, ipvt, anorm, lower=lower)
    # Symmetric case 'sysv'
    elif assume_a in {'symmetric', 'sym'}:
        sycon, sysv, sysv_lw = get_lapack_funcs(('sycon', 'sysv',
                                                 'sysv_lwork'), (a1, b1))
        lwork = _compute_lwork(sysv_lw, n, lower)
        lu, ipvt, x, info = sysv(a1, b1, lwork=lwork,
                                 lower=lower,
                                 overwrite_a=overwrite_a,
                                 overwrite_b=overwrite_b)
        _solve_check(n, info)
        rcond, info = sycon(lu, ipvt, anorm, lower=lower)
    # Diagonal case
    elif assume_a == 'diagonal':
        diag_a = np.diag(a1)
        x = (b1.T / diag_a).T
        abs_diag_a = np.abs(diag_a)
        diag_min = abs_diag_a.min()
        rcond = diag_min if diag_min == 0 else diag_min / abs_diag_a.max()
    # Tri-diagonal case
    elif assume_a == 'tridiagonal':
        a1 = a1.T if transposed else a1
        dl, d, du = np.diag(a1, -1), np.diag(a1, 0), np.diag(a1, 1)
        _gttrf, _gttrs, _gtcon = get_lapack_funcs(('gttrf', 'gttrs', 'gtcon'), (a1, b1))
        dl, d, du, du2, ipiv, info = _gttrf(dl, d, du)
        _solve_check(n, info)
        x, info = _gttrs(dl, d, du, du2, ipiv, b1, overwrite_b=overwrite_b)
        _solve_check(n, info)
        rcond, info = _gtcon(dl, d, du, du2, ipiv, anorm)
    # Banded case
    elif assume_a == 'banded':
        gbsv, gbcon = get_lapack_funcs(('gbsv', 'gbcon'), (a1, b1))
        # Next two lines copied from `solve_banded`
        a2 = np.zeros((2*n_below + n_above + 1, ab.shape[1]), dtype=gbsv.dtype)
        a2[n_below:, :] = ab
        lu, piv, x, info = gbsv(n_below, n_above, a2, b1,
                                overwrite_ab=True, overwrite_b=overwrite_b)
        _solve_check(n, info)
        rcond, info = gbcon(n_below, n_above, lu, piv, anorm)
    # Triangular case
    elif assume_a in {'lower triangular', 'upper triangular'}:
        lower = assume_a == 'lower triangular'
        x, info = _solve_triangular(a1, b1, lower=lower, overwrite_b=overwrite_b,
                                    trans=transposed)
        _solve_check(n, info)
        _trcon = get_lapack_funcs(('trcon'), (a1, b1))
        rcond, info = _trcon(a1, uplo='L' if lower else 'U')
    # Positive definite case 'posv'
    else:
        pocon, posv = get_lapack_funcs(('pocon', 'posv'),
                                       (a1, b1))
        lu, x, info = posv(a1, b1, lower=lower,
                           overwrite_a=overwrite_a,
                           overwrite_b=overwrite_b)
        _solve_check(n, info)
        rcond, info = pocon(lu, anorm)

    _solve_check(n, info, lamch, rcond)

    if b_is_1D:
        x = x.ravel()

    return x


def _matrix_norm_diagonal(a, check_finite):
    # Equivalent of dlange for diagonal matrix, assuming
    # norm is either 'I' or '1' (really just not the Frobenius norm)
    d = np.diag(a)
    d = np.asarray_chkfinite(d) if check_finite else d
    return np.abs(d).max()


def _matrix_norm_tridiagonal(norm, a, check_finite):
    # Equivalent of dlange for tridiagonal matrix, assuming
    # norm is either 'I' or '1'
    if norm == 'I':
        a = a.T
    # Context to avoid warning before error in cases like -inf + inf
    with np.errstate(invalid='ignore'):
        d = np.abs(np.diag(a))
        d[1:] += np.abs(np.diag(a, 1))
        d[:-1] += np.abs(np.diag(a, -1))
    d = np.asarray_chkfinite(d) if check_finite else d
    return d.max()


def _matrix_norm_triangular(structure, norm, a, check_finite):
    a = np.asarray_chkfinite(a) if check_finite else a
    lantr = get_lapack_funcs('lantr', (a,))
    return lantr(norm, a, 'L' if structure == 'lower triangular' else 'U' )


def _matrix_norm_banded(kl, ku, norm, ab, check_finite):
    ab = np.asarray_chkfinite(ab) if check_finite else ab
    langb = get_lapack_funcs('langb', (ab,))
    return langb(norm, kl, ku, ab)


def _matrix_norm_general(norm, a, check_finite):
    a = np.asarray_chkfinite(a) if check_finite else a
    lange = get_lapack_funcs('lange', (a,))
    return lange(norm, a)


def _to_banded(n_below, n_above, a):
    n = a.shape[0]
    rows = n_above + n_below + 1
    ab = np.zeros((rows, n), dtype=a.dtype)
    ab[n_above] = np.diag(a)
    for i in range(1, n_above + 1):
        ab[n_above - i, i:] = np.diag(a, i)
    for i in range(1, n_below + 1):
        ab[n_above + i, :-i] = np.diag(a, -i)
    return ab


def _ensure_dtype_cdsz(*arrays):
    # Ensure that the dtype of arrays is one of the standard types
    # compatible with LAPACK functions (single or double precision
    # real or complex).
    dtype = np.result_type(*arrays)
    if not np.issubdtype(dtype, np.inexact):
        return (array.astype(np.float64) for array in arrays)
    complex = np.issubdtype(dtype, np.complexfloating)
    if np.finfo(dtype).bits <= 32:
        dtype = np.complex64 if complex else np.float32
    elif np.finfo(dtype).bits >= 64:
        dtype = np.complex128 if complex else np.float64
    return (array.astype(dtype, copy=False) for array in arrays)


@_apply_over_batch(('a', 2), ('b', '1|2'))
def solve_triangular(a, b, trans=0, lower=False, unit_diagonal=False,
                     overwrite_b=False, check_finite=True):
    """
    Solve the equation ``a @ x = b`` for ``x``, where `a` is a triangular matrix.

    Parameters
    ----------
    a : (M, M) array_like
        A triangular matrix
    b : (M,) or (M, N) array_like
        Right-hand side matrix in ``a x = b``
    lower : bool, optional
        Use only data contained in the lower triangle of `a`.
        Default is to use upper triangle.
    trans : {0, 1, 2, 'N', 'T', 'C'}, optional
        Type of system to solve:

        ========  =========
        trans     system
        ========  =========
        0 or 'N'  a x  = b
        1 or 'T'  a^T x = b
        2 or 'C'  a^H x = b
        ========  =========
    unit_diagonal : bool, optional
        If True, diagonal elements of `a` are assumed to be 1 and
        will not be referenced.
    overwrite_b : bool, optional
        Allow overwriting data in `b` (may enhance performance)
    check_finite : bool, optional
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    x : (M,) or (M, N) ndarray
        Solution to the system ``a x = b``.  Shape of return matches `b`.

    Raises
    ------
    LinAlgError
        If `a` is singular

    Notes
    -----
    .. versionadded:: 0.9.0

    Examples
    --------
    Solve the lower triangular system a x = b, where::

             [3  0  0  0]       [4]
        a =  [2  1  0  0]   b = [2]
             [1  0  1  0]       [4]
             [1  1  1  1]       [2]

    >>> import numpy as np
    >>> from scipy.linalg import solve_triangular
    >>> a = np.array([[3, 0, 0, 0], [2, 1, 0, 0], [1, 0, 1, 0], [1, 1, 1, 1]])
    >>> b = np.array([4, 2, 4, 2])
    >>> x = solve_triangular(a, b, lower=True)
    >>> x
    array([ 1.33333333, -0.66666667,  2.66666667, -1.33333333])
    >>> a.dot(x)  # Check the result
    array([ 4.,  2.,  4.,  2.])

    """

    a1 = _asarray_validated(a, check_finite=check_finite)
    b1 = _asarray_validated(b, check_finite=check_finite)

    if len(a1.shape) != 2 or a1.shape[0] != a1.shape[1]:
        raise ValueError('expected square matrix')

    if a1.shape[0] != b1.shape[0]:
        raise ValueError(f'shapes of a {a1.shape} and b {b1.shape} are incompatible')

    # accommodate empty arrays
    if b1.size == 0:
        dt_nonempty = solve_triangular(
            np.eye(2, dtype=a1.dtype), np.ones(2, dtype=b1.dtype)
        ).dtype
        return np.empty_like(b1, dtype=dt_nonempty)

    overwrite_b = overwrite_b or _datacopied(b1, b)

    x, _ = _solve_triangular(a1, b1, trans, lower, unit_diagonal, overwrite_b)
    return x


# solve_triangular without the input validation
def _solve_triangular(a1, b1, trans=0, lower=False, unit_diagonal=False,
                      overwrite_b=False):

    trans = {'N': 0, 'T': 1, 'C': 2}.get(trans, trans)
    trtrs, = get_lapack_funcs(('trtrs',), (a1, b1))
    if a1.flags.f_contiguous or trans == 2:
        x, info = trtrs(a1, b1, overwrite_b=overwrite_b, lower=lower,
                        trans=trans, unitdiag=unit_diagonal)
    else:
        # transposed system is solved since trtrs expects Fortran ordering
        x, info = trtrs(a1.T, b1, overwrite_b=overwrite_b, lower=not lower,
                        trans=not trans, unitdiag=unit_diagonal)

    if info == 0:
        return x, info
    if info > 0:
        raise LinAlgError(f"singular matrix: resolution failed at diagonal {info-1}")
    raise ValueError(f'illegal value in {-info}-th argument of internal trtrs')


def solve_banded(l_and_u, ab, b, overwrite_ab=False, overwrite_b=False,
                 check_finite=True):
    """
    Solve the equation ``a @ x = b`` for ``x``, where ``a`` is the banded matrix
    defined by `ab`.

    The matrix a is stored in `ab` using the matrix diagonal ordered form::

        ab[u + i - j, j] == a[i,j]

    Example of `ab` (shape of a is (6,6), `u` =1, `l` =2)::

        *    a01  a12  a23  a34  a45
        a00  a11  a22  a33  a44  a55
        a10  a21  a32  a43  a54   *
        a20  a31  a42  a53   *    *

    Parameters
    ----------
    (l, u) : (integer, integer)
        Number of non-zero lower and upper diagonals
    ab : (`l` + `u` + 1, M) array_like
        Banded matrix
    b : (M,) or (M, K) array_like
        Right-hand side
    overwrite_ab : bool, optional
        Discard data in `ab` (may enhance performance)
    overwrite_b : bool, optional
        Discard data in `b` (may enhance performance)
    check_finite : bool, optional
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    x : (M,) or (M, K) ndarray
        The solution to the system a x = b. Returned shape depends on the
        shape of `b`.

    Examples
    --------
    Solve the banded system a x = b, where::

            [5  2 -1  0  0]       [0]
            [1  4  2 -1  0]       [1]
        a = [0  1  3  2 -1]   b = [2]
            [0  0  1  2  2]       [2]
            [0  0  0  1  1]       [3]

    There is one nonzero diagonal below the main diagonal (l = 1), and
    two above (u = 2). The diagonal banded form of the matrix is::

             [*  * -1 -1 -1]
        ab = [*  2  2  2  2]
             [5  4  3  2  1]
             [1  1  1  1  *]

    >>> import numpy as np
    >>> from scipy.linalg import solve_banded
    >>> ab = np.array([[0,  0, -1, -1, -1],
    ...                [0,  2,  2,  2,  2],
    ...                [5,  4,  3,  2,  1],
    ...                [1,  1,  1,  1,  0]])
    >>> b = np.array([0, 1, 2, 2, 3])
    >>> x = solve_banded((1, 2), ab, b)
    >>> x
    array([-2.37288136,  3.93220339, -4.        ,  4.3559322 , -1.3559322 ])

    """
    (nlower, nupper) = l_and_u
    return _solve_banded(nlower, nupper, ab, b, overwrite_ab=overwrite_ab,
                         overwrite_b=overwrite_b, check_finite=check_finite)


@_apply_over_batch(('nlower', 0), ('nupper', 0), ('ab', 2), ('b', '1|2'))
def _solve_banded(nlower, nupper, ab, b, overwrite_ab, overwrite_b, check_finite):
    a1 = _asarray_validated(ab, check_finite=check_finite, as_inexact=True)
    b1 = _asarray_validated(b, check_finite=check_finite, as_inexact=True)

    # Validate shapes.
    if a1.shape[-1] != b1.shape[0]:
        raise ValueError("shapes of ab and b are not compatible.")

    if nlower + nupper + 1 != a1.shape[0]:
        raise ValueError(
            f"invalid values for the number of lower and upper diagonals: l+u+1 "
            f"({nlower + nupper + 1}) does not equal ab.shape[0] ({ab.shape[0]})"
        )

    # accommodate empty arrays
    if b1.size == 0:
        dt = solve(np.eye(1, dtype=a1.dtype), np.ones(1, dtype=b1.dtype)).dtype
        return np.empty_like(b1, dtype=dt)

    overwrite_b = overwrite_b or _datacopied(b1, b)
    if a1.shape[-1] == 1:
        b2 = np.array(b1, copy=(not overwrite_b))
        # a1.shape[-1] == 1 -> original matrix is 1x1. Typically, the user
        # will pass u = l = 0 and `a1` will be 1x1. However, the rest of the
        # function works with unnecessary rows in `a1` as long as
        # `a1[u + i - j, j] == a[i,j]`. In the 1x1 case, we want i = j = 0,
        # so the diagonal is in row `u` of `a1`. See gh-8906.
        b2 /= a1[nupper, 0]
        return b2
    if nlower == nupper == 1:
        overwrite_ab = overwrite_ab or _datacopied(a1, ab)
        gtsv, = get_lapack_funcs(('gtsv',), (a1, b1))
        du = a1[0, 1:]
        d = a1[1, :]
        dl = a1[2, :-1]
        du2, d, du, x, info = gtsv(dl, d, du, b1, overwrite_ab, overwrite_ab,
                                   overwrite_ab, overwrite_b)
    else:
        gbsv, = get_lapack_funcs(('gbsv',), (a1, b1))
        a2 = np.zeros((2*nlower + nupper + 1, a1.shape[1]), dtype=gbsv.dtype)
        a2[nlower:, :] = a1
        lu, piv, x, info = gbsv(nlower, nupper, a2, b1, overwrite_ab=True,
                                overwrite_b=overwrite_b)
    if info == 0:
        return x
    if info > 0:
        raise LinAlgError("singular matrix")
    raise ValueError(f'illegal value in {-info}-th argument of internal gbsv/gtsv')


@_apply_over_batch(('a', 2), ('b', '1|2'))
def solveh_banded(ab, b, overwrite_ab=False, overwrite_b=False, lower=False,
                  check_finite=True):
    """
    Solve the equation ``a @ x = b`` for ``x``,  where ``a`` is the 
    Hermitian positive-definite banded matrix defined by `ab`.

    Uses Thomas' Algorithm, which is more efficient than standard LU
    factorization, but should only be used for Hermitian positive-definite
    matrices.

    The matrix ``a`` is stored in `ab` either in lower diagonal or upper
    diagonal ordered form:

        ab[u + i - j, j] == a[i,j]        (if upper form; i <= j)
        ab[    i - j, j] == a[i,j]        (if lower form; i >= j)

    Example of `ab` (shape of ``a`` is (6, 6), number of upper diagonals,
    ``u`` =2)::

        upper form:
        *   *   a02 a13 a24 a35
        *   a01 a12 a23 a34 a45
        a00 a11 a22 a33 a44 a55

        lower form:
        a00 a11 a22 a33 a44 a55
        a10 a21 a32 a43 a54 *
        a20 a31 a42 a53 *   *

    Cells marked with * are not used.

    Parameters
    ----------
    ab : (``u`` + 1, M) array_like
        Banded matrix
    b : (M,) or (M, K) array_like
        Right-hand side
    overwrite_ab : bool, optional
        Discard data in `ab` (may enhance performance)
    overwrite_b : bool, optional
        Discard data in `b` (may enhance performance)
    lower : bool, optional
        Is the matrix in the lower form. (Default is upper form)
    check_finite : bool, optional
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    x : (M,) or (M, K) ndarray
        The solution to the system ``a x = b``. Shape of return matches shape
        of `b`.

    Notes
    -----
    In the case of a non-positive definite matrix ``a``, the solver
    `solve_banded` may be used.

    Examples
    --------
    Solve the banded system ``A x = b``, where::

            [ 4  2 -1  0  0  0]       [1]
            [ 2  5  2 -1  0  0]       [2]
        A = [-1  2  6  2 -1  0]   b = [2]
            [ 0 -1  2  7  2 -1]       [3]
            [ 0  0 -1  2  8  2]       [3]
            [ 0  0  0 -1  2  9]       [3]

    >>> import numpy as np
    >>> from scipy.linalg import solveh_banded

    ``ab`` contains the main diagonal and the nonzero diagonals below the
    main diagonal. That is, we use the lower form:

    >>> ab = np.array([[ 4,  5,  6,  7, 8, 9],
    ...                [ 2,  2,  2,  2, 2, 0],
    ...                [-1, -1, -1, -1, 0, 0]])
    >>> b = np.array([1, 2, 2, 3, 3, 3])
    >>> x = solveh_banded(ab, b, lower=True)
    >>> x
    array([ 0.03431373,  0.45938375,  0.05602241,  0.47759104,  0.17577031,
            0.34733894])


    Solve the Hermitian banded system ``H x = b``, where::

            [ 8   2-1j   0     0  ]        [ 1  ]
        H = [2+1j  5     1j    0  ]    b = [1+1j]
            [ 0   -1j    9   -2-1j]        [1-2j]
            [ 0    0   -2+1j   6  ]        [ 0  ]

    In this example, we put the upper diagonals in the array ``hb``:

    >>> hb = np.array([[0, 2-1j, 1j, -2-1j],
    ...                [8,  5,    9,   6  ]])
    >>> b = np.array([1, 1+1j, 1-2j, 0])
    >>> x = solveh_banded(hb, b)
    >>> x
    array([ 0.07318536-0.02939412j,  0.11877624+0.17696461j,
            0.10077984-0.23035393j, -0.00479904-0.09358128j])

    """
    a1 = _asarray_validated(ab, check_finite=check_finite)
    b1 = _asarray_validated(b, check_finite=check_finite)

    # Validate shapes.
    if a1.shape[-1] != b1.shape[0]:
        raise ValueError("shapes of ab and b are not compatible.")

    # accommodate empty arrays
    if b1.size == 0:
        dt = solve(np.eye(1, dtype=a1.dtype), np.ones(1, dtype=b1.dtype)).dtype
        return np.empty_like(b1, dtype=dt)

    overwrite_b = overwrite_b or _datacopied(b1, b)
    overwrite_ab = overwrite_ab or _datacopied(a1, ab)

    if a1.shape[0] == 2:
        ptsv, = get_lapack_funcs(('ptsv',), (a1, b1))
        if lower:
            d = a1[0, :].real
            e = a1[1, :-1]
        else:
            d = a1[1, :].real
            e = a1[0, 1:].conj()
        d, du, x, info = ptsv(d, e, b1, overwrite_ab, overwrite_ab,
                              overwrite_b)
    else:
        pbsv, = get_lapack_funcs(('pbsv',), (a1, b1))
        c, x, info = pbsv(a1, b1, lower=lower, overwrite_ab=overwrite_ab,
                          overwrite_b=overwrite_b)
    if info > 0:
        raise LinAlgError(f"{info}th leading minor not positive definite")
    if info < 0:
        raise ValueError(f'illegal value in {-info}th argument of internal pbsv')
    return x


def solve_toeplitz(c_or_cr, b, check_finite=True):
    r"""Solve the equation ``T @ x = b`` for ``x``, where ``T`` is a Toeplitz
    matrix defined by `c_or_cr`.

    The Toeplitz matrix has constant diagonals, with ``c`` as its first column
    and ``r`` as its first row. If ``r`` is not given, ``r == conjugate(c)`` is
    assumed.

    .. warning::

        Beginning in SciPy 1.17, multidimensional input will be treated as a batch,
        not ``ravel``\ ed. To preserve the existing behavior, ``ravel`` arguments
        before passing them to `solve_toeplitz`.

    Parameters
    ----------
    c_or_cr : array_like or tuple of (array_like, array_like)
        The vector ``c``, or a tuple of arrays (``c``, ``r``). If not
        supplied, ``r = conjugate(c)`` is assumed; in this case, if c[0] is
        real, the Toeplitz matrix is Hermitian. r[0] is ignored; the first row
        of the Toeplitz matrix is ``[c[0], r[1:]]``.
    b : (M,) or (M, K) array_like
        Right-hand side in ``T x = b``.
    check_finite : bool, optional
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (result entirely NaNs) if the inputs do contain infinities or NaNs.

    Returns
    -------
    x : (M,) or (M, K) ndarray
        The solution to the system ``T @ x = b``. Shape of return matches shape
        of `b`.

    See Also
    --------
    toeplitz : Toeplitz matrix

    Notes
    -----
    The solution is computed using Levinson-Durbin recursion, which is faster
    than generic least-squares methods, but can be less numerically stable.

    Examples
    --------
    Solve the Toeplitz system ``T @ x = b``, where::

            [ 1 -1 -2 -3]       [1]
        T = [ 3  1 -1 -2]   b = [2]
            [ 6  3  1 -1]       [2]
            [10  6  3  1]       [5]

    To specify the Toeplitz matrix, only the first column and the first
    row are needed.

    >>> import numpy as np
    >>> c = np.array([1, 3, 6, 10])    # First column of T
    >>> r = np.array([1, -1, -2, -3])  # First row of T
    >>> b = np.array([1, 2, 2, 5])

    >>> from scipy.linalg import solve_toeplitz, toeplitz
    >>> x = solve_toeplitz((c, r), b)
    >>> x
    array([ 1.66666667, -1.        , -2.66666667,  2.33333333])

    Check the result by creating the full Toeplitz matrix and
    multiplying it by ``x``.  We should get `b`.

    >>> T = toeplitz(c, r)
    >>> T.dot(x)
    array([ 1.,  2.,  2.,  5.])

    """
    # If numerical stability of this algorithm is a problem, a future
    # developer might consider implementing other O(N^2) Toeplitz solvers,
    # such as GKO (https://www.jstor.org/stable/2153371) or Bareiss.
    c, r = c_or_cr if isinstance(c_or_cr, tuple) else (c_or_cr, np.conjugate(c_or_cr))
    return _solve_toeplitz(c, r, b, check_finite)


# Can uncomment when `solve_toeplitz` deprecation is done (SciPy 1.17)
# @_apply_over_batch(('c', 1), ('r', 1), ('b', '1|2'))
def _solve_toeplitz(c, r, b, check_finite):
    r, c, b, dtype, b_shape = _validate_args_for_toeplitz_ops(
        (c, r), b, check_finite, keep_b_shape=True)

    # accommodate empty arrays
    if b.size == 0:
        return np.empty_like(b)

    # Form a 1-D array of values to be used in the matrix, containing a
    # reversed copy of r[1:], followed by c.
    vals = np.concatenate((r[-1:0:-1], c))
    if b is None:
        raise ValueError('illegal value, `b` is a required argument')

    if b.ndim == 1:
        x, _ = levinson(vals, np.ascontiguousarray(b))
    else:
        x = np.column_stack([levinson(vals, np.ascontiguousarray(b[:, i]))[0]
                             for i in range(b.shape[1])])
        x = x.reshape(*b_shape)

    return x


def _get_axis_len(aname, a, axis):
    ax = axis
    if ax < 0:
        ax += a.ndim
    if 0 <= ax < a.ndim:
        return a.shape[ax]
    raise ValueError(f"'{aname}axis' entry is out of bounds")


def solve_circulant(c, b, singular='raise', tol=None,
                    caxis=-1, baxis=0, outaxis=0):
    """Solve the equation ``C @ x = b`` for ``x``, where ``C`` is a
    circulant matrix defined by `c`.

    `C` is the circulant matrix associated with the vector `c`.

    The system is solved by doing division in Fourier space. The
    calculation is::

        x = ifft(fft(b) / fft(c))

    where `fft` and `ifft` are the fast Fourier transform and its inverse,
    respectively. For a large vector `c`, this is *much* faster than
    solving the system with the full circulant matrix.

    Parameters
    ----------
    c : array_like
        The coefficients of the circulant matrix.
    b : array_like
        Right-hand side matrix in ``a x = b``.
    singular : str, optional
        This argument controls how a near singular circulant matrix is
        handled.  If `singular` is "raise" and the circulant matrix is
        near singular, a `LinAlgError` is raised. If `singular` is
        "lstsq", the least squares solution is returned. Default is "raise".
    tol : float, optional
        If any eigenvalue of the circulant matrix has an absolute value
        that is less than or equal to `tol`, the matrix is considered to be
        near singular. If not given, `tol` is set to::

            tol = abs_eigs.max() * abs_eigs.size * np.finfo(np.float64).eps

        where `abs_eigs` is the array of absolute values of the eigenvalues
        of the circulant matrix.
    caxis : int
        When `c` has dimension greater than 1, it is viewed as a collection
        of circulant vectors. In this case, `caxis` is the axis of `c` that
        holds the vectors of circulant coefficients.
    baxis : int
        When `b` has dimension greater than 1, it is viewed as a collection
        of vectors. In this case, `baxis` is the axis of `b` that holds the
        right-hand side vectors.
    outaxis : int
        When `c` or `b` are multidimensional, the value returned by
        `solve_circulant` is multidimensional. In this case, `outaxis` is
        the axis of the result that holds the solution vectors.

    Returns
    -------
    x : ndarray
        Solution to the system ``C x = b``.

    Raises
    ------
    LinAlgError
        If the circulant matrix associated with `c` is near singular.

    See Also
    --------
    circulant : circulant matrix

    Notes
    -----
    For a 1-D vector `c` with length `m`, and an array `b`
    with shape ``(m, ...)``,

        solve_circulant(c, b)

    returns the same result as

        solve(circulant(c), b)

    where `solve` and `circulant` are from `scipy.linalg`.

    .. versionadded:: 0.16.0

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import solve_circulant, solve, circulant, lstsq

    >>> c = np.array([2, 2, 4])
    >>> b = np.array([1, 2, 3])
    >>> solve_circulant(c, b)
    array([ 0.75, -0.25,  0.25])

    Compare that result to solving the system with `scipy.linalg.solve`:

    >>> solve(circulant(c), b)
    array([ 0.75, -0.25,  0.25])

    A singular example:

    >>> c = np.array([1, 1, 0, 0])
    >>> b = np.array([1, 2, 3, 4])

    Calling ``solve_circulant(c, b)`` will raise a `LinAlgError`.  For the
    least square solution, use the option ``singular='lstsq'``:

    >>> solve_circulant(c, b, singular='lstsq')
    array([ 0.25,  1.25,  2.25,  1.25])

    Compare to `scipy.linalg.lstsq`:

    >>> x, resid, rnk, s = lstsq(circulant(c), b)
    >>> x
    array([ 0.25,  1.25,  2.25,  1.25])

    A broadcasting example:

    Suppose we have the vectors of two circulant matrices stored in an array
    with shape (2, 5), and three `b` vectors stored in an array with shape
    (3, 5).  For example,

    >>> c = np.array([[1.5, 2, 3, 0, 0], [1, 1, 4, 3, 2]])
    >>> b = np.arange(15).reshape(-1, 5)

    We want to solve all combinations of circulant matrices and `b` vectors,
    with the result stored in an array with shape (2, 3, 5). When we
    disregard the axes of `c` and `b` that hold the vectors of coefficients,
    the shapes of the collections are (2,) and (3,), respectively, which are
    not compatible for broadcasting. To have a broadcast result with shape
    (2, 3), we add a trivial dimension to `c`: ``c[:, np.newaxis, :]`` has
    shape (2, 1, 5). The last dimension holds the coefficients of the
    circulant matrices, so when we call `solve_circulant`, we can use the
    default ``caxis=-1``. The coefficients of the `b` vectors are in the last
    dimension of the array `b`, so we use ``baxis=-1``. If we use the
    default `outaxis`, the result will have shape (5, 2, 3), so we'll use
    ``outaxis=-1`` to put the solution vectors in the last dimension.

    >>> x = solve_circulant(c[:, np.newaxis, :], b, baxis=-1, outaxis=-1)
    >>> x.shape
    (2, 3, 5)
    >>> np.set_printoptions(precision=3)  # For compact output of numbers.
    >>> x
    array([[[-0.118,  0.22 ,  1.277, -0.142,  0.302],
            [ 0.651,  0.989,  2.046,  0.627,  1.072],
            [ 1.42 ,  1.758,  2.816,  1.396,  1.841]],
           [[ 0.401,  0.304,  0.694, -0.867,  0.377],
            [ 0.856,  0.758,  1.149, -0.412,  0.831],
            [ 1.31 ,  1.213,  1.603,  0.042,  1.286]]])

    Check by solving one pair of `c` and `b` vectors (cf. ``x[1, 1, :]``):

    >>> solve_circulant(c[1], b[1, :])
    array([ 0.856,  0.758,  1.149, -0.412,  0.831])

    """
    c = np.atleast_1d(c)
    nc = _get_axis_len("c", c, caxis)
    b = np.atleast_1d(b)
    nb = _get_axis_len("b", b, baxis)
    if nc != nb:
        raise ValueError(f'Shapes of c {c.shape} and b {b.shape} are incompatible')

    # accommodate empty arrays
    if b.size == 0:
        dt = solve_circulant(np.arange(3, dtype=c.dtype),
                             np.ones(3, dtype=b.dtype)).dtype
        return np.empty_like(b, dtype=dt)

    fc = np.fft.fft(np.moveaxis(c, caxis, -1), axis=-1)
    abs_fc = np.abs(fc)
    if tol is None:
        # This is the same tolerance as used in np.linalg.matrix_rank.
        tol = abs_fc.max(axis=-1) * nc * np.finfo(np.float64).eps
        if tol.shape != ():
            tol.shape = tol.shape + (1,)
        else:
            tol = np.atleast_1d(tol)

    near_zeros = abs_fc <= tol
    is_near_singular = np.any(near_zeros)
    if is_near_singular:
        if singular == 'raise':
            raise LinAlgError("near singular circulant matrix.")
        else:
            # Replace the small values with 1 to avoid errors in the
            # division fb/fc below.
            fc[near_zeros] = 1

    fb = np.fft.fft(np.moveaxis(b, baxis, -1), axis=-1)

    q = fb / fc

    if is_near_singular:
        # `near_zeros` is a boolean array, same shape as `c`, that is
        # True where `fc` is (near) zero. `q` is the broadcasted result
        # of fb / fc, so to set the values of `q` to 0 where `fc` is near
        # zero, we use a mask that is the broadcast result of an array
        # of True values shaped like `b` with `near_zeros`.
        mask = np.ones_like(b, dtype=bool) & near_zeros
        q[mask] = 0

    x = np.fft.ifft(q, axis=-1)
    if not (np.iscomplexobj(c) or np.iscomplexobj(b)):
        x = x.real
    if outaxis != -1:
        x = np.moveaxis(x, -1, outaxis)
    return x


# matrix inversion
@_apply_over_batch(('a', 2))
def inv(a, overwrite_a=False, check_finite=True):
    """
    Compute the inverse of a matrix.

    Parameters
    ----------
    a : array_like
        Square matrix to be inverted.
    overwrite_a : bool, optional
        Discard data in `a` (may improve performance). Default is False.
    check_finite : bool, optional
        Whether to check that the input matrix contains only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    ainv : ndarray
        Inverse of the matrix `a`.

    Raises
    ------
    LinAlgError
        If `a` is singular.
    ValueError
        If `a` is not square, or not 2D.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import linalg
    >>> a = np.array([[1., 2.], [3., 4.]])
    >>> linalg.inv(a)
    array([[-2. ,  1. ],
           [ 1.5, -0.5]])
    >>> np.dot(a, linalg.inv(a))
    array([[ 1.,  0.],
           [ 0.,  1.]])

    """
    a1 = _asarray_validated(a, check_finite=check_finite)
    if len(a1.shape) != 2 or a1.shape[0] != a1.shape[1]:
        raise ValueError('expected square matrix')

    # accommodate empty square matrices
    if a1.size == 0:
        dt = inv(np.eye(2, dtype=a1.dtype)).dtype
        return np.empty_like(a1, dtype=dt)

    overwrite_a = overwrite_a or _datacopied(a1, a)
    getrf, getri, getri_lwork = get_lapack_funcs(('getrf', 'getri',
                                                  'getri_lwork'),
                                                 (a1,))
    lu, piv, info = getrf(a1, overwrite_a=overwrite_a)
    if info == 0:
        lwork = _compute_lwork(getri_lwork, a1.shape[0])

        # XXX: the following line fixes curious SEGFAULT when
        # benchmarking 500x500 matrix inverse. This seems to
        # be a bug in LAPACK ?getri routine because if lwork is
        # minimal (when using lwork[0] instead of lwork[1]) then
        # all tests pass. Further investigation is required if
        # more such SEGFAULTs occur.
        lwork = int(1.01 * lwork)
        inv_a, info = getri(lu, piv, lwork=lwork, overwrite_lu=1)
    if info > 0:
        raise LinAlgError("singular matrix")
    if info < 0:
        raise ValueError(
            f'illegal value in {-info}-th argument of internal getrf|getri'
        )
    return inv_a


# Determinant

def det(a, overwrite_a=False, check_finite=True):
    """
    Compute the determinant of a matrix

    The determinant is a scalar that is a function of the associated square
    matrix coefficients. The determinant value is zero for singular matrices.

    Parameters
    ----------
    a : (..., M, M) array_like
        Input array to compute determinants for.
    overwrite_a : bool, optional
        Allow overwriting data in a (may enhance performance).
    check_finite : bool, optional
        Whether to check that the input matrix contains only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    det : (...) float or complex
        Determinant of `a`. For stacked arrays, a scalar is returned for each
        (m, m) slice in the last two dimensions of the input. For example, an
        input of shape (p, q, m, m) will produce a result of shape (p, q). If
        all dimensions are 1 a scalar is returned regardless of ndim.

    Notes
    -----
    The determinant is computed by performing an LU factorization of the
    input with LAPACK routine 'getrf', and then calculating the product of
    diagonal entries of the U factor.

    Even if the input array is single precision (float32 or complex64), the
    result will be returned in double precision (float64 or complex128) to
    prevent overflows.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import linalg
    >>> a = np.array([[1,2,3], [4,5,6], [7,8,9]])  # A singular matrix
    >>> linalg.det(a)
    0.0
    >>> b = np.array([[0,2,3], [4,5,6], [7,8,9]])
    >>> linalg.det(b)
    3.0
    >>> # An array with the shape (3, 2, 2, 2)
    >>> c = np.array([[[[1., 2.], [3., 4.]],
    ...                [[5., 6.], [7., 8.]]],
    ...               [[[9., 10.], [11., 12.]],
    ...                [[13., 14.], [15., 16.]]],
    ...               [[[17., 18.], [19., 20.]],
    ...                [[21., 22.], [23., 24.]]]])
    >>> linalg.det(c)  # The resulting shape is (3, 2)
    array([[-2., -2.],
           [-2., -2.],
           [-2., -2.]])
    >>> linalg.det(c[0, 0])  # Confirm the (0, 0) slice, [[1, 2], [3, 4]]
    -2.0
    """
    # The goal is to end up with a writable contiguous array to pass to Cython

    # First we check and make arrays.
    a1 = np.asarray_chkfinite(a) if check_finite else np.asarray(a)
    if a1.ndim < 2:
        raise ValueError('The input array must be at least two-dimensional.')
    if a1.shape[-1] != a1.shape[-2]:
        raise ValueError('Last 2 dimensions of the array must be square'
                         f' but received shape {a1.shape}.')

    # Also check if dtype is LAPACK compatible
    if a1.dtype.char not in 'fdFD':
        dtype_char = lapack_cast_dict[a1.dtype.char]
        if not dtype_char:  # No casting possible
            raise TypeError(f'The dtype "{a1.dtype.name}" cannot be cast '
                            'to float(32, 64) or complex(64, 128).')

        a1 = a1.astype(dtype_char[0])  # makes a copy, free to scratch
        overwrite_a = True

    # Empty array has determinant 1 because math.
    if min(*a1.shape) == 0:
        dtyp = np.float64 if a1.dtype.char not in 'FD' else np.complex128
        if a1.ndim == 2:
            return dtyp(1.0)
        else:
            return np.ones(shape=a1.shape[:-2], dtype=dtyp)

    # Scalar case
    if a1.shape[-2:] == (1, 1):
        a1 = a1[..., 0, 0]
        if a1.ndim == 0:
            a1 = a1[()]
        # Convert float32 to float64, and complex64 to complex128.
        if a1.dtype.char in 'dD':
            return a1
        return a1.astype('d') if a1.dtype.char == 'f' else a1.astype('D')

    # Then check overwrite permission
    if not _datacopied(a1, a):  # "a"  still alive through "a1"
        if not overwrite_a:
            # Data belongs to "a" so make a copy
            a1 = a1.copy(order='C')
        #  else: Do nothing we'll use "a" if possible
    # else:  a1 has its own data thus free to scratch

    # Then layout checks, might happen that overwrite is allowed but original
    # array was read-only or non-C-contiguous.
    if not (a1.flags['C_CONTIGUOUS'] and a1.flags['WRITEABLE']):
        a1 = a1.copy(order='C')

    if a1.ndim == 2:
        det = find_det_from_lu(a1)
        # Convert float, complex to NumPy scalars
        return (np.float64(det) if np.isrealobj(det) else np.complex128(det))

    # loop over the stacked array, and avoid overflows for single precision
    # Cf. np.linalg.det(np.diag([1e+38, 1e+38]).astype(np.float32))
    dtype_char = a1.dtype.char
    if dtype_char in 'fF':
        dtype_char = 'd' if dtype_char.islower() else 'D'

    det = np.empty(a1.shape[:-2], dtype=dtype_char)
    for ind in product(*[range(x) for x in a1.shape[:-2]]):
        det[ind] = find_det_from_lu(a1[ind])
    return det


# Linear Least Squares
@_apply_over_batch(('a', 2), ('b', '1|2'))
def lstsq(a, b, cond=None, overwrite_a=False, overwrite_b=False,
          check_finite=True, lapack_driver=None):
    """
    Compute least-squares solution to the equation ``a @ x = b``.

    Compute a vector x such that the 2-norm ``|b - A x|`` is minimized.

    Parameters
    ----------
    a : (M, N) array_like
        Left-hand side array
    b : (M,) or (M, K) array_like
        Right hand side array
    cond : float, optional
        Cutoff for 'small' singular values; used to determine effective
        rank of a. Singular values smaller than
        ``cond * largest_singular_value`` are considered zero.
    overwrite_a : bool, optional
        Discard data in `a` (may enhance performance). Default is False.
    overwrite_b : bool, optional
        Discard data in `b` (may enhance performance). Default is False.
    check_finite : bool, optional
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.
    lapack_driver : str, optional
        Which LAPACK driver is used to solve the least-squares problem.
        Options are ``'gelsd'``, ``'gelsy'``, ``'gelss'``. Default
        (``'gelsd'``) is a good choice.  However, ``'gelsy'`` can be slightly
        faster on many problems.  ``'gelss'`` was used historically.  It is
        generally slow but uses less memory.

        .. versionadded:: 0.17.0

    Returns
    -------
    x : (N,) or (N, K) ndarray
        Least-squares solution.
    residues : (K,) ndarray or float
        Square of the 2-norm for each column in ``b - a x``, if ``M > N`` and
        ``rank(A) == n`` (returns a scalar if ``b`` is 1-D). Otherwise a
        (0,)-shaped array is returned.
    rank : int
        Effective rank of `a`.
    s : (min(M, N),) ndarray or None
        Singular values of `a`. The condition number of ``a`` is
        ``s[0] / s[-1]``.

    Raises
    ------
    LinAlgError
        If computation does not converge.

    ValueError
        When parameters are not compatible.

    See Also
    --------
    scipy.optimize.nnls : linear least squares with non-negativity constraint

    Notes
    -----
    When ``'gelsy'`` is used as a driver, `residues` is set to a (0,)-shaped
    array and `s` is always ``None``.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import lstsq
    >>> import matplotlib.pyplot as plt

    Suppose we have the following data:

    >>> x = np.array([1, 2.5, 3.5, 4, 5, 7, 8.5])
    >>> y = np.array([0.3, 1.1, 1.5, 2.0, 3.2, 6.6, 8.6])

    We want to fit a quadratic polynomial of the form ``y = a + b*x**2``
    to this data.  We first form the "design matrix" M, with a constant
    column of 1s and a column containing ``x**2``:

    >>> M = x[:, np.newaxis]**[0, 2]
    >>> M
    array([[  1.  ,   1.  ],
           [  1.  ,   6.25],
           [  1.  ,  12.25],
           [  1.  ,  16.  ],
           [  1.  ,  25.  ],
           [  1.  ,  49.  ],
           [  1.  ,  72.25]])

    We want to find the least-squares solution to ``M.dot(p) = y``,
    where ``p`` is a vector with length 2 that holds the parameters
    ``a`` and ``b``.

    >>> p, res, rnk, s = lstsq(M, y)
    >>> p
    array([ 0.20925829,  0.12013861])

    Plot the data and the fitted curve.

    >>> plt.plot(x, y, 'o', label='data')
    >>> xx = np.linspace(0, 9, 101)
    >>> yy = p[0] + p[1]*xx**2
    >>> plt.plot(xx, yy, label='least squares fit, $y = a + bx^2$')
    >>> plt.xlabel('x')
    >>> plt.ylabel('y')
    >>> plt.legend(framealpha=1, shadow=True)
    >>> plt.grid(alpha=0.25)
    >>> plt.show()

    """
    a1 = _asarray_validated(a, check_finite=check_finite)
    b1 = _asarray_validated(b, check_finite=check_finite)
    if len(a1.shape) != 2:
        raise ValueError('Input array a should be 2D')
    m, n = a1.shape
    if len(b1.shape) == 2:
        nrhs = b1.shape[1]
    else:
        nrhs = 1
    if m != b1.shape[0]:
        raise ValueError('Shape mismatch: a and b should have the same number'
                         f' of rows ({m} != {b1.shape[0]}).')
    if m == 0 or n == 0:  # Zero-sized problem, confuses LAPACK
        x = np.zeros((n,) + b1.shape[1:], dtype=np.common_type(a1, b1))
        if n == 0:
            residues = np.linalg.norm(b1, axis=0)**2
        else:
            residues = np.empty((0,))
        return x, residues, 0, np.empty((0,))

    driver = lapack_driver
    if driver is None:
        driver = lstsq.default_lapack_driver
    if driver not in ('gelsd', 'gelsy', 'gelss'):
        raise ValueError(f'LAPACK driver "{driver}" is not found')

    lapack_func, lapack_lwork = get_lapack_funcs((driver,
                                                 f'{driver}_lwork'),
                                                 (a1, b1))
    real_data = True if (lapack_func.dtype.kind == 'f') else False

    if m < n:
        # need to extend b matrix as it will be filled with
        # a larger solution matrix
        if len(b1.shape) == 2:
            b2 = np.zeros((n, nrhs), dtype=lapack_func.dtype)
            b2[:m, :] = b1
        else:
            b2 = np.zeros(n, dtype=lapack_func.dtype)
            b2[:m] = b1
        b1 = b2

    overwrite_a = overwrite_a or _datacopied(a1, a)
    overwrite_b = overwrite_b or _datacopied(b1, b)

    if cond is None:
        cond = np.finfo(lapack_func.dtype).eps

    if driver in ('gelss', 'gelsd'):
        if driver == 'gelss':
            lwork = _compute_lwork(lapack_lwork, m, n, nrhs, cond)
            v, x, s, rank, work, info = lapack_func(a1, b1, cond, lwork,
                                                    overwrite_a=overwrite_a,
                                                    overwrite_b=overwrite_b)

        elif driver == 'gelsd':
            if real_data:
                lwork, iwork = _compute_lwork(lapack_lwork, m, n, nrhs, cond)
                x, s, rank, info = lapack_func(a1, b1, lwork,
                                               iwork, cond, False, False)
            else:  # complex data
                lwork, rwork, iwork = _compute_lwork(lapack_lwork, m, n,
                                                     nrhs, cond)
                x, s, rank, info = lapack_func(a1, b1, lwork, rwork, iwork,
                                               cond, False, False)
        if info > 0:
            raise LinAlgError("SVD did not converge in Linear Least Squares")
        if info < 0:
            raise ValueError(
                f'illegal value in {-info}-th argument of internal {lapack_driver}'
            )
        resids = np.asarray([], dtype=x.dtype)
        if m > n:
            x1 = x[:n]
            if rank == n:
                resids = np.sum(np.abs(x[n:])**2, axis=0)
            x = x1
        return x, resids, rank, s

    elif driver == 'gelsy':
        lwork = _compute_lwork(lapack_lwork, m, n, nrhs, cond)
        jptv = np.zeros((a1.shape[1], 1), dtype=np.int32)
        v, x, j, rank, info = lapack_func(a1, b1, jptv, cond,
                                          lwork, False, False)
        if info < 0:
            raise ValueError(f'illegal value in {-info}-th argument of internal gelsy')
        if m > n:
            x1 = x[:n]
            x = x1
        return x, np.array([], x.dtype), rank, None


lstsq.default_lapack_driver = 'gelsd'


@_apply_over_batch(('a', 2))
def pinv(a, *, atol=None, rtol=None, return_rank=False, check_finite=True):
    """
    Compute the (Moore-Penrose) pseudo-inverse of a matrix.

    Calculate a generalized inverse of a matrix using its
    singular-value decomposition ``U @ S @ V`` in the economy mode and picking
    up only the columns/rows that are associated with significant singular
    values.

    If ``s`` is the maximum singular value of ``a``, then the
    significance cut-off value is determined by ``atol + rtol * s``. Any
    singular value below this value is assumed insignificant.

    Parameters
    ----------
    a : (M, N) array_like
        Matrix to be pseudo-inverted.
    atol : float, optional
        Absolute threshold term, default value is 0.

        .. versionadded:: 1.7.0

    rtol : float, optional
        Relative threshold term, default value is ``max(M, N) * eps`` where
        ``eps`` is the machine precision value of the datatype of ``a``.

        .. versionadded:: 1.7.0

    return_rank : bool, optional
        If True, return the effective rank of the matrix.
    check_finite : bool, optional
        Whether to check that the input matrix contains only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    B : (N, M) ndarray
        The pseudo-inverse of matrix `a`.
    rank : int
        The effective rank of the matrix. Returned if `return_rank` is True.

    Raises
    ------
    LinAlgError
        If SVD computation does not converge.

    See Also
    --------
    pinvh : Moore-Penrose pseudoinverse of a hermitian matrix.

    Notes
    -----
    If ``A`` is invertible then the Moore-Penrose pseudoinverse is exactly
    the inverse of ``A`` [1]_. If ``A`` is not invertible then the
    Moore-Penrose pseudoinverse computes the ``x`` solution to ``Ax = b`` such
    that ``||Ax - b||`` is minimized [1]_.

    References
    ----------
    .. [1] Penrose, R. (1956). On best approximate solutions of linear matrix
           equations. Mathematical Proceedings of the Cambridge Philosophical
           Society, 52(1), 17-19. doi:10.1017/S0305004100030929

    Examples
    --------

    Given an ``m x n`` matrix ``A`` and an ``n x m`` matrix ``B`` the four
    Moore-Penrose conditions are:

    1. ``ABA = A`` (``B`` is a generalized inverse of ``A``),
    2. ``BAB = B`` (``A`` is a generalized inverse of ``B``),
    3. ``(AB)* = AB`` (``AB`` is hermitian),
    4. ``(BA)* = BA`` (``BA`` is hermitian) [1]_.

    Here, ``A*`` denotes the conjugate transpose. The Moore-Penrose
    pseudoinverse is a unique ``B`` that satisfies all four of these
    conditions and exists for any ``A``. Note that, unlike the standard
    matrix inverse, ``A`` does not have to be a square matrix or have
    linearly independent columns/rows.

    As an example, we can calculate the Moore-Penrose pseudoinverse of a
    random non-square matrix and verify it satisfies the four conditions.

    >>> import numpy as np
    >>> from scipy import linalg
    >>> rng = np.random.default_rng()
    >>> A = rng.standard_normal((9, 6))
    >>> B = linalg.pinv(A)
    >>> np.allclose(A @ B @ A, A)  # Condition 1
    True
    >>> np.allclose(B @ A @ B, B)  # Condition 2
    True
    >>> np.allclose((A @ B).conj().T, A @ B)  # Condition 3
    True
    >>> np.allclose((B @ A).conj().T, B @ A)  # Condition 4
    True

    """
    a = _asarray_validated(a, check_finite=check_finite)
    u, s, vh = _decomp_svd.svd(a, full_matrices=False, check_finite=False)
    t = u.dtype.char.lower()
    maxS = np.max(s, initial=0.)

    atol = 0. if atol is None else atol
    rtol = max(a.shape) * np.finfo(t).eps if (rtol is None) else rtol

    if (atol < 0.) or (rtol < 0.):
        raise ValueError("atol and rtol values must be positive.")

    val = atol + maxS * rtol
    rank = np.sum(s > val)

    u = u[:, :rank]
    u /= s[:rank]
    B = (u @ vh[:rank]).conj().T

    if return_rank:
        return B, rank
    else:
        return B


@_apply_over_batch(('a', 2))
def pinvh(a, atol=None, rtol=None, lower=True, return_rank=False,
          check_finite=True):
    """
    Compute the (Moore-Penrose) pseudo-inverse of a Hermitian matrix.

    Calculate a generalized inverse of a complex Hermitian/real symmetric
    matrix using its eigenvalue decomposition and including all eigenvalues
    with 'large' absolute value.

    Parameters
    ----------
    a : (N, N) array_like
        Real symmetric or complex hermetian matrix to be pseudo-inverted

    atol : float, optional
        Absolute threshold term, default value is 0.

        .. versionadded:: 1.7.0

    rtol : float, optional
        Relative threshold term, default value is ``N * eps`` where
        ``eps`` is the machine precision value of the datatype of ``a``.

        .. versionadded:: 1.7.0

    lower : bool, optional
        Whether the pertinent array data is taken from the lower or upper
        triangle of `a`. (Default: lower)
    return_rank : bool, optional
        If True, return the effective rank of the matrix.
    check_finite : bool, optional
        Whether to check that the input matrix contains only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    B : (N, N) ndarray
        The pseudo-inverse of matrix `a`.
    rank : int
        The effective rank of the matrix.  Returned if `return_rank` is True.

    Raises
    ------
    LinAlgError
        If eigenvalue algorithm does not converge.

    See Also
    --------
    pinv : Moore-Penrose pseudoinverse of a matrix.

    Examples
    --------

    For a more detailed example see `pinv`.

    >>> import numpy as np
    >>> from scipy.linalg import pinvh
    >>> rng = np.random.default_rng()
    >>> a = rng.standard_normal((9, 6))
    >>> a = np.dot(a, a.T)
    >>> B = pinvh(a)
    >>> np.allclose(a, a @ B @ a)
    True
    >>> np.allclose(B, B @ a @ B)
    True

    """
    a = _asarray_validated(a, check_finite=check_finite)
    s, u = _decomp.eigh(a, lower=lower, check_finite=False, driver='ev')
    t = u.dtype.char.lower()
    maxS = np.max(np.abs(s), initial=0.)

    atol = 0. if atol is None else atol
    rtol = max(a.shape) * np.finfo(t).eps if (rtol is None) else rtol

    if (atol < 0.) or (rtol < 0.):
        raise ValueError("atol and rtol values must be positive.")

    val = atol + maxS * rtol
    above_cutoff = (abs(s) > val)

    psigma_diag = 1.0 / s[above_cutoff]
    u = u[:, above_cutoff]

    B = (u * psigma_diag) @ u.conj().T

    if return_rank:
        return B, len(psigma_diag)
    else:
        return B


@_apply_over_batch(('A', 2))
def matrix_balance(A, permute=True, scale=True, separate=False,
                   overwrite_a=False):
    """
    Compute a diagonal similarity transformation for row/column balancing.

    The balancing tries to equalize the row and column 1-norms by applying
    a similarity transformation such that the magnitude variation of the
    matrix entries is reflected to the scaling matrices.

    Moreover, if enabled, the matrix is first permuted to isolate the upper
    triangular parts of the matrix and, again if scaling is also enabled,
    only the remaining subblocks are subjected to scaling.

    Parameters
    ----------
    A : (n, n) array_like
        Square data matrix for the balancing.
    permute : bool, optional
        The selector to define whether permutation of A is also performed
        prior to scaling.
    scale : bool, optional
        The selector to turn on and off the scaling. If False, the matrix
        will not be scaled.
    separate : bool, optional
        This switches from returning a full matrix of the transformation
        to a tuple of two separate 1-D permutation and scaling arrays.
    overwrite_a : bool, optional
        This is passed to xGEBAL directly. Essentially, overwrites the result
        to the data. It might increase the space efficiency. See LAPACK manual
        for details. This is False by default.

    Returns
    -------
    B : (n, n) ndarray
        Balanced matrix
    T : (n, n) ndarray
        A possibly permuted diagonal matrix whose nonzero entries are
        integer powers of 2 to avoid numerical truncation errors.
    scale, perm : (n,) ndarray
        If ``separate`` keyword is set to True then instead of the array
        ``T`` above, the scaling and the permutation vectors are given
        separately as a tuple without allocating the full array ``T``.

    Notes
    -----
    The balanced matrix satisfies the following equality

    .. math::
        B = T^{-1} A T

    The scaling coefficients are approximated to the nearest power of 2
    to avoid round-off errors.

    This algorithm is particularly useful for eigenvalue and matrix
    decompositions and in many cases it is already called by various
    LAPACK routines.

    The algorithm is based on the well-known technique of [1]_ and has
    been modified to account for special cases. See [2]_ for details
    which have been implemented since LAPACK v3.5.0. Before this version
    there are corner cases where balancing can actually worsen the
    conditioning. See [3]_ for such examples.

    The code is a wrapper around LAPACK's xGEBAL routine family for matrix
    balancing.

    .. versionadded:: 0.19.0

    References
    ----------
    .. [1] B.N. Parlett and C. Reinsch, "Balancing a Matrix for
       Calculation of Eigenvalues and Eigenvectors", Numerische Mathematik,
       Vol.13(4), 1969, :doi:`10.1007/BF02165404`
    .. [2] R. James, J. Langou, B.R. Lowery, "On matrix balancing and
       eigenvector computation", 2014, :arxiv:`1401.5766`
    .. [3] D.S. Watkins. A case where balancing is harmful.
       Electron. Trans. Numer. Anal, Vol.23, 2006.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import linalg
    >>> x = np.array([[1,2,0], [9,1,0.01], [1,2,10*np.pi]])

    >>> y, permscale = linalg.matrix_balance(x)
    >>> np.abs(x).sum(axis=0) / np.abs(x).sum(axis=1)
    array([ 3.66666667,  0.4995005 ,  0.91312162])

    >>> np.abs(y).sum(axis=0) / np.abs(y).sum(axis=1)
    array([ 1.2       ,  1.27041742,  0.92658316])  # may vary

    >>> permscale  # only powers of 2 (0.5 == 2^(-1))
    array([[  0.5,   0. ,  0. ],  # may vary
           [  0. ,   1. ,  0. ],
           [  0. ,   0. ,  1. ]])

    """

    A = np.atleast_2d(_asarray_validated(A, check_finite=True))

    if not np.equal(*A.shape):
        raise ValueError('The data matrix for balancing should be square.')

    # accommodate empty arrays
    if A.size == 0:
        b_n, t_n = matrix_balance(np.eye(2, dtype=A.dtype))
        B = np.empty_like(A, dtype=b_n.dtype)
        if separate:
            scaling = np.ones_like(A, shape=len(A))
            perm = np.arange(len(A))
            return B, (scaling, perm)
        return B, np.empty_like(A, dtype=t_n.dtype)

    gebal = get_lapack_funcs(('gebal'), (A,))
    B, lo, hi, ps, info = gebal(A, scale=scale, permute=permute,
                                overwrite_a=overwrite_a)

    if info < 0:
        raise ValueError('xGEBAL exited with the internal error '
                         f'"illegal value in argument number {-info}.". See '
                         'LAPACK documentation for the xGEBAL error codes.')

    # Separate the permutations from the scalings and then convert to int
    scaling = np.ones_like(ps, dtype=float)
    scaling[lo:hi+1] = ps[lo:hi+1]

    # gebal uses 1-indexing
    ps = ps.astype(int, copy=False) - 1
    n = A.shape[0]
    perm = np.arange(n)

    # LAPACK permutes with the ordering n --> hi, then 0--> lo
    if hi < n:
        for ind, x in enumerate(ps[hi+1:][::-1], 1):
            if n-ind == x:
                continue
            perm[[x, n-ind]] = perm[[n-ind, x]]

    if lo > 0:
        for ind, x in enumerate(ps[:lo]):
            if ind == x:
                continue
            perm[[x, ind]] = perm[[ind, x]]

    if separate:
        return B, (scaling, perm)

    # get the inverse permutation
    iperm = np.empty_like(perm)
    iperm[perm] = np.arange(n)

    return B, np.diag(scaling)[iperm, :]


def _validate_args_for_toeplitz_ops(c_or_cr, b, check_finite, keep_b_shape,
                                    enforce_square=True):
    """Validate arguments and format inputs for toeplitz functions

    Parameters
    ----------
    c_or_cr : array_like or tuple of (array_like, array_like)
        The vector ``c``, or a tuple of arrays (``c``, ``r``). Whatever the
        actual shape of ``c``, it will be converted to a 1-D array. If not
        supplied, ``r = conjugate(c)`` is assumed; in this case, if c[0] is
        real, the Toeplitz matrix is Hermitian. r[0] is ignored; the first row
        of the Toeplitz matrix is ``[c[0], r[1:]]``. Whatever the actual shape
        of ``r``, it will be converted to a 1-D array.
    b : (M,) or (M, K) array_like
        Right-hand side in ``T x = b``.
    check_finite : bool
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (result entirely NaNs) if the inputs do contain infinities or NaNs.
    keep_b_shape : bool
        Whether to convert a (M,) dimensional b into a (M, 1) dimensional
        matrix.
    enforce_square : bool, optional
        If True (default), this verifies that the Toeplitz matrix is square.

    Returns
    -------
    r : array
        1d array corresponding to the first row of the Toeplitz matrix.
    c: array
        1d array corresponding to the first column of the Toeplitz matrix.
    b: array
        (M,), (M, 1) or (M, K) dimensional array, post validation,
        corresponding to ``b``.
    dtype: numpy datatype
        ``dtype`` stores the datatype of ``r``, ``c`` and ``b``. If any of
        ``r``, ``c`` or ``b`` are complex, ``dtype`` is ``np.complex128``,
        otherwise, it is ``np.float``.
    b_shape: tuple
        Shape of ``b`` after passing it through ``_asarray_validated``.

    """

    if isinstance(c_or_cr, tuple):
        c, r = c_or_cr
        c = _asarray_validated(c, check_finite=check_finite)
        r = _asarray_validated(r, check_finite=check_finite)
    else:
        c = _asarray_validated(c_or_cr, check_finite=check_finite)
        r = c.conjugate()

    if c.ndim > 1 or r.ndim > 1:
        msg = ("Beginning in SciPy 1.17, multidimensional input will be treated as a "
               "batch, not `ravel`ed. To preserve the existing behavior and silence "
               "this warning, `ravel` arguments before passing them to "
               "`toeplitz`, `matmul_toeplitz`, and `solve_toeplitz`.")
        warnings.warn(msg, FutureWarning, stacklevel=2)
        c = c.ravel()
        r = r.ravel()

    if b is None:
        raise ValueError('`b` must be an array, not None.')

    b = _asarray_validated(b, check_finite=check_finite)
    b_shape = b.shape

    is_not_square = r.shape[0] != c.shape[0]
    if (enforce_square and is_not_square) or b.shape[0] != r.shape[0]:
        raise ValueError('Incompatible dimensions.')

    is_cmplx = np.iscomplexobj(r) or np.iscomplexobj(c) or np.iscomplexobj(b)
    dtype = np.complex128 if is_cmplx else np.float64
    r, c, b = (np.asarray(i, dtype=dtype) for i in (r, c, b))

    if b.ndim == 1 and not keep_b_shape:
        b = b.reshape(-1, 1)
    elif b.ndim != 1:
        b = b.reshape(b.shape[0], -1 if b.size > 0 else 0)

    return r, c, b, dtype, b_shape


def matmul_toeplitz(c_or_cr, x, check_finite=False, workers=None):
    r"""Efficient Toeplitz Matrix-Matrix Multiplication using FFT

    This function returns the matrix multiplication between a Toeplitz
    matrix and a dense matrix.

    The Toeplitz matrix has constant diagonals, with c as its first column
    and r as its first row. If r is not given, ``r == conjugate(c)`` is
    assumed.

    .. warning::

        Beginning in SciPy 1.17, multidimensional input will be treated as a batch,
        not ``ravel``\ ed. To preserve the existing behavior, ``ravel`` arguments
        before passing them to `matmul_toeplitz`.

    Parameters
    ----------
    c_or_cr : array_like or tuple of (array_like, array_like)
        The vector ``c``, or a tuple of arrays (``c``, ``r``). If not
        supplied, ``r = conjugate(c)`` is assumed; in this case, if c[0] is
        real, the Toeplitz matrix is Hermitian. r[0] is ignored; the first row
        of the Toeplitz matrix is ``[c[0], r[1:]]``.
    x : (M,) or (M, K) array_like
        Matrix with which to multiply.
    check_finite : bool, optional
        Whether to check that the input matrices contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (result entirely NaNs) if the inputs do contain infinities or NaNs.
    workers : int, optional
        To pass to scipy.fft.fft and ifft. Maximum number of workers to use
        for parallel computation. If negative, the value wraps around from
        ``os.cpu_count()``. See scipy.fft.fft for more details.

    Returns
    -------
    T @ x : (M,) or (M, K) ndarray
        The result of the matrix multiplication ``T @ x``. Shape of return
        matches shape of `x`.

    See Also
    --------
    toeplitz : Toeplitz matrix
    solve_toeplitz : Solve a Toeplitz system using Levinson Recursion

    Notes
    -----
    The Toeplitz matrix is embedded in a circulant matrix and the FFT is used
    to efficiently calculate the matrix-matrix product.

    Because the computation is based on the FFT, integer inputs will
    result in floating point outputs.  This is unlike NumPy's `matmul`,
    which preserves the data type of the input.

    This is partly based on the implementation that can be found in [1]_,
    licensed under the MIT license. More information about the method can be
    found in reference [2]_. References [3]_ and [4]_ have more reference
    implementations in Python.

    .. versionadded:: 1.6.0

    References
    ----------
    .. [1] Jacob R Gardner, Geoff Pleiss, David Bindel, Kilian
       Q Weinberger, Andrew Gordon Wilson, "GPyTorch: Blackbox Matrix-Matrix
       Gaussian Process Inference with GPU Acceleration" with contributions
       from Max Balandat and Ruihan Wu. Available online:
       https://github.com/cornellius-gp/gpytorch

    .. [2] J. Demmel, P. Koev, and X. Li, "A Brief Survey of Direct Linear
       Solvers". In Z. Bai, J. Demmel, J. Dongarra, A. Ruhe, and H. van der
       Vorst, editors. Templates for the Solution of Algebraic Eigenvalue
       Problems: A Practical Guide. SIAM, Philadelphia, 2000. Available at:
       http://www.netlib.org/utk/people/JackDongarra/etemplates/node384.html

    .. [3] R. Scheibler, E. Bezzam, I. Dokmanic, Pyroomacoustics: A Python
       package for audio room simulations and array processing algorithms,
       Proc. IEEE ICASSP, Calgary, CA, 2018.
       https://github.com/LCAV/pyroomacoustics/blob/pypi-release/
       pyroomacoustics/adaptive/util.py

    .. [4] Marano S, Edwards B, Ferrari G and Fah D (2017), "Fitting
       Earthquake Spectra: Colored Noise and Incomplete Data", Bulletin of
       the Seismological Society of America., January, 2017. Vol. 107(1),
       pp. 276-291.

    Examples
    --------
    Multiply the Toeplitz matrix T with matrix x::

            [ 1 -1 -2 -3]       [1 10]
        T = [ 3  1 -1 -2]   x = [2 11]
            [ 6  3  1 -1]       [2 11]
            [10  6  3  1]       [5 19]

    To specify the Toeplitz matrix, only the first column and the first
    row are needed.

    >>> import numpy as np
    >>> c = np.array([1, 3, 6, 10])    # First column of T
    >>> r = np.array([1, -1, -2, -3])  # First row of T
    >>> x = np.array([[1, 10], [2, 11], [2, 11], [5, 19]])

    >>> from scipy.linalg import toeplitz, matmul_toeplitz
    >>> matmul_toeplitz((c, r), x)
    array([[-20., -80.],
           [ -7.,  -8.],
           [  9.,  85.],
           [ 33., 218.]])

    Check the result by creating the full Toeplitz matrix and
    multiplying it by ``x``.

    >>> toeplitz(c, r) @ x
    array([[-20, -80],
           [ -7,  -8],
           [  9,  85],
           [ 33, 218]])

    The full matrix is never formed explicitly, so this routine
    is suitable for very large Toeplitz matrices.

    >>> n = 1000000
    >>> matmul_toeplitz([1] + [0]*(n-1), np.ones(n))
    array([1., 1., 1., ..., 1., 1., 1.], shape=(1000000,))

    """

    from ..fft import fft, ifft, rfft, irfft

    r, c, x, dtype, x_shape = _validate_args_for_toeplitz_ops(
        c_or_cr, x, check_finite, keep_b_shape=False, enforce_square=False)
    n, m = x.shape

    T_nrows = len(c)
    T_ncols = len(r)
    p = T_nrows + T_ncols - 1  # equivalent to len(embedded_col)
    return_shape = (T_nrows,) if len(x_shape) == 1 else (T_nrows, m)

    # accommodate empty arrays
    if x.size == 0:
        return np.empty_like(x, shape=return_shape)

    embedded_col = np.concatenate((c, r[-1:0:-1]))

    if np.iscomplexobj(embedded_col) or np.iscomplexobj(x):
        fft_mat = fft(embedded_col, axis=0, workers=workers).reshape(-1, 1)
        fft_x = fft(x, n=p, axis=0, workers=workers)

        mat_times_x = ifft(fft_mat*fft_x, axis=0,
                           workers=workers)[:T_nrows, :]
    else:
        # Real inputs; using rfft is faster
        fft_mat = rfft(embedded_col, axis=0, workers=workers).reshape(-1, 1)
        fft_x = rfft(x, n=p, axis=0, workers=workers)

        mat_times_x = irfft(fft_mat*fft_x, axis=0,
                            workers=workers, n=p)[:T_nrows, :]

    return mat_times_x.reshape(*return_shape)
