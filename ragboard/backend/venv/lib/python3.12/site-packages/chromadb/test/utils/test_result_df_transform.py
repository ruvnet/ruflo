import numpy as np
from typing import List, Dict, Any, cast, Union
from chromadb.utils.results import (
    _transform_embeddings,
    _add_query_fields,
    _add_get_fields,
    query_result_to_dfs,
    get_result_to_df,
)
from chromadb.api.types import (
    QueryResult,
    GetResult,
)
from numpy.typing import NDArray


def test_transform_embeddings() -> None:
    # Test with None input
    assert _transform_embeddings(None) is None

    # Test with numpy arrays
    embeddings = cast(
        List[NDArray[Union[np.int32, np.float32]]],
        [np.array([1.0, 2.0]), np.array([3.0, 4.0])],
    )
    transformed = _transform_embeddings(embeddings)
    assert isinstance(transformed, list)
    assert transformed == [[1.0, 2.0], [3.0, 4.0]]

    # Test with list of lists
    embeddings = cast(
        List[NDArray[Union[np.int32, np.float32]]],
        [np.array([1.0, 2.0]), np.array([3.0, 4.0])],
    )
    transformed = _transform_embeddings(embeddings)
    assert transformed == [[1.0, 2.0], [3.0, 4.0]]


def test_add_query_fields() -> None:
    data_dict: Dict[str, Any] = {}
    query_result: QueryResult = {
        "ids": [["id1"], ["id2"]],
        "embeddings": [[np.array([1.0, 2.0])], [np.array([3.0, 4.0])]],
        "documents": [["doc1"], ["doc2"]],
        "metadatas": [[{"key": "value1"}], [{"key": "value2"}]],
        "distances": [[0.1], [0.2]],
        "uris": [["uri1", "uri2"]],
        "data": [
            [np.array([1, 2, 3]), np.array([4, 5, 6])]
        ],  # Using numpy arrays as Image type
        "included": ["embeddings", "documents", "metadatas", "distances"],
    }

    _add_query_fields(data_dict, query_result, 0)
    assert np.array_equal(data_dict["embedding"], [np.array([1.0, 2.0])])
    assert data_dict["document"] == ["doc1"]
    assert data_dict["metadata"] == [{"key": "value1"}]
    assert data_dict["distance"] == [0.1]


def test_add_get_fields() -> None:
    data_dict: Dict[str, Any] = {}
    get_result: GetResult = {
        "ids": ["id1", "id2"],
        "embeddings": [np.array([1.0, 2.0]), np.array([3.0, 4.0])],
        "documents": ["doc1", "doc2"],
        "metadatas": [{"key": "value1"}, {"key": "value2"}],
        "uris": ["uri1", "uri2"],
        "data": [
            np.array([1, 2, 3]),
            np.array([4, 5, 6]),
        ],  # Using numpy arrays as Image type
        "included": ["embeddings", "documents", "metadatas"],
    }

    _add_get_fields(data_dict, get_result)
    assert all(
        np.array_equal(a, b)
        for a, b in zip(
            data_dict["embedding"], [np.array([1.0, 2.0]), np.array([3.0, 4.0])]
        )
    )
    assert data_dict["document"] == ["doc1", "doc2"]
    assert data_dict["metadata"] == [{"key": "value1"}, {"key": "value2"}]


def test_query_result_to_dfs() -> None:
    query_result: QueryResult = {
        "ids": [["id1", "id2"]],
        "embeddings": [[np.array([1.0, 2.0]), np.array([3.0, 4.0])]],
        "documents": [["doc1", "doc2"]],
        "metadatas": [[{"key": "value1"}, {"key": "value2"}]],
        "distances": [[0.1, 0.2]],
        "uris": [["uri1", "uri2"]],
        "data": [
            [np.array([1, 2, 3]), np.array([4, 5, 6])]
        ],  # Using numpy arrays as Image type
        "included": ["embeddings", "documents", "metadatas", "distances"],
    }

    dfs = query_result_to_dfs(query_result)
    assert len(dfs) == 1  # Only one query

    # Test DataFrame
    df = dfs[0]
    assert df.index[0] == "id1"
    assert df["document"].iloc[0] == "doc1"
    assert df["metadata"].iloc[0] == {"key": "value1"}
    assert np.array_equal(df["embedding"].iloc[0], np.array([1.0, 2.0]))
    assert df["distance"].iloc[0] == 0.1

    # Test column order
    assert list(df.columns) == ["embedding", "document", "metadata", "distance"]


def test_get_result_to_df() -> None:
    get_result: GetResult = {
        "ids": ["id1", "id2"],
        "embeddings": [np.array([1.0, 2.0]), np.array([3.0, 4.0])],
        "documents": ["doc1", "doc2"],
        "metadatas": [{"key": "value1"}, {"key": "value2"}],
        "uris": ["uri1", "uri2"],
        "data": [
            np.array([1, 2, 3]),
            np.array([4, 5, 6]),
        ],  # Using numpy arrays as Image type
        "included": ["embeddings", "documents", "metadatas"],
    }

    df = get_result_to_df(get_result)
    assert len(df) == 2
    assert list(df.index) == ["id1", "id2"]
    assert df["document"].tolist() == ["doc1", "doc2"]
    assert df["metadata"].tolist() == [{"key": "value1"}, {"key": "value2"}]
    assert all(
        np.array_equal(a, b)
        for a, b in zip(
            df["embedding"].tolist(), [np.array([1.0, 2.0]), np.array([3.0, 4.0])]
        )
    )

    # Test column order
    assert list(df.columns) == ["embedding", "document", "metadata"]


def test_query_result_to_dfs_with_missing_fields() -> None:
    query_result: QueryResult = {
        "ids": [["id1"]],
        "documents": [["doc1"]],
        "embeddings": [[]],  # type:ignore
        "metadatas": [[]],
        "distances": [[]],
        "uris": [[]],
        "data": [[]],
        "included": ["documents"],
    }

    dfs = query_result_to_dfs(query_result)
    assert len(dfs) == 1
    df = dfs[0]
    assert df.index[0] == "id1"
    assert df["document"].iloc[0] == "doc1"
    assert "metadata" not in df.columns
    assert "embedding" not in df.columns
    assert "distance" not in df.columns


def test_get_result_to_df_with_missing_fields() -> None:
    get_result: GetResult = {
        "ids": ["id1", "id2"],
        "documents": ["doc1", "doc2"],
        "embeddings": [],
        "metadatas": [],
        "uris": [],
        "data": [],
        "included": ["documents"],
    }

    df = get_result_to_df(get_result)
    assert len(df) == 2
    assert list(df.index) == ["id1", "id2"]
    assert df["document"].tolist() == ["doc1", "doc2"]
    assert "metadata" not in df.columns
    assert "embedding" not in df.columns
