from typing import Optional, Tuple, List
from chromadb.api import BaseAPI
from chromadb.api.types import (
    Documents,
    Embeddings,
    IDs,
    Metadatas,
)


def create_batches(
    api: BaseAPI,
    ids: IDs,
    embeddings: Optional[Embeddings] = None,
    metadatas: Optional[Metadatas] = None,
    documents: Optional[Documents] = None,
) -> List[Tuple[IDs, Embeddings, Optional[Metadatas], Optional[Documents]]]:
    _batches: List[
        Tuple[IDs, Embeddings, Optional[Metadatas], Optional[Documents]]
    ] = []
    if len(ids) > api.get_max_batch_size():
        # create split batches
        for i in range(0, len(ids), api.get_max_batch_size()):
            _batches.append(
                (  # type: ignore
                    ids[i : i + api.get_max_batch_size()],
                    embeddings[i : i + api.get_max_batch_size()]
                    if embeddings
                    else None,
                    metadatas[i : i + api.get_max_batch_size()] if metadatas else None,
                    documents[i : i + api.get_max_batch_size()] if documents else None,
                )
            )
    else:
        _batches.append((ids, embeddings, metadatas, documents))  # type: ignore
    return _batches
