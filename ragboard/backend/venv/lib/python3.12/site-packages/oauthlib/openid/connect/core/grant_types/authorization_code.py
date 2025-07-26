"""
oauthlib.openid.connect.core.grant_types
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
"""
import logging

from oauthlib.oauth2.rfc6749.grant_types.authorization_code import (
    AuthorizationCodeGrant as OAuth2AuthorizationCodeGrant,
)

from .base import GrantTypeBase

log = logging.getLogger(__name__)


class AuthorizationCodeGrant(GrantTypeBase):

    def __init__(self, request_validator=None, **kwargs):
        self.proxy_target = OAuth2AuthorizationCodeGrant(
            request_validator=request_validator, **kwargs)
        self.custom_validators.post_auth.append(
            self.openid_authorization_validator)
        self.register_token_modifier(self.add_id_token)

    def add_id_token(self, token, token_handler, request):
        """
        Construct an initial version of id_token, and let the
        request_validator sign or encrypt it.

        The authorization_code version of this method is used to
        retrieve the nonce accordingly to the code storage.
        """
        # Treat it as normal OAuth 2 auth code request if openid is not present
        if not request.scopes or 'openid' not in request.scopes:
            return token

        nonce = self.request_validator.get_authorization_code_nonce(
            request.client_id,
            request.code,
            request.redirect_uri,
            request
        )
        return super().add_id_token(token, token_handler, request, nonce=nonce)
