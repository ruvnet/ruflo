# Tests for a few of the "double-double" C++ functions defined in
# special/cephes/dd_real.h. Prior to gh-20390 which translated these
# functions from C to C++, there were test cases for _dd_expm1. It
# was determined that this function is not used anywhere internally
# in SciPy, so this function was not translated.


import pytest
from numpy.testing import assert_allclose
from scipy.special._test_internal import _dd_exp, _dd_log


# Each tuple in test_data contains:
#   (dd_func, xhi, xlo, expected_yhi, expected_ylo)
# The expected values were computed with mpmath, e.g.
#
#   import mpmath
#   mpmath.mp.dps = 100
#   xhi = 10.0
#   xlo = 0.0
#   x = mpmath.mpf(xhi) + mpmath.mpf(xlo)
#   y = mpmath.log(x)
#   expected_yhi = float(y)
#   expected_ylo = float(y - expected_yhi)
#
test_data = [
    (_dd_exp, -0.3333333333333333, -1.850371707708594e-17,
     0.7165313105737893, -2.0286948382455594e-17),
    (_dd_exp, 0.0, 0.0, 1.0, 0.0),
    (_dd_exp, 10.0, 0.0, 22026.465794806718, -1.3780134700517372e-12),
    (_dd_log, 0.03125, 0.0, -3.4657359027997265, -4.930038229799327e-18),
    (_dd_log, 10.0, 0.0, 2.302585092994046, -2.1707562233822494e-16),
]


@pytest.mark.parametrize('dd_func, xhi, xlo, expected_yhi, expected_ylo',
                         test_data)
def test_dd(dd_func, xhi, xlo, expected_yhi, expected_ylo):
    yhi, ylo = dd_func(xhi, xlo)
    assert yhi == expected_yhi, (f"high double ({yhi}) does not equal the "
                                 f"expected value {expected_yhi}")
    assert_allclose(ylo, expected_ylo, rtol=5e-15)
