# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.utils import Buffer

class TestCertificate:
    not_after_tag: int
    not_before_tag: int
    issuer_value_tags: list[int]
    subject_value_tags: list[int]

def test_parse_certificate(data: bytes) -> TestCertificate: ...
def pkcs7_verify(
    encoding: serialization.Encoding,
    sig: bytes,
    msg: Buffer | None,
    certs: list[x509.Certificate],
    options: list[pkcs7.PKCS7Options],
) -> None: ...
