from oauthlib.oauth2 import RequestValidator as OAuth2RequestValidator


class RequestValidator(OAuth2RequestValidator):
    def client_authentication_required(self, request, *args, **kwargs):
        """Determine if client authentication is required for current request.

        According to the rfc8628, client authentication is required in the following cases:
            - Device Authorization Request follows the, the client authentication requirements
              of Section 3.2.1 of [RFC6749] apply to requests on this endpoint, which means that
              confidential clients (those that have established client credentials) authenticate
              in the same manner as when making requests to the token endpoint, and
              public clients provide the "client_id" parameter to identify themselves,
              see `Section 3.1`_.

        :param request: OAuthlib request.
        :type request: oauthlib.common.Request
        :rtype: True or False

        Method is used by:
            - Device Authorization Request

        .. _`Section 3.1`: https://www.rfc-editor.org/rfc/rfc8628#section-3.1
        """
        return True
