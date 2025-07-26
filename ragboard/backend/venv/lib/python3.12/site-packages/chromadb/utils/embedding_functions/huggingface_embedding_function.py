from chromadb.api.types import Embeddings, Documents, EmbeddingFunction, Space
from typing import List, Dict, Any, Optional
import os
import numpy as np
from chromadb.utils.embedding_functions.schemas import validate_config_schema
import warnings


class HuggingFaceEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    This class is used to get embeddings for a list of texts using the HuggingFace API.
    It requires an API key and a model name. The default model name is "sentence-transformers/all-MiniLM-L6-v2".
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
        api_key_env_var: str = "CHROMA_HUGGINGFACE_API_KEY",
    ):
        """
        Initialize the HuggingFaceEmbeddingFunction.

        Args:
            api_key_env_var (str, optional): Environment variable name that contains your API key for the HuggingFace API.
                Defaults to "CHROMA_HUGGINGFACE_API_KEY".
            model_name (str, optional): The name of the model to use for text embeddings.
                Defaults to "sentence-transformers/all-MiniLM-L6-v2".
        """
        try:
            import httpx
        except ImportError:
            raise ValueError(
                "The httpx python package is not installed. Please install it with `pip install httpx`"
            )

        if api_key is not None:
            warnings.warn(
                "Direct api_key configuration will not be persisted. "
                "Please use environment variables via api_key_env_var for persistent storage.",
                DeprecationWarning,
            )
        self.api_key_env_var = api_key_env_var
        self.api_key = api_key or os.getenv(api_key_env_var)
        if not self.api_key:
            raise ValueError(f"The {api_key_env_var} environment variable is not set.")

        self.model_name = model_name

        self._api_url = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{model_name}"
        self._session = httpx.Client()
        self._session.headers.update({"Authorization": f"Bearer {self.api_key}"})

    def __call__(self, input: Documents) -> Embeddings:
        """
        Get the embeddings for a list of texts.

        Args:
            input (Documents): A list of texts to get embeddings for.

        Returns:
            Embeddings: The embeddings for the texts.

        Example:
            >>> hugging_face = HuggingFaceEmbeddingFunction(api_key_env_var="CHROMA_HUGGINGFACE_API_KEY")
            >>> texts = ["Hello, world!", "How are you?"]
            >>> embeddings = hugging_face(texts)
        """
        # Call HuggingFace Embedding API for each document
        response = self._session.post(
            self._api_url,
            json={"inputs": input, "options": {"wait_for_model": True}},
        ).json()

        # Convert to numpy arrays
        return [np.array(embedding, dtype=np.float32) for embedding in response]

    @staticmethod
    def name() -> str:
        return "huggingface"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        api_key_env_var = config.get("api_key_env_var")
        model_name = config.get("model_name")

        if api_key_env_var is None or model_name is None:
            assert False, "This code should not be reached"

        return HuggingFaceEmbeddingFunction(
            api_key_env_var=api_key_env_var, model_name=model_name
        )

    def get_config(self) -> Dict[str, Any]:
        return {"api_key_env_var": self.api_key_env_var, "model_name": self.model_name}

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
        validate_config_schema(config, "huggingface")


class HuggingFaceEmbeddingServer(EmbeddingFunction[Documents]):
    """
    This class is used to get embeddings for a list of texts using the HuggingFace Embedding server
    (https://github.com/huggingface/text-embeddings-inference).
    The embedding model is configured in the server.
    """

    def __init__(
        self,
        url: str,
        api_key_env_var: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        """
        Initialize the HuggingFaceEmbeddingServer.

        Args:
            url (str): The URL of the HuggingFace Embedding Server.
            api_key (Optional[str]): The API key for the HuggingFace Embedding Server.
            api_key_env_var (str, optional): Environment variable name that contains your API key for the HuggingFace API.
        """
        try:
            import httpx
        except ImportError:
            raise ValueError(
                "The httpx python package is not installed. Please install it with `pip install httpx`"
            )

        if api_key is not None:
            warnings.warn(
                "Direct api_key configuration will not be persisted. "
                "Please use environment variables via api_key_env_var for persistent storage.",
                DeprecationWarning,
            )

        self.url = url

        self.api_key_env_var = api_key_env_var
        if self.api_key_env_var is not None:
            self.api_key = api_key or os.getenv(self.api_key_env_var)
        else:
            self.api_key = api_key

        self._api_url = f"{url}"
        self._session = httpx.Client()

        if self.api_key is not None:
            self._session.headers.update({"Authorization": f"Bearer {self.api_key}"})

    def __call__(self, input: Documents) -> Embeddings:
        """
        Get the embeddings for a list of texts.

        Args:
            input (Documents): A list of texts to get embeddings for.

        Returns:
            Embeddings: The embeddings for the texts.

        Example:
            >>> hugging_face = HuggingFaceEmbeddingServer(url="http://localhost:8080/embed")
            >>> texts = ["Hello, world!", "How are you?"]
            >>> embeddings = hugging_face(texts)
        """
        # Call HuggingFace Embedding Server API for each document
        response = self._session.post(self._api_url, json={"inputs": input}).json()

        # Convert to numpy arrays
        return [np.array(embedding, dtype=np.float32) for embedding in response]

    @staticmethod
    def name() -> str:
        return "huggingface_server"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        url = config.get("url")
        api_key_env_var = config.get("api_key_env_var")
        if url is None:
            raise ValueError("URL must be provided for HuggingFaceEmbeddingServer")

        return HuggingFaceEmbeddingServer(url=url, api_key_env_var=api_key_env_var)

    def get_config(self) -> Dict[str, Any]:
        return {"url": self.url, "api_key_env_var": self.api_key_env_var}

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        if "url" in new_config and new_config["url"] != self.url:
            raise ValueError(
                "The URL cannot be changed after the embedding function has been initialized."
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
        validate_config_schema(config, "huggingface_server")
