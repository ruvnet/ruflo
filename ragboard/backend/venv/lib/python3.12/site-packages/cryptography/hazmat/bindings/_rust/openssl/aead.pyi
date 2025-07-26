# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from collections.abc import Sequence

from cryptography.utils import Buffer

class AESGCM:
    def __init__(self, key: Buffer) -> None: ...
    @staticmethod
    def generate_key(bit_length: int) -> bytes: ...
    def encrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...
    def decrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...

class ChaCha20Poly1305:
    def __init__(self, key: Buffer) -> None: ...
    @staticmethod
    def generate_key() -> bytes: ...
    def encrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...
    def decrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...

class AESCCM:
    def __init__(self, key: Buffer, tag_length: int = 16) -> None: ...
    @staticmethod
    def generate_key(bit_length: int) -> bytes: ...
    def encrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...
    def decrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...

class AESSIV:
    def __init__(self, key: Buffer) -> None: ...
    @staticmethod
    def generate_key(bit_length: int) -> bytes: ...
    def encrypt(
        self,
        data: Buffer,
        associated_data: Sequence[Buffer] | None,
    ) -> bytes: ...
    def decrypt(
        self,
        data: Buffer,
        associated_data: Sequence[Buffer] | None,
    ) -> bytes: ...

class AESOCB3:
    def __init__(self, key: Buffer) -> None: ...
    @staticmethod
    def generate_key(bit_length: int) -> bytes: ...
    def encrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...
    def decrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...

class AESGCMSIV:
    def __init__(self, key: Buffer) -> None: ...
    @staticmethod
    def generate_key(bit_length: int) -> bytes: ...
    def encrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...
    def decrypt(
        self,
        nonce: Buffer,
        data: Buffer,
        associated_data: Buffer | None,
    ) -> bytes: ...
