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

import logging
from collections import defaultdict
from typing import List, Optional, Sequence

from opentelemetry.exporter.otlp.proto.common._internal import (
    _encode_attributes,
    _encode_instrumentation_scope,
    _encode_resource,
    _encode_span_id,
    _encode_trace_id,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest as PB2ExportTraceServiceRequest,
)
from opentelemetry.proto.trace.v1.trace_pb2 import (
    ResourceSpans as PB2ResourceSpans,
)
from opentelemetry.proto.trace.v1.trace_pb2 import ScopeSpans as PB2ScopeSpans
from opentelemetry.proto.trace.v1.trace_pb2 import Span as PB2SPan
from opentelemetry.proto.trace.v1.trace_pb2 import SpanFlags as PB2SpanFlags
from opentelemetry.proto.trace.v1.trace_pb2 import Status as PB2Status
from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.trace import Link, SpanKind
from opentelemetry.trace.span import SpanContext, Status, TraceState

# pylint: disable=E1101
_SPAN_KIND_MAP = {
    SpanKind.INTERNAL: PB2SPan.SpanKind.SPAN_KIND_INTERNAL,
    SpanKind.SERVER: PB2SPan.SpanKind.SPAN_KIND_SERVER,
    SpanKind.CLIENT: PB2SPan.SpanKind.SPAN_KIND_CLIENT,
    SpanKind.PRODUCER: PB2SPan.SpanKind.SPAN_KIND_PRODUCER,
    SpanKind.CONSUMER: PB2SPan.SpanKind.SPAN_KIND_CONSUMER,
}

_logger = logging.getLogger(__name__)


def encode_spans(
    sdk_spans: Sequence[ReadableSpan],
) -> PB2ExportTraceServiceRequest:
    return PB2ExportTraceServiceRequest(
        resource_spans=_encode_resource_spans(sdk_spans)
    )


def _encode_resource_spans(
    sdk_spans: Sequence[ReadableSpan],
) -> List[PB2ResourceSpans]:
    # We need to inspect the spans and group + structure them as:
    #
    #   Resource
    #     Instrumentation Library
    #       Spans
    #
    # First loop organizes the SDK spans in this structure. Protobuf messages
    # are not hashable so we stick with SDK data in this phase.
    #
    # Second loop encodes the data into Protobuf format.
    #
    sdk_resource_spans = defaultdict(lambda: defaultdict(list))

    for sdk_span in sdk_spans:
        sdk_resource = sdk_span.resource
        sdk_instrumentation = sdk_span.instrumentation_scope or None
        pb2_span = _encode_span(sdk_span)

        sdk_resource_spans[sdk_resource][sdk_instrumentation].append(pb2_span)

    pb2_resource_spans = []

    for sdk_resource, sdk_instrumentations in sdk_resource_spans.items():
        scope_spans = []
        for sdk_instrumentation, pb2_spans in sdk_instrumentations.items():
            scope_spans.append(
                PB2ScopeSpans(
                    scope=(_encode_instrumentation_scope(sdk_instrumentation)),
                    spans=pb2_spans,
                    schema_url=sdk_instrumentation.schema_url
                    if sdk_instrumentation
                    else None,
                )
            )
        pb2_resource_spans.append(
            PB2ResourceSpans(
                resource=_encode_resource(sdk_resource),
                scope_spans=scope_spans,
                schema_url=sdk_resource.schema_url,
            )
        )

    return pb2_resource_spans


def _span_flags(parent_span_context: Optional[SpanContext]) -> int:
    flags = PB2SpanFlags.SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK
    if parent_span_context and parent_span_context.is_remote:
        flags |= PB2SpanFlags.SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK
    return flags


def _encode_span(sdk_span: ReadableSpan) -> PB2SPan:
    span_context = sdk_span.get_span_context()
    return PB2SPan(
        trace_id=_encode_trace_id(span_context.trace_id),
        span_id=_encode_span_id(span_context.span_id),
        trace_state=_encode_trace_state(span_context.trace_state),
        parent_span_id=_encode_parent_id(sdk_span.parent),
        name=sdk_span.name,
        kind=_SPAN_KIND_MAP[sdk_span.kind],
        start_time_unix_nano=sdk_span.start_time,
        end_time_unix_nano=sdk_span.end_time,
        attributes=_encode_attributes(sdk_span.attributes),
        events=_encode_events(sdk_span.events),
        links=_encode_links(sdk_span.links),
        status=_encode_status(sdk_span.status),
        dropped_attributes_count=sdk_span.dropped_attributes,
        dropped_events_count=sdk_span.dropped_events,
        dropped_links_count=sdk_span.dropped_links,
        flags=_span_flags(sdk_span.parent),
    )


def _encode_events(
    events: Sequence[Event],
) -> Optional[List[PB2SPan.Event]]:
    pb2_events = None
    if events:
        pb2_events = []
        for event in events:
            encoded_event = PB2SPan.Event(
                name=event.name,
                time_unix_nano=event.timestamp,
                attributes=_encode_attributes(event.attributes),
                dropped_attributes_count=event.dropped_attributes,
            )
            pb2_events.append(encoded_event)
    return pb2_events


def _encode_links(links: Sequence[Link]) -> Sequence[PB2SPan.Link]:
    pb2_links = None
    if links:
        pb2_links = []
        for link in links:
            encoded_link = PB2SPan.Link(
                trace_id=_encode_trace_id(link.context.trace_id),
                span_id=_encode_span_id(link.context.span_id),
                attributes=_encode_attributes(link.attributes),
                dropped_attributes_count=link.dropped_attributes,
                flags=_span_flags(link.context),
            )
            pb2_links.append(encoded_link)
    return pb2_links


def _encode_status(status: Status) -> Optional[PB2Status]:
    pb2_status = None
    if status is not None:
        pb2_status = PB2Status(
            code=status.status_code.value,
            message=status.description,
        )
    return pb2_status


def _encode_trace_state(trace_state: TraceState) -> Optional[str]:
    pb2_trace_state = None
    if trace_state is not None:
        pb2_trace_state = ",".join(
            [f"{key}={value}" for key, value in (trace_state.items())]
        )
    return pb2_trace_state


def _encode_parent_id(context: Optional[SpanContext]) -> Optional[bytes]:
    if context:
        return _encode_span_id(context.span_id)
    return None
