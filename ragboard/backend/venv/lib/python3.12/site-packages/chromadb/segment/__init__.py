from typing import Optional, Sequence, TypeVar
from abc import abstractmethod
from chromadb.types import (
    Collection,
    MetadataEmbeddingRecord,
    Operation,
    RequestVersionContext,
    VectorEmbeddingRecord,
    Where,
    WhereDocument,
    VectorQuery,
    VectorQueryResult,
    Segment,
    SeqId,
    Metadata,
)
from chromadb.config import Component, System
from uuid import UUID
from enum import Enum


class SegmentType(Enum):
    SQLITE = "urn:chroma:segment/metadata/sqlite"
    HNSW_LOCAL_MEMORY = "urn:chroma:segment/vector/hnsw-local-memory"
    HNSW_LOCAL_PERSISTED = "urn:chroma:segment/vector/hnsw-local-persisted"
    HNSW_DISTRIBUTED = "urn:chroma:segment/vector/hnsw-distributed"
    BLOCKFILE_RECORD = "urn:chroma:segment/record/blockfile"
    BLOCKFILE_METADATA = "urn:chroma:segment/metadata/blockfile"


class SegmentImplementation(Component):
    @abstractmethod
    def __init__(self, sytstem: System, segment: Segment):
        pass

    @abstractmethod
    def count(self, request_version_context: RequestVersionContext) -> int:
        """Get the number of embeddings in this segment"""
        pass

    @abstractmethod
    def max_seqid(self) -> SeqId:
        """Get the maximum SeqID currently indexed by this segment"""
        pass

    @staticmethod
    def propagate_collection_metadata(metadata: Metadata) -> Optional[Metadata]:
        """Given an arbitrary metadata map (e.g, from a collection), validate it and
        return metadata (if any) that is applicable and should be applied to the
        segment. Validation errors will be reported to the user."""
        return None

    @abstractmethod
    def delete(self) -> None:
        """Delete the segment and all its data"""
        ...


S = TypeVar("S", bound=SegmentImplementation)


class MetadataReader(SegmentImplementation):
    """Embedding Metadata segment interface"""

    @abstractmethod
    def get_metadata(
        self,
        request_version_context: RequestVersionContext,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        ids: Optional[Sequence[str]] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        include_metadata: bool = True,
    ) -> Sequence[MetadataEmbeddingRecord]:
        """Query for embedding metadata."""
        pass


class VectorReader(SegmentImplementation):
    """Embedding Vector segment interface"""

    @abstractmethod
    def get_vectors(
        self,
        request_version_context: RequestVersionContext,
        ids: Optional[Sequence[str]] = None,
    ) -> Sequence[VectorEmbeddingRecord]:
        """Get embeddings from the segment. If no IDs are provided, all embeddings are
        returned."""
        pass

    @abstractmethod
    def query_vectors(
        self, query: VectorQuery
    ) -> Sequence[Sequence[VectorQueryResult]]:
        """Given a vector query, return the top-k nearest neighbors for vector in the
        query."""
        pass


class SegmentManager(Component):
    """Interface for a pluggable strategy for creating, retrieving and instantiating
    segments as required"""

    @abstractmethod
    def prepare_segments_for_new_collection(
        self, collection: Collection
    ) -> Sequence[Segment]:
        """Return the segments required for a new collection. Returns only segment data,
        does not persist to the SysDB"""
        pass

    @abstractmethod
    def delete_segments(self, collection_id: UUID) -> Sequence[UUID]:
        """Delete any local state for all the segments associated with a collection, and
        returns a sequence of their IDs. Does not update the SysDB."""
        pass

    @abstractmethod
    def hint_use_collection(self, collection_id: UUID, hint_type: Operation) -> None:
        """Signal to the segment manager that a collection is about to be used, so that
        it can preload segments as needed. This is only a hint, and implementations are
        free to ignore it."""
        pass
