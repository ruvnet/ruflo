from typing import List, Dict, Any, Optional, Union
import numpy as np
import pandas as pd
from chromadb.api.types import QueryResult, GetResult


def _transform_embeddings(
    embeddings: Optional[List[np.ndarray]],  # type: ignore
) -> Optional[Union[List[List[float]], List[np.ndarray]]]:  # type: ignore
    """
    Transform embeddings from numpy arrays to lists of floats.
    This is a shared helper function to avoid duplicating the transformation logic.
    """
    if embeddings is None:
        return None
    return (
        [emb.tolist() for emb in embeddings]
        if isinstance(embeddings[0], np.ndarray)
        else embeddings
    )


def _add_query_fields(
    data_dict: Dict[str, Any],
    query_result: QueryResult,
    query_idx: int,
) -> None:
    """
    Helper function to add fields from a query result to a dictionary.
    Handles the nested array structure specific to query results.

    Args:
        data_dict: Dictionary to add the fields to
        query_result: QueryResult containing the data
        query_idx: Index of the current query being processed
    """
    for field in query_result["included"]:
        value = query_result.get(field)
        if value is not None:
            key = field.rstrip("s")  # DF naming convention is not plural
            if field == "embeddings":
                value = _transform_embeddings(value)  # type: ignore
            if isinstance(value, list) and len(value) > 0:
                value = value[query_idx]  # type: ignore
            data_dict[key] = value


def _add_get_fields(
    data_dict: Dict[str, Any],
    get_result: GetResult,
) -> None:
    """
    Helper function to add fields from a get result to a dictionary.
    Handles the flat array structure specific to get results.

    Args:
        data_dict: Dictionary to add the fields to
        get_result: GetResult containing the data
    """
    for field in get_result["included"]:
        value = get_result.get(field)
        if value is not None:
            key = field.rstrip("s")  # DF naming convention is not plural
            if field == "embeddings":
                value = _transform_embeddings(value)  # type: ignore
            data_dict[key] = value


def query_result_to_dfs(query_result: QueryResult) -> List["pd.DataFrame"]:
    """
    Function to convert QueryResult to list of DataFrames.
    Handles the nested array structure specific to query results.
    Column order is defined by the order of the fields in the QueryResult.

    Args:
        query_result: QueryResult to convert to DataFrames.

    Returns:
        List of DataFrames.
    """
    try:
        import pandas as pd
    except ImportError:
        raise ImportError("pandas is required to convert query results to DataFrames.")

    dfs = []
    num_queries = len(query_result["ids"])

    for i in range(num_queries):
        data_for_df: Dict[str, Any] = {}
        data_for_df["id"] = query_result["ids"][i]

        _add_query_fields(data_for_df, query_result, i)

        df = pd.DataFrame(data_for_df)
        df.set_index("id", inplace=True)
        dfs.append(df)
    return dfs


def get_result_to_df(get_result: GetResult) -> "pd.DataFrame":
    """
    Function to convert GetResult to a DataFrame.
    Handles the flat array structure specific to get results.
    Column order is defined by the order of the fields in the GetResult.

    Args:
        get_result: GetResult to convert to a DataFrame.

    Returns:
        DataFrame.
    """
    try:
        import pandas as pd
    except ImportError:
        raise ImportError("pandas is required to convert get results to a DataFrame.")

    data_for_df: Dict[str, Any] = {}
    data_for_df["id"] = get_result["ids"]

    _add_get_fields(data_for_df, get_result)

    df = pd.DataFrame(data_for_df)
    df.set_index("id", inplace=True)
    return df
