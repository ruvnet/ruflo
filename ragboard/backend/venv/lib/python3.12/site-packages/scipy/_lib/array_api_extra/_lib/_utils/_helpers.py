"""Helper functions used by `array_api_extra/_funcs.py`."""

from __future__ import annotations

import io
import math
import pickle
import types
from collections.abc import Callable, Generator, Iterable
from functools import wraps
from types import ModuleType
from typing import (
    TYPE_CHECKING,
    Any,
    ClassVar,
    Generic,
    Literal,
    ParamSpec,
    TypeAlias,
    TypeVar,
    cast,
)

from . import _compat
from ._compat import (
    array_namespace,
    is_array_api_obj,
    is_dask_namespace,
    is_jax_namespace,
    is_numpy_array,
    is_pydata_sparse_namespace,
)
from ._typing import Array

if TYPE_CHECKING:  # pragma: no cover
    # TODO import from typing (requires Python >=3.12 and >=3.13)
    from typing_extensions import TypeIs, override
else:

    def override(func):
        return func


P = ParamSpec("P")
T = TypeVar("T")


__all__ = [
    "asarrays",
    "capabilities",
    "eager_shape",
    "in1d",
    "is_python_scalar",
    "jax_autojit",
    "mean",
    "meta_namespace",
    "pickle_flatten",
    "pickle_unflatten",
]


def in1d(
    x1: Array,
    x2: Array,
    /,
    *,
    assume_unique: bool = False,
    invert: bool = False,
    xp: ModuleType | None = None,
) -> Array:  # numpydoc ignore=PR01,RT01
    """
    Check whether each element of an array is also present in a second array.

    Returns a boolean array the same length as `x1` that is True
    where an element of `x1` is in `x2` and False otherwise.

    This function has been adapted using the original implementation
    present in numpy:
    https://github.com/numpy/numpy/blob/v1.26.0/numpy/lib/arraysetops.py#L524-L758
    """
    if xp is None:
        xp = array_namespace(x1, x2)

    x1_shape = eager_shape(x1)
    x2_shape = eager_shape(x2)

    # This code is run to make the code significantly faster
    if x2_shape[0] < 10 * x1_shape[0] ** 0.145 and isinstance(x2, Iterable):
        if invert:
            mask = xp.ones(x1_shape[0], dtype=xp.bool, device=_compat.device(x1))
            for a in x2:
                mask &= x1 != a
        else:
            mask = xp.zeros(x1_shape[0], dtype=xp.bool, device=_compat.device(x1))
            for a in x2:
                mask |= x1 == a
        return mask

    rev_idx = xp.empty(0)  # placeholder
    if not assume_unique:
        x1, rev_idx = xp.unique_inverse(x1)
        x2 = xp.unique_values(x2)

    ar = xp.concat((x1, x2))
    device_ = _compat.device(ar)
    # We need this to be a stable sort.
    order = xp.argsort(ar, stable=True)
    reverse_order = xp.argsort(order, stable=True)
    sar = xp.take(ar, order, axis=0)
    ar_size = _compat.size(sar)
    assert ar_size is not None, "xp.unique*() on lazy backends raises"
    if ar_size >= 1:
        bool_ar = sar[1:] != sar[:-1] if invert else sar[1:] == sar[:-1]
    else:
        bool_ar = xp.asarray([False]) if invert else xp.asarray([True])
    flag = xp.concat((bool_ar, xp.asarray([invert], device=device_)))
    ret = xp.take(flag, reverse_order, axis=0)

    if assume_unique:
        return ret[: x1.shape[0]]
    return xp.take(ret, rev_idx, axis=0)


def mean(
    x: Array,
    /,
    *,
    axis: int | tuple[int, ...] | None = None,
    keepdims: bool = False,
    xp: ModuleType | None = None,
) -> Array:  # numpydoc ignore=PR01,RT01
    """
    Complex mean, https://github.com/data-apis/array-api/issues/846.
    """
    if xp is None:
        xp = array_namespace(x)

    if xp.isdtype(x.dtype, "complex floating"):
        x_real = xp.real(x)
        x_imag = xp.imag(x)
        mean_real = xp.mean(x_real, axis=axis, keepdims=keepdims)
        mean_imag = xp.mean(x_imag, axis=axis, keepdims=keepdims)
        return mean_real + (mean_imag * xp.asarray(1j))
    return xp.mean(x, axis=axis, keepdims=keepdims)


def is_python_scalar(x: object) -> TypeIs[complex]:  # numpydoc ignore=PR01,RT01
    """Return True if `x` is a Python scalar, False otherwise."""
    # isinstance(x, float) returns True for np.float64
    # isinstance(x, complex) returns True for np.complex128
    # bool is a subclass of int
    return isinstance(x, int | float | complex) and not is_numpy_array(x)


def asarrays(
    a: Array | complex,
    b: Array | complex,
    xp: ModuleType,
) -> tuple[Array, Array]:
    """
    Ensure both `a` and `b` are arrays.

    If `b` is a python scalar, it is converted to the same dtype as `a`, and vice versa.

    Behavior is not specified when mixing a Python ``float`` and an array with an
    integer data type; this may give ``float32``, ``float64``, or raise an exception.
    Behavior is implementation-specific.

    Similarly, behavior is not specified when mixing a Python ``complex`` and an array
    with a real-valued data type; this may give ``complex64``, ``complex128``, or raise
    an exception. Behavior is implementation-specific.

    Parameters
    ----------
    a, b : Array | int | float | complex | bool
        Input arrays or scalars. At least one must be an array.
    xp : array_namespace, optional
        The standard-compatible namespace for `x`. Default: infer.

    Returns
    -------
    Array, Array
        The input arrays, possibly converted to arrays if they were scalars.

    See Also
    --------
    mixing-arrays-with-python-scalars : Array API specification for the behavior.
    """
    a_scalar = is_python_scalar(a)
    b_scalar = is_python_scalar(b)
    if not a_scalar and not b_scalar:
        # This includes misc. malformed input e.g. str
        return a, b  # type: ignore[return-value]

    swap = False
    if a_scalar:
        swap = True
        b, a = a, b

    if is_array_api_obj(a):
        # a is an Array API object
        # b is a int | float | complex | bool
        xa = a

        # https://data-apis.org/array-api/draft/API_specification/type_promotion.html#mixing-arrays-with-python-scalars
        same_dtype = {
            bool: "bool",
            int: ("integral", "real floating", "complex floating"),
            float: ("real floating", "complex floating"),
            complex: "complex floating",
        }
        kind = same_dtype[type(cast(complex, b))]  # type: ignore[index]
        if xp.isdtype(a.dtype, kind):
            xb = xp.asarray(b, dtype=a.dtype)
        else:
            # Undefined behaviour. Let the function deal with it, if it can.
            xb = xp.asarray(b)

    else:
        # Neither a nor b are Array API objects.
        # Note: we can only reach this point when one explicitly passes
        # xp=xp to the calling function; otherwise we fail earlier on
        # array_namespace(a, b).
        xa, xb = xp.asarray(a), xp.asarray(b)

    return (xb, xa) if swap else (xa, xb)


def ndindex(*x: int) -> Generator[tuple[int, ...]]:
    """
    Generate all N-dimensional indices for a given array shape.

    Given the shape of an array, an ndindex instance iterates over the N-dimensional
    index of the array. At each iteration a tuple of indices is returned, the last
    dimension is iterated over first.

    This has an identical API to numpy.ndindex.

    Parameters
    ----------
    *x : int
        The shape of the array.
    """
    if not x:
        yield ()
        return
    for i in ndindex(*x[:-1]):
        for j in range(x[-1]):
            yield *i, j


def eager_shape(x: Array, /) -> tuple[int, ...]:
    """
    Return shape of an array. Raise if shape is not fully defined.

    Parameters
    ----------
    x : Array
        Input array.

    Returns
    -------
    tuple[int, ...]
        Shape of the array.
    """
    shape = x.shape
    # Dask arrays uses non-standard NaN instead of None
    if any(s is None or math.isnan(s) for s in shape):
        msg = "Unsupported lazy shape"
        raise TypeError(msg)
    return cast(tuple[int, ...], shape)


def meta_namespace(
    *arrays: Array | complex | None, xp: ModuleType | None = None
) -> ModuleType:
    """
    Get the namespace of Dask chunks.

    On all other backends, just return the namespace of the arrays.

    Parameters
    ----------
    *arrays : Array | int | float | complex | bool | None
        Input arrays.
    xp : array_namespace, optional
        The standard-compatible namespace for the input arrays. Default: infer.

    Returns
    -------
    array_namespace
        If xp is Dask, the namespace of the Dask chunks;
        otherwise, the namespace of the arrays.
    """
    xp = array_namespace(*arrays) if xp is None else xp
    if not is_dask_namespace(xp):
        return xp
    # Quietly skip scalars and None's
    metas = [cast(Array | None, getattr(a, "_meta", None)) for a in arrays]
    return array_namespace(*metas)


def capabilities(xp: ModuleType) -> dict[str, int]:
    """
    Return patched ``xp.__array_namespace_info__().capabilities()``.

    TODO this helper should be eventually removed once all the special cases
    it handles are fixed in the respective backends.

    Parameters
    ----------
    xp : array_namespace
        The standard-compatible namespace.

    Returns
    -------
    dict
        Capabilities of the namespace.
    """
    if is_pydata_sparse_namespace(xp):
        # No __array_namespace_info__(); no indexing by sparse arrays
        return {"boolean indexing": False, "data-dependent shapes": True}
    out = xp.__array_namespace_info__().capabilities()
    if is_jax_namespace(xp) and out["boolean indexing"]:
        # FIXME https://github.com/jax-ml/jax/issues/27418
        # Fixed in jax >=0.6.0
        out = out.copy()
        out["boolean indexing"] = False
    return out


_BASIC_PICKLED_TYPES = frozenset((
    bool, int, float, complex, str, bytes, bytearray,
    list, tuple, dict, set, frozenset, range, slice,
    types.NoneType, types.EllipsisType,
))  # fmt: skip
_BASIC_REST_TYPES = frozenset((
    type, types.BuiltinFunctionType, types.FunctionType, types.ModuleType
))  # fmt: skip

FlattenRest: TypeAlias = tuple[object, ...]


def pickle_flatten(
    obj: object, cls: type[T] | tuple[type[T], ...]
) -> tuple[list[T], FlattenRest]:
    """
    Use the pickle machinery to extract objects out of an arbitrary container.

    Unlike regular ``pickle.dumps``, this function always succeeds.

    Parameters
    ----------
    obj : object
        The object to pickle.
    cls : type | tuple[type, ...]
        One or multiple classes to extract from the object.
        The instances of these classes inside ``obj`` will not be pickled.

    Returns
    -------
    instances : list[cls]
        All instances of ``cls`` found inside ``obj`` (not pickled).
    rest
        Opaque object containing the pickled bytes plus all other objects where
        ``__reduce__`` / ``__reduce_ex__`` is either not implemented or raised.
        These are unpickleable objects, types, modules, and functions.

        This object is *typically* hashable save for fairly exotic objects
        that are neither pickleable nor hashable.

        This object is pickleable if everything except ``instances`` was pickleable
        in the input object.

    See Also
    --------
    pickle_unflatten : Reverse function.

    Examples
    --------
    >>> class A:
    ...     def __repr__(self):
    ...         return "<A>"
    >>> class NS:
    ...     def __repr__(self):
    ...         return "<NS>"
    ...     def __reduce__(self):
    ...         assert False, "not serializable"
    >>> obj = {1: A(), 2: [A(), NS(), A()]}
    >>> instances, rest = pickle_flatten(obj, A)
    >>> instances
    [<A>, <A>, <A>]
    >>> pickle_unflatten(instances, rest)
    {1: <A>, 2: [<A>, <NS>, <A>]}

    This can be also used to swap inner objects; the only constraint is that
    the number of objects in and out must be the same:

    >>> pickle_unflatten(["foo", "bar", "baz"], rest)
    {1: "foo", 2: ["bar", <NS>, "baz"]}
    """
    instances: list[T] = []
    rest: list[object] = []

    class Pickler(pickle.Pickler):  # numpydoc ignore=GL08
        """
        Use the `pickle.Pickler.persistent_id` hook to extract objects.
        """

        @override
        def persistent_id(self, obj: object) -> Literal[0, 1, None]:  # pyright: ignore[reportIncompatibleMethodOverride]  # numpydoc ignore=GL08
            if isinstance(obj, cls):
                instances.append(obj)  # type: ignore[arg-type]
                return 0

            typ_ = type(obj)
            if typ_ in _BASIC_PICKLED_TYPES:  # No subclasses!
                # If obj is a collection, recursively descend inside it
                return None
            if typ_ in _BASIC_REST_TYPES:
                rest.append(obj)
                return 1

            try:
                # Note: a class that defines __slots__ without defining __getstate__
                # cannot be pickled with __reduce__(), but can with __reduce_ex__(5)
                _ = obj.__reduce_ex__(pickle.HIGHEST_PROTOCOL)
            except Exception:  # pylint: disable=broad-exception-caught
                rest.append(obj)
                return 1

            # Object can be pickled. Let the Pickler recursively descend inside it.
            return None

    f = io.BytesIO()
    p = Pickler(f, protocol=pickle.HIGHEST_PROTOCOL)
    p.dump(obj)
    return instances, (f.getvalue(), *rest)


def pickle_unflatten(instances: Iterable[object], rest: FlattenRest) -> Any:  # type: ignore[explicit-any]
    """
    Reverse of ``pickle_flatten``.

    Parameters
    ----------
    instances : Iterable
        Inner objects to be reinserted into the flattened container.
    rest : FlattenRest
        Extra bits, as returned by ``pickle_flatten``.

    Returns
    -------
    object
        The outer object originally passed to ``pickle_flatten`` after a
        pickle->unpickle round-trip.

    See Also
    --------
    pickle_flatten : Serializing function.
    pickle.loads : Standard unpickle function.

    Notes
    -----
    The `instances` iterable must yield at least the same number of elements as the ones
    returned by ``pickle_without``, but the elements do not need to be the same objects
    or even the same types of objects. Excess elements, if any, will be left untouched.
    """
    iters = iter(instances), iter(rest)
    pik = cast(bytes, next(iters[1]))

    class Unpickler(pickle.Unpickler):  # numpydoc ignore=GL08
        """Mirror of the overridden Pickler in pickle_flatten."""

        @override
        def persistent_load(self, pid: Literal[0, 1]) -> object:  # pyright: ignore[reportIncompatibleMethodOverride]  # numpydoc ignore=GL08
            try:
                return next(iters[pid])
            except StopIteration as e:
                msg = "Not enough objects to unpickle"
                raise ValueError(msg) from e

    f = io.BytesIO(pik)
    return Unpickler(f).load()


class _AutoJITWrapper(Generic[T]):  # numpydoc ignore=PR01
    """
    Helper of :func:`jax_autojit`.

    Wrap arbitrary inputs and outputs of the jitted function and
    convert them to/from PyTrees.
    """

    obj: T
    _registered: ClassVar[bool] = False
    __slots__: tuple[str, ...] = ("obj",)

    def __init__(self, obj: T) -> None:  # numpydoc ignore=GL08
        self._register()
        self.obj = obj

    @classmethod
    def _register(cls):  # numpydoc ignore=SS06
        """
        Register upon first use instead of at import time, to avoid
        globally importing JAX.
        """
        if not cls._registered:
            import jax

            jax.tree_util.register_pytree_node(
                cls,
                lambda obj: pickle_flatten(obj, jax.Array),  # pyright: ignore[reportUnknownArgumentType]
                lambda aux_data, children: pickle_unflatten(children, aux_data),  # pyright: ignore[reportUnknownArgumentType]
            )
            cls._registered = True


def jax_autojit(
    func: Callable[P, T],
) -> Callable[P, T]:  # numpydoc ignore=PR01,RT01,SS03
    """
    Wrap `func` with ``jax.jit``, with the following differences:

    - Python scalar arguments and return values are not automatically converted to
      ``jax.Array`` objects.
    - All non-array arguments are automatically treated as static.
      Unlike ``jax.jit``, static arguments must be either hashable or serializable with
      ``pickle``.
    - Unlike ``jax.jit``, non-array arguments and return values are not limited to
      tuple/list/dict, but can be any object serializable with ``pickle``.
    - Automatically descend into non-array arguments and find ``jax.Array`` objects
      inside them, then rebuild the arguments when entering `func`, swapping the JAX
      concrete arrays with tracer objects.
    - Automatically descend into non-array return values and find ``jax.Array`` objects
      inside them, then rebuild them downstream of exiting the JIT, swapping the JAX
      tracer objects with concrete arrays.

    See Also
    --------
    jax.jit : JAX JIT compilation function.
    """
    import jax

    @jax.jit  # type: ignore[misc]  # pyright: ignore[reportUntypedFunctionDecorator]
    def inner(  # type: ignore[decorated-any,explicit-any]  # numpydoc ignore=GL08
        wargs: _AutoJITWrapper[Any],
    ) -> _AutoJITWrapper[T]:
        args, kwargs = wargs.obj
        res = func(*args, **kwargs)  # pyright: ignore[reportCallIssue]
        return _AutoJITWrapper(res)

    @wraps(func)
    def outer(*args: P.args, **kwargs: P.kwargs) -> T:  # numpydoc ignore=GL08
        wargs = _AutoJITWrapper((args, kwargs))
        return inner(wargs).obj

    return outer
