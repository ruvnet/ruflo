"""
oauthlib.oauth2.rfc6749.grant_types
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
"""
import json
import logging

from .. import errors, utils
from .base import GrantTypeBase

log = logging.getLogger(__name__)


class RefreshTokenGrant(GrantTypeBase):

    """`Refresh token grant`_

    .. _`Refresh token grant`: https://tools.ietf.org/html/rfc6749#section-6
    """

    def __init__(self, request_validator=None,
                 issue_new_refresh_tokens=True,
                 **kwargs):
        super().__init__(
            request_validator,
            issue_new_refresh_tokens=issue_new_refresh_tokens,
            **kwargs)

    def create_token_response(self, request, token_handler):
        """Create a new access token from a refresh_token.

        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :param token_handler: A token handler instance, for example of type
                              oauthlib.oauth2.BearerToken.

        If valid and authorized, the authorization server issues an access
        token as described in `Section 5.1`_. If the request failed
        verification or is invalid, the authorization server returns an error
        response as described in `Section 5.2`_.

        The authorization server MAY issue a new refresh token, in which case
        the client MUST discard the old refresh token and replace it with the
        new refresh token. The authorization server MAY revoke the old
        refresh token after issuing a new refresh token to the client. If a
        new refresh token is issued, the refresh token scope MUST be
        identical to that of the refresh token included by the client in the
        request.

        .. _`Section 5.1`: https://tools.ietf.org/html/rfc6749#section-5.1
        .. _`Section 5.2`: https://tools.ietf.org/html/rfc6749#section-5.2
        """
        headers = self._get_default_headers()
        try:
            log.debug('Validating refresh token request, %r.', request)
            self.validate_token_request(request)
        except errors.OAuth2Error as e:
            log.debug('Client error in token request, %s.', e)
            headers.update(e.headers)
            return headers, e.json, e.status_code

        token = token_handler.create_token(request,
                                           refresh_token=self.issue_new_refresh_tokens)

        for modifier in self._token_modifiers:
            token = modifier(token, token_handler, request)

        self.request_validator.save_token(token, request)

        log.debug('Issuing new token to client id %r (%r), %r.',
                  request.client_id, request.client, token)
        headers.update(self._create_cors_headers(request))
        return headers, json.dumps(token), 200

    def validate_token_request(self, request):
        """
        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        """
        # REQUIRED. Value MUST be set to "refresh_token".
        if request.grant_type != 'refresh_token':
            raise errors.UnsupportedGrantTypeError(request=request)

        for validator in self.custom_validators.pre_token:
            validator(request)

        if request.refresh_token is None:
            raise errors.InvalidRequestError(
                description='Missing refresh token parameter.',
                request=request)

        # Because refresh tokens are typically long-lasting credentials used to
        # request additional access tokens, the refresh token is bound to the
        # client to which it was issued.  If the client type is confidential or
        # the client was issued client credentials (or assigned other
        # authentication requirements), the client MUST authenticate with the
        # authorization server as described in Section 3.2.1.
        # https://tools.ietf.org/html/rfc6749#section-3.2.1
        if self.request_validator.client_authentication_required(request):
            log.debug('Authenticating client, %r.', request)
            if not self.request_validator.authenticate_client(request):
                log.debug('Invalid client (%r), denying access.', request)
                raise errors.InvalidClientError(request=request)
            # Ensure that request.client_id is set.
            if request.client_id is None and request.client is not None:
                request.client_id = request.client.client_id
        elif not self.request_validator.authenticate_client_id(request.client_id, request):
            log.debug('Client authentication failed, %r.', request)
            raise errors.InvalidClientError(request=request)

        # Ensure client is authorized use of this grant type
        self.validate_grant_type(request)

        # REQUIRED. The refresh token issued to the client.
        log.debug('Validating refresh token %s for client %r.',
                  request.refresh_token, request.client)
        if not self.request_validator.validate_refresh_token(
                request.refresh_token, request.client, request):
            log.debug('Invalid refresh token, %s, for client %r.',
                      request.refresh_token, request.client)
            raise errors.InvalidGrantError(request=request)

        original_scopes = utils.scope_to_list(
            self.request_validator.get_original_scopes(
                request.refresh_token, request))

        if request.scope:
            request.scopes = utils.scope_to_list(request.scope)
            if (not all(s in original_scopes for s in request.scopes)
                and not self.request_validator.is_within_original_scope(
                    request.scopes, request.refresh_token, request)):
                log.debug('Refresh token %s lack requested scopes, %r.',
                          request.refresh_token, request.scopes)
                raise errors.InvalidScopeError(request=request)
        else:
            request.scopes = original_scopes

        for validator in self.custom_validators.post_token:
            validator(request)
