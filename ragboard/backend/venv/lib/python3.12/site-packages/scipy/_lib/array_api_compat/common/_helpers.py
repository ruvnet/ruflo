"""
Various helper functions which are not part of the spec.

Functions which start with an underscore are for internal use only but helpers
that are in __all__ are intended as additional helper functions for use by end
users of the compat library.
"""

from __future__ import annotations

import inspect
import math
import sys
import warnings
from collections.abc import Collection, Hashable
from functools import lru_cache
from typing import (
    TYPE_CHECKING,
    Any,
    Final,
    Literal,
    SupportsIndex,
    TypeAlias,
    TypeGuard,
    TypeVar,
    cast,
    overload,
)

from ._typing import Array, Device, HasShape, Namespace, SupportsArrayNamespace

if TYPE_CHECKING:

    import dask.array as da
    import jax
    import ndonnx as ndx
    import numpy as np
    import numpy.typing as npt
    import sparse  # pyright: ignore[reportMissingTypeStubs]
    import torch

    # TODO: import from typing (requires Python >=3.13)
    from typing_extensions import TypeIs, TypeVar

    _SizeT = TypeVar("_SizeT", bound = int | None)

    _ZeroGradientArray: TypeAlias = npt.NDArray[np.void]
    _CupyArray: TypeAlias = Any  # cupy has no py.typed

    _ArrayApiObj: TypeAlias = (
        npt.NDArray[Any]
        | da.Array
        | jax.Array
        | ndx.Array
        | sparse.SparseArray
        | torch.Tensor
        | SupportsArrayNamespace[Any]
        | _CupyArray
    )

_API_VERSIONS_OLD: Final = frozenset({"2021.12", "2022.12", "2023.12"})
_API_VERSIONS: Final = _API_VERSIONS_OLD | frozenset({"2024.12"})


@lru_cache(100)
def _issubclass_fast(cls: type, modname: str, clsname: str) -> bool:
    try:
        mod = sys.modules[modname]
    except KeyError:
        return False
    parent_cls = getattr(mod, clsname)
    return issubclass(cls, parent_cls)


def _is_jax_zero_gradient_array(x: object) -> TypeGuard[_ZeroGradientArray]:
    """Return True if `x` is a zero-gradient array.

    These arrays are a design quirk of Jax that may one day be removed.
    See https://github.com/google/jax/issues/20620.
    """
    # Fast exit
    try:
        dtype = x.dtype  # type: ignore[attr-defined]
    except AttributeError:
        return False
    cls = cast(Hashable, type(dtype))
    if not _issubclass_fast(cls, "numpy.dtypes", "VoidDType"):
        return False

    if "jax" not in sys.modules:
        return False

    import jax
    # jax.float0 is a np.dtype([('float0', 'V')])
    return dtype == jax.float0


def is_numpy_array(x: object) -> TypeGuard[npt.NDArray[Any]]:
    """
    Return True if `x` is a NumPy array.

    This function does not import NumPy if it has not already been imported
    and is therefore cheap to use.

    This also returns True for `ndarray` subclasses and NumPy scalar objects.

    See Also
    --------

    array_namespace
    is_array_api_obj
    is_cupy_array
    is_torch_array
    is_ndonnx_array
    is_dask_array
    is_jax_array
    is_pydata_sparse_array
    """
    # TODO: Should we reject ndarray subclasses?
    cls = cast(Hashable, type(x))
    return (
        _issubclass_fast(cls, "numpy", "ndarray") 
        or _issubclass_fast(cls, "numpy", "generic")
    ) and not _is_jax_zero_gradient_array(x)


def is_cupy_array(x: object) -> bool:
    """
    Return True if `x` is a CuPy array.

    This function does not import CuPy if it has not already been imported
    and is therefore cheap to use.

    This also returns True for `cupy.ndarray` subclasses and CuPy scalar objects.

    See Also
    --------

    array_namespace
    is_array_api_obj
    is_numpy_array
    is_torch_array
    is_ndonnx_array
    is_dask_array
    is_jax_array
    is_pydata_sparse_array
    """
    cls = cast(Hashable, type(x))
    return _issubclass_fast(cls, "cupy", "ndarray")


def is_torch_array(x: object) -> TypeIs[torch.Tensor]:
    """
    Return True if `x` is a PyTorch tensor.

    This function does not import PyTorch if it has not already been imported
    and is therefore cheap to use.

    See Also
    --------

    array_namespace
    is_array_api_obj
    is_numpy_array
    is_cupy_array
    is_dask_array
    is_jax_array
    is_pydata_sparse_array
    """
    cls = cast(Hashable, type(x))
    return _issubclass_fast(cls, "torch", "Tensor")


def is_ndonnx_array(x: object) -> TypeIs[ndx.Array]:
    """
    Return True if `x` is a ndonnx Array.

    This function does not import ndonnx if it has not already been imported
    and is therefore cheap to use.

    See Also
    --------

    array_namespace
    is_array_api_obj
    is_numpy_array
    is_cupy_array
    is_ndonnx_array
    is_dask_array
    is_jax_array
    is_pydata_sparse_array
    """
    cls = cast(Hashable, type(x))
    return _issubclass_fast(cls, "ndonnx", "Array")


def is_dask_array(x: object) -> TypeIs[da.Array]:
    """
    Return True if `x` is a dask.array Array.

    This function does not import dask if it has not already been imported
    and is therefore cheap to use.

    See Also
    --------

    array_namespace
    is_array_api_obj
    is_numpy_array
    is_cupy_array
    is_torch_array
    is_ndonnx_array
    is_jax_array
    is_pydata_sparse_array
    """
    cls = cast(Hashable, type(x))
    return _issubclass_fast(cls, "dask.array", "Array")


def is_jax_array(x: object) -> TypeIs[jax.Array]:
    """
    Return True if `x` is a JAX array.

    This function does not import JAX if it has not already been imported
    and is therefore cheap to use.


    See Also
    --------

    array_namespace
    is_array_api_obj
    is_numpy_array
    is_cupy_array
    is_torch_array
    is_ndonnx_array
    is_dask_array
    is_pydata_sparse_array
    """
    cls = cast(Hashable, type(x))
    return _issubclass_fast(cls, "jax", "Array") or _is_jax_zero_gradient_array(x)


def is_pydata_sparse_array(x: object) -> TypeIs[sparse.SparseArray]:
    """
    Return True if `x` is an array from the `sparse` package.

    This function does not import `sparse` if it has not already been imported
    and is therefore cheap to use.


    See Also
    --------

    array_namespace
    is_array_api_obj
    is_numpy_array
    is_cupy_array
    is_torch_array
    is_ndonnx_array
    is_dask_array
    is_jax_array
    """
    # TODO: Account for other backends.
    cls = cast(Hashable, type(x))
    return _issubclass_fast(cls, "sparse", "SparseArray")


def is_array_api_obj(x: object) -> TypeIs[_ArrayApiObj]:  # pyright: ignore[reportUnknownParameterType]
    """
    Return True if `x` is an array API compatible array object.

    See Also
    --------

    array_namespace
    is_numpy_array
    is_cupy_array
    is_torch_array
    is_ndonnx_array
    is_dask_array
    is_jax_array
    """
    return (
        hasattr(x, '__array_namespace__') 
        or _is_array_api_cls(cast(Hashable, type(x)))
    )


@lru_cache(100)
def _is_array_api_cls(cls: type) -> bool:
    return (
        # TODO: drop support for numpy<2 which didn't have __array_namespace__
        _issubclass_fast(cls, "numpy", "ndarray")
        or _issubclass_fast(cls, "numpy", "generic")
        or _issubclass_fast(cls, "cupy", "ndarray")
        or _issubclass_fast(cls, "torch", "Tensor")
        or _issubclass_fast(cls, "dask.array", "Array")
        or _issubclass_fast(cls, "sparse", "SparseArray")
        # TODO: drop support for jax<0.4.32 which didn't have __array_namespace__
        or _issubclass_fast(cls, "jax", "Array")
    )


def _compat_module_name() -> str:
    assert __name__.endswith(".common._helpers")
    return __name__.removesuffix(".common._helpers")


@lru_cache(100)
def is_numpy_namespace(xp: Namespace) -> bool:
    """
    Returns True if `xp` is a NumPy namespace.

    This includes both NumPy itself and the version wrapped by array-api-compat.

    See Also
    --------

    array_namespace
    is_cupy_namespace
    is_torch_namespace
    is_ndonnx_namespace
    is_dask_namespace
    is_jax_namespace
    is_pydata_sparse_namespace
    is_array_api_strict_namespace
    """
    return xp.__name__ in {"numpy", _compat_module_name() + ".numpy"}


@lru_cache(100)
def is_cupy_namespace(xp: Namespace) -> bool:
    """
    Returns True if `xp` is a CuPy namespace.

    This includes both CuPy itself and the version wrapped by array-api-compat.

    See Also
    --------

    array_namespace
    is_numpy_namespace
    is_torch_namespace
    is_ndonnx_namespace
    is_dask_namespace
    is_jax_namespace
    is_pydata_sparse_namespace
    is_array_api_strict_namespace
    """
    return xp.__name__ in {"cupy", _compat_module_name() + ".cupy"}


@lru_cache(100)
def is_torch_namespace(xp: Namespace) -> bool:
    """
    Returns True if `xp` is a PyTorch namespace.

    This includes both PyTorch itself and the version wrapped by array-api-compat.

    See Also
    --------

    array_namespace
    is_numpy_namespace
    is_cupy_namespace
    is_ndonnx_namespace
    is_dask_namespace
    is_jax_namespace
    is_pydata_sparse_namespace
    is_array_api_strict_namespace
    """
    return xp.__name__ in {"torch", _compat_module_name() + ".torch"}


def is_ndonnx_namespace(xp: Namespace) -> bool:
    """
    Returns True if `xp` is an NDONNX namespace.

    See Also
    --------

    array_namespace
    is_numpy_namespace
    is_cupy_namespace
    is_torch_namespace
    is_dask_namespace
    is_jax_namespace
    is_pydata_sparse_namespace
    is_array_api_strict_namespace
    """
    return xp.__name__ == "ndonnx"


@lru_cache(100)
def is_dask_namespace(xp: Namespace) -> bool:
    """
    Returns True if `xp` is a Dask namespace.

    This includes both ``dask.array`` itself and the version wrapped by array-api-compat.

    See Also
    --------

    array_namespace
    is_numpy_namespace
    is_cupy_namespace
    is_torch_namespace
    is_ndonnx_namespace
    is_jax_namespace
    is_pydata_sparse_namespace
    is_array_api_strict_namespace
    """
    return xp.__name__ in {"dask.array", _compat_module_name() + ".dask.array"}


def is_jax_namespace(xp: Namespace) -> bool:
    """
    Returns True if `xp` is a JAX namespace.

    This includes ``jax.numpy`` and ``jax.experimental.array_api`` which existed in
    older versions of JAX.

    See Also
    --------

    array_namespace
    is_numpy_namespace
    is_cupy_namespace
    is_torch_namespace
    is_ndonnx_namespace
    is_dask_namespace
    is_pydata_sparse_namespace
    is_array_api_strict_namespace
    """
    return xp.__name__ in {"jax.numpy", "jax.experimental.array_api"}


def is_pydata_sparse_namespace(xp: Namespace) -> bool:
    """
    Returns True if `xp` is a pydata/sparse namespace.

    See Also
    --------

    array_namespace
    is_numpy_namespace
    is_cupy_namespace
    is_torch_namespace
    is_ndonnx_namespace
    is_dask_namespace
    is_jax_namespace
    is_array_api_strict_namespace
    """
    return xp.__name__ == "sparse"


def is_array_api_strict_namespace(xp: Namespace) -> bool:
    """
    Returns True if `xp` is an array-api-strict namespace.

    See Also
    --------

    array_namespace
    is_numpy_namespace
    is_cupy_namespace
    is_torch_namespace
    is_ndonnx_namespace
    is_dask_namespace
    is_jax_namespace
    is_pydata_sparse_namespace
    """
    return xp.__name__ == "array_api_strict"


def _check_api_version(api_version: str | None) -> None:
    if api_version in _API_VERSIONS_OLD:
        warnings.warn(
            f"The {api_version} version of the array API specification was requested but the returned namespace is actually version 2024.12"
        )
    elif api_version is not None and api_version not in _API_VERSIONS:
        raise ValueError(
            "Only the 2024.12 version of the array API specification is currently supported"
        )


def array_namespace(
    *xs: Array | complex | None,
    api_version: str | None = None,
    use_compat: bool | None = None,
) -> Namespace:
    """
    Get the array API compatible namespace for the arrays `xs`.

    Parameters
    ----------
    xs: arrays
        one or more arrays. xs can also be Python scalars (bool, int, float,
        complex, or None), which are ignored.

    api_version: str
        The newest version of the spec that you need support for (currently
        the compat library wrapped APIs support v2024.12).

    use_compat: bool or None
        If None (the default), the native namespace will be returned if it is
        already array API compatible, otherwise a compat wrapper is used. If
        True, the compat library wrapped library will be returned. If False,
        the native library namespace is returned.

    Returns
    -------

    out: namespace
        The array API compatible namespace corresponding to the arrays in `xs`.

    Raises
    ------
    TypeError
        If `xs` contains arrays from different array libraries or contains a
        non-array.


    Typical usage is to pass the arguments of a function to
    `array_namespace()` at the top of a function to get the corresponding
    array API namespace:

    .. code:: python

       def your_function(x, y):
           xp = array_api_compat.array_namespace(x, y)
           # Now use xp as the array library namespace
           return xp.mean(x, axis=0) + 2*xp.std(y, axis=0)


    Wrapped array namespaces can also be imported directly. For example,
    `array_namespace(np.array(...))` will return `array_api_compat.numpy`.
    This function will also work for any array library not wrapped by
    array-api-compat if it explicitly defines `__array_namespace__
    <https://data-apis.org/array-api/latest/API_specification/generated/array_api.array.__array_namespace__.html>`__
    (the wrapped namespace is always preferred if it exists).

    See Also
    --------

    is_array_api_obj
    is_numpy_array
    is_cupy_array
    is_torch_array
    is_dask_array
    is_jax_array
    is_pydata_sparse_array

    """
    if use_compat not in [None, True, False]:
        raise ValueError("use_compat must be None, True, or False")

    _use_compat = use_compat in [None, True]

    namespaces: set[Namespace] = set()
    for x in xs:
        if is_numpy_array(x):
            import numpy as np

            from .. import numpy as numpy_namespace

            if use_compat is True:
                _check_api_version(api_version)
                namespaces.add(numpy_namespace)
            elif use_compat is False:
                namespaces.add(np)
            else:
                # numpy 2.0+ have __array_namespace__, however, they are not yet fully array API
                # compatible.
                namespaces.add(numpy_namespace)
        elif is_cupy_array(x):
            if _use_compat:
                _check_api_version(api_version)
                from .. import cupy as cupy_namespace

                namespaces.add(cupy_namespace)
            else:
                import cupy as cp  # pyright: ignore[reportMissingTypeStubs]

                namespaces.add(cp)
        elif is_torch_array(x):
            if _use_compat:
                _check_api_version(api_version)
                from .. import torch as torch_namespace

                namespaces.add(torch_namespace)
            else:
                import torch

                namespaces.add(torch)
        elif is_dask_array(x):
            if _use_compat:
                _check_api_version(api_version)
                from ..dask import array as dask_namespace

                namespaces.add(dask_namespace)
            else:
                import dask.array as da

                namespaces.add(da)
        elif is_jax_array(x):
            if use_compat is True:
                _check_api_version(api_version)
                raise ValueError("JAX does not have an array-api-compat wrapper")
            elif use_compat is False:
                import jax.numpy as jnp
            else:
                # JAX v0.4.32 and newer implements the array API directly in jax.numpy.
                # For older JAX versions, it is available via jax.experimental.array_api.
                import jax.numpy

                if hasattr(jax.numpy, "__array_api_version__"):
                    jnp = jax.numpy
                else:
                    import jax.experimental.array_api as jnp  # pyright: ignore[reportMissingImports]
            namespaces.add(jnp)
        elif is_pydata_sparse_array(x):
            if use_compat is True:
                _check_api_version(api_version)
                raise ValueError("`sparse` does not have an array-api-compat wrapper")
            else:
                import sparse  # pyright: ignore[reportMissingTypeStubs]
            # `sparse` is already an array namespace. We do not have a wrapper
            # submodule for it.
            namespaces.add(sparse)
        elif hasattr(x, "__array_namespace__"):
            if use_compat is True:
                raise ValueError(
                    "The given array does not have an array-api-compat wrapper"
                )
            x = cast("SupportsArrayNamespace[Any]", x)
            namespaces.add(x.__array_namespace__(api_version=api_version))
        elif isinstance(x, (bool, int, float, complex, type(None))):
            continue
        else:
            # TODO: Support Python scalars?
            raise TypeError(f"{type(x).__name__} is not a supported array type")

    if not namespaces:
        raise TypeError("Unrecognized array input")

    if len(namespaces) != 1:
        raise TypeError(f"Multiple namespaces for array inputs: {namespaces}")

    (xp,) = namespaces

    return xp


# backwards compatibility alias
get_namespace = array_namespace


def _check_device(bare_xp: Namespace, device: Device) -> None:  # pyright: ignore[reportUnusedFunction]
    """
    Validate dummy device on device-less array backends.

    Notes
    -----
    This function is also invoked by CuPy, which does have multiple devices
    if there are multiple GPUs available.
    However, CuPy multi-device support is currently impossible
    without using the global device or a context manager:

    https://github.com/data-apis/array-api-compat/pull/293
    """
    if bare_xp is sys.modules.get("numpy"):
        if device not in ("cpu", None):
            raise ValueError(f"Unsupported device for NumPy: {device!r}")

    elif bare_xp is sys.modules.get("dask.array"):
        if device not in ("cpu", _DASK_DEVICE, None):
            raise ValueError(f"Unsupported device for Dask: {device!r}")


# Placeholder object to represent the dask device
# when the array backend is not the CPU.
# (since it is not easy to tell which device a dask array is on)
class _dask_device:
    def __repr__(self) -> Literal["DASK_DEVICE"]:
        return "DASK_DEVICE"


_DASK_DEVICE = _dask_device()


# device() is not on numpy.ndarray or dask.array and to_device() is not on numpy.ndarray
# or cupy.ndarray. They are not included in array objects of this library
# because this library just reuses the respective ndarray classes without
# wrapping or subclassing them. These helper functions can be used instead of
# the wrapper functions for libraries that need to support both NumPy/CuPy and
# other libraries that use devices.
def device(x: _ArrayApiObj, /) -> Device:
    """
    Hardware device the array data resides on.

    This is equivalent to `x.device` according to the `standard
    <https://data-apis.org/array-api/latest/API_specification/generated/array_api.array.device.html>`__.
    This helper is included because some array libraries either do not have
    the `device` attribute or include it with an incompatible API.

    Parameters
    ----------
    x: array
        array instance from an array API compatible library.

    Returns
    -------
    out: device
        a ``device`` object (see the `Device Support <https://data-apis.org/array-api/latest/design_topics/device_support.html>`__
        section of the array API specification).

    Notes
    -----

    For NumPy the device is always `"cpu"`. For Dask, the device is always a
    special `DASK_DEVICE` object.

    See Also
    --------

    to_device : Move array data to a different device.

    """
    if is_numpy_array(x):
        return "cpu"
    elif is_dask_array(x):
        # Peek at the metadata of the Dask array to determine type
        if is_numpy_array(x._meta):  # pyright: ignore
            # Must be on CPU since backed by numpy
            return "cpu"
        return _DASK_DEVICE
    elif is_jax_array(x):
        # FIXME Jitted JAX arrays do not have a device attribute
        #       https://github.com/jax-ml/jax/issues/26000
        #       Return None in this case. Note that this workaround breaks
        #       the standard and will result in new arrays being created on the
        #       default device instead of the same device as the input array(s).
        x_device = getattr(x, "device", None)
        # Older JAX releases had .device() as a method, which has been replaced
        # with a property in accordance with the standard.
        if inspect.ismethod(x_device):
            return x_device()
        else:
            return x_device
    elif is_pydata_sparse_array(x):
        # `sparse` will gain `.device`, so check for this first.
        x_device = getattr(x, "device", None)
        if x_device is not None:
            return x_device
        # Everything but DOK has this attr.
        try:
            inner = x.data  # pyright: ignore
        except AttributeError:
            return "cpu"
        # Return the device of the constituent array
        return device(inner)  # pyright: ignore
    return x.device  # pyright: ignore


# Prevent shadowing, used below
_device = device


# Based on cupy.array_api.Array.to_device
def _cupy_to_device(
    x: _CupyArray,
    device: Device,
    /,
    stream: int | Any | None = None,
) -> _CupyArray:
    import cupy as cp

    if device == "cpu":
        # allowing us to use `to_device(x, "cpu")`
        # is useful for portable test swapping between
        # host and device backends
        return x.get()
    if not isinstance(device, cp.cuda.Device):
        raise TypeError(f"Unsupported device type {device!r}")

    if stream is None:
        with device:
            return cp.asarray(x)

    # stream can be an int as specified in __dlpack__, or a CuPy stream
    if isinstance(stream, int):
        stream = cp.cuda.ExternalStream(stream)
    elif not isinstance(stream, cp.cuda.Stream):
        raise TypeError(f"Unsupported stream type {stream!r}")

    with device, stream:
        return cp.asarray(x)


def _torch_to_device(
    x: torch.Tensor,
    device: torch.device | str | int,
    /,
    stream: None = None,
) -> torch.Tensor:
    if stream is not None:
        raise NotImplementedError
    return x.to(device)


def to_device(x: Array, device: Device, /, *, stream: int | Any | None = None) -> Array:
    """
    Copy the array from the device on which it currently resides to the specified ``device``.

    This is equivalent to `x.to_device(device, stream=stream)` according to
    the `standard
    <https://data-apis.org/array-api/latest/API_specification/generated/array_api.array.to_device.html>`__.
    This helper is included because some array libraries do not have the
    `to_device` method.

    Parameters
    ----------

    x: array
        array instance from an array API compatible library.

    device: device
        a ``device`` object (see the `Device Support <https://data-apis.org/array-api/latest/design_topics/device_support.html>`__
        section of the array API specification).

    stream: int | Any | None
        stream object to use during copy. In addition to the types supported
        in ``array.__dlpack__``, implementations may choose to support any
        library-specific stream object with the caveat that any code using
        such an object would not be portable.

    Returns
    -------

    out: array
        an array with the same data and data type as ``x`` and located on the
        specified ``device``.

    Notes
    -----

    For NumPy, this function effectively does nothing since the only supported
    device is the CPU. For CuPy, this method supports CuPy CUDA
    :external+cupy:class:`Device <cupy.cuda.Device>` and
    :external+cupy:class:`Stream <cupy.cuda.Stream>` objects. For PyTorch,
    this is the same as :external+torch:meth:`x.to(device) <torch.Tensor.to>`
    (the ``stream`` argument is not supported in PyTorch).

    See Also
    --------

    device : Hardware device the array data resides on.

    """
    if is_numpy_array(x):
        if stream is not None:
            raise ValueError("The stream argument to to_device() is not supported")
        if device == "cpu":
            return x
        raise ValueError(f"Unsupported device {device!r}")
    elif is_cupy_array(x):
        # cupy does not yet have to_device
        return _cupy_to_device(x, device, stream=stream)
    elif is_torch_array(x):
        return _torch_to_device(x, device, stream=stream)  # pyright: ignore[reportArgumentType]
    elif is_dask_array(x):
        if stream is not None:
            raise ValueError("The stream argument to to_device() is not supported")
        # TODO: What if our array is on the GPU already?
        if device == "cpu":
            return x
        raise ValueError(f"Unsupported device {device!r}")
    elif is_jax_array(x):
        if not hasattr(x, "__array_namespace__"):
            # In JAX v0.4.31 and older, this import adds to_device method to x...
            import jax.experimental.array_api  # noqa: F401  # pyright: ignore

            # ... but only on eager JAX. It won't work inside jax.jit.
            if not hasattr(x, "to_device"):
                return x
        return x.to_device(device, stream=stream)
    elif is_pydata_sparse_array(x) and device == _device(x):
        # Perform trivial check to return the same array if
        # device is same instead of err-ing.
        return x
    return x.to_device(device, stream=stream)  # pyright: ignore


@overload
def size(x: HasShape[Collection[SupportsIndex]]) -> int: ...
@overload
def size(x: HasShape[Collection[None]]) -> None: ...
@overload
def size(x: HasShape[Collection[SupportsIndex | None]]) -> int | None: ...
def size(x: HasShape[Collection[SupportsIndex | None]]) -> int | None:
    """
    Return the total number of elements of x.

    This is equivalent to `x.size` according to the `standard
    <https://data-apis.org/array-api/latest/API_specification/generated/array_api.array.size.html>`__.

    This helper is included because PyTorch defines `size` in an
    :external+torch:meth:`incompatible way <torch.Tensor.size>`.
    It also fixes dask.array's behaviour which returns nan for unknown sizes, whereas
    the standard requires None.
    """
    # Lazy API compliant arrays, such as ndonnx, can contain None in their shape
    if None in x.shape:
        return None
    out = math.prod(cast("Collection[SupportsIndex]", x.shape))
    # dask.array.Array.shape can contain NaN
    return None if math.isnan(out) else out


@lru_cache(100)
def _is_writeable_cls(cls: type) -> bool | None:
    if (
        _issubclass_fast(cls, "numpy", "generic")
        or _issubclass_fast(cls, "jax", "Array")
        or _issubclass_fast(cls, "sparse", "SparseArray")
    ):
        return False
    if _is_array_api_cls(cls):
        return True
    return None


def is_writeable_array(x: object) -> bool:
    """
    Return False if ``x.__setitem__`` is expected to raise; True otherwise.
    Return False if `x` is not an array API compatible object.

    Warning
    -------
    As there is no standard way to check if an array is writeable without actually
    writing to it, this function blindly returns True for all unknown array types.
    """
    cls = cast(Hashable, type(x))
    if _issubclass_fast(cls, "numpy", "ndarray"):
        return cast("npt.NDArray", x).flags.writeable
    res = _is_writeable_cls(cls)
    if res is not None:
        return res
    return hasattr(x, '__array_namespace__')


@lru_cache(100)
def _is_lazy_cls(cls: type) -> bool | None:
    if (
        _issubclass_fast(cls, "numpy", "ndarray")
        or _issubclass_fast(cls, "numpy", "generic")
        or _issubclass_fast(cls, "cupy", "ndarray")
        or _issubclass_fast(cls, "torch", "Tensor")
        or _issubclass_fast(cls, "sparse", "SparseArray")
    ):
        return False
    if (
        _issubclass_fast(cls, "jax", "Array")
        or _issubclass_fast(cls, "dask.array", "Array")
        or _issubclass_fast(cls, "ndonnx", "Array")
    ):
        return True
    return  None


def is_lazy_array(x: object) -> bool:
    """Return True if x is potentially a future or it may be otherwise impossible or
    expensive to eagerly read its contents, regardless of their size, e.g. by
    calling ``bool(x)`` or ``float(x)``.

    Return False otherwise; e.g. ``bool(x)`` etc. is guaranteed to succeed and to be
    cheap as long as the array has the right dtype and size.

    Note
    ----
    This function errs on the side of caution for array types that may or may not be
    lazy, e.g. JAX arrays, by always returning True for them.
    """
    # **JAX note:** while it is possible to determine if you're inside or outside
    # jax.jit by testing the subclass of a jax.Array object, as well as testing bool()
    # as we do below for unknown arrays, this is not recommended by JAX best practices.

    # **Dask note:** Dask eagerly computes the graph on __bool__, __float__, and so on.
    # This behaviour, while impossible to change without breaking backwards
    # compatibility, is highly detrimental to performance as the whole graph will end
    # up being computed multiple times.

    # Note: skipping reclassification of JAX zero gradient arrays, as one will
    # exclusively get them once they leave a jax.grad JIT context.
    cls = cast(Hashable, type(x))
    res = _is_lazy_cls(cls)
    if res is not None:
        return res

    if not hasattr(x, "__array_namespace__"):
        return False

    # Unknown Array API compatible object. Note that this test may have dire consequences
    # in terms of performance, e.g. for a lazy object that eagerly computes the graph
    # on __bool__ (dask is one such example, which however is special-cased above).

    # Select a single point of the array
    s = size(cast("HasShape[Collection[SupportsIndex | None]]", x))
    if s is None:
        return True
    xp = array_namespace(x)
    if s > 1:
        x = xp.reshape(x, (-1,))[0]
    # Cast to dtype=bool and deal with size 0 arrays
    x = xp.any(x)

    try:
        bool(x)
        return False
    # The Array API standard dictactes that __bool__ should raise TypeError if the
    # output cannot be defined.
    # Here we allow for it to raise arbitrary exceptions, e.g. like Dask does.
    except Exception:
        return True


__all__ = [
    "array_namespace",
    "device",
    "get_namespace",
    "is_array_api_obj",
    "is_array_api_strict_namespace",
    "is_cupy_array",
    "is_cupy_namespace",
    "is_dask_array",
    "is_dask_namespace",
    "is_jax_array",
    "is_jax_namespace",
    "is_numpy_array",
    "is_numpy_namespace",
    "is_torch_array",
    "is_torch_namespace",
    "is_ndonnx_array",
    "is_ndonnx_namespace",
    "is_pydata_sparse_array",
    "is_pydata_sparse_namespace",
    "is_writeable_array",
    "is_lazy_array",
    "size",
    "to_device",
]

_all_ignore = ['lru_cache', 'sys', 'math', 'inspect', 'warnings']

def __dir__() -> list[str]:
    return __all__
