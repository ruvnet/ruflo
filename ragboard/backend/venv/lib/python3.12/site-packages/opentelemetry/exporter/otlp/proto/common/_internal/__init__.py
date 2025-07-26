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


from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Mapping,
    Optional,
    TypeVar,
)

from opentelemetry.proto.common.v1.common_pb2 import AnyValue as PB2AnyValue
from opentelemetry.proto.common.v1.common_pb2 import (
    ArrayValue as PB2ArrayValue,
)
from opentelemetry.proto.common.v1.common_pb2 import (
    InstrumentationScope as PB2InstrumentationScope,
)
from opentelemetry.proto.common.v1.common_pb2 import KeyValue as PB2KeyValue
from opentelemetry.proto.common.v1.common_pb2 import (
    KeyValueList as PB2KeyValueList,
)
from opentelemetry.proto.resource.v1.resource_pb2 import (
    Resource as PB2Resource,
)
from opentelemetry.sdk.trace import Resource
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from opentelemetry.util.types import _ExtendedAttributes

_logger = logging.getLogger(__name__)

_TypingResourceT = TypeVar("_TypingResourceT")
_ResourceDataT = TypeVar("_ResourceDataT")


def _encode_instrumentation_scope(
    instrumentation_scope: InstrumentationScope,
) -> PB2InstrumentationScope:
    if instrumentation_scope is None:
        return PB2InstrumentationScope()
    return PB2InstrumentationScope(
        name=instrumentation_scope.name,
        version=instrumentation_scope.version,
        attributes=_encode_attributes(instrumentation_scope.attributes),
    )


def _encode_resource(resource: Resource) -> PB2Resource:
    return PB2Resource(attributes=_encode_attributes(resource.attributes))


def _encode_value(
    value: Any, allow_null: bool = False
) -> Optional[PB2AnyValue]:
    if allow_null is True and value is None:
        return None
    if isinstance(value, bool):
        return PB2AnyValue(bool_value=value)
    if isinstance(value, str):
        return PB2AnyValue(string_value=value)
    if isinstance(value, int):
        return PB2AnyValue(int_value=value)
    if isinstance(value, float):
        return PB2AnyValue(double_value=value)
    if isinstance(value, bytes):
        return PB2AnyValue(bytes_value=value)
    if isinstance(value, Sequence):
        return PB2AnyValue(
            array_value=PB2ArrayValue(
                values=_encode_array(value, allow_null=allow_null)
            )
        )
    elif isinstance(value, Mapping):
        return PB2AnyValue(
            kvlist_value=PB2KeyValueList(
                values=[
                    _encode_key_value(str(k), v, allow_null=allow_null)
                    for k, v in value.items()
                ]
            )
        )
    raise Exception(f"Invalid type {type(value)} of value {value}")


def _encode_key_value(
    key: str, value: Any, allow_null: bool = False
) -> PB2KeyValue:
    return PB2KeyValue(
        key=key, value=_encode_value(value, allow_null=allow_null)
    )


def _encode_array(
    array: Sequence[Any], allow_null: bool = False
) -> Sequence[PB2AnyValue]:
    if not allow_null:
        # Let the exception get raised by _encode_value()
        return [_encode_value(v, allow_null=allow_null) for v in array]

    return [
        _encode_value(v, allow_null=allow_null)
        if v is not None
        # Use an empty AnyValue to represent None in an array. Behavior may change pending
        # https://github.com/open-telemetry/opentelemetry-specification/issues/4392
        else PB2AnyValue()
        for v in array
    ]


def _encode_span_id(span_id: int) -> bytes:
    return span_id.to_bytes(length=8, byteorder="big", signed=False)


def _encode_trace_id(trace_id: int) -> bytes:
    return trace_id.to_bytes(length=16, byteorder="big", signed=False)


def _encode_attributes(
    attributes: _ExtendedAttributes,
    allow_null: bool = False,
) -> Optional[List[PB2KeyValue]]:
    if attributes:
        pb2_attributes = []
        for key, value in attributes.items():
            # pylint: disable=broad-exception-caught
            try:
                pb2_attributes.append(
                    _encode_key_value(key, value, allow_null=allow_null)
                )
            except Exception as error:
                _logger.exception("Failed to encode key %s: %s", key, error)
    else:
        pb2_attributes = None
    return pb2_attributes


def _get_resource_data(
    sdk_resource_scope_data: Dict[Resource, _ResourceDataT],
    resource_class: Callable[..., _TypingResourceT],
    name: str,
) -> List[_TypingResourceT]:
    resource_data = []

    for (
        sdk_resource,
        scope_data,
    ) in sdk_resource_scope_data.items():
        collector_resource = PB2Resource(
            attributes=_encode_attributes(sdk_resource.attributes)
        )
        resource_data.append(
            resource_class(
                **{
                    "resource": collector_resource,
                    "scope_{}".format(name): scope_data.values(),
                }
            )
        )
    return resource_data
