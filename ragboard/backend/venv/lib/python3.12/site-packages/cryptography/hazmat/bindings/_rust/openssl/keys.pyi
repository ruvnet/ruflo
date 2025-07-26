# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

import typing

from cryptography.hazmat.primitives.asymmetric.types import (
    PrivateKeyTypes,
    PublicKeyTypes,
)
from cryptography.utils import Buffer

def load_der_private_key(
    data: Buffer,
    password: bytes | None,
    backend: typing.Any = None,
    *,
    unsafe_skip_rsa_key_validation: bool = False,
) -> PrivateKeyTypes: ...
def load_pem_private_key(
    data: Buffer,
    password: bytes | None,
    backend: typing.Any = None,
    *,
    unsafe_skip_rsa_key_validation: bool = False,
) -> PrivateKeyTypes: ...
def load_der_public_key(
    data: bytes,
    backend: typing.Any = None,
) -> PublicKeyTypes: ...
def load_pem_public_key(
    data: bytes,
    backend: typing.Any = None,
) -> PublicKeyTypes: ...
