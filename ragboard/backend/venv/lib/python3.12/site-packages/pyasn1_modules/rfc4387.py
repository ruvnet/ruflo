#
# This file is part of pyasn1-modules software.
#
# Created by Russ Housley.
#
# Copyright (c) 2019, Vigil Security, LLC
# License: http://snmplabs.com/pyasn1/license.html
#
# Certificate Store Access via HTTP
#
# ASN.1 source from:
# https://www.rfc-editor.org/rfc/rfc4387.txt
#


from pyasn1.type import univ


id_ad = univ.ObjectIdentifier((1, 3, 6, 1, 5, 5, 7, 48, ))

id_ad_http_certs = id_ad + (6, )

id_ad_http_crls = id_ad  + (7,)
