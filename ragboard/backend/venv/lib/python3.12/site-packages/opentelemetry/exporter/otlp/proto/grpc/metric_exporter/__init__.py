# Copyright The OpenTelemetry Authors
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

from dataclasses import replace
from logging import getLogger
from os import environ
from typing import Iterable, List, Tuple, Union
from typing import Sequence as TypingSequence

from grpc import ChannelCredentials, Compression
from opentelemetry.exporter.otlp.proto.common._internal.metrics_encoder import (
    OTLPMetricExporterMixin,
)
from opentelemetry.exporter.otlp.proto.common.metrics_encoder import (
    encode_metrics,
)
from opentelemetry.exporter.otlp.proto.grpc.exporter import (  # noqa: F401
    OTLPExporterMixin,
    _get_credentials,
    environ_to_compression,
    get_resource_data,
)
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2_grpc import (
    MetricsServiceStub,
)
from opentelemetry.proto.common.v1.common_pb2 import (  # noqa: F401
    InstrumentationScope,
)
from opentelemetry.proto.metrics.v1 import metrics_pb2 as pb2  # noqa: F401
from opentelemetry.sdk.environment_variables import (
    OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE,
    OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE,
    OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY,
    OTEL_EXPORTER_OTLP_METRICS_COMPRESSION,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    OTEL_EXPORTER_OTLP_METRICS_HEADERS,
    OTEL_EXPORTER_OTLP_METRICS_INSECURE,
    OTEL_EXPORTER_OTLP_METRICS_TIMEOUT,
)
from opentelemetry.sdk.metrics._internal.aggregation import Aggregation
from opentelemetry.sdk.metrics.export import (  # noqa: F401
    AggregationTemporality,
    DataPointT,
    Gauge,
    Metric,
    MetricExporter,
    MetricExportResult,
    MetricsData,
    ResourceMetrics,
    ScopeMetrics,
    Sum,
)
from opentelemetry.sdk.metrics.export import (  # noqa: F401
    ExponentialHistogram as ExponentialHistogramType,
)
from opentelemetry.sdk.metrics.export import (  # noqa: F401
    Histogram as HistogramType,
)

_logger = getLogger(__name__)


class OTLPMetricExporter(
    MetricExporter,
    OTLPExporterMixin[Metric, ExportMetricsServiceRequest, MetricExportResult],
    OTLPMetricExporterMixin,
):
    """OTLP metric exporter

    Args:
        endpoint: Target URL to which the exporter is going to send metrics
        max_export_batch_size: Maximum number of data points to export in a single request. This is to deal with
            gRPC's 4MB message size limit. If not set there is no limit to the number of data points in a request.
            If it is set and the number of data points exceeds the max, the request will be split.
    """

    _result = MetricExportResult
    _stub = MetricsServiceStub

    def __init__(
        self,
        endpoint: str | None = None,
        insecure: bool | None = None,
        credentials: ChannelCredentials | None = None,
        headers: Union[TypingSequence[Tuple[str, str]], dict[str, str], str]
        | None = None,
        timeout: float | None = None,
        compression: Compression | None = None,
        preferred_temporality: dict[type, AggregationTemporality]
        | None = None,
        preferred_aggregation: dict[type, Aggregation] | None = None,
        max_export_batch_size: int | None = None,
        channel_options: TypingSequence[Tuple[str, str]] | None = None,
    ):
        if insecure is None:
            insecure = environ.get(OTEL_EXPORTER_OTLP_METRICS_INSECURE)
            if insecure is not None:
                insecure = insecure.lower() == "true"

        if (
            not insecure
            and environ.get(OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE) is not None
        ):
            credentials = _get_credentials(
                credentials,
                OTEL_EXPORTER_OTLP_METRICS_CERTIFICATE,
                OTEL_EXPORTER_OTLP_METRICS_CLIENT_KEY,
                OTEL_EXPORTER_OTLP_METRICS_CLIENT_CERTIFICATE,
            )

        environ_timeout = environ.get(OTEL_EXPORTER_OTLP_METRICS_TIMEOUT)
        environ_timeout = (
            float(environ_timeout) if environ_timeout is not None else None
        )

        compression = (
            environ_to_compression(OTEL_EXPORTER_OTLP_METRICS_COMPRESSION)
            if compression is None
            else compression
        )

        self._common_configuration(
            preferred_temporality, preferred_aggregation
        )

        OTLPExporterMixin.__init__(
            self,
            endpoint=endpoint
            or environ.get(OTEL_EXPORTER_OTLP_METRICS_ENDPOINT),
            insecure=insecure,
            credentials=credentials,
            headers=headers or environ.get(OTEL_EXPORTER_OTLP_METRICS_HEADERS),
            timeout=timeout or environ_timeout,
            compression=compression,
            channel_options=channel_options,
        )

        self._max_export_batch_size: int | None = max_export_batch_size

    def _translate_data(
        self, data: MetricsData
    ) -> ExportMetricsServiceRequest:
        return encode_metrics(data)

    def export(
        self,
        metrics_data: MetricsData,
        timeout_millis: float = 10_000,
        **kwargs,
    ) -> MetricExportResult:
        # TODO(#2663): OTLPExporterMixin should pass timeout to gRPC
        if self._max_export_batch_size is None:
            return self._export(data=metrics_data)

        export_result = MetricExportResult.SUCCESS

        for split_metrics_data in self._split_metrics_data(metrics_data):
            split_export_result = self._export(data=split_metrics_data)

            if split_export_result is MetricExportResult.FAILURE:
                export_result = MetricExportResult.FAILURE
        return export_result

    def _split_metrics_data(
        self,
        metrics_data: MetricsData,
    ) -> Iterable[MetricsData]:
        batch_size: int = 0
        split_resource_metrics: List[ResourceMetrics] = []

        for resource_metrics in metrics_data.resource_metrics:
            split_scope_metrics: List[ScopeMetrics] = []
            split_resource_metrics.append(
                replace(
                    resource_metrics,
                    scope_metrics=split_scope_metrics,
                )
            )
            for scope_metrics in resource_metrics.scope_metrics:
                split_metrics: List[Metric] = []
                split_scope_metrics.append(
                    replace(
                        scope_metrics,
                        metrics=split_metrics,
                    )
                )
                for metric in scope_metrics.metrics:
                    split_data_points: List[DataPointT] = []
                    split_metrics.append(
                        replace(
                            metric,
                            data=replace(
                                metric.data,
                                data_points=split_data_points,
                            ),
                        )
                    )

                    for data_point in metric.data.data_points:
                        split_data_points.append(data_point)
                        batch_size += 1

                        if batch_size >= self._max_export_batch_size:
                            yield MetricsData(
                                resource_metrics=split_resource_metrics
                            )
                            # Reset all the variables
                            batch_size = 0
                            split_data_points = []
                            split_metrics = [
                                replace(
                                    metric,
                                    data=replace(
                                        metric.data,
                                        data_points=split_data_points,
                                    ),
                                )
                            ]
                            split_scope_metrics = [
                                replace(
                                    scope_metrics,
                                    metrics=split_metrics,
                                )
                            ]
                            split_resource_metrics = [
                                replace(
                                    resource_metrics,
                                    scope_metrics=split_scope_metrics,
                                )
                            ]

                    if not split_data_points:
                        # If data_points is empty remove the whole metric
                        split_metrics.pop()

                if not split_metrics:
                    # If metrics is empty remove the whole scope_metrics
                    split_scope_metrics.pop()

            if not split_scope_metrics:
                # If scope_metrics is empty remove the whole resource_metrics
                split_resource_metrics.pop()

        if batch_size > 0:
            yield MetricsData(resource_metrics=split_resource_metrics)

    def shutdown(self, timeout_millis: float = 30_000, **kwargs) -> None:
        OTLPExporterMixin.shutdown(self, timeout_millis=timeout_millis)

    @property
    def _exporting(self) -> str:
        return "metrics"

    def force_flush(self, timeout_millis: float = 10_000) -> bool:
        """Nothing is buffered in this exporter, so this method does nothing."""
        return True
