""" A sparse matrix in COOrdinate or 'triplet' format"""

__docformat__ = "restructuredtext en"

__all__ = ['coo_array', 'coo_matrix', 'isspmatrix_coo']

import math
from warnings import warn

import numpy as np

from .._lib._util import copy_if_needed
from ._matrix import spmatrix
from ._sparsetools import (coo_tocsr, coo_todense, coo_todense_nd,
                           coo_matvec, coo_matvec_nd, coo_matmat_dense,
                           coo_matmat_dense_nd)
from ._base import issparse, SparseEfficiencyWarning, _spbase, sparray
from ._data import _data_matrix, _minmax_mixin
from ._sputils import (upcast_char, to_native, isshape, getdtype,
                       getdata, downcast_intp_index, get_index_dtype,
                       check_shape, check_reshape_kwargs, isscalarlike, isdense)

import operator


class _coo_base(_data_matrix, _minmax_mixin):
    _format = 'coo'
    _allow_nd = range(1, 65)

    def __init__(self, arg1, shape=None, dtype=None, copy=False, *, maxprint=None):
        _data_matrix.__init__(self, arg1, maxprint=maxprint)
        if not copy:
            copy = copy_if_needed

        if isinstance(arg1, tuple):
            if isshape(arg1, allow_nd=self._allow_nd):
                self._shape = check_shape(arg1, allow_nd=self._allow_nd)
                idx_dtype = self._get_index_dtype(maxval=max(self._shape))
                data_dtype = getdtype(dtype, default=float)
                self.coords = tuple(np.array([], dtype=idx_dtype)
                                     for _ in range(len(self._shape)))
                self.data = np.array([], dtype=data_dtype)
                self.has_canonical_format = True
            else:
                try:
                    obj, coords = arg1
                except (TypeError, ValueError) as e:
                    raise TypeError('invalid input format') from e

                if shape is None:
                    if any(len(idx) == 0 for idx in coords):
                        raise ValueError('cannot infer dimensions from zero '
                                         'sized index arrays')
                    shape = tuple(operator.index(np.max(idx)) + 1
                                  for idx in coords)
                self._shape = check_shape(shape, allow_nd=self._allow_nd)
                idx_dtype = self._get_index_dtype(coords,
                                                  maxval=max(self.shape),
                                                  check_contents=True)
                self.coords = tuple(np.array(idx, copy=copy, dtype=idx_dtype)
                                     for idx in coords)
                self.data = getdata(obj, copy=copy, dtype=dtype)
                self.has_canonical_format = False
        else:
            if issparse(arg1):
                if arg1.format == self.format and copy:
                    self.coords = tuple(idx.copy() for idx in arg1.coords)
                    self.data = arg1.data.astype(getdtype(dtype, arg1))  # copy=True
                    self._shape = check_shape(arg1.shape, allow_nd=self._allow_nd)
                    self.has_canonical_format = arg1.has_canonical_format
                else:
                    coo = arg1.tocoo()
                    self.coords = tuple(coo.coords)
                    self.data = coo.data.astype(getdtype(dtype, coo), copy=False)
                    self._shape = check_shape(coo.shape, allow_nd=self._allow_nd)
                    self.has_canonical_format = False
            else:
                # dense argument
                M = np.asarray(arg1)
                if not isinstance(self, sparray):
                    M = np.atleast_2d(M)
                    if M.ndim != 2:
                        raise TypeError(f'expected 2D array or matrix, not {M.ndim}D')

                self._shape = check_shape(M.shape, allow_nd=self._allow_nd)
                if shape is not None:
                    if check_shape(shape, allow_nd=self._allow_nd) != self._shape:
                        message = f'inconsistent shapes: {shape} != {self._shape}'
                        raise ValueError(message)

                index_dtype = self._get_index_dtype(maxval=max(self._shape))
                coords = M.nonzero()
                self.coords = tuple(idx.astype(index_dtype, copy=False)
                                     for idx in coords)
                self.data = getdata(M[coords], copy=copy, dtype=dtype)
                self.has_canonical_format = True

        if len(self._shape) > 2:
            self.coords = tuple(idx.astype(np.int64, copy=False) for idx in self.coords)

        self._check()

    @property
    def row(self):
        if self.ndim > 1:
            return self.coords[-2]
        result = np.zeros_like(self.col)
        result.setflags(write=False)
        return result


    @row.setter
    def row(self, new_row):
        if self.ndim < 2:
            raise ValueError('cannot set row attribute of a 1-dimensional sparse array')
        new_row = np.asarray(new_row, dtype=self.coords[-2].dtype)
        self.coords = self.coords[:-2] + (new_row,) + self.coords[-1:]

    @property
    def col(self):
        return self.coords[-1]

    @col.setter
    def col(self, new_col):
        new_col = np.asarray(new_col, dtype=self.coords[-1].dtype)
        self.coords = self.coords[:-1] + (new_col,)

    def reshape(self, *args, **kwargs):
        shape = check_shape(args, self.shape, allow_nd=self._allow_nd)
        order, copy = check_reshape_kwargs(kwargs)

        # Return early if reshape is not required
        if shape == self.shape:
            if copy:
                return self.copy()
            else:
                return self

        # When reducing the number of dimensions, we need to be careful about
        # index overflow. This is why we can't simply call
        # `np.ravel_multi_index()` followed by `np.unravel_index()` here.
        flat_coords = _ravel_coords(self.coords, self.shape, order=order)
        if len(shape) == 2:
            if order == 'C':
                new_coords = divmod(flat_coords, shape[1])
            else:
                new_coords = divmod(flat_coords, shape[0])[::-1]
        else:
            new_coords = np.unravel_index(flat_coords, shape, order=order)

        idx_dtype = self._get_index_dtype(self.coords, maxval=max(shape))
        new_coords = tuple(np.asarray(co, dtype=idx_dtype) for co in new_coords)

        # Handle copy here rather than passing on to the constructor so that no
        # copy will be made of `new_coords` regardless.
        if copy:
            new_data = self.data.copy()
        else:
            new_data = self.data

        return self.__class__((new_data, new_coords), shape=shape, copy=False)

    reshape.__doc__ = _spbase.reshape.__doc__

    def _getnnz(self, axis=None):
        if axis is None or (axis == 0 and self.ndim == 1):
            nnz = len(self.data)
            if any(len(idx) != nnz for idx in self.coords):
                raise ValueError('all index and data arrays must have the '
                                 'same length')

            if self.data.ndim != 1 or any(idx.ndim != 1 for idx in self.coords):
                raise ValueError('coordinates and data arrays must be 1-D')

            return int(nnz)

        if axis < 0:
            axis += self.ndim
        if axis >= self.ndim:
            raise ValueError('axis out of bounds')

        return np.bincount(downcast_intp_index(self.coords[1 - axis]),
                           minlength=self.shape[1 - axis])

    _getnnz.__doc__ = _spbase._getnnz.__doc__

    def count_nonzero(self, axis=None):
        self.sum_duplicates()
        if axis is None:
            return np.count_nonzero(self.data)

        if axis < 0:
            axis += self.ndim
        if axis < 0 or axis >= self.ndim:
            raise ValueError('axis out of bounds')
        mask = self.data != 0
        coord = self.coords[1 - axis][mask]
        return np.bincount(downcast_intp_index(coord), minlength=self.shape[1 - axis])

    count_nonzero.__doc__ = _spbase.count_nonzero.__doc__

    def _check(self):
        """ Checks data structure for consistency """
        if self.ndim != len(self.coords):
            raise ValueError('mismatching number of index arrays for shape; '
                             f'got {len(self.coords)}, expected {self.ndim}')

        # index arrays should have integer data types
        for i, idx in enumerate(self.coords):
            if idx.dtype.kind != 'i':
                warn(f'index array {i} has non-integer dtype ({idx.dtype.name})',
                     stacklevel=3)

        idx_dtype = self._get_index_dtype(self.coords, maxval=max(self.shape))
        self.coords = tuple(np.asarray(idx, dtype=idx_dtype)
                             for idx in self.coords)
        self.data = to_native(self.data)

        if self.nnz > 0:
            for i, idx in enumerate(self.coords):
                if idx.max() >= self.shape[i]:
                    raise ValueError(f'axis {i} index {idx.max()} exceeds '
                                     f'matrix dimension {self.shape[i]}')
                if idx.min() < 0:
                    raise ValueError(f'negative axis {i} index: {idx.min()}')

    def transpose(self, axes=None, copy=False):
        if axes is None:
            axes = range(self.ndim)[::-1]
        elif isinstance(self, sparray):
            if not hasattr(axes, "__len__") or len(axes) != self.ndim:
                raise ValueError("axes don't match matrix dimensions")
            if len(set(axes)) != self.ndim:
                raise ValueError("repeated axis in transpose")
        elif axes != (1, 0):
            raise ValueError("Sparse matrices do not support an 'axes' "
                             "parameter because swapping dimensions is the "
                             "only logical permutation.")

        permuted_shape = tuple(self._shape[i] for i in axes)
        permuted_coords = tuple(self.coords[i] for i in axes)
        return self.__class__((self.data, permuted_coords),
                              shape=permuted_shape, copy=copy)

    transpose.__doc__ = _spbase.transpose.__doc__

    def resize(self, *shape) -> None:
        shape = check_shape(shape, allow_nd=self._allow_nd)
        if self.ndim > 2:
            raise ValueError("only 1-D or 2-D input accepted")
        if len(shape) > 2:
            raise ValueError("shape argument must be 1-D or 2-D")
        # Check for added dimensions.
        if len(shape) > self.ndim:
            flat_coords = _ravel_coords(self.coords, self.shape)
            max_size = math.prod(shape)
            self.coords = np.unravel_index(flat_coords[:max_size], shape)
            self.data = self.data[:max_size]
            self._shape = shape
            return

        # Check for removed dimensions.
        if len(shape) < self.ndim:
            tmp_shape = (
                self._shape[:len(shape) - 1]  # Original shape without last axis
                + (-1,)  # Last axis is used to flatten the array
                + (1,) * (self.ndim - len(shape))  # Pad with ones
            )
            tmp = self.reshape(tmp_shape)
            self.coords = tmp.coords[:len(shape)]
            self._shape = tmp.shape[:len(shape)]

        # Handle truncation of existing dimensions.
        is_truncating = any(old > new for old, new in zip(self.shape, shape))
        if is_truncating:
            mask = np.logical_and.reduce([
                idx < size for idx, size in zip(self.coords, shape)
            ])
            if not mask.all():
                self.coords = tuple(idx[mask] for idx in self.coords)
                self.data = self.data[mask]

        self._shape = shape

    resize.__doc__ = _spbase.resize.__doc__

    def toarray(self, order=None, out=None):
        B = self._process_toarray_args(order, out)
        fortran = int(B.flags.f_contiguous)
        if not fortran and not B.flags.c_contiguous:
            raise ValueError("Output array must be C or F contiguous")
        # This handles both 0D and 1D cases correctly regardless of the
        # original shape.
        if self.ndim == 1:
            coo_todense_nd(np.array([1]), self.nnz, self.ndim,
                           self.coords[0], self.data, B.ravel('A'), fortran)
        elif self.ndim == 2:
            M, N = self.shape
            coo_todense(M, N, self.nnz, self.row, self.col, self.data,
                        B.ravel('A'), fortran)
        else:  # dim>2
            if fortran:
                strides = np.append(1, np.cumprod(self.shape[:-1]))
            else:
                strides = np.append(np.cumprod(self.shape[1:][::-1])[::-1], 1)
            coords = np.concatenate(self.coords)
            coo_todense_nd(strides, self.nnz, self.ndim,
                           coords, self.data, B.ravel('A'), fortran)
        # Note: reshape() doesn't copy here, but does return a new array (view).
        return B.reshape(self.shape)

    toarray.__doc__ = _spbase.toarray.__doc__

    def tocsc(self, copy=False):
        """Convert this array/matrix to Compressed Sparse Column format

        Duplicate entries will be summed together.

        Examples
        --------
        >>> from numpy import array
        >>> from scipy.sparse import coo_array
        >>> row  = array([0, 0, 1, 3, 1, 0, 0])
        >>> col  = array([0, 2, 1, 3, 1, 0, 0])
        >>> data = array([1, 1, 1, 1, 1, 1, 1])
        >>> A = coo_array((data, (row, col)), shape=(4, 4)).tocsc()
        >>> A.toarray()
        array([[3, 0, 1, 0],
               [0, 2, 0, 0],
               [0, 0, 0, 0],
               [0, 0, 0, 1]])

        """
        if self.ndim != 2:
            raise ValueError(f'Cannot convert. CSC format must be 2D. Got {self.ndim}D')
        if self.nnz == 0:
            return self._csc_container(self.shape, dtype=self.dtype)
        else:
            from ._csc import csc_array
            indptr, indices, data, shape = self._coo_to_compressed(csc_array._swap)

            x = self._csc_container((data, indices, indptr), shape=shape)
            if not self.has_canonical_format:
                x.sum_duplicates()
            return x

    def tocsr(self, copy=False):
        """Convert this array/matrix to Compressed Sparse Row format

        Duplicate entries will be summed together.

        Examples
        --------
        >>> from numpy import array
        >>> from scipy.sparse import coo_array
        >>> row  = array([0, 0, 1, 3, 1, 0, 0])
        >>> col  = array([0, 2, 1, 3, 1, 0, 0])
        >>> data = array([1, 1, 1, 1, 1, 1, 1])
        >>> A = coo_array((data, (row, col)), shape=(4, 4)).tocsr()
        >>> A.toarray()
        array([[3, 0, 1, 0],
               [0, 2, 0, 0],
               [0, 0, 0, 0],
               [0, 0, 0, 1]])

        """
        if self.ndim > 2:
            raise ValueError(f'Cannot convert. CSR must be 1D or 2D. Got {self.ndim}D')
        if self.nnz == 0:
            return self._csr_container(self.shape, dtype=self.dtype)
        else:
            from ._csr import csr_array
            arrays = self._coo_to_compressed(csr_array._swap, copy=copy)
            indptr, indices, data, shape = arrays

            x = self._csr_container((data, indices, indptr), shape=self.shape)
            if not self.has_canonical_format:
                x.sum_duplicates()
            return x

    def _coo_to_compressed(self, swap, copy=False):
        """convert (shape, coords, data) to (indptr, indices, data, shape)"""
        M, N = swap(self._shape_as_2d)
        # convert idx_dtype intc to int32 for pythran.
        # tested in scipy/optimize/tests/test__numdiff.py::test_group_columns
        idx_dtype = self._get_index_dtype(self.coords, maxval=max(self.nnz, N))

        if self.ndim == 1:
            indices = self.coords[0].copy() if copy else self.coords[0]
            nnz = len(indices)
            indptr = np.array([0, nnz], dtype=idx_dtype)
            data = self.data.copy() if copy else self.data
            return indptr, indices, data, self.shape

        # ndim == 2
        major, minor = swap(self.coords)
        nnz = len(major)
        major = major.astype(idx_dtype, copy=False)
        minor = minor.astype(idx_dtype, copy=False)

        indptr = np.empty(M + 1, dtype=idx_dtype)
        indices = np.empty_like(minor, dtype=idx_dtype)
        data = np.empty_like(self.data, dtype=self.dtype)

        coo_tocsr(M, N, nnz, major, minor, self.data, indptr, indices, data)
        return indptr, indices, data, self.shape

    def tocoo(self, copy=False):
        if copy:
            return self.copy()
        else:
            return self

    tocoo.__doc__ = _spbase.tocoo.__doc__

    def todia(self, copy=False):
        if self.ndim != 2:
            raise ValueError(f'Cannot convert. DIA format must be 2D. Got {self.ndim}D')
        self.sum_duplicates()
        ks = self.col - self.row  # the diagonal for each nonzero
        diags, diag_idx = np.unique(ks, return_inverse=True)

        if len(diags) > 100:
            # probably undesired, should todia() have a maxdiags parameter?
            warn(f"Constructing a DIA matrix with {len(diags)} diagonals "
                 "is inefficient",
                 SparseEfficiencyWarning, stacklevel=2)

        #initialize and fill in data array
        if self.data.size == 0:
            data = np.zeros((0, 0), dtype=self.dtype)
        else:
            data = np.zeros((len(diags), self.col.max()+1), dtype=self.dtype)
            data[diag_idx, self.col] = self.data

        return self._dia_container((data, diags), shape=self.shape)

    todia.__doc__ = _spbase.todia.__doc__

    def todok(self, copy=False):
        if self.ndim > 2:
            raise ValueError(f'Cannot convert. DOK must be 1D or 2D. Got {self.ndim}D')
        self.sum_duplicates()
        dok = self._dok_container(self.shape, dtype=self.dtype)
        # ensure that 1d coordinates are not tuples
        if self.ndim == 1:
            coords = self.coords[0]
        else:
            coords = zip(*self.coords)

        dok._dict = dict(zip(coords, self.data))
        return dok

    todok.__doc__ = _spbase.todok.__doc__

    def diagonal(self, k=0):
        if self.ndim != 2:
            raise ValueError("diagonal requires two dimensions")
        rows, cols = self.shape
        if k <= -rows or k >= cols:
            return np.empty(0, dtype=self.data.dtype)
        diag = np.zeros(min(rows + min(k, 0), cols - max(k, 0)),
                        dtype=self.dtype)
        diag_mask = (self.row + k) == self.col

        if self.has_canonical_format:
            row = self.row[diag_mask]
            data = self.data[diag_mask]
        else:
            inds = tuple(idx[diag_mask] for idx in self.coords)
            (row, _), data = self._sum_duplicates(inds, self.data[diag_mask])
        diag[row + min(k, 0)] = data

        return diag

    diagonal.__doc__ = _data_matrix.diagonal.__doc__

    def _setdiag(self, values, k):
        if self.ndim != 2:
            raise ValueError("setting a diagonal requires two dimensions")
        M, N = self.shape
        if values.ndim and not len(values):
            return
        idx_dtype = self.row.dtype

        # Determine which triples to keep and where to put the new ones.
        full_keep = self.col - self.row != k
        if k < 0:
            max_index = min(M+k, N)
            if values.ndim:
                max_index = min(max_index, len(values))
            keep = np.logical_or(full_keep, self.col >= max_index)
            new_row = np.arange(-k, -k + max_index, dtype=idx_dtype)
            new_col = np.arange(max_index, dtype=idx_dtype)
        else:
            max_index = min(M, N-k)
            if values.ndim:
                max_index = min(max_index, len(values))
            keep = np.logical_or(full_keep, self.row >= max_index)
            new_row = np.arange(max_index, dtype=idx_dtype)
            new_col = np.arange(k, k + max_index, dtype=idx_dtype)

        # Define the array of data consisting of the entries to be added.
        if values.ndim:
            new_data = values[:max_index]
        else:
            new_data = np.empty(max_index, dtype=self.dtype)
            new_data[:] = values

        # Update the internal structure.
        self.coords = (np.concatenate((self.row[keep], new_row)),
                       np.concatenate((self.col[keep], new_col)))
        self.data = np.concatenate((self.data[keep], new_data))
        self.has_canonical_format = False

    # needed by _data_matrix
    def _with_data(self, data, copy=True):
        """Returns a matrix with the same sparsity structure as self,
        but with different data. By default the index arrays are copied.
        """
        if copy:
            coords = tuple(idx.copy() for idx in self.coords)
        else:
            coords = self.coords
        return self.__class__((data, coords), shape=self.shape, dtype=data.dtype)

    def sum_duplicates(self) -> None:
        """Eliminate duplicate entries by adding them together

        This is an *in place* operation
        """
        if self.has_canonical_format:
            return
        summed = self._sum_duplicates(self.coords, self.data)
        self.coords, self.data = summed
        self.has_canonical_format = True

    def _sum_duplicates(self, coords, data):
        # Assumes coords not in canonical format.
        if len(data) == 0:
            return coords, data
        # Sort coords w.r.t. rows, then cols. This corresponds to C-order,
        # which we rely on for argmin/argmax to return the first index in the
        # same way that numpy does (in the case of ties).
        order = np.lexsort(coords[::-1])
        coords = tuple(idx[order] for idx in coords)
        data = data[order]
        unique_mask = np.logical_or.reduce([
            idx[1:] != idx[:-1] for idx in coords
        ])
        unique_mask = np.append(True, unique_mask)
        coords = tuple(idx[unique_mask] for idx in coords)
        unique_inds, = np.nonzero(unique_mask)
        data = np.add.reduceat(data, downcast_intp_index(unique_inds), dtype=self.dtype)
        return coords, data

    def eliminate_zeros(self):
        """Remove zero entries from the array/matrix

        This is an *in place* operation
        """
        mask = self.data != 0
        self.data = self.data[mask]
        self.coords = tuple(idx[mask] for idx in self.coords)

    #######################
    # Arithmetic handlers #
    #######################

    def _add_dense(self, other):
        if other.shape != self.shape:
            raise ValueError(f'Incompatible shapes ({self.shape} and {other.shape})')
        dtype = upcast_char(self.dtype.char, other.dtype.char)
        result = np.array(other, dtype=dtype, copy=True)
        fortran = int(result.flags.f_contiguous)
        if self.ndim == 1:
            coo_todense_nd(np.array([1]), self.nnz, self.ndim,
                           self.coords[0], self.data, result.ravel('A'), fortran)
        elif self.ndim == 2:
            M, N = self._shape_as_2d
            coo_todense(M, N, self.nnz, self.row, self.col, self.data,
                        result.ravel('A'), fortran)
        else:
            if fortran:
                strides = np.append(1, np.cumprod(self.shape[:-1]))
            else:
                strides = np.append(np.cumprod(self.shape[1:][::-1])[::-1], 1)
            coords = np.concatenate(self.coords)
            coo_todense_nd(strides, self.nnz, self.ndim,
                           coords, self.data, result.ravel('A'), fortran)
        return self._container(result, copy=False)


    def _add_sparse(self, other):
        if self.ndim < 3:
            return self.tocsr()._add_sparse(other)

        if other.shape != self.shape:
            raise ValueError(f'Incompatible shapes ({self.shape} and {other.shape})')
        other = self.__class__(other)
        new_data = np.concatenate((self.data, other.data))
        new_coords = tuple(np.concatenate((self.coords, other.coords), axis=1))
        A = self.__class__((new_data, new_coords), shape=self.shape)
        return A

    def _sub_sparse(self, other):
        if self.ndim < 3:
            return self.tocsr()._sub_sparse(other)

        if other.shape != self.shape:
            raise ValueError(f'Incompatible shapes ({self.shape} and {other.shape})')
        other = self.__class__(other)
        new_data = np.concatenate((self.data, -other.data))
        new_coords = tuple(np.concatenate((self.coords, other.coords), axis=1))
        A = coo_array((new_data, new_coords), shape=self.shape)
        return A

    def _matmul_vector(self, other):
        if self.ndim > 2:
            result = np.zeros(math.prod(self.shape[:-1]),
                              dtype=upcast_char(self.dtype.char, other.dtype.char))
            shape = np.array(self.shape)
            strides = np.append(np.cumprod(shape[:-1][::-1])[::-1][1:], 1)
            coords = np.concatenate(self.coords)
            coo_matvec_nd(self.nnz, len(self.shape), strides, coords, self.data,
                          other, result)

            result = result.reshape(self.shape[:-1])
            return result

        # self.ndim <= 2
        result_shape = self.shape[0] if self.ndim > 1 else 1
        result = np.zeros(result_shape,
                          dtype=upcast_char(self.dtype.char, other.dtype.char))
        if self.ndim == 2:
            col = self.col
            row = self.row
        elif self.ndim == 1:
            col = self.coords[0]
            row = np.zeros_like(col)
        else:
            raise NotImplementedError(
                f"coo_matvec not implemented for ndim={self.ndim}")

        coo_matvec(self.nnz, row, col, self.data, other, result)
        # Array semantics return a scalar here, not a single-element array.
        if isinstance(self, sparray) and result_shape == 1:
            return result[0]
        return result

    def _rmatmul_dispatch(self, other):
        if isscalarlike(other):
            return self._mul_scalar(other)
        else:
            # Don't use asarray unless we have to
            try:
                o_ndim = other.ndim
            except AttributeError:
                other = np.asarray(other)
                o_ndim = other.ndim
            perm = tuple(range(o_ndim)[:-2]) + tuple(range(o_ndim)[-2:][::-1])
            tr = other.transpose(perm)

            s_ndim = self.ndim
            perm = tuple(range(s_ndim)[:-2]) + tuple(range(s_ndim)[-2:][::-1])
            ret = self.transpose(perm)._matmul_dispatch(tr)
            if ret is NotImplemented:
                return NotImplemented

            if s_ndim == 1 or o_ndim == 1:
                perm = range(ret.ndim)
            else:
                perm = tuple(range(ret.ndim)[:-2]) + tuple(range(ret.ndim)[-2:][::-1])
            return ret.transpose(perm)

    def _matmul_dispatch(self, other):
        if isscalarlike(other):
            return self.multiply(other)

        if not (issparse(other) or isdense(other)):
            # If it's a list or whatever, treat it like an array
            other_a = np.asanyarray(other)

            if other_a.ndim == 0 and other_a.dtype == np.object_:
                # Not interpretable as an array; return NotImplemented so that
                # other's __rmatmul__ can kick in if that's implemented.
                return NotImplemented
            # Allow custom sparse class indicated by attr sparse gh-6520
            try:
                other.shape
            except AttributeError:
                other = other_a

        if self.ndim < 3 and other.ndim < 3:
            return _spbase._matmul_dispatch(self, other)

        N = self.shape[-1]
        err_prefix = "matmul: dimension mismatch with signature"
        if other.__class__ is np.ndarray:
            if other.shape == (N,):
                return self._matmul_vector(other)
            if other.shape == (N, 1):
                result = self._matmul_vector(other.ravel())
                return result.reshape(*self.shape[:-1], 1)
            if other.ndim == 1:
                msg = f"{err_prefix} (n,k={N}),(k={other.shape[0]},)->(n,)"
                raise ValueError(msg)
            if other.shape[-2] == N:
                # check for batch dimensions compatibility
                batch_shape_A = self.shape[:-2]
                batch_shape_B = other.shape[:-2]
                if batch_shape_A != batch_shape_B:
                    try:
                        # This will raise an error if the shapes are not broadcastable
                        np.broadcast_shapes(batch_shape_A, batch_shape_B)
                    except ValueError:
                        raise ValueError("Batch dimensions are not broadcastable")

                return self._matmul_multivector(other)
            else:
                raise ValueError(
                    f"{err_prefix} (n,..,k={N}),(k={other.shape[-2]},..,m)->(n,..,m)"
                )

        if isscalarlike(other):
            # scalar value
            return self._mul_scalar(other)

        if issparse(other):
            self_is_1d = self.ndim == 1
            other_is_1d = other.ndim == 1

            # reshape to 2-D if self or other is 1-D
            if self_is_1d:
                self = self.reshape(self._shape_as_2d) # prepend 1 to shape

            if other_is_1d:
                other = other.reshape((other.shape[0], 1)) # append 1 to shape

            # Check if the inner dimensions match for matrix multiplication
            if N != other.shape[-2]:
                raise ValueError(
                    f"{err_prefix} (n,..,k={N}),(k={other.shape[-2]},..,m)->(n,..,m)"
                )

            # If A or B has more than 2 dimensions, check for
            # batch dimensions compatibility
            if self.ndim > 2 or other.ndim > 2:
                batch_shape_A = self.shape[:-2]
                batch_shape_B = other.shape[:-2]
                if batch_shape_A != batch_shape_B:
                    try:
                        # This will raise an error if the shapes are not broadcastable
                        np.broadcast_shapes(batch_shape_A, batch_shape_B)
                    except ValueError:
                        raise ValueError("Batch dimensions are not broadcastable")

            result = self._matmul_sparse(other)

            # reshape back if a or b were originally 1-D
            if self_is_1d:
                # if self was originally 1-D, reshape result accordingly
                result = result.reshape(tuple(result.shape[:-2]) +
                                        tuple(result.shape[-1:]))
            if other_is_1d:
                result = result.reshape(result.shape[:-1])
            return result

    def _matmul_multivector(self, other):
        result_dtype = upcast_char(self.dtype.char, other.dtype.char)
        if self.ndim >= 3 or other.ndim >= 3:
            # if self has shape (N,), reshape to (1,N)
            if self.ndim == 1:
                result = self.reshape(1, self.shape[0])._matmul_multivector(other)
                return result.reshape(tuple(other.shape[:-2]) + tuple(other.shape[-1:]))

            broadcast_shape = np.broadcast_shapes(self.shape[:-2], other.shape[:-2])
            self_shape = broadcast_shape + self.shape[-2:]
            other_shape = broadcast_shape + other.shape[-2:]

            self = self._broadcast_to(self_shape)
            other = np.broadcast_to(other, other_shape)
            result_shape = broadcast_shape + self.shape[-2:-1] + other.shape[-1:]
            result = np.zeros(result_shape, dtype=result_dtype)
            coo_matmat_dense_nd(self.nnz, len(self.shape), other.shape[-1],
                                np.array(other_shape), np.array(result_shape),
                                np.concatenate(self.coords),
                                self.data, other.ravel('C'), result)
            return result

        if self.ndim == 2:
            result_shape = (self.shape[0], other.shape[1])
            col = self.col
            row = self.row
        elif self.ndim == 1:
            result_shape = (other.shape[1],)
            col = self.coords[0]
            row = np.zeros_like(col)
        result = np.zeros(result_shape, dtype=result_dtype)
        coo_matmat_dense(self.nnz, other.shape[-1], row, col,
                         self.data, other.ravel('C'), result)
        return result.view(type=type(other))

    def dot(self, other):
        """Return the dot product of two arrays.

        Strictly speaking a dot product involves two vectors.
        But in the sense that an array with ndim >= 1 is a collection
        of vectors, the function computes the collection of dot products
        between each vector in the first array with each vector in the
        second array. The axis upon which the sum of products is performed
        is the last axis of the first array and the second to last axis of
        the second array. If the second array is 1-D, the last axis is used.

        Thus, if both arrays are 1-D, the inner product is returned.
        If both are 2-D, we have matrix multiplication. If `other` is 1-D,
        the sum product is taken along the last axis of each array. If
        `other` is N-D for N>=2, the sum product is over the last axis of
        the first array and the second-to-last axis of the second array.

        Parameters
        ----------
        other : array_like (dense or sparse)
            Second array

        Returns
        -------
        output : array (sparse or dense)
            The dot product of this array with `other`.
            It will be dense/sparse if `other` is dense/sparse.

        Examples
        --------

        >>> import numpy as np
        >>> from scipy.sparse import coo_array
        >>> A = coo_array([[1, 2, 0], [0, 0, 3], [4, 0, 5]])
        >>> v = np.array([1, 0, -1])
        >>> A.dot(v)
        array([ 1, -3, -1], dtype=int64)

        For 2-D arrays it is the matrix product:

        >>> A = coo_array([[1, 0], [0, 1]])
        >>> B = coo_array([[4, 1], [2, 2]])
        >>> A.dot(B).toarray()
        array([[4, 1],
               [2, 2]])

        For 3-D arrays the shape extends unused axes by other unused axes.

        >>> A = coo_array(np.arange(3*4*5*6)).reshape((3,4,5,6))
        >>> B = coo_array(np.arange(3*4*5*6)).reshape((5,4,6,3))
        >>> A.dot(B).shape
        (3, 4, 5, 5, 4, 3)
        """
        # handle non-array input:  lists, ints, etc
        if not (issparse(other) or isdense(other) or isscalarlike(other)):
            # If it's a list or whatever, treat it like an array
            o_array = np.asanyarray(other)

            if o_array.ndim == 0 and o_array.dtype == np.object_:
                raise TypeError(f"dot argument not supported type: '{type(other)}'")
            try:
                other.shape
            except AttributeError:
                other = o_array

        # Handle scalar multiplication
        if isscalarlike(other):
            return self * other

        # other.shape[-2:][0] gets last index of 1d, next to last index of >1d
        if self.shape[-1] != other.shape[-2:][0]:
            raise ValueError(f"shapes {self.shape} and {other.shape}"
                             " are not aligned for n-D dot")

        if self.ndim < 3 and other.ndim < 3:
            return self @ other
        if isdense(other):
            return self._dense_dot(other)
        return self._sparse_dot(other.tocoo())

    def _sparse_dot(self, other):
        # already checked: at least one is >2d, neither scalar, both are coo
        # Ravel non-reduced axes coordinates
        self_2d, s_new_shape = _convert_to_2d(self, [self.ndim - 1])
        other_2d, o_new_shape = _convert_to_2d(other, [max(0, other.ndim - 2)])

        prod = self_2d @ other_2d.T  # routes via 2-D CSR
        prod = prod.tocoo()

        # Combine the shapes of the non-contracted axes
        combined_shape = s_new_shape + o_new_shape

        # Unravel the 2D coordinates to get multi-dimensional coordinates
        coords = []
        new_shapes = (s_new_shape, o_new_shape) if s_new_shape else (o_new_shape,)
        for c, s in zip(prod.coords, new_shapes):
            coords.extend(np.unravel_index(c, s))

        # Construct the resulting COO array with coords and shape
        return coo_array((prod.data, coords), shape=combined_shape)

    def _dense_dot(self, other):
        # already checked: self is >0d, other is dense and >0d
        # Ravel non-reduced axes coordinates
        s_ndim = self.ndim
        if s_ndim <= 2:
            s_new_shape = () if s_ndim == 1 else (self.shape[0],)
            self_2d = self
        else:
            self_2d, s_new_shape = _convert_to_2d(self, [self.ndim - 1])

        o_ndim = other.ndim
        if o_ndim <= 2:
            o_new_shape = () if o_ndim == 1 else (other.shape[-1],)
            other_2d = other
        else:
            o_new_shape = other.shape[:-2] + other.shape[-1:]
            reorder_dims = (o_ndim - 2, *range(o_ndim - 2), o_ndim - 1)
            o_reorg = np.transpose(other, reorder_dims)
            other_2d = o_reorg.reshape((other.shape[-2], math.prod(o_new_shape)))

        prod = self_2d @ other_2d  # routes via 2-D CSR

        # Combine the shapes of the non-contracted axes
        combined_shape = s_new_shape + o_new_shape
        return prod.reshape(combined_shape)


    def tensordot(self, other, axes=2):
        """Return the tensordot product with another array along the given axes.

        The tensordot differs from dot and matmul in that any axis can be
        chosen for each of the first and second array and the sum of the
        products is computed just like for matrix multiplication, only not
        just for the rows of the first times the columns of the second. It
        takes the dot product of the collection of vectors along the specified
        axes.  Here we can even take the sum of the products along two or even
        more axes if desired. So, tensordot is a dot product computation
        applied to arrays of any dimension >= 1. It is like matmul but over
        arbitrary axes for each matrix.

        Given two tensors, `a` and `b`, and the desired axes specified as a
        2-tuple/list/array containing two sequences of axis numbers,
        ``(a_axes, b_axes)``, sum the products of `a`'s and `b`'s elements
        (components) over the axes specified by ``a_axes`` and ``b_axes``.
        The `axes` input can be a single non-negative integer, ``N``;
        if it is, then the last ``N`` dimensions of `a` and the first
        ``N`` dimensions of `b` are summed over.

        Parameters
        ----------
        a, b : array_like
            Tensors to "dot".

        axes : int or (2,) array_like
            * integer_like
              If an int N, sum over the last N axes of `a` and the first N axes
              of `b` in order. The sizes of the corresponding axes must match.
            * (2,) array_like
              A 2-tuple of sequences of axes to be summed over, the first applying
              to `a`, the second to `b`. The sequences must be the same length.
              The shape of the corresponding axes must match between `a` and `b`.

        Returns
        -------
        output : coo_array
            The tensor dot product of this array with `other`.
            It will be dense/sparse if `other` is dense/sparse.

        See Also
        --------
        dot

        Examples
        --------
        >>> import numpy as np
        >>> import scipy.sparse
        >>> A = scipy.sparse.coo_array([[[2, 3], [0, 0]], [[0, 1], [0, 5]]])
        >>> A.shape
        (2, 2, 2)

        Integer axes N are shorthand for (range(-N, 0), range(0, N)):

        >>> A.tensordot(A, axes=1).toarray()
        array([[[[ 4,  9],
                 [ 0, 15]],
        <BLANKLINE>
                [[ 0,  0],
                 [ 0,  0]]],
        <BLANKLINE>
        <BLANKLINE>
               [[[ 0,  1],
                 [ 0,  5]],
        <BLANKLINE>
                [[ 0,  5],
                 [ 0, 25]]]])
        >>> A.tensordot(A, axes=2).toarray()
        array([[ 4,  6],
               [ 0, 25]])
        >>> A.tensordot(A, axes=3)
        array(39)

        Using tuple for axes:

        >>> a = scipy.sparse.coo_array(np.arange(60).reshape(3,4,5))
        >>> b = np.arange(24).reshape(4,3,2)
        >>> c = a.tensordot(b, axes=([1,0],[0,1]))
        >>> c.shape
        (5, 2)
        >>> c
        array([[4400, 4730],
               [4532, 4874],
               [4664, 5018],
               [4796, 5162],
               [4928, 5306]])

        """
        if not isdense(other) and not issparse(other):
            # If it's a list or whatever, treat it like an array
            other_array = np.asanyarray(other)

            if other_array.ndim == 0 and other_array.dtype == np.object_:
                raise TypeError(f"tensordot arg not supported type: '{type(other)}'")
            try:
                other.shape
            except AttributeError:
                other = other_array

        axes_self, axes_other = _process_axes(self.ndim, other.ndim, axes)

        # Check for shape compatibility along specified axes
        if any(self.shape[ax] != other.shape[bx]
               for ax, bx in zip(axes_self, axes_other)):
            raise ValueError("sizes of the corresponding axes must match")

        if isdense(other):
            return self._dense_tensordot(other, axes_self, axes_other)
        else:
            return self._sparse_tensordot(other, axes_self, axes_other)

    def _sparse_tensordot(self, other, s_axes, o_axes):
        # Prepare the tensors for tensordot operation
        # Ravel non-reduced axes coordinates
        self_2d, s_new_shape = _convert_to_2d(self, s_axes)
        other_2d, o_new_shape = _convert_to_2d(other, o_axes)

        # Perform matrix multiplication (routed via 2-D CSR)
        prod = self_2d @ other_2d.T
        # handle case of scalar result (axis includes all axes for both)
        if not issparse(prod):
            return prod
        prod = prod.tocoo()

        # Combine the shapes of the non-contracted axes
        combined_shape = s_new_shape + o_new_shape

        # Unravel the 2D coordinates to get multi-dimensional coordinates
        coords = []
        new_shapes = (s_new_shape, o_new_shape) if s_new_shape else (o_new_shape,)
        for c, s in zip(prod.coords, new_shapes):
            if s:
                coords.extend(np.unravel_index(c, s))

        # Construct the resulting COO array with coords and shape
        return coo_array((prod.data, coords), shape=combined_shape)

    def _dense_tensordot(self, other, s_axes, o_axes):
        s_ndim = len(self.shape)
        o_ndim = len(other.shape)

        s_non_axes = [i for i in range(s_ndim) if i not in s_axes]
        s_axes_shape = [self.shape[i] for i in s_axes]
        s_non_axes_shape = [self.shape[i] for i in s_non_axes]

        o_non_axes = [i for i in range(o_ndim) if i not in o_axes]
        o_axes_shape = [other.shape[i] for i in o_axes]
        o_non_axes_shape = [other.shape[i] for i in o_non_axes]

        left = self.transpose(s_non_axes + s_axes)
        right = np.transpose(other, o_non_axes[:-1] + o_axes + o_non_axes[-1:])

        reshape_left = (*s_non_axes_shape, math.prod(s_axes_shape))
        reshape_right = (*o_non_axes_shape[:-1], math.prod(o_axes_shape),
                         *o_non_axes_shape[-1:])

        return left.reshape(reshape_left).dot(right.reshape(reshape_right))

    def _matmul_sparse(self, other):
        """
        Perform sparse-sparse matrix multiplication for two n-D COO arrays.
        The method converts input n-D arrays to 2-D block array format,
        uses csr_matmat to multiply them, and then converts the
        result back to n-D COO array.

        Parameters:
        self (COO): The first n-D sparse array in COO format.
        other (COO): The second n-D sparse array in COO format.

        Returns:
        prod (COO): The resulting n-D sparse array after multiplication.
        """
        if self.ndim < 3 and other.ndim < 3:
            return _spbase._matmul_sparse(self, other)

        # Get the shapes of self and other
        self_shape = self.shape
        other_shape = other.shape

        # Determine the new shape to broadcast self and other
        broadcast_shape = np.broadcast_shapes(self_shape[:-2], other_shape[:-2])
        self_new_shape = tuple(broadcast_shape) + self_shape[-2:]
        other_new_shape = tuple(broadcast_shape) + other_shape[-2:]

        self_broadcasted = self._broadcast_to(self_new_shape)
        other_broadcasted = other._broadcast_to(other_new_shape)

        # Convert n-D COO arrays to 2-D block diagonal arrays
        self_block_diag = _block_diag(self_broadcasted)
        other_block_diag = _block_diag(other_broadcasted)

        # Use csr_matmat to perform sparse matrix multiplication
        prod_block_diag = (self_block_diag @ other_block_diag).tocoo()

        # Convert the 2-D block diagonal array back to n-D
        return _extract_block_diag(
            prod_block_diag,
            shape=(*broadcast_shape, self.shape[-2], other.shape[-1]),
        )

    def _broadcast_to(self, new_shape, copy=False):
        if self.shape == new_shape:
            return self.copy() if copy else self

        old_shape = self.shape

        # Check if the new shape is compatible for broadcasting
        if len(new_shape) < len(old_shape):
            raise ValueError("New shape must have at least as many dimensions"
                             " as the current shape")

        # Add leading ones to shape to ensure same length as `new_shape`
        shape = (1,) * (len(new_shape) - len(old_shape)) + tuple(old_shape)

        # Ensure the old shape can be broadcast to the new shape
        if any((o != 1 and o != n) for o, n in zip(shape, new_shape)):
            raise ValueError(f"current shape {old_shape} cannot be "
                             "broadcast to new shape {new_shape}")

        # Reshape the COO array to match the new dimensions
        self = self.reshape(shape)

        idx_dtype = get_index_dtype(self.coords, maxval=max(new_shape))
        coords = self.coords
        new_data = self.data
        new_coords = coords[-1:]  # Copy last coordinate to start
        cum_repeat = 1 # Cumulative repeat factor for broadcasting

        if shape[-1] != new_shape[-1]: # broadcasting the n-th (col) dimension
            repeat_count = new_shape[-1]
            cum_repeat *= repeat_count
            new_data = np.tile(new_data, repeat_count)
            new_dim = np.repeat(np.arange(0, repeat_count, dtype=idx_dtype), self.nnz)
            new_coords = (new_dim,)

        for i in range(-2, -(len(shape)+1), -1):
            if shape[i] != new_shape[i]:
                repeat_count = new_shape[i] # number of times to repeat data, coords
                cum_repeat *= repeat_count # update cumulative repeat factor
                nnz = len(new_data) # Number of non-zero elements so far

                # Tile data and coordinates to match the new repeat count
                new_data = np.tile(new_data, repeat_count)
                new_coords = tuple(np.tile(new_coords[i+1:], repeat_count))

                # Create new dimensions and stack them
                new_dim = np.repeat(np.arange(0, repeat_count, dtype=idx_dtype), nnz)
                new_coords = (new_dim,) + new_coords
            else:
                # If no broadcasting needed, tile the coordinates
                new_dim = np.tile(coords[i], cum_repeat)
                new_coords = (new_dim,) + new_coords

        return coo_array((new_data, new_coords), new_shape)

    def _sum_nd(self, axis, res_dtype, out):
        # axis and out are preprocessed. out.shape is new_shape
        A2d, new_shape = _convert_to_2d(self, axis)
        ones = np.ones((A2d.shape[1], 1), dtype=res_dtype)
        # sets dtype while loading into out
        out[...] = (A2d @ ones).reshape(new_shape)
        return out

    def _min_or_max_axis_nd(self, axis, min_or_max, explicit):
        A2d, new_shape = _convert_to_2d(self, axis)
        res = A2d._min_or_max_axis(1, min_or_max, explicit)
        unraveled_coords = np.unravel_index(res.coords[0], new_shape)

        return coo_array((res.data, unraveled_coords), new_shape)

    def _argminmax_axis_nd(self, axis, argminmax, compare, explicit):
        A2d, new_shape = _convert_to_2d(self, axis)
        res_flat = A2d._argminmax_axis(1, argminmax, compare, explicit)
        return res_flat.reshape(new_shape)


def _block_diag(self):
    """
    Converts an N-D COO array into a 2-D COO array in block diagonal form.

    Parameters:
    self (coo_array): An N-Dimensional COO sparse array.

    Returns:
    coo_array: A 2-Dimensional COO sparse array in block diagonal form.
    """
    if self.ndim<2:
        raise ValueError("array must have atleast dim=2")
    num_blocks = math.prod(self.shape[:-2])
    n_col = self.shape[-1]
    n_row = self.shape[-2]
    res_arr = self.reshape((num_blocks, n_row, n_col))
    new_coords = (
        res_arr.coords[1] + res_arr.coords[0] * res_arr.shape[1],
        res_arr.coords[2] + res_arr.coords[0] * res_arr.shape[2],
    )

    new_shape = (num_blocks * n_row, num_blocks * n_col)
    return coo_array((self.data, tuple(new_coords)), shape=new_shape)


def _extract_block_diag(self, shape):
    n_row, n_col = shape[-2], shape[-1]

    # Extract data and coordinates from the block diagonal COO array
    data = self.data
    row, col = self.row, self.col

    # Initialize new coordinates array
    new_coords = np.empty((len(shape), self.nnz), dtype=int)

    # Calculate within-block indices
    new_coords[-2] = row % n_row
    new_coords[-1] = col % n_col

    # Calculate coordinates for higher dimensions
    temp_block_idx = row // n_row
    for i in range(len(shape) - 3, -1, -1):
        size = shape[i]
        new_coords[i] = temp_block_idx % size
        temp_block_idx = temp_block_idx // size

    # Create the new COO array with the original n-D shape
    return coo_array((data, tuple(new_coords)), shape=shape)


def _process_axes(ndim_a, ndim_b, axes):
    if isinstance(axes, int):
        if axes < 1 or axes > min(ndim_a, ndim_b):
            raise ValueError("axes integer is out of bounds for input arrays")
        axes_a = list(range(ndim_a - axes, ndim_a))
        axes_b = list(range(axes))
    elif isinstance(axes, tuple | list):
        if len(axes) != 2:
            raise ValueError("axes must be a tuple/list of length 2")
        axes_a, axes_b = axes
        if len(axes_a) != len(axes_b):
            raise ValueError("axes lists/tuples must be of the same length")
        if any(ax >= ndim_a or ax < -ndim_a for ax in axes_a) or \
           any(bx >= ndim_b or bx < -ndim_b for bx in axes_b):
            raise ValueError("axes indices are out of bounds for input arrays")
    else:
        raise TypeError("axes must be an integer or a tuple/list of integers")

    axes_a = [axis + ndim_a if axis < 0 else axis for axis in axes_a]
    axes_b = [axis + ndim_b if axis < 0 else axis for axis in axes_b]
    return axes_a, axes_b


def _convert_to_2d(coo, axis):
    axis_coords = tuple(coo.coords[i] for i in axis)
    axis_shape = tuple(coo.shape[i] for i in axis)
    axis_ravel = _ravel_coords(axis_coords, axis_shape)

    ndim = len(coo.coords)
    non_axis = tuple(i for i in range(ndim) if i not in axis)
    if non_axis:
        non_axis_coords = tuple(coo.coords[i] for i in non_axis)
        non_axis_shape = tuple(coo.shape[i] for i in non_axis)
        non_axis_ravel = _ravel_coords(non_axis_coords, non_axis_shape)
        coords_2d = (non_axis_ravel, axis_ravel)
        shape_2d = (math.prod(non_axis_shape), math.prod(axis_shape))
    else:  # all axes included in axis so result will have 1 element
        coords_2d = (axis_ravel,)
        shape_2d = (math.prod(axis_shape),)
        non_axis_shape = ()

    new_coo = coo_array((coo.data, coords_2d), shape=shape_2d)
    return new_coo, non_axis_shape


def _ravel_coords(coords, shape, order='C'):
    """Like np.ravel_multi_index, but avoids some overflow issues."""
    if len(coords) == 1:
        return coords[0]
    # Handle overflow as in https://github.com/scipy/scipy/pull/9132
    if len(coords) == 2:
        nrows, ncols = shape
        row, col = coords
        if order == 'C':
            maxval = (ncols * max(0, nrows - 1) + max(0, ncols - 1))
            idx_dtype = get_index_dtype(maxval=maxval)
            return np.multiply(ncols, row, dtype=idx_dtype) + col
        elif order == 'F':
            maxval = (nrows * max(0, ncols - 1) + max(0, nrows - 1))
            idx_dtype = get_index_dtype(maxval=maxval)
            return np.multiply(nrows, col, dtype=idx_dtype) + row
        else:
            raise ValueError("'order' must be 'C' or 'F'")
    return np.ravel_multi_index(coords, shape, order=order)


def isspmatrix_coo(x):
    """Is `x` of coo_matrix type?

    Parameters
    ----------
    x
        object to check for being a coo matrix

    Returns
    -------
    bool
        True if `x` is a coo matrix, False otherwise

    Examples
    --------
    >>> from scipy.sparse import coo_array, coo_matrix, csr_matrix, isspmatrix_coo
    >>> isspmatrix_coo(coo_matrix([[5]]))
    True
    >>> isspmatrix_coo(coo_array([[5]]))
    False
    >>> isspmatrix_coo(csr_matrix([[5]]))
    False
    """
    return isinstance(x, coo_matrix)


# This namespace class separates array from matrix with isinstance
class coo_array(_coo_base, sparray):
    """
    A sparse array in COOrdinate format.

    Also known as the 'ijv' or 'triplet' format.

    This can be instantiated in several ways:
        coo_array(D)
            where D is an ndarray

        coo_array(S)
            with another sparse array or matrix S (equivalent to S.tocoo())

        coo_array(shape, [dtype])
            to construct an empty sparse array with shape `shape`
            dtype is optional, defaulting to dtype='d'.

        coo_array((data, coords), [shape])
            to construct from existing data and index arrays:
                1. data[:]       the entries of the sparse array, in any order
                2. coords[i][:]  the axis-i coordinates of the data entries

            Where ``A[coords] = data``, and coords is a tuple of index arrays.
            When shape is not specified, it is inferred from the index arrays.

    Attributes
    ----------
    dtype : dtype
        Data type of the sparse array
    shape : tuple of integers
        Shape of the sparse array
    ndim : int
        Number of dimensions of the sparse array
    nnz
    size
    data
        COO format data array of the sparse array
    coords
        COO format tuple of index arrays
    has_canonical_format : bool
        Whether the matrix has sorted coordinates and no duplicates
    format
    T

    Notes
    -----

    Sparse arrays can be used in arithmetic operations: they support
    addition, subtraction, multiplication, division, and matrix power.

    Advantages of the COO format
        - facilitates fast conversion among sparse formats
        - permits duplicate entries (see example)
        - very fast conversion to and from CSR/CSC formats

    Disadvantages of the COO format
        - does not directly support:
            + arithmetic operations
            + slicing

    Intended Usage
        - COO is a fast format for constructing sparse arrays
        - Once a COO array has been constructed, convert to CSR or
          CSC format for fast arithmetic and matrix vector operations
        - By default when converting to CSR or CSC format, duplicate (i,j)
          entries will be summed together.  This facilitates efficient
          construction of finite element matrices and the like. (see example)

    Canonical format
        - Entries and coordinates sorted by row, then column.
        - There are no duplicate entries (i.e. duplicate (i,j) locations)
        - Data arrays MAY have explicit zeros.

    Examples
    --------

    >>> # Constructing an empty sparse array
    >>> import numpy as np
    >>> from scipy.sparse import coo_array
    >>> coo_array((3, 4), dtype=np.int8).toarray()
    array([[0, 0, 0, 0],
           [0, 0, 0, 0],
           [0, 0, 0, 0]], dtype=int8)

    >>> # Constructing a sparse array using ijv format
    >>> row  = np.array([0, 3, 1, 0])
    >>> col  = np.array([0, 3, 1, 2])
    >>> data = np.array([4, 5, 7, 9])
    >>> coo_array((data, (row, col)), shape=(4, 4)).toarray()
    array([[4, 0, 9, 0],
           [0, 7, 0, 0],
           [0, 0, 0, 0],
           [0, 0, 0, 5]])

    >>> # Constructing a sparse array with duplicate coordinates
    >>> row  = np.array([0, 0, 1, 3, 1, 0, 0])
    >>> col  = np.array([0, 2, 1, 3, 1, 0, 0])
    >>> data = np.array([1, 1, 1, 1, 1, 1, 1])
    >>> coo = coo_array((data, (row, col)), shape=(4, 4))
    >>> # Duplicate coordinates are maintained until implicitly or explicitly summed
    >>> np.max(coo.data)
    1
    >>> coo.toarray()
    array([[3, 0, 1, 0],
           [0, 2, 0, 0],
           [0, 0, 0, 0],
           [0, 0, 0, 1]])

    """


class coo_matrix(spmatrix, _coo_base):
    """
    A sparse matrix in COOrdinate format.

    Also known as the 'ijv' or 'triplet' format.

    This can be instantiated in several ways:
        coo_matrix(D)
            where D is a 2-D ndarray

        coo_matrix(S)
            with another sparse array or matrix S (equivalent to S.tocoo())

        coo_matrix((M, N), [dtype])
            to construct an empty matrix with shape (M, N)
            dtype is optional, defaulting to dtype='d'.

        coo_matrix((data, (i, j)), [shape=(M, N)])
            to construct from three arrays:
                1. data[:]   the entries of the matrix, in any order
                2. i[:]      the row indices of the matrix entries
                3. j[:]      the column indices of the matrix entries

            Where ``A[i[k], j[k]] = data[k]``.  When shape is not
            specified, it is inferred from the index arrays

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
        COO format data array of the matrix
    row
        COO format row index array of the matrix
    col
        COO format column index array of the matrix
    has_canonical_format : bool
        Whether the matrix has sorted indices and no duplicates
    format
    T

    Notes
    -----

    Sparse matrices can be used in arithmetic operations: they support
    addition, subtraction, multiplication, division, and matrix power.

    Advantages of the COO format
        - facilitates fast conversion among sparse formats
        - permits duplicate entries (see example)
        - very fast conversion to and from CSR/CSC formats

    Disadvantages of the COO format
        - does not directly support:
            + arithmetic operations
            + slicing

    Intended Usage
        - COO is a fast format for constructing sparse matrices
        - Once a COO matrix has been constructed, convert to CSR or
          CSC format for fast arithmetic and matrix vector operations
        - By default when converting to CSR or CSC format, duplicate (i,j)
          entries will be summed together.  This facilitates efficient
          construction of finite element matrices and the like. (see example)

    Canonical format
        - Entries and coordinates sorted by row, then column.
        - There are no duplicate entries (i.e. duplicate (i,j) locations)
        - Data arrays MAY have explicit zeros.

    Examples
    --------

    >>> # Constructing an empty matrix
    >>> import numpy as np
    >>> from scipy.sparse import coo_matrix
    >>> coo_matrix((3, 4), dtype=np.int8).toarray()
    array([[0, 0, 0, 0],
           [0, 0, 0, 0],
           [0, 0, 0, 0]], dtype=int8)

    >>> # Constructing a matrix using ijv format
    >>> row  = np.array([0, 3, 1, 0])
    >>> col  = np.array([0, 3, 1, 2])
    >>> data = np.array([4, 5, 7, 9])
    >>> coo_matrix((data, (row, col)), shape=(4, 4)).toarray()
    array([[4, 0, 9, 0],
           [0, 7, 0, 0],
           [0, 0, 0, 0],
           [0, 0, 0, 5]])

    >>> # Constructing a matrix with duplicate coordinates
    >>> row  = np.array([0, 0, 1, 3, 1, 0, 0])
    >>> col  = np.array([0, 2, 1, 3, 1, 0, 0])
    >>> data = np.array([1, 1, 1, 1, 1, 1, 1])
    >>> coo = coo_matrix((data, (row, col)), shape=(4, 4))
    >>> # Duplicate coordinates are maintained until implicitly or explicitly summed
    >>> np.max(coo.data)
    1
    >>> coo.toarray()
    array([[3, 0, 1, 0],
           [0, 2, 0, 0],
           [0, 0, 0, 0],
           [0, 0, 0, 1]])

    """

    def __setstate__(self, state):
        if 'coords' not in state:
            # For retro-compatibility with the previous attributes
            # storing nnz coordinates for 2D COO matrix.
            state['coords'] = (state.pop('row'), state.pop('col'))
        self.__dict__.update(state)
