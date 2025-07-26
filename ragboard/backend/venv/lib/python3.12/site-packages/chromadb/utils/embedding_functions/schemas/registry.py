"""
Schema Registry for Embedding Functions

This module provides a registry of all available schemas for embedding functions.
It can be used to get information about available schemas and their versions.
"""

from typing import Dict, List, Set
import os
import json
from .schema_utils import SCHEMAS_DIR


def get_available_schemas() -> List[str]:
    """
    Get a list of all available schemas.

    Returns:
        A list of schema names (without .json extension)
    """
    schemas = []
    for filename in os.listdir(SCHEMAS_DIR):
        if filename.endswith(".json") and filename != "base_schema.json":
            schemas.append(filename[:-5])  # Remove .json extension
    return schemas


def get_schema_info() -> Dict[str, Dict[str, str]]:
    """
    Get information about all available schemas.

    Returns:
        A dictionary mapping schema names to information about the schema
    """
    schema_info = {}
    for schema_name in get_available_schemas():
        schema_path = os.path.join(SCHEMAS_DIR, f"{schema_name}.json")
        with open(schema_path, "r") as f:
            schema = json.load(f)
            schema_info[schema_name] = {
                "version": schema.get("version", "1.0.0"),
                "title": schema.get("title", ""),
                "description": schema.get("description", ""),
            }
    return schema_info


def get_embedding_function_names() -> Set[str]:
    """
    Get a set of all embedding function names that have schemas.

    Returns:
        A set of embedding function names
    """
    return set(get_available_schemas())
