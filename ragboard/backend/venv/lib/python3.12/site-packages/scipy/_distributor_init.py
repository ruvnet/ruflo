""" Distributor init file

Distributors: you can replace the contents of this file with your own custom
code to support particular distributions of SciPy.

For example, this is a good place to put any checks for hardware requirements
or BLAS/LAPACK library initialization.

The SciPy standard source distribution will not put code in this file beyond
the try-except import of `_distributor_init_local` (which is not part of a
standard source distribution), so you can safely replace this file with your
own version.
"""

try:
    from . import _distributor_init_local  # noqa: F401
except ImportError:
    pass
