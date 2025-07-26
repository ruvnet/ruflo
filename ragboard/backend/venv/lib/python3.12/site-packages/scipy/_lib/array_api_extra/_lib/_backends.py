"""Backends against which array-api-extra runs its tests."""

from __future__ import annotations

from enum import Enum

__all__ = ["Backend"]


class Backend(Enum):  # numpydoc ignore=PR02
    """
    All array library backends explicitly tested by array-api-extra.

    Parameters
    ----------
    value : str
        Tag of the backend's module, in the format ``<namespace>[:<extra tag>]``.
    """

    # Use :<tag> to prevent Enum from deduplicating items with the same value
    ARRAY_API_STRICT = "array_api_strict"
    ARRAY_API_STRICTEST = "array_api_strict:strictest"
    NUMPY = "numpy"
    NUMPY_READONLY = "numpy:readonly"
    CUPY = "cupy"
    TORCH = "torch"
    TORCH_GPU = "torch:gpu"
    DASK = "dask.array"
    SPARSE = "sparse"
    JAX = "jax.numpy"
    JAX_GPU = "jax.numpy:gpu"

    def __str__(self) -> str:  # type: ignore[explicit-override]  # pyright: ignore[reportImplicitOverride]  # numpydoc ignore=RT01
        """Pretty-print parameterized test names."""
        return (
            self.name.lower().replace("_gpu", ":gpu").replace("_readonly", ":readonly")
        )

    @property
    def modname(self) -> str:  # numpydoc ignore=RT01
        """Module name to be imported."""
        return self.value.split(":")[0]

    def like(self, *others: Backend) -> bool:  # numpydoc ignore=PR01,RT01
        """Check if this backend uses the same module as others."""
        return any(self.modname == other.modname for other in others)
