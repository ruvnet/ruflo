# This tests a very minimal of test_add in test_add.py as a example based test
# instead of a property based test. We can use the delta to get the property
# test working and then enable
import random
import time
from chromadb.api import ClientAPI
from chromadb.test.conftest import (
    reset,
    skip_if_not_cluster,
)
from chromadb.test.property import invariants
from chromadb.test.utils.wait_for_version_increase import (
    wait_for_version_increase,
    get_collection_version,
)
import numpy as np


@skip_if_not_cluster()
def test_add(
    client: ClientAPI,
) -> None:
    seed = time.time()
    random.seed(seed)
    print("Generating data with seed ", seed)
    reset(client)
    collection = client.create_collection(
        name="test",
        metadata={"hnsw:construction_ef": 128, "hnsw:search_ef": 128, "hnsw:M": 128},
    )

    # Add 1000 records, where each embedding has 3 dimensions randomly generated
    # between 0 and 1
    ids = []
    embeddings = []
    for i in range(1000):
        ids.append(str(i))
        embeddings.append(np.random.rand(1, 3)[0])
        collection.add(
            ids=[str(i)],
            embeddings=[embeddings[-1]],
        )

    random_query = np.random.rand(1, 3)[0]
    print("Generated data with seed ", seed)

    invariants.ann_accuracy(
        collection,
        {
            "ids": ids,
            "embeddings": embeddings,
            "metadatas": None,
            "documents": None,
        },
        10,
        query_embeddings=[random_query],
    )


@skip_if_not_cluster()
def test_add_include_all_with_compaction_delay(client: ClientAPI) -> None:
    seed = time.time()
    random.seed(seed)
    print("Generating data with seed ", seed)
    reset(client)
    collection = client.create_collection(
        name="test_add_include_all_with_compaction_delay",
        metadata={"hnsw:construction_ef": 128, "hnsw:search_ef": 128, "hnsw:M": 128},
    )
    initial_version = get_collection_version(client, collection.name)

    ids = []
    embeddings = []
    documents = []
    for i in range(1000):
        ids.append(str(i))
        embeddings.append(np.random.rand(1, 3)[0])
        documents.append(f"document_{i}")
        collection.add(
            ids=[str(i)],
            embeddings=[embeddings[-1]],
            documents=[documents[-1]],
        )

    wait_for_version_increase(client, collection.name, initial_version, 120)

    random_query_1 = np.random.rand(1, 3)[0]
    random_query_2 = np.random.rand(1, 3)[0]
    print("Generated data with seed ", seed)

    # Query the collection with a random query
    invariants.ann_accuracy(
        collection,
        {
            "ids": ids,
            "embeddings": embeddings,
            "metadatas": None,
            "documents": documents,
        },
        10,
        query_embeddings=[random_query_1, random_query_2],
    )
