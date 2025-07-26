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


from typing import (
    Callable,
    Final,
    Generator,
    Iterable,
    Optional,
    Sequence,
    Union,
)

from opentelemetry.metrics import (
    CallbackOptions,
    Counter,
    Meter,
    ObservableGauge,
    Observation,
    UpDownCounter,
)

# pylint: disable=invalid-name
CallbackT = Union[
    Callable[[CallbackOptions], Iterable[Observation]],
    Generator[Iterable[Observation], CallbackOptions, None],
]

K8S_CONTAINER_CPU_LIMIT: Final = "k8s.container.cpu.limit"
"""
Maximum CPU resource limit set for the container
Instrument: updowncounter
Unit: {cpu}
Note: See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#resourcerequirements-v1-core for details.
"""


def create_k8s_container_cpu_limit(meter: Meter) -> UpDownCounter:
    """Maximum CPU resource limit set for the container"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_CPU_LIMIT,
        description="Maximum CPU resource limit set for the container",
        unit="{cpu}",
    )


K8S_CONTAINER_CPU_REQUEST: Final = "k8s.container.cpu.request"
"""
CPU resource requested for the container
Instrument: updowncounter
Unit: {cpu}
Note: See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#resourcerequirements-v1-core for details.
"""


def create_k8s_container_cpu_request(meter: Meter) -> UpDownCounter:
    """CPU resource requested for the container"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_CPU_REQUEST,
        description="CPU resource requested for the container",
        unit="{cpu}",
    )


K8S_CONTAINER_EPHEMERAL_STORAGE_LIMIT: Final = (
    "k8s.container.ephemeral_storage.limit"
)
"""
Maximum ephemeral storage resource limit set for the container
Instrument: updowncounter
Unit: By
Note: See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#resourcerequirements-v1-core for details.
"""


def create_k8s_container_ephemeral_storage_limit(
    meter: Meter,
) -> UpDownCounter:
    """Maximum ephemeral storage resource limit set for the container"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_EPHEMERAL_STORAGE_LIMIT,
        description="Maximum ephemeral storage resource limit set for the container",
        unit="By",
    )


K8S_CONTAINER_EPHEMERAL_STORAGE_REQUEST: Final = (
    "k8s.container.ephemeral_storage.request"
)
"""
Ephemeral storage resource requested for the container
Instrument: updowncounter
Unit: By
Note: See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#resourcerequirements-v1-core for details.
"""


def create_k8s_container_ephemeral_storage_request(
    meter: Meter,
) -> UpDownCounter:
    """Ephemeral storage resource requested for the container"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_EPHEMERAL_STORAGE_REQUEST,
        description="Ephemeral storage resource requested for the container",
        unit="By",
    )


K8S_CONTAINER_MEMORY_LIMIT: Final = "k8s.container.memory.limit"
"""
Maximum memory resource limit set for the container
Instrument: updowncounter
Unit: By
Note: See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#resourcerequirements-v1-core for details.
"""


def create_k8s_container_memory_limit(meter: Meter) -> UpDownCounter:
    """Maximum memory resource limit set for the container"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_MEMORY_LIMIT,
        description="Maximum memory resource limit set for the container",
        unit="By",
    )


K8S_CONTAINER_MEMORY_REQUEST: Final = "k8s.container.memory.request"
"""
Memory resource requested for the container
Instrument: updowncounter
Unit: By
Note: See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#resourcerequirements-v1-core for details.
"""


def create_k8s_container_memory_request(meter: Meter) -> UpDownCounter:
    """Memory resource requested for the container"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_MEMORY_REQUEST,
        description="Memory resource requested for the container",
        unit="By",
    )


K8S_CONTAINER_READY: Final = "k8s.container.ready"
"""
Indicates whether the container is currently marked as ready to accept traffic, based on its readiness probe (1 = ready, 0 = not ready)
Instrument: updowncounter
Unit: {container}
Note: This metric SHOULD reflect the value of the `ready` field in the
[K8s ContainerStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#containerstatus-v1-core).
"""


def create_k8s_container_ready(meter: Meter) -> UpDownCounter:
    """Indicates whether the container is currently marked as ready to accept traffic, based on its readiness probe (1 = ready, 0 = not ready)"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_READY,
        description="Indicates whether the container is currently marked as ready to accept traffic, based on its readiness probe (1 = ready, 0 = not ready)",
        unit="{container}",
    )


K8S_CONTAINER_RESTART_COUNT: Final = "k8s.container.restart.count"
"""
Describes how many times the container has restarted (since the last counter reset)
Instrument: updowncounter
Unit: {restart}
Note: This value is pulled directly from the K8s API and the value can go indefinitely high and be reset to 0
at any time depending on how your kubelet is configured to prune dead containers.
It is best to not depend too much on the exact value but rather look at it as
either == 0, in which case you can conclude there were no restarts in the recent past, or > 0, in which case
you can conclude there were restarts in the recent past, and not try and analyze the value beyond that.
"""


def create_k8s_container_restart_count(meter: Meter) -> UpDownCounter:
    """Describes how many times the container has restarted (since the last counter reset)"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_RESTART_COUNT,
        description="Describes how many times the container has restarted (since the last counter reset)",
        unit="{restart}",
    )


K8S_CONTAINER_STATUS_REASON: Final = "k8s.container.status.reason"
"""
Describes the number of K8s containers that are currently in a state for a given reason
Instrument: updowncounter
Unit: {container}
Note: All possible container state reasons will be reported at each time interval to avoid missing metrics.
Only the value corresponding to the current state reason will be non-zero.
"""


def create_k8s_container_status_reason(meter: Meter) -> UpDownCounter:
    """Describes the number of K8s containers that are currently in a state for a given reason"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_STATUS_REASON,
        description="Describes the number of K8s containers that are currently in a state for a given reason",
        unit="{container}",
    )


K8S_CONTAINER_STATUS_STATE: Final = "k8s.container.status.state"
"""
Describes the number of K8s containers that are currently in a given state
Instrument: updowncounter
Unit: {container}
Note: All possible container states will be reported at each time interval to avoid missing metrics.
Only the value corresponding to the current state will be non-zero.
"""


def create_k8s_container_status_state(meter: Meter) -> UpDownCounter:
    """Describes the number of K8s containers that are currently in a given state"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_STATUS_STATE,
        description="Describes the number of K8s containers that are currently in a given state",
        unit="{container}",
    )


K8S_CONTAINER_STORAGE_LIMIT: Final = "k8s.container.storage.limit"
"""
Maximum storage resource limit set for the container
Instrument: updowncounter
Unit: By
Note: See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#resourcerequirements-v1-core for details.
"""


def create_k8s_container_storage_limit(meter: Meter) -> UpDownCounter:
    """Maximum storage resource limit set for the container"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_STORAGE_LIMIT,
        description="Maximum storage resource limit set for the container",
        unit="By",
    )


K8S_CONTAINER_STORAGE_REQUEST: Final = "k8s.container.storage.request"
"""
Storage resource requested for the container
Instrument: updowncounter
Unit: By
Note: See https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#resourcerequirements-v1-core for details.
"""


def create_k8s_container_storage_request(meter: Meter) -> UpDownCounter:
    """Storage resource requested for the container"""
    return meter.create_up_down_counter(
        name=K8S_CONTAINER_STORAGE_REQUEST,
        description="Storage resource requested for the container",
        unit="By",
    )


K8S_CRONJOB_ACTIVE_JOBS: Final = "k8s.cronjob.active_jobs"
"""
The number of actively running jobs for a cronjob
Instrument: updowncounter
Unit: {job}
Note: This metric aligns with the `active` field of the
[K8s CronJobStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#cronjobstatus-v1-batch).
"""


def create_k8s_cronjob_active_jobs(meter: Meter) -> UpDownCounter:
    """The number of actively running jobs for a cronjob"""
    return meter.create_up_down_counter(
        name=K8S_CRONJOB_ACTIVE_JOBS,
        description="The number of actively running jobs for a cronjob",
        unit="{job}",
    )


K8S_DAEMONSET_CURRENT_SCHEDULED_NODES: Final = (
    "k8s.daemonset.current_scheduled_nodes"
)
"""
Number of nodes that are running at least 1 daemon pod and are supposed to run the daemon pod
Instrument: updowncounter
Unit: {node}
Note: This metric aligns with the `currentNumberScheduled` field of the
[K8s DaemonSetStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#daemonsetstatus-v1-apps).
"""


def create_k8s_daemonset_current_scheduled_nodes(
    meter: Meter,
) -> UpDownCounter:
    """Number of nodes that are running at least 1 daemon pod and are supposed to run the daemon pod"""
    return meter.create_up_down_counter(
        name=K8S_DAEMONSET_CURRENT_SCHEDULED_NODES,
        description="Number of nodes that are running at least 1 daemon pod and are supposed to run the daemon pod",
        unit="{node}",
    )


K8S_DAEMONSET_DESIRED_SCHEDULED_NODES: Final = (
    "k8s.daemonset.desired_scheduled_nodes"
)
"""
Number of nodes that should be running the daemon pod (including nodes currently running the daemon pod)
Instrument: updowncounter
Unit: {node}
Note: This metric aligns with the `desiredNumberScheduled` field of the
[K8s DaemonSetStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#daemonsetstatus-v1-apps).
"""


def create_k8s_daemonset_desired_scheduled_nodes(
    meter: Meter,
) -> UpDownCounter:
    """Number of nodes that should be running the daemon pod (including nodes currently running the daemon pod)"""
    return meter.create_up_down_counter(
        name=K8S_DAEMONSET_DESIRED_SCHEDULED_NODES,
        description="Number of nodes that should be running the daemon pod (including nodes currently running the daemon pod)",
        unit="{node}",
    )


K8S_DAEMONSET_MISSCHEDULED_NODES: Final = "k8s.daemonset.misscheduled_nodes"
"""
Number of nodes that are running the daemon pod, but are not supposed to run the daemon pod
Instrument: updowncounter
Unit: {node}
Note: This metric aligns with the `numberMisscheduled` field of the
[K8s DaemonSetStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#daemonsetstatus-v1-apps).
"""


def create_k8s_daemonset_misscheduled_nodes(meter: Meter) -> UpDownCounter:
    """Number of nodes that are running the daemon pod, but are not supposed to run the daemon pod"""
    return meter.create_up_down_counter(
        name=K8S_DAEMONSET_MISSCHEDULED_NODES,
        description="Number of nodes that are running the daemon pod, but are not supposed to run the daemon pod",
        unit="{node}",
    )


K8S_DAEMONSET_READY_NODES: Final = "k8s.daemonset.ready_nodes"
"""
Number of nodes that should be running the daemon pod and have one or more of the daemon pod running and ready
Instrument: updowncounter
Unit: {node}
Note: This metric aligns with the `numberReady` field of the
[K8s DaemonSetStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#daemonsetstatus-v1-apps).
"""


def create_k8s_daemonset_ready_nodes(meter: Meter) -> UpDownCounter:
    """Number of nodes that should be running the daemon pod and have one or more of the daemon pod running and ready"""
    return meter.create_up_down_counter(
        name=K8S_DAEMONSET_READY_NODES,
        description="Number of nodes that should be running the daemon pod and have one or more of the daemon pod running and ready",
        unit="{node}",
    )


K8S_DEPLOYMENT_AVAILABLE_PODS: Final = "k8s.deployment.available_pods"
"""
Total number of available replica pods (ready for at least minReadySeconds) targeted by this deployment
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `availableReplicas` field of the
[K8s DeploymentStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#deploymentstatus-v1-apps).
"""


def create_k8s_deployment_available_pods(meter: Meter) -> UpDownCounter:
    """Total number of available replica pods (ready for at least minReadySeconds) targeted by this deployment"""
    return meter.create_up_down_counter(
        name=K8S_DEPLOYMENT_AVAILABLE_PODS,
        description="Total number of available replica pods (ready for at least minReadySeconds) targeted by this deployment",
        unit="{pod}",
    )


K8S_DEPLOYMENT_DESIRED_PODS: Final = "k8s.deployment.desired_pods"
"""
Number of desired replica pods in this deployment
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `replicas` field of the
[K8s DeploymentSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#deploymentspec-v1-apps).
"""


def create_k8s_deployment_desired_pods(meter: Meter) -> UpDownCounter:
    """Number of desired replica pods in this deployment"""
    return meter.create_up_down_counter(
        name=K8S_DEPLOYMENT_DESIRED_PODS,
        description="Number of desired replica pods in this deployment",
        unit="{pod}",
    )


K8S_HPA_CURRENT_PODS: Final = "k8s.hpa.current_pods"
"""
Current number of replica pods managed by this horizontal pod autoscaler, as last seen by the autoscaler
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `currentReplicas` field of the
[K8s HorizontalPodAutoscalerStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#horizontalpodautoscalerstatus-v2-autoscaling).
"""


def create_k8s_hpa_current_pods(meter: Meter) -> UpDownCounter:
    """Current number of replica pods managed by this horizontal pod autoscaler, as last seen by the autoscaler"""
    return meter.create_up_down_counter(
        name=K8S_HPA_CURRENT_PODS,
        description="Current number of replica pods managed by this horizontal pod autoscaler, as last seen by the autoscaler",
        unit="{pod}",
    )


K8S_HPA_DESIRED_PODS: Final = "k8s.hpa.desired_pods"
"""
Desired number of replica pods managed by this horizontal pod autoscaler, as last calculated by the autoscaler
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `desiredReplicas` field of the
[K8s HorizontalPodAutoscalerStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#horizontalpodautoscalerstatus-v2-autoscaling).
"""


def create_k8s_hpa_desired_pods(meter: Meter) -> UpDownCounter:
    """Desired number of replica pods managed by this horizontal pod autoscaler, as last calculated by the autoscaler"""
    return meter.create_up_down_counter(
        name=K8S_HPA_DESIRED_PODS,
        description="Desired number of replica pods managed by this horizontal pod autoscaler, as last calculated by the autoscaler",
        unit="{pod}",
    )


K8S_HPA_MAX_PODS: Final = "k8s.hpa.max_pods"
"""
The upper limit for the number of replica pods to which the autoscaler can scale up
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `maxReplicas` field of the
[K8s HorizontalPodAutoscalerSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#horizontalpodautoscalerspec-v2-autoscaling).
"""


def create_k8s_hpa_max_pods(meter: Meter) -> UpDownCounter:
    """The upper limit for the number of replica pods to which the autoscaler can scale up"""
    return meter.create_up_down_counter(
        name=K8S_HPA_MAX_PODS,
        description="The upper limit for the number of replica pods to which the autoscaler can scale up",
        unit="{pod}",
    )


K8S_HPA_METRIC_TARGET_CPU_AVERAGE_UTILIZATION: Final = (
    "k8s.hpa.metric.target.cpu.average_utilization"
)
"""
Target average utilization, in percentage, for CPU resource in HPA config
Instrument: gauge
Unit: 1
Note: This metric aligns with the `averageUtilization` field of the
[K8s HPA MetricTarget](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#metrictarget-v2-autoscaling).
If the type of the metric is [`ContainerResource`](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#support-for-metrics-apis),
the `k8s.container.name` attribute MUST be set to identify the specific container within the pod to which the metric applies.
"""


def create_k8s_hpa_metric_target_cpu_average_utilization(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Target average utilization, in percentage, for CPU resource in HPA config"""
    return meter.create_observable_gauge(
        name=K8S_HPA_METRIC_TARGET_CPU_AVERAGE_UTILIZATION,
        callbacks=callbacks,
        description="Target average utilization, in percentage, for CPU resource in HPA config.",
        unit="1",
    )


K8S_HPA_METRIC_TARGET_CPU_AVERAGE_VALUE: Final = (
    "k8s.hpa.metric.target.cpu.average_value"
)
"""
Target average value for CPU resource in HPA config
Instrument: gauge
Unit: {cpu}
Note: This metric aligns with the `averageValue` field of the
[K8s HPA MetricTarget](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#metrictarget-v2-autoscaling).
If the type of the metric is [`ContainerResource`](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#support-for-metrics-apis),
the `k8s.container.name` attribute MUST be set to identify the specific container within the pod to which the metric applies.
"""


def create_k8s_hpa_metric_target_cpu_average_value(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Target average value for CPU resource in HPA config"""
    return meter.create_observable_gauge(
        name=K8S_HPA_METRIC_TARGET_CPU_AVERAGE_VALUE,
        callbacks=callbacks,
        description="Target average value for CPU resource in HPA config.",
        unit="{cpu}",
    )


K8S_HPA_METRIC_TARGET_CPU_VALUE: Final = "k8s.hpa.metric.target.cpu.value"
"""
Target value for CPU resource in HPA config
Instrument: gauge
Unit: {cpu}
Note: This metric aligns with the `value` field of the
[K8s HPA MetricTarget](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#metrictarget-v2-autoscaling).
If the type of the metric is [`ContainerResource`](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/#support-for-metrics-apis),
the `k8s.container.name` attribute MUST be set to identify the specific container within the pod to which the metric applies.
"""


def create_k8s_hpa_metric_target_cpu_value(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Target value for CPU resource in HPA config"""
    return meter.create_observable_gauge(
        name=K8S_HPA_METRIC_TARGET_CPU_VALUE,
        callbacks=callbacks,
        description="Target value for CPU resource in HPA config.",
        unit="{cpu}",
    )


K8S_HPA_MIN_PODS: Final = "k8s.hpa.min_pods"
"""
The lower limit for the number of replica pods to which the autoscaler can scale down
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `minReplicas` field of the
[K8s HorizontalPodAutoscalerSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#horizontalpodautoscalerspec-v2-autoscaling).
"""


def create_k8s_hpa_min_pods(meter: Meter) -> UpDownCounter:
    """The lower limit for the number of replica pods to which the autoscaler can scale down"""
    return meter.create_up_down_counter(
        name=K8S_HPA_MIN_PODS,
        description="The lower limit for the number of replica pods to which the autoscaler can scale down",
        unit="{pod}",
    )


K8S_JOB_ACTIVE_PODS: Final = "k8s.job.active_pods"
"""
The number of pending and actively running pods for a job
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `active` field of the
[K8s JobStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#jobstatus-v1-batch).
"""


def create_k8s_job_active_pods(meter: Meter) -> UpDownCounter:
    """The number of pending and actively running pods for a job"""
    return meter.create_up_down_counter(
        name=K8S_JOB_ACTIVE_PODS,
        description="The number of pending and actively running pods for a job",
        unit="{pod}",
    )


K8S_JOB_DESIRED_SUCCESSFUL_PODS: Final = "k8s.job.desired_successful_pods"
"""
The desired number of successfully finished pods the job should be run with
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `completions` field of the
[K8s JobSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#jobspec-v1-batch).
"""


def create_k8s_job_desired_successful_pods(meter: Meter) -> UpDownCounter:
    """The desired number of successfully finished pods the job should be run with"""
    return meter.create_up_down_counter(
        name=K8S_JOB_DESIRED_SUCCESSFUL_PODS,
        description="The desired number of successfully finished pods the job should be run with",
        unit="{pod}",
    )


K8S_JOB_FAILED_PODS: Final = "k8s.job.failed_pods"
"""
The number of pods which reached phase Failed for a job
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `failed` field of the
[K8s JobStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#jobstatus-v1-batch).
"""


def create_k8s_job_failed_pods(meter: Meter) -> UpDownCounter:
    """The number of pods which reached phase Failed for a job"""
    return meter.create_up_down_counter(
        name=K8S_JOB_FAILED_PODS,
        description="The number of pods which reached phase Failed for a job",
        unit="{pod}",
    )


K8S_JOB_MAX_PARALLEL_PODS: Final = "k8s.job.max_parallel_pods"
"""
The max desired number of pods the job should run at any given time
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `parallelism` field of the
[K8s JobSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#jobspec-v1-batch).
"""


def create_k8s_job_max_parallel_pods(meter: Meter) -> UpDownCounter:
    """The max desired number of pods the job should run at any given time"""
    return meter.create_up_down_counter(
        name=K8S_JOB_MAX_PARALLEL_PODS,
        description="The max desired number of pods the job should run at any given time",
        unit="{pod}",
    )


K8S_JOB_SUCCESSFUL_PODS: Final = "k8s.job.successful_pods"
"""
The number of pods which reached phase Succeeded for a job
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `succeeded` field of the
[K8s JobStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#jobstatus-v1-batch).
"""


def create_k8s_job_successful_pods(meter: Meter) -> UpDownCounter:
    """The number of pods which reached phase Succeeded for a job"""
    return meter.create_up_down_counter(
        name=K8S_JOB_SUCCESSFUL_PODS,
        description="The number of pods which reached phase Succeeded for a job",
        unit="{pod}",
    )


K8S_NAMESPACE_PHASE: Final = "k8s.namespace.phase"
"""
Describes number of K8s namespaces that are currently in a given phase
Instrument: updowncounter
Unit: {namespace}
"""


def create_k8s_namespace_phase(meter: Meter) -> UpDownCounter:
    """Describes number of K8s namespaces that are currently in a given phase"""
    return meter.create_up_down_counter(
        name=K8S_NAMESPACE_PHASE,
        description="Describes number of K8s namespaces that are currently in a given phase.",
        unit="{namespace}",
    )


K8S_NODE_ALLOCATABLE_CPU: Final = "k8s.node.allocatable.cpu"
"""
Amount of cpu allocatable on the node
Instrument: updowncounter
Unit: {cpu}
"""


def create_k8s_node_allocatable_cpu(meter: Meter) -> UpDownCounter:
    """Amount of cpu allocatable on the node"""
    return meter.create_up_down_counter(
        name=K8S_NODE_ALLOCATABLE_CPU,
        description="Amount of cpu allocatable on the node",
        unit="{cpu}",
    )


K8S_NODE_ALLOCATABLE_EPHEMERAL_STORAGE: Final = (
    "k8s.node.allocatable.ephemeral_storage"
)
"""
Amount of ephemeral-storage allocatable on the node
Instrument: updowncounter
Unit: By
"""


def create_k8s_node_allocatable_ephemeral_storage(
    meter: Meter,
) -> UpDownCounter:
    """Amount of ephemeral-storage allocatable on the node"""
    return meter.create_up_down_counter(
        name=K8S_NODE_ALLOCATABLE_EPHEMERAL_STORAGE,
        description="Amount of ephemeral-storage allocatable on the node",
        unit="By",
    )


K8S_NODE_ALLOCATABLE_MEMORY: Final = "k8s.node.allocatable.memory"
"""
Amount of memory allocatable on the node
Instrument: updowncounter
Unit: By
"""


def create_k8s_node_allocatable_memory(meter: Meter) -> UpDownCounter:
    """Amount of memory allocatable on the node"""
    return meter.create_up_down_counter(
        name=K8S_NODE_ALLOCATABLE_MEMORY,
        description="Amount of memory allocatable on the node",
        unit="By",
    )


K8S_NODE_ALLOCATABLE_PODS: Final = "k8s.node.allocatable.pods"
"""
Amount of pods allocatable on the node
Instrument: updowncounter
Unit: {pod}
"""


def create_k8s_node_allocatable_pods(meter: Meter) -> UpDownCounter:
    """Amount of pods allocatable on the node"""
    return meter.create_up_down_counter(
        name=K8S_NODE_ALLOCATABLE_PODS,
        description="Amount of pods allocatable on the node",
        unit="{pod}",
    )


K8S_NODE_CONDITION_STATUS: Final = "k8s.node.condition.status"
"""
Describes the condition of a particular Node
Instrument: updowncounter
Unit: {node}
Note: All possible node condition pairs (type and status) will be reported at each time interval to avoid missing metrics. Condition pairs corresponding to the current conditions' statuses will be non-zero.
"""


def create_k8s_node_condition_status(meter: Meter) -> UpDownCounter:
    """Describes the condition of a particular Node"""
    return meter.create_up_down_counter(
        name=K8S_NODE_CONDITION_STATUS,
        description="Describes the condition of a particular Node.",
        unit="{node}",
    )


K8S_NODE_CPU_TIME: Final = "k8s.node.cpu.time"
"""
Total CPU time consumed
Instrument: counter
Unit: s
Note: Total CPU time consumed by the specific Node on all available CPU cores.
"""


def create_k8s_node_cpu_time(meter: Meter) -> Counter:
    """Total CPU time consumed"""
    return meter.create_counter(
        name=K8S_NODE_CPU_TIME,
        description="Total CPU time consumed",
        unit="s",
    )


K8S_NODE_CPU_USAGE: Final = "k8s.node.cpu.usage"
"""
Node's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs
Instrument: gauge
Unit: {cpu}
Note: CPU usage of the specific Node on all available CPU cores, averaged over the sample window.
"""


def create_k8s_node_cpu_usage(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Node's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs"""
    return meter.create_observable_gauge(
        name=K8S_NODE_CPU_USAGE,
        callbacks=callbacks,
        description="Node's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs",
        unit="{cpu}",
    )


K8S_NODE_MEMORY_USAGE: Final = "k8s.node.memory.usage"
"""
Memory usage of the Node
Instrument: gauge
Unit: By
Note: Total memory usage of the Node.
"""


def create_k8s_node_memory_usage(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Memory usage of the Node"""
    return meter.create_observable_gauge(
        name=K8S_NODE_MEMORY_USAGE,
        callbacks=callbacks,
        description="Memory usage of the Node",
        unit="By",
    )


K8S_NODE_NETWORK_ERRORS: Final = "k8s.node.network.errors"
"""
Node network errors
Instrument: counter
Unit: {error}
"""


def create_k8s_node_network_errors(meter: Meter) -> Counter:
    """Node network errors"""
    return meter.create_counter(
        name=K8S_NODE_NETWORK_ERRORS,
        description="Node network errors",
        unit="{error}",
    )


K8S_NODE_NETWORK_IO: Final = "k8s.node.network.io"
"""
Network bytes for the Node
Instrument: counter
Unit: By
"""


def create_k8s_node_network_io(meter: Meter) -> Counter:
    """Network bytes for the Node"""
    return meter.create_counter(
        name=K8S_NODE_NETWORK_IO,
        description="Network bytes for the Node",
        unit="By",
    )


K8S_NODE_UPTIME: Final = "k8s.node.uptime"
"""
The time the Node has been running
Instrument: gauge
Unit: s
Note: Instrumentations SHOULD use a gauge with type `double` and measure uptime in seconds as a floating point number with the highest precision available.
The actual accuracy would depend on the instrumentation and operating system.
"""


def create_k8s_node_uptime(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """The time the Node has been running"""
    return meter.create_observable_gauge(
        name=K8S_NODE_UPTIME,
        callbacks=callbacks,
        description="The time the Node has been running",
        unit="s",
    )


K8S_POD_CPU_TIME: Final = "k8s.pod.cpu.time"
"""
Total CPU time consumed
Instrument: counter
Unit: s
Note: Total CPU time consumed by the specific Pod on all available CPU cores.
"""


def create_k8s_pod_cpu_time(meter: Meter) -> Counter:
    """Total CPU time consumed"""
    return meter.create_counter(
        name=K8S_POD_CPU_TIME,
        description="Total CPU time consumed",
        unit="s",
    )


K8S_POD_CPU_USAGE: Final = "k8s.pod.cpu.usage"
"""
Pod's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs
Instrument: gauge
Unit: {cpu}
Note: CPU usage of the specific Pod on all available CPU cores, averaged over the sample window.
"""


def create_k8s_pod_cpu_usage(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Pod's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs"""
    return meter.create_observable_gauge(
        name=K8S_POD_CPU_USAGE,
        callbacks=callbacks,
        description="Pod's CPU usage, measured in cpus. Range from 0 to the number of allocatable CPUs",
        unit="{cpu}",
    )


K8S_POD_MEMORY_USAGE: Final = "k8s.pod.memory.usage"
"""
Memory usage of the Pod
Instrument: gauge
Unit: By
Note: Total memory usage of the Pod.
"""


def create_k8s_pod_memory_usage(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """Memory usage of the Pod"""
    return meter.create_observable_gauge(
        name=K8S_POD_MEMORY_USAGE,
        callbacks=callbacks,
        description="Memory usage of the Pod",
        unit="By",
    )


K8S_POD_NETWORK_ERRORS: Final = "k8s.pod.network.errors"
"""
Pod network errors
Instrument: counter
Unit: {error}
"""


def create_k8s_pod_network_errors(meter: Meter) -> Counter:
    """Pod network errors"""
    return meter.create_counter(
        name=K8S_POD_NETWORK_ERRORS,
        description="Pod network errors",
        unit="{error}",
    )


K8S_POD_NETWORK_IO: Final = "k8s.pod.network.io"
"""
Network bytes for the Pod
Instrument: counter
Unit: By
"""


def create_k8s_pod_network_io(meter: Meter) -> Counter:
    """Network bytes for the Pod"""
    return meter.create_counter(
        name=K8S_POD_NETWORK_IO,
        description="Network bytes for the Pod",
        unit="By",
    )


K8S_POD_UPTIME: Final = "k8s.pod.uptime"
"""
The time the Pod has been running
Instrument: gauge
Unit: s
Note: Instrumentations SHOULD use a gauge with type `double` and measure uptime in seconds as a floating point number with the highest precision available.
The actual accuracy would depend on the instrumentation and operating system.
"""


def create_k8s_pod_uptime(
    meter: Meter, callbacks: Optional[Sequence[CallbackT]]
) -> ObservableGauge:
    """The time the Pod has been running"""
    return meter.create_observable_gauge(
        name=K8S_POD_UPTIME,
        callbacks=callbacks,
        description="The time the Pod has been running",
        unit="s",
    )


K8S_REPLICASET_AVAILABLE_PODS: Final = "k8s.replicaset.available_pods"
"""
Total number of available replica pods (ready for at least minReadySeconds) targeted by this replicaset
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `availableReplicas` field of the
[K8s ReplicaSetStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#replicasetstatus-v1-apps).
"""


def create_k8s_replicaset_available_pods(meter: Meter) -> UpDownCounter:
    """Total number of available replica pods (ready for at least minReadySeconds) targeted by this replicaset"""
    return meter.create_up_down_counter(
        name=K8S_REPLICASET_AVAILABLE_PODS,
        description="Total number of available replica pods (ready for at least minReadySeconds) targeted by this replicaset",
        unit="{pod}",
    )


K8S_REPLICASET_DESIRED_PODS: Final = "k8s.replicaset.desired_pods"
"""
Number of desired replica pods in this replicaset
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `replicas` field of the
[K8s ReplicaSetSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#replicasetspec-v1-apps).
"""


def create_k8s_replicaset_desired_pods(meter: Meter) -> UpDownCounter:
    """Number of desired replica pods in this replicaset"""
    return meter.create_up_down_counter(
        name=K8S_REPLICASET_DESIRED_PODS,
        description="Number of desired replica pods in this replicaset",
        unit="{pod}",
    )


K8S_REPLICATION_CONTROLLER_AVAILABLE_PODS: Final = (
    "k8s.replication_controller.available_pods"
)
"""
Deprecated: Replaced by `k8s.replicationcontroller.available_pods`.
"""


def create_k8s_replication_controller_available_pods(
    meter: Meter,
) -> UpDownCounter:
    """Deprecated, use `k8s.replicationcontroller.available_pods` instead"""
    return meter.create_up_down_counter(
        name=K8S_REPLICATION_CONTROLLER_AVAILABLE_PODS,
        description="Deprecated, use `k8s.replicationcontroller.available_pods` instead.",
        unit="{pod}",
    )


K8S_REPLICATION_CONTROLLER_DESIRED_PODS: Final = (
    "k8s.replication_controller.desired_pods"
)
"""
Deprecated: Replaced by `k8s.replicationcontroller.desired_pods`.
"""


def create_k8s_replication_controller_desired_pods(
    meter: Meter,
) -> UpDownCounter:
    """Deprecated, use `k8s.replicationcontroller.desired_pods` instead"""
    return meter.create_up_down_counter(
        name=K8S_REPLICATION_CONTROLLER_DESIRED_PODS,
        description="Deprecated, use `k8s.replicationcontroller.desired_pods` instead.",
        unit="{pod}",
    )


K8S_REPLICATIONCONTROLLER_AVAILABLE_PODS: Final = (
    "k8s.replicationcontroller.available_pods"
)
"""
Total number of available replica pods (ready for at least minReadySeconds) targeted by this replication controller
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `availableReplicas` field of the
[K8s ReplicationControllerStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#replicationcontrollerstatus-v1-core).
"""


def create_k8s_replicationcontroller_available_pods(
    meter: Meter,
) -> UpDownCounter:
    """Total number of available replica pods (ready for at least minReadySeconds) targeted by this replication controller"""
    return meter.create_up_down_counter(
        name=K8S_REPLICATIONCONTROLLER_AVAILABLE_PODS,
        description="Total number of available replica pods (ready for at least minReadySeconds) targeted by this replication controller",
        unit="{pod}",
    )


K8S_REPLICATIONCONTROLLER_DESIRED_PODS: Final = (
    "k8s.replicationcontroller.desired_pods"
)
"""
Number of desired replica pods in this replication controller
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `replicas` field of the
[K8s ReplicationControllerSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#replicationcontrollerspec-v1-core).
"""


def create_k8s_replicationcontroller_desired_pods(
    meter: Meter,
) -> UpDownCounter:
    """Number of desired replica pods in this replication controller"""
    return meter.create_up_down_counter(
        name=K8S_REPLICATIONCONTROLLER_DESIRED_PODS,
        description="Number of desired replica pods in this replication controller",
        unit="{pod}",
    )


K8S_RESOURCEQUOTA_CPU_LIMIT_HARD: Final = "k8s.resourcequota.cpu.limit.hard"
"""
The CPU limits in a specific namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: {cpu}
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_cpu_limit_hard(meter: Meter) -> UpDownCounter:
    """The CPU limits in a specific namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_CPU_LIMIT_HARD,
        description="The CPU limits in a specific namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="{cpu}",
    )


K8S_RESOURCEQUOTA_CPU_LIMIT_USED: Final = "k8s.resourcequota.cpu.limit.used"
"""
The CPU limits in a specific namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: {cpu}
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_cpu_limit_used(meter: Meter) -> UpDownCounter:
    """The CPU limits in a specific namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_CPU_LIMIT_USED,
        description="The CPU limits in a specific namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="{cpu}",
    )


K8S_RESOURCEQUOTA_CPU_REQUEST_HARD: Final = (
    "k8s.resourcequota.cpu.request.hard"
)
"""
The CPU requests in a specific namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: {cpu}
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_cpu_request_hard(meter: Meter) -> UpDownCounter:
    """The CPU requests in a specific namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_CPU_REQUEST_HARD,
        description="The CPU requests in a specific namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="{cpu}",
    )


K8S_RESOURCEQUOTA_CPU_REQUEST_USED: Final = (
    "k8s.resourcequota.cpu.request.used"
)
"""
The CPU requests in a specific namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: {cpu}
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_cpu_request_used(meter: Meter) -> UpDownCounter:
    """The CPU requests in a specific namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_CPU_REQUEST_USED,
        description="The CPU requests in a specific namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="{cpu}",
    )


K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_LIMIT_HARD: Final = (
    "k8s.resourcequota.ephemeral_storage.limit.hard"
)
"""
The sum of local ephemeral storage limits in the namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_ephemeral_storage_limit_hard(
    meter: Meter,
) -> UpDownCounter:
    """The sum of local ephemeral storage limits in the namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_LIMIT_HARD,
        description="The sum of local ephemeral storage limits in the namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_LIMIT_USED: Final = (
    "k8s.resourcequota.ephemeral_storage.limit.used"
)
"""
The sum of local ephemeral storage limits in the namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_ephemeral_storage_limit_used(
    meter: Meter,
) -> UpDownCounter:
    """The sum of local ephemeral storage limits in the namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_LIMIT_USED,
        description="The sum of local ephemeral storage limits in the namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_REQUEST_HARD: Final = (
    "k8s.resourcequota.ephemeral_storage.request.hard"
)
"""
The sum of local ephemeral storage requests in the namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_ephemeral_storage_request_hard(
    meter: Meter,
) -> UpDownCounter:
    """The sum of local ephemeral storage requests in the namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_REQUEST_HARD,
        description="The sum of local ephemeral storage requests in the namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_REQUEST_USED: Final = (
    "k8s.resourcequota.ephemeral_storage.request.used"
)
"""
The sum of local ephemeral storage requests in the namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_ephemeral_storage_request_used(
    meter: Meter,
) -> UpDownCounter:
    """The sum of local ephemeral storage requests in the namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_EPHEMERAL_STORAGE_REQUEST_USED,
        description="The sum of local ephemeral storage requests in the namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_HUGEPAGE_COUNT_REQUEST_HARD: Final = (
    "k8s.resourcequota.hugepage_count.request.hard"
)
"""
The huge page requests in a specific namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: {hugepage}
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_hugepage_count_request_hard(
    meter: Meter,
) -> UpDownCounter:
    """The huge page requests in a specific namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_HUGEPAGE_COUNT_REQUEST_HARD,
        description="The huge page requests in a specific namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="{hugepage}",
    )


K8S_RESOURCEQUOTA_HUGEPAGE_COUNT_REQUEST_USED: Final = (
    "k8s.resourcequota.hugepage_count.request.used"
)
"""
The huge page requests in a specific namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: {hugepage}
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_hugepage_count_request_used(
    meter: Meter,
) -> UpDownCounter:
    """The huge page requests in a specific namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_HUGEPAGE_COUNT_REQUEST_USED,
        description="The huge page requests in a specific namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="{hugepage}",
    )


K8S_RESOURCEQUOTA_MEMORY_LIMIT_HARD: Final = (
    "k8s.resourcequota.memory.limit.hard"
)
"""
The memory limits in a specific namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_memory_limit_hard(meter: Meter) -> UpDownCounter:
    """The memory limits in a specific namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_MEMORY_LIMIT_HARD,
        description="The memory limits in a specific namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_MEMORY_LIMIT_USED: Final = (
    "k8s.resourcequota.memory.limit.used"
)
"""
The memory limits in a specific namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_memory_limit_used(meter: Meter) -> UpDownCounter:
    """The memory limits in a specific namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_MEMORY_LIMIT_USED,
        description="The memory limits in a specific namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_MEMORY_REQUEST_HARD: Final = (
    "k8s.resourcequota.memory.request.hard"
)
"""
The memory requests in a specific namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_memory_request_hard(
    meter: Meter,
) -> UpDownCounter:
    """The memory requests in a specific namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_MEMORY_REQUEST_HARD,
        description="The memory requests in a specific namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_MEMORY_REQUEST_USED: Final = (
    "k8s.resourcequota.memory.request.used"
)
"""
The memory requests in a specific namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_memory_request_used(
    meter: Meter,
) -> UpDownCounter:
    """The memory requests in a specific namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_MEMORY_REQUEST_USED,
        description="The memory requests in a specific namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_OBJECT_COUNT_HARD: Final = (
    "k8s.resourcequota.object_count.hard"
)
"""
The object count limits in a specific namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: {object}
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_object_count_hard(meter: Meter) -> UpDownCounter:
    """The object count limits in a specific namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_OBJECT_COUNT_HARD,
        description="The object count limits in a specific namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="{object}",
    )


K8S_RESOURCEQUOTA_OBJECT_COUNT_USED: Final = (
    "k8s.resourcequota.object_count.used"
)
"""
The object count limits in a specific namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: {object}
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).
"""


def create_k8s_resourcequota_object_count_used(meter: Meter) -> UpDownCounter:
    """The object count limits in a specific namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_OBJECT_COUNT_USED,
        description="The object count limits in a specific namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="{object}",
    )


K8S_RESOURCEQUOTA_PERSISTENTVOLUMECLAIM_COUNT_HARD: Final = (
    "k8s.resourcequota.persistentvolumeclaim_count.hard"
)
"""
The total number of PersistentVolumeClaims that can exist in the namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: {persistentvolumeclaim}
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).

The `k8s.storageclass.name` should be required when a resource quota is defined for a specific
storage class.
"""


def create_k8s_resourcequota_persistentvolumeclaim_count_hard(
    meter: Meter,
) -> UpDownCounter:
    """The total number of PersistentVolumeClaims that can exist in the namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_PERSISTENTVOLUMECLAIM_COUNT_HARD,
        description="The total number of PersistentVolumeClaims that can exist in the namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="{persistentvolumeclaim}",
    )


K8S_RESOURCEQUOTA_PERSISTENTVOLUMECLAIM_COUNT_USED: Final = (
    "k8s.resourcequota.persistentvolumeclaim_count.used"
)
"""
The total number of PersistentVolumeClaims that can exist in the namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: {persistentvolumeclaim}
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).

The `k8s.storageclass.name` should be required when a resource quota is defined for a specific
storage class.
"""


def create_k8s_resourcequota_persistentvolumeclaim_count_used(
    meter: Meter,
) -> UpDownCounter:
    """The total number of PersistentVolumeClaims that can exist in the namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_PERSISTENTVOLUMECLAIM_COUNT_USED,
        description="The total number of PersistentVolumeClaims that can exist in the namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="{persistentvolumeclaim}",
    )


K8S_RESOURCEQUOTA_STORAGE_REQUEST_HARD: Final = (
    "k8s.resourcequota.storage.request.hard"
)
"""
The storage requests in a specific namespace.
The value represents the configured quota limit of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `hard` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).

The `k8s.storageclass.name` should be required when a resource quota is defined for a specific
storage class.
"""


def create_k8s_resourcequota_storage_request_hard(
    meter: Meter,
) -> UpDownCounter:
    """The storage requests in a specific namespace.
    The value represents the configured quota limit of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_STORAGE_REQUEST_HARD,
        description="The storage requests in a specific namespace. The value represents the configured quota limit of the resource in the namespace.",
        unit="By",
    )


K8S_RESOURCEQUOTA_STORAGE_REQUEST_USED: Final = (
    "k8s.resourcequota.storage.request.used"
)
"""
The storage requests in a specific namespace.
The value represents the current observed total usage of the resource in the namespace
Instrument: updowncounter
Unit: By
Note: This metric is retrieved from the `used` field of the
[K8s ResourceQuotaStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.32/#resourcequotastatus-v1-core).

The `k8s.storageclass.name` should be required when a resource quota is defined for a specific
storage class.
"""


def create_k8s_resourcequota_storage_request_used(
    meter: Meter,
) -> UpDownCounter:
    """The storage requests in a specific namespace.
    The value represents the current observed total usage of the resource in the namespace"""
    return meter.create_up_down_counter(
        name=K8S_RESOURCEQUOTA_STORAGE_REQUEST_USED,
        description="The storage requests in a specific namespace. The value represents the current observed total usage of the resource in the namespace.",
        unit="By",
    )


K8S_STATEFULSET_CURRENT_PODS: Final = "k8s.statefulset.current_pods"
"""
The number of replica pods created by the statefulset controller from the statefulset version indicated by currentRevision
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `currentReplicas` field of the
[K8s StatefulSetStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#statefulsetstatus-v1-apps).
"""


def create_k8s_statefulset_current_pods(meter: Meter) -> UpDownCounter:
    """The number of replica pods created by the statefulset controller from the statefulset version indicated by currentRevision"""
    return meter.create_up_down_counter(
        name=K8S_STATEFULSET_CURRENT_PODS,
        description="The number of replica pods created by the statefulset controller from the statefulset version indicated by currentRevision",
        unit="{pod}",
    )


K8S_STATEFULSET_DESIRED_PODS: Final = "k8s.statefulset.desired_pods"
"""
Number of desired replica pods in this statefulset
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `replicas` field of the
[K8s StatefulSetSpec](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#statefulsetspec-v1-apps).
"""


def create_k8s_statefulset_desired_pods(meter: Meter) -> UpDownCounter:
    """Number of desired replica pods in this statefulset"""
    return meter.create_up_down_counter(
        name=K8S_STATEFULSET_DESIRED_PODS,
        description="Number of desired replica pods in this statefulset",
        unit="{pod}",
    )


K8S_STATEFULSET_READY_PODS: Final = "k8s.statefulset.ready_pods"
"""
The number of replica pods created for this statefulset with a Ready Condition
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `readyReplicas` field of the
[K8s StatefulSetStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#statefulsetstatus-v1-apps).
"""


def create_k8s_statefulset_ready_pods(meter: Meter) -> UpDownCounter:
    """The number of replica pods created for this statefulset with a Ready Condition"""
    return meter.create_up_down_counter(
        name=K8S_STATEFULSET_READY_PODS,
        description="The number of replica pods created for this statefulset with a Ready Condition",
        unit="{pod}",
    )


K8S_STATEFULSET_UPDATED_PODS: Final = "k8s.statefulset.updated_pods"
"""
Number of replica pods created by the statefulset controller from the statefulset version indicated by updateRevision
Instrument: updowncounter
Unit: {pod}
Note: This metric aligns with the `updatedReplicas` field of the
[K8s StatefulSetStatus](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.30/#statefulsetstatus-v1-apps).
"""


def create_k8s_statefulset_updated_pods(meter: Meter) -> UpDownCounter:
    """Number of replica pods created by the statefulset controller from the statefulset version indicated by updateRevision"""
    return meter.create_up_down_counter(
        name=K8S_STATEFULSET_UPDATED_PODS,
        description="Number of replica pods created by the statefulset controller from the statefulset version indicated by updateRevision",
        unit="{pod}",
    )
