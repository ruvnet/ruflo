"""Sparse DIAgonal format"""

__docformat__ = "restructuredtext en"

__all__ = ['dia_array', 'dia_matrix', 'isspmatrix_dia']

import numpy as np

from .._lib._util import copy_if_needed
from ._matrix import spmatrix
from ._base import issparse, _formats, _spbase, sparray
from ._data import _data_matrix
from ._sputils import (
    isdense, isscalarlike, isshape, upcast_char, getdtype, get_sum_dtype,
    validateaxis, check_shape
)
from ._sparsetools import dia_matmat, dia_matvec, dia_matvecs


class _dia_base(_data_matrix):
    _format = 'dia'

    def __init__(self, arg1, shape=None, dtype=None, copy=False, *, maxprint=None):
        _data_matrix.__init__(self, arg1, maxprint=maxprint)

        if issparse(arg1):
            if arg1.format == "dia":
                if copy:
                    arg1 = arg1.copy()
                self.data = arg1.data
                self.offsets = arg1.offsets
                self._shape = check_shape(arg1.shape)
            else:
                if arg1.format == self.format and copy:
                    A = arg1.copy()
                else:
                    A = arg1.todia()
                self.data = A.data
                self.offsets = A.offsets
                self._shape = check_shape(A.shape)
        elif isinstance(arg1, tuple):
            if isshape(arg1):
                # It's a tuple of matrix dimensions (M, N)
                # create empty matrix
                self._shape = check_shape(arg1)
                self.data = np.zeros((0,0), getdtype(dtype, default=float))
                idx_dtype = self._get_index_dtype(maxval=max(self.shape))
                self.offsets = np.zeros((0), dtype=idx_dtype)
            else:
                try:
                    # Try interpreting it as (data, offsets)
                    data, offsets = arg1
                except Exception as e:
                    message = 'unrecognized form for dia_array constructor'
                    raise ValueError(message) from e
                else:
                    if shape is None:
                        raise ValueError('expected a shape argument')
                    if not copy:
                        copy = copy_if_needed
                    self.data = np.atleast_2d(np.array(arg1[0], dtype=dtype, copy=copy))
                    offsets = np.array(arg1[1],
                                       dtype=self._get_index_dtype(maxval=max(shape)),
                                       copy=copy)
                    self.offsets = np.atleast_1d(offsets)
                    self._shape = check_shape(shape)
        else:
            # must be dense, convert to COO first, then to DIA
            try:
                arg1 = np.asarray(arg1)
            except Exception as e:
                raise ValueError("unrecognized form for "
                                 f"{self.format}_matrix constructor") from e
            if isinstance(self, sparray) and arg1.ndim != 2:
                raise ValueError(f"DIA arrays don't support {arg1.ndim}D input. Use 2D")
            A = self._coo_container(arg1, dtype=dtype, shape=shape).todia()
            self.data = A.data
            self.offsets = A.offsets
            self._shape = check_shape(A.shape)

        if dtype is not None:
            newdtype = getdtype(dtype)
            self.data = self.data.astype(newdtype)

        # check format
        if self.offsets.ndim != 1:
            raise ValueError('offsets array must have rank 1')

        if self.data.ndim != 2:
            raise ValueError('data array must have rank 2')

        if self.data.shape[0] != len(self.offsets):
            raise ValueError(
                f'number of diagonals ({self.data.shape[0]}) does not match the number '
                f'of offsets ({len(self.offsets)})'
            )
        if len(np.unique(self.offsets)) != len(self.offsets):
            raise ValueError('offset array contains duplicate values')

    def __repr__(self):
        _, fmt = _formats[self.format]
        sparse_cls = 'array' if isinstance(self, sparray) else 'matrix'
        d = self.data.shape[0]
        return (
            f"<{fmt} sparse {sparse_cls} of dtype '{self.dtype}'\n"
            f"\twith {self.nnz} stored elements ({d} diagonals) and shape {self.shape}>"
        )

    def _data_mask(self):
        """Returns a mask of the same shape as self.data, where
        mask[i,j] is True when data[i,j] corresponds to a stored element."""
        num_rows, num_cols = self.shape
        offset_inds = np.arange(self.data.shape[1])
        row = offset_inds - self.offsets[:,None]
        mask = (row >= 0)
        mask &= (row < num_rows)
        mask &= (offset_inds < num_cols)
        return mask

    def count_nonzero(self, axis=None):
        if axis is not None:
            raise NotImplementedError(
                "count_nonzero over an axis is not implemented for DIA format"
            )
        mask = self._data_mask()
        return np.count_nonzero(self.data[mask])

    count_nonzero.__doc__ = _spbase.count_nonzero.__doc__

    def _getnnz(self, axis=None):
        if axis is not None:
            raise NotImplementedError("_getnnz over an axis is not implemented "
                                      "for DIA format")
        M,N = self.shape
        nnz = 0
        for k in self.offsets:
            if k > 0:
                nnz += min(M,N-k)
            else:
                nnz += min(M+k,N)
        return int(nnz)

    _getnnz.__doc__ = _spbase._getnnz.__doc__

    def sum(self, axis=None, dtype=None, out=None):
        axis = validateaxis(axis)

        res_dtype = get_sum_dtype(self.dtype)
        num_rows, num_cols = self.shape
        ret = None

        if axis == (0,):
            mask = self._data_mask()
            x = (self.data * mask).sum(axis=0)
            if x.shape[0] == num_cols:
                res = x
            else:
                res = np.zeros(num_cols, dtype=x.dtype)
                res[:x.shape[0]] = x
            ret = self._ascontainer(res, dtype=res_dtype)

        else:  # axis is None or (1,)
            row_sums = np.zeros((num_rows, 1), dtype=res_dtype)
            one = np.ones(num_cols, dtype=res_dtype)
            dia_matvec(num_rows, num_cols, len(self.offsets),
                       self.data.shape[1], self.offsets, self.data, one, row_sums)

            row_sums = self._ascontainer(row_sums)

            if axis is None:
                return row_sums.sum(dtype=dtype, out=out)

            ret = self._ascontainer(row_sums.sum(axis=axis))

        return ret.sum(axis=(), dtype=dtype, out=out)

    sum.__doc__ = _spbase.sum.__doc__

    def _add_sparse(self, other, sub=False):
        # If other is not DIA format, let them handle us instead.
        if not isinstance(other, _dia_base):
            return other._add_sparse(self)

        # Fast path for exact equality of the sparsity structure.
        if np.array_equal(self.offsets, other.offsets):
            return self._with_data(self.data - other.data if sub else
                                   self.data + other.data)

        # Find the union of the offsets (which will be sorted and unique).
        new_offsets = np.union1d(self.offsets, other.offsets)
        self_idx = np.searchsorted(new_offsets, self.offsets)
        other_idx = np.searchsorted(new_offsets, other.offsets)

        self_d = self.data.shape[1]
        other_d = other.data.shape[1]
        # Fast path for a sparsity structure where the final offsets are a
        # permutation of the existing offsets and the diagonal lengths match.
        if self_d == other_d and len(new_offsets) == len(self.offsets):
            new_data = self.data[_invert_index(self_idx)]
            if sub:
                new_data[other_idx, :] -= other.data
            else:
                new_data[other_idx, :] += other.data
        elif self_d == other_d and len(new_offsets) == len(other.offsets):
            if sub:
                new_data = -other.data[_invert_index(other_idx)]
            else:
                new_data = other.data[_invert_index(other_idx)]
            new_data[self_idx, :] += self.data
        else:
            # Maximum diagonal length of the result.
            d = min(self.shape[0] + new_offsets[-1], self.shape[1])

            # Add all diagonals to a freshly allocated data array.
            new_data = np.zeros(
                (len(new_offsets), d),
                dtype=np.result_type(self.data, other.data),
            )
            new_data[self_idx, :self_d] += self.data[:, :d]
            if sub:
                new_data[other_idx, :other_d] -= other.data[:, :d]
            else:
                new_data[other_idx, :other_d] += other.data[:, :d]
        return self._dia_container((new_data, new_offsets), shape=self.shape)

    def _sub_sparse(self, other):
        # If other is not DIA format, use default handler.
        if not isinstance(other, _dia_base):
            return super()._sub_sparse(other)

        return self._add_sparse(other, sub=True)

    def _mul_scalar(self, other):
        return self._with_data(self.data * other)

    def multiply(self, other):
        if isscalarlike(other):
            return self._mul_scalar(other)

        if isdense(other):
            if other.ndim > 2:
                return self.toarray() * other

            # Use default handler for pathological cases.
            if 0 in self.shape or 1 in self.shape or 0 in other.shape:
                return super().multiply(other)

            other = np.atleast_2d(other)
            other_rows, other_cols = other.shape
            rows, cols = self.shape
            L = min(self.data.shape[1], cols)
            data = self.data[:, :L].astype(np.result_type(self.data, other))
            if other_rows == 1:
                data *= other[0, :L]
            elif other_rows != rows:
                raise ValueError('inconsistent shapes')
            else:
                j = np.arange(L)
                if L > rows:
                    i = (j - self.offsets[:, None]) % rows
                else:  # can use faster method
                    i = j - self.offsets[:, None] % rows
                if other_cols == 1:
                    j = 0
                elif other_cols != cols:
                    raise ValueError('inconsistent shapes')
                data *= other[i, j]
            return self._with_data(data)

        # If other is not DIA format or needs broadcasting (unreasonable
        # use case for DIA anyway), use default handler.
        if not isinstance(other, _dia_base) or other.shape != self.shape:
            return super().multiply(other)

        # Find common offsets (unique diagonals don't contribute)
        # and indices corresponding to them in multiplicand and multiplier.
        offsets, self_idx, other_idx = \
            np.intersect1d(self.offsets, other.offsets,
                           assume_unique=True, return_indices=True)
        # Only overlapping length of diagonals can have non-zero products.
        L = min(self.data.shape[1], other.data.shape[1])
        data = self.data[self_idx, :L] * other.data[other_idx, :L]
        return self._dia_container((data, offsets), shape=self.shape)

    def _matmul_vector(self, other):
        x = other

        y = np.zeros(self.shape[0], dtype=upcast_char(self.dtype.char,
                                                       x.dtype.char))

        L = self.data.shape[1]

        M,N = self.shape

        dia_matvec(M,N, len(self.offsets), L, self.offsets, self.data,
                   x.ravel(), y.ravel())

        return y

    def _matmul_multivector(self, other):
        res = np.zeros((self.shape[0], other.shape[1]),
                       dtype=np.result_type(self.data, other))
        dia_matvecs(*self.shape, *self.data.shape, self.offsets, self.data,
                    other.shape[1], other, res)
        return res

    def _matmul_sparse(self, other):
        # If other is not DIA format, use default handler.
        if not isinstance(other, _dia_base):
            return super()._matmul_sparse(other)

        # If any dimension is zero, return empty array immediately.
        if 0 in self.shape or 0 in other.shape:
            return self._dia_container((self.shape[0], other.shape[1]))

        offsets, data = dia_matmat(*self.shape, *self.data.shape,
                                   self.offsets, self.data,
                                   other.shape[1], *other.data.shape,
                                   other.offsets, other.data)
        return self._dia_container((data.reshape(len(offsets), -1), offsets),
                                   (self.shape[0], other.shape[1]))

    def _setdiag(self, values, k=0):
        M, N = self.shape

        if values.ndim == 0:
            # broadcast
            values_n = np.inf
        else:
            values_n = len(values)

        if k < 0:
            n = min(M + k, N, values_n)
            min_index = 0
            max_index = n
        else:
            n = min(M, N - k, values_n)
            min_index = k
            max_index = k + n

        if values.ndim != 0:
            # allow also longer sequences
            values = values[:n]

        data_rows, data_cols = self.data.shape
        if k in self.offsets:
            if max_index > data_cols:
                data = np.zeros((data_rows, max_index), dtype=self.data.dtype)
                data[:, :data_cols] = self.data
                self.data = data
            self.data[self.offsets == k, min_index:max_index] = values
        else:
            self.offsets = np.append(self.offsets, self.offsets.dtype.type(k))
            m = max(max_index, data_cols)
            data = np.zeros((data_rows + 1, m), dtype=self.data.dtype)
            data[:-1, :data_cols] = self.data
            data[-1, min_index:max_index] = values
            self.data = data

    def todia(self, copy=False):
        if copy:
            return self.copy()
        else:
            return self

    todia.__doc__ = _spbase.todia.__doc__

    def transpose(self, axes=None, copy=False):
        if axes is not None and axes != (1, 0):
            raise ValueError("Sparse arrays/matrices do not support "
                              "an 'axes' parameter because swapping "
                              "dimensions is the only logical permutation.")

        num_rows, num_cols = self.shape
        max_dim = max(self.shape)

        # flip diagonal offsets
        offsets = -self.offsets

        # re-align the data matrix
        r = np.arange(len(offsets), dtype=np.intc)[:, None]
        c = np.arange(num_rows, dtype=np.intc) - (offsets % max_dim)[:, None]
        pad_amount = max(0, max_dim-self.data.shape[1])
        data = np.hstack((self.data, np.zeros((self.data.shape[0], pad_amount),
                                              dtype=self.data.dtype)))
        data = data[r, c]
        return self._dia_container((data, offsets), shape=(
            num_cols, num_rows), copy=copy)

    transpose.__doc__ = _spbase.transpose.__doc__

    def diagonal(self, k=0):
        rows, cols = self.shape
        if k <= -rows or k >= cols:
            return np.empty(0, dtype=self.data.dtype)
        idx, = np.nonzero(self.offsets == k)
        first_col = max(0, k)
        last_col = min(rows + k, cols)
        result_size = last_col - first_col
        if idx.size == 0:
            return np.zeros(result_size, dtype=self.data.dtype)
        result = self.data[idx[0], first_col:last_col]
        padding = result_size - len(result)
        if padding > 0:
            result = np.pad(result, (0, padding), mode='constant')
        return result

    diagonal.__doc__ = _spbase.diagonal.__doc__

    def tocsc(self, copy=False):
        if self.nnz == 0:
            return self._csc_container(self.shape, dtype=self.dtype)

        num_rows, num_cols = self.shape
        num_offsets, offset_len = self.data.shape
        offset_inds = np.arange(offset_len)

        row = offset_inds - self.offsets[:,None]
        mask = (row >= 0)
        mask &= (row < num_rows)
        mask &= (offset_inds < num_cols)
        mask &= (self.data != 0)

        idx_dtype = self._get_index_dtype(maxval=max(self.shape))
        indptr = np.zeros(num_cols + 1, dtype=idx_dtype)
        indptr[1:offset_len+1] = np.cumsum(mask.sum(axis=0)[:num_cols])
        if offset_len < num_cols:
            indptr[offset_len+1:] = indptr[offset_len]
        indices = row.T[mask.T].astype(idx_dtype, copy=False)
        data = self.data.T[mask.T]
        return self._csc_container((data, indices, indptr), shape=self.shape,
                                   dtype=self.dtype)

    tocsc.__doc__ = _spbase.tocsc.__doc__

    def tocoo(self, copy=False):
        num_rows, num_cols = self.shape
        num_offsets, offset_len = self.data.shape
        offset_inds = np.arange(offset_len)

        row = offset_inds - self.offsets[:,None]
        mask = (row >= 0)
        mask &= (row < num_rows)
        mask &= (offset_inds < num_cols)
        mask &= (self.data != 0)
        row = row[mask]
        col = np.tile(offset_inds, num_offsets)[mask.ravel()]
        idx_dtype = self._get_index_dtype(
            arrays=(self.offsets,), maxval=max(self.shape)
        )
        row = row.astype(idx_dtype, copy=False)
        col = col.astype(idx_dtype, copy=False)
        data = self.data[mask]
        # Note: this cannot set has_canonical_format=True, because despite the
        # lack of duplicates, we do not generate sorted indices.
        return self._coo_container(
            (data, (row, col)), shape=self.shape, dtype=self.dtype, copy=False
        )

    tocoo.__doc__ = _spbase.tocoo.__doc__

    # needed by _data_matrix
    def _with_data(self, data, copy=True):
        """Returns a matrix with the same sparsity structure as self,
        but with different data.  By default the structure arrays are copied.
        """
        if copy:
            return self._dia_container(
                (data, self.offsets.copy()), shape=self.shape
            )
        else:
            return self._dia_container(
                (data, self.offsets), shape=self.shape
            )

    def resize(self, *shape):
        shape = check_shape(shape)
        M, N = shape
        # we do not need to handle the case of expanding N
        self.data = self.data[:, :N]

        if (M > self.shape[0] and
                np.any(self.offsets + self.shape[0] < self.data.shape[1])):
            # explicitly clear values that were previously hidden
            mask = (self.offsets[:, None] + self.shape[0] <=
                    np.arange(self.data.shape[1]))
            self.data[mask] = 0

        self._shape = shape

    resize.__doc__ = _spbase.resize.__doc__


def _invert_index(idx):
    """Helper function to invert an index array."""
    inv = np.zeros_like(idx)
    inv[idx] = np.arange(len(idx))
    return inv


def isspmatrix_dia(x):
    """Is `x` of dia_matrix type?

    Parameters
    ----------
    x
        object to check for being a dia matrix

    Returns
    -------
    bool
        True if `x` is a dia matrix, False otherwise

    Examples
    --------
    >>> from scipy.sparse import dia_array, dia_matrix, coo_matrix, isspmatrix_dia
    >>> isspmatrix_dia(dia_matrix([[5]]))
    True
    >>> isspmatrix_dia(dia_array([[5]]))
    False
    >>> isspmatrix_dia(coo_matrix([[5]]))
    False
    """
    return isinstance(x, dia_matrix)


# This namespace class separates array from matrix with isinstance
class dia_array(_dia_base, sparray):
    """
    Sparse array with DIAgonal storage.

    This can be instantiated in several ways:
        dia_array(D)
            where D is a 2-D ndarray

        dia_array(S)
            with another sparse array or matrix S (equivalent to S.todia())

        dia_array((M, N), [dtype])
            to construct an empty array with shape (M, N),
            dtype is optional, defaulting to dtype='d'.

        dia_array((data, offsets), shape=(M, N))
            where the ``data[k,:]`` stores the diagonal entries for
            diagonal ``offsets[k]`` (See example below)

    Attributes
    ----------
    dtype : dtype
        Data type of the array
    shape : 2-tuple
        Shape of the array
    ndim : int
        Number of dimensions (this is always 2)
    nnz
    size
    data
        DIA format data array of the array
    offsets
        DIA format offset array of the array
    T

    Notes
    -----

    Sparse arrays can be used in arithmetic operations: they support
    addition, subtraction, multiplication, division, and matrix power.
    Sparse arrays with DIAgonal storage do not support slicing.

    Examples
    --------

    >>> import numpy as np
    >>> from scipy.sparse import dia_array
    >>> dia_array((3, 4), dtype=np.int8).toarray()
    array([[0, 0, 0, 0],
           [0, 0, 0, 0],
           [0, 0, 0, 0]], dtype=int8)

    >>> data = np.array([[1, 2, 3, 4]]).repeat(3, axis=0)
    >>> offsets = np.array([0, -1, 2])
    >>> dia_array((data, offsets), shape=(4, 4)).toarray()
    array([[1, 0, 3, 0],
           [1, 2, 0, 4],
           [0, 2, 3, 0],
           [0, 0, 3, 4]])

    >>> from scipy.sparse import dia_array
    >>> n = 10
    >>> ex = np.ones(n)
    >>> data = np.array([ex, 2 * ex, ex])
    >>> offsets = np.array([-1, 0, 1])
    >>> dia_array((data, offsets), shape=(n, n)).toarray()
    array([[2., 1., 0., ..., 0., 0., 0.],
           [1., 2., 1., ..., 0., 0., 0.],
           [0., 1., 2., ..., 0., 0., 0.],
           ...,
           [0., 0., 0., ..., 2., 1., 0.],
           [0., 0., 0., ..., 1., 2., 1.],
           [0., 0., 0., ..., 0., 1., 2.]])
    """


class dia_matrix(spmatrix, _dia_base):
    """
    Sparse matrix with DIAgonal storage.

    This can be instantiated in several ways:
        dia_matrix(D)
            where D is a 2-D ndarray

        dia_matrix(S)
            with another sparse array or matrix S (equivalent to S.todia())

        dia_matrix((M, N), [dtype])
            to construct an empty matrix with shape (M, N),
            dtype is optional, defaulting to dtype='d'.

        dia_matrix((data, offsets), shape=(M, N))
            where the ``data[k,:]`` stores the diagonal entries for
            diagonal ``offsets[k]`` (See example below)

    Attributes
    ----------
    dtype : dtype
        Data type of the matrix
    shape : 2-tuple
        Shape of the matrix
    ndim : int
        Number of dimensions (this is always 2)
    nnz
    size
    data
        DIA format data array of the matrix
    offsets
        DIA format offset array of the matrix
    T

    Notes
    -----

    Sparse matrices can be used in arithmetic operations: they support
    addition, subtraction, multiplication, division, and matrix power.
    Sparse matrices with DIAgonal storage do not support slicing.

    Examples
    --------

    >>> import numpy as np
    >>> from scipy.sparse import dia_matrix
    >>> dia_matrix((3, 4), dtype=np.int8).toarray()
    array([[0, 0, 0, 0],
           [0, 0, 0, 0],
           [0, 0, 0, 0]], dtype=int8)

    >>> data = np.array([[1, 2, 3, 4]]).repeat(3, axis=0)
    >>> offsets = np.array([0, -1, 2])
    >>> dia_matrix((data, offsets), shape=(4, 4)).toarray()
    array([[1, 0, 3, 0],
           [1, 2, 0, 4],
           [0, 2, 3, 0],
           [0, 0, 3, 4]])

    >>> from scipy.sparse import dia_matrix
    >>> n = 10
    >>> ex = np.ones(n)
    >>> data = np.array([ex, 2 * ex, ex])
    >>> offsets = np.array([-1, 0, 1])
    >>> dia_matrix((data, offsets), shape=(n, n)).toarray()
    array([[2., 1., 0., ..., 0., 0., 0.],
           [1., 2., 1., ..., 0., 0., 0.],
           [0., 1., 2., ..., 0., 0., 0.],
           ...,
           [0., 0., 0., ..., 2., 1., 0.],
           [0., 0., 0., ..., 1., 2., 1.],
           [0., 0., 0., ..., 0., 1., 2.]])
    """
