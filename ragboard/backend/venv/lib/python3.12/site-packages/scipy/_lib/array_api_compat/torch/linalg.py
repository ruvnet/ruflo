from __future__ import annotations

import torch
from typing import Optional, Union, Tuple

from torch.linalg import * # noqa: F403

# torch.linalg doesn't define __all__
# from torch.linalg import __all__ as linalg_all
from torch import linalg as torch_linalg
linalg_all = [i for i in dir(torch_linalg) if not i.startswith('_')]

# outer is implemented in torch but aren't in the linalg namespace
from torch import outer
from ._aliases import _fix_promotion, sum
# These functions are in both the main and linalg namespaces
from ._aliases import matmul, matrix_transpose, tensordot
from ._typing import Array, DType
from ..common._typing import JustInt, JustFloat

# Note: torch.linalg.cross does not default to axis=-1 (it defaults to the
# first axis with size 3), see https://github.com/pytorch/pytorch/issues/58743

# torch.cross also does not support broadcasting when it would add new
# dimensions https://github.com/pytorch/pytorch/issues/39656
def cross(x1: Array, x2: Array, /, *, axis: int = -1) -> Array:
    x1, x2 = _fix_promotion(x1, x2, only_scalar=False)
    if not (-min(x1.ndim, x2.ndim) <= axis < max(x1.ndim, x2.ndim)):
        raise ValueError(f"axis {axis} out of bounds for cross product of arrays with shapes {x1.shape} and {x2.shape}")
    if not (x1.shape[axis] == x2.shape[axis] == 3):
        raise ValueError(f"cross product axis must have size 3, got {x1.shape[axis]} and {x2.shape[axis]}")
    x1, x2 = torch.broadcast_tensors(x1, x2)
    return torch_linalg.cross(x1, x2, dim=axis)

def vecdot(x1: Array, x2: Array, /, *, axis: int = -1, **kwargs) -> Array:
    from ._aliases import isdtype

    x1, x2 = _fix_promotion(x1, x2, only_scalar=False)

    # torch.linalg.vecdot incorrectly allows broadcasting along the contracted dimension
    if x1.shape[axis] != x2.shape[axis]:
        raise ValueError("x1 and x2 must have the same size along the given axis")

    # torch.linalg.vecdot doesn't support integer dtypes
    if isdtype(x1.dtype, 'integral') or isdtype(x2.dtype, 'integral'):
        if kwargs:
            raise RuntimeError("vecdot kwargs not supported for integral dtypes")

        x1_ = torch.moveaxis(x1, axis, -1)
        x2_ = torch.moveaxis(x2, axis, -1)
        x1_, x2_ = torch.broadcast_tensors(x1_, x2_)

        res = x1_[..., None, :] @ x2_[..., None]
        return res[..., 0, 0]
    return torch.linalg.vecdot(x1, x2, dim=axis, **kwargs)

def solve(x1: Array, x2: Array, /, **kwargs) -> Array:
    x1, x2 = _fix_promotion(x1, x2, only_scalar=False)
    # Torch tries to emulate NumPy 1 solve behavior by using batched 1-D solve
    # whenever
    # 1. x1.ndim - 1 == x2.ndim
    # 2. x1.shape[:-1] == x2.shape
    #
    # See linalg_solve_is_vector_rhs in
    # aten/src/ATen/native/LinearAlgebraUtils.h and
    # TORCH_META_FUNC(_linalg_solve_ex) in
    # aten/src/ATen/native/BatchLinearAlgebra.cpp in the PyTorch source code.
    #
    # The easiest way to work around this is to prepend a size 1 dimension to
    # x2, since x2 is already one dimension less than x1.
    #
    # See https://github.com/pytorch/pytorch/issues/52915
    if x2.ndim != 1 and x1.ndim - 1 == x2.ndim and x1.shape[:-1] == x2.shape:
        x2 = x2[None]
    return torch.linalg.solve(x1, x2, **kwargs)

# torch.trace doesn't support the offset argument and doesn't support stacking
def trace(x: Array, /, *, offset: int = 0, dtype: Optional[DType] = None) -> Array:
    # Use our wrapped sum to make sure it does upcasting correctly
    return sum(torch.diagonal(x, offset=offset, dim1=-2, dim2=-1), axis=-1, dtype=dtype)

def vector_norm(
    x: Array,
    /,
    *,
    axis: Optional[Union[int, Tuple[int, ...]]] = None,
    keepdims: bool = False,
    # JustFloat stands for inf | -inf, which are not valid for Literal
    ord: JustInt | JustFloat = 2,
    **kwargs,
) -> Array:
    # torch.vector_norm incorrectly treats axis=() the same as axis=None
    if axis == ():
        out = kwargs.get('out')
        if out is None:
            dtype = None
            if x.dtype == torch.complex64:
                dtype = torch.float32
            elif x.dtype == torch.complex128:
                dtype = torch.float64

            out = torch.zeros_like(x, dtype=dtype)

        # The norm of a single scalar works out to abs(x) in every case except
        # for ord=0, which is x != 0.
        if ord == 0:
            out[:] = (x != 0)
        else:
            out[:] = torch.abs(x)
        return out
    return torch.linalg.vector_norm(x, ord=ord, axis=axis, keepdim=keepdims, **kwargs)

__all__ = linalg_all + ['outer', 'matmul', 'matrix_transpose', 'tensordot',
                        'cross', 'vecdot', 'solve', 'trace', 'vector_norm']

_all_ignore = ['torch_linalg', 'sum']

del linalg_all

def __dir__() -> list[str]:
    return __all__
