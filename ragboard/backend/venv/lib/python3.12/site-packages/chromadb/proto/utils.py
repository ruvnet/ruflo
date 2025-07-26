from typing import Optional, Set
import grpc
from tenacity import retry, stop_after_attempt, wait_exponential_jitter, retry_if_result
from opentelemetry.trace import Span


class RetryOnRpcErrorClientInterceptor(
    grpc.UnaryUnaryClientInterceptor, grpc.UnaryStreamClientInterceptor
):
    """
    A gRPC client interceptor that retries RPCs on specific status codes. By default, it retries on UNAVAILABLE and UNKNOWN status codes.

    This interceptor should be placed after the OpenTelemetry interceptor in the interceptor list.
    """

    max_attempts: int
    retryable_status_codes: Set[grpc.StatusCode]

    def __init__(
        self,
        max_attempts: int = 5,
        retryable_status_codes: Set[grpc.StatusCode] = set(
            [grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.UNKNOWN]
        ),
    ) -> None:
        self.max_attempts = max_attempts
        self.retryable_status_codes = retryable_status_codes

    def _intercept_call(self, continuation, client_call_details, request_or_iterator):
        sleep_span: Optional[Span] = None

        def before_sleep(_):
            from chromadb.telemetry.opentelemetry import tracer

            nonlocal sleep_span
            if tracer is not None:
                sleep_span = tracer.start_span("Waiting to retry RPC")

        @retry(
            wait=wait_exponential_jitter(0.1, jitter=0.1),
            stop=stop_after_attempt(self.max_attempts),
            retry=retry_if_result(lambda x: x.code() in self.retryable_status_codes),
            before_sleep=before_sleep,
        )
        def wrapped(*args, **kwargs):
            nonlocal sleep_span
            if sleep_span is not None:
                sleep_span.end()
                sleep_span = None
            return continuation(*args, **kwargs)

        return wrapped(client_call_details, request_or_iterator)

    def intercept_unary_unary(self, continuation, client_call_details, request):
        return self._intercept_call(continuation, client_call_details, request)

    def intercept_unary_stream(self, continuation, client_call_details, request):
        return self._intercept_call(continuation, client_call_details, request)

    def intercept_stream_unary(
        self, continuation, client_call_details, request_iterator
    ):
        return self._intercept_call(continuation, client_call_details, request_iterator)

    def intercept_stream_stream(
        self, continuation, client_call_details, request_iterator
    ):
        return self._intercept_call(continuation, client_call_details, request_iterator)
