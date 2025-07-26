'''
This module provides a function that calculates RHO when it needs to be reduced.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

from .consts import DEBUGGING
import numpy as np

def redrho(rho_in, rhoend):
    '''
    This function calculates RHO when it needs to be reduced.
    The scheme is shared by UOBYQA, NEWUOA, BOBYQA, LINCOA. For COBYLA, Powell's code reduces RHO by
    'RHO *= 0.5; if RHO <= 1.5 * RHOEND: RHO = RHOEND' as specified in (11) of the COBYLA
    paper. However, this scheme seems to work better, especially after we introduce DELTA.
    '''

    # Preconditions
    if DEBUGGING:
        assert rho_in > rhoend > 0

    #====================#
    # Calculation starts #
    #====================#

    rho_ratio = rho_in / rhoend

    if rho_ratio > 250:
        rho = 0.1 * rho_in
    elif rho_ratio <= 16:
        rho = rhoend
    else:
        rho = np.sqrt(rho_ratio) * rhoend  # rho = np.sqrt(rho * rhoend)

    #==================#
    # Calculation ends #
    #==================#

    # Postconditions
    if DEBUGGING:
        assert rho_in > rho >= rhoend

    return rho
