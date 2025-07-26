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

from math import exp, floor, ldexp, log
from threading import Lock

from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping import (
    Mapping,
)
from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping.errors import (
    MappingOverflowError,
    MappingUnderflowError,
)
from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping.ieee_754 import (
    MAX_NORMAL_EXPONENT,
    MIN_NORMAL_EXPONENT,
    MIN_NORMAL_VALUE,
    get_ieee_754_exponent,
    get_ieee_754_mantissa,
)


class LogarithmMapping(Mapping):
    # Reference implementation here:
    # https://github.com/open-telemetry/opentelemetry-go/blob/0e6f9c29c10d6078e8131418e1d1d166c7195d61/sdk/metric/aggregator/exponential/mapping/logarithm/logarithm.go

    _mappings = {}
    _mappings_lock = Lock()

    _min_scale = 1
    _max_scale = 20

    def _get_min_scale(self):
        # _min_scale ensures that ExponentMapping is used for zero and negative
        # scale values.
        return self._min_scale

    def _get_max_scale(self):
        # FIXME The Go implementation uses a value of 20 here, find out the
        # right value for this implementation, more information here:
        # https://github.com/lightstep/otel-launcher-go/blob/c9ca8483be067a39ab306b09060446e7fda65f35/lightstep/sdk/metric/aggregator/histogram/structure/README.md#mapping-function
        # https://github.com/open-telemetry/opentelemetry-go/blob/0e6f9c29c10d6078e8131418e1d1d166c7195d61/sdk/metric/aggregator/exponential/mapping/logarithm/logarithm.go#L32-L45
        return self._max_scale

    def _init(self, scale: int):
        # pylint: disable=attribute-defined-outside-init

        super()._init(scale)

        # self._scale_factor is defined as a multiplier because multiplication
        # is faster than division. self._scale_factor is defined as:
        # index = log(value) * self._scale_factor
        # Where:
        # index = log(value) / log(base)
        # index = log(value) / log(2 ** (2 ** -scale))
        # index = log(value) / ((2 ** -scale) * log(2))
        # index = log(value) * ((1 / log(2)) * (2 ** scale))
        # self._scale_factor = ((1 / log(2)) * (2 ** scale))
        # self._scale_factor = (1 /log(2)) * (2 ** scale)
        # self._scale_factor = ldexp(1 / log(2), scale)
        # This implementation was copied from a Java prototype. See:
        # https://github.com/newrelic-experimental/newrelic-sketch-java/blob/1ce245713603d61ba3a4510f6df930a5479cd3f6/src/main/java/com/newrelic/nrsketch/indexer/LogIndexer.java
        # for the equations used here.
        self._scale_factor = ldexp(1 / log(2), scale)

        # self._min_normal_lower_boundary_index is the index such that
        # base ** index == MIN_NORMAL_VALUE. An exponential histogram bucket
        # with this index covers the range
        # (MIN_NORMAL_VALUE, MIN_NORMAL_VALUE * base]. One less than this index
        # corresponds with the bucket containing values <= MIN_NORMAL_VALUE.
        self._min_normal_lower_boundary_index = (
            MIN_NORMAL_EXPONENT << self._scale
        )

        # self._max_normal_lower_boundary_index is the index such that
        # base ** index equals the greatest representable lower boundary. An
        # exponential histogram bucket with this index covers the range
        # ((2 ** 1024) / base, 2 ** 1024], which includes opentelemetry.sdk.
        # metrics._internal.exponential_histogram.ieee_754.MAX_NORMAL_VALUE.
        # This bucket is incomplete, since the upper boundary cannot be
        # represented. One greater than this index corresponds with the bucket
        # containing values > 2 ** 1024.
        self._max_normal_lower_boundary_index = (
            (MAX_NORMAL_EXPONENT + 1) << self._scale
        ) - 1

    def map_to_index(self, value: float) -> int:
        """
        Maps positive floating point values to indexes corresponding to scale.
        """

        # value is subnormal
        if value <= MIN_NORMAL_VALUE:
            return self._min_normal_lower_boundary_index - 1

        # value is an exact power of two.
        if get_ieee_754_mantissa(value) == 0:
            exponent = get_ieee_754_exponent(value)
            return (exponent << self._scale) - 1

        return min(
            floor(log(value) * self._scale_factor),
            self._max_normal_lower_boundary_index,
        )

    def get_lower_boundary(self, index: int) -> float:
        if index >= self._max_normal_lower_boundary_index:
            if index == self._max_normal_lower_boundary_index:
                return 2 * exp(
                    (index - (1 << self._scale)) / self._scale_factor
                )
            raise MappingOverflowError()

        if index <= self._min_normal_lower_boundary_index:
            if index == self._min_normal_lower_boundary_index:
                return MIN_NORMAL_VALUE
            if index == self._min_normal_lower_boundary_index - 1:
                return (
                    exp((index + (1 << self._scale)) / self._scale_factor) / 2
                )
            raise MappingUnderflowError()

        return exp(index / self._scale_factor)

    @property
    def scale(self) -> int:
        return self._scale
