# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

from cryptography.hazmat.bindings._rust import openssl as rust_openssl
from cryptography.hazmat.bindings.openssl import binding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives._asymmetric import AsymmetricPadding
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric import utils as asym_utils
from cryptography.hazmat.primitives.asymmetric.padding import (
    MGF1,
    OAEP,
    PSS,
    PKCS1v15,
)
from cryptography.hazmat.primitives.ciphers import (
    CipherAlgorithm,
)
from cryptography.hazmat.primitives.ciphers.algorithms import (
    AES,
)
from cryptography.hazmat.primitives.ciphers.modes import (
    CBC,
    Mode,
)


class Backend:
    """
    OpenSSL API binding interfaces.
    """

    name = "openssl"

    # TripleDES encryption is disallowed/deprecated throughout 2023 in
    # FIPS 140-3. To keep it simple we denylist any use of TripleDES (TDEA).
    _fips_ciphers = (AES,)
    # Sometimes SHA1 is still permissible. That logic is contained
    # within the various *_supported methods.
    _fips_hashes = (
        hashes.SHA224,
        hashes.SHA256,
        hashes.SHA384,
        hashes.SHA512,
        hashes.SHA512_224,
        hashes.SHA512_256,
        hashes.SHA3_224,
        hashes.SHA3_256,
        hashes.SHA3_384,
        hashes.SHA3_512,
        hashes.SHAKE128,
        hashes.SHAKE256,
    )
    _fips_ecdh_curves = (
        ec.SECP224R1,
        ec.SECP256R1,
        ec.SECP384R1,
        ec.SECP521R1,
    )
    _fips_rsa_min_key_size = 2048
    _fips_rsa_min_public_exponent = 65537
    _fips_dsa_min_modulus = 1 << 2048
    _fips_dh_min_key_size = 2048
    _fips_dh_min_modulus = 1 << _fips_dh_min_key_size

    def __init__(self) -> None:
        self._binding = binding.Binding()
        self._ffi = self._binding.ffi
        self._lib = self._binding.lib
        self._fips_enabled = rust_openssl.is_fips_enabled()

    def __repr__(self) -> str:
        return (
            f"<OpenSSLBackend(version: {self.openssl_version_text()}, "
            f"FIPS: {self._fips_enabled}, "
            f"Legacy: {rust_openssl._legacy_provider_loaded})>"
        )

    def openssl_assert(self, ok: bool) -> None:
        return binding._openssl_assert(ok)

    def _enable_fips(self) -> None:
        # This function enables FIPS mode for OpenSSL 3.0.0 on installs that
        # have the FIPS provider installed properly.
        rust_openssl.enable_fips(rust_openssl._providers)
        assert rust_openssl.is_fips_enabled()
        self._fips_enabled = rust_openssl.is_fips_enabled()

    def openssl_version_text(self) -> str:
        """
        Friendly string name of the loaded OpenSSL library. This is not
        necessarily the same version as it was compiled against.

        Example: OpenSSL 3.2.1 30 Jan 2024
        """
        return rust_openssl.openssl_version_text()

    def openssl_version_number(self) -> int:
        return rust_openssl.openssl_version()

    def hash_supported(self, algorithm: hashes.HashAlgorithm) -> bool:
        if self._fips_enabled and not isinstance(algorithm, self._fips_hashes):
            return False

        return rust_openssl.hashes.hash_supported(algorithm)

    def signature_hash_supported(
        self, algorithm: hashes.HashAlgorithm
    ) -> bool:
        # Dedicated check for hashing algorithm use in message digest for
        # signatures, e.g. RSA PKCS#1 v1.5 SHA1 (sha1WithRSAEncryption).
        if self._fips_enabled and isinstance(algorithm, hashes.SHA1):
            return False
        return self.hash_supported(algorithm)

    def scrypt_supported(self) -> bool:
        if self._fips_enabled:
            return False
        else:
            return hasattr(rust_openssl.kdf.Scrypt, "derive")

    def argon2_supported(self) -> bool:
        if self._fips_enabled:
            return False
        else:
            return hasattr(rust_openssl.kdf.Argon2id, "derive")

    def hmac_supported(self, algorithm: hashes.HashAlgorithm) -> bool:
        # FIPS mode still allows SHA1 for HMAC
        if self._fips_enabled and isinstance(algorithm, hashes.SHA1):
            return True
        if rust_openssl.CRYPTOGRAPHY_IS_AWSLC:
            return isinstance(
                algorithm,
                (
                    hashes.SHA1,
                    hashes.SHA224,
                    hashes.SHA256,
                    hashes.SHA384,
                    hashes.SHA512,
                    hashes.SHA512_224,
                    hashes.SHA512_256,
                ),
            )
        return self.hash_supported(algorithm)

    def cipher_supported(self, cipher: CipherAlgorithm, mode: Mode) -> bool:
        if self._fips_enabled:
            # FIPS mode requires AES. TripleDES is disallowed/deprecated in
            # FIPS 140-3.
            if not isinstance(cipher, self._fips_ciphers):
                return False

        return rust_openssl.ciphers.cipher_supported(cipher, mode)

    def pbkdf2_hmac_supported(self, algorithm: hashes.HashAlgorithm) -> bool:
        return self.hmac_supported(algorithm)

    def _consume_errors(self) -> list[rust_openssl.OpenSSLError]:
        return rust_openssl.capture_error_stack()

    def _oaep_hash_supported(self, algorithm: hashes.HashAlgorithm) -> bool:
        if self._fips_enabled and isinstance(algorithm, hashes.SHA1):
            return False

        return isinstance(
            algorithm,
            (
                hashes.SHA1,
                hashes.SHA224,
                hashes.SHA256,
                hashes.SHA384,
                hashes.SHA512,
            ),
        )

    def rsa_padding_supported(self, padding: AsymmetricPadding) -> bool:
        if isinstance(padding, PKCS1v15):
            return True
        elif isinstance(padding, PSS) and isinstance(padding._mgf, MGF1):
            # FIPS 186-4 only allows salt length == digest length for PSS
            # It is technically acceptable to set an explicit salt length
            # equal to the digest length and this will incorrectly fail, but
            # since we don't do that in the tests and this method is
            # private, we'll ignore that until we need to do otherwise.
            if (
                self._fips_enabled
                and padding._salt_length != PSS.DIGEST_LENGTH
            ):
                return False
            return self.hash_supported(padding._mgf._algorithm)
        elif isinstance(padding, OAEP) and isinstance(padding._mgf, MGF1):
            return self._oaep_hash_supported(
                padding._mgf._algorithm
            ) and self._oaep_hash_supported(padding._algorithm)
        else:
            return False

    def rsa_encryption_supported(self, padding: AsymmetricPadding) -> bool:
        if self._fips_enabled and isinstance(padding, PKCS1v15):
            return False
        else:
            return self.rsa_padding_supported(padding)

    def dsa_supported(self) -> bool:
        return (
            not rust_openssl.CRYPTOGRAPHY_IS_BORINGSSL
            and not self._fips_enabled
        )

    def dsa_hash_supported(self, algorithm: hashes.HashAlgorithm) -> bool:
        if not self.dsa_supported():
            return False
        return self.signature_hash_supported(algorithm)

    def cmac_algorithm_supported(self, algorithm) -> bool:
        return self.cipher_supported(
            algorithm, CBC(b"\x00" * algorithm.block_size)
        )

    def elliptic_curve_supported(self, curve: ec.EllipticCurve) -> bool:
        if self._fips_enabled and not isinstance(
            curve, self._fips_ecdh_curves
        ):
            return False

        return rust_openssl.ec.curve_supported(curve)

    def elliptic_curve_signature_algorithm_supported(
        self,
        signature_algorithm: ec.EllipticCurveSignatureAlgorithm,
        curve: ec.EllipticCurve,
    ) -> bool:
        # We only support ECDSA right now.
        if not isinstance(signature_algorithm, ec.ECDSA):
            return False

        return self.elliptic_curve_supported(curve) and (
            isinstance(signature_algorithm.algorithm, asym_utils.Prehashed)
            or self.hash_supported(signature_algorithm.algorithm)
        )

    def elliptic_curve_exchange_algorithm_supported(
        self, algorithm: ec.ECDH, curve: ec.EllipticCurve
    ) -> bool:
        return self.elliptic_curve_supported(curve) and isinstance(
            algorithm, ec.ECDH
        )

    def dh_supported(self) -> bool:
        return (
            not rust_openssl.CRYPTOGRAPHY_IS_BORINGSSL
            and not rust_openssl.CRYPTOGRAPHY_IS_AWSLC
        )

    def dh_x942_serialization_supported(self) -> bool:
        return self._lib.Cryptography_HAS_EVP_PKEY_DHX == 1

    def x25519_supported(self) -> bool:
        if self._fips_enabled:
            return False
        return True

    def x448_supported(self) -> bool:
        if self._fips_enabled:
            return False
        return (
            not rust_openssl.CRYPTOGRAPHY_IS_LIBRESSL
            and not rust_openssl.CRYPTOGRAPHY_IS_BORINGSSL
            and not rust_openssl.CRYPTOGRAPHY_IS_AWSLC
        )

    def ed25519_supported(self) -> bool:
        if self._fips_enabled:
            return False
        return True

    def ed448_supported(self) -> bool:
        if self._fips_enabled:
            return False
        return (
            not rust_openssl.CRYPTOGRAPHY_IS_LIBRESSL
            and not rust_openssl.CRYPTOGRAPHY_IS_BORINGSSL
            and not rust_openssl.CRYPTOGRAPHY_IS_AWSLC
        )

    def ecdsa_deterministic_supported(self) -> bool:
        return (
            rust_openssl.CRYPTOGRAPHY_OPENSSL_320_OR_GREATER
            and not self._fips_enabled
        )

    def poly1305_supported(self) -> bool:
        if self._fips_enabled:
            return False
        return True

    def pkcs7_supported(self) -> bool:
        return (
            not rust_openssl.CRYPTOGRAPHY_IS_BORINGSSL
            and not rust_openssl.CRYPTOGRAPHY_IS_AWSLC
        )


backend = Backend()
