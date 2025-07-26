""" Sketching-based Matrix Computations """

# Author: Jordi Montes <jomsdev@gmail.com>
# August 28, 2017

import numpy as np

from scipy._lib._util import (check_random_state, rng_integers,
                              _transition_to_rng, _apply_over_batch)
from scipy.sparse import csc_matrix, issparse

__all__ = ['clarkson_woodruff_transform']


def cwt_matrix(n_rows, n_columns, rng=None):
    r"""
    Generate a matrix S which represents a Clarkson-Woodruff transform.

    Given the desired size of matrix, the method returns a matrix S of size
    (n_rows, n_columns) where each column has all the entries set to 0
    except for one position which has been randomly set to +1 or -1 with
    equal probability.

    Parameters
    ----------
    n_rows : int
        Number of rows of S
    n_columns : int
        Number of columns of S
    rng : `numpy.random.Generator`, optional
        Pseudorandom number generator state. When `rng` is None, a new
        `numpy.random.Generator` is created using entropy from the
        operating system. Types other than `numpy.random.Generator` are
        passed to `numpy.random.default_rng` to instantiate a ``Generator``.


    Returns
    -------
    S : (n_rows, n_columns) csc_matrix
        The returned matrix has ``n_columns`` nonzero entries.

    Notes
    -----
    Given a matrix A, with probability at least 9/10,
    .. math:: \|SA\| = (1 \pm \epsilon)\|A\|
    Where the error epsilon is related to the size of S.
    """
    rng = check_random_state(rng)
    rows = rng_integers(rng, 0, n_rows, n_columns)
    cols = np.arange(n_columns+1)
    signs = rng.choice([1, -1], n_columns)
    S = csc_matrix((signs, rows, cols), shape=(n_rows, n_columns))
    return S


@_transition_to_rng("seed", position_num=2)
def clarkson_woodruff_transform(input_matrix, sketch_size, rng=None):
    r"""
    Applies a Clarkson-Woodruff Transform/sketch to the input matrix.

    Given an input_matrix ``A`` of size ``(n, d)``, compute a matrix ``A'`` of
    size (sketch_size, d) so that

    .. math:: \|Ax\| \approx \|A'x\|

    with high probability via the Clarkson-Woodruff Transform, otherwise
    known as the CountSketch matrix.

    Parameters
    ----------
    input_matrix : array_like, shape (..., n, d)
        Input matrix.
    sketch_size : int
        Number of rows for the sketch.
    rng : `numpy.random.Generator`, optional
        Pseudorandom number generator state. When `rng` is None, a new
        `numpy.random.Generator` is created using entropy from the
        operating system. Types other than `numpy.random.Generator` are
        passed to `numpy.random.default_rng` to instantiate a ``Generator``.

    Returns
    -------
    A' : array_like
        Sketch of the input matrix ``A``, of size ``(sketch_size, d)``.

    Notes
    -----
    To make the statement

    .. math:: \|Ax\| \approx \|A'x\|

    precise, observe the following result which is adapted from the
    proof of Theorem 14 of [2]_ via Markov's Inequality. If we have
    a sketch size ``sketch_size=k`` which is at least

    .. math:: k \geq \frac{2}{\epsilon^2\delta}

    Then for any fixed vector ``x``,

    .. math:: \|Ax\| = (1\pm\epsilon)\|A'x\|

    with probability at least one minus delta.

    This implementation takes advantage of sparsity: computing
    a sketch takes time proportional to ``A.nnz``. Data ``A`` which
    is in ``scipy.sparse.csc_matrix`` format gives the quickest
    computation time for sparse input.

    >>> import numpy as np
    >>> from scipy import linalg
    >>> from scipy import sparse
    >>> rng = np.random.default_rng()
    >>> n_rows, n_columns, density, sketch_n_rows = 15000, 100, 0.01, 200
    >>> A = sparse.rand(n_rows, n_columns, density=density, format='csc')
    >>> B = sparse.rand(n_rows, n_columns, density=density, format='csr')
    >>> C = sparse.rand(n_rows, n_columns, density=density, format='coo')
    >>> D = rng.standard_normal((n_rows, n_columns))
    >>> SA = linalg.clarkson_woodruff_transform(A, sketch_n_rows) # fastest
    >>> SB = linalg.clarkson_woodruff_transform(B, sketch_n_rows) # fast
    >>> SC = linalg.clarkson_woodruff_transform(C, sketch_n_rows) # slower
    >>> SD = linalg.clarkson_woodruff_transform(D, sketch_n_rows) # slowest

    That said, this method does perform well on dense inputs, just slower
    on a relative scale.

    References
    ----------
    .. [1] Kenneth L. Clarkson and David P. Woodruff. Low rank approximation
           and regression in input sparsity time. In STOC, 2013.
    .. [2] David P. Woodruff. Sketching as a tool for numerical linear algebra.
           In Foundations and Trends in Theoretical Computer Science, 2014.

    Examples
    --------
    Create a big dense matrix ``A`` for the example:

    >>> import numpy as np
    >>> from scipy import linalg
    >>> n_rows, n_columns  = 15000, 100
    >>> rng = np.random.default_rng()
    >>> A = rng.standard_normal((n_rows, n_columns))

    Apply the transform to create a new matrix with 200 rows:

    >>> sketch_n_rows = 200
    >>> sketch = linalg.clarkson_woodruff_transform(A, sketch_n_rows, seed=rng)
    >>> sketch.shape
    (200, 100)

    Now with high probability, the true norm is close to the sketched norm
    in absolute value.

    >>> linalg.norm(A)
    1224.2812927123198
    >>> linalg.norm(sketch)
    1226.518328407333

    Similarly, applying our sketch preserves the solution to a linear
    regression of :math:`\min \|Ax - b\|`.

    >>> b = rng.standard_normal(n_rows)
    >>> x = linalg.lstsq(A, b)[0]
    >>> Ab = np.hstack((A, b.reshape(-1, 1)))
    >>> SAb = linalg.clarkson_woodruff_transform(Ab, sketch_n_rows, seed=rng)
    >>> SA, Sb = SAb[:, :-1], SAb[:, -1]
    >>> x_sketched = linalg.lstsq(SA, Sb)[0]

    As with the matrix norm example, ``linalg.norm(A @ x - b)`` is close
    to ``linalg.norm(A @ x_sketched - b)`` with high probability.

    >>> linalg.norm(A @ x - b)
    122.83242365433877
    >>> linalg.norm(A @ x_sketched - b)
    166.58473879945151

    """
    if issparse(input_matrix) and input_matrix.ndim > 2:
        message = "Batch support for sparse arrays is not available."
        raise NotImplementedError(message)

    S = cwt_matrix(sketch_size, input_matrix.shape[-2], rng=rng)
    # Despite argument order (required by decorator), this is  S @ input_matrix
    # Can avoid _batch_dot when gh-22153 is resolved.
    return S @ input_matrix if input_matrix.ndim <= 2 else _batch_dot(input_matrix, S)


@_apply_over_batch(('input_matrix', 2))
def _batch_dot(input_matrix, S):
    return S @ input_matrix
