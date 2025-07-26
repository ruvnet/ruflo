"""Schur decomposition functions."""
import numpy as np
from numpy import asarray_chkfinite, single, asarray, array
from numpy.linalg import norm

from scipy._lib._util import _apply_over_batch
# Local imports.
from ._misc import LinAlgError, _datacopied
from .lapack import get_lapack_funcs
from ._decomp import eigvals

__all__ = ['schur', 'rsf2csf']

_double_precision = ['i', 'l', 'd']


@_apply_over_batch(('a', 2))
def schur(a, output='real', lwork=None, overwrite_a=False, sort=None,
          check_finite=True):
    """
    Compute Schur decomposition of a matrix.

    The Schur decomposition is::

        A = Z T Z^H

    where Z is unitary and T is either upper-triangular, or for real
    Schur decomposition (output='real'), quasi-upper triangular. In
    the quasi-triangular form, 2x2 blocks describing complex-valued
    eigenvalue pairs may extrude from the diagonal.

    Parameters
    ----------
    a : (M, M) array_like
        Matrix to decompose
    output : {'real', 'complex'}, optional
        When the dtype of `a` is real, this specifies whether to compute
        the real or complex Schur decomposition.
        When the dtype of `a` is complex, this argument is ignored, and the
        complex Schur decomposition is computed.
    lwork : int, optional
        Work array size. If None or -1, it is automatically computed.
    overwrite_a : bool, optional
        Whether to overwrite data in a (may improve performance).
    sort : {None, callable, 'lhp', 'rhp', 'iuc', 'ouc'}, optional
        Specifies whether the upper eigenvalues should be sorted. A callable
        may be passed that, given an eigenvalue, returns a boolean denoting
        whether the eigenvalue should be sorted to the top-left (True).

        - If ``output='complex'`` OR the dtype of `a` is complex, the callable
          should have one argument: the eigenvalue expressed as a complex number.
        - If ``output='real'`` AND the dtype of `a` is real, the callable should have
          two arguments: the real and imaginary parts of the eigenvalue, respectively.

        Alternatively, string parameters may be used::

            'lhp'   Left-hand plane (real(eigenvalue) < 0.0)
            'rhp'   Right-hand plane (real(eigenvalue) >= 0.0)
            'iuc'   Inside the unit circle (abs(eigenvalue) <= 1.0)
            'ouc'   Outside the unit circle (abs(eigenvalue) > 1.0)

        Defaults to None (no sorting).
    check_finite : bool, optional
        Whether to check that the input matrix contains only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    T : (M, M) ndarray
        Schur form of A. It is real-valued for the real Schur decomposition.
    Z : (M, M) ndarray
        An unitary Schur transformation matrix for A.
        It is real-valued for the real Schur decomposition.
    sdim : int
        If and only if sorting was requested, a third return value will
        contain the number of eigenvalues satisfying the sort condition.
        Note that complex conjugate pairs for which the condition is true
        for either eigenvalue count as 2.

    Raises
    ------
    LinAlgError
        Error raised under three conditions:

        1. The algorithm failed due to a failure of the QR algorithm to
           compute all eigenvalues.
        2. If eigenvalue sorting was requested, the eigenvalues could not be
           reordered due to a failure to separate eigenvalues, usually because
           of poor conditioning.
        3. If eigenvalue sorting was requested, roundoff errors caused the
           leading eigenvalues to no longer satisfy the sorting condition.

    See Also
    --------
    rsf2csf : Convert real Schur form to complex Schur form

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import schur, eigvals
    >>> A = np.array([[0, 2, 2], [0, 1, 2], [1, 0, 1]])
    >>> T, Z = schur(A)
    >>> T
    array([[ 2.65896708,  1.42440458, -1.92933439],
           [ 0.        , -0.32948354, -0.49063704],
           [ 0.        ,  1.31178921, -0.32948354]])
    >>> Z
    array([[0.72711591, -0.60156188, 0.33079564],
           [0.52839428, 0.79801892, 0.28976765],
           [0.43829436, 0.03590414, -0.89811411]])

    >>> T2, Z2 = schur(A, output='complex')
    >>> T2
    array([[ 2.65896708, -1.22839825+1.32378589j,  0.42590089+1.51937378j], # may vary
           [ 0.        , -0.32948354+0.80225456j, -0.59877807+0.56192146j],
           [ 0.        ,  0.                    , -0.32948354-0.80225456j]])
    >>> eigvals(T2)
    array([2.65896708, -0.32948354+0.80225456j, -0.32948354-0.80225456j])   # may vary

    A custom eigenvalue-sorting condition that sorts by positive imaginary part
    is satisfied by only one eigenvalue.

    >>> _, _, sdim = schur(A, output='complex', sort=lambda x: x.imag > 1e-15)
    >>> sdim
    1

    When ``output='real'`` and the array `a` is real, the `sort` callable must accept
    the real and imaginary parts as separate arguments. Note that now the complex
    eigenvalues ``-0.32948354+0.80225456j`` and ``-0.32948354-0.80225456j`` will be
    treated as a complex conjugate pair, and according to the `sdim` documentation,
    complex conjugate pairs for which the condition is True for *either* eigenvalue
    increase `sdim` by *two*.

    >>> _, _, sdim = schur(A, output='real', sort=lambda x, y: y > 1e-15)
    >>> sdim
    2

    """
    if output not in ['real', 'complex', 'r', 'c']:
        raise ValueError("argument must be 'real', or 'complex'")
    if check_finite:
        a1 = asarray_chkfinite(a)
    else:
        a1 = asarray(a)
    if np.issubdtype(a1.dtype, np.integer):
        a1 = asarray(a, dtype=np.dtype("long"))
    if len(a1.shape) != 2 or (a1.shape[0] != a1.shape[1]):
        raise ValueError('expected square matrix')

    typ = a1.dtype.char
    if output in ['complex', 'c'] and typ not in ['F', 'D']:
        if typ in _double_precision:
            a1 = a1.astype('D')
        else:
            a1 = a1.astype('F')

    # accommodate empty matrix
    if a1.size == 0:
        t0, z0 = schur(np.eye(2, dtype=a1.dtype))
        if sort is None:
            return (np.empty_like(a1, dtype=t0.dtype),
                    np.empty_like(a1, dtype=z0.dtype))
        else:
            return (np.empty_like(a1, dtype=t0.dtype),
                    np.empty_like(a1, dtype=z0.dtype), 0)

    overwrite_a = overwrite_a or (_datacopied(a1, a))
    gees, = get_lapack_funcs(('gees',), (a1,))
    if lwork is None or lwork == -1:
        # get optimal work array
        result = gees(lambda x: None, a1, lwork=-1)
        lwork = result[-2][0].real.astype(np.int_)

    if sort is None:
        sort_t = 0
        def sfunction(x, y=None):
            return None
    else:
        sort_t = 1
        if callable(sort):
            sfunction = sort
        elif sort == 'lhp':
            def sfunction(x, y=None):
                return x.real < 0.0
        elif sort == 'rhp':
            def sfunction(x, y=None):
                return x.real >= 0.0
        elif sort == 'iuc':
            def sfunction(x, y=None):
                z = x if y is None else x + y*1j
                return abs(z) <= 1.0
        elif sort == 'ouc':
            def sfunction(x, y=None):
                z = x if y is None else x + y*1j
                return abs(z) > 1.0
        else:
            raise ValueError("'sort' parameter must either be 'None', or a "
                             "callable, or one of ('lhp','rhp','iuc','ouc')")

    result = gees(sfunction, a1, lwork=lwork, overwrite_a=overwrite_a,
                  sort_t=sort_t)

    info = result[-1]
    if info < 0:
        raise ValueError(f'illegal value in {-info}-th argument of internal gees')
    elif info == a1.shape[0] + 1:
        raise LinAlgError('Eigenvalues could not be separated for reordering.')
    elif info == a1.shape[0] + 2:
        raise LinAlgError('Leading eigenvalues do not satisfy sort condition.')
    elif info > 0:
        raise LinAlgError("Schur form not found. Possibly ill-conditioned.")

    if sort is None:
        return result[0], result[-3]
    else:
        return result[0], result[-3], result[1]


eps = np.finfo(float).eps
feps = np.finfo(single).eps

_array_kind = {'b': 0, 'h': 0, 'B': 0, 'i': 0, 'l': 0,
               'f': 0, 'd': 0, 'F': 1, 'D': 1}
_array_precision = {'i': 1, 'l': 1, 'f': 0, 'd': 1, 'F': 0, 'D': 1}
_array_type = [['f', 'd'], ['F', 'D']]


def _commonType(*arrays):
    kind = 0
    precision = 0
    for a in arrays:
        t = a.dtype.char
        kind = max(kind, _array_kind[t])
        precision = max(precision, _array_precision[t])
    return _array_type[kind][precision]


def _castCopy(type, *arrays):
    cast_arrays = ()
    for a in arrays:
        if a.dtype.char == type:
            cast_arrays = cast_arrays + (a.copy(),)
        else:
            cast_arrays = cast_arrays + (a.astype(type),)
    if len(cast_arrays) == 1:
        return cast_arrays[0]
    else:
        return cast_arrays


@_apply_over_batch(('T', 2), ('Z', 2))
def rsf2csf(T, Z, check_finite=True):
    """
    Convert real Schur form to complex Schur form.

    Convert a quasi-diagonal real-valued Schur form to the upper-triangular
    complex-valued Schur form.

    Parameters
    ----------
    T : (M, M) array_like
        Real Schur form of the original array
    Z : (M, M) array_like
        Schur transformation matrix
    check_finite : bool, optional
        Whether to check that the input arrays contain only finite numbers.
        Disabling may give a performance gain, but may result in problems
        (crashes, non-termination) if the inputs do contain infinities or NaNs.

    Returns
    -------
    T : (M, M) ndarray
        Complex Schur form of the original array
    Z : (M, M) ndarray
        Schur transformation matrix corresponding to the complex form

    See Also
    --------
    schur : Schur decomposition of an array

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.linalg import schur, rsf2csf
    >>> A = np.array([[0, 2, 2], [0, 1, 2], [1, 0, 1]])
    >>> T, Z = schur(A)
    >>> T
    array([[ 2.65896708,  1.42440458, -1.92933439],
           [ 0.        , -0.32948354, -0.49063704],
           [ 0.        ,  1.31178921, -0.32948354]])
    >>> Z
    array([[0.72711591, -0.60156188, 0.33079564],
           [0.52839428, 0.79801892, 0.28976765],
           [0.43829436, 0.03590414, -0.89811411]])
    >>> T2 , Z2 = rsf2csf(T, Z)
    >>> T2
    array([[2.65896708+0.j, -1.64592781+0.743164187j, -1.21516887+1.00660462j],
           [0.+0.j , -0.32948354+8.02254558e-01j, -0.82115218-2.77555756e-17j],
           [0.+0.j , 0.+0.j, -0.32948354-0.802254558j]])
    >>> Z2
    array([[0.72711591+0.j,  0.28220393-0.31385693j,  0.51319638-0.17258824j],
           [0.52839428+0.j,  0.24720268+0.41635578j, -0.68079517-0.15118243j],
           [0.43829436+0.j, -0.76618703+0.01873251j, -0.03063006+0.46857912j]])

    """
    if check_finite:
        Z, T = map(asarray_chkfinite, (Z, T))
    else:
        Z, T = map(asarray, (Z, T))

    for ind, X in enumerate([Z, T]):
        if X.ndim != 2 or X.shape[0] != X.shape[1]:
            raise ValueError(f"Input '{'ZT'[ind]}' must be square.")

    if T.shape[0] != Z.shape[0]:
        message = f"Input array shapes must match: Z: {Z.shape} vs. T: {T.shape}"
        raise ValueError(message)
    N = T.shape[0]
    t = _commonType(Z, T, array([3.0], 'F'))
    Z, T = _castCopy(t, Z, T)

    for m in range(N-1, 0, -1):
        if abs(T[m, m-1]) > eps*(abs(T[m-1, m-1]) + abs(T[m, m])):
            mu = eigvals(T[m-1:m+1, m-1:m+1]) - T[m, m]
            r = norm([mu[0], T[m, m-1]])
            c = mu[0] / r
            s = T[m, m-1] / r
            G = array([[c.conj(), s], [-s, c]], dtype=t)

            T[m-1:m+1, m-1:] = G.dot(T[m-1:m+1, m-1:])
            T[:m+1, m-1:m+1] = T[:m+1, m-1:m+1].dot(G.conj().T)
            Z[:, m-1:m+1] = Z[:, m-1:m+1].dot(G.conj().T)

        T[m, m-1] = 0.0
    return T, Z
