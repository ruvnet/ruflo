from __future__ import annotations

from functools import reduce as _reduce, wraps as _wraps
from builtins import all as _builtin_all, any as _builtin_any
from typing import Any, List, Optional, Sequence, Tuple, Union, Literal

import torch

from .._internal import get_xp
from ..common import _aliases
from ..common._typing import NestedSequence, SupportsBufferProtocol
from ._info import __array_namespace_info__
from ._typing import Array, Device, DType

_int_dtypes = {
    torch.uint8,
    torch.int8,
    torch.int16,
    torch.int32,
    torch.int64,
}
try:
    # torch >=2.3
    _int_dtypes |= {torch.uint16, torch.uint32, torch.uint64}
except AttributeError:
    pass


_array_api_dtypes = {
    torch.bool,
    *_int_dtypes,
    torch.float32,
    torch.float64,
    torch.complex64,
    torch.complex128,
}

_promotion_table = {
    # ints
    (torch.int8, torch.int16): torch.int16,
    (torch.int8, torch.int32): torch.int32,
    (torch.int8, torch.int64): torch.int64,
    (torch.int16, torch.int32): torch.int32,
    (torch.int16, torch.int64): torch.int64,
    (torch.int32, torch.int64): torch.int64,
    # ints and uints (mixed sign)
    (torch.uint8, torch.int8): torch.int16,
    (torch.uint8, torch.int16): torch.int16,
    (torch.uint8, torch.int32): torch.int32,
    (torch.uint8, torch.int64): torch.int64,
    # floats
    (torch.float32, torch.float64): torch.float64,
    # complexes
    (torch.complex64, torch.complex128): torch.complex128,
    # Mixed float and complex
    (torch.float32, torch.complex64): torch.complex64,
    (torch.float32, torch.complex128): torch.complex128,
    (torch.float64, torch.complex64): torch.complex128,
    (torch.float64, torch.complex128): torch.complex128,
}

_promotion_table.update({(b, a): c for (a, b), c in _promotion_table.items()})
_promotion_table.update({(a, a): a for a in _array_api_dtypes})


def _two_arg(f):
    @_wraps(f)
    def _f(x1, x2, /, **kwargs):
        x1, x2 = _fix_promotion(x1, x2)
        return f(x1, x2, **kwargs)
    if _f.__doc__ is None:
        _f.__doc__ = f"""\
Array API compatibility wrapper for torch.{f.__name__}.

See the corresponding PyTorch documentation and/or the array API specification
for more details.

"""
    return _f

def _fix_promotion(x1, x2, only_scalar=True):
    if not isinstance(x1, torch.Tensor) or not isinstance(x2, torch.Tensor):
        return x1, x2
    if x1.dtype not in _array_api_dtypes or x2.dtype not in _array_api_dtypes:
        return x1, x2
    # If an argument is 0-D pytorch downcasts the other argument
    if not only_scalar or x1.shape == ():
        dtype = result_type(x1, x2)
        x2 = x2.to(dtype)
    if not only_scalar or x2.shape == ():
        dtype = result_type(x1, x2)
        x1 = x1.to(dtype)
    return x1, x2


_py_scalars = (bool, int, float, complex)


def result_type(
    *arrays_and_dtypes: Array | DType | bool | int | float | complex
) -> DType:
    num = len(arrays_and_dtypes)

    if num == 0:
        raise ValueError("At least one array or dtype must be provided")

    elif num == 1:
        x = arrays_and_dtypes[0]
        if isinstance(x, torch.dtype):
            return x
        return x.dtype

    if num == 2:
        x, y = arrays_and_dtypes
        return _result_type(x, y)

    else:
        # sort scalars so that they are treated last
        scalars, others = [], []
        for x in arrays_and_dtypes:
            if isinstance(x, _py_scalars):
                scalars.append(x)
            else:
                others.append(x)
        if not others:
            raise ValueError("At least one array or dtype must be provided")

        # combine left-to-right
        return _reduce(_result_type, others + scalars)


def _result_type(
    x: Array | DType | bool | int | float | complex,
    y: Array | DType | bool | int | float | complex,
) -> DType:
    if not (isinstance(x, _py_scalars) or isinstance(y, _py_scalars)):
        xdt = x if isinstance(x, torch.dtype) else x.dtype
        ydt = y if isinstance(y, torch.dtype) else y.dtype

        try:
            return _promotion_table[xdt, ydt]
        except KeyError:
            pass

    # This doesn't result_type(dtype, dtype) for non-array API dtypes
    # because torch.result_type only accepts tensors. This does however, allow
    # cross-kind promotion.
    x = torch.tensor([], dtype=x) if isinstance(x, torch.dtype) else x
    y = torch.tensor([], dtype=y) if isinstance(y, torch.dtype) else y
    return torch.result_type(x, y)


def can_cast(from_: Union[DType, Array], to: DType, /) -> bool:
    if not isinstance(from_, torch.dtype):
        from_ = from_.dtype
    return torch.can_cast(from_, to)

# Basic renames
bitwise_invert = torch.bitwise_not
newaxis = None
# torch.conj sets the conjugation bit, which breaks conversion to other
# libraries. See https://github.com/data-apis/array-api-compat/issues/173
conj = torch.conj_physical

# Two-arg elementwise functions
# These require a wrapper to do the correct type promotion on 0-D tensors
add = _two_arg(torch.add)
atan2 = _two_arg(torch.atan2)
bitwise_and = _two_arg(torch.bitwise_and)
bitwise_left_shift = _two_arg(torch.bitwise_left_shift)
bitwise_or = _two_arg(torch.bitwise_or)
bitwise_right_shift = _two_arg(torch.bitwise_right_shift)
bitwise_xor = _two_arg(torch.bitwise_xor)
copysign = _two_arg(torch.copysign)
divide = _two_arg(torch.divide)
# Also a rename. torch.equal does not broadcast
equal = _two_arg(torch.eq)
floor_divide = _two_arg(torch.floor_divide)
greater = _two_arg(torch.greater)
greater_equal = _two_arg(torch.greater_equal)
hypot = _two_arg(torch.hypot)
less = _two_arg(torch.less)
less_equal = _two_arg(torch.less_equal)
logaddexp = _two_arg(torch.logaddexp)
# logical functions are not included here because they only accept bool in the
# spec, so type promotion is irrelevant.
maximum = _two_arg(torch.maximum)
minimum = _two_arg(torch.minimum)
multiply = _two_arg(torch.multiply)
not_equal = _two_arg(torch.not_equal)
pow = _two_arg(torch.pow)
remainder = _two_arg(torch.remainder)
subtract = _two_arg(torch.subtract)


def asarray(
    obj: (
    Array 
        | bool | int | float | complex 
        | NestedSequence[bool | int | float | complex] 
        | SupportsBufferProtocol
    ),
    /,
    *,
    dtype: DType | None = None,
    device: Device | None = None,
    copy: bool | None = None,
    **kwargs: Any,
) -> Array:
    # torch.asarray does not respect input->output device propagation
    # https://github.com/pytorch/pytorch/issues/150199
    if device is None and isinstance(obj, torch.Tensor):
        device = obj.device
    return torch.asarray(obj, dtype=dtype, device=device, copy=copy, **kwargs)


# These wrappers are mostly based on the fact that pytorch uses 'dim' instead
# of 'axis'.

# torch.min and torch.max return a tuple and don't support multiple axes https://github.com/pytorch/pytorch/issues/58745
def max(x: Array, /, *, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Array:
    # https://github.com/pytorch/pytorch/issues/29137
    if axis == ():
        return torch.clone(x)
    return torch.amax(x, axis, keepdims=keepdims)

def min(x: Array, /, *, axis: Optional[Union[int, Tuple[int, ...]]] = None, keepdims: bool = False) -> Array:
    # https://github.com/pytorch/pytorch/issues/29137
    if axis == ():
        return torch.clone(x)
    return torch.amin(x, axis, keepdims=keepdims)

clip = get_xp(torch)(_aliases.clip)
unstack = get_xp(torch)(_aliases.unstack)
cumulative_sum = get_xp(torch)(_aliases.cumulative_sum)
cumulative_prod = get_xp(torch)(_aliases.cumulative_prod)
finfo = get_xp(torch)(_aliases.finfo)
iinfo = get_xp(torch)(_aliases.iinfo)


# torch.sort also returns a tuple
# https://github.com/pytorch/pytorch/issues/70921
def sort(x: Array, /, *, axis: int = -1, descending: bool = False, stable: bool = True, **kwargs) -> Array:
    return torch.sort(x, dim=axis, descending=descending, stable=stable, **kwargs).values

def _normalize_axes(axis, ndim):
    axes = []
    if ndim == 0 and axis:
        # Better error message in this case
        raise IndexError(f"Dimension out of range: {axis[0]}")
    lower, upper = -ndim, ndim - 1
    for a in axis:
        if a < lower or a > upper:
            # Match torch error message (e.g., from sum())
            raise IndexError(f"Dimension out of range (expected to be in range of [{lower}, {upper}], but got {a}")
        if a < 0:
            a = a + ndim
        if a in axes:
            # Use IndexError instead of RuntimeError, and "axis" instead of "dim"
            raise IndexError(f"Axis {a} appears multiple times in the list of axes")
        axes.append(a)
    return sorted(axes)

def _axis_none_keepdims(x, ndim, keepdims):
    # Apply keepdims when axis=None
    # (https://github.com/pytorch/pytorch/issues/71209)
    # Note that this is only valid for the axis=None case.
    if keepdims:
        for i in range(ndim):
            x = torch.unsqueeze(x, 0)
    return x

def _reduce_multiple_axes(f, x, axis, keepdims=False, **kwargs):
    # Some reductions don't support multiple axes
    # (https://github.com/pytorch/pytorch/issues/56586).
    axes = _normalize_axes(axis, x.ndim)
    for a in reversed(axes):
        x = torch.movedim(x, a, -1)
    x = torch.flatten(x, -len(axes))

    out = f(x, -1, **kwargs)

    if keepdims:
        for a in axes:
            out = torch.unsqueeze(out, a)
    return out


def _sum_prod_no_axis(x: Array, dtype: DType | None) -> Array:
    """
    Implements `sum(..., axis=())` and `prod(..., axis=())`.
    
    Works around https://github.com/pytorch/pytorch/issues/29137
    """
    if dtype is not None:
        return x.clone() if dtype == x.dtype else x.to(dtype)

    # We can't upcast uint8 according to the spec because there is no
    # torch.uint64, so at least upcast to int64 which is what prod does
    # when axis=None.
    if x.dtype in (torch.uint8, torch.int8, torch.int16, torch.int32):
        return x.to(torch.int64)

    return x.clone()


def prod(x: Array,
         /,
         *,
         axis: Optional[Union[int, Tuple[int, ...]]] = None,
         dtype: Optional[DType] = None,
         keepdims: bool = False,
         **kwargs) -> Array:

    if axis == ():
        return _sum_prod_no_axis(x, dtype)
    # torch.prod doesn't support multiple axes
    # (https://github.com/pytorch/pytorch/issues/56586).
    if isinstance(axis, tuple):
        return _reduce_multiple_axes(torch.prod, x, axis, keepdims=keepdims, dtype=dtype, **kwargs)
    if axis is None:
        # torch doesn't support keepdims with axis=None
        # (https://github.com/pytorch/pytorch/issues/71209)
        res = torch.prod(x, dtype=dtype, **kwargs)
        res = _axis_none_keepdims(res, x.ndim, keepdims)
        return res

    return torch.prod(x, axis, dtype=dtype, keepdims=keepdims, **kwargs)


def sum(x: Array,
         /,
         *,
         axis: Optional[Union[int, Tuple[int, ...]]] = None,
         dtype: Optional[DType] = None,
         keepdims: bool = False,
         **kwargs) -> Array:

    if axis == ():
        return _sum_prod_no_axis(x, dtype)
    if axis is None:
        # torch doesn't support keepdims with axis=None
        # (https://github.com/pytorch/pytorch/issues/71209)
        res = torch.sum(x, dtype=dtype, **kwargs)
        res = _axis_none_keepdims(res, x.ndim, keepdims)
        return res

    return torch.sum(x, axis, dtype=dtype, keepdims=keepdims, **kwargs)

def any(x: Array,
        /,
        *,
        axis: Optional[Union[int, Tuple[int, ...]]] = None,
        keepdims: bool = False,
        **kwargs) -> Array:

    if axis == ():
        return x.to(torch.bool)
    # torch.any doesn't support multiple axes
    # (https://github.com/pytorch/pytorch/issues/56586).
    if isinstance(axis, tuple):
        res = _reduce_multiple_axes(torch.any, x, axis, keepdims=keepdims, **kwargs)
        return res.to(torch.bool)
    if axis is None:
        # torch doesn't support keepdims with axis=None
        # (https://github.com/pytorch/pytorch/issues/71209)
        res = torch.any(x, **kwargs)
        res = _axis_none_keepdims(res, x.ndim, keepdims)
        return res.to(torch.bool)

    # torch.any doesn't return bool for uint8
    return torch.any(x, axis, keepdims=keepdims).to(torch.bool)

def all(x: Array,
        /,
        *,
        axis: Optional[Union[int, Tuple[int, ...]]] = None,
        keepdims: bool = False,
        **kwargs) -> Array:

    if axis == ():
        return x.to(torch.bool)
    # torch.all doesn't support multiple axes
    # (https://github.com/pytorch/pytorch/issues/56586).
    if isinstance(axis, tuple):
        res = _reduce_multiple_axes(torch.all, x, axis, keepdims=keepdims, **kwargs)
        return res.to(torch.bool)
    if axis is None:
        # torch doesn't support keepdims with axis=None
        # (https://github.com/pytorch/pytorch/issues/71209)
        res = torch.all(x, **kwargs)
        res = _axis_none_keepdims(res, x.ndim, keepdims)
        return res.to(torch.bool)

    # torch.all doesn't return bool for uint8
    return torch.all(x, axis, keepdims=keepdims).to(torch.bool)

def mean(x: Array,
         /,
         *,
         axis: Optional[Union[int, Tuple[int, ...]]] = None,
         keepdims: bool = False,
         **kwargs) -> Array:
    # https://github.com/pytorch/pytorch/issues/29137
    if axis == ():
        return torch.clone(x)
    if axis is None:
        # torch doesn't support keepdims with axis=None
        # (https://github.com/pytorch/pytorch/issues/71209)
        res = torch.mean(x, **kwargs)
        res = _axis_none_keepdims(res, x.ndim, keepdims)
        return res
    return torch.mean(x, axis, keepdims=keepdims, **kwargs)

def std(x: Array,
        /,
        *,
        axis: Optional[Union[int, Tuple[int, ...]]] = None,
        correction: Union[int, float] = 0.0,
        keepdims: bool = False,
        **kwargs) -> Array:
    # Note, float correction is not supported
    # https://github.com/pytorch/pytorch/issues/61492. We don't try to
    # implement it here for now.

    if isinstance(correction, float):
        _correction = int(correction)
        if correction != _correction:
            raise NotImplementedError("float correction in torch std() is not yet supported")
    else:
        _correction = correction

    # https://github.com/pytorch/pytorch/issues/29137
    if axis == ():
        return torch.zeros_like(x)
    if isinstance(axis, int):
        axis = (axis,)
    if axis is None:
        # torch doesn't support keepdims with axis=None
        # (https://github.com/pytorch/pytorch/issues/71209)
        res = torch.std(x, tuple(range(x.ndim)), correction=_correction, **kwargs)
        res = _axis_none_keepdims(res, x.ndim, keepdims)
        return res
    return torch.std(x, axis, correction=_correction, keepdims=keepdims, **kwargs)

def var(x: Array,
        /,
        *,
        axis: Optional[Union[int, Tuple[int, ...]]] = None,
        correction: Union[int, float] = 0.0,
        keepdims: bool = False,
        **kwargs) -> Array:
    # Note, float correction is not supported
    # https://github.com/pytorch/pytorch/issues/61492. We don't try to
    # implement it here for now.

    # if isinstance(correction, float):
    #     correction = int(correction)

    # https://github.com/pytorch/pytorch/issues/29137
    if axis == ():
        return torch.zeros_like(x)
    if isinstance(axis, int):
        axis = (axis,)
    if axis is None:
        # torch doesn't support keepdims with axis=None
        # (https://github.com/pytorch/pytorch/issues/71209)
        res = torch.var(x, tuple(range(x.ndim)), correction=correction, **kwargs)
        res = _axis_none_keepdims(res, x.ndim, keepdims)
        return res
    return torch.var(x, axis, correction=correction, keepdims=keepdims, **kwargs)

# torch.concat doesn't support dim=None
# https://github.com/pytorch/pytorch/issues/70925
def concat(arrays: Union[Tuple[Array, ...], List[Array]],
           /,
           *,
           axis: Optional[int] = 0,
           **kwargs) -> Array:
    if axis is None:
        arrays = tuple(ar.flatten() for ar in arrays)
        axis = 0
    return torch.concat(arrays, axis, **kwargs)

# torch.squeeze only accepts int dim and doesn't require it
# https://github.com/pytorch/pytorch/issues/70924. Support for tuple dim was
# added at https://github.com/pytorch/pytorch/pull/89017.
def squeeze(x: Array, /, axis: Union[int, Tuple[int, ...]]) -> Array:
    if isinstance(axis, int):
        axis = (axis,)
    for a in axis:
        if x.shape[a] != 1:
            raise ValueError("squeezed dimensions must be equal to 1")
    axes = _normalize_axes(axis, x.ndim)
    # Remove this once pytorch 1.14 is released with the above PR #89017.
    sequence = [a - i for i, a in enumerate(axes)]
    for a in sequence:
        x = torch.squeeze(x, a)
    return x

# torch.broadcast_to uses size instead of shape
def broadcast_to(x: Array, /, shape: Tuple[int, ...], **kwargs) -> Array:
    return torch.broadcast_to(x, shape, **kwargs)

# torch.permute uses dims instead of axes
def permute_dims(x: Array, /, axes: Tuple[int, ...]) -> Array:
    return torch.permute(x, axes)

# The axis parameter doesn't work for flip() and roll()
# https://github.com/pytorch/pytorch/issues/71210. Also torch.flip() doesn't
# accept axis=None
def flip(x: Array, /, *, axis: Optional[Union[int, Tuple[int, ...]]] = None, **kwargs) -> Array:
    if axis is None:
        axis = tuple(range(x.ndim))
    # torch.flip doesn't accept dim as an int but the method does
    # https://github.com/pytorch/pytorch/issues/18095
    return x.flip(axis, **kwargs)

def roll(x: Array, /, shift: Union[int, Tuple[int, ...]], *, axis: Optional[Union[int, Tuple[int, ...]]] = None, **kwargs) -> Array:
    return torch.roll(x, shift, axis, **kwargs)

def nonzero(x: Array, /, **kwargs) -> Tuple[Array, ...]:
    if x.ndim == 0:
        raise ValueError("nonzero() does not support zero-dimensional arrays")
    return torch.nonzero(x, as_tuple=True, **kwargs)


# torch uses `dim` instead of `axis`
def diff(
    x: Array,
    /,
    *,
    axis: int = -1,
    n: int = 1,
    prepend: Optional[Array] = None,
    append: Optional[Array] = None,
) -> Array:
    return torch.diff(x, dim=axis, n=n, prepend=prepend, append=append)


# torch uses `dim` instead of `axis`, does not have keepdims
def count_nonzero(
    x: Array,
    /,
    *,
    axis: Optional[Union[int, Tuple[int, ...]]] = None,
    keepdims: bool = False,
) -> Array:
    result = torch.count_nonzero(x, dim=axis)
    if keepdims:
        if isinstance(axis, int):
            return result.unsqueeze(axis)
        elif isinstance(axis, tuple):
            n_axis = [x.ndim + ax if ax < 0 else ax for ax in axis]
            sh = [1 if i in n_axis else x.shape[i] for i in range(x.ndim)]
            return torch.reshape(result, sh)
        return _axis_none_keepdims(result, x.ndim, keepdims)
    else:
        return result


# "repeat" is torch.repeat_interleave;  also the dim argument
def repeat(x: Array, repeats: int | Array, /, *, axis: int | None = None) -> Array:
    return torch.repeat_interleave(x, repeats, axis)


def where(
    condition: Array, 
    x1: Array | bool | int | float | complex, 
    x2: Array | bool | int | float | complex,
    /,
) -> Array:
    x1, x2 = _fix_promotion(x1, x2)
    return torch.where(condition, x1, x2)


# torch.reshape doesn't have the copy keyword
def reshape(x: Array,
            /,
            shape: Tuple[int, ...],
            *,
            copy: Optional[bool] = None,
            **kwargs) -> Array:
    if copy is not None:
        raise NotImplementedError("torch.reshape doesn't yet support the copy keyword")
    return torch.reshape(x, shape, **kwargs)

# torch.arange doesn't support returning empty arrays
# (https://github.com/pytorch/pytorch/issues/70915), and doesn't support some
# keyword argument combinations
# (https://github.com/pytorch/pytorch/issues/70914)
def arange(start: Union[int, float],
           /,
           stop: Optional[Union[int, float]] = None,
           step: Union[int, float] = 1,
           *,
           dtype: Optional[DType] = None,
           device: Optional[Device] = None,
           **kwargs) -> Array:
    if stop is None:
        start, stop = 0, start
    if step > 0 and stop <= start or step < 0 and stop >= start:
        if dtype is None:
            if _builtin_all(isinstance(i, int) for i in [start, stop, step]):
                dtype = torch.int64
            else:
                dtype = torch.float32
        return torch.empty(0, dtype=dtype, device=device, **kwargs)
    return torch.arange(start, stop, step, dtype=dtype, device=device, **kwargs)

# torch.eye does not accept None as a default for the second argument and
# doesn't support off-diagonals (https://github.com/pytorch/pytorch/issues/70910)
def eye(n_rows: int,
        n_cols: Optional[int] = None,
        /,
        *,
        k: int = 0,
        dtype: Optional[DType] = None,
        device: Optional[Device] = None,
        **kwargs) -> Array:
    if n_cols is None:
        n_cols = n_rows
    z = torch.zeros(n_rows, n_cols, dtype=dtype, device=device, **kwargs)
    if abs(k) <= n_rows + n_cols:
        z.diagonal(k).fill_(1)
    return z

# torch.linspace doesn't have the endpoint parameter
def linspace(start: Union[int, float],
             stop: Union[int, float],
             /,
             num: int,
             *,
             dtype: Optional[DType] = None,
             device: Optional[Device] = None,
             endpoint: bool = True,
             **kwargs) -> Array:
    if not endpoint:
        return torch.linspace(start, stop, num+1, dtype=dtype, device=device, **kwargs)[:-1]
    return torch.linspace(start, stop, num, dtype=dtype, device=device, **kwargs)

# torch.full does not accept an int size
# https://github.com/pytorch/pytorch/issues/70906
def full(shape: Union[int, Tuple[int, ...]],
         fill_value: bool | int | float | complex,
         *,
         dtype: Optional[DType] = None,
         device: Optional[Device] = None,
         **kwargs) -> Array:
    if isinstance(shape, int):
        shape = (shape,)

    return torch.full(shape, fill_value, dtype=dtype, device=device, **kwargs)

# ones, zeros, and empty do not accept shape as a keyword argument
def ones(shape: Union[int, Tuple[int, ...]],
         *,
         dtype: Optional[DType] = None,
         device: Optional[Device] = None,
         **kwargs) -> Array:
    return torch.ones(shape, dtype=dtype, device=device, **kwargs)

def zeros(shape: Union[int, Tuple[int, ...]],
         *,
         dtype: Optional[DType] = None,
         device: Optional[Device] = None,
         **kwargs) -> Array:
    return torch.zeros(shape, dtype=dtype, device=device, **kwargs)

def empty(shape: Union[int, Tuple[int, ...]],
         *,
         dtype: Optional[DType] = None,
         device: Optional[Device] = None,
         **kwargs) -> Array:
    return torch.empty(shape, dtype=dtype, device=device, **kwargs)

# tril and triu do not call the keyword argument k

def tril(x: Array, /, *, k: int = 0) -> Array:
    return torch.tril(x, k)

def triu(x: Array, /, *, k: int = 0) -> Array:
    return torch.triu(x, k)

# Functions that aren't in torch https://github.com/pytorch/pytorch/issues/58742
def expand_dims(x: Array, /, *, axis: int = 0) -> Array:
    return torch.unsqueeze(x, axis)


def astype(
    x: Array,
    dtype: DType,
    /,
    *,
    copy: bool = True,
    device: Optional[Device] = None,
) -> Array:
    if device is not None:
        return x.to(device, dtype=dtype, copy=copy)
    return x.to(dtype=dtype, copy=copy)


def broadcast_arrays(*arrays: Array) -> List[Array]:
    shape = torch.broadcast_shapes(*[a.shape for a in arrays])
    return [torch.broadcast_to(a, shape) for a in arrays]

# Note that these named tuples aren't actually part of the standard namespace,
# but I don't see any issue with exporting the names here regardless.
from ..common._aliases import (UniqueAllResult, UniqueCountsResult,
                               UniqueInverseResult)

# https://github.com/pytorch/pytorch/issues/70920
def unique_all(x: Array) -> UniqueAllResult:
    # torch.unique doesn't support returning indices.
    # https://github.com/pytorch/pytorch/issues/36748. The workaround
    # suggested in that issue doesn't actually function correctly (it relies
    # on non-deterministic behavior of scatter()).
    raise NotImplementedError("unique_all() not yet implemented for pytorch (see https://github.com/pytorch/pytorch/issues/36748)")

    # values, inverse_indices, counts = torch.unique(x, return_counts=True, return_inverse=True)
    # # torch.unique incorrectly gives a 0 count for nan values.
    # # https://github.com/pytorch/pytorch/issues/94106
    # counts[torch.isnan(values)] = 1
    # return UniqueAllResult(values, indices, inverse_indices, counts)

def unique_counts(x: Array) -> UniqueCountsResult:
    values, counts = torch.unique(x, return_counts=True)

    # torch.unique incorrectly gives a 0 count for nan values.
    # https://github.com/pytorch/pytorch/issues/94106
    counts[torch.isnan(values)] = 1
    return UniqueCountsResult(values, counts)

def unique_inverse(x: Array) -> UniqueInverseResult:
    values, inverse = torch.unique(x, return_inverse=True)
    return UniqueInverseResult(values, inverse)

def unique_values(x: Array) -> Array:
    return torch.unique(x)

def matmul(x1: Array, x2: Array, /, **kwargs) -> Array:
    # torch.matmul doesn't type promote (but differently from _fix_promotion)
    x1, x2 = _fix_promotion(x1, x2, only_scalar=False)
    return torch.matmul(x1, x2, **kwargs)

matrix_transpose = get_xp(torch)(_aliases.matrix_transpose)
_vecdot = get_xp(torch)(_aliases.vecdot)

def vecdot(x1: Array, x2: Array, /, *, axis: int = -1) -> Array:
    x1, x2 = _fix_promotion(x1, x2, only_scalar=False)
    return _vecdot(x1, x2, axis=axis)

# torch.tensordot uses dims instead of axes
def tensordot(
    x1: Array,
    x2: Array,
    /,
    *, 
    axes: Union[int, Tuple[Sequence[int], Sequence[int]]] = 2, 
    **kwargs,
) -> Array:
    # Note: torch.tensordot fails with integer dtypes when there is only 1
    # element in the axis (https://github.com/pytorch/pytorch/issues/84530).
    x1, x2 = _fix_promotion(x1, x2, only_scalar=False)
    return torch.tensordot(x1, x2, dims=axes, **kwargs)


def isdtype(
    dtype: DType, kind: Union[DType, str, Tuple[Union[DType, str], ...]],
    *, _tuple=True, # Disallow nested tuples
) -> bool:
    """
    Returns a boolean indicating whether a provided dtype is of a specified data type ``kind``.

    Note that outside of this function, this compat library does not yet fully
    support complex numbers.

    See
    https://data-apis.org/array-api/latest/API_specification/generated/array_api.isdtype.html
    for more details
    """
    if isinstance(kind, tuple) and _tuple:
        return _builtin_any(isdtype(dtype, k, _tuple=False) for k in kind)
    elif isinstance(kind, str):
        if kind == 'bool':
            return dtype == torch.bool
        elif kind == 'signed integer':
            return dtype in _int_dtypes and dtype.is_signed
        elif kind == 'unsigned integer':
            return dtype in _int_dtypes and not dtype.is_signed
        elif kind == 'integral':
            return dtype in _int_dtypes
        elif kind == 'real floating':
            return dtype.is_floating_point
        elif kind == 'complex floating':
            return dtype.is_complex
        elif kind == 'numeric':
            return isdtype(dtype, ('integral', 'real floating', 'complex floating'))
        else:
            raise ValueError(f"Unrecognized data type kind: {kind!r}")
    else:
        return dtype == kind

def take(x: Array, indices: Array, /, *, axis: Optional[int] = None, **kwargs) -> Array:
    if axis is None:
        if x.ndim != 1:
            raise ValueError("axis must be specified when ndim > 1")
        axis = 0
    return torch.index_select(x, axis, indices, **kwargs)


def take_along_axis(x: Array, indices: Array, /, *, axis: int = -1) -> Array:
    return torch.take_along_dim(x, indices, dim=axis)


def sign(x: Array, /) -> Array:
    # torch sign() does not support complex numbers and does not propagate
    # nans. See https://github.com/data-apis/array-api-compat/issues/136
    if x.dtype.is_complex:
        out = x/torch.abs(x)
        # sign(0) = 0 but the above formula would give nan
        out[x == 0+0j] = 0+0j
        return out
    else:
        out = torch.sign(x)
        if x.dtype.is_floating_point:
            out[torch.isnan(x)] = torch.nan
        return out


def meshgrid(*arrays: Array, indexing: Literal['xy', 'ij'] = 'xy') -> List[Array]:
    # enforce the default of 'xy'
    # TODO: is the return type a list or a tuple
    return list(torch.meshgrid(*arrays, indexing='xy'))


__all__ = ['__array_namespace_info__', 'asarray', 'result_type', 'can_cast',
           'permute_dims', 'bitwise_invert', 'newaxis', 'conj', 'add',
           'atan2', 'bitwise_and', 'bitwise_left_shift', 'bitwise_or',
           'bitwise_right_shift', 'bitwise_xor', 'copysign', 'count_nonzero',
           'diff', 'divide',
           'equal', 'floor_divide', 'greater', 'greater_equal', 'hypot',
           'less', 'less_equal', 'logaddexp', 'maximum', 'minimum',
           'multiply', 'not_equal', 'pow', 'remainder', 'subtract', 'max',
           'min', 'clip', 'unstack', 'cumulative_sum', 'cumulative_prod', 'sort', 'prod', 'sum',
           'any', 'all', 'mean', 'std', 'var', 'concat', 'squeeze',
           'broadcast_to', 'flip', 'roll', 'nonzero', 'where', 'reshape',
           'arange', 'eye', 'linspace', 'full', 'ones', 'zeros', 'empty',
           'tril', 'triu', 'expand_dims', 'astype', 'broadcast_arrays',
           'UniqueAllResult', 'UniqueCountsResult', 'UniqueInverseResult',
           'unique_all', 'unique_counts', 'unique_inverse', 'unique_values',
           'matmul', 'matrix_transpose', 'vecdot', 'tensordot', 'isdtype',
           'take', 'take_along_axis', 'sign', 'finfo', 'iinfo', 'repeat', 'meshgrid']

_all_ignore = ['torch', 'get_xp']
