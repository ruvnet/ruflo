import itertools
import functools
import operator
import numpy as np

from math import prod

from . import _dierckx  # type: ignore[attr-defined]

import scipy.sparse.linalg as ssl
from scipy.sparse import csr_array

from ._bsplines import _not_a_knot

__all__ = ["NdBSpline"]


def _get_dtype(dtype):
    """Return np.complex128 for complex dtypes, np.float64 otherwise."""
    if np.issubdtype(dtype, np.complexfloating):
        return np.complex128
    else:
        return np.float64


class NdBSpline:
    """Tensor product spline object.

    The value at point ``xp = (x1, x2, ..., xN)`` is evaluated as a linear
    combination of products of one-dimensional b-splines in each of the ``N``
    dimensions::

       c[i1, i2, ..., iN] * B(x1; i1, t1) * B(x2; i2, t2) * ... * B(xN; iN, tN)


    Here ``B(x; i, t)`` is the ``i``-th b-spline defined by the knot vector
    ``t`` evaluated at ``x``.

    Parameters
    ----------
    t : tuple of 1D ndarrays
        knot vectors in directions 1, 2, ... N,
        ``len(t[i]) == n[i] + k + 1``
    c : ndarray, shape (n1, n2, ..., nN, ...)
        b-spline coefficients
    k : int or length-d tuple of integers
        spline degrees.
        A single integer is interpreted as having this degree for
        all dimensions.
    extrapolate : bool, optional
        Whether to extrapolate out-of-bounds inputs, or return `nan`.
        Default is to extrapolate.

    Attributes
    ----------
    t : tuple of ndarrays
        Knots vectors.
    c : ndarray
        Coefficients of the tensor-product spline.
    k : tuple of integers
        Degrees for each dimension.
    extrapolate : bool, optional
        Whether to extrapolate or return nans for out-of-bounds inputs.
        Defaults to true.

    Methods
    -------
    __call__
    design_matrix

    See Also
    --------
    BSpline : a one-dimensional B-spline object
    NdPPoly : an N-dimensional piecewise tensor product polynomial

    """
    def __init__(self, t, c, k, *, extrapolate=None):
        self._k, self._indices_k1d, (self._t, self._len_t) = _preprocess_inputs(k, t)

        if extrapolate is None:
            extrapolate = True
        self.extrapolate = bool(extrapolate)

        self.c = np.asarray(c)

        ndim = self._t.shape[0]   # == len(self.t)
        if self.c.ndim < ndim:
            raise ValueError(f"Coefficients must be at least {ndim}-dimensional.")

        for d in range(ndim):
            td = self.t[d]
            kd = self.k[d]
            n = td.shape[0] - kd - 1

            if self.c.shape[d] != n:
                raise ValueError(f"Knots, coefficients and degree in dimension"
                                 f" {d} are inconsistent:"
                                 f" got {self.c.shape[d]} coefficients for"
                                 f" {len(td)} knots, need at least {n} for"
                                 f" k={k}.")

        dt = _get_dtype(self.c.dtype)
        self.c = np.ascontiguousarray(self.c, dtype=dt)

    @property
    def k(self):
        return tuple(self._k)

    @property
    def t(self):
        # repack the knots into a tuple
        return tuple(self._t[d, :self._len_t[d]] for d in range(self._t.shape[0]))

    def __call__(self, xi, *, nu=None, extrapolate=None):
        """Evaluate the tensor product b-spline at ``xi``.

        Parameters
        ----------
        xi : array_like, shape(..., ndim)
            The coordinates to evaluate the interpolator at.
            This can be a list or tuple of ndim-dimensional points
            or an array with the shape (num_points, ndim).
        nu : array_like, optional, shape (ndim,)
            Orders of derivatives to evaluate. Each must be non-negative.
            Defaults to the zeroth derivivative.
        extrapolate : bool, optional
            Whether to exrapolate based on first and last intervals in each
            dimension, or return `nan`. Default is to ``self.extrapolate``.

        Returns
        -------
        values : ndarray, shape ``xi.shape[:-1] + self.c.shape[ndim:]``
            Interpolated values at ``xi``
        """
        ndim = self._t.shape[0]  # == len(self.t)

        if extrapolate is None:
            extrapolate = self.extrapolate
        extrapolate = bool(extrapolate)

        if nu is None:
            nu = np.zeros((ndim,), dtype=np.int64)
        else:
            nu = np.asarray(nu, dtype=np.int64)
            if nu.ndim != 1 or nu.shape[0] != ndim:
                raise ValueError(
                    f"invalid number of derivative orders {nu = } for "
                    f"ndim = {len(self.t)}.")
            if any(nu < 0):
                raise ValueError(f"derivatives must be positive, got {nu = }")

        # prepare xi : shape (..., m1, ..., md) -> (1, m1, ..., md)
        xi = np.asarray(xi, dtype=float)
        xi_shape = xi.shape
        xi = xi.reshape(-1, xi_shape[-1])
        xi = np.ascontiguousarray(xi)

        if xi_shape[-1] != ndim:
            raise ValueError(f"Shapes: xi.shape={xi_shape} and ndim={ndim}")

        # complex -> double
        was_complex = self.c.dtype.kind == 'c'
        cc = self.c
        if was_complex and self.c.ndim == ndim:
            # make sure that core dimensions are intact, and complex->float
            # size doubling only adds a trailing dimension
            cc = self.c[..., None]
        cc = cc.view(float)

        # prepare the coefficients: flatten the trailing dimensions
        c1 = cc.reshape(cc.shape[:ndim] + (-1,))
        c1r = c1.ravel()

        # replacement for np.ravel_multi_index for indexing of `c1`:
        _strides_c1 = np.asarray([s // c1.dtype.itemsize
                                  for s in c1.strides], dtype=np.int64)

        num_c_tr = c1.shape[-1]  # # of trailing coefficients
        out = _dierckx.evaluate_ndbspline(xi,
                                 self._t,
                                 self._len_t,
                                 self._k,
                                 nu,
                                 extrapolate,
                                 c1r,
                                 num_c_tr,
                                 _strides_c1,
                                 self._indices_k1d,
        )
        out = out.view(self.c.dtype)
        return out.reshape(xi_shape[:-1] + self.c.shape[ndim:])

    @classmethod
    def design_matrix(cls, xvals, t, k, extrapolate=True):
        """Construct the design matrix as a CSR format sparse array.

        Parameters
        ----------
        xvals :  ndarray, shape(npts, ndim)
            Data points. ``xvals[j, :]`` gives the ``j``-th data point as an
            ``ndim``-dimensional array.
        t : tuple of 1D ndarrays, length-ndim
            Knot vectors in directions 1, 2, ... ndim,
        k : int
            B-spline degree.
        extrapolate : bool, optional
            Whether to extrapolate out-of-bounds values of raise a `ValueError`

        Returns
        -------
        design_matrix : a CSR array
            Each row of the design matrix corresponds to a value in `xvals` and
            contains values of b-spline basis elements which are non-zero
            at this value.

        """
        xvals = np.asarray(xvals, dtype=float)
        ndim = xvals.shape[-1]
        if len(t) != ndim:
            raise ValueError(
                f"Data and knots are inconsistent: len(t) = {len(t)} for "
                f" {ndim = }."
            )

        # tabulate the flat indices for iterating over the (k+1)**ndim subarray
        k, _indices_k1d, (_t, len_t) = _preprocess_inputs(k, t)

        # Precompute the shape and strides of the 'coefficients array'.
        # This would have been the NdBSpline coefficients; in the present context
        # this is a helper to compute the indices into the colocation matrix.
        c_shape = tuple(len_t[d] - k[d] - 1 for d in range(ndim))

        # The strides of the coeffs array: the computation is equivalent to
        # >>> cstrides = [s // 8 for s in np.empty(c_shape).strides]
        cs = c_shape[1:] + (1,)
        cstrides = np.cumprod(cs[::-1], dtype=np.int64)[::-1].copy()

        # heavy lifting happens here
        data, indices, indptr = _dierckx._coloc_nd(xvals,
                _t, len_t, k, _indices_k1d, cstrides)

        return csr_array((data, indices, indptr))


def _preprocess_inputs(k, t_tpl):
    """Helpers: validate and preprocess NdBSpline inputs.

       Parameters
       ----------
       k : int or tuple
          Spline orders
       t_tpl : tuple or array-likes
          Knots.
    """
    # 1. Make sure t_tpl is a tuple
    if not isinstance(t_tpl, tuple):
        raise ValueError(f"Expect `t` to be a tuple of array-likes. "
                         f"Got {t_tpl} instead."
        )

    # 2. Make ``k`` a tuple of integers
    ndim = len(t_tpl)
    try:
        len(k)
    except TypeError:
        # make k a tuple
        k = (k,)*ndim

    k = np.asarray([operator.index(ki) for ki in k], dtype=np.int64)

    if len(k) != ndim:
        raise ValueError(f"len(t) = {len(t_tpl)} != {len(k) = }.")

    # 3. Validate inputs
    ndim = len(t_tpl)
    for d in range(ndim):
        td = np.asarray(t_tpl[d])
        kd = k[d]
        n = td.shape[0] - kd - 1
        if kd < 0:
            raise ValueError(f"Spline degree in dimension {d} cannot be"
                             f" negative.")
        if td.ndim != 1:
            raise ValueError(f"Knot vector in dimension {d} must be"
                             f" one-dimensional.")
        if n < kd + 1:
            raise ValueError(f"Need at least {2*kd + 2} knots for degree"
                             f" {kd} in dimension {d}.")
        if (np.diff(td) < 0).any():
            raise ValueError(f"Knots in dimension {d} must be in a"
                             f" non-decreasing order.")
        if len(np.unique(td[kd:n + 1])) < 2:
            raise ValueError(f"Need at least two internal knots in"
                             f" dimension {d}.")
        if not np.isfinite(td).all():
            raise ValueError(f"Knots in dimension {d} should not have"
                             f" nans or infs.")

    # 4. tabulate the flat indices for iterating over the (k+1)**ndim subarray
    # non-zero b-spline elements
    shape = tuple(kd + 1 for kd in k)
    indices = np.unravel_index(np.arange(prod(shape)), shape)
    _indices_k1d = np.asarray(indices, dtype=np.int64).T.copy()

    # 5. pack the knots into a single array:
    #    ([1, 2, 3, 4], [5, 6], (7, 8, 9)) -->
    #    array([[1, 2, 3, 4],
    #           [5, 6, nan, nan],
    #           [7, 8, 9, nan]])
    ndim = len(t_tpl)
    len_t = [len(ti) for ti in t_tpl]
    _t = np.empty((ndim, max(len_t)), dtype=float)
    _t.fill(np.nan)
    for d in range(ndim):
        _t[d, :len(t_tpl[d])] = t_tpl[d]
    len_t = np.asarray(len_t, dtype=np.int64)

    return k, _indices_k1d, (_t, len_t)


def _iter_solve(a, b, solver=ssl.gcrotmk, **solver_args):
    # work around iterative solvers not accepting multiple r.h.s.

    # also work around a.dtype == float64 and b.dtype == complex128
    # cf https://github.com/scipy/scipy/issues/19644
    if np.issubdtype(b.dtype, np.complexfloating):
        real = _iter_solve(a, b.real, solver, **solver_args)
        imag = _iter_solve(a, b.imag, solver, **solver_args)
        return real + 1j*imag

    if b.ndim == 2 and b.shape[1] !=1:
        res = np.empty_like(b)
        for j in range(b.shape[1]):
            res[:, j], info = solver(a, b[:, j], **solver_args)
            if info != 0:
                raise ValueError(f"{solver = } returns {info =} for column {j}.")
        return res
    else:
        res, info = solver(a, b, **solver_args)
        if info != 0:
            raise ValueError(f"{solver = } returns {info = }.")
        return res


def make_ndbspl(points, values, k=3, *, solver=ssl.gcrotmk, **solver_args):
    """Construct an interpolating NdBspline.

    Parameters
    ----------
    points : tuple of ndarrays of float, with shapes (m1,), ... (mN,)
        The points defining the regular grid in N dimensions. The points in
        each dimension (i.e. every element of the `points` tuple) must be
        strictly ascending or descending.      
    values : ndarray of float, shape (m1, ..., mN, ...)
        The data on the regular grid in n dimensions.
    k : int, optional
        The spline degree. Must be odd. Default is cubic, k=3
    solver : a `scipy.sparse.linalg` solver (iterative or direct), optional.
        An iterative solver from `scipy.sparse.linalg` or a direct one,
        `sparse.sparse.linalg.spsolve`.
        Used to solve the sparse linear system
        ``design_matrix @ coefficients = rhs`` for the coefficients.
        Default is `scipy.sparse.linalg.gcrotmk`
    solver_args : dict, optional
        Additional arguments for the solver. The call signature is
        ``solver(csr_array, rhs_vector, **solver_args)``

    Returns
    -------
    spl : NdBSpline object

    Notes
    -----
    Boundary conditions are not-a-knot in all dimensions.
    """
    ndim = len(points)
    xi_shape = tuple(len(x) for x in points)

    try:
        len(k)
    except TypeError:
        # make k a tuple
        k = (k,)*ndim

    for d, point in enumerate(points):
        numpts = len(np.atleast_1d(point))
        if numpts <= k[d]:
            raise ValueError(f"There are {numpts} points in dimension {d},"
                             f" but order {k[d]} requires at least "
                             f" {k[d]+1} points per dimension.")

    t = tuple(_not_a_knot(np.asarray(points[d], dtype=float), k[d])
              for d in range(ndim))
    xvals = np.asarray([xv for xv in itertools.product(*points)], dtype=float)

    # construct the colocation matrix
    matr = NdBSpline.design_matrix(xvals, t, k)

    # Solve for the coefficients given `values`.
    # Trailing dimensions: first ndim dimensions are data, the rest are batch
    # dimensions, so stack `values` into a 2D array for `spsolve` to undestand.
    v_shape = values.shape
    vals_shape = (prod(v_shape[:ndim]), prod(v_shape[ndim:]))
    vals = values.reshape(vals_shape)

    if solver != ssl.spsolve:
        solver = functools.partial(_iter_solve, solver=solver)
        if "atol" not in solver_args:
            # avoid a DeprecationWarning, grumble grumble
            solver_args["atol"] = 1e-6

    coef = solver(matr, vals, **solver_args)
    coef = coef.reshape(xi_shape + v_shape[ndim:])
    return NdBSpline(t, coef, k)

