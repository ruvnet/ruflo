# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

import typing

from cryptography.hazmat.primitives.asymmetric import rsa

class RSAPrivateKey: ...
class RSAPublicKey: ...

class RSAPrivateNumbers:
    def __init__(
        self,
        p: int,
        q: int,
        d: int,
        dmp1: int,
        dmq1: int,
        iqmp: int,
        public_numbers: RSAPublicNumbers,
    ) -> None: ...
    @property
    def p(self) -> int: ...
    @property
    def q(self) -> int: ...
    @property
    def d(self) -> int: ...
    @property
    def dmp1(self) -> int: ...
    @property
    def dmq1(self) -> int: ...
    @property
    def iqmp(self) -> int: ...
    @property
    def public_numbers(self) -> RSAPublicNumbers: ...
    def private_key(
        self,
        backend: typing.Any = None,
        *,
        unsafe_skip_rsa_key_validation: bool = False,
    ) -> rsa.RSAPrivateKey: ...

class RSAPublicNumbers:
    def __init__(self, e: int, n: int) -> None: ...
    @property
    def n(self) -> int: ...
    @property
    def e(self) -> int: ...
    def public_key(self, backend: typing.Any = None) -> rsa.RSAPublicKey: ...

def generate_private_key(
    public_exponent: int,
    key_size: int,
) -> rsa.RSAPrivateKey: ...
