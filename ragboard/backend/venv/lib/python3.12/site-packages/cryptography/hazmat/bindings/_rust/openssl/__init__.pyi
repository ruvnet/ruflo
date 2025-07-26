# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

import typing

from cryptography.hazmat.bindings._rust.openssl import (
    aead,
    ciphers,
    cmac,
    dh,
    dsa,
    ec,
    ed448,
    ed25519,
    hashes,
    hmac,
    kdf,
    keys,
    poly1305,
    rsa,
    x448,
    x25519,
)

__all__ = [
    "aead",
    "ciphers",
    "cmac",
    "dh",
    "dsa",
    "ec",
    "ed448",
    "ed25519",
    "hashes",
    "hmac",
    "kdf",
    "keys",
    "openssl_version",
    "openssl_version_text",
    "poly1305",
    "raise_openssl_error",
    "rsa",
    "x448",
    "x25519",
]

CRYPTOGRAPHY_IS_LIBRESSL: bool
CRYPTOGRAPHY_IS_BORINGSSL: bool
CRYPTOGRAPHY_IS_AWSLC: bool
CRYPTOGRAPHY_OPENSSL_300_OR_GREATER: bool
CRYPTOGRAPHY_OPENSSL_309_OR_GREATER: bool
CRYPTOGRAPHY_OPENSSL_320_OR_GREATER: bool
CRYPTOGRAPHY_OPENSSL_330_OR_GREATER: bool
CRYPTOGRAPHY_OPENSSL_350_OR_GREATER: bool

class Providers: ...

_legacy_provider_loaded: bool
_providers: Providers

def openssl_version() -> int: ...
def openssl_version_text() -> str: ...
def raise_openssl_error() -> typing.NoReturn: ...
def capture_error_stack() -> list[OpenSSLError]: ...
def is_fips_enabled() -> bool: ...
def enable_fips(providers: Providers) -> None: ...

class OpenSSLError:
    @property
    def lib(self) -> int: ...
    @property
    def reason(self) -> int: ...
    @property
    def reason_text(self) -> bytes: ...
