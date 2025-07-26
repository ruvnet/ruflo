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

ERROR_MESSAGE: Final = "error.message"
"""
A message providing more detail about an error in human-readable form.
Note: `error.message` should provide additional context and detail about an error.
It is NOT RECOMMENDED to duplicate the value of `error.type` in `error.message`.
It is also NOT RECOMMENDED to duplicate the value of `exception.message` in `error.message`.

`error.message` is NOT RECOMMENDED for metrics or spans due to its unbounded cardinality and overlap with span status.
"""

ERROR_TYPE: Final = "error.type"
"""
Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.error_attributes.ERROR_TYPE`.
"""


@deprecated(
    "Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.error_attributes.ErrorTypeValues`."
)
class ErrorTypeValues(Enum):
    OTHER = "_OTHER"
    """Deprecated in favor of stable :py:const:`opentelemetry.semconv.attributes.error_attributes.ErrorTypeValues.OTHER`."""
