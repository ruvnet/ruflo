#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Additional Cryptographic Algorithms for Use with GOST 28147-89,
# GOST R 34.10-94, GOST R 34.10-2001, and GOST R 34.11-94 Algorithms
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc4357.txt
# https://www.rfc-editor.org/errata/eid5927
# https://www.rfc-editor.org/errata/eid5928
#

from pyasn1.type import constraint
from pyasn1.type import namedtype
from pyasn1.type import namedval
from pyasn1.type import tag
from pyasn1.type import univ

from pyasn1_modules import rfc5280


# Import from RFC 5280

AlgorithmIdentifier = rfc5280.AlgorithmIdentifier


# Object Identifiers

id_CryptoPro = univ.ObjectIdentifier((1, 2, 643, 2, 2,))


id_CryptoPro_modules = id_CryptoPro + (1, 1,)

id_CryptoPro_extensions = id_CryptoPro + (34,)

id_CryptoPro_policyIds = id_CryptoPro + (38,)

id_CryptoPro_policyQt = id_CryptoPro + (39,)


cryptographic_Gost_Useful_Definitions = id_CryptoPro_modules + (0, 1,)

gostR3411_94_DigestSyntax = id_CryptoPro_modules + (1, 1,)

gostR3410_94_PKISyntax = id_CryptoPro_modules + (2, 1,)

gostR3410_94_SignatureSyntax = id_CryptoPro_modules + (3, 1,)

gost28147_89_EncryptionSyntax = id_CryptoPro_modules + (4, 1,)

gostR3410_EncryptionSyntax = id_CryptoPro_modules + (5, 2,)

gost28147_89_ParamSetSyntax = id_CryptoPro_modules + (6, 1,)

gostR3411_94_ParamSetSyntax = id_CryptoPro_modules + (7, 1,)

gostR3410_94_ParamSetSyntax = id_CryptoPro_modules + (8, 1, 1)

gostR3410_2001_PKISyntax = id_CryptoPro_modules + (9, 1,)

gostR3410_2001_SignatureSyntax = id_CryptoPro_modules + (10, 1,)

gostR3410_2001_ParamSetSyntax = id_CryptoPro_modules + (12, 1,)

gost_CryptoPro_ExtendedKeyUsage = id_CryptoPro_modules + (13, 1,)

gost_CryptoPro_PrivateKey = id_CryptoPro_modules + (14, 1,)

gost_CryptoPro_PKIXCMP = id_CryptoPro_modules + (15, 1,)

gost_CryptoPro_TLS = id_CryptoPro_modules + (16, 1,)

gost_CryptoPro_Policy = id_CryptoPro_modules + (17, 1,)

gost_CryptoPro_Constants = id_CryptoPro_modules + (18, 1,)


id_CryptoPro_algorithms = id_CryptoPro

id_GostR3411_94_with_GostR3410_2001 = id_CryptoPro_algorithms + (3,)

id_GostR3411_94_with_GostR3410_94 = id_CryptoPro_algorithms + (4,)

id_GostR3411_94 = id_CryptoPro_algorithms + (9,)

id_Gost28147_89_None_KeyMeshing = id_CryptoPro_algorithms + (14, 0,)

id_Gost28147_89_CryptoPro_KeyMeshing = id_CryptoPro_algorithms + (14, 1,)

id_GostR3410_2001 = id_CryptoPro_algorithms + (19,)

id_GostR3410_94 = id_CryptoPro_algorithms + (20,)

id_Gost28147_89 = id_CryptoPro_algorithms + (21,)

id_Gost28147_89_MAC = id_CryptoPro_algorithms + (22,)

id_CryptoPro_hashes = id_CryptoPro_algorithms + (30,)

id_CryptoPro_encrypts = id_CryptoPro_algorithms + (31,)

id_CryptoPro_signs = id_CryptoPro_algorithms + (32,)

id_CryptoPro_exchanges = id_CryptoPro_algorithms + (33,)

id_CryptoPro_ecc_signs = id_CryptoPro_algorithms + (35,)

id_CryptoPro_ecc_exchanges = id_CryptoPro_algorithms + (36,)

id_CryptoPro_private_keys = id_CryptoPro_algorithms + (37,)

id_CryptoPro_pkixcmp_infos = id_CryptoPro_algorithms + (41,)

id_CryptoPro_audit_service_types = id_CryptoPro_algorithms + (42,)

id_CryptoPro_audit_record_types = id_CryptoPro_algorithms + (43,)

id_CryptoPro_attributes = id_CryptoPro_algorithms + (44,)

id_CryptoPro_name_service_types = id_CryptoPro_algorithms + (45,)

id_GostR3410_2001DH = id_CryptoPro_algorithms + (98,)

id_GostR3410_94DH = id_CryptoPro_algorithms + (99,)


id_Gost28147_89_TestParamSet = id_CryptoPro_encrypts + (0,)

id_Gost28147_89_CryptoPro_A_ParamSet = id_CryptoPro_encrypts + (1,)

id_Gost28147_89_CryptoPro_B_ParamSet = id_CryptoPro_encrypts + (2,)

id_Gost28147_89_CryptoPro_C_ParamSet = id_CryptoPro_encrypts + (3,)

id_Gost28147_89_CryptoPro_D_ParamSet = id_CryptoPro_encrypts + (4,)

id_Gost28147_89_CryptoPro_Oscar_1_1_ParamSet = id_CryptoPro_encrypts + (5,)

id_Gost28147_89_CryptoPro_Oscar_1_0_ParamSet = id_CryptoPro_encrypts + (6,)

id_Gost28147_89_CryptoPro_RIC_1_ParamSet = id_CryptoPro_encrypts + (7,)


id_GostR3410_2001_TestParamSet = id_CryptoPro_ecc_signs + (0,)

id_GostR3410_2001_CryptoPro_A_ParamSet = id_CryptoPro_ecc_signs + (1,)

id_GostR3410_2001_CryptoPro_B_ParamSet = id_CryptoPro_ecc_signs + (2,)

id_GostR3410_2001_CryptoPro_C_ParamSet = id_CryptoPro_ecc_signs + (3,)


id_GostR3410_2001_CryptoPro_XchA_ParamSet = id_CryptoPro_ecc_exchanges + (0,)

id_GostR3410_2001_CryptoPro_XchB_ParamSet = id_CryptoPro_ecc_exchanges + (1,)


id_GostR3410_94_TestParamSet = id_CryptoPro_signs + (0,)

id_GostR3410_94_CryptoPro_A_ParamSet = id_CryptoPro_signs + (2,)

id_GostR3410_94_CryptoPro_B_ParamSet = id_CryptoPro_signs + (3,)

id_GostR3410_94_CryptoPro_C_ParamSet = id_CryptoPro_signs + (4,)

id_GostR3410_94_CryptoPro_D_ParamSet = id_CryptoPro_signs + (5,)


id_GostR3410_94_CryptoPro_XchA_ParamSet = id_CryptoPro_exchanges + (1,)

id_GostR3410_94_CryptoPro_XchB_ParamSet = id_CryptoPro_exchanges + (2,)

id_GostR3410_94_CryptoPro_XchC_ParamSet = id_CryptoPro_exchanges + (3,)


id_GostR3410_94_a = id_GostR3410_94 + (1,)

id_GostR3410_94_aBis = id_GostR3410_94 + (2,)

id_GostR3410_94_b = id_GostR3410_94 + (3,)

id_GostR3410_94_bBis = id_GostR3410_94 + (4,)


id_GostR3411_94_TestParamSet = id_CryptoPro_hashes + (0,)

id_GostR3411_94_CryptoProParamSet = id_CryptoPro_hashes + (1,)




class Gost28147_89_ParamSet(univ.ObjectIdentifier):
    pass

Gost28147_89_ParamSet.subtypeSpec = constraint.SingleValueConstraint(
    id_Gost28147_89_TestParamSet,
    id_Gost28147_89_CryptoPro_A_ParamSet,
    id_Gost28147_89_CryptoPro_B_ParamSet,
    id_Gost28147_89_CryptoPro_C_ParamSet,
    id_Gost28147_89_CryptoPro_D_ParamSet,
    id_Gost28147_89_CryptoPro_Oscar_1_1_ParamSet,
    id_Gost28147_89_CryptoPro_Oscar_1_0_ParamSet,
    id_Gost28147_89_CryptoPro_RIC_1_ParamSet
)


class Gost28147_89_BlobParameters(univ.Sequence):
    pass

Gost28147_89_BlobParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('encryptionParamSet', Gost28147_89_ParamSet())
)


class Gost28147_89_MAC(univ.OctetString):
    pass

Gost28147_89_MAC.subtypeSpec = constraint.ValueSizeConstraint(1, 4)


class Gost28147_89_Key(univ.OctetString):
    pass

Gost28147_89_Key.subtypeSpec = constraint.ValueSizeConstraint(32, 32)


class Gost28147_89_EncryptedKey(univ.Sequence):
    pass

Gost28147_89_EncryptedKey.componentType = namedtype.NamedTypes(
    namedtype.NamedType('encryptedKey', Gost28147_89_Key()),
    namedtype.OptionalNamedType('maskKey', Gost28147_89_Key().subtype(
        implicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 0))),
    namedtype.NamedType('macKey', Gost28147_89_MAC())
)


class Gost28147_89_IV(univ.OctetString):
    pass

Gost28147_89_IV.subtypeSpec = constraint.ValueSizeConstraint(8, 8)


class Gost28147_89_UZ(univ.OctetString):
    pass

Gost28147_89_UZ.subtypeSpec = constraint.ValueSizeConstraint(64, 64)


class Gost28147_89_ParamSetParameters(univ.Sequence):
    pass

Gost28147_89_ParamSetParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('eUZ', Gost28147_89_UZ()),
    namedtype.NamedType('mode',
        univ.Integer(namedValues=namedval.NamedValues(
            ('gost28147-89-CNT', 0),
            ('gost28147-89-CFB', 1),
            ('cryptoPro-CBC', 2)
    ))),
    namedtype.NamedType('shiftBits',
        univ.Integer(namedValues=namedval.NamedValues(
            ('gost28147-89-block', 64)
    ))),
    namedtype.NamedType('keyMeshing', AlgorithmIdentifier())
)


class Gost28147_89_Parameters(univ.Sequence):
    pass

Gost28147_89_Parameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('iv', Gost28147_89_IV()),
    namedtype.NamedType('encryptionParamSet', Gost28147_89_ParamSet())
)


class GostR3410_2001_CertificateSignature(univ.BitString):
    pass

GostR3410_2001_CertificateSignature.subtypeSpec=constraint.ValueSizeConstraint(256, 512)


class GostR3410_2001_ParamSetParameters(univ.Sequence):
    pass

GostR3410_2001_ParamSetParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('a', univ.Integer()),
    namedtype.NamedType('b', univ.Integer()),
    namedtype.NamedType('p', univ.Integer()),
    namedtype.NamedType('q', univ.Integer()),
    namedtype.NamedType('x', univ.Integer()),
    namedtype.NamedType('y', univ.Integer())
)


class GostR3410_2001_PublicKey(univ.OctetString):
    pass

GostR3410_2001_PublicKey.subtypeSpec = constraint.ValueSizeConstraint(64, 64)


class GostR3410_2001_PublicKeyParameters(univ.Sequence):
    pass

GostR3410_2001_PublicKeyParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('publicKeyParamSet', univ.ObjectIdentifier().subtype(
        subtypeSpec=constraint.SingleValueConstraint(
            id_GostR3410_2001_TestParamSet,
            id_GostR3410_2001_CryptoPro_A_ParamSet,
            id_GostR3410_2001_CryptoPro_B_ParamSet,
            id_GostR3410_2001_CryptoPro_C_ParamSet,
            id_GostR3410_2001_CryptoPro_XchA_ParamSet,
            id_GostR3410_2001_CryptoPro_XchB_ParamSet
    ))),
    namedtype.NamedType('digestParamSet', univ.ObjectIdentifier().subtype(
        subtypeSpec=constraint.SingleValueConstraint(
            id_GostR3411_94_TestParamSet,
            id_GostR3411_94_CryptoProParamSet
    ))),
    namedtype.DefaultedNamedType('encryptionParamSet',
        Gost28147_89_ParamSet().subtype(value=id_Gost28147_89_CryptoPro_A_ParamSet
    ))
)


class GostR3410_94_CertificateSignature(univ.BitString):
    pass

GostR3410_94_CertificateSignature.subtypeSpec = constraint.ValueSizeConstraint(256, 512)


class GostR3410_94_ParamSetParameters_t(univ.Integer):
    pass

GostR3410_94_ParamSetParameters_t.subtypeSpec = constraint.SingleValueConstraint(512, 1024)


class GostR3410_94_ParamSetParameters(univ.Sequence):
    pass

GostR3410_94_ParamSetParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('t', GostR3410_94_ParamSetParameters_t()),
    namedtype.NamedType('p', univ.Integer()),
    namedtype.NamedType('q', univ.Integer()),
    namedtype.NamedType('a', univ.Integer()),
    namedtype.OptionalNamedType('validationAlgorithm', AlgorithmIdentifier())
)


class GostR3410_94_PublicKey(univ.OctetString):
    pass

GostR3410_94_PublicKey.subtypeSpec = constraint.ConstraintsUnion(
    constraint.ValueSizeConstraint(64, 64),
    constraint.ValueSizeConstraint(128, 128)
)


class GostR3410_94_PublicKeyParameters(univ.Sequence):
    pass

GostR3410_94_PublicKeyParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('publicKeyParamSet', univ.ObjectIdentifier().subtype(
        subtypeSpec=constraint.SingleValueConstraint(
            id_GostR3410_94_TestParamSet,
            id_GostR3410_94_CryptoPro_A_ParamSet,
            id_GostR3410_94_CryptoPro_B_ParamSet,
            id_GostR3410_94_CryptoPro_C_ParamSet,
            id_GostR3410_94_CryptoPro_D_ParamSet,
            id_GostR3410_94_CryptoPro_XchA_ParamSet,
            id_GostR3410_94_CryptoPro_XchB_ParamSet,
            id_GostR3410_94_CryptoPro_XchC_ParamSet
    ))),
    namedtype.NamedType('digestParamSet', univ.ObjectIdentifier().subtype(
        subtypeSpec=constraint.SingleValueConstraint(
            id_GostR3411_94_TestParamSet,
            id_GostR3411_94_CryptoProParamSet
    ))),
    namedtype.DefaultedNamedType('encryptionParamSet',
        Gost28147_89_ParamSet().subtype(value=id_Gost28147_89_CryptoPro_A_ParamSet
    ))
)


class GostR3410_94_ValidationBisParameters_c(univ.Integer):
    pass

GostR3410_94_ValidationBisParameters_c.subtypeSpec = constraint.ValueRangeConstraint(0, 4294967295)


class GostR3410_94_ValidationBisParameters(univ.Sequence):
    pass

GostR3410_94_ValidationBisParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('x0', GostR3410_94_ValidationBisParameters_c()),
    namedtype.NamedType('c', GostR3410_94_ValidationBisParameters_c()),
    namedtype.OptionalNamedType('d', univ.Integer())
)


class GostR3410_94_ValidationParameters_c(univ.Integer):
    pass

GostR3410_94_ValidationParameters_c.subtypeSpec = constraint.ValueRangeConstraint(0, 65535)


class GostR3410_94_ValidationParameters(univ.Sequence):
    pass

GostR3410_94_ValidationParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('x0', GostR3410_94_ValidationParameters_c()),
    namedtype.NamedType('c', GostR3410_94_ValidationParameters_c()),
    namedtype.OptionalNamedType('d', univ.Integer())
)


class GostR3411_94_Digest(univ.OctetString):
    pass

GostR3411_94_Digest.subtypeSpec = constraint.ValueSizeConstraint(32, 32)


class GostR3411_94_DigestParameters(univ.ObjectIdentifier):
    pass

GostR3411_94_DigestParameters.subtypeSpec = constraint.ConstraintsUnion(
     constraint.SingleValueConstraint(id_GostR3411_94_TestParamSet),
     constraint.SingleValueConstraint(id_GostR3411_94_CryptoProParamSet),
)


class GostR3411_94_ParamSetParameters(univ.Sequence):
    pass

GostR3411_94_ParamSetParameters.componentType = namedtype.NamedTypes(
    namedtype.NamedType('hUZ', Gost28147_89_UZ()),
    namedtype.NamedType('h0', GostR3411_94_Digest())
)


# Update the Algorithm Identifier map in rfc5280.py

_algorithmIdentifierMapUpdate = {
    id_Gost28147_89: Gost28147_89_Parameters(),
    id_Gost28147_89_TestParamSet: Gost28147_89_ParamSetParameters(),
    id_Gost28147_89_CryptoPro_A_ParamSet: Gost28147_89_ParamSetParameters(),
    id_Gost28147_89_CryptoPro_B_ParamSet: Gost28147_89_ParamSetParameters(),
    id_Gost28147_89_CryptoPro_C_ParamSet: Gost28147_89_ParamSetParameters(),
    id_Gost28147_89_CryptoPro_D_ParamSet: Gost28147_89_ParamSetParameters(),
    id_Gost28147_89_CryptoPro_KeyMeshing: univ.Null(""),
    id_Gost28147_89_None_KeyMeshing: univ.Null(""),
    id_GostR3410_94: GostR3410_94_PublicKeyParameters(),
    id_GostR3410_94_TestParamSet: GostR3410_94_ParamSetParameters(),
    id_GostR3410_94_CryptoPro_A_ParamSet: GostR3410_94_ParamSetParameters(),
    id_GostR3410_94_CryptoPro_B_ParamSet: GostR3410_94_ParamSetParameters(),
    id_GostR3410_94_CryptoPro_C_ParamSet: GostR3410_94_ParamSetParameters(),
    id_GostR3410_94_CryptoPro_D_ParamSet: GostR3410_94_ParamSetParameters(),
    id_GostR3410_94_CryptoPro_XchA_ParamSet: GostR3410_94_ParamSetParameters(),
    id_GostR3410_94_CryptoPro_XchB_ParamSet: GostR3410_94_ParamSetParameters(),
    id_GostR3410_94_CryptoPro_XchC_ParamSet: GostR3410_94_ParamSetParameters(),
    id_GostR3410_94_a: GostR3410_94_ValidationParameters(),
    id_GostR3410_94_aBis: GostR3410_94_ValidationBisParameters(),
    id_GostR3410_94_b: GostR3410_94_ValidationParameters(),
    id_GostR3410_94_bBis: GostR3410_94_ValidationBisParameters(),
    id_GostR3410_2001: univ.Null(""),
    id_GostR3411_94: univ.Null(""),
    id_GostR3411_94_TestParamSet: GostR3411_94_ParamSetParameters(),
    id_GostR3411_94_CryptoProParamSet: GostR3411_94_ParamSetParameters(),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)
