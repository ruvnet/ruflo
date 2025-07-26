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

class GapicMetadata(_message.Message):
    __slots__ = (
        "schema",
        "comment",
        "language",
        "proto_package",
        "library_package",
        "services",
    )

    class ServicesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: GapicMetadata.ServiceForTransport
        def __init__(
            self,
            key: _Optional[str] = ...,
            value: _Optional[_Union[GapicMetadata.ServiceForTransport, _Mapping]] = ...,
        ) -> None: ...

    class ServiceForTransport(_message.Message):
        __slots__ = ("clients",)

        class ClientsEntry(_message.Message):
            __slots__ = ("key", "value")
            KEY_FIELD_NUMBER: _ClassVar[int]
            VALUE_FIELD_NUMBER: _ClassVar[int]
            key: str
            value: GapicMetadata.ServiceAsClient
            def __init__(
                self,
                key: _Optional[str] = ...,
                value: _Optional[_Union[GapicMetadata.ServiceAsClient, _Mapping]] = ...,
            ) -> None: ...
        CLIENTS_FIELD_NUMBER: _ClassVar[int]
        clients: _containers.MessageMap[str, GapicMetadata.ServiceAsClient]
        def __init__(
            self, clients: _Optional[_Mapping[str, GapicMetadata.ServiceAsClient]] = ...
        ) -> None: ...

    class ServiceAsClient(_message.Message):
        __slots__ = ("library_client", "rpcs")

        class RpcsEntry(_message.Message):
            __slots__ = ("key", "value")
            KEY_FIELD_NUMBER: _ClassVar[int]
            VALUE_FIELD_NUMBER: _ClassVar[int]
            key: str
            value: GapicMetadata.MethodList
            def __init__(
                self,
                key: _Optional[str] = ...,
                value: _Optional[_Union[GapicMetadata.MethodList, _Mapping]] = ...,
            ) -> None: ...
        LIBRARY_CLIENT_FIELD_NUMBER: _ClassVar[int]
        RPCS_FIELD_NUMBER: _ClassVar[int]
        library_client: str
        rpcs: _containers.MessageMap[str, GapicMetadata.MethodList]
        def __init__(
            self,
            library_client: _Optional[str] = ...,
            rpcs: _Optional[_Mapping[str, GapicMetadata.MethodList]] = ...,
        ) -> None: ...

    class MethodList(_message.Message):
        __slots__ = ("methods",)
        METHODS_FIELD_NUMBER: _ClassVar[int]
        methods: _containers.RepeatedScalarFieldContainer[str]
        def __init__(self, methods: _Optional[_Iterable[str]] = ...) -> None: ...
    SCHEMA_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    PROTO_PACKAGE_FIELD_NUMBER: _ClassVar[int]
    LIBRARY_PACKAGE_FIELD_NUMBER: _ClassVar[int]
    SERVICES_FIELD_NUMBER: _ClassVar[int]
    schema: str
    comment: str
    language: str
    proto_package: str
    library_package: str
    services: _containers.MessageMap[str, GapicMetadata.ServiceForTransport]
    def __init__(
        self,
        schema: _Optional[str] = ...,
        comment: _Optional[str] = ...,
        language: _Optional[str] = ...,
        proto_package: _Optional[str] = ...,
        library_package: _Optional[str] = ...,
        services: _Optional[_Mapping[str, GapicMetadata.ServiceForTransport]] = ...,
    ) -> None: ...
