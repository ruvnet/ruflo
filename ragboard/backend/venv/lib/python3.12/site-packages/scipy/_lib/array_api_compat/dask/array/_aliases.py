# pyright: reportPrivateUsage=false
# pyright: reportUnknownArgumentType=false
# pyright: reportUnknownMemberType=false
# pyright: reportUnknownVariableType=false

from __future__ import annotations

from builtins import bool as py_bool
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from typing_extensions import TypeIs

import dask.array as da
import numpy as np
from numpy import bool_ as bool
from numpy import (
    can_cast,
    complex64,
    complex128,
    float32,
    float64,
    int8,
    int16,
    int32,
    int64,
    result_type,
    uint8,
    uint16,
    uint32,
    uint64,
)

from ..._internal import get_xp
from ...common import _aliases, _helpers, array_namespace
from ...common._typing import (
    Array,
    Device,
    DType,
    NestedSequence,
    SupportsBufferProtocol,
)
from ._info import __array_namespace_info__

isdtype = get_xp(np)(_aliases.isdtype)
unstack = get_xp(da)(_aliases.unstack)


# da.astype doesn't respect copy=True
def astype(
    x: Array,
    dtype: DType,
    /,
    *,
    copy: py_bool = True,
    device: Device | None = None,
) -> Array:
    """
    Array API compatibility wrapper for astype().

    See the corresponding documentation in the array library and/or the array API
    specification for more details.
    """
    # TODO: respect device keyword?
    _helpers._check_device(da, device)

    if not copy and dtype == x.dtype:
        return x
    x = x.astype(dtype)
    return x.copy() if copy else x


# Common aliases


# This arange func is modified from the common one to
# not pass stop/step as keyword arguments, which will cause
# an error with dask
def arange(
    start: float,
    /,
    stop: float | None = None,
    step: float = 1,
    *,
    dtype: DType | None = None,
    device: Device | None = None,
    **kwargs: object,
) -> Array:
    """
    Array API compatibility wrapper for arange().

    See the corresponding documentation in the array library and/or the array API
    specification for more details.
    """
    # TODO: respect device keyword?
    _helpers._check_device(da, device)

    args: list[Any] = [start]
    if stop is not None:
        args.append(stop)
    else:
        # stop is None, so start is actually stop
        # prepend the default value for start which is 0
        args.insert(0, 0)
    args.append(step)

    return da.arange(*args, dtype=dtype, **kwargs)


eye = get_xp(da)(_aliases.eye)
linspace = get_xp(da)(_aliases.linspace)
UniqueAllResult = get_xp(da)(_aliases.UniqueAllResult)
UniqueCountsResult = get_xp(da)(_aliases.UniqueCountsResult)
UniqueInverseResult = get_xp(da)(_aliases.UniqueInverseResult)
unique_all = get_xp(da)(_aliases.unique_all)
unique_counts = get_xp(da)(_aliases.unique_counts)
unique_inverse = get_xp(da)(_aliases.unique_inverse)
unique_values = get_xp(da)(_aliases.unique_values)
permute_dims = get_xp(da)(_aliases.permute_dims)
std = get_xp(da)(_aliases.std)
var = get_xp(da)(_aliases.var)
cumulative_sum = get_xp(da)(_aliases.cumulative_sum)
cumulative_prod = get_xp(da)(_aliases.cumulative_prod)
empty = get_xp(da)(_aliases.empty)
empty_like = get_xp(da)(_aliases.empty_like)
full = get_xp(da)(_aliases.full)
full_like = get_xp(da)(_aliases.full_like)
ones = get_xp(da)(_aliases.ones)
ones_like = get_xp(da)(_aliases.ones_like)
zeros = get_xp(da)(_aliases.zeros)
zeros_like = get_xp(da)(_aliases.zeros_like)
reshape = get_xp(da)(_aliases.reshape)
matrix_transpose = get_xp(da)(_aliases.matrix_transpose)
vecdot = get_xp(da)(_aliases.vecdot)
nonzero = get_xp(da)(_aliases.nonzero)
ceil = get_xp(np)(_aliases.ceil)
floor = get_xp(np)(_aliases.floor)
trunc = get_xp(np)(_aliases.trunc)
matmul = get_xp(np)(_aliases.matmul)
tensordot = get_xp(np)(_aliases.tensordot)
sign = get_xp(np)(_aliases.sign)
finfo = get_xp(np)(_aliases.finfo)
iinfo = get_xp(np)(_aliases.iinfo)


# asarray also adds the copy keyword, which is not present in numpy 1.0.
def asarray(
    obj: complex | NestedSequence[complex] | Array | SupportsBufferProtocol,
    /,
    *,
    dtype: DType | None = None,
    device: Device | None = None,
    copy: py_bool | None = None,
    **kwargs: object,
) -> Array:
    """
    Array API compatibility wrapper for asarray().

    See the corresponding documentation in the array library and/or the array API
    specification for more details.
    """
    # TODO: respect device keyword?
    _helpers._check_device(da, device)

    if isinstance(obj, da.Array):
        if dtype is not None and dtype != obj.dtype:
            if copy is False:
                raise ValueError("Unable to avoid copy when changing dtype")
            obj = obj.astype(dtype)
        return obj.copy() if copy else obj  # pyright: ignore[reportAttributeAccessIssue]

    if copy is False:
        raise ValueError(
            "Unable to avoid copy when converting a non-dask object to dask"
        )

    # copy=None to be uniform across dask < 2024.12 and >= 2024.12
    # see https://github.com/dask/dask/pull/11524/
    obj = np.array(obj, dtype=dtype, copy=True)
    return da.from_array(obj)


# Element wise aliases
from dask.array import arccos as acos
from dask.array import arccosh as acosh
from dask.array import arcsin as asin
from dask.array import arcsinh as asinh
from dask.array import arctan as atan
from dask.array import arctan2 as atan2
from dask.array import arctanh as atanh

# Other
from dask.array import concatenate as concat
from dask.array import invert as bitwise_invert
from dask.array import left_shift as bitwise_left_shift
from dask.array import power as pow
from dask.array import right_shift as bitwise_right_shift


# dask.array.clip does not work unless all three arguments are provided.
# Furthermore, the masking workaround in common._aliases.clip cannot work with
# dask (meaning uint64 promoting to float64 is going to just be unfixed for
# now).
def clip(
    x: Array,
    /,
    min: float | Array | None = None,
    max: float | Array | None = None,
) -> Array:
    """
    Array API compatibility wrapper for clip().

    See the corresponding documentation in the array library and/or the array API
    specification for more details.
    """

    def _isscalar(a: float | Array | None, /) -> TypeIs[float | None]:
        return a is None or isinstance(a, (int, float))

    min_shape = () if _isscalar(min) else min.shape
    max_shape = () if _isscalar(max) else max.shape

    # TODO: This won't handle dask unknown shapes
    result_shape = np.broadcast_shapes(x.shape, min_shape, max_shape)

    if min is not None:
        min = da.broadcast_to(da.asarray(min), result_shape)
    if max is not None:
        max = da.broadcast_to(da.asarray(max), result_shape)

    if min is None and max is None:
        return da.positive(x)

    if min is None:
        return astype(da.minimum(x, max), x.dtype)
    if max is None:
        return astype(da.maximum(x, min), x.dtype)

    return astype(da.minimum(da.maximum(x, min), max), x.dtype)


def _ensure_single_chunk(x: Array, axis: int) -> tuple[Array, Callable[[Array], Array]]:
    """
    Make sure that Array is not broken into multiple chunks along axis.

    Returns
    -------
    x : Array
        The input Array with a single chunk along axis.
    restore : Callable[Array, Array]
        function to apply to the output to rechunk it back into reasonable chunks
    """
    if axis < 0:
        axis += x.ndim
    if x.numblocks[axis] < 2:
        return x, lambda x: x

    # Break chunks on other axes in an attempt to keep chunk size low
    x = x.rechunk({i: -1 if i == axis else "auto" for i in range(x.ndim)})

    # Rather than reconstructing the original chunks, which can be a
    # very expensive affair, just break down oversized chunks without
    # incurring in any transfers over the network.
    # This has the downside of a risk of overchunking if the array is
    # then used in operations against other arrays that match the
    # original chunking pattern.
    return x, lambda x: x.rechunk()


def sort(
    x: Array,
    /,
    *,
    axis: int = -1,
    descending: py_bool = False,
    stable: py_bool = True,
) -> Array:
    """
    Array API compatibility layer around the lack of sort() in Dask.

    Warnings
    --------
    This function temporarily rechunks the array along `axis` to a single chunk.
    This can be extremely inefficient and can lead to out-of-memory errors.

    See the corresponding documentation in the array library and/or the array API
    specification for more details.
    """
    x, restore = _ensure_single_chunk(x, axis)

    meta_xp = array_namespace(x._meta)
    x = da.map_blocks(
        meta_xp.sort,
        x,
        axis=axis,
        meta=x._meta,
        dtype=x.dtype,
        descending=descending,
        stable=stable,
    )

    return restore(x)


def argsort(
    x: Array,
    /,
    *,
    axis: int = -1,
    descending: py_bool = False,
    stable: py_bool = True,
) -> Array:
    """
    Array API compatibility layer around the lack of argsort() in Dask.

    See the corresponding documentation in the array library and/or the array API
    specification for more details.

    Warnings
    --------
    This function temporarily rechunks the array along `axis` into a single chunk.
    This can be extremely inefficient and can lead to out-of-memory errors.
    """
    x, restore = _ensure_single_chunk(x, axis)

    meta_xp = array_namespace(x._meta)
    dtype = meta_xp.argsort(x._meta).dtype
    meta = meta_xp.astype(x._meta, dtype)
    x = da.map_blocks(
        meta_xp.argsort,
        x,
        axis=axis,
        meta=meta,
        dtype=dtype,
        descending=descending,
        stable=stable,
    )

    return restore(x)


# dask.array.count_nonzero does not have keepdims
def count_nonzero(
    x: Array,
    axis: int | None = None,
    keepdims: py_bool = False,
) -> Array:
    result = da.count_nonzero(x, axis)
    if keepdims:
        if axis is None:
            return da.reshape(result, [1] * x.ndim)
        return da.expand_dims(result, axis)
    return result


__all__ = [
    "__array_namespace_info__",
    "count_nonzero",
    "bool",
    "int8", "int16", "int32", "int64",
    "uint8", "uint16", "uint32", "uint64",
    "float32", "float64",
    "complex64", "complex128",
    "asarray", "astype", "can_cast", "result_type",
    "pow",
    "concat",
    "acos", "acosh", "asin", "asinh", "atan", "atan2", "atanh",
    "bitwise_left_shift", "bitwise_right_shift", "bitwise_invert",
]  # fmt: skip
__all__ += _aliases.__all__
_all_ignore = ["array_namespace", "get_xp", "da", "np"]


def __dir__() -> list[str]:
    return __all__
