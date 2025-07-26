from oauthlib.oauth2 import WebApplicationClient, InsecureTransportError
from oauthlib.oauth2 import is_secure_transport
from requests.auth import AuthBase


class OAuth2(AuthBase):
    """Adds proof of authorization (OAuth2 token) to the request."""

    def __init__(self, client_id=None, client=None, token=None):
        """Construct a new OAuth 2 authorization object.

        :param client_id: Client id obtained during registration
        :param client: :class:`oauthlib.oauth2.Client` to be used. Default is
                       WebApplicationClient which is useful for any
                       hosted application but not mobile or desktop.
        :param token: Token dictionary, must include access_token
                      and token_type.
        """
        self._client = client or WebApplicationClient(client_id, token=token)
        if token:
            for k, v in token.items():
                setattr(self._client, k, v)

    def __call__(self, r):
        """Append an OAuth 2 token to the request.

        Note that currently HTTPS is required for all requests. There may be
        a token type that allows for plain HTTP in the future and then this
        should be updated to allow plain HTTP on a white list basis.
        """
        if not is_secure_transport(r.url):
            raise InsecureTransportError()
        r.url, r.headers, r.body = self._client.add_token(
            r.url, http_method=r.method, body=r.body, headers=r.headers
        )
        return r
