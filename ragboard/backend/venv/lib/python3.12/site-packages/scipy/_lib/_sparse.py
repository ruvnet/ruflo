from abc import ABC

__all__ = ["SparseABC", "issparse"]


class SparseABC(ABC):
    pass


def issparse(x):
    """Is `x` of a sparse array or sparse matrix type?

    Parameters
    ----------
    x
        object to check for being a sparse array or sparse matrix

    Returns
    -------
    bool
        True if `x` is a sparse array or a sparse matrix, False otherwise

    Notes
    -----
    Use `isinstance(x, sp.sparse.sparray)` to check between an array or matrix.
    Use `a.format` to check the sparse format, e.g. `a.format == 'csr'`.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy.sparse import csr_array, csr_matrix, issparse
    >>> issparse(csr_matrix([[5]]))
    True
    >>> issparse(csr_array([[5]]))
    True
    >>> issparse(np.array([[5]]))
    False
    >>> issparse(5)
    False
    """
    return isinstance(x, SparseABC)
