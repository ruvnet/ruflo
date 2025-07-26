# Copyright (c) 2017, The Chancellor, Masters and Scholars of the University
# of Oxford, and the Chebfun Developers. All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
#     * Redistributions of source code must retain the above copyright
#       notice, this list of conditions and the following disclaimer.
#     * Redistributions in binary form must reproduce the above copyright
#       notice, this list of conditions and the following disclaimer in the
#       documentation and/or other materials provided with the distribution.
#     * Neither the name of the University of Oxford nor the names of its
#       contributors may be used to endorse or promote products derived from
#       this software without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
# ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
# WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
# DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
# ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
# (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
# LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
# ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
# (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
# SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

import warnings
import operator

import numpy as np
import scipy


__all__ = ["AAA", "FloaterHormannInterpolator"]


class _BarycentricRational:
    """Base class for barycentric representation of a rational function."""
    def __init__(self, x, y, **kwargs):
        # input validation
        z = np.asarray(x)
        f = np.asarray(y)

        self._input_validation(z, f, **kwargs)

        # Remove infinite or NaN function values and repeated entries
        to_keep = np.logical_and.reduce(
            ((np.isfinite(f)) & (~np.isnan(f))).reshape(f.shape[0], -1),
            axis=-1
        )
        f = f[to_keep, ...]
        z = z[to_keep]
        z, uni = np.unique(z, return_index=True)
        f = f[uni, ...]

        self._shape = f.shape[1:]
        self._support_points, self._support_values, self.weights = (
            self._compute_weights(z, f, **kwargs)
        )

        # only compute once
        self._poles = None
        self._residues = None
        self._roots = None

    def _input_validation(self, x, y, **kwargs):
        if x.ndim != 1:
            raise ValueError("`x` must be 1-D.")

        if not y.ndim >= 1:
            raise ValueError("`y` must be at least 1-D.")

        if x.size != y.shape[0]:
            raise ValueError("`x` be the same size as the first dimension of `y`.")

        if not np.all(np.isfinite(x)):
            raise ValueError("`x` must be finite.")

    def _compute_weights(z, f, **kwargs):
        raise NotImplementedError

    def __call__(self, z):
        """Evaluate the rational approximation at given values.

        Parameters
        ----------
        z : array_like
            Input values.
        """
        # evaluate rational function in barycentric form.
        z = np.asarray(z)
        zv = np.ravel(z)

        support_values = self._support_values.reshape(
            (self._support_values.shape[0], -1)
        )
        weights = self.weights[..., np.newaxis]

        # Cauchy matrix
        # Ignore errors due to inf/inf at support points, these will be fixed later
        with np.errstate(invalid="ignore", divide="ignore"):
            CC = 1 / np.subtract.outer(zv, self._support_points)
            # Vector of values
            r = CC @ (weights * support_values) / (CC @ weights)

        # Deal with input inf: `r(inf) = lim r(z) = sum(w*f) / sum(w)`
        if np.any(np.isinf(zv)):
            r[np.isinf(zv)] = (np.sum(weights * support_values)
                               / np.sum(weights))

        # Deal with NaN
        ii = np.nonzero(np.isnan(r))[0]
        for jj in ii:
            if np.isnan(zv[jj]) or not np.any(zv[jj] == self._support_points):
                # r(NaN) = NaN is fine.
                # The second case may happen if `r(zv[ii]) = 0/0` at some point.
                pass
            else:
                # Clean up values `NaN = inf/inf` at support points.
                # Find the corresponding node and set entry to correct value:
                r[jj] = support_values[zv[jj] == self._support_points].squeeze()

        return np.reshape(r, z.shape + self._shape)

    def poles(self):
        """Compute the poles of the rational approximation.

        Returns
        -------
        poles : array
            Poles of the AAA approximation, repeated according to their multiplicity
            but not in any specific order.
        """
        if self._poles is None:
            # Compute poles via generalized eigenvalue problem
            m = self.weights.size
            B = np.eye(m + 1, dtype=self.weights.dtype)
            B[0, 0] = 0

            E = np.zeros_like(B, dtype=np.result_type(self.weights,
                                                      self._support_points))
            E[0, 1:] = self.weights
            E[1:, 0] = 1
            np.fill_diagonal(E[1:, 1:], self._support_points)

            pol = scipy.linalg.eigvals(E, B)
            self._poles = pol[np.isfinite(pol)]
        return self._poles

    def residues(self):
        """Compute the residues of the poles of the approximation.

        Returns
        -------
        residues : array
            Residues associated with the `poles` of the approximation
        """
        if self._residues is None:
            # Compute residues via formula for res of quotient of analytic functions
            with np.errstate(divide="ignore", invalid="ignore"):
                N = (1/(np.subtract.outer(self.poles(), self._support_points))) @ (
                    self._support_values * self.weights
                )
                Ddiff = (
                    -((1/np.subtract.outer(self.poles(), self._support_points))**2)
                    @ self.weights
                )
                self._residues = N / Ddiff
        return self._residues

    def roots(self):
        """Compute the zeros of the rational approximation.

        Returns
        -------
        zeros : array
            Zeros of the AAA approximation, repeated according to their multiplicity
            but not in any specific order.
        """
        if self._roots is None:
            # Compute zeros via generalized eigenvalue problem
            m = self.weights.size
            B = np.eye(m + 1, dtype=self.weights.dtype)
            B[0, 0] = 0
            E = np.zeros_like(B, dtype=np.result_type(self.weights,
                                                      self._support_values,
                                                      self._support_points))
            E[0, 1:] = self.weights * self._support_values
            E[1:, 0] = 1
            np.fill_diagonal(E[1:, 1:], self._support_points)

            zer = scipy.linalg.eigvals(E, B)
            self._roots = zer[np.isfinite(zer)]
        return self._roots


class AAA(_BarycentricRational):
    r"""
    AAA real or complex rational approximation.

    As described in [1]_, the AAA algorithm is a greedy algorithm for approximation by
    rational functions on a real or complex set of points. The rational approximation is
    represented in a barycentric form from which the roots (zeros), poles, and residues
    can be computed.

    Parameters
    ----------
    x : 1D array_like, shape (n,)
        1-D array containing values of the independent variable. Values may be real or
        complex but must be finite.
    y : 1D array_like, shape (n,)
        Function values ``f(x)``. Infinite and NaN values of `values` and
        corresponding values of `points` will be discarded.
    rtol : float, optional
        Relative tolerance, defaults to ``eps**0.75``. If a small subset of the entries
        in `values` are much larger than the rest the default tolerance may be too
        loose. If the tolerance is too tight then the approximation may contain
        Froissart doublets or the algorithm may fail to converge entirely.
    max_terms : int, optional
        Maximum number of terms in the barycentric representation, defaults to ``100``.
        Must be greater than or equal to one.
    clean_up : bool, optional
        Automatic removal of Froissart doublets, defaults to ``True``. See notes for
        more details.
    clean_up_tol : float, optional
        Poles with residues less than this number times the geometric mean
        of `values` times the minimum distance to `points` are deemed spurious by the
        cleanup procedure, defaults to 1e-13. See notes for more details.

    Attributes
    ----------
    support_points : array
        Support points of the approximation. These are a subset of the provided `x` at
        which the approximation strictly interpolates `y`.
        See notes for more details.
    support_values : array
        Value of the approximation at the `support_points`.
    weights : array
        Weights of the barycentric approximation.
    errors : array
        Error :math:`|f(z) - r(z)|_\infty` over `points` in the successive iterations
        of AAA.

    Warns
    -----
    RuntimeWarning
        If `rtol` is not achieved in `max_terms` iterations.

    See Also
    --------
    FloaterHormannInterpolator : Floater-Hormann barycentric rational interpolation.
    pade : Padé approximation.

    Notes
    -----
    At iteration :math:`m` (at which point there are :math:`m` terms in the both the
    numerator and denominator of the approximation), the
    rational approximation in the AAA algorithm takes the barycentric form

    .. math::

        r(z) = n(z)/d(z) =
        \frac{\sum_{j=1}^m\ w_j f_j / (z - z_j)}{\sum_{j=1}^m w_j / (z - z_j)},

    where :math:`z_1,\dots,z_m` are real or complex support points selected from
    `x`, :math:`f_1,\dots,f_m` are the corresponding real or complex data values
    from `y`, and :math:`w_1,\dots,w_m` are real or complex weights.

    Each iteration of the algorithm has two parts: the greedy selection the next support
    point and the computation of the weights. The first part of each iteration is to
    select the next support point to be added :math:`z_{m+1}` from the remaining
    unselected `x`, such that the nonlinear residual
    :math:`|f(z_{m+1}) - n(z_{m+1})/d(z_{m+1})|` is maximised. The algorithm terminates
    when this maximum is less than ``rtol * np.linalg.norm(f, ord=np.inf)``. This means
    the interpolation property is only satisfied up to a tolerance, except at the
    support points where approximation exactly interpolates the supplied data.

    In the second part of each iteration, the weights :math:`w_j` are selected to solve
    the least-squares problem

    .. math::

        \text{minimise}_{w_j}|fd - n| \quad \text{subject to} \quad
        \sum_{j=1}^{m+1} w_j = 1,

    over the unselected elements of `x`.

    One of the challenges with working with rational approximations is the presence of
    Froissart doublets, which are either poles with vanishingly small residues or
    pole-zero pairs that are close enough together to nearly cancel, see [2]_. The
    greedy nature of the AAA algorithm means Froissart doublets are rare. However, if
    `rtol` is set too tight then the approximation will stagnate and many Froissart
    doublets will appear. Froissart doublets can usually be removed by removing support
    points and then resolving the least squares problem. The support point :math:`z_j`,
    which is the closest support point to the pole :math:`a` with residue
    :math:`\alpha`, is removed if the following is satisfied

    .. math::

        |\alpha| / |z_j - a| < \verb|clean_up_tol| \cdot \tilde{f},

    where :math:`\tilde{f}` is the geometric mean of `support_values`.


    References
    ----------
    .. [1] Y. Nakatsukasa, O. Sete, and L. N. Trefethen, "The AAA algorithm for
            rational approximation", SIAM J. Sci. Comp. 40 (2018), A1494-A1522.
            :doi:`10.1137/16M1106122`
    .. [2] J. Gilewicz and M. Pindor, Pade approximants and noise: rational functions,
           J. Comp. Appl. Math. 105 (1999), pp. 285-297.
           :doi:`10.1016/S0377-0427(02)00674-X`

    Examples
    --------

    Here we reproduce a number of the numerical examples from [1]_ as a demonstration
    of the functionality offered by this method.

    >>> import numpy as np
    >>> import matplotlib.pyplot as plt
    >>> from scipy.interpolate import AAA
    >>> import warnings

    For the first example we approximate the gamma function on ``[-3.5, 4.5]`` by
    extrapolating from 100 samples in ``[-1.5, 1.5]``.

    >>> from scipy.special import gamma
    >>> sample_points = np.linspace(-1.5, 1.5, num=100)
    >>> r = AAA(sample_points, gamma(sample_points))
    >>> z = np.linspace(-3.5, 4.5, num=1000)
    >>> fig, ax = plt.subplots()
    >>> ax.plot(z, gamma(z), label="Gamma")
    >>> ax.plot(sample_points, gamma(sample_points), label="Sample points")
    >>> ax.plot(z, r(z).real, '--', label="AAA approximation")
    >>> ax.set(xlabel="z", ylabel="r(z)", ylim=[-8, 8], xlim=[-3.5, 4.5])
    >>> ax.legend()
    >>> plt.show()

    We can also view the poles of the rational approximation and their residues:

    >>> order = np.argsort(r.poles())
    >>> r.poles()[order]
    array([-3.81591039e+00+0.j        , -3.00269049e+00+0.j        ,
           -1.99999988e+00+0.j        , -1.00000000e+00+0.j        ,
            5.85842812e-17+0.j        ,  4.77485458e+00-3.06919376j,
            4.77485458e+00+3.06919376j,  5.29095868e+00-0.97373072j,
            5.29095868e+00+0.97373072j])
    >>> r.residues()[order]
    array([ 0.03658074 +0.j        , -0.16915426 -0.j        ,
            0.49999915 +0.j        , -1.         +0.j        ,
            1.         +0.j        , -0.81132013 -2.30193429j,
           -0.81132013 +2.30193429j,  0.87326839+10.70148546j,
            0.87326839-10.70148546j])

    For the second example, we call `AAA` with a spiral of 1000 points that wind 7.5
    times around the origin in the complex plane.

    >>> z = np.exp(np.linspace(-0.5, 0.5 + 15j*np.pi, 1000))
    >>> r = AAA(z, np.tan(np.pi*z/2), rtol=1e-13)

    We see that AAA takes 12 steps to converge with the following errors:

    >>> r.errors.size
    12
    >>> r.errors
    array([2.49261500e+01, 4.28045609e+01, 1.71346935e+01, 8.65055336e-02,
           1.27106444e-02, 9.90889874e-04, 5.86910543e-05, 1.28735561e-06,
           3.57007424e-08, 6.37007837e-10, 1.67103357e-11, 1.17112299e-13])

    We can also plot the computed poles:

    >>> fig, ax = plt.subplots()
    >>> ax.plot(z.real, z.imag, '.', markersize=2, label="Sample points")
    >>> ax.plot(r.poles().real, r.poles().imag, '.', markersize=5,
    ...         label="Computed poles")
    >>> ax.set(xlim=[-3.5, 3.5], ylim=[-3.5, 3.5], aspect="equal")
    >>> ax.legend()
    >>> plt.show()

    We now demonstrate the removal of Froissart doublets using the `clean_up` method
    using an example from [1]_. Here we approximate the function
    :math:`f(z)=\log(2 + z^4)/(1 + 16z^4)` by sampling it at 1000 roots of unity. The
    algorithm is run with ``rtol=0`` and ``clean_up=False`` to deliberately cause
    Froissart doublets to appear.

    >>> z = np.exp(1j*2*np.pi*np.linspace(0,1, num=1000))
    >>> def f(z):
    ...     return np.log(2 + z**4)/(1 - 16*z**4)
    >>> with warnings.catch_warnings():  # filter convergence warning due to rtol=0
    ...     warnings.simplefilter('ignore', RuntimeWarning)
    ...     r = AAA(z, f(z), rtol=0, max_terms=50, clean_up=False)
    >>> mask = np.abs(r.residues()) < 1e-13
    >>> fig, axs = plt.subplots(ncols=2)
    >>> axs[0].plot(r.poles().real[~mask], r.poles().imag[~mask], '.')
    >>> axs[0].plot(r.poles().real[mask], r.poles().imag[mask], 'r.')

    Now we call the `clean_up` method to remove Froissart doublets.

    >>> with warnings.catch_warnings():
    ...     warnings.simplefilter('ignore', RuntimeWarning)
    ...     r.clean_up()
    4  # may vary
    >>> mask = np.abs(r.residues()) < 1e-13
    >>> axs[1].plot(r.poles().real[~mask], r.poles().imag[~mask], '.')
    >>> axs[1].plot(r.poles().real[mask], r.poles().imag[mask], 'r.')
    >>> plt.show()

    The left image shows the poles prior of the approximation ``clean_up=False`` with
    poles with residue less than ``10^-13`` in absolute value shown in red. The right
    image then shows the poles after the `clean_up` method has been called.
    """
    def __init__(self, x, y, *, rtol=None, max_terms=100, clean_up=True,
                 clean_up_tol=1e-13):
        super().__init__(x, y, rtol=rtol, max_terms=max_terms)

        if clean_up:
            self.clean_up(clean_up_tol)

    def _input_validation(self, x, y, rtol=None, max_terms=100, clean_up=True,
                          clean_up_tol=1e-13):
        max_terms = operator.index(max_terms)
        if max_terms < 1:
            raise ValueError("`max_terms` must be an integer value greater than or "
                             "equal to one.")

        if y.ndim != 1:
            raise ValueError("`y` must be 1-D.")

        super()._input_validation(x, y)

    @property
    def support_points(self):
        return self._support_points

    @property
    def support_values(self):
        return self._support_values

    def _compute_weights(self, z, f, rtol, max_terms):
        # Initialization for AAA iteration
        M = np.size(z)
        mask = np.ones(M, dtype=np.bool_)
        dtype = np.result_type(z, f, 1.0)
        rtol = np.finfo(dtype).eps**0.75 if rtol is None else rtol
        atol = rtol * np.linalg.norm(f, ord=np.inf)
        zj = np.empty(max_terms, dtype=dtype)
        fj = np.empty(max_terms, dtype=dtype)
        # Cauchy matrix
        C = np.empty((M, max_terms), dtype=dtype)
        # Loewner matrix
        A = np.empty((M, max_terms), dtype=dtype)
        errors = np.empty(max_terms, dtype=A.real.dtype)
        R = np.repeat(np.mean(f), M)

        # AAA iteration
        for m in range(max_terms):
            # Introduce next support point
            # Select next support point
            jj = np.argmax(np.abs(f[mask] - R[mask]))
            # Update support points
            zj[m] = z[mask][jj]
            # Update data values
            fj[m] = f[mask][jj]
            # Next column of Cauchy matrix
            # Ignore errors as we manually interpolate at support points
            with np.errstate(divide="ignore", invalid="ignore"):
                C[:, m] = 1 / (z - z[mask][jj])
            # Update mask
            mask[np.nonzero(mask)[0][jj]] = False
            # Update Loewner matrix
            # Ignore errors as inf values will be masked out in SVD call
            with np.errstate(invalid="ignore"):
                A[:, m] = (f - fj[m]) * C[:, m]

            # Compute weights
            rows = mask.sum()
            if rows >= m + 1:
                # The usual tall-skinny case
                _, s, V = scipy.linalg.svd(
                    A[mask, : m + 1], full_matrices=False, check_finite=False,
                )
                # Treat case of multiple min singular values
                mm = s == np.min(s)
                # Aim for non-sparse weight vector
                wj = (V.conj()[mm, :].sum(axis=0) / np.sqrt(mm.sum())).astype(dtype)
            else:
                # Fewer rows than columns
                V = scipy.linalg.null_space(A[mask, : m + 1], check_finite=False)
                nm = V.shape[-1]
                # Aim for non-sparse wt vector
                wj = V.sum(axis=-1) / np.sqrt(nm)

            # Compute rational approximant
            # Omit columns with `wj == 0`
            i0 = wj != 0
            # Ignore errors as we manually interpolate at support points
            with np.errstate(invalid="ignore"):
                # Numerator
                N = C[:, : m + 1][:, i0] @ (wj[i0] * fj[: m + 1][i0])
                # Denominator
                D = C[:, : m + 1][:, i0] @ wj[i0]
            # Interpolate at support points with `wj !=0`
            D_inf = np.isinf(D) | np.isnan(D)
            D[D_inf] = 1
            N[D_inf] = f[D_inf]
            R = N / D

            # Check if converged
            max_error = np.linalg.norm(f - R, ord=np.inf)
            errors[m] = max_error
            if max_error <= atol:
                break

        if m == max_terms - 1:
            warnings.warn(f"AAA failed to converge within {max_terms} iterations.",
                          RuntimeWarning, stacklevel=2)

        # Trim off unused array allocation
        zj = zj[: m + 1]
        fj = fj[: m + 1]

        # Remove support points with zero weight
        i_non_zero = wj != 0
        self.errors = errors[: m + 1]
        self._points = z
        self._values = f
        return zj[i_non_zero], fj[i_non_zero], wj[i_non_zero]

    def clean_up(self, cleanup_tol=1e-13):
        """Automatic removal of Froissart doublets.

        Parameters
        ----------
        cleanup_tol : float, optional
            Poles with residues less than this number times the geometric mean
            of `values` times the minimum distance to `points` are deemed spurious by
            the cleanup procedure, defaults to 1e-13.

        Returns
        -------
        int
            Number of Froissart doublets detected
        """
        # Find negligible residues
        geom_mean_abs_f = scipy.stats.gmean(np.abs(self._values))

        Z_distances = np.min(
            np.abs(np.subtract.outer(self.poles(), self._points)), axis=1
        )

        with np.errstate(divide="ignore", invalid="ignore"):
            ii = np.nonzero(
                np.abs(self.residues()) / Z_distances < cleanup_tol * geom_mean_abs_f
            )

        ni = ii[0].size
        if ni == 0:
            return ni

        warnings.warn(f"{ni} Froissart doublets detected.", RuntimeWarning,
                        stacklevel=2)

        # For each spurious pole find and remove closest support point
        closest_spt_point = np.argmin(
            np.abs(np.subtract.outer(self._support_points, self.poles()[ii])), axis=0
        )
        self._support_points = np.delete(self._support_points, closest_spt_point)
        self._support_values = np.delete(self._support_values, closest_spt_point)

        # Remove support points z from sample set
        mask = np.logical_and.reduce(
            np.not_equal.outer(self._points, self._support_points), axis=1
        )
        f = self._values[mask]
        z = self._points[mask]

        # recompute weights, we resolve the least squares problem for the remaining
        # support points

        m = self._support_points.size

        # Cauchy matrix
        C = 1 / np.subtract.outer(z, self._support_points)
        # Loewner matrix
        A = f[:, np.newaxis] * C - C * self._support_values

        # Solve least-squares problem to obtain weights
        _, _, V = scipy.linalg.svd(A, check_finite=False)
        self.weights = np.conj(V[m - 1,:])

        # reset roots, poles, residues as cached values will be wrong with new weights
        self._poles = None
        self._residues = None
        self._roots = None

        return ni


class FloaterHormannInterpolator(_BarycentricRational):
    r"""Floater-Hormann barycentric rational interpolator (C∞ smooth on real axis).

    As described in [1]_, the method of Floater and Hormann computes weights for a
    barycentric rational interpolant with no poles on the real axis.

    Parameters
    ----------
    x : 1D array_like, shape (n,)
        1-D array containing values of the independent variable. Values may be real or
        complex but must be finite.
    y : array_like, shape (n, ...)
        Array containing values of the dependent variable. Infinite and NaN values
        of `y` and corresponding values of `x` will be discarded.
    d : int, default: 3
        Integer satisfying ``0 <= d < n``. Floater-Hormann interpolation blends
        ``n - d`` polynomials of degree `d` together; for ``d = n - 1``, this is
        equivalent to polynomial interpolation.

    Attributes
    ----------
    weights : array
        Weights of the barycentric approximation.

    See Also
    --------
    AAA : Barycentric rational approximation of real and complex functions.
    pade : Padé approximation.

    Notes
    -----
    The Floater-Hormann interpolant is a rational function that interpolates the data
    with approximation order :math:`O(h^{d+1})`. The rational function blends ``n - d``
    polynomials of degree `d` together to produce a rational interpolant that contains
    no poles on the real axis, unlike `AAA`. The interpolant is given
    by

    .. math::

        r(x) = \frac{\sum_{i=0}^{n-d} \lambda_i(x) p_i(x)}
        {\sum_{i=0}^{n-d} \lambda_i(x)},

    where :math:`p_i(x)` is an interpolating polynomial of at most degree `d` through
    the points :math:`(x_i,y_i),\dots,(x_{i+d},y_{i+d})`, and :math:`\lambda_i(z)` are
    blending functions defined by

    .. math::

        \lambda_i(x) = \frac{(-1)^i}{(x - x_i)\cdots(x - x_{i+d})}.

    When ``d = n - 1`` this reduces to polynomial interpolation.

    Due to its stability, the following barycentric representation of the above equation
    is used for computation

    .. math::

        r(z) = \frac{\sum_{k=1}^m\ w_k f_k / (x - x_k)}{\sum_{k=1}^m w_k / (x - x_k)},

    where the weights :math:`w_j` are computed as

    .. math::

        w_k &= (-1)^{k - d} \sum_{i \in J_k} \prod_{j = i, j \neq k}^{i + d}
        1/|x_k - x_j|, \\
        J_k &= \{ i \in I: k - d \leq i \leq k\},\\
        I &= \{0, 1, \dots, n - d\}.

    References
    ----------
    .. [1] M.S. Floater and K. Hormann, "Barycentric rational interpolation with no
           poles and high rates of approximation", Numer. Math. 107, 315 (2007).
           :doi:`10.1007/s00211-007-0093-y`

    Examples
    --------

    Here we compare the method against polynomial interpolation for an example where
    the polynomial interpolation fails due to Runge's phenomenon.

    >>> import numpy as np
    >>> from scipy.interpolate import (FloaterHormannInterpolator,
    ...                                BarycentricInterpolator)
    >>> def f(x):
    ...     return 1/(1 + x**2)
    >>> x = np.linspace(-5, 5, num=15)
    >>> r = FloaterHormannInterpolator(x, f(x))
    >>> p = BarycentricInterpolator(x, f(x))
    >>> xx = np.linspace(-5, 5, num=1000)
    >>> import matplotlib.pyplot as plt
    >>> fig, ax = plt.subplots()
    >>> ax.plot(xx, f(xx), label="f(x)")
    >>> ax.plot(xx, r(xx), "--", label="Floater-Hormann")
    >>> ax.plot(xx, p(xx), "--", label="Polynomial")
    >>> ax.legend()
    >>> plt.show()
    """
    def __init__(self, points, values, *, d=3):
        super().__init__(points, values, d=d)

    def _input_validation(self, x, y, d):
        d = operator.index(d)
        if not (0 <= d < len(x)):
            raise ValueError("`d` must satisfy 0 <= d < n")

        super()._input_validation(x, y)

    def _compute_weights(self, z, f, d):
        # Floater and Hormann 2007 Eqn. (18) 3 equations later
        w = np.zeros_like(z, dtype=np.result_type(z, 1.0))
        n = w.size
        for k in range(n):
            for i in range(max(k-d, 0), min(k+1, n-d)):
                w[k] += 1/np.prod(np.abs(np.delete(z[k] - z[i : i + d + 1], k - i)))
        w *= (-1.)**(np.arange(n) - d)

        return z, f, w
