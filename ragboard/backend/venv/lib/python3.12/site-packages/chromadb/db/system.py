from abc import abstractmethod
from typing import Optional, Sequence, Tuple
from uuid import UUID
from chromadb.api.collection_configuration import (
    CreateCollectionConfiguration,
    UpdateCollectionConfiguration,
)
from chromadb.types import (
    Collection,
    CollectionAndSegments,
    Database,
    Tenant,
    Metadata,
    Segment,
    SegmentScope,
    OptionalArgument,
    Unspecified,
    UpdateMetadata,
)
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT, Component


class SysDB(Component):
    """Data interface for Chroma's System database"""

    @abstractmethod
    def create_database(
        self, id: UUID, name: str, tenant: str = DEFAULT_TENANT
    ) -> None:
        """Create a new database in the System database. Raises an Error if the Database
        already exists."""
        pass

    @abstractmethod
    def get_database(self, name: str, tenant: str = DEFAULT_TENANT) -> Database:
        """Get a database by name and tenant. Raises an Error if the Database does not
        exist."""
        pass

    @abstractmethod
    def delete_database(self, name: str, tenant: str = DEFAULT_TENANT) -> None:
        """Delete a database."""
        pass

    @abstractmethod
    def list_databases(
        self,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        tenant: str = DEFAULT_TENANT,
    ) -> Sequence[Database]:
        """List all databases for a tenant."""
        pass

    @abstractmethod
    def create_tenant(self, name: str) -> None:
        """Create a new tenant in the System database. The name must be unique.
        Raises an Error if the Tenant already exists."""
        pass

    @abstractmethod
    def get_tenant(self, name: str) -> Tenant:
        """Get a tenant by name. Raises an Error if the Tenant does not exist."""
        pass

    # TODO: Investigate and remove this method, as segment creation is done as
    # part of collection creation.
    @abstractmethod
    def create_segment(self, segment: Segment) -> None:
        """Create a new segment in the System database. Raises an Error if the ID
        already exists."""
        pass

    @abstractmethod
    def delete_segment(self, collection: UUID, id: UUID) -> None:
        """Delete a segment from the System database."""
        pass

    @abstractmethod
    def get_segments(
        self,
        collection: UUID,
        id: Optional[UUID] = None,
        type: Optional[str] = None,
        scope: Optional[SegmentScope] = None,
    ) -> Sequence[Segment]:
        """Find segments by id, type, scope or collection."""
        pass

    @abstractmethod
    def update_segment(
        self,
        collection: UUID,
        id: UUID,
        metadata: OptionalArgument[Optional[UpdateMetadata]] = Unspecified(),
    ) -> None:
        """Update a segment. Unspecified fields will be left unchanged. For the
        metadata, keys with None values will be removed and keys not present in the
        UpdateMetadata dict will be left unchanged."""
        pass

    @abstractmethod
    def create_collection(
        self,
        id: UUID,
        name: str,
        configuration: CreateCollectionConfiguration,
        segments: Sequence[Segment],
        metadata: Optional[Metadata] = None,
        dimension: Optional[int] = None,
        get_or_create: bool = False,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> Tuple[Collection, bool]:
        """Create a new collection and associated resources
        in the SysDB. If get_or_create is True, the
        collection will be created if one with the same name does not exist.
        The metadata will be updated using the same protocol as update_collection. If get_or_create
        is False and the collection already exists, an error will be raised.

        Returns a tuple of the created collection and a boolean indicating whether the
        collection was created or not.
        """
        pass

    @abstractmethod
    def delete_collection(
        self,
        id: UUID,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
    ) -> None:
        """Delete a collection, all associated segments and any associate resources (log stream)
        from the SysDB and the system at large."""
        pass

    @abstractmethod
    def get_collections(
        self,
        id: Optional[UUID] = None,
        name: Optional[str] = None,
        tenant: str = DEFAULT_TENANT,
        database: str = DEFAULT_DATABASE,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Sequence[Collection]:
        """Find collections by id or name. If name is provided, tenant and database must also be provided."""
        pass

    @abstractmethod
    def count_collections(
        self,
        tenant: str = DEFAULT_TENANT,
        database: Optional[str] = None,
    ) -> int:
        """Gets the number of collections for the (tenant, database) combination."""
        pass

    @abstractmethod
    def get_collection_with_segments(
        self, collection_id: UUID
    ) -> CollectionAndSegments:
        """Get a consistent snapshot of a collection by id. This will return a collection with segment
        information that matches the collection version and log position.
        """
        pass

    @abstractmethod
    def update_collection(
        self,
        id: UUID,
        name: OptionalArgument[str] = Unspecified(),
        dimension: OptionalArgument[Optional[int]] = Unspecified(),
        metadata: OptionalArgument[Optional[UpdateMetadata]] = Unspecified(),
        configuration: OptionalArgument[
            Optional[UpdateCollectionConfiguration]
        ] = Unspecified(),
    ) -> None:
        """Update a collection. Unspecified fields will be left unchanged. For metadata,
        keys with None values will be removed and keys not present in the UpdateMetadata
        dict will be left unchanged."""
        pass

    @abstractmethod
    def get_collection_size(self, id: UUID) -> int:
        """Returns the number of records in a collection."""
        pass
