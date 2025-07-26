import numpy as np
from scipy.optimize import LinearConstraint


def combine_multiple_linear_constraints(constraints):
    full_A = constraints[0].A
    full_lb = constraints[0].lb
    full_ub = constraints[0].ub
    for constraint in constraints[1:]:
        full_A = np.concatenate((full_A, constraint.A), axis=0)
        full_lb = np.concatenate((full_lb, constraint.lb), axis=0)
        full_ub = np.concatenate((full_ub, constraint.ub), axis=0)
    return LinearConstraint(full_A, full_lb, full_ub)


def separate_LC_into_eq_and_ineq(linear_constraint):
    # The Python interface receives linear constraints lb <= A*x <= ub, but the
    # Fortran backend of PRIMA expects that the linear constraints are specified
    # as A_eq*x = b_eq, A_ineq*x <= b_ineq.
    # As such, we must:
    # 1. for constraints with lb == ub, rewrite them as A_eq*x = lb;
    # 2. for constraints with lb < ub, rewrite them as A_ineq*x <= b_ineq.

    # We suppose lb == ub if ub <= lb + 2*epsilon, assuming that the preprocessing
    # ensures lb <= ub.
    epsilon = np.finfo(np.float64).eps

    eq_indices = (linear_constraint.ub <= (linear_constraint.lb + 2*epsilon))
    A_eq = linear_constraint.A[eq_indices]
    b_eq = (linear_constraint.lb[eq_indices] + linear_constraint.ub[eq_indices])/2.0

    ineq_lb_indices = (linear_constraint.lb > -np.inf)
    A_ineq_lb = -linear_constraint.A[~eq_indices & ineq_lb_indices]
    b_ineq_lb = -linear_constraint.lb[~eq_indices & ineq_lb_indices]
    ineq_ub_indices = (linear_constraint.ub < np.inf)
    A_ineq_ub = linear_constraint.A[~eq_indices & ineq_ub_indices]
    b_ineq_ub = linear_constraint.ub[~eq_indices & ineq_ub_indices]
    A_ineq = np.concatenate((A_ineq_lb, A_ineq_ub))
    b_ineq = np.concatenate((b_ineq_lb, b_ineq_ub))

    # Ensure dtype is float64, or set to None if empty
    A_eq = np.array(A_eq, dtype=np.float64) if len(A_eq) > 0 else None
    b_eq = np.array(b_eq, dtype=np.float64) if len(b_eq) > 0 else None
    A_ineq = np.array(A_ineq, dtype=np.float64) if len(A_ineq) > 0 else None
    b_ineq = np.array(b_ineq, dtype=np.float64) if len(b_ineq) > 0 else None
    return A_eq, b_eq, A_ineq, b_ineq
