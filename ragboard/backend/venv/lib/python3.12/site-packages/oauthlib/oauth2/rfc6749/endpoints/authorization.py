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


class AuthorizationEndpoint(BaseEndpoint):

    """Authorization endpoint - used by the client to obtain authorization
    from the resource owner via user-agent redirection.

    The authorization endpoint is used to interact with the resource
    owner and obtain an authorization grant.  The authorization server
    MUST first verify the identity of the resource owner.  The way in
    which the authorization server authenticates the resource owner (e.g.
    username and password login, session cookies) is beyond the scope of
    this specification.

    The endpoint URI MAY include an "application/x-www-form-urlencoded"
    formatted (per `Appendix B`_) query component,
    which MUST be retained when adding additional query parameters.  The
    endpoint URI MUST NOT include a fragment component::

        https://example.com/path?query=component             # OK
        https://example.com/path?query=component#fragment    # Not OK

    Since requests to the authorization endpoint result in user
    authentication and the transmission of clear-text credentials (in the
    HTTP response), the authorization server MUST require the use of TLS
    as described in Section 1.6 when sending requests to the
    authorization endpoint::

        # We will deny any request which URI schema is not with https

    The authorization server MUST support the use of the HTTP "GET"
    method [RFC2616] for the authorization endpoint, and MAY support the
    use of the "POST" method as well::

        # HTTP method is currently not enforced

    Parameters sent without a value MUST be treated as if they were
    omitted from the request.  The authorization server MUST ignore
    unrecognized request parameters.  Request and response parameters
    MUST NOT be included more than once::

        # Enforced through the design of oauthlib.common.Request

    .. _`Appendix B`: https://tools.ietf.org/html/rfc6749#appendix-B
    """

    def __init__(self, default_response_type, default_token_type,
                 response_types):
        BaseEndpoint.__init__(self)
        self._response_types = response_types
        self._default_response_type = default_response_type
        self._default_token_type = default_token_type

    @property
    def response_types(self):
        return self._response_types

    @property
    def default_response_type(self):
        return self._default_response_type

    @property
    def default_response_type_handler(self):
        return self.response_types.get(self.default_response_type)

    @property
    def default_token_type(self):
        return self._default_token_type

    @catch_errors_and_unavailability
    def create_authorization_response(self, uri, http_method='GET', body=None,
                                      headers=None, scopes=None, credentials=None):
        """Extract response_type and route to the designated handler."""
        request = Request(
            uri, http_method=http_method, body=body, headers=headers)
        request.scopes = scopes
        # TODO: decide whether this should be a required argument
        request.user = None     # TODO: explain this in docs
        for k, v in (credentials or {}).items():
            setattr(request, k, v)
        response_type_handler = self.response_types.get(
            request.response_type, self.default_response_type_handler)
        log.debug('Dispatching response_type %s request to %r.',
                  request.response_type, response_type_handler)
        return response_type_handler.create_authorization_response(
            request, self.default_token_type)

    @catch_errors_and_unavailability
    def validate_authorization_request(self, uri, http_method='GET', body=None,
                                       headers=None):
        """Extract response_type and route to the designated handler."""
        request = Request(
            uri, http_method=http_method, body=body, headers=headers)

        request.scopes = utils.scope_to_list(request.scope)

        response_type_handler = self.response_types.get(
            request.response_type, self.default_response_type_handler)
        return response_type_handler.validate_authorization_request(request)
