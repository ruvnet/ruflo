from oauthlib.oauth2.rfc8628.endpoints.device_authorization import (
    DeviceAuthorizationEndpoint,
)

from typing import Callable, Optional
from oauthlib.openid.connect.core.request_validator import RequestValidator


class DeviceApplicationServer(DeviceAuthorizationEndpoint):
    """An all-in-one endpoint featuring Authorization code grant and Bearer tokens."""

    def __init__(
        self,
        request_validator: RequestValidator,
        verification_uri: str,
        interval: int = 5,
        verification_uri_complete: Optional[str] = None,  # noqa: FA100
        user_code_generator: Callable[[None], str] = None,
        **kwargs,
    ):
        """Construct a new web application server.

        :param request_validator: An implementation of
                                  oauthlib.oauth2.rfc8626.RequestValidator.
        :param interval: How long the device needs to wait before polling the server
        :param verification_uri: the verification_uri to be send back.
        :param user_code_generator: a callable that allows the user code to be configured.
        """
        DeviceAuthorizationEndpoint.__init__(
            self,
            request_validator,
            interval=interval,
            verification_uri=verification_uri,
            user_code_generator=user_code_generator,
            verification_uri_complete=verification_uri_complete,
        )
