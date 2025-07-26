# This file is not meant for public use and will be removed in SciPy v2.0.0.
# Use the `scipy.optimize` namespace for importing the functions
# included below.

from scipy._lib.deprecation import _sub_module_deprecation


__all__ = [  # noqa: F822
    'OptimizeResult',
    'OptimizeWarning',
    'approx_fprime',
    'bracket',
    'brent',
    'brute',
    'check_grad',
    'fmin',
    'fmin_bfgs',
    'fmin_cg',
    'fmin_ncg',
    'fmin_powell',
    'fminbound',
    'golden',
    'line_search',
    'rosen',
    'rosen_der',
    'rosen_hess',
    'rosen_hess_prod',
    'show_options',
    'zeros',
]


def __dir__():
    return __all__


def __getattr__(name):
    return _sub_module_deprecation(sub_package="optimize", module="optimize",
                                   private_modules=["_optimize"], all=__all__,
                                   attribute=name)
