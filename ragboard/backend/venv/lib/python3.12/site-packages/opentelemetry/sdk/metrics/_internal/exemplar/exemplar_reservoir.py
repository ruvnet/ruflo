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

from abc import ABC, abstractmethod
from collections import defaultdict
from random import randrange
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Union,
)

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.trace.span import INVALID_SPAN
from opentelemetry.util.types import Attributes

from .exemplar import Exemplar


class ExemplarReservoir(ABC):
    """ExemplarReservoir provide a method to offer measurements to the reservoir
    and another to collect accumulated Exemplars.

    Note:
        The constructor MUST accept ``**kwargs`` that may be set from aggregation
        parameters.

    Reference:
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#exemplarreservoir
    """

    @abstractmethod
    def offer(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> None:
        """Offers a measurement to be sampled.

        Args:
            value: Measured value
            time_unix_nano: Measurement instant
            attributes: Measurement attributes
            context: Measurement context
        """
        raise NotImplementedError("ExemplarReservoir.offer is not implemented")

    @abstractmethod
    def collect(self, point_attributes: Attributes) -> List[Exemplar]:
        """Returns accumulated Exemplars and also resets the reservoir for the next
        sampling period

        Args:
            point_attributes: The attributes associated with metric point.

        Returns:
            a list of ``opentelemetry.sdk.metrics._internal.exemplar.exemplar.Exemplar`` s. Returned
            exemplars contain the attributes that were filtered out by the aggregator,
            but recorded alongside the original measurement.
        """
        raise NotImplementedError(
            "ExemplarReservoir.collect is not implemented"
        )


class ExemplarBucket:
    def __init__(self) -> None:
        self.__value: Union[int, float] = 0
        self.__attributes: Attributes = None
        self.__time_unix_nano: int = 0
        self.__span_id: Optional[int] = None
        self.__trace_id: Optional[int] = None
        self.__offered: bool = False

    def offer(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> None:
        """Offers a measurement to be sampled.

        Args:
            value: Measured value
            time_unix_nano: Measurement instant
            attributes: Measurement attributes
            context: Measurement context
        """
        self.__value = value
        self.__time_unix_nano = time_unix_nano
        self.__attributes = attributes
        span = trace.get_current_span(context)
        if span != INVALID_SPAN:
            span_context = span.get_span_context()
            self.__span_id = span_context.span_id
            self.__trace_id = span_context.trace_id

        self.__offered = True

    def collect(self, point_attributes: Attributes) -> Optional[Exemplar]:
        """May return an Exemplar and resets the bucket for the next sampling period."""
        if not self.__offered:
            return None

        # filters out attributes from the measurement that are already included in the metric data point
        # See the specification for more details:
        # https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#exemplar
        filtered_attributes = (
            {
                k: v
                for k, v in self.__attributes.items()
                if k not in point_attributes
            }
            if self.__attributes
            else None
        )

        exemplar = Exemplar(
            filtered_attributes,
            self.__value,
            self.__time_unix_nano,
            self.__span_id,
            self.__trace_id,
        )
        self.__reset()
        return exemplar

    def __reset(self) -> None:
        """Reset the bucket state after a collection cycle."""
        self.__value = 0
        self.__attributes = {}
        self.__time_unix_nano = 0
        self.__span_id = None
        self.__trace_id = None
        self.__offered = False


class BucketIndexError(ValueError):
    """An exception raised when the bucket index cannot be found."""


class FixedSizeExemplarReservoirABC(ExemplarReservoir):
    """Abstract class for a reservoir with fixed size."""

    def __init__(self, size: int, **kwargs) -> None:
        super().__init__(**kwargs)
        self._size: int = size
        self._reservoir_storage: Mapping[int, ExemplarBucket] = defaultdict(
            ExemplarBucket
        )

    def collect(self, point_attributes: Attributes) -> List[Exemplar]:
        """Returns accumulated Exemplars and also resets the reservoir for the next
        sampling period

        Args:
            point_attributes: The attributes associated with metric point.

        Returns:
            a list of ``opentelemetry.sdk.metrics._internal.exemplar.exemplar.Exemplar`` s. Returned
            exemplars contain the attributes that were filtered out by the aggregator,
            but recorded alongside the original measurement.
        """
        exemplars = [
            e
            for e in (
                bucket.collect(point_attributes)
                for _, bucket in sorted(self._reservoir_storage.items())
            )
            if e is not None
        ]
        self._reset()
        return exemplars

    def offer(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> None:
        """Offers a measurement to be sampled.

        Args:
            value: Measured value
            time_unix_nano: Measurement instant
            attributes: Measurement attributes
            context: Measurement context
        """
        try:
            index = self._find_bucket_index(
                value, time_unix_nano, attributes, context
            )

            self._reservoir_storage[index].offer(
                value, time_unix_nano, attributes, context
            )
        except BucketIndexError:
            # Ignore invalid bucket index
            pass

    @abstractmethod
    def _find_bucket_index(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> int:
        """Determines the bucket index for the given measurement.

        It should be implemented by subclasses based on specific strategies.

        Args:
            value: Measured value
            time_unix_nano: Measurement instant
            attributes: Measurement attributes
            context: Measurement context

        Returns:
            The bucket index

        Raises:
            BucketIndexError: If no bucket index can be found.
        """

    def _reset(self) -> None:
        """Reset the reservoir by resetting any stateful logic after a collection cycle."""


class SimpleFixedSizeExemplarReservoir(FixedSizeExemplarReservoirABC):
    """This reservoir uses an uniformly-weighted sampling algorithm based on the number
    of samples the reservoir has seen so far to determine if the offered measurements
    should be sampled.

    Reference:
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#simplefixedsizeexemplarreservoir
    """

    def __init__(self, size: int = 1, **kwargs) -> None:
        super().__init__(size, **kwargs)
        self._measurements_seen: int = 0

    def _reset(self) -> None:
        super()._reset()
        self._measurements_seen = 0

    def _find_bucket_index(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> int:
        self._measurements_seen += 1
        if self._measurements_seen < self._size:
            return self._measurements_seen - 1

        index = randrange(0, self._measurements_seen)
        if index < self._size:
            return index

        raise BucketIndexError("Unable to find the bucket index.")


class AlignedHistogramBucketExemplarReservoir(FixedSizeExemplarReservoirABC):
    """This Exemplar reservoir takes a configuration parameter that is the
    configuration of a Histogram. This implementation keeps the last seen measurement
    that falls within a histogram bucket.

    Reference:
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#alignedhistogrambucketexemplarreservoir
    """

    def __init__(self, boundaries: Sequence[float], **kwargs) -> None:
        super().__init__(len(boundaries) + 1, **kwargs)
        self._boundaries: Sequence[float] = boundaries

    def offer(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> None:
        """Offers a measurement to be sampled."""
        index = self._find_bucket_index(
            value, time_unix_nano, attributes, context
        )
        self._reservoir_storage[index].offer(
            value, time_unix_nano, attributes, context
        )

    def _find_bucket_index(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> int:
        for index, boundary in enumerate(self._boundaries):
            if value <= boundary:
                return index
        return len(self._boundaries)


ExemplarReservoirBuilder = Callable[[Dict[str, Any]], ExemplarReservoir]
ExemplarReservoirBuilder.__doc__ = """ExemplarReservoir builder.

It may receive the Aggregation parameters it is bounded to; e.g.
the _ExplicitBucketHistogramAggregation will provide the boundaries.
"""
