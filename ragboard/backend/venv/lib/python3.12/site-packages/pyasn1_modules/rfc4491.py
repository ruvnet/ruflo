#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Using the GOST R 34.10-94, GOST R 34.10-2001, and GOST R 34.11-94
#   Algorithms with Certificates and CRLs
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc4491.txt
#

from pyasn1_modules import rfc4357


# Signature Algorithm GOST R 34.10-94

id_GostR3411_94_with_GostR3410_94 = rfc4357.id_GostR3411_94_with_GostR3410_94


# Signature Algorithm GOST R 34.10-2001

id_GostR3411_94_with_GostR3410_2001 = rfc4357.id_GostR3411_94_with_GostR3410_2001


# GOST R 34.10-94 Keys

id_GostR3410_94 = rfc4357.id_GostR3410_94

GostR3410_2001_PublicKey = rfc4357.GostR3410_2001_PublicKey

GostR3410_2001_PublicKeyParameters = rfc4357.GostR3410_2001_PublicKeyParameters


# GOST R 34.10-2001 Keys

id_GostR3410_2001 = rfc4357.id_GostR3410_2001

GostR3410_94_PublicKey = rfc4357.GostR3410_94_PublicKey

GostR3410_94_PublicKeyParameters = rfc4357.GostR3410_94_PublicKeyParameters
