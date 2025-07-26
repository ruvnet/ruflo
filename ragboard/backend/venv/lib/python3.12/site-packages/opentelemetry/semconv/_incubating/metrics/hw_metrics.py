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


from typing import (
    Callable,
    Final,
    Generator,
    Iterable,
    Optional,
    Sequence,
    Union,
)

from opentelemetry.metrics import (
    CallbackOptions,
    Counter,
    Meter,
    ObservableGauge,
    Observation,
    UpDownCounter,
)

# pylint: disable=invalid-name
CallbackT = Union[
    Callable[[CallbackOptions], Iterable[Observation]],
    Generator[Iterable[Observation], CallbackOptions, None],
]

HW_ENERGY: Final = "hw.energy"
"""
Energy consumed by the component
Instrument: counter
Unit: J
"""


def create_hw_energy(meter: Meter) -> Counter:
    """Energy consumed by the component"""
    return meter.create_counter(
        name=HW_ENERGY,
        description="Energy consumed by the component",
        unit="J",
    )


HW_ERRORS: Final = "hw.errors"
"""
Number of errors encountered by the component
Instrument: counter
Unit: {error}
"""


def create_hw_errors(meter: Meter) -> Counter:
    """Number of errors encountered by the component"""
    return meter.create_counter(
        name=HW_ERRORS,
        description="Number of errors encountered by the component",
        unit="{error}",
    )


HW_HOST_AMBIENT_TEMPERATURE: Final = "hw.host.ambient_temperature"
"""
Ambient (external) temperature of the physical host
Instrument: gauge
Unit: Cel
"""


def create_hw_host_ambient_temperature(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Ambient (external) temperature of the physical host"""
    return meter.create_observable_gauge(
        name=HW_HOST_AMBIENT_TEMPERATURE,
        callbacks=callbacks,
        description="Ambient (external) temperature of the physical host",
        unit="Cel",
    )


HW_HOST_ENERGY: Final = "hw.host.energy"
"""
Total energy consumed by the entire physical host, in joules
Instrument: counter
Unit: J
Note: The overall energy usage of a host MUST be reported using the specific `hw.host.energy` and `hw.host.power` metrics **only**, instead of the generic `hw.energy` and `hw.power` described in the previous section, to prevent summing up overlapping values.
"""


def create_hw_host_energy(meter: Meter) -> Counter:
    """Total energy consumed by the entire physical host, in joules"""
    return meter.create_counter(
        name=HW_HOST_ENERGY,
        description="Total energy consumed by the entire physical host, in joules",
        unit="J",
    )


HW_HOST_HEATING_MARGIN: Final = "hw.host.heating_margin"
"""
By how many degrees Celsius the temperature of the physical host can be increased, before reaching a warning threshold on one of the internal sensors
Instrument: gauge
Unit: Cel
"""


def create_hw_host_heating_margin(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """By how many degrees Celsius the temperature of the physical host can be increased, before reaching a warning threshold on one of the internal sensors"""
    return meter.create_observable_gauge(
        name=HW_HOST_HEATING_MARGIN,
        callbacks=callbacks,
        description="By how many degrees Celsius the temperature of the physical host can be increased, before reaching a warning threshold on one of the internal sensors",
        unit="Cel",
    )


HW_HOST_POWER: Final = "hw.host.power"
"""
Instantaneous power consumed by the entire physical host in Watts (`hw.host.energy` is preferred)
Instrument: gauge
Unit: W
Note: The overall energy usage of a host MUST be reported using the specific `hw.host.energy` and `hw.host.power` metrics **only**, instead of the generic `hw.energy` and `hw.power` described in the previous section, to prevent summing up overlapping values.
"""


def create_hw_host_power(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Instantaneous power consumed by the entire physical host in Watts (`hw.host.energy` is preferred)"""
    return meter.create_observable_gauge(
        name=HW_HOST_POWER,
        callbacks=callbacks,
        description="Instantaneous power consumed by the entire physical host in Watts (`hw.host.energy` is preferred)",
        unit="W",
    )


HW_POWER: Final = "hw.power"
"""
Instantaneous power consumed by the component
Instrument: gauge
Unit: W
Note: It is recommended to report `hw.energy` instead of `hw.power` when possible.
"""


def create_hw_power(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Instantaneous power consumed by the component"""
    return meter.create_observable_gauge(
        name=HW_POWER,
        callbacks=callbacks,
        description="Instantaneous power consumed by the component",
        unit="W",
    )


HW_STATUS: Final = "hw.status"
"""
Operational status: `1` (true) or `0` (false) for each of the possible states
Instrument: updowncounter
Unit: 1
Note: `hw.status` is currently specified as an *UpDownCounter* but would ideally be represented using a [*StateSet* as defined in OpenMetrics](https://github.com/prometheus/OpenMetrics/blob/v1.0.0/specification/OpenMetrics.md#stateset). This semantic convention will be updated once *StateSet* is specified in OpenTelemetry. This planned change is not expected to have any consequence on the way users query their timeseries backend to retrieve the values of `hw.status` over time.
"""


def create_hw_status(meter: Meter) -> UpDownCounter:
    """Operational status: `1` (true) or `0` (false) for each of the possible states"""
    return meter.create_up_down_counter(
        name=HW_STATUS,
        description="Operational status: `1` (true) or `0` (false) for each of the possible states",
        unit="1",
    )
