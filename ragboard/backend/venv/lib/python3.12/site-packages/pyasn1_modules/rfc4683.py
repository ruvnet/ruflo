#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Subject Identification Method (SIM)
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc4683.txt
# https://www.rfc-editor.org/errata/eid1047
#

from pyasn1.type import char
from pyasn1.type import namedtype
from pyasn1.type import univ

from pyasn1_modules import rfc5280


# Used to compute the PEPSI value

class HashContent(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('userPassword', char.UTF8String()),
        namedtype.NamedType('authorityRandom', univ.OctetString()),
        namedtype.NamedType('identifierType', univ.ObjectIdentifier()),
        namedtype.NamedType('identifier', char.UTF8String())
    )


# Used to encode the PEPSI value as the SIM Other Name

id_pkix = rfc5280.id_pkix

id_on = id_pkix + (8,)

id_on_SIM = id_on + (6,)


class SIM(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('hashAlg', rfc5280.AlgorithmIdentifier()),
        namedtype.NamedType('authorityRandom', univ.OctetString()),
        namedtype.NamedType('pEPSI', univ.OctetString())
    )


# Used to encrypt the PEPSI value during certificate request

id_pkip = id_pkix + (5,)

id_regEPEPSI = id_pkip + (3,)


class EncryptedPEPSI(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('identifierType', univ.ObjectIdentifier()),
        namedtype.NamedType('identifier', char.UTF8String()),
        namedtype.NamedType('sIM', SIM())
    )


# Update the map of Other Name OIDs to Other Names in rfc5280.py

_anotherNameMapUpdate = {
    id_on_SIM: SIM(),
}

rfc5280.anotherNameMap.update(_anotherNameMapUpdate)
