"""
oauthlib.oauth2.rfc6749.parameters
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This module contains methods related to `Section 4`_ of the OAuth 2 RFC.

.. _`Section 4`: https://tools.ietf.org/html/rfc6749#section-4
"""
import json
import os
import time
import urllib.parse as urlparse

from oauthlib.common import add_params_to_qs, add_params_to_uri
from oauthlib.signals import scope_changed

from .errors import (
    InsecureTransportError, MismatchingStateError, MissingCodeError,
    MissingTokenError, MissingTokenTypeError, raise_from_error,
)
from .tokens import OAuth2Token
from .utils import is_secure_transport, list_to_scope, scope_to_list


def prepare_grant_uri(uri, client_id, response_type, redirect_uri=None,
                      scope=None, state=None, code_challenge=None, code_challenge_method='plain', **kwargs):
    """Prepare the authorization grant request URI.

    The client constructs the request URI by adding the following
    parameters to the query component of the authorization endpoint URI
    using the ``application/x-www-form-urlencoded`` format as defined by
    [`W3C.REC-html401-19991224`_]:

    :param uri:
    :param client_id: The client identifier as described in `Section 2.2`_.
    :param response_type: To indicate which OAuth 2 grant/flow is required,
                          "code" and "token".
    :param redirect_uri: The client provided URI to redirect back to after
                         authorization as described in `Section 3.1.2`_.
    :param scope: The scope of the access request as described by
                  `Section 3.3`_.
    :param state: An opaque value used by the client to maintain
                  state between the request and callback.  The authorization
                  server includes this value when redirecting the user-agent
                  back to the client.  The parameter SHOULD be used for
                  preventing cross-site request forgery as described in
                  `Section 10.12`_.
    :param code_challenge: PKCE parameter. A challenge derived from the
                           code_verifier that is sent in the authorization
                           request, to be verified against later.
    :param code_challenge_method: PKCE parameter. A method that was used to derive the
                                  code_challenge. Defaults to "plain" if not present in the request.
    :param kwargs: Extra arguments to embed in the grant/authorization URL.

    An example of an authorization code grant authorization URL:

    .. code-block:: http

        GET /authorize?response_type=code&client_id=s6BhdRkqt3&state=xyz
            &code_challenge=kjasBS523KdkAILD2k78NdcJSk2k3KHG6&code_challenge_method=S256
            &redirect_uri=https%3A%2F%2Fclient%2Eexample%2Ecom%2Fcb HTTP/1.1
        Host: server.example.com

    .. _`W3C.REC-html401-19991224`: https://tools.ietf.org/html/rfc6749#ref-W3C.REC-html401-19991224
    .. _`Section 2.2`: https://tools.ietf.org/html/rfc6749#section-2.2
    .. _`Section 3.1.2`: https://tools.ietf.org/html/rfc6749#section-3.1.2
    .. _`Section 3.3`: https://tools.ietf.org/html/rfc6749#section-3.3
    .. _`section 10.12`: https://tools.ietf.org/html/rfc6749#section-10.12
    """
    if not is_secure_transport(uri):
        raise InsecureTransportError()

    params = [(('response_type', response_type)),
              (('client_id', client_id))]

    if redirect_uri:
        params.append(('redirect_uri', redirect_uri))
    if scope:
        params.append(('scope', list_to_scope(scope)))
    if state:
        params.append(('state', state))
    if code_challenge is not None:
        params.append(('code_challenge', code_challenge))
        params.append(('code_challenge_method', code_challenge_method))

    for k in kwargs:
        if kwargs[k]:
            params.append((str(k), kwargs[k]))

    return add_params_to_uri(uri, params)


def prepare_token_request(grant_type, body='', include_client_id=True, code_verifier=None, **kwargs):
    """Prepare the access token request.

    The client makes a request to the token endpoint by adding the
    following parameters using the ``application/x-www-form-urlencoded``
    format in the HTTP request entity-body:

    :param grant_type: To indicate grant type being used, i.e. "password",
                       "authorization_code" or "client_credentials".

    :param body: Existing request body (URL encoded string) to embed parameters
                 into. This may contain extra parameters. Default ''.

    :param include_client_id: `True` (default) to send the `client_id` in the
                              body of the upstream request. This is required
                              if the client is not authenticating with the
                              authorization server as described in
                              `Section 3.2.1`_.
    :type include_client_id: Boolean

    :param client_id: Unicode client identifier. Will only appear if
                      `include_client_id` is True. *

    :param client_secret: Unicode client secret. Will only appear if set to a
                          value that is not `None`. Invoking this function with
                          an empty string will send an empty `client_secret`
                          value to the server. *

    :param code: If using authorization_code grant, pass the previously
                 obtained authorization code as the ``code`` argument. *

    :param redirect_uri: If the "redirect_uri" parameter was included in the
                         authorization request as described in
                         `Section 4.1.1`_, and their values MUST be identical. *

    :param code_verifier: PKCE parameter. A cryptographically random string that is used to correlate the
                          authorization request to the token request.

    :param kwargs: Extra arguments to embed in the request body.

    Parameters marked with a `*` above are not explicit arguments in the
    function signature, but are specially documented arguments for items
    appearing in the generic `**kwargs` keyworded input.

    An example of an authorization code token request body:

    .. code-block:: http

        grant_type=authorization_code&code=SplxlOBeZQQYbYS6WxSbIA
        &redirect_uri=https%3A%2F%2Fclient%2Eexample%2Ecom%2Fcb

    .. _`Section 4.1.1`: https://tools.ietf.org/html/rfc6749#section-4.1.1
    """
    params = [('grant_type', grant_type)]

    if 'scope' in kwargs:
        kwargs['scope'] = list_to_scope(kwargs['scope'])

    # pull the `client_id` out of the kwargs.
    client_id = kwargs.pop('client_id', None)
    if include_client_id and client_id is not None:
        params.append(('client_id', client_id))

    # use code_verifier if code_challenge was passed in the authorization request
    if code_verifier is not None:
        params.append(('code_verifier', code_verifier))

    # the kwargs iteration below only supports including boolean truth (truthy)
    # values, but some servers may require an empty string for `client_secret`
    client_secret = kwargs.pop('client_secret', None)
    if client_secret is not None:
        params.append(('client_secret', client_secret))

    # this handles: `code`, `redirect_uri`, and other undocumented params
    for k in kwargs:
        if kwargs[k]:
            params.append((str(k), kwargs[k]))

    return add_params_to_qs(body, params)


def prepare_token_revocation_request(url, token, token_type_hint="access_token",
        callback=None, body='', **kwargs):
    """Prepare a token revocation request.

    The client constructs the request by including the following parameters
    using the ``application/x-www-form-urlencoded`` format in the HTTP request
    entity-body:

    :param token: REQUIRED.  The token that the client wants to get revoked.

    :param token_type_hint: OPTIONAL.  A hint about the type of the token
                            submitted for revocation. Clients MAY pass this
                            parameter in order to help the authorization server
                            to optimize the token lookup.  If the server is
                            unable to locate the token using the given hint, it
                            MUST extend its search across all of its supported
                            token types.  An authorization server MAY ignore
                            this parameter, particularly if it is able to detect
                            the token type automatically.

    This specification defines two values for `token_type_hint`:

        * access_token: An access token as defined in [RFC6749],
             `Section 1.4`_

        * refresh_token: A refresh token as defined in [RFC6749],
             `Section 1.5`_

        Specific implementations, profiles, and extensions of this
        specification MAY define other values for this parameter using the
        registry defined in `Section 4.1.2`_.

    .. _`Section 1.4`: https://tools.ietf.org/html/rfc6749#section-1.4
    .. _`Section 1.5`: https://tools.ietf.org/html/rfc6749#section-1.5
    .. _`Section 4.1.2`: https://tools.ietf.org/html/rfc7009#section-4.1.2

    """
    if not is_secure_transport(url):
        raise InsecureTransportError()

    params = [('token', token)]

    if token_type_hint:
        params.append(('token_type_hint', token_type_hint))

    for k in kwargs:
        if kwargs[k]:
            params.append((str(k), kwargs[k]))

    headers = {'Content-Type': 'application/x-www-form-urlencoded'}

    if callback:
        params.append(('callback', callback))
        return add_params_to_uri(url, params), headers, body
    else:
        return url, headers, add_params_to_qs(body, params)


def parse_authorization_code_response(uri, state=None):
    """Parse authorization grant response URI into a dict.

    If the resource owner grants the access request, the authorization
    server issues an authorization code and delivers it to the client by
    adding the following parameters to the query component of the
    redirection URI using the ``application/x-www-form-urlencoded`` format:

    **code**
            REQUIRED.  The authorization code generated by the
            authorization server.  The authorization code MUST expire
            shortly after it is issued to mitigate the risk of leaks.  A
            maximum authorization code lifetime of 10 minutes is
            RECOMMENDED.  The client MUST NOT use the authorization code
            more than once.  If an authorization code is used more than
            once, the authorization server MUST deny the request and SHOULD
            revoke (when possible) all tokens previously issued based on
            that authorization code.  The authorization code is bound to
            the client identifier and redirection URI.

    **state**
            REQUIRED if the "state" parameter was present in the client
            authorization request.  The exact value received from the
            client.

    :param uri: The full redirect URL back to the client.
    :param state: The state parameter from the authorization request.

    For example, the authorization server redirects the user-agent by
    sending the following HTTP response:

    .. code-block:: http

        HTTP/1.1 302 Found
        Location: https://client.example.com/cb?code=SplxlOBeZQQYbYS6WxSbIA
                &state=xyz

    """
    if not is_secure_transport(uri):
        raise InsecureTransportError()

    query = urlparse.urlparse(uri).query
    params = dict(urlparse.parse_qsl(query))

    if state and params.get('state') != state:
        raise MismatchingStateError()

    if 'error' in params:
        raise_from_error(params.get('error'), params)

    if 'code' not in params:
        raise MissingCodeError("Missing code parameter in response.")

    return params


def parse_implicit_response(uri, state=None, scope=None):
    """Parse the implicit token response URI into a dict.

    If the resource owner grants the access request, the authorization
    server issues an access token and delivers it to the client by adding
    the following parameters to the fragment component of the redirection
    URI using the ``application/x-www-form-urlencoded`` format:

    **access_token**
            REQUIRED.  The access token issued by the authorization server.

    **token_type**
            REQUIRED.  The type of the token issued as described in
            Section 7.1.  Value is case insensitive.

    **expires_in**
            RECOMMENDED.  The lifetime in seconds of the access token.  For
            example, the value "3600" denotes that the access token will
            expire in one hour from the time the response was generated.
            If omitted, the authorization server SHOULD provide the
            expiration time via other means or document the default value.

    **scope**
            OPTIONAL, if identical to the scope requested by the client,
            otherwise REQUIRED.  The scope of the access token as described
            by Section 3.3.

    **state**
            REQUIRED if the "state" parameter was present in the client
            authorization request.  The exact value received from the
            client.

    :param uri:
    :param state:
    :param scope:

    Similar to the authorization code response, but with a full token provided
    in the URL fragment:

    .. code-block:: http

        HTTP/1.1 302 Found
        Location: http://example.com/cb#access_token=2YotnFZFEjr1zCsicMWpAA
                &state=xyz&token_type=example&expires_in=3600
    """
    if not is_secure_transport(uri):
        raise InsecureTransportError()

    fragment = urlparse.urlparse(uri).fragment
    params = dict(urlparse.parse_qsl(fragment, keep_blank_values=True))

    if 'scope' in params:
        params['scope'] = scope_to_list(params['scope'])

    vin, vat, v_at = parse_expires(params)
    if vin:
        params['expires_in'] = vin
    elif 'expires_in' in params:
        params.pop('expires_in')
    if vat:
        params['expires_at'] = vat
    elif 'expires_at' in params:
        params.pop('expires_at')

    if state and params.get('state') != state:
        raise ValueError("Mismatching or missing state in params.")

    params = OAuth2Token(params, old_scope=scope)
    validate_token_parameters(params)
    return params


def parse_token_response(body, scope=None):
    """Parse the JSON token response body into a dict.

    The authorization server issues an access token and optional refresh
    token, and constructs the response by adding the following parameters
    to the entity body of the HTTP response with a 200 (OK) status code:

    access_token
            REQUIRED.  The access token issued by the authorization server.
    token_type
            REQUIRED.  The type of the token issued as described in
            `Section 7.1`_.  Value is case insensitive.
    expires_in
            RECOMMENDED.  The lifetime in seconds of the access token.  For
            example, the value "3600" denotes that the access token will
            expire in one hour from the time the response was generated.
            If omitted, the authorization server SHOULD provide the
            expiration time via other means or document the default value.
    refresh_token
            OPTIONAL.  The refresh token which can be used to obtain new
            access tokens using the same authorization grant as described
            in `Section 6`_.
    scope
            OPTIONAL, if identical to the scope requested by the client,
            otherwise REQUIRED.  The scope of the access token as described
            by `Section 3.3`_.

    The parameters are included in the entity body of the HTTP response
    using the "application/json" media type as defined by [`RFC4627`_].  The
    parameters are serialized into a JSON structure by adding each
    parameter at the highest structure level.  Parameter names and string
    values are included as JSON strings.  Numerical values are included
    as JSON numbers.  The order of parameters does not matter and can
    vary.

    :param body: The full json encoded response body.
    :param scope: The scope requested during authorization.

    For example:

    .. code-block:: http

        HTTP/1.1 200 OK
        Content-Type: application/json
        Cache-Control: no-store
        Pragma: no-cache

        {
            "access_token":"2YotnFZFEjr1zCsicMWpAA",
            "token_type":"example",
            "expires_in":3600,
            "refresh_token":"tGzv3JOkF0XG5Qx2TlKWIA",
            "example_parameter":"example_value"
        }

    .. _`Section 7.1`: https://tools.ietf.org/html/rfc6749#section-7.1
    .. _`Section 6`: https://tools.ietf.org/html/rfc6749#section-6
    .. _`Section 3.3`: https://tools.ietf.org/html/rfc6749#section-3.3
    .. _`RFC4627`: https://tools.ietf.org/html/rfc4627
    """
    try:
        params = json.loads(body)
    except ValueError:

        # Fall back to URL-encoded string, to support old implementations,
        # including (at time of writing) Facebook. See:
        #   https://github.com/oauthlib/oauthlib/issues/267

        params = dict(urlparse.parse_qsl(body))

    if 'scope' in params:
        params['scope'] = scope_to_list(params['scope'])

    vin, vat, v_at = parse_expires(params)
    if vin:
        params['expires_in'] = vin
    elif 'expires_in' in params:
        params.pop('expires_in')
    if vat:
        params['expires_at'] = vat
    elif 'expires_at' in params:
        params.pop('expires_at')

    params = OAuth2Token(params, old_scope=scope)
    validate_token_parameters(params)
    return params


def validate_token_parameters(params):
    """Ensures token presence, token type, expiration and scope in params."""
    if 'error' in params:
        raise_from_error(params.get('error'), params)

    if 'access_token' not in params:
        raise MissingTokenError(description="Missing access token parameter.")

    if 'token_type' not in params and os.environ.get('OAUTHLIB_STRICT_TOKEN_TYPE'):
        raise MissingTokenTypeError()

    # If the issued access token scope is different from the one requested by
    # the client, the authorization server MUST include the "scope" response
    # parameter to inform the client of the actual scope granted.
    # https://tools.ietf.org/html/rfc6749#section-3.3
    if params.scope_changed:
        message = 'Scope has changed from "{old}" to "{new}".'.format(
            old=params.old_scope, new=params.scope,
        )
        scope_changed.send(message=message, old=params.old_scopes, new=params.scopes)
        if not os.environ.get('OAUTHLIB_RELAX_TOKEN_SCOPE', None):
            w = Warning(message)
            w.token = params
            w.old_scope = params.old_scopes
            w.new_scope = params.scopes
            raise w

def parse_expires(params):
    """Parse `expires_in`, `expires_at` fields from params

    Parse following these rules:
    - `expires_in` must be either integer, float or None. If a float, it is converted into an integer.
    - `expires_at` is not in specification so it does its best to:
      - convert into a int, else
      - convert into a float, else
      - reuse the same type as-is (usually string)
    - `_expires_at` is a special internal value returned to be always an `int`, based
    either on the presence of `expires_at`, or reuse the current time plus
    `expires_in`. This is typically used to validate token expiry.

    :param params: Dict with expires_in and expires_at optionally set
    :return: Tuple of `expires_in`, `expires_at`, and `_expires_at`. None if not set.
    """
    expires_in = None
    expires_at = None
    _expires_at = None

    if 'expires_in' in params:
        if isinstance(params.get('expires_in'), int):
            expires_in = params.get('expires_in')
        elif isinstance(params.get('expires_in'), float):
            expires_in = int(params.get('expires_in'))
        elif isinstance(params.get('expires_in'), str):
            try:
                # Attempt to convert to int
                expires_in = int(params.get('expires_in'))
            except ValueError:
                raise ValueError("expires_in must be an int")
        elif params.get('expires_in') is not None:
            raise ValueError("expires_in must be an int")

    if 'expires_at' in params:
        if isinstance(params.get('expires_at'), (float, int)):
            expires_at = params.get('expires_at')
            _expires_at = expires_at
        elif isinstance(params.get('expires_at'), str):
            try:
                # Attempt to convert to int first, then float if int fails
                expires_at = int(params.get('expires_at'))
                _expires_at = expires_at
            except ValueError:
                try:
                    expires_at = float(params.get('expires_at'))
                    _expires_at = expires_at
                except ValueError:
                    # no change from str
                    expires_at = params.get('expires_at')
    if _expires_at is None and expires_in:
        expires_at = round(time.time()) + expires_in
        _expires_at = expires_at
    return expires_in, expires_at, _expires_at
