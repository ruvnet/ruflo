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

"""
The OpenTelemetry metrics API  describes the classes used to generate
metrics.

The :class:`.MeterProvider` provides users access to the :class:`.Meter` which in
turn is used to create :class:`.Instrument` objects. The :class:`.Instrument` objects are
used to record measurements.

This module provides abstract (i.e. unimplemented) classes required for
metrics, and a concrete no-op implementation :class:`.NoOpMeter` that allows applications
to use the API package alone without a supporting implementation.

To get a meter, you need to provide the package name from which you are
calling the meter APIs to OpenTelemetry by calling `MeterProvider.get_meter`
with the calling instrumentation name and the version of your package.

The following code shows how to obtain a meter using the global :class:`.MeterProvider`::

    from opentelemetry.metrics import get_meter

    meter = get_meter("example-meter")
    counter = meter.create_counter("example-counter")

.. versionadded:: 1.10.0
.. versionchanged:: 1.12.0rc
"""

from opentelemetry.metrics._internal import (
    Meter,
    MeterProvider,
    NoOpMeter,
    NoOpMeterProvider,
    get_meter,
    get_meter_provider,
    set_meter_provider,
)
from opentelemetry.metrics._internal.instrument import (
    Asynchronous,
    CallbackOptions,
    CallbackT,
    Counter,
    Histogram,
    Instrument,
    NoOpCounter,
    NoOpHistogram,
    NoOpObservableCounter,
    NoOpObservableGauge,
    NoOpObservableUpDownCounter,
    NoOpUpDownCounter,
    ObservableCounter,
    ObservableGauge,
    ObservableUpDownCounter,
    Synchronous,
    UpDownCounter,
)
from opentelemetry.metrics._internal.instrument import Gauge as _Gauge
from opentelemetry.metrics._internal.instrument import NoOpGauge as _NoOpGauge
from opentelemetry.metrics._internal.observation import Observation

for obj in [
    Counter,
    Synchronous,
    Asynchronous,
    CallbackOptions,
    _Gauge,
    _NoOpGauge,
    get_meter_provider,
    get_meter,
    Histogram,
    Meter,
    MeterProvider,
    Instrument,
    NoOpCounter,
    NoOpHistogram,
    NoOpMeter,
    NoOpMeterProvider,
    NoOpObservableCounter,
    NoOpObservableGauge,
    NoOpObservableUpDownCounter,
    NoOpUpDownCounter,
    ObservableCounter,
    ObservableGauge,
    ObservableUpDownCounter,
    Observation,
    set_meter_provider,
    UpDownCounter,
]:
    obj.__module__ = __name__

__all__ = [
    "CallbackOptions",
    "MeterProvider",
    "NoOpMeterProvider",
    "Meter",
    "Counter",
    "_Gauge",
    "_NoOpGauge",
    "NoOpCounter",
    "UpDownCounter",
    "NoOpUpDownCounter",
    "Histogram",
    "NoOpHistogram",
    "ObservableCounter",
    "NoOpObservableCounter",
    "ObservableUpDownCounter",
    "Instrument",
    "Synchronous",
    "Asynchronous",
    "NoOpObservableGauge",
    "ObservableGauge",
    "NoOpObservableUpDownCounter",
    "get_meter",
    "get_meter_provider",
    "set_meter_provider",
    "Observation",
    "CallbackT",
    "NoOpMeter",
]
