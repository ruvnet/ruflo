import os
import os.path

import numpy as np
from numpy.testing import suppress_warnings

from scipy._lib._array_api import (
    is_torch,
    xp_assert_equal,
    xp_assert_close,
    assert_array_almost_equal,
    assert_almost_equal,
)

import pytest
from pytest import raises as assert_raises

import scipy.ndimage as ndimage

from . import types

skip_xp_backends = pytest.mark.skip_xp_backends
pytestmark = [skip_xp_backends(cpu_only=True, exceptions=['cupy', 'jax.numpy'])]

IS_WINDOWS_AND_NP1 = os.name == 'nt' and np.__version__ < '2'


@skip_xp_backends(np_only=True, reason='test internal numpy-only helpers')
class Test_measurements_stats:
    """ndimage._measurements._stats() is a utility used by other functions.

        Since internal ndimage/_measurements.py code is NumPy-only,
        so is this this test class.
    """
    def test_a(self, xp):
        x = [0, 1, 2, 6]
        labels = [0, 0, 1, 1]
        index = [0, 1]
        for shp in [(4,), (2, 2)]:
            x = np.array(x).reshape(shp)
            labels = np.array(labels).reshape(shp)
            counts, sums = ndimage._measurements._stats(
                x, labels=labels, index=index)

            dtype_arg = {'dtype': np.int64} if IS_WINDOWS_AND_NP1 else {}
            xp_assert_equal(counts, np.asarray([2, 2], **dtype_arg))
            xp_assert_equal(sums, np.asarray([1.0, 8.0]))

    def test_b(self, xp):
        # Same data as test_a, but different labels.  The label 9 exceeds the
        # length of 'labels', so this test will follow a different code path.
        x = [0, 1, 2, 6]
        labels = [0, 0, 9, 9]
        index = [0, 9]
        for shp in [(4,), (2, 2)]:
            x = np.array(x).reshape(shp)
            labels = np.array(labels).reshape(shp)
            counts, sums = ndimage._measurements._stats(
                x, labels=labels, index=index)

            dtype_arg = {'dtype': np.int64} if IS_WINDOWS_AND_NP1 else {}
            xp_assert_equal(counts, np.asarray([2, 2], **dtype_arg))
            xp_assert_equal(sums, np.asarray([1.0, 8.0]))

    def test_a_centered(self, xp):
        x = [0, 1, 2, 6]
        labels = [0, 0, 1, 1]
        index = [0, 1]
        for shp in [(4,), (2, 2)]:
            x = np.array(x).reshape(shp)
            labels = np.array(labels).reshape(shp)
            counts, sums, centers = ndimage._measurements._stats(
                x, labels=labels, index=index, centered=True)

            dtype_arg = {'dtype': np.int64} if IS_WINDOWS_AND_NP1 else {}
            xp_assert_equal(counts, np.asarray([2, 2], **dtype_arg))
            xp_assert_equal(sums, np.asarray([1.0, 8.0]))
            xp_assert_equal(centers, np.asarray([0.5, 8.0]))

    def test_b_centered(self, xp):
        x = [0, 1, 2, 6]
        labels = [0, 0, 9, 9]
        index = [0, 9]
        for shp in [(4,), (2, 2)]:
            x = np.array(x).reshape(shp)
            labels = np.array(labels).reshape(shp)
            counts, sums, centers = ndimage._measurements._stats(
                x, labels=labels, index=index, centered=True)

            dtype_arg = {'dtype': np.int64} if IS_WINDOWS_AND_NP1 else {}
            xp_assert_equal(counts, np.asarray([2, 2], **dtype_arg))
            xp_assert_equal(sums, np.asarray([1.0, 8.0]))
            xp_assert_equal(centers, np.asarray([0.5, 8.0]))

    def test_nonint_labels(self, xp):
        x = [0, 1, 2, 6]
        labels = [0.0, 0.0, 9.0, 9.0]
        index = [0.0, 9.0]
        for shp in [(4,), (2, 2)]:
            x = np.array(x).reshape(shp)
            labels = np.array(labels).reshape(shp)
            counts, sums, centers = ndimage._measurements._stats(
                x, labels=labels, index=index, centered=True)

            dtype_arg = {'dtype': np.int64} if IS_WINDOWS_AND_NP1 else {}
            xp_assert_equal(counts, np.asarray([2, 2], **dtype_arg))
            xp_assert_equal(sums, np.asarray([1.0, 8.0]))
            xp_assert_equal(centers, np.asarray([0.5, 8.0]))


@skip_xp_backends(np_only=True, reason='test internal numpy-only helpers')
class Test_measurements_select:
    """ndimage._measurements._select() is a utility used by other functions."""

    def test_basic(self, xp):
        x = [0, 1, 6, 2]
        cases = [
            ([0, 0, 1, 1], [0, 1]),           # "Small" integer labels
            ([0, 0, 9, 9], [0, 9]),           # A label larger than len(labels)
            ([0.0, 0.0, 7.0, 7.0], [0.0, 7.0]),   # Non-integer labels
        ]
        for labels, index in cases:
            result = ndimage._measurements._select(
                x, labels=labels, index=index)
            assert len(result) == 0
            result = ndimage._measurements._select(
                x, labels=labels, index=index, find_max=True)
            assert len(result) == 1
            xp_assert_equal(result[0], [1, 6])
            result = ndimage._measurements._select(
                x, labels=labels, index=index, find_min=True)
            assert len(result) == 1
            xp_assert_equal(result[0], [0, 2])
            result = ndimage._measurements._select(
                x, labels=labels, index=index, find_min=True,
                find_min_positions=True)
            assert len(result) == 2
            xp_assert_equal(result[0], [0, 2])
            xp_assert_equal(result[1], [0, 3])
            assert result[1].dtype.kind == 'i'
            result = ndimage._measurements._select(
                x, labels=labels, index=index, find_max=True,
                find_max_positions=True)
            assert len(result) == 2
            xp_assert_equal(result[0], [1, 6])
            xp_assert_equal(result[1], [1, 2])
            assert result[1].dtype.kind == 'i'


def test_label01(xp):
    data = xp.ones(())
    out, n = ndimage.label(data)
    assert out == 1
    assert n == 1


def test_label02(xp):
    data = xp.zeros(())
    out, n = ndimage.label(data)
    assert out == 0
    assert n == 0


def test_label03(xp):
    data = xp.ones([1])
    out, n = ndimage.label(data)
    assert_array_almost_equal(out, xp.asarray([1]))
    assert n == 1


def test_label04(xp):
    data = xp.zeros([1])
    out, n = ndimage.label(data)
    assert_array_almost_equal(out, xp.asarray([0]))
    assert n == 0


def test_label05(xp):
    data = xp.ones([5])
    out, n = ndimage.label(data)
    assert_array_almost_equal(out, xp.asarray([1, 1, 1, 1, 1]))
    assert n == 1


def test_label06(xp):
    data = xp.asarray([1, 0, 1, 1, 0, 1])
    out, n = ndimage.label(data)
    assert_array_almost_equal(out, xp.asarray([1, 0, 2, 2, 0, 3]))
    assert n == 3


def test_label07(xp):
    data = xp.asarray([[0, 0, 0, 0, 0, 0],
                       [0, 0, 0, 0, 0, 0],
                       [0, 0, 0, 0, 0, 0],
                       [0, 0, 0, 0, 0, 0],
                       [0, 0, 0, 0, 0, 0],
                       [0, 0, 0, 0, 0, 0]])
    out, n = ndimage.label(data)
    assert_array_almost_equal(out, xp.asarray(
                                    [[0, 0, 0, 0, 0, 0],
                                     [0, 0, 0, 0, 0, 0],
                                     [0, 0, 0, 0, 0, 0],
                                     [0, 0, 0, 0, 0, 0],
                                     [0, 0, 0, 0, 0, 0],
                                     [0, 0, 0, 0, 0, 0]]))
    assert n == 0


def test_label08(xp):
    data = xp.asarray([[1, 0, 0, 0, 0, 0],
                       [0, 0, 1, 1, 0, 0],
                       [0, 0, 1, 1, 1, 0],
                       [1, 1, 0, 0, 0, 0],
                       [1, 1, 0, 0, 0, 0],
                       [0, 0, 0, 1, 1, 0]])
    out, n = ndimage.label(data)
    assert_array_almost_equal(out, xp.asarray([[1, 0, 0, 0, 0, 0],
                                               [0, 0, 2, 2, 0, 0],
                                               [0, 0, 2, 2, 2, 0],
                                               [3, 3, 0, 0, 0, 0],
                                               [3, 3, 0, 0, 0, 0],
                                               [0, 0, 0, 4, 4, 0]]))
    assert n == 4


def test_label09(xp):
    data = xp.asarray([[1, 0, 0, 0, 0, 0],
                       [0, 0, 1, 1, 0, 0],
                       [0, 0, 1, 1, 1, 0],
                       [1, 1, 0, 0, 0, 0],
                       [1, 1, 0, 0, 0, 0],
                       [0, 0, 0, 1, 1, 0]])
    struct = ndimage.generate_binary_structure(2, 2)
    struct = xp.asarray(struct)
    out, n = ndimage.label(data, struct)
    assert_array_almost_equal(out, xp.asarray([[1, 0, 0, 0, 0, 0],
                                               [0, 0, 2, 2, 0, 0],
                                               [0, 0, 2, 2, 2, 0],
                                               [2, 2, 0, 0, 0, 0],
                                               [2, 2, 0, 0, 0, 0],
                                               [0, 0, 0, 3, 3, 0]]))
    assert n == 3


def test_label10(xp):
    data = xp.asarray([[0, 0, 0, 0, 0, 0],
                       [0, 1, 1, 0, 1, 0],
                       [0, 1, 1, 1, 1, 0],
                       [0, 0, 0, 0, 0, 0]])
    struct = ndimage.generate_binary_structure(2, 2)
    struct = xp.asarray(struct)
    out, n = ndimage.label(data, struct)
    assert_array_almost_equal(out, xp.asarray([[0, 0, 0, 0, 0, 0],
                                               [0, 1, 1, 0, 1, 0],
                                               [0, 1, 1, 1, 1, 0],
                                               [0, 0, 0, 0, 0, 0]]))
    assert n == 1


def test_label11(xp):
    for type in types:
        dtype = getattr(xp, type)
        data = xp.asarray([[1, 0, 0, 0, 0, 0],
                           [0, 0, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 0],
                           [1, 1, 0, 0, 0, 0],
                           [1, 1, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 0]], dtype=dtype)
        out, n = ndimage.label(data)
        expected = [[1, 0, 0, 0, 0, 0],
                    [0, 0, 2, 2, 0, 0],
                    [0, 0, 2, 2, 2, 0],
                    [3, 3, 0, 0, 0, 0],
                    [3, 3, 0, 0, 0, 0],
                    [0, 0, 0, 4, 4, 0]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(out, expected)
        assert n == 4


@skip_xp_backends(np_only=True, reason='inplace output is numpy-specific')
def test_label11_inplace(xp):
    for type in types:
        dtype = getattr(xp, type)
        data = xp.asarray([[1, 0, 0, 0, 0, 0],
                           [0, 0, 1, 1, 0, 0],
                           [0, 0, 1, 1, 1, 0],
                           [1, 1, 0, 0, 0, 0],
                           [1, 1, 0, 0, 0, 0],
                           [0, 0, 0, 1, 1, 0]], dtype=dtype)
        n = ndimage.label(data, output=data)
        expected = [[1, 0, 0, 0, 0, 0],
                    [0, 0, 2, 2, 0, 0],
                    [0, 0, 2, 2, 2, 0],
                    [3, 3, 0, 0, 0, 0],
                    [3, 3, 0, 0, 0, 0],
                    [0, 0, 0, 4, 4, 0]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(data, expected)
        assert n == 4


def test_label12(xp):
    for type in types:
        dtype = getattr(xp, type)
        data = xp.asarray([[0, 0, 0, 0, 1, 1],
                           [0, 0, 0, 0, 0, 1],
                           [0, 0, 1, 0, 1, 1],
                           [0, 0, 1, 1, 1, 1],
                           [0, 0, 0, 1, 1, 0]], dtype=dtype)
        out, n = ndimage.label(data)
        expected = [[0, 0, 0, 0, 1, 1],
                    [0, 0, 0, 0, 0, 1],
                    [0, 0, 1, 0, 1, 1],
                    [0, 0, 1, 1, 1, 1],
                    [0, 0, 0, 1, 1, 0]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(out, expected)
        assert n == 1


def test_label13(xp):
    for type in types:
        dtype = getattr(xp, type)
        data = xp.asarray([[1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
                           [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
                           [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
                           [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
                          dtype=dtype)
        out, n = ndimage.label(data)
        expected = [[1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
                    [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
                    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
                    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]]
        expected = xp.asarray(expected)
        assert_array_almost_equal(out, expected)
        assert n == 1


@skip_xp_backends(np_only=True, exceptions=["cupy"],
                  reason='output=dtype is numpy-specific')
def test_label_output_typed(xp):
    data = xp.ones([5])
    for t in types:
        dtype = getattr(xp, t)
        output = xp.zeros([5], dtype=dtype)
        n = ndimage.label(data, output=output)
        assert_array_almost_equal(output,
                                  xp.ones(output.shape, dtype=output.dtype))
        assert n == 1


@skip_xp_backends(np_only=True, exceptions=["cupy"],
                  reason='output=dtype is numpy-specific')
def test_label_output_dtype(xp):
    data = xp.ones([5])
    for t in types:
        dtype = getattr(xp, t)
        output, n = ndimage.label(data, output=dtype)
        assert_array_almost_equal(output,
                                  xp.ones(output.shape, dtype=output.dtype))
        assert output.dtype == t


@skip_xp_backends(np_only=True, reason="in-place output is numpy-specific")
def test_label_output_wrong_size(xp):
    data = xp.ones([5])
    for t in types:
        dtype = getattr(xp, t)
        output = xp.zeros([10], dtype=dtype)
        assert_raises(ValueError, ndimage.label, data, output=output)


def test_label_structuring_elements(xp):
    data = np.loadtxt(os.path.join(os.path.dirname(
        __file__), "data", "label_inputs.txt"))
    strels = np.loadtxt(os.path.join(
        os.path.dirname(__file__), "data", "label_strels.txt"))
    results = np.loadtxt(os.path.join(
        os.path.dirname(__file__), "data", "label_results.txt"))
    data = data.reshape((-1, 7, 7))
    strels = strels.reshape((-1, 3, 3))
    results = results.reshape((-1, 7, 7))

    data = xp.asarray(data)
    strels = xp.asarray(strels)
    results = xp.asarray(results)
    r = 0
    for i in range(data.shape[0]):
        d = data[i, :, :]
        for j in range(strels.shape[0]):
            s = strels[j, :, :]
            xp_assert_equal(ndimage.label(d, s)[0], results[r, :, :], check_dtype=False)
            r += 1

@skip_xp_backends("cupy", reason="`cupyx.scipy.ndimage` does not have `find_objects`")
def test_ticket_742(xp):
    def SE(img, thresh=.7, size=4):
        mask = img > thresh
        rank = len(mask.shape)
        struct = ndimage.generate_binary_structure(rank, rank)
        struct = xp.asarray(struct)
        la, co = ndimage.label(mask,
                               struct)
        _ = ndimage.find_objects(la)

    if np.dtype(np.intp) != np.dtype('i'):
        shape = (3, 1240, 1240)
        a = np.random.rand(np.prod(shape)).reshape(shape)
        a = xp.asarray(a)
        # shouldn't crash
        SE(a)


def test_gh_issue_3025(xp):
    """Github issue #3025 - improper merging of labels"""
    d = np.zeros((60, 320))
    d[:, :257] = 1
    d[:, 260:] = 1
    d[36, 257] = 1
    d[35, 258] = 1
    d[35, 259] = 1
    d = xp.asarray(d)
    assert ndimage.label(d, xp.ones((3, 3)))[1] == 1


@skip_xp_backends("cupy", reason="cupyx.scipy.ndimage does not have find_object")
class TestFindObjects:
    def test_label_default_dtype(self, xp):
        test_array = np.random.rand(10, 10)
        test_array = xp.asarray(test_array)
        label, no_features = ndimage.label(test_array > 0.5)
        assert label.dtype in (xp.int32, xp.int64)
        # Shouldn't raise an exception
        ndimage.find_objects(label)


    def test_find_objects01(self, xp):
        data = xp.ones([], dtype=xp.int64)
        out = ndimage.find_objects(data)
        assert out == [()]


    def test_find_objects02(self, xp):
        data = xp.zeros([], dtype=xp.int64)
        out = ndimage.find_objects(data)
        assert out == []


    def test_find_objects03(self, xp):
        data = xp.ones([1], dtype=xp.int64)
        out = ndimage.find_objects(data)
        assert out == [(slice(0, 1, None),)]


    def test_find_objects04(self, xp):
        data = xp.zeros([1], dtype=xp.int64)
        out = ndimage.find_objects(data)
        assert out == []


    def test_find_objects05(self, xp):
        data = xp.ones([5], dtype=xp.int64)
        out = ndimage.find_objects(data)
        assert out == [(slice(0, 5, None),)]


    def test_find_objects06(self, xp):
        data = xp.asarray([1, 0, 2, 2, 0, 3])
        out = ndimage.find_objects(data)
        assert out == [(slice(0, 1, None),),
                       (slice(2, 4, None),),
                       (slice(5, 6, None),)]


    def test_find_objects07(self, xp):
        data = xp.asarray([[0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0]])
        out = ndimage.find_objects(data)
        assert out == []


    def test_find_objects08(self, xp):
        data = xp.asarray([[1, 0, 0, 0, 0, 0],
                           [0, 0, 2, 2, 0, 0],
                           [0, 0, 2, 2, 2, 0],
                           [3, 3, 0, 0, 0, 0],
                           [3, 3, 0, 0, 0, 0],
                           [0, 0, 0, 4, 4, 0]])
        out = ndimage.find_objects(data)
        assert out == [(slice(0, 1, None), slice(0, 1, None)),
                           (slice(1, 3, None), slice(2, 5, None)),
                           (slice(3, 5, None), slice(0, 2, None)),
                           (slice(5, 6, None), slice(3, 5, None))]


    def test_find_objects09(self, xp):
        data = xp.asarray([[1, 0, 0, 0, 0, 0],
                           [0, 0, 2, 2, 0, 0],
                           [0, 0, 2, 2, 2, 0],
                           [0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 4, 4, 0]])
        out = ndimage.find_objects(data)
        assert out == [(slice(0, 1, None), slice(0, 1, None)),
                           (slice(1, 3, None), slice(2, 5, None)),
                           None,
                           (slice(5, 6, None), slice(3, 5, None))]


def test_value_indices01(xp):
    "Test dictionary keys and entries"
    data = xp.asarray([[1, 0, 0, 0, 0, 0],
                       [0, 0, 2, 2, 0, 0],
                       [0, 0, 2, 2, 2, 0],
                       [0, 0, 0, 0, 0, 0],
                       [0, 0, 0, 0, 0, 0],
                       [0, 0, 0, 4, 4, 0]])
    vi = ndimage.value_indices(data, ignore_value=0)
    true_keys = [1, 2, 4]
    assert list(vi.keys()) == true_keys

    truevi = {k: xp.nonzero(data == k) for k in true_keys}

    vi = ndimage.value_indices(data, ignore_value=0)
    assert vi.keys() == truevi.keys()
    for key in vi.keys():
        assert len(vi[key]) == len(truevi[key])
        for v, true_v in zip(vi[key], truevi[key]):
            xp_assert_equal(v, true_v)


def test_value_indices02(xp):
    "Test input checking"
    data = xp.zeros((5, 4), dtype=xp.float32)
    msg = "Parameter 'arr' must be an integer array"
    with assert_raises(ValueError, match=msg):
        ndimage.value_indices(data)


def test_value_indices03(xp):
    "Test different input array shapes, from 1-D to 4-D"
    for shape in [(36,), (18, 2), (3, 3, 4), (3, 3, 2, 2)]:
        a = np.asarray((12*[1]+12*[2]+12*[3]), dtype=np.int32)
        a = np.reshape(a, shape)

        trueKeys = np.unique(a)
        a = xp.asarray(a)
        vi = ndimage.value_indices(a)
        assert list(vi.keys()) == list(trueKeys)
        for k in [int(x) for x in trueKeys]:
            trueNdx = xp.nonzero(a == k)
            assert len(vi[k]) == len(trueNdx)
            for vik, true_vik in zip(vi[k], trueNdx):
                xp_assert_equal(vik, true_vik)


def test_sum01(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([], dtype=dtype)
        output = ndimage.sum(input)
        assert output == 0


def test_sum02(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.zeros([0, 4], dtype=dtype)
        output = ndimage.sum(input)
        assert output == 0


def test_sum03(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.ones([], dtype=dtype)
        output = ndimage.sum(input)
        assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_sum04(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([1, 2], dtype=dtype)
        output = ndimage.sum(input)
        assert_almost_equal(output, xp.asarray(3.0), check_0d=False)


def test_sum05(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.sum(input)
        assert_almost_equal(output, xp.asarray(10.0), check_0d=False)


def test_sum06(xp):
    labels = np.asarray([], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([], dtype=dtype)
        output = ndimage.sum(input, labels=labels)
        assert output == 0


def test_sum07(xp):
    labels = np.ones([0, 4], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.zeros([0, 4], dtype=dtype)
        output = ndimage.sum(input, labels=labels)
        assert output == 0


def test_sum08(xp):
    labels = np.asarray([1, 0], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([1, 2], dtype=dtype)
        output = ndimage.sum(input, labels=labels)
        assert output == 1


def test_sum09(xp):
    labels = np.asarray([1, 0], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.sum(input, labels=labels)
        assert_almost_equal(output, xp.asarray(4.0), check_0d=False)


def test_sum10(xp):
    labels = np.asarray([1, 0], dtype=bool)
    input = np.asarray([[1, 2], [3, 4]], dtype=bool)

    labels = xp.asarray(labels)
    input = xp.asarray(input)
    output = ndimage.sum(input, labels=labels)
    assert_almost_equal(output, xp.asarray(2.0), check_0d=False)


def test_sum11(xp):
    labels = xp.asarray([1, 2], dtype=xp.int8)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.sum(input, labels=labels,
                             index=2)
        assert_almost_equal(output, xp.asarray(6.0), check_0d=False)


def test_sum12(xp):
    labels = xp.asarray([[1, 2], [2, 4]], dtype=xp.int8)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.sum(input, labels=labels, index=xp.asarray([4, 8, 2]))
        assert_array_almost_equal(output, xp.asarray([4.0, 0.0, 5.0]))


def test_sum_labels(xp):
    labels = xp.asarray([[1, 2], [2, 4]], dtype=xp.int8)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output_sum = ndimage.sum(input, labels=labels, index=xp.asarray([4, 8, 2]))
        output_labels = ndimage.sum_labels(
            input, labels=labels, index=xp.asarray([4, 8, 2]))

        assert xp.all(output_sum == output_labels)
        assert_array_almost_equal(output_labels, xp.asarray([4.0, 0.0, 5.0]))


def test_mean01(xp):
    labels = np.asarray([1, 0], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.mean(input, labels=labels)
        assert_almost_equal(output, xp.asarray(2.0), check_0d=False)


def test_mean02(xp):
    labels = np.asarray([1, 0], dtype=bool)
    input = np.asarray([[1, 2], [3, 4]], dtype=bool)

    labels = xp.asarray(labels)
    input = xp.asarray(input)
    output = ndimage.mean(input, labels=labels)
    assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_mean03(xp):
    labels = xp.asarray([1, 2])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.mean(input, labels=labels,
                              index=2)
        assert_almost_equal(output, xp.asarray(3.0), check_0d=False)


def test_mean04(xp):
    labels = xp.asarray([[1, 2], [2, 4]], dtype=xp.int8)
    with np.errstate(all='ignore'):
        for type in types:
            dtype = getattr(xp, type)
            input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
            output = ndimage.mean(input, labels=labels,
                                  index=xp.asarray([4, 8, 2]))
            # XXX: output[[0, 2]] does not work in array-api-strict; annoying
            # assert_array_almost_equal(output[[0, 2]], xp.asarray([4.0, 2.5]))
            assert output[0] == 4.0
            assert output[2] == 2.5
            assert xp.isnan(output[1])


def test_minimum01(xp):
    labels = np.asarray([1, 0], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.minimum(input, labels=labels)
        assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_minimum02(xp):
    labels = np.asarray([1, 0], dtype=bool)
    input = np.asarray([[2, 2], [2, 4]], dtype=bool)

    labels = xp.asarray(labels)
    input = xp.asarray(input)
    output = ndimage.minimum(input, labels=labels)
    assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_minimum03(xp):
    labels = xp.asarray([1, 2])
    for type in types:
        dtype = getattr(xp, type)

        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.minimum(input, labels=labels,
                                 index=2)
        assert_almost_equal(output, xp.asarray(2.0), check_0d=False)


def test_minimum04(xp):
    labels = xp.asarray([[1, 2], [2, 3]])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.minimum(input, labels=labels,
                                 index=xp.asarray([2, 3, 8]))
        assert_array_almost_equal(output, xp.asarray([2.0, 4.0, 0.0]))


def test_maximum01(xp):
    labels = np.asarray([1, 0], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.maximum(input, labels=labels)
        assert_almost_equal(output, xp.asarray(3.0), check_0d=False)


def test_maximum02(xp):
    labels = np.asarray([1, 0], dtype=bool)
    input = np.asarray([[2, 2], [2, 4]], dtype=bool)
    labels = xp.asarray(labels)
    input = xp.asarray(input)
    output = ndimage.maximum(input, labels=labels)
    assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_maximum03(xp):
    labels = xp.asarray([1, 2])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.maximum(input, labels=labels,
                                 index=2)
        assert_almost_equal(output, xp.asarray(4.0), check_0d=False)


def test_maximum04(xp):
    labels = xp.asarray([[1, 2], [2, 3]])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.maximum(input, labels=labels,
                                 index=xp.asarray([2, 3, 8]))
        assert_array_almost_equal(output, xp.asarray([3.0, 4.0, 0.0]))


def test_maximum05(xp):
    # Regression test for ticket #501 (Trac)
    x = xp.asarray([-3, -2, -1])
    assert ndimage.maximum(x) == -1


def test_median01(xp):
    a = xp.asarray([[1, 2, 0, 1],
                    [5, 3, 0, 4],
                    [0, 0, 0, 7],
                    [9, 3, 0, 0]])
    labels = xp.asarray([[1, 1, 0, 2],
                         [1, 1, 0, 2],
                         [0, 0, 0, 2],
                         [3, 3, 0, 0]])
    output = ndimage.median(a, labels=labels, index=xp.asarray([1, 2, 3]))
    assert_array_almost_equal(output, xp.asarray([2.5, 4.0, 6.0]))


def test_median02(xp):
    a = xp.asarray([[1, 2, 0, 1],
                    [5, 3, 0, 4],
                    [0, 0, 0, 7],
                    [9, 3, 0, 0]])
    output = ndimage.median(a)
    assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_median03(xp):
    a = xp.asarray([[1, 2, 0, 1],
                    [5, 3, 0, 4],
                    [0, 0, 0, 7],
                    [9, 3, 0, 0]])
    labels = xp.asarray([[1, 1, 0, 2],
                         [1, 1, 0, 2],
                         [0, 0, 0, 2],
                         [3, 3, 0, 0]])
    output = ndimage.median(a, labels=labels)
    assert_almost_equal(output, xp.asarray(3.0), check_0d=False)


def test_median_gh12836_bool(xp):
    # test boolean addition fix on example from gh-12836
    a = np.asarray([1, 1], dtype=bool)
    a = xp.asarray(a)
    output = ndimage.median(a, labels=xp.ones((2,)), index=xp.asarray([1]))
    assert_array_almost_equal(output, xp.asarray([1.0]))


def test_median_no_int_overflow(xp):
    # test integer overflow fix on example from gh-12836
    a = xp.asarray([65, 70], dtype=xp.int8)
    output = ndimage.median(a, labels=xp.ones((2,)), index=xp.asarray([1]))
    assert_array_almost_equal(output, xp.asarray([67.5]))


def test_variance01(xp):
    with np.errstate(all='ignore'):
        for type in types:
            dtype = getattr(xp, type)
            input = xp.asarray([], dtype=dtype)
            with suppress_warnings() as sup:
                sup.filter(RuntimeWarning, "Mean of empty slice")
                output = ndimage.variance(input)
            assert xp.isnan(output)


def test_variance02(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([1], dtype=dtype)
        output = ndimage.variance(input)
        assert_almost_equal(output, xp.asarray(0.0), check_0d=False)


def test_variance03(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([1, 3], dtype=dtype)
        output = ndimage.variance(input)
        assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_variance04(xp):
    input = np.asarray([1, 0], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.variance(input)
    assert_almost_equal(output, xp.asarray(0.25), check_0d=False)


def test_variance05(xp):
    labels = xp.asarray([2, 2, 3])
    for type in types:
        dtype = getattr(xp, type)

        input = xp.asarray([1, 3, 8], dtype=dtype)
        output = ndimage.variance(input, labels, 2)
        assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_variance06(xp):
    labels = xp.asarray([2, 2, 3, 3, 4])
    with np.errstate(all='ignore'):
        for type in types:
            dtype = getattr(xp, type)
            input = xp.asarray([1, 3, 8, 10, 8], dtype=dtype)
            output = ndimage.variance(input, labels, xp.asarray([2, 3, 4]))
            assert_array_almost_equal(output, xp.asarray([1.0, 1.0, 0.0]))


def test_standard_deviation01(xp):
    with np.errstate(all='ignore'):
        for type in types:
            dtype = getattr(xp, type)
            input = xp.asarray([], dtype=dtype)
            with suppress_warnings() as sup:
                sup.filter(RuntimeWarning, "Mean of empty slice")
                output = ndimage.standard_deviation(input)
            assert xp.isnan(output)


def test_standard_deviation02(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([1], dtype=dtype)
        output = ndimage.standard_deviation(input)
        assert_almost_equal(output, xp.asarray(0.0), check_0d=False)


def test_standard_deviation03(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([1, 3], dtype=dtype)
        output = ndimage.standard_deviation(input)
        assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_standard_deviation04(xp):
    input = np.asarray([1, 0], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.standard_deviation(input)
    assert_almost_equal(output, xp.asarray(0.5), check_0d=False)


def test_standard_deviation05(xp):
    labels = xp.asarray([2, 2, 3])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([1, 3, 8], dtype=dtype)
        output = ndimage.standard_deviation(input, labels, 2)
        assert_almost_equal(output, xp.asarray(1.0), check_0d=False)


def test_standard_deviation06(xp):
    labels = xp.asarray([2, 2, 3, 3, 4])
    with np.errstate(all='ignore'):
        for type in types:
            dtype = getattr(xp, type)
            input = xp.asarray([1, 3, 8, 10, 8], dtype=dtype)
            output = ndimage.standard_deviation(
                input, labels, xp.asarray([2, 3, 4])
            )
            assert_array_almost_equal(output, xp.asarray([1.0, 1.0, 0.0]))


def test_standard_deviation07(xp):
    labels = xp.asarray([1])
    with np.errstate(all='ignore'):
        for type in types:
            if is_torch(xp) and type == 'uint8':
                pytest.xfail("value cannot be converted to type uint8 "
                             "without overflow")
            dtype = getattr(xp, type)
            input = xp.asarray([-0.00619519], dtype=dtype)
            output = ndimage.standard_deviation(input, labels, xp.asarray([1]))
            assert_array_almost_equal(output, xp.asarray([0]))


def test_minimum_position01(xp):
    labels = np.asarray([1, 0], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.minimum_position(input, labels=labels)
        assert output == (0, 0)


def test_minimum_position02(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 0, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output = ndimage.minimum_position(input)
        assert output == (1, 2)


def test_minimum_position03(xp):
    input = np.asarray([[5, 4, 2, 5],
                        [3, 7, 0, 2],
                        [1, 5, 1, 1]], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.minimum_position(input)
    assert output == (1, 2)


def test_minimum_position04(xp):
    input = np.asarray([[5, 4, 2, 5],
                        [3, 7, 1, 2],
                        [1, 5, 1, 1]], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.minimum_position(input)
    assert output == (0, 0)


def test_minimum_position05(xp):
    labels = xp.asarray([1, 2, 0, 4])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 0, 2],
                            [1, 5, 2, 3]], dtype=dtype)
        output = ndimage.minimum_position(input, labels)
        assert output == (2, 0)


def test_minimum_position06(xp):
    labels = xp.asarray([1, 2, 3, 4])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 0, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output = ndimage.minimum_position(input, labels, 2)
        assert output == (0, 1)


def test_minimum_position07(xp):
    labels = xp.asarray([1, 2, 3, 4])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 0, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output = ndimage.minimum_position(input, labels,
                                          xp.asarray([2, 3]))
        assert output[0] == (0, 1)
        assert output[1] == (1, 2)


def test_maximum_position01(xp):
    labels = np.asarray([1, 0], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output = ndimage.maximum_position(input,
                                          labels=labels)
        assert output == (1, 0)


def test_maximum_position02(xp):
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 8, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output = ndimage.maximum_position(input)
        assert output == (1, 2)


def test_maximum_position03(xp):
    input = np.asarray([[5, 4, 2, 5],
                        [3, 7, 8, 2],
                        [1, 5, 1, 1]], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.maximum_position(input)
    assert output == (0, 0)


def test_maximum_position04(xp):
    labels = xp.asarray([1, 2, 0, 4])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 8, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output = ndimage.maximum_position(input, labels)
        assert output == (1, 1)


def test_maximum_position05(xp):
    labels = xp.asarray([1, 2, 0, 4])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 8, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output = ndimage.maximum_position(input, labels, 1)
        assert output == (0, 0)


def test_maximum_position06(xp):
    labels = xp.asarray([1, 2, 0, 4])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 8, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output = ndimage.maximum_position(input, labels,
                                          xp.asarray([1, 2]))
        assert output[0] == (0, 0)
        assert output[1] == (1, 1)


def test_maximum_position07(xp):
    # Test float labels
    labels = xp.asarray([1.0, 2.5, 0.0, 4.5])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 8, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output = ndimage.maximum_position(input, labels,
                                          xp.asarray([1.0, 4.5]))
        assert output[0] == (0, 0)
        assert output[1] == (0, 3)


def test_extrema01(xp):
    labels = np.asarray([1, 0], dtype=bool)
    labels = xp.asarray(labels)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output1 = ndimage.extrema(input, labels=labels)
        output2 = ndimage.minimum(input, labels=labels)
        output3 = ndimage.maximum(input, labels=labels)
        output4 = ndimage.minimum_position(input,
                                           labels=labels)
        output5 = ndimage.maximum_position(input,
                                           labels=labels)
        assert output1 == (output2, output3, output4, output5)


def test_extrema02(xp):
    labels = xp.asarray([1, 2])
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output1 = ndimage.extrema(input, labels=labels,
                                  index=2)
        output2 = ndimage.minimum(input, labels=labels,
                                  index=2)
        output3 = ndimage.maximum(input, labels=labels,
                                  index=2)
        output4 = ndimage.minimum_position(input,
                                           labels=labels, index=2)
        output5 = ndimage.maximum_position(input,
                                           labels=labels, index=2)
        assert output1 == (output2, output3, output4, output5)


def test_extrema03(xp):
    labels = xp.asarray([[1, 2], [2, 3]])
    for type in types:
        if is_torch(xp) and type in ("uint16", "uint32", "uint64"):
             pytest.xfail("https://github.com/pytorch/pytorch/issues/58734")

        dtype = getattr(xp, type)
        input = xp.asarray([[1, 2], [3, 4]], dtype=dtype)
        output1 = ndimage.extrema(input,
                                  labels=labels,
                                  index=xp.asarray([2, 3, 8]))
        output2 = ndimage.minimum(input,
                                  labels=labels,
                                  index=xp.asarray([2, 3, 8]))
        output3 = ndimage.maximum(input, labels=labels,
                                  index=xp.asarray([2, 3, 8]))
        output4 = ndimage.minimum_position(input,
                                           labels=labels,
                                           index=xp.asarray([2, 3, 8]))
        output5 = ndimage.maximum_position(input,
                                           labels=labels,
                                           index=xp.asarray([2, 3, 8]))
        assert_array_almost_equal(output1[0], output2)
        assert_array_almost_equal(output1[1], output3)
        assert output1[2] == output4
        assert output1[3] == output5


def test_extrema04(xp):
    labels = xp.asarray([1, 2, 0, 4])
    for type in types:
        if is_torch(xp) and type in ("uint16", "uint32", "uint64"):
             pytest.xfail("https://github.com/pytorch/pytorch/issues/58734")

        dtype = getattr(xp, type)
        input = xp.asarray([[5, 4, 2, 5],
                            [3, 7, 8, 2],
                            [1, 5, 1, 1]], dtype=dtype)
        output1 = ndimage.extrema(input, labels, xp.asarray([1, 2]))
        output2 = ndimage.minimum(input, labels, xp.asarray([1, 2]))
        output3 = ndimage.maximum(input, labels, xp.asarray([1, 2]))
        output4 = ndimage.minimum_position(input, labels,
                                           xp.asarray([1, 2]))
        output5 = ndimage.maximum_position(input, labels,
                                           xp.asarray([1, 2]))
        assert_array_almost_equal(output1[0], output2)
        assert_array_almost_equal(output1[1], output3)
        assert output1[2] == output4
        assert output1[3] == output5


def test_center_of_mass01(xp):
    expected = (0.0, 0.0)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 0], [0, 0]], dtype=dtype)
        output = ndimage.center_of_mass(input)
        assert output == expected


def test_center_of_mass02(xp):
    expected = (1, 0)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[0, 0], [1, 0]], dtype=dtype)
        output = ndimage.center_of_mass(input)
        assert output == expected


def test_center_of_mass03(xp):
    expected = (0, 1)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[0, 1], [0, 0]], dtype=dtype)
        output = ndimage.center_of_mass(input)
        assert output == expected


def test_center_of_mass04(xp):
    expected = (1, 1)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[0, 0], [0, 1]], dtype=dtype)
        output = ndimage.center_of_mass(input)
        assert output == expected


def test_center_of_mass05(xp):
    expected = (0.5, 0.5)
    for type in types:
        dtype = getattr(xp, type)
        input = xp.asarray([[1, 1], [1, 1]], dtype=dtype)
        output = ndimage.center_of_mass(input)
        assert output == expected


def test_center_of_mass06(xp):
    expected = (0.5, 0.5)
    input = np.asarray([[1, 2], [3, 1]], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.center_of_mass(input)
    assert output == expected


def test_center_of_mass07(xp):
    labels = xp.asarray([1, 0])
    expected = (0.5, 0.0)
    input = np.asarray([[1, 2], [3, 1]], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.center_of_mass(input, labels)
    assert output == expected


def test_center_of_mass08(xp):
    labels = xp.asarray([1, 2])
    expected = (0.5, 1.0)
    input = np.asarray([[5, 2], [3, 1]], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.center_of_mass(input, labels, 2)
    assert output == expected


def test_center_of_mass09(xp):
    labels = xp.asarray((1, 2))
    expected = xp.asarray([(0.5, 0.0), (0.5, 1.0)], dtype=xp.float64)
    input = np.asarray([[1, 2], [1, 1]], dtype=bool)
    input = xp.asarray(input)
    output = ndimage.center_of_mass(input, labels, xp.asarray([1, 2]))
    xp_assert_equal(xp.asarray(output), xp.asarray(expected))


def test_histogram01(xp):
    expected = xp.ones(10)
    input = xp.arange(10)
    output = ndimage.histogram(input, 0, 10, 10)
    assert_array_almost_equal(output, expected)


def test_histogram02(xp):
    labels = xp.asarray([1, 1, 1, 1, 2, 2, 2, 2])
    expected = xp.asarray([0, 2, 0, 1, 1])
    input = xp.asarray([1, 1, 3, 4, 3, 3, 3, 3])
    output = ndimage.histogram(input, 0, 4, 5, labels, 1)
    assert_array_almost_equal(output, expected)


@skip_xp_backends(np_only=True, reason='object arrays')
def test_histogram03(xp):
    labels = xp.asarray([1, 0, 1, 1, 2, 2, 2, 2])
    expected1 = xp.asarray([0, 1, 0, 1, 1])
    expected2 = xp.asarray([0, 0, 0, 3, 0])
    input = xp.asarray([1, 1, 3, 4, 3, 5, 3, 3])

    output = ndimage.histogram(input, 0, 4, 5, labels, (1, 2))

    assert_array_almost_equal(output[0], expected1)
    assert_array_almost_equal(output[1], expected2)


def test_stat_funcs_2d(xp):
    a = xp.asarray([[5, 6, 0, 0, 0], [8, 9, 0, 0, 0], [0, 0, 0, 3, 5]])
    lbl = xp.asarray([[1, 1, 0, 0, 0], [1, 1, 0, 0, 0], [0, 0, 0, 2, 2]])

    mean = ndimage.mean(a, labels=lbl, index=xp.asarray([1, 2]))
    xp_assert_equal(mean, xp.asarray([7.0, 4.0], dtype=xp.float64))

    var = ndimage.variance(a, labels=lbl, index=xp.asarray([1, 2]))
    xp_assert_equal(var, xp.asarray([2.5, 1.0], dtype=xp.float64))

    std = ndimage.standard_deviation(a, labels=lbl, index=xp.asarray([1, 2]))
    assert_array_almost_equal(std, xp.sqrt(xp.asarray([2.5, 1.0], dtype=xp.float64)))

    med = ndimage.median(a, labels=lbl, index=xp.asarray([1, 2]))
    xp_assert_equal(med, xp.asarray([7.0, 4.0], dtype=xp.float64))

    min = ndimage.minimum(a, labels=lbl, index=xp.asarray([1, 2]))
    xp_assert_equal(min, xp.asarray([5, 3]), check_dtype=False)

    max = ndimage.maximum(a, labels=lbl, index=xp.asarray([1, 2]))
    xp_assert_equal(max, xp.asarray([9, 5]), check_dtype=False)


@skip_xp_backends("cupy", reason="no watershed_ift on CuPy")
class TestWatershedIft:

    def test_watershed_ift01(self, xp):
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=xp.uint8)
        markers = xp.asarray([[-1, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 1, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0]], dtype=xp.int8)
        structure=xp.asarray([[1, 1, 1],
                              [1, 1, 1],
                              [1, 1, 1]])
        out = ndimage.watershed_ift(data, markers, structure=structure)
        expected = [[-1, -1, -1, -1, -1, -1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, -1, -1, -1, -1, -1, -1],
                    [-1, -1, -1, -1, -1, -1, -1]]
        assert_array_almost_equal(out, xp.asarray(expected))

    def test_watershed_ift02(self, xp):
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=xp.uint8)
        markers = xp.asarray([[-1, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 1, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0]], dtype=xp.int8)
        out = ndimage.watershed_ift(data, markers)
        expected = [[-1, -1, -1, -1, -1, -1, -1],
                    [-1, -1, 1, 1, 1, -1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, -1, 1, 1, 1, -1, -1],
                    [-1, -1, -1, -1, -1, -1, -1],
                    [-1, -1, -1, -1, -1, -1, -1]]
        assert_array_almost_equal(out, xp.asarray(expected))

    def test_watershed_ift03(self, xp):
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=xp.uint8)
        markers = xp.asarray([[0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 2, 0, 3, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, -1]], dtype=xp.int8)
        out = ndimage.watershed_ift(data, markers)
        expected = [[-1, -1, -1, -1, -1, -1, -1],
                    [-1, -1, 2, -1, 3, -1, -1],
                    [-1, 2, 2, 3, 3, 3, -1],
                    [-1, 2, 2, 3, 3, 3, -1],
                    [-1, 2, 2, 3, 3, 3, -1],
                    [-1, -1, 2, -1, 3, -1, -1],
                    [-1, -1, -1, -1, -1, -1, -1]]
        assert_array_almost_equal(out, xp.asarray(expected))

    def test_watershed_ift04(self, xp):
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=xp.uint8)
        markers = xp.asarray([[0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 2, 0, 3, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, -1]],
                             dtype=xp.int8)

        structure=xp.asarray([[1, 1, 1],
                              [1, 1, 1],
                              [1, 1, 1]])
        out = ndimage.watershed_ift(data, markers, structure=structure)
        expected = [[-1, -1, -1, -1, -1, -1, -1],
                    [-1, 2, 2, 3, 3, 3, -1],
                    [-1, 2, 2, 3, 3, 3, -1],
                    [-1, 2, 2, 3, 3, 3, -1],
                    [-1, 2, 2, 3, 3, 3, -1],
                    [-1, 2, 2, 3, 3, 3, -1],
                    [-1, -1, -1, -1, -1, -1, -1]]
        assert_array_almost_equal(out, xp.asarray(expected))

    def test_watershed_ift05(self, xp):
        data = xp.asarray([[0, 0, 0, 0, 0, 0, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 0, 1, 0, 1, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=xp.uint8)
        markers = xp.asarray([[0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 3, 0, 2, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, -1]],
                             dtype=xp.int8)
        structure = xp.asarray([[1, 1, 1],
                                [1, 1, 1],
                                [1, 1, 1]])
        out = ndimage.watershed_ift(data, markers, structure=structure)
        expected = [[-1, -1, -1, -1, -1, -1, -1],
                    [-1, 3, 3, 2, 2, 2, -1],
                    [-1, 3, 3, 2, 2, 2, -1],
                    [-1, 3, 3, 2, 2, 2, -1],
                    [-1, 3, 3, 2, 2, 2, -1],
                    [-1, 3, 3, 2, 2, 2, -1],
                    [-1, -1, -1, -1, -1, -1, -1]]
        assert_array_almost_equal(out, xp.asarray(expected))

    def test_watershed_ift06(self, xp):
        data = xp.asarray([[0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 0, 0, 0, 1, 0],
                           [0, 1, 1, 1, 1, 1, 0],
                           [0, 0, 0, 0, 0, 0, 0],
                           [0, 0, 0, 0, 0, 0, 0]], dtype=xp.uint8)
        markers = xp.asarray([[-1, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 1, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0]], dtype=xp.int8)
        structure=xp.asarray([[1, 1, 1],
                              [1, 1, 1],
                              [1, 1, 1]])
        out = ndimage.watershed_ift(data, markers, structure=structure)
        expected = [[-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, -1, -1, -1, -1, -1, -1],
                    [-1, -1, -1, -1, -1, -1, -1]]
        assert_array_almost_equal(out, xp.asarray(expected))

    @skip_xp_backends(np_only=True, reason="inplace ops are numpy-specific")
    def test_watershed_ift07(self, xp):
        shape = (7, 6)
        data = np.zeros(shape, dtype=np.uint8)
        data = data.transpose()
        data[...] = np.asarray([[0, 1, 0, 0, 0, 1, 0],
                                [0, 1, 0, 0, 0, 1, 0],
                                [0, 1, 0, 0, 0, 1, 0],
                                [0, 1, 1, 1, 1, 1, 0],
                                [0, 0, 0, 0, 0, 0, 0],
                                [0, 0, 0, 0, 0, 0, 0]], dtype=np.uint8)
        data = xp.asarray(data)
        markers = xp.asarray([[-1, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 1, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0],
                              [0, 0, 0, 0, 0, 0, 0]], dtype=xp.int8)
        out = xp.zeros(shape, dtype=xp.int16)
        out = out.T
        structure=xp.asarray([[1, 1, 1],
                              [1, 1, 1],
                              [1, 1, 1]])
        ndimage.watershed_ift(data, markers, structure=structure,
                              output=out)
        expected = [[-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, 1, 1, 1, 1, 1, -1],
                    [-1, -1, -1, -1, -1, -1, -1],
                    [-1, -1, -1, -1, -1, -1, -1]]
        assert_array_almost_equal(out, xp.asarray(expected))

    @skip_xp_backends("cupy", reason="no watershed_ift on CuPy")
    def test_watershed_ift08(self, xp):
        # Test cost larger than uint8. See gh-10069.
        data = xp.asarray([[256, 0],
                           [0, 0]], dtype=xp.uint16)
        markers = xp.asarray([[1, 0],
                              [0, 0]], dtype=xp.int8)
        out = ndimage.watershed_ift(data, markers)
        expected = [[1, 1],
                    [1, 1]]
        assert_array_almost_equal(out, xp.asarray(expected))

    @skip_xp_backends("cupy", reason="no watershed_ift on CuPy")
    def test_watershed_ift09(self, xp):
        # Test large cost. See gh-19575
        data = xp.asarray([[xp.iinfo(xp.uint16).max, 0],
                           [0, 0]], dtype=xp.uint16)
        markers = xp.asarray([[1, 0],
                              [0, 0]], dtype=xp.int8)
        out = ndimage.watershed_ift(data, markers)
        expected = [[1, 1],
                    [1, 1]]
        xp_assert_close(out, xp.asarray(expected), check_dtype=False)


@skip_xp_backends(np_only=True)
@pytest.mark.parametrize("dt", [np.intc, np.uintc])
def test_gh_19423(dt, xp):
    rng = np.random.default_rng(123)
    max_val = 8
    image = rng.integers(low=0, high=max_val, size=(10, 12)).astype(dtype=dt)
    val_idx = ndimage.value_indices(image)
    assert len(val_idx.keys()) == max_val
