# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import abc
import typing

from cryptography.hazmat.bindings._rust import openssl as rust_openssl
from cryptography.hazmat.primitives._cipheralgorithm import CipherAlgorithm
from cryptography.hazmat.primitives.ciphers import modes
from cryptography.utils import Buffer


class CipherContext(metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def update(self, data: Buffer) -> bytes:
        """
        Processes the provided bytes through the cipher and returns the results
        as bytes.
        """

    @abc.abstractmethod
    def update_into(self, data: Buffer, buf: Buffer) -> int:
        """
        Processes the provided bytes and writes the resulting data into the
        provided buffer. Returns the number of bytes written.
        """

    @abc.abstractmethod
    def finalize(self) -> bytes:
        """
        Returns the results of processing the final block as bytes.
        """

    @abc.abstractmethod
    def reset_nonce(self, nonce: bytes) -> None:
        """
        Resets the nonce for the cipher context to the provided value.
        Raises an exception if it does not support reset or if the
        provided nonce does not have a valid length.
        """


class AEADCipherContext(CipherContext, metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def authenticate_additional_data(self, data: Buffer) -> None:
        """
        Authenticates the provided bytes.
        """


class AEADDecryptionContext(AEADCipherContext, metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def finalize_with_tag(self, tag: bytes) -> bytes:
        """
        Returns the results of processing the final block as bytes and allows
        delayed passing of the authentication tag.
        """


class AEADEncryptionContext(AEADCipherContext, metaclass=abc.ABCMeta):
    @property
    @abc.abstractmethod
    def tag(self) -> bytes:
        """
        Returns tag bytes. This is only available after encryption is
        finalized.
        """


Mode = typing.TypeVar(
    "Mode", bound=typing.Optional[modes.Mode], covariant=True
)


class Cipher(typing.Generic[Mode]):
    def __init__(
        self,
        algorithm: CipherAlgorithm,
        mode: Mode,
        backend: typing.Any = None,
    ) -> None:
        if not isinstance(algorithm, CipherAlgorithm):
            raise TypeError("Expected interface of CipherAlgorithm.")

        if mode is not None:
            # mypy needs this assert to narrow the type from our generic
            # type. Maybe it won't some time in the future.
            assert isinstance(mode, modes.Mode)
            mode.validate_for_algorithm(algorithm)

        self.algorithm = algorithm
        self.mode = mode

    @typing.overload
    def encryptor(
        self: Cipher[modes.ModeWithAuthenticationTag],
    ) -> AEADEncryptionContext: ...

    @typing.overload
    def encryptor(
        self: _CIPHER_TYPE,
    ) -> CipherContext: ...

    def encryptor(self):
        if isinstance(self.mode, modes.ModeWithAuthenticationTag):
            if self.mode.tag is not None:
                raise ValueError(
                    "Authentication tag must be None when encrypting."
                )

        return rust_openssl.ciphers.create_encryption_ctx(
            self.algorithm, self.mode
        )

    @typing.overload
    def decryptor(
        self: Cipher[modes.ModeWithAuthenticationTag],
    ) -> AEADDecryptionContext: ...

    @typing.overload
    def decryptor(
        self: _CIPHER_TYPE,
    ) -> CipherContext: ...

    def decryptor(self):
        return rust_openssl.ciphers.create_decryption_ctx(
            self.algorithm, self.mode
        )


_CIPHER_TYPE = Cipher[
    typing.Union[
        modes.ModeWithNonce,
        modes.ModeWithTweak,
        modes.ECB,
        modes.ModeWithInitializationVector,
        None,
    ]
]

CipherContext.register(rust_openssl.ciphers.CipherContext)
AEADEncryptionContext.register(rust_openssl.ciphers.AEADEncryptionContext)
AEADDecryptionContext.register(rust_openssl.ciphers.AEADDecryptionContext)
