# Bounds may appear unused in this file but we need to import it to make it available to the user
from scipy.optimize import NonlinearConstraint, LinearConstraint, Bounds
from .common._nonlinear_constraints import process_nl_constraints
from .common._linear_constraints import (
    combine_multiple_linear_constraints,
    separate_LC_into_eq_and_ineq,
)
from .common._bounds import process_bounds
from enum import Enum
from .common._project import _project
from .common.linalg import get_arrays_tol
from .cobyla.cobyla import cobyla
import numpy as np
from collections.abc import Iterable


class ConstraintType(Enum):
    LINEAR_OBJECT = 5
    NONLINEAR_OBJECT = 10
    LINEAR_DICT = 15
    NONLINEAR_DICT = 20


def get_constraint_type(constraint):
    if isinstance(constraint, dict) and ("A" in constraint) and ("lb" in constraint) and ("ub" in constraint):
        return ConstraintType.LINEAR_DICT
    elif isinstance(constraint, dict) and ("fun" in constraint) and ("lb" in constraint) and ("ub" in constraint):
        return ConstraintType.NONLINEAR_DICT
    elif hasattr(constraint, "A") and hasattr(constraint, "lb") and hasattr(constraint, "ub"):
        return ConstraintType.LINEAR_OBJECT
    elif hasattr(constraint, "fun") and hasattr(constraint, "lb") and hasattr(constraint, "ub"):
        return ConstraintType.NONLINEAR_OBJECT
    else:
        raise ValueError(f"Constraint type {type(constraint)} not recognized")


def process_constraints(constraints):
    # First throw it back if it's an empty tuple
    if not constraints:
        return None, None
    # Next figure out if it's a list of constraints or a single constraint
    # If it's a single constraint, make it a list, and then the remaining logic
    # doesn't have to change
    if not isinstance(constraints, Iterable):
        constraints = [constraints]

    # Separate out the linear and nonlinear constraints
    linear_constraints = []
    nonlinear_constraints = []
    for constraint in constraints:
        constraint_type = get_constraint_type(constraint)
        if constraint_type is ConstraintType.LINEAR_OBJECT:
            linear_constraints.append(constraint)
        elif constraint_type is ConstraintType.NONLINEAR_OBJECT:
            nonlinear_constraints.append(constraint)
        elif constraint_type == ConstraintType.LINEAR_DICT:
            linear_constraints.append(LinearConstraint(constraint["A"], constraint["lb"], constraint["ub"]))
        elif constraint_type == ConstraintType.NONLINEAR_DICT:
            nonlinear_constraints.append(NonlinearConstraint(constraint["fun"], constraint["lb"], constraint["ub"]))
        else:
            raise ValueError("Constraint type not recognized")

    if len(nonlinear_constraints) > 0:
        nonlinear_constraint_function = process_nl_constraints(nonlinear_constraints)
    else:
        nonlinear_constraint_function = None

    # Determine if we have multiple linear constraints, just 1, or none, and process accordingly
    if len(linear_constraints) > 1:
        linear_constraint = combine_multiple_linear_constraints(linear_constraints)
    elif len(linear_constraints) == 1:
        linear_constraint = linear_constraints[0]
    else:
        linear_constraint = None

    return linear_constraint, nonlinear_constraint_function


def minimize(fun, x0, args=(), method=None, bounds=None, constraints=(), callback=None, options=None):

    linear_constraint, nonlinear_constraint_function = process_constraints(constraints)

    options = {'quiet': True} if options is None else options
    quiet = options.get("quiet", True)

    if method is None:
        if nonlinear_constraint_function is not None:
            if not quiet: print("Nonlinear constraints detected, applying COBYLA")
            method = "cobyla"
        elif linear_constraint is not None:
            if not quiet: print("Linear constraints detected without nonlinear constraints, applying LINCOA")
            method = "lincoa"
        elif bounds is not None:
            if not quiet: print("Bounds without linear or nonlinear constraints detected, applying BOBYQA")
            method = "bobyqa"
        else:
            if not quiet: print("No bounds or constraints detected, applying NEWUOA")
            method = "newuoa"
    else:
        # Raise some errors if methods were called with inappropriate options
        method = method.lower()
        if method not in ('newuoa', 'uobyqa', 'bobyqa', 'cobyla', 'lincoa'):
            raise ValueError(f"Method must be one of NEWUOA, UOBYQA, BOBYQA, COBYLA, or LINCOA, not '{method}'")
        if method != "cobyla" and nonlinear_constraint_function is not None:
            raise ValueError("Nonlinear constraints were provided for an algorithm that cannot handle them")
        if method not in ("cobyla", "lincoa") and linear_constraint is not None:
            raise ValueError("Linear constraints were provided for an algorithm that cannot handle them")
        if method not in ("cobyla", "bobyqa", "lincoa") and bounds is not None:
            raise ValueError("Bounds were provided for an algorithm that cannot handle them")

    # Try to get the length of x0. If we can't that likely means it's a scalar, and
    # in that case we turn it into an array and wrap the original function so that it
    # can accept an array and return a scalar.
    try:
        lenx0 = len(x0)
    except TypeError:
        x0 = np.array([x0])
        original_scalar_fun = fun
        def scalar_fun(x):
            return original_scalar_fun(x[0], *args)
        fun = scalar_fun
        lenx0 = 1

    lb, ub = process_bounds(bounds, lenx0)

    # Check which variables are fixed and eliminate them from the problem.
    # Save the indices and values so that we can call the original function with
    # an array of the appropriate size, and so that we can add the fixed values to the
    # result when COBYLA returns.
    tol = get_arrays_tol(lb, ub)
    _fixed_idx = (
        (lb <= ub)
        & (np.abs(lb - ub) < tol)
    )
    if any(_fixed_idx):
        _fixed_values = 0.5 * (
            lb[_fixed_idx] + ub[_fixed_idx]
        )
        _fixed_values = np.clip(
            _fixed_values,
            lb[_fixed_idx],
            ub[_fixed_idx],
        )
        x0 = x0[~_fixed_idx]
        lb = lb[~_fixed_idx]
        ub = ub[~_fixed_idx]
        original_fun = fun
        def fixed_fun(x):
            newx = np.zeros(lenx0)
            newx[_fixed_idx] = _fixed_values
            newx[~_fixed_idx] = x
            return original_fun(newx, *args)
        fun = fixed_fun


    # Project x0 onto the feasible set
    if nonlinear_constraint_function is None:
        result = _project(x0, lb, ub, {"linear": linear_constraint, "nonlinear": None})
        x0 = result.x
    
    if linear_constraint is not None:
        A_eq, b_eq, A_ineq, b_ineq = separate_LC_into_eq_and_ineq(linear_constraint)
    else:
        A_eq, b_eq, A_ineq, b_ineq = None, None, None, None

    if nonlinear_constraint_function is not None:
        # If there is a nonlinear constraint function, we will call COBYLA, which needs the number of nonlinear
        # constraints (m_nlcon). In order to get this number we need to evaluate the constraint function at x0.
        # The constraint value at x0 (nlconstr0) is not discarded but passed down to the Fortran backend, as its
        # evaluation is assumed to be expensive. We also evaluate the objective function at x0 and pass the result
        # (f0) down to the Fortran backend, which expects nlconstr0 and f0 to be provided in sync.
        def calcfc(x):
            f = fun(x, *args)
            nlconstr = nonlinear_constraint_function(x)
            return f, nlconstr
    else:
        def calcfc(x):
            f = fun(x, *args)
            constr = np.zeros(0)
            return f, constr

    f0, nlconstr0 = calcfc(x0)

    if 'quiet' in options:
        del options['quiet']

    if 'maxfev' in options:
        options['maxfun'] = options['maxfev']
        del options['maxfev']

    result = cobyla(
        calcfc,
        len(nlconstr0),
        x0,
        A_ineq,
        b_ineq,
        A_eq,
        b_eq,
        lb,
        ub,
        f0=f0,
        nlconstr0=nlconstr0,
        callback=callback,
        **options
    )

    if any(_fixed_idx):
        newx = np.zeros(lenx0)
        newx[_fixed_idx] = _fixed_values
        newx[~_fixed_idx] = result.x
        result.x = newx
    return result
