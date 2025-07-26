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

"""
This package implements `OpenTelemetry Resources
<https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/resource/sdk.md#resource-sdk>`_:

    *A Resource is an immutable representation of the entity producing
    telemetry. For example, a process producing telemetry that is running in
    a container on Kubernetes has a Pod name, it is in a namespace and
    possibly is part of a Deployment which also has a name. All three of
    these attributes can be included in the Resource.*

Resource objects are created with `Resource.create`, which accepts attributes
(key-values). Resources should NOT be created via constructor except by `ResourceDetector`
instances which can't use `Resource.create` to avoid infinite loops. Working with
`Resource` objects should only be done via the Resource API methods. Resource
attributes can also be passed at process invocation in the
:envvar:`OTEL_RESOURCE_ATTRIBUTES` environment variable. You should register
your resource with the  `opentelemetry.sdk.trace.TracerProvider` by passing
them into their constructors. The `Resource` passed to a provider is available
to the exporter, which can send on this information as it sees fit.

.. code-block:: python

    trace.set_tracer_provider(
        TracerProvider(
            resource=Resource.create({
                "service.name": "shoppingcart",
                "service.instance.id": "instance-12",
            }),
        ),
    )
    print(trace.get_tracer_provider().resource.attributes)

    {'telemetry.sdk.language': 'python',
    'telemetry.sdk.name': 'opentelemetry',
    'telemetry.sdk.version': '0.13.dev0',
    'service.name': 'shoppingcart',
    'service.instance.id': 'instance-12'}

Note that the OpenTelemetry project documents certain `"standard attributes"
<https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/resource/semantic_conventions/README.md>`_
that have prescribed semantic meanings, for example ``service.name`` in the
above example.
"""

# ResourceAttributes is deprecated
# pyright: reportDeprecated=false

import abc
import concurrent.futures
import logging
import os
import platform
import socket
import sys
import typing
from json import dumps
from os import environ
from types import ModuleType
from typing import List, Optional, cast
from urllib import parse

from opentelemetry.attributes import BoundedAttributes
from opentelemetry.sdk.environment_variables import (
    OTEL_EXPERIMENTAL_RESOURCE_DETECTORS,
    OTEL_RESOURCE_ATTRIBUTES,
    OTEL_SERVICE_NAME,
)
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.util._importlib_metadata import (
    entry_points,  # type: ignore[reportUnknownVariableType]
    version,
)
from opentelemetry.util.types import AttributeValue

psutil: Optional[ModuleType] = None

try:
    import psutil as psutil_module

    psutil = psutil_module
except ImportError:
    pass

LabelValue = AttributeValue
Attributes = typing.Mapping[str, LabelValue]
logger = logging.getLogger(__name__)

CLOUD_PROVIDER = ResourceAttributes.CLOUD_PROVIDER
CLOUD_ACCOUNT_ID = ResourceAttributes.CLOUD_ACCOUNT_ID
CLOUD_REGION = ResourceAttributes.CLOUD_REGION
CLOUD_AVAILABILITY_ZONE = ResourceAttributes.CLOUD_AVAILABILITY_ZONE
CONTAINER_NAME = ResourceAttributes.CONTAINER_NAME
CONTAINER_ID = ResourceAttributes.CONTAINER_ID
CONTAINER_IMAGE_NAME = ResourceAttributes.CONTAINER_IMAGE_NAME
CONTAINER_IMAGE_TAG = ResourceAttributes.CONTAINER_IMAGE_TAG
DEPLOYMENT_ENVIRONMENT = ResourceAttributes.DEPLOYMENT_ENVIRONMENT
FAAS_NAME = ResourceAttributes.FAAS_NAME
FAAS_ID = ResourceAttributes.FAAS_ID
FAAS_VERSION = ResourceAttributes.FAAS_VERSION
FAAS_INSTANCE = ResourceAttributes.FAAS_INSTANCE
HOST_NAME = ResourceAttributes.HOST_NAME
HOST_ARCH = ResourceAttributes.HOST_ARCH
HOST_TYPE = ResourceAttributes.HOST_TYPE
HOST_IMAGE_NAME = ResourceAttributes.HOST_IMAGE_NAME
HOST_IMAGE_ID = ResourceAttributes.HOST_IMAGE_ID
HOST_IMAGE_VERSION = ResourceAttributes.HOST_IMAGE_VERSION
KUBERNETES_CLUSTER_NAME = ResourceAttributes.K8S_CLUSTER_NAME
KUBERNETES_NAMESPACE_NAME = ResourceAttributes.K8S_NAMESPACE_NAME
KUBERNETES_POD_UID = ResourceAttributes.K8S_POD_UID
KUBERNETES_POD_NAME = ResourceAttributes.K8S_POD_NAME
KUBERNETES_CONTAINER_NAME = ResourceAttributes.K8S_CONTAINER_NAME
KUBERNETES_REPLICA_SET_UID = ResourceAttributes.K8S_REPLICASET_UID
KUBERNETES_REPLICA_SET_NAME = ResourceAttributes.K8S_REPLICASET_NAME
KUBERNETES_DEPLOYMENT_UID = ResourceAttributes.K8S_DEPLOYMENT_UID
KUBERNETES_DEPLOYMENT_NAME = ResourceAttributes.K8S_DEPLOYMENT_NAME
KUBERNETES_STATEFUL_SET_UID = ResourceAttributes.K8S_STATEFULSET_UID
KUBERNETES_STATEFUL_SET_NAME = ResourceAttributes.K8S_STATEFULSET_NAME
KUBERNETES_DAEMON_SET_UID = ResourceAttributes.K8S_DAEMONSET_UID
KUBERNETES_DAEMON_SET_NAME = ResourceAttributes.K8S_DAEMONSET_NAME
KUBERNETES_JOB_UID = ResourceAttributes.K8S_JOB_UID
KUBERNETES_JOB_NAME = ResourceAttributes.K8S_JOB_NAME
KUBERNETES_CRON_JOB_UID = ResourceAttributes.K8S_CRONJOB_UID
KUBERNETES_CRON_JOB_NAME = ResourceAttributes.K8S_CRONJOB_NAME
OS_DESCRIPTION = ResourceAttributes.OS_DESCRIPTION
OS_TYPE = ResourceAttributes.OS_TYPE
OS_VERSION = ResourceAttributes.OS_VERSION
PROCESS_PID = ResourceAttributes.PROCESS_PID
PROCESS_PARENT_PID = ResourceAttributes.PROCESS_PARENT_PID
PROCESS_EXECUTABLE_NAME = ResourceAttributes.PROCESS_EXECUTABLE_NAME
PROCESS_EXECUTABLE_PATH = ResourceAttributes.PROCESS_EXECUTABLE_PATH
PROCESS_COMMAND = ResourceAttributes.PROCESS_COMMAND
PROCESS_COMMAND_LINE = ResourceAttributes.PROCESS_COMMAND_LINE
PROCESS_COMMAND_ARGS = ResourceAttributes.PROCESS_COMMAND_ARGS
PROCESS_OWNER = ResourceAttributes.PROCESS_OWNER
PROCESS_RUNTIME_NAME = ResourceAttributes.PROCESS_RUNTIME_NAME
PROCESS_RUNTIME_VERSION = ResourceAttributes.PROCESS_RUNTIME_VERSION
PROCESS_RUNTIME_DESCRIPTION = ResourceAttributes.PROCESS_RUNTIME_DESCRIPTION
SERVICE_NAME = ResourceAttributes.SERVICE_NAME
SERVICE_NAMESPACE = ResourceAttributes.SERVICE_NAMESPACE
SERVICE_INSTANCE_ID = ResourceAttributes.SERVICE_INSTANCE_ID
SERVICE_VERSION = ResourceAttributes.SERVICE_VERSION
TELEMETRY_SDK_NAME = ResourceAttributes.TELEMETRY_SDK_NAME
TELEMETRY_SDK_VERSION = ResourceAttributes.TELEMETRY_SDK_VERSION
TELEMETRY_AUTO_VERSION = ResourceAttributes.TELEMETRY_AUTO_VERSION
TELEMETRY_SDK_LANGUAGE = ResourceAttributes.TELEMETRY_SDK_LANGUAGE

_OPENTELEMETRY_SDK_VERSION: str = version("opentelemetry-sdk")


class Resource:
    """A Resource is an immutable representation of the entity producing telemetry as Attributes."""

    _attributes: BoundedAttributes
    _schema_url: str

    def __init__(
        self, attributes: Attributes, schema_url: typing.Optional[str] = None
    ):
        self._attributes = BoundedAttributes(attributes=attributes)
        if schema_url is None:
            schema_url = ""
        self._schema_url = schema_url

    @staticmethod
    def create(
        attributes: typing.Optional[Attributes] = None,
        schema_url: typing.Optional[str] = None,
    ) -> "Resource":
        """Creates a new `Resource` from attributes.

        `ResourceDetector` instances should not call this method.

        Args:
            attributes: Optional zero or more key-value pairs.
            schema_url: Optional URL pointing to the schema

        Returns:
            The newly-created Resource.
        """

        if not attributes:
            attributes = {}

        otel_experimental_resource_detectors = {"otel"}.union(
            {
                otel_experimental_resource_detector.strip()
                for otel_experimental_resource_detector in environ.get(
                    OTEL_EXPERIMENTAL_RESOURCE_DETECTORS, ""
                ).split(",")
                if otel_experimental_resource_detector
            }
        )

        resource_detectors: List[ResourceDetector] = []

        resource_detector: str
        for resource_detector in otel_experimental_resource_detectors:
            try:
                resource_detectors.append(
                    next(
                        iter(
                            entry_points(
                                group="opentelemetry_resource_detector",
                                name=resource_detector.strip(),
                            )  # type: ignore[reportUnknownArgumentType]
                        )
                    ).load()()
                )
            except Exception:  # pylint: disable=broad-exception-caught
                logger.exception(
                    "Failed to load resource detector '%s', skipping",
                    resource_detector,
                )
                continue
        resource = get_aggregated_resources(
            resource_detectors, _DEFAULT_RESOURCE
        ).merge(Resource(attributes, schema_url))

        if not resource.attributes.get(SERVICE_NAME, None):
            default_service_name = "unknown_service"
            process_executable_name = cast(
                Optional[str],
                resource.attributes.get(PROCESS_EXECUTABLE_NAME, None),
            )
            if process_executable_name:
                default_service_name += ":" + process_executable_name
            resource = resource.merge(
                Resource({SERVICE_NAME: default_service_name}, schema_url)
            )
        return resource

    @staticmethod
    def get_empty() -> "Resource":
        return _EMPTY_RESOURCE

    @property
    def attributes(self) -> Attributes:
        return self._attributes

    @property
    def schema_url(self) -> str:
        return self._schema_url

    def merge(self, other: "Resource") -> "Resource":
        """Merges this resource and an updating resource into a new `Resource`.

        If a key exists on both the old and updating resource, the value of the
        updating resource will override the old resource value.

        The updating resource's `schema_url` will be used only if the old
        `schema_url` is empty. Attempting to merge two resources with
        different, non-empty values for `schema_url` will result in an error
        and return the old resource.

        Args:
            other: The other resource to be merged.

        Returns:
            The newly-created Resource.
        """
        merged_attributes = dict(self.attributes).copy()
        merged_attributes.update(other.attributes)

        if self.schema_url == "":
            schema_url = other.schema_url
        elif other.schema_url == "":
            schema_url = self.schema_url
        elif self.schema_url == other.schema_url:
            schema_url = other.schema_url
        else:
            logger.error(
                "Failed to merge resources: The two schemas %s and %s are incompatible",
                self.schema_url,
                other.schema_url,
            )
            return self
        return Resource(merged_attributes, schema_url)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Resource):
            return False
        return (
            self._attributes == other._attributes
            and self._schema_url == other._schema_url
        )

    def __hash__(self) -> int:
        return hash(
            f"{dumps(self._attributes.copy(), sort_keys=True)}|{self._schema_url}"
        )

    def to_json(self, indent: Optional[int] = 4) -> str:
        return dumps(
            {
                "attributes": dict(self.attributes),
                "schema_url": self._schema_url,
            },
            indent=indent,
        )


_EMPTY_RESOURCE = Resource({})
_DEFAULT_RESOURCE = Resource(
    {
        TELEMETRY_SDK_LANGUAGE: "python",
        TELEMETRY_SDK_NAME: "opentelemetry",
        TELEMETRY_SDK_VERSION: _OPENTELEMETRY_SDK_VERSION,
    }
)


class ResourceDetector(abc.ABC):
    def __init__(self, raise_on_error: bool = False) -> None:
        self.raise_on_error = raise_on_error

    @abc.abstractmethod
    def detect(self) -> "Resource":
        """Don't call `Resource.create` here to avoid an infinite loop, instead instantiate `Resource` directly"""
        raise NotImplementedError()


class OTELResourceDetector(ResourceDetector):
    # pylint: disable=no-self-use
    def detect(self) -> "Resource":
        env_resources_items = environ.get(OTEL_RESOURCE_ATTRIBUTES)
        env_resource_map: dict[str, AttributeValue] = {}

        if env_resources_items:
            for item in env_resources_items.split(","):
                try:
                    key, value = item.split("=", maxsplit=1)
                except ValueError as exc:
                    logger.warning(
                        "Invalid key value resource attribute pair %s: %s",
                        item,
                        exc,
                    )
                    continue
                value_url_decoded = parse.unquote(value.strip())
                env_resource_map[key.strip()] = value_url_decoded

        service_name = environ.get(OTEL_SERVICE_NAME)
        if service_name:
            env_resource_map[SERVICE_NAME] = service_name
        return Resource(env_resource_map)


class ProcessResourceDetector(ResourceDetector):
    # pylint: disable=no-self-use
    def detect(self) -> "Resource":
        _runtime_version = ".".join(
            map(
                str,
                (
                    sys.version_info[:3]
                    if sys.version_info.releaselevel == "final"
                    and not sys.version_info.serial
                    else sys.version_info
                ),
            )
        )
        _process_pid = os.getpid()
        _process_executable_name = sys.executable
        _process_executable_path = os.path.dirname(_process_executable_name)
        _process_command = sys.argv[0]
        _process_command_line = " ".join(sys.argv)
        _process_command_args = sys.argv
        resource_info = {
            PROCESS_RUNTIME_DESCRIPTION: sys.version,
            PROCESS_RUNTIME_NAME: sys.implementation.name,
            PROCESS_RUNTIME_VERSION: _runtime_version,
            PROCESS_PID: _process_pid,
            PROCESS_EXECUTABLE_NAME: _process_executable_name,
            PROCESS_EXECUTABLE_PATH: _process_executable_path,
            PROCESS_COMMAND: _process_command,
            PROCESS_COMMAND_LINE: _process_command_line,
            PROCESS_COMMAND_ARGS: _process_command_args,
        }
        if hasattr(os, "getppid"):
            # pypy3 does not have getppid()
            resource_info[PROCESS_PARENT_PID] = os.getppid()

        if psutil is not None:
            process = psutil.Process()
            username = process.username()
            resource_info[PROCESS_OWNER] = username

        return Resource(resource_info)  # type: ignore


class OsResourceDetector(ResourceDetector):
    """Detect os resources based on `Operating System conventions <https://opentelemetry.io/docs/specs/semconv/resource/os/>`_."""

    def detect(self) -> "Resource":
        """Returns a resource with with ``os.type`` and ``os.version``.

        Python's platform library
        ~~~~~~~~~~~~~~~~~~~~~~~~~

        To grab this information, Python's ``platform`` does not return what a
        user might expect it to. Below is a breakdown of its return values in
        different operating systems.

        .. code-block:: python
            :caption: Linux

            >>> platform.system()
            'Linux'
            >>> platform.release()
            '6.5.0-35-generic'
            >>> platform.version()
            '#35~22.04.1-Ubuntu SMP PREEMPT_DYNAMIC Tue May  7 09:00:52 UTC 2'

        .. code-block:: python
            :caption: MacOS

            >>> platform.system()
            'Darwin'
            >>> platform.release()
            '23.0.0'
            >>> platform.version()
            'Darwin Kernel Version 23.0.0: Fri Sep 15 14:42:57 PDT 2023; root:xnu-10002.1.13~1/RELEASE_ARM64_T8112'

        .. code-block:: python
            :caption: Windows

            >>> platform.system()
            'Windows'
            >>> platform.release()
            '2022Server'
            >>> platform.version()
            '10.0.20348'

        .. code-block:: python
            :caption: FreeBSD

            >>> platform.system()
            'FreeBSD'
            >>> platform.release()
            '14.1-RELEASE'
            >>> platform.version()
            'FreeBSD 14.1-RELEASE releng/14.1-n267679-10e31f0946d8 GENERIC'

        .. code-block:: python
            :caption: Solaris

            >>> platform.system()
            'SunOS'
            >>> platform.release()
            '5.11'
            >>> platform.version()
            '11.4.0.15.0'

        """

        os_type = platform.system().lower()
        os_version = platform.release()

        # See docstring
        if os_type == "windows":
            os_version = platform.version()
        # Align SunOS with conventions
        elif os_type == "sunos":
            os_type = "solaris"
            os_version = platform.version()

        return Resource(
            {
                OS_TYPE: os_type,
                OS_VERSION: os_version,
            }
        )


class _HostResourceDetector(ResourceDetector):  # type: ignore[reportUnusedClass]
    """
    The HostResourceDetector detects the hostname and architecture attributes.
    """

    def detect(self) -> "Resource":
        return Resource(
            {
                HOST_NAME: socket.gethostname(),
                HOST_ARCH: platform.machine(),
            }
        )


def get_aggregated_resources(
    detectors: typing.List["ResourceDetector"],
    initial_resource: typing.Optional[Resource] = None,
    timeout: int = 5,
) -> "Resource":
    """Retrieves resources from detectors in the order that they were passed

    :param detectors: List of resources in order of priority
    :param initial_resource: Static resource. This has highest priority
    :param timeout: Number of seconds to wait for each detector to return
    :return:
    """
    detectors_merged_resource = initial_resource or Resource.create()

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(detector.detect) for detector in detectors]
        for detector_ind, future in enumerate(futures):
            detector = detectors[detector_ind]
            detected_resource: Resource = _EMPTY_RESOURCE
            try:
                detected_resource = future.result(timeout=timeout)
            except concurrent.futures.TimeoutError as ex:
                if detector.raise_on_error:
                    raise ex
                logger.warning(
                    "Detector %s took longer than %s seconds, skipping",
                    detector,
                    timeout,
                )
            # pylint: disable=broad-exception-caught
            except Exception as ex:
                if detector.raise_on_error:
                    raise ex
                logger.warning(
                    "Exception %s in detector %s, ignoring", ex, detector
                )
            finally:
                detectors_merged_resource = detectors_merged_resource.merge(
                    detected_resource
                )

    return detectors_merged_resource
