#  ******************************************************************************
#   Copyright (C) 2013 Kenneth L. Ho
#
#   Redistribution and use in source and binary forms, with or without
#   modification, are permitted provided that the following conditions are met:
#
#   Redistributions of source code must retain the above copyright notice, this
#   list of conditions and the following disclaimer. Redistributions in binary
#   form must reproduce the above copyright notice, this list of conditions and
#   the following disclaimer in the documentation and/or other materials
#   provided with the distribution.
#
#   None of the names of the copyright holders may be used to endorse or
#   promote products derived from this software without specific prior written
#   permission.
#
#   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
#   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
#   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
#   ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
#   LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
#   CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
#   SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
#   INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
#   CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
#   ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
#   POSSIBILITY OF SUCH DAMAGE.
#  ******************************************************************************

r"""
======================================================================
Interpolative matrix decomposition (:mod:`scipy.linalg.interpolative`)
======================================================================

.. versionadded:: 0.13

.. versionchanged:: 1.15.0
    The underlying algorithms have been ported to Python from the original Fortran77
    code. See references below for more details.

.. currentmodule:: scipy.linalg.interpolative

An interpolative decomposition (ID) of a matrix :math:`A \in
\mathbb{C}^{m \times n}` of rank :math:`k \leq \min \{ m, n \}` is a
factorization

.. math::
  A \Pi =
  \begin{bmatrix}
   A \Pi_{1} & A \Pi_{2}
  \end{bmatrix} =
  A \Pi_{1}
  \begin{bmatrix}
   I & T
  \end{bmatrix},

where :math:`\Pi = [\Pi_{1}, \Pi_{2}]` is a permutation matrix with
:math:`\Pi_{1} \in \{ 0, 1 \}^{n \times k}`, i.e., :math:`A \Pi_{2} =
A \Pi_{1} T`. This can equivalently be written as :math:`A = BP`,
where :math:`B = A \Pi_{1}` and :math:`P = [I, T] \Pi^{\mathsf{T}}`
are the *skeleton* and *interpolation matrices*, respectively.

If :math:`A` does not have exact rank :math:`k`, then there exists an
approximation in the form of an ID such that :math:`A = BP + E`, where
:math:`\| E \| \sim \sigma_{k + 1}` is on the order of the :math:`(k +
1)`-th largest singular value of :math:`A`. Note that :math:`\sigma_{k
+ 1}` is the best possible error for a rank-:math:`k` approximation
and, in fact, is achieved by the singular value decomposition (SVD)
:math:`A \approx U S V^{*}`, where :math:`U \in \mathbb{C}^{m \times
k}` and :math:`V \in \mathbb{C}^{n \times k}` have orthonormal columns
and :math:`S = \mathop{\mathrm{diag}} (\sigma_{i}) \in \mathbb{C}^{k
\times k}` is diagonal with nonnegative entries. The principal
advantages of using an ID over an SVD are that:

- it is cheaper to construct;
- it preserves the structure of :math:`A`; and
- it is more efficient to compute with in light of the identity submatrix of :math:`P`.

Routines
========

Main functionality:

.. autosummary::
   :toctree: generated/

   interp_decomp
   reconstruct_matrix_from_id
   reconstruct_interp_matrix
   reconstruct_skel_matrix
   id_to_svd
   svd
   estimate_spectral_norm
   estimate_spectral_norm_diff
   estimate_rank

Following support functions are deprecated and will be removed in SciPy 1.17.0:

.. autosummary::
   :toctree: generated/

   seed
   rand


References
==========

This module uses the algorithms found in ID software package [1]_ by Martinsson,
Rokhlin, Shkolnisky, and Tygert, which is a Fortran library for computing IDs using
various algorithms, including the rank-revealing QR approach of [2]_ and the more
recent randomized methods described in [3]_, [4]_, and [5]_.

We advise the user to consult also the documentation for the `ID package
<http://tygert.com/software.html>`_.

.. [1] P.G. Martinsson, V. Rokhlin, Y. Shkolnisky, M. Tygert. "ID: a
    software package for low-rank approximation of matrices via interpolative
    decompositions, version 0.2." http://tygert.com/id_doc.4.pdf.

.. [2] H. Cheng, Z. Gimbutas, P.G. Martinsson, V. Rokhlin. "On the
    compression of low rank matrices." *SIAM J. Sci. Comput.* 26 (4): 1389--1404,
    2005. :doi:`10.1137/030602678`.

.. [3] E. Liberty, F. Woolfe, P.G. Martinsson, V. Rokhlin, M.
    Tygert. "Randomized algorithms for the low-rank approximation of matrices."
    *Proc. Natl. Acad. Sci. U.S.A.* 104 (51): 20167--20172, 2007.
    :doi:`10.1073/pnas.0709640104`.

.. [4] P.G. Martinsson, V. Rokhlin, M. Tygert. "A randomized
    algorithm for the decomposition of matrices." *Appl. Comput. Harmon. Anal.* 30
    (1): 47--68,  2011. :doi:`10.1016/j.acha.2010.02.003`.

.. [5] F. Woolfe, E. Liberty, V. Rokhlin, M. Tygert. "A fast
    randomized algorithm for the approximation of matrices." *Appl. Comput.
    Harmon. Anal.* 25 (3): 335--366, 2008. :doi:`10.1016/j.acha.2007.12.002`.


Tutorial
========

Initializing
------------

The first step is to import :mod:`scipy.linalg.interpolative` by issuing the
command:

>>> import scipy.linalg.interpolative as sli

Now let's build a matrix. For this, we consider a Hilbert matrix, which is well
know to have low rank:

>>> from scipy.linalg import hilbert
>>> n = 1000
>>> A = hilbert(n)

We can also do this explicitly via:

>>> import numpy as np
>>> n = 1000
>>> A = np.empty((n, n), order='F')
>>> for j in range(n):
...     for i in range(n):
...         A[i,j] = 1. / (i + j + 1)

Note the use of the flag ``order='F'`` in :func:`numpy.empty`. This
instantiates the matrix in Fortran-contiguous order and is important for
avoiding data copying when passing to the backend.

We then define multiplication routines for the matrix by regarding it as a
:class:`scipy.sparse.linalg.LinearOperator`:

>>> from scipy.sparse.linalg import aslinearoperator
>>> L = aslinearoperator(A)

This automatically sets up methods describing the action of the matrix and its
adjoint on a vector.

Computing an ID
---------------

We have several choices of algorithm to compute an ID. These fall largely
according to two dichotomies:

1. how the matrix is represented, i.e., via its entries or via its action on a
   vector; and
2. whether to approximate it to a fixed relative precision or to a fixed rank.

We step through each choice in turn below.

In all cases, the ID is represented by three parameters:

1. a rank ``k``;
2. an index array ``idx``; and
3. interpolation coefficients ``proj``.

The ID is specified by the relation
``np.dot(A[:,idx[:k]], proj) == A[:,idx[k:]]``.

From matrix entries
...................

We first consider a matrix given in terms of its entries.

To compute an ID to a fixed precision, type:

>>> eps = 1e-3
>>> k, idx, proj = sli.interp_decomp(A, eps)

where ``eps < 1`` is the desired precision.

To compute an ID to a fixed rank, use:

>>> idx, proj = sli.interp_decomp(A, k)

where ``k >= 1`` is the desired rank.

Both algorithms use random sampling and are usually faster than the
corresponding older, deterministic algorithms, which can be accessed via the
commands:

>>> k, idx, proj = sli.interp_decomp(A, eps, rand=False)

and:

>>> idx, proj = sli.interp_decomp(A, k, rand=False)

respectively.

From matrix action
..................

Now consider a matrix given in terms of its action on a vector as a
:class:`scipy.sparse.linalg.LinearOperator`.

To compute an ID to a fixed precision, type:

>>> k, idx, proj = sli.interp_decomp(L, eps)

To compute an ID to a fixed rank, use:

>>> idx, proj = sli.interp_decomp(L, k)

These algorithms are randomized.

Reconstructing an ID
--------------------

The ID routines above do not output the skeleton and interpolation matrices
explicitly but instead return the relevant information in a more compact (and
sometimes more useful) form. To build these matrices, write:

>>> B = sli.reconstruct_skel_matrix(A, k, idx)

for the skeleton matrix and:

>>> P = sli.reconstruct_interp_matrix(idx, proj)

for the interpolation matrix. The ID approximation can then be computed as:

>>> C = np.dot(B, P)

This can also be constructed directly using:

>>> C = sli.reconstruct_matrix_from_id(B, idx, proj)

without having to first compute ``P``.

Alternatively, this can be done explicitly as well using:

>>> B = A[:,idx[:k]]
>>> P = np.hstack([np.eye(k), proj])[:,np.argsort(idx)]
>>> C = np.dot(B, P)

Computing an SVD
----------------

An ID can be converted to an SVD via the command:

>>> U, S, V = sli.id_to_svd(B, idx, proj)

The SVD approximation is then:

>>> approx = U @ np.diag(S) @ V.conj().T

The SVD can also be computed "fresh" by combining both the ID and conversion
steps into one command. Following the various ID algorithms above, there are
correspondingly various SVD algorithms that one can employ.

From matrix entries
...................

We consider first SVD algorithms for a matrix given in terms of its entries.

To compute an SVD to a fixed precision, type:

>>> U, S, V = sli.svd(A, eps)

To compute an SVD to a fixed rank, use:

>>> U, S, V = sli.svd(A, k)

Both algorithms use random sampling; for the deterministic versions, issue the
keyword ``rand=False`` as above.

From matrix action
..................

Now consider a matrix given in terms of its action on a vector.

To compute an SVD to a fixed precision, type:

>>> U, S, V = sli.svd(L, eps)

To compute an SVD to a fixed rank, use:

>>> U, S, V = sli.svd(L, k)

Utility routines
----------------

Several utility routines are also available.

To estimate the spectral norm of a matrix, use:

>>> snorm = sli.estimate_spectral_norm(A)

This algorithm is based on the randomized power method and thus requires only
matrix-vector products. The number of iterations to take can be set using the
keyword ``its`` (default: ``its=20``). The matrix is interpreted as a
:class:`scipy.sparse.linalg.LinearOperator`, but it is also valid to supply it
as a :class:`numpy.ndarray`, in which case it is trivially converted using
:func:`scipy.sparse.linalg.aslinearoperator`.

The same algorithm can also estimate the spectral norm of the difference of two
matrices ``A1`` and ``A2`` as follows:

>>> A1, A2 = A**2, A
>>> diff = sli.estimate_spectral_norm_diff(A1, A2)

This is often useful for checking the accuracy of a matrix approximation.

Some routines in :mod:`scipy.linalg.interpolative` require estimating the rank
of a matrix as well. This can be done with either:

>>> k = sli.estimate_rank(A, eps)

or:

>>> k = sli.estimate_rank(L, eps)

depending on the representation. The parameter ``eps`` controls the definition
of the numerical rank.

Finally, the random number generation required for all randomized routines can
be controlled via providing NumPy pseudo-random generators with a fixed seed. See
:class:`numpy.random.Generator` and :func:`numpy.random.default_rng` for more details.

Remarks
-------

The above functions all automatically detect the appropriate interface and work
with both real and complex data types, passing input arguments to the proper
backend routine.

"""

import scipy.linalg._decomp_interpolative as _backend
import numpy as np
import warnings

__all__ = [
    'estimate_rank',
    'estimate_spectral_norm',
    'estimate_spectral_norm_diff',
    'id_to_svd',
    'interp_decomp',
    'rand',
    'reconstruct_interp_matrix',
    'reconstruct_matrix_from_id',
    'reconstruct_skel_matrix',
    'seed',
    'svd',
]

_DTYPE_ERROR = ValueError("invalid input dtype (input must be float64 or complex128)")
_TYPE_ERROR = TypeError("invalid input type (must be array or LinearOperator)")


def _C_contiguous_copy(A):
    """
    Same as np.ascontiguousarray, but ensure a copy
    """
    A = np.asarray(A)
    if A.flags.c_contiguous:
        A = A.copy()
    else:
        A = np.ascontiguousarray(A)
    return A


def _is_real(A):
    try:
        if A.dtype == np.complex128:
            return False
        elif A.dtype == np.float64:
            return True
        else:
            raise _DTYPE_ERROR
    except AttributeError as e:
        raise _TYPE_ERROR from e


def seed(seed=None):
    """
    This function, historically, used to set the seed of the randomization algorithms
    used in the `scipy.linalg.interpolative` functions written in Fortran77.

    The library has been ported to Python and now the functions use the native NumPy
    generators and this function has no content and returns None. Thus this function
    should not be used and will be removed in SciPy version 1.17.0.
    """
    warnings.warn("`scipy.linalg.interpolative.seed` is deprecated and will be "
                  "removed in SciPy 1.17.0.", DeprecationWarning, stacklevel=3)


def rand(*shape):
    """
    This function, historically, used to generate uniformly distributed random number
    for the randomization algorithms used in the `scipy.linalg.interpolative` functions
    written in Fortran77.

    The library has been ported to Python and now the functions use the native NumPy
    generators. Thus this function should not be used and will be removed in the
    SciPy version 1.17.0.

    If pseudo-random numbers are needed, NumPy pseudo-random generators should be used
    instead.

    Parameters
    ----------
    *shape
        Shape of output array

    """
    warnings.warn("`scipy.linalg.interpolative.rand` is deprecated and will be "
                  "removed in SciPy 1.17.0.", DeprecationWarning, stacklevel=3)
    rng = np.random.default_rng()
    return rng.uniform(low=0., high=1.0, size=shape)


def interp_decomp(A, eps_or_k, rand=True, rng=None):
    """
    Compute ID of a matrix.

    An ID of a matrix `A` is a factorization defined by a rank `k`, a column
    index array `idx`, and interpolation coefficients `proj` such that::

        numpy.dot(A[:,idx[:k]], proj) = A[:,idx[k:]]

    The original matrix can then be reconstructed as::

        numpy.hstack([A[:,idx[:k]],
                                    numpy.dot(A[:,idx[:k]], proj)]
                                )[:,numpy.argsort(idx)]

    or via the routine :func:`reconstruct_matrix_from_id`. This can
    equivalently be written as::

        numpy.dot(A[:,idx[:k]],
                            numpy.hstack([numpy.eye(k), proj])
                          )[:,np.argsort(idx)]

    in terms of the skeleton and interpolation matrices::

        B = A[:,idx[:k]]

    and::

        P = numpy.hstack([numpy.eye(k), proj])[:,np.argsort(idx)]

    respectively. See also :func:`reconstruct_interp_matrix` and
    :func:`reconstruct_skel_matrix`.

    The ID can be computed to any relative precision or rank (depending on the
    value of `eps_or_k`). If a precision is specified (`eps_or_k < 1`), then
    this function has the output signature::

        k, idx, proj = interp_decomp(A, eps_or_k)

    Otherwise, if a rank is specified (`eps_or_k >= 1`), then the output
    signature is::

        idx, proj = interp_decomp(A, eps_or_k)

    ..  This function automatically detects the form of the input parameters
        and passes them to the appropriate backend. For details, see
        :func:`_backend.iddp_id`, :func:`_backend.iddp_aid`,
        :func:`_backend.iddp_rid`, :func:`_backend.iddr_id`,
        :func:`_backend.iddr_aid`, :func:`_backend.iddr_rid`,
        :func:`_backend.idzp_id`, :func:`_backend.idzp_aid`,
        :func:`_backend.idzp_rid`, :func:`_backend.idzr_id`,
        :func:`_backend.idzr_aid`, and :func:`_backend.idzr_rid`.

    Parameters
    ----------
    A : :class:`numpy.ndarray` or :class:`scipy.sparse.linalg.LinearOperator` with `rmatvec`
        Matrix to be factored
    eps_or_k : float or int
        Relative error (if ``eps_or_k < 1``) or rank (if ``eps_or_k >= 1``) of
        approximation.
    rand : bool, optional
        Whether to use random sampling if `A` is of type :class:`numpy.ndarray`
        (randomized algorithms are always used if `A` is of type
        :class:`scipy.sparse.linalg.LinearOperator`).
    rng : `numpy.random.Generator`, optional
        Pseudorandom number generator state. When `rng` is None, a new
        `numpy.random.Generator` is created using entropy from the
        operating system. Types other than `numpy.random.Generator` are
        passed to `numpy.random.default_rng` to instantiate a ``Generator``.
        If `rand` is ``False``, the argument is ignored.

    Returns
    -------
    k : int
        Rank required to achieve specified relative precision if
        ``eps_or_k < 1``.
    idx : :class:`numpy.ndarray`
        Column index array.
    proj : :class:`numpy.ndarray`
        Interpolation coefficients.
    """  # numpy/numpydoc#87  # noqa: E501
    from scipy.sparse.linalg import LinearOperator
    rng = np.random.default_rng(rng)
    real = _is_real(A)

    if isinstance(A, np.ndarray):
        A = _C_contiguous_copy(A)
        if eps_or_k < 1:
            eps = eps_or_k
            if rand:
                if real:
                    k, idx, proj = _backend.iddp_aid(A, eps, rng=rng)
                else:
                    k, idx, proj = _backend.idzp_aid(A, eps, rng=rng)
            else:
                if real:
                    k, idx, proj = _backend.iddp_id(A, eps)
                else:
                    k, idx, proj = _backend.idzp_id(A, eps)
            return k, idx, proj
        else:
            k = int(eps_or_k)
            if rand:
                if real:
                    idx, proj = _backend.iddr_aid(A, k, rng=rng)
                else:
                    idx, proj = _backend.idzr_aid(A, k, rng=rng)
            else:
                if real:
                    idx, proj = _backend.iddr_id(A, k)
                else:
                    idx, proj = _backend.idzr_id(A, k)
            return idx, proj
    elif isinstance(A, LinearOperator):

        if eps_or_k < 1:
            eps = eps_or_k
            if real:
                k, idx, proj = _backend.iddp_rid(A, eps, rng=rng)
            else:
                k, idx, proj = _backend.idzp_rid(A, eps, rng=rng)
            return k, idx, proj
        else:
            k = int(eps_or_k)
            if real:
                idx, proj = _backend.iddr_rid(A, k, rng=rng)
            else:
                idx, proj = _backend.idzr_rid(A, k, rng=rng)
            return idx, proj
    else:
        raise _TYPE_ERROR


def reconstruct_matrix_from_id(B, idx, proj):
    """
    Reconstruct matrix from its ID.

    A matrix `A` with skeleton matrix `B` and ID indices and coefficients `idx`
    and `proj`, respectively, can be reconstructed as::

        numpy.hstack([B, numpy.dot(B, proj)])[:,numpy.argsort(idx)]

    See also :func:`reconstruct_interp_matrix` and
    :func:`reconstruct_skel_matrix`.

    ..  This function automatically detects the matrix data type and calls the
        appropriate backend. For details, see :func:`_backend.idd_reconid` and
        :func:`_backend.idz_reconid`.

    Parameters
    ----------
    B : :class:`numpy.ndarray`
        Skeleton matrix.
    idx : :class:`numpy.ndarray`
        Column index array.
    proj : :class:`numpy.ndarray`
        Interpolation coefficients.

    Returns
    -------
    :class:`numpy.ndarray`
        Reconstructed matrix.
    """
    if _is_real(B):
        return _backend.idd_reconid(B, idx, proj)
    else:
        return _backend.idz_reconid(B, idx, proj)


def reconstruct_interp_matrix(idx, proj):
    """
    Reconstruct interpolation matrix from ID.

    The interpolation matrix can be reconstructed from the ID indices and
    coefficients `idx` and `proj`, respectively, as::

        P = numpy.hstack([numpy.eye(proj.shape[0]), proj])[:,numpy.argsort(idx)]

    The original matrix can then be reconstructed from its skeleton matrix ``B``
    via ``A = B @ P``

    See also :func:`reconstruct_matrix_from_id` and
    :func:`reconstruct_skel_matrix`.

    ..  This function automatically detects the matrix data type and calls the
        appropriate backend. For details, see :func:`_backend.idd_reconint` and
        :func:`_backend.idz_reconint`.

    Parameters
    ----------
    idx : :class:`numpy.ndarray`
        1D column index array.
    proj : :class:`numpy.ndarray`
        Interpolation coefficients.

    Returns
    -------
    :class:`numpy.ndarray`
        Interpolation matrix.
    """
    n, krank = len(idx), proj.shape[0]
    if _is_real(proj):
        p = np.zeros([krank, n], dtype=np.float64)
    else:
        p = np.zeros([krank, n], dtype=np.complex128)

    for ci in range(krank):
        p[ci, idx[ci]] = 1.0
    p[:, idx[krank:]] = proj[:, :]

    return p


def reconstruct_skel_matrix(A, k, idx):
    """
    Reconstruct skeleton matrix from ID.

    The skeleton matrix can be reconstructed from the original matrix `A` and its
    ID rank and indices `k` and `idx`, respectively, as::

        B = A[:,idx[:k]]

    The original matrix can then be reconstructed via::

        numpy.hstack([B, numpy.dot(B, proj)])[:,numpy.argsort(idx)]

    See also :func:`reconstruct_matrix_from_id` and
    :func:`reconstruct_interp_matrix`.

    ..  This function automatically detects the matrix data type and calls the
        appropriate backend. For details, see :func:`_backend.idd_copycols` and
        :func:`_backend.idz_copycols`.

    Parameters
    ----------
    A : :class:`numpy.ndarray`
        Original matrix.
    k : int
        Rank of ID.
    idx : :class:`numpy.ndarray`
        Column index array.

    Returns
    -------
    :class:`numpy.ndarray`
        Skeleton matrix.
    """
    return A[:, idx[:k]]


def id_to_svd(B, idx, proj):
    """
    Convert ID to SVD.

    The SVD reconstruction of a matrix with skeleton matrix `B` and ID indices and
    coefficients `idx` and `proj`, respectively, is::

        U, S, V = id_to_svd(B, idx, proj)
        A = numpy.dot(U, numpy.dot(numpy.diag(S), V.conj().T))

    See also :func:`svd`.

    ..  This function automatically detects the matrix data type and calls the
        appropriate backend. For details, see :func:`_backend.idd_id2svd` and
        :func:`_backend.idz_id2svd`.

    Parameters
    ----------
    B : :class:`numpy.ndarray`
        Skeleton matrix.
    idx : :class:`numpy.ndarray`
        1D column index array.
    proj : :class:`numpy.ndarray`
        Interpolation coefficients.

    Returns
    -------
    U : :class:`numpy.ndarray`
        Left singular vectors.
    S : :class:`numpy.ndarray`
        Singular values.
    V : :class:`numpy.ndarray`
        Right singular vectors.
    """
    B = _C_contiguous_copy(B)
    if _is_real(B):
        U, S, V = _backend.idd_id2svd(B, idx, proj)
    else:
        U, S, V = _backend.idz_id2svd(B, idx, proj)

    return U, S, V


def estimate_spectral_norm(A, its=20, rng=None):
    """
    Estimate spectral norm of a matrix by the randomized power method.

    ..  This function automatically detects the matrix data type and calls the
        appropriate backend. For details, see :func:`_backend.idd_snorm` and
        :func:`_backend.idz_snorm`.

    Parameters
    ----------
    A : :class:`scipy.sparse.linalg.LinearOperator`
        Matrix given as a :class:`scipy.sparse.linalg.LinearOperator` with the
        `matvec` and `rmatvec` methods (to apply the matrix and its adjoint).
    its : int, optional
        Number of power method iterations.
    rng : `numpy.random.Generator`, optional
        Pseudorandom number generator state. When `rng` is None, a new
        `numpy.random.Generator` is created using entropy from the
        operating system. Types other than `numpy.random.Generator` are
        passed to `numpy.random.default_rng` to instantiate a ``Generator``.
        If `rand` is ``False``, the argument is ignored.

    Returns
    -------
    float
        Spectral norm estimate.
    """
    from scipy.sparse.linalg import aslinearoperator
    rng = np.random.default_rng(rng)
    A = aslinearoperator(A)

    if _is_real(A):
        return _backend.idd_snorm(A, its=its, rng=rng)
    else:
        return _backend.idz_snorm(A, its=its, rng=rng)


def estimate_spectral_norm_diff(A, B, its=20, rng=None):
    """
    Estimate spectral norm of the difference of two matrices by the randomized
    power method.

    ..  This function automatically detects the matrix data type and calls the
        appropriate backend. For details, see :func:`_backend.idd_diffsnorm` and
        :func:`_backend.idz_diffsnorm`.

    Parameters
    ----------
    A : :class:`scipy.sparse.linalg.LinearOperator`
        First matrix given as a :class:`scipy.sparse.linalg.LinearOperator` with the
        `matvec` and `rmatvec` methods (to apply the matrix and its adjoint).
    B : :class:`scipy.sparse.linalg.LinearOperator`
        Second matrix given as a :class:`scipy.sparse.linalg.LinearOperator` with
        the `matvec` and `rmatvec` methods (to apply the matrix and its adjoint).
    its : int, optional
        Number of power method iterations.
    rng : `numpy.random.Generator`, optional
        Pseudorandom number generator state. When `rng` is None, a new
        `numpy.random.Generator` is created using entropy from the
        operating system. Types other than `numpy.random.Generator` are
        passed to `numpy.random.default_rng` to instantiate a ``Generator``.
        If `rand` is ``False``, the argument is ignored.

    Returns
    -------
    float
        Spectral norm estimate of matrix difference.
    """
    from scipy.sparse.linalg import aslinearoperator
    rng = np.random.default_rng(rng)
    A = aslinearoperator(A)
    B = aslinearoperator(B)

    if _is_real(A):
        return _backend.idd_diffsnorm(A, B, its=its, rng=rng)
    else:
        return _backend.idz_diffsnorm(A, B, its=its, rng=rng)


def svd(A, eps_or_k, rand=True, rng=None):
    """
    Compute SVD of a matrix via an ID.

    An SVD of a matrix `A` is a factorization::

        A = U @ np.diag(S) @ V.conj().T

    where `U` and `V` have orthonormal columns and `S` is nonnegative.

    The SVD can be computed to any relative precision or rank (depending on the
    value of `eps_or_k`).

    See also :func:`interp_decomp` and :func:`id_to_svd`.

    ..  This function automatically detects the form of the input parameters and
        passes them to the appropriate backend. For details, see
        :func:`_backend.iddp_svd`, :func:`_backend.iddp_asvd`,
        :func:`_backend.iddp_rsvd`, :func:`_backend.iddr_svd`,
        :func:`_backend.iddr_asvd`, :func:`_backend.iddr_rsvd`,
        :func:`_backend.idzp_svd`, :func:`_backend.idzp_asvd`,
        :func:`_backend.idzp_rsvd`, :func:`_backend.idzr_svd`,
        :func:`_backend.idzr_asvd`, and :func:`_backend.idzr_rsvd`.

    Parameters
    ----------
    A : :class:`numpy.ndarray` or :class:`scipy.sparse.linalg.LinearOperator`
        Matrix to be factored, given as either a :class:`numpy.ndarray` or a
        :class:`scipy.sparse.linalg.LinearOperator` with the `matvec` and
        `rmatvec` methods (to apply the matrix and its adjoint).
    eps_or_k : float or int
        Relative error (if ``eps_or_k < 1``) or rank (if ``eps_or_k >= 1``) of
        approximation.
    rand : bool, optional
        Whether to use random sampling if `A` is of type :class:`numpy.ndarray`
        (randomized algorithms are always used if `A` is of type
        :class:`scipy.sparse.linalg.LinearOperator`).
    rng : `numpy.random.Generator`, optional
        Pseudorandom number generator state. When `rng` is None, a new
        `numpy.random.Generator` is created using entropy from the
        operating system. Types other than `numpy.random.Generator` are
        passed to `numpy.random.default_rng` to instantiate a ``Generator``.
        If `rand` is ``False``, the argument is ignored.

    Returns
    -------
    U : :class:`numpy.ndarray`
        2D array of left singular vectors.
    S : :class:`numpy.ndarray`
        1D array of singular values.
    V : :class:`numpy.ndarray`
        2D array right singular vectors.
    """
    from scipy.sparse.linalg import LinearOperator
    rng = np.random.default_rng(rng)

    real = _is_real(A)

    if isinstance(A, np.ndarray):
        A = _C_contiguous_copy(A)
        if eps_or_k < 1:
            eps = eps_or_k
            if rand:
                if real:
                    U, S, V = _backend.iddp_asvd(A, eps, rng=rng)
                else:
                    U, S, V = _backend.idzp_asvd(A, eps, rng=rng)
            else:
                if real:
                    U, S, V = _backend.iddp_svd(A, eps)
                    V = V.T.conj()
                else:
                    U, S, V = _backend.idzp_svd(A, eps)
                    V = V.T.conj()
        else:
            k = int(eps_or_k)
            if k > min(A.shape):
                raise ValueError(f"Approximation rank {k} exceeds min(A.shape) = "
                                 f" {min(A.shape)} ")
            if rand:
                if real:
                    U, S, V = _backend.iddr_asvd(A, k, rng=rng)
                else:
                    U, S, V = _backend.idzr_asvd(A, k, rng=rng)
            else:
                if real:
                    U, S, V = _backend.iddr_svd(A, k)
                    V = V.T.conj()
                else:
                    U, S, V = _backend.idzr_svd(A, k)
                    V = V.T.conj()
    elif isinstance(A, LinearOperator):
        if eps_or_k < 1:
            eps = eps_or_k
            if real:
                U, S, V = _backend.iddp_rsvd(A, eps, rng=rng)
            else:
                U, S, V = _backend.idzp_rsvd(A, eps, rng=rng)
        else:
            k = int(eps_or_k)
            if real:
                U, S, V = _backend.iddr_rsvd(A, k, rng=rng)
            else:
                U, S, V = _backend.idzr_rsvd(A, k, rng=rng)
    else:
        raise _TYPE_ERROR
    return U, S, V


def estimate_rank(A, eps, rng=None):
    """
    Estimate matrix rank to a specified relative precision using randomized
    methods.

    The matrix `A` can be given as either a :class:`numpy.ndarray` or a
    :class:`scipy.sparse.linalg.LinearOperator`, with different algorithms used
    for each case. If `A` is of type :class:`numpy.ndarray`, then the output
    rank is typically about 8 higher than the actual numerical rank.

    ..  This function automatically detects the form of the input parameters and
        passes them to the appropriate backend. For details,
        see :func:`_backend.idd_estrank`, :func:`_backend.idd_findrank`,
        :func:`_backend.idz_estrank`, and :func:`_backend.idz_findrank`.

    Parameters
    ----------
    A : :class:`numpy.ndarray` or :class:`scipy.sparse.linalg.LinearOperator`
        Matrix whose rank is to be estimated, given as either a
        :class:`numpy.ndarray` or a :class:`scipy.sparse.linalg.LinearOperator`
        with the `rmatvec` method (to apply the matrix adjoint).
    eps : float
        Relative error for numerical rank definition.
    rng : `numpy.random.Generator`, optional
        Pseudorandom number generator state. When `rng` is None, a new
        `numpy.random.Generator` is created using entropy from the
        operating system. Types other than `numpy.random.Generator` are
        passed to `numpy.random.default_rng` to instantiate a ``Generator``.
        If `rand` is ``False``, the argument is ignored.

    Returns
    -------
    int
        Estimated matrix rank.
    """
    from scipy.sparse.linalg import LinearOperator

    rng = np.random.default_rng(rng)
    real = _is_real(A)

    if isinstance(A, np.ndarray):
        A = _C_contiguous_copy(A)
        if real:
            rank, _ = _backend.idd_estrank(A, eps, rng=rng)
        else:
            rank, _ = _backend.idz_estrank(A, eps, rng=rng)
        if rank == 0:
            # special return value for nearly full rank
            rank = min(A.shape)
        return rank
    elif isinstance(A, LinearOperator):
        if real:
            return _backend.idd_findrank(A, eps, rng=rng)[0]
        else:
            return _backend.idz_findrank(A, eps, rng=rng)[0]
    else:
        raise _TYPE_ERROR
