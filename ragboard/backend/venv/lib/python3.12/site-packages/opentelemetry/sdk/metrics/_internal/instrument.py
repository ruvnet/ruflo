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

# pylint: disable=too-many-ancestors, unused-import
from __future__ import annotations

from logging import getLogger
from time import time_ns
from typing import Generator, Iterable, List, Sequence, Union

# This kind of import is needed to avoid Sphinx errors.
import opentelemetry.sdk.metrics
from opentelemetry.context import Context, get_current
from opentelemetry.metrics import CallbackT
from opentelemetry.metrics import Counter as APICounter
from opentelemetry.metrics import Histogram as APIHistogram
from opentelemetry.metrics import ObservableCounter as APIObservableCounter
from opentelemetry.metrics import ObservableGauge as APIObservableGauge
from opentelemetry.metrics import (
    ObservableUpDownCounter as APIObservableUpDownCounter,
)
from opentelemetry.metrics import UpDownCounter as APIUpDownCounter
from opentelemetry.metrics import _Gauge as APIGauge
from opentelemetry.metrics._internal.instrument import (
    CallbackOptions,
    _MetricsHistogramAdvisory,
)
from opentelemetry.sdk.metrics._internal.measurement import Measurement
from opentelemetry.sdk.util.instrumentation import InstrumentationScope

_logger = getLogger(__name__)


_ERROR_MESSAGE = (
    "Expected ASCII string of maximum length 63 characters but got {}"
)


class _Synchronous:
    def __init__(
        self,
        name: str,
        instrumentation_scope: InstrumentationScope,
        measurement_consumer: "opentelemetry.sdk.metrics.MeasurementConsumer",
        unit: str = "",
        description: str = "",
    ):
        # pylint: disable=no-member
        result = self._check_name_unit_description(name, unit, description)

        if result["name"] is None:
            # pylint: disable=broad-exception-raised
            raise Exception(_ERROR_MESSAGE.format(name))

        if result["unit"] is None:
            # pylint: disable=broad-exception-raised
            raise Exception(_ERROR_MESSAGE.format(unit))

        name = result["name"]
        unit = result["unit"]
        description = result["description"]

        self.name = name.lower()
        self.unit = unit
        self.description = description
        self.instrumentation_scope = instrumentation_scope
        self._measurement_consumer = measurement_consumer
        super().__init__(name, unit=unit, description=description)


class _Asynchronous:
    def __init__(
        self,
        name: str,
        instrumentation_scope: InstrumentationScope,
        measurement_consumer: "opentelemetry.sdk.metrics.MeasurementConsumer",
        callbacks: Iterable[CallbackT] | None = None,
        unit: str = "",
        description: str = "",
    ):
        # pylint: disable=no-member
        result = self._check_name_unit_description(name, unit, description)

        if result["name"] is None:
            # pylint: disable=broad-exception-raised
            raise Exception(_ERROR_MESSAGE.format(name))

        if result["unit"] is None:
            # pylint: disable=broad-exception-raised
            raise Exception(_ERROR_MESSAGE.format(unit))

        name = result["name"]
        unit = result["unit"]
        description = result["description"]

        self.name = name.lower()
        self.unit = unit
        self.description = description
        self.instrumentation_scope = instrumentation_scope
        self._measurement_consumer = measurement_consumer
        super().__init__(name, callbacks, unit=unit, description=description)

        self._callbacks: List[CallbackT] = []

        if callbacks is not None:
            for callback in callbacks:
                if isinstance(callback, Generator):
                    # advance generator to it's first yield
                    next(callback)

                    def inner(
                        options: CallbackOptions,
                        callback=callback,
                    ) -> Iterable[Measurement]:
                        try:
                            return callback.send(options)
                        except StopIteration:
                            return []

                    self._callbacks.append(inner)
                else:
                    self._callbacks.append(callback)

    def callback(
        self, callback_options: CallbackOptions
    ) -> Iterable[Measurement]:
        for callback in self._callbacks:
            try:
                for api_measurement in callback(callback_options):
                    yield Measurement(
                        api_measurement.value,
                        time_unix_nano=time_ns(),
                        instrument=self,
                        context=api_measurement.context or get_current(),
                        attributes=api_measurement.attributes,
                    )
            except Exception:  # pylint: disable=broad-exception-caught
                _logger.exception(
                    "Callback failed for instrument %s.", self.name
                )


class Counter(_Synchronous, APICounter):
    def __new__(cls, *args, **kwargs):
        if cls is Counter:
            raise TypeError("Counter must be instantiated via a meter.")
        return super().__new__(cls)

    def add(
        self,
        amount: Union[int, float],
        attributes: dict[str, str] | None = None,
        context: Context | None = None,
    ):
        if amount < 0:
            _logger.warning(
                "Add amount must be non-negative on Counter %s.", self.name
            )
            return
        time_unix_nano = time_ns()
        self._measurement_consumer.consume_measurement(
            Measurement(
                amount,
                time_unix_nano,
                self,
                context or get_current(),
                attributes,
            )
        )


class UpDownCounter(_Synchronous, APIUpDownCounter):
    def __new__(cls, *args, **kwargs):
        if cls is UpDownCounter:
            raise TypeError("UpDownCounter must be instantiated via a meter.")
        return super().__new__(cls)

    def add(
        self,
        amount: Union[int, float],
        attributes: dict[str, str] | None = None,
        context: Context | None = None,
    ):
        time_unix_nano = time_ns()
        self._measurement_consumer.consume_measurement(
            Measurement(
                amount,
                time_unix_nano,
                self,
                context or get_current(),
                attributes,
            )
        )


class ObservableCounter(_Asynchronous, APIObservableCounter):
    def __new__(cls, *args, **kwargs):
        if cls is ObservableCounter:
            raise TypeError(
                "ObservableCounter must be instantiated via a meter."
            )
        return super().__new__(cls)


class ObservableUpDownCounter(_Asynchronous, APIObservableUpDownCounter):
    def __new__(cls, *args, **kwargs):
        if cls is ObservableUpDownCounter:
            raise TypeError(
                "ObservableUpDownCounter must be instantiated via a meter."
            )
        return super().__new__(cls)


class Histogram(_Synchronous, APIHistogram):
    def __init__(
        self,
        name: str,
        instrumentation_scope: InstrumentationScope,
        measurement_consumer: "opentelemetry.sdk.metrics.MeasurementConsumer",
        unit: str = "",
        description: str = "",
        explicit_bucket_boundaries_advisory: Sequence[float] | None = None,
    ):
        super().__init__(
            name,
            unit=unit,
            description=description,
            instrumentation_scope=instrumentation_scope,
            measurement_consumer=measurement_consumer,
        )
        self._advisory = _MetricsHistogramAdvisory(
            explicit_bucket_boundaries=explicit_bucket_boundaries_advisory
        )

    def __new__(cls, *args, **kwargs):
        if cls is Histogram:
            raise TypeError("Histogram must be instantiated via a meter.")
        return super().__new__(cls)

    def record(
        self,
        amount: Union[int, float],
        attributes: dict[str, str] | None = None,
        context: Context | None = None,
    ):
        if amount < 0:
            _logger.warning(
                "Record amount must be non-negative on Histogram %s.",
                self.name,
            )
            return
        time_unix_nano = time_ns()
        self._measurement_consumer.consume_measurement(
            Measurement(
                amount,
                time_unix_nano,
                self,
                context or get_current(),
                attributes,
            )
        )


class Gauge(_Synchronous, APIGauge):
    def __new__(cls, *args, **kwargs):
        if cls is Gauge:
            raise TypeError("Gauge must be instantiated via a meter.")
        return super().__new__(cls)

    def set(
        self,
        amount: Union[int, float],
        attributes: dict[str, str] | None = None,
        context: Context | None = None,
    ):
        time_unix_nano = time_ns()
        self._measurement_consumer.consume_measurement(
            Measurement(
                amount,
                time_unix_nano,
                self,
                context or get_current(),
                attributes,
            )
        )


class ObservableGauge(_Asynchronous, APIObservableGauge):
    def __new__(cls, *args, **kwargs):
        if cls is ObservableGauge:
            raise TypeError(
                "ObservableGauge must be instantiated via a meter."
            )
        return super().__new__(cls)


# Below classes exist to prevent the direct instantiation
class _Counter(Counter):
    pass


class _UpDownCounter(UpDownCounter):
    pass


class _ObservableCounter(ObservableCounter):
    pass


class _ObservableUpDownCounter(ObservableUpDownCounter):
    pass


class _Histogram(Histogram):
    pass


class _Gauge(Gauge):
    pass


class _ObservableGauge(ObservableGauge):
    pass
