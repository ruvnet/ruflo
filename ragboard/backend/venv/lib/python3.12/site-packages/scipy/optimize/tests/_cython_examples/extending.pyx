#!/usr/bin/env python3
#cython: language_level=3
#cython: boundscheck=False
#cython: wraparound=False
"""
Taken from docstring for scipy.optimize.cython_optimize module.
"""

from scipy.optimize.cython_optimize cimport brentq

# import math from Cython
from libc cimport math

myargs = {'C0': 1.0, 'C1': 0.7}  # a dictionary of extra arguments
XLO, XHI = 0.5, 1.0  # lower and upper search boundaries
XTOL, RTOL, MITR = 1e-3, 1e-3, 10  # other solver parameters

# user-defined struct for extra parameters
ctypedef struct test_params:
    double C0
    double C1


# user-defined callback
cdef double f(double x, void *args) noexcept:
    cdef test_params *myargs = <test_params *> args
    return myargs.C0 - math.exp(-(x - myargs.C1))


# Cython wrapper function
cdef double brentq_wrapper_example(dict args, double xa, double xb,
                                    double xtol, double rtol, int mitr):
    # Cython automatically casts dictionary to struct
    cdef test_params myargs = args
    return brentq(
        f, xa, xb, <test_params *> &myargs, xtol, rtol, mitr, NULL)


# Python function
def brentq_example(args=myargs, xa=XLO, xb=XHI, xtol=XTOL, rtol=RTOL,
                    mitr=MITR):
    '''Calls Cython wrapper from Python.'''
    return brentq_wrapper_example(args, xa, xb, xtol, rtol, mitr)
