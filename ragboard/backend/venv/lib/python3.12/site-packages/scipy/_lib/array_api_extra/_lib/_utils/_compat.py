"""Acquire helpers from array-api-compat."""
# Allow packages that vendor both `array-api-extra` and
# `array-api-compat` to override the import location

# pylint: disable=duplicate-code
try:
    from ...._array_api_compat_vendor import (
        array_namespace,
        device,
        is_array_api_obj,
        is_array_api_strict_namespace,
        is_cupy_array,
        is_cupy_namespace,
        is_dask_array,
        is_dask_namespace,
        is_jax_array,
        is_jax_namespace,
        is_lazy_array,
        is_numpy_array,
        is_numpy_namespace,
        is_pydata_sparse_array,
        is_pydata_sparse_namespace,
        is_torch_array,
        is_torch_namespace,
        is_writeable_array,
        size,
        to_device,
    )
except ImportError:
    from array_api_compat import (
        array_namespace,
        device,
        is_array_api_obj,
        is_array_api_strict_namespace,
        is_cupy_array,
        is_cupy_namespace,
        is_dask_array,
        is_dask_namespace,
        is_jax_array,
        is_jax_namespace,
        is_lazy_array,
        is_numpy_array,
        is_numpy_namespace,
        is_pydata_sparse_array,
        is_pydata_sparse_namespace,
        is_torch_array,
        is_torch_namespace,
        is_writeable_array,
        size,
        to_device,
    )

__all__ = [
    "array_namespace",
    "device",
    "is_array_api_obj",
    "is_array_api_strict_namespace",
    "is_cupy_array",
    "is_cupy_namespace",
    "is_dask_array",
    "is_dask_namespace",
    "is_jax_array",
    "is_jax_namespace",
    "is_lazy_array",
    "is_numpy_array",
    "is_numpy_namespace",
    "is_pydata_sparse_array",
    "is_pydata_sparse_namespace",
    "is_torch_array",
    "is_torch_namespace",
    "is_writeable_array",
    "size",
    "to_device",
]
