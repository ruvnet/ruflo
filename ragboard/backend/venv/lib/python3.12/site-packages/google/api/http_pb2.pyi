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

class Http(_message.Message):
    __slots__ = ("rules", "fully_decode_reserved_expansion")
    RULES_FIELD_NUMBER: _ClassVar[int]
    FULLY_DECODE_RESERVED_EXPANSION_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[HttpRule]
    fully_decode_reserved_expansion: bool
    def __init__(
        self,
        rules: _Optional[_Iterable[_Union[HttpRule, _Mapping]]] = ...,
        fully_decode_reserved_expansion: bool = ...,
    ) -> None: ...

class HttpRule(_message.Message):
    __slots__ = (
        "selector",
        "get",
        "put",
        "post",
        "delete",
        "patch",
        "custom",
        "body",
        "response_body",
        "additional_bindings",
    )
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    GET_FIELD_NUMBER: _ClassVar[int]
    PUT_FIELD_NUMBER: _ClassVar[int]
    POST_FIELD_NUMBER: _ClassVar[int]
    DELETE_FIELD_NUMBER: _ClassVar[int]
    PATCH_FIELD_NUMBER: _ClassVar[int]
    CUSTOM_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_BODY_FIELD_NUMBER: _ClassVar[int]
    ADDITIONAL_BINDINGS_FIELD_NUMBER: _ClassVar[int]
    selector: str
    get: str
    put: str
    post: str
    delete: str
    patch: str
    custom: CustomHttpPattern
    body: str
    response_body: str
    additional_bindings: _containers.RepeatedCompositeFieldContainer[HttpRule]
    def __init__(
        self,
        selector: _Optional[str] = ...,
        get: _Optional[str] = ...,
        put: _Optional[str] = ...,
        post: _Optional[str] = ...,
        delete: _Optional[str] = ...,
        patch: _Optional[str] = ...,
        custom: _Optional[_Union[CustomHttpPattern, _Mapping]] = ...,
        body: _Optional[str] = ...,
        response_body: _Optional[str] = ...,
        additional_bindings: _Optional[_Iterable[_Union[HttpRule, _Mapping]]] = ...,
    ) -> None: ...

class CustomHttpPattern(_message.Message):
    __slots__ = ("kind", "path")
    KIND_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    kind: str
    path: str
    def __init__(
        self, kind: _Optional[str] = ..., path: _Optional[str] = ...
    ) -> None: ...
