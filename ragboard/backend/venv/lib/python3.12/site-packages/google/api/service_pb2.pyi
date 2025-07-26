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

from google.protobuf import api_pb2 as _api_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from google.protobuf import type_pb2 as _type_pb2
from google.protobuf import wrappers_pb2 as _wrappers_pb2
from google.protobuf.internal import containers as _containers

from google.api import auth_pb2 as _auth_pb2
from google.api import backend_pb2 as _backend_pb2
from google.api import billing_pb2 as _billing_pb2
from google.api import client_pb2 as _client_pb2
from google.api import context_pb2 as _context_pb2
from google.api import control_pb2 as _control_pb2
from google.api import documentation_pb2 as _documentation_pb2
from google.api import endpoint_pb2 as _endpoint_pb2
from google.api import http_pb2 as _http_pb2
from google.api import log_pb2 as _log_pb2
from google.api import logging_pb2 as _logging_pb2
from google.api import metric_pb2 as _metric_pb2
from google.api import monitored_resource_pb2 as _monitored_resource_pb2
from google.api import monitoring_pb2 as _monitoring_pb2
from google.api import quota_pb2 as _quota_pb2
from google.api import source_info_pb2 as _source_info_pb2
from google.api import system_parameter_pb2 as _system_parameter_pb2
from google.api import usage_pb2 as _usage_pb2

DESCRIPTOR: _descriptor.FileDescriptor

class Service(_message.Message):
    __slots__ = (
        "name",
        "title",
        "producer_project_id",
        "id",
        "apis",
        "types",
        "enums",
        "documentation",
        "backend",
        "http",
        "quota",
        "authentication",
        "context",
        "usage",
        "endpoints",
        "control",
        "logs",
        "metrics",
        "monitored_resources",
        "billing",
        "logging",
        "monitoring",
        "system_parameters",
        "source_info",
        "publishing",
        "config_version",
    )
    NAME_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    PRODUCER_PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    APIS_FIELD_NUMBER: _ClassVar[int]
    TYPES_FIELD_NUMBER: _ClassVar[int]
    ENUMS_FIELD_NUMBER: _ClassVar[int]
    DOCUMENTATION_FIELD_NUMBER: _ClassVar[int]
    BACKEND_FIELD_NUMBER: _ClassVar[int]
    HTTP_FIELD_NUMBER: _ClassVar[int]
    QUOTA_FIELD_NUMBER: _ClassVar[int]
    AUTHENTICATION_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    USAGE_FIELD_NUMBER: _ClassVar[int]
    ENDPOINTS_FIELD_NUMBER: _ClassVar[int]
    CONTROL_FIELD_NUMBER: _ClassVar[int]
    LOGS_FIELD_NUMBER: _ClassVar[int]
    METRICS_FIELD_NUMBER: _ClassVar[int]
    MONITORED_RESOURCES_FIELD_NUMBER: _ClassVar[int]
    BILLING_FIELD_NUMBER: _ClassVar[int]
    LOGGING_FIELD_NUMBER: _ClassVar[int]
    MONITORING_FIELD_NUMBER: _ClassVar[int]
    SYSTEM_PARAMETERS_FIELD_NUMBER: _ClassVar[int]
    SOURCE_INFO_FIELD_NUMBER: _ClassVar[int]
    PUBLISHING_FIELD_NUMBER: _ClassVar[int]
    CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    name: str
    title: str
    producer_project_id: str
    id: str
    apis: _containers.RepeatedCompositeFieldContainer[_api_pb2.Api]
    types: _containers.RepeatedCompositeFieldContainer[_type_pb2.Type]
    enums: _containers.RepeatedCompositeFieldContainer[_type_pb2.Enum]
    documentation: _documentation_pb2.Documentation
    backend: _backend_pb2.Backend
    http: _http_pb2.Http
    quota: _quota_pb2.Quota
    authentication: _auth_pb2.Authentication
    context: _context_pb2.Context
    usage: _usage_pb2.Usage
    endpoints: _containers.RepeatedCompositeFieldContainer[_endpoint_pb2.Endpoint]
    control: _control_pb2.Control
    logs: _containers.RepeatedCompositeFieldContainer[_log_pb2.LogDescriptor]
    metrics: _containers.RepeatedCompositeFieldContainer[_metric_pb2.MetricDescriptor]
    monitored_resources: _containers.RepeatedCompositeFieldContainer[
        _monitored_resource_pb2.MonitoredResourceDescriptor
    ]
    billing: _billing_pb2.Billing
    logging: _logging_pb2.Logging
    monitoring: _monitoring_pb2.Monitoring
    system_parameters: _system_parameter_pb2.SystemParameters
    source_info: _source_info_pb2.SourceInfo
    publishing: _client_pb2.Publishing
    config_version: _wrappers_pb2.UInt32Value
    def __init__(
        self,
        name: _Optional[str] = ...,
        title: _Optional[str] = ...,
        producer_project_id: _Optional[str] = ...,
        id: _Optional[str] = ...,
        apis: _Optional[_Iterable[_Union[_api_pb2.Api, _Mapping]]] = ...,
        types: _Optional[_Iterable[_Union[_type_pb2.Type, _Mapping]]] = ...,
        enums: _Optional[_Iterable[_Union[_type_pb2.Enum, _Mapping]]] = ...,
        documentation: _Optional[
            _Union[_documentation_pb2.Documentation, _Mapping]
        ] = ...,
        backend: _Optional[_Union[_backend_pb2.Backend, _Mapping]] = ...,
        http: _Optional[_Union[_http_pb2.Http, _Mapping]] = ...,
        quota: _Optional[_Union[_quota_pb2.Quota, _Mapping]] = ...,
        authentication: _Optional[_Union[_auth_pb2.Authentication, _Mapping]] = ...,
        context: _Optional[_Union[_context_pb2.Context, _Mapping]] = ...,
        usage: _Optional[_Union[_usage_pb2.Usage, _Mapping]] = ...,
        endpoints: _Optional[_Iterable[_Union[_endpoint_pb2.Endpoint, _Mapping]]] = ...,
        control: _Optional[_Union[_control_pb2.Control, _Mapping]] = ...,
        logs: _Optional[_Iterable[_Union[_log_pb2.LogDescriptor, _Mapping]]] = ...,
        metrics: _Optional[
            _Iterable[_Union[_metric_pb2.MetricDescriptor, _Mapping]]
        ] = ...,
        monitored_resources: _Optional[
            _Iterable[
                _Union[_monitored_resource_pb2.MonitoredResourceDescriptor, _Mapping]
            ]
        ] = ...,
        billing: _Optional[_Union[_billing_pb2.Billing, _Mapping]] = ...,
        logging: _Optional[_Union[_logging_pb2.Logging, _Mapping]] = ...,
        monitoring: _Optional[_Union[_monitoring_pb2.Monitoring, _Mapping]] = ...,
        system_parameters: _Optional[
            _Union[_system_parameter_pb2.SystemParameters, _Mapping]
        ] = ...,
        source_info: _Optional[_Union[_source_info_pb2.SourceInfo, _Mapping]] = ...,
        publishing: _Optional[_Union[_client_pb2.Publishing, _Mapping]] = ...,
        config_version: _Optional[_Union[_wrappers_pb2.UInt32Value, _Mapping]] = ...,
    ) -> None: ...
