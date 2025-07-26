from __future__ import annotations

import io
from typing import Callable
from typing_extensions import override


class CancelledError(Exception):
    def __init__(self, msg: str) -> None:
        self.msg = msg
        super().__init__(msg)

    @override
    def __str__(self) -> str:
        return self.msg

    __repr__ = __str__


class BufferReader(io.BytesIO):
    def __init__(self, buf: bytes = b"", desc: str | None = None) -> None:
        super().__init__(buf)
        self._len = len(buf)
        self._progress = 0
        self._callback = progress(len(buf), desc=desc)

    def __len__(self) -> int:
        return self._len

    @override
    def read(self, n: int | None = -1) -> bytes:
        chunk = io.BytesIO.read(self, n)
        self._progress += len(chunk)

        try:
            self._callback(self._progress)
        except Exception as e:  # catches exception from the callback
            raise CancelledError("The upload was cancelled: {}".format(e)) from e

        return chunk


def progress(total: float, desc: str | None) -> Callable[[float], None]:
    import tqdm

    meter = tqdm.tqdm(total=total, unit_scale=True, desc=desc)

    def incr(progress: float) -> None:
        meter.n = progress
        if progress == total:
            meter.close()
        else:
            meter.refresh()

    return incr


def MB(i: int) -> int:
    return int(i // 1024**2)
