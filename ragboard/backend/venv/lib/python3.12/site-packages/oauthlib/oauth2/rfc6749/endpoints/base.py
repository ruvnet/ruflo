"""
oauthlib.oauth2.rfc6749
~~~~~~~~~~~~~~~~~~~~~~~

This module is an implementation of various logic needed
for consuming and providing OAuth 2.0 RFC6749.
"""
import functools
import logging

from ..errors import (
    FatalClientError, InvalidClientError, InvalidRequestError, OAuth2Error,
    ServerError, TemporarilyUnavailableError, UnsupportedTokenTypeError,
)

log = logging.getLogger(__name__)


class BaseEndpoint:

    def __init__(self):
        self._available = True
        self._catch_errors = False
        self._valid_request_methods = None

    @property
    def valid_request_methods(self):
        return self._valid_request_methods

    @valid_request_methods.setter
    def valid_request_methods(self, valid_request_methods):
        if valid_request_methods is not None:
            valid_request_methods = [x.upper() for x in valid_request_methods]
        self._valid_request_methods = valid_request_methods


    @property
    def available(self):
        return self._available

    @available.setter
    def available(self, available):
        self._available = available

    @property
    def catch_errors(self):
        return self._catch_errors

    @catch_errors.setter
    def catch_errors(self, catch_errors):
        self._catch_errors = catch_errors

    def _raise_on_missing_token(self, request):
        """Raise error on missing token."""
        if not request.token:
            raise InvalidRequestError(request=request,
                                      description='Missing token parameter.')
    def _raise_on_invalid_client(self, request):
        """Raise on failed client authentication."""
        if self.request_validator.client_authentication_required(request):
            if not self.request_validator.authenticate_client(request):
                log.debug('Client authentication failed, %r.', request)
                raise InvalidClientError(request=request)
        elif not self.request_validator.authenticate_client_id(request.client_id, request):
            log.debug('Client authentication failed, %r.', request)
            raise InvalidClientError(request=request)

    def _raise_on_unsupported_token(self, request):
        """Raise on unsupported tokens."""
        if (request.token_type_hint and
            request.token_type_hint in self.valid_token_types and
            request.token_type_hint not in self.supported_token_types):
            raise UnsupportedTokenTypeError(request=request)

    def _raise_on_bad_method(self, request):
        if self.valid_request_methods is None:
            raise ValueError('Configure "valid_request_methods" property first')
        if request.http_method.upper() not in self.valid_request_methods:
            raise InvalidRequestError(request=request,
                                      description=('Unsupported request method %s' % request.http_method.upper()))

    def _raise_on_bad_post_request(self, request):
        """Raise if invalid POST request received
        """
        if request.http_method.upper() == 'POST':
            query_params = request.uri_query or ""
            if query_params:
                raise InvalidRequestError(request=request,
                                          description=('URL query parameters are not allowed'))

def catch_errors_and_unavailability(f):
    @functools.wraps(f)
    def wrapper(endpoint, uri, *args, **kwargs):
        if not endpoint.available:
            e = TemporarilyUnavailableError()
            log.info('Endpoint unavailable, ignoring request %s.' % uri)
            return {}, e.json, 503

        if endpoint.catch_errors:
            try:
                return f(endpoint, uri, *args, **kwargs)
            except OAuth2Error:
                raise
            except FatalClientError:
                raise
            except Exception as e:
                error = ServerError()
                log.warning(
                    'Exception caught while processing request, %s.' % e)
                return {}, error.json, 500
        else:
            return f(endpoint, uri, *args, **kwargs)
    return wrapper
