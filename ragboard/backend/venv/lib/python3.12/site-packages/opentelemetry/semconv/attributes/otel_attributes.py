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

OTEL_SCOPE_NAME: Final = "otel.scope.name"
"""
The name of the instrumentation scope - (`InstrumentationScope.Name` in OTLP).
"""

OTEL_SCOPE_VERSION: Final = "otel.scope.version"
"""
The version of the instrumentation scope - (`InstrumentationScope.Version` in OTLP).
"""

OTEL_STATUS_CODE: Final = "otel.status_code"
"""
Name of the code, either "OK" or "ERROR". MUST NOT be set if the status code is UNSET.
"""

OTEL_STATUS_DESCRIPTION: Final = "otel.status_description"
"""
Description of the Status if it has a value, otherwise not set.
"""


class OtelStatusCodeValues(Enum):
    OK = "OK"
    """The operation has been validated by an Application developer or Operator to have completed successfully."""
    ERROR = "ERROR"
    """The operation contains an error."""
