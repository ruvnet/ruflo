# This file is being contributed to pyasn1-modules software.
#
# Created by Russ Housley
#
# Copyright (c) 2020, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# HSS/LMS Hash-based Signature Algorithm for CMS
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc8708.txt


from pyasn1.type import univ

from pyasn1_modules import rfc5280


# Object Identifiers

id_alg_hss_lms_hashsig = univ.ObjectIdentifier('1.2.840.113549.1.9.16.3.17')

id_alg_mts_hashsig = id_alg_hss_lms_hashsig


# Signature Algorithm Identifier

sa_HSS_LMS_HashSig = rfc5280.AlgorithmIdentifier()
sa_HSS_LMS_HashSig['algorithm'] = id_alg_hss_lms_hashsig
# sa_HSS_LMS_HashSig['parameters'] is alway absent


# Public Key

class HSS_LMS_HashSig_PublicKey(univ.OctetString):
    pass


pk_HSS_LMS_HashSig = rfc5280.SubjectPublicKeyInfo()
pk_HSS_LMS_HashSig['algorithm'] = sa_HSS_LMS_HashSig
# pk_HSS_LMS_HashSig['parameters'] CONTAINS a DER-encoded HSS_LMS_HashSig_PublicKey
