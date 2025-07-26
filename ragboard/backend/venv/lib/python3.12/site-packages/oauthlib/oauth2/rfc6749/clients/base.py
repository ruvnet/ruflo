# -*- coding: utf-8 -*-
"""
oauthlib.oauth2.rfc6749
~~~~~~~~~~~~~~~~~~~~~~~

This module is an implementation of various logic needed
for consuming OAuth 2.0 RFC6749.
"""
import base64
import hashlib
import time
import warnings

from oauthlib.common import UNICODE_ASCII_CHARACTER_SET, generate_token
from oauthlib.oauth2.rfc6749 import tokens
from oauthlib.oauth2.rfc6749.errors import (
    InsecureTransportError, TokenExpiredError,
)
from oauthlib.oauth2.rfc6749.parameters import (
    parse_expires,
    parse_token_response, prepare_token_request,
    prepare_token_revocation_request,
)
from oauthlib.oauth2.rfc6749.utils import is_secure_transport

AUTH_HEADER = 'auth_header'
URI_QUERY = 'query'
BODY = 'body'

FORM_ENC_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded'
}


class Client:
    """Base OAuth2 client responsible for access token management.

    This class also acts as a generic interface providing methods common to all
    client types such as ``prepare_authorization_request`` and
    ``prepare_token_revocation_request``. The ``prepare_x_request`` methods are
    the recommended way of interacting with clients (as opposed to the abstract
    prepare uri/body/etc methods). They are recommended over the older set
    because they are easier to use (more consistent) and add a few additional
    security checks, such as HTTPS and state checking.

    Some of these methods require further implementation only provided by the
    specific purpose clients such as
    :py:class:`oauthlib.oauth2.MobileApplicationClient` and thus you should always
    seek to use the client class matching the OAuth workflow you need. For
    Python, this is usually :py:class:`oauthlib.oauth2.WebApplicationClient`.

    """
    refresh_token_key = 'refresh_token'

    def __init__(self, client_id,
                 default_token_placement=AUTH_HEADER,
                 token_type='Bearer',
                 access_token=None,
                 refresh_token=None,
                 mac_key=None,
                 mac_algorithm=None,
                 token=None,
                 scope=None,
                 state=None,
                 redirect_url=None,
                 state_generator=generate_token,
                 code_verifier=None,
                 code_challenge=None,
                 code_challenge_method=None,
                 **kwargs):
        """Initialize a client with commonly used attributes.

        :param client_id: Client identifier given by the OAuth provider upon
        registration.

        :param default_token_placement: Tokens can be supplied in the Authorization
        header (default), the URL query component (``query``) or the request
        body (``body``).

        :param token_type: OAuth 2 token type. Defaults to Bearer. Change this
        if you specify the ``access_token`` parameter and know it is of a
        different token type, such as a MAC, JWT or SAML token. Can
        also be supplied as ``token_type`` inside the ``token`` dict parameter.

        :param access_token: An access token (string) used to authenticate
        requests to protected resources. Can also be supplied inside the
        ``token`` dict parameter.

        :param refresh_token: A refresh token (string) used to refresh expired
        tokens. Can also be supplied inside the ``token`` dict parameter.

        :param mac_key: Encryption key used with MAC tokens.

        :param mac_algorithm:  Hashing algorithm for MAC tokens.

        :param token: A dict of token attributes such as ``access_token``,
        ``token_type`` and ``expires_at``.

        :param scope: A list of default scopes to request authorization for.

        :param state: A CSRF protection string used during authorization.

        :param redirect_url: The redirection endpoint on the client side to which
        the user returns after authorization.

        :param state_generator: A no argument state generation callable. Defaults
        to :py:meth:`oauthlib.common.generate_token`.

        :param code_verifier: PKCE parameter. A cryptographically random string that is used to correlate the
        authorization request to the token request.

        :param code_challenge: PKCE parameter. A challenge derived from the code verifier that is sent in the
        authorization request, to be verified against later.

        :param code_challenge_method: PKCE parameter. A method that was used to derive code challenge.
        Defaults to "plain" if not present in the request.
        """

        self.client_id = client_id
        self.default_token_placement = default_token_placement
        self.token_type = token_type
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.mac_key = mac_key
        self.mac_algorithm = mac_algorithm
        self.token = token or {}
        self.scope = scope
        self.state_generator = state_generator
        self.state = state
        self.redirect_url = redirect_url
        self.code_verifier = code_verifier
        self.code_challenge = code_challenge
        self.code_challenge_method = code_challenge_method
        self.code = None
        self.expires_in = None
        self._expires_at = None
        self.populate_token_attributes(self.token)

    @property
    def token_types(self):
        """Supported token types and their respective methods

        Additional tokens can be supported by extending this dictionary.

        The Bearer token spec is stable and safe to use.

        The MAC token spec is not yet stable and support for MAC tokens
        is experimental and currently matching version 00 of the spec.
        """
        return {
            'Bearer': self._add_bearer_token,
            'MAC': self._add_mac_token
        }

    def prepare_request_uri(self, *args, **kwargs):
        """Abstract method used to create request URIs."""
        raise NotImplementedError("Must be implemented by inheriting classes.")

    def prepare_request_body(self, *args, **kwargs):
        """Abstract method used to create request bodies."""
        raise NotImplementedError("Must be implemented by inheriting classes.")

    def parse_request_uri_response(self, *args, **kwargs):
        """Abstract method used to parse redirection responses."""
        raise NotImplementedError("Must be implemented by inheriting classes.")

    def add_token(self, uri, http_method='GET', body=None, headers=None,
                  token_placement=None, **kwargs):
        """Add token to the request uri, body or authorization header.

        The access token type provides the client with the information
        required to successfully utilize the access token to make a protected
        resource request (along with type-specific attributes).  The client
        MUST NOT use an access token if it does not understand the token
        type.

        For example, the "bearer" token type defined in
        [`I-D.ietf-oauth-v2-bearer`_] is utilized by simply including the access
        token string in the request:

        .. code-block:: http

            GET /resource/1 HTTP/1.1
            Host: example.com
            Authorization: Bearer mF_9.B5f-4.1JqM

        while the "mac" token type defined in [`I-D.ietf-oauth-v2-http-mac`_] is
        utilized by issuing a MAC key together with the access token which is
        used to sign certain components of the HTTP requests:

        .. code-block:: http

            GET /resource/1 HTTP/1.1
            Host: example.com
            Authorization: MAC id="h480djs93hd8",
                                nonce="274312:dj83hs9s",
                                mac="kDZvddkndxvhGRXZhvuDjEWhGeE="

        .. _`I-D.ietf-oauth-v2-bearer`: https://tools.ietf.org/html/rfc6749#section-12.2
        .. _`I-D.ietf-oauth-v2-http-mac`: https://tools.ietf.org/html/rfc6749#section-12.2
        """
        if not is_secure_transport(uri):
            raise InsecureTransportError()

        token_placement = token_placement or self.default_token_placement

        case_insensitive_token_types = {
            k.lower(): v for k, v in self.token_types.items()}
        if self.token_type.lower() not in case_insensitive_token_types:
            raise ValueError("Unsupported token type: %s" % self.token_type)

        if not (self.access_token or self.token.get('access_token')):
            raise ValueError("Missing access token.")

        if self._expires_at and self._expires_at < time.time():
            raise TokenExpiredError()

        return case_insensitive_token_types[self.token_type.lower()](uri, http_method, body,
                                                                     headers, token_placement, **kwargs)

    def prepare_authorization_request(self, authorization_url, state=None,
                                      redirect_url=None, scope=None, **kwargs):
        """Prepare the authorization request.

        This is the first step in many OAuth flows in which the user is
        redirected to a certain authorization URL. This method adds
        required parameters to the authorization URL.

        :param authorization_url: Provider authorization endpoint URL.
        :param state: CSRF protection string. Will be automatically created if
            not provided. The generated state is available via the ``state``
            attribute. Clients should verify that the state is unchanged and
            present in the authorization response. This verification is done
            automatically if using the ``authorization_response`` parameter
            with ``prepare_token_request``.
        :param redirect_url: Redirect URL to which the user will be returned
            after authorization. Must be provided unless previously setup with
            the provider. If provided then it must also be provided in the
            token request.
        :param scope: List of scopes to request. Must be equal to
            or a subset of the scopes granted when obtaining the refresh
            token. If none is provided, the ones provided in the constructor are
            used.
        :param kwargs: Additional parameters to included in the request.
        :returns: The prepared request tuple with (url, headers, body).
        """
        if not is_secure_transport(authorization_url):
            raise InsecureTransportError()

        self.state = state or self.state_generator()
        self.redirect_url = redirect_url or self.redirect_url
        # do not assign scope to self automatically anymore
        scope = self.scope if scope is None else scope
        auth_url = self.prepare_request_uri(
            authorization_url, redirect_uri=self.redirect_url,
            scope=scope, state=self.state, **kwargs)
        return auth_url, FORM_ENC_HEADERS, ''

    def prepare_token_request(self, token_url, authorization_response=None,
                              redirect_url=None, state=None, body='', **kwargs):
        """Prepare a token creation request.

        Note that these requests usually require client authentication, either
        by including client_id or a set of provider specific authentication
        credentials.

        :param token_url: Provider token creation endpoint URL.
        :param authorization_response: The full redirection URL string, i.e.
            the location to which the user was redirected after successful
            authorization. Used to mine credentials needed to obtain a token
            in this step, such as authorization code.
        :param redirect_url: The redirect_url supplied with the authorization
            request (if there was one).
        :param state:
        :param body: Existing request body (URL encoded string) to embed parameters
                     into. This may contain extra parameters. Default ''.
        :param kwargs: Additional parameters to included in the request.
        :returns: The prepared request tuple with (url, headers, body).
        """
        if not is_secure_transport(token_url):
            raise InsecureTransportError()

        state = state or self.state
        if authorization_response:
            self.parse_request_uri_response(
                authorization_response, state=state)
        self.redirect_url = redirect_url or self.redirect_url
        body = self.prepare_request_body(body=body,
                                         redirect_uri=self.redirect_url, **kwargs)

        return token_url, FORM_ENC_HEADERS, body

    def prepare_refresh_token_request(self, token_url, refresh_token=None,
                                      body='', scope=None, **kwargs):
        """Prepare an access token refresh request.

        Expired access tokens can be replaced by new access tokens without
        going through the OAuth dance if the client obtained a refresh token.
        This refresh token and authentication credentials can be used to
        obtain a new access token, and possibly a new refresh token.

        :param token_url: Provider token refresh endpoint URL.
        :param refresh_token: Refresh token string.
        :param body: Existing request body (URL encoded string) to embed parameters
            into. This may contain extra parameters. Default ''.
        :param scope: List of scopes to request. Must be equal to
            or a subset of the scopes granted when obtaining the refresh
            token. If none is provided, the ones provided in the constructor are
            used.
        :param kwargs: Additional parameters to included in the request.
        :returns: The prepared request tuple with (url, headers, body).
        """
        if not is_secure_transport(token_url):
            raise InsecureTransportError()

        # do not assign scope to self automatically anymore
        scope = self.scope if scope is None else scope
        body = self.prepare_refresh_body(body=body,
                                         refresh_token=refresh_token, scope=scope, **kwargs)
        return token_url, FORM_ENC_HEADERS, body

    def prepare_token_revocation_request(self, revocation_url, token,
                                         token_type_hint="access_token", body='', callback=None, **kwargs):
        """Prepare a token revocation request.

        :param revocation_url: Provider token revocation endpoint URL.
        :param token: The access or refresh token to be revoked (string).
        :param token_type_hint: ``"access_token"`` (default) or
            ``"refresh_token"``. This is optional and if you wish to not pass it you
            must provide ``token_type_hint=None``.
        :param body:
        :param callback: A jsonp callback such as ``package.callback`` to be invoked
            upon receiving the response. Not that it should not include a () suffix.
        :param kwargs: Additional parameters to included in the request.
        :returns: The prepared request tuple with (url, headers, body).

        Note that JSONP request may use GET requests as the parameters will
        be added to the request URL query as opposed to the request body.

        An example of a revocation request

        .. code-block:: http

            POST /revoke HTTP/1.1
            Host: server.example.com
            Content-Type: application/x-www-form-urlencoded
            Authorization: Basic czZCaGRSa3F0MzpnWDFmQmF0M2JW

            token=45ghiukldjahdnhzdauz&token_type_hint=refresh_token

        An example of a jsonp revocation request

        .. code-block:: http

            GET /revoke?token=agabcdefddddafdd&callback=package.myCallback HTTP/1.1
            Host: server.example.com
            Content-Type: application/x-www-form-urlencoded
            Authorization: Basic czZCaGRSa3F0MzpnWDFmQmF0M2JW

        and an error response

        .. code-block:: javascript

            package.myCallback({"error":"unsupported_token_type"});

        Note that these requests usually require client credentials, client_id in
        the case for public clients and provider specific authentication
        credentials for confidential clients.
        """
        if not is_secure_transport(revocation_url):
            raise InsecureTransportError()

        return prepare_token_revocation_request(revocation_url, token,
                                                token_type_hint=token_type_hint, body=body, callback=callback,
                                                **kwargs)

    def parse_request_body_response(self, body, scope=None, **kwargs):
        """Parse the JSON response body.

        If the access token request is valid and authorized, the
        authorization server issues an access token as described in
        `Section 5.1`_.  A refresh token SHOULD NOT be included.  If the request
        failed client authentication or is invalid, the authorization server
        returns an error response as described in `Section 5.2`_.

        :param body: The response body from the token request.
        :param scope: Scopes originally requested. If none is provided, the ones
            provided in the constructor are used.
        :return: Dictionary of token parameters.
        :raises: Warning if scope has changed. :py:class:`oauthlib.oauth2.errors.OAuth2Error`
            if response is invalid.

        These response are json encoded and could easily be parsed without
        the assistance of OAuthLib. However, there are a few subtle issues
        to be aware of regarding the response which are helpfully addressed
        through the raising of various errors.

        A successful response should always contain

        **access_token**
                The access token issued by the authorization server. Often
                a random string.

        **token_type**
            The type of the token issued as described in `Section 7.1`_.
            Commonly ``Bearer``.

        While it is not mandated it is recommended that the provider include

        **expires_in**
            The lifetime in seconds of the access token.  For
            example, the value "3600" denotes that the access token will
            expire in one hour from the time the response was generated.
            If omitted, the authorization server SHOULD provide the
            expiration time via other means or document the default value.

         **scope**
            Providers may supply this in all responses but are required to only
            if it has changed since the authorization request.

        .. _`Section 5.1`: https://tools.ietf.org/html/rfc6749#section-5.1
        .. _`Section 5.2`: https://tools.ietf.org/html/rfc6749#section-5.2
        .. _`Section 7.1`: https://tools.ietf.org/html/rfc6749#section-7.1
        """
        scope = self.scope if scope is None else scope
        self.token = parse_token_response(body, scope=scope)
        self.populate_token_attributes(self.token)
        return self.token

    def prepare_refresh_body(self, body='', refresh_token=None, scope=None, **kwargs):
        """Prepare an access token request, using a refresh token.

        If the authorization server issued a refresh token to the client, the
        client makes a refresh request to the token endpoint by adding the
        following parameters using the `application/x-www-form-urlencoded`
        format in the HTTP request entity-body:

        :param refresh_token: REQUIRED.  The refresh token issued to the client.
        :param scope:  OPTIONAL.  The scope of the access request as described by
            Section 3.3.  The requested scope MUST NOT include any scope
            not originally granted by the resource owner, and if omitted is
            treated as equal to the scope originally granted by the
            resource owner. Note that if none is provided, the ones provided
            in the constructor are used if any.
        """
        refresh_token = refresh_token or self.refresh_token
        scope = self.scope if scope is None else scope
        return prepare_token_request(self.refresh_token_key, body=body, scope=scope,
                                     refresh_token=refresh_token, **kwargs)

    def _add_bearer_token(self, uri, http_method='GET', body=None,
                          headers=None, token_placement=None):
        """Add a bearer token to the request uri, body or authorization header."""
        if token_placement == AUTH_HEADER:
            headers = tokens.prepare_bearer_headers(self.access_token, headers)

        elif token_placement == URI_QUERY:
            uri = tokens.prepare_bearer_uri(self.access_token, uri)

        elif token_placement == BODY:
            body = tokens.prepare_bearer_body(self.access_token, body)

        else:
            raise ValueError("Invalid token placement.")
        return uri, headers, body

    def create_code_verifier(self, length):
        """Create PKCE **code_verifier** used in computing **code_challenge**.
        See `RFC7636 Section 4.1`_

        :param length: REQUIRED. The length of the code_verifier.

        The client first creates a code verifier, "code_verifier", for each
        OAuth 2.0 [RFC6749] Authorization Request, in the following manner:

        .. code-block:: text

               code_verifier = high-entropy cryptographic random STRING using the
               unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
               from Section 2.3 of [RFC3986], with a minimum length of 43 characters
               and a maximum length of 128 characters.

        .. _`RFC7636 Section 4.1`: https://tools.ietf.org/html/rfc7636#section-4.1
        """
        code_verifier = None

        if not length >= 43:
            raise ValueError("Length must be greater than or equal to 43")

        if not length <= 128:
            raise ValueError("Length must be less than or equal to 128")

        code_verifier = generate_token(length, UNICODE_ASCII_CHARACTER_SET + "-._~")

        self.code_verifier = code_verifier

        return code_verifier

    def create_code_challenge(self, code_verifier, code_challenge_method=None):
        """Create PKCE **code_challenge** derived from the  **code_verifier**.
        See `RFC7636 Section 4.2`_

        :param code_verifier: REQUIRED. The **code_verifier** generated from `create_code_verifier()`.
        :param code_challenge_method: OPTIONAL. The method used to derive the **code_challenge**. Acceptable values include `S256`. DEFAULT is `plain`.

               The client then creates a code challenge derived from the code
               verifier by using one of the following transformations on the code
               verifier::

                   plain
                      code_challenge = code_verifier
                   S256
                      code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))

               If the client is capable of using `S256`, it MUST use `S256`, as
               `S256` is Mandatory To Implement (MTI) on the server.  Clients are
               permitted to use `plain` only if they cannot support `S256` for some
               technical reason and know via out-of-band configuration that the
               server supports `plain`.

               The plain transformation is for compatibility with existing
               deployments and for constrained environments that can't use the S256 transformation.

        .. _`RFC7636 Section 4.2`: https://tools.ietf.org/html/rfc7636#section-4.2
        """
        code_challenge = None

        if code_verifier is None:
            raise ValueError("Invalid code_verifier")

        if code_challenge_method is None:
            code_challenge_method = "plain"
            self.code_challenge_method = code_challenge_method
            code_challenge = code_verifier
            self.code_challenge = code_challenge

        if code_challenge_method == "S256":
            h = hashlib.sha256()
            h.update(code_verifier.encode(encoding='ascii'))
            sha256_val = h.digest()
            code_challenge = bytes.decode(base64.urlsafe_b64encode(sha256_val))
            # replace '+' with '-', '/' with '_', and remove trailing '='
            code_challenge = code_challenge.replace("+", "-").replace("/", "_").replace("=", "")
            self.code_challenge = code_challenge

        return code_challenge

    def _add_mac_token(self, uri, http_method='GET', body=None,
                       headers=None, token_placement=AUTH_HEADER, ext=None, **kwargs):
        """Add a MAC token to the request authorization header.

        Warning: MAC token support is experimental as the spec is not yet stable.
        """
        if token_placement != AUTH_HEADER:
            raise ValueError("Invalid token placement.")

        headers = tokens.prepare_mac_header(self.access_token, uri,
                                            self.mac_key, http_method, headers=headers, body=body, ext=ext,
                                            hash_algorithm=self.mac_algorithm, **kwargs)
        return uri, headers, body

    def _populate_attributes(self, response):
        warnings.warn("Please switch to the public method "
                      "populate_token_attributes.", DeprecationWarning)
        return self.populate_token_attributes(response)

    def populate_code_attributes(self, response):
        """Add attributes from an auth code response to self."""

        if 'code' in response:
            self.code = response.get('code')

    def populate_token_attributes(self, response):
        """Add attributes from a token exchange response to self."""

        if 'access_token' in response:
            self.access_token = response.get('access_token')

        if 'refresh_token' in response:
            self.refresh_token = response.get('refresh_token')

        if 'token_type' in response:
            self.token_type = response.get('token_type')

        vin, vat, v_at = parse_expires(response)
        if vin:
            self.expires_in = vin
        if vat:
            self.expires_at = vat
        if v_at:
            self._expires_at = v_at

        if 'mac_key' in response:
            self.mac_key = response.get('mac_key')

        if 'mac_algorithm' in response:
            self.mac_algorithm = response.get('mac_algorithm')
