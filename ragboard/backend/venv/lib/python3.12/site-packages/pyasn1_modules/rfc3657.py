#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Camellia Algorithm in CMS
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc3657.txt
#

from pyasn1.type import constraint
from pyasn1.type import univ

from pyasn1_modules import rfc5280
from pyasn1_modules import rfc5751


id_camellia128_cbc = univ.ObjectIdentifier('1.2.392.200011.61.1.1.1.2')

id_camellia192_cbc = univ.ObjectIdentifier('1.2.392.200011.61.1.1.1.3')

id_camellia256_cbc = univ.ObjectIdentifier('1.2.392.200011.61.1.1.1.4')

id_camellia128_wrap = univ.ObjectIdentifier('1.2.392.200011.61.1.1.3.2')

id_camellia192_wrap = univ.ObjectIdentifier('1.2.392.200011.61.1.1.3.3')

id_camellia256_wrap = univ.ObjectIdentifier('1.2.392.200011.61.1.1.3.4')



class Camellia_IV(univ.OctetString):
    subtypeSpec = constraint.ValueSizeConstraint(16, 16)


class CamelliaSMimeCapability(univ.Null):
    pass


# Update the Algorithm Identifier map in rfc5280.py.

_algorithmIdentifierMapUpdate = {
    id_camellia128_cbc: Camellia_IV(),
    id_camellia192_cbc: Camellia_IV(),
    id_camellia256_cbc: Camellia_IV(),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)


# Update the SMIMECapabilities Attribute map in rfc5751.py

_smimeCapabilityMapUpdate = {
    id_camellia128_cbc: CamelliaSMimeCapability(),
    id_camellia192_cbc: CamelliaSMimeCapability(),
    id_camellia256_cbc: CamelliaSMimeCapability(),
    id_camellia128_wrap: CamelliaSMimeCapability(),
    id_camellia192_wrap: CamelliaSMimeCapability(),
    id_camellia256_wrap: CamelliaSMimeCapability(),
}

rfc5751.smimeCapabilityMap.update(_smimeCapabilityMapUpdate)
