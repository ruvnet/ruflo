"""
oauthlib.oauth2.rfc6749
~~~~~~~~~~~~~~~~~~~~~~~

This module is an implementation of various logic needed
for consuming and providing OAuth 2.0 RFC6749.
"""
import logging

from oauthlib.common import Request
from oauthlib.oauth2.rfc6749 import utils

from .base import BaseEndpoint, catch_errors_and_unavailability

log = logging.getLogger(__name__)


class TokenEndpoint(BaseEndpoint):

    """Token issuing endpoint.

    The token endpoint is used by the client to obtain an access token by
    presenting its authorization grant or refresh token.  The token
    endpoint is used with every authorization grant except for the
    implicit grant type (since an access token is issued directly).

    The means through which the client obtains the location of the token
    endpoint are beyond the scope of this specification, but the location
    is typically provided in the service documentation.

    The endpoint URI MAY include an "application/x-www-form-urlencoded"
    formatted (per `Appendix B`_) query component,
    which MUST be retained when adding additional query parameters.  The
    endpoint URI MUST NOT include a fragment component::

        https://example.com/path?query=component             # OK
        https://example.com/path?query=component#fragment    # Not OK

    Since requests to the token endpoint result in the transmission of
    clear-text credentials (in the HTTP request and response), the
    authorization server MUST require the use of TLS as described in
    Section 1.6 when sending requests to the token endpoint::

        # We will deny any request which URI schema is not with https

    The client MUST use the HTTP "POST" method when making access token
    requests::

        # HTTP method is currently not enforced

    Parameters sent without a value MUST be treated as if they were
    omitted from the request.  The authorization server MUST ignore
    unrecognized request parameters.  Request and response parameters
    MUST NOT be included more than once::

        # Delegated to each grant type.

    .. _`Appendix B`: https://tools.ietf.org/html/rfc6749#appendix-B
    """

    valid_request_methods = ('POST',)

    def __init__(self, default_grant_type, default_token_type, grant_types):
        BaseEndpoint.__init__(self)
        self._grant_types = grant_types
        self._default_token_type = default_token_type
        self._default_grant_type = default_grant_type

    @property
    def grant_types(self):
        return self._grant_types

    @property
    def default_grant_type(self):
        return self._default_grant_type

    @property
    def default_grant_type_handler(self):
        return self.grant_types.get(self.default_grant_type)

    @property
    def default_token_type(self):
        return self._default_token_type

    @catch_errors_and_unavailability
    def create_token_response(self, uri, http_method='POST', body=None,
                              headers=None, credentials=None, grant_type_for_scope=None,
                              claims=None):
        """Extract grant_type and route to the designated handler."""
        request = Request(
            uri, http_method=http_method, body=body, headers=headers)
        self.validate_token_request(request)
        # 'scope' is an allowed Token Request param in both the "Resource Owner Password Credentials Grant"
        # and "Client Credentials Grant" flows
        # https://tools.ietf.org/html/rfc6749#section-4.3.2
        # https://tools.ietf.org/html/rfc6749#section-4.4.2
        request.scopes = utils.scope_to_list(request.scope)

        request.extra_credentials = credentials
        if grant_type_for_scope:
            request.grant_type = grant_type_for_scope

        # OpenID Connect claims, if provided.  The server using oauthlib might choose
        # to implement the claims parameter of the Authorization Request.  In this case
        # it should retrieve those claims and pass them via the claims argument here,
        # as a dict.
        if claims:
            request.claims = claims

        grant_type_handler = self.grant_types.get(request.grant_type,
                                                  self.default_grant_type_handler)
        log.debug('Dispatching grant_type %s request to %r.',
                  request.grant_type, grant_type_handler)
        return grant_type_handler.create_token_response(
            request, self.default_token_type)

    def validate_token_request(self, request):
        self._raise_on_bad_method(request)
        self._raise_on_bad_post_request(request)
