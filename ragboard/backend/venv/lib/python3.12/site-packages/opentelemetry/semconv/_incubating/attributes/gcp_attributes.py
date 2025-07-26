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

GCP_APPHUB_APPLICATION_CONTAINER: Final = "gcp.apphub.application.container"
"""
The container within GCP where the AppHub application is defined.
"""

GCP_APPHUB_APPLICATION_ID: Final = "gcp.apphub.application.id"
"""
The name of the application as configured in AppHub.
"""

GCP_APPHUB_APPLICATION_LOCATION: Final = "gcp.apphub.application.location"
"""
The GCP zone or region where the application is defined.
"""

GCP_APPHUB_SERVICE_CRITICALITY_TYPE: Final = (
    "gcp.apphub.service.criticality_type"
)
"""
Criticality of a service indicates its importance to the business.
Note: [See AppHub type enum](https://cloud.google.com/app-hub/docs/reference/rest/v1/Attributes#type).
"""

GCP_APPHUB_SERVICE_ENVIRONMENT_TYPE: Final = (
    "gcp.apphub.service.environment_type"
)
"""
Environment of a service is the stage of a software lifecycle.
Note: [See AppHub environment type](https://cloud.google.com/app-hub/docs/reference/rest/v1/Attributes#type_1).
"""

GCP_APPHUB_SERVICE_ID: Final = "gcp.apphub.service.id"
"""
The name of the service as configured in AppHub.
"""

GCP_APPHUB_WORKLOAD_CRITICALITY_TYPE: Final = (
    "gcp.apphub.workload.criticality_type"
)
"""
Criticality of a workload indicates its importance to the business.
Note: [See AppHub type enum](https://cloud.google.com/app-hub/docs/reference/rest/v1/Attributes#type).
"""

GCP_APPHUB_WORKLOAD_ENVIRONMENT_TYPE: Final = (
    "gcp.apphub.workload.environment_type"
)
"""
Environment of a workload is the stage of a software lifecycle.
Note: [See AppHub environment type](https://cloud.google.com/app-hub/docs/reference/rest/v1/Attributes#type_1).
"""

GCP_APPHUB_WORKLOAD_ID: Final = "gcp.apphub.workload.id"
"""
The name of the workload as configured in AppHub.
"""

GCP_CLIENT_SERVICE: Final = "gcp.client.service"
"""
Identifies the Google Cloud service for which the official client library is intended.
Note: Intended to be a stable identifier for Google Cloud client libraries that is uniform across implementation languages. The value should be derived from the canonical service domain for the service; for example, 'foo.googleapis.com' should result in a value of 'foo'.
"""

GCP_CLOUD_RUN_JOB_EXECUTION: Final = "gcp.cloud_run.job.execution"
"""
The name of the Cloud Run [execution](https://cloud.google.com/run/docs/managing/job-executions) being run for the Job, as set by the [`CLOUD_RUN_EXECUTION`](https://cloud.google.com/run/docs/container-contract#jobs-env-vars) environment variable.
"""

GCP_CLOUD_RUN_JOB_TASK_INDEX: Final = "gcp.cloud_run.job.task_index"
"""
The index for a task within an execution as provided by the [`CLOUD_RUN_TASK_INDEX`](https://cloud.google.com/run/docs/container-contract#jobs-env-vars) environment variable.
"""

GCP_GCE_INSTANCE_HOSTNAME: Final = "gcp.gce.instance.hostname"
"""
The hostname of a GCE instance. This is the full value of the default or [custom hostname](https://cloud.google.com/compute/docs/instances/custom-hostname-vm).
"""

GCP_GCE_INSTANCE_NAME: Final = "gcp.gce.instance.name"
"""
The instance name of a GCE instance. This is the value provided by `host.name`, the visible name of the instance in the Cloud Console UI, and the prefix for the default hostname of the instance as defined by the [default internal DNS name](https://cloud.google.com/compute/docs/internal-dns#instance-fully-qualified-domain-names).
"""


class GcpApphubServiceCriticalityTypeValues(Enum):
    MISSION_CRITICAL = "MISSION_CRITICAL"
    """Mission critical service."""
    HIGH = "HIGH"
    """High impact."""
    MEDIUM = "MEDIUM"
    """Medium impact."""
    LOW = "LOW"
    """Low impact."""


class GcpApphubServiceEnvironmentTypeValues(Enum):
    PRODUCTION = "PRODUCTION"
    """Production environment."""
    STAGING = "STAGING"
    """Staging environment."""
    TEST = "TEST"
    """Test environment."""
    DEVELOPMENT = "DEVELOPMENT"
    """Development environment."""


class GcpApphubWorkloadCriticalityTypeValues(Enum):
    MISSION_CRITICAL = "MISSION_CRITICAL"
    """Mission critical service."""
    HIGH = "HIGH"
    """High impact."""
    MEDIUM = "MEDIUM"
    """Medium impact."""
    LOW = "LOW"
    """Low impact."""


class GcpApphubWorkloadEnvironmentTypeValues(Enum):
    PRODUCTION = "PRODUCTION"
    """Production environment."""
    STAGING = "STAGING"
    """Staging environment."""
    TEST = "TEST"
    """Test environment."""
    DEVELOPMENT = "DEVELOPMENT"
    """Development environment."""
