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

BASE_URL = "https://api.cloudflare.com/client/v4/accounts"
GATEWAY_BASE_URL = "https://gateway.ai.cloudflare.com/v1"


class CloudflareWorkersAIEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    This class is used to get embeddings for a list of texts using the Cloudflare Workers AI API.
    It requires an API key and a model name.
    """

    def __init__(
        self,
        model_name: str,
        account_id: str,
        api_key: Optional[str] = None,
        api_key_env_var: str = "CHROMA_CLOUDFLARE_API_KEY",
        gateway_id: Optional[str] = None,
    ):
        """
        Initialize the CloudflareWorkersAIEmbeddingFunction. See the docs for supported models here:
        https://developers.cloudflare.com/workers-ai/models/

        Args:
            model_name: The name of the model to use for text embeddings.
            account_id: The account ID for the Cloudflare Workers AI API.
            api_key: The API key for the Cloudflare Workers AI API.
            api_key_env_var: The environment variable name for the Cloudflare Workers AI API key.
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
        self.account_id = account_id
        self.api_key_env_var = api_key_env_var
        self.api_key = api_key or os.getenv(api_key_env_var)
        self.gateway_id = gateway_id

        if not self.api_key:
            raise ValueError(f"The {api_key_env_var} environment variable is not set.")

        if self.gateway_id:
            self._api_url = f"{GATEWAY_BASE_URL}/{self.account_id}/{self.gateway_id}/workers-ai/{self.model_name}"
        else:
            self._api_url = f"{BASE_URL}/{self.account_id}/ai/run/{self.model_name}"

        self._session = httpx.Client()
        self._session.headers.update(
            {"Authorization": f"Bearer {self.api_key}", "Accept-Encoding": "identity"}
        )

    def __call__(self, input: Documents) -> Embeddings:
        """
        Generate embeddings for the given documents.

        Args:
            input: Documents to generate embeddings for.

        Returns:
            Embeddings for the documents.
        """
        if not all(isinstance(item, str) for item in input):
            raise ValueError(
                "Cloudflare Workers AI only supports text documents, not images"
            )

        payload: Dict[str, Any] = {
            "text": input,
        }

        resp = self._session.post(self._api_url, json=payload).json()

        if "result" not in resp and "data" not in resp["result"]:
            raise RuntimeError(resp.get("detail", "Unknown error"))

        return cast(Embeddings, resp["result"]["data"])

    @staticmethod
    def name() -> str:
        return "cloudflare_workers_ai"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        api_key_env_var = config.get("api_key_env_var")
        model_name = config.get("model_name")
        account_id = config.get("account_id")
        gateway_id = config.get("gateway_id", None)
        if api_key_env_var is None or model_name is None or account_id is None:
            assert False, "This code should not be reached"

        return CloudflareWorkersAIEmbeddingFunction(
            api_key_env_var=api_key_env_var,
            model_name=model_name,
            account_id=account_id,
            gateway_id=gateway_id,
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "api_key_env_var": self.api_key_env_var,
            "model_name": self.model_name,
            "account_id": self.account_id,
            "gateway_id": self.gateway_id,
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
        validate_config_schema(config, "cloudflare_workers_ai")
