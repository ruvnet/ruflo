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

CLOUD_ACCOUNT_ID: Final = "cloud.account.id"
"""
The cloud account ID the resource is assigned to.
"""

CLOUD_AVAILABILITY_ZONE: Final = "cloud.availability_zone"
"""
Cloud regions often have multiple, isolated locations known as zones to increase availability. Availability zone represents the zone where the resource is running.
Note: Availability zones are called "zones" on Alibaba Cloud and Google Cloud.
"""

CLOUD_PLATFORM: Final = "cloud.platform"
"""
The cloud platform in use.
Note: The prefix of the service SHOULD match the one specified in `cloud.provider`.
"""

CLOUD_PROVIDER: Final = "cloud.provider"
"""
Name of the cloud provider.
"""

CLOUD_REGION: Final = "cloud.region"
"""
The geographical region within a cloud provider. When associated with a resource, this attribute specifies the region where the resource operates. When calling services or APIs deployed on a cloud, this attribute identifies the region where the called destination is deployed.
Note: Refer to your provider's docs to see the available regions, for example [Alibaba Cloud regions](https://www.alibabacloud.com/help/doc-detail/40654.htm), [AWS regions](https://aws.amazon.com/about-aws/global-infrastructure/regions_az/), [Azure regions](https://azure.microsoft.com/global-infrastructure/geographies/), [Google Cloud regions](https://cloud.google.com/about/locations), or [Tencent Cloud regions](https://www.tencentcloud.com/document/product/213/6091).
"""

CLOUD_RESOURCE_ID: Final = "cloud.resource_id"
"""
Cloud provider-specific native identifier of the monitored cloud resource (e.g. an [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html) on AWS, a [fully qualified resource ID](https://learn.microsoft.com/rest/api/resources/resources/get-by-id) on Azure, a [full resource name](https://google.aip.dev/122#full-resource-names) on GCP).
Note: On some cloud providers, it may not be possible to determine the full ID at startup,
so it may be necessary to set `cloud.resource_id` as a span attribute instead.

The exact value to use for `cloud.resource_id` depends on the cloud provider.
The following well-known definitions MUST be used if you set this attribute and they apply:

- **AWS Lambda:** The function [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html).
  Take care not to use the "invoked ARN" directly but replace any
  [alias suffix](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
  with the resolved function version, as the same runtime instance may be invocable with
  multiple different aliases.
- **GCP:** The [URI of the resource](https://cloud.google.com/iam/docs/full-resource-names)
- **Azure:** The [Fully Qualified Resource ID](https://learn.microsoft.com/rest/api/resources/resources/get-by-id) of the invoked function,
  *not* the function app, having the form
  `/subscriptions/<SUBSCRIPTION_GUID>/resourceGroups/<RG>/providers/Microsoft.Web/sites/<FUNCAPP>/functions/<FUNC>`.
  This means that a span attribute MUST be used, as an Azure function app can host multiple functions that would usually share
  a TracerProvider.
"""


class CloudPlatformValues(Enum):
    ALIBABA_CLOUD_ECS = "alibaba_cloud_ecs"
    """Alibaba Cloud Elastic Compute Service."""
    ALIBABA_CLOUD_FC = "alibaba_cloud_fc"
    """Alibaba Cloud Function Compute."""
    ALIBABA_CLOUD_OPENSHIFT = "alibaba_cloud_openshift"
    """Red Hat OpenShift on Alibaba Cloud."""
    AWS_EC2 = "aws_ec2"
    """AWS Elastic Compute Cloud."""
    AWS_ECS = "aws_ecs"
    """AWS Elastic Container Service."""
    AWS_EKS = "aws_eks"
    """AWS Elastic Kubernetes Service."""
    AWS_LAMBDA = "aws_lambda"
    """AWS Lambda."""
    AWS_ELASTIC_BEANSTALK = "aws_elastic_beanstalk"
    """AWS Elastic Beanstalk."""
    AWS_APP_RUNNER = "aws_app_runner"
    """AWS App Runner."""
    AWS_OPENSHIFT = "aws_openshift"
    """Red Hat OpenShift on AWS (ROSA)."""
    AZURE_VM = "azure.vm"
    """Azure Virtual Machines."""
    AZURE_CONTAINER_APPS = "azure.container_apps"
    """Azure Container Apps."""
    AZURE_CONTAINER_INSTANCES = "azure.container_instances"
    """Azure Container Instances."""
    AZURE_AKS = "azure.aks"
    """Azure Kubernetes Service."""
    AZURE_FUNCTIONS = "azure.functions"
    """Azure Functions."""
    AZURE_APP_SERVICE = "azure.app_service"
    """Azure App Service."""
    AZURE_OPENSHIFT = "azure.openshift"
    """Azure Red Hat OpenShift."""
    GCP_BARE_METAL_SOLUTION = "gcp_bare_metal_solution"
    """Google Bare Metal Solution (BMS)."""
    GCP_COMPUTE_ENGINE = "gcp_compute_engine"
    """Google Cloud Compute Engine (GCE)."""
    GCP_CLOUD_RUN = "gcp_cloud_run"
    """Google Cloud Run."""
    GCP_KUBERNETES_ENGINE = "gcp_kubernetes_engine"
    """Google Cloud Kubernetes Engine (GKE)."""
    GCP_CLOUD_FUNCTIONS = "gcp_cloud_functions"
    """Google Cloud Functions (GCF)."""
    GCP_APP_ENGINE = "gcp_app_engine"
    """Google Cloud App Engine (GAE)."""
    GCP_OPENSHIFT = "gcp_openshift"
    """Red Hat OpenShift on Google Cloud."""
    IBM_CLOUD_OPENSHIFT = "ibm_cloud_openshift"
    """Red Hat OpenShift on IBM Cloud."""
    ORACLE_CLOUD_COMPUTE = "oracle_cloud_compute"
    """Compute on Oracle Cloud Infrastructure (OCI)."""
    ORACLE_CLOUD_OKE = "oracle_cloud_oke"
    """Kubernetes Engine (OKE) on Oracle Cloud Infrastructure (OCI)."""
    TENCENT_CLOUD_CVM = "tencent_cloud_cvm"
    """Tencent Cloud Cloud Virtual Machine (CVM)."""
    TENCENT_CLOUD_EKS = "tencent_cloud_eks"
    """Tencent Cloud Elastic Kubernetes Service (EKS)."""
    TENCENT_CLOUD_SCF = "tencent_cloud_scf"
    """Tencent Cloud Serverless Cloud Function (SCF)."""


class CloudProviderValues(Enum):
    ALIBABA_CLOUD = "alibaba_cloud"
    """Alibaba Cloud."""
    AWS = "aws"
    """Amazon Web Services."""
    AZURE = "azure"
    """Microsoft Azure."""
    GCP = "gcp"
    """Google Cloud Platform."""
    HEROKU = "heroku"
    """Heroku Platform as a Service."""
    IBM_CLOUD = "ibm_cloud"
    """IBM Cloud."""
    ORACLE_CLOUD = "oracle_cloud"
    """Oracle Cloud Infrastructure (OCI)."""
    TENCENT_CLOUD = "tencent_cloud"
    """Tencent Cloud."""
