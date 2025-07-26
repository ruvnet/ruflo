from chromadb.api.types import Embeddings, Documents, EmbeddingFunction, Space
from typing import List, Dict, Any, Optional
import os
import numpy as np
from chromadb.utils.embedding_functions.schemas import validate_config_schema
import warnings


class OpenAIEmbeddingFunction(EmbeddingFunction[Documents]):
    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "text-embedding-ada-002",
        organization_id: Optional[str] = None,
        api_base: Optional[str] = None,
        api_type: Optional[str] = None,
        api_version: Optional[str] = None,
        deployment_id: Optional[str] = None,
        default_headers: Optional[Dict[str, str]] = None,
        dimensions: Optional[int] = None,
        api_key_env_var: str = "CHROMA_OPENAI_API_KEY",
    ):
        """
        Initialize the OpenAIEmbeddingFunction.
        Args:
            api_key_env_var (str, optional): Environment variable name that contains your API key for the OpenAI API.
                Defaults to "CHROMA_OPENAI_API_KEY".
            model_name (str, optional): The name of the model to use for text
                embeddings. Defaults to "text-embedding-ada-002".
            organization_id(str, optional): The OpenAI organization ID if applicable
            api_base (str, optional): The base path for the API. If not provided,
                it will use the base path for the OpenAI API. This can be used to
                point to a different deployment, such as an Azure deployment.
            api_type (str, optional): The type of the API deployment. This can be
                used to specify a different deployment, such as 'azure'. If not
                provided, it will use the default OpenAI deployment.
            api_version (str, optional): The api version for the API. If not provided,
                it will use the api version for the OpenAI API. This can be used to
                point to a different deployment, such as an Azure deployment.
            deployment_id (str, optional): Deployment ID for Azure OpenAI.
            default_headers (Dict[str, str], optional): A mapping of default headers to be sent with each API request.
            dimensions (int, optional): The number of dimensions for the embeddings.
                Only supported for `text-embedding-3` or later models from OpenAI.
                https://platform.openai.com/docs/api-reference/embeddings/create#embeddings-create-dimensions
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
        self.api_key = api_key or os.getenv(api_key_env_var)
        if not self.api_key:
            raise ValueError(f"The {api_key_env_var} environment variable is not set.")

        self.model_name = model_name
        self.organization_id = organization_id
        self.api_base = api_base
        self.api_type = api_type
        self.api_version = api_version
        self.deployment_id = deployment_id
        self.default_headers = default_headers
        self.dimensions = dimensions

        # Initialize the OpenAI client
        client_params: Dict[str, Any] = {"api_key": self.api_key}

        if self.organization_id is not None:
            client_params["organization"] = self.organization_id
        if self.api_base is not None:
            client_params["base_url"] = self.api_base
        if self.default_headers is not None:
            client_params["default_headers"] = self.default_headers

        self.client = openai.OpenAI(**client_params)

        # For Azure OpenAI
        if self.api_type == "azure":
            if self.api_version is None:
                raise ValueError("api_version must be specified for Azure OpenAI")
            if self.deployment_id is None:
                raise ValueError("deployment_id must be specified for Azure OpenAI")
            if self.api_base is None:
                raise ValueError("api_base must be specified for Azure OpenAI")

            from openai import AzureOpenAI

            self.client = AzureOpenAI(
                api_key=self.api_key,
                api_version=self.api_version,
                azure_endpoint=self.api_base,
                azure_deployment=self.deployment_id,
                default_headers=self.default_headers,
            )

    def __call__(self, input: Documents) -> Embeddings:
        """
        Generate embeddings for the given documents.
        Args:
            input: Documents to generate embeddings for.
        Returns:
            Embeddings for the documents.
        """
        # Handle batching
        if not input:
            return []

        # Prepare embedding parameters
        embedding_params: Dict[str, Any] = {
            "model": self.model_name,
            "input": input,
        }

        if self.dimensions is not None and "text-embedding-3" in self.model_name:
            embedding_params["dimensions"] = self.dimensions

        # Get embeddings
        response = self.client.embeddings.create(**embedding_params)

        # Extract embeddings from response
        return [np.array(data.embedding, dtype=np.float32) for data in response.data]

    @staticmethod
    def name() -> str:
        return "openai"

    def default_space(self) -> Space:
        # OpenAI embeddings work best with cosine similarity
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        # Extract parameters from config
        api_key_env_var = config.get("api_key_env_var")
        model_name = config.get("model_name")
        organization_id = config.get("organization_id")
        api_base = config.get("api_base")
        api_type = config.get("api_type")
        api_version = config.get("api_version")
        deployment_id = config.get("deployment_id")
        default_headers = config.get("default_headers")
        dimensions = config.get("dimensions")

        if api_key_env_var is None or model_name is None:
            assert False, "This code should not be reached"

        # Create and return the embedding function
        return OpenAIEmbeddingFunction(
            api_key_env_var=api_key_env_var,
            model_name=model_name,
            organization_id=organization_id,
            api_base=api_base,
            api_type=api_type,
            api_version=api_version,
            deployment_id=deployment_id,
            default_headers=default_headers,
            dimensions=dimensions,
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "api_key_env_var": self.api_key_env_var,
            "model_name": self.model_name,
            "organization_id": self.organization_id,
            "api_base": self.api_base,
            "api_type": self.api_type,
            "api_version": self.api_version,
            "deployment_id": self.deployment_id,
            "default_headers": self.default_headers,
            "dimensions": self.dimensions,
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
        validate_config_schema(config, "openai")
