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
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

DESCRIPTOR: _descriptor.FileDescriptor

class Backend(_message.Message):
    __slots__ = ("rules",)
    RULES_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[BackendRule]
    def __init__(
        self, rules: _Optional[_Iterable[_Union[BackendRule, _Mapping]]] = ...
    ) -> None: ...

class BackendRule(_message.Message):
    __slots__ = (
        "selector",
        "address",
        "deadline",
        "min_deadline",
        "operation_deadline",
        "path_translation",
        "jwt_audience",
        "disable_auth",
        "protocol",
        "overrides_by_request_protocol",
    )

    class PathTranslation(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        PATH_TRANSLATION_UNSPECIFIED: _ClassVar[BackendRule.PathTranslation]
        CONSTANT_ADDRESS: _ClassVar[BackendRule.PathTranslation]
        APPEND_PATH_TO_ADDRESS: _ClassVar[BackendRule.PathTranslation]
    PATH_TRANSLATION_UNSPECIFIED: BackendRule.PathTranslation
    CONSTANT_ADDRESS: BackendRule.PathTranslation
    APPEND_PATH_TO_ADDRESS: BackendRule.PathTranslation

    class OverridesByRequestProtocolEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: BackendRule
        def __init__(
            self,
            key: _Optional[str] = ...,
            value: _Optional[_Union[BackendRule, _Mapping]] = ...,
        ) -> None: ...
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    DEADLINE_FIELD_NUMBER: _ClassVar[int]
    MIN_DEADLINE_FIELD_NUMBER: _ClassVar[int]
    OPERATION_DEADLINE_FIELD_NUMBER: _ClassVar[int]
    PATH_TRANSLATION_FIELD_NUMBER: _ClassVar[int]
    JWT_AUDIENCE_FIELD_NUMBER: _ClassVar[int]
    DISABLE_AUTH_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_FIELD_NUMBER: _ClassVar[int]
    OVERRIDES_BY_REQUEST_PROTOCOL_FIELD_NUMBER: _ClassVar[int]
    selector: str
    address: str
    deadline: float
    min_deadline: float
    operation_deadline: float
    path_translation: BackendRule.PathTranslation
    jwt_audience: str
    disable_auth: bool
    protocol: str
    overrides_by_request_protocol: _containers.MessageMap[str, BackendRule]
    def __init__(
        self,
        selector: _Optional[str] = ...,
        address: _Optional[str] = ...,
        deadline: _Optional[float] = ...,
        min_deadline: _Optional[float] = ...,
        operation_deadline: _Optional[float] = ...,
        path_translation: _Optional[_Union[BackendRule.PathTranslation, str]] = ...,
        jwt_audience: _Optional[str] = ...,
        disable_auth: bool = ...,
        protocol: _Optional[str] = ...,
        overrides_by_request_protocol: _Optional[_Mapping[str, BackendRule]] = ...,
    ) -> None: ...
