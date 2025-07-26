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
from typing import Optional as _Optional
from typing import Union as _Union

from google.protobuf import descriptor as _descriptor
from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

DESCRIPTOR: _descriptor.FileDescriptor
RESOURCE_REFERENCE_FIELD_NUMBER: _ClassVar[int]
resource_reference: _descriptor.FieldDescriptor
RESOURCE_DEFINITION_FIELD_NUMBER: _ClassVar[int]
resource_definition: _descriptor.FieldDescriptor
RESOURCE_FIELD_NUMBER: _ClassVar[int]
resource: _descriptor.FieldDescriptor

class ResourceDescriptor(_message.Message):
    __slots__ = (
        "type",
        "pattern",
        "name_field",
        "history",
        "plural",
        "singular",
        "style",
    )

    class History(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        HISTORY_UNSPECIFIED: _ClassVar[ResourceDescriptor.History]
        ORIGINALLY_SINGLE_PATTERN: _ClassVar[ResourceDescriptor.History]
        FUTURE_MULTI_PATTERN: _ClassVar[ResourceDescriptor.History]
    HISTORY_UNSPECIFIED: ResourceDescriptor.History
    ORIGINALLY_SINGLE_PATTERN: ResourceDescriptor.History
    FUTURE_MULTI_PATTERN: ResourceDescriptor.History

    class Style(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        STYLE_UNSPECIFIED: _ClassVar[ResourceDescriptor.Style]
        DECLARATIVE_FRIENDLY: _ClassVar[ResourceDescriptor.Style]
    STYLE_UNSPECIFIED: ResourceDescriptor.Style
    DECLARATIVE_FRIENDLY: ResourceDescriptor.Style
    TYPE_FIELD_NUMBER: _ClassVar[int]
    PATTERN_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FIELD_NUMBER: _ClassVar[int]
    PLURAL_FIELD_NUMBER: _ClassVar[int]
    SINGULAR_FIELD_NUMBER: _ClassVar[int]
    STYLE_FIELD_NUMBER: _ClassVar[int]
    type: str
    pattern: _containers.RepeatedScalarFieldContainer[str]
    name_field: str
    history: ResourceDescriptor.History
    plural: str
    singular: str
    style: _containers.RepeatedScalarFieldContainer[ResourceDescriptor.Style]
    def __init__(
        self,
        type: _Optional[str] = ...,
        pattern: _Optional[_Iterable[str]] = ...,
        name_field: _Optional[str] = ...,
        history: _Optional[_Union[ResourceDescriptor.History, str]] = ...,
        plural: _Optional[str] = ...,
        singular: _Optional[str] = ...,
        style: _Optional[_Iterable[_Union[ResourceDescriptor.Style, str]]] = ...,
    ) -> None: ...

class ResourceReference(_message.Message):
    __slots__ = ("type", "child_type")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CHILD_TYPE_FIELD_NUMBER: _ClassVar[int]
    type: str
    child_type: str
    def __init__(
        self, type: _Optional[str] = ..., child_type: _Optional[str] = ...
    ) -> None: ...
