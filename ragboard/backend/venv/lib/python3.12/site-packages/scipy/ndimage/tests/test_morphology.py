import numpy as np
from scipy._lib._array_api import (
    is_cupy, is_numpy,
    xp_assert_close, xp_assert_equal, assert_array_almost_equal
)
import pytest
from pytest import raises as assert_raises

from scipy import ndimage

from . import types

skip_xp_backends = pytest.mark.skip_xp_backends
xfail_xp_backends = pytest.mark.xfail_xp_backends
pytestmark = [skip_xp_backends(cpu_only=True, exceptions=['cupy', 'jax.numpy'])]


class TestNdimageMorphology:

    @xfail_xp_backends('cupy', reason='CuPy does not have distance_transform_bf.')
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_bf01(self, dtype, xp):
        dtype = getattr(xp, dtype)

        # brute force (bf) distance transform
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out, ft = ndimage.distance_transform_bf(data, 'euclidean',
                                                return_indices=True)
        expected = [[0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 1, 1, 0, 0, 0],
                    [0, 0, 1, 2, 4, 2, 1, 0, 0],
                    [0, 0, 1, 4, 8, 4, 1, 0, 0],
                    [0, 0, 1, 2, 4, 2, 1, 0, 0],
                    [0, 0, 0, 1, 1, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(out * out, expected)

        expected = [[[0, 0, 0, 0, 0, 0, 0, 0, 0],
                     [1, 1, 1, 1, 1, 1, 1, 1, 1],
                     [2, 2, 2, 2, 1, 2, 2, 2, 2],
                     [3, 3, 3, 2, 1, 2, 3, 3, 3],
                     [4, 4, 4, 4, 6, 4, 4, 4, 4],
                     [5, 5, 6, 6, 7, 6, 6, 5, 5],
                     [6, 6, 6, 7, 7, 7, 6, 6, 6],
                     [7, 7, 7, 7, 7, 7, 7, 7, 7],
                     [8, 8, 8, 8, 8, 8, 8, 8, 8]],
                    [[0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 2, 4, 6, 6, 7, 8],
                     [0, 1, 1, 2, 4, 6, 7, 7, 8],
                     [0, 1, 1, 1, 6, 7, 7, 7, 8],
                     [0, 1, 2, 2, 4, 6, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8]]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(ft, expected)

    @xfail_xp_backends('cupy', reason='CuPy does not have distance_transform_bf.')
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_bf02(self, dtype, xp):
        dtype = getattr(xp, dtype)

        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out, ft = ndimage.distance_transform_bf(data, 'cityblock',
                                                return_indices=True)

        expected = [[0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 1, 1, 0, 0, 0],
                    [0, 0, 1, 2, 2, 2, 1, 0, 0],
                    [0, 0, 1, 2, 3, 2, 1, 0, 0],
                    [0, 0, 1, 2, 2, 2, 1, 0, 0],
                    [0, 0, 0, 1, 1, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(out, expected)

        expected = [[[0, 0, 0, 0, 0, 0, 0, 0, 0],
                     [1, 1, 1, 1, 1, 1, 1, 1, 1],
                     [2, 2, 2, 2, 1, 2, 2, 2, 2],
                     [3, 3, 3, 3, 1, 3, 3, 3, 3],
                     [4, 4, 4, 4, 7, 4, 4, 4, 4],
                     [5, 5, 6, 7, 7, 7, 6, 5, 5],
                     [6, 6, 6, 7, 7, 7, 6, 6, 6],
                     [7, 7, 7, 7, 7, 7, 7, 7, 7],
                     [8, 8, 8, 8, 8, 8, 8, 8, 8]],
                    [[0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 2, 4, 6, 6, 7, 8],
                     [0, 1, 1, 1, 4, 7, 7, 7, 8],
                     [0, 1, 1, 1, 4, 7, 7, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8]]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(ft, expected)

    @xfail_xp_backends('cupy', reason='CuPy does not have distance_transform_bf.')
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_bf03(self, dtype, xp):
        dtype = getattr(xp, dtype)

        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out, ft = ndimage.distance_transform_bf(data, 'chessboard',
                                                return_indices=True)

        expected = [[0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 1, 1, 0, 0, 0],
                    [0, 0, 1, 1, 2, 1, 1, 0, 0],
                    [0, 0, 1, 2, 2, 2, 1, 0, 0],
                    [0, 0, 1, 1, 2, 1, 1, 0, 0],
                    [0, 0, 0, 1, 1, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(out, expected)

        expected = [[[0, 0, 0, 0, 0, 0, 0, 0, 0],
                     [1, 1, 1, 1, 1, 1, 1, 1, 1],
                     [2, 2, 2, 2, 1, 2, 2, 2, 2],
                     [3, 3, 4, 2, 2, 2, 4, 3, 3],
                     [4, 4, 5, 6, 6, 6, 5, 4, 4],
                     [5, 5, 6, 6, 7, 6, 6, 5, 5],
                     [6, 6, 6, 7, 7, 7, 6, 6, 6],
                     [7, 7, 7, 7, 7, 7, 7, 7, 7],
                     [8, 8, 8, 8, 8, 8, 8, 8, 8]],
                    [[0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 2, 5, 6, 6, 7, 8],
                     [0, 1, 1, 2, 6, 6, 7, 7, 8],
                     [0, 1, 1, 2, 6, 7, 7, 7, 8],
                     [0, 1, 2, 2, 6, 6, 7, 7, 8],
                     [0, 1, 2, 4, 5, 6, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8]]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(ft, expected)

    @skip_xp_backends(
        np_only=True, reason='inplace distances= arrays are numpy-specific'
    )
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_bf04(self, dtype, xp):
        dtype = getattr(xp, dtype)

        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        tdt, tft = ndimage.distance_transform_bf(data, return_indices=1)
        dts = []
        fts = []
        dt = xp.zeros(data.shape, dtype=xp.float64)
        ndimage.distance_transform_bf(data, distances=dt)
        dts.append(dt)
        ft = ndimage.distance_transform_bf(
            data, return_distances=False, return_indices=1)
        fts.append(ft)
        ft = np.indices(data.shape, dtype=xp.int32)
        ndimage.distance_transform_bf(
            data, return_distances=False, return_indices=True, indices=ft)
        fts.append(ft)
        dt, ft = ndimage.distance_transform_bf(
            data, return_indices=1)
        dts.append(dt)
        fts.append(ft)
        dt = xp.zeros(data.shape, dtype=xp.float64)
        ft = ndimage.distance_transform_bf(
            data, distances=dt, return_indices=True)
        dts.append(dt)
        fts.append(ft)
        ft = np.indices(data.shape, dtype=xp.int32)
        dt = ndimage.distance_transform_bf(
            data, return_indices=True, indices=ft)
        dts.append(dt)
        fts.append(ft)
        dt = xp.zeros(data.shape, dtype=xp.float64)
        ft = np.indices(data.shape, dtype=xp.int32)
        ndimage.distance_transform_bf(
            data, distances=dt, return_indices=True, indices=ft)
        dts.append(dt)
        fts.append(ft)
        for dt in dts:
            assert_array_almost_equal(tdt, dt)
        for ft in fts:
            assert_array_almost_equal(tft, ft)

    @xfail_xp_backends('cupy', reason='CuPy does not have distance_transform_bf')
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_bf05(self, dtype, xp):
        dtype = getattr(xp, dtype)

        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out, ft = ndimage.distance_transform_bf(
            data, 'euclidean', return_indices=True, sampling=[2, 2])
        expected = [[0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 4, 4, 4, 0, 0, 0],
                    [0, 0, 4, 8, 16, 8, 4, 0, 0],
                    [0, 0, 4, 16, 32, 16, 4, 0, 0],
                    [0, 0, 4, 8, 16, 8, 4, 0, 0],
                    [0, 0, 0, 4, 4, 4, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(out * out, expected)

        expected = [[[0, 0, 0, 0, 0, 0, 0, 0, 0],
                     [1, 1, 1, 1, 1, 1, 1, 1, 1],
                     [2, 2, 2, 2, 1, 2, 2, 2, 2],
                     [3, 3, 3, 2, 1, 2, 3, 3, 3],
                     [4, 4, 4, 4, 6, 4, 4, 4, 4],
                     [5, 5, 6, 6, 7, 6, 6, 5, 5],
                     [6, 6, 6, 7, 7, 7, 6, 6, 6],
                     [7, 7, 7, 7, 7, 7, 7, 7, 7],
                     [8, 8, 8, 8, 8, 8, 8, 8, 8]],
                    [[0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 2, 4, 6, 6, 7, 8],
                     [0, 1, 1, 2, 4, 6, 7, 7, 8],
                     [0, 1, 1, 1, 6, 7, 7, 7, 8],
                     [0, 1, 2, 2, 4, 6, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8]]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(ft, expected)

    @xfail_xp_backends('cupy', reason='CuPy does not have distance_transform_bf')
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_bf06(self, dtype, xp):
        dtype = getattr(xp, dtype)

        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out, ft = ndimage.distance_transform_bf(
            data, 'euclidean', return_indices=True, sampling=[2, 1])
        expected = [[0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 4, 1, 0, 0, 0],
                    [0, 0, 1, 4, 8, 4, 1, 0, 0],
                    [0, 0, 1, 4, 9, 4, 1, 0, 0],
                    [0, 0, 1, 4, 8, 4, 1, 0, 0],
                    [0, 0, 0, 1, 4, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(out * out, expected)

        expected = [[[0, 0, 0, 0, 0, 0, 0, 0, 0],
                     [1, 1, 1, 1, 1, 1, 1, 1, 1],
                     [2, 2, 2, 2, 2, 2, 2, 2, 2],
                     [3, 3, 3, 3, 2, 3, 3, 3, 3],
                     [4, 4, 4, 4, 4, 4, 4, 4, 4],
                     [5, 5, 5, 5, 6, 5, 5, 5, 5],
                     [6, 6, 6, 6, 7, 6, 6, 6, 6],
                     [7, 7, 7, 7, 7, 7, 7, 7, 7],
                     [8, 8, 8, 8, 8, 8, 8, 8, 8]],
                    [[0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 2, 6, 6, 6, 7, 8],
                     [0, 1, 1, 1, 6, 7, 7, 7, 8],
                     [0, 1, 1, 1, 7, 7, 7, 7, 8],
                     [0, 1, 1, 1, 6, 7, 7, 7, 8],
                     [0, 1, 2, 2, 4, 6, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8]]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(ft, expected)

    @xfail_xp_backends("cupy", reason="CuPy does not have distance_transform_bf")
    def test_distance_transform_bf07(self, xp):
        # test input validation per discussion on PR #13302
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]])
        with assert_raises(RuntimeError):
            ndimage.distance_transform_bf(
                data, return_distances=False, return_indices=False
            )

    @xfail_xp_backends("cupy", reason="CuPy does not have distance_transform_cdt")
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_cdt01(self, dtype, xp):
        dtype = getattr(xp, dtype)

        # chamfer type distance (cdt) transform
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out, ft = ndimage.distance_transform_cdt(
            data, 'cityblock', return_indices=True)
        bf = ndimage.distance_transform_bf(data, 'cityblock')
        assert_array_almost_equal(bf, out)

        expected = [[[0, 0, 0, 0, 0, 0, 0, 0, 0],
                     [1, 1, 1, 1, 1, 1, 1, 1, 1],
                     [2, 2, 2, 1, 1, 1, 2, 2, 2],
                     [3, 3, 2, 1, 1, 1, 2, 3, 3],
                     [4, 4, 4, 4, 1, 4, 4, 4, 4],
                     [5, 5, 5, 5, 7, 7, 6, 5, 5],
                     [6, 6, 6, 6, 7, 7, 6, 6, 6],
                     [7, 7, 7, 7, 7, 7, 7, 7, 7],
                     [8, 8, 8, 8, 8, 8, 8, 8, 8]],
                    [[0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 1, 1, 4, 7, 7, 7, 8],
                     [0, 1, 1, 1, 4, 5, 6, 7, 8],
                     [0, 1, 2, 2, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8]]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(ft, expected)

    @xfail_xp_backends("cupy", reason="CuPy does not have distance_transform_cdt")
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_cdt02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out, ft = ndimage.distance_transform_cdt(data, 'chessboard',
                                                 return_indices=True)
        bf = ndimage.distance_transform_bf(data, 'chessboard')
        assert_array_almost_equal(bf, out)

        expected = [[[0, 0, 0, 0, 0, 0, 0, 0, 0],
                     [1, 1, 1, 1, 1, 1, 1, 1, 1],
                     [2, 2, 2, 1, 1, 1, 2, 2, 2],
                     [3, 3, 2, 2, 1, 2, 2, 3, 3],
                     [4, 4, 3, 2, 2, 2, 3, 4, 4],
                     [5, 5, 4, 6, 7, 6, 4, 5, 5],
                     [6, 6, 6, 6, 7, 7, 6, 6, 6],
                     [7, 7, 7, 7, 7, 7, 7, 7, 7],
                     [8, 8, 8, 8, 8, 8, 8, 8, 8]],
                    [[0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 2, 3, 4, 6, 7, 8],
                     [0, 1, 1, 2, 2, 6, 6, 7, 8],
                     [0, 1, 1, 1, 2, 6, 7, 7, 8],
                     [0, 1, 1, 2, 6, 6, 7, 7, 8],
                     [0, 1, 2, 2, 5, 6, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8],
                     [0, 1, 2, 3, 4, 5, 6, 7, 8]]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(ft, expected)

    @skip_xp_backends(
        np_only=True, reason='inplace indices= arrays are numpy-specific'
    )
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_cdt03(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        tdt, tft = ndimage.distance_transform_cdt(data, return_indices=True)
        dts = []
        fts = []
        dt = xp.zeros(data.shape, dtype=xp.int32)
        ndimage.distance_transform_cdt(data, distances=dt)
        dts.append(dt)
        ft = ndimage.distance_transform_cdt(
            data, return_distances=False, return_indices=True)
        fts.append(ft)
        ft = xp.asarray(np.indices(data.shape, dtype=np.int32))
        ndimage.distance_transform_cdt(
            data, return_distances=False, return_indices=True, indices=ft)
        fts.append(ft)
        dt, ft = ndimage.distance_transform_cdt(
            data, return_indices=True)
        dts.append(dt)
        fts.append(ft)
        dt = xp.zeros(data.shape, dtype=xp.int32)
        ft = ndimage.distance_transform_cdt(
            data, distances=dt, return_indices=True)
        dts.append(dt)
        fts.append(ft)
        ft = xp.asarray(np.indices(data.shape, dtype=np.int32))
        dt = ndimage.distance_transform_cdt(
            data, return_indices=True, indices=ft)
        dts.append(dt)
        fts.append(ft)
        dt = xp.zeros(data.shape, dtype=xp.int32)
        ft = xp.asarray(np.indices(data.shape, dtype=np.int32))
        ndimage.distance_transform_cdt(data, distances=dt,
                                       return_indices=True, indices=ft)
        dts.append(dt)
        fts.append(ft)
        for dt in dts:
            assert_array_almost_equal(tdt, dt)
        for ft in fts:
            assert_array_almost_equal(tft, ft)

    @skip_xp_backends(
        np_only=True, reason='XXX: does not raise unless indices is a numpy array'
    )
    def test_distance_transform_cdt04(self, xp):
        # test input validation per discussion on PR #13302
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]])
        indices_out = xp.zeros((data.ndim,) + data.shape, dtype=xp.int32)
        with assert_raises(RuntimeError):
            ndimage.distance_transform_bf(
                data,
                return_distances=True,
                return_indices=False,
                indices=indices_out
            )

    @xfail_xp_backends("cupy", reason="CuPy does not have distance_transform_cdt")
    @xfail_xp_backends("torch", reason="int overflow")
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_cdt05(self, dtype, xp):
        dtype = getattr(xp, dtype)

        # test custom metric type per discussion on issue #17381
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        metric_arg = xp.ones((3, 3))
        actual = ndimage.distance_transform_cdt(data, metric=metric_arg)
        assert xp.sum(actual) == -21

    @xfail_xp_backends("cupy", reason="CuPy does not have distance_transform_bf")
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_edt01(self, dtype, xp):
        dtype = getattr(xp, dtype)

        # euclidean distance transform (edt)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out, ft = ndimage.distance_transform_edt(data, return_indices=True)
        bf = ndimage.distance_transform_bf(data, 'euclidean')
        assert_array_almost_equal(bf, out)

        # np-specific check
        np_ft = np.asarray(ft)
        dt = np_ft - np.indices(np_ft.shape[1:], dtype=np_ft.dtype)
        dt = dt.astype(np.float64)
        np.multiply(dt, dt, dt)
        dt = np.add.reduce(dt, axis=0)
        np.sqrt(dt, dt)

        dt = xp.asarray(dt)
        assert_array_almost_equal(bf, dt)

    @skip_xp_backends(
        np_only=True, reason='inplace distances= are numpy-specific'
    )
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_edt02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        tdt, tft = ndimage.distance_transform_edt(data, return_indices=True)
        dts = []
        fts = []

        dt = xp.zeros(data.shape, dtype=xp.float64)
        ndimage.distance_transform_edt(data, distances=dt)
        dts.append(dt)

        ft = ndimage.distance_transform_edt(
            data, return_distances=0, return_indices=True)
        fts.append(ft)

        ft = np.indices(data.shape, dtype=xp.int32)
        ft = xp.asarray(ft)
        ndimage.distance_transform_edt(
            data, return_distances=False, return_indices=True, indices=ft)
        fts.append(ft)

        dt, ft = ndimage.distance_transform_edt(
            data, return_indices=True)
        dts.append(dt)
        fts.append(ft)

        dt = xp.zeros(data.shape, dtype=xp.float64)
        ft = ndimage.distance_transform_edt(
            data, distances=dt, return_indices=True)
        dts.append(dt)
        fts.append(ft)

        ft = np.indices(data.shape, dtype=xp.int32)
        ft = xp.asarray(ft)
        dt = ndimage.distance_transform_edt(
            data, return_indices=True, indices=ft)
        dts.append(dt)
        fts.append(ft)

        dt = xp.zeros(data.shape, dtype=xp.float64)
        ft = np.indices(data.shape, dtype=xp.int32)
        ft = xp.asarray(ft)
        ndimage.distance_transform_edt(
            data, distances=dt, return_indices=True, indices=ft)
        dts.append(dt)
        fts.append(ft)

        for dt in dts:
            assert_array_almost_equal(tdt, dt)
        for ft in fts:
            assert_array_almost_equal(tft, ft)

    @xfail_xp_backends("cupy", reason="CuPy does not have distance_transform_bf")
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_edt03(self, dtype, xp):
        dtype = getattr(xp, dtype)

        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        ref = ndimage.distance_transform_bf(data, 'euclidean', sampling=[2, 2])
        out = ndimage.distance_transform_edt(data, sampling=[2, 2])
        assert_array_almost_equal(out, ref)

    @xfail_xp_backends("cupy", reason="CuPy does not have distance_transform_bf")
    @pytest.mark.parametrize('dtype', types)
    def test_distance_transform_edt4(self, dtype, xp):
        dtype = getattr(xp, dtype)

        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        ref = ndimage.distance_transform_bf(data, 'euclidean', sampling=[2, 1])
        out = ndimage.distance_transform_edt(data, sampling=[2, 1])
        assert_array_almost_equal(out, ref)

    @xfail_xp_backends(
        "cupy", reason="Only 2D and 3D distance transforms are supported in CuPy"
    )
    def test_distance_transform_edt5(self, xp):
        # Ticket #954 regression test
        out = ndimage.distance_transform_edt(xp.asarray(False))
        assert_array_almost_equal(out, xp.asarray([0.]))

    @xfail_xp_backends(
        np_only=True, reason='XXX: does not raise unless indices is a numpy array'
    )
    def test_distance_transform_edt6(self, xp):
        # test input validation per discussion on PR #13302
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0, 0]])
        distances_out = xp.zeros(data.shape, dtype=xp.float64)
        with assert_raises(RuntimeError):
            ndimage.distance_transform_bf(
                data,
                return_indices=True,
                return_distances=False,
                distances=distances_out
            )

    @skip_xp_backends(np_only=True,
                      reason="generate_binary_structure always generates numpy objects")
    def test_generate_structure01(self, xp):
        struct = ndimage.generate_binary_structure(0, 1)
        assert struct == 1

    @skip_xp_backends(np_only=True,
                      reason="generate_binary_structure always generates numpy objects")
    def test_generate_structure02(self, xp):
        struct = ndimage.generate_binary_structure(1, 1)
        assert_array_almost_equal(struct, [1, 1, 1])

    @skip_xp_backends(np_only=True,
                      reason="generate_binary_structure always generates numpy objects")
    def test_generate_structure03(self, xp):
        struct = ndimage.generate_binary_structure(2, 1)
        assert_array_almost_equal(struct, [[0, 1, 0],
                                           [1, 1, 1],
                                           [0, 1, 0]])

    @skip_xp_backends(np_only=True,
                      reason="generate_binary_structure always generates numpy objects")
    def test_generate_structure04(self, xp):
        struct = ndimage.generate_binary_structure(2, 2)
        assert_array_almost_equal(struct, [[1, 1, 1],
                                           [1, 1, 1],
                                           [1, 1, 1]])

    def test_iterate_structure01(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        out = ndimage.iterate_structure(struct, 2)
        expected = np.asarray([[0, 0, 1, 0, 0],
                               [0, 1, 1, 1, 0],
                               [1, 1, 1, 1, 1],
                               [0, 1, 1, 1, 0],
                               [0, 0, 1, 0, 0]], dtype=bool)
        expected = xp.asarray(expected)
        assert_array_almost_equal(out, expected)

    def test_iterate_structure02(self, xp):
        struct = [[0, 1],
                  [1, 1],
                  [0, 1]]
        struct = xp.asarray(struct)
        out = ndimage.iterate_structure(struct, 2)
        expected = np.asarray([[0, 0, 1],
                               [0, 1, 1],
                               [1, 1, 1],
                               [0, 1, 1],
                               [0, 0, 1]], dtype=bool)
        expected = xp.asarray(expected)

        assert_array_almost_equal(out, expected)

    def test_iterate_structure03(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        out = ndimage.iterate_structure(struct, 2, 1)
        expected = [[0, 0, 1, 0, 0],
                    [0, 1, 1, 1, 0],
                    [1, 1, 1, 1, 1],
                    [0, 1, 1, 1, 0],
                    [0, 0, 1, 0, 0]]
        expected = np.asarray(expected, dtype=bool)
        expected = xp.asarray(expected)
        assert_array_almost_equal(out[0], expected)
        assert out[1] == [2, 2]

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion01(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([], dtype=dtype)
        out = ndimage.binary_erosion(data)
        assert out == xp.asarray(1, dtype=out.dtype)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([], dtype=dtype)
        out = ndimage.binary_erosion(data, border_value=1)
        assert out == xp.asarray(1, dtype=out.dtype)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion03(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1], dtype=dtype)
        out = ndimage.binary_erosion(data)
        assert_array_almost_equal(out, xp.asarray([0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion04(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1], dtype=dtype)
        out = ndimage.binary_erosion(data, border_value=1)
        assert_array_almost_equal(out, xp.asarray([1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion05(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([3], dtype=dtype)
        out = ndimage.binary_erosion(data)
        assert_array_almost_equal(out, xp.asarray([0, 1, 0]))

    @pytest.mark.parametrize('dtype', types)
    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/issues/8912")
    def test_binary_erosion05_broadcasted(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones((1, ), dtype=dtype)
        data = xp.broadcast_to(data, (3, ))
        out = ndimage.binary_erosion(data)
        assert_array_almost_equal(out, xp.asarray([0, 1, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion06(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([3], dtype=dtype)
        out = ndimage.binary_erosion(data, border_value=1)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion07(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([5], dtype=dtype)
        out = ndimage.binary_erosion(data)
        assert_array_almost_equal(out, xp.asarray([0, 1, 1, 1, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion08(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([5], dtype=dtype)
        out = ndimage.binary_erosion(data, border_value=1)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 1, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion09(self, dtype, xp):
        data = np.ones([5], dtype=dtype)
        data[2] = 0
        data = xp.asarray(data)
        out = ndimage.binary_erosion(data)
        assert_array_almost_equal(out, xp.asarray([0, 0, 0, 0, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion10(self, dtype, xp):
        data = np.ones([5], dtype=dtype)
        data[2] = 0
        data = xp.asarray(data)
        out = ndimage.binary_erosion(data, border_value=1)
        assert_array_almost_equal(out, xp.asarray([1, 0, 0, 0, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion11(self, dtype, xp):
        data = np.ones([5], dtype=dtype)
        data[2] = 0
        data = xp.asarray(data)
        struct = xp.asarray([1, 0, 1])
        out = ndimage.binary_erosion(data, struct, border_value=1)
        assert_array_almost_equal(out, xp.asarray([1, 0, 1, 0, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion12(self, dtype, xp):
        data = np.ones([5], dtype=dtype)
        data[2] = 0
        data = xp.asarray(data)
        struct = xp.asarray([1, 0, 1])
        out = ndimage.binary_erosion(data, struct, border_value=1, origin=-1)
        assert_array_almost_equal(out, xp.asarray([0, 1, 0, 1, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion13(self, dtype, xp):
        data = np.ones([5], dtype=dtype)
        data[2] = 0
        data = xp.asarray(data)
        struct = xp.asarray([1, 0, 1])
        out = ndimage.binary_erosion(data, struct, border_value=1, origin=1)
        assert_array_almost_equal(out, xp.asarray([1, 1, 0, 1, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion14(self, dtype, xp):
        data = np.ones([5], dtype=dtype)
        data[2] = 0
        data = xp.asarray(data)
        struct = xp.asarray([1, 1])
        out = ndimage.binary_erosion(data, struct, border_value=1)
        assert_array_almost_equal(out, xp.asarray([1, 1, 0, 0, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion15(self, dtype, xp):
        data = np.ones([5], dtype=dtype)
        data[2] = 0
        data = xp.asarray(data)
        struct = xp.asarray([1, 1])
        out = ndimage.binary_erosion(data, struct, border_value=1, origin=-1)
        assert_array_almost_equal(out, xp.asarray([1, 0, 0, 1, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion16(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1, 1], dtype=dtype)
        out = ndimage.binary_erosion(data, border_value=1)
        assert_array_almost_equal(out, xp.asarray([[1]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion17(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1, 1], dtype=dtype)
        out = ndimage.binary_erosion(data)
        assert_array_almost_equal(out, xp.asarray([[0]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion18(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1, 3], dtype=dtype)
        out = ndimage.binary_erosion(data)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion19(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1, 3], dtype=dtype)
        out = ndimage.binary_erosion(data, border_value=1)
        assert_array_almost_equal(out, xp.asarray([[1, 1, 1]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion20(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([3, 3], dtype=dtype)
        out = ndimage.binary_erosion(data)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0],
                                                   [0, 1, 0],
                                                   [0, 0, 0]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion21(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([3, 3], dtype=dtype)
        out = ndimage.binary_erosion(data, border_value=1)
        assert_array_almost_equal(out, xp.asarray([[1, 1, 1],
                                                   [1, 1, 1],
                                                   [1, 1, 1]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion22(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 1, 0, 0],
                    [0, 0, 0, 1, 1, 0, 0, 0],
                    [0, 0, 1, 0, 0, 1, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 1, 1],
                           [0, 0, 1, 1, 1, 1, 1, 1],
                           [0, 0, 1, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 1, 1, 0, 0, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_erosion(data, border_value=1)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion23(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = ndimage.generate_binary_structure(2, 2)
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 1, 1],
                           [0, 0, 1, 1, 1, 1, 1, 1],
                           [0, 0, 1, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 1, 1, 0, 0, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_erosion(data, struct, border_value=1)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion24(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = xp.asarray([[0, 1],
                             [1, 1]])
        expected = [[0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 1, 1, 1],
                    [0, 0, 0, 1, 1, 1, 0, 0],
                    [0, 0, 1, 1, 1, 1, 0, 0],
                    [0, 0, 1, 0, 0, 0, 1, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 1, 1],
                           [0, 0, 1, 1, 1, 1, 1, 1],
                           [0, 0, 1, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 1, 1, 0, 0, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_erosion(data, struct, border_value=1)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion25(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = [[0, 1, 0],
                  [1, 0, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 1, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0, 0],
                    [0, 0, 1, 0, 0, 1, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 1, 1],
                           [0, 0, 1, 1, 1, 0, 1, 1],
                           [0, 0, 1, 0, 1, 1, 0, 0],
                           [0, 1, 0, 1, 1, 1, 1, 0],
                           [0, 1, 1, 0, 0, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_erosion(data, struct, border_value=1)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_erosion26(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = [[0, 1, 0],
                  [1, 0, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 1],
                    [0, 0, 0, 0, 1, 0, 0, 1],
                    [0, 0, 1, 0, 0, 0, 0, 0],
                    [0, 1, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 1]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 1, 1],
                           [0, 0, 1, 1, 1, 0, 1, 1],
                           [0, 0, 1, 0, 1, 1, 0, 0],
                           [0, 1, 0, 1, 1, 1, 1, 0],
                           [0, 1, 1, 0, 0, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_erosion(data, struct, border_value=1,
                                     origin=(-1, -1))
        assert_array_almost_equal(out, expected)

    @xfail_xp_backends(
        "cupy", reason="CuPy: NotImplementedError: only brute_force iteration"
    )
    def test_binary_erosion27(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_erosion(data, struct, border_value=1,
                                     iterations=2)
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='inplace out= arguments are numpy-specific')
    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_erosion28(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = np.asarray(expected, dtype=bool)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = np.zeros(data.shape, dtype=bool)
        out = xp.asarray(out)
        ndimage.binary_erosion(data, struct, border_value=1,
                               iterations=2, output=out)
        assert_array_almost_equal(out, expected)

    @xfail_xp_backends(
        "cupy", reason="CuPy: NotImplementedError: only brute_force iteration"
    )
    def test_binary_erosion29(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [1, 1, 1, 1, 1, 1, 1],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_erosion(data, struct,
                                     border_value=1, iterations=3)
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='inplace out= arguments are numpy-specific')
    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_erosion30(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = np.asarray(expected, dtype=bool)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [1, 1, 1, 1, 1, 1, 1],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = np.zeros(data.shape, dtype=bool)
        out = xp.asarray(out)
        ndimage.binary_erosion(data, struct, border_value=1,
                               iterations=3, output=out)
        assert_array_almost_equal(out, expected)

        # test with output memory overlap
        ndimage.binary_erosion(data, struct, border_value=1,
                               iterations=3, output=data)
        assert_array_almost_equal(data, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='inplace out= arguments are numpy-specific')
    def test_binary_erosion31(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 1, 0, 0, 0, 0],
                    [0, 1, 1, 1, 0, 0, 0],
                    [1, 1, 1, 1, 1, 0, 1],
                    [0, 1, 1, 1, 0, 0, 0],
                    [0, 0, 1, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 1, 0, 0, 0, 1]]
        expected = np.asarray(expected, dtype=bool)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [1, 1, 1, 1, 1, 1, 1],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = np.zeros(data.shape, dtype=bool)
        out = xp.asarray(out)
        ndimage.binary_erosion(data, struct, border_value=1,
                               iterations=1, output=out, origin=(-1, -1))
        assert_array_almost_equal(out, expected)

    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_erosion32(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_erosion(data, struct,
                                     border_value=1, iterations=2)
        assert_array_almost_equal(out, expected)

    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_erosion33(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 1, 1],
                    [0, 0, 0, 0, 0, 0, 1],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        mask = [[1, 1, 1, 1, 1, 0, 0],
                [1, 1, 1, 1, 1, 1, 0],
                [1, 1, 1, 1, 1, 1, 1],
                [1, 1, 1, 1, 1, 1, 1],
                [1, 1, 1, 1, 1, 1, 1],
                [1, 1, 1, 1, 1, 1, 1],
                [1, 1, 1, 1, 1, 1, 1]]
        mask = xp.asarray(mask)
        data = np.asarray([[0, 0, 0, 0, 0, 1, 1],
                           [0, 0, 0, 1, 0, 0, 1],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_erosion(data, struct,
                                     border_value=1, mask=mask, iterations=-1)
        assert_array_almost_equal(out, expected)

    def test_binary_erosion34(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 1, 1, 1, 1, 1, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        mask = [[0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0],
                [0, 0, 1, 1, 1, 0, 0],
                [0, 0, 1, 0, 1, 0, 0],
                [0, 0, 1, 1, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0]]
        mask = xp.asarray(mask)
        data = np.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_erosion(data, struct,
                                     border_value=1, mask=mask)
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"], 
                      reason='inplace out= arguments are numpy-specific')
    def test_binary_erosion35(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        mask = [[0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0],
                [0, 0, 1, 1, 1, 0, 0],
                [0, 0, 1, 0, 1, 0, 0],
                [0, 0, 1, 1, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0]]
        mask = np.asarray(mask, dtype=bool)
        mask = xp.asarray(mask)
        data = np.asarray([[0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [1, 1, 1, 1, 1, 1, 1],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        tmp = [[0, 0, 1, 0, 0, 0, 0],
               [0, 1, 1, 1, 0, 0, 0],
               [1, 1, 1, 1, 1, 0, 1],
               [0, 1, 1, 1, 0, 0, 0],
               [0, 0, 1, 0, 0, 0, 0],
               [0, 0, 0, 0, 0, 0, 0],
               [0, 0, 1, 0, 0, 0, 1]]
        tmp = np.asarray(tmp, dtype=bool)
        tmp = xp.asarray(tmp)
        expected = xp.logical_and(tmp, mask)
        tmp = xp.logical_and(data, xp.logical_not(mask))
        expected = xp.logical_or(expected, tmp)
        out = np.zeros(data.shape, dtype=bool)
        out = xp.asarray(out)
        ndimage.binary_erosion(data, struct, border_value=1,
                               iterations=1, output=out,
                               origin=(-1, -1), mask=mask)
        assert_array_almost_equal(out, expected)

    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_erosion36(self, xp):
        struct = [[0, 1, 0],
                  [1, 0, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        mask = [[0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 1, 1, 1, 0, 0, 0],
                [0, 0, 1, 0, 1, 0, 0, 0],
                [0, 0, 1, 1, 1, 0, 0, 0],
                [0, 0, 1, 1, 1, 0, 0, 0],
                [0, 0, 1, 1, 1, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0]]
        mask = np.asarray(mask, dtype=bool)
        mask = xp.asarray(mask)
        tmp = [[0, 0, 0, 0, 0, 0, 0, 0],
               [0, 0, 0, 0, 0, 0, 0, 1],
               [0, 0, 0, 0, 1, 0, 0, 1],
               [0, 0, 1, 0, 0, 0, 0, 0],
               [0, 1, 0, 0, 1, 0, 0, 0],
               [0, 0, 0, 0, 0, 0, 0, 0],
               [0, 0, 0, 0, 0, 0, 0, 0],
               [0, 0, 0, 0, 0, 0, 0, 1]]
        tmp = np.asarray(tmp, dtype=bool)
        tmp = xp.asarray(tmp)
        data = np.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                            [0, 1, 0, 0, 0, 0, 0, 0],
                            [0, 0, 0, 0, 0, 1, 1, 1],
                            [0, 0, 1, 1, 1, 0, 1, 1],
                            [0, 0, 1, 0, 1, 1, 0, 0],
                            [0, 1, 0, 1, 1, 1, 1, 0],
                            [0, 1, 1, 0, 0, 1, 1, 0],
                            [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        expected = xp.logical_and(tmp, mask)
        tmp = xp.logical_and(data, xp.logical_not(mask))
        expected = xp.logical_or(expected, tmp)
        out = ndimage.binary_erosion(data, struct, mask=mask,
                                     border_value=1, origin=(-1, -1))
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='inplace out= arguments are numpy-specific')
    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_erosion37(self, xp):
        a = np.asarray([[1, 0, 1],
                        [0, 1, 0],
                        [1, 0, 1]], dtype=bool)
        a = xp.asarray(a)
        b = xp.zeros_like(a)
        out = ndimage.binary_erosion(a, structure=a, output=b, iterations=0,
                                     border_value=True, brute_force=True)
        assert out is b
        xp_assert_equal(
            ndimage.binary_erosion(a, structure=a, iterations=0,
                                   border_value=True),
            b)

    def test_binary_erosion38(self, xp):
        data = np.asarray([[1, 0, 1],
                           [0, 1, 0],
                           [1, 0, 1]], dtype=bool)
        data = xp.asarray(data)
        iterations = 2.0
        with assert_raises(TypeError):
            _ = ndimage.binary_erosion(data, iterations=iterations)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='inplace out= arguments are numpy-specific')
    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_erosion39(self, xp):
        iterations = np.int32(3)
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected, dtype=bool)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [1, 1, 1, 1, 1, 1, 1],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = np.zeros(data.shape, dtype=bool)
        out = xp.asarray(out)
        ndimage.binary_erosion(data, struct, border_value=1,
                               iterations=iterations, output=out)
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='inplace out= arguments are numpy-specific')
    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_erosion40(self, xp):
        iterations = np.int64(3)
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0]]
        expected = np.asarray(expected, dtype=bool)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [1, 1, 1, 1, 1, 1, 1],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = np.zeros(data.shape, dtype=bool)
        out = xp.asarray(out)
        ndimage.binary_erosion(data, struct, border_value=1,
                               iterations=iterations, output=out)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation01(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert out == xp.asarray(1, dtype=out.dtype)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.zeros([], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert out == xp.asarray(False)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation03(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([1], dtype=out.dtype))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation04(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.zeros([1], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation05(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([3], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation05_broadcasted(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones((1, ), dtype=dtype)
        data = xp.broadcast_to(data, (3,))
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation06(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.zeros([3], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([0, 0, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation07(self, dtype, xp):
        data = np.zeros([3], dtype=dtype)
        data[1] = 1
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation08(self, dtype, xp):
        data = np.zeros([5], dtype=dtype)
        data[1] = 1
        data[3] = 1
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 1, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation09(self, dtype, xp):
        data = np.zeros([5], dtype=dtype)
        data[1] = 1
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 0, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation10(self, dtype, xp):
        data = np.zeros([5], dtype=dtype)
        data[1] = 1
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data, origin=-1)
        assert_array_almost_equal(out, xp.asarray([0, 1, 1, 1, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation11(self, dtype, xp):
        data = np.zeros([5], dtype=dtype)
        data[1] = 1
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data, origin=1)
        assert_array_almost_equal(out, xp.asarray([1, 1, 0, 0, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation12(self, dtype, xp):
        data = np.zeros([5], dtype=dtype)
        data[1] = 1
        data = xp.asarray(data)
        struct = xp.asarray([1, 0, 1])
        out = ndimage.binary_dilation(data, struct)
        assert_array_almost_equal(out, xp.asarray([1, 0, 1, 0, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation13(self, dtype, xp):
        data = np.zeros([5], dtype=dtype)
        data[1] = 1
        data = xp.asarray(data)
        struct = xp.asarray([1, 0, 1])
        out = ndimage.binary_dilation(data, struct, border_value=1)
        assert_array_almost_equal(out, xp.asarray([1, 0, 1, 0, 1]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation14(self, dtype, xp):
        data = np.zeros([5], dtype=dtype)
        data[1] = 1
        data = xp.asarray(data)
        struct = xp.asarray([1, 0, 1])
        out = ndimage.binary_dilation(data, struct, origin=-1)
        assert_array_almost_equal(out, xp.asarray([0, 1, 0, 1, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation15(self, dtype, xp):
        data = np.zeros([5], dtype=dtype)
        data[1] = 1
        data = xp.asarray(data)
        struct = xp.asarray([1, 0, 1])
        out = ndimage.binary_dilation(data, struct,
                                      origin=-1, border_value=1)
        assert_array_almost_equal(out, xp.asarray([1, 1, 0, 1, 0]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation16(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1, 1], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([[1]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation17(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.zeros([1, 1], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([[0]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation18(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([1, 3], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([[1, 1, 1]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation19(self, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([3, 3], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([[1, 1, 1],
                                                   [1, 1, 1],
                                                   [1, 1, 1]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation20(self, dtype, xp):
        data = np.zeros([3, 3], dtype=dtype)
        data[1, 1] = 1
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, xp.asarray([[0, 1, 0],
                                                   [1, 1, 1],
                                                   [0, 1, 0]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation21(self, dtype, xp):
        struct = ndimage.generate_binary_structure(2, 2)
        struct = xp.asarray(struct)
        data = np.zeros([3, 3], dtype=dtype)
        data[1, 1] = 1
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data, struct)
        assert_array_almost_equal(out, xp.asarray([[1, 1, 1],
                                                   [1, 1, 1],
                                                   [1, 1, 1]]))

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation22(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[0, 1, 0, 0, 0, 0, 0, 0],
                    [1, 1, 1, 0, 0, 0, 0, 0],
                    [0, 1, 0, 0, 0, 1, 0, 0],
                    [0, 0, 0, 1, 1, 1, 1, 0],
                    [0, 0, 1, 1, 1, 1, 0, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 0, 1, 0, 0, 1, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_dilation(data)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation23(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[1, 1, 1, 1, 1, 1, 1, 1],
                    [1, 1, 1, 0, 0, 0, 0, 1],
                    [1, 1, 0, 0, 0, 1, 0, 1],
                    [1, 0, 0, 1, 1, 1, 1, 1],
                    [1, 0, 1, 1, 1, 1, 0, 1],
                    [1, 1, 1, 1, 1, 1, 1, 1],
                    [1, 0, 1, 0, 0, 1, 0, 1],
                    [1, 1, 1, 1, 1, 1, 1, 1]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_dilation(data, border_value=1)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation24(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[1, 1, 0, 0, 0, 0, 0, 0],
                    [1, 0, 0, 0, 1, 0, 0, 0],
                    [0, 0, 1, 1, 1, 1, 0, 0],
                    [0, 1, 1, 1, 1, 0, 0, 0],
                    [1, 1, 1, 1, 1, 1, 0, 0],
                    [0, 1, 0, 0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_dilation(data, origin=(1, 1))
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation25(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[1, 1, 0, 0, 0, 0, 1, 1],
                    [1, 0, 0, 0, 1, 0, 1, 1],
                    [0, 0, 1, 1, 1, 1, 1, 1],
                    [0, 1, 1, 1, 1, 0, 1, 1],
                    [1, 1, 1, 1, 1, 1, 1, 1],
                    [0, 1, 0, 0, 1, 0, 1, 1],
                    [1, 1, 1, 1, 1, 1, 1, 1],
                    [1, 1, 1, 1, 1, 1, 1, 1]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_dilation(data, origin=(1, 1), border_value=1)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation26(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = ndimage.generate_binary_structure(2, 2)
        expected = [[1, 1, 1, 0, 0, 0, 0, 0],
                    [1, 1, 1, 0, 0, 0, 0, 0],
                    [1, 1, 1, 0, 1, 1, 1, 0],
                    [0, 0, 1, 1, 1, 1, 1, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        struct = xp.asarray(struct)
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_dilation(data, struct)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation27(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = [[0, 1],
                  [1, 1]]
        expected = [[0, 1, 0, 0, 0, 0, 0, 0],
                    [1, 1, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 1, 0, 0],
                    [0, 0, 0, 1, 1, 1, 0, 0],
                    [0, 0, 1, 1, 1, 1, 0, 0],
                    [0, 1, 1, 0, 1, 1, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        struct = xp.asarray(struct)
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_dilation(data, struct)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation28(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[1, 1, 1, 1],
                    [1, 0, 0, 1],
                    [1, 0, 0, 1],
                    [1, 1, 1, 1]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0],
                           [0, 0, 0, 0],
                           [0, 0, 0, 0],
                           [0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_dilation(data, border_value=1)
        assert_array_almost_equal(out, expected)

    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_dilation29(self, xp):
        struct = [[0, 1],
                  [1, 1]]
        expected = [[0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0],
                    [0, 0, 1, 1, 0],
                    [0, 1, 1, 1, 0],
                    [0, 0, 0, 0, 0]]
        struct = xp.asarray(struct)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 0],
                           [0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data, struct, iterations=2)
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='output= arrays are numpy-specific')
    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_dilation30(self, xp):
        struct = [[0, 1],
                  [1, 1]]
        expected = [[0, 0, 0, 0, 0],
                    [0, 0, 0, 1, 0],
                    [0, 0, 1, 1, 0],
                    [0, 1, 1, 1, 0],
                    [0, 0, 0, 0, 0]]
        struct = xp.asarray(struct)
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 0],
                           [0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = np.zeros(data.shape, dtype=bool)
        out = xp.asarray(out)
        ndimage.binary_dilation(data, struct, iterations=2, output=out)
        assert_array_almost_equal(out, expected)

    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_dilation31(self, xp):
        struct = [[0, 1],
                  [1, 1]]
        expected = [[0, 0, 0, 1, 0],
                    [0, 0, 1, 1, 0],
                    [0, 1, 1, 1, 0],
                    [1, 1, 1, 1, 0],
                    [0, 0, 0, 0, 0]]
        struct = xp.asarray(struct)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 0],
                           [0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data, struct, iterations=3)
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='output= arrays are numpy-specific')
    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_dilation32(self, xp):
        struct = [[0, 1],
                  [1, 1]]
        expected = [[0, 0, 0, 1, 0],
                    [0, 0, 1, 1, 0],
                    [0, 1, 1, 1, 0],
                    [1, 1, 1, 1, 0],
                    [0, 0, 0, 0, 0]]
        struct = xp.asarray(struct)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 0],
                           [0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = np.zeros(data.shape, dtype=bool)
        out = xp.asarray(out)
        ndimage.binary_dilation(data, struct, iterations=3, output=out)
        assert_array_almost_equal(out, expected)

    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_dilation33(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = np.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 0, 1, 1, 0, 0],
                               [0, 0, 1, 1, 1, 0, 0, 0],
                               [0, 1, 1, 0, 1, 1, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        expected = xp.asarray(expected)
        mask = np.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 1, 0],
                           [0, 0, 0, 0, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 1, 1, 0, 1, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        mask = xp.asarray(mask)
        data = np.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)

        out = ndimage.binary_dilation(data, struct, iterations=-1,
                                      mask=mask, border_value=0)
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='inplace output= arrays are numpy-specific')
    @xfail_xp_backends("cupy",
                       reason="NotImplementedError: only brute_force iteration")
    def test_binary_dilation34(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 1, 0, 0, 0, 0, 0, 0],
                    [0, 1, 1, 0, 0, 0, 0, 0],
                    [0, 0, 1, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        mask = np.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 1, 1, 0, 0, 0, 0, 0],
                           [0, 0, 1, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        mask = xp.asarray(mask)
        data = np.zeros(mask.shape, dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data, struct, iterations=-1,
                                      mask=mask, border_value=1)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_dilation35(self, dtype, xp):
        dtype = getattr(xp, dtype)
        tmp = [[1, 1, 0, 0, 0, 0, 1, 1],
               [1, 0, 0, 0, 1, 0, 1, 1],
               [0, 0, 1, 1, 1, 1, 1, 1],
               [0, 1, 1, 1, 1, 0, 1, 1],
               [1, 1, 1, 1, 1, 1, 1, 1],
               [0, 1, 0, 0, 1, 0, 1, 1],
               [1, 1, 1, 1, 1, 1, 1, 1],
               [1, 1, 1, 1, 1, 1, 1, 1]]

        data = np.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]])
        mask = [[0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 1, 1, 1, 1, 0, 0],
                [0, 0, 1, 1, 1, 1, 0, 0],
                [0, 0, 1, 1, 1, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0]]
        mask = np.asarray(mask, dtype=bool)

        expected = np.logical_and(tmp, mask)
        tmp = np.logical_and(data, np.logical_not(mask))
        expected = np.logical_or(expected, tmp)

        mask = xp.asarray(mask)
        expected = xp.asarray(expected)

        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_dilation(data, mask=mask,
                                      origin=(1, 1), border_value=1)
        assert_array_almost_equal(out, expected)

    def test_binary_dilation36(self, xp):
        # gh-21009
        data = np.zeros([], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_dilation(data, iterations=-1)
        assert out == xp.asarray(False)

    def test_binary_propagation01(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = np.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 0, 1, 1, 0, 0],
                               [0, 0, 1, 1, 1, 0, 0, 0],
                               [0, 1, 1, 0, 1, 1, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        expected = xp.asarray(expected)
        mask = np.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 1, 0],
                           [0, 0, 0, 0, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 0, 0, 0],
                           [0, 1, 1, 0, 1, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        mask = xp.asarray(mask)
        data = np.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_propagation(data, struct,
                                         mask=mask, border_value=0)
        assert_array_almost_equal(out, expected)

    def test_binary_propagation02(self, xp):
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        expected = [[0, 1, 0, 0, 0, 0, 0, 0],
                    [0, 1, 1, 0, 0, 0, 0, 0],
                    [0, 0, 1, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        struct = xp.asarray(struct)
        mask = np.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                           [0, 1, 1, 0, 0, 0, 0, 0],
                           [0, 0, 1, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        mask = xp.asarray(mask)
        data = np.zeros(mask.shape, dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_propagation(data, struct,
                                         mask=mask, border_value=1)
        assert_array_almost_equal(out, expected)

    def test_binary_propagation03(self, xp):
        # gh-21009
        data = xp.asarray(np.zeros([], dtype=bool))
        expected = xp.asarray(np.zeros([], dtype=bool))
        out = ndimage.binary_propagation(data)
        assert out == expected

    @pytest.mark.parametrize('dtype', types)
    def test_binary_opening01(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[0, 1, 0, 0, 0, 0, 0, 0],
                    [1, 1, 1, 0, 0, 0, 0, 0],
                    [0, 1, 0, 0, 0, 1, 0, 0],
                    [0, 0, 0, 0, 1, 1, 1, 0],
                    [0, 0, 1, 0, 0, 1, 0, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 0, 1, 0, 0, 1, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                           [1, 1, 1, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 0, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_opening(data)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_opening02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = ndimage.generate_binary_structure(2, 2)
        expected = [[1, 1, 1, 0, 0, 0, 0, 0],
                    [1, 1, 1, 0, 0, 0, 0, 0],
                    [1, 1, 1, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 1, 1, 1, 0, 0, 0, 0],
                    [0, 1, 1, 1, 0, 0, 0, 0],
                    [0, 1, 1, 1, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        struct = xp.asarray(struct)
        data = xp.asarray([[1, 1, 1, 0, 0, 0, 0, 0],
                           [1, 1, 1, 0, 0, 0, 0, 0],
                           [1, 1, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0],
                           [0, 1, 1, 1, 0, 1, 1, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_opening(data, struct)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_closing01(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 1, 1, 0, 0, 0, 0, 0],
                    [0, 1, 1, 1, 0, 1, 0, 0],
                    [0, 0, 1, 1, 1, 1, 1, 0],
                    [0, 0, 1, 1, 1, 1, 0, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 0, 1, 0, 0, 1, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 1, 0, 0, 0, 0, 0, 0],
                           [1, 1, 1, 0, 0, 0, 0, 0],
                           [0, 1, 0, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 0, 1, 0, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_closing(data)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_binary_closing02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = ndimage.generate_binary_structure(2, 2)
        expected = [[0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 1, 1, 0, 0, 0, 0, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 1, 1, 1, 1, 1, 1, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        struct = xp.asarray(struct)
        data = xp.asarray([[1, 1, 1, 0, 0, 0, 0, 0],
                           [1, 1, 1, 0, 0, 0, 0, 0],
                           [1, 1, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0],
                           [0, 1, 1, 1, 0, 1, 1, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_closing(data, struct)
        assert_array_almost_equal(out, expected)

    def test_binary_fill_holes01(self, xp):
        expected = np.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 1, 1, 1, 1, 0, 0],
                               [0, 0, 1, 1, 1, 1, 0, 0],
                               [0, 0, 1, 1, 1, 1, 0, 0],
                               [0, 0, 1, 1, 1, 1, 0, 0],
                               [0, 0, 1, 1, 1, 1, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        expected = xp.asarray(expected)

        data = np.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 1, 1, 1, 1, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 1, 1, 1, 1, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)

        out = ndimage.binary_fill_holes(data)
        assert_array_almost_equal(out, expected)

    def test_binary_fill_holes02(self, xp):
        expected = np.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 0, 1, 1, 0, 0, 0],
                               [0, 0, 1, 1, 1, 1, 0, 0],
                               [0, 0, 1, 1, 1, 1, 0, 0],
                               [0, 0, 1, 1, 1, 1, 0, 0],
                               [0, 0, 0, 1, 1, 0, 0, 0],
                               [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 1, 0, 0, 1, 0, 0],
                           [0, 0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_fill_holes(data)
        assert_array_almost_equal(out, expected)

    def test_binary_fill_holes03(self, xp):
        expected = np.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                               [0, 0, 1, 0, 0, 0, 0, 0],
                               [0, 1, 1, 1, 0, 1, 1, 1],
                               [0, 1, 1, 1, 0, 1, 1, 1],
                               [0, 1, 1, 1, 0, 1, 1, 1],
                               [0, 0, 1, 0, 0, 1, 1, 1],
                               [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        expected = xp.asarray(expected)
        data = np.asarray([[0, 0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 1, 0, 0, 0, 0, 0],
                           [0, 1, 0, 1, 0, 1, 1, 1],
                           [0, 1, 0, 1, 0, 1, 0, 1],
                           [0, 1, 0, 1, 0, 1, 0, 1],
                           [0, 0, 1, 0, 0, 1, 1, 1],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=bool)
        data = xp.asarray(data)
        out = ndimage.binary_fill_holes(data)
        assert_array_almost_equal(out, expected)

    @skip_xp_backends(cpu_only=True)
    @skip_xp_backends(
        "cupy", reason="these filters do not yet have axes support in CuPy")
    @skip_xp_backends(
        "jax.numpy", reason="these filters are not implemented in JAX.numpy")
    @pytest.mark.parametrize('border_value',[0, 1])
    @pytest.mark.parametrize('origin', [(0, 0), (-1, 0)])
    @pytest.mark.parametrize('expand_axis', [0, 1, 2])
    @pytest.mark.parametrize('func_name', ["binary_erosion",
                                           "binary_dilation",
                                           "binary_opening",
                                           "binary_closing",
                                           "binary_hit_or_miss",
                                           "binary_propagation",
                                           "binary_fill_holes"])
    def test_binary_axes(self, xp, func_name, expand_axis, origin, border_value):
        struct = np.asarray([[0, 1, 0],
                             [1, 1, 1],
                             [0, 1, 0]], bool)
        struct = xp.asarray(struct)

        data = np.asarray([[0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 1, 1, 0, 1, 0],
                           [0, 1, 0, 1, 1, 0, 1],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 0, 0, 0],
                           [0, 0, 0, 1, 0, 0, 0]], bool)
        data = xp.asarray(data)
        if func_name == "binary_hit_or_miss":
            kwargs = dict(origin1=origin, origin2=origin)
        else:
            kwargs = dict(origin=origin)
        border_supported = func_name not in ["binary_hit_or_miss",
                                             "binary_fill_holes"]
        if border_supported:
            kwargs['border_value'] = border_value
        elif border_value != 0:
            pytest.skip('border_value !=0 unsupported by this function')
        func = getattr(ndimage, func_name)
        expected = func(data, struct, **kwargs)

        # replicate data and expected result along a new axis
        n_reps = 5
        expected = xp.stack([expected] * n_reps, axis=expand_axis)
        data = xp.stack([data] * n_reps, axis=expand_axis)

        # filter all axes except expand_axis
        axes = [0, 1, 2]
        axes.remove(expand_axis)
        if is_numpy(xp) or is_cupy(xp):
            out = xp.asarray(np.zeros(data.shape, bool))
            func(data, struct, output=out, axes=axes, **kwargs)
        else:
            # inplace output= is unsupported by JAX
            out = func(data, struct, axes=axes, **kwargs)
        xp_assert_close(out, expected)

    def test_grey_erosion01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.grey_erosion(array, footprint=footprint)
        assert_array_almost_equal(output,
                                  xp.asarray([[2, 2, 1, 1, 1],
                                              [2, 3, 1, 3, 1],
                                              [5, 5, 3, 3, 1]]))

    @skip_xp_backends("jax.numpy", reason="output=array requires buffer view")
    @skip_xp_backends("dask.array", reason="output=array requires buffer view")
    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/issues/8398")
    def test_grey_erosion01_overlap(self, xp):

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        ndimage.grey_erosion(array, footprint=footprint, output=array)
        assert_array_almost_equal(array,
                                  xp.asarray([[2, 2, 1, 1, 1],
                                              [2, 3, 1, 3, 1],
                                              [5, 5, 3, 3, 1]])
        )

    def test_grey_erosion02(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        output = ndimage.grey_erosion(array, footprint=footprint,
                                      structure=structure)
        assert_array_almost_equal(output,
                                  xp.asarray([[2, 2, 1, 1, 1],
                                              [2, 3, 1, 3, 1],
                                              [5, 5, 3, 3, 1]])
        )

    def test_grey_erosion03(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[1, 1, 1], [1, 1, 1]])
        output = ndimage.grey_erosion(array, footprint=footprint,
                                      structure=structure)
        assert_array_almost_equal(output,
                                  xp.asarray([[1, 1, 0, 0, 0],
                                              [1, 2, 0, 2, 0],
                                              [4, 4, 2, 2, 0]])
        )

    def test_grey_dilation01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[0, 1, 1], [1, 0, 1]])
        output = ndimage.grey_dilation(array, footprint=footprint)
        assert_array_almost_equal(output,
                                  xp.asarray([[7, 7, 9, 9, 5],
                                              [7, 9, 8, 9, 7],
                                              [8, 8, 8, 7, 7]]),
        )

    def test_grey_dilation02(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[0, 1, 1], [1, 0, 1]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        output = ndimage.grey_dilation(array, footprint=footprint,
                                       structure=structure)
        assert_array_almost_equal(output,
                                  xp.asarray([[7, 7, 9, 9, 5],
                                              [7, 9, 8, 9, 7],
                                              [8, 8, 8, 7, 7]]),
        )

    def test_grey_dilation03(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[0, 1, 1], [1, 0, 1]])
        structure = xp.asarray([[1, 1, 1], [1, 1, 1]])
        output = ndimage.grey_dilation(array, footprint=footprint,
                                       structure=structure)
        assert_array_almost_equal(output,
                                  xp.asarray([[8, 8, 10, 10, 6],
                                              [8, 10, 9, 10, 8],
                                              [9, 9, 9, 8, 8]]),
        )

    def test_grey_opening01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        tmp = ndimage.grey_erosion(array, footprint=footprint)
        expected = ndimage.grey_dilation(tmp, footprint=footprint)
        output = ndimage.grey_opening(array, footprint=footprint)
        assert_array_almost_equal(output, expected)

    def test_grey_opening02(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp = ndimage.grey_erosion(array, footprint=footprint,
                                   structure=structure)
        expected = ndimage.grey_dilation(tmp, footprint=footprint,
                                         structure=structure)
        output = ndimage.grey_opening(array, footprint=footprint,
                                      structure=structure)
        assert_array_almost_equal(output, expected)

    def test_grey_closing01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        tmp = ndimage.grey_dilation(array, footprint=footprint)
        expected = ndimage.grey_erosion(tmp, footprint=footprint)
        output = ndimage.grey_closing(array, footprint=footprint)
        assert_array_almost_equal(output, expected)

    def test_grey_closing02(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp = ndimage.grey_dilation(array, footprint=footprint,
                                    structure=structure)
        expected = ndimage.grey_erosion(tmp, footprint=footprint,
                                        structure=structure)
        output = ndimage.grey_closing(array, footprint=footprint,
                                      structure=structure)
        assert_array_almost_equal(output, expected)

    @skip_xp_backends(np_only=True, reason='output= arrays are numpy-specific')
    def test_morphological_gradient01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp1 = ndimage.grey_dilation(array, footprint=footprint,
                                     structure=structure)
        tmp2 = ndimage.grey_erosion(array, footprint=footprint,
                                    structure=structure)
        expected = tmp1 - tmp2
        output = xp.zeros(array.shape, dtype=array.dtype)
        ndimage.morphological_gradient(array, footprint=footprint,
                                       structure=structure, output=output)
        assert_array_almost_equal(output, expected)

    def test_morphological_gradient02(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp1 = ndimage.grey_dilation(array, footprint=footprint,
                                     structure=structure)
        tmp2 = ndimage.grey_erosion(array, footprint=footprint,
                                    structure=structure)
        expected = tmp1 - tmp2
        output = ndimage.morphological_gradient(array, footprint=footprint,
                                                structure=structure)
        assert_array_almost_equal(output, expected)

    @skip_xp_backends(np_only=True, reason='output= arrays are numpy-specific')
    def test_morphological_laplace01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp1 = ndimage.grey_dilation(array, footprint=footprint,
                                     structure=structure)
        tmp2 = ndimage.grey_erosion(array, footprint=footprint,
                                    structure=structure)
        expected = tmp1 + tmp2 - 2 * array
        output = xp.zeros(array.shape, dtype=array.dtype)
        ndimage.morphological_laplace(array, footprint=footprint,
                                      structure=structure, output=output)
        assert_array_almost_equal(output, expected)

    def test_morphological_laplace02(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp1 = ndimage.grey_dilation(array, footprint=footprint,
                                     structure=structure)
        tmp2 = ndimage.grey_erosion(array, footprint=footprint,
                                    structure=structure)
        expected = tmp1 + tmp2 - 2 * array
        output = ndimage.morphological_laplace(array, footprint=footprint,
                                               structure=structure)
        assert_array_almost_equal(output, expected)

    @skip_xp_backends("jax.numpy", reason="output=array requires buffer view")
    @skip_xp_backends("dask.array", reason="output=array requires buffer view")
    def test_white_tophat01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp = ndimage.grey_opening(array, footprint=footprint,
                                   structure=structure)
        expected = array - tmp
        output = xp.zeros(array.shape, dtype=array.dtype)
        ndimage.white_tophat(array, footprint=footprint,
                             structure=structure, output=output)
        assert_array_almost_equal(output, expected)

    def test_white_tophat02(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp = ndimage.grey_opening(array, footprint=footprint,
                                   structure=structure)
        expected = array - tmp
        output = ndimage.white_tophat(array, footprint=footprint,
                                      structure=structure)
        assert_array_almost_equal(output, expected)

    @xfail_xp_backends('cupy', reason="cupy#8399")
    def test_white_tophat03(self, xp):

        array = np.asarray([[1, 0, 0, 0, 0, 0, 0],
                            [0, 1, 1, 1, 1, 1, 0],
                            [0, 1, 1, 1, 1, 1, 0],
                            [0, 1, 1, 1, 1, 1, 0],
                            [0, 1, 1, 1, 0, 1, 0],
                            [0, 1, 1, 1, 1, 1, 0],
                            [0, 0, 0, 0, 0, 0, 1]], dtype=bool)
        array = xp.asarray(array)
        structure = np.ones((3, 3), dtype=bool)
        structure = xp.asarray(structure)
        expected = np.asarray([[0, 1, 1, 0, 0, 0, 0],
                               [1, 0, 0, 1, 1, 1, 0],
                               [1, 0, 0, 1, 1, 1, 0],
                               [0, 1, 1, 0, 0, 0, 1],
                               [0, 1, 1, 0, 1, 0, 1],
                               [0, 1, 1, 0, 0, 0, 1],
                               [0, 0, 0, 1, 1, 1, 1]], dtype=bool)
        expected = xp.asarray(expected)

        output = ndimage.white_tophat(array, structure=structure)
        xp_assert_equal(output, expected)

    @skip_xp_backends("jax.numpy", reason="output=array requires buffer view")
    @skip_xp_backends("dask.array", reason="output=array requires buffer view")
    def test_white_tophat04(self, xp):
        array = np.eye(5, dtype=bool)
        structure = np.ones((3, 3), dtype=bool)

        array = xp.asarray(array)
        structure = xp.asarray(structure)

        # Check that type mismatch is properly handled
        output = xp.empty_like(array, dtype=xp.float64)
        ndimage.white_tophat(array, structure=structure, output=output)

    @skip_xp_backends("jax.numpy", reason="output=array requires buffer view")
    @skip_xp_backends("dask.array", reason="output=array requires buffer view")
    def test_black_tophat01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp = ndimage.grey_closing(array, footprint=footprint,
                                   structure=structure)
        expected = tmp - array
        output = xp.zeros(array.shape, dtype=array.dtype)
        ndimage.black_tophat(array, footprint=footprint,
                             structure=structure, output=output)
        assert_array_almost_equal(output, expected)

    def test_black_tophat02(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        structure = xp.asarray([[0, 0, 0], [0, 0, 0]])
        tmp = ndimage.grey_closing(array, footprint=footprint,
                                   structure=structure)
        expected = tmp - array
        output = ndimage.black_tophat(array, footprint=footprint,
                                      structure=structure)
        assert_array_almost_equal(output, expected)

    @xfail_xp_backends('cupy', reason="cupy/cupy#8399")
    def test_black_tophat03(self, xp):

        array = np.asarray([[1, 0, 0, 0, 0, 0, 0],
                            [0, 1, 1, 1, 1, 1, 0],
                            [0, 1, 1, 1, 1, 1, 0],
                            [0, 1, 1, 1, 1, 1, 0],
                            [0, 1, 1, 1, 0, 1, 0],
                            [0, 1, 1, 1, 1, 1, 0],
                            [0, 0, 0, 0, 0, 0, 1]], dtype=bool)
        array = xp.asarray(array)
        structure = np.ones((3, 3), dtype=bool)
        structure = xp.asarray(structure)
        expected = np.asarray([[0, 1, 1, 1, 1, 1, 1],
                               [1, 0, 0, 0, 0, 0, 1],
                               [1, 0, 0, 0, 0, 0, 1],
                               [1, 0, 0, 0, 0, 0, 1],
                               [1, 0, 0, 0, 1, 0, 1],
                               [1, 0, 0, 0, 0, 0, 1],
                               [1, 1, 1, 1, 1, 1, 0]], dtype=bool)
        expected = xp.asarray(expected)

        output = ndimage.black_tophat(array, structure=structure)
        xp_assert_equal(output, expected)

    @skip_xp_backends("jax.numpy", reason="output=array requires buffer view")
    @skip_xp_backends("dask.array", reason="output=array requires buffer view")
    def test_black_tophat04(self, xp):
        array = xp.asarray(np.eye(5, dtype=bool))
        structure = xp.asarray(np.ones((3, 3), dtype=bool))

        # Check that type mismatch is properly handled
        output = xp.empty_like(array, dtype=xp.float64)
        ndimage.black_tophat(array, structure=structure, output=output)

    @skip_xp_backends(cpu_only=True)
    @skip_xp_backends(
        "cupy", reason="these filters do not yet have axes support in CuPy")
    @skip_xp_backends(
        "jax.numpy", reason="these filters are not implemented in JAX.numpy")
    @pytest.mark.parametrize('origin', [(0, 0), (-1, 0)])
    @pytest.mark.parametrize('expand_axis', [0, 1, 2])
    @pytest.mark.parametrize('mode', ['reflect', 'constant', 'nearest',
                                      'mirror', 'wrap'])
    @pytest.mark.parametrize('footprint_mode', ['size', 'footprint',
                                                'structure'])
    @pytest.mark.parametrize('func_name', ["grey_erosion",
                                           "grey_dilation",
                                           "grey_opening",
                                           "grey_closing",
                                           "morphological_laplace",
                                           "morphological_gradient",
                                           "white_tophat",
                                           "black_tophat"])
    def test_grey_axes(self, xp, func_name, expand_axis, origin, footprint_mode,
                       mode):

        data = xp.asarray([[0, 0, 0, 1, 0, 0, 0],
                           [0, 0, 0, 4, 0, 0, 0],
                           [0, 0, 2, 1, 0, 2, 0],
                           [0, 3, 0, 6, 5, 0, 1],
                           [0, 4, 5, 3, 3, 4, 0],
                           [0, 0, 9, 3, 0, 0, 0],
                           [0, 0, 0, 2, 0, 0, 0]])
        kwargs = dict(origin=origin, mode=mode)
        if footprint_mode == 'size':
            kwargs['size'] = (2, 3)
        else:
            kwargs['footprint'] = xp.asarray([[1, 0, 1], [1, 1, 0]])
        if footprint_mode == 'structure':
            kwargs['structure'] = xp.ones_like(kwargs['footprint'])
        func = getattr(ndimage, func_name)
        expected = func(data, **kwargs)

        # replicate data and expected result along a new axis
        n_reps = 5
        expected = xp.stack([expected] * n_reps, axis=expand_axis)
        data = xp.stack([data] * n_reps, axis=expand_axis)

        # filter all axes except expand_axis
        axes = [0, 1, 2]
        axes.remove(expand_axis)

        if is_numpy(xp) or is_cupy(xp):
            out = xp.zeros(expected.shape, dtype=expected.dtype)
            func(data, output=out, axes=axes, **kwargs)
        else:
            # inplace output= is unsupported by JAX
            out = func(data, axes=axes, **kwargs)
        xp_assert_close(out, expected)

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason="inplace output= is numpy-specific")
    @pytest.mark.parametrize('dtype', types)
    def test_hit_or_miss01(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        struct = xp.asarray(struct)
        expected = [[0, 0, 0, 0, 0],
                    [0, 1, 0, 0, 0],
                    [0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0]]
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 1, 0, 0, 0],
                           [1, 1, 1, 0, 0],
                           [0, 1, 0, 1, 1],
                           [0, 0, 1, 1, 1],
                           [0, 1, 1, 1, 0],
                           [0, 1, 1, 1, 1],
                           [0, 1, 1, 1, 1],
                           [0, 0, 0, 0, 0]], dtype=dtype)
        out = xp.asarray(np.zeros(data.shape, dtype=bool))
        ndimage.binary_hit_or_miss(data, struct, output=out)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_hit_or_miss02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct = [[0, 1, 0],
                  [1, 1, 1],
                  [0, 1, 0]]
        expected = [[0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 1, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        struct = xp.asarray(struct)
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 1, 0, 0, 1, 1, 1, 0],
                           [1, 1, 1, 0, 0, 1, 0, 0],
                           [0, 1, 0, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_hit_or_miss(data, struct)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('dtype', types)
    def test_hit_or_miss03(self, dtype, xp):
        dtype = getattr(xp, dtype)
        struct1 = [[0, 0, 0],
                   [1, 1, 1],
                   [0, 0, 0]]
        struct2 = [[1, 1, 1],
                   [0, 0, 0],
                   [1, 1, 1]]
        expected = [[0, 0, 0, 0, 0, 1, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0],
                    [0, 0, 1, 0, 0, 0, 0, 0],
                    [0, 0, 0, 0, 0, 0, 0, 0]]
        struct1 = xp.asarray(struct1)
        struct2 = xp.asarray(struct2)
        expected = xp.asarray(expected)
        data = xp.asarray([[0, 1, 0, 0, 1, 1, 1, 0],
                           [1, 1, 1, 0, 0, 0, 0, 0],
                           [0, 1, 0, 1, 1, 1, 1, 0],
                           [0, 0, 1, 1, 1, 1, 1, 0],
                           [0, 1, 1, 1, 0, 1, 1, 0],
                           [0, 0, 0, 0, 1, 1, 1, 0],
                           [0, 1, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0, 0]], dtype=dtype)
        out = ndimage.binary_hit_or_miss(data, struct1, struct2)
        assert_array_almost_equal(out, expected)


class TestDilateFix:

    # pytest's setup_method seems to clash with the autouse `xp` fixture
    # so call _setup manually from all methods
    def _setup(self, xp):
        # dilation related setup
        self.array = xp.asarray([[0, 0, 0, 0, 0],
                                 [0, 0, 0, 0, 0],
                                 [0, 0, 0, 1, 0],
                                 [0, 0, 1, 1, 0],
                                 [0, 0, 0, 0, 0]], dtype=xp.uint8)

        self.sq3x3 = xp.ones((3, 3))
        dilated3x3 = ndimage.binary_dilation(self.array, structure=self.sq3x3)

        if is_numpy(xp):
            self.dilated3x3 = dilated3x3.view(xp.uint8)
        else:
            self.dilated3x3 = xp.astype(dilated3x3, xp.uint8)

    def test_dilation_square_structure(self, xp):
        self._setup(xp)
        result = ndimage.grey_dilation(self.array, structure=self.sq3x3)
        # +1 accounts for difference between grey and binary dilation
        assert_array_almost_equal(result, self.dilated3x3 + 1)

    def test_dilation_scalar_size(self, xp):
        self._setup(xp)
        result = ndimage.grey_dilation(self.array, size=3)
        assert_array_almost_equal(result, self.dilated3x3)


class TestBinaryOpeningClosing:

    def _setup(self, xp):
        a = np.zeros((5, 5), dtype=bool)
        a[1:4, 1:4] = True
        a[4, 4] = True
        self.array = xp.asarray(a)
        self.sq3x3 = xp.ones((3, 3))
        self.opened_old = ndimage.binary_opening(self.array, self.sq3x3,
                                                 1, None, 0)
        self.closed_old = ndimage.binary_closing(self.array, self.sq3x3,
                                                 1, None, 0)

    def test_opening_new_arguments(self, xp):
        self._setup(xp)
        opened_new = ndimage.binary_opening(self.array, self.sq3x3, 1, None,
                                            0, None, 0, False)
        xp_assert_equal(opened_new, self.opened_old)

    def test_closing_new_arguments(self, xp):
        self._setup(xp)
        closed_new = ndimage.binary_closing(self.array, self.sq3x3, 1, None,
                                            0, None, 0, False)
        xp_assert_equal(closed_new, self.closed_old)


def test_binary_erosion_noninteger_iterations(xp):
    # regression test for gh-9905, gh-9909: ValueError for
    # non integer iterations
    data = xp.ones([1])
    assert_raises(TypeError, ndimage.binary_erosion, data, iterations=0.5)
    assert_raises(TypeError, ndimage.binary_erosion, data, iterations=1.5)


def test_binary_dilation_noninteger_iterations(xp):
    # regression test for gh-9905, gh-9909: ValueError for
    # non integer iterations
    data = xp.ones([1])
    assert_raises(TypeError, ndimage.binary_dilation, data, iterations=0.5)
    assert_raises(TypeError, ndimage.binary_dilation, data, iterations=1.5)


def test_binary_opening_noninteger_iterations(xp):
    # regression test for gh-9905, gh-9909: ValueError for
    # non integer iterations
    data = xp.ones([1])
    assert_raises(TypeError, ndimage.binary_opening, data, iterations=0.5)
    assert_raises(TypeError, ndimage.binary_opening, data, iterations=1.5)


def test_binary_closing_noninteger_iterations(xp):
    # regression test for gh-9905, gh-9909: ValueError for
    # non integer iterations
    data = xp.ones([1])
    assert_raises(TypeError, ndimage.binary_closing, data, iterations=0.5)
    assert_raises(TypeError, ndimage.binary_closing, data, iterations=1.5)


@xfail_xp_backends(
    "cupy", reason="CuPy: NotImplementedError: only brute_force iteration"
)
def test_binary_closing_noninteger_brute_force_passes_when_true(xp):
    # regression test for gh-9905, gh-9909: ValueError for non integer iterations
    data = xp.ones([1])
    xp_assert_equal(ndimage.binary_erosion(data, iterations=2, brute_force=1.5),
                    ndimage.binary_erosion(data, iterations=2, brute_force=bool(1.5))
    )
    xp_assert_equal(ndimage.binary_erosion(data, iterations=2, brute_force=0.0),
                    ndimage.binary_erosion(data, iterations=2, brute_force=bool(0.0))
    )


@skip_xp_backends(np_only=True, exceptions=["cupy"],
                  reason="inplace output= is numpy-specific")
@xfail_xp_backends("cupy", reason="NotImplementedError: only brute_force iteration")
@pytest.mark.parametrize(
    'function',
    ['binary_erosion', 'binary_dilation', 'binary_opening', 'binary_closing'],
)
@pytest.mark.parametrize('iterations', [1, 5])
@pytest.mark.parametrize('brute_force', [False, True])
def test_binary_input_as_output(function, iterations, brute_force, xp):
    rstate = np.random.RandomState(123)
    data = rstate.randint(low=0, high=2, size=100).astype(bool)
    data = xp.asarray(data)
    ndi_func = getattr(ndimage, function)

    # input data is not modified
    data_orig = data.copy()
    expected = ndi_func(data, brute_force=brute_force, iterations=iterations)
    xp_assert_equal(data, data_orig)

    # data should now contain the expected result
    ndi_func(data, brute_force=brute_force, iterations=iterations, output=data)
    xp_assert_equal(data, expected)


@skip_xp_backends(np_only=True, exceptions=["cupy"],
                  reason="inplace output= is numpy-specific")
def test_binary_hit_or_miss_input_as_output(xp):
    rstate = np.random.RandomState(123)
    data = rstate.randint(low=0, high=2, size=100).astype(bool)
    data = xp.asarray(data)

    # input data is not modified
    data_orig = data.copy()
    expected = ndimage.binary_hit_or_miss(data)
    xp_assert_equal(data, data_orig)

    # data should now contain the expected result
    ndimage.binary_hit_or_miss(data, output=data)
    xp_assert_equal(data, expected)


@xfail_xp_backends("cupy",
                   reason="CuPy does not have distance_transform_cdt")
def test_distance_transform_cdt_invalid_metric(xp):
    msg = 'invalid metric provided'
    with pytest.raises(ValueError, match=msg):
        ndimage.distance_transform_cdt(xp.ones((5, 5)),
                                       metric="garbage")
