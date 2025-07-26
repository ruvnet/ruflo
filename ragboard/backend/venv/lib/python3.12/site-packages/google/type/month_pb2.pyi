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

class Month(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MONTH_UNSPECIFIED: _ClassVar[Month]
    JANUARY: _ClassVar[Month]
    FEBRUARY: _ClassVar[Month]
    MARCH: _ClassVar[Month]
    APRIL: _ClassVar[Month]
    MAY: _ClassVar[Month]
    JUNE: _ClassVar[Month]
    JULY: _ClassVar[Month]
    AUGUST: _ClassVar[Month]
    SEPTEMBER: _ClassVar[Month]
    OCTOBER: _ClassVar[Month]
    NOVEMBER: _ClassVar[Month]
    DECEMBER: _ClassVar[Month]

MONTH_UNSPECIFIED: Month
JANUARY: Month
FEBRUARY: Month
MARCH: Month
APRIL: Month
MAY: Month
JUNE: Month
JULY: Month
AUGUST: Month
SEPTEMBER: Month
OCTOBER: Month
NOVEMBER: Month
DECEMBER: Month
