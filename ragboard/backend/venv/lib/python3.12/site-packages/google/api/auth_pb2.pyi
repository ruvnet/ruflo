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

class Authentication(_message.Message):
    __slots__ = ("rules", "providers")
    RULES_FIELD_NUMBER: _ClassVar[int]
    PROVIDERS_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[AuthenticationRule]
    providers: _containers.RepeatedCompositeFieldContainer[AuthProvider]
    def __init__(
        self,
        rules: _Optional[_Iterable[_Union[AuthenticationRule, _Mapping]]] = ...,
        providers: _Optional[_Iterable[_Union[AuthProvider, _Mapping]]] = ...,
    ) -> None: ...

class AuthenticationRule(_message.Message):
    __slots__ = ("selector", "oauth", "allow_without_credential", "requirements")
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    OAUTH_FIELD_NUMBER: _ClassVar[int]
    ALLOW_WITHOUT_CREDENTIAL_FIELD_NUMBER: _ClassVar[int]
    REQUIREMENTS_FIELD_NUMBER: _ClassVar[int]
    selector: str
    oauth: OAuthRequirements
    allow_without_credential: bool
    requirements: _containers.RepeatedCompositeFieldContainer[AuthRequirement]
    def __init__(
        self,
        selector: _Optional[str] = ...,
        oauth: _Optional[_Union[OAuthRequirements, _Mapping]] = ...,
        allow_without_credential: bool = ...,
        requirements: _Optional[_Iterable[_Union[AuthRequirement, _Mapping]]] = ...,
    ) -> None: ...

class JwtLocation(_message.Message):
    __slots__ = ("header", "query", "cookie", "value_prefix")
    HEADER_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    COOKIE_FIELD_NUMBER: _ClassVar[int]
    VALUE_PREFIX_FIELD_NUMBER: _ClassVar[int]
    header: str
    query: str
    cookie: str
    value_prefix: str
    def __init__(
        self,
        header: _Optional[str] = ...,
        query: _Optional[str] = ...,
        cookie: _Optional[str] = ...,
        value_prefix: _Optional[str] = ...,
    ) -> None: ...

class AuthProvider(_message.Message):
    __slots__ = (
        "id",
        "issuer",
        "jwks_uri",
        "audiences",
        "authorization_url",
        "jwt_locations",
    )
    ID_FIELD_NUMBER: _ClassVar[int]
    ISSUER_FIELD_NUMBER: _ClassVar[int]
    JWKS_URI_FIELD_NUMBER: _ClassVar[int]
    AUDIENCES_FIELD_NUMBER: _ClassVar[int]
    AUTHORIZATION_URL_FIELD_NUMBER: _ClassVar[int]
    JWT_LOCATIONS_FIELD_NUMBER: _ClassVar[int]
    id: str
    issuer: str
    jwks_uri: str
    audiences: str
    authorization_url: str
    jwt_locations: _containers.RepeatedCompositeFieldContainer[JwtLocation]
    def __init__(
        self,
        id: _Optional[str] = ...,
        issuer: _Optional[str] = ...,
        jwks_uri: _Optional[str] = ...,
        audiences: _Optional[str] = ...,
        authorization_url: _Optional[str] = ...,
        jwt_locations: _Optional[_Iterable[_Union[JwtLocation, _Mapping]]] = ...,
    ) -> None: ...

class OAuthRequirements(_message.Message):
    __slots__ = ("canonical_scopes",)
    CANONICAL_SCOPES_FIELD_NUMBER: _ClassVar[int]
    canonical_scopes: str
    def __init__(self, canonical_scopes: _Optional[str] = ...) -> None: ...

class AuthRequirement(_message.Message):
    __slots__ = ("provider_id", "audiences")
    PROVIDER_ID_FIELD_NUMBER: _ClassVar[int]
    AUDIENCES_FIELD_NUMBER: _ClassVar[int]
    provider_id: str
    audiences: str
    def __init__(
        self, provider_id: _Optional[str] = ..., audiences: _Optional[str] = ...
    ) -> None: ...
