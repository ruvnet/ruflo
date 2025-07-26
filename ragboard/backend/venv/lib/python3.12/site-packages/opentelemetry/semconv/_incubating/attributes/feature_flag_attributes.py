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

FEATURE_FLAG_CONTEXT_ID: Final = "feature_flag.context.id"
"""
The unique identifier for the flag evaluation context. For example, the targeting key.
"""

FEATURE_FLAG_EVALUATION_ERROR_MESSAGE: Final = (
    "feature_flag.evaluation.error.message"
)
"""
Deprecated: Replaced by `error.message`.
"""

FEATURE_FLAG_EVALUATION_REASON: Final = "feature_flag.evaluation.reason"
"""
Deprecated: Replaced by `feature_flag.result.reason`.
"""

FEATURE_FLAG_KEY: Final = "feature_flag.key"
"""
The lookup key of the feature flag.
"""

FEATURE_FLAG_PROVIDER_NAME: Final = "feature_flag.provider.name"
"""
Identifies the feature flag provider.
"""

FEATURE_FLAG_RESULT_REASON: Final = "feature_flag.result.reason"
"""
The reason code which shows how a feature flag value was determined.
"""

FEATURE_FLAG_RESULT_VALUE: Final = "feature_flag.result.value"
"""
The evaluated value of the feature flag.
Note: With some feature flag providers, feature flag results can be quite large or contain private or sensitive details.
Because of this, `feature_flag.result.variant` is often the preferred attribute if it is available.

It may be desirable to redact or otherwise limit the size and scope of `feature_flag.result.value` if possible.
Because the evaluated flag value is unstructured and may be any type, it is left to the instrumentation author to determine how best to achieve this.
"""

FEATURE_FLAG_RESULT_VARIANT: Final = "feature_flag.result.variant"
"""
A semantic identifier for an evaluated flag value.
Note: A semantic identifier, commonly referred to as a variant, provides a means
for referring to a value without including the value itself. This can
provide additional context for understanding the meaning behind a value.
For example, the variant `red` maybe be used for the value `#c05543`.
"""

FEATURE_FLAG_SET_ID: Final = "feature_flag.set.id"
"""
The identifier of the [flag set](https://openfeature.dev/specification/glossary/#flag-set) to which the feature flag belongs.
"""

FEATURE_FLAG_VARIANT: Final = "feature_flag.variant"
"""
Deprecated: Replaced by `feature_flag.result.variant`.
"""

FEATURE_FLAG_VERSION: Final = "feature_flag.version"
"""
The version of the ruleset used during the evaluation. This may be any stable value which uniquely identifies the ruleset.
"""


@deprecated(
    "The attribute feature_flag.evaluation.reason is deprecated - Replaced by `feature_flag.result.reason`"
)
class FeatureFlagEvaluationReasonValues(Enum):
    STATIC = "static"
    """The resolved value is static (no dynamic evaluation)."""
    DEFAULT = "default"
    """The resolved value fell back to a pre-configured value (no dynamic evaluation occurred or dynamic evaluation yielded no result)."""
    TARGETING_MATCH = "targeting_match"
    """The resolved value was the result of a dynamic evaluation, such as a rule or specific user-targeting."""
    SPLIT = "split"
    """The resolved value was the result of pseudorandom assignment."""
    CACHED = "cached"
    """The resolved value was retrieved from cache."""
    DISABLED = "disabled"
    """The resolved value was the result of the flag being disabled in the management system."""
    UNKNOWN = "unknown"
    """The reason for the resolved value could not be determined."""
    STALE = "stale"
    """The resolved value is non-authoritative or possibly out of date."""
    ERROR = "error"
    """The resolved value was the result of an error."""


class FeatureFlagResultReasonValues(Enum):
    STATIC = "static"
    """The resolved value is static (no dynamic evaluation)."""
    DEFAULT = "default"
    """The resolved value fell back to a pre-configured value (no dynamic evaluation occurred or dynamic evaluation yielded no result)."""
    TARGETING_MATCH = "targeting_match"
    """The resolved value was the result of a dynamic evaluation, such as a rule or specific user-targeting."""
    SPLIT = "split"
    """The resolved value was the result of pseudorandom assignment."""
    CACHED = "cached"
    """The resolved value was retrieved from cache."""
    DISABLED = "disabled"
    """The resolved value was the result of the flag being disabled in the management system."""
    UNKNOWN = "unknown"
    """The reason for the resolved value could not be determined."""
    STALE = "stale"
    """The resolved value is non-authoritative or possibly out of date."""
    ERROR = "error"
    """The resolved value was the result of an error."""
