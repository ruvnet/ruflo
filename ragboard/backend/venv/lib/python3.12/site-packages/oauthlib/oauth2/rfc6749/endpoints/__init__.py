"""
oauthlib.oauth2.rfc6749
~~~~~~~~~~~~~~~~~~~~~~~

This module is an implementation of various logic needed
for consuming and providing OAuth 2.0 RFC6749.
"""
from .authorization import AuthorizationEndpoint
from .introspect import IntrospectEndpoint
from .metadata import MetadataEndpoint
from .pre_configured import (
    BackendApplicationServer, LegacyApplicationServer, MobileApplicationServer,
    Server, WebApplicationServer,
)
from .resource import ResourceEndpoint
from .revocation import RevocationEndpoint
from .token import TokenEndpoint
