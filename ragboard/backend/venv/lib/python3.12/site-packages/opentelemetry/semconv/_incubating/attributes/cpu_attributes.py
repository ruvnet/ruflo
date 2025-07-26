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

CPU_LOGICAL_NUMBER: Final = "cpu.logical_number"
"""
The logical CPU number [0..n-1].
"""

CPU_MODE: Final = "cpu.mode"
"""
The mode of the CPU.
"""


class CpuModeValues(Enum):
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
    KERNEL = "kernel"
    """kernel."""
