"""
==============================================================
Finite Difference Differentiation (:mod:`scipy.differentiate`)
==============================================================

.. currentmodule:: scipy.differentiate

SciPy ``differentiate`` provides functions for performing finite difference
numerical differentiation of black-box functions.

.. autosummary::
   :toctree: generated/

   derivative
   jacobian
   hessian

"""


from ._differentiate import *

__all__ = ['derivative', 'jacobian', 'hessian']

from scipy._lib._testutils import PytestTester
test = PytestTester(__name__)
del PytestTester
