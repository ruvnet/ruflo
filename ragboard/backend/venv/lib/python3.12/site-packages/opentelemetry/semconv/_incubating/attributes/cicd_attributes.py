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

CICD_PIPELINE_ACTION_NAME: Final = "cicd.pipeline.action.name"
"""
The kind of action a pipeline run is performing.
"""

CICD_PIPELINE_NAME: Final = "cicd.pipeline.name"
"""
The human readable name of the pipeline within a CI/CD system.
"""

CICD_PIPELINE_RESULT: Final = "cicd.pipeline.result"
"""
The result of a pipeline run.
"""

CICD_PIPELINE_RUN_ID: Final = "cicd.pipeline.run.id"
"""
The unique identifier of a pipeline run within a CI/CD system.
"""

CICD_PIPELINE_RUN_STATE: Final = "cicd.pipeline.run.state"
"""
The pipeline run goes through these states during its lifecycle.
"""

CICD_PIPELINE_RUN_URL_FULL: Final = "cicd.pipeline.run.url.full"
"""
The [URL](https://wikipedia.org/wiki/URL) of the pipeline run, providing the complete address in order to locate and identify the pipeline run.
"""

CICD_PIPELINE_TASK_NAME: Final = "cicd.pipeline.task.name"
"""
The human readable name of a task within a pipeline. Task here most closely aligns with a [computing process](https://wikipedia.org/wiki/Pipeline_(computing)) in a pipeline. Other terms for tasks include commands, steps, and procedures.
"""

CICD_PIPELINE_TASK_RUN_ID: Final = "cicd.pipeline.task.run.id"
"""
The unique identifier of a task run within a pipeline.
"""

CICD_PIPELINE_TASK_RUN_RESULT: Final = "cicd.pipeline.task.run.result"
"""
The result of a task run.
"""

CICD_PIPELINE_TASK_RUN_URL_FULL: Final = "cicd.pipeline.task.run.url.full"
"""
The [URL](https://wikipedia.org/wiki/URL) of the pipeline task run, providing the complete address in order to locate and identify the pipeline task run.
"""

CICD_PIPELINE_TASK_TYPE: Final = "cicd.pipeline.task.type"
"""
The type of the task within a pipeline.
"""

CICD_SYSTEM_COMPONENT: Final = "cicd.system.component"
"""
The name of a component of the CICD system.
"""

CICD_WORKER_ID: Final = "cicd.worker.id"
"""
The unique identifier of a worker within a CICD system.
"""

CICD_WORKER_NAME: Final = "cicd.worker.name"
"""
The name of a worker within a CICD system.
"""

CICD_WORKER_STATE: Final = "cicd.worker.state"
"""
The state of a CICD worker / agent.
"""

CICD_WORKER_URL_FULL: Final = "cicd.worker.url.full"
"""
The [URL](https://wikipedia.org/wiki/URL) of the worker, providing the complete address in order to locate and identify the worker.
"""


class CicdPipelineActionNameValues(Enum):
    BUILD = "BUILD"
    """The pipeline run is executing a build."""
    RUN = "RUN"
    """The pipeline run is executing."""
    SYNC = "SYNC"
    """The pipeline run is executing a sync."""


class CicdPipelineResultValues(Enum):
    SUCCESS = "success"
    """The pipeline run finished successfully."""
    FAILURE = "failure"
    """The pipeline run did not finish successfully, eg. due to a compile error or a failing test. Such failures are usually detected by non-zero exit codes of the tools executed in the pipeline run."""
    ERROR = "error"
    """The pipeline run failed due to an error in the CICD system, eg. due to the worker being killed."""
    TIMEOUT = "timeout"
    """A timeout caused the pipeline run to be interrupted."""
    CANCELLATION = "cancellation"
    """The pipeline run was cancelled, eg. by a user manually cancelling the pipeline run."""
    SKIP = "skip"
    """The pipeline run was skipped, eg. due to a precondition not being met."""


class CicdPipelineRunStateValues(Enum):
    PENDING = "pending"
    """The run pending state spans from the event triggering the pipeline run until the execution of the run starts (eg. time spent in a queue, provisioning agents, creating run resources)."""
    EXECUTING = "executing"
    """The executing state spans the execution of any run tasks (eg. build, test)."""
    FINALIZING = "finalizing"
    """The finalizing state spans from when the run has finished executing (eg. cleanup of run resources)."""


class CicdPipelineTaskRunResultValues(Enum):
    SUCCESS = "success"
    """The task run finished successfully."""
    FAILURE = "failure"
    """The task run did not finish successfully, eg. due to a compile error or a failing test. Such failures are usually detected by non-zero exit codes of the tools executed in the task run."""
    ERROR = "error"
    """The task run failed due to an error in the CICD system, eg. due to the worker being killed."""
    TIMEOUT = "timeout"
    """A timeout caused the task run to be interrupted."""
    CANCELLATION = "cancellation"
    """The task run was cancelled, eg. by a user manually cancelling the task run."""
    SKIP = "skip"
    """The task run was skipped, eg. due to a precondition not being met."""


class CicdPipelineTaskTypeValues(Enum):
    BUILD = "build"
    """build."""
    TEST = "test"
    """test."""
    DEPLOY = "deploy"
    """deploy."""


class CicdWorkerStateValues(Enum):
    AVAILABLE = "available"
    """The worker is not performing work for the CICD system. It is available to the CICD system to perform work on (online / idle)."""
    BUSY = "busy"
    """The worker is performing work for the CICD system."""
    OFFLINE = "offline"
    """The worker is not available to the CICD system (disconnected / down)."""
