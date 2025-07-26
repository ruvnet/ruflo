"""Array-agnostic implementations for the public API."""

import math
import warnings
from collections.abc import Callable, Sequence
from types import ModuleType, NoneType
from typing import cast, overload

from ._at import at
from ._utils import _compat, _helpers
from ._utils._compat import array_namespace, is_dask_namespace, is_jax_array
from ._utils._helpers import (
    asarrays,
    capabilities,
    eager_shape,
    meta_namespace,
    ndindex,
)
from ._utils._typing import Array

__all__ = [
    "apply_where",
    "atleast_nd",
    "broadcast_shapes",
    "cov",
    "create_diagonal",
    "expand_dims",
    "kron",
    "nunique",
    "pad",
    "setdiff1d",
    "sinc",
]


@overload
def apply_where(  # type: ignore[explicit-any,decorated-any] # numpydoc ignore=GL08
    cond: Array,
    args: Array | tuple[Array, ...],
    f1: Callable[..., Array],
    f2: Callable[..., Array],
    /,
    *,
    xp: ModuleType | None = None,
) -> Array: ...


@overload
def apply_where(  # type: ignore[explicit-any,decorated-any] # numpydoc ignore=GL08
    cond: Array,
    args: Array | tuple[Array, ...],
    f1: Callable[..., Array],
    /,
    *,
    fill_value: Array | complex,
    xp: ModuleType | None = None,
) -> Array: ...


def apply_where(  # type: ignore[explicit-any] # numpydoc ignore=PR01,PR02
    cond: Array,
    args: Array | tuple[Array, ...],
    f1: Callable[..., Array],
    f2: Callable[..., Array] | None = None,
    /,
    *,
    fill_value: Array | complex | None = None,
    xp: ModuleType | None = None,
) -> Array:
    """
    Run one of two elementwise functions depending on a condition.

    Equivalent to ``f1(*args) if cond else fill_value`` performed elementwise
    when `fill_value` is defined, otherwise to ``f1(*args) if cond else f2(*args)``.

    Parameters
    ----------
    cond : array
        The condition, expressed as a boolean array.
    args : Array or tuple of Arrays
        Argument(s) to `f1` (and `f2`). Must be broadcastable with `cond`.
    f1 : callable
        Elementwise function of `args`, returning a single array.
        Where `cond` is True, output will be ``f1(arg0[cond], arg1[cond], ...)``.
    f2 : callable, optional
        Elementwise function of `args`, returning a single array.
        Where `cond` is False, output will be ``f2(arg0[cond], arg1[cond], ...)``.
        Mutually exclusive with `fill_value`.
    fill_value : Array or scalar, optional
        If provided, value with which to fill output array where `cond` is False.
        It does not need to be scalar; it needs however to be broadcastable with
        `cond` and `args`.
        Mutually exclusive with `f2`. You must provide one or the other.
    xp : array_namespace, optional
        The standard-compatible namespace for `cond` and `args`. Default: infer.

    Returns
    -------
    Array
        An array with elements from the output of `f1` where `cond` is True and either
        the output of `f2` or `fill_value` where `cond` is False. The returned array has
        data type determined by type promotion rules between the output of `f1` and
        either `fill_value` or the output of `f2`.

    Notes
    -----
    ``xp.where(cond, f1(*args), f2(*args))`` requires explicitly evaluating `f1` even
    when `cond` is False, and `f2` when cond is True. This function evaluates each
    function only for their matching condition, if the backend allows for it.

    On Dask, `f1` and `f2` are applied to the individual chunks and should use functions
    from the namespace of the chunks.

    Examples
    --------
    >>> import array_api_strict as xp
    >>> import array_api_extra as xpx
    >>> a = xp.asarray([5, 4, 3])
    >>> b = xp.asarray([0, 2, 2])
    >>> def f(a, b):
    ...     return a // b
    >>> xpx.apply_where(b != 0, (a, b), f, fill_value=xp.nan)
    array([ nan,  2., 1.])
    """
    # Parse and normalize arguments
    if (f2 is None) == (fill_value is None):
        msg = "Exactly one of `fill_value` or `f2` must be given."
        raise TypeError(msg)
    args_ = list(args) if isinstance(args, tuple) else [args]
    del args

    xp = array_namespace(cond, fill_value, *args_) if xp is None else xp

    if isinstance(fill_value, int | float | complex | NoneType):
        cond, *args_ = xp.broadcast_arrays(cond, *args_)
    else:
        cond, fill_value, *args_ = xp.broadcast_arrays(cond, fill_value, *args_)

    if is_dask_namespace(xp):
        meta_xp = meta_namespace(cond, fill_value, *args_, xp=xp)
        # map_blocks doesn't descend into tuples of Arrays
        return xp.map_blocks(_apply_where, cond, f1, f2, fill_value, *args_, xp=meta_xp)
    return _apply_where(cond, f1, f2, fill_value, *args_, xp=xp)


def _apply_where(  # type: ignore[explicit-any]  # numpydoc ignore=PR01,RT01
    cond: Array,
    f1: Callable[..., Array],
    f2: Callable[..., Array] | None,
    fill_value: Array | int | float | complex | bool | None,
    *args: Array,
    xp: ModuleType,
) -> Array:
    """Helper of `apply_where`. On Dask, this runs on a single chunk."""

    if not capabilities(xp)["boolean indexing"]:
        # jax.jit does not support assignment by boolean mask
        return xp.where(cond, f1(*args), f2(*args) if f2 is not None else fill_value)

    temp1 = f1(*(arr[cond] for arr in args))

    if f2 is None:
        dtype = xp.result_type(temp1, fill_value)
        if isinstance(fill_value, int | float | complex):
            out = xp.full_like(cond, dtype=dtype, fill_value=fill_value)
        else:
            out = xp.astype(fill_value, dtype, copy=True)
    else:
        ncond = ~cond
        temp2 = f2(*(arr[ncond] for arr in args))
        dtype = xp.result_type(temp1, temp2)
        out = xp.empty_like(cond, dtype=dtype)
        out = at(out, ncond).set(temp2)

    return at(out, cond).set(temp1)


def atleast_nd(x: Array, /, *, ndim: int, xp: ModuleType | None = None) -> Array:
    """
    Recursively expand the dimension of an array to at least `ndim`.

    Parameters
    ----------
    x : array
        Input array.
    ndim : int
        The minimum number of dimensions for the result.
    xp : array_namespace, optional
        The standard-compatible namespace for `x`. Default: infer.

    Returns
    -------
    array
        An array with ``res.ndim`` >= `ndim`.
        If ``x.ndim`` >= `ndim`, `x` is returned.
        If ``x.ndim`` < `ndim`, `x` is expanded by prepending new axes
        until ``res.ndim`` equals `ndim`.

    Examples
    --------
    >>> import array_api_strict as xp
    >>> import array_api_extra as xpx
    >>> x = xp.asarray([1])
    >>> xpx.atleast_nd(x, ndim=3, xp=xp)
    Array([[[1]]], dtype=array_api_strict.int64)

    >>> x = xp.asarray([[[1, 2],
    ...                  [3, 4]]])
    >>> xpx.atleast_nd(x, ndim=1, xp=xp) is x
    True
    """
    if xp is None:
        xp = array_namespace(x)

    if x.ndim < ndim:
        x = xp.expand_dims(x, axis=0)
        x = atleast_nd(x, ndim=ndim, xp=xp)
    return x


# `float` in signature to accept `math.nan` for Dask.
# `int`s are still accepted as `float` is a superclass of `int` in typing
def broadcast_shapes(*shapes: tuple[float | None, ...]) -> tuple[int | None, ...]:
    """
    Compute the shape of the broadcasted arrays.

    Duplicates :func:`numpy.broadcast_shapes`, with additional support for
    None and NaN sizes.

    This is equivalent to ``xp.broadcast_arrays(arr1, arr2, ...)[0].shape``
    without needing to worry about the backend potentially deep copying
    the arrays.

    Parameters
    ----------
    *shapes : tuple[int | None, ...]
        Shapes of the arrays to broadcast.

    Returns
    -------
    tuple[int | None, ...]
        The shape of the broadcasted arrays.

    See Also
    --------
    numpy.broadcast_shapes : Equivalent NumPy function.
    array_api.broadcast_arrays : Function to broadcast actual arrays.

    Notes
    -----
    This function accepts the Array API's ``None`` for unknown sizes,
    as well as Dask's non-standard ``math.nan``.
    Regardless of input, the output always contains ``None`` for unknown sizes.

    Examples
    --------
    >>> import array_api_extra as xpx
    >>> xpx.broadcast_shapes((2, 3), (2, 1))
    (2, 3)
    >>> xpx.broadcast_shapes((4, 2, 3), (2, 1), (1, 3))
    (4, 2, 3)
    """
    if not shapes:
        return ()  # Match NumPy output

    ndim = max(len(shape) for shape in shapes)
    out: list[int | None] = []
    for axis in range(-ndim, 0):
        sizes = {shape[axis] for shape in shapes if axis >= -len(shape)}
        # Dask uses NaN for unknown shape, which predates the Array API spec for None
        none_size = None in sizes or math.nan in sizes
        sizes -= {1, None, math.nan}
        if len(sizes) > 1:
            msg = (
                "shape mismatch: objects cannot be broadcast to a single shape: "
                f"{shapes}."
            )
            raise ValueError(msg)
        out.append(None if none_size else cast(int, sizes.pop()) if sizes else 1)

    return tuple(out)


def cov(m: Array, /, *, xp: ModuleType | None = None) -> Array:
    """
    Estimate a covariance matrix.

    Covariance indicates the level to which two variables vary together.
    If we examine N-dimensional samples, :math:`X = [x_1, x_2, ... x_N]^T`,
    then the covariance matrix element :math:`C_{ij}` is the covariance of
    :math:`x_i` and :math:`x_j`. The element :math:`C_{ii}` is the variance
    of :math:`x_i`.

    This provides a subset of the functionality of ``numpy.cov``.

    Parameters
    ----------
    m : array
        A 1-D or 2-D array containing multiple variables and observations.
        Each row of `m` represents a variable, and each column a single
        observation of all those variables.
    xp : array_namespace, optional
        The standard-compatible namespace for `m`. Default: infer.

    Returns
    -------
    array
        The covariance matrix of the variables.

    Examples
    --------
    >>> import array_api_strict as xp
    >>> import array_api_extra as xpx

    Consider two variables, :math:`x_0` and :math:`x_1`, which
    correlate perfectly, but in opposite directions:

    >>> x = xp.asarray([[0, 2], [1, 1], [2, 0]]).T
    >>> x
    Array([[0, 1, 2],
           [2, 1, 0]], dtype=array_api_strict.int64)

    Note how :math:`x_0` increases while :math:`x_1` decreases. The covariance
    matrix shows this clearly:

    >>> xpx.cov(x, xp=xp)
    Array([[ 1., -1.],
           [-1.,  1.]], dtype=array_api_strict.float64)

    Note that element :math:`C_{0,1}`, which shows the correlation between
    :math:`x_0` and :math:`x_1`, is negative.

    Further, note how `x` and `y` are combined:

    >>> x = xp.asarray([-2.1, -1,  4.3])
    >>> y = xp.asarray([3,  1.1,  0.12])
    >>> X = xp.stack((x, y), axis=0)
    >>> xpx.cov(X, xp=xp)
    Array([[11.71      , -4.286     ],
           [-4.286     ,  2.14413333]], dtype=array_api_strict.float64)

    >>> xpx.cov(x, xp=xp)
    Array(11.71, dtype=array_api_strict.float64)

    >>> xpx.cov(y, xp=xp)
    Array(2.14413333, dtype=array_api_strict.float64)
    """
    if xp is None:
        xp = array_namespace(m)

    m = xp.asarray(m, copy=True)
    dtype = (
        xp.float64 if xp.isdtype(m.dtype, "integral") else xp.result_type(m, xp.float64)
    )

    m = atleast_nd(m, ndim=2, xp=xp)
    m = xp.astype(m, dtype)

    avg = _helpers.mean(m, axis=1, xp=xp)

    m_shape = eager_shape(m)
    fact = m_shape[1] - 1

    if fact <= 0:
        warnings.warn("Degrees of freedom <= 0 for slice", RuntimeWarning, stacklevel=2)
        fact = 0

    m -= avg[:, None]
    m_transpose = m.T
    if xp.isdtype(m_transpose.dtype, "complex floating"):
        m_transpose = xp.conj(m_transpose)
    c = m @ m_transpose
    c /= fact
    axes = tuple(axis for axis, length in enumerate(c.shape) if length == 1)
    return xp.squeeze(c, axis=axes)


def create_diagonal(
    x: Array, /, *, offset: int = 0, xp: ModuleType | None = None
) -> Array:
    """
    Construct a diagonal array.

    Parameters
    ----------
    x : array
        An array having shape ``(*batch_dims, k)``.
    offset : int, optional
        Offset from the leading diagonal (default is ``0``).
        Use positive ints for diagonals above the leading diagonal,
        and negative ints for diagonals below the leading diagonal.
    xp : array_namespace, optional
        The standard-compatible namespace for `x`. Default: infer.

    Returns
    -------
    array
        An array having shape ``(*batch_dims, k+abs(offset), k+abs(offset))`` with `x`
        on the diagonal (offset by `offset`).

    Examples
    --------
    >>> import array_api_strict as xp
    >>> import array_api_extra as xpx
    >>> x = xp.asarray([2, 4, 8])

    >>> xpx.create_diagonal(x, xp=xp)
    Array([[2, 0, 0],
           [0, 4, 0],
           [0, 0, 8]], dtype=array_api_strict.int64)

    >>> xpx.create_diagonal(x, offset=-2, xp=xp)
    Array([[0, 0, 0, 0, 0],
           [0, 0, 0, 0, 0],
           [2, 0, 0, 0, 0],
           [0, 4, 0, 0, 0],
           [0, 0, 8, 0, 0]], dtype=array_api_strict.int64)
    """
    if xp is None:
        xp = array_namespace(x)

    if x.ndim == 0:
        err_msg = "`x` must be at least 1-dimensional."
        raise ValueError(err_msg)

    x_shape = eager_shape(x)
    batch_dims = x_shape[:-1]
    n = x_shape[-1] + abs(offset)
    diag = xp.zeros((*batch_dims, n**2), dtype=x.dtype, device=_compat.device(x))

    target_slice = slice(
        offset if offset >= 0 else abs(offset) * n,
        min(n * (n - offset), diag.shape[-1]),
        n + 1,
    )
    for index in ndindex(*batch_dims):
        diag = at(diag)[(*index, target_slice)].set(x[(*index, slice(None))])
    return xp.reshape(diag, (*batch_dims, n, n))


def expand_dims(
    a: Array, /, *, axis: int | tuple[int, ...] = (0,), xp: ModuleType | None = None
) -> Array:
    """
    Expand the shape of an array.

    Insert (a) new axis/axes that will appear at the position(s) specified by
    `axis` in the expanded array shape.

    This is ``xp.expand_dims`` for `axis` an int *or a tuple of ints*.
    Roughly equivalent to ``numpy.expand_dims`` for NumPy arrays.

    Parameters
    ----------
    a : array
        Array to have its shape expanded.
    axis : int or tuple of ints, optional
        Position(s) in the expanded axes where the new axis (or axes) is/are placed.
        If multiple positions are provided, they should be unique (note that a position
        given by a positive index could also be referred to by a negative index -
        that will also result in an error).
        Default: ``(0,)``.
    xp : array_namespace, optional
        The standard-compatible namespace for `a`. Default: infer.

    Returns
    -------
    array
        `a` with an expanded shape.

    Examples
    --------
    >>> import array_api_strict as xp
    >>> import array_api_extra as xpx
    >>> x = xp.asarray([1, 2])
    >>> x.shape
    (2,)

    The following is equivalent to ``x[xp.newaxis, :]`` or ``x[xp.newaxis]``:

    >>> y = xpx.expand_dims(x, axis=0, xp=xp)
    >>> y
    Array([[1, 2]], dtype=array_api_strict.int64)
    >>> y.shape
    (1, 2)

    The following is equivalent to ``x[:, xp.newaxis]``:

    >>> y = xpx.expand_dims(x, axis=1, xp=xp)
    >>> y
    Array([[1],
           [2]], dtype=array_api_strict.int64)
    >>> y.shape
    (2, 1)

    ``axis`` may also be a tuple:

    >>> y = xpx.expand_dims(x, axis=(0, 1), xp=xp)
    >>> y
    Array([[[1, 2]]], dtype=array_api_strict.int64)

    >>> y = xpx.expand_dims(x, axis=(2, 0), xp=xp)
    >>> y
    Array([[[1],
            [2]]], dtype=array_api_strict.int64)
    """
    if xp is None:
        xp = array_namespace(a)

    if not isinstance(axis, tuple):
        axis = (axis,)
    ndim = a.ndim + len(axis)
    if axis != () and (min(axis) < -ndim or max(axis) >= ndim):
        err_msg = (
            f"a provided axis position is out of bounds for array of dimension {a.ndim}"
        )
        raise IndexError(err_msg)
    axis = tuple(dim % ndim for dim in axis)
    if len(set(axis)) != len(axis):
        err_msg = "Duplicate dimensions specified in `axis`."
        raise ValueError(err_msg)
    for i in sorted(axis):
        a = xp.expand_dims(a, axis=i)
    return a


def isclose(
    a: Array | complex,
    b: Array | complex,
    *,
    rtol: float = 1e-05,
    atol: float = 1e-08,
    equal_nan: bool = False,
    xp: ModuleType,
) -> Array:  # numpydoc ignore=PR01,RT01
    """See docstring in array_api_extra._delegation."""
    a, b = asarrays(a, b, xp=xp)

    a_inexact = xp.isdtype(a.dtype, ("real floating", "complex floating"))
    b_inexact = xp.isdtype(b.dtype, ("real floating", "complex floating"))
    if a_inexact or b_inexact:
        # prevent warnings on NumPy and Dask on inf - inf
        mxp = meta_namespace(a, b, xp=xp)
        out = apply_where(
            xp.isinf(a) | xp.isinf(b),
            (a, b),
            lambda a, b: mxp.isinf(a) & mxp.isinf(b) & (mxp.sign(a) == mxp.sign(b)),  # pyright: ignore[reportUnknownArgumentType]
            # Note: inf <= inf is True!
            lambda a, b: mxp.abs(a - b) <= (atol + rtol * mxp.abs(b)),  # pyright: ignore[reportUnknownArgumentType]
            xp=xp,
        )
        if equal_nan:
            out = xp.where(xp.isnan(a) & xp.isnan(b), True, out)
        return out

    if xp.isdtype(a.dtype, "bool") or xp.isdtype(b.dtype, "bool"):
        if atol >= 1 or rtol >= 1:
            return xp.ones_like(a == b)
        return a == b

    # integer types
    atol = int(atol)
    if rtol == 0:
        return xp.abs(a - b) <= atol

    # Don't rely on OverflowError, as it is not guaranteed by the Array API.
    nrtol = int(1.0 / rtol)
    if nrtol > xp.iinfo(b.dtype).max:
        # rtol * max_int < 1, so it's inconsequential
        return xp.abs(a - b) <= atol
    return xp.abs(a - b) <= (atol + xp.abs(b) // nrtol)


def kron(
    a: Array | complex,
    b: Array | complex,
    /,
    *,
    xp: ModuleType | None = None,
) -> Array:
    """
    Kronecker product of two arrays.

    Computes the Kronecker product, a composite array made of blocks of the
    second array scaled by the first.

    Equivalent to ``numpy.kron`` for NumPy arrays.

    Parameters
    ----------
    a, b : Array | int | float | complex
        Input arrays or scalars. At least one must be an array.
    xp : array_namespace, optional
        The standard-compatible namespace for `a` and `b`. Default: infer.

    Returns
    -------
    array
        The Kronecker product of `a` and `b`.

    Notes
    -----
    The function assumes that the number of dimensions of `a` and `b`
    are the same, if necessary prepending the smallest with ones.
    If ``a.shape = (r0,r1,..,rN)`` and ``b.shape = (s0,s1,...,sN)``,
    the Kronecker product has shape ``(r0*s0, r1*s1, ..., rN*SN)``.
    The elements are products of elements from `a` and `b`, organized
    explicitly by::

        kron(a,b)[k0,k1,...,kN] = a[i0,i1,...,iN] * b[j0,j1,...,jN]

    where::

        kt = it * st + jt,  t = 0,...,N

    In the common 2-D case (N=1), the block structure can be visualized::

        [[ a[0,0]*b,   a[0,1]*b,  ... , a[0,-1]*b  ],
         [  ...                              ...   ],
         [ a[-1,0]*b,  a[-1,1]*b, ... , a[-1,-1]*b ]]

    Examples
    --------
    >>> import array_api_strict as xp
    >>> import array_api_extra as xpx
    >>> xpx.kron(xp.asarray([1, 10, 100]), xp.asarray([5, 6, 7]), xp=xp)
    Array([  5,   6,   7,  50,  60,  70, 500,
           600, 700], dtype=array_api_strict.int64)

    >>> xpx.kron(xp.asarray([5, 6, 7]), xp.asarray([1, 10, 100]), xp=xp)
    Array([  5,  50, 500,   6,  60, 600,   7,
            70, 700], dtype=array_api_strict.int64)

    >>> xpx.kron(xp.eye(2), xp.ones((2, 2)), xp=xp)
    Array([[1., 1., 0., 0.],
           [1., 1., 0., 0.],
           [0., 0., 1., 1.],
           [0., 0., 1., 1.]], dtype=array_api_strict.float64)

    >>> a = xp.reshape(xp.arange(100), (2, 5, 2, 5))
    >>> b = xp.reshape(xp.arange(24), (2, 3, 4))
    >>> c = xpx.kron(a, b, xp=xp)
    >>> c.shape
    (2, 10, 6, 20)
    >>> I = (1, 3, 0, 2)
    >>> J = (0, 2, 1)
    >>> J1 = (0,) + J             # extend to ndim=4
    >>> S1 = (1,) + b.shape
    >>> K = tuple(xp.asarray(I) * xp.asarray(S1) + xp.asarray(J1))
    >>> c[K] == a[I]*b[J]
    Array(True, dtype=array_api_strict.bool)
    """
    if xp is None:
        xp = array_namespace(a, b)
    a, b = asarrays(a, b, xp=xp)

    singletons = (1,) * (b.ndim - a.ndim)
    a = cast(Array, xp.broadcast_to(a, singletons + a.shape))

    nd_b, nd_a = b.ndim, a.ndim
    nd_max = max(nd_b, nd_a)
    if nd_a == 0 or nd_b == 0:
        return xp.multiply(a, b)

    a_shape = eager_shape(a)
    b_shape = eager_shape(b)

    # Equalise the shapes by prepending smaller one with 1s
    a_shape = (1,) * max(0, nd_b - nd_a) + a_shape
    b_shape = (1,) * max(0, nd_a - nd_b) + b_shape

    # Insert empty dimensions
    a_arr = expand_dims(a, axis=tuple(range(nd_b - nd_a)), xp=xp)
    b_arr = expand_dims(b, axis=tuple(range(nd_a - nd_b)), xp=xp)

    # Compute the product
    a_arr = expand_dims(a_arr, axis=tuple(range(1, nd_max * 2, 2)), xp=xp)
    b_arr = expand_dims(b_arr, axis=tuple(range(0, nd_max * 2, 2)), xp=xp)
    result = xp.multiply(a_arr, b_arr)

    # Reshape back and return
    res_shape = tuple(a_s * b_s for a_s, b_s in zip(a_shape, b_shape, strict=True))
    return xp.reshape(result, res_shape)


def nunique(x: Array, /, *, xp: ModuleType | None = None) -> Array:
    """
    Count the number of unique elements in an array.

    Compatible with JAX and Dask, whose laziness would be otherwise
    problematic.

    Parameters
    ----------
    x : Array
        Input array.
    xp : array_namespace, optional
        The standard-compatible namespace for `x`. Default: infer.

    Returns
    -------
    array: 0-dimensional integer array
        The number of unique elements in `x`. It can be lazy.
    """
    if xp is None:
        xp = array_namespace(x)

    if is_jax_array(x):
        # size= is JAX-specific
        # https://github.com/data-apis/array-api/issues/883
        _, counts = xp.unique_counts(x, size=_compat.size(x))
        return (counts > 0).sum()

    # There are 3 general use cases:
    # 1. backend has unique_counts and it returns an array with known shape
    # 2. backend has unique_counts and it returns a None-sized array;
    #    e.g. Dask, ndonnx
    # 3. backend does not have unique_counts; e.g. wrapped JAX
    if capabilities(xp)["data-dependent shapes"]:
        # xp has unique_counts; O(n) complexity
        _, counts = xp.unique_counts(x)
        n = _compat.size(counts)
        if n is None:
            return xp.sum(xp.ones_like(counts))
        return xp.asarray(n, device=_compat.device(x))

    # xp does not have unique_counts; O(n*logn) complexity
    x = xp.reshape(x, (-1,))
    x = xp.sort(x)
    mask = x != xp.roll(x, -1)
    default_int = xp.__array_namespace_info__().default_dtypes(
        device=_compat.device(x)
    )["integral"]
    return xp.maximum(
        # Special cases:
        # - array is size 0
        # - array has all elements equal to each other
        xp.astype(xp.any(~mask), default_int),
        xp.sum(xp.astype(mask, default_int)),
    )


def pad(
    x: Array,
    pad_width: int | tuple[int, int] | Sequence[tuple[int, int]],
    *,
    constant_values: complex = 0,
    xp: ModuleType,
) -> Array:  # numpydoc ignore=PR01,RT01
    """See docstring in `array_api_extra._delegation.py`."""
    # make pad_width a list of length-2 tuples of ints
    if isinstance(pad_width, int):
        pad_width_seq = [(pad_width, pad_width)] * x.ndim
    elif (
        isinstance(pad_width, tuple)
        and len(pad_width) == 2
        and all(isinstance(i, int) for i in pad_width)
    ):
        pad_width_seq = [cast(tuple[int, int], pad_width)] * x.ndim
    else:
        pad_width_seq = cast(list[tuple[int, int]], list(pad_width))

    # https://github.com/python/typeshed/issues/13376
    slices: list[slice] = []  # type: ignore[explicit-any]
    newshape: list[int] = []
    for ax, w_tpl in enumerate(pad_width_seq):
        if len(w_tpl) != 2:
            msg = f"expect a 2-tuple (before, after), got {w_tpl}."
            raise ValueError(msg)

        sh = eager_shape(x)[ax]

        if w_tpl[0] == 0 and w_tpl[1] == 0:
            sl = slice(None, None, None)
        else:
            start, stop = w_tpl
            stop = None if stop == 0 else -stop

            sl = slice(start, stop, None)
            sh += w_tpl[0] + w_tpl[1]

        newshape.append(sh)
        slices.append(sl)

    padded = xp.full(
        tuple(newshape),
        fill_value=constant_values,
        dtype=x.dtype,
        device=_compat.device(x),
    )
    return at(padded, tuple(slices)).set(x)


def setdiff1d(
    x1: Array | complex,
    x2: Array | complex,
    /,
    *,
    assume_unique: bool = False,
    xp: ModuleType | None = None,
) -> Array:
    """
    Find the set difference of two arrays.

    Return the unique values in `x1` that are not in `x2`.

    Parameters
    ----------
    x1 : array | int | float | complex | bool
        Input array.
    x2 : array
        Input comparison array.
    assume_unique : bool
        If ``True``, the input arrays are both assumed to be unique, which
        can speed up the calculation. Default is ``False``.
    xp : array_namespace, optional
        The standard-compatible namespace for `x1` and `x2`. Default: infer.

    Returns
    -------
    array
        1D array of values in `x1` that are not in `x2`. The result
        is sorted when `assume_unique` is ``False``, but otherwise only sorted
        if the input is sorted.

    Examples
    --------
    >>> import array_api_strict as xp
    >>> import array_api_extra as xpx

    >>> x1 = xp.asarray([1, 2, 3, 2, 4, 1])
    >>> x2 = xp.asarray([3, 4, 5, 6])
    >>> xpx.setdiff1d(x1, x2, xp=xp)
    Array([1, 2], dtype=array_api_strict.int64)
    """
    if xp is None:
        xp = array_namespace(x1, x2)
    # https://github.com/microsoft/pyright/issues/10103
    x1_, x2_ = asarrays(x1, x2, xp=xp)

    if assume_unique:
        x1_ = xp.reshape(x1_, (-1,))
        x2_ = xp.reshape(x2_, (-1,))
    else:
        x1_ = xp.unique_values(x1_)
        x2_ = xp.unique_values(x2_)

    return x1_[_helpers.in1d(x1_, x2_, assume_unique=True, invert=True, xp=xp)]


def sinc(x: Array, /, *, xp: ModuleType | None = None) -> Array:
    r"""
    Return the normalized sinc function.

    The sinc function is equal to :math:`\sin(\pi x)/(\pi x)` for any argument
    :math:`x\ne 0`. ``sinc(0)`` takes the limit value 1, making ``sinc`` not
    only everywhere continuous but also infinitely differentiable.

    .. note::

        Note the normalization factor of ``pi`` used in the definition.
        This is the most commonly used definition in signal processing.
        Use ``sinc(x / xp.pi)`` to obtain the unnormalized sinc function
        :math:`\sin(x)/x` that is more common in mathematics.

    Parameters
    ----------
    x : array
        Array (possibly multi-dimensional) of values for which to calculate
        ``sinc(x)``. Must have a real floating point dtype.
    xp : array_namespace, optional
        The standard-compatible namespace for `x`. Default: infer.

    Returns
    -------
    array
        ``sinc(x)`` calculated elementwise, which has the same shape as the input.

    Notes
    -----
    The name sinc is short for "sine cardinal" or "sinus cardinalis".

    The sinc function is used in various signal processing applications,
    including in anti-aliasing, in the construction of a Lanczos resampling
    filter, and in interpolation.

    For bandlimited interpolation of discrete-time signals, the ideal
    interpolation kernel is proportional to the sinc function.

    References
    ----------
    #. Weisstein, Eric W. "Sinc Function." From MathWorld--A Wolfram Web
       Resource. https://mathworld.wolfram.com/SincFunction.html
    #. Wikipedia, "Sinc function",
       https://en.wikipedia.org/wiki/Sinc_function

    Examples
    --------
    >>> import array_api_strict as xp
    >>> import array_api_extra as xpx
    >>> x = xp.linspace(-4, 4, 41)
    >>> xpx.sinc(x, xp=xp)
    Array([-3.89817183e-17, -4.92362781e-02,
           -8.40918587e-02, -8.90384387e-02,
           -5.84680802e-02,  3.89817183e-17,
            6.68206631e-02,  1.16434881e-01,
            1.26137788e-01,  8.50444803e-02,
           -3.89817183e-17, -1.03943254e-01,
           -1.89206682e-01, -2.16236208e-01,
           -1.55914881e-01,  3.89817183e-17,
            2.33872321e-01,  5.04551152e-01,
            7.56826729e-01,  9.35489284e-01,
            1.00000000e+00,  9.35489284e-01,
            7.56826729e-01,  5.04551152e-01,
            2.33872321e-01,  3.89817183e-17,
           -1.55914881e-01, -2.16236208e-01,
           -1.89206682e-01, -1.03943254e-01,
           -3.89817183e-17,  8.50444803e-02,
            1.26137788e-01,  1.16434881e-01,
            6.68206631e-02,  3.89817183e-17,
           -5.84680802e-02, -8.90384387e-02,
           -8.40918587e-02, -4.92362781e-02,
           -3.89817183e-17], dtype=array_api_strict.float64)
    """
    if xp is None:
        xp = array_namespace(x)

    if not xp.isdtype(x.dtype, "real floating"):
        err_msg = "`x` must have a real floating data type."
        raise ValueError(err_msg)
    # no scalars in `where` - array-api#807
    y = xp.pi * xp.where(
        xp.astype(x, xp.bool),
        x,
        xp.asarray(xp.finfo(x.dtype).eps, dtype=x.dtype, device=_compat.device(x)),
    )
    return xp.sin(y) / y
