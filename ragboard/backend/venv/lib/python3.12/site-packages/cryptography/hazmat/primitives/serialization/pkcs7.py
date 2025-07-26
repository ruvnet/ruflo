# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import email.base64mime
import email.generator
import email.message
import email.policy
import io
import typing
from collections.abc import Iterable

from cryptography import utils, x509
from cryptography.exceptions import UnsupportedAlgorithm, _Reasons
from cryptography.hazmat.bindings._rust import pkcs7 as rust_pkcs7
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.ciphers import (
    algorithms,
)
from cryptography.utils import _check_byteslike

load_pem_pkcs7_certificates = rust_pkcs7.load_pem_pkcs7_certificates

load_der_pkcs7_certificates = rust_pkcs7.load_der_pkcs7_certificates

serialize_certificates = rust_pkcs7.serialize_certificates

PKCS7HashTypes = typing.Union[
    hashes.SHA224,
    hashes.SHA256,
    hashes.SHA384,
    hashes.SHA512,
]

PKCS7PrivateKeyTypes = typing.Union[
    rsa.RSAPrivateKey, ec.EllipticCurvePrivateKey
]

ContentEncryptionAlgorithm = typing.Union[
    typing.Type[algorithms.AES128], typing.Type[algorithms.AES256]
]


class PKCS7Options(utils.Enum):
    Text = "Add text/plain MIME type"
    Binary = "Don't translate input data into canonical MIME format"
    DetachedSignature = "Don't embed data in the PKCS7 structure"
    NoCapabilities = "Don't embed SMIME capabilities"
    NoAttributes = "Don't embed authenticatedAttributes"
    NoCerts = "Don't embed signer certificate"


class PKCS7SignatureBuilder:
    def __init__(
        self,
        data: utils.Buffer | None = None,
        signers: list[
            tuple[
                x509.Certificate,
                PKCS7PrivateKeyTypes,
                PKCS7HashTypes,
                padding.PSS | padding.PKCS1v15 | None,
            ]
        ] = [],
        additional_certs: list[x509.Certificate] = [],
    ):
        self._data = data
        self._signers = signers
        self._additional_certs = additional_certs

    def set_data(self, data: utils.Buffer) -> PKCS7SignatureBuilder:
        _check_byteslike("data", data)
        if self._data is not None:
            raise ValueError("data may only be set once")

        return PKCS7SignatureBuilder(data, self._signers)

    def add_signer(
        self,
        certificate: x509.Certificate,
        private_key: PKCS7PrivateKeyTypes,
        hash_algorithm: PKCS7HashTypes,
        *,
        rsa_padding: padding.PSS | padding.PKCS1v15 | None = None,
    ) -> PKCS7SignatureBuilder:
        if not isinstance(
            hash_algorithm,
            (
                hashes.SHA224,
                hashes.SHA256,
                hashes.SHA384,
                hashes.SHA512,
            ),
        ):
            raise TypeError(
                "hash_algorithm must be one of hashes.SHA224, "
                "SHA256, SHA384, or SHA512"
            )
        if not isinstance(certificate, x509.Certificate):
            raise TypeError("certificate must be a x509.Certificate")

        if not isinstance(
            private_key, (rsa.RSAPrivateKey, ec.EllipticCurvePrivateKey)
        ):
            raise TypeError("Only RSA & EC keys are supported at this time.")

        if rsa_padding is not None:
            if not isinstance(rsa_padding, (padding.PSS, padding.PKCS1v15)):
                raise TypeError("Padding must be PSS or PKCS1v15")
            if not isinstance(private_key, rsa.RSAPrivateKey):
                raise TypeError("Padding is only supported for RSA keys")

        return PKCS7SignatureBuilder(
            self._data,
            [
                *self._signers,
                (certificate, private_key, hash_algorithm, rsa_padding),
            ],
        )

    def add_certificate(
        self, certificate: x509.Certificate
    ) -> PKCS7SignatureBuilder:
        if not isinstance(certificate, x509.Certificate):
            raise TypeError("certificate must be a x509.Certificate")

        return PKCS7SignatureBuilder(
            self._data, self._signers, [*self._additional_certs, certificate]
        )

    def sign(
        self,
        encoding: serialization.Encoding,
        options: Iterable[PKCS7Options],
        backend: typing.Any = None,
    ) -> bytes:
        if len(self._signers) == 0:
            raise ValueError("Must have at least one signer")
        if self._data is None:
            raise ValueError("You must add data to sign")
        options = list(options)
        if not all(isinstance(x, PKCS7Options) for x in options):
            raise ValueError("options must be from the PKCS7Options enum")
        if encoding not in (
            serialization.Encoding.PEM,
            serialization.Encoding.DER,
            serialization.Encoding.SMIME,
        ):
            raise ValueError(
                "Must be PEM, DER, or SMIME from the Encoding enum"
            )

        # Text is a meaningless option unless it is accompanied by
        # DetachedSignature
        if (
            PKCS7Options.Text in options
            and PKCS7Options.DetachedSignature not in options
        ):
            raise ValueError(
                "When passing the Text option you must also pass "
                "DetachedSignature"
            )

        if PKCS7Options.Text in options and encoding in (
            serialization.Encoding.DER,
            serialization.Encoding.PEM,
        ):
            raise ValueError(
                "The Text option is only available for SMIME serialization"
            )

        # No attributes implies no capabilities so we'll error if you try to
        # pass both.
        if (
            PKCS7Options.NoAttributes in options
            and PKCS7Options.NoCapabilities in options
        ):
            raise ValueError(
                "NoAttributes is a superset of NoCapabilities. Do not pass "
                "both values."
            )

        return rust_pkcs7.sign_and_serialize(self, encoding, options)


class PKCS7EnvelopeBuilder:
    def __init__(
        self,
        *,
        _data: bytes | None = None,
        _recipients: list[x509.Certificate] | None = None,
        _content_encryption_algorithm: ContentEncryptionAlgorithm
        | None = None,
    ):
        from cryptography.hazmat.backends.openssl.backend import (
            backend as ossl,
        )

        if not ossl.rsa_encryption_supported(padding=padding.PKCS1v15()):
            raise UnsupportedAlgorithm(
                "RSA with PKCS1 v1.5 padding is not supported by this version"
                " of OpenSSL.",
                _Reasons.UNSUPPORTED_PADDING,
            )
        self._data = _data
        self._recipients = _recipients if _recipients is not None else []
        self._content_encryption_algorithm = _content_encryption_algorithm

    def set_data(self, data: bytes) -> PKCS7EnvelopeBuilder:
        _check_byteslike("data", data)
        if self._data is not None:
            raise ValueError("data may only be set once")

        return PKCS7EnvelopeBuilder(
            _data=data,
            _recipients=self._recipients,
            _content_encryption_algorithm=self._content_encryption_algorithm,
        )

    def add_recipient(
        self,
        certificate: x509.Certificate,
    ) -> PKCS7EnvelopeBuilder:
        if not isinstance(certificate, x509.Certificate):
            raise TypeError("certificate must be a x509.Certificate")

        if not isinstance(certificate.public_key(), rsa.RSAPublicKey):
            raise TypeError("Only RSA keys are supported at this time.")

        return PKCS7EnvelopeBuilder(
            _data=self._data,
            _recipients=[
                *self._recipients,
                certificate,
            ],
            _content_encryption_algorithm=self._content_encryption_algorithm,
        )

    def set_content_encryption_algorithm(
        self, content_encryption_algorithm: ContentEncryptionAlgorithm
    ) -> PKCS7EnvelopeBuilder:
        if self._content_encryption_algorithm is not None:
            raise ValueError("Content encryption algo may only be set once")
        if content_encryption_algorithm not in {
            algorithms.AES128,
            algorithms.AES256,
        }:
            raise TypeError("Only AES128 and AES256 are supported")

        return PKCS7EnvelopeBuilder(
            _data=self._data,
            _recipients=self._recipients,
            _content_encryption_algorithm=content_encryption_algorithm,
        )

    def encrypt(
        self,
        encoding: serialization.Encoding,
        options: Iterable[PKCS7Options],
    ) -> bytes:
        if len(self._recipients) == 0:
            raise ValueError("Must have at least one recipient")
        if self._data is None:
            raise ValueError("You must add data to encrypt")

        # The default content encryption algorithm is AES-128, which the S/MIME
        # v3.2 RFC specifies as MUST support (https://datatracker.ietf.org/doc/html/rfc5751#section-2.7)
        content_encryption_algorithm = (
            self._content_encryption_algorithm or algorithms.AES128
        )

        options = list(options)
        if not all(isinstance(x, PKCS7Options) for x in options):
            raise ValueError("options must be from the PKCS7Options enum")
        if encoding not in (
            serialization.Encoding.PEM,
            serialization.Encoding.DER,
            serialization.Encoding.SMIME,
        ):
            raise ValueError(
                "Must be PEM, DER, or SMIME from the Encoding enum"
            )

        # Only allow options that make sense for encryption
        if any(
            opt not in [PKCS7Options.Text, PKCS7Options.Binary]
            for opt in options
        ):
            raise ValueError(
                "Only the following options are supported for encryption: "
                "Text, Binary"
            )
        elif PKCS7Options.Text in options and PKCS7Options.Binary in options:
            # OpenSSL accepts both options at the same time, but ignores Text.
            # We fail defensively to avoid unexpected outputs.
            raise ValueError(
                "Cannot use Binary and Text options at the same time"
            )

        return rust_pkcs7.encrypt_and_serialize(
            self, content_encryption_algorithm, encoding, options
        )


pkcs7_decrypt_der = rust_pkcs7.decrypt_der
pkcs7_decrypt_pem = rust_pkcs7.decrypt_pem
pkcs7_decrypt_smime = rust_pkcs7.decrypt_smime


def _smime_signed_encode(
    data: bytes, signature: bytes, micalg: str, text_mode: bool
) -> bytes:
    # This function works pretty hard to replicate what OpenSSL does
    # precisely. For good and for ill.

    m = email.message.Message()
    m.add_header("MIME-Version", "1.0")
    m.add_header(
        "Content-Type",
        "multipart/signed",
        protocol="application/x-pkcs7-signature",
        micalg=micalg,
    )

    m.preamble = "This is an S/MIME signed message\n"

    msg_part = OpenSSLMimePart()
    msg_part.set_payload(data)
    if text_mode:
        msg_part.add_header("Content-Type", "text/plain")
    m.attach(msg_part)

    sig_part = email.message.MIMEPart()
    sig_part.add_header(
        "Content-Type", "application/x-pkcs7-signature", name="smime.p7s"
    )
    sig_part.add_header("Content-Transfer-Encoding", "base64")
    sig_part.add_header(
        "Content-Disposition", "attachment", filename="smime.p7s"
    )
    sig_part.set_payload(
        email.base64mime.body_encode(signature, maxlinelen=65)
    )
    del sig_part["MIME-Version"]
    m.attach(sig_part)

    fp = io.BytesIO()
    g = email.generator.BytesGenerator(
        fp,
        maxheaderlen=0,
        mangle_from_=False,
        policy=m.policy.clone(linesep="\r\n"),
    )
    g.flatten(m)
    return fp.getvalue()


def _smime_enveloped_encode(data: bytes) -> bytes:
    m = email.message.Message()
    m.add_header("MIME-Version", "1.0")
    m.add_header("Content-Disposition", "attachment", filename="smime.p7m")
    m.add_header(
        "Content-Type",
        "application/pkcs7-mime",
        smime_type="enveloped-data",
        name="smime.p7m",
    )
    m.add_header("Content-Transfer-Encoding", "base64")

    m.set_payload(email.base64mime.body_encode(data, maxlinelen=65))

    return m.as_bytes(policy=m.policy.clone(linesep="\n", max_line_length=0))


def _smime_enveloped_decode(data: bytes) -> bytes:
    m = email.message_from_bytes(data)
    if m.get_content_type() not in {
        "application/x-pkcs7-mime",
        "application/pkcs7-mime",
    }:
        raise ValueError("Not an S/MIME enveloped message")
    return bytes(m.get_payload(decode=True))


def _smime_remove_text_headers(data: bytes) -> bytes:
    m = email.message_from_bytes(data)
    # Using get() instead of get_content_type() since it has None as default,
    # where the latter has "text/plain". Both methods are case-insensitive.
    content_type = m.get("content-type")
    if content_type is None:
        raise ValueError(
            "Decrypted MIME data has no 'Content-Type' header. "
            "Please remove the 'Text' option to parse it manually."
        )
    if "text/plain" not in content_type:
        raise ValueError(
            f"Decrypted MIME data content type is '{content_type}', not "
            "'text/plain'. Remove the 'Text' option to parse it manually."
        )
    return bytes(m.get_payload(decode=True))


class OpenSSLMimePart(email.message.MIMEPart):
    # A MIMEPart subclass that replicates OpenSSL's behavior of not including
    # a newline if there are no headers.
    def _write_headers(self, generator) -> None:
        if list(self.raw_items()):
            generator._write_headers(self)
