"""
authlib.openid.connect.core.tokens
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This module contains methods for adding JWT tokens to requests.
"""
from oauthlib.oauth2.rfc6749.tokens import (
    TokenBase, get_token_from_header, random_token_generator,
)


class JWTToken(TokenBase):
    __slots__ = (
        'request_validator', 'token_generator',
        'refresh_token_generator', 'expires_in'
    )

    def __init__(self, request_validator=None, token_generator=None,
                 expires_in=None, refresh_token_generator=None):
        self.request_validator = request_validator
        self.token_generator = token_generator or random_token_generator
        self.refresh_token_generator = (
            refresh_token_generator or self.token_generator
        )
        self.expires_in = expires_in or 3600

    def create_token(self, request, refresh_token=False):
        """Create a JWT Token, using requestvalidator method."""

        expires_in = self.expires_in(request) if callable(self.expires_in) else self.expires_in

        request.expires_in = expires_in

        return self.request_validator.get_jwt_bearer_token(None, None, request)

    def validate_request(self, request):
        token = get_token_from_header(request)
        return self.request_validator.validate_jwt_bearer_token(
            token, request.scopes, request)

    def estimate_type(self, request):
        token = get_token_from_header(request)
        if token and token.startswith('ey') and token.count('.') in (2, 4):
            return 10
        return 0
