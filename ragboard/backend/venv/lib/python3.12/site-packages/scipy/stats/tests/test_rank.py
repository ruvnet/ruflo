import numpy as np
from numpy.testing import assert_equal, assert_array_equal
import pytest

from scipy import stats
from scipy.conftest import skip_xp_invalid_arg
from scipy.stats import rankdata, tiecorrect
from scipy._lib._array_api import xp_assert_equal, make_xp_test_case

class TestTieCorrect:

    def test_empty(self):
        """An empty array requires no correction, should return 1.0."""
        ranks = np.array([], dtype=np.float64)
        c = tiecorrect(ranks)
        assert_equal(c, 1.0)

    def test_one(self):
        """A single element requires no correction, should return 1.0."""
        ranks = np.array([1.0], dtype=np.float64)
        c = tiecorrect(ranks)
        assert_equal(c, 1.0)

    def test_no_correction(self):
        """Arrays with no ties require no correction."""
        ranks = np.arange(2.0)
        c = tiecorrect(ranks)
        assert_equal(c, 1.0)
        ranks = np.arange(3.0)
        c = tiecorrect(ranks)
        assert_equal(c, 1.0)

    def test_basic(self):
        """Check a few basic examples of the tie correction factor."""
        # One tie of two elements
        ranks = np.array([1.0, 2.5, 2.5])
        c = tiecorrect(ranks)
        T = 2.0
        N = ranks.size
        expected = 1.0 - (T**3 - T) / (N**3 - N)
        assert_equal(c, expected)

        # One tie of two elements (same as above, but tie is not at the end)
        ranks = np.array([1.5, 1.5, 3.0])
        c = tiecorrect(ranks)
        T = 2.0
        N = ranks.size
        expected = 1.0 - (T**3 - T) / (N**3 - N)
        assert_equal(c, expected)

        # One tie of three elements
        ranks = np.array([1.0, 3.0, 3.0, 3.0])
        c = tiecorrect(ranks)
        T = 3.0
        N = ranks.size
        expected = 1.0 - (T**3 - T) / (N**3 - N)
        assert_equal(c, expected)

        # Two ties, lengths 2 and 3.
        ranks = np.array([1.5, 1.5, 4.0, 4.0, 4.0])
        c = tiecorrect(ranks)
        T1 = 2.0
        T2 = 3.0
        N = ranks.size
        expected = 1.0 - ((T1**3 - T1) + (T2**3 - T2)) / (N**3 - N)
        assert_equal(c, expected)

    def test_overflow(self):
        ntie, k = 2000, 5
        a = np.repeat(np.arange(k), ntie)
        n = a.size  # ntie * k
        out = tiecorrect(rankdata(a))
        assert_equal(out, 1.0 - k * (ntie**3 - ntie) / float(n**3 - n))


@make_xp_test_case(stats.rankdata)
class TestRankData:

    def desired_dtype(self, method='average', has_nans=False, *, xp):
        if has_nans:
            return xp.asarray(1.).dtype
        return xp.asarray(1.).dtype if method=='average' else xp.asarray(1).dtype

    def test_empty(self, xp):
        """stats.rankdata of empty array should return an empty array."""
        a = xp.asarray([], dtype=xp.int64)
        r = rankdata(a)
        xp_assert_equal(r, xp.asarray([], dtype=self.desired_dtype(xp=xp)))

    def test_list(self):
        # test that NumPy still accepts lists
        r = rankdata([])
        assert_array_equal(r, np.array([]))

        r = rankdata([40, 10, 30, 10, 50])
        assert_equal(r, [4.0, 1.5, 3.0, 1.5, 5.0])

    @pytest.mark.parametrize("shape", [(0, 1, 2)])
    @pytest.mark.parametrize("axis", [None, *range(3)])
    def test_empty_multidim(self, shape, axis, xp):
        a = xp.empty(shape, dtype=xp.int64)
        r = rankdata(a, axis=axis)
        expected_shape = (0,) if axis is None else shape
        xp_assert_equal(r, xp.empty(expected_shape, dtype=self.desired_dtype(xp=xp)))

    def test_one(self, xp):
        """Check stats.rankdata with an array of length 1."""
        data = [100]
        a = xp.asarray(data, dtype=xp.int64)
        r = rankdata(a)
        xp_assert_equal(r, xp.asarray([1.0], dtype=self.desired_dtype(xp=xp)))

    def test_basic(self, xp):
        """Basic tests of stats.rankdata."""
        desired_dtype = self.desired_dtype(xp=xp)

        data = [100, 10, 50]
        expected = xp.asarray([3.0, 1.0, 2.0], dtype=desired_dtype)
        a = xp.asarray(data, dtype=xp.int64)
        r = rankdata(a)
        xp_assert_equal(r, expected)

        data = [40, 10, 30, 10, 50]
        expected = xp.asarray([4.0, 1.5, 3.0, 1.5, 5.0], dtype=desired_dtype)
        a = xp.asarray(data, dtype=xp.int64)
        r = rankdata(a)
        xp_assert_equal(r, expected)

        data = [20, 20, 20, 10, 10, 10]
        expected = xp.asarray([5.0, 5.0, 5.0, 2.0, 2.0, 2.0], dtype=desired_dtype)
        a = xp.asarray(data, dtype=xp.int64)
        r = rankdata(a)
        xp_assert_equal(r, expected)

        # # The docstring states explicitly that the argument is flattened.
        a2d = xp.reshape(a, (2, 3))
        r = rankdata(a2d)
        xp_assert_equal(r, expected)

    @skip_xp_invalid_arg
    def test_rankdata_object_string(self):

        def min_rank(a):
            return [1 + sum(i < j for i in a) for j in a]

        def max_rank(a):
            return [sum(i <= j for i in a) for j in a]

        def ordinal_rank(a):
            return min_rank([(x, i) for i, x in enumerate(a)])

        def average_rank(a):
            return [(i + j) / 2.0 for i, j in zip(min_rank(a), max_rank(a))]

        def dense_rank(a):
            b = np.unique(a)
            return [1 + sum(i < j for i in b) for j in a]

        rankf = dict(min=min_rank, max=max_rank, ordinal=ordinal_rank,
                     average=average_rank, dense=dense_rank)

        def check_ranks(a):
            for method in 'min', 'max', 'dense', 'ordinal', 'average':
                out = rankdata(a, method=method)
                assert_array_equal(out, rankf[method](a))

        val = ['foo', 'bar', 'qux', 'xyz', 'abc', 'efg', 'ace', 'qwe', 'qaz']
        check_ranks(np.random.choice(val, 200))
        check_ranks(np.random.choice(val, 200).astype('object'))

        val = np.array([0, 1, 2, 2.718, 3, 3.141], dtype='object')
        check_ranks(np.random.choice(val, 200).astype('object'))

    def test_large_int(self, xp):
        if hasattr(xp, 'uint64'):
            data = xp.asarray([2**60, 2**60+1], dtype=xp.uint64)
            r = rankdata(data)
            xp_assert_equal(r, xp.asarray([1.0, 2.0], dtype=self.desired_dtype(xp=xp)))

        data = xp.asarray([2**60, 2**60+1], dtype=xp.int64)
        r = rankdata(data)
        xp_assert_equal(r, xp.asarray([1.0, 2.0], dtype=self.desired_dtype(xp=xp)))

        data = xp.asarray([2**60, -2**60+1], dtype=xp.int64)
        r = rankdata(data)
        xp_assert_equal(r, xp.asarray([2.0, 1.0], dtype=self.desired_dtype(xp=xp)))

    @pytest.mark.parametrize('n', [10000, 100000, 1000000])
    def test_big_tie(self, n, xp):
        data = xp.ones(n)
        r = rankdata(data)
        expected_rank = 0.5 * (n + 1)
        ref = xp.asarray(expected_rank * data, dtype=self.desired_dtype(xp=xp))
        xp_assert_equal(r, ref)

    def test_axis(self, xp):
        data = xp.asarray([[0, 2, 1], [4, 2, 2]])

        expected0 = xp.asarray([[1., 1.5, 1.], [2., 1.5, 2.]])
        r0 = rankdata(data, axis=0)
        xp_assert_equal(r0, expected0)

        expected1 = xp.asarray([[1., 3., 2.], [3., 1.5, 1.5]])
        r1 = rankdata(data, axis=1)
        xp_assert_equal(r1, expected1)

    methods= ["average", "min", "max", "dense", "ordinal"]

    @pytest.mark.parametrize("axis", [0, 1])
    @pytest.mark.parametrize("method", methods)
    def test_size_0_axis(self, axis, method, xp):
        shape = (3, 0)
        desired_dtype = self.desired_dtype(method, xp=xp)
        data = xp.zeros(shape)
        r = rankdata(data, method=method, axis=axis)
        assert_equal(r.shape, shape)
        assert_equal(r.dtype, desired_dtype)
        xp_assert_equal(r, xp.empty(shape, dtype=desired_dtype))

    @pytest.mark.parametrize('axis', range(3))
    @pytest.mark.parametrize('method', methods)
    def test_nan_policy_omit_3d(self, axis, method):
        shape = (20, 21, 22)
        rng = np.random.RandomState(23983242)

        a = rng.random(size=shape)
        i = rng.random(size=shape) < 0.4
        j = rng.random(size=shape) < 0.1
        k = rng.random(size=shape) < 0.1
        a[i] = np.nan
        a[j] = -np.inf
        a[k] - np.inf

        def rank_1d_omit(a, method):
            out = np.zeros_like(a)
            i = np.isnan(a)
            a_compressed = a[~i]
            res = rankdata(a_compressed, method)
            out[~i] = res
            out[i] = np.nan
            return out

        def rank_omit(a, method, axis):
            return np.apply_along_axis(lambda a: rank_1d_omit(a, method),
                                       axis, a)

        res = rankdata(a, method, axis=axis, nan_policy='omit')
        res0 = rank_omit(a, method, axis=axis)

        assert_array_equal(res, res0)

    def test_nan_policy_2d_axis_none(self):
        # 2 2d-array test with axis=None
        data = [[0, np.nan, 3],
                [4, 2, np.nan],
                [1, 2, 2]]
        assert_array_equal(rankdata(data, axis=None, nan_policy='omit'),
                           [1., np.nan, 6., 7., 4., np.nan, 2., 4., 4.])
        assert_array_equal(rankdata(data, axis=None, nan_policy='propagate'),
                           [np.nan, np.nan, np.nan, np.nan, np.nan, np.nan,
                            np.nan, np.nan, np.nan])

    def test_nan_policy_raise(self):
        # 1 1d-array test
        data = [0, 2, 3, -2, np.nan, np.nan]
        with pytest.raises(ValueError, match="The input contains nan"):
            rankdata(data, nan_policy='raise')

        # 2 2d-array test
        data = [[0, np.nan, 3],
                [4, 2, np.nan],
                [np.nan, 2, 2]]

        with pytest.raises(ValueError, match="The input contains nan"):
            rankdata(data, axis=0, nan_policy="raise")

        with pytest.raises(ValueError, match="The input contains nan"):
            rankdata(data, axis=1, nan_policy="raise")

    def test_nan_policy_propagate(self):
        # 1 1d-array test
        data = [0, 2, 3, -2, np.nan, np.nan]
        assert_array_equal(rankdata(data, nan_policy='propagate'),
                           [np.nan, np.nan, np.nan, np.nan, np.nan, np.nan])

        # 2 2d-array test
        data = [[0, np.nan, 3],
                [4, 2, np.nan],
                [1, 2, 2]]
        assert_array_equal(rankdata(data, axis=0, nan_policy='propagate'),
                           [[1, np.nan, np.nan],
                            [3, np.nan, np.nan],
                            [2, np.nan, np.nan]])
        assert_array_equal(rankdata(data, axis=1, nan_policy='propagate'),
                           [[np.nan, np.nan, np.nan],
                            [np.nan, np.nan, np.nan],
                            [1, 2.5, 2.5]])

    _rankdata_cases = (
        # values, method, expected
        ([], 'average', []),
        ([], 'min', []),
        ([], 'max', []),
        ([], 'dense', []),
        ([], 'ordinal', []),
        #
        ([100], 'average', [1.0]),
        ([100], 'min', [1.0]),
        ([100], 'max', [1.0]),
        ([100], 'dense', [1.0]),
        ([100], 'ordinal', [1.0]),
        #
        ([100, 100, 100], 'average', [2.0, 2.0, 2.0]),
        ([100, 100, 100], 'min', [1.0, 1.0, 1.0]),
        ([100, 100, 100], 'max', [3.0, 3.0, 3.0]),
        ([100, 100, 100], 'dense', [1.0, 1.0, 1.0]),
        ([100, 100, 100], 'ordinal', [1.0, 2.0, 3.0]),
        #
        ([100, 300, 200], 'average', [1.0, 3.0, 2.0]),
        ([100, 300, 200], 'min', [1.0, 3.0, 2.0]),
        ([100, 300, 200], 'max', [1.0, 3.0, 2.0]),
        ([100, 300, 200], 'dense', [1.0, 3.0, 2.0]),
        ([100, 300, 200], 'ordinal', [1.0, 3.0, 2.0]),
        #
        ([100, 200, 300, 200], 'average', [1.0, 2.5, 4.0, 2.5]),
        ([100, 200, 300, 200], 'min', [1.0, 2.0, 4.0, 2.0]),
        ([100, 200, 300, 200], 'max', [1.0, 3.0, 4.0, 3.0]),
        ([100, 200, 300, 200], 'dense', [1.0, 2.0, 3.0, 2.0]),
        ([100, 200, 300, 200], 'ordinal', [1.0, 2.0, 4.0, 3.0]),
        #
        ([100, 200, 300, 200, 100], 'average', [1.5, 3.5, 5.0, 3.5, 1.5]),
        ([100, 200, 300, 200, 100], 'min', [1.0, 3.0, 5.0, 3.0, 1.0]),
        ([100, 200, 300, 200, 100], 'max', [2.0, 4.0, 5.0, 4.0, 2.0]),
        ([100, 200, 300, 200, 100], 'dense', [1.0, 2.0, 3.0, 2.0, 1.0]),
        ([100, 200, 300, 200, 100], 'ordinal', [1.0, 3.0, 5.0, 4.0, 2.0]),
        #
        ([10] * 30, 'ordinal', np.arange(1.0, 31.0)),
    )

    @pytest.mark.parametrize('case', _rankdata_cases)
    def test_cases(self, case, xp):
        values, method, expected = case
        r = rankdata(xp.asarray(values), method=method)
        ref = xp.asarray(expected, dtype=self.desired_dtype(method, xp=xp))
        xp_assert_equal(r, ref)
