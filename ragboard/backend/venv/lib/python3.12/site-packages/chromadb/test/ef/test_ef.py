from chromadb.utils import embedding_functions
from chromadb.utils.embedding_functions import (
    EmbeddingFunction,
    register_embedding_function,
)
from typing import Dict, Any
import pytest
from chromadb.api.types import (
    Embeddings,
    Space,
    Embeddable,
)
from chromadb.api.models.CollectionCommon import validation_context


def test_get_builtins_holds() -> None:
    """
    Ensure that `get_builtins` is consistent after the ef migration.

    This test is intended to be temporary until the ef migration is complete as
    these expected builtins are likely to grow as long as users add new
    embedding functions.

    REMOVE ME ON THE NEXT EF ADDITION
    """
    expected_builtins = {
        "AmazonBedrockEmbeddingFunction",
        "BasetenEmbeddingFunction",
        "CloudflareWorkersAIEmbeddingFunction",
        "CohereEmbeddingFunction",
        "VoyageAIEmbeddingFunction",
        "GoogleGenerativeAiEmbeddingFunction",
        "GooglePalmEmbeddingFunction",
        "GoogleVertexEmbeddingFunction",
        "HuggingFaceEmbeddingFunction",
        "HuggingFaceEmbeddingServer",
        "InstructorEmbeddingFunction",
        "JinaEmbeddingFunction",
        "MistralEmbeddingFunction",
        "ONNXMiniLM_L6_V2",
        "OllamaEmbeddingFunction",
        "OpenAIEmbeddingFunction",
        "OpenCLIPEmbeddingFunction",
        "RoboflowEmbeddingFunction",
        "SentenceTransformerEmbeddingFunction",
        "Text2VecEmbeddingFunction",
        "ChromaLangchainEmbeddingFunction",
        "TogetherAIEmbeddingFunction",
        "DefaultEmbeddingFunction",
    }

    assert expected_builtins == embedding_functions.get_builtins()


def test_default_ef_exists() -> None:
    assert hasattr(embedding_functions, "DefaultEmbeddingFunction")
    default_ef = embedding_functions.DefaultEmbeddingFunction()

    assert default_ef is not None
    assert isinstance(default_ef, EmbeddingFunction)


def test_ef_imports() -> None:
    for ef in embedding_functions.get_builtins():
        # Langchain embedding function is a special snowflake
        if ef == "ChromaLangchainEmbeddingFunction":
            continue
        assert hasattr(embedding_functions, ef)
        assert isinstance(getattr(embedding_functions, ef), type)
        assert issubclass(getattr(embedding_functions, ef), EmbeddingFunction)


@register_embedding_function
class CustomEmbeddingFunction(EmbeddingFunction[Embeddable]):
    def __init__(self, dim: int = 3):
        self._dim = dim

    @validation_context("custom_ef_call")
    def __call__(self, input: Embeddable) -> Embeddings:
        raise Exception("This is a test exception")

    @staticmethod
    def name() -> str:
        return "custom_ef"

    def get_config(self) -> Dict[str, Any]:
        return {"dim": self._dim}

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "CustomEmbeddingFunction":
        return CustomEmbeddingFunction(dim=config["dim"])

    def default_space(self) -> Space:
        return "cosine"


def test_validation_context_with_custom_ef() -> None:
    custom_ef = CustomEmbeddingFunction()

    with pytest.raises(Exception) as excinfo:
        custom_ef(["test data"])

    original_msg = "This is a test exception"
    expected_msg = f"{original_msg} in custom_ef_call."
    assert str(excinfo.value) == expected_msg
    assert excinfo.value.args == (expected_msg,)
