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

TELEMETRY_DISTRO_NAME: Final = "telemetry.distro.name"
"""
The name of the auto instrumentation agent or distribution, if used.
Note: Official auto instrumentation agents and distributions SHOULD set the `telemetry.distro.name` attribute to
a string starting with `opentelemetry-`, e.g. `opentelemetry-java-instrumentation`.
"""

TELEMETRY_DISTRO_VERSION: Final = "telemetry.distro.version"
"""
The version string of the auto instrumentation agent or distribution, if used.
"""

TELEMETRY_SDK_LANGUAGE: Final = "telemetry.sdk.language"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TELEMETRY_SDK_LANGUAGE`.
"""

TELEMETRY_SDK_NAME: Final = "telemetry.sdk.name"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TELEMETRY_SDK_NAME`.
"""

TELEMETRY_SDK_VERSION: Final = "telemetry.sdk.version"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TELEMETRY_SDK_VERSION`.
"""


@deprecated(
    "Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues`."
)
class TelemetrySdkLanguageValues(Enum):
    CPP = "cpp"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.CPP`."""
    DOTNET = "dotnet"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.DOTNET`."""
    ERLANG = "erlang"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.ERLANG`."""
    GO = "go"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.GO`."""
    JAVA = "java"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.JAVA`."""
    NODEJS = "nodejs"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.NODEJS`."""
    PHP = "php"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.PHP`."""
    PYTHON = "python"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.PYTHON`."""
    RUBY = "ruby"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.RUBY`."""
    RUST = "rust"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.RUST`."""
    SWIFT = "swift"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.SWIFT`."""
    WEBJS = "webjs"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.telemetry_attributes.TelemetrySdkLanguageValues.WEBJS`."""
