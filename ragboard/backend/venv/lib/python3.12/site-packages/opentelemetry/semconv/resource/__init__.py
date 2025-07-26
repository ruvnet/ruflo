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

# pylint: disable=too-many-lines

from enum import Enum

from typing_extensions import deprecated


@deprecated(
    "Use attributes defined in the :py:const:`opentelemetry.semconv.attributes` and :py:const:`opentelemetry.semconv._incubating.attributes` modules instead. Deprecated since version 1.25.0.",
)
class ResourceAttributes:
    SCHEMA_URL = "https://opentelemetry.io/schemas/1.21.0"
    """
    The URL of the OpenTelemetry schema for these keys and values.
    """
    BROWSER_BRANDS = "browser.brands"
    """
    Array of brand name and version separated by a space.
    Note: This value is intended to be taken from the [UA client hints API](https://wicg.github.io/ua-client-hints/#interface) (`navigator.userAgentData.brands`).
    """

    BROWSER_PLATFORM = "browser.platform"
    """
    The platform on which the browser is running.
    Note: This value is intended to be taken from the [UA client hints API](https://wicg.github.io/ua-client-hints/#interface) (`navigator.userAgentData.platform`). If unavailable, the legacy `navigator.platform` API SHOULD NOT be used instead and this attribute SHOULD be left unset in order for the values to be consistent.
    The list of possible values is defined in the [W3C User-Agent Client Hints specification](https://wicg.github.io/ua-client-hints/#sec-ch-ua-platform). Note that some (but not all) of these values can overlap with values in the [`os.type` and `os.name` attributes](./os.md). However, for consistency, the values in the `browser.platform` attribute should capture the exact value that the user agent provides.
    """

    BROWSER_MOBILE = "browser.mobile"
    """
    A boolean that is true if the browser is running on a mobile device.
    Note: This value is intended to be taken from the [UA client hints API](https://wicg.github.io/ua-client-hints/#interface) (`navigator.userAgentData.mobile`). If unavailable, this attribute SHOULD be left unset.
    """

    BROWSER_LANGUAGE = "browser.language"
    """
    Preferred language of the user using the browser.
    Note: This value is intended to be taken from the Navigator API `navigator.language`.
    """

    USER_AGENT_ORIGINAL = "user_agent.original"
    """
    Full user-agent string provided by the browser.
    Note: The user-agent value SHOULD be provided only from browsers that do not have a mechanism to retrieve brands and platform individually from the User-Agent Client Hints API. To retrieve the value, the legacy `navigator.userAgent` API can be used.
    """

    CLOUD_PROVIDER = "cloud.provider"
    """
    Name of the cloud provider.
    """

    CLOUD_ACCOUNT_ID = "cloud.account.id"
    """
    The cloud account ID the resource is assigned to.
    """

    CLOUD_REGION = "cloud.region"
    """
    The geographical region the resource is running.
    Note: Refer to your provider's docs to see the available regions, for example [Alibaba Cloud regions](https://www.alibabacloud.com/help/doc-detail/40654.htm), [AWS regions](https://aws.amazon.com/about-aws/global-infrastructure/regions_az/), [Azure regions](https://azure.microsoft.com/en-us/global-infrastructure/geographies/), [Google Cloud regions](https://cloud.google.com/about/locations), or [Tencent Cloud regions](https://www.tencentcloud.com/document/product/213/6091).
    """

    CLOUD_RESOURCE_ID = "cloud.resource_id"
    """
    Cloud provider-specific native identifier of the monitored cloud resource (e.g. an [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html) on AWS, a [fully qualified resource ID](https://learn.microsoft.com/en-us/rest/api/resources/resources/get-by-id) on Azure, a [full resource name](https://cloud.google.com/apis/design/resource_names#full_resource_name) on GCP).
    Note: On some cloud providers, it may not be possible to determine the full ID at startup,
    so it may be necessary to set `cloud.resource_id` as a span attribute instead.

    The exact value to use for `cloud.resource_id` depends on the cloud provider.
    The following well-known definitions MUST be used if you set this attribute and they apply:

    * **AWS Lambda:** The function [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html).
      Take care not to use the "invoked ARN" directly but replace any
      [alias suffix](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
      with the resolved function version, as the same runtime instance may be invokable with
      multiple different aliases.
    * **GCP:** The [URI of the resource](https://cloud.google.com/iam/docs/full-resource-names)
    * **Azure:** The [Fully Qualified Resource ID](https://docs.microsoft.com/en-us/rest/api/resources/resources/get-by-id) of the invoked function,
      *not* the function app, having the form
      `/subscriptions/<SUBSCIPTION_GUID>/resourceGroups/<RG>/providers/Microsoft.Web/sites/<FUNCAPP>/functions/<FUNC>`.
      This means that a span attribute MUST be used, as an Azure function app can host multiple functions that would usually share
      a TracerProvider.
    """

    CLOUD_AVAILABILITY_ZONE = "cloud.availability_zone"
    """
    Cloud regions often have multiple, isolated locations known as zones to increase availability. Availability zone represents the zone where the resource is running.
    Note: Availability zones are called "zones" on Alibaba Cloud and Google Cloud.
    """

    CLOUD_PLATFORM = "cloud.platform"
    """
    The cloud platform in use.
    Note: The prefix of the service SHOULD match the one specified in `cloud.provider`.
    """

    AWS_ECS_CONTAINER_ARN = "aws.ecs.container.arn"
    """
    The Amazon Resource Name (ARN) of an [ECS container instance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ECS_instances.html).
    """

    AWS_ECS_CLUSTER_ARN = "aws.ecs.cluster.arn"
    """
    The ARN of an [ECS cluster](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/clusters.html).
    """

    AWS_ECS_LAUNCHTYPE = "aws.ecs.launchtype"
    """
    The [launch type](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/launch_types.html) for an ECS task.
    """

    AWS_ECS_TASK_ARN = "aws.ecs.task.arn"
    """
    The ARN of an [ECS task definition](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html).
    """

    AWS_ECS_TASK_FAMILY = "aws.ecs.task.family"
    """
    The task definition family this task definition is a member of.
    """

    AWS_ECS_TASK_REVISION = "aws.ecs.task.revision"
    """
    The revision for this task definition.
    """

    AWS_EKS_CLUSTER_ARN = "aws.eks.cluster.arn"
    """
    The ARN of an EKS cluster.
    """

    AWS_LOG_GROUP_NAMES = "aws.log.group.names"
    """
    The name(s) of the AWS log group(s) an application is writing to.
    Note: Multiple log groups must be supported for cases like multi-container applications, where a single application has sidecar containers, and each write to their own log group.
    """

    AWS_LOG_GROUP_ARNS = "aws.log.group.arns"
    """
    The Amazon Resource Name(s) (ARN) of the AWS log group(s).
    Note: See the [log group ARN format documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-access-control-overview-cwl.html#CWL_ARN_Format).
    """

    AWS_LOG_STREAM_NAMES = "aws.log.stream.names"
    """
    The name(s) of the AWS log stream(s) an application is writing to.
    """

    AWS_LOG_STREAM_ARNS = "aws.log.stream.arns"
    """
    The ARN(s) of the AWS log stream(s).
    Note: See the [log stream ARN format documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/iam-access-control-overview-cwl.html#CWL_ARN_Format). One log group can contain several log streams, so these ARNs necessarily identify both a log group and a log stream.
    """

    GCP_CLOUD_RUN_JOB_EXECUTION = "gcp.cloud_run.job.execution"
    """
    The name of the Cloud Run [execution](https://cloud.google.com/run/docs/managing/job-executions) being run for the Job, as set by the [`CLOUD_RUN_EXECUTION`](https://cloud.google.com/run/docs/container-contract#jobs-env-vars) environment variable.
    """

    GCP_CLOUD_RUN_JOB_TASK_INDEX = "gcp.cloud_run.job.task_index"
    """
    The index for a task within an execution as provided by the [`CLOUD_RUN_TASK_INDEX`](https://cloud.google.com/run/docs/container-contract#jobs-env-vars) environment variable.
    """

    GCP_GCE_INSTANCE_NAME = "gcp.gce.instance.name"
    """
    The instance name of a GCE instance. This is the value provided by `host.name`, the visible name of the instance in the Cloud Console UI, and the prefix for the default hostname of the instance as defined by the [default internal DNS name](https://cloud.google.com/compute/docs/internal-dns#instance-fully-qualified-domain-names).
    """

    GCP_GCE_INSTANCE_HOSTNAME = "gcp.gce.instance.hostname"
    """
    The hostname of a GCE instance. This is the full value of the default or [custom hostname](https://cloud.google.com/compute/docs/instances/custom-hostname-vm).
    """

    HEROKU_RELEASE_CREATION_TIMESTAMP = "heroku.release.creation_timestamp"
    """
    Time and date the release was created.
    """

    HEROKU_RELEASE_COMMIT = "heroku.release.commit"
    """
    Commit hash for the current release.
    """

    HEROKU_APP_ID = "heroku.app.id"
    """
    Unique identifier for the application.
    """

    CONTAINER_NAME = "container.name"
    """
    Container name used by container runtime.
    """

    CONTAINER_ID = "container.id"
    """
    Container ID. Usually a UUID, as for example used to [identify Docker containers](https://docs.docker.com/engine/reference/run/#container-identification). The UUID might be abbreviated.
    """

    CONTAINER_RUNTIME = "container.runtime"
    """
    The container runtime managing this container.
    """

    CONTAINER_IMAGE_NAME = "container.image.name"
    """
    Name of the image the container was built on.
    """

    CONTAINER_IMAGE_TAG = "container.image.tag"
    """
    Container image tag.
    """

    CONTAINER_IMAGE_ID = "container.image.id"
    """
    Runtime specific image identifier. Usually a hash algorithm followed by a UUID.
    Note: Docker defines a sha256 of the image id; `container.image.id` corresponds to the `Image` field from the Docker container inspect [API](https://docs.docker.com/engine/api/v1.43/#tag/Container/operation/ContainerInspect) endpoint.
    K8s defines a link to the container registry repository with digest `"imageID": "registry.azurecr.io /namespace/service/dockerfile@sha256:bdeabd40c3a8a492eaf9e8e44d0ebbb84bac7ee25ac0cf8a7159d25f62555625"`.
    OCI defines a digest of manifest.
    """

    CONTAINER_COMMAND = "container.command"
    """
    The command used to run the container (i.e. the command name).
    Note: If using embedded credentials or sensitive data, it is recommended to remove them to prevent potential leakage.
    """

    CONTAINER_COMMAND_LINE = "container.command_line"
    """
    The full command run by the container as a single string representing the full command. [2].
    """

    CONTAINER_COMMAND_ARGS = "container.command_args"
    """
    All the command arguments (including the command/executable itself) run by the container. [2].
    """

    DEPLOYMENT_ENVIRONMENT = "deployment.environment"
    """
    Name of the [deployment environment](https://en.wikipedia.org/wiki/Deployment_environment) (aka deployment tier).
    """

    DEVICE_ID = "device.id"
    """
    A unique identifier representing the device.
    Note: The device identifier MUST only be defined using the values outlined below. This value is not an advertising identifier and MUST NOT be used as such. On iOS (Swift or Objective-C), this value MUST be equal to the [vendor identifier](https://developer.apple.com/documentation/uikit/uidevice/1620059-identifierforvendor). On Android (Java or Kotlin), this value MUST be equal to the Firebase Installation ID or a globally unique UUID which is persisted across sessions in your application. More information can be found [here](https://developer.android.com/training/articles/user-data-ids) on best practices and exact implementation details. Caution should be taken when storing personal data or anything which can identify a user. GDPR and data protection laws may apply, ensure you do your own due diligence.
    """

    DEVICE_MODEL_IDENTIFIER = "device.model.identifier"
    """
    The model identifier for the device.
    Note: It's recommended this value represents a machine readable version of the model identifier rather than the market or consumer-friendly name of the device.
    """

    DEVICE_MODEL_NAME = "device.model.name"
    """
    The marketing name for the device model.
    Note: It's recommended this value represents a human readable version of the device model rather than a machine readable alternative.
    """

    DEVICE_MANUFACTURER = "device.manufacturer"
    """
    The name of the device manufacturer.
    Note: The Android OS provides this field via [Build](https://developer.android.com/reference/android/os/Build#MANUFACTURER). iOS apps SHOULD hardcode the value `Apple`.
    """

    FAAS_NAME = "faas.name"
    """
    The name of the single function that this runtime instance executes.
    Note: This is the name of the function as configured/deployed on the FaaS
    platform and is usually different from the name of the callback
    function (which may be stored in the
    [`code.namespace`/`code.function`](/docs/general/general-attributes.md#source-code-attributes)
    span attributes).

    For some cloud providers, the above definition is ambiguous. The following
    definition of function name MUST be used for this attribute
    (and consequently the span name) for the listed cloud providers/products:

    * **Azure:**  The full name `<FUNCAPP>/<FUNC>`, i.e., function app name
      followed by a forward slash followed by the function name (this form
      can also be seen in the resource JSON for the function).
      This means that a span attribute MUST be used, as an Azure function
      app can host multiple functions that would usually share
      a TracerProvider (see also the `cloud.resource_id` attribute).
    """

    FAAS_VERSION = "faas.version"
    """
    The immutable version of the function being executed.
    Note: Depending on the cloud provider and platform, use:

    * **AWS Lambda:** The [function version](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)
      (an integer represented as a decimal string).
    * **Google Cloud Run (Services):** The [revision](https://cloud.google.com/run/docs/managing/revisions)
      (i.e., the function name plus the revision suffix).
    * **Google Cloud Functions:** The value of the
      [`K_REVISION` environment variable](https://cloud.google.com/functions/docs/env-var#runtime_environment_variables_set_automatically).
    * **Azure Functions:** Not applicable. Do not set this attribute.
    """

    FAAS_INSTANCE = "faas.instance"
    """
    The execution environment ID as a string, that will be potentially reused for other invocations to the same function/function version.
    Note: * **AWS Lambda:** Use the (full) log stream name.
    """

    FAAS_MAX_MEMORY = "faas.max_memory"
    """
    The amount of memory available to the serverless function converted to Bytes.
    Note: It's recommended to set this attribute since e.g. too little memory can easily stop a Java AWS Lambda function from working correctly. On AWS Lambda, the environment variable `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` provides this information (which must be multiplied by 1,048,576).
    """

    HOST_ID = "host.id"
    """
    Unique host ID. For Cloud, this must be the instance_id assigned by the cloud provider. For non-containerized systems, this should be the `machine-id`. See the table below for the sources to use to determine the `machine-id` based on operating system.
    """

    HOST_NAME = "host.name"
    """
    Name of the host. On Unix systems, it may contain what the hostname command returns, or the fully qualified hostname, or another name specified by the user.
    """

    HOST_TYPE = "host.type"
    """
    Type of host. For Cloud, this must be the machine type.
    """

    HOST_ARCH = "host.arch"
    """
    The CPU architecture the host system is running on.
    """

    HOST_IMAGE_NAME = "host.image.name"
    """
    Name of the VM image or OS install the host was instantiated from.
    """

    HOST_IMAGE_ID = "host.image.id"
    """
    VM image ID or host OS image ID. For Cloud, this value is from the provider.
    """

    HOST_IMAGE_VERSION = "host.image.version"
    """
    The version string of the VM image or host OS as defined in [Version Attributes](README.md#version-attributes).
    """

    K8S_CLUSTER_NAME = "k8s.cluster.name"
    """
    The name of the cluster.
    """

    K8S_CLUSTER_UID = "k8s.cluster.uid"
    """
    A pseudo-ID for the cluster, set to the UID of the `kube-system` namespace.
    Note: K8s does not have support for obtaining a cluster ID. If this is ever
    added, we will recommend collecting the `k8s.cluster.uid` through the
    official APIs. In the meantime, we are able to use the `uid` of the
    `kube-system` namespace as a proxy for cluster ID. Read on for the
    rationale.

    Every object created in a K8s cluster is assigned a distinct UID. The
    `kube-system` namespace is used by Kubernetes itself and will exist
    for the lifetime of the cluster. Using the `uid` of the `kube-system`
    namespace is a reasonable proxy for the K8s ClusterID as it will only
    change if the cluster is rebuilt. Furthermore, Kubernetes UIDs are
    UUIDs as standardized by
    [ISO/IEC 9834-8 and ITU-T X.667](https://www.itu.int/ITU-T/studygroups/com17/oid.html).
    Which states:

    > If generated according to one of the mechanisms defined in Rec.
      ITU-T X.667 | ISO/IEC 9834-8, a UUID is either guaranteed to be
      different from all other UUIDs generated before 3603 A.D., or is
      extremely likely to be different (depending on the mechanism chosen).

    Therefore, UIDs between clusters should be extremely unlikely to
    conflict.
    """

    K8S_NODE_NAME = "k8s.node.name"
    """
    The name of the Node.
    """

    K8S_NODE_UID = "k8s.node.uid"
    """
    The UID of the Node.
    """

    K8S_NAMESPACE_NAME = "k8s.namespace.name"
    """
    The name of the namespace that the pod is running in.
    """

    K8S_POD_UID = "k8s.pod.uid"
    """
    The UID of the Pod.
    """

    K8S_POD_NAME = "k8s.pod.name"
    """
    The name of the Pod.
    """

    K8S_CONTAINER_NAME = "k8s.container.name"
    """
    The name of the Container from Pod specification, must be unique within a Pod. Container runtime usually uses different globally unique name (`container.name`).
    """

    K8S_CONTAINER_RESTART_COUNT = "k8s.container.restart_count"
    """
    Number of times the container was restarted. This attribute can be used to identify a particular container (running or stopped) within a container spec.
    """

    K8S_REPLICASET_UID = "k8s.replicaset.uid"
    """
    The UID of the ReplicaSet.
    """

    K8S_REPLICASET_NAME = "k8s.replicaset.name"
    """
    The name of the ReplicaSet.
    """

    K8S_DEPLOYMENT_UID = "k8s.deployment.uid"
    """
    The UID of the Deployment.
    """

    K8S_DEPLOYMENT_NAME = "k8s.deployment.name"
    """
    The name of the Deployment.
    """

    K8S_STATEFULSET_UID = "k8s.statefulset.uid"
    """
    The UID of the StatefulSet.
    """

    K8S_STATEFULSET_NAME = "k8s.statefulset.name"
    """
    The name of the StatefulSet.
    """

    K8S_DAEMONSET_UID = "k8s.daemonset.uid"
    """
    The UID of the DaemonSet.
    """

    K8S_DAEMONSET_NAME = "k8s.daemonset.name"
    """
    The name of the DaemonSet.
    """

    K8S_JOB_UID = "k8s.job.uid"
    """
    The UID of the Job.
    """

    K8S_JOB_NAME = "k8s.job.name"
    """
    The name of the Job.
    """

    K8S_CRONJOB_UID = "k8s.cronjob.uid"
    """
    The UID of the CronJob.
    """

    K8S_CRONJOB_NAME = "k8s.cronjob.name"
    """
    The name of the CronJob.
    """

    OS_TYPE = "os.type"
    """
    The operating system type.
    """

    OS_DESCRIPTION = "os.description"
    """
    Human readable (not intended to be parsed) OS version information, like e.g. reported by `ver` or `lsb_release -a` commands.
    """

    OS_NAME = "os.name"
    """
    Human readable operating system name.
    """

    OS_VERSION = "os.version"
    """
    The version string of the operating system as defined in [Version Attributes](/docs/resource/README.md#version-attributes).
    """

    PROCESS_PID = "process.pid"
    """
    Process identifier (PID).
    """

    PROCESS_PARENT_PID = "process.parent_pid"
    """
    Parent Process identifier (PID).
    """

    PROCESS_EXECUTABLE_NAME = "process.executable.name"
    """
    The name of the process executable. On Linux based systems, can be set to the `Name` in `proc/[pid]/status`. On Windows, can be set to the base name of `GetProcessImageFileNameW`.
    """

    PROCESS_EXECUTABLE_PATH = "process.executable.path"
    """
    The full path to the process executable. On Linux based systems, can be set to the target of `proc/[pid]/exe`. On Windows, can be set to the result of `GetProcessImageFileNameW`.
    """

    PROCESS_COMMAND = "process.command"
    """
    The command used to launch the process (i.e. the command name). On Linux based systems, can be set to the zeroth string in `proc/[pid]/cmdline`. On Windows, can be set to the first parameter extracted from `GetCommandLineW`.
    """

    PROCESS_COMMAND_LINE = "process.command_line"
    """
    The full command used to launch the process as a single string representing the full command. On Windows, can be set to the result of `GetCommandLineW`. Do not set this if you have to assemble it just for monitoring; use `process.command_args` instead.
    """

    PROCESS_COMMAND_ARGS = "process.command_args"
    """
    All the command arguments (including the command/executable itself) as received by the process. On Linux-based systems (and some other Unixoid systems supporting procfs), can be set according to the list of null-delimited strings extracted from `proc/[pid]/cmdline`. For libc-based executables, this would be the full argv vector passed to `main`.
    """

    PROCESS_OWNER = "process.owner"
    """
    The username of the user that owns the process.
    """

    PROCESS_RUNTIME_NAME = "process.runtime.name"
    """
    The name of the runtime of this process. For compiled native binaries, this SHOULD be the name of the compiler.
    """

    PROCESS_RUNTIME_VERSION = "process.runtime.version"
    """
    The version of the runtime of this process, as returned by the runtime without modification.
    """

    PROCESS_RUNTIME_DESCRIPTION = "process.runtime.description"
    """
    An additional description about the runtime of the process, for example a specific vendor customization of the runtime environment.
    """

    SERVICE_NAME = "service.name"
    """
    Logical name of the service.
    Note: MUST be the same for all instances of horizontally scaled services. If the value was not specified, SDKs MUST fallback to `unknown_service:` concatenated with [`process.executable.name`](process.md#process), e.g. `unknown_service:bash`. If `process.executable.name` is not available, the value MUST be set to `unknown_service`.
    """

    SERVICE_VERSION = "service.version"
    """
    The version string of the service API or implementation. The format is not defined by these conventions.
    """

    SERVICE_NAMESPACE = "service.namespace"
    """
    A namespace for `service.name`.
    Note: A string value having a meaning that helps to distinguish a group of services, for example the team name that owns a group of services. `service.name` is expected to be unique within the same namespace. If `service.namespace` is not specified in the Resource then `service.name` is expected to be unique for all services that have no explicit namespace defined (so the empty/unspecified namespace is simply one more valid namespace). Zero-length namespace string is assumed equal to unspecified namespace.
    """

    SERVICE_INSTANCE_ID = "service.instance.id"
    """
    The string ID of the service instance.
    Note: MUST be unique for each instance of the same `service.namespace,service.name` pair (in other words `service.namespace,service.name,service.instance.id` triplet MUST be globally unique). The ID helps to distinguish instances of the same service that exist at the same time (e.g. instances of a horizontally scaled service). It is preferable for the ID to be persistent and stay the same for the lifetime of the service instance, however it is acceptable that the ID is ephemeral and changes during important lifetime events for the service (e.g. service restarts). If the service has no inherent unique ID that can be used as the value of this attribute it is recommended to generate a random Version 1 or Version 4 RFC 4122 UUID (services aiming for reproducible UUIDs may also use Version 5, see RFC 4122 for more recommendations).
    """

    TELEMETRY_SDK_NAME = "telemetry.sdk.name"
    """
    The name of the telemetry SDK as defined above.
    Note: The OpenTelemetry SDK MUST set the `telemetry.sdk.name` attribute to `opentelemetry`.
    If another SDK, like a fork or a vendor-provided implementation, is used, this SDK MUST set the
    `telemetry.sdk.name` attribute to the fully-qualified class or module name of this SDK's main entry point
    or another suitable identifier depending on the language.
    The identifier `opentelemetry` is reserved and MUST NOT be used in this case.
    All custom identifiers SHOULD be stable across different versions of an implementation.
    """

    TELEMETRY_SDK_LANGUAGE = "telemetry.sdk.language"
    """
    The language of the telemetry SDK.
    """

    TELEMETRY_SDK_VERSION = "telemetry.sdk.version"
    """
    The version string of the telemetry SDK.
    """

    TELEMETRY_AUTO_VERSION = "telemetry.auto.version"
    """
    The version string of the auto instrumentation agent, if used.
    """

    WEBENGINE_NAME = "webengine.name"
    """
    The name of the web engine.
    """

    WEBENGINE_VERSION = "webengine.version"
    """
    The version of the web engine.
    """

    WEBENGINE_DESCRIPTION = "webengine.description"
    """
    Additional description of the web engine (e.g. detailed version and edition information).
    """

    OTEL_SCOPE_NAME = "otel.scope.name"
    """
    The name of the instrumentation scope - (`InstrumentationScope.Name` in OTLP).
    """

    OTEL_SCOPE_VERSION = "otel.scope.version"
    """
    The version of the instrumentation scope - (`InstrumentationScope.Version` in OTLP).
    """

    OTEL_LIBRARY_NAME = "otel.library.name"
    """
    Deprecated, use the `otel.scope.name` attribute.
    """

    OTEL_LIBRARY_VERSION = "otel.library.version"
    """
    Deprecated, use the `otel.scope.version` attribute.
    """

    # Manually defined deprecated attributes

    FAAS_ID = "faas.id"
    """
    Deprecated, use the `cloud.resource.id` attribute.
    """


@deprecated(
    "Use :py:const:`opentelemetry.semconv._incubating.attributes.CloudProviderValues` instead. Deprecated since version 1.25.0.",
)
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

    TENCENT_CLOUD = "tencent_cloud"
    """Tencent Cloud."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv._incubating.attributes.CloudPlatformValues` instead. Deprecated since version 1.25.0.",
)
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

    AZURE_VM = "azure_vm"
    """Azure Virtual Machines."""

    AZURE_CONTAINER_INSTANCES = "azure_container_instances"
    """Azure Container Instances."""

    AZURE_AKS = "azure_aks"
    """Azure Kubernetes Service."""

    AZURE_FUNCTIONS = "azure_functions"
    """Azure Functions."""

    AZURE_APP_SERVICE = "azure_app_service"
    """Azure App Service."""

    AZURE_OPENSHIFT = "azure_openshift"
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

    TENCENT_CLOUD_CVM = "tencent_cloud_cvm"
    """Tencent Cloud Cloud Virtual Machine (CVM)."""

    TENCENT_CLOUD_EKS = "tencent_cloud_eks"
    """Tencent Cloud Elastic Kubernetes Service (EKS)."""

    TENCENT_CLOUD_SCF = "tencent_cloud_scf"
    """Tencent Cloud Serverless Cloud Function (SCF)."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv._incubating.attributes.AwsEcsLaunchtypeValues` instead. Deprecated since version 1.25.0.",
)
class AwsEcsLaunchtypeValues(Enum):
    EC2 = "ec2"
    """ec2."""

    FARGATE = "fargate"
    """fargate."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv._incubating.attributes.HostArchValues` instead. Deprecated since version 1.25.0.",
)
class HostArchValues(Enum):
    AMD64 = "amd64"
    """AMD64."""

    ARM32 = "arm32"
    """ARM32."""

    ARM64 = "arm64"
    """ARM64."""

    IA64 = "ia64"
    """Itanium."""

    PPC32 = "ppc32"
    """32-bit PowerPC."""

    PPC64 = "ppc64"
    """64-bit PowerPC."""

    S390X = "s390x"
    """IBM z/Architecture."""

    X86 = "x86"
    """32-bit x86."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv._incubating.attributes.OsTypeValues` instead. Deprecated since version 1.25.0.",
)
class OsTypeValues(Enum):
    WINDOWS = "windows"
    """Microsoft Windows."""

    LINUX = "linux"
    """Linux."""

    DARWIN = "darwin"
    """Apple Darwin."""

    FREEBSD = "freebsd"
    """FreeBSD."""

    NETBSD = "netbsd"
    """NetBSD."""

    OPENBSD = "openbsd"
    """OpenBSD."""

    DRAGONFLYBSD = "dragonflybsd"
    """DragonFly BSD."""

    HPUX = "hpux"
    """HP-UX (Hewlett Packard Unix)."""

    AIX = "aix"
    """AIX (Advanced Interactive eXecutive)."""

    SOLARIS = "solaris"
    """SunOS, Oracle Solaris."""

    Z_OS = "z_os"
    """IBM z/OS."""


@deprecated(
    "Use :py:const:`opentelemetry.semconv.attributes.TelemetrySdkLanguageValues` instead. Deprecated since version 1.25.0.",
)
class TelemetrySdkLanguageValues(Enum):
    CPP = "cpp"
    """cpp."""

    DOTNET = "dotnet"
    """dotnet."""

    ERLANG = "erlang"
    """erlang."""

    GO = "go"
    """go."""

    JAVA = "java"
    """java."""

    NODEJS = "nodejs"
    """nodejs."""

    PHP = "php"
    """php."""

    PYTHON = "python"
    """python."""

    RUBY = "ruby"
    """ruby."""

    RUST = "rust"
    """rust."""

    SWIFT = "swift"
    """swift."""

    WEBJS = "webjs"
    """webjs."""
