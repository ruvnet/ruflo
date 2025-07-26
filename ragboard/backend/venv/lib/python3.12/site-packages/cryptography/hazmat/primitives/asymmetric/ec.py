# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import abc
import typing

from cryptography import utils
from cryptography.exceptions import UnsupportedAlgorithm, _Reasons
from cryptography.hazmat._oid import ObjectIdentifier
from cryptography.hazmat.bindings._rust import openssl as rust_openssl
from cryptography.hazmat.primitives import _serialization, hashes
from cryptography.hazmat.primitives.asymmetric import utils as asym_utils


class EllipticCurveOID:
    SECP192R1 = ObjectIdentifier("1.2.840.10045.3.1.1")
    SECP224R1 = ObjectIdentifier("1.3.132.0.33")
    SECP256K1 = ObjectIdentifier("1.3.132.0.10")
    SECP256R1 = ObjectIdentifier("1.2.840.10045.3.1.7")
    SECP384R1 = ObjectIdentifier("1.3.132.0.34")
    SECP521R1 = ObjectIdentifier("1.3.132.0.35")
    BRAINPOOLP256R1 = ObjectIdentifier("1.3.36.3.3.2.8.1.1.7")
    BRAINPOOLP384R1 = ObjectIdentifier("1.3.36.3.3.2.8.1.1.11")
    BRAINPOOLP512R1 = ObjectIdentifier("1.3.36.3.3.2.8.1.1.13")
    SECT163K1 = ObjectIdentifier("1.3.132.0.1")
    SECT163R2 = ObjectIdentifier("1.3.132.0.15")
    SECT233K1 = ObjectIdentifier("1.3.132.0.26")
    SECT233R1 = ObjectIdentifier("1.3.132.0.27")
    SECT283K1 = ObjectIdentifier("1.3.132.0.16")
    SECT283R1 = ObjectIdentifier("1.3.132.0.17")
    SECT409K1 = ObjectIdentifier("1.3.132.0.36")
    SECT409R1 = ObjectIdentifier("1.3.132.0.37")
    SECT571K1 = ObjectIdentifier("1.3.132.0.38")
    SECT571R1 = ObjectIdentifier("1.3.132.0.39")


class EllipticCurve(metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def name(self) -> str:
        """
        The name of the curve. e.g. secp256r1.
        """

    @property
    @abc.abstractmethod
    def key_size(self) -> int:
        """
        Bit size of a secret scalar for the curve.
        """

    @property
    @abc.abstractmethod
    def group_order(self) -> int:
        """
        The order of the curve's group.
        """


class EllipticCurveSignatureAlgorithm(metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def algorithm(
        self,
    ) -> asym_utils.Prehashed | hashes.HashAlgorithm:
        """
        The digest algorithm used with this signature.
        """


class EllipticCurvePrivateKey(metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def exchange(
        self, algorithm: ECDH, peer_public_key: EllipticCurvePublicKey
    ) -> bytes:
        """
        Performs a key exchange operation using the provided algorithm with the
        provided peer's public key.
        """

    @abc.abstractmethod
    def public_key(self) -> EllipticCurvePublicKey:
        """
        The EllipticCurvePublicKey for this private key.
        """

    @property
    @abc.abstractmethod
    def curve(self) -> EllipticCurve:
        """
        The EllipticCurve that this key is on.
        """

    @property
    @abc.abstractmethod
    def key_size(self) -> int:
        """
        Bit size of a secret scalar for the curve.
        """

    @abc.abstractmethod
    def sign(
        self,
        data: utils.Buffer,
        signature_algorithm: EllipticCurveSignatureAlgorithm,
    ) -> bytes:
        """
        Signs the data
        """

    @abc.abstractmethod
    def private_numbers(self) -> EllipticCurvePrivateNumbers:
        """
        Returns an EllipticCurvePrivateNumbers.
        """

    @abc.abstractmethod
    def private_bytes(
        self,
        encoding: _serialization.Encoding,
        format: _serialization.PrivateFormat,
        encryption_algorithm: _serialization.KeySerializationEncryption,
    ) -> bytes:
        """
        Returns the key serialized as bytes.
        """

    @abc.abstractmethod
    def __copy__(self) -> EllipticCurvePrivateKey:
        """
        Returns a copy.
        """


EllipticCurvePrivateKeyWithSerialization = EllipticCurvePrivateKey
EllipticCurvePrivateKey.register(rust_openssl.ec.ECPrivateKey)


class EllipticCurvePublicKey(metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def curve(self) -> EllipticCurve:
        """
        The EllipticCurve that this key is on.
        """

    @property
    @abc.abstractmethod
    def key_size(self) -> int:
        """
        Bit size of a secret scalar for the curve.
        """

    @abc.abstractmethod
    def public_numbers(self) -> EllipticCurvePublicNumbers:
        """
        Returns an EllipticCurvePublicNumbers.
        """

    @abc.abstractmethod
    def public_bytes(
        self,
        encoding: _serialization.Encoding,
        format: _serialization.PublicFormat,
    ) -> bytes:
        """
        Returns the key serialized as bytes.
        """

    @abc.abstractmethod
    def verify(
        self,
        signature: utils.Buffer,
        data: utils.Buffer,
        signature_algorithm: EllipticCurveSignatureAlgorithm,
    ) -> None:
        """
        Verifies the signature of the data.
        """

    @classmethod
    def from_encoded_point(
        cls, curve: EllipticCurve, data: bytes
    ) -> EllipticCurvePublicKey:
        utils._check_bytes("data", data)

        if len(data) == 0:
            raise ValueError("data must not be an empty byte string")

        if data[0] not in [0x02, 0x03, 0x04]:
            raise ValueError("Unsupported elliptic curve point type")

        return rust_openssl.ec.from_public_bytes(curve, data)

    @abc.abstractmethod
    def __eq__(self, other: object) -> bool:
        """
        Checks equality.
        """

    @abc.abstractmethod
    def __copy__(self) -> EllipticCurvePublicKey:
        """
        Returns a copy.
        """


EllipticCurvePublicKeyWithSerialization = EllipticCurvePublicKey
EllipticCurvePublicKey.register(rust_openssl.ec.ECPublicKey)

EllipticCurvePrivateNumbers = rust_openssl.ec.EllipticCurvePrivateNumbers
EllipticCurvePublicNumbers = rust_openssl.ec.EllipticCurvePublicNumbers


class SECT571R1(EllipticCurve):
    name = "sect571r1"
    key_size = 570
    group_order = 0x3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE661CE18FF55987308059B186823851EC7DD9CA1161DE93D5174D66E8382E9BB2FE84E47  # noqa: E501


class SECT409R1(EllipticCurve):
    name = "sect409r1"
    key_size = 409
    group_order = 0x10000000000000000000000000000000000000000000000000001E2AAD6A612F33307BE5FA47C3C9E052F838164CD37D9A21173  # noqa: E501


class SECT283R1(EllipticCurve):
    name = "sect283r1"
    key_size = 283
    group_order = 0x3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEF90399660FC938A90165B042A7CEFADB307  # noqa: E501


class SECT233R1(EllipticCurve):
    name = "sect233r1"
    key_size = 233
    group_order = 0x1000000000000000000000000000013E974E72F8A6922031D2603CFE0D7


class SECT163R2(EllipticCurve):
    name = "sect163r2"
    key_size = 163
    group_order = 0x40000000000000000000292FE77E70C12A4234C33


class SECT571K1(EllipticCurve):
    name = "sect571k1"
    key_size = 571
    group_order = 0x20000000000000000000000000000000000000000000000000000000000000000000000131850E1F19A63E4B391A8DB917F4138B630D84BE5D639381E91DEB45CFE778F637C1001  # noqa: E501


class SECT409K1(EllipticCurve):
    name = "sect409k1"
    key_size = 409
    group_order = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE5F83B2D4EA20400EC4557D5ED3E3E7CA5B4B5C83B8E01E5FCF  # noqa: E501


class SECT283K1(EllipticCurve):
    name = "sect283k1"
    key_size = 283
    group_order = 0x1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE9AE2ED07577265DFF7F94451E061E163C61  # noqa: E501


class SECT233K1(EllipticCurve):
    name = "sect233k1"
    key_size = 233
    group_order = 0x8000000000000000000000000000069D5BB915BCD46EFB1AD5F173ABDF


class SECT163K1(EllipticCurve):
    name = "sect163k1"
    key_size = 163
    group_order = 0x4000000000000000000020108A2E0CC0D99F8A5EF


class SECP521R1(EllipticCurve):
    name = "secp521r1"
    key_size = 521
    group_order = 0x1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFA51868783BF2F966B7FCC0148F709A5D03BB5C9B8899C47AEBB6FB71E91386409  # noqa: E501


class SECP384R1(EllipticCurve):
    name = "secp384r1"
    key_size = 384
    group_order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF581A0DB248B0A77AECEC196ACCC52973  # noqa: E501


class SECP256R1(EllipticCurve):
    name = "secp256r1"
    key_size = 256
    group_order = (
        0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
    )


class SECP256K1(EllipticCurve):
    name = "secp256k1"
    key_size = 256
    group_order = (
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    )


class SECP224R1(EllipticCurve):
    name = "secp224r1"
    key_size = 224
    group_order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFF16A2E0B8F03E13DD29455C5C2A3D


class SECP192R1(EllipticCurve):
    name = "secp192r1"
    key_size = 192
    group_order = 0xFFFFFFFFFFFFFFFFFFFFFFFF99DEF836146BC9B1B4D22831


class BrainpoolP256R1(EllipticCurve):
    name = "brainpoolP256r1"
    key_size = 256
    group_order = (
        0xA9FB57DBA1EEA9BC3E660A909D838D718C397AA3B561A6F7901E0E82974856A7
    )


class BrainpoolP384R1(EllipticCurve):
    name = "brainpoolP384r1"
    key_size = 384
    group_order = 0x8CB91E82A3386D280F5D6F7E50E641DF152F7109ED5456B31F166E6CAC0425A7CF3AB6AF6B7FC3103B883202E9046565  # noqa: E501


class BrainpoolP512R1(EllipticCurve):
    name = "brainpoolP512r1"
    key_size = 512
    group_order = 0xAADD9DB8DBE9C48B3FD4E6AE33C9FC07CB308DB3B3C9D20ED6639CCA70330870553E5C414CA92619418661197FAC10471DB1D381085DDADDB58796829CA90069  # noqa: E501


_CURVE_TYPES: dict[str, EllipticCurve] = {
    "prime192v1": SECP192R1(),
    "prime256v1": SECP256R1(),
    "secp192r1": SECP192R1(),
    "secp224r1": SECP224R1(),
    "secp256r1": SECP256R1(),
    "secp384r1": SECP384R1(),
    "secp521r1": SECP521R1(),
    "secp256k1": SECP256K1(),
    "sect163k1": SECT163K1(),
    "sect233k1": SECT233K1(),
    "sect283k1": SECT283K1(),
    "sect409k1": SECT409K1(),
    "sect571k1": SECT571K1(),
    "sect163r2": SECT163R2(),
    "sect233r1": SECT233R1(),
    "sect283r1": SECT283R1(),
    "sect409r1": SECT409R1(),
    "sect571r1": SECT571R1(),
    "brainpoolP256r1": BrainpoolP256R1(),
    "brainpoolP384r1": BrainpoolP384R1(),
    "brainpoolP512r1": BrainpoolP512R1(),
}


class ECDSA(EllipticCurveSignatureAlgorithm):
    def __init__(
        self,
        algorithm: asym_utils.Prehashed | hashes.HashAlgorithm,
        deterministic_signing: bool = False,
    ):
        from cryptography.hazmat.backends.openssl.backend import backend

        if (
            deterministic_signing
            and not backend.ecdsa_deterministic_supported()
        ):
            raise UnsupportedAlgorithm(
                "ECDSA with deterministic signature (RFC 6979) is not "
                "supported by this version of OpenSSL.",
                _Reasons.UNSUPPORTED_PUBLIC_KEY_ALGORITHM,
            )
        self._algorithm = algorithm
        self._deterministic_signing = deterministic_signing

    @property
    def algorithm(
        self,
    ) -> asym_utils.Prehashed | hashes.HashAlgorithm:
        return self._algorithm

    @property
    def deterministic_signing(
        self,
    ) -> bool:
        return self._deterministic_signing


generate_private_key = rust_openssl.ec.generate_private_key


def derive_private_key(
    private_value: int,
    curve: EllipticCurve,
    backend: typing.Any = None,
) -> EllipticCurvePrivateKey:
    if not isinstance(private_value, int):
        raise TypeError("private_value must be an integer type.")

    if private_value <= 0:
        raise ValueError("private_value must be a positive integer.")

    return rust_openssl.ec.derive_private_key(private_value, curve)


class ECDH:
    pass


_OID_TO_CURVE = {
    EllipticCurveOID.SECP192R1: SECP192R1,
    EllipticCurveOID.SECP224R1: SECP224R1,
    EllipticCurveOID.SECP256K1: SECP256K1,
    EllipticCurveOID.SECP256R1: SECP256R1,
    EllipticCurveOID.SECP384R1: SECP384R1,
    EllipticCurveOID.SECP521R1: SECP521R1,
    EllipticCurveOID.BRAINPOOLP256R1: BrainpoolP256R1,
    EllipticCurveOID.BRAINPOOLP384R1: BrainpoolP384R1,
    EllipticCurveOID.BRAINPOOLP512R1: BrainpoolP512R1,
    EllipticCurveOID.SECT163K1: SECT163K1,
    EllipticCurveOID.SECT163R2: SECT163R2,
    EllipticCurveOID.SECT233K1: SECT233K1,
    EllipticCurveOID.SECT233R1: SECT233R1,
    EllipticCurveOID.SECT283K1: SECT283K1,
    EllipticCurveOID.SECT283R1: SECT283R1,
    EllipticCurveOID.SECT409K1: SECT409K1,
    EllipticCurveOID.SECT409R1: SECT409R1,
    EllipticCurveOID.SECT571K1: SECT571K1,
    EllipticCurveOID.SECT571R1: SECT571R1,
}


def get_curve_for_oid(oid: ObjectIdentifier) -> type[EllipticCurve]:
    try:
        return _OID_TO_CURVE[oid]
    except KeyError:
        raise LookupError(
            "The provided object identifier has no matching elliptic "
            "curve class"
        )
