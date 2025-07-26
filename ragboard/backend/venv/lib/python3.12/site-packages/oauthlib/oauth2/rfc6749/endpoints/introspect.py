"""
oauthlib.oauth2.rfc6749.endpoint.introspect
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

An implementation of the OAuth 2.0 `Token Introspection`.

.. _`Token Introspection`: https://tools.ietf.org/html/rfc7662
"""
import json
import logging

from oauthlib.common import Request

from ..errors import OAuth2Error
from .base import BaseEndpoint, catch_errors_and_unavailability

log = logging.getLogger(__name__)


class IntrospectEndpoint(BaseEndpoint):

    """Introspect token endpoint.

   This endpoint defines a method to query an OAuth 2.0 authorization
   server to determine the active state of an OAuth 2.0 token and to
   determine meta-information about this token. OAuth 2.0 deployments
   can use this method to convey information about the authorization
   context of the token from the authorization server to the protected
   resource.

   To prevent the values of access tokens from leaking into
   server-side logs via query parameters, an authorization server
   offering token introspection MAY disallow the use of HTTP GET on
   the introspection endpoint and instead require the HTTP POST method
   to be used at the introspection endpoint.
   """

    valid_token_types = ('access_token', 'refresh_token')
    valid_request_methods = ('POST',)

    def __init__(self, request_validator, supported_token_types=None):
        BaseEndpoint.__init__(self)
        self.request_validator = request_validator
        self.supported_token_types = (
            supported_token_types or self.valid_token_types)

    @catch_errors_and_unavailability
    def create_introspect_response(self, uri, http_method='POST', body=None,
                                   headers=None):
        """Create introspect valid or invalid response

        If the authorization server is unable to determine the state
        of the token without additional information, it SHOULD return
        an introspection response indicating the token is not active
        as described in Section 2.2.
        """
        resp_headers = {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache',
        }
        request = Request(uri, http_method, body, headers)
        try:
            self.validate_introspect_request(request)
            log.debug('Token introspect valid for %r.', request)
        except OAuth2Error as e:
            log.debug('Client error during validation of %r. %r.', request, e)
            resp_headers.update(e.headers)
            return resp_headers, e.json, e.status_code

        claims = self.request_validator.introspect_token(
            request.token,
            request.token_type_hint,
            request
        )
        if claims is None:
            return resp_headers, json.dumps({'active': False}), 200
        if "active" in claims:
            claims.pop("active")
        return resp_headers, json.dumps(dict(active=True, **claims)), 200

    def validate_introspect_request(self, request):
        """Ensure the request is valid.

        The protected resource calls the introspection endpoint using
        an HTTP POST request with parameters sent as
        "application/x-www-form-urlencoded".

        * token REQUIRED.  The string value of the token.
        * token_type_hint OPTIONAL.

        A hint about the type of the token submitted for
        introspection.  The protected resource MAY pass this parameter to
        help the authorization server optimize the token lookup.  If the
        server is unable to locate the token using the given hint, it MUST
        extend its search across all of its supported token types.  An
        authorization server MAY ignore this parameter, particularly if it
        is able to detect the token type automatically.

        *  access_token: An Access Token as defined in [`RFC6749`], `section 1.4`_
        *  refresh_token: A Refresh Token as defined in [`RFC6749`], `section 1.5`_

        The introspection endpoint MAY accept other OPTIONAL
        parameters to provide further context to the query.  For
        instance, an authorization server may desire to know the IP
        address of the client accessing the protected resource to
        determine if the correct client is likely to be presenting the
        token.  The definition of this or any other parameters are
        outside the scope of this specification, to be defined by
        service documentation or extensions to this specification.

        .. _`section 1.4`: http://tools.ietf.org/html/rfc6749#section-1.4
        .. _`section 1.5`: http://tools.ietf.org/html/rfc6749#section-1.5
        .. _`RFC6749`: http://tools.ietf.org/html/rfc6749
        """
        self._raise_on_bad_method(request)
        self._raise_on_bad_post_request(request)
        self._raise_on_missing_token(request)
        self._raise_on_invalid_client(request)
        self._raise_on_unsupported_token(request)
