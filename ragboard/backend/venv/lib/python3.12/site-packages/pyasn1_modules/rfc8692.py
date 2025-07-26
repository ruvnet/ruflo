#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Algorithm Identifiers for RSASSA-PSS and ECDSA using SHAKEs
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc8692.txt
#

from pyasn1.type import univ

from pyasn1_modules import rfc4055
from pyasn1_modules import rfc5280
from pyasn1_modules import rfc5480


# SHAKE128 One-Way Hash Function

id_shake128 = univ.ObjectIdentifier('2.16.840.1.101.3.4.2.11')

mda_shake128 = rfc5280.AlgorithmIdentifier()
mda_shake128['algorithm'] = id_shake128
# mda_shake128['parameters'] is absent


# SHAKE256 One-Way Hash Function

id_shake256 = univ.ObjectIdentifier('2.16.840.1.101.3.4.2.12')

mda_shake256 = rfc5280.AlgorithmIdentifier()
mda_shake256['algorithm'] = id_shake256
# mda_shake256['parameters'] is absent


# RSA PSS with SHAKE128

id_RSASSA_PSS_SHAKE128 = univ.ObjectIdentifier('1.3.6.1.5.5.7.6.30')

sa_rSASSA_PSS_SHAKE128 = rfc5280.AlgorithmIdentifier()
sa_rSASSA_PSS_SHAKE128['algorithm'] = id_RSASSA_PSS_SHAKE128
# sa_rSASSA_PSS_SHAKE128['parameters'] is absent

pk_rsaSSA_PSS_SHAKE128 = rfc4055.RSAPublicKey()


# RSA PSS with SHAKE256

id_RSASSA_PSS_SHAKE256 = univ.ObjectIdentifier('1.3.6.1.5.5.7.6.31')

sa_rSASSA_PSS_SHAKE256 = rfc5280.AlgorithmIdentifier()
sa_rSASSA_PSS_SHAKE256['algorithm'] = id_RSASSA_PSS_SHAKE256
# sa_rSASSA_PSS_SHAKE256['parameters'] is absent

pk_rsaSSA_PSS_SHAKE256 = rfc4055.RSAPublicKey()


# ECDSA with SHAKE128

id_ecdsa_with_shake128 = univ.ObjectIdentifier('1.3.6.1.5.5.7.6.32')

sa_ecdsa_with_shake128 = rfc5280.AlgorithmIdentifier()
sa_ecdsa_with_shake128['algorithm'] = id_ecdsa_with_shake128
# sa_ecdsa_with_shake128['parameters'] is absent

pk_ec = rfc5480.ECPoint()


# ECDSA with SHAKE128

id_ecdsa_with_shake256 = univ.ObjectIdentifier('1.3.6.1.5.5.7.6.33')

sa_ecdsa_with_shake256 = rfc5280.AlgorithmIdentifier()
sa_ecdsa_with_shake256['algorithm'] = id_ecdsa_with_shake256
# sa_ecdsa_with_shake256['parameters'] is absent
