# This file is not meant for public use and will be removed in SciPy v2.0.0.
# Use the `scipy.stats` namespace for importing the functions
# included below.

from scipy._lib.deprecation import _sub_module_deprecation


__all__ = [  # noqa: F822
    'mvsdist',
    'bayes_mvs', 'kstat', 'kstatvar', 'probplot', 'ppcc_max', 'ppcc_plot',
    'boxcox_llf', 'boxcox', 'boxcox_normmax', 'boxcox_normplot',
    'shapiro', 'anderson', 'ansari', 'bartlett', 'levene',
    'fligner', 'mood', 'wilcoxon', 'median_test',
    'circmean', 'circvar', 'circstd', 'anderson_ksamp',
    'yeojohnson_llf', 'yeojohnson', 'yeojohnson_normmax',
    'yeojohnson_normplot', 'find_repeats', 'chi2_contingency', 'distributions',
]


def __dir__():
    return __all__


def __getattr__(name):
    return _sub_module_deprecation(sub_package="stats", module="morestats",
                                   private_modules=["_morestats"], all=__all__,
                                   attribute=name)
