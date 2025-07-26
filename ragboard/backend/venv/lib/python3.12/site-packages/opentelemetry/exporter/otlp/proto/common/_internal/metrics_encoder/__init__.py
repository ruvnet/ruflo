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
from __future__ import annotations

import logging
from os import environ
from typing import Dict, List

from opentelemetry.exporter.otlp.proto.common._internal import (
    _encode_attributes,
    _encode_instrumentation_scope,
    _encode_span_id,
    _encode_trace_id,
)
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.metrics.v1 import metrics_pb2 as pb2
from opentelemetry.proto.resource.v1.resource_pb2 import (
    Resource as PB2Resource,
)
from opentelemetry.sdk.environment_variables import (
    OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION,
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE,
)
from opentelemetry.sdk.metrics import (
    Counter,
    Exemplar,
    Histogram,
    ObservableCounter,
    ObservableGauge,
    ObservableUpDownCounter,
    UpDownCounter,
)
from opentelemetry.sdk.metrics.export import (
    AggregationTemporality,
    Gauge,
    MetricExporter,
    MetricsData,
    Sum,
)
from opentelemetry.sdk.metrics.export import (
    ExponentialHistogram as ExponentialHistogramType,
)
from opentelemetry.sdk.metrics.export import (
    Histogram as HistogramType,
)
from opentelemetry.sdk.metrics.view import (
    Aggregation,
    ExplicitBucketHistogramAggregation,
    ExponentialBucketHistogramAggregation,
)

_logger = logging.getLogger(__name__)


class OTLPMetricExporterMixin:
    def _common_configuration(
        self,
        preferred_temporality: dict[type, AggregationTemporality]
        | None = None,
        preferred_aggregation: dict[type, Aggregation] | None = None,
    ) -> None:
        MetricExporter.__init__(
            self,
            preferred_temporality=self._get_temporality(preferred_temporality),
            preferred_aggregation=self._get_aggregation(preferred_aggregation),
        )

    def _get_temporality(
        self, preferred_temporality: Dict[type, AggregationTemporality]
    ) -> Dict[type, AggregationTemporality]:
        otel_exporter_otlp_metrics_temporality_preference = (
            environ.get(
                OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE,
                "CUMULATIVE",
            )
            .upper()
            .strip()
        )

        if otel_exporter_otlp_metrics_temporality_preference == "DELTA":
            instrument_class_temporality = {
                Counter: AggregationTemporality.DELTA,
                UpDownCounter: AggregationTemporality.CUMULATIVE,
                Histogram: AggregationTemporality.DELTA,
                ObservableCounter: AggregationTemporality.DELTA,
                ObservableUpDownCounter: AggregationTemporality.CUMULATIVE,
                ObservableGauge: AggregationTemporality.CUMULATIVE,
            }

        elif otel_exporter_otlp_metrics_temporality_preference == "LOWMEMORY":
            instrument_class_temporality = {
                Counter: AggregationTemporality.DELTA,
                UpDownCounter: AggregationTemporality.CUMULATIVE,
                Histogram: AggregationTemporality.DELTA,
                ObservableCounter: AggregationTemporality.CUMULATIVE,
                ObservableUpDownCounter: AggregationTemporality.CUMULATIVE,
                ObservableGauge: AggregationTemporality.CUMULATIVE,
            }

        else:
            if otel_exporter_otlp_metrics_temporality_preference != (
                "CUMULATIVE"
            ):
                _logger.warning(
                    "Unrecognized OTEL_EXPORTER_METRICS_TEMPORALITY_PREFERENCE"
                    " value found: "
                    "%s, "
                    "using CUMULATIVE",
                    otel_exporter_otlp_metrics_temporality_preference,
                )
            instrument_class_temporality = {
                Counter: AggregationTemporality.CUMULATIVE,
                UpDownCounter: AggregationTemporality.CUMULATIVE,
                Histogram: AggregationTemporality.CUMULATIVE,
                ObservableCounter: AggregationTemporality.CUMULATIVE,
                ObservableUpDownCounter: AggregationTemporality.CUMULATIVE,
                ObservableGauge: AggregationTemporality.CUMULATIVE,
            }

        instrument_class_temporality.update(preferred_temporality or {})

        return instrument_class_temporality

    def _get_aggregation(
        self,
        preferred_aggregation: Dict[type, Aggregation],
    ) -> Dict[type, Aggregation]:
        otel_exporter_otlp_metrics_default_histogram_aggregation = environ.get(
            OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION,
            "explicit_bucket_histogram",
        )

        if otel_exporter_otlp_metrics_default_histogram_aggregation == (
            "base2_exponential_bucket_histogram"
        ):
            instrument_class_aggregation = {
                Histogram: ExponentialBucketHistogramAggregation(),
            }

        else:
            if otel_exporter_otlp_metrics_default_histogram_aggregation != (
                "explicit_bucket_histogram"
            ):
                _logger.warning(
                    (
                        "Invalid value for %s: %s, using explicit bucket "
                        "histogram aggregation"
                    ),
                    OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION,
                    otel_exporter_otlp_metrics_default_histogram_aggregation,
                )

            instrument_class_aggregation = {
                Histogram: ExplicitBucketHistogramAggregation(),
            }

        instrument_class_aggregation.update(preferred_aggregation or {})

        return instrument_class_aggregation


class EncodingException(Exception):
    """
    Raised by encode_metrics() when an exception is caught during encoding. Contains the problematic metric so
    the misbehaving metric name and details can be logged during exception handling.
    """

    def __init__(self, original_exception, metric):
        super().__init__()
        self.original_exception = original_exception
        self.metric = metric

    def __str__(self):
        return f"{self.metric}\n{self.original_exception}"


def encode_metrics(data: MetricsData) -> ExportMetricsServiceRequest:
    resource_metrics_dict = {}

    for resource_metrics in data.resource_metrics:
        _encode_resource_metrics(resource_metrics, resource_metrics_dict)

    resource_data = []
    for (
        sdk_resource,
        scope_data,
    ) in resource_metrics_dict.items():
        resource_data.append(
            pb2.ResourceMetrics(
                resource=PB2Resource(
                    attributes=_encode_attributes(sdk_resource.attributes)
                ),
                scope_metrics=scope_data.values(),
                schema_url=sdk_resource.schema_url,
            )
        )
    return ExportMetricsServiceRequest(resource_metrics=resource_data)


def _encode_resource_metrics(resource_metrics, resource_metrics_dict):
    resource = resource_metrics.resource
    # It is safe to assume that each entry in data.resource_metrics is
    # associated with an unique resource.
    scope_metrics_dict = {}
    resource_metrics_dict[resource] = scope_metrics_dict
    for scope_metrics in resource_metrics.scope_metrics:
        instrumentation_scope = scope_metrics.scope

        # The SDK groups metrics in instrumentation scopes already so
        # there is no need to check for existing instrumentation scopes
        # here.
        pb2_scope_metrics = pb2.ScopeMetrics(
            scope=_encode_instrumentation_scope(instrumentation_scope),
            schema_url=instrumentation_scope.schema_url,
        )

        scope_metrics_dict[instrumentation_scope] = pb2_scope_metrics

        for metric in scope_metrics.metrics:
            pb2_metric = pb2.Metric(
                name=metric.name,
                description=metric.description,
                unit=metric.unit,
            )

            try:
                _encode_metric(metric, pb2_metric)
            except Exception as ex:
                # `from None` so we don't get "During handling of the above exception, another exception occurred:"
                raise EncodingException(ex, metric) from None

            pb2_scope_metrics.metrics.append(pb2_metric)


def _encode_metric(metric, pb2_metric):
    if isinstance(metric.data, Gauge):
        for data_point in metric.data.data_points:
            pt = pb2.NumberDataPoint(
                attributes=_encode_attributes(data_point.attributes),
                time_unix_nano=data_point.time_unix_nano,
                exemplars=_encode_exemplars(data_point.exemplars),
            )
            if isinstance(data_point.value, int):
                pt.as_int = data_point.value
            else:
                pt.as_double = data_point.value
            pb2_metric.gauge.data_points.append(pt)

    elif isinstance(metric.data, HistogramType):
        for data_point in metric.data.data_points:
            pt = pb2.HistogramDataPoint(
                attributes=_encode_attributes(data_point.attributes),
                time_unix_nano=data_point.time_unix_nano,
                start_time_unix_nano=data_point.start_time_unix_nano,
                exemplars=_encode_exemplars(data_point.exemplars),
                count=data_point.count,
                sum=data_point.sum,
                bucket_counts=data_point.bucket_counts,
                explicit_bounds=data_point.explicit_bounds,
                max=data_point.max,
                min=data_point.min,
            )
            pb2_metric.histogram.aggregation_temporality = (
                metric.data.aggregation_temporality
            )
            pb2_metric.histogram.data_points.append(pt)

    elif isinstance(metric.data, Sum):
        for data_point in metric.data.data_points:
            pt = pb2.NumberDataPoint(
                attributes=_encode_attributes(data_point.attributes),
                start_time_unix_nano=data_point.start_time_unix_nano,
                time_unix_nano=data_point.time_unix_nano,
                exemplars=_encode_exemplars(data_point.exemplars),
            )
            if isinstance(data_point.value, int):
                pt.as_int = data_point.value
            else:
                pt.as_double = data_point.value
            # note that because sum is a message type, the
            # fields must be set individually rather than
            # instantiating a pb2.Sum and setting it once
            pb2_metric.sum.aggregation_temporality = (
                metric.data.aggregation_temporality
            )
            pb2_metric.sum.is_monotonic = metric.data.is_monotonic
            pb2_metric.sum.data_points.append(pt)

    elif isinstance(metric.data, ExponentialHistogramType):
        for data_point in metric.data.data_points:
            if data_point.positive.bucket_counts:
                positive = pb2.ExponentialHistogramDataPoint.Buckets(
                    offset=data_point.positive.offset,
                    bucket_counts=data_point.positive.bucket_counts,
                )
            else:
                positive = None

            if data_point.negative.bucket_counts:
                negative = pb2.ExponentialHistogramDataPoint.Buckets(
                    offset=data_point.negative.offset,
                    bucket_counts=data_point.negative.bucket_counts,
                )
            else:
                negative = None

            pt = pb2.ExponentialHistogramDataPoint(
                attributes=_encode_attributes(data_point.attributes),
                time_unix_nano=data_point.time_unix_nano,
                start_time_unix_nano=data_point.start_time_unix_nano,
                exemplars=_encode_exemplars(data_point.exemplars),
                count=data_point.count,
                sum=data_point.sum,
                scale=data_point.scale,
                zero_count=data_point.zero_count,
                positive=positive,
                negative=negative,
                flags=data_point.flags,
                max=data_point.max,
                min=data_point.min,
            )
            pb2_metric.exponential_histogram.aggregation_temporality = (
                metric.data.aggregation_temporality
            )
            pb2_metric.exponential_histogram.data_points.append(pt)

    else:
        _logger.warning(
            "unsupported data type %s",
            metric.data.__class__.__name__,
        )


def _encode_exemplars(sdk_exemplars: List[Exemplar]) -> List[pb2.Exemplar]:
    """
    Converts a list of SDK Exemplars into a list of protobuf Exemplars.

    Args:
        sdk_exemplars (list): The list of exemplars from the OpenTelemetry SDK.

    Returns:
        list: A list of protobuf exemplars.
    """
    pb_exemplars = []
    for sdk_exemplar in sdk_exemplars:
        if (
            sdk_exemplar.span_id is not None
            and sdk_exemplar.trace_id is not None
        ):
            pb_exemplar = pb2.Exemplar(
                time_unix_nano=sdk_exemplar.time_unix_nano,
                span_id=_encode_span_id(sdk_exemplar.span_id),
                trace_id=_encode_trace_id(sdk_exemplar.trace_id),
                filtered_attributes=_encode_attributes(
                    sdk_exemplar.filtered_attributes
                ),
            )
        else:
            pb_exemplar = pb2.Exemplar(
                time_unix_nano=sdk_exemplar.time_unix_nano,
                filtered_attributes=_encode_attributes(
                    sdk_exemplar.filtered_attributes
                ),
            )

        # Assign the value based on its type in the SDK exemplar
        if isinstance(sdk_exemplar.value, float):
            pb_exemplar.as_double = sdk_exemplar.value
        elif isinstance(sdk_exemplar.value, int):
            pb_exemplar.as_int = sdk_exemplar.value
        else:
            raise ValueError("Exemplar value must be an int or float")
        pb_exemplars.append(pb_exemplar)

    return pb_exemplars
