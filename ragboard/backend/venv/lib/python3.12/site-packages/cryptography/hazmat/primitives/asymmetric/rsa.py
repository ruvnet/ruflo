# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import abc
import random
import typing
from math import gcd

from cryptography.hazmat.bindings._rust import openssl as rust_openssl
from cryptography.hazmat.primitives import _serialization, hashes
from cryptography.hazmat.primitives._asymmetric import AsymmetricPadding
from cryptography.hazmat.primitives.asymmetric import utils as asym_utils


class RSAPrivateKey(metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def decrypt(self, ciphertext: bytes, padding: AsymmetricPadding) -> bytes:
        """
        Decrypts the provided ciphertext.
        """

    @property
    @abc.abstractmethod
    def key_size(self) -> int:
        """
        The bit length of the public modulus.
        """

    @abc.abstractmethod
    def public_key(self) -> RSAPublicKey:
        """
        The RSAPublicKey associated with this private key.
        """

    @abc.abstractmethod
    def sign(
        self,
        data: bytes,
        padding: AsymmetricPadding,
        algorithm: asym_utils.Prehashed | hashes.HashAlgorithm,
    ) -> bytes:
        """
        Signs the data.
        """

    @abc.abstractmethod
    def private_numbers(self) -> RSAPrivateNumbers:
        """
        Returns an RSAPrivateNumbers.
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
    def __copy__(self) -> RSAPrivateKey:
        """
        Returns a copy.
        """


RSAPrivateKeyWithSerialization = RSAPrivateKey
RSAPrivateKey.register(rust_openssl.rsa.RSAPrivateKey)


class RSAPublicKey(metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def encrypt(self, plaintext: bytes, padding: AsymmetricPadding) -> bytes:
        """
        Encrypts the given plaintext.
        """

    @property
    @abc.abstractmethod
    def key_size(self) -> int:
        """
        The bit length of the public modulus.
        """

    @abc.abstractmethod
    def public_numbers(self) -> RSAPublicNumbers:
        """
        Returns an RSAPublicNumbers
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
        signature: bytes,
        data: bytes,
        padding: AsymmetricPadding,
        algorithm: asym_utils.Prehashed | hashes.HashAlgorithm,
    ) -> None:
        """
        Verifies the signature of the data.
        """

    @abc.abstractmethod
    def recover_data_from_signature(
        self,
        signature: bytes,
        padding: AsymmetricPadding,
        algorithm: hashes.HashAlgorithm | None,
    ) -> bytes:
        """
        Recovers the original data from the signature.
        """

    @abc.abstractmethod
    def __eq__(self, other: object) -> bool:
        """
        Checks equality.
        """

    @abc.abstractmethod
    def __copy__(self) -> RSAPublicKey:
        """
        Returns a copy.
        """


RSAPublicKeyWithSerialization = RSAPublicKey
RSAPublicKey.register(rust_openssl.rsa.RSAPublicKey)

RSAPrivateNumbers = rust_openssl.rsa.RSAPrivateNumbers
RSAPublicNumbers = rust_openssl.rsa.RSAPublicNumbers


def generate_private_key(
    public_exponent: int,
    key_size: int,
    backend: typing.Any = None,
) -> RSAPrivateKey:
    _verify_rsa_parameters(public_exponent, key_size)
    return rust_openssl.rsa.generate_private_key(public_exponent, key_size)


def _verify_rsa_parameters(public_exponent: int, key_size: int) -> None:
    if public_exponent not in (3, 65537):
        raise ValueError(
            "public_exponent must be either 3 (for legacy compatibility) or "
            "65537. Almost everyone should choose 65537 here!"
        )

    if key_size < 1024:
        raise ValueError("key_size must be at least 1024-bits.")


def _modinv(e: int, m: int) -> int:
    """
    Modular Multiplicative Inverse. Returns x such that: (x*e) mod m == 1
    """
    x1, x2 = 1, 0
    a, b = e, m
    while b > 0:
        q, r = divmod(a, b)
        xn = x1 - q * x2
        a, b, x1, x2 = b, r, x2, xn
    return x1 % m


def rsa_crt_iqmp(p: int, q: int) -> int:
    """
    Compute the CRT (q ** -1) % p value from RSA primes p and q.
    """
    return _modinv(q, p)


def rsa_crt_dmp1(private_exponent: int, p: int) -> int:
    """
    Compute the CRT private_exponent % (p - 1) value from the RSA
    private_exponent (d) and p.
    """
    return private_exponent % (p - 1)


def rsa_crt_dmq1(private_exponent: int, q: int) -> int:
    """
    Compute the CRT private_exponent % (q - 1) value from the RSA
    private_exponent (d) and q.
    """
    return private_exponent % (q - 1)


def rsa_recover_private_exponent(e: int, p: int, q: int) -> int:
    """
    Compute the RSA private_exponent (d) given the public exponent (e)
    and the RSA primes p and q.

    This uses the Carmichael totient function to generate the
    smallest possible working value of the private exponent.
    """
    # This lambda_n is the Carmichael totient function.
    # The original RSA paper uses the Euler totient function
    # here: phi_n = (p - 1) * (q - 1)
    # Either version of the private exponent will work, but the
    # one generated by the older formulation may be larger
    # than necessary. (lambda_n always divides phi_n)
    #
    # TODO: Replace with lcm(p - 1, q - 1) once the minimum
    # supported Python version is >= 3.9.
    lambda_n = (p - 1) * (q - 1) // gcd(p - 1, q - 1)
    return _modinv(e, lambda_n)


# Controls the number of iterations rsa_recover_prime_factors will perform
# to obtain the prime factors.
_MAX_RECOVERY_ATTEMPTS = 500


def rsa_recover_prime_factors(n: int, e: int, d: int) -> tuple[int, int]:
    """
    Compute factors p and q from the private exponent d. We assume that n has
    no more than two factors. This function is adapted from code in PyCrypto.
    """
    # reject invalid values early
    if d <= 1 or e <= 1:
        raise ValueError("d, e can't be <= 1")
    if 17 != pow(17, e * d, n):
        raise ValueError("n, d, e don't match")
    # See 8.2.2(i) in Handbook of Applied Cryptography.
    ktot = d * e - 1
    # The quantity d*e-1 is a multiple of phi(n), even,
    # and can be represented as t*2^s.
    t = ktot
    while t % 2 == 0:
        t = t // 2
    # Cycle through all multiplicative inverses in Zn.
    # The algorithm is non-deterministic, but there is a 50% chance
    # any candidate a leads to successful factoring.
    # See "Digitalized Signatures and Public Key Functions as Intractable
    # as Factorization", M. Rabin, 1979
    spotted = False
    tries = 0
    while not spotted and tries < _MAX_RECOVERY_ATTEMPTS:
        a = random.randint(2, n - 1)
        tries += 1
        k = t
        # Cycle through all values a^{t*2^i}=a^k
        while k < ktot:
            cand = pow(a, k, n)
            # Check if a^k is a non-trivial root of unity (mod n)
            if cand != 1 and cand != (n - 1) and pow(cand, 2, n) == 1:
                # We have found a number such that (cand-1)(cand+1)=0 (mod n).
                # Either of the terms divides n.
                p = gcd(cand + 1, n)
                spotted = True
                break
            k *= 2
    if not spotted:
        raise ValueError("Unable to compute factors p and q from exponent d.")
    # Found !
    q, r = divmod(n, p)
    assert r == 0
    p, q = sorted((p, q), reverse=True)
    return (p, q)
