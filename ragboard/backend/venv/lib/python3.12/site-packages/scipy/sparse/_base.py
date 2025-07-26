"""Base class for sparse matrices"""

from warnings import warn
import math
import numpy as np
import operator

from ._sputils import (asmatrix, check_reshape_kwargs, check_shape,
                       get_sum_dtype, isdense, isscalarlike, _todata,
                       matrix, validateaxis, getdtype, is_pydata_spmatrix)
from scipy._lib._sparse import SparseABC, issparse

from ._matrix import spmatrix

__all__ = ['isspmatrix', 'issparse', 'sparray',
           'SparseWarning', 'SparseEfficiencyWarning']


class SparseWarning(Warning):
    """General warning for :mod:`scipy.sparse`."""
    pass


class SparseFormatWarning(SparseWarning):
    pass


class SparseEfficiencyWarning(SparseWarning):
    """The warning emitted when the operation is
    inefficient for sparse matrices.
    """
    pass


# The formats that we might potentially understand.
_formats = {'csc': [0, "Compressed Sparse Column"],
            'csr': [1, "Compressed Sparse Row"],
            'dok': [2, "Dictionary Of Keys"],
            'lil': [3, "List of Lists"],
            'dod': [4, "Dictionary of Dictionaries"],
            'sss': [5, "Symmetric Sparse Skyline"],
            'coo': [6, "COOrdinate"],
            'lba': [7, "Linpack BAnded"],
            'egd': [8, "Ellpack-itpack Generalized Diagonal"],
            'dia': [9, "DIAgonal"],
            'bsr': [10, "Block Sparse Row"],
            'msr': [11, "Modified compressed Sparse Row"],
            'bsc': [12, "Block Sparse Column"],
            'msc': [13, "Modified compressed Sparse Column"],
            'ssk': [14, "Symmetric SKyline"],
            'nsk': [15, "Nonsymmetric SKyline"],
            'jad': [16, "JAgged Diagonal"],
            'uss': [17, "Unsymmetric Sparse Skyline"],
            'vbr': [18, "Variable Block Row"],
            'und': [19, "Undefined"]
            }


# These univariate ufuncs preserve zeros.
_ufuncs_with_fixed_point_at_zero = frozenset([
        np.sin, np.tan, np.arcsin, np.arctan, np.sinh, np.tanh, np.arcsinh,
        np.arctanh, np.rint, np.sign, np.expm1, np.log1p, np.deg2rad,
        np.rad2deg, np.floor, np.ceil, np.trunc, np.sqrt])


MAXPRINT = 50


# helper dicts to manipulate comparison operators
# We negate operators (with warning) when all implicit values would be True
op_neg = {operator.eq: operator.ne, operator.ne: operator.eq,
          operator.lt: operator.ge, operator.ge: operator.lt,
          operator.gt: operator.le, operator.le: operator.gt}


# We use symbolic version of operators in warning messages.
op_sym = {operator.eq: '==', operator.ge: '>=', operator.le: '<=',
          operator.ne: '!=', operator.gt: '>', operator.lt: '<'}


# `_spbase` is a subclass of `SparseABC`.
# This allows other submodules to check for instances of sparse subclasses
# via `scipy._lib._sparse.issparse`, without introducing
# an import dependency on `scipy.sparse`.
class _spbase(SparseABC):
    """ This class provides a base class for all sparse arrays.  It
    cannot be instantiated.  Most of the work is provided by subclasses.
    """

    __array_priority__ = 10.1
    _format = 'und'  # undefined
    _allow_nd = (2,)

    @property
    def ndim(self) -> int:
        return len(self._shape)

    @property
    def _shape_as_2d(self):
        s = self._shape
        return (1, s[-1]) if len(s) == 1 else s

    @property
    def _bsr_container(self):
        from ._bsr import bsr_array
        return bsr_array

    @property
    def _coo_container(self):
        from ._coo import coo_array
        return coo_array

    @property
    def _csc_container(self):
        from ._csc import csc_array
        return csc_array

    @property
    def _csr_container(self):
        from ._csr import csr_array
        return csr_array

    @property
    def _dia_container(self):
        from ._dia import dia_array
        return dia_array

    @property
    def _dok_container(self):
        from ._dok import dok_array
        return dok_array

    @property
    def _lil_container(self):
        from ._lil import lil_array
        return lil_array

    def __init__(self, arg1, *, maxprint=None):
        self._shape = None
        if self.__class__.__name__ == '_spbase':
            raise ValueError("This class is not intended"
                             " to be instantiated directly.")
        if isinstance(self, sparray) and np.isscalar(arg1):
            raise ValueError(
                "scipy sparse array classes do not support instantiation from a scalar"
            )
        self.maxprint = MAXPRINT if maxprint is None else maxprint

    @property
    def shape(self):
        return self._shape

    def reshape(self, *args, **kwargs):
        """reshape(self, shape, order='C', copy=False)

        Gives a new shape to a sparse array/matrix without changing its data.

        Parameters
        ----------
        shape : tuple of ints
            The new shape should be compatible with the original shape.
        order : {'C', 'F'}, optional
            Read the elements using this index order. 'C' means to read and
            write the elements using C-like index order; e.g., read entire first
            row, then second row, etc. 'F' means to read and write the elements
            using Fortran-like index order; e.g., read entire first column, then
            second column, etc.
        copy : bool, optional
            Indicates whether or not attributes of self should be copied
            whenever possible. The degree to which attributes are copied varies
            depending on the type of sparse array being used.

        Returns
        -------
        reshaped : sparse array/matrix
            A sparse array/matrix with the given `shape`, not necessarily of the same
            format as the current object.

        See Also
        --------
        numpy.reshape : NumPy's implementation of 'reshape' for ndarrays
        """
        # If the shape already matches, don't bother doing an actual reshape
        # Otherwise, the default is to convert to COO and use its reshape
        # Don't restrict ndim on this first call. That happens in constructor
        shape = check_shape(args, self.shape, allow_nd=range(1, 65))
        order, copy = check_reshape_kwargs(kwargs)
        if shape == self.shape:
            if copy:
                return self.copy()
            else:
                return self

        return self.tocoo(copy=copy).reshape(shape, order=order, copy=False)

    def resize(self, shape):
        """Resize the array/matrix in-place to dimensions given by ``shape``

        Any elements that lie within the new shape will remain at the same
        indices, while non-zero elements lying outside the new shape are
        removed.

        Parameters
        ----------
        shape : (int, int)
            number of rows and columns in the new array/matrix

        Notes
        -----
        The semantics are not identical to `numpy.ndarray.resize` or
        `numpy.resize`. Here, the same data will be maintained at each index
        before and after reshape, if that index is within the new bounds. In
        numpy, resizing maintains contiguity of the array, moving elements
        around in the logical array but not within a flattened representation.

        We give no guarantees about whether the underlying data attributes
        (arrays, etc.) will be modified in place or replaced with new objects.
        """
        # As an inplace operation, this requires implementation in each format.
        raise NotImplementedError(
            f'{type(self).__name__}.resize is not implemented')

    def astype(self, dtype, casting='unsafe', copy=True):
        """Cast the array/matrix elements to a specified type.

        Parameters
        ----------
        dtype : string or numpy dtype
            Typecode or data-type to which to cast the data.
        casting : {'no', 'equiv', 'safe', 'same_kind', 'unsafe'}, optional
            Controls what kind of data casting may occur.
            Defaults to 'unsafe' for backwards compatibility.
            'no' means the data types should not be cast at all.
            'equiv' means only byte-order changes are allowed.
            'safe' means only casts which can preserve values are allowed.
            'same_kind' means only safe casts or casts within a kind,
            like float64 to float32, are allowed.
            'unsafe' means any data conversions may be done.
        copy : bool, optional
            If `copy` is `False`, the result might share some memory with this
            array/matrix. If `copy` is `True`, it is guaranteed that the result and
            this array/matrix do not share any memory.
        """

        dtype = getdtype(dtype)
        if self.dtype != dtype:
            return self.tocsr().astype(
                dtype, casting=casting, copy=copy).asformat(self.format)
        elif copy:
            return self.copy()
        else:
            return self

    @classmethod
    def _ascontainer(cls, X, **kwargs):
        if issubclass(cls, sparray):
            return np.asarray(X, **kwargs)
        else:
            return asmatrix(X, **kwargs)

    @classmethod
    def _container(cls, X, **kwargs):
        if issubclass(cls, sparray):
            return np.array(X, **kwargs)
        else:
            return matrix(X, **kwargs)

    def _asfptype(self):
        """Upcast array to a floating point format (if necessary)"""

        fp_types = ['f', 'd', 'F', 'D']

        if self.dtype.char in fp_types:
            return self
        else:
            for fp_type in fp_types:
                if self.dtype <= np.dtype(fp_type):
                    return self.astype(fp_type)

            raise TypeError(
                f'cannot upcast [{self.dtype.name}] to a floating point format'
            )

    def __iter__(self):
        for r in range(self.shape[0]):
            yield self[r]

    def _getmaxprint(self):
        """Maximum number of elements to display when printed."""
        return self.maxprint

    def count_nonzero(self, axis=None):
        """Number of non-zero entries, equivalent to

        np.count_nonzero(a.toarray(), axis=axis)

        Unlike the nnz property, which return the number of stored
        entries (the length of the data attribute), this method counts the
        actual number of non-zero entries in data.

        Duplicate entries are summed before counting.

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None} optional
            Count nonzeros for the whole array, or along a specified axis.

            .. versionadded:: 1.15.0

        Returns
        -------
        numpy array
            A reduced array (no axis `axis`) holding the number of nonzero values
            for each of the indices of the nonaxis dimensions.

        Notes
        -----
        If you want to count nonzero and explicit zero stored values (e.g. nnz)
        along an axis, two fast idioms are provided by `numpy` functions for the
        common CSR, CSC, COO formats.

        For the major axis in CSR (rows) and CSC (cols) use `np.diff`:

            >>> import numpy as np
            >>> import scipy as sp
            >>> A = sp.sparse.csr_array([[4, 5, 0], [7, 0, 0]])
            >>> major_axis_stored_values = np.diff(A.indptr)  # -> np.array([2, 1])

        For the minor axis in CSR (cols) and CSC (rows) use `numpy.bincount` with
        minlength ``A.shape[1]`` for CSR and ``A.shape[0]`` for CSC:

            >>> csr_minor_stored_values = np.bincount(A.indices, minlength=A.shape[1])

        For COO, use the minor axis approach for either `axis`:

            >>> A = A.tocoo()
            >>> coo_axis0_stored_values = np.bincount(A.coords[0], minlength=A.shape[1])
            >>> coo_axis1_stored_values = np.bincount(A.coords[1], minlength=A.shape[0])

        Examples
        --------

            >>> A = sp.sparse.csr_array([[4, 5, 0], [7, 0, 0]])
            >>> A.count_nonzero(axis=0)
            array([2, 1, 0])
        """
        clsname = self.__class__.__name__
        raise NotImplementedError(f"count_nonzero not implemented for {clsname}.")

    def _getnnz(self, axis=None):
        """Number of stored values, including explicit zeros.

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None} optional
            Report stored values for the whole array, or along a specified axis.

        See also
        --------
        count_nonzero : Number of non-zero entries
        """
        clsname = self.__class__.__name__
        raise NotImplementedError(f"getnnz not implemented for {clsname}.")

    @property
    def nnz(self) -> int:
        """Number of stored values, including explicit zeros.

        See also
        --------
        count_nonzero : Number of non-zero entries
        """
        return self._getnnz()

    @property
    def size(self) -> int:
        """Number of stored values.

        See also
        --------
        count_nonzero : Number of non-zero values.
        """
        return self._getnnz()

    @property
    def format(self) -> str:
        """Format string for matrix."""
        return self._format

    @property
    def T(self):
        """Transpose."""
        return self.transpose()

    @property
    def real(self):
        return self._real()

    @property
    def imag(self):
        return self._imag()

    def __repr__(self):
        _, format_name = _formats[self.format]
        sparse_cls = 'array' if isinstance(self, sparray) else 'matrix'
        return (
            f"<{format_name} sparse {sparse_cls} of dtype '{self.dtype}'\n"
            f"\twith {self.nnz} stored elements and shape {self.shape}>"
        )

    def __str__(self):
        maxprint = self._getmaxprint()

        A = self.tocoo()

        # helper function, outputs "(i,j)  v"
        def tostr(coords, data):
            pairs = zip(zip(*(c.tolist() for c in coords)), data)
            return '\n'.join(f'  {idx}\t{val}' for idx, val in pairs)

        out = repr(self)
        if self.nnz == 0:
            return out

        out += '\n  Coords\tValues\n'
        if self.nnz > maxprint:
            half = maxprint // 2
            out += tostr(tuple(c[:half] for c in A.coords), A.data[:half])
            out += "\n  :\t:\n"
            half = maxprint - half
            out += tostr(tuple(c[-half:] for c in A.coords), A.data[-half:])
        else:
            out += tostr(A.coords, A.data)

        return out

    def __bool__(self):  # Simple -- other ideas?
        if self.shape == (1, 1):
            return self.nnz != 0
        else:
            raise ValueError("The truth value of an array with more than one "
                             "element is ambiguous. Use a.any() or a.all().")
    __nonzero__ = __bool__

    # What should len(sparse) return? For consistency with dense matrices,
    # perhaps it should be the number of rows?  But for some uses the number of
    # non-zeros is more important.  For now, raise an exception!
    def __len__(self):
        raise TypeError("sparse array length is ambiguous; use getnnz()"
                        " or shape[0]")

    def asformat(self, format, copy=False):
        """Return this array/matrix in the passed format.

        Parameters
        ----------
        format : {str, None}
            The desired sparse format ("csr", "csc", "lil", "dok", "array", ...)
            or None for no conversion.
        copy : bool, optional
            If True, the result is guaranteed to not share data with self.

        Returns
        -------
        A : This array/matrix in the passed format.
        """
        if format is None or format == self.format:
            if copy:
                return self.copy()
            else:
                return self
        else:
            try:
                convert_method = getattr(self, 'to' + format)
            except AttributeError as e:
                raise ValueError(f'Format {format} is unknown.') from e

            # Forward the copy kwarg, if it's accepted.
            try:
                return convert_method(copy=copy)
            except TypeError:
                return convert_method()

    ###################################################################
    #  NOTE: All arithmetic operations use csr_matrix by default.
    # Therefore a new sparse array format just needs to define a
    # .tocsr() method to provide arithmetic support. Any of these
    # methods can be overridden for efficiency.
    ####################################################################

    def multiply(self, other):
        """Element-wise multiplication by another array/matrix."""
        if isscalarlike(other):
            return self._mul_scalar(other)

        if self.ndim < 3:
            return self.tocsr()._multiply_2d_with_broadcasting(other)

        if not (issparse(other) or isdense(other)):
            # If it's a list or whatever, treat it like an array
            other_a = np.asanyarray(other)
            if other_a.ndim == 0 and other_a.dtype == np.object_:
                # numpy creates a 0d object array if all else fails.
                # Not interpretable as an array; return NotImplemented so
                # other's __rmul__ can kick in if that's implemented.
                return NotImplemented
            # Allow custom sparse class indicated by attr sparse gh-6520
            try:
                other.shape
            except AttributeError:
                other = other_a

        if self.shape != other.shape:
            raise ValueError("inconsistent shapes: >2D multiply() does not yet "
                             "support broadcasting")

        # self is >2D so must be COO
        if isdense(other):
            data = np.multiply(self.data, other[self.coords])
            result = self.copy()
            result.data = data.view(np.ndarray).ravel()
            return result

        elif issparse(other):
            csr_self = self.reshape(1, -1).tocsr()
            csr_other = other.reshape(1, -1).tocsr()
            return csr_self._binopt(csr_other, '_elmul_').reshape(self.shape)

        else:
            # Not scalar, dense or sparse. Return NotImplemented so that
            # other's __rmul__ can kick in if that's implemented.
            return NotImplemented

    def _maximum_minimum(self, other, np_op):
        if not (issparse(other) or isdense(other) or isscalarlike(other)):
            # If it's a list or whatever, treat it like an array
            other_a = np.asanyarray(other)
            if other_a.ndim == 0 and other_a.dtype == np.object_:
                # numpy creates a 0d object array if all else fails.
                # We don't know how to handle it either.
                raise NotImplementedError('maximum or minimum with an unrecognized '
                                          'array type is not supported')
            # Allow custom sparse class indicated by attr sparse gh-6520
            try:
                other.shape
            except AttributeError:
                other = other_a

        if isscalarlike(other):
            if np_op(0, other):
                pos_neg = 'positive' if np_op == np.maximum else 'negative'
                warn(f"Taking {np_op.__name__} with a {pos_neg} number results in a"
                     " dense matrix.", SparseEfficiencyWarning, stacklevel=3)
                return self.__class__(np_op(self.toarray(), other))
            else:
                csr_self = (self if self.ndim < 3 else self.reshape(1, -1)).tocsr()
                result = csr_self._scalar_binopt(other, np_op)
                return result if self.ndim < 3 else result.tocoo().reshape(self.shape)
        elif isdense(other):
            return np_op(self.todense(), other)
        elif issparse(other):
            if self.shape != other.shape:
                raise ValueError(f"inconsistent shapes {self.shape=} {other.shape=}")
            if self.ndim < 3:  # shape is same so other.ndim < 3
                return self.tocsr()._binopt(other, f'_{np_op.__name__}_')
            csr_self = self.reshape(1, -1).tocsr()
            csr_other = other.reshape(1, -1).tocsr()
            result = csr_self._binopt(csr_other, f'_{np_op.__name__}_')
            return result.tocoo().reshape(self.shape)
        else:
            raise ValueError("Operands not compatible.")

    def maximum(self, other):
        """Element-wise maximum between this and another array/matrix."""
        return self._maximum_minimum(other, np.maximum)

    def minimum(self, other):
        """Element-wise minimum between this and another array/matrix."""
        return self._maximum_minimum(other, np.minimum)

    def dot(self, other):
        """Ordinary dot product

        Examples
        --------
        >>> import numpy as np
        >>> from scipy.sparse import csr_array
        >>> A = csr_array([[1, 2, 0], [0, 0, 3], [4, 0, 5]])
        >>> v = np.array([1, 0, -1])
        >>> A.dot(v)
        array([ 1, -3, -1], dtype=int64)

        """
        if np.isscalar(other):
            return self * other
        else:
            return self @ other

    def power(self, n, dtype=None):
        """Element-wise power."""
        return self.tocsr().power(n, dtype=dtype)

    def _broadcast_to(self, shape, copy=False):
        if self.shape == shape:
            return self.copy() if copy else self
        else:
            return self.tocsr()._broadcast_to(shape, copy)

    def _comparison(self, other, op):
        # We convert to CSR format and use methods _binopt or _scalar_binopt
        # If ndim>2 we reshape to 2D, compare and then reshape back to nD
        if not (issparse(other) or isdense(other) or isscalarlike(other)):
            if is_pydata_spmatrix(other):
                # cannot compare with pydata other, but it might compare with us.
                return NotImplemented
            # If it's a list or whatever, treat it like an array
            other_a = np.asanyarray(other)
            if other_a.ndim == 0 and other_a.dtype == np.object_:
                # numpy creates a 0d object array if all else fails.
                # Not interpretable as an array; return NotImplemented so
                # other's dunder methods can kick in if implemented.
                return NotImplemented
            # Allow custom sparse class indicated by attr sparse gh-6520
            try:
                other.shape
            except AttributeError:
                other = other_a

        if isscalarlike(other):
            if not op(0, other):
                if np.isnan(other):  # op is not `ne`, so results are all False.
                    return self.__class__(self.shape, dtype=np.bool_)
                else:
                    csr_self = (self if self.ndim < 3 else self.reshape(1, -1)).tocsr()
                    res = csr_self._scalar_binopt(other, op)
                    return res if self.ndim < 3 else res.tocoo().reshape(self.shape)
            else:
                warn(f"Comparing a sparse matrix with {other} using {op_sym[op]} "
                     f"is inefficient. Try using {op_sym[op_neg[op]]} instead.",
                     SparseEfficiencyWarning, stacklevel=3)
                if np.isnan(other):
                    # op is `ne` cuz op(0, other) and isnan(other). Return all True.
                    return self.__class__(np.ones(self.shape, dtype=np.bool_))

                # op is eq, le, or ge. Use negated op and then negate.
                csr_self = (self if self.ndim < 3 else self.reshape(1, -1)).tocsr()
                inv = csr_self._scalar_binopt(other, op_neg[op])
                all_true = csr_self.__class__(np.ones(csr_self.shape, dtype=np.bool_))
                result = all_true - inv
                return result if self.ndim < 3 else result.tocoo().reshape(self.shape)

        elif isdense(other):
            return op(self.todense(), other)

        elif issparse(other):
            # TODO sparse broadcasting
            if self.shape != other.shape:
                # eq and ne return True or False instead of an array when the shapes
                # don't match. Numpy doesn't do this. Is this what we want?
                if op in (operator.eq, operator.ne):
                    return op is operator.ne
                raise ValueError("inconsistent shape")

            csr_self = (self if self.ndim < 3 else self.reshape(1, -1)).tocsr()
            csr_other = (other if other.ndim < 3 else other.reshape(1, -1)).tocsr()
            if not op(0, 0):
                result = csr_self._binopt(csr_other, f'_{op.__name__}_')
                return result if self.ndim < 3 else result.tocoo().reshape(self.shape)
            else:
                # result will not be sparse. Use negated op and then negate.
                warn(f"Comparing two sparse matrices using {op_sym[op]} "
                     f"is inefficient. Try using {op_sym[op_neg[op]]} instead.",
                     SparseEfficiencyWarning, stacklevel=3)
                inv = csr_self._binopt(csr_other, f'_{op_neg[op].__name__}_')
                all_true = csr_self.__class__(np.ones(csr_self.shape, dtype=np.bool_))
                result = all_true - inv
                return result if self.ndim < 3 else result.tocoo().reshape(self.shape)
        else:
            # cannot compare with other, but it might compare with us.
            return NotImplemented

    def __eq__(self, other):
        return self._comparison(other, operator.eq)

    def __ne__(self, other):
        return self._comparison(other, operator.ne)

    def __lt__(self, other):
        return self._comparison(other, operator.lt)

    def __gt__(self, other):
        return self._comparison(other, operator.gt)

    def __le__(self, other):
        return self._comparison(other, operator.le)

    def __ge__(self, other):
        return self._comparison(other, operator.ge)

    def __abs__(self):
        return abs(self.tocsr())

    def __round__(self, ndigits=0):
        return round(self.tocsr(), ndigits=ndigits)

    def _add_sparse(self, other):
        return self.tocsr()._add_sparse(other)

    def _add_dense(self, other):
        return self.tocoo()._add_dense(other)

    def _sub_sparse(self, other):
        return self.tocsr()._sub_sparse(other)

    def _sub_dense(self, other):
        return self.todense() - other

    def _rsub_dense(self, other):
        # note: this can't be replaced by other + (-self) for unsigned types
        return other - self.todense()

    def __add__(self, other):  # self + other
        if isscalarlike(other):
            if other == 0:
                return self.copy()
            # Now we would add this scalar to every element.
            raise NotImplementedError('adding a nonzero scalar to a '
                                      'sparse array is not supported')
        elif issparse(other):
            if other.shape != self.shape:
                raise ValueError("inconsistent shapes")
            return self._add_sparse(other)
        elif isdense(other):
            other = np.broadcast_to(other, self.shape)
            return self._add_dense(other)
        else:
            return NotImplemented

    def __radd__(self,other):  # other + self
        return self.__add__(other)

    def __sub__(self, other):  # self - other
        if isscalarlike(other):
            if other == 0:
                return self.copy()
            raise NotImplementedError('subtracting a nonzero scalar from a '
                                      'sparse array is not supported')
        elif issparse(other):
            if other.shape != self.shape:
                raise ValueError("inconsistent shapes")
            return self._sub_sparse(other)
        elif isdense(other):
            other = np.broadcast_to(other, self.shape)
            return self._sub_dense(other)
        else:
            return NotImplemented

    def __rsub__(self,other):  # other - self
        if isscalarlike(other):
            if other == 0:
                return -self.copy()
            raise NotImplementedError('subtracting a sparse array from a '
                                      'nonzero scalar is not supported')
        elif isdense(other):
            other = np.broadcast_to(other, self.shape)
            return self._rsub_dense(other)
        else:
            return NotImplemented

    def _matmul_dispatch(self, other):
        """np.array-like matmul & `np.matrix`-like mul, i.e. `dot` or `NotImplemented`

        interpret other and call one of the following
        self._mul_scalar()
        self._matmul_vector()
        self._matmul_multivector()
        self._matmul_sparse()
        """
        # This method has to be different from `__matmul__` because it is also
        # called by sparse matrix classes.

        # Currently matrix multiplication is only supported
        # for 2D arrays. Hence we unpacked and use only the
        # two last axes' lengths.
        M, N = self._shape_as_2d

        if other.__class__ is np.ndarray:
            # Fast path for the most common case
            if other.shape == (N,):
                return self._matmul_vector(other)
            elif other.shape == (N, 1):
                result = self._matmul_vector(other.ravel())
                if self.ndim == 1:
                    return result.reshape(1)
                return result.reshape(M, 1)
            elif other.ndim == 2 and other.shape[0] == N:
                return self._matmul_multivector(other)

        if isscalarlike(other):
            # scalar value
            return self._mul_scalar(other)

        err_prefix = "matmul: dimension mismatch with signature"
        if issparse(other):
            if N != other.shape[0]:
                raise ValueError(
                    f"{err_prefix} (n,k={N}),(k={other.shape[0]},m)->(n,m)"
                )
            return self._matmul_sparse(other)

        # If it's a list or whatever, treat it like an array
        other_a = np.asanyarray(other)
        if other_a.ndim == 0 and other_a.dtype == np.object_:
            # numpy creates a 0d object array if all else fails.
            # Not interpretable as an array; return NotImplemented so that
            # other's __rmatmul__ can kick in if that's implemented.
            return NotImplemented
        # Allow custom sparse class indicated by attr sparse gh-6520
        try:
            other.shape
        except AttributeError:
            other = other_a

        if other.ndim == 1 or other.ndim == 2 and other.shape[1] == 1:
            # dense row or column vector
            if other.shape[0] != N:
                raise ValueError(
                    f"{err_prefix} (n,k={N}),(k={other.shape[0]},1?)->(n,1?)"
                )

            result = self._matmul_vector(np.ravel(other))

            if isinstance(other, np.matrix):
                result = self._ascontainer(result)

            if other.ndim == 2 and other.shape[1] == 1:
                # If 'other' was an (nx1) column vector, reshape the result
                if self.ndim == 1:
                    result = result.reshape(1)
                else:
                    result = result.reshape(-1, 1)

            return result

        elif other.ndim == 2:
            ##
            # dense 2D array or matrix ("multivector")

            if other.shape[0] != N:
                raise ValueError(
                    f"{err_prefix} (n,k={N}),(k={other.shape[0]},m)->(n,m)"
                )

            result = self._matmul_multivector(np.asarray(other))

            if isinstance(other, np.matrix):
                result = self._ascontainer(result)

            return result

        else:
            raise ValueError('could not interpret dimensions')

    def __mul__(self, other):
        return self.multiply(other)

    def __rmul__(self, other):  # other * self
        return self.multiply(other)

    # by default, use CSR for __mul__ handlers
    def _mul_scalar(self, other):
        return self.tocsr()._mul_scalar(other)

    def _matmul_vector(self, other):
        return self.tocsr()._matmul_vector(other)

    def _matmul_multivector(self, other):
        return self.tocsr()._matmul_multivector(other)

    def _matmul_sparse(self, other):
        return self.tocsr()._matmul_sparse(other)

    def _rmatmul_dispatch(self, other):
        if isscalarlike(other):
            return self._mul_scalar(other)
        else:
            # Don't use asarray unless we have to
            try:
                tr = other.transpose()
            except AttributeError:
                tr = np.asarray(other).transpose()
            ret = self.transpose()._matmul_dispatch(tr)
            if ret is NotImplemented:
                return NotImplemented
            return ret.transpose()

    #######################
    # matmul (@) operator #
    #######################

    def __matmul__(self, other):
        if isscalarlike(other):
            raise ValueError("Scalar operands are not allowed, "
                             "use '*' instead")
        return self._matmul_dispatch(other)

    def __rmatmul__(self, other):
        if isscalarlike(other):
            raise ValueError("Scalar operands are not allowed, "
                             "use '*' instead")
        return self._rmatmul_dispatch(other)

    ####################
    # Other Arithmetic #
    ####################

    def _divide(self, other, true_divide=False, rdivide=False):
        # Do we need to continue to support true_divide and divide?
        if not (issparse(other) or isdense(other) or isscalarlike(other)):
            # If it's a list or whatever, treat it like an array
            other_a = np.asanyarray(other)
            if other_a.ndim == 0 and other_a.dtype == np.object_:
                # numpy creates a 0d object array if all else fails.
                # Not interpretable as an array; return NotImplemented so that
                # other's __rdiv__ can kick in if that's implemented.
                return NotImplemented
            # Allow custom sparse class indicated by attr sparse gh-6520
            try:
                other.shape
            except AttributeError:
                other = other_a

        if isscalarlike(other):
            if rdivide:
                if true_divide:
                    return np.true_divide(other, self.todense())
                else:
                    return np.divide(other, self.todense())

            if true_divide and np.can_cast(self.dtype, np.float64):
                return self.astype(np.float64)._mul_scalar(1./other)
            else:
                r = self._mul_scalar(1./other)

                scalar_dtype = np.asarray(other).dtype
                if (np.issubdtype(self.dtype, np.integer) and
                        np.issubdtype(scalar_dtype, np.integer)):
                    return r.astype(self.dtype)
                else:
                    return r

        elif isdense(other):
            if not rdivide:
                if true_divide:
                    recip = np.true_divide(1., other)
                else:
                    recip = np.divide(1., other)
                return self.multiply(recip)
            else:
                if true_divide:
                    return np.true_divide(other, self.todense())
                else:
                    return np.divide(other, self.todense())
        elif issparse(other):
            if rdivide:
                return other._divide(self, true_divide, rdivide=False)

            csr_self = (self if self.ndim < 3 else self.reshape(1, -1)).tocsr()
            csr_other = (other if self.ndim < 3 else other.reshape(1, -1)).tocsr()
            if true_divide and np.can_cast(self.dtype, np.float64):
                result = csr_self.astype(np.float64)._divide_sparse(csr_other)
            else:
                result = csr_self._divide_sparse(csr_other)
            return result if self.ndim < 3 else result.reshape(self.shape)
        else:
            # not scalar, dense or sparse. Return NotImplemented so
            # other's __rdiv__ can kick in if that's implemented.
            return NotImplemented

    def __truediv__(self, other):
        return self._divide(other, true_divide=True)

    def __div__(self, other):
        # Always do true division
        return self._divide(other, true_divide=True)

    def __rtruediv__(self, other):
        # Implementing this as the inverse would be too magical -- bail out
        return NotImplemented

    def __rdiv__(self, other):
        # Implementing this as the inverse would be too magical -- bail out
        return NotImplemented

    def __neg__(self):
        return -self.tocsr()

    def __iadd__(self, other):
        return NotImplemented

    def __isub__(self, other):
        return NotImplemented

    def __imul__(self, other):
        return NotImplemented

    def __idiv__(self, other):
        return self.__itruediv__(other)

    def __itruediv__(self, other):
        return NotImplemented

    def __pow__(self, *args, **kwargs):
        return self.power(*args, **kwargs)

    def transpose(self, axes=None, copy=False):
        """
        Reverses the dimensions of the sparse array/matrix.

        Parameters
        ----------
        axes : None, optional
            This argument is in the signature *solely* for NumPy
            compatibility reasons. Do not pass in anything except
            for the default value.
        copy : bool, optional
            Indicates whether or not attributes of `self` should be
            copied whenever possible. The degree to which attributes
            are copied varies depending on the type of sparse array/matrix
            being used.

        Returns
        -------
        p : `self` with the dimensions reversed.

        Notes
        -----
        If `self` is a `csr_array` or a `csc_array`, then this will return a
        `csc_array` or a `csr_array`, respectively.

        See Also
        --------
        numpy.transpose : NumPy's implementation of 'transpose' for ndarrays
        """
        return self.tocsr(copy=copy).transpose(axes=axes, copy=False)

    def conjugate(self, copy=True):
        """Element-wise complex conjugation.

        If the array/matrix is of non-complex data type and `copy` is False,
        this method does nothing and the data is not copied.

        Parameters
        ----------
        copy : bool, optional
            If True, the result is guaranteed to not share data with self.

        Returns
        -------
        A : The element-wise complex conjugate.

        """
        if np.issubdtype(self.dtype, np.complexfloating):
            return self.tocsr(copy=copy).conjugate(copy=False)
        elif copy:
            return self.copy()
        else:
            return self

    def conj(self, copy=True):
        return self.conjugate(copy=copy)

    conj.__doc__ = conjugate.__doc__

    def _real(self):
        return self.tocsr()._real()

    def _imag(self):
        return self.tocsr()._imag()

    def nonzero(self):
        """Nonzero indices of the array/matrix.

        Returns a tuple of arrays (row,col) containing the indices
        of the non-zero elements of the array.

        Examples
        --------
        >>> from scipy.sparse import csr_array
        >>> A = csr_array([[1, 2, 0], [0, 0, 3], [4, 0, 5]])
        >>> A.nonzero()
        (array([0, 0, 1, 2, 2], dtype=int32), array([0, 1, 2, 0, 2], dtype=int32))

        """

        # convert to COOrdinate format
        A = self.tocoo()
        nz_mask = A.data != 0
        return tuple(idx[nz_mask] for idx in A.coords)

    def _getcol(self, j):
        """Returns a copy of column j of the array, as an (m x 1) sparse
        array (column vector).
        """
        if self.ndim == 1:
            raise ValueError("getcol not provided for 1d arrays. Use indexing A[j]")
        # Subclasses should override this method for efficiency.
        # Post-multiply by a (n x 1) column vector 'a' containing all zeros
        # except for a_j = 1
        N = self.shape[-1]
        if j < 0:
            j += N
        if j < 0 or j >= N:
            raise IndexError("index out of bounds")
        col_selector = self._csc_container(([1], [[j], [0]]),
                                           shape=(N, 1), dtype=self.dtype)
        result = self @ col_selector
        return result

    def _getrow(self, i):
        """Returns a copy of row i of the array, as a (1 x n) sparse
        array (row vector).
        """
        if self.ndim == 1:
            raise ValueError("getrow not meaningful for a 1d array")
        # Subclasses should override this method for efficiency.
        # Pre-multiply by a (1 x m) row vector 'a' containing all zeros
        # except for a_i = 1
        M = self.shape[0]
        if i < 0:
            i += M
        if i < 0 or i >= M:
            raise IndexError("index out of bounds")
        row_selector = self._csr_container(([1], [[0], [i]]),
                                           shape=(1, M), dtype=self.dtype)
        return row_selector @ self

    # The following dunder methods cannot be implemented.
    #
    # def __array__(self):
    #     # Sparse matrices rely on NumPy wrapping them in object arrays under
    #     # the hood to make unary ufuncs work on them. So we cannot raise
    #     # TypeError here - which would be handy to not give users object
    #     # arrays they probably don't want (they're looking for `.toarray()`).
    #     #
    #     # Conversion with `toarray()` would also break things because of the
    #     # behavior discussed above, plus we want to avoid densification by
    #     # accident because that can too easily blow up memory.
    #
    # def __array_ufunc__(self):
    #     # We cannot implement __array_ufunc__ due to mismatching semantics.
    #     # See gh-7707 and gh-7349 for details.
    #
    # def __array_function__(self):
    #     # We cannot implement __array_function__ due to mismatching semantics.
    #     # See gh-10362 for details.

    def todense(self, order=None, out=None):
        """
        Return a dense representation of this sparse array.

        Parameters
        ----------
        order : {'C', 'F'}, optional
            Whether to store multi-dimensional data in C (row-major)
            or Fortran (column-major) order in memory. The default
            is 'None', which provides no ordering guarantees.
            Cannot be specified in conjunction with the `out`
            argument.

        out : ndarray, 2-D, optional
            If specified, uses this array as the output buffer
            instead of allocating a new array to return. The
            provided array must have the same shape and dtype as
            the sparse array on which you are calling the method.

        Returns
        -------
        arr : ndarray, 2-D
            An array with the same shape and containing the same
            data represented by the sparse array, with the requested
            memory order. If `out` was passed, the same object is
            returned after being modified in-place to contain the
            appropriate values.
        """
        return self._ascontainer(self.toarray(order=order, out=out))

    def toarray(self, order=None, out=None):
        """
        Return a dense ndarray representation of this sparse array/matrix.

        Parameters
        ----------
        order : {'C', 'F'}, optional
            Whether to store multidimensional data in C (row-major)
            or Fortran (column-major) order in memory. The default
            is 'None', which provides no ordering guarantees.
            Cannot be specified in conjunction with the `out`
            argument.

        out : ndarray, 2-D, optional
            If specified, uses this array as the output buffer
            instead of allocating a new array to return. The provided
            array must have the same shape and dtype as the sparse
            array/matrix on which you are calling the method. For most
            sparse types, `out` is required to be memory contiguous
            (either C or Fortran ordered).

        Returns
        -------
        arr : ndarray, 2-D
            An array with the same shape and containing the same
            data represented by the sparse array/matrix, with the requested
            memory order. If `out` was passed, the same object is
            returned after being modified in-place to contain the
            appropriate values.
        """
        return self.tocoo(copy=False).toarray(order=order, out=out)

    # Any sparse array format deriving from _spbase must define one of
    # tocsr or tocoo. The other conversion methods may be implemented for
    # efficiency, but are not required.
    def tocsr(self, copy=False):
        """Convert this array/matrix to Compressed Sparse Row format.

        With copy=False, the data/indices may be shared between this array/matrix and
        the resultant csr_array/matrix.
        """
        return self.tocoo(copy=copy).tocsr(copy=False)

    def todok(self, copy=False):
        """Convert this array/matrix to Dictionary Of Keys format.

        With copy=False, the data/indices may be shared between this array/matrix and
        the resultant dok_array/matrix.
        """
        return self.tocoo(copy=copy).todok(copy=False)

    def tocoo(self, copy=False):
        """Convert this array/matrix to COOrdinate format.

        With copy=False, the data/indices may be shared between this array/matrix and
        the resultant coo_array/matrix.
        """
        return self.tocsr(copy=False).tocoo(copy=copy)

    def tolil(self, copy=False):
        """Convert this array/matrix to List of Lists format.

        With copy=False, the data/indices may be shared between this array/matrix and
        the resultant lil_array/matrix.
        """
        return self.tocsr(copy=False).tolil(copy=copy)

    def todia(self, copy=False):
        """Convert this array/matrix to sparse DIAgonal format.

        With copy=False, the data/indices may be shared between this array/matrix and
        the resultant dia_array/matrix.
        """
        return self.tocoo(copy=copy).todia(copy=False)

    def tobsr(self, blocksize=None, copy=False):
        """Convert this array/matrix to Block Sparse Row format.

        With copy=False, the data/indices may be shared between this array/matrix and
        the resultant bsr_array/matrix.

        When blocksize=(R, C) is provided, it will be used for construction of
        the bsr_array/matrix.
        """
        return self.tocsr(copy=False).tobsr(blocksize=blocksize, copy=copy)

    def tocsc(self, copy=False):
        """Convert this array/matrix to Compressed Sparse Column format.

        With copy=False, the data/indices may be shared between this array/matrix and
        the resultant csc_array/matrix.
        """
        return self.tocsr(copy=copy).tocsc(copy=False)

    def copy(self):
        """Returns a copy of this array/matrix.

        No data/indices will be shared between the returned value and current
        array/matrix.
        """
        return self.__class__(self, copy=True)

    def sum(self, axis=None, dtype=None, out=None):
        """
        Sum the array/matrix elements over a given axis.

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None} optional
            Axis along which the sum is computed. The default is to
            compute the sum of all the array/matrix elements, returning a scalar
            (i.e., `axis` = `None`).
        dtype : dtype, optional
            The type of the returned array/matrix and of the accumulator in which
            the elements are summed.  The dtype of `a` is used by default
            unless `a` has an integer dtype of less precision than the default
            platform integer.  In that case, if `a` is signed then the platform
            integer is used while if `a` is unsigned then an unsigned integer
            of the same precision as the platform integer is used.

            .. versionadded:: 0.18.0

        out : np.matrix, optional
            Alternative output matrix in which to place the result. It must
            have the same shape as the expected output, but the type of the
            output values will be cast if necessary.

            .. versionadded:: 0.18.0

        Returns
        -------
        sum_along_axis : np.matrix
            A matrix with the same shape as `self`, with the specified
            axis removed.

        See Also
        --------
        numpy.matrix.sum : NumPy's implementation of 'sum' for matrices

        """
        axis = validateaxis(axis, ndim=self.ndim)

        # Mimic numpy's casting.
        res_dtype = get_sum_dtype(self.dtype)

        # Note: all valid 1D axis values are canonically `None`.
        if axis is None:
            if self.nnz == 0:
                return np.sum(self._ascontainer([0]), dtype=dtype or res_dtype, out=out)
            return np.sum(self._ascontainer(_todata(self)), dtype=dtype, out=out)
        elif isspmatrix(self):
            # Ensure spmatrix sums stay 2D
            new_shape = (1, self.shape[1]) if axis == (0,) else (self.shape[0], 1)
        else:
            new_shape = tuple(self.shape[i] for i in range(self.ndim) if i not in axis)

        if out is None:
            # create out array with desired dtype
            out = self._ascontainer(np.zeros(new_shape, dtype=dtype or res_dtype))
        else:
            if out.shape != new_shape:
                raise ValueError("out dimensions do not match shape")

        if self.ndim > 2:
            return self._sum_nd(axis, res_dtype, out)

        # We use multiplication by a matrix of ones to sum.
        # For some sparse array formats more efficient methods are
        # possible -- these should override this function.
        if axis == (0,):
            ones = self._ascontainer(np.ones((1, self.shape[0]), dtype=res_dtype))
            # sets dtype while loading into out
            out[...] = (ones @ self).reshape(new_shape)
        else:  # axis == (1,)
            ones = self._ascontainer(np.ones((self.shape[1], 1), dtype=res_dtype))
            # sets dtype while loading into out
            out[...] = (self @ ones).reshape(new_shape)
        return out

    def mean(self, axis=None, dtype=None, out=None):
        """
        Compute the arithmetic mean along the specified axis.

        Returns the average of the array/matrix elements. The average is taken
        over all elements in the array/matrix by default, otherwise over the
        specified axis. `float64` intermediate and return values are used
        for integer inputs.

        Parameters
        ----------
        axis : {-2, -1, 0, 1, None} optional
            Axis along which the mean is computed. The default is to compute
            the mean of all elements in the array/matrix (i.e., `axis` = `None`).
        dtype : data-type, optional
            Type to use in computing the mean. For integer inputs, the default
            is `float64`; for floating point inputs, it is the same as the
            input dtype.

            .. versionadded:: 0.18.0

        out : np.matrix, optional
            Alternative output matrix in which to place the result. It must
            have the same shape as the expected output, but the type of the
            output values will be cast if necessary.

            .. versionadded:: 0.18.0

        Returns
        -------
        m : np.matrix

        See Also
        --------
        numpy.matrix.mean : NumPy's implementation of 'mean' for matrices

        """
        axis = validateaxis(axis, ndim=self.ndim)

        integral = (np.issubdtype(self.dtype, np.integer) or
                    np.issubdtype(self.dtype, np.bool_))

        # intermediate dtype for summation
        inter_dtype = np.float64 if integral else self.dtype
        inter_self = self.astype(inter_dtype)

        if axis is None:
            denom = math.prod(self.shape)
        else:
            denom = math.prod(self.shape[ax] for ax in axis)
        res = (inter_self * (1.0 / denom)).sum(axis=axis, dtype=inter_dtype, out=out)
        if dtype is not None and out is None:
            return res.astype(dtype, copy=False)
        return res


    def diagonal(self, k=0):
        """Returns the kth diagonal of the array/matrix.

        Parameters
        ----------
        k : int, optional
            Which diagonal to get, corresponding to elements a[i, i+k].
            Default: 0 (the main diagonal).

            .. versionadded:: 1.0

        See also
        --------
        numpy.diagonal : Equivalent numpy function.

        Examples
        --------
        >>> from scipy.sparse import csr_array
        >>> A = csr_array([[1, 2, 0], [0, 0, 3], [4, 0, 5]])
        >>> A.diagonal()
        array([1, 0, 5])
        >>> A.diagonal(k=1)
        array([2, 3])
        """
        return self.tocsr().diagonal(k=k)

    def trace(self, offset=0):
        """Returns the sum along diagonals of the sparse array/matrix.

        Parameters
        ----------
        offset : int, optional
            Which diagonal to get, corresponding to elements a[i, i+offset].
            Default: 0 (the main diagonal).

        """
        return self.diagonal(k=offset).sum()

    def setdiag(self, values, k=0):
        """
        Set diagonal or off-diagonal elements of the array/matrix.

        Parameters
        ----------
        values : array_like
            New values of the diagonal elements.

            Values may have any length. If the diagonal is longer than values,
            then the remaining diagonal entries will not be set. If values are
            longer than the diagonal, then the remaining values are ignored.

            If a scalar value is given, all of the diagonal is set to it.

        k : int, optional
            Which off-diagonal to set, corresponding to elements a[i,i+k].
            Default: 0 (the main diagonal).

        """
        M, N = self.shape
        if (k > 0 and k >= N) or (k < 0 and -k >= M):
            raise ValueError("k exceeds array dimensions")
        self._setdiag(np.asarray(values), k)

    def _setdiag(self, values, k):
        """This part of the implementation gets overridden by the
        different formats.
        """
        M, N = self.shape
        if k < 0:
            if values.ndim == 0:
                # broadcast
                max_index = min(M+k, N)
                for i in range(max_index):
                    self[i - k, i] = values
            else:
                max_index = min(M+k, N, len(values))
                if max_index <= 0:
                    return
                for i, v in enumerate(values[:max_index]):
                    self[i - k, i] = v
        else:
            if values.ndim == 0:
                # broadcast
                max_index = min(M, N-k)
                for i in range(max_index):
                    self[i, i + k] = values
            else:
                max_index = min(M, N-k, len(values))
                if max_index <= 0:
                    return
                for i, v in enumerate(values[:max_index]):
                    self[i, i + k] = v

    def _process_toarray_args(self, order, out):
        if out is not None:
            if order is not None:
                raise ValueError('order cannot be specified if out '
                                 'is not None')
            if out.shape != self.shape or out.dtype != self.dtype:
                raise ValueError('out array must be same dtype and shape as '
                                 'sparse array')
            out[...] = 0.
            return out
        else:
            return np.zeros(self.shape, dtype=self.dtype, order=order)

    def _get_index_dtype(self, arrays=(), maxval=None, check_contents=False):
        """
        Determine index dtype for array.

        This wraps _sputils.get_index_dtype, providing compatibility for both
        array and matrix API sparse matrices. Matrix API sparse matrices would
        attempt to downcast the indices - which can be computationally
        expensive and undesirable for users. The array API changes this
        behaviour.

        See discussion: https://github.com/scipy/scipy/issues/16774

        The get_index_dtype import is due to implementation details of the test
        suite. It allows the decorator ``with_64bit_maxval_limit`` to mock a
        lower int32 max value for checks on the matrix API's downcasting
        behaviour.
        """
        from ._sputils import get_index_dtype

        # Don't check contents for array API
        return get_index_dtype(arrays,
                               maxval,
                               (check_contents and not isinstance(self, sparray)))


class sparray:
    """A namespace class to separate sparray from spmatrix"""

    @classmethod
    def __class_getitem__(cls, arg, /):
        """
        Return a parametrized wrapper around the `~scipy.sparse.sparray` type.

        .. versionadded:: 1.16.0

        Returns
        -------
        alias : types.GenericAlias
            A parametrized `~scipy.sparse.sparray` type.

        Examples
        --------
        >>> import numpy as np
        >>> from scipy.sparse import coo_array

        >>> coo_array[np.int8, tuple[int]]
        scipy.sparse._coo.coo_array[numpy.int8, tuple[int]]
        """
        from types import GenericAlias
        return GenericAlias(cls, arg)


sparray.__doc__ = _spbase.__doc__


def isspmatrix(x):
    """Is `x` of a sparse matrix type?

    Parameters
    ----------
    x
        object to check for being a sparse matrix

    Returns
    -------
    bool
        True if `x` is a sparse matrix, False otherwise

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.sparse import csr_array, csr_matrix, isspmatrix
    >>> isspmatrix(csr_matrix([[5]]))
    True
    >>> isspmatrix(csr_array([[5]]))
    False
    >>> isspmatrix(np.array([[5]]))
    False
    >>> isspmatrix(5)
    False
    """
    return isinstance(x, spmatrix)
