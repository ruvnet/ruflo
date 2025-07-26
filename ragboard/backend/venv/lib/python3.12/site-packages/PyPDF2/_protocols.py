"""Helpers for working with PDF types."""

from pathlib import Path
from typing import IO, Any, Dict, List, Optional, Tuple, Union

try:
    # Python 3.8+: https://peps.python.org/pep-0586
    from typing import Protocol  # type: ignore[attr-defined]
except ImportError:
    from typing_extensions import Protocol  # type: ignore[misc]

from ._utils import StrByteType


class PdfObjectProtocol(Protocol):
    indirect_reference: Any

    def clone(
        self,
        pdf_dest: Any,
        force_duplicate: bool = False,
        ignore_fields: Union[Tuple[str, ...], List[str], None] = (),
    ) -> Any:
        ...

    def _reference_clone(self, clone: Any, pdf_dest: Any) -> Any:
        ...

    def get_object(self) -> Optional["PdfObjectProtocol"]:
        ...


class PdfReaderProtocol(Protocol):  # pragma: no cover
    @property
    def pdf_header(self) -> str:
        ...

    @property
    def strict(self) -> bool:
        ...

    @property
    def xref(self) -> Dict[int, Dict[int, Any]]:
        ...

    @property
    def pages(self) -> List[Any]:
        ...

    def get_object(self, indirect_reference: Any) -> Optional[PdfObjectProtocol]:
        ...


class PdfWriterProtocol(Protocol):  # pragma: no cover
    _objects: List[Any]
    _id_translated: Dict[int, Dict[int, int]]

    def get_object(self, indirect_reference: Any) -> Optional[PdfObjectProtocol]:
        ...

    def write(self, stream: Union[Path, StrByteType]) -> Tuple[bool, IO]:
        ...
