from __future__ import annotations as _annotations

import typing
from typing import Any

import typing_extensions

if typing.TYPE_CHECKING:
    from ._schema_generation_shared import (
        CoreSchemaOrField as CoreSchemaOrField,
    )
    from ._schema_generation_shared import (
        GetJsonSchemaFunction,
    )


class CoreMetadata(typing_extensions.TypedDict, total=False):
    """A `TypedDict` for holding the metadata dict of the schema.

    Attributes:
        pydantic_js_functions: List of JSON schema functions.
        pydantic_js_prefer_positional_arguments: Whether JSON schema generator will
            prefer positional over keyword arguments for an 'arguments' schema.
    """

    pydantic_js_functions: list[GetJsonSchemaFunction]
    pydantic_js_annotation_functions: list[GetJsonSchemaFunction]

    # If `pydantic_js_prefer_positional_arguments` is True, the JSON schema generator will
    # prefer positional over keyword arguments for an 'arguments' schema.
    pydantic_js_prefer_positional_arguments: bool | None

    pydantic_typed_dict_cls: type[Any] | None  # TODO: Consider moving this into the pydantic-core TypedDictSchema


class CoreMetadataHandler:
    """Because the metadata field in pydantic_core is of type `Any`, we can't assume much about its contents.

    This class is used to interact with the metadata field on a CoreSchema object in a consistent
    way throughout pydantic.
    """

    __slots__ = ('_schema',)

    def __init__(self, schema: CoreSchemaOrField):
        self._schema = schema

        metadata = schema.get('metadata')
        if metadata is None:
            schema['metadata'] = CoreMetadata()
        elif not isinstance(metadata, dict):
            raise TypeError(f'CoreSchema metadata should be a dict; got {metadata!r}.')

    @property
    def metadata(self) -> CoreMetadata:
        """Retrieves the metadata dict from the schema, initializing it to a dict if it is None
        and raises an error if it is not a dict.
        """
        metadata = self._schema.get('metadata')
        if metadata is None:
            self._schema['metadata'] = metadata = CoreMetadata()
        if not isinstance(metadata, dict):
            raise TypeError(f'CoreSchema metadata should be a dict; got {metadata!r}.')
        return metadata


def build_metadata_dict(
    *,  # force keyword arguments to make it easier to modify this signature in a backwards-compatible way
    js_functions: list[GetJsonSchemaFunction] | None = None,
    js_annotation_functions: list[GetJsonSchemaFunction] | None = None,
    js_prefer_positional_arguments: bool | None = None,
    typed_dict_cls: type[Any] | None = None,
    initial_metadata: Any | None = None,
) -> Any:
    """Builds a dict to use as the metadata field of a CoreSchema object in a manner that is consistent
    with the CoreMetadataHandler class.
    """
    if initial_metadata is not None and not isinstance(initial_metadata, dict):
        raise TypeError(f'CoreSchema metadata should be a dict; got {initial_metadata!r}.')

    metadata = CoreMetadata(
        pydantic_js_functions=js_functions or [],
        pydantic_js_annotation_functions=js_annotation_functions or [],
        pydantic_js_prefer_positional_arguments=js_prefer_positional_arguments,
        pydantic_typed_dict_cls=typed_dict_cls,
    )
    metadata = {k: v for k, v in metadata.items() if v is not None}

    if initial_metadata is not None:
        metadata = {**initial_metadata, **metadata}

    return metadata
