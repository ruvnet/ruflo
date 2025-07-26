from chromadb.utils.embedding_functions.schemas import validate_config_schema
from chromadb.api.types import Embeddings, Documents, EmbeddingFunction
from typing import Dict, Any, cast
import json
import numpy as np


class AmazonBedrockEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    This class is used to generate embeddings for a list of texts using Amazon Bedrock.
    """

    def __init__(
        self,
        session: Any,
        model_name: str = "amazon.titan-embed-text-v1",
        **kwargs: Any,
    ):
        """Initialize AmazonBedrockEmbeddingFunction.

        Args:
            session (boto3.Session): The boto3 session to use. You need to have boto3
                installed, `pip install boto3`. Access & secret key are not supported.
            model_name (str, optional): Identifier of the model, defaults to "amazon.titan-embed-text-v1"
            **kwargs: Additional arguments to pass to the boto3 client.

        Example:
            >>> import boto3
            >>> session = boto3.Session(profile_name="profile", region_name="us-east-1")
            >>> bedrock = AmazonBedrockEmbeddingFunction(session=session)
            >>> texts = ["Hello, world!", "How are you?"]
            >>> embeddings = bedrock(texts)
        """

        self.model_name = model_name
        # check kwargs are primitives only
        for key, value in kwargs.items():
            if not isinstance(value, (str, int, float, bool, list, dict, tuple)):
                raise ValueError(f"Keyword argument {key} is not a primitive type")
        self.kwargs = kwargs

        # Store the session for serialization
        self._session_args = {}
        if hasattr(session, "region_name") and session.region_name:
            self._session_args["region_name"] = session.region_name
        if hasattr(session, "profile_name") and session.profile_name:
            self._session_args["profile_name"] = session.profile_name

        self._client = session.client(
            service_name="bedrock-runtime",
            **kwargs,
        )

    def __call__(self, input: Documents) -> Embeddings:
        """
        Generate embeddings for the given documents.

        Args:
            input: Documents to generate embeddings for.

        Returns:
            Embeddings for the documents.
        """
        accept = "application/json"
        content_type = "application/json"
        embeddings = []

        for text in input:
            input_body = {"inputText": text}
            body = json.dumps(input_body)
            response = self._client.invoke_model(
                body=body,
                modelId=self.model_name,
                accept=accept,
                contentType=content_type,
            )
            response_body = json.loads(response.get("body").read())
            embedding = response_body.get("embedding")
            embeddings.append(np.array(embedding, dtype=np.float32))

        # Convert to the expected Embeddings type
        return cast(Embeddings, embeddings)

    @staticmethod
    def name() -> str:
        return "amazon_bedrock"

    @staticmethod
    def build_from_config(config: Dict[str, Any]) -> "EmbeddingFunction[Documents]":
        try:
            import boto3
        except ImportError:
            raise ValueError(
                "The boto3 python package is not installed. Please install it with `pip install boto3`"
            )

        model_name = config.get("model_name")
        session_args = config.get("session_args")
        if model_name is None:
            assert False, "This code should not be reached"
        kwargs = config.get("kwargs", {})

        if session_args is None:
            session = boto3.Session()
        else:
            session = boto3.Session(**session_args)

        return AmazonBedrockEmbeddingFunction(
            session=session, model_name=model_name, **kwargs
        )

    def get_config(self) -> Dict[str, Any]:
        return {
            "model_name": self.model_name,
            "session_args": self._session_args,
            "kwargs": self.kwargs,
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
        validate_config_schema(config, "amazon_bedrock")
