from __future__ import annotations

__all__ = ["Array", "DType", "Device"]
_all_ignore = ["cp"]

from typing import TYPE_CHECKING

import cupy as cp
from cupy import ndarray as Array
from cupy.cuda.device import Device

if TYPE_CHECKING:
    # NumPy 1.x on Python 3.10 fails to parse np.dtype[]
    DType = cp.dtype[
        cp.intp
        | cp.int8
        | cp.int16
        | cp.int32
        | cp.int64
        | cp.uint8
        | cp.uint16
        | cp.uint32
        | cp.uint64
        | cp.float32
        | cp.float64
        | cp.complex64
        | cp.complex128
        | cp.bool_
    ]
else:
    DType = cp.dtype
