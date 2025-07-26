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

from math import ldexp
from threading import Lock

from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping import (
    Mapping,
)
from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping.errors import (
    MappingOverflowError,
    MappingUnderflowError,
)
from opentelemetry.sdk.metrics._internal.exponential_histogram.mapping.ieee_754 import (
    MANTISSA_WIDTH,
    MAX_NORMAL_EXPONENT,
    MIN_NORMAL_EXPONENT,
    MIN_NORMAL_VALUE,
    get_ieee_754_exponent,
    get_ieee_754_mantissa,
)


class ExponentMapping(Mapping):
    # Reference implementation here:
    # https://github.com/open-telemetry/opentelemetry-go/blob/0e6f9c29c10d6078e8131418e1d1d166c7195d61/sdk/metric/aggregator/exponential/mapping/exponent/exponent.go

    _mappings = {}
    _mappings_lock = Lock()

    _min_scale = -10
    _max_scale = 0

    def _get_min_scale(self):
        # _min_scale defines the point at which the exponential mapping
        # function becomes useless for 64-bit floats. With scale -10, ignoring
        # subnormal values, bucket indices range from -1 to 1.
        return -10

    def _get_max_scale(self):
        # _max_scale is the largest scale supported by exponential mapping. Use
        # a logarithm mapping for larger scales.
        return 0

    def _init(self, scale: int):
        # pylint: disable=attribute-defined-outside-init

        super()._init(scale)

        # self._min_normal_lower_boundary_index is the largest index such that
        # base ** index < MIN_NORMAL_VALUE and
        # base ** (index + 1) >= MIN_NORMAL_VALUE. An exponential histogram
        # bucket with this index covers the range
        # (base ** index, base (index + 1)], including MIN_NORMAL_VALUE. This
        # is the smallest valid index that contains at least one normal value.
        index = MIN_NORMAL_EXPONENT >> -self._scale

        if -self._scale < 2:
            # For scales -1 and 0, the maximum value 2 ** -1022 is a
            # power-of-two multiple, meaning base ** index == MIN_NORMAL_VALUE.
            # Subtracting 1 so that base ** (index + 1) == MIN_NORMAL_VALUE.
            index -= 1

        self._min_normal_lower_boundary_index = index

        # self._max_normal_lower_boundary_index is the index such that
        # base**index equals the greatest representable lower boundary. An
        # exponential histogram bucket with this index covers the range
        # ((2 ** 1024) / base, 2 ** 1024], which includes opentelemetry.sdk.
        # metrics._internal.exponential_histogram.ieee_754.MAX_NORMAL_VALUE.
        # This bucket is incomplete, since the upper boundary cannot be
        # represented. One greater than this index corresponds with the bucket
        # containing values > 2 ** 1024.
        self._max_normal_lower_boundary_index = (
            MAX_NORMAL_EXPONENT >> -self._scale
        )

    def map_to_index(self, value: float) -> int:
        if value < MIN_NORMAL_VALUE:
            return self._min_normal_lower_boundary_index

        exponent = get_ieee_754_exponent(value)

        # Positive integers are represented in binary as having an infinite
        # amount of leading zeroes, for example 2 is represented as ...00010.

        # A negative integer -x is represented in binary as the complement of
        # (x - 1). For example, -4 is represented as the complement of 4 - 1
        # == 3. 3 is represented as ...00011. Its compliment is ...11100, the
        # binary representation of -4.

        # get_ieee_754_mantissa(value) gets the positive integer made up
        # from the rightmost MANTISSA_WIDTH bits (the mantissa) of the IEEE
        # 754 representation of value. If value is an exact power of 2, all
        # these MANTISSA_WIDTH bits would be all zeroes, and when 1 is
        # subtracted the resulting value is -1. The binary representation of
        # -1 is ...111, so when these bits are right shifted MANTISSA_WIDTH
        # places, the resulting value for correction is -1. If value is not an
        # exact power of 2, at least one of the rightmost MANTISSA_WIDTH
        # bits would be 1 (even for values whose decimal part is 0, like 5.0
        # since the IEEE 754 of such number is too the product of a power of 2
        # (defined in the exponent part of the IEEE 754 representation) and the
        # value defined in the mantissa). Having at least one of the rightmost
        # MANTISSA_WIDTH bit being 1 means that get_ieee_754(value) will
        # always be greater or equal to 1, and when 1 is subtracted, the
        # result will be greater or equal to 0, whose representation in binary
        # will be of at most MANTISSA_WIDTH ones that have an infinite
        # amount of leading zeroes. When those MANTISSA_WIDTH bits are
        # shifted to the right MANTISSA_WIDTH places, the resulting value
        # will be 0.

        # In summary, correction will be -1 if value is a power of 2, 0 if not.

        # FIXME Document why we can assume value will not be 0, inf, or NaN.
        correction = (get_ieee_754_mantissa(value) - 1) >> MANTISSA_WIDTH

        return (exponent + correction) >> -self._scale

    def get_lower_boundary(self, index: int) -> float:
        if index < self._min_normal_lower_boundary_index:
            raise MappingUnderflowError()

        if index > self._max_normal_lower_boundary_index:
            raise MappingOverflowError()

        return ldexp(1, index << -self._scale)

    @property
    def scale(self) -> int:
        return self._scale
