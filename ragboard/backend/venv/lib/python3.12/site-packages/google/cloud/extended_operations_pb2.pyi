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

from google.protobuf import descriptor as _descriptor
from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

DESCRIPTOR: _descriptor.FileDescriptor

class OperationResponseMapping(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    UNDEFINED: _ClassVar[OperationResponseMapping]
    NAME: _ClassVar[OperationResponseMapping]
    STATUS: _ClassVar[OperationResponseMapping]
    ERROR_CODE: _ClassVar[OperationResponseMapping]
    ERROR_MESSAGE: _ClassVar[OperationResponseMapping]

UNDEFINED: OperationResponseMapping
NAME: OperationResponseMapping
STATUS: OperationResponseMapping
ERROR_CODE: OperationResponseMapping
ERROR_MESSAGE: OperationResponseMapping
OPERATION_FIELD_FIELD_NUMBER: _ClassVar[int]
operation_field: _descriptor.FieldDescriptor
OPERATION_REQUEST_FIELD_FIELD_NUMBER: _ClassVar[int]
operation_request_field: _descriptor.FieldDescriptor
OPERATION_RESPONSE_FIELD_FIELD_NUMBER: _ClassVar[int]
operation_response_field: _descriptor.FieldDescriptor
OPERATION_SERVICE_FIELD_NUMBER: _ClassVar[int]
operation_service: _descriptor.FieldDescriptor
OPERATION_POLLING_METHOD_FIELD_NUMBER: _ClassVar[int]
operation_polling_method: _descriptor.FieldDescriptor
