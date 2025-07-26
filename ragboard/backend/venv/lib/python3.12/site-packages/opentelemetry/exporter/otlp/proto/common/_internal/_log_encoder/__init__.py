# Copyright The OpenTelemetry Authors
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
from collections import defaultdict
from typing import List, Sequence

from opentelemetry.exporter.otlp.proto.common._internal import (
    _encode_attributes,
    _encode_instrumentation_scope,
    _encode_resource,
    _encode_span_id,
    _encode_trace_id,
    _encode_value,
)
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import (
    ExportLogsServiceRequest,
)
from opentelemetry.proto.logs.v1.logs_pb2 import LogRecord as PB2LogRecord
from opentelemetry.proto.logs.v1.logs_pb2 import (
    ResourceLogs,
    ScopeLogs,
)
from opentelemetry.sdk._logs import LogData


def encode_logs(batch: Sequence[LogData]) -> ExportLogsServiceRequest:
    return ExportLogsServiceRequest(resource_logs=_encode_resource_logs(batch))


def _encode_log(log_data: LogData) -> PB2LogRecord:
    span_id = (
        None
        if log_data.log_record.span_id == 0
        else _encode_span_id(log_data.log_record.span_id)
    )
    trace_id = (
        None
        if log_data.log_record.trace_id == 0
        else _encode_trace_id(log_data.log_record.trace_id)
    )
    body = log_data.log_record.body
    return PB2LogRecord(
        time_unix_nano=log_data.log_record.timestamp,
        observed_time_unix_nano=log_data.log_record.observed_timestamp,
        span_id=span_id,
        trace_id=trace_id,
        flags=int(log_data.log_record.trace_flags),
        body=_encode_value(body, allow_null=True),
        severity_text=log_data.log_record.severity_text,
        attributes=_encode_attributes(
            log_data.log_record.attributes, allow_null=True
        ),
        dropped_attributes_count=log_data.log_record.dropped_attributes,
        severity_number=log_data.log_record.severity_number.value,
        event_name=log_data.log_record.event_name,
    )


def _encode_resource_logs(batch: Sequence[LogData]) -> List[ResourceLogs]:
    sdk_resource_logs = defaultdict(lambda: defaultdict(list))

    for sdk_log in batch:
        sdk_resource = sdk_log.log_record.resource
        sdk_instrumentation = sdk_log.instrumentation_scope or None
        pb2_log = _encode_log(sdk_log)

        sdk_resource_logs[sdk_resource][sdk_instrumentation].append(pb2_log)

    pb2_resource_logs = []

    for sdk_resource, sdk_instrumentations in sdk_resource_logs.items():
        scope_logs = []
        for sdk_instrumentation, pb2_logs in sdk_instrumentations.items():
            scope_logs.append(
                ScopeLogs(
                    scope=(_encode_instrumentation_scope(sdk_instrumentation)),
                    log_records=pb2_logs,
                    schema_url=sdk_instrumentation.schema_url
                    if sdk_instrumentation
                    else None,
                )
            )
        pb2_resource_logs.append(
            ResourceLogs(
                resource=_encode_resource(sdk_resource),
                scope_logs=scope_logs,
                schema_url=sdk_resource.schema_url,
            )
        )

    return pb2_resource_logs
