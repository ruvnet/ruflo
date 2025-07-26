import json
import os
from typing import Dict, Any, cast
import jsonschema
from jsonschema import ValidationError

# Path to the schemas directory
SCHEMAS_DIR = os.path.join(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    ),
    "schemas",
    "embedding_functions",
)

cached_schemas: Dict[str, Dict[str, Any]] = {}


def load_schema(schema_name: str) -> Dict[str, Any]:
    """
    Load a JSON schema from the schemas directory.

    Args:
        schema_name: Name of the schema file (without .json extension)

    Returns:
        The loaded schema as a dictionary

    Raises:
        FileNotFoundError: If the schema file does not exist
        json.JSONDecodeError: If the schema file is not valid JSON
    """
    if schema_name in cached_schemas:
        return cached_schemas[schema_name]
    schema_path = os.path.join(SCHEMAS_DIR, f"{schema_name}.json")
    with open(schema_path, "r") as f:
        schema = cast(Dict[str, Any], json.load(f))
        cached_schemas[schema_name] = schema
        return schema


def validate_config_schema(config: Dict[str, Any], schema_name: str) -> None:
    """
    Validate a configuration against a schema.

    Args:
        config: Configuration to validate
        schema_name: Name of the schema file (without .json extension)

    Raises:
        ValidationError: If the configuration does not match the schema
        FileNotFoundError: If the schema file does not exist
        json.JSONDecodeError: If the schema file is not valid JSON
    """
    schema = load_schema(schema_name)
    try:
        jsonschema.validate(instance=config, schema=schema)
    except ValidationError as e:
        # Enhance the error message with more context
        error_path = "/".join(str(path) for path in e.path)
        error_message = (
            f"Config validation failed for schema '{schema_name}': {e.message}"
        )
        if error_path:
            error_message += f" at path '{error_path}'"
        raise ValidationError(error_message) from e


def get_schema_version(schema_name: str) -> str:
    """
    Get the version of a schema.

    Args:
        schema_name: Name of the schema file (without .json extension)

    Returns:
        The schema version as a string

    Raises:
        FileNotFoundError: If the schema file does not exist
        json.JSONDecodeError: If the schema file is not valid JSON
        KeyError: If the schema does not have a version
    """
    schema = load_schema(schema_name)
    return cast(str, schema.get("version", "1.0.0"))
