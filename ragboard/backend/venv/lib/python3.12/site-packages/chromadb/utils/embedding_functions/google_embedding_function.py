from chromadb.api.types import Embeddings, Documents, EmbeddingFunction, Space
from typing import List, Dict, Any, cast, Optional
import os
import numpy as np
import numpy.typing as npt
from chromadb.utils.embedding_functions.schemas import validate_config_schema
import warnings


class GooglePalmEmbeddingFunction(EmbeddingFunction[Documents]):
    """To use this EmbeddingFunction, you must have the google.generativeai Python package installed and have a PaLM API key."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "models/embedding-gecko-001",
        api_key_env_var: str = "CHROMA_GOOGLE_PALM_API_KEY",
    ):
        """
        Initialize the GooglePalmEmbeddingFunction.

        Args:
            api_key_env_var (str, optional): Environment variable name that contains your API key for the Google PaLM API.
                Defaults to "CHROMA_GOOGLE_PALM_API_KEY".
            model_name (str, optional): The name of the model to use for text embeddings.
                Defaults to "models/embedding-gecko-001".
        """
        try:
            import google.generativeai as palm
        except ImportError:
            raise ValueError(
                "The Google Generative AI python package is not installed. Please install it with `pip install google-generativeai`"
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

        palm.configure(api_key=self.api_key)
        self._palm = palm

    def __call__(self, input: Documents) -> Embeddings:
        """
        Generate embeddings for the given documents.

        Args:
            input: Documents or images to generate embeddings for.

        Returns:
            Embeddings for the documents.
        """
        # Google PaLM only works with text documents
        if not all(isinstance(item, str) for item in input):
            raise ValueError("Google PaLM only supports text documents, not images")

        return [
            np.array(
                self._palm.generate_embeddings(model=self.model_name, text=text)[
                    "embedding"
                ],
                dtype=np.float32,
            )
            for text in input
        ]

    @staticmethod
    def name() -> str:
        return "google_palm"

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

        return GooglePalmEmbeddingFunction(
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
        validate_config_schema(config, "google_palm")


class GoogleGenerativeAiEmbeddingFunction(EmbeddingFunction[Documents]):
    """To use this EmbeddingFunction, you must have the google.generativeai Python package installed and have a Google API key."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "models/embedding-001",
        task_type: str = "RETRIEVAL_DOCUMENT",
        api_key_env_var: str = "CHROMA_GOOGLE_GENAI_API_KEY",
    ):
        """
        Initialize the GoogleGenerativeAiEmbeddingFunction.

        Args:
            api_key_env_var (str, optional): Environment variable name that contains your API key for the Google Generative AI API.
                Defaults to "CHROMA_GOOGLE_GENAI_API_KEY".
            model_name (str, optional): The name of the model to use for text embeddings.
                Defaults to "models/embedding-001".
            task_type (str, optional): The task type for the embeddings.
                Use "RETRIEVAL_DOCUMENT" for embedding documents and "RETRIEVAL_QUERY" for embedding queries.
                Defaults to "RETRIEVAL_DOCUMENT".
        """
        try:
            import google.generativeai as genai
        except ImportError:
            raise ValueError(
                "The Google Generative AI python package is not installed. Please install it with `pip install google-generativeai`"
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
        self.task_type = task_type

        genai.configure(api_key=self.api_key)
        self._genai = genai

    def __call__(self, input: Documents) -> Embeddings:
        """
        Generate embeddings for the given documents.

        Args:
            input: Documents or images to generate embeddings for.

        Returns:
            Embeddings for the documents.
        """
        # Google Generative AI only works with text documents
        if not all(isinstance(item, str) for item in input):
            raise ValueError(
                "Google Generative AI only supports text documents, not images"
            )

        embeddings_list: List[npt.NDArray[np.float32]] = []
        for text in input:
            embedding_result = self._genai.embed_content(
                model=self.model_name,
                content=text,
                task_type=self.task_type,
            )
            embeddings_list.append(
                np.array(embedding_result["embedding"], dtype=np.float32)
            )

        # Convert to the expected Embeddings type (List[Vector])
        return cast(Embeddings, embeddings_list)

    @staticmethod
    def name() -> str:
        return "google_generative_ai"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        api_key_env_var = config.get("api_key_env_var")
        model_name = config.get("model_name")
        task_type = config.get("task_type")

        if api_key_env_var is None or model_name is None or task_type is None:
            assert False, "This code should not be reached"

        return GoogleGenerativeAiEmbeddingFunction(
            api_key_env_var=api_key_env_var, model_name=model_name, task_type=task_type
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "api_key_env_var": self.api_key_env_var,
            "model_name": self.model_name,
            "task_type": self.task_type,
        }

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        if "model_name" in new_config:
            raise ValueError(
                "The model name cannot be changed after the embedding function has been initialized."
            )
        if "task_type" in new_config:
            raise ValueError(
                "The task type cannot be changed after the embedding function has been initialized."
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
        validate_config_schema(config, "google_generative_ai")


class GoogleVertexEmbeddingFunction(EmbeddingFunction[Documents]):
    """To use this EmbeddingFunction, you must have the vertexai Python package installed and have Google Cloud credentials configured."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "textembedding-gecko",
        project_id: str = "cloud-large-language-models",
        region: str = "us-central1",
        api_key_env_var: str = "CHROMA_GOOGLE_VERTEX_API_KEY",
    ):
        """
        Initialize the GoogleVertexEmbeddingFunction.

        Args:
            api_key_env_var (str, optional): Environment variable name that contains your API key for the Google Vertex AI API.
                Defaults to "CHROMA_GOOGLE_VERTEX_API_KEY".
            model_name (str, optional): The name of the model to use for text embeddings.
                Defaults to "textembedding-gecko".
            project_id (str, optional): The Google Cloud project ID.
                Defaults to "cloud-large-language-models".
            region (str, optional): The Google Cloud region.
                Defaults to "us-central1".
        """
        try:
            import vertexai
            from vertexai.language_models import TextEmbeddingModel
        except ImportError:
            raise ValueError(
                "The vertexai python package is not installed. Please install it with `pip install google-cloud-aiplatform`"
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
        self.project_id = project_id
        self.region = region

        vertexai.init(project=project_id, location=region)
        self._model = TextEmbeddingModel.from_pretrained(model_name)

    def __call__(self, input: Documents) -> Embeddings:
        """
        Generate embeddings for the given documents.

        Args:
            input: Documents or images to generate embeddings for.

        Returns:
            Embeddings for the documents.
        """
        # Google Vertex only works with text documents
        if not all(isinstance(item, str) for item in input):
            raise ValueError("Google Vertex only supports text documents, not images")

        embeddings_list: List[npt.NDArray[np.float32]] = []
        for text in input:
            embedding_result = self._model.get_embeddings([text])
            embeddings_list.append(
                np.array(embedding_result[0].values, dtype=np.float32)
            )

        # Convert to the expected Embeddings type (List[Vector])
        return cast(Embeddings, embeddings_list)

    @staticmethod
    def name() -> str:
        return "google_vertex"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        api_key_env_var = config.get("api_key_env_var")
        model_name = config.get("model_name")
        project_id = config.get("project_id")
        region = config.get("region")

        if (
            api_key_env_var is None
            or model_name is None
            or project_id is None
            or region is None
        ):
            assert False, "This code should not be reached"

        return GoogleVertexEmbeddingFunction(
            api_key_env_var=api_key_env_var,
            model_name=model_name,
            project_id=project_id,
            region=region,
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "api_key_env_var": self.api_key_env_var,
            "model_name": self.model_name,
            "project_id": self.project_id,
            "region": self.region,
        }

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        if "model_name" in new_config:
            raise ValueError(
                "The model name cannot be changed after the embedding function has been initialized."
            )
        if "project_id" in new_config:
            raise ValueError(
                "The project ID cannot be changed after the embedding function has been initialized."
            )
        if "region" in new_config:
            raise ValueError(
                "The region cannot be changed after the embedding function has been initialized."
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
        validate_config_schema(config, "google_vertex")
