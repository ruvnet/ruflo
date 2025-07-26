"""
===================================================================
Elementwise Scalar Optimization (:mod:`scipy.optimize.elementwise`)
===================================================================

.. currentmodule:: scipy.optimize.elementwise

This module provides a collection of functions for root finding and
minimization of scalar, real-valued functions of one variable. Unlike their
counterparts in the base :mod:`scipy.optimize` namespace, these functions work
elementwise, enabling the solution of many related problems in an efficient,
vectorized call. Furthermore, when environment variable ``SCIPY_ARRAY_API=1``,
these functions can accept non-NumPy, array API standard compatible arrays and
perform all calculations using the corresponding array library (e.g. PyTorch,
JAX, CuPy).

Root finding
============

.. autosummary::
   :toctree: generated/

   find_root
   bracket_root

Minimization
============

.. autosummary::
   :toctree: generated/

   find_minimum
   bracket_minimum

"""
from ._elementwise import find_root, find_minimum, bracket_root, bracket_minimum  # noqa: F401, E501

__all__ = ["find_root", "find_minimum", "bracket_root", "bracket_minimum"]
