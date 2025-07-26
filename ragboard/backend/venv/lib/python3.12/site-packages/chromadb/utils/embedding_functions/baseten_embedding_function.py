import os
from chromadb.utils.embedding_functions.openai_embedding_function import (
    OpenAIEmbeddingFunction,
)
from typing import Dict, Any, Optional
import warnings


class BasetenEmbeddingFunction(OpenAIEmbeddingFunction):
    def __init__(
        self,
        api_key: Optional[str],
        api_base: str,
        api_key_env_var: str = "CHROMA_BASETEN_API_KEY",
    ):
        """
        Initialize the BasetenEmbeddingFunction.
        Args:
            api_key (str, optional): The API key for your Baseten account
            api_base (str, required): The Baseten URL of the deployment
            api_key_env_var (str, optional): The environment variable to use for the API key. Defaults to "CHROMA_BASETEN_API_KEY".
        """
        try:
            import openai
        except ImportError:
            raise ValueError(
                "The openai python package is not installed. Please install it with `pip install openai`"
            )

        if api_key is not None:
            warnings.warn(
                "Direct api_key configuration will not be persisted. "
                "Please use environment variables via api_key_env_var for persistent storage.",
                DeprecationWarning,
            )

        self.api_key_env_var = api_key_env_var
        # Prioritize api_key argument, then environment variable
        resolved_api_key = api_key or os.getenv(api_key_env_var)
        if not resolved_api_key:
            raise ValueError(
                f"API key not provided and {api_key_env_var} environment variable is not set."
            )
        self.api_key = resolved_api_key
        if not api_base:
            raise ValueError("The api_base argument must be provided.")
        self.api_base = api_base
        self.model_name = "baseten-embedding-model"
        self.dimensions = None

        self.client = openai.OpenAI(api_key=self.api_key, base_url=self.api_base)

    @staticmethod
    def name() -> str:
        return "baseten"

    def get_config(self) -> Dict[str, Any]:
        return {"api_base": self.api_base, "api_key_env_var": self.api_key_env_var}

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "BasetenEmbeddingFunction":
        """
        Build the BasetenEmbeddingFunction from a configuration dictionary.

        Args:
            config (Dict[str, Any]): A dictionary containing the configuration parameters.
                                     Expected keys: 'api_key', 'api_base', 'api_key_env_var'.

        Returns:
            BasetenEmbeddingFunction: An instance of BasetenEmbeddingFunction.
        """
        api_key_env_var = config.get("api_key_env_var")
        api_base = config.get("api_base")
        if api_key_env_var is None or api_base is None:
            raise ValueError(
                "Missing 'api_key_env_var' or 'api_base' in configuration for BasetenEmbeddingFunction."
            )

        # Note: We rely on the __init__ method to handle potential missing api_key
        # by checking the environment variable if the config value is None.
        # However, api_base must be present either in config or have a default.
        if api_base is None:
            raise ValueError(
                "Missing 'api_base' in configuration for BasetenEmbeddingFunction."
            )

        return BasetenEmbeddingFunction(
            api_key=None,  # Pass None if not in config, __init__ will check env var
            api_base=api_base,
            api_key_env_var=api_key_env_var,
        )
