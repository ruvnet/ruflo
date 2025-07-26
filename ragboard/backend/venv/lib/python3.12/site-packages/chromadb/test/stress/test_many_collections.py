from typing import List
import numpy as np

from chromadb.api import ServerAPI
from chromadb.api.models.Collection import Collection


def test_many_collections(client: ServerAPI) -> None:
    """Test that we can create a large number of collections and that the system
    # remains responsive."""
    client.reset()

    N = 10
    D = 10

    metadata = None
    if client.get_settings().is_persistent:
        metadata = {"hnsw:batch_size": 3, "hnsw:sync_threshold": 3}
    else:
        # We only want to test persistent configurations in this way, since the main
        # point is to test the file handle limit
        return

    num_collections = 10000
    collections: List[Collection] = []
    for i in range(num_collections):
        new_collection = client.create_collection(
            f"test_collection_{i}",
            metadata=metadata,
        )
        collections.append(new_collection)

    # Add a few embeddings to each collection
    data = np.random.rand(N, D).tolist()
    ids = [f"test_id_{i}" for i in range(N)]
    for i in range(num_collections):
        collections[i].add(ids, data)
