# Copyright 2024 The HuggingFace Team. All rights reserved.
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
"""Contains helpers to split tensors into shards."""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, TypeVar, Union

from .. import logging


TensorT = TypeVar("TensorT")
TensorSizeFn_T = Callable[[TensorT], int]
StorageIDFn_T = Callable[[TensorT], Optional[Any]]

MAX_SHARD_SIZE = "5GB"
SIZE_UNITS = {
    "TB": 10**12,
    "GB": 10**9,
    "MB": 10**6,
    "KB": 10**3,
}


logger = logging.get_logger(__file__)


@dataclass
class StateDictSplit:
    is_sharded: bool = field(init=False)
    metadata: Dict[str, Any]
    filename_to_tensors: Dict[str, List[str]]
    tensor_to_filename: Dict[str, str]

    def __post_init__(self):
        self.is_sharded = len(self.filename_to_tensors) > 1


def split_state_dict_into_shards_factory(
    state_dict: Dict[str, TensorT],
    *,
    get_storage_size: TensorSizeFn_T,
    filename_pattern: str,
    get_storage_id: StorageIDFn_T = lambda tensor: None,
    max_shard_size: Union[int, str] = MAX_SHARD_SIZE,
) -> StateDictSplit:
    """
    Split a model state dictionary in shards so that each shard is smaller than a given size.

    The shards are determined by iterating through the `state_dict` in the order of its keys. There is no optimization
    made to make each shard as close as possible to the maximum size passed. For example, if the limit is 10GB and we
    have tensors of sizes [6GB, 6GB, 2GB, 6GB, 2GB, 2GB] they will get sharded as [6GB], [6+2GB], [6+2+2GB] and not
    [6+2+2GB], [6+2GB], [6GB].

    <Tip warning={true}>

    If one of the model's tensor is bigger than `max_shard_size`, it will end up in its own shard which will have a
    size greater than `max_shard_size`.

    </Tip>

    Args:
        state_dict (`Dict[str, Tensor]`):
            The state dictionary to save.
        get_storage_size (`Callable[[Tensor], int]`):
            A function that returns the size of a tensor when saved on disk in bytes.
        get_storage_id (`Callable[[Tensor], Optional[Any]]`, *optional*):
            A function that returns a unique identifier to a tensor storage. Multiple different tensors can share the
            same underlying storage. This identifier is guaranteed to be unique and constant for this tensor's storage
            during its lifetime. Two tensor storages with non-overlapping lifetimes may have the same id.
        filename_pattern (`str`, *optional*):
            The pattern to generate the files names in which the model will be saved. Pattern must be a string that
            can be formatted with `filename_pattern.format(suffix=...)` and must contain the keyword `suffix`
        max_shard_size (`int` or `str`, *optional*):
            The maximum size of each shard, in bytes. Defaults to 5GB.

    Returns:
        [`StateDictSplit`]: A `StateDictSplit` object containing the shards and the index to retrieve them.
    """
    storage_id_to_tensors: Dict[Any, List[str]] = {}

    shard_list: List[Dict[str, TensorT]] = []
    current_shard: Dict[str, TensorT] = {}
    current_shard_size = 0
    total_size = 0

    if isinstance(max_shard_size, str):
        max_shard_size = parse_size_to_int(max_shard_size)

    for key, tensor in state_dict.items():
        # when bnb serialization is used the weights in the state dict can be strings
        # check: https://github.com/huggingface/transformers/pull/24416 for more details
        if isinstance(tensor, str):
            logger.info("Skipping tensor %s as it is a string (bnb serialization)", key)
            continue

        # If a `tensor` shares the same underlying storage as another tensor, we put `tensor` in the same `block`
        storage_id = get_storage_id(tensor)
        if storage_id is not None:
            if storage_id in storage_id_to_tensors:
                # We skip this tensor for now and will reassign to correct shard later
                storage_id_to_tensors[storage_id].append(key)
                continue
            else:
                # This is the first tensor with this storage_id, we create a new entry
                # in the storage_id_to_tensors dict => we will assign the shard id later
                storage_id_to_tensors[storage_id] = [key]

        # Compute tensor size
        tensor_size = get_storage_size(tensor)

        # If this tensor is bigger than the maximal size, we put it in its own shard
        if tensor_size > max_shard_size:
            total_size += tensor_size
            shard_list.append({key: tensor})
            continue

        # If this tensor is going to tip up over the maximal size, we split.
        # Current shard already has some tensors, we add it to the list of shards and create a new one.
        if current_shard_size + tensor_size > max_shard_size:
            shard_list.append(current_shard)
            current_shard = {}
            current_shard_size = 0

        # Add the tensor to the current shard
        current_shard[key] = tensor
        current_shard_size += tensor_size
        total_size += tensor_size

    # Add the last shard
    if len(current_shard) > 0:
        shard_list.append(current_shard)
    nb_shards = len(shard_list)

    # Loop over the tensors that share the same storage and assign them together
    for storage_id, keys in storage_id_to_tensors.items():
        # Let's try to find the shard where the first tensor of this storage is and put all tensors in the same shard
        for shard in shard_list:
            if keys[0] in shard:
                for key in keys:
                    shard[key] = state_dict[key]
                break

    # If we only have one shard, we return it => no need to build the index
    if nb_shards == 1:
        filename = filename_pattern.format(suffix="")
        return StateDictSplit(
            metadata={"total_size": total_size},
            filename_to_tensors={filename: list(state_dict.keys())},
            tensor_to_filename={key: filename for key in state_dict.keys()},
        )

    # Now that each tensor is assigned to a shard, let's assign a filename to each shard
    tensor_name_to_filename = {}
    filename_to_tensors = {}
    for idx, shard in enumerate(shard_list):
        filename = filename_pattern.format(suffix=f"-{idx + 1:05d}-of-{nb_shards:05d}")
        for key in shard:
            tensor_name_to_filename[key] = filename
        filename_to_tensors[filename] = list(shard.keys())

    # Build the index and return
    return StateDictSplit(
        metadata={"total_size": total_size},
        filename_to_tensors=filename_to_tensors,
        tensor_to_filename=tensor_name_to_filename,
    )


def parse_size_to_int(size_as_str: str) -> int:
    """
    Parse a size expressed as a string with digits and unit (like `"5MB"`) to an integer (in bytes).

    Supported units are "TB", "GB", "MB", "KB".

    Args:
        size_as_str (`str`): The size to convert. Will be directly returned if an `int`.

    Example:

    ```py
    >>> parse_size_to_int("5MB")
    5000000
    ```
    """
    size_as_str = size_as_str.strip()

    # Parse unit
    unit = size_as_str[-2:].upper()
    if unit not in SIZE_UNITS:
        raise ValueError(f"Unit '{unit}' not supported. Supported units are TB, GB, MB, KB. Got '{size_as_str}'.")
    multiplier = SIZE_UNITS[unit]

    # Parse value
    try:
        value = float(size_as_str[:-2].strip())
    except ValueError as e:
        raise ValueError(f"Could not parse the size value from '{size_as_str}': {e}") from e

    return int(value * multiplier)
