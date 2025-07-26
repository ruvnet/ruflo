'''
This is a module that preprocesses the inputs.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

from .consts import DEBUGGING, EPS, IPRINT_DEFAULT, FTARGET_DEFAULT, \
    MIN_MAXFILT, MAXFILT_DEFAULT, MAXHISTMEM, ETA1_DEFAULT, ETA2_DEFAULT, \
    GAMMA1_DEFAULT, GAMMA2_DEFAULT, RHOBEG_DEFAULT, RHOEND_DEFAULT, \
    CTOL_DEFAULT, CWEIGHT_DEFAULT
from .present import present
from warnings import warn
import numpy as np


def preproc(solver, num_vars, iprint, maxfun, maxhist, ftarget, rhobeg, rhoend,
            num_constraints=None, npt=None, maxfilt=None, ctol=None, cweight=None,
            eta1=None, eta2=None, gamma1=None, gamma2=None, is_constrained=None, has_rhobeg=None,
            honour_x0=None, xl=None, xu=None, x0=None):
    '''
    This subroutine preprocesses the inputs. It does nothing to the inputs that are valid.
    '''
    # Preconditions
    if DEBUGGING:
        assert num_vars >= 1
        if present(num_constraints):
            assert num_constraints >= 0
            assert num_constraints == 0 or solver.lower() == 'cobyla'
        if solver.lower() == 'cobyla' and present(num_constraints) and present(is_constrained):
            assert num_constraints == 0 or is_constrained
        if solver.lower() == 'bobyqa':
            assert present(xl) and present(xu)
            assert all(xu - xl >= 2 * EPS)
        if present(honour_x0):
            assert solver.lower() == 'bobyqa' and present(has_rhobeg) and present(xl) and present(xu) and present(x0)

    #====================#
    # Calculation starts #
    #====================#

    # Read num_constraints, if necessary
    num_constraints = num_constraints if (present(num_constraints) and solver.lower() == 'cobyla') else 0

    # Decide whether the problem is truly constrained
    is_constrained = is_constrained if (present(is_constrained)) else num_constraints > 0

    # Validate IPRINT
    if np.abs(iprint) > 3:
        iprint = IPRINT_DEFAULT
        warn(f'{solver}: Invalid IPRINT; it should be 0, 1, -1, 2, -2, 3, or -3; it is set to {iprint}')

    # Validate MAXFUN
    if solver.lower() == 'uobyqa':
        min_maxfun = (num_vars + 1) * (num_vars + 2) / 2 + 1
        min_maxfun_str = '(N+1)(N+2)/2 + 1'
    elif solver.lower() == 'cobyla':
        min_maxfun = num_vars + 2
        min_maxfun_str = 'num_vars + 2'
    else:  # CASE ('NEWUOA', 'BOBYQA', 'LINCOA')
        min_maxfun = num_vars + 3
        min_maxfun_str = 'num_vars + 3'
    if maxfun < min_maxfun:
        maxfun = min_maxfun
        warn(f'{solver}: Invalid MAXFUN; it should be at least {min_maxfun_str}; it is set to {maxfun}')

    # Validate MAXHIST
    if maxhist < 0:
        maxhist = maxfun
        warn(f'{solver}: Invalid MAXHIST; it should be a nonnegative integer; it is set to {maxhist}')
    maxhist = min(maxhist, maxfun)  # MAXHIST > MAXFUN is never needed.

    # Validate FTARGET
    if np.isnan(ftarget):
        ftarget = FTARGET_DEFAULT
        warn(f'{solver}: Invalid FTARGET; it should be a real number; it is set to {ftarget}')

    # Validate NPT
    if (solver.lower() == 'newuoa' or solver.lower() == 'bobyqa' or solver.lower() == 'lincoa') and present(npt):
        if (npt < num_vars + 2 or npt > min(maxfun - 1, ((num_vars + 2) * (num_vars + 1)) / 2)):
            npt = int(min(maxfun - 1, 2 * num_vars + 1))
            warn(f'{solver}: Invalid NPT; it should be an integer in the interval [N+2, (N+1)(N+2)/2] and less than MAXFUN; it is set to {npt}')

    # Validate MAXFILT
    if present(maxfilt) and (solver.lower() == 'lincoa' or solver.lower() == 'cobyla'):
        maxfilt_in = maxfilt
        if maxfilt < 1:
            maxfilt = MAXFILT_DEFAULT  # The inputted MAXFILT is obviously wrong.
        else:
            maxfilt = max(MIN_MAXFILT, maxfilt)  # The inputted MAXFILT is too small.
        # Further revise MAXFILT according to MAXHISTMEM.
        if solver.lower() == 'lincoa':
            unit_memo = (num_vars + 2) * np.dtype(float).itemsize
        elif solver.lower() == 'cobyla':
            unit_memo = (num_constraints + num_vars + 2) * np.dtype(float).itemsize
        else:
            unit_memo = 1
        # We cannot simply set MAXFILT = MIN(MAXFILT, MAXHISTMEM/...), as they may not have
        # the same kind, and compilers may complain. We may convert them, but overflow may occur.
        if maxfilt > MAXHISTMEM / unit_memo:
            maxfilt = int(MAXHISTMEM / unit_memo)  # Integer division.
        maxfilt = min(maxfun, max(MIN_MAXFILT, maxfilt))
        if is_constrained:
            if maxfilt_in < 1:
                warn(f'{solver}: Invalid MAXFILT; it should be a positive integer; it is set to  {maxfilt}')
            elif maxfilt_in < min(maxfun, MIN_MAXFILT):
                warn(f'{solver}: MAXFILT is too small; it is set to {maxfilt}')
            elif maxfilt < min(maxfilt_in, maxfun):
                warn(f'{solver}: MAXFILT is set to {maxfilt} due to memory limit')

    # Validate ETA1 and ETA2
    eta1_local = eta1 if present(eta1) else ETA1_DEFAULT
    eta2_local = eta2 if present(eta2) else ETA2_DEFAULT

    # When the difference between ETA1 and ETA2 is tiny, we force them to equal.
    # See the explanation around RHOBEG and RHOEND for the reason.
    if present(eta1) and present(eta2):
        if np.abs(eta1 - eta2) < 1.0E2 * EPS * max(np.abs(eta1), 1):
            eta2 = eta1

    if present(eta1):
        if np.isnan(eta1):
            # In this case, we take the value hard coded in Powell's original code
            # without any warning. It is useful when interfacing with MATLAB/Python.
            eta1 = ETA1_DEFAULT
        elif eta1 < 0 or eta1 >= 1:
            # Take ETA2 into account if it has a valid value.
            if present(eta2) and eta2_local > 0 and eta2_local <= 1:
                eta1 = max(EPS, eta2 / 7.0)
            else:
                eta1 = ETA1_DEFAULT
            warn(f'{solver}: Invalid ETA1; it should be in the interval [0, 1) and not more than ETA2; it is set to {eta1}')

    if present(eta2):
        if np.isnan(eta2):
            # In this case, we take the value hard coded in Powell's original code
            # without any warning. It is useful when interfacing with MATLAB/Python.
            eta2 = ETA2_DEFAULT
        elif present(eta1) and (eta2 < eta1_local or eta2 > 1):
            eta2 = (eta1 + 2) / 3.0
            warn(f'{solver}: Invalid ETA2; it should be in the interval [0, 1) and not less than ETA1; it is set to {eta2}')

    # Validate GAMMA1 and GAMMA2
    if present(gamma1):
        if np.isnan(gamma1):
            # In this case, we take the value hard coded in Powell's original code
            # without any warning. It is useful when interfacing with MATLAB/Python.
            gamma1 = GAMMA1_DEFAULT
        elif gamma1 <= 0 or gamma1 >= 1:
            gamma1 = GAMMA1_DEFAULT
            warn(f'{solver}: Invalid GAMMA1; it should in the interval (0, 1); it is set to {gamma1}')

    if present(gamma2):
        if np.isnan(gamma2):
            # In this case, we take the value hard coded in Powell's original code
            # without any warning. It is useful when interfacing with MATLAB/Python.
            gamma2 = GAMMA2_DEFAULT
        elif gamma2 < 1 or np.isinf(gamma2):
            gamma2 = GAMMA2_DEFAULT
            warn(f'{solver}: Invalid GAMMA2; it should be a real number not less than 1; it is set to {gamma2}')

    # Validate RHOBEG and RHOEND

    if np.abs(rhobeg - rhoend) < 1.0e2 * EPS * np.maximum(np.abs(rhobeg), 1):
        # When the data is passed from the interfaces (e.g., MEX) to the Fortran code, RHOBEG, and RHOEND
        # may change a bit. It was observed in a MATLAB test that MEX passed 1 to Fortran as
        # 0.99999999999999978. Therefore, if we set RHOEND = RHOBEG in the interfaces, then it may happen
        # that RHOEND > RHOBEG, which is considered as an invalid input. To avoid this situation, we
        # force RHOBEG and RHOEND to equal when the difference is tiny.
        rhoend = rhobeg

    # Revise the default values for RHOBEG/RHOEND according to the solver.
    if solver.lower() == 'bobyqa':
        rhobeg_default = np.maximum(EPS, np.min(RHOBEG_DEFAULT, np.min(xu - xl) / 4.0))
        rhoend_default = np.maximum(EPS, np.min(0.1 * rhobeg_default, RHOEND_DEFAULT))
    else:
        rhobeg_default = RHOBEG_DEFAULT
        rhoend_default = RHOEND_DEFAULT

    if solver.lower() == 'bobyqa':
        # Do NOT merge the IF below into the ELIF above! Otherwise, XU and XL may be accessed even if
        # the solver is not BOBYQA, because the logical evaluation is not short-circuit.
        if rhobeg > np.min(xu - xl) / 2:
            # Do NOT make this revision if RHOBEG not positive or not finite, because otherwise RHOBEG
            # will get a huge value when XU or XL contains huge values that indicate unbounded variables.
            rhobeg = np.min(xu - xl) / 4.0  # Here, we do not take RHOBEG_DEFAULT.
            warn(f'{solver}: Invalid RHOBEG; {solver} requires 0 < RHOBEG <= np.min(XU-XL)/2; it is set to np.min(XU-XL)/4')
    if rhobeg <= 0 or np.isnan(rhobeg) or np.isinf(rhobeg):
        # Take RHOEND into account if it has a valid value. We do not do this if the solver is BOBYQA,
        # which requires that RHOBEG <= (XU-XL)/2.
        if np.isfinite(rhoend) and rhoend > 0 and solver.lower() != 'bobyqa':
            rhobeg = max(10 * rhoend, rhobeg_default)
        else:
            rhobeg = rhobeg_default
        warn(f'{solver}: Invalid RHOBEG; it should be a positive number; it is set to {rhobeg}')

    if rhoend <= 0 or rhobeg < rhoend or np.isnan(rhoend) or np.isinf(rhoend):
        rhoend = max(EPS, min(0.1 * rhobeg, rhoend_default))
        warn(f'{solver}: Invalid RHOEND; it should be a positive number and RHOEND <= RHOBEG; it is set to {rhoend}')

    # For BOBYQA, revise X0 or RHOBEG so that the distance between X0 and the inactive bounds is at
    # least RHOBEG. If HONOUR_X0 == TRUE, revise RHOBEG if needed; otherwise, revise HONOUR_X0 if needed.
    if present(honour_x0):
        if honour_x0:
            rhobeg_old = rhobeg;
            lbx = np.isfinite(xl) & (x0 - xl <= EPS * np.maximum(1, np.abs(xl))) # X0 essentially equals XL
            ubx = np.isfinite(xu) & (x0 - xu >= -EPS * np.maximum(1, np.abs(xu))) # X0 essentially equals XU
            x0[lbx] = xl[lbx]
            x0[ubx] = xu[ubx]
            rhobeg = max(EPS, np.min([rhobeg, x0[~lbx] - xl[~lbx], xu[~ubx] - x0[~ubx]]))
            if rhobeg_old - rhobeg > EPS * max(1, rhobeg_old):
                rhoend = max(EPS, min(0.1 * rhobeg, rhoend)) # We do not revise RHOEND unless RHOBEG is truly revised.
                if has_rhobeg:
                    warn(f'{solver}: RHOBEG is revised to {rhobeg} and RHOEND to at most 0.1*RHOBEG so that the distance between X0 and the inactive bounds is at least RHOBEG')
            else:
                rhoend = np.minimum(rhoend, rhobeg)  # This may update RHOEND slightly.
        else:
            x0_old = x0  # Recorded to see whether X0 is really revised.
            # N.B.: The following revision is valid only if XL <= X0 <= XU and RHOBEG <= MINVAL(XU-XL)/2,
            # which should hold at this point due to the revision of RHOBEG and moderation of X0.
            # The cases below are mutually exclusive in precise arithmetic as MINVAL(XU-XL) >= 2*RHOBEG.
            lbx = x0 <= xl + 0.5 * rhobeg
            lbx_plus = (x0 > xl + 0.5 * rhobeg) & (x0 < xl + rhobeg)
            ubx = x0 >= xu - 0.5 * rhobeg
            ubx_minus = (x0 < xu - 0.5 * rhobeg) & (x0 > xu - rhobeg)
            x0[lbx] = xl[lbx]
            x0[lbx_plus] = xl[lbx_plus] + rhobeg
            x0[ubx] = xu[ubx]
            x0[ubx_minus] = xu[ubx_minus] - rhobeg

            if (any(np.abs(x0_old - x0) > 0)):
                warn(f'{solver}: X0 is revised so that the distance between X0 and the inactive bounds is at least RHOBEG set HONOUR_X0 to .TRUE. if you prefer to keep X0 unchanged')

    # Validate CTOL (it can be 0)
    if (present(ctol)):
        if (np.isnan(ctol) or ctol < 0):
            ctol = CTOL_DEFAULT
            if (is_constrained):
                warn(f'{solver}: Invalid CTOL; it should be a nonnegative number; it is set to {ctol}')

    # Validate CWEIGHT (it can be +Inf)
    if (present(cweight)):
        if (np.isnan(cweight) or cweight < 0):
            cweight = CWEIGHT_DEFAULT
            if (is_constrained):
                warn(f'{solver}: Invalid CWEIGHT; it should be a nonnegative number; it is set to {cweight}')

    #====================#
    #  Calculation ends  #
    #====================#

    # Postconditions
    if DEBUGGING:
        assert abs(iprint) <= 3
        assert maxhist >= 0 and maxhist <= maxfun
        if present(npt):
            assert maxfun >= npt + 1
            assert npt >= 3
        if present(maxfilt):
            assert maxfilt >= np.minimum(MIN_MAXFILT, maxfun) and maxfilt <= maxfun
        if present(eta1) and present(eta2):
            assert eta1 >= 0 and eta1 <= eta2 and eta2 < 1
        if present(gamma1) and present(gamma2):
            assert gamma1 > 0 and gamma1 < 1 and gamma2 > 1
        assert rhobeg >= rhoend and rhoend > 0
        if solver.lower() == 'bobyqa':
            assert all(rhobeg <= (xu - xl) / 2)
            assert all(np.isfinite(x0))
            assert all(x0 >= xl and (x0 <= xl or x0 >= xl + rhobeg))
            assert all(x0 <= xu and (x0 >= xu or x0 <= xu - rhobeg))
        if present(ctol):
            assert ctol >= 0

    return iprint, maxfun, maxhist, ftarget, rhobeg, rhoend, npt, maxfilt, ctol, cweight, eta1, eta2, gamma1, gamma2, x0
