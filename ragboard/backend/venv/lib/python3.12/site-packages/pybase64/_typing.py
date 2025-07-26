from __future__ import annotations

import sys
from typing import Protocol

if sys.version_info < (3, 12):
    from typing_extensions import Buffer
else:
    from collections.abc import Buffer


class Decode(Protocol):
    __name__: str
    __module__: str

    def __call__(
        self, s: str | Buffer, altchars: str | Buffer | None = None, validate: bool = False
    ) -> bytes: ...


class Encode(Protocol):
    __name__: str
    __module__: str

    def __call__(self, s: Buffer, altchars: Buffer | None = None) -> bytes: ...


class EncodeBytes(Protocol):
    __name__: str
    __module__: str

    def __call__(self, s: Buffer) -> bytes: ...


__all__ = ("Buffer", "Decode", "Encode", "EncodeBytes")
