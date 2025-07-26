"""Public API Functions."""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from functools import partial, wraps
from types import ModuleType
from typing import TYPE_CHECKING, Any, ParamSpec, TypeAlias, cast, overload

from ._funcs import broadcast_shapes
from ._utils import _compat
from ._utils._compat import (
    array_namespace,
    is_dask_namespace,
    is_jax_namespace,
)
from ._utils._helpers import is_python_scalar
from ._utils._typing import Array, DType

if TYPE_CHECKING:  # pragma: no cover
    import numpy as np
    from numpy.typing import ArrayLike

    NumPyObject: TypeAlias = np.ndarray[Any, Any] | np.generic  # type: ignore[explicit-any]
else:
    # Sphinx hack
    NumPyObject = Any

P = ParamSpec("P")


@overload
def lazy_apply(  # type: ignore[decorated-any, valid-type]
    func: Callable[P, Array | ArrayLike],
    *args: Array | complex | None,
    shape: tuple[int | None, ...] | None = None,
    dtype: DType | None = None,
    as_numpy: bool = False,
    xp: ModuleType | None = None,
    **kwargs: P.kwargs,  # pyright: ignore[reportGeneralTypeIssues]
) -> Array: ...  # numpydoc ignore=GL08


@overload
def lazy_apply(  # type: ignore[decorated-any, valid-type]
    func: Callable[P, Sequence[Array | ArrayLike]],
    *args: Array | complex | None,
    shape: Sequence[tuple[int | None, ...]],
    dtype: Sequence[DType] | None = None,
    as_numpy: bool = False,
    xp: ModuleType | None = None,
    **kwargs: P.kwargs,  # pyright: ignore[reportGeneralTypeIssues]
) -> tuple[Array, ...]: ...  # numpydoc ignore=GL08


def lazy_apply(  # type: ignore[valid-type]  # numpydoc ignore=GL07,SA04
    func: Callable[P, Array | ArrayLike | Sequence[Array | ArrayLike]],
    *args: Array | complex | None,
    shape: tuple[int | None, ...] | Sequence[tuple[int | None, ...]] | None = None,
    dtype: DType | Sequence[DType] | None = None,
    as_numpy: bool = False,
    xp: ModuleType | None = None,
    **kwargs: P.kwargs,  # pyright: ignore[reportGeneralTypeIssues]
) -> Array | tuple[Array, ...]:
    """
    Lazily apply an eager function.

    If the backend of the input arrays is lazy, e.g. Dask or jitted JAX, the execution
    of the function is delayed until the graph is materialized; if it's eager, the
    function is executed immediately.

    Parameters
    ----------
    func : callable
        The function to apply.

        It must accept one or more array API compliant arrays as positional arguments.
        If `as_numpy=True`, inputs are converted to NumPy before they are passed to
        `func`.
        It must return either a single array-like or a sequence of array-likes.

        `func` must be a pure function, i.e. without side effects, as depending on the
        backend it may be executed more than once or never.
    *args : Array | int | float | complex | bool | None
        One or more Array API compliant arrays, Python scalars, or None's.

        If `as_numpy=True`, you need to be able to apply :func:`numpy.asarray` to
        non-None args to convert them to NumPy; read notes below about specific
        backends.
    shape : tuple[int | None, ...] | Sequence[tuple[int | None, ...]], optional
        Output shape or sequence of output shapes, one for each output of `func`.
        Default: assume single output and broadcast shapes of the input arrays.
    dtype : DType | Sequence[DType], optional
        Output dtype or sequence of output dtypes, one for each output of `func`.
        dtype(s) must belong to the same array namespace as the input arrays.
        Default: infer the result type(s) from the input arrays.
    as_numpy : bool, optional
        If True, convert the input arrays to NumPy before passing them to `func`.
        This is particularly useful to make NumPy-only functions, e.g. written in Cython
       or Numba, work transparently with array API-compliant arrays.
        Default: False.
    xp : array_namespace, optional
        The standard-compatible namespace for `args`. Default: infer.
    **kwargs : Any, optional
        Additional keyword arguments to pass verbatim to `func`.
        They cannot contain Array objects.

    Returns
    -------
    Array | tuple[Array, ...]
        The result(s) of `func` applied to the input arrays, wrapped in the same
        array namespace as the inputs.
        If shape is omitted or a single `tuple[int | None, ...]`, return a single array.
        Otherwise, return a tuple of arrays.

    Notes
    -----
    JAX
        This allows applying eager functions to jitted JAX arrays, which are lazy.
        The function won't be applied until the JAX array is materialized.
        When running inside ``jax.jit``, `shape` must be fully known, i.e. it cannot
        contain any `None` elements.

        .. warning::

            `func` must never raise inside ``jax.jit``, as the resulting behavior is
            undefined.

        Using this with `as_numpy=False` is particularly useful to apply non-jittable
        JAX functions to arrays on GPU devices.
        If ``as_numpy=True``, the :doc:`jax:transfer_guard` may prevent arrays on a GPU
        device from being transferred back to CPU. This is treated as an implicit
        transfer.

    PyTorch, CuPy
        If ``as_numpy=True``, these backends raise by default if you attempt to convert
        arrays on a GPU device to NumPy.

    Sparse
        If ``as_numpy=True``, by default sparse prevents implicit densification through
        :func:`numpy.asarray`. `This safety mechanism can be disabled
        <https://sparse.pydata.org/en/stable/operations.html#package-configuration>`_.

    Dask
        This allows applying eager functions to Dask arrays.
        The Dask graph won't be computed until the user calls ``compute()`` or
        ``persist()`` down the line.

        The function name will be prominently visible on the user-facing Dask
        dashboard and on Prometheus metrics, so it is recommended for it to be
        meaningful.

        `lazy_apply` doesn't know if `func` reduces along any axes; also, shape
        changes are non-trivial in chunked Dask arrays. For these reasons, all inputs
        will be rechunked into a single chunk.

        .. warning::

           The whole operation needs to fit in memory all at once on a single worker.

        The outputs will also be returned as a single chunk and you should consider
        rechunking them into smaller chunks afterwards.

        If you want to distribute the calculation across multiple workers, you
        should use :func:`dask.array.map_blocks`, :func:`dask.array.map_overlap`,
        :func:`dask.array.blockwise`, or a native Dask wrapper instead of
        `lazy_apply`.

    Dask wrapping around other backends
        If ``as_numpy=False``, `func` will receive in input eager arrays of the meta
        namespace, as defined by the ``._meta`` attribute of the input Dask arrays.
        The outputs of `func` will be wrapped by the meta namespace, and then wrapped
        again by Dask.

    Raises
    ------
    ValueError
        When ``xp=jax.numpy``, the output `shape` is unknown (it contains ``None`` on
        one or more axes) and this function was called inside ``jax.jit``.
    RuntimeError
        When ``xp=sparse`` and auto-densification is disabled.
    Exception (backend-specific)
        When the backend disallows implicit device to host transfers and the input
        arrays are on a non-CPU device, e.g. on GPU.

    See Also
    --------
    jax.transfer_guard
    jax.pure_callback
    dask.array.map_blocks
    dask.array.map_overlap
    dask.array.blockwise
    """
    args_not_none = [arg for arg in args if arg is not None]
    array_args = [arg for arg in args_not_none if not is_python_scalar(arg)]
    if not array_args:
        msg = "Must have at least one argument array"
        raise ValueError(msg)
    if xp is None:
        xp = array_namespace(*args)

    # Normalize and validate shape and dtype
    shapes: list[tuple[int | None, ...]]
    dtypes: list[DType]
    multi_output = False

    if shape is None:
        shapes = [broadcast_shapes(*(arg.shape for arg in array_args))]
    elif all(isinstance(s, int | None) for s in shape):
        # Do not test for shape to be a tuple
        # https://github.com/data-apis/array-api/issues/891#issuecomment-2637430522
        shapes = [cast(tuple[int | None, ...], shape)]
    else:
        shapes = list(shape)  # type: ignore[arg-type]  # pyright: ignore[reportAssignmentType]
        multi_output = True

    if dtype is None:
        dtypes = [xp.result_type(*args_not_none)] * len(shapes)
    elif multi_output:
        if not isinstance(dtype, Sequence):
            msg = "Got multiple shapes but only one dtype"
            raise ValueError(msg)
        dtypes = list(dtype)  # pyright: ignore[reportUnknownArgumentType]
    else:
        if isinstance(dtype, Sequence):
            msg = "Got single shape but multiple dtypes"
            raise ValueError(msg)

        dtypes = [dtype]

    if len(shapes) != len(dtypes):
        msg = f"Got {len(shapes)} shapes and {len(dtypes)} dtypes"
        raise ValueError(msg)
    del shape
    del dtype
    # End of shape and dtype parsing

    # Backend-specific branches
    if is_dask_namespace(xp):
        import dask

        metas: list[Array] = [arg._meta for arg in array_args]  # pylint: disable=protected-access    # pyright: ignore[reportAttributeAccessIssue]
        meta_xp = array_namespace(*metas)

        wrapped = dask.delayed(  # type: ignore[attr-defined]  # pyright: ignore[reportPrivateImportUsage]
            _lazy_apply_wrapper(func, as_numpy, multi_output, meta_xp),
            pure=True,
        )
        # This finalizes each arg, which is the same as arg.rechunk(-1).
        # Please read docstring above for why we're not using
        # dask.array.map_blocks or dask.array.blockwise!
        delayed_out = wrapped(*args, **kwargs)

        out = tuple(
            xp.from_delayed(
                delayed_out[i],  # pyright: ignore[reportIndexIssue]
                # Dask's unknown shapes diverge from the Array API specification
                shape=tuple(math.nan if s is None else s for s in shape),
                dtype=dtype,
                meta=metas[0],
            )
            for i, (shape, dtype) in enumerate(zip(shapes, dtypes, strict=True))
        )

    elif is_jax_namespace(xp) and _is_jax_jit_enabled(xp):
        # Delay calling func with jax.pure_callback, which will forward to func eager
        # JAX arrays. Do not use jax.pure_callback when running outside of the JIT,
        # as it does not support raising exceptions:
        # https://github.com/jax-ml/jax/issues/26102
        import jax

        if any(None in shape for shape in shapes):
            msg = "Output shape must be fully known when running inside jax.jit"
            raise ValueError(msg)

        # Shield kwargs from being coerced into JAX arrays.
        # jax.pure_callback calls jax.jit under the hood, but without the chance of
        # passing static_argnames / static_argnums.
        wrapped = _lazy_apply_wrapper(
            partial(func, **kwargs), as_numpy, multi_output, xp
        )

        # suppress unused-ignore to run mypy in -e lint as well as -e dev
        out = cast(  # type: ignore[bad-cast,unused-ignore]
            tuple[Array, ...],
            jax.pure_callback(
                wrapped,
                tuple(
                    jax.ShapeDtypeStruct(shape, dtype)  # pyright: ignore[reportUnknownArgumentType]
                    for shape, dtype in zip(shapes, dtypes, strict=True)
                ),
                *args,
            ),
        )

    else:
        # Eager backends, including non-jitted JAX
        wrapped = _lazy_apply_wrapper(func, as_numpy, multi_output, xp)
        out = wrapped(*args, **kwargs)

    return out if multi_output else out[0]


def _is_jax_jit_enabled(xp: ModuleType) -> bool:  # numpydoc ignore=PR01,RT01
    """Return True if this function is being called inside ``jax.jit``."""
    import jax  # pylint: disable=import-outside-toplevel

    x = xp.asarray(False)
    try:
        return bool(x)
    except jax.errors.TracerBoolConversionError:
        return True


def _lazy_apply_wrapper(  # type: ignore[explicit-any]  # numpydoc ignore=PR01,RT01
    func: Callable[..., Array | ArrayLike | Sequence[Array | ArrayLike]],
    as_numpy: bool,
    multi_output: bool,
    xp: ModuleType,
) -> Callable[..., tuple[Array, ...]]:
    """
    Helper of `lazy_apply`.

    Given a function that accepts one or more arrays as positional arguments and returns
    a single array-like or a sequence of array-likes, return a function that accepts the
    same number of Array API arrays and always returns a tuple of Array API array.

    Any keyword arguments are passed through verbatim to the wrapped function.
    """

    # On Dask, @wraps causes the graph key to contain the wrapped function's name
    @wraps(func)
    def wrapper(  # type: ignore[decorated-any,explicit-any]
        *args: Array | complex | None, **kwargs: Any
    ) -> tuple[Array, ...]:  # numpydoc ignore=GL08
        args_list = []
        device = None
        for arg in args:
            if arg is not None and not is_python_scalar(arg):
                if device is None:
                    device = _compat.device(arg)
                if as_numpy:
                    import numpy as np

                    arg = cast(Array, np.asarray(arg))  # type: ignore[bad-cast]  # noqa: PLW2901
            args_list.append(arg)
        assert device is not None

        out = func(*args_list, **kwargs)

        if multi_output:
            assert isinstance(out, Sequence)
            return tuple(xp.asarray(o, device=device) for o in out)
        return (xp.asarray(out, device=device),)

    return wrapper
