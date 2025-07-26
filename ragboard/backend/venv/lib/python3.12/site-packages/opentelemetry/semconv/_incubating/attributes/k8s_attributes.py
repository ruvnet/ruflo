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

K8S_CLUSTER_NAME: Final = "k8s.cluster.name"
"""
The name of the cluster.
"""

K8S_CLUSTER_UID: Final = "k8s.cluster.uid"
"""
A pseudo-ID for the cluster, set to the UID of the `kube-system` namespace.
Note: K8s doesn't have support for obtaining a cluster ID. If this is ever
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
> ITU-T X.667 | ISO/IEC 9834-8, a UUID is either guaranteed to be
> different from all other UUIDs generated before 3603 A.D., or is
> extremely likely to be different (depending on the mechanism chosen).

Therefore, UIDs between clusters should be extremely unlikely to
conflict.
"""

K8S_CONTAINER_NAME: Final = "k8s.container.name"
"""
The name of the Container from Pod specification, must be unique within a Pod. Container runtime usually uses different globally unique name (`container.name`).
"""

K8S_CONTAINER_RESTART_COUNT: Final = "k8s.container.restart_count"
"""
Number of times the container was restarted. This attribute can be used to identify a particular container (running or stopped) within a container spec.
"""

K8S_CONTAINER_STATUS_LAST_TERMINATED_REASON: Final = (
    "k8s.container.status.last_terminated_reason"
)
"""
Last terminated reason of the Container.
"""

K8S_CONTAINER_STATUS_REASON: Final = "k8s.container.status.reason"
"""
The reason for the container state. Corresponds to the `reason` field of the: [K8s ContainerStateWaiting](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#containerstatewaiting-v1-core) or [K8s ContainerStateTerminated](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#containerstateterminated-v1-core).
"""

K8S_CONTAINER_STATUS_STATE: Final = "k8s.container.status.state"
"""
The state of the container. [K8s ContainerState](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#containerstate-v1-core).
"""

K8S_CRONJOB_ANNOTATION_TEMPLATE: Final = "k8s.cronjob.annotation"
"""
The cronjob annotation placed on the CronJob, the `<key>` being the annotation name, the value being the annotation value.
Note: Examples:

- An annotation `retries` with value `4` SHOULD be recorded as the
  `k8s.cronjob.annotation.retries` attribute with value `"4"`.
- An annotation `data` with empty string value SHOULD be recorded as
  the `k8s.cronjob.annotation.data` attribute with value `""`.
"""

K8S_CRONJOB_LABEL_TEMPLATE: Final = "k8s.cronjob.label"
"""
The label placed on the CronJob, the `<key>` being the label name, the value being the label value.
Note: Examples:

- A label `type` with value `weekly` SHOULD be recorded as the
  `k8s.cronjob.label.type` attribute with value `"weekly"`.
- A label `automated` with empty string value SHOULD be recorded as
  the `k8s.cronjob.label.automated` attribute with value `""`.
"""

K8S_CRONJOB_NAME: Final = "k8s.cronjob.name"
"""
The name of the CronJob.
"""

K8S_CRONJOB_UID: Final = "k8s.cronjob.uid"
"""
The UID of the CronJob.
"""

K8S_DAEMONSET_ANNOTATION_TEMPLATE: Final = "k8s.daemonset.annotation"
"""
The annotation placed on the DaemonSet, the `<key>` being the annotation name, the value being the annotation value, even if the value is empty.
Note: Examples:

- A label `replicas` with value `1` SHOULD be recorded
  as the `k8s.daemonset.annotation.replicas` attribute with value `"1"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.daemonset.annotation.data` attribute with value `""`.
"""

K8S_DAEMONSET_LABEL_TEMPLATE: Final = "k8s.daemonset.label"
"""
The label placed on the DaemonSet, the `<key>` being the label name, the value being the label value, even if the value is empty.
Note: Examples:

- A label `app` with value `guestbook` SHOULD be recorded
  as the `k8s.daemonset.label.app` attribute with value `"guestbook"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.daemonset.label.injected` attribute with value `""`.
"""

K8S_DAEMONSET_NAME: Final = "k8s.daemonset.name"
"""
The name of the DaemonSet.
"""

K8S_DAEMONSET_UID: Final = "k8s.daemonset.uid"
"""
The UID of the DaemonSet.
"""

K8S_DEPLOYMENT_ANNOTATION_TEMPLATE: Final = "k8s.deployment.annotation"
"""
The annotation placed on the Deployment, the `<key>` being the annotation name, the value being the annotation value, even if the value is empty.
Note: Examples:

- A label `replicas` with value `1` SHOULD be recorded
  as the `k8s.deployment.annotation.replicas` attribute with value `"1"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.deployment.annotation.data` attribute with value `""`.
"""

K8S_DEPLOYMENT_LABEL_TEMPLATE: Final = "k8s.deployment.label"
"""
The label placed on the Deployment, the `<key>` being the label name, the value being the label value, even if the value is empty.
Note: Examples:

- A label `replicas` with value `0` SHOULD be recorded
  as the `k8s.deployment.label.app` attribute with value `"guestbook"`.
- A label `injected` with empty string value SHOULD be recorded as
  the `k8s.deployment.label.injected` attribute with value `""`.
"""

K8S_DEPLOYMENT_NAME: Final = "k8s.deployment.name"
"""
The name of the Deployment.
"""

K8S_DEPLOYMENT_UID: Final = "k8s.deployment.uid"
"""
The UID of the Deployment.
"""

K8S_HPA_METRIC_TYPE: Final = "k8s.hpa.metric.type"
"""
The type of metric source for the horizontal pod autoscaler.
Note: This attribute reflects the `type` field of spec.metrics[] in the HPA.
"""

K8S_HPA_NAME: Final = "k8s.hpa.name"
"""
The name of the horizontal pod autoscaler.
"""

K8S_HPA_SCALETARGETREF_API_VERSION: Final = (
    "k8s.hpa.scaletargetref.api_version"
)
"""
The API version of the target resource to scale for the HorizontalPodAutoscaler.
Note: This maps to the `apiVersion` field in the `scaleTargetRef` of the HPA spec.
"""

K8S_HPA_SCALETARGETREF_KIND: Final = "k8s.hpa.scaletargetref.kind"
"""
The kind of the target resource to scale for the HorizontalPodAutoscaler.
Note: This maps to the `kind` field in the `scaleTargetRef` of the HPA spec.
"""

K8S_HPA_SCALETARGETREF_NAME: Final = "k8s.hpa.scaletargetref.name"
"""
The name of the target resource to scale for the HorizontalPodAutoscaler.
Note: This maps to the `name` field in the `scaleTargetRef` of the HPA spec.
"""

K8S_HPA_UID: Final = "k8s.hpa.uid"
"""
The UID of the horizontal pod autoscaler.
"""

K8S_HUGEPAGE_SIZE: Final = "k8s.hugepage.size"
"""
The size (identifier) of the K8s huge page.
"""

K8S_JOB_ANNOTATION_TEMPLATE: Final = "k8s.job.annotation"
"""
The annotation placed on the Job, the `<key>` being the annotation name, the value being the annotation value, even if the value is empty.
Note: Examples:

- A label `number` with value `1` SHOULD be recorded
  as the `k8s.job.annotation.number` attribute with value `"1"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.job.annotation.data` attribute with value `""`.
"""

K8S_JOB_LABEL_TEMPLATE: Final = "k8s.job.label"
"""
The label placed on the Job, the `<key>` being the label name, the value being the label value, even if the value is empty.
Note: Examples:

- A label `jobtype` with value `ci` SHOULD be recorded
  as the `k8s.job.label.jobtype` attribute with value `"ci"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.job.label.automated` attribute with value `""`.
"""

K8S_JOB_NAME: Final = "k8s.job.name"
"""
The name of the Job.
"""

K8S_JOB_UID: Final = "k8s.job.uid"
"""
The UID of the Job.
"""

K8S_NAMESPACE_ANNOTATION_TEMPLATE: Final = "k8s.namespace.annotation"
"""
The annotation placed on the Namespace, the `<key>` being the annotation name, the value being the annotation value, even if the value is empty.
Note: Examples:

- A label `ttl` with value `0` SHOULD be recorded
  as the `k8s.namespace.annotation.ttl` attribute with value `"0"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.namespace.annotation.data` attribute with value `""`.
"""

K8S_NAMESPACE_LABEL_TEMPLATE: Final = "k8s.namespace.label"
"""
The label placed on the Namespace, the `<key>` being the label name, the value being the label value, even if the value is empty.
Note: Examples:

- A label `kubernetes.io/metadata.name` with value `default` SHOULD be recorded
  as the `k8s.namespace.label.kubernetes.io/metadata.name` attribute with value `"default"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.namespace.label.data` attribute with value `""`.
"""

K8S_NAMESPACE_NAME: Final = "k8s.namespace.name"
"""
The name of the namespace that the pod is running in.
"""

K8S_NAMESPACE_PHASE: Final = "k8s.namespace.phase"
"""
The phase of the K8s namespace.
Note: This attribute aligns with the `phase` field of the
[K8s NamespaceStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#namespacestatus-v1-core).
"""

K8S_NODE_ANNOTATION_TEMPLATE: Final = "k8s.node.annotation"
"""
The annotation placed on the Node, the `<key>` being the annotation name, the value being the annotation value, even if the value is empty.
Note: Examples:

- An annotation `node.alpha.kubernetes.io/ttl` with value `0` SHOULD be recorded as
  the `k8s.node.annotation.node.alpha.kubernetes.io/ttl` attribute with value `"0"`.
- An annotation `data` with empty string value SHOULD be recorded as
  the `k8s.node.annotation.data` attribute with value `""`.
"""

K8S_NODE_CONDITION_STATUS: Final = "k8s.node.condition.status"
"""
The status of the condition, one of True, False, Unknown.
Note: This attribute aligns with the `status` field of the
[NodeCondition](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#nodecondition-v1-core).
"""

K8S_NODE_CONDITION_TYPE: Final = "k8s.node.condition.type"
"""
The condition type of a K8s Node.
Note: K8s Node conditions as described
by [K8s documentation](https://v1-32.docs.kubernetes.io/docs/reference/node/node-status/#condition).

This attribute aligns with the `type` field of the
[NodeCondition](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#nodecondition-v1-core)

The set of possible values is not limited to those listed here. Managed Kubernetes environments,
or custom controllers MAY introduce additional node condition types.
When this occurs, the exact value as reported by the Kubernetes API SHOULD be used.
"""

K8S_NODE_LABEL_TEMPLATE: Final = "k8s.node.label"
"""
The label placed on the Node, the `<key>` being the label name, the value being the label value, even if the value is empty.
Note: Examples:

- A label `kubernetes.io/arch` with value `arm64` SHOULD be recorded
  as the `k8s.node.label.kubernetes.io/arch` attribute with value `"arm64"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.node.label.data` attribute with value `""`.
"""

K8S_NODE_NAME: Final = "k8s.node.name"
"""
The name of the Node.
"""

K8S_NODE_UID: Final = "k8s.node.uid"
"""
The UID of the Node.
"""

K8S_POD_ANNOTATION_TEMPLATE: Final = "k8s.pod.annotation"
"""
The annotation placed on the Pod, the `<key>` being the annotation name, the value being the annotation value.
Note: Examples:

- An annotation `kubernetes.io/enforce-mountable-secrets` with value `true` SHOULD be recorded as
  the `k8s.pod.annotation.kubernetes.io/enforce-mountable-secrets` attribute with value `"true"`.
- An annotation `mycompany.io/arch` with value `x64` SHOULD be recorded as
  the `k8s.pod.annotation.mycompany.io/arch` attribute with value `"x64"`.
- An annotation `data` with empty string value SHOULD be recorded as
  the `k8s.pod.annotation.data` attribute with value `""`.
"""

K8S_POD_LABEL_TEMPLATE: Final = "k8s.pod.label"
"""
The label placed on the Pod, the `<key>` being the label name, the value being the label value.
Note: Examples:

- A label `app` with value `my-app` SHOULD be recorded as
  the `k8s.pod.label.app` attribute with value `"my-app"`.
- A label `mycompany.io/arch` with value `x64` SHOULD be recorded as
  the `k8s.pod.label.mycompany.io/arch` attribute with value `"x64"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.pod.label.data` attribute with value `""`.
"""

K8S_POD_LABELS_TEMPLATE: Final = "k8s.pod.labels"
"""
Deprecated: Replaced by `k8s.pod.label`.
"""

K8S_POD_NAME: Final = "k8s.pod.name"
"""
The name of the Pod.
"""

K8S_POD_UID: Final = "k8s.pod.uid"
"""
The UID of the Pod.
"""

K8S_REPLICASET_ANNOTATION_TEMPLATE: Final = "k8s.replicaset.annotation"
"""
The annotation placed on the ReplicaSet, the `<key>` being the annotation name, the value being the annotation value, even if the value is empty.
Note: Examples:

- A label `replicas` with value `0` SHOULD be recorded
  as the `k8s.replicaset.annotation.replicas` attribute with value `"0"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.replicaset.annotation.data` attribute with value `""`.
"""

K8S_REPLICASET_LABEL_TEMPLATE: Final = "k8s.replicaset.label"
"""
The label placed on the ReplicaSet, the `<key>` being the label name, the value being the label value, even if the value is empty.
Note: Examples:

- A label `app` with value `guestbook` SHOULD be recorded
  as the `k8s.replicaset.label.app` attribute with value `"guestbook"`.
- A label `injected` with empty string value SHOULD be recorded as
  the `k8s.replicaset.label.injected` attribute with value `""`.
"""

K8S_REPLICASET_NAME: Final = "k8s.replicaset.name"
"""
The name of the ReplicaSet.
"""

K8S_REPLICASET_UID: Final = "k8s.replicaset.uid"
"""
The UID of the ReplicaSet.
"""

K8S_REPLICATIONCONTROLLER_NAME: Final = "k8s.replicationcontroller.name"
"""
The name of the replication controller.
"""

K8S_REPLICATIONCONTROLLER_UID: Final = "k8s.replicationcontroller.uid"
"""
The UID of the replication controller.
"""

K8S_RESOURCEQUOTA_NAME: Final = "k8s.resourcequota.name"
"""
The name of the resource quota.
"""

K8S_RESOURCEQUOTA_RESOURCE_NAME: Final = "k8s.resourcequota.resource_name"
"""
The name of the K8s resource a resource quota defines.
Note: The value for this attribute can be either the full `count/<resource>[.<group>]` string (e.g., count/deployments.apps, count/pods), or, for certain core Kubernetes resources, just the resource name (e.g., pods, services, configmaps). Both forms are supported by Kubernetes for object count quotas. See [Kubernetes Resource Quotas documentation](https://kubernetes.io/docs/concepts/policy/resource-quotas/#object-count-quota) for more details.
"""

K8S_RESOURCEQUOTA_UID: Final = "k8s.resourcequota.uid"
"""
The UID of the resource quota.
"""

K8S_STATEFULSET_ANNOTATION_TEMPLATE: Final = "k8s.statefulset.annotation"
"""
The annotation placed on the StatefulSet, the `<key>` being the annotation name, the value being the annotation value, even if the value is empty.
Note: Examples:

- A label `replicas` with value `1` SHOULD be recorded
  as the `k8s.statefulset.annotation.replicas` attribute with value `"1"`.
- A label `data` with empty string value SHOULD be recorded as
  the `k8s.statefulset.annotation.data` attribute with value `""`.
"""

K8S_STATEFULSET_LABEL_TEMPLATE: Final = "k8s.statefulset.label"
"""
The label placed on the StatefulSet, the `<key>` being the label name, the value being the label value, even if the value is empty.
Note: Examples:

- A label `replicas` with value `0` SHOULD be recorded
  as the `k8s.statefulset.label.app` attribute with value `"guestbook"`.
- A label `injected` with empty string value SHOULD be recorded as
  the `k8s.statefulset.label.injected` attribute with value `""`.
"""

K8S_STATEFULSET_NAME: Final = "k8s.statefulset.name"
"""
The name of the StatefulSet.
"""

K8S_STATEFULSET_UID: Final = "k8s.statefulset.uid"
"""
The UID of the StatefulSet.
"""

K8S_STORAGECLASS_NAME: Final = "k8s.storageclass.name"
"""
The name of K8s [StorageClass](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#storageclass-v1-storage-k8s-io) object.
"""

K8S_VOLUME_NAME: Final = "k8s.volume.name"
"""
The name of the K8s volume.
"""

K8S_VOLUME_TYPE: Final = "k8s.volume.type"
"""
The type of the K8s volume.
"""


class K8sContainerStatusReasonValues(Enum):
    CONTAINER_CREATING = "ContainerCreating"
    """The container is being created."""
    CRASH_LOOP_BACK_OFF = "CrashLoopBackOff"
    """The container is in a crash loop back off state."""
    CREATE_CONTAINER_CONFIG_ERROR = "CreateContainerConfigError"
    """There was an error creating the container configuration."""
    ERR_IMAGE_PULL = "ErrImagePull"
    """There was an error pulling the container image."""
    IMAGE_PULL_BACK_OFF = "ImagePullBackOff"
    """The container image pull is in back off state."""
    OOM_KILLED = "OOMKilled"
    """The container was killed due to out of memory."""
    COMPLETED = "Completed"
    """The container has completed execution."""
    ERROR = "Error"
    """There was an error with the container."""
    CONTAINER_CANNOT_RUN = "ContainerCannotRun"
    """The container cannot run."""


class K8sContainerStatusStateValues(Enum):
    TERMINATED = "terminated"
    """The container has terminated."""
    RUNNING = "running"
    """The container is running."""
    WAITING = "waiting"
    """The container is waiting."""


class K8sNamespacePhaseValues(Enum):
    ACTIVE = "active"
    """Active namespace phase as described by [K8s API](https://pkg.go.dev/k8s.io/api@v0.31.3/core/v1#NamespacePhase)."""
    TERMINATING = "terminating"
    """Terminating namespace phase as described by [K8s API](https://pkg.go.dev/k8s.io/api@v0.31.3/core/v1#NamespacePhase)."""


class K8sNodeConditionStatusValues(Enum):
    CONDITION_TRUE = "true"
    """condition_true."""
    CONDITION_FALSE = "false"
    """condition_false."""
    CONDITION_UNKNOWN = "unknown"
    """condition_unknown."""


class K8sNodeConditionTypeValues(Enum):
    READY = "Ready"
    """The node is healthy and ready to accept pods."""
    DISK_PRESSURE = "DiskPressure"
    """Pressure exists on the disk size—that is, if the disk capacity is low."""
    MEMORY_PRESSURE = "MemoryPressure"
    """Pressure exists on the node memory—that is, if the node memory is low."""
    PID_PRESSURE = "PIDPressure"
    """Pressure exists on the processes—that is, if there are too many processes on the node."""
    NETWORK_UNAVAILABLE = "NetworkUnavailable"
    """The network for the node is not correctly configured."""


class K8sVolumeTypeValues(Enum):
    PERSISTENT_VOLUME_CLAIM = "persistentVolumeClaim"
    """A [persistentVolumeClaim](https://v1-30.docs.kubernetes.io/docs/concepts/storage/volumes/#persistentvolumeclaim) volume."""
    CONFIG_MAP = "configMap"
    """A [configMap](https://v1-30.docs.kubernetes.io/docs/concepts/storage/volumes/#configmap) volume."""
    DOWNWARD_API = "downwardAPI"
    """A [downwardAPI](https://v1-30.docs.kubernetes.io/docs/concepts/storage/volumes/#downwardapi) volume."""
    EMPTY_DIR = "emptyDir"
    """An [emptyDir](https://v1-30.docs.kubernetes.io/docs/concepts/storage/volumes/#emptydir) volume."""
    SECRET = "secret"
    """A [secret](https://v1-30.docs.kubernetes.io/docs/concepts/storage/volumes/#secret) volume."""
    LOCAL = "local"
    """A [local](https://v1-30.docs.kubernetes.io/docs/concepts/storage/volumes/#local) volume."""
