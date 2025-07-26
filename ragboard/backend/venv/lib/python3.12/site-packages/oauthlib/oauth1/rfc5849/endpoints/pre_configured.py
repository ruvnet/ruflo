from . import (
    AccessTokenEndpoint, AuthorizationEndpoint, RequestTokenEndpoint,
    ResourceEndpoint,
)


class WebApplicationServer(RequestTokenEndpoint, AuthorizationEndpoint,
                           AccessTokenEndpoint, ResourceEndpoint):

    def __init__(self, request_validator):
        RequestTokenEndpoint.__init__(self, request_validator)
        AuthorizationEndpoint.__init__(self, request_validator)
        AccessTokenEndpoint.__init__(self, request_validator)
        ResourceEndpoint.__init__(self, request_validator)
