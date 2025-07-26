'''
This module provides some Powell-style linear algebra procedures.

Translated from Zaikun Zhang's modern-Fortran reference implementation in PRIMA.

Dedicated to late Professor M. J. D. Powell FRS (1936--2015).

Python translation by Nickolai Belakovski.
'''

import numpy as np
from .linalg import isminor, planerot, matprod, inprod, hypot
from .consts import DEBUGGING, EPS


def qradd_Rdiag(c, Q, Rdiag, n):
    '''
    This function updates the QR factorization of an MxN matrix A of full column rank, attempting to
    add a new column C to this matrix as the LAST column while maintaining the full-rankness.
    Case 1. If C is not in range(A) (theoretically, it implies N < M), then the new matrix is np.hstack([A, C])
    Case 2. If C is in range(A), then the new matrix is np.hstack([A[:, :n-1], C])
    N.B.:
    0. Instead of R, this subroutine updates Rdiag, which is np.diag(R), with a size at most M and at
    least min(m, n+1). The number is min(m, n+1) rather than min(m, n) as n may be augmented by 1 in
    the function.
    1. With the two cases specified as above, this function does not need A as an input.
    2. The function changes only Q[:, nsave:m] (nsave is the original value of n) and
    R[:, n-1] (n takes the updated value)
    3. Indeed, when C is in range(A), Powell wrote in comments that "set iOUT to the index of the
    constraint (here, column of A --- Zaikun) to be deleted, but branch if no suitable index can be
    found". The idea is to replace a column of A by C so that the new matrix still has full rank
    (such a column must exist unless C = 0). But his code essentially sets iout=n always. Maybe he
    found this worked well enough in practice. Meanwhile, Powell's code includes a snippet that can
    never be reached, which was probably intended to deal with the case that IOUT != n
    '''
    m = Q.shape[1]
    nsave = n  # Needed for debugging (only)

    # As in Powell's COBYLA, CQ is set to 0 at the positions with CQ being negligible as per ISMINOR.
    # This may not be the best choice if the subroutine is used in other contexts, e.g. LINCOA.
    cq = matprod(c, Q)
    cqa = matprod(abs(c), abs(Q))
    # The line below basically makes an element of cq 0 if adding it to the corresponding element of
    # cqa does not change the latter.
    cq = np.array([0 if isminor(cqi, cqai) else cqi for cqi, cqai in zip(cq, cqa)])

    # Update Q so that the columns of Q[:, n+1:m] are orthogonal to C. This is done by applying a 2D
    # Givens rotation to Q[:, [k, k+1]] from the right to zero C' @ Q[:, k+1] out for K=n+1, ... m-1.
    # Nothing will be done if n >= m-1
    for k in range(m-2, n-1, -1):
        if abs(cq[k+1]) > 0:
            # Powell wrote cq[k+1] != 0 instead of abs. The two differ if cq[k+1] is NaN.
            # If we apply the rotation below when cq[k+1] = 0, then cq[k] will get updated to |cq[k]|.
            G = planerot(cq[k:k+2])
            Q[:, [k, k+1]] = matprod(Q[:, [k, k+1]], G.T)
            cq[k] = hypot(*cq[k:k+2])

    # Augment n by 1 if C is not in range(A)
    if n < m:
        # Powell's condition for the following if: cq[n+1] != 0
        if abs(cq[n]) > EPS**2 and not isminor(cq[n], cqa[n]):
            n += 1

    # Update Rdiag so that Rdiag[n] = cq[n] = np.dot(c, q[:, n]). Note that N may be been augmented.
    if n - 1 >= 0 and n - 1 < m:  # n >= m should not happen unless the input is wrong
        Rdiag[n - 1] = cq[n - 1]

    if DEBUGGING:
        assert nsave <= n <= min(nsave + 1, m)
        assert n <= len(Rdiag) <= m
        assert Q.shape == (m, m)

    return Q, Rdiag, n


def qrexc_Rdiag(A, Q, Rdiag, i):  # Used in COBYLA
    '''
    This function updates the QR factorization for an MxN matrix A=Q@R so that the updated Q and
    R form a QR factorization of [A_0, ..., A_{I-1}, A_{I+1}, ..., A_{N-1}, A_I] which is the matrix
    obtained by rearranging columns [I, I+1, ... N-1] of A to [I+1, ..., N-1, I]. Here A is ASSUMED TO
    BE OF FULL COLUMN RANK, Q is a matrix whose columns are orthogonal, and R, which is not present,
    is an upper triangular matrix whose diagonal entries are nonzero. Q and R need not be square.
    N.B.:
    0. Instead of R, this function updates Rdiag, which is np.diag(R), the size being n.
    1. With L = Q.shape[1] = R.shape[0], we have M >= L >= N. Most often L = M or N.
    2. This function changes only Q[:, i:] and Rdiag[i:]
    3. (NDB 20230919) In Python, i is either icon or nact - 2, whereas in FORTRAN it is either icon or nact - 1.
    '''

    # Sizes
    m, n = A.shape

    # Preconditions
    assert n >= 1 and n <= m
    assert i >= 0 and i < n
    assert len(Rdiag) == n
    assert Q.shape[0] == m and Q.shape[1] >= n and Q.shape[1] <= m
    # tol = max(1.0E-8, min(1.0E-1, 1.0E8 * EPS * m + 1))
    # assert isorth(Q, tol)  # Costly!


    if i < 0 or i >= n:
        return Q, Rdiag

    # Let R be the upper triangular matrix in the QR factorization, namely R = Q.T@A.
    # For each k, find the Givens rotation G with G@(R[k:k+2, :]) = [hypt, 0], and update Q[:, k:k+2]
    # to Q[:, k:k+2]@(G.T). Then R = Q.T@A is an upper triangular matrix as long as A[:, [k, k+1]] is
    # updated to A[:, [k+1, k]]. Indeed, this new upper triangular matrix can be obtained by first
    # updating R[[k, k+1], :] to G@(R[[k, k+1], :]) and then exchanging its columns K and K+1; at the same
    # time, entries k and k+1 of R's diagonal Rdiag become [hypt, -(Rdiag[k+1]/hypt)*RDiag[k]].
    # After this is done for each k = 0, ..., n-2, we obtain the QR factorization of the matrix that
    # rearranges columns [i, i+1, ... n-1] of A as [i+1, ..., n-1, i].
    # Powell's code, however, is slightly different: before everything, he first exchanged columns k and
    # k+1 of Q (as well as rows k and k+1 of R). This makes sure that the entries of the update Rdiag
    # are all positive if it is the case for the original Rdiag.
    for k in range(i, n-1):
        G = planerot([Rdiag[k+1], inprod(Q[:, k], A[:, k+1])])
        Q[:, [k, k+1]] = matprod(Q[:, [k+1, k]], (G.T))
        # Powell's code updates Rdiag in the following way:
        # hypt = np.sqrt(Rdiag[k+1]**2 + np.dot(Q[:, k], A[:, k+1])**2)
        # Rdiag[[k, k+1]] = [hypt, (Rdiag[k+1]/hypt)*Rdiag[k]]
        # Note that Rdiag[n-1] inherits all rounding in Rdiag[i:n-1] and Q[:, i:n-1] and hence contains
        # significant errors. Thus we may modify Powell's code to set only Rdiag[k] = hypt here and then
        # calculate Rdiag[n] by an inner product after the loop. Nevertheless, we simple calculate RDiag
        # from scratch below.

    # Calculate Rdiag(i:n) from scratch
    Rdiag[i:n-1] = [inprod(Q[:, k], A[:, k+1]) for k in range(i, n-1)]
    Rdiag[n-1] = inprod(Q[:, n-1], A[:, i])

    return Q, Rdiag
