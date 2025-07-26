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
"""Contains pytorch-specific helpers."""

import importlib
import json
import os
import re
from collections import defaultdict, namedtuple
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, NamedTuple, Optional, Set, Tuple, Union

from packaging import version

from .. import constants, logging
from ._base import MAX_SHARD_SIZE, StateDictSplit, split_state_dict_into_shards_factory


logger = logging.get_logger(__file__)

if TYPE_CHECKING:
    import torch

# SAVING


def save_torch_model(
    model: "torch.nn.Module",
    save_directory: Union[str, Path],
    *,
    filename_pattern: Optional[str] = None,
    force_contiguous: bool = True,
    max_shard_size: Union[int, str] = MAX_SHARD_SIZE,
    metadata: Optional[Dict[str, str]] = None,
    safe_serialization: bool = True,
    is_main_process: bool = True,
    shared_tensors_to_discard: Optional[List[str]] = None,
):
    """
    Saves a given torch model to disk, handling sharding and shared tensors issues.

    See also [`save_torch_state_dict`] to save a state dict with more flexibility.

    For more information about tensor sharing, check out [this guide](https://huggingface.co/docs/safetensors/torch_shared_tensors).

    The model state dictionary is split into shards so that each shard is smaller than a given size. The shards are
    saved in the `save_directory` with the given `filename_pattern`. If the model is too big to fit in a single shard,
    an index file is saved in the `save_directory` to indicate where each tensor is saved. This helper uses
    [`split_torch_state_dict_into_shards`] under the hood. If `safe_serialization` is `True`, the shards are saved as
    safetensors (the default). Otherwise, the shards are saved as pickle.

    Before saving the model, the `save_directory` is cleaned from any previous shard files.

    <Tip warning={true}>

    If one of the model's tensor is bigger than `max_shard_size`, it will end up in its own shard which will have a
    size greater than `max_shard_size`.

    </Tip>

    <Tip warning={true}>

    If your model is a `transformers.PreTrainedModel`, you should pass `model._tied_weights_keys` as `shared_tensors_to_discard` to properly handle shared tensors saving. This ensures the correct duplicate tensors are discarded during saving.

    </Tip>

    Args:
        model (`torch.nn.Module`):
            The model to save on disk.
        save_directory (`str` or `Path`):
            The directory in which the model will be saved.
        filename_pattern (`str`, *optional*):
            The pattern to generate the files names in which the model will be saved. Pattern must be a string that
            can be formatted with `filename_pattern.format(suffix=...)` and must contain the keyword `suffix`
            Defaults to `"model{suffix}.safetensors"` or `pytorch_model{suffix}.bin` depending on `safe_serialization`
            parameter.
        force_contiguous (`boolean`, *optional*):
            Forcing the state_dict to be saved as contiguous tensors. This has no effect on the correctness of the
            model, but it could potentially change performance if the layout of the tensor was chosen specifically for
            that reason. Defaults to `True`.
        max_shard_size (`int` or `str`, *optional*):
            The maximum size of each shard, in bytes. Defaults to 5GB.
        metadata (`Dict[str, str]`, *optional*):
            Extra information to save along with the model. Some metadata will be added for each dropped tensors.
            This information will not be enough to recover the entire shared structure but might help understanding
            things.
        safe_serialization (`bool`, *optional*):
            Whether to save as safetensors, which is the default behavior. If `False`, the shards are saved as pickle.
            Safe serialization is recommended for security reasons. Saving as pickle is deprecated and will be removed
            in a future version.
        is_main_process (`bool`, *optional*):
            Whether the process calling this is the main process or not. Useful when in distributed training like
            TPUs and need to call this function from all processes. In this case, set `is_main_process=True` only on
            the main process to avoid race conditions. Defaults to True.
        shared_tensors_to_discard (`List[str]`, *optional*):
            List of tensor names to drop when saving shared tensors. If not provided and shared tensors are
            detected, it will drop the first name alphabetically.

    Example:

    ```py
    >>> from huggingface_hub import save_torch_model
    >>> model = ... # A PyTorch model

    # Save state dict to "path/to/folder". The model will be split into shards of 5GB each and saved as safetensors.
    >>> save_torch_model(model, "path/to/folder")

    # Load model back
    >>> from huggingface_hub import load_torch_model  # TODO
    >>> load_torch_model(model, "path/to/folder")
    >>>
    ```
    """
    save_torch_state_dict(
        state_dict=model.state_dict(),
        filename_pattern=filename_pattern,
        force_contiguous=force_contiguous,
        max_shard_size=max_shard_size,
        metadata=metadata,
        safe_serialization=safe_serialization,
        save_directory=save_directory,
        is_main_process=is_main_process,
        shared_tensors_to_discard=shared_tensors_to_discard,
    )


def save_torch_state_dict(
    state_dict: Dict[str, "torch.Tensor"],
    save_directory: Union[str, Path],
    *,
    filename_pattern: Optional[str] = None,
    force_contiguous: bool = True,
    max_shard_size: Union[int, str] = MAX_SHARD_SIZE,
    metadata: Optional[Dict[str, str]] = None,
    safe_serialization: bool = True,
    is_main_process: bool = True,
    shared_tensors_to_discard: Optional[List[str]] = None,
) -> None:
    """
    Save a model state dictionary to the disk, handling sharding and shared tensors issues.

    See also [`save_torch_model`] to directly save a PyTorch model.

    For more information about tensor sharing, check out [this guide](https://huggingface.co/docs/safetensors/torch_shared_tensors).

    The model state dictionary is split into shards so that each shard is smaller than a given size. The shards are
    saved in the `save_directory` with the given `filename_pattern`. If the model is too big to fit in a single shard,
    an index file is saved in the `save_directory` to indicate where each tensor is saved. This helper uses
    [`split_torch_state_dict_into_shards`] under the hood. If `safe_serialization` is `True`, the shards are saved as
    safetensors (the default). Otherwise, the shards are saved as pickle.

    Before saving the model, the `save_directory` is cleaned from any previous shard files.

    <Tip warning={true}>

    If one of the model's tensor is bigger than `max_shard_size`, it will end up in its own shard which will have a
    size greater than `max_shard_size`.

    </Tip>

    <Tip warning={true}>

    If your model is a `transformers.PreTrainedModel`, you should pass `model._tied_weights_keys` as `shared_tensors_to_discard` to properly handle shared tensors saving. This ensures the correct duplicate tensors are discarded during saving.

    </Tip>

    Args:
        state_dict (`Dict[str, torch.Tensor]`):
            The state dictionary to save.
        save_directory (`str` or `Path`):
            The directory in which the model will be saved.
        filename_pattern (`str`, *optional*):
            The pattern to generate the files names in which the model will be saved. Pattern must be a string that
            can be formatted with `filename_pattern.format(suffix=...)` and must contain the keyword `suffix`
            Defaults to `"model{suffix}.safetensors"` or `pytorch_model{suffix}.bin` depending on `safe_serialization`
            parameter.
        force_contiguous (`boolean`, *optional*):
            Forcing the state_dict to be saved as contiguous tensors. This has no effect on the correctness of the
            model, but it could potentially change performance if the layout of the tensor was chosen specifically for
            that reason. Defaults to `True`.
        max_shard_size (`int` or `str`, *optional*):
            The maximum size of each shard, in bytes. Defaults to 5GB.
        metadata (`Dict[str, str]`, *optional*):
            Extra information to save along with the model. Some metadata will be added for each dropped tensors.
            This information will not be enough to recover the entire shared structure but might help understanding
            things.
        safe_serialization (`bool`, *optional*):
            Whether to save as safetensors, which is the default behavior. If `False`, the shards are saved as pickle.
            Safe serialization is recommended for security reasons. Saving as pickle is deprecated and will be removed
            in a future version.
        is_main_process (`bool`, *optional*):
            Whether the process calling this is the main process or not. Useful when in distributed training like
            TPUs and need to call this function from all processes. In this case, set `is_main_process=True` only on
            the main process to avoid race conditions. Defaults to True.
        shared_tensors_to_discard (`List[str]`, *optional*):
            List of tensor names to drop when saving shared tensors. If not provided and shared tensors are
            detected, it will drop the first name alphabetically.

    Example:

    ```py
    >>> from huggingface_hub import save_torch_state_dict
    >>> model = ... # A PyTorch model

    # Save state dict to "path/to/folder". The model will be split into shards of 5GB each and saved as safetensors.
    >>> state_dict = model_to_save.state_dict()
    >>> save_torch_state_dict(state_dict, "path/to/folder")
    ```
    """
    save_directory = str(save_directory)

    if filename_pattern is None:
        filename_pattern = (
            constants.SAFETENSORS_WEIGHTS_FILE_PATTERN
            if safe_serialization
            else constants.PYTORCH_WEIGHTS_FILE_PATTERN
        )

    if metadata is None:
        metadata = {}
    if safe_serialization:
        try:
            from safetensors.torch import save_file as save_file_fn
        except ImportError as e:
            raise ImportError(
                "Please install `safetensors` to use safe serialization. "
                "You can install it with `pip install safetensors`."
            ) from e
        # Clean state dict for safetensors
        state_dict = _clean_state_dict_for_safetensors(
            state_dict,
            metadata,
            force_contiguous=force_contiguous,
            shared_tensors_to_discard=shared_tensors_to_discard,
        )
    else:
        from torch import save as save_file_fn  # type: ignore[assignment, no-redef]

        logger.warning(
            "You are using unsafe serialization. Due to security reasons, it is recommended not to load "
            "pickled models from untrusted sources. If you intend to share your model, we strongly recommend "
            "using safe serialization by installing `safetensors` with `pip install safetensors`."
        )
    # Split dict
    state_dict_split = split_torch_state_dict_into_shards(
        state_dict, filename_pattern=filename_pattern, max_shard_size=max_shard_size
    )

    # Only main process should clean up existing files to avoid race conditions in distributed environment
    if is_main_process:
        existing_files_regex = re.compile(filename_pattern.format(suffix=r"(-\d{5}-of-\d{5})?") + r"(\.index\.json)?")
        for filename in os.listdir(save_directory):
            if existing_files_regex.match(filename):
                try:
                    logger.debug(f"Removing existing file '{filename}' from folder.")
                    os.remove(os.path.join(save_directory, filename))
                except Exception as e:
                    logger.warning(
                        f"Error when trying to remove existing '{filename}' from folder: {e}. Continuing..."
                    )

    # Save each shard
    per_file_metadata = {"format": "pt"}
    if not state_dict_split.is_sharded:
        per_file_metadata.update(metadata)
    safe_file_kwargs = {"metadata": per_file_metadata} if safe_serialization else {}
    for filename, tensors in state_dict_split.filename_to_tensors.items():
        shard = {tensor: state_dict[tensor] for tensor in tensors}
        save_file_fn(shard, os.path.join(save_directory, filename), **safe_file_kwargs)
        logger.debug(f"Shard saved to {filename}")

    # Save the index (if any)
    if state_dict_split.is_sharded:
        index_path = filename_pattern.format(suffix="") + ".index.json"
        index = {
            "metadata": {**state_dict_split.metadata, **metadata},
            "weight_map": state_dict_split.tensor_to_filename,
        }
        with open(os.path.join(save_directory, index_path), "w") as f:
            json.dump(index, f, indent=2)
        logger.info(
            f"The model is bigger than the maximum size per checkpoint ({max_shard_size}). "
            f"Model weighs have been saved in {len(state_dict_split.filename_to_tensors)} checkpoint shards. "
            f"You can find where each parameters has been saved in the index located at {index_path}."
        )

    logger.info(f"Model weights successfully saved to {save_directory}!")


def split_torch_state_dict_into_shards(
    state_dict: Dict[str, "torch.Tensor"],
    *,
    filename_pattern: str = constants.SAFETENSORS_WEIGHTS_FILE_PATTERN,
    max_shard_size: Union[int, str] = MAX_SHARD_SIZE,
) -> StateDictSplit:
    """
    Split a model state dictionary in shards so that each shard is smaller than a given size.

    The shards are determined by iterating through the `state_dict` in the order of its keys. There is no optimization
    made to make each shard as close as possible to the maximum size passed. For example, if the limit is 10GB and we
    have tensors of sizes [6GB, 6GB, 2GB, 6GB, 2GB, 2GB] they will get sharded as [6GB], [6+2GB], [6+2+2GB] and not
    [6+2+2GB], [6+2GB], [6GB].


    <Tip>

    To save a model state dictionary to the disk, see [`save_torch_state_dict`]. This helper uses
    `split_torch_state_dict_into_shards` under the hood.

    </Tip>

    <Tip warning={true}>

    If one of the model's tensor is bigger than `max_shard_size`, it will end up in its own shard which will have a
    size greater than `max_shard_size`.

    </Tip>

    Args:
        state_dict (`Dict[str, torch.Tensor]`):
            The state dictionary to save.
        filename_pattern (`str`, *optional*):
            The pattern to generate the files names in which the model will be saved. Pattern must be a string that
            can be formatted with `filename_pattern.format(suffix=...)` and must contain the keyword `suffix`
            Defaults to `"model{suffix}.safetensors"`.
        max_shard_size (`int` or `str`, *optional*):
            The maximum size of each shard, in bytes. Defaults to 5GB.

    Returns:
        [`StateDictSplit`]: A `StateDictSplit` object containing the shards and the index to retrieve them.

    Example:
    ```py
    >>> import json
    >>> import os
    >>> from safetensors.torch import save_file as safe_save_file
    >>> from huggingface_hub import split_torch_state_dict_into_shards

    >>> def save_state_dict(state_dict: Dict[str, torch.Tensor], save_directory: str):
    ...     state_dict_split = split_torch_state_dict_into_shards(state_dict)
    ...     for filename, tensors in state_dict_split.filename_to_tensors.items():
    ...         shard = {tensor: state_dict[tensor] for tensor in tensors}
    ...         safe_save_file(
    ...             shard,
    ...             os.path.join(save_directory, filename),
    ...             metadata={"format": "pt"},
    ...         )
    ...     if state_dict_split.is_sharded:
    ...         index = {
    ...             "metadata": state_dict_split.metadata,
    ...             "weight_map": state_dict_split.tensor_to_filename,
    ...         }
    ...         with open(os.path.join(save_directory, "model.safetensors.index.json"), "w") as f:
    ...             f.write(json.dumps(index, indent=2))
    ```
    """
    return split_state_dict_into_shards_factory(
        state_dict,
        max_shard_size=max_shard_size,
        filename_pattern=filename_pattern,
        get_storage_size=get_torch_storage_size,
        get_storage_id=get_torch_storage_id,
    )


# LOADING


def load_torch_model(
    model: "torch.nn.Module",
    checkpoint_path: Union[str, os.PathLike],
    *,
    strict: bool = False,
    safe: bool = True,
    weights_only: bool = False,
    map_location: Optional[Union[str, "torch.device"]] = None,
    mmap: bool = False,
    filename_pattern: Optional[str] = None,
) -> NamedTuple:
    """
    Load a checkpoint into a model, handling both sharded and non-sharded checkpoints.

    Args:
        model (`torch.nn.Module`):
            The model in which to load the checkpoint.
        checkpoint_path (`str` or `os.PathLike`):
            Path to either the checkpoint file or directory containing the checkpoint(s).
        strict (`bool`, *optional*, defaults to `False`):
            Whether to strictly enforce that the keys in the model state dict match the keys in the checkpoint.
        safe (`bool`, *optional*, defaults to `True`):
            If `safe` is True, the safetensors files will be loaded. If `safe` is False, the function
            will first attempt to load safetensors files if they are available, otherwise it will fall back to loading
            pickle files. `filename_pattern` parameter takes precedence over `safe` parameter.
        weights_only (`bool`, *optional*, defaults to `False`):
            If True, only loads the model weights without optimizer states and other metadata.
            Only supported in PyTorch >= 1.13.
        map_location (`str` or `torch.device`, *optional*):
            A `torch.device` object, string or a dict specifying how to remap storage locations. It
            indicates the location where all tensors should be loaded.
        mmap (`bool`, *optional*, defaults to `False`):
            Whether to use memory-mapped file loading. Memory mapping can improve loading performance
            for large models in PyTorch >= 2.1.0 with zipfile-based checkpoints.
        filename_pattern (`str`, *optional*):
            The pattern to look for the index file. Pattern must be a string that
            can be formatted with `filename_pattern.format(suffix=...)` and must contain the keyword `suffix`
            Defaults to `"model{suffix}.safetensors"`.
    Returns:
        `NamedTuple`: A named tuple with `missing_keys` and `unexpected_keys` fields.
            - `missing_keys` is a list of str containing the missing keys, i.e. keys that are in the model but not in the checkpoint.
            - `unexpected_keys` is a list of str containing the unexpected keys, i.e. keys that are in the checkpoint but not in the model.

    Raises:
        [`FileNotFoundError`](https://docs.python.org/3/library/exceptions.html#FileNotFoundError)
            If the checkpoint file or directory does not exist.
        [`ImportError`](https://docs.python.org/3/library/exceptions.html#ImportError)
            If safetensors or torch is not installed when trying to load a .safetensors file or a PyTorch checkpoint respectively.
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
           If the checkpoint path is invalid or if the checkpoint format cannot be determined.

    Example:
    ```python
    >>> from huggingface_hub import load_torch_model
    >>> model = ... # A PyTorch model
    >>> load_torch_model(model, "path/to/checkpoint")
    ```
    """
    checkpoint_path = Path(checkpoint_path)

    if not checkpoint_path.exists():
        raise ValueError(f"Checkpoint path {checkpoint_path} does not exist")
    # 1. Check if checkpoint is a single file
    if checkpoint_path.is_file():
        state_dict = load_state_dict_from_file(
            checkpoint_file=checkpoint_path,
            map_location=map_location,
            weights_only=weights_only,
        )
        return model.load_state_dict(state_dict, strict=strict)

    # 2. If not, checkpoint_path is a directory
    if filename_pattern is None:
        filename_pattern = constants.SAFETENSORS_WEIGHTS_FILE_PATTERN
        index_path = checkpoint_path / (filename_pattern.format(suffix="") + ".index.json")
        # Only fallback to pickle format if safetensors index is not found and safe is False.
        if not index_path.is_file() and not safe:
            filename_pattern = constants.PYTORCH_WEIGHTS_FILE_PATTERN

    index_path = checkpoint_path / (filename_pattern.format(suffix="") + ".index.json")

    if index_path.is_file():
        return _load_sharded_checkpoint(
            model=model,
            save_directory=checkpoint_path,
            strict=strict,
            weights_only=weights_only,
            filename_pattern=filename_pattern,
        )

    # Look for single model file
    model_files = list(checkpoint_path.glob("*.safetensors" if safe else "*.bin"))
    if len(model_files) == 1:
        state_dict = load_state_dict_from_file(
            checkpoint_file=model_files[0],
            map_location=map_location,
            weights_only=weights_only,
            mmap=mmap,
        )
        return model.load_state_dict(state_dict, strict=strict)

    raise ValueError(
        f"Directory '{checkpoint_path}' does not contain a valid checkpoint. "
        "Expected either a sharded checkpoint with an index file, or a single model file."
    )


def _load_sharded_checkpoint(
    model: "torch.nn.Module",
    save_directory: os.PathLike,
    *,
    strict: bool = False,
    weights_only: bool = False,
    filename_pattern: str = constants.SAFETENSORS_WEIGHTS_FILE_PATTERN,
) -> NamedTuple:
    """
    Loads a sharded checkpoint into a model. This is the same as
    [`torch.nn.Module.load_state_dict`](https://pytorch.org/docs/stable/generated/torch.nn.Module.html?highlight=load_state_dict#torch.nn.Module.load_state_dict)
    but for a sharded checkpoint. Each shard is loaded one by one and removed from memory after being loaded into the model.

    Args:
        model (`torch.nn.Module`):
            The model in which to load the checkpoint.
        save_directory (`str` or `os.PathLike`):
            A path to a folder containing the sharded checkpoint.
        strict (`bool`, *optional*, defaults to `False`):
            Whether to strictly enforce that the keys in the model state dict match the keys in the sharded checkpoint.
        weights_only (`bool`, *optional*, defaults to `False`):
            If True, only loads the model weights without optimizer states and other metadata.
            Only supported in PyTorch >= 1.13.
        filename_pattern (`str`, *optional*, defaults to `"model{suffix}.safetensors"`):
            The pattern to look for the index file. Pattern must be a string that
            can be formatted with `filename_pattern.format(suffix=...)` and must contain the keyword `suffix`
            Defaults to `"model{suffix}.safetensors"`.

    Returns:
        `NamedTuple`: A named tuple with `missing_keys` and `unexpected_keys` fields,
            - `missing_keys` is a list of str containing the missing keys
            - `unexpected_keys` is a list of str containing the unexpected keys
    """

    # 1. Load and validate index file
    # The index file contains mapping of parameter names to shard files
    index_path = filename_pattern.format(suffix="") + ".index.json"
    index_file = os.path.join(save_directory, index_path)
    with open(index_file, "r", encoding="utf-8") as f:
        index = json.load(f)

    # 2. Validate keys if in strict mode
    # This is done before loading any shards to fail fast
    if strict:
        _validate_keys_for_strict_loading(model, index["weight_map"].keys())

    # 3. Load each shard using `load_state_dict`
    # Get unique shard files (multiple parameters can be in same shard)
    shard_files = list(set(index["weight_map"].values()))
    for shard_file in shard_files:
        # Load shard into memory
        shard_path = os.path.join(save_directory, shard_file)
        state_dict = load_state_dict_from_file(
            shard_path,
            map_location="cpu",
            weights_only=weights_only,
        )
        # Update model with parameters from this shard
        model.load_state_dict(state_dict, strict=strict)
        # Explicitly remove the state dict from memory
        del state_dict

    # 4. Return compatibility info
    loaded_keys = set(index["weight_map"].keys())
    model_keys = set(model.state_dict().keys())
    return _IncompatibleKeys(
        missing_keys=list(model_keys - loaded_keys), unexpected_keys=list(loaded_keys - model_keys)
    )


def load_state_dict_from_file(
    checkpoint_file: Union[str, os.PathLike],
    map_location: Optional[Union[str, "torch.device"]] = None,
    weights_only: bool = False,
    mmap: bool = False,
) -> Union[Dict[str, "torch.Tensor"], Any]:
    """
    Loads a checkpoint file, handling both safetensors and pickle checkpoint formats.

    Args:
        checkpoint_file (`str` or `os.PathLike`):
            Path to the checkpoint file to load. Can be either a safetensors or pickle (`.bin`) checkpoint.
        map_location (`str` or `torch.device`, *optional*):
            A `torch.device` object, string or a dict specifying how to remap storage locations. It
            indicates the location where all tensors should be loaded.
        weights_only (`bool`, *optional*, defaults to `False`):
            If True, only loads the model weights without optimizer states and other metadata.
            Only supported for pickle (`.bin`) checkpoints with PyTorch >= 1.13. Has no effect when
            loading safetensors files.
        mmap (`bool`, *optional*, defaults to `False`):
            Whether to use memory-mapped file loading. Memory mapping can improve loading performance
            for large models in PyTorch >= 2.1.0 with zipfile-based checkpoints. Has no effect when
            loading safetensors files, as the `safetensors` library uses memory mapping by default.

    Returns:
        `Union[Dict[str, "torch.Tensor"], Any]`: The loaded checkpoint.
            - For safetensors files: always returns a dictionary mapping parameter names to tensors.
            - For pickle files: returns any Python object that was pickled (commonly a state dict, but could be
              an entire model, optimizer state, or any other Python object).

    Raises:
        [`FileNotFoundError`](https://docs.python.org/3/library/exceptions.html#FileNotFoundError)
            If the checkpoint file does not exist.
        [`ImportError`](https://docs.python.org/3/library/exceptions.html#ImportError)
            If safetensors or torch is not installed when trying to load a .safetensors file or a PyTorch checkpoint respectively.
        [`OSError`](https://docs.python.org/3/library/exceptions.html#OSError)
            If the checkpoint file format is invalid or if git-lfs files are not properly downloaded.
        [`ValueError`](https://docs.python.org/3/library/exceptions.html#ValueError)
            If the checkpoint file path is empty or invalid.

    Example:
    ```python
    >>> from huggingface_hub import load_state_dict_from_file

    # Load a PyTorch checkpoint
    >>> state_dict = load_state_dict_from_file("path/to/model.bin", map_location="cpu")
    >>> model.load_state_dict(state_dict)

    # Load a safetensors checkpoint
    >>> state_dict = load_state_dict_from_file("path/to/model.safetensors")
    >>> model.load_state_dict(state_dict)
    ```
    """
    checkpoint_path = Path(checkpoint_file)

    # Check if file exists and is a regular file (not a directory)
    if not checkpoint_path.is_file():
        raise FileNotFoundError(
            f"No checkpoint file found at '{checkpoint_path}'. Please verify the path is correct and "
            "the file has been properly downloaded."
        )

    # Load safetensors checkpoint
    if checkpoint_path.suffix == ".safetensors":
        try:
            from safetensors import safe_open
            from safetensors.torch import load_file
        except ImportError as e:
            raise ImportError(
                "Please install `safetensors` to load safetensors checkpoint. "
                "You can install it with `pip install safetensors`."
            ) from e

        # Check format of the archive
        with safe_open(checkpoint_file, framework="pt") as f:  # type: ignore[attr-defined]
            metadata = f.metadata()
        # see comment: https://github.com/huggingface/transformers/blob/3d213b57fe74302e5902d68ed9478c3ad1aaa713/src/transformers/modeling_utils.py#L3966
        if metadata is not None and metadata.get("format") not in ["pt", "mlx"]:
            raise OSError(
                f"The safetensors archive passed at {checkpoint_file} does not contain the valid metadata. Make sure "
                "you save your model with the `save_torch_model` method."
            )
        device = str(map_location.type) if map_location is not None and hasattr(map_location, "type") else map_location
        # meta device is not supported with safetensors, falling back to CPU
        if device == "meta":
            logger.warning("Meta device is not supported with safetensors. Falling back to CPU device.")
            device = "cpu"
        return load_file(checkpoint_file, device=device)  # type: ignore[arg-type]
    # Otherwise, load from pickle
    try:
        import torch
        from torch import load
    except ImportError as e:
        raise ImportError(
            "Please install `torch` to load torch tensors. You can install it with `pip install torch`."
        ) from e
    # Add additional kwargs, mmap is only supported in torch >= 2.1.0
    additional_kwargs = {}
    if version.parse(torch.__version__) >= version.parse("2.1.0"):
        additional_kwargs["mmap"] = mmap

    # weights_only is only supported in torch >= 1.13.0
    if version.parse(torch.__version__) >= version.parse("1.13.0"):
        additional_kwargs["weights_only"] = weights_only

    return load(
        checkpoint_file,
        map_location=map_location,
        **additional_kwargs,
    )


# HELPERS


def _validate_keys_for_strict_loading(
    model: "torch.nn.Module",
    loaded_keys: Iterable[str],
) -> None:
    """
    Validate that model keys match loaded keys when strict loading is enabled.

    Args:
        model: The PyTorch model being loaded
        loaded_keys: The keys present in the checkpoint

    Raises:
        RuntimeError: If there are missing or unexpected keys in strict mode
    """
    loaded_keys_set = set(loaded_keys)
    model_keys = set(model.state_dict().keys())
    missing_keys = model_keys - loaded_keys_set  # Keys in model but not in checkpoint
    unexpected_keys = loaded_keys_set - model_keys  # Keys in checkpoint but not in model

    if missing_keys or unexpected_keys:
        error_message = f"Error(s) in loading state_dict for {model.__class__.__name__}"
        if missing_keys:
            str_missing_keys = ",".join([f'"{k}"' for k in sorted(missing_keys)])
            error_message += f"\nMissing key(s): {str_missing_keys}."
        if unexpected_keys:
            str_unexpected_keys = ",".join([f'"{k}"' for k in sorted(unexpected_keys)])
            error_message += f"\nUnexpected key(s): {str_unexpected_keys}."
        raise RuntimeError(error_message)


def _get_unique_id(tensor: "torch.Tensor") -> Union[int, Tuple[Any, ...]]:
    """Returns a unique id for plain tensor
    or a (potentially nested) Tuple of unique id for the flattened Tensor
    if the input is a wrapper tensor subclass Tensor
    """

    try:
        from torch.distributed.tensor import DTensor

        if isinstance(tensor, DTensor):
            local_tensor = tensor.to_local()
            return local_tensor.storage().data_ptr()
    except ImportError:
        pass

    try:
        # for torch 2.1 and above we can also handle tensor subclasses
        from torch.utils._python_dispatch import is_traceable_wrapper_subclass

        if is_traceable_wrapper_subclass(tensor):
            attrs, _ = tensor.__tensor_flatten__()  # type: ignore[attr-defined]
            return tuple(_get_unique_id(getattr(tensor, attr)) for attr in attrs)

    except ImportError:
        # for torch version less than 2.1, we can fallback to original implementation
        pass

    if tensor.device.type == "xla" and is_torch_tpu_available():
        # NOTE: xla tensors dont have storage
        # use some other unique id to distinguish.
        # this is a XLA tensor, it must be created using torch_xla's
        # device. So the following import is safe:
        import torch_xla  # type: ignore[import]

        unique_id = torch_xla._XLAC._xla_get_tensor_id(tensor)
    else:
        unique_id = storage_ptr(tensor)

    return unique_id


def get_torch_storage_id(tensor: "torch.Tensor") -> Optional[Tuple["torch.device", Union[int, Tuple[Any, ...]], int]]:
    """
    Return unique identifier to a tensor storage.

    Multiple different tensors can share the same underlying storage. This identifier is
    guaranteed to be unique and constant for this tensor's storage during its lifetime. Two tensor storages with
    non-overlapping lifetimes may have the same id.
    In the case of meta tensors, we return None since we can't tell if they share the same storage.

    Taken from https://github.com/huggingface/transformers/blob/1ecf5f7c982d761b4daaa96719d162c324187c64/src/transformers/pytorch_utils.py#L278.
    """
    if tensor.device.type == "meta":
        return None
    else:
        return tensor.device, _get_unique_id(tensor), get_torch_storage_size(tensor)


def get_torch_storage_size(tensor: "torch.Tensor") -> int:
    """
    Taken from https://github.com/huggingface/safetensors/blob/08db34094e9e59e2f9218f2df133b7b4aaff5a99/bindings/python/py_src/safetensors/torch.py#L31C1-L41C59
    """
    try:
        from torch.distributed.tensor import DTensor

        if isinstance(tensor, DTensor):
            # this returns the size of the FULL tensor in bytes
            return tensor.nbytes
    except ImportError:
        pass

    try:
        # for torch 2.1 and above we can also handle tensor subclasses
        from torch.utils._python_dispatch import is_traceable_wrapper_subclass

        if is_traceable_wrapper_subclass(tensor):
            attrs, _ = tensor.__tensor_flatten__()  # type: ignore[attr-defined]
            return sum(get_torch_storage_size(getattr(tensor, attr)) for attr in attrs)
    except ImportError:
        # for torch version less than 2.1, we can fallback to original implementation
        pass

    try:
        return tensor.untyped_storage().nbytes()
    except AttributeError:
        # Fallback for torch==1.10
        try:
            return tensor.storage().size() * _get_dtype_size(tensor.dtype)
        except NotImplementedError:
            # Fallback for meta storage
            # On torch >=2.0 this is the tensor size
            return tensor.nelement() * _get_dtype_size(tensor.dtype)


@lru_cache()
def is_torch_tpu_available(check_device=True):
    """
    Checks if `torch_xla` is installed and potentially if a TPU is in the environment

    Taken from https://github.com/huggingface/transformers/blob/1ecf5f7c982d761b4daaa96719d162c324187c64/src/transformers/utils/import_utils.py#L463.
    """
    if importlib.util.find_spec("torch_xla") is not None:
        if check_device:
            # We need to check if `xla_device` can be found, will raise a RuntimeError if not
            try:
                import torch_xla.core.xla_model as xm  # type: ignore[import]

                _ = xm.xla_device()
                return True
            except RuntimeError:
                return False
        return True
    return False


def storage_ptr(tensor: "torch.Tensor") -> Union[int, Tuple[Any, ...]]:
    """
    Taken from https://github.com/huggingface/safetensors/blob/079781fd0dc455ba0fe851e2b4507c33d0c0d407/bindings/python/py_src/safetensors/torch.py#L11.
    """
    try:
        # for torch 2.1 and above we can also handle tensor subclasses
        from torch.utils._python_dispatch import is_traceable_wrapper_subclass

        if is_traceable_wrapper_subclass(tensor):
            return _get_unique_id(tensor)  # type: ignore
    except ImportError:
        # for torch version less than 2.1, we can fallback to original implementation
        pass

    try:
        return tensor.untyped_storage().data_ptr()
    except Exception:
        # Fallback for torch==1.10
        try:
            return tensor.storage().data_ptr()
        except NotImplementedError:
            # Fallback for meta storage
            return 0


def _clean_state_dict_for_safetensors(
    state_dict: Dict[str, "torch.Tensor"],
    metadata: Dict[str, str],
    force_contiguous: bool = True,
    shared_tensors_to_discard: Optional[List[str]] = None,
):
    """Remove shared tensors from state_dict and update metadata accordingly (for reloading).

    Warning: `state_dict` and `metadata` are mutated in-place!

    Taken from https://github.com/huggingface/safetensors/blob/079781fd0dc455ba0fe851e2b4507c33d0c0d407/bindings/python/py_src/safetensors/torch.py#L155.
    """
    to_removes = _remove_duplicate_names(state_dict, discard_names=shared_tensors_to_discard)
    for kept_name, to_remove_group in to_removes.items():
        for to_remove in to_remove_group:
            if metadata is None:
                metadata = {}

            if to_remove not in metadata:
                # Do not override user data
                metadata[to_remove] = kept_name
            del state_dict[to_remove]
    if force_contiguous:
        state_dict = {k: v.contiguous() for k, v in state_dict.items()}
    return state_dict


def _end_ptr(tensor: "torch.Tensor") -> int:
    """
    Taken from https://github.com/huggingface/safetensors/blob/079781fd0dc455ba0fe851e2b4507c33d0c0d407/bindings/python/py_src/safetensors/torch.py#L23.
    """
    if tensor.nelement():
        stop = tensor.view(-1)[-1].data_ptr() + _get_dtype_size(tensor.dtype)
    else:
        stop = tensor.data_ptr()
    return stop


def _filter_shared_not_shared(tensors: List[Set[str]], state_dict: Dict[str, "torch.Tensor"]) -> List[Set[str]]:
    """
    Taken from https://github.com/huggingface/safetensors/blob/079781fd0dc455ba0fe851e2b4507c33d0c0d407/bindings/python/py_src/safetensors/torch.py#L44
    """
    filtered_tensors = []
    for shared in tensors:
        if len(shared) < 2:
            filtered_tensors.append(shared)
            continue

        areas = []
        for name in shared:
            tensor = state_dict[name]
            areas.append((tensor.data_ptr(), _end_ptr(tensor), name))
        areas.sort()

        _, last_stop, last_name = areas[0]
        filtered_tensors.append({last_name})
        for start, stop, name in areas[1:]:
            if start >= last_stop:
                filtered_tensors.append({name})
            else:
                filtered_tensors[-1].add(name)
            last_stop = stop

    return filtered_tensors


def _find_shared_tensors(state_dict: Dict[str, "torch.Tensor"]) -> List[Set[str]]:
    """
    Taken from https://github.com/huggingface/safetensors/blob/079781fd0dc455ba0fe851e2b4507c33d0c0d407/bindings/python/py_src/safetensors/torch.py#L69.
    """
    import torch

    tensors_dict = defaultdict(set)
    for k, v in state_dict.items():
        if v.device != torch.device("meta") and storage_ptr(v) != 0 and get_torch_storage_size(v) != 0:
            # Need to add device as key because of multiple GPU.
            tensors_dict[(v.device, storage_ptr(v), get_torch_storage_size(v))].add(k)
    tensors = list(sorted(tensors_dict.values()))
    tensors = _filter_shared_not_shared(tensors, state_dict)
    return tensors


def _is_complete(tensor: "torch.Tensor") -> bool:
    """
    Taken from https://github.com/huggingface/safetensors/blob/079781fd0dc455ba0fe851e2b4507c33d0c0d407/bindings/python/py_src/safetensors/torch.py#L80
    """
    try:
        # for torch 2.1 and above we can also handle tensor subclasses
        from torch.utils._python_dispatch import is_traceable_wrapper_subclass

        if is_traceable_wrapper_subclass(tensor):
            attrs, _ = tensor.__tensor_flatten__()  # type: ignore[attr-defined]
            return all(_is_complete(getattr(tensor, attr)) for attr in attrs)
    except ImportError:
        # for torch version less than 2.1, we can fallback to original implementation
        pass

    return tensor.data_ptr() == storage_ptr(tensor) and tensor.nelement() * _get_dtype_size(
        tensor.dtype
    ) == get_torch_storage_size(tensor)


def _remove_duplicate_names(
    state_dict: Dict[str, "torch.Tensor"],
    *,
    preferred_names: Optional[List[str]] = None,
    discard_names: Optional[List[str]] = None,
) -> Dict[str, List[str]]:
    """
    Taken from https://github.com/huggingface/safetensors/blob/079781fd0dc455ba0fe851e2b4507c33d0c0d407/bindings/python/py_src/safetensors/torch.py#L80
    """
    if preferred_names is None:
        preferred_names = []
    unique_preferred_names = set(preferred_names)
    if discard_names is None:
        discard_names = []
    unique_discard_names = set(discard_names)

    shareds = _find_shared_tensors(state_dict)
    to_remove = defaultdict(list)
    for shared in shareds:
        complete_names = set([name for name in shared if _is_complete(state_dict[name])])
        if not complete_names:
            raise RuntimeError(
                "Error while trying to find names to remove to save state dict, but found no suitable name to keep"
                f" for saving amongst: {shared}. None is covering the entire storage. Refusing to save/load the model"
                " since you could be storing much more memory than needed. Please refer to"
                " https://huggingface.co/docs/safetensors/torch_shared_tensors for more information. Or open an"
                " issue."
            )

        keep_name = sorted(list(complete_names))[0]

        # Mechanism to preferentially select keys to keep
        # coming from the on-disk file to allow
        # loading models saved with a different choice
        # of keep_name
        preferred = complete_names.difference(unique_discard_names)
        if preferred:
            keep_name = sorted(list(preferred))[0]

        if unique_preferred_names:
            preferred = unique_preferred_names.intersection(complete_names)
            if preferred:
                keep_name = sorted(list(preferred))[0]
        for name in sorted(shared):
            if name != keep_name:
                to_remove[keep_name].append(name)
    return to_remove


@lru_cache()
def _get_dtype_size(dtype: "torch.dtype") -> int:
    """
    Taken from https://github.com/huggingface/safetensors/blob/08db34094e9e59e2f9218f2df133b7b4aaff5a99/bindings/python/py_src/safetensors/torch.py#L344
    """
    import torch

    # torch.float8 formats require 2.1; we do not support these dtypes on earlier versions
    _float8_e4m3fn = getattr(torch, "float8_e4m3fn", None)
    _float8_e5m2 = getattr(torch, "float8_e5m2", None)
    _SIZE = {
        torch.int64: 8,
        torch.float32: 4,
        torch.int32: 4,
        torch.bfloat16: 2,
        torch.float16: 2,
        torch.int16: 2,
        torch.uint8: 1,
        torch.int8: 1,
        torch.bool: 1,
        torch.float64: 8,
        _float8_e4m3fn: 1,
        _float8_e5m2: 1,
    }
    return _SIZE[dtype]


class _IncompatibleKeys(namedtuple("IncompatibleKeys", ["missing_keys", "unexpected_keys"])):
    """
    This is used to report missing and unexpected keys in the state dict.
    Taken from https://github.com/pytorch/pytorch/blob/main/torch/nn/modules/module.py#L52.

    """

    def __repr__(self) -> str:
        if not self.missing_keys and not self.unexpected_keys:
            return "<All keys matched successfully>"
        return super().__repr__()

    __str__ = __repr__
