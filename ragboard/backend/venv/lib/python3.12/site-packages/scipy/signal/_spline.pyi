
import numpy as np
from numpy.typing import NDArray

FloatingArray = NDArray[np.float32] | NDArray[np.float64]
ComplexArray = NDArray[np.complex64] | NDArray[np.complex128]
FloatingComplexArray = FloatingArray | ComplexArray


def symiirorder1_ic(signal: FloatingComplexArray,
                    c0: float,
                    z1: float,
                    precision: float) -> FloatingComplexArray:
    ...


def symiirorder2_ic_fwd(signal: FloatingArray,
                        r: float,
                        omega: float,
                        precision: float) -> FloatingArray:
    ...


def symiirorder2_ic_bwd(signal: FloatingArray,
                        r: float,
                        omega: float,
                        precision: float) -> FloatingArray:
    ...


def sepfir2d(input: FloatingComplexArray,
             hrow: FloatingComplexArray,
             hcol: FloatingComplexArray) -> FloatingComplexArray:
    ...
