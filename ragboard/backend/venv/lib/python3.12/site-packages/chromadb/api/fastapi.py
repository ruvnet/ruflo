import orjson
import logging
from typing import Any, Dict, Optional, cast, Tuple
from typing import Sequence
from uuid import UUID
import httpx
import urllib.parse
from overrides import override

from chromadb.api.collection_configuration import (
    CreateCollectionConfiguration,
    UpdateCollectionConfiguration,
    update_collection_configuration_to_json,
    create_collection_configuration_to_json,
)
from chromadb import __version__
from chromadb.api.base_http_client import BaseHTTPClient
from chromadb.types import Database, Tenant, Collection as CollectionModel
from chromadb.api import ServerAPI

from chromadb.api.types import (
    Documents,
    Embeddings,
    PyEmbeddings,
    IDs,
    Include,
    Metadatas,
    URIs,
    Where,
    WhereDocument,
    GetResult,
    QueryResult,
    CollectionMetadata,
    validate_batch,
    convert_np_embeddings_to_list,
    IncludeMetadataDocuments,
    IncludeMetadataDocumentsDistances,
    IncludeMetadataDocumentsEmbeddings,
    optional_embeddings_to_base64_strings,
)
from chromadb.auth import UserIdentity
from chromadb.auth import (
    ClientAuthProvider,
)
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT, Settings, System
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    trace_method,
)
from chromadb.telemetry.product import ProductTelemetryClient

logger = logging.getLogger(__name__)


class FastAPI(BaseHTTPClient, ServerAPI):
    def __init__(self, system: System):
        super().__init__(system)
        system.settings.require("chroma_server_host")
        system.settings.require("chroma_server_http_port")

        self._opentelemetry_client = self.require(OpenTelemetryClient)
        self._product_telemetry_client = self.require(ProductTelemetryClient)
        self._settings = system.settings

        self._api_url = FastAPI.resolve_url(
            chroma_server_host=str(system.settings.chroma_server_host),
            chroma_server_http_port=system.settings.chroma_server_http_port,
            chroma_server_ssl_enabled=system.settings.chroma_server_ssl_enabled,
            default_api_path=system.settings.chroma_server_api_default_path,
        )

        limits = httpx.Limits(max_keepalive_connections=self.keepalive_secs)
        self._session = httpx.Client(timeout=None, limits=limits)

        self._header = system.settings.chroma_server_headers or {}
        self._header["Content-Type"] = "application/json"
        self._header["User-Agent"] = (
            "Chroma Python Client v"
            + __version__
            + " (https://github.com/chroma-core/chroma)"
        )

        if self._settings.chroma_server_ssl_verify is not None:
            self._session = httpx.Client(verify=self._settings.chroma_server_ssl_verify)
        if self._header is not None:
            self._session.headers.update(self._header)

        if system.settings.chroma_client_auth_provider:
            self._auth_provider = self.require(ClientAuthProvider)
            _headers = self._auth_provider.authenticate()
            for header, value in _headers.items():
                self._session.headers[header] = value.get_secret_value()

    def _make_request(self, method: str, path: str, **kwargs: Dict[str, Any]) -> Any:
        # If the request has json in kwargs, use orjson to serialize it,
        # remove it from kwargs, and add it to the content parameter
        # This is because httpx uses a slower json serializer
        if "json" in kwargs:
            data = orjson.dumps(kwargs.pop("json"))
            kwargs["content"] = data

        # Unlike requests, httpx does not automatically escape the path
        escaped_path = urllib.parse.quote(path, safe="/", encoding=None, errors=None)
        url = self._api_url + escaped_path

        response = self._session.request(method, url, **cast(Any, kwargs))
        BaseHTTPClient._raise_chroma_error(response)
        return orjson.loads(response.text)

    @trace_method("FastAPI.heartbeat", OpenTelemetryGranularity.OPERATION)
    @override
    def heartbeat(self) -> int:
        """Returns the current server time in nanoseconds to check if the server is alive"""
        resp_json = self._make_request("get", "/heartbeat")
        return int(resp_json["nanosecond heartbeat"])

    # Migrated to rust in distributed.
    @trace_method("FastAPI.create_database", OpenTelemetryGranularity.OPERATION)
    @override
    def create_database(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
    ) -> None:
        """Creates a database"""
        self._make_request(
            "post",
            f"/tenants/{tenant}/databases",
            json={"name": name},
        )

    # Migrated to rust in distributed.
    @trace_method("FastAPI.get_database", OpenTelemetryGranularity.OPERATION)
    @override
    def get_database(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
    ) -> Database:
        """Returns a database"""
        resp_json = self._make_request(
            "get",
            f"/tenants/{tenant}/databases/{name}",
        )
        return Database(
            id=resp_json["id"], name=resp_json["name"], tenant=resp_json["tenant"]
        )

    @trace_method("FastAPI.delete_database", OpenTelemetryGranularity.OPERATION)
    @override
    def delete_database(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
    ) -> None:
        """Deletes a database"""
        self._make_request(
            "delete",
            f"/tenants/{tenant}/databases/{name}",
        )

    @trace_method("FastAPI.list_databases", OpenTelemetryGranularity.OPERATION)
    @override
    def list_databases(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
    ) -> Sequence[Database]:
        """Returns a list of all databases"""
        json_databases = self._make_request(
            "get",
            f"/tenants/{tenant}/databases",
            params=BaseHTTPClient._clean_params(
                {
                    "limit": limit,
                    "offset": offset,
                }
            ),
        )
        databases = [
            Database(id=db["id"], name=db["name"], tenant=db["tenant"])
            for db in json_databases
        ]
        return databases

    @trace_method("FastAPI.create_tenant", OpenTelemetryGranularity.OPERATION)
    @override
    def create_tenant(self, name: str) -> None:
        self._make_request("post", "/tenants", json={"name": name})

    @trace_method("FastAPI.get_tenant", OpenTelemetryGranularity.OPERATION)
    @override
    def get_tenant(self, name: str) -> Tenant:
        resp_json = self._make_request("get", "/tenants/" + name)
        return Tenant(name=resp_json["name"])

    @trace_method("FastAPI.get_user_identity", OpenTelemetryGranularity.OPERATION)
    @override
    def get_user_identity(self) -> UserIdentity:
        return UserIdentity(**self._make_request("get", "/auth/identity"))

    @trace_method("FastAPI.list_collections", OpenTelemetryGranularity.OPERATION)
    @override
    def list_collections(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> Sequence[CollectionModel]:
        """Returns a list of all collections"""
        json_collections = self._make_request(
            "get",
            f"/tenants/{tenant}/databases/{database}/collections",
            params=BaseHTTPClient._clean_params(
                {
                    "limit": limit,
                    "offset": offset,
                }
            ),
        )
        collection_models = [
            CollectionModel.from_json(json_collection)
            for json_collection in json_collections
        ]

        return collection_models

    @trace_method("FastAPI.count_collections", OpenTelemetryGranularity.OPERATION)
    @override
    def count_collections(
        self, tenant: str = DEFAULT_TENANT, database: str = DEFAULT_DATABASE
    ) -> int:
        """Returns a count of collections"""
        resp_json = self._make_request(
            "get",
            f"/tenants/{tenant}/databases/{database}/collections_count",
        )
        return cast(int, resp_json)

    @trace_method("FastAPI.create_collection", OpenTelemetryGranularity.OPERATION)
    @override
    def create_collection(
        self,
        name: str,
        configuration: Optional[CreateCollectionConfiguration] = None,
        metadata: Optional[CollectionMetadata] = None,
        get_or_create: bool = False,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        """Creates a collection"""
        resp_json = self._make_request(
            "post",
            f"/tenants/{tenant}/databases/{database}/collections",
            json={
                "name": name,
                "metadata": metadata,
                "configuration": create_collection_configuration_to_json(configuration)
                if configuration
                else None,
                "get_or_create": get_or_create,
            },
        )
        model = CollectionModel.from_json(resp_json)

        return model

    @trace_method("FastAPI.get_collection", OpenTelemetryGranularity.OPERATION)
    @override
    def get_collection(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        """Returns a collection"""
        resp_json = self._make_request(
            "get",
            f"/tenants/{tenant}/databases/{database}/collections/{name}",
        )

        model = CollectionModel.from_json(resp_json)
        return model

    @trace_method(
        "FastAPI.get_or_create_collection", OpenTelemetryGranularity.OPERATION
    )
    @override
    def get_or_create_collection(
        self,
        name: str,
        configuration: Optional[CreateCollectionConfiguration] = None,
        metadata: Optional[CollectionMetadata] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        return self.create_collection(
            name=name,
            metadata=metadata,
            configuration=configuration,
            get_or_create=True,
            tenant=tenant,
            database=database,
        )

    @trace_method("FastAPI._modify", OpenTelemetryGranularity.OPERATION)
    @override
    def _modify(
        self,
        id: UUID,
        new_name: Optional[str] = None,
        new_metadata: Optional[CollectionMetadata] = None,
        new_configuration: Optional[UpdateCollectionConfiguration] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        """Updates a collection"""
        self._make_request(
            "put",
            f"/tenants/{tenant}/databases/{database}/collections/{id}",
            json={
                "new_metadata": new_metadata,
                "new_name": new_name,
                "new_configuration": update_collection_configuration_to_json(
                    new_configuration
                )
                if new_configuration
                else None,
            },
        )

    @trace_method("FastAPI._fork", OpenTelemetryGranularity.OPERATION)
    @override
    def _fork(
        self,
        collection_id: UUID,
        new_name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        """Forks a collection"""
        resp_json = self._make_request(
            "post",
            f"/tenants/{tenant}/databases/{database}/collections/{collection_id}/fork",
            json={"new_name": new_name},
        )
        model = CollectionModel.from_json(resp_json)
        return model

    @trace_method("FastAPI.delete_collection", OpenTelemetryGranularity.OPERATION)
    @override
    def delete_collection(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        """Deletes a collection"""
        self._make_request(
            "delete",
            f"/tenants/{tenant}/databases/{database}/collections/{name}",
        )

    @trace_method("FastAPI._count", OpenTelemetryGranularity.OPERATION)
    @override
    def _count(
        self,
        collection_id: UUID,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> int:
        """Returns the number of embeddings in the database"""
        resp_json = self._make_request(
            "get",
            f"/tenants/{tenant}/databases/{database}/collections/{collection_id}/count",
        )
        return cast(int, resp_json)

    @trace_method("FastAPI._peek", OpenTelemetryGranularity.OPERATION)
    @override
    def _peek(
        self,
        collection_id: UUID,
        n: int = 10,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> GetResult:
        return cast(
            GetResult,
            self._get(
                collection_id,
                tenant=tenant,
                database=database,
                limit=n,
                include=IncludeMetadataDocumentsEmbeddings,
            ),
        )

    @trace_method("FastAPI._get", OpenTelemetryGranularity.OPERATION)
    @override
    def _get(
        self,
        collection_id: UUID,
        ids: Optional[IDs] = None,
        where: Optional[Where] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        where_document: Optional[WhereDocument] = None,
        include: Include = IncludeMetadataDocuments,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> GetResult:
        # Servers do not support receiving "data", as that is hydrated by the client as a loadable
        filtered_include = [i for i in include if i != "data"]

        resp_json = self._make_request(
            "post",
            f"/tenants/{tenant}/databases/{database}/collections/{collection_id}/get",
            json={
                "ids": ids,
                "where": where,
                "limit": limit,
                "offset": offset,
                "where_document": where_document,
                "include": filtered_include,
            },
        )

        return GetResult(
            ids=resp_json["ids"],
            embeddings=resp_json.get("embeddings", None),
            metadatas=resp_json.get("metadatas", None),
            documents=resp_json.get("documents", None),
            data=None,
            uris=resp_json.get("uris", None),
            included=include,
        )

    @trace_method("FastAPI._delete", OpenTelemetryGranularity.OPERATION)
    @override
    def _delete(
        self,
        collection_id: UUID,
        ids: Optional[IDs] = None,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        """Deletes embeddings from the database"""
        self._make_request(
            "post",
            f"/tenants/{tenant}/databases/{database}/collections/{collection_id}/delete",
            json={
                "ids": ids,
                "where": where,
                "where_document": where_document,
            },
        )
        return None

    @trace_method("FastAPI._submit_batch", OpenTelemetryGranularity.ALL)
    def _submit_batch(
        self,
        batch: Tuple[
            IDs,
            Optional[PyEmbeddings],
            Optional[Metadatas],
            Optional[Documents],
            Optional[URIs],
        ],
        url: str,
    ) -> None:
        """
        Submits a batch of embeddings to the database
        """
        data = {
            "ids": batch[0],
            "embeddings": optional_embeddings_to_base64_strings(batch[1])
            if self.supports_base64_encoding()
            else batch[1],
            "metadatas": batch[2],
            "documents": batch[3],
            "uris": batch[4],
        }

        self._make_request("post", url, json=data)

    @trace_method("FastAPI._add", OpenTelemetryGranularity.ALL)
    @override
    def _add(
        self,
        ids: IDs,
        collection_id: UUID,
        embeddings: Embeddings,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool:
        """
        Adds a batch of embeddings to the database
        - pass in column oriented data lists
        """
        batch = (
            ids,
            convert_np_embeddings_to_list(embeddings),
            metadatas,
            documents,
            uris,
        )
        validate_batch(batch, {"max_batch_size": self.get_max_batch_size()})
        self._submit_batch(
            batch,
            f"/tenants/{tenant}/databases/{database}/collections/{str(collection_id)}/add",
        )
        return True

    @trace_method("FastAPI._update", OpenTelemetryGranularity.ALL)
    @override
    def _update(
        self,
        collection_id: UUID,
        ids: IDs,
        embeddings: Optional[Embeddings] = None,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool:
        """
        Updates a batch of embeddings in the database
        - pass in column oriented data lists
        """
        batch = (
            ids,
            convert_np_embeddings_to_list(embeddings)
            if embeddings is not None
            else None,
            metadatas,
            documents,
            uris,
        )
        validate_batch(batch, {"max_batch_size": self.get_max_batch_size()})
        self._submit_batch(
            batch,
            f"/tenants/{tenant}/databases/{database}/collections/{str(collection_id)}/update",
        )
        return True

    @trace_method("FastAPI._upsert", OpenTelemetryGranularity.ALL)
    @override
    def _upsert(
        self,
        collection_id: UUID,
        ids: IDs,
        embeddings: Embeddings,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool:
        """
        Upserts a batch of embeddings in the database
        - pass in column oriented data lists
        """
        batch = (
            ids,
            convert_np_embeddings_to_list(embeddings),
            metadatas,
            documents,
            uris,
        )
        validate_batch(batch, {"max_batch_size": self.get_max_batch_size()})
        self._submit_batch(
            batch,
            f"/tenants/{tenant}/databases/{database}/collections/{str(collection_id)}/upsert",
        )
        return True

    @trace_method("FastAPI._query", OpenTelemetryGranularity.ALL)
    @override
    def _query(
        self,
        collection_id: UUID,
        query_embeddings: Embeddings,
        ids: Optional[IDs] = None,
        n_results: int = 10,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        include: Include = IncludeMetadataDocumentsDistances,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> QueryResult:
        # Clients do not support receiving "data", as that is hydrated by the client as a loadable
        filtered_include = [i for i in include if i != "data"]

        """Gets the nearest neighbors of a single embedding"""
        resp_json = self._make_request(
            "post",
            f"/tenants/{tenant}/databases/{database}/collections/{collection_id}/query",
            json={
                "ids": ids,
                "query_embeddings": convert_np_embeddings_to_list(query_embeddings)
                if query_embeddings is not None
                else None,
                "n_results": n_results,
                "where": where,
                "where_document": where_document,
                "include": filtered_include,
            },
        )

        return QueryResult(
            ids=resp_json["ids"],
            distances=resp_json.get("distances", None),
            embeddings=resp_json.get("embeddings", None),
            metadatas=resp_json.get("metadatas", None),
            documents=resp_json.get("documents", None),
            uris=resp_json.get("uris", None),
            data=None,
            included=include,
        )

    @trace_method("FastAPI.reset", OpenTelemetryGranularity.ALL)
    @override
    def reset(self) -> bool:
        """Resets the database"""
        resp_json = self._make_request("post", "/reset")
        return cast(bool, resp_json)

    @trace_method("FastAPI.get_version", OpenTelemetryGranularity.OPERATION)
    @override
    def get_version(self) -> str:
        """Returns the version of the server"""
        resp_json = self._make_request("get", "/version")
        return cast(str, resp_json)

    @override
    def get_settings(self) -> Settings:
        """Returns the settings of the client"""
        return self._settings

    @trace_method("FastAPI.get_pre_flight_checks", OpenTelemetryGranularity.OPERATION)
    def get_pre_flight_checks(self) -> Any:
        if self.pre_flight_checks is None:
            resp_json = self._make_request("get", "/pre-flight-checks")
            self.pre_flight_checks = resp_json
        return self.pre_flight_checks

    @trace_method(
        "FastAPI.supports_base64_encoding", OpenTelemetryGranularity.OPERATION
    )
    def supports_base64_encoding(self) -> bool:
        pre_flight_checks = self.get_pre_flight_checks()
        b64_encoding_enabled = cast(
            bool, pre_flight_checks.get("supports_base64_encoding", False)
        )
        return b64_encoding_enabled

    @trace_method("FastAPI.get_max_batch_size", OpenTelemetryGranularity.OPERATION)
    @override
    def get_max_batch_size(self) -> int:
        pre_flight_checks = self.get_pre_flight_checks()
        max_batch_size = cast(int, pre_flight_checks.get("max_batch_size", -1))
        return max_batch_size
