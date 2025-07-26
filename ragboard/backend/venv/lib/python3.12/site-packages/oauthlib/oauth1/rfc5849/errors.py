"""
oauthlib.oauth1.rfc5849.errors
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Error used both by OAuth 1 clients and provicers to represent the spec
defined error responses for all four core grant types.
"""
from oauthlib.common import add_params_to_uri, urlencode


class OAuth1Error(Exception):
    error = None
    description = ''

    def __init__(self, description=None, uri=None, status_code=400,
                 request=None):
        """
        description:    A human-readable ASCII [USASCII] text providing
                        additional information, used to assist the client
                        developer in understanding the error that occurred.
                        Values for the "error_description" parameter MUST NOT
                        include characters outside the set
                        x20-21 / x23-5B / x5D-7E.

        uri:    A URI identifying a human-readable web page with information
                about the error, used to provide the client developer with
                additional information about the error.  Values for the
                "error_uri" parameter MUST conform to the URI- Reference
                syntax, and thus MUST NOT include characters outside the set
                x21 / x23-5B / x5D-7E.

        state:  A CSRF protection value received from the client.

        request:  Oauthlib Request object
        """
        self.description = description or self.description
        message = '({}) {}'.format(self.error, self.description)
        if request:
            message += ' ' + repr(request)
        super().__init__(message)

        self.uri = uri
        self.status_code = status_code

    def in_uri(self, uri):
        return add_params_to_uri(uri, self.twotuples)

    @property
    def twotuples(self):
        error = [('error', self.error)]
        if self.description:
            error.append(('error_description', self.description))
        if self.uri:
            error.append(('error_uri', self.uri))
        return error

    @property
    def urlencoded(self):
        return urlencode(self.twotuples)


class InsecureTransportError(OAuth1Error):
    error = 'insecure_transport_protocol'
    description = 'Only HTTPS connections are permitted.'


class InvalidSignatureMethodError(OAuth1Error):
    error = 'invalid_signature_method'


class InvalidRequestError(OAuth1Error):
    error = 'invalid_request'


class InvalidClientError(OAuth1Error):
    error = 'invalid_client'
