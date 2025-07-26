"""
Interface to Constrained Optimization By Linear Approximation

Functions
---------
.. autosummary::
   :toctree: generated/

    fmin_cobyla

"""

from inspect import signature

import numpy as np
from ._optimize import (OptimizeResult, _check_unknown_options,
    _prepare_scalar_function)
from ._constraints import NonlinearConstraint


__all__ = ['fmin_cobyla']


def fmin_cobyla(func, x0, cons, args=(), consargs=None, rhobeg=1.0,
                rhoend=1e-4, maxfun=1000, disp=None, catol=2e-4,
                *, callback=None):
    """
    Minimize a function using the Constrained Optimization By Linear
    Approximation (COBYLA) method. This method uses the pure-python implementation
    of the algorithm from PRIMA.

    Parameters
    ----------
    func : callable
        Function to minimize. In the form func(x, \\*args).
    x0 : ndarray
        Initial guess.
    cons : sequence
        Constraint functions; must all be ``>=0`` (a single function
        if only 1 constraint). Each function takes the parameters `x`
        as its first argument, and it can return either a single number or
        an array or list of numbers.
    args : tuple, optional
        Extra arguments to pass to function.
    consargs : tuple, optional
        Extra arguments to pass to constraint functions (default of None means
        use same extra arguments as those passed to func).
        Use ``()`` for no extra arguments.
    rhobeg : float, optional
        Reasonable initial changes to the variables.
    rhoend : float, optional
        Final accuracy in the optimization (not precisely guaranteed). This
        is a lower bound on the size of the trust region.
    disp : {0, 1, 2, 3}, optional
        Controls the frequency of output; 0 implies no output.
    maxfun : int, optional
        Maximum number of function evaluations.
    catol : float, optional
        Absolute tolerance for constraint violations.
    callback : callable, optional
        Called after each iteration, as ``callback(x)``, where ``x`` is the
        current parameter vector.

    Returns
    -------
    x : ndarray
        The argument that minimises `f`.

    See also
    --------
    minimize: Interface to minimization algorithms for multivariate
        functions. See the 'COBYLA' `method` in particular.

    Notes
    -----
    This algorithm is based on linear approximations to the objective
    function and each constraint. We briefly describe the algorithm.

    Suppose the function is being minimized over k variables. At the
    jth iteration the algorithm has k+1 points v_1, ..., v_(k+1),
    an approximate solution x_j, and a radius RHO_j.
    (i.e., linear plus a constant) approximations to the objective
    function and constraint functions such that their function values
    agree with the linear approximation on the k+1 points v_1,.., v_(k+1).
    This gives a linear program to solve (where the linear approximations
    of the constraint functions are constrained to be non-negative).

    However, the linear approximations are likely only good
    approximations near the current simplex, so the linear program is
    given the further requirement that the solution, which
    will become x_(j+1), must be within RHO_j from x_j. RHO_j only
    decreases, never increases. The initial RHO_j is rhobeg and the
    final RHO_j is rhoend. In this way COBYLA's iterations behave
    like a trust region algorithm.

    Additionally, the linear program may be inconsistent, or the
    approximation may give poor improvement. For details about
    how these issues are resolved, as well as how the points v_i are
    updated, refer to the source code or the references below.

        .. versionchanged:: 1.16.0
            The original Powell implementation was replaced by a pure
            Python version from the PRIMA package, with bug fixes and
            improvements being made.


    References
    ----------
    Powell M.J.D. (1994), "A direct search optimization method that models
    the objective and constraint functions by linear interpolation.", in
    Advances in Optimization and Numerical Analysis, eds. S. Gomez and
    J-P Hennart, Kluwer Academic (Dordrecht), pp. 51-67

    Powell M.J.D. (1998), "Direct search algorithms for optimization
    calculations", Acta Numerica 7, 287-336

    Powell M.J.D. (2007), "A view of algorithms for optimization without
    derivatives", Cambridge University Technical Report DAMTP 2007/NA03

    Zhang Z. (2023), "PRIMA: Reference Implementation for Powell's Methods with
    Modernization and Amelioration", https://www.libprima.net,
    :doi:`10.5281/zenodo.8052654`

    Examples
    --------
    Minimize the objective function f(x,y) = x*y subject
    to the constraints x**2 + y**2 < 1 and y > 0::

        >>> def objective(x):
        ...     return x[0]*x[1]
        ...
        >>> def constr1(x):
        ...     return 1 - (x[0]**2 + x[1]**2)
        ...
        >>> def constr2(x):
        ...     return x[1]
        ...
        >>> from scipy.optimize import fmin_cobyla
        >>> fmin_cobyla(objective, [0.0, 0.1], [constr1, constr2], rhoend=1e-7)
        array([-0.70710685,  0.70710671])

    The exact solution is (-sqrt(2)/2, sqrt(2)/2).



    """
    err = "cons must be a sequence of callable functions or a single"\
          " callable function."
    try:
        len(cons)
    except TypeError as e:
        if callable(cons):
            cons = [cons]
        else:
            raise TypeError(err) from e
    else:
        for thisfunc in cons:
            if not callable(thisfunc):
                raise TypeError(err)

    if consargs is None:
        consargs = args

    # build constraints
    nlcs = []
    for con in cons:
        # Use default argument, otherwise the last `con` is captured by all wrapped_con
        def wrapped_con(x, confunc=con):
            return confunc(x, *consargs)
        nlcs.append(NonlinearConstraint(wrapped_con, 0, np.inf))

    # options
    opts = {'rhobeg': rhobeg,
            'tol': rhoend,
            'disp': disp,
            'maxiter': maxfun,
            'catol': catol,
            'callback': callback}

    sol = _minimize_cobyla(func, x0, args, constraints=nlcs,
                           **opts)
    if disp and not sol['success']:
        print(f"COBYLA failed to find a solution: {sol.message}")
    return sol['x']


def _minimize_cobyla(fun, x0, args=(), constraints=(),
                     rhobeg=1.0, tol=1e-4, maxiter=1000,
                     disp=0, catol=None, f_target=-np.inf,
                     callback=None, bounds=None, **unknown_options):
    """
    Minimize a scalar function of one or more variables using the
    Constrained Optimization BY Linear Approximation (COBYLA) algorithm.
    This method uses the pure-python implementation of the algorithm from PRIMA.

    Options
    -------
    rhobeg : float
        Reasonable initial changes to the variables.
    tol : float
        Final accuracy in the optimization (not precisely guaranteed).
        This is a lower bound on the size of the trust region.
    disp : int
        Controls the frequency of output:
            0. (default) There will be no printing
            1. A message will be printed to the screen at the end of iteration, showing
               the best vector of variables found and its objective function value
            2. in addition to 1, each new value of RHO is printed to the screen,
               with the best vector of variables so far and its objective function
               value.
            3. in addition to 2, each function evaluation with its variables will
               be printed to the screen.
    maxiter : int
        Maximum number of function evaluations.
    catol : float
        Tolerance (absolute) for constraint violations
    f_target : float
        Stop if the objective function is less than `f_target`.

        .. versionchanged:: 1.16.0
            The original Powell implementation was replaced by a pure
            Python version from the PRIMA package, with bug fixes and
            improvements being made.


    References
    ----------
    Zhang Z. (2023), "PRIMA: Reference Implementation for Powell's Methods with
    Modernization and Amelioration", https://www.libprima.net,
    :doi:`10.5281/zenodo.8052654`
    """
    from .._lib.pyprima import minimize
    from .._lib.pyprima.common.infos import SMALL_TR_RADIUS, FTARGET_ACHIEVED
    from .._lib.pyprima.common.message import get_info_string
    _check_unknown_options(unknown_options)
    rhoend = tol
    iprint = disp if disp is not None else 0
    if iprint != 0 and iprint != 1 and iprint != 2 and iprint != 3:
        raise ValueError(f'disp argument to minimize must be 0, 1, 2, or 3,\
                          received {iprint}')

    # create the ScalarFunction, cobyla doesn't require derivative function
    def _jac(x, *args):
        return None

    sf = _prepare_scalar_function(fun, x0, args=args, jac=_jac)

    if callback is not None:
        sig = signature(callback)
        if set(sig.parameters) == {"intermediate_result"}:
            def wrapped_callback_intermediate(x, f, nf, tr, cstrv, nlconstrlist):
                intermediate_result = OptimizeResult(x=np.copy(x), fun=f, nfev=nf,
                                                     nit=tr, maxcv=cstrv)
                callback(intermediate_result=intermediate_result)
        else:
            def wrapped_callback_intermediate(x, f, nf, tr, cstrv, nlconstrlist):
                callback(np.copy(x))
        def wrapped_callback(x, f, nf, tr, cstrv, nlconstrlist):
            try:
                wrapped_callback_intermediate(x, f, nf, tr, cstrv, nlconstrlist)
                return False
            except StopIteration:
                return True
    else:
        wrapped_callback = None


    ctol = catol if catol is not None else np.sqrt(np.finfo(float).eps)
    options = {
        'rhobeg': rhobeg,
        'rhoend': rhoend,
        'maxfev': maxiter,
        'iprint': iprint,
        'ctol': ctol,
        'ftarget': f_target,
    }

    result = minimize(sf.fun, x0, method='cobyla', bounds=bounds,
                      constraints=constraints, callback=wrapped_callback,
                      options=options)


    if result.cstrv > ctol:
        success = False
        message = ('Did not converge to a solution satisfying the constraints. See '
                  '`maxcv` for the magnitude of the violation.')
    else:
        success = result.info == SMALL_TR_RADIUS or result.info == FTARGET_ACHIEVED
        message = get_info_string('COBYLA', result.info)

    return OptimizeResult(x=result.x,
                          status=result.info,
                          success=success,
                          message=message,
                          nfev=result.nf,
                          fun=result.f,
                          maxcv=result.cstrv)
