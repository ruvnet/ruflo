from overrides import override
from typing import Any, Callable, TypeVar, Dict, Optional
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
from chromadb.quota import QuotaEnforcer, Action
from chromadb.config import System

T = TypeVar("T", bound=Callable[..., Any])


class SimpleQuotaEnforcer(QuotaEnforcer):
    """
    A naive implementation of a quota enforcer that allows all requests.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)

    @override
    def set_context(self, context: Dict[str, Any]) -> None:
        pass

    @override
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
        pass
