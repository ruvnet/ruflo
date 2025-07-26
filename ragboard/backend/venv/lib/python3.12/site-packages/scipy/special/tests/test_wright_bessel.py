# Reference MPMATH implementation:
#
# import mpmath
# from mpmath import nsum
#
# def Wright_Series_MPMATH(a, b, z, dps=50, method='r+s+e', steps=[1000]):
#    """Compute Wright' generalized Bessel function as Series.
#
#    This uses mpmath for arbitrary precision.
#    """
#    with mpmath.workdps(dps):
#        res = nsum(lambda k: z**k/mpmath.fac(k) * mpmath.rgamma(a*k+b),
#                          [0, mpmath.inf],
#                          tol=dps, method=method, steps=steps
#                          )
#
#    return res

from itertools import product

import pytest
import numpy as np
from numpy.testing import assert_equal, assert_allclose

import scipy.special as sc
from scipy.special import log_wright_bessel, loggamma, rgamma, wright_bessel


@pytest.mark.parametrize('a', [0, 1e-6, 0.1, 0.5, 1, 10])
@pytest.mark.parametrize('b', [0, 1e-6, 0.1, 0.5, 1, 10])
def test_wright_bessel_zero(a, b):
    """Test at x = 0."""
    assert_equal(wright_bessel(a, b, 0.), rgamma(b))
    assert_allclose(log_wright_bessel(a, b, 0.), -loggamma(b))


@pytest.mark.parametrize('b', [0, 1e-6, 0.1, 0.5, 1, 10])
@pytest.mark.parametrize('x', [0, 1e-6, 0.1, 0.5, 1])
def test_wright_bessel_iv(b, x):
    """Test relation of wright_bessel and modified bessel function iv.

    iv(z) = (1/2*z)**v * Phi(1, v+1; 1/4*z**2).
    See https://dlmf.nist.gov/10.46.E2
    """
    if x != 0:
        v = b - 1
        wb = wright_bessel(1, v + 1, x**2 / 4.)
        # Note: iv(v, x) has precision of less than 1e-12 for some cases
        # e.g v=1-1e-6 and x=1e-06)
        assert_allclose(np.power(x / 2., v) * wb,
                        sc.iv(v, x),
                        rtol=1e-11, atol=1e-11)


@pytest.mark.parametrize('a', [0, 1e-6, 0.1, 0.5, 1, 10])
@pytest.mark.parametrize('b', [1, 1 + 1e-3, 2, 5, 10])
@pytest.mark.parametrize('x', [0, 1e-6, 0.1, 0.5, 1, 5, 10, 100])
def test_wright_functional(a, b, x):
    """Test functional relation of wright_bessel.

    Phi(a, b-1, z) = a*z*Phi(a, b+a, z) + (b-1)*Phi(a, b, z)

    Note that d/dx Phi(a, b, x) = Phi(a, b-1, x)
    See Eq. (22) of
    B. Stankovic, On the Function of E. M. Wright,
    Publ. de l' Institut Mathematique, Beograd,
    Nouvelle S`er. 10 (1970), 113-124.
    """
    assert_allclose(wright_bessel(a, b - 1, x),
                    a * x * wright_bessel(a, b + a, x)
                    + (b - 1) * wright_bessel(a, b, x),
                    rtol=1e-8, atol=1e-8)


# grid of rows [a, b, x, value, accuracy] that do not reach 1e-11 accuracy
# see output of:
# cd scipy/scipy/_precompute
# python wright_bessel_data.py
grid_a_b_x_value_acc = np.array([
    [0.1, 100.0, 709.7827128933841, 8.026353022981087e+34, 2e-8],
    [0.5, 10.0, 709.7827128933841, 2.680788404494657e+48, 9e-8],
    [0.5, 10.0, 1000.0, 2.005901980702872e+64, 1e-8],
    [0.5, 100.0, 1000.0, 3.4112367580445246e-117, 6e-8],
    [1.0, 20.0, 100000.0, 1.7717158630699857e+225, 3e-11],
    [1.0, 100.0, 100000.0, 1.0269334596230763e+22, np.nan],
    [1.0000000000000222, 20.0, 100000.0, 1.7717158630001672e+225, 3e-11],
    [1.0000000000000222, 100.0, 100000.0, 1.0269334595866202e+22, np.nan],
    [1.5, 0.0, 500.0, 15648961196.432373, 3e-11],
    [1.5, 2.220446049250313e-14, 500.0, 15648961196.431465, 3e-11],
    [1.5, 1e-10, 500.0, 15648961192.344728, 3e-11],
    [1.5, 1e-05, 500.0, 15648552437.334162, 3e-11],
    [1.5, 0.1, 500.0, 12049870581.10317, 2e-11],
    [1.5, 20.0, 100000.0, 7.81930438331405e+43, 3e-9],
    [1.5, 100.0, 100000.0, 9.653370857459075e-130, np.nan],
    ])


@pytest.mark.xfail
@pytest.mark.parametrize(
    'a, b, x, phi',
    grid_a_b_x_value_acc[:, :4].tolist())
def test_wright_data_grid_failures(a, b, x, phi):
    """Test cases of test_data that do not reach relative accuracy of 1e-11"""
    assert_allclose(wright_bessel(a, b, x), phi, rtol=1e-11)


@pytest.mark.parametrize(
    'a, b, x, phi, accuracy',
    grid_a_b_x_value_acc.tolist())
def test_wright_data_grid_less_accurate(a, b, x, phi, accuracy):
    """Test cases of test_data that do not reach relative accuracy of 1e-11

    Here we test for reduced accuracy or even nan.
    """
    if np.isnan(accuracy):
        assert np.isnan(wright_bessel(a, b, x))
    else:
        assert_allclose(wright_bessel(a, b, x), phi, rtol=accuracy)


@pytest.mark.parametrize(
    'a, b, x',
    list(
        product([0, 0.1, 0.5, 1.5, 5, 10], [1, 2], [1e-3, 1, 1.5, 5, 10])
    )
)
def test_log_wright_bessel_same_as_wright_bessel(a, b, x):
    """Test that log_wright_bessel equals log of wright_bessel."""
    assert_allclose(
        log_wright_bessel(a, b, x),
        np.log(wright_bessel(a, b, x)),
        rtol=1e-8,
    )


# Computed with, see also mp_wright_bessel from wright_bessel_data.py:
#
# from functools import lru_cache
# import mpmath as mp
#
# @lru_cache(maxsize=1_000_000)
# def rgamma_cached(x, dps):
#     with mp.workdps(dps):
#         return mp.rgamma(x)
#
# def mp_log_wright_bessel(a, b, x, dps=100, maxterms=10_000, method="d"):
#     """Compute log of Wright's generalized Bessel function as Series with mpmath."""
#     with mp.workdps(dps):
#         a, b, x = mp.mpf(a), mp.mpf(b), mp.mpf(x)
#         res = mp.nsum(lambda k: x**k / mp.fac(k)
#                       * rgamma_cached(a * k + b, dps=dps),
#                       [0, mp.inf],
#                       tol=dps, method=method, steps=[maxterms]
#                       )
#         return mp.log(res)
#
# Sometimes, one needs to set maxterms as high as 1_00_000 to get accurate results for
# phi.
# At the end of the day, we can only hope that results are correct for very large x,
# e.g. by the asymptotic series, as there is no way to produce those in "exact"
# arithmetic.
# Note: accuracy = np.nan means log_wright_bessel returns nan.
@pytest.mark.parametrize(
    'a, b, x, phi, accuracy',
    [
        (0, 0, 0, -np.inf, 1e-11),
        (0, 0, 1, -np.inf, 1e-11),
        (0, 1, 1.23, 1.23, 1e-11),
        (0, 1, 1e50, 1e50, 1e-11),
        (1e-5, 0, 700, 695.0421608273609, 1e-11),
        (1e-5, 0, 1e3, 995.40052566540066, 1e-11),
        (1e-5, 100, 1e3, 640.8197935670078, 1e-11),
        (1e-3, 0, 1e4, 9987.2229532297262, 1e-11),
        (1e-3, 0, 1e5, 99641.920687169507, 1e-11),
        (1e-3, 0, 1e6, 994118.55560054416, 1e-11),  # maxterms=1_000_000
        (1e-3, 10, 1e5, 99595.47710802537, 1e-11),
        (1e-3, 50, 1e5, 99401.240922855647, 1e-3),
        (1e-3, 100, 1e5, 99143.465191656527, np.nan),
        (0.5, 0, 1e5, 4074.1112442197941, 1e-11),
        (0.5, 0, 1e7, 87724.552120038896, 1e-11),
        (0.5, 100, 1e5, 3350.3928746306163, np.nan),
        (0.5, 100, 1e7, 86696.109975301719, 1e-11),
        (1, 0, 1e5, 634.06765787997266, 1e-11),
        (1, 0, 1e8, 20003.339639312035, 1e-11),
        (1.5, 0, 1e5, 197.01777556071194, 1e-11),
        (1.5, 0, 1e8, 3108.987414395706, 1e-11),
        (1.5, 100, 1e8, 2354.8915946283275, np.nan),
        (5, 0, 1e5, 9.8980480013203547, 1e-11),
        (5, 0, 1e8, 33.642337258687465, 1e-11),
        (5, 0, 1e12, 157.53704288117429, 1e-11),
        (5, 100, 1e5, -359.13419630792148, 1e-11),
        (5, 100, 1e12, -337.07722086995229, 1e-4),
        (5, 100, 1e20, 2588.2471229986845, 2e-6),
        (100, 0, 1e5, -347.62127990460517, 1e-11),
        (100, 0, 1e20, -313.08250350969449, 1e-11),
        (100, 100, 1e5, -359.1342053695754, 1e-11),
        (100, 100, 1e20, -359.1342053695754, 1e-11),
    ]
)
def test_log_wright_bessel(a, b, x, phi, accuracy):
    """Test for log_wright_bessel, in particular for large x."""
    if np.isnan(accuracy):
        assert np.isnan(log_wright_bessel(a, b, x))
    else:
        assert_allclose(log_wright_bessel(a, b, x), phi, rtol=accuracy)
