"""
oauthlib.openid.connect.core.grant_types
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
"""
import logging

from oauthlib.oauth2.rfc6749.grant_types.refresh_token import (
    RefreshTokenGrant as OAuth2RefreshTokenGrant,
)

from .base import GrantTypeBase

log = logging.getLogger(__name__)


class RefreshTokenGrant(GrantTypeBase):

    def __init__(self, request_validator=None, **kwargs):
        self.proxy_target = OAuth2RefreshTokenGrant(
            request_validator=request_validator, **kwargs)
        self.register_token_modifier(self.add_id_token)

    def add_id_token(self, token, token_handler, request):
        """
        Construct an initial version of id_token, and let the
        request_validator sign or encrypt it.

        The authorization_code version of this method is used to
        retrieve the nonce accordingly to the code storage.
        """
        if not self.request_validator.refresh_id_token(request):
            return token

        return super().add_id_token(token, token_handler, request)
