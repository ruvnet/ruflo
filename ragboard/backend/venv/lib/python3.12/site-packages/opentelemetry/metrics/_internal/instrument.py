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

# pylint: disable=too-many-ancestors


from abc import ABC, abstractmethod
from dataclasses import dataclass
from logging import getLogger
from re import compile as re_compile
from typing import (
    Callable,
    Dict,
    Generator,
    Generic,
    Iterable,
    Optional,
    Sequence,
    TypeVar,
    Union,
)

# pylint: disable=unused-import; needed for typing and sphinx
from opentelemetry import metrics
from opentelemetry.context import Context
from opentelemetry.metrics._internal.observation import Observation
from opentelemetry.util.types import (
    Attributes,
)

_logger = getLogger(__name__)

_name_regex = re_compile(r"[a-zA-Z][-_./a-zA-Z0-9]{0,254}")
_unit_regex = re_compile(r"[\x00-\x7F]{0,63}")


@dataclass(frozen=True)
class _MetricsHistogramAdvisory:
    explicit_bucket_boundaries: Optional[Sequence[float]] = None


@dataclass(frozen=True)
class CallbackOptions:
    """Options for the callback

    Args:
        timeout_millis: Timeout for the callback's execution. If the callback does asynchronous
            work (e.g. HTTP requests), it should respect this timeout.
    """

    timeout_millis: float = 10_000


InstrumentT = TypeVar("InstrumentT", bound="Instrument")
# pylint: disable=invalid-name
CallbackT = Union[
    Callable[[CallbackOptions], Iterable[Observation]],
    Generator[Iterable[Observation], CallbackOptions, None],
]


class Instrument(ABC):
    """Abstract class that serves as base for all instruments."""

    @abstractmethod
    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> None:
        pass

    @staticmethod
    def _check_name_unit_description(
        name: str, unit: str, description: str
    ) -> Dict[str, Optional[str]]:
        """
        Checks the following instrument name, unit and description for
        compliance with the spec.

        Returns a dict with keys "name", "unit" and "description", the
        corresponding values will be the checked strings or `None` if the value
        is invalid. If valid, the checked strings should be used instead of the
        original values.
        """

        result: Dict[str, Optional[str]] = {}

        if _name_regex.fullmatch(name) is not None:
            result["name"] = name
        else:
            result["name"] = None

        if unit is None:
            unit = ""
        if _unit_regex.fullmatch(unit) is not None:
            result["unit"] = unit
        else:
            result["unit"] = None

        if description is None:
            result["description"] = ""
        else:
            result["description"] = description

        return result


class _ProxyInstrument(ABC, Generic[InstrumentT]):
    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> None:
        self._name = name
        self._unit = unit
        self._description = description
        self._real_instrument: Optional[InstrumentT] = None

    def on_meter_set(self, meter: "metrics.Meter") -> None:
        """Called when a real meter is set on the creating _ProxyMeter"""

        # We don't need any locking on proxy instruments because it's OK if some
        # measurements get dropped while a real backing instrument is being
        # created.
        self._real_instrument = self._create_real_instrument(meter)

    @abstractmethod
    def _create_real_instrument(self, meter: "metrics.Meter") -> InstrumentT:
        """Create an instance of the real instrument. Implement this."""


class _ProxyAsynchronousInstrument(_ProxyInstrument[InstrumentT]):
    def __init__(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> None:
        super().__init__(name, unit, description)
        self._callbacks = callbacks


class Synchronous(Instrument):
    """Base class for all synchronous instruments"""


class Asynchronous(Instrument):
    """Base class for all asynchronous instruments"""

    @abstractmethod
    def __init__(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> None:
        super().__init__(name, unit=unit, description=description)


class Counter(Synchronous):
    """A Counter is a synchronous `Instrument` which supports non-negative increments."""

    @abstractmethod
    def add(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        pass


class NoOpCounter(Counter):
    """No-op implementation of `Counter`."""

    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> None:
        super().__init__(name, unit=unit, description=description)

    def add(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        return super().add(amount, attributes=attributes, context=context)


class _ProxyCounter(_ProxyInstrument[Counter], Counter):
    def add(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        if self._real_instrument:
            self._real_instrument.add(amount, attributes, context)

    def _create_real_instrument(self, meter: "metrics.Meter") -> Counter:
        return meter.create_counter(
            self._name,
            self._unit,
            self._description,
        )


class UpDownCounter(Synchronous):
    """An UpDownCounter is a synchronous `Instrument` which supports increments and decrements."""

    @abstractmethod
    def add(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        pass


class NoOpUpDownCounter(UpDownCounter):
    """No-op implementation of `UpDownCounter`."""

    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> None:
        super().__init__(name, unit=unit, description=description)

    def add(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        return super().add(amount, attributes=attributes, context=context)


class _ProxyUpDownCounter(_ProxyInstrument[UpDownCounter], UpDownCounter):
    def add(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        if self._real_instrument:
            self._real_instrument.add(amount, attributes, context)

    def _create_real_instrument(self, meter: "metrics.Meter") -> UpDownCounter:
        return meter.create_up_down_counter(
            self._name,
            self._unit,
            self._description,
        )


class ObservableCounter(Asynchronous):
    """An ObservableCounter is an asynchronous `Instrument` which reports monotonically
    increasing value(s) when the instrument is being observed.
    """


class NoOpObservableCounter(ObservableCounter):
    """No-op implementation of `ObservableCounter`."""

    def __init__(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> None:
        super().__init__(
            name,
            callbacks,
            unit=unit,
            description=description,
        )


class _ProxyObservableCounter(
    _ProxyAsynchronousInstrument[ObservableCounter], ObservableCounter
):
    def _create_real_instrument(
        self, meter: "metrics.Meter"
    ) -> ObservableCounter:
        return meter.create_observable_counter(
            self._name,
            self._callbacks,
            self._unit,
            self._description,
        )


class ObservableUpDownCounter(Asynchronous):
    """An ObservableUpDownCounter is an asynchronous `Instrument` which reports additive value(s) (e.g.
    the process heap size - it makes sense to report the heap size from multiple processes and sum them
    up, so we get the total heap usage) when the instrument is being observed.
    """


class NoOpObservableUpDownCounter(ObservableUpDownCounter):
    """No-op implementation of `ObservableUpDownCounter`."""

    def __init__(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> None:
        super().__init__(
            name,
            callbacks,
            unit=unit,
            description=description,
        )


class _ProxyObservableUpDownCounter(
    _ProxyAsynchronousInstrument[ObservableUpDownCounter],
    ObservableUpDownCounter,
):
    def _create_real_instrument(
        self, meter: "metrics.Meter"
    ) -> ObservableUpDownCounter:
        return meter.create_observable_up_down_counter(
            self._name,
            self._callbacks,
            self._unit,
            self._description,
        )


class Histogram(Synchronous):
    """Histogram is a synchronous `Instrument` which can be used to report arbitrary values
    that are likely to be statistically meaningful. It is intended for statistics such as
    histograms, summaries, and percentile.
    """

    @abstractmethod
    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
        explicit_bucket_boundaries_advisory: Optional[Sequence[float]] = None,
    ) -> None:
        pass

    @abstractmethod
    def record(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        pass


class NoOpHistogram(Histogram):
    """No-op implementation of `Histogram`."""

    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
        explicit_bucket_boundaries_advisory: Optional[Sequence[float]] = None,
    ) -> None:
        super().__init__(
            name,
            unit=unit,
            description=description,
            explicit_bucket_boundaries_advisory=explicit_bucket_boundaries_advisory,
        )

    def record(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        return super().record(amount, attributes=attributes, context=context)


class _ProxyHistogram(_ProxyInstrument[Histogram], Histogram):
    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
        explicit_bucket_boundaries_advisory: Optional[Sequence[float]] = None,
    ) -> None:
        super().__init__(name, unit=unit, description=description)
        self._explicit_bucket_boundaries_advisory = (
            explicit_bucket_boundaries_advisory
        )

    def record(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        if self._real_instrument:
            self._real_instrument.record(amount, attributes, context)

    def _create_real_instrument(self, meter: "metrics.Meter") -> Histogram:
        return meter.create_histogram(
            self._name,
            self._unit,
            self._description,
            explicit_bucket_boundaries_advisory=self._explicit_bucket_boundaries_advisory,
        )


class ObservableGauge(Asynchronous):
    """Asynchronous Gauge is an asynchronous `Instrument` which reports non-additive value(s) (e.g.
    the room temperature - it makes no sense to report the temperature value from multiple rooms
    and sum them up) when the instrument is being observed.
    """


class NoOpObservableGauge(ObservableGauge):
    """No-op implementation of `ObservableGauge`."""

    def __init__(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> None:
        super().__init__(
            name,
            callbacks,
            unit=unit,
            description=description,
        )


class _ProxyObservableGauge(
    _ProxyAsynchronousInstrument[ObservableGauge],
    ObservableGauge,
):
    def _create_real_instrument(
        self, meter: "metrics.Meter"
    ) -> ObservableGauge:
        return meter.create_observable_gauge(
            self._name,
            self._callbacks,
            self._unit,
            self._description,
        )


class Gauge(Synchronous):
    """A Gauge is a synchronous `Instrument` which can be used to record non-additive values as they occur."""

    @abstractmethod
    def set(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        pass


class NoOpGauge(Gauge):
    """No-op implementation of ``Gauge``."""

    def __init__(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> None:
        super().__init__(name, unit=unit, description=description)

    def set(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        return super().set(amount, attributes=attributes, context=context)


class _ProxyGauge(
    _ProxyInstrument[Gauge],
    Gauge,
):
    def set(
        self,
        amount: Union[int, float],
        attributes: Optional[Attributes] = None,
        context: Optional[Context] = None,
    ) -> None:
        if self._real_instrument:
            self._real_instrument.set(amount, attributes, context)

    def _create_real_instrument(self, meter: "metrics.Meter") -> Gauge:
        return meter.create_gauge(
            self._name,
            self._unit,
            self._description,
        )
