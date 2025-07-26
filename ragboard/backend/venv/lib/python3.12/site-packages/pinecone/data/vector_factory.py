import numbers

from collections.abc import Iterable, Mapping
from typing import Union, Tuple, Dict

from ..utils import fix_tuple_length, convert_to_list
from ..utils.constants import REQUIRED_VECTOR_FIELDS, OPTIONAL_VECTOR_FIELDS

from pinecone.core.client.models import (
    Vector,
    SparseValues
)

class VectorDictionaryMissingKeysError(ValueError):
    def __init__(self, item):
        message = f"Vector dictionary is missing required fields: {list(REQUIRED_VECTOR_FIELDS - set(item.keys()))}"
        super().__init__(message)

class VectorDictionaryExcessKeysError(ValueError):
    def __init__(self, item):
        invalid_keys = list(set(item.keys()) - (REQUIRED_VECTOR_FIELDS | OPTIONAL_VECTOR_FIELDS))
        message = f"Found excess keys in the vector dictionary: {invalid_keys}. The allowed keys are: {list(REQUIRED_VECTOR_FIELDS | OPTIONAL_VECTOR_FIELDS)}"
        super().__init__(message)

class VectorTupleLengthError(ValueError):
    def __init__(self, item):
        message = f"Found a tuple of length {len(item)} which is not supported. Vectors can be represented as tuples either the form (id, values, metadata) or (id, values). To pass sparse values please use either dicts or Vector objects as inputs."
        super().__init__(message)

class SparseValuesTypeError(ValueError, TypeError):
    def __init__(self):
        message = "Found unexpected data in column `sparse_values`. Expected format is `'sparse_values': {'indices': List[int], 'values': List[float]}`."
        super().__init__(message)

class SparseValuesMissingKeysError(ValueError):
    def __init__(self, sparse_values_dict):
        message = f"Missing required keys in data in column `sparse_values`. Expected format is `'sparse_values': {{'indices': List[int], 'values': List[float]}}`. Found keys {list(sparse_values_dict.keys())}"
        super().__init__(message)

class SparseValuesDictionaryExpectedError(ValueError, TypeError):
    def __init__(self, sparse_values_dict):
        message = f"Column `sparse_values` is expected to be a dictionary, found {type(sparse_values_dict)}"
        super().__init__(message)

class MetadataDictionaryExpectedError(ValueError, TypeError):
    def __init__(self, item):
        message = f"Column `metadata` is expected to be a dictionary, found {type(item['metadata'])}"
        super().__init__(message)

class VectorFactory:
    @staticmethod
    def build(item: Union[Vector, Tuple, Dict], check_type: bool = True) -> Vector:
        if isinstance(item, Vector):
            return item
        elif isinstance(item, tuple):
            return VectorFactory._tuple_to_vector(item, check_type)
        elif isinstance(item, Mapping):
            return VectorFactory._dict_to_vector(item, check_type)
        else:
            raise ValueError(f"Invalid vector value passed: cannot interpret type {type(item)}")

    @staticmethod
    def _tuple_to_vector(item, check_type: bool) -> Vector:
        if len(item) < 2 or len(item) > 3:
            raise VectorTupleLengthError(item)
        id, values, metadata = fix_tuple_length(item, 3)
        if isinstance(values, SparseValues):
            raise ValueError("Sparse values are not supported in tuples. Please use either dicts or Vector objects as inputs.")
        else:
            return Vector(id=id, values=convert_to_list(values), metadata=metadata or {}, _check_type=check_type)

    @staticmethod
    def _dict_to_vector(item, check_type: bool) -> Vector:
        item_keys = set(item.keys())
        if not item_keys.issuperset(REQUIRED_VECTOR_FIELDS):
            raise VectorDictionaryMissingKeysError(item)
        
        excessive_keys = item_keys - (REQUIRED_VECTOR_FIELDS | OPTIONAL_VECTOR_FIELDS)
        if len(excessive_keys) > 0:
            raise VectorDictionaryExcessKeysError(item)

        values = item.get("values")
        if "values" in item:
            item["values"] = convert_to_list(values)

        sparse_values = item.get("sparse_values")
        if sparse_values and not isinstance(sparse_values, SparseValues):
            item["sparse_values"] = VectorFactory._dict_to_sparse_values(sparse_values, check_type)

        metadata = item.get("metadata")
        if metadata and not isinstance(metadata, Mapping):
            raise MetadataDictionaryExpectedError(item)

        try:
            return Vector(**item, _check_type=check_type)
        except TypeError as e:
            if not isinstance(item["values"], Iterable) or not isinstance(item["values"].__iter__().__next__(), numbers.Real):
                raise TypeError(f"Column `values` is expected to be a list of floats")
            raise e

    @staticmethod
    def _dict_to_sparse_values(sparse_values_dict: Dict, check_type: bool) -> SparseValues:
        if not isinstance(sparse_values_dict, Mapping):
            raise SparseValuesDictionaryExpectedError(sparse_values_dict)
        if not {"indices", "values"}.issubset(sparse_values_dict):
            raise SparseValuesMissingKeysError(sparse_values_dict)

        indices = convert_to_list(sparse_values_dict.get("indices"))
        values = convert_to_list(sparse_values_dict.get("values"))

        try:
            return SparseValues(indices=indices, values=values, _check_type=check_type)
        except TypeError:
            raise SparseValuesTypeError()