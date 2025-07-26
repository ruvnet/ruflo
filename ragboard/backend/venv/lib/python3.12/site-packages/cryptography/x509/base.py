# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import abc
import datetime
import os
import typing
import warnings
from collections.abc import Iterable

from cryptography import utils
from cryptography.hazmat.bindings._rust import x509 as rust_x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import (
    dsa,
    ec,
    ed448,
    ed25519,
    padding,
    rsa,
    x448,
    x25519,
)
from cryptography.hazmat.primitives.asymmetric.types import (
    CertificateIssuerPrivateKeyTypes,
    CertificatePublicKeyTypes,
)
from cryptography.x509.extensions import (
    Extension,
    Extensions,
    ExtensionType,
    _make_sequence_methods,
)
from cryptography.x509.name import Name, _ASN1Type
from cryptography.x509.oid import ObjectIdentifier

_EARLIEST_UTC_TIME = datetime.datetime(1950, 1, 1)

# This must be kept in sync with sign.rs's list of allowable types in
# identify_hash_type
_AllowedHashTypes = typing.Union[
    hashes.SHA224,
    hashes.SHA256,
    hashes.SHA384,
    hashes.SHA512,
    hashes.SHA3_224,
    hashes.SHA3_256,
    hashes.SHA3_384,
    hashes.SHA3_512,
]


class AttributeNotFound(Exception):
    def __init__(self, msg: str, oid: ObjectIdentifier) -> None:
        super().__init__(msg)
        self.oid = oid


def _reject_duplicate_extension(
    extension: Extension[ExtensionType],
    extensions: list[Extension[ExtensionType]],
) -> None:
    # This is quadratic in the number of extensions
    for e in extensions:
        if e.oid == extension.oid:
            raise ValueError("This extension has already been set.")


def _reject_duplicate_attribute(
    oid: ObjectIdentifier,
    attributes: list[tuple[ObjectIdentifier, bytes, int | None]],
) -> None:
    # This is quadratic in the number of attributes
    for attr_oid, _, _ in attributes:
        if attr_oid == oid:
            raise ValueError("This attribute has already been set.")


def _convert_to_naive_utc_time(time: datetime.datetime) -> datetime.datetime:
    """Normalizes a datetime to a naive datetime in UTC.

    time -- datetime to normalize. Assumed to be in UTC if not timezone
            aware.
    """
    if time.tzinfo is not None:
        offset = time.utcoffset()
        offset = offset if offset else datetime.timedelta()
        return time.replace(tzinfo=None) - offset
    else:
        return time


class Attribute:
    def __init__(
        self,
        oid: ObjectIdentifier,
        value: bytes,
        _type: int = _ASN1Type.UTF8String.value,
    ) -> None:
        self._oid = oid
        self._value = value
        self._type = _type

    @property
    def oid(self) -> ObjectIdentifier:
        return self._oid

    @property
    def value(self) -> bytes:
        return self._value

    def __repr__(self) -> str:
        return f"<Attribute(oid={self.oid}, value={self.value!r})>"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Attribute):
            return NotImplemented

        return (
            self.oid == other.oid
            and self.value == other.value
            and self._type == other._type
        )

    def __hash__(self) -> int:
        return hash((self.oid, self.value, self._type))


class Attributes:
    def __init__(
        self,
        attributes: Iterable[Attribute],
    ) -> None:
        self._attributes = list(attributes)

    __len__, __iter__, __getitem__ = _make_sequence_methods("_attributes")

    def __repr__(self) -> str:
        return f"<Attributes({self._attributes})>"

    def get_attribute_for_oid(self, oid: ObjectIdentifier) -> Attribute:
        for attr in self:
            if attr.oid == oid:
                return attr

        raise AttributeNotFound(f"No {oid} attribute was found", oid)


class Version(utils.Enum):
    v1 = 0
    v3 = 2


class InvalidVersion(Exception):
    def __init__(self, msg: str, parsed_version: int) -> None:
        super().__init__(msg)
        self.parsed_version = parsed_version


Certificate = rust_x509.Certificate


class RevokedCertificate(metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def serial_number(self) -> int:
        """
        Returns the serial number of the revoked certificate.
        """

    @property
    @abc.abstractmethod
    def revocation_date(self) -> datetime.datetime:
        """
        Returns the date of when this certificate was revoked.
        """

    @property
    @abc.abstractmethod
    def revocation_date_utc(self) -> datetime.datetime:
        """
        Returns the date of when this certificate was revoked as a non-naive
        UTC datetime.
        """

    @property
    @abc.abstractmethod
    def extensions(self) -> Extensions:
        """
        Returns an Extensions object containing a list of Revoked extensions.
        """


# Runtime isinstance checks need this since the rust class is not a subclass.
RevokedCertificate.register(rust_x509.RevokedCertificate)


class _RawRevokedCertificate(RevokedCertificate):
    def __init__(
        self,
        serial_number: int,
        revocation_date: datetime.datetime,
        extensions: Extensions,
    ):
        self._serial_number = serial_number
        self._revocation_date = revocation_date
        self._extensions = extensions

    @property
    def serial_number(self) -> int:
        return self._serial_number

    @property
    def revocation_date(self) -> datetime.datetime:
        warnings.warn(
            "Properties that return a naïve datetime object have been "
            "deprecated. Please switch to revocation_date_utc.",
            utils.DeprecatedIn42,
            stacklevel=2,
        )
        return self._revocation_date

    @property
    def revocation_date_utc(self) -> datetime.datetime:
        return self._revocation_date.replace(tzinfo=datetime.timezone.utc)

    @property
    def extensions(self) -> Extensions:
        return self._extensions


CertificateRevocationList = rust_x509.CertificateRevocationList
CertificateSigningRequest = rust_x509.CertificateSigningRequest


load_pem_x509_certificate = rust_x509.load_pem_x509_certificate
load_der_x509_certificate = rust_x509.load_der_x509_certificate

load_pem_x509_certificates = rust_x509.load_pem_x509_certificates

load_pem_x509_csr = rust_x509.load_pem_x509_csr
load_der_x509_csr = rust_x509.load_der_x509_csr

load_pem_x509_crl = rust_x509.load_pem_x509_crl
load_der_x509_crl = rust_x509.load_der_x509_crl


class CertificateSigningRequestBuilder:
    def __init__(
        self,
        subject_name: Name | None = None,
        extensions: list[Extension[ExtensionType]] = [],
        attributes: list[tuple[ObjectIdentifier, bytes, int | None]] = [],
    ):
        """
        Creates an empty X.509 certificate request (v1).
        """
        self._subject_name = subject_name
        self._extensions = extensions
        self._attributes = attributes

    def subject_name(self, name: Name) -> CertificateSigningRequestBuilder:
        """
        Sets the certificate requestor's distinguished name.
        """
        if not isinstance(name, Name):
            raise TypeError("Expecting x509.Name object.")
        if self._subject_name is not None:
            raise ValueError("The subject name may only be set once.")
        return CertificateSigningRequestBuilder(
            name, self._extensions, self._attributes
        )

    def add_extension(
        self, extval: ExtensionType, critical: bool
    ) -> CertificateSigningRequestBuilder:
        """
        Adds an X.509 extension to the certificate request.
        """
        if not isinstance(extval, ExtensionType):
            raise TypeError("extension must be an ExtensionType")

        extension = Extension(extval.oid, critical, extval)
        _reject_duplicate_extension(extension, self._extensions)

        return CertificateSigningRequestBuilder(
            self._subject_name,
            [*self._extensions, extension],
            self._attributes,
        )

    def add_attribute(
        self,
        oid: ObjectIdentifier,
        value: bytes,
        *,
        _tag: _ASN1Type | None = None,
    ) -> CertificateSigningRequestBuilder:
        """
        Adds an X.509 attribute with an OID and associated value.
        """
        if not isinstance(oid, ObjectIdentifier):
            raise TypeError("oid must be an ObjectIdentifier")

        if not isinstance(value, bytes):
            raise TypeError("value must be bytes")

        if _tag is not None and not isinstance(_tag, _ASN1Type):
            raise TypeError("tag must be _ASN1Type")

        _reject_duplicate_attribute(oid, self._attributes)

        if _tag is not None:
            tag = _tag.value
        else:
            tag = None

        return CertificateSigningRequestBuilder(
            self._subject_name,
            self._extensions,
            [*self._attributes, (oid, value, tag)],
        )

    def sign(
        self,
        private_key: CertificateIssuerPrivateKeyTypes,
        algorithm: _AllowedHashTypes | None,
        backend: typing.Any = None,
        *,
        rsa_padding: padding.PSS | padding.PKCS1v15 | None = None,
        ecdsa_deterministic: bool | None = None,
    ) -> CertificateSigningRequest:
        """
        Signs the request using the requestor's private key.
        """
        if self._subject_name is None:
            raise ValueError("A CertificateSigningRequest must have a subject")

        if rsa_padding is not None:
            if not isinstance(rsa_padding, (padding.PSS, padding.PKCS1v15)):
                raise TypeError("Padding must be PSS or PKCS1v15")
            if not isinstance(private_key, rsa.RSAPrivateKey):
                raise TypeError("Padding is only supported for RSA keys")

        if ecdsa_deterministic is not None:
            if not isinstance(private_key, ec.EllipticCurvePrivateKey):
                raise TypeError(
                    "Deterministic ECDSA is only supported for EC keys"
                )

        return rust_x509.create_x509_csr(
            self,
            private_key,
            algorithm,
            rsa_padding,
            ecdsa_deterministic,
        )


class CertificateBuilder:
    _extensions: list[Extension[ExtensionType]]

    def __init__(
        self,
        issuer_name: Name | None = None,
        subject_name: Name | None = None,
        public_key: CertificatePublicKeyTypes | None = None,
        serial_number: int | None = None,
        not_valid_before: datetime.datetime | None = None,
        not_valid_after: datetime.datetime | None = None,
        extensions: list[Extension[ExtensionType]] = [],
    ) -> None:
        self._version = Version.v3
        self._issuer_name = issuer_name
        self._subject_name = subject_name
        self._public_key = public_key
        self._serial_number = serial_number
        self._not_valid_before = not_valid_before
        self._not_valid_after = not_valid_after
        self._extensions = extensions

    def issuer_name(self, name: Name) -> CertificateBuilder:
        """
        Sets the CA's distinguished name.
        """
        if not isinstance(name, Name):
            raise TypeError("Expecting x509.Name object.")
        if self._issuer_name is not None:
            raise ValueError("The issuer name may only be set once.")
        return CertificateBuilder(
            name,
            self._subject_name,
            self._public_key,
            self._serial_number,
            self._not_valid_before,
            self._not_valid_after,
            self._extensions,
        )

    def subject_name(self, name: Name) -> CertificateBuilder:
        """
        Sets the requestor's distinguished name.
        """
        if not isinstance(name, Name):
            raise TypeError("Expecting x509.Name object.")
        if self._subject_name is not None:
            raise ValueError("The subject name may only be set once.")
        return CertificateBuilder(
            self._issuer_name,
            name,
            self._public_key,
            self._serial_number,
            self._not_valid_before,
            self._not_valid_after,
            self._extensions,
        )

    def public_key(
        self,
        key: CertificatePublicKeyTypes,
    ) -> CertificateBuilder:
        """
        Sets the requestor's public key (as found in the signing request).
        """
        if not isinstance(
            key,
            (
                dsa.DSAPublicKey,
                rsa.RSAPublicKey,
                ec.EllipticCurvePublicKey,
                ed25519.Ed25519PublicKey,
                ed448.Ed448PublicKey,
                x25519.X25519PublicKey,
                x448.X448PublicKey,
            ),
        ):
            raise TypeError(
                "Expecting one of DSAPublicKey, RSAPublicKey,"
                " EllipticCurvePublicKey, Ed25519PublicKey,"
                " Ed448PublicKey, X25519PublicKey, or "
                "X448PublicKey."
            )
        if self._public_key is not None:
            raise ValueError("The public key may only be set once.")
        return CertificateBuilder(
            self._issuer_name,
            self._subject_name,
            key,
            self._serial_number,
            self._not_valid_before,
            self._not_valid_after,
            self._extensions,
        )

    def serial_number(self, number: int) -> CertificateBuilder:
        """
        Sets the certificate serial number.
        """
        if not isinstance(number, int):
            raise TypeError("Serial number must be of integral type.")
        if self._serial_number is not None:
            raise ValueError("The serial number may only be set once.")
        if number <= 0:
            raise ValueError("The serial number should be positive.")

        # ASN.1 integers are always signed, so most significant bit must be
        # zero.
        if number.bit_length() >= 160:  # As defined in RFC 5280
            raise ValueError(
                "The serial number should not be more than 159 bits."
            )
        return CertificateBuilder(
            self._issuer_name,
            self._subject_name,
            self._public_key,
            number,
            self._not_valid_before,
            self._not_valid_after,
            self._extensions,
        )

    def not_valid_before(self, time: datetime.datetime) -> CertificateBuilder:
        """
        Sets the certificate activation time.
        """
        if not isinstance(time, datetime.datetime):
            raise TypeError("Expecting datetime object.")
        if self._not_valid_before is not None:
            raise ValueError("The not valid before may only be set once.")
        time = _convert_to_naive_utc_time(time)
        if time < _EARLIEST_UTC_TIME:
            raise ValueError(
                "The not valid before date must be on or after"
                " 1950 January 1)."
            )
        if self._not_valid_after is not None and time > self._not_valid_after:
            raise ValueError(
                "The not valid before date must be before the not valid after "
                "date."
            )
        return CertificateBuilder(
            self._issuer_name,
            self._subject_name,
            self._public_key,
            self._serial_number,
            time,
            self._not_valid_after,
            self._extensions,
        )

    def not_valid_after(self, time: datetime.datetime) -> CertificateBuilder:
        """
        Sets the certificate expiration time.
        """
        if not isinstance(time, datetime.datetime):
            raise TypeError("Expecting datetime object.")
        if self._not_valid_after is not None:
            raise ValueError("The not valid after may only be set once.")
        time = _convert_to_naive_utc_time(time)
        if time < _EARLIEST_UTC_TIME:
            raise ValueError(
                "The not valid after date must be on or after 1950 January 1."
            )
        if (
            self._not_valid_before is not None
            and time < self._not_valid_before
        ):
            raise ValueError(
                "The not valid after date must be after the not valid before "
                "date."
            )
        return CertificateBuilder(
            self._issuer_name,
            self._subject_name,
            self._public_key,
            self._serial_number,
            self._not_valid_before,
            time,
            self._extensions,
        )

    def add_extension(
        self, extval: ExtensionType, critical: bool
    ) -> CertificateBuilder:
        """
        Adds an X.509 extension to the certificate.
        """
        if not isinstance(extval, ExtensionType):
            raise TypeError("extension must be an ExtensionType")

        extension = Extension(extval.oid, critical, extval)
        _reject_duplicate_extension(extension, self._extensions)

        return CertificateBuilder(
            self._issuer_name,
            self._subject_name,
            self._public_key,
            self._serial_number,
            self._not_valid_before,
            self._not_valid_after,
            [*self._extensions, extension],
        )

    def sign(
        self,
        private_key: CertificateIssuerPrivateKeyTypes,
        algorithm: _AllowedHashTypes | None,
        backend: typing.Any = None,
        *,
        rsa_padding: padding.PSS | padding.PKCS1v15 | None = None,
        ecdsa_deterministic: bool | None = None,
    ) -> Certificate:
        """
        Signs the certificate using the CA's private key.
        """
        if self._subject_name is None:
            raise ValueError("A certificate must have a subject name")

        if self._issuer_name is None:
            raise ValueError("A certificate must have an issuer name")

        if self._serial_number is None:
            raise ValueError("A certificate must have a serial number")

        if self._not_valid_before is None:
            raise ValueError("A certificate must have a not valid before time")

        if self._not_valid_after is None:
            raise ValueError("A certificate must have a not valid after time")

        if self._public_key is None:
            raise ValueError("A certificate must have a public key")

        if rsa_padding is not None:
            if not isinstance(rsa_padding, (padding.PSS, padding.PKCS1v15)):
                raise TypeError("Padding must be PSS or PKCS1v15")
            if not isinstance(private_key, rsa.RSAPrivateKey):
                raise TypeError("Padding is only supported for RSA keys")

        if ecdsa_deterministic is not None:
            if not isinstance(private_key, ec.EllipticCurvePrivateKey):
                raise TypeError(
                    "Deterministic ECDSA is only supported for EC keys"
                )

        return rust_x509.create_x509_certificate(
            self,
            private_key,
            algorithm,
            rsa_padding,
            ecdsa_deterministic,
        )


class CertificateRevocationListBuilder:
    _extensions: list[Extension[ExtensionType]]
    _revoked_certificates: list[RevokedCertificate]

    def __init__(
        self,
        issuer_name: Name | None = None,
        last_update: datetime.datetime | None = None,
        next_update: datetime.datetime | None = None,
        extensions: list[Extension[ExtensionType]] = [],
        revoked_certificates: list[RevokedCertificate] = [],
    ):
        self._issuer_name = issuer_name
        self._last_update = last_update
        self._next_update = next_update
        self._extensions = extensions
        self._revoked_certificates = revoked_certificates

    def issuer_name(
        self, issuer_name: Name
    ) -> CertificateRevocationListBuilder:
        if not isinstance(issuer_name, Name):
            raise TypeError("Expecting x509.Name object.")
        if self._issuer_name is not None:
            raise ValueError("The issuer name may only be set once.")
        return CertificateRevocationListBuilder(
            issuer_name,
            self._last_update,
            self._next_update,
            self._extensions,
            self._revoked_certificates,
        )

    def last_update(
        self, last_update: datetime.datetime
    ) -> CertificateRevocationListBuilder:
        if not isinstance(last_update, datetime.datetime):
            raise TypeError("Expecting datetime object.")
        if self._last_update is not None:
            raise ValueError("Last update may only be set once.")
        last_update = _convert_to_naive_utc_time(last_update)
        if last_update < _EARLIEST_UTC_TIME:
            raise ValueError(
                "The last update date must be on or after 1950 January 1."
            )
        if self._next_update is not None and last_update > self._next_update:
            raise ValueError(
                "The last update date must be before the next update date."
            )
        return CertificateRevocationListBuilder(
            self._issuer_name,
            last_update,
            self._next_update,
            self._extensions,
            self._revoked_certificates,
        )

    def next_update(
        self, next_update: datetime.datetime
    ) -> CertificateRevocationListBuilder:
        if not isinstance(next_update, datetime.datetime):
            raise TypeError("Expecting datetime object.")
        if self._next_update is not None:
            raise ValueError("Last update may only be set once.")
        next_update = _convert_to_naive_utc_time(next_update)
        if next_update < _EARLIEST_UTC_TIME:
            raise ValueError(
                "The last update date must be on or after 1950 January 1."
            )
        if self._last_update is not None and next_update < self._last_update:
            raise ValueError(
                "The next update date must be after the last update date."
            )
        return CertificateRevocationListBuilder(
            self._issuer_name,
            self._last_update,
            next_update,
            self._extensions,
            self._revoked_certificates,
        )

    def add_extension(
        self, extval: ExtensionType, critical: bool
    ) -> CertificateRevocationListBuilder:
        """
        Adds an X.509 extension to the certificate revocation list.
        """
        if not isinstance(extval, ExtensionType):
            raise TypeError("extension must be an ExtensionType")

        extension = Extension(extval.oid, critical, extval)
        _reject_duplicate_extension(extension, self._extensions)
        return CertificateRevocationListBuilder(
            self._issuer_name,
            self._last_update,
            self._next_update,
            [*self._extensions, extension],
            self._revoked_certificates,
        )

    def add_revoked_certificate(
        self, revoked_certificate: RevokedCertificate
    ) -> CertificateRevocationListBuilder:
        """
        Adds a revoked certificate to the CRL.
        """
        if not isinstance(revoked_certificate, RevokedCertificate):
            raise TypeError("Must be an instance of RevokedCertificate")

        return CertificateRevocationListBuilder(
            self._issuer_name,
            self._last_update,
            self._next_update,
            self._extensions,
            [*self._revoked_certificates, revoked_certificate],
        )

    def sign(
        self,
        private_key: CertificateIssuerPrivateKeyTypes,
        algorithm: _AllowedHashTypes | None,
        backend: typing.Any = None,
        *,
        rsa_padding: padding.PSS | padding.PKCS1v15 | None = None,
        ecdsa_deterministic: bool | None = None,
    ) -> CertificateRevocationList:
        if self._issuer_name is None:
            raise ValueError("A CRL must have an issuer name")

        if self._last_update is None:
            raise ValueError("A CRL must have a last update time")

        if self._next_update is None:
            raise ValueError("A CRL must have a next update time")

        if rsa_padding is not None:
            if not isinstance(rsa_padding, (padding.PSS, padding.PKCS1v15)):
                raise TypeError("Padding must be PSS or PKCS1v15")
            if not isinstance(private_key, rsa.RSAPrivateKey):
                raise TypeError("Padding is only supported for RSA keys")

        if ecdsa_deterministic is not None:
            if not isinstance(private_key, ec.EllipticCurvePrivateKey):
                raise TypeError(
                    "Deterministic ECDSA is only supported for EC keys"
                )

        return rust_x509.create_x509_crl(
            self,
            private_key,
            algorithm,
            rsa_padding,
            ecdsa_deterministic,
        )


class RevokedCertificateBuilder:
    def __init__(
        self,
        serial_number: int | None = None,
        revocation_date: datetime.datetime | None = None,
        extensions: list[Extension[ExtensionType]] = [],
    ):
        self._serial_number = serial_number
        self._revocation_date = revocation_date
        self._extensions = extensions

    def serial_number(self, number: int) -> RevokedCertificateBuilder:
        if not isinstance(number, int):
            raise TypeError("Serial number must be of integral type.")
        if self._serial_number is not None:
            raise ValueError("The serial number may only be set once.")
        if number <= 0:
            raise ValueError("The serial number should be positive")

        # ASN.1 integers are always signed, so most significant bit must be
        # zero.
        if number.bit_length() >= 160:  # As defined in RFC 5280
            raise ValueError(
                "The serial number should not be more than 159 bits."
            )
        return RevokedCertificateBuilder(
            number, self._revocation_date, self._extensions
        )

    def revocation_date(
        self, time: datetime.datetime
    ) -> RevokedCertificateBuilder:
        if not isinstance(time, datetime.datetime):
            raise TypeError("Expecting datetime object.")
        if self._revocation_date is not None:
            raise ValueError("The revocation date may only be set once.")
        time = _convert_to_naive_utc_time(time)
        if time < _EARLIEST_UTC_TIME:
            raise ValueError(
                "The revocation date must be on or after 1950 January 1."
            )
        return RevokedCertificateBuilder(
            self._serial_number, time, self._extensions
        )

    def add_extension(
        self, extval: ExtensionType, critical: bool
    ) -> RevokedCertificateBuilder:
        if not isinstance(extval, ExtensionType):
            raise TypeError("extension must be an ExtensionType")

        extension = Extension(extval.oid, critical, extval)
        _reject_duplicate_extension(extension, self._extensions)
        return RevokedCertificateBuilder(
            self._serial_number,
            self._revocation_date,
            [*self._extensions, extension],
        )

    def build(self, backend: typing.Any = None) -> RevokedCertificate:
        if self._serial_number is None:
            raise ValueError("A revoked certificate must have a serial number")
        if self._revocation_date is None:
            raise ValueError(
                "A revoked certificate must have a revocation date"
            )
        return _RawRevokedCertificate(
            self._serial_number,
            self._revocation_date,
            Extensions(self._extensions),
        )


def random_serial_number() -> int:
    return int.from_bytes(os.urandom(20), "big") >> 1
