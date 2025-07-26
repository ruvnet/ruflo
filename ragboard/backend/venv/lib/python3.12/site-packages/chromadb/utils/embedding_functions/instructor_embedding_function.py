from chromadb.api.types import Embeddings, Documents, EmbeddingFunction, Space
from chromadb.utils.embedding_functions.schemas import validate_config_schema
from typing import List, Dict, Any, Optional
import numpy as np


class InstructorEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    This class is used to generate embeddings for a list of texts using the Instructor embedding model.
    """

    # If you have a GPU with at least 6GB try model_name = "hkunlp/instructor-xl" and device = "cuda"
    # for a full list of options: https://github.com/HKUNLP/instructor-embedding#model-list
    def __init__(
        self,
        model_name: str = "hkunlp/instructor-base",
        device: str = "cpu",
        instruction: Optional[str] = None,
    ):
        """
        Initialize the InstructorEmbeddingFunction.

        Args:
            model_name (str, optional): The name of the model to use for text embeddings.
                Defaults to "hkunlp/instructor-base".
            device (str, optional): The device to use for computation.
                Defaults to "cpu".
            instruction (str, optional): The instruction to use for the embeddings.
                Defaults to None.
        """
        try:
            from InstructorEmbedding import INSTRUCTOR
        except ImportError:
            raise ValueError(
                "The InstructorEmbedding python package is not installed. Please install it with `pip install InstructorEmbedding`"
            )

        self.model_name = model_name
        self.device = device
        self.instruction = instruction

        self._model = INSTRUCTOR(model_name_or_path=model_name, device=device)

    def __call__(self, input: Documents) -> Embeddings:
        """
        Generate embeddings for the given documents.

        Args:
            input: Documents or images to generate embeddings for.

        Returns:
            Embeddings for the documents.
        """
        # Instructor only works with text documents
        if not all(isinstance(item, str) for item in input):
            raise ValueError("Instructor only supports text documents, not images")

        if self.instruction is None:
            embeddings = self._model.encode(input, convert_to_numpy=True)
        else:
            texts_with_instructions = [[self.instruction, text] for text in input]
            embeddings = self._model.encode(
                texts_with_instructions, convert_to_numpy=True
            )

        # Convert to numpy arrays
        return [np.array(embedding, dtype=np.float32) for embedding in embeddings]

    @staticmethod
    def name() -> str:
        return "instructor"

    def default_space(self) -> Space:
        return "cosine"

    def supported_spaces(self) -> List[Space]:
        return ["cosine", "l2", "ip"]

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        model_name = config.get("model_name")
        device = config.get("device")
        instruction = config.get("instruction")

        if model_name is None or device is None:
            assert False, "This code should not be reached"

        return InstructorEmbeddingFunction(
            model_name=model_name, device=device, instruction=instruction
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "model_name": self.model_name,
            "device": self.device,
            "instruction": self.instruction,
        }

    def validate_config_update(
        self, old_config: Dict[str, Any], new_config: Dict[str, Any]
    ) -> None:
        # model_name is also used as the identifier for model path if stored locally.
        # Users should be able to change the path if needed, so we should not validate that.
        # e.g. moving file path from /v1/my-model.bin to /v2/my-model.bin
        return

    @staticmethod
    def validate_config(config: Dict[str, Any]) -> None:
        """
        Validate the configuration using the JSON schema.

        Args:
            config: Configuration to validate

        Raises:
            ValidationError: If the configuration does not match the schema
        """
        validate_config_schema(config, "instructor")
