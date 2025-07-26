#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2020, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# SHAKE One-way Hash Functions for CMS
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc8702.txt
#
from pyasn1.type import namedtype
from pyasn1.type import tag
from pyasn1.type import univ

from pyasn1_modules import rfc5280
from pyasn1_modules import rfc8692


# Imports fprm RFC 5280

AlgorithmIdentifier = rfc5280.AlgorithmIdentifier


# Imports from RFC 8692

id_shake128 = rfc8692.id_shake128

mda_shake128 = rfc8692.mda_shake128

id_shake256 = rfc8692.id_shake256

mda_shake256 = rfc8692.mda_shake256

id_RSASSA_PSS_SHAKE128 = rfc8692.id_RSASSA_PSS_SHAKE128

sa_rSASSA_PSS_SHAKE128 = rfc8692.sa_rSASSA_PSS_SHAKE128

pk_rsaSSA_PSS_SHAKE128 = rfc8692.pk_rsaSSA_PSS_SHAKE128

id_RSASSA_PSS_SHAKE256 = rfc8692.id_RSASSA_PSS_SHAKE256

sa_rSASSA_PSS_SHAKE256 = rfc8692.sa_rSASSA_PSS_SHAKE256

pk_rsaSSA_PSS_SHAKE256 = rfc8692.pk_rsaSSA_PSS_SHAKE256

id_ecdsa_with_shake128 = rfc8692.id_ecdsa_with_shake128

sa_ecdsa_with_shake128 = rfc8692.sa_ecdsa_with_shake128

id_ecdsa_with_shake256 = rfc8692.id_ecdsa_with_shake256

sa_ecdsa_with_shake256 = rfc8692.sa_ecdsa_with_shake256

pk_ec = rfc8692.pk_ec


# KMAC with SHAKE128

id_KMACWithSHAKE128 = univ.ObjectIdentifier('2.16.840.1.101.3.4.2.19')


class KMACwithSHAKE128_params(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.DefaultedNamedType('kMACOutputLength',
            univ.Integer().subtype(value=256)),
        namedtype.DefaultedNamedType('customizationString',
            univ.OctetString().subtype(value=''))
    )


maca_KMACwithSHAKE128 = AlgorithmIdentifier()
maca_KMACwithSHAKE128['algorithm'] = id_KMACWithSHAKE128
maca_KMACwithSHAKE128['parameters'] = KMACwithSHAKE128_params()


# KMAC with SHAKE256

id_KMACWithSHAKE256 = univ.ObjectIdentifier('2.16.840.1.101.3.4.2.20')


class KMACwithSHAKE256_params(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.DefaultedNamedType('kMACOutputLength',
            univ.Integer().subtype(value=512)),
        namedtype.DefaultedNamedType('customizationString',
            univ.OctetString().subtype(value=''))
    )


maca_KMACwithSHAKE256 = AlgorithmIdentifier()
maca_KMACwithSHAKE256['algorithm'] = id_KMACWithSHAKE256
maca_KMACwithSHAKE256['parameters'] = KMACwithSHAKE256_params()


# Update the Algorithm Identifier map in rfc5280.py

_algorithmIdentifierMapUpdate = {
    id_KMACWithSHAKE128: KMACwithSHAKE128_params(),
    id_KMACWithSHAKE256: KMACwithSHAKE256_params(),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)
