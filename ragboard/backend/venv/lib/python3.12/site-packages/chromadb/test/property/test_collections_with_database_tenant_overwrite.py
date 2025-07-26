from typing import Dict, Optional, Tuple
from overrides import overrides
from hypothesis.stateful import (
    initialize,
    invariant,
    rule,
    run_state_machine_as_test,
)

import uuid
import logging
import pytest
from chromadb.api import AdminAPI
from chromadb.api.client import AdminClient, Client
from chromadb.config import Settings, System
from chromadb.test.conftest import (
    ClientFactories,
    fastapi_fixture_admin_and_singleton_tenant_db_user,
)
from chromadb.test.property.test_collections_with_database_tenant import (
    TenantDatabaseCollectionStateMachine,
)
import chromadb.test.property.strategies as strategies
import numpy
import chromadb.api.types as types

# See conftest.py
SINGLETON_TENANT = "singleton_tenant"
SINGLETON_DATABASE = "singleton_database"


class SingletonTenantDatabaseCollectionStateMachine(
    TenantDatabaseCollectionStateMachine
):
    singleton_client: Client
    singleton_admin_client: AdminAPI
    root_client: Client
    root_admin_client: AdminAPI

    def __init__(
        self,
        singleton_client: Client,
        root_client: Client,
        client_factories: ClientFactories,
    ) -> None:
        super().__init__(client_factories)
        self.root_client = root_client
        self.root_admin_client = self.admin_client

        self.singleton_client = singleton_client
        self.singleton_admin_client = AdminClient.from_system(singleton_client._system)

    @initialize()
    def initialize(self) -> None:
        # Make sure we're back to the root client and admin client before
        # doing reset/initialize things.
        self.client = self.root_client
        self.admin_client = self.root_admin_client

        super().initialize()

        self.root_admin_client.create_tenant(SINGLETON_TENANT)
        self.root_admin_client.create_database(SINGLETON_DATABASE, SINGLETON_TENANT)

        self.set_tenant_model(SINGLETON_TENANT, {})
        self.set_database_model_for_tenant(SINGLETON_TENANT, SINGLETON_DATABASE, {})

    @invariant()
    def check_api_and_admin_client_are_in_sync(self) -> None:
        if self.client == self.singleton_client:
            assert self.admin_client == self.singleton_admin_client
        else:
            assert self.admin_client == self.root_admin_client

    @rule()
    def change_clients(self) -> None:
        if self.client == self.singleton_client:
            self.client = self.root_client
            self.admin_client = self.root_admin_client
        else:
            self.client = self.singleton_client
            self.admin_client = self.singleton_admin_client

    @overrides
    def set_api_tenant_database(self, tenant: str, database: str) -> None:
        self.root_client.set_tenant(tenant, database)

    @overrides
    def get_tenant_model(
        self, tenant: str
    ) -> Dict[str, Dict[str, Optional[types.CollectionMetadata]]]:
        if self.client == self.singleton_client:
            tenant = SINGLETON_TENANT
        return self.tenant_to_database_to_model[tenant]

    @overrides
    def set_tenant_model(
        self,
        tenant: str,
        model: Dict[str, Dict[str, Optional[types.CollectionMetadata]]],
    ) -> None:
        if self.client == self.singleton_client:
            # This never happens because we never actually issue a
            # create_tenant call on singleton_tenant:
            # thanks to the above overriding of get_tenant_model(),
            # the underlying state machine test should always expect an error
            # when it sends the request, so shouldn't try to update the model.
            raise ValueError("trying to overwrite the model for singleton??")
        self.tenant_to_database_to_model[tenant] = model

    @overrides
    def set_database_model_for_tenant(
        self,
        tenant: str,
        database: str,
        database_model: Dict[str, Optional[types.CollectionMetadata]],
    ) -> None:
        if self.client == self.singleton_client:
            # This never happens because we never actually issue a
            # create_database call on (singleton_tenant, singleton_database):
            # thanks to the above overriding of has_database_for_tenant(),
            # the underlying state machine test should always expect an error
            # when it sends the request, so shouldn't try to update the model.
            raise ValueError("trying to overwrite the model for singleton??")
        self.tenant_to_database_to_model[tenant][database] = database_model

    @overrides
    def overwrite_database(self, database: str) -> str:
        if self.client == self.singleton_client:
            return SINGLETON_DATABASE
        return database

    @overrides
    def overwrite_tenant(self, tenant: str) -> str:
        if self.client == self.singleton_client:
            return SINGLETON_TENANT
        return tenant

    @property
    def model(self) -> Dict[str, Optional[types.CollectionMetadata]]:
        if self.client == self.singleton_client:
            return self.tenant_to_database_to_model[SINGLETON_TENANT][
                SINGLETON_DATABASE
            ]
        return self.tenant_to_database_to_model[self.curr_tenant][self.curr_database]


def _singleton_and_root_clients() -> Tuple[Client, Client, ClientFactories]:
    api_fixture = fastapi_fixture_admin_and_singleton_tenant_db_user()
    sys: System = next(api_fixture)
    sys.reset_state()
    client_factories = ClientFactories(sys)
    root_client = client_factories.create_client()
    _root_admin_client = client_factories.create_admin_client_from_system()

    # This is a little awkward but we have to create the tenant and DB
    # before we can instantiate a Client which connects to them. This also
    # means we need to manually populate state in the state machine.
    _root_admin_client.create_tenant(SINGLETON_TENANT)
    _root_admin_client.create_database(SINGLETON_DATABASE, SINGLETON_TENANT)

    singleton_settings = Settings(**dict(sys.settings))
    singleton_settings.chroma_client_auth_credentials = "singleton-token"
    singleton_system = System(singleton_settings)
    singleton_system.start()
    singleton_client = Client.from_system(singleton_system)

    return singleton_client, root_client, client_factories


def test_collections_with_tenant_database_overwrite(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.ERROR)

    singleton_client, root_client, client_factories = _singleton_and_root_clients()
    run_state_machine_as_test(
        lambda: SingletonTenantDatabaseCollectionStateMachine(
            singleton_client, root_client, client_factories
        )
    )  # type: ignore


def test_repeat_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.ERROR)

    singleton_client, root_client, client_factories = _singleton_and_root_clients()

    state = SingletonTenantDatabaseCollectionStateMachine(
        singleton_client, root_client, client_factories
    )
    state.initialize()
    state.check_api_and_admin_client_are_in_sync()
    state.change_clients()
    state.check_api_and_admin_client_are_in_sync()
    state.create_coll(
        coll=strategies.Collection(
            name="A00",
            metadata=None,
            embedding_function=strategies.hashing_embedding_function(
                dim=2, dtype=numpy.float16  # type: ignore
            ),
            id=uuid.UUID("c9bcb72f-92b1-4604-a8cb-084162dfe98b"),
            dimension=2,
            dtype=numpy.float16,
            known_metadata_keys={},
            known_document_keywords=[],
            has_documents=False,
            has_embeddings=True,
        )
    )
    state.teardown()  # type: ignore
