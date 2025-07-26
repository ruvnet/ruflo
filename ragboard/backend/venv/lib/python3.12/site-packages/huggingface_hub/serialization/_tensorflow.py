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
"""Contains tensorflow-specific helpers."""

import math
import re
from typing import TYPE_CHECKING, Dict, Union

from .. import constants
from ._base import MAX_SHARD_SIZE, StateDictSplit, split_state_dict_into_shards_factory


if TYPE_CHECKING:
    import tensorflow as tf


def split_tf_state_dict_into_shards(
    state_dict: Dict[str, "tf.Tensor"],
    *,
    filename_pattern: str = constants.TF2_WEIGHTS_FILE_PATTERN,
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
        filename_pattern (`str`, *optional*):
            The pattern to generate the files names in which the model will be saved. Pattern must be a string that
            can be formatted with `filename_pattern.format(suffix=...)` and must contain the keyword `suffix`
            Defaults to `"tf_model{suffix}.h5"`.
        max_shard_size (`int` or `str`, *optional*):
            The maximum size of each shard, in bytes. Defaults to 5GB.

    Returns:
        [`StateDictSplit`]: A `StateDictSplit` object containing the shards and the index to retrieve them.
    """
    return split_state_dict_into_shards_factory(
        state_dict,
        max_shard_size=max_shard_size,
        filename_pattern=filename_pattern,
        get_storage_size=get_tf_storage_size,
    )


def get_tf_storage_size(tensor: "tf.Tensor") -> int:
    # Return `math.ceil` since dtype byte size can be a float (e.g., 0.125 for tf.bool).
    # Better to overestimate than underestimate.
    return math.ceil(tensor.numpy().size * _dtype_byte_size_tf(tensor.dtype))


def _dtype_byte_size_tf(dtype) -> float:
    """
    Returns the size (in bytes) occupied by one parameter of type `dtype`.
    Taken from https://github.com/huggingface/transformers/blob/74d9d0cebb0263a3f8ab9c280569170cc74651d0/src/transformers/modeling_tf_utils.py#L608.
    NOTE: why not `tensor.numpy().nbytes`?
    Example:
    ```py
    >>> _dtype_byte_size(tf.float32)
    4
    ```
    """
    import tensorflow as tf

    if dtype == tf.bool:
        return 1 / 8
    bit_search = re.search(r"[^\d](\d+)$", dtype.name)
    if bit_search is None:
        raise ValueError(f"`dtype` is not a valid dtype: {dtype}.")
    bit_size = int(bit_search.groups()[0])
    return bit_size // 8
