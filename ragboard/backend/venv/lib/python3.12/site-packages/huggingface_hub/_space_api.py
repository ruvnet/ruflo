# coding=utf-8
# Copyright 2019-present, the HuggingFace Inc. team.
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
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, Optional

from huggingface_hub.utils import parse_datetime


class SpaceStage(str, Enum):
    """
    Enumeration of possible stage of a Space on the Hub.

    Value can be compared to a string:
    ```py
    assert SpaceStage.BUILDING == "BUILDING"
    ```

    Taken from https://github.com/huggingface/moon-landing/blob/main/server/repo_types/SpaceInfo.ts#L61 (private url).
    """

    # Copied from moon-landing > server > repo_types > SpaceInfo.ts (private repo)
    NO_APP_FILE = "NO_APP_FILE"
    CONFIG_ERROR = "CONFIG_ERROR"
    BUILDING = "BUILDING"
    BUILD_ERROR = "BUILD_ERROR"
    RUNNING = "RUNNING"
    RUNNING_BUILDING = "RUNNING_BUILDING"
    RUNTIME_ERROR = "RUNTIME_ERROR"
    DELETING = "DELETING"
    STOPPED = "STOPPED"
    PAUSED = "PAUSED"


class SpaceHardware(str, Enum):
    """
    Enumeration of hardwares available to run your Space on the Hub.

    Value can be compared to a string:
    ```py
    assert SpaceHardware.CPU_BASIC == "cpu-basic"
    ```

    Taken from https://github.com/huggingface-internal/moon-landing/blob/main/server/repo_types/SpaceHardwareFlavor.ts (private url).
    """

    # CPU
    CPU_BASIC = "cpu-basic"
    CPU_UPGRADE = "cpu-upgrade"
    CPU_XL = "cpu-xl"

    # ZeroGPU
    ZERO_A10G = "zero-a10g"

    # GPU
    T4_SMALL = "t4-small"
    T4_MEDIUM = "t4-medium"
    L4X1 = "l4x1"
    L4X4 = "l4x4"
    L40SX1 = "l40sx1"
    L40SX4 = "l40sx4"
    L40SX8 = "l40sx8"
    A10G_SMALL = "a10g-small"
    A10G_LARGE = "a10g-large"
    A10G_LARGEX2 = "a10g-largex2"
    A10G_LARGEX4 = "a10g-largex4"
    A100_LARGE = "a100-large"
    H100 = "h100"
    H100X8 = "h100x8"


class SpaceStorage(str, Enum):
    """
    Enumeration of persistent storage available for your Space on the Hub.

    Value can be compared to a string:
    ```py
    assert SpaceStorage.SMALL == "small"
    ```

    Taken from https://github.com/huggingface/moon-landing/blob/main/server/repo_types/SpaceHardwareFlavor.ts#L24 (private url).
    """

    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"


@dataclass
class SpaceRuntime:
    """
    Contains information about the current runtime of a Space.

    Args:
        stage (`str`):
            Current stage of the space. Example: RUNNING.
        hardware (`str` or `None`):
            Current hardware of the space. Example: "cpu-basic". Can be `None` if Space
            is `BUILDING` for the first time.
        requested_hardware (`str` or `None`):
            Requested hardware. Can be different than `hardware` especially if the request
            has just been made. Example: "t4-medium". Can be `None` if no hardware has
            been requested yet.
        sleep_time (`int` or `None`):
            Number of seconds the Space will be kept alive after the last request. By default (if value is `None`), the
            Space will never go to sleep if it's running on an upgraded hardware, while it will go to sleep after 48
            hours on a free 'cpu-basic' hardware. For more details, see https://huggingface.co/docs/hub/spaces-gpus#sleep-time.
        raw (`dict`):
            Raw response from the server. Contains more information about the Space
            runtime like number of replicas, number of cpu, memory size,...
    """

    stage: SpaceStage
    hardware: Optional[SpaceHardware]
    requested_hardware: Optional[SpaceHardware]
    sleep_time: Optional[int]
    storage: Optional[SpaceStorage]
    raw: Dict

    def __init__(self, data: Dict) -> None:
        self.stage = data["stage"]
        self.hardware = data.get("hardware", {}).get("current")
        self.requested_hardware = data.get("hardware", {}).get("requested")
        self.sleep_time = data.get("gcTimeout")
        self.storage = data.get("storage")
        self.raw = data


@dataclass
class SpaceVariable:
    """
    Contains information about the current variables of a Space.

    Args:
        key (`str`):
            Variable key. Example: `"MODEL_REPO_ID"`
        value (`str`):
            Variable value. Example: `"the_model_repo_id"`.
        description (`str` or None):
            Description of the variable. Example: `"Model Repo ID of the implemented model"`.
        updatedAt (`datetime` or None):
            datetime of the last update of the variable (if the variable has been updated at least once).
    """

    key: str
    value: str
    description: Optional[str]
    updated_at: Optional[datetime]

    def __init__(self, key: str, values: Dict) -> None:
        self.key = key
        self.value = values["value"]
        self.description = values.get("description")
        updated_at = values.get("updatedAt")
        self.updated_at = parse_datetime(updated_at) if updated_at is not None else None
