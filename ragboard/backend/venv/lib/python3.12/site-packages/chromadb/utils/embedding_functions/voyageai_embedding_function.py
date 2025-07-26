from chromadb.api.types import EmbeddingFunction, Space, Embeddings, Documents
from chromadb.utils.embedding_functions.schemas import validate_config_schema
from typing import List, Dict, Any, Optional
import os
import numpy as np
import warnings


class VoyageAIEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    This class is used to generate embeddings for a list of texts using the VoyageAI API.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "voyage-large-2",
        api_key_env_var: str = "CHROMA_VOYAGE_API_KEY",
        input_type: Optional[str] = None,
        truncation: bool = True,
    ):
        """
        Initialize the VoyageAIEmbeddingFunction.

        Args:
            api_key_env_var (str, optional): Environment variable name that contains your API key for the VoyageAI API.
                Defaults to "CHROMA_VOYAGE_API_KEY".
            model_name (str, optional): The name of the model to use for text embeddings.
                Defaults to "voyage-large-2".
            api_key (str, optional): API key for the VoyageAI API. If not provided, will look for it in the environment variable.
            input_type (str, optional): The type of input to use for the VoyageAI API.
                Defaults to None.
            truncation (bool): Whether to truncate the input text.
                Defaults to True.
        """
        try:
            import voyageai
        except ImportError:
            raise ValueError(
                "The voyageai python package is not installed. Please install it with `pip install voyageai`"
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
        self.input_type = input_type
        self.truncation = truncation
        self._client = voyageai.Client(api_key=self.api_key)

    def __call__(self, input: Documents) -> Embeddings:
        """
        Generate embeddings for the given documents.

        Args:
            input: Documents to generate embeddings for.

        Returns:
            Embeddings for the documents.
        """
        embeddings = self._client.embed(
            texts=input,
            model=self.model_name,
            input_type=self.input_type,
            truncation=self.truncation,
        )

        # Convert to numpy arrays
        return [
            np.array(embedding, dtype=np.float32) for embedding in embeddings.embeddings
        ]

    @staticmethod
    def name() -> str:
        return "voyageai"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        api_key_env_var = config.get("api_key_env_var")
        model_name = config.get("model_name")
        input_type = config.get("input_type")
        truncation = config.get("truncation")

        if api_key_env_var is None or model_name is None:
            assert False, "This code should not be reached"

        return VoyageAIEmbeddingFunction(
            api_key_env_var=api_key_env_var,
            model_name=model_name,
            input_type=input_type,
            truncation=truncation if truncation is not None else True,
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "api_key_env_var": self.api_key_env_var,
            "model_name": self.model_name,
            "input_type": self.input_type,
            "truncation": self.truncation,
        }

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
        validate_config_schema(config, "voyageai")
