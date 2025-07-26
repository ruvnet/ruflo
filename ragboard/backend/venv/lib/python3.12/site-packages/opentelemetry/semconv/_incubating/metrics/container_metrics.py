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
)

# pylint: disable=invalid-name
CallbackT = Union[
    Callable[[CallbackOptions], Iterable[Observation]],
    Generator[Iterable[Observation], CallbackOptions, None],
]

CONTAINER_CPU_TIME: Final = "container.cpu.time"
"""
Total CPU time consumed
Instrument: counter
Unit: s
Note: Total CPU time consumed by the specific container on all available CPU cores.
"""


def create_container_cpu_time(meter: Meter) -> Counter:
    """Total CPU time consumed"""
    return meter.create_counter(
        name=CONTAINER_CPU_TIME,
        description="Total CPU time consumed",
        unit="s",
    )


CONTAINER_CPU_USAGE: Final = "container.cpu.usage"
"""
Container's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs
Instrument: gauge
Unit: {cpu}
Note: CPU usage of the specific container on all available CPU cores, averaged over the sample window.
"""


def create_container_cpu_usage(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Container's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs"""
    return meter.create_observable_gauge(
        name=CONTAINER_CPU_USAGE,
        callbacks=callbacks,
        description="Container's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs",
        unit="{cpu}",
    )


CONTAINER_DISK_IO: Final = "container.disk.io"
"""
Disk bytes for the container
Instrument: counter
Unit: By
Note: The total number of bytes read/written successfully (aggregated from all disks).
"""


def create_container_disk_io(meter: Meter) -> Counter:
    """Disk bytes for the container"""
    return meter.create_counter(
        name=CONTAINER_DISK_IO,
        description="Disk bytes for the container.",
        unit="By",
    )


CONTAINER_MEMORY_USAGE: Final = "container.memory.usage"
"""
Memory usage of the container
Instrument: counter
Unit: By
Note: Memory usage of the container.
"""


def create_container_memory_usage(meter: Meter) -> Counter:
    """Memory usage of the container"""
    return meter.create_counter(
        name=CONTAINER_MEMORY_USAGE,
        description="Memory usage of the container.",
        unit="By",
    )


CONTAINER_NETWORK_IO: Final = "container.network.io"
"""
Network bytes for the container
Instrument: counter
Unit: By
Note: The number of bytes sent/received on all network interfaces by the container.
"""


def create_container_network_io(meter: Meter) -> Counter:
    """Network bytes for the container"""
    return meter.create_counter(
        name=CONTAINER_NETWORK_IO,
        description="Network bytes for the container.",
        unit="By",
    )


CONTAINER_UPTIME: Final = "container.uptime"
"""
The time the container has been running
Instrument: gauge
Unit: s
Note: Instrumentations SHOULD use a gauge with type `double` and measure uptime in seconds as a floating point number with the highest precision available.
The actual accuracy would depend on the instrumentation and operating system.
"""


def create_container_uptime(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """The time the container has been running"""
    return meter.create_observable_gauge(
        name=CONTAINER_UPTIME,
        callbacks=callbacks,
        description="The time the container has been running",
        unit="s",
    )
