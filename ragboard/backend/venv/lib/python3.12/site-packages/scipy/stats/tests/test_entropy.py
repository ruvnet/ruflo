import math
import pytest
from pytest import raises as assert_raises

import numpy as np

from scipy import stats
from scipy.stats import norm, expon  # type: ignore[attr-defined]
from scipy._lib._array_api_no_0d import (xp_assert_close, xp_assert_equal,
                                         xp_assert_less)

skip_xp_backends = pytest.mark.skip_xp_backends

@pytest.mark.skip_xp_backends("dask.array", reason="boolean index assignment")
class TestEntropy:
    def test_entropy_positive(self, xp):
        # See ticket #497
        pk = xp.asarray([0.5, 0.2, 0.3])
        qk = xp.asarray([0.1, 0.25, 0.65])
        eself = stats.entropy(pk, pk)
        edouble = stats.entropy(pk, qk)
        xp_assert_equal(eself, xp.asarray(0.))
        xp_assert_less(-edouble, xp.asarray(0.))

    def test_entropy_base(self, xp):
        pk = xp.ones(16)
        S = stats.entropy(pk, base=2.)
        xp_assert_less(xp.abs(S - 4.), xp.asarray(1.e-5))

        qk = xp.ones(16)
        qk = xp.where(xp.arange(16) < 8, 2., qk)
        S = stats.entropy(pk, qk)
        S2 = stats.entropy(pk, qk, base=2.)
        xp_assert_less(xp.abs(S/S2 - math.log(2.)), xp.asarray(1.e-5))

    def test_entropy_zero(self, xp):
        # Test for PR-479
        x = xp.asarray([0., 1., 2.])
        xp_assert_close(stats.entropy(x),
                        xp.asarray(0.63651416829481278))

    def test_entropy_2d(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        qk = xp.asarray([[0.2, 0.1], [0.3, 0.6], [0.5, 0.3]])
        xp_assert_close(stats.entropy(pk, qk),
                        xp.asarray([0.1933259, 0.18609809]))

    def test_entropy_2d_zero(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        qk = xp.asarray([[0.0, 0.1], [0.3, 0.6], [0.5, 0.3]])
        xp_assert_close(stats.entropy(pk, qk),
                        xp.asarray([xp.inf, 0.18609809]))

        pk = xp.asarray([[0.0, 0.2], [0.6, 0.3], [0.3, 0.5]])
        xp_assert_close(stats.entropy(pk, qk),
                        xp.asarray([0.17403988, 0.18609809]))

    def test_entropy_base_2d_nondefault_axis(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        xp_assert_close(stats.entropy(pk, axis=1),
                        xp.asarray([0.63651417, 0.63651417, 0.66156324]))

    def test_entropy_2d_nondefault_axis(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        qk = xp.asarray([[0.2, 0.1], [0.3, 0.6], [0.5, 0.3]])
        xp_assert_close(stats.entropy(pk, qk, axis=1),
                        xp.asarray([0.23104906, 0.23104906, 0.12770641]))

    def test_entropy_raises_value_error(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        qk = xp.asarray([[0.1, 0.2], [0.6, 0.3]])
        message = "Array shapes are incompatible for broadcasting."
        with pytest.raises(ValueError, match=message):
            stats.entropy(pk, qk)

    def test_base_entropy_with_axis_0_is_equal_to_default(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        xp_assert_close(stats.entropy(pk, axis=0),
                        stats.entropy(pk))

    def test_entropy_with_axis_0_is_equal_to_default(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        qk = xp.asarray([[0.2, 0.1], [0.3, 0.6], [0.5, 0.3]])
        xp_assert_close(stats.entropy(pk, qk, axis=0),
                        stats.entropy(pk, qk))

    def test_base_entropy_transposed(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        xp_assert_close(stats.entropy(pk.T),
                        stats.entropy(pk, axis=1))

    def test_entropy_transposed(self, xp):
        pk = xp.asarray([[0.1, 0.2], [0.6, 0.3], [0.3, 0.5]])
        qk = xp.asarray([[0.2, 0.1], [0.3, 0.6], [0.5, 0.3]])
        xp_assert_close(stats.entropy(pk.T, qk.T),
                        stats.entropy(pk, qk, axis=1))

    def test_entropy_broadcasting(self, xp):
        rng = np.random.default_rng(74187315492831452)
        x = xp.asarray(rng.random(3))
        y = xp.asarray(rng.random((2, 1)))
        res = stats.entropy(x, y, axis=-1)
        xp_assert_equal(res[0], stats.entropy(x, y[0, ...]))
        xp_assert_equal(res[1], stats.entropy(x, y[1, ...]))

    def test_entropy_shape_mismatch(self, xp):
        x = xp.ones((10, 1, 12))
        y = xp.ones((11, 2))
        message = "Array shapes are incompatible for broadcasting."
        with pytest.raises(ValueError, match=message):
            stats.entropy(x, y)

    def test_input_validation(self, xp):
        x = xp.ones(10)
        message = "`base` must be a positive number."
        with pytest.raises(ValueError, match=message):
            stats.entropy(x, base=-2)


@pytest.mark.skip_xp_backends("dask.array", reason="boolean index assignment")
class TestDifferentialEntropy:
    """
    Vasicek results are compared with the R package vsgoftest.

    # library(vsgoftest)
    #
    # samp <- c(<values>)
    # entropy.estimate(x = samp, window = <window_length>)

    """

    def test_differential_entropy_vasicek(self, xp):

        random_state = np.random.RandomState(0)
        values = random_state.standard_normal(100)
        values = xp.asarray(values.tolist())

        entropy = stats.differential_entropy(values, method='vasicek')
        xp_assert_close(entropy, xp.asarray(1.342551187000946))

        entropy = stats.differential_entropy(values, window_length=1,
                                             method='vasicek')
        xp_assert_close(entropy, xp.asarray(1.122044177725947))

        entropy = stats.differential_entropy(values, window_length=8,
                                             method='vasicek')
        xp_assert_close(entropy, xp.asarray(1.349401487550325))

    def test_differential_entropy_vasicek_2d_nondefault_axis(self, xp):
        random_state = np.random.RandomState(0)
        values = random_state.standard_normal((3, 100))
        values = xp.asarray(values.tolist())

        entropy = stats.differential_entropy(values, axis=1, method='vasicek')
        ref = xp.asarray([1.342551187000946, 1.341825903922332, 1.293774601883585])
        xp_assert_close(entropy, ref)

        entropy = stats.differential_entropy(values, axis=1, window_length=1,
                                             method='vasicek')
        ref = xp.asarray([1.122044177725947, 1.10294413850758, 1.129615790292772])
        xp_assert_close(entropy, ref)

        entropy = stats.differential_entropy(values, axis=1, window_length=8,
                                             method='vasicek')
        ref = xp.asarray([1.349401487550325, 1.338514126301301, 1.292331889365405])
        xp_assert_close(entropy, ref)


    def test_differential_entropy_raises_value_error(self, xp):
        random_state = np.random.RandomState(0)
        values = random_state.standard_normal((3, 100))
        values = xp.asarray(values.tolist())

        error_str = (
            r"Window length \({window_length}\) must be positive and less "
            r"than half the sample size \({sample_size}\)."
        )

        sample_size = values.shape[1]

        for window_length in {-1, 0, sample_size//2, sample_size}:

            formatted_error_str = error_str.format(
                window_length=window_length,
                sample_size=sample_size,
            )

            with assert_raises(ValueError, match=formatted_error_str):
                stats.differential_entropy(
                    values,
                    window_length=window_length,
                    axis=1,
                )

    def test_base_differential_entropy_with_axis_0_is_equal_to_default(self, xp):
        random_state = np.random.RandomState(0)
        values = random_state.standard_normal((100, 3))
        values = xp.asarray(values.tolist())

        entropy = stats.differential_entropy(values, axis=0)
        default_entropy = stats.differential_entropy(values)
        xp_assert_close(entropy, default_entropy)

    def test_base_differential_entropy_transposed(self, xp):
        random_state = np.random.RandomState(0)
        values = random_state.standard_normal((3, 100))
        values = xp.asarray(values.tolist())

        xp_assert_close(
            stats.differential_entropy(values.T),
            stats.differential_entropy(values, axis=1),
        )

    def test_input_validation(self, xp):
        x = np.random.rand(10)
        x = xp.asarray(x.tolist())

        message = "`base` must be a positive number or `None`."
        with pytest.raises(ValueError, match=message):
            stats.differential_entropy(x, base=-2)

        message = "`method` must be one of..."
        with pytest.raises(ValueError, match=message):
            stats.differential_entropy(x, method='ekki-ekki')

    @pytest.mark.parametrize('method', [
        'vasicek',
        'van es',
        'ebrahimi',
        pytest.param(
            'correa',
            marks=skip_xp_backends("array_api_strict",
                                   reason="Needs fancy indexing.")
        )
    ])
    def test_consistency(self, method, xp):
        # test that method is a consistent estimator
        n = 10000 if method == 'correa' else 1000000
        rvs = stats.norm.rvs(size=n, random_state=0)
        rvs = xp.asarray(rvs.tolist())
        expected = xp.asarray(float(stats.norm.entropy()))
        res = stats.differential_entropy(rvs, method=method)
        xp_assert_close(res, expected, rtol=0.005)

    # values from differential_entropy reference [6], table 1, n=50, m=7
    norm_rmse_std_cases = {  # method: (RMSE, STD)
                           'vasicek': (0.198, 0.109),
                           'van es': (0.212, 0.110),
                           'correa': (0.135, 0.112),
                           'ebrahimi': (0.128, 0.109)
                           }

    # values from differential_entropy reference [6], table 2, n=50, m=7
    expon_rmse_std_cases = {  # method: (RMSE, STD)
                            'vasicek': (0.194, 0.148),
                            'van es': (0.179, 0.149),
                            'correa': (0.155, 0.152),
                            'ebrahimi': (0.151, 0.148)
                            }

    rmse_std_cases = {norm: norm_rmse_std_cases,
                      expon: expon_rmse_std_cases}

    @pytest.mark.parametrize('method', [
        'vasicek',
        'van es',
        'ebrahimi',
        pytest.param(
            'correa',
            marks=skip_xp_backends("array_api_strict",
                                   reason="Needs fancy indexing.")
        )
    ])
    @pytest.mark.parametrize('dist', [norm, expon])
    def test_rmse_std(self, method, dist, xp):
        # test that RMSE and standard deviation of estimators matches values
        # given in differential_entropy reference [6]. Incidentally, also
        # tests vectorization.
        reps, n, m = 10000, 50, 7
        expected = self.rmse_std_cases[dist][method]
        rmse_expected, std_expected = xp.asarray(expected[0]), xp.asarray(expected[1])
        rvs = dist.rvs(size=(reps, n), random_state=0)
        rvs = xp.asarray(rvs.tolist())
        true_entropy = xp.asarray(float(dist.entropy()))
        res = stats.differential_entropy(rvs, window_length=m,
                                         method=method, axis=-1)
        xp_assert_close(xp.sqrt(xp.mean((res - true_entropy)**2)),
                        rmse_expected, atol=0.005)
        xp_assert_close(xp.std(res, correction=0), std_expected, atol=0.002)

    @pytest.mark.parametrize('n, method', [
        (8, 'van es'),
        (12, 'ebrahimi'),
        (1001, 'vasicek')
    ])
    def test_method_auto(self, n, method, xp):
        rvs = stats.norm.rvs(size=(n,), random_state=0)
        rvs = xp.asarray(rvs.tolist())
        res1 = stats.differential_entropy(rvs)
        res2 = stats.differential_entropy(rvs, method=method)
        xp_assert_equal(res1, res2)

    @pytest.mark.parametrize('method', [
        "vasicek",
        "van es",
        pytest.param(
            "correa",
            marks=skip_xp_backends("array_api_strict", reason="Needs fancy indexing.")
        ),
        "ebrahimi"
    ])
    @pytest.mark.parametrize('dtype', [None, 'float32', 'float64'])
    def test_dtypes_gh21192(self, xp, method, dtype):
        # gh-21192 noted a change in the output of method='ebrahimi'
        # with integer input. Check that the output is consistent regardless
        # of input dtype.
        x = [1, 1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 9, 10, 11]
        dtype_in = getattr(xp, str(dtype), None)
        dtype_out = getattr(xp, str(dtype), xp.asarray(1.).dtype)
        res = stats.differential_entropy(xp.asarray(x, dtype=dtype_in), method=method)
        ref = stats.differential_entropy(xp.asarray(x, dtype=xp.float64), method=method)
        xp_assert_close(res, xp.asarray(ref, dtype=dtype_out)[()])
