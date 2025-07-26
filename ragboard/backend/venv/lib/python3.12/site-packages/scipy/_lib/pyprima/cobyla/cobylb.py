'''
This module performs the major calculations of COBYLA.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

import numpy as np
from ..common.checkbreak import checkbreak_con
from ..common.consts import REALMAX, EPS, DEBUGGING, MIN_MAXFILT
from ..common.infos import INFO_DEFAULT, MAXTR_REACHED, DAMAGING_ROUNDING, \
                    SMALL_TR_RADIUS, CALLBACK_TERMINATE
from ..common.evaluate import evaluate
from ..common.history import savehist
from ..common.linalg import isinv, matprod, inprod, norm, primasum, primapow2
from ..common.message import fmsg, retmsg, rhomsg
from ..common.ratio import redrat
from ..common.redrho import redrho
from ..common.selectx import savefilt, selectx
from .update import updatepole, findpole, updatexfc
from .geometry import setdrop_tr, geostep
from .trustregion import trstlp, trrad
from .initialize import initxfc, initfilt


def cobylb(calcfc, iprint, maxfilt, maxfun, amat, bvec, ctol, cweight, eta1, eta2,
           ftarget, gamma1, gamma2, rhobeg, rhoend, constr, f, x, maxhist, callback):
    '''
    This subroutine performs the actual computations of COBYLA.
    '''

    # Outputs
    xhist = []
    fhist = []
    chist = []
    conhist = []

    # Local variables
    solver = 'COBYLA'
    A = np.zeros((np.size(x), np.size(constr))) # A contains the approximate gradient for the constraints
    distsq = np.zeros(np.size(x) + 1)
    # CPENMIN is the minimum of the penalty parameter CPEN for the L-infinity
    # constraint violation in the merit function. Note that CPENMIN = 0 in Powell's
    # implementation, which allows CPEN to be 0. Here, we take CPENMIN > 0 so that CPEN
    # is always positive. This avoids the situation where PREREM becomes 0 when
    # PREREF = 0 = CPEN. It brings two advantages as follows.
    # 1. If the trust-region subproblem solver works correctly and the trust-region
    #    center is not optimal for the subproblem, then PREREM > 0 is guaranteed. This
    #    is because, in theory, PREREC >= 0 and MAX(PREREC, PREREF) > 0, and the
    #    definition of CPEN in GETCPEN ensures that PREREM > 0.
    # 2. There is no need to revise ACTREM and PREREM when CPEN = 0 and F = FVAL(N+1)
    #    as in lines 312--314 of Powell's cobylb.f code. Powell's code revises ACTREM
    #    to CVAL(N + 1) - CSTRV and PREREM to PREREC in this case, which is crucial for
    #    feasibility problems.
    cpenmin = EPS

    # Sizes
    m_lcon = np.size(bvec) if bvec is not None else 0
    num_constraints = np.size(constr)
    m_nlcon = num_constraints - m_lcon
    num_vars = np.size(x)

    # Preconditions
    if DEBUGGING:
        assert abs(iprint) <= 3
        assert num_constraints >= m_lcon and m_lcon >= 0
        assert num_vars >= 1
        assert maxfun >= num_vars + 2
        assert rhobeg >= rhoend and rhoend > 0
        assert all(np.isfinite(x))
        assert 0 <= eta1 <= eta2 < 1
        assert 0 < gamma1 < 1 < gamma2
        assert 0 <= ctol
        assert 0 <= cweight
        assert 0 <= maxhist <= maxfun
        assert amat is None or np.shape(amat) == (m_lcon, num_vars)
        assert min(MIN_MAXFILT, maxfun) <= maxfilt <= maxfun

    #====================#
    # Calculation starts #
    #====================#

    # Initialize SIM, FVAL, CONMAT, and CVAL, together with the history.
    # After the initialization, SIM[:, NUM_VARS] holds the vertex of the initial
    # simplex with the smallest function value (regardless of the constraint
    # violation), and SIM[:, :NUM_VARS] holds the displacements from the other vertices
    # to SIM[:, NUM_VARS]. FVAL, CONMAT, and CVAL hold the function values, constraint
    # values, and constraint violations on the vertices in the order corresponding to
    # SIM.
    evaluated, conmat, cval, sim, simi, fval, nf, subinfo = initxfc(calcfc, iprint,
      maxfun, constr, amat, bvec, ctol, f, ftarget, rhobeg, x,
      xhist, fhist, chist, conhist, maxhist)

    # Initialize the filter, including xfilt, ffilt, confilt, cfilt, and nfilt.
    # N.B.: The filter is used only when selecting which iterate to return. It does not
    # interfere with the iterations. COBYLA is NOT a filter method but a trust-region
    # method based on an L-infinity merit function. Powell's implementation does not
    # use a filter to select the iterate, possibly returning a suboptimal iterate.
    cfilt = np.zeros(np.minimum(np.maximum(maxfilt, 1), maxfun))
    confilt = np.zeros((np.size(constr), np.size(cfilt)))
    ffilt = np.zeros(np.size(cfilt))
    xfilt = np.zeros((np.size(x), np.size(cfilt)))
    nfilt = initfilt(conmat, ctol, cweight, cval, fval, sim, evaluated, cfilt, confilt,
                     ffilt, xfilt)

    # Check whether to return due to abnormal cases that may occur during the initialization.
    if subinfo != INFO_DEFAULT:
        info = subinfo
        # Return the best calculated values of the variables
        # N.B: Selectx and findpole choose X by different standards, one cannot replace the other
        kopt = selectx(ffilt[:nfilt], cfilt[:nfilt], cweight, ctol)
        x = xfilt[:, kopt]
        f = ffilt[kopt]
        constr = confilt[:, kopt]
        cstrv = cfilt[kopt]
        # print a return message according to IPRINT.
        retmsg(solver, info, iprint, nf, f, x, cstrv, constr)
        # Postconditions
        if DEBUGGING:
            assert nf <= maxfun
            assert np.size(x) == num_vars and not any(np.isnan(x))
            assert not (np.isnan(f) or np.isposinf(f))
            # assert np.size(xhist, 0) == n and np.size(xhist, 1) == maxxhist
            # assert not any(np.isnan(xhist(:, 1:min(nf, maxxhist))))
            # The last calculated X can be Inf (finite + finite can be Inf numerically).
            # assert np.size(fhist) == maxfhist
            # assert not any(np.isnan(fhist(1:min(nf, maxfhist))) or np.isposinf(fhist(1:min(nf, maxfhist))))
            # assert np.size(conhist, 0) == m and np.size(conhist, 1) == maxconhist
            # assert not any(np.isnan(conhist(:, 1:min(nf, maxconhist))) or np.isneginf(conhist(:, 1:min(nf, maxconhist))))
            # assert np.size(chist) == maxchist
            # assert not any(chist(1:min(nf, maxchist)) < 0 or np.isnan(chist(1:min(nf, maxchist))) or np.isposinf(chist(1:min(nf, maxchist))))
            # nhist = minval([nf, maxfhist, maxchist])
            # assert not any(isbetter(fhist(1:nhist), chist(1:nhist), f, cstrv, ctol))
        return x, f, constr, cstrv, nf, xhist, fhist, chist, conhist, info


    # Set some more initial values.
    # We must initialize shortd, ratio, and jdrop_tr because these get defined on
    # branches that are not guaranteed to be executed, but their values are used later.
    # Our initialization of CPEN differs from Powell's in two ways. First, we use the
    # ratio defined in (13) of Powell's COBYLA paper to initialize CPEN. Second, we
    # impose CPEN >= CPENMIN > 0. Powell's code simply initializes CPEN to 0.
    rho = rhobeg
    delta = rhobeg
    cpen = np.maximum(cpenmin, np.minimum(1.0E3, fcratio(conmat, fval)))  # Powell's code: CPEN = ZERO
    shortd = False
    ratio = -1
    jdrop_tr = 0

    # If DELTA <= GAMMA3*RHO after an update, we set DELTA to RHO. GAMMA3 must be less
    # than GAMMA2. The reason is as follows. Imagine a very successful step with
    # DNORM = the un-updated DELTA = RHO. The TRRAD will update DELTA to GAMMA2*RHO.
    # If GAMMA3 >= GAMMA2, then DELTA will be reset to RHO, which is not reasonable as
    # D is very successful. See paragraph two of Sec 5.2.5 in T. M. Ragonneau's thesis:
    # "Model-Based Derivative-Free Optimization Methods and Software." According to
    # test on 20230613, for COBYLA, this Powellful updating scheme of DELTA works
    # slightly better than setting directly DELTA = max(NEW_DELTA, RHO).
    gamma3 = np.maximum(1, np.minimum(0.75 * gamma2, 1.5))

    # MAXTR is the maximal number of trust region iterations. Each trust-region
    # iteration takes 1 or 2 function evaluations unless the trust-region step is short
    # or the trust-region subproblem solver fails but the geometry step is not invoked.
    # Thus the following MAXTR is unlikely to be reached.
    maxtr = 10 * maxfun
    info = MAXTR_REACHED

    # Begin the iterative procedure
    # After solving a trust-region subproblem, we use three boolean variables to
    # control the workflow.
    # SHORTD - Is the trust-region trial step too short to invoke # a function
    #          evaluation?
    # IMPROVE_GEO - Will we improve the model after the trust-region iteration? If yes,
    #               a geometry step will be taken, corresponding to the "Branch (Delta)"
    #               in the COBYLA paper.
    # REDUCE_RHO - Will we reduce rho after the trust-region iteration?
    # COBYLA never sets IMPROVE_GEO and REDUCE_RHO to True simultaneously.
    for tr in range(maxtr):
        # Increase the penalty parameter CPEN, if needed, so that
        # PREREM = PREREF + CPEN * PREREC > 0.
        # This is the first (out of two) update of CPEN, where CPEN increases or
        # remains the same.
        # N.B.: CPEN and the merit function PHI = FVAL + CPEN*CVAL are used in three
        # places only.
        # 1. In FINDPOLE/UPDATEPOLE, deciding the optimal vertex of the current simplex.
        # 2. After the trust-region trial step, calculating the reduction ratio.
        # 3. In GEOSTEP, deciding the direction of the geometry step.
        # They do not appear explicitly in the trust-region subproblem, though the
        # trust-region center (i.e. the current optimal vertex) is defined by them.
        cpen = getcpen(amat, bvec, conmat, cpen, cval, delta, fval, rho, sim, simi)

        # Switch the best vertex of the current simplex to SIM[:, NUM_VARS].
        conmat, cval, fval, sim, simi, subinfo = updatepole(cpen, conmat, cval, fval,
                                                            sim, simi)
        # Check whether to exit due to damaging rounding in UPDATEPOLE.
        if subinfo == DAMAGING_ROUNDING:
            info = subinfo
            break  # Better action to take? Geometry step, or simply continue?

        # Does the interpolation set have adequate geometry? It affects improve_geo and
        # reduce_rho.
        adequate_geo = all(primasum(primapow2(sim[:, :num_vars]), axis=0) <= 4 * primapow2(delta))

        # Calculate the linear approximations to the objective and constraint functions.
        # N.B.: TRSTLP accesses A mostly by columns, so it is more reasonable to save A
        # instead of A^T.
        # Zaikun 2023108: According to a test on 2023108, calculating G and
        # A(:, M_LCON+1:M) by solving the linear systems SIM^T*G = FVAL(1:N)-FVAL(N+1)
        # and SIM^T*A = CONMAT(:, 1:N)-CONMAT(:, N+1) does not seem to improve or worsen
        # the performance of COBYLA in terms of the number of function evaluations. The
        # system was solved by SOLVE in LINALG_MOD based on a QR factorization of SIM
        # (not necessarily a good algorithm). No preconditioning or scaling was used.
        g = matprod((fval[:num_vars] - fval[num_vars]), simi)
        A[:, :m_lcon] = amat.T if amat is not None else amat
        A[:, m_lcon:] = matprod((conmat[m_lcon:, :num_vars] -
                          np.tile(conmat[m_lcon:, num_vars], (num_vars, 1)).T), simi).T

        # Calculate the trust-region trial step d. Note that d does NOT depend on cpen.
        d = trstlp(A, -conmat[:, num_vars], delta, g)
        dnorm = min(delta, norm(d))

        # Is the trust-region trial step short? N.B.: we compare DNORM with RHO, not
        # DELTA. Powell's code especially defines SHORTD by SHORTD = (DNORM < 0.5 *
        # RHO). In our tests 1/10 seems to work better than 1/2 or 1/4, especially for
        # linearly constrained problems. Note that LINCOA has a slightly more
        # sophisticated way of defining SHORTD, taking into account whether D causes a
        # change to the active set. Should we try the same here?
        shortd = (dnorm <= 0.1 * rho)

        # Predict the change to F (PREREF) and to the constraint violation (PREREC) due
        # to D. We have the following in precise arithmetic. They may fail to hold due
        # to rounding errors.
        # 1. B[:NUM_CONSTRAINTS] = -CONMAT[:, NUM_VARS] and hence
        # np.max(np.append(B[:NUM_CONSTRAINTS] - D@A[:, :NUM_CONSTRAINTS], 0)) is the
        # L-infinity violation of the linearized constraints corresponding to D. When
        # D=0, the violation is np.max(np.append(B[:NUM_CONSTRAINTS], 0)) =
        # CVAL[NUM_VARS]. PREREC is the reduction of this violation achieved by D,
        # which is nonnegative in theory; PREREC = 0 iff B[:NUM_CONSTRAINTS] <= 0, i.e.
        # the trust-region center satisfies the linearized constraints.
        # 2. PREREF may be negative or 0, but it is positive when PREREC = 0 and shortd
        # is False
        # 3. Due to 2, in theory, max(PREREC, PREREF) > 0 if shortd is False.
        preref = -inprod(d, g)  # Can be negative
        prerec = cval[num_vars] - np.max(np.append(0, conmat[:, num_vars] + matprod(d, A)))

        # Evaluate PREREM, which is the predicted reduction in the merit function.
        # In theory, PREREM >= 0 and it is 0 iff CPEN = 0 = PREREF. This may not be true
        # numerically.
        prerem = preref + cpen * prerec
        trfail = not (prerem > 1.0E-6 * min(cpen, 1) * rho)

        if shortd or trfail:
            # Reduce DELTA if D is short or if D fails to render PREREM > 0. The latter
            # can only happen due to rounding errors. This seems quite important for
            # performance
            delta *= 0.1
            if delta <= gamma3 * rho:
                delta = rho  # set delta to rho when it is close to or below
        else:
            # Calculate the next value of the objective and constraint functions.
            # If X is close to one of the points in the interpolation set, then we do
            # not evaluate the objective and constraints at X, assuming them to have
            # the values at the closest point.
            # N.B.: If this happens, do NOT include X into the filter, as F and CONSTR
            # are inaccurate.
            x = sim[:, num_vars] + d
            distsq[num_vars] = primasum(primapow2(x - sim[:, num_vars]))
            distsq[:num_vars] = primasum(primapow2(x.reshape(num_vars, 1) -
                (sim[:, num_vars].reshape(num_vars, 1) + sim[:, :num_vars])), axis=0)
            j = np.argmin(distsq)
            if distsq[j] <= primapow2(1e-4 * rhoend):
                f = fval[j]
                constr = conmat[:, j]
                cstrv = cval[j]
            else:
                # Evaluate the objective and constraints at X, taking care of possible
                # inf/nan values.
                f, constr = evaluate(calcfc, x, m_nlcon, amat, bvec)
                cstrv = np.max(np.append(0, constr))
                nf += 1
                # Save X, F, CONSTR, CSTRV into the history.
                savehist(maxhist, x, xhist, f, fhist, cstrv, chist, constr, conhist)
                # Save X, F, CONSTR, CSTRV into the filter.
                nfilt, cfilt, ffilt, xfilt, confilt = savefilt(cstrv, ctol, cweight, f,
                                                               x, nfilt, cfilt, ffilt,
                                                               xfilt, constr, confilt)

            # Print a message about the function/constraint evaluation according to
            # iprint
            fmsg(solver, 'Trust region', iprint, nf, delta, f, x, cstrv, constr)

            # Evaluate ACTREM, which is the actual reduction in the merit function
            actrem = (fval[num_vars] + cpen * cval[num_vars]) - (f + cpen * cstrv)

            # Calculate the reduction  ratio by redrat, which hands inf/nan carefully
            ratio = redrat(actrem, prerem, eta1)

            # Update DELTA. After this, DELTA < DNORM may hold.
            # N.B.:
            # 1. Powell's code uses RHO as the trust-region radius and updates it as
            #    follows.
            #    Reduce RHO to GAMMA1*RHO if ADEQUATE_GEO is TRUE and either SHORTD is
            #    TRUE or RATIO < ETA1, and then revise RHO to RHOEND if its new value is
            #    not more than GAMMA3*RHOEND; RHO remains unchanged in all other cases;
            #    in particular, RHO is never increased.
            # 2. Our implementation uses DELTA as the trust-region radius, while using
            #    RHO as a lower bound for DELTA. DELTA is updated in a way that is
            #    typical for trust-region methods, and it is revised to RHO if its new
            #    value is not more than GAMMA3*RHO. RHO reflects the current resolution
            #    of the algorithm; its update is essentially the same as the update of
            #    RHO in Powell's code (see the definition of REDUCE_RHO below). Our
            #    implementation aligns with UOBYQA/NEWUOA/BOBYQA/LINCOA and improves the
            #    performance of COBYLA.
            # 3. The same as Powell's code, we do not reduce RHO unless ADEQUATE_GEO is
            #    TRUE. This is also how Powell updated RHO in
            #    UOBYQA/NEWUOA/BOBYQA/LINCOA. What about we also use ADEQUATE_GEO ==
            #    TRUE as a prerequisite for reducing DELTA? The argument would be that
            #    the bad (small) value of RATIO may be because of a bad geometry (and
            #    hence a bad model) rather than an improperly large DELTA, and it might
            #    be good to try improving the geometry first without reducing DELTA.
            #    However, according to a test on 20230206, it does not improve the
            #    performance if we skip the update of DELTA when ADEQUATE_GEO is FALSE
            #    and RATIO < 0.1. Therefore, we choose to update DELTA without checking
            #    ADEQUATE_GEO.

            delta = trrad(delta, dnorm, eta1, eta2, gamma1, gamma2, ratio)
            if delta <= gamma3*rho:
                delta = rho  # Set delta to rho when it is close to or below.

            # Is the newly generated X better than the current best point?
            ximproved = actrem > 0  # If ACTREM is NaN, then XIMPROVED should and will be False

            # Set JDROP_TR to the index of the vertex to be replaced with X. JDROP_TR = 0 means there
            # is no good point to replace, and X will not be included into the simplex; in this case,
            # the geometry of the simplex likely needs improvement, which will be handled below.
            jdrop_tr = setdrop_tr(ximproved, d, delta, rho, sim, simi)

            # Update SIM, SIMI, FVAL, CONMAT, and CVAL so that SIM[:, JDROP_TR] is replaced with D.
            # UPDATEXFC does nothing if JDROP_TR is None, as the algorithm decides to discard X.
            sim, simi, fval, conmat, cval, subinfo = updatexfc(jdrop_tr, constr, cpen, cstrv, d, f, conmat, cval, fval, sim, simi)
            # Check whether to break due to damaging rounding in UPDATEXFC
            if subinfo == DAMAGING_ROUNDING:
                info = subinfo
                break  # Better action to take? Geometry step, or a RESCUE as in BOBYQA?

            # Check whether to break due to maxfun, ftarget, etc.
            subinfo = checkbreak_con(maxfun, nf, cstrv, ctol, f, ftarget, x)
            if subinfo != INFO_DEFAULT:
                info = subinfo
                break
        # End of if SHORTD or TRFAIL. The normal trust-region calculation ends.

        # Before the next trust-region iteration, we possibly improve the geometry of the simplex or
        # reduce RHO according to IMPROVE_GEO and REDUCE_RHO. Now we decide these indicators.
        # N.B.: We must ensure that the algorithm does not set IMPROVE_GEO = True at infinitely many
        # consecutive iterations without moving SIM[:, NUM_VARS] or reducing RHO. Otherwise, the algorithm
        # will get stuck in repetitive invocations of GEOSTEP. This is ensured by the following facts:
        # 1. If an iteration sets IMPROVE_GEO to True, it must also reduce DELTA or set DELTA to RHO.
        # 2. If SIM[:, NUM_VARS] and RHO remain unchanged, then ADEQUATE_GEO will become True after at
        # most NUM_VARS invocations of GEOSTEP.

        # BAD_TRSTEP: Is the last trust-region step bad?
        bad_trstep = shortd or trfail or ratio <= 0 or jdrop_tr is None
        # IMPROVE_GEO: Should we take a geometry step to improve the geometry of the interpolation set?
        improve_geo = bad_trstep and not adequate_geo
        # REDUCE_RHO: Should we enhance the resolution by reducing rho?
        reduce_rho = bad_trstep and adequate_geo and max(delta, dnorm) <= rho

        # COBYLA never sets IMPROVE_GEO and REDUCE_RHO to True simultaneously.
        # assert not (IMPROVE_GEO and REDUCE_RHO), 'IMPROVE_GEO or REDUCE_RHO are not both TRUE, COBYLA'

        # If SHORTD or TRFAIL is True, then either IMPROVE_GEO or REDUCE_RHO is True unless ADEQUATE_GEO
        # is True and max(DELTA, DNORM) > RHO.
        # assert not (shortd or trfail) or (improve_geo or reduce_rho or (adequate_geo and max(delta, dnorm) > rho)), \
        #     'If SHORTD or TRFAIL is TRUE, then either IMPROVE_GEO or REDUCE_RHO is TRUE unless ADEQUATE_GEO is TRUE and MAX(DELTA, DNORM) > RHO'

        # Comments on BAD_TRSTEP:
        # 1. Powell's definition of BAD_TRSTEP is as follows. The one used above seems to work better,
        # especially for linearly constrained problems due to the factor TENTH (= ETA1).
        # !bad_trstep = (shortd .or. actrem <= 0 .or. actrem < TENTH * prerem .or. jdrop_tr == 0)
        # Besides, Powell did not check PREREM > 0 in BAD_TRSTEP, which is reasonable to do but has
        # little impact upon the performance.
        # 2. NEWUOA/BOBYQA/LINCOA would define BAD_TRSTEP, IMPROVE_GEO, and REDUCE_RHO as follows. Two
        # different thresholds are used in BAD_TRSTEP. It outperforms Powell's version.
        # !bad_trstep = (shortd .or. trfail .or. ratio <= eta1 .or. jdrop_tr == 0)
        # !improve_geo = bad_trstep .and. .not. adequate_geo
        # !bad_trstep = (shortd .or. trfail .or. ratio <= 0 .or. jdrop_tr == 0)
        # !reduce_rho = bad_trstep .and. adequate_geo .and. max(delta, dnorm) <= rho
        # 3. Theoretically, JDROP_TR > 0 when ACTREM > 0 (guaranteed by RATIO > 0). However, in Powell's
        # implementation, JDROP_TR may be 0 even RATIO > 0 due to NaN. The modernized code has rectified
        # this in the function SETDROP_TR. After this rectification, we can indeed simplify the
        # definition of BAD_TRSTEP by removing the condition JDROP_TR == 0. We retain it for robustness.

        # Comments on REDUCE_RHO:
        # When SHORTD is TRUE, UOBYQA/NEWUOA/BOBYQA/LINCOA all set REDUCE_RHO to TRUE if the recent
        # models are sufficiently accurate according to certain criteria. See the paragraph around (37)
        # in the UOBYQA paper and the discussions about Box 14 in the NEWUOA paper. This strategy is
        # crucial for the performance of the solvers. However, as of 20221111, we have not managed to
        # make it work in COBYLA. As in NEWUOA, we recorded the errors of the recent models, and set
        # REDUCE_RHO to true if they are small (e.g., ALL(ABS(MODERR_REC) <= 0.1 * MAXVAL(ABS(A))*RHO) or
        # ALL(ABS(MODERR_REC) <= RHO**2)) when SHORTD is TRUE. It made little impact on the performance.


        # Since COBYLA never sets IMPROVE_GEO and REDUCE_RHO to TRUE simultaneously, the following
        # two blocks are exchangeable: IF (IMPROVE_GEO) ... END IF and IF (REDUCE_RHO) ... END IF.

        # Improve the geometry of the simplex by removing a point and adding a new one.
        # If the current interpolation set has acceptable geometry, then we skip the geometry step.
        # The code has a small difference from Powell's original code here: If the current geometry
        # is acceptable, then we will continue with a new trust-region iteration; however, at the
        # beginning of the iteration, CPEN may be updated, which may alter the pole point SIM(:, N+1)
        # by UPDATEPOLE; the quality of the interpolation point depends on SIM(:, N + 1), meaning
        # that the same interpolation set may have good or bad geometry with respect to different
        # "poles"; if the geometry turns out bad with the new pole, the original COBYLA code will
        # take a geometry step, but our code here will NOT do it but continue to take a trust-region
        # step. The argument is this: even if the geometry step is not skipped in the first place, the
        # geometry may turn out bad again after the pole is altered due to an update to CPEN; should
        # we take another geometry step in that case? If no, why should we do it here? Indeed, this
        # distinction makes no practical difference for CUTEst problems with at most 100 variables
        # and 5000 constraints, while the algorithm framework is simplified.
        if improve_geo and not all(primasum(primapow2(sim[:, :num_vars]), axis=0) <= 4 * primapow2(delta)):
            # Before the geometry step, updatepole has been called either implicitly by UPDATEXFC or
            # explicitly after CPEN is updated, so that SIM[:, :NUM_VARS] is the optimal vertex.

            # Decide a vertex to drop from the simplex. It will be replaced with SIM[:, NUM_VARS] + D to
            # improve the geometry of the simplex.
            # N.B.:
            # 1. COBYLA never sets JDROP_GEO = num_vars.
            # 2. The following JDROP_GEO comes from UOBYQA/NEWUOA/BOBYQA/LINCOA.
            # 3. In Powell's original algorithm, the geometry of the simplex is considered acceptable
            # iff the distance between any vertex and the pole is at most 2.1*DELTA, and the distance
            # between any vertex and the opposite face of the simplex is at least 0.25*DELTA, as
            # specified in (14) of the COBYLA paper. Correspondingly, JDROP_GEO is set to the index of
            # the vertex with the largest distance to the pole provided that the distance is larger than
            # 2.1*DELTA, or the vertex with the smallest distance to the opposite face of the simplex,
            # in which case the distance must be less than 0.25*DELTA, as the current simplex does not
            # have acceptable geometry (see (15)--(16) of the COBYLA paper). Once JDROP_GEO is set, the
            # algorithm replaces SIM(:, JDROP_GEO) with D specified in (17) of the COBYLA paper, which
            # is orthogonal to the face opposite to SIM(:, JDROP_GEO) and has a length of 0.5*DELTA,
            # intending to improve the geometry of the simplex as per (14).
            # 4. Powell's geometry-improving procedure outlined above has an intrinsic flaw: it may lead
            # to infinite cycling, as was observed in a test on 20240320. In this test, the geometry-
            # improving point introduced in the previous iteration was replaced with the trust-region
            # trial point in the current iteration, which was then replaced with the same geometry-
            # improving point in the next iteration, and so on. In this process, the simplex alternated
            # between two configurations, neither of which had acceptable geometry. Thus RHO was never
            # reduced, leading to infinite cycling. (N.B.: Our implementation uses DELTA as the trust
            # region radius, with RHO being its lower bound. When the infinite cycling occurred in this
            # test, DELTA = RHO and it could not be reduced due to the requirement that DELTA >= RHO.)
            jdrop_geo = np.argmax(primasum(primapow2(sim[:, :num_vars]), axis=0), axis=0)

            # Calculate the geometry step D.
            delbar = delta/2
            d = geostep(jdrop_geo, amat, bvec, conmat, cpen, cval, delbar, fval, simi)

            # Calculate the next value of the objective and constraint functions.
            # If X is close to one of the points in the interpolation set, then we do not evaluate the
            # objective and constraints at X, assuming them to have the values at the closest point.
            # N.B.:
            # 1. If this happens, do NOT include X into the filter, as F and CONSTR are inaccurate.
            # 2. In precise arithmetic, the geometry improving step ensures that the distance between X
            # and any interpolation point is at least DELBAR, yet X may be close to them due to
            # rounding. In an experiment with single precision on 20240317, X = SIM(:, N+1) occurred.
            x = sim[:, num_vars] + d
            distsq[num_vars] = primasum(primapow2(x - sim[:, num_vars]))
            distsq[:num_vars] = primasum(primapow2(x.reshape(num_vars, 1) -
                (sim[:, num_vars].reshape(num_vars, 1) + sim[:, :num_vars])), axis=0)
            j = np.argmin(distsq)
            if distsq[j] <= primapow2(1e-4 * rhoend):
                f = fval[j]
                constr = conmat[:, j]
                cstrv = cval[j]
            else:
                # Evaluate the objective and constraints at X, taking care of possible
                # inf/nan values.
                f, constr = evaluate(calcfc, x, m_nlcon, amat, bvec)
                cstrv = np.max(np.append(0, constr))
                nf += 1
                # Save X, F, CONSTR, CSTRV into the history.
                savehist(maxhist, x, xhist, f, fhist, cstrv, chist, constr, conhist)
                # Save X, F, CONSTR, CSTRV into the filter.
                nfilt, cfilt, ffilt, xfilt, confilt = savefilt(cstrv, ctol, cweight, f,
                                                               x, nfilt, cfilt, ffilt,
                                                               xfilt, constr, confilt)

            # Print a message about the function/constraint evaluation according to iprint
            fmsg(solver, 'Geometry', iprint, nf, delta, f, x, cstrv, constr)
            # Update SIM, SIMI, FVAL, CONMAT, and CVAL so that SIM(:, JDROP_GEO) is replaced with D.
            sim, simi, fval, conmat, cval, subinfo = updatexfc(jdrop_geo, constr, cpen, cstrv, d, f, conmat, cval, fval, sim, simi)
            # Check whether to break due to damaging rounding in UPDATEXFC
            if subinfo == DAMAGING_ROUNDING:
                info = subinfo
                break  # Better action to take? Geometry step, or simply continue?

            # Check whether to break due to maxfun, ftarget, etc.
            subinfo = checkbreak_con(maxfun, nf, cstrv, ctol, f, ftarget, x)
            if subinfo != INFO_DEFAULT:
                info = subinfo
                break
        # end of if improve_geo. The procedure of improving the geometry ends.

        # The calculations with the current RHO are complete. Enhance the resolution of the algorithm
        # by reducing RHO; update DELTA and CPEN at the same time.
        if reduce_rho:
            if rho <= rhoend:
                info = SMALL_TR_RADIUS
                break
            delta = max(0.5 * rho, redrho(rho, rhoend))
            rho = redrho(rho, rhoend)
            # THe second (out of two) updates of CPEN, where CPEN decreases or remains the same.
            # Powell's code: cpen = min(cpen, fcratio(fval, conmat)), which may set CPEN to 0.
            cpen = np.maximum(cpenmin, np.minimum(cpen, fcratio(conmat, fval)))
            # Print a message about the reduction of rho according to iprint
            rhomsg(solver, iprint, nf, fval[num_vars], rho, sim[:, num_vars], cval[num_vars], conmat[:, num_vars], cpen)
            conmat, cval, fval, sim, simi, subinfo = updatepole(cpen, conmat, cval, fval, sim, simi)
            # Check whether to break due to damaging rounding detected in updatepole
            if subinfo == DAMAGING_ROUNDING:
                info = subinfo
                break  # Better action to take? Geometry step, or simply continue?
        # End of if reduce_rho. The procedure of reducing RHO ends.
        # Report the current best value, and check if user asks for early termination.
        if callback:
            terminate = callback(sim[:, num_vars], fval[num_vars], nf, tr, cval[num_vars], conmat[:, num_vars])
            if terminate:
                info = CALLBACK_TERMINATE
                break
    # End of for loop. The iterative procedure ends

    # Return from the calculation, after trying the last trust-region step if it has not been tried yet.
    # Ensure that D has not been updated after SHORTD == TRUE occurred, or the code below is incorrect.
    x = sim[:, num_vars] + d
    if (info == SMALL_TR_RADIUS and
            shortd and
            norm(x - sim[:, num_vars]) > 1.0E-3 * rhoend and
            nf < maxfun):
        # Zaikun 20230615: UPDATEXFC or UPDATEPOLE is not called since the last trust-region step. Hence
        # SIM[:, NUM_VARS] remains unchanged. Otherwise SIM[:, NUM_VARS] + D would not make sense.
        f, constr = evaluate(calcfc, x, m_nlcon, amat, bvec)
        cstrv = np.max(np.append(0, constr))
        nf += 1
        savehist(maxhist, x, xhist, f, fhist, cstrv, chist, constr, conhist)
        nfilt, cfilt, ffilt, xfilt, confilt = savefilt(cstrv, ctol, cweight, f, x, nfilt, cfilt, ffilt, xfilt, constr, confilt)
        # Zaikun 20230512: DELTA has been updated. RHO is only indicative here. TO BE IMPROVED.
        fmsg(solver, 'Trust region', iprint, nf, rho, f, x, cstrv, constr)

    # Return the best calculated values of the variables
    # N.B.: SELECTX and FINDPOLE choose X by different standards, one cannot replace the other.
    kopt = selectx(ffilt[:nfilt], cfilt[:nfilt], max(cpen, cweight), ctol)
    x = xfilt[:, kopt]
    f = ffilt[kopt]
    constr = confilt[:, kopt]
    cstrv = cfilt[kopt]

    # Print a return message according to IPRINT.
    retmsg(solver, info, iprint, nf, f, x, cstrv, constr)
    return x, f, constr, cstrv, nf, xhist, fhist, chist, conhist, info



def getcpen(amat, bvec, conmat, cpen, cval, delta, fval, rho, sim, simi):
    '''
    This function gets the penalty parameter CPEN so that PREREM = PREREF + CPEN * PREREC > 0.
    See the discussions around equation (9) of the COBYLA paper.
    '''

    # Even after nearly all of the pycutest problems were showing nearly bit for bit
    # identical results between Python and the Fortran bindings, HS102 was still off by
    # more than machine epsilon. It turned out to be due to the fact that getcpen was
    # modifying fval, among other. It just goes to show that even when you're nearly
    # perfect, you can still have non trivial bugs.
    conmat = conmat.copy()
    cval = cval.copy()
    fval = fval.copy()
    sim = sim.copy()
    simi = simi.copy()

    # Intermediate variables
    A = np.zeros((np.size(sim, 0), np.size(conmat, 0)))
    itol = 1

    # Sizes
    m_lcon = np.size(bvec) if bvec is not None else 0
    num_constraints = np.size(conmat, 0)
    num_vars = np.size(sim, 0)

    # Preconditions
    if DEBUGGING:
        assert num_constraints >= 0
        assert num_vars >= 1
        assert cpen > 0
        assert np.size(conmat, 0) == num_constraints and np.size(conmat, 1) == num_vars + 1
        assert not (np.isnan(conmat) | np.isneginf(conmat)).any()
        assert np.size(cval) == num_vars + 1 and \
            not any(cval < 0 | np.isnan(cval) | np.isposinf(cval))
        assert np.size(fval) == num_vars + 1 and not any(np.isnan(fval) | np.isposinf(fval))
        assert np.size(sim, 0) == num_vars and np.size(sim, 1) == num_vars + 1
        assert np.isfinite(sim).all()
        assert all(np.max(abs(sim[:, :num_vars]), axis=0) > 0)
        assert np.size(simi, 0) == num_vars and np.size(simi, 1) == num_vars
        assert np.isfinite(simi).all()
        assert isinv(sim[:, :num_vars], simi, itol)
        assert delta >= rho and rho > 0

    #====================#
    # Calculation starts #
    #====================#

    # Initialize INFO which is needed in the postconditions
    info = INFO_DEFAULT

    # Increase CPEN if necessary to ensure PREREM > 0. Branch back for the next loop
    # if this change alters the optimal vertex of the current simplex.
    # Note the following:
    # 1. In each loop, CPEN is changed only if PREREC > 0 > PREREF, in which case
    #    PREREM is guaranteed positive after the update. Note that PREREC >= 0 and
    #    max(PREREC, PREREF) > 0 in theory. If this holds numerically as well then CPEN
    #    is not changed only if PREREC = 0 or PREREF >= 0, in which case PREREM is
    #    currently positive, explaining why CPEN needs no update.
    # 2. Even without an upper bound for the loop counter, the loop can occur at most
    #    NUM_VARS+1 times. This is because the update of CPEN does not decrease CPEN,
    #    and hence it can make vertex J (J <= NUM_VARS) become the new optimal vertex
    #    only if CVAL[J] is less than CVAL[NUM_VARS], which can happen at most NUM_VARS
    #    times. See the paragraph below (9) in the COBYLA paper. After the "correct"
    #    optimal vertex is found, one more loop is needed to calculate CPEN, and hence
    #    the loop can occur at most NUM_VARS+1 times.
    for iter in range(num_vars + 1):
        # Switch the best vertex of the current simplex to SIM[:, NUM_VARS]
        conmat, cval, fval, sim, simi, info = updatepole(cpen, conmat, cval, fval, sim,
                                                         simi)
        # Check whether to exit due to damaging rounding in UPDATEPOLE
        if info == DAMAGING_ROUNDING:
            break

        # Calculate the linear approximations to the objective and constraint functions.
        g = matprod(fval[:num_vars] - fval[num_vars], simi)
        A[:, :m_lcon] = amat.T if amat is not None else amat
        A[:, m_lcon:] = matprod((conmat[m_lcon:, :num_vars] -
                          np.tile(conmat[m_lcon:, num_vars], (num_vars, 1)).T), simi).T

        # Calculate the trust-region trial step D. Note that D does NOT depend on CPEN.
        d = trstlp(A, -conmat[:, num_vars], delta, g)

        # Predict the change to F (PREREF) and to the constraint violation (PREREC) due
        # to D.
        preref = -inprod(d, g)  # Can be negative
        prerec = cval[num_vars] - np.max(np.append(0, conmat[:, num_vars] + matprod(d, A)))

        # PREREC <= 0 or PREREF >=0 or either is NaN
        if not (prerec > 0 and preref < 0):
            break

        # Powell's code defines BARMU = -PREREF / PREREC, and CPEN is increased to
        # 2*BARMU if and only if it is currently less than 1.5*BARMU, a very
        # "Powellful" scheme. In our implementation, however, we set CPEN directly to
        # the maximum between its current value and 2*BARMU while handling possible
        # overflow. The simplifies the scheme without worsening the performance of
        # COBYLA.
        cpen = max(cpen, min(-2 * preref / prerec, REALMAX))

        if findpole(cpen, cval, fval) == num_vars:
            break

    #==================#
    # Calculation ends #
    #==================#

    # Postconditions
    if DEBUGGING:
        assert cpen >= cpen and cpen > 0
        assert preref + cpen * prerec > 0 or info == DAMAGING_ROUNDING or \
            not (prerec >= 0 and np.maximum(prerec, preref) > 0) or not np.isfinite(preref)

    return cpen


def fcratio(conmat, fval):
    '''
    This function calculates the ratio between the "typical change" of F and that of CONSTR.
    See equations (12)-(13) in Section 3 of the COBYLA paper for the definition of the ratio.
    '''

    # Preconditions
    if DEBUGGING:
        assert np.size(fval) >= 1
        assert np.size(conmat, 1) == np.size(fval)

    #====================#
    # Calculation starts #
    #====================#

    cmin = np.min(-conmat, axis=1)
    cmax = np.max(-conmat, axis=1)
    fmin = min(fval)
    fmax = max(fval)
    if any(cmin < 0.5 * cmax) and fmin < fmax:
        denom = np.min(np.maximum(cmax, 0) - cmin, where=cmin < 0.5 * cmax, initial=np.inf)
        # Powell mentioned the following alternative in section 4 of his COBYLA paper. According to a test
        # on 20230610, it does not make much difference to the performance.
        # denom = np.max(max(*cmax, 0) - cmin, mask=(cmin < 0.5 * cmax))
        r = (fmax - fmin) / denom
    else:
        r = 0

    #==================#
    # Calculation ends #
    #==================#

    # Postconditions
    if DEBUGGING:
        assert r >= 0

    return r
