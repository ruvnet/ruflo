#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with some assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Using Pre-Shared Key (PSK) in the Cryptographic Message Syntax (CMS)
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc8696.txt
#

from pyasn1.type import constraint
from pyasn1.type import namedtype
from pyasn1.type import namedval
from pyasn1.type import tag
from pyasn1.type import univ

from pyasn1_modules import rfc5652

MAX = float('inf')


id_ori = univ.ObjectIdentifier('1.2.840.113549.1.9.16.13')

id_ori_keyTransPSK = univ.ObjectIdentifier('1.2.840.113549.1.9.16.13.1')

id_ori_keyAgreePSK = univ.ObjectIdentifier('1.2.840.113549.1.9.16.13.2')


class PreSharedKeyIdentifier(univ.OctetString):
    pass


class KeyTransRecipientInfos(univ.SequenceOf):
    componentType = rfc5652.KeyTransRecipientInfo()


class KeyTransPSKRecipientInfo(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('version',
            rfc5652.CMSVersion()),
        namedtype.NamedType('pskid',
            PreSharedKeyIdentifier()),
        namedtype.NamedType('kdfAlgorithm',
            rfc5652.KeyDerivationAlgorithmIdentifier()),
        namedtype.NamedType('keyEncryptionAlgorithm',
            rfc5652.KeyEncryptionAlgorithmIdentifier()),
        namedtype.NamedType('ktris',
            KeyTransRecipientInfos()),
        namedtype.NamedType('encryptedKey',
            rfc5652.EncryptedKey())
    )


class KeyAgreePSKRecipientInfo(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('version',
            rfc5652.CMSVersion()),
        namedtype.NamedType('pskid',
            PreSharedKeyIdentifier()),
        namedtype.NamedType('originator',
            rfc5652.OriginatorIdentifierOrKey().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 0))),
        namedtype.OptionalNamedType('ukm',
            rfc5652.UserKeyingMaterial().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1))),
        namedtype.NamedType('kdfAlgorithm',
            rfc5652.KeyDerivationAlgorithmIdentifier()),
        namedtype.NamedType('keyEncryptionAlgorithm',
            rfc5652.KeyEncryptionAlgorithmIdentifier()),
        namedtype.NamedType('recipientEncryptedKeys',
            rfc5652.RecipientEncryptedKeys())
    )


class CMSORIforPSKOtherInfo(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('psk',
            univ.OctetString()),
        namedtype.NamedType('keyMgmtAlgType',
            univ.Enumerated(namedValues=namedval.NamedValues(
                ('keyTrans', 5), ('keyAgree', 10)))),
        namedtype.NamedType('keyEncryptionAlgorithm',
            rfc5652.KeyEncryptionAlgorithmIdentifier()),
        namedtype.NamedType('pskLength',
            univ.Integer().subtype(
                subtypeSpec=constraint.ValueRangeConstraint(1, MAX))),
        namedtype.NamedType('kdkLength',
            univ.Integer().subtype(
                subtypeSpec=constraint.ValueRangeConstraint(1, MAX)))
    )


# Update the CMS Other Recipient Info map in rfc5652.py

_otherRecipientInfoMapUpdate = {
    id_ori_keyTransPSK: KeyTransPSKRecipientInfo(),
    id_ori_keyAgreePSK: KeyAgreePSKRecipientInfo(),
}

rfc5652.otherRecipientInfoMap.update(_otherRecipientInfoMapUpdate)
