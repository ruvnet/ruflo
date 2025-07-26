# This file is being contributed to pyasn1-modules software.
#
# Created by Russ Housley.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Elliptic Curve Cryptography Brainpool Standard Curves
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc5639.txt


from pyasn1.type import univ


ecStdCurvesAndGeneration = univ.ObjectIdentifier((1, 3, 36, 3, 3, 2, 8,))

ellipticCurve = ecStdCurvesAndGeneration + (1,)

versionOne = ellipticCurve + (1,)

brainpoolP160r1 = versionOne + (1,)

brainpoolP160t1 = versionOne + (2,)

brainpoolP192r1 = versionOne + (3,)

brainpoolP192t1 = versionOne + (4,)

brainpoolP224r1 = versionOne + (5,)

brainpoolP224t1 = versionOne + (6,)

brainpoolP256r1 = versionOne + (7,)

brainpoolP256t1 = versionOne + (8,)

brainpoolP320r1 = versionOne + (9,)

brainpoolP320t1 = versionOne + (10,)

brainpoolP384r1 = versionOne + (11,)

brainpoolP384t1 = versionOne + (12,)

brainpoolP512r1 = versionOne + (13,)

brainpoolP512t1 = versionOne + (14,)
