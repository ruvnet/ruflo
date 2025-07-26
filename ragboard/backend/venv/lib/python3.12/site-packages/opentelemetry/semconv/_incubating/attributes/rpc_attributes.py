# Copyright The OpenTelemetry Authors
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

from enum import Enum
from typing import Final

RPC_CONNECT_RPC_ERROR_CODE: Final = "rpc.connect_rpc.error_code"
"""
The [error codes](https://connectrpc.com//docs/protocol/#error-codes) of the Connect request. Error codes are always string values.
"""

RPC_CONNECT_RPC_REQUEST_METADATA_TEMPLATE: Final = (
    "rpc.connect_rpc.request.metadata"
)
"""
Connect request metadata, `<key>` being the normalized Connect Metadata key (lowercase), the value being the metadata values.
Note: Instrumentations SHOULD require an explicit configuration of which metadata values are to be captured.
Including all request metadata values can be a security risk - explicit configuration helps avoid leaking sensitive information.

For example, a property `my-custom-key` with value `["1.2.3.4", "1.2.3.5"]` SHOULD be recorded as
the `rpc.connect_rpc.request.metadata.my-custom-key` attribute with value `["1.2.3.4", "1.2.3.5"]`.
"""

RPC_CONNECT_RPC_RESPONSE_METADATA_TEMPLATE: Final = (
    "rpc.connect_rpc.response.metadata"
)
"""
Connect response metadata, `<key>` being the normalized Connect Metadata key (lowercase), the value being the metadata values.
Note: Instrumentations SHOULD require an explicit configuration of which metadata values are to be captured.
Including all response metadata values can be a security risk - explicit configuration helps avoid leaking sensitive information.

For example, a property `my-custom-key` with value `"attribute_value"` SHOULD be recorded as
the `rpc.connect_rpc.response.metadata.my-custom-key` attribute with value `["attribute_value"]`.
"""

RPC_GRPC_REQUEST_METADATA_TEMPLATE: Final = "rpc.grpc.request.metadata"
"""
gRPC request metadata, `<key>` being the normalized gRPC Metadata key (lowercase), the value being the metadata values.
Note: Instrumentations SHOULD require an explicit configuration of which metadata values are to be captured.
Including all request metadata values can be a security risk - explicit configuration helps avoid leaking sensitive information.

For example, a property `my-custom-key` with value `["1.2.3.4", "1.2.3.5"]` SHOULD be recorded as
`rpc.grpc.request.metadata.my-custom-key` attribute with value `["1.2.3.4", "1.2.3.5"]`.
"""

RPC_GRPC_RESPONSE_METADATA_TEMPLATE: Final = "rpc.grpc.response.metadata"
"""
gRPC response metadata, `<key>` being the normalized gRPC Metadata key (lowercase), the value being the metadata values.
Note: Instrumentations SHOULD require an explicit configuration of which metadata values are to be captured.
Including all response metadata values can be a security risk - explicit configuration helps avoid leaking sensitive information.

For example, a property `my-custom-key` with value `["attribute_value"]` SHOULD be recorded as
the `rpc.grpc.response.metadata.my-custom-key` attribute with value `["attribute_value"]`.
"""

RPC_GRPC_STATUS_CODE: Final = "rpc.grpc.status_code"
"""
The [numeric status code](https://github.com/grpc/grpc/blob/v1.33.2/doc/statuscodes.md) of the gRPC request.
"""

RPC_JSONRPC_ERROR_CODE: Final = "rpc.jsonrpc.error_code"
"""
`error.code` property of response if it is an error response.
"""

RPC_JSONRPC_ERROR_MESSAGE: Final = "rpc.jsonrpc.error_message"
"""
`error.message` property of response if it is an error response.
"""

RPC_JSONRPC_REQUEST_ID: Final = "rpc.jsonrpc.request_id"
"""
`id` property of request or response. Since protocol allows id to be int, string, `null` or missing (for notifications), value is expected to be cast to string for simplicity. Use empty string in case of `null` value. Omit entirely if this is a notification.
"""

RPC_JSONRPC_VERSION: Final = "rpc.jsonrpc.version"
"""
Protocol version as in `jsonrpc` property of request/response. Since JSON-RPC 1.0 doesn't specify this, the value can be omitted.
"""

RPC_MESSAGE_COMPRESSED_SIZE: Final = "rpc.message.compressed_size"
"""
Compressed size of the message in bytes.
"""

RPC_MESSAGE_ID: Final = "rpc.message.id"
"""
MUST be calculated as two different counters starting from `1` one for sent messages and one for received message.
Note: This way we guarantee that the values will be consistent between different implementations.
"""

RPC_MESSAGE_TYPE: Final = "rpc.message.type"
"""
Whether this is a received or sent message.
"""

RPC_MESSAGE_UNCOMPRESSED_SIZE: Final = "rpc.message.uncompressed_size"
"""
Uncompressed size of the message in bytes.
"""

RPC_METHOD: Final = "rpc.method"
"""
The name of the (logical) method being called, must be equal to the $method part in the span name.
Note: This is the logical name of the method from the RPC interface perspective, which can be different from the name of any implementing method/function. The `code.function.name` attribute may be used to store the latter (e.g., method actually executing the call on the server side, RPC client stub method on the client side).
"""

RPC_SERVICE: Final = "rpc.service"
"""
The full (logical) name of the service being called, including its package name, if applicable.
Note: This is the logical name of the service from the RPC interface perspective, which can be different from the name of any implementing class. The `code.namespace` attribute may be used to store the latter (despite the attribute name, it may include a class name; e.g., class with method actually executing the call on the server side, RPC client stub class on the client side).
"""

RPC_SYSTEM: Final = "rpc.system"
"""
A string identifying the remoting system. See below for a list of well-known identifiers.
"""


class RpcConnectRpcErrorCodeValues(Enum):
    CANCELLED = "cancelled"
    """cancelled."""
    UNKNOWN = "unknown"
    """unknown."""
    INVALID_ARGUMENT = "invalid_argument"
    """invalid_argument."""
    DEADLINE_EXCEEDED = "deadline_exceeded"
    """deadline_exceeded."""
    NOT_FOUND = "not_found"
    """not_found."""
    ALREADY_EXISTS = "already_exists"
    """already_exists."""
    PERMISSION_DENIED = "permission_denied"
    """permission_denied."""
    RESOURCE_EXHAUSTED = "resource_exhausted"
    """resource_exhausted."""
    FAILED_PRECONDITION = "failed_precondition"
    """failed_precondition."""
    ABORTED = "aborted"
    """aborted."""
    OUT_OF_RANGE = "out_of_range"
    """out_of_range."""
    UNIMPLEMENTED = "unimplemented"
    """unimplemented."""
    INTERNAL = "internal"
    """internal."""
    UNAVAILABLE = "unavailable"
    """unavailable."""
    DATA_LOSS = "data_loss"
    """data_loss."""
    UNAUTHENTICATED = "unauthenticated"
    """unauthenticated."""


class RpcGrpcStatusCodeValues(Enum):
    OK = 0
    """OK."""
    CANCELLED = 1
    """CANCELLED."""
    UNKNOWN = 2
    """UNKNOWN."""
    INVALID_ARGUMENT = 3
    """INVALID_ARGUMENT."""
    DEADLINE_EXCEEDED = 4
    """DEADLINE_EXCEEDED."""
    NOT_FOUND = 5
    """NOT_FOUND."""
    ALREADY_EXISTS = 6
    """ALREADY_EXISTS."""
    PERMISSION_DENIED = 7
    """PERMISSION_DENIED."""
    RESOURCE_EXHAUSTED = 8
    """RESOURCE_EXHAUSTED."""
    FAILED_PRECONDITION = 9
    """FAILED_PRECONDITION."""
    ABORTED = 10
    """ABORTED."""
    OUT_OF_RANGE = 11
    """OUT_OF_RANGE."""
    UNIMPLEMENTED = 12
    """UNIMPLEMENTED."""
    INTERNAL = 13
    """INTERNAL."""
    UNAVAILABLE = 14
    """UNAVAILABLE."""
    DATA_LOSS = 15
    """DATA_LOSS."""
    UNAUTHENTICATED = 16
    """UNAUTHENTICATED."""


class RpcMessageTypeValues(Enum):
    SENT = "SENT"
    """sent."""
    RECEIVED = "RECEIVED"
    """received."""


class RpcSystemValues(Enum):
    GRPC = "grpc"
    """gRPC."""
    JAVA_RMI = "java_rmi"
    """Java RMI."""
    DOTNET_WCF = "dotnet_wcf"
    """.NET WCF."""
    APACHE_DUBBO = "apache_dubbo"
    """Apache Dubbo."""
    CONNECT_RPC = "connect_rpc"
    """Connect RPC."""
