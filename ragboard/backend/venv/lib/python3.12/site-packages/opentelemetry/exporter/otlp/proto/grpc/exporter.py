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

"""OTLP Exporter"""

import random
import threading
from abc import ABC, abstractmethod
from collections.abc import Sequence  # noqa: F401
from logging import getLogger
from os import environ
from time import sleep, time
from typing import (  # noqa: F401
    Any,
    Callable,
    Dict,
    Generic,
    List,
    Optional,
    Tuple,
    TypeVar,
    Union,
)
from typing import Sequence as TypingSequence
from urllib.parse import urlparse

from google.rpc.error_details_pb2 import RetryInfo
from typing_extensions import deprecated

from grpc import (
    ChannelCredentials,
    Compression,
    RpcError,
    StatusCode,
    insecure_channel,
    secure_channel,
    ssl_channel_credentials,
)
from opentelemetry.exporter.otlp.proto.common._internal import (
    _get_resource_data,
)
from opentelemetry.exporter.otlp.proto.grpc import (
    _OTLP_GRPC_CHANNEL_OPTIONS,
)
from opentelemetry.proto.common.v1.common_pb2 import (  # noqa: F401
    AnyValue,
    ArrayValue,
    KeyValue,
)
from opentelemetry.proto.resource.v1.resource_pb2 import Resource  # noqa: F401
from opentelemetry.sdk.environment_variables import (
    OTEL_EXPORTER_OTLP_CERTIFICATE,
    OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE,
    OTEL_EXPORTER_OTLP_CLIENT_KEY,
    OTEL_EXPORTER_OTLP_COMPRESSION,
    OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_HEADERS,
    OTEL_EXPORTER_OTLP_INSECURE,
    OTEL_EXPORTER_OTLP_TIMEOUT,
)
from opentelemetry.sdk.metrics.export import MetricsData
from opentelemetry.sdk.resources import Resource as SDKResource
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.util.re import parse_env_headers

_RETRYABLE_ERROR_CODES = frozenset(
    [
        StatusCode.CANCELLED,
        StatusCode.DEADLINE_EXCEEDED,
        StatusCode.RESOURCE_EXHAUSTED,
        StatusCode.ABORTED,
        StatusCode.OUT_OF_RANGE,
        StatusCode.UNAVAILABLE,
        StatusCode.DATA_LOSS,
    ]
)
_MAX_RETRYS = 6
logger = getLogger(__name__)
SDKDataT = TypeVar("SDKDataT")
ResourceDataT = TypeVar("ResourceDataT")
TypingResourceT = TypeVar("TypingResourceT")
ExportServiceRequestT = TypeVar("ExportServiceRequestT")
ExportResultT = TypeVar("ExportResultT")

_ENVIRON_TO_COMPRESSION = {
    None: None,
    "gzip": Compression.Gzip,
}


class InvalidCompressionValueException(Exception):
    def __init__(self, environ_key: str, environ_value: str):
        super().__init__(
            'Invalid value "{}" for compression envvar {}'.format(
                environ_value, environ_key
            )
        )


def environ_to_compression(environ_key: str) -> Optional[Compression]:
    environ_value = (
        environ[environ_key].lower().strip()
        if environ_key in environ
        else None
    )
    if environ_value not in _ENVIRON_TO_COMPRESSION:
        raise InvalidCompressionValueException(environ_key, environ_value)
    return _ENVIRON_TO_COMPRESSION[environ_value]


@deprecated(
    "Use one of the encoders from opentelemetry-exporter-otlp-proto-common instead. Deprecated since version 1.18.0.",
)
def get_resource_data(
    sdk_resource_scope_data: Dict[SDKResource, ResourceDataT],
    resource_class: Callable[..., TypingResourceT],
    name: str,
) -> List[TypingResourceT]:
    return _get_resource_data(sdk_resource_scope_data, resource_class, name)


def _read_file(file_path: str) -> Optional[bytes]:
    try:
        with open(file_path, "rb") as file:
            return file.read()
    except FileNotFoundError as e:
        logger.exception(
            "Failed to read file: %s. Please check if the file exists and is accessible.",
            e.filename,
        )
        return None


def _load_credentials(
    certificate_file: Optional[str],
    client_key_file: Optional[str],
    client_certificate_file: Optional[str],
) -> Optional[ChannelCredentials]:
    root_certificates = (
        _read_file(certificate_file) if certificate_file else None
    )
    private_key = _read_file(client_key_file) if client_key_file else None
    certificate_chain = (
        _read_file(client_certificate_file)
        if client_certificate_file
        else None
    )

    return ssl_channel_credentials(
        root_certificates=root_certificates,
        private_key=private_key,
        certificate_chain=certificate_chain,
    )


def _get_credentials(
    creds: Optional[ChannelCredentials],
    certificate_file_env_key: str,
    client_key_file_env_key: str,
    client_certificate_file_env_key: str,
) -> ChannelCredentials:
    if creds is not None:
        return creds

    certificate_file = environ.get(certificate_file_env_key)
    if certificate_file:
        client_key_file = environ.get(client_key_file_env_key)
        client_certificate_file = environ.get(client_certificate_file_env_key)
        return _load_credentials(
            certificate_file, client_key_file, client_certificate_file
        )
    return ssl_channel_credentials()


# pylint: disable=no-member
class OTLPExporterMixin(
    ABC, Generic[SDKDataT, ExportServiceRequestT, ExportResultT]
):
    """OTLP span exporter

    Args:
        endpoint: OpenTelemetry Collector receiver endpoint
        insecure: Connection type
        credentials: ChannelCredentials object for server authentication
        headers: Headers to send when exporting
        timeout: Backend request timeout in seconds
        compression: gRPC compression method to use
        channel_options: gRPC channel options
    """

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
        super().__init__()

        self._endpoint = endpoint or environ.get(
            OTEL_EXPORTER_OTLP_ENDPOINT, "http://localhost:4317"
        )

        parsed_url = urlparse(self._endpoint)

        if parsed_url.scheme == "https":
            insecure = False
        if insecure is None:
            insecure = environ.get(OTEL_EXPORTER_OTLP_INSECURE)
            if insecure is not None:
                insecure = insecure.lower() == "true"
            else:
                if parsed_url.scheme == "http":
                    insecure = True
                else:
                    insecure = False

        if parsed_url.netloc:
            self._endpoint = parsed_url.netloc

        self._headers = headers or environ.get(OTEL_EXPORTER_OTLP_HEADERS)
        if isinstance(self._headers, str):
            temp_headers = parse_env_headers(self._headers, liberal=True)
            self._headers = tuple(temp_headers.items())
        elif isinstance(self._headers, dict):
            self._headers = tuple(self._headers.items())
        if self._headers is None:
            self._headers = tuple()

        if channel_options:
            # merge the default channel options with the one passed as parameter
            overridden_options = {
                opt_name for (opt_name, _) in channel_options
            }
            default_options = [
                (opt_name, opt_value)
                for opt_name, opt_value in _OTLP_GRPC_CHANNEL_OPTIONS
                if opt_name not in overridden_options
            ]
            self._channel_options = tuple(default_options) + channel_options
        else:
            self._channel_options = tuple(_OTLP_GRPC_CHANNEL_OPTIONS)

        self._timeout = timeout or float(
            environ.get(OTEL_EXPORTER_OTLP_TIMEOUT, 10)
        )
        self._collector_kwargs = None

        compression = (
            environ_to_compression(OTEL_EXPORTER_OTLP_COMPRESSION)
            if compression is None
            else compression
        ) or Compression.NoCompression

        if insecure:
            self._channel = insecure_channel(
                self._endpoint,
                compression=compression,
                options=self._channel_options,
            )
        else:
            credentials = _get_credentials(
                credentials,
                OTEL_EXPORTER_OTLP_CERTIFICATE,
                OTEL_EXPORTER_OTLP_CLIENT_KEY,
                OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE,
            )
            self._channel = secure_channel(
                self._endpoint,
                credentials,
                compression=compression,
                options=self._channel_options,
            )
        self._client = self._stub(self._channel)

        self._export_lock = threading.Lock()
        self._shutdown = False

    @abstractmethod
    def _translate_data(
        self, data: TypingSequence[SDKDataT]
    ) -> ExportServiceRequestT:
        pass

    def _export(
        self,
        data: Union[TypingSequence[ReadableSpan], MetricsData],
    ) -> ExportResultT:
        if self._shutdown:
            logger.warning("Exporter already shutdown, ignoring batch")
            return self._result.FAILURE

        # FIXME remove this check if the export type for traces
        # gets updated to a class that represents the proto
        # TracesData and use the code below instead.
        with self._export_lock:
            deadline_sec = time() + self._timeout
            for retry_num in range(_MAX_RETRYS):
                try:
                    self._client.Export(
                        request=self._translate_data(data),
                        metadata=self._headers,
                        timeout=deadline_sec - time(),
                    )
                    return self._result.SUCCESS
                except RpcError as error:
                    retry_info_bin = dict(error.trailing_metadata()).get(
                        "google.rpc.retryinfo-bin"
                    )
                    # multiplying by a random number between .8 and 1.2 introduces a +/20% jitter to each backoff.
                    backoff_seconds = 2**retry_num * random.uniform(0.8, 1.2)
                    if retry_info_bin is not None:
                        retry_info = RetryInfo()
                        retry_info.ParseFromString(retry_info_bin)
                        backoff_seconds = (
                            retry_info.retry_delay.seconds
                            + retry_info.retry_delay.nanos / 1.0e9
                        )
                    if (
                        error.code() not in _RETRYABLE_ERROR_CODES
                        or retry_num + 1 == _MAX_RETRYS
                        or backoff_seconds > (deadline_sec - time())
                    ):
                        logger.error(
                            "Failed to export %s to %s, error code: %s",
                            self._exporting,
                            self._endpoint,
                            error.code(),
                            exc_info=error.code() == StatusCode.UNKNOWN,
                        )
                        return self._result.FAILURE
                    logger.warning(
                        "Transient error %s encountered while exporting %s to %s, retrying in %.2fs.",
                        error.code(),
                        self._exporting,
                        self._endpoint,
                        backoff_seconds,
                    )
                    sleep(backoff_seconds)
        # Not possible to reach here but the linter is complaining.
        return self._result.FAILURE

    def shutdown(self, timeout_millis: float = 30_000, **kwargs) -> None:
        if self._shutdown:
            logger.warning("Exporter already shutdown, ignoring call")
            return
        # wait for the last export if any
        self._export_lock.acquire(timeout=timeout_millis / 1e3)
        self._shutdown = True
        self._channel.close()
        self._export_lock.release()

    @property
    @abstractmethod
    def _exporting(self) -> str:
        """
        Returns a string that describes the overall exporter, to be used in
        warning messages.
        """
        pass
