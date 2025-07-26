"""
Testing utilities.

Note that this is private API; don't expect it to be stable.
See also ..testing for public testing utilities.
"""

from __future__ import annotations

import math
from types import ModuleType
from typing import Any, cast

import numpy as np
import pytest

from ._utils._compat import (
    array_namespace,
    is_array_api_strict_namespace,
    is_cupy_namespace,
    is_dask_namespace,
    is_jax_namespace,
    is_numpy_namespace,
    is_pydata_sparse_namespace,
    is_torch_namespace,
    to_device,
)
from ._utils._typing import Array, Device

__all__ = ["as_numpy_array", "xp_assert_close", "xp_assert_equal", "xp_assert_less"]


def _check_ns_shape_dtype(
    actual: Array,
    desired: Array,
    check_dtype: bool,
    check_shape: bool,
    check_scalar: bool,
) -> ModuleType:  # numpydoc ignore=RT03
    """
    Assert that namespace, shape and dtype of the two arrays match.

    Parameters
    ----------
    actual : Array
        The array produced by the tested function.
    desired : Array
        The expected array (typically hardcoded).
    check_dtype, check_shape : bool, default: True
        Whether to check agreement between actual and desired dtypes and shapes
    check_scalar : bool, default: False
        NumPy only: whether to check agreement between actual and desired types -
        0d array vs scalar.

    Returns
    -------
    Arrays namespace.
    """
    actual_xp = array_namespace(actual)  # Raises on scalars and lists
    desired_xp = array_namespace(desired)

    msg = f"namespaces do not match: {actual_xp} != f{desired_xp}"
    assert actual_xp == desired_xp, msg

    if check_shape:
        actual_shape = actual.shape
        desired_shape = desired.shape
        if is_dask_namespace(desired_xp):
            # Dask uses nan instead of None for unknown shapes
            if any(math.isnan(i) for i in cast(tuple[float, ...], actual_shape)):
                actual_shape = actual.compute().shape  # type: ignore[attr-defined]  # pyright: ignore[reportAttributeAccessIssue]
            if any(math.isnan(i) for i in cast(tuple[float, ...], desired_shape)):
                desired_shape = desired.compute().shape  # type: ignore[attr-defined]  # pyright: ignore[reportAttributeAccessIssue]

        msg = f"shapes do not match: {actual_shape} != f{desired_shape}"
        assert actual_shape == desired_shape, msg

    if check_dtype:
        msg = f"dtypes do not match: {actual.dtype} != {desired.dtype}"
        assert actual.dtype == desired.dtype, msg

    if is_numpy_namespace(actual_xp) and check_scalar:
        # only NumPy distinguishes between scalars and arrays; we do if check_scalar.
        _msg = (
            "array-ness does not match:\n Actual: "
            f"{type(actual)}\n Desired: {type(desired)}"
        )
        assert np.isscalar(actual) == np.isscalar(desired), _msg

    return desired_xp


def as_numpy_array(array: Array, *, xp: ModuleType) -> np.typing.NDArray[Any]:  # type: ignore[explicit-any]
    """
    Convert array to NumPy, bypassing GPU-CPU transfer guards and densification guards.
    """
    if is_cupy_namespace(xp):
        return xp.asnumpy(array)
    if is_pydata_sparse_namespace(xp):
        return array.todense()  # type: ignore[attr-defined]  # pyright: ignore[reportAttributeAccessIssue]

    if is_torch_namespace(xp):
        array = to_device(array, "cpu")
    if is_array_api_strict_namespace(xp):
        cpu: Device = xp.Device("CPU_DEVICE")
        array = to_device(array, cpu)
    if is_jax_namespace(xp):
        import jax

        # Note: only needed if the transfer guard is enabled
        cpu = cast(Device, jax.devices("cpu")[0])
        array = to_device(array, cpu)

    return np.asarray(array)


def xp_assert_equal(
    actual: Array,
    desired: Array,
    *,
    err_msg: str = "",
    check_dtype: bool = True,
    check_shape: bool = True,
    check_scalar: bool = False,
) -> None:
    """
    Array-API compatible version of `np.testing.assert_array_equal`.

    Parameters
    ----------
    actual : Array
        The array produced by the tested function.
    desired : Array
        The expected array (typically hardcoded).
    err_msg : str, optional
        Error message to display on failure.
    check_dtype, check_shape : bool, default: True
        Whether to check agreement between actual and desired dtypes and shapes
    check_scalar : bool, default: False
        NumPy only: whether to check agreement between actual and desired types -
        0d array vs scalar.

    See Also
    --------
    xp_assert_close : Similar function for inexact equality checks.
    numpy.testing.assert_array_equal : Similar function for NumPy arrays.
    """
    xp = _check_ns_shape_dtype(actual, desired, check_dtype, check_shape, check_scalar)
    actual_np = as_numpy_array(actual, xp=xp)
    desired_np = as_numpy_array(desired, xp=xp)
    np.testing.assert_array_equal(actual_np, desired_np, err_msg=err_msg)


def xp_assert_less(
    x: Array,
    y: Array,
    *,
    err_msg: str = "",
    check_dtype: bool = True,
    check_shape: bool = True,
    check_scalar: bool = False,
) -> None:
    """
    Array-API compatible version of `np.testing.assert_array_less`.

    Parameters
    ----------
    x, y : Array
        The arrays to compare according to ``x < y`` (elementwise).
    err_msg : str, optional
        Error message to display on failure.
    check_dtype, check_shape : bool, default: True
        Whether to check agreement between actual and desired dtypes and shapes
    check_scalar : bool, default: False
        NumPy only: whether to check agreement between actual and desired types -
        0d array vs scalar.

    See Also
    --------
    xp_assert_close : Similar function for inexact equality checks.
    numpy.testing.assert_array_equal : Similar function for NumPy arrays.
    """
    xp = _check_ns_shape_dtype(x, y, check_dtype, check_shape, check_scalar)
    x_np = as_numpy_array(x, xp=xp)
    y_np = as_numpy_array(y, xp=xp)
    np.testing.assert_array_less(x_np, y_np, err_msg=err_msg)


def xp_assert_close(
    actual: Array,
    desired: Array,
    *,
    rtol: float | None = None,
    atol: float = 0,
    err_msg: str = "",
    check_dtype: bool = True,
    check_shape: bool = True,
    check_scalar: bool = False,
) -> None:
    """
    Array-API compatible version of `np.testing.assert_allclose`.

    Parameters
    ----------
    actual : Array
        The array produced by the tested function.
    desired : Array
        The expected array (typically hardcoded).
    rtol : float, optional
        Relative tolerance. Default: dtype-dependent.
    atol : float, optional
        Absolute tolerance. Default: 0.
    err_msg : str, optional
        Error message to display on failure.
    check_dtype, check_shape : bool, default: True
        Whether to check agreement between actual and desired dtypes and shapes
    check_scalar : bool, default: False
        NumPy only: whether to check agreement between actual and desired types -
        0d array vs scalar.

    See Also
    --------
    xp_assert_equal : Similar function for exact equality checks.
    isclose : Public function for checking closeness.
    numpy.testing.assert_allclose : Similar function for NumPy arrays.

    Notes
    -----
    The default `atol` and `rtol` differ from `xp.all(xpx.isclose(a, b))`.
    """
    xp = _check_ns_shape_dtype(actual, desired, check_dtype, check_shape, check_scalar)

    if rtol is None:
        if xp.isdtype(actual.dtype, ("real floating", "complex floating")):
            # multiplier of 4 is used as for `np.float64` this puts the default `rtol`
            # roughly half way between sqrt(eps) and the default for
            # `numpy.testing.assert_allclose`, 1e-7
            rtol = xp.finfo(actual.dtype).eps ** 0.5 * 4
        else:
            rtol = 1e-7

    actual_np = as_numpy_array(actual, xp=xp)
    desired_np = as_numpy_array(desired, xp=xp)
    np.testing.assert_allclose(  # pyright: ignore[reportCallIssue]
        actual_np,
        desired_np,
        rtol=rtol,  # pyright: ignore[reportArgumentType]
        atol=atol,
        err_msg=err_msg,
    )


def xfail(
    request: pytest.FixtureRequest, *, reason: str, strict: bool | None = None
) -> None:
    """
    XFAIL the currently running test.

    Unlike ``pytest.xfail``, allow rest of test to execute instead of immediately
    halting it, so that it may result in a XPASS.
    xref https://github.com/pandas-dev/pandas/issues/38902

    Parameters
    ----------
    request : pytest.FixtureRequest
        ``request`` argument of the test function.
    reason : str
        Reason for the expected failure.
    strict: bool, optional
        If True, the test will be marked as failed if it passes.
        If False, the test will be marked as passed if it fails.
        Default: ``xfail_strict`` value in ``pyproject.toml``, or False if absent.
    """
    if strict is not None:
        marker = pytest.mark.xfail(reason=reason, strict=strict)
    else:
        marker = pytest.mark.xfail(reason=reason)
    request.node.add_marker(marker)
