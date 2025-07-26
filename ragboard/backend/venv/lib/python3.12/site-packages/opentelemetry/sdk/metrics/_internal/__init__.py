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

import weakref
from atexit import register, unregister
from logging import getLogger
from os import environ
from threading import Lock
from time import time_ns
from typing import Optional, Sequence

# This kind of import is needed to avoid Sphinx errors.
import opentelemetry.sdk.metrics
from opentelemetry.metrics import Counter as APICounter
from opentelemetry.metrics import Histogram as APIHistogram
from opentelemetry.metrics import Meter as APIMeter
from opentelemetry.metrics import MeterProvider as APIMeterProvider
from opentelemetry.metrics import NoOpMeter
from opentelemetry.metrics import ObservableCounter as APIObservableCounter
from opentelemetry.metrics import ObservableGauge as APIObservableGauge
from opentelemetry.metrics import (
    ObservableUpDownCounter as APIObservableUpDownCounter,
)
from opentelemetry.metrics import UpDownCounter as APIUpDownCounter
from opentelemetry.metrics import _Gauge as APIGauge
from opentelemetry.sdk.environment_variables import (
    OTEL_METRICS_EXEMPLAR_FILTER,
    OTEL_SDK_DISABLED,
)
from opentelemetry.sdk.metrics._internal.exceptions import MetricsTimeoutError
from opentelemetry.sdk.metrics._internal.exemplar import (
    AlwaysOffExemplarFilter,
    AlwaysOnExemplarFilter,
    ExemplarFilter,
    TraceBasedExemplarFilter,
)
from opentelemetry.sdk.metrics._internal.instrument import (
    _Counter,
    _Gauge,
    _Histogram,
    _ObservableCounter,
    _ObservableGauge,
    _ObservableUpDownCounter,
    _UpDownCounter,
)
from opentelemetry.sdk.metrics._internal.measurement_consumer import (
    MeasurementConsumer,
    SynchronousMeasurementConsumer,
)
from opentelemetry.sdk.metrics._internal.sdk_configuration import (
    SdkConfiguration,
)
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.util.instrumentation import InstrumentationScope
from opentelemetry.util._once import Once
from opentelemetry.util.types import (
    Attributes,
)

_logger = getLogger(__name__)


class Meter(APIMeter):
    """See `opentelemetry.metrics.Meter`."""

    def __init__(
        self,
        instrumentation_scope: InstrumentationScope,
        measurement_consumer: MeasurementConsumer,
    ):
        super().__init__(
            name=instrumentation_scope.name,
            version=instrumentation_scope.version,
            schema_url=instrumentation_scope.schema_url,
        )
        self._instrumentation_scope = instrumentation_scope
        self._measurement_consumer = measurement_consumer
        self._instrument_id_instrument = {}
        self._instrument_id_instrument_lock = Lock()

    def create_counter(self, name, unit="", description="") -> APICounter:
        status = self._register_instrument(name, _Counter, unit, description)

        if status.conflict:
            # FIXME #2558 go through all views here and check if this
            # instrument registration conflict can be fixed. If it can be, do
            # not log the following warning.
            self._log_instrument_registration_conflict(
                name,
                APICounter.__name__,
                unit,
                description,
                status,
            )
        if status.already_registered:
            with self._instrument_id_instrument_lock:
                return self._instrument_id_instrument[status.instrument_id]

        instrument = _Counter(
            name,
            self._instrumentation_scope,
            self._measurement_consumer,
            unit,
            description,
        )

        with self._instrument_id_instrument_lock:
            self._instrument_id_instrument[status.instrument_id] = instrument
            return instrument

    def create_up_down_counter(
        self, name, unit="", description=""
    ) -> APIUpDownCounter:
        status = self._register_instrument(
            name, _UpDownCounter, unit, description
        )

        if status.conflict:
            # FIXME #2558 go through all views here and check if this
            # instrument registration conflict can be fixed. If it can be, do
            # not log the following warning.
            self._log_instrument_registration_conflict(
                name,
                APIUpDownCounter.__name__,
                unit,
                description,
                status,
            )
        if status.already_registered:
            with self._instrument_id_instrument_lock:
                return self._instrument_id_instrument[status.instrument_id]

        instrument = _UpDownCounter(
            name,
            self._instrumentation_scope,
            self._measurement_consumer,
            unit,
            description,
        )

        with self._instrument_id_instrument_lock:
            self._instrument_id_instrument[status.instrument_id] = instrument
            return instrument

    def create_observable_counter(
        self,
        name,
        callbacks=None,
        unit="",
        description="",
    ) -> APIObservableCounter:
        status = self._register_instrument(
            name, _ObservableCounter, unit, description
        )

        if status.conflict:
            # FIXME #2558 go through all views here and check if this
            # instrument registration conflict can be fixed. If it can be, do
            # not log the following warning.
            self._log_instrument_registration_conflict(
                name,
                APIObservableCounter.__name__,
                unit,
                description,
                status,
            )
        if status.already_registered:
            with self._instrument_id_instrument_lock:
                return self._instrument_id_instrument[status.instrument_id]

        instrument = _ObservableCounter(
            name,
            self._instrumentation_scope,
            self._measurement_consumer,
            callbacks,
            unit,
            description,
        )

        self._measurement_consumer.register_asynchronous_instrument(instrument)

        with self._instrument_id_instrument_lock:
            self._instrument_id_instrument[status.instrument_id] = instrument
            return instrument

    def create_histogram(
        self,
        name: str,
        unit: str = "",
        description: str = "",
        *,
        explicit_bucket_boundaries_advisory: Optional[Sequence[float]] = None,
    ) -> APIHistogram:
        if explicit_bucket_boundaries_advisory is not None:
            invalid_advisory = False
            if isinstance(explicit_bucket_boundaries_advisory, Sequence):
                try:
                    invalid_advisory = not (
                        all(
                            isinstance(e, (float, int))
                            for e in explicit_bucket_boundaries_advisory
                        )
                    )
                except (KeyError, TypeError):
                    invalid_advisory = True
            else:
                invalid_advisory = True

            if invalid_advisory:
                explicit_bucket_boundaries_advisory = None
                _logger.warning(
                    "explicit_bucket_boundaries_advisory must be a sequence of numbers"
                )

        status = self._register_instrument(
            name,
            _Histogram,
            unit,
            description,
            explicit_bucket_boundaries_advisory,
        )

        if status.conflict:
            # FIXME #2558 go through all views here and check if this
            # instrument registration conflict can be fixed. If it can be, do
            # not log the following warning.
            self._log_instrument_registration_conflict(
                name,
                APIHistogram.__name__,
                unit,
                description,
                status,
            )
        if status.already_registered:
            with self._instrument_id_instrument_lock:
                return self._instrument_id_instrument[status.instrument_id]

        instrument = _Histogram(
            name,
            self._instrumentation_scope,
            self._measurement_consumer,
            unit,
            description,
            explicit_bucket_boundaries_advisory,
        )
        with self._instrument_id_instrument_lock:
            self._instrument_id_instrument[status.instrument_id] = instrument
            return instrument

    def create_gauge(self, name, unit="", description="") -> APIGauge:
        status = self._register_instrument(name, _Gauge, unit, description)

        if status.conflict:
            # FIXME #2558 go through all views here and check if this
            # instrument registration conflict can be fixed. If it can be, do
            # not log the following warning.
            self._log_instrument_registration_conflict(
                name,
                APIGauge.__name__,
                unit,
                description,
                status,
            )
        if status.already_registered:
            with self._instrument_id_instrument_lock:
                return self._instrument_id_instrument[status.instrument_id]

        instrument = _Gauge(
            name,
            self._instrumentation_scope,
            self._measurement_consumer,
            unit,
            description,
        )

        with self._instrument_id_instrument_lock:
            self._instrument_id_instrument[status.instrument_id] = instrument
            return instrument

    def create_observable_gauge(
        self, name, callbacks=None, unit="", description=""
    ) -> APIObservableGauge:
        status = self._register_instrument(
            name, _ObservableGauge, unit, description
        )

        if status.conflict:
            # FIXME #2558 go through all views here and check if this
            # instrument registration conflict can be fixed. If it can be, do
            # not log the following warning.
            self._log_instrument_registration_conflict(
                name,
                APIObservableGauge.__name__,
                unit,
                description,
                status,
            )
        if status.already_registered:
            with self._instrument_id_instrument_lock:
                return self._instrument_id_instrument[status.instrument_id]

        instrument = _ObservableGauge(
            name,
            self._instrumentation_scope,
            self._measurement_consumer,
            callbacks,
            unit,
            description,
        )

        self._measurement_consumer.register_asynchronous_instrument(instrument)

        with self._instrument_id_instrument_lock:
            self._instrument_id_instrument[status.instrument_id] = instrument
            return instrument

    def create_observable_up_down_counter(
        self, name, callbacks=None, unit="", description=""
    ) -> APIObservableUpDownCounter:
        status = self._register_instrument(
            name, _ObservableUpDownCounter, unit, description
        )

        if status.conflict:
            # FIXME #2558 go through all views here and check if this
            # instrument registration conflict can be fixed. If it can be, do
            # not log the following warning.
            self._log_instrument_registration_conflict(
                name,
                APIObservableUpDownCounter.__name__,
                unit,
                description,
                status,
            )
        if status.already_registered:
            with self._instrument_id_instrument_lock:
                return self._instrument_id_instrument[status.instrument_id]

        instrument = _ObservableUpDownCounter(
            name,
            self._instrumentation_scope,
            self._measurement_consumer,
            callbacks,
            unit,
            description,
        )

        self._measurement_consumer.register_asynchronous_instrument(instrument)

        with self._instrument_id_instrument_lock:
            self._instrument_id_instrument[status.instrument_id] = instrument
            return instrument


def _get_exemplar_filter(exemplar_filter: str) -> ExemplarFilter:
    if exemplar_filter == "trace_based":
        return TraceBasedExemplarFilter()
    if exemplar_filter == "always_on":
        return AlwaysOnExemplarFilter()
    if exemplar_filter == "always_off":
        return AlwaysOffExemplarFilter()
    msg = f"Unknown exemplar filter '{exemplar_filter}'."
    raise ValueError(msg)


class MeterProvider(APIMeterProvider):
    r"""See `opentelemetry.metrics.MeterProvider`.

    Args:
        metric_readers: Register metric readers to collect metrics from the SDK
            on demand. Each :class:`opentelemetry.sdk.metrics.export.MetricReader` is
            completely independent and will collect separate streams of
            metrics. TODO: reference ``PeriodicExportingMetricReader`` usage with push
            exporters here.
        resource: The resource representing what the metrics emitted from the SDK pertain to.
        shutdown_on_exit: If true, registers an `atexit` handler to call
            `MeterProvider.shutdown`
        views: The views to configure the metric output the SDK

    By default, instruments which do not match any :class:`opentelemetry.sdk.metrics.view.View` (or if no :class:`opentelemetry.sdk.metrics.view.View`\ s
    are provided) will report metrics with the default aggregation for the
    instrument's kind. To disable instruments by default, configure a match-all
    :class:`opentelemetry.sdk.metrics.view.View` with `DropAggregation` and then create :class:`opentelemetry.sdk.metrics.view.View`\ s to re-enable
    individual instruments:

    .. code-block:: python
        :caption: Disable default views

        MeterProvider(
            views=[
                View(instrument_name="*", aggregation=DropAggregation()),
                View(instrument_name="mycounter"),
            ],
            # ...
        )
    """

    _all_metric_readers_lock = Lock()
    _all_metric_readers = weakref.WeakSet()

    def __init__(
        self,
        metric_readers: Sequence[
            "opentelemetry.sdk.metrics.export.MetricReader"
        ] = (),
        resource: Optional[Resource] = None,
        exemplar_filter: Optional[ExemplarFilter] = None,
        shutdown_on_exit: bool = True,
        views: Sequence["opentelemetry.sdk.metrics.view.View"] = (),
    ):
        self._lock = Lock()
        self._meter_lock = Lock()
        self._atexit_handler = None
        if resource is None:
            resource = Resource.create({})
        self._sdk_config = SdkConfiguration(
            exemplar_filter=(
                exemplar_filter
                or _get_exemplar_filter(
                    environ.get(OTEL_METRICS_EXEMPLAR_FILTER, "trace_based")
                )
            ),
            resource=resource,
            metric_readers=metric_readers,
            views=views,
        )
        self._measurement_consumer = SynchronousMeasurementConsumer(
            sdk_config=self._sdk_config
        )
        disabled = environ.get(OTEL_SDK_DISABLED, "")
        self._disabled = disabled.lower().strip() == "true"

        if shutdown_on_exit:
            self._atexit_handler = register(self.shutdown)

        self._meters = {}
        self._shutdown_once = Once()
        self._shutdown = False

        for metric_reader in self._sdk_config.metric_readers:
            with self._all_metric_readers_lock:
                if metric_reader in self._all_metric_readers:
                    # pylint: disable=broad-exception-raised
                    raise Exception(
                        f"MetricReader {metric_reader} has been registered "
                        "already in other MeterProvider instance"
                    )

                self._all_metric_readers.add(metric_reader)

            metric_reader._set_collect_callback(
                self._measurement_consumer.collect
            )

    def force_flush(self, timeout_millis: float = 10_000) -> bool:
        deadline_ns = time_ns() + timeout_millis * 10**6

        metric_reader_error = {}

        for metric_reader in self._sdk_config.metric_readers:
            current_ts = time_ns()
            try:
                if current_ts >= deadline_ns:
                    raise MetricsTimeoutError(
                        "Timed out while flushing metric readers"
                    )
                metric_reader.force_flush(
                    timeout_millis=(deadline_ns - current_ts) / 10**6
                )

            # pylint: disable=broad-exception-caught
            except Exception as error:
                metric_reader_error[metric_reader] = error

        if metric_reader_error:
            metric_reader_error_string = "\n".join(
                [
                    f"{metric_reader.__class__.__name__}: {repr(error)}"
                    for metric_reader, error in metric_reader_error.items()
                ]
            )

            # pylint: disable=broad-exception-raised
            raise Exception(
                "MeterProvider.force_flush failed because the following "
                "metric readers failed during collect:\n"
                f"{metric_reader_error_string}"
            )
        return True

    def shutdown(self, timeout_millis: float = 30_000):
        deadline_ns = time_ns() + timeout_millis * 10**6

        def _shutdown():
            self._shutdown = True

        did_shutdown = self._shutdown_once.do_once(_shutdown)

        if not did_shutdown:
            _logger.warning("shutdown can only be called once")
            return

        metric_reader_error = {}

        for metric_reader in self._sdk_config.metric_readers:
            current_ts = time_ns()
            try:
                if current_ts >= deadline_ns:
                    # pylint: disable=broad-exception-raised
                    raise Exception(
                        "Didn't get to execute, deadline already exceeded"
                    )
                metric_reader.shutdown(
                    timeout_millis=(deadline_ns - current_ts) / 10**6
                )

            # pylint: disable=broad-exception-caught
            except Exception as error:
                metric_reader_error[metric_reader] = error

        if self._atexit_handler is not None:
            unregister(self._atexit_handler)
            self._atexit_handler = None

        if metric_reader_error:
            metric_reader_error_string = "\n".join(
                [
                    f"{metric_reader.__class__.__name__}: {repr(error)}"
                    for metric_reader, error in metric_reader_error.items()
                ]
            )

            # pylint: disable=broad-exception-raised
            raise Exception(
                (
                    "MeterProvider.shutdown failed because the following "
                    "metric readers failed during shutdown:\n"
                    f"{metric_reader_error_string}"
                )
            )

    def get_meter(
        self,
        name: str,
        version: Optional[str] = None,
        schema_url: Optional[str] = None,
        attributes: Optional[Attributes] = None,
    ) -> Meter:
        if self._disabled:
            return NoOpMeter(name, version=version, schema_url=schema_url)

        if self._shutdown:
            _logger.warning(
                "A shutdown `MeterProvider` can not provide a `Meter`"
            )
            return NoOpMeter(name, version=version, schema_url=schema_url)

        if not name:
            _logger.warning("Meter name cannot be None or empty.")
            return NoOpMeter(name, version=version, schema_url=schema_url)

        info = InstrumentationScope(name, version, schema_url, attributes)
        with self._meter_lock:
            if not self._meters.get(info):
                # FIXME #2558 pass SDKConfig object to meter so that the meter
                # has access to views.
                self._meters[info] = Meter(
                    info,
                    self._measurement_consumer,
                )
            return self._meters[info]
