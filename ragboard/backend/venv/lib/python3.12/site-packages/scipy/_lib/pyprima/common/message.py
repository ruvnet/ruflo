'''
This module provides some functions that print messages to terminal/files.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.

N.B.:
1. In case parallelism is desirable (especially during initialization), the functions may
have to be modified or disabled due to the IO operations.
2. IPRINT indicates the level of verbosity, which increases with the absolute value of IPRINT.
IPRINT = +/-3 can be expensive due to high IO operations.
'''

from .consts import DEBUGGING
from .infos import FTARGET_ACHIEVED, MAXFUN_REACHED, MAXTR_REACHED, \
    SMALL_TR_RADIUS, TRSUBP_FAILED, NAN_INF_F, NAN_INF_X, NAN_INF_MODEL, DAMAGING_ROUNDING, \
    NO_SPACE_BETWEEN_BOUNDS, ZERO_LINEAR_CONSTRAINT, CALLBACK_TERMINATE
from .present import present
import numpy as np

spaces = '   '


def get_info_string(solver, info):
    if info == FTARGET_ACHIEVED:
        reason = 'the target function value is achieved.'
    elif info == MAXFUN_REACHED:
        reason = 'the objective function has been evaluated MAXFUN times.'
    elif info == MAXTR_REACHED:
        reason = 'the maximal number of trust region iterations has been reached.'
    elif info == SMALL_TR_RADIUS:
        reason = 'the trust region radius reaches its lower bound.'
    elif info == TRSUBP_FAILED:
        reason = 'a trust region step has failed to reduce the quadratic model.'
    elif info == NAN_INF_X:
        reason = 'NaN or Inf occurs in x.'
    elif info == NAN_INF_F:
        reason = 'the objective function returns NaN/+Inf.'
    elif info == NAN_INF_MODEL:
        reason = 'NaN or Inf occurs in the models.'
    elif info == DAMAGING_ROUNDING:
        reason = 'rounding errors are becoming damaging.'
    elif info == NO_SPACE_BETWEEN_BOUNDS:
        reason = 'there is no space between the lower and upper bounds of variable.'
    elif info == ZERO_LINEAR_CONSTRAINT:
        reason = 'one of the linear constraints has a zero gradient'
    elif info == CALLBACK_TERMINATE:
        reason = 'the callback function requested termination'
    else:
        reason = 'UNKNOWN EXIT FLAG'
    ret_message = f'Return from {solver} because {reason.strip()}'
    return ret_message


def retmsg(solver, info, iprint, nf, f, x, cstrv=None, constr=None):
    '''
    This function prints messages at return.
    '''
    # Local variables
    valid_exit_codes = [FTARGET_ACHIEVED, MAXFUN_REACHED, MAXTR_REACHED,
        SMALL_TR_RADIUS, TRSUBP_FAILED, NAN_INF_F, NAN_INF_X, NAN_INF_MODEL, DAMAGING_ROUNDING,
        NO_SPACE_BETWEEN_BOUNDS, ZERO_LINEAR_CONSTRAINT, CALLBACK_TERMINATE]

    # Preconditions
    if DEBUGGING:
        assert info in valid_exit_codes

    #====================#
    # Calculation starts #
    #====================#

    if abs(iprint) < 1:  # No printing (iprint == 0)
        return
    elif iprint > 0:  # Print the message to the standard out.
        fname = ''
    else:  # Print the message to a file named FNAME.
        fname = f'{solver}_output.txt'

    # Decide whether the problem is truly constrained.
    if present(constr):
        is_constrained = (np.size(constr) > 0)
    else:
        is_constrained = present(cstrv)

    # Decide the constraint violation.
    if present(cstrv):
        cstrv_loc = cstrv
    elif present(constr):
        cstrv_loc = np.max(np.append(0, -constr))  # N.B.: We assume that the constraint is CONSTR >= 0.
    else:
        cstrv_loc = 0

    # Decide the return message.
    ret_message = get_info_string(solver, info)

    if np.size(x) <= 2:
        x_message = f'\nThe corresponding X is: {x}'  # Printed in one line
    else:
        x_message = f'\nThe corresponding X is:\n{x}'

    if is_constrained:
        nf_message = (f'\nNumber of function values = {nf}{spaces}'
            f'Least value of F = {f}{spaces}Constraint violation = {cstrv_loc}')
    else:
        nf_message = f'\nNumber of function values = {nf}{spaces}Least value of F = {f}'

    if is_constrained and present(constr):
        if np.size(constr) <= 2:
            constr_message = f'\nThe constraint value is: {constr}'  # Printed in one line
        else:
            constr_message = f'\nThe constraint value is:\n{constr}'
    else:
        constr_message = ''

    # Print the message.
    if abs(iprint) >= 2:
        message = f'\n{ret_message}{nf_message}{x_message}{constr_message}\n'
    else:
        message = f'{ret_message}{nf_message}{x_message}{constr_message}\n'
    if len(fname) > 0:
        with open(fname, 'a') as f: f.write(message)
    else:
        print(message)


def rhomsg(solver, iprint, nf, delta, f, rho, x, cstrv=None, constr=None, cpen=None):
    '''
    This function prints messages when RHO is updated.
    '''

    #====================#
    # Calculation starts #
    #====================#

    if abs(iprint) < 2:  # No printing
        return
    elif iprint > 0:  # Print the message to the standard out.
        fname = ''
    else:  # Print the message to a file named FNAME.
        fname = f'{solver.strip()}_output.txt'

    # Decide whether the problem is truly constrained.
    if present(constr):
        is_constrained = (np.size(constr) > 0)
    else:
        is_constrained = present(cstrv)

    # Decide the constraint violation.
    if present(cstrv):
        cstrv_loc = cstrv
    elif present(constr):
        cstrv_loc = np.max(np.append(0, -constr))  # N.B.: We assume that the constraint is CONSTR >= 0.
    else:
        cstrv_loc = 0

    if present(cpen):
        rho_message = (f'\nNew RHO = {rho}{spaces}Delta = {delta}{spaces}'
            f'CPEN = {cpen}')
    else:
        rho_message = f'\nNew RHO = {rho}{spaces}Delta = {delta}'

    if np.size(x) <= 2:
        x_message = f'\nThe corresponding X is: {x}'  # Printed in one line
    else:
        x_message = f'\nThe corresponding X is:\n{x}'

    if is_constrained:
        nf_message = (f'\nNumber of function values = {nf}{spaces}'
            f'Least value of F = {f}{spaces}Constraint violation = {cstrv_loc}')
    else:
        nf_message = f'\nNumber of function values = {nf}{spaces}Least value of F = {f}'

    if is_constrained and present(constr):
        if np.size(constr) <= 2:
            constr_message = f'\nThe constraint value is: {constr}'  # Printed in one line
        else:
            constr_message = f'\nThe constraint value is:\n{constr}'
    else:
        constr_message = ''

    # Print the message.
    if abs(iprint) >= 3:
        message = f'\n{rho_message}{nf_message}{x_message}{constr_message}'
    else:
        message = f'{rho_message}{nf_message}{x_message}{constr_message}'
    if len(fname) > 0:
        with open(fname, 'a') as f: f.write(message)
    else:
        print(message)

    #====================#
    #  Calculation ends  #
    #====================#


def cpenmsg(solver, iprint, cpen):
    '''
    This function prints a message when CPEN is updated.
    '''

    #====================#
    # Calculation starts #
    #====================#

    if abs(iprint) < 2:  # No printing
        return
    elif iprint > 0:  # Print the message to the standard out.
        fname = ''
    else:  # Print the message to a file named FNAME.
        fname = f'{solver.strip()}_output.txt'

    # Print the message.
    if abs(iprint) >= 3:
        message = f'\nSet CPEN to {cpen}'
    else:
        message = f'\n\nSet CPEN to {cpen}'
    if len(fname) > 0:
        with open(fname, 'a') as f: f.write(message)
    else:
        print(message)

    #====================#
    #  Calculation ends  #
    #====================#


def fmsg(solver, state, iprint, nf, delta, f, x, cstrv=None, constr=None):
    '''
    This subroutine prints messages for each evaluation of the objective function.
    '''

    #====================#
    # Calculation starts #
    #====================#

    if abs(iprint) < 2:  # No printing
        return
    elif iprint > 0:  # Print the message to the standard out.
        fname = ''
    else:  # Print the message to a file named FNAME.
        fname = f'{solver.strip()}_output.txt'

    # Decide whether the problem is truly constrained.
    if present(constr):
        is_constrained = (np.size(constr) > 0)
    else:
        is_constrained = present(cstrv)

    # Decide the constraint violation.
    if present(cstrv):
        cstrv_loc = cstrv
    elif present(constr):
        cstrv_loc = np.max(np.append(0, -constr))  # N.B.: We assume that the constraint is CONSTR >= 0.
    else:
        cstrv_loc = 0

    delta_message = f'\n{state} step with radius = {delta}'

    if is_constrained:
        nf_message = (f'\nNumber of function values = {nf}{spaces}'
            f'Least value of F = {f}{spaces}Constraint violation = {cstrv_loc}')
    else:
        nf_message = f'\nNumber of function values = {nf}{spaces}Least value of F = {f}'

    if np.size(x) <= 2:
        x_message = f'\nThe corresponding X is: {x}'  # Printed in one line
    else:
        x_message = f'\nThe corresponding X is:\n{x}'

    if is_constrained and present(constr):
        if np.size(constr) <= 2:
            constr_message = f'\nThe constraint value is: {constr}'  # Printed in one line
        else:
            constr_message = f'\nThe constraint value is:\n{constr}'
    else:
        constr_message = ''

    # Print the message.
    message = f'{delta_message}{nf_message}{x_message}{constr_message}'
    if len(fname) > 0:
        with open(fname, 'a') as f: f.write(message)
    else:
        print(message)

    #====================#
    #  Calculation ends  #
    #====================#
