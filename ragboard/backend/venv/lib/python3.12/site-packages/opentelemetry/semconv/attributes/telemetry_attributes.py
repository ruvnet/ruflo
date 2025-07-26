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

TELEMETRY_SDK_LANGUAGE: Final = "telemetry.sdk.language"
"""
The language of the telemetry SDK.
"""

TELEMETRY_SDK_NAME: Final = "telemetry.sdk.name"
"""
The name of the telemetry SDK as defined above.
Note: The OpenTelemetry SDK MUST set the `telemetry.sdk.name` attribute to `opentelemetry`.
If another SDK, like a fork or a vendor-provided implementation, is used, this SDK MUST set the
`telemetry.sdk.name` attribute to the fully-qualified class or module name of this SDK's main entry point
or another suitable identifier depending on the language.
The identifier `opentelemetry` is reserved and MUST NOT be used in this case.
All custom identifiers SHOULD be stable across different versions of an implementation.
"""

TELEMETRY_SDK_VERSION: Final = "telemetry.sdk.version"
"""
The version string of the telemetry SDK.
"""


class TelemetrySdkLanguageValues(Enum):
    CPP = "cpp"
    """cpp."""
    DOTNET = "dotnet"
    """dotnet."""
    ERLANG = "erlang"
    """erlang."""
    GO = "go"
    """go."""
    JAVA = "java"
    """java."""
    NODEJS = "nodejs"
    """nodejs."""
    PHP = "php"
    """php."""
    PYTHON = "python"
    """python."""
    RUBY = "ruby"
    """ruby."""
    RUST = "rust"
    """rust."""
    SWIFT = "swift"
    """swift."""
    WEBJS = "webjs"
    """webjs."""
