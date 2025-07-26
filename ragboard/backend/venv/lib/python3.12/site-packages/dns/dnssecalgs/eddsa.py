from typing import Type

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed448, ed25519

from dns.dnssecalgs.cryptography import CryptographyPrivateKey, CryptographyPublicKey
from dns.dnssectypes import Algorithm
from dns.rdtypes.ANY.DNSKEY import DNSKEY


class PublicEDDSA(CryptographyPublicKey):
    def verify(self, signature: bytes, data: bytes) -> None:
        self.key.verify(signature, data)

    def encode_key_bytes(self) -> bytes:
        """Encode a public key per RFC 8080, section 3."""
        return self.key.public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
        )

    @classmethod
    def from_dnskey(cls, key: DNSKEY) -> "PublicEDDSA":
        cls._ensure_algorithm_key_combination(key)
        return cls(
            key=cls.key_cls.from_public_bytes(key.key),
        )


class PrivateEDDSA(CryptographyPrivateKey):
    public_cls: Type[PublicEDDSA]

    def sign(
        self,
        data: bytes,
        verify: bool = False,
        deterministic: bool = True,
    ) -> bytes:
        """Sign using a private key per RFC 8080, section 4."""
        signature = self.key.sign(data)
        if verify:
            self.public_key().verify(signature, data)
        return signature

    @classmethod
    def generate(cls) -> "PrivateEDDSA":
        return cls(key=cls.key_cls.generate())


class PublicED25519(PublicEDDSA):
    key: ed25519.Ed25519PublicKey
    key_cls = ed25519.Ed25519PublicKey
    algorithm = Algorithm.ED25519


class PrivateED25519(PrivateEDDSA):
    key: ed25519.Ed25519PrivateKey
    key_cls = ed25519.Ed25519PrivateKey
    public_cls = PublicED25519


class PublicED448(PublicEDDSA):
    key: ed448.Ed448PublicKey
    key_cls = ed448.Ed448PublicKey
    algorithm = Algorithm.ED448


class PrivateED448(PrivateEDDSA):
    key: ed448.Ed448PrivateKey
    key_cls = ed448.Ed448PrivateKey
    public_cls = PublicED448
