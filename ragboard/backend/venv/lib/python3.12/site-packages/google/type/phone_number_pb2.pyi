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

DESCRIPTOR: _descriptor.FileDescriptor

class PhoneNumber(_message.Message):
    __slots__ = ("e164_number", "short_code", "extension")

    class ShortCode(_message.Message):
        __slots__ = ("region_code", "number")
        REGION_CODE_FIELD_NUMBER: _ClassVar[int]
        NUMBER_FIELD_NUMBER: _ClassVar[int]
        region_code: str
        number: str
        def __init__(
            self, region_code: _Optional[str] = ..., number: _Optional[str] = ...
        ) -> None: ...
    E164_NUMBER_FIELD_NUMBER: _ClassVar[int]
    SHORT_CODE_FIELD_NUMBER: _ClassVar[int]
    EXTENSION_FIELD_NUMBER: _ClassVar[int]
    e164_number: str
    short_code: PhoneNumber.ShortCode
    extension: str
    def __init__(
        self,
        e164_number: _Optional[str] = ...,
        short_code: _Optional[_Union[PhoneNumber.ShortCode, _Mapping]] = ...,
        extension: _Optional[str] = ...,
    ) -> None: ...
