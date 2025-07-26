#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Cryptographic Message Syntax (CMS) Algorithms
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc3370.txt
#

from pyasn1.type import univ

from pyasn1_modules import rfc3279
from pyasn1_modules import rfc5280
from pyasn1_modules import rfc5751
from pyasn1_modules import rfc5753
from pyasn1_modules import rfc5990
from pyasn1_modules import rfc8018


# Imports from RFC 5280

AlgorithmIdentifier = rfc5280.AlgorithmIdentifier


# Imports from RFC 3279

dhpublicnumber = rfc3279.dhpublicnumber

dh_public_number = dhpublicnumber

DHPublicKey = rfc3279.DHPublicKey

DomainParameters = rfc3279.DomainParameters

DHDomainParameters = DomainParameters

Dss_Parms = rfc3279.Dss_Parms

Dss_Sig_Value = rfc3279.Dss_Sig_Value

md5 = rfc3279.md5

md5WithRSAEncryption = rfc3279.md5WithRSAEncryption

RSAPublicKey = rfc3279.RSAPublicKey

rsaEncryption = rfc3279.rsaEncryption

ValidationParms = rfc3279.ValidationParms

id_dsa = rfc3279.id_dsa

id_dsa_with_sha1 = rfc3279.id_dsa_with_sha1

id_sha1 = rfc3279.id_sha1

sha_1 = id_sha1

sha1WithRSAEncryption = rfc3279.sha1WithRSAEncryption


# Imports from RFC 5753

CBCParameter = rfc5753.CBCParameter

CBCParameter = rfc5753.IV

KeyWrapAlgorithm = rfc5753.KeyWrapAlgorithm


# Imports from RFC 5990

id_alg_CMS3DESwrap = rfc5990.id_alg_CMS3DESwrap


# Imports from RFC 8018

des_EDE3_CBC = rfc8018.des_EDE3_CBC

des_ede3_cbc = des_EDE3_CBC

rc2CBC = rfc8018.rc2CBC

rc2_cbc = rc2CBC

RC2_CBC_Parameter = rfc8018.RC2_CBC_Parameter

RC2CBCParameter = RC2_CBC_Parameter

PBKDF2_params = rfc8018.PBKDF2_params

id_PBKDF2 = rfc8018.id_PBKDF2


# The few things that are not already defined elsewhere

hMAC_SHA1 = univ.ObjectIdentifier('1.3.6.1.5.5.8.1.2')


id_alg_ESDH = univ.ObjectIdentifier('1.2.840.113549.1.9.16.3.5')


id_alg_SSDH = univ.ObjectIdentifier('1.2.840.113549.1.9.16.3.10')


id_alg_CMSRC2wrap = univ.ObjectIdentifier('1.2.840.113549.1.9.16.3.7')


class RC2ParameterVersion(univ.Integer):
    pass


class RC2wrapParameter(RC2ParameterVersion):
    pass


class Dss_Pub_Key(univ.Integer):
    pass


# Update the Algorithm Identifier map in rfc5280.py.

_algorithmIdentifierMapUpdate = {
    hMAC_SHA1: univ.Null(""),
    id_alg_CMSRC2wrap: RC2wrapParameter(),
    id_alg_ESDH: KeyWrapAlgorithm(),
    id_alg_SSDH: KeyWrapAlgorithm(),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)


# Update the S/MIME Capabilities map in rfc5751.py.

_smimeCapabilityMapUpdate = {
    id_alg_CMSRC2wrap: RC2wrapParameter(),
    id_alg_ESDH: KeyWrapAlgorithm(),
    id_alg_SSDH: KeyWrapAlgorithm(),
}

rfc5751.smimeCapabilityMap.update(_smimeCapabilityMapUpdate)
