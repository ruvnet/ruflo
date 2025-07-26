from __future__ import annotations

from typing import TYPE_CHECKING, Any
from typing_extensions import override

from .._utils import LazyProxy
from ._common import MissingDependencyError, format_instructions

if TYPE_CHECKING:
    import pandas as pandas


PANDAS_INSTRUCTIONS = format_instructions(library="pandas", extra="datalib")


class PandasProxy(LazyProxy[Any]):
    @override
    def __load__(self) -> Any:
        try:
            import pandas
        except ImportError as err:
            raise MissingDependencyError(PANDAS_INSTRUCTIONS) from err

        return pandas


if not TYPE_CHECKING:
    pandas = PandasProxy()
