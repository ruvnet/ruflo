# Copyright (C) Dnspython Contributors, see LICENSE for text of ISC license

# Copyright (C) 2003-2017 Nominum, Inc.
#
# Permission to use, copy, modify, and distribute this software and its
# documentation for any purpose with or without fee is hereby granted,
# provided that the above copyright notice and this permission notice
# appear in all copies.
#
# THE SOFTWARE IS PROVIDED "AS IS" AND NOMINUM DISCLAIMS ALL WARRANTIES
# WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
# MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL NOMINUM BE LIABLE FOR
# ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
# WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
# ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
# OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

"""Common DNSSEC-related functions and constants."""


import base64
import contextlib
import functools
import hashlib
import struct
import time
from datetime import datetime
from typing import Callable, Dict, List, Optional, Set, Tuple, Union, cast

import dns._features
import dns.exception
import dns.name
import dns.node
import dns.rdata
import dns.rdataclass
import dns.rdataset
import dns.rdatatype
import dns.rrset
import dns.transaction
import dns.zone
from dns.dnssectypes import Algorithm, DSDigest, NSEC3Hash
from dns.exception import (  # pylint: disable=W0611
    AlgorithmKeyMismatch,
    DeniedByPolicy,
    UnsupportedAlgorithm,
    ValidationFailure,
)
from dns.rdtypes.ANY.CDNSKEY import CDNSKEY
from dns.rdtypes.ANY.CDS import CDS
from dns.rdtypes.ANY.DNSKEY import DNSKEY
from dns.rdtypes.ANY.DS import DS
from dns.rdtypes.ANY.NSEC import NSEC, Bitmap
from dns.rdtypes.ANY.NSEC3PARAM import NSEC3PARAM
from dns.rdtypes.ANY.RRSIG import RRSIG, sigtime_to_posixtime
from dns.rdtypes.dnskeybase import Flag

PublicKey = Union[
    "GenericPublicKey",
    "rsa.RSAPublicKey",
    "ec.EllipticCurvePublicKey",
    "ed25519.Ed25519PublicKey",
    "ed448.Ed448PublicKey",
]

PrivateKey = Union[
    "GenericPrivateKey",
    "rsa.RSAPrivateKey",
    "ec.EllipticCurvePrivateKey",
    "ed25519.Ed25519PrivateKey",
    "ed448.Ed448PrivateKey",
]

RRsetSigner = Callable[[dns.transaction.Transaction, dns.rrset.RRset], None]


def algorithm_from_text(text: str) -> Algorithm:
    """Convert text into a DNSSEC algorithm value.

    *text*, a ``str``, the text to convert to into an algorithm value.

    Returns an ``int``.
    """

    return Algorithm.from_text(text)


def algorithm_to_text(value: Union[Algorithm, int]) -> str:
    """Convert a DNSSEC algorithm value to text

    *value*, a ``dns.dnssec.Algorithm``.

    Returns a ``str``, the name of a DNSSEC algorithm.
    """

    return Algorithm.to_text(value)


def to_timestamp(value: Union[datetime, str, float, int]) -> int:
    """Convert various format to a timestamp"""
    if isinstance(value, datetime):
        return int(value.timestamp())
    elif isinstance(value, str):
        return sigtime_to_posixtime(value)
    elif isinstance(value, float):
        return int(value)
    elif isinstance(value, int):
        return value
    else:
        raise TypeError("Unsupported timestamp type")


def key_id(key: Union[DNSKEY, CDNSKEY]) -> int:
    """Return the key id (a 16-bit number) for the specified key.

    *key*, a ``dns.rdtypes.ANY.DNSKEY.DNSKEY``

    Returns an ``int`` between 0 and 65535
    """

    rdata = key.to_wire()
    assert rdata is not None  # for mypy
    if key.algorithm == Algorithm.RSAMD5:
        return (rdata[-3] << 8) + rdata[-2]
    else:
        total = 0
        for i in range(len(rdata) // 2):
            total += (rdata[2 * i] << 8) + rdata[2 * i + 1]
        if len(rdata) % 2 != 0:
            total += rdata[len(rdata) - 1] << 8
        total += (total >> 16) & 0xFFFF
        return total & 0xFFFF


class Policy:
    def __init__(self):
        pass

    def ok_to_sign(self, _: DNSKEY) -> bool:  # pragma: no cover
        return False

    def ok_to_validate(self, _: DNSKEY) -> bool:  # pragma: no cover
        return False

    def ok_to_create_ds(self, _: DSDigest) -> bool:  # pragma: no cover
        return False

    def ok_to_validate_ds(self, _: DSDigest) -> bool:  # pragma: no cover
        return False


class SimpleDeny(Policy):
    def __init__(self, deny_sign, deny_validate, deny_create_ds, deny_validate_ds):
        super().__init__()
        self._deny_sign = deny_sign
        self._deny_validate = deny_validate
        self._deny_create_ds = deny_create_ds
        self._deny_validate_ds = deny_validate_ds

    def ok_to_sign(self, key: DNSKEY) -> bool:
        return key.algorithm not in self._deny_sign

    def ok_to_validate(self, key: DNSKEY) -> bool:
        return key.algorithm not in self._deny_validate

    def ok_to_create_ds(self, algorithm: DSDigest) -> bool:
        return algorithm not in self._deny_create_ds

    def ok_to_validate_ds(self, algorithm: DSDigest) -> bool:
        return algorithm not in self._deny_validate_ds


rfc_8624_policy = SimpleDeny(
    {Algorithm.RSAMD5, Algorithm.DSA, Algorithm.DSANSEC3SHA1, Algorithm.ECCGOST},
    {Algorithm.RSAMD5, Algorithm.DSA, Algorithm.DSANSEC3SHA1},
    {DSDigest.NULL, DSDigest.SHA1, DSDigest.GOST},
    {DSDigest.NULL},
)

allow_all_policy = SimpleDeny(set(), set(), set(), set())


default_policy = rfc_8624_policy


def make_ds(
    name: Union[dns.name.Name, str],
    key: dns.rdata.Rdata,
    algorithm: Union[DSDigest, str],
    origin: Optional[dns.name.Name] = None,
    policy: Optional[Policy] = None,
    validating: bool = False,
) -> DS:
    """Create a DS record for a DNSSEC key.

    *name*, a ``dns.name.Name`` or ``str``, the owner name of the DS record.

    *key*, a ``dns.rdtypes.ANY.DNSKEY.DNSKEY`` or ``dns.rdtypes.ANY.DNSKEY.CDNSKEY``,
    the key the DS is about.

    *algorithm*, a ``str`` or ``int`` specifying the hash algorithm.
    The currently supported hashes are "SHA1", "SHA256", and "SHA384". Case
    does not matter for these strings.

    *origin*, a ``dns.name.Name`` or ``None``.  If *key* is a relative name,
    then it will be made absolute using the specified origin.

    *policy*, a ``dns.dnssec.Policy`` or ``None``.  If ``None``, the default policy,
    ``dns.dnssec.default_policy`` is used; this policy defaults to that of RFC 8624.

    *validating*, a ``bool``.  If ``True``, then policy is checked in
    validating mode, i.e. "Is it ok to validate using this digest algorithm?".
    Otherwise the policy is checked in creating mode, i.e. "Is it ok to create a DS with
    this digest algorithm?".

    Raises ``UnsupportedAlgorithm`` if the algorithm is unknown.

    Raises ``DeniedByPolicy`` if the algorithm is denied by policy.

    Returns a ``dns.rdtypes.ANY.DS.DS``
    """

    if policy is None:
        policy = default_policy
    try:
        if isinstance(algorithm, str):
            algorithm = DSDigest[algorithm.upper()]
    except Exception:
        raise UnsupportedAlgorithm(f'unsupported algorithm "{algorithm}"')
    if validating:
        check = policy.ok_to_validate_ds
    else:
        check = policy.ok_to_create_ds
    if not check(algorithm):
        raise DeniedByPolicy
    if not isinstance(key, (DNSKEY, CDNSKEY)):
        raise ValueError("key is not a DNSKEY/CDNSKEY")
    if algorithm == DSDigest.SHA1:
        dshash = hashlib.sha1()
    elif algorithm == DSDigest.SHA256:
        dshash = hashlib.sha256()
    elif algorithm == DSDigest.SHA384:
        dshash = hashlib.sha384()
    else:
        raise UnsupportedAlgorithm(f'unsupported algorithm "{algorithm}"')

    if isinstance(name, str):
        name = dns.name.from_text(name, origin)
    wire = name.canonicalize().to_wire()
    kwire = key.to_wire(origin=origin)
    assert wire is not None and kwire is not None  # for mypy
    dshash.update(wire)
    dshash.update(kwire)
    digest = dshash.digest()

    dsrdata = struct.pack("!HBB", key_id(key), key.algorithm, algorithm) + digest
    ds = dns.rdata.from_wire(
        dns.rdataclass.IN, dns.rdatatype.DS, dsrdata, 0, len(dsrdata)
    )
    return cast(DS, ds)


def make_cds(
    name: Union[dns.name.Name, str],
    key: dns.rdata.Rdata,
    algorithm: Union[DSDigest, str],
    origin: Optional[dns.name.Name] = None,
) -> CDS:
    """Create a CDS record for a DNSSEC key.

    *name*, a ``dns.name.Name`` or ``str``, the owner name of the DS record.

    *key*, a ``dns.rdtypes.ANY.DNSKEY.DNSKEY`` or ``dns.rdtypes.ANY.DNSKEY.CDNSKEY``,
    the key the DS is about.

    *algorithm*, a ``str`` or ``int`` specifying the hash algorithm.
    The currently supported hashes are "SHA1", "SHA256", and "SHA384". Case
    does not matter for these strings.

    *origin*, a ``dns.name.Name`` or ``None``.  If *key* is a relative name,
    then it will be made absolute using the specified origin.

    Raises ``UnsupportedAlgorithm`` if the algorithm is unknown.

    Returns a ``dns.rdtypes.ANY.DS.CDS``
    """

    ds = make_ds(name, key, algorithm, origin)
    return CDS(
        rdclass=ds.rdclass,
        rdtype=dns.rdatatype.CDS,
        key_tag=ds.key_tag,
        algorithm=ds.algorithm,
        digest_type=ds.digest_type,
        digest=ds.digest,
    )


def _find_candidate_keys(
    keys: Dict[dns.name.Name, Union[dns.rdataset.Rdataset, dns.node.Node]], rrsig: RRSIG
) -> Optional[List[DNSKEY]]:
    value = keys.get(rrsig.signer)
    if isinstance(value, dns.node.Node):
        rdataset = value.get_rdataset(dns.rdataclass.IN, dns.rdatatype.DNSKEY)
    else:
        rdataset = value
    if rdataset is None:
        return None
    return [
        cast(DNSKEY, rd)
        for rd in rdataset
        if rd.algorithm == rrsig.algorithm
        and key_id(rd) == rrsig.key_tag
        and (rd.flags & Flag.ZONE) == Flag.ZONE  # RFC 4034 2.1.1
        and rd.protocol == 3  # RFC 4034 2.1.2
    ]


def _get_rrname_rdataset(
    rrset: Union[dns.rrset.RRset, Tuple[dns.name.Name, dns.rdataset.Rdataset]],
) -> Tuple[dns.name.Name, dns.rdataset.Rdataset]:
    if isinstance(rrset, tuple):
        return rrset[0], rrset[1]
    else:
        return rrset.name, rrset


def _validate_signature(sig: bytes, data: bytes, key: DNSKEY) -> None:
    # pylint: disable=possibly-used-before-assignment
    public_cls = get_algorithm_cls_from_dnskey(key).public_cls
    try:
        public_key = public_cls.from_dnskey(key)
    except ValueError:
        raise ValidationFailure("invalid public key")
    public_key.verify(sig, data)


def _validate_rrsig(
    rrset: Union[dns.rrset.RRset, Tuple[dns.name.Name, dns.rdataset.Rdataset]],
    rrsig: RRSIG,
    keys: Dict[dns.name.Name, Union[dns.node.Node, dns.rdataset.Rdataset]],
    origin: Optional[dns.name.Name] = None,
    now: Optional[float] = None,
    policy: Optional[Policy] = None,
) -> None:
    """Validate an RRset against a single signature rdata, throwing an
    exception if validation is not successful.

    *rrset*, the RRset to validate.  This can be a
    ``dns.rrset.RRset`` or a (``dns.name.Name``, ``dns.rdataset.Rdataset``)
    tuple.

    *rrsig*, a ``dns.rdata.Rdata``, the signature to validate.

    *keys*, the key dictionary, used to find the DNSKEY associated
    with a given name.  The dictionary is keyed by a
    ``dns.name.Name``, and has ``dns.node.Node`` or
    ``dns.rdataset.Rdataset`` values.

    *origin*, a ``dns.name.Name`` or ``None``, the origin to use for relative
    names.

    *now*, a ``float`` or ``None``, the time, in seconds since the epoch, to
    use as the current time when validating.  If ``None``, the actual current
    time is used.

    *policy*, a ``dns.dnssec.Policy`` or ``None``.  If ``None``, the default policy,
    ``dns.dnssec.default_policy`` is used; this policy defaults to that of RFC 8624.

    Raises ``ValidationFailure`` if the signature is expired, not yet valid,
    the public key is invalid, the algorithm is unknown, the verification
    fails, etc.

    Raises ``UnsupportedAlgorithm`` if the algorithm is recognized by
    dnspython but not implemented.
    """

    if policy is None:
        policy = default_policy

    candidate_keys = _find_candidate_keys(keys, rrsig)
    if candidate_keys is None:
        raise ValidationFailure("unknown key")

    if now is None:
        now = time.time()
    if rrsig.expiration < now:
        raise ValidationFailure("expired")
    if rrsig.inception > now:
        raise ValidationFailure("not yet valid")

    data = _make_rrsig_signature_data(rrset, rrsig, origin)

    # pylint: disable=possibly-used-before-assignment
    for candidate_key in candidate_keys:
        if not policy.ok_to_validate(candidate_key):
            continue
        try:
            _validate_signature(rrsig.signature, data, candidate_key)
            return
        except (InvalidSignature, ValidationFailure):
            # this happens on an individual validation failure
            continue
    # nothing verified -- raise failure:
    raise ValidationFailure("verify failure")


def _validate(
    rrset: Union[dns.rrset.RRset, Tuple[dns.name.Name, dns.rdataset.Rdataset]],
    rrsigset: Union[dns.rrset.RRset, Tuple[dns.name.Name, dns.rdataset.Rdataset]],
    keys: Dict[dns.name.Name, Union[dns.node.Node, dns.rdataset.Rdataset]],
    origin: Optional[dns.name.Name] = None,
    now: Optional[float] = None,
    policy: Optional[Policy] = None,
) -> None:
    """Validate an RRset against a signature RRset, throwing an exception
    if none of the signatures validate.

    *rrset*, the RRset to validate.  This can be a
    ``dns.rrset.RRset`` or a (``dns.name.Name``, ``dns.rdataset.Rdataset``)
    tuple.

    *rrsigset*, the signature RRset.  This can be a
    ``dns.rrset.RRset`` or a (``dns.name.Name``, ``dns.rdataset.Rdataset``)
    tuple.

    *keys*, the key dictionary, used to find the DNSKEY associated
    with a given name.  The dictionary is keyed by a
    ``dns.name.Name``, and has ``dns.node.Node`` or
    ``dns.rdataset.Rdataset`` values.

    *origin*, a ``dns.name.Name``, the origin to use for relative names;
    defaults to None.

    *now*, an ``int`` or ``None``, the time, in seconds since the epoch, to
    use as the current time when validating.  If ``None``, the actual current
    time is used.

    *policy*, a ``dns.dnssec.Policy`` or ``None``.  If ``None``, the default policy,
    ``dns.dnssec.default_policy`` is used; this policy defaults to that of RFC 8624.

    Raises ``ValidationFailure`` if the signature is expired, not yet valid,
    the public key is invalid, the algorithm is unknown, the verification
    fails, etc.
    """

    if policy is None:
        policy = default_policy

    if isinstance(origin, str):
        origin = dns.name.from_text(origin, dns.name.root)

    if isinstance(rrset, tuple):
        rrname = rrset[0]
    else:
        rrname = rrset.name

    if isinstance(rrsigset, tuple):
        rrsigname = rrsigset[0]
        rrsigrdataset = rrsigset[1]
    else:
        rrsigname = rrsigset.name
        rrsigrdataset = rrsigset

    rrname = rrname.choose_relativity(origin)
    rrsigname = rrsigname.choose_relativity(origin)
    if rrname != rrsigname:
        raise ValidationFailure("owner names do not match")

    for rrsig in rrsigrdataset:
        if not isinstance(rrsig, RRSIG):
            raise ValidationFailure("expected an RRSIG")
        try:
            _validate_rrsig(rrset, rrsig, keys, origin, now, policy)
            return
        except (ValidationFailure, UnsupportedAlgorithm):
            pass
    raise ValidationFailure("no RRSIGs validated")


def _sign(
    rrset: Union[dns.rrset.RRset, Tuple[dns.name.Name, dns.rdataset.Rdataset]],
    private_key: PrivateKey,
    signer: dns.name.Name,
    dnskey: DNSKEY,
    inception: Optional[Union[datetime, str, int, float]] = None,
    expiration: Optional[Union[datetime, str, int, float]] = None,
    lifetime: Optional[int] = None,
    verify: bool = False,
    policy: Optional[Policy] = None,
    origin: Optional[dns.name.Name] = None,
    deterministic: bool = True,
) -> RRSIG:
    """Sign RRset using private key.

    *rrset*, the RRset to validate.  This can be a
    ``dns.rrset.RRset`` or a (``dns.name.Name``, ``dns.rdataset.Rdataset``)
    tuple.

    *private_key*, the private key to use for signing, a
    ``cryptography.hazmat.primitives.asymmetric`` private key class applicable
    for DNSSEC.

    *signer*, a ``dns.name.Name``, the Signer's name.

    *dnskey*, a ``DNSKEY`` matching ``private_key``.

    *inception*, a ``datetime``, ``str``, ``int``, ``float`` or ``None``, the
    signature inception time.  If ``None``, the current time is used.  If a ``str``, the
    format is "YYYYMMDDHHMMSS" or alternatively the number of seconds since the UNIX
    epoch in text form; this is the same the RRSIG rdata's text form.
    Values of type `int` or `float` are interpreted as seconds since the UNIX epoch.

    *expiration*, a ``datetime``, ``str``, ``int``, ``float`` or ``None``, the signature
    expiration time.  If ``None``, the expiration time will be the inception time plus
    the value of the *lifetime* parameter.  See the description of *inception* above
    for how the various parameter types are interpreted.

    *lifetime*, an ``int`` or ``None``, the signature lifetime in seconds.  This
    parameter is only meaningful if *expiration* is ``None``.

    *verify*, a ``bool``.  If set to ``True``, the signer will verify signatures
    after they are created; the default is ``False``.

    *policy*, a ``dns.dnssec.Policy`` or ``None``.  If ``None``, the default policy,
    ``dns.dnssec.default_policy`` is used; this policy defaults to that of RFC 8624.

    *origin*, a ``dns.name.Name`` or ``None``.  If ``None``, the default, then all
    names in the rrset (including its owner name) must be absolute; otherwise the
    specified origin will be used to make names absolute when signing.

    *deterministic*, a ``bool``. If ``True``, the default, use deterministic
    (reproducible) signatures when supported by the algorithm used for signing.
    Currently, this only affects ECDSA.

    Raises ``DeniedByPolicy`` if the signature is denied by policy.
    """

    if policy is None:
        policy = default_policy
    if not policy.ok_to_sign(dnskey):
        raise DeniedByPolicy

    if isinstance(rrset, tuple):
        rdclass = rrset[1].rdclass
        rdtype = rrset[1].rdtype
        rrname = rrset[0]
        original_ttl = rrset[1].ttl
    else:
        rdclass = rrset.rdclass
        rdtype = rrset.rdtype
        rrname = rrset.name
        original_ttl = rrset.ttl

    if inception is not None:
        rrsig_inception = to_timestamp(inception)
    else:
        rrsig_inception = int(time.time())

    if expiration is not None:
        rrsig_expiration = to_timestamp(expiration)
    elif lifetime is not None:
        rrsig_expiration = rrsig_inception + lifetime
    else:
        raise ValueError("expiration or lifetime must be specified")

    # Derelativize now because we need a correct labels length for the
    # rrsig_template.
    if origin is not None:
        rrname = rrname.derelativize(origin)
    labels = len(rrname) - 1

    # Adjust labels appropriately for wildcards.
    if rrname.is_wild():
        labels -= 1

    rrsig_template = RRSIG(
        rdclass=rdclass,
        rdtype=dns.rdatatype.RRSIG,
        type_covered=rdtype,
        algorithm=dnskey.algorithm,
        labels=labels,
        original_ttl=original_ttl,
        expiration=rrsig_expiration,
        inception=rrsig_inception,
        key_tag=key_id(dnskey),
        signer=signer,
        signature=b"",
    )

    data = dns.dnssec._make_rrsig_signature_data(rrset, rrsig_template, origin)

    # pylint: disable=possibly-used-before-assignment
    if isinstance(private_key, GenericPrivateKey):
        signing_key = private_key
    else:
        try:
            private_cls = get_algorithm_cls_from_dnskey(dnskey)
            signing_key = private_cls(key=private_key)
        except UnsupportedAlgorithm:
            raise TypeError("Unsupported key algorithm")

    signature = signing_key.sign(data, verify, deterministic)

    return cast(RRSIG, rrsig_template.replace(signature=signature))


def _make_rrsig_signature_data(
    rrset: Union[dns.rrset.RRset, Tuple[dns.name.Name, dns.rdataset.Rdataset]],
    rrsig: RRSIG,
    origin: Optional[dns.name.Name] = None,
) -> bytes:
    """Create signature rdata.

    *rrset*, the RRset to sign/validate.  This can be a
    ``dns.rrset.RRset`` or a (``dns.name.Name``, ``dns.rdataset.Rdataset``)
    tuple.

    *rrsig*, a ``dns.rdata.Rdata``, the signature to validate, or the
    signature template used when signing.

    *origin*, a ``dns.name.Name`` or ``None``, the origin to use for relative
    names.

    Raises ``UnsupportedAlgorithm`` if the algorithm is recognized by
    dnspython but not implemented.
    """

    if isinstance(origin, str):
        origin = dns.name.from_text(origin, dns.name.root)

    signer = rrsig.signer
    if not signer.is_absolute():
        if origin is None:
            raise ValidationFailure("relative RR name without an origin specified")
        signer = signer.derelativize(origin)

    # For convenience, allow the rrset to be specified as a (name,
    # rdataset) tuple as well as a proper rrset
    rrname, rdataset = _get_rrname_rdataset(rrset)

    data = b""
    wire = rrsig.to_wire(origin=signer)
    assert wire is not None  # for mypy
    data += wire[:18]
    data += rrsig.signer.to_digestable(signer)

    # Derelativize the name before considering labels.
    if not rrname.is_absolute():
        if origin is None:
            raise ValidationFailure("relative RR name without an origin specified")
        rrname = rrname.derelativize(origin)

    name_len = len(rrname)
    if rrname.is_wild() and rrsig.labels != name_len - 2:
        raise ValidationFailure("wild owner name has wrong label length")
    if name_len - 1 < rrsig.labels:
        raise ValidationFailure("owner name longer than RRSIG labels")
    elif rrsig.labels < name_len - 1:
        suffix = rrname.split(rrsig.labels + 1)[1]
        rrname = dns.name.from_text("*", suffix)
    rrnamebuf = rrname.to_digestable()
    rrfixed = struct.pack("!HHI", rdataset.rdtype, rdataset.rdclass, rrsig.original_ttl)
    rdatas = [rdata.to_digestable(origin) for rdata in rdataset]
    for rdata in sorted(rdatas):
        data += rrnamebuf
        data += rrfixed
        rrlen = struct.pack("!H", len(rdata))
        data += rrlen
        data += rdata

    return data


def _make_dnskey(
    public_key: PublicKey,
    algorithm: Union[int, str],
    flags: int = Flag.ZONE,
    protocol: int = 3,
) -> DNSKEY:
    """Convert a public key to DNSKEY Rdata

    *public_key*, a ``PublicKey`` (``GenericPublicKey`` or
    ``cryptography.hazmat.primitives.asymmetric``) to convert.

    *algorithm*, a ``str`` or ``int`` specifying the DNSKEY algorithm.

    *flags*: DNSKEY flags field as an integer.

    *protocol*: DNSKEY protocol field as an integer.

    Raises ``ValueError`` if the specified key algorithm parameters are not
    unsupported, ``TypeError`` if the key type is unsupported,
    `UnsupportedAlgorithm` if the algorithm is unknown and
    `AlgorithmKeyMismatch` if the algorithm does not match the key type.

    Return DNSKEY ``Rdata``.
    """

    algorithm = Algorithm.make(algorithm)

    # pylint: disable=possibly-used-before-assignment
    if isinstance(public_key, GenericPublicKey):
        return public_key.to_dnskey(flags=flags, protocol=protocol)
    else:
        public_cls = get_algorithm_cls(algorithm).public_cls
        return public_cls(key=public_key).to_dnskey(flags=flags, protocol=protocol)


def _make_cdnskey(
    public_key: PublicKey,
    algorithm: Union[int, str],
    flags: int = Flag.ZONE,
    protocol: int = 3,
) -> CDNSKEY:
    """Convert a public key to CDNSKEY Rdata

    *public_key*, the public key to convert, a
    ``cryptography.hazmat.primitives.asymmetric`` public key class applicable
    for DNSSEC.

    *algorithm*, a ``str`` or ``int`` specifying the DNSKEY algorithm.

    *flags*: DNSKEY flags field as an integer.

    *protocol*: DNSKEY protocol field as an integer.

    Raises ``ValueError`` if the specified key algorithm parameters are not
    unsupported, ``TypeError`` if the key type is unsupported,
    `UnsupportedAlgorithm` if the algorithm is unknown and
    `AlgorithmKeyMismatch` if the algorithm does not match the key type.

    Return CDNSKEY ``Rdata``.
    """

    dnskey = _make_dnskey(public_key, algorithm, flags, protocol)

    return CDNSKEY(
        rdclass=dnskey.rdclass,
        rdtype=dns.rdatatype.CDNSKEY,
        flags=dnskey.flags,
        protocol=dnskey.protocol,
        algorithm=dnskey.algorithm,
        key=dnskey.key,
    )


def nsec3_hash(
    domain: Union[dns.name.Name, str],
    salt: Optional[Union[str, bytes]],
    iterations: int,
    algorithm: Union[int, str],
) -> str:
    """
    Calculate the NSEC3 hash, according to
    https://tools.ietf.org/html/rfc5155#section-5

    *domain*, a ``dns.name.Name`` or ``str``, the name to hash.

    *salt*, a ``str``, ``bytes``, or ``None``, the hash salt.  If a
    string, it is decoded as a hex string.

    *iterations*, an ``int``, the number of iterations.

    *algorithm*, a ``str`` or ``int``, the hash algorithm.
    The only defined algorithm is SHA1.

    Returns a ``str``, the encoded NSEC3 hash.
    """

    b32_conversion = str.maketrans(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", "0123456789ABCDEFGHIJKLMNOPQRSTUV"
    )

    try:
        if isinstance(algorithm, str):
            algorithm = NSEC3Hash[algorithm.upper()]
    except Exception:
        raise ValueError("Wrong hash algorithm (only SHA1 is supported)")

    if algorithm != NSEC3Hash.SHA1:
        raise ValueError("Wrong hash algorithm (only SHA1 is supported)")

    if salt is None:
        salt_encoded = b""
    elif isinstance(salt, str):
        if len(salt) % 2 == 0:
            salt_encoded = bytes.fromhex(salt)
        else:
            raise ValueError("Invalid salt length")
    else:
        salt_encoded = salt

    if not isinstance(domain, dns.name.Name):
        domain = dns.name.from_text(domain)
    domain_encoded = domain.canonicalize().to_wire()
    assert domain_encoded is not None

    digest = hashlib.sha1(domain_encoded + salt_encoded).digest()
    for _ in range(iterations):
        digest = hashlib.sha1(digest + salt_encoded).digest()

    output = base64.b32encode(digest).decode("utf-8")
    output = output.translate(b32_conversion)

    return output


def make_ds_rdataset(
    rrset: Union[dns.rrset.RRset, Tuple[dns.name.Name, dns.rdataset.Rdataset]],
    algorithms: Set[Union[DSDigest, str]],
    origin: Optional[dns.name.Name] = None,
) -> dns.rdataset.Rdataset:
    """Create a DS record from DNSKEY/CDNSKEY/CDS.

    *rrset*, the RRset to create DS Rdataset for.  This can be a
    ``dns.rrset.RRset`` or a (``dns.name.Name``, ``dns.rdataset.Rdataset``)
    tuple.

    *algorithms*, a set of ``str`` or ``int`` specifying the hash algorithms.
    The currently supported hashes are "SHA1", "SHA256", and "SHA384". Case
    does not matter for these strings. If the RRset is a CDS, only digest
    algorithms matching algorithms are accepted.

    *origin*, a ``dns.name.Name`` or ``None``.  If `key` is a relative name,
    then it will be made absolute using the specified origin.

    Raises ``UnsupportedAlgorithm`` if any of the algorithms are unknown and
    ``ValueError`` if the given RRset is not usable.

    Returns a ``dns.rdataset.Rdataset``
    """

    rrname, rdataset = _get_rrname_rdataset(rrset)

    if rdataset.rdtype not in (
        dns.rdatatype.DNSKEY,
        dns.rdatatype.CDNSKEY,
        dns.rdatatype.CDS,
    ):
        raise ValueError("rrset not a DNSKEY/CDNSKEY/CDS")

    _algorithms = set()
    for algorithm in algorithms:
        try:
            if isinstance(algorithm, str):
                algorithm = DSDigest[algorithm.upper()]
        except Exception:
            raise UnsupportedAlgorithm(f'unsupported algorithm "{algorithm}"')
        _algorithms.add(algorithm)

    if rdataset.rdtype == dns.rdatatype.CDS:
        res = []
        for rdata in cds_rdataset_to_ds_rdataset(rdataset):
            if rdata.digest_type in _algorithms:
                res.append(rdata)
        if len(res) == 0:
            raise ValueError("no acceptable CDS rdata found")
        return dns.rdataset.from_rdata_list(rdataset.ttl, res)

    res = []
    for algorithm in _algorithms:
        res.extend(dnskey_rdataset_to_cds_rdataset(rrname, rdataset, algorithm, origin))
    return dns.rdataset.from_rdata_list(rdataset.ttl, res)


def cds_rdataset_to_ds_rdataset(
    rdataset: dns.rdataset.Rdataset,
) -> dns.rdataset.Rdataset:
    """Create a CDS record from DS.

    *rdataset*, a ``dns.rdataset.Rdataset``, to create DS Rdataset for.

    Raises ``ValueError`` if the rdataset is not CDS.

    Returns a ``dns.rdataset.Rdataset``
    """

    if rdataset.rdtype != dns.rdatatype.CDS:
        raise ValueError("rdataset not a CDS")
    res = []
    for rdata in rdataset:
        res.append(
            CDS(
                rdclass=rdata.rdclass,
                rdtype=dns.rdatatype.DS,
                key_tag=rdata.key_tag,
                algorithm=rdata.algorithm,
                digest_type=rdata.digest_type,
                digest=rdata.digest,
            )
        )
    return dns.rdataset.from_rdata_list(rdataset.ttl, res)


def dnskey_rdataset_to_cds_rdataset(
    name: Union[dns.name.Name, str],
    rdataset: dns.rdataset.Rdataset,
    algorithm: Union[DSDigest, str],
    origin: Optional[dns.name.Name] = None,
) -> dns.rdataset.Rdataset:
    """Create a CDS record from DNSKEY/CDNSKEY.

    *name*, a ``dns.name.Name`` or ``str``, the owner name of the CDS record.

    *rdataset*, a ``dns.rdataset.Rdataset``, to create DS Rdataset for.

    *algorithm*, a ``str`` or ``int`` specifying the hash algorithm.
    The currently supported hashes are "SHA1", "SHA256", and "SHA384". Case
    does not matter for these strings.

    *origin*, a ``dns.name.Name`` or ``None``.  If `key` is a relative name,
    then it will be made absolute using the specified origin.

    Raises ``UnsupportedAlgorithm`` if the algorithm is unknown or
    ``ValueError`` if the rdataset is not DNSKEY/CDNSKEY.

    Returns a ``dns.rdataset.Rdataset``
    """

    if rdataset.rdtype not in (dns.rdatatype.DNSKEY, dns.rdatatype.CDNSKEY):
        raise ValueError("rdataset not a DNSKEY/CDNSKEY")
    res = []
    for rdata in rdataset:
        res.append(make_cds(name, rdata, algorithm, origin))
    return dns.rdataset.from_rdata_list(rdataset.ttl, res)


def dnskey_rdataset_to_cdnskey_rdataset(
    rdataset: dns.rdataset.Rdataset,
) -> dns.rdataset.Rdataset:
    """Create a CDNSKEY record from DNSKEY.

    *rdataset*, a ``dns.rdataset.Rdataset``, to create CDNSKEY Rdataset for.

    Returns a ``dns.rdataset.Rdataset``
    """

    if rdataset.rdtype != dns.rdatatype.DNSKEY:
        raise ValueError("rdataset not a DNSKEY")
    res = []
    for rdata in rdataset:
        res.append(
            CDNSKEY(
                rdclass=rdataset.rdclass,
                rdtype=rdataset.rdtype,
                flags=rdata.flags,
                protocol=rdata.protocol,
                algorithm=rdata.algorithm,
                key=rdata.key,
            )
        )
    return dns.rdataset.from_rdata_list(rdataset.ttl, res)


def default_rrset_signer(
    txn: dns.transaction.Transaction,
    rrset: dns.rrset.RRset,
    signer: dns.name.Name,
    ksks: List[Tuple[PrivateKey, DNSKEY]],
    zsks: List[Tuple[PrivateKey, DNSKEY]],
    inception: Optional[Union[datetime, str, int, float]] = None,
    expiration: Optional[Union[datetime, str, int, float]] = None,
    lifetime: Optional[int] = None,
    policy: Optional[Policy] = None,
    origin: Optional[dns.name.Name] = None,
    deterministic: bool = True,
) -> None:
    """Default RRset signer"""

    if rrset.rdtype in set(
        [
            dns.rdatatype.RdataType.DNSKEY,
            dns.rdatatype.RdataType.CDS,
            dns.rdatatype.RdataType.CDNSKEY,
        ]
    ):
        keys = ksks
    else:
        keys = zsks

    for private_key, dnskey in keys:
        rrsig = dns.dnssec.sign(
            rrset=rrset,
            private_key=private_key,
            dnskey=dnskey,
            inception=inception,
            expiration=expiration,
            lifetime=lifetime,
            signer=signer,
            policy=policy,
            origin=origin,
            deterministic=deterministic,
        )
        txn.add(rrset.name, rrset.ttl, rrsig)


def sign_zone(
    zone: dns.zone.Zone,
    txn: Optional[dns.transaction.Transaction] = None,
    keys: Optional[List[Tuple[PrivateKey, DNSKEY]]] = None,
    add_dnskey: bool = True,
    dnskey_ttl: Optional[int] = None,
    inception: Optional[Union[datetime, str, int, float]] = None,
    expiration: Optional[Union[datetime, str, int, float]] = None,
    lifetime: Optional[int] = None,
    nsec3: Optional[NSEC3PARAM] = None,
    rrset_signer: Optional[RRsetSigner] = None,
    policy: Optional[Policy] = None,
    deterministic: bool = True,
) -> None:
    """Sign zone.

    *zone*, a ``dns.zone.Zone``, the zone to sign.

    *txn*, a ``dns.transaction.Transaction``, an optional transaction to use for
    signing.

    *keys*, a list of (``PrivateKey``, ``DNSKEY``) tuples, to use for signing. KSK/ZSK
    roles are assigned automatically if the SEP flag is used, otherwise all RRsets are
    signed by all keys.

    *add_dnskey*, a ``bool``.  If ``True``, the default, all specified DNSKEYs are
    automatically added to the zone on signing.

    *dnskey_ttl*, a``int``, specifies the TTL for DNSKEY RRs. If not specified the TTL
    of the existing DNSKEY RRset used or the TTL of the SOA RRset.

    *inception*, a ``datetime``, ``str``, ``int``, ``float`` or ``None``, the signature
    inception time.  If ``None``, the current time is used.  If a ``str``, the format is
    "YYYYMMDDHHMMSS" or alternatively the number of seconds since the UNIX epoch in text
    form; this is the same the RRSIG rdata's text form. Values of type `int` or `float`
    are interpreted as seconds since the UNIX epoch.

    *expiration*, a ``datetime``, ``str``, ``int``, ``float`` or ``None``, the signature
    expiration time.  If ``None``, the expiration time will be the inception time plus
    the value of the *lifetime* parameter.  See the description of *inception* above for
    how the various parameter types are interpreted.

    *lifetime*, an ``int`` or ``None``, the signature lifetime in seconds.  This
    parameter is only meaningful if *expiration* is ``None``.

    *nsec3*, a ``NSEC3PARAM`` Rdata, configures signing using NSEC3. Not yet
    implemented.

    *rrset_signer*, a ``Callable``, an optional function for signing RRsets. The
    function requires two arguments: transaction and RRset. If the not specified,
    ``dns.dnssec.default_rrset_signer`` will be used.

    *deterministic*, a ``bool``. If ``True``, the default, use deterministic
    (reproducible) signatures when supported by the algorithm used for signing.
    Currently, this only affects ECDSA.

    Returns ``None``.
    """

    ksks = []
    zsks = []

    # if we have both KSKs and ZSKs, split by SEP flag. if not, sign all
    # records with all keys
    if keys:
        for key in keys:
            if key[1].flags & Flag.SEP:
                ksks.append(key)
            else:
                zsks.append(key)
        if not ksks:
            ksks = keys
        if not zsks:
            zsks = keys
    else:
        keys = []

    if txn:
        cm: contextlib.AbstractContextManager = contextlib.nullcontext(txn)
    else:
        cm = zone.writer()

    if zone.origin is None:
        raise ValueError("no zone origin")

    with cm as _txn:
        if add_dnskey:
            if dnskey_ttl is None:
                dnskey = _txn.get(zone.origin, dns.rdatatype.DNSKEY)
                if dnskey:
                    dnskey_ttl = dnskey.ttl
                else:
                    soa = _txn.get(zone.origin, dns.rdatatype.SOA)
                    dnskey_ttl = soa.ttl
            for _, dnskey in keys:
                _txn.add(zone.origin, dnskey_ttl, dnskey)

        if nsec3:
            raise NotImplementedError("Signing with NSEC3 not yet implemented")
        else:
            _rrset_signer = rrset_signer or functools.partial(
                default_rrset_signer,
                signer=zone.origin,
                ksks=ksks,
                zsks=zsks,
                inception=inception,
                expiration=expiration,
                lifetime=lifetime,
                policy=policy,
                origin=zone.origin,
                deterministic=deterministic,
            )
            return _sign_zone_nsec(zone, _txn, _rrset_signer)


def _sign_zone_nsec(
    zone: dns.zone.Zone,
    txn: dns.transaction.Transaction,
    rrset_signer: Optional[RRsetSigner] = None,
) -> None:
    """NSEC zone signer"""

    def _txn_add_nsec(
        txn: dns.transaction.Transaction,
        name: dns.name.Name,
        next_secure: Optional[dns.name.Name],
        rdclass: dns.rdataclass.RdataClass,
        ttl: int,
        rrset_signer: Optional[RRsetSigner] = None,
    ) -> None:
        """NSEC zone signer helper"""
        mandatory_types = set(
            [dns.rdatatype.RdataType.RRSIG, dns.rdatatype.RdataType.NSEC]
        )
        node = txn.get_node(name)
        if node and next_secure:
            types = (
                set([rdataset.rdtype for rdataset in node.rdatasets]) | mandatory_types
            )
            windows = Bitmap.from_rdtypes(list(types))
            rrset = dns.rrset.from_rdata(
                name,
                ttl,
                NSEC(
                    rdclass=rdclass,
                    rdtype=dns.rdatatype.RdataType.NSEC,
                    next=next_secure,
                    windows=windows,
                ),
            )
            txn.add(rrset)
            if rrset_signer:
                rrset_signer(txn, rrset)

    rrsig_ttl = zone.get_soa().minimum
    delegation = None
    last_secure = None

    for name in sorted(txn.iterate_names()):
        if delegation and name.is_subdomain(delegation):
            # names below delegations are not secure
            continue
        elif txn.get(name, dns.rdatatype.NS) and name != zone.origin:
            # inside delegation
            delegation = name
        else:
            # outside delegation
            delegation = None

        if rrset_signer:
            node = txn.get_node(name)
            if node:
                for rdataset in node.rdatasets:
                    if rdataset.rdtype == dns.rdatatype.RRSIG:
                        # do not sign RRSIGs
                        continue
                    elif delegation and rdataset.rdtype != dns.rdatatype.DS:
                        # do not sign delegations except DS records
                        continue
                    else:
                        rrset = dns.rrset.from_rdata(name, rdataset.ttl, *rdataset)
                        rrset_signer(txn, rrset)

        # We need "is not None" as the empty name is False because its length is 0.
        if last_secure is not None:
            _txn_add_nsec(txn, last_secure, name, zone.rdclass, rrsig_ttl, rrset_signer)
        last_secure = name

    if last_secure:
        _txn_add_nsec(
            txn, last_secure, zone.origin, zone.rdclass, rrsig_ttl, rrset_signer
        )


def _need_pyca(*args, **kwargs):
    raise ImportError(
        "DNSSEC validation requires python cryptography"
    )  # pragma: no cover


if dns._features.have("dnssec"):
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric import dsa  # pylint: disable=W0611
    from cryptography.hazmat.primitives.asymmetric import ec  # pylint: disable=W0611
    from cryptography.hazmat.primitives.asymmetric import ed448  # pylint: disable=W0611
    from cryptography.hazmat.primitives.asymmetric import rsa  # pylint: disable=W0611
    from cryptography.hazmat.primitives.asymmetric import (  # pylint: disable=W0611
        ed25519,
    )

    from dns.dnssecalgs import (  # pylint: disable=C0412
        get_algorithm_cls,
        get_algorithm_cls_from_dnskey,
    )
    from dns.dnssecalgs.base import GenericPrivateKey, GenericPublicKey

    validate = _validate  # type: ignore
    validate_rrsig = _validate_rrsig  # type: ignore
    sign = _sign
    make_dnskey = _make_dnskey
    make_cdnskey = _make_cdnskey
    _have_pyca = True
else:  # pragma: no cover
    validate = _need_pyca
    validate_rrsig = _need_pyca
    sign = _need_pyca
    make_dnskey = _need_pyca
    make_cdnskey = _need_pyca
    _have_pyca = False

### BEGIN generated Algorithm constants

RSAMD5 = Algorithm.RSAMD5
DH = Algorithm.DH
DSA = Algorithm.DSA
ECC = Algorithm.ECC
RSASHA1 = Algorithm.RSASHA1
DSANSEC3SHA1 = Algorithm.DSANSEC3SHA1
RSASHA1NSEC3SHA1 = Algorithm.RSASHA1NSEC3SHA1
RSASHA256 = Algorithm.RSASHA256
RSASHA512 = Algorithm.RSASHA512
ECCGOST = Algorithm.ECCGOST
ECDSAP256SHA256 = Algorithm.ECDSAP256SHA256
ECDSAP384SHA384 = Algorithm.ECDSAP384SHA384
ED25519 = Algorithm.ED25519
ED448 = Algorithm.ED448
INDIRECT = Algorithm.INDIRECT
PRIVATEDNS = Algorithm.PRIVATEDNS
PRIVATEOID = Algorithm.PRIVATEOID

### END generated Algorithm constants
