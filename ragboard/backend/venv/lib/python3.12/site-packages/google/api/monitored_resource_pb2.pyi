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
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers

from google.api import label_pb2 as _label_pb2
from google.api import launch_stage_pb2 as _launch_stage_pb2

DESCRIPTOR: _descriptor.FileDescriptor

class MonitoredResourceDescriptor(_message.Message):
    __slots__ = (
        "name",
        "type",
        "display_name",
        "description",
        "labels",
        "launch_stage",
    )
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    LAUNCH_STAGE_FIELD_NUMBER: _ClassVar[int]
    name: str
    type: str
    display_name: str
    description: str
    labels: _containers.RepeatedCompositeFieldContainer[_label_pb2.LabelDescriptor]
    launch_stage: _launch_stage_pb2.LaunchStage
    def __init__(
        self,
        name: _Optional[str] = ...,
        type: _Optional[str] = ...,
        display_name: _Optional[str] = ...,
        description: _Optional[str] = ...,
        labels: _Optional[
            _Iterable[_Union[_label_pb2.LabelDescriptor, _Mapping]]
        ] = ...,
        launch_stage: _Optional[_Union[_launch_stage_pb2.LaunchStage, str]] = ...,
    ) -> None: ...

class MonitoredResource(_message.Message):
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

class MonitoredResourceMetadata(_message.Message):
    __slots__ = ("system_labels", "user_labels")

    class UserLabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...
    SYSTEM_LABELS_FIELD_NUMBER: _ClassVar[int]
    USER_LABELS_FIELD_NUMBER: _ClassVar[int]
    system_labels: _struct_pb2.Struct
    user_labels: _containers.ScalarMap[str, str]
    def __init__(
        self,
        system_labels: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...,
        user_labels: _Optional[_Mapping[str, str]] = ...,
    ) -> None: ...
