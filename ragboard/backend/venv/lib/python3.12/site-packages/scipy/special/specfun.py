# This file is not meant for public use and will be removed in SciPy v2.0.0.
# Use the `scipy.special` namespace for importing the functions
# included below.

from scipy._lib.deprecation import _sub_module_deprecation

# ruff: noqa: F822
__all__ = [
    'clpmn',
    'lpmn',
    'lpn',
    'lqmn',
    'pbdv'
]


def __dir__():
    return __all__


def __getattr__(name):
    return _sub_module_deprecation(sub_package="special", module="specfun",
                                   private_modules=["_basic", "_specfun"], all=__all__,
                                   attribute=name)
