'''
This is a module defining some constants.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

import numpy as np
import os

DEBUGGING = bool(os.getenv('PRIMA_DEBUGGING'))

REALMIN = np.finfo(float).tiny
REALMAX = np.finfo(float).max
FUNCMAX = 10.0**30
CONSTRMAX = FUNCMAX
EPS = np.finfo(float).eps

# Any bound with an absolute value at least BOUNDMAX is considered as no bound.
BOUNDMAX = REALMAX/4

# Some default values
RHOBEG_DEFAULT = 1
RHOEND_DEFAULT = 1e-6
FTARGET_DEFAULT = -REALMAX
CTOL_DEFAULT = np.sqrt(EPS)
CWEIGHT_DEFAULT = 1e8
ETA1_DEFAULT = 0.1
ETA2_DEFAULT = 0.7
GAMMA1_DEFAULT = 0.5
GAMMA2_DEFAULT = 2
IPRINT_DEFAULT = 0
MAXFUN_DIM_DEFAULT = 500

PRIMA_MAX_HIST_MEM_MB = 300  # 1MB > 10^5*REAL64. 100 can be too small.

# Maximal amount of memory (Byte) allowed for XHIST, FHIST, CONHIST, CHIST, and the filters.
MHM = PRIMA_MAX_HIST_MEM_MB * 10**6
# Make sure that MAXHISTMEM does not exceed HUGE(0) to avoid overflow and memory errors.
MAXHISTMEM = min(MHM, np.iinfo(np.int32).max)

# Maximal length of the filter used in constrained solvers.
MIN_MAXFILT = 200  # Should be positive; < 200 is not recommended.
MAXFILT_DEFAULT = 10 * MIN_MAXFILT
