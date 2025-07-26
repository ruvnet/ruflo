from __future__ import annotations

import datetime
import sys
from typing import Any, Callable, Generic, Optional, Type, TypeVar

from pydantic_core import ErrorDetails, ErrorTypeInfo, InitErrorDetails, MultiHostHost
from pydantic_core.core_schema import CoreConfig, CoreSchema, ErrorType

if sys.version_info < (3, 8):
    from typing_extensions import final
else:
    from typing import final

if sys.version_info < (3, 11):
    from typing_extensions import Literal, LiteralString, Self, TypeAlias
else:
    from typing import Literal, LiteralString, Self, TypeAlias

from _typeshed import SupportsAllComparisons

__all__ = [
    '__version__',
    'build_profile',
    'build_info',
    '_recursion_limit',
    'ArgsKwargs',
    'SchemaValidator',
    'SchemaSerializer',
    'Url',
    'MultiHostUrl',
    'SchemaError',
    'ValidationError',
    'PydanticCustomError',
    'PydanticKnownError',
    'PydanticOmit',
    'PydanticUseDefault',
    'PydanticSerializationError',
    'PydanticSerializationUnexpectedValue',
    'PydanticUndefined',
    'PydanticUndefinedType',
    'Some',
    'to_json',
    'from_json',
    'to_jsonable_python',
    'list_all_errors',
    'TzInfo',
    'validate_core_schema',
]
__version__: str
build_profile: str
build_info: str
_recursion_limit: int

_T = TypeVar('_T', default=Any, covariant=True)

_StringInput: TypeAlias = 'dict[str, _StringInput]'

@final
class Some(Generic[_T]):
    """
    Similar to Rust's [`Option::Some`](https://doc.rust-lang.org/std/option/enum.Option.html) type, this
    identifies a value as being present, and provides a way to access it.

    Generally used in a union with `None` to different between "some value which could be None" and no value.
    """

    __match_args__ = ('value',)

    @property
    def value(self) -> _T:
        """
        Returns the value wrapped by `Some`.
        """
    @classmethod
    def __class_getitem__(cls, __item: Any) -> Type[Self]: ...

@final
class SchemaValidator:
    """
    `SchemaValidator` is the Python wrapper for `pydantic-core`'s Rust validation logic, internally it owns one
    `CombinedValidator` which may in turn own more `CombinedValidator`s which make up the full schema validator.
    """

    def __new__(cls, schema: CoreSchema, config: CoreConfig | None = None) -> Self:
        """
        Create a new SchemaValidator.

        Arguments:
            schema: The [`CoreSchema`][pydantic_core.core_schema.CoreSchema] to use for validation.
            config: Optionally a [`CoreConfig`][pydantic_core.core_schema.CoreConfig] to configure validation.
        """
    @property
    def title(self) -> str:
        """
        The title of the schema, as used in the heading of [`ValidationError.__str__()`][pydantic_core.ValidationError].
        """
    def validate_python(
        self,
        input: Any,
        *,
        strict: bool | None = None,
        from_attributes: bool | None = None,
        context: 'dict[str, Any] | None' = None,
        self_instance: Any | None = None,
    ) -> Any:
        """
        Validate a Python object against the schema and return the validated object.

        Arguments:
            input: The Python object to validate.
            strict: Whether to validate the object in strict mode.
                If `None`, the value of [`CoreConfig.strict`][pydantic_core.core_schema.CoreConfig] is used.
            from_attributes: Whether to validate objects as inputs to models by extracting attributes.
                If `None`, the value of [`CoreConfig.from_attributes`][pydantic_core.core_schema.CoreConfig] is used.
            context: The context to use for validation, this is passed to functional validators as
                [`info.context`][pydantic_core.core_schema.ValidationInfo.context].
            self_instance: An instance of a model set attributes on from validation, this is used when running
                validation from the `__init__` method of a model.

        Raises:
            ValidationError: If validation fails.
            Exception: Other error types maybe raised if internal errors occur.

        Returns:
            The validated object.
        """
    def isinstance_python(
        self,
        input: Any,
        *,
        strict: bool | None = None,
        from_attributes: bool | None = None,
        context: 'dict[str, Any] | None' = None,
        self_instance: Any | None = None,
    ) -> bool:
        """
        Similar to [`validate_python()`][pydantic_core.SchemaValidator.validate_python] but returns a boolean.

        Arguments match `validate_python()`. This method will not raise `ValidationError`s but will raise internal
        errors.

        Returns:
            `True` if validation succeeds, `False` if validation fails.
        """
    def validate_json(
        self,
        input: str | bytes | bytearray,
        *,
        strict: bool | None = None,
        context: 'dict[str, Any] | None' = None,
        self_instance: Any | None = None,
    ) -> Any:
        """
        Validate JSON data directly against the schema and return the validated Python object.

        This method should be significantly faster than `validate_python(json.loads(json_data))` as it avoids the
        need to create intermediate Python objects

        It also handles constructing the correct Python type even in strict mode, where
        `validate_python(json.loads(json_data))` would fail validation.

        Arguments:
            input: The JSON data to validate.
            strict: Whether to validate the object in strict mode.
                If `None`, the value of [`CoreConfig.strict`][pydantic_core.core_schema.CoreConfig] is used.
            context: The context to use for validation, this is passed to functional validators as
                [`info.context`][pydantic_core.core_schema.ValidationInfo.context].
            self_instance: An instance of a model set attributes on from validation.

        Raises:
            ValidationError: If validation fails or if the JSON data is invalid.
            Exception: Other error types maybe raised if internal errors occur.

        Returns:
            The validated Python object.
        """
    def validate_strings(
        self, input: _StringInput, *, strict: bool | None = None, context: 'dict[str, Any] | None' = None
    ) -> Any:
        """
        Validate a string against the schema and return the validated Python object.

        This is similar to `validate_json` but applies to scenarios where the input will be a string but not
        JSON data, e.g. URL fragments, query parameters, etc.

        Arguments:
            input: The input as a string, or bytes/bytearray if `strict=False`.
            strict: Whether to validate the object in strict mode.
                If `None`, the value of [`CoreConfig.strict`][pydantic_core.core_schema.CoreConfig] is used.
            context: The context to use for validation, this is passed to functional validators as
                [`info.context`][pydantic_core.core_schema.ValidationInfo.context].

        Raises:
            ValidationError: If validation fails or if the JSON data is invalid.
            Exception: Other error types maybe raised if internal errors occur.

        Returns:
            The validated Python object.
        """
    def validate_assignment(
        self,
        obj: Any,
        field_name: str,
        field_value: Any,
        *,
        strict: bool | None = None,
        from_attributes: bool | None = None,
        context: 'dict[str, Any] | None' = None,
    ) -> dict[str, Any] | tuple[dict[str, Any], dict[str, Any] | None, set[str]]:
        """
        Validate an assignment to a field on a model.

        Arguments:
            obj: The model instance being assigned to.
            field_name: The name of the field to validate assignment for.
            field_value: The value to assign to the field.
            strict: Whether to validate the object in strict mode.
                If `None`, the value of [`CoreConfig.strict`][pydantic_core.core_schema.CoreConfig] is used.
            from_attributes: Whether to validate objects as inputs to models by extracting attributes.
                If `None`, the value of [`CoreConfig.from_attributes`][pydantic_core.core_schema.CoreConfig] is used.
            context: The context to use for validation, this is passed to functional validators as
                [`info.context`][pydantic_core.core_schema.ValidationInfo.context].

        Raises:
            ValidationError: If validation fails.
            Exception: Other error types maybe raised if internal errors occur.

        Returns:
            Either the model dict or a tuple of `(model_data, model_extra, fields_set)`
        """
    def get_default_value(self, *, strict: bool | None = None, context: Any = None) -> Some | None:
        """
        Get the default value for the schema, including running default value validation.

        Arguments:
            strict: Whether to validate the default value in strict mode.
                If `None`, the value of [`CoreConfig.strict`][pydantic_core.core_schema.CoreConfig] is used.
            context: The context to use for validation, this is passed to functional validators as
                [`info.context`][pydantic_core.core_schema.ValidationInfo.context].

        Raises:
            ValidationError: If validation fails.
            Exception: Other error types maybe raised if internal errors occur.

        Returns:
            `None` if the schema has no default value, otherwise a [`Some`][pydantic_core.Some] containing the default.
        """

_IncEx: TypeAlias = set[int] | set[str] | dict[int, _IncEx] | dict[str, _IncEx] | None

@final
class SchemaSerializer:
    """
    `SchemaSerializer` is the Python wrapper for `pydantic-core`'s Rust serialization logic, internally it owns one
    `CombinedSerializer` which may in turn own more `CombinedSerializer`s which make up the full schema serializer.
    """

    def __new__(cls, schema: CoreSchema, config: CoreConfig | None = None) -> Self:
        """
        Create a new SchemaSerializer.

        Arguments:
            schema: The [`CoreSchema`][pydantic_core.core_schema.CoreSchema] to use for serialization.
            config: Optionally a [`CoreConfig`][pydantic_core.core_schema.CoreConfig] to to configure serialization.
        """
    def to_python(
        self,
        value: Any,
        *,
        mode: str | None = None,
        include: _IncEx = None,
        exclude: _IncEx = None,
        by_alias: bool = True,
        exclude_unset: bool = False,
        exclude_defaults: bool = False,
        exclude_none: bool = False,
        round_trip: bool = False,
        warnings: bool = True,
        fallback: Callable[[Any], Any] | None = None,
    ) -> Any:
        """
        Serialize/marshal a Python object to a Python object including transforming and filtering data.

        Arguments:
            value: The Python object to serialize.
            mode: The serialization mode to use, either `'python'` or `'json'`, defaults to `'python'`. In JSON mode,
                all values are converted to JSON compatible types, e.g. `None`, `int`, `float`, `str`, `list`, `dict`.
            include: A set of fields to include, if `None` all fields are included.
            exclude: A set of fields to exclude, if `None` no fields are excluded.
            by_alias: Whether to use the alias names of fields.
            exclude_unset: Whether to exclude fields that are not set,
                e.g. are not included in `__pydantic_fields_set__`.
            exclude_defaults: Whether to exclude fields that are equal to their default value.
            exclude_none: Whether to exclude fields that have a value of `None`.
            round_trip: Whether to enable serialization and validation round-trip support.
            warnings: Whether to log warnings when invalid fields are encountered.
            fallback: A function to call when an unknown value is encountered,
                if `None` a [`PydanticSerializationError`][pydantic_core.PydanticSerializationError] error is raised.

        Raises:
            PydanticSerializationError: If serialization fails and no `fallback` function is provided.

        Returns:
            The serialized Python object.
        """
    def to_json(
        self,
        value: Any,
        *,
        indent: int | None = None,
        include: _IncEx = None,
        exclude: _IncEx = None,
        by_alias: bool = True,
        exclude_unset: bool = False,
        exclude_defaults: bool = False,
        exclude_none: bool = False,
        round_trip: bool = False,
        warnings: bool = True,
        fallback: Callable[[Any], Any] | None = None,
    ) -> bytes:
        """
        Serialize a Python object to JSON including transforming and filtering data.

        Arguments:
            value: The Python object to serialize.
            indent: If `None`, the JSON will be compact, otherwise it will be pretty-printed with the indent provided.
            include: A set of fields to include, if `None` all fields are included.
            exclude: A set of fields to exclude, if `None` no fields are excluded.
            by_alias: Whether to use the alias names of fields.
            exclude_unset: Whether to exclude fields that are not set,
                e.g. are not included in `__pydantic_fields_set__`.
            exclude_defaults: Whether to exclude fields that are equal to their default value.
            exclude_none: Whether to exclude fields that have a value of `None`.
            round_trip: Whether to enable serialization and validation round-trip support.
            warnings: Whether to log warnings when invalid fields are encountered.
            fallback: A function to call when an unknown value is encountered,
                if `None` a [`PydanticSerializationError`][pydantic_core.PydanticSerializationError] error is raised.

        Raises:
            PydanticSerializationError: If serialization fails and no `fallback` function is provided.

        Returns:
           JSON bytes.
        """

def to_json(
    value: Any,
    *,
    indent: int | None = None,
    include: _IncEx = None,
    exclude: _IncEx = None,
    by_alias: bool = True,
    exclude_none: bool = False,
    round_trip: bool = False,
    timedelta_mode: Literal['iso8601', 'float'] = 'iso8601',
    bytes_mode: Literal['utf8', 'base64'] = 'utf8',
    serialize_unknown: bool = False,
    fallback: Callable[[Any], Any] | None = None,
) -> bytes:
    """
    Serialize a Python object to JSON including transforming and filtering data.

    This is effectively a standalone version of [`SchemaSerializer.to_json`][pydantic_core.SchemaSerializer.to_json].

    Arguments:
        value: The Python object to serialize.
        indent: If `None`, the JSON will be compact, otherwise it will be pretty-printed with the indent provided.
        include: A set of fields to include, if `None` all fields are included.
        exclude: A set of fields to exclude, if `None` no fields are excluded.
        by_alias: Whether to use the alias names of fields.
        exclude_none: Whether to exclude fields that have a value of `None`.
        round_trip: Whether to enable serialization and validation round-trip support.
        timedelta_mode: How to serialize `timedelta` objects, either `'iso8601'` or `'float'`.
        bytes_mode: How to serialize `bytes` objects, either `'utf8'` or `'base64'`.
        serialize_unknown: Attempt to serialize unknown types, `str(value)` will be used, if that fails
            `"<Unserializable {value_type} object>"` will be used.
        fallback: A function to call when an unknown value is encountered,
            if `None` a [`PydanticSerializationError`][pydantic_core.PydanticSerializationError] error is raised.

    Raises:
        PydanticSerializationError: If serialization fails and no `fallback` function is provided.

    Returns:
       JSON bytes.
    """

def from_json(data: str | bytes | bytearray, *, allow_inf_nan: bool = True) -> Any:
    """
    Deserialize JSON data to a Python object.

    This is effectively a faster version of `json.loads()`.

    Arguments:
        data: The JSON data to deserialize.
        allow_inf_nan: Whether to allow `Infinity`, `-Infinity` and `NaN` values as `json.loads()` does by default.

    Raises:
        ValueError: If deserialization fails.

    Returns:
        The deserialized Python object.
    """

def to_jsonable_python(
    value: Any,
    *,
    include: _IncEx = None,
    exclude: _IncEx = None,
    by_alias: bool = True,
    exclude_none: bool = False,
    round_trip: bool = False,
    timedelta_mode: Literal['iso8601', 'float'] = 'iso8601',
    bytes_mode: Literal['utf8', 'base64'] = 'utf8',
    serialize_unknown: bool = False,
    fallback: Callable[[Any], Any] | None = None,
) -> Any:
    """
    Serialize/marshal a Python object to a JSON-serializable Python object including transforming and filtering data.

    This is effectively a standalone version of
    [`SchemaSerializer.to_python(mode='json')`][pydantic_core.SchemaSerializer.to_python].

    Args:
        value: The Python object to serialize.
        include: A set of fields to include, if `None` all fields are included.
        exclude: A set of fields to exclude, if `None` no fields are excluded.
        by_alias: Whether to use the alias names of fields.
        exclude_none: Whether to exclude fields that have a value of `None`.
        round_trip: Whether to enable serialization and validation round-trip support.
        timedelta_mode: How to serialize `timedelta` objects, either `'iso8601'` or `'float'`.
        bytes_mode: How to serialize `bytes` objects, either `'utf8'` or `'base64'`.
        serialize_unknown: Attempt to serialize unknown types, `str(value)` will be used, if that fails
            `"<Unserializable {value_type} object>"` will be used.
        fallback: A function to call when an unknown value is encountered,
            if `None` a [`PydanticSerializationError`][pydantic_core.PydanticSerializationError] error is raised.

    Raises:
        PydanticSerializationError: If serialization fails and no `fallback` function is provided.

    Returns:
        The serialized Python object.
    """

class Url(SupportsAllComparisons):
    """
    A URL type, internal logic uses the [url rust crate](https://docs.rs/url/latest/url/) originally developed
    by Mozilla.
    """

    def __new__(cls, url: str) -> Self:
        """
        Create a new `Url` instance.

        Args:
            url: String representation of a URL.

        Returns:
            A new `Url` instance.

        Raises:
            ValidationError: If the URL is invalid.
        """
    @property
    def scheme(self) -> str:
        """
        The scheme part of the URL.

        e.g. `https` in `https://user:pass@host:port/path?query#fragment`
        """
    @property
    def username(self) -> str | None:
        """
        The username part of the URL, or `None`.

        e.g. `user` in `https://user:pass@host:port/path?query#fragment`
        """
    @property
    def password(self) -> str | None:
        """
        The password part of the URL, or `None`.

        e.g. `pass` in `https://user:pass@host:port/path?query#fragment`
        """
    @property
    def host(self) -> str | None:
        """
        The host part of the URL, or `None`.

        If the URL must be punycode encoded, this is the encoded host, e.g if the input URL is `https://£££.com`,
        `host` will be `xn--9aaa.com`
        """
    def unicode_host(self) -> str | None:
        """
        The host part of the URL as a unicode string, or `None`.

        e.g. `host` in `https://user:pass@host:port/path?query#fragment`

        If the URL must be punycode encoded, this is the decoded host, e.g if the input URL is `https://£££.com`,
        `unicode_host()` will be `£££.com`
        """
    @property
    def port(self) -> int | None:
        """
        The port part of the URL, or `None`.

        e.g. `port` in `https://user:pass@host:port/path?query#fragment`
        """
    @property
    def path(self) -> str | None:
        """
        The path part of the URL, or `None`.

        e.g. `/path` in `https://user:pass@host:port/path?query#fragment`
        """
    @property
    def query(self) -> str | None:
        """
        The query part of the URL, or `None`.

        e.g. `query` in `https://user:pass@host:port/path?query#fragment`
        """
    def query_params(self) -> list[tuple[str, str]]:
        """
        The query part of the URL as a list of key-value pairs.

        e.g. `[('foo', 'bar')]` in `https://user:pass@host:port/path?foo=bar#fragment`
        """
    @property
    def fragment(self) -> str | None:
        """
        The fragment part of the URL, or `None`.

        e.g. `fragment` in `https://user:pass@host:port/path?query#fragment`
        """
    def unicode_string(self) -> str:
        """
        The URL as a unicode string, unlike `__str__()` this will not punycode encode the host.

        If the URL must be punycode encoded, this is the decoded string, e.g if the input URL is `https://£££.com`,
        `unicode_string()` will be `https://£££.com`
        """
    def __repr__(self) -> str: ...
    def __str__(self) -> str:
        """
        The URL as a string, this will punycode encode the host if required.
        """
    def __deepcopy__(self, memo: dict) -> str: ...
    @classmethod
    def build(
        cls,
        *,
        scheme: str,
        username: Optional[str] = None,
        password: Optional[str] = None,
        host: str,
        port: Optional[int] = None,
        path: Optional[str] = None,
        query: Optional[str] = None,
        fragment: Optional[str] = None,
    ) -> Self:
        """
        Build a new `Url` instance from its component parts.

        Args:
            scheme: The scheme part of the URL.
            username: The username part of the URL, or omit for no username.
            password: The password part of the URL, or omit for no password.
            host: The host part of the URL.
            port: The port part of the URL, or omit for no port.
            path: The path part of the URL, or omit for no path.
            query: The query part of the URL, or omit for no query.
            fragment: The fragment part of the URL, or omit for no fragment.

        Returns:
            An instance of URL
        """

class MultiHostUrl(SupportsAllComparisons):
    """
    A URL type with support for multiple hosts, as used by some databases for DSNs, e.g. `https://foo.com,bar.com/path`.

    Internal URL logic uses the [url rust crate](https://docs.rs/url/latest/url/) originally developed
    by Mozilla.
    """

    def __new__(cls, url: str) -> Self:
        """
        Create a new `MultiHostUrl` instance.

        Args:
            url: String representation of a URL.

        Returns:
            A new `MultiHostUrl` instance.

        Raises:
            ValidationError: If the URL is invalid.
        """
    @property
    def scheme(self) -> str:
        """
        The scheme part of the URL.

        e.g. `https` in `https://foo.com,bar.com/path?query#fragment`
        """
    @property
    def path(self) -> str | None:
        """
        The path part of the URL, or `None`.

        e.g. `/path` in `https://foo.com,bar.com/path?query#fragment`
        """
    @property
    def query(self) -> str | None:
        """
        The query part of the URL, or `None`.

        e.g. `query` in `https://foo.com,bar.com/path?query#fragment`
        """
    def query_params(self) -> list[tuple[str, str]]:
        """
        The query part of the URL as a list of key-value pairs.

        e.g. `[('foo', 'bar')]` in `https://foo.com,bar.com/path?query#fragment`
        """
    @property
    def fragment(self) -> str | None:
        """
        The fragment part of the URL, or `None`.

        e.g. `fragment` in `https://foo.com,bar.com/path?query#fragment`
        """
    def hosts(self) -> list[MultiHostHost]:
        '''

        The hosts of the `MultiHostUrl` as [`MultiHostHost`][pydantic_core.MultiHostHost] typed dicts.

        ```py
        from pydantic_core import MultiHostUrl

        mhu = MultiHostUrl('https://foo.com:123,foo:bar@bar.com/path')
        print(mhu.hosts())
        """
        [
            {'username': None, 'password': None, 'host': 'foo.com', 'port': 123},
            {'username': 'foo', 'password': 'bar', 'host': 'bar.com', 'port': 443}
        ]
        ```
        Returns:
            A list of dicts, each representing a host.
        '''
    def unicode_string(self) -> str:
        """
        The URL as a unicode string, unlike `__str__()` this will not punycode encode the hosts.
        """
    def __repr__(self) -> str: ...
    def __str__(self) -> str:
        """
        The URL as a string, this will punycode encode the hosts if required.
        """
    def __deepcopy__(self, memo: dict) -> Self: ...
    @classmethod
    def build(
        cls,
        *,
        scheme: str,
        hosts: Optional[list[MultiHostHost]] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        host: Optional[str] = None,
        port: Optional[int] = None,
        path: Optional[str] = None,
        query: Optional[str] = None,
        fragment: Optional[str] = None,
    ) -> Self:
        """
        Build a new `MultiHostUrl` instance from its component parts.

        This method takes either `hosts` - a list of `MultiHostHost` typed dicts, or the individual components
        `username`, `password`, `host` and `port`.

        Args:
            scheme: The scheme part of the URL.
            hosts: Multiple hosts to build the URL from.
            username: The username part of the URL.
            password: The password part of the URL.
            host: The host part of the URL.
            port: The port part of the URL.
            path: The path part of the URL.
            query: The query part of the URL, or omit for no query.
            fragment: The fragment part of the URL, or omit for no fragment.

        Returns:
            An instance of `MultiHostUrl`
        """

@final
class SchemaError(Exception):
    """
    Information about errors that occur while building a [`SchemaValidator`][pydantic_core.SchemaValidator]
    or [`SchemaSerializer`][pydantic_core.SchemaSerializer].
    """

    def error_count(self) -> int:
        """
        Returns:
            The number of errors in the schema.
        """
    def errors(self) -> list[ErrorDetails]:
        """
        Returns:
            A list of [`ErrorDetails`][pydantic_core.ErrorDetails] for each error in the schema.
        """

@final
class ValidationError(ValueError):
    """
    `ValidationError` is the exception raised by `pydantic-core` when validation fails, it contains a list of errors
    which detail why validation failed.
    """

    @staticmethod
    def from_exception_data(
        title: str,
        line_errors: list[InitErrorDetails],
        input_type: Literal['python', 'json'] = 'python',
        hide_input: bool = False,
    ) -> ValidationError:
        """
        Python constructor for a Validation Error.

        The API for constructing validation errors will probably change in the future,
        hence the static method rather than `__init__`.

        Arguments:
            title: The title of the error, as used in the heading of `str(validation_error)`
            line_errors: A list of [`InitErrorDetails`][pydantic_core.InitErrorDetails] which contain information
                about errors that occurred during validation.
            input_type: Whether the error is for a Python object or JSON.
            hide_input: Whether to hide the input value in the error message.
        """
    @property
    def title(self) -> str:
        """
        The title of the error, as used in the heading of `str(validation_error)`.
        """
    def error_count(self) -> int:
        """
        Returns:
            The number of errors in the validation error.
        """
    def errors(
        self, *, include_url: bool = True, include_context: bool = True, include_input: bool = True
    ) -> list[ErrorDetails]:
        """
        Details about each error in the validation error.

        Args:
            include_url: Whether to include a URL to documentation on the error each error.
            include_context: Whether to include the context of each error.
            include_input: Whether to include the input value of each error.

        Returns:
            A list of [`ErrorDetails`][pydantic_core.ErrorDetails] for each error in the validation error.
        """
    def json(
        self,
        *,
        indent: int | None = None,
        include_url: bool = True,
        include_context: bool = True,
        include_input: bool = True,
    ) -> str:
        """
        Same as [`errors()`][pydantic_core.ValidationError.errors] but returns a JSON string.

        Args:
            indent: The number of spaces to indent the JSON by, or `None` for no indentation - compact JSON.
            include_url: Whether to include a URL to documentation on the error each error.
            include_context: Whether to include the context of each error.
            include_input: Whether to include the input value of each error.

        Returns:
            a JSON string.
        """

@final
class PydanticCustomError(ValueError):
    def __new__(
        cls, error_type: LiteralString, message_template: LiteralString, context: dict[str, Any] | None = None
    ) -> Self: ...
    @property
    def context(self) -> dict[str, Any] | None: ...
    @property
    def type(self) -> str: ...
    @property
    def message_template(self) -> str: ...
    def message(self) -> str: ...

@final
class PydanticKnownError(ValueError):
    def __new__(cls, error_type: ErrorType, context: dict[str, Any] | None = None) -> Self: ...
    @property
    def context(self) -> dict[str, Any] | None: ...
    @property
    def type(self) -> ErrorType: ...
    @property
    def message_template(self) -> str: ...
    def message(self) -> str: ...

@final
class PydanticOmit(Exception):
    def __new__(cls) -> Self: ...

@final
class PydanticUseDefault(Exception):
    def __new__(cls) -> Self: ...

@final
class PydanticSerializationError(ValueError):
    def __new__(cls, message: str) -> Self: ...

@final
class PydanticSerializationUnexpectedValue(ValueError):
    def __new__(cls, message: str | None = None) -> Self: ...

@final
class ArgsKwargs:
    def __new__(cls, args: tuple[Any, ...], kwargs: dict[str, Any] | None = None) -> Self: ...
    @property
    def args(self) -> tuple[Any, ...]: ...
    @property
    def kwargs(self) -> dict[str, Any] | None: ...

@final
class PydanticUndefinedType:
    def __copy__(self) -> Self: ...
    def __deepcopy__(self, memo: Any) -> Self: ...

PydanticUndefined: PydanticUndefinedType

def list_all_errors() -> list[ErrorTypeInfo]:
    """
    Get information about all built-in errors.

    Returns:
        A list of `ErrorTypeInfo` typed dicts.
    """
@final
class TzInfo(datetime.tzinfo):
    def tzname(self, _dt: datetime.datetime | None) -> str | None: ...
    def utcoffset(self, _dt: datetime.datetime | None) -> datetime.timedelta: ...
    def dst(self, _dt: datetime.datetime | None) -> datetime.timedelta: ...
    def fromutc(self, dt: datetime.datetime) -> datetime.datetime: ...
    def __deepcopy__(self, _memo: dict[Any, Any]) -> 'TzInfo': ...

def validate_core_schema(schema: CoreSchema, *, strict: bool | None = None) -> CoreSchema:
    """Validate a CoreSchema
    This currently uses lax mode for validation (i.e. will coerce strings to dates and such)
    but may use strict mode in the future.
    We may also remove this function altogether, do not rely on it being present if you are
    using pydantic-core directly.
    """
