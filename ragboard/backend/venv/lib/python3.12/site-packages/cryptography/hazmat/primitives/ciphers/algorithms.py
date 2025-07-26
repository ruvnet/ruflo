# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

from cryptography import utils
from cryptography.hazmat.decrepit.ciphers.algorithms import (
    ARC4 as ARC4,
)
from cryptography.hazmat.decrepit.ciphers.algorithms import (
    CAST5 as CAST5,
)
from cryptography.hazmat.decrepit.ciphers.algorithms import (
    IDEA as IDEA,
)
from cryptography.hazmat.decrepit.ciphers.algorithms import (
    SEED as SEED,
)
from cryptography.hazmat.decrepit.ciphers.algorithms import (
    Blowfish as Blowfish,
)
from cryptography.hazmat.decrepit.ciphers.algorithms import (
    TripleDES as TripleDES,
)
from cryptography.hazmat.primitives._cipheralgorithm import _verify_key_size
from cryptography.hazmat.primitives.ciphers import (
    BlockCipherAlgorithm,
    CipherAlgorithm,
)


class AES(BlockCipherAlgorithm):
    name = "AES"
    block_size = 128
    # 512 added to support AES-256-XTS, which uses 512-bit keys
    key_sizes = frozenset([128, 192, 256, 512])

    def __init__(self, key: utils.Buffer):
        self.key = _verify_key_size(self, key)

    @property
    def key_size(self) -> int:
        return len(self.key) * 8


class AES128(BlockCipherAlgorithm):
    name = "AES"
    block_size = 128
    key_sizes = frozenset([128])
    key_size = 128

    def __init__(self, key: utils.Buffer):
        self.key = _verify_key_size(self, key)


class AES256(BlockCipherAlgorithm):
    name = "AES"
    block_size = 128
    key_sizes = frozenset([256])
    key_size = 256

    def __init__(self, key: utils.Buffer):
        self.key = _verify_key_size(self, key)


class Camellia(BlockCipherAlgorithm):
    name = "camellia"
    block_size = 128
    key_sizes = frozenset([128, 192, 256])

    def __init__(self, key: utils.Buffer):
        self.key = _verify_key_size(self, key)

    @property
    def key_size(self) -> int:
        return len(self.key) * 8


utils.deprecated(
    ARC4,
    __name__,
    "ARC4 has been moved to "
    "cryptography.hazmat.decrepit.ciphers.algorithms.ARC4 and "
    "will be removed from "
    "cryptography.hazmat.primitives.ciphers.algorithms in 48.0.0.",
    utils.DeprecatedIn43,
    name="ARC4",
)


utils.deprecated(
    TripleDES,
    __name__,
    "TripleDES has been moved to "
    "cryptography.hazmat.decrepit.ciphers.algorithms.TripleDES and "
    "will be removed from "
    "cryptography.hazmat.primitives.ciphers.algorithms in 48.0.0.",
    utils.DeprecatedIn43,
    name="TripleDES",
)

utils.deprecated(
    Blowfish,
    __name__,
    "Blowfish has been moved to "
    "cryptography.hazmat.decrepit.ciphers.algorithms.Blowfish and "
    "will be removed from "
    "cryptography.hazmat.primitives.ciphers.algorithms in 45.0.0.",
    utils.DeprecatedIn37,
    name="Blowfish",
)


utils.deprecated(
    CAST5,
    __name__,
    "CAST5 has been moved to "
    "cryptography.hazmat.decrepit.ciphers.algorithms.CAST5 and "
    "will be removed from "
    "cryptography.hazmat.primitives.ciphers.algorithms in 45.0.0.",
    utils.DeprecatedIn37,
    name="CAST5",
)


utils.deprecated(
    IDEA,
    __name__,
    "IDEA has been moved to "
    "cryptography.hazmat.decrepit.ciphers.algorithms.IDEA and "
    "will be removed from "
    "cryptography.hazmat.primitives.ciphers.algorithms in 45.0.0.",
    utils.DeprecatedIn37,
    name="IDEA",
)


utils.deprecated(
    SEED,
    __name__,
    "SEED has been moved to "
    "cryptography.hazmat.decrepit.ciphers.algorithms.SEED and "
    "will be removed from "
    "cryptography.hazmat.primitives.ciphers.algorithms in 45.0.0.",
    utils.DeprecatedIn37,
    name="SEED",
)


class ChaCha20(CipherAlgorithm):
    name = "ChaCha20"
    key_sizes = frozenset([256])

    def __init__(self, key: utils.Buffer, nonce: utils.Buffer):
        self.key = _verify_key_size(self, key)
        utils._check_byteslike("nonce", nonce)

        if len(nonce) != 16:
            raise ValueError("nonce must be 128-bits (16 bytes)")

        self._nonce = nonce

    @property
    def nonce(self) -> utils.Buffer:
        return self._nonce

    @property
    def key_size(self) -> int:
        return len(self.key) * 8


class SM4(BlockCipherAlgorithm):
    name = "SM4"
    block_size = 128
    key_sizes = frozenset([128])

    def __init__(self, key: bytes):
        self.key = _verify_key_size(self, key)

    @property
    def key_size(self) -> int:
        return len(self.key) * 8
