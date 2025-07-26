from chromadb.api.types import (
    Embeddings,
    Embeddable,
    EmbeddingFunction,
    Space,
    is_image,
    is_document,
)
from typing import List, Dict, Any, Optional
import os
import numpy as np
from chromadb.utils.embedding_functions.schemas import validate_config_schema
import base64
import io
import importlib
import warnings


class CohereEmbeddingFunction(EmbeddingFunction[Embeddable]):
    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "large",
        api_key_env_var: str = "CHROMA_COHERE_API_KEY",
    ):
        try:
            import cohere
        except ImportError:
            raise ValueError(
                "The cohere python package is not installed. Please install it with `pip install cohere`"
            )

        try:
            self._PILImage = importlib.import_module("PIL.Image")
        except ImportError:
            raise ValueError(
                "The PIL python package is not installed. Please install it with `pip install pillow`"
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

        self.client = cohere.Client(self.api_key)

    def __call__(self, input: Embeddable) -> Embeddings:
        """
        Generate embeddings for the given documents.

        Args:
            input: Documents or images to generate embeddings for.

        Returns:
            Embeddings for the documents.
        """

        # Cohere works with images. if all are texts, return the embeddings for the texts
        if all(is_document(item) for item in input):
            return [
                np.array(embeddings, dtype=np.float32)
                for embeddings in self.client.embed(
                    texts=[str(item) for item in input],
                    model=self.model_name,
                    input_type="search_document",
                ).embeddings
            ]

        elif all(is_image(item) for item in input):
            base64_images = []
            for image_np in input:
                if not isinstance(image_np, np.ndarray):
                    raise ValueError(
                        f"Expected image input to be a numpy array, got {type(image_np)}"
                    )

                try:
                    pil_image = self._PILImage.fromarray(image_np)

                    buffer = io.BytesIO()
                    pil_image.save(buffer, format="PNG")
                    img_bytes = buffer.getvalue()

                    # Encode bytes to base64 string
                    base64_string = base64.b64encode(img_bytes).decode("utf-8")

                    data_uri = f"data:image/png;base64,{base64_string}"
                    base64_images.append(data_uri)

                except Exception as e:
                    raise ValueError(
                        f"Failed to convert image numpy array to base64 data URI: {e}"
                    ) from e

            return [
                np.array(embeddings, dtype=np.float32)
                for embeddings in self.client.embed(
                    images=base64_images,
                    model=self.model_name,
                    input_type="image",
                ).embeddings
            ]
        else:
            # Check if it's a mix or neither
            has_texts = any(is_document(item) for item in input)
            has_images = any(is_image(item) for item in input)
            if has_texts and has_images:
                raise ValueError(
                    "Input contains a mix of text documents and images, which is not supported. Provide either all texts or all images."
                )
            else:
                raise ValueError(
                    "Input must be a list of text documents (str) or a list of images (numpy arrays)."
                )

    @staticmethod
    def name() -> str:
        return "cohere"

    def default_space(self) -> Space:
        if self.model_name == "embed-multilingual-v2.0":
            return "ip"
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        if self.model_name == "embed-english-v3.0":
            return ["cosine", "l2", "ip"]
        elif self.model_name == "embed-english-light-v3.0":
            return ["cosine", "ip", "l2"]
        elif self.model_name == "embed-english-v2.0":
            return ["cosine"]
        elif self.model_name == "embed-english-light-v2.0":
            return ["cosine"]
        elif self.model_name == "embed-multilingual-v3.0":
            return ["cosine", "l2", "ip"]
        elif self.model_name == "embed-multilingual-light-v3.0":
            return ["cosine", "l2", "ip"]
        elif self.model_name == "embed-multilingual-v2.0":
            return ["ip"]
        else:
            return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Embeddable]":
        api_key_env_var = config.get("api_key_env_var")
        model_name = config.get("model_name")
        if api_key_env_var is None or model_name is None:
            assert False, "This code should not be reached"

        return CohereEmbeddingFunction(
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
        validate_config_schema(config, "cohere")
