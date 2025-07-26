import pytest
import numpy as np
from numpy.testing import assert_allclose
import scipy.special._ufuncs as scu
from scipy.integrate import tanhsinh


type_char_to_type_tol = {'f': (np.float32, 32*np.finfo(np.float32).eps),
                         'd': (np.float64, 32*np.finfo(np.float64).eps)}


# Each item in this list is
#   (func, args, expected_value)
# All the values can be represented exactly, even with np.float32.
#
# This is not an exhaustive test data set of all the functions!
# It is a spot check of several functions, primarily for
# checking that the different data types are handled correctly.
test_data = [
    (scu._beta_pdf, (0.5, 2, 3), 1.5),
    (scu._beta_pdf, (0, 1, 5), 5.0),
    (scu._beta_pdf, (1, 5, 1), 5.0),
    (scu._beta_ppf, (0.5, 5., 5.), 0.5),  # gh-21303
    (scu._binom_cdf, (1, 3, 0.5), 0.5),
    (scu._binom_pmf, (1, 4, 0.5), 0.25),
    (scu._hypergeom_cdf, (2, 3, 5, 6), 0.5),
    (scu._nbinom_cdf, (1, 4, 0.25), 0.015625),
    (scu._ncf_mean, (10, 12, 2.5), 1.5),
]


@pytest.mark.parametrize('func, args, expected', test_data)
def test_stats_boost_ufunc(func, args, expected):
    type_sigs = func.types
    type_chars = [sig.split('->')[-1] for sig in type_sigs]
    for type_char in type_chars:
        typ, rtol = type_char_to_type_tol[type_char]
        args = [typ(arg) for arg in args]
        # Harmless overflow warnings are a "feature" of some wrappers on some
        # platforms. This test is about dtype and accuracy, so let's avoid false
        # test failures cause by these warnings. See gh-17432.
        with np.errstate(over='ignore'):
            value = func(*args)
        assert isinstance(value, typ)
        assert_allclose(value, expected, rtol=rtol)


def test_landau():
    # Test that Landau distribution ufuncs are wrapped as expected;
    # accuracy is tested by Boost.
    x = np.linspace(-3, 10, 10)
    args = (0, 1)
    res = tanhsinh(lambda x: scu._landau_pdf(x, *args), -np.inf, x)
    cdf = scu._landau_cdf(x, *args)
    assert_allclose(res.integral, cdf)
    sf = scu._landau_sf(x, *args)
    assert_allclose(sf, 1-cdf)
    ppf = scu._landau_ppf(cdf, *args)
    assert_allclose(ppf, x)
    isf = scu._landau_isf(sf, *args)
    assert_allclose(isf, x, rtol=1e-6)

def test_gh22956():
    _ = scu._ncx2_pdf(30, 1e307, 16)
