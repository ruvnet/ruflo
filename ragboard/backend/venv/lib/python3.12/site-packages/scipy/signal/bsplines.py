# This file is not meant for public use and will be removed in SciPy v2.0.0.
# Use the `scipy.signal` namespace for importing the functions
# included below.

from scipy._lib.deprecation import _sub_module_deprecation

__all__ = [  # noqa: F822
    'spline_filter', 'gauss_spline',
    'cspline1d', 'qspline1d', 'cspline1d_eval', 'qspline1d_eval',
    'cspline2d', 'sepfir2d'
]


def __dir__():
    return __all__


def __getattr__(name):
    return _sub_module_deprecation(sub_package="signal", module="bsplines",
                                   private_modules=["_spline_filters"], all=__all__,
                                   attribute=name)
