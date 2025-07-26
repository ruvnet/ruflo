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
from pyasn1_modules import rfc5751


id_seedCBC = univ.ObjectIdentifier('1.2.410.200004.1.4')


id_npki_app_cmsSeed_wrap = univ.ObjectIdentifier('1.2.410.200004.7.1.1.1')


class SeedIV(univ.OctetString):
    subtypeSpec = constraint.ValueSizeConstraint(16, 16)


class SeedCBCParameter(SeedIV):
    pass


class SeedSMimeCapability(univ.Null):
    pass


# Update the Algorithm Identifier map in rfc5280.py.

_algorithmIdentifierMapUpdate = {
    id_seedCBC: SeedCBCParameter(),
    id_npki_app_cmsSeed_wrap: univ.Null(""),
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)


# Update the SMIMECapabilities Attribute map in rfc5751.py

_smimeCapabilityMapUpdate = {
    id_seedCBC: SeedSMimeCapability(),
    id_npki_app_cmsSeed_wrap: SeedSMimeCapability(),

}

rfc5751.smimeCapabilityMap.update(_smimeCapabilityMapUpdate)
