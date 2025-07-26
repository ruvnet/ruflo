import sys

import numpy as np
from numpy.testing import suppress_warnings
from scipy._lib._array_api import (
    _asarray, assert_array_almost_equal,
    is_jax, np_compat,
    xp_assert_equal, xp_assert_close,
)

import pytest
from pytest import raises as assert_raises
import scipy.ndimage as ndimage

from . import types

skip_xp_backends = pytest.mark.skip_xp_backends
xfail_xp_backends = pytest.mark.xfail_xp_backends
pytestmark = [skip_xp_backends(cpu_only=True, exceptions=['cupy', 'jax.numpy'])]


eps = 1e-12

ndimage_to_numpy_mode = {
    'mirror': 'reflect',
    'reflect': 'symmetric',
    'grid-mirror': 'symmetric',
    'grid-wrap': 'wrap',
    'nearest': 'edge',
    'grid-constant': 'constant',
}


class TestBoundaries:

    @skip_xp_backends("cupy", reason="CuPy does not have geometric_transform")
    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [1.5, 2.5, 3.5, 4, 4, 4, 4]),
         ('wrap', [1.5, 2.5, 3.5, 1.5, 2.5, 3.5, 1.5]),
         ('grid-wrap', [1.5, 2.5, 3.5, 2.5, 1.5, 2.5, 3.5]),
         ('mirror', [1.5, 2.5, 3.5, 3.5, 2.5, 1.5, 1.5]),
         ('reflect', [1.5, 2.5, 3.5, 4, 3.5, 2.5, 1.5]),
         ('constant', [1.5, 2.5, 3.5, -1, -1, -1, -1]),
         ('grid-constant', [1.5, 2.5, 3.5, 1.5, -1, -1, -1])]
    )
    def test_boundaries(self, mode, expected_value, xp):
        def shift(x):
            return (x[0] + 0.5,)

        data = xp.asarray([1, 2, 3, 4.])
        xp_assert_equal(
            ndimage.geometric_transform(data, shift, cval=-1, mode=mode,
                                        output_shape=(7,), order=1),
            xp.asarray(expected_value))

    @skip_xp_backends("cupy", reason="CuPy does not have geometric_transform")
    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [1, 1, 2, 3]),
         ('wrap', [3, 1, 2, 3]),
         ('grid-wrap', [4, 1, 2, 3]),
         ('mirror', [2, 1, 2, 3]),
         ('reflect', [1, 1, 2, 3]),
         ('constant', [-1, 1, 2, 3]),
         ('grid-constant', [-1, 1, 2, 3])]
    )
    def test_boundaries2(self, mode, expected_value, xp):
        def shift(x):
            return (x[0] - 0.9,)

        data = xp.asarray([1, 2, 3, 4])
        xp_assert_equal(
            ndimage.geometric_transform(data, shift, cval=-1, mode=mode,
                                        output_shape=(4,)),
            xp.asarray(expected_value))

    @pytest.mark.parametrize('mode', ['mirror', 'reflect', 'grid-mirror',
                                      'grid-wrap', 'grid-constant',
                                      'nearest'])
    @pytest.mark.parametrize('order', range(6))
    def test_boundary_spline_accuracy(self, mode, order, xp):
        """Tests based on examples from gh-2640"""
        if (is_jax(xp) and
            (mode not in ['mirror', 'reflect', 'constant', 'wrap', 'nearest']
             or order > 1)
        ):
            pytest.xfail("Jax does not support grid- modes or order > 1")

        np_data = np.arange(-6, 7, dtype=np.float64)
        data = xp.asarray(np_data)
        x = xp.asarray(np.linspace(-8, 15, num=1000))
        y = ndimage.map_coordinates(data, x[xp.newaxis, ...], order=order, mode=mode)

        # compute expected value using explicit padding via np.pad
        npad = 32
        pad_mode = ndimage_to_numpy_mode.get(mode)
        padded = xp.asarray(np.pad(np_data, npad, mode=pad_mode))
        coords = xp.asarray(npad + x)[xp.newaxis, ...]
        expected = ndimage.map_coordinates(padded, coords, order=order, mode=mode)

        atol = 1e-5 if mode == 'grid-constant' else 1e-12
        xp_assert_close(y, expected, rtol=1e-7, atol=atol)


@pytest.mark.parametrize('order', range(2, 6))
@pytest.mark.parametrize('dtype', types)
class TestSpline:

    def test_spline01(self, dtype, order, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([], dtype=dtype)
        out = ndimage.spline_filter(data, order=order)
        assert out == xp.asarray(1, dtype=out.dtype)

    def test_spline02(self, dtype, order, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([1], dtype=dtype)
        out = ndimage.spline_filter(data, order=order)
        assert_array_almost_equal(out, xp.asarray([1]))

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason='output=dtype is numpy-specific')
    def test_spline03(self, dtype, order, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([], dtype=dtype)
        out = ndimage.spline_filter(data, order, output=dtype)
        assert out == xp.asarray(1, dtype=out.dtype)

    def test_spline04(self, dtype, order, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([4], dtype=dtype)
        out = ndimage.spline_filter(data, order)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 1]))

    def test_spline05(self, dtype, order, xp):
        dtype = getattr(xp, dtype)
        data = xp.ones([4, 4], dtype=dtype)
        out = ndimage.spline_filter(data, order=order)
        expected = xp.asarray([[1, 1, 1, 1],
                               [1, 1, 1, 1],
                               [1, 1, 1, 1],
                               [1, 1, 1, 1]])
        assert_array_almost_equal(out, expected)


@skip_xp_backends("cupy", reason="CuPy does not have geometric_transform")
@pytest.mark.parametrize('order', range(0, 6))
class TestGeometricTransform:

    def test_geometric_transform01(self, order, xp):
        data = xp.asarray([1])

        def mapping(x):
            return x

        out = ndimage.geometric_transform(data, mapping, data.shape,
                                          order=order)
        assert_array_almost_equal(out, xp.asarray([1], dtype=out.dtype))

    def test_geometric_transform02(self, order, xp):
        data = xp.ones([4])

        def mapping(x):
            return x

        out = ndimage.geometric_transform(data, mapping, data.shape,
                                          order=order)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 1], dtype=out.dtype))

    def test_geometric_transform03(self, order, xp):
        data = xp.ones([4])

        def mapping(x):
            return (x[0] - 1,)

        out = ndimage.geometric_transform(data, mapping, data.shape,
                                          order=order)
        assert_array_almost_equal(out, xp.asarray([0, 1, 1, 1], dtype=out.dtype))

    def test_geometric_transform04(self, order, xp):
        data = xp.asarray([4, 1, 3, 2])

        def mapping(x):
            return (x[0] - 1,)

        out = ndimage.geometric_transform(data, mapping, data.shape,
                                          order=order)
        assert_array_almost_equal(out, xp.asarray([0, 4, 1, 3], dtype=out.dtype))

    @pytest.mark.parametrize('dtype', ["float64", "complex128"])
    def test_geometric_transform05(self, order, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([[1, 1, 1, 1],
                           [1, 1, 1, 1],
                           [1, 1, 1, 1]], dtype=dtype)
        expected = xp.asarray([[0, 1, 1, 1],
                               [0, 1, 1, 1],
                               [0, 1, 1, 1]], dtype=dtype)

        if xp.isdtype(data.dtype, 'complex floating'):
            data -= 1j * data
            expected -= 1j * expected

        def mapping(x):
            return (x[0], x[1] - 1)

        out = ndimage.geometric_transform(data, mapping, data.shape,
                                          order=order)
        assert_array_almost_equal(out, expected)

    def test_geometric_transform06(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])

        def mapping(x):
            return (x[0], x[1] - 1)

        out = ndimage.geometric_transform(data, mapping, data.shape,
                                          order=order)
        expected = xp.asarray([[0, 4, 1, 3],
                               [0, 7, 6, 8],
                               [0, 3, 5, 3]], dtype=out.dtype)
        assert_array_almost_equal(out, expected)

    def test_geometric_transform07(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])

        def mapping(x):
            return (x[0] - 1, x[1])

        out = ndimage.geometric_transform(data, mapping, data.shape,
                                          order=order)
        expected = xp.asarray([[0, 0, 0, 0],
                               [4, 1, 3, 2],
                               [7, 6, 8, 5]], dtype=out.dtype)
        assert_array_almost_equal(out, expected)

    def test_geometric_transform08(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])

        def mapping(x):
            return (x[0] - 1, x[1] - 1)

        out = ndimage.geometric_transform(data, mapping, data.shape,
                                          order=order)
        expected = xp.asarray([[0, 0, 0, 0],
                               [0, 4, 1, 3],
                               [0, 7, 6, 8]], dtype=out.dtype)
        assert_array_almost_equal(out, expected)

    def test_geometric_transform10(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])

        def mapping(x):
            return (x[0] - 1, x[1] - 1)

        if (order > 1):
            filtered = ndimage.spline_filter(data, order=order)
        else:
            filtered = data
        out = ndimage.geometric_transform(filtered, mapping, data.shape,
                                          order=order, prefilter=False)
        expected = xp.asarray([[0, 0, 0, 0],
                               [0, 4, 1, 3],
                               [0, 7, 6, 8]], dtype=out.dtype)
        assert_array_almost_equal(out, expected)

    def test_geometric_transform13(self, order, xp):
        data = xp.ones([2], dtype=xp.float64)

        def mapping(x):
            return (x[0] // 2,)

        out = ndimage.geometric_transform(data, mapping, [4], order=order)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 1], dtype=out.dtype))

    def test_geometric_transform14(self, order, xp):
        data = xp.asarray([1, 5, 2, 6, 3, 7, 4, 4])

        def mapping(x):
            return (2 * x[0],)

        out = ndimage.geometric_transform(data, mapping, [4], order=order)
        assert_array_almost_equal(out, xp.asarray([1, 2, 3, 4], dtype=out.dtype))

    def test_geometric_transform15(self, order, xp):
        data = xp.asarray([1, 2, 3, 4])

        def mapping(x):
            return (x[0] / 2,)

        out = ndimage.geometric_transform(data, mapping, [8], order=order)
        assert_array_almost_equal(out[::2], xp.asarray([1, 2, 3, 4]))

    def test_geometric_transform16(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9.0, 10, 11, 12]]
        data = xp.asarray(data)

        def mapping(x):
            return (x[0], x[1] * 2)

        out = ndimage.geometric_transform(data, mapping, (3, 2),
                                          order=order)
        assert_array_almost_equal(out, xp.asarray([[1, 3], [5, 7], [9, 11]]))

    def test_geometric_transform17(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)

        def mapping(x):
            return (x[0] * 2, x[1])

        out = ndimage.geometric_transform(data, mapping, (1, 4),
                                          order=order)
        assert_array_almost_equal(out, xp.asarray([[1, 2, 3, 4]]))

    def test_geometric_transform18(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)

        def mapping(x):
            return (x[0] * 2, x[1] * 2)

        out = ndimage.geometric_transform(data, mapping, (1, 2),
                                          order=order)
        assert_array_almost_equal(out, xp.asarray([[1, 3]]))

    def test_geometric_transform19(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)

        def mapping(x):
            return (x[0], x[1] / 2)

        out = ndimage.geometric_transform(data, mapping, (3, 8),
                                          order=order)
        assert_array_almost_equal(out[..., ::2], data)

    def test_geometric_transform20(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)

        def mapping(x):
            return (x[0] / 2, x[1])

        out = ndimage.geometric_transform(data, mapping, (6, 4),
                                          order=order)
        assert_array_almost_equal(out[::2, ...], data)

    def test_geometric_transform21(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)

        def mapping(x):
            return (x[0] / 2, x[1] / 2)

        out = ndimage.geometric_transform(data, mapping, (6, 8),
                                          order=order)
        assert_array_almost_equal(out[::2, ::2], data)

    def test_geometric_transform22(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data, dtype=xp.float64)

        def mapping1(x):
            return (x[0] / 2, x[1] / 2)

        def mapping2(x):
            return (x[0] * 2, x[1] * 2)

        out = ndimage.geometric_transform(data, mapping1,
                                          (6, 8), order=order)
        out = ndimage.geometric_transform(out, mapping2,
                                          (3, 4), order=order)
        assert_array_almost_equal(out, data)

    def test_geometric_transform23(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)

        def mapping(x):
            return (1, x[0] * 2)

        out = ndimage.geometric_transform(data, mapping, (2,), order=order)
        assert_array_almost_equal(out, xp.asarray([5, 7]))

    def test_geometric_transform24(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)

        def mapping(x, a, b):
            return (a, x[0] * b)

        out = ndimage.geometric_transform(
            data, mapping, (2,), order=order, extra_arguments=(1,),
            extra_keywords={'b': 2})
        assert_array_almost_equal(out, xp.asarray([5, 7]))


@skip_xp_backends("cupy", reason="CuPy does not have geometric_transform")
class TestGeometricTransformExtra:

    def test_geometric_transform_grid_constant_order1(self, xp):

        # verify interpolation outside the original bounds
        x = xp.asarray([[1, 2, 3],
                        [4, 5, 6]], dtype=xp.float64)

        def mapping(x):
            return (x[0] - 0.5), (x[1] - 0.5)

        expected_result = xp.asarray([[0.25, 0.75, 1.25],
                                      [1.25, 3.00, 4.00]])
        assert_array_almost_equal(
            ndimage.geometric_transform(x, mapping, mode='grid-constant',
                                        order=1),
            expected_result,
        )

    @pytest.mark.parametrize('mode', ['grid-constant', 'grid-wrap', 'nearest',
                                      'mirror', 'reflect'])
    @pytest.mark.parametrize('order', range(6))
    def test_geometric_transform_vs_padded(self, order, mode, xp):

        def mapping(x):
            return (x[0] - 0.4), (x[1] + 2.3)

        # Manually pad and then extract center after the transform to get the
        # expected result.
        x = np.arange(144, dtype=float).reshape(12, 12)
        npad = 24
        pad_mode = ndimage_to_numpy_mode.get(mode)
        x_padded = np.pad(x, npad, mode=pad_mode)

        x = xp.asarray(x)
        x_padded = xp.asarray(x_padded)

        center_slice = tuple([slice(npad, -npad)] * x.ndim)
        expected_result = ndimage.geometric_transform(
            x_padded, mapping, mode=mode, order=order)[center_slice]

        xp_assert_close(
            ndimage.geometric_transform(x, mapping, mode=mode,
                                        order=order),
            expected_result,
            rtol=1e-7,
        )

    @skip_xp_backends(np_only=True, reason='endianness is numpy-specific')
    def test_geometric_transform_endianness_with_output_parameter(self, xp):
        # geometric transform given output ndarray or dtype with
        # non-native endianness. see issue #4127
        data = np.asarray([1])

        def mapping(x):
            return x

        for out in [data.dtype, data.dtype.newbyteorder(),
                    np.empty_like(data),
                    np.empty_like(data).astype(data.dtype.newbyteorder())]:
            returned = ndimage.geometric_transform(data, mapping, data.shape,
                                                   output=out)
            result = out if returned is None else returned
            assert_array_almost_equal(result, [1])

    @skip_xp_backends(np_only=True, reason='string `output` is numpy-specific')
    def test_geometric_transform_with_string_output(self, xp):
        data = xp.asarray([1])

        def mapping(x):
            return x

        out = ndimage.geometric_transform(data, mapping, output='f')
        assert out.dtype is np.dtype('f')
        assert_array_almost_equal(out, [1])


class TestMapCoordinates:

    @pytest.mark.parametrize('order', range(0, 6))
    @pytest.mark.parametrize('dtype', [np.float64, np.complex128])
    def test_map_coordinates01(self, order, dtype, xp):
        if is_jax(xp) and order > 1:
            pytest.xfail("jax map_coordinates requires order <= 1")

        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        expected = xp.asarray([[0, 0, 0, 0],
                               [0, 4, 1, 3],
                               [0, 7, 6, 8]])
        if xp.isdtype(data.dtype, 'complex floating'):
            data = data - 1j * data
            expected = expected - 1j * expected

        idx = np.indices(data.shape)
        idx -= 1
        idx = xp.asarray(idx)

        out = ndimage.map_coordinates(data, idx, order=order)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_map_coordinates02(self, order, xp):
        if is_jax(xp):
            if order > 1:
               pytest.xfail("jax map_coordinates requires order <= 1")
            if order == 1:
               pytest.xfail("output differs. jax bug?")

        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        idx = np.indices(data.shape, np.float64)
        idx -= 0.5
        idx = xp.asarray(idx)

        out1 = ndimage.shift(data, 0.5, order=order)
        out2 = ndimage.map_coordinates(data, idx, order=order)
        assert_array_almost_equal(out1, out2)

    @skip_xp_backends("jax.numpy", reason="`order` is required in jax")
    def test_map_coordinates03(self, xp):
        data = _asarray([[4, 1, 3, 2],
                         [7, 6, 8, 5],
                         [3, 5, 3, 6]], order='F', xp=xp)
        idx = np.indices(data.shape) - 1
        idx = xp.asarray(idx)
        out = ndimage.map_coordinates(data, idx)
        expected = xp.asarray([[0, 0, 0, 0],
                               [0, 4, 1, 3],
                               [0, 7, 6, 8]])
        assert_array_almost_equal(out, expected)
        assert_array_almost_equal(out, ndimage.shift(data, (1, 1)))

        idx = np.indices(data[::2, ...].shape) - 1
        idx = xp.asarray(idx)
        out = ndimage.map_coordinates(data[::2, ...], idx)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0],
                                                   [0, 4, 1, 3]]))
        assert_array_almost_equal(out, ndimage.shift(data[::2, ...], (1, 1)))

        idx = np.indices(data[:, ::2].shape) - 1
        idx = xp.asarray(idx)
        out = ndimage.map_coordinates(data[:, ::2], idx)
        assert_array_almost_equal(out, xp.asarray([[0, 0], [0, 4], [0, 7]]))
        assert_array_almost_equal(out, ndimage.shift(data[:, ::2], (1, 1)))

    @skip_xp_backends(np_only=True)
    def test_map_coordinates_endianness_with_output_parameter(self, xp):
        # output parameter given as array or dtype with either endianness
        # see issue #4127
        # NB: NumPy-only

        data = np.asarray([[1, 2], [7, 6]])
        expected = np.asarray([[0, 0], [0, 1]])
        idx = np.indices(data.shape)
        idx -= 1
        for out in [
            data.dtype,
            data.dtype.newbyteorder(),
            np.empty_like(expected),
            np.empty_like(expected).astype(expected.dtype.newbyteorder())
        ]:
            returned = ndimage.map_coordinates(data, idx, output=out)
            result = out if returned is None else returned
            assert_array_almost_equal(result, expected)

    @skip_xp_backends(np_only=True, reason='string `output` is numpy-specific')
    def test_map_coordinates_with_string_output(self, xp):
        data = xp.asarray([[1]])
        idx = np.indices(data.shape)
        idx = xp.asarray(idx)
        out = ndimage.map_coordinates(data, idx, output='f')
        assert out.dtype is np.dtype('f')
        assert_array_almost_equal(out, xp.asarray([[1]]))

    @pytest.mark.skip_xp_backends(cpu_only=True)
    @pytest.mark.skipif('win32' in sys.platform or np.intp(0).itemsize < 8,
                        reason='do not run on 32 bit or windows '
                               '(no sparse memory)')
    def test_map_coordinates_large_data(self, xp):
        # check crash on large data
        try:
            n = 30000
            # a = xp.reshape(xp.empty(n**2, dtype=xp.float32), (n, n))
            a = np.empty(n**2, dtype=np.float32).reshape(n, n)
            # fill the part we might read
            a[n - 3:, n - 3:] = 0
            ndimage.map_coordinates(
                xp.asarray(a), xp.asarray([[n - 1.5], [n - 1.5]]), order=1
            )
        except MemoryError as e:
            raise pytest.skip('Not enough memory available') from e


class TestAffineTransform:

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform01(self, order, xp):
        data = xp.asarray([1])
        out = ndimage.affine_transform(data, xp.asarray([[1]]), order=order)
        assert_array_almost_equal(out, xp.asarray([1]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform02(self, order, xp):
        data = xp.ones([4])
        out = ndimage.affine_transform(data, xp.asarray([[1]]), order=order)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 1]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform03(self, order, xp):
        data = xp.ones([4])
        out = ndimage.affine_transform(data, xp.asarray([[1]]), -1, order=order)
        assert_array_almost_equal(out, xp.asarray([0, 1, 1, 1]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform04(self, order, xp):
        data = xp.asarray([4, 1, 3, 2])
        out = ndimage.affine_transform(data, xp.asarray([[1]]), -1, order=order)
        assert_array_almost_equal(out, xp.asarray([0, 4, 1, 3]))

    @pytest.mark.parametrize('order', range(0, 6))
    @pytest.mark.parametrize('dtype', ["float64", "complex128"])
    def test_affine_transform05(self, order, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([[1, 1, 1, 1],
                           [1, 1, 1, 1],
                           [1, 1, 1, 1]], dtype=dtype)
        expected = xp.asarray([[0, 1, 1, 1],
                               [0, 1, 1, 1],
                               [0, 1, 1, 1]], dtype=dtype)
        if xp.isdtype(data.dtype, 'complex floating'):
            data -= 1j * data
            expected -= 1j * expected
        out = ndimage.affine_transform(data, xp.asarray([[1, 0], [0, 1]]),
                                       [0, -1], order=order)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform06(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        out = ndimage.affine_transform(data, xp.asarray([[1, 0], [0, 1]]),
                                       [0, -1], order=order)
        assert_array_almost_equal(out, xp.asarray([[0, 4, 1, 3],
                                                   [0, 7, 6, 8],
                                                   [0, 3, 5, 3]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform07(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        out = ndimage.affine_transform(data, xp.asarray([[1, 0], [0, 1]]),
                                       [-1, 0], order=order)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0],
                                                   [4, 1, 3, 2],
                                                   [7, 6, 8, 5]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform08(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        out = ndimage.affine_transform(data, xp.asarray([[1, 0], [0, 1]]),
                                       [-1, -1], order=order)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0],
                                                   [0, 4, 1, 3],
                                                   [0, 7, 6, 8]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform09(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        if (order > 1):
            filtered = ndimage.spline_filter(data, order=order)
        else:
            filtered = data
        out = ndimage.affine_transform(filtered, xp.asarray([[1, 0], [0, 1]]),
                                       [-1, -1], order=order,
                                       prefilter=False)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0],
                                                   [0, 4, 1, 3],
                                                   [0, 7, 6, 8]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform10(self, order, xp):
        data = xp.ones([2], dtype=xp.float64)
        out = ndimage.affine_transform(data, xp.asarray([[0.5]]), output_shape=(4,),
                                       order=order)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 0]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform11(self, order, xp):
        data = xp.asarray([1, 5, 2, 6, 3, 7, 4, 4])
        out = ndimage.affine_transform(data, xp.asarray([[2]]), 0, (4,), order=order)
        assert_array_almost_equal(out, xp.asarray([1, 2, 3, 4]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform12(self, order, xp):
        data = xp.asarray([1, 2, 3, 4])
        out = ndimage.affine_transform(data, xp.asarray([[0.5]]), 0, (8,), order=order)
        assert_array_almost_equal(out[::2], xp.asarray([1, 2, 3, 4]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform13(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9.0, 10, 11, 12]]
        data = xp.asarray(data)
        out = ndimage.affine_transform(data, xp.asarray([[1, 0], [0, 2]]), 0, (3, 2),
                                       order=order)
        assert_array_almost_equal(out, xp.asarray([[1, 3], [5, 7], [9, 11]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform14(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)
        out = ndimage.affine_transform(data, xp.asarray([[2, 0], [0, 1]]), 0, (1, 4),
                                       order=order)
        assert_array_almost_equal(out, xp.asarray([[1, 2, 3, 4]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform15(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)
        out = ndimage.affine_transform(data, xp.asarray([[2, 0], [0, 2]]), 0, (1, 2),
                                       order=order)
        assert_array_almost_equal(out, xp.asarray([[1, 3]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform16(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)
        out = ndimage.affine_transform(data, xp.asarray([[1, 0.0], [0, 0.5]]), 0,
                                       (3, 8), order=order)
        assert_array_almost_equal(out[..., ::2], data)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform17(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)
        out = ndimage.affine_transform(data, xp.asarray([[0.5, 0], [0, 1]]), 0,
                                       (6, 4), order=order)
        assert_array_almost_equal(out[::2, ...], data)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform18(self, order, xp):
        data = xp.asarray([[1, 2, 3, 4],
                           [5, 6, 7, 8],
                           [9, 10, 11, 12]])
        out = ndimage.affine_transform(data, xp.asarray([[0.5, 0], [0, 0.5]]), 0,
                                       (6, 8), order=order)
        assert_array_almost_equal(out[::2, ::2], data)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform19(self, order, xp):
        data = xp.asarray([[1, 2, 3, 4],
                           [5, 6, 7, 8],
                           [9, 10, 11, 12]], dtype=xp.float64)
        out = ndimage.affine_transform(data, xp.asarray([[0.5, 0], [0, 0.5]]), 0,
                                       (6, 8), order=order)
        out = ndimage.affine_transform(out, xp.asarray([[2.0, 0], [0, 2.0]]), 0,
                                       (3, 4), order=order)
        assert_array_almost_equal(out, data)

    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/issues/8394")
    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform20(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)
        out = ndimage.affine_transform(data, xp.asarray([[0], [2]]), 0, (2,),
                                       order=order)
        assert_array_almost_equal(out, xp.asarray([1, 3]))

    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/issues/8394")
    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform21(self, order, xp):
        data = [[1, 2, 3, 4],
                [5, 6, 7, 8],
                [9, 10, 11, 12]]
        data = xp.asarray(data)
        out = ndimage.affine_transform(data, xp.asarray([[2], [0]]), 0, (2,),
                                       order=order)
        assert_array_almost_equal(out, xp.asarray([1, 9]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform22(self, order, xp):
        # shift and offset interaction; see issue #1547
        data = xp.asarray([4, 1, 3, 2])
        out = ndimage.affine_transform(data, xp.asarray([[2]]), [-1], (3,),
                                       order=order)
        assert_array_almost_equal(out, xp.asarray([0, 1, 2]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform23(self, order, xp):
        # shift and offset interaction; see issue #1547
        data = xp.asarray([4, 1, 3, 2])
        out = ndimage.affine_transform(data, xp.asarray([[0.5]]), [-1], (8,),
                                       order=order)
        assert_array_almost_equal(out[::2], xp.asarray([0, 4, 1, 3]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform24(self, order, xp):
        # consistency between diagonal and non-diagonal case; see issue #1547
        data = xp.asarray([4, 1, 3, 2])
        with suppress_warnings() as sup:
            sup.filter(UserWarning,
                       'The behavior of affine_transform with a 1-D array .* '
                       'has changed')
            out1 = ndimage.affine_transform(data, xp.asarray([2]), -1, order=order)
        out2 = ndimage.affine_transform(data, xp.asarray([[2]]), -1, order=order)
        assert_array_almost_equal(out1, out2)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform25(self, order, xp):
        # consistency between diagonal and non-diagonal case; see issue #1547
        data = xp.asarray([4, 1, 3, 2])
        with suppress_warnings() as sup:
            sup.filter(UserWarning,
                       'The behavior of affine_transform with a 1-D array .* '
                       'has changed')
            out1 = ndimage.affine_transform(data, xp.asarray([0.5]), -1, order=order)
        out2 = ndimage.affine_transform(data, xp.asarray([[0.5]]), -1, order=order)
        assert_array_almost_equal(out1, out2)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform26(self, order, xp):
        # test homogeneous coordinates
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        if (order > 1):
            filtered = ndimage.spline_filter(data, order=order)
        else:
            filtered = data
        tform_original = xp.eye(2)
        offset_original = -xp.ones((2, 1))

        tform_h1 = xp.concat((tform_original, offset_original), axis=1)  # hstack
        tform_h2 = xp.concat((tform_h1, xp.asarray([[0.0, 0, 1]])), axis=0)  # vstack

        offs = [float(x) for x in xp.reshape(offset_original, (-1,))]

        out1 = ndimage.affine_transform(filtered, tform_original,
                                        offs,
                                        order=order, prefilter=False)
        out2 = ndimage.affine_transform(filtered, tform_h1, order=order,
                                        prefilter=False)
        out3 = ndimage.affine_transform(filtered, tform_h2, order=order,
                                        prefilter=False)
        for out in [out1, out2, out3]:
            assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0],
                                                       [0, 4, 1, 3],
                                                       [0, 7, 6, 8]]))

    @xfail_xp_backends("cupy", reason="does not raise")
    def test_affine_transform27(self, xp):
        # test valid homogeneous transformation matrix
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        tform_h1 = xp.concat((xp.eye(2), -xp.ones((2, 1))) , axis=1)  # vstack
        tform_h2 = xp.concat((tform_h1, xp.asarray([[5.0, 2, 1]])), axis=0)  # hstack

        assert_raises(ValueError, ndimage.affine_transform, data, tform_h2)

    @skip_xp_backends(np_only=True, reason='byteorder is numpy-specific')
    def test_affine_transform_1d_endianness_with_output_parameter(self, xp):
        # 1d affine transform given output ndarray or dtype with
        # either endianness. see issue #7388
        data = xp.ones((2, 2))
        for out in [xp.empty_like(data),
                    xp.empty_like(data).astype(data.dtype.newbyteorder()),
                    data.dtype, data.dtype.newbyteorder()]:
            with suppress_warnings() as sup:
                sup.filter(UserWarning,
                           'The behavior of affine_transform with a 1-D array '
                           '.* has changed')
                matrix = xp.asarray([1, 1])
                returned = ndimage.affine_transform(data, matrix, output=out)
            result = out if returned is None else returned
            assert_array_almost_equal(result, xp.asarray([[1, 1], [1, 1]]))

    @skip_xp_backends(np_only=True, reason='byteorder is numpy-specific')
    def test_affine_transform_multi_d_endianness_with_output_parameter(self, xp):
        # affine transform given output ndarray or dtype with either endianness
        # see issue #4127
        # NB: byteorder is numpy-specific
        data = np.asarray([1])
        for out in [data.dtype, data.dtype.newbyteorder(),
                    np.empty_like(data),
                    np.empty_like(data).astype(data.dtype.newbyteorder())]:
            returned = ndimage.affine_transform(data, np.asarray([[1]]), output=out)
            result = out if returned is None else returned
            assert_array_almost_equal(result, np.asarray([1]))

    @skip_xp_backends(np_only=True,
        reason='`out` of a different size is numpy-specific'
    )
    def test_affine_transform_output_shape(self, xp):
        # don't require output_shape when out of a different size is given
        data = xp.arange(8, dtype=xp.float64)
        out = xp.ones((16,))

        ndimage.affine_transform(data, xp.asarray([[1]]), output=out)
        assert_array_almost_equal(out[:8], data)

        # mismatched output shape raises an error
        with pytest.raises(RuntimeError):
            ndimage.affine_transform(
                data, [[1]], output=out, output_shape=(12,))

    @skip_xp_backends(np_only=True, reason='string `output` is numpy-specific')
    def test_affine_transform_with_string_output(self, xp):
        data = xp.asarray([1])
        out = ndimage.affine_transform(data, xp.asarray([[1]]), output='f')
        assert out.dtype is np.dtype('f')
        assert_array_almost_equal(out, xp.asarray([1]))

    @pytest.mark.parametrize('shift',
                             [(1, 0), (0, 1), (-1, 1), (3, -5), (2, 7)])
    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform_shift_via_grid_wrap(self, shift, order, xp):
        # For mode 'grid-wrap', integer shifts should match np.roll
        x = np.asarray([[0, 1],
                        [2, 3]])
        affine = np.zeros((2, 3))
        affine[:2, :2] = np.eye(2)
        affine[:, 2] = np.asarray(shift)

        expected = np.roll(x, shift, axis=(0, 1))

        x = xp.asarray(x)
        affine = xp.asarray(affine)
        expected = xp.asarray(expected)

        assert_array_almost_equal(
            ndimage.affine_transform(x, affine, mode='grid-wrap', order=order),
            expected
        )

    @pytest.mark.parametrize('order', range(0, 6))
    def test_affine_transform_shift_reflect(self, order, xp):
        # shift by x.shape results in reflection
        x = np.asarray([[0, 1, 2],
                        [3, 4, 5]])
        expected = x[::-1, ::-1].copy()   # strides >0 for torch
        x = xp.asarray(x)
        expected = xp.asarray(expected)

        affine = np.zeros([2, 3])
        affine[:2, :2] = np.eye(2)
        affine[:, 2] = np.asarray(x.shape)
        affine = xp.asarray(affine)

        assert_array_almost_equal(
            ndimage.affine_transform(x, affine, mode='reflect', order=order),
            expected,
        )


class TestShift:

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift01(self, order, xp):
        data = xp.asarray([1])
        out = ndimage.shift(data, [1], order=order)
        assert_array_almost_equal(out, xp.asarray([0]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift02(self, order, xp):
        data = xp.ones([4])
        out = ndimage.shift(data, [1], order=order)
        assert_array_almost_equal(out, xp.asarray([0, 1, 1, 1]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift03(self, order, xp):
        data = xp.ones([4])
        out = ndimage.shift(data, -1, order=order)
        assert_array_almost_equal(out, xp.asarray([1, 1, 1, 0]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift04(self, order, xp):
        data = xp.asarray([4, 1, 3, 2])
        out = ndimage.shift(data, 1, order=order)
        assert_array_almost_equal(out, xp.asarray([0, 4, 1, 3]))

    @pytest.mark.parametrize('order', range(0, 6))
    @pytest.mark.parametrize('dtype', ["float64", "complex128"])
    def test_shift05(self, order, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([[1, 1, 1, 1],
                           [1, 1, 1, 1],
                           [1, 1, 1, 1]], dtype=dtype)
        expected = xp.asarray([[0, 1, 1, 1],
                               [0, 1, 1, 1],
                               [0, 1, 1, 1]], dtype=dtype)
        if xp.isdtype(data.dtype, 'complex floating'):
            data -= 1j * data
            expected -= 1j * expected
        out = ndimage.shift(data, [0, 1], order=order)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('order', range(0, 6))
    @pytest.mark.parametrize('mode', ['constant', 'grid-constant'])
    @pytest.mark.parametrize('dtype', ['float64', 'complex128'])
    def test_shift_with_nonzero_cval(self, order, mode, dtype, xp):
        data = np.asarray([[1, 1, 1, 1],
                           [1, 1, 1, 1],
                           [1, 1, 1, 1]], dtype=dtype)

        expected = np.asarray([[0, 1, 1, 1],
                               [0, 1, 1, 1],
                               [0, 1, 1, 1]], dtype=dtype)

        if np_compat.isdtype(data.dtype, 'complex floating'):
            data -= 1j * data
            expected -= 1j * expected
        cval = 5.0
        expected[:, 0] = cval  # specific to shift of [0, 1] used below

        data = xp.asarray(data)
        expected = xp.asarray(expected)
        out = ndimage.shift(data, [0, 1], order=order, mode=mode, cval=cval)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift06(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        out = ndimage.shift(data, [0, 1], order=order)
        assert_array_almost_equal(out, xp.asarray([[0, 4, 1, 3],
                                                   [0, 7, 6, 8],
                                                   [0, 3, 5, 3]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift07(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        out = ndimage.shift(data, [1, 0], order=order)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0],
                                                   [4, 1, 3, 2],
                                                   [7, 6, 8, 5]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift08(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        out = ndimage.shift(data, [1, 1], order=order)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0],
                                                   [0, 4, 1, 3],
                                                   [0, 7, 6, 8]]))

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift09(self, order, xp):
        data = xp.asarray([[4, 1, 3, 2],
                           [7, 6, 8, 5],
                           [3, 5, 3, 6]])
        if (order > 1):
            filtered = ndimage.spline_filter(data, order=order)
        else:
            filtered = data
        out = ndimage.shift(filtered, [1, 1], order=order, prefilter=False)
        assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0],
                                                   [0, 4, 1, 3],
                                                   [0, 7, 6, 8]]))

    @pytest.mark.parametrize('shift',
                             [(1, 0), (0, 1), (-1, 1), (3, -5), (2, 7)])
    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift_grid_wrap(self, shift, order, xp):
        # For mode 'grid-wrap', integer shifts should match np.roll
        x = np.asarray([[0, 1],
                        [2, 3]])
        expected = np.roll(x, shift, axis=(0,1))

        x = xp.asarray(x)
        expected = xp.asarray(expected)

        assert_array_almost_equal(
            ndimage.shift(x, shift, mode='grid-wrap', order=order),
            expected
        )

    @pytest.mark.parametrize('shift',
                             [(1, 0), (0, 1), (-1, 1), (3, -5), (2, 7)])
    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift_grid_constant1(self, shift, order, xp):
        # For integer shifts, 'constant' and 'grid-constant' should be equal
        x = xp.reshape(xp.arange(20), (5, 4))
        assert_array_almost_equal(
            ndimage.shift(x, shift, mode='grid-constant', order=order),
            ndimage.shift(x, shift, mode='constant', order=order),
        )

    def test_shift_grid_constant_order1(self, xp):
        x = xp.asarray([[1, 2, 3],
                        [4, 5, 6]], dtype=xp.float64)
        expected_result = xp.asarray([[0.25, 0.75, 1.25],
                                      [1.25, 3.00, 4.00]])
        assert_array_almost_equal(
            ndimage.shift(x, (0.5, 0.5), mode='grid-constant', order=1),
            expected_result,
        )

    @pytest.mark.parametrize('order', range(0, 6))
    def test_shift_reflect(self, order, xp):
        # shift by x.shape results in reflection
        x = np.asarray([[0, 1, 2],
                        [3, 4, 5]])
        expected = x[::-1, ::-1].copy()   # strides > 0 for torch

        x = xp.asarray(x)
        expected = xp.asarray(expected)
        assert_array_almost_equal(
            ndimage.shift(x, x.shape, mode='reflect', order=order),
            expected,
        )

    @pytest.mark.parametrize('order', range(0, 6))
    @pytest.mark.parametrize('prefilter', [False, True])
    def test_shift_nearest_boundary(self, order, prefilter, xp):
        # verify that shifting at least order // 2 beyond the end of the array
        # gives a value equal to the edge value.
        x = xp.arange(16)
        kwargs = dict(mode='nearest', order=order, prefilter=prefilter)
        assert_array_almost_equal(
            ndimage.shift(x, order // 2 + 1, **kwargs)[0], x[0],
        )
        assert_array_almost_equal(
            ndimage.shift(x, -order // 2 - 1, **kwargs)[-1], x[-1],
        )

    @pytest.mark.parametrize('mode', ['grid-constant', 'grid-wrap', 'nearest',
                                      'mirror', 'reflect'])
    @pytest.mark.parametrize('order', range(6))
    def test_shift_vs_padded(self, order, mode, xp):
        x_np = np.arange(144, dtype=float).reshape(12, 12)
        shift = (0.4, -2.3)

        # manually pad and then extract center to get expected result
        npad = 32
        pad_mode = ndimage_to_numpy_mode.get(mode)
        x_padded = xp.asarray(np.pad(x_np, npad, mode=pad_mode))
        x = xp.asarray(x_np)

        center_slice = tuple([slice(npad, -npad)] * x.ndim)
        expected_result = ndimage.shift(
            x_padded, shift, mode=mode, order=order)[center_slice]

        xp_assert_close(
            ndimage.shift(x, shift, mode=mode, order=order),
            expected_result,
            rtol=1e-7,
        )


class TestZoom:

    @pytest.mark.parametrize('order', range(0, 6))
    def test_zoom1(self, order, xp):
        for z in [2, [2, 2]]:
            arr = xp.reshape(xp.arange(25, dtype=xp.float64), (5, 5))
            arr = ndimage.zoom(arr, z, order=order)
            assert arr.shape == (10, 10)
            assert xp.all(arr[-1, :] != 0)
            assert xp.all(arr[-1, :] >= (20 - eps))
            assert xp.all(arr[0, :] <= (5 + eps))
            assert xp.all(arr >= (0 - eps))
            assert xp.all(arr <= (24 + eps))

    def test_zoom2(self, xp):
        arr = xp.reshape(xp.arange(12), (3, 4))
        out = ndimage.zoom(ndimage.zoom(arr, 2), 0.5)
        xp_assert_equal(out, arr)

    def test_zoom3(self, xp):
        arr = xp.asarray([[1, 2]])
        out1 = ndimage.zoom(arr, (2, 1))
        out2 = ndimage.zoom(arr, (1, 2))

        assert_array_almost_equal(out1, xp.asarray([[1, 2], [1, 2]]))
        assert_array_almost_equal(out2, xp.asarray([[1, 1, 2, 2]]))

    @pytest.mark.parametrize('order', range(0, 6))
    @pytest.mark.parametrize('dtype', ["float64", "complex128"])
    def test_zoom_affine01(self, order, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([[1, 2, 3, 4],
                           [5, 6, 7, 8],
                           [9, 10, 11, 12]], dtype=dtype)
        if xp.isdtype(data.dtype, 'complex floating'):
            data -= 1j * data
        with suppress_warnings() as sup:
            sup.filter(UserWarning,
                       'The behavior of affine_transform with a 1-D array .* '
                       'has changed')
            out = ndimage.affine_transform(data, xp.asarray([0.5, 0.5]), 0,
                                           (6, 8), order=order)
        assert_array_almost_equal(out[::2, ::2], data)

    def test_zoom_infinity(self, xp):
        # Ticket #1419 regression test
        dim = 8
        ndimage.zoom(xp.zeros((dim, dim)), 1. / dim, mode='nearest')

    def test_zoom_zoomfactor_one(self, xp):
        # Ticket #1122 regression test
        arr = xp.zeros((1, 5, 5))
        zoom = (1.0, 2.0, 2.0)

        out = ndimage.zoom(arr, zoom, cval=7)
        ref = xp.zeros((1, 10, 10))
        assert_array_almost_equal(out, ref)

    def test_zoom_output_shape_roundoff(self, xp):
        arr = xp.zeros((3, 11, 25))
        zoom = (4.0 / 3, 15.0 / 11, 29.0 / 25)
        out = ndimage.zoom(arr, zoom)
        assert out.shape == (4, 15, 29)

    @pytest.mark.parametrize('zoom', [(1, 1), (3, 5), (8, 2), (8, 8)])
    @pytest.mark.parametrize('mode', ['nearest', 'constant', 'wrap', 'reflect',
                                      'mirror', 'grid-wrap', 'grid-mirror',
                                      'grid-constant'])
    def test_zoom_by_int_order0(self, zoom, mode, xp):
        # order 0 zoom should be the same as replication via np.kron
        # Note: This is not True for general x shapes when grid_mode is False,
        #       but works here for all modes because the size ratio happens to
        #       always be an integer when x.shape = (2, 2).
        x_np = np.asarray([[0, 1],
                           [2, 3]], dtype=np.float64)
        expected = np.kron(x_np, np.ones(zoom))

        x = xp.asarray(x_np)
        expected = xp.asarray(expected)

        assert_array_almost_equal(
            ndimage.zoom(x, zoom, order=0, mode=mode),
            expected
        )

    @pytest.mark.parametrize('shape', [(2, 3), (4, 4)])
    @pytest.mark.parametrize('zoom', [(1, 1), (3, 5), (8, 2), (8, 8)])
    @pytest.mark.parametrize('mode', ['nearest', 'reflect', 'mirror',
                                      'grid-wrap', 'grid-constant'])
    def test_zoom_grid_by_int_order0(self, shape, zoom, mode, xp):
        # When grid_mode is True,  order 0 zoom should be the same as
        # replication via np.kron. The only exceptions to this are the
        # non-grid modes 'constant' and 'wrap'.
        x_np = np.arange(np.prod(shape), dtype=float).reshape(shape)

        x = xp.asarray(x_np)
        assert_array_almost_equal(
            ndimage.zoom(x, zoom, order=0, mode=mode, grid_mode=True),
            xp.asarray(np.kron(x_np, np.ones(zoom)))
        )

    @pytest.mark.parametrize('mode', ['constant', 'wrap'])
    @pytest.mark.thread_unsafe
    def test_zoom_grid_mode_warnings(self, mode, xp):
        # Warn on use of non-grid modes when grid_mode is True
        x = xp.reshape(xp.arange(9, dtype=xp.float64), (3, 3))
        with pytest.warns(UserWarning,
                          match="It is recommended to use mode"):
            ndimage.zoom(x, 2, mode=mode, grid_mode=True),

    @skip_xp_backends("dask.array", reason="output=array requires buffer view")
    @skip_xp_backends("jax.numpy", reason="output=array requires buffer view")
    def test_zoom_output_shape(self, xp):
        """Ticket #643"""
        x = xp.reshape(xp.arange(12), (3, 4))
        ndimage.zoom(x, 2, output=xp.zeros((6, 8)))

    def test_zoom_0d_array(self, xp):
        # Ticket #21670 regression test
        a = xp.arange(10.)
        factor = 2
        actual = ndimage.zoom(a, np.array(factor))
        expected = ndimage.zoom(a, factor)
        xp_assert_close(actual, expected)

    @xfail_xp_backends("cupy", reason="CuPy `zoom` needs similar fix.")
    def test_zoom_1_gh20999(self, xp):
        # gh-20999 reported that zoom with `zoom=1` (or sequence of ones)
        # introduced noise. Check that this is resolved.
        x = xp.eye(3)
        xp_assert_equal(ndimage.zoom(x, 1), x)
        xp_assert_equal(ndimage.zoom(x, (1, 1)), x)

    @xfail_xp_backends("cupy", reason="CuPy `zoom` needs similar fix.")
    @skip_xp_backends("jax.numpy", reason="read-only backend")
    @xfail_xp_backends("dask.array", reason="numpy round-trip")
    def test_zoom_1_gh20999_output(self, xp):
        x = xp.eye(3)
        output = xp.zeros_like(x)
        ndimage.zoom(x, 1, output=output)
        xp_assert_equal(output, x)


class TestRotate:

    @pytest.mark.parametrize('order', range(0, 6))
    def test_rotate01(self, order, xp):
        data = xp.asarray([[0, 0, 0, 0],
                           [0, 1, 1, 0],
                           [0, 0, 0, 0]], dtype=xp.float64)
        out = ndimage.rotate(data, 0, order=order)
        assert_array_almost_equal(out, data)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_rotate02(self, order, xp):
        data = xp.asarray([[0, 0, 0, 0],
                           [0, 1, 0, 0],
                           [0, 0, 0, 0]], dtype=xp.float64)
        expected = xp.asarray([[0, 0, 0],
                               [0, 0, 0],
                               [0, 1, 0],
                               [0, 0, 0]], dtype=xp.float64)
        out = ndimage.rotate(data, 90, order=order)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('order', range(0, 6))
    @pytest.mark.parametrize('dtype', ["float64", "complex128"])
    def test_rotate03(self, order, dtype, xp):
        dtype = getattr(xp, dtype)
        data = xp.asarray([[0, 0, 0, 0, 0],
                           [0, 1, 1, 0, 0],
                           [0, 0, 0, 0, 0]], dtype=dtype)
        expected = xp.asarray([[0, 0, 0],
                               [0, 0, 0],
                               [0, 1, 0],
                               [0, 1, 0],
                               [0, 0, 0]], dtype=dtype)
        if xp.isdtype(data.dtype, 'complex floating'):
            data -= 1j * data
            expected -= 1j * expected
        out = ndimage.rotate(data, 90, order=order)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_rotate04(self, order, xp):
        data = xp.asarray([[0, 0, 0, 0, 0],
                           [0, 1, 1, 0, 0],
                           [0, 0, 0, 0, 0]], dtype=xp.float64)
        expected = xp.asarray([[0, 0, 0, 0, 0],
                               [0, 0, 1, 0, 0],
                               [0, 0, 1, 0, 0]], dtype=xp.float64)
        out = ndimage.rotate(data, 90, reshape=False, order=order)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_rotate05(self, order, xp):
        data = np.empty((4, 3, 3))
        for i in range(3):
            data[:, :, i] = np.asarray([[0, 0, 0],
                                        [0, 1, 0],
                                        [0, 1, 0],
                                        [0, 0, 0]], dtype=np.float64)
        data = xp.asarray(data)
        expected = xp.asarray([[0, 0, 0, 0],
                               [0, 1, 1, 0],
                               [0, 0, 0, 0]], dtype=xp.float64)
        out = ndimage.rotate(data, 90, order=order)
        for i in range(3):
            assert_array_almost_equal(out[:, :, i], expected)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_rotate06(self, order, xp):
        data = np.empty((3, 4, 3))
        for i in range(3):
            data[:, :, i] = np.asarray([[0, 0, 0, 0],
                                        [0, 1, 1, 0],
                                        [0, 0, 0, 0]], dtype=np.float64)
        data = xp.asarray(data)
        expected = xp.asarray([[0, 0, 0],
                               [0, 1, 0],
                               [0, 1, 0],
                               [0, 0, 0]], dtype=xp.float64)
        out = ndimage.rotate(data, 90, order=order)
        for i in range(3):
            assert_array_almost_equal(out[:, :, i], expected)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_rotate07(self, order, xp):
        data = xp.asarray([[[0, 0, 0, 0, 0],
                            [0, 1, 1, 0, 0],
                            [0, 0, 0, 0, 0]]] * 2, dtype=xp.float64)
        data = xp.permute_dims(data, (2, 1, 0))
        expected = xp.asarray([[[0, 0, 0],
                                [0, 1, 0],
                                [0, 1, 0],
                                [0, 0, 0],
                                [0, 0, 0]]] * 2, dtype=xp.float64)
        expected = xp.permute_dims(expected, (2, 1, 0))
        out = ndimage.rotate(data, 90, axes=(0, 1), order=order)
        assert_array_almost_equal(out, expected)

    @pytest.mark.parametrize('order', range(0, 6))
    def test_rotate08(self, order, xp):
        data = xp.asarray([[[0, 0, 0, 0, 0],
                            [0, 1, 1, 0, 0],
                            [0, 0, 0, 0, 0]]] * 2, dtype=xp.float64)
        data = xp.permute_dims(data, (2, 1, 0))  # == np.transpose
        expected = xp.asarray([[[0, 0, 1, 0, 0],
                                [0, 0, 1, 0, 0],
                                [0, 0, 0, 0, 0]]] * 2, dtype=xp.float64)
        expected = xp.permute_dims(expected, (2, 1, 0))
        out = ndimage.rotate(data, 90, axes=(0, 1), reshape=False, order=order)
        assert_array_almost_equal(out, expected)

    def test_rotate09(self, xp):
        data = xp.asarray([[0, 0, 0, 0, 0],
                           [0, 1, 1, 0, 0],
                           [0, 0, 0, 0, 0]] * 2, dtype=xp.float64)
        with assert_raises(ValueError):
            ndimage.rotate(data, 90, axes=(0, data.ndim))

    def test_rotate10(self, xp):
        data = xp.reshape(xp.arange(45, dtype=xp.float64), (3, 5, 3))

	# The output of ndimage.rotate before refactoring
        expected = xp.asarray([[[0.0, 0.0, 0.0],
                                [0.0, 0.0, 0.0],
                                [6.54914793, 7.54914793, 8.54914793],
                                [10.84520162, 11.84520162, 12.84520162],
                                [0.0, 0.0, 0.0]],
                               [[6.19286575, 7.19286575, 8.19286575],
                                [13.4730712, 14.4730712, 15.4730712],
                                [21.0, 22.0, 23.0],
                                [28.5269288, 29.5269288, 30.5269288],
                                [35.80713425, 36.80713425, 37.80713425]],
                               [[0.0, 0.0, 0.0],
                                [31.15479838, 32.15479838, 33.15479838],
                                [35.45085207, 36.45085207, 37.45085207],
                                [0.0, 0.0, 0.0],
                                [0.0, 0.0, 0.0]]], dtype=xp.float64)

        out = ndimage.rotate(data, angle=12, reshape=False)
        #assert_array_almost_equal(out, expected)
        xp_assert_close(out, expected, rtol=1e-6, atol=2e-6)


    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/issues/8400")
    def test_rotate_exact_180(self, xp):
        a = xp.asarray(np.tile(np.arange(5), (5, 1)))
        b = ndimage.rotate(ndimage.rotate(a, 180), -180)
        xp_assert_equal(a, b)
