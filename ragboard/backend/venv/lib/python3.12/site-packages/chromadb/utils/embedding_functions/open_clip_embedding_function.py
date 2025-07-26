from chromadb.api.types import EmbeddingFunction, Space
from chromadb.utils.embedding_functions.schemas import validate_config_schema
from chromadb.api.types import (
    Document,
    Documents,
    Embedding,
    Embeddings,
    Image,
    Images,
    is_document,
    is_image,
    Embeddable,
)
from typing import List, Dict, Any, Union, Optional, cast
import numpy as np
import importlib


class OpenCLIPEmbeddingFunction(EmbeddingFunction[Embeddable]):
    """
    This class is used to generate embeddings for a list of texts or images using the Open CLIP model.
    """

    def __init__(
        self,
        model_name: str = "ViT-B-32",
        checkpoint: str = "laion2b_s34b_b79k",
        device: Optional[str] = "cpu",
    ) -> None:
        """
        Initialize the OpenCLIPEmbeddingFunction.

        Args:
            model_name (str, optional): The name of the model to use for embeddings.
                Defaults to "ViT-B-32".
            checkpoint (str, optional): The checkpoint to use for the model.
                Defaults to "laion2b_s34b_b79k".
            device (str, optional): The device to use for computation.
                Defaults to "cpu".
        """
        try:
            import open_clip
        except ImportError:
            raise ValueError(
                "The open_clip python package is not installed. Please install it with `pip install open-clip-torch`. https://github.com/mlfoundations/open_clip"
            )

        try:
            self._torch = importlib.import_module("torch")
        except ImportError:
            raise ValueError(
                "The torch python package is not installed. Please install it with `pip install torch`"
            )

        try:
            self._PILImage = importlib.import_module("PIL.Image")
        except ImportError:
            raise ValueError(
                "The PIL python package is not installed. Please install it with `pip install pillow`"
            )

        self.model_name = model_name
        self.checkpoint = checkpoint
        self.device = device

        model, _, preprocess = open_clip.create_model_and_transforms(
            model_name=model_name, pretrained=checkpoint
        )
        self._model = model
        self._model.to(device)
        self._preprocess = preprocess
        self._tokenizer = open_clip.get_tokenizer(model_name=model_name)

    def _encode_image(self, image: Image) -> Embedding:
        """
        Encode an image using the Open CLIP model.

        Args:
            image: The image to encode.

        Returns:
            The embedding for the image.
        """
        pil_image = self._PILImage.fromarray(image)
        with self._torch.no_grad():
            image_features = self._model.encode_image(
                self._preprocess(pil_image).unsqueeze(0).to(self.device)
            )
            image_features /= image_features.norm(dim=-1, keepdim=True)
            return cast(Embedding, image_features.squeeze().cpu().numpy())

    def _encode_text(self, text: Document) -> Embedding:
        """
        Encode a text using the Open CLIP model.

        Args:
            text: The text to encode.

        Returns:
            The embedding for the text.
        """
        with self._torch.no_grad():
            text_features = self._model.encode_text(
                self._tokenizer(text).to(self.device)
            )
            text_features /= text_features.norm(dim=-1, keepdim=True)
            return cast(Embedding, text_features.squeeze().cpu().numpy())

    def __call__(self, input: Embeddable) -> Embeddings:
        """
        Generate embeddings for the given documents or images.

        Args:
            input: Documents or images to generate embeddings for.

        Returns:
            Embeddings for the documents or images.
        """
        embeddings: Embeddings = []
        for item in input:
            if is_image(item):
                embeddings.append(
                    np.array(self._encode_image(cast(Image, item)), dtype=np.float32)
                )
            elif is_document(item):
                embeddings.append(
                    np.array(self._encode_text(cast(Document, item)), dtype=np.float32)
                )

        return embeddings

    @staticmethod
    def name() -> str:
        return "open_clip"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(
        config: Dict[str, Any]
    ) -> "EmbeddingFunction[Union[Documents, Images]]":
        model_name = config.get("model_name")
        checkpoint = config.get("checkpoint")
        device = config.get("device")

        if model_name is None or checkpoint is None or device is None:
            assert False, "This code should not be reached"

        return OpenCLIPEmbeddingFunction(
            model_name=model_name, checkpoint=checkpoint, device=device
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "model_name": self.model_name,
            "checkpoint": self.checkpoint,
            "device": self.device,
        }

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        if "model_name" in new_config:
            raise ValueError(
                "The model name cannot be changed after the embedding function has been initialized."
            )
        if "checkpoint" in new_config:
            raise ValueError(
                "The checkpoint cannot be changed after the embedding function has been initialized."
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
        validate_config_schema(config, "open_clip")
