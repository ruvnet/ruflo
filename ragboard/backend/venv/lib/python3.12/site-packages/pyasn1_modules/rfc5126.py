#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# CMS Advanced Electronic Signatures (CAdES)
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc5126.txt
#

from pyasn1.type import char
from pyasn1.type import constraint
from pyasn1.type import namedtype
from pyasn1.type import opentype
from pyasn1.type import tag
from pyasn1.type import useful
from pyasn1.type import univ

from pyasn1_modules import rfc5280
from pyasn1_modules import rfc5652
from pyasn1_modules import rfc5035
from pyasn1_modules import rfc5755
from pyasn1_modules import rfc6960
from pyasn1_modules import rfc3161

MAX = float('inf')


# Maps for OpenTypes

commitmentQualifierMap = { }

sigQualifiersMap = { }

otherRevRefMap = { }

otherRevValMap = { }


# Imports from RFC 5652

ContentInfo = rfc5652.ContentInfo

ContentType = rfc5652.ContentType

SignedData = rfc5652.SignedData

EncapsulatedContentInfo = rfc5652.EncapsulatedContentInfo

SignerInfo = rfc5652.SignerInfo

MessageDigest = rfc5652.MessageDigest

SigningTime = rfc5652.SigningTime

Countersignature = rfc5652.Countersignature

id_data = rfc5652.id_data

id_signedData = rfc5652.id_signedData

id_contentType= rfc5652.id_contentType

id_messageDigest = rfc5652.id_messageDigest

id_signingTime = rfc5652.id_signingTime

id_countersignature = rfc5652.id_countersignature


# Imports from RFC 5035

SigningCertificate = rfc5035.SigningCertificate

IssuerSerial = rfc5035.IssuerSerial

ContentReference = rfc5035.ContentReference

ContentIdentifier = rfc5035.ContentIdentifier

id_aa_contentReference = rfc5035.id_aa_contentReference

id_aa_contentIdentifier = rfc5035.id_aa_contentIdentifier
    
id_aa_signingCertificate = rfc5035.id_aa_signingCertificate

id_aa_signingCertificateV2 = rfc5035.id_aa_signingCertificateV2


# Imports from RFC 5280

Certificate = rfc5280.Certificate

AlgorithmIdentifier = rfc5280.AlgorithmIdentifier

CertificateList = rfc5280.CertificateList

Name = rfc5280.Name

Attribute = rfc5280.Attribute

GeneralNames = rfc5280.GeneralNames

GeneralName = rfc5280.GeneralName

PolicyInformation = rfc5280.PolicyInformation

DirectoryString = rfc5280.DirectoryString


# Imports from RFC 5755

AttributeCertificate = rfc5755.AttributeCertificate


# Imports from RFC 6960

BasicOCSPResponse = rfc6960.BasicOCSPResponse

ResponderID = rfc6960.ResponderID


# Imports from RFC 3161

TimeStampToken = rfc3161.TimeStampToken


# OID used referencing electronic signature mechanisms

id_etsi_es_IDUP_Mechanism_v1 = univ.ObjectIdentifier('0.4.0.1733.1.4.1')


# OtherSigningCertificate - deprecated

id_aa_ets_otherSigCert = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.19')


class OtherHashValue(univ.OctetString):
    pass


class OtherHashAlgAndValue(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('hashAlgorithm', AlgorithmIdentifier()),
        namedtype.NamedType('hashValue', OtherHashValue())
    )


class OtherHash(univ.Choice):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('sha1Hash', OtherHashValue()),
        namedtype.NamedType('otherHash', OtherHashAlgAndValue())
    )


class OtherCertID(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('otherCertHash', OtherHash()),
        namedtype.OptionalNamedType('issuerSerial', IssuerSerial())
    )


class OtherSigningCertificate(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('certs',
            univ.SequenceOf(componentType=OtherCertID())),
        namedtype.OptionalNamedType('policies',
            univ.SequenceOf(componentType=PolicyInformation()))
    )


# Signature Policy Identifier

id_aa_ets_sigPolicyId = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.15')


class SigPolicyId(univ.ObjectIdentifier):
    pass


class SigPolicyHash(OtherHashAlgAndValue):
    pass


class SigPolicyQualifierId(univ.ObjectIdentifier):
    pass


class SigPolicyQualifierInfo(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('sigPolicyQualifierId', SigPolicyQualifierId()),
        namedtype.NamedType('sigQualifier', univ.Any(),
            openType=opentype.OpenType('sigPolicyQualifierId', sigQualifiersMap))
    )


class SignaturePolicyId(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('sigPolicyId', SigPolicyId()),
        namedtype.NamedType('sigPolicyHash', SigPolicyHash()),
        namedtype.OptionalNamedType('sigPolicyQualifiers',
            univ.SequenceOf(componentType=SigPolicyQualifierInfo()).subtype(
                subtypeSpec=constraint.ValueSizeConstraint(1, MAX)))
    )


class SignaturePolicyImplied(univ.Null):
    pass


class SignaturePolicy(univ.Choice):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('signaturePolicyId', SignaturePolicyId()),
        namedtype.NamedType('signaturePolicyImplied', SignaturePolicyImplied())
    )


id_spq_ets_unotice = univ.ObjectIdentifier('1.2.840.113549.1.9.16.5.2')


class DisplayText(univ.Choice):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('visibleString', char.VisibleString().subtype(
            subtypeSpec=constraint.ValueSizeConstraint(1, 200))),
        namedtype.NamedType('bmpString', char.BMPString().subtype(
            subtypeSpec=constraint.ValueSizeConstraint(1, 200))),
        namedtype.NamedType('utf8String', char.UTF8String().subtype(
            subtypeSpec=constraint.ValueSizeConstraint(1, 200)))
    )


class NoticeReference(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('organization', DisplayText()),
        namedtype.NamedType('noticeNumbers',
            univ.SequenceOf(componentType=univ.Integer()))
    )

class SPUserNotice(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('noticeRef', NoticeReference()),
        namedtype.OptionalNamedType('explicitText', DisplayText())
    )


noticeToUser = SigPolicyQualifierInfo()
noticeToUser['sigPolicyQualifierId'] = id_spq_ets_unotice
noticeToUser['sigQualifier'] = SPUserNotice()


id_spq_ets_uri = univ.ObjectIdentifier('1.2.840.113549.1.9.16.5.1')


class SPuri(char.IA5String):
    pass


pointerToSigPolSpec = SigPolicyQualifierInfo()
pointerToSigPolSpec['sigPolicyQualifierId'] = id_spq_ets_uri
pointerToSigPolSpec['sigQualifier'] = SPuri()


# Commitment Type

id_aa_ets_commitmentType = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.16')


class CommitmentTypeIdentifier(univ.ObjectIdentifier):
    pass


class CommitmentTypeQualifier(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('commitmentTypeIdentifier',
             CommitmentTypeIdentifier()),
        namedtype.NamedType('qualifier', univ.Any(),
            openType=opentype.OpenType('commitmentTypeIdentifier',
                 commitmentQualifierMap))
    )


class CommitmentTypeIndication(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('commitmentTypeId', CommitmentTypeIdentifier()),
        namedtype.OptionalNamedType('commitmentTypeQualifier',
            univ.SequenceOf(componentType=CommitmentTypeQualifier()).subtype(
                subtypeSpec=constraint.ValueSizeConstraint(1, MAX)))
    )


id_cti_ets_proofOfOrigin = univ.ObjectIdentifier('1.2.840.113549.1.9.16.6.1')

id_cti_ets_proofOfReceipt = univ.ObjectIdentifier('1.2.840.113549.1.9.16.6.2')

id_cti_ets_proofOfDelivery = univ.ObjectIdentifier('1.2.840.113549.1.9.16.6.3')

id_cti_ets_proofOfSender = univ.ObjectIdentifier('1.2.840.113549.1.9.16.6.4')

id_cti_ets_proofOfApproval = univ.ObjectIdentifier('1.2.840.113549.1.9.16.6.5')

id_cti_ets_proofOfCreation = univ.ObjectIdentifier('1.2.840.113549.1.9.16.6.6')


# Signer Location

id_aa_ets_signerLocation = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.17')


class PostalAddress(univ.SequenceOf):
    componentType = DirectoryString()
    subtypeSpec = constraint.ValueSizeConstraint(1, 6)


class SignerLocation(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('countryName',
            DirectoryString().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('localityName',
            DirectoryString().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1))),
        namedtype.OptionalNamedType('postalAdddress',
            PostalAddress().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 2)))
    )


# Signature Timestamp

id_aa_signatureTimeStampToken = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.14')


class SignatureTimeStampToken(TimeStampToken):
    pass


# Content Timestamp

id_aa_ets_contentTimestamp = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.20')


class ContentTimestamp(TimeStampToken):
    pass


# Signer Attributes

id_aa_ets_signerAttr = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.18')


class ClaimedAttributes(univ.SequenceOf):
    componentType = Attribute()


class CertifiedAttributes(AttributeCertificate):
    pass


class SignerAttribute(univ.SequenceOf):
    componentType = univ.Choice(componentType=namedtype.NamedTypes(
        namedtype.NamedType('claimedAttributes',
            ClaimedAttributes().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.NamedType('certifiedAttributes',
            CertifiedAttributes().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1)))
    ))


# Complete Certificate Refs

id_aa_ets_certificateRefs = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.21')


class CompleteCertificateRefs(univ.SequenceOf):
    componentType = OtherCertID()


# Complete Revocation Refs

id_aa_ets_revocationRefs = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.22')


class CrlIdentifier(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('crlissuer', Name()),
        namedtype.NamedType('crlIssuedTime', useful.UTCTime()),
        namedtype.OptionalNamedType('crlNumber', univ.Integer())
    )


class CrlValidatedID(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('crlHash', OtherHash()),
        namedtype.OptionalNamedType('crlIdentifier', CrlIdentifier())
    )


class CRLListID(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('crls',
            univ.SequenceOf(componentType=CrlValidatedID()))
    )


class OcspIdentifier(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('ocspResponderID', ResponderID()),
        namedtype.NamedType('producedAt', useful.GeneralizedTime())
    )


class OcspResponsesID(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('ocspIdentifier', OcspIdentifier()),
        namedtype.OptionalNamedType('ocspRepHash', OtherHash())
    )


class OcspListID(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('ocspResponses',
            univ.SequenceOf(componentType=OcspResponsesID()))
    )


class OtherRevRefType(univ.ObjectIdentifier):
    pass


class OtherRevRefs(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('otherRevRefType', OtherRevRefType()),
        namedtype.NamedType('otherRevRefs', univ.Any(),
            openType=opentype.OpenType('otherRevRefType', otherRevRefMap))
    )


class CrlOcspRef(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('crlids',
            CRLListID().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 0))),
        namedtype.OptionalNamedType('ocspids',
            OcspListID().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 1))),
        namedtype.OptionalNamedType('otherRev',
            OtherRevRefs().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 2)))
    )


class CompleteRevocationRefs(univ.SequenceOf):
    componentType = CrlOcspRef()


# Certificate Values

id_aa_ets_certValues = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.23')


class CertificateValues(univ.SequenceOf):
    componentType = Certificate()


# Certificate Revocation Values

id_aa_ets_revocationValues = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.24')


class OtherRevValType(univ.ObjectIdentifier):
    pass


class OtherRevVals(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('otherRevValType', OtherRevValType()),
        namedtype.NamedType('otherRevVals', univ.Any(),
            openType=opentype.OpenType('otherRevValType', otherRevValMap))
    )


class RevocationValues(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('crlVals',
            univ.SequenceOf(componentType=CertificateList()).subtype(
                explicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('ocspVals',
            univ.SequenceOf(componentType=BasicOCSPResponse()).subtype(
                explicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 1))),
        namedtype.OptionalNamedType('otherRevVals',
            OtherRevVals().subtype(explicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatConstructed, 2)))
    )


# CAdES-C Timestamp

id_aa_ets_escTimeStamp = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.25')


class ESCTimeStampToken(TimeStampToken):
    pass


# Time-Stamped Certificates and CRLs

id_aa_ets_certCRLTimestamp = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.26')


class TimestampedCertsCRLs(TimeStampToken):
    pass


# Archive Timestamp

id_aa_ets_archiveTimestampV2 = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.48')


class ArchiveTimeStampToken(TimeStampToken):
    pass


# Attribute certificate references

id_aa_ets_attrCertificateRefs = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.44')


class AttributeCertificateRefs(univ.SequenceOf):
    componentType = OtherCertID()


# Attribute revocation references

id_aa_ets_attrRevocationRefs = univ.ObjectIdentifier('1.2.840.113549.1.9.16.2.45')


class AttributeRevocationRefs(univ.SequenceOf):
    componentType = CrlOcspRef()


# Update the sigQualifiersMap

_sigQualifiersMapUpdate = {
    id_spq_ets_unotice: SPUserNotice(),
    id_spq_ets_uri: SPuri(),
}

sigQualifiersMap.update(_sigQualifiersMapUpdate)


# Update the CMS Attribute Map in rfc5652.py

_cmsAttributesMapUpdate = {
    id_aa_ets_otherSigCert: OtherSigningCertificate(),
    id_aa_ets_sigPolicyId: SignaturePolicy(),
    id_aa_ets_commitmentType: CommitmentTypeIndication(),
    id_aa_ets_signerLocation: SignerLocation(),
    id_aa_signatureTimeStampToken: SignatureTimeStampToken(),
    id_aa_ets_contentTimestamp: ContentTimestamp(),
    id_aa_ets_signerAttr: SignerAttribute(),
    id_aa_ets_certificateRefs: CompleteCertificateRefs(),
    id_aa_ets_revocationRefs: CompleteRevocationRefs(),
    id_aa_ets_certValues: CertificateValues(),
    id_aa_ets_revocationValues: RevocationValues(),
    id_aa_ets_escTimeStamp: ESCTimeStampToken(),
    id_aa_ets_certCRLTimestamp: TimestampedCertsCRLs(),
    id_aa_ets_archiveTimestampV2: ArchiveTimeStampToken(),
    id_aa_ets_attrCertificateRefs: AttributeCertificateRefs(),
    id_aa_ets_attrRevocationRefs: AttributeRevocationRefs(),
}

rfc5652.cmsAttributesMap.update(_cmsAttributesMapUpdate)
