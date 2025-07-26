# Tests that various combinations of numpy and python lists work as expected as inputs
# to add/query/update/upsert operations

from typing import Any, Dict, List
import numpy as np
from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection
from chromadb.test.conftest import reset


def add_and_validate(
    collection: Collection,
    ids: List[str],
    embeddings: Any,
    metadatas: List[Dict[str, Any]],
    documents: List[str],
) -> None:
    collection.add(ids=ids, embeddings=embeddings, metadatas=metadatas, documents=documents)  # type: ignore

    results = collection.get(include=["metadatas", "documents", "embeddings"])  # type: ignore
    assert results["ids"] == ids
    assert results["metadatas"] == metadatas
    assert results["documents"] == documents
    # Using integers instead of floats to avoid floating point comparison issues
    assert np.array_equal(results["embeddings"], embeddings)  # type: ignore


def test_py_list_of_numpy(client: ClientAPI) -> None:
    reset(client)
    coll = client.create_collection("test")
    ids = ["1", "2", "3"]
    embeddings = [np.array([1, 2, 3]), np.array([1, 2, 3]), np.array([1, 2, 3])]
    metadatas = [{"a": 1}, {"a": 2}, {"a": 3}]
    documents = ["a", "b", "c"]

    # List of numpy arrays
    add_and_validate(coll, ids, embeddings, metadatas, documents)


def test_py_list_of_py(client: ClientAPI) -> None:
    reset(client)
    coll = client.create_collection("test")
    ids = ["4", "5", "6"]
    embeddings = [[1, 2, 3], [1, 2, 3], [1, 2, 3]]
    metadatas = [{"a": 4}, {"a": 5}, {"a": 6}]
    documents = ["d", "e", "f"]

    # List of python lists
    add_and_validate(coll, ids, embeddings, metadatas, documents)


def test_numpy(client: ClientAPI) -> None:
    reset(client)
    coll = client.create_collection("test")

    ids = ["7", "8", "9"]
    embeddings = np.array([[1, 2, 3], [1, 2, 3], [1, 2, 3]])
    metadata = [{"a": 7}, {"a": 8}, {"a": 9}]
    documents = ["g", "h", "i"]

    # Numpy array
    add_and_validate(coll, ids, embeddings, metadata, documents)
