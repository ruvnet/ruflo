# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import sys

from cryptography.hazmat.bindings._rust import openssl as rust_openssl
from cryptography.hazmat.primitives.kdf import KeyDerivationFunction

# This is used by the scrypt tests to skip tests that require more memory
# than the MEM_LIMIT
_MEM_LIMIT = sys.maxsize // 2

Scrypt = rust_openssl.kdf.Scrypt
KeyDerivationFunction.register(Scrypt)

__all__ = ["Scrypt"]
