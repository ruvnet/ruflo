# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import abc

from cryptography import utils
from cryptography.hazmat.bindings._rust import (
    ANSIX923PaddingContext,
    ANSIX923UnpaddingContext,
    PKCS7PaddingContext,
    PKCS7UnpaddingContext,
)


class PaddingContext(metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def update(self, data: utils.Buffer) -> bytes:
        """
        Pads the provided bytes and returns any available data as bytes.
        """

    @abc.abstractmethod
    def finalize(self) -> bytes:
        """
        Finalize the padding, returns bytes.
        """


def _byte_padding_check(block_size: int) -> None:
    if not (0 <= block_size <= 2040):
        raise ValueError("block_size must be in range(0, 2041).")

    if block_size % 8 != 0:
        raise ValueError("block_size must be a multiple of 8.")


class PKCS7:
    def __init__(self, block_size: int):
        _byte_padding_check(block_size)
        self.block_size = block_size

    def padder(self) -> PaddingContext:
        return PKCS7PaddingContext(self.block_size)

    def unpadder(self) -> PaddingContext:
        return PKCS7UnpaddingContext(self.block_size)


PaddingContext.register(PKCS7PaddingContext)
PaddingContext.register(PKCS7UnpaddingContext)


class ANSIX923:
    def __init__(self, block_size: int):
        _byte_padding_check(block_size)
        self.block_size = block_size

    def padder(self) -> PaddingContext:
        return ANSIX923PaddingContext(self.block_size)

    def unpadder(self) -> PaddingContext:
        return ANSIX923UnpaddingContext(self.block_size)


PaddingContext.register(ANSIX923PaddingContext)
PaddingContext.register(ANSIX923UnpaddingContext)
