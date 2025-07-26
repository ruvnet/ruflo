from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from chromadb.api.types import (
    CollectionMetadata,
    Include,
    IncludeMetadataDocuments,
    IncludeMetadataDocumentsDistances,
)


class AddEmbedding(BaseModel):
    # Pydantic doesn't handle Union types cleanly like Embeddings which has
    # Union[int, float] so we use Any here to ensure data is parsed
    # to its original type.
    embeddings: Optional[List[Any]] = None
    metadatas: Optional[List[Optional[Dict[Any, Any]]]] = None
    documents: Optional[List[Optional[str]]] = None
    uris: Optional[List[Optional[str]]] = None
    ids: List[str]


class UpdateEmbedding(BaseModel):
    embeddings: Optional[List[Any]] = None
    metadatas: Optional[List[Optional[Dict[Any, Any]]]] = None
    documents: Optional[List[Optional[str]]] = None
    uris: Optional[List[Optional[str]]] = None
    ids: List[str]


class QueryEmbedding(BaseModel):
    # TODO: Pydantic doesn't bode well with recursive types so we use generic Dicts
    # for Where and WhereDocument. This is not ideal, but it works for now since
    # there is a lot of downstream validation.
    where: Optional[Dict[Any, Any]] = None
    where_document: Optional[Dict[Any, Any]] = None
    query_embeddings: List[Any]
    n_results: int = 10
    include: Include = IncludeMetadataDocumentsDistances


class GetEmbedding(BaseModel):
    ids: Optional[List[str]] = None
    where: Optional[Dict[Any, Any]] = None
    where_document: Optional[Dict[Any, Any]] = None
    limit: Optional[int] = None
    offset: Optional[int] = None
    include: Include = IncludeMetadataDocuments


class DeleteEmbedding(BaseModel):
    ids: Optional[List[str]] = None
    where: Optional[Dict[Any, Any]] = None
    where_document: Optional[Dict[Any, Any]] = None


class CreateCollection(BaseModel):
    name: str
    # TODO: Make CollectionConfiguration a Pydantic model
    # In 0.5.4 we added the configuration field to the CreateCollection model
    # This field is optional, for backwards compatibility with older versions
    # we default to None.
    configuration: Optional[Dict[str, Any]] = None
    metadata: Optional[CollectionMetadata] = None
    get_or_create: bool = False


class UpdateCollection(BaseModel):
    new_name: Optional[str] = None
    new_metadata: Optional[CollectionMetadata] = None
    new_configuration: Optional[Dict[str, Any]] = None


class CreateDatabase(BaseModel):
    name: str


class CreateTenant(BaseModel):
    name: str
