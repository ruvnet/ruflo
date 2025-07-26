from abc import ABC, abstractmethod
from typing import Sequence, Optional
from uuid import UUID

from overrides import override
from chromadb.api.collection_configuration import (
    CreateCollectionConfiguration,
    UpdateCollectionConfiguration,
)
from chromadb.auth import UserIdentity
from chromadb.api.models.AsyncCollection import AsyncCollection
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT
from chromadb.api.types import (
    CollectionMetadata,
    Documents,
    Embeddable,
    EmbeddingFunction,
    DataLoader,
    Embeddings,
    IDs,
    Include,
    Loadable,
    Metadatas,
    URIs,
    Where,
    QueryResult,
    GetResult,
    WhereDocument,
    IncludeMetadataDocuments,
    IncludeMetadataDocumentsDistances,
)
from chromadb.config import Component, Settings
from chromadb.types import Database, Tenant, Collection as CollectionModel
import chromadb.utils.embedding_functions as ef


class AsyncBaseAPI(ABC):
    @abstractmethod
    async def heartbeat(self) -> int:
        """Get the current time in nanoseconds since epoch.
        Used to check if the server is alive.

        Returns:
            int: The current time in nanoseconds since epoch

        """
        pass

    #
    # COLLECTION METHODS
    #

    @abstractmethod
    async def count_collections(self) -> int:
        """Count the number of collections.

        Returns:
            int: The number of collections.

        Examples:
            ```python
            await client.count_collections()
            # 1
            ```
        """
        pass

    @abstractmethod
    async def _modify(
        self,
        id: UUID,
        new_name: Optional[str] = None,
        new_metadata: Optional[CollectionMetadata] = None,
        new_configuration: Optional[UpdateCollectionConfiguration] = None,
    ) -> None:
        """[Internal] Modify a collection by UUID. Can update the name and/or metadata.

        Args:
            id: The internal UUID of the collection to modify.
            new_name: The new name of the collection.
                                If None, the existing name will remain. Defaults to None.
            new_metadata: The new metadata to associate with the collection.
                                      Defaults to None.
            new_configuration: The new configuration to associate with the collection.
                                      Defaults to None.
        """
        pass

    @abstractmethod
    async def delete_collection(
        self,
        name: str,
    ) -> None:
        """Delete a collection with the given name.
        Args:
            name: The name of the collection to delete.

        Raises:
            ValueError: If the collection does not exist.

        Examples:
            ```python
            await client.delete_collection("my_collection")
            ```
        """
        pass

    #
    # ITEM METHODS
    #

    @abstractmethod
    async def _add(
        self,
        ids: IDs,
        collection_id: UUID,
        embeddings: Embeddings,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
    ) -> bool:
        """[Internal] Add embeddings to a collection specified by UUID.
        If (some) ids already exist, only the new embeddings will be added.

        Args:
            ids: The ids to associate with the embeddings.
            collection_id: The UUID of the collection to add the embeddings to.
            embedding: The sequence of embeddings to add.
            metadata: The metadata to associate with the embeddings. Defaults to None.
            documents: The documents to associate with the embeddings. Defaults to None.
            uris: URIs of data sources for each embedding. Defaults to None.

        Returns:
            True if the embeddings were added successfully.
        """
        pass

    @abstractmethod
    async def _update(
        self,
        collection_id: UUID,
        ids: IDs,
        embeddings: Optional[Embeddings] = None,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
    ) -> bool:
        """[Internal] Update entries in a collection specified by UUID.

        Args:
            collection_id: The UUID of the collection to update the embeddings in.
            ids: The IDs of the entries to update.
            embeddings: The sequence of embeddings to update. Defaults to None.
            metadatas: The metadata to associate with the embeddings. Defaults to None.
            documents: The documents to associate with the embeddings. Defaults to None.
            uris: URIs of data sources for each embedding. Defaults to None.
        Returns:
            True if the embeddings were updated successfully.
        """
        pass

    @abstractmethod
    async def _upsert(
        self,
        collection_id: UUID,
        ids: IDs,
        embeddings: Embeddings,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        uris: Optional[URIs] = None,
    ) -> bool:
        """[Internal] Add or update entries in the a collection specified by UUID.
        If an entry with the same id already exists, it will be updated,
        otherwise it will be added.

        Args:
            collection_id: The collection to add the embeddings to
            ids: The ids to associate with the embeddings. Defaults to None.
            embeddings: The sequence of embeddings to add
            metadatas: The metadata to associate with the embeddings. Defaults to None.
            documents: The documents to associate with the embeddings. Defaults to None.
            uris: URIs of data sources for each embedding. Defaults to None.
        """
        pass

    @abstractmethod
    async def _count(self, collection_id: UUID) -> int:
        """[Internal] Returns the number of entries in a collection specified by UUID.

        Args:
            collection_id: The UUID of the collection to count the embeddings in.

        Returns:
            int: The number of embeddings in the collection

        """
        pass

    @abstractmethod
    async def _peek(self, collection_id: UUID, n: int = 10) -> GetResult:
        """[Internal] Returns the first n entries in a collection specified by UUID.

        Args:
            collection_id: The UUID of the collection to peek into.
            n: The number of entries to peek. Defaults to 10.

        Returns:
            GetResult: The first n entries in the collection.

        """

        pass

    @abstractmethod
    async def _get(
        self,
        collection_id: UUID,
        ids: Optional[IDs] = None,
        where: Optional[Where] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        where_document: Optional[WhereDocument] = None,
        include: Include = IncludeMetadataDocuments,
    ) -> GetResult:
        """[Internal] Returns entries from a collection specified by UUID.

        Args:
            ids: The IDs of the entries to get. Defaults to None.
            where: Conditional filtering on metadata. Defaults to None.
            limit: The maximum number of entries to return. Defaults to None.
            offset: The number of entries to skip before returning. Defaults to None.
            where_document: Conditional filtering on documents. Defaults to None.
            include: The fields to include in the response.
                          Defaults to ["embeddings", "metadatas", "documents"].
        Returns:
            GetResult: The entries in the collection that match the query.

        """
        pass

    @abstractmethod
    async def _delete(
        self,
        collection_id: UUID,
        ids: Optional[IDs],
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
    ) -> None:
        """[Internal] Deletes entries from a collection specified by UUID.

        Args:
            collection_id: The UUID of the collection to delete the entries from.
            ids: The IDs of the entries to delete. Defaults to None.
            where: Conditional filtering on metadata. Defaults to None.
            where_document: Conditional filtering on documents. Defaults to None.

        Returns:
            IDs: The list of IDs of the entries that were deleted.
        """
        pass

    @abstractmethod
    async def _query(
        self,
        collection_id: UUID,
        query_embeddings: Embeddings,
        ids: Optional[IDs] = None,
        n_results: int = 10,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        include: Include = IncludeMetadataDocumentsDistances,
    ) -> QueryResult:
        """[Internal] Performs a nearest neighbors query on a collection specified by UUID.

        Args:
            collection_id: The UUID of the collection to query.
            query_embeddings: The embeddings to use as the query.
            n_results: The number of results to return. Defaults to 10.
            where: Conditional filtering on metadata. Defaults to None.
            where_document: Conditional filtering on documents. Defaults to None.
            include: The fields to include in the response.
                          Defaults to ["embeddings", "metadatas", "documents", "distances"].

        Returns:
            QueryResult: The results of the query.
        """
        pass

    @abstractmethod
    async def reset(self) -> bool:
        """Resets the database. This will delete all collections and entries.

        Returns:
            bool: True if the database was reset successfully.
        """
        pass

    @abstractmethod
    async def get_version(self) -> str:
        """Get the version of Chroma.

        Returns:
            str: The version of Chroma

        """
        pass

    @abstractmethod
    def get_settings(self) -> Settings:
        """Get the settings used to initialize.

        Returns:
            Settings: The settings used to initialize.

        """
        pass

    @abstractmethod
    async def get_max_batch_size(self) -> int:
        """Return the maximum number of records that can be created or mutated in a single call."""
        pass

    @abstractmethod
    async def get_user_identity(self) -> UserIdentity:
        """Resolve the tenant and databases for the client. Returns the default
        values if can't be resolved.

        """
        pass


class AsyncClientAPI(AsyncBaseAPI, ABC):
    tenant: str
    database: str

    @abstractmethod
    async def list_collections(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Sequence[AsyncCollection]:
        """List all collections.
        Args:
            limit: The maximum number of entries to return. Defaults to None.
            offset: The number of entries to skip before returning. Defaults to None.

        Returns:
            Sequence[AsyncCollection]: A list of collections.

        Examples:
            ```python
            await client.list_collections()
            # [collection(name="my_collection", metadata={})]
            ```
        """
        pass

    @abstractmethod
    async def create_collection(
        self,
        name: str,
        configuration: Optional[CreateCollectionConfiguration] = None,
        metadata: Optional[CollectionMetadata] = None,
        embedding_function: Optional[
            EmbeddingFunction[Embeddable]
        ] = ef.DefaultEmbeddingFunction(),  # type: ignore
        data_loader: Optional[DataLoader[Loadable]] = None,
        get_or_create: bool = False,
    ) -> AsyncCollection:
        """Create a new collection with the given name and metadata.
        Args:
            name: The name of the collection to create.
            metadata: Optional metadata to associate with the collection.
            embedding_function: Optional function to use to embed documents.
                                Uses the default embedding function if not provided.
            get_or_create: If True, return the existing collection if it exists.
            data_loader: Optional function to use to load records (documents, images, etc.)

        Returns:
            Collection: The newly created collection.

        Raises:
            ValueError: If the collection already exists and get_or_create is False.
            ValueError: If the collection name is invalid.

        Examples:
            ```python
            await client.create_collection("my_collection")
            # collection(name="my_collection", metadata={})

            await client.create_collection("my_collection", metadata={"foo": "bar"})
            # collection(name="my_collection", metadata={"foo": "bar"})
            ```
        """
        pass

    @abstractmethod
    async def get_collection(
        self,
        name: str,
        embedding_function: Optional[
            EmbeddingFunction[Embeddable]
        ] = ef.DefaultEmbeddingFunction(),  # type: ignore
        data_loader: Optional[DataLoader[Loadable]] = None,
    ) -> AsyncCollection:
        """Get a collection with the given name.
        Args:
            name: The name of the collection to get
            embedding_function: Optional function to use to embed documents.
                                Uses the default embedding function if not provided.
            data_loader: Optional function to use to load records (documents, images, etc.)

        Returns:
            Collection: The collection

        Raises:
            ValueError: If the collection does not exist

        Examples:
            ```python
            await client.get_collection("my_collection")
            # collection(name="my_collection", metadata={})
            ```
        """
        pass

    @abstractmethod
    async def get_or_create_collection(
        self,
        name: str,
        configuration: Optional[CreateCollectionConfiguration] = None,
        metadata: Optional[CollectionMetadata] = None,
        embedding_function: Optional[
            EmbeddingFunction[Embeddable]
        ] = ef.DefaultEmbeddingFunction(),  # type: ignore
        data_loader: Optional[DataLoader[Loadable]] = None,
    ) -> AsyncCollection:
        """Get or create a collection with the given name and metadata.
        Args:
            name: The name of the collection to get or create
            metadata: Optional metadata to associate with the collection. If
            the collection already exists, the metadata provided is ignored.
            If the collection does not exist, the new collection will be created
            with the provided metadata.
            embedding_function: Optional function to use to embed documents
            data_loader: Optional function to use to load records (documents, images, etc.)

        Returns:
            The collection

        Examples:
            ```python
            await client.get_or_create_collection("my_collection")
            # collection(name="my_collection", metadata={})
            ```
        """
        pass

    @abstractmethod
    async def set_tenant(self, tenant: str, database: str = DEFAULT_DATABASE) -> None:
        """Set the tenant and database for the client. Raises an error if the tenant or
        database does not exist.

        Args:
            tenant: The tenant to set.
            database: The database to set.

        """
        pass

    @abstractmethod
    async def set_database(self, database: str) -> None:
        """Set the database for the client. Raises an error if the database does not exist.

        Args:
            database: The database to set.

        """
        pass

    @staticmethod
    @abstractmethod
    def clear_system_cache() -> None:
        """Clear the system cache so that new systems can be created for an existing path.
        This should only be used for testing purposes."""
        pass


class AsyncAdminAPI(ABC):
    @abstractmethod
    async def create_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None:
        """Create a new database. Raises an error if the database already exists.

        Args:
            database: The name of the database to create.

        """
        pass

    @abstractmethod
    async def get_database(self, name: str, tenant: str = DEFAULT_TENANT) -> Database:
        """Get a database. Raises an error if the database does not exist.

        Args:
            database: The name of the database to get.
            tenant: The tenant of the database to get.

        """
        pass

    @abstractmethod
    async def delete_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None:
        """Delete a database. Raises an error if the database does not exist.

        Args:
            database: The name of the database to delete.
            tenant: The tenant of the database to delete.

        """
        pass

    @abstractmethod
    async def list_databases(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
    ) -> Sequence[Database]:
        """List all databases for a tenant. Raises an error if the tenant does not exist.

        Args:
            tenant: The tenant to list databases for.

        """
        pass

    @abstractmethod
    async def create_tenant(self, name: str) -> None:
        """Create a new tenant. Raises an error if the tenant already exists.

        Args:
            tenant: The name of the tenant to create.

        """
        pass

    @abstractmethod
    async def get_tenant(self, name: str) -> Tenant:
        """Get a tenant. Raises an error if the tenant does not exist.

        Args:
            tenant: The name of the tenant to get.

        """
        pass


class AsyncServerAPI(AsyncBaseAPI, AsyncAdminAPI, Component):
    """An API instance that extends the relevant Base API methods by passing
    in a tenant and database. This is the root component of the Chroma System"""

    @abstractmethod
    async def list_collections(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> Sequence[CollectionModel]:
        pass

    @abstractmethod
    @override
    async def count_collections(
        self, tenant: str = DEFAULT_TENANT, database: str = DEFAULT_DATABASE
    ) -> int:
        pass

    @abstractmethod
    async def create_collection(
        self,
        name: str,
        configuration: Optional[CreateCollectionConfiguration] = None,
        metadata: Optional[CollectionMetadata] = None,
        get_or_create: bool = False,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        pass

    @abstractmethod
    async def get_collection(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        pass

    @abstractmethod
    async def get_or_create_collection(
        self,
        name: str,
        configuration: Optional[CreateCollectionConfiguration] = None,
        metadata: Optional[CollectionMetadata] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        pass

    @abstractmethod
    @override
    async def delete_collection(
        self,
        name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        pass

    @abstractmethod
    @override
    async def _modify(
        self,
        id: UUID,
        new_name: Optional[str] = None,
        new_metadata: Optional[CollectionMetadata] = None,
        new_configuration: Optional[UpdateCollectionConfiguration] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        pass

    @abstractmethod
    async def _fork(
        self,
        collection_id: UUID,
        new_name: str,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> CollectionModel:
        pass

    @abstractmethod
    @override
    async def _count(
        self,
        collection_id: UUID,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> int:
        pass

    @abstractmethod
    @override
    async def _peek(
        self,
        collection_id: UUID,
        n: int = 10,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> GetResult:
        pass

    @abstractmethod
    @override
    async def _get(
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
        pass

    @abstractmethod
    @override
    async def _add(
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
        pass

    @abstractmethod
    @override
    async def _update(
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
        pass

    @abstractmethod
    @override
    async def _upsert(
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
        pass

    @abstractmethod
    @override
    async def _query(
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
        pass

    @abstractmethod
    @override
    async def _delete(
        self,
        collection_id: UUID,
        ids: Optional[IDs] = None,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        pass
