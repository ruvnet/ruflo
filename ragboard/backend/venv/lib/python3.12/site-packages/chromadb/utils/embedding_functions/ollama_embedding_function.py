from chromadb.api.types import Embeddings, Documents, EmbeddingFunction, Space
from chromadb.utils.embedding_functions.schemas import validate_config_schema
from typing import List, Dict, Any
import numpy as np
from urllib.parse import urlparse

DEFAULT_MODEL_NAME = "chroma/all-minilm-l6-v2-f32"


class OllamaEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    This class is used to generate embeddings for a list of texts using the Ollama Embedding API
    (https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings).
    """

    def __init__(
        self,
        url: str = "http://localhost:11434",
        model_name: str = DEFAULT_MODEL_NAME,
        timeout: int = 60,
    ) -> None:
        """
        Initialize the Ollama Embedding Function.

        Args:
            url (str): The Base URL of the Ollama Server (default: "http://localhost:11434").
            model_name (str): The name of the model to use for text embeddings.
                Defaults to "chroma/all-minilm-l6-v2-f32", for available models see https://ollama.com/library.
            timeout (int): The timeout for the API call in seconds. Defaults to 60.
        """
        try:
            from ollama import Client
        except ImportError:
            raise ValueError(
                "The ollama python package is not installed. Please install it with `pip install ollama`"
            )

        self.url = url
        self.model_name = model_name
        self.timeout = timeout

        # Adding this for backwards compatibility with the old version of the EF
        self._base_url = url
        if self._base_url.endswith("/api/embeddings"):
            parsed_url = urlparse(url)
            self._base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"

        self._client = Client(host=self._base_url, timeout=timeout)

    def __call__(self, input: Documents) -> Embeddings:
        """
        Get the embeddings for a list of texts.

        Args:
            input (Documents): A list of texts to get embeddings for.

        Returns:
            Embeddings: The embeddings for the texts.

        Example:
            >>> ollama_ef = OllamaEmbeddingFunction()
            >>> texts = ["Hello, world!", "How are you?"]
            >>> embeddings = ollama_ef(texts)
        """
        # Call Ollama client
        response = self._client.embed(model=self.model_name, input=input)

        # Convert to numpy arrays
        return [
            np.array(embedding, dtype=np.float32)
            for embedding in response["embeddings"]
        ]

    @staticmethod
    def name() -> str:
        return "ollama"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        url = config.get("url")
        model_name = config.get("model_name")
        timeout = config.get("timeout")

        if url is None or model_name is None or timeout is None:
            assert False, "This code should not be reached"

        return OllamaEmbeddingFunction(url=url, model_name=model_name, timeout=timeout)

    def get_config(self) -> Dict[str, Any]:
        return {"url": self.url, "model_name": self.model_name, "timeout": self.timeout}

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        if "model_name" in new_config:
            raise ValueError(
                "The model name cannot be changed after the embedding function has been initialized."
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
        validate_config_schema(config, "ollama")
