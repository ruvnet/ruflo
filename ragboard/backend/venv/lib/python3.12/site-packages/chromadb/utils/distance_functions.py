"""
These functions match what the spec of hnswlib is.
"""
from typing import Union, cast
import numpy as np
from numpy.typing import NDArray

Vector = NDArray[Union[np.int32, np.float32, np.int16, np.float16]]


def l2(x: Vector, y: Vector) -> float:
    return (np.linalg.norm(x - y) ** 2).item()


def cosine(x: Vector, y: Vector) -> float:
    # This epsilon is used to prevent division by zero, and the value is the same
    # https://github.com/nmslib/hnswlib/blob/359b2ba87358224963986f709e593d799064ace6/python_bindings/bindings.cpp#L238

    # We need to adapt the epsilon to the precision of the input
    NORM_EPS = 1e-30
    if x.dtype == np.float16 or y.dtype == np.float16:
        NORM_EPS = 1e-7
    return cast(
        float,
        (
            1.0 - np.dot(x, y) / ((np.linalg.norm(x) * np.linalg.norm(y)) + NORM_EPS)
        ).item(),
    )


def ip(x: Vector, y: Vector) -> float:
    return cast(float, (1.0 - np.dot(x, y)).item())
