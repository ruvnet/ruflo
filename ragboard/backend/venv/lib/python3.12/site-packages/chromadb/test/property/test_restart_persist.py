from overrides import overrides
from chromadb.api.client import Client
from chromadb.config import System
import hypothesis.strategies as st
from hypothesis.stateful import (
    rule,
    run_state_machine_as_test,
    initialize,
)

from chromadb.test.property.test_embeddings import (
    EmbeddingStateMachineBase,
    EmbeddingStateMachineStates,
    trace,
)
import chromadb.test.property.strategies as strategies
import os


collection_persistent_st = st.shared(
    strategies.collections(
        with_hnsw_params=True,
        with_persistent_hnsw_params=st.just(True),
        # Makes it more likely to find persist-related bugs (by default these are set to 2000).
        max_hnsw_batch_size=10,
        max_hnsw_sync_threshold=10,
    ),
    key="coll_persistent",
)


# This machine shares a lot of similarity with the machine in chromadb/test/property/test_persist.py.
# However, test_persist.py tests correctness under complete process isolation and therefore can only check invariants on a new system--whereas this machine does not have full process isolation between systems/clients but after a restart continues to exercise the state machine with the newly-created system.
class RestartablePersistedEmbeddingStateMachine(EmbeddingStateMachineBase):
    system: System

    def __init__(self, system: System) -> None:
        self.system = system
        client = Client.from_system(system)
        super().__init__(client)

    @initialize(collection=collection_persistent_st)  # type: ignore
    @overrides
    def initialize(self, collection: strategies.Collection):
        self.client.reset()

        self.collection = self.client.create_collection(
            name=collection.name,
            metadata=collection.metadata,  # type: ignore
            embedding_function=collection.embedding_function,
        )
        self.embedding_function = collection.embedding_function
        trace("init")
        self.on_state_change(EmbeddingStateMachineStates.initialize)

        self.record_set_state = strategies.StateMachineRecordSet(
            ids=[], metadatas=[], documents=[], embeddings=[]
        )

    @rule()
    def restart_system(self) -> None:
        # Simulates restarting chromadb
        self.system.stop()
        self.system = System(self.system.settings)
        self.system.start()
        self.client.clear_system_cache()
        self.client = Client.from_system(self.system)
        self.collection = self.client.get_collection(
            self.collection.name, embedding_function=self.embedding_function
        )

    @overrides
    def teardown(self) -> None:
        super().teardown()
        # Need to manually stop the system to cleanup resources because we may have created a new system (above rule).
        # Normally, we wouldn't have to worry about this as the system from the fixture is shared between state machine runs.
        # (This helps avoid a "too many open files" error.)
        self.system.stop()


def test_restart_persisted_client(sqlite_persistent: System) -> None:
    # TODO: This test is broken for rust bindings and should be fixed
    if sqlite_persistent.settings.chroma_api_impl != "chromadb.api.rust.RustBindingsAPI":
        run_state_machine_as_test(
            lambda: RestartablePersistedEmbeddingStateMachine(sqlite_persistent),
        )  # type: ignore
