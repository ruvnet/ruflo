from __future__ import annotations

from collections.abc import Mapping
from types import ModuleType as Namespace
from typing import (
    TYPE_CHECKING,
    Literal,
    Protocol,
    TypeAlias,
    TypedDict,
    TypeVar,
    final,
)

if TYPE_CHECKING:
    from _typeshed import Incomplete

    SupportsBufferProtocol: TypeAlias = Incomplete
    Array: TypeAlias = Incomplete
    Device: TypeAlias = Incomplete
    DType: TypeAlias = Incomplete
else:
    SupportsBufferProtocol = object
    Array = object
    Device = object
    DType = object


_T_co = TypeVar("_T_co", covariant=True)


# These "Just" types are equivalent to the `Just` type from the `optype` library,
# apart from them not being `@runtime_checkable`.
# - docs: https://github.com/jorenham/optype/blob/master/README.md#just
# - code: https://github.com/jorenham/optype/blob/master/optype/_core/_just.py
@final
class JustInt(Protocol):
    @property
    def __class__(self, /) -> type[int]: ...
    @__class__.setter
    def __class__(self, value: type[int], /) -> None: ...  # pyright: ignore[reportIncompatibleMethodOverride]


@final
class JustFloat(Protocol):
    @property
    def __class__(self, /) -> type[float]: ...
    @__class__.setter
    def __class__(self, value: type[float], /) -> None: ...  # pyright: ignore[reportIncompatibleMethodOverride]


@final
class JustComplex(Protocol):
    @property
    def __class__(self, /) -> type[complex]: ...
    @__class__.setter
    def __class__(self, value: type[complex], /) -> None: ...  # pyright: ignore[reportIncompatibleMethodOverride]


#


class NestedSequence(Protocol[_T_co]):
    def __getitem__(self, key: int, /) -> _T_co | NestedSequence[_T_co]: ...
    def __len__(self, /) -> int: ...


class SupportsArrayNamespace(Protocol[_T_co]):
    def __array_namespace__(self, /, *, api_version: str | None) -> _T_co: ...


class HasShape(Protocol[_T_co]):
    @property
    def shape(self, /) -> _T_co: ...


# Return type of `__array_namespace_info__.default_dtypes`
Capabilities = TypedDict(
    "Capabilities",
    {
        "boolean indexing": bool,
        "data-dependent shapes": bool,
        "max dimensions": int,
    },
)

# Return type of `__array_namespace_info__.default_dtypes`
DefaultDTypes = TypedDict(
    "DefaultDTypes",
    {
        "real floating": DType,
        "complex floating": DType,
        "integral": DType,
        "indexing": DType,
    },
)


_DTypeKind: TypeAlias = Literal[
    "bool",
    "signed integer",
    "unsigned integer",
    "integral",
    "real floating",
    "complex floating",
    "numeric",
]
# Type of the `kind` parameter in `__array_namespace_info__.dtypes`
DTypeKind: TypeAlias = _DTypeKind | tuple[_DTypeKind, ...]


# `__array_namespace_info__.dtypes(kind="bool")`
class DTypesBool(TypedDict):
    bool: DType


# `__array_namespace_info__.dtypes(kind="signed integer")`
class DTypesSigned(TypedDict):
    int8: DType
    int16: DType
    int32: DType
    int64: DType


# `__array_namespace_info__.dtypes(kind="unsigned integer")`
class DTypesUnsigned(TypedDict):
    uint8: DType
    uint16: DType
    uint32: DType
    uint64: DType


# `__array_namespace_info__.dtypes(kind="integral")`
class DTypesIntegral(DTypesSigned, DTypesUnsigned):
    pass


# `__array_namespace_info__.dtypes(kind="real floating")`
class DTypesReal(TypedDict):
    float32: DType
    float64: DType


# `__array_namespace_info__.dtypes(kind="complex floating")`
class DTypesComplex(TypedDict):
    complex64: DType
    complex128: DType


# `__array_namespace_info__.dtypes(kind="numeric")`
class DTypesNumeric(DTypesIntegral, DTypesReal, DTypesComplex):
    pass


# `__array_namespace_info__.dtypes(kind=None)` (default)
class DTypesAll(DTypesBool, DTypesNumeric):
    pass


# `__array_namespace_info__.dtypes(kind=?)` (fallback)
DTypesAny: TypeAlias = Mapping[str, DType]


__all__ = [
    "Array",
    "Capabilities",
    "DType",
    "DTypeKind",
    "DTypesAny",
    "DTypesAll",
    "DTypesBool",
    "DTypesNumeric",
    "DTypesIntegral",
    "DTypesSigned",
    "DTypesUnsigned",
    "DTypesReal",
    "DTypesComplex",
    "DefaultDTypes",
    "Device",
    "HasShape",
    "Namespace",
    "JustInt",
    "JustFloat",
    "JustComplex",
    "NestedSequence",
    "SupportsArrayNamespace",
    "SupportsBufferProtocol",
]


def __dir__() -> list[str]:
    return __all__
