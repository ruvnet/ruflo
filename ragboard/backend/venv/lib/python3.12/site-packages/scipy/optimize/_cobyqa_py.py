import numpy as np
from threading import Lock

from ._optimize import _check_unknown_options


COBYQA_LOCK = Lock()


def _minimize_cobyqa(fun, x0, args=(), bounds=None, constraints=(),
                     callback=None, disp=False, maxfev=None, maxiter=None,
                     f_target=-np.inf, feasibility_tol=1e-8,
                     initial_tr_radius=1.0, final_tr_radius=1e-6, scale=False,
                     **unknown_options):
    """
    Minimize a scalar function of one or more variables using the
    Constrained Optimization BY Quadratic Approximations (COBYQA) algorithm [1]_.

    .. versionadded:: 1.14.0

    Options
    -------
    disp : bool
        Set to True to print information about the optimization procedure.
        Default is ``False``.
    maxfev : int
        Maximum number of function evaluations. Default is ``500 * n``, where
        ``n`` is the number of variables.
    maxiter : int
        Maximum number of iterations. Default is ``1000 * n``, where ``n`` is
        the number of variables.
    f_target : float
        Target value for the objective function. The optimization procedure is
        terminated when the objective function value of a feasible point (see
        `feasibility_tol` below) is less than or equal to this target. Default
        is ``-numpy.inf``.
    feasibility_tol : float
        Absolute tolerance for the constraint violation. Default is ``1e-8``.
    initial_tr_radius : float
        Initial trust-region radius. Typically, this value should be in the
        order of one tenth of the greatest expected change to the variables.
        Default is ``1.0``.
    final_tr_radius : float
        Final trust-region radius. It should indicate the accuracy required in
        the final values of the variables. If provided, this option overrides
        the value of `tol` in the `minimize` function. Default is ``1e-6``.
    scale : bool
        Set to True to scale the variables according to the bounds. If True and
        if all the lower and upper bounds are finite, the variables are scaled
        to be within the range :math:`[-1, 1]`. If any of the lower or upper
        bounds is infinite, the variables are not scaled. Default is ``False``.

    References
    ----------
    .. [1] COBYQA
           https://www.cobyqa.com/stable/
    """
    from .._lib.cobyqa import minimize  # import here to avoid circular imports

    _check_unknown_options(unknown_options)
    options = {
        'disp': bool(disp),
        'maxfev': int(maxfev) if maxfev is not None else 500 * len(x0),
        'maxiter': int(maxiter) if maxiter is not None else 1000 * len(x0),
        'target': float(f_target),
        'feasibility_tol': float(feasibility_tol),
        'radius_init': float(initial_tr_radius),
        'radius_final': float(final_tr_radius),
        'scale': bool(scale),
    }
    with COBYQA_LOCK:
        return minimize(fun, x0, args, bounds, constraints, callback, options)
