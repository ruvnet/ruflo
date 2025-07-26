# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import typing
from collections.abc import Iterable

from cryptography import x509
from cryptography.hazmat.bindings._rust import pkcs12 as rust_pkcs12
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives._serialization import PBES as PBES
from cryptography.hazmat.primitives.asymmetric import (
    dsa,
    ec,
    ed448,
    ed25519,
    rsa,
)
from cryptography.hazmat.primitives.asymmetric.types import PrivateKeyTypes

__all__ = [
    "PBES",
    "PKCS12Certificate",
    "PKCS12KeyAndCertificates",
    "PKCS12PrivateKeyTypes",
    "load_key_and_certificates",
    "load_pkcs12",
    "serialize_java_truststore",
    "serialize_key_and_certificates",
]

PKCS12PrivateKeyTypes = typing.Union[
    rsa.RSAPrivateKey,
    dsa.DSAPrivateKey,
    ec.EllipticCurvePrivateKey,
    ed25519.Ed25519PrivateKey,
    ed448.Ed448PrivateKey,
]


PKCS12Certificate = rust_pkcs12.PKCS12Certificate


class PKCS12KeyAndCertificates:
    def __init__(
        self,
        key: PrivateKeyTypes | None,
        cert: PKCS12Certificate | None,
        additional_certs: list[PKCS12Certificate],
    ):
        if key is not None and not isinstance(
            key,
            (
                rsa.RSAPrivateKey,
                dsa.DSAPrivateKey,
                ec.EllipticCurvePrivateKey,
                ed25519.Ed25519PrivateKey,
                ed448.Ed448PrivateKey,
            ),
        ):
            raise TypeError(
                "Key must be RSA, DSA, EllipticCurve, ED25519, or ED448"
                " private key, or None."
            )
        if cert is not None and not isinstance(cert, PKCS12Certificate):
            raise TypeError("cert must be a PKCS12Certificate object or None")
        if not all(
            isinstance(add_cert, PKCS12Certificate)
            for add_cert in additional_certs
        ):
            raise TypeError(
                "all values in additional_certs must be PKCS12Certificate"
                " objects"
            )
        self._key = key
        self._cert = cert
        self._additional_certs = additional_certs

    @property
    def key(self) -> PrivateKeyTypes | None:
        return self._key

    @property
    def cert(self) -> PKCS12Certificate | None:
        return self._cert

    @property
    def additional_certs(self) -> list[PKCS12Certificate]:
        return self._additional_certs

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, PKCS12KeyAndCertificates):
            return NotImplemented

        return (
            self.key == other.key
            and self.cert == other.cert
            and self.additional_certs == other.additional_certs
        )

    def __hash__(self) -> int:
        return hash((self.key, self.cert, tuple(self.additional_certs)))

    def __repr__(self) -> str:
        fmt = (
            "<PKCS12KeyAndCertificates(key={}, cert={}, additional_certs={})>"
        )
        return fmt.format(self.key, self.cert, self.additional_certs)


load_key_and_certificates = rust_pkcs12.load_key_and_certificates
load_pkcs12 = rust_pkcs12.load_pkcs12


_PKCS12CATypes = typing.Union[
    x509.Certificate,
    PKCS12Certificate,
]


def serialize_java_truststore(
    certs: Iterable[PKCS12Certificate],
    encryption_algorithm: serialization.KeySerializationEncryption,
) -> bytes:
    if not certs:
        raise ValueError("You must supply at least one cert")

    if not isinstance(
        encryption_algorithm, serialization.KeySerializationEncryption
    ):
        raise TypeError(
            "Key encryption algorithm must be a "
            "KeySerializationEncryption instance"
        )

    return rust_pkcs12.serialize_java_truststore(certs, encryption_algorithm)


def serialize_key_and_certificates(
    name: bytes | None,
    key: PKCS12PrivateKeyTypes | None,
    cert: x509.Certificate | None,
    cas: Iterable[_PKCS12CATypes] | None,
    encryption_algorithm: serialization.KeySerializationEncryption,
) -> bytes:
    if key is not None and not isinstance(
        key,
        (
            rsa.RSAPrivateKey,
            dsa.DSAPrivateKey,
            ec.EllipticCurvePrivateKey,
            ed25519.Ed25519PrivateKey,
            ed448.Ed448PrivateKey,
        ),
    ):
        raise TypeError(
            "Key must be RSA, DSA, EllipticCurve, ED25519, or ED448"
            " private key, or None."
        )

    if not isinstance(
        encryption_algorithm, serialization.KeySerializationEncryption
    ):
        raise TypeError(
            "Key encryption algorithm must be a "
            "KeySerializationEncryption instance"
        )

    if key is None and cert is None and not cas:
        raise ValueError("You must supply at least one of key, cert, or cas")

    return rust_pkcs12.serialize_key_and_certificates(
        name, key, cert, cas, encryption_algorithm
    )
