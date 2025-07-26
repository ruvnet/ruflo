#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Attribute Certificate Policies Extension
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc4476.txt
#

from pyasn1.type import char
from pyasn1.type import constraint
from pyasn1.type import namedtype
from pyasn1.type import univ

from pyasn1_modules import rfc5280

MAX = float('inf')


# Imports from RFC 5280

PolicyQualifierId = rfc5280.PolicyQualifierId

PolicyQualifierInfo = rfc5280.PolicyQualifierInfo

UserNotice = rfc5280.UserNotice

id_pkix = rfc5280.id_pkix


# Object Identifiers

id_pe = id_pkix + (1,)

id_pe_acPolicies = id_pe + (15,)

id_qt = id_pkix + (2,)

id_qt_acps = id_qt + (4,)

id_qt_acunotice = id_qt + (5,)


# Attribute Certificate Policies Extension

class ACUserNotice(UserNotice):
    pass


class ACPSuri(char.IA5String):
    pass


class AcPolicyId(univ.ObjectIdentifier):
    pass


class PolicyInformation(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('policyIdentifier', AcPolicyId()),
        namedtype.OptionalNamedType('policyQualifiers',
            univ.SequenceOf(componentType=PolicyQualifierInfo()).subtype(
                subtypeSpec=constraint.ValueSizeConstraint(1, MAX)))
    )


class AcPoliciesSyntax(univ.SequenceOf):
    componentType = PolicyInformation()
    subtypeSpec = constraint.ValueSizeConstraint(1, MAX)


# Update the policy qualifier map in rfc5280.py

_policyQualifierInfoMapUpdate = {
    id_qt_acps: ACPSuri(),
    id_qt_acunotice: UserNotice(),
}

rfc5280.policyQualifierInfoMap.update(_policyQualifierInfoMapUpdate)


# Update the certificate extension map in rfc5280.py

_certificateExtensionsMapUpdate = {
    id_pe_acPolicies: AcPoliciesSyntax(),
}

rfc5280.certificateExtensionsMap.update(_certificateExtensionsMapUpdate)
