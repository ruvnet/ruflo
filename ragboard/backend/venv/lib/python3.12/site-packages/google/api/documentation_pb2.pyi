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

from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers

DESCRIPTOR: _descriptor.FileDescriptor

class Documentation(_message.Message):
    __slots__ = (
        "summary",
        "pages",
        "rules",
        "documentation_root_url",
        "service_root_url",
        "overview",
    )
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    PAGES_FIELD_NUMBER: _ClassVar[int]
    RULES_FIELD_NUMBER: _ClassVar[int]
    DOCUMENTATION_ROOT_URL_FIELD_NUMBER: _ClassVar[int]
    SERVICE_ROOT_URL_FIELD_NUMBER: _ClassVar[int]
    OVERVIEW_FIELD_NUMBER: _ClassVar[int]
    summary: str
    pages: _containers.RepeatedCompositeFieldContainer[Page]
    rules: _containers.RepeatedCompositeFieldContainer[DocumentationRule]
    documentation_root_url: str
    service_root_url: str
    overview: str
    def __init__(
        self,
        summary: _Optional[str] = ...,
        pages: _Optional[_Iterable[_Union[Page, _Mapping]]] = ...,
        rules: _Optional[_Iterable[_Union[DocumentationRule, _Mapping]]] = ...,
        documentation_root_url: _Optional[str] = ...,
        service_root_url: _Optional[str] = ...,
        overview: _Optional[str] = ...,
    ) -> None: ...

class DocumentationRule(_message.Message):
    __slots__ = ("selector", "description", "deprecation_description")
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DEPRECATION_DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    selector: str
    description: str
    deprecation_description: str
    def __init__(
        self,
        selector: _Optional[str] = ...,
        description: _Optional[str] = ...,
        deprecation_description: _Optional[str] = ...,
    ) -> None: ...

class Page(_message.Message):
    __slots__ = ("name", "content", "subpages")
    NAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SUBPAGES_FIELD_NUMBER: _ClassVar[int]
    name: str
    content: str
    subpages: _containers.RepeatedCompositeFieldContainer[Page]
    def __init__(
        self,
        name: _Optional[str] = ...,
        content: _Optional[str] = ...,
        subpages: _Optional[_Iterable[_Union[Page, _Mapping]]] = ...,
    ) -> None: ...
