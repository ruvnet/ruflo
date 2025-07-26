import numpy as np
from chromadb.api import ClientAPI


def test_invalid_update(client: ClientAPI) -> None:
    client.reset()

    collection = client.create_collection("test")

    # Update is invalid because ID does not exist
    collection.update(ids=["foo"], embeddings=[[0.0, 0.0, 0.0]])

    collection.add(ids=["foo"], embeddings=[[1.0, 1.0, 1.0]])
    result = collection.get(ids=["foo"], include=["embeddings"])
    # Embeddings should be the same as what was provided to .add()
    assert result["embeddings"] is not None
    assert np.allclose(result["embeddings"][0], np.array([1.0, 1.0, 1.0]))
