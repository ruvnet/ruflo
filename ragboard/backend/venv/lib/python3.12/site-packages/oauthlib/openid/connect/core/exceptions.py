"""
oauthlib.oauth2.rfc6749.errors
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Error used both by OAuth 2 clients and providers to represent the spec
defined error responses for all four core grant types.
"""
import inspect
import sys

from oauthlib.oauth2.rfc6749.errors import FatalClientError, OAuth2Error


class FatalOpenIDClientError(FatalClientError):
    pass


class OpenIDClientError(OAuth2Error):
    pass


class InteractionRequired(OpenIDClientError):
    """
    The Authorization Server requires End-User interaction to proceed.

    This error MAY be returned when the prompt parameter value in the
    Authentication Request is none, but the Authentication Request cannot be
    completed without displaying a user interface for End-User interaction.
    """
    error = 'interaction_required'
    status_code = 401


class LoginRequired(OpenIDClientError):
    """
    The Authorization Server requires End-User authentication.

    This error MAY be returned when the prompt parameter value in the
    Authentication Request is none, but the Authentication Request cannot be
    completed without displaying a user interface for End-User authentication.
    """
    error = 'login_required'
    status_code = 401


class AccountSelectionRequired(OpenIDClientError):
    """
    The End-User is REQUIRED to select a session at the Authorization Server.

    The End-User MAY be authenticated at the Authorization Server with
    different associated accounts, but the End-User did not select a session.
    This error MAY be returned when the prompt parameter value in the
    Authentication Request is none, but the Authentication Request cannot be
    completed without displaying a user interface to prompt for a session to
    use.
    """
    error = 'account_selection_required'


class ConsentRequired(OpenIDClientError):
    """
    The Authorization Server requires End-User consent.

    This error MAY be returned when the prompt parameter value in the
    Authentication Request is none, but the Authentication Request cannot be
    completed without displaying a user interface for End-User consent.
    """
    error = 'consent_required'
    status_code = 401


class InvalidRequestURI(OpenIDClientError):
    """
    The request_uri in the Authorization Request returns an error or
    contains invalid data.
    """
    error = 'invalid_request_uri'
    description = ('The request_uri in the Authorization Request returns an '
                  'error or contains invalid data.')


class InvalidRequestObject(OpenIDClientError):
    """
    The request parameter contains an invalid Request Object.
    """
    error = 'invalid_request_object'
    description = 'The request parameter contains an invalid Request Object.'


class RequestNotSupported(OpenIDClientError):
    """
    The OP does not support use of the request parameter.
    """
    error = 'request_not_supported'
    description = 'The request parameter is not supported.'


class RequestURINotSupported(OpenIDClientError):
    """
    The OP does not support use of the request_uri parameter.
    """
    error = 'request_uri_not_supported'
    description = 'The request_uri parameter is not supported.'


class RegistrationNotSupported(OpenIDClientError):
    """
    The OP does not support use of the registration parameter.
    """
    error = 'registration_not_supported'
    description = 'The registration parameter is not supported.'


class InvalidTokenError(OAuth2Error):
    """
    The access token provided is expired, revoked, malformed, or
    invalid for other reasons.  The resource SHOULD respond with
    the HTTP 401 (Unauthorized) status code.  The client MAY
    request a new access token and retry the protected resource
    request.
    """
    error = 'invalid_token'
    status_code = 401
    description = ("The access token provided is expired, revoked, malformed, "
                   "or invalid for other reasons.")


class InsufficientScopeError(OAuth2Error):
    """
    The request requires higher privileges than provided by the
    access token.  The resource server SHOULD respond with the HTTP
    403 (Forbidden) status code and MAY include the "scope"
    attribute with the scope necessary to access the protected
    resource.
    """
    error = 'insufficient_scope'
    status_code = 403
    description = ("The request requires higher privileges than provided by "
                   "the access token.")


def raise_from_error(error, params=None):
    kwargs = {
        'description': params.get('error_description'),
        'uri': params.get('error_uri'),
        'state': params.get('state')
    }
    for _, cls in inspect.getmembers(sys.modules[__name__], inspect.isclass):
        if cls.error == error:
            raise cls(**kwargs)
