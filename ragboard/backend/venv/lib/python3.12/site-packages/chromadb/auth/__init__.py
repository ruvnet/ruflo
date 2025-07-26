from __future__ import annotations

from abc import abstractmethod
from enum import Enum
from typing import (
    Any,
    List,
    Optional,
    Dict,
    Tuple,
    TypeVar,
)
from dataclasses import dataclass

from pydantic import SecretStr

from chromadb.config import (
    Component,
    System,
)

T = TypeVar("T")
S = TypeVar("S")


class AuthError(Exception):
    pass


ClientAuthHeaders = Dict[str, SecretStr]


class ClientAuthProvider(Component):
    """
    ClientAuthProvider is responsible for providing authentication headers for
    client requests. Client implementations (in our case, just the FastAPI
    client) must inject these headers into their requests.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)

    @abstractmethod
    def authenticate(self) -> ClientAuthHeaders:
        pass


@dataclass
class UserIdentity:
    """
    UserIdentity represents the identity of a user. In general, not all fields
    will be populated, and the fields that are populated will depend on the
    authentication provider.

    The idea is that the AuthenticationProvider is responsible for populating
    _all_ information known about the user, and the AuthorizationProvider is
    responsible for making decisions based on that information.
    """

    user_id: str
    tenant: Optional[str] = None
    databases: Optional[List[str]] = None
    # This can be used for any additional auth context which needs to be
    # propagated from the authentication provider to the authorization
    # provider.
    attributes: Optional[Dict[str, Any]] = None


class ServerAuthenticationProvider(Component):
    """
    ServerAuthenticationProvider is responsible for authenticating requests. If
    a ServerAuthenticationProvider is configured, it will be called by the
    server to authenticate requests. If no ServerAuthenticationProvider is
    configured, all requests will be authenticated.

    The ServerAuthenticationProvider should return a UserIdentity object if the
    request is authenticated for use by the ServerAuthorizationProvider.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)
        self._ignore_auth_paths: Dict[
            str, List[str]
        ] = system.settings.chroma_server_auth_ignore_paths
        self.overwrite_singleton_tenant_database_access_from_auth = (
            system.settings.chroma_overwrite_singleton_tenant_database_access_from_auth
        )

    @abstractmethod
    def authenticate_or_raise(self, headers: Dict[str, str]) -> UserIdentity:
        pass

    def ignore_operation(self, verb: str, path: str) -> bool:
        if (
            path in self._ignore_auth_paths.keys()
            and verb.upper() in self._ignore_auth_paths[path]
        ):
            return True
        return False

    def read_creds_or_creds_file(self) -> List[str]:
        _creds_file = None
        _creds = None

        if self._system.settings.chroma_server_authn_credentials_file:
            _creds_file = str(
                self._system.settings["chroma_server_authn_credentials_file"]
            )
        if self._system.settings.chroma_server_authn_credentials:
            _creds = str(self._system.settings["chroma_server_authn_credentials"])
        if not _creds_file and not _creds:
            raise ValueError(
                "No credentials file or credentials found in "
                "[chroma_server_authn_credentials]."
            )
        if _creds_file and _creds:
            raise ValueError(
                "Both credentials file and credentials found."
                "Please provide only one."
            )
        if _creds:
            return [c for c in _creds.split("\n") if c]
        elif _creds_file:
            with open(_creds_file, "r") as f:
                return f.readlines()
        raise ValueError("Should never happen")

    def singleton_tenant_database_if_applicable(
        self, user: Optional[UserIdentity]
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        If settings.chroma_overwrite_singleton_tenant_database_access_from_auth
        is False, this function always returns (None, None).

        If settings.chroma_overwrite_singleton_tenant_database_access_from_auth
        is True, follows the following logic:
        - If the user only has access to a single tenant, this function will
          return that tenant as its first return value.
        - If the user only has access to a single database, this function will
          return that database as its second return value. If the user has
          access to multiple tenants and/or databases, including "*", this
          function will return None for the corresponding value(s).
        - If the user has access to multiple tenants and/or databases this
          function will return None for the corresponding value(s).
        """
        if not self.overwrite_singleton_tenant_database_access_from_auth or not user:
            return None, None
        tenant = None
        database = None
        if user.tenant and user.tenant != "*":
            tenant = user.tenant
        if user.databases and len(user.databases) == 1 and user.databases[0] != "*":
            database = user.databases[0]
        return tenant, database


class AuthzAction(str, Enum):
    """
    The set of actions that can be authorized by the authorization provider.
    """

    RESET = "system:reset"
    CREATE_TENANT = "tenant:create_tenant"
    GET_TENANT = "tenant:get_tenant"
    CREATE_DATABASE = "db:create_database"
    GET_DATABASE = "db:get_database"
    DELETE_DATABASE = "db:delete_database"
    LIST_DATABASES = "db:list_databases"
    LIST_COLLECTIONS = "db:list_collections"
    COUNT_COLLECTIONS = "db:count_collections"
    CREATE_COLLECTION = "db:create_collection"
    GET_OR_CREATE_COLLECTION = "db:get_or_create_collection"
    GET_COLLECTION = "collection:get_collection"
    DELETE_COLLECTION = "collection:delete_collection"
    UPDATE_COLLECTION = "collection:update_collection"
    ADD = "collection:add"
    DELETE = "collection:delete"
    GET = "collection:get"
    QUERY = "collection:query"
    COUNT = "collection:count"
    UPDATE = "collection:update"
    UPSERT = "collection:upsert"


@dataclass
class AuthzResource:
    """
    The resource being accessed in an authorization request.
    """

    tenant: Optional[str]
    database: Optional[str]
    collection: Optional[str]


class ServerAuthorizationProvider(Component):
    """
    ServerAuthorizationProvider is responsible for authorizing requests. If a
    ServerAuthorizationProvider is configured, it will be called by the server
    to authorize requests. If no ServerAuthorizationProvider is configured, all
    requests will be authorized.

    ServerAuthorizationProvider should raise an exception if the request is not
    authorized.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)

    @abstractmethod
    def authorize_or_raise(
        self, user: UserIdentity, action: AuthzAction, resource: AuthzResource
    ) -> None:
        pass

    def read_config_or_config_file(self) -> List[str]:
        _config_file = None
        _config = None
        if self._system.settings.chroma_server_authz_config_file:
            _config_file = self._system.settings["chroma_server_authz_config_file"]
        if self._system.settings.chroma_server_authz_config:
            _config = str(self._system.settings["chroma_server_authz_config"])
        if not _config_file and not _config:
            raise ValueError(
                "No authz configuration file or authz configuration found."
            )
        if _config_file and _config:
            raise ValueError(
                "Both authz configuration file and authz configuration found."
                "Please provide only one."
            )
        if _config:
            return [c for c in _config.split("\n") if c]
        elif _config_file:
            with open(_config_file, "r") as f:
                return f.readlines()
        raise ValueError("Should never happen")
