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
ROUTING_FIELD_NUMBER: _ClassVar[int]
routing: _descriptor.FieldDescriptor

class RoutingRule(_message.Message):
    __slots__ = ("routing_parameters",)
    ROUTING_PARAMETERS_FIELD_NUMBER: _ClassVar[int]
    routing_parameters: _containers.RepeatedCompositeFieldContainer[RoutingParameter]
    def __init__(
        self,
        routing_parameters: _Optional[
            _Iterable[_Union[RoutingParameter, _Mapping]]
        ] = ...,
    ) -> None: ...

class RoutingParameter(_message.Message):
    __slots__ = ("field", "path_template")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    PATH_TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    field: str
    path_template: str
    def __init__(
        self, field: _Optional[str] = ..., path_template: _Optional[str] = ...
    ) -> None: ...
