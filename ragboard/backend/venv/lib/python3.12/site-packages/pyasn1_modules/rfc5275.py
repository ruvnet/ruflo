#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley with assistance from asn1ate v.0.6.0.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# An Internet Attribute Certificate Profile for Authorization
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc5275.txt
#

from pyasn1.type import constraint
from pyasn1.type import namedtype
from pyasn1.type import namedval
from pyasn1.type import opentype
from pyasn1.type import tag
from pyasn1.type import univ
from pyasn1.type import useful

from pyasn1_modules import rfc3565
from pyasn1_modules import rfc5280
from pyasn1_modules import rfc5652
from pyasn1_modules import rfc5751
from pyasn1_modules import rfc5755

MAX = float('inf')


# Initialize the map for GLAQueryRequests and GLAQueryResponses

glaQueryRRMap = { }


# Imports from RFC 3565

id_aes128_wrap = rfc3565.id_aes128_wrap


# Imports from RFC 5280

AlgorithmIdentifier = rfc5280.AlgorithmIdentifier

Certificate = rfc5280.Certificate

GeneralName = rfc5280.GeneralName


# Imports from RFC 5652

CertificateSet = rfc5652.CertificateSet

KEKIdentifier = rfc5652.KEKIdentifier

RecipientInfos = rfc5652.RecipientInfos


# Imports from RFC 5751

SMIMECapability = rfc5751.SMIMECapability


# Imports from RFC 5755

AttributeCertificate = rfc5755.AttributeCertificate


# The GL symmetric key distribution object identifier arc

id_skd = univ.ObjectIdentifier((1, 2, 840, 113549, 1, 9, 16, 8,))


# The GL Use KEK control attribute

id_skd_glUseKEK = id_skd + (1,)


class Certificates(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('pKC',
            Certificate().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('aC',
            univ.SequenceOf(componentType=AttributeCertificate()).subtype(
                subtypeSpec=constraint.ValueSizeConstraint(1, MAX)).subtype(
                    implicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 1))),
        namedtype.OptionalNamedType('certPath',
            CertificateSet().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 2)))
    )


class GLInfo(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glName', GeneralName()),
        namedtype.NamedType('glAddress', GeneralName())
    )


class GLOwnerInfo(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glOwnerName', GeneralName()),
        namedtype.NamedType('glOwnerAddress', GeneralName()),
        namedtype.OptionalNamedType('certificates', Certificates())
    )


class GLAdministration(univ.Integer):
    namedValues = namedval.NamedValues(
        ('unmanaged', 0),
        ('managed', 1),
        ('closed', 2)
    )


requested_algorithm = SMIMECapability().subtype(
   implicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 4))
requested_algorithm['capabilityID'] = id_aes128_wrap


class GLKeyAttributes(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.DefaultedNamedType('rekeyControlledByGLO',
            univ.Boolean().subtype(value=0,
                implicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.DefaultedNamedType('recipientsNotMutuallyAware',
            univ.Boolean().subtype(value=1,
                implicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 1))),
        namedtype.DefaultedNamedType('duration',
            univ.Integer().subtype(value=0,
                implicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 2))),
        namedtype.DefaultedNamedType('generationCounter',
            univ.Integer().subtype(value=2,
                implicitTag=tag.Tag(tag.tagClassContext, tag.tagFormatSimple, 3))),
        namedtype.DefaultedNamedType('requestedAlgorithm', requested_algorithm)
    )


class GLUseKEK(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glInfo', GLInfo()),
        namedtype.NamedType('glOwnerInfo',
            univ.SequenceOf(componentType=GLOwnerInfo()).subtype(
                subtypeSpec=constraint.ValueSizeConstraint(1, MAX))),
        namedtype.DefaultedNamedType('glAdministration',
            GLAdministration().subtype(value=1)),
        namedtype.OptionalNamedType('glKeyAttributes', GLKeyAttributes())
    )


# The Delete GL control attribute

id_skd_glDelete = id_skd + (2,)


class DeleteGL(GeneralName):
    pass


# The Add GL Member control attribute

id_skd_glAddMember = id_skd + (3,)


class GLMember(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glMemberName', GeneralName()),
        namedtype.OptionalNamedType('glMemberAddress', GeneralName()),
        namedtype.OptionalNamedType('certificates', Certificates())
    )


class GLAddMember(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glName', GeneralName()),
        namedtype.NamedType('glMember', GLMember())
    )


# The Delete GL Member control attribute

id_skd_glDeleteMember = id_skd + (4,)


class GLDeleteMember(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glName', GeneralName()),
        namedtype.NamedType('glMemberToDelete', GeneralName())
    )


# The GL Rekey control attribute

id_skd_glRekey = id_skd + (5,)


class GLNewKeyAttributes(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.OptionalNamedType('rekeyControlledByGLO',
            univ.Boolean().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 0))),
        namedtype.OptionalNamedType('recipientsNotMutuallyAware',
            univ.Boolean().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 1))),
        namedtype.OptionalNamedType('duration',
            univ.Integer().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 2))),
        namedtype.OptionalNamedType('generationCounter',
            univ.Integer().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 3))),
        namedtype.OptionalNamedType('requestedAlgorithm',
            AlgorithmIdentifier().subtype(implicitTag=tag.Tag(
                tag.tagClassContext, tag.tagFormatSimple, 4)))
    )


class GLRekey(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glName', GeneralName()),
        namedtype.OptionalNamedType('glAdministration', GLAdministration()),
        namedtype.OptionalNamedType('glNewKeyAttributes', GLNewKeyAttributes()),
        namedtype.OptionalNamedType('glRekeyAllGLKeys', univ.Boolean())
    )


# The Add and Delete GL Owner control attributes

id_skd_glAddOwner = id_skd + (6,)

id_skd_glRemoveOwner = id_skd + (7,)


class GLOwnerAdministration(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glName', GeneralName()),
        namedtype.NamedType('glOwnerInfo', GLOwnerInfo())
    )


# The GL Key Compromise control attribute

id_skd_glKeyCompromise = id_skd + (8,)


class GLKCompromise(GeneralName):
    pass


# The GL Key Refresh control attribute

id_skd_glkRefresh = id_skd + (9,)


class Date(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('start', useful.GeneralizedTime()),
        namedtype.OptionalNamedType('end', useful.GeneralizedTime())
    )


class GLKRefresh(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glName', GeneralName()),
        namedtype.NamedType('dates',
            univ.SequenceOf(componentType=Date()).subtype(
                subtypeSpec=constraint.ValueSizeConstraint(1, MAX)))
    )


# The GLA Query Request control attribute

id_skd_glaQueryRequest = id_skd + (11,)


class GLAQueryRequest(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glaRequestType', univ.ObjectIdentifier()),
        namedtype.NamedType('glaRequestValue', univ.Any(),
            openType=opentype.OpenType('glaRequestType', glaQueryRRMap))
    )


# The GLA Query Response control attribute

id_skd_glaQueryResponse = id_skd + (12,)


class GLAQueryResponse(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glaResponseType', univ.ObjectIdentifier()),
        namedtype.NamedType('glaResponseValue', univ.Any(),
            openType=opentype.OpenType('glaResponseType', glaQueryRRMap))
    )


# The GLA Request/Response (glaRR) arc for glaRequestType/glaResponseType

id_cmc_glaRR = univ.ObjectIdentifier((1, 3, 6, 1, 5, 5, 7, 7, 99,))


# The Algorithm Request

id_cmc_gla_skdAlgRequest = id_cmc_glaRR + (1,)


class SKDAlgRequest(univ.Null):
    pass


# The Algorithm Response

id_cmc_gla_skdAlgResponse = id_cmc_glaRR + (2,)

SMIMECapabilities = rfc5751.SMIMECapabilities


# The control attribute to request an updated certificate to the GLA and
# the control attribute to return an updated certificate to the GLA

id_skd_glProvideCert = id_skd + (13,)

id_skd_glManageCert = id_skd + (14,)


class GLManageCert(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glName', GeneralName()),
        namedtype.NamedType('glMember', GLMember())
    )


# The control attribute to distribute the GL shared KEK

id_skd_glKey = id_skd + (15,)


class GLKey(univ.Sequence):
    componentType = namedtype.NamedTypes(
        namedtype.NamedType('glName', GeneralName()),
        namedtype.NamedType('glIdentifier', KEKIdentifier()),
        namedtype.NamedType('glkWrapped', RecipientInfos()),
        namedtype.NamedType('glkAlgorithm', AlgorithmIdentifier()),
        namedtype.NamedType('glkNotBefore', useful.GeneralizedTime()),
        namedtype.NamedType('glkNotAfter', useful.GeneralizedTime())
    )


# The CMC error types

id_cet_skdFailInfo = univ.ObjectIdentifier((1, 3, 6, 1, 5, 5, 7, 15, 1,))


class SKDFailInfo(univ.Integer):
    namedValues = namedval.NamedValues(
        ('unspecified', 0),
        ('closedGL', 1),
        ('unsupportedDuration', 2),
        ('noGLACertificate', 3),
        ('invalidCert', 4),
        ('unsupportedAlgorithm', 5),
        ('noGLONameMatch', 6),
        ('invalidGLName', 7),
        ('nameAlreadyInUse', 8),
        ('noSpam', 9),
        ('alreadyAMember', 11),
        ('notAMember', 12),
        ('alreadyAnOwner', 13),
        ('notAnOwner', 14)
    )


# Update the map for GLAQueryRequests and GLAQueryResponses

_glaQueryRRMapUpdate = {
    id_cmc_gla_skdAlgRequest: univ.Null(""),
    id_cmc_gla_skdAlgResponse: SMIMECapabilities(),
}

glaQueryRRMap.update(_glaQueryRRMapUpdate)


# Update the map for CMC control attributes; since CMS Attributes and
# CMC Controls both use 'attrType', one map is used for both

_cmcControlAttributesMapUpdate = {
    id_skd_glUseKEK: GLUseKEK(),
    id_skd_glDelete: DeleteGL(),
    id_skd_glAddMember: GLAddMember(),
    id_skd_glDeleteMember: GLDeleteMember(),
    id_skd_glRekey: GLRekey(),
    id_skd_glAddOwner: GLOwnerAdministration(),
    id_skd_glRemoveOwner: GLOwnerAdministration(),
    id_skd_glKeyCompromise: GLKCompromise(),
    id_skd_glkRefresh: GLKRefresh(),
    id_skd_glaQueryRequest: GLAQueryRequest(),
    id_skd_glaQueryResponse: GLAQueryResponse(),
    id_skd_glProvideCert: GLManageCert(),
    id_skd_glManageCert: GLManageCert(),
    id_skd_glKey: GLKey(),
}

rfc5652.cmsAttributesMap.update(_cmcControlAttributesMapUpdate)
