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
from google.protobuf import duration_pb2 as _duration_pb2
from google.protobuf import message as _message

DESCRIPTOR: _descriptor.FileDescriptor

class DateTime(_message.Message):
    __slots__ = (
        "year",
        "month",
        "day",
        "hours",
        "minutes",
        "seconds",
        "nanos",
        "utc_offset",
        "time_zone",
    )
    YEAR_FIELD_NUMBER: _ClassVar[int]
    MONTH_FIELD_NUMBER: _ClassVar[int]
    DAY_FIELD_NUMBER: _ClassVar[int]
    HOURS_FIELD_NUMBER: _ClassVar[int]
    MINUTES_FIELD_NUMBER: _ClassVar[int]
    SECONDS_FIELD_NUMBER: _ClassVar[int]
    NANOS_FIELD_NUMBER: _ClassVar[int]
    UTC_OFFSET_FIELD_NUMBER: _ClassVar[int]
    TIME_ZONE_FIELD_NUMBER: _ClassVar[int]
    year: int
    month: int
    day: int
    hours: int
    minutes: int
    seconds: int
    nanos: int
    utc_offset: _duration_pb2.Duration
    time_zone: TimeZone
    def __init__(
        self,
        year: _Optional[int] = ...,
        month: _Optional[int] = ...,
        day: _Optional[int] = ...,
        hours: _Optional[int] = ...,
        minutes: _Optional[int] = ...,
        seconds: _Optional[int] = ...,
        nanos: _Optional[int] = ...,
        utc_offset: _Optional[_Union[_duration_pb2.Duration, _Mapping]] = ...,
        time_zone: _Optional[_Union[TimeZone, _Mapping]] = ...,
    ) -> None: ...

class TimeZone(_message.Message):
    __slots__ = ("id", "version")
    ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    id: str
    version: str
    def __init__(
        self, id: _Optional[str] = ..., version: _Optional[str] = ...
    ) -> None: ...
