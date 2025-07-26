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
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

DESCRIPTOR: _descriptor.FileDescriptor

class Code(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    OK: _ClassVar[Code]
    CANCELLED: _ClassVar[Code]
    UNKNOWN: _ClassVar[Code]
    INVALID_ARGUMENT: _ClassVar[Code]
    DEADLINE_EXCEEDED: _ClassVar[Code]
    NOT_FOUND: _ClassVar[Code]
    ALREADY_EXISTS: _ClassVar[Code]
    PERMISSION_DENIED: _ClassVar[Code]
    UNAUTHENTICATED: _ClassVar[Code]
    RESOURCE_EXHAUSTED: _ClassVar[Code]
    FAILED_PRECONDITION: _ClassVar[Code]
    ABORTED: _ClassVar[Code]
    OUT_OF_RANGE: _ClassVar[Code]
    UNIMPLEMENTED: _ClassVar[Code]
    INTERNAL: _ClassVar[Code]
    UNAVAILABLE: _ClassVar[Code]
    DATA_LOSS: _ClassVar[Code]

OK: Code
CANCELLED: Code
UNKNOWN: Code
INVALID_ARGUMENT: Code
DEADLINE_EXCEEDED: Code
NOT_FOUND: Code
ALREADY_EXISTS: Code
PERMISSION_DENIED: Code
UNAUTHENTICATED: Code
RESOURCE_EXHAUSTED: Code
FAILED_PRECONDITION: Code
ABORTED: Code
OUT_OF_RANGE: Code
UNIMPLEMENTED: Code
INTERNAL: Code
UNAVAILABLE: Code
DATA_LOSS: Code
