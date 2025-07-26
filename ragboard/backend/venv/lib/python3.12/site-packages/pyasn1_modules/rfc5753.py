#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Elliptic Curve Cryptography (ECC) Algorithms in the CMS
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc5753.txt
#

from pyasn1.type import univ, char, namedtype, namedval, tag, constraint, useful

from pyasn1_modules import rfc5280
from pyasn1_modules import rfc5480
from pyasn1_modules import rfc5652
from pyasn1_modules import rfc5751
from pyasn1_modules import rfc8018


# Imports from RFC 5280

AlgorithmIdentifier = rfc5280.AlgorithmIdentifier


# Imports from RFC 5652

OriginatorPublicKey = rfc5652.OriginatorPublicKey

UserKeyingMaterial = rfc5652.UserKeyingMaterial


# Imports from RFC 5480

ECDSA_Sig_Value = rfc5480.ECDSA_Sig_Value

ECParameters = rfc5480.ECParameters

ECPoint = rfc5480.ECPoint

id_ecPublicKey = rfc5480.id_ecPublicKey


# Imports from RFC 8018

id_hmacWithSHA224 = rfc8018.id_hmacWithSHA224

id_hmacWithSHA256 = rfc8018.id_hmacWithSHA256

id_hmacWithSHA384 = rfc8018.id_hmacWithSHA384

id_hmacWithSHA512 = rfc8018.id_hmacWithSHA512


# Object Identifier arcs

x9_63_scheme = univ.ObjectIdentifier('1.3.133.16.840.63.0')

secg_scheme = univ.ObjectIdentifier('1.3.132.1')


# Object Identifiers for the algorithms

dhSinglePass_cofactorDH_sha1kdf_scheme = x9_63_scheme + (3, )

dhSinglePass_cofactorDH_sha224kdf_scheme = secg_scheme + (14, 0, )

dhSinglePass_cofactorDH_sha256kdf_scheme = secg_scheme + (14, 1, )

dhSinglePass_cofactorDH_sha384kdf_scheme = secg_scheme + (14, 2, )

dhSinglePass_cofactorDH_sha512kdf_scheme = secg_scheme + (14, 3, )

dhSinglePass_stdDH_sha1kdf_scheme = x9_63_scheme + (2, )

dhSinglePass_stdDH_sha224kdf_scheme = secg_scheme + (11, 0, )

dhSinglePass_stdDH_sha256kdf_scheme = secg_scheme + (11, 1, )

dhSinglePass_stdDH_sha384kdf_scheme = secg_scheme + (11, 2, )

dhSinglePass_stdDH_sha512kdf_scheme = secg_scheme + (11, 3, )

mqvSinglePass_sha1kdf_scheme = x9_63_scheme + (16, )

mqvSinglePass_sha224kdf_scheme = secg_scheme + (15, 0, )

mqvSinglePass_sha256kdf_scheme = secg_scheme + (15, 1, )

mqvSinglePass_sha384kdf_scheme = secg_scheme + (15, 2, )

mqvSinglePass_sha512kdf_scheme = secg_scheme + (15, 3, )


# Structures for parameters and key derivation

class IV(univ.OctetString):
    # Exactly 8 octets
    pass


class CBCParameter(IV):
    pass


class KeyWrapAlgorithm(AlgorithmIdentifier):
    pass


class ECC_CMS_SharedInfo(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('keyInfo', KeyWrapAlgorithm()),
        namedtype.OptionalNamedType('entityUInfo',
            univ.OctetString().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.NamedType('suppPubInfo',
            univ.OctetString().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 2)))
    )


class MQVuserKeyingMaterial(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('ephemeralPublicKey', OriginatorPublicKey()),
        namedtype.OptionalNamedType('addedukm',
            UserKeyingMaterial().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0)))
    )


# Update the Algorithm Identifier map in rfc5280.py and
# Update the SMIMECapabilities Attribute Map in rfc5751.py

_algorithmIdentifierMapUpdate = {
    dhSinglePass_stdDH_sha1kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_stdDH_sha224kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_stdDH_sha256kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_stdDH_sha384kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_stdDH_sha512kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_cofactorDH_sha1kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_cofactorDH_sha224kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_cofactorDH_sha256kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_cofactorDH_sha384kdf_scheme: KeyWrapAlgorithm(),
    dhSinglePass_cofactorDH_sha512kdf_scheme: KeyWrapAlgorithm(),
    mqvSinglePass_sha1kdf_scheme: KeyWrapAlgorithm(),
    mqvSinglePass_sha224kdf_scheme: KeyWrapAlgorithm(),
    mqvSinglePass_sha256kdf_scheme: KeyWrapAlgorithm(),
    mqvSinglePass_sha384kdf_scheme: KeyWrapAlgorithm(),
    mqvSinglePass_sha512kdf_scheme: KeyWrapAlgorithm(),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)

rfc5751.smimeCapabilityMap.update(_algorithmIdentifierMapUpdate)
