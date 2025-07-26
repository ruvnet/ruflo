'''
This module calculates the reduction ratio for trust-region methods.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

from .consts import DEBUGGING, REALMAX
import numpy as np

def redrat(ared, pred, rshrink):
    '''
    This function evaluates the reduction ratio of a trust-region step, handling inf/nan properly.
    '''

    # Preconditions
    if DEBUGGING:
        assert rshrink >= 0

    #====================#
    # Calculation starts #
    #====================#

    if np.isnan(ared):
        # This should not happen in unconstrained problems due to the moderated extreme barrier.
        ratio = -REALMAX
    elif np.isnan(pred) or pred <= 0:
        # The trust-region subproblem solver fails in this rare case. Instead of terminating as Powell's
        # original code does, we set ratio as follows so that the solver may continue to progress.
        if ared > 0:
            # The trial point will be accepted, but the trust-region radius will be shrunk if rshrink>0
            ratio = rshrink/2
        else:
            # Set the ration to a large negative number to signify a bad trust-region step, so that the
            # solver will check whether to take a geometry step or reduce rho.
            ratio = -REALMAX
    elif np.isposinf(pred) and np.isposinf(ared):
        ratio = 1  # ared/pred = NaN if calculated directly
    elif np.isposinf(pred) and np.isneginf(ared):
        ratio = -REALMAX  # ared/pred = NaN if calculated directly
    else:
        ratio = ared/pred

    #==================#
    # Calculation ends #
    #==================#

    # Postconditions
    if DEBUGGING:
        assert not np.isnan(ratio)
    return ratio
