from typing import Any, Optional, Type

from cryptography.hazmat.primitives import serialization

from dns.dnssecalgs.base import GenericPrivateKey, GenericPublicKey
from dns.exception import AlgorithmKeyMismatch


class CryptographyPublicKey(GenericPublicKey):
    key: Any = None
    key_cls: Any = None

    def __init__(self, key: Any) -> None:  # pylint: disable=super-init-not-called
        if self.key_cls is None:
            raise TypeError("Undefined private key class")
        if not isinstance(  # pylint: disable=isinstance-second-argument-not-valid-type
            key, self.key_cls
        ):
            raise AlgorithmKeyMismatch
        self.key = key

    @classmethod
    def from_pem(cls, public_pem: bytes) -> "GenericPublicKey":
        key = serialization.load_pem_public_key(public_pem)
        return cls(key=key)

    def to_pem(self) -> bytes:
        return self.key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )


class CryptographyPrivateKey(GenericPrivateKey):
    key: Any = None
    key_cls: Any = None
    public_cls: Type[CryptographyPublicKey]

    def __init__(self, key: Any) -> None:  # pylint: disable=super-init-not-called
        if self.key_cls is None:
            raise TypeError("Undefined private key class")
        if not isinstance(  # pylint: disable=isinstance-second-argument-not-valid-type
            key, self.key_cls
        ):
            raise AlgorithmKeyMismatch
        self.key = key

    def public_key(self) -> "CryptographyPublicKey":
        return self.public_cls(key=self.key.public_key())

    @classmethod
    def from_pem(
        cls, private_pem: bytes, password: Optional[bytes] = None
    ) -> "GenericPrivateKey":
        key = serialization.load_pem_private_key(private_pem, password=password)
        return cls(key=key)

    def to_pem(self, password: Optional[bytes] = None) -> bytes:
        encryption_algorithm: serialization.KeySerializationEncryption
        if password:
            encryption_algorithm = serialization.BestAvailableEncryption(password)
        else:
            encryption_algorithm = serialization.NoEncryption()
        return self.key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=encryption_algorithm,
        )
