import pytest
import numpy as np
from numpy.testing import assert_allclose, assert_equal
import scipy.special as sc


class TestHyperu:

    def test_negative_x(self):
        a, b, x = np.meshgrid(
            [-1, -0.5, 0, 0.5, 1],
            [-1, -0.5, 0, 0.5, 1],
            np.linspace(-100, -1, 10),
        )
        assert np.all(np.isnan(sc.hyperu(a, b, x)))

    def test_special_cases(self):
        assert sc.hyperu(0, 1, 1) == 1.0

    @pytest.mark.parametrize('a', [0.5, 1, np.nan])
    @pytest.mark.parametrize('b', [1, 2, np.nan])
    @pytest.mark.parametrize('x', [0.25, 3, np.nan])
    def test_nan_inputs(self, a, b, x):
        assert np.isnan(sc.hyperu(a, b, x)) == np.any(np.isnan([a, b, x]))

    @pytest.mark.parametrize(
        'a,b,x,expected',
        [(0.21581740448533887, 1.0, 1e-05, 3.6030558839391325),
         (0.21581740448533887, 1.0, 0.00021544346900318823, 2.8783254988948976),
         (0.21581740448533887, 1.0, 0.004641588833612777, 2.154928216691109),
         (0.21581740448533887, 1.0, 0.1, 1.446546638718792),
         (0.0030949064301273865, 1.0, 1e-05, 1.0356696454116199),
         (0.0030949064301273865, 1.0, 0.00021544346900318823, 1.0261510362481985),
         (0.0030949064301273865, 1.0, 0.004641588833612777, 1.0166326903402296),
         (0.0030949064301273865, 1.0, 0.1, 1.0071174207698674),
         (0.1509924314279033, 1.0, 1e-05, 2.806173846998948),
         (0.1509924314279033, 1.0, 0.00021544346900318823, 2.3092158526816124),
         (0.1509924314279033, 1.0, 0.004641588833612777, 1.812905980588048),
         (0.1509924314279033, 1.0, 0.1, 1.3239738117634872),
         (-0.010678995342969011, 1.0, 1e-05, 0.8775194903781114),
         (-0.010678995342969011, 1.0, 0.00021544346900318823, 0.9101008998540128),
         (-0.010678995342969011, 1.0, 0.004641588833612777, 0.9426854294058609),
         (-0.010678995342969011, 1.0, 0.1, 0.9753065150174902),
         (-0.06556622211831487, 1.0, 1e-05, 0.26435429752668904),
         (-0.06556622211831487, 1.0, 0.00021544346900318823, 0.4574756033875781),
         (-0.06556622211831487, 1.0, 0.004641588833612777, 0.6507121093358457),
         (-0.06556622211831487, 1.0, 0.1, 0.8453129788602187),
         (-0.21628242470175185, 1.0, 1e-05, -1.2318314201114489),
         (-0.21628242470175185, 1.0, 0.00021544346900318823, -0.6704694233529538),
         (-0.21628242470175185, 1.0, 0.004641588833612777, -0.10795098653682857),
         (-0.21628242470175185, 1.0, 0.1, 0.4687227684115524)]
    )
    def test_gh_15650_mp(self, a, b, x, expected):
        # See https://github.com/scipy/scipy/issues/15650
        # b == 1, |a| < 0.25, 0 < x < 1
        #
        # This purpose of this test is to check the accuracy of results
        # in the region that was impacted by gh-15650.
        #
        # Reference values computed with mpmath using the script:
        #
        # import itertools as it
        # import numpy as np
        #
        # from mpmath import mp
        #
        # rng = np.random.default_rng(1234)
        #
        # cases = []
        # for a, x in it.product(
        #         np.random.uniform(-0.25, 0.25, size=6),
        #         np.logspace(-5, -1, 4),
        # ):
        #     with mp.workdps(100):
        #         cases.append((float(a), 1.0, float(x), float(mp.hyperu(a, 1.0, x))))
        assert_allclose(sc.hyperu(a, b, x), expected, rtol=1e-13)

    def test_gh_15650_sanity(self):
        # The purpose of this test is to sanity check hyperu in the region that
        # was impacted by gh-15650 by making sure there are no excessively large
        # results, as were reported there.
        a = np.linspace(-0.5, 0.5, 500)
        x = np.linspace(1e-6, 1e-1, 500)
        a, x = np.meshgrid(a, x)
        results = sc.hyperu(a, 1.0, x)
        assert np.all(np.abs(results) < 1e3)


class TestHyp1f1:

    @pytest.mark.parametrize('a, b, x', [
        (np.nan, 1, 1),
        (1, np.nan, 1),
        (1, 1, np.nan)
    ])
    def test_nan_inputs(self, a, b, x):
        assert np.isnan(sc.hyp1f1(a, b, x))

    def test_poles(self):
        assert_equal(sc.hyp1f1(1, [0, -1, -2, -3, -4], 0.5), np.inf)

    @pytest.mark.parametrize('a, b, x, result', [
        (-1, 1, 0.5, 0.5),
        (1, 1, 0.5, 1.6487212707001281468),
        (2, 1, 0.5, 2.4730819060501922203),
        (1, 2, 0.5, 1.2974425414002562937),
        (-10, 1, 0.5, -0.38937441413785204475)
    ])
    def test_special_cases(self, a, b, x, result):
        # Hit all the special case branches at the beginning of the
        # function. Desired answers computed using Mpmath.
        assert_allclose(sc.hyp1f1(a, b, x), result, atol=0, rtol=1e-15)

    @pytest.mark.parametrize('a, b, x, result', [
        (1, 1, 0.44, 1.5527072185113360455),
        (-1, 1, 0.44, 0.55999999999999999778),
        (100, 100, 0.89, 2.4351296512898745592),
        (-100, 100, 0.89, 0.40739062490768104667),
        (1.5, 100, 59.99, 3.8073513625965598107),
        (-1.5, 100, 59.99, 0.25099240047125826943)
    ])
    def test_geometric_convergence(self, a, b, x, result):
        # Test the region where we are relying on the ratio of
        #
        # (|a| + 1) * |x| / |b|
        #
        # being small. Desired answers computed using Mpmath
        assert_allclose(sc.hyp1f1(a, b, x), result, atol=0, rtol=1e-15)

    @pytest.mark.parametrize('a, b, x, result', [
        (-1, 1, 1.5, -0.5),
        (-10, 1, 1.5, 0.41801777430943080357),
        (-25, 1, 1.5, 0.25114491646037839809),
        (-50, 1, 1.5, -0.25683643975194756115),
        (-80, 1, 1.5, -0.24554329325751503601),
        (-150, 1, 1.5, -0.173364795515420454496),
    ])
    def test_a_negative_integer(self, a, b, x, result):
        # Desired answers computed using Mpmath.
        assert_allclose(sc.hyp1f1(a, b, x), result, atol=0, rtol=2e-14)

    @pytest.mark.parametrize('a, b, x, expected', [
        (0.01, 150, -4, 0.99973683897677527773),        # gh-3492
        (1, 5, 0.01, 1.0020033381011970966),            # gh-3593
        (50, 100, 0.01, 1.0050126452421463411),         # gh-3593
        (1, 0.3, -1e3, -7.011932249442947651455e-04),   # gh-14149
        (1, 0.3, -1e4, -7.001190321418937164734e-05),   # gh-14149
        (9, 8.5, -350, -5.224090831922378361082e-20),   # gh-17120
        (9, 8.5, -355, -4.595407159813368193322e-20),   # gh-17120
        (75, -123.5, 15, 3.425753920814889017493e+06),
    ])
    def test_assorted_cases(self, a, b, x, expected):
        # Expected values were computed with mpmath.hyp1f1(a, b, x).
        assert_allclose(sc.hyp1f1(a, b, x), expected, atol=0, rtol=1e-14)

    def test_a_neg_int_and_b_equal_x(self):
        # This is a case where the Boost wrapper will call hypergeometric_pFq
        # instead of hypergeometric_1F1.  When we use a version of Boost in
        # which https://github.com/boostorg/math/issues/833 is fixed, this
        # test case can probably be moved into test_assorted_cases.
        # The expected value was computed with mpmath.hyp1f1(a, b, x).
        a = -10.0
        b = 2.5
        x = 2.5
        expected = 0.0365323664364104338721
        computed = sc.hyp1f1(a, b, x)
        assert_allclose(computed, expected, atol=0, rtol=1e-13)

    @pytest.mark.parametrize('a, b, x, desired', [
        (-1, -2, 2, 2),
        (-1, -4, 10, 3.5),
        (-2, -2, 1, 2.5)
    ])
    def test_gh_11099(self, a, b, x, desired):
        # All desired results computed using Mpmath
        assert sc.hyp1f1(a, b, x) == desired

    @pytest.mark.parametrize('a', [-3, -2])
    def test_x_zero_a_and_b_neg_ints_and_a_ge_b(self, a):
        assert sc.hyp1f1(a, -3, 0) == 1

    # In the following tests with complex z, the reference values
    # were computed with mpmath.hyp1f1(a, b, z), and verified with
    # Wolfram Alpha Hypergeometric1F1(a, b, z), except for the
    # case a=0.1, b=1, z=7-24j, where Wolfram Alpha reported
    # "Standard computation time exceeded".  That reference value
    # was confirmed in an online Matlab session, with the commands
    #
    #  > format long
    #  > hypergeom(0.1, 1, 7-24i)
    #  ans =
    #   -3.712349651834209 + 4.554636556672912i
    #
    @pytest.mark.parametrize(
        'a, b, z, ref',
        [(-0.25, 0.5, 1+2j, 1.1814553180903435-1.2792130661292984j),
         (0.25, 0.5, 1+2j, 0.24636797405707597+1.293434354945675j),
         (25, 1.5, -2j, -516.1771262822523+407.04142751922024j),
         (12, -1.5, -10+20j, -5098507.422706547-1341962.8043508842j),
         pytest.param(
             10, 250, 10-15j, 1.1985998416598884-0.8613474402403436j,
             marks=pytest.mark.xfail,
         ),
         pytest.param(
             0.1, 1, 7-24j, -3.712349651834209+4.554636556672913j,
             marks=pytest.mark.xfail,
         )
         ],
    )
    def test_complex_z(self, a, b, z, ref):
        h = sc.hyp1f1(a, b, z)
        assert_allclose(h, ref, rtol=4e-15)

    # The "legacy edge cases" mentioned in the comments in the following
    # tests refers to the behavior of hyp1f1(a, b, x) when b is a nonpositive
    # integer.  In some subcases, the behavior of SciPy does not match that
    # of Boost (1.81+), mpmath and Mathematica (via Wolfram Alpha online).
    # If the handling of these edges cases is changed to agree with those
    # libraries, these test will have to be updated.

    @pytest.mark.parametrize('b', [0, -1, -5])
    def test_legacy_case1(self, b):
        # Test results of hyp1f1(0, n, x) for n <= 0.
        # This is a legacy edge case.
        # Boost (versions greater than 1.80), Mathematica (via Wolfram Alpha
        # online) and mpmath all return 1 in this case, but SciPy's hyp1f1
        # returns inf.
        assert_equal(sc.hyp1f1(0, b, [-1.5, 0, 1.5]), [np.inf, np.inf, np.inf])

    def test_legacy_case2(self):
        # This is a legacy edge case.
        # In software such as boost (1.81+), mpmath and Mathematica,
        # the value is 1.
        assert sc.hyp1f1(-4, -3, 0) == np.inf
