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
from threading import Lock
from time import time_ns
from typing import Dict, List, Optional, Sequence

from opentelemetry.metrics import Instrument
from opentelemetry.sdk.metrics._internal.aggregation import (
    Aggregation,
    DefaultAggregation,
    _Aggregation,
    _SumAggregation,
)
from opentelemetry.sdk.metrics._internal.export import AggregationTemporality
from opentelemetry.sdk.metrics._internal.measurement import Measurement
from opentelemetry.sdk.metrics._internal.point import DataPointT
from opentelemetry.sdk.metrics._internal.view import View

_logger = getLogger(__name__)


class _ViewInstrumentMatch:
    def __init__(
        self,
        view: View,
        instrument: Instrument,
        instrument_class_aggregation: Dict[type, Aggregation],
    ):
        self._view = view
        self._instrument = instrument
        self._attributes_aggregation: Dict[frozenset, _Aggregation] = {}
        self._lock = Lock()
        self._instrument_class_aggregation = instrument_class_aggregation
        self._name = self._view._name or self._instrument.name
        self._description = (
            self._view._description or self._instrument.description
        )
        if not isinstance(self._view._aggregation, DefaultAggregation):
            self._aggregation = self._view._aggregation._create_aggregation(
                self._instrument,
                None,
                self._view._exemplar_reservoir_factory,
                0,
            )
        else:
            self._aggregation = self._instrument_class_aggregation[
                self._instrument.__class__
            ]._create_aggregation(
                self._instrument,
                None,
                self._view._exemplar_reservoir_factory,
                0,
            )

    def conflicts(self, other: "_ViewInstrumentMatch") -> bool:
        # pylint: disable=protected-access

        result = (
            self._name == other._name
            and self._instrument.unit == other._instrument.unit
            # The aggregation class is being used here instead of data point
            # type since they are functionally equivalent.
            and self._aggregation.__class__ == other._aggregation.__class__
        )
        if isinstance(self._aggregation, _SumAggregation):
            result = (
                result
                and self._aggregation._instrument_is_monotonic
                == other._aggregation._instrument_is_monotonic
                and self._aggregation._instrument_aggregation_temporality
                == other._aggregation._instrument_aggregation_temporality
            )

        return result

    # pylint: disable=protected-access
    def consume_measurement(
        self, measurement: Measurement, should_sample_exemplar: bool = True
    ) -> None:
        if self._view._attribute_keys is not None:
            attributes = {}

            for key, value in (measurement.attributes or {}).items():
                if key in self._view._attribute_keys:
                    attributes[key] = value
        elif measurement.attributes is not None:
            attributes = measurement.attributes
        else:
            attributes = {}

        aggr_key = frozenset(attributes.items())

        if aggr_key not in self._attributes_aggregation:
            with self._lock:
                if aggr_key not in self._attributes_aggregation:
                    if not isinstance(
                        self._view._aggregation, DefaultAggregation
                    ):
                        aggregation = (
                            self._view._aggregation._create_aggregation(
                                self._instrument,
                                attributes,
                                self._view._exemplar_reservoir_factory,
                                time_ns(),
                            )
                        )
                    else:
                        aggregation = self._instrument_class_aggregation[
                            self._instrument.__class__
                        ]._create_aggregation(
                            self._instrument,
                            attributes,
                            self._view._exemplar_reservoir_factory,
                            time_ns(),
                        )
                    self._attributes_aggregation[aggr_key] = aggregation

        self._attributes_aggregation[aggr_key].aggregate(
            measurement, should_sample_exemplar
        )

    def collect(
        self,
        collection_aggregation_temporality: AggregationTemporality,
        collection_start_nanos: int,
    ) -> Optional[Sequence[DataPointT]]:
        data_points: List[DataPointT] = []
        with self._lock:
            for aggregation in self._attributes_aggregation.values():
                data_point = aggregation.collect(
                    collection_aggregation_temporality, collection_start_nanos
                )
                if data_point is not None:
                    data_points.append(data_point)

        # Returning here None instead of an empty list because the caller
        # does not consume a sequence and to be consistent with the rest of
        # collect methods that also return None.
        return data_points or None
