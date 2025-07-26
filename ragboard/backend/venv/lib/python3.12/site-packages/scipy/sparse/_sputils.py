""" Utility functions for sparse matrix module
"""

import sys
from typing import Any, Literal, Union
import operator
import numpy as np
from math import prod
import scipy.sparse as sp
from scipy._lib._util import np_long, np_ulong


__all__ = ['upcast', 'getdtype', 'getdata', 'isscalarlike', 'isintlike',
           'isshape', 'issequence', 'isdense', 'ismatrix', 'get_sum_dtype',
           'broadcast_shapes']

supported_dtypes = [np.bool_, np.byte, np.ubyte, np.short, np.ushort, np.intc,
                    np.uintc, np_long, np_ulong, np.longlong, np.ulonglong,
                    np.float32, np.float64, np.longdouble,
                    np.complex64, np.complex128, np.clongdouble]

_upcast_memo = {}


def upcast(*args):
    """Returns the nearest supported sparse dtype for the
    combination of one or more types.

    upcast(t0, t1, ..., tn) -> T  where T is a supported dtype

    Examples
    --------
    >>> from scipy.sparse._sputils import upcast
    >>> upcast('int32')
    <class 'numpy.int32'>
    >>> upcast('bool')
    <class 'numpy.bool'>
    >>> upcast('int32','float32')
    <class 'numpy.float64'>
    >>> upcast('bool',complex,float)
    <class 'numpy.complex128'>

    """

    t = _upcast_memo.get(hash(args))
    if t is not None:
        return t

    upcast = np.result_type(*args)

    for t in supported_dtypes:
        if np.can_cast(upcast, t):
            _upcast_memo[hash(args)] = t
            return t

    raise TypeError(f'no supported conversion for types: {args!r}')


def upcast_char(*args):
    """Same as `upcast` but taking dtype.char as input (faster)."""
    t = _upcast_memo.get(args)
    if t is not None:
        return t
    t = upcast(*map(np.dtype, args))
    _upcast_memo[args] = t
    return t


def upcast_scalar(dtype, scalar):
    """Determine data type for binary operation between an array of
    type `dtype` and a scalar.
    """
    return (np.array([0], dtype=dtype) * scalar).dtype


def downcast_intp_index(arr):
    """
    Down-cast index array to np.intp dtype if it is of a larger dtype.

    Raise an error if the array contains a value that is too large for
    intp.
    """
    if arr.dtype.itemsize > np.dtype(np.intp).itemsize:
        if arr.size == 0:
            return arr.astype(np.intp)
        maxval = arr.max()
        minval = arr.min()
        if maxval > np.iinfo(np.intp).max or minval < np.iinfo(np.intp).min:
            raise ValueError("Cannot deal with arrays with indices larger "
                             "than the machine maximum address size "
                             "(e.g. 64-bit indices on 32-bit machine).")
        return arr.astype(np.intp)
    return arr


def to_native(A):
    """
    Ensure that the data type of the NumPy array `A` has native byte order.

    `A` must be a NumPy array.  If the data type of `A` does not have native
    byte order, a copy of `A` with a native byte order is returned. Otherwise
    `A` is returned.
    """
    dt = A.dtype
    if dt.isnative:
        # Don't call `asarray()` if A is already native, to avoid unnecessarily
        # creating a view of the input array.
        return A
    return np.asarray(A, dtype=dt.newbyteorder('native'))


def getdtype(dtype, a=None, default=None):
    """Form a supported numpy dtype based on input arguments.

    Returns a valid ``numpy.dtype`` from `dtype` if not None,
    or else ``a.dtype`` if possible, or else the given `default`
    if not None, or else raise a ``TypeError``.

    The resulting ``dtype`` must be in ``supported_dtypes``:
        bool_, int8, uint8, int16, uint16, int32, uint32,
        int64, uint64, longlong, ulonglong, float32, float64,
        longdouble, complex64, complex128, clongdouble
    """
    if dtype is None:
        try:
            newdtype = a.dtype
        except AttributeError as e:
            if default is not None:
                newdtype = np.dtype(default)
            else:
                raise TypeError("could not interpret data type") from e
    else:
        newdtype = np.dtype(dtype)

    if newdtype not in supported_dtypes:
        supported_dtypes_fmt = ", ".join(t.__name__ for t in supported_dtypes)
        raise ValueError(f"scipy.sparse does not support dtype {newdtype}. "
                         f"The only supported types are: {supported_dtypes_fmt}.")
    return newdtype


def getdata(obj, dtype=None, copy=False) -> np.ndarray:
    """
    This is a wrapper of `np.array(obj, dtype=dtype, copy=copy)`
    that will generate a warning if the result is an object array.
    """
    data = np.array(obj, dtype=dtype, copy=copy)
    # Defer to getdtype for checking that the dtype is OK.
    # This is called for the validation only; we don't need the return value.
    getdtype(data.dtype)
    return data


def safely_cast_index_arrays(A, idx_dtype=np.int32, msg=""):
    """Safely cast sparse array indices to `idx_dtype`.

    Check the shape of `A` to determine if it is safe to cast its index
    arrays to dtype `idx_dtype`. If any dimension in shape is larger than
    fits in the dtype, casting is unsafe so raise ``ValueError``.
    If safe, cast the index arrays to `idx_dtype` and return the result
    without changing the input `A`. The caller can assign results to `A`
    attributes if desired or use the recast index arrays directly.

    Unless downcasting is needed, the original index arrays are returned.
    You can test e.g. ``A.indptr is new_indptr`` to see if downcasting occurred.

    .. versionadded:: 1.15.0

    Parameters
    ----------
    A : sparse array or matrix
        The array for which index arrays should be downcast.
    idx_dtype : dtype
        Desired dtype. Should be an integer dtype (default: ``np.int32``).
        Most of scipy.sparse uses either int64 or int32.
    msg : string, optional
        A string to be added to the end of the ValueError message
        if the array shape is too big to fit in `idx_dtype`.
        The error message is ``f"<index> values too large for {msg}"``
        It should indicate why the downcasting is needed, e.g. "SuperLU",
        and defaults to f"dtype {idx_dtype}".

    Returns
    -------
    idx_arrays : ndarray or tuple of ndarrays
        Based on ``A.format``, index arrays are returned after casting to `idx_dtype`.
        For CSC/CSR, returns ``(indices, indptr)``.
        For COO, returns ``coords``.
        For DIA, returns ``offsets``.
        For BSR, returns ``(indices, indptr)``.

    Raises
    ------
    ValueError
        If the array has shape that would not fit in the new dtype, or if
        the sparse format does not use index arrays.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import sparse
    >>> data = [3]
    >>> coords = (np.array([3]), np.array([1]))  # Note: int64 arrays
    >>> A = sparse.coo_array((data, coords))
    >>> A.coords[0].dtype
    dtype('int64')

    >>> # rescast after construction, raising exception if shape too big
    >>> coords = sparse.safely_cast_index_arrays(A, np.int32)
    >>> A.coords[0] is coords[0]  # False if casting is needed
    False
    >>> A.coords = coords  # set the index dtype of A
    >>> A.coords[0].dtype
    dtype('int32')
    """
    if not msg:
        msg = f"dtype {idx_dtype}"
    # check for safe downcasting
    max_value = np.iinfo(idx_dtype).max

    if A.format in ("csc", "csr"):
        # indptr[-1] is max b/c indptr always sorted
        if A.indptr[-1] > max_value:
            raise ValueError(f"indptr values too large for {msg}")

        # check shape vs dtype
        if max(*A.shape) > max_value:
            if (A.indices > max_value).any():
                raise ValueError(f"indices values too large for {msg}")

        indices = A.indices.astype(idx_dtype, copy=False)
        indptr = A.indptr.astype(idx_dtype, copy=False)
        return indices, indptr

    elif A.format == "coo":
        if max(*A.shape) > max_value:
            if any((co > max_value).any() for co in A.coords):
                raise ValueError(f"coords values too large for {msg}")
        return tuple(co.astype(idx_dtype, copy=False) for co in A.coords)

    elif A.format == "dia":
        if max(*A.shape) > max_value:
            if (A.offsets > max_value).any():
                raise ValueError(f"offsets values too large for {msg}")
        offsets = A.offsets.astype(idx_dtype, copy=False)
        return offsets

    elif A.format == 'bsr':
        R, C = A.blocksize
        if A.indptr[-1] * R > max_value:
            raise ValueError("indptr values too large for {msg}")
        if max(*A.shape) > max_value:
            if (A.indices * C > max_value).any():
                raise ValueError(f"indices values too large for {msg}")
        indices = A.indices.astype(idx_dtype, copy=False)
        indptr = A.indptr.astype(idx_dtype, copy=False)
        return indices, indptr

    else:
        raise TypeError(f'Format {A.format} is not associated with index arrays. '
                        'DOK and LIL have dict and list, not array.')


def get_index_dtype(arrays=(), maxval=None, check_contents=False):
    """
    Based on input (integer) arrays `a`, determine a suitable index data
    type that can hold the data in the arrays.

    Parameters
    ----------
    arrays : tuple of array_like
        Input arrays whose types/contents to check
    maxval : float, optional
        Maximum value needed
    check_contents : bool, optional
        Whether to check the values in the arrays and not just their types.
        Default: False (check only the types)

    Returns
    -------
    dtype : dtype
        Suitable index data type (int32 or int64)

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import sparse
    >>> # select index dtype based on shape
    >>> shape = (3, 3)
    >>> idx_dtype = sparse.get_index_dtype(maxval=max(shape))
    >>> data = [1.1, 3.0, 1.5]
    >>> indices = np.array([0, 1, 0], dtype=idx_dtype)
    >>> indptr = np.array([0, 2, 3, 3], dtype=idx_dtype)
    >>> A = sparse.csr_array((data, indices, indptr), shape=shape)
    >>> A.indptr.dtype
    dtype('int32')

    >>> # select based on larger of existing arrays and shape
    >>> shape = (3, 3)
    >>> idx_dtype = sparse.get_index_dtype(A.indptr, maxval=max(shape))
    >>> idx_dtype
    <class 'numpy.int32'>
    """
    # not using intc directly due to misinteractions with pythran
    if np.intc().itemsize != 4:
        return np.int64

    int32min = np.int32(np.iinfo(np.int32).min)
    int32max = np.int32(np.iinfo(np.int32).max)

    if maxval is not None:
        maxval = np.int64(maxval)
        if maxval > int32max:
            return np.int64

    if isinstance(arrays, np.ndarray):
        arrays = (arrays,)

    for arr in arrays:
        arr = np.asarray(arr)
        if not np.can_cast(arr.dtype, np.int32):
            if check_contents:
                if arr.size == 0:
                    # a bigger type not needed
                    continue
                elif np.issubdtype(arr.dtype, np.integer):
                    maxval = arr.max()
                    minval = arr.min()
                    if minval >= int32min and maxval <= int32max:
                        # a bigger type not needed
                        continue
            return np.int64
    return np.int32


def get_sum_dtype(dtype: np.dtype) -> np.dtype:
    """Mimic numpy's casting for np.sum"""
    if dtype.kind == 'u' and np.can_cast(dtype, np.uint):
        return np.uint
    if np.can_cast(dtype, np.int_):
        return np.int_
    return dtype


def isscalarlike(x) -> bool:
    """Is x either a scalar, an array scalar, or a 0-dim array?"""
    return np.isscalar(x) or (isdense(x) and x.ndim == 0)


def isintlike(x) -> bool:
    """Is x appropriate as an index into a sparse matrix? Returns True
    if it can be cast safely to a machine int.
    """
    # Fast-path check to eliminate non-scalar values. operator.index would
    # catch this case too, but the exception catching is slow.
    if np.ndim(x) != 0:
        return False
    try:
        operator.index(x)
    except (TypeError, ValueError):
        try:
            loose_int = bool(int(x) == x)
        except (TypeError, ValueError):
            return False
        if loose_int:
            msg = "Inexact indices into sparse matrices are not allowed"
            raise ValueError(msg)
        return loose_int
    return True


def isshape(x, nonneg=False, *, allow_nd=(2,)) -> bool:
    """Is x a valid tuple of dimensions?

    If nonneg, also checks that the dimensions are non-negative.
    Shapes of length in the tuple allow_nd are allowed.
    """
    ndim = len(x)
    if ndim not in allow_nd:
        return False

    for d in x:
        if not isintlike(d):
            return False
        if nonneg and d < 0:
            return False
    return True


def issequence(t) -> bool:
    return ((isinstance(t, list | tuple) and
            (len(t) == 0 or np.isscalar(t[0]))) or
            (isinstance(t, np.ndarray) and (t.ndim == 1)))


def ismatrix(t) -> bool:
    return ((isinstance(t, list | tuple) and
             len(t) > 0 and issequence(t[0])) or
            (isinstance(t, np.ndarray) and t.ndim == 2))


def isdense(x) -> bool:
    return isinstance(x, np.ndarray)


def validateaxis(axis, *, ndim=2) -> tuple[int, ...] | None:
    if axis is None:
        return None

    if axis == ():
        raise ValueError(
            "sparse does not accept 0D axis (). Either use toarray (for dense) "
            "or copy (for sparse)."
        )

    if not isinstance(axis, tuple):
        # If not a tuple, check that the provided axis is actually
        # an integer and raise a TypeError similar to NumPy's
        if not np.issubdtype(np.dtype(type(axis)), np.integer):
            raise TypeError(f'axis must be an integer/tuple of ints, not {type(axis)}')
        axis = (axis,)

    canon_axis = []
    for ax in axis:
        if not isintlike(ax):
            raise TypeError(f"axis must be an integer. (given {ax})")
        if ax < 0:
            ax += ndim
        if ax < 0 or ax >= ndim:
            raise ValueError("axis out of range for ndim")
        canon_axis.append(ax)

    len_axis = len(canon_axis)
    if len_axis != len(set(canon_axis)):
        raise ValueError("duplicate value in axis")
    elif len_axis > ndim:
        raise ValueError("axis tuple has too many elements")
    elif len_axis == ndim:
        return None
    else:
        return tuple(canon_axis)


def check_shape(args, current_shape=None, *, allow_nd=(2,)) -> tuple[int, ...]:
    """Imitate numpy.matrix handling of shape arguments

    Parameters
    ----------
    args : array_like
        Data structures providing information about the shape of the sparse array.
    current_shape : tuple, optional
        The current shape of the sparse array or matrix.
        If None (default), the current shape will be inferred from args.
    allow_nd : tuple of ints, optional default: (2,)
        If shape does not have a length in the tuple allow_nd an error is raised.

    Returns
    -------
    new_shape: tuple
        The new shape after validation.
    """
    if len(args) == 0:
        raise TypeError("function missing 1 required positional argument: 'shape'")
    if len(args) == 1:
        try:
            shape_iter = iter(args[0])
        except TypeError:
            new_shape = (operator.index(args[0]), )
        else:
            new_shape = tuple(operator.index(arg) for arg in shape_iter)
    else:
        new_shape = tuple(operator.index(arg) for arg in args)

    if current_shape is None:
        if len(new_shape) not in allow_nd:
            raise ValueError(f'shape must have length in {allow_nd}. Got {new_shape=}')
        if any(d < 0 for d in new_shape):
            raise ValueError("'shape' elements cannot be negative")
    else:
        # Check the current size only if needed
        current_size = prod(current_shape)

        # Check for negatives
        negative_indexes = [i for i, x in enumerate(new_shape) if x < 0]
        if not negative_indexes:
            new_size = prod(new_shape)
            if new_size != current_size:
                raise ValueError(f'cannot reshape array of size {current_size}'
                                 f' into shape {new_shape}')
        elif len(negative_indexes) == 1:
            skip = negative_indexes[0]
            specified = prod(new_shape[:skip] + new_shape[skip+1:])
            unspecified, remainder = divmod(current_size, specified)
            if remainder != 0:
                err_shape = tuple('newshape' if x < 0 else x for x in new_shape)
                raise ValueError(f'cannot reshape array of size {current_size}'
                                 f' into shape {err_shape}')
            new_shape = new_shape[:skip] + (unspecified,) + new_shape[skip+1:]
        else:
            raise ValueError('can only specify one unknown dimension')

    if len(new_shape) not in allow_nd:
        raise ValueError(f'shape must have length in {allow_nd}. Got {new_shape=}')

    return new_shape


def broadcast_shapes(*shapes):
    """Check if shapes can be broadcast and return resulting shape

    This is similar to the NumPy ``broadcast_shapes`` function but
    does not check memory consequences of the resulting dense matrix.

    Parameters
    ----------
    *shapes : tuple of shape tuples
        The tuple of shapes to be considered for broadcasting.
        Shapes should be tuples of non-negative integers.

    Returns
    -------
    new_shape : tuple of integers
        The shape that results from broadcasting th input shapes.
    """
    if not shapes:
        return ()
    shapes = [shp if isinstance(shp, tuple | list) else (shp,) for shp in shapes]
    big_shp = max(shapes, key=len)
    out = list(big_shp)
    for shp in shapes:
        if shp is big_shp:
            continue
        for i, x in enumerate(shp, start=-len(shp)):
            if x != 1 and x != out[i]:
                if out[i] != 1:
                    raise ValueError("shapes cannot be broadcast to a single shape.")
                out[i] = x
    return (*out,)


def check_reshape_kwargs(kwargs):
    """Unpack keyword arguments for reshape function.

    This is useful because keyword arguments after star arguments are not
    allowed in Python 2, but star keyword arguments are. This function unpacks
    'order' and 'copy' from the star keyword arguments (with defaults) and
    throws an error for any remaining.
    """

    order = kwargs.pop('order', 'C')
    copy = kwargs.pop('copy', False)
    if kwargs:  # Some unused kwargs remain
        raise TypeError("reshape() got unexpected keywords arguments: "
                        f"{', '.join(kwargs.keys())}")
    return order, copy


def is_pydata_spmatrix(m) -> bool:
    """
    Check whether object is pydata/sparse matrix, avoiding importing the module.
    """
    base_cls = getattr(sys.modules.get('sparse'), 'SparseArray', None)
    return base_cls is not None and isinstance(m, base_cls)


def convert_pydata_sparse_to_scipy(
    arg: Any,
    target_format: None | Literal["csc", "csr"] = None,
    accept_fv: Any = None,
) -> Union[Any, "sp.spmatrix"]:
    """
    Convert a pydata/sparse array to scipy sparse matrix,
    pass through anything else.
    """
    if is_pydata_spmatrix(arg):
        # The `accept_fv` keyword is new in PyData Sparse 0.15.4 (May 2024),
        # remove the `except` once the minimum supported version is >=0.15.4
        try:
            arg = arg.to_scipy_sparse(accept_fv=accept_fv)
        except TypeError:
            arg = arg.to_scipy_sparse()
        if target_format is not None:
            arg = arg.asformat(target_format)
        elif arg.format not in ("csc", "csr"):
            arg = arg.tocsc()
    return arg


###############################################################################
# Wrappers for NumPy types that are deprecated

# Numpy versions of these functions raise deprecation warnings, the
# ones below do not.

def matrix(*args, **kwargs):
    return np.array(*args, **kwargs).view(np.matrix)


def asmatrix(data, dtype=None):
    if isinstance(data, np.matrix) and (dtype is None or data.dtype == dtype):
        return data
    return np.asarray(data, dtype=dtype).view(np.matrix)

###############################################################################


def _todata(s) -> np.ndarray:
    """Access nonzero values, possibly after summing duplicates.

    Parameters
    ----------
    s : sparse array
        Input sparse array.

    Returns
    -------
    data: ndarray
      Nonzero values of the array, with shape (s.nnz,)

    """
    if isinstance(s, sp._data._data_matrix):
        return s._deduped_data()

    if isinstance(s, sp.dok_array):
        return np.fromiter(s.values(), dtype=s.dtype, count=s.nnz)

    if isinstance(s, sp.lil_array):
        data = np.empty(s.nnz, dtype=s.dtype)
        sp._csparsetools.lil_flatten_to_array(s.data, data)
        return data

    return s.tocoo()._deduped_data()
