# Embedding Function Schemas

This directory contains JSON schemas for all embedding functions in Chroma. The purpose of having this schema is to support cross language compatibility, and to validate that changes in one client library do not accidentally diverge from others.

## Schema Structure

Each schema follows the JSON Schema Draft-07 specification and includes:

- `version`: The version of the schema
- `title`: The title of the schema
- `description`: A description of the schema
- `properties`: The properties that can be configured for the embedding function
- `required`: The properties that are required for the embedding function
- `additionalProperties`: Whether additional properties are allowed (always set to `false` to ensure strict validation)

## Usage

The schemas can be used to validate the configuration of embedding functions using the `validate_config` function:

```python
from chromadb.utils.embedding_functions.schemas import validate_config

# Validate a configuration
config = {
    "api_key_env_var": "CHROMA_OPENAI_API_KEY",
    "model_name": "text-embedding-ada-002"
}
validate_config(config, "openai")
```

## Adding New Schemas

To add a new schema:

1. Create a new JSON file in this directory with the name of the embedding function (e.g., `new_function.json`)
2. Define the schema following the JSON Schema Draft-07 specification
3. Update the embedding function to use the schema for validation

## Schema Versioning

Each schema includes a version number to support future changes to embedding function configurations. When making changes to a schema, increment the version number to ensure backward compatibility.
