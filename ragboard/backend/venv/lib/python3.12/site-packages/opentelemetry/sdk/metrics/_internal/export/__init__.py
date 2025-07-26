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
from __future__ import annotations

import math
import os
import weakref
from abc import ABC, abstractmethod
from enum import Enum
from logging import getLogger
from os import environ, linesep
from sys import stdout
from threading import Event, Lock, RLock, Thread
from time import time_ns
from typing import IO, Callable, Iterable, Optional

from typing_extensions import final

# This kind of import is needed to avoid Sphinx errors.
import opentelemetry.sdk.metrics._internal
from opentelemetry.context import (
    _SUPPRESS_INSTRUMENTATION_KEY,
    attach,
    detach,
    set_value,
)
from opentelemetry.sdk.environment_variables import (
    OTEL_METRIC_EXPORT_INTERVAL,
    OTEL_METRIC_EXPORT_TIMEOUT,
)
from opentelemetry.sdk.metrics._internal.aggregation import (
    AggregationTemporality,
    DefaultAggregation,
)
from opentelemetry.sdk.metrics._internal.exceptions import MetricsTimeoutError
from opentelemetry.sdk.metrics._internal.instrument import (
    Counter,
    Gauge,
    Histogram,
    ObservableCounter,
    ObservableGauge,
    ObservableUpDownCounter,
    UpDownCounter,
    _Counter,
    _Gauge,
    _Histogram,
    _ObservableCounter,
    _ObservableGauge,
    _ObservableUpDownCounter,
    _UpDownCounter,
)
from opentelemetry.sdk.metrics._internal.point import MetricsData
from opentelemetry.util._once import Once

_logger = getLogger(__name__)


class MetricExportResult(Enum):
    """Result of exporting a metric

    Can be any of the following values:"""

    SUCCESS = 0
    FAILURE = 1


class MetricExporter(ABC):
    """Interface for exporting metrics.

    Interface to be implemented by services that want to export metrics received
    in their own format.

    Args:
        preferred_temporality: Used by `opentelemetry.sdk.metrics.export.PeriodicExportingMetricReader` to
            configure exporter level preferred temporality. See `opentelemetry.sdk.metrics.export.MetricReader` for
            more details on what preferred temporality is.
        preferred_aggregation: Used by `opentelemetry.sdk.metrics.export.PeriodicExportingMetricReader` to
            configure exporter level preferred aggregation. See `opentelemetry.sdk.metrics.export.MetricReader` for
            more details on what preferred aggregation is.
    """

    def __init__(
        self,
        preferred_temporality: dict[type, AggregationTemporality]
        | None = None,
        preferred_aggregation: dict[
            type, "opentelemetry.sdk.metrics.view.Aggregation"
        ]
        | None = None,
    ) -> None:
        self._preferred_temporality = preferred_temporality
        self._preferred_aggregation = preferred_aggregation

    @abstractmethod
    def export(
        self,
        metrics_data: MetricsData,
        timeout_millis: float = 10_000,
        **kwargs,
    ) -> MetricExportResult:
        """Exports a batch of telemetry data.

        Args:
            metrics: The list of `opentelemetry.sdk.metrics.export.Metric` objects to be exported

        Returns:
            The result of the export
        """

    @abstractmethod
    def force_flush(self, timeout_millis: float = 10_000) -> bool:
        """
        Ensure that export of any metrics currently received by the exporter
        are completed as soon as possible.
        """

    @abstractmethod
    def shutdown(self, timeout_millis: float = 30_000, **kwargs) -> None:
        """Shuts down the exporter.

        Called when the SDK is shut down.
        """


class ConsoleMetricExporter(MetricExporter):
    """Implementation of :class:`MetricExporter` that prints metrics to the
    console.

    This class can be used for diagnostic purposes. It prints the exported
    metrics to the console STDOUT.
    """

    def __init__(
        self,
        out: IO = stdout,
        formatter: Callable[
            ["opentelemetry.sdk.metrics.export.MetricsData"], str
        ] = lambda metrics_data: metrics_data.to_json() + linesep,
        preferred_temporality: dict[type, AggregationTemporality]
        | None = None,
        preferred_aggregation: dict[
            type, "opentelemetry.sdk.metrics.view.Aggregation"
        ]
        | None = None,
    ):
        super().__init__(
            preferred_temporality=preferred_temporality,
            preferred_aggregation=preferred_aggregation,
        )
        self.out = out
        self.formatter = formatter

    def export(
        self,
        metrics_data: MetricsData,
        timeout_millis: float = 10_000,
        **kwargs,
    ) -> MetricExportResult:
        self.out.write(self.formatter(metrics_data))
        self.out.flush()
        return MetricExportResult.SUCCESS

    def shutdown(self, timeout_millis: float = 30_000, **kwargs) -> None:
        pass

    def force_flush(self, timeout_millis: float = 10_000) -> bool:
        return True


class MetricReader(ABC):
    # pylint: disable=too-many-branches,broad-exception-raised
    """
    Base class for all metric readers

    Args:
        preferred_temporality: A mapping between instrument classes and
            aggregation temporality. By default uses CUMULATIVE for all instrument
            classes. This mapping will be used to define the default aggregation
            temporality of every instrument class. If the user wants to make a
            change in the default aggregation temporality of an instrument class,
            it is enough to pass here a dictionary whose keys are the instrument
            classes and the values are the corresponding desired aggregation
            temporalities of the classes that the user wants to change, not all of
            them. The classes not included in the passed dictionary will retain
            their association to their default aggregation temporalities.
        preferred_aggregation: A mapping between instrument classes and
            aggregation instances. By default maps all instrument classes to an
            instance of `DefaultAggregation`. This mapping will be used to
            define the default aggregation of every instrument class. If the
            user wants to make a change in the default aggregation of an
            instrument class, it is enough to pass here a dictionary whose keys
            are the instrument classes and the values are the corresponding
            desired aggregation for the instrument classes that the user wants
            to change, not necessarily all of them. The classes not included in
            the passed dictionary will retain their association to their
            default aggregations. The aggregation defined here will be
            overridden by an aggregation defined by a view that is not
            `DefaultAggregation`.

    .. document protected _receive_metrics which is a intended to be overridden by subclass
    .. automethod:: _receive_metrics
    """

    def __init__(
        self,
        preferred_temporality: dict[type, AggregationTemporality]
        | None = None,
        preferred_aggregation: dict[
            type, "opentelemetry.sdk.metrics.view.Aggregation"
        ]
        | None = None,
    ) -> None:
        self._collect: Callable[
            [
                "opentelemetry.sdk.metrics.export.MetricReader",
                AggregationTemporality,
            ],
            Iterable["opentelemetry.sdk.metrics.export.Metric"],
        ] = None

        self._instrument_class_temporality = {
            _Counter: AggregationTemporality.CUMULATIVE,
            _UpDownCounter: AggregationTemporality.CUMULATIVE,
            _Histogram: AggregationTemporality.CUMULATIVE,
            _Gauge: AggregationTemporality.CUMULATIVE,
            _ObservableCounter: AggregationTemporality.CUMULATIVE,
            _ObservableUpDownCounter: AggregationTemporality.CUMULATIVE,
            _ObservableGauge: AggregationTemporality.CUMULATIVE,
        }

        if preferred_temporality is not None:
            for temporality in preferred_temporality.values():
                if temporality not in (
                    AggregationTemporality.CUMULATIVE,
                    AggregationTemporality.DELTA,
                ):
                    raise Exception(
                        f"Invalid temporality value found {temporality}"
                    )

        if preferred_temporality is not None:
            for typ, temporality in preferred_temporality.items():
                if typ is Counter:
                    self._instrument_class_temporality[_Counter] = temporality
                elif typ is UpDownCounter:
                    self._instrument_class_temporality[_UpDownCounter] = (
                        temporality
                    )
                elif typ is Histogram:
                    self._instrument_class_temporality[_Histogram] = (
                        temporality
                    )
                elif typ is Gauge:
                    self._instrument_class_temporality[_Gauge] = temporality
                elif typ is ObservableCounter:
                    self._instrument_class_temporality[_ObservableCounter] = (
                        temporality
                    )
                elif typ is ObservableUpDownCounter:
                    self._instrument_class_temporality[
                        _ObservableUpDownCounter
                    ] = temporality
                elif typ is ObservableGauge:
                    self._instrument_class_temporality[_ObservableGauge] = (
                        temporality
                    )
                else:
                    raise Exception(f"Invalid instrument class found {typ}")

        self._preferred_temporality = preferred_temporality
        self._instrument_class_aggregation = {
            _Counter: DefaultAggregation(),
            _UpDownCounter: DefaultAggregation(),
            _Histogram: DefaultAggregation(),
            _Gauge: DefaultAggregation(),
            _ObservableCounter: DefaultAggregation(),
            _ObservableUpDownCounter: DefaultAggregation(),
            _ObservableGauge: DefaultAggregation(),
        }

        if preferred_aggregation is not None:
            for typ, aggregation in preferred_aggregation.items():
                if typ is Counter:
                    self._instrument_class_aggregation[_Counter] = aggregation
                elif typ is UpDownCounter:
                    self._instrument_class_aggregation[_UpDownCounter] = (
                        aggregation
                    )
                elif typ is Histogram:
                    self._instrument_class_aggregation[_Histogram] = (
                        aggregation
                    )
                elif typ is Gauge:
                    self._instrument_class_aggregation[_Gauge] = aggregation
                elif typ is ObservableCounter:
                    self._instrument_class_aggregation[_ObservableCounter] = (
                        aggregation
                    )
                elif typ is ObservableUpDownCounter:
                    self._instrument_class_aggregation[
                        _ObservableUpDownCounter
                    ] = aggregation
                elif typ is ObservableGauge:
                    self._instrument_class_aggregation[_ObservableGauge] = (
                        aggregation
                    )
                else:
                    raise Exception(f"Invalid instrument class found {typ}")

    @final
    def collect(self, timeout_millis: float = 10_000) -> None:
        """Collects the metrics from the internal SDK state and
        invokes the `_receive_metrics` with the collection.

        Args:
            timeout_millis: Amount of time in milliseconds before this function
              raises a timeout error.

        If any of the underlying ``collect`` methods called by this method
        fails by any reason (including timeout) an exception will be raised
        detailing the individual errors that caused this function to fail.
        """
        if self._collect is None:
            _logger.warning(
                "Cannot call collect on a MetricReader until it is registered on a MeterProvider"
            )
            return

        metrics = self._collect(self, timeout_millis=timeout_millis)

        if metrics is not None:
            self._receive_metrics(
                metrics,
                timeout_millis=timeout_millis,
            )

    @final
    def _set_collect_callback(
        self,
        func: Callable[
            [
                "opentelemetry.sdk.metrics.export.MetricReader",
                AggregationTemporality,
            ],
            Iterable["opentelemetry.sdk.metrics.export.Metric"],
        ],
    ) -> None:
        """This function is internal to the SDK. It should not be called or overridden by users"""
        self._collect = func

    @abstractmethod
    def _receive_metrics(
        self,
        metrics_data: "opentelemetry.sdk.metrics.export.MetricsData",
        timeout_millis: float = 10_000,
        **kwargs,
    ) -> None:
        """Called by `MetricReader.collect` when it receives a batch of metrics"""

    def force_flush(self, timeout_millis: float = 10_000) -> bool:
        self.collect(timeout_millis=timeout_millis)
        return True

    @abstractmethod
    def shutdown(self, timeout_millis: float = 30_000, **kwargs) -> None:
        """Shuts down the MetricReader. This method provides a way
        for the MetricReader to do any cleanup required. A metric reader can
        only be shutdown once, any subsequent calls are ignored and return
        failure status.

        When a `MetricReader` is registered on a
        :class:`~opentelemetry.sdk.metrics.MeterProvider`,
        :meth:`~opentelemetry.sdk.metrics.MeterProvider.shutdown` will invoke this
        automatically.
        """


class InMemoryMetricReader(MetricReader):
    """Implementation of `MetricReader` that returns its metrics from :func:`get_metrics_data`.

    This is useful for e.g. unit tests.
    """

    def __init__(
        self,
        preferred_temporality: dict[type, AggregationTemporality]
        | None = None,
        preferred_aggregation: dict[
            type, "opentelemetry.sdk.metrics.view.Aggregation"
        ]
        | None = None,
    ) -> None:
        super().__init__(
            preferred_temporality=preferred_temporality,
            preferred_aggregation=preferred_aggregation,
        )
        self._lock = RLock()
        self._metrics_data: "opentelemetry.sdk.metrics.export.MetricsData" = (
            None
        )

    def get_metrics_data(
        self,
    ) -> Optional["opentelemetry.sdk.metrics.export.MetricsData"]:
        """Reads and returns current metrics from the SDK"""
        with self._lock:
            self.collect()
            metrics_data = self._metrics_data
            self._metrics_data = None
        return metrics_data

    def _receive_metrics(
        self,
        metrics_data: "opentelemetry.sdk.metrics.export.MetricsData",
        timeout_millis: float = 10_000,
        **kwargs,
    ) -> None:
        with self._lock:
            self._metrics_data = metrics_data

    def shutdown(self, timeout_millis: float = 30_000, **kwargs) -> None:
        pass


class PeriodicExportingMetricReader(MetricReader):
    """`PeriodicExportingMetricReader` is an implementation of `MetricReader`
    that collects metrics based on a user-configurable time interval, and passes the
    metrics to the configured exporter. If the time interval is set to `math.inf`, the
    reader will not invoke periodic collection.

    The configured exporter's :py:meth:`~MetricExporter.export` method will not be called
    concurrently.
    """

    def __init__(
        self,
        exporter: MetricExporter,
        export_interval_millis: Optional[float] = None,
        export_timeout_millis: Optional[float] = None,
    ) -> None:
        # PeriodicExportingMetricReader defers to exporter for configuration
        super().__init__(
            preferred_temporality=exporter._preferred_temporality,
            preferred_aggregation=exporter._preferred_aggregation,
        )

        # This lock is held whenever calling self._exporter.export() to prevent concurrent
        # execution of MetricExporter.export()
        # https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#exportbatch
        self._export_lock = Lock()

        self._exporter = exporter
        if export_interval_millis is None:
            try:
                export_interval_millis = float(
                    environ.get(OTEL_METRIC_EXPORT_INTERVAL, 60000)
                )
            except ValueError:
                _logger.warning(
                    "Found invalid value for export interval, using default"
                )
                export_interval_millis = 60000
        if export_timeout_millis is None:
            try:
                export_timeout_millis = float(
                    environ.get(OTEL_METRIC_EXPORT_TIMEOUT, 30000)
                )
            except ValueError:
                _logger.warning(
                    "Found invalid value for export timeout, using default"
                )
                export_timeout_millis = 30000
        self._export_interval_millis = export_interval_millis
        self._export_timeout_millis = export_timeout_millis
        self._shutdown = False
        self._shutdown_event = Event()
        self._shutdown_once = Once()
        self._daemon_thread = None
        if (
            self._export_interval_millis > 0
            and self._export_interval_millis < math.inf
        ):
            self._daemon_thread = Thread(
                name="OtelPeriodicExportingMetricReader",
                target=self._ticker,
                daemon=True,
            )
            self._daemon_thread.start()
            if hasattr(os, "register_at_fork"):
                weak_at_fork = weakref.WeakMethod(self._at_fork_reinit)

                os.register_at_fork(
                    after_in_child=lambda: weak_at_fork()()  # pylint: disable=unnecessary-lambda
                )
        elif self._export_interval_millis <= 0:
            raise ValueError(
                f"interval value {self._export_interval_millis} is invalid \
                and needs to be larger than zero."
            )

    def _at_fork_reinit(self):
        self._daemon_thread = Thread(
            name="OtelPeriodicExportingMetricReader",
            target=self._ticker,
            daemon=True,
        )
        self._daemon_thread.start()

    def _ticker(self) -> None:
        interval_secs = self._export_interval_millis / 1e3
        while not self._shutdown_event.wait(interval_secs):
            try:
                self.collect(timeout_millis=self._export_timeout_millis)
            except MetricsTimeoutError:
                _logger.warning(
                    "Metric collection timed out. Will try again after %s seconds",
                    interval_secs,
                    exc_info=True,
                )
        # one last collection below before shutting down completely
        try:
            self.collect(timeout_millis=self._export_interval_millis)
        except MetricsTimeoutError:
            _logger.warning(
                "Metric collection timed out.",
                exc_info=True,
            )

    def _receive_metrics(
        self,
        metrics_data: MetricsData,
        timeout_millis: float = 10_000,
        **kwargs,
    ) -> None:
        token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
        # pylint: disable=broad-exception-caught,invalid-name
        try:
            with self._export_lock:
                self._exporter.export(
                    metrics_data, timeout_millis=timeout_millis
                )
        except Exception:
            _logger.exception("Exception while exporting metrics")
        detach(token)

    def shutdown(self, timeout_millis: float = 30_000, **kwargs) -> None:
        deadline_ns = time_ns() + timeout_millis * 10**6

        def _shutdown():
            self._shutdown = True

        did_set = self._shutdown_once.do_once(_shutdown)
        if not did_set:
            _logger.warning("Can't shutdown multiple times")
            return

        self._shutdown_event.set()
        if self._daemon_thread:
            self._daemon_thread.join(timeout=(deadline_ns - time_ns()) / 10**9)
        self._exporter.shutdown(timeout=(deadline_ns - time_ns()) / 10**6)

    def force_flush(self, timeout_millis: float = 10_000) -> bool:
        super().force_flush(timeout_millis=timeout_millis)
        self._exporter.force_flush(timeout_millis=timeout_millis)
        return True
