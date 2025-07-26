"""X.509 certificates."""
from __future__ import annotations

import datetime
import glob
import os
from typing import TYPE_CHECKING, Iterator

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509 import load_pem_x509_certificate
from kombu.utils.encoding import bytes_to_str, ensure_bytes

from celery.exceptions import SecurityError

from .utils import reraise_errors

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.asymmetric.dsa import DSAPublicKey
    from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePublicKey
    from cryptography.hazmat.primitives.asymmetric.ed448 import Ed448PublicKey
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
    from cryptography.hazmat.primitives.asymmetric.utils import Prehashed
    from cryptography.hazmat.primitives.hashes import HashAlgorithm


__all__ = ('Certificate', 'CertStore', 'FSCertStore')


class Certificate:
    """X.509 certificate."""

    def __init__(self, cert: str) -> None:
        with reraise_errors(
            'Invalid certificate: {0!r}', errors=(ValueError,)
        ):
            self._cert = load_pem_x509_certificate(
                ensure_bytes(cert), backend=default_backend())

            if not isinstance(self._cert.public_key(), rsa.RSAPublicKey):
                raise ValueError("Non-RSA certificates are not supported.")

    def has_expired(self) -> bool:
        """Check if the certificate has expired."""
        return datetime.datetime.utcnow() >= self._cert.not_valid_after

    def get_pubkey(self) -> (
        DSAPublicKey | EllipticCurvePublicKey | Ed448PublicKey | Ed25519PublicKey | RSAPublicKey
    ):
        return self._cert.public_key()

    def get_serial_number(self) -> int:
        """Return the serial number in the certificate."""
        return self._cert.serial_number

    def get_issuer(self) -> str:
        """Return issuer (CA) as a string."""
        return ' '.join(x.value for x in self._cert.issuer)

    def get_id(self) -> str:
        """Serial number/issuer pair uniquely identifies a certificate."""
        return f'{self.get_issuer()} {self.get_serial_number()}'

    def verify(self, data: bytes, signature: bytes, digest: HashAlgorithm | Prehashed) -> None:
        """Verify signature for string containing data."""
        with reraise_errors('Bad signature: {0!r}'):

            pad = padding.PSS(
                mgf=padding.MGF1(digest),
                salt_length=padding.PSS.MAX_LENGTH)

            self.get_pubkey().verify(signature, ensure_bytes(data), pad, digest)


class CertStore:
    """Base class for certificate stores."""

    def __init__(self) -> None:
        self._certs: dict[str, Certificate] = {}

    def itercerts(self) -> Iterator[Certificate]:
        """Return certificate iterator."""
        yield from self._certs.values()

    def __getitem__(self, id: str) -> Certificate:
        """Get certificate by id."""
        try:
            return self._certs[bytes_to_str(id)]
        except KeyError:
            raise SecurityError(f'Unknown certificate: {id!r}')

    def add_cert(self, cert: Certificate) -> None:
        cert_id = bytes_to_str(cert.get_id())
        if cert_id in self._certs:
            raise SecurityError(f'Duplicate certificate: {id!r}')
        self._certs[cert_id] = cert


class FSCertStore(CertStore):
    """File system certificate store."""

    def __init__(self, path: str) -> None:
        super().__init__()
        if os.path.isdir(path):
            path = os.path.join(path, '*')
        for p in glob.glob(path):
            with open(p) as f:
                cert = Certificate(f.read())
                if cert.has_expired():
                    raise SecurityError(
                        f'Expired certificate: {cert.get_id()!r}')
                self.add_cert(cert)
