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

ENDUSER_ID: Final = "enduser.id"
"""
Unique identifier of an end user in the system. It maybe a username, email address, or other identifier.
Note: Unique identifier of an end user in the system.

> [!Warning]
> This field contains sensitive (PII) information.
"""

ENDUSER_PSEUDO_ID: Final = "enduser.pseudo.id"
"""
Pseudonymous identifier of an end user. This identifier should be a random value that is not directly linked or associated with the end user's actual identity.
Note: Pseudonymous identifier of an end user.

> [!Warning]
> This field contains sensitive (linkable PII) information.
"""

ENDUSER_ROLE: Final = "enduser.role"
"""
Deprecated: Use `user.roles` attribute instead.
"""

ENDUSER_SCOPE: Final = "enduser.scope"
"""
Deprecated: Removed, no replacement at this time.
"""
