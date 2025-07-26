import logging

import chromadb.test.property.strategies as strategies
import hypothesis.strategies as st
from chromadb.api import ClientAPI
from chromadb.test.conftest import NOT_CLUSTER_ONLY, reset
from chromadb.test.property import invariants
from chromadb.test.utils.wait_for_version_increase import wait_for_version_increase
from hypothesis import HealthCheck, given, settings

collection_st = st.shared(
    strategies.collections(add_filterable_data=True, with_hnsw_params=True),
    key="coll",
)
recordset_st = st.shared(
    strategies.recordsets(collection_st, max_size=1000), key="recordset"
)


@settings(
    deadline=90000,
    suppress_health_check=[
        HealthCheck.function_scoped_fixture,
        HealthCheck.large_base_example,
        HealthCheck.filter_too_much,
    ],
)  # type: ignore
@given(
    collection=collection_st,
    record_set=recordset_st,
    limit=st.integers(min_value=1, max_value=10),
    offset=st.integers(min_value=0, max_value=10),
    should_compact=st.booleans(),
)
def test_get_limit_offset(
    caplog,
    client: ClientAPI,
    collection: strategies.Collection,
    record_set: dict,
    limit: int,
    offset: int,
    should_compact: bool,
) -> None:
    caplog.set_level(logging.ERROR)

    reset(client)
    coll = client.create_collection(
        name=collection.name,
        metadata=collection.metadata,  # type: ignore
        embedding_function=collection.embedding_function,
    )

    initial_version = coll.get_model()["version"]

    coll.add(**record_set)

    if not NOT_CLUSTER_ONLY:
        # Only wait for compaction if the size of the collection is
        # some minimal size
        if should_compact and len(invariants.wrap(record_set["ids"])) > 10:
            # Wait for the model to be updated
            wait_for_version_increase(client, collection.name, initial_version)

    result_ids = coll.get(offset=offset, limit=limit)["ids"]
    all_offset_ids = coll.get()["ids"]
    assert result_ids == all_offset_ids[offset : offset + limit]
