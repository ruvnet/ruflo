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

"""
The OpenTelemetry metrics API  describes the classes used to generate
metrics.

The :class:`.MeterProvider` provides users access to the :class:`.Meter` which in
turn is used to create :class:`.Instrument` objects. The :class:`.Instrument` objects are
used to record measurements.

This module provides abstract (i.e. unimplemented) classes required for
metrics, and a concrete no-op implementation :class:`.NoOpMeter` that allows applications
to use the API package alone without a supporting implementation.

To get a meter, you need to provide the package name from which you are
calling the meter APIs to OpenTelemetry by calling `MeterProvider.get_meter`
with the calling instrumentation name and the version of your package.

The following code shows how to obtain a meter using the global :class:`.MeterProvider`::

    from opentelemetry.metrics import get_meter

    meter = get_meter("example-meter")
    counter = meter.create_counter("example-counter")

.. versionadded:: 1.10.0
"""

import warnings
from abc import ABC, abstractmethod
from dataclasses import dataclass
from logging import getLogger
from os import environ
from threading import Lock
from typing import Dict, List, Optional, Sequence, Union, cast

from opentelemetry.environment_variables import OTEL_PYTHON_METER_PROVIDER
from opentelemetry.metrics._internal.instrument import (
    CallbackT,
    Counter,
    Gauge,
    Histogram,
    NoOpCounter,
    NoOpGauge,
    NoOpHistogram,
    NoOpObservableCounter,
    NoOpObservableGauge,
    NoOpObservableUpDownCounter,
    NoOpUpDownCounter,
    ObservableCounter,
    ObservableGauge,
    ObservableUpDownCounter,
    UpDownCounter,
    _MetricsHistogramAdvisory,
    _ProxyCounter,
    _ProxyGauge,
    _ProxyHistogram,
    _ProxyObservableCounter,
    _ProxyObservableGauge,
    _ProxyObservableUpDownCounter,
    _ProxyUpDownCounter,
)
from opentelemetry.util._once import Once
from opentelemetry.util._providers import _load_provider
from opentelemetry.util.types import (
    Attributes,
)

_logger = getLogger(__name__)


# pylint: disable=invalid-name
_ProxyInstrumentT = Union[
    _ProxyCounter,
    _ProxyHistogram,
    _ProxyGauge,
    _ProxyObservableCounter,
    _ProxyObservableGauge,
    _ProxyObservableUpDownCounter,
    _ProxyUpDownCounter,
]


class MeterProvider(ABC):
    """
    MeterProvider is the entry point of the API. It provides access to `Meter` instances.
    """

    @abstractmethod
    def get_meter(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[Attributes] = None,
    ) -> "Meter":
        """Returns a `Meter` for use by the given instrumentation library.

        For any two calls it is undefined whether the same or different
        `Meter` instances are returned, even for different library names.

        This function may return different `Meter` types (e.g. a no-op meter
        vs. a functional meter).

        Args:
            name: The name of the instrumenting module.
                ``__name__`` may not be used as this can result in
                different meter names if the meters are in different files.
                It is better to use a fixed string that can be imported where
                needed and used consistently as the name of the meter.

                This should *not* be the name of the module that is
                instrumented but the name of the module doing the instrumentation.
                E.g., instead of ``"requests"``, use
                ``"opentelemetry.instrumentation.requests"``.

            version: Optional. The version string of the
                instrumenting library.  Usually this should be the same as
                ``importlib.metadata.version(instrumenting_library_name)``.

            schema_url: Optional. Specifies the Schema URL of the emitted telemetry.
            attributes: Optional. Attributes that are associated with the emitted telemetry.
        """


class NoOpMeterProvider(MeterProvider):
    """The default MeterProvider used when no MeterProvider implementation is available."""

    def get_meter(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[Attributes] = None,
    ) -> "Meter":
        """Returns a NoOpMeter."""
        return NoOpMeter(name, version=version, schema_url=schema_url)


class _ProxyMeterProvider(MeterProvider):
    def __init__(self) -> None:
        self._lock = Lock()
        self._meters: List[_ProxyMeter] = []
        self._real_meter_provider: Optional[MeterProvider] = None

    def get_meter(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[Attributes] = None,
    ) -> "Meter":
        with self._lock:
            if self._real_meter_provider is not None:
                return self._real_meter_provider.get_meter(
                    name, version, schema_url
                )

            meter = _ProxyMeter(name, version=version, schema_url=schema_url)
            self._meters.append(meter)
            return meter

    def on_set_meter_provider(self, meter_provider: MeterProvider) -> None:
        with self._lock:
            self._real_meter_provider = meter_provider
            for meter in self._meters:
                meter.on_set_meter_provider(meter_provider)


@dataclass
class _InstrumentRegistrationStatus:
    instrument_id: str
    already_registered: bool
    conflict: bool
    current_advisory: Optional[_MetricsHistogramAdvisory]


class Meter(ABC):
    """Handles instrument creation.

    This class provides methods for creating instruments which are then
    used to produce measurements.
    """

    def __init__(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
    ) -> None:
        super().__init__()
        self._name = name
        self._version = version
        self._schema_url = schema_url
        self._instrument_ids: Dict[
            str, Optional[_MetricsHistogramAdvisory]
        ] = {}
        self._instrument_ids_lock = Lock()

    @property
    def name(self) -> str:
        """
        The name of the instrumenting module.
        """
        return self._name

    @property
    def version(self) -> Optional[str]:
        """
        The version string of the instrumenting library.
        """
        return self._version

    @property
    def schema_url(self) -> Optional[str]:
        """
        Specifies the Schema URL of the emitted telemetry
        """
        return self._schema_url

    def _register_instrument(
        self,
        name: str,
        type_: type,
        unit: str,
        description: str,
        advisory: Optional[_MetricsHistogramAdvisory] = None,
    ) -> _InstrumentRegistrationStatus:
        """
        Register an instrument with the name, type, unit and description as
        identifying keys and the advisory as value.

        Returns a tuple. The first value is the instrument id.
        The second value is an `_InstrumentRegistrationStatus` where
        `already_registered` is `True` if the instrument has been registered
        already.
        If `conflict` is set to True the `current_advisory` attribute contains
        the registered instrument advisory.
        """

        instrument_id = ",".join(
            [name.strip().lower(), type_.__name__, unit, description]
        )

        already_registered = False
        conflict = False
        current_advisory = None

        with self._instrument_ids_lock:
            # we are not using get because None is a valid value
            already_registered = instrument_id in self._instrument_ids
            if already_registered:
                current_advisory = self._instrument_ids[instrument_id]
                conflict = current_advisory != advisory
            else:
                self._instrument_ids[instrument_id] = advisory

        return _InstrumentRegistrationStatus(
            instrument_id=instrument_id,
            already_registered=already_registered,
            conflict=conflict,
            current_advisory=current_advisory,
        )

    @staticmethod
    def _log_instrument_registration_conflict(
        name: str,
        instrumentation_type: str,
        unit: str,
        description: str,
        status: _InstrumentRegistrationStatus,
    ) -> None:
        _logger.warning(
            "An instrument with name %s, type %s, unit %s and "
            "description %s has been created already with a "
            "different advisory value %s and will be used instead.",
            name,
            instrumentation_type,
            unit,
            description,
            status.current_advisory,
        )

    @abstractmethod
    def create_counter(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> Counter:
        """Creates a `Counter` instrument

        Args:
            name: The name of the instrument to be created
            unit: The unit for observations this instrument reports. For
                example, ``By`` for bytes. UCUM units are recommended.
            description: A description for this instrument and what it measures.
        """

    @abstractmethod
    def create_up_down_counter(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> UpDownCounter:
        """Creates an `UpDownCounter` instrument

        Args:
            name: The name of the instrument to be created
            unit: The unit for observations this instrument reports. For
                example, ``By`` for bytes. UCUM units are recommended.
            description: A description for this instrument and what it measures.
        """

    @abstractmethod
    def create_observable_counter(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableCounter:
        """Creates an `ObservableCounter` instrument

        An observable counter observes a monotonically increasing count by calling provided
        callbacks which accept a :class:`~opentelemetry.metrics.CallbackOptions` and return
        multiple :class:`~opentelemetry.metrics.Observation`.

        For example, an observable counter could be used to report system CPU
        time periodically. Here is a basic implementation::

            def cpu_time_callback(options: CallbackOptions) -> Iterable[Observation]:
                observations = []
                with open("/proc/stat") as procstat:
                    procstat.readline()  # skip the first line
                    for line in procstat:
                        if not line.startswith("cpu"): break
                        cpu, *states = line.split()
                        observations.append(Observation(int(states[0]) // 100, {"cpu": cpu, "state": "user"}))
                        observations.append(Observation(int(states[1]) // 100, {"cpu": cpu, "state": "nice"}))
                        observations.append(Observation(int(states[2]) // 100, {"cpu": cpu, "state": "system"}))
                        # ... other states
                return observations

            meter.create_observable_counter(
                "system.cpu.time",
                callbacks=[cpu_time_callback],
                unit="s",
                description="CPU time"
            )

        To reduce memory usage, you can use generator callbacks instead of
        building the full list::

            def cpu_time_callback(options: CallbackOptions) -> Iterable[Observation]:
                with open("/proc/stat") as procstat:
                    procstat.readline()  # skip the first line
                    for line in procstat:
                        if not line.startswith("cpu"): break
                        cpu, *states = line.split()
                        yield Observation(int(states[0]) // 100, {"cpu": cpu, "state": "user"})
                        yield Observation(int(states[1]) // 100, {"cpu": cpu, "state": "nice"})
                        # ... other states

        Alternatively, you can pass a sequence of generators directly instead of a sequence of
        callbacks, which each should return iterables of :class:`~opentelemetry.metrics.Observation`::

            def cpu_time_callback(states_to_include: set[str]) -> Iterable[Iterable[Observation]]:
                # accept options sent in from OpenTelemetry
                options = yield
                while True:
                    observations = []
                    with open("/proc/stat") as procstat:
                        procstat.readline()  # skip the first line
                        for line in procstat:
                            if not line.startswith("cpu"): break
                            cpu, *states = line.split()
                            if "user" in states_to_include:
                                observations.append(Observation(int(states[0]) // 100, {"cpu": cpu, "state": "user"}))
                            if "nice" in states_to_include:
                                observations.append(Observation(int(states[1]) // 100, {"cpu": cpu, "state": "nice"}))
                            # ... other states
                    # yield the observations and receive the options for next iteration
                    options = yield observations

            meter.create_observable_counter(
                "system.cpu.time",
                callbacks=[cpu_time_callback({"user", "system"})],
                unit="s",
                description="CPU time"
            )

        The :class:`~opentelemetry.metrics.CallbackOptions` contain a timeout which the
        callback should respect. For example if the callback does asynchronous work, like
        making HTTP requests, it should respect the timeout::

            def scrape_http_callback(options: CallbackOptions) -> Iterable[Observation]:
                r = requests.get('http://scrapethis.com', timeout=options.timeout_millis / 10**3)
                for value in r.json():
                    yield Observation(value)

        Args:
            name: The name of the instrument to be created
            callbacks: A sequence of callbacks that return an iterable of
                :class:`~opentelemetry.metrics.Observation`. Alternatively, can be a sequence of generators that each
                yields iterables of :class:`~opentelemetry.metrics.Observation`.
            unit: The unit for observations this instrument reports. For
                example, ``By`` for bytes. UCUM units are recommended.
            description: A description for this instrument and what it measures.
        """

    @abstractmethod
    def create_histogram(
        self,
        name: str,
        unit: str = "",
        description: str = "",
        *,
        explicit_bucket_boundaries_advisory: Optional[Sequence[float]] = None,
    ) -> Histogram:
        """Creates a :class:`~opentelemetry.metrics.Histogram` instrument

        Args:
            name: The name of the instrument to be created
            unit: The unit for observations this instrument reports. For
                example, ``By`` for bytes. UCUM units are recommended.
            description: A description for this instrument and what it measures.
        """

    def create_gauge(  # type: ignore # pylint: disable=no-self-use
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> Gauge:  # pyright: ignore[reportReturnType]
        """Creates a ``Gauge`` instrument

        Args:
            name: The name of the instrument to be created
            unit: The unit for observations this instrument reports. For
                example, ``By`` for bytes. UCUM units are recommended.
            description: A description for this instrument and what it measures.
        """
        warnings.warn("create_gauge() is not implemented and will be a no-op")

    @abstractmethod
    def create_observable_gauge(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableGauge:
        """Creates an `ObservableGauge` instrument

        Args:
            name: The name of the instrument to be created
            callbacks: A sequence of callbacks that return an iterable of
                :class:`~opentelemetry.metrics.Observation`. Alternatively, can be a generator that yields iterables
                of :class:`~opentelemetry.metrics.Observation`.
            unit: The unit for observations this instrument reports. For
                example, ``By`` for bytes. UCUM units are recommended.
            description: A description for this instrument and what it measures.
        """

    @abstractmethod
    def create_observable_up_down_counter(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableUpDownCounter:
        """Creates an `ObservableUpDownCounter` instrument

        Args:
            name: The name of the instrument to be created
            callbacks: A sequence of callbacks that return an iterable of
                :class:`~opentelemetry.metrics.Observation`. Alternatively, can be a generator that yields iterables
                of :class:`~opentelemetry.metrics.Observation`.
            unit: The unit for observations this instrument reports. For
                example, ``By`` for bytes. UCUM units are recommended.
            description: A description for this instrument and what it measures.
        """


class _ProxyMeter(Meter):
    def __init__(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
    ) -> None:
        super().__init__(name, version=version, schema_url=schema_url)
        self._lock = Lock()
        self._instruments: List[_ProxyInstrumentT] = []
        self._real_meter: Optional[Meter] = None

    def on_set_meter_provider(self, meter_provider: MeterProvider) -> None:
        """Called when a real meter provider is set on the creating _ProxyMeterProvider

        Creates a real backing meter for this instance and notifies all created
        instruments so they can create real backing instruments.
        """
        real_meter = meter_provider.get_meter(
            self._name, self._version, self._schema_url
        )

        with self._lock:
            self._real_meter = real_meter
            # notify all proxy instruments of the new meter so they can create
            # real instruments to back themselves
            for instrument in self._instruments:
                instrument.on_meter_set(real_meter)

    def create_counter(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> Counter:
        with self._lock:
            if self._real_meter:
                return self._real_meter.create_counter(name, unit, description)
            proxy = _ProxyCounter(name, unit, description)
            self._instruments.append(proxy)
            return proxy

    def create_up_down_counter(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> UpDownCounter:
        with self._lock:
            if self._real_meter:
                return self._real_meter.create_up_down_counter(
                    name, unit, description
                )
            proxy = _ProxyUpDownCounter(name, unit, description)
            self._instruments.append(proxy)
            return proxy

    def create_observable_counter(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableCounter:
        with self._lock:
            if self._real_meter:
                return self._real_meter.create_observable_counter(
                    name, callbacks, unit, description
                )
            proxy = _ProxyObservableCounter(
                name, callbacks, unit=unit, description=description
            )
            self._instruments.append(proxy)
            return proxy

    def create_histogram(
        self,
        name: str,
        unit: str = "",
        description: str = "",
        *,
        explicit_bucket_boundaries_advisory: Optional[Sequence[float]] = None,
    ) -> Histogram:
        with self._lock:
            if self._real_meter:
                return self._real_meter.create_histogram(
                    name,
                    unit,
                    description,
                    explicit_bucket_boundaries_advisory=explicit_bucket_boundaries_advisory,
                )
            proxy = _ProxyHistogram(
                name, unit, description, explicit_bucket_boundaries_advisory
            )
            self._instruments.append(proxy)
            return proxy

    def create_gauge(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> Gauge:
        with self._lock:
            if self._real_meter:
                return self._real_meter.create_gauge(name, unit, description)
            proxy = _ProxyGauge(name, unit, description)
            self._instruments.append(proxy)
            return proxy

    def create_observable_gauge(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableGauge:
        with self._lock:
            if self._real_meter:
                return self._real_meter.create_observable_gauge(
                    name, callbacks, unit, description
                )
            proxy = _ProxyObservableGauge(
                name, callbacks, unit=unit, description=description
            )
            self._instruments.append(proxy)
            return proxy

    def create_observable_up_down_counter(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableUpDownCounter:
        with self._lock:
            if self._real_meter:
                return self._real_meter.create_observable_up_down_counter(
                    name,
                    callbacks,
                    unit,
                    description,
                )
            proxy = _ProxyObservableUpDownCounter(
                name, callbacks, unit=unit, description=description
            )
            self._instruments.append(proxy)
            return proxy


class NoOpMeter(Meter):
    """The default Meter used when no Meter implementation is available.

    All operations are no-op.
    """

    def create_counter(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> Counter:
        """Returns a no-op Counter."""
        status = self._register_instrument(
            name, NoOpCounter, unit, description
        )
        if status.conflict:
            self._log_instrument_registration_conflict(
                name,
                Counter.__name__,
                unit,
                description,
                status,
            )

        return NoOpCounter(name, unit=unit, description=description)

    def create_gauge(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> Gauge:
        """Returns a no-op Gauge."""
        status = self._register_instrument(name, NoOpGauge, unit, description)
        if status.conflict:
            self._log_instrument_registration_conflict(
                name,
                Gauge.__name__,
                unit,
                description,
                status,
            )
        return NoOpGauge(name, unit=unit, description=description)

    def create_up_down_counter(
        self,
        name: str,
        unit: str = "",
        description: str = "",
    ) -> UpDownCounter:
        """Returns a no-op UpDownCounter."""
        status = self._register_instrument(
            name, NoOpUpDownCounter, unit, description
        )
        if status.conflict:
            self._log_instrument_registration_conflict(
                name,
                UpDownCounter.__name__,
                unit,
                description,
                status,
            )
        return NoOpUpDownCounter(name, unit=unit, description=description)

    def create_observable_counter(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableCounter:
        """Returns a no-op ObservableCounter."""
        status = self._register_instrument(
            name, NoOpObservableCounter, unit, description
        )
        if status.conflict:
            self._log_instrument_registration_conflict(
                name,
                ObservableCounter.__name__,
                unit,
                description,
                status,
            )
        return NoOpObservableCounter(
            name,
            callbacks,
            unit=unit,
            description=description,
        )

    def create_histogram(
        self,
        name: str,
        unit: str = "",
        description: str = "",
        *,
        explicit_bucket_boundaries_advisory: Optional[Sequence[float]] = None,
    ) -> Histogram:
        """Returns a no-op Histogram."""
        status = self._register_instrument(
            name,
            NoOpHistogram,
            unit,
            description,
            _MetricsHistogramAdvisory(
                explicit_bucket_boundaries=explicit_bucket_boundaries_advisory
            ),
        )
        if status.conflict:
            self._log_instrument_registration_conflict(
                name,
                Histogram.__name__,
                unit,
                description,
                status,
            )
        return NoOpHistogram(
            name,
            unit=unit,
            description=description,
            explicit_bucket_boundaries_advisory=explicit_bucket_boundaries_advisory,
        )

    def create_observable_gauge(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableGauge:
        """Returns a no-op ObservableGauge."""
        status = self._register_instrument(
            name, NoOpObservableGauge, unit, description
        )
        if status.conflict:
            self._log_instrument_registration_conflict(
                name,
                ObservableGauge.__name__,
                unit,
                description,
                status,
            )
        return NoOpObservableGauge(
            name,
            callbacks,
            unit=unit,
            description=description,
        )

    def create_observable_up_down_counter(
        self,
        name: str,
        callbacks: Optional[Sequence[CallbackT]] = None,
        unit: str = "",
        description: str = "",
    ) -> ObservableUpDownCounter:
        """Returns a no-op ObservableUpDownCounter."""
        status = self._register_instrument(
            name, NoOpObservableUpDownCounter, unit, description
        )
        if status.conflict:
            self._log_instrument_registration_conflict(
                name,
                ObservableUpDownCounter.__name__,
                unit,
                description,
                status,
            )
        return NoOpObservableUpDownCounter(
            name,
            callbacks,
            unit=unit,
            description=description,
        )


_METER_PROVIDER_SET_ONCE = Once()
_METER_PROVIDER: Optional[MeterProvider] = None
_PROXY_METER_PROVIDER = _ProxyMeterProvider()


def get_meter(
    name: str,
    version: str = "",
    meter_provider: Optional[MeterProvider] = None,
    schema_url: Optional[str] = None,
    attributes: Optional[Attributes] = None,
) -> "Meter":
    """Returns a `Meter` for use by the given instrumentation library.

    This function is a convenience wrapper for
    `opentelemetry.metrics.MeterProvider.get_meter`.

    If meter_provider is omitted the current configured one is used.
    """
    if meter_provider is None:
        meter_provider = get_meter_provider()
    return meter_provider.get_meter(name, version, schema_url, attributes)


def _set_meter_provider(meter_provider: MeterProvider, log: bool) -> None:
    def set_mp() -> None:
        global _METER_PROVIDER  # pylint: disable=global-statement
        _METER_PROVIDER = meter_provider

        # gives all proxies real instruments off the newly set meter provider
        _PROXY_METER_PROVIDER.on_set_meter_provider(meter_provider)

    did_set = _METER_PROVIDER_SET_ONCE.do_once(set_mp)

    if log and not did_set:
        _logger.warning("Overriding of current MeterProvider is not allowed")


def set_meter_provider(meter_provider: MeterProvider) -> None:
    """Sets the current global :class:`~.MeterProvider` object.

    This can only be done once, a warning will be logged if any further attempt
    is made.
    """
    _set_meter_provider(meter_provider, log=True)


def get_meter_provider() -> MeterProvider:
    """Gets the current global :class:`~.MeterProvider` object."""

    if _METER_PROVIDER is None:
        if OTEL_PYTHON_METER_PROVIDER not in environ:
            return _PROXY_METER_PROVIDER

        meter_provider: MeterProvider = _load_provider(  # type: ignore
            OTEL_PYTHON_METER_PROVIDER, "meter_provider"
        )
        _set_meter_provider(meter_provider, log=False)

    # _METER_PROVIDER will have been set by one thread
    return cast("MeterProvider", _METER_PROVIDER)
