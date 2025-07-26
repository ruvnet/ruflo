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
from typing import Mapping as _Mapping
from typing import Optional as _Optional
from typing import Union as _Union

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf import struct_pb2 as _struct_pb2

DESCRIPTOR: _descriptor.FileDescriptor

class AuditContext(_message.Message):
    __slots__ = (
        "audit_log",
        "scrubbed_request",
        "scrubbed_response",
        "scrubbed_response_item_count",
        "target_resource",
    )
    AUDIT_LOG_FIELD_NUMBER: _ClassVar[int]
    SCRUBBED_REQUEST_FIELD_NUMBER: _ClassVar[int]
    SCRUBBED_RESPONSE_FIELD_NUMBER: _ClassVar[int]
    SCRUBBED_RESPONSE_ITEM_COUNT_FIELD_NUMBER: _ClassVar[int]
    TARGET_RESOURCE_FIELD_NUMBER: _ClassVar[int]
    audit_log: bytes
    scrubbed_request: _struct_pb2.Struct
    scrubbed_response: _struct_pb2.Struct
    scrubbed_response_item_count: int
    target_resource: str
    def __init__(
        self,
        audit_log: _Optional[bytes] = ...,
        scrubbed_request: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...,
        scrubbed_response: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...,
        scrubbed_response_item_count: _Optional[int] = ...,
        target_resource: _Optional[str] = ...,
    ) -> None: ...
