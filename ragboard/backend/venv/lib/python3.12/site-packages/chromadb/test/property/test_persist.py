import logging
import multiprocessing
from multiprocessing.connection import Connection
import multiprocessing.context
import time
from typing import Generator, Callable, List, Tuple, cast
from uuid import UUID
from hypothesis import given
import hypothesis.strategies as st
import pytest
import chromadb
from chromadb.api import ClientAPI, ServerAPI
from chromadb.config import Settings, System
from chromadb.segment import VectorReader
from chromadb.segment.impl.manager.local import LocalSegmentManager
import chromadb.test.property.strategies as strategies
import chromadb.test.property.invariants as invariants
from chromadb.test.property.strategies import hashing_embedding_function
from chromadb.test.property.test_embeddings import (
    EmbeddingStateMachineStates,
    trace,
    EmbeddingStateMachineBase,
)
from hypothesis.stateful import (
    run_state_machine_as_test,
    rule,
    precondition,
    initialize,
    MultipleResults,
)
import os
from chromadb.api.client import Client as ClientCreator
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction
import numpy as np
import tempfile

CreatePersistAPI = Callable[[], ServerAPI]

configurations = (
    [
        Settings(
            chroma_api_impl="chromadb.api.rust.RustBindingsAPI",
            chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
            allow_reset=True,
            is_persistent=True,
            persist_directory=tempfile.mkdtemp(),
        )
    ]
    if "CHROMA_RUST_BINDINGS_TEST_ONLY" in os.environ
    else [
        Settings(
            chroma_api_impl="chromadb.api.segment.SegmentAPI",
            chroma_sysdb_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_producer_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_consumer_impl="chromadb.db.impl.sqlite.SqliteDB",
            chroma_segment_manager_impl="chromadb.segment.impl.manager.local.LocalSegmentManager",
            allow_reset=True,
            is_persistent=True,
            persist_directory=tempfile.mkdtemp(),
        ),
    ]
)


@pytest.fixture(scope="module", params=configurations)
def settings(request: pytest.FixtureRequest) -> Generator[Settings, None, None]:
    yield request.param


collection_st = st.shared(
    strategies.collections(
        with_hnsw_params=True,
        with_persistent_hnsw_params=st.just(True),
        # Makes it more likely to find persist-related bugs (by default these are set to 2000).
        # Lower values make it more likely that a test will trigger a persist to disk.
        max_hnsw_batch_size=10,
        max_hnsw_sync_threshold=10,
    ),
    key="coll",
)


@st.composite
def collection_and_recordset_strategy(
    draw: st.DrawFn,
) -> Tuple[strategies.Collection, strategies.RecordSet]:
    collection = draw(
        strategies.collections(
            with_hnsw_params=True,
            with_persistent_hnsw_params=st.just(True),
            # Makes it more likely to find persist-related bugs (by default these are set to 2000).
            max_hnsw_batch_size=10,
            max_hnsw_sync_threshold=10,
        )
    )
    recordset = draw(strategies.recordsets(st.just(collection)))
    return collection, recordset


@given(
    collection_and_recordset_strategies=st.lists(
        collection_and_recordset_strategy(),
        min_size=1,
        unique_by=(lambda x: x[0].name, lambda x: x[0].name),
    )
)
def test_persist(
    settings: Settings,
    collection_and_recordset_strategies: List[
        Tuple[strategies.Collection, strategies.RecordSet]
    ],
) -> None:
    system_1 = System(settings)
    system_1.start()
    client_1 = ClientCreator.from_system(system_1)

    client_1.reset()
    for (
        collection_strategy,
        recordset_strategy,
    ) in collection_and_recordset_strategies:
        coll = client_1.create_collection(
            name=collection_strategy.name,
            metadata=collection_strategy.metadata,  # type: ignore[arg-type]
            embedding_function=collection_strategy.embedding_function,
        )

        coll.add(**recordset_strategy)  # type: ignore[arg-type]

        invariants.count(coll, recordset_strategy)
        invariants.metadatas_match(coll, recordset_strategy)
        invariants.documents_match(coll, recordset_strategy)
        invariants.ids_match(coll, recordset_strategy)
        invariants.ann_accuracy(
            coll,
            recordset_strategy,
            embedding_function=collection_strategy.embedding_function,
        )

    system_1.stop()
    del client_1
    del system_1

    system_2 = System(settings)
    system_2.start()
    client_2 = ClientCreator.from_system(system_2)

    for (
        collection_strategy,
        recordset_strategy,
    ) in collection_and_recordset_strategies:
        coll = client_2.get_collection(
            name=collection_strategy.name,
            embedding_function=collection_strategy.embedding_function,
        )
        invariants.count(coll, recordset_strategy)
        invariants.metadatas_match(coll, recordset_strategy)
        invariants.documents_match(coll, recordset_strategy)
        invariants.ids_match(coll, recordset_strategy)
        invariants.ann_accuracy(
            coll,
            recordset_strategy,
            embedding_function=collection_strategy.embedding_function,
        )

    system_2.stop()
    del client_2
    del system_2


def test_sync_threshold(settings: Settings) -> None:
    system = System(settings)
    system.start()
    client = ClientCreator.from_system(system)

    collection = client.create_collection(
        name="test", metadata={"hnsw:batch_size": 3, "hnsw:sync_threshold": 3}
    )

    manager = system.instance(LocalSegmentManager)
    segment = manager.get_segment(collection.id, VectorReader)

    def get_index_last_modified_at() -> float:
        # Time resolution on Windows can be up to 10ms
        time.sleep(0.1)
        try:
            return os.path.getmtime(segment._get_metadata_file())  # type: ignore[attr-defined]
        except FileNotFoundError:
            return -1

    last_modified_at = get_index_last_modified_at()

    collection.add(ids=["1", "2"], embeddings=[[1.0], [2.0]])  # type: ignore[arg-type]

    # Should not have yet persisted
    assert get_index_last_modified_at() == last_modified_at
    last_modified_at = get_index_last_modified_at()

    # Now there's 3 additions, and the sync threshold is 3...
    collection.add(ids=["3"], embeddings=[[3.0]])  # type: ignore[arg-type]

    # ...so it should have persisted
    assert get_index_last_modified_at() > last_modified_at
    last_modified_at = get_index_last_modified_at()

    # The same thing should happen with upserts
    collection.upsert(ids=["1", "2", "3"], embeddings=[[1.0], [2.0], [3.0]])  # type: ignore[arg-type]

    # Should have persisted
    assert get_index_last_modified_at() > last_modified_at
    last_modified_at = get_index_last_modified_at()

    # Mixed usage should also trigger persistence
    collection.add(ids=["4"], embeddings=[[4.0]])  # type: ignore[arg-type]
    collection.upsert(ids=["1", "2"], embeddings=[[1.0], [2.0]])  # type: ignore[arg-type]

    # Should have persisted
    assert get_index_last_modified_at() > last_modified_at
    last_modified_at = get_index_last_modified_at()

    # Invalid updates should also trigger persistence
    collection.add(ids=["5"], embeddings=[[5.0]])  # type: ignore[arg-type]
    collection.add(ids=["1", "2"], embeddings=[[1.0], [2.0]])  # type: ignore[arg-type]

    # Should have persisted
    assert get_index_last_modified_at() > last_modified_at
    last_modified_at = get_index_last_modified_at()


def load_and_check(
    settings: Settings,
    collection_name: str,
    record_set: strategies.RecordSet,
    conn: Connection,
) -> None:
    try:
        system = System(settings)
        system.start()
        client = ClientCreator.from_system(system)

        coll = client.get_collection(
            name=collection_name,
            embedding_function=strategies.not_implemented_embedding_function(),  # type: ignore[arg-type]
        )
        invariants.count(coll, record_set)
        invariants.metadatas_match(coll, record_set)
        invariants.documents_match(coll, record_set)
        invariants.ids_match(coll, record_set)
        invariants.ann_accuracy(coll, record_set)

        system.stop()
    except Exception as e:
        conn.send(e)
        raise e


def get_multiprocessing_context():  # type: ignore[no-untyped-def]
    try:
        # Run the invariants in a new process to bypass any shared state/caching (which would defeat the purpose of the test)
        # (forkserver is used because it's much faster than spawn—it will spawn a new, minimal singleton process and then fork that singleton)
        ctx = multiprocessing.get_context("forkserver")
        # This is like running `import chromadb` in the single process that is forked rather than importing it in each forked process.
        # Gives a ~3x speedup since importing chromadb is fairly expensive.
        ctx.set_forkserver_preload(["chromadb"])
        return ctx
    except Exception:
        # forkserver/fork is not available on Windows
        return multiprocessing.get_context("spawn")


class PersistEmbeddingsStateMachineStates(EmbeddingStateMachineStates):
    persist = "persist"


MIN_STATE_CHANGES_BEFORE_PERSIST = 5


class PersistEmbeddingsStateMachine(EmbeddingStateMachineBase):
    def __init__(self, client: ClientAPI, settings: Settings):
        self.client = client
        self.settings = settings
        self.min_state_changes_left_before_persisting = MIN_STATE_CHANGES_BEFORE_PERSIST
        self.client.reset()
        super().__init__(self.client)

    @initialize(collection=collection_st)  # type: ignore
    def initialize(self, collection: strategies.Collection):
        self.client.reset()
        self.collection = self.client.create_collection(
            name=collection.name,
            metadata=collection.metadata,  # type: ignore[arg-type]
            embedding_function=collection.embedding_function,
        )
        self.embedding_function = collection.embedding_function
        trace("init")
        self.on_state_change(EmbeddingStateMachineStates.initialize)

        self.record_set_state = strategies.StateMachineRecordSet(
            ids=[], metadatas=[], documents=[], embeddings=[]
        )

    @precondition(
        lambda self: len(self.record_set_state["ids"]) >= 1
        and self.min_state_changes_left_before_persisting <= 0
    )
    @rule()
    def persist(self) -> None:
        self.on_state_change(PersistEmbeddingsStateMachineStates.persist)
        collection_name = self.collection.name
        conn1, conn2 = multiprocessing.Pipe()
        ctx = get_multiprocessing_context()  # type: ignore[no-untyped-call]
        p = ctx.Process(
            target=load_and_check,
            args=(self.settings, collection_name, self.record_set_state, conn2),
        )
        p.start()
        p.join()

        if conn1.poll():
            e = conn1.recv()
            raise e

        p.close()

    def on_state_change(self, new_state: str) -> None:
        super().on_state_change(new_state)
        if new_state == PersistEmbeddingsStateMachineStates.persist:
            self.min_state_changes_left_before_persisting = (
                MIN_STATE_CHANGES_BEFORE_PERSIST
            )
        else:
            self.min_state_changes_left_before_persisting -= 1

    def teardown(self) -> None:
        self.client.reset()


def test_persist_embeddings_state(
    caplog: pytest.LogCaptureFixture, settings: Settings
) -> None:
    caplog.set_level(logging.ERROR)
    client = chromadb.Client(settings)
    run_state_machine_as_test(
        lambda: PersistEmbeddingsStateMachine(settings=settings, client=client),
    )  # type: ignore


def test_delete_less_than_k(
    caplog: pytest.LogCaptureFixture, settings: Settings
) -> None:
    client = chromadb.Client(settings)
    state = PersistEmbeddingsStateMachine(settings=settings, client=client)
    state.initialize(
        collection=strategies.Collection(
            name="A00",
            metadata={
                "hnsw:construction_ef": 128,
                "hnsw:search_ef": 128,
                "hnsw:M": 128,
                "hnsw:sync_threshold": 3,
                "hnsw:batch_size": 3,
            },
            embedding_function=None,
            id=UUID("2d3eddc7-2314-45f4-a951-47a9a8e099d2"),
            dimension=2,
            dtype=np.float16,
            known_metadata_keys={},
            known_document_keywords=[],
            has_documents=False,
            has_embeddings=True,
        )
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()
    (embedding_ids_0,) = state.add_embeddings(record_set={"ids": ["0"], "embeddings": [[0.09765625, 0.430419921875]], "metadatas": [None], "documents": None})  # type: ignore
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 1, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()
    embedding_ids_1, embedding_ids_2 = state.add_embeddings(record_set={"ids": ["1", "2"], "embeddings": [[0.20556640625, 0.08978271484375], [-0.1527099609375, 0.291748046875]], "metadatas": [None, None], "documents": None})  # type: ignore
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 3, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()
    state.delete_by_ids(ids=[embedding_ids_2])
    state.ann_accuracy()
    state.teardown()


# Ideally this scenario would be exercised by Hypothesis, but most runs don't seem to trigger this particular state.
def test_delete_add_after_persist(settings: Settings) -> None:
    client = chromadb.Client(settings)
    state = PersistEmbeddingsStateMachine(settings=settings, client=client)

    state.initialize(
        collection=strategies.Collection(
            name="A00",
            metadata={
                "hnsw:construction_ef": 128,
                "hnsw:search_ef": 128,
                "hnsw:M": 128,
                # Important: both batch_size and sync_threshold are 3
                "hnsw:batch_size": 3,
                "hnsw:sync_threshold": 3,
            },
            embedding_function=DefaultEmbeddingFunction(),  # type: ignore[arg-type]
            id=UUID("0851f751-2f11-4424-ab23-4ae97074887a"),
            dimension=2,
            dtype=None,
            known_metadata_keys={},
            known_document_keywords=[],
            has_documents=False,
            has_embeddings=True,
        )
    )

    state.add_embeddings(
        record_set={
            # Add 3 records to hit the batch_size and sync_threshold
            "ids": ["0", "1", "2"],
            "embeddings": [[0, 0], [0, 0], [0, 0]],
            "metadatas": [None, None, None],
            "documents": None,
        }
    )

    # Delete and then re-add record
    state.delete_by_ids(ids=["0"])
    state.add_embeddings(
        record_set={
            "ids": ["0"],
            "embeddings": [[1, 1]],
            "metadatas": [None],
            "documents": None,
        }
    )

    # At this point, the changes above are not fully persisted
    state.fields_match()


def test_batch_size_less_than_sync_with_duplicate_adds_results_in_skipped_seq_ids(
    caplog: pytest.LogCaptureFixture, settings: Settings
) -> None:
    # NOTE(hammadb) this test was autogenerate by hypothesis and added here to ensure that the test is run
    # in the future. It tests a case where the max seq id was incorrect in response to the same
    # id being added multiple times in a bathc.
    client = chromadb.Client(settings)
    state = PersistEmbeddingsStateMachine(settings=settings, client=client)
    state.initialize(
        collection=strategies.Collection(
            name="JqzMs4pPm14c",
            metadata={
                "hnsw:construction_ef": 128,
                "hnsw:search_ef": 128,
                "hnsw:M": 128,
                "hnsw:sync_threshold": 9,
                "hnsw:batch_size": 7,
            },
            embedding_function=hashing_embedding_function(dim=92, dtype=np.float64),  # type: ignore[arg-type]
            id=UUID("45c5c816-0a90-4293-8d01-4325ff860040"),
            dimension=92,
            dtype=np.float64,
            known_metadata_keys={},
            known_document_keywords=[],
            has_documents=False,
            has_embeddings=True,
        )
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()
    (
        embedding_ids_0,
        embedding_ids_1,
        embedding_ids_2,
        embedding_ids_3,
        embedding_ids_4,
        embedding_ids_5,
        embedding_ids_6,
    ) = cast(
        MultipleResults[str],
        state.add_embeddings(
            record_set={
                "ids": ["N", "e8r6", "4", "Yao", "qFjA2c", "jHCv", "2"],
                "embeddings": [
                    [0.0, 0.0, 0.0],
                    [1.0, 1.0, 1.0],
                    [2.0, 2.0, 2.0],
                    [3.0, 3.0, 3.0],
                    [4.0, 4.0, 4.0],
                    [5.0, 5.0, 5.0],
                    [6.0, 6.0, 6.0],
                ],
                "metadatas": None,
                "documents": None,
            }
        ),
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 7, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()

    print("\n\n")
    (_) = state.add_embeddings(
        record_set={
            "ids": ["MVu393QTc"],
            "embeddings": [[7.0, 7.0, 7.0]],
            "metadatas": None,
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 8, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()

    (
        _,
        _,
        _,
        _,
        embedding_ids_12,
        _,
        _,
        _,
        _,
        embedding_ids_17,
        embedding_ids_18,
        _,
        _,
        _,
        embedding_ids_22,
        _,
        _,
    ) = cast(
        MultipleResults[str],
        state.add_embeddings(
            record_set={
                "ids": [
                    "CyF0Mk-",
                    "q_Fwu",
                    "2D2sQSFogDgPLkcfT",
                    "SrwuQHQ6w4f51qWr2enLPQw8uKYs1",
                    "G",
                    "wdzt",
                    "5W",
                    "8tpsn",
                    "fJbV7z",
                    "5",
                    "V",
                    "1iFkoJX",
                    "Zw4u",
                    "Fc",
                    "7",
                    "vEEwrP",
                    "Yf",
                ],
                "embeddings": [
                    [8.0, 8.0, 8.0],
                    [9.0, 9.0, 9.0],
                    [10.0, 10.0, 10.0],
                    [11.0, 11.0, 11.0],
                    [12.0, 12.0, 12.0],
                    [13.0, 13.0, 13.0],
                    [14.0, 14.0, 14.0],
                    [15.0, 15.0, 15.0],
                    [16.0, 16.0, 16.0],
                    [17.0, 17.0, 17.0],
                    [18.0, 18.0, 18.0],
                    [19.0, 19.0, 19.0],
                    [20.0, 20.0, 20.0],
                    [21.0, 21.0, 21.0],
                    [22.0, 22.0, 22.0],
                    [23.0, 23.0, 23.0],
                    [24.0, 24.0, 24.0],
                ],
                "metadatas": None,
                "documents": None,
            }
        ),
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()

    state.add_embeddings(
        record_set={
            "ids": ["0", "df_RWhR0HelOcv"],
            "embeddings": [[25.0, 25.0, 25.0], [26.0, 26.0, 26.0]],
            "metadatas": [None, None],
            "documents": None,
        }
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()

    state.add_embeddings(
        record_set={
            "ids": ["3R", "9_", "44u", "3B", "MZCXZDS", "Uelx"],
            "embeddings": [
                [27.0, 27.0, 27.0],
                [28.0, 28.0, 28.0],
                [29.0, 29.0, 29.0],
                [30.0, 30.0, 30.0],
                [31.0, 31.0, 31.0],
                [32.0, 32.0, 32.0],
            ],
            "metadatas": None,
            "documents": None,
        }
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()
    state.persist()
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()

    state.add_embeddings(
        record_set={
            "ids": "YlVm",
            "embeddings": [[33.0, 33.0, 33.0]],
            "metadatas": None,
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 34, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()

    state.add_embeddings(
        record_set={
            "ids": ["Rk1", "TPL"],
            "embeddings": [[34.0, 34.0, 34.0], [35.0, 35.0, 35.0]],
            "metadatas": [None, None],
            "documents": None,
        }
    )
    state.ann_accuracy()
    # recall: 1.0, missing 0 out of 36, accuracy threshold 1e-06
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.no_duplicates()

    state.add_embeddings(
        record_set={
            "ids": [
                "CyF0Mk-",
                "q_Fwu",
                "2D2sQSFogDgPLkcfT",
                "SrwuQHQ6w4f51qWr2enLPQw8uKYs1",
                embedding_ids_12,
                "wdzt",
                "5W",
                "8tpsn",
                "fJbV7z",
                embedding_ids_17,
                embedding_ids_18,
                "1iFkoJX",
                "Zw4u",
                "Fc",
                embedding_ids_22,
                "vEEwrP",
                "Yf",
            ],
            "embeddings": [
                [8.0, 8.0, 8.0],
                [9.0, 9.0, 9.0],
                [10.0, 10.0, 10.0],
                [11.0, 11.0, 11.0],
                [12.0, 12.0, 12.0],
                [13.0, 13.0, 13.0],
                [14.0, 14.0, 14.0],
                [15.0, 15.0, 15.0],
                [16.0, 16.0, 16.0],
                [17.0, 17.0, 17.0],
                [18.0, 18.0, 18.0],
                [19.0, 19.0, 19.0],
                [20.0, 20.0, 20.0],
                [21.0, 21.0, 21.0],
                [22.0, 22.0, 22.0],
                [23.0, 23.0, 23.0],
                [24.0, 24.0, 24.0],
            ],
            "metadatas": None,
            "documents": None,
        }
    )
    state.ann_accuracy()
    state.count()
    state.fields_match()
    state.log_size_below_max()
    state.teardown()
