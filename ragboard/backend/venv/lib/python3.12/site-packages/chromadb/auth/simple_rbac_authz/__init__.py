import logging
from typing import Dict, Set
from overrides import override
import yaml
from chromadb.auth import (
    AuthzAction,
    AuthzResource,
    UserIdentity,
    ServerAuthorizationProvider,
)
from chromadb.config import System
from fastapi import HTTPException

from chromadb.telemetry.opentelemetry import (
    OpenTelemetryGranularity,
    trace_method,
)


logger = logging.getLogger(__name__)


class SimpleRBACAuthorizationProvider(ServerAuthorizationProvider):
    """
    A simple Role-Based Access Control (RBAC) authorization provider. This
    provider reads a configuration file that maps users to roles, and roles to
    actions. The provider then checks if the user has the action they are
    attempting to perform.

    For an example of an RBAC configuration file, see
    examples/basic_functionality/authz/authz.yaml.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)
        self._settings = system.settings
        self._config = yaml.safe_load("\n".join(self.read_config_or_config_file()))

        # We favor preprocessing here to avoid having to parse the config file
        # on every request. This AuthorizationProvider does not support
        # per-resource authorization so we just map the user ID to the
        # permissions they have. We're not worried about the size of this dict
        # since users are all specified in the file -- anyone with a gigantic
        # number of users can roll their own AuthorizationProvider.
        self._permissions: Dict[str, Set[str]] = {}
        for user in self._config["users"]:
            _actions = self._config["roles_mapping"][user["role"]]["actions"]
            self._permissions[user["id"]] = set(_actions)
        logger.info(
            "Authorization Provider SimpleRBACAuthorizationProvider " "initialized"
        )

    @trace_method(
        "SimpleRBACAuthorizationProvider.authorize",
        OpenTelemetryGranularity.ALL,
    )
    @override
    def authorize_or_raise(
        self, user: UserIdentity, action: AuthzAction, resource: AuthzResource
    ) -> None:
        policy_decision = False
        if (
            user.user_id in self._permissions
            and action in self._permissions[user.user_id]
        ):
            policy_decision = True

        logger.debug(
            f"Authorization decision: Access "
            f"{'granted' if policy_decision else 'denied'} for "
            f"user [{user.user_id}] attempting to "
            f"[{action}] [{resource}]"
        )
        if not policy_decision:
            raise HTTPException(status_code=403, detail="Forbidden")
