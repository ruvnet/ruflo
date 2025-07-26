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


from typing import Final

from opentelemetry.metrics import Counter, Histogram, Meter, UpDownCounter

OTEL_SDK_EXPORTER_LOG_EXPORTED: Final = "otel.sdk.exporter.log.exported"
"""
The number of log records for which the export has finished, either successful or failed
Instrument: counter
Unit: {log_record}
Note: For successful exports, `error.type` MUST NOT be set. For failed exports, `error.type` MUST contain the failure cause.
For exporters with partial success semantics (e.g. OTLP with `rejected_log_records`), rejected log records MUST count as failed and only non-rejected log records count as success.
If no rejection reason is available, `rejected` SHOULD be used as value for `error.type`.
"""


def create_otel_sdk_exporter_log_exported(meter: Meter) -> Counter:
    """The number of log records for which the export has finished, either successful or failed"""
    return meter.create_counter(
        name=OTEL_SDK_EXPORTER_LOG_EXPORTED,
        description="The number of log records for which the export has finished, either successful or failed",
        unit="{log_record}",
    )


OTEL_SDK_EXPORTER_LOG_INFLIGHT: Final = "otel.sdk.exporter.log.inflight"
"""
The number of log records which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)
Instrument: updowncounter
Unit: {log_record}
Note: For successful exports, `error.type` MUST NOT be set. For failed exports, `error.type` MUST contain the failure cause.
"""


def create_otel_sdk_exporter_log_inflight(meter: Meter) -> UpDownCounter:
    """The number of log records which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_EXPORTER_LOG_INFLIGHT,
        description="The number of log records which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)",
        unit="{log_record}",
    )


OTEL_SDK_EXPORTER_METRIC_DATA_POINT_EXPORTED: Final = (
    "otel.sdk.exporter.metric_data_point.exported"
)
"""
The number of metric data points for which the export has finished, either successful or failed
Instrument: counter
Unit: {data_point}
Note: For successful exports, `error.type` MUST NOT be set. For failed exports, `error.type` MUST contain the failure cause.
For exporters with partial success semantics (e.g. OTLP with `rejected_data_points`), rejected data points MUST count as failed and only non-rejected data points count as success.
If no rejection reason is available, `rejected` SHOULD be used as value for `error.type`.
"""


def create_otel_sdk_exporter_metric_data_point_exported(
    meter: Meter,
) -> Counter:
    """The number of metric data points for which the export has finished, either successful or failed"""
    return meter.create_counter(
        name=OTEL_SDK_EXPORTER_METRIC_DATA_POINT_EXPORTED,
        description="The number of metric data points for which the export has finished, either successful or failed",
        unit="{data_point}",
    )


OTEL_SDK_EXPORTER_METRIC_DATA_POINT_INFLIGHT: Final = (
    "otel.sdk.exporter.metric_data_point.inflight"
)
"""
The number of metric data points which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)
Instrument: updowncounter
Unit: {data_point}
Note: For successful exports, `error.type` MUST NOT be set. For failed exports, `error.type` MUST contain the failure cause.
"""


def create_otel_sdk_exporter_metric_data_point_inflight(
    meter: Meter,
) -> UpDownCounter:
    """The number of metric data points which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_EXPORTER_METRIC_DATA_POINT_INFLIGHT,
        description="The number of metric data points which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)",
        unit="{data_point}",
    )


OTEL_SDK_EXPORTER_OPERATION_DURATION: Final = (
    "otel.sdk.exporter.operation.duration"
)
"""
The duration of exporting a batch of telemetry records
Instrument: histogram
Unit: s
Note: This metric defines successful operations using the full success definitions for [http](https://github.com/open-telemetry/opentelemetry-proto/blob/v1.5.0/docs/specification.md#full-success-1)
and [grpc](https://github.com/open-telemetry/opentelemetry-proto/blob/v1.5.0/docs/specification.md#full-success). Anything else is defined as an unsuccessful operation. For successful
operations, `error.type` MUST NOT be set. For unsuccessful export operations, `error.type` MUST contain a relevant failure cause.
"""


def create_otel_sdk_exporter_operation_duration(meter: Meter) -> Histogram:
    """The duration of exporting a batch of telemetry records"""
    return meter.create_histogram(
        name=OTEL_SDK_EXPORTER_OPERATION_DURATION,
        description="The duration of exporting a batch of telemetry records.",
        unit="s",
    )


OTEL_SDK_EXPORTER_SPAN_EXPORTED: Final = "otel.sdk.exporter.span.exported"
"""
The number of spans for which the export has finished, either successful or failed
Instrument: counter
Unit: {span}
Note: For successful exports, `error.type` MUST NOT be set. For failed exports, `error.type` MUST contain the failure cause.
For exporters with partial success semantics (e.g. OTLP with `rejected_spans`), rejected spans MUST count as failed and only non-rejected spans count as success.
If no rejection reason is available, `rejected` SHOULD be used as value for `error.type`.
"""


def create_otel_sdk_exporter_span_exported(meter: Meter) -> Counter:
    """The number of spans for which the export has finished, either successful or failed"""
    return meter.create_counter(
        name=OTEL_SDK_EXPORTER_SPAN_EXPORTED,
        description="The number of spans for which the export has finished, either successful or failed",
        unit="{span}",
    )


OTEL_SDK_EXPORTER_SPAN_EXPORTED_COUNT: Final = (
    "otel.sdk.exporter.span.exported.count"
)
"""
Deprecated: Replaced by `otel.sdk.exporter.span.exported`.
"""


def create_otel_sdk_exporter_span_exported_count(
    meter: Meter,
) -> UpDownCounter:
    """Deprecated, use `otel.sdk.exporter.span.exported` instead"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_EXPORTER_SPAN_EXPORTED_COUNT,
        description="Deprecated, use `otel.sdk.exporter.span.exported` instead.",
        unit="{span}",
    )


OTEL_SDK_EXPORTER_SPAN_INFLIGHT: Final = "otel.sdk.exporter.span.inflight"
"""
The number of spans which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)
Instrument: updowncounter
Unit: {span}
Note: For successful exports, `error.type` MUST NOT be set. For failed exports, `error.type` MUST contain the failure cause.
"""


def create_otel_sdk_exporter_span_inflight(meter: Meter) -> UpDownCounter:
    """The number of spans which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_EXPORTER_SPAN_INFLIGHT,
        description="The number of spans which were passed to the exporter, but that have not been exported yet (neither successful, nor failed)",
        unit="{span}",
    )


OTEL_SDK_EXPORTER_SPAN_INFLIGHT_COUNT: Final = (
    "otel.sdk.exporter.span.inflight.count"
)
"""
Deprecated: Replaced by `otel.sdk.exporter.span.inflight`.
"""


def create_otel_sdk_exporter_span_inflight_count(
    meter: Meter,
) -> UpDownCounter:
    """Deprecated, use `otel.sdk.exporter.span.inflight` instead"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_EXPORTER_SPAN_INFLIGHT_COUNT,
        description="Deprecated, use `otel.sdk.exporter.span.inflight` instead.",
        unit="{span}",
    )


OTEL_SDK_LOG_CREATED: Final = "otel.sdk.log.created"
"""
The number of logs submitted to enabled SDK Loggers
Instrument: counter
Unit: {log_record}
"""


def create_otel_sdk_log_created(meter: Meter) -> Counter:
    """The number of logs submitted to enabled SDK Loggers"""
    return meter.create_counter(
        name=OTEL_SDK_LOG_CREATED,
        description="The number of logs submitted to enabled SDK Loggers",
        unit="{log_record}",
    )


OTEL_SDK_METRIC_READER_COLLECTION_DURATION: Final = (
    "otel.sdk.metric_reader.collection.duration"
)
"""
The duration of the collect operation of the metric reader
Instrument: histogram
Unit: s
Note: For successful collections, `error.type` MUST NOT be set. For failed collections, `error.type` SHOULD contain the failure cause.
It can happen that metrics collection is successful for some MetricProducers, while others fail. In that case `error.type` SHOULD be set to any of the failure causes.
"""


def create_otel_sdk_metric_reader_collection_duration(
    meter: Meter,
) -> Histogram:
    """The duration of the collect operation of the metric reader"""
    return meter.create_histogram(
        name=OTEL_SDK_METRIC_READER_COLLECTION_DURATION,
        description="The duration of the collect operation of the metric reader.",
        unit="s",
    )


OTEL_SDK_PROCESSOR_LOG_PROCESSED: Final = "otel.sdk.processor.log.processed"
"""
The number of log records for which the processing has finished, either successful or failed
Instrument: counter
Unit: {log_record}
Note: For successful processing, `error.type` MUST NOT be set. For failed processing, `error.type` MUST contain the failure cause.
For the SDK Simple and Batching Log Record Processor a log record is considered to be processed already when it has been submitted to the exporter,
not when the corresponding export call has finished.
"""


def create_otel_sdk_processor_log_processed(meter: Meter) -> Counter:
    """The number of log records for which the processing has finished, either successful or failed"""
    return meter.create_counter(
        name=OTEL_SDK_PROCESSOR_LOG_PROCESSED,
        description="The number of log records for which the processing has finished, either successful or failed",
        unit="{log_record}",
    )


OTEL_SDK_PROCESSOR_LOG_QUEUE_CAPACITY: Final = (
    "otel.sdk.processor.log.queue.capacity"
)
"""
The maximum number of log records the queue of a given instance of an SDK Log Record processor can hold
Instrument: updowncounter
Unit: {log_record}
Note: Only applies to Log Record processors which use a queue, e.g. the SDK Batching Log Record Processor.
"""


def create_otel_sdk_processor_log_queue_capacity(
    meter: Meter,
) -> UpDownCounter:
    """The maximum number of log records the queue of a given instance of an SDK Log Record processor can hold"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_PROCESSOR_LOG_QUEUE_CAPACITY,
        description="The maximum number of log records the queue of a given instance of an SDK Log Record processor can hold",
        unit="{log_record}",
    )


OTEL_SDK_PROCESSOR_LOG_QUEUE_SIZE: Final = "otel.sdk.processor.log.queue.size"
"""
The number of log records in the queue of a given instance of an SDK log processor
Instrument: updowncounter
Unit: {log_record}
Note: Only applies to log record processors which use a queue, e.g. the SDK Batching Log Record Processor.
"""


def create_otel_sdk_processor_log_queue_size(meter: Meter) -> UpDownCounter:
    """The number of log records in the queue of a given instance of an SDK log processor"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_PROCESSOR_LOG_QUEUE_SIZE,
        description="The number of log records in the queue of a given instance of an SDK log processor",
        unit="{log_record}",
    )


OTEL_SDK_PROCESSOR_SPAN_PROCESSED: Final = "otel.sdk.processor.span.processed"
"""
The number of spans for which the processing has finished, either successful or failed
Instrument: counter
Unit: {span}
Note: For successful processing, `error.type` MUST NOT be set. For failed processing, `error.type` MUST contain the failure cause.
For the SDK Simple and Batching Span Processor a span is considered to be processed already when it has been submitted to the exporter, not when the corresponding export call has finished.
"""


def create_otel_sdk_processor_span_processed(meter: Meter) -> Counter:
    """The number of spans for which the processing has finished, either successful or failed"""
    return meter.create_counter(
        name=OTEL_SDK_PROCESSOR_SPAN_PROCESSED,
        description="The number of spans for which the processing has finished, either successful or failed",
        unit="{span}",
    )


OTEL_SDK_PROCESSOR_SPAN_PROCESSED_COUNT: Final = (
    "otel.sdk.processor.span.processed.count"
)
"""
Deprecated: Replaced by `otel.sdk.processor.span.processed`.
"""


def create_otel_sdk_processor_span_processed_count(
    meter: Meter,
) -> UpDownCounter:
    """Deprecated, use `otel.sdk.processor.span.processed` instead"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_PROCESSOR_SPAN_PROCESSED_COUNT,
        description="Deprecated, use `otel.sdk.processor.span.processed` instead.",
        unit="{span}",
    )


OTEL_SDK_PROCESSOR_SPAN_QUEUE_CAPACITY: Final = (
    "otel.sdk.processor.span.queue.capacity"
)
"""
The maximum number of spans the queue of a given instance of an SDK span processor can hold
Instrument: updowncounter
Unit: {span}
Note: Only applies to span processors which use a queue, e.g. the SDK Batching Span Processor.
"""


def create_otel_sdk_processor_span_queue_capacity(
    meter: Meter,
) -> UpDownCounter:
    """The maximum number of spans the queue of a given instance of an SDK span processor can hold"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_PROCESSOR_SPAN_QUEUE_CAPACITY,
        description="The maximum number of spans the queue of a given instance of an SDK span processor can hold",
        unit="{span}",
    )


OTEL_SDK_PROCESSOR_SPAN_QUEUE_SIZE: Final = (
    "otel.sdk.processor.span.queue.size"
)
"""
The number of spans in the queue of a given instance of an SDK span processor
Instrument: updowncounter
Unit: {span}
Note: Only applies to span processors which use a queue, e.g. the SDK Batching Span Processor.
"""


def create_otel_sdk_processor_span_queue_size(meter: Meter) -> UpDownCounter:
    """The number of spans in the queue of a given instance of an SDK span processor"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_PROCESSOR_SPAN_QUEUE_SIZE,
        description="The number of spans in the queue of a given instance of an SDK span processor",
        unit="{span}",
    )


OTEL_SDK_SPAN_ENDED: Final = "otel.sdk.span.ended"
"""
Deprecated: Obsoleted.
"""


def create_otel_sdk_span_ended(meter: Meter) -> Counter:
    """Use `otel.sdk.span.started` minus `otel.sdk.span.live` to derive this value"""
    return meter.create_counter(
        name=OTEL_SDK_SPAN_ENDED,
        description="Use `otel.sdk.span.started` minus `otel.sdk.span.live` to derive this value.",
        unit="{span}",
    )


OTEL_SDK_SPAN_ENDED_COUNT: Final = "otel.sdk.span.ended.count"
"""
Deprecated: Obsoleted.
"""


def create_otel_sdk_span_ended_count(meter: Meter) -> Counter:
    """Use `otel.sdk.span.started` minus `otel.sdk.span.live` to derive this value"""
    return meter.create_counter(
        name=OTEL_SDK_SPAN_ENDED_COUNT,
        description="Use `otel.sdk.span.started` minus `otel.sdk.span.live` to derive this value.",
        unit="{span}",
    )


OTEL_SDK_SPAN_LIVE: Final = "otel.sdk.span.live"
"""
The number of created spans with `recording=true` for which the end operation has not been called yet
Instrument: updowncounter
Unit: {span}
"""


def create_otel_sdk_span_live(meter: Meter) -> UpDownCounter:
    """The number of created spans with `recording=true` for which the end operation has not been called yet"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_SPAN_LIVE,
        description="The number of created spans with `recording=true` for which the end operation has not been called yet",
        unit="{span}",
    )


OTEL_SDK_SPAN_LIVE_COUNT: Final = "otel.sdk.span.live.count"
"""
Deprecated: Replaced by `otel.sdk.span.live`.
"""


def create_otel_sdk_span_live_count(meter: Meter) -> UpDownCounter:
    """Deprecated, use `otel.sdk.span.live` instead"""
    return meter.create_up_down_counter(
        name=OTEL_SDK_SPAN_LIVE_COUNT,
        description="Deprecated, use `otel.sdk.span.live` instead.",
        unit="{span}",
    )


OTEL_SDK_SPAN_STARTED: Final = "otel.sdk.span.started"
"""
The number of created spans
Instrument: counter
Unit: {span}
Note: Implementations MUST record this metric for all spans, even for non-recording ones.
"""


def create_otel_sdk_span_started(meter: Meter) -> Counter:
    """The number of created spans"""
    return meter.create_counter(
        name=OTEL_SDK_SPAN_STARTED,
        description="The number of created spans",
        unit="{span}",
    )
