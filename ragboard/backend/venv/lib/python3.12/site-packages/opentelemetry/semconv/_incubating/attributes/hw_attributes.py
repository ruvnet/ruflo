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

HW_ID: Final = "hw.id"
"""
An identifier for the hardware component, unique within the monitored host.
"""

HW_NAME: Final = "hw.name"
"""
An easily-recognizable name for the hardware component.
"""

HW_PARENT: Final = "hw.parent"
"""
Unique identifier of the parent component (typically the `hw.id` attribute of the enclosure, or disk controller).
"""

HW_STATE: Final = "hw.state"
"""
The current state of the component.
"""

HW_TYPE: Final = "hw.type"
"""
Type of the component.
Note: Describes the category of the hardware component for which `hw.state` is being reported. For example, `hw.type=temperature` along with `hw.state=degraded` would indicate that the temperature of the hardware component has been reported as `degraded`.
"""


class HwStateValues(Enum):
    OK = "ok"
    """Ok."""
    DEGRADED = "degraded"
    """Degraded."""
    FAILED = "failed"
    """Failed."""


class HwTypeValues(Enum):
    BATTERY = "battery"
    """Battery."""
    CPU = "cpu"
    """CPU."""
    DISK_CONTROLLER = "disk_controller"
    """Disk controller."""
    ENCLOSURE = "enclosure"
    """Enclosure."""
    FAN = "fan"
    """Fan."""
    GPU = "gpu"
    """GPU."""
    LOGICAL_DISK = "logical_disk"
    """Logical disk."""
    MEMORY = "memory"
    """Memory."""
    NETWORK = "network"
    """Network."""
    PHYSICAL_DISK = "physical_disk"
    """Physical disk."""
    POWER_SUPPLY = "power_supply"
    """Power supply."""
    TAPE_DRIVE = "tape_drive"
    """Tape drive."""
    TEMPERATURE = "temperature"
    """Temperature."""
    VOLTAGE = "voltage"
    """Voltage."""
