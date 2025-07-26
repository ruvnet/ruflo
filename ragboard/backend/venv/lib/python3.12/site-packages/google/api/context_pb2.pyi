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

class Context(_message.Message):
    __slots__ = ("rules",)
    RULES_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[ContextRule]
    def __init__(
        self, rules: _Optional[_Iterable[_Union[ContextRule, _Mapping]]] = ...
    ) -> None: ...

class ContextRule(_message.Message):
    __slots__ = (
        "selector",
        "requested",
        "provided",
        "allowed_request_extensions",
        "allowed_response_extensions",
    )
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_FIELD_NUMBER: _ClassVar[int]
    PROVIDED_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_REQUEST_EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_RESPONSE_EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    selector: str
    requested: _containers.RepeatedScalarFieldContainer[str]
    provided: _containers.RepeatedScalarFieldContainer[str]
    allowed_request_extensions: _containers.RepeatedScalarFieldContainer[str]
    allowed_response_extensions: _containers.RepeatedScalarFieldContainer[str]
    def __init__(
        self,
        selector: _Optional[str] = ...,
        requested: _Optional[_Iterable[str]] = ...,
        provided: _Optional[_Iterable[str]] = ...,
        allowed_request_extensions: _Optional[_Iterable[str]] = ...,
        allowed_response_extensions: _Optional[_Iterable[str]] = ...,
    ) -> None: ...
