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

from logging import getLogger
from threading import RLock
from time import time_ns
from typing import Dict, List, Optional

from opentelemetry.metrics import (
    Asynchronous,
    Counter,
    Instrument,
    ObservableCounter,
)
from opentelemetry.sdk.metrics._internal._view_instrument_match import (
    _ViewInstrumentMatch,
)
from opentelemetry.sdk.metrics._internal.aggregation import (
    Aggregation,
    ExplicitBucketHistogramAggregation,
    _DropAggregation,
    _ExplicitBucketHistogramAggregation,
    _ExponentialBucketHistogramAggregation,
    _LastValueAggregation,
    _SumAggregation,
)
from opentelemetry.sdk.metrics._internal.export import AggregationTemporality
from opentelemetry.sdk.metrics._internal.measurement import Measurement
from opentelemetry.sdk.metrics._internal.point import (
    ExponentialHistogram,
    Gauge,
    Histogram,
    Metric,
    MetricsData,
    ResourceMetrics,
    ScopeMetrics,
    Sum,
)
from opentelemetry.sdk.metrics._internal.sdk_configuration import (
    SdkConfiguration,
)
from opentelemetry.sdk.metrics._internal.view import View
from opentelemetry.sdk.util.instrumentation import InstrumentationScope

_logger = getLogger(__name__)

_DEFAULT_VIEW = View(instrument_name="")


class MetricReaderStorage:
    """The SDK's storage for a given reader"""

    def __init__(
        self,
        sdk_config: SdkConfiguration,
        instrument_class_temporality: Dict[type, AggregationTemporality],
        instrument_class_aggregation: Dict[type, Aggregation],
    ) -> None:
        self._lock = RLock()
        self._sdk_config = sdk_config
        self._instrument_view_instrument_matches: Dict[
            Instrument, List[_ViewInstrumentMatch]
        ] = {}
        self._instrument_class_temporality = instrument_class_temporality
        self._instrument_class_aggregation = instrument_class_aggregation

    def _get_or_init_view_instrument_match(
        self, instrument: Instrument
    ) -> List[_ViewInstrumentMatch]:
        # Optimistically get the relevant views for the given instrument. Once set for a given
        # instrument, the mapping will never change

        if instrument in self._instrument_view_instrument_matches:
            return self._instrument_view_instrument_matches[instrument]

        with self._lock:
            # double check if it was set before we held the lock
            if instrument in self._instrument_view_instrument_matches:
                return self._instrument_view_instrument_matches[instrument]

            # not present, hold the lock and add a new mapping
            view_instrument_matches = []

            self._handle_view_instrument_match(
                instrument, view_instrument_matches
            )

            # if no view targeted the instrument, use the default
            if not view_instrument_matches:
                view_instrument_matches.append(
                    _ViewInstrumentMatch(
                        view=_DEFAULT_VIEW,
                        instrument=instrument,
                        instrument_class_aggregation=(
                            self._instrument_class_aggregation
                        ),
                    )
                )
            self._instrument_view_instrument_matches[instrument] = (
                view_instrument_matches
            )

            return view_instrument_matches

    def consume_measurement(
        self, measurement: Measurement, should_sample_exemplar: bool = True
    ) -> None:
        for view_instrument_match in self._get_or_init_view_instrument_match(
            measurement.instrument
        ):
            view_instrument_match.consume_measurement(
                measurement, should_sample_exemplar
            )

    def collect(self) -> Optional[MetricsData]:
        # Use a list instead of yielding to prevent a slow reader from holding
        # SDK locks

        # While holding the lock, new _ViewInstrumentMatch can't be added from
        # another thread (so we are sure we collect all existing view).
        # However, instruments can still send measurements that will make it
        # into the individual aggregations; collection will acquire those locks
        # iteratively to keep locking as fine-grained as possible. One side
        # effect is that end times can be slightly skewed among the metric
        # streams produced by the SDK, but we still align the output timestamps
        # for a single instrument.

        collection_start_nanos = time_ns()

        with self._lock:
            instrumentation_scope_scope_metrics: Dict[
                InstrumentationScope, ScopeMetrics
            ] = {}

            for (
                instrument,
                view_instrument_matches,
            ) in self._instrument_view_instrument_matches.items():
                aggregation_temporality = self._instrument_class_temporality[
                    instrument.__class__
                ]

                metrics: List[Metric] = []

                for view_instrument_match in view_instrument_matches:
                    data_points = view_instrument_match.collect(
                        aggregation_temporality, collection_start_nanos
                    )

                    if data_points is None:
                        continue

                    if isinstance(
                        # pylint: disable=protected-access
                        view_instrument_match._aggregation,
                        _SumAggregation,
                    ):
                        data = Sum(
                            aggregation_temporality=aggregation_temporality,
                            data_points=data_points,
                            is_monotonic=isinstance(
                                instrument, (Counter, ObservableCounter)
                            ),
                        )
                    elif isinstance(
                        # pylint: disable=protected-access
                        view_instrument_match._aggregation,
                        _LastValueAggregation,
                    ):
                        data = Gauge(data_points=data_points)
                    elif isinstance(
                        # pylint: disable=protected-access
                        view_instrument_match._aggregation,
                        _ExplicitBucketHistogramAggregation,
                    ):
                        data = Histogram(
                            data_points=data_points,
                            aggregation_temporality=aggregation_temporality,
                        )
                    elif isinstance(
                        # pylint: disable=protected-access
                        view_instrument_match._aggregation,
                        _DropAggregation,
                    ):
                        continue

                    elif isinstance(
                        # pylint: disable=protected-access
                        view_instrument_match._aggregation,
                        _ExponentialBucketHistogramAggregation,
                    ):
                        data = ExponentialHistogram(
                            data_points=data_points,
                            aggregation_temporality=aggregation_temporality,
                        )

                    metrics.append(
                        Metric(
                            # pylint: disable=protected-access
                            # pylint: disable=possibly-used-before-assignment
                            name=view_instrument_match._name,
                            description=view_instrument_match._description,
                            unit=view_instrument_match._instrument.unit,
                            data=data,
                        )
                    )

                if metrics:
                    if instrument.instrumentation_scope not in (
                        instrumentation_scope_scope_metrics
                    ):
                        instrumentation_scope_scope_metrics[
                            instrument.instrumentation_scope
                        ] = ScopeMetrics(
                            scope=instrument.instrumentation_scope,
                            metrics=metrics,
                            schema_url=instrument.instrumentation_scope.schema_url,
                        )
                    else:
                        instrumentation_scope_scope_metrics[
                            instrument.instrumentation_scope
                        ].metrics.extend(metrics)

            if instrumentation_scope_scope_metrics:
                return MetricsData(
                    resource_metrics=[
                        ResourceMetrics(
                            resource=self._sdk_config.resource,
                            scope_metrics=list(
                                instrumentation_scope_scope_metrics.values()
                            ),
                            schema_url=self._sdk_config.resource.schema_url,
                        )
                    ]
                )

            return None

    def _handle_view_instrument_match(
        self,
        instrument: Instrument,
        view_instrument_matches: List["_ViewInstrumentMatch"],
    ) -> None:
        for view in self._sdk_config.views:
            # pylint: disable=protected-access
            if not view._match(instrument):
                continue

            if not self._check_view_instrument_compatibility(view, instrument):
                continue

            new_view_instrument_match = _ViewInstrumentMatch(
                view=view,
                instrument=instrument,
                instrument_class_aggregation=(
                    self._instrument_class_aggregation
                ),
            )

            for (
                existing_view_instrument_matches
            ) in self._instrument_view_instrument_matches.values():
                for (
                    existing_view_instrument_match
                ) in existing_view_instrument_matches:
                    if existing_view_instrument_match.conflicts(
                        new_view_instrument_match
                    ):
                        _logger.warning(
                            "Views %s and %s will cause conflicting "
                            "metrics identities",
                            existing_view_instrument_match._view,
                            new_view_instrument_match._view,
                        )

            view_instrument_matches.append(new_view_instrument_match)

    @staticmethod
    def _check_view_instrument_compatibility(
        view: View, instrument: Instrument
    ) -> bool:
        """
        Checks if a view and an instrument are compatible.

        Returns `true` if they are compatible and a `_ViewInstrumentMatch`
        object should be created, `false` otherwise.
        """

        result = True

        # pylint: disable=protected-access
        if isinstance(instrument, Asynchronous) and isinstance(
            view._aggregation, ExplicitBucketHistogramAggregation
        ):
            _logger.warning(
                "View %s and instrument %s will produce "
                "semantic errors when matched, the view "
                "has not been applied.",
                view,
                instrument,
            )
            result = False

        return result
