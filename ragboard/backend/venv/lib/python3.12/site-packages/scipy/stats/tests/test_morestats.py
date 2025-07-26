# Author:  Travis Oliphant, 2002
#
# Further enhancements and tests added by numerous SciPy developers.
#
import contextlib
import math
import re
import sys
import warnings
from functools import partial

import numpy as np
from numpy.random import RandomState
from numpy.testing import (assert_array_equal, assert_almost_equal,
                           assert_array_less, assert_array_almost_equal,
                           assert_, assert_allclose, assert_equal,
                           suppress_warnings)
import pytest
from pytest import raises as assert_raises

from scipy import optimize, stats, special
from scipy.stats._morestats import _abw_state, _get_As_weibull, _Avals_weibull
from .common_tests import check_named_results
from .._hypotests import _get_wilcoxon_distr, _get_wilcoxon_distr2
from scipy.stats._binomtest import _binary_search_for_binom_tst
from scipy.stats._distr_params import distcont
from scipy.stats._axis_nan_policy import (SmallSampleWarning, too_small_nd_omit,
                                          too_small_1d_omit, too_small_1d_not_omit)

from scipy._lib._array_api import is_numpy
from scipy._lib._array_api_no_0d import (
    xp_assert_close,
    xp_assert_equal,
    xp_assert_less,
)


skip_xp_backends = pytest.mark.skip_xp_backends

distcont = dict(distcont)  # type: ignore

# Matplotlib is not a scipy dependency but is optionally used in probplot, so
# check if it's available
try:
    import matplotlib
    matplotlib.rcParams['backend'] = 'Agg'
    import matplotlib.pyplot as plt
    have_matplotlib = True
except Exception:
    have_matplotlib = False


# test data gear.dat from NIST for Levene and Bartlett test
# https://www.itl.nist.gov/div898/handbook/eda/section3/eda3581.htm
g1 = [1.006, 0.996, 0.998, 1.000, 0.992, 0.993, 1.002, 0.999, 0.994, 1.000]
g2 = [0.998, 1.006, 1.000, 1.002, 0.997, 0.998, 0.996, 1.000, 1.006, 0.988]
g3 = [0.991, 0.987, 0.997, 0.999, 0.995, 0.994, 1.000, 0.999, 0.996, 0.996]
g4 = [1.005, 1.002, 0.994, 1.000, 0.995, 0.994, 0.998, 0.996, 1.002, 0.996]
g5 = [0.998, 0.998, 0.982, 0.990, 1.002, 0.984, 0.996, 0.993, 0.980, 0.996]
g6 = [1.009, 1.013, 1.009, 0.997, 0.988, 1.002, 0.995, 0.998, 0.981, 0.996]
g7 = [0.990, 1.004, 0.996, 1.001, 0.998, 1.000, 1.018, 1.010, 0.996, 1.002]
g8 = [0.998, 1.000, 1.006, 1.000, 1.002, 0.996, 0.998, 0.996, 1.002, 1.006]
g9 = [1.002, 0.998, 0.996, 0.995, 0.996, 1.004, 1.004, 0.998, 0.999, 0.991]
g10 = [0.991, 0.995, 0.984, 0.994, 0.997, 0.997, 0.991, 0.998, 1.004, 0.997]


# The loggamma RVS stream is changing due to gh-13349; this version
# preserves the old stream so that tests don't change.
def _old_loggamma_rvs(*args, **kwargs):
    return np.log(stats.gamma.rvs(*args, **kwargs))


class TestBayes_mvs:
    def test_basic(self):
        # Expected values in this test simply taken from the function.  For
        # some checks regarding correctness of implementation, see review in
        # gh-674
        data = [6, 9, 12, 7, 8, 8, 13]
        mean, var, std = stats.bayes_mvs(data)
        assert_almost_equal(mean.statistic, 9.0)
        assert_allclose(mean.minmax, (7.103650222492964, 10.896349777507034),
                        rtol=1e-6)

        assert_almost_equal(var.statistic, 10.0)
        assert_allclose(var.minmax, (3.1767242068607087, 24.45910381334018),
                        rtol=1e-09)

        assert_almost_equal(std.statistic, 2.9724954732045084, decimal=14)
        assert_allclose(std.minmax, (1.7823367265645145, 4.9456146050146312),
                        rtol=1e-14)

    def test_empty_input(self):
        assert_raises(ValueError, stats.bayes_mvs, [])

    def test_result_attributes(self):
        x = np.arange(15)
        attributes = ('statistic', 'minmax')
        res = stats.bayes_mvs(x)

        for i in res:
            check_named_results(i, attributes)


class TestMvsdist:
    def test_basic(self):
        data = [6, 9, 12, 7, 8, 8, 13]
        mean, var, std = stats.mvsdist(data)
        assert_almost_equal(mean.mean(), 9.0)
        assert_allclose(mean.interval(0.9), (7.103650222492964,
                                             10.896349777507034), rtol=1e-14)

        assert_almost_equal(var.mean(), 10.0)
        assert_allclose(var.interval(0.9), (3.1767242068607087,
                                            24.45910381334018), rtol=1e-09)

        assert_almost_equal(std.mean(), 2.9724954732045084, decimal=14)
        assert_allclose(std.interval(0.9), (1.7823367265645145,
                                            4.9456146050146312), rtol=1e-14)

    def test_empty_input(self):
        assert_raises(ValueError, stats.mvsdist, [])

    def test_bad_arg(self):
        # Raise ValueError if fewer than two data points are given.
        data = [1]
        assert_raises(ValueError, stats.mvsdist, data)

    def test_warns(self):
        # regression test for gh-5270
        # make sure there are no spurious divide-by-zero warnings
        with warnings.catch_warnings():
            warnings.simplefilter('error', RuntimeWarning)
            [x.mean() for x in stats.mvsdist([1, 2, 3])]
            [x.mean() for x in stats.mvsdist([1, 2, 3, 4, 5])]


class TestShapiro:
    def test_basic(self):
        x1 = [0.11, 7.87, 4.61, 10.14, 7.95, 3.14, 0.46,
              4.43, 0.21, 4.75, 0.71, 1.52, 3.24,
              0.93, 0.42, 4.97, 9.53, 4.55, 0.47, 6.66]
        w, pw = stats.shapiro(x1)
        shapiro_test = stats.shapiro(x1)
        assert_almost_equal(w, 0.90047299861907959, decimal=6)
        assert_almost_equal(shapiro_test.statistic, 0.90047299861907959, decimal=6)
        assert_almost_equal(pw, 0.042089745402336121, decimal=6)
        assert_almost_equal(shapiro_test.pvalue, 0.042089745402336121, decimal=6)

        x2 = [1.36, 1.14, 2.92, 2.55, 1.46, 1.06, 5.27, -1.11,
              3.48, 1.10, 0.88, -0.51, 1.46, 0.52, 6.20, 1.69,
              0.08, 3.67, 2.81, 3.49]
        w, pw = stats.shapiro(x2)
        shapiro_test = stats.shapiro(x2)
        assert_almost_equal(w, 0.9590270, decimal=6)
        assert_almost_equal(shapiro_test.statistic, 0.9590270, decimal=6)
        assert_almost_equal(pw, 0.52460, decimal=3)
        assert_almost_equal(shapiro_test.pvalue, 0.52460, decimal=3)

        # Verified against R
        x3 = stats.norm.rvs(loc=5, scale=3, size=100, random_state=12345678)
        w, pw = stats.shapiro(x3)
        shapiro_test = stats.shapiro(x3)
        assert_almost_equal(w, 0.9772805571556091, decimal=6)
        assert_almost_equal(shapiro_test.statistic, 0.9772805571556091, decimal=6)
        assert_almost_equal(pw, 0.08144091814756393, decimal=3)
        assert_almost_equal(shapiro_test.pvalue, 0.08144091814756393, decimal=3)

        # Extracted from original paper
        x4 = [0.139, 0.157, 0.175, 0.256, 0.344, 0.413, 0.503, 0.577, 0.614,
              0.655, 0.954, 1.392, 1.557, 1.648, 1.690, 1.994, 2.174, 2.206,
              3.245, 3.510, 3.571, 4.354, 4.980, 6.084, 8.351]
        W_expected = 0.83467
        p_expected = 0.000914
        w, pw = stats.shapiro(x4)
        shapiro_test = stats.shapiro(x4)
        assert_almost_equal(w, W_expected, decimal=4)
        assert_almost_equal(shapiro_test.statistic, W_expected, decimal=4)
        assert_almost_equal(pw, p_expected, decimal=5)
        assert_almost_equal(shapiro_test.pvalue, p_expected, decimal=5)

    def test_2d(self):
        x1 = [[0.11, 7.87, 4.61, 10.14, 7.95, 3.14, 0.46,
              4.43, 0.21, 4.75], [0.71, 1.52, 3.24,
              0.93, 0.42, 4.97, 9.53, 4.55, 0.47, 6.66]]
        w, pw = stats.shapiro(x1)
        shapiro_test = stats.shapiro(x1)
        assert_almost_equal(w, 0.90047299861907959, decimal=6)
        assert_almost_equal(shapiro_test.statistic, 0.90047299861907959, decimal=6)
        assert_almost_equal(pw, 0.042089745402336121, decimal=6)
        assert_almost_equal(shapiro_test.pvalue, 0.042089745402336121, decimal=6)

        x2 = [[1.36, 1.14, 2.92, 2.55, 1.46, 1.06, 5.27, -1.11,
              3.48, 1.10], [0.88, -0.51, 1.46, 0.52, 6.20, 1.69,
              0.08, 3.67, 2.81, 3.49]]
        w, pw = stats.shapiro(x2)
        shapiro_test = stats.shapiro(x2)
        assert_almost_equal(w, 0.9590270, decimal=6)
        assert_almost_equal(shapiro_test.statistic, 0.9590270, decimal=6)
        assert_almost_equal(pw, 0.52460, decimal=3)
        assert_almost_equal(shapiro_test.pvalue, 0.52460, decimal=3)

    @pytest.mark.parametrize('x', ([], [1], [1, 2]))
    def test_not_enough_values(self, x):
        with pytest.warns(SmallSampleWarning, match=too_small_1d_not_omit):
            res = stats.shapiro(x)
            assert_equal(res.statistic, np.nan)
            assert_equal(res.pvalue, np.nan)

    def test_nan_input(self):
        x = np.arange(10.)
        x[9] = np.nan

        w, pw = stats.shapiro(x)
        shapiro_test = stats.shapiro(x)
        assert_equal(w, np.nan)
        assert_equal(shapiro_test.statistic, np.nan)
        # Originally, shapiro returned a p-value of 1 in this case,
        # but there is no way to produce a numerical p-value if the
        # statistic is not a number. NaN is more appropriate.
        assert_almost_equal(pw, np.nan)
        assert_almost_equal(shapiro_test.pvalue, np.nan)

    def test_gh14462(self):
        # shapiro is theoretically location-invariant, but when the magnitude
        # of the values is much greater than the variance, there can be
        # numerical issues. Fixed by subtracting median from the data.
        # See gh-14462.

        trans_val, maxlog = stats.boxcox([122500, 474400, 110400])
        res = stats.shapiro(trans_val)

        # Reference from R:
        # options(digits=16)
        # x = c(0.00000000e+00, 3.39996924e-08, -6.35166875e-09)
        # shapiro.test(x)
        ref = (0.86468431705371, 0.2805581751566)

        assert_allclose(res, ref, rtol=1e-5)

    def test_length_3_gh18322(self):
        # gh-18322 reported that the p-value could be negative for input of
        # length 3. Check that this is resolved.
        res = stats.shapiro([0.6931471805599453, 0.0, 0.0])
        assert res.pvalue >= 0

        # R `shapiro.test` doesn't produce an accurate p-value in the case
        # above. Check that the formula used in `stats.shapiro` is not wrong.
        # options(digits=16)
        # x = c(-0.7746653110021126, -0.4344432067942129, 1.8157053280290931)
        # shapiro.test(x)
        x = [-0.7746653110021126, -0.4344432067942129, 1.8157053280290931]
        res = stats.shapiro(x)
        assert_allclose(res.statistic, 0.84658770645509)
        assert_allclose(res.pvalue, 0.2313666489882, rtol=1e-6)


class TestAnderson:
    def test_normal(self):
        rs = RandomState(1234567890)
        x1 = rs.standard_exponential(size=50)
        x2 = rs.standard_normal(size=50)
        A, crit, sig = stats.anderson(x1)
        assert_array_less(crit[:-1], A)
        A, crit, sig = stats.anderson(x2)
        assert_array_less(A, crit[-2:])

        v = np.ones(10)
        v[0] = 0
        A, crit, sig = stats.anderson(v)
        # The expected statistic 3.208057 was computed independently of scipy.
        # For example, in R:
        #   > library(nortest)
        #   > v <- rep(1, 10)
        #   > v[1] <- 0
        #   > result <- ad.test(v)
        #   > result$statistic
        #          A
        #   3.208057
        assert_allclose(A, 3.208057)

    def test_expon(self):
        rs = RandomState(1234567890)
        x1 = rs.standard_exponential(size=50)
        x2 = rs.standard_normal(size=50)
        A, crit, sig = stats.anderson(x1, 'expon')
        assert_array_less(A, crit[-2:])
        with np.errstate(all='ignore'):
            A, crit, sig = stats.anderson(x2, 'expon')
        assert_(A > crit[-1])

    def test_gumbel(self):
        # Regression test for gh-6306.  Before that issue was fixed,
        # this case would return a2=inf.
        v = np.ones(100)
        v[0] = 0.0
        a2, crit, sig = stats.anderson(v, 'gumbel')
        # A brief reimplementation of the calculation of the statistic.
        n = len(v)
        xbar, s = stats.gumbel_l.fit(v)
        logcdf = stats.gumbel_l.logcdf(v, xbar, s)
        logsf = stats.gumbel_l.logsf(v, xbar, s)
        i = np.arange(1, n+1)
        expected_a2 = -n - np.mean((2*i - 1) * (logcdf + logsf[::-1]))

        assert_allclose(a2, expected_a2)

    def test_bad_arg(self):
        assert_raises(ValueError, stats.anderson, [1], dist='plate_of_shrimp')

    def test_result_attributes(self):
        rs = RandomState(1234567890)
        x = rs.standard_exponential(size=50)
        res = stats.anderson(x)
        attributes = ('statistic', 'critical_values', 'significance_level')
        check_named_results(res, attributes)

    def test_gumbel_l(self):
        # gh-2592, gh-6337
        # Adds support to 'gumbel_r' and 'gumbel_l' as valid inputs for dist.
        rs = RandomState(1234567890)
        x = rs.gumbel(size=100)
        A1, crit1, sig1 = stats.anderson(x, 'gumbel')
        A2, crit2, sig2 = stats.anderson(x, 'gumbel_l')

        assert_allclose(A2, A1)

    def test_gumbel_r(self):
        # gh-2592, gh-6337
        # Adds support to 'gumbel_r' and 'gumbel_l' as valid inputs for dist.
        rs = RandomState(1234567890)
        x1 = rs.gumbel(size=100)
        x2 = np.ones(100)
        # A constant array is a degenerate case and breaks gumbel_r.fit, so
        # change one value in x2.
        x2[0] = 0.996
        A1, crit1, sig1 = stats.anderson(x1, 'gumbel_r')
        A2, crit2, sig2 = stats.anderson(x2, 'gumbel_r')

        assert_array_less(A1, crit1[-2:])
        assert_(A2 > crit2[-1])

    def test_weibull_min_case_A(self):
        # data and reference values from `anderson` reference [7]
        x = np.array([225, 171, 198, 189, 189, 135, 162, 135, 117, 162])
        res = stats.anderson(x, 'weibull_min')
        m, loc, scale = res.fit_result.params
        assert_allclose((m, loc, scale), (2.38, 99.02, 78.23), rtol=2e-3)
        assert_allclose(res.statistic, 0.260, rtol=1e-3)
        assert res.statistic < res.critical_values[0]

        c = 1 / m  # ~0.42
        assert_allclose(c, 1/2.38, rtol=2e-3)
        # interpolate between rows for c=0.4 and c=0.45, indices -3 and -2
        As40 = _Avals_weibull[-3]
        As45 = _Avals_weibull[-2]
        As_ref = As40 + (c - 0.4)/(0.45 - 0.4) * (As45 - As40)
        # atol=1e-3 because results are rounded up to the next third decimal
        assert np.all(res.critical_values > As_ref)
        assert_allclose(res.critical_values, As_ref, atol=1e-3)

    def test_weibull_min_case_B(self):
        # From `anderson` reference [7]
        x = np.array([74, 57, 48, 29, 502, 12, 70, 21,
                      29, 386, 59, 27, 153, 26, 326])
        message = "Maximum likelihood estimation has converged to "
        with pytest.raises(ValueError, match=message):
            stats.anderson(x, 'weibull_min')

    @pytest.mark.thread_unsafe
    def test_weibull_warning_error(self):
        # Check for warning message when there are too few observations
        # This is also an example in which an error occurs during fitting
        x = -np.array([225, 75, 57, 168, 107, 12, 61, 43, 29])
        wmessage = "Critical values of the test statistic are given for the..."
        emessage = "An error occurred while fitting the Weibull distribution..."
        wcontext = pytest.warns(UserWarning, match=wmessage)
        econtext = pytest.raises(ValueError, match=emessage)
        with wcontext, econtext:
            stats.anderson(x, 'weibull_min')

    @pytest.mark.parametrize('distname',
                             ['norm', 'expon', 'gumbel_l', 'extreme1',
                              'gumbel', 'gumbel_r', 'logistic', 'weibull_min'])
    def test_anderson_fit_params(self, distname):
        # check that anderson now returns a FitResult
        rng = np.random.default_rng(330691555377792039)
        real_distname = ('gumbel_l' if distname in {'extreme1', 'gumbel'}
                         else distname)
        dist = getattr(stats, real_distname)
        params = distcont[real_distname]
        x = dist.rvs(*params, size=1000, random_state=rng)
        res = stats.anderson(x, distname)
        assert res.fit_result.success

    def test_anderson_weibull_As(self):
        m = 1  # "when mi < 2, so that c > 0.5, the last line...should be used"
        assert_equal(_get_As_weibull(1/m), _Avals_weibull[-1])
        m = np.inf
        assert_equal(_get_As_weibull(1/m), _Avals_weibull[0])


class TestAndersonKSamp:
    def test_example1a(self):
        # Example data from Scholz & Stephens (1987), originally
        # published in Lehmann (1995, Nonparametrics, Statistical
        # Methods Based on Ranks, p. 309)
        # Pass a mixture of lists and arrays
        t1 = [38.7, 41.5, 43.8, 44.5, 45.5, 46.0, 47.7, 58.0]
        t2 = np.array([39.2, 39.3, 39.7, 41.4, 41.8, 42.9, 43.3, 45.8])
        t3 = np.array([34.0, 35.0, 39.0, 40.0, 43.0, 43.0, 44.0, 45.0])
        t4 = np.array([34.0, 34.8, 34.8, 35.4, 37.2, 37.8, 41.2, 42.8])

        Tk, tm, p = stats.anderson_ksamp((t1, t2, t3, t4), midrank=False)

        assert_almost_equal(Tk, 4.449, 3)
        assert_array_almost_equal([0.4985, 1.3237, 1.9158, 2.4930, 3.2459],
                                  tm[0:5], 4)
        assert_allclose(p, 0.0021, atol=0.00025)

    def test_example1b(self):
        # Example data from Scholz & Stephens (1987), originally
        # published in Lehmann (1995, Nonparametrics, Statistical
        # Methods Based on Ranks, p. 309)
        # Pass arrays
        t1 = np.array([38.7, 41.5, 43.8, 44.5, 45.5, 46.0, 47.7, 58.0])
        t2 = np.array([39.2, 39.3, 39.7, 41.4, 41.8, 42.9, 43.3, 45.8])
        t3 = np.array([34.0, 35.0, 39.0, 40.0, 43.0, 43.0, 44.0, 45.0])
        t4 = np.array([34.0, 34.8, 34.8, 35.4, 37.2, 37.8, 41.2, 42.8])
        Tk, tm, p = stats.anderson_ksamp((t1, t2, t3, t4), midrank=True)

        assert_almost_equal(Tk, 4.480, 3)
        assert_array_almost_equal([0.4985, 1.3237, 1.9158, 2.4930, 3.2459],
                                  tm[0:5], 4)
        assert_allclose(p, 0.0020, atol=0.00025)

    @pytest.mark.xslow
    def test_example2a(self):
        # Example data taken from an earlier technical report of
        # Scholz and Stephens
        # Pass lists instead of arrays
        t1 = [194, 15, 41, 29, 33, 181]
        t2 = [413, 14, 58, 37, 100, 65, 9, 169, 447, 184, 36, 201, 118]
        t3 = [34, 31, 18, 18, 67, 57, 62, 7, 22, 34]
        t4 = [90, 10, 60, 186, 61, 49, 14, 24, 56, 20, 79, 84, 44, 59, 29,
              118, 25, 156, 310, 76, 26, 44, 23, 62]
        t5 = [130, 208, 70, 101, 208]
        t6 = [74, 57, 48, 29, 502, 12, 70, 21, 29, 386, 59, 27]
        t7 = [55, 320, 56, 104, 220, 239, 47, 246, 176, 182, 33]
        t8 = [23, 261, 87, 7, 120, 14, 62, 47, 225, 71, 246, 21, 42, 20, 5,
              12, 120, 11, 3, 14, 71, 11, 14, 11, 16, 90, 1, 16, 52, 95]
        t9 = [97, 51, 11, 4, 141, 18, 142, 68, 77, 80, 1, 16, 106, 206, 82,
              54, 31, 216, 46, 111, 39, 63, 18, 191, 18, 163, 24]
        t10 = [50, 44, 102, 72, 22, 39, 3, 15, 197, 188, 79, 88, 46, 5, 5, 36,
               22, 139, 210, 97, 30, 23, 13, 14]
        t11 = [359, 9, 12, 270, 603, 3, 104, 2, 438]
        t12 = [50, 254, 5, 283, 35, 12]
        t13 = [487, 18, 100, 7, 98, 5, 85, 91, 43, 230, 3, 130]
        t14 = [102, 209, 14, 57, 54, 32, 67, 59, 134, 152, 27, 14, 230, 66,
               61, 34]

        samples = (t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14)
        Tk, tm, p = stats.anderson_ksamp(samples, midrank=False)
        assert_almost_equal(Tk, 3.288, 3)
        assert_array_almost_equal([0.5990, 1.3269, 1.8052, 2.2486, 2.8009],
                                  tm[0:5], 4)
        assert_allclose(p, 0.0041, atol=0.00025)

        rng = np.random.default_rng(6989860141921615054)
        method = stats.PermutationMethod(n_resamples=9999, rng=rng)
        res = stats.anderson_ksamp(samples, midrank=False, method=method)
        assert_array_equal(res.statistic, Tk)
        assert_array_equal(res.critical_values, tm)
        assert_allclose(res.pvalue, p, atol=6e-4)

    def test_example2b(self):
        # Example data taken from an earlier technical report of
        # Scholz and Stephens
        t1 = [194, 15, 41, 29, 33, 181]
        t2 = [413, 14, 58, 37, 100, 65, 9, 169, 447, 184, 36, 201, 118]
        t3 = [34, 31, 18, 18, 67, 57, 62, 7, 22, 34]
        t4 = [90, 10, 60, 186, 61, 49, 14, 24, 56, 20, 79, 84, 44, 59, 29,
              118, 25, 156, 310, 76, 26, 44, 23, 62]
        t5 = [130, 208, 70, 101, 208]
        t6 = [74, 57, 48, 29, 502, 12, 70, 21, 29, 386, 59, 27]
        t7 = [55, 320, 56, 104, 220, 239, 47, 246, 176, 182, 33]
        t8 = [23, 261, 87, 7, 120, 14, 62, 47, 225, 71, 246, 21, 42, 20, 5,
              12, 120, 11, 3, 14, 71, 11, 14, 11, 16, 90, 1, 16, 52, 95]
        t9 = [97, 51, 11, 4, 141, 18, 142, 68, 77, 80, 1, 16, 106, 206, 82,
              54, 31, 216, 46, 111, 39, 63, 18, 191, 18, 163, 24]
        t10 = [50, 44, 102, 72, 22, 39, 3, 15, 197, 188, 79, 88, 46, 5, 5, 36,
               22, 139, 210, 97, 30, 23, 13, 14]
        t11 = [359, 9, 12, 270, 603, 3, 104, 2, 438]
        t12 = [50, 254, 5, 283, 35, 12]
        t13 = [487, 18, 100, 7, 98, 5, 85, 91, 43, 230, 3, 130]
        t14 = [102, 209, 14, 57, 54, 32, 67, 59, 134, 152, 27, 14, 230, 66,
               61, 34]

        Tk, tm, p = stats.anderson_ksamp((t1, t2, t3, t4, t5, t6, t7, t8,
                                          t9, t10, t11, t12, t13, t14),
                                         midrank=True)

        assert_almost_equal(Tk, 3.294, 3)
        assert_array_almost_equal([0.5990, 1.3269, 1.8052, 2.2486, 2.8009],
                                  tm[0:5], 4)
        assert_allclose(p, 0.0041, atol=0.00025)

    @pytest.mark.thread_unsafe
    def test_R_kSamples(self):
        # test values generates with R package kSamples
        # package version 1.2-6 (2017-06-14)
        # r1 = 1:100
        # continuous case (no ties) --> version  1
        # res <- kSamples::ad.test(r1, r1 + 40.5)
        # res$ad[1, "T.AD"] #  41.105
        # res$ad[1, " asympt. P-value"] #  5.8399e-18
        #
        # discrete case (ties allowed) --> version  2 (here: midrank=True)
        # res$ad[2, "T.AD"] #  41.235
        #
        # res <- kSamples::ad.test(r1, r1 + .5)
        # res$ad[1, "T.AD"] #  -1.2824
        # res$ad[1, " asympt. P-value"] #  1
        # res$ad[2, "T.AD"] #  -1.2944
        #
        # res <- kSamples::ad.test(r1, r1 + 7.5)
        # res$ad[1, "T.AD"] # 1.4923
        # res$ad[1, " asympt. P-value"] # 0.077501
        #
        # res <- kSamples::ad.test(r1, r1 + 6)
        # res$ad[2, "T.AD"] # 0.63892
        # res$ad[2, " asympt. P-value"] # 0.17981
        #
        # res <- kSamples::ad.test(r1, r1 + 11.5)
        # res$ad[1, "T.AD"] # 4.5042
        # res$ad[1, " asympt. P-value"] # 0.00545
        #
        # res <- kSamples::ad.test(r1, r1 + 13.5)
        # res$ad[1, "T.AD"] # 6.2982
        # res$ad[1, " asympt. P-value"] # 0.00118

        x1 = np.linspace(1, 100, 100)
        # test case: different distributions;p-value floored at 0.001
        # test case for issue #5493 / #8536
        with suppress_warnings() as sup:
            sup.filter(UserWarning, message='p-value floored')
            s, _, p = stats.anderson_ksamp([x1, x1 + 40.5], midrank=False)
        assert_almost_equal(s, 41.105, 3)
        assert_equal(p, 0.001)

        with suppress_warnings() as sup:
            sup.filter(UserWarning, message='p-value floored')
            s, _, p = stats.anderson_ksamp([x1, x1 + 40.5])
        assert_almost_equal(s, 41.235, 3)
        assert_equal(p, 0.001)

        # test case: similar distributions --> p-value capped at 0.25
        with suppress_warnings() as sup:
            sup.filter(UserWarning, message='p-value capped')
            s, _, p = stats.anderson_ksamp([x1, x1 + .5], midrank=False)
        assert_almost_equal(s, -1.2824, 4)
        assert_equal(p, 0.25)

        with suppress_warnings() as sup:
            sup.filter(UserWarning, message='p-value capped')
            s, _, p = stats.anderson_ksamp([x1, x1 + .5])
        assert_almost_equal(s, -1.2944, 4)
        assert_equal(p, 0.25)

        # test case: check interpolated p-value in [0.01, 0.25] (no ties)
        s, _, p = stats.anderson_ksamp([x1, x1 + 7.5], midrank=False)
        assert_almost_equal(s, 1.4923, 4)
        assert_allclose(p, 0.0775, atol=0.005, rtol=0)

        # test case: check interpolated p-value in [0.01, 0.25] (w/ ties)
        s, _, p = stats.anderson_ksamp([x1, x1 + 6])
        assert_almost_equal(s, 0.6389, 4)
        assert_allclose(p, 0.1798, atol=0.005, rtol=0)

        # test extended critical values for p=0.001 and p=0.005
        s, _, p = stats.anderson_ksamp([x1, x1 + 11.5], midrank=False)
        assert_almost_equal(s, 4.5042, 4)
        assert_allclose(p, 0.00545, atol=0.0005, rtol=0)

        s, _, p = stats.anderson_ksamp([x1, x1 + 13.5], midrank=False)
        assert_almost_equal(s, 6.2982, 4)
        assert_allclose(p, 0.00118, atol=0.0001, rtol=0)

    def test_not_enough_samples(self):
        assert_raises(ValueError, stats.anderson_ksamp, np.ones(5))

    def test_no_distinct_observations(self):
        assert_raises(ValueError, stats.anderson_ksamp,
                      (np.ones(5), np.ones(5)))

    def test_empty_sample(self):
        assert_raises(ValueError, stats.anderson_ksamp, (np.ones(5), []))

    def test_result_attributes(self):
        # Pass a mixture of lists and arrays
        t1 = [38.7, 41.5, 43.8, 44.5, 45.5, 46.0, 47.7, 58.0]
        t2 = np.array([39.2, 39.3, 39.7, 41.4, 41.8, 42.9, 43.3, 45.8])
        res = stats.anderson_ksamp((t1, t2), midrank=False)

        attributes = ('statistic', 'critical_values', 'significance_level')
        check_named_results(res, attributes)

        assert_equal(res.significance_level, res.pvalue)


class TestAnsari:

    def test_small(self):
        x = [1, 2, 3, 3, 4]
        y = [3, 2, 6, 1, 6, 1, 4, 1]
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "Ties preclude use of exact statistic.")
            W, pval = stats.ansari(x, y)
        assert_almost_equal(W, 23.5, 11)
        assert_almost_equal(pval, 0.13499256881897437, 11)

    def test_approx(self):
        ramsay = np.array((111, 107, 100, 99, 102, 106, 109, 108, 104, 99,
                           101, 96, 97, 102, 107, 113, 116, 113, 110, 98))
        parekh = np.array((107, 108, 106, 98, 105, 103, 110, 105, 104,
                           100, 96, 108, 103, 104, 114, 114, 113, 108,
                           106, 99))

        with suppress_warnings() as sup:
            sup.filter(UserWarning, "Ties preclude use of exact statistic.")
            W, pval = stats.ansari(ramsay, parekh)

        assert_almost_equal(W, 185.5, 11)
        assert_almost_equal(pval, 0.18145819972867083, 11)

    def test_exact(self):
        W, pval = stats.ansari([1, 2, 3, 4], [15, 5, 20, 8, 10, 12])
        assert_almost_equal(W, 10.0, 11)
        assert_almost_equal(pval, 0.533333333333333333, 7)

    @pytest.mark.parametrize('args', [([], [1]), ([1], [])])
    def test_bad_arg(self, args):
        with pytest.warns(SmallSampleWarning, match=too_small_1d_not_omit):
            res = stats.ansari(*args)
            assert_equal(res.statistic, np.nan)
            assert_equal(res.pvalue, np.nan)

    def test_result_attributes(self):
        x = [1, 2, 3, 3, 4]
        y = [3, 2, 6, 1, 6, 1, 4, 1]
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "Ties preclude use of exact statistic.")
            res = stats.ansari(x, y)
        attributes = ('statistic', 'pvalue')
        check_named_results(res, attributes)

    def test_bad_alternative(self):
        # invalid value for alternative must raise a ValueError
        x1 = [1, 2, 3, 4]
        x2 = [5, 6, 7, 8]
        match = "'alternative' must be 'two-sided'"
        with assert_raises(ValueError, match=match):
            stats.ansari(x1, x2, alternative='foo')

    def test_alternative_exact(self):
        x1 = [-5, 1, 5, 10, 15, 20, 25]  # high scale, loc=10
        x2 = [7.5, 8.5, 9.5, 10.5, 11.5, 12.5]  # low scale, loc=10
        # ratio of scales is greater than 1. So, the
        # p-value must be high when `alternative='less'`
        # and low when `alternative='greater'`.
        statistic, pval = stats.ansari(x1, x2)
        pval_l = stats.ansari(x1, x2, alternative='less').pvalue
        pval_g = stats.ansari(x1, x2, alternative='greater').pvalue
        assert pval_l > 0.95
        assert pval_g < 0.05  # level of significance.
        # also check if the p-values sum up to 1 plus the probability
        # mass under the calculated statistic.
        prob = _abw_state.a.pmf(statistic, len(x1), len(x2))
        assert_allclose(pval_g + pval_l, 1 + prob, atol=1e-12)
        # also check if one of the one-sided p-value equals half the
        # two-sided p-value and the other one-sided p-value is its
        # compliment.
        assert_allclose(pval_g, pval/2, atol=1e-12)
        assert_allclose(pval_l, 1+prob-pval/2, atol=1e-12)
        # sanity check. The result should flip if
        # we exchange x and y.
        pval_l_reverse = stats.ansari(x2, x1, alternative='less').pvalue
        pval_g_reverse = stats.ansari(x2, x1, alternative='greater').pvalue
        assert pval_l_reverse < 0.05
        assert pval_g_reverse > 0.95

    @pytest.mark.parametrize(
        'x, y, alternative, expected',
        # the tests are designed in such a way that the
        # if else statement in ansari test for exact
        # mode is covered.
        [([1, 2, 3, 4], [5, 6, 7, 8], 'less', 0.6285714285714),
         ([1, 2, 3, 4], [5, 6, 7, 8], 'greater', 0.6285714285714),
         ([1, 2, 3], [4, 5, 6, 7, 8], 'less', 0.8928571428571),
         ([1, 2, 3], [4, 5, 6, 7, 8], 'greater', 0.2857142857143),
         ([1, 2, 3, 4, 5], [6, 7, 8], 'less', 0.2857142857143),
         ([1, 2, 3, 4, 5], [6, 7, 8], 'greater', 0.8928571428571)]
    )
    def test_alternative_exact_with_R(self, x, y, alternative, expected):
        # testing with R on arbitrary data
        # Sample R code used for the third test case above:
        # ```R
        # > options(digits=16)
        # > x <- c(1,2,3)
        # > y <- c(4,5,6,7,8)
        # > ansari.test(x, y, alternative='less', exact=TRUE)
        #
        #     Ansari-Bradley test
        #
        # data:  x and y
        # AB = 6, p-value = 0.8928571428571
        # alternative hypothesis: true ratio of scales is less than 1
        #
        # ```
        pval = stats.ansari(x, y, alternative=alternative).pvalue
        assert_allclose(pval, expected, atol=1e-12)

    def test_alternative_approx(self):
        # intuitive tests for approximation
        x1 = stats.norm.rvs(0, 5, size=100, random_state=123)
        x2 = stats.norm.rvs(0, 2, size=100, random_state=123)
        # for m > 55 or n > 55, the test should automatically
        # switch to approximation.
        pval_l = stats.ansari(x1, x2, alternative='less').pvalue
        pval_g = stats.ansari(x1, x2, alternative='greater').pvalue
        assert_allclose(pval_l, 1.0, atol=1e-12)
        assert_allclose(pval_g, 0.0, atol=1e-12)
        # also check if one of the one-sided p-value equals half the
        # two-sided p-value and the other one-sided p-value is its
        # compliment.
        x1 = stats.norm.rvs(0, 2, size=60, random_state=123)
        x2 = stats.norm.rvs(0, 1.5, size=60, random_state=123)
        pval = stats.ansari(x1, x2).pvalue
        pval_l = stats.ansari(x1, x2, alternative='less').pvalue
        pval_g = stats.ansari(x1, x2, alternative='greater').pvalue
        assert_allclose(pval_g, pval/2, atol=1e-12)
        assert_allclose(pval_l, 1-pval/2, atol=1e-12)


class TestBartlett:
    def test_data(self, xp):
        # https://www.itl.nist.gov/div898/handbook/eda/section3/eda357.htm
        args = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10]
        args = [xp.asarray(arg) for arg in args]
        T, pval = stats.bartlett(*args)
        xp_assert_close(T, xp.asarray(20.78587342806484))
        xp_assert_close(pval, xp.asarray(0.0136358632781))

    def test_too_few_args(self, xp):
        message = "Must enter at least two input sample vectors."
        with pytest.raises(ValueError, match=message):
            stats.bartlett(xp.asarray([1.]))

    def test_result_attributes(self, xp):
        args = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10]
        args = [xp.asarray(arg) for arg in args]
        res = stats.bartlett(*args)
        attributes = ('statistic', 'pvalue')
        check_named_results(res, attributes, xp=xp)

    @pytest.mark.filterwarnings("ignore:invalid value encountered in divide")
    def test_empty_arg(self, xp):
        args = (g1, g2, g3, g4, g5, g6, g7, g8, g9, g10, [])
        args = [xp.asarray(arg) for arg in args]
        if is_numpy(xp):
            with pytest.warns(SmallSampleWarning, match=too_small_1d_not_omit):
                res = stats.bartlett(*args)
        else:
            with np.testing.suppress_warnings() as sup:
                # torch/array_api_strict
                sup.filter(RuntimeWarning, "invalid value encountered")
                sup.filter(UserWarning, r"var\(\): degrees of freedom is <= 0.")
                sup.filter(RuntimeWarning, "Degrees of freedom <= 0 for slice")
                res = stats.bartlett(*args)
        NaN = xp.asarray(xp.nan)
        xp_assert_equal(res.statistic, NaN)
        xp_assert_equal(res.pvalue, NaN)

    def test_negative_pvalue_gh21152(self, xp):
        a = xp.asarray([10.1, 10.2, 10.3, 10.4], dtype=xp.float32)
        b = xp.asarray([10.15, 10.25, 10.35, 10.45], dtype=xp.float32)
        c = xp.asarray([10.05, 10.15, 10.25, 10.35], dtype=xp.float32)
        res = stats.bartlett(a, b, c)
        assert xp.all(res.statistic >= 0)


class TestLevene:

    def test_data(self):
        # https://www.itl.nist.gov/div898/handbook/eda/section3/eda35a.htm
        args = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10]
        W, pval = stats.levene(*args)
        assert_almost_equal(W, 1.7059176930008939, 7)
        assert_almost_equal(pval, 0.0990829755522, 7)

    def test_trimmed1(self):
        # Test that center='trimmed' gives the same result as center='mean'
        # when proportiontocut=0.
        W1, pval1 = stats.levene(g1, g2, g3, center='mean')
        W2, pval2 = stats.levene(g1, g2, g3, center='trimmed',
                                 proportiontocut=0.0)
        assert_almost_equal(W1, W2)
        assert_almost_equal(pval1, pval2)

    def test_trimmed2(self):
        x = [1.2, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 100.0]
        y = [0.0, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 200.0]
        np.random.seed(1234)
        x2 = np.random.permutation(x)

        # Use center='trimmed'
        W0, pval0 = stats.levene(x, y, center='trimmed',
                                 proportiontocut=0.125)
        W1, pval1 = stats.levene(x2, y, center='trimmed',
                                 proportiontocut=0.125)
        # Trim the data here, and use center='mean'
        W2, pval2 = stats.levene(x[1:-1], y[1:-1], center='mean')
        # Result should be the same.
        assert_almost_equal(W0, W2)
        assert_almost_equal(W1, W2)
        assert_almost_equal(pval1, pval2)

    def test_equal_mean_median(self):
        x = np.linspace(-1, 1, 21)
        np.random.seed(1234)
        x2 = np.random.permutation(x)
        y = x**3
        W1, pval1 = stats.levene(x, y, center='mean')
        W2, pval2 = stats.levene(x2, y, center='median')
        assert_almost_equal(W1, W2)
        assert_almost_equal(pval1, pval2)

    def test_bad_keyword(self):
        x = np.linspace(-1, 1, 21)
        assert_raises(TypeError, stats.levene, x, x, portiontocut=0.1)

    def test_bad_center_value(self):
        x = np.linspace(-1, 1, 21)
        assert_raises(ValueError, stats.levene, x, x, center='trim')

    def test_too_few_args(self):
        assert_raises(ValueError, stats.levene, [1])

    def test_result_attributes(self):
        args = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10]
        res = stats.levene(*args)
        attributes = ('statistic', 'pvalue')
        check_named_results(res, attributes)

    # temporary fix for issue #9252: only accept 1d input
    def test_1d_input(self):
        x = np.array([[1, 2], [3, 4]])
        assert_raises(ValueError, stats.levene, g1, x)


class TestBinomTest:
    """Tests for stats.binomtest."""

    # Expected results here are from R binom.test, e.g.
    # options(digits=16)
    # binom.test(484, 967, p=0.48)
    #
    def test_two_sided_pvalues1(self):
        # `tol` could be stricter on most architectures, but the value
        # here is limited by accuracy of `binom.cdf` for large inputs on
        # Linux_Python_37_32bit_full and aarch64
        rtol = 1e-10  # aarch64 observed rtol: 1.5e-11
        res = stats.binomtest(10079999, 21000000, 0.48)
        assert_allclose(res.pvalue, 1.0, rtol=rtol)
        res = stats.binomtest(10079990, 21000000, 0.48)
        assert_allclose(res.pvalue, 0.9966892187965, rtol=rtol)
        res = stats.binomtest(10080009, 21000000, 0.48)
        assert_allclose(res.pvalue, 0.9970377203856, rtol=rtol)
        res = stats.binomtest(10080017, 21000000, 0.48)
        assert_allclose(res.pvalue, 0.9940754817328, rtol=1e-9)

    def test_two_sided_pvalues2(self):
        rtol = 1e-10  # no aarch64 failure with 1e-15, preemptive bump
        res = stats.binomtest(9, n=21, p=0.48)
        assert_allclose(res.pvalue, 0.6689672431939, rtol=rtol)
        res = stats.binomtest(4, 21, 0.48)
        assert_allclose(res.pvalue, 0.008139563452106, rtol=rtol)
        res = stats.binomtest(11, 21, 0.48)
        assert_allclose(res.pvalue, 0.8278629664608, rtol=rtol)
        res = stats.binomtest(7, 21, 0.48)
        assert_allclose(res.pvalue, 0.1966772901718, rtol=rtol)
        res = stats.binomtest(3, 10, .5)
        assert_allclose(res.pvalue, 0.34375, rtol=rtol)
        res = stats.binomtest(2, 2, .4)
        assert_allclose(res.pvalue, 0.16, rtol=rtol)
        res = stats.binomtest(2, 4, .3)
        assert_allclose(res.pvalue, 0.5884, rtol=rtol)

    def test_edge_cases(self):
        rtol = 1e-10  # aarch64 observed rtol: 1.33e-15
        res = stats.binomtest(484, 967, 0.5)
        assert_allclose(res.pvalue, 1, rtol=rtol)
        res = stats.binomtest(3, 47, 3/47)
        assert_allclose(res.pvalue, 1, rtol=rtol)
        res = stats.binomtest(13, 46, 13/46)
        assert_allclose(res.pvalue, 1, rtol=rtol)
        res = stats.binomtest(15, 44, 15/44)
        assert_allclose(res.pvalue, 1, rtol=rtol)
        res = stats.binomtest(7, 13, 0.5)
        assert_allclose(res.pvalue, 1, rtol=rtol)
        res = stats.binomtest(6, 11, 0.5)
        assert_allclose(res.pvalue, 1, rtol=rtol)

    def test_binary_srch_for_binom_tst(self):
        # Test that old behavior of binomtest is maintained
        # by the new binary search method in cases where d
        # exactly equals the input on one side.
        n = 10
        p = 0.5
        k = 3
        # First test for the case where k > mode of PMF
        i = np.arange(np.ceil(p * n), n+1)
        d = stats.binom.pmf(k, n, p)
        # Old way of calculating y, probably consistent with R.
        y1 = np.sum(stats.binom.pmf(i, n, p) <= d, axis=0)
        # New way with binary search.
        ix = _binary_search_for_binom_tst(lambda x1:
                                          -stats.binom.pmf(x1, n, p),
                                          -d, np.ceil(p * n), n)
        y2 = n - ix + int(d == stats.binom.pmf(ix, n, p))
        assert_allclose(y1, y2, rtol=1e-9)
        # Now test for the other side.
        k = 7
        i = np.arange(np.floor(p * n) + 1)
        d = stats.binom.pmf(k, n, p)
        # Old way of calculating y.
        y1 = np.sum(stats.binom.pmf(i, n, p) <= d, axis=0)
        # New way with binary search.
        ix = _binary_search_for_binom_tst(lambda x1:
                                          stats.binom.pmf(x1, n, p),
                                          d, 0, np.floor(p * n))
        y2 = ix + 1
        assert_allclose(y1, y2, rtol=1e-9)

    # Expected results here are from R 3.6.2 binom.test
    @pytest.mark.parametrize('alternative, pval, ci_low, ci_high',
                             [('less', 0.148831050443,
                               0.0, 0.2772002496709138),
                              ('greater', 0.9004695898947,
                               0.1366613252458672, 1.0),
                              ('two-sided', 0.2983720970096,
                               0.1266555521019559, 0.2918426890886281)])
    def test_confidence_intervals1(self, alternative, pval, ci_low, ci_high):
        res = stats.binomtest(20, n=100, p=0.25, alternative=alternative)
        assert_allclose(res.pvalue, pval, rtol=1e-12)
        assert_equal(res.statistic, 0.2)
        ci = res.proportion_ci(confidence_level=0.95)
        assert_allclose((ci.low, ci.high), (ci_low, ci_high), rtol=1e-12)

    # Expected results here are from R 3.6.2 binom.test.
    @pytest.mark.parametrize('alternative, pval, ci_low, ci_high',
                             [('less',
                               0.005656361, 0.0, 0.1872093),
                              ('greater',
                               0.9987146, 0.008860761, 1.0),
                              ('two-sided',
                               0.01191714, 0.006872485, 0.202706269)])
    def test_confidence_intervals2(self, alternative, pval, ci_low, ci_high):
        res = stats.binomtest(3, n=50, p=0.2, alternative=alternative)
        assert_allclose(res.pvalue, pval, rtol=1e-6)
        assert_equal(res.statistic, 0.06)
        ci = res.proportion_ci(confidence_level=0.99)
        assert_allclose((ci.low, ci.high), (ci_low, ci_high), rtol=1e-6)

    # Expected results here are from R 3.6.2 binom.test.
    @pytest.mark.parametrize('alternative, pval, ci_high',
                             [('less', 0.05631351, 0.2588656),
                              ('greater', 1.0, 1.0),
                              ('two-sided', 0.07604122, 0.3084971)])
    def test_confidence_interval_exact_k0(self, alternative, pval, ci_high):
        # Test with k=0, n = 10.
        res = stats.binomtest(0, 10, p=0.25, alternative=alternative)
        assert_allclose(res.pvalue, pval, rtol=1e-6)
        ci = res.proportion_ci(confidence_level=0.95)
        assert_equal(ci.low, 0.0)
        assert_allclose(ci.high, ci_high, rtol=1e-6)

    # Expected results here are from R 3.6.2 binom.test.
    @pytest.mark.parametrize('alternative, pval, ci_low',
                             [('less', 1.0, 0.0),
                              ('greater', 9.536743e-07, 0.7411344),
                              ('two-sided', 9.536743e-07, 0.6915029)])
    def test_confidence_interval_exact_k_is_n(self, alternative, pval, ci_low):
        # Test with k = n = 10.
        res = stats.binomtest(10, 10, p=0.25, alternative=alternative)
        assert_allclose(res.pvalue, pval, rtol=1e-6)
        ci = res.proportion_ci(confidence_level=0.95)
        assert_equal(ci.high, 1.0)
        assert_allclose(ci.low, ci_low, rtol=1e-6)

    # Expected results are from the prop.test function in R 3.6.2.
    @pytest.mark.parametrize(
        'k, alternative, corr, conf, ci_low, ci_high',
        [[3, 'two-sided', True, 0.95, 0.08094782, 0.64632928],
         [3, 'two-sided', True, 0.99, 0.0586329, 0.7169416],
         [3, 'two-sided', False, 0.95, 0.1077913, 0.6032219],
         [3, 'two-sided', False, 0.99, 0.07956632, 0.6799753],
         [3, 'less', True, 0.95, 0.0, 0.6043476],
         [3, 'less', True, 0.99, 0.0, 0.6901811],
         [3, 'less', False, 0.95, 0.0, 0.5583002],
         [3, 'less', False, 0.99, 0.0, 0.6507187],
         [3, 'greater', True, 0.95, 0.09644904, 1.0],
         [3, 'greater', True, 0.99, 0.06659141, 1.0],
         [3, 'greater', False, 0.95, 0.1268766, 1.0],
         [3, 'greater', False, 0.99, 0.08974147, 1.0],

         [0, 'two-sided', True, 0.95, 0.0, 0.3445372],
         [0, 'two-sided', False, 0.95, 0.0, 0.2775328],
         [0, 'less', True, 0.95, 0.0, 0.2847374],
         [0, 'less', False, 0.95, 0.0, 0.212942],
         [0, 'greater', True, 0.95, 0.0, 1.0],
         [0, 'greater', False, 0.95, 0.0, 1.0],

         [10, 'two-sided', True, 0.95, 0.6554628, 1.0],
         [10, 'two-sided', False, 0.95, 0.7224672, 1.0],
         [10, 'less', True, 0.95, 0.0, 1.0],
         [10, 'less', False, 0.95, 0.0, 1.0],
         [10, 'greater', True, 0.95, 0.7152626, 1.0],
         [10, 'greater', False, 0.95, 0.787058, 1.0]]
    )
    def test_ci_wilson_method(self, k, alternative, corr, conf,
                              ci_low, ci_high):
        res = stats.binomtest(k, n=10, p=0.1, alternative=alternative)
        if corr:
            method = 'wilsoncc'
        else:
            method = 'wilson'
        ci = res.proportion_ci(confidence_level=conf, method=method)
        assert_allclose((ci.low, ci.high), (ci_low, ci_high), rtol=1e-6)

    def test_estimate_equals_hypothesized_prop(self):
        # Test the special case where the estimated proportion equals
        # the hypothesized proportion.  When alternative is 'two-sided',
        # the p-value is 1.
        res = stats.binomtest(4, 16, 0.25)
        assert_equal(res.statistic, 0.25)
        assert_equal(res.pvalue, 1.0)

    @pytest.mark.parametrize('k, n', [(0, 0), (-1, 2)])
    def test_invalid_k_n(self, k, n):
        with pytest.raises(ValueError,
                           match="must be an integer not less than"):
            stats.binomtest(k, n)

    def test_invalid_k_too_big(self):
        with pytest.raises(ValueError,
                           match=r"k \(11\) must not be greater than n \(10\)."):
            stats.binomtest(11, 10, 0.25)

    def test_invalid_k_wrong_type(self):
        with pytest.raises(TypeError,
                           match="k must be an integer."):
            stats.binomtest([10, 11], 21, 0.25)

    def test_invalid_p_range(self):
        message = r'p \(-0.5\) must be in range...'
        with pytest.raises(ValueError, match=message):
            stats.binomtest(50, 150, p=-0.5)
        message = r'p \(1.5\) must be in range...'
        with pytest.raises(ValueError, match=message):
            stats.binomtest(50, 150, p=1.5)

    def test_invalid_confidence_level(self):
        res = stats.binomtest(3, n=10, p=0.1)
        message = r"confidence_level \(-1\) must be in the interval"
        with pytest.raises(ValueError, match=message):
            res.proportion_ci(confidence_level=-1)

    def test_invalid_ci_method(self):
        res = stats.binomtest(3, n=10, p=0.1)
        with pytest.raises(ValueError, match=r"method \('plate of shrimp'\) must be"):
            res.proportion_ci(method="plate of shrimp")

    def test_invalid_alternative(self):
        with pytest.raises(ValueError, match=r"alternative \('ekki'\) not..."):
            stats.binomtest(3, n=10, p=0.1, alternative='ekki')

    def test_alias(self):
        res = stats.binomtest(3, n=10, p=0.1)
        assert_equal(res.proportion_estimate, res.statistic)

    @pytest.mark.skipif(sys.maxsize <= 2**32, reason="32-bit does not overflow")
    def test_boost_overflow_raises(self):
        # Boost.Math error policy should raise exceptions in Python
        with pytest.raises(OverflowError, match='Error in function...'):
            stats.binomtest(5, 6, p=sys.float_info.min)


class TestFligner:

    def test_data(self):
        # numbers from R: fligner.test in package stats
        x1 = np.arange(5)
        assert_array_almost_equal(stats.fligner(x1, x1**2),
                                  (3.2282229927203536, 0.072379187848207877),
                                  11)

    def test_trimmed1(self):
        # Perturb input to break ties in the transformed data
        # See https://github.com/scipy/scipy/pull/8042 for more details
        rs = np.random.RandomState(123)

        def _perturb(g):
            return (np.asarray(g) + 1e-10 * rs.randn(len(g))).tolist()

        g1_ = _perturb(g1)
        g2_ = _perturb(g2)
        g3_ = _perturb(g3)
        # Test that center='trimmed' gives the same result as center='mean'
        # when proportiontocut=0.
        Xsq1, pval1 = stats.fligner(g1_, g2_, g3_, center='mean')
        Xsq2, pval2 = stats.fligner(g1_, g2_, g3_, center='trimmed',
                                    proportiontocut=0.0)
        assert_almost_equal(Xsq1, Xsq2)
        assert_almost_equal(pval1, pval2)

    def test_trimmed2(self):
        x = [1.2, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 100.0]
        y = [0.0, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 200.0]
        # Use center='trimmed'
        Xsq1, pval1 = stats.fligner(x, y, center='trimmed',
                                    proportiontocut=0.125)
        # Trim the data here, and use center='mean'
        Xsq2, pval2 = stats.fligner(x[1:-1], y[1:-1], center='mean')
        # Result should be the same.
        assert_almost_equal(Xsq1, Xsq2)
        assert_almost_equal(pval1, pval2)

    # The following test looks reasonable at first, but fligner() uses the
    # function stats.rankdata(), and in one of the cases in this test,
    # there are ties, while in the other (because of normal rounding
    # errors) there are not.  This difference leads to differences in the
    # third significant digit of W.
    #
    #def test_equal_mean_median(self):
    #    x = np.linspace(-1,1,21)
    #    y = x**3
    #    W1, pval1 = stats.fligner(x, y, center='mean')
    #    W2, pval2 = stats.fligner(x, y, center='median')
    #    assert_almost_equal(W1, W2)
    #    assert_almost_equal(pval1, pval2)

    def test_bad_keyword(self):
        x = np.linspace(-1, 1, 21)
        assert_raises(TypeError, stats.fligner, x, x, portiontocut=0.1)

    def test_bad_center_value(self):
        x = np.linspace(-1, 1, 21)
        assert_raises(ValueError, stats.fligner, x, x, center='trim')

    def test_bad_num_args(self):
        # Too few args raises ValueError.
        assert_raises(ValueError, stats.fligner, [1])

    def test_empty_arg(self):
        x = np.arange(5)
        with pytest.warns(SmallSampleWarning, match=too_small_1d_not_omit):
            res = stats.fligner(x, x**2, [])
            assert_equal(res.statistic, np.nan)
            assert_equal(res.pvalue, np.nan)


def mood_cases_with_ties():
    # Generate random `x` and `y` arrays with ties both between and within the
    # samples. Expected results are (statistic, pvalue) from SAS.
    expected_results = [(-1.76658511464992, .0386488678399305),
                        (-.694031428192304, .2438312498647250),
                        (-1.15093525352151, .1248794365836150)]
    seeds = [23453254, 1298352315, 987234597]
    for si, seed in enumerate(seeds):
        rng = np.random.default_rng(seed)
        xy = rng.random(100)
        # Generate random indices to make ties
        tie_ind = rng.integers(low=0, high=99, size=5)
        # Generate a random number of ties for each index.
        num_ties_per_ind = rng.integers(low=1, high=5, size=5)
        # At each `tie_ind`, mark the next `n` indices equal to that value.
        for i, n in zip(tie_ind, num_ties_per_ind):
            for j in range(i + 1, i + n):
                xy[j] = xy[i]
        # scramble order of xy before splitting into `x, y`
        rng.shuffle(xy)
        x, y = np.split(xy, 2)
        yield x, y, 'less', *expected_results[si]


class TestMood:
    @pytest.mark.parametrize("x,y,alternative,stat_expect,p_expect",
                             mood_cases_with_ties())
    def test_against_SAS(self, x, y, alternative, stat_expect, p_expect):
        """
        Example code used to generate SAS output:
        DATA myData;
        INPUT X Y;
        CARDS;
        1 0
        1 1
        1 2
        1 3
        1 4
        2 0
        2 1
        2 4
        2 9
        2 16
        ods graphics on;
        proc npar1way mood data=myData ;
           class X;
            ods output  MoodTest=mt;
        proc contents data=mt;
        proc print data=mt;
          format     Prob1 17.16 Prob2 17.16 Statistic 17.16 Z 17.16 ;
            title "Mood Two-Sample Test";
        proc print data=myData;
            title "Data for above results";
          run;
        """
        statistic, pvalue = stats.mood(x, y, alternative=alternative)
        assert_allclose(stat_expect, statistic, atol=1e-16)
        assert_allclose(p_expect, pvalue, atol=1e-16)

    @pytest.mark.parametrize("alternative, expected",
                             [('two-sided', (1.019938533549930,
                                             .3077576129778760)),
                              ('less', (1.019938533549930,
                                        1 - .1538788064889380)),
                              ('greater', (1.019938533549930,
                                           .1538788064889380))])
    def test_against_SAS_2(self, alternative, expected):
        # Code to run in SAS in above function
        x = [111, 107, 100, 99, 102, 106, 109, 108, 104, 99,
             101, 96, 97, 102, 107, 113, 116, 113, 110, 98]
        y = [107, 108, 106, 98, 105, 103, 110, 105, 104, 100,
             96, 108, 103, 104, 114, 114, 113, 108, 106, 99]
        res = stats.mood(x, y, alternative=alternative)
        assert_allclose(res, expected)

    def test_mood_order_of_args(self):
        # z should change sign when the order of arguments changes, pvalue
        # should not change
        np.random.seed(1234)
        x1 = np.random.randn(10, 1)
        x2 = np.random.randn(15, 1)
        z1, p1 = stats.mood(x1, x2)
        z2, p2 = stats.mood(x2, x1)
        assert_array_almost_equal([z1, p1], [-z2, p2])

    def test_mood_with_axis_none(self):
        # Test with axis = None, compare with results from R
        x1 = [-0.626453810742332, 0.183643324222082, -0.835628612410047,
              1.59528080213779, 0.329507771815361, -0.820468384118015,
              0.487429052428485, 0.738324705129217, 0.575781351653492,
              -0.305388387156356, 1.51178116845085, 0.389843236411431,
              -0.621240580541804, -2.2146998871775, 1.12493091814311,
              -0.0449336090152309, -0.0161902630989461, 0.943836210685299,
              0.821221195098089, 0.593901321217509]

        x2 = [-0.896914546624981, 0.184849184646742, 1.58784533120882,
              -1.13037567424629, -0.0802517565509893, 0.132420284381094,
              0.707954729271733, -0.23969802417184, 1.98447393665293,
              -0.138787012119665, 0.417650750792556, 0.981752777463662,
              -0.392695355503813, -1.03966897694891, 1.78222896030858,
              -2.31106908460517, 0.878604580921265, 0.035806718015226,
              1.01282869212708, 0.432265154539617, 2.09081920524915,
              -1.19992581964387, 1.58963820029007, 1.95465164222325,
              0.00493777682814261, -2.45170638784613, 0.477237302613617,
              -0.596558168631403, 0.792203270299649, 0.289636710177348]

        x1 = np.array(x1)
        x2 = np.array(x2)
        x1.shape = (10, 2)
        x2.shape = (15, 2)
        assert_array_almost_equal(stats.mood(x1, x2, axis=None),
                                  [-1.31716607555, 0.18778296257])

    def test_mood_2d(self):
        # Test if the results of mood test in 2-D case are consistent with the
        # R result for the same inputs.  Numbers from R mood.test().
        ny = 5
        np.random.seed(1234)
        x1 = np.random.randn(10, ny)
        x2 = np.random.randn(15, ny)
        z_vectest, pval_vectest = stats.mood(x1, x2)

        for j in range(ny):
            assert_array_almost_equal([z_vectest[j], pval_vectest[j]],
                                      stats.mood(x1[:, j], x2[:, j]))

        # inverse order of dimensions
        x1 = x1.transpose()
        x2 = x2.transpose()
        z_vectest, pval_vectest = stats.mood(x1, x2, axis=1)

        for i in range(ny):
            # check axis handling is self consistent
            assert_array_almost_equal([z_vectest[i], pval_vectest[i]],
                                      stats.mood(x1[i, :], x2[i, :]))

    def test_mood_3d(self):
        shape = (10, 5, 6)
        np.random.seed(1234)
        x1 = np.random.randn(*shape)
        x2 = np.random.randn(*shape)

        for axis in range(3):
            z_vectest, pval_vectest = stats.mood(x1, x2, axis=axis)
            # Tests that result for 3-D arrays is equal to that for the
            # same calculation on a set of 1-D arrays taken from the
            # 3-D array
            axes_idx = ([1, 2], [0, 2], [0, 1])  # the two axes != axis
            for i in range(shape[axes_idx[axis][0]]):
                for j in range(shape[axes_idx[axis][1]]):
                    if axis == 0:
                        slice1 = x1[:, i, j]
                        slice2 = x2[:, i, j]
                    elif axis == 1:
                        slice1 = x1[i, :, j]
                        slice2 = x2[i, :, j]
                    else:
                        slice1 = x1[i, j, :]
                        slice2 = x2[i, j, :]

                    assert_array_almost_equal([z_vectest[i, j],
                                               pval_vectest[i, j]],
                                              stats.mood(slice1, slice2))

    def test_mood_bad_arg(self):
        # Warns when the sum of the lengths of the args is less than 3
        with pytest.warns(SmallSampleWarning, match=too_small_1d_not_omit):
            res = stats.mood([1], [])
            assert_equal(res.statistic, np.nan)
            assert_equal(res.pvalue, np.nan)

    def test_mood_alternative(self):

        rng = np.random.RandomState(0)
        x = stats.norm.rvs(scale=0.75, size=100, random_state=rng)
        y = stats.norm.rvs(scale=1.25, size=100, random_state=rng)

        stat1, p1 = stats.mood(x, y, alternative='two-sided')
        stat2, p2 = stats.mood(x, y, alternative='less')
        stat3, p3 = stats.mood(x, y, alternative='greater')

        assert stat1 == stat2 == stat3
        assert_allclose(p1, 0, atol=1e-7)
        assert_allclose(p2, p1/2)
        assert_allclose(p3, 1 - p1/2)

        with pytest.raises(ValueError, match="`alternative` must be..."):
            stats.mood(x, y, alternative='ekki-ekki')

    @pytest.mark.parametrize("alternative", ['two-sided', 'less', 'greater'])
    def test_result(self, alternative):
        rng = np.random.default_rng(265827767938813079281100964083953437622)
        x1 = rng.standard_normal((10, 1))
        x2 = rng.standard_normal((15, 1))

        res = stats.mood(x1, x2, alternative=alternative)
        assert_equal((res.statistic, res.pvalue), res)


class TestProbplot:

    def test_basic(self):
        x = stats.norm.rvs(size=20, random_state=12345)
        osm, osr = stats.probplot(x, fit=False)
        osm_expected = [-1.8241636, -1.38768012, -1.11829229, -0.91222575,
                        -0.73908135, -0.5857176, -0.44506467, -0.31273668,
                        -0.18568928, -0.06158146, 0.06158146, 0.18568928,
                        0.31273668, 0.44506467, 0.5857176, 0.73908135,
                        0.91222575, 1.11829229, 1.38768012, 1.8241636]
        assert_allclose(osr, np.sort(x))
        assert_allclose(osm, osm_expected)

        res, res_fit = stats.probplot(x, fit=True)
        res_fit_expected = [1.05361841, 0.31297795, 0.98741609]
        assert_allclose(res_fit, res_fit_expected)

    def test_sparams_keyword(self):
        x = stats.norm.rvs(size=100, random_state=123456)
        # Check that None, () and 0 (loc=0, for normal distribution) all work
        # and give the same results
        osm1, osr1 = stats.probplot(x, sparams=None, fit=False)
        osm2, osr2 = stats.probplot(x, sparams=0, fit=False)
        osm3, osr3 = stats.probplot(x, sparams=(), fit=False)
        assert_allclose(osm1, osm2)
        assert_allclose(osm1, osm3)
        assert_allclose(osr1, osr2)
        assert_allclose(osr1, osr3)
        # Check giving (loc, scale) params for normal distribution
        osm, osr = stats.probplot(x, sparams=(), fit=False)

    def test_dist_keyword(self):
        x = stats.norm.rvs(size=20, random_state=12345)
        osm1, osr1 = stats.probplot(x, fit=False, dist='t', sparams=(3,))
        osm2, osr2 = stats.probplot(x, fit=False, dist=stats.t, sparams=(3,))
        assert_allclose(osm1, osm2)
        assert_allclose(osr1, osr2)

        assert_raises(ValueError, stats.probplot, x, dist='wrong-dist-name')
        assert_raises(AttributeError, stats.probplot, x, dist=[])

        class custom_dist:
            """Some class that looks just enough like a distribution."""
            def ppf(self, q):
                return stats.norm.ppf(q, loc=2)

        osm1, osr1 = stats.probplot(x, sparams=(2,), fit=False)
        osm2, osr2 = stats.probplot(x, dist=custom_dist(), fit=False)
        assert_allclose(osm1, osm2)
        assert_allclose(osr1, osr2)

    @pytest.mark.thread_unsafe
    @pytest.mark.skipif(not have_matplotlib, reason="no matplotlib")
    def test_plot_kwarg(self):
        fig = plt.figure()
        fig.add_subplot(111)
        x = stats.t.rvs(3, size=100, random_state=7654321)
        res1, fitres1 = stats.probplot(x, plot=plt)
        plt.close()
        res2, fitres2 = stats.probplot(x, plot=None)
        res3 = stats.probplot(x, fit=False, plot=plt)
        plt.close()
        res4 = stats.probplot(x, fit=False, plot=None)
        # Check that results are consistent between combinations of `fit` and
        # `plot` keywords.
        assert_(len(res1) == len(res2) == len(res3) == len(res4) == 2)
        assert_allclose(res1, res2)
        assert_allclose(res1, res3)
        assert_allclose(res1, res4)
        assert_allclose(fitres1, fitres2)

        # Check that a Matplotlib Axes object is accepted
        fig = plt.figure()
        ax = fig.add_subplot(111)
        stats.probplot(x, fit=False, plot=ax)
        plt.close()

    def test_probplot_bad_args(self):
        # Raise ValueError when given an invalid distribution.
        assert_raises(ValueError, stats.probplot, [1], dist="plate_of_shrimp")

    def test_empty(self):
        assert_equal(stats.probplot([], fit=False),
                     (np.array([]), np.array([])))
        assert_equal(stats.probplot([], fit=True),
                     ((np.array([]), np.array([])),
                      (np.nan, np.nan, 0.0)))

    def test_array_of_size_one(self):
        message = "One or more sample arguments is too small..."
        with (np.errstate(invalid='ignore'),
              pytest.warns(SmallSampleWarning, match=message)):
            assert_equal(stats.probplot([1], fit=True),
                         ((np.array([0.]), np.array([1])),
                          (np.nan, np.nan, np.nan)))


class TestWilcoxon:
    def test_wilcoxon_bad_arg(self):
        # Raise ValueError when two args of different lengths are given or
        # zero_method is unknown.
        assert_raises(ValueError, stats.wilcoxon, [1, 2], [1, 2], "dummy")
        assert_raises(ValueError, stats.wilcoxon, [1, 2], [1, 2],
                      alternative="dummy")
        assert_raises(ValueError, stats.wilcoxon, [1]*10, method="xyz")

    def test_zero_diff(self):
        x = np.arange(20)
        # pratt and wilcox do not work if x - y == 0 and method == "asymptotic"
        # => warning may be emitted and p-value is nan
        with np.errstate(invalid="ignore"):
            w, p = stats.wilcoxon(x, x, "wilcox", method="asymptotic")
            assert_equal((w, p), (0.0, np.nan))
            w, p = stats.wilcoxon(x, x, "pratt", method="asymptotic")
            assert_equal((w, p), (0.0, np.nan))
        # ranksum is n*(n+1)/2, split in half if zero_method == "zsplit"
        assert_equal(stats.wilcoxon(x, x, "zsplit", method="asymptotic"),
                     (20*21/4, 1.0))

    def test_pratt(self):
        # regression test for gh-6805: p-value matches value from R package
        # coin (wilcoxsign_test) reported in the issue
        x = [1, 2, 3, 4]
        y = [1, 2, 3, 5]
        res = stats.wilcoxon(x, y, zero_method="pratt", method="asymptotic",
                             correction=False)
        assert_allclose(res, (0.0, 0.31731050786291415))

    def test_wilcoxon_arg_type(self):
        # Should be able to accept list as arguments.
        # Address issue 6070.
        arr = [1, 2, 3, 0, -1, 3, 1, 2, 1, 1, 2]

        _ = stats.wilcoxon(arr, zero_method="pratt", method="asymptotic")
        _ = stats.wilcoxon(arr, zero_method="zsplit", method="asymptotic")
        _ = stats.wilcoxon(arr, zero_method="wilcox", method="asymptotic")

    def test_accuracy_wilcoxon(self):
        freq = [1, 4, 16, 15, 8, 4, 5, 1, 2]
        nums = range(-4, 5)
        x = np.concatenate([[u] * v for u, v in zip(nums, freq)])
        y = np.zeros(x.size)

        T, p = stats.wilcoxon(x, y, "pratt", method="asymptotic",
                              correction=False)
        assert_allclose(T, 423)
        assert_allclose(p, 0.0031724568006762576)

        T, p = stats.wilcoxon(x, y, "zsplit", method="asymptotic",
                              correction=False)
        assert_allclose(T, 441)
        assert_allclose(p, 0.0032145343172473055)

        T, p = stats.wilcoxon(x, y, "wilcox", method="asymptotic",
                              correction=False)
        assert_allclose(T, 327)
        assert_allclose(p, 0.00641346115861)

        # Test the 'correction' option, using values computed in R with:
        # > wilcox.test(x, y, paired=TRUE, exact=FALSE, correct={FALSE,TRUE})
        x = np.array([120, 114, 181, 188, 180, 146, 121, 191, 132, 113, 127, 112])
        y = np.array([133, 143, 119, 189, 112, 199, 198, 113, 115, 121, 142, 187])
        T, p = stats.wilcoxon(x, y, correction=False, method="asymptotic")
        assert_equal(T, 34)
        assert_allclose(p, 0.6948866, rtol=1e-6)
        T, p = stats.wilcoxon(x, y, correction=True, method="asymptotic")
        assert_equal(T, 34)
        assert_allclose(p, 0.7240817, rtol=1e-6)

    def test_approx_mode(self):
        # Check that `mode` is still an alias of keyword `method`,
        # and `"approx"` is still an alias of argument `"asymptotic"`
        x = np.array([3, 5, 23, 7, 243, 58, 98, 2, 8, -3, 9, 11])
        y = np.array([2, -2, 1, 23, 0, 5, 12, 18, 99, 12, 17, 27])
        res1 = stats.wilcoxon(x, y, "wilcox", method="approx")
        res2 = stats.wilcoxon(x, y, "wilcox", method="asymptotic")
        res3 = stats.wilcoxon(x, y, "wilcox", mode="approx")
        res4 = stats.wilcoxon(x, y, "wilcox", mode="asymptotic")
        assert res1 == res2 == res3 == res4

    def test_wilcoxon_result_attributes(self):
        x = np.array([120, 114, 181, 188, 180, 146, 121, 191, 132, 113, 127, 112])
        y = np.array([133, 143, 119, 189, 112, 199, 198, 113, 115, 121, 142, 187])
        res = stats.wilcoxon(x, y, correction=False, method="asymptotic")
        attributes = ('statistic', 'pvalue')
        check_named_results(res, attributes)

    def test_wilcoxon_has_zstatistic(self):
        rng = np.random.default_rng(89426135444)
        x, y = rng.random(15), rng.random(15)

        res = stats.wilcoxon(x, y, method="asymptotic")
        ref = stats.norm.ppf(res.pvalue/2)
        assert_allclose(res.zstatistic, ref)

        res = stats.wilcoxon(x, y, method="exact")
        assert not hasattr(res, 'zstatistic')

        res = stats.wilcoxon(x, y)
        assert not hasattr(res, 'zstatistic')

    def test_wilcoxon_tie(self):
        # Regression test for gh-2391.
        # Corresponding R code is:
        #   > result = wilcox.test(rep(0.1, 10), exact=FALSE, correct=FALSE)
        #   > result$p.value
        #   [1] 0.001565402
        #   > result = wilcox.test(rep(0.1, 10), exact=FALSE, correct=TRUE)
        #   > result$p.value
        #   [1] 0.001904195
        stat, p = stats.wilcoxon([0.1] * 10, method="asymptotic",
                                 correction=False)
        expected_p = 0.001565402
        assert_equal(stat, 0)
        assert_allclose(p, expected_p, rtol=1e-6)

        stat, p = stats.wilcoxon([0.1] * 10, correction=True,
                                 method="asymptotic")
        expected_p = 0.001904195
        assert_equal(stat, 0)
        assert_allclose(p, expected_p, rtol=1e-6)

    def test_onesided(self):
        # tested against "R version 3.4.1 (2017-06-30)"
        # x <- c(125, 115, 130, 140, 140, 115, 140, 125, 140, 135)
        # y <- c(110, 122, 125, 120, 140, 124, 123, 137, 135, 145)
        # cfg <- list(x = x, y = y, paired = TRUE, exact = FALSE)
        # do.call(wilcox.test, c(cfg, list(alternative = "less", correct = FALSE)))
        # do.call(wilcox.test, c(cfg, list(alternative = "less", correct = TRUE)))
        # do.call(wilcox.test, c(cfg, list(alternative = "greater", correct = FALSE)))
        # do.call(wilcox.test, c(cfg, list(alternative = "greater", correct = TRUE)))
        x = [125, 115, 130, 140, 140, 115, 140, 125, 140, 135]
        y = [110, 122, 125, 120, 140, 124, 123, 137, 135, 145]

        w, p = stats.wilcoxon(x, y, alternative="less", method="asymptotic",
                              correction=False)
        assert_equal(w, 27)
        assert_almost_equal(p, 0.7031847, decimal=6)

        w, p = stats.wilcoxon(x, y, alternative="less", correction=True,
                              method="asymptotic")
        assert_equal(w, 27)
        assert_almost_equal(p, 0.7233656, decimal=6)

        w, p = stats.wilcoxon(x, y, alternative="greater",
                              method="asymptotic", correction=False)
        assert_equal(w, 27)
        assert_almost_equal(p, 0.2968153, decimal=6)

        w, p = stats.wilcoxon(x, y, alternative="greater",
                              correction=True, method="asymptotic")
        assert_equal(w, 27)
        assert_almost_equal(p, 0.3176447, decimal=6)

    def test_exact_basic(self):
        for n in range(1, 51):
            pmf1 = _get_wilcoxon_distr(n)
            pmf2 = _get_wilcoxon_distr2(n)
            assert_equal(n*(n+1)/2 + 1, len(pmf1))
            assert_equal(sum(pmf1), 1)
            assert_array_almost_equal(pmf1, pmf2)

    def test_exact_pval(self):
        # expected values computed with "R version 3.4.1 (2017-06-30)"
        x = np.array([1.81, 0.82, 1.56, -0.48, 0.81, 1.28, -1.04, 0.23,
                      -0.75, 0.14])
        y = np.array([0.71, 0.65, -0.2, 0.85, -1.1, -0.45, -0.84, -0.24,
                      -0.68, -0.76])
        _, p = stats.wilcoxon(x, y, alternative="two-sided", method="exact")
        assert_almost_equal(p, 0.1054688, decimal=6)
        _, p = stats.wilcoxon(x, y, alternative="less", method="exact")
        assert_almost_equal(p, 0.9580078, decimal=6)
        _, p = stats.wilcoxon(x, y, alternative="greater", method="exact")
        assert_almost_equal(p, 0.05273438, decimal=6)

        x = np.arange(0, 20) + 0.5
        y = np.arange(20, 0, -1)
        _, p = stats.wilcoxon(x, y, alternative="two-sided", method="exact")
        assert_almost_equal(p, 0.8694878, decimal=6)
        _, p = stats.wilcoxon(x, y, alternative="less", method="exact")
        assert_almost_equal(p, 0.4347439, decimal=6)
        _, p = stats.wilcoxon(x, y, alternative="greater", method="exact")
        assert_almost_equal(p, 0.5795889, decimal=6)

    # These inputs were chosen to give a W statistic that is either the
    # center of the distribution (when the length of the support is odd), or
    # the value to the left of the center (when the length of the support is
    # even).  Also, the numbers are chosen so that the W statistic is the
    # sum of the positive values.

    @pytest.mark.parametrize('x', [[-1, -2, 3],
                                   [-1, 2, -3, -4, 5],
                                   [-1, -2, 3, -4, -5, -6, 7, 8]])
    def test_exact_p_1(self, x):
        w, p = stats.wilcoxon(x)
        x = np.array(x)
        wtrue = x[x > 0].sum()
        assert_equal(w, wtrue)
        assert_equal(p, 1)

    def test_auto(self):
        # auto default to exact if there are no ties and n <= 50
        x = np.arange(0, 50) + 0.5
        y = np.arange(50, 0, -1)
        assert_equal(stats.wilcoxon(x, y),
                     stats.wilcoxon(x, y, method="exact"))

        # n <= 50: if there are zeros in d = x-y, use PermutationMethod
        pm = stats.PermutationMethod()
        d = np.arange(-2, 5)
        w, p = stats.wilcoxon(d)
        # rerunning the test gives the same results since n_resamples
        # is large enough to get deterministic results if n <= 13
        # so we do not need to use a seed. to avoid longer runtimes of the
        # test, use n=7 only. For n=13, see test_auto_permutation_edge_case
        assert_equal((w, p), stats.wilcoxon(d, method=pm))

        # for larger vectors (n > 13) with ties/zeros, use asymptotic test
        d = np.arange(-5, 9)  # zero
        w, p = stats.wilcoxon(d)
        assert_equal((w, p), stats.wilcoxon(d, method="asymptotic"))

        d[d == 0] = 1  # tie
        w, p = stats.wilcoxon(d)
        assert_equal((w, p), stats.wilcoxon(d, method="asymptotic"))

        # use approximation for samples > 50
        d = np.arange(1, 52)
        assert_equal(stats.wilcoxon(d), stats.wilcoxon(d, method="asymptotic"))

    @pytest.mark.xslow
    def test_auto_permutation_edge_case(self):
        # Check that `PermutationMethod()` is used and results are deterministic when
        # `method='auto'`, there are zeros or ties in `d = x-y`, and `len(d) <= 13`.
        d = np.arange(-5, 8)  # zero
        res = stats.wilcoxon(d)
        ref = (27.5, 0.3955078125)  # stats.wilcoxon(d, method=PermutationMethod())
        assert_equal(res, ref)

        d[d == 0] = 1  # tie
        res = stats.wilcoxon(d)
        ref = (32, 0.3779296875)  # stats.wilcoxon(d, method=PermutationMethod())
        assert_equal(res, ref)

    @pytest.mark.parametrize('size', [3, 5, 10])
    def test_permutation_method(self, size):
        rng = np.random.default_rng(92348034828501345)
        x = rng.random(size=size)
        res = stats.wilcoxon(x, method=stats.PermutationMethod())
        ref = stats.wilcoxon(x, method='exact')
        assert_equal(res.statistic, ref.statistic)
        assert_equal(res.pvalue, ref.pvalue)

        x = rng.random(size=size*10)
        rng = np.random.default_rng(59234803482850134)
        pm = stats.PermutationMethod(n_resamples=99, rng=rng)
        ref = stats.wilcoxon(x, method=pm)
        # preserve use of old random_state during SPEC 7 transition
        rng = np.random.default_rng(59234803482850134)
        pm = stats.PermutationMethod(n_resamples=99, random_state=rng)
        res = stats.wilcoxon(x, method=pm)

        assert_equal(np.round(res.pvalue, 2), res.pvalue)  # n_resamples used
        assert_equal(res.pvalue, ref.pvalue)  # rng/random_state used

    def test_method_auto_nan_propagate_ND_length_gt_50_gh20591(self):
        # When method!='asymptotic', nan_policy='propagate', and a slice of
        # a >1 dimensional array input contained NaN, the result object of
        # `wilcoxon` could (under yet other conditions) return `zstatistic`
        # for some slices but not others. This resulted in an error because
        # `apply_along_axis` would have to create a ragged array.
        # Check that this is resolved.
        rng = np.random.default_rng(235889269872456)
        A = rng.normal(size=(51, 2))  # length along slice > exact threshold
        A[5, 1] = np.nan
        res = stats.wilcoxon(A)
        ref = stats.wilcoxon(A, method='asymptotic')
        assert_allclose(res, ref)
        assert hasattr(ref, 'zstatistic')
        assert not hasattr(res, 'zstatistic')

    @pytest.mark.parametrize('method', ['exact', 'asymptotic'])
    def test_symmetry_gh19872_gh20752(self, method):
        # Check that one-sided exact tests obey required symmetry. Bug reported
        # in gh-19872 and again in gh-20752; example from gh-19872 is more concise:
        var1 = [62, 66, 61, 68, 74, 62, 68, 62, 55, 59]
        var2 = [71, 71, 69, 61, 75, 71, 77, 72, 62, 65]
        ref = stats.wilcoxon(var1, var2, alternative='less', method=method)
        res = stats.wilcoxon(var2, var1, alternative='greater', method=method)
        max_statistic = len(var1) * (len(var1) + 1) / 2
        assert int(res.statistic) != res.statistic
        assert_allclose(max_statistic - res.statistic, ref.statistic, rtol=1e-15)
        assert_allclose(res.pvalue, ref.pvalue, rtol=1e-15)

    @pytest.mark.parametrize("method", ('exact', stats.PermutationMethod()))
    def test_all_zeros_exact(self, method):
        # previously, this raised a RuntimeWarning when calculating Z, even
        # when the Z value was not needed. Confirm that this no longer
        # occurs when `method` is 'exact' or a `PermutationMethod`.
        res = stats.wilcoxon(np.zeros(5), method=method)
        assert_allclose(res, [0, 1])

    def test_wilcoxon_axis_broadcasting_errors_gh22051(self):
        # In previous versions of SciPy, `wilcoxon` gave an incorrect error
        # message when `AxisError` was not found in the base NumPy namespace.
        # Check that this is resolved with and without the ANP decorator.
        message = "Array shapes are incompatible for broadcasting."
        with pytest.raises(ValueError, match=message):
            stats.wilcoxon([1, 2, 3], [4, 5])

        message = "operands could not be broadcast together with..."
        with pytest.raises(ValueError, match=message):
            stats.wilcoxon([1, 2, 3], [4, 5], _no_deco=True)

        AxisError = getattr(np, 'AxisError', None) or np.exceptions.AxisError
        message = "source: axis 3 is out of bounds for array of dimension 1"
        with pytest.raises(AxisError, match=message):
            stats.wilcoxon([1, 2, 3], [4, 5, 6], axis=3)

        message = "`axis` must be compatible with the shape..."
        with pytest.raises(AxisError, match=message):
            stats.wilcoxon([1, 2, 3], [4, 5, 6], axis=3, _no_deco=True)


# data for k-statistics tests from
# https://cran.r-project.org/web/packages/kStatistics/kStatistics.pdf
# see nKS "Examples"
x_kstat = [16.34, 10.76, 11.84, 13.55, 15.85, 18.20, 7.51, 10.22, 12.52, 14.68,
           16.08, 19.43, 8.12, 11.20, 12.95, 14.77, 16.83, 19.80, 8.55, 11.58,
           12.10, 15.02, 16.83, 16.98, 19.92, 9.47, 11.68, 13.41, 15.35, 19.11]


class TestKstat:
    def test_moments_normal_distribution(self, xp):
        rng = np.random.RandomState(32149)
        data = xp.asarray(rng.randn(12345), dtype=xp.float64)
        moments = xp.stack([stats.kstat(data, n) for n in [1, 2, 3, 4]])

        expected = xp.asarray([0.011315, 1.017931, 0.05811052, 0.0754134],
                              dtype=data.dtype)
        xp_assert_close(moments, expected, rtol=1e-4)

        # test equivalence with `stats.moment`
        m1 = stats.moment(data, order=1)
        m2 = stats.moment(data, order=2)
        m3 = stats.moment(data, order=3)
        xp_assert_close(xp.stack((m1, m2, m3)), expected[:-1], atol=0.02, rtol=1e-2)

    @pytest.mark.filterwarnings("ignore:invalid value encountered in scalar divide")
    def test_empty_input(self, xp):
        if is_numpy(xp):
            with pytest.warns(SmallSampleWarning, match=too_small_1d_not_omit):
                res = stats.kstat(xp.asarray([]))
        else:
            with np.errstate(invalid='ignore'):  # for array_api_strict
                res = stats.kstat(xp.asarray([]))
        xp_assert_equal(res, xp.asarray(xp.nan))

    def test_nan_input(self, xp):
        data = xp.arange(10.)
        data = xp.where(data == 6, xp.nan, data)

        xp_assert_equal(stats.kstat(data), xp.asarray(xp.nan))

    @pytest.mark.parametrize('n', [0, 4.001])
    def test_kstat_bad_arg(self, n, xp):
        # Raise ValueError if n > 4 or n < 1.
        data = xp.arange(10)
        message = 'k-statistics only supported for 1<=n<=4'
        with pytest.raises(ValueError, match=message):
            stats.kstat(data, n=n)

    @pytest.mark.parametrize('case', [(1, 14.02166666666667),
                                      (2, 12.65006954022974),
                                      (3, -1.447059503280798),
                                      (4, -141.6682291883626)])
    def test_against_R(self, case, xp):
        # Test against reference values computed with R kStatistics, e.g.
        # options(digits=16)
        # library(kStatistics)
        # data <-c (16.34, 10.76, 11.84, 13.55, 15.85, 18.20, 7.51, 10.22,
        #           12.52, 14.68, 16.08, 19.43, 8.12, 11.20, 12.95, 14.77,
        #           16.83, 19.80, 8.55, 11.58, 12.10, 15.02, 16.83, 16.98,
        #           19.92, 9.47, 11.68, 13.41, 15.35, 19.11)
        # nKS(4, data)
        n, ref = case
        res = stats.kstat(xp.asarray(x_kstat), n)
        xp_assert_close(res, xp.asarray(ref))


class TestKstatVar:
    @pytest.mark.filterwarnings("ignore:invalid value encountered in scalar divide")
    def test_empty_input(self, xp):
        x = xp.asarray([])
        if is_numpy(xp):
            with pytest.warns(SmallSampleWarning, match=too_small_1d_not_omit):
                res = stats.kstatvar(x)
        else:
            with np.errstate(invalid='ignore'):  # for array_api_strict
                res = stats.kstatvar(x)
        xp_assert_equal(res, xp.asarray(xp.nan))

    def test_nan_input(self, xp):
        data = xp.arange(10.)
        data = xp.where(data == 6, xp.nan, data)

        xp_assert_equal(stats.kstat(data), xp.asarray(xp.nan))

    @skip_xp_backends(np_only=True,
                      reason='input validation of `n` does not depend on backend')
    def test_bad_arg(self, xp):
        # Raise ValueError is n is not 1 or 2.
        data = [1]
        n = 10
        message = 'Only n=1 or n=2 supported.'
        with pytest.raises(ValueError, match=message):
            stats.kstatvar(data, n=n)

    def test_against_R_mathworld(self, xp):
        # Test against reference values computed using formulas exactly as
        # they appear at https://mathworld.wolfram.com/k-Statistic.html
        # This is *really* similar to how they appear in the implementation,
        # but that could change, and this should not.
        n = len(x_kstat)
        k2 = 12.65006954022974  # see source code in TestKstat
        k4 = -141.6682291883626

        res = stats.kstatvar(xp.asarray(x_kstat), 1)
        ref = k2 / n
        xp_assert_close(res, xp.asarray(ref))

        res = stats.kstatvar(xp.asarray(x_kstat), 2)
        # *unbiased estimator* for var(k2)
        ref = (2*k2**2*n + (n-1)*k4) / (n * (n+1))
        xp_assert_close(res, xp.asarray(ref))


class TestPpccPlot:
    def setup_method(self):
        self.x = _old_loggamma_rvs(5, size=500, random_state=7654321) + 5

    def test_basic(self):
        N = 5
        svals, ppcc = stats.ppcc_plot(self.x, -10, 10, N=N)
        ppcc_expected = [0.21139644, 0.21384059, 0.98766719, 0.97980182,
                         0.93519298]
        assert_allclose(svals, np.linspace(-10, 10, num=N))
        assert_allclose(ppcc, ppcc_expected)

    def test_dist(self):
        # Test that we can specify distributions both by name and as objects.
        svals1, ppcc1 = stats.ppcc_plot(self.x, -10, 10, dist='tukeylambda')
        svals2, ppcc2 = stats.ppcc_plot(self.x, -10, 10,
                                        dist=stats.tukeylambda)
        assert_allclose(svals1, svals2, rtol=1e-20)
        assert_allclose(ppcc1, ppcc2, rtol=1e-20)
        # Test that 'tukeylambda' is the default dist
        svals3, ppcc3 = stats.ppcc_plot(self.x, -10, 10)
        assert_allclose(svals1, svals3, rtol=1e-20)
        assert_allclose(ppcc1, ppcc3, rtol=1e-20)

    @pytest.mark.skipif(not have_matplotlib, reason="no matplotlib")
    def test_plot_kwarg(self):
        # Check with the matplotlib.pyplot module
        fig = plt.figure()
        ax = fig.add_subplot(111)
        stats.ppcc_plot(self.x, -20, 20, plot=plt)
        fig.delaxes(ax)

        # Check that a Matplotlib Axes object is accepted
        ax = fig.add_subplot(111)
        stats.ppcc_plot(self.x, -20, 20, plot=ax)
        plt.close()

    def test_invalid_inputs(self):
        # `b` has to be larger than `a`
        assert_raises(ValueError, stats.ppcc_plot, self.x, 1, 0)

        # Raise ValueError when given an invalid distribution.
        assert_raises(ValueError, stats.ppcc_plot, [1, 2, 3], 0, 1,
                      dist="plate_of_shrimp")

    def test_empty(self):
        # For consistency with probplot return for one empty array,
        # ppcc contains all zeros and svals is the same as for normal array
        # input.
        svals, ppcc = stats.ppcc_plot([], 0, 1)
        assert_allclose(svals, np.linspace(0, 1, num=80))
        assert_allclose(ppcc, np.zeros(80, dtype=float))


class TestPpccMax:
    def test_ppcc_max_bad_arg(self):
        # Raise ValueError when given an invalid distribution.
        data = [1]
        assert_raises(ValueError, stats.ppcc_max, data, dist="plate_of_shrimp")

    def test_ppcc_max_basic(self):
        x = stats.tukeylambda.rvs(-0.7, loc=2, scale=0.5, size=10000,
                                  random_state=1234567) + 1e4
        assert_almost_equal(stats.ppcc_max(x), -0.71215366521264145, decimal=7)

    def test_dist(self):
        x = stats.tukeylambda.rvs(-0.7, loc=2, scale=0.5, size=10000,
                                  random_state=1234567) + 1e4

        # Test that we can specify distributions both by name and as objects.
        max1 = stats.ppcc_max(x, dist='tukeylambda')
        max2 = stats.ppcc_max(x, dist=stats.tukeylambda)
        assert_almost_equal(max1, -0.71215366521264145, decimal=5)
        assert_almost_equal(max2, -0.71215366521264145, decimal=5)

        # Test that 'tukeylambda' is the default dist
        max3 = stats.ppcc_max(x)
        assert_almost_equal(max3, -0.71215366521264145, decimal=5)

    def test_brack(self):
        x = stats.tukeylambda.rvs(-0.7, loc=2, scale=0.5, size=10000,
                                  random_state=1234567) + 1e4
        assert_raises(ValueError, stats.ppcc_max, x, brack=(0.0, 1.0, 0.5))

        assert_almost_equal(stats.ppcc_max(x, brack=(0, 1)),
                            -0.71215366521264145, decimal=7)

        assert_almost_equal(stats.ppcc_max(x, brack=(-2, 2)),
                            -0.71215366521264145, decimal=7)


class TestBoxcox_llf:

    @pytest.mark.parametrize("dtype", ["float32", "float64"])
    def test_basic(self, dtype, xp):
        dt = getattr(xp, dtype)
        x = stats.norm.rvs(size=10000, loc=10, random_state=54321)
        lmbda = 1
        llf = stats.boxcox_llf(lmbda, xp.asarray(x, dtype=dt))
        llf_expected = -x.size / 2. * np.log(np.sum(x.std()**2))
        xp_assert_close(llf, xp.asarray(llf_expected, dtype=dt))

    @skip_xp_backends(np_only=True,
                      reason='array-likes only accepted for NumPy backend.')
    def test_array_like(self, xp):
        x = stats.norm.rvs(size=100, loc=10, random_state=54321)
        lmbda = 1
        llf = stats.boxcox_llf(lmbda, x)
        llf2 = stats.boxcox_llf(lmbda, list(x))
        xp_assert_close(llf, llf2, rtol=1e-12)

    def test_2d_input(self, xp):
        # Note: boxcox_llf() was already working with 2-D input (sort of), so
        # keep it like that.  boxcox() doesn't work with 2-D input though, due
        # to brent() returning a scalar.
        x = stats.norm.rvs(size=100, loc=10, random_state=54321)
        lmbda = 1
        llf = stats.boxcox_llf(lmbda, x)
        llf2 = stats.boxcox_llf(lmbda, np.vstack([x, x]).T)
        xp_assert_close(xp.asarray([llf, llf]), xp.asarray(llf2), rtol=1e-12)

    @pytest.mark.thread_unsafe
    def test_empty(self, xp):
        message = "One or more sample arguments is too small..."
        context = (pytest.warns(SmallSampleWarning, match=message) if is_numpy(xp)
                   else contextlib.nullcontext())
        with context:
            assert xp.isnan(xp.asarray(stats.boxcox_llf(1, xp.asarray([]))))

    def test_gh_6873(self, xp):
        # Regression test for gh-6873.
        # This example was taken from gh-7534, a duplicate of gh-6873.
        data = xp.asarray([198.0, 233.0, 233.0, 392.0])
        llf = stats.boxcox_llf(-8, data)
        # The expected value was computed with mpmath.
        xp_assert_close(llf, xp.asarray(-17.93934208579061))

    def test_instability_gh20021(self, xp):
        data = xp.asarray([2003, 1950, 1997, 2000, 2009], dtype=xp.float64)
        llf = stats.boxcox_llf(1e-8, data)
        # The expected value was computed with mpsci, set mpmath.mp.dps=100
        # expect float64 output for integer input
        xp_assert_close(llf, xp.asarray(-15.32401272869016598, dtype=xp.float64),
                        rtol=1e-7)

    def test_axis(self, xp):
        data = xp.asarray([[100, 200], [300, 400]])
        llf_axis_0 = stats.boxcox_llf(1, data, axis=0)
        llf_0 = xp.stack([
            stats.boxcox_llf(1, data[:, 0]),
            stats.boxcox_llf(1, data[:, 1]),
        ])
        xp_assert_close(llf_axis_0, llf_0)
        llf_axis_1 = stats.boxcox_llf(1, data, axis=1)
        llf_1 = xp.stack([
            stats.boxcox_llf(1, data[0, :]),
            stats.boxcox_llf(1, data[1, :]),
        ])
        xp_assert_close(llf_axis_1, llf_1)


# This is the data from GitHub user Qukaiyi, given as an example
# of a data set that caused boxcox to fail.
_boxcox_data = [
    15957, 112079, 1039553, 711775, 173111, 307382, 183155, 53366, 760875,
    207500, 160045, 473714, 40194, 440319, 133261, 265444, 155590, 36660,
    904939, 55108, 138391, 339146, 458053, 63324, 1377727, 1342632, 41575,
    68685, 172755, 63323, 368161, 199695, 538214, 167760, 388610, 398855,
    1001873, 364591, 1320518, 194060, 194324, 2318551, 196114, 64225, 272000,
    198668, 123585, 86420, 1925556, 695798, 88664, 46199, 759135, 28051,
    345094, 1977752, 51778, 82746, 638126, 2560910, 45830, 140576, 1603787,
    57371, 548730, 5343629, 2298913, 998813, 2156812, 423966, 68350, 145237,
    131935, 1600305, 342359, 111398, 1409144, 281007, 60314, 242004, 113418,
    246211, 61940, 95858, 957805, 40909, 307955, 174159, 124278, 241193,
    872614, 304180, 146719, 64361, 87478, 509360, 167169, 933479, 620561,
    483333, 97416, 143518, 286905, 597837, 2556043, 89065, 69944, 196858,
    88883, 49379, 916265, 1527392, 626954, 54415, 89013, 2883386, 106096,
    402697, 45578, 349852, 140379, 34648, 757343, 1305442, 2054757, 121232,
    606048, 101492, 51426, 1820833, 83412, 136349, 1379924, 505977, 1303486,
    95853, 146451, 285422, 2205423, 259020, 45864, 684547, 182014, 784334,
    174793, 563068, 170745, 1195531, 63337, 71833, 199978, 2330904, 227335,
    898280, 75294, 2011361, 116771, 157489, 807147, 1321443, 1148635, 2456524,
    81839, 1228251, 97488, 1051892, 75397, 3009923, 2732230, 90923, 39735,
    132433, 225033, 337555, 1204092, 686588, 1062402, 40362, 1361829, 1497217,
    150074, 551459, 2019128, 39581, 45349, 1117187, 87845, 1877288, 164448,
    10338362, 24942, 64737, 769946, 2469124, 2366997, 259124, 2667585, 29175,
    56250, 74450, 96697, 5920978, 838375, 225914, 119494, 206004, 430907,
    244083, 219495, 322239, 407426, 618748, 2087536, 2242124, 4736149, 124624,
    406305, 240921, 2675273, 4425340, 821457, 578467, 28040, 348943, 48795,
    145531, 52110, 1645730, 1768364, 348363, 85042, 2673847, 81935, 169075,
    367733, 135474, 383327, 1207018, 93481, 5934183, 352190, 636533, 145870,
    55659, 146215, 73191, 248681, 376907, 1606620, 169381, 81164, 246390,
    236093, 885778, 335969, 49266, 381430, 307437, 350077, 34346, 49340,
    84715, 527120, 40163, 46898, 4609439, 617038, 2239574, 159905, 118337,
    120357, 430778, 3799158, 3516745, 54198, 2970796, 729239, 97848, 6317375,
    887345, 58198, 88111, 867595, 210136, 1572103, 1420760, 574046, 845988,
    509743, 397927, 1119016, 189955, 3883644, 291051, 126467, 1239907, 2556229,
    411058, 657444, 2025234, 1211368, 93151, 577594, 4842264, 1531713, 305084,
    479251, 20591, 1466166, 137417, 897756, 594767, 3606337, 32844, 82426,
    1294831, 57174, 290167, 322066, 813146, 5671804, 4425684, 895607, 450598,
    1048958, 232844, 56871, 46113, 70366, 701618, 97739, 157113, 865047,
    194810, 1501615, 1765727, 38125, 2733376, 40642, 437590, 127337, 106310,
    4167579, 665303, 809250, 1210317, 45750, 1853687, 348954, 156786, 90793,
    1885504, 281501, 3902273, 359546, 797540, 623508, 3672775, 55330, 648221,
    266831, 90030, 7118372, 735521, 1009925, 283901, 806005, 2434897, 94321,
    309571, 4213597, 2213280, 120339, 64403, 8155209, 1686948, 4327743,
    1868312, 135670, 3189615, 1569446, 706058, 58056, 2438625, 520619, 105201,
    141961, 179990, 1351440, 3148662, 2804457, 2760144, 70775, 33807, 1926518,
    2362142, 186761, 240941, 97860, 1040429, 1431035, 78892, 484039, 57845,
    724126, 3166209, 175913, 159211, 1182095, 86734, 1921472, 513546, 326016,
    1891609
]


class TestBoxcox:

    def test_fixed_lmbda(self):
        x = _old_loggamma_rvs(5, size=50, random_state=12345) + 5
        xt = stats.boxcox(x, lmbda=1)
        assert_allclose(xt, x - 1)
        xt = stats.boxcox(x, lmbda=-1)
        assert_allclose(xt, 1 - 1/x)

        xt = stats.boxcox(x, lmbda=0)
        assert_allclose(xt, np.log(x))

        # Also test that array_like input works
        xt = stats.boxcox(list(x), lmbda=0)
        assert_allclose(xt, np.log(x))

        # test that constant input is accepted; see gh-12225
        xt = stats.boxcox(np.ones(10), 2)
        assert_equal(xt, np.zeros(10))

    def test_lmbda_None(self):
        # Start from normal rv's, do inverse transform to check that
        # optimization function gets close to the right answer.
        lmbda = 2.5
        x = stats.norm.rvs(loc=10, size=50000, random_state=1245)
        x_inv = (x * lmbda + 1)**(-lmbda)
        xt, maxlog = stats.boxcox(x_inv)

        assert_almost_equal(maxlog, -1 / lmbda, decimal=2)

    def test_alpha(self):
        rng = np.random.RandomState(1234)
        x = _old_loggamma_rvs(5, size=50, random_state=rng) + 5

        # Some regular values for alpha, on a small sample size
        _, _, interval = stats.boxcox(x, alpha=0.75)
        assert_allclose(interval, [4.004485780226041, 5.138756355035744])
        _, _, interval = stats.boxcox(x, alpha=0.05)
        assert_allclose(interval, [1.2138178554857557, 8.209033272375663])

        # Try some extreme values, see we don't hit the N=500 limit
        x = _old_loggamma_rvs(7, size=500, random_state=rng) + 15
        _, _, interval = stats.boxcox(x, alpha=0.001)
        assert_allclose(interval, [0.3988867, 11.40553131])
        _, _, interval = stats.boxcox(x, alpha=0.999)
        assert_allclose(interval, [5.83316246, 5.83735292])

    def test_boxcox_bad_arg(self):
        # Raise ValueError if any data value is negative.
        x = np.array([-1, 2])
        assert_raises(ValueError, stats.boxcox, x)
        # Raise ValueError if data is constant.
        assert_raises(ValueError, stats.boxcox, np.array([1]))
        # Raise ValueError if data is not 1-dimensional.
        assert_raises(ValueError, stats.boxcox, np.array([[1], [2]]))

    def test_empty(self):
        assert_(stats.boxcox([]).shape == (0,))

    def test_gh_6873(self):
        # Regression test for gh-6873.
        y, lam = stats.boxcox(_boxcox_data)
        # The expected value of lam was computed with the function
        # powerTransform in the R library 'car'.  I trust that value
        # to only about five significant digits.
        assert_allclose(lam, -0.051654, rtol=1e-5)

    @pytest.mark.parametrize("bounds", [(-1, 1), (1.1, 2), (-2, -1.1)])
    def test_bounded_optimizer_within_bounds(self, bounds):
        # Define custom optimizer with bounds.
        def optimizer(fun):
            return optimize.minimize_scalar(fun, bounds=bounds,
                                            method="bounded")

        _, lmbda = stats.boxcox(_boxcox_data, lmbda=None, optimizer=optimizer)
        assert bounds[0] < lmbda < bounds[1]

    def test_bounded_optimizer_against_unbounded_optimizer(self):
        # Test whether setting bounds on optimizer excludes solution from
        # unbounded optimizer.

        # Get unbounded solution.
        _, lmbda = stats.boxcox(_boxcox_data, lmbda=None)

        # Set tolerance and bounds around solution.
        bounds = (lmbda + 0.1, lmbda + 1)
        options = {'xatol': 1e-12}

        def optimizer(fun):
            return optimize.minimize_scalar(fun, bounds=bounds,
                                            method="bounded", options=options)

        # Check bounded solution. Lower bound should be active.
        _, lmbda_bounded = stats.boxcox(_boxcox_data, lmbda=None,
                                        optimizer=optimizer)
        assert lmbda_bounded != lmbda
        assert_allclose(lmbda_bounded, bounds[0])

    @pytest.mark.parametrize("optimizer", ["str", (1, 2), 0.1])
    def test_bad_optimizer_type_raises_error(self, optimizer):
        # Check if error is raised if string, tuple or float is passed
        with pytest.raises(ValueError, match="`optimizer` must be a callable"):
            stats.boxcox(_boxcox_data, lmbda=None, optimizer=optimizer)

    def test_bad_optimizer_value_raises_error(self):
        # Check if error is raised if `optimizer` function does not return
        # `OptimizeResult` object

        # Define test function that always returns 1
        def optimizer(fun):
            return 1

        message = "return an object containing the optimal `lmbda`"
        with pytest.raises(ValueError, match=message):
            stats.boxcox(_boxcox_data, lmbda=None, optimizer=optimizer)

    @pytest.mark.parametrize(
            "bad_x", [np.array([1, -42, 12345.6]), np.array([np.nan, 42, 1])]
        )
    def test_negative_x_value_raises_error(self, bad_x):
        """Test boxcox_normmax raises ValueError if x contains non-positive values."""
        message = "only positive, finite, real numbers"
        with pytest.raises(ValueError, match=message):
            stats.boxcox_normmax(bad_x)

    @pytest.mark.parametrize('x', [
        # Attempt to trigger overflow in power expressions.
        np.array([2003.0, 1950.0, 1997.0, 2000.0, 2009.0,
                  2009.0, 1980.0, 1999.0, 2007.0, 1991.0]),
        # Attempt to trigger overflow with a large optimal lambda.
        np.array([2003.0, 1950.0, 1997.0, 2000.0, 2009.0]),
        # Attempt to trigger overflow with large data.
        np.array([2003.0e200, 1950.0e200, 1997.0e200, 2000.0e200, 2009.0e200])
    ])
    def test_overflow(self, x):
        with pytest.warns(UserWarning, match="The optimal lambda is"):
            xt_bc, lam_bc = stats.boxcox(x)
            assert np.all(np.isfinite(xt_bc))


class TestBoxcoxNormmax:
    def setup_method(self):
        self.x = _old_loggamma_rvs(5, size=50, random_state=12345) + 5

    def test_pearsonr(self):
        maxlog = stats.boxcox_normmax(self.x)
        assert_allclose(maxlog, 1.804465, rtol=1e-6)

    def test_mle(self):
        maxlog = stats.boxcox_normmax(self.x, method='mle')
        assert_allclose(maxlog, 1.758101, rtol=1e-6)

        # Check that boxcox() uses 'mle'
        _, maxlog_boxcox = stats.boxcox(self.x)
        assert_allclose(maxlog_boxcox, maxlog)

    def test_all(self):
        maxlog_all = stats.boxcox_normmax(self.x, method='all')
        assert_allclose(maxlog_all, [1.804465, 1.758101], rtol=1e-6)

    @pytest.mark.parametrize("method", ["mle", "pearsonr", "all"])
    @pytest.mark.parametrize("bounds", [(-1, 1), (1.1, 2), (-2, -1.1)])
    def test_bounded_optimizer_within_bounds(self, method, bounds):

        def optimizer(fun):
            return optimize.minimize_scalar(fun, bounds=bounds,
                                            method="bounded")

        maxlog = stats.boxcox_normmax(self.x, method=method,
                                      optimizer=optimizer)
        assert np.all(bounds[0] < maxlog)
        assert np.all(maxlog < bounds[1])

    @pytest.mark.slow
    def test_user_defined_optimizer(self):
        # tests an optimizer that is not based on scipy.optimize.minimize
        lmbda = stats.boxcox_normmax(self.x)
        lmbda_rounded = np.round(lmbda, 5)
        lmbda_range = np.linspace(lmbda_rounded-0.01, lmbda_rounded+0.01, 1001)

        class MyResult:
            pass

        def optimizer(fun):
            # brute force minimum over the range
            objs = []
            for lmbda in lmbda_range:
                objs.append(fun(lmbda))
            res = MyResult()
            res.x = lmbda_range[np.argmin(objs)]
            return res

        lmbda2 = stats.boxcox_normmax(self.x, optimizer=optimizer)
        assert lmbda2 != lmbda                 # not identical
        assert_allclose(lmbda2, lmbda, 1e-5)   # but as close as it should be

    def test_user_defined_optimizer_and_brack_raises_error(self):
        optimizer = optimize.minimize_scalar

        # Using default `brack=None` with user-defined `optimizer` works as
        # expected.
        stats.boxcox_normmax(self.x, brack=None, optimizer=optimizer)

        # Using user-defined `brack` with user-defined `optimizer` is expected
        # to throw an error. Instead, users should specify
        # optimizer-specific parameters in the optimizer function itself.
        with pytest.raises(ValueError, match="`brack` must be None if "
                                             "`optimizer` is given"):

            stats.boxcox_normmax(self.x, brack=(-2.0, 2.0),
                                 optimizer=optimizer)

    @pytest.mark.parametrize(
        'x', ([2003.0, 1950.0, 1997.0, 2000.0, 2009.0],
              [0.50000471, 0.50004979, 0.50005902, 0.50009312, 0.50001632]))
    def test_overflow(self, x):
        message = "The optimal lambda is..."
        with pytest.warns(UserWarning, match=message):
            lmbda = stats.boxcox_normmax(x, method='mle')
        assert np.isfinite(special.boxcox(x, lmbda)).all()
        # 10000 is safety factor used in boxcox_normmax
        ymax = np.finfo(np.float64).max / 10000
        x_treme = np.max(x) if lmbda > 0 else np.min(x)
        y_extreme = special.boxcox(x_treme, lmbda)
        assert_allclose(y_extreme, ymax * np.sign(lmbda))

    def test_negative_ymax(self):
        with pytest.raises(ValueError, match="`ymax` must be strictly positive"):
            stats.boxcox_normmax(self.x, ymax=-1)

    @pytest.mark.parametrize("x", [
        # positive overflow in float64
        np.array([2003.0, 1950.0, 1997.0, 2000.0, 2009.0],
                 dtype=np.float64),
        # negative overflow in float64
        np.array([0.50000471, 0.50004979, 0.50005902, 0.50009312, 0.50001632],
                 dtype=np.float64),
        # positive overflow in float32
        np.array([200.3, 195.0, 199.7, 200.0, 200.9],
                 dtype=np.float32),
        # negative overflow in float32
        np.array([2e-30, 1e-30, 1e-30, 1e-30, 1e-30, 1e-30],
                 dtype=np.float32),
    ])
    @pytest.mark.parametrize("ymax", [1e10, 1e30, None])
    # TODO: add method "pearsonr" after fix overflow issue
    @pytest.mark.parametrize("method", ["mle"])
    def test_user_defined_ymax_input_float64_32(self, x, ymax, method):
        # Test the maximum of the transformed data close to ymax
        with pytest.warns(UserWarning, match="The optimal lambda is"):
            kwarg = {'ymax': ymax} if ymax is not None else {}
            lmb = stats.boxcox_normmax(x, method=method, **kwarg)
            x_treme = [np.min(x), np.max(x)]
            ymax_res = max(abs(stats.boxcox(x_treme, lmb)))
            if ymax is None:
                # 10000 is safety factor used in boxcox_normmax
                ymax = np.finfo(x.dtype).max / 10000
            assert_allclose(ymax, ymax_res, rtol=1e-5)

    @pytest.mark.parametrize("x", [
        # positive overflow in float32 but not float64
        [200.3, 195.0, 199.7, 200.0, 200.9],
        # negative overflow in float32 but not float64
        [2e-30, 1e-30, 1e-30, 1e-30, 1e-30, 1e-30],
    ])
    # TODO: add method "pearsonr" after fix overflow issue
    @pytest.mark.parametrize("method", ["mle"])
    def test_user_defined_ymax_inf(self, x, method):
        x_32 = np.asarray(x, dtype=np.float32)
        x_64 = np.asarray(x, dtype=np.float64)

        # assert overflow with float32 but not float64
        with pytest.warns(UserWarning, match="The optimal lambda is"):
            stats.boxcox_normmax(x_32, method=method)
        stats.boxcox_normmax(x_64, method=method)

        # compute the true optimal lambda then compare them
        lmb_32 = stats.boxcox_normmax(x_32, ymax=np.inf, method=method)
        lmb_64 = stats.boxcox_normmax(x_64, ymax=np.inf, method=method)
        assert_allclose(lmb_32, lmb_64, rtol=1e-2)


class TestBoxcoxNormplot:
    def setup_method(self):
        self.x = _old_loggamma_rvs(5, size=500, random_state=7654321) + 5

    def test_basic(self):
        N = 5
        lmbdas, ppcc = stats.boxcox_normplot(self.x, -10, 10, N=N)
        ppcc_expected = [0.57783375, 0.83610988, 0.97524311, 0.99756057,
                         0.95843297]
        assert_allclose(lmbdas, np.linspace(-10, 10, num=N))
        assert_allclose(ppcc, ppcc_expected)

    @pytest.mark.skipif(not have_matplotlib, reason="no matplotlib")
    def test_plot_kwarg(self):
        # Check with the matplotlib.pyplot module
        fig = plt.figure()
        ax = fig.add_subplot(111)
        stats.boxcox_normplot(self.x, -20, 20, plot=plt)
        fig.delaxes(ax)

        # Check that a Matplotlib Axes object is accepted
        ax = fig.add_subplot(111)
        stats.boxcox_normplot(self.x, -20, 20, plot=ax)
        plt.close()

    def test_invalid_inputs(self):
        # `lb` has to be larger than `la`
        assert_raises(ValueError, stats.boxcox_normplot, self.x, 1, 0)
        # `x` can not contain negative values
        assert_raises(ValueError, stats.boxcox_normplot, [-1, 1], 0, 1)

    def test_empty(self):
        assert_(stats.boxcox_normplot([], 0, 1).size == 0)


class TestYeojohnson_llf:

    def test_array_like(self):
        x = stats.norm.rvs(size=100, loc=0, random_state=54321)
        lmbda = 1
        llf = stats.yeojohnson_llf(lmbda, x)
        llf2 = stats.yeojohnson_llf(lmbda, list(x))
        assert_allclose(llf, llf2, rtol=1e-12)

    def test_2d_input(self):
        x = stats.norm.rvs(size=100, loc=10, random_state=54321)
        lmbda = 1
        llf = stats.yeojohnson_llf(lmbda, x)
        llf2 = stats.yeojohnson_llf(lmbda, np.vstack([x, x]).T)
        assert_allclose([llf, llf], llf2, rtol=1e-12)

    def test_empty(self):
        assert_(np.isnan(stats.yeojohnson_llf(1, [])))


class TestYeojohnson:

    def test_fixed_lmbda(self):
        rng = np.random.RandomState(12345)

        # Test positive input
        x = _old_loggamma_rvs(5, size=50, random_state=rng) + 5
        assert np.all(x > 0)
        xt = stats.yeojohnson(x, lmbda=1)
        assert_allclose(xt, x)
        xt = stats.yeojohnson(x, lmbda=-1)
        assert_allclose(xt, 1 - 1 / (x + 1))
        xt = stats.yeojohnson(x, lmbda=0)
        assert_allclose(xt, np.log(x + 1))
        xt = stats.yeojohnson(x, lmbda=1)
        assert_allclose(xt, x)

        # Test negative input
        x = _old_loggamma_rvs(5, size=50, random_state=rng) - 5
        assert np.all(x < 0)
        xt = stats.yeojohnson(x, lmbda=2)
        assert_allclose(xt, -np.log(-x + 1))
        xt = stats.yeojohnson(x, lmbda=1)
        assert_allclose(xt, x)
        xt = stats.yeojohnson(x, lmbda=3)
        assert_allclose(xt, 1 / (-x + 1) - 1)

        # test both positive and negative input
        x = _old_loggamma_rvs(5, size=50, random_state=rng) - 2
        assert not np.all(x < 0)
        assert not np.all(x >= 0)
        pos = x >= 0
        xt = stats.yeojohnson(x, lmbda=1)
        assert_allclose(xt[pos], x[pos])
        xt = stats.yeojohnson(x, lmbda=-1)
        assert_allclose(xt[pos], 1 - 1 / (x[pos] + 1))
        xt = stats.yeojohnson(x, lmbda=0)
        assert_allclose(xt[pos], np.log(x[pos] + 1))
        xt = stats.yeojohnson(x, lmbda=1)
        assert_allclose(xt[pos], x[pos])

        neg = ~pos
        xt = stats.yeojohnson(x, lmbda=2)
        assert_allclose(xt[neg], -np.log(-x[neg] + 1))
        xt = stats.yeojohnson(x, lmbda=1)
        assert_allclose(xt[neg], x[neg])
        xt = stats.yeojohnson(x, lmbda=3)
        assert_allclose(xt[neg], 1 / (-x[neg] + 1) - 1)

    @pytest.mark.parametrize('lmbda', [0, .1, .5, 2])
    def test_lmbda_None(self, lmbda):
        # Start from normal rv's, do inverse transform to check that
        # optimization function gets close to the right answer.

        def _inverse_transform(x, lmbda):
            x_inv = np.zeros(x.shape, dtype=x.dtype)
            pos = x >= 0

            # when x >= 0
            if abs(lmbda) < np.spacing(1.):
                x_inv[pos] = np.exp(x[pos]) - 1
            else:  # lmbda != 0
                x_inv[pos] = np.power(x[pos] * lmbda + 1, 1 / lmbda) - 1

            # when x < 0
            if abs(lmbda - 2) > np.spacing(1.):
                x_inv[~pos] = 1 - np.power(-(2 - lmbda) * x[~pos] + 1,
                                           1 / (2 - lmbda))
            else:  # lmbda == 2
                x_inv[~pos] = 1 - np.exp(-x[~pos])

            return x_inv

        n_samples = 20000
        rng = np.random.RandomState(1234567)
        x = rng.normal(loc=0, scale=1, size=(n_samples))

        x_inv = _inverse_transform(x, lmbda)
        xt, maxlog = stats.yeojohnson(x_inv)

        assert_allclose(maxlog, lmbda, atol=1e-2)

        assert_almost_equal(0, np.linalg.norm(x - xt) / n_samples, decimal=2)
        assert_almost_equal(0, xt.mean(), decimal=1)
        assert_almost_equal(1, xt.std(), decimal=1)

    def test_empty(self):
        assert_(stats.yeojohnson([]).shape == (0,))

    def test_array_like(self):
        x = stats.norm.rvs(size=100, loc=0, random_state=54321)
        xt1, _ = stats.yeojohnson(x)
        xt2, _ = stats.yeojohnson(list(x))
        assert_allclose(xt1, xt2, rtol=1e-12)

    @pytest.mark.parametrize('dtype', [np.complex64, np.complex128])
    def test_input_dtype_complex(self, dtype):
        x = np.arange(6, dtype=dtype)
        err_msg = ('Yeo-Johnson transformation is not defined for complex '
                   'numbers.')
        with pytest.raises(ValueError, match=err_msg):
            stats.yeojohnson(x)

    @pytest.mark.parametrize('dtype', [np.int8, np.uint8, np.int16, np.int32])
    def test_input_dtype_integer(self, dtype):
        x_int = np.arange(8, dtype=dtype)
        x_float = np.arange(8, dtype=np.float64)
        xt_int, lmbda_int = stats.yeojohnson(x_int)
        xt_float, lmbda_float = stats.yeojohnson(x_float)
        assert_allclose(xt_int, xt_float, rtol=1e-7)
        assert_allclose(lmbda_int, lmbda_float, rtol=1e-7)

    def test_input_high_variance(self):
        # non-regression test for gh-10821
        x = np.array([3251637.22, 620695.44, 11642969.00, 2223468.22,
                      85307500.00, 16494389.89, 917215.88, 11642969.00,
                      2145773.87, 4962000.00, 620695.44, 651234.50,
                      1907876.71, 4053297.88, 3251637.22, 3259103.08,
                      9547969.00, 20631286.23, 12807072.08, 2383819.84,
                      90114500.00, 17209575.46, 12852969.00, 2414609.99,
                      2170368.23])
        xt_yeo, lam_yeo = stats.yeojohnson(x)
        xt_box, lam_box = stats.boxcox(x + 1)
        assert_allclose(xt_yeo, xt_box, rtol=1e-6)
        assert_allclose(lam_yeo, lam_box, rtol=1e-6)

    @pytest.mark.parametrize('x', [
        np.array([1.0, float("nan"), 2.0]),
        np.array([1.0, float("inf"), 2.0]),
        np.array([1.0, -float("inf"), 2.0]),
        np.array([-1.0, float("nan"), float("inf"), -float("inf"), 1.0])
    ])
    def test_nonfinite_input(self, x):
        with pytest.raises(ValueError, match='Yeo-Johnson input must be finite'):
            xt_yeo, lam_yeo = stats.yeojohnson(x)

    @pytest.mark.parametrize('x', [
        # Attempt to trigger overflow in power expressions.
        np.array([2003.0, 1950.0, 1997.0, 2000.0, 2009.0,
                  2009.0, 1980.0, 1999.0, 2007.0, 1991.0]),
        # Attempt to trigger overflow with a large optimal lambda.
        np.array([2003.0, 1950.0, 1997.0, 2000.0, 2009.0]),
        # Attempt to trigger overflow with large data.
        np.array([2003.0e200, 1950.0e200, 1997.0e200, 2000.0e200, 2009.0e200])
    ])
    def test_overflow(self, x):
        # non-regression test for gh-18389

        def optimizer(fun, lam_yeo):
            out = optimize.fminbound(fun, -lam_yeo, lam_yeo, xtol=1.48e-08)
            result = optimize.OptimizeResult()
            result.x = out
            return result

        with np.errstate(all="raise"):
            xt_yeo, lam_yeo = stats.yeojohnson(x)
            xt_box, lam_box = stats.boxcox(
                x + 1, optimizer=partial(optimizer, lam_yeo=lam_yeo))
            assert np.isfinite(np.var(xt_yeo))
            assert np.isfinite(np.var(xt_box))
            assert_allclose(lam_yeo, lam_box, rtol=1e-6)
            assert_allclose(xt_yeo, xt_box, rtol=1e-4)

    @pytest.mark.parametrize('x', [
        np.array([2003.0, 1950.0, 1997.0, 2000.0, 2009.0,
                  2009.0, 1980.0, 1999.0, 2007.0, 1991.0]),
        np.array([2003.0, 1950.0, 1997.0, 2000.0, 2009.0])
    ])
    @pytest.mark.parametrize('scale', [1, 1e-12, 1e-32, 1e-150, 1e32, 1e200])
    @pytest.mark.parametrize('sign', [1, -1])
    def test_overflow_underflow_signed_data(self, x, scale, sign):
        # non-regression test for gh-18389
        with np.errstate(all="raise"):
            xt_yeo, lam_yeo = stats.yeojohnson(sign * x * scale)
            assert np.all(np.sign(sign * x) == np.sign(xt_yeo))
            assert np.isfinite(lam_yeo)
            assert np.isfinite(np.var(xt_yeo))

    @pytest.mark.parametrize('x', [
        np.array([0, 1, 2, 3]),
        np.array([0, -1, 2, -3]),
        np.array([0, 0, 0])
    ])
    @pytest.mark.parametrize('sign', [1, -1])
    @pytest.mark.parametrize('brack', [None, (-2, 2)])
    def test_integer_signed_data(self, x, sign, brack):
        with np.errstate(all="raise"):
            x_int = sign * x
            x_float = x_int.astype(np.float64)
            lam_yeo_int = stats.yeojohnson_normmax(x_int, brack=brack)
            xt_yeo_int = stats.yeojohnson(x_int, lmbda=lam_yeo_int)
            lam_yeo_float = stats.yeojohnson_normmax(x_float, brack=brack)
            xt_yeo_float = stats.yeojohnson(x_float, lmbda=lam_yeo_float)
            assert np.all(np.sign(x_int) == np.sign(xt_yeo_int))
            assert np.isfinite(lam_yeo_int)
            assert np.isfinite(np.var(xt_yeo_int))
            assert lam_yeo_int == lam_yeo_float
            assert np.all(xt_yeo_int == xt_yeo_float)


class TestYeojohnsonNormmax:
    def setup_method(self):
        self.x = _old_loggamma_rvs(5, size=50, random_state=12345) + 5

    def test_mle(self):
        maxlog = stats.yeojohnson_normmax(self.x)
        assert_allclose(maxlog, 1.876393, rtol=1e-6)

    def test_darwin_example(self):
        # test from original paper "A new family of power transformations to
        # improve normality or symmetry" by Yeo and Johnson.
        x = [6.1, -8.4, 1.0, 2.0, 0.7, 2.9, 3.5, 5.1, 1.8, 3.6, 7.0, 3.0, 9.3,
             7.5, -6.0]
        lmbda = stats.yeojohnson_normmax(x)
        assert np.allclose(lmbda, 1.305, atol=1e-3)


class TestCircFuncs:
    # In gh-5747, the R package `circular` was used to calculate reference
    # values for the circular variance, e.g.:
    # library(circular)
    # options(digits=16)
    # x = c(0, 2*pi/3, 5*pi/3)
    # var.circular(x)
    @pytest.mark.parametrize("test_func,expected",
                             [(stats.circmean, 0.167690146),
                              (stats.circvar, 0.006455174000787767),
                              (stats.circstd, 6.520702116)])
    def test_circfuncs(self, test_func, expected, xp):
        x = xp.asarray([355., 5., 2., 359., 10., 350.])
        xp_assert_close(test_func(x, high=360), xp.asarray(expected))

    def test_circfuncs_small(self, xp):
        # Default tolerances won't work here because the reference values
        # are approximations. Ensure all array types work in float64 to
        # avoid needing separate float32 and float64 tolerances.
        x = xp.asarray([20, 21, 22, 18, 19, 20.5, 19.2], dtype=xp.float64)
        M1 = xp.mean(x)
        M2 = stats.circmean(x, high=360)
        xp_assert_close(M2, M1, rtol=1e-5)

        V1 = xp.var(x*xp.pi/180, correction=0)
        # for small variations, circvar is approximately half the
        # linear variance
        V1 = V1 / 2.
        V2 = stats.circvar(x, high=360)
        xp_assert_close(V2, V1, rtol=1e-4)

        S1 = xp.std(x, correction=0)
        S2 = stats.circstd(x, high=360)
        xp_assert_close(S2, S1, rtol=1e-4)

    @pytest.mark.parametrize("test_func, numpy_func",
                             [(stats.circmean, np.mean),
                              (stats.circvar, np.var),
                              (stats.circstd, np.std)])
    def test_circfuncs_close(self, test_func, numpy_func, xp):
        # circfuncs should handle very similar inputs (gh-12740)
        x = np.asarray([0.12675364631578953] * 10 + [0.12675365920187928] * 100)
        circstat = test_func(xp.asarray(x))
        normal = xp.asarray(numpy_func(x))
        xp_assert_close(circstat, normal, atol=2e-8)

    @pytest.mark.parametrize('circfunc', [stats.circmean,
                                          stats.circvar,
                                          stats.circstd])
    def test_circmean_axis(self, xp, circfunc):
        x = xp.asarray([[355, 5, 2, 359, 10, 350],
                        [351, 7, 4, 352, 9, 349],
                        [357, 9, 8, 358, 4, 356.]])
        res = circfunc(x, high=360)
        ref = circfunc(xp.reshape(x, (-1,)), high=360)
        xp_assert_close(res, xp.asarray(ref))

        res = circfunc(x, high=360, axis=1)
        ref = [circfunc(x[i, :], high=360) for i in range(x.shape[0])]
        xp_assert_close(res, xp.stack(ref))

        res = circfunc(x, high=360, axis=0)
        ref = [circfunc(x[:, i], high=360) for i in range(x.shape[1])]
        xp_assert_close(res, xp.stack(ref))

    @pytest.mark.parametrize("test_func,expected",
                             [(stats.circmean, 0.167690146),
                              (stats.circvar, 0.006455174270186603),
                              (stats.circstd, 6.520702116)])
    def test_circfuncs_array_like(self, test_func, expected, xp):
        x = xp.asarray([355, 5, 2, 359, 10, 350.])
        xp_assert_close(test_func(x, high=360), xp.asarray(expected))

    @pytest.mark.parametrize("test_func", [stats.circmean, stats.circvar,
                                           stats.circstd])
    def test_empty(self, test_func, xp):
        dtype = xp.float64
        x = xp.asarray([], dtype=dtype)
        if is_numpy(xp):
            with pytest.warns(SmallSampleWarning, match=too_small_1d_not_omit):
                res = test_func(x)
        else:
            with np.testing.suppress_warnings() as sup:
                # for array_api_strict
                sup.filter(RuntimeWarning, "Mean of empty slice")
                sup.filter(RuntimeWarning, "invalid value encountered")
                res = test_func(x)
        xp_assert_equal(res, xp.asarray(xp.nan, dtype=dtype))

    @pytest.mark.parametrize("test_func", [stats.circmean, stats.circvar,
                                           stats.circstd])
    def test_nan_propagate(self, test_func, xp):
        x = xp.asarray([355, 5, 2, 359, 10, 350, np.nan])
        xp_assert_equal(test_func(x, high=360), xp.asarray(xp.nan))

    @pytest.mark.parametrize("test_func,expected",
                             [(stats.circmean,
                               {None: np.nan, 0: 355.66582264, 1: 0.28725053}),
                              (stats.circvar,
                               {None: np.nan,
                                0: 0.002570671054089924,
                                1: 0.005545914017677123}),
                              (stats.circstd,
                               {None: np.nan, 0: 4.11093193, 1: 6.04265394})])
    def test_nan_propagate_array(self, test_func, expected, xp):
        x = xp.asarray([[355, 5, 2, 359, 10, 350, 1],
                        [351, 7, 4, 352, 9, 349, np.nan],
                        [1, np.nan, np.nan, np.nan, np.nan, np.nan, np.nan]])
        for axis in expected.keys():
            out = test_func(x, high=360, axis=axis)
            if axis is None:
                xp_assert_equal(out, xp.asarray(xp.nan))
            else:
                xp_assert_close(out[0], xp.asarray(expected[axis]))
                xp_assert_equal(out[1:], xp.full_like(out[1:], xp.nan))

    def test_circmean_scalar(self, xp):
        x = xp.asarray(1.)[()]
        M1 = x
        M2 = stats.circmean(x)
        xp_assert_close(M2, M1, rtol=1e-5)

    def test_circmean_range(self, xp):
        # regression test for gh-6420: circmean(..., high, low) must be
        # between `high` and `low`
        m = stats.circmean(xp.arange(0, 2, 0.1), xp.pi, -xp.pi)
        xp_assert_less(m, xp.asarray(xp.pi))
        xp_assert_less(-m, xp.asarray(xp.pi))

    def test_circfuncs_uint8(self, xp):
        # regression test for gh-7255: overflow when working with
        # numpy uint8 data type
        x = xp.asarray([150, 10], dtype=xp.uint8)
        xp_assert_close(stats.circmean(x, high=180), xp.asarray(170.0))
        xp_assert_close(stats.circvar(x, high=180), xp.asarray(0.2339555554617))
        xp_assert_close(stats.circstd(x, high=180), xp.asarray(20.91551378))

    def test_circstd_zero(self, xp):
        # circstd() of a single number should return positive zero.
        y = stats.circstd(xp.asarray([0]))
        assert math.copysign(1.0, y) == 1.0

    def test_circmean_accuracy_tiny_input(self, xp):
        # For tiny x such that sin(x) == x and cos(x) == 1.0 numerically,
        # circmean(x) should return x because atan2(sin(x), cos(x)) == x.
        # This test verifies this.
        #
        # The purpose of this test is not to show that circmean() is
        # accurate in the last digit for certain input, because this is
        # neither guaranteed not particularly useful.  Rather, it is a
        # "white-box" sanity check that no undue loss of precision is
        # introduced by conversion between (high - low) and (2 * pi).

        x = xp.linspace(1e-9, 6e-9, 50)
        assert xp.all(xp.sin(x) == x) and xp.all(xp.cos(x) == 1.0)

        m = (x * (2 * xp.pi) / (2 * xp.pi)) != x
        assert xp.any(m)
        x = x[m]

        y = stats.circmean(x[:, None], axis=1)
        assert xp.all(y == x)

    def test_circmean_accuracy_huge_input(self, xp):
        # White-box test that circmean() does not introduce undue loss of
        # numerical accuracy by eagerly rotating the input.  This is detected
        # by supplying a huge input x such that (x - low) == x numerically.
        x = xp.asarray(1e17, dtype=xp.float64)
        y = math.atan2(xp.sin(x), xp.cos(x))  # -2.6584887370946806
        expected = xp.asarray(y, dtype=xp.float64)
        actual = stats.circmean(x, high=xp.pi, low=-xp.pi)
        xp_assert_close(actual, expected, rtol=1e-15, atol=0.0)


class TestCircFuncsNanPolicy:
    # `nan_policy` is implemented by the `_axis_nan_policy` decorator, which is
    # not yet array-API compatible. When it is array-API compatible, the generic
    # tests run on every function will be much stronger than these, so these
    # will not be necessary. So I don't see a need to make these array-API compatible;
    # when the time comes, they can just be removed.
    @pytest.mark.parametrize("test_func,expected",
                             [(stats.circmean,
                               {None: 359.4178026893944,
                                0: np.array([353.0, 6.0, 3.0, 355.5, 9.5,
                                             349.5]),
                                1: np.array([0.16769015, 358.66510252])}),
                              (stats.circvar,
                               {None: 0.008396678483192477,
                                0: np.array([1.9997969, 0.4999873, 0.4999873,
                                             6.1230956, 0.1249992, 0.1249992]
                                            )*(np.pi/180)**2,
                                1: np.array([0.006455174270186603,
                                             0.01016767581393285])}),
                              (stats.circstd,
                               {None: 7.440570778057074,
                                0: np.array([2.00020313, 1.00002539, 1.00002539,
                                             3.50108929, 0.50000317,
                                             0.50000317]),
                                1: np.array([6.52070212, 8.19138093])})])
    def test_nan_omit_array(self, test_func, expected):
        x = np.array([[355, 5, 2, 359, 10, 350, np.nan],
                      [351, 7, 4, 352, 9, 349, np.nan],
                      [np.nan, np.nan, np.nan, np.nan, np.nan, np.nan, np.nan]])
        for axis in expected.keys():
            if axis is None:
                out = test_func(x, high=360, nan_policy='omit', axis=axis)
                assert_allclose(out, expected[axis], rtol=1e-7)
            else:
                with pytest.warns(SmallSampleWarning, match=too_small_nd_omit):
                    out = test_func(x, high=360, nan_policy='omit', axis=axis)
                    assert_allclose(out[:-1], expected[axis], rtol=1e-7)
                    assert_(np.isnan(out[-1]))

    @pytest.mark.parametrize("test_func,expected",
                             [(stats.circmean, 0.167690146),
                              (stats.circvar, 0.006455174270186603),
                              (stats.circstd, 6.520702116)])
    def test_nan_omit(self, test_func, expected):
        x = [355, 5, 2, 359, 10, 350, np.nan]
        assert_allclose(test_func(x, high=360, nan_policy='omit'),
                        expected, rtol=1e-7)

    @pytest.mark.parametrize("test_func", [stats.circmean, stats.circvar,
                                           stats.circstd])
    def test_nan_omit_all(self, test_func):
        x = [np.nan, np.nan, np.nan, np.nan, np.nan]
        with pytest.warns(SmallSampleWarning, match=too_small_1d_omit):
            assert_(np.isnan(test_func(x, nan_policy='omit')))

    @pytest.mark.parametrize("test_func", [stats.circmean, stats.circvar,
                                           stats.circstd])
    def test_nan_omit_all_axis(self, test_func):
        with pytest.warns(SmallSampleWarning, match=too_small_nd_omit):
            x = np.array([[np.nan, np.nan, np.nan, np.nan, np.nan],
                          [np.nan, np.nan, np.nan, np.nan, np.nan]])
            out = test_func(x, nan_policy='omit', axis=1)
            assert_(np.isnan(out).all())
            assert_(len(out) == 2)

    @pytest.mark.parametrize("x",
                             [[355, 5, 2, 359, 10, 350, np.nan],
                              np.array([[355, 5, 2, 359, 10, 350, np.nan],
                                        [351, 7, 4, 352, np.nan, 9, 349]])])
    @pytest.mark.parametrize("test_func", [stats.circmean, stats.circvar,
                                           stats.circstd])
    def test_nan_raise(self, test_func, x):
        assert_raises(ValueError, test_func, x, high=360, nan_policy='raise')

    @pytest.mark.parametrize("x",
                             [[355, 5, 2, 359, 10, 350, np.nan],
                              np.array([[355, 5, 2, 359, 10, 350, np.nan],
                                        [351, 7, 4, 352, np.nan, 9, 349]])])
    @pytest.mark.parametrize("test_func", [stats.circmean, stats.circvar,
                                           stats.circstd])
    def test_bad_nan_policy(self, test_func, x):
        assert_raises(ValueError, test_func, x, high=360, nan_policy='foobar')


class TestMedianTest:

    def test_bad_n_samples(self):
        # median_test requires at least two samples.
        assert_raises(ValueError, stats.median_test, [1, 2, 3])

    def test_empty_sample(self):
        # Each sample must contain at least one value.
        assert_raises(ValueError, stats.median_test, [], [1, 2, 3])

    def test_empty_when_ties_ignored(self):
        # The grand median is 1, and all values in the first argument are
        # equal to the grand median.  With ties="ignore", those values are
        # ignored, which results in the first sample being (in effect) empty.
        # This should raise a ValueError.
        assert_raises(ValueError, stats.median_test,
                      [1, 1, 1, 1], [2, 0, 1], [2, 0], ties="ignore")

    def test_empty_contingency_row(self):
        # The grand median is 1, and with the default ties="below", all the
        # values in the samples are counted as being below the grand median.
        # This would result a row of zeros in the contingency table, which is
        # an error.
        assert_raises(ValueError, stats.median_test, [1, 1, 1], [1, 1, 1])

        # With ties="above", all the values are counted as above the
        # grand median.
        assert_raises(ValueError, stats.median_test, [1, 1, 1], [1, 1, 1],
                      ties="above")

    def test_bad_ties(self):
        assert_raises(ValueError, stats.median_test, [1, 2, 3], [4, 5],
                      ties="foo")

    def test_bad_nan_policy(self):
        assert_raises(ValueError, stats.median_test, [1, 2, 3], [4, 5],
                      nan_policy='foobar')

    def test_bad_keyword(self):
        assert_raises(TypeError, stats.median_test, [1, 2, 3], [4, 5],
                      foo="foo")

    def test_simple(self):
        x = [1, 2, 3]
        y = [1, 2, 3]
        stat, p, med, tbl = stats.median_test(x, y)

        # The median is floating point, but this equality test should be safe.
        assert_equal(med, 2.0)

        assert_array_equal(tbl, [[1, 1], [2, 2]])

        # The expected values of the contingency table equal the contingency
        # table, so the statistic should be 0 and the p-value should be 1.
        assert_equal(stat, 0)
        assert_equal(p, 1)

    def test_ties_options(self):
        # Test the contingency table calculation.
        x = [1, 2, 3, 4]
        y = [5, 6]
        z = [7, 8, 9]
        # grand median is 5.

        # Default 'ties' option is "below".
        stat, p, m, tbl = stats.median_test(x, y, z)
        assert_equal(m, 5)
        assert_equal(tbl, [[0, 1, 3], [4, 1, 0]])

        stat, p, m, tbl = stats.median_test(x, y, z, ties="ignore")
        assert_equal(m, 5)
        assert_equal(tbl, [[0, 1, 3], [4, 0, 0]])

        stat, p, m, tbl = stats.median_test(x, y, z, ties="above")
        assert_equal(m, 5)
        assert_equal(tbl, [[0, 2, 3], [4, 0, 0]])

    def test_nan_policy_options(self):
        x = [1, 2, np.nan]
        y = [4, 5, 6]
        mt1 = stats.median_test(x, y, nan_policy='propagate')
        s, p, m, t = stats.median_test(x, y, nan_policy='omit')

        assert_equal(mt1, (np.nan, np.nan, np.nan, None))
        assert_allclose(s, 0.31250000000000006)
        assert_allclose(p, 0.57615012203057869)
        assert_equal(m, 4.0)
        assert_equal(t, np.array([[0, 2], [2, 1]]))
        assert_raises(ValueError, stats.median_test, x, y, nan_policy='raise')

    def test_basic(self):
        # median_test calls chi2_contingency to compute the test statistic
        # and p-value.  Make sure it hasn't screwed up the call...

        x = [1, 2, 3, 4, 5]
        y = [2, 4, 6, 8]

        stat, p, m, tbl = stats.median_test(x, y)
        assert_equal(m, 4)
        assert_equal(tbl, [[1, 2], [4, 2]])

        exp_stat, exp_p, dof, e = stats.chi2_contingency(tbl)
        assert_allclose(stat, exp_stat)
        assert_allclose(p, exp_p)

        stat, p, m, tbl = stats.median_test(x, y, lambda_=0)
        assert_equal(m, 4)
        assert_equal(tbl, [[1, 2], [4, 2]])

        exp_stat, exp_p, dof, e = stats.chi2_contingency(tbl, lambda_=0)
        assert_allclose(stat, exp_stat)
        assert_allclose(p, exp_p)

        stat, p, m, tbl = stats.median_test(x, y, correction=False)
        assert_equal(m, 4)
        assert_equal(tbl, [[1, 2], [4, 2]])

        exp_stat, exp_p, dof, e = stats.chi2_contingency(tbl, correction=False)
        assert_allclose(stat, exp_stat)
        assert_allclose(p, exp_p)

    @pytest.mark.parametrize("correction", [False, True])
    def test_result(self, correction):
        x = [1, 2, 3]
        y = [1, 2, 3]

        res = stats.median_test(x, y, correction=correction)
        assert_equal((res.statistic, res.pvalue, res.median, res.table), res)

class TestDirectionalStats:
    # Reference implementations are not available
    def test_directional_stats_correctness(self, xp):
        # Data from Fisher: Dispersion on a sphere, 1953 and
        # Mardia and Jupp, Directional Statistics.
        decl = -np.deg2rad(np.array([343.2, 62., 36.9, 27., 359.,
                                     5.7, 50.4, 357.6, 44.]))
        incl = -np.deg2rad(np.array([66.1, 68.7, 70.1, 82.1, 79.5,
                                     73., 69.3, 58.8, 51.4]))
        data = np.stack((np.cos(incl) * np.cos(decl),
                         np.cos(incl) * np.sin(decl),
                         np.sin(incl)),
                        axis=1)

        decl = xp.asarray(decl.tolist())
        incl = xp.asarray(incl.tolist())
        data = xp.asarray(data.tolist())

        dirstats = stats.directional_stats(data)
        directional_mean = dirstats.mean_direction

        reference_mean = xp.asarray([0.2984, -0.1346, -0.9449])
        xp_assert_close(directional_mean, reference_mean, atol=1e-4)

    @pytest.mark.parametrize('angles, ref', [
        ([-np.pi/2, np.pi/2], 1.),
        ([0, 2 * np.pi], 0.)
    ])
    def test_directional_stats_2d_special_cases(self, angles, ref, xp):
        angles = xp.asarray(angles)
        ref = xp.asarray(ref)
        data = xp.stack([xp.cos(angles), xp.sin(angles)], axis=1)
        res = 1 - stats.directional_stats(data).mean_resultant_length
        xp_assert_close(res, ref)

    def test_directional_stats_2d(self, xp):
        # Test that for circular data directional_stats
        # yields the same result as circmean/circvar
        rng = np.random.default_rng(0xec9a6899d5a2830e0d1af479dbe1fd0c)
        testdata = xp.asarray(2 * xp.pi * rng.random((1000, )))
        testdata_vector = xp.stack((xp.cos(testdata),
                                    xp.sin(testdata)),
                                   axis=1)
        dirstats = stats.directional_stats(testdata_vector)
        directional_mean = dirstats.mean_direction
        directional_mean_angle = xp.atan2(directional_mean[1], directional_mean[0])
        directional_mean_angle = directional_mean_angle % (2 * xp.pi)
        circmean = stats.circmean(testdata)
        xp_assert_close(directional_mean_angle, circmean)

        directional_var = 1. - dirstats.mean_resultant_length
        circular_var = stats.circvar(testdata)
        xp_assert_close(directional_var, circular_var)

    def test_directional_mean_higher_dim(self, xp):
        # test that directional_stats works for higher dimensions
        # here a 4D array is reduced over axis = 2
        data = xp.asarray([[0.8660254, 0.5, 0.],
                           [0.8660254, -0.5, 0.]])
        full_array = xp.asarray(xp.tile(data, (2, 2, 2, 1)))
        expected = xp.asarray([[[1., 0., 0.],
                                [1., 0., 0.]],
                               [[1., 0., 0.],
                                [1., 0., 0.]]])
        dirstats = stats.directional_stats(full_array, axis=2)
        xp_assert_close(dirstats.mean_direction, expected)

    @skip_xp_backends(np_only=True, reason='checking array-like input')
    def test_directional_stats_list_ndarray_input(self, xp):
        # test that list and numpy array inputs yield same results
        data = [[0.8660254, 0.5, 0.], [0.8660254, -0.5, 0]]
        data_array = xp.asarray(data, dtype=xp.float64)
        ref = stats.directional_stats(data)
        res = stats.directional_stats(data_array)
        xp_assert_close(res.mean_direction,
                        xp.asarray(ref.mean_direction))
        xp_assert_close(res.mean_resultant_length,
                        xp.asarray(res.mean_resultant_length))

    def test_directional_stats_1d_error(self, xp):
        # test that one-dimensional data raises ValueError
        data = xp.ones((5, ))
        message = (r"samples must at least be two-dimensional. "
                   r"Instead samples has shape: (5,)")
        with pytest.raises(ValueError, match=re.escape(message)):
            stats.directional_stats(data)

    @pytest.mark.parametrize("dtype", ["float32", "float64"])
    def test_directional_stats_normalize(self, dtype, xp):
        # test that directional stats calculations yield same results
        # for unnormalized input with normalize=True and normalized
        # input with normalize=False
        data = np.array([[0.8660254, 0.5, 0.],
                         [1.7320508, -1., 0.]], dtype=dtype)
        res = stats.directional_stats(xp.asarray(data), normalize=True)
        normalized_data = data / np.linalg.norm(data, axis=-1,
                                                keepdims=True)
        ref = stats.directional_stats(normalized_data, normalize=False)
        xp_assert_close(res.mean_direction,
                        xp.asarray(ref.mean_direction))
        xp_assert_close(res.mean_resultant_length,
                        xp.asarray(ref.mean_resultant_length))


class TestFDRControl:
    def test_input_validation(self):
        message = "`ps` must include only numbers between 0 and 1"
        with pytest.raises(ValueError, match=message):
            stats.false_discovery_control([-1, 0.5, 0.7])
        with pytest.raises(ValueError, match=message):
            stats.false_discovery_control([0.5, 0.7, 2])
        with pytest.raises(ValueError, match=message):
            stats.false_discovery_control([0.5, 0.7, np.nan])

        message = "Unrecognized `method` 'YAK'"
        with pytest.raises(ValueError, match=message):
            stats.false_discovery_control([0.5, 0.7, 0.9], method='YAK')

        message = "`axis` must be an integer or `None`"
        with pytest.raises(ValueError, match=message):
            stats.false_discovery_control([0.5, 0.7, 0.9], axis=1.5)
        with pytest.raises(ValueError, match=message):
            stats.false_discovery_control([0.5, 0.7, 0.9], axis=(1, 2))

    def test_against_TileStats(self):
        # See reference [3] of false_discovery_control
        ps = [0.005, 0.009, 0.019, 0.022, 0.051, 0.101, 0.361, 0.387]
        res = stats.false_discovery_control(ps)
        ref = [0.036, 0.036, 0.044, 0.044, 0.082, 0.135, 0.387, 0.387]
        assert_allclose(res, ref, atol=1e-3)

    @pytest.mark.parametrize("case",
                             [([0.24617028, 0.01140030, 0.05652047, 0.06841983,
                                0.07989886, 0.01841490, 0.17540784, 0.06841983,
                                0.06841983, 0.25464082], 'bh'),
                              ([0.72102493, 0.03339112, 0.16554665, 0.20039952,
                                0.23402122, 0.05393666, 0.51376399, 0.20039952,
                                0.20039952, 0.74583488], 'by')])
    def test_against_R(self, case):
        # Test against p.adjust, e.g.
        # p = c(0.22155325, 0.00114003,..., 0.0364813 , 0.25464082)
        # p.adjust(p, "BY")
        ref, method = case
        rng = np.random.default_rng(6134137338861652935)
        ps = stats.loguniform.rvs(1e-3, 0.5, size=10, random_state=rng)
        ps[3] = ps[7]  # force a tie
        res = stats.false_discovery_control(ps, method=method)
        assert_allclose(res, ref, atol=1e-6)

    def test_axis_None(self):
        rng = np.random.default_rng(6134137338861652935)
        ps = stats.loguniform.rvs(1e-3, 0.5, size=(3, 4, 5), random_state=rng)
        res = stats.false_discovery_control(ps, axis=None)
        ref = stats.false_discovery_control(ps.ravel())
        assert_equal(res, ref)

    @pytest.mark.parametrize("axis", [0, 1, -1])
    def test_axis(self, axis):
        rng = np.random.default_rng(6134137338861652935)
        ps = stats.loguniform.rvs(1e-3, 0.5, size=(3, 4, 5), random_state=rng)
        res = stats.false_discovery_control(ps, axis=axis)
        ref = np.apply_along_axis(stats.false_discovery_control, axis, ps)
        assert_equal(res, ref)

    def test_edge_cases(self):
        assert_array_equal(stats.false_discovery_control([0.25]), [0.25])
        assert_array_equal(stats.false_discovery_control(0.25), 0.25)
        assert_array_equal(stats.false_discovery_control([]), [])


class TestCommonAxis:
    # More thorough testing of `axis` in `test_axis_nan_policy`,
    # but those tests aren't run with array API yet. This class
    # is in `test_morestats` instead of `test_axis_nan_policy`
    # because there is no reason to run `test_axis_nan_policy`
    # with the array API CI job right now.

    @pytest.mark.parametrize('case', [(stats.sem, {}),
                                      (stats.kstat, {'n': 4}),
                                      (stats.kstat, {'n': 2}),
                                      (stats.variation, {})])
    def test_axis(self, case, xp):
        fun, kwargs = case
        rng = np.random.default_rng(24598245982345)
        x = xp.asarray(rng.random((6, 7)))

        res = fun(x, **kwargs, axis=0)
        ref = xp.stack([fun(x[:, i], **kwargs) for i in range(x.shape[1])])
        xp_assert_close(res, ref)

        res = fun(x, **kwargs, axis=1)
        ref = xp.stack([fun(x[i, :], **kwargs) for i in range(x.shape[0])])
        xp_assert_close(res, ref)

        res = fun(x, **kwargs, axis=None)
        ref = fun(xp.reshape(x, (-1,)), **kwargs)
        xp_assert_close(res, ref)
