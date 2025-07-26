import sys

from chromadb.proto.utils import RetryOnRpcErrorClientInterceptor
import grpc
import time
from chromadb.ingest import (
    Producer,
    Consumer,
    ConsumerCallbackFn,
)
from chromadb.proto.convert import to_proto_submit
from chromadb.proto.logservice_pb2 import PushLogsRequest, PullLogsRequest, LogRecord
from chromadb.proto.logservice_pb2_grpc import LogServiceStub
from chromadb.telemetry.opentelemetry.grpc import OtelInterceptor
from chromadb.types import (
    OperationRecord,
    SeqId,
)
from chromadb.config import System
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryClient,
    OpenTelemetryGranularity,
    add_attributes_to_current_span,
    trace_method,
)
from overrides import override
from typing import Sequence, Optional, cast
from uuid import UUID
import logging

logger = logging.getLogger(__name__)


class LogService(Producer, Consumer):
    """
    Distributed Chroma Log Service
    """

    _log_service_stub: LogServiceStub
    _request_timeout_seconds: int
    _channel: grpc.Channel
    _log_service_url: str
    _log_service_port: int

    def __init__(self, system: System):
        self._log_service_url = system.settings.require("chroma_logservice_host")
        self._log_service_port = system.settings.require("chroma_logservice_port")
        self._request_timeout_seconds = system.settings.require(
            "chroma_logservice_request_timeout_seconds"
        )
        self._opentelemetry_client = system.require(OpenTelemetryClient)
        super().__init__(system)

    @trace_method("LogService.start", OpenTelemetryGranularity.ALL)
    @override
    def start(self) -> None:
        self._channel = grpc.insecure_channel(
            f"{self._log_service_url}:{self._log_service_port}",
        )
        interceptors = [OtelInterceptor(), RetryOnRpcErrorClientInterceptor()]
        self._channel = grpc.intercept_channel(self._channel, *interceptors)
        self._log_service_stub = LogServiceStub(self._channel)  # type: ignore
        super().start()

    @trace_method("LogService.stop", OpenTelemetryGranularity.ALL)
    @override
    def stop(self) -> None:
        self._channel.close()
        super().stop()

    @trace_method("LogService.reset_state", OpenTelemetryGranularity.ALL)
    @override
    def reset_state(self) -> None:
        super().reset_state()

    @trace_method("LogService.delete_log", OpenTelemetryGranularity.ALL)
    @override
    def delete_log(self, collection_id: UUID) -> None:
        raise NotImplementedError("Not implemented")

    @trace_method("LogService.purge_log", OpenTelemetryGranularity.ALL)
    @override
    def purge_log(self, collection_id: UUID) -> None:
        raise NotImplementedError("Not implemented")

    @trace_method("LogService.submit_embedding", OpenTelemetryGranularity.ALL)
    @override
    def submit_embedding(
        self, collection_id: UUID, embedding: OperationRecord
    ) -> SeqId:
        if not self._running:
            raise RuntimeError("Component not running")

        return self.submit_embeddings(collection_id, [embedding])[0]

    @trace_method("LogService.submit_embeddings", OpenTelemetryGranularity.ALL)
    @override
    def submit_embeddings(
        self, collection_id: UUID, embeddings: Sequence[OperationRecord]
    ) -> Sequence[SeqId]:
        logger.info(
            f"Submitting {len(embeddings)} embeddings to log for collection {collection_id}"
        )

        add_attributes_to_current_span(
            {
                "records_count": len(embeddings),
            }
        )

        if not self._running:
            raise RuntimeError("Component not running")

        if len(embeddings) == 0:
            return []

        # push records to the log service
        counts = []
        protos_to_submit = [to_proto_submit(record) for record in embeddings]
        counts.append(
            self.push_logs(
                collection_id,
                cast(Sequence[OperationRecord], protos_to_submit),
            )
        )

        # This returns counts, which is completely incorrect
        # TODO: Fix this
        return counts

    @trace_method("LogService.subscribe", OpenTelemetryGranularity.ALL)
    @override
    def subscribe(
        self,
        collection_id: UUID,
        consume_fn: ConsumerCallbackFn,
        start: Optional[SeqId] = None,
        end: Optional[SeqId] = None,
        id: Optional[UUID] = None,
    ) -> UUID:
        logger.info(f"Subscribing to log for {collection_id}, noop for logservice")
        return UUID(int=0)

    @trace_method("LogService.unsubscribe", OpenTelemetryGranularity.ALL)
    @override
    def unsubscribe(self, subscription_id: UUID) -> None:
        logger.info(f"Unsubscribing from {subscription_id}, noop for logservice")

    @override
    def min_seqid(self) -> SeqId:
        return 0

    @override
    def max_seqid(self) -> SeqId:
        return sys.maxsize

    @property
    @override
    def max_batch_size(self) -> int:
        return 100

    def push_logs(self, collection_id: UUID, records: Sequence[OperationRecord]) -> int:
        request = PushLogsRequest(collection_id=str(collection_id), records=records)
        response = self._log_service_stub.PushLogs(
            request, timeout=self._request_timeout_seconds
        )
        return response.record_count  # type: ignore

    def pull_logs(
        self, collection_id: UUID, start_offset: int, batch_size: int
    ) -> Sequence[LogRecord]:
        request = PullLogsRequest(
            collection_id=str(collection_id),
            start_from_offset=start_offset,
            batch_size=batch_size,
            end_timestamp=time.time_ns(),
        )
        response = self._log_service_stub.PullLogs(
            request, timeout=self._request_timeout_seconds
        )
        return response.records  # type: ignore
