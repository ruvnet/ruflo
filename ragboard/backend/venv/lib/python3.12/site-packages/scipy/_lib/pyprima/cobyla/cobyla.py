'''
This module provides Powell's COBYLA algorithm.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.

N.B.:

1. The modern-Fortran reference implementation in PRIMA contains bug fixes and improvements over the
original Fortran 77 implementation by Powell. Consequently, the PRIMA implementation behaves differently
from the original Fortran 77 implementation by Powell. Therefore, it is important to point out that
you are using PRIMA rather than the original solvers if you want your results to be reproducible.

2. Compared to Powell's Fortran 77 implementation, the modern-Fortran implementation and hence any
faithful translation like this one generally produce better solutions with fewer function evaluations,
making them preferable for applications with expensive function evaluations. However, if function
evaluations are not the dominant cost in your application, the Fortran 77 solvers are likely to be
faster, as they are more efficient in terms of memory usage and flops thanks to the careful and
ingenious (but unmaintained and unmaintainable) implementation by Powell.

See the PRIMA documentation (www.libprima.net) for more information.
'''

from ..common.evaluate import evaluate, moderatex, moderatef, moderatec
from ..common.consts import (EPS, RHOBEG_DEFAULT, RHOEND_DEFAULT, CTOL_DEFAULT,
                                   CWEIGHT_DEFAULT, FTARGET_DEFAULT, IPRINT_DEFAULT,
                                   MAXFUN_DIM_DEFAULT, DEBUGGING, BOUNDMAX,
                                   ETA1_DEFAULT, ETA2_DEFAULT, GAMMA1_DEFAULT,
                                   GAMMA2_DEFAULT)
from ..common.preproc import preproc
from ..common.present import present
from ..common.linalg import matprod
from .cobylb import cobylb
import numpy as np
from dataclasses import dataclass
from copy import copy


@dataclass
class COBYLAResult:
    x: np.ndarray
    f: float
    constr: np.ndarray
    cstrv: float
    nf: int
    xhist: np.ndarray | None
    fhist: np.ndarray | None
    chist: np.ndarray | None
    conhist: np.ndarray | None
    info: int


def cobyla(calcfc, m_nlcon, x, Aineq=None, bineq=None, Aeq=None, beq=None,
           xl=None, xu=None, f0=None, nlconstr0=None, rhobeg=None, rhoend=None,
           ftarget=FTARGET_DEFAULT, ctol=CTOL_DEFAULT, cweight=CWEIGHT_DEFAULT,
           maxfun=None, iprint=IPRINT_DEFAULT, eta1=None, eta2=None,
           gamma1=GAMMA1_DEFAULT, gamma2=GAMMA2_DEFAULT, maxhist=None, maxfilt=2000,
           callback=None):
    """
    Among all the arguments, only CALCFC, M_NLCON, and X are obligatory. The others are
    OPTIONAL and you can neglect them unless you are familiar with the algorithm. Any
    unspecified optional input will take the default value detailed below. For
    instance, we may invoke the solver as follows.

    # First define CALCFC, M_NLCON, and X, and then do the following.
    result = cobyla(calcfc, m_nlcon, x)

    or

    # First define CALCFC, M_NLCON, X, Aineq, and Bineq, and then do the following.
    result = cobyla(calcfc, m_nlcon, x, Aineq=Aineq, bineq=bineq, rhobeg=1.0e0,
        rhoend=1.0e-6)

    ####################################################################################
    # IMPORTANT NOTICE: The user must set M_NLCON correctly to the number of nonlinear
    # constraints, namely the size of NLCONSTR introduced below. Set it to 0 if there
    # is no nonlinear constraint.
    ####################################################################################

    See examples/cobyla/cobyla_example.py for a concrete example.

    A detailed introduction to the arguments is as follows.

    ####################################################################################
    # INPUTS
    ####################################################################################

    CALCFC
      Input, function.
      f, nlconstr = CALCFC(X) should evaluate the objective function and nonlinear
      constraints at the given vector X; it should return a tuple consisting of the
      objective function value and the nonlinear constraint value. It must be provided
      by the user, and its definition must conform to the following interface:
      #-------------------------------------------------------------------------#
       def calcfc(x):
           f = 0.0
           nlconstr = np.zeros(m_nlcon)
           return f, nlconstr
      #-------------------------------------------------------------------------#

    M_NLCON
      Input, scalar.
      M_NLCON must be set to the number of nonlinear constraints, namely the size of
      NLCONSTR(X).
      N.B.:
      1. Why don't we define M_NLCON as optional and default it to 0 when it is absent?
      This is because we need to allocate memory for CONSTR_LOC using M_NLCON. To
      ensure that the size of CONSTR_LOC is correct, we require the user to specify
      M_NLCON explicitly.

    X
      Input, vector.
      As an input, X should be an N-dimensional vector that contains the starting
      point, N being the dimension of the problem.

    Aineq, Bineq
      Input, matrix of size [Mineq, N] and vector of size Mineq unless they are both
      empty, default: None and None.
      Aineq and Bineq represent the linear inequality constraints: Aineq*X <= Bineq.

    Aeq, Beq
      Input, matrix of size [Meq, N] and vector of size Meq unless they are both
      empty, default: None and None.
      Aeq and Beq represent the linear equality constraints: Aeq*X = Beq.

    XL, XU
      Input, vectors of size N unless they are both None, default: None and None.
      XL is the lower bound for X. If XL is None, X has no
      lower bound. Any entry of XL that is NaN or below -BOUNDMAX will be taken as
      -BOUNDMAX, which effectively means there is no lower bound for the corresponding
      entry of X. The value of BOUNDMAX is 0.25*HUGE(X), which is about 8.6E37 for
      single precision and 4.5E307 for double precision. XU is similar.

    F0
      Input, scalar.
      F0, if present, should be set to the objective function value of the starting X.

    NLCONSTR0
      Input, vector.
      NLCONSTR0, if present, should be set to the nonlinear constraint value at the
      starting X; in addition, SIZE(NLCONSTR0) must be M_NLCON, or the solver will
      abort.

    RHOBEG, RHOEND
      Inputs, scalars, default: RHOBEG = 1, RHOEND = 10^-6. RHOBEG and RHOEND must be
      set to the initial and final values of a trust-region radius, both being positive
      and RHOEND <= RHOBEG. Typically RHOBEG should be about one tenth of the greatest
      expected change to a variable, and RHOEND should indicate the accuracy that is
      required in the final values of the variables.

    FTARGET
      Input, scalar, default: -Inf.
      FTARGET is the target function value. The algorithm will terminate when a
      feasible point with a function value <= FTARGET is found.

    CTOL
      Input, scalar, default: sqrt(machine epsilon).
      CTOL is the tolerance of constraint violation. X is considered feasible if
      CSTRV(X) <= CTOL.
      N.B.:
        1. CTOL is absolute, not relative.
        2. CTOL is used only when selecting the returned X. It does not affect the
           iterations of the algorithm.

    CWEIGHT
      Input, scalar, default: CWEIGHT_DFT defined in common/consts.py.
      CWEIGHT is the weight that the constraint violation takes in the selection of the
      returned X.

    MAXFUN
      Input, integer scalar, default: MAXFUN_DIM_DFT*N with MAXFUN_DIM_DFT defined in
      common/consts.py. MAXFUN is the maximal number of calls of CALCFC.

    IPRINT
      Input, integer scalar, default: 0.
      The value of IPRINT should be set to 0, 1, -1, 2, -2, 3, or -3, which controls
      how much information will be printed during the computation:
      0: there will be no printing;
      1: a message will be printed to the screen at the return, showing the best vector
         of variables found and its objective function value;
      2: in addition to 1, each new value of RHO is printed to the screen, with the
         best vector of variables so far and its objective function value; each new
         value of CPEN is also printed;
      3: in addition to 2, each function evaluation with its variables will be printed
         to the screen; -1, -2, -3: the same information as 1, 2, 3 will be printed,
         not to the screen but to a file named COBYLA_output.txt; the file will be
         created if it does not exist; the new output will be appended to the end of
         this file if it already exists.
      Note that IPRINT = +/-3 can be costly in terms of time and/or space.

    ETA1, ETA2, GAMMA1, GAMMA2
      Input, scalars, default: ETA1 = 0.1, ETA2 = 0.7, GAMMA1 = 0.5, and GAMMA2 = 2.
      ETA1, ETA2, GAMMA1, and GAMMA2 are parameters in the updating scheme of the
      trust-region radius detailed in the subroutine TRRAD in trustregion.py. Roughly
      speaking, the trust-region radius is contracted by a factor of GAMMA1 when the
      reduction ratio is below ETA1, and enlarged by a factor of GAMMA2 when the
      reduction ratio is above ETA2. It is required that 0 < ETA1 <= ETA2 < 1 and
      0 < GAMMA1 < 1 < GAMMA2. Normally, ETA1 <= 0.25. It is NOT advised to set
      ETA1 >= 0.5.

    MAXFILT
      Input, scalar.
      MAXFILT is a nonnegative integer indicating the maximal length of the filter used
      for selecting the returned solution; default: MAXFILT_DFT (a value lower than
      MIN_MAXFILT is not recommended);
      see common/consts.py for the definitions of MAXFILT_DFT and MIN_MAXFILT.

    CALLBACK
      Input, function to report progress and optionally request termination.


    ####################################################################################
    # OUTPUTS
    ####################################################################################

    The output is a single data structure, COBYLAResult, with the following fields:

    X
      Output, vector.
      As an output, X will be set to an approximate minimizer.

    F
      Output, scalar.
      F will be set to the objective function value of X at exit.

    CONSTR
      Output, vector.
      CONSTR will be set to the constraint value of X at exit.

    CSTRV
      Output, scalar.
      CSTRV will be set to the constraint violation of X at exit, i.e.,
      max([0, XL - X, X - XU, Aineq*X - Bineq, ABS(Aeq*X -Beq), NLCONSTR(X)]).

    NF
      Output, scalar.
      NF will be set to the number of calls of CALCFC at exit.

    XHIST, FHIST, CHIST, CONHIST, MAXHIST
      XHIST: Output, rank 2 array;
      FHIST: Output, rank 1 array;
      CHIST: Output, rank 1 array;
      CONHIST: Output, rank 2 array;
      MAXHIST: Input, scalar, default: MAXFUN
      XHIST, if present, will output the history of iterates; FHIST, if present, will
      output the history function values; CHIST, if present, will output the history of
      constraint violations; CONHIST, if present, will output the history of constraint
      values; MAXHIST should be a nonnegative integer, and XHIST/FHIST/CHIST/CONHIST
      will output only the history of the last MAXHIST iterations.
      Therefore, MAXHIST= 0 means XHIST/FHIST/CONHIST/CHIST will output
      nothing, while setting MAXHIST = MAXFUN requests XHIST/FHIST/CHIST/CONHIST to
      output all the history. If XHIST is present, its size at exit will be
      (N, min(NF, MAXHIST)); if FHIST is present, its size at exit will be
      min(NF, MAXHIST); if CHIST is present, its size at exit will be min(NF, MAXHIST);
      if CONHIST is present, its size at exit will be (M, min(NF, MAXHIST)).

      IMPORTANT NOTICE:
      Setting MAXHIST to a large value can be costly in terms of memory for large
      problems.
      MAXHIST will be reset to a smaller value if the memory needed exceeds MAXHISTMEM
      defined in common/consts.py
      Use *HIST with caution!!! (N.B.: the algorithm is NOT designed for large
      problems).

    INFO
      Output, scalar.
      INFO is the exit flag. It will be set to one of the following values defined in
      common/infos.py:
      SMALL_TR_RADIUS: the lower bound for the trust region radius is reached;
      FTARGET_ACHIEVED: the target function value is reached;
      MAXFUN_REACHED: the objective function has been evaluated MAXFUN times;
      MAXTR_REACHED: the trust region iteration has been performed MAXTR times (MAXTR = 2*MAXFUN);
      NAN_INF_X: NaN or Inf occurs in X;
      DAMAGING_ROUNDING: rounding errors are becoming damaging.
      #--------------------------------------------------------------------------#
      The following case(s) should NEVER occur unless there is a bug.
      NAN_INF_F: the objective function returns NaN or +Inf;
      NAN_INF_MODEL: NaN or Inf occurs in the model;
      TRSUBP_FAILED: a trust region step failed to reduce the model
      #--------------------------------------------------------------------------#
    """

    # Local variables
    solver = "COBYLA"
    srname = "COBYLA"

    # Sizes
    mineq = len(bineq) if present(bineq) else 0
    meq = len(beq) if present(beq) else 0
    mxl = sum(xl > -BOUNDMAX) if present(xl) else 0
    mxu = sum(xu < BOUNDMAX) if present(xu) else 0
    mmm = mxu + mxl + 2*meq + mineq + m_nlcon
    num_vars = len(x)

    # Preconditions
    if DEBUGGING:
        assert m_nlcon >= 0, f'{srname} M_NLCON >= 0'
        assert num_vars >= 1, f'{srname} N >= 1'

        assert present(Aineq) == present(bineq), \
            f'{srname} Aineq and Bineq are both present or both absent'
        if (present(Aineq)):
            assert Aineq.shape == (mineq, num_vars), f'{srname} SIZE(Aineq) == [Mineq, N]'

        assert present(Aeq) == present(beq), \
            f'{srname} Aeq and Beq are both present or both absent'
        if (present(Aeq)):
            assert Aeq.shape == (meq, num_vars), f'{srname} SIZE(Aeq) == [Meq, N]'

        if (present(xl)):
            assert len(xl) == num_vars, f'{srname} SIZE(XL) == N'
        if (present(xu)):
            assert len(xu) == num_vars, f'{srname} SIZE(XU) == N'


        # N.B.: If NLCONSTR0 is present, then F0 must be present, and we assume that
        # F(X0) = F0 even if F0 is NaN; if NLCONSTR0 is absent, then F0 must be either
        # absent or NaN, both of which will be interpreted as F(X0) is not provided.
        if present(nlconstr0):
            assert present(f0), f'{srname} If NLCONSTR0 is present, then F0 is present'
        if present(f0):
            assert np.isnan(f0) or present(nlconstr0), \
                f'{srname} If F0 is present and not NaN, then NLCONSTR0 is present'



    # Exit if the size of NLCONSTR0 is inconsistent with M_NLCON.
    if present(nlconstr0):
        assert np.size(nlconstr0) == m_nlcon

    # Read the inputs.

    if xl is not None:
      xl = copy(xl)
      xl[np.isnan(xl)] = -BOUNDMAX
      xl[xl < -BOUNDMAX] = -BOUNDMAX

    if xu is not None:
      xu = copy(xu)
      xu[np.isnan(xu)] = BOUNDMAX
      xu[xu > BOUNDMAX] = BOUNDMAX

    # Wrap the linear and bound constraints into a single constraint: AMAT@X <= BVEC.
    amat, bvec = get_lincon(Aeq, Aineq, beq, bineq, xl, xu)

    # Create constraint vector
    constr = np.zeros(mmm)

    # Set [F_LOC, CONSTR_LOC] to [F(X0), CONSTR(X0)] after evaluating the latter if
    # needed. In this way, COBYLB only needs one interface.
    # N.B.: Due to the preconditions above, there are two possibilities for F0 and
    # NLCONSTR0.
    # If NLCONSTR0 is present, then F0 must be present, and we assume that F(X0) = F0
    # even if F0 is NaN.
    # If NLCONSTR0 is absent, then F0 must be either absent or NaN, both of which will
    # be interpreted as F(X0) is not provided and we have to evaluate F(X0) and
    # NLCONSTR(X0) now.
    if (present(f0) and present(nlconstr0) and all(np.isfinite(x))):
        f = moderatef(f0)
        if amat is not None:
          constr[:mmm - m_nlcon] = moderatec(matprod(amat, x) - bvec)
        constr[mmm - m_nlcon:] = moderatec(nlconstr0)
    else:
        x = moderatex(x)
        f, constr = evaluate(calcfc, x, m_nlcon, amat, bvec)
        constr[:mmm - m_nlcon] = moderatec(constr[:mmm - m_nlcon])
        # N.B.: Do NOT call FMSG, SAVEHIST, or SAVEFILT for the function/constraint evaluation at X0.
        # They will be called during the initialization, which will read the function/constraint at X0.
    cstrv = max(np.append(0, constr))


    # If RHOBEG is present, use it; otherwise, RHOBEG takes the default value for
    # RHOBEG, taking the value of RHOEND into account. Note that RHOEND is considered
    # only if it is present and it is VALID (i.e., finite and positive). The other
    # inputs are read similarly.
    if present(rhobeg):
        rhobeg = rhobeg
    elif present(rhoend) and np.isfinite(rhoend) and rhoend > 0:
        rhobeg = max(10 * rhoend, RHOBEG_DEFAULT)
    else:
        rhobeg = RHOBEG_DEFAULT

    if present(rhoend):
        rhoend = rhoend
    elif rhobeg > 0:
        rhoend = max(EPS, min(RHOEND_DEFAULT/RHOBEG_DEFAULT * rhobeg, RHOEND_DEFAULT))
    else:
        rhoend = RHOEND_DEFAULT

    maxfun = maxfun if present(maxfun) else MAXFUN_DIM_DEFAULT * num_vars

    if present(eta1):
        eta1 = eta1
    elif present(eta2) and 0 < eta2 < 1:
        eta1 = max(EPS, eta2 / 7)
    else:
        eta1 = ETA1_DEFAULT

    if present(eta2):
        eta2 = eta2
    elif 0 < eta1 < 1:
        eta2 = (eta1 + 2) / 3
    else:
        eta2 = ETA2_DEFAULT

    maxhist = (
        maxhist
        if present(maxhist)
        else max(maxfun, num_vars + 2, MAXFUN_DIM_DEFAULT * num_vars)
    )

    # Preprocess the inputs in case some of them are invalid. It does nothing if all
    # inputs are valid.
    (
        iprint,
        maxfun,
        maxhist,
        ftarget,
        rhobeg,
        rhoend,
        npt,  # Unused in COBYLA
        maxfilt,
        ctol,
        cweight,
        eta1,
        eta2,
        gamma1,
        gamma2,
        _x0,  # Unused in COBYLA
    ) = preproc(
        solver,
        num_vars,
        iprint,
        maxfun,
        maxhist,
        ftarget,
        rhobeg,
        rhoend,
        num_constraints=mmm,
        maxfilt=maxfilt,
        ctol=ctol,
        cweight=cweight,
        eta1=eta1,
        eta2=eta2,
        gamma1=gamma1,
        gamma2=gamma2,
        is_constrained=(mmm > 0),
    )

    # Further revise MAXHIST according to MAXHISTMEM, and allocate memory for the history.
    # In MATLAB/Python/Julia/R implementation, we should simply set MAXHIST = MAXFUN and initialize
    # CHIST = NaN(1, MAXFUN), CONHIST = NaN(M, MAXFUN), FHIST = NaN(1, MAXFUN), XHIST = NaN(N, MAXFUN)
    # if they are requested; replace MAXFUN with 0 for the history that is not requested.
    # prehist(maxhist, num_vars, present(xhist), xhist_loc, present(fhist), fhist_loc, &
    #     & present(chist), chist_loc, m, present(conhist), conhist_loc)

    # call cobylb, which performs the real calculations
    x, f, constr, cstrv, nf, xhist, fhist, chist, conhist, info = cobylb(
        calcfc,
        iprint,
        maxfilt,
        maxfun,
        amat,
        bvec,
        ctol,
        cweight,
        eta1,
        eta2,
        ftarget,
        gamma1,
        gamma2,
        rhobeg,
        rhoend,
        constr,
        f,
        x,
        maxhist,
        callback
    )

    return COBYLAResult(x, f, constr, cstrv, nf, xhist, fhist, chist, conhist, info)


def get_lincon(Aeq=None, Aineq=None, beq=None, bineq=None, xl=None, xu=None):
    """
    This subroutine wraps the linear and bound constraints into a single constraint:
        AMAT*X <= BVEC.

    N.B.:

    LINCOA normalizes the linear constraints so that each constraint has a gradient
    of norm 1. However, COBYLA does not do this.
    """

    # Sizes
    if Aeq is not None:
        num_vars = Aeq.shape[1]
    elif Aineq is not None:
        num_vars = Aineq.shape[1]
    elif xl is not None:
        num_vars = len(xl)
    elif xu is not None:
        num_vars = len(xu)
    else:
        return None, None

    # Preconditions
    if DEBUGGING:
        assert Aineq is None or Aineq.shape == (len(bineq), num_vars)
        assert Aeq is None or Aeq.shape == (len(beq), num_vars)
        assert (xl is None or xu is None) or len(xl) == len(xu) == num_vars

    #====================#
    # Calculation starts #
    #====================#

    # Define the indices of the nontrivial bound constraints.
    ixl = np.where(xl > -BOUNDMAX)[0] if xl is not None else None
    ixu = np.where(xu < BOUNDMAX)[0] if xu is not None else None

    # Wrap the linear constraints.
    # The bound constraint XL <= X <= XU is handled as two constraints:
    # -X <= -XL, X <= XU.
    # The equality constraint Aeq*X = Beq is handled as two constraints:
    # -Aeq*X <= -Beq, Aeq*X <= Beq.
    # N.B.:
    # 1. The treatment of the equality constraints is naive. One may choose to
    #    eliminate them instead.
    idmat = np.eye(num_vars)
    amat = np.vstack([
        -idmat[ixl, :] if ixl is not None else np.empty((0, num_vars)),
        idmat[ixu, :] if ixu is not None else np.empty((0, num_vars)),
        -Aeq if Aeq is not None else np.empty((0, num_vars)),
        Aeq if Aeq is not None else np.empty((0, num_vars)),
        Aineq if Aineq is not None else np.empty((0, num_vars))
    ])
    bvec = np.hstack([
        -xl[ixl] if ixl is not None else np.empty(0),
        xu[ixu] if ixu is not None else np.empty(0),
        -beq if beq is not None else np.empty(0),
        beq if beq is not None else np.empty(0),
        bineq if bineq is not None else np.empty(0)
    ])

    amat = amat if amat.shape[0] > 0 else None
    bvec = bvec if bvec.shape[0] > 0 else None

    #==================#
    # Calculation ends #
    #==================#

    # Postconditions
    if DEBUGGING:
        assert (amat is None and bvec is None) or amat.shape == (len(bvec), num_vars)

    return amat, bvec
