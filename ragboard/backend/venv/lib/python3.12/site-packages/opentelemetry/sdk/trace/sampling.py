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

"""
For general information about sampling, see `the specification <https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/sdk.md#sampling>`_.

OpenTelemetry provides two types of samplers:

- `StaticSampler`
- `TraceIdRatioBased`

A `StaticSampler` always returns the same sampling result regardless of the conditions. Both possible StaticSamplers are already created:

- Always sample spans: ALWAYS_ON
- Never sample spans: ALWAYS_OFF

A `TraceIdRatioBased` sampler makes a random sampling result based on the sampling probability given.

If the span being sampled has a parent, `ParentBased` will respect the parent delegate sampler. Otherwise, it returns the sampling result from the given root sampler.

Currently, sampling results are always made during the creation of the span. However, this might not always be the case in the future (see `OTEP #115 <https://github.com/open-telemetry/oteps/pull/115>`_).

Custom samplers can be created by subclassing `Sampler` and implementing `Sampler.should_sample` as well as `Sampler.get_description`.

Samplers are able to modify the `opentelemetry.trace.span.TraceState` of the parent of the span being created. For custom samplers, it is suggested to implement `Sampler.should_sample` to utilize the
parent span context's `opentelemetry.trace.span.TraceState` and pass into the `SamplingResult` instead of the explicit trace_state field passed into the parameter of `Sampler.should_sample`.

To use a sampler, pass it into the tracer provider constructor. For example:

.. code:: python

    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import (
        ConsoleSpanExporter,
        SimpleSpanProcessor,
    )
    from opentelemetry.sdk.trace.sampling import TraceIdRatioBased

    # sample 1 in every 1000 traces
    sampler = TraceIdRatioBased(1/1000)

    # set the sampler onto the global tracer provider
    trace.set_tracer_provider(TracerProvider(sampler=sampler))

    # set up an exporter for sampled spans
    trace.get_tracer_provider().add_span_processor(
        SimpleSpanProcessor(ConsoleSpanExporter())
    )

    # created spans will now be sampled by the TraceIdRatioBased sampler
    with trace.get_tracer(__name__).start_as_current_span("Test Span"):
        ...

The tracer sampler can also be configured via environment variables ``OTEL_TRACES_SAMPLER`` and ``OTEL_TRACES_SAMPLER_ARG`` (only if applicable).
The list of built-in values for ``OTEL_TRACES_SAMPLER`` are:

    * always_on - Sampler that always samples spans, regardless of the parent span's sampling decision.
    * always_off - Sampler that never samples spans, regardless of the parent span's sampling decision.
    * traceidratio - Sampler that samples probabilistically based on rate.
    * parentbased_always_on - (default) Sampler that respects its parent span's sampling decision, but otherwise always samples.
    * parentbased_always_off - Sampler that respects its parent span's sampling decision, but otherwise never samples.
    * parentbased_traceidratio - Sampler that respects its parent span's sampling decision, but otherwise samples probabilistically based on rate.

Sampling probability can be set with ``OTEL_TRACES_SAMPLER_ARG`` if the sampler is traceidratio or parentbased_traceidratio. Rate must be in the range [0.0,1.0]. When not provided rate will be set to
1.0 (maximum rate possible).

Prev example but with environment variables. Please make sure to set the env ``OTEL_TRACES_SAMPLER=traceidratio`` and ``OTEL_TRACES_SAMPLER_ARG=0.001``.

.. code:: python

    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import (
        ConsoleSpanExporter,
        SimpleSpanProcessor,
    )

    trace.set_tracer_provider(TracerProvider())

    # set up an exporter for sampled spans
    trace.get_tracer_provider().add_span_processor(
        SimpleSpanProcessor(ConsoleSpanExporter())
    )

    # created spans will now be sampled by the TraceIdRatioBased sampler with rate 1/1000.
    with trace.get_tracer(__name__).start_as_current_span("Test Span"):
        ...

When utilizing a configurator, you can configure a custom sampler. In order to create a configurable custom sampler, create an entry point for the custom sampler
factory method or function under the entry point group, ``opentelemetry_traces_sampler``. The custom sampler factory method must be of type ``Callable[[str], Sampler]``, taking a single string argument and
returning a Sampler object. The single input will come from the string value of the ``OTEL_TRACES_SAMPLER_ARG`` environment variable. If ``OTEL_TRACES_SAMPLER_ARG`` is not configured, the input will
be an empty string. For example:

.. code:: python

    setup(
        ...
        entry_points={
            ...
            "opentelemetry_traces_sampler": [
                "custom_sampler_name = path.to.sampler.factory.method:CustomSamplerFactory.get_sampler"
            ]
        }
    )
    # ...
    class CustomRatioSampler(Sampler):
        def __init__(rate):
            # ...
    # ...
    class CustomSamplerFactory:
        @staticmethod
        def get_sampler(sampler_argument):
            try:
                rate = float(sampler_argument)
                return CustomSampler(rate)
            except ValueError: # In case argument is empty string.
                return CustomSampler(0.5)

In order to configure you application with a custom sampler's entry point, set the ``OTEL_TRACES_SAMPLER`` environment variable to the key name of the entry point. For example, to configured the
above sampler, set ``OTEL_TRACES_SAMPLER=custom_sampler_name`` and ``OTEL_TRACES_SAMPLER_ARG=0.5``.
"""

import abc
import enum
import os
from logging import getLogger
from types import MappingProxyType
from typing import Optional, Sequence

# pylint: disable=unused-import
from opentelemetry.context import Context
from opentelemetry.sdk.environment_variables import (
    OTEL_TRACES_SAMPLER,
    OTEL_TRACES_SAMPLER_ARG,
)
from opentelemetry.trace import Link, SpanKind, get_current_span
from opentelemetry.trace.span import TraceState
from opentelemetry.util.types import Attributes

_logger = getLogger(__name__)


class Decision(enum.Enum):
    # IsRecording() == false, span will not be recorded and all events and attributes will be dropped.
    DROP = 0
    # IsRecording() == true, but Sampled flag MUST NOT be set.
    RECORD_ONLY = 1
    # IsRecording() == true AND Sampled flag` MUST be set.
    RECORD_AND_SAMPLE = 2

    def is_recording(self):
        return self in (Decision.RECORD_ONLY, Decision.RECORD_AND_SAMPLE)

    def is_sampled(self):
        return self is Decision.RECORD_AND_SAMPLE


class SamplingResult:
    """A sampling result as applied to a newly-created Span.

    Args:
        decision: A sampling decision based off of whether the span is recorded
            and the sampled flag in trace flags in the span context.
        attributes: Attributes to add to the `opentelemetry.trace.Span`.
        trace_state: The tracestate used for the `opentelemetry.trace.Span`.
            Could possibly have been modified by the sampler.
    """

    def __repr__(self) -> str:
        return f"{type(self).__name__}({str(self.decision)}, attributes={str(self.attributes)})"

    def __init__(
        self,
        decision: Decision,
        attributes: "Attributes" = None,
        trace_state: Optional["TraceState"] = None,
    ) -> None:
        self.decision = decision
        if attributes is None:
            self.attributes = MappingProxyType({})
        else:
            self.attributes = MappingProxyType(attributes)
        self.trace_state = trace_state


class Sampler(abc.ABC):
    @abc.abstractmethod
    def should_sample(
        self,
        parent_context: Optional["Context"],
        trace_id: int,
        name: str,
        kind: Optional[SpanKind] = None,
        attributes: Attributes = None,
        links: Optional[Sequence["Link"]] = None,
        trace_state: Optional["TraceState"] = None,
    ) -> "SamplingResult":
        pass

    @abc.abstractmethod
    def get_description(self) -> str:
        pass


class StaticSampler(Sampler):
    """Sampler that always returns the same decision."""

    def __init__(self, decision: "Decision") -> None:
        self._decision = decision

    def should_sample(
        self,
        parent_context: Optional["Context"],
        trace_id: int,
        name: str,
        kind: Optional[SpanKind] = None,
        attributes: Attributes = None,
        links: Optional[Sequence["Link"]] = None,
        trace_state: Optional["TraceState"] = None,
    ) -> "SamplingResult":
        if self._decision is Decision.DROP:
            attributes = None
        return SamplingResult(
            self._decision,
            attributes,
            _get_parent_trace_state(parent_context),
        )

    def get_description(self) -> str:
        if self._decision is Decision.DROP:
            return "AlwaysOffSampler"
        return "AlwaysOnSampler"


ALWAYS_OFF = StaticSampler(Decision.DROP)
"""Sampler that never samples spans, regardless of the parent span's sampling decision."""

ALWAYS_ON = StaticSampler(Decision.RECORD_AND_SAMPLE)
"""Sampler that always samples spans, regardless of the parent span's sampling decision."""


class TraceIdRatioBased(Sampler):
    """
    Sampler that makes sampling decisions probabilistically based on `rate`.

    Args:
        rate: Probability (between 0 and 1) that a span will be sampled
    """

    def __init__(self, rate: float):
        if rate < 0.0 or rate > 1.0:
            raise ValueError("Probability must be in range [0.0, 1.0].")
        self._rate = rate
        self._bound = self.get_bound_for_rate(self._rate)

    # For compatibility with 64 bit trace IDs, the sampler checks the 64
    # low-order bits of the trace ID to decide whether to sample a given trace.
    TRACE_ID_LIMIT = (1 << 64) - 1

    @classmethod
    def get_bound_for_rate(cls, rate: float) -> int:
        return round(rate * (cls.TRACE_ID_LIMIT + 1))

    @property
    def rate(self) -> float:
        return self._rate

    @property
    def bound(self) -> int:
        return self._bound

    def should_sample(
        self,
        parent_context: Optional["Context"],
        trace_id: int,
        name: str,
        kind: Optional[SpanKind] = None,
        attributes: Attributes = None,
        links: Optional[Sequence["Link"]] = None,
        trace_state: Optional["TraceState"] = None,
    ) -> "SamplingResult":
        decision = Decision.DROP
        if trace_id & self.TRACE_ID_LIMIT < self.bound:
            decision = Decision.RECORD_AND_SAMPLE
        if decision is Decision.DROP:
            attributes = None
        return SamplingResult(
            decision,
            attributes,
            _get_parent_trace_state(parent_context),
        )

    def get_description(self) -> str:
        return f"TraceIdRatioBased{{{self._rate}}}"


class ParentBased(Sampler):
    """
    If a parent is set, applies the respective delegate sampler.
    Otherwise, uses the root provided at initialization to make a
    decision.

    Args:
        root: Sampler called for spans with no parent (root spans).
        remote_parent_sampled: Sampler called for a remote sampled parent.
        remote_parent_not_sampled: Sampler called for a remote parent that is
            not sampled.
        local_parent_sampled: Sampler called for a local sampled parent.
        local_parent_not_sampled: Sampler called for a local parent that is
            not sampled.
    """

    def __init__(
        self,
        root: Sampler,
        remote_parent_sampled: Sampler = ALWAYS_ON,
        remote_parent_not_sampled: Sampler = ALWAYS_OFF,
        local_parent_sampled: Sampler = ALWAYS_ON,
        local_parent_not_sampled: Sampler = ALWAYS_OFF,
    ):
        self._root = root
        self._remote_parent_sampled = remote_parent_sampled
        self._remote_parent_not_sampled = remote_parent_not_sampled
        self._local_parent_sampled = local_parent_sampled
        self._local_parent_not_sampled = local_parent_not_sampled

    def should_sample(
        self,
        parent_context: Optional["Context"],
        trace_id: int,
        name: str,
        kind: Optional[SpanKind] = None,
        attributes: Attributes = None,
        links: Optional[Sequence["Link"]] = None,
        trace_state: Optional["TraceState"] = None,
    ) -> "SamplingResult":
        parent_span_context = get_current_span(
            parent_context
        ).get_span_context()
        # default to the root sampler
        sampler = self._root
        # respect the sampling and remote flag of the parent if present
        if parent_span_context is not None and parent_span_context.is_valid:
            if parent_span_context.is_remote:
                if parent_span_context.trace_flags.sampled:
                    sampler = self._remote_parent_sampled
                else:
                    sampler = self._remote_parent_not_sampled
            else:
                if parent_span_context.trace_flags.sampled:
                    sampler = self._local_parent_sampled
                else:
                    sampler = self._local_parent_not_sampled

        return sampler.should_sample(
            parent_context=parent_context,
            trace_id=trace_id,
            name=name,
            kind=kind,
            attributes=attributes,
            links=links,
        )

    def get_description(self):
        return f"ParentBased{{root:{self._root.get_description()},remoteParentSampled:{self._remote_parent_sampled.get_description()},remoteParentNotSampled:{self._remote_parent_not_sampled.get_description()},localParentSampled:{self._local_parent_sampled.get_description()},localParentNotSampled:{self._local_parent_not_sampled.get_description()}}}"


DEFAULT_OFF = ParentBased(ALWAYS_OFF)
"""Sampler that respects its parent span's sampling decision, but otherwise never samples."""

DEFAULT_ON = ParentBased(ALWAYS_ON)
"""Sampler that respects its parent span's sampling decision, but otherwise always samples."""


class ParentBasedTraceIdRatio(ParentBased):
    """
    Sampler that respects its parent span's sampling decision, but otherwise
    samples probabilistically based on `rate`.
    """

    def __init__(self, rate: float):
        root = TraceIdRatioBased(rate=rate)
        super().__init__(root=root)


class _AlwaysOff(StaticSampler):
    def __init__(self, _):
        super().__init__(Decision.DROP)


class _AlwaysOn(StaticSampler):
    def __init__(self, _):
        super().__init__(Decision.RECORD_AND_SAMPLE)


class _ParentBasedAlwaysOff(ParentBased):
    def __init__(self, _):
        super().__init__(ALWAYS_OFF)


class _ParentBasedAlwaysOn(ParentBased):
    def __init__(self, _):
        super().__init__(ALWAYS_ON)


_KNOWN_SAMPLERS = {
    "always_on": ALWAYS_ON,
    "always_off": ALWAYS_OFF,
    "parentbased_always_on": DEFAULT_ON,
    "parentbased_always_off": DEFAULT_OFF,
    "traceidratio": TraceIdRatioBased,
    "parentbased_traceidratio": ParentBasedTraceIdRatio,
}


def _get_from_env_or_default() -> Sampler:
    trace_sampler = os.getenv(
        OTEL_TRACES_SAMPLER, "parentbased_always_on"
    ).lower()
    if trace_sampler not in _KNOWN_SAMPLERS:
        _logger.warning("Couldn't recognize sampler %s.", trace_sampler)
        trace_sampler = "parentbased_always_on"

    if trace_sampler in ("traceidratio", "parentbased_traceidratio"):
        try:
            rate = float(os.getenv(OTEL_TRACES_SAMPLER_ARG))
        except (ValueError, TypeError):
            _logger.warning("Could not convert TRACES_SAMPLER_ARG to float.")
            rate = 1.0
        return _KNOWN_SAMPLERS[trace_sampler](rate)

    return _KNOWN_SAMPLERS[trace_sampler]


def _get_parent_trace_state(
    parent_context: Optional[Context],
) -> Optional["TraceState"]:
    parent_span_context = get_current_span(parent_context).get_span_context()
    if parent_span_context is None or not parent_span_context.is_valid:
        return None
    return parent_span_context.trace_state
