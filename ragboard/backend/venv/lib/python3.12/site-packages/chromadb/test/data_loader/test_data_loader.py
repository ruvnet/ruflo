from typing import Dict, Generator, List, Optional, Sequence, Union
import numpy as np
from numpy.typing import NDArray

import pytest
import chromadb
from chromadb.api.types import URI, DataLoader, Documents, IDs, Image, URIs
from chromadb.api import ClientAPI
from chromadb.test.conftest import reset
from chromadb.test.ef.test_multimodal_ef import hashing_multimodal_ef


def encode_data(data: str) -> NDArray[np.uint8]:
    return np.array(data.encode())


class DefaultDataLoader(DataLoader[List[Optional[Image]]]):
    def __call__(self, uris: Sequence[Optional[URI]]) -> List[Optional[Image]]:
        # Convert each URI to a numpy array
        return [None if uri is None else encode_data(uri) for uri in uris]


def record_set_with_uris(n: int = 3) -> Dict[str, Union[IDs, Documents, URIs]]:
    return {
        "ids": [f"{i}" for i in range(n)],
        "documents": [f"document_{i}" for i in range(n)],
        "uris": [f"uri_{i}" for i in range(n)],
    }


@pytest.fixture()
def collection_with_data_loader(
    client: ClientAPI,
) -> Generator[chromadb.Collection, None, None]:
    reset(client)
    collection = client.create_collection(
        name="collection_with_data_loader",
        data_loader=DefaultDataLoader(),
        embedding_function=hashing_multimodal_ef(),
    )
    yield collection
    client.delete_collection(collection.name)


@pytest.fixture
def collection_without_data_loader(
    client: ClientAPI,
) -> Generator[chromadb.Collection, None, None]:
    reset(client)
    collection = client.create_collection(
        name="collection_without_data_loader",
        embedding_function=hashing_multimodal_ef(),
    )
    yield collection
    client.delete_collection(collection.name)


def test_without_data_loader(
    collection_without_data_loader: chromadb.Collection,
    n_examples: int = 3,
) -> None:
    record_set = record_set_with_uris(n=n_examples)

    # Can't embed data in URIs without a data loader
    with pytest.raises(ValueError):
        collection_without_data_loader.add(
            ids=record_set["ids"],
            uris=record_set["uris"],
        )

    # Can't get data from URIs without a data loader
    with pytest.raises(ValueError):
        collection_without_data_loader.get(include=["data"])


def test_without_uris(
    collection_with_data_loader: chromadb.Collection, n_examples: int = 3
) -> None:
    record_set = record_set_with_uris(n=n_examples)

    collection_with_data_loader.add(
        ids=record_set["ids"],
        documents=record_set["documents"],
    )

    get_result = collection_with_data_loader.get(include=["data"])

    assert get_result["data"] is not None
    for data in get_result["data"]:
        assert data is None


def test_data_loader(
    collection_with_data_loader: chromadb.Collection, n_examples: int = 3
) -> None:
    record_set = record_set_with_uris(n=n_examples)

    collection_with_data_loader.add(
        ids=record_set["ids"],
        uris=record_set["uris"],
    )

    # Get with "data"
    get_result = collection_with_data_loader.get(include=["data"])

    assert get_result["data"] is not None
    for i, data in enumerate(get_result["data"]):
        assert data is not None
        assert data == encode_data(record_set["uris"][i])

    # Query by URI
    query_result = collection_with_data_loader.query(
        query_uris=record_set["uris"],
        n_results=len(record_set["uris"][0]),
        include=["data", "uris"],
    )

    assert query_result["data"] is not None
    for i, data in enumerate(query_result["data"][0]):
        assert data is not None
        assert query_result["uris"] is not None
        assert data == encode_data(query_result["uris"][0][i])
