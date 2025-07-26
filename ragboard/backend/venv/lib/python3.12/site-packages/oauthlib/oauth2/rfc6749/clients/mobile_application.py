# -*- coding: utf-8 -*-
"""
oauthlib.oauth2.rfc6749
~~~~~~~~~~~~~~~~~~~~~~~

This module is an implementation of various logic needed
for consuming and providing OAuth 2.0 RFC6749.
"""
from ..parameters import parse_implicit_response, prepare_grant_uri
from .base import Client


class MobileApplicationClient(Client):

    """A public client utilizing the implicit code grant workflow.

    A user-agent-based application is a public client in which the
    client code is downloaded from a web server and executes within a
    user-agent (e.g. web browser) on the device used by the resource
    owner.  Protocol data and credentials are easily accessible (and
    often visible) to the resource owner.  Since such applications
    reside within the user-agent, they can make seamless use of the
    user-agent capabilities when requesting authorization.

    The implicit grant type is used to obtain access tokens (it does not
    support the issuance of refresh tokens) and is optimized for public
    clients known to operate a particular redirection URI.  These clients
    are typically implemented in a browser using a scripting language
    such as JavaScript.

    As a redirection-based flow, the client must be capable of
    interacting with the resource owner's user-agent (typically a web
    browser) and capable of receiving incoming requests (via redirection)
    from the authorization server.

    Unlike the authorization code grant type in which the client makes
    separate requests for authorization and access token, the client
    receives the access token as the result of the authorization request.

    The implicit grant type does not include client authentication, and
    relies on the presence of the resource owner and the registration of
    the redirection URI.  Because the access token is encoded into the
    redirection URI, it may be exposed to the resource owner and other
    applications residing on the same device.
    """

    response_type = 'token'

    def prepare_request_uri(self, uri, redirect_uri=None, scope=None,
                            state=None, **kwargs):
        """Prepare the implicit grant request URI.

        The client constructs the request URI by adding the following
        parameters to the query component of the authorization endpoint URI
        using the "application/x-www-form-urlencoded" format, per `Appendix B`_:

        :param redirect_uri:  OPTIONAL. The redirect URI must be an absolute URI
                              and it should have been registered with the OAuth
                              provider prior to use. As described in `Section 3.1.2`_.

        :param scope:  OPTIONAL. The scope of the access request as described by
                       Section 3.3`_. These may be any string but are commonly
                       URIs or various categories such as ``videos`` or ``documents``.

        :param state:   RECOMMENDED.  An opaque value used by the client to maintain
                        state between the request and callback.  The authorization
                        server includes this value when redirecting the user-agent back
                        to the client.  The parameter SHOULD be used for preventing
                        cross-site request forgery as described in `Section 10.12`_.

        :param kwargs:  Extra arguments to include in the request URI.

        In addition to supplied parameters, OAuthLib will append the ``client_id``
        that was provided in the constructor as well as the mandatory ``response_type``
        argument, set to ``token``::

            >>> from oauthlib.oauth2 import MobileApplicationClient
            >>> client = MobileApplicationClient('your_id')
            >>> client.prepare_request_uri('https://example.com')
            'https://example.com?client_id=your_id&response_type=token'
            >>> client.prepare_request_uri('https://example.com', redirect_uri='https://a.b/callback')
            'https://example.com?client_id=your_id&response_type=token&redirect_uri=https%3A%2F%2Fa.b%2Fcallback'
            >>> client.prepare_request_uri('https://example.com', scope=['profile', 'pictures'])
            'https://example.com?client_id=your_id&response_type=token&scope=profile+pictures'
            >>> client.prepare_request_uri('https://example.com', foo='bar')
            'https://example.com?client_id=your_id&response_type=token&foo=bar'

        .. _`Appendix B`: https://tools.ietf.org/html/rfc6749#appendix-B
        .. _`Section 2.2`: https://tools.ietf.org/html/rfc6749#section-2.2
        .. _`Section 3.1.2`: https://tools.ietf.org/html/rfc6749#section-3.1.2
        .. _`Section 3.3`: https://tools.ietf.org/html/rfc6749#section-3.3
        .. _`Section 10.12`: https://tools.ietf.org/html/rfc6749#section-10.12
        """
        scope = self.scope if scope is None else scope
        return prepare_grant_uri(uri, self.client_id, self.response_type,
                                 redirect_uri=redirect_uri, state=state, scope=scope, **kwargs)

    def parse_request_uri_response(self, uri, state=None, scope=None):
        """Parse the response URI fragment.

        If the resource owner grants the access request, the authorization
        server issues an access token and delivers it to the client by adding
        the following parameters to the fragment component of the redirection
        URI using the "application/x-www-form-urlencoded" format:

        :param uri: The callback URI that resulted from the user being redirected
                    back from the provider to you, the client.
        :param state: The state provided in the authorization request.
        :param scope: The scopes provided in the authorization request.
        :return: Dictionary of token parameters.
        :raises: OAuth2Error if response is invalid.

        A successful response should always contain

        **access_token**
                The access token issued by the authorization server. Often
                a random string.

        **token_type**
            The type of the token issued as described in `Section 7.1`_.
            Commonly ``Bearer``.

        **state**
            If you provided the state parameter in the authorization phase, then
            the provider is required to include that exact state value in the
            response.

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

        A few example responses can be seen below::

            >>> response_uri = 'https://example.com/callback#access_token=sdlfkj452&state=ss345asyht&token_type=Bearer&scope=hello+world'
            >>> from oauthlib.oauth2 import MobileApplicationClient
            >>> client = MobileApplicationClient('your_id')
            >>> client.parse_request_uri_response(response_uri)
            {
                'access_token': 'sdlfkj452',
                'token_type': 'Bearer',
                'state': 'ss345asyht',
                'scope': [u'hello', u'world']
            }
            >>> client.parse_request_uri_response(response_uri, state='other')
            Traceback (most recent call last):
                File "<stdin>", line 1, in <module>
                File "oauthlib/oauth2/rfc6749/__init__.py", line 598, in parse_request_uri_response
                    **scope**
                File "oauthlib/oauth2/rfc6749/parameters.py", line 197, in parse_implicit_response
                    raise ValueError("Mismatching or missing state in params.")
            ValueError: Mismatching or missing state in params.
            >>> def alert_scope_changed(message, old, new):
            ...     print(message, old, new)
            ...
            >>> oauthlib.signals.scope_changed.connect(alert_scope_changed)
            >>> client.parse_request_body_response(response_body, scope=['other'])
            ('Scope has changed from "other" to "hello world".', ['other'], ['hello', 'world'])

        .. _`Section 7.1`: https://tools.ietf.org/html/rfc6749#section-7.1
        .. _`Section 3.3`: https://tools.ietf.org/html/rfc6749#section-3.3
        """
        scope = self.scope if scope is None else scope
        self.token = parse_implicit_response(uri, state=state, scope=scope)
        self.populate_token_attributes(self.token)
        return self.token
