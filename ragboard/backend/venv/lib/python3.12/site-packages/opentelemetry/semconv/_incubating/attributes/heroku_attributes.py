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

HEROKU_APP_ID: Final = "heroku.app.id"
"""
Unique identifier for the application.
"""

HEROKU_RELEASE_COMMIT: Final = "heroku.release.commit"
"""
Commit hash for the current release.
"""

HEROKU_RELEASE_CREATION_TIMESTAMP: Final = "heroku.release.creation_timestamp"
"""
Time and date the release was created.
"""
