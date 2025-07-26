'''
This is a module evaluating the objective/constraint function with Nan/Inf handling.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

import numpy as np
from .consts import FUNCMAX, CONSTRMAX, REALMAX, DEBUGGING
from .linalg import matprod, primasum

# This is a module evaluating the objective/constraint function with Nan/Inf handling.


def moderatex(x):
    '''
    This function moderates a decision variable. It replaces NaN by 0 and Inf/-Inf by
    REALMAX/-REALMAX.
    '''
    x[np.isnan(x)] = 0
    x = np.clip(x, -REALMAX, REALMAX)
    return x

def moderatef(f):
    """
    This function moderates the function value of a MINIMIZATION problem. It replaces
    NaN and any value above FUNCMAX by FUNCMAX.
    """
    f = FUNCMAX if np.isnan(f) else f
    f = np.clip(f, -REALMAX, FUNCMAX)
    # We may moderate huge negative function values as follows, but we decide not to.
    # f = np.clip(f, -FUNCMAX, FUNCMAX)
    return f


def moderatec(c):
    """
    This function moderates the constraint value, the constraint demanding this value
    to be NONNEGATIVE. It replaces any value below -CONSTRMAX by -CONSTRMAX, and any
    NaN or value above CONSTRMAX by CONSTRMAX.
    """
    np.nan_to_num(c, copy=False, nan=CONSTRMAX)
    c = np.clip(c, -CONSTRMAX, CONSTRMAX)
    return c


def evaluate(calcfc, x, m_nlcon, amat, bvec):
    """
    This function evaluates CALCFC at X, returning the objective function value and the
    constraint value. Nan/Inf are handled by a moderated extreme barrier.
    """

    # Sizes
    m_lcon = len(bvec) if bvec is not None else 0

    # Preconditions
    if DEBUGGING:
        # X should not contain NaN if the initial X does not contain NaN and the
        # subroutines generating # trust-region/geometry steps work properly so that
        # they never produce a step containing NaN/Inf.
        assert not any(np.isnan(x))

    #====================#
    # Calculation starts #
    #====================#

    constr = np.zeros(m_lcon + m_nlcon)
    if amat is not None:
        constr[:m_lcon] = matprod(x, amat.T) - bvec

    if any(np.isnan(x)):
        # Although this should not happen unless there is a bug, we include this case
        # for robustness.
        f = primasum(x)
        constr = np.ones(m_nlcon) * f
    else:
        f, constr[m_lcon:] = calcfc(moderatex(x))

        # Moderated extreme barrier: replace NaN/huge objective or constraint values
        # with a large but finite value. This is naive, and better approaches surely
        # exist.
        f = moderatef(f)
        constr[m_lcon:] = moderatec(constr[m_lcon:])

    #==================#
    # Calculation ends #
    #==================#

    # Postconditions
    if DEBUGGING:
        # With X not containing NaN, and with the moderated extreme barrier, F cannot
        # be NaN/+Inf, and CONSTR cannot be NaN/-Inf.
        assert not (np.isnan(f) or np.isposinf(f))
        assert not any(np.isnan(constr) | np.isposinf(constr))

    return f, constr
