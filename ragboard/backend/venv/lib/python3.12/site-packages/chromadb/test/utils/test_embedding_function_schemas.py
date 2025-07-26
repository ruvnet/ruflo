import pytest
from typing import List, Any, Callable
from jsonschema import ValidationError
from unittest.mock import MagicMock, create_autospec
from chromadb.utils.embedding_functions.schemas import (
    validate_config_schema,
    load_schema,
    get_available_schemas,
)
from chromadb.utils.embedding_functions import known_embedding_functions
from chromadb.api.types import Documents, Embeddings
from pytest import MonkeyPatch

# Skip these embedding functions in tests
SKIP_EMBEDDING_FUNCTIONS = [
    "chroma_langchain",
]


def get_embedding_function_names() -> List[str]:
    """Get all embedding function names to test"""
    return [
        name
        for name in known_embedding_functions.keys()
        if name not in SKIP_EMBEDDING_FUNCTIONS
    ]


class TestEmbeddingFunctionSchemas:
    """Test class for embedding function schemas"""

    @pytest.mark.parametrize("ef_name", get_embedding_function_names())
    def test_embedding_function_config_roundtrip(
        self,
        ef_name: str,
        mock_embeddings: Callable[[Documents], Embeddings],
        mock_common_deps: MonkeyPatch,
    ) -> None:
        """Test embedding function configuration roundtrip"""
        ef_class = known_embedding_functions[ef_name]

        # Create an autospec of the embedding function class
        mock_ef = create_autospec(ef_class, instance=True)

        # Mock the __call__ method
        mock_call = MagicMock(return_value=mock_embeddings(["test"]))
        mock_ef.__call__ = mock_call

        # Mock the class constructor to return our mock instance
        mock_common_deps.setattr(
            ef_class, "__new__", lambda cls, *args, **kwargs: mock_ef
        )

        # Create instance with minimal args (constructor will be mocked)
        ef_instance = ef_class()

        # Get the config (this will use the real method)
        config = ef_instance.get_config()

        # Test recreation from config
        new_instance = ef_class.build_from_config(config)
        new_config = new_instance.get_config()

        # Configs should match
        assert (
            config == new_config
        ), f"Configs don't match after recreation for {ef_name}"

    def test_schema_required_fields(self) -> None:
        """Test that schemas enforce required fields"""
        for schema_name in get_available_schemas():
            schema = load_schema(schema_name)
            if "required" not in schema:
                continue

            # Create minimal valid config
            config = {}
            for field in schema["required"]:
                field_schema = schema["properties"][field]
                field_type = (
                    field_schema["type"][0]
                    if isinstance(field_schema["type"], list)
                    else field_schema["type"]
                )
                config[field] = self._get_dummy_value(field_type)

            # Test each required field
            for field in schema["required"]:
                test_config = config.copy()
                del test_config[field]
                with pytest.raises(ValidationError):
                    validate_config_schema(test_config, schema_name)

    @staticmethod
    def _get_dummy_value(field_type: str) -> Any:
        """Get a dummy value for a given field type"""
        type_map = {
            "string": "dummy",
            "integer": 0,
            "number": 0.0,
            "boolean": False,
            "object": {},
            "array": [],
        }
        return type_map.get(field_type, "dummy")

    def test_schema_additional_properties(self) -> None:
        """Test that schemas reject additional properties"""
        for schema_name in get_available_schemas():
            schema = load_schema(schema_name)
            config = {}

            # Add required fields
            if "required" in schema:
                for field in schema["required"]:
                    field_schema = schema["properties"][field]
                    field_type = (
                        field_schema["type"][0]
                        if isinstance(field_schema["type"], list)
                        else field_schema["type"]
                    )
                    config[field] = self._get_dummy_value(field_type)

            # Add additional property
            test_config = config.copy()
            test_config["additional_property"] = "value"

            # Test validation
            if schema.get("additionalProperties", True) is False:
                with pytest.raises(ValidationError):
                    validate_config_schema(test_config, schema_name)
