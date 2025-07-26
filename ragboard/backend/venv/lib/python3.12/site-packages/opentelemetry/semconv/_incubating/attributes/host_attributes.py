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

HOST_ARCH: Final = "host.arch"
"""
The CPU architecture the host system is running on.
"""

HOST_CPU_CACHE_L2_SIZE: Final = "host.cpu.cache.l2.size"
"""
The amount of level 2 memory cache available to the processor (in Bytes).
"""

HOST_CPU_FAMILY: Final = "host.cpu.family"
"""
Family or generation of the CPU.
"""

HOST_CPU_MODEL_ID: Final = "host.cpu.model.id"
"""
Model identifier. It provides more granular information about the CPU, distinguishing it from other CPUs within the same family.
"""

HOST_CPU_MODEL_NAME: Final = "host.cpu.model.name"
"""
Model designation of the processor.
"""

HOST_CPU_STEPPING: Final = "host.cpu.stepping"
"""
Stepping or core revisions.
"""

HOST_CPU_VENDOR_ID: Final = "host.cpu.vendor.id"
"""
Processor manufacturer identifier. A maximum 12-character string.
Note: [CPUID](https://wiki.osdev.org/CPUID) command returns the vendor ID string in EBX, EDX and ECX registers. Writing these to memory in this order results in a 12-character string.
"""

HOST_ID: Final = "host.id"
"""
Unique host ID. For Cloud, this must be the instance_id assigned by the cloud provider. For non-containerized systems, this should be the `machine-id`. See the table below for the sources to use to determine the `machine-id` based on operating system.
"""

HOST_IMAGE_ID: Final = "host.image.id"
"""
VM image ID or host OS image ID. For Cloud, this value is from the provider.
"""

HOST_IMAGE_NAME: Final = "host.image.name"
"""
Name of the VM image or OS install the host was instantiated from.
"""

HOST_IMAGE_VERSION: Final = "host.image.version"
"""
The version string of the VM image or host OS as defined in [Version Attributes](/docs/resource/README.md#version-attributes).
"""

HOST_IP: Final = "host.ip"
"""
Available IP addresses of the host, excluding loopback interfaces.
Note: IPv4 Addresses MUST be specified in dotted-quad notation. IPv6 addresses MUST be specified in the [RFC 5952](https://www.rfc-editor.org/rfc/rfc5952.html) format.
"""

HOST_MAC: Final = "host.mac"
"""
Available MAC addresses of the host, excluding loopback interfaces.
Note: MAC Addresses MUST be represented in [IEEE RA hexadecimal form](https://standards.ieee.org/wp-content/uploads/import/documents/tutorials/eui.pdf): as hyphen-separated octets in uppercase hexadecimal form from most to least significant.
"""

HOST_NAME: Final = "host.name"
"""
Name of the host. On Unix systems, it may contain what the hostname command returns, or the fully qualified hostname, or another name specified by the user.
"""

HOST_TYPE: Final = "host.type"
"""
Type of host. For Cloud, this must be the machine type.
"""


class HostArchValues(Enum):
    AMD64 = "amd64"
    """AMD64."""
    ARM32 = "arm32"
    """ARM32."""
    ARM64 = "arm64"
    """ARM64."""
    IA64 = "ia64"
    """Itanium."""
    PPC32 = "ppc32"
    """32-bit PowerPC."""
    PPC64 = "ppc64"
    """64-bit PowerPC."""
    S390X = "s390x"
    """IBM z/Architecture."""
    X86 = "x86"
    """32-bit x86."""
