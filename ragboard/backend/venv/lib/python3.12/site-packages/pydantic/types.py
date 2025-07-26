"""The types module contains custom types used by pydantic."""
from __future__ import annotations as _annotations

import base64
import dataclasses as _dataclasses
import re
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from pathlib import Path
from types import ModuleType
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    ClassVar,
    Dict,
    FrozenSet,
    Generic,
    Hashable,
    Iterator,
    List,
    Set,
    TypeVar,
    Union,
    cast,
)
from uuid import UUID

import annotated_types
from annotated_types import BaseMetadata, MaxLen, MinLen
from pydantic_core import CoreSchema, PydanticCustomError, core_schema
from typing_extensions import Annotated, Literal, Protocol, TypeAlias, TypeAliasType, deprecated

from ._internal import (
    _core_utils,
    _fields,
    _internal_dataclass,
    _typing_extra,
    _utils,
    _validators,
)
from ._migration import getattr_migration
from .annotated_handlers import GetCoreSchemaHandler, GetJsonSchemaHandler
from .errors import PydanticUserError
from .json_schema import JsonSchemaValue
from .warnings import PydanticDeprecatedSince20

__all__ = (
    'Strict',
    'StrictStr',
    'conbytes',
    'conlist',
    'conset',
    'confrozenset',
    'constr',
    'ImportString',
    'conint',
    'PositiveInt',
    'NegativeInt',
    'NonNegativeInt',
    'NonPositiveInt',
    'confloat',
    'PositiveFloat',
    'NegativeFloat',
    'NonNegativeFloat',
    'NonPositiveFloat',
    'FiniteFloat',
    'condecimal',
    'UUID1',
    'UUID3',
    'UUID4',
    'UUID5',
    'FilePath',
    'DirectoryPath',
    'NewPath',
    'Json',
    'SecretStr',
    'SecretBytes',
    'StrictBool',
    'StrictBytes',
    'StrictInt',
    'StrictFloat',
    'PaymentCardNumber',
    'ByteSize',
    'PastDate',
    'FutureDate',
    'PastDatetime',
    'FutureDatetime',
    'condate',
    'AwareDatetime',
    'NaiveDatetime',
    'AllowInfNan',
    'EncoderProtocol',
    'EncodedBytes',
    'EncodedStr',
    'Base64Encoder',
    'Base64Bytes',
    'Base64Str',
    'Base64UrlBytes',
    'Base64UrlStr',
    'GetPydanticSchema',
    'StringConstraints',
    'Tag',
    'Discriminator',
    'JsonValue',
)


@_dataclasses.dataclass
class Strict(_fields.PydanticMetadata, BaseMetadata):
    """Usage docs: https://docs.pydantic.dev/2.5/concepts/strict_mode/#strict-mode-with-annotated-strict

    A field metadata class to indicate that a field should be validated in strict mode.

    Attributes:
        strict: Whether to validate the field in strict mode.

    Example:
        ```python
        from typing_extensions import Annotated

        from pydantic.types import Strict

        StrictBool = Annotated[bool, Strict()]
        ```
    """

    strict: bool = True

    def __hash__(self) -> int:
        return hash(self.strict)


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ BOOLEAN TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

StrictBool = Annotated[bool, Strict()]
"""A boolean that must be either ``True`` or ``False``."""

# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ INTEGER TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


def conint(
    *,
    strict: bool | None = None,
    gt: int | None = None,
    ge: int | None = None,
    lt: int | None = None,
    le: int | None = None,
    multiple_of: int | None = None,
) -> type[int]:
    """
    !!! warning "Discouraged"
        This function is **discouraged** in favor of using
        [`Annotated`](https://docs.python.org/3/library/typing.html#typing.Annotated) with
        [`Field`][pydantic.fields.Field] instead.

        This function will be **deprecated** in Pydantic 3.0.

        The reason is that `conint` returns a type, which doesn't play well with static analysis tools.

        === ":x: Don't do this"
            ```py
            from pydantic import BaseModel, conint

            class Foo(BaseModel):
                bar: conint(strict=True, gt=0)
            ```

        === ":white_check_mark: Do this"
            ```py
            from typing_extensions import Annotated

            from pydantic import BaseModel, Field

            class Foo(BaseModel):
                bar: Annotated[int, Field(strict=True, gt=0)]
            ```

    A wrapper around `int` that allows for additional constraints.

    Args:
        strict: Whether to validate the integer in strict mode. Defaults to `None`.
        gt: The value must be greater than this.
        ge: The value must be greater than or equal to this.
        lt: The value must be less than this.
        le: The value must be less than or equal to this.
        multiple_of: The value must be a multiple of this.

    Returns:
        The wrapped integer type.

    ```py
    from pydantic import BaseModel, ValidationError, conint

    class ConstrainedExample(BaseModel):
        constrained_int: conint(gt=1)

    m = ConstrainedExample(constrained_int=2)
    print(repr(m))
    #> ConstrainedExample(constrained_int=2)

    try:
        ConstrainedExample(constrained_int=0)
    except ValidationError as e:
        print(e.errors())
        '''
        [
            {
                'type': 'greater_than',
                'loc': ('constrained_int',),
                'msg': 'Input should be greater than 1',
                'input': 0,
                'ctx': {'gt': 1},
                'url': 'https://errors.pydantic.dev/2/v/greater_than',
            }
        ]
        '''
    ```

    """  # noqa: D212
    return Annotated[
        int,
        Strict(strict) if strict is not None else None,
        annotated_types.Interval(gt=gt, ge=ge, lt=lt, le=le),
        annotated_types.MultipleOf(multiple_of) if multiple_of is not None else None,
    ]


PositiveInt = Annotated[int, annotated_types.Gt(0)]
"""An integer that must be greater than zero.

```py
from pydantic import BaseModel, PositiveInt, ValidationError

class Model(BaseModel):
    positive_int: PositiveInt

m = Model(positive_int=1)
print(repr(m))
#> Model(positive_int=1)

try:
    Model(positive_int=-1)
except ValidationError as e:
    print(e.errors())
    '''
    [
        {
            'type': 'greater_than',
            'loc': ('positive_int',),
            'msg': 'Input should be greater than 0',
            'input': -1,
            'ctx': {'gt': 0},
            'url': 'https://errors.pydantic.dev/2/v/greater_than',
        }
    ]
    '''
```
"""
NegativeInt = Annotated[int, annotated_types.Lt(0)]
"""An integer that must be less than zero.

```py
from pydantic import BaseModel, NegativeInt, ValidationError

class Model(BaseModel):
    negative_int: NegativeInt

m = Model(negative_int=-1)
print(repr(m))
#> Model(negative_int=-1)

try:
    Model(negative_int=1)
except ValidationError as e:
    print(e.errors())
    '''
    [
        {
            'type': 'less_than',
            'loc': ('negative_int',),
            'msg': 'Input should be less than 0',
            'input': 1,
            'ctx': {'lt': 0},
            'url': 'https://errors.pydantic.dev/2/v/less_than',
        }
    ]
    '''
```
"""
NonPositiveInt = Annotated[int, annotated_types.Le(0)]
"""An integer that must be less than or equal to zero.

```py
from pydantic import BaseModel, NonPositiveInt, ValidationError

class Model(BaseModel):
    non_positive_int: NonPositiveInt

m = Model(non_positive_int=0)
print(repr(m))
#> Model(non_positive_int=0)

try:
    Model(non_positive_int=1)
except ValidationError as e:
    print(e.errors())
    '''
    [
        {
            'type': 'less_than_equal',
            'loc': ('non_positive_int',),
            'msg': 'Input should be less than or equal to 0',
            'input': 1,
            'ctx': {'le': 0},
            'url': 'https://errors.pydantic.dev/2/v/less_than_equal',
        }
    ]
    '''
```
"""
NonNegativeInt = Annotated[int, annotated_types.Ge(0)]
"""An integer that must be greater than or equal to zero.

```py
from pydantic import BaseModel, NonNegativeInt, ValidationError

class Model(BaseModel):
    non_negative_int: NonNegativeInt

m = Model(non_negative_int=0)
print(repr(m))
#> Model(non_negative_int=0)

try:
    Model(non_negative_int=-1)
except ValidationError as e:
    print(e.errors())
    '''
    [
        {
            'type': 'greater_than_equal',
            'loc': ('non_negative_int',),
            'msg': 'Input should be greater than or equal to 0',
            'input': -1,
            'ctx': {'ge': 0},
            'url': 'https://errors.pydantic.dev/2/v/greater_than_equal',
        }
    ]
    '''
```
"""
StrictInt = Annotated[int, Strict()]
"""An integer that must be validated in strict mode.

```py
from pydantic import BaseModel, StrictInt, ValidationError

class StrictIntModel(BaseModel):
    strict_int: StrictInt

try:
    StrictIntModel(strict_int=3.14159)
except ValidationError as e:
    print(e)
    '''
    1 validation error for StrictIntModel
    strict_int
      Input should be a valid integer [type=int_type, input_value=3.14159, input_type=float]
    '''
```
"""

# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ FLOAT TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


@_dataclasses.dataclass
class AllowInfNan(_fields.PydanticMetadata):
    """A field metadata class to indicate that a field should allow ``-inf``, ``inf``, and ``nan``."""

    allow_inf_nan: bool = True

    def __hash__(self) -> int:
        return hash(self.allow_inf_nan)


def confloat(
    *,
    strict: bool | None = None,
    gt: float | None = None,
    ge: float | None = None,
    lt: float | None = None,
    le: float | None = None,
    multiple_of: float | None = None,
    allow_inf_nan: bool | None = None,
) -> type[float]:
    """
    !!! warning "Discouraged"
        This function is **discouraged** in favor of using
        [`Annotated`](https://docs.python.org/3/library/typing.html#typing.Annotated) with
        [`Field`][pydantic.fields.Field] instead.

        This function will be **deprecated** in Pydantic 3.0.

        The reason is that `confloat` returns a type, which doesn't play well with static analysis tools.

        === ":x: Don't do this"
            ```py
            from pydantic import BaseModel, confloat

            class Foo(BaseModel):
                bar: confloat(strict=True, gt=0)
            ```

        === ":white_check_mark: Do this"
            ```py
            from typing_extensions import Annotated

            from pydantic import BaseModel, Field

            class Foo(BaseModel):
                bar: Annotated[float, Field(strict=True, gt=0)]
            ```

    A wrapper around `float` that allows for additional constraints.

    Args:
        strict: Whether to validate the float in strict mode.
        gt: The value must be greater than this.
        ge: The value must be greater than or equal to this.
        lt: The value must be less than this.
        le: The value must be less than or equal to this.
        multiple_of: The value must be a multiple of this.
        allow_inf_nan: Whether to allow `-inf`, `inf`, and `nan`.

    Returns:
        The wrapped float type.

    ```py
    from pydantic import BaseModel, ValidationError, confloat

    class ConstrainedExample(BaseModel):
        constrained_float: confloat(gt=1.0)

    m = ConstrainedExample(constrained_float=1.1)
    print(repr(m))
    #> ConstrainedExample(constrained_float=1.1)

    try:
        ConstrainedExample(constrained_float=0.9)
    except ValidationError as e:
        print(e.errors())
        '''
        [
            {
                'type': 'greater_than',
                'loc': ('constrained_float',),
                'msg': 'Input should be greater than 1',
                'input': 0.9,
                'ctx': {'gt': 1.0},
                'url': 'https://errors.pydantic.dev/2/v/greater_than',
            }
        ]
        '''
    ```
    """  # noqa: D212
    return Annotated[
        float,
        Strict(strict) if strict is not None else None,
        annotated_types.Interval(gt=gt, ge=ge, lt=lt, le=le),
        annotated_types.MultipleOf(multiple_of) if multiple_of is not None else None,
        AllowInfNan(allow_inf_nan) if allow_inf_nan is not None else None,
    ]


PositiveFloat = Annotated[float, annotated_types.Gt(0)]
"""A float that must be greater than zero.

```py
from pydantic import BaseModel, PositiveFloat, ValidationError

class Model(BaseModel):
    positive_float: PositiveFloat

m = Model(positive_float=1.0)
print(repr(m))
#> Model(positive_float=1.0)

try:
    Model(positive_float=-1.0)
except ValidationError as e:
    print(e.errors())
    '''
    [
        {
            'type': 'greater_than',
            'loc': ('positive_float',),
            'msg': 'Input should be greater than 0',
            'input': -1.0,
            'ctx': {'gt': 0.0},
            'url': 'https://errors.pydantic.dev/2/v/greater_than',
        }
    ]
    '''
```
"""
NegativeFloat = Annotated[float, annotated_types.Lt(0)]
"""A float that must be less than zero.

```py
from pydantic import BaseModel, NegativeFloat, ValidationError

class Model(BaseModel):
    negative_float: NegativeFloat

m = Model(negative_float=-1.0)
print(repr(m))
#> Model(negative_float=-1.0)

try:
    Model(negative_float=1.0)
except ValidationError as e:
    print(e.errors())
    '''
    [
        {
            'type': 'less_than',
            'loc': ('negative_float',),
            'msg': 'Input should be less than 0',
            'input': 1.0,
            'ctx': {'lt': 0.0},
            'url': 'https://errors.pydantic.dev/2/v/less_than',
        }
    ]
    '''
```
"""
NonPositiveFloat = Annotated[float, annotated_types.Le(0)]
"""A float that must be less than or equal to zero.

```py
from pydantic import BaseModel, NonPositiveFloat, ValidationError

class Model(BaseModel):
    non_positive_float: NonPositiveFloat

m = Model(non_positive_float=0.0)
print(repr(m))
#> Model(non_positive_float=0.0)

try:
    Model(non_positive_float=1.0)
except ValidationError as e:
    print(e.errors())
    '''
    [
        {
            'type': 'less_than_equal',
            'loc': ('non_positive_float',),
            'msg': 'Input should be less than or equal to 0',
            'input': 1.0,
            'ctx': {'le': 0.0},
            'url': 'https://errors.pydantic.dev/2/v/less_than_equal',
        }
    ]
    '''
```
"""
NonNegativeFloat = Annotated[float, annotated_types.Ge(0)]
"""A float that must be greater than or equal to zero.

```py
from pydantic import BaseModel, NonNegativeFloat, ValidationError

class Model(BaseModel):
    non_negative_float: NonNegativeFloat

m = Model(non_negative_float=0.0)
print(repr(m))
#> Model(non_negative_float=0.0)

try:
    Model(non_negative_float=-1.0)
except ValidationError as e:
    print(e.errors())
    '''
    [
        {
            'type': 'greater_than_equal',
            'loc': ('non_negative_float',),
            'msg': 'Input should be greater than or equal to 0',
            'input': -1.0,
            'ctx': {'ge': 0.0},
            'url': 'https://errors.pydantic.dev/2/v/greater_than_equal',
        }
    ]
    '''
```
"""
StrictFloat = Annotated[float, Strict(True)]
"""A float that must be validated in strict mode.

```py
from pydantic import BaseModel, StrictFloat, ValidationError

class StrictFloatModel(BaseModel):
    strict_float: StrictFloat

try:
    StrictFloatModel(strict_float='1.0')
except ValidationError as e:
    print(e)
    '''
    1 validation error for StrictFloatModel
    strict_float
      Input should be a valid number [type=float_type, input_value='1.0', input_type=str]
    '''
```
"""
FiniteFloat = Annotated[float, AllowInfNan(False)]
"""A float that must be finite (not ``-inf``, ``inf``, or ``nan``).

```py
from pydantic import BaseModel, FiniteFloat

class Model(BaseModel):
    finite: FiniteFloat

m = Model(finite=1.0)
print(m)
#> finite=1.0
```
"""


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ BYTES TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


def conbytes(
    *,
    min_length: int | None = None,
    max_length: int | None = None,
    strict: bool | None = None,
) -> type[bytes]:
    """A wrapper around `bytes` that allows for additional constraints.

    Args:
        min_length: The minimum length of the bytes.
        max_length: The maximum length of the bytes.
        strict: Whether to validate the bytes in strict mode.

    Returns:
        The wrapped bytes type.
    """
    return Annotated[
        bytes,
        Strict(strict) if strict is not None else None,
        annotated_types.Len(min_length or 0, max_length),
    ]


StrictBytes = Annotated[bytes, Strict()]
"""A bytes that must be validated in strict mode."""


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ STRING TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


@_dataclasses.dataclass(frozen=True)
class StringConstraints(annotated_types.GroupedMetadata):
    """Usage docs: https://docs.pydantic.dev/2.5/concepts/fields/#string-constraints

    Apply constraints to `str` types.

    Attributes:
        strip_whitespace: Whether to strip whitespace from the string.
        to_upper: Whether to convert the string to uppercase.
        to_lower: Whether to convert the string to lowercase.
        strict: Whether to validate the string in strict mode.
        min_length: The minimum length of the string.
        max_length: The maximum length of the string.
        pattern: A regex pattern that the string must match.
    """

    strip_whitespace: bool | None = None
    to_upper: bool | None = None
    to_lower: bool | None = None
    strict: bool | None = None
    min_length: int | None = None
    max_length: int | None = None
    pattern: str | None = None

    def __iter__(self) -> Iterator[BaseMetadata]:
        if self.min_length is not None:
            yield MinLen(self.min_length)
        if self.max_length is not None:
            yield MaxLen(self.max_length)
        if self.strict is not None:
            yield Strict()
        if (
            self.strip_whitespace is not None
            or self.pattern is not None
            or self.to_lower is not None
            or self.to_upper is not None
        ):
            yield _fields.pydantic_general_metadata(
                strip_whitespace=self.strip_whitespace,
                to_upper=self.to_upper,
                to_lower=self.to_lower,
                pattern=self.pattern,
            )


def constr(
    *,
    strip_whitespace: bool | None = None,
    to_upper: bool | None = None,
    to_lower: bool | None = None,
    strict: bool | None = None,
    min_length: int | None = None,
    max_length: int | None = None,
    pattern: str | None = None,
) -> type[str]:
    """
    !!! warning "Discouraged"
        This function is **discouraged** in favor of using
        [`Annotated`](https://docs.python.org/3/library/typing.html#typing.Annotated) with
        [`StringConstraints`][pydantic.types.StringConstraints] instead.

        This function will be **deprecated** in Pydantic 3.0.

        The reason is that `constr` returns a type, which doesn't play well with static analysis tools.

        === ":x: Don't do this"
            ```py
            from pydantic import BaseModel, constr

            class Foo(BaseModel):
                bar: constr(strip_whitespace=True, to_upper=True, pattern=r'^[A-Z]+$')
            ```

        === ":white_check_mark: Do this"
            ```py
            from typing_extensions import Annotated

            from pydantic import BaseModel, StringConstraints

            class Foo(BaseModel):
                bar: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r'^[A-Z]+$')]
            ```

    A wrapper around `str` that allows for additional constraints.

    ```py
    from pydantic import BaseModel, constr

    class Foo(BaseModel):
        bar: constr(strip_whitespace=True, to_upper=True, pattern=r'^[A-Z]+$')


    foo = Foo(bar='  hello  ')
    print(foo)
    #> bar='HELLO'
    ```

    Args:
        strip_whitespace: Whether to remove leading and trailing whitespace.
        to_upper: Whether to turn all characters to uppercase.
        to_lower: Whether to turn all characters to lowercase.
        strict: Whether to validate the string in strict mode.
        min_length: The minimum length of the string.
        max_length: The maximum length of the string.
        pattern: A regex pattern to validate the string against.

    Returns:
        The wrapped string type.
    """  # noqa: D212
    return Annotated[
        str,
        StringConstraints(
            strip_whitespace=strip_whitespace,
            to_upper=to_upper,
            to_lower=to_lower,
            strict=strict,
            min_length=min_length,
            max_length=max_length,
            pattern=pattern,
        ),
    ]


StrictStr = Annotated[str, Strict()]
"""A string that must be validated in strict mode."""


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~ COLLECTION TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
HashableItemType = TypeVar('HashableItemType', bound=Hashable)


def conset(
    item_type: type[HashableItemType], *, min_length: int | None = None, max_length: int | None = None
) -> type[set[HashableItemType]]:
    """A wrapper around `typing.Set` that allows for additional constraints.

    Args:
        item_type: The type of the items in the set.
        min_length: The minimum length of the set.
        max_length: The maximum length of the set.

    Returns:
        The wrapped set type.
    """
    return Annotated[Set[item_type], annotated_types.Len(min_length or 0, max_length)]


def confrozenset(
    item_type: type[HashableItemType], *, min_length: int | None = None, max_length: int | None = None
) -> type[frozenset[HashableItemType]]:
    """A wrapper around `typing.FrozenSet` that allows for additional constraints.

    Args:
        item_type: The type of the items in the frozenset.
        min_length: The minimum length of the frozenset.
        max_length: The maximum length of the frozenset.

    Returns:
        The wrapped frozenset type.
    """
    return Annotated[FrozenSet[item_type], annotated_types.Len(min_length or 0, max_length)]


AnyItemType = TypeVar('AnyItemType')


def conlist(
    item_type: type[AnyItemType],
    *,
    min_length: int | None = None,
    max_length: int | None = None,
    unique_items: bool | None = None,
) -> type[list[AnyItemType]]:
    """A wrapper around typing.List that adds validation.

    Args:
        item_type: The type of the items in the list.
        min_length: The minimum length of the list. Defaults to None.
        max_length: The maximum length of the list. Defaults to None.
        unique_items: Whether the items in the list must be unique. Defaults to None.
            !!! warning Deprecated
                The `unique_items` parameter is deprecated, use `Set` instead.
                See [this issue](https://github.com/pydantic/pydantic-core/issues/296) for more details.

    Returns:
        The wrapped list type.
    """
    if unique_items is not None:
        raise PydanticUserError(
            (
                '`unique_items` is removed, use `Set` instead'
                '(this feature is discussed in https://github.com/pydantic/pydantic-core/issues/296)'
            ),
            code='removed-kwargs',
        )
    return Annotated[List[item_type], annotated_types.Len(min_length or 0, max_length)]


# ~~~~~~~~~~~~~~~~~~~~~~~~~~ IMPORT STRING TYPE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

AnyType = TypeVar('AnyType')
if TYPE_CHECKING:
    ImportString = Annotated[AnyType, ...]
else:

    class ImportString:
        """A type that can be used to import a type from a string.

        `ImportString` expects a string and loads the Python object importable at that dotted path.
        Attributes of modules may be separated from the module by `:` or `.`, e.g. if `'math:cos'` was provided,
        the resulting field value would be the function`cos`. If a `.` is used and both an attribute and submodule
        are present at the same path, the module will be preferred.

        On model instantiation, pointers will be evaluated and imported. There is
        some nuance to this behavior, demonstrated in the examples below.

        > A known limitation: setting a default value to a string
        > won't result in validation (thus evaluation). This is actively
        > being worked on.

        **Good behavior:**
        ```py
        from math import cos

        from pydantic import BaseModel, ImportString, ValidationError


        class ImportThings(BaseModel):
            obj: ImportString


        # A string value will cause an automatic import
        my_cos = ImportThings(obj='math.cos')

        # You can use the imported function as you would expect
        cos_of_0 = my_cos.obj(0)
        assert cos_of_0 == 1


        # A string whose value cannot be imported will raise an error
        try:
            ImportThings(obj='foo.bar')
        except ValidationError as e:
            print(e)
            '''
            1 validation error for ImportThings
            obj
            Invalid python path: No module named 'foo.bar' [type=import_error, input_value='foo.bar', input_type=str]
            '''


        # Actual python objects can be assigned as well
        my_cos = ImportThings(obj=cos)
        my_cos_2 = ImportThings(obj='math.cos')
        assert my_cos == my_cos_2
        ```

        Serializing an `ImportString` type to json is also possible.

        ```py
        from pydantic import BaseModel, ImportString


        class ImportThings(BaseModel):
            obj: ImportString


        # Create an instance
        m = ImportThings(obj='math:cos')
        print(m)
        #> obj=<built-in function cos>
        print(m.model_dump_json())
        #> {"obj":"math.cos"}
        ```
        """

        @classmethod
        def __class_getitem__(cls, item: AnyType) -> AnyType:
            return Annotated[item, cls()]

        @classmethod
        def __get_pydantic_core_schema__(
            cls, source: type[Any], handler: GetCoreSchemaHandler
        ) -> core_schema.CoreSchema:
            serializer = core_schema.plain_serializer_function_ser_schema(cls._serialize, when_used='json')
            if cls is source:
                # Treat bare usage of ImportString (`schema is None`) as the same as ImportString[Any]
                return core_schema.no_info_plain_validator_function(
                    function=_validators.import_string, serialization=serializer
                )
            else:
                return core_schema.no_info_before_validator_function(
                    function=_validators.import_string, schema=handler(source), serialization=serializer
                )

        @staticmethod
        def _serialize(v: Any) -> str:
            if isinstance(v, ModuleType):
                return v.__name__
            elif hasattr(v, '__module__') and hasattr(v, '__name__'):
                return f'{v.__module__}.{v.__name__}'
            else:
                return v

        def __repr__(self) -> str:
            return 'ImportString'


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ DECIMAL TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


def condecimal(
    *,
    strict: bool | None = None,
    gt: int | Decimal | None = None,
    ge: int | Decimal | None = None,
    lt: int | Decimal | None = None,
    le: int | Decimal | None = None,
    multiple_of: int | Decimal | None = None,
    max_digits: int | None = None,
    decimal_places: int | None = None,
    allow_inf_nan: bool | None = None,
) -> type[Decimal]:
    """
    !!! warning "Discouraged"
        This function is **discouraged** in favor of using
        [`Annotated`](https://docs.python.org/3/library/typing.html#typing.Annotated) with
        [`Field`][pydantic.fields.Field] instead.

        This function will be **deprecated** in Pydantic 3.0.

        The reason is that `condecimal` returns a type, which doesn't play well with static analysis tools.

        === ":x: Don't do this"
            ```py
            from pydantic import BaseModel, condecimal

            class Foo(BaseModel):
                bar: condecimal(strict=True, allow_inf_nan=True)
            ```

        === ":white_check_mark: Do this"
            ```py
            from decimal import Decimal

            from typing_extensions import Annotated

            from pydantic import BaseModel, Field

            class Foo(BaseModel):
                bar: Annotated[Decimal, Field(strict=True, allow_inf_nan=True)]
            ```

    A wrapper around Decimal that adds validation.

    Args:
        strict: Whether to validate the value in strict mode. Defaults to `None`.
        gt: The value must be greater than this. Defaults to `None`.
        ge: The value must be greater than or equal to this. Defaults to `None`.
        lt: The value must be less than this. Defaults to `None`.
        le: The value must be less than or equal to this. Defaults to `None`.
        multiple_of: The value must be a multiple of this. Defaults to `None`.
        max_digits: The maximum number of digits. Defaults to `None`.
        decimal_places: The number of decimal places. Defaults to `None`.
        allow_inf_nan: Whether to allow infinity and NaN. Defaults to `None`.

    ```py
    from decimal import Decimal

    from pydantic import BaseModel, ValidationError, condecimal

    class ConstrainedExample(BaseModel):
        constrained_decimal: condecimal(gt=Decimal('1.0'))

    m = ConstrainedExample(constrained_decimal=Decimal('1.1'))
    print(repr(m))
    #> ConstrainedExample(constrained_decimal=Decimal('1.1'))

    try:
        ConstrainedExample(constrained_decimal=Decimal('0.9'))
    except ValidationError as e:
        print(e.errors())
        '''
        [
            {
                'type': 'greater_than',
                'loc': ('constrained_decimal',),
                'msg': 'Input should be greater than 1.0',
                'input': Decimal('0.9'),
                'ctx': {'gt': Decimal('1.0')},
                'url': 'https://errors.pydantic.dev/2/v/greater_than',
            }
        ]
        '''
    ```
    """  # noqa: D212
    return Annotated[
        Decimal,
        Strict(strict) if strict is not None else None,
        annotated_types.Interval(gt=gt, ge=ge, lt=lt, le=le),
        annotated_types.MultipleOf(multiple_of) if multiple_of is not None else None,
        _fields.pydantic_general_metadata(max_digits=max_digits, decimal_places=decimal_places),
        AllowInfNan(allow_inf_nan) if allow_inf_nan is not None else None,
    ]


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ UUID TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


@_dataclasses.dataclass(**_internal_dataclass.slots_true)
class UuidVersion:
    """A field metadata class to indicate a [UUID](https://docs.python.org/3/library/uuid.html) version."""

    uuid_version: Literal[1, 3, 4, 5]

    def __get_pydantic_json_schema__(
        self, core_schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        field_schema = handler(core_schema)
        field_schema.pop('anyOf', None)  # remove the bytes/str union
        field_schema.update(type='string', format=f'uuid{self.uuid_version}')
        return field_schema

    def __get_pydantic_core_schema__(self, source: Any, handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        if isinstance(self, source):
            # used directly as a type
            return core_schema.uuid_schema(version=self.uuid_version)
        else:
            # update existing schema with self.uuid_version
            schema = handler(source)
            _check_annotated_type(schema['type'], 'uuid', self.__class__.__name__)
            schema['version'] = self.uuid_version  # type: ignore
            return schema

    def __hash__(self) -> int:
        return hash(type(self.uuid_version))


UUID1 = Annotated[UUID, UuidVersion(1)]
"""A [UUID](https://docs.python.org/3/library/uuid.html) that must be version 1.

```py
import uuid

from pydantic import UUID1, BaseModel

class Model(BaseModel):
    uuid1: UUID1

Model(uuid1=uuid.uuid1())
```
"""
UUID3 = Annotated[UUID, UuidVersion(3)]
"""A [UUID](https://docs.python.org/3/library/uuid.html) that must be version 3.

```py
import uuid

from pydantic import UUID3, BaseModel

class Model(BaseModel):
    uuid3: UUID3

Model(uuid3=uuid.uuid3(uuid.NAMESPACE_DNS, 'pydantic.org'))
```
"""
UUID4 = Annotated[UUID, UuidVersion(4)]
"""A [UUID](https://docs.python.org/3/library/uuid.html) that must be version 4.

```py
import uuid

from pydantic import UUID4, BaseModel

class Model(BaseModel):
    uuid4: UUID4

Model(uuid4=uuid.uuid4())
```
"""
UUID5 = Annotated[UUID, UuidVersion(5)]
"""A [UUID](https://docs.python.org/3/library/uuid.html) that must be version 5.

```py
import uuid

from pydantic import UUID5, BaseModel

class Model(BaseModel):
    uuid5: UUID5

Model(uuid5=uuid.uuid5(uuid.NAMESPACE_DNS, 'pydantic.org'))
```
"""


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PATH TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


@_dataclasses.dataclass
class PathType:
    path_type: Literal['file', 'dir', 'new']

    def __get_pydantic_json_schema__(
        self, core_schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        field_schema = handler(core_schema)
        format_conversion = {'file': 'file-path', 'dir': 'directory-path'}
        field_schema.update(format=format_conversion.get(self.path_type, 'path'), type='string')
        return field_schema

    def __get_pydantic_core_schema__(self, source: Any, handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        function_lookup = {
            'file': cast(core_schema.WithInfoValidatorFunction, self.validate_file),
            'dir': cast(core_schema.WithInfoValidatorFunction, self.validate_directory),
            'new': cast(core_schema.WithInfoValidatorFunction, self.validate_new),
        }

        return core_schema.with_info_after_validator_function(
            function_lookup[self.path_type],
            handler(source),
        )

    @staticmethod
    def validate_file(path: Path, _: core_schema.ValidationInfo) -> Path:
        if path.is_file():
            return path
        else:
            raise PydanticCustomError('path_not_file', 'Path does not point to a file')

    @staticmethod
    def validate_directory(path: Path, _: core_schema.ValidationInfo) -> Path:
        if path.is_dir():
            return path
        else:
            raise PydanticCustomError('path_not_directory', 'Path does not point to a directory')

    @staticmethod
    def validate_new(path: Path, _: core_schema.ValidationInfo) -> Path:
        if path.exists():
            raise PydanticCustomError('path_exists', 'Path already exists')
        elif not path.parent.exists():
            raise PydanticCustomError('parent_does_not_exist', 'Parent directory does not exist')
        else:
            return path

    def __hash__(self) -> int:
        return hash(type(self.path_type))


FilePath = Annotated[Path, PathType('file')]
"""A path that must point to a file.

```py
from pathlib import Path

from pydantic import BaseModel, FilePath, ValidationError

class Model(BaseModel):
    f: FilePath

path = Path('text.txt')
path.touch()
m = Model(f='text.txt')
print(m.model_dump())
#> {'f': PosixPath('text.txt')}
path.unlink()

path = Path('directory')
path.mkdir(exist_ok=True)
try:
    Model(f='directory')  # directory
except ValidationError as e:
    print(e)
    '''
    1 validation error for Model
    f
      Path does not point to a file [type=path_not_file, input_value='directory', input_type=str]
    '''
path.rmdir()

try:
    Model(f='not-exists-file')
except ValidationError as e:
    print(e)
    '''
    1 validation error for Model
    f
      Path does not point to a file [type=path_not_file, input_value='not-exists-file', input_type=str]
    '''
```
"""
DirectoryPath = Annotated[Path, PathType('dir')]
"""A path that must point to a directory.

```py
from pathlib import Path

from pydantic import BaseModel, DirectoryPath, ValidationError

class Model(BaseModel):
    f: DirectoryPath

path = Path('directory/')
path.mkdir()
m = Model(f='directory/')
print(m.model_dump())
#> {'f': PosixPath('directory')}
path.rmdir()

path = Path('file.txt')
path.touch()
try:
    Model(f='file.txt')  # file
except ValidationError as e:
    print(e)
    '''
    1 validation error for Model
    f
      Path does not point to a directory [type=path_not_directory, input_value='file.txt', input_type=str]
    '''
path.unlink()

try:
    Model(f='not-exists-directory')
except ValidationError as e:
    print(e)
    '''
    1 validation error for Model
    f
      Path does not point to a directory [type=path_not_directory, input_value='not-exists-directory', input_type=str]
    '''
```
"""
NewPath = Annotated[Path, PathType('new')]
"""A path for a new file or directory that must not already exist."""


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ JSON TYPE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

if TYPE_CHECKING:
    Json = Annotated[AnyType, ...]  # Json[list[str]] will be recognized by type checkers as list[str]

else:

    class Json:
        """A special type wrapper which loads JSON before parsing.

        You can use the `Json` data type to make Pydantic first load a raw JSON string before
        validating the loaded data into the parametrized type:

        ```py
        from typing import Any, List

        from pydantic import BaseModel, Json, ValidationError


        class AnyJsonModel(BaseModel):
            json_obj: Json[Any]


        class ConstrainedJsonModel(BaseModel):
            json_obj: Json[List[int]]


        print(AnyJsonModel(json_obj='{"b": 1}'))
        #> json_obj={'b': 1}
        print(ConstrainedJsonModel(json_obj='[1, 2, 3]'))
        #> json_obj=[1, 2, 3]

        try:
            ConstrainedJsonModel(json_obj=12)
        except ValidationError as e:
            print(e)
            '''
            1 validation error for ConstrainedJsonModel
            json_obj
            JSON input should be string, bytes or bytearray [type=json_type, input_value=12, input_type=int]
            '''

        try:
            ConstrainedJsonModel(json_obj='[a, b]')
        except ValidationError as e:
            print(e)
            '''
            1 validation error for ConstrainedJsonModel
            json_obj
            Invalid JSON: expected value at line 1 column 2 [type=json_invalid, input_value='[a, b]', input_type=str]
            '''

        try:
            ConstrainedJsonModel(json_obj='["a", "b"]')
        except ValidationError as e:
            print(e)
            '''
            2 validation errors for ConstrainedJsonModel
            json_obj.0
            Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='a', input_type=str]
            json_obj.1
            Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='b', input_type=str]
            '''
        ```

        When you dump the model using `model_dump` or `model_dump_json`, the dumped value will be the result of validation,
        not the original JSON string. However, you can use the argument `round_trip=True` to get the original JSON string back:

        ```py
        from typing import List

        from pydantic import BaseModel, Json


        class ConstrainedJsonModel(BaseModel):
            json_obj: Json[List[int]]


        print(ConstrainedJsonModel(json_obj='[1, 2, 3]').model_dump_json())
        #> {"json_obj":[1,2,3]}
        print(
            ConstrainedJsonModel(json_obj='[1, 2, 3]').model_dump_json(round_trip=True)
        )
        #> {"json_obj":"[1,2,3]"}
        ```
        """

        @classmethod
        def __class_getitem__(cls, item: AnyType) -> AnyType:
            return Annotated[item, cls()]

        @classmethod
        def __get_pydantic_core_schema__(cls, source: Any, handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
            if cls is source:
                return core_schema.json_schema(None)
            else:
                return core_schema.json_schema(handler(source))

        def __repr__(self) -> str:
            return 'Json'

        def __hash__(self) -> int:
            return hash(type(self))

        def __eq__(self, other: Any) -> bool:
            return type(other) == type(self)


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ SECRET TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

SecretType = TypeVar('SecretType', str, bytes)


class _SecretField(Generic[SecretType]):
    def __init__(self, secret_value: SecretType) -> None:
        self._secret_value: SecretType = secret_value

    def get_secret_value(self) -> SecretType:
        """Get the secret value.

        Returns:
            The secret value.
        """
        return self._secret_value

    def __eq__(self, other: Any) -> bool:
        return isinstance(other, self.__class__) and self.get_secret_value() == other.get_secret_value()

    def __hash__(self) -> int:
        return hash(self.get_secret_value())

    def __len__(self) -> int:
        return len(self._secret_value)

    def __str__(self) -> str:
        return str(self._display())

    def __repr__(self) -> str:
        return f'{self.__class__.__name__}({self._display()!r})'

    def _display(self) -> SecretType:
        raise NotImplementedError

    @classmethod
    def __get_pydantic_core_schema__(cls, source: type[Any], handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        if issubclass(source, SecretStr):
            field_type = str
            inner_schema = core_schema.str_schema()
        else:
            assert issubclass(source, SecretBytes)
            field_type = bytes
            inner_schema = core_schema.bytes_schema()
        error_kind = 'string_type' if field_type is str else 'bytes_type'

        def serialize(
            value: _SecretField[SecretType], info: core_schema.SerializationInfo
        ) -> str | _SecretField[SecretType]:
            if info.mode == 'json':
                # we want the output to always be string without the `b'` prefix for bytes,
                # hence we just use `secret_display`
                return _secret_display(value.get_secret_value())
            else:
                return value

        def get_json_schema(_core_schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler) -> JsonSchemaValue:
            json_schema = handler(inner_schema)
            _utils.update_not_none(
                json_schema,
                type='string',
                writeOnly=True,
                format='password',
            )
            return json_schema

        json_schema = core_schema.no_info_after_validator_function(
            source,  # construct the type
            inner_schema,
        )
        s = core_schema.json_or_python_schema(
            python_schema=core_schema.union_schema(
                [
                    core_schema.is_instance_schema(source),
                    json_schema,
                ],
                strict=True,
                custom_error_type=error_kind,
            ),
            json_schema=json_schema,
            serialization=core_schema.plain_serializer_function_ser_schema(
                serialize,
                info_arg=True,
                return_schema=core_schema.str_schema(),
                when_used='json',
            ),
        )
        s.setdefault('metadata', {}).setdefault('pydantic_js_functions', []).append(get_json_schema)
        return s


def _secret_display(value: str | bytes) -> str:
    return '**********' if value else ''


class SecretStr(_SecretField[str]):
    """A string used for storing sensitive information that you do not want to be visible in logging or tracebacks.

    It displays `'**********'` instead of the string value on `repr()` and `str()` calls.

    ```py
    from pydantic import BaseModel, SecretStr

    class User(BaseModel):
        username: str
        password: SecretStr

    user = User(username='scolvin', password='password1')

    print(user)
    #> username='scolvin' password=SecretStr('**********')
    print(user.password.get_secret_value())
    #> password1
    ```
    """

    def _display(self) -> str:
        return _secret_display(self.get_secret_value())


class SecretBytes(_SecretField[bytes]):
    """A bytes used for storing sensitive information that you do not want to be visible in logging or tracebacks.

    It displays `b'**********'` instead of the string value on `repr()` and `str()` calls.

    ```py
    from pydantic import BaseModel, SecretBytes

    class User(BaseModel):
        username: str
        password: SecretBytes

    user = User(username='scolvin', password=b'password1')
    #> username='scolvin' password=SecretBytes(b'**********')
    print(user.password.get_secret_value())
    #> b'password1'
    ```
    """

    def _display(self) -> bytes:
        return _secret_display(self.get_secret_value()).encode()


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ PAYMENT CARD TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~


class PaymentCardBrand(str, Enum):
    amex = 'American Express'
    mastercard = 'Mastercard'
    visa = 'Visa'
    other = 'other'

    def __str__(self) -> str:
        return self.value


@deprecated(
    'The `PaymentCardNumber` class is deprecated, use `pydantic_extra_types` instead. '
    'See https://docs.pydantic.dev/latest/api/pydantic_extra_types_payment/#pydantic_extra_types.payment.PaymentCardNumber.',
    category=PydanticDeprecatedSince20,
)
class PaymentCardNumber(str):
    """Based on: https://en.wikipedia.org/wiki/Payment_card_number."""

    strip_whitespace: ClassVar[bool] = True
    min_length: ClassVar[int] = 12
    max_length: ClassVar[int] = 19
    bin: str
    last4: str
    brand: PaymentCardBrand

    def __init__(self, card_number: str):
        self.validate_digits(card_number)

        card_number = self.validate_luhn_check_digit(card_number)

        self.bin = card_number[:6]
        self.last4 = card_number[-4:]
        self.brand = self.validate_brand(card_number)

    @classmethod
    def __get_pydantic_core_schema__(cls, source: type[Any], handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        return core_schema.with_info_after_validator_function(
            cls.validate,
            core_schema.str_schema(
                min_length=cls.min_length, max_length=cls.max_length, strip_whitespace=cls.strip_whitespace
            ),
        )

    @classmethod
    def validate(cls, __input_value: str, _: core_schema.ValidationInfo) -> PaymentCardNumber:
        """Validate the card number and return a `PaymentCardNumber` instance."""
        return cls(__input_value)

    @property
    def masked(self) -> str:
        """Mask all but the last 4 digits of the card number.

        Returns:
            A masked card number string.
        """
        num_masked = len(self) - 10  # len(bin) + len(last4) == 10
        return f'{self.bin}{"*" * num_masked}{self.last4}'

    @classmethod
    def validate_digits(cls, card_number: str) -> None:
        """Validate that the card number is all digits."""
        if not card_number.isdigit():
            raise PydanticCustomError('payment_card_number_digits', 'Card number is not all digits')

    @classmethod
    def validate_luhn_check_digit(cls, card_number: str) -> str:
        """Based on: https://en.wikipedia.org/wiki/Luhn_algorithm."""
        sum_ = int(card_number[-1])
        length = len(card_number)
        parity = length % 2
        for i in range(length - 1):
            digit = int(card_number[i])
            if i % 2 == parity:
                digit *= 2
            if digit > 9:
                digit -= 9
            sum_ += digit
        valid = sum_ % 10 == 0
        if not valid:
            raise PydanticCustomError('payment_card_number_luhn', 'Card number is not luhn valid')
        return card_number

    @staticmethod
    def validate_brand(card_number: str) -> PaymentCardBrand:
        """Validate length based on BIN for major brands:
        https://en.wikipedia.org/wiki/Payment_card_number#Issuer_identification_number_(IIN).
        """
        if card_number[0] == '4':
            brand = PaymentCardBrand.visa
        elif 51 <= int(card_number[:2]) <= 55:
            brand = PaymentCardBrand.mastercard
        elif card_number[:2] in {'34', '37'}:
            brand = PaymentCardBrand.amex
        else:
            brand = PaymentCardBrand.other

        required_length: None | int | str = None
        if brand in PaymentCardBrand.mastercard:
            required_length = 16
            valid = len(card_number) == required_length
        elif brand == PaymentCardBrand.visa:
            required_length = '13, 16 or 19'
            valid = len(card_number) in {13, 16, 19}
        elif brand == PaymentCardBrand.amex:
            required_length = 15
            valid = len(card_number) == required_length
        else:
            valid = True

        if not valid:
            raise PydanticCustomError(
                'payment_card_number_brand',
                'Length for a {brand} card must be {required_length}',
                {'brand': brand, 'required_length': required_length},
            )
        return brand


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ BYTE SIZE TYPE ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

BYTE_SIZES = {
    'b': 1,
    'kb': 10**3,
    'mb': 10**6,
    'gb': 10**9,
    'tb': 10**12,
    'pb': 10**15,
    'eb': 10**18,
    'kib': 2**10,
    'mib': 2**20,
    'gib': 2**30,
    'tib': 2**40,
    'pib': 2**50,
    'eib': 2**60,
}
BYTE_SIZES.update({k.lower()[0]: v for k, v in BYTE_SIZES.items() if 'i' not in k})
byte_string_re = re.compile(r'^\s*(\d*\.?\d+)\s*(\w+)?', re.IGNORECASE)


class ByteSize(int):
    """Converts a string representing a number of bytes with units (such as `'1KB'` or `'11.5MiB'`) into an integer.

    You can use the `ByteSize` data type to (case-insensitively) convert a string representation of a number of bytes into
    an integer, and also to print out human-readable strings representing a number of bytes.

    In conformance with [IEC 80000-13 Standard](https://en.wikipedia.org/wiki/ISO/IEC_80000) we interpret `'1KB'` to mean 1000 bytes,
    and `'1KiB'` to mean 1024 bytes. In general, including a middle `'i'` will cause the unit to be interpreted as a power of 2,
    rather than a power of 10 (so, for example, `'1 MB'` is treated as `1_000_000` bytes, whereas `'1 MiB'` is treated as `1_048_576` bytes).

    !!! info
        Note that `1b` will be parsed as "1 byte" and not "1 bit".

    ```py
    from pydantic import BaseModel, ByteSize

    class MyModel(BaseModel):
        size: ByteSize

    print(MyModel(size=52000).size)
    #> 52000
    print(MyModel(size='3000 KiB').size)
    #> 3072000

    m = MyModel(size='50 PB')
    print(m.size.human_readable())
    #> 44.4PiB
    print(m.size.human_readable(decimal=True))
    #> 50.0PB

    print(m.size.to('TiB'))
    #> 45474.73508864641
    ```
    """

    @classmethod
    def __get_pydantic_core_schema__(cls, source: type[Any], handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        return core_schema.with_info_plain_validator_function(cls._validate)

    @classmethod
    def _validate(cls, __input_value: Any, _: core_schema.ValidationInfo) -> ByteSize:
        try:
            return cls(int(__input_value))
        except ValueError:
            pass

        str_match = byte_string_re.match(str(__input_value))
        if str_match is None:
            raise PydanticCustomError('byte_size', 'could not parse value and unit from byte string')

        scalar, unit = str_match.groups()
        if unit is None:
            unit = 'b'

        try:
            unit_mult = BYTE_SIZES[unit.lower()]
        except KeyError:
            raise PydanticCustomError('byte_size_unit', 'could not interpret byte unit: {unit}', {'unit': unit})

        return cls(int(float(scalar) * unit_mult))

    def human_readable(self, decimal: bool = False) -> str:
        """Converts a byte size to a human readable string.

        Args:
            decimal: If True, use decimal units (e.g. 1000 bytes per KB). If False, use binary units
                (e.g. 1024 bytes per KiB).

        Returns:
            A human readable string representation of the byte size.
        """
        if decimal:
            divisor = 1000
            units = 'B', 'KB', 'MB', 'GB', 'TB', 'PB'
            final_unit = 'EB'
        else:
            divisor = 1024
            units = 'B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'
            final_unit = 'EiB'

        num = float(self)
        for unit in units:
            if abs(num) < divisor:
                if unit == 'B':
                    return f'{num:0.0f}{unit}'
                else:
                    return f'{num:0.1f}{unit}'
            num /= divisor

        return f'{num:0.1f}{final_unit}'

    def to(self, unit: str) -> float:
        """Converts a byte size to another unit.

        Args:
            unit: The unit to convert to. Must be one of the following: B, KB, MB, GB, TB, PB, EiB,
                KiB, MiB, GiB, TiB, PiB, EiB.

        Returns:
            The byte size in the new unit.
        """
        try:
            unit_div = BYTE_SIZES[unit.lower()]
        except KeyError:
            raise PydanticCustomError('byte_size_unit', 'Could not interpret byte unit: {unit}', {'unit': unit})

        return self / unit_div


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ DATE TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


def _check_annotated_type(annotated_type: str, expected_type: str, annotation: str) -> None:
    if annotated_type != expected_type:
        raise PydanticUserError(f"'{annotation}' cannot annotate '{annotated_type}'.", code='invalid_annotated_type')


if TYPE_CHECKING:
    PastDate = Annotated[date, ...]
    FutureDate = Annotated[date, ...]
else:

    class PastDate:
        """A date in the past."""

        @classmethod
        def __get_pydantic_core_schema__(
            cls, source: type[Any], handler: GetCoreSchemaHandler
        ) -> core_schema.CoreSchema:
            if cls is source:
                # used directly as a type
                return core_schema.date_schema(now_op='past')
            else:
                schema = handler(source)
                _check_annotated_type(schema['type'], 'date', cls.__name__)
                schema['now_op'] = 'past'
                return schema

        def __repr__(self) -> str:
            return 'PastDate'

    class FutureDate:
        """A date in the future."""

        @classmethod
        def __get_pydantic_core_schema__(
            cls, source: type[Any], handler: GetCoreSchemaHandler
        ) -> core_schema.CoreSchema:
            if cls is source:
                # used directly as a type
                return core_schema.date_schema(now_op='future')
            else:
                schema = handler(source)
                _check_annotated_type(schema['type'], 'date', cls.__name__)
                schema['now_op'] = 'future'
                return schema

        def __repr__(self) -> str:
            return 'FutureDate'


def condate(
    *,
    strict: bool | None = None,
    gt: date | None = None,
    ge: date | None = None,
    lt: date | None = None,
    le: date | None = None,
) -> type[date]:
    """A wrapper for date that adds constraints.

    Args:
        strict: Whether to validate the date value in strict mode. Defaults to `None`.
        gt: The value must be greater than this. Defaults to `None`.
        ge: The value must be greater than or equal to this. Defaults to `None`.
        lt: The value must be less than this. Defaults to `None`.
        le: The value must be less than or equal to this. Defaults to `None`.

    Returns:
        A date type with the specified constraints.
    """
    return Annotated[
        date,
        Strict(strict) if strict is not None else None,
        annotated_types.Interval(gt=gt, ge=ge, lt=lt, le=le),
    ]


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ DATETIME TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

if TYPE_CHECKING:
    AwareDatetime = Annotated[datetime, ...]
    NaiveDatetime = Annotated[datetime, ...]
    PastDatetime = Annotated[datetime, ...]
    FutureDatetime = Annotated[datetime, ...]

else:

    class AwareDatetime:
        """A datetime that requires timezone info."""

        @classmethod
        def __get_pydantic_core_schema__(
            cls, source: type[Any], handler: GetCoreSchemaHandler
        ) -> core_schema.CoreSchema:
            if cls is source:
                # used directly as a type
                return core_schema.datetime_schema(tz_constraint='aware')
            else:
                schema = handler(source)
                _check_annotated_type(schema['type'], 'datetime', cls.__name__)
                schema['tz_constraint'] = 'aware'
                return schema

        def __repr__(self) -> str:
            return 'AwareDatetime'

    class NaiveDatetime:
        """A datetime that doesn't require timezone info."""

        @classmethod
        def __get_pydantic_core_schema__(
            cls, source: type[Any], handler: GetCoreSchemaHandler
        ) -> core_schema.CoreSchema:
            if cls is source:
                # used directly as a type
                return core_schema.datetime_schema(tz_constraint='naive')
            else:
                schema = handler(source)
                _check_annotated_type(schema['type'], 'datetime', cls.__name__)
                schema['tz_constraint'] = 'naive'
                return schema

        def __repr__(self) -> str:
            return 'NaiveDatetime'

    class PastDatetime:
        """A datetime that must be in the past."""

        @classmethod
        def __get_pydantic_core_schema__(
            cls, source: type[Any], handler: GetCoreSchemaHandler
        ) -> core_schema.CoreSchema:
            if cls is source:
                # used directly as a type
                return core_schema.datetime_schema(now_op='past')
            else:
                schema = handler(source)
                _check_annotated_type(schema['type'], 'datetime', cls.__name__)
                schema['now_op'] = 'past'
                return schema

        def __repr__(self) -> str:
            return 'PastDatetime'

    class FutureDatetime:
        """A datetime that must be in the future."""

        @classmethod
        def __get_pydantic_core_schema__(
            cls, source: type[Any], handler: GetCoreSchemaHandler
        ) -> core_schema.CoreSchema:
            if cls is source:
                # used directly as a type
                return core_schema.datetime_schema(now_op='future')
            else:
                schema = handler(source)
                _check_annotated_type(schema['type'], 'datetime', cls.__name__)
                schema['now_op'] = 'future'
                return schema

        def __repr__(self) -> str:
            return 'FutureDatetime'


# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ Encoded TYPES ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~


class EncoderProtocol(Protocol):
    """Protocol for encoding and decoding data to and from bytes."""

    @classmethod
    def decode(cls, data: bytes) -> bytes:
        """Decode the data using the encoder.

        Args:
            data: The data to decode.

        Returns:
            The decoded data.
        """
        ...

    @classmethod
    def encode(cls, value: bytes) -> bytes:
        """Encode the data using the encoder.

        Args:
            value: The data to encode.

        Returns:
            The encoded data.
        """
        ...

    @classmethod
    def get_json_format(cls) -> str:
        """Get the JSON format for the encoded data.

        Returns:
            The JSON format for the encoded data.
        """
        ...


class Base64Encoder(EncoderProtocol):
    """Standard (non-URL-safe) Base64 encoder."""

    @classmethod
    def decode(cls, data: bytes) -> bytes:
        """Decode the data from base64 encoded bytes to original bytes data.

        Args:
            data: The data to decode.

        Returns:
            The decoded data.
        """
        try:
            return base64.decodebytes(data)
        except ValueError as e:
            raise PydanticCustomError('base64_decode', "Base64 decoding error: '{error}'", {'error': str(e)})

    @classmethod
    def encode(cls, value: bytes) -> bytes:
        """Encode the data from bytes to a base64 encoded bytes.

        Args:
            value: The data to encode.

        Returns:
            The encoded data.
        """
        return base64.encodebytes(value)

    @classmethod
    def get_json_format(cls) -> Literal['base64']:
        """Get the JSON format for the encoded data.

        Returns:
            The JSON format for the encoded data.
        """
        return 'base64'


class Base64UrlEncoder(EncoderProtocol):
    """URL-safe Base64 encoder."""

    @classmethod
    def decode(cls, data: bytes) -> bytes:
        """Decode the data from base64 encoded bytes to original bytes data.

        Args:
            data: The data to decode.

        Returns:
            The decoded data.
        """
        try:
            return base64.urlsafe_b64decode(data)
        except ValueError as e:
            raise PydanticCustomError('base64_decode', "Base64 decoding error: '{error}'", {'error': str(e)})

    @classmethod
    def encode(cls, value: bytes) -> bytes:
        """Encode the data from bytes to a base64 encoded bytes.

        Args:
            value: The data to encode.

        Returns:
            The encoded data.
        """
        return base64.urlsafe_b64encode(value)

    @classmethod
    def get_json_format(cls) -> Literal['base64url']:
        """Get the JSON format for the encoded data.

        Returns:
            The JSON format for the encoded data.
        """
        return 'base64url'


@_dataclasses.dataclass(**_internal_dataclass.slots_true)
class EncodedBytes:
    """A bytes type that is encoded and decoded using the specified encoder.

    `EncodedBytes` needs an encoder that implements `EncoderProtocol` to operate.

    ```py
    from typing_extensions import Annotated

    from pydantic import BaseModel, EncodedBytes, EncoderProtocol, ValidationError

    class MyEncoder(EncoderProtocol):
        @classmethod
        def decode(cls, data: bytes) -> bytes:
            if data == b'**undecodable**':
                raise ValueError('Cannot decode data')
            return data[13:]

        @classmethod
        def encode(cls, value: bytes) -> bytes:
            return b'**encoded**: ' + value

        @classmethod
        def get_json_format(cls) -> str:
            return 'my-encoder'

    MyEncodedBytes = Annotated[bytes, EncodedBytes(encoder=MyEncoder)]

    class Model(BaseModel):
        my_encoded_bytes: MyEncodedBytes

    # Initialize the model with encoded data
    m = Model(my_encoded_bytes=b'**encoded**: some bytes')

    # Access decoded value
    print(m.my_encoded_bytes)
    #> b'some bytes'

    # Serialize into the encoded form
    print(m.model_dump())
    #> {'my_encoded_bytes': b'**encoded**: some bytes'}

    # Validate encoded data
    try:
        Model(my_encoded_bytes=b'**undecodable**')
    except ValidationError as e:
        print(e)
        '''
        1 validation error for Model
        my_encoded_bytes
          Value error, Cannot decode data [type=value_error, input_value=b'**undecodable**', input_type=bytes]
        '''
    ```
    """

    encoder: type[EncoderProtocol]

    def __get_pydantic_json_schema__(
        self, core_schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        field_schema = handler(core_schema)
        field_schema.update(type='string', format=self.encoder.get_json_format())
        return field_schema

    def __get_pydantic_core_schema__(self, source: type[Any], handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        return core_schema.with_info_after_validator_function(
            function=self.decode,
            schema=core_schema.bytes_schema(),
            serialization=core_schema.plain_serializer_function_ser_schema(function=self.encode),
        )

    def decode(self, data: bytes, _: core_schema.ValidationInfo) -> bytes:
        """Decode the data using the specified encoder.

        Args:
            data: The data to decode.

        Returns:
            The decoded data.
        """
        return self.encoder.decode(data)

    def encode(self, value: bytes) -> bytes:
        """Encode the data using the specified encoder.

        Args:
            value: The data to encode.

        Returns:
            The encoded data.
        """
        return self.encoder.encode(value)

    def __hash__(self) -> int:
        return hash(self.encoder)


@_dataclasses.dataclass(**_internal_dataclass.slots_true)
class EncodedStr(EncodedBytes):
    """A str type that is encoded and decoded using the specified encoder.

    `EncodedStr` needs an encoder that implements `EncoderProtocol` to operate.

    ```py
    from typing_extensions import Annotated

    from pydantic import BaseModel, EncodedStr, EncoderProtocol, ValidationError

    class MyEncoder(EncoderProtocol):
        @classmethod
        def decode(cls, data: bytes) -> bytes:
            if data == b'**undecodable**':
                raise ValueError('Cannot decode data')
            return data[13:]

        @classmethod
        def encode(cls, value: bytes) -> bytes:
            return b'**encoded**: ' + value

        @classmethod
        def get_json_format(cls) -> str:
            return 'my-encoder'

    MyEncodedStr = Annotated[str, EncodedStr(encoder=MyEncoder)]

    class Model(BaseModel):
        my_encoded_str: MyEncodedStr

    # Initialize the model with encoded data
    m = Model(my_encoded_str='**encoded**: some str')

    # Access decoded value
    print(m.my_encoded_str)
    #> some str

    # Serialize into the encoded form
    print(m.model_dump())
    #> {'my_encoded_str': '**encoded**: some str'}

    # Validate encoded data
    try:
        Model(my_encoded_str='**undecodable**')
    except ValidationError as e:
        print(e)
        '''
        1 validation error for Model
        my_encoded_str
          Value error, Cannot decode data [type=value_error, input_value='**undecodable**', input_type=str]
        '''
    ```
    """

    def __get_pydantic_core_schema__(self, source: type[Any], handler: GetCoreSchemaHandler) -> core_schema.CoreSchema:
        return core_schema.with_info_after_validator_function(
            function=self.decode_str,
            schema=super(EncodedStr, self).__get_pydantic_core_schema__(source=source, handler=handler),  # noqa: UP008
            serialization=core_schema.plain_serializer_function_ser_schema(function=self.encode_str),
        )

    def decode_str(self, data: bytes, _: core_schema.ValidationInfo) -> str:
        """Decode the data using the specified encoder.

        Args:
            data: The data to decode.

        Returns:
            The decoded data.
        """
        return data.decode()

    def encode_str(self, value: str) -> str:
        """Encode the data using the specified encoder.

        Args:
            value: The data to encode.

        Returns:
            The encoded data.
        """
        return super(EncodedStr, self).encode(value=value.encode()).decode()  # noqa: UP008

    def __hash__(self) -> int:
        return hash(self.encoder)


Base64Bytes = Annotated[bytes, EncodedBytes(encoder=Base64Encoder)]
"""A bytes type that is encoded and decoded using the standard (non-URL-safe) base64 encoder.

Note:
    Under the hood, `Base64Bytes` use standard library `base64.encodebytes` and `base64.decodebytes` functions.

    As a result, attempting to decode url-safe base64 data using the `Base64Bytes` type may fail or produce an incorrect
    decoding.

```py
from pydantic import Base64Bytes, BaseModel, ValidationError

class Model(BaseModel):
    base64_bytes: Base64Bytes

# Initialize the model with base64 data
m = Model(base64_bytes=b'VGhpcyBpcyB0aGUgd2F5')

# Access decoded value
print(m.base64_bytes)
#> b'This is the way'

# Serialize into the base64 form
print(m.model_dump())
#> {'base64_bytes': b'VGhpcyBpcyB0aGUgd2F5\n'}

# Validate base64 data
try:
    print(Model(base64_bytes=b'undecodable').base64_bytes)
except ValidationError as e:
    print(e)
    '''
    1 validation error for Model
    base64_bytes
      Base64 decoding error: 'Incorrect padding' [type=base64_decode, input_value=b'undecodable', input_type=bytes]
    '''
```
"""
Base64Str = Annotated[str, EncodedStr(encoder=Base64Encoder)]
"""A str type that is encoded and decoded using the standard (non-URL-safe) base64 encoder.

Note:
    Under the hood, `Base64Bytes` use standard library `base64.encodebytes` and `base64.decodebytes` functions.

    As a result, attempting to decode url-safe base64 data using the `Base64Str` type may fail or produce an incorrect
    decoding.

```py
from pydantic import Base64Str, BaseModel, ValidationError

class Model(BaseModel):
    base64_str: Base64Str

# Initialize the model with base64 data
m = Model(base64_str='VGhlc2UgYXJlbid0IHRoZSBkcm9pZHMgeW91J3JlIGxvb2tpbmcgZm9y')

# Access decoded value
print(m.base64_str)
#> These aren't the droids you're looking for

# Serialize into the base64 form
print(m.model_dump())
#> {'base64_str': 'VGhlc2UgYXJlbid0IHRoZSBkcm9pZHMgeW91J3JlIGxvb2tpbmcgZm9y\n'}

# Validate base64 data
try:
    print(Model(base64_str='undecodable').base64_str)
except ValidationError as e:
    print(e)
    '''
    1 validation error for Model
    base64_str
      Base64 decoding error: 'Incorrect padding' [type=base64_decode, input_value='undecodable', input_type=str]
    '''
```
"""
Base64UrlBytes = Annotated[bytes, EncodedBytes(encoder=Base64UrlEncoder)]
"""A bytes type that is encoded and decoded using the URL-safe base64 encoder.

Note:
    Under the hood, `Base64UrlBytes` use standard library `base64.urlsafe_b64encode` and `base64.urlsafe_b64decode`
    functions.

    As a result, the `Base64UrlBytes` type can be used to faithfully decode "vanilla" base64 data
    (using `'+'` and `'/'`).

```py
from pydantic import Base64UrlBytes, BaseModel

class Model(BaseModel):
    base64url_bytes: Base64UrlBytes

# Initialize the model with base64 data
m = Model(base64url_bytes=b'SHc_dHc-TXc==')
print(m)
#> base64url_bytes=b'Hw?tw>Mw'
```
"""
Base64UrlStr = Annotated[str, EncodedStr(encoder=Base64UrlEncoder)]
"""A str type that is encoded and decoded using the URL-safe base64 encoder.

Note:
    Under the hood, `Base64UrlStr` use standard library `base64.urlsafe_b64encode` and `base64.urlsafe_b64decode`
    functions.

    As a result, the `Base64UrlStr` type can be used to faithfully decode "vanilla" base64 data (using `'+'` and `'/'`).

```py
from pydantic import Base64UrlStr, BaseModel

class Model(BaseModel):
    base64url_str: Base64UrlStr

# Initialize the model with base64 data
m = Model(base64url_str='SHc_dHc-TXc==')
print(m)
#> base64url_str='Hw?tw>Mw'
```
"""


__getattr__ = getattr_migration(__name__)


@_dataclasses.dataclass(**_internal_dataclass.slots_true)
class GetPydanticSchema:
    """Usage docs: https://docs.pydantic.dev/2.5/concepts/types/#using-getpydanticschema-to-reduce-boilerplate

    A convenience class for creating an annotation that provides pydantic custom type hooks.

    This class is intended to eliminate the need to create a custom "marker" which defines the
     `__get_pydantic_core_schema__` and `__get_pydantic_json_schema__` custom hook methods.

    For example, to have a field treated by type checkers as `int`, but by pydantic as `Any`, you can do:
    ```python
    from typing import Any

    from typing_extensions import Annotated

    from pydantic import BaseModel, GetPydanticSchema

    HandleAsAny = GetPydanticSchema(lambda _s, h: h(Any))

    class Model(BaseModel):
        x: Annotated[int, HandleAsAny]  # pydantic sees `x: Any`

    print(repr(Model(x='abc').x))
    #> 'abc'
    ```
    """

    get_pydantic_core_schema: Callable[[Any, GetCoreSchemaHandler], CoreSchema] | None = None
    get_pydantic_json_schema: Callable[[Any, GetJsonSchemaHandler], JsonSchemaValue] | None = None

    # Note: we may want to consider adding a convenience staticmethod `def for_type(type_: Any) -> GetPydanticSchema:`
    #   which returns `GetPydanticSchema(lambda _s, h: h(type_))`

    if not TYPE_CHECKING:
        # We put `__getattr__` in a non-TYPE_CHECKING block because otherwise, mypy allows arbitrary attribute access

        def __getattr__(self, item: str) -> Any:
            """Use this rather than defining `__get_pydantic_core_schema__` etc. to reduce the number of nested calls."""
            if item == '__get_pydantic_core_schema__' and self.get_pydantic_core_schema:
                return self.get_pydantic_core_schema
            elif item == '__get_pydantic_json_schema__' and self.get_pydantic_json_schema:
                return self.get_pydantic_json_schema
            else:
                return object.__getattribute__(self, item)

    __hash__ = object.__hash__


@_dataclasses.dataclass(**_internal_dataclass.slots_true, frozen=True)
class Tag:
    """Provides a way to specify the expected tag to use for a case of a (callable) discriminated union.

    Also provides a way to label a union case in error messages.

    When using a callable `Discriminator`, attach a `Tag` to each case in the `Union` to specify the tag that
    should be used to identify that case. For example, in the below example, the `Tag` is used to specify that
    if `get_discriminator_value` returns `'apple'`, the input should be validated as an `ApplePie`, and if it
    returns `'pumpkin'`, the input should be validated as a `PumpkinPie`.

    The primary role of the `Tag` here is to map the return value from the callable `Discriminator` function to
    the appropriate member of the `Union` in question.

    ```py
    from typing import Any, Union

    from typing_extensions import Annotated, Literal

    from pydantic import BaseModel, Discriminator, Tag

    class Pie(BaseModel):
        time_to_cook: int
        num_ingredients: int

    class ApplePie(Pie):
        fruit: Literal['apple'] = 'apple'

    class PumpkinPie(Pie):
        filling: Literal['pumpkin'] = 'pumpkin'

    def get_discriminator_value(v: Any) -> str:
        if isinstance(v, dict):
            return v.get('fruit', v.get('filling'))
        return getattr(v, 'fruit', getattr(v, 'filling', None))

    class ThanksgivingDinner(BaseModel):
        dessert: Annotated[
            Union[
                Annotated[ApplePie, Tag('apple')],
                Annotated[PumpkinPie, Tag('pumpkin')],
            ],
            Discriminator(get_discriminator_value),
        ]

    apple_variation = ThanksgivingDinner.model_validate(
        {'dessert': {'fruit': 'apple', 'time_to_cook': 60, 'num_ingredients': 8}}
    )
    print(repr(apple_variation))
    '''
    ThanksgivingDinner(dessert=ApplePie(time_to_cook=60, num_ingredients=8, fruit='apple'))
    '''

    pumpkin_variation = ThanksgivingDinner.model_validate(
        {
            'dessert': {
                'filling': 'pumpkin',
                'time_to_cook': 40,
                'num_ingredients': 6,
            }
        }
    )
    print(repr(pumpkin_variation))
    '''
    ThanksgivingDinner(dessert=PumpkinPie(time_to_cook=40, num_ingredients=6, filling='pumpkin'))
    '''
    ```

    !!! note
        You must specify a `Tag` for every case in a `Tag` that is associated with a
        callable `Discriminator`. Failing to do so will result in a `PydanticUserError` with code
        [`callable-discriminator-no-tag`](../errors/usage_errors.md#callable-discriminator-no-tag).

    See the [Discriminated Unions] concepts docs for more details on how to use `Tag`s.

    [Discriminated Unions]: ../concepts/unions.md#discriminated-unions
    """

    tag: str

    def __get_pydantic_core_schema__(self, source_type: Any, handler: GetCoreSchemaHandler) -> CoreSchema:
        schema = handler(source_type)
        metadata = schema.setdefault('metadata', {})
        assert isinstance(metadata, dict)
        metadata[_core_utils.TAGGED_UNION_TAG_KEY] = self.tag
        return schema


@_dataclasses.dataclass(**_internal_dataclass.slots_true, frozen=True)
class Discriminator:
    """Usage docs: https://docs.pydantic.dev/2.5/concepts/unions/#discriminated-unions-with-callable-discriminator

    Provides a way to use a custom callable as the way to extract the value of a union discriminator.

    This allows you to get validation behavior like you'd get from `Field(discriminator=<field_name>)`,
    but without needing to have a single shared field across all the union choices. This also makes it
    possible to handle unions of models and primitive types with discriminated-union-style validation errors.
    Finally, this allows you to use a custom callable as the way to identify which member of a union a value
    belongs to, while still seeing all the performance benefits of a discriminated union.

    Consider this example, which is much more performant with the use of `Discriminator` and thus a `TaggedUnion`
    than it would be as a normal `Union`.

    ```py
    from typing import Any, Union

    from typing_extensions import Annotated, Literal

    from pydantic import BaseModel, Discriminator, Tag

    class Pie(BaseModel):
        time_to_cook: int
        num_ingredients: int

    class ApplePie(Pie):
        fruit: Literal['apple'] = 'apple'

    class PumpkinPie(Pie):
        filling: Literal['pumpkin'] = 'pumpkin'

    def get_discriminator_value(v: Any) -> str:
        if isinstance(v, dict):
            return v.get('fruit', v.get('filling'))
        return getattr(v, 'fruit', getattr(v, 'filling', None))

    class ThanksgivingDinner(BaseModel):
        dessert: Annotated[
            Union[
                Annotated[ApplePie, Tag('apple')],
                Annotated[PumpkinPie, Tag('pumpkin')],
            ],
            Discriminator(get_discriminator_value),
        ]

    apple_variation = ThanksgivingDinner.model_validate(
        {'dessert': {'fruit': 'apple', 'time_to_cook': 60, 'num_ingredients': 8}}
    )
    print(repr(apple_variation))
    '''
    ThanksgivingDinner(dessert=ApplePie(time_to_cook=60, num_ingredients=8, fruit='apple'))
    '''

    pumpkin_variation = ThanksgivingDinner.model_validate(
        {
            'dessert': {
                'filling': 'pumpkin',
                'time_to_cook': 40,
                'num_ingredients': 6,
            }
        }
    )
    print(repr(pumpkin_variation))
    '''
    ThanksgivingDinner(dessert=PumpkinPie(time_to_cook=40, num_ingredients=6, filling='pumpkin'))
    '''
    ```

    See the [Discriminated Unions] concepts docs for more details on how to use `Discriminator`s.

    [Discriminated Unions]: ../concepts/unions.md#discriminated-unions
    """

    discriminator: str | Callable[[Any], Hashable]
    """The callable or field name for discriminating the type in a tagged union.

    A `Callable` discriminator must extract the value of the discriminator from the input.
    A `str` discriminator must be the name of a field to discriminate against.
    """
    custom_error_type: str | None = None
    """Type to use in [custom errors](../errors/errors.md#custom-errors) replacing the standard discriminated union
    validation errors.
    """
    custom_error_message: str | None = None
    """Message to use in custom errors."""
    custom_error_context: dict[str, int | str | float] | None = None
    """Context to use in custom errors."""

    def __get_pydantic_core_schema__(self, source_type: Any, handler: GetCoreSchemaHandler) -> CoreSchema:
        origin = _typing_extra.get_origin(source_type)
        if not origin or not _typing_extra.origin_is_union(origin):
            raise TypeError(f'{type(self).__name__} must be used with a Union type, not {source_type}')

        if isinstance(self.discriminator, str):
            from pydantic import Field

            return handler(Annotated[source_type, Field(discriminator=self.discriminator)])
        else:
            original_schema = handler(source_type)
            return self._convert_schema(original_schema)

    def _convert_schema(self, original_schema: core_schema.CoreSchema) -> core_schema.TaggedUnionSchema:
        if original_schema['type'] != 'union':
            # This likely indicates that the schema was a single-item union that was simplified.
            # In this case, we do the same thing we do in
            # `pydantic._internal._discriminated_union._ApplyInferredDiscriminator._apply_to_root`, namely,
            # package the generated schema back into a single-item union.
            original_schema = core_schema.union_schema([original_schema])

        tagged_union_choices = {}
        for i, choice in enumerate(original_schema['choices']):
            tag = None
            if isinstance(choice, tuple):
                choice, tag = choice
            metadata = choice.get('metadata')
            if metadata is not None:
                metadata_tag = metadata.get(_core_utils.TAGGED_UNION_TAG_KEY)
                if metadata_tag is not None:
                    tag = metadata_tag
            if tag is None:
                raise PydanticUserError(
                    f'`Tag` not provided for choice {choice} used with `Discriminator`',
                    code='callable-discriminator-no-tag',
                )
            tagged_union_choices[tag] = choice

        # Have to do these verbose checks to ensure falsy values ('' and {}) don't get ignored
        custom_error_type = self.custom_error_type
        if custom_error_type is None:
            custom_error_type = original_schema.get('custom_error_type')

        custom_error_message = self.custom_error_message
        if custom_error_message is None:
            custom_error_message = original_schema.get('custom_error_message')

        custom_error_context = self.custom_error_context
        if custom_error_context is None:
            custom_error_context = original_schema.get('custom_error_context')

        custom_error_type = original_schema.get('custom_error_type') if custom_error_type is None else custom_error_type
        return core_schema.tagged_union_schema(
            tagged_union_choices,
            self.discriminator,
            custom_error_type=custom_error_type,
            custom_error_message=custom_error_message,
            custom_error_context=custom_error_context,
            strict=original_schema.get('strict'),
            ref=original_schema.get('ref'),
            metadata=original_schema.get('metadata'),
            serialization=original_schema.get('serialization'),
        )


_JSON_TYPES = {int, float, str, bool, list, dict, type(None)}


def _get_type_name(x: Any) -> str:
    type_ = type(x)
    if type_ in _JSON_TYPES:
        return type_.__name__

    # Handle proper subclasses; note we don't need to handle None here
    if isinstance(x, bool):
        return 'bool'
    if isinstance(x, int):
        return 'int'
    if isinstance(x, float):
        return 'float'
    if isinstance(x, str):
        return 'str'
    if isinstance(x, list):
        return 'list'
    if isinstance(x, dict):
        return 'dict'

    # Fail by returning the type's actual name
    return getattr(type_, '__name__', '<no type name>')


class _AllowAnyJson:
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: Any, handler: GetCoreSchemaHandler) -> CoreSchema:
        python_schema = handler(source_type)
        return core_schema.json_or_python_schema(json_schema=core_schema.any_schema(), python_schema=python_schema)


if TYPE_CHECKING:
    # This seems to only be necessary for mypy
    JsonValue: TypeAlias = Union[
        List['JsonValue'],
        Dict[str, 'JsonValue'],
        str,
        bool,
        int,
        float,
        None,
    ]
    """A `JsonValue` is used to represent a value that can be serialized to JSON.

    It may be one of:

    * `List['JsonValue']`
    * `Dict[str, 'JsonValue']`
    * `str`
    * `bool`
    * `int`
    * `float`
    * `None`

    The following example demonstrates how to use `JsonValue` to validate JSON data,
    and what kind of errors to expect when input data is not json serializable.

    ```py
    import json

    from pydantic import BaseModel, JsonValue, ValidationError

    class Model(BaseModel):
        j: JsonValue

    valid_json_data = {'j': {'a': {'b': {'c': 1, 'd': [2, None]}}}}
    invalid_json_data = {'j': {'a': {'b': ...}}}

    print(repr(Model.model_validate(valid_json_data)))
    #> Model(j={'a': {'b': {'c': 1, 'd': [2, None]}}})
    print(repr(Model.model_validate_json(json.dumps(valid_json_data))))
    #> Model(j={'a': {'b': {'c': 1, 'd': [2, None]}}})

    try:
        Model.model_validate(invalid_json_data)
    except ValidationError as e:
        print(e)
        '''
        1 validation error for Model
        j.dict.a.dict.b
          input was not a valid JSON value [type=invalid-json-value, input_value=Ellipsis, input_type=ellipsis]
        '''
    ```
    """

else:
    JsonValue = TypeAliasType(
        'JsonValue',
        Annotated[
            Union[
                Annotated[List['JsonValue'], Tag('list')],
                Annotated[Dict[str, 'JsonValue'], Tag('dict')],
                Annotated[str, Tag('str')],
                Annotated[bool, Tag('bool')],
                Annotated[int, Tag('int')],
                Annotated[float, Tag('float')],
                Annotated[None, Tag('NoneType')],
            ],
            Discriminator(
                _get_type_name,
                custom_error_type='invalid-json-value',
                custom_error_message='input was not a valid JSON value',
            ),
            _AllowAnyJson,
        ],
    )
