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


from fnmatch import fnmatch
from logging import getLogger
from typing import Callable, Optional, Set, Type

from opentelemetry.metrics import Instrument
from opentelemetry.sdk.metrics._internal.aggregation import (
    Aggregation,
    DefaultAggregation,
    _Aggregation,
    _ExplicitBucketHistogramAggregation,
    _ExponentialBucketHistogramAggregation,
)
from opentelemetry.sdk.metrics._internal.exemplar import (
    AlignedHistogramBucketExemplarReservoir,
    ExemplarReservoirBuilder,
    SimpleFixedSizeExemplarReservoir,
)

_logger = getLogger(__name__)


def _default_reservoir_factory(
    aggregation_type: Type[_Aggregation],
) -> ExemplarReservoirBuilder:
    """Default reservoir factory per aggregation."""
    if issubclass(aggregation_type, _ExplicitBucketHistogramAggregation):
        return AlignedHistogramBucketExemplarReservoir
    if issubclass(aggregation_type, _ExponentialBucketHistogramAggregation):
        return SimpleFixedSizeExemplarReservoir
    return SimpleFixedSizeExemplarReservoir


class View:
    """
    A `View` configuration parameters can be used for the following
    purposes:

    1. Match instruments: When an instrument matches a view, measurements
       received by that instrument will be processed.
    2. Customize metric streams: A metric stream is identified by a match
       between a view and an instrument and a set of attributes. The metric
       stream can be customized by certain attributes of the corresponding view.

    The attributes documented next serve one of the previous two purposes.

    Args:
        instrument_type: This is an instrument matching attribute: the class the
            instrument must be to match the view.

        instrument_name: This is an instrument matching attribute: the name the
            instrument must have to match the view. Wild card characters are supported. Wild
            card characters should not be used with this attribute if the view has also a
            ``name`` defined.

        meter_name: This is an instrument matching attribute: the name the
            instrument meter must have to match the view.

        meter_version: This is an instrument matching attribute: the version
            the instrument meter must have to match the view.

        meter_schema_url: This is an instrument matching attribute: the schema
            URL the instrument meter must have to match the view.

        name: This is a metric stream customizing attribute: the name of the
            metric stream. If `None`, the name of the instrument will be used.

        description: This is a metric stream customizing attribute: the
            description of the metric stream. If `None`, the description of the instrument will
            be used.

        attribute_keys: This is a metric stream customizing attribute: this is
            a set of attribute keys. If not `None` then only the measurement attributes that
            are in ``attribute_keys`` will be used to identify the metric stream.

        aggregation: This is a metric stream customizing attribute: the
            aggregation instance to use when data is aggregated for the
            corresponding metrics stream. If `None` an instance of
            `DefaultAggregation` will be used.

        exemplar_reservoir_factory: This is a metric stream customizing attribute:
            the exemplar reservoir factory

        instrument_unit: This is an instrument matching attribute: the unit the
            instrument must have to match the view.

    This class is not intended to be subclassed by the user.
    """

    _default_aggregation = DefaultAggregation()

    def __init__(
        self,
        instrument_type: Optional[Type[Instrument]] = None,
        instrument_name: Optional[str] = None,
        meter_name: Optional[str] = None,
        meter_version: Optional[str] = None,
        meter_schema_url: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        attribute_keys: Optional[Set[str]] = None,
        aggregation: Optional[Aggregation] = None,
        exemplar_reservoir_factory: Optional[
            Callable[[Type[_Aggregation]], ExemplarReservoirBuilder]
        ] = None,
        instrument_unit: Optional[str] = None,
    ):
        if (
            instrument_type
            is instrument_name
            is instrument_unit
            is meter_name
            is meter_version
            is meter_schema_url
            is None
        ):
            # pylint: disable=broad-exception-raised
            raise Exception(
                "Some instrument selection "
                f"criteria must be provided for View {name}"
            )

        if (
            name is not None
            and instrument_name is not None
            and ("*" in instrument_name or "?" in instrument_name)
        ):
            # pylint: disable=broad-exception-raised
            raise Exception(
                f"View {name} declared with wildcard "
                "characters in instrument_name"
            )

        # _name, _description, _aggregation, _exemplar_reservoir_factory and
        # _attribute_keys will be accessed when instantiating a _ViewInstrumentMatch.
        self._name = name
        self._instrument_type = instrument_type
        self._instrument_name = instrument_name
        self._instrument_unit = instrument_unit
        self._meter_name = meter_name
        self._meter_version = meter_version
        self._meter_schema_url = meter_schema_url

        self._description = description
        self._attribute_keys = attribute_keys
        self._aggregation = aggregation or self._default_aggregation
        self._exemplar_reservoir_factory = (
            exemplar_reservoir_factory or _default_reservoir_factory
        )

    # pylint: disable=too-many-return-statements
    # pylint: disable=too-many-branches
    def _match(self, instrument: Instrument) -> bool:
        if self._instrument_type is not None:
            if not isinstance(instrument, self._instrument_type):
                return False

        if self._instrument_name is not None:
            if not fnmatch(instrument.name, self._instrument_name):
                return False

        if self._instrument_unit is not None:
            if not fnmatch(instrument.unit, self._instrument_unit):
                return False

        if self._meter_name is not None:
            if instrument.instrumentation_scope.name != self._meter_name:
                return False

        if self._meter_version is not None:
            if instrument.instrumentation_scope.version != self._meter_version:
                return False

        if self._meter_schema_url is not None:
            if (
                instrument.instrumentation_scope.schema_url
                != self._meter_schema_url
            ):
                return False

        return True
