import logging

log = logging.getLogger(__name__)


class Dispatcher:
    default_grant = None
    oidc_grant = None


class AuthorizationCodeGrantDispatcher(Dispatcher):
    """
    This is an adapter class that will route simple Authorization Code
    requests, those that have `response_type=code` and a scope including
    `openid` to either the `default_grant` or the `oidc_grant` based on
    the scopes requested.
    """
    def __init__(self, default_grant=None, oidc_grant=None):
        self.default_grant = default_grant
        self.oidc_grant = oidc_grant

    def _handler_for_request(self, request):
        handler = self.default_grant

        if request.scopes and "openid" in request.scopes:
            handler = self.oidc_grant

        log.debug('Selecting handler for request %r.', handler)
        return handler

    def create_authorization_response(self, request, token_handler):
        """Read scope and route to the designated handler."""
        return self._handler_for_request(request).create_authorization_response(request, token_handler)

    def validate_authorization_request(self, request):
        """Read scope and route to the designated handler."""
        return self._handler_for_request(request).validate_authorization_request(request)


class ImplicitTokenGrantDispatcher(Dispatcher):
    """
    This is an adapter class that will route simple Authorization
    requests, those that have `id_token` in `response_type` and a scope
    including `openid` to either the `default_grant` or the `oidc_grant`
    based on the scopes requested.
    """
    def __init__(self, default_grant=None, oidc_grant=None):
        self.default_grant = default_grant
        self.oidc_grant = oidc_grant

    def _handler_for_request(self, request):
        handler = self.default_grant

        if request.scopes and "openid" in request.scopes and 'id_token' in request.response_type:
            handler = self.oidc_grant

        log.debug('Selecting handler for request %r.', handler)
        return handler

    def create_authorization_response(self, request, token_handler):
        """Read scope and route to the designated handler."""
        return self._handler_for_request(request).create_authorization_response(request, token_handler)

    def validate_authorization_request(self, request):
        """Read scope and route to the designated handler."""
        return self._handler_for_request(request).validate_authorization_request(request)


class AuthorizationTokenGrantDispatcher(Dispatcher):
    """
    This is an adapter class that will route simple Token requests, those that authorization_code have a scope
    including 'openid' to either the default_grant or the oidc_grant based on the scopes requested.
    """
    def __init__(self, request_validator, default_grant=None, oidc_grant=None):
        self.default_grant = default_grant
        self.oidc_grant = oidc_grant
        self.request_validator = request_validator

    def _handler_for_request(self, request):
        handler = self.default_grant
        scopes = ()
        parameters = dict(request.decoded_body)
        client_id = parameters.get('client_id')
        code = parameters.get('code')
        redirect_uri = parameters.get('redirect_uri')

        # If code is not present fallback to `default_grant` which will
        # raise an error for the missing `code` in `create_token_response` step.
        if code:
            scopes = self.request_validator.get_authorization_code_scopes(client_id, code, redirect_uri, request)

        if 'openid' in scopes:
            handler = self.oidc_grant

        log.debug('Selecting handler for request %r.', handler)
        return handler

    def create_token_response(self, request, token_handler):
        """Read scope and route to the designated handler."""
        handler = self._handler_for_request(request)
        return handler.create_token_response(request, token_handler)
