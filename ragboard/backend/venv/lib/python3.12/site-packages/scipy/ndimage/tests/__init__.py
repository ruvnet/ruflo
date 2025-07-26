import numpy as np

# list of numarray data types
integer_types: list[str] = [
    "int8", "uint8", "int16", "uint16",
    "int32", "uint32", "int64", "uint64"]

float_types: list[str] = ["float32", "float64"]

complex_types: list[str] = ["complex64", "complex128"]

types: list[str] = integer_types + float_types
