# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from collections.abc import Iterable

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7

def serialize_certificates(
    certs: list[x509.Certificate],
    encoding: serialization.Encoding,
) -> bytes: ...
def encrypt_and_serialize(
    builder: pkcs7.PKCS7EnvelopeBuilder,
    content_encryption_algorithm: pkcs7.ContentEncryptionAlgorithm,
    encoding: serialization.Encoding,
    options: Iterable[pkcs7.PKCS7Options],
) -> bytes: ...
def sign_and_serialize(
    builder: pkcs7.PKCS7SignatureBuilder,
    encoding: serialization.Encoding,
    options: Iterable[pkcs7.PKCS7Options],
) -> bytes: ...
def decrypt_der(
    data: bytes,
    certificate: x509.Certificate,
    private_key: rsa.RSAPrivateKey,
    options: Iterable[pkcs7.PKCS7Options],
) -> bytes: ...
def decrypt_pem(
    data: bytes,
    certificate: x509.Certificate,
    private_key: rsa.RSAPrivateKey,
    options: Iterable[pkcs7.PKCS7Options],
) -> bytes: ...
def decrypt_smime(
    data: bytes,
    certificate: x509.Certificate,
    private_key: rsa.RSAPrivateKey,
    options: Iterable[pkcs7.PKCS7Options],
) -> bytes: ...
def load_pem_pkcs7_certificates(
    data: bytes,
) -> list[x509.Certificate]: ...
def load_der_pkcs7_certificates(
    data: bytes,
) -> list[x509.Certificate]: ...
