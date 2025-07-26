"""Base class for sparse matrice with a .data attribute

    subclasses must provide a _with_data() method that
    creates a new matrix with the same sparsity pattern
    as self but with a different data array

"""

import math
import numpy as np

from ._base import _spbase, sparray, _ufuncs_with_fixed_point_at_zero
from ._sputils import isscalarlike, validateaxis

__all__ = []


# TODO implement all relevant operations
# use .data.__methods__() instead of /=, *=, etc.
class _data_matrix(_spbase):
    def __init__(self, arg1, *, maxprint=None):
        _spbase.__init__(self, arg1, maxprint=maxprint)

    @property
    def dtype(self):
        return self.data.dtype

    @dtype.setter
    def dtype(self, newtype):
        self.data.dtype = newtype

    def _deduped_data(self):
        if hasattr(self, 'sum_duplicates'):
            self.sum_duplicates()
        return self.data

    def __abs__(self):
        return self._with_data(abs(self._deduped_data()))

    def __round__(self, ndigits=0):
        return self._with_data(np.around(self._deduped_data(), decimals=ndigits))

    def _real(self):
        return self._with_data(self.data.real)

    def _imag(self):
        return self._with_data(self.data.imag)

    def __neg__(self):
        if self.dtype.kind == 'b':
            raise NotImplementedError('negating a boolean sparse array is not '
                                      'supported')
        return self._with_data(-self.data)

    def __imul__(self, other):  # self *= other
        if isscalarlike(other):
            self.data *= other
            return self
        return NotImplemented

    def __itruediv__(self, other):  # self /= other
        if isscalarlike(other):
            recip = 1.0 / other
            self.data *= recip
            return self
        else:
            return NotImplemented

    def astype(self, dtype, casting='unsafe', copy=True):
        dtype = np.dtype(dtype)
        if self.dtype != dtype:
            matrix = self._with_data(
                self.data.astype(dtype, casting=casting, copy=True),
                copy=True
            )
            return matrix._with_data(matrix._deduped_data(), copy=False)
        elif copy:
            return self.copy()
        else:
            return self

    astype.__doc__ = _spbase.astype.__doc__

    def conjugate(self, copy=True):
        if np.issubdtype(self.dtype, np.complexfloating):
            return self._with_data(self.data.conjugate(), copy=copy)
        elif copy:
            return self.copy()
        else:
            return self

    conjugate.__doc__ = _spbase.conjugate.__doc__

    def copy(self):
        return self._with_data(self.data.copy(), copy=True)

    copy.__doc__ = _spbase.copy.__doc__

    def power(self, n, dtype=None):
        """
        This function performs element-wise power.

        Parameters
        ----------
        n : scalar
            n is a non-zero scalar (nonzero avoids dense ones creation)
            If zero power is desired, special case it to use `np.ones`

        dtype : If dtype is not specified, the current dtype will be preserved.

        Raises
        ------
        NotImplementedError : if n is a zero scalar
            If zero power is desired, special case it to use
            ``np.ones(A.shape, dtype=A.dtype)``
        """
        if not isscalarlike(n):
            raise NotImplementedError("input is not scalar")
        if not n:
            raise NotImplementedError(
                "zero power is not supported as it would densify the matrix.\n"
                "Use `np.ones(A.shape, dtype=A.dtype)` for this case."
            )

        data = self._deduped_data()
        if dtype is not None:
            data = data.astype(dtype, copy=False)
        return self._with_data(data ** n)

    ###########################
    # Multiplication handlers #
    ###########################

    def _mul_scalar(self, other):
        return self._with_data(self.data * other)


# Add the numpy unary ufuncs for which func(0) = 0 to _data_matrix.
for npfunc in _ufuncs_with_fixed_point_at_zero:
    name = npfunc.__name__

    def _create_method(op):
        def method(self):
            result = op(self._deduped_data())
            return self._with_data(result, copy=True)

        method.__doc__ = (f"Element-wise {name}.\n\n"
                          f"See `numpy.{name}` for more information.")
        method.__name__ = name

        return method

    setattr(_data_matrix, name, _create_method(npfunc))


def _find_missing_index(ind, n):
    for k, a in enumerate(ind):
        if k != a:
            return k

    k += 1
    if k < n:
        return k
    else:
        return -1


class _minmax_mixin:
    """Mixin for min and max methods.

    These are not implemented for dia_matrix, hence the separate class.
    """

    def _min_or_max_axis(self, axis, min_or_max, explicit):
        # already checked that self.shape[axis] is not zero
        N = self.shape[axis]
        M = self.shape[1 - axis]
        idx_dtype = self._get_index_dtype(maxval=M)

        mat = self.tocsc() if axis == 0 else self.tocsr()
        mat.sum_duplicates()

        major_index, value = mat._minor_reduce(min_or_max)
        if not explicit:
            not_full = np.diff(mat.indptr)[major_index] < N
            value[not_full] = min_or_max(value[not_full], 0)

        mask = value != 0
        major_index = np.compress(mask, major_index).astype(idx_dtype, copy=False)
        value = np.compress(mask, value)

        if isinstance(self, sparray):
            coords = (major_index,)
            shape = (M,)
            return self._coo_container((value, coords), shape=shape, dtype=self.dtype)

        if axis == 0:
            return self._coo_container(
                (value, (np.zeros(len(value), dtype=idx_dtype), major_index)),
                dtype=self.dtype, shape=(1, M)
            )
        else:
            return self._coo_container(
                (value, (major_index, np.zeros(len(value), dtype=idx_dtype))),
                dtype=self.dtype, shape=(M, 1)
            )

    def _min_or_max(self, axis, out, min_or_max, explicit):
        if out is not None:
            raise ValueError("Sparse min/max does not support an 'out' parameter.")

        axis = validateaxis(axis, ndim=self.ndim)

        if axis is None:
            if 0 in self.shape:
                raise ValueError("zero-size array to reduction operation")

            zero = self.dtype.type(0)
            if self.nnz == 0:
                return zero
            m = min_or_max.reduce(self._deduped_data().ravel())
            if self.nnz != math.prod(self.shape) and not explicit:
                m = min_or_max(zero, m)
            return m

        if any(self.shape[d] == 0 for d in axis):
            raise ValueError("zero-size array to reduction operation")

        if self.ndim == 2:
            # note: 2D ensures that len(axis)==1 so we pass in the int axis[0]
            return self._min_or_max_axis(axis[0], min_or_max, explicit)
        return self._min_or_max_axis_nd(axis, min_or_max, explicit)

    def _argminmax_axis(self, axis, argminmax, compare, explicit):
        zero = self.dtype.type(0)

        mat = self.tocsc() if axis == 0 else self.tocsr()
        mat.sum_duplicates()

        ret_size, line_size = mat._swap(mat.shape)
        ret = np.zeros(ret_size, dtype=int)

        nz_lines, = np.nonzero(np.diff(mat.indptr))
        for i in nz_lines:
            p, q = mat.indptr[i:i + 2]
            data = mat.data[p:q]
            indices = mat.indices[p:q]
            extreme_index = argminmax(data)
            extreme_value = data[extreme_index]
            if explicit:
                if q - p > 0:
                    ret[i] = indices[extreme_index]
            else:
                if compare(extreme_value, zero) or q - p == line_size:
                    ret[i] = indices[extreme_index]
                else:
                    zero_ind = _find_missing_index(indices, line_size)
                    if extreme_value == zero:
                        ret[i] = min(extreme_index, zero_ind)
                    else:
                        ret[i] = zero_ind

        if isinstance(self, sparray):
            return ret

        if axis == 1:
            ret = ret.reshape(-1, 1)

        return self._ascontainer(ret)

    def _argminmax(self, axis, out, argminmax, compare, explicit):
        if out is not None:
            minmax = "argmin" if argminmax == np.argmin else "argmax"
            raise ValueError(f"Sparse {minmax} does not support an 'out' parameter.")

        axis = validateaxis(axis, ndim=self.ndim)

        if axis is not None:
            if any(self.shape[i] == 0 for i in axis):
                minmax = "argmin" if argminmax == np.argmin else "argmax"
                raise ValueError(f"Cannot apply {minmax} along a zero-sized dimension.")

            if self.ndim == 2:
                # note: 2D ensures that len(axis)==1 so we pass in the int axis[0]
                return self._argminmax_axis(axis[0], argminmax, compare, explicit)
            return self._argminmax_axis_nd(axis, argminmax, compare, explicit)

        if 0 in self.shape:
            minmax = "argmin" if argminmax == np.argmin else "argmax"
            raise ValueError(f"Cannot apply {minmax} to an empty matrix.")

        if self.nnz == 0:
            if explicit:
                minmax = "argmin" if argminmax == np.argmin else "argmax"
                raise ValueError(f"Cannot apply {minmax} to zero matrix "
                                 "when explicit=True.")
            return 0

        zero = self.dtype.type(0)
        mat = self.tocoo()
        # Convert to canonical form: no duplicates, sorted indices.
        mat.sum_duplicates()
        extreme_index = argminmax(mat.data)
        if explicit:
            return extreme_index
        extreme_value = mat.data[extreme_index]

        if mat.ndim > 2:
            mat = mat.reshape(-1)
        # If the min value is less than zero, or max is greater than zero,
        # then we do not need to worry about implicit zeros.
        # And we use a "cheap test" for the rare case of no implicit zeros.
        maxnnz = math.prod(self.shape)
        if compare(extreme_value, zero) or mat.nnz == maxnnz:
            # cast to Python int to avoid overflow and RuntimeError
            if mat.ndim == 1:  # includes nD case that was reshaped above
                return int(mat.col[extreme_index])
            # ndim == 2
            num_col = mat.shape[-1]
            return int(mat.row[extreme_index]) * num_col + int(mat.col[extreme_index])

        # At this stage, any implicit zero could be the min or max value.
        # After sum_duplicates(), the `row` and `col` arrays are guaranteed to
        # be sorted in C-order, which means the linearized indices are sorted.
        if mat.ndim == 1:  # includes nD case that was reshaped above
            linear_indices = mat.coords[-1]
        else:  # ndim == 2
            num_col = mat.shape[-1]
            linear_indices = mat.row * num_col + mat.col
        first_implicit_zero_index = _find_missing_index(linear_indices, maxnnz)
        if extreme_value == zero:
            return min(first_implicit_zero_index, extreme_index)
        return first_implicit_zero_index

    def max(self, axis=None, out=None, *, explicit=False):
        """Return the maximum of the array/matrix or maximum along an axis.

        By default, all elements are taken into account, not just the non-zero ones.
        But with `explicit` set, only the stored elements are considered.

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None} optional
            Axis along which the sum is computed. The default is to
            compute the maximum over all elements, returning
            a scalar (i.e., `axis` = `None`).

        out : None, optional
            This argument is in the signature *solely* for NumPy
            compatibility reasons. Do not pass in anything except
            for the default value, as this argument is not used.

        explicit : {False, True} optional (default: False)
            When set to True, only the stored elements will be considered.
            If a row/column is empty, the sparse.coo_array returned
            has no stored element (i.e. an implicit zero) for that row/column.

            .. versionadded:: 1.15.0

        Returns
        -------
        amax : coo_array or scalar
            Maximum of `a`. If `axis` is None, the result is a scalar value.
            If `axis` is given, the result is a sparse.coo_array of dimension
            ``a.ndim - 1``.

        See Also
        --------
        min : The minimum value of a sparse array/matrix along a given axis.
        numpy.max : NumPy's implementation of 'max'

        """
        return self._min_or_max(axis, out, np.maximum, explicit)

    def min(self, axis=None, out=None, *, explicit=False):
        """Return the minimum of the array/matrix or maximum along an axis.

        By default, all elements are taken into account, not just the non-zero ones.
        But with `explicit` set, only the stored elements are considered.

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None} optional
            Axis along which the sum is computed. The default is to
            compute the minimum over all elements, returning
            a scalar (i.e., `axis` = `None`).

        out : None, optional
            This argument is in the signature *solely* for NumPy
            compatibility reasons. Do not pass in anything except for
            the default value, as this argument is not used.

        explicit : {False, True} optional (default: False)
            When set to True, only the stored elements will be considered.
            If a row/column is empty, the sparse.coo_array returned
            has no stored element (i.e. an implicit zero) for that row/column.

            .. versionadded:: 1.15.0

        Returns
        -------
        amin : coo_matrix or scalar
            Minimum of `a`. If `axis` is None, the result is a scalar value.
            If `axis` is given, the result is a sparse.coo_array of dimension
            ``a.ndim - 1``.

        See Also
        --------
        max : The maximum value of a sparse array/matrix along a given axis.
        numpy.min : NumPy's implementation of 'min'

        """
        return self._min_or_max(axis, out, np.minimum, explicit)

    def nanmax(self, axis=None, out=None, *, explicit=False):
        """Return the maximum, ignoring any Nans, along an axis.

        Return the maximum, ignoring any Nans, of the array/matrix along an axis.
        By default this takes all elements into account, but with `explicit` set,
        only stored elements are considered.

        .. versionadded:: 1.11.0

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None} optional
            Axis along which the maximum is computed. The default is to
            compute the maximum over all elements, returning
            a scalar (i.e., `axis` = `None`).

        out : None, optional
            This argument is in the signature *solely* for NumPy
            compatibility reasons. Do not pass in anything except
            for the default value, as this argument is not used.

        explicit : {False, True} optional (default: False)
            When set to True, only the stored elements will be considered.
            If a row/column is empty, the sparse.coo_array returned
            has no stored element (i.e. an implicit zero) for that row/column.

            .. versionadded:: 1.15.0

        Returns
        -------
        amax : coo_array or scalar
            Maximum of `a`. If `axis` is None, the result is a scalar value.
            If `axis` is given, the result is a sparse.coo_array of dimension
            ``a.ndim - 1``.

        See Also
        --------
        nanmin : The minimum value of a sparse array/matrix along a given axis,
                 ignoring NaNs.
        max : The maximum value of a sparse array/matrix along a given axis,
              propagating NaNs.
        numpy.nanmax : NumPy's implementation of 'nanmax'.

        """
        return self._min_or_max(axis, out, np.fmax, explicit)

    def nanmin(self, axis=None, out=None, *, explicit=False):
        """Return the minimum, ignoring any Nans, along an axis.

        Return the minimum, ignoring any Nans, of the array/matrix along an axis.
        By default this takes all elements into account, but with `explicit` set,
        only stored elements are considered.

        .. versionadded:: 1.11.0

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None} optional
            Axis along which the minimum is computed. The default is to
            compute the minimum over all elements, returning
            a scalar (i.e., `axis` = `None`).

        out : None, optional
            This argument is in the signature *solely* for NumPy
            compatibility reasons. Do not pass in anything except for
            the default value, as this argument is not used.

        explicit : {False, True} optional (default: False)
            When set to True, only the stored elements will be considered.
            If a row/column is empty, the sparse.coo_array returned
            has no stored element (i.e. an implicit zero) for that row/column.

            .. versionadded:: 1.15.0

        Returns
        -------
        amin : coo_array or scalar
            Minimum of `a`. If `axis` is None, the result is a scalar value.
            If `axis` is given, the result is a sparse.coo_array of dimension
            ``a.ndim - 1``.

        See Also
        --------
        nanmax : The maximum value of a sparse array/matrix along a given axis,
                 ignoring NaNs.
        min : The minimum value of a sparse array/matrix along a given axis,
              propagating NaNs.
        numpy.nanmin : NumPy's implementation of 'nanmin'.

        """
        return self._min_or_max(axis, out, np.fmin, explicit)

    def argmax(self, axis=None, out=None, *, explicit=False):
        """Return indices of maximum elements along an axis.

        By default, implicit zero elements are taken into account. If there are
        several minimum values, the index of the first occurrence is returned.
        If `explicit` is set, only explicitly stored elements will be considered.

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None}, optional
            Axis along which the argmax is computed. If None (default), index
            of the maximum element in the flatten data is returned.

        out : None, optional
            This argument is in the signature *solely* for NumPy
            compatibility reasons. Do not pass in anything except for
            the default value, as this argument is not used.

        explicit : {False, True} optional (default: False)
            When set to True, only explicitly stored elements will be considered.
            If axis is not None and an axis has no stored elements, argmax
            is undefined, so the index ``0`` is returned for that row/column.

            .. versionadded:: 1.15.0

        Returns
        -------
        ind : numpy.matrix or int
            Indices of maximum elements. If matrix, its size along `axis` is 1.
        """
        return self._argminmax(axis, out, np.argmax, np.greater, explicit)

    def argmin(self, axis=None, out=None, *, explicit=False):
        """Return indices of minimum elements along an axis.

        By default, implicit zero elements are taken into account. If there are
        several minimum values, the index of the first occurrence is returned.
        If `explicit` is set, only explicitly stored elements will be considered.

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None}, optional
            Axis along which the argmin is computed. If None (default), index
            of the minimum element in the flatten data is returned.

        out : None, optional
            This argument is in the signature *solely* for NumPy
            compatibility reasons. Do not pass in anything except for
            the default value, as this argument is not used.

        explicit : {False, True} optional (default: False)
            When set to True, only explicitly stored elements will be considered.
            If axis is not None and an axis has no stored elements, argmin
            is undefined, so the index ``0`` is returned for that row/column.

            .. versionadded:: 1.15.0

        Returns
        -------
         ind : numpy.matrix or int
            Indices of minimum elements. If matrix, its size along `axis` is 1.
        """
        return self._argminmax(axis, out, np.argmin, np.less, explicit)
