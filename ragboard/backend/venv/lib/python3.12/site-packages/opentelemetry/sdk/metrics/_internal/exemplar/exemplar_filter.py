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
from typing import Union

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.trace.span import INVALID_SPAN
from opentelemetry.util.types import Attributes


class ExemplarFilter(ABC):
    """``ExemplarFilter`` determines which measurements are eligible for becoming an
    ``Exemplar``.

    Exemplar filters are used to filter measurements before attempting to store them
    in a reservoir.

    Reference:
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#exemplarfilter
    """

    @abstractmethod
    def should_sample(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> bool:
        """Returns whether or not a reservoir should attempt to filter a measurement.

        Args:
            value: The value of the measurement
            timestamp: A timestamp that best represents when the measurement was taken
            attributes: The complete set of measurement attributes
            context: The Context of the measurement
        """
        raise NotImplementedError(
            "ExemplarFilter.should_sample is not implemented"
        )


class AlwaysOnExemplarFilter(ExemplarFilter):
    """An ExemplarFilter which makes all measurements eligible for being an Exemplar.

    Reference:
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#alwayson
    """

    def should_sample(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> bool:
        """Returns whether or not a reservoir should attempt to filter a measurement.

        Args:
            value: The value of the measurement
            timestamp: A timestamp that best represents when the measurement was taken
            attributes: The complete set of measurement attributes
            context: The Context of the measurement
        """
        return True


class AlwaysOffExemplarFilter(ExemplarFilter):
    """An ExemplarFilter which makes no measurements eligible for being an Exemplar.

    Using this ExemplarFilter is as good as disabling Exemplar feature.

    Reference:
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#alwaysoff
    """

    def should_sample(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> bool:
        """Returns whether or not a reservoir should attempt to filter a measurement.

        Args:
            value: The value of the measurement
            timestamp: A timestamp that best represents when the measurement was taken
            attributes: The complete set of measurement attributes
            context: The Context of the measurement
        """
        return False


class TraceBasedExemplarFilter(ExemplarFilter):
    """An ExemplarFilter which makes those measurements eligible for being an Exemplar,
    which are recorded in the context of a sampled parent span.

    Reference:
        https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#tracebased
    """

    def should_sample(
        self,
        value: Union[int, float],
        time_unix_nano: int,
        attributes: Attributes,
        context: Context,
    ) -> bool:
        """Returns whether or not a reservoir should attempt to filter a measurement.

        Args:
            value: The value of the measurement
            timestamp: A timestamp that best represents when the measurement was taken
            attributes: The complete set of measurement attributes
            context: The Context of the measurement
        """
        span = trace.get_current_span(context)
        if span == INVALID_SPAN:
            return False
        return span.get_span_context().trace_flags.sampled
