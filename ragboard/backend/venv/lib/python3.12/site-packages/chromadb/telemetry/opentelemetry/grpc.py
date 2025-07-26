import binascii
import collections

import grpc
from opentelemetry.trace import StatusCode, SpanKind


class _ClientCallDetails(
    collections.namedtuple(
        "_ClientCallDetails", ("method", "timeout", "metadata", "credentials")
    ),
    grpc.ClientCallDetails,
):
    pass


def _encode_span_id(span_id: int) -> str:
    return binascii.hexlify(span_id.to_bytes(8, "big")).decode()


def _encode_trace_id(trace_id: int) -> str:
    return binascii.hexlify(trace_id.to_bytes(16, "big")).decode()


# Using OtelInterceptor with gRPC:
# 1. Instantiate the interceptor: interceptors = [OtelInterceptor()]
# 2. Intercept the channel: channel = grpc.intercept_channel(channel, *interceptors)


class OtelInterceptor(
    grpc.UnaryUnaryClientInterceptor,
    grpc.UnaryStreamClientInterceptor,
    grpc.StreamUnaryClientInterceptor,
    grpc.StreamStreamClientInterceptor,
):
    def _intercept_call(self, continuation, client_call_details, request_or_iterator):
        from chromadb.telemetry.opentelemetry import tracer

        if tracer is None:
            return continuation(client_call_details, request_or_iterator)
        with tracer.start_as_current_span(
            f"RPC {client_call_details.method}", kind=SpanKind.CLIENT
        ) as span:
            # Prepare metadata for propagation
            metadata = (
                client_call_details.metadata[:] if client_call_details.metadata else []
            )
            metadata.extend(
                [
                    (
                        "chroma-traceid",
                        _encode_trace_id(span.get_span_context().trace_id),
                    ),
                    ("chroma-spanid", _encode_span_id(span.get_span_context().span_id)),
                ]
            )
            # Update client call details with new metadata
            new_client_details = _ClientCallDetails(
                client_call_details.method,
                client_call_details.timeout,
                tuple(metadata),  # Ensure metadata is a tuple
                client_call_details.credentials,
            )
            try:
                result = continuation(new_client_details, request_or_iterator)
                # Set attributes based on the result
                if hasattr(result, "details") and result.details():
                    span.set_attribute("rpc.detail", result.details())
                span.set_attribute("rpc.status_code", result.code().name.lower())
                span.set_attribute("rpc.status_code_value", result.code().value[0])
                # Set span status based on gRPC call result
                if result.code() != grpc.StatusCode.OK:
                    span.set_status(StatusCode.ERROR, description=str(result.code()))
                return result
            except Exception as e:
                # Log exception details and re-raise
                span.set_attribute("rpc.error", str(e))
                span.set_status(StatusCode.ERROR, description=str(e))
                raise

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
