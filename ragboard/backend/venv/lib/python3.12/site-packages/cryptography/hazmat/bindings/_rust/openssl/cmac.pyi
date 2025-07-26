# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

import typing

from cryptography.hazmat.primitives import ciphers

class CMAC:
    def __init__(
        self,
        algorithm: ciphers.BlockCipherAlgorithm,
        backend: typing.Any = None,
    ) -> None: ...
    def update(self, data: bytes) -> None: ...
    def finalize(self) -> bytes: ...
    def verify(self, signature: bytes) -> None: ...
    def copy(self) -> CMAC: ...
