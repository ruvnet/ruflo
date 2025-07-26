#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Diffie-Hellman Key Agreement
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc3820.txt
#

from pyasn1.type import namedtype
from pyasn1.type import univ

from pyasn1_modules import rfc5280



class ProxyCertPathLengthConstraint(univ.Integer):
    pass


class ProxyPolicy(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('policyLanguage', univ.ObjectIdentifier()),
        namedtype.OptionalNamedType('policy', univ.OctetString())
    )


class ProxyCertInfoExtension(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('pCPathLenConstraint',
            ProxyCertPathLengthConstraint()),
        namedtype.NamedType('proxyPolicy', ProxyPolicy())
    )


id_pkix = univ.ObjectIdentifier((1, 3, 6, 1, 5, 5, 7, ))


id_pe = id_pkix + (1, )

id_pe_proxyCertInfo = id_pe + (14, )


id_ppl = id_pkix + (21, )

id_ppl_anyLanguage = id_ppl + (0, )

id_ppl_inheritAll = id_ppl + (1, )

id_ppl_independent = id_ppl + (2, )


# Map of Certificate Extension OIDs to Extensions added to the
# ones that are in rfc5280.py

_certificateExtensionsMapUpdate = {
    id_pe_proxyCertInfo: ProxyCertInfoExtension(),	
}

rfc5280.certificateExtensionsMap.update(_certificateExtensionsMapUpdate)
