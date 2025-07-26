import functools
import operator
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional, Tuple


FILENAME_T = str
TENSOR_NAME_T = str
DTYPE_T = Literal["F64", "F32", "F16", "BF16", "I64", "I32", "I16", "I8", "U8", "BOOL"]


@dataclass
class TensorInfo:
    """Information about a tensor.

    For more details regarding the safetensors format, check out https://huggingface.co/docs/safetensors/index#format.

    Attributes:
        dtype (`str`):
            The data type of the tensor ("F64", "F32", "F16", "BF16", "I64", "I32", "I16", "I8", "U8", "BOOL").
        shape (`List[int]`):
            The shape of the tensor.
        data_offsets (`Tuple[int, int]`):
            The offsets of the data in the file as a tuple `[BEGIN, END]`.
        parameter_count (`int`):
            The number of parameters in the tensor.
    """

    dtype: DTYPE_T
    shape: List[int]
    data_offsets: Tuple[int, int]
    parameter_count: int = field(init=False)

    def __post_init__(self) -> None:
        # Taken from https://stackoverflow.com/a/13840436
        try:
            self.parameter_count = functools.reduce(operator.mul, self.shape)
        except TypeError:
            self.parameter_count = 1  # scalar value has no shape


@dataclass
class SafetensorsFileMetadata:
    """Metadata for a Safetensors file hosted on the Hub.

    This class is returned by [`parse_safetensors_file_metadata`].

    For more details regarding the safetensors format, check out https://huggingface.co/docs/safetensors/index#format.

    Attributes:
        metadata (`Dict`):
            The metadata contained in the file.
        tensors (`Dict[str, TensorInfo]`):
            A map of all tensors. Keys are tensor names and values are information about the corresponding tensor, as a
            [`TensorInfo`] object.
        parameter_count (`Dict[str, int]`):
            A map of the number of parameters per data type. Keys are data types and values are the number of parameters
            of that data type.
    """

    metadata: Dict[str, str]
    tensors: Dict[TENSOR_NAME_T, TensorInfo]
    parameter_count: Dict[DTYPE_T, int] = field(init=False)

    def __post_init__(self) -> None:
        parameter_count: Dict[DTYPE_T, int] = defaultdict(int)
        for tensor in self.tensors.values():
            parameter_count[tensor.dtype] += tensor.parameter_count
        self.parameter_count = dict(parameter_count)


@dataclass
class SafetensorsRepoMetadata:
    """Metadata for a Safetensors repo.

    A repo is considered to be a Safetensors repo if it contains either a 'model.safetensors' weight file (non-shared
    model) or a 'model.safetensors.index.json' index file (sharded model) at its root.

    This class is returned by [`get_safetensors_metadata`].

    For more details regarding the safetensors format, check out https://huggingface.co/docs/safetensors/index#format.

    Attributes:
        metadata (`Dict`, *optional*):
            The metadata contained in the 'model.safetensors.index.json' file, if it exists. Only populated for sharded
            models.
        sharded (`bool`):
            Whether the repo contains a sharded model or not.
        weight_map (`Dict[str, str]`):
            A map of all weights. Keys are tensor names and values are filenames of the files containing the tensors.
        files_metadata (`Dict[str, SafetensorsFileMetadata]`):
            A map of all files metadata. Keys are filenames and values are the metadata of the corresponding file, as
            a [`SafetensorsFileMetadata`] object.
        parameter_count (`Dict[str, int]`):
            A map of the number of parameters per data type. Keys are data types and values are the number of parameters
            of that data type.
    """

    metadata: Optional[Dict]
    sharded: bool
    weight_map: Dict[TENSOR_NAME_T, FILENAME_T]  # tensor name -> filename
    files_metadata: Dict[FILENAME_T, SafetensorsFileMetadata]  # filename -> metadata
    parameter_count: Dict[DTYPE_T, int] = field(init=False)

    def __post_init__(self) -> None:
        parameter_count: Dict[DTYPE_T, int] = defaultdict(int)
        for file_metadata in self.files_metadata.values():
            for dtype, nb_parameters_ in file_metadata.parameter_count.items():
                parameter_count[dtype] += nb_parameters_
        self.parameter_count = dict(parameter_count)
