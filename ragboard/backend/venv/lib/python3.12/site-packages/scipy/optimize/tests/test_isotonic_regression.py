import numpy as np
from numpy.testing import assert_allclose, assert_equal
import pytest

from scipy.optimize._pava_pybind import pava
from scipy.optimize import isotonic_regression


class TestIsotonicRegression:
    @pytest.mark.parametrize(
        ("y", "w", "msg"),
        [
            ([[0, 1]], None,
             "array has incorrect number of dimensions: 2; expected 1"),
            ([0, 1], [[1, 2]],
             "Input arrays y and w must have one dimension of equal length"),
            ([0, 1], [1],
             "Input arrays y and w must have one dimension of equal length"),
            (1, [1, 2],
             "Input arrays y and w must have one dimension of equal length"),
            ([1, 2], 1,
             "Input arrays y and w must have one dimension of equal length"),
            ([0, 1], [0, 1],
             "Weights w must be strictly positive"),
        ]
    )
    def test_raise_error(self, y, w, msg):
        with pytest.raises(ValueError, match=msg):
            isotonic_regression(y=y, weights=w)

    def test_simple_pava(self):
        # Test case of Busing 2020
        # https://doi.org/10.18637/jss.v102.c01
        y = np.array([8, 4, 8, 2, 2, 0, 8], dtype=np.float64)
        w = np.ones_like(y)
        r = np.full(shape=y.shape[0] + 1, fill_value=-1, dtype=np.intp)
        pava(y, w, r)
        assert_allclose(y, [4, 4, 4, 4, 4, 4, 8])
        # Only first 2 elements of w are changed.
        assert_allclose(w, [6, 1, 1, 1, 1, 1, 1])
        # Only first 3 elements of r are changed.
        assert_allclose(r, [0, 6, 7, -1, -1, -1, -1, -1])

    @pytest.mark.parametrize("y_dtype", [np.float64, np.float32, np.int64, np.int32])
    @pytest.mark.parametrize("w_dtype", [np.float64, np.float32, np.int64, np.int32])
    @pytest.mark.parametrize("w", [None, "ones"])
    def test_simple_isotonic_regression(self, w, w_dtype, y_dtype):
        # Test case of Busing 2020
        # https://doi.org/10.18637/jss.v102.c01
        y = np.array([8, 4, 8, 2, 2, 0, 8], dtype=y_dtype)
        if w is not None:
            w = np.ones_like(y, dtype=w_dtype)
        res = isotonic_regression(y, weights=w)
        assert res.x.dtype == np.float64
        assert res.weights.dtype == np.float64
        assert_allclose(res.x, [4, 4, 4, 4, 4, 4, 8])
        assert_allclose(res.weights, [6, 1])
        assert_allclose(res.blocks, [0, 6, 7])
        # Assert that y was not overwritten
        assert_equal(y, np.array([8, 4, 8, 2, 2, 0, 8], dtype=np.float64))

    @pytest.mark.parametrize("increasing", [True, False])
    def test_linspace(self, increasing):
        n = 10
        y = np.linspace(0, 1, n) if increasing else np.linspace(1, 0, n)
        res = isotonic_regression(y, increasing=increasing)
        assert_allclose(res.x, y)
        assert_allclose(res.blocks, np.arange(n + 1))

    def test_weights(self):
        w = np.array([1, 2, 5, 0.5, 0.5, 0.5, 1, 3])
        y = np.array([3, 2, 1, 10, 9, 8, 20, 10])
        res = isotonic_regression(y, weights=w)
        assert_allclose(res.x, [12/8, 12/8, 12/8, 9, 9, 9, 50/4, 50/4])
        assert_allclose(res.weights, [8, 1.5, 4])
        assert_allclose(res.blocks, [0, 3, 6, 8])

        # weights are like repeated observations, we repeat the 3rd element 5
        # times.
        w2 = np.array([1, 2, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 1, 3])
        y2 = np.array([3, 2, 1, 1, 1, 1, 1, 10, 9, 8, 20, 10])
        res2 = isotonic_regression(y2, weights=w2)
        assert_allclose(np.diff(res2.x[0:7]), 0)
        assert_allclose(res2.x[4:], res.x)
        assert_allclose(res2.weights, res.weights)
        assert_allclose(res2.blocks[1:] - 4, res.blocks[1:])

    def test_against_R_monotone(self):
        y = [0, 6, 8, 3, 5, 2, 1, 7, 9, 4]
        res = isotonic_regression(y)
        # R code
        # library(monotone)
        # options(digits=8)
        # monotone(c(0, 6, 8, 3, 5, 2, 1, 7, 9, 4))
        x_R = [
            0, 4.1666667, 4.1666667, 4.1666667, 4.1666667, 4.1666667,
            4.1666667, 6.6666667, 6.6666667, 6.6666667,
        ]
        assert_allclose(res.x, x_R)
        assert_equal(res.blocks, [0, 1, 7, 10])

        n = 100
        y = np.linspace(0, 1, num=n, endpoint=False)
        y = 5 * y + np.sin(10 * y)
        res = isotonic_regression(y)
        # R code
        # library(monotone)
        # n <- 100
        # y <- 5 * ((1:n)-1)/n + sin(10 * ((1:n)-1)/n)
        # options(digits=8)
        # monotone(y)
        x_R = [
            0.00000000, 0.14983342, 0.29866933, 0.44552021, 0.58941834, 0.72942554,
            0.86464247, 0.99421769, 1.11735609, 1.23332691, 1.34147098, 1.44120736,
            1.53203909, 1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100,
            1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100,
            1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100,
            1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100,
            1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100,
            1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100, 1.57081100,
            1.57081100, 1.57081100, 1.57081100, 1.62418532, 1.71654534, 1.81773256,
            1.92723551, 2.04445967, 2.16873336, 2.29931446, 2.43539782, 2.57612334,
            2.72058450, 2.86783750, 3.01691060, 3.16681390, 3.31654920, 3.46511999,
            3.61154136, 3.75484992, 3.89411335, 4.02843976, 4.15698660, 4.27896904,
            4.39366786, 4.50043662, 4.59870810, 4.68799998, 4.76791967, 4.83816823,
            4.86564130, 4.86564130, 4.86564130, 4.86564130, 4.86564130, 4.86564130,
            4.86564130, 4.86564130, 4.86564130, 4.86564130, 4.86564130, 4.86564130,
            4.86564130, 4.86564130, 4.86564130, 4.86564130, 4.86564130, 4.86564130,
            4.86564130, 4.86564130, 4.86564130, 4.86564130,
        ]
        assert_allclose(res.x, x_R)

        # Test increasing
        assert np.all(np.diff(res.x) >= 0)

        # Test balance property: sum(y) == sum(x)
        assert_allclose(np.sum(res.x), np.sum(y))

        # Reverse order
        res_inv = isotonic_regression(-y, increasing=False)
        assert_allclose(-res_inv.x, res.x)
        assert_equal(res_inv.blocks, res.blocks)

    def test_readonly(self):
        x = np.arange(3, dtype=float)
        w = np.ones(3, dtype=float)

        x.flags.writeable = False
        w.flags.writeable = False

        res = isotonic_regression(x, weights=w)
        assert np.all(np.isfinite(res.x))
        assert np.all(np.isfinite(res.weights))
        assert np.all(np.isfinite(res.blocks))

    def test_non_contiguous_arrays(self):
        x = np.arange(10, dtype=float)[::3]
        w = np.ones(10, dtype=float)[::3]
        assert not x.flags.c_contiguous
        assert not x.flags.f_contiguous
        assert not w.flags.c_contiguous
        assert not w.flags.f_contiguous

        res = isotonic_regression(x, weights=w)
        assert np.all(np.isfinite(res.x))
        assert np.all(np.isfinite(res.weights))
        assert np.all(np.isfinite(res.blocks))
