from __future__ import annotations

from typing import Optional

import cupy as cp

from ..common import _aliases, _helpers
from ..common._typing import NestedSequence, SupportsBufferProtocol
from .._internal import get_xp
from ._info import __array_namespace_info__
from ._typing import Array, Device, DType

bool = cp.bool_

# Basic renames
acos = cp.arccos
acosh = cp.arccosh
asin = cp.arcsin
asinh = cp.arcsinh
atan = cp.arctan
atan2 = cp.arctan2
atanh = cp.arctanh
bitwise_left_shift = cp.left_shift
bitwise_invert = cp.invert
bitwise_right_shift = cp.right_shift
concat = cp.concatenate
pow = cp.power

arange = get_xp(cp)(_aliases.arange)
empty = get_xp(cp)(_aliases.empty)
empty_like = get_xp(cp)(_aliases.empty_like)
eye = get_xp(cp)(_aliases.eye)
full = get_xp(cp)(_aliases.full)
full_like = get_xp(cp)(_aliases.full_like)
linspace = get_xp(cp)(_aliases.linspace)
ones = get_xp(cp)(_aliases.ones)
ones_like = get_xp(cp)(_aliases.ones_like)
zeros = get_xp(cp)(_aliases.zeros)
zeros_like = get_xp(cp)(_aliases.zeros_like)
UniqueAllResult = get_xp(cp)(_aliases.UniqueAllResult)
UniqueCountsResult = get_xp(cp)(_aliases.UniqueCountsResult)
UniqueInverseResult = get_xp(cp)(_aliases.UniqueInverseResult)
unique_all = get_xp(cp)(_aliases.unique_all)
unique_counts = get_xp(cp)(_aliases.unique_counts)
unique_inverse = get_xp(cp)(_aliases.unique_inverse)
unique_values = get_xp(cp)(_aliases.unique_values)
std = get_xp(cp)(_aliases.std)
var = get_xp(cp)(_aliases.var)
cumulative_sum = get_xp(cp)(_aliases.cumulative_sum)
cumulative_prod = get_xp(cp)(_aliases.cumulative_prod)
clip = get_xp(cp)(_aliases.clip)
permute_dims = get_xp(cp)(_aliases.permute_dims)
reshape = get_xp(cp)(_aliases.reshape)
argsort = get_xp(cp)(_aliases.argsort)
sort = get_xp(cp)(_aliases.sort)
nonzero = get_xp(cp)(_aliases.nonzero)
ceil = get_xp(cp)(_aliases.ceil)
floor = get_xp(cp)(_aliases.floor)
trunc = get_xp(cp)(_aliases.trunc)
matmul = get_xp(cp)(_aliases.matmul)
matrix_transpose = get_xp(cp)(_aliases.matrix_transpose)
tensordot = get_xp(cp)(_aliases.tensordot)
sign = get_xp(cp)(_aliases.sign)
finfo = get_xp(cp)(_aliases.finfo)
iinfo = get_xp(cp)(_aliases.iinfo)


# asarray also adds the copy keyword, which is not present in numpy 1.0.
def asarray(
    obj: (
        Array 
        | bool | int | float | complex 
        | NestedSequence[bool | int | float | complex] 
        | SupportsBufferProtocol
    ),
    /,
    *,
    dtype: Optional[DType] = None,
    device: Optional[Device] = None,
    copy: Optional[bool] = None,
    **kwargs,
) -> Array:
    """
    Array API compatibility wrapper for asarray().

    See the corresponding documentation in the array library and/or the array API
    specification for more details.
    """
    with cp.cuda.Device(device):
        if copy is None:
            return cp.asarray(obj, dtype=dtype, **kwargs)
        else:
            res = cp.array(obj, dtype=dtype, copy=copy, **kwargs)
            if not copy and res is not obj:
                raise ValueError("Unable to avoid copy while creating an array as requested")
            return res


def astype(
    x: Array,
    dtype: DType,
    /,
    *,
    copy: bool = True,
    device: Optional[Device] = None,
) -> Array:
    if device is None:
        return x.astype(dtype=dtype, copy=copy)
    out = _helpers.to_device(x.astype(dtype=dtype, copy=False), device)
    return out.copy() if copy and out is x else out


# cupy.count_nonzero does not have keepdims
def count_nonzero(
    x: Array,
    axis=None,
    keepdims=False
) -> Array:
   result = cp.count_nonzero(x, axis)
   if keepdims:
       if axis is None:
            return cp.reshape(result, [1]*x.ndim)
       return cp.expand_dims(result, axis)
   return result


# take_along_axis: axis defaults to -1 but in cupy (and numpy) axis is a required arg
def take_along_axis(x: Array, indices: Array, /, *, axis: int = -1):
    return cp.take_along_axis(x, indices, axis=axis)


# These functions are completely new here. If the library already has them
# (i.e., numpy 2.0), use the library version instead of our wrapper.
if hasattr(cp, 'vecdot'):
    vecdot = cp.vecdot
else:
    vecdot = get_xp(cp)(_aliases.vecdot)

if hasattr(cp, 'isdtype'):
    isdtype = cp.isdtype
else:
    isdtype = get_xp(cp)(_aliases.isdtype)

if hasattr(cp, 'unstack'):
    unstack = cp.unstack
else:
    unstack = get_xp(cp)(_aliases.unstack)

__all__ = _aliases.__all__ + ['__array_namespace_info__', 'asarray', 'astype',
                              'acos', 'acosh', 'asin', 'asinh', 'atan',
                              'atan2', 'atanh', 'bitwise_left_shift',
                              'bitwise_invert', 'bitwise_right_shift',
                              'bool', 'concat', 'count_nonzero', 'pow', 'sign',
                              'take_along_axis']

_all_ignore = ['cp', 'get_xp']
