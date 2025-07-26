import asyncio
import os
from functools import wraps
from enum import Enum
from typing import Any, Callable, Dict, Optional, Sequence, Union, TypeVar

from opentelemetry import trace
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
)
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

from chromadb.config import Component
from chromadb.config import System


class OpenTelemetryGranularity(Enum):
    """The granularity of the OpenTelemetry spans."""

    NONE = "none"
    """No spans are emitted."""

    OPERATION = "operation"
    """Spans are emitted for each operation."""

    OPERATION_AND_SEGMENT = "operation_and_segment"
    """Spans are emitted for each operation and segment."""

    ALL = "all"
    """Spans are emitted for almost every method call."""

    # Greater is more restrictive. So "all" < "operation" (and everything else),
    # "none" > everything.
    def __lt__(self, other: Any) -> bool:
        """Compare two granularities."""
        order = [
            OpenTelemetryGranularity.ALL,
            OpenTelemetryGranularity.OPERATION_AND_SEGMENT,
            OpenTelemetryGranularity.OPERATION,
            OpenTelemetryGranularity.NONE,
        ]
        return order.index(self) < order.index(other)


class OpenTelemetryClient(Component):
    def __init__(self, system: System):
        super().__init__(system)
        otel_init(
            system.settings.chroma_otel_service_name,
            system.settings.chroma_otel_collection_endpoint,
            system.settings.chroma_otel_collection_headers,
            OpenTelemetryGranularity(
                system.settings.chroma_otel_granularity
                if system.settings.chroma_otel_granularity
                else "none"
            ),
        )


tracer: Optional[trace.Tracer] = None
granularity: OpenTelemetryGranularity = OpenTelemetryGranularity("none")


def otel_init(
    otel_service_name: Optional[str],
    otel_collection_endpoint: Optional[str],
    otel_collection_headers: Optional[Dict[str, str]],
    otel_granularity: OpenTelemetryGranularity,
) -> None:
    """Initializes module-level state for OpenTelemetry.

    Parameters match the environment variables which configure OTel as documented
    at https://docs.trychroma.com/deployment/observability.
    - otel_service_name: The name of the service for OTel tagging and aggregation.
    - otel_collection_endpoint: The endpoint to which OTel spans are sent
        (e.g. api.honeycomb.com).
    - otel_collection_headers: The headers to send with OTel spans
        (e.g. {"x-honeycomb-team": "abc123"}).
    - otel_granularity: The granularity of the spans to emit.
    """
    if otel_granularity == OpenTelemetryGranularity.NONE:
        return
    resource = Resource(attributes={SERVICE_NAME: str(otel_service_name)})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(
            # TODO: we may eventually want to make this configurable.
            OTLPSpanExporter(
                endpoint=str(otel_collection_endpoint),
                headers=otel_collection_headers,
            )
        )
    )
    trace.set_tracer_provider(provider)

    global tracer, granularity
    tracer = trace.get_tracer(__name__)
    granularity = otel_granularity


T = TypeVar("T", bound=Callable)  # type: ignore[type-arg]


def trace_method(
    trace_name: str,
    trace_granularity: OpenTelemetryGranularity,
    attributes: Optional[
        Dict[
            str,
            Union[
                str,
                bool,
                float,
                int,
                Sequence[str],
                Sequence[bool],
                Sequence[float],
                Sequence[int],
            ],
        ]
    ] = None,
) -> Callable[[T], T]:
    """A decorator that traces a method."""

    def decorator(f: T) -> T:
        if asyncio.iscoroutinefunction(f):

            @wraps(f)
            async def async_wrapper(*args, **kwargs):  # type: ignore[no-untyped-def]
                global tracer, granularity
                if trace_granularity < granularity:
                    return await f(*args, **kwargs)
                if not tracer:
                    return await f(*args, **kwargs)
                with tracer.start_as_current_span(trace_name, attributes=attributes):
                    add_attributes_to_current_span(
                        {"pod_name": os.environ.get("HOSTNAME")}
                    )
                    return await f(*args, **kwargs)

            return async_wrapper  # type: ignore
        else:

            @wraps(f)
            def wrapper(*args, **kwargs):  # type: ignore[no-untyped-def]
                global tracer, granularity
                if trace_granularity < granularity:
                    return f(*args, **kwargs)
                if not tracer:
                    return f(*args, **kwargs)
                with tracer.start_as_current_span(trace_name, attributes=attributes):
                    add_attributes_to_current_span(
                        {"pod_name": os.environ.get("HOSTNAME")}
                    )
                    return f(*args, **kwargs)

            return wrapper  # type: ignore

    return decorator


def add_attributes_to_current_span(
    attributes: Dict[
        str,
        Union[
            str,
            bool,
            float,
            int,
            Sequence[str],
            Sequence[bool],
            Sequence[float],
            Sequence[int],
            None,
        ],
    ]
) -> None:
    """Add attributes to the current span."""
    global tracer, granularity
    if granularity == OpenTelemetryGranularity.NONE:
        return
    if not tracer:
        return
    span = trace.get_current_span()
    span.set_attributes({k: v for k, v in attributes.items() if v is not None})
