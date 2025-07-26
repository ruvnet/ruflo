#!/usr/bin/env python3
#cython: language_level=3
#cython: boundscheck=False
#cython: wraparound=False

from scipy.special.cython_special cimport beta, gamma

cpdef double cy_beta(double a, double b):
    return beta(a, b)

cpdef double complex cy_gamma(double complex z):
    return gamma(z)
