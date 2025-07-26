from typing import List, Optional, Sequence
from uuid import UUID
from chromadb import CollectionMetadata, Embeddings, IDs
from chromadb.api.types import (
    CollectionMetadata,
    Documents,
    Embeddings,
    IDs,
    Metadatas,
    URIs,
    Include,
)
from chromadb.types import Tenant, Collection as CollectionModel
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT
from enum import Enum

class DatabaseFromBindings:
    id: UUID
    name: str
    tenant: str

# Result Types

class GetResponse:
    ids: IDs
    embeddings: Embeddings
    documents: Documents
    uris: URIs
    metadatas: Metadatas
    include: Include

class QueryResponse:
    ids: List[IDs]
    embeddings: Optional[List[Embeddings]]
    documents: Optional[List[Documents]]
    uris: Optional[List[URIs]]
    metadatas: Optional[List[Metadatas]]
    distances: Optional[List[List[float]]]
    include: Include

class GetTenantResponse:
    name: str

# SqliteDBConfig types
class MigrationMode(Enum):
    Apply = 0
    Validate = 1

class MigrationHash(Enum):
    SHA256 = 0
    MD5 = 1

class SqliteDBConfig:
    url: str
    hash_type: MigrationHash
    migration_mode: MigrationMode

    def __init__(
        self, url: str, hash_type: MigrationHash, migration_mode: MigrationMode
    ) -> None: ...

class Bindings:
    def __init__(
        self,
        allow_reset: bool,
        sqlite_db_config: SqliteDBConfig,
        persist_path: str,
        hnsw_cache_size: int,
    ) -> None: ...
    def heartbeat(self) -> int: ...
    def create_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None: ...
    def get_database(
        self, name: str, tenant: str = DEFAULT_TENANT
    ) -> DatabaseFromBindings: ...
    def delete_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None: ...
    def list_databases(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
    ) -> Sequence[DatabaseFromBindings]: ...
    def create_tenant(self, name: str) -> None: ...
    def get_tenant(self, name: str) -> GetTenantResponse: ...
    def count_collections(
        self, tenant: str = DEFAULT_TENANT, database: str = DEFAULT_DATABASE
    ) -> int: ...
    def list_collections(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> Sequence[CollectionModel]: ...
    def create_collection(
        self,
        name: str,
        configuration_json_str: Optional[str] = None,
        metadata: Optional[CollectionMetadata] = None,
        get_or_create: bool = False,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel: ...
    def get_collection(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel: ...
    def update_collection(
        self,
        id: str,
        new_name: Optional[str] = None,
        new_metadata: Optional[CollectionMetadata] = None,
        new_configuration_json_str: Optional[str] = None,
    ) -> None: ...
    def delete_collection(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None: ...
    def add(
        self,
        ids: IDs,
        collection_id: str,
        embeddings: Embeddings,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool: ...
    def update(
        self,
        collection_id: str,
        ids: IDs,
        embeddings: Optional[Embeddings] = None,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool: ...
    def upsert(
        self,
        collection_id: str,
        ids: IDs,
        embeddings: Optional[Embeddings] = None,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> bool: ...
    def delete(
        self,
        collection_id: str,
        ids: Optional[IDs] = None,
        where: Optional[str] = None,
        where_document: Optional[str] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None: ...
    def count(
        self,
        collection_id: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> int: ...
    def get(
        self,
        collection_id: str,
        ids: Optional[IDs] = None,
        where: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        where_document: Optional[str] = None,
        include: Include = ["metadatas", "documents"],  # type: ignore[list-item]
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> GetResponse: ...
    def query(
        self,
        collection_id: str,
        query_embeddings: Embeddings,
        n_results: int = 10,
        where: Optional[str] = None,
        where_document: Optional[str] = None,
        include: Include = ["metadatas", "documents", "distances"],  # type: ignore[list-item]
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> QueryResponse: ...
    def reset(self) -> bool: ...
    def get_version(self) -> str: ...
