"""
This module implements the Sequential Least Squares Programming optimization
algorithm (SLSQP), originally developed by Dieter Kraft.
See http://www.netlib.org/toms/733

Functions
---------
.. autosummary::
   :toctree: generated/

    approx_jacobian
    fmin_slsqp

"""

__all__ = ['approx_jacobian', 'fmin_slsqp']

import numpy as np
from ._slsqplib import slsqp
from scipy.linalg import norm as lanorm
from ._optimize import (OptimizeResult, _check_unknown_options,
                        _prepare_scalar_function, _clip_x_for_func,
                        _check_clip_x)
from ._numdiff import approx_derivative
from ._constraints import old_bound_to_new, _arr_to_scalar
from scipy._lib._array_api import array_namespace
from scipy._lib import array_api_extra as xpx
from numpy.typing import NDArray

__docformat__ = "restructuredtext en"

_epsilon = np.sqrt(np.finfo(np.float64).eps)


def approx_jacobian(x, func, epsilon, *args):
    """
    Approximate the Jacobian matrix of a callable function.

    Parameters
    ----------
    x : array_like
        The state vector at which to compute the Jacobian matrix.
    func : callable f(x,*args)
        The vector-valued function.
    epsilon : float
        The perturbation used to determine the partial derivatives.
    args : sequence
        Additional arguments passed to func.

    Returns
    -------
    An array of dimensions ``(lenf, lenx)`` where ``lenf`` is the length
    of the outputs of `func`, and ``lenx`` is the number of elements in
    `x`.

    Notes
    -----
    The approximation is done using forward differences.

    """
    # approx_derivative returns (m, n) == (lenf, lenx)
    jac = approx_derivative(func, x, method='2-point', abs_step=epsilon,
                            args=args)
    # if func returns a scalar jac.shape will be (lenx,). Make sure
    # it's at least a 2D array.
    return np.atleast_2d(jac)


def fmin_slsqp(func, x0, eqcons=(), f_eqcons=None, ieqcons=(), f_ieqcons=None,
               bounds=(), fprime=None, fprime_eqcons=None,
               fprime_ieqcons=None, args=(), iter=100, acc=1.0E-6,
               iprint=1, disp=None, full_output=0, epsilon=_epsilon,
               callback=None):
    """
    Minimize a function using Sequential Least Squares Programming

    Python interface function for the SLSQP Optimization subroutine
    originally implemented by Dieter Kraft.

    Parameters
    ----------
    func : callable f(x,*args)
        Objective function.  Must return a scalar.
    x0 : 1-D ndarray of float
        Initial guess for the independent variable(s).
    eqcons : list, optional
        A list of functions of length n such that
        eqcons[j](x,*args) == 0.0 in a successfully optimized
        problem.
    f_eqcons : callable f(x,*args), optional
        Returns a 1-D array in which each element must equal 0.0 in a
        successfully optimized problem. If f_eqcons is specified,
        eqcons is ignored.
    ieqcons : list, optional
        A list of functions of length n such that
        ieqcons[j](x,*args) >= 0.0 in a successfully optimized
        problem.
    f_ieqcons : callable f(x,*args), optional
        Returns a 1-D ndarray in which each element must be greater or
        equal to 0.0 in a successfully optimized problem. If
        f_ieqcons is specified, ieqcons is ignored.
    bounds : list, optional
        A list of tuples specifying the lower and upper bound
        for each independent variable [(xl0, xu0),(xl1, xu1),...]
        Infinite values will be interpreted as large floating values.
    fprime : callable ``f(x,*args)``, optional
        A function that evaluates the partial derivatives of func.
    fprime_eqcons : callable ``f(x,*args)``, optional
        A function of the form ``f(x, *args)`` that returns the m by n
        array of equality constraint normals. If not provided,
        the normals will be approximated. The array returned by
        fprime_eqcons should be sized as ( len(eqcons), len(x0) ).
    fprime_ieqcons : callable ``f(x,*args)``, optional
        A function of the form ``f(x, *args)`` that returns the m by n
        array of inequality constraint normals. If not provided,
        the normals will be approximated. The array returned by
        fprime_ieqcons should be sized as ( len(ieqcons), len(x0) ).
    args : sequence, optional
        Additional arguments passed to func and fprime.
    iter : int, optional
        The maximum number of iterations.
    acc : float, optional
        Requested accuracy.
    iprint : int, optional
        The verbosity of fmin_slsqp :

        * iprint <= 0 : Silent operation
        * iprint == 1 : Print summary upon completion (default)
        * iprint >= 2 : Print status of each iterate and summary
    disp : int, optional
        Overrides the iprint interface (preferred).
    full_output : bool, optional
        If False, return only the minimizer of func (default).
        Otherwise, output final objective function and summary
        information.
    epsilon : float, optional
        The step size for finite-difference derivative estimates.
    callback : callable, optional
        Called after each iteration, as ``callback(x)``, where ``x`` is the
        current parameter vector.

    Returns
    -------
    out : ndarray of float
        The final minimizer of func.
    fx : ndarray of float, if full_output is true
        The final value of the objective function.
    its : int, if full_output is true
        The number of iterations.
    imode : int, if full_output is true
        The exit mode from the optimizer (see below).
    smode : string, if full_output is true
        Message describing the exit mode from the optimizer.

    See also
    --------
    minimize: Interface to minimization algorithms for multivariate
        functions. See the 'SLSQP' `method` in particular.

    Notes
    -----
    Exit modes are defined as follows:

    - ``-1`` : Gradient evaluation required (g & a)
    - ``0`` : Optimization terminated successfully
    - ``1`` : Function evaluation required (f & c)
    - ``2`` : More equality constraints than independent variables
    - ``3`` : More than 3*n iterations in LSQ subproblem
    - ``4`` : Inequality constraints incompatible
    - ``5`` : Singular matrix E in LSQ subproblem
    - ``6`` : Singular matrix C in LSQ subproblem
    - ``7`` : Rank-deficient equality constraint subproblem HFTI
    - ``8`` : Positive directional derivative for linesearch
    - ``9`` : Iteration limit reached

    Examples
    --------
    Examples are given :ref:`in the tutorial <tutorial-sqlsp>`.

    """
    if disp is not None:
        iprint = disp

    opts = {'maxiter': iter,
            'ftol': acc,
            'iprint': iprint,
            'disp': iprint != 0,
            'eps': epsilon,
            'callback': callback}

    # Build the constraints as a tuple of dictionaries
    cons = ()
    # 1. constraints of the 1st kind (eqcons, ieqcons); no Jacobian; take
    #    the same extra arguments as the objective function.
    cons += tuple({'type': 'eq', 'fun': c, 'args': args} for c in eqcons)
    cons += tuple({'type': 'ineq', 'fun': c, 'args': args} for c in ieqcons)
    # 2. constraints of the 2nd kind (f_eqcons, f_ieqcons) and their Jacobian
    #    (fprime_eqcons, fprime_ieqcons); also take the same extra arguments
    #    as the objective function.
    if f_eqcons:
        cons += ({'type': 'eq', 'fun': f_eqcons, 'jac': fprime_eqcons,
                  'args': args}, )
    if f_ieqcons:
        cons += ({'type': 'ineq', 'fun': f_ieqcons, 'jac': fprime_ieqcons,
                  'args': args}, )

    res = _minimize_slsqp(func, x0, args, jac=fprime, bounds=bounds,
                          constraints=cons, **opts)
    if full_output:
        return res['x'], res['fun'], res['nit'], res['status'], res['message']
    else:
        return res['x']


def _minimize_slsqp(func, x0, args=(), jac=None, bounds=None,
                    constraints=(),
                    maxiter=100, ftol=1.0E-6, iprint=1, disp=False,
                    eps=_epsilon, callback=None, finite_diff_rel_step=None,
                    workers=None, **unknown_options):
    """
    Minimize a scalar function of one or more variables using Sequential
    Least Squares Programming (SLSQP).

    Parameters
    ----------
    ftol : float
        Precision target for the value of f in the stopping criterion. This value
        controls the final accuracy for checking various optimality conditions;
        gradient of the lagrangian and absolute sum of the constraint violations
        should be lower than ``ftol``. Similarly, computed step size and the
        objective function changes are checked against this value. Default is 1e-6.
    eps : float
        Step size used for numerical approximation of the Jacobian.
    disp : bool
        Set to True to print convergence messages. If False,
        `verbosity` is ignored and set to 0.
    maxiter : int
        Maximum number of iterations.
    finite_diff_rel_step : None or array_like, optional
        If ``jac in ['2-point', '3-point', 'cs']`` the relative step size to
        use for numerical approximation of `jac`. The absolute step
        size is computed as ``h = rel_step * sign(x) * max(1, abs(x))``,
        possibly adjusted to fit into the bounds. For ``method='3-point'``
        the sign of `h` is ignored. If None (default) then step is selected
        automatically.
    workers : int, map-like callable, optional
        A map-like callable, such as `multiprocessing.Pool.map` for evaluating
        any numerical differentiation in parallel.
        This evaluation is carried out as ``workers(fun, iterable)``.

        .. versionadded:: 1.16.0

    Returns
    -------
    res : OptimizeResult
        The optimization result represented as an `OptimizeResult` object.
        In this dict-like object the following fields are of particular importance:
        ``x`` the solution array, ``success`` a Boolean flag indicating if the
        optimizer exited successfully, ``message`` which describes the reason for
        termination, and ``multipliers`` which contains the Karush-Kuhn-Tucker
        (KKT) multipliers for the QP approximation used in solving the original
        nonlinear problem. See ``Notes`` below. See also `OptimizeResult` for a
        description of other attributes.

    Notes
    -----
    The KKT multipliers are returned in the ``OptimizeResult.multipliers``
    attribute as a NumPy array. Denoting the dimension of the equality constraints
    with ``meq``, and of inequality constraints with ``mineq``, then the returned
    array slice ``m[:meq]`` contains the multipliers for the equality constraints,
    and the remaining ``m[meq:meq + mineq]`` contains the multipliers for the 
    inequality constraints. The multipliers corresponding to bound inequalities 
    are not returned. See [1]_ pp. 321 or [2]_ for an explanation of how to interpret
    these multipliers. The internal QP problem is solved using the methods given
    in [3]_ Chapter 25.

    Note that if new-style `NonlinearConstraint` or `LinearConstraint` were
    used, then ``minimize`` converts them first to old-style constraint dicts.
    It is possible for a single new-style constraint to simultaneously contain
    both inequality and equality constraints. This means that if there is mixing
    within a single constraint, then the returned list of multipliers will have
    a different length than the original new-style constraints.

    References
    ----------
    .. [1] Nocedal, J., and S J Wright, 2006, "Numerical Optimization", Springer,
       New York.
    .. [2] Kraft, D., "A software package for sequential quadratic programming",
       1988, Tech. Rep. DFVLR-FB 88-28, DLR German Aerospace Center, Germany.
    .. [3] Lawson, C. L., and R. J. Hanson, 1995, "Solving Least Squares Problems",
       SIAM, Philadelphia, PA.

    """
    _check_unknown_options(unknown_options)
    acc = ftol
    epsilon = eps

    if not disp:
        iprint = 0

    # Transform x0 into an array.
    xp = array_namespace(x0)
    x0 = xpx.atleast_nd(xp.asarray(x0), ndim=1, xp=xp)
    dtype = xp.float64
    if xp.isdtype(x0.dtype, "real floating"):
        dtype = x0.dtype
    x = xp.reshape(xp.astype(x0, dtype), -1)

    # SLSQP is sent 'old-style' bounds, 'new-style' bounds are required by
    # ScalarFunction
    if bounds is None or len(bounds) == 0:
        new_bounds = (-np.inf, np.inf)
    else:
        new_bounds = old_bound_to_new(bounds)

    # clip the initial guess to bounds, otherwise ScalarFunction doesn't work
    x = np.clip(x, new_bounds[0], new_bounds[1])

    # Constraints are triaged per type into a dictionary of tuples
    if isinstance(constraints, dict):
        constraints = (constraints, )

    cons = {'eq': (), 'ineq': ()}
    for ic, con in enumerate(constraints):
        # check type
        try:
            ctype = con['type'].lower()
        except KeyError as e:
            raise KeyError(f'Constraint {ic} has no type defined.') from e
        except TypeError as e:
            raise TypeError('Constraints must be defined using a '
                            'dictionary.') from e
        except AttributeError as e:
            raise TypeError("Constraint's type must be a string.") from e
        else:
            if ctype not in ['eq', 'ineq']:
                raise ValueError(f"Unknown constraint type '{con['type']}'.")

        # check function
        if 'fun' not in con:
            raise ValueError(f'Constraint {ic} has no function defined.')

        # check Jacobian
        cjac = con.get('jac')
        if cjac is None:
            # approximate Jacobian function. The factory function is needed
            # to keep a reference to `fun`, see gh-4240.
            def cjac_factory(fun):
                def cjac(x, *args):
                    x = _check_clip_x(x, new_bounds)

                    if jac in ['2-point', '3-point', 'cs']:
                        return approx_derivative(fun, x, method=jac, args=args,
                                                 rel_step=finite_diff_rel_step,
                                                 bounds=new_bounds)
                    else:
                        return approx_derivative(fun, x, method='2-point',
                                                 abs_step=epsilon, args=args,
                                                 bounds=new_bounds)

                return cjac
            cjac = cjac_factory(con['fun'])

        # update constraints' dictionary
        cons[ctype] += ({'fun': con['fun'],
                         'jac': cjac,
                         'args': con.get('args', ())}, )

    exit_modes = {-1: "Gradient evaluation required (g & a)",
                   0: "Optimization terminated successfully",
                   1: "Function evaluation required (f & c)",
                   2: "More equality constraints than independent variables",
                   3: "More than 3*n iterations in LSQ subproblem",
                   4: "Inequality constraints incompatible",
                   5: "Singular matrix E in LSQ subproblem",
                   6: "Singular matrix C in LSQ subproblem",
                   7: "Rank-deficient equality constraint subproblem HFTI",
                   8: "Positive directional derivative for linesearch",
                   9: "Iteration limit reached"}

    # Set the parameters that SLSQP will need
    # meq, mieq: number of equality and inequality constraints
    meq = sum(map(len, [np.atleast_1d(c['fun'](x, *c['args']))
              for c in cons['eq']]))
    mieq = sum(map(len, [np.atleast_1d(c['fun'](x, *c['args']))
               for c in cons['ineq']]))
    # m = The total number of constraints
    m = meq + mieq
    # n = The number of independent variables
    n = len(x)

    # Decompose bounds into xl and xu
    if bounds is None or len(bounds) == 0:
        xl = np.empty(n, dtype=float)
        xu = np.empty(n, dtype=float)
        xl.fill(np.nan)
        xu.fill(np.nan)
    else:
        bnds = np.array([(_arr_to_scalar(lo), _arr_to_scalar(up))
                      for (lo, up) in bounds], float)
        if bnds.shape[0] != n:
            raise IndexError('SLSQP Error: the length of bounds is not '
                             'compatible with that of x0.')

        with np.errstate(invalid='ignore'):
            bnderr = bnds[:, 0] > bnds[:, 1]

        if bnderr.any():
            raise ValueError("SLSQP Error: lb > ub in bounds "
                             f"{', '.join(str(b) for b in bnderr)}.")
        xl, xu = bnds[:, 0].copy(), bnds[:, 1].copy()

        # Mark infinite bounds with nans; the C code expects this
        infbnd = ~np.isfinite(bnds)
        xl[infbnd[:, 0]] = np.nan
        xu[infbnd[:, 1]] = np.nan

    # ScalarFunction provides function and gradient evaluation
    sf = _prepare_scalar_function(func, x, jac=jac, args=args, epsilon=eps,
                                  finite_diff_rel_step=finite_diff_rel_step,
                                  bounds=new_bounds, workers=workers)
    # gh11403 SLSQP sometimes exceeds bounds by 1 or 2 ULP, make sure this
    # doesn't get sent to the func/grad evaluator.
    wrapped_fun = _clip_x_for_func(sf.fun, new_bounds)
    wrapped_grad = _clip_x_for_func(sf.grad, new_bounds)

    # Initialize internal SLSQP state variables dictionary
    # This dictionary is passed to the SLSQP matching the C struct defined as
    #
    # struct SLSQP_static_vars {
    #     double acc, alpha, f0, gs, h1, h2, h3, h4, t, t0, tol;
    #     int exact, inconsistent, reset, iter, itermax, line, mode, meq;
    # };
    #
    # exact : a dummy variable and should be kept 0 since the underlying code
    #         always uses an inexact search.
    # inconsistent: a boolean set to 1 if the linearized QP is not well-defined
    #               while the original nonlinear problem is still solvable. Then
    #               the problem is augmented with a regularizing dummy variable.
    # reset: holds the count of resetting bfgs to identity matrix.
    # iter  : the current and itermax is the maximum number of iterations.
    # line  : the current line search iteration.
    # mode  : the exit mode of the solver.
    # alpha, f0, gs, h1, h2, h3, h4, t, t0 : internal variables used by the solver.
    #
    # The dict holds the intermediate state of the solver. The keys are the same
    # as the C struct members and will be modified in-place.
    state_dict = {
        "acc": acc,
        "alpha": 0.0,
        "f0": 0.0,
        "gs": 0.0,
        "h1": 0.0,
        "h2": 0.0,
        "h3": 0.0,
        "h4": 0.0,
        "t": 0.0,
        "t0": 0.0,
        "tol": 10.0*acc,
        "exact": 0,
        "inconsistent": 0,
        "reset": 0,
        "iter": 0,
        "itermax": maxiter,
        "line": 0,
        "m": m,
        "meq": meq,
        "mode": 0,
        "n": n
    }

    # Print the header if iprint >= 2
    if iprint >= 2:
        print(f"{'NIT':>5} {'FC':>5} {'OBJFUN':>16} {'GNORM':>16}")

    # Internal buffer and int array
    indices = np.zeros([max(m + 2*n + 2, 1)], dtype=np.int32)

    # The worst case workspace requirements for the buffer are:

    # n*(n+1)//2 + m + 4*n + 3                                           # SLSQP
    # (n+1)*(n+2) + (n+1)*meq + m + (mineq + 2*n + 2)*(n+1) +  3*n + 3   # LSQ
    # mineq + 2n + 2 + 2*meq + (n+1) + (mineq + 3n + 3)*(n + 1 - meq)    # LSEI
    # (mineq + 2n + 2 + 2)*(n + 2) + mineq + 2n + 2                      # LDP
    # mineq + 2n + 2                                                     # NNLS

    # If we sum all up and simplify by the help of sympy we get the following
    buffer_size = (
        n*(n+1)//2 + 3*m*n - (m + 5*n + 7)*meq + 9*m + 8*n*n + 35*n + meq*meq + 28
    )
    # If no inequality constraints are given, top up workspace for the missing
    # terms.
    if mieq == 0:
        buffer_size += 2*n*(n + 1)
    buffer = np.zeros(max(buffer_size, 1), dtype=np.float64)

    # mode is zero on entry, so call objective, constraints and gradients
    # there should be no func evaluations here because it's cached from
    # ScalarFunction
    fx = wrapped_fun(x)
    g = wrapped_grad(x)

    # Allocate the multiplier array both for constraints and user specified
    # bounds (extra +2 is for a possible augmented problem).
    mult = np.zeros([max(1, m + 2*n + 2)], dtype=np.float64)

    # Allocate the constraints and normals once and repopulate as needed
    C = np.zeros([max(1, m), n], dtype=np.float64, order='F')
    d = np.zeros([max(1, m)], dtype=np.float64)
    _eval_con_normals(C, x, cons, m, meq)
    _eval_constraint(d, x, cons, m, meq)

    iter_prev = 0

    while True:
        # Call SLSQP
        slsqp(state_dict, fx, g, C, d, x, mult, xl, xu, buffer, indices)

        if state_dict['mode'] == 1:  # objective and constraint evaluation required
            fx = sf.fun(x)
            _eval_constraint(d, x, cons, m, meq)

        if state_dict['mode'] == -1:  # gradient evaluation required
            g = sf.grad(x)
            _eval_con_normals(C, x, cons, m, meq)

        if state_dict['iter'] > iter_prev:
            # call callback if major iteration has incremented
            if callback is not None:
                callback(np.copy(x))

            # Print the status of the current iterate if iprint > 2
            if iprint >= 2:
                print(f"{state_dict['iter']:5d} {sf.nfev:5d} "
                      f"{fx:16.6E} {lanorm(g):16.6E}")

        # If exit mode is not -1 or 1, slsqp has completed
        if abs(state_dict['mode']) != 1:
            break

        iter_prev = state_dict['iter']

    # Optimization loop complete. Print status if requested
    if iprint >= 1:
        print(
            exit_modes[state_dict['mode']] + f"    (Exit mode {state_dict['mode']})"
        )
        print("            Current function value:", fx)
        print("            Iterations:", state_dict['iter'])
        print("            Function evaluations:", sf.nfev)
        print("            Gradient evaluations:", sf.ngev)

    return OptimizeResult(
        x=x, fun=fx, jac=g, nit=state_dict['iter'], nfev=sf.nfev, njev=sf.ngev,
        status=state_dict['mode'], message=exit_modes[state_dict['mode']],
        success=(state_dict['mode'] == 0), multipliers=mult[:m]
    )

# The following functions modify their first input argument in-place.
def _eval_constraint(d: NDArray, x: NDArray, cons: dict, m: int, meq: int):
    if m == 0:
        return

    # The reason why we don't use regular increments with a sane for loop is that
    # the constraint evaluations do not necessarily return scalars. Their
    # output length needs to be taken into account while placing them in d.

    if meq > 0:
        row = 0
        for con in cons['eq']:
            temp = np.atleast_1d(con['fun'](x, *con['args'])).ravel()
            d[row:row + len(temp)] = temp
            row += len(temp)

    if m > meq:
        row = meq
        for con in cons['ineq']:
            temp = np.atleast_1d(con['fun'](x, *con['args'])).ravel()
            d[row:row + len(temp)] = temp
            row += len(temp)

    return


def _eval_con_normals(C: NDArray, x: NDArray, cons: dict, m: int, meq: int):
    if m == 0:
        return

    if meq > 0:
        row = 0
        for con in cons['eq']:
            temp = np.atleast_2d(con['jac'](x, *con['args']))
            C[row:row + temp.shape[0], :] = temp
            row += temp.shape[0]

    if m > meq:
        row = meq
        for con in cons['ineq']:
            temp = np.atleast_2d(con['jac'](x, *con['args']))
            C[row:row + temp.shape[0], :] = temp
            row += temp.shape[0]

    return
