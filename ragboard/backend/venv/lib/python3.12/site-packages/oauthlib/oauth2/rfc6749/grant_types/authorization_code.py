"""
oauthlib.oauth2.rfc6749.grant_types
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
"""
import base64
import hashlib
import json
import logging

from oauthlib import common

from .. import errors
from .base import GrantTypeBase

log = logging.getLogger(__name__)


def code_challenge_method_s256(verifier, challenge):
    """
    If the "code_challenge_method" from `Section 4.3`_ was "S256", the
    received "code_verifier" is hashed by SHA-256, base64url-encoded, and
    then compared to the "code_challenge", i.e.:

    BASE64URL-ENCODE(SHA256(ASCII(code_verifier))) == code_challenge

    How to implement a base64url-encoding
    function without padding, based upon the standard base64-encoding
    function that uses padding.

    To be concrete, example C# code implementing these functions is shown
    below.  Similar code could be used in other languages.

    static string base64urlencode(byte [] arg)
    {
        string s = Convert.ToBase64String(arg); // Regular base64 encoder
        s = s.Split('=')[0]; // Remove any trailing '='s
        s = s.Replace('+', '-'); // 62nd char of encoding
        s = s.Replace('/', '_'); // 63rd char of encoding
        return s;
    }

    In python urlsafe_b64encode is already replacing '+' and '/', but preserve
    the trailing '='. So we have to remove it.

    .. _`Section 4.3`: https://tools.ietf.org/html/rfc7636#section-4.3
    """
    return base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).decode().rstrip('=') == challenge


def code_challenge_method_plain(verifier, challenge):
    """
    If the "code_challenge_method" from `Section 4.3`_ was "plain", they are
    compared directly, i.e.:

    code_verifier == code_challenge.

    .. _`Section 4.3`: https://tools.ietf.org/html/rfc7636#section-4.3
    """
    return verifier == challenge


class AuthorizationCodeGrant(GrantTypeBase):

    """`Authorization Code Grant`_

    The authorization code grant type is used to obtain both access
    tokens and refresh tokens and is optimized for confidential clients.
    Since this is a redirection-based flow, the client must be capable of
    interacting with the resource owner's user-agent (typically a web
    browser) and capable of receiving incoming requests (via redirection)
    from the authorization server::

        +----------+
        | Resource |
        |   Owner  |
        |          |
        +----------+
             ^
             |
            (B)
        +----|-----+          Client Identifier      +---------------+
        |         -+----(A)-- & Redirection URI ---->|               |
        |  User-   |                                 | Authorization |
        |  Agent  -+----(B)-- User authenticates --->|     Server    |
        |          |                                 |               |
        |         -+----(C)-- Authorization Code ---<|               |
        +-|----|---+                                 +---------------+
          |    |                                         ^      v
         (A)  (C)                                        |      |
          |    |                                         |      |
          ^    v                                         |      |
        +---------+                                      |      |
        |         |>---(D)-- Authorization Code ---------'      |
        |  Client |          & Redirection URI                  |
        |         |                                             |
        |         |<---(E)----- Access Token -------------------'
        +---------+       (w/ Optional Refresh Token)

    Note: The lines illustrating steps (A), (B), and (C) are broken into
    two parts as they pass through the user-agent.

    Figure 3: Authorization Code Flow

    The flow illustrated in Figure 3 includes the following steps:

    (A)  The client initiates the flow by directing the resource owner's
         user-agent to the authorization endpoint.  The client includes
         its client identifier, requested scope, local state, and a
         redirection URI to which the authorization server will send the
         user-agent back once access is granted (or denied).

    (B)  The authorization server authenticates the resource owner (via
         the user-agent) and establishes whether the resource owner
         grants or denies the client's access request.

    (C)  Assuming the resource owner grants access, the authorization
         server redirects the user-agent back to the client using the
         redirection URI provided earlier (in the request or during
         client registration).  The redirection URI includes an
         authorization code and any local state provided by the client
         earlier.

    (D)  The client requests an access token from the authorization
         server's token endpoint by including the authorization code
         received in the previous step.  When making the request, the
         client authenticates with the authorization server.  The client
         includes the redirection URI used to obtain the authorization
         code for verification.

    (E)  The authorization server authenticates the client, validates the
         authorization code, and ensures that the redirection URI
         received matches the URI used to redirect the client in
         step (C).  If valid, the authorization server responds back with
         an access token and, optionally, a refresh token.

    OAuth 2.0 public clients utilizing the Authorization Code Grant are
    susceptible to the authorization code interception attack.

    A technique to mitigate against the threat through the use of Proof Key for Code
    Exchange (PKCE, pronounced "pixy") is implemented in the current oauthlib
    implementation.

    .. _`Authorization Code Grant`: https://tools.ietf.org/html/rfc6749#section-4.1
    .. _`PKCE`: https://tools.ietf.org/html/rfc7636
    """

    default_response_mode = 'query'
    response_types = ['code']

    # This dict below is private because as RFC mention it:
    # "S256" is Mandatory To Implement (MTI) on the server.
    #
    _code_challenge_methods = {
        'plain': code_challenge_method_plain,
        'S256': code_challenge_method_s256
    }

    def create_authorization_code(self, request):
        """
        Generates an authorization grant represented as a dictionary.

        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        """
        grant = {'code': common.generate_token()}
        if hasattr(request, 'state') and request.state:
            grant['state'] = request.state
        log.debug('Created authorization code grant %r for request %r.',
                  grant, request)
        return grant

    def create_authorization_response(self, request, token_handler):
        """
        The client constructs the request URI by adding the following
        parameters to the query component of the authorization endpoint URI
        using the "application/x-www-form-urlencoded" format, per `Appendix B`_:

        response_type
                REQUIRED.  Value MUST be set to "code" for standard OAuth2
                authorization flow.  For OpenID Connect it must be one of
                "code token", "code id_token", or "code token id_token" - we
                essentially test that "code" appears in the response_type.
        client_id
                REQUIRED.  The client identifier as described in `Section 2.2`_.
        redirect_uri
                OPTIONAL.  As described in `Section 3.1.2`_.
        scope
                OPTIONAL.  The scope of the access request as described by
                `Section 3.3`_.
        state
                RECOMMENDED.  An opaque value used by the client to maintain
                state between the request and callback.  The authorization
                server includes this value when redirecting the user-agent back
                to the client.  The parameter SHOULD be used for preventing
                cross-site request forgery as described in `Section 10.12`_.

        The client directs the resource owner to the constructed URI using an
        HTTP redirection response, or by other means available to it via the
        user-agent.

        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :param token_handler: A token handler instance, for example of type
                              oauthlib.oauth2.BearerToken.
        :returns: headers, body, status
        :raises: FatalClientError on invalid redirect URI or client id.

        A few examples::

            >>> from your_validator import your_validator
            >>> request = Request('https://example.com/authorize?client_id=valid'
            ...                   '&redirect_uri=http%3A%2F%2Fclient.com%2F')
            >>> from oauthlib.common import Request
            >>> from oauthlib.oauth2 import AuthorizationCodeGrant, BearerToken
            >>> token = BearerToken(your_validator)
            >>> grant = AuthorizationCodeGrant(your_validator)
            >>> request.scopes = ['authorized', 'in', 'some', 'form']
            >>> grant.create_authorization_response(request, token)
            (u'http://client.com/?error=invalid_request&error_description=Missing+response_type+parameter.', None, None, 400)
            >>> request = Request('https://example.com/authorize?client_id=valid'
            ...                   '&redirect_uri=http%3A%2F%2Fclient.com%2F'
            ...                   '&response_type=code')
            >>> request.scopes = ['authorized', 'in', 'some', 'form']
            >>> grant.create_authorization_response(request, token)
            (u'http://client.com/?code=u3F05aEObJuP2k7DordviIgW5wl52N', None, None, 200)
            >>> # If the client id or redirect uri fails validation
            >>> grant.create_authorization_response(request, token)
            Traceback (most recent call last):
                File "<stdin>", line 1, in <module>
                File "oauthlib/oauth2/rfc6749/grant_types.py", line 515, in create_authorization_response
                    >>> grant.create_authorization_response(request, token)
                File "oauthlib/oauth2/rfc6749/grant_types.py", line 591, in validate_authorization_request
            oauthlib.oauth2.rfc6749.errors.InvalidClientIdError

        .. _`Appendix B`: https://tools.ietf.org/html/rfc6749#appendix-B
        .. _`Section 2.2`: https://tools.ietf.org/html/rfc6749#section-2.2
        .. _`Section 3.1.2`: https://tools.ietf.org/html/rfc6749#section-3.1.2
        .. _`Section 3.3`: https://tools.ietf.org/html/rfc6749#section-3.3
        .. _`Section 10.12`: https://tools.ietf.org/html/rfc6749#section-10.12
        """
        try:
            self.validate_authorization_request(request)
            log.debug('Pre resource owner authorization validation ok for %r.',
                      request)

        # If the request fails due to a missing, invalid, or mismatching
        # redirection URI, or if the client identifier is missing or invalid,
        # the authorization server SHOULD inform the resource owner of the
        # error and MUST NOT automatically redirect the user-agent to the
        # invalid redirection URI.
        except errors.FatalClientError as e:
            log.debug('Fatal client error during validation of %r. %r.',
                      request, e)
            raise

        # If the resource owner denies the access request or if the request
        # fails for reasons other than a missing or invalid redirection URI,
        # the authorization server informs the client by adding the following
        # parameters to the query component of the redirection URI using the
        # "application/x-www-form-urlencoded" format, per Appendix B:
        # https://tools.ietf.org/html/rfc6749#appendix-B
        except errors.OAuth2Error as e:
            log.debug('Client error during validation of %r. %r.', request, e)
            request.redirect_uri = request.redirect_uri or self.error_uri
            redirect_uri = common.add_params_to_uri(
                request.redirect_uri, e.twotuples,
                fragment=request.response_mode == "fragment")
            return {'Location': redirect_uri}, None, 302

        grant = self.create_authorization_code(request)
        for modifier in self._code_modifiers:
            grant = modifier(grant, token_handler, request)
        if 'access_token' in grant:
            self.request_validator.save_token(grant, request)
        log.debug('Saving grant %r for %r.', grant, request)
        self.request_validator.save_authorization_code(
            request.client_id, grant, request)
        return self.prepare_authorization_response(
            request, grant, {}, None, 302)

    def create_token_response(self, request, token_handler):
        """Validate the authorization code.

        The client MUST NOT use the authorization code more than once. If an
        authorization code is used more than once, the authorization server
        MUST deny the request and SHOULD revoke (when possible) all tokens
        previously issued based on that authorization code. The authorization
        code is bound to the client identifier and redirection URI.

        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :param token_handler: A token handler instance, for example of type
                              oauthlib.oauth2.BearerToken.

        """
        headers = self._get_default_headers()
        try:
            self.validate_token_request(request)
            log.debug('Token request validation ok for %r.', request)
        except errors.OAuth2Error as e:
            log.debug('Client error during validation of %r. %r.', request, e)
            headers.update(e.headers)
            return headers, e.json, e.status_code

        token = token_handler.create_token(request, refresh_token=self.refresh_token)

        for modifier in self._token_modifiers:
            token = modifier(token, token_handler, request)

        self.request_validator.save_token(token, request)
        self.request_validator.invalidate_authorization_code(
            request.client_id, request.code, request)
        headers.update(self._create_cors_headers(request))
        return headers, json.dumps(token), 200

    def validate_authorization_request(self, request):
        """Check the authorization request for normal and fatal errors.

        A normal error could be a missing response_type parameter or the client
        attempting to access scope it is not allowed to ask authorization for.
        Normal errors can safely be included in the redirection URI and
        sent back to the client.

        Fatal errors occur when the client_id or redirect_uri is invalid or
        missing. These must be caught by the provider and handled, how this
        is done is outside of the scope of OAuthLib but showing an error
        page describing the issue is a good idea.

        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        """

        # First check for fatal errors

        # If the request fails due to a missing, invalid, or mismatching
        # redirection URI, or if the client identifier is missing or invalid,
        # the authorization server SHOULD inform the resource owner of the
        # error and MUST NOT automatically redirect the user-agent to the
        # invalid redirection URI.

        # First check duplicate parameters
        for param in ('client_id', 'response_type', 'redirect_uri', 'scope', 'state'):
            try:
                duplicate_params = request.duplicate_params
            except ValueError:
                raise errors.InvalidRequestFatalError(description='Unable to parse query string', request=request)
            if param in duplicate_params:
                raise errors.InvalidRequestFatalError(description='Duplicate %s parameter.' % param, request=request)

        # REQUIRED. The client identifier as described in Section 2.2.
        # https://tools.ietf.org/html/rfc6749#section-2.2
        if not request.client_id:
            raise errors.MissingClientIdError(request=request)

        if not self.request_validator.validate_client_id(request.client_id, request):
            raise errors.InvalidClientIdError(request=request)

        # OPTIONAL. As described in Section 3.1.2.
        # https://tools.ietf.org/html/rfc6749#section-3.1.2
        log.debug('Validating redirection uri %s for client %s.',
                  request.redirect_uri, request.client_id)

        # OPTIONAL. As described in Section 3.1.2.
        # https://tools.ietf.org/html/rfc6749#section-3.1.2
        self._handle_redirects(request)

        # Then check for normal errors.

        # If the resource owner denies the access request or if the request
        # fails for reasons other than a missing or invalid redirection URI,
        # the authorization server informs the client by adding the following
        # parameters to the query component of the redirection URI using the
        # "application/x-www-form-urlencoded" format, per Appendix B.
        # https://tools.ietf.org/html/rfc6749#appendix-B

        # Note that the correct parameters to be added are automatically
        # populated through the use of specific exceptions.

        request_info = {}
        for validator in self.custom_validators.pre_auth:
            request_info.update(validator(request))

        # REQUIRED.
        if request.response_type is None:
            raise errors.MissingResponseTypeError(request=request)
        # Value MUST be set to "code" or one of the OpenID authorization code including
        # response_types "code token", "code id_token", "code token id_token"
        elif 'code' not in request.response_type and request.response_type != 'none':
            raise errors.UnsupportedResponseTypeError(request=request)

        if not self.request_validator.validate_response_type(request.client_id,
                                                             request.response_type,
                                                             request.client, request):

            log.debug('Client %s is not authorized to use response_type %s.',
                      request.client_id, request.response_type)
            raise errors.UnauthorizedClientError(request=request)

        # OPTIONAL. Validate PKCE request or reply with "error"/"invalid_request"
        # https://tools.ietf.org/html/rfc6749#section-4.4.1
        if self.request_validator.is_pkce_required(request.client_id, request) is True and request.code_challenge is None:
            raise errors.MissingCodeChallengeError(request=request)

        if request.code_challenge is not None:
            request_info["code_challenge"] = request.code_challenge

            # OPTIONAL, defaults to "plain" if not present in the request.
            if request.code_challenge_method is None:
                request.code_challenge_method = "plain"

            if request.code_challenge_method not in self._code_challenge_methods:
                raise errors.UnsupportedCodeChallengeMethodError(request=request)
            request_info["code_challenge_method"] = request.code_challenge_method

        # OPTIONAL. The scope of the access request as described by Section 3.3
        # https://tools.ietf.org/html/rfc6749#section-3.3
        self.validate_scopes(request)

        request_info.update({
            'client_id': request.client_id,
            'redirect_uri': request.redirect_uri,
            'response_type': request.response_type,
            'state': request.state,
            'request': request
        })

        for validator in self.custom_validators.post_auth:
            request_info.update(validator(request))

        return request.scopes, request_info

    def validate_token_request(self, request):
        """
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        """
        # REQUIRED. Value MUST be set to "authorization_code".
        if request.grant_type not in ('authorization_code', 'openid'):
            raise errors.UnsupportedGrantTypeError(request=request)

        for validator in self.custom_validators.pre_token:
            validator(request)

        if request.code is None:
            raise errors.InvalidRequestError(
                description='Missing code parameter.', request=request)

        for param in ('client_id', 'grant_type', 'redirect_uri'):
            if param in request.duplicate_params:
                raise errors.InvalidRequestError(description='Duplicate %s parameter.' % param,
                                                 request=request)

        if self.request_validator.client_authentication_required(request):
            # If the client type is confidential or the client was issued client
            # credentials (or assigned other authentication requirements), the
            # client MUST authenticate with the authorization server as described
            # in Section 3.2.1.
            # https://tools.ietf.org/html/rfc6749#section-3.2.1
            if not self.request_validator.authenticate_client(request):
                log.debug('Client authentication failed, %r.', request)
                raise errors.InvalidClientError(request=request)
        elif not self.request_validator.authenticate_client_id(request.client_id, request):
            # REQUIRED, if the client is not authenticating with the
            # authorization server as described in Section 3.2.1.
            # https://tools.ietf.org/html/rfc6749#section-3.2.1
            log.debug('Client authentication failed, %r.', request)
            raise errors.InvalidClientError(request=request)

        if not hasattr(request.client, 'client_id'):
            raise NotImplementedError('Authenticate client must set the '
                                      'request.client.client_id attribute '
                                      'in authenticate_client.')

        request.client_id = request.client_id or request.client.client_id

        # Ensure client is authorized use of this grant type
        self.validate_grant_type(request)

        # REQUIRED. The authorization code received from the
        # authorization server.
        if not self.request_validator.validate_code(request.client_id,
                                                    request.code, request.client, request):
            log.debug('Client, %r (%r), is not allowed access to scopes %r.',
                      request.client_id, request.client, request.scopes)
            raise errors.InvalidGrantError(request=request)

        # OPTIONAL. Validate PKCE code_verifier
        challenge = self.request_validator.get_code_challenge(request.code, request)

        if challenge is not None:
            if request.code_verifier is None:
                raise errors.MissingCodeVerifierError(request=request)

            challenge_method = self.request_validator.get_code_challenge_method(request.code, request)
            if challenge_method is None:
                raise errors.InvalidGrantError(request=request, description="Challenge method not found")

            if challenge_method not in self._code_challenge_methods:
                raise errors.ServerError(
                    description="code_challenge_method {} is not supported.".format(challenge_method),
                    request=request
                )

            if not self.validate_code_challenge(challenge,
                                                challenge_method,
                                                request.code_verifier):
                log.debug('request provided a invalid code_verifier.')
                raise errors.InvalidGrantError(request=request)
        elif self.request_validator.is_pkce_required(request.client_id, request) is True:
            if request.code_verifier is None:
                raise errors.MissingCodeVerifierError(request=request)
            raise errors.InvalidGrantError(request=request, description="Challenge not found")

        for attr in ('user', 'scopes'):
            if getattr(request, attr, None) is None:
                log.debug('request.%s was not set on code validation.', attr)

        # REQUIRED, if the "redirect_uri" parameter was included in the
        # authorization request as described in Section 4.1.1, and their
        # values MUST be identical.
        if request.redirect_uri is None:
            request.using_default_redirect_uri = True
            request.redirect_uri = self.request_validator.get_default_redirect_uri(
                request.client_id, request)
            log.debug('Using default redirect_uri %s.', request.redirect_uri)
            if not request.redirect_uri:
                raise errors.MissingRedirectURIError(request=request)
        else:
            request.using_default_redirect_uri = False
            log.debug('Using provided redirect_uri %s', request.redirect_uri)

        if not self.request_validator.confirm_redirect_uri(request.client_id, request.code,
                                                           request.redirect_uri, request.client,
                                                           request):
            log.debug('Redirect_uri (%r) invalid for client %r (%r).',
                      request.redirect_uri, request.client_id, request.client)
            raise errors.MismatchingRedirectURIError(request=request)

        for validator in self.custom_validators.post_token:
            validator(request)

    def validate_code_challenge(self, challenge, challenge_method, verifier):
        if challenge_method in self._code_challenge_methods:
            return self._code_challenge_methods[challenge_method](verifier, challenge)
        raise NotImplementedError('Unknown challenge_method %s' % challenge_method)
