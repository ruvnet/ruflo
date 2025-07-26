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

from typing_extensions import deprecated

CONTAINER_COMMAND: Final = "container.command"
"""
The command used to run the container (i.e. the command name).
Note: If using embedded credentials or sensitive data, it is recommended to remove them to prevent potential leakage.
"""

CONTAINER_COMMAND_ARGS: Final = "container.command_args"
"""
All the command arguments (including the command/executable itself) run by the container.
"""

CONTAINER_COMMAND_LINE: Final = "container.command_line"
"""
The full command run by the container as a single string representing the full command.
"""

CONTAINER_CPU_STATE: Final = "container.cpu.state"
"""
Deprecated: Replaced by `cpu.mode`.
"""

CONTAINER_CSI_PLUGIN_NAME: Final = "container.csi.plugin.name"
"""
The name of the CSI ([Container Storage Interface](https://github.com/container-storage-interface/spec)) plugin used by the volume.
Note: This can sometimes be referred to as a "driver" in CSI implementations. This should represent the `name` field of the GetPluginInfo RPC.
"""

CONTAINER_CSI_VOLUME_ID: Final = "container.csi.volume.id"
"""
The unique volume ID returned by the CSI ([Container Storage Interface](https://github.com/container-storage-interface/spec)) plugin.
Note: This can sometimes be referred to as a "volume handle" in CSI implementations. This should represent the `Volume.volume_id` field in CSI spec.
"""

CONTAINER_ID: Final = "container.id"
"""
Container ID. Usually a UUID, as for example used to [identify Docker containers](https://docs.docker.com/engine/containers/run/#container-identification). The UUID might be abbreviated.
"""

CONTAINER_IMAGE_ID: Final = "container.image.id"
"""
Runtime specific image identifier. Usually a hash algorithm followed by a UUID.
Note: Docker defines a sha256 of the image id; `container.image.id` corresponds to the `Image` field from the Docker container inspect [API](https://docs.docker.com/engine/api/v1.43/#tag/Container/operation/ContainerInspect) endpoint.
K8s defines a link to the container registry repository with digest `"imageID": "registry.azurecr.io /namespace/service/dockerfile@sha256:bdeabd40c3a8a492eaf9e8e44d0ebbb84bac7ee25ac0cf8a7159d25f62555625"`.
The ID is assigned by the container runtime and can vary in different environments. Consider using `oci.manifest.digest` if it is important to identify the same image in different environments/runtimes.
"""

CONTAINER_IMAGE_NAME: Final = "container.image.name"
"""
Name of the image the container was built on.
"""

CONTAINER_IMAGE_REPO_DIGESTS: Final = "container.image.repo_digests"
"""
Repo digests of the container image as provided by the container runtime.
Note: [Docker](https://docs.docker.com/engine/api/v1.43/#tag/Image/operation/ImageInspect) and [CRI](https://github.com/kubernetes/cri-api/blob/c75ef5b473bbe2d0a4fc92f82235efd665ea8e9f/pkg/apis/runtime/v1/api.proto#L1237-L1238) report those under the `RepoDigests` field.
"""

CONTAINER_IMAGE_TAGS: Final = "container.image.tags"
"""
Container image tags. An example can be found in [Docker Image Inspect](https://docs.docker.com/engine/api/v1.43/#tag/Image/operation/ImageInspect). Should be only the `<tag>` section of the full name for example from `registry.example.com/my-org/my-image:<tag>`.
"""

CONTAINER_LABEL_TEMPLATE: Final = "container.label"
"""
Container labels, `<key>` being the label name, the value being the label value.
Note: For example, a docker container label `app` with value `nginx` SHOULD be recorded as the `container.label.app` attribute with value `"nginx"`.
"""

CONTAINER_LABELS_TEMPLATE: Final = "container.labels"
"""
Deprecated: Replaced by `container.label`.
"""

CONTAINER_NAME: Final = "container.name"
"""
Container name used by container runtime.
"""

CONTAINER_RUNTIME: Final = "container.runtime"
"""
The container runtime managing this container.
"""


@deprecated(
    "The attribute container.cpu.state is deprecated - Replaced by `cpu.mode`"
)
class ContainerCpuStateValues(Enum):
    USER = "user"
    """When tasks of the cgroup are in user mode (Linux). When all container processes are in user mode (Windows)."""
    SYSTEM = "system"
    """When CPU is used by the system (host OS)."""
    KERNEL = "kernel"
    """When tasks of the cgroup are in kernel mode (Linux). When all container processes are in kernel mode (Windows)."""
