# This file is being contributed to pyasn1-modules software.
#
# Created by Russ Housley.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Other Certificates Extension
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc5697.txt

from pyasn1.type import namedtype
from pyasn1.type import univ

from pyasn1_modules import rfc5280
from pyasn1_modules import rfc4055


# Imports from RFC 5280

AlgorithmIdentifier = rfc5280.AlgorithmIdentifier

CertificateSerialNumber = rfc5280.CertificateSerialNumber

GeneralNames = rfc5280.GeneralNames


# Imports from RFC 4055

id_sha1 = rfc4055.id_sha1


# Imports from RFC 5055
# These are defined here because a module for RFC 5055 does not exist yet

class SCVPIssuerSerial(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('issuer', GeneralNames()),
        namedtype.NamedType('serialNumber', CertificateSerialNumber())
    )


sha1_alg_id = AlgorithmIdentifier()
sha1_alg_id['algorithm'] = id_sha1


class SCVPCertID(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('certHash', univ.OctetString()),
        namedtype.NamedType('issuerSerial', SCVPIssuerSerial()),
        namedtype.DefaultedNamedType('hashAlgorithm', sha1_alg_id)
    )


# Other Certificates Extension

id_pe_otherCerts = univ.ObjectIdentifier((1, 3, 6, 1, 5, 5, 7, 1, 19,))

class OtherCertificates(univ.SequenceOf):
    componentType = SCVPCertID()


# Update of certificate extension map in rfc5280.py

_certificateExtensionsMapUpdate = {
    id_pe_otherCerts: OtherCertificates(),
}

rfc5280.certificateExtensionsMap.update(_certificateExtensionsMapUpdate)
