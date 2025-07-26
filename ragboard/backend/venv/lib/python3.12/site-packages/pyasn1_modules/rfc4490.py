#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Using the GOST 28147-89, GOST R 34.11-94, GOST R 34.10-94, and
#   GOST R 34.10-2001 Algorithms with the CMS
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc4490.txt
#


from pyasn1.type import univ, char, namedtype, namedval, tag, constraint, useful

from pyasn1_modules import rfc4357
from pyasn1_modules import rfc5280


# Imports from RFC 4357

id_CryptoPro_algorithms = rfc4357.id_CryptoPro_algorithms

id_GostR3410_94 = rfc4357.id_GostR3410_94

id_GostR3410_2001 = rfc4357.id_GostR3410_2001

Gost28147_89_ParamSet = rfc4357.Gost28147_89_ParamSet

Gost28147_89_EncryptedKey = rfc4357.Gost28147_89_EncryptedKey

GostR3410_94_PublicKeyParameters = rfc4357.GostR3410_94_PublicKeyParameters

GostR3410_2001_PublicKeyParameters = rfc4357.GostR3410_2001_PublicKeyParameters


# Imports from RFC 5280

SubjectPublicKeyInfo = rfc5280.SubjectPublicKeyInfo


# CMS/PKCS#7 key agreement algorithms & parameters

class Gost28147_89_KeyWrapParameters(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('encryptionParamSet', Gost28147_89_ParamSet()),
        namedtype.OptionalNamedType('ukm', univ.OctetString().subtype(
            subtypeSpec=constraint.ValueSizeConstraint(8, 8)))
    )


id_Gost28147_89_CryptoPro_KeyWrap = id_CryptoPro_algorithms + (13, 1, )


id_Gost28147_89_None_KeyWrap = id_CryptoPro_algorithms + (13, 0, )


id_GostR3410_2001_CryptoPro_ESDH = id_CryptoPro_algorithms + (96, )


id_GostR3410_94_CryptoPro_ESDH = id_CryptoPro_algorithms + (97, )


# CMS/PKCS#7 key transport algorithms & parameters

id_GostR3410_2001_KeyTransportSMIMECapability = id_GostR3410_2001


id_GostR3410_94_KeyTransportSMIMECapability = id_GostR3410_94


class GostR3410_TransportParameters(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('encryptionParamSet', Gost28147_89_ParamSet()),
        namedtype.OptionalNamedType('ephemeralPublicKey', 
            SubjectPublicKeyInfo().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.NamedType('ukm', univ.OctetString().subtype(
            subtypeSpec=constraint.ValueSizeConstraint(8, 8)))
    )

class GostR3410_KeyTransport(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('sessionEncryptedKey', Gost28147_89_EncryptedKey()),
        namedtype.OptionalNamedType('transportParameters',
            GostR3410_TransportParameters().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 0)))
    )


# GOST R 34.10-94 signature algorithm & parameters

class GostR3410_94_Signature(univ.OctetString):
    subtypeSpec = constraint.ValueSizeConstraint(64, 64)


# GOST R 34.10-2001 signature algorithms and parameters

class GostR3410_2001_Signature(univ.OctetString):
    subtypeSpec = constraint.ValueSizeConstraint(64, 64)


# Update the Algorithm Identifier map in rfc5280.py

_algorithmIdentifierMapUpdate = {
    id_Gost28147_89_CryptoPro_KeyWrap: Gost28147_89_KeyWrapParameters(),
    id_Gost28147_89_None_KeyWrap: Gost28147_89_KeyWrapParameters(),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)
