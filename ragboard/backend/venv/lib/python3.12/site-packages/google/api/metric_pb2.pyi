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
from google.protobuf import duration_pb2 as _duration_pb2
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

from google.api import label_pb2 as _label_pb2
from google.api import launch_stage_pb2 as _launch_stage_pb2

DESCRIPTOR: _descriptor.FileDescriptor

class MetricDescriptor(_message.Message):
    __slots__ = (
        "name",
        "type",
        "labels",
        "metric_kind",
        "value_type",
        "unit",
        "description",
        "display_name",
        "metadata",
        "launch_stage",
        "monitored_resource_types",
    )

    class MetricKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        METRIC_KIND_UNSPECIFIED: _ClassVar[MetricDescriptor.MetricKind]
        GAUGE: _ClassVar[MetricDescriptor.MetricKind]
        DELTA: _ClassVar[MetricDescriptor.MetricKind]
        CUMULATIVE: _ClassVar[MetricDescriptor.MetricKind]
    METRIC_KIND_UNSPECIFIED: MetricDescriptor.MetricKind
    GAUGE: MetricDescriptor.MetricKind
    DELTA: MetricDescriptor.MetricKind
    CUMULATIVE: MetricDescriptor.MetricKind

    class ValueType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        VALUE_TYPE_UNSPECIFIED: _ClassVar[MetricDescriptor.ValueType]
        BOOL: _ClassVar[MetricDescriptor.ValueType]
        INT64: _ClassVar[MetricDescriptor.ValueType]
        DOUBLE: _ClassVar[MetricDescriptor.ValueType]
        STRING: _ClassVar[MetricDescriptor.ValueType]
        DISTRIBUTION: _ClassVar[MetricDescriptor.ValueType]
        MONEY: _ClassVar[MetricDescriptor.ValueType]
    VALUE_TYPE_UNSPECIFIED: MetricDescriptor.ValueType
    BOOL: MetricDescriptor.ValueType
    INT64: MetricDescriptor.ValueType
    DOUBLE: MetricDescriptor.ValueType
    STRING: MetricDescriptor.ValueType
    DISTRIBUTION: MetricDescriptor.ValueType
    MONEY: MetricDescriptor.ValueType

    class MetricDescriptorMetadata(_message.Message):
        __slots__ = (
            "launch_stage",
            "sample_period",
            "ingest_delay",
            "time_series_resource_hierarchy_level",
        )

        class TimeSeriesResourceHierarchyLevel(
            int, metaclass=_enum_type_wrapper.EnumTypeWrapper
        ):
            __slots__ = ()
            TIME_SERIES_RESOURCE_HIERARCHY_LEVEL_UNSPECIFIED: _ClassVar[
                MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
            ]
            PROJECT: _ClassVar[
                MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
            ]
            ORGANIZATION: _ClassVar[
                MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
            ]
            FOLDER: _ClassVar[
                MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
            ]
        TIME_SERIES_RESOURCE_HIERARCHY_LEVEL_UNSPECIFIED: MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
        PROJECT: MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
        ORGANIZATION: MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
        FOLDER: MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
        LAUNCH_STAGE_FIELD_NUMBER: _ClassVar[int]
        SAMPLE_PERIOD_FIELD_NUMBER: _ClassVar[int]
        INGEST_DELAY_FIELD_NUMBER: _ClassVar[int]
        TIME_SERIES_RESOURCE_HIERARCHY_LEVEL_FIELD_NUMBER: _ClassVar[int]
        launch_stage: _launch_stage_pb2.LaunchStage
        sample_period: _duration_pb2.Duration
        ingest_delay: _duration_pb2.Duration
        time_series_resource_hierarchy_level: _containers.RepeatedScalarFieldContainer[
            MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel
        ]
        def __init__(
            self,
            launch_stage: _Optional[_Union[_launch_stage_pb2.LaunchStage, str]] = ...,
            sample_period: _Optional[_Union[_duration_pb2.Duration, _Mapping]] = ...,
            ingest_delay: _Optional[_Union[_duration_pb2.Duration, _Mapping]] = ...,
            time_series_resource_hierarchy_level: _Optional[
                _Iterable[
                    _Union[
                        MetricDescriptor.MetricDescriptorMetadata.TimeSeriesResourceHierarchyLevel,
                        str,
                    ]
                ]
            ] = ...,
        ) -> None: ...
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    METRIC_KIND_FIELD_NUMBER: _ClassVar[int]
    VALUE_TYPE_FIELD_NUMBER: _ClassVar[int]
    UNIT_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    LAUNCH_STAGE_FIELD_NUMBER: _ClassVar[int]
    MONITORED_RESOURCE_TYPES_FIELD_NUMBER: _ClassVar[int]
    name: str
    type: str
    labels: _containers.RepeatedCompositeFieldContainer[_label_pb2.LabelDescriptor]
    metric_kind: MetricDescriptor.MetricKind
    value_type: MetricDescriptor.ValueType
    unit: str
    description: str
    display_name: str
    metadata: MetricDescriptor.MetricDescriptorMetadata
    launch_stage: _launch_stage_pb2.LaunchStage
    monitored_resource_types: _containers.RepeatedScalarFieldContainer[str]
    def __init__(
        self,
        name: _Optional[str] = ...,
        type: _Optional[str] = ...,
        labels: _Optional[
            _Iterable[_Union[_label_pb2.LabelDescriptor, _Mapping]]
        ] = ...,
        metric_kind: _Optional[_Union[MetricDescriptor.MetricKind, str]] = ...,
        value_type: _Optional[_Union[MetricDescriptor.ValueType, str]] = ...,
        unit: _Optional[str] = ...,
        description: _Optional[str] = ...,
        display_name: _Optional[str] = ...,
        metadata: _Optional[
            _Union[MetricDescriptor.MetricDescriptorMetadata, _Mapping]
        ] = ...,
        launch_stage: _Optional[_Union[_launch_stage_pb2.LaunchStage, str]] = ...,
        monitored_resource_types: _Optional[_Iterable[str]] = ...,
    ) -> None: ...

class Metric(_message.Message):
    __slots__ = ("type", "labels")

    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...
    TYPE_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    type: str
    labels: _containers.ScalarMap[str, str]
    def __init__(
        self, type: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...
    ) -> None: ...
