# Copyright The OpenTelemetry Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from logging import getLogger
from re import compile
from types import MappingProxyType
from typing import Dict, Mapping, Optional

from opentelemetry.context import create_key, get_value, set_value
from opentelemetry.context.context import Context
from opentelemetry.util.re import (
    _BAGGAGE_PROPERTY_FORMAT,
    _KEY_FORMAT,
    _VALUE_FORMAT,
)

_BAGGAGE_KEY = create_key("baggage")
_logger = getLogger(__name__)

_KEY_PATTERN = compile(_KEY_FORMAT)
_VALUE_PATTERN = compile(_VALUE_FORMAT)
_PROPERT_PATTERN = compile(_BAGGAGE_PROPERTY_FORMAT)


def get_all(
    context: Optional[Context] = None,
) -> Mapping[str, object]:
    """Returns the name/value pairs in the Baggage

    Args:
        context: The Context to use. If not set, uses current Context

    Returns:
        The name/value pairs in the Baggage
    """
    return MappingProxyType(_get_baggage_value(context=context))


def get_baggage(
    name: str, context: Optional[Context] = None
) -> Optional[object]:
    """Provides access to the value for a name/value pair in the
    Baggage

    Args:
        name: The name of the value to retrieve
        context: The Context to use. If not set, uses current Context

    Returns:
        The value associated with the given name, or null if the given name is
        not present.
    """
    return _get_baggage_value(context=context).get(name)


def set_baggage(
    name: str, value: object, context: Optional[Context] = None
) -> Context:
    """Sets a value in the Baggage

    Args:
        name: The name of the value to set
        value: The value to set
        context: The Context to use. If not set, uses current Context

    Returns:
        A Context with the value updated
    """
    baggage = _get_baggage_value(context=context).copy()
    baggage[name] = value
    return set_value(_BAGGAGE_KEY, baggage, context=context)


def remove_baggage(name: str, context: Optional[Context] = None) -> Context:
    """Removes a value from the Baggage

    Args:
        name: The name of the value to remove
        context: The Context to use. If not set, uses current Context

    Returns:
        A Context with the name/value removed
    """
    baggage = _get_baggage_value(context=context).copy()
    baggage.pop(name, None)

    return set_value(_BAGGAGE_KEY, baggage, context=context)


def clear(context: Optional[Context] = None) -> Context:
    """Removes all values from the Baggage

    Args:
        context: The Context to use. If not set, uses current Context

    Returns:
        A Context with all baggage entries removed
    """
    return set_value(_BAGGAGE_KEY, {}, context=context)


def _get_baggage_value(context: Optional[Context] = None) -> Dict[str, object]:
    baggage = get_value(_BAGGAGE_KEY, context=context)
    if isinstance(baggage, dict):
        return baggage
    return {}


def _is_valid_key(name: str) -> bool:
    return _KEY_PATTERN.fullmatch(str(name)) is not None


def _is_valid_value(value: object) -> bool:
    parts = str(value).split(";")
    is_valid_value = _VALUE_PATTERN.fullmatch(parts[0]) is not None
    if len(parts) > 1:  # one or more properties metadata
        for property in parts[1:]:
            if _PROPERT_PATTERN.fullmatch(property) is None:
                is_valid_value = False
                break
    return is_valid_value


def _is_valid_pair(key: str, value: str) -> bool:
    return _is_valid_key(key) and _is_valid_value(value)
