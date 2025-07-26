#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Electronic Signature Policies
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc3125.txt
# https://www.rfc-editor.org/errata/eid5901
# https://www.rfc-editor.org/errata/eid5902
#

from pyasn1.type import constraint
from pyasn1.type import namedtype
from pyasn1.type import namedval
from pyasn1.type import tag
from pyasn1.type import useful
from pyasn1.type import univ

from pyasn1_modules import rfc5280

MAX = float('inf')


# Imports from RFC 5280

AlgorithmIdentifier = rfc5280.AlgorithmIdentifier

Attribute = rfc5280.Attribute

AttributeType = rfc5280.AttributeType

AttributeTypeAndValue = rfc5280.AttributeTypeAndValue

AttributeValue = rfc5280.AttributeValue

Certificate = rfc5280.Certificate

CertificateList = rfc5280.CertificateList

DirectoryString = rfc5280.DirectoryString

GeneralName = rfc5280.GeneralName

GeneralNames = rfc5280.GeneralNames

Name = rfc5280.Name

PolicyInformation = rfc5280.PolicyInformation


# Electronic Signature Policies

class CertPolicyId(univ.ObjectIdentifier):
    pass


class AcceptablePolicySet(univ.SequenceOf):
    componentType = CertPolicyId()


class SignPolExtn(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('extnID', univ.ObjectIdentifier()),
        namedtype.NamedType('extnValue', univ.OctetString())
    )


class SignPolExtensions(univ.SequenceOf):
    componentType = SignPolExtn()


class AlgAndLength(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('algID', univ.ObjectIdentifier()),
        namedtype.OptionalNamedType('minKeyLength', univ.Integer()),
        namedtype.OptionalNamedType('other', SignPolExtensions())
    )


class AlgorithmConstraints(univ.SequenceOf):
    componentType = AlgAndLength()


class AlgorithmConstraintSet(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('signerAlgorithmConstraints',
            AlgorithmConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('eeCertAlgorithmConstraints',
            AlgorithmConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1))),
        namedtype.OptionalNamedType('caCertAlgorithmConstraints',
            AlgorithmConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 2))),
        namedtype.OptionalNamedType('aaCertAlgorithmConstraints',
            AlgorithmConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 3))),
        namedtype.OptionalNamedType('tsaCertAlgorithmConstraints',
            AlgorithmConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 4)))
    )


class AttributeValueConstraints(univ.SequenceOf):
    componentType = AttributeTypeAndValue()


class AttributeTypeConstraints(univ.SequenceOf):
    componentType = AttributeType()


class AttributeConstraints(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('attributeTypeConstarints',
            AttributeTypeConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('attributeValueConstarints',
            AttributeValueConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1)))
    )


class HowCertAttribute(univ.Enumerated):
    namedValues = namedval.NamedValues(
        ('claimedAttribute', 0),
        ('certifiedAttribtes', 1),
        ('either', 2)
    )


class SkipCerts(univ.Integer):
    subtypeSpec = constraint.ValueRangeConstraint(0, MAX)


class PolicyConstraints(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('requireExplicitPolicy',
            SkipCerts().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('inhibitPolicyMapping',
            SkipCerts().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1)))
    )


class BaseDistance(univ.Integer):
    subtypeSpec = constraint.ValueRangeConstraint(0, MAX)


class GeneralSubtree(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('base', GeneralName()),
        namedtype.DefaultedNamedType('minimum',
            BaseDistance().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0)).subtype(
                    value=0)),
        namedtype.OptionalNamedType('maximum',
            BaseDistance().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1)))
    )


class GeneralSubtrees(univ.SequenceOf):
    componentType = GeneralSubtree()
    subtypeSpec = constraint.ValueSizeConstraint(1, MAX)


class NameConstraints(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('permittedSubtrees',
            GeneralSubtrees().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('excludedSubtrees',
            GeneralSubtrees().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1)))
    )


class PathLenConstraint(univ.Integer):
    subtypeSpec = constraint.ValueRangeConstraint(0, MAX)


class CertificateTrustPoint(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('trustpoint', Certificate()),
        namedtype.OptionalNamedType('pathLenConstraint',
            PathLenConstraint().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('acceptablePolicySet',
            AcceptablePolicySet().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1))),
        namedtype.OptionalNamedType('nameConstraints',
            NameConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 2))),
        namedtype.OptionalNamedType('policyConstraints',
            PolicyConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 3)))
    )


class CertificateTrustTrees(univ.SequenceOf):
    componentType = CertificateTrustPoint()


class EnuRevReq(univ.Enumerated):
    namedValues = namedval.NamedValues(
        ('clrCheck', 0),
        ('ocspCheck', 1),
        ('bothCheck', 2),
        ('eitherCheck', 3),
        ('noCheck', 4),
        ('other', 5)
    )


class RevReq(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('enuRevReq', EnuRevReq()),
        namedtype.OptionalNamedType('exRevReq', SignPolExtensions())
    )


class CertRevReq(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('endCertRevReq', RevReq()),
        namedtype.NamedType('caCerts',
            RevReq().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 0)))
    )


class AttributeTrustCondition(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('attributeMandated', univ.Boolean()),
        namedtype.NamedType('howCertAttribute', HowCertAttribute()),
        namedtype.OptionalNamedType('attrCertificateTrustTrees',
            CertificateTrustTrees().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('attrRevReq',
            CertRevReq().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 1))),
        namedtype.OptionalNamedType('attributeConstraints',
            AttributeConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 2)))
    )


class CMSAttrs(univ.SequenceOf):
    componentType = univ.ObjectIdentifier()


class CertInfoReq(univ.Enumerated):
    namedValues = namedval.NamedValues(
        ('none', 0),
        ('signerOnly', 1),
        ('fullPath', 2)
    )


class CertRefReq(univ.Enumerated):
    namedValues = namedval.NamedValues(
        ('signerOnly', 1),
        ('fullPath', 2)
    )


class DeltaTime(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('deltaSeconds', univ.Integer()),
        namedtype.NamedType('deltaMinutes', univ.Integer()),
        namedtype.NamedType('deltaHours', univ.Integer()),
        namedtype.NamedType('deltaDays', univ.Integer())
    )


class TimestampTrustCondition(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('ttsCertificateTrustTrees',
            CertificateTrustTrees().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('ttsRevReq',
            CertRevReq().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 1))),
        namedtype.OptionalNamedType('ttsNameConstraints',
            NameConstraints().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 2))),
        namedtype.OptionalNamedType('cautionPeriod',
            DeltaTime().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 3))),
        namedtype.OptionalNamedType('signatureTimestampDelay',
            DeltaTime().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 4)))
    )


class SignerRules(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('externalSignedData', univ.Boolean()),
        namedtype.NamedType('mandatedSignedAttr', CMSAttrs()),
        namedtype.NamedType('mandatedUnsignedAttr', CMSAttrs()),
        namedtype.DefaultedNamedType('mandatedCertificateRef',
            CertRefReq().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0)).subtype(
                    value='signerOnly')),
        namedtype.DefaultedNamedType('mandatedCertificateInfo',
            CertInfoReq().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1)).subtype(
                    value='none')),
        namedtype.OptionalNamedType('signPolExtensions',
            SignPolExtensions().subtype(explicitTag=tag.Tag(
                 tag.tagClassContext, tag.tagFormatSimple, 2)))
    )


class MandatedUnsignedAttr(CMSAttrs):
    pass


class VerifierRules(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('mandatedUnsignedAttr', MandatedUnsignedAttr()),
        namedtype.OptionalNamedType('signPolExtensions', SignPolExtensions())
    )


class SignerAndVerifierRules(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('signerRules', SignerRules()),
        namedtype.NamedType('verifierRules', VerifierRules())
    )


class SigningCertTrustCondition(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('signerTrustTrees', CertificateTrustTrees()),
        namedtype.NamedType('signerRevReq', CertRevReq())
    )


class CommitmentTypeIdentifier(univ.ObjectIdentifier):
    pass


class FieldOfApplication(DirectoryString):
    pass


class CommitmentType(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('identifier', CommitmentTypeIdentifier()),
        namedtype.OptionalNamedType('fieldOfApplication',
            FieldOfApplication().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('semantics',
            DirectoryString().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1)))
    )


class SelectedCommitmentTypes(univ.SequenceOf):
    componentType = univ.Choice(componentType=namedtype.NamedTypes(
        namedtype.NamedType('empty', univ.Null()),
        namedtype.NamedType('recognizedCommitmentType', CommitmentType())
    ))


class CommitmentRule(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('selCommitmentTypes', SelectedCommitmentTypes()),
        namedtype.OptionalNamedType('signerAndVeriferRules',
            SignerAndVerifierRules().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 0))),
        namedtype.OptionalNamedType('signingCertTrustCondition',
            SigningCertTrustCondition().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 1))),
        namedtype.OptionalNamedType('timeStampTrustCondition',
            TimestampTrustCondition().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 2))),
        namedtype.OptionalNamedType('attributeTrustCondition',
            AttributeTrustCondition().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 3))),
        namedtype.OptionalNamedType('algorithmConstraintSet',
            AlgorithmConstraintSet().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 4))),
        namedtype.OptionalNamedType('signPolExtensions',
            SignPolExtensions().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 5)))
    )


class CommitmentRules(univ.SequenceOf):
    componentType = CommitmentRule()


class CommonRules(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('signerAndVeriferRules',
            SignerAndVerifierRules().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 0))),
        namedtype.OptionalNamedType('signingCertTrustCondition',
            SigningCertTrustCondition().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 1))),
        namedtype.OptionalNamedType('timeStampTrustCondition',
            TimestampTrustCondition().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 2))),
        namedtype.OptionalNamedType('attributeTrustCondition',
            AttributeTrustCondition().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 3))),
        namedtype.OptionalNamedType('algorithmConstraintSet',
            AlgorithmConstraintSet().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 4))),
        namedtype.OptionalNamedType('signPolExtensions',
            SignPolExtensions().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 5)))
    )


class PolicyIssuerName(GeneralNames):
    pass


class SignPolicyHash(univ.OctetString):
    pass


class SignPolicyId(univ.ObjectIdentifier):
    pass


class SigningPeriod(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('notBefore', useful.GeneralizedTime()),
        namedtype.OptionalNamedType('notAfter', useful.GeneralizedTime())
    )


class SignatureValidationPolicy(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('signingPeriod', SigningPeriod()),
        namedtype.NamedType('commonRules', CommonRules()),
        namedtype.NamedType('commitmentRules', CommitmentRules()),
        namedtype.OptionalNamedType('signPolExtensions', SignPolExtensions())
    )


class SignPolicyInfo(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('signPolicyIdentifier', SignPolicyId()),
        namedtype.NamedType('dateOfIssue', useful.GeneralizedTime()),
        namedtype.NamedType('policyIssuerName', PolicyIssuerName()),
        namedtype.NamedType('fieldOfApplication', FieldOfApplication()),
        namedtype.NamedType('signatureValidationPolicy', SignatureValidationPolicy()),
        namedtype.OptionalNamedType('signPolExtensions', SignPolExtensions())
    )


class SignaturePolicy(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('signPolicyHashAlg', AlgorithmIdentifier()),
        namedtype.NamedType('signPolicyInfo', SignPolicyInfo()),
        namedtype.OptionalNamedType('signPolicyHash', SignPolicyHash())
    )


