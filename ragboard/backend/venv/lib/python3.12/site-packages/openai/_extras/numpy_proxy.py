from __future__ import annotations

from typing import TYPE_CHECKING, Any
from typing_extensions import override

from .._utils import LazyProxy
from ._common import MissingDependencyError, format_instructions

if TYPE_CHECKING:
    import numpy as numpy


NUMPY_INSTRUCTIONS = format_instructions(library="numpy", extra="datalib")


class NumpyProxy(LazyProxy[Any]):
    @override
    def __load__(self) -> Any:
        try:
            import numpy
        except ImportError as err:
            raise MissingDependencyError(NUMPY_INSTRUCTIONS) from err

        return numpy


if not TYPE_CHECKING:
    numpy = NumpyProxy()


def has_numpy() -> bool:
    try:
        import numpy  # noqa: F401  # pyright: ignore[reportUnusedImport]
    except ImportError:
        return False

    return True
