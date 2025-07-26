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
from typing import Optional as _Optional

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class PostalAddress(_message.Message):
    __slots__ = (
        "revision",
        "region_code",
        "language_code",
        "postal_code",
        "sorting_code",
        "administrative_area",
        "locality",
        "sublocality",
        "address_lines",
        "recipients",
        "organization",
    )
    REVISION_FIELD_NUMBER: _ClassVar[int]
    REGION_CODE_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_CODE_FIELD_NUMBER: _ClassVar[int]
    POSTAL_CODE_FIELD_NUMBER: _ClassVar[int]
    SORTING_CODE_FIELD_NUMBER: _ClassVar[int]
    ADMINISTRATIVE_AREA_FIELD_NUMBER: _ClassVar[int]
    LOCALITY_FIELD_NUMBER: _ClassVar[int]
    SUBLOCALITY_FIELD_NUMBER: _ClassVar[int]
    ADDRESS_LINES_FIELD_NUMBER: _ClassVar[int]
    RECIPIENTS_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    revision: int
    region_code: str
    language_code: str
    postal_code: str
    sorting_code: str
    administrative_area: str
    locality: str
    sublocality: str
    address_lines: _containers.RepeatedScalarFieldContainer[str]
    recipients: _containers.RepeatedScalarFieldContainer[str]
    organization: str
    def __init__(
        self,
        revision: _Optional[int] = ...,
        region_code: _Optional[str] = ...,
        language_code: _Optional[str] = ...,
        postal_code: _Optional[str] = ...,
        sorting_code: _Optional[str] = ...,
        administrative_area: _Optional[str] = ...,
        locality: _Optional[str] = ...,
        sublocality: _Optional[str] = ...,
        address_lines: _Optional[_Iterable[str]] = ...,
        recipients: _Optional[_Iterable[str]] = ...,
        organization: _Optional[str] = ...,
    ) -> None: ...
