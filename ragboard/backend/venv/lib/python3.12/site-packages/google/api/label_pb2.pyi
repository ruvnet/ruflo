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
from typing import Optional as _Optional
from typing import Union as _Union

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

DESCRIPTOR: _descriptor.FileDescriptor

class LabelDescriptor(_message.Message):
    __slots__ = ("key", "value_type", "description")

    class ValueType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        STRING: _ClassVar[LabelDescriptor.ValueType]
        BOOL: _ClassVar[LabelDescriptor.ValueType]
        INT64: _ClassVar[LabelDescriptor.ValueType]
    STRING: LabelDescriptor.ValueType
    BOOL: LabelDescriptor.ValueType
    INT64: LabelDescriptor.ValueType
    KEY_FIELD_NUMBER: _ClassVar[int]
    VALUE_TYPE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    key: str
    value_type: LabelDescriptor.ValueType
    description: str
    def __init__(
        self,
        key: _Optional[str] = ...,
        value_type: _Optional[_Union[LabelDescriptor.ValueType, str]] = ...,
        description: _Optional[str] = ...,
    ) -> None: ...
