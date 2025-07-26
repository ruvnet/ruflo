class spmatrix:
    """This class provides a base class for all sparse matrix classes.

    It cannot be instantiated.  Most of the work is provided by subclasses.
    """
    _allow_nd = (2,)

    @property
    def _bsr_container(self):
        from ._bsr import bsr_matrix
        return bsr_matrix

    @property
    def _coo_container(self):
        from ._coo import coo_matrix
        return coo_matrix

    @property
    def _csc_container(self):
        from ._csc import csc_matrix
        return csc_matrix

    @property
    def _csr_container(self):
        from ._csr import csr_matrix
        return csr_matrix

    @property
    def _dia_container(self):
        from ._dia import dia_matrix
        return dia_matrix

    @property
    def _dok_container(self):
        from ._dok import dok_matrix
        return dok_matrix

    @property
    def _lil_container(self):
        from ._lil import lil_matrix
        return lil_matrix

    # Restore matrix multiplication
    def __mul__(self, other):
        return self._matmul_dispatch(other)

    def __rmul__(self, other):
        return self._rmatmul_dispatch(other)

    # Restore matrix power
    def __pow__(self, power):
        from .linalg import matrix_power

        return matrix_power(self, power)

    ## Backward compatibility

    def set_shape(self, shape):
        """Set the shape of the matrix in-place"""
        # Make sure copy is False since this is in place
        # Make sure format is unchanged because we are doing a __dict__ swap
        new_self = self.reshape(shape, copy=False).asformat(self.format)
        self.__dict__ = new_self.__dict__

    def get_shape(self):
        """Get the shape of the matrix"""
        return self._shape

    shape = property(fget=get_shape, fset=set_shape,
                     doc="Shape of the matrix")

    def asfptype(self):
        """Upcast matrix to a floating point format (if necessary)"""
        return self._asfptype()

    def getmaxprint(self):
        """Maximum number of elements to display when printed."""
        return self._getmaxprint()

    def getformat(self):
        """Matrix storage format"""
        return self.format

    def getnnz(self, axis=None):
        """Number of stored values, including explicit zeros.

        Parameters
        ----------
        axis : None, 0, or 1
            Select between the number of values across the whole array, in
            each column, or in each row.
        """
        return self._getnnz(axis=axis)

    def getH(self):
        """Return the Hermitian transpose of this matrix.

        See Also
        --------
        numpy.matrix.getH : NumPy's implementation of `getH` for matrices
        """
        return self.conjugate().transpose()

    def getcol(self, j):
        """Returns a copy of column j of the matrix, as an (m x 1) sparse
        matrix (column vector).
        """
        return self._getcol(j)

    def getrow(self, i):
        """Returns a copy of row i of the matrix, as a (1 x n) sparse
        matrix (row vector).
        """
        return self._getrow(i)

    def todense(self, order=None, out=None):
        """
        Return a dense representation of this sparse matrix.

        Parameters
        ----------
        order : {'C', 'F'}, optional
            Whether to store multi-dimensional data in C (row-major)
            or Fortran (column-major) order in memory. The default
            is 'None', which provides no ordering guarantees.
            Cannot be specified in conjunction with the `out`
            argument.

        out : ndarray, 2-D, optional
            If specified, uses this array (or `numpy.matrix`) as the
            output buffer instead of allocating a new array to
            return. The provided array must have the same shape and
            dtype as the sparse matrix on which you are calling the
            method.

        Returns
        -------
        arr : numpy.matrix, 2-D
            A NumPy matrix object with the same shape and containing
            the same data represented by the sparse matrix, with the
            requested memory order. If `out` was passed and was an
            array (rather than a `numpy.matrix`), it will be filled
            with the appropriate values and returned wrapped in a
            `numpy.matrix` object that shares the same memory.
        """
        return super().todense(order, out)

    @classmethod
    def __class_getitem__(cls, arg, /):
        """
        Return a parametrized wrapper around the `~scipy.sparse.spmatrix` type.

        .. versionadded:: 1.16.0

        Returns
        -------
        alias : types.GenericAlias
            A parametrized `~scipy.sparse.spmatrix` type.

        Examples
        --------
        >>> import numpy as np
        >>> from scipy.sparse import coo_matrix

        >>> coo_matrix[np.int8]
        scipy.sparse._coo.coo_matrix[numpy.int8]
        """
        from types import GenericAlias
        return GenericAlias(cls, arg)
