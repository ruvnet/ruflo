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
from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor
ENUM_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
enum_visibility: _descriptor.FieldDescriptor
VALUE_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
value_visibility: _descriptor.FieldDescriptor
FIELD_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
field_visibility: _descriptor.FieldDescriptor
MESSAGE_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
message_visibility: _descriptor.FieldDescriptor
METHOD_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
method_visibility: _descriptor.FieldDescriptor
API_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
api_visibility: _descriptor.FieldDescriptor

class Visibility(_message.Message):
    __slots__ = ("rules",)
    RULES_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[VisibilityRule]
    def __init__(
        self, rules: _Optional[_Iterable[_Union[VisibilityRule, _Mapping]]] = ...
    ) -> None: ...

class VisibilityRule(_message.Message):
    __slots__ = ("selector", "restriction")
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    RESTRICTION_FIELD_NUMBER: _ClassVar[int]
    selector: str
    restriction: str
    def __init__(
        self, selector: _Optional[str] = ..., restriction: _Optional[str] = ...
    ) -> None: ...
