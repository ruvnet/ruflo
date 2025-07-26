# Copyright 2025 Google LLC
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

from typing import ClassVar as _ClassVar
from typing import Iterable as _Iterable
from typing import Mapping as _Mapping
from typing import Optional as _Optional
from typing import Union as _Union

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class Quota(_message.Message):
    __slots__ = ("limits", "metric_rules")
    LIMITS_FIELD_NUMBER: _ClassVar[int]
    METRIC_RULES_FIELD_NUMBER: _ClassVar[int]
    limits: _containers.RepeatedCompositeFieldContainer[QuotaLimit]
    metric_rules: _containers.RepeatedCompositeFieldContainer[MetricRule]
    def __init__(
        self,
        limits: _Optional[_Iterable[_Union[QuotaLimit, _Mapping]]] = ...,
        metric_rules: _Optional[_Iterable[_Union[MetricRule, _Mapping]]] = ...,
    ) -> None: ...

class MetricRule(_message.Message):
    __slots__ = ("selector", "metric_costs")

    class MetricCostsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: int
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[int] = ...
        ) -> None: ...
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    METRIC_COSTS_FIELD_NUMBER: _ClassVar[int]
    selector: str
    metric_costs: _containers.ScalarMap[str, int]
    def __init__(
        self,
        selector: _Optional[str] = ...,
        metric_costs: _Optional[_Mapping[str, int]] = ...,
    ) -> None: ...

class QuotaLimit(_message.Message):
    __slots__ = (
        "name",
        "description",
        "default_limit",
        "max_limit",
        "free_tier",
        "duration",
        "metric",
        "unit",
        "values",
        "display_name",
    )

    class ValuesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: int
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[int] = ...
        ) -> None: ...
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_LIMIT_FIELD_NUMBER: _ClassVar[int]
    MAX_LIMIT_FIELD_NUMBER: _ClassVar[int]
    FREE_TIER_FIELD_NUMBER: _ClassVar[int]
    DURATION_FIELD_NUMBER: _ClassVar[int]
    METRIC_FIELD_NUMBER: _ClassVar[int]
    UNIT_FIELD_NUMBER: _ClassVar[int]
    VALUES_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    default_limit: int
    max_limit: int
    free_tier: int
    duration: str
    metric: str
    unit: str
    values: _containers.ScalarMap[str, int]
    display_name: str
    def __init__(
        self,
        name: _Optional[str] = ...,
        description: _Optional[str] = ...,
        default_limit: _Optional[int] = ...,
        max_limit: _Optional[int] = ...,
        free_tier: _Optional[int] = ...,
        duration: _Optional[str] = ...,
        metric: _Optional[str] = ...,
        unit: _Optional[str] = ...,
        values: _Optional[_Mapping[str, int]] = ...,
        display_name: _Optional[str] = ...,
    ) -> None: ...
