from cupy.linalg import * # noqa: F403
# cupy.linalg doesn't have __all__. If it is added, replace this with
#
# from cupy.linalg import __all__ as linalg_all
_n = {}
exec('from cupy.linalg import *', _n)
del _n['__builtins__']
linalg_all = list(_n)
del _n

from ..common import _linalg
from .._internal import get_xp

import cupy as cp

# These functions are in both the main and linalg namespaces
from ._aliases import matmul, matrix_transpose, tensordot, vecdot # noqa: F401

cross = get_xp(cp)(_linalg.cross)
outer = get_xp(cp)(_linalg.outer)
EighResult = _linalg.EighResult
QRResult = _linalg.QRResult
SlogdetResult = _linalg.SlogdetResult
SVDResult = _linalg.SVDResult
eigh = get_xp(cp)(_linalg.eigh)
qr = get_xp(cp)(_linalg.qr)
slogdet = get_xp(cp)(_linalg.slogdet)
svd = get_xp(cp)(_linalg.svd)
cholesky = get_xp(cp)(_linalg.cholesky)
matrix_rank = get_xp(cp)(_linalg.matrix_rank)
pinv = get_xp(cp)(_linalg.pinv)
matrix_norm = get_xp(cp)(_linalg.matrix_norm)
svdvals = get_xp(cp)(_linalg.svdvals)
diagonal = get_xp(cp)(_linalg.diagonal)
trace = get_xp(cp)(_linalg.trace)

# These functions are completely new here. If the library already has them
# (i.e., numpy 2.0), use the library version instead of our wrapper.
if hasattr(cp.linalg, 'vector_norm'):
    vector_norm = cp.linalg.vector_norm
else:
    vector_norm = get_xp(cp)(_linalg.vector_norm)

__all__ = linalg_all + _linalg.__all__

del get_xp
del cp
del linalg_all
del _linalg
