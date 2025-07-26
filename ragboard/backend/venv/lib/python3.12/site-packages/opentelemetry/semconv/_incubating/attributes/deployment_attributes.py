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

DEPLOYMENT_ENVIRONMENT: Final = "deployment.environment"
"""
Deprecated: Replaced by `deployment.environment.name`.
"""

DEPLOYMENT_ENVIRONMENT_NAME: Final = "deployment.environment.name"
"""
Name of the [deployment environment](https://wikipedia.org/wiki/Deployment_environment) (aka deployment tier).
Note: `deployment.environment.name` does not affect the uniqueness constraints defined through
the `service.namespace`, `service.name` and `service.instance.id` resource attributes.
This implies that resources carrying the following attribute combinations MUST be
considered to be identifying the same service:

- `service.name=frontend`, `deployment.environment.name=production`
- `service.name=frontend`, `deployment.environment.name=staging`.
"""

DEPLOYMENT_ID: Final = "deployment.id"
"""
The id of the deployment.
"""

DEPLOYMENT_NAME: Final = "deployment.name"
"""
The name of the deployment.
"""

DEPLOYMENT_STATUS: Final = "deployment.status"
"""
The status of the deployment.
"""


class DeploymentStatusValues(Enum):
    FAILED = "failed"
    """failed."""
    SUCCEEDED = "succeeded"
    """succeeded."""
