"""
Various made-up tests to hit different branches of the code in specfun.c
"""

import numpy as np
from numpy.testing import assert_allclose
from scipy import special


def test_cva2_cv0_branches():
    res, resp = special.mathieu_cem([40, 129], [13, 14], [30, 45])
    assert_allclose(res, np.array([-0.3741211, 0.74441928]))
    assert_allclose(resp, np.array([-37.02872758, -86.13549877]))

    res, resp = special.mathieu_sem([40, 129], [13, 14], [30, 45])
    assert_allclose(res, np.array([0.92955551, 0.66771207]))
    assert_allclose(resp, np.array([-14.91073448, 96.02954185]))


def test_chgm_branches():
    res = special.eval_genlaguerre(-3.2, 3, 2.5)
    assert_allclose(res, -0.7077721935779854)


def test_hygfz_branches():
    """(z == 1.0) && (c-a-b > 0.0)"""
    res = special.hyp2f1(1.5, 2.5, 4.5, 1.+0.j)
    assert_allclose(res, 10.30835089459151+0j)
    """(cabs(z+1) < eps) && (fabs(c-a+b - 1.0) < eps)"""
    res = special.hyp2f1(5+5e-16, 2, 2, -1.0 + 5e-16j)
    assert_allclose(res, 0.031249999999999986+3.9062499999999994e-17j)


def test_pro_rad1():
    # https://github.com/scipy/scipy/issues/21058
    # Reference values taken from WolframAlpha
    # SpheroidalS1(1, 1, 30, 1.1)
    # SpheroidalS1Prime(1, 1, 30, 1.1)
    res = special.pro_rad1(1, 1, 30, 1.1)
    assert_allclose(res, (0.009657872296166435, 3.253369651472877), rtol=2e-5)

def test_pro_rad2():
    # https://github.com/scipy/scipy/issues/21461
    # Reference values taken from WolframAlpha
    # SpheroidalS2(0, 0, 3, 1.02)
    # SpheroidalS2Prime(0, 0, 3, 1.02)
    res = special.pro_rad2(0, 0, 3, 1.02)
    assert_allclose(res, (-0.35089596858528077, 13.652764213480872), rtol=10e-10)
