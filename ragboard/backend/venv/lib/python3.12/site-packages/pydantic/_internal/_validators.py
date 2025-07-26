"""Validator functions for standard library types.

Import of this module is deferred since it contains imports of many standard library modules.
"""

from __future__ import annotations as _annotations

import math
import re
import typing
from ipaddress import IPv4Address, IPv4Interface, IPv4Network, IPv6Address, IPv6Interface, IPv6Network
from typing import Any

from pydantic_core import PydanticCustomError, core_schema
from pydantic_core._pydantic_core import PydanticKnownError


def sequence_validator(
    __input_value: typing.Sequence[Any],
    validator: core_schema.ValidatorFunctionWrapHandler,
) -> typing.Sequence[Any]:
    """Validator for `Sequence` types, isinstance(v, Sequence) has already been called."""
    value_type = type(__input_value)

    # We don't accept any plain string as a sequence
    # Relevant issue: https://github.com/pydantic/pydantic/issues/5595
    if issubclass(value_type, (str, bytes)):
        raise PydanticCustomError(
            'sequence_str',
            "'{type_name}' instances are not allowed as a Sequence value",
            {'type_name': value_type.__name__},
        )

    v_list = validator(__input_value)

    # the rest of the logic is just re-creating the original type from `v_list`
    if value_type == list:
        return v_list
    elif issubclass(value_type, range):
        # return the list as we probably can't re-create the range
        return v_list
    else:
        # best guess at how to re-create the original type, more custom construction logic might be required
        return value_type(v_list)  # type: ignore[call-arg]


def import_string(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return _import_string_logic(value)
        except ImportError as e:
            raise PydanticCustomError('import_error', 'Invalid python path: {error}', {'error': str(e)}) from e
    else:
        # otherwise we just return the value and let the next validator do the rest of the work
        return value


def _import_string_logic(dotted_path: str) -> Any:
    """Inspired by uvicorn — dotted paths should include a colon before the final item if that item is not a module.
    (This is necessary to distinguish between a submodule and an attribute when there is a conflict.).

    If the dotted path does not include a colon and the final item is not a valid module, importing as an attribute
    rather than a submodule will be attempted automatically.

    So, for example, the following values of `dotted_path` result in the following returned values:
    * 'collections': <module 'collections'>
    * 'collections.abc': <module 'collections.abc'>
    * 'collections.abc:Mapping': <class 'collections.abc.Mapping'>
    * `collections.abc.Mapping`: <class 'collections.abc.Mapping'> (though this is a bit slower than the previous line)

    An error will be raised under any of the following scenarios:
    * `dotted_path` contains more than one colon (e.g., 'collections:abc:Mapping')
    * the substring of `dotted_path` before the colon is not a valid module in the environment (e.g., '123:Mapping')
    * the substring of `dotted_path` after the colon is not an attribute of the module (e.g., 'collections:abc123')
    """
    from importlib import import_module

    components = dotted_path.strip().split(':')
    if len(components) > 2:
        raise ImportError(f"Import strings should have at most one ':'; received {dotted_path!r}")

    module_path = components[0]
    if not module_path:
        raise ImportError(f'Import strings should have a nonempty module name; received {dotted_path!r}')

    try:
        module = import_module(module_path)
    except ModuleNotFoundError as e:
        if '.' in module_path:
            # Check if it would be valid if the final item was separated from its module with a `:`
            maybe_module_path, maybe_attribute = dotted_path.strip().rsplit('.', 1)
            try:
                return _import_string_logic(f'{maybe_module_path}:{maybe_attribute}')
            except ImportError:
                pass
            raise ImportError(f'No module named {module_path!r}') from e
        raise e

    if len(components) > 1:
        attribute = components[1]
        try:
            return getattr(module, attribute)
        except AttributeError as e:
            raise ImportError(f'cannot import name {attribute!r} from {module_path!r}') from e
    else:
        return module


def pattern_either_validator(__input_value: Any) -> typing.Pattern[Any]:
    if isinstance(__input_value, typing.Pattern):
        return __input_value
    elif isinstance(__input_value, (str, bytes)):
        # todo strict mode
        return compile_pattern(__input_value)  # type: ignore
    else:
        raise PydanticCustomError('pattern_type', 'Input should be a valid pattern')


def pattern_str_validator(__input_value: Any) -> typing.Pattern[str]:
    if isinstance(__input_value, typing.Pattern):
        if isinstance(__input_value.pattern, str):
            return __input_value
        else:
            raise PydanticCustomError('pattern_str_type', 'Input should be a string pattern')
    elif isinstance(__input_value, str):
        return compile_pattern(__input_value)
    elif isinstance(__input_value, bytes):
        raise PydanticCustomError('pattern_str_type', 'Input should be a string pattern')
    else:
        raise PydanticCustomError('pattern_type', 'Input should be a valid pattern')


def pattern_bytes_validator(__input_value: Any) -> typing.Pattern[bytes]:
    if isinstance(__input_value, typing.Pattern):
        if isinstance(__input_value.pattern, bytes):
            return __input_value
        else:
            raise PydanticCustomError('pattern_bytes_type', 'Input should be a bytes pattern')
    elif isinstance(__input_value, bytes):
        return compile_pattern(__input_value)
    elif isinstance(__input_value, str):
        raise PydanticCustomError('pattern_bytes_type', 'Input should be a bytes pattern')
    else:
        raise PydanticCustomError('pattern_type', 'Input should be a valid pattern')


PatternType = typing.TypeVar('PatternType', str, bytes)


def compile_pattern(pattern: PatternType) -> typing.Pattern[PatternType]:
    try:
        return re.compile(pattern)
    except re.error:
        raise PydanticCustomError('pattern_regex', 'Input should be a valid regular expression')


def ip_v4_address_validator(__input_value: Any) -> IPv4Address:
    if isinstance(__input_value, IPv4Address):
        return __input_value

    try:
        return IPv4Address(__input_value)
    except ValueError:
        raise PydanticCustomError('ip_v4_address', 'Input is not a valid IPv4 address')


def ip_v6_address_validator(__input_value: Any) -> IPv6Address:
    if isinstance(__input_value, IPv6Address):
        return __input_value

    try:
        return IPv6Address(__input_value)
    except ValueError:
        raise PydanticCustomError('ip_v6_address', 'Input is not a valid IPv6 address')


def ip_v4_network_validator(__input_value: Any) -> IPv4Network:
    """Assume IPv4Network initialised with a default `strict` argument.

    See more:
    https://docs.python.org/library/ipaddress.html#ipaddress.IPv4Network
    """
    if isinstance(__input_value, IPv4Network):
        return __input_value

    try:
        return IPv4Network(__input_value)
    except ValueError:
        raise PydanticCustomError('ip_v4_network', 'Input is not a valid IPv4 network')


def ip_v6_network_validator(__input_value: Any) -> IPv6Network:
    """Assume IPv6Network initialised with a default `strict` argument.

    See more:
    https://docs.python.org/library/ipaddress.html#ipaddress.IPv6Network
    """
    if isinstance(__input_value, IPv6Network):
        return __input_value

    try:
        return IPv6Network(__input_value)
    except ValueError:
        raise PydanticCustomError('ip_v6_network', 'Input is not a valid IPv6 network')


def ip_v4_interface_validator(__input_value: Any) -> IPv4Interface:
    if isinstance(__input_value, IPv4Interface):
        return __input_value

    try:
        return IPv4Interface(__input_value)
    except ValueError:
        raise PydanticCustomError('ip_v4_interface', 'Input is not a valid IPv4 interface')


def ip_v6_interface_validator(__input_value: Any) -> IPv6Interface:
    if isinstance(__input_value, IPv6Interface):
        return __input_value

    try:
        return IPv6Interface(__input_value)
    except ValueError:
        raise PydanticCustomError('ip_v6_interface', 'Input is not a valid IPv6 interface')


def greater_than_validator(x: Any, gt: Any) -> Any:
    if not (x > gt):
        raise PydanticKnownError('greater_than', {'gt': gt})
    return x


def greater_than_or_equal_validator(x: Any, ge: Any) -> Any:
    if not (x >= ge):
        raise PydanticKnownError('greater_than_equal', {'ge': ge})
    return x


def less_than_validator(x: Any, lt: Any) -> Any:
    if not (x < lt):
        raise PydanticKnownError('less_than', {'lt': lt})
    return x


def less_than_or_equal_validator(x: Any, le: Any) -> Any:
    if not (x <= le):
        raise PydanticKnownError('less_than_equal', {'le': le})
    return x


def multiple_of_validator(x: Any, multiple_of: Any) -> Any:
    if not (x % multiple_of == 0):
        raise PydanticKnownError('multiple_of', {'multiple_of': multiple_of})
    return x


def min_length_validator(x: Any, min_length: Any) -> Any:
    if not (len(x) >= min_length):
        raise PydanticKnownError(
            'too_short',
            {'field_type': 'Value', 'min_length': min_length, 'actual_length': len(x)},
        )
    return x


def max_length_validator(x: Any, max_length: Any) -> Any:
    if len(x) > max_length:
        raise PydanticKnownError(
            'too_long',
            {'field_type': 'Value', 'max_length': max_length, 'actual_length': len(x)},
        )
    return x


def forbid_inf_nan_check(x: Any) -> Any:
    if not math.isfinite(x):
        raise PydanticKnownError('finite_number')
    return x
