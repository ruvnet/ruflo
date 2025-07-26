"""Base class for sparse matrix formats using compressed storage."""
__all__ = []

from warnings import warn
import itertools

import numpy as np
from scipy._lib._util import _prune_array, copy_if_needed

from ._base import _spbase, issparse, sparray, SparseEfficiencyWarning
from ._data import _data_matrix, _minmax_mixin
from . import _sparsetools
from ._sparsetools import (get_csr_submatrix, csr_sample_offsets, csr_todense,
                           csr_sample_values, csr_row_index, csr_row_slice,
                           csr_column_index1, csr_column_index2, csr_diagonal,
                           expandptr, csr_has_canonical_format, csr_eliminate_zeros,
                           csr_sum_duplicates, csr_has_sorted_indices, csr_sort_indices,
                           csr_matmat_maxnnz, csr_matmat)
from ._index import IndexMixin
from ._sputils import (upcast, upcast_char, to_native, isshape,
                       getdtype, isintlike, downcast_intp_index,
                       get_sum_dtype, check_shape, get_index_dtype, broadcast_shapes)


class _cs_matrix(_data_matrix, _minmax_mixin, IndexMixin):
    """
    base array/matrix class for compressed row- and column-oriented arrays/matrices
    """

    def __init__(self, arg1, shape=None, dtype=None, copy=False, *, maxprint=None):
        _data_matrix.__init__(self, arg1, maxprint=maxprint)

        if issparse(arg1):
            if arg1.format == self.format and copy:
                arg1 = arg1.copy()
            else:
                arg1 = arg1.asformat(self.format)
            self.indptr, self.indices, self.data, self._shape = (
                arg1.indptr, arg1.indices, arg1.data, arg1._shape
            )

        elif isinstance(arg1, tuple):
            if isshape(arg1, allow_nd=self._allow_nd):
                # It's a tuple of matrix dimensions (M, N)
                # create empty matrix
                self._shape = check_shape(arg1, allow_nd=self._allow_nd)
                M, N = self._swap(self._shape_as_2d)
                # Select index dtype large enough to pass array and
                # scalar parameters to sparsetools
                idx_dtype = self._get_index_dtype(maxval=max(self.shape))
                self.data = np.zeros(0, getdtype(dtype, default=float))
                self.indices = np.zeros(0, idx_dtype)
                self.indptr = np.zeros(M + 1, dtype=idx_dtype)
            else:
                if len(arg1) == 2:
                    # (data, ij) format
                    coo = self._coo_container(arg1, shape=shape, dtype=dtype)
                    arrays = coo._coo_to_compressed(self._swap)
                    self.indptr, self.indices, self.data, self._shape = arrays
                    self.sum_duplicates()
                elif len(arg1) == 3:
                    # (data, indices, indptr) format
                    (data, indices, indptr) = arg1

                    # Select index dtype large enough to pass array and
                    # scalar parameters to sparsetools
                    maxval = None
                    if shape is not None and 0 not in shape:
                        maxval = max(shape)
                    idx_dtype = self._get_index_dtype((indices, indptr),
                                                maxval=maxval,
                                                check_contents=True)

                    if not copy:
                        copy = copy_if_needed
                    self.indices = np.array(indices, copy=copy, dtype=idx_dtype)
                    self.indptr = np.array(indptr, copy=copy, dtype=idx_dtype)
                    self.data = np.array(data, copy=copy, dtype=dtype)
                else:
                    raise ValueError(f"unrecognized {self.__class__.__name__} "
                                     f"constructor input: {arg1}")

        else:
            # must be dense
            try:
                arg1 = np.asarray(arg1)
            except Exception as e:
                raise ValueError(f"unrecognized {self.__class__.__name__} "
                                 f"constructor input: {arg1}") from e
            if isinstance(self, sparray) and arg1.ndim != 2 and self.format == "csc":
                raise ValueError(f"CSC arrays don't support {arg1.ndim}D input. Use 2D")
            if arg1.ndim > 2:
                raise ValueError(f"CSR arrays don't yet support {arg1.ndim}D.")

            coo = self._coo_container(arg1, dtype=dtype)
            arrays = coo._coo_to_compressed(self._swap)
            self.indptr, self.indices, self.data, self._shape = arrays

        # Read matrix dimensions given, if any
        if shape is not None:
            self._shape = check_shape(shape, allow_nd=self._allow_nd)
        elif self.shape is None:
            # shape not already set, try to infer dimensions
            try:
                M = len(self.indptr) - 1
                N = self.indices.max() + 1
            except Exception as e:
                raise ValueError('unable to infer matrix dimensions') from e

            self._shape = check_shape(self._swap((M, N)), allow_nd=self._allow_nd)

        if dtype is not None:
            newdtype = getdtype(dtype)
            self.data = self.data.astype(newdtype, copy=False)

        self.check_format(full_check=False)

    def _getnnz(self, axis=None):
        if axis is None:
            return int(self.indptr[-1])
        elif self.ndim == 1:
            if axis in (0, -1):
                return int(self.indptr[-1])
            raise ValueError('axis out of bounds')
        else:
            if axis < 0:
                axis += 2
            axis, _ = self._swap((axis, 1 - axis))
            _, N = self._swap(self.shape)
            if axis == 0:
                return np.bincount(downcast_intp_index(self.indices), minlength=N)
            elif axis == 1:
                return np.diff(self.indptr)
            raise ValueError('axis out of bounds')

    _getnnz.__doc__ = _spbase._getnnz.__doc__

    def count_nonzero(self, axis=None):
        self.sum_duplicates()
        if axis is None:
            return np.count_nonzero(self.data)

        if self.ndim == 1:
            if axis not in (0, -1):
                raise ValueError('axis out of bounds')
            return np.count_nonzero(self.data)

        if axis < 0:
            axis += 2
        axis, _ = self._swap((axis, 1 - axis))
        if axis == 0:
            _, N = self._swap(self.shape)
            mask = self.data != 0
            idx = self.indices if mask.all() else self.indices[mask]
            return np.bincount(downcast_intp_index(idx), minlength=N)
        elif axis == 1:
            if self.data.all():
                return np.diff(self.indptr)
            pairs = itertools.pairwise(self.indptr)
            return np.array([np.count_nonzero(self.data[i:j]) for i, j in pairs])
        else:
            raise ValueError('axis out of bounds')

    count_nonzero.__doc__ = _spbase.count_nonzero.__doc__

    def check_format(self, full_check=True):
        """Check whether the array/matrix respects the CSR or CSC format.

        Parameters
        ----------
        full_check : bool, optional
            If `True`, run rigorous check, scanning arrays for valid values.
            Note that activating those check might copy arrays for casting,
            modifying indices and index pointers' inplace.
            If `False`, run basic checks on attributes. O(1) operations.
            Default is `True`.
        """
        # index arrays should have integer data types
        if self.indptr.dtype.kind != 'i':
            warn(f"indptr array has non-integer dtype ({self.indptr.dtype.name})",
                 stacklevel=3)
        if self.indices.dtype.kind != 'i':
            warn(f"indices array has non-integer dtype ({self.indices.dtype.name})",
                 stacklevel=3)

        # check array shapes
        for x in [self.data.ndim, self.indices.ndim, self.indptr.ndim]:
            if x != 1:
                raise ValueError('data, indices, and indptr should be 1-D')

        # check index pointer. Use _swap to determine proper bounds
        M, N = self._swap(self._shape_as_2d)

        if (len(self.indptr) != M + 1):
            raise ValueError(f"index pointer size {len(self.indptr)} should be {M + 1}")
        if (self.indptr[0] != 0):
            raise ValueError("index pointer should start with 0")

        # check index and data arrays
        if (len(self.indices) != len(self.data)):
            raise ValueError("indices and data should have the same size")
        if (self.indptr[-1] > len(self.indices)):
            raise ValueError("Last value of index pointer should be less than "
                             "the size of index and data arrays")

        self.prune()

        if full_check:
            # check format validity (more expensive)
            if self.nnz > 0:
                if self.indices.max() >= N:
                    raise ValueError(f"indices must be < {N}")
                if self.indices.min() < 0:
                    raise ValueError("indices must be >= 0")
                if np.diff(self.indptr).min() < 0:
                    raise ValueError("indptr must be a non-decreasing sequence")

            idx_dtype = self._get_index_dtype((self.indptr, self.indices))
            self.indptr = np.asarray(self.indptr, dtype=idx_dtype)
            self.indices = np.asarray(self.indices, dtype=idx_dtype)
            self.data = to_native(self.data)

        # if not self.has_sorted_indices():
        #    warn('Indices were not in sorted order.  Sorting indices.')
        #    self.sort_indices()
        #    assert(self.has_sorted_indices())
        # TODO check for duplicates?

    #######################
    # Boolean comparisons #
    #######################

    def _scalar_binopt(self, other, op):
        """Scalar version of self._binopt, for cases in which no new nonzeros
        are added. Produces a new sparse array in canonical form.
        """
        self.sum_duplicates()
        res = self._with_data(op(self.data, other), copy=True)
        res.eliminate_zeros()
        return res

    #################################
    # Arithmetic operator overrides #
    #################################

    def _add_dense(self, other):
        if other.shape != self.shape:
            raise ValueError(f'Incompatible shapes ({self.shape} and {other.shape})')
        dtype = upcast_char(self.dtype.char, other.dtype.char)
        order = self._swap('CF')[0]
        result = np.array(other, dtype=dtype, order=order, copy=True)
        y = result if result.flags.c_contiguous else result.T
        M, N = self._swap(self._shape_as_2d)
        csr_todense(M, N, self.indptr, self.indices, self.data, y)
        return self._container(result, copy=False)

    def _add_sparse(self, other):
        return self._binopt(other, '_plus_')

    def _sub_sparse(self, other):
        return self._binopt(other, '_minus_')

    def _multiply_2d_with_broadcasting(self, other):
        """Element-wise multiplication by array/matrix, vector, or scalar."""
        # Called after checking that other is not scalarlike and self.ndim <=2
        if issparse(other):
            if self.shape == other.shape:
                other = self.__class__(other)
                return self._binopt(other, '_elmul_')
            # Single element.
            if other.shape == (1, 1):
                result = self._mul_scalar(other.toarray()[0, 0])
                if self.ndim == 1:
                    return result.reshape((1, self.shape[0]))
                return result
            if other.shape == (1,):
                return self._mul_scalar(other.toarray()[0])
            if self.shape in ((1,), (1, 1)):
                return other._mul_scalar(self.data.sum())

            # broadcast. treat 1d like a row
            sM, sN = self._shape_as_2d
            oM, oN = other._shape_as_2d
            # A row times a column.
            if sM == 1 and oN == 1:
                return other._matmul_sparse(self.reshape(sM, sN).tocsc())
            if sN == 1 and oM == 1:
                return self._matmul_sparse(other.reshape(oM, oN).tocsc())

            is_array = isinstance(self, sparray)
            # Other is a row.
            if oM == 1 and sN == oN:
                new_other = _make_diagonal_csr(other.toarray().ravel(), is_array)
                result = self._matmul_sparse(new_other)
                return result if self.ndim == 2 else result.reshape((1, oN))
            # self is a row.
            if sM == 1 and sN == oN:
                copy = _make_diagonal_csr(self.toarray().ravel(), is_array)
                return other._matmul_sparse(copy)

            # Other is a column.
            if oN == 1 and sM == oM:
                new_other = _make_diagonal_csr(other.toarray().ravel(), is_array)
                return new_other._matmul_sparse(self)
            # self is a column.
            if sN == 1 and sM == oM:
                new_self = _make_diagonal_csr(self.toarray().ravel(), is_array)
                return new_self._matmul_sparse(other)
            raise ValueError(f"inconsistent shapes {self.shape} and {other.shape}")

        # Assume other is a dense matrix/array, which produces a single-item
        # object array if other isn't convertible to ndarray.
        other = np.asanyarray(other)

        if other.ndim > 2:
            return np.multiply(self.toarray(), other)
        # Single element / wrapped object.
        if other.size == 1:
            if other.dtype == np.object_:
                # 'other' not convertible to ndarray.
                return NotImplemented
            bshape = broadcast_shapes(self.shape, other.shape)
            return self._mul_scalar(other.flat[0]).reshape(bshape)
        # Fast case for trivial sparse matrix.
        if self.shape in ((1,), (1, 1)):
            bshape = broadcast_shapes(self.shape, other.shape)
            return np.multiply(self.data.sum(), other).reshape(bshape)

        ret = self.tocoo()
        # Matching shapes.
        if self.shape == other.shape:
            data = np.multiply(ret.data, other[ret.coords])
            ret.data = data.view(np.ndarray).ravel()
            return ret

        # convert other to 2d
        other2d = np.atleast_2d(other)
        # Sparse row vector times...
        if self.shape[0] == 1 or self.ndim == 1:
            if other2d.shape[1] == 1:  # Dense column vector.
                data = np.multiply(ret.data, other2d)
            elif other2d.shape[1] == self.shape[-1]:  # Dense 2d matrix.
                data = np.multiply(ret.data, other2d[:, ret.col])
            else:
                raise ValueError(f"inconsistent shapes {self.shape} and {other.shape}")
            idx_dtype = self._get_index_dtype(ret.col,
                                              maxval=ret.nnz * other2d.shape[0])
            row = np.repeat(np.arange(other2d.shape[0], dtype=idx_dtype), ret.nnz)
            col = np.tile(ret.col.astype(idx_dtype, copy=False), other2d.shape[0])
            return self._coo_container(
                (data.view(np.ndarray).ravel(), (row, col)),
                shape=(other2d.shape[0], self.shape[-1]),
                copy=False
            )
        # Sparse column vector times...
        if self.shape[1] == 1:
            if other2d.shape[0] == 1:  # Dense row vector.
                data = np.multiply(ret.data[:, None], other2d)
            elif other2d.shape[0] == self.shape[0]:  # Dense 2d array.
                data = np.multiply(ret.data[:, None], other2d[ret.row])
            else:
                raise ValueError(f"inconsistent shapes {self.shape} and {other.shape}")
            idx_dtype = self._get_index_dtype(ret.row,
                                              maxval=ret.nnz * other2d.shape[1])
            row = np.repeat(ret.row.astype(idx_dtype, copy=False), other2d.shape[1])
            col = np.tile(np.arange(other2d.shape[1], dtype=idx_dtype), ret.nnz)
            return self._coo_container(
                (data.view(np.ndarray).ravel(), (row, col)),
                shape=(self.shape[0], other2d.shape[1]),
                copy=False
            )
        # Sparse matrix times dense row vector.
        if other2d.shape[0] == 1 and self.shape[1] == other2d.shape[1]:
            data = np.multiply(ret.data, other2d[:, ret.col].ravel())
        # Sparse matrix times dense column vector.
        elif other2d.shape[1] == 1 and self.shape[0] == other2d.shape[0]:
            data = np.multiply(ret.data, other2d[ret.row].ravel())
        else:
            raise ValueError(f"inconsistent shapes {self.shape} and {other.shape}")
        ret.data = data.view(np.ndarray).ravel()
        return ret

    ###########################
    # Multiplication handlers #
    ###########################

    def _matmul_vector(self, other):
        M, N = self._shape_as_2d

        # output array
        result = np.zeros(M, dtype=upcast_char(self.dtype.char, other.dtype.char))

        # csr_matvec or csc_matvec
        fn = getattr(_sparsetools, self.format + '_matvec')
        fn(M, N, self.indptr, self.indices, self.data, other, result)

        return result[0] if self.ndim == 1 else result

    def _matmul_multivector(self, other):
        M, N = self._shape_as_2d
        n_vecs = other.shape[-1]  # number of column vectors

        result = np.zeros((M, n_vecs),
                          dtype=upcast_char(self.dtype.char, other.dtype.char))

        # csr_matvecs or csc_matvecs
        fn = getattr(_sparsetools, self.format + '_matvecs')
        fn(M, N, n_vecs, self.indptr, self.indices, self.data,
           other.ravel(), result.ravel())

        if self.ndim == 1:
            return result.reshape((n_vecs,))
        return result

    def _matmul_sparse(self, other):
        M, K1 = self._shape_as_2d
        # if other is 1d, treat as a **column**
        o_ndim = other.ndim
        if o_ndim == 1:
            # convert 1d array to a 2d column when on the right of @
            other = other.reshape((1, other.shape[0])).T  # Note: converts to CSC
        K2, N = other._shape if other.ndim == 2 else (other.shape[0], 1)

        # find new_shape: (M, N), (M,), (N,) or ()
        new_shape = ()
        if self.ndim == 2:
            new_shape += (M,)
        if o_ndim == 2:
            new_shape += (N,)
        faux_shape = (M if self.ndim == 2 else 1, N if o_ndim == 2 else 1)

        other = self.__class__(other)  # convert to this format
        index_arrays = (self.indptr, self.indices, other.indptr, other.indices)

        M, N = self._swap((M, N))
        s, o = self._swap((self, other))

        idx_dtype = self._get_index_dtype(index_arrays)
        s_indptr = np.asarray(s.indptr, dtype=idx_dtype)
        s_indices = np.asarray(s.indices, dtype=idx_dtype)
        o_indptr = np.asarray(o.indptr, dtype=idx_dtype)
        o_indices = np.asarray(o.indices, dtype=idx_dtype)

        nnz = csr_matmat_maxnnz(M, N, s_indptr, s_indices, o_indptr, o_indices)
        if nnz == 0:
            if new_shape == ():
                return np.array(0, dtype=upcast(self.dtype, other.dtype))
            return self.__class__(new_shape, dtype=upcast(self.dtype, other.dtype))

        new_idx_dtype = self._get_index_dtype(index_arrays, maxval=nnz)
        if new_idx_dtype != idx_dtype:
            idx_dtype = new_idx_dtype
            s_indptr = np.asarray(s.indptr, dtype=idx_dtype)
            s_indices = np.asarray(s.indices, dtype=idx_dtype)
            o_indptr = np.asarray(o.indptr, dtype=idx_dtype)
            o_indices = np.asarray(o.indices, dtype=idx_dtype)

        indptr = np.empty(M + 1, dtype=idx_dtype)
        indices = np.empty(nnz, dtype=idx_dtype)
        data = np.empty(nnz, dtype=upcast(self.dtype, other.dtype))

        csr_matmat(M, N,
                   s_indptr, s_indices, s.data,
                   o_indptr, o_indices, o.data,
                   indptr, indices, data)

        if new_shape == ():
            return np.array(data[0])
        res = self.__class__((data, indices, indptr), shape=faux_shape)
        if faux_shape != new_shape:
            if res.format != 'csr':
                res = res.tocsr()
            res = res.reshape(new_shape)
        return res

    def diagonal(self, k=0):
        M, N = self._swap(self.shape)
        k, _ = self._swap((k, -k))

        if k <= -M or k >= N:
            return np.empty(0, dtype=self.data.dtype)
        y = np.empty(min(M + min(k, 0), N - max(k, 0)), dtype=upcast(self.dtype))
        csr_diagonal(k, M, N, self.indptr, self.indices, self.data, y)
        return y

    diagonal.__doc__ = _spbase.diagonal.__doc__

    #####################
    # Reduce operations #
    #####################

    def sum(self, axis=None, dtype=None, out=None):
        """Sum the array/matrix over the given axis.  If the axis is None, sum
        over both rows and columns, returning a scalar.
        """
        # The _spbase base class already does axis=None and major axis efficiently
        # so we only do the case axis= minor axis
        if (self.ndim == 2 and not hasattr(self, 'blocksize') and
                axis in self._swap(((1, -1), (0, -2)))[0]):
            # faster than multiplication for large minor axis in CSC/CSR
            res_dtype = get_sum_dtype(self.dtype)
            ret = np.zeros(len(self.indptr) - 1, dtype=res_dtype)

            major_index, value = self._minor_reduce(np.add)
            ret[major_index] = value
            ret = self._ascontainer(ret)
            if axis % 2 == 1:
                ret = ret.T

            return ret.sum(axis=(), dtype=dtype, out=out)
        else:
            return _spbase.sum(self, axis=axis, dtype=dtype, out=out)

    sum.__doc__ = _spbase.sum.__doc__

    def _minor_reduce(self, ufunc, data=None):
        """Reduce nonzeros with a ufunc over the minor axis when non-empty

        Can be applied to a function of self.data by supplying data parameter.

        Warning: this does not call sum_duplicates()

        Returns
        -------
        major_index : array of ints
            Major indices where nonzero

        value : array of self.dtype
            Reduce result for nonzeros in each major_index
        """
        if data is None:
            data = self.data
        major_index = np.flatnonzero(np.diff(self.indptr))
        value = ufunc.reduceat(data,
                               downcast_intp_index(self.indptr[major_index]))
        return major_index, value

    #######################
    # Getting and Setting #
    #######################

    def _get_intXint(self, row, col):
        M, N = self._swap(self.shape)
        major, minor = self._swap((row, col))
        indptr, indices, data = get_csr_submatrix(
            M, N, self.indptr, self.indices, self.data,
            major, major + 1, minor, minor + 1)
        return data.sum(dtype=self.dtype)

    def _get_sliceXslice(self, row, col):
        major, minor = self._swap((row, col))
        if major.step in (1, None) and minor.step in (1, None):
            return self._get_submatrix(major, minor, copy=True)
        return self._major_slice(major)._minor_slice(minor)

    def _get_arrayXarray(self, row, col):
        # inner indexing
        idx_dtype = self.indices.dtype
        M, N = self._swap(self.shape)
        major, minor = self._swap((row, col))
        major = np.asarray(major, dtype=idx_dtype)
        minor = np.asarray(minor, dtype=idx_dtype)

        val = np.empty(major.size, dtype=self.dtype)
        csr_sample_values(M, N, self.indptr, self.indices, self.data,
                          major.size, major.ravel(), minor.ravel(), val)
        if major.ndim == 1:
            return self._ascontainer(val)
        return self.__class__(val.reshape(major.shape))

    def _get_columnXarray(self, row, col):
        # outer indexing
        major, minor = self._swap((row, col))
        return self._major_index_fancy(major)._minor_index_fancy(minor)

    def _major_index_fancy(self, idx):
        """Index along the major axis where idx is an array of ints.
        """
        idx_dtype = self._get_index_dtype((self.indptr, self.indices))
        indices = np.asarray(idx, dtype=idx_dtype).ravel()

        N = self._swap(self._shape_as_2d)[1]
        M = len(indices)
        new_shape = self._swap((M, N)) if self.ndim == 2 else (M,)
        if M == 0:
            return self.__class__(new_shape, dtype=self.dtype)

        row_nnz = (self.indptr[indices + 1] - self.indptr[indices]).astype(idx_dtype)
        res_indptr = np.zeros(M + 1, dtype=idx_dtype)
        np.cumsum(row_nnz, out=res_indptr[1:])

        nnz = res_indptr[-1]
        res_indices = np.empty(nnz, dtype=idx_dtype)
        res_data = np.empty(nnz, dtype=self.dtype)
        csr_row_index(
            M,
            indices,
            self.indptr.astype(idx_dtype, copy=False),
            self.indices.astype(idx_dtype, copy=False),
            self.data,
            res_indices,
            res_data
        )

        return self.__class__((res_data, res_indices, res_indptr),
                              shape=new_shape, copy=False)

    def _major_slice(self, idx, copy=False):
        """Index along the major axis where idx is a slice object.
        """
        if idx == slice(None):
            return self.copy() if copy else self

        M, N = self._swap(self._shape_as_2d)
        start, stop, step = idx.indices(M)
        M = len(range(start, stop, step))
        new_shape = self._swap((M, N)) if self.ndim == 2 else (M,)
        if M == 0:
            return self.__class__(new_shape, dtype=self.dtype)

        # Work out what slices are needed for `row_nnz`
        # start,stop can be -1, only if step is negative
        start0, stop0 = start, stop
        if stop == -1 and start >= 0:
            stop0 = None
        start1, stop1 = start + 1, stop + 1

        row_nnz = self.indptr[start1:stop1:step] - \
            self.indptr[start0:stop0:step]
        idx_dtype = self.indices.dtype
        res_indptr = np.zeros(M+1, dtype=idx_dtype)
        np.cumsum(row_nnz, out=res_indptr[1:])

        if step == 1:
            all_idx = slice(self.indptr[start], self.indptr[stop])
            res_indices = np.array(self.indices[all_idx], copy=copy)
            res_data = np.array(self.data[all_idx], copy=copy)
        else:
            nnz = res_indptr[-1]
            res_indices = np.empty(nnz, dtype=idx_dtype)
            res_data = np.empty(nnz, dtype=self.dtype)
            csr_row_slice(start, stop, step, self.indptr, self.indices,
                          self.data, res_indices, res_data)

        return self.__class__((res_data, res_indices, res_indptr),
                              shape=new_shape, copy=False)

    def _minor_index_fancy(self, idx):
        """Index along the minor axis where idx is an array of ints.
        """
        idx_dtype = self._get_index_dtype((self.indices, self.indptr))
        indices = self.indices.astype(idx_dtype, copy=False)
        indptr = self.indptr.astype(idx_dtype, copy=False)

        idx = np.asarray(idx, dtype=idx_dtype).ravel()

        M, N = self._swap(self._shape_as_2d)
        k = len(idx)
        new_shape = self._swap((M, k)) if self.ndim == 2 else (k,)
        if k == 0:
            return self.__class__(new_shape, dtype=self.dtype)

        # pass 1: count idx entries and compute new indptr
        col_offsets = np.zeros(N, dtype=idx_dtype)
        res_indptr = np.empty_like(self.indptr, dtype=idx_dtype)
        csr_column_index1(
            k,
            idx,
            M,
            N,
            indptr,
            indices,
            col_offsets,
            res_indptr,
        )

        # pass 2: copy indices/data for selected idxs
        col_order = np.argsort(idx).astype(idx_dtype, copy=False)
        nnz = res_indptr[-1]
        res_indices = np.empty(nnz, dtype=idx_dtype)
        res_data = np.empty(nnz, dtype=self.dtype)
        csr_column_index2(col_order, col_offsets, len(self.indices),
                          indices, self.data, res_indices, res_data)
        return self.__class__((res_data, res_indices, res_indptr),
                              shape=new_shape, copy=False)

    def _minor_slice(self, idx, copy=False):
        """Index along the minor axis where idx is a slice object.
        """
        if idx == slice(None):
            return self.copy() if copy else self

        M, N = self._swap(self._shape_as_2d)
        start, stop, step = idx.indices(N)
        N = len(range(start, stop, step))
        if N == 0:
            return self.__class__(self._swap((M, N)), dtype=self.dtype)
        if step == 1:
            return self._get_submatrix(minor=idx, copy=copy)
        # TODO: don't fall back to fancy indexing here
        return self._minor_index_fancy(np.arange(start, stop, step))

    def _get_submatrix(self, major=None, minor=None, copy=False):
        """Return a submatrix of this matrix.

        major, minor: None, int, or slice with step 1
        """
        M, N = self._swap(self._shape_as_2d)
        i0, i1 = _process_slice(major, M)
        j0, j1 = _process_slice(minor, N)

        if i0 == 0 and j0 == 0 and i1 == M and j1 == N:
            return self.copy() if copy else self

        indptr, indices, data = get_csr_submatrix(
            M, N, self.indptr, self.indices, self.data, i0, i1, j0, j1)

        shape = self._swap((i1 - i0, j1 - j0))
        if self.ndim == 1:
            shape = (shape[1],)
        return self.__class__((data, indices, indptr), shape=shape,
                              dtype=self.dtype, copy=False)

    def _set_intXint(self, row, col, x):
        i, j = self._swap((row, col))
        self._set_many(i, j, x)

    def _set_arrayXarray(self, row, col, x):
        i, j = self._swap((row, col))
        self._set_many(i, j, x)

    def _set_arrayXarray_sparse(self, row, col, x):
        # clear entries that will be overwritten
        self._zero_many(*self._swap((row, col)))

        M, N = row.shape  # matches col.shape
        broadcast_row = M != 1 and x.shape[0] == 1
        broadcast_col = N != 1 and x.shape[1] == 1
        r, c = x.row, x.col

        x = np.asarray(x.data, dtype=self.dtype)
        if x.size == 0:
            return

        if broadcast_row:
            r = np.repeat(np.arange(M), len(r))
            c = np.tile(c, M)
            x = np.tile(x, M)
        if broadcast_col:
            r = np.repeat(r, N)
            c = np.tile(np.arange(N), len(c))
            x = np.repeat(x, N)
        # only assign entries in the new sparsity structure
        i, j = self._swap((row[r, c], col[r, c]))
        self._set_many(i, j, x)

    def _setdiag(self, values, k):
        if 0 in self.shape:
            return
        if self.ndim == 1:
            raise NotImplementedError('diagonals cant be set in 1d arrays')

        M, N = self.shape
        broadcast = (values.ndim == 0)

        if k < 0:
            if broadcast:
                max_index = min(M + k, N)
            else:
                max_index = min(M + k, N, len(values))
            i = np.arange(-k, max_index - k, dtype=self.indices.dtype)
            j = np.arange(max_index, dtype=self.indices.dtype)

        else:
            if broadcast:
                max_index = min(M, N - k)
            else:
                max_index = min(M, N - k, len(values))
            i = np.arange(max_index, dtype=self.indices.dtype)
            j = np.arange(k, k + max_index, dtype=self.indices.dtype)

        if not broadcast:
            values = values[:len(i)]

        x = np.atleast_1d(np.asarray(values, dtype=self.dtype)).ravel()
        if x.squeeze().shape != i.squeeze().shape:
            x = np.broadcast_to(x, i.shape)
        if x.size == 0:
            return

        M, N = self._swap((M, N))
        i, j = self._swap((i, j))
        n_samples = x.size
        offsets = np.empty(n_samples, dtype=self.indices.dtype)
        ret = csr_sample_offsets(M, N, self.indptr, self.indices, n_samples,
                                 i, j, offsets)
        if ret == 1:
            # rinse and repeat
            self.sum_duplicates()
            csr_sample_offsets(M, N, self.indptr, self.indices, n_samples,
                               i, j, offsets)
        if -1 not in offsets:
            # only affects existing non-zero cells
            self.data[offsets] = x
            return

        mask = (offsets >= 0)
        # Boundary between csc and convert to coo
        # The value 0.001 is justified in gh-19962#issuecomment-1920499678
        if self.nnz - mask.sum() < self.nnz * 0.001:
            # replace existing entries
            self.data[offsets[mask]] = x[mask]
            # create new entries
            mask = ~mask
            i = i[mask]
            j = j[mask]
            self._insert_many(i, j, x[mask])
        else:
            # convert to coo for _set_diag
            coo = self.tocoo()
            coo._setdiag(values, k)
            arrays = coo._coo_to_compressed(self._swap)
            self.indptr, self.indices, self.data, _ = arrays

    def _prepare_indices(self, i, j):
        M, N = self._swap(self._shape_as_2d)

        def check_bounds(indices, bound):
            idx = indices.max()
            if idx >= bound:
                raise IndexError(f'index ({idx}) out of range (>= {bound})')
            idx = indices.min()
            if idx < -bound:
                raise IndexError(f'index ({idx}) out of range (< -{bound})')

        i = np.atleast_1d(np.asarray(i, dtype=self.indices.dtype)).ravel()
        j = np.atleast_1d(np.asarray(j, dtype=self.indices.dtype)).ravel()
        check_bounds(i, M)
        check_bounds(j, N)
        return i, j, M, N

    def _set_many(self, i, j, x):
        """Sets value at each (i, j) to x

        Here (i,j) index major and minor respectively, and must not contain
        duplicate entries.
        """
        i, j, M, N = self._prepare_indices(i, j)
        x = np.atleast_1d(np.asarray(x, dtype=self.dtype)).ravel()

        n_samples = x.size
        offsets = np.empty(n_samples, dtype=self.indices.dtype)
        ret = csr_sample_offsets(M, N, self.indptr, self.indices, n_samples,
                                 i, j, offsets)
        if ret == 1:
            # rinse and repeat
            self.sum_duplicates()
            csr_sample_offsets(M, N, self.indptr, self.indices, n_samples,
                               i, j, offsets)

        if -1 not in offsets:
            # only affects existing non-zero cells
            self.data[offsets] = x
            return

        else:
            warn(f"Changing the sparsity structure of a {self.__class__.__name__} is"
                 " expensive. lil and dok are more efficient.",
                 SparseEfficiencyWarning, stacklevel=3)
            # replace where possible
            mask = offsets > -1
            self.data[offsets[mask]] = x[mask]
            # only insertions remain
            mask = ~mask
            i = i[mask]
            i[i < 0] += M
            j = j[mask]
            j[j < 0] += N
            self._insert_many(i, j, x[mask])

    def _zero_many(self, i, j):
        """Sets value at each (i, j) to zero, preserving sparsity structure.

        Here (i,j) index major and minor respectively.
        """
        i, j, M, N = self._prepare_indices(i, j)

        n_samples = len(i)
        offsets = np.empty(n_samples, dtype=self.indices.dtype)
        ret = csr_sample_offsets(M, N, self.indptr, self.indices, n_samples,
                                 i, j, offsets)
        if ret == 1:
            # rinse and repeat
            self.sum_duplicates()
            csr_sample_offsets(M, N, self.indptr, self.indices, n_samples,
                               i, j, offsets)

        # only assign zeros to the existing sparsity structure
        self.data[offsets[offsets > -1]] = 0

    def _insert_many(self, i, j, x):
        """Inserts new nonzero at each (i, j) with value x

        Here (i,j) index major and minor respectively.
        i, j and x must be non-empty, 1d arrays.
        Inserts each major group (e.g. all entries per row) at a time.
        Maintains has_sorted_indices property.
        Modifies i, j, x in place.
        """
        order = np.argsort(i, kind='mergesort')  # stable for duplicates
        i = i.take(order, mode='clip')
        j = j.take(order, mode='clip')
        x = x.take(order, mode='clip')

        do_sort = self.has_sorted_indices

        # Update index data type
        idx_dtype = self._get_index_dtype((self.indices, self.indptr),
                                    maxval=(self.indptr[-1] + x.size))
        self.indptr = np.asarray(self.indptr, dtype=idx_dtype)
        self.indices = np.asarray(self.indices, dtype=idx_dtype)
        i = np.asarray(i, dtype=idx_dtype)
        j = np.asarray(j, dtype=idx_dtype)

        # Collate old and new in chunks by major index
        indices_parts = []
        data_parts = []
        ui, ui_indptr = np.unique(i, return_index=True)
        ui_indptr = np.append(ui_indptr, len(j))
        new_nnzs = np.diff(ui_indptr)
        prev = 0
        for c, (ii, js, je) in enumerate(zip(ui, ui_indptr, ui_indptr[1:])):
            # old entries
            start = self.indptr[prev]
            stop = self.indptr[ii]
            indices_parts.append(self.indices[start:stop])
            data_parts.append(self.data[start:stop])

            # handle duplicate j: keep last setting
            uj, uj_indptr = np.unique(j[js:je][::-1], return_index=True)
            if len(uj) == je - js:
                indices_parts.append(j[js:je])
                data_parts.append(x[js:je])
            else:
                indices_parts.append(j[js:je][::-1][uj_indptr])
                data_parts.append(x[js:je][::-1][uj_indptr])
                new_nnzs[c] = len(uj)

            prev = ii

        # remaining old entries
        start = self.indptr[ii]
        indices_parts.append(self.indices[start:])
        data_parts.append(self.data[start:])

        # update attributes
        self.indices = np.concatenate(indices_parts)
        self.data = np.concatenate(data_parts)
        nnzs = np.empty(self.indptr.shape, dtype=idx_dtype)
        nnzs[0] = idx_dtype(0)
        indptr_diff = np.diff(self.indptr)
        indptr_diff[ui] += new_nnzs
        nnzs[1:] = indptr_diff
        self.indptr = np.cumsum(nnzs, out=nnzs)

        if do_sort:
            # TODO: only sort where necessary
            self.has_sorted_indices = False
            self.sort_indices()

        self.check_format(full_check=False)

    ######################
    # Conversion methods #
    ######################

    def tocoo(self, copy=True):
        if self.ndim == 1:
            csr = self.tocsr()
            return self._coo_container((csr.data, (csr.indices,)), csr.shape, copy=copy)
        major_dim, minor_dim = self._swap(self.shape)
        minor_indices = self.indices
        major_indices = np.empty(len(minor_indices), dtype=self.indices.dtype)
        expandptr(major_dim, self.indptr, major_indices)
        coords = self._swap((major_indices, minor_indices))

        return self._coo_container(
            (self.data, coords), self.shape, copy=copy, dtype=self.dtype
        )

    tocoo.__doc__ = _spbase.tocoo.__doc__

    def toarray(self, order=None, out=None):
        if out is None and order is None:
            order = self._swap('cf')[0]
        out = self._process_toarray_args(order, out)
        if not (out.flags.c_contiguous or out.flags.f_contiguous):
            raise ValueError('Output array must be C or F contiguous')
        # align ideal order with output array order
        if out.flags.c_contiguous:
            x = self.tocsr()
            y = out
        else:
            x = self.tocsc()
            y = out.T
        M, N = x._swap(x._shape_as_2d)
        csr_todense(M, N, x.indptr, x.indices, x.data, y)
        return out

    toarray.__doc__ = _spbase.toarray.__doc__

    ##############################################################
    # methods that examine or modify the internal data structure #
    ##############################################################

    def eliminate_zeros(self):
        """Remove zero entries from the array/matrix

        This is an *in place* operation.
        """
        M, N = self._swap(self._shape_as_2d)
        csr_eliminate_zeros(M, N, self.indptr, self.indices, self.data)
        self.prune()  # nnz may have changed

    @property
    def has_canonical_format(self) -> bool:
        """Whether the array/matrix has sorted indices and no duplicates

        Returns
            - True: if the above applies
            - False: otherwise

        has_canonical_format implies has_sorted_indices, so if the latter flag
        is False, so will the former be; if the former is found True, the
        latter flag is also set.
        """
        # first check to see if result was cached
        if not getattr(self, '_has_sorted_indices', True):
            # not sorted => not canonical
            self._has_canonical_format = False
        elif not hasattr(self, '_has_canonical_format'):
            M = len(self.indptr) - 1
            self.has_canonical_format = bool(
                csr_has_canonical_format(M, self.indptr, self.indices)
            )
        return self._has_canonical_format

    @has_canonical_format.setter
    def has_canonical_format(self, val: bool):
        self._has_canonical_format = bool(val)
        if val:
            self.has_sorted_indices = True

    def sum_duplicates(self):
        """Eliminate duplicate entries by adding them together

        This is an *in place* operation.
        """
        if self.has_canonical_format:
            return
        self.sort_indices()

        M, N = self._swap(self._shape_as_2d)
        csr_sum_duplicates(M, N, self.indptr, self.indices, self.data)

        self.prune()  # nnz may have changed
        self.has_canonical_format = True

    @property
    def has_sorted_indices(self) -> bool:
        """Whether the indices are sorted

        Returns
            - True: if the indices of the array/matrix are in sorted order
            - False: otherwise
        """
        # first check to see if result was cached
        if not hasattr(self, '_has_sorted_indices'):
            M = len(self.indptr) - 1
            self._has_sorted_indices = bool(
                csr_has_sorted_indices(M, self.indptr, self.indices)
            )
        return self._has_sorted_indices

    @has_sorted_indices.setter
    def has_sorted_indices(self, val: bool):
        self._has_sorted_indices = bool(val)


    def sorted_indices(self):
        """Return a copy of this array/matrix with sorted indices
        """
        A = self.copy()
        A.sort_indices()
        return A

        # an alternative that has linear complexity is the following
        # although the previous option is typically faster
        # return self.toother().toother()

    def sort_indices(self):
        """Sort the indices of this array/matrix *in place*
        """
        if not self.has_sorted_indices:
            M = len(self.indptr) - 1
            csr_sort_indices(M, self.indptr, self.indices, self.data)
            self.has_sorted_indices = True

    def prune(self):
        """Remove empty space after all non-zero elements.
        """
        major_dim = self._swap(self._shape_as_2d)[0]

        if len(self.indptr) != major_dim + 1:
            raise ValueError('index pointer has invalid length')
        if len(self.indices) < self.nnz:
            raise ValueError('indices array has fewer than nnz elements')
        if len(self.data) < self.nnz:
            raise ValueError('data array has fewer than nnz elements')

        self.indices = _prune_array(self.indices[:self.nnz])
        self.data = _prune_array(self.data[:self.nnz])

    def resize(self, *shape):
        shape = check_shape(shape, allow_nd=self._allow_nd)

        if hasattr(self, 'blocksize'):
            bm, bn = self.blocksize
            new_M, rm = divmod(shape[0], bm)
            new_N, rn = divmod(shape[1], bn)
            if rm or rn:
                raise ValueError(f"shape must be divisible into {self.blocksize}"
                                 f" blocks. Got {shape}")
            M, N = self.shape[0] // bm, self.shape[1] // bn
        else:
            new_M, new_N = self._swap(shape if len(shape)>1 else (1, shape[0]))
            M, N = self._swap(self._shape_as_2d)

        if new_M < M:
            self.indices = self.indices[:self.indptr[new_M]]
            self.data = self.data[:self.indptr[new_M]]
            self.indptr = self.indptr[:new_M + 1]
        elif new_M > M:
            self.indptr = np.resize(self.indptr, new_M + 1)
            self.indptr[M + 1:].fill(self.indptr[M])

        if new_N < N:
            mask = self.indices < new_N
            if not np.all(mask):
                self.indices = self.indices[mask]
                self.data = self.data[mask]
                major_index, val = self._minor_reduce(np.add, mask)
                self.indptr.fill(0)
                self.indptr[1:][major_index] = val
                np.cumsum(self.indptr, out=self.indptr)

        self._shape = shape

    resize.__doc__ = _spbase.resize.__doc__

    ###################
    # utility methods #
    ###################

    # needed by _data_matrix
    def _with_data(self, data, copy=True):
        """Returns a matrix with the same sparsity structure as self,
        but with different data.  By default the structure arrays
        (i.e. .indptr and .indices) are copied.
        """
        if copy:
            return self.__class__((data, self.indices.copy(),
                                   self.indptr.copy()),
                                  shape=self.shape,
                                  dtype=data.dtype)
        else:
            return self.__class__((data, self.indices, self.indptr),
                                  shape=self.shape, dtype=data.dtype)

    def _binopt(self, other, op):
        """apply the binary operation fn to two sparse matrices."""
        other = self.__class__(other)

        # e.g. csr_plus_csr, csr_minus_csr, etc.
        fn = getattr(_sparsetools, "csr" + op + "csr")

        maxnnz = self.nnz + other.nnz
        idx_dtype = self._get_index_dtype((self.indptr, self.indices,
                                     other.indptr, other.indices),
                                    maxval=maxnnz)
        indptr = np.empty(self.indptr.shape, dtype=idx_dtype)
        indices = np.empty(maxnnz, dtype=idx_dtype)

        bool_ops = ['_ne_', '_lt_', '_gt_', '_le_', '_ge_']
        if op in bool_ops:
            data = np.empty(maxnnz, dtype=np.bool_)
        else:
            data = np.empty(maxnnz, dtype=upcast(self.dtype, other.dtype))

        M, N = self._swap(self._shape_as_2d)
        fn(M, N,
           np.asarray(self.indptr, dtype=idx_dtype),
           np.asarray(self.indices, dtype=idx_dtype),
           self.data,
           np.asarray(other.indptr, dtype=idx_dtype),
           np.asarray(other.indices, dtype=idx_dtype),
           other.data,
           indptr, indices, data)

        A = self.__class__((data, indices, indptr), shape=self.shape)
        A.prune()

        return A

    def _divide_sparse(self, other):
        """
        Divide this matrix by a second sparse matrix.
        """
        if other.shape != self.shape:
            raise ValueError(f"inconsistent shapes {self.shape} and {other.shape}")

        r = self._binopt(other, '_eldiv_')

        if np.issubdtype(r.dtype, np.inexact):
            # Eldiv leaves entries outside the combined sparsity
            # pattern empty, so they must be filled manually.
            # Everything outside of other's sparsity is NaN, and everything
            # inside it is either zero or defined by eldiv.
            out = np.empty(self.shape, dtype=self.dtype)
            out.fill(np.nan)
            coords = other.nonzero()
            if self.ndim == 1:
                coords = (coords[-1],)
            out[coords] = 0
            r = r.tocoo()
            out[r.coords] = r.data
            return self._container(out)
        else:
            # integers types go with nan <-> 0
            out = r
            return out

    def _broadcast_to(self, shape, copy=False):
        if self.shape == shape:
            return self.copy() if copy else self

        shape = check_shape(shape, allow_nd=(self._allow_nd))

        if broadcast_shapes(self.shape, shape) != shape:
            raise ValueError("cannot be broadcast")

        if len(self.shape) == 1 and len(shape) == 1:
            self.sum_duplicates()
            if self.nnz == 0: # array has no non zero elements
                return self.__class__(shape, dtype=self.dtype, copy=False)

            N = shape[0]
            data = np.full(N, self.data[0])
            indices = np.arange(0,N)
            indptr = np.array([0, N])
            return self._csr_container((data, indices, indptr), shape=shape, copy=False)

        # treat 1D as a 2D row
        old_shape = self._shape_as_2d

        if len(shape) != 2:
            ndim = len(shape)
            raise ValueError(f'CSR/CSC broadcast_to cannot have shape >2D. Got {ndim}D')

        if self.nnz == 0: # array has no non zero elements
            return self.__class__(shape, dtype=self.dtype, copy=False)

        self.sum_duplicates()
        M, N = self._swap(shape)
        oM, oN = self._swap(old_shape)
        if all(s == 1 for s in old_shape):
            # Broadcast a single element to the entire shape
            data = np.full(M * N, self.data[0])
            indices = np.tile(np.arange(N), M)
            indptr = np.arange(0, len(data) + 1, N)
        elif oM == 1 and oN == N:
            # Broadcast row-wise (columns for CSC)
            data = np.tile(self.data, M)
            indices = np.tile(self.indices, M)
            indptr = np.arange(0, len(data) + 1, len(self.data))
        elif oN == 1 and oM == M:
            # Broadcast column-wise (rows for CSC)
            data = np.repeat(self.data, N)
            indices = np.tile(np.arange(N), len(self.data))
            indptr = self.indptr * N
        return self.__class__((data, indices, indptr), shape=shape, copy=False)


def _make_diagonal_csr(data, is_array=False):
    """build diagonal csc_array/csr_array => self._csr_container

    Parameter `data` should be a raveled numpy array holding the
    values on the diagonal of the resulting sparse matrix.
    """
    from ._csr import csr_array, csr_matrix
    csr_array = csr_array if is_array else csr_matrix

    N = len(data)
    idx_dtype = get_index_dtype(maxval=N)
    indptr = np.arange(N + 1, dtype=idx_dtype)
    indices = indptr[:-1]

    return csr_array((data, indices, indptr), shape=(N, N))


def _process_slice(sl, num):
    if sl is None:
        i0, i1 = 0, num
    elif isinstance(sl, slice):
        i0, i1, stride = sl.indices(num)
        if stride != 1:
            raise ValueError('slicing with step != 1 not supported')
        i0 = min(i0, i1)  # give an empty slice when i0 > i1
    elif isintlike(sl):
        if sl < 0:
            sl += num
        i0, i1 = sl, sl + 1
        if i0 < 0 or i1 > num:
            raise IndexError(f'index out of bounds: 0 <= {i0} < {i1} <= {num}')
    else:
        raise TypeError('expected slice or scalar')

    return i0, i1
