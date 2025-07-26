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

from typing import Final

EXCEPTION_ESCAPED: Final = "exception.escaped"
"""
Deprecated: It's no longer recommended to record exceptions that are handled and do not escape the scope of a span.
"""

EXCEPTION_MESSAGE: Final = "exception.message"
"""
The exception message.
"""

EXCEPTION_STACKTRACE: Final = "exception.stacktrace"
"""
A stacktrace as a string in the natural representation for the language runtime. The representation is to be determined and documented by each language SIG.
"""

EXCEPTION_TYPE: Final = "exception.type"
"""
The type of the exception (its fully-qualified class name, if applicable). The dynamic type of the exception should be preferred over the static type in languages that support it.
"""
