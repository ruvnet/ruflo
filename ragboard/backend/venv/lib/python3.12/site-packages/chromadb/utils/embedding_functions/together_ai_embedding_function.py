from chromadb.api.types import (
    Embeddings,
    Documents,
    EmbeddingFunction,
    Space,
)
from typing import List, Dict, Any, Optional
import os
from chromadb.utils.embedding_functions.schemas import validate_config_schema
from typing import cast
import warnings

ENDPOINT = "https://api.together.xyz/v1/embeddings"


class TogetherAIEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    This class is used to get embeddings for a list of texts using the Together AI API.
    """

    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        api_key_env_var: str = "CHROMA_TOGETHER_AI_API_KEY",
    ):
        """
        Initialize the TogetherAIEmbeddingFunction. See the docs for supported models here:
        https://docs.together.ai/docs/serverless-models#embedding-models

        Args:
            model_name: The name of the model to use for text embeddings.
            api_key: The API key to use for the Together AI API.
            api_key_env_var: The environment variable to use for the Together AI API key.
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

        self.model_name = model_name
        self.api_key = api_key
        self.api_key_env_var = api_key_env_var

        if not self.api_key:
            self.api_key = os.getenv(self.api_key_env_var)

        if not self.api_key:
            raise ValueError(
                f"API key not found in environment variable {self.api_key_env_var}"
            )

        self._session = httpx.Client()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "accept": "application/json",
            }
        )

    def __call__(self, input: Documents) -> Embeddings:
        """
        Embed a list of texts using the Together AI API.

        Args:
            input: A list of texts to embed.
        """

        if not input:
            raise ValueError("Input is required")

        if not isinstance(input, list):
            raise ValueError("Input must be a list")

        if not all(isinstance(item, str) for item in input):
            raise ValueError("All items in input must be strings")

        response = self._session.post(
            ENDPOINT,
            json={"model": self.model_name, "input": input},
        )

        response.raise_for_status()

        data = response.json()

        embeddings = [item["embedding"] for item in data["data"]]

        return cast(Embeddings, embeddings)

    @staticmethod
    def name() -> str:
        return "together_ai"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        api_key_env_var = config.get("api_key_env_var")
        model_name = config.get("model_name")

        if api_key_env_var is None or model_name is None:
            raise ValueError("api_key_env_var and model_name must be provided")

        return TogetherAIEmbeddingFunction(
            model_name=model_name, api_key_env_var=api_key_env_var
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "api_key_env_var": self.api_key_env_var,
            "model_name": self.model_name,
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
        """
        validate_config_schema(config, "together_ai")
