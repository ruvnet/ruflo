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

LOG_FILE_NAME: Final = "log.file.name"
"""
The basename of the file.
"""

LOG_FILE_NAME_RESOLVED: Final = "log.file.name_resolved"
"""
The basename of the file, with symlinks resolved.
"""

LOG_FILE_PATH: Final = "log.file.path"
"""
The full path to the file.
"""

LOG_FILE_PATH_RESOLVED: Final = "log.file.path_resolved"
"""
The full path to the file, with symlinks resolved.
"""

LOG_IOSTREAM: Final = "log.iostream"
"""
The stream associated with the log. See below for a list of well-known values.
"""

LOG_RECORD_ORIGINAL: Final = "log.record.original"
"""
The complete original Log Record.
Note: This value MAY be added when processing a Log Record which was originally transmitted as a string or equivalent data type AND the Body field of the Log Record does not contain the same value. (e.g. a syslog or a log record read from a file.).
"""

LOG_RECORD_UID: Final = "log.record.uid"
"""
A unique identifier for the Log Record.
Note: If an id is provided, other log records with the same id will be considered duplicates and can be removed safely. This means, that two distinguishable log records MUST have different values.
The id MAY be an [Universally Unique Lexicographically Sortable Identifier (ULID)](https://github.com/ulid/spec), but other identifiers (e.g. UUID) may be used as needed.
"""


class LogIostreamValues(Enum):
    STDOUT = "stdout"
    """Logs from stdout stream."""
    STDERR = "stderr"
    """Events from stderr stream."""
