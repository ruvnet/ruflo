import os

import pytest

from chromadb.utils.embedding_functions.openai_embedding_function import (
    OpenAIEmbeddingFunction,
)


def test_with_embedding_dimensions() -> None:
    if os.environ.get("OPENAI_API_KEY") is None:
        pytest.skip("OPENAI_API_KEY not set")
    ef = OpenAIEmbeddingFunction(
        api_key=os.environ["OPENAI_API_KEY"],
        model_name="text-embedding-3-small",
        dimensions=64,
    )
    embeddings = ef(["hello world"])
    assert embeddings is not None
    assert len(embeddings) == 1
    assert len(embeddings[0]) == 64


def test_with_embedding_dimensions_not_working_with_old_model() -> None:
    if os.environ.get("OPENAI_API_KEY") is None:
        pytest.skip("OPENAI_API_KEY not set")
    ef = OpenAIEmbeddingFunction(api_key=os.environ["OPENAI_API_KEY"], dimensions=64)
    with pytest.raises(
        Exception, match="This model does not support specifying dimensions"
    ):
        ef(["hello world"])


def test_with_incorrect_api_key() -> None:
    pytest.importorskip("openai", reason="openai not installed")
    ef = OpenAIEmbeddingFunction(api_key="incorrect_api_key", dimensions=64)
    with pytest.raises(Exception, match="Incorrect API key provided"):
        ef(["hello world"])
