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

from enum import Enum
from typing import Final

from typing_extensions import deprecated

SYSTEM_CPU_LOGICAL_NUMBER: Final = "system.cpu.logical_number"
"""
Deprecated, use `cpu.logical_number` instead.
"""

SYSTEM_CPU_STATE: Final = "system.cpu.state"
"""
Deprecated: Replaced by `cpu.mode`.
"""

SYSTEM_DEVICE: Final = "system.device"
"""
The device identifier.
"""

SYSTEM_FILESYSTEM_MODE: Final = "system.filesystem.mode"
"""
The filesystem mode.
"""

SYSTEM_FILESYSTEM_MOUNTPOINT: Final = "system.filesystem.mountpoint"
"""
The filesystem mount path.
"""

SYSTEM_FILESYSTEM_STATE: Final = "system.filesystem.state"
"""
The filesystem state.
"""

SYSTEM_FILESYSTEM_TYPE: Final = "system.filesystem.type"
"""
The filesystem type.
"""

SYSTEM_MEMORY_STATE: Final = "system.memory.state"
"""
The memory state.
"""

SYSTEM_NETWORK_STATE: Final = "system.network.state"
"""
Deprecated: Replaced by `network.connection.state`.
"""

SYSTEM_PAGING_DIRECTION: Final = "system.paging.direction"
"""
The paging access direction.
"""

SYSTEM_PAGING_STATE: Final = "system.paging.state"
"""
The memory paging state.
"""

SYSTEM_PAGING_TYPE: Final = "system.paging.type"
"""
The memory paging type.
"""

SYSTEM_PROCESS_STATUS: Final = "system.process.status"
"""
The process state, e.g., [Linux Process State Codes](https://man7.org/linux/man-pages/man1/ps.1.html#PROCESS_STATE_CODES).
"""

SYSTEM_PROCESSES_STATUS: Final = "system.processes.status"
"""
Deprecated: Replaced by `system.process.status`.
"""


@deprecated(
    "The attribute system.cpu.state is deprecated - Replaced by `cpu.mode`"
)
class SystemCpuStateValues(Enum):
    USER = "user"
    """user."""
    SYSTEM = "system"
    """system."""
    NICE = "nice"
    """nice."""
    IDLE = "idle"
    """idle."""
    IOWAIT = "iowait"
    """iowait."""
    INTERRUPT = "interrupt"
    """interrupt."""
    STEAL = "steal"
    """steal."""


class SystemFilesystemStateValues(Enum):
    USED = "used"
    """used."""
    FREE = "free"
    """free."""
    RESERVED = "reserved"
    """reserved."""


class SystemFilesystemTypeValues(Enum):
    FAT32 = "fat32"
    """fat32."""
    EXFAT = "exfat"
    """exfat."""
    NTFS = "ntfs"
    """ntfs."""
    REFS = "refs"
    """refs."""
    HFSPLUS = "hfsplus"
    """hfsplus."""
    EXT4 = "ext4"
    """ext4."""


class SystemMemoryStateValues(Enum):
    USED = "used"
    """used."""
    FREE = "free"
    """free."""
    SHARED = "shared"
    """Deprecated: Removed, report shared memory usage with `metric.system.memory.shared` metric."""
    BUFFERS = "buffers"
    """buffers."""
    CACHED = "cached"
    """cached."""


@deprecated(
    "The attribute system.network.state is deprecated - Replaced by `network.connection.state`"
)
class SystemNetworkStateValues(Enum):
    CLOSE = "close"
    """close."""
    CLOSE_WAIT = "close_wait"
    """close_wait."""
    CLOSING = "closing"
    """closing."""
    DELETE = "delete"
    """delete."""
    ESTABLISHED = "established"
    """established."""
    FIN_WAIT_1 = "fin_wait_1"
    """fin_wait_1."""
    FIN_WAIT_2 = "fin_wait_2"
    """fin_wait_2."""
    LAST_ACK = "last_ack"
    """last_ack."""
    LISTEN = "listen"
    """listen."""
    SYN_RECV = "syn_recv"
    """syn_recv."""
    SYN_SENT = "syn_sent"
    """syn_sent."""
    TIME_WAIT = "time_wait"
    """time_wait."""


class SystemPagingDirectionValues(Enum):
    IN = "in"
    """in."""
    OUT = "out"
    """out."""


class SystemPagingStateValues(Enum):
    USED = "used"
    """used."""
    FREE = "free"
    """free."""


class SystemPagingTypeValues(Enum):
    MAJOR = "major"
    """major."""
    MINOR = "minor"
    """minor."""


class SystemProcessStatusValues(Enum):
    RUNNING = "running"
    """running."""
    SLEEPING = "sleeping"
    """sleeping."""
    STOPPED = "stopped"
    """stopped."""
    DEFUNCT = "defunct"
    """defunct."""


@deprecated(
    "The attribute system.processes.status is deprecated - Replaced by `system.process.status`"
)
class SystemProcessesStatusValues(Enum):
    RUNNING = "running"
    """running."""
    SLEEPING = "sleeping"
    """sleeping."""
    STOPPED = "stopped"
    """stopped."""
    DEFUNCT = "defunct"
    """defunct."""
