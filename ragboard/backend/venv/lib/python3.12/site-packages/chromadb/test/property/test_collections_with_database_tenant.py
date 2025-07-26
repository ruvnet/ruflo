import logging
from typing import Dict, Optional, Tuple
import pytest
from chromadb.api import AdminAPI
import chromadb.api.types as types
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT
from chromadb.test.conftest import ClientFactories
from chromadb.test.property.test_collections import CollectionStateMachine
from hypothesis.stateful import (
    Bundle,
    rule,
    initialize,
    multiple,
    run_state_machine_as_test,
    MultipleResults,
)
import chromadb.test.property.strategies as strategies


class TenantDatabaseCollectionStateMachine(CollectionStateMachine):
    """A collection state machine test that includes tenant and database information,
    and switches between them."""

    tenants: Bundle  # [str]
    databases: Bundle  # [Tuple[str, str]]  # database to tenant it belongs to
    tenant_to_database_to_model: Dict[
        str, Dict[str, Dict[str, Optional[types.CollectionMetadata]]]
    ]
    admin_client: AdminAPI
    curr_tenant: str
    curr_database: str

    tenants = Bundle("tenants")
    databases = Bundle("databases")

    def __init__(self, client_factories: ClientFactories):
        client = client_factories.create_client()
        super().__init__(client)
        self.client = client
        self.admin_client = client_factories.create_admin_client_from_system()

    @initialize()
    def initialize(self) -> None:
        self.client.reset()
        self.tenant_to_database_to_model = {}
        self.curr_tenant = DEFAULT_TENANT
        self.curr_database = DEFAULT_DATABASE
        self.client.set_tenant(DEFAULT_TENANT, DEFAULT_DATABASE)
        self.set_tenant_model(self.curr_tenant, {})
        self.set_database_model_for_tenant(self.curr_tenant, self.curr_database, {})

    @rule(target=tenants, name=strategies.tenant_database_name)
    def create_tenant(self, name: str) -> MultipleResults:  # [str]:
        tenant = self.overwrite_tenant(name)
        # Check if tenant already exists
        if self.has_tenant(tenant):
            with pytest.raises(Exception):
                self.admin_client.create_tenant(tenant)
            return multiple()

        self.admin_client.create_tenant(tenant)
        # When we create a tenant, create a default database for it just for testing
        # since the state machine could call collection operations before creating a
        # database
        self.admin_client.create_database(DEFAULT_DATABASE, tenant=tenant)
        self.set_tenant_model(tenant, {})
        self.set_database_model_for_tenant(tenant, DEFAULT_DATABASE, {})
        return multiple(tenant)

    @rule(target=databases, name=strategies.tenant_database_name)
    def create_database(self, name: str) -> MultipleResults:  # [Tuple[str, str]]:
        database = self.overwrite_database(name)
        tenant = self.overwrite_tenant(self.curr_tenant)
        # If database already exists in current tenant, raise an error
        if self.has_database_for_tenant(tenant, database):
            with pytest.raises(Exception):
                self.admin_client.create_database(name=database, tenant=tenant)
            return multiple()

        self.admin_client.create_database(name=database, tenant=tenant)
        self.set_database_model_for_tenant(
            tenant=tenant, database=database, database_model={}
        )
        return multiple((database, tenant))

    @rule(database=databases)
    def set_database_and_tenant(self, database: Tuple[str, str]) -> None:
        # Get a database and switch to the database and the tenant it belongs to
        database_name = database[0]
        tenant_name = database[1]
        self.set_api_tenant_database(tenant_name, database_name)
        self.curr_database = database_name
        self.curr_tenant = tenant_name

    @rule(tenant=tenants)
    def set_tenant(self, tenant: str) -> None:
        self.set_api_tenant_database(tenant, DEFAULT_DATABASE)
        self.curr_tenant = tenant
        self.curr_database = DEFAULT_DATABASE

    # These methods allow other tests, namely
    # test_collections_with_database_tenant_override.py, to swap out the model
    # without needing to do a bunch of pythonic cleverness to fake a dict which
    # preteds to have every key.
    def set_api_tenant_database(self, tenant: str, database: str) -> None:
        self.client.set_tenant(tenant, database)

    # For calls to create_database, and create_tenant we may want to override the tenant and database
    # This is a leaky abstraction that exists soley for the purpose of
    # test_collections_with_database_tenant_override.py
    def overwrite_tenant(self, tenant: str) -> str:
        return tenant

    def overwrite_database(self, database: str) -> str:
        return database

    def has_tenant(self, tenant: str) -> bool:
        return tenant in self.tenant_to_database_to_model

    def get_tenant_model(
        self, tenant: str
    ) -> Dict[str, Dict[str, Optional[types.CollectionMetadata]]]:
        return self.tenant_to_database_to_model[tenant]

    def set_tenant_model(
        self,
        tenant: str,
        model: Dict[str, Dict[str, Optional[types.CollectionMetadata]]],
    ) -> None:
        self.tenant_to_database_to_model[tenant] = model

    def has_database_for_tenant(self, tenant: str, database: str) -> bool:
        return database in self.tenant_to_database_to_model[tenant]

    def set_database_model_for_tenant(
        self,
        tenant: str,
        database: str,
        database_model: Dict[str, Optional[types.CollectionMetadata]],
    ) -> None:
        self.tenant_to_database_to_model[tenant][database] = database_model

    @property
    def model(self) -> Dict[str, Optional[types.CollectionMetadata]]:
        return self.tenant_to_database_to_model[self.curr_tenant][self.curr_database]


def test_collections(
    caplog: pytest.LogCaptureFixture, client_factories: ClientFactories
) -> None:
    caplog.set_level(logging.ERROR)
    run_state_machine_as_test(lambda: TenantDatabaseCollectionStateMachine(client_factories))  # type: ignore
