"""
oauthlib.oauth1
~~~~~~~~~~~~~~

This module is a wrapper for the most recent implementation of OAuth 1.0 Client
and Server classes.
"""
from .rfc5849 import (
    SIGNATURE_HMAC, SIGNATURE_HMAC_SHA1, SIGNATURE_HMAC_SHA256,
    SIGNATURE_HMAC_SHA512, SIGNATURE_PLAINTEXT, SIGNATURE_RSA,
    SIGNATURE_RSA_SHA1, SIGNATURE_RSA_SHA256, SIGNATURE_RSA_SHA512,
    SIGNATURE_TYPE_AUTH_HEADER, SIGNATURE_TYPE_BODY, SIGNATURE_TYPE_QUERY,
    Client,
)
from .rfc5849.endpoints import (
    AccessTokenEndpoint, AuthorizationEndpoint, RequestTokenEndpoint,
    ResourceEndpoint, SignatureOnlyEndpoint, WebApplicationServer,
)
from .rfc5849.errors import (
    InsecureTransportError, InvalidClientError, InvalidRequestError,
    InvalidSignatureMethodError, OAuth1Error,
)
from .rfc5849.request_validator import RequestValidator
