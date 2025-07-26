from abc import abstractmethod
from typing import List, Sequence, Optional, Tuple
from uuid import UUID
from chromadb.api.types import (
    Embeddings,
    Documents,
    IDs,
    Metadatas,
    Metadata,
    Where,
    WhereDocument,
)
from chromadb.config import Component


class DB(Component):
    @abstractmethod
    def create_collection(
        self,
        name: str,
        metadata: Optional[Metadata] = None,
        get_or_create: bool = False,
    ) -> Sequence:  # type: ignore
        pass

    @abstractmethod
    def get_collection(self, name: str) -> Sequence:  # type: ignore
        pass

    @abstractmethod
    def list_collections(
        self, limit: Optional[int] = None, offset: Optional[int] = None
    ) -> Sequence:  # type: ignore
        pass

    @abstractmethod
    def count_collections(self) -> int:
        pass

    @abstractmethod
    def update_collection(
        self,
        id: UUID,
        new_name: Optional[str] = None,
        new_metadata: Optional[Metadata] = None,
    ) -> None:
        pass

    @abstractmethod
    def delete_collection(self, name: str) -> None:
        pass

    @abstractmethod
    def get_collection_uuid_from_name(self, collection_name: str) -> UUID:
        pass

    @abstractmethod
    def add(
        self,
        collection_uuid: UUID,
        embeddings: Embeddings,
        metadatas: Optional[Metadatas],
        documents: Optional[Documents],
        ids: List[str],
    ) -> List[UUID]:
        pass

    @abstractmethod
    def get(
        self,
        where: Optional[Where] = None,
        collection_name: Optional[str] = None,
        collection_uuid: Optional[UUID] = None,
        ids: Optional[IDs] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        where_document: Optional[WhereDocument] = None,
        columns: Optional[List[str]] = None,
    ) -> Sequence:  # type: ignore
        pass

    @abstractmethod
    def update(
        self,
        collection_uuid: UUID,
        ids: IDs,
        embeddings: Optional[Embeddings] = None,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
    ) -> bool:
        pass

    @abstractmethod
    def count(self, collection_id: UUID) -> int:
        pass

    @abstractmethod
    def delete(
        self,
        where: Optional[Where] = None,
        collection_uuid: Optional[UUID] = None,
        ids: Optional[IDs] = None,
        where_document: Optional[WhereDocument] = None,
    ) -> None:
        pass

    @abstractmethod
    def get_nearest_neighbors(
        self,
        collection_uuid: UUID,
        where: Optional[Where] = None,
        embeddings: Optional[Embeddings] = None,
        n_results: int = 10,
        where_document: Optional[WhereDocument] = None,
    ) -> Tuple[List[List[UUID]], List[List[float]]]:
        pass

    @abstractmethod
    def get_by_ids(
        self, uuids: List[UUID], columns: Optional[List[str]] = None
    ) -> Sequence:  # type: ignore
        pass
