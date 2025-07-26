# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

from cryptography.hazmat.bindings._rust import openssl as rust_openssl

__all__ = [
    "AESCCM",
    "AESGCM",
    "AESGCMSIV",
    "AESOCB3",
    "AESSIV",
    "ChaCha20Poly1305",
]

AESGCM = rust_openssl.aead.AESGCM
ChaCha20Poly1305 = rust_openssl.aead.ChaCha20Poly1305
AESCCM = rust_openssl.aead.AESCCM
AESSIV = rust_openssl.aead.AESSIV
AESOCB3 = rust_openssl.aead.AESOCB3
AESGCMSIV = rust_openssl.aead.AESGCMSIV
