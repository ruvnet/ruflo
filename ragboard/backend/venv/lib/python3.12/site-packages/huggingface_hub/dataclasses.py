import inspect
from dataclasses import _MISSING_TYPE, MISSING, Field, field, fields
from functools import wraps
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Tuple,
    Type,
    TypeVar,
    Union,
    get_args,
    get_origin,
    overload,
)

from .errors import (
    StrictDataclassClassValidationError,
    StrictDataclassDefinitionError,
    StrictDataclassFieldValidationError,
)


Validator_T = Callable[[Any], None]
T = TypeVar("T")


# The overload decorator helps type checkers understand the different return types
@overload
def strict(cls: Type[T]) -> Type[T]: ...


@overload
def strict(*, accept_kwargs: bool = False) -> Callable[[Type[T]], Type[T]]: ...


def strict(
    cls: Optional[Type[T]] = None, *, accept_kwargs: bool = False
) -> Union[Type[T], Callable[[Type[T]], Type[T]]]:
    """
    Decorator to add strict validation to a dataclass.

    This decorator must be used on top of `@dataclass` to ensure IDEs and static typing tools
    recognize the class as a dataclass.

    Can be used with or without arguments:
    - `@strict`
    - `@strict(accept_kwargs=True)`

    Args:
        cls:
            The class to convert to a strict dataclass.
        accept_kwargs (`bool`, *optional*):
            If True, allows arbitrary keyword arguments in `__init__`. Defaults to False.

    Returns:
        The enhanced dataclass with strict validation on field assignment.

    Example:
    ```py
    >>> from dataclasses import dataclass
    >>> from huggingface_hub.dataclasses import as_validated_field, strict, validated_field

    >>> @as_validated_field
    >>> def positive_int(value: int):
    ...     if not value >= 0:
    ...         raise ValueError(f"Value must be positive, got {value}")

    >>> @strict(accept_kwargs=True)
    ... @dataclass
    ... class User:
    ...     name: str
    ...     age: int = positive_int(default=10)

    # Initialize
    >>> User(name="John")
    User(name='John', age=10)

    # Extra kwargs are accepted
    >>> User(name="John", age=30, lastname="Doe")
    User(name='John', age=30, *lastname='Doe')

    # Invalid type => raises
    >>> User(name="John", age="30")
    huggingface_hub.errors.StrictDataclassFieldValidationError: Validation error for field 'age':
        TypeError: Field 'age' expected int, got str (value: '30')

    # Invalid value => raises
    >>> User(name="John", age=-1)
    huggingface_hub.errors.StrictDataclassFieldValidationError: Validation error for field 'age':
        ValueError: Value must be positive, got -1
    ```
    """

    def wrap(cls: Type[T]) -> Type[T]:
        if not hasattr(cls, "__dataclass_fields__"):
            raise StrictDataclassDefinitionError(
                f"Class '{cls.__name__}' must be a dataclass before applying @strict."
            )

        # List and store validators
        field_validators: Dict[str, List[Validator_T]] = {}
        for f in fields(cls):  # type: ignore [arg-type]
            validators = []
            validators.append(_create_type_validator(f))
            custom_validator = f.metadata.get("validator")
            if custom_validator is not None:
                if not isinstance(custom_validator, list):
                    custom_validator = [custom_validator]
                for validator in custom_validator:
                    if not _is_validator(validator):
                        raise StrictDataclassDefinitionError(
                            f"Invalid validator for field '{f.name}': {validator}. Must be a callable taking a single argument."
                        )
                validators.extend(custom_validator)
            field_validators[f.name] = validators
        cls.__validators__ = field_validators  # type: ignore

        # Override __setattr__ to validate fields on assignment
        original_setattr = cls.__setattr__

        def __strict_setattr__(self: Any, name: str, value: Any) -> None:
            """Custom __setattr__ method for strict dataclasses."""
            # Run all validators
            for validator in self.__validators__.get(name, []):
                try:
                    validator(value)
                except (ValueError, TypeError) as e:
                    raise StrictDataclassFieldValidationError(field=name, cause=e) from e

            # If validation passed, set the attribute
            original_setattr(self, name, value)

        cls.__setattr__ = __strict_setattr__  # type: ignore[method-assign]

        if accept_kwargs:
            # (optional) Override __init__ to accept arbitrary keyword arguments
            original_init = cls.__init__

            @wraps(original_init)
            def __init__(self, **kwargs: Any) -> None:
                # Extract only the fields that are part of the dataclass
                dataclass_fields = {f.name for f in fields(cls)}  # type: ignore [arg-type]
                standard_kwargs = {k: v for k, v in kwargs.items() if k in dataclass_fields}

                # Call the original __init__ with standard fields
                original_init(self, **standard_kwargs)

                # Add any additional kwargs as attributes
                for name, value in kwargs.items():
                    if name not in dataclass_fields:
                        self.__setattr__(name, value)

            cls.__init__ = __init__  # type: ignore[method-assign]

            # (optional) Override __repr__ to include additional kwargs
            original_repr = cls.__repr__

            @wraps(original_repr)
            def __repr__(self) -> str:
                # Call the original __repr__ to get the standard fields
                standard_repr = original_repr(self)

                # Get additional kwargs
                additional_kwargs = [
                    # add a '*' in front of additional kwargs to let the user know they are not part of the dataclass
                    f"*{k}={v!r}"
                    for k, v in self.__dict__.items()
                    if k not in cls.__dataclass_fields__  # type: ignore [attr-defined]
                ]
                additional_repr = ", ".join(additional_kwargs)

                # Combine both representations
                return f"{standard_repr[:-1]}, {additional_repr})" if additional_kwargs else standard_repr

            cls.__repr__ = __repr__  # type: ignore [method-assign]

        # List all public methods starting with `validate_` => class validators.
        class_validators = []

        for name in dir(cls):
            if not name.startswith("validate_"):
                continue
            method = getattr(cls, name)
            if not callable(method):
                continue
            if len(inspect.signature(method).parameters) != 1:
                raise StrictDataclassDefinitionError(
                    f"Class '{cls.__name__}' has a class validator '{name}' that takes more than one argument."
                    " Class validators must take only 'self' as an argument. Methods starting with 'validate_'"
                    " are considered to be class validators."
                )
            class_validators.append(method)

        cls.__class_validators__ = class_validators  # type: ignore [attr-defined]

        # Add `validate` method to the class, but first check if it already exists
        def validate(self: T) -> None:
            """Run class validators on the instance."""
            for validator in cls.__class_validators__:  # type: ignore [attr-defined]
                try:
                    validator(self)
                except (ValueError, TypeError) as e:
                    raise StrictDataclassClassValidationError(validator=validator.__name__, cause=e) from e

        # Hack to be able to raise if `.validate()` already exists except if it was created by this decorator on a parent class
        # (in which case we just override it)
        validate.__is_defined_by_strict_decorator__ = True  # type: ignore [attr-defined]

        if hasattr(cls, "validate"):
            if not getattr(cls.validate, "__is_defined_by_strict_decorator__", False):  # type: ignore [attr-defined]
                raise StrictDataclassDefinitionError(
                    f"Class '{cls.__name__}' already implements a method called 'validate'."
                    " This method name is reserved when using the @strict decorator on a dataclass."
                    " If you want to keep your own method, please rename it."
                )

        cls.validate = validate  # type: ignore

        # Run class validators after initialization
        initial_init = cls.__init__

        @wraps(initial_init)
        def init_with_validate(self, *args, **kwargs) -> None:
            """Run class validators after initialization."""
            initial_init(self, *args, **kwargs)  # type: ignore [call-arg]
            cls.validate(self)  # type: ignore [attr-defined]

        setattr(cls, "__init__", init_with_validate)

        return cls

    # Return wrapped class or the decorator itself
    return wrap(cls) if cls is not None else wrap


def validated_field(
    validator: Union[List[Validator_T], Validator_T],
    default: Union[Any, _MISSING_TYPE] = MISSING,
    default_factory: Union[Callable[[], Any], _MISSING_TYPE] = MISSING,
    init: bool = True,
    repr: bool = True,
    hash: Optional[bool] = None,
    compare: bool = True,
    metadata: Optional[Dict] = None,
    **kwargs: Any,
) -> Any:
    """
    Create a dataclass field with a custom validator.

    Useful to apply several checks to a field. If only applying one rule, check out the [`as_validated_field`] decorator.

    Args:
        validator (`Callable` or `List[Callable]`):
            A method that takes a value as input and raises ValueError/TypeError if the value is invalid.
            Can be a list of validators to apply multiple checks.
        **kwargs:
            Additional arguments to pass to `dataclasses.field()`.

    Returns:
        A field with the validator attached in metadata
    """
    if not isinstance(validator, list):
        validator = [validator]
    if metadata is None:
        metadata = {}
    metadata["validator"] = validator
    return field(  # type: ignore
        default=default,  # type: ignore [arg-type]
        default_factory=default_factory,  # type: ignore [arg-type]
        init=init,
        repr=repr,
        hash=hash,
        compare=compare,
        metadata=metadata,
        **kwargs,
    )


def as_validated_field(validator: Validator_T):
    """
    Decorates a validator function as a [`validated_field`] (i.e. a dataclass field with a custom validator).

    Args:
        validator (`Callable`):
            A method that takes a value as input and raises ValueError/TypeError if the value is invalid.
    """

    def _inner(
        default: Union[Any, _MISSING_TYPE] = MISSING,
        default_factory: Union[Callable[[], Any], _MISSING_TYPE] = MISSING,
        init: bool = True,
        repr: bool = True,
        hash: Optional[bool] = None,
        compare: bool = True,
        metadata: Optional[Dict] = None,
        **kwargs: Any,
    ):
        return validated_field(
            validator,
            default=default,
            default_factory=default_factory,
            init=init,
            repr=repr,
            hash=hash,
            compare=compare,
            metadata=metadata,
            **kwargs,
        )

    return _inner


def type_validator(name: str, value: Any, expected_type: Any) -> None:
    """Validate that 'value' matches 'expected_type'."""
    origin = get_origin(expected_type)
    args = get_args(expected_type)

    if expected_type is Any:
        return
    elif validator := _BASIC_TYPE_VALIDATORS.get(origin):
        validator(name, value, args)
    elif isinstance(expected_type, type):  # simple types
        _validate_simple_type(name, value, expected_type)
    else:
        raise TypeError(f"Unsupported type for field '{name}': {expected_type}")


def _validate_union(name: str, value: Any, args: Tuple[Any, ...]) -> None:
    """Validate that value matches one of the types in a Union."""
    errors = []
    for t in args:
        try:
            type_validator(name, value, t)
            return  # Valid if any type matches
        except TypeError as e:
            errors.append(str(e))

    raise TypeError(
        f"Field '{name}' with value {repr(value)} doesn't match any type in {args}. Errors: {'; '.join(errors)}"
    )


def _validate_literal(name: str, value: Any, args: Tuple[Any, ...]) -> None:
    """Validate Literal type."""
    if value not in args:
        raise TypeError(f"Field '{name}' expected one of {args}, got {value}")


def _validate_list(name: str, value: Any, args: Tuple[Any, ...]) -> None:
    """Validate List[T] type."""
    if not isinstance(value, list):
        raise TypeError(f"Field '{name}' expected a list, got {type(value).__name__}")

    # Validate each item in the list
    item_type = args[0]
    for i, item in enumerate(value):
        try:
            type_validator(f"{name}[{i}]", item, item_type)
        except TypeError as e:
            raise TypeError(f"Invalid item at index {i} in list '{name}'") from e


def _validate_dict(name: str, value: Any, args: Tuple[Any, ...]) -> None:
    """Validate Dict[K, V] type."""
    if not isinstance(value, dict):
        raise TypeError(f"Field '{name}' expected a dict, got {type(value).__name__}")

    # Validate keys and values
    key_type, value_type = args
    for k, v in value.items():
        try:
            type_validator(f"{name}.key", k, key_type)
            type_validator(f"{name}[{k!r}]", v, value_type)
        except TypeError as e:
            raise TypeError(f"Invalid key or value in dict '{name}'") from e


def _validate_tuple(name: str, value: Any, args: Tuple[Any, ...]) -> None:
    """Validate Tuple type."""
    if not isinstance(value, tuple):
        raise TypeError(f"Field '{name}' expected a tuple, got {type(value).__name__}")

    # Handle variable-length tuples: Tuple[T, ...]
    if len(args) == 2 and args[1] is Ellipsis:
        for i, item in enumerate(value):
            try:
                type_validator(f"{name}[{i}]", item, args[0])
            except TypeError as e:
                raise TypeError(f"Invalid item at index {i} in tuple '{name}'") from e
    # Handle fixed-length tuples: Tuple[T1, T2, ...]
    elif len(args) != len(value):
        raise TypeError(f"Field '{name}' expected a tuple of length {len(args)}, got {len(value)}")
    else:
        for i, (item, expected) in enumerate(zip(value, args)):
            try:
                type_validator(f"{name}[{i}]", item, expected)
            except TypeError as e:
                raise TypeError(f"Invalid item at index {i} in tuple '{name}'") from e


def _validate_set(name: str, value: Any, args: Tuple[Any, ...]) -> None:
    """Validate Set[T] type."""
    if not isinstance(value, set):
        raise TypeError(f"Field '{name}' expected a set, got {type(value).__name__}")

    # Validate each item in the set
    item_type = args[0]
    for i, item in enumerate(value):
        try:
            type_validator(f"{name} item", item, item_type)
        except TypeError as e:
            raise TypeError(f"Invalid item in set '{name}'") from e


def _validate_simple_type(name: str, value: Any, expected_type: type) -> None:
    """Validate simple type (int, str, etc.)."""
    if not isinstance(value, expected_type):
        raise TypeError(
            f"Field '{name}' expected {expected_type.__name__}, got {type(value).__name__} (value: {repr(value)})"
        )


def _create_type_validator(field: Field) -> Validator_T:
    """Create a type validator function for a field."""
    # Hacky: we cannot use a lambda here because of reference issues

    def validator(value: Any) -> None:
        type_validator(field.name, value, field.type)

    return validator


def _is_validator(validator: Any) -> bool:
    """Check if a function is a validator.

    A validator is a Callable that can be called with a single positional argument.
    The validator can have more arguments with default values.

    Basically, returns True if `validator(value)` is possible.
    """
    if not callable(validator):
        return False

    signature = inspect.signature(validator)
    parameters = list(signature.parameters.values())
    if len(parameters) == 0:
        return False
    if parameters[0].kind not in (
        inspect.Parameter.POSITIONAL_OR_KEYWORD,
        inspect.Parameter.POSITIONAL_ONLY,
        inspect.Parameter.VAR_POSITIONAL,
    ):
        return False
    for parameter in parameters[1:]:
        if parameter.default == inspect.Parameter.empty:
            return False
    return True


_BASIC_TYPE_VALIDATORS = {
    Union: _validate_union,
    Literal: _validate_literal,
    list: _validate_list,
    dict: _validate_dict,
    tuple: _validate_tuple,
    set: _validate_set,
}


__all__ = [
    "strict",
    "validated_field",
    "Validator_T",
    "StrictDataclassClassValidationError",
    "StrictDataclassDefinitionError",
    "StrictDataclassFieldValidationError",
]
