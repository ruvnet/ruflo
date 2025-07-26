#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# IDEA Encryption Algorithm in CMS
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc3058.txt
# https://www.rfc-editor.org/errata/eid5913
#

from pyasn1.type import namedtype
from pyasn1.type import univ

from pyasn1_modules import rfc5280


id_IDEA_CBC = univ.ObjectIdentifier('1.3.6.1.4.1.188.7.1.1.2')

           
id_alg_CMSIDEAwrap = univ.ObjectIdentifier('1.3.6.1.4.1.188.7.1.1.6')


class IDEA_CBCPar(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('iv', univ.OctetString())
        # exactly 8 octets, when present
    )


# Update the Algorithm Identifier map in rfc5280.py.

_algorithmIdentifierMapUpdate = {
    id_IDEA_CBC: IDEA_CBCPar(),
    id_alg_CMSIDEAwrap: univ.Null("")
}

rfc5280.algorithmIdentifierMap.update(_algorithmIdentifierMapUpdate)
