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

from os import environ
from typing import Dict, Optional, Sequence, Tuple, Union
from typing import Sequence as TypingSequence

from grpc import ChannelCredentials, Compression
from opentelemetry.exporter.otlp.proto.common._log_encoder import encode_logs
from opentelemetry.exporter.otlp.proto.grpc.exporter import (
    OTLPExporterMixin,
    _get_credentials,
    environ_to_compression,
)
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import (
    ExportLogsServiceRequest,
)
from opentelemetry.proto.collector.logs.v1.logs_service_pb2_grpc import (
    LogsServiceStub,
)
from opentelemetry.sdk._logs import LogData
from opentelemetry.sdk._logs import LogRecord as SDKLogRecord
from opentelemetry.sdk._logs.export import LogExporter, LogExportResult
from opentelemetry.sdk.environment_variables import (
    OTEL_EXPORTER_OTLP_LOGS_CERTIFICATE,
    OTEL_EXPORTER_OTLP_LOGS_CLIENT_CERTIFICATE,
    OTEL_EXPORTER_OTLP_LOGS_CLIENT_KEY,
    OTEL_EXPORTER_OTLP_LOGS_COMPRESSION,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    OTEL_EXPORTER_OTLP_LOGS_HEADERS,
    OTEL_EXPORTER_OTLP_LOGS_INSECURE,
    OTEL_EXPORTER_OTLP_LOGS_TIMEOUT,
)


class OTLPLogExporter(
    LogExporter,
    OTLPExporterMixin[SDKLogRecord, ExportLogsServiceRequest, LogExportResult],
):
    _result = LogExportResult
    _stub = LogsServiceStub

    def __init__(
        self,
        endpoint: Optional[str] = None,
        insecure: Optional[bool] = None,
        credentials: Optional[ChannelCredentials] = None,
        headers: Optional[
            Union[TypingSequence[Tuple[str, str]], Dict[str, str], str]
        ] = None,
        timeout: Optional[float] = None,
        compression: Optional[Compression] = None,
        channel_options: Optional[TypingSequence[Tuple[str, str]]] = None,
    ):
        if insecure is None:
            insecure = environ.get(OTEL_EXPORTER_OTLP_LOGS_INSECURE)
            if insecure is not None:
                insecure = insecure.lower() == "true"

        if (
            not insecure
            and environ.get(OTEL_EXPORTER_OTLP_LOGS_CERTIFICATE) is not None
        ):
            credentials = _get_credentials(
                credentials,
                OTEL_EXPORTER_OTLP_LOGS_CERTIFICATE,
                OTEL_EXPORTER_OTLP_LOGS_CLIENT_KEY,
                OTEL_EXPORTER_OTLP_LOGS_CLIENT_CERTIFICATE,
            )

        environ_timeout = environ.get(OTEL_EXPORTER_OTLP_LOGS_TIMEOUT)
        environ_timeout = (
            float(environ_timeout) if environ_timeout is not None else None
        )

        compression = (
            environ_to_compression(OTEL_EXPORTER_OTLP_LOGS_COMPRESSION)
            if compression is None
            else compression
        )
        endpoint = endpoint or environ.get(OTEL_EXPORTER_OTLP_LOGS_ENDPOINT)

        headers = headers or environ.get(OTEL_EXPORTER_OTLP_LOGS_HEADERS)

        super().__init__(
            **{
                "endpoint": endpoint,
                "insecure": insecure,
                "credentials": credentials,
                "headers": headers,
                "timeout": timeout or environ_timeout,
                "compression": compression,
                "channel_options": channel_options,
            }
        )

    def _translate_data(
        self, data: Sequence[LogData]
    ) -> ExportLogsServiceRequest:
        return encode_logs(data)

    def export(self, batch: Sequence[LogData]) -> LogExportResult:
        return self._export(batch)

    def shutdown(self, timeout_millis: float = 30_000, **kwargs) -> None:
        OTLPExporterMixin.shutdown(self, timeout_millis=timeout_millis)

    def force_flush(self, timeout_millis: float = 10_000) -> bool:
        """Nothing is buffered in this exporter, so this method does nothing."""
        return True

    @property
    def _exporting(self) -> str:
        return "logs"
