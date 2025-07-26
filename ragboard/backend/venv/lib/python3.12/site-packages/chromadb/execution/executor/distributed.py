import threading
import random
from typing import Callable, Dict, List, Optional, TypeVar
import grpc
from overrides import overrides
from chromadb.api.types import GetResult, Metadata, QueryResult
from chromadb.config import System
from chromadb.execution.executor.abstract import Executor
from chromadb.execution.expression.operator import Scan
from chromadb.execution.expression.plan import CountPlan, GetPlan, KNNPlan
from chromadb.proto import convert
from chromadb.proto.query_executor_pb2_grpc import QueryExecutorStub
from chromadb.segment.impl.manager.distributed import DistributedSegmentManager
from chromadb.telemetry.opentelemetry.grpc import OtelInterceptor
from tenacity import (
    RetryCallState,
    Retrying,
    stop_after_attempt,
    wait_exponential_jitter,
    retry_if_exception,
)
from opentelemetry.trace import Span


def _clean_metadata(metadata: Optional[Metadata]) -> Optional[Metadata]:
    """Remove any chroma-specific metadata keys that the client shouldn't see from a metadata map."""
    if not metadata:
        return None
    result = {}
    for k, v in metadata.items():
        if not k.startswith("chroma:"):
            result[k] = v
    if len(result) == 0:
        return None
    return result


def _uri(metadata: Optional[Metadata]) -> Optional[str]:
    """Retrieve the uri (if any) from a Metadata map"""

    if metadata and "chroma:uri" in metadata:
        return str(metadata["chroma:uri"])
    return None


# Type variables for input and output types of the round-robin retry function
I = TypeVar("I")  # noqa: E741
O = TypeVar("O")  # noqa: E741


class DistributedExecutor(Executor):
    _mtx: threading.Lock
    _grpc_stub_pool: Dict[str, QueryExecutorStub]
    _manager: DistributedSegmentManager
    _request_timeout_seconds: int
    _query_replication_factor: int

    def __init__(self, system: System):
        super().__init__(system)
        self._mtx = threading.Lock()
        self._grpc_stub_pool = {}
        self._manager = self.require(DistributedSegmentManager)
        self._request_timeout_seconds = system.settings.require(
            "chroma_query_request_timeout_seconds"
        )
        self._query_replication_factor = system.settings.require(
            "chroma_query_replication_factor"
        )

    def _round_robin_retry(self, funcs: List[Callable[[I], O]], args: I) -> O:
        """
        Retry a list of functions in a round-robin fashion until one of them succeeds.

        funcs: List of functions to retry
        args: Arguments to pass to each function

        """
        attempt_count = 0
        sleep_span: Optional[Span] = None

        def before_sleep(_: RetryCallState) -> None:
            # HACK(hammadb) 1/14/2024 - this is a hack to avoid the fact that tracer is not yet available and there are boot order issues
            # This should really use our component system to get the tracer. Since our grpc utils use this pattern
            # we are copying it here. This should be removed once we have a better way to get the tracer
            from chromadb.telemetry.opentelemetry import tracer

            nonlocal sleep_span
            if tracer is not None:
                sleep_span = tracer.start_span("Waiting to retry RPC")

        for attempt in Retrying(
            stop=stop_after_attempt(5),
            wait=wait_exponential_jitter(0.1, jitter=0.1),
            reraise=True,
            retry=retry_if_exception(
                lambda x: isinstance(x, grpc.RpcError)
                and x.code() in [grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.UNKNOWN]
            ),
            before_sleep=before_sleep,
        ):
            if sleep_span is not None:
                sleep_span.end()
                sleep_span = None

            with attempt:
                return funcs[attempt_count % len(funcs)](args)
            attempt_count += 1

        # NOTE(hammadb) because Retrying() will always either return or raise an exception, this line should never be reached
        raise Exception("Unreachable code error - should never reach here")

    @overrides
    def count(self, plan: CountPlan) -> int:
        endpoints = self._get_grpc_endpoints(plan.scan)
        count_funcs = [self._get_stub(endpoint).Count for endpoint in endpoints]
        count_result = self._round_robin_retry(
            count_funcs, convert.to_proto_count_plan(plan)
        )
        return convert.from_proto_count_result(count_result)

    @overrides
    def get(self, plan: GetPlan) -> GetResult:
        endpoints = self._get_grpc_endpoints(plan.scan)
        get_funcs = [self._get_stub(endpoint).Get for endpoint in endpoints]
        get_result = self._round_robin_retry(get_funcs, convert.to_proto_get_plan(plan))
        records = convert.from_proto_get_result(get_result)

        ids = [record["id"] for record in records]
        embeddings = (
            [record["embedding"] for record in records]
            if plan.projection.embedding
            else None
        )
        documents = (
            [record["document"] for record in records]
            if plan.projection.document
            else None
        )
        uris = (
            [_uri(record["metadata"]) for record in records]
            if plan.projection.uri
            else None
        )
        metadatas = (
            [_clean_metadata(record["metadata"]) for record in records]
            if plan.projection.metadata
            else None
        )

        # TODO: Fix typing
        return GetResult(
            ids=ids,
            embeddings=embeddings,  # type: ignore[typeddict-item]
            documents=documents,  # type: ignore[typeddict-item]
            uris=uris,  # type: ignore[typeddict-item]
            data=None,
            metadatas=metadatas,  # type: ignore[typeddict-item]
            included=plan.projection.included,
        )

    @overrides
    def knn(self, plan: KNNPlan) -> QueryResult:
        endpoints = self._get_grpc_endpoints(plan.scan)
        knn_funcs = [self._get_stub(endpoint).KNN for endpoint in endpoints]
        knn_result = self._round_robin_retry(knn_funcs, convert.to_proto_knn_plan(plan))
        results = convert.from_proto_knn_batch_result(knn_result)

        ids = [[record["record"]["id"] for record in records] for records in results]
        embeddings = (
            [
                [record["record"]["embedding"] for record in records]
                for records in results
            ]
            if plan.projection.embedding
            else None
        )
        documents = (
            [
                [record["record"]["document"] for record in records]
                for records in results
            ]
            if plan.projection.document
            else None
        )
        uris = (
            [
                [_uri(record["record"]["metadata"]) for record in records]
                for records in results
            ]
            if plan.projection.uri
            else None
        )
        metadatas = (
            [
                [_clean_metadata(record["record"]["metadata"]) for record in records]
                for records in results
            ]
            if plan.projection.metadata
            else None
        )
        distances = (
            [[record["distance"] for record in records] for records in results]
            if plan.projection.rank
            else None
        )

        # TODO: Fix typing
        return QueryResult(
            ids=ids,
            embeddings=embeddings,  # type: ignore[typeddict-item]
            documents=documents,  # type: ignore[typeddict-item]
            uris=uris,  # type: ignore[typeddict-item]
            data=None,
            metadatas=metadatas,  # type: ignore[typeddict-item]
            distances=distances,  # type: ignore[typeddict-item]
            included=plan.projection.included,
        )

    def _get_grpc_endpoints(self, scan: Scan) -> List[str]:
        # Since grpc endpoint is endpoint is determined by collection uuid,
        # the endpoint should be the same for all segments of the same collection
        grpc_urls = self._manager.get_endpoints(
            scan.record, self._query_replication_factor
        )
        # Shuffle the grpc urls to distribute the load evenly
        random.shuffle(grpc_urls)
        return grpc_urls

    def _get_stub(self, grpc_url: str) -> QueryExecutorStub:
        with self._mtx:
            if grpc_url not in self._grpc_stub_pool:
                channel = grpc.insecure_channel(
                    grpc_url,
                    options=[
                        ("grpc.max_concurrent_streams", 1000),
                        ("grpc.max_receive_message_length", 32000000),  # 32 MB
                    ],
                )
                interceptors = [OtelInterceptor()]
                channel = grpc.intercept_channel(channel, *interceptors)
                self._grpc_stub_pool[grpc_url] = QueryExecutorStub(channel)
            return self._grpc_stub_pool[grpc_url]
