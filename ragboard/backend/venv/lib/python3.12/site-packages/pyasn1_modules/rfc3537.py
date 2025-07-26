#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# SEED Encryption Algorithm in CMS
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc4010.txt
#

from pyasn1.type import constraint
from pyasn1.type import univ

from pyasn1_modules import rfc5280


id_alg_HMACwith3DESwrap = univ.ObjectIdentifier('1.2.840.113549.1.9.16.3.11')
   
   
id_alg_HMACwithAESwrap = univ.ObjectIdentifier('1.2.840.113549.1.9.16.3.12')


# Update the Algorithm Identifier map in rfc5280.py.

_algorithmIdentifierMapUpdate = {
    id_alg_HMACwith3DESwrap: univ.Null(""),
    id_alg_HMACwithAESwrap: univ.Null(""),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)
