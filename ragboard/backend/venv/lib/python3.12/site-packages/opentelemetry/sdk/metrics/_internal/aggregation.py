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

# pylint: disable=too-many-lines

from abc import ABC, abstractmethod
from bisect import bisect_left
from enum import IntEnum
from functools import partial
from logging import getLogger
from math import inf
from threading import Lock
from typing import (
    Callable,
    Generic,
    List,
    Optional,
    Sequence,
    Type,
    TypeVar,
)

from opentelemetry.metrics import (
    Asynchronous,
    Counter,
    Histogram,
    Instrument,
    ObservableCounter,
    ObservableGauge,
    ObservableUpDownCounter,
    Synchronous,
    UpDownCounter,
    _Gauge,
)
from opentelemetry.sdk.metrics._internal.exemplar import (
    Exemplar,
    ExemplarReservoirBuilder,
)
from opentelemetry.sdk.metrics._internal.exponential_histogram.buckets import (
    Buckets,
)
from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping import (
    Mapping,
)
from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping.exponent_mapping import (
    ExponentMapping,
)
from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping.logarithm_mapping import (
    LogarithmMapping,
)
from opentelemetry.sdk.metrics._internal.measurement import Measurement
from opentelemetry.sdk.metrics._internal.point import Buckets as BucketsPoint
from opentelemetry.sdk.metrics._internal.point import (
    ExponentialHistogramDataPoint,
    HistogramDataPoint,
    NumberDataPoint,
    Sum,
)
from opentelemetry.sdk.metrics._internal.point import Gauge as GaugePoint
from opentelemetry.sdk.metrics._internal.point import (
    Histogram as HistogramPoint,
)
from opentelemetry.util.types import Attributes

_DataPointVarT = TypeVar("_DataPointVarT", NumberDataPoint, HistogramDataPoint)

_logger = getLogger(__name__)


class AggregationTemporality(IntEnum):
    """
    The temporality to use when aggregating data.

    Can be one of the following values:
    """

    UNSPECIFIED = 0
    DELTA = 1
    CUMULATIVE = 2


class _Aggregation(ABC, Generic[_DataPointVarT]):
    def __init__(
        self,
        attributes: Attributes,
        reservoir_builder: ExemplarReservoirBuilder,
    ):
        self._lock = Lock()
        self._attributes = attributes
        self._reservoir = reservoir_builder()
        self._previous_point = None

    @abstractmethod
    def aggregate(
        self, measurement: Measurement, should_sample_exemplar: bool = True
    ) -> None:
        """Aggregate a measurement.

        Args:
            measurement: Measurement to aggregate
            should_sample_exemplar: Whether the measurement should be sampled by the exemplars reservoir or not.
        """

    @abstractmethod
    def collect(
        self,
        collection_aggregation_temporality: AggregationTemporality,
        collection_start_nano: int,
    ) -> Optional[_DataPointVarT]:
        pass

    def _collect_exemplars(self) -> Sequence[Exemplar]:
        """Returns the collected exemplars.

        Returns:
            The exemplars collected by the reservoir
        """
        return self._reservoir.collect(self._attributes)

    def _sample_exemplar(
        self, measurement: Measurement, should_sample_exemplar: bool
    ) -> None:
        """Offer the measurement to the exemplar reservoir for sampling.

        It should be called within the each :ref:`aggregate` call.

        Args:
            measurement: The new measurement
            should_sample_exemplar: Whether the measurement should be sampled by the exemplars reservoir or not.
        """
        if should_sample_exemplar:
            self._reservoir.offer(
                measurement.value,
                measurement.time_unix_nano,
                measurement.attributes,
                measurement.context,
            )


class _DropAggregation(_Aggregation):
    def aggregate(
        self, measurement: Measurement, should_sample_exemplar: bool = True
    ) -> None:
        pass

    def collect(
        self,
        collection_aggregation_temporality: AggregationTemporality,
        collection_start_nano: int,
    ) -> Optional[_DataPointVarT]:
        pass


class _SumAggregation(_Aggregation[Sum]):
    def __init__(
        self,
        attributes: Attributes,
        instrument_is_monotonic: bool,
        instrument_aggregation_temporality: AggregationTemporality,
        start_time_unix_nano: int,
        reservoir_builder: ExemplarReservoirBuilder,
    ):
        super().__init__(attributes, reservoir_builder)

        self._start_time_unix_nano = start_time_unix_nano
        self._instrument_aggregation_temporality = (
            instrument_aggregation_temporality
        )
        self._instrument_is_monotonic = instrument_is_monotonic

        self._value = None

        self._previous_collection_start_nano = self._start_time_unix_nano
        self._previous_value = 0

    def aggregate(
        self, measurement: Measurement, should_sample_exemplar: bool = True
    ) -> None:
        with self._lock:
            if self._value is None:
                self._value = 0

            self._value = self._value + measurement.value

        self._sample_exemplar(measurement, should_sample_exemplar)

    def collect(
        self,
        collection_aggregation_temporality: AggregationTemporality,
        collection_start_nano: int,
    ) -> Optional[NumberDataPoint]:
        """
        Atomically return a point for the current value of the metric and
        reset the aggregation value.

        Synchronous instruments have a method which is called directly with
        increments for a given quantity:

        For example, an instrument that counts the amount of passengers in
        every vehicle that crosses a certain point in a highway:

        synchronous_instrument.add(2)
        collect(...)  # 2 passengers are counted
        synchronous_instrument.add(3)
        collect(...)  # 3 passengers are counted
        synchronous_instrument.add(1)
        collect(...)  # 1 passenger is counted

        In this case the instrument aggregation temporality is DELTA because
        every value represents an increment to the count,

        Asynchronous instruments have a callback which returns the total value
        of a given quantity:

        For example, an instrument that measures the amount of bytes written to
        a certain hard drive:

        callback() -> 1352
        collect(...) # 1352 bytes have been written so far
        callback() -> 2324
        collect(...) # 2324 bytes have been written so far
        callback() -> 4542
        collect(...) # 4542 bytes have been written so far

        In this case the instrument aggregation temporality is CUMULATIVE
        because every value represents the total of the measurement.

        There is also the collection aggregation temporality, which is passed
        to this method. The collection aggregation temporality defines the
        nature of the returned value by this aggregation.

        When the collection aggregation temporality matches the
        instrument aggregation temporality, then this method returns the
        current value directly:

        synchronous_instrument.add(2)
        collect(DELTA) -> 2
        synchronous_instrument.add(3)
        collect(DELTA) -> 3
        synchronous_instrument.add(1)
        collect(DELTA) -> 1

        callback() -> 1352
        collect(CUMULATIVE) -> 1352
        callback() -> 2324
        collect(CUMULATIVE) -> 2324
        callback() -> 4542
        collect(CUMULATIVE) -> 4542

        When the collection aggregation temporality does not match the
        instrument aggregation temporality, then a conversion is made. For this
        purpose, this aggregation keeps a private attribute,
        self._previous_value.

        When the instrument is synchronous:

        self._previous_value is the sum of every previously
        collected (delta) value. In this case, the returned (cumulative) value
        will be:

        self._previous_value + value

        synchronous_instrument.add(2)
        collect(CUMULATIVE) -> 2
        synchronous_instrument.add(3)
        collect(CUMULATIVE) -> 5
        synchronous_instrument.add(1)
        collect(CUMULATIVE) -> 6

        Also, as a diagram:

        time ->

        self._previous_value
        |-------------|

        value (delta)
                      |----|

        returned value (cumulative)
        |------------------|

        When the instrument is asynchronous:

        self._previous_value is the value of the previously
        collected (cumulative) value. In this case, the returned (delta) value
        will be:

        value - self._previous_value

        callback() -> 1352
        collect(DELTA) -> 1352
        callback() -> 2324
        collect(DELTA) -> 972
        callback() -> 4542
        collect(DELTA) -> 2218

        Also, as a diagram:

        time ->

        self._previous_value
        |-------------|

        value (cumulative)
        |------------------|

        returned value (delta)
                      |----|
        """

        with self._lock:
            value = self._value
            self._value = None

            if (
                self._instrument_aggregation_temporality
                is AggregationTemporality.DELTA
            ):
                # This happens when the corresponding instrument for this
                # aggregation is synchronous.
                if (
                    collection_aggregation_temporality
                    is AggregationTemporality.DELTA
                ):
                    previous_collection_start_nano = (
                        self._previous_collection_start_nano
                    )
                    self._previous_collection_start_nano = (
                        collection_start_nano
                    )

                    if value is None:
                        return None

                    return NumberDataPoint(
                        attributes=self._attributes,
                        exemplars=self._collect_exemplars(),
                        start_time_unix_nano=previous_collection_start_nano,
                        time_unix_nano=collection_start_nano,
                        value=value,
                    )

                if value is None:
                    value = 0

                self._previous_value = value + self._previous_value

                return NumberDataPoint(
                    attributes=self._attributes,
                    exemplars=self._collect_exemplars(),
                    start_time_unix_nano=self._start_time_unix_nano,
                    time_unix_nano=collection_start_nano,
                    value=self._previous_value,
                )

            # This happens when the corresponding instrument for this
            # aggregation is asynchronous.

            if value is None:
                # This happens when the corresponding instrument callback
                # does not produce measurements.
                return None

            if (
                collection_aggregation_temporality
                is AggregationTemporality.DELTA
            ):
                result_value = value - self._previous_value

                self._previous_value = value

                previous_collection_start_nano = (
                    self._previous_collection_start_nano
                )
                self._previous_collection_start_nano = collection_start_nano

                return NumberDataPoint(
                    attributes=self._attributes,
                    exemplars=self._collect_exemplars(),
                    start_time_unix_nano=previous_collection_start_nano,
                    time_unix_nano=collection_start_nano,
                    value=result_value,
                )

            return NumberDataPoint(
                attributes=self._attributes,
                exemplars=self._collect_exemplars(),
                start_time_unix_nano=self._start_time_unix_nano,
                time_unix_nano=collection_start_nano,
                value=value,
            )


class _LastValueAggregation(_Aggregation[GaugePoint]):
    def __init__(
        self,
        attributes: Attributes,
        reservoir_builder: ExemplarReservoirBuilder,
    ):
        super().__init__(attributes, reservoir_builder)
        self._value = None

    def aggregate(
        self, measurement: Measurement, should_sample_exemplar: bool = True
    ):
        with self._lock:
            self._value = measurement.value

        self._sample_exemplar(measurement, should_sample_exemplar)

    def collect(
        self,
        collection_aggregation_temporality: AggregationTemporality,
        collection_start_nano: int,
    ) -> Optional[_DataPointVarT]:
        """
        Atomically return a point for the current value of the metric.
        """
        with self._lock:
            if self._value is None:
                return None
            value = self._value
            self._value = None

        exemplars = self._collect_exemplars()

        return NumberDataPoint(
            attributes=self._attributes,
            exemplars=exemplars,
            start_time_unix_nano=None,
            time_unix_nano=collection_start_nano,
            value=value,
        )


_DEFAULT_EXPLICIT_BUCKET_HISTOGRAM_AGGREGATION_BOUNDARIES: Sequence[float] = (
    0.0,
    5.0,
    10.0,
    25.0,
    50.0,
    75.0,
    100.0,
    250.0,
    500.0,
    750.0,
    1000.0,
    2500.0,
    5000.0,
    7500.0,
    10000.0,
)


class _ExplicitBucketHistogramAggregation(_Aggregation[HistogramPoint]):
    def __init__(
        self,
        attributes: Attributes,
        instrument_aggregation_temporality: AggregationTemporality,
        start_time_unix_nano: int,
        reservoir_builder: ExemplarReservoirBuilder,
        boundaries: Optional[Sequence[float]] = None,
        record_min_max: bool = True,
    ):
        if boundaries is None:
            boundaries = (
                _DEFAULT_EXPLICIT_BUCKET_HISTOGRAM_AGGREGATION_BOUNDARIES
            )
        super().__init__(
            attributes,
            reservoir_builder=partial(
                reservoir_builder, boundaries=boundaries
            ),
        )

        self._instrument_aggregation_temporality = (
            instrument_aggregation_temporality
        )
        self._start_time_unix_nano = start_time_unix_nano
        self._boundaries = tuple(boundaries)
        self._record_min_max = record_min_max

        self._value = None
        self._min = inf
        self._max = -inf
        self._sum = 0

        self._previous_value = None
        self._previous_min = inf
        self._previous_max = -inf
        self._previous_sum = 0

        self._previous_collection_start_nano = self._start_time_unix_nano

    def _get_empty_bucket_counts(self) -> List[int]:
        return [0] * (len(self._boundaries) + 1)

    def aggregate(
        self, measurement: Measurement, should_sample_exemplar: bool = True
    ) -> None:
        with self._lock:
            if self._value is None:
                self._value = self._get_empty_bucket_counts()

            measurement_value = measurement.value

            self._sum += measurement_value

            if self._record_min_max:
                self._min = min(self._min, measurement_value)
                self._max = max(self._max, measurement_value)

            self._value[bisect_left(self._boundaries, measurement_value)] += 1

        self._sample_exemplar(measurement, should_sample_exemplar)

    def collect(
        self,
        collection_aggregation_temporality: AggregationTemporality,
        collection_start_nano: int,
    ) -> Optional[_DataPointVarT]:
        """
        Atomically return a point for the current value of the metric.
        """

        with self._lock:
            value = self._value
            sum_ = self._sum
            min_ = self._min
            max_ = self._max

            self._value = None
            self._sum = 0
            self._min = inf
            self._max = -inf

            if (
                self._instrument_aggregation_temporality
                is AggregationTemporality.DELTA
            ):
                # This happens when the corresponding instrument for this
                # aggregation is synchronous.
                if (
                    collection_aggregation_temporality
                    is AggregationTemporality.DELTA
                ):
                    previous_collection_start_nano = (
                        self._previous_collection_start_nano
                    )
                    self._previous_collection_start_nano = (
                        collection_start_nano
                    )

                    if value is None:
                        return None

                    return HistogramDataPoint(
                        attributes=self._attributes,
                        exemplars=self._collect_exemplars(),
                        start_time_unix_nano=previous_collection_start_nano,
                        time_unix_nano=collection_start_nano,
                        count=sum(value),
                        sum=sum_,
                        bucket_counts=tuple(value),
                        explicit_bounds=self._boundaries,
                        min=min_,
                        max=max_,
                    )

                if value is None:
                    value = self._get_empty_bucket_counts()

                if self._previous_value is None:
                    self._previous_value = self._get_empty_bucket_counts()

                self._previous_value = [
                    value_element + previous_value_element
                    for (
                        value_element,
                        previous_value_element,
                    ) in zip(value, self._previous_value)
                ]
                self._previous_min = min(min_, self._previous_min)
                self._previous_max = max(max_, self._previous_max)
                self._previous_sum = sum_ + self._previous_sum

                return HistogramDataPoint(
                    attributes=self._attributes,
                    exemplars=self._collect_exemplars(),
                    start_time_unix_nano=self._start_time_unix_nano,
                    time_unix_nano=collection_start_nano,
                    count=sum(self._previous_value),
                    sum=self._previous_sum,
                    bucket_counts=tuple(self._previous_value),
                    explicit_bounds=self._boundaries,
                    min=self._previous_min,
                    max=self._previous_max,
                )

            return None


# pylint: disable=protected-access
class _ExponentialBucketHistogramAggregation(_Aggregation[HistogramPoint]):
    # _min_max_size and _max_max_size are the smallest and largest values
    # the max_size parameter may have, respectively.

    # _min_max_size is is the smallest reasonable value which is small enough
    # to contain the entire normal floating point range at the minimum scale.
    _min_max_size = 2

    # _max_max_size is an arbitrary limit meant to limit accidental creation of
    # giant exponential bucket histograms.
    _max_max_size = 16384

    def __init__(
        self,
        attributes: Attributes,
        reservoir_builder: ExemplarReservoirBuilder,
        instrument_aggregation_temporality: AggregationTemporality,
        start_time_unix_nano: int,
        # This is the default maximum number of buckets per positive or
        # negative number range.  The value 160 is specified by OpenTelemetry.
        # See the derivation here:
        # https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#exponential-bucket-histogram-aggregation)
        max_size: int = 160,
        max_scale: int = 20,
    ):
        # max_size is the maximum capacity of the positive and negative
        # buckets.
        # _sum is the sum of all the values aggregated by this aggregator.
        # _count is the count of all calls to aggregate.
        # _zero_count is the count of all the calls to aggregate when the value
        # to be aggregated is exactly 0.
        # _min is the smallest value aggregated by this aggregator.
        # _max is the smallest value aggregated by this aggregator.
        # _positive holds the positive values.
        # _negative holds the negative values by their absolute value.
        if max_size < self._min_max_size:
            raise ValueError(
                f"Buckets max size {max_size} is smaller than "
                "minimum max size {self._min_max_size}"
            )

        if max_size > self._max_max_size:
            raise ValueError(
                f"Buckets max size {max_size} is larger than "
                "maximum max size {self._max_max_size}"
            )
        if max_scale > 20:
            _logger.warning(
                "max_scale is set to %s which is "
                "larger than the recommended value of 20",
                max_scale,
            )

        # This aggregation is analogous to _ExplicitBucketHistogramAggregation,
        # the only difference is that with every call to aggregate, the size
        # and amount of buckets can change (in
        # _ExplicitBucketHistogramAggregation both size and amount of buckets
        # remain constant once it is instantiated).

        super().__init__(
            attributes,
            reservoir_builder=partial(
                reservoir_builder, size=min(20, max_size)
            ),
        )

        self._instrument_aggregation_temporality = (
            instrument_aggregation_temporality
        )
        self._start_time_unix_nano = start_time_unix_nano
        self._max_size = max_size
        self._max_scale = max_scale

        self._value_positive = None
        self._value_negative = None
        self._min = inf
        self._max = -inf
        self._sum = 0
        self._count = 0
        self._zero_count = 0
        self._scale = None

        self._previous_value_positive = None
        self._previous_value_negative = None
        self._previous_min = inf
        self._previous_max = -inf
        self._previous_sum = 0
        self._previous_count = 0
        self._previous_zero_count = 0
        self._previous_scale = None

        self._previous_collection_start_nano = self._start_time_unix_nano

        self._mapping = self._new_mapping(self._max_scale)

    def aggregate(
        self, measurement: Measurement, should_sample_exemplar: bool = True
    ) -> None:
        # pylint: disable=too-many-branches,too-many-statements, too-many-locals

        with self._lock:
            if self._value_positive is None:
                self._value_positive = Buckets()
            if self._value_negative is None:
                self._value_negative = Buckets()

            measurement_value = measurement.value

            self._sum += measurement_value

            self._min = min(self._min, measurement_value)
            self._max = max(self._max, measurement_value)

            self._count += 1

            if measurement_value == 0:
                self._zero_count += 1

                if self._count == self._zero_count:
                    self._scale = 0

                return

            if measurement_value > 0:
                value = self._value_positive

            else:
                measurement_value = -measurement_value
                value = self._value_negative

            # The following code finds out if it is necessary to change the
            # buckets to hold the incoming measurement_value, changes them if
            # necessary. This process does not exist in
            # _ExplicitBucketHistogram aggregation because the buckets there
            # are constant in size and amount.
            index = self._mapping.map_to_index(measurement_value)

            is_rescaling_needed = False
            low, high = 0, 0

            if len(value) == 0:
                value.index_start = index
                value.index_end = index
                value.index_base = index

            elif (
                index < value.index_start
                and (value.index_end - index) >= self._max_size
            ):
                is_rescaling_needed = True
                low = index
                high = value.index_end

            elif (
                index > value.index_end
                and (index - value.index_start) >= self._max_size
            ):
                is_rescaling_needed = True
                low = value.index_start
                high = index

            if is_rescaling_needed:
                scale_change = self._get_scale_change(low, high)
                self._downscale(
                    scale_change,
                    self._value_positive,
                    self._value_negative,
                )
                self._mapping = self._new_mapping(
                    self._mapping.scale - scale_change
                )

                index = self._mapping.map_to_index(measurement_value)

            self._scale = self._mapping.scale

            if index < value.index_start:
                span = value.index_end - index

                if span >= len(value.counts):
                    value.grow(span + 1, self._max_size)

                value.index_start = index

            elif index > value.index_end:
                span = index - value.index_start

                if span >= len(value.counts):
                    value.grow(span + 1, self._max_size)

                value.index_end = index

            bucket_index = index - value.index_base

            if bucket_index < 0:
                bucket_index += len(value.counts)

            # Now the buckets have been changed if needed and bucket_index will
            # be used to increment the counter of the bucket that needs to be
            # incremented.

            # This is analogous to
            # self._value[bisect_left(self._boundaries, measurement_value)] += 1
            # in _ExplicitBucketHistogramAggregation.aggregate
            value.increment_bucket(bucket_index)

        self._sample_exemplar(measurement, should_sample_exemplar)

    def collect(
        self,
        collection_aggregation_temporality: AggregationTemporality,
        collection_start_nano: int,
    ) -> Optional[_DataPointVarT]:
        """
        Atomically return a point for the current value of the metric.
        """

        # pylint: disable=too-many-statements, too-many-locals
        with self._lock:
            value_positive = self._value_positive
            value_negative = self._value_negative
            sum_ = self._sum
            min_ = self._min
            max_ = self._max
            count = self._count
            zero_count = self._zero_count
            scale = self._scale

            self._value_positive = None
            self._value_negative = None
            self._sum = 0
            self._min = inf
            self._max = -inf
            self._count = 0
            self._zero_count = 0
            self._scale = None

            if (
                self._instrument_aggregation_temporality
                is AggregationTemporality.DELTA
            ):
                # This happens when the corresponding instrument for this
                # aggregation is synchronous.
                if (
                    collection_aggregation_temporality
                    is AggregationTemporality.DELTA
                ):
                    previous_collection_start_nano = (
                        self._previous_collection_start_nano
                    )
                    self._previous_collection_start_nano = (
                        collection_start_nano
                    )

                    if value_positive is None and value_negative is None:
                        return None

                    return ExponentialHistogramDataPoint(
                        attributes=self._attributes,
                        exemplars=self._collect_exemplars(),
                        start_time_unix_nano=previous_collection_start_nano,
                        time_unix_nano=collection_start_nano,
                        count=count,
                        sum=sum_,
                        scale=scale,
                        zero_count=zero_count,
                        positive=BucketsPoint(
                            offset=value_positive.offset,
                            bucket_counts=(value_positive.get_offset_counts()),
                        ),
                        negative=BucketsPoint(
                            offset=value_negative.offset,
                            bucket_counts=(value_negative.get_offset_counts()),
                        ),
                        # FIXME: Find the right value for flags
                        flags=0,
                        min=min_,
                        max=max_,
                    )

                # Here collection_temporality is CUMULATIVE.
                # instrument_temporality is always DELTA for the time being.
                # Here we need to handle the case where:
                # collect is called after at least one other call to collect
                # (there is data in previous buckets, a call to merge is needed
                # to handle possible differences in bucket sizes).
                # collect is called without another call previous call to
                # collect was made (there is no previous buckets, previous,
                # empty buckets that are the same scale of the current buckets
                # need to be made so that they can be cumulatively aggregated
                # to the current buckets).

                if (
                    value_positive is None
                    and self._previous_value_positive is None
                ):
                    # This happens if collect is called for the first time
                    # and aggregate has not yet been called.
                    value_positive = Buckets()
                    self._previous_value_positive = value_positive.copy_empty()
                if (
                    value_negative is None
                    and self._previous_value_negative is None
                ):
                    value_negative = Buckets()
                    self._previous_value_negative = value_negative.copy_empty()
                if scale is None and self._previous_scale is None:
                    scale = self._mapping.scale
                    self._previous_scale = scale

                if (
                    value_positive is not None
                    and self._previous_value_positive is None
                ):
                    # This happens when collect is called the very first time
                    # and aggregate has been called before.

                    # We need previous buckets to add them to the current ones.
                    # When collect is called for the first time, there are no
                    # previous buckets, so we need to create empty buckets to
                    # add them to the current ones. The addition of empty
                    # buckets to the current ones will result in the current
                    # ones unchanged.

                    # The way the previous buckets are generated here is
                    # different from the explicit bucket histogram where
                    # the size and amount of the buckets does not change once
                    # they are instantiated. Here, the size and amount of the
                    # buckets can change with every call to aggregate. In order
                    # to get empty buckets that can be added to the current
                    # ones resulting in the current ones unchanged we need to
                    # generate empty buckets that have the same size and amount
                    # as the current ones, this is what copy_empty does.
                    self._previous_value_positive = value_positive.copy_empty()
                if (
                    value_negative is not None
                    and self._previous_value_negative is None
                ):
                    self._previous_value_negative = value_negative.copy_empty()
                if scale is not None and self._previous_scale is None:
                    self._previous_scale = scale

                if (
                    value_positive is None
                    and self._previous_value_positive is not None
                ):
                    value_positive = self._previous_value_positive.copy_empty()
                if (
                    value_negative is None
                    and self._previous_value_negative is not None
                ):
                    value_negative = self._previous_value_negative.copy_empty()
                if scale is None and self._previous_scale is not None:
                    scale = self._previous_scale

                min_scale = min(self._previous_scale, scale)

                low_positive, high_positive = (
                    self._get_low_high_previous_current(
                        self._previous_value_positive,
                        value_positive,
                        scale,
                        min_scale,
                    )
                )
                low_negative, high_negative = (
                    self._get_low_high_previous_current(
                        self._previous_value_negative,
                        value_negative,
                        scale,
                        min_scale,
                    )
                )

                min_scale = min(
                    min_scale
                    - self._get_scale_change(low_positive, high_positive),
                    min_scale
                    - self._get_scale_change(low_negative, high_negative),
                )

                self._downscale(
                    self._previous_scale - min_scale,
                    self._previous_value_positive,
                    self._previous_value_negative,
                )

                # self._merge adds the values from value to
                # self._previous_value, this is analogous to
                # self._previous_value = [
                #     value_element + previous_value_element
                #     for (
                #         value_element,
                #         previous_value_element,
                #     ) in zip(value, self._previous_value)
                # ]
                # in _ExplicitBucketHistogramAggregation.collect.
                self._merge(
                    self._previous_value_positive,
                    value_positive,
                    scale,
                    min_scale,
                    collection_aggregation_temporality,
                )
                self._merge(
                    self._previous_value_negative,
                    value_negative,
                    scale,
                    min_scale,
                    collection_aggregation_temporality,
                )

                self._previous_min = min(min_, self._previous_min)
                self._previous_max = max(max_, self._previous_max)
                self._previous_sum = sum_ + self._previous_sum
                self._previous_count = count + self._previous_count
                self._previous_zero_count = (
                    zero_count + self._previous_zero_count
                )
                self._previous_scale = min_scale

                return ExponentialHistogramDataPoint(
                    attributes=self._attributes,
                    exemplars=self._collect_exemplars(),
                    start_time_unix_nano=self._start_time_unix_nano,
                    time_unix_nano=collection_start_nano,
                    count=self._previous_count,
                    sum=self._previous_sum,
                    scale=self._previous_scale,
                    zero_count=self._previous_zero_count,
                    positive=BucketsPoint(
                        offset=self._previous_value_positive.offset,
                        bucket_counts=(
                            self._previous_value_positive.get_offset_counts()
                        ),
                    ),
                    negative=BucketsPoint(
                        offset=self._previous_value_negative.offset,
                        bucket_counts=(
                            self._previous_value_negative.get_offset_counts()
                        ),
                    ),
                    # FIXME: Find the right value for flags
                    flags=0,
                    min=self._previous_min,
                    max=self._previous_max,
                )

            return None

    def _get_low_high_previous_current(
        self,
        previous_point_buckets,
        current_point_buckets,
        current_scale,
        min_scale,
    ):
        (previous_point_low, previous_point_high) = self._get_low_high(
            previous_point_buckets, self._previous_scale, min_scale
        )
        (current_point_low, current_point_high) = self._get_low_high(
            current_point_buckets, current_scale, min_scale
        )

        if current_point_low > current_point_high:
            low = previous_point_low
            high = previous_point_high

        elif previous_point_low > previous_point_high:
            low = current_point_low
            high = current_point_high

        else:
            low = min(previous_point_low, current_point_low)
            high = max(previous_point_high, current_point_high)

        return low, high

    @staticmethod
    def _get_low_high(buckets, scale, min_scale):
        if buckets.counts == [0]:
            return 0, -1

        shift = scale - min_scale

        return buckets.index_start >> shift, buckets.index_end >> shift

    @staticmethod
    def _new_mapping(scale: int) -> Mapping:
        if scale <= 0:
            return ExponentMapping(scale)
        return LogarithmMapping(scale)

    def _get_scale_change(self, low, high):
        change = 0

        while high - low >= self._max_size:
            high = high >> 1
            low = low >> 1

            change += 1

        return change

    @staticmethod
    def _downscale(change: int, positive, negative):
        if change == 0:
            return

        if change < 0:
            # pylint: disable=broad-exception-raised
            raise Exception("Invalid change of scale")

        positive.downscale(change)
        negative.downscale(change)

    def _merge(
        self,
        previous_buckets: Buckets,
        current_buckets: Buckets,
        current_scale,
        min_scale,
        aggregation_temporality,
    ):
        current_change = current_scale - min_scale

        for current_bucket_index, current_bucket in enumerate(
            current_buckets.counts
        ):
            if current_bucket == 0:
                continue

            # Not considering the case where len(previous_buckets) == 0. This
            # would not happen because self._previous_point is only assigned to
            # an ExponentialHistogramDataPoint object if self._count != 0.

            current_index = current_buckets.index_base + current_bucket_index
            if current_index > current_buckets.index_end:
                current_index -= len(current_buckets.counts)

            index = current_index >> current_change

            if index < previous_buckets.index_start:
                span = previous_buckets.index_end - index

                if span >= self._max_size:
                    # pylint: disable=broad-exception-raised
                    raise Exception("Incorrect merge scale")

                if span >= len(previous_buckets.counts):
                    previous_buckets.grow(span + 1, self._max_size)

                previous_buckets.index_start = index

            if index > previous_buckets.index_end:
                span = index - previous_buckets.index_start

                if span >= self._max_size:
                    # pylint: disable=broad-exception-raised
                    raise Exception("Incorrect merge scale")

                if span >= len(previous_buckets.counts):
                    previous_buckets.grow(span + 1, self._max_size)

                previous_buckets.index_end = index

            bucket_index = index - previous_buckets.index_base

            if bucket_index < 0:
                bucket_index += len(previous_buckets.counts)

            if aggregation_temporality is AggregationTemporality.DELTA:
                current_bucket = -current_bucket

            previous_buckets.increment_bucket(
                bucket_index, increment=current_bucket
            )


class Aggregation(ABC):
    """
    Base class for all aggregation types.
    """

    @abstractmethod
    def _create_aggregation(
        self,
        instrument: Instrument,
        attributes: Attributes,
        reservoir_factory: Callable[
            [Type[_Aggregation]], ExemplarReservoirBuilder
        ],
        start_time_unix_nano: int,
    ) -> _Aggregation:
        """Creates an aggregation"""


class DefaultAggregation(Aggregation):
    """
    The default aggregation to be used in a `View`.

    This aggregation will create an actual aggregation depending on the
    instrument type, as specified next:

    ==================================================== ====================================
    Instrument                                           Aggregation
    ==================================================== ====================================
    `opentelemetry.sdk.metrics.Counter`                  `SumAggregation`
    `opentelemetry.sdk.metrics.UpDownCounter`            `SumAggregation`
    `opentelemetry.sdk.metrics.ObservableCounter`        `SumAggregation`
    `opentelemetry.sdk.metrics.ObservableUpDownCounter`  `SumAggregation`
    `opentelemetry.sdk.metrics.Histogram`                `ExplicitBucketHistogramAggregation`
    `opentelemetry.sdk.metrics.ObservableGauge`          `LastValueAggregation`
    ==================================================== ====================================
    """

    def _create_aggregation(
        self,
        instrument: Instrument,
        attributes: Attributes,
        reservoir_factory: Callable[
            [Type[_Aggregation]], ExemplarReservoirBuilder
        ],
        start_time_unix_nano: int,
    ) -> _Aggregation:
        # pylint: disable=too-many-return-statements
        if isinstance(instrument, Counter):
            return _SumAggregation(
                attributes,
                reservoir_builder=reservoir_factory(_SumAggregation),
                instrument_is_monotonic=True,
                instrument_aggregation_temporality=(
                    AggregationTemporality.DELTA
                ),
                start_time_unix_nano=start_time_unix_nano,
            )
        if isinstance(instrument, UpDownCounter):
            return _SumAggregation(
                attributes,
                reservoir_builder=reservoir_factory(_SumAggregation),
                instrument_is_monotonic=False,
                instrument_aggregation_temporality=(
                    AggregationTemporality.DELTA
                ),
                start_time_unix_nano=start_time_unix_nano,
            )

        if isinstance(instrument, ObservableCounter):
            return _SumAggregation(
                attributes,
                reservoir_builder=reservoir_factory(_SumAggregation),
                instrument_is_monotonic=True,
                instrument_aggregation_temporality=(
                    AggregationTemporality.CUMULATIVE
                ),
                start_time_unix_nano=start_time_unix_nano,
            )

        if isinstance(instrument, ObservableUpDownCounter):
            return _SumAggregation(
                attributes,
                reservoir_builder=reservoir_factory(_SumAggregation),
                instrument_is_monotonic=False,
                instrument_aggregation_temporality=(
                    AggregationTemporality.CUMULATIVE
                ),
                start_time_unix_nano=start_time_unix_nano,
            )

        if isinstance(instrument, Histogram):
            boundaries = instrument._advisory.explicit_bucket_boundaries
            return _ExplicitBucketHistogramAggregation(
                attributes,
                reservoir_builder=reservoir_factory(
                    _ExplicitBucketHistogramAggregation
                ),
                instrument_aggregation_temporality=(
                    AggregationTemporality.DELTA
                ),
                boundaries=boundaries,
                start_time_unix_nano=start_time_unix_nano,
            )

        if isinstance(instrument, ObservableGauge):
            return _LastValueAggregation(
                attributes,
                reservoir_builder=reservoir_factory(_LastValueAggregation),
            )

        if isinstance(instrument, _Gauge):
            return _LastValueAggregation(
                attributes,
                reservoir_builder=reservoir_factory(_LastValueAggregation),
            )

        # pylint: disable=broad-exception-raised
        raise Exception(f"Invalid instrument type {type(instrument)} found")


class ExponentialBucketHistogramAggregation(Aggregation):
    def __init__(
        self,
        max_size: int = 160,
        max_scale: int = 20,
    ):
        self._max_size = max_size
        self._max_scale = max_scale

    def _create_aggregation(
        self,
        instrument: Instrument,
        attributes: Attributes,
        reservoir_factory: Callable[
            [Type[_Aggregation]], ExemplarReservoirBuilder
        ],
        start_time_unix_nano: int,
    ) -> _Aggregation:
        instrument_aggregation_temporality = AggregationTemporality.UNSPECIFIED
        if isinstance(instrument, Synchronous):
            instrument_aggregation_temporality = AggregationTemporality.DELTA
        elif isinstance(instrument, Asynchronous):
            instrument_aggregation_temporality = (
                AggregationTemporality.CUMULATIVE
            )

        return _ExponentialBucketHistogramAggregation(
            attributes,
            reservoir_factory(_ExponentialBucketHistogramAggregation),
            instrument_aggregation_temporality,
            start_time_unix_nano,
            max_size=self._max_size,
            max_scale=self._max_scale,
        )


class ExplicitBucketHistogramAggregation(Aggregation):
    """This aggregation informs the SDK to collect:

    - Count of Measurement values falling within explicit bucket boundaries.
    - Arithmetic sum of Measurement values in population. This SHOULD NOT be collected when used with instruments that record negative measurements, e.g. UpDownCounter or ObservableGauge.
    - Min (optional) Measurement value in population.
    - Max (optional) Measurement value in population.


    Args:
        boundaries: Array of increasing values representing explicit bucket boundary values.
        record_min_max: Whether to record min and max.
    """

    def __init__(
        self,
        boundaries: Optional[Sequence[float]] = None,
        record_min_max: bool = True,
    ) -> None:
        self._boundaries = boundaries
        self._record_min_max = record_min_max

    def _create_aggregation(
        self,
        instrument: Instrument,
        attributes: Attributes,
        reservoir_factory: Callable[
            [Type[_Aggregation]], ExemplarReservoirBuilder
        ],
        start_time_unix_nano: int,
    ) -> _Aggregation:
        instrument_aggregation_temporality = AggregationTemporality.UNSPECIFIED
        if isinstance(instrument, Synchronous):
            instrument_aggregation_temporality = AggregationTemporality.DELTA
        elif isinstance(instrument, Asynchronous):
            instrument_aggregation_temporality = (
                AggregationTemporality.CUMULATIVE
            )

        if self._boundaries is not None:
            boundaries = self._boundaries
        else:
            boundaries = instrument._advisory.explicit_bucket_boundaries

        return _ExplicitBucketHistogramAggregation(
            attributes,
            instrument_aggregation_temporality,
            start_time_unix_nano,
            reservoir_factory(_ExplicitBucketHistogramAggregation),
            boundaries,
            self._record_min_max,
        )


class SumAggregation(Aggregation):
    """This aggregation informs the SDK to collect:

    - The arithmetic sum of Measurement values.
    """

    def _create_aggregation(
        self,
        instrument: Instrument,
        attributes: Attributes,
        reservoir_factory: Callable[
            [Type[_Aggregation]], ExemplarReservoirBuilder
        ],
        start_time_unix_nano: int,
    ) -> _Aggregation:
        instrument_aggregation_temporality = AggregationTemporality.UNSPECIFIED
        if isinstance(instrument, Synchronous):
            instrument_aggregation_temporality = AggregationTemporality.DELTA
        elif isinstance(instrument, Asynchronous):
            instrument_aggregation_temporality = (
                AggregationTemporality.CUMULATIVE
            )

        return _SumAggregation(
            attributes,
            isinstance(instrument, (Counter, ObservableCounter)),
            instrument_aggregation_temporality,
            start_time_unix_nano,
            reservoir_factory(_SumAggregation),
        )


class LastValueAggregation(Aggregation):
    """
    This aggregation informs the SDK to collect:

    - The last Measurement.
    - The timestamp of the last Measurement.
    """

    def _create_aggregation(
        self,
        instrument: Instrument,
        attributes: Attributes,
        reservoir_factory: Callable[
            [Type[_Aggregation]], ExemplarReservoirBuilder
        ],
        start_time_unix_nano: int,
    ) -> _Aggregation:
        return _LastValueAggregation(
            attributes,
            reservoir_builder=reservoir_factory(_LastValueAggregation),
        )


class DropAggregation(Aggregation):
    """Using this aggregation will make all measurements be ignored."""

    def _create_aggregation(
        self,
        instrument: Instrument,
        attributes: Attributes,
        reservoir_factory: Callable[
            [Type[_Aggregation]], ExemplarReservoirBuilder
        ],
        start_time_unix_nano: int,
    ) -> _Aggregation:
        return _DropAggregation(
            attributes, reservoir_factory(_DropAggregation)
        )
