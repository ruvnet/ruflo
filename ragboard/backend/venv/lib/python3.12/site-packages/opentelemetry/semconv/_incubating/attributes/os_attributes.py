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

OS_BUILD_ID: Final = "os.build_id"
"""
Unique identifier for a particular build or compilation of the operating system.
"""

OS_DESCRIPTION: Final = "os.description"
"""
Human readable (not intended to be parsed) OS version information, like e.g. reported by `ver` or `lsb_release -a` commands.
"""

OS_NAME: Final = "os.name"
"""
Human readable operating system name.
"""

OS_TYPE: Final = "os.type"
"""
The operating system type.
"""

OS_VERSION: Final = "os.version"
"""
The version string of the operating system as defined in [Version Attributes](/docs/resource/README.md#version-attributes).
"""


class OsTypeValues(Enum):
    WINDOWS = "windows"
    """Microsoft Windows."""
    LINUX = "linux"
    """Linux."""
    DARWIN = "darwin"
    """Apple Darwin."""
    FREEBSD = "freebsd"
    """FreeBSD."""
    NETBSD = "netbsd"
    """NetBSD."""
    OPENBSD = "openbsd"
    """OpenBSD."""
    DRAGONFLYBSD = "dragonflybsd"
    """DragonFly BSD."""
    HPUX = "hpux"
    """HP-UX (Hewlett Packard Unix)."""
    AIX = "aix"
    """AIX (Advanced Interactive eXecutive)."""
    SOLARIS = "solaris"
    """SunOS, Oracle Solaris."""
    Z_OS = "z_os"
    """Deprecated: Replaced by `zos`."""
    ZOS = "zos"
    """IBM z/OS."""
