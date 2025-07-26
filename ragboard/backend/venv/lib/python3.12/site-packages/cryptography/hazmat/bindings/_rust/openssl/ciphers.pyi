# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

import typing

from cryptography.hazmat.primitives import ciphers
from cryptography.hazmat.primitives.ciphers import modes

@typing.overload
def create_encryption_ctx(
    algorithm: ciphers.CipherAlgorithm, mode: modes.ModeWithAuthenticationTag
) -> ciphers.AEADEncryptionContext: ...
@typing.overload
def create_encryption_ctx(
    algorithm: ciphers.CipherAlgorithm, mode: modes.Mode | None
) -> ciphers.CipherContext: ...
@typing.overload
def create_decryption_ctx(
    algorithm: ciphers.CipherAlgorithm, mode: modes.ModeWithAuthenticationTag
) -> ciphers.AEADDecryptionContext: ...
@typing.overload
def create_decryption_ctx(
    algorithm: ciphers.CipherAlgorithm, mode: modes.Mode | None
) -> ciphers.CipherContext: ...
def cipher_supported(
    algorithm: ciphers.CipherAlgorithm, mode: modes.Mode
) -> bool: ...
def _advance(
    ctx: ciphers.AEADEncryptionContext | ciphers.AEADDecryptionContext, n: int
) -> None: ...
def _advance_aad(
    ctx: ciphers.AEADEncryptionContext | ciphers.AEADDecryptionContext, n: int
) -> None: ...

class CipherContext: ...
class AEADEncryptionContext: ...
class AEADDecryptionContext: ...
