from tqdm.autonotebook import tqdm

from collections.abc import Iterable
from typing import Union, List, Tuple, Optional, Dict, Any

from pinecone.config import ConfigBuilder

from pinecone.core.client.models import SparseValues
from pinecone.core.client import ApiClient
from pinecone.core.client.models import (
    FetchResponse,
    QueryRequest,
    QueryResponse,
    RpcStatus,
    ScoredVector,
    SingleQueryResults,
    DescribeIndexStatsResponse,
    UpsertRequest,
    UpsertResponse,
    UpdateRequest,
    Vector,
    DeleteRequest,
    UpdateRequest,
    DescribeIndexStatsRequest,
)
from pinecone.core.client.api.vector_operations_api import VectorOperationsApi
from ..utils import get_user_agent, fix_tuple_length
from .vector_factory import VectorFactory

__all__ = [
    "Index",
    "FetchResponse",
    "QueryRequest",
    "QueryResponse",
    "RpcStatus",
    "ScoredVector",
    "SingleQueryResults",
    "DescribeIndexStatsResponse",
    "UpsertRequest",
    "UpsertResponse",
    "UpdateRequest",
    "Vector",
    "DeleteRequest",
    "UpdateRequest",
    "DescribeIndexStatsRequest",
    "SparseValues",
]

from ..utils.error_handling import validate_and_convert_errors

_OPENAPI_ENDPOINT_PARAMS = (
    "_return_http_data_only",
    "_preload_content",
    "_request_timeout",
    "_check_input_type",
    "_check_return_type",
    "_host_index",
    "async_req",
)

def parse_query_response(response: QueryResponse):
    response._data_store.pop("results", None)
    return response

class Index():

    """
    A client for interacting with a Pinecone index via REST API.
    For improved performance, use the Pinecone GRPC index client.
    """

    def __init__(self, api_key: str, host: str, pool_threads=1, **kwargs):
        api_key = api_key or kwargs.get("api_key", None)
        host = host or kwargs.get('host', None)
        pool_threads = pool_threads or kwargs.get("pool_threads")

        self._config = ConfigBuilder.build(api_key=api_key, host=host, **kwargs)
        
        api_client = ApiClient(configuration=self._config.openapi_config, pool_threads=pool_threads)
        api_client.user_agent = get_user_agent()
        self._api_client = api_client
        self._vector_api = VectorOperationsApi(api_client=api_client)
    
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self._api_client.close()

    @validate_and_convert_errors
    def upsert(
        self,
        vectors: Union[List[Vector], List[tuple], List[dict]],
        namespace: Optional[str] = None,
        batch_size: Optional[int] = None,
        show_progress: bool = True,
        **kwargs,
    ) -> UpsertResponse:
        """
        The upsert operation writes vectors into a namespace.
        If a new value is upserted for an existing vector id, it will overwrite the previous value.

        To upsert in parallel follow: https://docs.pinecone.io/docs/insert-data#sending-upserts-in-parallel

        A vector can be represented by a 1) Vector object, a 2) tuple or 3) a dictionary

        If a tuple is used, it must be of the form `(id, values, metadata)` or `(id, values)`.
        where id is a string, vector is a list of floats, metadata is a dict,
        and sparse_values is a dict of the form `{'indices': List[int], 'values': List[float]}`.

        Examples:
            >>> ('id1', [1.0, 2.0, 3.0], {'key': 'value'}, {'indices': [1, 2], 'values': [0.2, 0.4]})
            >>> ('id1', [1.0, 2.0, 3.0], None, {'indices': [1, 2], 'values': [0.2, 0.4]})
            >>> ('id1', [1.0, 2.0, 3.0], {'key': 'value'}), ('id2', [1.0, 2.0, 3.0])

        If a Vector object is used, a Vector object must be of the form
        `Vector(id, values, metadata, sparse_values)`, where metadata and sparse_values are optional
        arguments.

        Examples:
            >>> Vector(id='id1', values=[1.0, 2.0, 3.0], metadata={'key': 'value'})
            >>> Vector(id='id2', values=[1.0, 2.0, 3.0])
            >>> Vector(id='id3', values=[1.0, 2.0, 3.0], sparse_values=SparseValues(indices=[1, 2], values=[0.2, 0.4]))

        **Note:** the dimension of each vector must match the dimension of the index.

        If a dictionary is used, it must be in the form `{'id': str, 'values': List[float], 'sparse_values': {'indices': List[int], 'values': List[float]}, 'metadata': dict}`

        Examples:
            >>> index.upsert([('id1', [1.0, 2.0, 3.0], {'key': 'value'}), ('id2', [1.0, 2.0, 3.0])])
            >>>
            >>> index.upsert([{'id': 'id1', 'values': [1.0, 2.0, 3.0], 'metadata': {'key': 'value'}},
            >>>               {'id': 'id2', 'values': [1.0, 2.0, 3.0], 'sparse_values': {'indices': [1, 8], 'values': [0.2, 0.4]}])
            >>> index.upsert([Vector(id='id1', values=[1.0, 2.0, 3.0], metadata={'key': 'value'}),
            >>>               Vector(id='id2', values=[1.0, 2.0, 3.0], sparse_values=SparseValues(indices=[1, 2], values=[0.2, 0.4]))])

        API reference: https://docs.pinecone.io/reference/upsert

        Args:
            vectors (Union[List[Vector], List[Tuple]]): A list of vectors to upsert.
            namespace (str): The namespace to write to. If not specified, the default namespace is used. [optional]
            batch_size (int): The number of vectors to upsert in each batch.
                               If not specified, all vectors will be upserted in a single batch. [optional]
            show_progress (bool): Whether to show a progress bar using tqdm.
                                  Applied only if batch_size is provided. Default is True.
        Keyword Args:
            Supports OpenAPI client keyword arguments. See pinecone.core.client.models.UpsertRequest for more details.

        Returns: UpsertResponse, includes the number of vectors upserted.
        """
        _check_type = kwargs.pop("_check_type", True)

        if kwargs.get("async_req", False) and batch_size is not None:
            raise ValueError(
                "async_req is not supported when batch_size is provided."
                "To upsert in parallel, please follow: "
                "https://docs.pinecone.io/docs/insert-data#sending-upserts-in-parallel"
            )

        if batch_size is None:
            return self._upsert_batch(vectors, namespace, _check_type, **kwargs)

        if not isinstance(batch_size, int) or batch_size <= 0:
            raise ValueError("batch_size must be a positive integer")

        pbar = tqdm(total=len(vectors), disable=not show_progress, desc="Upserted vectors")
        total_upserted = 0
        for i in range(0, len(vectors), batch_size):
            batch_result = self._upsert_batch(vectors[i : i + batch_size], namespace, _check_type, **kwargs)
            pbar.update(batch_result.upserted_count)
            # we can't use here pbar.n for the case show_progress=False
            total_upserted += batch_result.upserted_count

        return UpsertResponse(upserted_count=total_upserted)

    def _upsert_batch(
        self, vectors: Union[List[Vector], List[tuple], List[dict]], namespace: Optional[str], _check_type: bool, **kwargs
    ) -> UpsertResponse:
        args_dict = self._parse_non_empty_args([("namespace", namespace)])
        vec_builder = lambda v: VectorFactory.build(v, check_type=_check_type)

        return self._vector_api.upsert(
            UpsertRequest(
                vectors=list(map(vec_builder, vectors)),
                **args_dict,
                _check_type=_check_type,
                **{k: v for k, v in kwargs.items() if k not in _OPENAPI_ENDPOINT_PARAMS},
            ),
            **{k: v for k, v in kwargs.items() if k in _OPENAPI_ENDPOINT_PARAMS},
        )

    @staticmethod
    def _iter_dataframe(df, batch_size):
        for i in range(0, len(df), batch_size):
            batch = df.iloc[i : i + batch_size].to_dict(orient="records")
            yield batch

    def upsert_from_dataframe(
        self, df, namespace: Optional[str] = None, batch_size: int = 500, show_progress: bool = True
    ) -> UpsertResponse:
        """Upserts a dataframe into the index.

        Args:
            df: A pandas dataframe with the following columns: id, vector, sparse_values, and metadata.
            namespace: The namespace to upsert into.
            batch_size: The number of rows to upsert in a single batch.
            show_progress: Whether to show a progress bar.
        """
        try:
            import pandas as pd
        except ImportError:
            raise RuntimeError(
                "The `pandas` package is not installed. Please install pandas to use `upsert_from_dataframe()`"
            )

        if not isinstance(df, pd.DataFrame):
            raise ValueError(f"Only pandas dataframes are supported. Found: {type(df)}")

        pbar = tqdm(total=len(df), disable=not show_progress, desc="sending upsert requests")
        results = []
        for chunk in self._iter_dataframe(df, batch_size=batch_size):
            res = self.upsert(vectors=chunk, namespace=namespace)
            pbar.update(len(chunk))
            results.append(res)

        upserted_count = 0
        for res in results:
            upserted_count += res.upserted_count

        return UpsertResponse(upserted_count=upserted_count)

    @validate_and_convert_errors
    def delete(
        self,
        ids: Optional[List[str]] = None,
        delete_all: Optional[bool] = None,
        namespace: Optional[str] = None,
        filter: Optional[Dict[str, Union[str, float, int, bool, List, dict]]] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        The Delete operation deletes vectors from the index, from a single namespace.
        No error raised if the vector id does not exist.
        Note: for any delete call, if namespace is not specified, the default namespace is used.

        Delete can occur in the following mutual exclusive ways:
        1. Delete by ids from a single namespace
        2. Delete all vectors from a single namespace by setting delete_all to True
        3. Delete all vectors from a single namespace by specifying a metadata filter
            (note that for this option delete all must be set to False)

        API reference: https://docs.pinecone.io/reference/delete_post

        Examples:
            >>> index.delete(ids=['id1', 'id2'], namespace='my_namespace')
            >>> index.delete(delete_all=True, namespace='my_namespace')
            >>> index.delete(filter={'key': 'value'}, namespace='my_namespace')

        Args:
            ids (List[str]): Vector ids to delete [optional]
            delete_all (bool): This indicates that all vectors in the index namespace should be deleted.. [optional]
                                Default is False.
            namespace (str): The namespace to delete vectors from [optional]
                            If not specified, the default namespace is used.
            filter (Dict[str, Union[str, float, int, bool, List, dict]]):
                    If specified, the metadata filter here will be used to select the vectors to delete.
                    This is mutually exclusive with specifying ids to delete in the ids param or using delete_all=True.
                    See https://www.pinecone.io/docs/metadata-filtering/.. [optional]

        Keyword Args:
          Supports OpenAPI client keyword arguments. See pinecone.core.client.models.DeleteRequest for more details.


          Returns: An empty dictionary if the delete operation was successful.
        """
        _check_type = kwargs.pop("_check_type", False)
        args_dict = self._parse_non_empty_args(
            [("ids", ids), ("delete_all", delete_all), ("namespace", namespace), ("filter", filter)]
        )

        return self._vector_api.delete(
            DeleteRequest(
                **args_dict,
                **{k: v for k, v in kwargs.items() if k not in _OPENAPI_ENDPOINT_PARAMS and v is not None},
                _check_type=_check_type,
            ),
            **{k: v for k, v in kwargs.items() if k in _OPENAPI_ENDPOINT_PARAMS},
        )

    @validate_and_convert_errors
    def fetch(self, ids: List[str], namespace: Optional[str] = None, **kwargs) -> FetchResponse:
        """
        The fetch operation looks up and returns vectors, by ID, from a single namespace.
        The returned vectors include the vector data and/or metadata.

        API reference: https://docs.pinecone.io/reference/fetch

        Examples:
            >>> index.fetch(ids=['id1', 'id2'], namespace='my_namespace')
            >>> index.fetch(ids=['id1', 'id2'])

        Args:
            ids (List[str]): The vector IDs to fetch.
            namespace (str): The namespace to fetch vectors from.
                             If not specified, the default namespace is used. [optional]
        Keyword Args:
            Supports OpenAPI client keyword arguments. See pinecone.core.client.models.FetchResponse for more details.


        Returns: FetchResponse object which contains the list of Vector objects, and namespace name.
        """
        args_dict = self._parse_non_empty_args([("namespace", namespace)])
        return self._vector_api.fetch(ids=ids, **args_dict, **kwargs)

    @validate_and_convert_errors
    def query(
        self,
        top_k: int,
        vector: Optional[List[float]] = None,
        id: Optional[str] = None,
        namespace: Optional[str] = None,
        filter: Optional[Dict[str, Union[str, float, int, bool, List, dict]]] = None,
        include_values: Optional[bool] = None,
        include_metadata: Optional[bool] = None,
        sparse_vector: Optional[Union[SparseValues, Dict[str, Union[List[float], List[int]]]]] = None,
        **kwargs,
    ) -> QueryResponse:
        """
        The Query operation searches a namespace, using a query vector.
        It retrieves the ids of the most similar items in a namespace, along with their similarity scores.

        API reference: https://docs.pinecone.io/reference/query

        Examples:
            >>> index.query(vector=[1, 2, 3], top_k=10, namespace='my_namespace')
            >>> index.query(id='id1', top_k=10, namespace='my_namespace')
            >>> index.query(vector=[1, 2, 3], top_k=10, namespace='my_namespace', filter={'key': 'value'})
            >>> index.query(id='id1', top_k=10, namespace='my_namespace', include_metadata=True, include_values=True)
            >>> index.query(vector=[1, 2, 3], sparse_vector={'indices': [1, 2], 'values': [0.2, 0.4]},
            >>>             top_k=10, namespace='my_namespace')
            >>> index.query(vector=[1, 2, 3], sparse_vector=SparseValues([1, 2], [0.2, 0.4]),
            >>>             top_k=10, namespace='my_namespace')

        Args:
            vector (List[float]): The query vector. This should be the same length as the dimension of the index
                                  being queried. Each `query()` request can contain only one of the parameters
                                  `id` or `vector`.. [optional]
            id (str): The unique ID of the vector to be used as a query vector.
                      Each `query()` request can contain only one of the parameters
                      `vector` or  `id`. [optional]
            top_k (int): The number of results to return for each query. Must be an integer greater than 1.
            namespace (str): The namespace to fetch vectors from.
                             If not specified, the default namespace is used. [optional]
            filter (Dict[str, Union[str, float, int, bool, List, dict]):
                    The filter to apply. You can use vector metadata to limit your search.
                    See https://www.pinecone.io/docs/metadata-filtering/.. [optional]
            include_values (bool): Indicates whether vector values are included in the response.
                                   If omitted the server will use the default value of False [optional]
            include_metadata (bool): Indicates whether metadata is included in the response as well as the ids.
                                     If omitted the server will use the default value of False  [optional]
            sparse_vector: (Union[SparseValues, Dict[str, Union[List[float], List[int]]]]): sparse values of the query vector.
                            Expected to be either a SparseValues object or a dict of the form:
                             {'indices': List[int], 'values': List[float]}, where the lists each have the same length.
        
        Returns: QueryResponse object which contains the list of the closest vectors as ScoredVector objects,
                 and namespace name.
        """

        _check_type = kwargs.pop("_check_type", False)

        sparse_vector = self._parse_sparse_values_arg(sparse_vector)
        args_dict = self._parse_non_empty_args(
            [
                ("vector", vector),
                ("id", id),
                ("queries", None),
                ("top_k", top_k),
                ("namespace", namespace),
                ("filter", filter),
                ("include_values", include_values),
                ("include_metadata", include_metadata),
                ("sparse_vector", sparse_vector),
            ]
        )
        response = self._vector_api.query(
            QueryRequest(
                **args_dict,
                _check_type=_check_type,
                **{k: v for k, v in kwargs.items() if k not in _OPENAPI_ENDPOINT_PARAMS},
            ),
            **{k: v for k, v in kwargs.items() if k in _OPENAPI_ENDPOINT_PARAMS},
        )
        return parse_query_response(response)

    @validate_and_convert_errors
    def update(
        self,
        id: str,
        values: Optional[List[float]] = None,
        set_metadata: Optional[Dict[str, Union[str, float, int, bool, List[int], List[float], List[str]]]] = None,
        namespace: Optional[str] = None,
        sparse_values: Optional[Union[SparseValues, Dict[str, Union[List[float], List[int]]]]] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        The Update operation updates vector in a namespace.
        If a value is included, it will overwrite the previous value.
        If a set_metadata is included,
        the values of the fields specified in it will be added or overwrite the previous value.

        API reference: https://docs.pinecone.io/reference/update

        Examples:
            >>> index.update(id='id1', values=[1, 2, 3], namespace='my_namespace')
            >>> index.update(id='id1', set_metadata={'key': 'value'}, namespace='my_namespace')
            >>> index.update(id='id1', values=[1, 2, 3], sparse_values={'indices': [1, 2], 'values': [0.2, 0.4]},
            >>>              namespace='my_namespace')
            >>> index.update(id='id1', values=[1, 2, 3], sparse_values=SparseValues(indices=[1, 2], values=[0.2, 0.4]),
            >>>              namespace='my_namespace')

        Args:
            id (str): Vector's unique id.
            values (List[float]): vector values to set. [optional]
            set_metadata (Dict[str, Union[str, float, int, bool, List[int], List[float], List[str]]]]):
                metadata to set for vector. [optional]
            namespace (str): Namespace name where to update the vector.. [optional]
            sparse_values: (Dict[str, Union[List[float], List[int]]]): sparse values to update for the vector.
                           Expected to be either a SparseValues object or a dict of the form:
                           {'indices': List[int], 'values': List[float]} where the lists each have the same length.

        Keyword Args:
            Supports OpenAPI client keyword arguments. See pinecone.core.client.models.UpdateRequest for more details.

        Returns: An empty dictionary if the update was successful.
        """
        _check_type = kwargs.pop("_check_type", False)
        sparse_values = self._parse_sparse_values_arg(sparse_values)
        args_dict = self._parse_non_empty_args(
            [
                ("values", values),
                ("set_metadata", set_metadata),
                ("namespace", namespace),
                ("sparse_values", sparse_values),
            ]
        )
        return self._vector_api.update(
            UpdateRequest(
                id=id,
                **args_dict,
                _check_type=_check_type,
                **{k: v for k, v in kwargs.items() if k not in _OPENAPI_ENDPOINT_PARAMS},
            ),
            **{k: v for k, v in kwargs.items() if k in _OPENAPI_ENDPOINT_PARAMS},
        )

    @validate_and_convert_errors
    def describe_index_stats(
        self, filter: Optional[Dict[str, Union[str, float, int, bool, List, dict]]] = None, **kwargs
    ) -> DescribeIndexStatsResponse:
        """
        The DescribeIndexStats operation returns statistics about the index's contents.
        For example: The vector count per namespace and the number of dimensions.

        API reference: https://docs.pinecone.io/reference/describe_index_stats_post

        Examples:
            >>> index.describe_index_stats()
            >>> index.describe_index_stats(filter={'key': 'value'})

        Args:
            filter (Dict[str, Union[str, float, int, bool, List, dict]]):
            If this parameter is present, the operation only returns statistics for vectors that satisfy the filter.
            See https://www.pinecone.io/docs/metadata-filtering/.. [optional]

        Returns: DescribeIndexStatsResponse object which contains stats about the index.
        """
        _check_type = kwargs.pop("_check_type", False)
        args_dict = self._parse_non_empty_args([("filter", filter)])

        return self._vector_api.describe_index_stats(
            DescribeIndexStatsRequest(
                **args_dict,
                **{k: v for k, v in kwargs.items() if k not in _OPENAPI_ENDPOINT_PARAMS},
                _check_type=_check_type,
            ),
            **{k: v for k, v in kwargs.items() if k in _OPENAPI_ENDPOINT_PARAMS},
        )

    @staticmethod
    def _parse_non_empty_args(args: List[Tuple[str, Any]]) -> Dict[str, Any]:
        return {arg_name: val for arg_name, val in args if val is not None}

    @staticmethod
    def _parse_sparse_values_arg(
        sparse_values: Optional[Union[SparseValues, Dict[str, Union[List[float], List[int]]]]]
    ) -> Optional[SparseValues]:
        if sparse_values is None:
            return None

        if isinstance(sparse_values, SparseValues):
            return sparse_values

        if not isinstance(sparse_values, dict) or "indices" not in sparse_values or "values" not in sparse_values:
            raise ValueError(
                "Invalid sparse values argument. Expected a dict of: {'indices': List[int], 'values': List[float]}."
                f"Received: {sparse_values}"
            )

        return SparseValues(indices=sparse_values["indices"], values=sparse_values["values"])
