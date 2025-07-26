# coding=utf-8
# Copyright 2023-present, the HuggingFace Inc. team.
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
"""Contains utilities to flag a feature as "experimental" in Huggingface Hub."""

import warnings
from functools import wraps
from typing import Callable

from .. import constants


def experimental(fn: Callable) -> Callable:
    """Decorator to flag a feature as experimental.

    An experimental feature triggers a warning when used as it might be subject to breaking changes without prior notice
    in the future.

    Warnings can be disabled by setting `HF_HUB_DISABLE_EXPERIMENTAL_WARNING=1` as environment variable.

    Args:
        fn (`Callable`):
            The function to flag as experimental.

    Returns:
        `Callable`: The decorated function.

    Example:

    ```python
    >>> from huggingface_hub.utils import experimental

    >>> @experimental
    ... def my_function():
    ...     print("Hello world!")

    >>> my_function()
    UserWarning: 'my_function' is experimental and might be subject to breaking changes in the future without prior
    notice. You can disable this warning by setting `HF_HUB_DISABLE_EXPERIMENTAL_WARNING=1` as environment variable.
    Hello world!
    ```
    """
    # For classes, put the "experimental" around the "__new__" method => __new__ will be removed in warning message
    name = fn.__qualname__[: -len(".__new__")] if fn.__qualname__.endswith(".__new__") else fn.__qualname__

    @wraps(fn)
    def _inner_fn(*args, **kwargs):
        if not constants.HF_HUB_DISABLE_EXPERIMENTAL_WARNING:
            warnings.warn(
                f"'{name}' is experimental and might be subject to breaking changes in the future without prior notice."
                " You can disable this warning by setting `HF_HUB_DISABLE_EXPERIMENTAL_WARNING=1` as environment"
                " variable.",
                UserWarning,
            )
        return fn(*args, **kwargs)

    return _inner_fn
