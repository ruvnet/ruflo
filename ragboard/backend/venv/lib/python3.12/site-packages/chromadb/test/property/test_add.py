import uuid
from random import randint
from typing import cast, List, Any, Dict
import hypothesis
import numpy as np
import pytest
import hypothesis.strategies as st
from hypothesis import given, settings
from chromadb.api import ClientAPI
from chromadb.api.types import Embeddings, Metadatas
from chromadb.test.conftest import (
    NOT_CLUSTER_ONLY,
    override_hypothesis_profile,
    create_isolated_database,
)
import chromadb.test.property.strategies as strategies
import chromadb.test.property.invariants as invariants
from chromadb.test.utils.wait_for_version_increase import wait_for_version_increase
from chromadb.utils.batch_utils import create_batches


collection_st = st.shared(strategies.collections(with_hnsw_params=True), key="coll")

@given(
    collection=collection_st,
    record_set=strategies.recordsets(collection_st, min_size=1, max_size=5),
)
@settings(
    deadline=None,
    parent=override_hypothesis_profile(
        normal=hypothesis.settings(max_examples=500),
        fast=hypothesis.settings(max_examples=200),
    ),
    max_examples=2
)
def test_add_miniscule(
    client: ClientAPI,
    collection: strategies.Collection,
    record_set: strategies.RecordSet,
) -> None:
    if (
        client.get_settings().chroma_api_impl
        == "chromadb.api.async_fastapi.AsyncFastAPI"
    ):
        pytest.skip(
            "TODO @jai, come back and debug why CI runners fail with async + sync"
        )
    _test_add(client, collection, record_set, True, always_compact=True)


# Hypothesis tends to generate smaller values so we explicitly segregate the
# the tests into tiers, Small, Medium. Hypothesis struggles to generate large
# record sets so we explicitly create a large record set without using Hypothesis
@given(
    collection=collection_st,
    record_set=strategies.recordsets(collection_st, min_size=1, max_size=500),
    should_compact=st.booleans(),
)
@settings(
    deadline=None,
    parent=override_hypothesis_profile(
        normal=hypothesis.settings(max_examples=500),
        fast=hypothesis.settings(max_examples=200),
    ),
)
def test_add_small(
    client: ClientAPI,
    collection: strategies.Collection,
    record_set: strategies.RecordSet,
    should_compact: bool,
) -> None:
    if (
        client.get_settings().chroma_api_impl
        == "chromadb.api.async_fastapi.AsyncFastAPI"
    ):
        pytest.skip(
            "TODO @jai, come back and debug why CI runners fail with async + sync"
        )
    _test_add(client, collection, record_set, should_compact)


@given(
    collection=collection_st,
    record_set=strategies.recordsets(
        collection_st,
        min_size=250,
        max_size=500,
        num_unique_metadata=5,
        min_metadata_size=1,
        max_metadata_size=5,
    ),
    should_compact=st.booleans(),
)
@settings(
    deadline=None,
    parent=override_hypothesis_profile(
        normal=hypothesis.settings(max_examples=10),
        fast=hypothesis.settings(max_examples=5),
    ),
    suppress_health_check=[
        hypothesis.HealthCheck.too_slow,
        hypothesis.HealthCheck.data_too_large,
        hypothesis.HealthCheck.large_base_example,
        hypothesis.HealthCheck.function_scoped_fixture,
    ],
)
def test_add_medium(
    client: ClientAPI,
    collection: strategies.Collection,
    record_set: strategies.RecordSet,
    should_compact: bool,
) -> None:
    if (
        client.get_settings().chroma_api_impl
        == "chromadb.api.async_fastapi.AsyncFastAPI"
    ):
        pytest.skip(
            "TODO @jai, come back and debug why CI runners fail with async + sync"
        )
    # Cluster tests transmit their results over grpc, which has a payload limit
    # This breaks the ann_accuracy invariant by default, since
    # the vector reader returns a payload of dataset size. So we need to batch
    # the queries in the ann_accuracy invariant
    _test_add(client, collection, record_set, should_compact, batch_ann_accuracy=True)


def _test_add(
    client: ClientAPI,
    collection: strategies.Collection,
    record_set: strategies.RecordSet,
    should_compact: bool,
    batch_ann_accuracy: bool = False,
    always_compact: bool = False,
) -> None:
    create_isolated_database(client)

    # TODO: Generative embedding functions
    coll = client.create_collection(
        name=collection.name,
        metadata=collection.metadata,  # type: ignore
        embedding_function=collection.embedding_function,
    )
    initial_version = cast(int, coll.get_model()["version"])

    normalized_record_set = invariants.wrap_all(record_set)

    # TODO: The type of add() is incorrect as it does not allow for metadatas
    # like [{"a": 1}, None, {"a": 3}]
    for batch in create_batches(
        api=client,
        ids=cast(List[str], record_set["ids"]),
        embeddings=cast(Embeddings, record_set["embeddings"]),
        metadatas=cast(Metadatas, record_set["metadatas"]),
        documents=cast(List[str], record_set["documents"]),
    ):
        coll.add(*batch)
    # Only wait for compaction if the size of the collection is
    # some minimal size
    if (
        not NOT_CLUSTER_ONLY
        and should_compact
        and (len(normalized_record_set["ids"]) > 10 or always_compact)
    ):
        # Wait for the model to be updated
        wait_for_version_increase(client, collection.name, initial_version)

    invariants.count(coll, cast(strategies.RecordSet, normalized_record_set))
    n_results = max(1, (len(normalized_record_set["ids"]) // 10))

    if batch_ann_accuracy:
        batch_size = 10
        for i in range(0, len(normalized_record_set["ids"]), batch_size):
            invariants.ann_accuracy(
                coll,
                cast(strategies.RecordSet, normalized_record_set),
                n_results=n_results,
                embedding_function=collection.embedding_function,
                query_indices=list(
                    range(i, min(i + batch_size, len(normalized_record_set["ids"])))
                ),
            )
    else:
        invariants.ann_accuracy(
            coll,
            cast(strategies.RecordSet, normalized_record_set),
            n_results=n_results,
            embedding_function=collection.embedding_function,
        )


# Hypothesis struggles to generate large record sets so we explicitly create
# a large record set
def create_large_recordset(
    min_size: int = 45000,
    max_size: int = 50000,
) -> strategies.RecordSet:
    size = randint(min_size, max_size)

    ids = [str(uuid.uuid4()) for _ in range(size)]
    metadatas = [{"some_key": f"{i}"} for i in range(size)]
    documents = [f"Document {i}" for i in range(size)]
    embeddings = [[1, 2, 3] for _ in range(size)]
    record_set: Dict[str, List[Any]] = {
        "ids": ids,
        "embeddings": cast(Embeddings, embeddings),
        "metadatas": metadatas,
        "documents": documents,
    }
    return cast(strategies.RecordSet, record_set)


@given(collection=collection_st, should_compact=st.booleans())
@settings(deadline=None, max_examples=5)
def test_add_large(
    client: ClientAPI, collection: strategies.Collection, should_compact: bool
) -> None:
    create_isolated_database(client)

    if (
        client.get_settings().chroma_api_impl
        == "chromadb.api.async_fastapi.AsyncFastAPI"
    ):
        pytest.skip(
            "TODO @jai, come back and debug why CI runners fail with async + sync"
        )

    record_set = create_large_recordset(
        min_size=10000,
        max_size=50000,
    )
    coll = client.create_collection(
        name=collection.name,
        metadata=collection.metadata,  # type: ignore
        embedding_function=collection.embedding_function,
    )
    normalized_record_set = invariants.wrap_all(record_set)
    initial_version = cast(int, coll.get_model()["version"])

    for batch in create_batches(
        api=client,
        ids=cast(List[str], record_set["ids"]),
        embeddings=cast(Embeddings, record_set["embeddings"]),
        metadatas=cast(Metadatas, record_set["metadatas"]),
        documents=cast(List[str], record_set["documents"]),
    ):
        coll.add(*batch)

    if (
        not NOT_CLUSTER_ONLY
        and should_compact
        and len(normalized_record_set["ids"]) > 10
    ):
        # Wait for the model to be updated, since the record set is larger, add some additional time
        wait_for_version_increase(
            client, collection.name, initial_version, additional_time=240
        )

    invariants.count(coll, cast(strategies.RecordSet, normalized_record_set))


@given(collection=collection_st)
@settings(deadline=None, max_examples=1)
def test_add_large_exceeding(
    client: ClientAPI, collection: strategies.Collection
) -> None:
    create_isolated_database(client)

    if (
        client.get_settings().chroma_api_impl
        == "chromadb.api.async_fastapi.AsyncFastAPI"
    ):
        pytest.skip(
            "TODO @jai, come back and debug why CI runners fail with async + sync"
        )

    record_set = create_large_recordset(
        min_size=client.get_max_batch_size(),
        max_size=client.get_max_batch_size()
        + 100,  # Exceed the max batch size by 100 records
    )
    coll = client.create_collection(
        name=collection.name,
        metadata=collection.metadata,  # type: ignore
        embedding_function=collection.embedding_function,
    )

    with pytest.raises(Exception) as e:
        coll.add(**record_set)  # type: ignore[arg-type]
    assert "batch size" in str(e.value)


# TODO: This test fails right now because the ids are not sorted by the input order
@pytest.mark.xfail(
    reason="This is expected to fail right now. We should change the API to sort the \
    ids by input order."
)
def test_out_of_order_ids(client: ClientAPI) -> None:
    if (
        client.get_settings().chroma_api_impl
        == "chromadb.api.async_fastapi.AsyncFastAPI"
    ):
        pytest.skip(
            "TODO @jai, come back and debug why CI runners fail with async + sync"
        )
    ooo_ids = [
        "40",
        "05",
        "8",
        "6",
        "10",
        "01",
        "00",
        "3",
        "04",
        "20",
        "02",
        "9",
        "30",
        "11",
        "13",
        "2",
        "0",
        "7",
        "06",
        "5",
        "50",
        "12",
        "03",
        "4",
        "1",
    ]

    coll = client.create_collection(
        "test", embedding_function=lambda input: [[1, 2, 3] for _ in input]  # type: ignore
    )
    embeddings: Embeddings = [np.array([1, 2, 3]) for _ in ooo_ids]
    coll.add(ids=ooo_ids, embeddings=embeddings)
    get_ids = coll.get(ids=ooo_ids)["ids"]
    assert get_ids == ooo_ids


def test_add_partial(client: ClientAPI) -> None:
    """Tests adding a record set with some of the fields set to None."""

    create_isolated_database(client)

    if (
        client.get_settings().chroma_api_impl
        == "chromadb.api.async_fastapi.AsyncFastAPI"
    ):
        pytest.skip(
            "TODO @jai, come back and debug why CI runners fail with async + sync"
        )

    coll = client.create_collection("test")
    # TODO: We need to clean up the api types to support this typing
    coll.add(
        ids=["1", "2", "3"],
        # All embeddings must be provided, or else None - no partial lists allowed
        embeddings=[[1, 2, 3], [1, 2, 3], [1, 2, 3]],  # type: ignore
        # Metadatas can always be partial
        metadatas=[{"a": 1}, None, {"a": 3}],  # type: ignore
        # Documents are optional if embeddings are provided
        documents=["a", "b", None],  # type: ignore
    )

    results = coll.get()
    assert results["ids"] == ["1", "2", "3"]
    assert results["metadatas"] == [{"a": 1}, None, {"a": 3}]
    assert results["documents"] == ["a", "b", None]
