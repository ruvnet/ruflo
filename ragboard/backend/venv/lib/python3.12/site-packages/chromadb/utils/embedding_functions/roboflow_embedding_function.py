from chromadb.utils.embedding_functions.schemas import validate_config_schema
from chromadb.api.types import (
    Documents,
    Embeddings,
    Images,
    is_document,
    is_image,
    Embeddable,
    EmbeddingFunction,
    Space,
)
from typing import List, Dict, Any, Union, cast, Optional
import os
import importlib
import base64
from io import BytesIO
import numpy as np
import warnings


class RoboflowEmbeddingFunction(EmbeddingFunction[Embeddable]):
    """
    This class is used to generate embeddings for a list of texts or images using the Roboflow API.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_url: str = "https://infer.roboflow.com",
        api_key_env_var: str = "CHROMA_ROBOFLOW_API_KEY",
    ) -> None:
        """
        Create a RoboflowEmbeddingFunction.

        Args:
            api_key_env_var (str, optional): Environment variable name that contains your API key for the Roboflow API.
                Defaults to "CHROMA_ROBOFLOW_API_KEY".
            api_url (str, optional): The URL of the Roboflow API.
                Defaults to "https://infer.roboflow.com".
        """

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

        self.api_url = api_url

        try:
            self._PILImage = importlib.import_module("PIL.Image")
        except ImportError:
            raise ValueError(
                "The PIL python package is not installed. Please install it with `pip install pillow`"
            )

        self._httpx = importlib.import_module("httpx")

    def __call__(self, input: Embeddable) -> Embeddings:
        """
        Generate embeddings for the given documents or images.

        Args:
            input: Documents or images to generate embeddings for.

        Returns:
            Embeddings for the documents or images.
        """
        embeddings = []

        for item in input:
            if is_image(item):
                image = self._PILImage.fromarray(item)

                buffer = BytesIO()
                image.save(buffer, format="JPEG")
                base64_image = base64.b64encode(buffer.getvalue()).decode("utf-8")

                infer_clip_payload_image = {
                    "image": {
                        "type": "base64",
                        "value": base64_image,
                    },
                }

                res = self._httpx.post(
                    f"{self.api_url}/clip/embed_image?api_key={self.api_key}",
                    json=infer_clip_payload_image,
                )

                result = res.json()["embeddings"]
                embeddings.append(np.array(result[0], dtype=np.float32))

            elif is_document(item):
                infer_clip_payload_text = {
                    "text": item,
                }

                res = self._httpx.post(
                    f"{self.api_url}/clip/embed_text?api_key={self.api_key}",
                    json=infer_clip_payload_text,
                )

                result = res.json()["embeddings"]
                embeddings.append(np.array(result[0], dtype=np.float32))

        # Cast to the expected Embeddings type
        return cast(Embeddings, embeddings)

    @staticmethod
    def name() -> str:
        return "roboflow"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(
        config: Dict[str, Any]
    ) -> "EmbeddingFunction[Union[Documents, Images]]":
        api_key_env_var = config.get("api_key_env_var")
        api_url = config.get("api_url")

        if api_key_env_var is None or api_url is None:
            assert False, "This code should not be reached"

        return RoboflowEmbeddingFunction(
            api_key_env_var=api_key_env_var, api_url=api_url
        )

    def get_config(self) -> Dict[str, Any]:
        return {"api_key_env_var": self.api_key_env_var, "api_url": self.api_url}

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        # API URL can be changed, so no validation needed
        pass

    @staticmethod
    def validate_config(config: Dict[str, Any]) -> None:
        """
        Validate the configuration using the JSON schema.

        Args:
            config: Configuration to validate

        Raises:
            ValidationError: If the configuration does not match the schema
        """
        validate_config_schema(config, "roboflow")
