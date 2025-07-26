import pytest
import numpy as np
from numpy.testing import assert_allclose

from scipy import stats
from scipy.stats._axis_nan_policy import SmallSampleWarning


class TestChatterjeeXi:
    @pytest.mark.parametrize('case', [
        dict(y_cont=True, statistic=-0.303030303030303, pvalue=0.9351329808526656),
        dict(y_cont=False, statistic=0.07407407407407396, pvalue=0.3709859367123997)])
    def test_against_R_XICOR(self, case):
        # Test against R package XICOR, e.g.
        # library(XICOR)
        # options(digits=16)
        # x = c(0.11027287231363914, 0.8154770102474279, 0.7073943466920335,
        #       0.6651317324378386, 0.6905752850115503, 0.06115250587536558,
        #       0.5209906494474178, 0.3155763519785274, 0.18405731803625924,
        #       0.8613557911541495)
        # y = c(0.8402081904493103, 0.5946972833914318, 0.23481606164114155,
        #       0.49754786197715384, 0.9146460831206026, 0.5848057749217579,
        #       0.7620801065573549, 0.31410063302647495, 0.7935620302236199,
        #       0.5423085761365468)
        # xicor(x, y, ties=FALSE, pvalue=TRUE)

        rng = np.random.default_rng(25982435982346983)
        x = rng.random(size=10)

        y = (rng.random(size=10) if case['y_cont']
             else rng.integers(0, 5, size=10))
        res = stats.chatterjeexi(x, y, y_continuous=case['y_cont'])

        assert_allclose(res.statistic, case['statistic'])
        assert_allclose(res.pvalue, case['pvalue'])

    @pytest.mark.parametrize('y_continuous', (False, True))
    def test_permutation_asymptotic(self, y_continuous):
        # XICOR doesn't seem to perform the permutation test as advertised, so
        # compare the result of a permutation test against an asymptotic test.
        rng = np.random.default_rng(2524579827426)
        n = np.floor(rng.uniform(100, 150)).astype(int)
        shape = (2, n)
        x = rng.random(size=shape)
        y = (rng.random(size=shape) if y_continuous
             else rng.integers(0, 10, size=shape))
        method = stats.PermutationMethod(rng=rng)
        res = stats.chatterjeexi(x, y, method=method,
                                 y_continuous=y_continuous, axis=-1)
        ref = stats.chatterjeexi(x, y, y_continuous=y_continuous, axis=-1)
        np.testing.assert_allclose(res.statistic, ref.statistic, rtol=1e-15)
        np.testing.assert_allclose(res.pvalue, ref.pvalue, rtol=2e-2)

    def test_input_validation(self):
        rng = np.random.default_rng(25932435798274926)
        x, y = rng.random(size=(2, 10))

        message = 'Array shapes are incompatible for broadcasting.'
        with pytest.raises(ValueError, match=message):
            stats.chatterjeexi(x, y[:-1])

        message = '...axis 10 is out of bounds for array...'
        with pytest.raises(ValueError, match=message):
            stats.chatterjeexi(x, y, axis=10)

        message = '`y_continuous` must be boolean.'
        with pytest.raises(ValueError, match=message):
            stats.chatterjeexi(x, y, y_continuous='a herring')

        message = "`method` must be 'asymptotic' or"
        with pytest.raises(ValueError, match=message):
            stats.chatterjeexi(x, y, method='ekki ekii')

    def test_special_cases(self):
        message = 'One or more sample arguments is too small...'
        with pytest.warns(SmallSampleWarning, match=message):
            res = stats.chatterjeexi([1], [2])

        assert np.isnan(res.statistic)
        assert np.isnan(res.pvalue)
