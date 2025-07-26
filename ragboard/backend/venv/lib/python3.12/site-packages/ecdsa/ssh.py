import binascii
from . import der
from ._compat import compat26_str, int_to_bytes

_SSH_ED25519 = b"ssh-ed25519"
_SK_MAGIC = b"openssh-key-v1\0"
_NONE = b"none"


def _get_key_type(name):
    if name == "Ed25519":
        return _SSH_ED25519
    else:
        raise ValueError("Unsupported key type")


class _Serializer:
    def __init__(self):
        self.bytes = b""

    def put_raw(self, val):
        self.bytes += val

    def put_u32(self, val):
        self.bytes += int_to_bytes(val, length=4, byteorder="big")

    def put_str(self, val):
        self.put_u32(len(val))
        self.bytes += val

    def put_pad(self, blklen=8):
        padlen = blklen - (len(self.bytes) % blklen)
        self.put_raw(bytearray(range(1, 1 + padlen)))

    def encode(self):
        return binascii.b2a_base64(compat26_str(self.bytes))

    def tobytes(self):
        return self.bytes

    def topem(self):
        return der.topem(self.bytes, "OPENSSH PRIVATE KEY")


def serialize_public(name, pub):
    serial = _Serializer()
    ktype = _get_key_type(name)
    serial.put_str(ktype)
    serial.put_str(pub)
    return b" ".join([ktype, serial.encode()])


def serialize_private(name, pub, priv):
    # encode public part
    spub = _Serializer()
    ktype = _get_key_type(name)
    spub.put_str(ktype)
    spub.put_str(pub)

    # encode private part
    spriv = _Serializer()
    checksum = 0
    spriv.put_u32(checksum)
    spriv.put_u32(checksum)
    spriv.put_raw(spub.tobytes())
    spriv.put_str(priv + pub)
    comment = b""
    spriv.put_str(comment)
    spriv.put_pad()

    # top-level structure
    main = _Serializer()
    main.put_raw(_SK_MAGIC)
    ciphername = kdfname = _NONE
    main.put_str(ciphername)
    main.put_str(kdfname)
    nokdf = 0
    main.put_u32(nokdf)
    nkeys = 1
    main.put_u32(nkeys)
    main.put_str(spub.tobytes())
    main.put_str(spriv.tobytes())
    return main.topem()
