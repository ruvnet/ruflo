from __future__ import annotations
import json

from typing import Callable

from oauthlib import common # noqa: TC001

from oauthlib.oauth2.rfc6749 import errors as rfc6749_errors
from oauthlib.oauth2.rfc6749.grant_types.base import GrantTypeBase


class DeviceCodeGrant(GrantTypeBase):
    def create_authorization_response(
        self, request: common.Request, token_handler: Callable
    ) -> tuple[dict, str, int]:
        """
        Validate the device flow request -> create the access token
        -> persist the token -> return the token.
        """
        headers = self._get_default_headers()
        try:
            self.validate_token_request(request)
        except rfc6749_errors.OAuth2Error as e:
            headers.update(e.headers)
            return headers, e.json, e.status_code

        token = token_handler.create_token(request, refresh_token=False)

        for modifier in self._token_modifiers:
            token = modifier(token)

        self.request_validator.save_token(token, request)

        return self.create_token_response(request, token_handler)

    def validate_token_request(self, request: common.Request) -> None:
        """
        Performs the necessary check against the request to ensure
        it's allowed to retrieve a token.
        """
        for validator in self.custom_validators.pre_token:
            validator(request)

        if not getattr(request, "grant_type", None):
            raise rfc6749_errors.InvalidRequestError(
                "Request is missing grant type.", request=request
            )

        if request.grant_type != "urn:ietf:params:oauth:grant-type:device_code":
            raise rfc6749_errors.UnsupportedGrantTypeError(request=request)

        for param in ("grant_type", "scope"):
            if param in request.duplicate_params:
                raise rfc6749_errors.InvalidRequestError(
                    description=f"Duplicate {param} parameter.", request=request
                )

        if not self.request_validator.authenticate_client(request):
            raise rfc6749_errors.InvalidClientError(request=request)
        elif not hasattr(request.client, "client_id"):
            raise NotImplementedError(
                "Authenticate client must set the "
                "request.client.client_id attribute "
                "in authenticate_client."
            )

        # Ensure client is authorized use of this grant type
        self.validate_grant_type(request)

        request.client_id = request.client_id or request.client.client_id
        self.validate_scopes(request)

        for validator in self.custom_validators.post_token:
            validator(request)

    def create_token_response(
        self, request: common.Request, token_handler: Callable
    ) -> tuple[dict, str, int]:
        """Return token or error in json format.

        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :param token_handler: A token handler instance, for example of type
                              oauthlib.oauth2.BearerToken.

        If the access token request is valid and authorized, the
        authorization server issues an access token and optional refresh
        token as described in `Section 5.1`_.  If the request failed client
        authentication or is invalid, the authorization server returns an
        error response as described in `Section 5.2`_.
        .. _`Section 5.1`: https://tools.ietf.org/html/rfc6749#section-5.1
        .. _`Section 5.2`: https://tools.ietf.org/html/rfc6749#section-5.2
        """
        headers = self._get_default_headers()
        try:
            if self.request_validator.client_authentication_required(
                request
            ) and not self.request_validator.authenticate_client(request):
                raise rfc6749_errors.InvalidClientError(request=request)

            self.validate_token_request(request)

        except rfc6749_errors.OAuth2Error as e:
            headers.update(e.headers)
            return headers, e.json, e.status_code

        token = token_handler.create_token(request, self.refresh_token)

        self.request_validator.save_token(token, request)

        return headers, json.dumps(token), 200
