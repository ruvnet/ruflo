import warnings

import numpy as np
from scipy.linalg import eigh

from .settings import Options
from .utils import MaxEvalError, TargetSuccess, FeasibleSuccess


EPS = np.finfo(float).eps


class Interpolation:
    """
    Interpolation set.

    This class stores a base point around which the models are expanded and the
    interpolation points. The coordinates of the interpolation points are
    relative to the base point.
    """

    def __init__(self, pb, options):
        """
        Initialize the interpolation set.

        Parameters
        ----------
        pb : `cobyqa.problem.Problem`
            Problem to be solved.
        options : dict
            Options of the solver.
        """
        # Reduce the initial trust-region radius if necessary.
        self._debug = options[Options.DEBUG]
        max_radius = 0.5 * np.min(pb.bounds.xu - pb.bounds.xl)
        if options[Options.RHOBEG] > max_radius:
            options[Options.RHOBEG.value] = max_radius
            options[Options.RHOEND.value] = np.min(
                [
                    options[Options.RHOEND],
                    max_radius,
                ]
            )

        # Set the initial point around which the models are expanded.
        self._x_base = np.copy(pb.x0)
        very_close_xl_idx = (
            self.x_base <= pb.bounds.xl + 0.5 * options[Options.RHOBEG]
        )
        self.x_base[very_close_xl_idx] = pb.bounds.xl[very_close_xl_idx]
        close_xl_idx = (
            pb.bounds.xl + 0.5 * options[Options.RHOBEG] < self.x_base
        ) & (self.x_base <= pb.bounds.xl + options[Options.RHOBEG])
        self.x_base[close_xl_idx] = np.minimum(
            pb.bounds.xl[close_xl_idx] + options[Options.RHOBEG],
            pb.bounds.xu[close_xl_idx],
        )
        very_close_xu_idx = (
            self.x_base >= pb.bounds.xu - 0.5 * options[Options.RHOBEG]
        )
        self.x_base[very_close_xu_idx] = pb.bounds.xu[very_close_xu_idx]
        close_xu_idx = (
            self.x_base < pb.bounds.xu - 0.5 * options[Options.RHOBEG]
        ) & (pb.bounds.xu - options[Options.RHOBEG] <= self.x_base)
        self.x_base[close_xu_idx] = np.maximum(
            pb.bounds.xu[close_xu_idx] - options[Options.RHOBEG],
            pb.bounds.xl[close_xu_idx],
        )

        # Set the initial interpolation set.
        self._xpt = np.zeros((pb.n, options[Options.NPT]))
        for k in range(1, options[Options.NPT]):
            if k <= pb.n:
                if very_close_xu_idx[k - 1]:
                    self.xpt[k - 1, k] = -options[Options.RHOBEG]
                else:
                    self.xpt[k - 1, k] = options[Options.RHOBEG]
            elif k <= 2 * pb.n:
                if very_close_xl_idx[k - pb.n - 1]:
                    self.xpt[k - pb.n - 1, k] = 2.0 * options[Options.RHOBEG]
                elif very_close_xu_idx[k - pb.n - 1]:
                    self.xpt[k - pb.n - 1, k] = -2.0 * options[Options.RHOBEG]
                else:
                    self.xpt[k - pb.n - 1, k] = -options[Options.RHOBEG]
            else:
                spread = (k - pb.n - 1) // pb.n
                k1 = k - (1 + spread) * pb.n - 1
                k2 = (k1 + spread) % pb.n
                self.xpt[k1, k] = self.xpt[k1, k1 + 1]
                self.xpt[k2, k] = self.xpt[k2, k2 + 1]

    @property
    def n(self):
        """
        Number of variables.

        Returns
        -------
        int
            Number of variables.
        """
        return self.xpt.shape[0]

    @property
    def npt(self):
        """
        Number of interpolation points.

        Returns
        -------
        int
            Number of interpolation points.
        """
        return self.xpt.shape[1]

    @property
    def xpt(self):
        """
        Interpolation points.

        Returns
        -------
        `numpy.ndarray`, shape (n, npt)
            Interpolation points.
        """
        return self._xpt

    @xpt.setter
    def xpt(self, xpt):
        """
        Set the interpolation points.

        Parameters
        ----------
        xpt : `numpy.ndarray`, shape (n, npt)
            New interpolation points.
        """
        if self._debug:
            assert xpt.shape == (
                self.n,
                self.npt,
            ), "The shape of `xpt` is not valid."
        self._xpt = xpt

    @property
    def x_base(self):
        """
        Base point around which the models are expanded.

        Returns
        -------
        `numpy.ndarray`, shape (n,)
            Base point around which the models are expanded.
        """
        return self._x_base

    @x_base.setter
    def x_base(self, x_base):
        """
        Set the base point around which the models are expanded.

        Parameters
        ----------
        x_base : `numpy.ndarray`, shape (n,)
            New base point around which the models are expanded.
        """
        if self._debug:
            assert x_base.shape == (
                self.n,
            ), "The shape of `x_base` is not valid."
        self._x_base = x_base

    def point(self, k):
        """
        Get the `k`-th interpolation point.

        The return point is relative to the origin.

        Parameters
        ----------
        k : int
            Index of the interpolation point.

        Returns
        -------
        `numpy.ndarray`, shape (n,)
            `k`-th interpolation point.
        """
        if self._debug:
            assert 0 <= k < self.npt, "The index `k` is not valid."
        return self.x_base + self.xpt[:, k]


_cache = {"xpt": None, "a": None, "right_scaling": None, "eigh": None}


def build_system(interpolation):
    """
    Build the left-hand side matrix of the interpolation system. The
    matrix below stores W * diag(right_scaling),
    where W is the theoretical matrix of the interpolation system. The
    right scaling matrices is chosen to keep the elements in
    the matrix well-balanced.

    Parameters
    ----------
    interpolation : `cobyqa.models.Interpolation`
        Interpolation set.
    """

    # Compute the scaled directions from the base point to the
    # interpolation points. We scale the directions to avoid numerical
    # difficulties.
    if _cache["xpt"] is not None and np.array_equal(
        interpolation.xpt, _cache["xpt"]
    ):
        return _cache["a"], _cache["right_scaling"], _cache["eigh"]

    scale = np.max(np.linalg.norm(interpolation.xpt, axis=0), initial=EPS)
    xpt_scale = interpolation.xpt / scale

    n, npt = xpt_scale.shape
    a = np.zeros((npt + n + 1, npt + n + 1))
    a[:npt, :npt] = 0.5 * (xpt_scale.T @ xpt_scale) ** 2.0
    a[:npt, npt] = 1.0
    a[:npt, npt + 1:] = xpt_scale.T
    a[npt, :npt] = 1.0
    a[npt + 1:, :npt] = xpt_scale

    # Build the left and right scaling diagonal matrices.
    right_scaling = np.empty(npt + n + 1)
    right_scaling[:npt] = 1.0 / scale**2.0
    right_scaling[npt] = scale**2.0
    right_scaling[npt + 1:] = scale

    eig_values, eig_vectors = eigh(a, check_finite=False)

    _cache["xpt"] = np.copy(interpolation.xpt)
    _cache["a"] = np.copy(a)
    _cache["right_scaling"] = np.copy(right_scaling)
    _cache["eigh"] = (eig_values, eig_vectors)

    return a, right_scaling, (eig_values, eig_vectors)


class Quadratic:
    """
    Quadratic model.

    This class stores the Hessian matrix of the quadratic model using the
    implicit/explicit representation designed by Powell for NEWUOA [1]_.

    References
    ----------
    .. [1] M. J. D. Powell. The NEWUOA software for unconstrained optimization
       without derivatives. In G. Di Pillo and M. Roma, editors, *Large-Scale
       Nonlinear Optimization*, volume 83 of Nonconvex Optim. Appl., pages
       255--297. Springer, Boston, MA, USA, 2006. `doi:10.1007/0-387-30065-1_16
       <https://doi.org/10.1007/0-387-30065-1_16>`_.
    """

    def __init__(self, interpolation, values, debug):
        """
        Initialize the quadratic model.

        Parameters
        ----------
        interpolation : `cobyqa.models.Interpolation`
            Interpolation set.
        values : `numpy.ndarray`, shape (npt,)
            Values of the interpolated function at the interpolation points.
        debug : bool
            Whether to make debugging tests during the execution.

        Raises
        ------
        `numpy.linalg.LinAlgError`
            If the interpolation system is ill-defined.
        """
        self._debug = debug
        if self._debug:
            assert values.shape == (
                interpolation.npt,
            ), "The shape of `values` is not valid."
        if interpolation.npt < interpolation.n + 1:
            raise ValueError(
                f"The number of interpolation points must be at least "
                f"{interpolation.n + 1}."
            )
        self._const, self._grad, self._i_hess, _ = self._get_model(
            interpolation,
            values,
        )
        self._e_hess = np.zeros((self.n, self.n))

    def __call__(self, x, interpolation):
        """
        Evaluate the quadratic model at a given point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which the quadratic model is evaluated.
        interpolation : `cobyqa.models.Interpolation`
            Interpolation set.

        Returns
        -------
        float
            Value of the quadratic model at `x`.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
        x_diff = x - interpolation.x_base
        return (
            self._const
            + self._grad @ x_diff
            + 0.5
            * (
                self._i_hess @ (interpolation.xpt.T @ x_diff) ** 2.0
                + x_diff @ self._e_hess @ x_diff
            )
        )

    @property
    def n(self):
        """
        Number of variables.

        Returns
        -------
        int
            Number of variables.
        """
        return self._grad.size

    @property
    def npt(self):
        """
        Number of interpolation points used to define the quadratic model.

        Returns
        -------
        int
            Number of interpolation points used to define the quadratic model.
        """
        return self._i_hess.size

    def grad(self, x, interpolation):
        """
        Evaluate the gradient of the quadratic model at a given point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which the gradient of the quadratic model is evaluated.
        interpolation : `cobyqa.models.Interpolation`
            Interpolation set.

        Returns
        -------
        `numpy.ndarray`, shape (n,)
            Gradient of the quadratic model at `x`.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
        x_diff = x - interpolation.x_base
        return self._grad + self.hess_prod(x_diff, interpolation)

    def hess(self, interpolation):
        """
        Evaluate the Hessian matrix of the quadratic model.

        Parameters
        ----------
        interpolation : `cobyqa.models.Interpolation`
            Interpolation set.

        Returns
        -------
        `numpy.ndarray`, shape (n, n)
            Hessian matrix of the quadratic model.
        """
        return self._e_hess + interpolation.xpt @ (
            self._i_hess[:, np.newaxis] * interpolation.xpt.T
        )

    def hess_prod(self, v, interpolation):
        """
        Evaluate the right product of the Hessian matrix of the quadratic model
        with a given vector.

        Parameters
        ----------
        v : `numpy.ndarray`, shape (n,)
            Vector with which the Hessian matrix of the quadratic model is
            multiplied from the right.
        interpolation : `cobyqa.models.Interpolation`
            Interpolation set.

        Returns
        -------
        `numpy.ndarray`, shape (n,)
            Right product of the Hessian matrix of the quadratic model with
            `v`.
        """
        if self._debug:
            assert v.shape == (self.n,), "The shape of `v` is not valid."
        return self._e_hess @ v + interpolation.xpt @ (
            self._i_hess * (interpolation.xpt.T @ v)
        )

    def curv(self, v, interpolation):
        """
        Evaluate the curvature of the quadratic model along a given direction.

        Parameters
        ----------
        v : `numpy.ndarray`, shape (n,)
            Direction along which the curvature of the quadratic model is
            evaluated.
        interpolation : `cobyqa.models.Interpolation`
            Interpolation set.

        Returns
        -------
        float
            Curvature of the quadratic model along `v`.
        """
        if self._debug:
            assert v.shape == (self.n,), "The shape of `v` is not valid."
        return (
            v @ self._e_hess @ v
            + self._i_hess @ (interpolation.xpt.T @ v) ** 2.0
        )

    def update(self, interpolation, k_new, dir_old, values_diff):
        """
        Update the quadratic model.

        This method applies the derivative-free symmetric Broyden update to the
        quadratic model. The `knew`-th interpolation point must be updated
        before calling this method.

        Parameters
        ----------
        interpolation : `cobyqa.models.Interpolation`
            Updated interpolation set.
        k_new : int
            Index of the updated interpolation point.
        dir_old : `numpy.ndarray`, shape (n,)
            Value of ``interpolation.xpt[:, k_new]`` before the update.
        values_diff : `numpy.ndarray`, shape (npt,)
            Differences between the values of the interpolated nonlinear
            function and the previous quadratic model at the updated
            interpolation points.

        Raises
        ------
        `numpy.linalg.LinAlgError`
            If the interpolation system is ill-defined.
        """
        if self._debug:
            assert 0 <= k_new < self.npt, "The index `k_new` is not valid."
            assert dir_old.shape == (
                self.n,
            ), "The shape of `dir_old` is not valid."
            assert values_diff.shape == (
                self.npt,
            ), "The shape of `values_diff` is not valid."

        # Forward the k_new-th element of the implicit Hessian matrix to the
        # explicit Hessian matrix. This must be done because the implicit
        # Hessian matrix is related to the interpolation points, and the
        # k_new-th interpolation point is modified.
        self._e_hess += self._i_hess[k_new] * np.outer(dir_old, dir_old)
        self._i_hess[k_new] = 0.0

        # Update the quadratic model.
        const, grad, i_hess, ill_conditioned = self._get_model(
            interpolation,
            values_diff,
        )
        self._const += const
        self._grad += grad
        self._i_hess += i_hess
        return ill_conditioned

    def shift_x_base(self, interpolation, new_x_base):
        """
        Shift the point around which the quadratic model is defined.

        Parameters
        ----------
        interpolation : `cobyqa.models.Interpolation`
            Previous interpolation set.
        new_x_base : `numpy.ndarray`, shape (n,)
            Point that will replace ``interpolation.x_base``.
        """
        if self._debug:
            assert new_x_base.shape == (
                self.n,
            ), "The shape of `new_x_base` is not valid."
        self._const = self(new_x_base, interpolation)
        self._grad = self.grad(new_x_base, interpolation)
        shift = new_x_base - interpolation.x_base
        update = np.outer(
            shift,
            (interpolation.xpt - 0.5 * shift[:, np.newaxis]) @ self._i_hess,
        )
        self._e_hess += update + update.T

    @staticmethod
    def solve_systems(interpolation, rhs):
        """
        Solve the interpolation systems.

        Parameters
        ----------
        interpolation : `cobyqa.models.Interpolation`
            Interpolation set.
        rhs : `numpy.ndarray`, shape (npt + n + 1, m)
            Right-hand side vectors of the ``m`` interpolation systems.

        Returns
        -------
        `numpy.ndarray`, shape (npt + n + 1, m)
            Solutions of the interpolation systems.
        `numpy.ndarray`, shape (m, )
            Whether the interpolation systems are ill-conditioned.

        Raises
        ------
        `numpy.linalg.LinAlgError`
            If the interpolation systems are ill-defined.
        """
        n, npt = interpolation.xpt.shape
        assert (
            rhs.ndim == 2 and rhs.shape[0] == npt + n + 1
        ), "The shape of `rhs` is not valid."

        # Build the left-hand side matrix of the interpolation system. The
        # matrix below stores diag(left_scaling) * W * diag(right_scaling),
        # where W is the theoretical matrix of the interpolation system. The
        # left and right scaling matrices are chosen to keep the elements in
        # the matrix well-balanced.
        a, right_scaling, eig = build_system(interpolation)

        # Build the solution. After a discussion with Mike Saunders and Alexis
        # Montoison during their visit to the Hong Kong Polytechnic University
        # in 2024, we decided to use the eigendecomposition of the symmetric
        # matrix a. This is more stable than the previously employed LBL
        # decomposition, and allows us to directly detect ill-conditioning of
        # the system and to build the least-squares solution if necessary.
        # Numerical experiments have shown that this strategy improves the
        # performance of the solver.
        rhs_scaled = rhs * right_scaling[:, np.newaxis]
        if not (np.all(np.isfinite(a)) and np.all(np.isfinite(rhs_scaled))):
            raise np.linalg.LinAlgError(
                "The interpolation system is ill-defined."
            )

        # calculated in build_system
        eig_values, eig_vectors = eig

        large_eig_values = np.abs(eig_values) > EPS
        eig_vectors = eig_vectors[:, large_eig_values]
        inv_eig_values = 1.0 / eig_values[large_eig_values]
        ill_conditioned = ~np.all(large_eig_values, 0)
        left_scaled_solutions = eig_vectors @ (
            (eig_vectors.T @ rhs_scaled) * inv_eig_values[:, np.newaxis]
        )
        return (
            left_scaled_solutions * right_scaling[:, np.newaxis],
            ill_conditioned,
        )

    @staticmethod
    def _get_model(interpolation, values):
        """
        Solve the interpolation system.

        Parameters
        ----------
        interpolation : `cobyqa.models.Interpolation`
            Interpolation set.
        values : `numpy.ndarray`, shape (npt,)
            Values of the interpolated function at the interpolation points.

        Returns
        -------
        float
            Constant term of the quadratic model.
        `numpy.ndarray`, shape (n,)
            Gradient of the quadratic model at ``interpolation.x_base``.
        `numpy.ndarray`, shape (npt,)
            Implicit Hessian matrix of the quadratic model.

        Raises
        ------
        `numpy.linalg.LinAlgError`
            If the interpolation system is ill-defined.
        """
        assert values.shape == (
            interpolation.npt,
        ), "The shape of `values` is not valid."
        n, npt = interpolation.xpt.shape
        x, ill_conditioned = Quadratic.solve_systems(
            interpolation,
            np.block(
                [
                    [
                        values,
                        np.zeros(n + 1),
                    ]
                ]
            ).T,
        )
        return x[npt, 0], x[npt + 1:, 0], x[:npt, 0], ill_conditioned


class Models:
    """
    Models for a nonlinear optimization problem.
    """

    def __init__(self, pb, options, penalty):
        """
        Initialize the models.

        Parameters
        ----------
        pb : `cobyqa.problem.Problem`
            Problem to be solved.
        options : dict
            Options of the solver.
        penalty : float
            Penalty parameter used to select the point in the filter to forward
            to the callback function.

        Raises
        ------
        `cobyqa.utils.MaxEvalError`
            If the maximum number of evaluations is reached.
        `cobyqa.utils.TargetSuccess`
            If a nearly feasible point has been found with an objective
            function value below the target.
        `cobyqa.utils.FeasibleSuccess`
            If a feasible point has been found for a feasibility problem.
        `numpy.linalg.LinAlgError`
            If the interpolation system is ill-defined.
        """
        # Set the initial interpolation set.
        self._debug = options[Options.DEBUG]
        self._interpolation = Interpolation(pb, options)

        # Evaluate the nonlinear functions at the initial interpolation points.
        x_eval = self.interpolation.point(0)
        fun_init, cub_init, ceq_init = pb(x_eval, penalty)
        self._fun_val = np.full(options[Options.NPT], np.nan)
        self._cub_val = np.full((options[Options.NPT], cub_init.size), np.nan)
        self._ceq_val = np.full((options[Options.NPT], ceq_init.size), np.nan)
        for k in range(options[Options.NPT]):
            if k >= options[Options.MAX_EVAL]:
                raise MaxEvalError
            if k == 0:
                self.fun_val[k] = fun_init
                self.cub_val[k, :] = cub_init
                self.ceq_val[k, :] = ceq_init
            else:
                x_eval = self.interpolation.point(k)
                self.fun_val[k], self.cub_val[k, :], self.ceq_val[k, :] = pb(
                    x_eval,
                    penalty,
                )

            # Stop the iterations if the problem is a feasibility problem and
            # the current interpolation point is feasible.
            if (
                pb.is_feasibility
                and pb.maxcv(
                    self.interpolation.point(k),
                    self.cub_val[k, :],
                    self.ceq_val[k, :],
                )
                <= options[Options.FEASIBILITY_TOL]
            ):
                raise FeasibleSuccess

            # Stop the iterations if the current interpolation point is nearly
            # feasible and has an objective function value below the target.
            if (
                self._fun_val[k] <= options[Options.TARGET]
                and pb.maxcv(
                    self.interpolation.point(k),
                    self.cub_val[k, :],
                    self.ceq_val[k, :],
                )
                <= options[Options.FEASIBILITY_TOL]
            ):
                raise TargetSuccess

        # Build the initial quadratic models.
        self._fun = Quadratic(
            self.interpolation,
            self._fun_val,
            options[Options.DEBUG],
        )
        self._cub = np.empty(self.m_nonlinear_ub, dtype=Quadratic)
        self._ceq = np.empty(self.m_nonlinear_eq, dtype=Quadratic)
        for i in range(self.m_nonlinear_ub):
            self._cub[i] = Quadratic(
                self.interpolation,
                self.cub_val[:, i],
                options[Options.DEBUG],
            )
        for i in range(self.m_nonlinear_eq):
            self._ceq[i] = Quadratic(
                self.interpolation,
                self.ceq_val[:, i],
                options[Options.DEBUG],
            )
        if self._debug:
            self._check_interpolation_conditions()

    @property
    def n(self):
        """
        Dimension of the problem.

        Returns
        -------
        int
            Dimension of the problem.
        """
        return self.interpolation.n

    @property
    def npt(self):
        """
        Number of interpolation points.

        Returns
        -------
        int
            Number of interpolation points.
        """
        return self.interpolation.npt

    @property
    def m_nonlinear_ub(self):
        """
        Number of nonlinear inequality constraints.

        Returns
        -------
        int
            Number of nonlinear inequality constraints.
        """
        return self.cub_val.shape[1]

    @property
    def m_nonlinear_eq(self):
        """
        Number of nonlinear equality constraints.

        Returns
        -------
        int
            Number of nonlinear equality constraints.
        """
        return self.ceq_val.shape[1]

    @property
    def interpolation(self):
        """
        Interpolation set.

        Returns
        -------
        `cobyqa.models.Interpolation`
            Interpolation set.
        """
        return self._interpolation

    @property
    def fun_val(self):
        """
        Values of the objective function at the interpolation points.

        Returns
        -------
        `numpy.ndarray`, shape (npt,)
            Values of the objective function at the interpolation points.
        """
        return self._fun_val

    @property
    def cub_val(self):
        """
        Values of the nonlinear inequality constraint functions at the
        interpolation points.

        Returns
        -------
        `numpy.ndarray`, shape (npt, m_nonlinear_ub)
            Values of the nonlinear inequality constraint functions at the
            interpolation points.
        """
        return self._cub_val

    @property
    def ceq_val(self):
        """
        Values of the nonlinear equality constraint functions at the
        interpolation points.

        Returns
        -------
        `numpy.ndarray`, shape (npt, m_nonlinear_eq)
            Values of the nonlinear equality constraint functions at the
            interpolation points.
        """
        return self._ceq_val

    def fun(self, x):
        """
        Evaluate the quadratic model of the objective function at a given
        point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which to evaluate the quadratic model of the objective
            function.

        Returns
        -------
        float
            Value of the quadratic model of the objective function at `x`.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
        return self._fun(x, self.interpolation)

    def fun_grad(self, x):
        """
        Evaluate the gradient of the quadratic model of the objective function
        at a given point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which to evaluate the gradient of the quadratic model of
            the objective function.

        Returns
        -------
        `numpy.ndarray`, shape (n,)
            Gradient of the quadratic model of the objective function at `x`.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
        return self._fun.grad(x, self.interpolation)

    def fun_hess(self):
        """
        Evaluate the Hessian matrix of the quadratic model of the objective
        function.

        Returns
        -------
        `numpy.ndarray`, shape (n, n)
            Hessian matrix of the quadratic model of the objective function.
        """
        return self._fun.hess(self.interpolation)

    def fun_hess_prod(self, v):
        """
        Evaluate the right product of the Hessian matrix of the quadratic model
        of the objective function with a given vector.

        Parameters
        ----------
        v : `numpy.ndarray`, shape (n,)
            Vector with which the Hessian matrix of the quadratic model of the
            objective function is multiplied from the right.

        Returns
        -------
        `numpy.ndarray`, shape (n,)
            Right product of the Hessian matrix of the quadratic model of the
            objective function with `v`.
        """
        if self._debug:
            assert v.shape == (self.n,), "The shape of `v` is not valid."
        return self._fun.hess_prod(v, self.interpolation)

    def fun_curv(self, v):
        """
        Evaluate the curvature of the quadratic model of the objective function
        along a given direction.

        Parameters
        ----------
        v : `numpy.ndarray`, shape (n,)
            Direction along which the curvature of the quadratic model of the
            objective function is evaluated.

        Returns
        -------
        float
            Curvature of the quadratic model of the objective function along
            `v`.
        """
        if self._debug:
            assert v.shape == (self.n,), "The shape of `v` is not valid."
        return self._fun.curv(v, self.interpolation)

    def fun_alt_grad(self, x):
        """
        Evaluate the gradient of the alternative quadratic model of the
        objective function at a given point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which to evaluate the gradient of the alternative
            quadratic model of the objective function.

        Returns
        -------
        `numpy.ndarray`, shape (n,)
            Gradient of the alternative quadratic model of the objective
            function at `x`.

        Raises
        ------
        `numpy.linalg.LinAlgError`
            If the interpolation system is ill-defined.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
        model = Quadratic(self.interpolation, self.fun_val, self._debug)
        return model.grad(x, self.interpolation)

    def cub(self, x, mask=None):
        """
        Evaluate the quadratic models of the nonlinear inequality functions at
        a given point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which to evaluate the quadratic models of the nonlinear
            inequality functions.
        mask : `numpy.ndarray`, shape (m_nonlinear_ub,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Values of the quadratic model of the nonlinear inequality
            functions.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
            assert mask is None or mask.shape == (
                self.m_nonlinear_ub,
            ), "The shape of `mask` is not valid."
        return np.array(
            [model(x, self.interpolation) for model in self._get_cub(mask)]
        )

    def cub_grad(self, x, mask=None):
        """
        Evaluate the gradients of the quadratic models of the nonlinear
        inequality functions at a given point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which to evaluate the gradients of the quadratic models of
            the nonlinear inequality functions.
        mask : `numpy.ndarray`, shape (m_nonlinear_eq,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Gradients of the quadratic model of the nonlinear inequality
            functions.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
            assert mask is None or mask.shape == (
                self.m_nonlinear_ub,
            ), "The shape of `mask` is not valid."
        return np.reshape(
            [model.grad(x, self.interpolation)
             for model in self._get_cub(mask)],
            (-1, self.n),
        )

    def cub_hess(self, mask=None):
        """
        Evaluate the Hessian matrices of the quadratic models of the nonlinear
        inequality functions.

        Parameters
        ----------
        mask : `numpy.ndarray`, shape (m_nonlinear_ub,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Hessian matrices of the quadratic models of the nonlinear
            inequality functions.
        """
        if self._debug:
            assert mask is None or mask.shape == (
                self.m_nonlinear_ub,
            ), "The shape of `mask` is not valid."
        return np.reshape(
            [model.hess(self.interpolation) for model in self._get_cub(mask)],
            (-1, self.n, self.n),
        )

    def cub_hess_prod(self, v, mask=None):
        """
        Evaluate the right product of the Hessian matrices of the quadratic
        models of the nonlinear inequality functions with a given vector.

        Parameters
        ----------
        v : `numpy.ndarray`, shape (n,)
            Vector with which the Hessian matrices of the quadratic models of
            the nonlinear inequality functions are multiplied from the right.
        mask : `numpy.ndarray`, shape (m_nonlinear_ub,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Right products of the Hessian matrices of the quadratic models of
            the nonlinear inequality functions with `v`.
        """
        if self._debug:
            assert v.shape == (self.n,), "The shape of `v` is not valid."
            assert mask is None or mask.shape == (
                self.m_nonlinear_ub,
            ), "The shape of `mask` is not valid."
        return np.reshape(
            [
                model.hess_prod(v, self.interpolation)
                for model in self._get_cub(mask)
            ],
            (-1, self.n),
        )

    def cub_curv(self, v, mask=None):
        """
        Evaluate the curvature of the quadratic models of the nonlinear
        inequality functions along a given direction.

        Parameters
        ----------
        v : `numpy.ndarray`, shape (n,)
            Direction along which the curvature of the quadratic models of the
            nonlinear inequality functions is evaluated.
        mask : `numpy.ndarray`, shape (m_nonlinear_ub,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Curvature of the quadratic models of the nonlinear inequality
            functions along `v`.
        """
        if self._debug:
            assert v.shape == (self.n,), "The shape of `v` is not valid."
            assert mask is None or mask.shape == (
                self.m_nonlinear_ub,
            ), "The shape of `mask` is not valid."
        return np.array(
            [model.curv(v, self.interpolation)
             for model in self._get_cub(mask)]
        )

    def ceq(self, x, mask=None):
        """
        Evaluate the quadratic models of the nonlinear equality functions at a
        given point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which to evaluate the quadratic models of the nonlinear
            equality functions.
        mask : `numpy.ndarray`, shape (m_nonlinear_eq,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Values of the quadratic model of the nonlinear equality functions.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
            assert mask is None or mask.shape == (
                self.m_nonlinear_eq,
            ), "The shape of `mask` is not valid."
        return np.array(
            [model(x, self.interpolation) for model in self._get_ceq(mask)]
        )

    def ceq_grad(self, x, mask=None):
        """
        Evaluate the gradients of the quadratic models of the nonlinear
        equality functions at a given point.

        Parameters
        ----------
        x : `numpy.ndarray`, shape (n,)
            Point at which to evaluate the gradients of the quadratic models of
            the nonlinear equality functions.
        mask : `numpy.ndarray`, shape (m_nonlinear_eq,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Gradients of the quadratic model of the nonlinear equality
            functions.
        """
        if self._debug:
            assert x.shape == (self.n,), "The shape of `x` is not valid."
            assert mask is None or mask.shape == (
                self.m_nonlinear_eq,
            ), "The shape of `mask` is not valid."
        return np.reshape(
            [model.grad(x, self.interpolation)
             for model in self._get_ceq(mask)],
            (-1, self.n),
        )

    def ceq_hess(self, mask=None):
        """
        Evaluate the Hessian matrices of the quadratic models of the nonlinear
        equality functions.

        Parameters
        ----------
        mask : `numpy.ndarray`, shape (m_nonlinear_eq,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Hessian matrices of the quadratic models of the nonlinear equality
            functions.
        """
        if self._debug:
            assert mask is None or mask.shape == (
                self.m_nonlinear_eq,
            ), "The shape of `mask` is not valid."
        return np.reshape(
            [model.hess(self.interpolation) for model in self._get_ceq(mask)],
            (-1, self.n, self.n),
        )

    def ceq_hess_prod(self, v, mask=None):
        """
        Evaluate the right product of the Hessian matrices of the quadratic
        models of the nonlinear equality functions with a given vector.

        Parameters
        ----------
        v : `numpy.ndarray`, shape (n,)
            Vector with which the Hessian matrices of the quadratic models of
            the nonlinear equality functions are multiplied from the right.
        mask : `numpy.ndarray`, shape (m_nonlinear_eq,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Right products of the Hessian matrices of the quadratic models of
            the nonlinear equality functions with `v`.
        """
        if self._debug:
            assert v.shape == (self.n,), "The shape of `v` is not valid."
            assert mask is None or mask.shape == (
                self.m_nonlinear_eq,
            ), "The shape of `mask` is not valid."
        return np.reshape(
            [
                model.hess_prod(v, self.interpolation)
                for model in self._get_ceq(mask)
            ],
            (-1, self.n),
        )

    def ceq_curv(self, v, mask=None):
        """
        Evaluate the curvature of the quadratic models of the nonlinear
        equality functions along a given direction.

        Parameters
        ----------
        v : `numpy.ndarray`, shape (n,)
            Direction along which the curvature of the quadratic models of the
            nonlinear equality functions is evaluated.
        mask : `numpy.ndarray`, shape (m_nonlinear_eq,), optional
            Mask of the quadratic models to consider.

        Returns
        -------
        `numpy.ndarray`
            Curvature of the quadratic models of the nonlinear equality
            functions along `v`.
        """
        if self._debug:
            assert v.shape == (self.n,), "The shape of `v` is not valid."
            assert mask is None or mask.shape == (
                self.m_nonlinear_eq,
            ), "The shape of `mask` is not valid."
        return np.array(
            [model.curv(v, self.interpolation)
             for model in self._get_ceq(mask)]
        )

    def reset_models(self):
        """
        Set the quadratic models of the objective function, nonlinear
        inequality constraints, and nonlinear equality constraints to the
        alternative quadratic models.

        Raises
        ------
        `numpy.linalg.LinAlgError`
            If the interpolation system is ill-defined.
        """
        self._fun = Quadratic(self.interpolation, self.fun_val, self._debug)
        for i in range(self.m_nonlinear_ub):
            self._cub[i] = Quadratic(
                self.interpolation,
                self.cub_val[:, i],
                self._debug,
            )
        for i in range(self.m_nonlinear_eq):
            self._ceq[i] = Quadratic(
                self.interpolation,
                self.ceq_val[:, i],
                self._debug,
            )
        if self._debug:
            self._check_interpolation_conditions()

    def update_interpolation(self, k_new, x_new, fun_val, cub_val, ceq_val):
        """
        Update the interpolation set.

        This method updates the interpolation set by replacing the `knew`-th
        interpolation point with `xnew`. It also updates the function values
        and the quadratic models.

        Parameters
        ----------
        k_new : int
            Index of the updated interpolation point.
        x_new : `numpy.ndarray`, shape (n,)
            New interpolation point. Its value is interpreted as relative to
            the origin, not the base point.
        fun_val : float
            Value of the objective function at `x_new`.
            Objective function value at `x_new`.
        cub_val : `numpy.ndarray`, shape (m_nonlinear_ub,)
            Values of the nonlinear inequality constraints at `x_new`.
        ceq_val : `numpy.ndarray`, shape (m_nonlinear_eq,)
            Values of the nonlinear equality constraints at `x_new`.

        Raises
        ------
        `numpy.linalg.LinAlgError`
            If the interpolation system is ill-defined.
        """
        if self._debug:
            assert 0 <= k_new < self.npt, "The index `k_new` is not valid."
            assert x_new.shape == (self.n,), \
                "The shape of `x_new` is not valid."
            assert isinstance(fun_val, float), \
                "The function value is not valid."
            assert cub_val.shape == (
                self.m_nonlinear_ub,
            ), "The shape of `cub_val` is not valid."
            assert ceq_val.shape == (
                self.m_nonlinear_eq,
            ), "The shape of `ceq_val` is not valid."

        # Compute the updates in the interpolation conditions.
        fun_diff = np.zeros(self.npt)
        cub_diff = np.zeros(self.cub_val.shape)
        ceq_diff = np.zeros(self.ceq_val.shape)
        fun_diff[k_new] = fun_val - self.fun(x_new)
        cub_diff[k_new, :] = cub_val - self.cub(x_new)
        ceq_diff[k_new, :] = ceq_val - self.ceq(x_new)

        # Update the function values.
        self.fun_val[k_new] = fun_val
        self.cub_val[k_new, :] = cub_val
        self.ceq_val[k_new, :] = ceq_val

        # Update the interpolation set.
        dir_old = np.copy(self.interpolation.xpt[:, k_new])
        self.interpolation.xpt[:, k_new] = x_new - self.interpolation.x_base

        # Update the quadratic models.
        ill_conditioned = self._fun.update(
            self.interpolation,
            k_new,
            dir_old,
            fun_diff,
        )
        for i in range(self.m_nonlinear_ub):
            ill_conditioned = ill_conditioned or self._cub[i].update(
                self.interpolation,
                k_new,
                dir_old,
                cub_diff[:, i],
            )
        for i in range(self.m_nonlinear_eq):
            ill_conditioned = ill_conditioned or self._ceq[i].update(
                self.interpolation,
                k_new,
                dir_old,
                ceq_diff[:, i],
            )
        if self._debug:
            self._check_interpolation_conditions()
        return ill_conditioned

    def determinants(self, x_new, k_new=None):
        """
        Compute the normalized determinants of the new interpolation systems.

        Parameters
        ----------
        x_new : `numpy.ndarray`, shape (n,)
            New interpolation point. Its value is interpreted as relative to
            the origin, not the base point.
        k_new : int, optional
            Index of the updated interpolation point. If `k_new` is not
            specified, all the possible determinants are computed.

        Returns
        -------
        {float, `numpy.ndarray`, shape (npt,)}
            Determinant(s) of the new interpolation system.

        Raises
        ------
        `numpy.linalg.LinAlgError`
            If the interpolation system is ill-defined.

        Notes
        -----
        The determinants are normalized by the determinant of the current
        interpolation system. For stability reasons, the calculations are done
        using the formula (2.12) in [1]_.

        References
        ----------
        .. [1] M. J. D. Powell. On updating the inverse of a KKT matrix.
           Technical Report DAMTP 2004/NA01, Department of Applied Mathematics
           and Theoretical Physics, University of Cambridge, Cambridge, UK,
           2004.
        """
        if self._debug:
            assert x_new.shape == (self.n,), \
                "The shape of `x_new` is not valid."
            assert (
                k_new is None or 0 <= k_new < self.npt
            ), "The index `k_new` is not valid."

        # Compute the values independent of k_new.
        shift = x_new - self.interpolation.x_base
        new_col = np.empty((self.npt + self.n + 1, 1))
        new_col[: self.npt, 0] = (
                0.5 * (self.interpolation.xpt.T @ shift) ** 2.0)
        new_col[self.npt, 0] = 1.0
        new_col[self.npt + 1:, 0] = shift
        inv_new_col = Quadratic.solve_systems(self.interpolation, new_col)[0]
        beta = 0.5 * (shift @ shift) ** 2.0 - new_col[:, 0] @ inv_new_col[:, 0]

        # Compute the values that depend on k.
        if k_new is None:
            coord_vec = np.eye(self.npt + self.n + 1, self.npt)
            alpha = np.diag(
                Quadratic.solve_systems(
                    self.interpolation,
                    coord_vec,
                )[0]
            )
            tau = inv_new_col[: self.npt, 0]
        else:
            coord_vec = np.eye(self.npt + self.n + 1, 1, -k_new)
            alpha = Quadratic.solve_systems(
                self.interpolation,
                coord_vec,
            )[
                0
            ][k_new, 0]
            tau = inv_new_col[k_new, 0]
        return alpha * beta + tau**2.0

    def shift_x_base(self, new_x_base, options):
        """
        Shift the base point without changing the interpolation set.

        Parameters
        ----------
        new_x_base : `numpy.ndarray`, shape (n,)
            New base point.
        options : dict
            Options of the solver.
        """
        if self._debug:
            assert new_x_base.shape == (
                self.n,
            ), "The shape of `new_x_base` is not valid."

        # Update the models.
        self._fun.shift_x_base(self.interpolation, new_x_base)
        for model in self._cub:
            model.shift_x_base(self.interpolation, new_x_base)
        for model in self._ceq:
            model.shift_x_base(self.interpolation, new_x_base)

        # Update the base point and the interpolation points.
        shift = new_x_base - self.interpolation.x_base
        self.interpolation.x_base += shift
        self.interpolation.xpt -= shift[:, np.newaxis]
        if options[Options.DEBUG]:
            self._check_interpolation_conditions()

    def _get_cub(self, mask=None):
        """
        Get the quadratic models of the nonlinear inequality constraints.

        Parameters
        ----------
        mask : `numpy.ndarray`, shape (m_nonlinear_ub,), optional
            Mask of the quadratic models to return.

        Returns
        -------
        `numpy.ndarray`
            Quadratic models of the nonlinear inequality constraints.
        """
        return self._cub if mask is None else self._cub[mask]

    def _get_ceq(self, mask=None):
        """
        Get the quadratic models of the nonlinear equality constraints.

        Parameters
        ----------
        mask : `numpy.ndarray`, shape (m_nonlinear_eq,), optional
            Mask of the quadratic models to return.

        Returns
        -------
        `numpy.ndarray`
            Quadratic models of the nonlinear equality constraints.
        """
        return self._ceq if mask is None else self._ceq[mask]

    def _check_interpolation_conditions(self):
        """
        Check the interpolation conditions of all quadratic models.
        """
        error_fun = 0.0
        error_cub = 0.0
        error_ceq = 0.0
        for k in range(self.npt):
            error_fun = np.max(
                [
                    error_fun,
                    np.abs(
                        self.fun(self.interpolation.point(k)) - self.fun_val[k]
                    ),
                ]
            )
            error_cub = np.max(
                np.abs(
                    self.cub(self.interpolation.point(k)) - self.cub_val[k, :]
                ),
                initial=error_cub,
            )
            error_ceq = np.max(
                np.abs(
                    self.ceq(self.interpolation.point(k)) - self.ceq_val[k, :]
                ),
                initial=error_ceq,
            )
        tol = 10.0 * np.sqrt(EPS) * max(self.n, self.npt)
        if error_fun > tol * np.max(np.abs(self.fun_val), initial=1.0):
            warnings.warn(
                "The interpolation conditions for the objective function are "
                "not satisfied.",
                RuntimeWarning,
                2,
            )
        if error_cub > tol * np.max(np.abs(self.cub_val), initial=1.0):
            warnings.warn(
                "The interpolation conditions for the inequality constraint "
                "function are not satisfied.",
                RuntimeWarning,
                2,
            )
        if error_ceq > tol * np.max(np.abs(self.ceq_val), initial=1.0):
            warnings.warn(
                "The interpolation conditions for the equality constraint "
                "function are not satisfied.",
                RuntimeWarning,
                2,
            )
