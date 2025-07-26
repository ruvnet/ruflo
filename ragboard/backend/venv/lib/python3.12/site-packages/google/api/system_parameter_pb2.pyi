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

class SystemParameters(_message.Message):
    __slots__ = ("rules",)
    RULES_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[SystemParameterRule]
    def __init__(
        self, rules: _Optional[_Iterable[_Union[SystemParameterRule, _Mapping]]] = ...
    ) -> None: ...

class SystemParameterRule(_message.Message):
    __slots__ = ("selector", "parameters")
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    PARAMETERS_FIELD_NUMBER: _ClassVar[int]
    selector: str
    parameters: _containers.RepeatedCompositeFieldContainer[SystemParameter]
    def __init__(
        self,
        selector: _Optional[str] = ...,
        parameters: _Optional[_Iterable[_Union[SystemParameter, _Mapping]]] = ...,
    ) -> None: ...

class SystemParameter(_message.Message):
    __slots__ = ("name", "http_header", "url_query_parameter")
    NAME_FIELD_NUMBER: _ClassVar[int]
    HTTP_HEADER_FIELD_NUMBER: _ClassVar[int]
    URL_QUERY_PARAMETER_FIELD_NUMBER: _ClassVar[int]
    name: str
    http_header: str
    url_query_parameter: str
    def __init__(
        self,
        name: _Optional[str] = ...,
        http_header: _Optional[str] = ...,
        url_query_parameter: _Optional[str] = ...,
    ) -> None: ...
