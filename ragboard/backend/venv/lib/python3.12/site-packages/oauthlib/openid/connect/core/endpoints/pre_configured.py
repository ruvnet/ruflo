"""
oauthlib.openid.connect.core.endpoints.pre_configured
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This module is an implementation of various endpoints needed
for providing OpenID Connect servers.
"""

from oauthlib.oauth2.rfc6749.endpoints import (
    AuthorizationEndpoint,
    IntrospectEndpoint,
    ResourceEndpoint,
    RevocationEndpoint,
    TokenEndpoint,
)
from oauthlib.oauth2.rfc6749.grant_types import (
    AuthorizationCodeGrant as OAuth2AuthorizationCodeGrant,
    ClientCredentialsGrant,
    ImplicitGrant as OAuth2ImplicitGrant,
    ResourceOwnerPasswordCredentialsGrant,
)
from oauthlib.oauth2.rfc8628.grant_types import DeviceCodeGrant
from oauthlib.oauth2.rfc6749.tokens import BearerToken

from ..grant_types import (
    AuthorizationCodeGrant,
    HybridGrant,
    ImplicitGrant,
    RefreshTokenGrant,
)
from ..grant_types.dispatchers import (
    AuthorizationCodeGrantDispatcher,
    AuthorizationTokenGrantDispatcher,
    ImplicitTokenGrantDispatcher,
)
from ..tokens import JWTToken
from .userinfo import UserInfoEndpoint


class Server(
    AuthorizationEndpoint,
    IntrospectEndpoint,
    TokenEndpoint,
    ResourceEndpoint,
    RevocationEndpoint,
    UserInfoEndpoint,
):
    """
    An all-in-one endpoint featuring all four major grant types
    and extension grants.
    """

    def __init__(
        self,
        request_validator,
        token_expires_in=None,
        token_generator=None,
        refresh_token_generator=None,
        *args,
        **kwargs,
    ):
        """Construct a new all-grants-in-one server.

        :param request_validator: An implementation of
                                  oauthlib.oauth2.RequestValidator.
        :param token_expires_in: An int or a function to generate a token
                                 expiration offset (in seconds) given a
                                 oauthlib.common.Request object.
        :param token_generator: A function to generate a token from a request.
        :param refresh_token_generator: A function to generate a token from a
                                        request for the refresh token.
        :param kwargs: Extra parameters to pass to authorization-,
                       token-, resource-, and revocation-endpoint constructors.
        """
        self.auth_grant = OAuth2AuthorizationCodeGrant(request_validator)
        self.implicit_grant = OAuth2ImplicitGrant(request_validator)
        self.password_grant = ResourceOwnerPasswordCredentialsGrant(request_validator)
        self.credentials_grant = ClientCredentialsGrant(request_validator)
        self.refresh_grant = RefreshTokenGrant(request_validator)
        self.openid_connect_auth = AuthorizationCodeGrant(request_validator)
        self.openid_connect_implicit = ImplicitGrant(request_validator)
        self.openid_connect_hybrid = HybridGrant(request_validator)
        self.device_code_grant = DeviceCodeGrant(request_validator, **kwargs)

        self.bearer = BearerToken(
            request_validator, token_generator, token_expires_in, refresh_token_generator
        )

        self.jwt = JWTToken(
            request_validator, token_generator, token_expires_in, refresh_token_generator
        )

        self.auth_grant_choice = AuthorizationCodeGrantDispatcher(
            default_grant=self.auth_grant, oidc_grant=self.openid_connect_auth
        )
        self.implicit_grant_choice = ImplicitTokenGrantDispatcher(
            default_grant=self.implicit_grant, oidc_grant=self.openid_connect_implicit
        )

        # See http://openid.net/specs/oauth-v2-multiple-response-types-1_0.html#Combinations for valid combinations
        # internally our AuthorizationEndpoint will ensure they can appear in any order for any valid combination
        AuthorizationEndpoint.__init__(
            self,
            default_response_type="code",
            response_types={
                "code": self.auth_grant_choice,
                "token": self.implicit_grant_choice,
                "id_token": self.openid_connect_implicit,
                "id_token token": self.openid_connect_implicit,
                "code token": self.openid_connect_hybrid,
                "code id_token": self.openid_connect_hybrid,
                "code id_token token": self.openid_connect_hybrid,
                "none": self.auth_grant,
            },
            default_token_type=self.bearer,
        )

        self.token_grant_choice = AuthorizationTokenGrantDispatcher(
            request_validator, default_grant=self.auth_grant, oidc_grant=self.openid_connect_auth
        )

        TokenEndpoint.__init__(
            self,
            default_grant_type="authorization_code",
            grant_types={
                "authorization_code": self.token_grant_choice,
                "password": self.password_grant,
                "client_credentials": self.credentials_grant,
                "refresh_token": self.refresh_grant,
                "urn:ietf:params:oauth:grant-type:device_code": self.device_code_grant,
            },
            default_token_type=self.bearer,
        )
        ResourceEndpoint.__init__(
            self, default_token="Bearer", token_types={"Bearer": self.bearer, "JWT": self.jwt}
        )
        RevocationEndpoint.__init__(self, request_validator)
        IntrospectEndpoint.__init__(self, request_validator)
        UserInfoEndpoint.__init__(self, request_validator)
