#!/usr/bin/env python3
#cython: language_level=3
#cython: boundscheck=False
#cython: wraparound=False

cimport scipy.linalg
from scipy.linalg.cython_blas cimport cdotu
from scipy.linalg.cython_lapack cimport dgtsv

cpdef tridiag(double[:] a, double[:] b, double[:] c, double[:] x):
    """ Solve the system A y = x for y where A is the tridiagonal matrix with
    subdiagonal 'a', diagonal 'b', and superdiagonal 'c'. """
    cdef int n=b.shape[0], nrhs=1, info
    # Solution is written over the values in x.
    dgtsv(&n, &nrhs, &a[0], &b[0], &c[0], &x[0], &n, &info)

cpdef float complex complex_dot(float complex[:] cx, float complex[:] cy):
    """ Take dot product of two complex vectors """
    cdef:
        int n = cx.shape[0]
        int incx = cx.strides[0] // sizeof(cx[0])
        int incy = cy.strides[0] // sizeof(cy[0])
    return cdotu(&n, &cx[0], &incx, &cy[0], &incy)
