"""Utility functions to use Python Array API compatible libraries.

For the context about the Array API see:
https://data-apis.org/array-api/latest/purpose_and_scope.html

The SciPy use case of the Array API is described on the following page:
https://data-apis.org/array-api/latest/use_cases.html#use-case-scipy
"""
import contextlib
import dataclasses
import functools
import os
import textwrap

from collections.abc import Generator, Iterable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from types import ModuleType
from typing import Any, Literal, TypeAlias

import numpy as np
import numpy.typing as npt

from scipy._lib import array_api_compat
from scipy._lib.array_api_compat import (
    is_array_api_obj,
    is_lazy_array,
    size as xp_size,
    numpy as np_compat,
    device as xp_device,
    is_numpy_namespace as is_numpy,
    is_cupy_namespace as is_cupy,
    is_torch_namespace as is_torch,
    is_jax_namespace as is_jax,
    is_dask_namespace as is_dask,
    is_array_api_strict_namespace as is_array_api_strict
)
from scipy._lib._sparse import issparse
from scipy._lib._docscrape import FunctionDoc

__all__ = [
    '_asarray', 'array_namespace', 'assert_almost_equal', 'assert_array_almost_equal',
    'default_xp', 'eager_warns', 'is_lazy_array', 'is_marray',
    'is_array_api_strict', 'is_complex', 'is_cupy', 'is_jax', 'is_numpy', 'is_torch',
    'SCIPY_ARRAY_API', 'SCIPY_DEVICE', 'scipy_namespace_for',
    'xp_assert_close', 'xp_assert_equal', 'xp_assert_less',
    'xp_copy', 'xp_device', 'xp_ravel', 'xp_size',
    'xp_unsupported_param_msg', 'xp_vector_norm', 'xp_capabilities',
    'xp_result_type', 'xp_promote'
]


# To enable array API and strict array-like input validation
SCIPY_ARRAY_API: str | bool = os.environ.get("SCIPY_ARRAY_API", False)
# To control the default device - for use in the test suite only
SCIPY_DEVICE = os.environ.get("SCIPY_DEVICE", "cpu")

_GLOBAL_CONFIG = {
    "SCIPY_ARRAY_API": SCIPY_ARRAY_API,
    "SCIPY_DEVICE": SCIPY_DEVICE,
}


Array: TypeAlias = Any  # To be changed to a Protocol later (see array-api#589)
ArrayLike: TypeAlias = Array | npt.ArrayLike


def _compliance_scipy(arrays: Iterable[ArrayLike]) -> Iterator[Array]:
    """Raise exceptions on known-bad subclasses. Discard 0-dimensional ArrayLikes
    and convert 1+-dimensional ArrayLikes to numpy.

    The following subclasses are not supported and raise and error:
    - `numpy.ma.MaskedArray`
    - `numpy.matrix`
    - NumPy arrays which do not have a boolean or numerical dtype
    - Any array-like which is neither array API compatible nor coercible by NumPy
    - Any array-like which is coerced by NumPy to an unsupported dtype
    """
    for array in arrays:
        if array is None:
            continue

        # this comes from `_util._asarray_validated`
        if issparse(array):
            msg = ('Sparse arrays/matrices are not supported by this function. '
                   'Perhaps one of the `scipy.sparse.linalg` functions '
                   'would work instead.')
            raise ValueError(msg)

        if isinstance(array, np.ma.MaskedArray):
            raise TypeError("Inputs of type `numpy.ma.MaskedArray` are not supported.")

        if isinstance(array, np.matrix):
            raise TypeError("Inputs of type `numpy.matrix` are not supported.")

        if isinstance(array, np.ndarray | np.generic):
            dtype = array.dtype
            if not (np.issubdtype(dtype, np.number) or np.issubdtype(dtype, np.bool_)):
                raise TypeError(f"An argument has dtype `{dtype!r}`; "
                                f"only boolean and numerical dtypes are supported.")

        if is_array_api_obj(array):
            yield array
        else:
            try:
                array = np.asanyarray(array)
            except TypeError:
                raise TypeError("An argument is neither array API compatible nor "
                                "coercible by NumPy.")
            dtype = array.dtype
            if not (np.issubdtype(dtype, np.number) or np.issubdtype(dtype, np.bool_)):
                message = (
                    f"An argument was coerced to an unsupported dtype `{dtype!r}`; "
                    f"only boolean and numerical dtypes are supported."
                )
                raise TypeError(message)
            # Ignore 0-dimensional arrays, coherently with array-api-compat.
            # Raise if there are 1+-dimensional array-likes mixed with non-numpy
            # Array API objects.
            if array.ndim:
                yield array


def _check_finite(array: Array, xp: ModuleType) -> None:
    """Check for NaNs or Infs."""
    if not xp.all(xp.isfinite(array)):
        msg = "array must not contain infs or NaNs"
        raise ValueError(msg)


def array_namespace(*arrays: Array) -> ModuleType:
    """Get the array API compatible namespace for the arrays xs.

    Parameters
    ----------
    *arrays : sequence of array_like
        Arrays used to infer the common namespace.

    Returns
    -------
    namespace : module
        Common namespace.

    Notes
    -----
    Thin wrapper around `array_api_compat.array_namespace`.

    1. Check for the global switch: SCIPY_ARRAY_API. This can also be accessed
       dynamically through ``_GLOBAL_CONFIG['SCIPY_ARRAY_API']``.
    2. `_compliance_scipy` raise exceptions on known-bad subclasses. See
       its definition for more details.

    When the global switch is False, it defaults to the `numpy` namespace.
    In that case, there is no compliance check. This is a convenience to
    ease the adoption. Otherwise, arrays must comply with the new rules.
    """
    if not _GLOBAL_CONFIG["SCIPY_ARRAY_API"]:
        # here we could wrap the namespace if needed
        return np_compat

    api_arrays = list(_compliance_scipy(arrays))
    # In case of a mix of array API compliant arrays and scalars, return
    # the array API namespace. If there are only ArrayLikes (e.g. lists),
    # return NumPy (wrapped by array-api-compat).
    if api_arrays:
        return array_api_compat.array_namespace(*api_arrays)
    return np_compat


def _asarray(
        array: ArrayLike,
        dtype: Any = None,
        order: Literal['K', 'A', 'C', 'F'] | None = None,
        copy: bool | None = None,
        *,
        xp: ModuleType | None = None,
        check_finite: bool = False,
        subok: bool = False,
    ) -> Array:
    """SciPy-specific replacement for `np.asarray` with `order`, `check_finite`, and
    `subok`.

    Memory layout parameter `order` is not exposed in the Array API standard.
    `order` is only enforced if the input array implementation
    is NumPy based, otherwise `order` is just silently ignored.

    `check_finite` is also not a keyword in the array API standard; included
    here for convenience rather than that having to be a separate function
    call inside SciPy functions.

    `subok` is included to allow this function to preserve the behaviour of
    `np.asanyarray` for NumPy based inputs.
    """
    if xp is None:
        xp = array_namespace(array)
    if is_numpy(xp):
        # Use NumPy API to support order
        if copy is True:
            array = np.array(array, order=order, dtype=dtype, subok=subok)
        elif subok:
            array = np.asanyarray(array, order=order, dtype=dtype)
        else:
            array = np.asarray(array, order=order, dtype=dtype)
    else:
        try:
            array = xp.asarray(array, dtype=dtype, copy=copy)
        except TypeError:
            coerced_xp = array_namespace(xp.asarray(3))
            array = coerced_xp.asarray(array, dtype=dtype, copy=copy)

    if check_finite:
        _check_finite(array, xp)

    return array


def xp_copy(x: Array, *, xp: ModuleType | None = None) -> Array:
    """
    Copies an array.

    Parameters
    ----------
    x : array

    xp : array_namespace

    Returns
    -------
    copy : array
        Copied array

    Notes
    -----
    This copy function does not offer all the semantics of `np.copy`, i.e. the
    `subok` and `order` keywords are not used.
    """
    # Note: for older NumPy versions, `np.asarray` did not support the `copy` kwarg,
    # so this uses our other helper `_asarray`.
    if xp is None:
        xp = array_namespace(x)

    return _asarray(x, copy=True, xp=xp)


_default_xp_ctxvar: ContextVar[ModuleType] = ContextVar("_default_xp")

@contextmanager
def default_xp(xp: ModuleType) -> Generator[None, None, None]:
    """In all ``xp_assert_*`` and ``assert_*`` function calls executed within this
    context manager, test by default that the array namespace is
    the provided across all arrays, unless one explicitly passes the ``xp=``
    parameter or ``check_namespace=False``.

    Without this context manager, the default value for `xp` is the namespace
    for the desired array (the second parameter of the tests).
    """
    token = _default_xp_ctxvar.set(xp)
    try:
        yield
    finally:
        _default_xp_ctxvar.reset(token)


def eager_warns(x, warning_type, match=None):
    """pytest.warns context manager, but only if x is not a lazy array."""
    import pytest
    # This attribute is interpreted by pytest-run-parallel, ensuring that tests that use
    # `eager_warns` aren't run in parallel (since pytest.warns isn't thread-safe).
    __thread_safe__ = False  # noqa: F841
    if is_lazy_array(x):
        return contextlib.nullcontext()
    return pytest.warns(warning_type, match=match)


def _strict_check(actual, desired, xp, *,
                  check_namespace=True, check_dtype=True, check_shape=True,
                  check_0d=True):
    __tracebackhide__ = True  # Hide traceback for py.test

    if xp is None:
        try:
            xp = _default_xp_ctxvar.get()
        except LookupError:
            xp = array_namespace(desired)

    if check_namespace:
        _assert_matching_namespace(actual, desired, xp)

    # only NumPy distinguishes between scalars and arrays; we do if check_0d=True.
    # do this first so we can then cast to array (and thus use the array API) below.
    if is_numpy(xp) and check_0d:
        _msg = ("Array-ness does not match:\n Actual: "
                f"{type(actual)}\n Desired: {type(desired)}")
        assert ((xp.isscalar(actual) and xp.isscalar(desired))
                or (not xp.isscalar(actual) and not xp.isscalar(desired))), _msg

    actual = xp.asarray(actual)
    desired = xp.asarray(desired)

    if check_dtype:
        _msg = f"dtypes do not match.\nActual: {actual.dtype}\nDesired: {desired.dtype}"
        assert actual.dtype == desired.dtype, _msg

    if check_shape:
        if is_dask(xp):
            actual.compute_chunk_sizes()
            desired.compute_chunk_sizes()
        _msg = f"Shapes do not match.\nActual: {actual.shape}\nDesired: {desired.shape}"
        assert actual.shape == desired.shape, _msg

    desired = xp.broadcast_to(desired, actual.shape)
    return actual, desired, xp


def _assert_matching_namespace(actual, desired, xp):
    __tracebackhide__ = True  # Hide traceback for py.test

    desired_arr_space = array_namespace(desired)
    _msg = ("Namespace of desired array does not match expectations "
            "set by the `default_xp` context manager or by the `xp`"
            "pytest fixture.\n"
            f"Desired array's space: {desired_arr_space.__name__}\n"
            f"Expected namespace: {xp.__name__}")
    assert desired_arr_space == xp, _msg

    actual_arr_space = array_namespace(actual)
    _msg = ("Namespace of actual and desired arrays do not match.\n"
            f"Actual: {actual_arr_space.__name__}\n"
            f"Desired: {xp.__name__}")
    assert actual_arr_space == xp, _msg


def xp_assert_equal(actual, desired, *, check_namespace=True, check_dtype=True,
                    check_shape=True, check_0d=True, err_msg='', xp=None):
    __tracebackhide__ = True  # Hide traceback for py.test

    actual, desired, xp = _strict_check(
        actual, desired, xp, check_namespace=check_namespace,
        check_dtype=check_dtype, check_shape=check_shape,
        check_0d=check_0d
    )

    if is_cupy(xp):
        return xp.testing.assert_array_equal(actual, desired, err_msg=err_msg)
    elif is_torch(xp):
        # PyTorch recommends using `rtol=0, atol=0` like this
        # to test for exact equality
        err_msg = None if err_msg == '' else err_msg
        return xp.testing.assert_close(actual, desired, rtol=0, atol=0, equal_nan=True,
                                       check_dtype=False, msg=err_msg)
    # JAX uses `np.testing`
    return np.testing.assert_array_equal(actual, desired, err_msg=err_msg)


def xp_assert_close(actual, desired, *, rtol=None, atol=0, check_namespace=True,
                    check_dtype=True, check_shape=True, check_0d=True,
                    err_msg='', xp=None):
    __tracebackhide__ = True  # Hide traceback for py.test

    actual, desired, xp = _strict_check(
        actual, desired, xp,
        check_namespace=check_namespace, check_dtype=check_dtype,
        check_shape=check_shape, check_0d=check_0d
    )

    floating = xp.isdtype(actual.dtype, ('real floating', 'complex floating'))
    if rtol is None and floating:
        # multiplier of 4 is used as for `np.float64` this puts the default `rtol`
        # roughly half way between sqrt(eps) and the default for
        # `numpy.testing.assert_allclose`, 1e-7
        rtol = xp.finfo(actual.dtype).eps**0.5 * 4
    elif rtol is None:
        rtol = 1e-7

    if is_cupy(xp):
        return xp.testing.assert_allclose(actual, desired, rtol=rtol,
                                          atol=atol, err_msg=err_msg)
    elif is_torch(xp):
        err_msg = None if err_msg == '' else err_msg
        return xp.testing.assert_close(actual, desired, rtol=rtol, atol=atol,
                                       equal_nan=True, check_dtype=False, msg=err_msg)
    # JAX uses `np.testing`
    return np.testing.assert_allclose(actual, desired, rtol=rtol,
                                      atol=atol, err_msg=err_msg)


def xp_assert_less(actual, desired, *, check_namespace=True, check_dtype=True,
                   check_shape=True, check_0d=True, err_msg='', verbose=True, xp=None):
    __tracebackhide__ = True  # Hide traceback for py.test

    actual, desired, xp = _strict_check(
        actual, desired, xp, check_namespace=check_namespace,
        check_dtype=check_dtype, check_shape=check_shape,
        check_0d=check_0d
    )

    if is_cupy(xp):
        return xp.testing.assert_array_less(actual, desired,
                                            err_msg=err_msg, verbose=verbose)
    elif is_torch(xp):
        if actual.device.type != 'cpu':
            actual = actual.cpu()
        if desired.device.type != 'cpu':
            desired = desired.cpu()
    # JAX uses `np.testing`
    return np.testing.assert_array_less(actual, desired,
                                        err_msg=err_msg, verbose=verbose)


def assert_array_almost_equal(actual, desired, decimal=6, *args, **kwds):
    """Backwards compatible replacement. In new code, use xp_assert_close instead.
    """
    rtol, atol = 0, 1.5*10**(-decimal)
    return xp_assert_close(actual, desired,
                           atol=atol, rtol=rtol, check_dtype=False, check_shape=False,
                           *args, **kwds)


def assert_almost_equal(actual, desired, decimal=7, *args, **kwds):
    """Backwards compatible replacement. In new code, use xp_assert_close instead.
    """
    rtol, atol = 0, 1.5*10**(-decimal)
    return xp_assert_close(actual, desired,
                           atol=atol, rtol=rtol, check_dtype=False, check_shape=False,
                           *args, **kwds)


def xp_unsupported_param_msg(param: Any) -> str:
    return f'Providing {param!r} is only supported for numpy arrays.'


def is_complex(x: Array, xp: ModuleType) -> bool:
    return xp.isdtype(x.dtype, 'complex floating')


def scipy_namespace_for(xp: ModuleType) -> ModuleType | None:
    """Return the `scipy`-like namespace of a non-NumPy backend

    That is, return the namespace corresponding with backend `xp` that contains
    `scipy` sub-namespaces like `linalg` and `special`. If no such namespace
    exists, return ``None``. Useful for dispatching.
    """

    if is_cupy(xp):
        import cupyx  # type: ignore[import-not-found,import-untyped]
        return cupyx.scipy

    if is_jax(xp):
        import jax  # type: ignore[import-not-found]
        return jax.scipy

    if is_torch(xp):
        return xp

    return None


# maybe use `scipy.linalg` if/when array API support is added
def xp_vector_norm(x: Array, /, *,
                   axis: int | tuple[int] | None = None,
                   keepdims: bool = False,
                   ord: int | float = 2,
                   xp: ModuleType | None = None) -> Array:
    xp = array_namespace(x) if xp is None else xp

    if SCIPY_ARRAY_API:
        # check for optional `linalg` extension
        if hasattr(xp, 'linalg'):
            return xp.linalg.vector_norm(x, axis=axis, keepdims=keepdims, ord=ord)
        else:
            if ord != 2:
                raise ValueError(
                    "only the Euclidean norm (`ord=2`) is currently supported in "
                    "`xp_vector_norm` for backends not implementing the `linalg` "
                    "extension."
                )
            # return (x @ x)**0.5
            # or to get the right behavior with nd, complex arrays
            return xp.sum(xp.conj(x) * x, axis=axis, keepdims=keepdims)**0.5
    else:
        # to maintain backwards compatibility
        return np.linalg.norm(x, ord=ord, axis=axis, keepdims=keepdims)


def xp_ravel(x: Array, /, *, xp: ModuleType | None = None) -> Array:
    # Equivalent of np.ravel written in terms of array API
    # Even though it's one line, it comes up so often that it's worth having
    # this function for readability
    xp = array_namespace(x) if xp is None else xp
    return xp.reshape(x, (-1,))


def xp_swapaxes(a, axis1, axis2, xp=None):
    # Equivalent of np.swapaxes written in terms of array API
    xp = array_namespace(a) if xp is None else xp
    axes = list(range(a.ndim))
    axes[axis1], axes[axis2] = axes[axis2], axes[axis1]
    a = xp.permute_dims(a, axes)
    return a


# utility to find common dtype with option to force floating
def xp_result_type(*args, force_floating=False, xp):
    """
    Returns the dtype that results from applying type promotion rules
    (see Array API Standard Type Promotion Rules) to the arguments. Augments
    standard `result_type` in a few ways:

    - There is a `force_floating` argument that ensures that the result type
      is floating point, even when all args are integer.
    - When a TypeError is raised (e.g. due to an unsupported promotion)
      and `force_floating=True`, we define a custom rule: use the result type
      of the default float and any other floats passed. See
      https://github.com/scipy/scipy/pull/22695/files#r1997905891
      for rationale.
    - This function accepts array-like iterables, which are immediately converted
      to the namespace's arrays before result type calculation. Consequently, the
      result dtype may be different when an argument is `1.` vs `[1.]`.

    Typically, this function will be called shortly after `array_namespace`
    on a subset of the arguments passed to `array_namespace`.
    """
    args = [(_asarray(arg, subok=True, xp=xp) if np.iterable(arg) else arg)
            for arg in args]
    args_not_none = [arg for arg in args if arg is not None]
    if force_floating:
        args_not_none.append(1.0)

    if is_numpy(xp) and xp.__version__ < '2.0':
        # Follow NEP 50 promotion rules anyway
        args_not_none = [arg.dtype if getattr(arg, 'size', 0) == 1 else arg
                         for arg in args_not_none]
        return xp.result_type(*args_not_none)

    try:  # follow library's preferred promotion rules
        return xp.result_type(*args_not_none)
    except TypeError:  # mixed type promotion isn't defined
        if not force_floating:
            raise
        # use `result_type` of default floating point type and any floats present
        # This can be revisited, but right now, the only backends that get here
        # are array-api-strict (which is not for production use) and PyTorch
        # (due to data-apis/array-api-compat#279).
        float_args = []
        for arg in args_not_none:
            arg_array = xp.asarray(arg) if np.isscalar(arg) else arg
            dtype = getattr(arg_array, 'dtype', arg)
            if xp.isdtype(dtype, ('real floating', 'complex floating')):
                float_args.append(arg)
        return xp.result_type(*float_args, xp_default_dtype(xp))


def xp_promote(*args, broadcast=False, force_floating=False, xp):
    """
    Promotes elements of *args to result dtype, ignoring `None`s.
    Includes options for forcing promotion to floating point and
    broadcasting the arrays, again ignoring `None`s.
    Type promotion rules follow `xp_result_type` instead of `xp.result_type`.

    Typically, this function will be called shortly after `array_namespace`
    on a subset of the arguments passed to `array_namespace`.

    This function accepts array-like iterables, which are immediately converted
    to the namespace's arrays before result type calculation. Consequently, the
    result dtype may be different when an argument is `1.` vs `[1.]`.

    See Also
    --------
    xp_result_type
    """
    args = [(_asarray(arg, subok=True, xp=xp) if np.iterable(arg) else arg)
            for arg in args]  # solely to prevent double conversion of iterable to array

    dtype = xp_result_type(*args, force_floating=force_floating, xp=xp)

    args = [(_asarray(arg, dtype=dtype, subok=True, xp=xp) if arg is not None else arg)
            for arg in args]

    if not broadcast:
        return args[0] if len(args)==1 else tuple(args)

    args_not_none = [arg for arg in args if arg is not None]

    # determine result shape
    shapes = {arg.shape for arg in args_not_none}
    try:
        shape = (np.broadcast_shapes(*shapes) if len(shapes) != 1
                 else args_not_none[0].shape)
    except ValueError as e:
        message = "Array shapes are incompatible for broadcasting."
        raise ValueError(message) from e

    out = []
    for arg in args:
        if arg is None:
            out.append(arg)
            continue

        # broadcast only if needed
        # Even if two arguments need broadcasting, this is faster than
        # `broadcast_arrays`, especially since we've already determined `shape`
        if arg.shape != shape:
            kwargs = {'subok': True} if is_numpy(xp) else {}
            arg = xp.broadcast_to(arg, shape, **kwargs)

        # This is much faster than xp.astype(arg, dtype, copy=False)
        if arg.dtype != dtype:
            arg = xp.astype(arg, dtype)

        out.append(arg)

    return out[0] if len(out)==1 else tuple(out)


def xp_float_to_complex(arr: Array, xp: ModuleType | None = None) -> Array:
    xp = array_namespace(arr) if xp is None else xp
    arr_dtype = arr.dtype
    # The standard float dtypes are float32 and float64.
    # Convert float32 to complex64,
    # and float64 (and non-standard real dtypes) to complex128
    if xp.isdtype(arr_dtype, xp.float32):
        arr = xp.astype(arr, xp.complex64)
    elif xp.isdtype(arr_dtype, 'real floating'):
        arr = xp.astype(arr, xp.complex128)

    return arr


def xp_default_dtype(xp):
    """Query the namespace-dependent default floating-point dtype.
    """
    if is_torch(xp):
        # historically, we allow pytorch to keep its default of float32
        return xp.get_default_dtype()
    else:
        # we default to float64
        return xp.float64


def xp_result_device(*args):
    """Return the device of an array in `args`, for the purpose of
    input-output device propagation.
    If there are multiple devices, return an arbitrary one.
    If there are no arrays, return None (this typically happens only on NumPy).
    """
    for arg in args:
        # Do not do a duck-type test for the .device attribute, as many backends today
        # don't have it yet. See workarouunds in array_api_compat.device().
        if is_array_api_obj(arg):
            return xp_device(arg)
    return None


def is_marray(xp):
    """Returns True if `xp` is an MArray namespace; False otherwise."""
    return "marray" in xp.__name__


@dataclasses.dataclass(repr=False)
class _XPSphinxCapability:
    cpu: bool | None  # None if not applicable
    gpu: bool | None
    warnings: list[str] = dataclasses.field(default_factory=list)

    def _render(self, value):
        if value is None:
            return "n/a"
        if not value:
            return "⛔"
        if self.warnings:
            res = "⚠️ " + '; '.join(self.warnings)
            assert len(res) <= 20, "Warnings too long"
            return res
        return "✅"

    def __str__(self):
        cpu = self._render(self.cpu)
        gpu = self._render(self.gpu)
        return f"{cpu:20}  {gpu:20}"


def _make_sphinx_capabilities(
    # lists of tuples [(module name, reason), ...]
    skip_backends=(), xfail_backends=(),
    # @pytest.mark.skip/xfail_xp_backends kwargs
    cpu_only=False, np_only=False, exceptions=(),
    # xpx.lazy_xp_backends kwargs
    allow_dask_compute=False, jax_jit=True,
    # list of tuples [(module name, reason), ...]
    warnings = (),
    # unused in documentation
    reason=None,
):
    exceptions = set(exceptions)

    # Default capabilities
    capabilities = {
        "numpy": _XPSphinxCapability(cpu=True, gpu=None),
        "array_api_strict": _XPSphinxCapability(cpu=True, gpu=None),
        "cupy": _XPSphinxCapability(cpu=None, gpu=True),
        "torch": _XPSphinxCapability(cpu=True, gpu=True),
        "jax.numpy": _XPSphinxCapability(cpu=True, gpu=True,
            warnings=[] if jax_jit else ["no JIT"]),
        # Note: Dask+CuPy is currently untested and unsupported
        "dask.array": _XPSphinxCapability(cpu=True, gpu=None,
            warnings=["computes graph"] if allow_dask_compute else []),
    }

    # documentation doesn't display the reason
    for module, _ in list(skip_backends) + list(xfail_backends):
        backend = capabilities[module]
        if backend.cpu is not None:
            backend.cpu = False
        if backend.gpu is not None:
            backend.gpu = False

    for module, backend in capabilities.items():
        if np_only and module not in exceptions | {"numpy"}:
            if backend.cpu is not None:
                backend.cpu = False
            if backend.gpu is not None:
                backend.gpu = False
        elif cpu_only and module not in exceptions and backend.gpu is not None:
            backend.gpu = False

    for module, warning in warnings:
        backend = capabilities[module]
        backend.warnings.append(warning)

    return capabilities


def _make_capabilities_note(fun_name, capabilities):
    # Note: deliberately not documenting array-api-strict
    note = f"""
    `{fun_name}` has experimental support for Python Array API Standard compatible
    backends in addition to NumPy. Please consider testing these features
    by setting an environment variable ``SCIPY_ARRAY_API=1`` and providing
    CuPy, PyTorch, JAX, or Dask arrays as array arguments. The following
    combinations of backend and device (or other capability) are supported.

    ====================  ====================  ====================
    Library               CPU                   GPU
    ====================  ====================  ====================
    NumPy                 {capabilities['numpy']                   }
    CuPy                  {capabilities['cupy']                    }
    PyTorch               {capabilities['torch']                   }
    JAX                   {capabilities['jax.numpy']               }
    Dask                  {capabilities['dask.array']              }
    ====================  ====================  ====================

    See :ref:`dev-arrayapi` for more information.
    """
    return textwrap.dedent(note)


def xp_capabilities(
    *,
    # Alternative capabilities table.
    # Used only for testing this decorator.
    capabilities_table=None,
    # Generate pytest.mark.skip/xfail_xp_backends.
    # See documentation in conftest.py.
    # lists of tuples [(module name, reason), ...]
    skip_backends=(), xfail_backends=(),
    cpu_only=False, np_only=False, reason=None, exceptions=(),
    # lists of tuples [(module name, reason), ...]
    warnings=(),
    # xpx.testing.lazy_xp_function kwargs.
    # Refer to array-api-extra documentation.
    allow_dask_compute=False, jax_jit=True,
):
    """Decorator for a function that states its support among various
    Array API compatible backends.

    This decorator has two effects:
    1. It allows tagging tests with ``@make_xp_test_case`` or
       ``make_xp_pytest_param`` (see below) to automatically generate
       SKIP/XFAIL markers and perform additional backend-specific
       testing, such as extra validation for Dask and JAX;
    2. It automatically adds a note to the function's docstring, containing
       a table matching what has been tested.    

    See Also
    --------
    make_xp_test_case
    make_xp_pytest_param
    array_api_extra.testing.lazy_xp_function
    """
    capabilities_table = (xp_capabilities_table if capabilities_table is None
                          else capabilities_table)

    capabilities = dict(
        skip_backends=skip_backends,
        xfail_backends=xfail_backends,
        cpu_only=cpu_only,
        np_only=np_only,
        reason=reason,
        exceptions=exceptions,
        allow_dask_compute=allow_dask_compute,
        jax_jit=jax_jit,
        warnings=warnings,
    )
    sphinx_capabilities = _make_sphinx_capabilities(**capabilities)

    def decorator(f):
        # Don't use a wrapper, as in some cases @xp_capabilities is
        # applied to a ufunc
        capabilities_table[f] = capabilities
        note = _make_capabilities_note(f.__name__, sphinx_capabilities)
        doc = FunctionDoc(f)
        doc['Notes'].append(note)
        doc = str(doc).split("\n", 1)[1]  # remove signature
        try:
            f.__doc__ = doc
        except AttributeError:
            # Can't update __doc__ on ufuncs if SciPy
            # was compiled against NumPy < 2.2.
            pass

        return f
    return decorator


def _make_xp_pytest_marks(*funcs, capabilities_table=None):
    capabilities_table = (xp_capabilities_table if capabilities_table is None
                          else capabilities_table)
    import pytest
    from scipy._lib.array_api_extra.testing import lazy_xp_function

    marks = []
    for func in funcs:
        capabilities = capabilities_table[func]
        exceptions = capabilities['exceptions']
        reason = capabilities['reason']

        if capabilities['cpu_only']:
            marks.append(pytest.mark.skip_xp_backends(
                cpu_only=True, exceptions=exceptions, reason=reason))
        if capabilities['np_only']:
            marks.append(pytest.mark.skip_xp_backends(
                np_only=True, exceptions=exceptions, reason=reason))

        for mod_name, reason in capabilities['skip_backends']:
            marks.append(pytest.mark.skip_xp_backends(mod_name, reason=reason))
        for mod_name, reason in capabilities['xfail_backends']:
            marks.append(pytest.mark.xfail_xp_backends(mod_name, reason=reason))

        lazy_kwargs = {k: capabilities[k]
                       for k in ('allow_dask_compute', 'jax_jit')}
        lazy_xp_function(func, **lazy_kwargs)

    return marks


def make_xp_test_case(*funcs, capabilities_table=None):
    capabilities_table = (xp_capabilities_table if capabilities_table is None
                          else capabilities_table)
    """Generate pytest decorator for a test function that tests functionality
    of one or more Array API compatible functions.

    Read the parameters of the ``@xp_capabilities`` decorator applied to the
    listed functions and:

    - Generate the ``@pytest.mark.skip_xp_backends`` and
      ``@pytest.mark.xfail_xp_backends`` decorators
      for the decorated test function
    - Tag the function with `xpx.testing.lazy_xp_function`

    See Also
    --------
    xp_capabilities
    make_xp_pytest_param
    array_api_extra.testing.lazy_xp_function
    """
    marks = _make_xp_pytest_marks(*funcs, capabilities_table=capabilities_table)
    return lambda func: functools.reduce(lambda f, g: g(f), marks, func)


def make_xp_pytest_param(func, *args, capabilities_table=None):
    """Variant of ``make_xp_test_case`` that returns a pytest.param for a function,
    with all necessary skip_xp_backends and xfail_xp_backends marks applied::
    
        @pytest.mark.parametrize(
            "func", [make_xp_pytest_param(f1), make_xp_pytest_param(f2)]
        )
        def test(func, xp):
            ...

    The above is equivalent to::

        @pytest.mark.parametrize(
            "func", [
                pytest.param(f1, marks=[
                    pytest.mark.skip_xp_backends(...),
                    pytest.mark.xfail_xp_backends(...), ...]),
                pytest.param(f2, marks=[
                    pytest.mark.skip_xp_backends(...),
                    pytest.mark.xfail_xp_backends(...), ...]),
        )
        def test(func, xp):
            ...

    Parameters
    ----------
    func : Callable
        Function to be tested. It must be decorated with ``@xp_capabilities``.
    *args : Any, optional
        Extra pytest parameters for the use case, e.g.::

        @pytest.mark.parametrize("func,verb", [
            make_xp_pytest_param(f1, "hello"),
            make_xp_pytest_param(f2, "world")])
        def test(func, verb, xp):
            # iterates on (func=f1, verb="hello")
            # and (func=f2, verb="world")

    See Also
    --------
    xp_capabilities
    make_xp_test_case
    array_api_extra.testing.lazy_xp_function
    """
    import pytest

    marks = _make_xp_pytest_marks(func, capabilities_table=capabilities_table)
    return pytest.param(func, *args, marks=marks, id=func.__name__)


# Is it OK to have a dictionary that is mutated (once upon import) in many places?
xp_capabilities_table = {}  # type: ignore[var-annotated]
