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

from google.protobuf import any_pb2 as _any_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import duration_pb2 as _duration_pb2
from google.protobuf import message as _message
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class AttributeContext(_message.Message):
    __slots__ = (
        "origin",
        "source",
        "destination",
        "request",
        "response",
        "resource",
        "api",
        "extensions",
    )

    class Peer(_message.Message):
        __slots__ = ("ip", "port", "labels", "principal", "region_code")

        class LabelsEntry(_message.Message):
            __slots__ = ("key", "value")
            KEY_FIELD_NUMBER: _ClassVar[int]
            VALUE_FIELD_NUMBER: _ClassVar[int]
            key: str
            value: str
            def __init__(
                self, key: _Optional[str] = ..., value: _Optional[str] = ...
            ) -> None: ...
        IP_FIELD_NUMBER: _ClassVar[int]
        PORT_FIELD_NUMBER: _ClassVar[int]
        LABELS_FIELD_NUMBER: _ClassVar[int]
        PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
        REGION_CODE_FIELD_NUMBER: _ClassVar[int]
        ip: str
        port: int
        labels: _containers.ScalarMap[str, str]
        principal: str
        region_code: str
        def __init__(
            self,
            ip: _Optional[str] = ...,
            port: _Optional[int] = ...,
            labels: _Optional[_Mapping[str, str]] = ...,
            principal: _Optional[str] = ...,
            region_code: _Optional[str] = ...,
        ) -> None: ...

    class Api(_message.Message):
        __slots__ = ("service", "operation", "protocol", "version")
        SERVICE_FIELD_NUMBER: _ClassVar[int]
        OPERATION_FIELD_NUMBER: _ClassVar[int]
        PROTOCOL_FIELD_NUMBER: _ClassVar[int]
        VERSION_FIELD_NUMBER: _ClassVar[int]
        service: str
        operation: str
        protocol: str
        version: str
        def __init__(
            self,
            service: _Optional[str] = ...,
            operation: _Optional[str] = ...,
            protocol: _Optional[str] = ...,
            version: _Optional[str] = ...,
        ) -> None: ...

    class Auth(_message.Message):
        __slots__ = ("principal", "audiences", "presenter", "claims", "access_levels")
        PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
        AUDIENCES_FIELD_NUMBER: _ClassVar[int]
        PRESENTER_FIELD_NUMBER: _ClassVar[int]
        CLAIMS_FIELD_NUMBER: _ClassVar[int]
        ACCESS_LEVELS_FIELD_NUMBER: _ClassVar[int]
        principal: str
        audiences: _containers.RepeatedScalarFieldContainer[str]
        presenter: str
        claims: _struct_pb2.Struct
        access_levels: _containers.RepeatedScalarFieldContainer[str]
        def __init__(
            self,
            principal: _Optional[str] = ...,
            audiences: _Optional[_Iterable[str]] = ...,
            presenter: _Optional[str] = ...,
            claims: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...,
            access_levels: _Optional[_Iterable[str]] = ...,
        ) -> None: ...

    class Request(_message.Message):
        __slots__ = (
            "id",
            "method",
            "headers",
            "path",
            "host",
            "scheme",
            "query",
            "time",
            "size",
            "protocol",
            "reason",
            "auth",
        )

        class HeadersEntry(_message.Message):
            __slots__ = ("key", "value")
            KEY_FIELD_NUMBER: _ClassVar[int]
            VALUE_FIELD_NUMBER: _ClassVar[int]
            key: str
            value: str
            def __init__(
                self, key: _Optional[str] = ..., value: _Optional[str] = ...
            ) -> None: ...
        ID_FIELD_NUMBER: _ClassVar[int]
        METHOD_FIELD_NUMBER: _ClassVar[int]
        HEADERS_FIELD_NUMBER: _ClassVar[int]
        PATH_FIELD_NUMBER: _ClassVar[int]
        HOST_FIELD_NUMBER: _ClassVar[int]
        SCHEME_FIELD_NUMBER: _ClassVar[int]
        QUERY_FIELD_NUMBER: _ClassVar[int]
        TIME_FIELD_NUMBER: _ClassVar[int]
        SIZE_FIELD_NUMBER: _ClassVar[int]
        PROTOCOL_FIELD_NUMBER: _ClassVar[int]
        REASON_FIELD_NUMBER: _ClassVar[int]
        AUTH_FIELD_NUMBER: _ClassVar[int]
        id: str
        method: str
        headers: _containers.ScalarMap[str, str]
        path: str
        host: str
        scheme: str
        query: str
        time: _timestamp_pb2.Timestamp
        size: int
        protocol: str
        reason: str
        auth: AttributeContext.Auth
        def __init__(
            self,
            id: _Optional[str] = ...,
            method: _Optional[str] = ...,
            headers: _Optional[_Mapping[str, str]] = ...,
            path: _Optional[str] = ...,
            host: _Optional[str] = ...,
            scheme: _Optional[str] = ...,
            query: _Optional[str] = ...,
            time: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...,
            size: _Optional[int] = ...,
            protocol: _Optional[str] = ...,
            reason: _Optional[str] = ...,
            auth: _Optional[_Union[AttributeContext.Auth, _Mapping]] = ...,
        ) -> None: ...

    class Response(_message.Message):
        __slots__ = ("code", "size", "headers", "time", "backend_latency")

        class HeadersEntry(_message.Message):
            __slots__ = ("key", "value")
            KEY_FIELD_NUMBER: _ClassVar[int]
            VALUE_FIELD_NUMBER: _ClassVar[int]
            key: str
            value: str
            def __init__(
                self, key: _Optional[str] = ..., value: _Optional[str] = ...
            ) -> None: ...
        CODE_FIELD_NUMBER: _ClassVar[int]
        SIZE_FIELD_NUMBER: _ClassVar[int]
        HEADERS_FIELD_NUMBER: _ClassVar[int]
        TIME_FIELD_NUMBER: _ClassVar[int]
        BACKEND_LATENCY_FIELD_NUMBER: _ClassVar[int]
        code: int
        size: int
        headers: _containers.ScalarMap[str, str]
        time: _timestamp_pb2.Timestamp
        backend_latency: _duration_pb2.Duration
        def __init__(
            self,
            code: _Optional[int] = ...,
            size: _Optional[int] = ...,
            headers: _Optional[_Mapping[str, str]] = ...,
            time: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...,
            backend_latency: _Optional[_Union[_duration_pb2.Duration, _Mapping]] = ...,
        ) -> None: ...

    class Resource(_message.Message):
        __slots__ = (
            "service",
            "name",
            "type",
            "labels",
            "uid",
            "annotations",
            "display_name",
            "create_time",
            "update_time",
            "delete_time",
            "etag",
            "location",
        )

        class LabelsEntry(_message.Message):
            __slots__ = ("key", "value")
            KEY_FIELD_NUMBER: _ClassVar[int]
            VALUE_FIELD_NUMBER: _ClassVar[int]
            key: str
            value: str
            def __init__(
                self, key: _Optional[str] = ..., value: _Optional[str] = ...
            ) -> None: ...

        class AnnotationsEntry(_message.Message):
            __slots__ = ("key", "value")
            KEY_FIELD_NUMBER: _ClassVar[int]
            VALUE_FIELD_NUMBER: _ClassVar[int]
            key: str
            value: str
            def __init__(
                self, key: _Optional[str] = ..., value: _Optional[str] = ...
            ) -> None: ...
        SERVICE_FIELD_NUMBER: _ClassVar[int]
        NAME_FIELD_NUMBER: _ClassVar[int]
        TYPE_FIELD_NUMBER: _ClassVar[int]
        LABELS_FIELD_NUMBER: _ClassVar[int]
        UID_FIELD_NUMBER: _ClassVar[int]
        ANNOTATIONS_FIELD_NUMBER: _ClassVar[int]
        DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
        CREATE_TIME_FIELD_NUMBER: _ClassVar[int]
        UPDATE_TIME_FIELD_NUMBER: _ClassVar[int]
        DELETE_TIME_FIELD_NUMBER: _ClassVar[int]
        ETAG_FIELD_NUMBER: _ClassVar[int]
        LOCATION_FIELD_NUMBER: _ClassVar[int]
        service: str
        name: str
        type: str
        labels: _containers.ScalarMap[str, str]
        uid: str
        annotations: _containers.ScalarMap[str, str]
        display_name: str
        create_time: _timestamp_pb2.Timestamp
        update_time: _timestamp_pb2.Timestamp
        delete_time: _timestamp_pb2.Timestamp
        etag: str
        location: str
        def __init__(
            self,
            service: _Optional[str] = ...,
            name: _Optional[str] = ...,
            type: _Optional[str] = ...,
            labels: _Optional[_Mapping[str, str]] = ...,
            uid: _Optional[str] = ...,
            annotations: _Optional[_Mapping[str, str]] = ...,
            display_name: _Optional[str] = ...,
            create_time: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...,
            update_time: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...,
            delete_time: _Optional[_Union[_timestamp_pb2.Timestamp, _Mapping]] = ...,
            etag: _Optional[str] = ...,
            location: _Optional[str] = ...,
        ) -> None: ...
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    DESTINATION_FIELD_NUMBER: _ClassVar[int]
    REQUEST_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    API_FIELD_NUMBER: _ClassVar[int]
    EXTENSIONS_FIELD_NUMBER: _ClassVar[int]
    origin: AttributeContext.Peer
    source: AttributeContext.Peer
    destination: AttributeContext.Peer
    request: AttributeContext.Request
    response: AttributeContext.Response
    resource: AttributeContext.Resource
    api: AttributeContext.Api
    extensions: _containers.RepeatedCompositeFieldContainer[_any_pb2.Any]
    def __init__(
        self,
        origin: _Optional[_Union[AttributeContext.Peer, _Mapping]] = ...,
        source: _Optional[_Union[AttributeContext.Peer, _Mapping]] = ...,
        destination: _Optional[_Union[AttributeContext.Peer, _Mapping]] = ...,
        request: _Optional[_Union[AttributeContext.Request, _Mapping]] = ...,
        response: _Optional[_Union[AttributeContext.Response, _Mapping]] = ...,
        resource: _Optional[_Union[AttributeContext.Resource, _Mapping]] = ...,
        api: _Optional[_Union[AttributeContext.Api, _Mapping]] = ...,
        extensions: _Optional[_Iterable[_Union[_any_pb2.Any, _Mapping]]] = ...,
    ) -> None: ...
