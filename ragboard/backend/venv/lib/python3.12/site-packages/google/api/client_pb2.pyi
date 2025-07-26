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
from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf import duration_pb2 as _duration_pb2
from google.protobuf import message as _message
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

from google.api import launch_stage_pb2 as _launch_stage_pb2

DESCRIPTOR: _descriptor.FileDescriptor

class ClientLibraryOrganization(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CLIENT_LIBRARY_ORGANIZATION_UNSPECIFIED: _ClassVar[ClientLibraryOrganization]
    CLOUD: _ClassVar[ClientLibraryOrganization]
    ADS: _ClassVar[ClientLibraryOrganization]
    PHOTOS: _ClassVar[ClientLibraryOrganization]
    STREET_VIEW: _ClassVar[ClientLibraryOrganization]
    SHOPPING: _ClassVar[ClientLibraryOrganization]
    GEO: _ClassVar[ClientLibraryOrganization]
    GENERATIVE_AI: _ClassVar[ClientLibraryOrganization]

class ClientLibraryDestination(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CLIENT_LIBRARY_DESTINATION_UNSPECIFIED: _ClassVar[ClientLibraryDestination]
    GITHUB: _ClassVar[ClientLibraryDestination]
    PACKAGE_MANAGER: _ClassVar[ClientLibraryDestination]

CLIENT_LIBRARY_ORGANIZATION_UNSPECIFIED: ClientLibraryOrganization
CLOUD: ClientLibraryOrganization
ADS: ClientLibraryOrganization
PHOTOS: ClientLibraryOrganization
STREET_VIEW: ClientLibraryOrganization
SHOPPING: ClientLibraryOrganization
GEO: ClientLibraryOrganization
GENERATIVE_AI: ClientLibraryOrganization
CLIENT_LIBRARY_DESTINATION_UNSPECIFIED: ClientLibraryDestination
GITHUB: ClientLibraryDestination
PACKAGE_MANAGER: ClientLibraryDestination
METHOD_SIGNATURE_FIELD_NUMBER: _ClassVar[int]
method_signature: _descriptor.FieldDescriptor
DEFAULT_HOST_FIELD_NUMBER: _ClassVar[int]
default_host: _descriptor.FieldDescriptor
OAUTH_SCOPES_FIELD_NUMBER: _ClassVar[int]
oauth_scopes: _descriptor.FieldDescriptor
API_VERSION_FIELD_NUMBER: _ClassVar[int]
api_version: _descriptor.FieldDescriptor

class CommonLanguageSettings(_message.Message):
    __slots__ = ("reference_docs_uri", "destinations", "selective_gapic_generation")
    REFERENCE_DOCS_URI_FIELD_NUMBER: _ClassVar[int]
    DESTINATIONS_FIELD_NUMBER: _ClassVar[int]
    SELECTIVE_GAPIC_GENERATION_FIELD_NUMBER: _ClassVar[int]
    reference_docs_uri: str
    destinations: _containers.RepeatedScalarFieldContainer[ClientLibraryDestination]
    selective_gapic_generation: SelectiveGapicGeneration
    def __init__(
        self,
        reference_docs_uri: _Optional[str] = ...,
        destinations: _Optional[_Iterable[_Union[ClientLibraryDestination, str]]] = ...,
        selective_gapic_generation: _Optional[
            _Union[SelectiveGapicGeneration, _Mapping]
        ] = ...,
    ) -> None: ...

class ClientLibrarySettings(_message.Message):
    __slots__ = (
        "version",
        "launch_stage",
        "rest_numeric_enums",
        "java_settings",
        "cpp_settings",
        "php_settings",
        "python_settings",
        "node_settings",
        "dotnet_settings",
        "ruby_settings",
        "go_settings",
    )
    VERSION_FIELD_NUMBER: _ClassVar[int]
    LAUNCH_STAGE_FIELD_NUMBER: _ClassVar[int]
    REST_NUMERIC_ENUMS_FIELD_NUMBER: _ClassVar[int]
    JAVA_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    CPP_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    PHP_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    PYTHON_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    NODE_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    DOTNET_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    RUBY_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    GO_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    version: str
    launch_stage: _launch_stage_pb2.LaunchStage
    rest_numeric_enums: bool
    java_settings: JavaSettings
    cpp_settings: CppSettings
    php_settings: PhpSettings
    python_settings: PythonSettings
    node_settings: NodeSettings
    dotnet_settings: DotnetSettings
    ruby_settings: RubySettings
    go_settings: GoSettings
    def __init__(
        self,
        version: _Optional[str] = ...,
        launch_stage: _Optional[_Union[_launch_stage_pb2.LaunchStage, str]] = ...,
        rest_numeric_enums: bool = ...,
        java_settings: _Optional[_Union[JavaSettings, _Mapping]] = ...,
        cpp_settings: _Optional[_Union[CppSettings, _Mapping]] = ...,
        php_settings: _Optional[_Union[PhpSettings, _Mapping]] = ...,
        python_settings: _Optional[_Union[PythonSettings, _Mapping]] = ...,
        node_settings: _Optional[_Union[NodeSettings, _Mapping]] = ...,
        dotnet_settings: _Optional[_Union[DotnetSettings, _Mapping]] = ...,
        ruby_settings: _Optional[_Union[RubySettings, _Mapping]] = ...,
        go_settings: _Optional[_Union[GoSettings, _Mapping]] = ...,
    ) -> None: ...

class Publishing(_message.Message):
    __slots__ = (
        "method_settings",
        "new_issue_uri",
        "documentation_uri",
        "api_short_name",
        "github_label",
        "codeowner_github_teams",
        "doc_tag_prefix",
        "organization",
        "library_settings",
        "proto_reference_documentation_uri",
        "rest_reference_documentation_uri",
    )
    METHOD_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    NEW_ISSUE_URI_FIELD_NUMBER: _ClassVar[int]
    DOCUMENTATION_URI_FIELD_NUMBER: _ClassVar[int]
    API_SHORT_NAME_FIELD_NUMBER: _ClassVar[int]
    GITHUB_LABEL_FIELD_NUMBER: _ClassVar[int]
    CODEOWNER_GITHUB_TEAMS_FIELD_NUMBER: _ClassVar[int]
    DOC_TAG_PREFIX_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    LIBRARY_SETTINGS_FIELD_NUMBER: _ClassVar[int]
    PROTO_REFERENCE_DOCUMENTATION_URI_FIELD_NUMBER: _ClassVar[int]
    REST_REFERENCE_DOCUMENTATION_URI_FIELD_NUMBER: _ClassVar[int]
    method_settings: _containers.RepeatedCompositeFieldContainer[MethodSettings]
    new_issue_uri: str
    documentation_uri: str
    api_short_name: str
    github_label: str
    codeowner_github_teams: _containers.RepeatedScalarFieldContainer[str]
    doc_tag_prefix: str
    organization: ClientLibraryOrganization
    library_settings: _containers.RepeatedCompositeFieldContainer[ClientLibrarySettings]
    proto_reference_documentation_uri: str
    rest_reference_documentation_uri: str
    def __init__(
        self,
        method_settings: _Optional[_Iterable[_Union[MethodSettings, _Mapping]]] = ...,
        new_issue_uri: _Optional[str] = ...,
        documentation_uri: _Optional[str] = ...,
        api_short_name: _Optional[str] = ...,
        github_label: _Optional[str] = ...,
        codeowner_github_teams: _Optional[_Iterable[str]] = ...,
        doc_tag_prefix: _Optional[str] = ...,
        organization: _Optional[_Union[ClientLibraryOrganization, str]] = ...,
        library_settings: _Optional[
            _Iterable[_Union[ClientLibrarySettings, _Mapping]]
        ] = ...,
        proto_reference_documentation_uri: _Optional[str] = ...,
        rest_reference_documentation_uri: _Optional[str] = ...,
    ) -> None: ...

class JavaSettings(_message.Message):
    __slots__ = ("library_package", "service_class_names", "common")

    class ServiceClassNamesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...
    LIBRARY_PACKAGE_FIELD_NUMBER: _ClassVar[int]
    SERVICE_CLASS_NAMES_FIELD_NUMBER: _ClassVar[int]
    COMMON_FIELD_NUMBER: _ClassVar[int]
    library_package: str
    service_class_names: _containers.ScalarMap[str, str]
    common: CommonLanguageSettings
    def __init__(
        self,
        library_package: _Optional[str] = ...,
        service_class_names: _Optional[_Mapping[str, str]] = ...,
        common: _Optional[_Union[CommonLanguageSettings, _Mapping]] = ...,
    ) -> None: ...

class CppSettings(_message.Message):
    __slots__ = ("common",)
    COMMON_FIELD_NUMBER: _ClassVar[int]
    common: CommonLanguageSettings
    def __init__(
        self, common: _Optional[_Union[CommonLanguageSettings, _Mapping]] = ...
    ) -> None: ...

class PhpSettings(_message.Message):
    __slots__ = ("common",)
    COMMON_FIELD_NUMBER: _ClassVar[int]
    common: CommonLanguageSettings
    def __init__(
        self, common: _Optional[_Union[CommonLanguageSettings, _Mapping]] = ...
    ) -> None: ...

class PythonSettings(_message.Message):
    __slots__ = ("common", "experimental_features")

    class ExperimentalFeatures(_message.Message):
        __slots__ = (
            "rest_async_io_enabled",
            "protobuf_pythonic_types_enabled",
            "unversioned_package_disabled",
        )
        REST_ASYNC_IO_ENABLED_FIELD_NUMBER: _ClassVar[int]
        PROTOBUF_PYTHONIC_TYPES_ENABLED_FIELD_NUMBER: _ClassVar[int]
        UNVERSIONED_PACKAGE_DISABLED_FIELD_NUMBER: _ClassVar[int]
        rest_async_io_enabled: bool
        protobuf_pythonic_types_enabled: bool
        unversioned_package_disabled: bool
        def __init__(
            self,
            rest_async_io_enabled: bool = ...,
            protobuf_pythonic_types_enabled: bool = ...,
            unversioned_package_disabled: bool = ...,
        ) -> None: ...
    COMMON_FIELD_NUMBER: _ClassVar[int]
    EXPERIMENTAL_FEATURES_FIELD_NUMBER: _ClassVar[int]
    common: CommonLanguageSettings
    experimental_features: PythonSettings.ExperimentalFeatures
    def __init__(
        self,
        common: _Optional[_Union[CommonLanguageSettings, _Mapping]] = ...,
        experimental_features: _Optional[
            _Union[PythonSettings.ExperimentalFeatures, _Mapping]
        ] = ...,
    ) -> None: ...

class NodeSettings(_message.Message):
    __slots__ = ("common",)
    COMMON_FIELD_NUMBER: _ClassVar[int]
    common: CommonLanguageSettings
    def __init__(
        self, common: _Optional[_Union[CommonLanguageSettings, _Mapping]] = ...
    ) -> None: ...

class DotnetSettings(_message.Message):
    __slots__ = (
        "common",
        "renamed_services",
        "renamed_resources",
        "ignored_resources",
        "forced_namespace_aliases",
        "handwritten_signatures",
    )

    class RenamedServicesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...

    class RenamedResourcesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...
    COMMON_FIELD_NUMBER: _ClassVar[int]
    RENAMED_SERVICES_FIELD_NUMBER: _ClassVar[int]
    RENAMED_RESOURCES_FIELD_NUMBER: _ClassVar[int]
    IGNORED_RESOURCES_FIELD_NUMBER: _ClassVar[int]
    FORCED_NAMESPACE_ALIASES_FIELD_NUMBER: _ClassVar[int]
    HANDWRITTEN_SIGNATURES_FIELD_NUMBER: _ClassVar[int]
    common: CommonLanguageSettings
    renamed_services: _containers.ScalarMap[str, str]
    renamed_resources: _containers.ScalarMap[str, str]
    ignored_resources: _containers.RepeatedScalarFieldContainer[str]
    forced_namespace_aliases: _containers.RepeatedScalarFieldContainer[str]
    handwritten_signatures: _containers.RepeatedScalarFieldContainer[str]
    def __init__(
        self,
        common: _Optional[_Union[CommonLanguageSettings, _Mapping]] = ...,
        renamed_services: _Optional[_Mapping[str, str]] = ...,
        renamed_resources: _Optional[_Mapping[str, str]] = ...,
        ignored_resources: _Optional[_Iterable[str]] = ...,
        forced_namespace_aliases: _Optional[_Iterable[str]] = ...,
        handwritten_signatures: _Optional[_Iterable[str]] = ...,
    ) -> None: ...

class RubySettings(_message.Message):
    __slots__ = ("common",)
    COMMON_FIELD_NUMBER: _ClassVar[int]
    common: CommonLanguageSettings
    def __init__(
        self, common: _Optional[_Union[CommonLanguageSettings, _Mapping]] = ...
    ) -> None: ...

class GoSettings(_message.Message):
    __slots__ = ("common", "renamed_services")

    class RenamedServicesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(
            self, key: _Optional[str] = ..., value: _Optional[str] = ...
        ) -> None: ...
    COMMON_FIELD_NUMBER: _ClassVar[int]
    RENAMED_SERVICES_FIELD_NUMBER: _ClassVar[int]
    common: CommonLanguageSettings
    renamed_services: _containers.ScalarMap[str, str]
    def __init__(
        self,
        common: _Optional[_Union[CommonLanguageSettings, _Mapping]] = ...,
        renamed_services: _Optional[_Mapping[str, str]] = ...,
    ) -> None: ...

class MethodSettings(_message.Message):
    __slots__ = ("selector", "long_running", "auto_populated_fields")

    class LongRunning(_message.Message):
        __slots__ = (
            "initial_poll_delay",
            "poll_delay_multiplier",
            "max_poll_delay",
            "total_poll_timeout",
        )
        INITIAL_POLL_DELAY_FIELD_NUMBER: _ClassVar[int]
        POLL_DELAY_MULTIPLIER_FIELD_NUMBER: _ClassVar[int]
        MAX_POLL_DELAY_FIELD_NUMBER: _ClassVar[int]
        TOTAL_POLL_TIMEOUT_FIELD_NUMBER: _ClassVar[int]
        initial_poll_delay: _duration_pb2.Duration
        poll_delay_multiplier: float
        max_poll_delay: _duration_pb2.Duration
        total_poll_timeout: _duration_pb2.Duration
        def __init__(
            self,
            initial_poll_delay: _Optional[
                _Union[_duration_pb2.Duration, _Mapping]
            ] = ...,
            poll_delay_multiplier: _Optional[float] = ...,
            max_poll_delay: _Optional[_Union[_duration_pb2.Duration, _Mapping]] = ...,
            total_poll_timeout: _Optional[
                _Union[_duration_pb2.Duration, _Mapping]
            ] = ...,
        ) -> None: ...
    SELECTOR_FIELD_NUMBER: _ClassVar[int]
    LONG_RUNNING_FIELD_NUMBER: _ClassVar[int]
    AUTO_POPULATED_FIELDS_FIELD_NUMBER: _ClassVar[int]
    selector: str
    long_running: MethodSettings.LongRunning
    auto_populated_fields: _containers.RepeatedScalarFieldContainer[str]
    def __init__(
        self,
        selector: _Optional[str] = ...,
        long_running: _Optional[_Union[MethodSettings.LongRunning, _Mapping]] = ...,
        auto_populated_fields: _Optional[_Iterable[str]] = ...,
    ) -> None: ...

class SelectiveGapicGeneration(_message.Message):
    __slots__ = ("methods", "generate_omitted_as_internal")
    METHODS_FIELD_NUMBER: _ClassVar[int]
    GENERATE_OMITTED_AS_INTERNAL_FIELD_NUMBER: _ClassVar[int]
    methods: _containers.RepeatedScalarFieldContainer[str]
    generate_omitted_as_internal: bool
    def __init__(
        self,
        methods: _Optional[_Iterable[str]] = ...,
        generate_omitted_as_internal: bool = ...,
    ) -> None: ...
