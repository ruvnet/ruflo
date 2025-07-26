from abc import abstractmethod
from enum import Enum
from typing import Dict, Any, Optional
from uuid import UUID

from chromadb.api.types import (
    Embeddings,
    Metadatas,
    Documents,
    URIs,
    IDs,
    CollectionMetadata,
    Where,
    WhereDocument,
)
from chromadb.config import Component, System


class Action(str, Enum):
    CREATE_DATABASE = "create_database"
    CREATE_COLLECTION = "create_collection"
    LIST_COLLECTIONS = "list_collections"
    UPDATE_COLLECTION = "update_collection"
    ADD = "add"
    GET = "get"
    DELETE = "delete"
    UPDATE = "update"
    UPSERT = "upsert"
    QUERY = "query"


class QuotaEnforcer(Component):
    """
    Exposes hooks to enforce quotas.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)

    @abstractmethod
    def set_context(self, context: Dict[str, Any]) -> None:
        """
        Sets the context for a given request.
        """
        pass

    @abstractmethod
    def enforce(
        self,
        action: Action,
        tenant: str,
        metadatas: Optional[Metadatas] = None,
        documents: Optional[Documents] = None,
        embeddings: Optional[Embeddings] = None,
        uris: Optional[URIs] = None,
        ids: Optional[IDs] = None,
        name: Optional[str] = None,
        new_name: Optional[str] = None,
        metadata: Optional[CollectionMetadata] = None,
        new_metadata: Optional[CollectionMetadata] = None,
        limit: Optional[int] = None,
        where: Optional[Where] = None,
        where_document: Optional[WhereDocument] = None,
        n_results: Optional[int] = None,
        query_embeddings: Optional[Embeddings] = None,
        collection_id: Optional[UUID] = None,
    ) -> None:
        """
        Enforces a quota.
        """
        pass
