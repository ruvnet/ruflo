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

SYSTEM_CPU_FREQUENCY: Final = "system.cpu.frequency"
"""
Operating frequency of the logical CPU in Hertz
Instrument: gauge
Unit: Hz
"""


def create_system_cpu_frequency(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Operating frequency of the logical CPU in Hertz"""
    return meter.create_observable_gauge(
        name=SYSTEM_CPU_FREQUENCY,
        callbacks=callbacks,
        description="Operating frequency of the logical CPU in Hertz.",
        unit="Hz",
    )


SYSTEM_CPU_LOGICAL_COUNT: Final = "system.cpu.logical.count"
"""
Reports the number of logical (virtual) processor cores created by the operating system to manage multitasking
Instrument: updowncounter
Unit: {cpu}
Note: Calculated by multiplying the number of sockets by the number of cores per socket, and then by the number of threads per core.
"""


def create_system_cpu_logical_count(meter: Meter) -> UpDownCounter:
    """Reports the number of logical (virtual) processor cores created by the operating system to manage multitasking"""
    return meter.create_up_down_counter(
        name=SYSTEM_CPU_LOGICAL_COUNT,
        description="Reports the number of logical (virtual) processor cores created by the operating system to manage multitasking",
        unit="{cpu}",
    )


SYSTEM_CPU_PHYSICAL_COUNT: Final = "system.cpu.physical.count"
"""
Reports the number of actual physical processor cores on the hardware
Instrument: updowncounter
Unit: {cpu}
Note: Calculated by multiplying the number of sockets by the number of cores per socket.
"""


def create_system_cpu_physical_count(meter: Meter) -> UpDownCounter:
    """Reports the number of actual physical processor cores on the hardware"""
    return meter.create_up_down_counter(
        name=SYSTEM_CPU_PHYSICAL_COUNT,
        description="Reports the number of actual physical processor cores on the hardware",
        unit="{cpu}",
    )


SYSTEM_CPU_TIME: Final = "system.cpu.time"
"""
Seconds each logical CPU spent on each mode
Instrument: counter
Unit: s
"""


def create_system_cpu_time(meter: Meter) -> Counter:
    """Seconds each logical CPU spent on each mode"""
    return meter.create_counter(
        name=SYSTEM_CPU_TIME,
        description="Seconds each logical CPU spent on each mode",
        unit="s",
    )


SYSTEM_CPU_UTILIZATION: Final = "system.cpu.utilization"
"""
For each logical CPU, the utilization is calculated as the change in cumulative CPU time (cpu.time) over a measurement interval, divided by the elapsed time
Instrument: gauge
Unit: 1
"""


def create_system_cpu_utilization(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """For each logical CPU, the utilization is calculated as the change in cumulative CPU time (cpu.time) over a measurement interval, divided by the elapsed time"""
    return meter.create_observable_gauge(
        name=SYSTEM_CPU_UTILIZATION,
        callbacks=callbacks,
        description="For each logical CPU, the utilization is calculated as the change in cumulative CPU time (cpu.time) over a measurement interval, divided by the elapsed time.",
        unit="1",
    )


SYSTEM_DISK_IO: Final = "system.disk.io"
"""
Instrument: counter
Unit: By
"""


def create_system_disk_io(meter: Meter) -> Counter:
    return meter.create_counter(
        name=SYSTEM_DISK_IO,
        description="",
        unit="By",
    )


SYSTEM_DISK_IO_TIME: Final = "system.disk.io_time"
"""
Time disk spent activated
Instrument: counter
Unit: s
Note: The real elapsed time ("wall clock") used in the I/O path (time from operations running in parallel are not counted). Measured as:

- Linux: Field 13 from [procfs-diskstats](https://www.kernel.org/doc/Documentation/ABI/testing/procfs-diskstats)
- Windows: The complement of
  ["Disk\\% Idle Time"](https://learn.microsoft.com/archive/blogs/askcore/windows-performance-monitor-disk-counters-explained#windows-performance-monitor-disk-counters-explained)
  performance counter: `uptime * (100 - "Disk\\% Idle Time") / 100`.
"""


def create_system_disk_io_time(meter: Meter) -> Counter:
    """Time disk spent activated"""
    return meter.create_counter(
        name=SYSTEM_DISK_IO_TIME,
        description="Time disk spent activated",
        unit="s",
    )


SYSTEM_DISK_LIMIT: Final = "system.disk.limit"
"""
The total storage capacity of the disk
Instrument: updowncounter
Unit: By
"""


def create_system_disk_limit(meter: Meter) -> UpDownCounter:
    """The total storage capacity of the disk"""
    return meter.create_up_down_counter(
        name=SYSTEM_DISK_LIMIT,
        description="The total storage capacity of the disk",
        unit="By",
    )


SYSTEM_DISK_MERGED: Final = "system.disk.merged"
"""
Instrument: counter
Unit: {operation}
"""


def create_system_disk_merged(meter: Meter) -> Counter:
    return meter.create_counter(
        name=SYSTEM_DISK_MERGED,
        description="",
        unit="{operation}",
    )


SYSTEM_DISK_OPERATION_TIME: Final = "system.disk.operation_time"
"""
Sum of the time each operation took to complete
Instrument: counter
Unit: s
Note: Because it is the sum of time each request took, parallel-issued requests each contribute to make the count grow. Measured as:

- Linux: Fields 7 & 11 from [procfs-diskstats](https://www.kernel.org/doc/Documentation/ABI/testing/procfs-diskstats)
- Windows: "Avg. Disk sec/Read" perf counter multiplied by "Disk Reads/sec" perf counter (similar for Writes).
"""


def create_system_disk_operation_time(meter: Meter) -> Counter:
    """Sum of the time each operation took to complete"""
    return meter.create_counter(
        name=SYSTEM_DISK_OPERATION_TIME,
        description="Sum of the time each operation took to complete",
        unit="s",
    )


SYSTEM_DISK_OPERATIONS: Final = "system.disk.operations"
"""
Instrument: counter
Unit: {operation}
"""


def create_system_disk_operations(meter: Meter) -> Counter:
    return meter.create_counter(
        name=SYSTEM_DISK_OPERATIONS,
        description="",
        unit="{operation}",
    )


SYSTEM_FILESYSTEM_LIMIT: Final = "system.filesystem.limit"
"""
The total storage capacity of the filesystem
Instrument: updowncounter
Unit: By
"""


def create_system_filesystem_limit(meter: Meter) -> UpDownCounter:
    """The total storage capacity of the filesystem"""
    return meter.create_up_down_counter(
        name=SYSTEM_FILESYSTEM_LIMIT,
        description="The total storage capacity of the filesystem",
        unit="By",
    )


SYSTEM_FILESYSTEM_USAGE: Final = "system.filesystem.usage"
"""
Reports a filesystem's space usage across different states
Instrument: updowncounter
Unit: By
Note: The sum of all `system.filesystem.usage` values over the different `system.filesystem.state` attributes
SHOULD equal the total storage capacity of the filesystem, that is `system.filesystem.limit`.
"""


def create_system_filesystem_usage(meter: Meter) -> UpDownCounter:
    """Reports a filesystem's space usage across different states"""
    return meter.create_up_down_counter(
        name=SYSTEM_FILESYSTEM_USAGE,
        description="Reports a filesystem's space usage across different states.",
        unit="By",
    )


SYSTEM_FILESYSTEM_UTILIZATION: Final = "system.filesystem.utilization"
"""
Instrument: gauge
Unit: 1
"""


def create_system_filesystem_utilization(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    return meter.create_observable_gauge(
        name=SYSTEM_FILESYSTEM_UTILIZATION,
        callbacks=callbacks,
        description="",
        unit="1",
    )


SYSTEM_LINUX_MEMORY_AVAILABLE: Final = "system.linux.memory.available"
"""
An estimate of how much memory is available for starting new applications, without causing swapping
Instrument: updowncounter
Unit: By
Note: This is an alternative to `system.memory.usage` metric with `state=free`.
Linux starting from 3.14 exports "available" memory. It takes "free" memory as a baseline, and then factors in kernel-specific values.
This is supposed to be more accurate than just "free" memory.
For reference, see the calculations [here](https://superuser.com/a/980821).
See also `MemAvailable` in [/proc/meminfo](https://man7.org/linux/man-pages/man5/proc.5.html).
"""


def create_system_linux_memory_available(meter: Meter) -> UpDownCounter:
    """An estimate of how much memory is available for starting new applications, without causing swapping"""
    return meter.create_up_down_counter(
        name=SYSTEM_LINUX_MEMORY_AVAILABLE,
        description="An estimate of how much memory is available for starting new applications, without causing swapping",
        unit="By",
    )


SYSTEM_LINUX_MEMORY_SLAB_USAGE: Final = "system.linux.memory.slab.usage"
"""
Reports the memory used by the Linux kernel for managing caches of frequently used objects
Instrument: updowncounter
Unit: By
Note: The sum over the `reclaimable` and `unreclaimable` state values in `linux.memory.slab.usage` SHOULD be equal to the total slab memory available on the system.
Note that the total slab memory is not constant and may vary over time.
See also the [Slab allocator](https://blogs.oracle.com/linux/post/understanding-linux-kernel-memory-statistics) and `Slab` in [/proc/meminfo](https://man7.org/linux/man-pages/man5/proc.5.html).
"""


def create_system_linux_memory_slab_usage(meter: Meter) -> UpDownCounter:
    """Reports the memory used by the Linux kernel for managing caches of frequently used objects"""
    return meter.create_up_down_counter(
        name=SYSTEM_LINUX_MEMORY_SLAB_USAGE,
        description="Reports the memory used by the Linux kernel for managing caches of frequently used objects.",
        unit="By",
    )


SYSTEM_MEMORY_LIMIT: Final = "system.memory.limit"
"""
Total memory available in the system
Instrument: updowncounter
Unit: By
Note: Its value SHOULD equal the sum of `system.memory.state` over all states.
"""


def create_system_memory_limit(meter: Meter) -> UpDownCounter:
    """Total memory available in the system"""
    return meter.create_up_down_counter(
        name=SYSTEM_MEMORY_LIMIT,
        description="Total memory available in the system.",
        unit="By",
    )


SYSTEM_MEMORY_SHARED: Final = "system.memory.shared"
"""
Shared memory used (mostly by tmpfs)
Instrument: updowncounter
Unit: By
Note: Equivalent of `shared` from [`free` command](https://man7.org/linux/man-pages/man1/free.1.html) or
`Shmem` from [`/proc/meminfo`](https://man7.org/linux/man-pages/man5/proc.5.html)".
"""


def create_system_memory_shared(meter: Meter) -> UpDownCounter:
    """Shared memory used (mostly by tmpfs)"""
    return meter.create_up_down_counter(
        name=SYSTEM_MEMORY_SHARED,
        description="Shared memory used (mostly by tmpfs).",
        unit="By",
    )


SYSTEM_MEMORY_USAGE: Final = "system.memory.usage"
"""
Reports memory in use by state
Instrument: updowncounter
Unit: By
Note: The sum over all `system.memory.state` values SHOULD equal the total memory
available on the system, that is `system.memory.limit`.
"""


def create_system_memory_usage(meter: Meter) -> UpDownCounter:
    """Reports memory in use by state"""
    return meter.create_up_down_counter(
        name=SYSTEM_MEMORY_USAGE,
        description="Reports memory in use by state.",
        unit="By",
    )


SYSTEM_MEMORY_UTILIZATION: Final = "system.memory.utilization"
"""
Instrument: gauge
Unit: 1
"""


def create_system_memory_utilization(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    return meter.create_observable_gauge(
        name=SYSTEM_MEMORY_UTILIZATION,
        callbacks=callbacks,
        description="",
        unit="1",
    )


SYSTEM_NETWORK_CONNECTION_COUNT: Final = "system.network.connection.count"
"""
Instrument: updowncounter
Unit: {connection}
"""


def create_system_network_connection_count(meter: Meter) -> UpDownCounter:
    return meter.create_up_down_counter(
        name=SYSTEM_NETWORK_CONNECTION_COUNT,
        description="",
        unit="{connection}",
    )


SYSTEM_NETWORK_CONNECTIONS: Final = "system.network.connections"
"""
Deprecated: Replaced by `system.network.connection.count`.
"""


def create_system_network_connections(meter: Meter) -> UpDownCounter:
    """Deprecated, use `system.network.connection.count` instead"""
    return meter.create_up_down_counter(
        name=SYSTEM_NETWORK_CONNECTIONS,
        description="Deprecated, use `system.network.connection.count` instead",
        unit="{connection}",
    )


SYSTEM_NETWORK_DROPPED: Final = "system.network.dropped"
"""
Count of packets that are dropped or discarded even though there was no error
Instrument: counter
Unit: {packet}
Note: Measured as:

- Linux: the `drop` column in `/proc/dev/net` ([source](https://web.archive.org/web/20180321091318/http://www.onlamp.com/pub/a/linux/2000/11/16/LinuxAdmin.html))
- Windows: [`InDiscards`/`OutDiscards`](https://docs.microsoft.com/windows/win32/api/netioapi/ns-netioapi-mib_if_row2)
  from [`GetIfEntry2`](https://docs.microsoft.com/windows/win32/api/netioapi/nf-netioapi-getifentry2).
"""


def create_system_network_dropped(meter: Meter) -> Counter:
    """Count of packets that are dropped or discarded even though there was no error"""
    return meter.create_counter(
        name=SYSTEM_NETWORK_DROPPED,
        description="Count of packets that are dropped or discarded even though there was no error",
        unit="{packet}",
    )


SYSTEM_NETWORK_ERRORS: Final = "system.network.errors"
"""
Count of network errors detected
Instrument: counter
Unit: {error}
Note: Measured as:

- Linux: the `errs` column in `/proc/dev/net` ([source](https://web.archive.org/web/20180321091318/http://www.onlamp.com/pub/a/linux/2000/11/16/LinuxAdmin.html)).
- Windows: [`InErrors`/`OutErrors`](https://docs.microsoft.com/windows/win32/api/netioapi/ns-netioapi-mib_if_row2)
  from [`GetIfEntry2`](https://docs.microsoft.com/windows/win32/api/netioapi/nf-netioapi-getifentry2).
"""


def create_system_network_errors(meter: Meter) -> Counter:
    """Count of network errors detected"""
    return meter.create_counter(
        name=SYSTEM_NETWORK_ERRORS,
        description="Count of network errors detected",
        unit="{error}",
    )


SYSTEM_NETWORK_IO: Final = "system.network.io"
"""
Instrument: counter
Unit: By
"""


def create_system_network_io(meter: Meter) -> Counter:
    return meter.create_counter(
        name=SYSTEM_NETWORK_IO,
        description="",
        unit="By",
    )


SYSTEM_NETWORK_PACKETS: Final = "system.network.packets"
"""
Instrument: counter
Unit: {packet}
"""


def create_system_network_packets(meter: Meter) -> Counter:
    return meter.create_counter(
        name=SYSTEM_NETWORK_PACKETS,
        description="",
        unit="{packet}",
    )


SYSTEM_PAGING_FAULTS: Final = "system.paging.faults"
"""
Instrument: counter
Unit: {fault}
"""


def create_system_paging_faults(meter: Meter) -> Counter:
    return meter.create_counter(
        name=SYSTEM_PAGING_FAULTS,
        description="",
        unit="{fault}",
    )


SYSTEM_PAGING_OPERATIONS: Final = "system.paging.operations"
"""
Instrument: counter
Unit: {operation}
"""


def create_system_paging_operations(meter: Meter) -> Counter:
    return meter.create_counter(
        name=SYSTEM_PAGING_OPERATIONS,
        description="",
        unit="{operation}",
    )


SYSTEM_PAGING_USAGE: Final = "system.paging.usage"
"""
Unix swap or windows pagefile usage
Instrument: updowncounter
Unit: By
"""


def create_system_paging_usage(meter: Meter) -> UpDownCounter:
    """Unix swap or windows pagefile usage"""
    return meter.create_up_down_counter(
        name=SYSTEM_PAGING_USAGE,
        description="Unix swap or windows pagefile usage",
        unit="By",
    )


SYSTEM_PAGING_UTILIZATION: Final = "system.paging.utilization"
"""
Instrument: gauge
Unit: 1
"""


def create_system_paging_utilization(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    return meter.create_observable_gauge(
        name=SYSTEM_PAGING_UTILIZATION,
        callbacks=callbacks,
        description="",
        unit="1",
    )


SYSTEM_PROCESS_COUNT: Final = "system.process.count"
"""
Total number of processes in each state
Instrument: updowncounter
Unit: {process}
"""


def create_system_process_count(meter: Meter) -> UpDownCounter:
    """Total number of processes in each state"""
    return meter.create_up_down_counter(
        name=SYSTEM_PROCESS_COUNT,
        description="Total number of processes in each state",
        unit="{process}",
    )


SYSTEM_PROCESS_CREATED: Final = "system.process.created"
"""
Total number of processes created over uptime of the host
Instrument: counter
Unit: {process}
"""


def create_system_process_created(meter: Meter) -> Counter:
    """Total number of processes created over uptime of the host"""
    return meter.create_counter(
        name=SYSTEM_PROCESS_CREATED,
        description="Total number of processes created over uptime of the host",
        unit="{process}",
    )


SYSTEM_UPTIME: Final = "system.uptime"
"""
The time the system has been running
Instrument: gauge
Unit: s
Note: Instrumentations SHOULD use a gauge with type `double` and measure uptime in seconds as a floating point number with the highest precision available.
The actual accuracy would depend on the instrumentation and operating system.
"""


def create_system_uptime(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """The time the system has been running"""
    return meter.create_observable_gauge(
        name=SYSTEM_UPTIME,
        callbacks=callbacks,
        description="The time the system has been running",
        unit="s",
    )
