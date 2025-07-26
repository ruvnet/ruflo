import math

import numpy as np
import pytest
from numpy.testing import suppress_warnings

from scipy.stats import variation
from scipy._lib._util import AxisError
from scipy._lib._array_api import is_numpy
from scipy._lib._array_api_no_0d import xp_assert_equal, xp_assert_close
from scipy.stats._axis_nan_policy import (too_small_nd_omit, too_small_nd_not_omit,
                                          SmallSampleWarning)

skip_xp_backends = pytest.mark.skip_xp_backends


@skip_xp_backends('torch', reason='data-apis/array-api-compat#271')
class TestVariation:
    """
    Test class for scipy.stats.variation
    """

    def test_ddof(self, xp):
        x = xp.arange(9.0)
        xp_assert_close(variation(x, ddof=1), xp.asarray(math.sqrt(60/8)/4))

    @pytest.mark.parametrize('sgn', [1, -1])
    def test_sign(self, sgn, xp):
        x = xp.asarray([1., 2., 3., 4., 5.])
        v = variation(sgn*x)
        expected = xp.asarray(sgn*math.sqrt(2)/3)
        xp_assert_close(v, expected, rtol=1e-10)

    @skip_xp_backends(np_only=True, reason="test plain python scalar input")
    def test_scalar(self, xp):
        # A scalar is treated like a 1-d sequence with length 1.
        assert variation(4.0) == 0.0

    @pytest.mark.parametrize('nan_policy, expected',
                             [('propagate', np.nan),
                              ('omit', np.sqrt(20/3)/4)])
    @skip_xp_backends(np_only=True,
                      reason='`nan_policy` only supports NumPy backend')
    def test_variation_nan(self, nan_policy, expected, xp):
        x = xp.arange(10.)
        x[9] = xp.nan
        xp_assert_close(variation(x, nan_policy=nan_policy), expected)

    @skip_xp_backends(np_only=True,
                      reason='`nan_policy` only supports NumPy backend')
    def test_nan_policy_raise(self, xp):
        x = xp.asarray([1.0, 2.0, xp.nan, 3.0])
        with pytest.raises(ValueError, match='input contains nan'):
            variation(x, nan_policy='raise')

    @skip_xp_backends(np_only=True,
                      reason='`nan_policy` only supports NumPy backend')
    def test_bad_nan_policy(self, xp):
        with pytest.raises(ValueError, match='must be one of'):
            variation([1, 2, 3], nan_policy='foobar')

    @skip_xp_backends(np_only=True,
                      reason='`keepdims` only supports NumPy backend')
    def test_keepdims(self, xp):
        x = xp.reshape(xp.arange(10), (2, 5))
        y = variation(x, axis=1, keepdims=True)
        expected = np.array([[np.sqrt(2)/2],
                             [np.sqrt(2)/7]])
        xp_assert_close(y, expected)

    @skip_xp_backends(np_only=True,
                      reason='`keepdims` only supports NumPy backend')
    @pytest.mark.parametrize('axis, expected',
                             [(0, np.empty((1, 0))),
                              (1, np.full((5, 1), fill_value=np.nan))])
    def test_keepdims_size0(self, axis, expected, xp):
        x = xp.zeros((5, 0))
        if axis == 1:
            with pytest.warns(SmallSampleWarning, match=too_small_nd_not_omit):
                y = variation(x, axis=axis, keepdims=True)
        else:
            y = variation(x, axis=axis, keepdims=True)
        xp_assert_equal(y, expected)

    @skip_xp_backends(np_only=True,
                      reason='`keepdims` only supports NumPy backend')
    @pytest.mark.parametrize('incr, expected_fill', [(0, np.inf), (1, np.nan)])
    def test_keepdims_and_ddof_eq_len_plus_incr(self, incr, expected_fill, xp):
        x = xp.asarray([[1, 1, 2, 2], [1, 2, 3, 3]])
        y = variation(x, axis=1, ddof=x.shape[1] + incr, keepdims=True)
        xp_assert_equal(y, xp.full((2, 1), fill_value=expected_fill))

    @skip_xp_backends(np_only=True,
                      reason='`nan_policy` only supports NumPy backend')
    def test_propagate_nan(self, xp):
        # Check that the shape of the result is the same for inputs
        # with and without nans, cf gh-5817
        a = xp.reshape(xp.arange(8, dtype=float), (2, -1))
        a[1, 0] = xp.nan
        v = variation(a, axis=1, nan_policy="propagate")
        xp_assert_close(v, [math.sqrt(5/4)/1.5, xp.nan], atol=1e-15)

    @skip_xp_backends(np_only=True, reason='Python list input uses NumPy backend')
    def test_axis_none(self, xp):
        # Check that `variation` computes the result on the flattened
        # input when axis is None.
        y = variation([[0, 1], [2, 3]], axis=None)
        xp_assert_close(y, math.sqrt(5/4)/1.5)

    def test_bad_axis(self, xp):
        # Check that an invalid axis raises np.exceptions.AxisError.
        x = xp.asarray([[1, 2, 3], [4, 5, 6]])
        with pytest.raises((AxisError, IndexError)):
            variation(x, axis=10)

    @pytest.mark.filterwarnings("ignore:divide by zero encountered:RuntimeWarning:dask")
    def test_mean_zero(self, xp):
        # Check that `variation` returns inf for a sequence that is not
        # identically zero but whose mean is zero.
        x = xp.asarray([10., -3., 1., -4., -4.])
        y = variation(x)
        xp_assert_equal(y, xp.asarray(xp.inf))

        x2 = xp.stack([x, -10.*x])
        y2 = variation(x2, axis=1)
        xp_assert_equal(y2, xp.asarray([xp.inf, xp.inf]))

    @pytest.mark.filterwarnings("ignore:invalid value encountered:RuntimeWarning:dask")
    @pytest.mark.parametrize('x', [[0.]*5, [1, 2, np.inf, 9]])
    def test_return_nan(self, x, xp):
        x = xp.asarray(x)
        # Test some cases where `variation` returns nan.
        y = variation(x)
        xp_assert_equal(y, xp.asarray(xp.nan, dtype=x.dtype))

    @pytest.mark.parametrize('axis, expected',
                             [(0, []), (1, [np.nan]*3), (None, np.nan)])
    def test_2d_size_zero_with_axis(self, axis, expected, xp):
        x = xp.empty((3, 0))
        with suppress_warnings() as sup:
            # torch
            sup.filter(UserWarning, "std*")
            if axis != 0:
                if is_numpy(xp):
                    with pytest.warns(SmallSampleWarning, match="See documentation..."):
                        y = variation(x, axis=axis)
                else:
                    y = variation(x, axis=axis)
            else:
                y = variation(x, axis=axis)
        xp_assert_equal(y, xp.asarray(expected))

    def test_neg_inf(self, xp):
        # Edge case that produces -inf: ddof equals the number of non-nan
        # values, the values are not constant, and the mean is negative.
        x1 = xp.asarray([-3., -5.])
        xp_assert_equal(variation(x1, ddof=2), xp.asarray(-xp.inf))

    @skip_xp_backends(np_only=True,
                      reason='`nan_policy` only supports NumPy backend')
    def test_neg_inf_nan(self, xp):
        x2 = xp.asarray([[xp.nan, 1, -10, xp.nan],
                         [-20, -3, xp.nan, xp.nan]])
        xp_assert_equal(variation(x2, axis=1, ddof=2, nan_policy='omit'),
                        [-xp.inf, -xp.inf])

    @skip_xp_backends(np_only=True,
                      reason='`nan_policy` only supports NumPy backend')
    @pytest.mark.parametrize("nan_policy", ['propagate', 'omit'])
    def test_combined_edge_cases(self, nan_policy, xp):
        x = xp.asarray([[0, 10, xp.nan, 1],
                        [0, -5, xp.nan, 2],
                        [0, -5, xp.nan, 3]])
        if nan_policy == 'omit':
            with pytest.warns(SmallSampleWarning, match=too_small_nd_omit):
                y = variation(x, axis=0, nan_policy=nan_policy)
        else:
            y = variation(x, axis=0, nan_policy=nan_policy)
        xp_assert_close(y, [xp.nan, xp.inf, xp.nan, math.sqrt(2/3)/2])

    @skip_xp_backends(np_only=True,
                      reason='`nan_policy` only supports NumPy backend')
    @pytest.mark.parametrize(
        'ddof, expected',
        [(0, [np.sqrt(1/6), np.sqrt(5/8), np.inf, 0, np.nan, 0.0, np.nan]),
         (1, [0.5, np.sqrt(5/6), np.inf, 0, np.nan, 0, np.nan]),
         (2, [np.sqrt(0.5), np.sqrt(5/4), np.inf, np.nan, np.nan, 0, np.nan])]
    )
    def test_more_nan_policy_omit_tests(self, ddof, expected, xp):
        # The slightly strange formatting in the follow array is my attempt to
        # maintain a clean tabular arrangement of the data while satisfying
        # the demands of pycodestyle.  Currently, E201 and E241 are not
        # disabled by the `noqa` annotation.
        nan = xp.nan
        x = xp.asarray([[1.0, 2.0, nan, 3.0],
                        [0.0, 4.0, 3.0, 1.0],
                        [nan, -.5, 0.5, nan],
                        [nan, 9.0, 9.0, nan],
                        [nan, nan, nan, nan],
                        [3.0, 3.0, 3.0, 3.0],
                        [0.0, 0.0, 0.0, 0.0]])
        with pytest.warns(SmallSampleWarning, match=too_small_nd_omit):
            v = variation(x, axis=1, ddof=ddof, nan_policy='omit')
        xp_assert_close(v, expected)

    @skip_xp_backends(np_only=True,
                      reason='`nan_policy` only supports NumPy backend')
    def test_variation_ddof(self, xp):
        # test variation with delta degrees of freedom
        # regression test for gh-13341
        a = xp.asarray([1., 2., 3., 4., 5.])
        nan_a = xp.asarray([1, 2, 3, xp.nan, 4, 5, xp.nan])
        y = variation(a, ddof=1)
        nan_y = variation(nan_a, nan_policy="omit", ddof=1)
        xp_assert_close(y, math.sqrt(5/2)/3)
        assert y == nan_y
