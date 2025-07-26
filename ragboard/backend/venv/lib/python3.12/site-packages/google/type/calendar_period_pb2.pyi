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

class CalendarPeriod(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CALENDAR_PERIOD_UNSPECIFIED: _ClassVar[CalendarPeriod]
    DAY: _ClassVar[CalendarPeriod]
    WEEK: _ClassVar[CalendarPeriod]
    FORTNIGHT: _ClassVar[CalendarPeriod]
    MONTH: _ClassVar[CalendarPeriod]
    QUARTER: _ClassVar[CalendarPeriod]
    HALF: _ClassVar[CalendarPeriod]
    YEAR: _ClassVar[CalendarPeriod]

CALENDAR_PERIOD_UNSPECIFIED: CalendarPeriod
DAY: CalendarPeriod
WEEK: CalendarPeriod
FORTNIGHT: CalendarPeriod
MONTH: CalendarPeriod
QUARTER: CalendarPeriod
HALF: CalendarPeriod
YEAR: CalendarPeriod
