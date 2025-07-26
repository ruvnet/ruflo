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
#
import re
import typing

from opentelemetry import trace
from opentelemetry.context.context import Context
from opentelemetry.propagators import textmap
from opentelemetry.trace import format_span_id, format_trace_id
from opentelemetry.trace.span import TraceState


class TraceContextTextMapPropagator(textmap.TextMapPropagator):
    """Extracts and injects using w3c TraceContext's headers."""

    _TRACEPARENT_HEADER_NAME = "traceparent"
    _TRACESTATE_HEADER_NAME = "tracestate"
    _TRACEPARENT_HEADER_FORMAT = (
        "^[ \t]*([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})"
        + "(-.*)?[ \t]*$"
    )
    _TRACEPARENT_HEADER_FORMAT_RE = re.compile(_TRACEPARENT_HEADER_FORMAT)

    def extract(
        self,
        carrier: textmap.CarrierT,
        context: typing.Optional[Context] = None,
        getter: textmap.Getter[textmap.CarrierT] = textmap.default_getter,
    ) -> Context:
        """Extracts SpanContext from the carrier.

        See `opentelemetry.propagators.textmap.TextMapPropagator.extract`
        """
        if context is None:
            context = Context()

        header = getter.get(carrier, self._TRACEPARENT_HEADER_NAME)

        if not header:
            return context

        match = re.search(self._TRACEPARENT_HEADER_FORMAT_RE, header[0])
        if not match:
            return context

        version: str = match.group(1)
        trace_id: str = match.group(2)
        span_id: str = match.group(3)
        trace_flags: str = match.group(4)

        if trace_id == "0" * 32 or span_id == "0" * 16:
            return context

        if version == "00":
            if match.group(5):  # type: ignore
                return context
        if version == "ff":
            return context

        tracestate_headers = getter.get(carrier, self._TRACESTATE_HEADER_NAME)
        if tracestate_headers is None:
            tracestate = None
        else:
            tracestate = TraceState.from_header(tracestate_headers)

        span_context = trace.SpanContext(
            trace_id=int(trace_id, 16),
            span_id=int(span_id, 16),
            is_remote=True,
            trace_flags=trace.TraceFlags(int(trace_flags, 16)),
            trace_state=tracestate,
        )
        return trace.set_span_in_context(
            trace.NonRecordingSpan(span_context), context
        )

    def inject(
        self,
        carrier: textmap.CarrierT,
        context: typing.Optional[Context] = None,
        setter: textmap.Setter[textmap.CarrierT] = textmap.default_setter,
    ) -> None:
        """Injects SpanContext into the carrier.

        See `opentelemetry.propagators.textmap.TextMapPropagator.inject`
        """
        span = trace.get_current_span(context)
        span_context = span.get_span_context()
        if span_context == trace.INVALID_SPAN_CONTEXT:
            return
        traceparent_string = f"00-{format_trace_id(span_context.trace_id)}-{format_span_id(span_context.span_id)}-{span_context.trace_flags:02x}"
        setter.set(carrier, self._TRACEPARENT_HEADER_NAME, traceparent_string)
        if span_context.trace_state:
            tracestate_string = span_context.trace_state.to_header()
            setter.set(
                carrier, self._TRACESTATE_HEADER_NAME, tracestate_string
            )

    @property
    def fields(self) -> typing.Set[str]:
        """Returns a set with the fields set in `inject`.

        See
        `opentelemetry.propagators.textmap.TextMapPropagator.fields`
        """
        return {self._TRACEPARENT_HEADER_NAME, self._TRACESTATE_HEADER_NAME}
