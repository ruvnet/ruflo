import os
import pytest
from chromadb.utils.embedding_functions.voyageai_embedding_function import (
    VoyageAIEmbeddingFunction,
)

voyageai = pytest.importorskip("voyageai", reason="voyageai not installed")


def test_with_embedding_dimensions() -> None:
    if os.environ.get("CHROMA_VOYAGE_API_KEY") is None:
        pytest.skip("CHROMA_VOYAGE_API_KEY not set")
    ef = VoyageAIEmbeddingFunction(
        api_key=os.environ["CHROMA_VOYAGE_API_KEY"]
    )
    embeddings = ef(["hello world"])
    assert embeddings is not None
    assert len(embeddings) == 1
    assert len(embeddings[0]) == 1536
