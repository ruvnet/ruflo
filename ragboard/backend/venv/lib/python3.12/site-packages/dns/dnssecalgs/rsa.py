import math
import struct

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from dns.dnssecalgs.cryptography import CryptographyPrivateKey, CryptographyPublicKey
from dns.dnssectypes import Algorithm
from dns.rdtypes.ANY.DNSKEY import DNSKEY


class PublicRSA(CryptographyPublicKey):
    key: rsa.RSAPublicKey
    key_cls = rsa.RSAPublicKey
    algorithm: Algorithm
    chosen_hash: hashes.HashAlgorithm

    def verify(self, signature: bytes, data: bytes) -> None:
        self.key.verify(signature, data, padding.PKCS1v15(), self.chosen_hash)

    def encode_key_bytes(self) -> bytes:
        """Encode a public key per RFC 3110, section 2."""
        pn = self.key.public_numbers()
        _exp_len = math.ceil(int.bit_length(pn.e) / 8)
        exp = int.to_bytes(pn.e, length=_exp_len, byteorder="big")
        if _exp_len > 255:
            exp_header = b"\0" + struct.pack("!H", _exp_len)
        else:
            exp_header = struct.pack("!B", _exp_len)
        if pn.n.bit_length() < 512 or pn.n.bit_length() > 4096:
            raise ValueError("unsupported RSA key length")
        return exp_header + exp + pn.n.to_bytes((pn.n.bit_length() + 7) // 8, "big")

    @classmethod
    def from_dnskey(cls, key: DNSKEY) -> "PublicRSA":
        cls._ensure_algorithm_key_combination(key)
        keyptr = key.key
        (bytes_,) = struct.unpack("!B", keyptr[0:1])
        keyptr = keyptr[1:]
        if bytes_ == 0:
            (bytes_,) = struct.unpack("!H", keyptr[0:2])
            keyptr = keyptr[2:]
        rsa_e = keyptr[0:bytes_]
        rsa_n = keyptr[bytes_:]
        return cls(
            key=rsa.RSAPublicNumbers(
                int.from_bytes(rsa_e, "big"), int.from_bytes(rsa_n, "big")
            ).public_key(default_backend())
        )


class PrivateRSA(CryptographyPrivateKey):
    key: rsa.RSAPrivateKey
    key_cls = rsa.RSAPrivateKey
    public_cls = PublicRSA
    default_public_exponent = 65537

    def sign(
        self,
        data: bytes,
        verify: bool = False,
        deterministic: bool = True,
    ) -> bytes:
        """Sign using a private key per RFC 3110, section 3."""
        signature = self.key.sign(data, padding.PKCS1v15(), self.public_cls.chosen_hash)
        if verify:
            self.public_key().verify(signature, data)
        return signature

    @classmethod
    def generate(cls, key_size: int) -> "PrivateRSA":
        return cls(
            key=rsa.generate_private_key(
                public_exponent=cls.default_public_exponent,
                key_size=key_size,
                backend=default_backend(),
            )
        )


class PublicRSAMD5(PublicRSA):
    algorithm = Algorithm.RSAMD5
    chosen_hash = hashes.MD5()


class PrivateRSAMD5(PrivateRSA):
    public_cls = PublicRSAMD5


class PublicRSASHA1(PublicRSA):
    algorithm = Algorithm.RSASHA1
    chosen_hash = hashes.SHA1()


class PrivateRSASHA1(PrivateRSA):
    public_cls = PublicRSASHA1


class PublicRSASHA1NSEC3SHA1(PublicRSA):
    algorithm = Algorithm.RSASHA1NSEC3SHA1
    chosen_hash = hashes.SHA1()


class PrivateRSASHA1NSEC3SHA1(PrivateRSA):
    public_cls = PublicRSASHA1NSEC3SHA1


class PublicRSASHA256(PublicRSA):
    algorithm = Algorithm.RSASHA256
    chosen_hash = hashes.SHA256()


class PrivateRSASHA256(PrivateRSA):
    public_cls = PublicRSASHA256


class PublicRSASHA512(PublicRSA):
    algorithm = Algorithm.RSASHA512
    chosen_hash = hashes.SHA512()


class PrivateRSASHA512(PrivateRSA):
    public_cls = PublicRSASHA512
