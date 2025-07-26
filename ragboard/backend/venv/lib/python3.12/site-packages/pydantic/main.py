"""Logic for creating models."""
from __future__ import annotations as _annotations

import sys
import types
import typing
import warnings
from copy import copy, deepcopy
from typing import Any, ClassVar

import pydantic_core
import typing_extensions
from pydantic_core import PydanticUndefined

from ._internal import (
    _config,
    _decorators,
    _fields,
    _forward_ref,
    _generics,
    _mock_val_ser,
    _model_construction,
    _repr,
    _typing_extra,
    _utils,
)
from ._migration import getattr_migration
from .annotated_handlers import GetCoreSchemaHandler, GetJsonSchemaHandler
from .config import ConfigDict
from .errors import PydanticUndefinedAnnotation, PydanticUserError
from .json_schema import DEFAULT_REF_TEMPLATE, GenerateJsonSchema, JsonSchemaMode, JsonSchemaValue, model_json_schema
from .warnings import PydanticDeprecatedSince20

if typing.TYPE_CHECKING:
    from inspect import Signature
    from pathlib import Path

    from pydantic_core import CoreSchema, SchemaSerializer, SchemaValidator
    from typing_extensions import Literal, Unpack

    from ._internal._utils import AbstractSetIntStr, MappingIntStrAny
    from .deprecated.parse import Protocol as DeprecatedParseProtocol
    from .fields import ComputedFieldInfo, FieldInfo, ModelPrivateAttr
    from .fields import Field as _Field

    TupleGenerator = typing.Generator[typing.Tuple[str, Any], None, None]
    Model = typing.TypeVar('Model', bound='BaseModel')
    # should be `set[int] | set[str] | dict[int, IncEx] | dict[str, IncEx] | None`, but mypy can't cope
    IncEx: typing_extensions.TypeAlias = 'set[int] | set[str] | dict[int, Any] | dict[str, Any] | None'
else:
    # See PyCharm issues https://youtrack.jetbrains.com/issue/PY-21915
    # and https://youtrack.jetbrains.com/issue/PY-51428
    DeprecationWarning = PydanticDeprecatedSince20

__all__ = 'BaseModel', 'create_model'

_object_setattr = _model_construction.object_setattr


class BaseModel(metaclass=_model_construction.ModelMetaclass):
    """Usage docs: https://docs.pydantic.dev/2.5/concepts/models/

    A base class for creating Pydantic models.

    Attributes:
        __class_vars__: The names of classvars defined on the model.
        __private_attributes__: Metadata about the private attributes of the model.
        __signature__: The signature for instantiating the model.

        __pydantic_complete__: Whether model building is completed, or if there are still undefined fields.
        __pydantic_core_schema__: The pydantic-core schema used to build the SchemaValidator and SchemaSerializer.
        __pydantic_custom_init__: Whether the model has a custom `__init__` function.
        __pydantic_decorators__: Metadata containing the decorators defined on the model.
            This replaces `Model.__validators__` and `Model.__root_validators__` from Pydantic V1.
        __pydantic_generic_metadata__: Metadata for generic models; contains data used for a similar purpose to
            __args__, __origin__, __parameters__ in typing-module generics. May eventually be replaced by these.
        __pydantic_parent_namespace__: Parent namespace of the model, used for automatic rebuilding of models.
        __pydantic_post_init__: The name of the post-init method for the model, if defined.
        __pydantic_root_model__: Whether the model is a `RootModel`.
        __pydantic_serializer__: The pydantic-core SchemaSerializer used to dump instances of the model.
        __pydantic_validator__: The pydantic-core SchemaValidator used to validate instances of the model.

        __pydantic_extra__: An instance attribute with the values of extra fields from validation when
            `model_config['extra'] == 'allow'`.
        __pydantic_fields_set__: An instance attribute with the names of fields explicitly set.
        __pydantic_private__: Instance attribute with the values of private attributes set on the model instance.
    """

    if typing.TYPE_CHECKING:
        # Here we provide annotations for the attributes of BaseModel.
        # Many of these are populated by the metaclass, which is why this section is in a `TYPE_CHECKING` block.
        # However, for the sake of easy review, we have included type annotations of all class and instance attributes
        # of `BaseModel` here:

        # Class attributes
        model_config: ClassVar[ConfigDict]
        """
        Configuration for the model, should be a dictionary conforming to [`ConfigDict`][pydantic.config.ConfigDict].
        """

        model_fields: ClassVar[dict[str, FieldInfo]]
        """
        Metadata about the fields defined on the model,
        mapping of field names to [`FieldInfo`][pydantic.fields.FieldInfo].

        This replaces `Model.__fields__` from Pydantic V1.
        """

        __class_vars__: ClassVar[set[str]]
        __private_attributes__: ClassVar[dict[str, ModelPrivateAttr]]
        __signature__: ClassVar[Signature]

        __pydantic_complete__: ClassVar[bool]
        __pydantic_core_schema__: ClassVar[CoreSchema]
        __pydantic_custom_init__: ClassVar[bool]
        __pydantic_decorators__: ClassVar[_decorators.DecoratorInfos]
        __pydantic_generic_metadata__: ClassVar[_generics.PydanticGenericMetadata]
        __pydantic_parent_namespace__: ClassVar[dict[str, Any] | None]
        __pydantic_post_init__: ClassVar[None | Literal['model_post_init']]
        __pydantic_root_model__: ClassVar[bool]
        __pydantic_serializer__: ClassVar[SchemaSerializer]
        __pydantic_validator__: ClassVar[SchemaValidator]

        # Instance attributes
        # Note: we use the non-existent kwarg `init=False` in pydantic.fields.Field below so that @dataclass_transform
        # doesn't think these are valid as keyword arguments to the class initializer.
        __pydantic_extra__: dict[str, Any] | None = _Field(init=False)  # type: ignore
        __pydantic_fields_set__: set[str] = _Field(init=False)  # type: ignore
        __pydantic_private__: dict[str, Any] | None = _Field(init=False)  # type: ignore
    else:
        # `model_fields` and `__pydantic_decorators__` must be set for
        # pydantic._internal._generate_schema.GenerateSchema.model_schema to work for a plain BaseModel annotation
        model_fields = {}
        __pydantic_decorators__ = _decorators.DecoratorInfos()
        # Prevent `BaseModel` from being instantiated directly:
        __pydantic_validator__ = _mock_val_ser.MockValSer(
            'Pydantic models should inherit from BaseModel, BaseModel cannot be instantiated directly',
            val_or_ser='validator',
            code='base-model-instantiated',
        )
        __pydantic_serializer__ = _mock_val_ser.MockValSer(
            'Pydantic models should inherit from BaseModel, BaseModel cannot be instantiated directly',
            val_or_ser='serializer',
            code='base-model-instantiated',
        )

    __slots__ = '__dict__', '__pydantic_fields_set__', '__pydantic_extra__', '__pydantic_private__'

    model_config = ConfigDict()
    __pydantic_complete__ = False
    __pydantic_root_model__ = False

    def __init__(__pydantic_self__, **data: Any) -> None:  # type: ignore
        """Create a new model by parsing and validating input data from keyword arguments.

        Raises [`ValidationError`][pydantic_core.ValidationError] if the input data cannot be
        validated to form a valid model.

        `__init__` uses `__pydantic_self__` instead of the more common `self` for the first arg to
        allow `self` as a field name.
        """
        # `__tracebackhide__` tells pytest and some other tools to omit this function from tracebacks
        __tracebackhide__ = True
        __pydantic_self__.__pydantic_validator__.validate_python(data, self_instance=__pydantic_self__)

    # The following line sets a flag that we use to determine when `__init__` gets overridden by the user
    __init__.__pydantic_base_init__ = True

    @property
    def model_computed_fields(self) -> dict[str, ComputedFieldInfo]:
        """Get the computed fields of this model instance.

        Returns:
            A dictionary of computed field names and their corresponding `ComputedFieldInfo` objects.
        """
        return {k: v.info for k, v in self.__pydantic_decorators__.computed_fields.items()}

    @property
    def model_extra(self) -> dict[str, Any] | None:
        """Get extra fields set during validation.

        Returns:
            A dictionary of extra fields, or `None` if `config.extra` is not set to `"allow"`.
        """
        return self.__pydantic_extra__

    @property
    def model_fields_set(self) -> set[str]:
        """Returns the set of fields that have been explicitly set on this model instance.

        Returns:
            A set of strings representing the fields that have been set,
                i.e. that were not filled from defaults.
        """
        return self.__pydantic_fields_set__

    @classmethod
    def model_construct(cls: type[Model], _fields_set: set[str] | None = None, **values: Any) -> Model:
        """Creates a new instance of the `Model` class with validated data.

        Creates a new model setting `__dict__` and `__pydantic_fields_set__` from trusted or pre-validated data.
        Default values are respected, but no other validation is performed.
        Behaves as if `Config.extra = 'allow'` was set since it adds all passed values

        Args:
            _fields_set: The set of field names accepted for the Model instance.
            values: Trusted or pre-validated data dictionary.

        Returns:
            A new instance of the `Model` class with validated data.
        """
        m = cls.__new__(cls)
        fields_values: dict[str, Any] = {}
        defaults: dict[str, Any] = {}  # keeping this separate from `fields_values` helps us compute `_fields_set`
        for name, field in cls.model_fields.items():
            if field.alias and field.alias in values:
                fields_values[name] = values.pop(field.alias)
            elif name in values:
                fields_values[name] = values.pop(name)
            elif not field.is_required():
                defaults[name] = field.get_default(call_default_factory=True)
        if _fields_set is None:
            _fields_set = set(fields_values.keys())
        fields_values.update(defaults)

        _extra: dict[str, Any] | None = None
        if cls.model_config.get('extra') == 'allow':
            _extra = {}
            for k, v in values.items():
                _extra[k] = v
        else:
            fields_values.update(values)
        _object_setattr(m, '__dict__', fields_values)
        _object_setattr(m, '__pydantic_fields_set__', _fields_set)
        if not cls.__pydantic_root_model__:
            _object_setattr(m, '__pydantic_extra__', _extra)

        if cls.__pydantic_post_init__:
            m.model_post_init(None)
        elif not cls.__pydantic_root_model__:
            # Note: if there are any private attributes, cls.__pydantic_post_init__ would exist
            # Since it doesn't, that means that `__pydantic_private__` should be set to None
            _object_setattr(m, '__pydantic_private__', None)

        return m

    def model_copy(self: Model, *, update: dict[str, Any] | None = None, deep: bool = False) -> Model:
        """Usage docs: https://docs.pydantic.dev/2.5/concepts/serialization/#model_copy

        Returns a copy of the model.

        Args:
            update: Values to change/add in the new model. Note: the data is not validated
                before creating the new model. You should trust this data.
            deep: Set to `True` to make a deep copy of the model.

        Returns:
            New model instance.
        """
        copied = self.__deepcopy__() if deep else self.__copy__()
        if update:
            if self.model_config.get('extra') == 'allow':
                for k, v in update.items():
                    if k in self.model_fields:
                        copied.__dict__[k] = v
                    else:
                        if copied.__pydantic_extra__ is None:
                            copied.__pydantic_extra__ = {}
                        copied.__pydantic_extra__[k] = v
            else:
                copied.__dict__.update(update)
            copied.__pydantic_fields_set__.update(update.keys())
        return copied

    def model_dump(
        self,
        *,
        mode: Literal['json', 'python'] | str = 'python',
        include: IncEx = None,
        exclude: IncEx = None,
        by_alias: bool = False,
        exclude_unset: bool = False,
        exclude_defaults: bool = False,
        exclude_none: bool = False,
        round_trip: bool = False,
        warnings: bool = True,
    ) -> dict[str, Any]:
        """Usage docs: https://docs.pydantic.dev/2.5/concepts/serialization/#modelmodel_dump

        Generate a dictionary representation of the model, optionally specifying which fields to include or exclude.

        Args:
            mode: The mode in which `to_python` should run.
                If mode is 'json', the dictionary will only contain JSON serializable types.
                If mode is 'python', the dictionary may contain any Python objects.
            include: A list of fields to include in the output.
            exclude: A list of fields to exclude from the output.
            by_alias: Whether to use the field's alias in the dictionary key if defined.
            exclude_unset: Whether to exclude fields that have not been explicitly set.
            exclude_defaults: Whether to exclude fields that are set to their default value from the output.
            exclude_none: Whether to exclude fields that have a value of `None` from the output.
            round_trip: Whether to enable serialization and deserialization round-trip support.
            warnings: Whether to log warnings when invalid fields are encountered.

        Returns:
            A dictionary representation of the model.
        """
        return self.__pydantic_serializer__.to_python(
            self,
            mode=mode,
            by_alias=by_alias,
            include=include,
            exclude=exclude,
            exclude_unset=exclude_unset,
            exclude_defaults=exclude_defaults,
            exclude_none=exclude_none,
            round_trip=round_trip,
            warnings=warnings,
        )

    def model_dump_json(
        self,
        *,
        indent: int | None = None,
        include: IncEx = None,
        exclude: IncEx = None,
        by_alias: bool = False,
        exclude_unset: bool = False,
        exclude_defaults: bool = False,
        exclude_none: bool = False,
        round_trip: bool = False,
        warnings: bool = True,
    ) -> str:
        """Usage docs: https://docs.pydantic.dev/2.5/concepts/serialization/#modelmodel_dump_json

        Generates a JSON representation of the model using Pydantic's `to_json` method.

        Args:
            indent: Indentation to use in the JSON output. If None is passed, the output will be compact.
            include: Field(s) to include in the JSON output. Can take either a string or set of strings.
            exclude: Field(s) to exclude from the JSON output. Can take either a string or set of strings.
            by_alias: Whether to serialize using field aliases.
            exclude_unset: Whether to exclude fields that have not been explicitly set.
            exclude_defaults: Whether to exclude fields that have the default value.
            exclude_none: Whether to exclude fields that have a value of `None`.
            round_trip: Whether to use serialization/deserialization between JSON and class instance.
            warnings: Whether to show any warnings that occurred during serialization.

        Returns:
            A JSON string representation of the model.
        """
        return self.__pydantic_serializer__.to_json(
            self,
            indent=indent,
            include=include,
            exclude=exclude,
            by_alias=by_alias,
            exclude_unset=exclude_unset,
            exclude_defaults=exclude_defaults,
            exclude_none=exclude_none,
            round_trip=round_trip,
            warnings=warnings,
        ).decode()

    @classmethod
    def model_json_schema(
        cls,
        by_alias: bool = True,
        ref_template: str = DEFAULT_REF_TEMPLATE,
        schema_generator: type[GenerateJsonSchema] = GenerateJsonSchema,
        mode: JsonSchemaMode = 'validation',
    ) -> dict[str, Any]:
        """Generates a JSON schema for a model class.

        Args:
            by_alias: Whether to use attribute aliases or not.
            ref_template: The reference template.
            schema_generator: To override the logic used to generate the JSON schema, as a subclass of
                `GenerateJsonSchema` with your desired modifications
            mode: The mode in which to generate the schema.

        Returns:
            The JSON schema for the given model class.
        """
        return model_json_schema(
            cls, by_alias=by_alias, ref_template=ref_template, schema_generator=schema_generator, mode=mode
        )

    @classmethod
    def model_parametrized_name(cls, params: tuple[type[Any], ...]) -> str:
        """Compute the class name for parametrizations of generic classes.

        This method can be overridden to achieve a custom naming scheme for generic BaseModels.

        Args:
            params: Tuple of types of the class. Given a generic class
                `Model` with 2 type variables and a concrete model `Model[str, int]`,
                the value `(str, int)` would be passed to `params`.

        Returns:
            String representing the new class where `params` are passed to `cls` as type variables.

        Raises:
            TypeError: Raised when trying to generate concrete names for non-generic models.
        """
        if not issubclass(cls, typing.Generic):
            raise TypeError('Concrete names should only be generated for generic models.')

        # Any strings received should represent forward references, so we handle them specially below.
        # If we eventually move toward wrapping them in a ForwardRef in __class_getitem__ in the future,
        # we may be able to remove this special case.
        param_names = [param if isinstance(param, str) else _repr.display_as_type(param) for param in params]
        params_component = ', '.join(param_names)
        return f'{cls.__name__}[{params_component}]'

    def model_post_init(self, __context: Any) -> None:
        """Override this method to perform additional initialization after `__init__` and `model_construct`.
        This is useful if you want to do some validation that requires the entire model to be initialized.
        """
        pass

    @classmethod
    def model_rebuild(
        cls,
        *,
        force: bool = False,
        raise_errors: bool = True,
        _parent_namespace_depth: int = 2,
        _types_namespace: dict[str, Any] | None = None,
    ) -> bool | None:
        """Try to rebuild the pydantic-core schema for the model.

        This may be necessary when one of the annotations is a ForwardRef which could not be resolved during
        the initial attempt to build the schema, and automatic rebuilding fails.

        Args:
            force: Whether to force the rebuilding of the model schema, defaults to `False`.
            raise_errors: Whether to raise errors, defaults to `True`.
            _parent_namespace_depth: The depth level of the parent namespace, defaults to 2.
            _types_namespace: The types namespace, defaults to `None`.

        Returns:
            Returns `None` if the schema is already "complete" and rebuilding was not required.
            If rebuilding _was_ required, returns `True` if rebuilding was successful, otherwise `False`.
        """
        if not force and cls.__pydantic_complete__:
            return None
        else:
            if '__pydantic_core_schema__' in cls.__dict__:
                delattr(cls, '__pydantic_core_schema__')  # delete cached value to ensure full rebuild happens
            if _types_namespace is not None:
                types_namespace: dict[str, Any] | None = _types_namespace.copy()
            else:
                if _parent_namespace_depth > 0:
                    frame_parent_ns = _typing_extra.parent_frame_namespace(parent_depth=_parent_namespace_depth) or {}
                    cls_parent_ns = (
                        _model_construction.unpack_lenient_weakvaluedict(cls.__pydantic_parent_namespace__) or {}
                    )
                    types_namespace = {**cls_parent_ns, **frame_parent_ns}
                    cls.__pydantic_parent_namespace__ = _model_construction.build_lenient_weakvaluedict(types_namespace)
                else:
                    types_namespace = _model_construction.unpack_lenient_weakvaluedict(
                        cls.__pydantic_parent_namespace__
                    )

                types_namespace = _typing_extra.get_cls_types_namespace(cls, types_namespace)

            # manually override defer_build so complete_model_class doesn't skip building the model again
            config = {**cls.model_config, 'defer_build': False}
            return _model_construction.complete_model_class(
                cls,
                cls.__name__,
                _config.ConfigWrapper(config, check=False),
                raise_errors=raise_errors,
                types_namespace=types_namespace,
            )

    @classmethod
    def model_validate(
        cls: type[Model],
        obj: Any,
        *,
        strict: bool | None = None,
        from_attributes: bool | None = None,
        context: dict[str, Any] | None = None,
    ) -> Model:
        """Validate a pydantic model instance.

        Args:
            obj: The object to validate.
            strict: Whether to raise an exception on invalid fields.
            from_attributes: Whether to extract data from object attributes.
            context: Additional context to pass to the validator.

        Raises:
            ValidationError: If the object could not be validated.

        Returns:
            The validated model instance.
        """
        # `__tracebackhide__` tells pytest and some other tools to omit this function from tracebacks
        __tracebackhide__ = True
        return cls.__pydantic_validator__.validate_python(
            obj, strict=strict, from_attributes=from_attributes, context=context
        )

    @classmethod
    def model_validate_json(
        cls: type[Model],
        json_data: str | bytes | bytearray,
        *,
        strict: bool | None = None,
        context: dict[str, Any] | None = None,
    ) -> Model:
        """Usage docs: https://docs.pydantic.dev/2.5/concepts/json/#json-parsing

        Validate the given JSON data against the Pydantic model.

        Args:
            json_data: The JSON data to validate.
            strict: Whether to enforce types strictly.
            context: Extra variables to pass to the validator.

        Returns:
            The validated Pydantic model.

        Raises:
            ValueError: If `json_data` is not a JSON string.
        """
        # `__tracebackhide__` tells pytest and some other tools to omit this function from tracebacks
        __tracebackhide__ = True
        return cls.__pydantic_validator__.validate_json(json_data, strict=strict, context=context)

    @classmethod
    def model_validate_strings(
        cls: type[Model],
        obj: Any,
        *,
        strict: bool | None = None,
        context: dict[str, Any] | None = None,
    ) -> Model:
        """Validate the given object contains string data against the Pydantic model.

        Args:
            obj: The object contains string data to validate.
            strict: Whether to enforce types strictly.
            context: Extra variables to pass to the validator.

        Returns:
            The validated Pydantic model.
        """
        # `__tracebackhide__` tells pytest and some other tools to omit this function from tracebacks
        __tracebackhide__ = True
        return cls.__pydantic_validator__.validate_strings(obj, strict=strict, context=context)

    @classmethod
    def __get_pydantic_core_schema__(cls, __source: type[BaseModel], __handler: GetCoreSchemaHandler) -> CoreSchema:
        """Hook into generating the model's CoreSchema.

        Args:
            __source: The class we are generating a schema for.
                This will generally be the same as the `cls` argument if this is a classmethod.
            __handler: Call into Pydantic's internal JSON schema generation.
                A callable that calls into Pydantic's internal CoreSchema generation logic.

        Returns:
            A `pydantic-core` `CoreSchema`.
        """
        # Only use the cached value from this _exact_ class; we don't want one from a parent class
        # This is why we check `cls.__dict__` and don't use `cls.__pydantic_core_schema__` or similar.
        if '__pydantic_core_schema__' in cls.__dict__:
            # Due to the way generic classes are built, it's possible that an invalid schema may be temporarily
            # set on generic classes. I think we could resolve this to ensure that we get proper schema caching
            # for generics, but for simplicity for now, we just always rebuild if the class has a generic origin.
            if not cls.__pydantic_generic_metadata__['origin']:
                return cls.__pydantic_core_schema__

        return __handler(__source)

    @classmethod
    def __get_pydantic_json_schema__(
        cls,
        __core_schema: CoreSchema,
        __handler: GetJsonSchemaHandler,
    ) -> JsonSchemaValue:
        """Hook into generating the model's JSON schema.

        Args:
            __core_schema: A `pydantic-core` CoreSchema.
                You can ignore this argument and call the handler with a new CoreSchema,
                wrap this CoreSchema (`{'type': 'nullable', 'schema': current_schema}`),
                or just call the handler with the original schema.
            __handler: Call into Pydantic's internal JSON schema generation.
                This will raise a `pydantic.errors.PydanticInvalidForJsonSchema` if JSON schema
                generation fails.
                Since this gets called by `BaseModel.model_json_schema` you can override the
                `schema_generator` argument to that function to change JSON schema generation globally
                for a type.

        Returns:
            A JSON schema, as a Python object.
        """
        return __handler(__core_schema)

    @classmethod
    def __pydantic_init_subclass__(cls, **kwargs: Any) -> None:
        """This is intended to behave just like `__init_subclass__`, but is called by `ModelMetaclass`
        only after the class is actually fully initialized. In particular, attributes like `model_fields` will
        be present when this is called.

        This is necessary because `__init_subclass__` will always be called by `type.__new__`,
        and it would require a prohibitively large refactor to the `ModelMetaclass` to ensure that
        `type.__new__` was called in such a manner that the class would already be sufficiently initialized.

        This will receive the same `kwargs` that would be passed to the standard `__init_subclass__`, namely,
        any kwargs passed to the class definition that aren't used internally by pydantic.

        Args:
            **kwargs: Any keyword arguments passed to the class definition that aren't used internally
                by pydantic.
        """
        pass

    def __class_getitem__(
        cls, typevar_values: type[Any] | tuple[type[Any], ...]
    ) -> type[BaseModel] | _forward_ref.PydanticRecursiveRef:
        cached = _generics.get_cached_generic_type_early(cls, typevar_values)
        if cached is not None:
            return cached

        if cls is BaseModel:
            raise TypeError('Type parameters should be placed on typing.Generic, not BaseModel')
        if not hasattr(cls, '__parameters__'):
            raise TypeError(f'{cls} cannot be parametrized because it does not inherit from typing.Generic')
        if not cls.__pydantic_generic_metadata__['parameters'] and typing.Generic not in cls.__bases__:
            raise TypeError(f'{cls} is not a generic class')

        if not isinstance(typevar_values, tuple):
            typevar_values = (typevar_values,)
        _generics.check_parameters_count(cls, typevar_values)

        # Build map from generic typevars to passed params
        typevars_map: dict[_typing_extra.TypeVarType, type[Any]] = dict(
            zip(cls.__pydantic_generic_metadata__['parameters'], typevar_values)
        )

        if _utils.all_identical(typevars_map.keys(), typevars_map.values()) and typevars_map:
            submodel = cls  # if arguments are equal to parameters it's the same object
            _generics.set_cached_generic_type(cls, typevar_values, submodel)
        else:
            parent_args = cls.__pydantic_generic_metadata__['args']
            if not parent_args:
                args = typevar_values
            else:
                args = tuple(_generics.replace_types(arg, typevars_map) for arg in parent_args)

            origin = cls.__pydantic_generic_metadata__['origin'] or cls
            model_name = origin.model_parametrized_name(args)
            params = tuple(
                {param: None for param in _generics.iter_contained_typevars(typevars_map.values())}
            )  # use dict as ordered set

            with _generics.generic_recursion_self_type(origin, args) as maybe_self_type:
                if maybe_self_type is not None:
                    return maybe_self_type

                cached = _generics.get_cached_generic_type_late(cls, typevar_values, origin, args)
                if cached is not None:
                    return cached

                # Attempt to rebuild the origin in case new types have been defined
                try:
                    # depth 3 gets you above this __class_getitem__ call
                    origin.model_rebuild(_parent_namespace_depth=3)
                except PydanticUndefinedAnnotation:
                    # It's okay if it fails, it just means there are still undefined types
                    # that could be evaluated later.
                    # TODO: Make sure validation fails if there are still undefined types, perhaps using MockValidator
                    pass

                submodel = _generics.create_generic_submodel(model_name, origin, args, params)

                # Update cache
                _generics.set_cached_generic_type(cls, typevar_values, submodel, origin, args)

        return submodel

    def __copy__(self: Model) -> Model:
        """Returns a shallow copy of the model."""
        cls = type(self)
        m = cls.__new__(cls)
        _object_setattr(m, '__dict__', copy(self.__dict__))
        _object_setattr(m, '__pydantic_extra__', copy(self.__pydantic_extra__))
        _object_setattr(m, '__pydantic_fields_set__', copy(self.__pydantic_fields_set__))

        if self.__pydantic_private__ is None:
            _object_setattr(m, '__pydantic_private__', None)
        else:
            _object_setattr(
                m,
                '__pydantic_private__',
                {k: v for k, v in self.__pydantic_private__.items() if v is not PydanticUndefined},
            )

        return m

    def __deepcopy__(self: Model, memo: dict[int, Any] | None = None) -> Model:
        """Returns a deep copy of the model."""
        cls = type(self)
        m = cls.__new__(cls)
        _object_setattr(m, '__dict__', deepcopy(self.__dict__, memo=memo))
        _object_setattr(m, '__pydantic_extra__', deepcopy(self.__pydantic_extra__, memo=memo))
        # This next line doesn't need a deepcopy because __pydantic_fields_set__ is a set[str],
        # and attempting a deepcopy would be marginally slower.
        _object_setattr(m, '__pydantic_fields_set__', copy(self.__pydantic_fields_set__))

        if self.__pydantic_private__ is None:
            _object_setattr(m, '__pydantic_private__', None)
        else:
            _object_setattr(
                m,
                '__pydantic_private__',
                deepcopy({k: v for k, v in self.__pydantic_private__.items() if v is not PydanticUndefined}, memo=memo),
            )

        return m

    if not typing.TYPE_CHECKING:
        # We put `__getattr__` in a non-TYPE_CHECKING block because otherwise, mypy allows arbitrary attribute access

        def __getattr__(self, item: str) -> Any:
            private_attributes = object.__getattribute__(self, '__private_attributes__')
            if item in private_attributes:
                attribute = private_attributes[item]
                if hasattr(attribute, '__get__'):
                    return attribute.__get__(self, type(self))  # type: ignore

                try:
                    # Note: self.__pydantic_private__ cannot be None if self.__private_attributes__ has items
                    return self.__pydantic_private__[item]  # type: ignore
                except KeyError as exc:
                    raise AttributeError(f'{type(self).__name__!r} object has no attribute {item!r}') from exc
            else:
                # `__pydantic_extra__` can fail to be set if the model is not yet fully initialized.
                # See `BaseModel.__repr_args__` for more details
                try:
                    pydantic_extra = object.__getattribute__(self, '__pydantic_extra__')
                except AttributeError:
                    pydantic_extra = None

                if pydantic_extra is not None:
                    try:
                        return pydantic_extra[item]
                    except KeyError as exc:
                        raise AttributeError(f'{type(self).__name__!r} object has no attribute {item!r}') from exc
                else:
                    if hasattr(self.__class__, item):
                        return super().__getattribute__(item)  # Raises AttributeError if appropriate
                    else:
                        # this is the current error
                        raise AttributeError(f'{type(self).__name__!r} object has no attribute {item!r}')

    def __setattr__(self, name: str, value: Any) -> None:
        if name in self.__class_vars__:
            raise AttributeError(
                f'{name!r} is a ClassVar of `{self.__class__.__name__}` and cannot be set on an instance. '
                f'If you want to set a value on the class, use `{self.__class__.__name__}.{name} = value`.'
            )
        elif not _fields.is_valid_field_name(name):
            if self.__pydantic_private__ is None or name not in self.__private_attributes__:
                _object_setattr(self, name, value)
            else:
                attribute = self.__private_attributes__[name]
                if hasattr(attribute, '__set__'):
                    attribute.__set__(self, value)  # type: ignore
                else:
                    self.__pydantic_private__[name] = value
            return

        self._check_frozen(name, value)

        attr = getattr(self.__class__, name, None)
        if isinstance(attr, property):
            attr.__set__(self, value)
        elif self.model_config.get('validate_assignment', None):
            self.__pydantic_validator__.validate_assignment(self, name, value)
        elif self.model_config.get('extra') != 'allow' and name not in self.model_fields:
            # TODO - matching error
            raise ValueError(f'"{self.__class__.__name__}" object has no field "{name}"')
        elif self.model_config.get('extra') == 'allow' and name not in self.model_fields:
            if self.model_extra and name in self.model_extra:
                self.__pydantic_extra__[name] = value  # type: ignore
            else:
                try:
                    getattr(self, name)
                except AttributeError:
                    # attribute does not already exist on instance, so put it in extra
                    self.__pydantic_extra__[name] = value  # type: ignore
                else:
                    # attribute _does_ already exist on instance, and was not in extra, so update it
                    _object_setattr(self, name, value)
        else:
            self.__dict__[name] = value
            self.__pydantic_fields_set__.add(name)

    def __delattr__(self, item: str) -> Any:
        if item in self.__private_attributes__:
            attribute = self.__private_attributes__[item]
            if hasattr(attribute, '__delete__'):
                attribute.__delete__(self)  # type: ignore
                return

            try:
                # Note: self.__pydantic_private__ cannot be None if self.__private_attributes__ has items
                del self.__pydantic_private__[item]  # type: ignore
                return
            except KeyError as exc:
                raise AttributeError(f'{type(self).__name__!r} object has no attribute {item!r}') from exc

        self._check_frozen(item, None)

        if item in self.model_fields:
            object.__delattr__(self, item)
        elif self.__pydantic_extra__ is not None and item in self.__pydantic_extra__:
            del self.__pydantic_extra__[item]
        else:
            try:
                object.__delattr__(self, item)
            except AttributeError:
                raise AttributeError(f'{type(self).__name__!r} object has no attribute {item!r}')

    def _check_frozen(self, name: str, value: Any) -> None:
        if self.model_config.get('frozen', None):
            typ = 'frozen_instance'
        elif getattr(self.model_fields.get(name), 'frozen', False):
            typ = 'frozen_field'
        else:
            return
        error: pydantic_core.InitErrorDetails = {
            'type': typ,
            'loc': (name,),
            'input': value,
        }
        raise pydantic_core.ValidationError.from_exception_data(self.__class__.__name__, [error])

    def __getstate__(self) -> dict[Any, Any]:
        private = self.__pydantic_private__
        if private:
            private = {k: v for k, v in private.items() if v is not PydanticUndefined}
        return {
            '__dict__': self.__dict__,
            '__pydantic_extra__': self.__pydantic_extra__,
            '__pydantic_fields_set__': self.__pydantic_fields_set__,
            '__pydantic_private__': private,
        }

    def __setstate__(self, state: dict[Any, Any]) -> None:
        _object_setattr(self, '__pydantic_fields_set__', state['__pydantic_fields_set__'])
        _object_setattr(self, '__pydantic_extra__', state['__pydantic_extra__'])
        _object_setattr(self, '__pydantic_private__', state['__pydantic_private__'])
        _object_setattr(self, '__dict__', state['__dict__'])

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, BaseModel):
            # When comparing instances of generic types for equality, as long as all field values are equal,
            # only require their generic origin types to be equal, rather than exact type equality.
            # This prevents headaches like MyGeneric(x=1) != MyGeneric[Any](x=1).
            self_type = self.__pydantic_generic_metadata__['origin'] or self.__class__
            other_type = other.__pydantic_generic_metadata__['origin'] or other.__class__

            return (
                self_type == other_type
                and self.__dict__ == other.__dict__
                and self.__pydantic_private__ == other.__pydantic_private__
                and self.__pydantic_extra__ == other.__pydantic_extra__
            )
        else:
            return NotImplemented  # delegate to the other item in the comparison

    if typing.TYPE_CHECKING:
        # We put `__init_subclass__` in a TYPE_CHECKING block because, even though we want the type-checking benefits
        # described in the signature of `__init_subclass__` below, we don't want to modify the default behavior of
        # subclass initialization.

        def __init_subclass__(cls, **kwargs: Unpack[ConfigDict]):
            """This signature is included purely to help type-checkers check arguments to class declaration, which
            provides a way to conveniently set model_config key/value pairs.

            ```py
            from pydantic import BaseModel

            class MyModel(BaseModel, extra='allow'):
                ...
            ```

            However, this may be deceiving, since the _actual_ calls to `__init_subclass__` will not receive any
            of the config arguments, and will only receive any keyword arguments passed during class initialization
            that are _not_ expected keys in ConfigDict. (This is due to the way `ModelMetaclass.__new__` works.)

            Args:
                **kwargs: Keyword arguments passed to the class definition, which set model_config

            Note:
                You may want to override `__pydantic_init_subclass__` instead, which behaves similarly but is called
                *after* the class is fully initialized.
            """

    def __iter__(self) -> TupleGenerator:
        """So `dict(model)` works."""
        yield from [(k, v) for (k, v) in self.__dict__.items() if not k.startswith('_')]
        extra = self.__pydantic_extra__
        if extra:
            yield from extra.items()

    def __repr__(self) -> str:
        return f'{self.__repr_name__()}({self.__repr_str__(", ")})'

    def __repr_args__(self) -> _repr.ReprArgs:
        for k, v in self.__dict__.items():
            field = self.model_fields.get(k)
            if field and field.repr:
                yield k, v

        # `__pydantic_extra__` can fail to be set if the model is not yet fully initialized.
        # This can happen if a `ValidationError` is raised during initialization and the instance's
        # repr is generated as part of the exception handling. Therefore, we use `getattr` here
        # with a fallback, even though the type hints indicate the attribute will always be present.
        try:
            pydantic_extra = object.__getattribute__(self, '__pydantic_extra__')
        except AttributeError:
            pydantic_extra = None

        if pydantic_extra is not None:
            yield from ((k, v) for k, v in pydantic_extra.items())
        yield from ((k, getattr(self, k)) for k, v in self.model_computed_fields.items() if v.repr)

    # take logic from `_repr.Representation` without the side effects of inheritance, see #5740
    __repr_name__ = _repr.Representation.__repr_name__
    __repr_str__ = _repr.Representation.__repr_str__
    __pretty__ = _repr.Representation.__pretty__
    __rich_repr__ = _repr.Representation.__rich_repr__

    def __str__(self) -> str:
        return self.__repr_str__(' ')

    # ##### Deprecated methods from v1 #####
    @property
    @typing_extensions.deprecated(
        'The `__fields__` attribute is deprecated, use `model_fields` instead.', category=PydanticDeprecatedSince20
    )
    def __fields__(self) -> dict[str, FieldInfo]:
        warnings.warn('The `__fields__` attribute is deprecated, use `model_fields` instead.', DeprecationWarning)
        return self.model_fields

    @property
    @typing_extensions.deprecated(
        'The `__fields_set__` attribute is deprecated, use `model_fields_set` instead.',
        category=PydanticDeprecatedSince20,
    )
    def __fields_set__(self) -> set[str]:
        warnings.warn(
            'The `__fields_set__` attribute is deprecated, use `model_fields_set` instead.', DeprecationWarning
        )
        return self.__pydantic_fields_set__

    @typing_extensions.deprecated(
        'The `dict` method is deprecated; use `model_dump` instead.', category=PydanticDeprecatedSince20
    )
    def dict(  # noqa: D102
        self,
        *,
        include: IncEx = None,
        exclude: IncEx = None,
        by_alias: bool = False,
        exclude_unset: bool = False,
        exclude_defaults: bool = False,
        exclude_none: bool = False,
    ) -> typing.Dict[str, Any]:  # noqa UP006
        warnings.warn('The `dict` method is deprecated; use `model_dump` instead.', DeprecationWarning)
        return self.model_dump(
            include=include,
            exclude=exclude,
            by_alias=by_alias,
            exclude_unset=exclude_unset,
            exclude_defaults=exclude_defaults,
            exclude_none=exclude_none,
        )

    @typing_extensions.deprecated(
        'The `json` method is deprecated; use `model_dump_json` instead.', category=PydanticDeprecatedSince20
    )
    def json(  # noqa: D102
        self,
        *,
        include: IncEx = None,
        exclude: IncEx = None,
        by_alias: bool = False,
        exclude_unset: bool = False,
        exclude_defaults: bool = False,
        exclude_none: bool = False,
        encoder: typing.Callable[[Any], Any] | None = PydanticUndefined,  # type: ignore[assignment]
        models_as_dict: bool = PydanticUndefined,  # type: ignore[assignment]
        **dumps_kwargs: Any,
    ) -> str:
        warnings.warn('The `json` method is deprecated; use `model_dump_json` instead.', DeprecationWarning)
        if encoder is not PydanticUndefined:
            raise TypeError('The `encoder` argument is no longer supported; use field serializers instead.')
        if models_as_dict is not PydanticUndefined:
            raise TypeError('The `models_as_dict` argument is no longer supported; use a model serializer instead.')
        if dumps_kwargs:
            raise TypeError('`dumps_kwargs` keyword arguments are no longer supported.')
        return self.model_dump_json(
            include=include,
            exclude=exclude,
            by_alias=by_alias,
            exclude_unset=exclude_unset,
            exclude_defaults=exclude_defaults,
            exclude_none=exclude_none,
        )

    @classmethod
    @typing_extensions.deprecated(
        'The `parse_obj` method is deprecated; use `model_validate` instead.', category=PydanticDeprecatedSince20
    )
    def parse_obj(cls: type[Model], obj: Any) -> Model:  # noqa: D102
        warnings.warn('The `parse_obj` method is deprecated; use `model_validate` instead.', DeprecationWarning)
        return cls.model_validate(obj)

    @classmethod
    @typing_extensions.deprecated(
        'The `parse_raw` method is deprecated; if your data is JSON use `model_validate_json`, '
        'otherwise load the data then use `model_validate` instead.',
        category=PydanticDeprecatedSince20,
    )
    def parse_raw(  # noqa: D102
        cls: type[Model],
        b: str | bytes,
        *,
        content_type: str | None = None,
        encoding: str = 'utf8',
        proto: DeprecatedParseProtocol | None = None,
        allow_pickle: bool = False,
    ) -> Model:  # pragma: no cover
        warnings.warn(
            'The `parse_raw` method is deprecated; if your data is JSON use `model_validate_json`, '
            'otherwise load the data then use `model_validate` instead.',
            DeprecationWarning,
        )
        from .deprecated import parse

        try:
            obj = parse.load_str_bytes(
                b,
                proto=proto,
                content_type=content_type,
                encoding=encoding,
                allow_pickle=allow_pickle,
            )
        except (ValueError, TypeError) as exc:
            import json

            # try to match V1
            if isinstance(exc, UnicodeDecodeError):
                type_str = 'value_error.unicodedecode'
            elif isinstance(exc, json.JSONDecodeError):
                type_str = 'value_error.jsondecode'
            elif isinstance(exc, ValueError):
                type_str = 'value_error'
            else:
                type_str = 'type_error'

            # ctx is missing here, but since we've added `input` to the error, we're not pretending it's the same
            error: pydantic_core.InitErrorDetails = {
                # The type: ignore on the next line is to ignore the requirement of LiteralString
                'type': pydantic_core.PydanticCustomError(type_str, str(exc)),  # type: ignore
                'loc': ('__root__',),
                'input': b,
            }
            raise pydantic_core.ValidationError.from_exception_data(cls.__name__, [error])
        return cls.model_validate(obj)

    @classmethod
    @typing_extensions.deprecated(
        'The `parse_file` method is deprecated; load the data from file, then if your data is JSON '
        'use `model_validate_json`, otherwise `model_validate` instead.',
        category=PydanticDeprecatedSince20,
    )
    def parse_file(  # noqa: D102
        cls: type[Model],
        path: str | Path,
        *,
        content_type: str | None = None,
        encoding: str = 'utf8',
        proto: DeprecatedParseProtocol | None = None,
        allow_pickle: bool = False,
    ) -> Model:
        warnings.warn(
            'The `parse_file` method is deprecated; load the data from file, then if your data is JSON '
            'use `model_validate_json` otherwise `model_validate` instead.',
            DeprecationWarning,
        )
        from .deprecated import parse

        obj = parse.load_file(
            path,
            proto=proto,
            content_type=content_type,
            encoding=encoding,
            allow_pickle=allow_pickle,
        )
        return cls.parse_obj(obj)

    @classmethod
    @typing_extensions.deprecated(
        'The `from_orm` method is deprecated; set '
        "`model_config['from_attributes']=True` and use `model_validate` instead.",
        category=PydanticDeprecatedSince20,
    )
    def from_orm(cls: type[Model], obj: Any) -> Model:  # noqa: D102
        warnings.warn(
            'The `from_orm` method is deprecated; set `model_config["from_attributes"]=True` '
            'and use `model_validate` instead.',
            DeprecationWarning,
        )
        if not cls.model_config.get('from_attributes', None):
            raise PydanticUserError(
                'You must set the config attribute `from_attributes=True` to use from_orm', code=None
            )
        return cls.model_validate(obj)

    @classmethod
    @typing_extensions.deprecated(
        'The `construct` method is deprecated; use `model_construct` instead.', category=PydanticDeprecatedSince20
    )
    def construct(cls: type[Model], _fields_set: set[str] | None = None, **values: Any) -> Model:  # noqa: D102
        warnings.warn('The `construct` method is deprecated; use `model_construct` instead.', DeprecationWarning)
        return cls.model_construct(_fields_set=_fields_set, **values)

    @typing_extensions.deprecated(
        'The copy method is deprecated; use `model_copy` instead.', category=PydanticDeprecatedSince20
    )
    def copy(
        self: Model,
        *,
        include: AbstractSetIntStr | MappingIntStrAny | None = None,
        exclude: AbstractSetIntStr | MappingIntStrAny | None = None,
        update: typing.Dict[str, Any] | None = None,  # noqa UP006
        deep: bool = False,
    ) -> Model:  # pragma: no cover
        """Returns a copy of the model.

        !!! warning "Deprecated"
            This method is now deprecated; use `model_copy` instead.

        If you need `include` or `exclude`, use:

        ```py
        data = self.model_dump(include=include, exclude=exclude, round_trip=True)
        data = {**data, **(update or {})}
        copied = self.model_validate(data)
        ```

        Args:
            include: Optional set or mapping
                specifying which fields to include in the copied model.
            exclude: Optional set or mapping
                specifying which fields to exclude in the copied model.
            update: Optional dictionary of field-value pairs to override field values
                in the copied model.
            deep: If True, the values of fields that are Pydantic models will be deep copied.

        Returns:
            A copy of the model with included, excluded and updated fields as specified.
        """
        warnings.warn(
            'The `copy` method is deprecated; use `model_copy` instead. '
            'See the docstring of `BaseModel.copy` for details about how to handle `include` and `exclude`.',
            DeprecationWarning,
        )
        from .deprecated import copy_internals

        values = dict(
            copy_internals._iter(
                self, to_dict=False, by_alias=False, include=include, exclude=exclude, exclude_unset=False
            ),
            **(update or {}),
        )
        if self.__pydantic_private__ is None:
            private = None
        else:
            private = {k: v for k, v in self.__pydantic_private__.items() if v is not PydanticUndefined}

        if self.__pydantic_extra__ is None:
            extra: dict[str, Any] | None = None
        else:
            extra = self.__pydantic_extra__.copy()
            for k in list(self.__pydantic_extra__):
                if k not in values:  # k was in the exclude
                    extra.pop(k)
            for k in list(values):
                if k in self.__pydantic_extra__:  # k must have come from extra
                    extra[k] = values.pop(k)

        # new `__pydantic_fields_set__` can have unset optional fields with a set value in `update` kwarg
        if update:
            fields_set = self.__pydantic_fields_set__ | update.keys()
        else:
            fields_set = set(self.__pydantic_fields_set__)

        # removing excluded fields from `__pydantic_fields_set__`
        if exclude:
            fields_set -= set(exclude)

        return copy_internals._copy_and_set_values(self, values, fields_set, extra, private, deep=deep)

    @classmethod
    @typing_extensions.deprecated(
        'The `schema` method is deprecated; use `model_json_schema` instead.', category=PydanticDeprecatedSince20
    )
    def schema(  # noqa: D102
        cls, by_alias: bool = True, ref_template: str = DEFAULT_REF_TEMPLATE
    ) -> typing.Dict[str, Any]:  # noqa UP006
        warnings.warn('The `schema` method is deprecated; use `model_json_schema` instead.', DeprecationWarning)
        return cls.model_json_schema(by_alias=by_alias, ref_template=ref_template)

    @classmethod
    @typing_extensions.deprecated(
        'The `schema_json` method is deprecated; use `model_json_schema` and json.dumps instead.',
        category=PydanticDeprecatedSince20,
    )
    def schema_json(  # noqa: D102
        cls, *, by_alias: bool = True, ref_template: str = DEFAULT_REF_TEMPLATE, **dumps_kwargs: Any
    ) -> str:  # pragma: no cover
        import json

        warnings.warn(
            'The `schema_json` method is deprecated; use `model_json_schema` and json.dumps instead.',
            DeprecationWarning,
        )
        from .deprecated.json import pydantic_encoder

        return json.dumps(
            cls.model_json_schema(by_alias=by_alias, ref_template=ref_template),
            default=pydantic_encoder,
            **dumps_kwargs,
        )

    @classmethod
    @typing_extensions.deprecated(
        'The `validate` method is deprecated; use `model_validate` instead.', category=PydanticDeprecatedSince20
    )
    def validate(cls: type[Model], value: Any) -> Model:  # noqa: D102
        warnings.warn('The `validate` method is deprecated; use `model_validate` instead.', DeprecationWarning)
        return cls.model_validate(value)

    @classmethod
    @typing_extensions.deprecated(
        'The `update_forward_refs` method is deprecated; use `model_rebuild` instead.',
        category=PydanticDeprecatedSince20,
    )
    def update_forward_refs(cls, **localns: Any) -> None:  # noqa: D102
        warnings.warn(
            'The `update_forward_refs` method is deprecated; use `model_rebuild` instead.', DeprecationWarning
        )
        if localns:  # pragma: no cover
            raise TypeError('`localns` arguments are not longer accepted.')
        cls.model_rebuild(force=True)

    @typing_extensions.deprecated(
        'The private method `_iter` will be removed and should no longer be used.', category=PydanticDeprecatedSince20
    )
    def _iter(self, *args: Any, **kwargs: Any) -> Any:
        warnings.warn('The private method `_iter` will be removed and should no longer be used.', DeprecationWarning)

        from .deprecated import copy_internals

        return copy_internals._iter(self, *args, **kwargs)

    @typing_extensions.deprecated(
        'The private method `_copy_and_set_values` will be removed and should no longer be used.',
        category=PydanticDeprecatedSince20,
    )
    def _copy_and_set_values(self, *args: Any, **kwargs: Any) -> Any:
        warnings.warn(
            'The private method  `_copy_and_set_values` will be removed and should no longer be used.',
            DeprecationWarning,
        )
        from .deprecated import copy_internals

        return copy_internals._copy_and_set_values(self, *args, **kwargs)

    @classmethod
    @typing_extensions.deprecated(
        'The private method `_get_value` will be removed and should no longer be used.',
        category=PydanticDeprecatedSince20,
    )
    def _get_value(cls, *args: Any, **kwargs: Any) -> Any:
        warnings.warn(
            'The private method  `_get_value` will be removed and should no longer be used.', DeprecationWarning
        )

        from .deprecated import copy_internals

        return copy_internals._get_value(cls, *args, **kwargs)

    @typing_extensions.deprecated(
        'The private method `_calculate_keys` will be removed and should no longer be used.',
        category=PydanticDeprecatedSince20,
    )
    def _calculate_keys(self, *args: Any, **kwargs: Any) -> Any:
        warnings.warn(
            'The private method `_calculate_keys` will be removed and should no longer be used.', DeprecationWarning
        )

        from .deprecated import copy_internals

        return copy_internals._calculate_keys(self, *args, **kwargs)


@typing.overload
def create_model(
    __model_name: str,
    *,
    __config__: ConfigDict | None = None,
    __doc__: str | None = None,
    __base__: None = None,
    __module__: str = __name__,
    __validators__: dict[str, classmethod] | None = None,
    __cls_kwargs__: dict[str, Any] | None = None,
    **field_definitions: Any,
) -> type[BaseModel]:
    ...


@typing.overload
def create_model(
    __model_name: str,
    *,
    __config__: ConfigDict | None = None,
    __doc__: str | None = None,
    __base__: type[Model] | tuple[type[Model], ...],
    __module__: str = __name__,
    __validators__: dict[str, classmethod] | None = None,
    __cls_kwargs__: dict[str, Any] | None = None,
    **field_definitions: Any,
) -> type[Model]:
    ...


def create_model(  # noqa: C901
    __model_name: str,
    *,
    __config__: ConfigDict | None = None,
    __doc__: str | None = None,
    __base__: type[Model] | tuple[type[Model], ...] | None = None,
    __module__: str | None = None,
    __validators__: dict[str, classmethod] | None = None,
    __cls_kwargs__: dict[str, Any] | None = None,
    __slots__: tuple[str, ...] | None = None,
    **field_definitions: Any,
) -> type[Model]:
    """Dynamically creates and returns a new Pydantic model, in other words, `create_model` dynamically creates a
    subclass of [`BaseModel`][pydantic.BaseModel].

    Args:
        __model_name: The name of the newly created model.
        __config__: The configuration of the new model.
        __doc__: The docstring of the new model.
        __base__: The base class for the new model.
        __module__: The name of the module that the model belongs to,
            if `None` the value is taken from `sys._getframe(1)`
        __validators__: A dictionary of methods that validate fields.
        __cls_kwargs__: A dictionary of keyword arguments for class creation.
        __slots__: Deprecated. Should not be passed to `create_model`.
        **field_definitions: Attributes of the new model. They should be passed in the format:
            `<name>=(<type>, <default value>)` or `<name>=(<type>, <FieldInfo>)`.

    Returns:
        The new [model][pydantic.BaseModel].

    Raises:
        PydanticUserError: If `__base__` and `__config__` are both passed.
    """
    if __slots__ is not None:
        # __slots__ will be ignored from here on
        warnings.warn('__slots__ should not be passed to create_model', RuntimeWarning)

    if __base__ is not None:
        if __config__ is not None:
            raise PydanticUserError(
                'to avoid confusion `__config__` and `__base__` cannot be used together',
                code='create-model-config-base',
            )
        if not isinstance(__base__, tuple):
            __base__ = (__base__,)
    else:
        __base__ = (typing.cast(typing.Type['Model'], BaseModel),)

    __cls_kwargs__ = __cls_kwargs__ or {}

    fields = {}
    annotations = {}

    for f_name, f_def in field_definitions.items():
        if not _fields.is_valid_field_name(f_name):
            warnings.warn(f'fields may not start with an underscore, ignoring "{f_name}"', RuntimeWarning)
        if isinstance(f_def, tuple):
            f_def = typing.cast('tuple[str, Any]', f_def)
            try:
                f_annotation, f_value = f_def
            except ValueError as e:
                raise PydanticUserError(
                    'Field definitions should be a `(<type>, <default>)`.',
                    code='create-model-field-definitions',
                ) from e
        else:
            f_annotation, f_value = None, f_def

        if f_annotation:
            annotations[f_name] = f_annotation
        fields[f_name] = f_value

    if __module__ is None:
        f = sys._getframe(1)
        __module__ = f.f_globals['__name__']

    namespace: dict[str, Any] = {'__annotations__': annotations, '__module__': __module__}
    if __doc__:
        namespace.update({'__doc__': __doc__})
    if __validators__:
        namespace.update(__validators__)
    namespace.update(fields)
    if __config__:
        namespace['model_config'] = _config.ConfigWrapper(__config__).config_dict
    resolved_bases = types.resolve_bases(__base__)
    meta, ns, kwds = types.prepare_class(__model_name, resolved_bases, kwds=__cls_kwargs__)
    if resolved_bases is not __base__:
        ns['__orig_bases__'] = __base__
    namespace.update(ns)

    return meta(
        __model_name,
        resolved_bases,
        namespace,
        __pydantic_reset_parent_namespace__=False,
        _create_model_module=__module__,
        **kwds,
    )


__getattr__ = getattr_migration(__name__)
