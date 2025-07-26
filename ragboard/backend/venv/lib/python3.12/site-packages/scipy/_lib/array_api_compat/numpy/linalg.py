# pyright: reportAttributeAccessIssue=false
# pyright: reportUnknownArgumentType=false
# pyright: reportUnknownMemberType=false
# pyright: reportUnknownVariableType=false

from __future__ import annotations

import numpy as np

# intersection of `np.linalg.__all__` on numpy 1.22 and 2.2, minus `_linalg.__all__`
from numpy.linalg import (
    LinAlgError,
    cond,
    det,
    eig,
    eigvals,
    eigvalsh,
    inv,
    lstsq,
    matrix_power,
    multi_dot,
    norm,
    tensorinv,
    tensorsolve,
)

from .._internal import get_xp
from ..common import _linalg

# These functions are in both the main and linalg namespaces
from ._aliases import matmul, matrix_transpose, tensordot, vecdot  # noqa: F401
from ._typing import Array

cross = get_xp(np)(_linalg.cross)
outer = get_xp(np)(_linalg.outer)
EighResult = _linalg.EighResult
QRResult = _linalg.QRResult
SlogdetResult = _linalg.SlogdetResult
SVDResult = _linalg.SVDResult
eigh = get_xp(np)(_linalg.eigh)
qr = get_xp(np)(_linalg.qr)
slogdet = get_xp(np)(_linalg.slogdet)
svd = get_xp(np)(_linalg.svd)
cholesky = get_xp(np)(_linalg.cholesky)
matrix_rank = get_xp(np)(_linalg.matrix_rank)
pinv = get_xp(np)(_linalg.pinv)
matrix_norm = get_xp(np)(_linalg.matrix_norm)
svdvals = get_xp(np)(_linalg.svdvals)
diagonal = get_xp(np)(_linalg.diagonal)
trace = get_xp(np)(_linalg.trace)

# Note: unlike np.linalg.solve, the array API solve() only accepts x2 as a
# vector when it is exactly 1-dimensional. All other cases treat x2 as a stack
# of matrices. The np.linalg.solve behavior of allowing stacks of both
# matrices and vectors is ambiguous c.f.
# https://github.com/numpy/numpy/issues/15349 and
# https://github.com/data-apis/array-api/issues/285.

# To workaround this, the below is the code from np.linalg.solve except
# only calling solve1 in the exactly 1D case.


# This code is here instead of in common because it is numpy specific. Also
# note that CuPy's solve() does not currently support broadcasting (see
# https://github.com/cupy/cupy/blob/main/cupy/cublas.py#L43).
def solve(x1: Array, x2: Array, /) -> Array:
    try:
        from numpy.linalg._linalg import (
            _assert_stacked_2d,
            _assert_stacked_square,
            _commonType,
            _makearray,
            _raise_linalgerror_singular,
            isComplexType,
        )
    except ImportError:
        from numpy.linalg.linalg import (
            _assert_stacked_2d,
            _assert_stacked_square,
            _commonType,
            _makearray,
            _raise_linalgerror_singular,
            isComplexType,
        )
    from numpy.linalg import _umath_linalg

    x1, _ = _makearray(x1)
    _assert_stacked_2d(x1)
    _assert_stacked_square(x1)
    x2, wrap = _makearray(x2)
    t, result_t = _commonType(x1, x2)

    # This part is different from np.linalg.solve
    gufunc: np.ufunc
    if x2.ndim == 1:
        gufunc = _umath_linalg.solve1
    else:
        gufunc = _umath_linalg.solve

    # This does nothing currently but is left in because it will be relevant
    # when complex dtype support is added to the spec in 2022.
    signature = "DD->D" if isComplexType(t) else "dd->d"
    with np.errstate(
        call=_raise_linalgerror_singular,
        invalid="call",
        over="ignore",
        divide="ignore",
        under="ignore",
    ):
        r: Array = gufunc(x1, x2, signature=signature)

    return wrap(r.astype(result_t, copy=False))


# These functions are completely new here. If the library already has them
# (i.e., numpy 2.0), use the library version instead of our wrapper.
if hasattr(np.linalg, "vector_norm"):
    vector_norm = np.linalg.vector_norm
else:
    vector_norm = get_xp(np)(_linalg.vector_norm)


__all__ = [
    "LinAlgError",
    "cond",
    "det",
    "eig",
    "eigvals",
    "eigvalsh",
    "inv",
    "lstsq",
    "matrix_power",
    "multi_dot",
    "norm",
    "tensorinv",
    "tensorsolve",
]
__all__ += _linalg.__all__
__all__ += ["solve", "vector_norm"]


def __dir__() -> list[str]:
    return __all__
