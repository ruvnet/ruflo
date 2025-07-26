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


class Mapping(ABC):
    """
    Parent class for `LogarithmMapping` and `ExponentialMapping`.
    """

    # pylint: disable=no-member
    def __new__(cls, scale: int):
        with cls._mappings_lock:
            # cls._mappings and cls._mappings_lock are implemented in each of
            # the child classes as a dictionary and a lock, respectively. They
            # are not instantiated here because that would lead to both child
            # classes having the same instance of cls._mappings and
            # cls._mappings_lock.
            if scale not in cls._mappings:
                cls._mappings[scale] = super().__new__(cls)
                cls._mappings[scale]._init(scale)

        return cls._mappings[scale]

    @abstractmethod
    def _init(self, scale: int) -> None:
        # pylint: disable=attribute-defined-outside-init

        if scale > self._get_max_scale():
            # pylint: disable=broad-exception-raised
            raise Exception(f"scale is larger than {self._max_scale}")

        if scale < self._get_min_scale():
            # pylint: disable=broad-exception-raised
            raise Exception(f"scale is smaller than {self._min_scale}")

        # The size of the exponential histogram buckets is determined by a
        # parameter known as scale, larger values of scale will produce smaller
        # buckets. Bucket boundaries of the exponential histogram are located
        # at integer powers of the base, where:
        #
        # base = 2 ** (2 ** (-scale))
        # https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/data-model.md#all-scales-use-the-logarithm-function
        self._scale = scale

    @abstractmethod
    def _get_min_scale(self) -> int:
        """
        Return the smallest possible value for the mapping scale
        """

    @abstractmethod
    def _get_max_scale(self) -> int:
        """
        Return the largest possible value for the mapping scale
        """

    @abstractmethod
    def map_to_index(self, value: float) -> int:
        """
        Maps positive floating point values to indexes corresponding to
        `Mapping.scale`. Implementations are not expected to handle zeros,
        +inf, NaN, or negative values.
        """

    @abstractmethod
    def get_lower_boundary(self, index: int) -> float:
        """
        Returns the lower boundary of a given bucket index. The index is
        expected to map onto a range that is at least partially inside the
        range of normal floating point values.  If the corresponding
        bucket's upper boundary is less than or equal to 2 ** -1022,
        :class:`~opentelemetry.sdk.metrics.MappingUnderflowError`
        will be raised. If the corresponding bucket's lower boundary is greater
        than ``sys.float_info.max``,
        :class:`~opentelemetry.sdk.metrics.MappingOverflowError`
        will be raised.
        """

    @property
    def scale(self) -> int:
        """
        Returns the parameter that controls the resolution of this mapping.
        See: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/datamodel.md#exponential-scale
        """
        return self._scale
