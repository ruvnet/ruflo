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

PROCESS_ARGS_COUNT: Final = "process.args_count"
"""
Length of the process.command_args array.
Note: This field can be useful for querying or performing bucket analysis on how many arguments were provided to start a process. More arguments may be an indication of suspicious activity.
"""

PROCESS_COMMAND: Final = "process.command"
"""
The command used to launch the process (i.e. the command name). On Linux based systems, can be set to the zeroth string in `proc/[pid]/cmdline`. On Windows, can be set to the first parameter extracted from `GetCommandLineW`.
"""

PROCESS_COMMAND_ARGS: Final = "process.command_args"
"""
All the command arguments (including the command/executable itself) as received by the process. On Linux-based systems (and some other Unixoid systems supporting procfs), can be set according to the list of null-delimited strings extracted from `proc/[pid]/cmdline`. For libc-based executables, this would be the full argv vector passed to `main`. SHOULD NOT be collected by default unless there is sanitization that excludes sensitive data.
"""

PROCESS_COMMAND_LINE: Final = "process.command_line"
"""
The full command used to launch the process as a single string representing the full command. On Windows, can be set to the result of `GetCommandLineW`. Do not set this if you have to assemble it just for monitoring; use `process.command_args` instead. SHOULD NOT be collected by default unless there is sanitization that excludes sensitive data.
"""

PROCESS_CONTEXT_SWITCH_TYPE: Final = "process.context_switch_type"
"""
Specifies whether the context switches for this data point were voluntary or involuntary.
"""

PROCESS_CPU_STATE: Final = "process.cpu.state"
"""
Deprecated: Replaced by `cpu.mode`.
"""

PROCESS_CREATION_TIME: Final = "process.creation.time"
"""
The date and time the process was created, in ISO 8601 format.
"""

PROCESS_ENVIRONMENT_VARIABLE_TEMPLATE: Final = "process.environment_variable"
"""
Process environment variables, `<key>` being the environment variable name, the value being the environment variable value.
Note: Examples:

- an environment variable `USER` with value `"ubuntu"` SHOULD be recorded
as the `process.environment_variable.USER` attribute with value `"ubuntu"`.

- an environment variable `PATH` with value `"/usr/local/bin:/usr/bin"`
SHOULD be recorded as the `process.environment_variable.PATH` attribute
with value `"/usr/local/bin:/usr/bin"`.
"""

PROCESS_EXECUTABLE_BUILD_ID_GNU: Final = "process.executable.build_id.gnu"
"""
The GNU build ID as found in the `.note.gnu.build-id` ELF section (hex string).
"""

PROCESS_EXECUTABLE_BUILD_ID_GO: Final = "process.executable.build_id.go"
"""
The Go build ID as retrieved by `go tool buildid <go executable>`.
"""

PROCESS_EXECUTABLE_BUILD_ID_HTLHASH: Final = (
    "process.executable.build_id.htlhash"
)
"""
Profiling specific build ID for executables. See the OTel specification for Profiles for more information.
"""

PROCESS_EXECUTABLE_BUILD_ID_PROFILING: Final = (
    "process.executable.build_id.profiling"
)
"""
Deprecated: Replaced by `process.executable.build_id.htlhash`.
"""

PROCESS_EXECUTABLE_NAME: Final = "process.executable.name"
"""
The name of the process executable. On Linux based systems, this SHOULD be set to the base name of the target of `/proc/[pid]/exe`. On Windows, this SHOULD be set to the base name of `GetProcessImageFileNameW`.
"""

PROCESS_EXECUTABLE_PATH: Final = "process.executable.path"
"""
The full path to the process executable. On Linux based systems, can be set to the target of `proc/[pid]/exe`. On Windows, can be set to the result of `GetProcessImageFileNameW`.
"""

PROCESS_EXIT_CODE: Final = "process.exit.code"
"""
The exit code of the process.
"""

PROCESS_EXIT_TIME: Final = "process.exit.time"
"""
The date and time the process exited, in ISO 8601 format.
"""

PROCESS_GROUP_LEADER_PID: Final = "process.group_leader.pid"
"""
The PID of the process's group leader. This is also the process group ID (PGID) of the process.
"""

PROCESS_INTERACTIVE: Final = "process.interactive"
"""
Whether the process is connected to an interactive shell.
"""

PROCESS_LINUX_CGROUP: Final = "process.linux.cgroup"
"""
The control group associated with the process.
Note: Control groups (cgroups) are a kernel feature used to organize and manage process resources. This attribute provides the path(s) to the cgroup(s) associated with the process, which should match the contents of the [/proc/\\[PID\\]/cgroup](https://man7.org/linux/man-pages/man7/cgroups.7.html) file.
"""

PROCESS_OWNER: Final = "process.owner"
"""
The username of the user that owns the process.
"""

PROCESS_PAGING_FAULT_TYPE: Final = "process.paging.fault_type"
"""
The type of page fault for this data point. Type `major` is for major/hard page faults, and `minor` is for minor/soft page faults.
"""

PROCESS_PARENT_PID: Final = "process.parent_pid"
"""
Parent Process identifier (PPID).
"""

PROCESS_PID: Final = "process.pid"
"""
Process identifier (PID).
"""

PROCESS_REAL_USER_ID: Final = "process.real_user.id"
"""
The real user ID (RUID) of the process.
"""

PROCESS_REAL_USER_NAME: Final = "process.real_user.name"
"""
The username of the real user of the process.
"""

PROCESS_RUNTIME_DESCRIPTION: Final = "process.runtime.description"
"""
An additional description about the runtime of the process, for example a specific vendor customization of the runtime environment.
"""

PROCESS_RUNTIME_NAME: Final = "process.runtime.name"
"""
The name of the runtime of this process.
"""

PROCESS_RUNTIME_VERSION: Final = "process.runtime.version"
"""
The version of the runtime of this process, as returned by the runtime without modification.
"""

PROCESS_SAVED_USER_ID: Final = "process.saved_user.id"
"""
The saved user ID (SUID) of the process.
"""

PROCESS_SAVED_USER_NAME: Final = "process.saved_user.name"
"""
The username of the saved user.
"""

PROCESS_SESSION_LEADER_PID: Final = "process.session_leader.pid"
"""
The PID of the process's session leader. This is also the session ID (SID) of the process.
"""

PROCESS_TITLE: Final = "process.title"
"""
Process title (proctitle).
Note: In many Unix-like systems, process title (proctitle), is the string that represents the name or command line of a running process, displayed by system monitoring tools like ps, top, and htop.
"""

PROCESS_USER_ID: Final = "process.user.id"
"""
The effective user ID (EUID) of the process.
"""

PROCESS_USER_NAME: Final = "process.user.name"
"""
The username of the effective user of the process.
"""

PROCESS_VPID: Final = "process.vpid"
"""
Virtual process identifier.
Note: The process ID within a PID namespace. This is not necessarily unique across all processes on the host but it is unique within the process namespace that the process exists within.
"""

PROCESS_WORKING_DIRECTORY: Final = "process.working_directory"
"""
The working directory of the process.
"""


class ProcessContextSwitchTypeValues(Enum):
    VOLUNTARY = "voluntary"
    """voluntary."""
    INVOLUNTARY = "involuntary"
    """involuntary."""


@deprecated(
    "The attribute process.cpu.state is deprecated - Replaced by `cpu.mode`"
)
class ProcessCpuStateValues(Enum):
    SYSTEM = "system"
    """system."""
    USER = "user"
    """user."""
    WAIT = "wait"
    """wait."""


class ProcessPagingFaultTypeValues(Enum):
    MAJOR = "major"
    """major."""
    MINOR = "minor"
    """minor."""
