'''
This module checks whether to break out of the solver loop.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

from .infos import INFO_DEFAULT, NAN_INF_X, NAN_INF_F, FTARGET_ACHIEVED, MAXFUN_REACHED

import numpy as np

def checkbreak_unc(maxfun, nf, f, ftarget, x):
    '''
    This module checks whether to break out of the solver loop in the unconstrained case.
    '''

    # Outputs
    info = INFO_DEFAULT

    # Local variables
    srname = "CHECKbreak_UNC"

    # Preconditions
    assert INFO_DEFAULT not in [NAN_INF_X, NAN_INF_F, FTARGET_ACHIEVED, MAXFUN_REACHED], f'NAN_INF_X, NAN_INF_F, FTARGET_ACHIEVED, and MAXFUN_REACHED differ from INFO_DFT {srname}'
    # X does not contain NaN if the initial X does not contain NaN and the subroutines generating
    # trust-region/geometry steps work properly so that they never produce a step containing NaN/Inf.
    assert not any(np.isnan(x)), f'X does not contain NaN {srname}'
    # With the moderated extreme barrier, F cannot be NaN/+Inf.
    assert not (any(np.isnan(f)) or any(np.isposinf(f))), f'F is not NaN/+Inf {srname}'

    #====================#
    # Calculation starts #
    #====================#

    # Although X should not contain NaN unless there is a bug, we include the following for security.
    # X can be Inf, as finite + finite can be Inf numerically.
    if any(np.isnan(x)) or any(np.isinf(x)):
        info = NAN_INF_X

    # Although NAN_INF_F should not happen unless there is a bug, we include the following for security.
    if any(np.isnan(f)) or any(np.isposinf(f)):
        info = NAN_INF_F

    if f <= ftarget:
        info = FTARGET_ACHIEVED

    if nf >= maxfun:
        info = MAXFUN_REACHED

    return info

def checkbreak_con(maxfun, nf, cstrv, ctol, f, ftarget, x):
    '''
    This module checks whether to break out of the solver loop in the constrained case.
    '''

    # Outputs
    info = INFO_DEFAULT

    # Local variables
    srname = "CHECKbreak_CON"

    # Preconditions
    assert INFO_DEFAULT not in [NAN_INF_X, NAN_INF_F, FTARGET_ACHIEVED, MAXFUN_REACHED], f'NAN_INF_X, NAN_INF_F, FTARGET_ACHIEVED, and MAXFUN_REACHED differ from INFO_DFT {srname}'
    # X does not contain NaN if the initial X does not contain NaN and the subroutines generating
    # trust-region/geometry steps work properly so that they never produce a step containing NaN/Inf.
    assert not any(np.isnan(x)), f'X does not contain NaN {srname}'
    # With the moderated extreme barrier, F or CSTRV cannot be NaN/+Inf.
    assert not (np.isnan(f) or np.isposinf(f) or np.isnan(cstrv) or np.isposinf(cstrv)), f'F or CSTRV is not NaN/+Inf {srname}'

    #====================#
    # Calculation starts #
    #====================#

    # Although X should not contain NaN unless there is a bug, we include the following for security.
    # X can be Inf, as finite + finite can be Inf numerically.
    if any(np.isnan(x)) or any(np.isinf(x)):
        info = NAN_INF_X

    # Although NAN_INF_F should not happen unless there is a bug, we include the following for security.
    if np.isnan(f) or np.isposinf(f) or np.isnan(cstrv) or np.isposinf(cstrv):
        info = NAN_INF_F

    if cstrv <= ctol and f <= ftarget:
        info = FTARGET_ACHIEVED

    if nf >= maxfun:
        info = MAXFUN_REACHED

    return info
