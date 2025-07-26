# This file is not meant for public use and will be removed in SciPy v2.0.0.
# Use the `scipy.io.matlab` namespace for importing the functions
# included below.

from scipy._lib.deprecation import _sub_module_deprecation

__all__: list[str] = []


def __dir__():
    return __all__


def __getattr__(name):
    return _sub_module_deprecation(sub_package="io.matlab", module="byteordercodes",
                                   private_modules=["_byteordercodes"], all=__all__,
                                   attribute=name)
