# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import abc
import typing

from cryptography.hazmat.bindings._rust import openssl as rust_openssl
from cryptography.hazmat.primitives import _serialization, hashes
from cryptography.hazmat.primitives.asymmetric import utils as asym_utils
from cryptography.utils import Buffer


class DSAParameters(metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def generate_private_key(self) -> DSAPrivateKey:
        """
        Generates and returns a DSAPrivateKey.
        """

    @abc.abstractmethod
    def parameter_numbers(self) -> DSAParameterNumbers:
        """
        Returns a DSAParameterNumbers.
        """


DSAParametersWithNumbers = DSAParameters
DSAParameters.register(rust_openssl.dsa.DSAParameters)


class DSAPrivateKey(metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def key_size(self) -> int:
        """
        The bit length of the prime modulus.
        """

    @abc.abstractmethod
    def public_key(self) -> DSAPublicKey:
        """
        The DSAPublicKey associated with this private key.
        """

    @abc.abstractmethod
    def parameters(self) -> DSAParameters:
        """
        The DSAParameters object associated with this private key.
        """

    @abc.abstractmethod
    def sign(
        self,
        data: Buffer,
        algorithm: asym_utils.Prehashed | hashes.HashAlgorithm,
    ) -> bytes:
        """
        Signs the data
        """

    @abc.abstractmethod
    def private_numbers(self) -> DSAPrivateNumbers:
        """
        Returns a DSAPrivateNumbers.
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
    def __copy__(self) -> DSAPrivateKey:
        """
        Returns a copy.
        """


DSAPrivateKeyWithSerialization = DSAPrivateKey
DSAPrivateKey.register(rust_openssl.dsa.DSAPrivateKey)


class DSAPublicKey(metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def key_size(self) -> int:
        """
        The bit length of the prime modulus.
        """

    @abc.abstractmethod
    def parameters(self) -> DSAParameters:
        """
        The DSAParameters object associated with this public key.
        """

    @abc.abstractmethod
    def public_numbers(self) -> DSAPublicNumbers:
        """
        Returns a DSAPublicNumbers.
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
        signature: Buffer,
        data: Buffer,
        algorithm: asym_utils.Prehashed | hashes.HashAlgorithm,
    ) -> None:
        """
        Verifies the signature of the data.
        """

    @abc.abstractmethod
    def __eq__(self, other: object) -> bool:
        """
        Checks equality.
        """

    @abc.abstractmethod
    def __copy__(self) -> DSAPublicKey:
        """
        Returns a copy.
        """


DSAPublicKeyWithSerialization = DSAPublicKey
DSAPublicKey.register(rust_openssl.dsa.DSAPublicKey)

DSAPrivateNumbers = rust_openssl.dsa.DSAPrivateNumbers
DSAPublicNumbers = rust_openssl.dsa.DSAPublicNumbers
DSAParameterNumbers = rust_openssl.dsa.DSAParameterNumbers


def generate_parameters(
    key_size: int, backend: typing.Any = None
) -> DSAParameters:
    if key_size not in (1024, 2048, 3072, 4096):
        raise ValueError("Key size must be 1024, 2048, 3072, or 4096 bits.")

    return rust_openssl.dsa.generate_parameters(key_size)


def generate_private_key(
    key_size: int, backend: typing.Any = None
) -> DSAPrivateKey:
    parameters = generate_parameters(key_size)
    return parameters.generate_private_key()
