#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# KEA and SKIPJACK Algorithms in CMS
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc2876.txt
#

from pyasn1.type import namedtype
from pyasn1.type import univ

from pyasn1_modules import rfc5280
from pyasn1_modules import rfc5751


id_fortezzaConfidentialityAlgorithm = univ.ObjectIdentifier('2.16.840.1.101.2.1.1.4')


id_fortezzaWrap80 = univ.ObjectIdentifier('2.16.840.1.101.2.1.1.23')


id_kEAKeyEncryptionAlgorithm = univ.ObjectIdentifier('2.16.840.1.101.2.1.1.24')


id_keyExchangeAlgorithm = univ.ObjectIdentifier('2.16.840.1.101.2.1.1.22')


class Skipjack_Parm(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('initialization-vector', univ.OctetString())
    )


# Update the Algorithm Identifier map in rfc5280.py.

_algorithmIdentifierMapUpdate = {
    id_fortezzaConfidentialityAlgorithm: Skipjack_Parm(),
    id_kEAKeyEncryptionAlgorithm: rfc5280.AlgorithmIdentifier(),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)


# Update the SMIMECapabilities Attribute map in rfc5751.py

_smimeCapabilityMapUpdate = {
    id_kEAKeyEncryptionAlgorithm: rfc5280.AlgorithmIdentifier(),
}

rfc5751.smimeCapabilityMap.update(_smimeCapabilityMapUpdate)
