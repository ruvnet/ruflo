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

FAAS_COLDSTART: Final = "faas.coldstart"
"""
A boolean that is true if the serverless function is executed for the first time (aka cold-start).
"""

FAAS_CRON: Final = "faas.cron"
"""
A string containing the schedule period as [Cron Expression](https://docs.oracle.com/cd/E12058_01/doc/doc.1014/e12030/cron_expressions.htm).
"""

FAAS_DOCUMENT_COLLECTION: Final = "faas.document.collection"
"""
The name of the source on which the triggering operation was performed. For example, in Cloud Storage or S3 corresponds to the bucket name, and in Cosmos DB to the database name.
"""

FAAS_DOCUMENT_NAME: Final = "faas.document.name"
"""
The document name/table subjected to the operation. For example, in Cloud Storage or S3 is the name of the file, and in Cosmos DB the table name.
"""

FAAS_DOCUMENT_OPERATION: Final = "faas.document.operation"
"""
Describes the type of the operation that was performed on the data.
"""

FAAS_DOCUMENT_TIME: Final = "faas.document.time"
"""
A string containing the time when the data was accessed in the [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format expressed in [UTC](https://www.w3.org/TR/NOTE-datetime).
"""

FAAS_INSTANCE: Final = "faas.instance"
"""
The execution environment ID as a string, that will be potentially reused for other invocations to the same function/function version.
Note: - **AWS Lambda:** Use the (full) log stream name.
"""

FAAS_INVOCATION_ID: Final = "faas.invocation_id"
"""
The invocation ID of the current function invocation.
"""

FAAS_INVOKED_NAME: Final = "faas.invoked_name"
"""
The name of the invoked function.
Note: SHOULD be equal to the `faas.name` resource attribute of the invoked function.
"""

FAAS_INVOKED_PROVIDER: Final = "faas.invoked_provider"
"""
The cloud provider of the invoked function.
Note: SHOULD be equal to the `cloud.provider` resource attribute of the invoked function.
"""

FAAS_INVOKED_REGION: Final = "faas.invoked_region"
"""
The cloud region of the invoked function.
Note: SHOULD be equal to the `cloud.region` resource attribute of the invoked function.
"""

FAAS_MAX_MEMORY: Final = "faas.max_memory"
"""
The amount of memory available to the serverless function converted to Bytes.
Note: It's recommended to set this attribute since e.g. too little memory can easily stop a Java AWS Lambda function from working correctly. On AWS Lambda, the environment variable `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` provides this information (which must be multiplied by 1,048,576).
"""

FAAS_NAME: Final = "faas.name"
"""
The name of the single function that this runtime instance executes.
Note: This is the name of the function as configured/deployed on the FaaS
platform and is usually different from the name of the callback
function (which may be stored in the
[`code.namespace`/`code.function.name`](/docs/general/attributes.md#source-code-attributes)
span attributes).

For some cloud providers, the above definition is ambiguous. The following
definition of function name MUST be used for this attribute
(and consequently the span name) for the listed cloud providers/products:

- **Azure:**  The full name `<FUNCAPP>/<FUNC>`, i.e., function app name
  followed by a forward slash followed by the function name (this form
  can also be seen in the resource JSON for the function).
  This means that a span attribute MUST be used, as an Azure function
  app can host multiple functions that would usually share
  a TracerProvider (see also the `cloud.resource_id` attribute).
"""

FAAS_TIME: Final = "faas.time"
"""
A string containing the function invocation time in the [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format expressed in [UTC](https://www.w3.org/TR/NOTE-datetime).
"""

FAAS_TRIGGER: Final = "faas.trigger"
"""
Type of the trigger which caused this function invocation.
"""

FAAS_VERSION: Final = "faas.version"
"""
The immutable version of the function being executed.
Note: Depending on the cloud provider and platform, use:

- **AWS Lambda:** The [function version](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)
  (an integer represented as a decimal string).
- **Google Cloud Run (Services):** The [revision](https://cloud.google.com/run/docs/managing/revisions)
  (i.e., the function name plus the revision suffix).
- **Google Cloud Functions:** The value of the
  [`K_REVISION` environment variable](https://cloud.google.com/functions/docs/env-var#runtime_environment_variables_set_automatically).
- **Azure Functions:** Not applicable. Do not set this attribute.
"""


class FaasDocumentOperationValues(Enum):
    INSERT = "insert"
    """When a new object is created."""
    EDIT = "edit"
    """When an object is modified."""
    DELETE = "delete"
    """When an object is deleted."""


class FaasInvokedProviderValues(Enum):
    ALIBABA_CLOUD = "alibaba_cloud"
    """Alibaba Cloud."""
    AWS = "aws"
    """Amazon Web Services."""
    AZURE = "azure"
    """Microsoft Azure."""
    GCP = "gcp"
    """Google Cloud Platform."""
    TENCENT_CLOUD = "tencent_cloud"
    """Tencent Cloud."""


class FaasTriggerValues(Enum):
    DATASOURCE = "datasource"
    """A response to some data source operation such as a database or filesystem read/write."""
    HTTP = "http"
    """To provide an answer to an inbound HTTP request."""
    PUBSUB = "pubsub"
    """A function is set to be executed when messages are sent to a messaging system."""
    TIMER = "timer"
    """A function is scheduled to be executed regularly."""
    OTHER = "other"
    """If none of the others apply."""
