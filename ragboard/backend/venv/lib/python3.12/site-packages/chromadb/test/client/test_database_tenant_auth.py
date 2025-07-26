from typing import Dict
from fastapi import HTTPException
from overrides import override
from chromadb.auth import (
    AuthzAction,
    AuthzResource,
    ServerAuthenticationProvider,
    ServerAuthorizationProvider,
    UserIdentity,
)
from chromadb.config import System


class ExampleAuthenticationProvider(ServerAuthenticationProvider):
    """In practice the tenant would likely be resolved from some other opaque value (e.g. key/token). Here, it's just passed directly as a header for simplicity."""

    @override
    def authenticate_or_raise(self, headers: Dict[str, str]) -> UserIdentity:
        return UserIdentity(
            user_id="test",
            tenant=headers.get("x-tenant", None),
        )


class ExampleAuthorizationProvider(ServerAuthorizationProvider):
    """A simple authz provider that asserts the user's tenant matches the resource's tenant."""

    def __init__(self, system: System) -> None:
        super().__init__(system)
        self._settings = system.settings

    @override
    def authorize_or_raise(
        self, user: UserIdentity, action: AuthzAction, resource: AuthzResource
    ) -> None:
        if user.tenant is None:
            return

        if action == AuthzAction.RESET:
            return

        if user.tenant != resource.tenant:
            raise HTTPException(status_code=403, detail="Unauthorized")
