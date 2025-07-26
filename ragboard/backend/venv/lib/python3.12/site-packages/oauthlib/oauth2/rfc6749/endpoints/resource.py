"""
oauthlib.oauth2.rfc6749
~~~~~~~~~~~~~~~~~~~~~~~

This module is an implementation of various logic needed
for consuming and providing OAuth 2.0 RFC6749.
"""
import logging

from oauthlib.common import Request

from .base import BaseEndpoint, catch_errors_and_unavailability

log = logging.getLogger(__name__)


class ResourceEndpoint(BaseEndpoint):

    """Authorizes access to protected resources.

    The client accesses protected resources by presenting the access
    token to the resource server.  The resource server MUST validate the
    access token and ensure that it has not expired and that its scope
    covers the requested resource.  The methods used by the resource
    server to validate the access token (as well as any error responses)
    are beyond the scope of this specification but generally involve an
    interaction or coordination between the resource server and the
    authorization server::

        # For most cases, returning a 403 should suffice.

    The method in which the client utilizes the access token to
    authenticate with the resource server depends on the type of access
    token issued by the authorization server.  Typically, it involves
    using the HTTP "Authorization" request header field [RFC2617] with an
    authentication scheme defined by the specification of the access
    token type used, such as [RFC6750]::

        # Access tokens may also be provided in query and body
        https://example.com/protected?access_token=kjfch2345sdf   # Query
        access_token=sdf23409df   # Body
    """

    def __init__(self, default_token, token_types):
        BaseEndpoint.__init__(self)
        self._tokens = token_types
        self._default_token = default_token

    @property
    def default_token(self):
        return self._default_token

    @property
    def default_token_type_handler(self):
        return self.tokens.get(self.default_token)

    @property
    def tokens(self):
        return self._tokens

    @catch_errors_and_unavailability
    def verify_request(self, uri, http_method='GET', body=None, headers=None,
                       scopes=None):
        """Validate client, code etc, return body + headers"""
        request = Request(uri, http_method, body, headers)
        request.token_type = self.find_token_type(request)
        request.scopes = scopes
        token_type_handler = self.tokens.get(request.token_type,
                                             self.default_token_type_handler)
        log.debug('Dispatching token_type %s request to %r.',
                  request.token_type, token_type_handler)
        return token_type_handler.validate_request(request), request

    def find_token_type(self, request):
        """Token type identification.

        RFC 6749 does not provide a method for easily differentiating between
        different token types during protected resource access. We estimate
        the most likely token type (if any) by asking each known token type
        to give an estimation based on the request.
        """
        estimates = sorted(((t.estimate_type(request), n)
                            for n, t in self.tokens.items()), reverse=True)
        return estimates[0][1] if estimates else None
