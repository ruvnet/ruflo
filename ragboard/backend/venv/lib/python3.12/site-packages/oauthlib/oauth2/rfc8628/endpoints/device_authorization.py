"""
oauthlib.oauth2.rfc8628
~~~~~~~~~~~~~~~~~~~~~~~

This module is an implementation of various logic needed
for consuming and providing OAuth 2.0 RFC8628.
"""

import logging
from typing import Callable

from oauthlib.common import Request, generate_token
from oauthlib.oauth2.rfc6749 import errors
from oauthlib.oauth2.rfc6749.endpoints.base import (
    BaseEndpoint,
    catch_errors_and_unavailability,
)

log = logging.getLogger(__name__)


class DeviceAuthorizationEndpoint(BaseEndpoint):
    """DeviceAuthorization endpoint - used by the client to initiate
    the authorization flow by requesting a set of verification codes
    from the authorization server by making an HTTP "POST" request to
    the device authorization endpoint.

    The client authentication requirements of Section 3.2.1 of [RFC6749]
    apply to requests on this endpoint, which means that confidential
    clients (those that have established client credentials) authenticate
    in the same manner as when making requests to the token endpoint, and
    public clients provide the "client_id" parameter to identify
    themselves.
    """

    def __init__(
        self,
        request_validator,
        verification_uri,
        expires_in=1800,
        interval=None,
        verification_uri_complete=None,
        user_code_generator: Callable[[None], str] = None,
    ):
        """
        :param request_validator: An instance of RequestValidator.
        :type request_validator: oauthlib.oauth2.rfc6749.RequestValidator.
        :param verification_uri: a string containing the URL that can be polled by the client application
        :param expires_in: a number that represents the lifetime of the `user_code` and `device_code`
        :param interval: an option number that represents the number of seconds between each poll requests
        :param verification_uri_complete: a string of a function that can be called with `user_data` as parameter
        :param user_code_generator: a callable that returns a configurable user code
        """
        self.request_validator = request_validator
        self._expires_in = expires_in
        self._interval = interval
        self._verification_uri = verification_uri
        self._verification_uri_complete = verification_uri_complete
        self.user_code_generator = user_code_generator

        BaseEndpoint.__init__(self)

    @property
    def interval(self):
        """The minimum amount of time in seconds that the client
        SHOULD wait between polling requests to the token endpoint.  If no
        value is provided, clients MUST use 5 as the default.
        """
        return self._interval

    @property
    def expires_in(self):
        """The lifetime in seconds of the "device_code" and "user_code"."""
        return self._expires_in

    @property
    def verification_uri(self):
        """The end-user verification URI on the authorization
        server.  The URI should be short and easy to remember as end users
        will be asked to manually type it into their user agent.
        """
        return self._verification_uri

    def verification_uri_complete(self, user_code):
        if not self._verification_uri_complete:
            return None
        if isinstance(self._verification_uri_complete, str):
            return self._verification_uri_complete.format(user_code=user_code)
        if callable(self._verification_uri_complete):
            return self._verification_uri_complete(user_code)
        return None

    @catch_errors_and_unavailability
    def validate_device_authorization_request(self, request):
        """Validate the device authorization request.

        The client_id is required if the client is not authenticating with the
        authorization server as described in `Section 3.2.1. of [RFC6749]`_.
        The client identifier as described in `Section 2.2 of [RFC6749]`_.

        .. _`Section 3.2.1. of [RFC6749]`: https://www.rfc-editor.org/rfc/rfc6749#section-3.2.1
        .. _`Section 2.2 of [RFC6749]`: https://www.rfc-editor.org/rfc/rfc6749#section-2.2
        """

        # First check duplicate parameters
        for param in ("client_id", "scope"):
            try:
                duplicate_params = request.duplicate_params
            except ValueError:
                raise errors.InvalidRequestFatalError(
                    description="Unable to parse query string", request=request
                )
            if param in duplicate_params:
                raise errors.InvalidRequestFatalError(
                    description="Duplicate %s parameter." % param, request=request
                )

        # the "application/x-www-form-urlencoded" format, per Appendix B of [RFC6749]
        # https://www.rfc-editor.org/rfc/rfc6749#appendix-B
        if request.headers["Content-Type"] != "application/x-www-form-urlencoded":
            raise errors.InvalidRequestError(
                "Content-Type must be application/x-www-form-urlencoded",
                request=request,
            )

        # REQUIRED. The client identifier as described in Section 2.2.
        # https://tools.ietf.org/html/rfc6749#section-2.2
        # TODO: extract client_id an helper validation function.
        if not request.client_id:
            raise errors.MissingClientIdError(request=request)

        if not self.request_validator.validate_client_id(request.client_id, request):
            raise errors.InvalidClientIdError(request=request)

        # The client authentication requirements of Section 3.2.1 of [RFC6749]
        # apply to requests on this endpoint, which means that confidential
        # clients (those that have established client credentials) authenticate
        # in the same manner as when making requests to the token endpoint, and
        # public clients provide the "client_id" parameter to identify
        # themselves.
        self._raise_on_invalid_client(request)

    @catch_errors_and_unavailability
    def create_device_authorization_response(
        self, uri, http_method="POST", body=None, headers=None
    ):
        """
           Generate a unique device verification code and an end-user code that are valid for a limited time.
           Include them in the HTTP response body using the "application/json" format [RFC8259] with a
           200 (OK) status code, as described in `Section-3.2`_.

           :param uri: The full URI of the token request.
           :type uri: str
           :param request: OAuthlib request.
           :type request: oauthlib.common.Request
           :param user_code_generator:
               A callable that returns a string for the user code.
               This allows the caller to decide how the `user_code` should be formatted.
           :type user_code_generator: Callable[[], str]
           :return: A tuple of three elements:
                    1. A dict of headers to set on the response.
                    2. The response body as a string.
                    3. The response status code as an integer.
           :rtype: tuple

           The response contains the following parameters:

           device_code
              **REQUIRED.** The device verification code.

           user_code
              **REQUIRED.** The end-user verification code.

           verification_uri
              **REQUIRED.** The end-user verification URI on the authorization server.
              The URI should be short and easy to remember as end users will be asked
              to manually type it into their user agent.

           verification_uri_complete
              **OPTIONAL.** A verification URI that includes the `user_code` (or
              other information with the same function as the `user_code`), which is
              designed for non-textual transmission.

           expires_in
              **REQUIRED.** The lifetime in seconds of the `device_code` and `user_code`.

           interval
              **OPTIONAL.** The minimum amount of time in seconds that the client
              SHOULD wait between polling requests to the token endpoint. If no
              value is provided, clients MUST use 5 as the default.

           **For example:**

              .. code-block:: http

                 HTTP/1.1 200 OK
                 Content-Type: application/json
                 Cache-Control: no-store

                 {
                   "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
                   "user_code": "WDJB-MJHT",
                   "verification_uri": "https://example.com/device",
                   "verification_uri_complete":
                       "https://example.com/device?user_code=WDJB-MJHT",
                   "expires_in": 1800,
                   "interval": 5
                 }

           .. _`Section-3.2`: https://www.rfc-editor.org/rfc/rfc8628#section-3.2
           """
        request = Request(uri, http_method, body, headers)
        self.validate_device_authorization_request(request)
        log.debug("Pre resource owner authorization validation ok for %r.", request)

        headers = {}
        user_code = self.user_code_generator() if self.user_code_generator else generate_token()
        data = {
            "verification_uri": self.verification_uri,
            "expires_in": self.expires_in,
            "user_code": user_code,
            "device_code": generate_token(),
        }
        if self.interval is not None:
            data["interval"] = self.interval


        verification_uri_complete = self.verification_uri_complete(user_code)
        if verification_uri_complete:
            data["verification_uri_complete"] = verification_uri_complete

        return headers, data, 200
