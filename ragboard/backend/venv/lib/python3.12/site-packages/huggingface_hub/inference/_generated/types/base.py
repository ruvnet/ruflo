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
"""Contains a base class for all inference types."""

import inspect
import json
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Type, TypeVar, Union, get_args


T = TypeVar("T", bound="BaseInferenceType")


def _repr_with_extra(self):
    fields = list(self.__dataclass_fields__.keys())
    other_fields = list(k for k in self.__dict__ if k not in fields)
    return f"{self.__class__.__name__}({', '.join(f'{k}={self.__dict__[k]!r}' for k in fields + other_fields)})"


def dataclass_with_extra(cls: Type[T]) -> Type[T]:
    """Decorator to add a custom __repr__ method to a dataclass, showing all fields, including extra ones.

    This decorator only works with dataclasses that inherit from `BaseInferenceType`.
    """
    cls = dataclass(cls)
    cls.__repr__ = _repr_with_extra  # type: ignore[method-assign]
    return cls


@dataclass
class BaseInferenceType(dict):
    """Base class for all inference types.

    Object is a dataclass and a dict for backward compatibility but plan is to remove the dict part in the future.

    Handle parsing from dict, list and json strings in a permissive way to ensure future-compatibility (e.g. all fields
    are made optional, and non-expected fields are added as dict attributes).
    """

    @classmethod
    def parse_obj_as_list(cls: Type[T], data: Union[bytes, str, List, Dict]) -> List[T]:
        """Alias to parse server response and return a single instance.

        See `parse_obj` for more details.
        """
        output = cls.parse_obj(data)
        if not isinstance(output, list):
            raise ValueError(f"Invalid input data for {cls}. Expected a list, but got {type(output)}.")
        return output

    @classmethod
    def parse_obj_as_instance(cls: Type[T], data: Union[bytes, str, List, Dict]) -> T:
        """Alias to parse server response and return a single instance.

        See `parse_obj` for more details.
        """
        output = cls.parse_obj(data)
        if isinstance(output, list):
            raise ValueError(f"Invalid input data for {cls}. Expected a single instance, but got a list.")
        return output

    @classmethod
    def parse_obj(cls: Type[T], data: Union[bytes, str, List, Dict]) -> Union[List[T], T]:
        """Parse server response as a dataclass or list of dataclasses.

        To enable future-compatibility, we want to handle cases where the server return more fields than expected.
        In such cases, we don't want to raise an error but still create the dataclass object. Remaining fields are
        added as dict attributes.
        """
        # Parse server response (from bytes)
        if isinstance(data, bytes):
            data = data.decode()
        if isinstance(data, str):
            data = json.loads(data)

        # If a list, parse each item individually
        if isinstance(data, List):
            return [cls.parse_obj(d) for d in data]  # type: ignore [misc]

        # At this point, we expect a dict
        if not isinstance(data, dict):
            raise ValueError(f"Invalid data type: {type(data)}")

        init_values = {}
        other_values = {}
        for key, value in data.items():
            key = normalize_key(key)
            if key in cls.__dataclass_fields__ and cls.__dataclass_fields__[key].init:
                if isinstance(value, dict) or isinstance(value, list):
                    field_type = cls.__dataclass_fields__[key].type

                    # if `field_type` is a `BaseInferenceType`, parse it
                    if inspect.isclass(field_type) and issubclass(field_type, BaseInferenceType):
                        value = field_type.parse_obj(value)

                    # otherwise, recursively parse nested dataclasses (if possible)
                    # `get_args` returns handle Union and Optional for us
                    else:
                        expected_types = get_args(field_type)
                        for expected_type in expected_types:
                            if getattr(expected_type, "_name", None) == "List":
                                expected_type = get_args(expected_type)[
                                    0
                                ]  # assume same type for all items in the list
                            if inspect.isclass(expected_type) and issubclass(expected_type, BaseInferenceType):
                                value = expected_type.parse_obj(value)
                                break
                init_values[key] = value
            else:
                other_values[key] = value

        # Make all missing fields default to None
        # => ensure that dataclass initialization will never fail even if the server does not return all fields.
        for key in cls.__dataclass_fields__:
            if key not in init_values:
                init_values[key] = None

        # Initialize dataclass with expected values
        item = cls(**init_values)

        # Add remaining fields as dict attributes
        item.update(other_values)

        # Add remaining fields as extra dataclass fields.
        # They won't be part of the dataclass fields but will be accessible as attributes.
        # Use @dataclass_with_extra to show them in __repr__.
        item.__dict__.update(other_values)
        return item

    def __post_init__(self):
        self.update(asdict(self))

    def __setitem__(self, __key: Any, __value: Any) -> None:
        # Hacky way to keep dataclass values in sync when dict is updated
        super().__setitem__(__key, __value)
        if __key in self.__dataclass_fields__ and getattr(self, __key, None) != __value:
            self.__setattr__(__key, __value)
        return

    def __setattr__(self, __name: str, __value: Any) -> None:
        # Hacky way to keep dict values is sync when dataclass is updated
        super().__setattr__(__name, __value)
        if self.get(__name) != __value:
            self[__name] = __value
        return


def normalize_key(key: str) -> str:
    # e.g "content-type" -> "content_type", "Accept" -> "accept"
    return key.replace("-", "_").replace(" ", "_").lower()
