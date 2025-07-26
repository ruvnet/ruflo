# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from enum import Enum
from typing import Final

TLS_CIPHER: Final = "tls.cipher"
"""
String indicating the [cipher](https://datatracker.ietf.org/doc/html/rfc5246#appendix-A.5) used during the current connection.
Note: The values allowed for `tls.cipher` MUST be one of the `Descriptions` of the [registered TLS Cipher Suits](https://www.iana.org/assignments/tls-parameters/tls-parameters.xhtml#table-tls-parameters-4).
"""

TLS_CLIENT_CERTIFICATE: Final = "tls.client.certificate"
"""
PEM-encoded stand-alone certificate offered by the client. This is usually mutually-exclusive of `client.certificate_chain` since this value also exists in that list.
"""

TLS_CLIENT_CERTIFICATE_CHAIN: Final = "tls.client.certificate_chain"
"""
Array of PEM-encoded certificates that make up the certificate chain offered by the client. This is usually mutually-exclusive of `client.certificate` since that value should be the first certificate in the chain.
"""

TLS_CLIENT_HASH_MD5: Final = "tls.client.hash.md5"
"""
Certificate fingerprint using the MD5 digest of DER-encoded version of certificate offered by the client. For consistency with other hash values, this value should be formatted as an uppercase hash.
"""

TLS_CLIENT_HASH_SHA1: Final = "tls.client.hash.sha1"
"""
Certificate fingerprint using the SHA1 digest of DER-encoded version of certificate offered by the client. For consistency with other hash values, this value should be formatted as an uppercase hash.
"""

TLS_CLIENT_HASH_SHA256: Final = "tls.client.hash.sha256"
"""
Certificate fingerprint using the SHA256 digest of DER-encoded version of certificate offered by the client. For consistency with other hash values, this value should be formatted as an uppercase hash.
"""

TLS_CLIENT_ISSUER: Final = "tls.client.issuer"
"""
Distinguished name of [subject](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.6) of the issuer of the x.509 certificate presented by the client.
"""

TLS_CLIENT_JA3: Final = "tls.client.ja3"
"""
A hash that identifies clients based on how they perform an SSL/TLS handshake.
"""

TLS_CLIENT_NOT_AFTER: Final = "tls.client.not_after"
"""
Date/Time indicating when client certificate is no longer considered valid.
"""

TLS_CLIENT_NOT_BEFORE: Final = "tls.client.not_before"
"""
Date/Time indicating when client certificate is first considered valid.
"""

TLS_CLIENT_SERVER_NAME: Final = "tls.client.server_name"
"""
Deprecated: Replaced by `server.address`.
"""

TLS_CLIENT_SUBJECT: Final = "tls.client.subject"
"""
Distinguished name of subject of the x.509 certificate presented by the client.
"""

TLS_CLIENT_SUPPORTED_CIPHERS: Final = "tls.client.supported_ciphers"
"""
Array of ciphers offered by the client during the client hello.
"""

TLS_CURVE: Final = "tls.curve"
"""
String indicating the curve used for the given cipher, when applicable.
"""

TLS_ESTABLISHED: Final = "tls.established"
"""
Boolean flag indicating if the TLS negotiation was successful and transitioned to an encrypted tunnel.
"""

TLS_NEXT_PROTOCOL: Final = "tls.next_protocol"
"""
String indicating the protocol being tunneled. Per the values in the [IANA registry](https://www.iana.org/assignments/tls-extensiontype-values/tls-extensiontype-values.xhtml#alpn-protocol-ids), this string should be lower case.
"""

TLS_PROTOCOL_NAME: Final = "tls.protocol.name"
"""
Normalized lowercase protocol name parsed from original string of the negotiated [SSL/TLS protocol version](https://docs.openssl.org/1.1.1/man3/SSL_get_version/#return-values).
"""

TLS_PROTOCOL_VERSION: Final = "tls.protocol.version"
"""
Numeric part of the version parsed from the original string of the negotiated [SSL/TLS protocol version](https://docs.openssl.org/1.1.1/man3/SSL_get_version/#return-values).
"""

TLS_RESUMED: Final = "tls.resumed"
"""
Boolean flag indicating if this TLS connection was resumed from an existing TLS negotiation.
"""

TLS_SERVER_CERTIFICATE: Final = "tls.server.certificate"
"""
PEM-encoded stand-alone certificate offered by the server. This is usually mutually-exclusive of `server.certificate_chain` since this value also exists in that list.
"""

TLS_SERVER_CERTIFICATE_CHAIN: Final = "tls.server.certificate_chain"
"""
Array of PEM-encoded certificates that make up the certificate chain offered by the server. This is usually mutually-exclusive of `server.certificate` since that value should be the first certificate in the chain.
"""

TLS_SERVER_HASH_MD5: Final = "tls.server.hash.md5"
"""
Certificate fingerprint using the MD5 digest of DER-encoded version of certificate offered by the server. For consistency with other hash values, this value should be formatted as an uppercase hash.
"""

TLS_SERVER_HASH_SHA1: Final = "tls.server.hash.sha1"
"""
Certificate fingerprint using the SHA1 digest of DER-encoded version of certificate offered by the server. For consistency with other hash values, this value should be formatted as an uppercase hash.
"""

TLS_SERVER_HASH_SHA256: Final = "tls.server.hash.sha256"
"""
Certificate fingerprint using the SHA256 digest of DER-encoded version of certificate offered by the server. For consistency with other hash values, this value should be formatted as an uppercase hash.
"""

TLS_SERVER_ISSUER: Final = "tls.server.issuer"
"""
Distinguished name of [subject](https://datatracker.ietf.org/doc/html/rfc5280#section-4.1.2.6) of the issuer of the x.509 certificate presented by the client.
"""

TLS_SERVER_JA3S: Final = "tls.server.ja3s"
"""
A hash that identifies servers based on how they perform an SSL/TLS handshake.
"""

TLS_SERVER_NOT_AFTER: Final = "tls.server.not_after"
"""
Date/Time indicating when server certificate is no longer considered valid.
"""

TLS_SERVER_NOT_BEFORE: Final = "tls.server.not_before"
"""
Date/Time indicating when server certificate is first considered valid.
"""

TLS_SERVER_SUBJECT: Final = "tls.server.subject"
"""
Distinguished name of subject of the x.509 certificate presented by the server.
"""


class TlsProtocolNameValues(Enum):
    SSL = "ssl"
    """ssl."""
    TLS = "tls"
    """tls."""
