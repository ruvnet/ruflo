import numpy as np
from numpy.testing import (assert_equal, assert_array_equal,
                           assert_array_almost_equal, assert_approx_equal,
                           assert_allclose)
import pytest
from pytest import raises as assert_raises
from scipy import stats
from scipy.special import xlogy
from scipy.stats.contingency import (margins, expected_freq,
                                     chi2_contingency, association)


def test_margins():
    a = np.array([1])
    m = margins(a)
    assert_equal(len(m), 1)
    m0 = m[0]
    assert_array_equal(m0, np.array([1]))

    a = np.array([[1]])
    m0, m1 = margins(a)
    expected0 = np.array([[1]])
    expected1 = np.array([[1]])
    assert_array_equal(m0, expected0)
    assert_array_equal(m1, expected1)

    a = np.arange(12).reshape(2, 6)
    m0, m1 = margins(a)
    expected0 = np.array([[15], [51]])
    expected1 = np.array([[6, 8, 10, 12, 14, 16]])
    assert_array_equal(m0, expected0)
    assert_array_equal(m1, expected1)

    a = np.arange(24).reshape(2, 3, 4)
    m0, m1, m2 = margins(a)
    expected0 = np.array([[[66]], [[210]]])
    expected1 = np.array([[[60], [92], [124]]])
    expected2 = np.array([[[60, 66, 72, 78]]])
    assert_array_equal(m0, expected0)
    assert_array_equal(m1, expected1)
    assert_array_equal(m2, expected2)


def test_expected_freq():
    assert_array_equal(expected_freq([1]), np.array([1.0]))

    observed = np.array([[[2, 0], [0, 2]], [[0, 2], [2, 0]], [[1, 1], [1, 1]]])
    e = expected_freq(observed)
    assert_array_equal(e, np.ones_like(observed))

    observed = np.array([[10, 10, 20], [20, 20, 20]])
    e = expected_freq(observed)
    correct = np.array([[12., 12., 16.], [18., 18., 24.]])
    assert_array_almost_equal(e, correct)


class TestChi2Contingency:
    def test_chi2_contingency_trivial(self):
        # Some very simple tests for chi2_contingency.

        # A trivial case
        obs = np.array([[1, 2], [1, 2]])
        chi2, p, dof, expected = chi2_contingency(obs, correction=False)
        assert_equal(chi2, 0.0)
        assert_equal(p, 1.0)
        assert_equal(dof, 1)
        assert_array_equal(obs, expected)

        # A *really* trivial case: 1-D data.
        obs = np.array([1, 2, 3])
        chi2, p, dof, expected = chi2_contingency(obs, correction=False)
        assert_equal(chi2, 0.0)
        assert_equal(p, 1.0)
        assert_equal(dof, 0)
        assert_array_equal(obs, expected)

    def test_chi2_contingency_R(self):
        # Some test cases that were computed independently, using R.

        # Rcode = \
        # """
        # # Data vector.
        # data <- c(
        #   12, 34, 23,     4,  47,  11,
        #   35, 31, 11,    34,  10,  18,
        #   12, 32,  9,    18,  13,  19,
        #   12, 12, 14,     9,  33,  25
        #   )
        #
        # # Create factor tags:r=rows, c=columns, t=tiers
        # r <- factor(gl(4, 2*3, 2*3*4, labels=c("r1", "r2", "r3", "r4")))
        # c <- factor(gl(3, 1,   2*3*4, labels=c("c1", "c2", "c3")))
        # t <- factor(gl(2, 3,   2*3*4, labels=c("t1", "t2")))
        #
        # # 3-way Chi squared test of independence
        # s = summary(xtabs(data~r+c+t))
        # print(s)
        # """
        # Routput = \
        # """
        # Call: xtabs(formula = data ~ r + c + t)
        # Number of cases in table: 478
        # Number of factors: 3
        # Test for independence of all factors:
        #         Chisq = 102.17, df = 17, p-value = 3.514e-14
        # """
        obs = np.array(
            [[[12, 34, 23],
              [35, 31, 11],
              [12, 32, 9],
              [12, 12, 14]],
             [[4, 47, 11],
              [34, 10, 18],
              [18, 13, 19],
              [9, 33, 25]]])
        chi2, p, dof, expected = chi2_contingency(obs)
        assert_approx_equal(chi2, 102.17, significant=5)
        assert_approx_equal(p, 3.514e-14, significant=4)
        assert_equal(dof, 17)

        # Rcode = \
        # """
        # # Data vector.
        # data <- c(
        #     #
        #     12, 17,
        #     11, 16,
        #     #
        #     11, 12,
        #     15, 16,
        #     #
        #     23, 15,
        #     30, 22,
        #     #
        #     14, 17,
        #     15, 16
        #     )
        #
        # # Create factor tags:r=rows, c=columns, d=depths(?), t=tiers
        # r <- factor(gl(2, 2,  2*2*2*2, labels=c("r1", "r2")))
        # c <- factor(gl(2, 1,  2*2*2*2, labels=c("c1", "c2")))
        # d <- factor(gl(2, 4,  2*2*2*2, labels=c("d1", "d2")))
        # t <- factor(gl(2, 8,  2*2*2*2, labels=c("t1", "t2")))
        #
        # # 4-way Chi squared test of independence
        # s = summary(xtabs(data~r+c+d+t))
        # print(s)
        # """
        # Routput = \
        # """
        # Call: xtabs(formula = data ~ r + c + d + t)
        # Number of cases in table: 262
        # Number of factors: 4
        # Test for independence of all factors:
        #         Chisq = 8.758, df = 11, p-value = 0.6442
        # """
        obs = np.array(
            [[[[12, 17],
               [11, 16]],
              [[11, 12],
               [15, 16]]],
             [[[23, 15],
               [30, 22]],
              [[14, 17],
               [15, 16]]]])
        chi2, p, dof, expected = chi2_contingency(obs)
        assert_approx_equal(chi2, 8.758, significant=4)
        assert_approx_equal(p, 0.6442, significant=4)
        assert_equal(dof, 11)

    def test_chi2_contingency_g(self):
        c = np.array([[15, 60], [15, 90]])
        g, p, dof, e = chi2_contingency(c, lambda_='log-likelihood',
                                        correction=False)
        assert_allclose(g, 2*xlogy(c, c/e).sum())

        g, p, dof, e = chi2_contingency(c, lambda_='log-likelihood',
                                        correction=True)
        c_corr = c + np.array([[-0.5, 0.5], [0.5, -0.5]])
        assert_allclose(g, 2*xlogy(c_corr, c_corr/e).sum())

        c = np.array([[10, 12, 10], [12, 10, 10]])
        g, p, dof, e = chi2_contingency(c, lambda_='log-likelihood')
        assert_allclose(g, 2*xlogy(c, c/e).sum())

    def test_chi2_contingency_bad_args(self):
        # Test that "bad" inputs raise a ValueError.

        # Negative value in the array of observed frequencies.
        obs = np.array([[-1, 10], [1, 2]])
        assert_raises(ValueError, chi2_contingency, obs)

        # The zeros in this will result in zeros in the array
        # of expected frequencies.
        obs = np.array([[0, 1], [0, 1]])
        assert_raises(ValueError, chi2_contingency, obs)

        # A degenerate case: `observed` has size 0.
        obs = np.empty((0, 8))
        assert_raises(ValueError, chi2_contingency, obs)

    def test_chi2_contingency_yates_gh13875(self):
        # Magnitude of Yates' continuity correction should not exceed difference
        # between expected and observed value of the statistic; see gh-13875
        observed = np.array([[1573, 3], [4, 0]])
        p = chi2_contingency(observed)[1]
        assert_allclose(p, 1, rtol=1e-12)

    @pytest.mark.parametrize("correction", [False, True])
    def test_result(self, correction):
        obs = np.array([[1, 2], [1, 2]])
        res = chi2_contingency(obs, correction=correction)
        assert_equal((res.statistic, res.pvalue, res.dof, res.expected_freq), res)

    @pytest.mark.slow
    def test_exact_permutation(self):
        table = np.arange(4).reshape(2, 2)
        ref_statistic = chi2_contingency(table, correction=False).statistic
        ref_pvalue = stats.fisher_exact(table).pvalue
        method = stats.PermutationMethod(n_resamples=50000)
        res = chi2_contingency(table, correction=False, method=method)
        assert_equal(res.statistic, ref_statistic)
        assert_allclose(res.pvalue, ref_pvalue, rtol=1e-15)

    @pytest.mark.slow
    @pytest.mark.parametrize('method', (stats.PermutationMethod,
                                        stats.MonteCarloMethod))
    def test_resampling_randomized(self, method):
        rng = np.random.default_rng(2592340925)
        # need to have big sum for asymptotic approximation to be good
        rows = [300, 1000, 800]
        cols = [200, 400, 800, 700]
        table = stats.random_table(rows, cols, seed=rng).rvs()
        res = chi2_contingency(table, correction=False, method=method(rng=rng))
        ref = chi2_contingency(table, correction=False)
        assert_equal(res.statistic, ref.statistic)
        assert_allclose(res.pvalue, ref.pvalue, atol=5e-3)
        assert_equal(res.dof, np.nan)
        assert_equal(res.expected_freq, ref.expected_freq)

    def test_resampling_invalid_args(self):
        table = np.arange(8).reshape(2, 2, 2)

        method = stats.PermutationMethod()
        message = "Use of `method` is only compatible with two-way tables."
        with pytest.raises(ValueError, match=message):
            chi2_contingency(table, correction=False, method=method)

        table = np.arange(4).reshape(2, 2)

        method = stats.PermutationMethod()
        message = "`correction=True` is not compatible with..."
        with pytest.raises(ValueError, match=message):
            chi2_contingency(table, method=method)

        method = stats.MonteCarloMethod()
        message = "`lambda_=2` is not compatible with..."
        with pytest.raises(ValueError, match=message):
            chi2_contingency(table, correction=False, lambda_=2, method=method)

        method = 'herring'
        message = "`method='herring'` not recognized; if provided, `method`..."
        with pytest.raises(ValueError, match=message):
            chi2_contingency(table, correction=False, method=method)

        method = stats.MonteCarloMethod(rvs=stats.norm.rvs)
        message = "If the `method` argument of `chi2_contingency` is..."
        with pytest.raises(ValueError, match=message):
            chi2_contingency(table, correction=False, method=method)


def test_bad_association_args():
    # Invalid Test Statistic
    assert_raises(ValueError, association, [[1, 2], [3, 4]], "X")
    # Invalid array shape
    assert_raises(ValueError, association, [[[1, 2]], [[3, 4]]], "cramer")
    # chi2_contingency exception
    assert_raises(ValueError, association, [[-1, 10], [1, 2]], 'cramer')
    # Invalid Array Item Data Type
    assert_raises(ValueError, association,
                  np.array([[1, 2], ["dd", 4]], dtype=object), 'cramer')


@pytest.mark.parametrize('stat, expected',
                         [('cramer', 0.09222412010290792),
                          ('tschuprow', 0.0775509319944633),
                          ('pearson', 0.12932925727138758)])
def test_assoc(stat, expected):
    # 2d Array
    obs1 = np.array([[12, 13, 14, 15, 16],
                     [17, 16, 18, 19, 11],
                     [9, 15, 14, 12, 11]])
    a = association(observed=obs1, method=stat)
    assert_allclose(a, expected)
