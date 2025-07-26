# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

import typing
from collections.abc import Iterable

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric.types import PrivateKeyTypes
from cryptography.hazmat.primitives.serialization import (
    KeySerializationEncryption,
)
from cryptography.hazmat.primitives.serialization.pkcs12 import (
    PKCS12KeyAndCertificates,
    PKCS12PrivateKeyTypes,
)
from cryptography.utils import Buffer

class PKCS12Certificate:
    def __init__(
        self, cert: x509.Certificate, friendly_name: bytes | None
    ) -> None: ...
    @property
    def friendly_name(self) -> bytes | None: ...
    @property
    def certificate(self) -> x509.Certificate: ...

def load_key_and_certificates(
    data: Buffer,
    password: Buffer | None,
    backend: typing.Any = None,
) -> tuple[
    PrivateKeyTypes | None,
    x509.Certificate | None,
    list[x509.Certificate],
]: ...
def load_pkcs12(
    data: bytes,
    password: bytes | None,
    backend: typing.Any = None,
) -> PKCS12KeyAndCertificates: ...
def serialize_java_truststore(
    certs: Iterable[PKCS12Certificate],
    encryption_algorithm: KeySerializationEncryption,
) -> bytes: ...
def serialize_key_and_certificates(
    name: bytes | None,
    key: PKCS12PrivateKeyTypes | None,
    cert: x509.Certificate | None,
    cas: Iterable[x509.Certificate | PKCS12Certificate] | None,
    encryption_algorithm: KeySerializationEncryption,
) -> bytes: ...
