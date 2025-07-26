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

USER_EMAIL: Final = "user.email"
"""
User email address.
"""

USER_FULL_NAME: Final = "user.full_name"
"""
User's full name.
"""

USER_HASH: Final = "user.hash"
"""
Unique user hash to correlate information for a user in anonymized form.
Note: Useful if `user.id` or `user.name` contain confidential information and cannot be used.
"""

USER_ID: Final = "user.id"
"""
Unique identifier of the user.
"""

USER_NAME: Final = "user.name"
"""
Short name or login/username of the user.
"""

USER_ROLES: Final = "user.roles"
"""
Array of user roles at the time of the event.
"""
