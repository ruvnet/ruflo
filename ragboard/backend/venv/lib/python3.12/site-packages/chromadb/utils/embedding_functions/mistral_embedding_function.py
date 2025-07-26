from chromadb.api.types import Embeddings, Documents, EmbeddingFunction, Space
from chromadb.utils.embedding_functions.schemas import validate_config_schema
from typing import List, Dict, Any
import os
import numpy as np


class MistralEmbeddingFunction(EmbeddingFunction[Documents]):
    def __init__(
        self,
        model: str,
        api_key_env_var: str = "MISTRAL_API_KEY",
    ):
        """
        Initialize the MistralEmbeddingFunction.

        Args:
            model (str): The name of the model to use for text embeddings.
            api_key_env_var (str): The environment variable name for the Mistral API key.
        """
        try:
            from mistralai import Mistral
        except ImportError:
            raise ValueError(
                "The mistralai python package is not installed. Please install it with `pip install mistralai`"
            )
        self.model = model
        self.api_key_env_var = api_key_env_var
        self.api_key = os.getenv(api_key_env_var)
        if not self.api_key:
            raise ValueError(f"The {api_key_env_var} environment variable is not set.")
        self.client = Mistral(api_key=self.api_key)

    def __call__(self, input: Documents) -> Embeddings:
        """
        Get the embeddings for a list of texts.

        Args:
            input (Documents): A list of texts to get embeddings for.
        """
        if not all(isinstance(item, str) for item in input):
            raise ValueError("Mistral only supports text documents, not images")
        output = self.client.embeddings.create(
            model=self.model,
            inputs=input,
        )

        # Extract embeddings from the response
        return [np.array(data.embedding) for data in output.data]

    @staticmethod
    def name() -> str:
        return "mistral"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        model = config.get("model")
        api_key_env_var = config.get("api_key_env_var")

        if model is None or api_key_env_var is None:
            assert False, "This code should not be reached"  # this is for type checking
        return MistralEmbeddingFunction(model=model, api_key_env_var=api_key_env_var)

    def get_config(self) -> Dict[str, Any]:
        return {
            "model": self.model,
            "api_key_env_var": self.api_key_env_var,
        }

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        if "model" in new_config:
            raise ValueError(
                "The model cannot be changed after the embedding function has been initialized."
            )

    @staticmethod
    def validate_config(config: Dict[str, Any]) -> None:
        """
        Validate the configuration using the JSON schema.

        Args:
            config: Configuration to validate
        """
        validate_config_schema(config, "mistral")
