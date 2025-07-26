# while we don't use six in this file, we did bundle it for a long time, so
# keep as part of module in a virtual way (through __all__)
import six
from .keys import (
    SigningKey,
    VerifyingKey,
    BadSignatureError,
    BadDigestError,
    MalformedPointError,
)
from .curves import (
    NIST192p,
    NIST224p,
    NIST256p,
    NIST384p,
    NIST521p,
    SECP256k1,
    BRAINPOOLP160r1,
    BRAINPOOLP192r1,
    BRAINPOOLP224r1,
    BRAINPOOLP256r1,
    BRAINPOOLP320r1,
    BRAINPOOLP384r1,
    BRAINPOOLP512r1,
    SECP112r1,
    SECP112r2,
    SECP128r1,
    SECP160r1,
    Ed25519,
    Ed448,
    BRAINPOOLP160t1,
    BRAINPOOLP192t1,
    BRAINPOOLP224t1,
    BRAINPOOLP256t1,
    BRAINPOOLP320t1,
    BRAINPOOLP384t1,
    BRAINPOOLP512t1,
)
from .ecdh import (
    ECDH,
    NoKeyError,
    NoCurveError,
    InvalidCurveError,
    InvalidSharedSecretError,
)
from .der import UnexpectedDER
from . import _version

# This code comes from http://github.com/tlsfuzzer/python-ecdsa
__all__ = [
    "curves",
    "der",
    "ecdsa",
    "ellipticcurve",
    "keys",
    "numbertheory",
    "test_pyecdsa",
    "util",
    "six",
]

_hush_pyflakes = [
    SigningKey,
    VerifyingKey,
    BadSignatureError,
    BadDigestError,
    MalformedPointError,
    UnexpectedDER,
    InvalidCurveError,
    NoKeyError,
    InvalidSharedSecretError,
    ECDH,
    NoCurveError,
    NIST192p,
    NIST224p,
    NIST256p,
    NIST384p,
    NIST521p,
    SECP256k1,
    BRAINPOOLP160r1,
    BRAINPOOLP192r1,
    BRAINPOOLP224r1,
    BRAINPOOLP256r1,
    BRAINPOOLP320r1,
    BRAINPOOLP384r1,
    BRAINPOOLP512r1,
    SECP112r1,
    SECP112r2,
    SECP128r1,
    SECP160r1,
    Ed25519,
    Ed448,
    six.b(""),
    BRAINPOOLP160t1,
    BRAINPOOLP192t1,
    BRAINPOOLP224t1,
    BRAINPOOLP256t1,
    BRAINPOOLP320t1,
    BRAINPOOLP384t1,
    BRAINPOOLP512t1,
]
del _hush_pyflakes

__version__ = _version.get_versions()["version"]
