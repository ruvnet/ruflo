"""Indexing mixin for sparse array/matrix classes.
"""
import numpy as np
from ._sputils import isintlike
from ._base import sparray, issparse

INT_TYPES = (int, np.integer)


def _broadcast_arrays(a, b):
    """
    Same as np.broadcast_arrays(a, b) but old writeability rules.

    NumPy >= 1.17.0 transitions broadcast_arrays to return
    read-only arrays. Set writeability explicitly to avoid warnings.
    Retain the old writeability rules, as our Cython code assumes
    the old behavior.
    """
    x, y = np.broadcast_arrays(a, b)
    x.flags.writeable = a.flags.writeable
    y.flags.writeable = b.flags.writeable
    return x, y


class IndexMixin:
    """
    This class provides common dispatching and validation logic for indexing.
    """
    def __getitem__(self, key):
        index, new_shape = self._validate_indices(key)

        # 1D array
        if len(index) == 1:
            idx = index[0]
            if isinstance(idx, np.ndarray):
                if idx.shape == ():
                    idx = idx.item()
            if isinstance(idx, INT_TYPES):
                res = self._get_int(idx)
            elif isinstance(idx, slice):
                res = self._get_slice(idx)
            else:  # assume array idx
                res = self._get_array(idx)

            # package the result and return
            if not isinstance(self, sparray):
                return res
            # handle np.newaxis in idx when result would otherwise be a scalar
            if res.shape == () and new_shape != ():
                if len(new_shape) == 1:
                    return self.__class__([res], shape=new_shape, dtype=self.dtype)
                if len(new_shape) == 2:
                    return self.__class__([[res]], shape=new_shape, dtype=self.dtype)
            return res.reshape(new_shape)

        # 2D array
        row, col = index

        # Dispatch to specialized methods.
        if isinstance(row, INT_TYPES):
            if isinstance(col, INT_TYPES):
                res = self._get_intXint(row, col)
            elif isinstance(col, slice):
                res = self._get_intXslice(row, col)
            elif col.ndim == 1:
                res = self._get_intXarray(row, col)
            elif col.ndim == 2:
                res = self._get_intXarray(row, col)
            else:
                raise IndexError('index results in >2 dimensions')
        elif isinstance(row, slice):
            if isinstance(col, INT_TYPES):
                res = self._get_sliceXint(row, col)
            elif isinstance(col, slice):
                if row == slice(None) and row == col:
                    res = self.copy()
                else:
                    res = self._get_sliceXslice(row, col)
            elif col.ndim == 1:
                res = self._get_sliceXarray(row, col)
            else:
                raise IndexError('index results in >2 dimensions')
        else:
            if isinstance(col, INT_TYPES):
                res = self._get_arrayXint(row, col)
            elif isinstance(col, slice):
                res = self._get_arrayXslice(row, col)
            # arrayXarray preprocess
            elif (row.ndim == 2 and row.shape[1] == 1
                and (col.ndim == 1 or col.shape[0] == 1)):
                # outer indexing
                res = self._get_columnXarray(row[:, 0], col.ravel())
            else:
                # inner indexing
                row, col = _broadcast_arrays(row, col)
                if row.shape != col.shape:
                    raise IndexError('number of row and column indices differ')
                if row.size == 0:
                    res = self.__class__(np.atleast_2d(row).shape, dtype=self.dtype)
                else:
                    res = self._get_arrayXarray(row, col)

        # handle spmatrix (must be 2d, dont let 1d new_shape start reshape)
        if not isinstance(self, sparray):
            if new_shape == () or (len(new_shape) == 1 and res.ndim != 0):
                # res handles cases not inflated by None
                return res
            if len(new_shape) == 1:
                # shape inflated to 1D by None in index. Make 2D
                new_shape = (1,) + new_shape
            # reshape if needed (when None changes shape, e.g. A[1,:,None])
            return res if new_shape == res.shape else res.reshape(new_shape)

        # package the result and return
        if res.shape != new_shape:
            # handle formats that support indexing but not 1D (lil for now)
            if self.format == "lil" and len(new_shape) != 2:
                if res.shape == ():
                    return self._coo_container([res], shape = new_shape)
                return res.tocoo().reshape(new_shape)
            return res.reshape(new_shape)
        return res

    def __setitem__(self, key, x):
        index, _ = self._validate_indices(key)

        # 1D array
        if len(index) == 1:
            idx = index[0]

            if issparse(x):
                x = x.toarray()
            else:
                x = np.asarray(x, dtype=self.dtype)

            if isinstance(idx, INT_TYPES):
                if x.size != 1:
                    raise ValueError('Trying to assign a sequence to an item')
                self._set_int(idx, x.flat[0])
                return

            if isinstance(idx, slice):
                # check for simple case of slice that gives 1 item
                # Note: Python `range` does not use lots of memory
                idx_range = range(*idx.indices(self.shape[0]))
                N = len(idx_range)
                if N == 1 and x.size == 1:
                    self._set_int(idx_range[0], x.flat[0])
                    return
                idx = np.arange(*idx.indices(self.shape[0]))
                idx_shape = idx.shape
            else:
                idx_shape = idx.squeeze().shape
            # broadcast scalar to full 1d
            if x.squeeze().shape != idx_shape:
                x = np.broadcast_to(x, idx.shape)
            if x.size != 0:
                self._set_array(idx, x)
            return

        # 2D array
        row, col = index

        if isinstance(row, INT_TYPES) and isinstance(col, INT_TYPES):
            x = np.asarray(x, dtype=self.dtype)
            if x.size != 1:
                raise ValueError('Trying to assign a sequence to an item')
            self._set_intXint(row, col, x.flat[0])
            return

        if isinstance(row, slice):
            row = np.arange(*row.indices(self.shape[0]))[:, None]
        else:
            row = np.atleast_1d(row)

        if isinstance(col, slice):
            col = np.arange(*col.indices(self.shape[1]))[None, :]
            if row.ndim == 1:
                row = row[:, None]
        else:
            col = np.atleast_1d(col)

        i, j = _broadcast_arrays(row, col)
        if i.shape != j.shape:
            raise IndexError('number of row and column indices differ')

        if issparse(x):
            if 0 in x.shape:
                return
            if i.ndim == 1:
                # Inner indexing, so treat them like row vectors.
                i = i[None]
                j = j[None]
            x = x.tocoo(copy=False).reshape(x._shape_as_2d, copy=True)
            broadcast_row = x.shape[0] == 1 and i.shape[0] != 1
            broadcast_col = x.shape[1] == 1 and i.shape[1] != 1
            if not ((broadcast_row or x.shape[0] == i.shape[0]) and
                    (broadcast_col or x.shape[1] == i.shape[1])):
                raise ValueError('shape mismatch in assignment')
            x.sum_duplicates()
            self._set_arrayXarray_sparse(i, j, x)
        else:
            # Make x and i into the same shape
            x = np.asarray(x, dtype=self.dtype)
            if x.squeeze().shape != i.squeeze().shape:
                x = np.broadcast_to(x, i.shape)
            if x.size == 0:
                return
            x = x.reshape(i.shape)
            self._set_arrayXarray(i, j, x)

    def _validate_indices(self, key):
        """Returns two tuples: (index tuple, requested shape tuple)"""
        # single ellipsis
        if key is Ellipsis:
            return (slice(None),) * self.ndim, self.shape

        if not isinstance(key, tuple):
            key = [key]

        ellps_pos = None
        index_1st = []
        prelim_ndim = 0
        for i, idx in enumerate(key):
            if idx is Ellipsis:
                if ellps_pos is not None:
                    raise IndexError('an index can only have a single ellipsis')
                ellps_pos = i
            elif idx is None:
                index_1st.append(idx)
            elif isinstance(idx, slice) or isintlike(idx):
                index_1st.append(idx)
                prelim_ndim += 1
            elif (ix := _compatible_boolean_index(idx, self.ndim)) is not None:
                index_1st.append(ix)
                prelim_ndim += ix.ndim
            elif issparse(idx):
                # TODO: make sparse matrix indexing work for sparray
                raise IndexError(
                    'Indexing with sparse matrices is not supported '
                    'except boolean indexing where matrix and index '
                    'are equal shapes.')
            else:  # dense array
                index_1st.append(np.asarray(idx))
                prelim_ndim += 1
        ellip_slices = (self.ndim - prelim_ndim) * [slice(None)]
        if ellip_slices:
            if ellps_pos is None:
                index_1st.extend(ellip_slices)
            else:
                index_1st = index_1st[:ellps_pos] + ellip_slices + index_1st[ellps_pos:]

        # second pass (have processed ellipsis and preprocessed arrays)
        idx_shape = []
        index_ndim = 0
        index = []
        array_indices = []
        for i, idx in enumerate(index_1st):
            if idx is None:
                idx_shape.append(1)
            elif isinstance(idx, slice):
                index.append(idx)
                Ms = self._shape[index_ndim]
                len_slice = len(range(*idx.indices(Ms)))
                idx_shape.append(len_slice)
                index_ndim += 1
            elif isintlike(idx):
                N = self._shape[index_ndim]
                if not (-N <= idx < N):
                    raise IndexError(f'index ({idx}) out of range')
                idx = int(idx + N if idx < 0 else idx)
                index.append(idx)
                index_ndim += 1
            # bool array (checked in first pass)
            elif idx.dtype.kind == 'b':
                ix = idx
                tmp_ndim = index_ndim + ix.ndim
                mid_shape = self._shape[index_ndim:tmp_ndim]
                if ix.shape != mid_shape:
                    raise IndexError(
                        f"bool index {i} has shape {mid_shape} instead of {ix.shape}"
                    )
                index.extend(ix.nonzero())
                array_indices.extend(range(index_ndim, tmp_ndim))
                index_ndim = tmp_ndim
            else:  # dense array
                N = self._shape[index_ndim]
                idx = self._asindices(idx, N)
                index.append(idx)
                array_indices.append(index_ndim)
                index_ndim += 1
        if index_ndim > self.ndim:
            raise IndexError(
                f'invalid index ndim. Array is {self.ndim}D. Index needs {index_ndim}D'
            )
        if len(array_indices) > 1:
            idx_arrays = _broadcast_arrays(*(index[i] for i in array_indices))
            if any(idx_arrays[0].shape != ix.shape for ix in idx_arrays[1:]):
                shapes = " ".join(str(ix.shape) for ix in idx_arrays)
                msg = (f'shape mismatch: indexing arrays could not be broadcast '
                       f'together with shapes {shapes}')
                raise IndexError(msg)
            # TODO: handle this for nD (adjacent arrays stay, separated move to start)
            idx_shape = list(idx_arrays[0].shape) + idx_shape
        elif len(array_indices) == 1:
            arr_index = array_indices[0]
            arr_shape = list(index[arr_index].shape)
            idx_shape = idx_shape[:arr_index] + arr_shape + idx_shape[arr_index:]
        if (ndim := len(idx_shape)) > 2:
            raise IndexError(f'Only 1D or 2D arrays allowed. Index makes {ndim}D')
        return tuple(index), tuple(idx_shape)

    def _asindices(self, idx, length):
        """Convert `idx` to a valid index for an axis with a given length.

        Subclasses that need special validation can override this method.
        """
        try:
            x = np.asarray(idx)
        except (ValueError, TypeError, MemoryError) as e:
            raise IndexError('invalid index') from e

        if x.ndim not in (1, 2):
            raise IndexError('Index dimension must be 1 or 2')

        if x.size == 0:
            return x

        # Check bounds
        max_indx = x.max()
        if max_indx >= length:
            raise IndexError(f'index ({max_indx}) out of range')

        min_indx = x.min()
        if min_indx < 0:
            if min_indx < -length:
                raise IndexError(f'index ({min_indx}) out of range')
            if x is idx or not x.flags.owndata:
                x = x.copy()
            x[x < 0] += length
        return x

    def _getrow(self, i):
        """Return a copy of row i of the matrix, as a (1 x n) row vector.
        """
        M, N = self.shape
        i = int(i)
        if i < -M or i >= M:
            raise IndexError(f'index ({i}) out of range')
        if i < 0:
            i += M
        return self._get_intXslice(i, slice(None))

    def _getcol(self, i):
        """Return a copy of column i of the matrix, as a (m x 1) column vector.
        """
        M, N = self.shape
        i = int(i)
        if i < -N or i >= N:
            raise IndexError(f'index ({i}) out of range')
        if i < 0:
            i += N
        return self._get_sliceXint(slice(None), i)

    def _get_int(self, idx):
        raise NotImplementedError()

    def _get_slice(self, idx):
        raise NotImplementedError()

    def _get_array(self, idx):
        raise NotImplementedError()

    def _get_intXint(self, row, col):
        raise NotImplementedError()

    def _get_intXarray(self, row, col):
        raise NotImplementedError()

    def _get_intXslice(self, row, col):
        raise NotImplementedError()

    def _get_sliceXint(self, row, col):
        raise NotImplementedError()

    def _get_sliceXslice(self, row, col):
        raise NotImplementedError()

    def _get_sliceXarray(self, row, col):
        raise NotImplementedError()

    def _get_arrayXint(self, row, col):
        raise NotImplementedError()

    def _get_arrayXslice(self, row, col):
        raise NotImplementedError()

    def _get_columnXarray(self, row, col):
        raise NotImplementedError()

    def _get_arrayXarray(self, row, col):
        raise NotImplementedError()

    def _set_int(self, idx, x):
        raise NotImplementedError()

    def _set_array(self, idx, x):
        raise NotImplementedError()

    def _set_intXint(self, row, col, x):
        raise NotImplementedError()

    def _set_arrayXarray(self, row, col, x):
        raise NotImplementedError()

    def _set_arrayXarray_sparse(self, row, col, x):
        # Fall back to densifying x
        x = np.asarray(x.toarray(), dtype=self.dtype)
        x, _ = _broadcast_arrays(x, row)
        self._set_arrayXarray(row, col, x)


def _compatible_boolean_index(idx, desired_ndim):
    """Check for boolean array or array-like. peek before asarray for array-like"""
    # use attribute ndim to indicate a compatible array and check dtype
    # if not, look at 1st element as quick rejection of bool, else slower asanyarray
    if not hasattr(idx, 'ndim'):
        # is first element boolean?
        try:
            ix = next(iter(idx), None)
            for _ in range(desired_ndim):
                if isinstance(ix, bool):
                    break
                ix = next(iter(ix), None)
            else:
                return None
        except TypeError:
            return None
        # since first is boolean, construct array and check all elements
        idx = np.asanyarray(idx)

    if idx.dtype.kind == 'b':
        return idx
    return None
