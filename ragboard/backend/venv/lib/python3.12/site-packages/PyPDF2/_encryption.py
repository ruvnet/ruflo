# Copyright (c) 2022, exiledkingcc
# All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are
# met:
#
# * Redistributions of source code must retain the above copyright notice,
# this list of conditions and the following disclaimer.
# * Redistributions in binary form must reproduce the above copyright notice,
# this list of conditions and the following disclaimer in the documentation
# and/or other materials provided with the distribution.
# * The name of the author may not be used to endorse or promote products
# derived from this software without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
# LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
# CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
# SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
# CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
# ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
# POSSIBILITY OF SUCH DAMAGE.

import hashlib
import random
import struct
from enum import IntEnum
from typing import Any, Dict, Optional, Tuple, Union, cast

from ._utils import logger_warning
from .errors import DependencyError
from .generic import (
    ArrayObject,
    ByteStringObject,
    DictionaryObject,
    PdfObject,
    StreamObject,
    TextStringObject,
    create_string_object,
)


class CryptBase:
    def encrypt(self, data: bytes) -> bytes:  # pragma: no cover
        return data

    def decrypt(self, data: bytes) -> bytes:  # pragma: no cover
        return data


class CryptIdentity(CryptBase):
    pass


try:
    from Crypto.Cipher import AES, ARC4  # type: ignore[import]
    from Crypto.Util.Padding import pad  # type: ignore[import]

    class CryptRC4(CryptBase):
        def __init__(self, key: bytes) -> None:
            self.key = key

        def encrypt(self, data: bytes) -> bytes:
            return ARC4.ARC4Cipher(self.key).encrypt(data)

        def decrypt(self, data: bytes) -> bytes:
            return ARC4.ARC4Cipher(self.key).decrypt(data)

    class CryptAES(CryptBase):
        def __init__(self, key: bytes) -> None:
            self.key = key

        def encrypt(self, data: bytes) -> bytes:
            iv = bytes(bytearray(random.randint(0, 255) for _ in range(16)))
            p = 16 - len(data) % 16
            data += bytes(bytearray(p for _ in range(p)))
            aes = AES.new(self.key, AES.MODE_CBC, iv)
            return iv + aes.encrypt(data)

        def decrypt(self, data: bytes) -> bytes:
            iv = data[:16]
            data = data[16:]
            aes = AES.new(self.key, AES.MODE_CBC, iv)
            if len(data) % 16:
                data = pad(data, 16)
            d = aes.decrypt(data)
            if len(d) == 0:
                return d
            else:
                return d[: -d[-1]]

    def RC4_encrypt(key: bytes, data: bytes) -> bytes:
        return ARC4.ARC4Cipher(key).encrypt(data)

    def RC4_decrypt(key: bytes, data: bytes) -> bytes:
        return ARC4.ARC4Cipher(key).decrypt(data)

    def AES_ECB_encrypt(key: bytes, data: bytes) -> bytes:
        return AES.new(key, AES.MODE_ECB).encrypt(data)

    def AES_ECB_decrypt(key: bytes, data: bytes) -> bytes:
        return AES.new(key, AES.MODE_ECB).decrypt(data)

    def AES_CBC_encrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
        return AES.new(key, AES.MODE_CBC, iv).encrypt(data)

    def AES_CBC_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
        return AES.new(key, AES.MODE_CBC, iv).decrypt(data)

except ImportError:

    class CryptRC4(CryptBase):  # type: ignore
        def __init__(self, key: bytes) -> None:
            self.S = list(range(256))
            j = 0
            for i in range(256):
                j = (j + self.S[i] + key[i % len(key)]) % 256
                self.S[i], self.S[j] = self.S[j], self.S[i]

        def encrypt(self, data: bytes) -> bytes:
            S = list(self.S)
            out = list(0 for _ in range(len(data)))
            i, j = 0, 0
            for k in range(len(data)):
                i = (i + 1) % 256
                j = (j + S[i]) % 256
                S[i], S[j] = S[j], S[i]
                x = S[(S[i] + S[j]) % 256]
                out[k] = data[k] ^ x
            return bytes(bytearray(out))

        def decrypt(self, data: bytes) -> bytes:
            return self.encrypt(data)

    class CryptAES(CryptBase):  # type: ignore
        def __init__(self, key: bytes) -> None:
            pass

        def encrypt(self, data: bytes) -> bytes:
            raise DependencyError("PyCryptodome is required for AES algorithm")

        def decrypt(self, data: bytes) -> bytes:
            raise DependencyError("PyCryptodome is required for AES algorithm")

    def RC4_encrypt(key: bytes, data: bytes) -> bytes:
        return CryptRC4(key).encrypt(data)

    def RC4_decrypt(key: bytes, data: bytes) -> bytes:
        return CryptRC4(key).decrypt(data)

    def AES_ECB_encrypt(key: bytes, data: bytes) -> bytes:
        raise DependencyError("PyCryptodome is required for AES algorithm")

    def AES_ECB_decrypt(key: bytes, data: bytes) -> bytes:
        raise DependencyError("PyCryptodome is required for AES algorithm")

    def AES_CBC_encrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
        raise DependencyError("PyCryptodome is required for AES algorithm")

    def AES_CBC_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
        raise DependencyError("PyCryptodome is required for AES algorithm")


class CryptFilter:
    def __init__(
        self, stmCrypt: CryptBase, strCrypt: CryptBase, efCrypt: CryptBase
    ) -> None:
        self.stmCrypt = stmCrypt
        self.strCrypt = strCrypt
        self.efCrypt = efCrypt

    def encrypt_object(self, obj: PdfObject) -> PdfObject:
        # TODO
        return NotImplemented

    def decrypt_object(self, obj: PdfObject) -> PdfObject:
        if isinstance(obj, (ByteStringObject, TextStringObject)):
            data = self.strCrypt.decrypt(obj.original_bytes)
            obj = create_string_object(data)
        elif isinstance(obj, StreamObject):
            obj._data = self.stmCrypt.decrypt(obj._data)
        elif isinstance(obj, DictionaryObject):
            for dictkey, value in list(obj.items()):
                obj[dictkey] = self.decrypt_object(value)
        elif isinstance(obj, ArrayObject):
            for i in range(len(obj)):
                obj[i] = self.decrypt_object(obj[i])
        return obj


_PADDING = bytes(
    [
        0x28,
        0xBF,
        0x4E,
        0x5E,
        0x4E,
        0x75,
        0x8A,
        0x41,
        0x64,
        0x00,
        0x4E,
        0x56,
        0xFF,
        0xFA,
        0x01,
        0x08,
        0x2E,
        0x2E,
        0x00,
        0xB6,
        0xD0,
        0x68,
        0x3E,
        0x80,
        0x2F,
        0x0C,
        0xA9,
        0xFE,
        0x64,
        0x53,
        0x69,
        0x7A,
    ]
)


def _padding(data: bytes) -> bytes:
    return (data + _PADDING)[:32]


class AlgV4:
    @staticmethod
    def compute_key(
        password: bytes,
        rev: int,
        key_size: int,
        o_entry: bytes,
        P: int,
        id1_entry: bytes,
        metadata_encrypted: bool,
    ) -> bytes:
        """
        Algorithm 2: Computing an encryption key.

        a) Pad or truncate the password string to exactly 32 bytes. If the
           password string is more than 32 bytes long,
           use only its first 32 bytes; if it is less than 32 bytes long, pad it
           by appending the required number of
           additional bytes from the beginning of the following padding string:
                < 28 BF 4E 5E 4E 75 8A 41 64 00 4E 56 FF FA 01 08
                2E 2E 00 B6 D0 68 3E 80 2F 0C A9 FE 64 53 69 7A >
           That is, if the password string is n bytes long, append
           the first 32 - n bytes of the padding string to the end
           of the password string. If the password string is empty (zero-length),
           meaning there is no user password,
           substitute the entire padding string in its place.

        b) Initialize the MD5 hash function and pass the result of step (a)
           as input to this function.
        c) Pass the value of the encryption dictionary’s O entry to the
           MD5 hash function. ("Algorithm 3: Computing
           the encryption dictionary’s O (owner password) value" shows how the
           O value is computed.)
        d) Convert the integer value of the P entry to a 32-bit unsigned binary
           number and pass these bytes to the
           MD5 hash function, low-order byte first.
        e) Pass the first element of the file’s file identifier array (the value
           of the ID entry in the document’s trailer
           dictionary; see Table 15) to the MD5 hash function.
        f) (Security handlers of revision 4 or greater) If document metadata is
           not being encrypted, pass 4 bytes with
           the value 0xFFFFFFFF to the MD5 hash function.
        g) Finish the hash.
        h) (Security handlers of revision 3 or greater) Do the following
           50 times: Take the output from the previous
           MD5 hash and pass the first n bytes of the output as input into a new
           MD5 hash, where n is the number of
           bytes of the encryption key as defined by the value of the encryption
           dictionary’s Length entry.
        i) Set the encryption key to the first n bytes of the output from the
           final MD5 hash, where n shall always be 5
           for security handlers of revision 2 but, for security handlers of
           revision 3 or greater, shall depend on the
           value of the encryption dictionary’s Length entry.
        """
        a = _padding(password)
        u_hash = hashlib.md5(a)
        u_hash.update(o_entry)
        u_hash.update(struct.pack("<I", P))
        u_hash.update(id1_entry)
        if rev >= 4 and metadata_encrypted is False:
            u_hash.update(b"\xff\xff\xff\xff")
        u_hash_digest = u_hash.digest()
        length = key_size // 8
        if rev >= 3:
            for _ in range(50):
                u_hash_digest = hashlib.md5(u_hash_digest[:length]).digest()
        return u_hash_digest[:length]

    @staticmethod
    def compute_O_value_key(owner_password: bytes, rev: int, key_size: int) -> bytes:
        """
        Algorithm 3: Computing the encryption dictionary’s O (owner password) value.

        a) Pad or truncate the owner password string as described in step (a)
           of "Algorithm 2: Computing an encryption key".
           If there is no owner password, use the user password instead.
        b) Initialize the MD5 hash function and pass the result of step (a) as
           input to this function.
        c) (Security handlers of revision 3 or greater) Do the following 50 times:
           Take the output from the previous
           MD5 hash and pass it as input into a new MD5 hash.
        d) Create an RC4 encryption key using the first n bytes of the output
           from the final MD5 hash, where n shall
           always be 5 for security handlers of revision 2 but, for security
           handlers of revision 3 or greater, shall
           depend on the value of the encryption dictionary’s Length entry.
        e) Pad or truncate the user password string as described in step (a) of
           "Algorithm 2: Computing an encryption key".
        f) Encrypt the result of step (e), using an RC4 encryption function with
           the encryption key obtained in step (d).
        g) (Security handlers of revision 3 or greater) Do the following 19 times:
           Take the output from the previous
           invocation of the RC4 function and pass it as input to a new
           invocation of the function; use an encryption
           key generated by taking each byte of the encryption key obtained in
           step (d) and performing an XOR
           (exclusive or) operation between that byte and the single-byte value
           of the iteration counter (from 1 to 19).
        h) Store the output from the final invocation of the RC4 function as
           the value of the O entry in the encryption dictionary.
        """
        a = _padding(owner_password)
        o_hash_digest = hashlib.md5(a).digest()

        if rev >= 3:
            for _ in range(50):
                o_hash_digest = hashlib.md5(o_hash_digest).digest()

        rc4_key = o_hash_digest[: key_size // 8]
        return rc4_key

    @staticmethod
    def compute_O_value(rc4_key: bytes, user_password: bytes, rev: int) -> bytes:
        """See :func:`compute_O_value_key`."""
        a = _padding(user_password)
        rc4_enc = RC4_encrypt(rc4_key, a)
        if rev >= 3:
            for i in range(1, 20):
                key = bytes(bytearray(x ^ i for x in rc4_key))
                rc4_enc = RC4_encrypt(key, rc4_enc)
        return rc4_enc

    @staticmethod
    def compute_U_value(key: bytes, rev: int, id1_entry: bytes) -> bytes:
        """
        Algorithm 4: Computing the encryption dictionary’s U (user password) value.

        (Security handlers of revision 2)

        a) Create an encryption key based on the user password string, as
           described in "Algorithm 2: Computing an encryption key".
        b) Encrypt the 32-byte padding string shown in step (a) of
           "Algorithm 2: Computing an encryption key", using an RC4 encryption
           function with the encryption key from the preceding step.
        c) Store the result of step (b) as the value of the U entry in the
           encryption dictionary.
        """
        if rev <= 2:
            value = RC4_encrypt(key, _PADDING)
            return value

        """
        Algorithm 5: Computing the encryption dictionary’s U (user password) value.

        (Security handlers of revision 3 or greater)

        a) Create an encryption key based on the user password string, as
           described in "Algorithm 2: Computing an encryption key".
        b) Initialize the MD5 hash function and pass the 32-byte padding string
           shown in step (a) of "Algorithm 2:
           Computing an encryption key" as input to this function.
        c) Pass the first element of the file’s file identifier array (the value
           of the ID entry in the document’s trailer
           dictionary; see Table 15) to the hash function and finish the hash.
        d) Encrypt the 16-byte result of the hash, using an RC4 encryption
           function with the encryption key from step (a).
        e) Do the following 19 times: Take the output from the previous
           invocation of the RC4 function and pass it as input to a new
           invocation of the function; use an encryption key generated by
           taking each byte of the original encryption key obtained in
           step (a) and performing an XOR (exclusive or) operation between that
           byte and the single-byte value of the iteration counter (from 1 to 19).
        f) Append 16 bytes of arbitrary padding to the output from the final
           invocation of the RC4 function and store the 32-byte result as the
           value of the U entry in the encryption dictionary.
        """
        u_hash = hashlib.md5(_PADDING)
        u_hash.update(id1_entry)
        rc4_enc = RC4_encrypt(key, u_hash.digest())
        for i in range(1, 20):
            rc4_key = bytes(bytearray(x ^ i for x in key))
            rc4_enc = RC4_encrypt(rc4_key, rc4_enc)
        return _padding(rc4_enc)

    @staticmethod
    def verify_user_password(
        user_password: bytes,
        rev: int,
        key_size: int,
        o_entry: bytes,
        u_entry: bytes,
        P: int,
        id1_entry: bytes,
        metadata_encrypted: bool,
    ) -> bytes:
        """
        Algorithm 6: Authenticating the user password.

        a) Perform all but the last step of "Algorithm 4: Computing the encryption dictionary’s U (user password)
           value (Security handlers of revision 2)" or "Algorithm 5: Computing the encryption dictionary’s U (user
           password) value (Security handlers of revision 3 or greater)" using the supplied password string.
        b) If the result of step (a) is equal to the value of the encryption dictionary’s U entry (comparing on the first 16
           bytes in the case of security handlers of revision 3 or greater), the password supplied is the correct user
           password. The key obtained in step (a) (that is, in the first step of "Algorithm 4: Computing the encryption
           dictionary’s U (user password) value (Security handlers of revision 2)" or "Algorithm 5: Computing the
           encryption dictionary’s U (user password) value (Security handlers of revision 3 or greater)") shall be used
           to decrypt the document.
        """
        key = AlgV4.compute_key(
            user_password, rev, key_size, o_entry, P, id1_entry, metadata_encrypted
        )
        u_value = AlgV4.compute_U_value(key, rev, id1_entry)
        if rev >= 3:
            u_value = u_value[:16]
            u_entry = u_entry[:16]
        if u_value != u_entry:
            key = b""
        return key

    @staticmethod
    def verify_owner_password(
        owner_password: bytes,
        rev: int,
        key_size: int,
        o_entry: bytes,
        u_entry: bytes,
        P: int,
        id1_entry: bytes,
        metadata_encrypted: bool,
    ) -> bytes:
        """
        Algorithm 7: Authenticating the owner password.

        a) Compute an encryption key from the supplied password string, as described in steps (a) to (d) of
           "Algorithm 3: Computing the encryption dictionary’s O (owner password) value".
        b) (Security handlers of revision 2 only) Decrypt the value of the encryption dictionary’s O entry, using an RC4
           encryption function with the encryption key computed in step (a).
           (Security handlers of revision 3 or greater) Do the following 20 times: Decrypt the value of the encryption
           dictionary’s O entry (first iteration) or the output from the previous iteration (all subsequent iterations),
           using an RC4 encryption function with a different encryption key at each iteration. The key shall be
           generated by taking the original key (obtained in step (a)) and performing an XOR (exclusive or) operation
           between each byte of the key and the single-byte value of the iteration counter (from 19 to 0).
        c) The result of step (b) purports to be the user password. Authenticate this user password using "Algorithm 6:
           Authenticating the user password". If it is correct, the password supplied is the correct owner password.
        """
        rc4_key = AlgV4.compute_O_value_key(owner_password, rev, key_size)

        if rev <= 2:
            user_password = RC4_decrypt(rc4_key, o_entry)
        else:
            user_password = o_entry
            for i in range(19, -1, -1):
                key = bytes(bytearray(x ^ i for x in rc4_key))
                user_password = RC4_decrypt(key, user_password)
        return AlgV4.verify_user_password(
            user_password,
            rev,
            key_size,
            o_entry,
            u_entry,
            P,
            id1_entry,
            metadata_encrypted,
        )


class AlgV5:
    @staticmethod
    def verify_owner_password(
        R: int, password: bytes, o_value: bytes, oe_value: bytes, u_value: bytes
    ) -> bytes:
        """
        Algorithm 3.2a Computing an encryption key.

        To understand the algorithm below, it is necessary to treat the O and U strings in the Encrypt dictionary
        as made up of three sections. The first 32 bytes are a hash value (explained below). The next 8 bytes are
        called the Validation Salt. The final 8 bytes are called the Key Salt.

        1. The password string is generated from Unicode input by processing the input string with the SASLprep
           (IETF RFC 4013) profile of stringprep (IETF RFC 3454), and then converting to a UTF-8 representation.
        2. Truncate the UTF-8 representation to 127 bytes if it is longer than 127 bytes.
        3. Test the password against the owner key by computing the SHA-256 hash of the UTF-8 password
           concatenated with the 8 bytes of owner Validation Salt, concatenated with the 48-byte U string. If the
           32-byte result matches the first 32 bytes of the O string, this is the owner password.
           Compute an intermediate owner key by computing the SHA-256 hash of the UTF-8 password
           concatenated with the 8 bytes of owner Key Salt, concatenated with the 48-byte U string. The 32-byte
           result is the key used to decrypt the 32-byte OE string using AES-256 in CBC mode with no padding and
           an initialization vector of zero. The 32-byte result is the file encryption key.
        4. Test the password against the user key by computing the SHA-256 hash of the UTF-8 password
           concatenated with the 8 bytes of user Validation Salt. If the 32 byte result matches the first 32 bytes of
           the U string, this is the user password.
           Compute an intermediate user key by computing the SHA-256 hash of the UTF-8 password
           concatenated with the 8 bytes of user Key Salt. The 32-byte result is the key used to decrypt the 32-byte
           UE string using AES-256 in CBC mode with no padding and an initialization vector of zero. The 32-byte
           result is the file encryption key.
        5. Decrypt the 16-byte Perms string using AES-256 in ECB mode with an initialization vector of zero and
           the file encryption key as the key. Verify that bytes 9-11 of the result are the characters ‘a’, ‘d’, ‘b’. Bytes
           0-3 of the decrypted Perms entry, treated as a little-endian integer, are the user permissions. They
           should match the value in the P key.
        """
        password = password[:127]
        if (
            AlgV5.calculate_hash(R, password, o_value[32:40], u_value[:48])
            != o_value[:32]
        ):
            return b""
        iv = bytes(0 for _ in range(16))
        tmp_key = AlgV5.calculate_hash(R, password, o_value[40:48], u_value[:48])
        key = AES_CBC_decrypt(tmp_key, iv, oe_value)
        return key

    @staticmethod
    def verify_user_password(
        R: int, password: bytes, u_value: bytes, ue_value: bytes
    ) -> bytes:
        """See :func:`verify_owner_password`."""
        password = password[:127]
        if AlgV5.calculate_hash(R, password, u_value[32:40], b"") != u_value[:32]:
            return b""
        iv = bytes(0 for _ in range(16))
        tmp_key = AlgV5.calculate_hash(R, password, u_value[40:48], b"")
        return AES_CBC_decrypt(tmp_key, iv, ue_value)

    @staticmethod
    def calculate_hash(R: int, password: bytes, salt: bytes, udata: bytes) -> bytes:
        # from https://github.com/qpdf/qpdf/blob/main/libqpdf/QPDF_encryption.cc
        K = hashlib.sha256(password + salt + udata).digest()
        if R < 6:
            return K
        count = 0
        while True:
            count += 1
            K1 = password + K + udata
            E = AES_CBC_encrypt(K[:16], K[16:32], K1 * 64)
            hash_fn = (
                hashlib.sha256,
                hashlib.sha384,
                hashlib.sha512,
            )[sum(E[:16]) % 3]
            K = hash_fn(E).digest()
            if count >= 64 and E[-1] <= count - 32:
                break
        return K[:32]

    @staticmethod
    def verify_perms(
        key: bytes, perms: bytes, p: int, metadata_encrypted: bool
    ) -> bool:
        """See :func:`verify_owner_password` and :func:`compute_Perms_value`."""
        b8 = b"T" if metadata_encrypted else b"F"
        p1 = struct.pack("<I", p) + b"\xff\xff\xff\xff" + b8 + b"adb"
        p2 = AES_ECB_decrypt(key, perms)
        return p1 == p2[:12]

    @staticmethod
    def generate_values(
        user_password: bytes,
        owner_password: bytes,
        key: bytes,
        p: int,
        metadata_encrypted: bool,
    ) -> Dict[Any, Any]:
        u_value, ue_value = AlgV5.compute_U_value(user_password, key)
        o_value, oe_value = AlgV5.compute_O_value(owner_password, key, u_value)
        perms = AlgV5.compute_Perms_value(key, p, metadata_encrypted)
        return {
            "/U": u_value,
            "/UE": ue_value,
            "/O": o_value,
            "/OE": oe_value,
            "/Perms": perms,
        }

    @staticmethod
    def compute_U_value(password: bytes, key: bytes) -> Tuple[bytes, bytes]:
        """
        Algorithm 3.8 Computing the encryption dictionary’s U (user password) and UE (user encryption key) values

        1. Generate 16 random bytes of data using a strong random number generator. The first 8 bytes are the
           User Validation Salt. The second 8 bytes are the User Key Salt. Compute the 32-byte SHA-256 hash of
           the password concatenated with the User Validation Salt. The 48-byte string consisting of the 32-byte
           hash followed by the User Validation Salt followed by the User Key Salt is stored as the U key.
        2. Compute the 32-byte SHA-256 hash of the password concatenated with the User Key Salt. Using this
           hash as the key, encrypt the file encryption key using AES-256 in CBC mode with no padding and an
           initialization vector of zero. The resulting 32-byte string is stored as the UE key.
        """
        random_bytes = bytes(random.randrange(0, 256) for _ in range(16))
        val_salt = random_bytes[:8]
        key_salt = random_bytes[8:]
        u_value = hashlib.sha256(password + val_salt).digest() + val_salt + key_salt

        tmp_key = hashlib.sha256(password + key_salt).digest()
        iv = bytes(0 for _ in range(16))
        ue_value = AES_CBC_encrypt(tmp_key, iv, key)
        return u_value, ue_value

    @staticmethod
    def compute_O_value(
        password: bytes, key: bytes, u_value: bytes
    ) -> Tuple[bytes, bytes]:
        """
        Algorithm 3.9 Computing the encryption dictionary’s O (owner password) and OE (owner encryption key) values.

        1. Generate 16 random bytes of data using a strong random number generator. The first 8 bytes are the
           Owner Validation Salt. The second 8 bytes are the Owner Key Salt. Compute the 32-byte SHA-256 hash
           of the password concatenated with the Owner Validation Salt and then concatenated with the 48-byte
           U string as generated in Algorithm 3.8. The 48-byte string consisting of the 32-byte hash followed by
           the Owner Validation Salt followed by the Owner Key Salt is stored as the O key.
        2. Compute the 32-byte SHA-256 hash of the password concatenated with the Owner Key Salt and then
           concatenated with the 48-byte U string as generated in Algorithm 3.8. Using this hash as the key,
           encrypt the file encryption key using AES-256 in CBC mode with no padding and an initialization vector
           of zero. The resulting 32-byte string is stored as the OE key.
        """
        random_bytes = bytes(random.randrange(0, 256) for _ in range(16))
        val_salt = random_bytes[:8]
        key_salt = random_bytes[8:]
        o_value = (
            hashlib.sha256(password + val_salt + u_value).digest() + val_salt + key_salt
        )

        tmp_key = hashlib.sha256(password + key_salt + u_value).digest()
        iv = bytes(0 for _ in range(16))
        oe_value = AES_CBC_encrypt(tmp_key, iv, key)
        return o_value, oe_value

    @staticmethod
    def compute_Perms_value(key: bytes, p: int, metadata_encrypted: bool) -> bytes:
        """
        Algorithm 3.10 Computing the encryption dictionary’s Perms (permissions) value

        1. Extend the permissions (contents of the P integer) to 64 bits by setting the upper 32 bits to all 1’s. (This
           allows for future extension without changing the format.)
        2. Record the 8 bytes of permission in the bytes 0-7 of the block, low order byte first.
        3. Set byte 8 to the ASCII value ' T ' or ' F ' according to the EncryptMetadata Boolean.
        4. Set bytes 9-11 to the ASCII characters ' a ', ' d ', ' b '.
        5. Set bytes 12-15 to 4 bytes of random data, which will be ignored.
        6. Encrypt the 16-byte block using AES-256 in ECB mode with an initialization vector of zero, using the file
           encryption key as the key. The result (16 bytes) is stored as the Perms string, and checked for validity
           when the file is opened.
        """
        b8 = b"T" if metadata_encrypted else b"F"
        rr = bytes(random.randrange(0, 256) for _ in range(4))
        data = struct.pack("<I", p) + b"\xff\xff\xff\xff" + b8 + b"adb" + rr
        perms = AES_ECB_encrypt(key, data)
        return perms


class PasswordType(IntEnum):
    NOT_DECRYPTED = 0
    USER_PASSWORD = 1
    OWNER_PASSWORD = 2


class Encryption:
    def __init__(
        self,
        algV: int,
        algR: int,
        entry: DictionaryObject,
        first_id_entry: bytes,
        StmF: str,
        StrF: str,
        EFF: str,
    ) -> None:
        # See TABLE 3.18 Entries common to all encryption dictionaries
        self.algV = algV
        self.algR = algR
        self.entry = entry
        self.key_size = entry.get("/Length", 40)
        self.id1_entry = first_id_entry
        self.StmF = StmF
        self.StrF = StrF
        self.EFF = EFF

        # 1 => owner password
        # 2 => user password
        self._password_type = PasswordType.NOT_DECRYPTED
        self._key: Optional[bytes] = None

    def is_decrypted(self) -> bool:
        return self._password_type != PasswordType.NOT_DECRYPTED

    def decrypt_object(self, obj: PdfObject, idnum: int, generation: int) -> PdfObject:
        """
        Algorithm 1: Encryption of data using the RC4 or AES algorithms.

        a) Obtain the object number and generation number from the object identifier of the string or stream to be
           encrypted (see 7.3.10, "Indirect Objects"). If the string is a direct object, use the identifier of the indirect
           object containing it.
        b) For all strings and streams without crypt filter specifier; treating the object number and generation number
           as binary integers, extend the original n-byte encryption key to n + 5 bytes by appending the low-order 3
           bytes of the object number and the low-order 2 bytes of the generation number in that order, low-order byte
           first. (n is 5 unless the value of V in the encryption dictionary is greater than 1, in which case n is the value
           of Length divided by 8.)
           If using the AES algorithm, extend the encryption key an additional 4 bytes by adding the value “sAlT”,
           which corresponds to the hexadecimal values 0x73, 0x41, 0x6C, 0x54. (This addition is done for backward
           compatibility and is not intended to provide additional security.)
        c) Initialize the MD5 hash function and pass the result of step (b) as input to this function.
        d) Use the first (n + 5) bytes, up to a maximum of 16, of the output from the MD5 hash as the key for the RC4
           or AES symmetric key algorithms, along with the string or stream data to be encrypted.
           If using the AES algorithm, the Cipher Block Chaining (CBC) mode, which requires an initialization vector,
           is used. The block size parameter is set to 16 bytes, and the initialization vector is a 16-byte random
           number that is stored as the first 16 bytes of the encrypted stream or string.

        Algorithm 3.1a Encryption of data using the AES algorithm
        1. Use the 32-byte file encryption key for the AES-256 symmetric key algorithm, along with the string or
           stream data to be encrypted.
           Use the AES algorithm in Cipher Block Chaining (CBC) mode, which requires an initialization vector. The
           block size parameter is set to 16 bytes, and the initialization vector is a 16-byte random number that is
           stored as the first 16 bytes of the encrypted stream or string.
           The output is the encrypted data to be stored in the PDF file.
        """
        pack1 = struct.pack("<i", idnum)[:3]
        pack2 = struct.pack("<i", generation)[:2]

        assert self._key
        key = self._key
        n = 5 if self.algV == 1 else self.key_size // 8
        key_data = key[:n] + pack1 + pack2
        key_hash = hashlib.md5(key_data)
        rc4_key = key_hash.digest()[: min(n + 5, 16)]
        # for AES-128
        key_hash.update(b"sAlT")
        aes128_key = key_hash.digest()[: min(n + 5, 16)]

        # for AES-256
        aes256_key = key

        stmCrypt = self._get_crypt(self.StmF, rc4_key, aes128_key, aes256_key)
        StrCrypt = self._get_crypt(self.StrF, rc4_key, aes128_key, aes256_key)
        efCrypt = self._get_crypt(self.EFF, rc4_key, aes128_key, aes256_key)

        cf = CryptFilter(stmCrypt, StrCrypt, efCrypt)
        return cf.decrypt_object(obj)

    @staticmethod
    def _get_crypt(
        method: str, rc4_key: bytes, aes128_key: bytes, aes256_key: bytes
    ) -> CryptBase:
        if method == "/AESV3":
            return CryptAES(aes256_key)
        if method == "/AESV2":
            return CryptAES(aes128_key)
        elif method == "/Identity":
            return CryptIdentity()
        else:
            return CryptRC4(rc4_key)

    def verify(self, password: Union[bytes, str]) -> PasswordType:
        if isinstance(password, str):
            try:
                pwd = password.encode("latin-1")
            except Exception:  # noqa
                pwd = password.encode("utf-8")
        else:
            pwd = password

        key, rc = self.verify_v4(pwd) if self.algV <= 4 else self.verify_v5(pwd)
        if rc != PasswordType.NOT_DECRYPTED:
            self._password_type = rc
            self._key = key
        return rc

    def verify_v4(self, password: bytes) -> Tuple[bytes, PasswordType]:
        R = cast(int, self.entry["/R"])
        P = cast(int, self.entry["/P"])
        P = (P + 0x100000000) % 0x100000000  # maybe < 0
        # make type(metadata_encrypted) == bool
        em = self.entry.get("/EncryptMetadata")
        metadata_encrypted = em.value if em else True
        o_entry = cast(ByteStringObject, self.entry["/O"].get_object()).original_bytes
        u_entry = cast(ByteStringObject, self.entry["/U"].get_object()).original_bytes

        # verify owner password first
        key = AlgV4.verify_owner_password(
            password,
            R,
            self.key_size,
            o_entry,
            u_entry,
            P,
            self.id1_entry,
            metadata_encrypted,
        )
        if key:
            return key, PasswordType.OWNER_PASSWORD
        key = AlgV4.verify_user_password(
            password,
            R,
            self.key_size,
            o_entry,
            u_entry,
            P,
            self.id1_entry,
            metadata_encrypted,
        )
        if key:
            return key, PasswordType.USER_PASSWORD
        return b"", PasswordType.NOT_DECRYPTED

    def verify_v5(self, password: bytes) -> Tuple[bytes, PasswordType]:
        # TODO: use SASLprep process
        o_entry = cast(ByteStringObject, self.entry["/O"].get_object()).original_bytes
        u_entry = cast(ByteStringObject, self.entry["/U"].get_object()).original_bytes
        oe_entry = cast(ByteStringObject, self.entry["/OE"].get_object()).original_bytes
        ue_entry = cast(ByteStringObject, self.entry["/UE"].get_object()).original_bytes

        # verify owner password first
        key = AlgV5.verify_owner_password(
            self.algR, password, o_entry, oe_entry, u_entry
        )
        rc = PasswordType.OWNER_PASSWORD
        if not key:
            key = AlgV5.verify_user_password(self.algR, password, u_entry, ue_entry)
            rc = PasswordType.USER_PASSWORD
        if not key:
            return b"", PasswordType.NOT_DECRYPTED

        # verify Perms
        perms = cast(ByteStringObject, self.entry["/Perms"].get_object()).original_bytes
        P = cast(int, self.entry["/P"])
        P = (P + 0x100000000) % 0x100000000  # maybe < 0
        metadata_encrypted = self.entry.get("/EncryptMetadata", True)
        if not AlgV5.verify_perms(key, perms, P, metadata_encrypted):
            logger_warning("ignore '/Perms' verify failed", __name__)
        return key, rc

    @staticmethod
    def read(encryption_entry: DictionaryObject, first_id_entry: bytes) -> "Encryption":
        filter = encryption_entry.get("/Filter")
        if filter != "/Standard":
            raise NotImplementedError(
                "only Standard PDF encryption handler is available"
            )
        if "/SubFilter" in encryption_entry:
            raise NotImplementedError("/SubFilter NOT supported")

        StmF = "/V2"
        StrF = "/V2"
        EFF = "/V2"

        V = encryption_entry.get("/V", 0)
        if V not in (1, 2, 3, 4, 5):
            raise NotImplementedError(f"Encryption V={V} NOT supported")
        if V >= 4:
            filters = encryption_entry["/CF"]

            StmF = encryption_entry.get("/StmF", "/Identity")
            StrF = encryption_entry.get("/StrF", "/Identity")
            EFF = encryption_entry.get("/EFF", StmF)

            if StmF != "/Identity":
                StmF = filters[StmF]["/CFM"]  # type: ignore
            if StrF != "/Identity":
                StrF = filters[StrF]["/CFM"]  # type: ignore
            if EFF != "/Identity":
                EFF = filters[EFF]["/CFM"]  # type: ignore

            allowed_methods = ("/Identity", "/V2", "/AESV2", "/AESV3")
            if StmF not in allowed_methods:
                raise NotImplementedError("StmF Method {StmF} NOT supported!")
            if StrF not in allowed_methods:
                raise NotImplementedError(f"StrF Method {StrF} NOT supported!")
            if EFF not in allowed_methods:
                raise NotImplementedError(f"EFF Method {EFF} NOT supported!")

        R = cast(int, encryption_entry["/R"])
        return Encryption(V, R, encryption_entry, first_id_entry, StmF, StrF, EFF)
