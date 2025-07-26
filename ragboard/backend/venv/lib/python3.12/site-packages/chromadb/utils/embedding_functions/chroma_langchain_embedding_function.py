from chromadb.api.types import (
    Documents,
    Embeddings,
    Images,
    Embeddable,
    EmbeddingFunction,
)
from chromadb.utils.embedding_functions.schemas import validate_config_schema
from typing import List, Dict, Any, Union, cast, Sequence
import numpy as np


def create_langchain_embedding(
    langchain_embedding_fn: Any,
) -> "ChromaLangchainEmbeddingFunction":
    """
    Create a ChromaLangchainEmbeddingFunction from a langchain embedding function.

    Args:
        langchain_embedding_fn: The langchain embedding function to use.

    Returns:
        A ChromaLangchainEmbeddingFunction that wraps the langchain embedding function.
    """

    return ChromaLangchainEmbeddingFunction(embedding_function=langchain_embedding_fn)


class ChromaLangchainEmbeddingFunction(EmbeddingFunction[Embeddable]):
    """
    This class is used as bridge between langchain embedding functions and custom chroma embedding functions.
    """

    def __init__(self, embedding_function: Any) -> None:
        """
        Initialize the ChromaLangchainEmbeddingFunction

        Args:
            embedding_function: The embedding function implementing Embeddings from langchain_core.
        """
        try:
            import langchain_core.embeddings

            LangchainEmbeddings = langchain_core.embeddings.Embeddings
        except ImportError:
            raise ValueError(
                "The langchain_core python package is not installed. Please install it with `pip install langchain-core`"
            )

        if not isinstance(embedding_function, LangchainEmbeddings):
            raise ValueError(
                "The embedding_function must implement the Embeddings interface from langchain_core."
            )

        self.embedding_function = embedding_function

        # Store the class name for serialization
        self._embedding_function_class = embedding_function.__class__.__name__

    def embed_documents(self, documents: Sequence[str]) -> List[List[float]]:
        """
        Embed documents using the langchain embedding function.

        Args:
            documents: The documents to embed.

        Returns:
            The embeddings for the documents.
        """
        return cast(
            List[List[float]], self.embedding_function.embed_documents(list(documents))
        )

    def embed_query(self, query: str) -> List[float]:
        """
        Embed a query using the langchain embedding function.

        Args:
            query: The query to embed.

        Returns:
            The embedding for the query.
        """
        return cast(List[float], self.embedding_function.embed_query(query))

    def embed_image(self, uris: List[str]) -> List[List[float]]:
        """
        Embed images using the langchain embedding function.

        Args:
            uris: The URIs of the images to embed.

        Returns:
            The embeddings for the images.
        """
        if hasattr(self.embedding_function, "embed_image"):
            return cast(List[List[float]], self.embedding_function.embed_image(uris))
        else:
            raise ValueError(
                "The provided embedding function does not support image embeddings."
            )

    def __call__(self, input: Union[Documents, Images]) -> Embeddings:
        """
        Get the embeddings for a list of texts or images.

        Args:
            input: A list of texts or images to get embeddings for.
                Images should be provided as a list of URIs passed through the langchain data loader

        Returns:
            The embeddings for the texts or images.

        Example:
            >>> from langchain_openai import OpenAIEmbeddings
            >>> langchain_embedding = ChromaLangchainEmbeddingFunction(embedding_function=OpenAIEmbeddings(model="text-embedding-3-large"))
            >>> texts = ["Hello, world!", "How are you?"]
            >>> embeddings = langchain_embedding(texts)
        """
        # Due to langchain quirks, the dataloader returns a tuple if the input is uris of images
        if isinstance(input, tuple) and len(input) == 2 and input[0] == "images":
            embeddings = self.embed_image(list(input[1]))
        else:
            # Cast to Sequence[str] to satisfy the type checker
            embeddings = self.embed_documents(cast(Sequence[str], input))

        # Convert to numpy arrays
        return [np.array(embedding, dtype=np.float32) for embedding in embeddings]

    @staticmethod
    def name() -> str:
        return "langchain"

    @staticmethod
    def build_from_config(
        config: Dict[str, Any]
    ) -> "EmbeddingFunction[Union[Documents, Images]]":
        # This is a placeholder implementation since we can't easily serialize and deserialize
        # langchain embedding functions. Users will need to recreate the langchain embedding function
        # and pass it to create_langchain_embedding.
        raise NotImplementedError(
            "Building a ChromaLangchainEmbeddingFunction from config is not supported. "
            "Please recreate the langchain embedding function and pass it to create_langchain_embedding."
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "embedding_function_class": self._embedding_function_class,
            "note": "This is a placeholder config. You will need to recreate the langchain embedding function.",
        }

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        raise NotImplementedError(
            "Updating a ChromaLangchainEmbeddingFunction config is not supported. "
            "Please recreate the langchain embedding function and pass it to create_langchain_embedding."
        )

    @staticmethod
    def validate_config(config: Dict[str, Any]) -> None:
        """
        Validate the configuration using the JSON schema.

        Args:
            config: Configuration to validate

        Raises:
            ValidationError: If the configuration does not match the schema
        """
        validate_config_schema(config, "chroma_langchain")
