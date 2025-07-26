''' Some tests for filters '''
import functools
import itertools
import re
import contextlib

import numpy as np
import pytest
from numpy.testing import suppress_warnings, assert_allclose, assert_array_equal
from hypothesis import strategies as st
from hypothesis import given
import hypothesis.extra.numpy as npst
from pytest import raises as assert_raises
from scipy import ndimage
from scipy._lib._array_api import (
    assert_almost_equal,
    assert_array_almost_equal,
    xp_assert_close,
    xp_assert_equal,
)
from scipy._lib._array_api import (is_cupy, is_torch, is_dask, is_jax, array_namespace,
                                   is_array_api_strict, xp_copy)
from scipy.ndimage._filters import _gaussian_kernel1d

from . import types, float_types, complex_types


skip_xp_backends = pytest.mark.skip_xp_backends
xfail_xp_backends = pytest.mark.xfail_xp_backends
pytestmark = [skip_xp_backends(cpu_only=True, exceptions=['cupy', 'jax.numpy'])]

uses_output_dtype = skip_xp_backends(
    np_only=True, exceptions=["cupy"],
    reason="output=dtype is numpy-specific"
)


def uses_output_array(f):
    return skip_xp_backends("dask.array", reason="output=array requires buffer view")(
        skip_xp_backends("jax.numpy", reason="output=array requires buffer view")(f))



def sumsq(a, b, xp=None):
    xp = array_namespace(a, b) if xp is None else xp
    return xp.sqrt(xp.sum((a - b)**2))


def _complex_correlate(xp, array, kernel, real_dtype, convolve=False,
                       mode="reflect", cval=0, ):
    """Utility to perform a reference complex-valued convolutions.

    When convolve==False, correlation is performed instead
    """
    array = xp.asarray(array)
    kernel = xp.asarray(kernel)
    complex_array = xp.isdtype(array.dtype, 'complex floating')
    complex_kernel = xp.isdtype(kernel.dtype, 'complex floating')
    if array.ndim == 1:
        func = ndimage.convolve1d if convolve else ndimage.correlate1d
    else:
        func = ndimage.convolve if convolve else ndimage.correlate
    if not convolve:
        kernel = xp.conj(kernel)
    if complex_array and complex_kernel:
        # use: real(cval) for array.real component
        #      imag(cval) for array.imag component
        re_cval = cval.real if isinstance(cval, complex) else xp.real(cval)
        im_cval = cval.imag if isinstance(cval, complex) else xp.imag(cval)

        output = (
            func(xp.real(array), xp.real(kernel), output=real_dtype,
                 mode=mode, cval=re_cval) -
            func(xp.imag(array), xp.imag(kernel), output=real_dtype,
                 mode=mode, cval=im_cval) +
            1j * func(xp.imag(array), xp.real(kernel), output=real_dtype,
                      mode=mode, cval=im_cval) +
            1j * func(xp.real(array), xp.imag(kernel), output=real_dtype,
                      mode=mode, cval=re_cval)
        )
    elif complex_array:
        re_cval = xp.real(cval)
        re_cval = re_cval.item() if isinstance(re_cval, xp.ndarray) else re_cval
        im_cval = xp.imag(cval)
        im_cval = im_cval.item() if isinstance(im_cval, xp.ndarray) else im_cval

        output = (
            func(xp.real(array), kernel, output=real_dtype, mode=mode,
                 cval=re_cval) +
            1j * func(xp.imag(array), kernel, output=real_dtype, mode=mode,
                      cval=im_cval)
        )
    elif complex_kernel:
        # real array so cval is real too
        output = (
            func(array, xp.real(kernel), output=real_dtype, mode=mode, cval=cval) +
            1j * func(array, xp.imag(kernel), output=real_dtype, mode=mode,
                      cval=cval)
        )
    return output


def _cases_axes_tuple_length_mismatch():
    # Generate combinations of filter function, valid kwargs, and
    # keyword-value pairs for which the value will become with mismatched
    # (invalid) size
    filter_func = ndimage.gaussian_filter
    kwargs = dict(radius=3, mode='constant', sigma=1.0, order=0)
    for key, val in kwargs.items():
        yield filter_func, kwargs, key, val

    filter_funcs = [ndimage.uniform_filter, ndimage.minimum_filter,
                    ndimage.maximum_filter]
    kwargs = dict(size=3, mode='constant', origin=0)
    for filter_func in filter_funcs:
        for key, val in kwargs.items():
            yield filter_func, kwargs, key, val

    filter_funcs = [ndimage.correlate, ndimage.convolve]
    # sequence of mode not supported for correlate or convolve
    kwargs = dict(origin=0)
    for filter_func in filter_funcs:
        for key, val in kwargs.items():
            yield filter_func, kwargs, key, val


class TestNdimageFilters:

    def _validate_complex(self, xp, array, kernel, type2, mode='reflect',
                          cval=0, check_warnings=True):
        # utility for validating complex-valued correlations
        real_dtype = xp.real(xp.asarray([], dtype=type2)).dtype
        expected = _complex_correlate(
            xp, array, kernel, real_dtype, convolve=False, mode=mode, cval=cval
        )

        if array.ndim == 1:
            correlate = functools.partial(ndimage.correlate1d, axis=-1,
                                          mode=mode, cval=cval)
            convolve = functools.partial(ndimage.convolve1d, axis=-1,
                                         mode=mode, cval=cval)
        else:
            correlate = functools.partial(ndimage.correlate, mode=mode,
                                          cval=cval)
            convolve = functools.partial(ndimage.convolve, mode=mode,
                                          cval=cval)

        # test correlate output dtype
        output = correlate(array, kernel, output=type2)
        assert_array_almost_equal(expected, output)
        assert output.dtype.type == type2

        # test correlate with pre-allocated output
        output = xp.zeros_like(array, dtype=type2)
        correlate(array, kernel, output=output)
        assert_array_almost_equal(expected, output)

        # test convolve output dtype
        output = convolve(array, kernel, output=type2)
        expected = _complex_correlate(
            xp, array, kernel, real_dtype, convolve=True, mode=mode, cval=cval,
        )
        assert_array_almost_equal(expected, output)
        assert output.dtype.type == type2

        # convolve with pre-allocated output
        convolve(array, kernel, output=output)
        assert_array_almost_equal(expected, output)
        assert output.dtype.type == type2

        if check_warnings:
            # warns if the output is not a complex dtype
            with pytest.warns(UserWarning,
                              match="promoting specified output dtype to "
                              "complex"):
                correlate(array, kernel, output=real_dtype)

            with pytest.warns(UserWarning,
                              match="promoting specified output dtype to "
                              "complex"):
                convolve(array, kernel, output=real_dtype)

        # raises if output array is provided, but is not complex-valued
        output_real = xp.zeros_like(array, dtype=real_dtype)
        with assert_raises(RuntimeError):
            correlate(array, kernel, output=output_real)

        with assert_raises(RuntimeError):
            convolve(array, kernel, output=output_real)

    def test_correlate01(self, xp):
        array = xp.asarray([1, 2])
        weights = xp.asarray([2])
        expected = xp.asarray([2, 4])

        output = ndimage.correlate(array, weights)
        assert_array_almost_equal(output, expected)

        output = ndimage.convolve(array, weights)
        assert_array_almost_equal(output, expected)

        output = ndimage.correlate1d(array, weights)
        assert_array_almost_equal(output, expected)

        output = ndimage.convolve1d(array, weights)
        assert_array_almost_equal(output, expected)

    @xfail_xp_backends('cupy', reason="Differs by a factor of two?")
    @uses_output_array
    def test_correlate01_overlap(self, xp):
        array = xp.reshape(xp.arange(256), (16, 16))
        weights = xp.asarray([2])
        expected = 2 * array

        ndimage.correlate1d(array, weights, output=array)
        assert_array_almost_equal(array, expected)

    def test_correlate02(self, xp):
        array = xp.asarray([1, 2, 3])
        kernel = xp.asarray([1])

        output = ndimage.correlate(array, kernel)
        assert_array_almost_equal(array, output)

        output = ndimage.convolve(array, kernel)
        assert_array_almost_equal(array, output)

        output = ndimage.correlate1d(array, kernel)
        assert_array_almost_equal(array, output)

        output = ndimage.convolve1d(array, kernel)
        assert_array_almost_equal(array, output)

    def test_correlate03(self, xp):
        array = xp.asarray([1])
        weights = xp.asarray([1, 1])
        expected = xp.asarray([2])

        output = ndimage.correlate(array, weights)
        assert_array_almost_equal(output, expected)

        output = ndimage.convolve(array, weights)
        assert_array_almost_equal(output, expected)

        output = ndimage.correlate1d(array, weights)
        assert_array_almost_equal(output, expected)

        output = ndimage.convolve1d(array, weights)
        assert_array_almost_equal(output, expected)

    def test_correlate04(self, xp):
        array = xp.asarray([1, 2])
        tcor = xp.asarray([2, 3])
        tcov = xp.asarray([3, 4])
        weights = xp.asarray([1, 1])
        output = ndimage.correlate(array, weights)
        assert_array_almost_equal(output, tcor)
        output = ndimage.convolve(array, weights)
        assert_array_almost_equal(output, tcov)
        output = ndimage.correlate1d(array, weights)
        assert_array_almost_equal(output, tcor)
        output = ndimage.convolve1d(array, weights)
        assert_array_almost_equal(output, tcov)

    def test_correlate05(self, xp):
        array = xp.asarray([1, 2, 3])
        tcor = xp.asarray([2, 3, 5])
        tcov = xp.asarray([3, 5, 6])
        kernel = xp.asarray([1, 1])
        output = ndimage.correlate(array, kernel)
        assert_array_almost_equal(tcor, output)
        output = ndimage.convolve(array, kernel)
        assert_array_almost_equal(tcov, output)
        output = ndimage.correlate1d(array, kernel)
        assert_array_almost_equal(tcor, output)
        output = ndimage.convolve1d(array, kernel)
        assert_array_almost_equal(tcov, output)

    def test_correlate06(self, xp):
        array = xp.asarray([1, 2, 3])
        tcor = xp.asarray([9, 14, 17])
        tcov = xp.asarray([7, 10, 15])
        weights = xp.asarray([1, 2, 3])
        output = ndimage.correlate(array, weights)
        assert_array_almost_equal(output, tcor)
        output = ndimage.convolve(array, weights)
        assert_array_almost_equal(output, tcov)
        output = ndimage.correlate1d(array, weights)
        assert_array_almost_equal(output, tcor)
        output = ndimage.convolve1d(array, weights)
        assert_array_almost_equal(output, tcov)

    def test_correlate07(self, xp):
        array = xp.asarray([1, 2, 3])
        expected = xp.asarray([5, 8, 11])
        weights = xp.asarray([1, 2, 1])
        output = ndimage.correlate(array, weights)
        assert_array_almost_equal(output, expected)
        output = ndimage.convolve(array, weights)
        assert_array_almost_equal(output, expected)
        output = ndimage.correlate1d(array, weights)
        assert_array_almost_equal(output, expected)
        output = ndimage.convolve1d(array, weights)
        assert_array_almost_equal(output, expected)

    def test_correlate08(self, xp):
        array = xp.asarray([1, 2, 3])
        tcor = xp.asarray([1, 2, 5])
        tcov = xp.asarray([3, 6, 7])
        weights = xp.asarray([1, 2, -1])
        output = ndimage.correlate(array, weights)
        assert_array_almost_equal(output, tcor)
        output = ndimage.convolve(array, weights)
        assert_array_almost_equal(output, tcov)
        output = ndimage.correlate1d(array, weights)
        assert_array_almost_equal(output, tcor)
        output = ndimage.convolve1d(array, weights)
        assert_array_almost_equal(output, tcov)

    def test_correlate09(self, xp):
        array = xp.asarray([])
        kernel = xp.asarray([1, 1])
        output = ndimage.correlate(array, kernel)
        assert_array_almost_equal(array, output)
        output = ndimage.convolve(array, kernel)
        assert_array_almost_equal(array, output)
        output = ndimage.correlate1d(array, kernel)
        assert_array_almost_equal(array, output)
        output = ndimage.convolve1d(array, kernel)
        assert_array_almost_equal(array, output)

    def test_correlate10(self, xp):
        array = xp.asarray([[]])
        kernel = xp.asarray([[1, 1]])
        output = ndimage.correlate(array, kernel)
        assert_array_almost_equal(array, output)
        output = ndimage.convolve(array, kernel)
        assert_array_almost_equal(array, output)

    def test_correlate11(self, xp):
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]])
        kernel = xp.asarray([[1, 1],
                             [1, 1]])
        output = ndimage.correlate(array, kernel)
        assert_array_almost_equal(xp.asarray([[4, 6, 10], [10, 12, 16]]), output)
        output = ndimage.convolve(array, kernel)
        assert_array_almost_equal(xp.asarray([[12, 16, 18], [18, 22, 24]]), output)

    def test_correlate12(self, xp):
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]])
        kernel = xp.asarray([[1, 0],
                             [0, 1]])
        output = ndimage.correlate(array, kernel)
        assert_array_almost_equal(xp.asarray([[2, 3, 5], [5, 6, 8]]), output)
        output = ndimage.convolve(array, kernel)
        assert_array_almost_equal(xp.asarray([[6, 8, 9], [9, 11, 12]]), output)

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_array', types)
    @pytest.mark.parametrize('dtype_kernel', types)
    def test_correlate13(self, dtype_array, dtype_kernel, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_kernel = getattr(xp, dtype_kernel)

        kernel = xp.asarray([[1, 0],
                             [0, 1]])
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype_array)
        output = ndimage.correlate(array, kernel, output=dtype_kernel)
        assert_array_almost_equal(xp.asarray([[2, 3, 5], [5, 6, 8]]), output)
        assert output.dtype.type == dtype_kernel

        output = ndimage.convolve(array, kernel,
                                  output=dtype_kernel)
        assert_array_almost_equal(xp.asarray([[6, 8, 9], [9, 11, 12]]), output)
        assert output.dtype.type == dtype_kernel

    @uses_output_array
    @pytest.mark.parametrize('dtype_array', types)
    @pytest.mark.parametrize('dtype_output', types)
    def test_correlate14(self, dtype_array, dtype_output, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([[1, 0],
                             [0, 1]])
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype_array)
        output = xp.zeros(array.shape, dtype=dtype_output)
        ndimage.correlate(array, kernel, output=output)
        assert_array_almost_equal(xp.asarray([[2, 3, 5], [5, 6, 8]]), output)
        assert output.dtype == dtype_output

        ndimage.convolve(array, kernel, output=output)
        assert_array_almost_equal(xp.asarray([[6, 8, 9], [9, 11, 12]]), output)
        assert output.dtype == dtype_output

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_array', types)
    def test_correlate15(self, dtype_array, xp):
        dtype_array = getattr(xp, dtype_array)

        kernel = xp.asarray([[1, 0],
                             [0, 1]])
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype_array)
        output = ndimage.correlate(array, kernel, output=xp.float32)
        assert_array_almost_equal(xp.asarray([[2, 3, 5], [5, 6, 8]]), output)
        assert output.dtype.type == xp.float32

        output = ndimage.convolve(array, kernel, output=xp.float32)
        assert_array_almost_equal(xp.asarray([[6, 8, 9], [9, 11, 12]]), output)
        assert output.dtype.type == xp.float32

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_array', types)
    def test_correlate16(self, dtype_array, xp):
        dtype_array = getattr(xp, dtype_array)

        kernel = xp.asarray([[0.5, 0],
                             [0, 0.5]])
        array = xp.asarray([[1, 2, 3], [4, 5, 6]], dtype=dtype_array)
        output = ndimage.correlate(array, kernel, output=xp.float32)
        assert_array_almost_equal(xp.asarray([[1, 1.5, 2.5], [2.5, 3, 4]]), output)
        assert output.dtype.type == xp.float32

        output = ndimage.convolve(array, kernel, output=xp.float32)
        assert_array_almost_equal(xp.asarray([[3, 4, 4.5], [4.5, 5.5, 6]]), output)
        assert output.dtype.type == xp.float32

    def test_correlate17(self, xp):
        array = xp.asarray([1, 2, 3])
        tcor = xp.asarray([3, 5, 6])
        tcov = xp.asarray([2, 3, 5])
        kernel = xp.asarray([1, 1])
        output = ndimage.correlate(array, kernel, origin=-1)
        assert_array_almost_equal(tcor, output)
        output = ndimage.convolve(array, kernel, origin=-1)
        assert_array_almost_equal(tcov, output)
        output = ndimage.correlate1d(array, kernel, origin=-1)
        assert_array_almost_equal(tcor, output)
        output = ndimage.convolve1d(array, kernel, origin=-1)
        assert_array_almost_equal(tcov, output)

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_array', types)
    def test_correlate18(self, dtype_array, xp):
        dtype_array = getattr(xp, dtype_array)

        kernel = xp.asarray([[1, 0],
                             [0, 1]])
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype_array)
        output = ndimage.correlate(array, kernel,
                                   output=xp.float32,
                                   mode='nearest', origin=-1)
        assert_array_almost_equal(xp.asarray([[6, 8, 9], [9, 11, 12]]), output)
        assert output.dtype.type == xp.float32

        output = ndimage.convolve(array, kernel,
                                  output=xp.float32,
                                  mode='nearest', origin=-1)
        assert_array_almost_equal(xp.asarray([[2, 3, 5], [5, 6, 8]]), output)
        assert output.dtype.type == xp.float32

    def test_correlate_mode_sequence(self, xp):
        kernel = xp.ones((2, 2))
        array = xp.ones((3, 3), dtype=xp.float64)
        with assert_raises(RuntimeError):
            ndimage.correlate(array, kernel, mode=['nearest', 'reflect'])
        with assert_raises(RuntimeError):
            ndimage.convolve(array, kernel, mode=['nearest', 'reflect'])

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_array', types)
    def test_correlate19(self, dtype_array, xp):
        dtype_array = getattr(xp, dtype_array)

        kernel = xp.asarray([[1, 0],
                             [0, 1]])
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype_array)
        output = ndimage.correlate(array, kernel,
                                   output=xp.float32,
                                   mode='nearest', origin=[-1, 0])
        assert_array_almost_equal(xp.asarray([[5, 6, 8], [8, 9, 11]]), output)
        assert output.dtype.type == xp.float32

        output = ndimage.convolve(array, kernel,
                                  output=xp.float32,
                                  mode='nearest', origin=[-1, 0])
        assert_array_almost_equal(xp.asarray([[3, 5, 6], [6, 8, 9]]), output)
        assert output.dtype.type == xp.float32

    @uses_output_array
    @pytest.mark.parametrize('dtype_array', types)
    @pytest.mark.parametrize('dtype_output', types)
    def test_correlate20(self, dtype_array, dtype_output, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_output = getattr(xp, dtype_output)

        weights = xp.asarray([1, 2, 1])
        expected = xp.asarray([[5, 10, 15], [7, 14, 21]])
        array = xp.asarray([[1, 2, 3],
                            [2, 4, 6]], dtype=dtype_array)
        output = xp.zeros((2, 3), dtype=dtype_output)
        ndimage.correlate1d(array, weights, axis=0, output=output)
        assert_array_almost_equal(output, expected)
        ndimage.convolve1d(array, weights, axis=0, output=output)
        assert_array_almost_equal(output, expected)

    def test_correlate21(self, xp):
        array = xp.asarray([[1, 2, 3],
                            [2, 4, 6]])
        expected = xp.asarray([[5, 10, 15], [7, 14, 21]])
        weights = xp.asarray([1, 2, 1])
        output = ndimage.correlate1d(array, weights, axis=0)
        assert_array_almost_equal(output, expected)
        output = ndimage.convolve1d(array, weights, axis=0)
        assert_array_almost_equal(output, expected)

    @uses_output_array
    @pytest.mark.parametrize('dtype_array', types)
    @pytest.mark.parametrize('dtype_output', types)
    def test_correlate22(self, dtype_array, dtype_output, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_output = getattr(xp, dtype_output)

        weights = xp.asarray([1, 2, 1])
        expected = xp.asarray([[6, 12, 18], [6, 12, 18]])
        array = xp.asarray([[1, 2, 3],
                            [2, 4, 6]], dtype=dtype_array)
        output = xp.zeros((2, 3), dtype=dtype_output)
        ndimage.correlate1d(array, weights, axis=0,
                            mode='wrap', output=output)
        assert_array_almost_equal(output, expected)
        ndimage.convolve1d(array, weights, axis=0,
                           mode='wrap', output=output)
        assert_array_almost_equal(output, expected)

    @uses_output_array
    @pytest.mark.parametrize('dtype_array', types)
    @pytest.mark.parametrize('dtype_output', types)
    def test_correlate23(self, dtype_array, dtype_output, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_output = getattr(xp, dtype_output)

        weights = xp.asarray([1, 2, 1])
        expected = xp.asarray([[5, 10, 15], [7, 14, 21]])
        array = xp.asarray([[1, 2, 3],
                            [2, 4, 6]], dtype=dtype_array)
        output = xp.zeros((2, 3), dtype=dtype_output)
        ndimage.correlate1d(array, weights, axis=0,
                            mode='nearest', output=output)
        assert_array_almost_equal(output, expected)
        ndimage.convolve1d(array, weights, axis=0,
                           mode='nearest', output=output)
        assert_array_almost_equal(output, expected)

    @uses_output_array
    @pytest.mark.parametrize('dtype_array', types)
    @pytest.mark.parametrize('dtype_output', types)
    def test_correlate24(self, dtype_array, dtype_output, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_output = getattr(xp, dtype_output)

        weights = xp.asarray([1, 2, 1])
        tcor = xp.asarray([[7, 14, 21], [8, 16, 24]])
        tcov = xp.asarray([[4, 8, 12], [5, 10, 15]])
        array = xp.asarray([[1, 2, 3],
                            [2, 4, 6]], dtype=dtype_array)
        output = xp.zeros((2, 3), dtype=dtype_output)
        ndimage.correlate1d(array, weights, axis=0,
                            mode='nearest', output=output, origin=-1)
        assert_array_almost_equal(output, tcor)
        ndimage.convolve1d(array, weights, axis=0,
                           mode='nearest', output=output, origin=-1)
        assert_array_almost_equal(output, tcov)

    @uses_output_array
    @pytest.mark.parametrize('dtype_array', types)
    @pytest.mark.parametrize('dtype_output', types)
    def test_correlate25(self, dtype_array, dtype_output, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_output = getattr(xp, dtype_output)

        weights = xp.asarray([1, 2, 1])
        tcor = xp.asarray([[4, 8, 12], [5, 10, 15]])
        tcov = xp.asarray([[7, 14, 21], [8, 16, 24]])
        array = xp.asarray([[1, 2, 3],
                            [2, 4, 6]], dtype=dtype_array)
        output = xp.zeros((2, 3), dtype=dtype_output)
        ndimage.correlate1d(array, weights, axis=0,
                            mode='nearest', output=output, origin=1)
        assert_array_almost_equal(output, tcor)
        ndimage.convolve1d(array, weights, axis=0,
                           mode='nearest', output=output, origin=1)
        assert_array_almost_equal(output, tcov)

    def test_correlate26(self, xp):
        # test fix for gh-11661 (mirror extension of a length 1 signal)
        y = ndimage.convolve1d(xp.ones(1), xp.ones(5), mode='mirror')
        xp_assert_equal(y, xp.asarray([5.]))

        y = ndimage.correlate1d(xp.ones(1), xp.ones(5), mode='mirror')
        xp_assert_equal(y, xp.asarray([5.]))

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_kernel', complex_types)
    @pytest.mark.parametrize('dtype_input', types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate_complex_kernel(self, dtype_input, dtype_kernel,
                                      dtype_output, xp, num_parallel_threads):
        dtype_input = getattr(xp, dtype_input)
        dtype_kernel = getattr(xp, dtype_kernel)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([[1, 0],
                             [0, 1 + 1j]], dtype=dtype_kernel)
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype_input)
        self._validate_complex(xp, array, kernel, dtype_output,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_kernel', complex_types)
    @pytest.mark.parametrize('dtype_input', types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    @pytest.mark.parametrize('mode', ['grid-constant', 'constant'])
    def test_correlate_complex_kernel_cval(self, dtype_input, dtype_kernel,
                                           dtype_output, mode, xp,
                                           num_parallel_threads):
        dtype_input = getattr(xp, dtype_input)
        dtype_kernel = getattr(xp, dtype_kernel)
        dtype_output = getattr(xp, dtype_output)

        if is_cupy(xp) and mode == 'grid-constant':
            pytest.xfail('cupy/cupy#8404')

        # test use of non-zero cval with complex inputs
        # also verifies that mode 'grid-constant' does not segfault
        kernel = xp.asarray([[1, 0],
                             [0, 1 + 1j]], dtype=dtype_kernel)
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype_input)
        self._validate_complex(xp, array, kernel, dtype_output, mode=mode,
                               cval=5.0,
                               check_warnings=num_parallel_threads == 1)

    @xfail_xp_backends('cupy', reason="cupy/cupy#8405")
    @pytest.mark.parametrize('dtype_kernel', complex_types)
    @pytest.mark.parametrize('dtype_input', types)
    @pytest.mark.thread_unsafe
    def test_correlate_complex_kernel_invalid_cval(self, dtype_input,
                                                   dtype_kernel, xp):
        dtype_input = getattr(xp, dtype_input)
        dtype_kernel = getattr(xp, dtype_kernel)

        # cannot give complex cval with a real image
        kernel = xp.asarray([[1, 0],
                             [0, 1 + 1j]], dtype=dtype_kernel)
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype_input)
        for func in [ndimage.convolve, ndimage.correlate, ndimage.convolve1d,
                     ndimage.correlate1d]:
            with pytest.raises((ValueError, TypeError)):
                func(array, kernel, mode='constant', cval=5.0 + 1.0j,
                     output=xp.complex64)

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_kernel', complex_types)
    @pytest.mark.parametrize('dtype_input', types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate1d_complex_kernel(self, dtype_input, dtype_kernel,
                                        dtype_output, xp, num_parallel_threads):
        dtype_input = getattr(xp, dtype_input)
        dtype_kernel = getattr(xp, dtype_kernel)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([1, 1 + 1j], dtype=dtype_kernel)
        array = xp.asarray([1, 2, 3, 4, 5, 6], dtype=dtype_input)
        self._validate_complex(xp, array, kernel, dtype_output,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_kernel', complex_types)
    @pytest.mark.parametrize('dtype_input', types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate1d_complex_kernel_cval(self, dtype_input, dtype_kernel,
                                             dtype_output, xp,
                                             num_parallel_threads):
        dtype_input = getattr(xp, dtype_input)
        dtype_kernel = getattr(xp, dtype_kernel)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([1, 1 + 1j], dtype=dtype_kernel)
        array = xp.asarray([1, 2, 3, 4, 5, 6], dtype=dtype_input)
        self._validate_complex(xp, array, kernel, dtype_output, mode='constant',
                               cval=5.0,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_kernel', types)
    @pytest.mark.parametrize('dtype_input', complex_types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate_complex_input(self, dtype_input, dtype_kernel,
                                     dtype_output, xp, num_parallel_threads):
        dtype_input = getattr(xp, dtype_input)
        dtype_kernel = getattr(xp, dtype_kernel)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([[1, 0],
                             [0, 1]], dtype=dtype_kernel)
        array = xp.asarray([[1, 2j, 3],
                            [1 + 4j, 5, 6j]], dtype=dtype_input)
        self._validate_complex(xp, array, kernel, dtype_output,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_kernel', types)
    @pytest.mark.parametrize('dtype_input', complex_types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate1d_complex_input(self, dtype_input, dtype_kernel,
                                       dtype_output, xp, num_parallel_threads):
        dtype_input = getattr(xp, dtype_input)
        dtype_kernel = getattr(xp, dtype_kernel)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([1, 0, 1], dtype=dtype_kernel)
        array = xp.asarray([1, 2j, 3, 1 + 4j, 5, 6j], dtype=dtype_input)
        self._validate_complex(xp, array, kernel, dtype_output,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @xfail_xp_backends("cupy", reason="cupy/cupy#8405")
    @pytest.mark.parametrize('dtype_kernel', types)
    @pytest.mark.parametrize('dtype_input', complex_types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate1d_complex_input_cval(self, dtype_input, dtype_kernel,
                                            dtype_output, xp,
                                            num_parallel_threads):
        dtype_input = getattr(xp, dtype_input)
        dtype_kernel = getattr(xp, dtype_kernel)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([1, 0, 1], dtype=dtype_kernel)
        array = xp.asarray([1, 2j, 3, 1 + 4j, 5, 6j], dtype=dtype_input)
        self._validate_complex(xp, array, kernel, dtype_output, mode='constant',
                               cval=5 - 3j,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @xfail_xp_backends("cupy", reason="unhashable type: 'ndarray'")
    @pytest.mark.parametrize('dtype', complex_types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate_complex_input_and_kernel(self, dtype, dtype_output, xp,
                                                num_parallel_threads):
        dtype = getattr(xp, dtype)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([[1, 0],
                             [0, 1 + 1j]], dtype=dtype)
        array = xp.asarray([[1, 2j, 3],
                            [1 + 4j, 5, 6j]], dtype=dtype)
        self._validate_complex(xp, array, kernel, dtype_output,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @xfail_xp_backends("cupy", reason="cupy/cupy#8405")
    @pytest.mark.parametrize('dtype', complex_types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate_complex_input_and_kernel_cval(self, dtype,
                                                     dtype_output, xp,
                                                     num_parallel_threads):
        dtype = getattr(xp, dtype)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([[1, 0],
                             [0, 1 + 1j]], dtype=dtype)
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6]], dtype=dtype)
        self._validate_complex(xp, array, kernel, dtype_output, mode='constant',
                               cval=5.0 + 2.0j,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @xfail_xp_backends("cupy", reason="unhashable type: 'ndarray'")
    @pytest.mark.parametrize('dtype', complex_types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    @pytest.mark.thread_unsafe
    def test_correlate1d_complex_input_and_kernel(self, dtype, dtype_output, xp,
                                                  num_parallel_threads):
        dtype = getattr(xp, dtype)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([1, 1 + 1j], dtype=dtype)
        array = xp.asarray([1, 2j, 3, 1 + 4j, 5, 6j], dtype=dtype)
        self._validate_complex(xp, array, kernel, dtype_output,
                               check_warnings=num_parallel_threads == 1)

    @uses_output_dtype
    @xfail_xp_backends("cupy", reason="cupy/cupy#8405")
    @pytest.mark.parametrize('dtype', complex_types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_correlate1d_complex_input_and_kernel_cval(self, dtype,
                                                       dtype_output, xp,
                                                       num_parallel_threads):

        dtype = getattr(xp, dtype)
        dtype_output = getattr(xp, dtype_output)

        kernel = xp.asarray([1, 1 + 1j], dtype=dtype)
        array = xp.asarray([1, 2j, 3, 1 + 4j, 5, 6j], dtype=dtype)
        self._validate_complex(xp, array, kernel, dtype_output, mode='constant',
                               cval=5.0 + 2.0j,
                               check_warnings=num_parallel_threads == 1)

    def test_gauss01(self, xp):
        input = xp.asarray([[1, 2, 3],
                            [2, 4, 6]], dtype=xp.float32)
        output = ndimage.gaussian_filter(input, 0)
        assert_array_almost_equal(output, input)

    def test_gauss02(self, xp):
        input = xp.asarray([[1, 2, 3],
                            [2, 4, 6]], dtype=xp.float32)
        output = ndimage.gaussian_filter(input, 1.0)
        assert input.dtype == output.dtype
        assert input.shape == output.shape

    @xfail_xp_backends("cupy", reason="cupy/cupy#8403")
    def test_gauss03(self, xp):
        # single precision data
        input = xp.arange(100 * 100, dtype=xp.float32)
        input = xp.reshape(input, (100, 100))
        output = ndimage.gaussian_filter(input, [1.0, 1.0])

        assert input.dtype == output.dtype
        assert input.shape == output.shape

        # input.sum() is 49995000.0.  With single precision floats, we can't
        # expect more than 8 digits of accuracy, so use decimal=0 in this test.
        o_sum = xp.sum(output, dtype=xp.float64)
        i_sum = xp.sum(input, dtype=xp.float64)
        assert_almost_equal(o_sum, i_sum, decimal=0)
        assert sumsq(input, output) > 1.0

    @uses_output_dtype
    def test_gauss04(self, xp):
        input = xp.arange(100 * 100, dtype=xp.float32)
        input = xp.reshape(input, (100, 100))
        otype = xp.float64
        output = ndimage.gaussian_filter(input, [1.0, 1.0], output=otype)
        assert output.dtype.type == xp.float64
        assert input.shape == output.shape
        assert sumsq(input, output) > 1.0

    @uses_output_dtype
    def test_gauss05(self, xp):
        input = xp.arange(100 * 100, dtype=xp.float32)
        input = xp.reshape(input, (100, 100))
        otype = xp.float64
        output = ndimage.gaussian_filter(input, [1.0, 1.0],
                                         order=1, output=otype)
        assert output.dtype.type == xp.float64
        assert input.shape == output.shape
        assert sumsq(input, output) > 1.0

    @uses_output_dtype
    def test_gauss06(self, xp):
        input = xp.arange(100 * 100, dtype=xp.float32)
        input = xp.reshape(input, (100, 100))
        otype = xp.float64
        output1 = ndimage.gaussian_filter(input, [1.0, 1.0], output=otype)
        output2 = ndimage.gaussian_filter(input, 1.0, output=otype)
        assert_array_almost_equal(output1, output2)

    @uses_output_array
    def test_gauss_memory_overlap(self, xp):
        input = xp.arange(100 * 100, dtype=xp.float32)
        input = xp.reshape(input, (100, 100))
        output1 = ndimage.gaussian_filter(input, 1.0)
        ndimage.gaussian_filter(input, 1.0, output=input)
        assert_array_almost_equal(output1, input)

    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8339")
    @pytest.mark.parametrize(('filter_func', 'extra_args', 'size0', 'size'),
                             [(ndimage.gaussian_filter, (), 0, 1.0),
                              (ndimage.uniform_filter, (), 1, 3),
                              (ndimage.minimum_filter, (), 1, 3),
                              (ndimage.maximum_filter, (), 1, 3),
                              (ndimage.median_filter, (), 1, 3),
                              (ndimage.rank_filter, (1,), 1, 3),
                              (ndimage.percentile_filter, (40,), 1, 3)])
    @pytest.mark.parametrize(
        'axes',
        tuple(itertools.combinations(range(-3, 3), 1))
        + tuple(itertools.combinations(range(-3, 3), 2))
        + ((0, 1, 2),))
    def test_filter_axes(self, filter_func, extra_args, size0, size, axes, xp):
        # Note: `size` is called `sigma` in `gaussian_filter`
        array = xp.arange(6 * 8 * 12, dtype=xp.float64)
        array = xp.reshape(array, (6, 8, 12))

        if len(set(ax % array.ndim for ax in axes)) != len(axes):
            # parametrized cases with duplicate axes raise an error
            with pytest.raises(ValueError, match="axes must be unique"):
                filter_func(array, *extra_args, size, axes=axes)
            return
        output = filter_func(array, *extra_args, size, axes=axes)

        # result should be equivalent to sigma=0.0/size=1 on unfiltered axes
        axes = xp.asarray(axes)
        all_sizes = tuple(size if ax in (axes % array.ndim) else size0
                          for ax in range(array.ndim))
        expected = filter_func(array, *extra_args, all_sizes)
        xp_assert_close(output, expected)

    @skip_xp_backends("cupy",
                      reason="these filters do not yet have axes support")
    @pytest.mark.parametrize(('filter_func', 'kwargs'),
                             [(ndimage.laplace, {}),
                              (ndimage.gaussian_gradient_magnitude,
                               {"sigma": 1.0}),
                              (ndimage.gaussian_laplace, {"sigma": 0.5})])
    def test_derivative_filter_axes(self, xp, filter_func, kwargs):
        array = xp.arange(6 * 8 * 12, dtype=xp.float64)
        array = xp.reshape(array, (6, 8, 12))

        # duplicate axes raises an error
        with pytest.raises(ValueError, match="axes must be unique"):
            filter_func(array, axes=(1, 1), **kwargs)

        # compare results to manually looping over the non-filtered axes
        output = filter_func(array, axes=(1, 2), **kwargs)
        expected = xp.empty_like(output)
        expected = []
        for i in range(array.shape[0]):
            expected.append(filter_func(array[i, ...], **kwargs))
        expected = xp.stack(expected, axis=0)
        xp_assert_close(output, expected)

        output = filter_func(array, axes=(0, -1), **kwargs)
        expected = []
        for i in range(array.shape[1]):
            expected.append(filter_func(array[:, i, :], **kwargs))
        expected = xp.stack(expected, axis=1)
        xp_assert_close(output, expected)

        output = filter_func(array, axes=(1), **kwargs)
        expected = []
        for i in range(array.shape[0]):
            exp_inner = []
            for j in range(array.shape[2]):
                exp_inner.append(filter_func(array[i, :, j], **kwargs))
            expected.append(xp.stack(exp_inner, axis=-1))
        expected = xp.stack(expected, axis=0)
        xp_assert_close(output, expected)

    @skip_xp_backends("cupy",
                      reason="generic_filter does not yet have axes support")
    @pytest.mark.parametrize(
        'axes',
        tuple(itertools.combinations(range(-3, 3), 1))
        + tuple(itertools.combinations(range(-3, 3), 2))
        + ((0, 1, 2),))
    def test_generic_filter_axes(self, xp, axes):
        array = xp.arange(6 * 8 * 12, dtype=xp.float64)
        array = xp.reshape(array, (6, 8, 12))
        size = 3
        if len(set(ax % array.ndim for ax in axes)) != len(axes):
            # parametrized cases with duplicate axes raise an error
            with pytest.raises(ValueError, match="axes must be unique"):
                ndimage.generic_filter(array, np.amax, size=size, axes=axes)
            return

        # choose np.amax as the function so we can compare to maximum_filter
        output = ndimage.generic_filter(array, np.amax, size=size, axes=axes)
        expected = ndimage.maximum_filter(array, size=size, axes=axes)
        xp_assert_close(output, expected)

    @skip_xp_backends("cupy",
                      reason="https://github.com/cupy/cupy/pull/8339")
    @pytest.mark.parametrize('func', [ndimage.correlate, ndimage.convolve])
    @pytest.mark.parametrize(
        'dtype', [np.float32, np.float64, np.complex64, np.complex128]
    )
    @pytest.mark.parametrize(
        'axes', tuple(itertools.combinations(range(-3, 3), 2))
    )
    @pytest.mark.parametrize('origin', [(0, 0), (-1, 1)])
    def test_correlate_convolve_axes(self, xp, func, dtype, axes, origin):
        array = xp.asarray(np.arange(6 * 8 * 12, dtype=dtype).reshape(6, 8, 12))
        weights = xp.arange(3 * 5)
        weights = xp.reshape(weights, (3, 5))
        axes = tuple(ax % array.ndim for ax in axes)
        if len(tuple(set(axes))) != len(axes):
            # parametrized cases with duplicate axes raise an error
            with pytest.raises(ValueError):
                func(array, weights=weights, axes=axes, origin=origin)
            return
        output = func(array, weights=weights, axes=axes, origin=origin)

        missing_axis = tuple(set(range(3)) - set(axes))[0]
        # module 'torch' has no attribute 'expand_dims' so use reshape instead
        #    weights_3d = xp.expand_dims(weights, axis=missing_axis)
        shape_3d = (
            weights.shape[:missing_axis] + (1,) + weights.shape[missing_axis:]
        )
        weights_3d = xp.reshape(weights, shape_3d)
        origin_3d = [0, 0, 0]
        for i, ax in enumerate(axes):
            origin_3d[ax] = origin[i]
        expected = func(array, weights=weights_3d, origin=origin_3d)
        xp_assert_close(output, expected)

    kwargs_gauss = dict(radius=[4, 2, 3], order=[0, 1, 2],
                        mode=['reflect', 'nearest', 'constant'])
    kwargs_other = dict(origin=(-1, 0, 1),
                        mode=['reflect', 'nearest', 'constant'])
    kwargs_rank = dict(origin=(-1, 0, 1))

    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8339")
    @pytest.mark.parametrize("filter_func, size0, size, kwargs",
                             [(ndimage.gaussian_filter, 0, 1.0, kwargs_gauss),
                              (ndimage.uniform_filter, 1, 3, kwargs_other),
                              (ndimage.maximum_filter, 1, 3, kwargs_other),
                              (ndimage.minimum_filter, 1, 3, kwargs_other),
                              (ndimage.median_filter, 1, 3, kwargs_rank),
                              (ndimage.rank_filter, 1, 3, kwargs_rank),
                              (ndimage.percentile_filter, 1, 3, kwargs_rank)])
    @pytest.mark.parametrize('axes', itertools.combinations(range(-3, 3), 2))
    def test_filter_axes_kwargs(self, filter_func, size0, size, kwargs, axes, xp):
        array = xp.arange(6 * 8 * 12, dtype=xp.float64)
        array = xp.reshape(array, (6, 8, 12))

        kwargs = {key: np.array(val) for key, val in kwargs.items()}
        axes = np.array(axes)
        n_axes = axes.size

        if filter_func == ndimage.rank_filter:
            args = (2,)  # (rank,)
        elif filter_func == ndimage.percentile_filter:
            args = (30,)  # (percentile,)
        else:
            args = ()

        # form kwargs that specify only the axes in `axes`
        reduced_kwargs = {key: val[axes] for key, val in kwargs.items()}
        if len(set(axes % array.ndim)) != len(axes):
            # parametrized cases with duplicate axes raise an error
            with pytest.raises(ValueError, match="axes must be unique"):
                filter_func(array, *args, [size]*n_axes, axes=axes,
                            **reduced_kwargs)
            return

        output = filter_func(array, *args, [size]*n_axes, axes=axes,
                             **reduced_kwargs)

        # result should be equivalent to sigma=0.0/size=1 on unfiltered axes
        size_3d = np.full(array.ndim, fill_value=size0)
        size_3d[axes] = size
        size_3d = [size_3d[i] for i in range(size_3d.shape[0])]
        if 'origin' in kwargs:
            # origin should be zero on the axis that has size 0
            origin = np.asarray([0, 0, 0])
            origin[axes] = reduced_kwargs['origin']
            origin = xp.asarray(origin)
            kwargs['origin'] = origin
        expected = filter_func(array, *args, size_3d, **kwargs)
        xp_assert_close(output, expected)


    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8339")
    @pytest.mark.parametrize("filter_func, kwargs",
                             [(ndimage.convolve, {}),
                              (ndimage.correlate, {}),
                              (ndimage.minimum_filter, {}),
                              (ndimage.maximum_filter, {}),
                              (ndimage.median_filter, {}),
                              (ndimage.rank_filter, {"rank": 1}),
                              (ndimage.percentile_filter, {"percentile": 30})])
    def test_filter_weights_subset_axes_origins(self, filter_func, kwargs, xp):
        axes = (-2, -1)
        origins = (0, 1)
        array = xp.arange(6 * 8 * 12, dtype=xp.float64)
        array = xp.reshape(array, (6, 8, 12))

        # weights with ndim matching len(axes)
        footprint = np.ones((3, 5), dtype=bool)
        footprint[0, 1] = 0  # make non-separable
        footprint = xp.asarray(footprint)

        if filter_func in (ndimage.convolve, ndimage.correlate):
            kwargs["weights"] = footprint
        else:
            kwargs["footprint"] = footprint
        kwargs["axes"] = axes

        output = filter_func(array, origin=origins, **kwargs)

        output0 = filter_func(array, origin=0, **kwargs)

        # output has origin shift on last axis relative to output0, so
        # expect shifted arrays to be equal.
        if filter_func == ndimage.convolve:
            # shift is in the opposite direction for convolve because it
            # flips the weights array and negates the origin values.
            xp_assert_equal(
                output[:, :, :-origins[1]], output0[:, :, origins[1]:])
        else:
            xp_assert_equal(
                output[:, :, origins[1]:], output0[:, :, :-origins[1]])


    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8339")
    @pytest.mark.parametrize(
        'filter_func, args',
        [(ndimage.convolve, (np.ones((3, 3, 3)),)),  # args = (weights,)
         (ndimage.correlate,(np.ones((3, 3, 3)),)),  # args = (weights,)
         (ndimage.gaussian_filter, (1.0,)),      # args = (sigma,)
         (ndimage.uniform_filter, (3,)),         # args = (size,)
         (ndimage.minimum_filter, (3,)),         # args = (size,)
         (ndimage.maximum_filter, (3,)),         # args = (size,)
         (ndimage.median_filter, (3,)),          # args = (size,)
         (ndimage.rank_filter, (2, 3)),          # args = (rank, size)
         (ndimage.percentile_filter, (30, 3))])  # args = (percentile, size)
    @pytest.mark.parametrize(
        'axes', [(1.5,), (0, 1, 2, 3), (3,), (-4,)]
    )
    def test_filter_invalid_axes(self, filter_func, args, axes, xp):
        array = xp.arange(6 * 8 * 12, dtype=xp.float64)
        array = xp.reshape(array, (6, 8, 12))
        args = [
            xp.asarray(arg) if isinstance(arg, np.ndarray) else arg
            for arg in args
        ]
        if any(isinstance(ax, float) for ax in axes):
            error_class = TypeError
            match = "cannot be interpreted as an integer"
        else:
            error_class = ValueError
            match = "out of range"
        with pytest.raises(error_class, match=match):
            filter_func(array, *args, axes=axes)

    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8339")
    @pytest.mark.parametrize(
        'filter_func, kwargs',
        [(ndimage.convolve, {}),
         (ndimage.correlate, {}),
         (ndimage.minimum_filter, {}),
         (ndimage.maximum_filter, {}),
         (ndimage.median_filter, {}),
         (ndimage.rank_filter, dict(rank=3)),
         (ndimage.percentile_filter, dict(percentile=30))])
    @pytest.mark.parametrize(
        'axes', [(0, ), (1, 2), (0, 1, 2)]
    )
    @pytest.mark.parametrize('separable_footprint', [False, True])
    def test_filter_invalid_footprint_ndim(self, filter_func, kwargs, axes,
                                           separable_footprint, xp):
        array = xp.arange(6 * 8 * 12, dtype=xp.float64)
        array = xp.reshape(array, (6, 8, 12))
        # create a footprint with one too many dimensions
        footprint = np.ones((3,) * (len(axes) + 1))
        if not separable_footprint:
            footprint[(0,) * footprint.ndim] = 0
        footprint = xp.asarray(footprint)
        if (filter_func in [ndimage.minimum_filter, ndimage.maximum_filter]
            and separable_footprint):
            match = "sequence argument must have length equal to input rank"
        elif filter_func in [ndimage.convolve, ndimage.correlate]:
            match = re.escape(f"weights.ndim ({footprint.ndim}) must match "
                              f"len(axes) ({len(axes)})")
        else:
            match = re.escape(f"footprint.ndim ({footprint.ndim}) must match "
                              f"len(axes) ({len(axes)})")
        if filter_func in [ndimage.convolve, ndimage.correlate]:
            kwargs["weights"] = footprint
        else:
            kwargs["footprint"] = footprint
        with pytest.raises(RuntimeError, match=match):
            filter_func(array, axes=axes, **kwargs)

    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8339")
    @pytest.mark.parametrize('n_mismatch', [1, 3])
    @pytest.mark.parametrize('filter_func, kwargs, key, val',
                             _cases_axes_tuple_length_mismatch())
    def test_filter_tuple_length_mismatch(self, n_mismatch, filter_func,
                                          kwargs, key, val, xp):
        # Test for the intended RuntimeError when a kwargs has an invalid size
        array = xp.arange(6 * 8 * 12, dtype=xp.float64)
        array = xp.reshape(array, (6, 8, 12))
        axes = (0, 1)
        kwargs = dict(**kwargs, axes=axes)
        kwargs[key] = (val,) * n_mismatch
        if filter_func in [ndimage.convolve, ndimage.correlate]:
            kwargs["weights"] = xp.ones((5,) * len(axes))
        err_msg = "sequence argument must have length equal to input rank"
        with pytest.raises(RuntimeError, match=err_msg):
            filter_func(array, **kwargs)

    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_prewitt01(self, dtype, xp):
        dtype = getattr(xp, dtype)
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        t = ndimage.correlate1d(array, xp.asarray([-1.0, 0.0, 1.0]), 0)
        t = ndimage.correlate1d(t, xp.asarray([1.0, 1.0, 1.0]), 1)
        output = ndimage.prewitt(array, 0)
        assert_array_almost_equal(t, output)

    @uses_output_array
    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_prewitt02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        t = ndimage.correlate1d(array, xp.asarray([-1.0, 0.0, 1.0]), 0)
        t = ndimage.correlate1d(t, xp.asarray([1.0, 1.0, 1.0]), 1)
        output = xp.zeros(array.shape, dtype=dtype)
        ndimage.prewitt(array, 0, output)
        assert_array_almost_equal(t, output)

    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_prewitt03(self, dtype, xp):
        dtype = getattr(xp, dtype)
        if is_cupy(xp) and dtype in [xp.uint32, xp.uint64]:
            pytest.xfail("uint UB? XXX")

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        t = ndimage.correlate1d(array, xp.asarray([-1.0, 0.0, 1.0]), 1)
        t = ndimage.correlate1d(t, xp.asarray([1.0, 1.0, 1.0]), 0)
        output = ndimage.prewitt(array, 1)
        assert_array_almost_equal(t, output)

    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_prewitt04(self, dtype, xp):
        dtype = getattr(xp, dtype)
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        t = ndimage.prewitt(array, -1)
        output = ndimage.prewitt(array, 1)
        assert_array_almost_equal(t, output)

    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_sobel01(self, dtype, xp):
        dtype = getattr(xp, dtype)
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        t = ndimage.correlate1d(array, xp.asarray([-1.0, 0.0, 1.0]), 0)
        t = ndimage.correlate1d(t, xp.asarray([1.0, 2.0, 1.0]), 1)
        output = ndimage.sobel(array, 0)
        assert_array_almost_equal(t, output)

    @uses_output_array
    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_sobel02(self, dtype, xp):
        dtype = getattr(xp, dtype)
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        t = ndimage.correlate1d(array, xp.asarray([-1.0, 0.0, 1.0]), 0)
        t = ndimage.correlate1d(t, xp.asarray([1.0, 2.0, 1.0]), 1)
        output = xp.zeros(array.shape, dtype=dtype)
        ndimage.sobel(array, 0, output)
        assert_array_almost_equal(t, output)

    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_sobel03(self, dtype, xp):
        if is_cupy(xp) and dtype in ["uint32", "uint64"]:
            pytest.xfail("uint UB? XXX")

        dtype = getattr(xp, dtype)
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        t = ndimage.correlate1d(array, xp.asarray([-1.0, 0.0, 1.0]), 1)
        t = ndimage.correlate1d(t, xp.asarray([1.0, 2.0, 1.0]), 0)
        output = xp.zeros(array.shape, dtype=dtype)
        output = ndimage.sobel(array, 1)
        assert_array_almost_equal(t, output)

    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_sobel04(self, dtype, xp):
        dtype = getattr(xp, dtype)
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        t = ndimage.sobel(array, -1)
        output = ndimage.sobel(array, 1)
        assert_array_almost_equal(t, output)

    @pytest.mark.parametrize('dtype',
                             ["int32", "float32", "float64",
                              "complex64", "complex128"])
    def test_laplace01(self, dtype, xp):
        dtype = getattr(xp, dtype)

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype) * 100
        tmp1 = ndimage.correlate1d(array, xp.asarray([1, -2, 1]), 0)
        tmp2 = ndimage.correlate1d(array, xp.asarray([1, -2, 1]), 1)
        output = ndimage.laplace(array)
        assert_array_almost_equal(tmp1 + tmp2, output)

    @uses_output_array
    @pytest.mark.parametrize('dtype',
                             ["int32", "float32", "float64",
                              "complex64", "complex128"])
    def test_laplace02(self, dtype, xp):
        dtype = getattr(xp, dtype)

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype) * 100
        tmp1 = ndimage.correlate1d(array, xp.asarray([1, -2, 1]), 0)
        tmp2 = ndimage.correlate1d(array, xp.asarray([1, -2, 1]), 1)
        output = xp.zeros(array.shape, dtype=dtype)
        ndimage.laplace(array, output=output)
        assert_array_almost_equal(tmp1 + tmp2, output)

    @pytest.mark.parametrize('dtype',
                             ["int32", "float32", "float64",
                              "complex64", "complex128"])
    def test_gaussian_laplace01(self, dtype, xp):
        dtype = getattr(xp, dtype)

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype) * 100
        tmp1 = ndimage.gaussian_filter(array, 1.0, [2, 0])
        tmp2 = ndimage.gaussian_filter(array, 1.0, [0, 2])
        output = ndimage.gaussian_laplace(array, 1.0)
        assert_array_almost_equal(tmp1 + tmp2, output)

    @uses_output_array
    @pytest.mark.parametrize('dtype',
                             ["int32", "float32", "float64",
                              "complex64", "complex128"])
    def test_gaussian_laplace02(self, dtype, xp):
        dtype = getattr(xp, dtype)

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype) * 100
        tmp1 = ndimage.gaussian_filter(array, 1.0, [2, 0])
        tmp2 = ndimage.gaussian_filter(array, 1.0, [0, 2])
        output = xp.zeros(array.shape, dtype=dtype)
        ndimage.gaussian_laplace(array, 1.0, output)
        assert_array_almost_equal(tmp1 + tmp2, output)

    @uses_output_array
    @pytest.mark.parametrize('dtype', types + complex_types)
    def test_generic_laplace01(self, dtype, xp):
        def derivative2(input, axis, output, mode, cval, a, b):
            sigma = np.asarray([a, b / 2.0])
            order = [0] * input.ndim
            order[axis] = 2
            return ndimage.gaussian_filter(input, sigma, order,
                                           output, mode, cval)

        dtype = getattr(xp, dtype)

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        output = xp.zeros(array.shape, dtype=dtype)
        tmp = ndimage.generic_laplace(array, derivative2,
                                      extra_arguments=(1.0,),
                                      extra_keywords={'b': 2.0})
        ndimage.gaussian_laplace(array, 1.0, output)
        assert_array_almost_equal(tmp, output)

    @pytest.mark.parametrize('dtype',
                             ["int32", "float32", "float64",
                              "complex64", "complex128"])
    def test_gaussian_gradient_magnitude01(self, dtype, xp):
        is_int_dtype = dtype == "int32"
        dtype = getattr(xp, dtype)

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype) * 100
        tmp1 = ndimage.gaussian_filter(array, 1.0, [1, 0])
        tmp2 = ndimage.gaussian_filter(array, 1.0, [0, 1])
        output = ndimage.gaussian_gradient_magnitude(array, 1.0)
        expected = tmp1 * tmp1 + tmp2 * tmp2

        expected_float = xp.astype(expected, xp.float64) if is_int_dtype else expected
        expected = xp.astype(xp.sqrt(expected_float), dtype)
        xp_assert_close(output, expected, rtol=1e-6, atol=1e-6)

    @uses_output_array
    @pytest.mark.parametrize('dtype',
                             ["int32", "float32", "float64",
                              "complex64", "complex128"])
    def test_gaussian_gradient_magnitude02(self, dtype, xp):
        is_int_dtype = dtype == 'int32'
        dtype = getattr(xp, dtype)

        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype) * 100
        tmp1 = ndimage.gaussian_filter(array, 1.0, [1, 0])
        tmp2 = ndimage.gaussian_filter(array, 1.0, [0, 1])
        output = xp.zeros(array.shape, dtype=dtype)
        ndimage.gaussian_gradient_magnitude(array, 1.0, output)
        expected = tmp1 * tmp1 + tmp2 * tmp2

        fl_expected = xp.astype(expected, xp.float64) if is_int_dtype else expected

        expected = xp.astype(xp.sqrt(fl_expected), dtype)
        xp_assert_close(output, expected, rtol=1e-6, atol=1e-6)

    def test_generic_gradient_magnitude01(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=xp.float64)

        def derivative(input, axis, output, mode, cval, a, b):
            sigma = [a, b / 2.0]
            order = [0] * input.ndim
            order[axis] = 1
            return ndimage.gaussian_filter(input, sigma, order, output, mode, cval)

        tmp1 = ndimage.gaussian_gradient_magnitude(array, 1.0)
        tmp2 = ndimage.generic_gradient_magnitude(
            array, derivative, extra_arguments=(1.0,),
            extra_keywords={'b': 2.0})
        assert_array_almost_equal(tmp1, tmp2)

    def test_uniform01(self, xp):
        array = xp.asarray([2, 4, 6])
        size = 2
        output = ndimage.uniform_filter1d(array, size, origin=-1)
        assert_array_almost_equal(xp.asarray([3, 5, 6]), output)

    def test_uniform01_complex(self, xp):
        array = xp.asarray([2 + 1j, 4 + 2j, 6 + 3j], dtype=xp.complex128)
        size = 2
        output = ndimage.uniform_filter1d(array, size, origin=-1)
        assert_array_almost_equal(xp.real(output), xp.asarray([3., 5, 6]))
        assert_array_almost_equal(xp.imag(output), xp.asarray([1.5, 2.5, 3]))

    def test_uniform02(self, xp):
        array = xp.asarray([1, 2, 3])
        filter_shape = [0]
        output = ndimage.uniform_filter(array, filter_shape)
        assert_array_almost_equal(array, output)

    def test_uniform03(self, xp):
        array = xp.asarray([1, 2, 3])
        filter_shape = [1]
        output = ndimage.uniform_filter(array, filter_shape)
        assert_array_almost_equal(array, output)

    def test_uniform04(self, xp):
        array = xp.asarray([2, 4, 6])
        filter_shape = [2]
        output = ndimage.uniform_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([2, 3, 5]), output)

    def test_uniform05(self, xp):
        array = xp.asarray([])
        filter_shape = [1]
        output = ndimage.uniform_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([]), output)

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_array', types)
    @pytest.mark.parametrize('dtype_output', types)
    def test_uniform06(self, dtype_array, dtype_output, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_output = getattr(xp, dtype_output)

        filter_shape = [2, 2]
        array = xp.asarray([[4, 8, 12],
                            [16, 20, 24]], dtype=dtype_array)
        output = ndimage.uniform_filter(
            array, filter_shape, output=dtype_output)
        assert_array_almost_equal(xp.asarray([[4, 6, 10], [10, 12, 16]]), output)
        assert output.dtype.type == dtype_output

    @uses_output_dtype
    @pytest.mark.parametrize('dtype_array', complex_types)
    @pytest.mark.parametrize('dtype_output', complex_types)
    def test_uniform06_complex(self, dtype_array, dtype_output, xp):
        dtype_array = getattr(xp, dtype_array)
        dtype_output = getattr(xp, dtype_output)

        filter_shape = [2, 2]
        array = xp.asarray([[4, 8 + 5j, 12],
                            [16, 20, 24]], dtype=dtype_array)
        output = ndimage.uniform_filter(
            array, filter_shape, output=dtype_output)
        assert_array_almost_equal(xp.asarray([[4, 6, 10], [10, 12, 16]]), output.real)
        assert output.dtype.type == dtype_output

    def test_minimum_filter01(self, xp):
        array = xp.asarray([1, 2, 3, 4, 5])
        filter_shape = xp.asarray([2])
        output = ndimage.minimum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([1, 1, 2, 3, 4]), output)

    def test_minimum_filter02(self, xp):
        array = xp.asarray([1, 2, 3, 4, 5])
        filter_shape = xp.asarray([3])
        output = ndimage.minimum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([1, 1, 2, 3, 4]), output)

    def test_minimum_filter03(self, xp):
        array = xp.asarray([3, 2, 5, 1, 4])
        filter_shape = xp.asarray([2])
        output = ndimage.minimum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([3, 2, 2, 1, 1]), output)

    def test_minimum_filter04(self, xp):
        array = xp.asarray([3, 2, 5, 1, 4])
        filter_shape = xp.asarray([3])
        output = ndimage.minimum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([2, 2, 1, 1, 1]), output)

    def test_minimum_filter05(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        filter_shape = xp.asarray([2, 3])
        output = ndimage.minimum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([[2, 2, 1, 1, 1],
                                              [2, 2, 1, 1, 1],
                                              [5, 3, 3, 1, 1]]), output)

    @uses_output_array
    def test_minimum_filter05_overlap(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        filter_shape = xp.asarray([2, 3])
        ndimage.minimum_filter(array, filter_shape, output=array)
        assert_array_almost_equal(xp.asarray([[2, 2, 1, 1, 1],
                                              [2, 2, 1, 1, 1],
                                              [5, 3, 3, 1, 1]]), array)

    def test_minimum_filter06(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 1, 1], [1, 1, 1]])
        output = ndimage.minimum_filter(array, footprint=footprint)
        assert_array_almost_equal(xp.asarray([[2, 2, 1, 1, 1],
                                              [2, 2, 1, 1, 1],
                                              [5, 3, 3, 1, 1]]), output)
        # separable footprint should allow mode sequence
        output2 = ndimage.minimum_filter(array, footprint=footprint,
                                         mode=['reflect', 'reflect'])
        assert_array_almost_equal(output2, output)

    def test_minimum_filter07(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.minimum_filter(array, footprint=footprint)
        assert_array_almost_equal(xp.asarray([[2, 2, 1, 1, 1],
                                              [2, 3, 1, 3, 1],
                                              [5, 5, 3, 3, 1]]), output)
        with assert_raises(RuntimeError):
            ndimage.minimum_filter(array, footprint=footprint,
                                   mode=['reflect', 'constant'])

    def test_minimum_filter08(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.minimum_filter(array, footprint=footprint, origin=-1)
        assert_array_almost_equal(xp.asarray([[3, 1, 3, 1, 1],
                                              [5, 3, 3, 1, 1],
                                              [3, 3, 1, 1, 1]]), output)

    def test_minimum_filter09(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.minimum_filter(array, footprint=footprint,
                                        origin=[-1, 0])
        assert_array_almost_equal(xp.asarray([[2, 3, 1, 3, 1],
                                              [5, 5, 3, 3, 1],
                                              [5, 3, 3, 1, 1]]), output)

    def test_maximum_filter01(self, xp):
        array = xp.asarray([1, 2, 3, 4, 5])
        filter_shape = xp.asarray([2])
        output = ndimage.maximum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([1, 2, 3, 4, 5]), output)

    def test_maximum_filter02(self, xp):
        array = xp.asarray([1, 2, 3, 4, 5])
        filter_shape = xp.asarray([3])
        output = ndimage.maximum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([2, 3, 4, 5, 5]), output)

    def test_maximum_filter03(self, xp):
        array = xp.asarray([3, 2, 5, 1, 4])
        filter_shape = xp.asarray([2])
        output = ndimage.maximum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([3, 3, 5, 5, 4]), output)

    def test_maximum_filter04(self, xp):
        array = xp.asarray([3, 2, 5, 1, 4])
        filter_shape = xp.asarray([3])
        output = ndimage.maximum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([3, 5, 5, 5, 4]), output)

    def test_maximum_filter05(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        filter_shape = xp.asarray([2, 3])
        output = ndimage.maximum_filter(array, filter_shape)
        assert_array_almost_equal(xp.asarray([[3, 5, 5, 5, 4],
                                              [7, 9, 9, 9, 5],
                                              [8, 9, 9, 9, 7]]), output)

    def test_maximum_filter06(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 1, 1], [1, 1, 1]])
        output = ndimage.maximum_filter(array, footprint=footprint)
        assert_array_almost_equal(xp.asarray([[3, 5, 5, 5, 4],
                                              [7, 9, 9, 9, 5],
                                              [8, 9, 9, 9, 7]]), output)
        # separable footprint should allow mode sequence
        output2 = ndimage.maximum_filter(array, footprint=footprint,
                                         mode=['reflect', 'reflect'])
        assert_array_almost_equal(output2, output)

    def test_maximum_filter07(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.maximum_filter(array, footprint=footprint)
        assert_array_almost_equal(xp.asarray([[3, 5, 5, 5, 4],
                                              [7, 7, 9, 9, 5],
                                              [7, 9, 8, 9, 7]]), output)
        # non-separable footprint should not allow mode sequence
        with assert_raises(RuntimeError):
            ndimage.maximum_filter(array, footprint=footprint,
                                   mode=['reflect', 'reflect'])

    def test_maximum_filter08(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.maximum_filter(array, footprint=footprint, origin=-1)
        assert_array_almost_equal(xp.asarray([[7, 9, 9, 5, 5],
                                              [9, 8, 9, 7, 5],
                                              [8, 8, 7, 7, 7]]), output)

    def test_maximum_filter09(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.maximum_filter(array, footprint=footprint,
                                        origin=[-1, 0])
        assert_array_almost_equal(xp.asarray([[7, 7, 9, 9, 5],
                                              [7, 9, 8, 9, 7],
                                              [8, 8, 8, 7, 7]]), output)

    @xfail_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8339")
    @pytest.mark.parametrize(
        'axes', tuple(itertools.combinations(range(-3, 3), 2))
    )
    @pytest.mark.parametrize(
        'filter_func, kwargs',
        [(ndimage.minimum_filter, {}),
         (ndimage.maximum_filter, {}),
         (ndimage.median_filter, {}),
         (ndimage.rank_filter, dict(rank=3)),
         (ndimage.percentile_filter, dict(percentile=60))]
    )
    def test_minmax_nonseparable_axes(self, filter_func, axes, kwargs, xp):
        array = xp.arange(6 * 8 * 12, dtype=xp.float32)
        array = xp.reshape(array, (6, 8, 12))
        # use 2D triangular footprint because it is non-separable
        footprint = xp.asarray(np.tri(5))
        axes = np.asarray(axes)

        if len(set(axes % array.ndim)) != len(axes):
            # parametrized cases with duplicate axes raise an error
            with pytest.raises(ValueError):
                filter_func(array, footprint=footprint, axes=axes, **kwargs)
            return
        output = filter_func(array, footprint=footprint, axes=axes, **kwargs)

        missing_axis = tuple(set(range(3)) - set(axes % array.ndim))[0]

        footprint_3d = xp.expand_dims(footprint, axis=missing_axis)
        expected = filter_func(array, footprint=footprint_3d, **kwargs)
        xp_assert_close(output, expected)

    def test_rank01(self, xp):
        array = xp.asarray([1, 2, 3, 4, 5])
        output = ndimage.rank_filter(array, 1, size=2)
        xp_assert_equal(array, output)
        output = ndimage.percentile_filter(array, 100, size=2)
        xp_assert_equal(array, output)
        output = ndimage.median_filter(array, 2)
        xp_assert_equal(array, output)

    def test_rank02(self, xp):
        array = xp.asarray([1, 2, 3, 4, 5])
        output = ndimage.rank_filter(array, 1, size=[3])
        xp_assert_equal(array, output)
        output = ndimage.percentile_filter(array, 50, size=3)
        xp_assert_equal(array, output)
        output = ndimage.median_filter(array, (3,))
        xp_assert_equal(array, output)

    def test_rank03(self, xp):
        array = xp.asarray([3, 2, 5, 1, 4])
        output = ndimage.rank_filter(array, 1, size=[2])
        xp_assert_equal(xp.asarray([3, 3, 5, 5, 4]), output)
        output = ndimage.percentile_filter(array, 100, size=2)
        xp_assert_equal(xp.asarray([3, 3, 5, 5, 4]), output)

    def test_rank04(self, xp):
        array = xp.asarray([3, 2, 5, 1, 4])
        expected = xp.asarray([3, 3, 2, 4, 4])
        output = ndimage.rank_filter(array, 1, size=3)
        xp_assert_equal(expected, output)
        output = ndimage.percentile_filter(array, 50, size=3)
        xp_assert_equal(expected, output)
        output = ndimage.median_filter(array, size=3)
        xp_assert_equal(expected, output)

    def test_rank05(self, xp):
        array = xp.asarray([3, 2, 5, 1, 4])
        expected = xp.asarray([3, 3, 2, 4, 4])
        output = ndimage.rank_filter(array, -2, size=3)
        xp_assert_equal(expected, output)

    def test_rank06(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]])
        expected = [[2, 2, 1, 1, 1],
                    [3, 3, 2, 1, 1],
                    [5, 5, 3, 3, 1]]
        expected = xp.asarray(expected)
        output = ndimage.rank_filter(array, 1, size=[2, 3])
        xp_assert_equal(expected, output)
        output = ndimage.percentile_filter(array, 17, size=(2, 3))
        xp_assert_equal(expected, output)

    @xfail_xp_backends("cupy", reason="cupy/cupy#8406")
    @uses_output_array
    def test_rank06_overlap(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]])

        array_copy = xp.asarray(array, copy=True)
        expected = [[2, 2, 1, 1, 1],
                    [3, 3, 2, 1, 1],
                    [5, 5, 3, 3, 1]]
        expected = xp.asarray(expected)
        ndimage.rank_filter(array, 1, size=[2, 3], output=array)
        xp_assert_equal(expected, array)

        ndimage.percentile_filter(array_copy, 17, size=(2, 3),
                                  output=array_copy)
        xp_assert_equal(expected, array_copy)

    def test_rank07(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]])
        expected = [[3, 5, 5, 5, 4],
                    [5, 5, 7, 5, 4],
                    [6, 8, 8, 7, 5]]
        expected = xp.asarray(expected)
        output = ndimage.rank_filter(array, -2, size=[2, 3])
        xp_assert_equal(expected, output)

    def test_rank08(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]])
        expected = [[3, 3, 2, 4, 4],
                    [5, 5, 5, 4, 4],
                    [5, 6, 7, 5, 5]]
        expected = xp.asarray(expected)
        output = ndimage.percentile_filter(array, 50.0, size=(2, 3))
        xp_assert_equal(expected, output)
        output = ndimage.rank_filter(array, 3, size=(2, 3))
        xp_assert_equal(expected, output)
        output = ndimage.median_filter(array, size=(2, 3))
        xp_assert_equal(expected, output)

        # non-separable: does not allow mode sequence
        with assert_raises(RuntimeError):
            ndimage.percentile_filter(array, 50.0, size=(2, 3),
                                      mode=['reflect', 'constant'])
        with assert_raises(RuntimeError):
            ndimage.rank_filter(array, 3, size=(2, 3), mode=['reflect']*2)
        with assert_raises(RuntimeError):
            ndimage.median_filter(array, size=(2, 3), mode=['reflect']*2)

    @pytest.mark.parametrize('dtype', types)
    def test_rank09(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[3, 3, 2, 4, 4],
                    [3, 5, 2, 5, 1],
                    [5, 5, 8, 3, 5]]
        expected = xp.asarray(expected)
        footprint = xp.asarray([[1, 0, 1], [0, 1, 0]])
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        output = ndimage.rank_filter(array, 1, footprint=footprint)
        assert_array_almost_equal(expected, output)
        output = ndimage.percentile_filter(array, 35, footprint=footprint)
        assert_array_almost_equal(expected, output)

    def test_rank10(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        expected = [[2, 2, 1, 1, 1],
                    [2, 3, 1, 3, 1],
                    [5, 5, 3, 3, 1]]
        expected = xp.asarray(expected)
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.rank_filter(array, 0, footprint=footprint)
        xp_assert_equal(expected, output)
        output = ndimage.percentile_filter(array, 0.0, footprint=footprint)
        xp_assert_equal(expected, output)

    def test_rank11(self, xp):
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [7, 6, 9, 3, 5],
                            [5, 8, 3, 7, 1]])
        expected = [[3, 5, 5, 5, 4],
                    [7, 7, 9, 9, 5],
                    [7, 9, 8, 9, 7]]
        expected = xp.asarray(expected)
        footprint = xp.asarray([[1, 0, 1], [1, 1, 0]])
        output = ndimage.rank_filter(array, -1, footprint=footprint)
        xp_assert_equal(expected, output)
        output = ndimage.percentile_filter(array, 100.0, footprint=footprint)
        xp_assert_equal(expected, output)

    @pytest.mark.parametrize('dtype', types)
    def test_rank12(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[3, 3, 2, 4, 4],
                    [3, 5, 2, 5, 1],
                    [5, 5, 8, 3, 5]]
        expected = xp.asarray(expected, dtype=dtype)
        footprint = xp.asarray([[1, 0, 1], [0, 1, 0]])
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        output = ndimage.rank_filter(array, 1, footprint=footprint)
        assert_array_almost_equal(expected, output)
        output = ndimage.percentile_filter(array, 50.0,
                                           footprint=footprint)
        xp_assert_equal(expected, output)
        output = ndimage.median_filter(array, footprint=footprint)
        xp_assert_equal(expected, output)

    @pytest.mark.parametrize('dtype', types)
    def test_rank13(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[5, 2, 5, 1, 1],
                    [5, 8, 3, 5, 5],
                    [6, 6, 5, 5, 5]]
        expected = xp.asarray(expected, dtype=dtype)
        footprint = xp.asarray([[1, 0, 1], [0, 1, 0]])
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        output = ndimage.rank_filter(array, 1, footprint=footprint,
                                     origin=-1)
        xp_assert_equal(expected, output)

    @pytest.mark.parametrize('dtype', types)
    def test_rank14(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[3, 5, 2, 5, 1],
                    [5, 5, 8, 3, 5],
                    [5, 6, 6, 5, 5]]
        expected = xp.asarray(expected, dtype=dtype)
        footprint = xp.asarray([[1, 0, 1], [0, 1, 0]])
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        output = ndimage.rank_filter(array, 1, footprint=footprint,
                                     origin=[-1, 0])
        xp_assert_equal(expected, output)

    @pytest.mark.parametrize('dtype', types)
    def test_rank15(self, dtype, xp):
        dtype = getattr(xp, dtype)
        expected = [[2, 3, 1, 4, 1],
                    [5, 3, 7, 1, 1],
                    [5, 5, 3, 3, 3]]
        expected = xp.asarray(expected, dtype=dtype)
        footprint = xp.asarray([[1, 0, 1], [0, 1, 0]])
        array = xp.asarray([[3, 2, 5, 1, 4],
                            [5, 8, 3, 7, 1],
                            [5, 6, 9, 3, 5]], dtype=dtype)
        output = ndimage.rank_filter(array, 0, footprint=footprint,
                                     origin=[-1, 0])
        xp_assert_equal(expected, output)

    # NumPy-only because test is for list input
    def test_rank16(self):
        # test that lists are accepted and interpreted as numpy arrays
        array = [3, 2, 5, 1, 4]
        # expected values are: median(3, 2, 5) = 3, median(2, 5, 1) = 2, etc
        expected = np.asarray([3, 3, 2, 4, 4])
        output = ndimage.rank_filter(array, -2, size=3)
        xp_assert_equal(expected, output)

    def test_rank17(self, xp):
        array = xp.asarray([3, 2, 5, 1, 4])
        if not hasattr(array, 'flags'):
            return
        array.flags.writeable = False
        expected = xp.asarray([3, 3, 2, 4, 4])
        output = ndimage.rank_filter(array, -2, size=3)
        xp_assert_equal(expected, output)

    def test_rank18(self, xp):
        # module 'array_api_strict' has no attribute 'float16'
        tested_dtypes = ['int8', 'int16', 'int32', 'int64', 'float32', 'float64',
                         'uint8', 'uint16', 'uint32', 'uint64']
        for dtype_str in tested_dtypes:
            dtype = getattr(xp, dtype_str)
            x = xp.asarray([3, 2, 5, 1, 4], dtype=dtype)
            y = ndimage.rank_filter(x, -2, size=3)
            assert y.dtype == x.dtype

    def test_rank19(self, xp):
        # module 'array_api_strict' has no attribute 'float16'
        tested_dtypes = ['int8', 'int16', 'int32', 'int64', 'float32', 'float64',
                         'uint8', 'uint16', 'uint32', 'uint64']
        for dtype_str in tested_dtypes:
            dtype = getattr(xp, dtype_str)
            x = xp.asarray([[3, 2, 5, 1, 4], [3, 2, 5, 1, 4]], dtype=dtype)
            y = ndimage.rank_filter(x, -2, size=3)
            assert y.dtype == x.dtype

    @skip_xp_backends(np_only=True, exceptions=["cupy"],
                      reason="off-by-ones on alt backends")
    @xfail_xp_backends("cupy", reason="does not support extra_arguments")
    @pytest.mark.parametrize('dtype', types)
    def test_generic_filter1d01(self, dtype, xp):
        weights = xp.asarray([1.1, 2.2, 3.3])

        def _filter_func(input, output, fltr, total):
            fltr = fltr / total
            for ii in range(input.shape[0] - 2):
                output[ii] = input[ii] * fltr[0]
                output[ii] += input[ii + 1] * fltr[1]
                output[ii] += input[ii + 2] * fltr[2]

        a = np.arange(12, dtype=dtype).reshape(3, 4)
        a = xp.asarray(a)
        dtype = getattr(xp, dtype)

        r1 = ndimage.correlate1d(a, weights / xp.sum(weights), 0, origin=-1)
        r2 = ndimage.generic_filter1d(
            a, _filter_func, 3, axis=0, origin=-1,
            extra_arguments=(weights,),
            extra_keywords={'total': xp.sum(weights)})
        assert_array_almost_equal(r1, r2)

    @xfail_xp_backends("cupy", reason="does not support extra_arguments")
    @pytest.mark.parametrize('dtype', types)
    def test_generic_filter01(self, dtype, xp):
        if is_torch(xp) and dtype in ("uint16", "uint32", "uint64"):
            pytest.xfail("https://github.com/pytorch/pytorch/issues/58734")

        dtype_str = dtype
        dtype = getattr(xp, dtype_str)

        filter_ = xp.asarray([[1.0, 2.0], [3.0, 4.0]])
        footprint = xp.asarray([[1.0, 0.0], [0.0, 1.0]])
        cf = xp.asarray([1., 4.])

        def _filter_func(buffer, weights, total=1.0):
            weights = np.asarray(cf) / np.asarray(total)
            return np.sum(buffer * weights)

        a = np.arange(12, dtype=dtype_str).reshape(3, 4)
        a = xp.asarray(a)
        r1 = ndimage.correlate(a, filter_ * footprint)
        if dtype_str in float_types:
            r1 /= 5
        else:
            r1 //= 5
        r2 = ndimage.generic_filter(
            a, _filter_func, footprint=footprint, extra_arguments=(cf,),
            extra_keywords={'total': xp.sum(cf)})
        assert_array_almost_equal(r1, r2)

        # generic_filter doesn't allow mode sequence
        with assert_raises(RuntimeError):
            r2 = ndimage.generic_filter(
                a, _filter_func, mode=['reflect', 'reflect'],
                footprint=footprint, extra_arguments=(cf,),
                extra_keywords={'total': xp.sum(cf)})

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [1, 1, 2]),
         ('wrap', [3, 1, 2]),
         ('reflect', [1, 1, 2]),
         ('mirror', [2, 1, 2]),
         ('constant', [0, 1, 2])]
    )
    def test_extend01(self, mode, expected_value, xp):
        array = xp.asarray([1, 2, 3])
        weights = xp.asarray([1, 0])
        output = ndimage.correlate1d(array, weights, 0, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [1, 1, 1]),
         ('wrap', [3, 1, 2]),
         ('reflect', [3, 3, 2]),
         ('mirror', [1, 2, 3]),
         ('constant', [0, 0, 0])]
    )
    def test_extend02(self, mode, expected_value, xp):
        array = xp.asarray([1, 2, 3])
        weights = xp.asarray([1, 0, 0, 0, 0, 0, 0, 0])
        output = ndimage.correlate1d(array, weights, 0, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [2, 3, 3]),
         ('wrap', [2, 3, 1]),
         ('reflect', [2, 3, 3]),
         ('mirror', [2, 3, 2]),
         ('constant', [2, 3, 0])]
    )
    def test_extend03(self, mode, expected_value, xp):
        array = xp.asarray([1, 2, 3])
        weights = xp.asarray([0, 0, 1])
        output = ndimage.correlate1d(array, weights, 0, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [3, 3, 3]),
         ('wrap', [2, 3, 1]),
         ('reflect', [2, 1, 1]),
         ('mirror', [1, 2, 3]),
         ('constant', [0, 0, 0])]
    )
    def test_extend04(self, mode, expected_value, xp):
        array = xp.asarray([1, 2, 3])
        weights = xp.asarray([0, 0, 0, 0, 0, 0, 0, 0, 1])
        output = ndimage.correlate1d(array, weights, 0, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [[1, 1, 2], [1, 1, 2], [4, 4, 5]]),
         ('wrap', [[9, 7, 8], [3, 1, 2], [6, 4, 5]]),
         ('reflect', [[1, 1, 2], [1, 1, 2], [4, 4, 5]]),
         ('mirror', [[5, 4, 5], [2, 1, 2], [5, 4, 5]]),
         ('constant', [[0, 0, 0], [0, 1, 2], [0, 4, 5]])]
    )
    def test_extend05(self, mode, expected_value, xp):
        array = xp.asarray([[1, 2, 3],
                            [4, 5, 6],
                            [7, 8, 9]])
        weights = xp.asarray([[1, 0], [0, 0]])
        output = ndimage.correlate(array, weights, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [[5, 6, 6], [8, 9, 9], [8, 9, 9]]),
         ('wrap', [[5, 6, 4], [8, 9, 7], [2, 3, 1]]),
         ('reflect', [[5, 6, 6], [8, 9, 9], [8, 9, 9]]),
         ('mirror', [[5, 6, 5], [8, 9, 8], [5, 6, 5]]),
         ('constant', [[5, 6, 0], [8, 9, 0], [0, 0, 0]])]
    )
    def test_extend06(self, mode, expected_value, xp):
        array = xp.asarray([[1, 2, 3],
                          [4, 5, 6],
                          [7, 8, 9]])
        weights = xp.asarray([[0, 0, 0], [0, 0, 0], [0, 0, 1]])
        output = ndimage.correlate(array, weights, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [3, 3, 3]),
         ('wrap', [2, 3, 1]),
         ('reflect', [2, 1, 1]),
         ('mirror', [1, 2, 3]),
         ('constant', [0, 0, 0])]
    )
    def test_extend07(self, mode, expected_value, xp):
        array = xp.asarray([1, 2, 3])
        weights = xp.asarray([0, 0, 0, 0, 0, 0, 0, 0, 1])
        output = ndimage.correlate(array, weights, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [[3], [3], [3]]),
         ('wrap', [[2], [3], [1]]),
         ('reflect', [[2], [1], [1]]),
         ('mirror', [[1], [2], [3]]),
         ('constant', [[0], [0], [0]])]
    )
    def test_extend08(self, mode, expected_value, xp):
        array = xp.asarray([[1], [2], [3]])
        weights = xp.asarray([[0], [0], [0], [0], [0], [0], [0], [0], [1]])
        output = ndimage.correlate(array, weights, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [3, 3, 3]),
         ('wrap', [2, 3, 1]),
         ('reflect', [2, 1, 1]),
         ('mirror', [1, 2, 3]),
         ('constant', [0, 0, 0])]
    )
    def test_extend09(self, mode, expected_value, xp):
        array = xp.asarray([1, 2, 3])
        weights = xp.asarray([0, 0, 0, 0, 0, 0, 0, 0, 1])
        output = ndimage.correlate(array, weights, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)

    @pytest.mark.parametrize(
        'mode, expected_value',
        [('nearest', [[3], [3], [3]]),
         ('wrap', [[2], [3], [1]]),
         ('reflect', [[2], [1], [1]]),
         ('mirror', [[1], [2], [3]]),
         ('constant', [[0], [0], [0]])]
    )
    def test_extend10(self, mode, expected_value, xp):
        array = xp.asarray([[1], [2], [3]])
        weights = xp.asarray([[0], [0], [0], [0], [0], [0], [0], [0], [1]])
        output = ndimage.correlate(array, weights, mode=mode, cval=0)
        expected_value = xp.asarray(expected_value)
        xp_assert_equal(output, expected_value)


@xfail_xp_backends("cupy", reason="TypeError")
def test_ticket_701(xp):
    # Test generic filter sizes
    arr = xp.asarray(np.arange(4).reshape(2, 2))
    def func(x):
        return np.min(x)  # NB: np.min not xp.min for callables
    res = ndimage.generic_filter(arr, func, size=(1, 1))
    # The following raises an error unless ticket 701 is fixed
    res2 = ndimage.generic_filter(arr, func, size=1)
    xp_assert_equal(res, res2)


def test_gh_5430():
    # At least one of these raises an error unless gh-5430 is
    # fixed. In py2k an int is implemented using a C long, so
    # which one fails depends on your system. In py3k there is only
    # one arbitrary precision integer type, so both should fail.
    sigma = np.int32(1)
    out = ndimage._ni_support._normalize_sequence(sigma, 1)
    assert out == [sigma]
    sigma = np.int64(1)
    out = ndimage._ni_support._normalize_sequence(sigma, 1)
    assert out == [sigma]
    # This worked before; make sure it still works
    sigma = 1
    out = ndimage._ni_support._normalize_sequence(sigma, 1)
    assert out == [sigma]
    # This worked before; make sure it still works
    sigma = [1, 1]
    out = ndimage._ni_support._normalize_sequence(sigma, 2)
    assert out == sigma
    # Also include the OPs original example to make sure we fixed the issue
    x = np.random.normal(size=(256, 256))
    perlin = np.zeros_like(x)
    for i in 2**np.arange(6):
        perlin += ndimage.gaussian_filter(x, i, mode="wrap") * i**2
    # This also fixes gh-4106, show that the OPs example now runs.
    x = np.int64(21)
    ndimage._ni_support._normalize_sequence(x, 0)


@skip_xp_backends("cupy", reason="tests a private scipy utility")
def test_gaussian_kernel1d(xp):
    radius = 10
    sigma = 2
    sigma2 = sigma * sigma
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    x = xp.asarray(x)
    phi_x = xp.exp(-0.5 * x * x / sigma2)
    phi_x /= xp.sum(phi_x)
    xp_assert_close(phi_x,
                    xp.asarray(_gaussian_kernel1d(sigma, 0, radius)))
    xp_assert_close(-phi_x * x / sigma2,
                    xp.asarray(_gaussian_kernel1d(sigma, 1, radius)))
    xp_assert_close(phi_x * (x * x / sigma2 - 1) / sigma2,
                    xp.asarray(_gaussian_kernel1d(sigma, 2, radius)))
    xp_assert_close(phi_x * (3 - x * x / sigma2) * x / (sigma2 * sigma2),
                    xp.asarray(_gaussian_kernel1d(sigma, 3, radius)))


def test_orders_gauss(xp):
    # Check order inputs to Gaussians
    arr = xp.zeros((1,))
    xp_assert_equal(ndimage.gaussian_filter(arr, 1, order=0), xp.asarray([0.]))
    xp_assert_equal(ndimage.gaussian_filter(arr, 1, order=3), xp.asarray([0.]))
    assert_raises(ValueError, ndimage.gaussian_filter, arr, 1, -1)
    xp_assert_equal(ndimage.gaussian_filter1d(arr, 1, axis=-1, order=0),
                    xp.asarray([0.]))
    xp_assert_equal(ndimage.gaussian_filter1d(arr, 1, axis=-1, order=3),
                    xp.asarray([0.]))
    assert_raises(ValueError, ndimage.gaussian_filter1d, arr, 1, -1, -1)


@xfail_xp_backends("cupy", reason="TypeError")
def test_valid_origins(xp):
    """Regression test for #1311."""
    def func(x):
        return xp.mean(x)

    data = xp.asarray([1, 2, 3, 4, 5], dtype=xp.float64)
    assert_raises(ValueError, ndimage.generic_filter, data, func, size=3,
                  origin=2)
    assert_raises(ValueError, ndimage.generic_filter1d, data, func,
                  filter_size=3, origin=2)
    assert_raises(ValueError, ndimage.percentile_filter, data, 0.2, size=3,
                  origin=2)

    for filter in [ndimage.uniform_filter, ndimage.minimum_filter,
                   ndimage.maximum_filter, ndimage.maximum_filter1d,
                   ndimage.median_filter, ndimage.minimum_filter1d]:
        # This should work, since for size == 3, the valid range for origin is
        # -1 to 1.
        list(filter(data, 3, origin=-1))
        list(filter(data, 3, origin=1))
        # Just check this raises an error instead of silently accepting or
        # segfaulting.
        assert_raises(ValueError, filter, data, 3, origin=2)


def test_bad_convolve_and_correlate_origins(xp):
    """Regression test for gh-822."""
    # Before gh-822 was fixed, these would generate seg. faults or
    # other crashes on many system.
    assert_raises(ValueError, ndimage.correlate1d,
                  [0, 1, 2, 3, 4, 5], [1, 1, 2, 0], origin=2)
    assert_raises(ValueError, ndimage.correlate,
                  [0, 1, 2, 3, 4, 5], [0, 1, 2], origin=[2])
    assert_raises(ValueError, ndimage.correlate,
                  xp.ones((3, 5)), xp.ones((2, 2)), origin=[0, 1])

    assert_raises(ValueError, ndimage.convolve1d,
                  xp.arange(10), xp.ones(3), origin=-2)
    assert_raises(ValueError, ndimage.convolve,
                  xp.arange(10), xp.ones(3), origin=[-2])
    assert_raises(ValueError, ndimage.convolve,
                  xp.ones((3, 5)), xp.ones((2, 2)), origin=[0, -2])

@skip_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8430")
def test_multiple_modes(xp):
    # Test that the filters with multiple mode capabilities for different
    # dimensions give the same result as applying a single mode.
    arr = xp.asarray([[1., 0., 0.],
                      [1., 1., 0.],
                      [0., 0., 0.]])

    mode1 = 'reflect'
    mode2 = ['reflect', 'reflect']

    xp_assert_equal(ndimage.gaussian_filter(arr, 1, mode=mode1),
                 ndimage.gaussian_filter(arr, 1, mode=mode2))
    xp_assert_equal(ndimage.prewitt(arr, mode=mode1),
                 ndimage.prewitt(arr, mode=mode2))
    xp_assert_equal(ndimage.sobel(arr, mode=mode1),
                 ndimage.sobel(arr, mode=mode2))
    xp_assert_equal(ndimage.laplace(arr, mode=mode1),
                 ndimage.laplace(arr, mode=mode2))
    xp_assert_equal(ndimage.gaussian_laplace(arr, 1, mode=mode1),
                 ndimage.gaussian_laplace(arr, 1, mode=mode2))
    xp_assert_equal(ndimage.maximum_filter(arr, size=5, mode=mode1),
                 ndimage.maximum_filter(arr, size=5, mode=mode2))
    xp_assert_equal(ndimage.minimum_filter(arr, size=5, mode=mode1),
                 ndimage.minimum_filter(arr, size=5, mode=mode2))
    xp_assert_equal(ndimage.gaussian_gradient_magnitude(arr, 1, mode=mode1),
                 ndimage.gaussian_gradient_magnitude(arr, 1, mode=mode2))
    xp_assert_equal(ndimage.uniform_filter(arr, 5, mode=mode1),
                 ndimage.uniform_filter(arr, 5, mode=mode2))


@skip_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8430")
def test_multiple_modes_sequentially(xp):
    # Test that the filters with multiple mode capabilities for different
    # dimensions give the same result as applying the filters with
    # different modes sequentially
    arr = xp.asarray([[1., 0., 0.],
                      [1., 1., 0.],
                      [0., 0., 0.]])

    modes = ['reflect', 'wrap']

    expected = ndimage.gaussian_filter1d(arr, 1, axis=0, mode=modes[0])
    expected = ndimage.gaussian_filter1d(expected, 1, axis=1, mode=modes[1])
    xp_assert_equal(expected,
                 ndimage.gaussian_filter(arr, 1, mode=modes))

    expected = ndimage.uniform_filter1d(arr, 5, axis=0, mode=modes[0])
    expected = ndimage.uniform_filter1d(expected, 5, axis=1, mode=modes[1])
    xp_assert_equal(expected,
                 ndimage.uniform_filter(arr, 5, mode=modes))

    expected = ndimage.maximum_filter1d(arr, size=5, axis=0, mode=modes[0])
    expected = ndimage.maximum_filter1d(expected, size=5, axis=1,
                                        mode=modes[1])
    xp_assert_equal(expected,
                 ndimage.maximum_filter(arr, size=5, mode=modes))

    expected = ndimage.minimum_filter1d(arr, size=5, axis=0, mode=modes[0])
    expected = ndimage.minimum_filter1d(expected, size=5, axis=1,
                                        mode=modes[1])
    xp_assert_equal(expected,
                 ndimage.minimum_filter(arr, size=5, mode=modes))


def test_multiple_modes_prewitt(xp):
    # Test prewitt filter for multiple extrapolation modes
    arr = xp.asarray([[1., 0., 0.],
                      [1., 1., 0.],
                      [0., 0., 0.]])

    expected = xp.asarray([[1., -3., 2.],
                           [1., -2., 1.],
                           [1., -1., 0.]])

    modes = ['reflect', 'wrap']

    xp_assert_equal(expected,
                 ndimage.prewitt(arr, mode=modes))


def test_multiple_modes_sobel(xp):
    # Test sobel filter for multiple extrapolation modes
    arr = xp.asarray([[1., 0., 0.],
                      [1., 1., 0.],
                      [0., 0., 0.]])

    expected = xp.asarray([[1., -4., 3.],
                           [2., -3., 1.],
                           [1., -1., 0.]])

    modes = ['reflect', 'wrap']

    xp_assert_equal(expected,
                 ndimage.sobel(arr, mode=modes))


def test_multiple_modes_laplace(xp):
    # Test laplace filter for multiple extrapolation modes
    arr = xp.asarray([[1., 0., 0.],
                      [1., 1., 0.],
                      [0., 0., 0.]])

    expected = xp.asarray([[-2., 2., 1.],
                           [-2., -3., 2.],
                           [1., 1., 0.]])

    modes = ['reflect', 'wrap']

    xp_assert_equal(expected,
                 ndimage.laplace(arr, mode=modes))


def test_multiple_modes_gaussian_laplace(xp):
    # Test gaussian_laplace filter for multiple extrapolation modes
    arr = xp.asarray([[1., 0., 0.],
                      [1., 1., 0.],
                      [0., 0., 0.]])

    expected = xp.asarray([[-0.28438687, 0.01559809, 0.19773499],
                           [-0.36630503, -0.20069774, 0.07483620],
                           [0.15849176, 0.18495566, 0.21934094]])

    modes = ['reflect', 'wrap']

    assert_almost_equal(expected,
                        ndimage.gaussian_laplace(arr, 1, mode=modes))


def test_multiple_modes_gaussian_gradient_magnitude(xp):
    # Test gaussian_gradient_magnitude filter for multiple
    # extrapolation modes
    arr = xp.asarray([[1., 0., 0.],
                      [1., 1., 0.],
                      [0., 0., 0.]])

    expected = xp.asarray([[0.04928965, 0.09745625, 0.06405368],
                           [0.23056905, 0.14025305, 0.04550846],
                           [0.19894369, 0.14950060, 0.06796850]])

    modes = ['reflect', 'wrap']

    calculated = ndimage.gaussian_gradient_magnitude(arr, 1, mode=modes)

    assert_almost_equal(expected, calculated)

@skip_xp_backends("cupy", reason="https://github.com/cupy/cupy/pull/8430")
def test_multiple_modes_uniform(xp):
    # Test uniform filter for multiple extrapolation modes
    arr = xp.asarray([[1., 0., 0.],
                      [1., 1., 0.],
                      [0., 0., 0.]])

    expected = xp.asarray([[0.32, 0.40, 0.48],
                           [0.20, 0.28, 0.32],
                           [0.28, 0.32, 0.40]])

    modes = ['reflect', 'wrap']

    assert_almost_equal(expected,
                        ndimage.uniform_filter(arr, 5, mode=modes))


def _count_nonzero(arr):
    # XXX: a simplified count_nonzero replacement; replace once
    # https://github.com/data-apis/array-api/pull/803/ is in

    # this assumes arr.dtype == xp.bool
    xp = array_namespace(arr)
    return xp.sum(xp.astype(arr, xp.int8))


def test_gaussian_truncate(xp):
    # Test that Gaussian filters can be truncated at different widths.
    # These tests only check that the result has the expected number
    # of nonzero elements.
    arr = np.zeros((100, 100), dtype=np.float64)
    arr[50, 50] = 1
    arr = xp.asarray(arr)
    num_nonzeros_2 = _count_nonzero(ndimage.gaussian_filter(arr, 5, truncate=2) > 0)
    assert num_nonzeros_2 == 21**2

    num_nonzeros_5 = _count_nonzero(
        ndimage.gaussian_filter(arr, 5, truncate=5) > 0
    )
    assert num_nonzeros_5 == 51**2

    # Test truncate when sigma is a sequence.
    f = ndimage.gaussian_filter(arr, [0.5, 2.5], truncate=3.5)
    fpos = f > 0
    n0 = _count_nonzero(xp.any(fpos, axis=0))
    assert n0 == 19
    n1 = _count_nonzero(xp.any(fpos, axis=1))
    assert n1 == 5

    # Test gaussian_filter1d.
    x = np.zeros(51)
    x[25] = 1
    x = xp.asarray(x)
    f = ndimage.gaussian_filter1d(x, sigma=2, truncate=3.5)
    n = _count_nonzero(f > 0)
    assert n == 15

    # Test gaussian_laplace
    y = ndimage.gaussian_laplace(x, sigma=2, truncate=3.5)
    nonzero_indices = xp.nonzero(y != 0)[0]

    n = xp.max(nonzero_indices) - xp.min(nonzero_indices) + 1
    assert n == 15

    # Test gaussian_gradient_magnitude
    y = ndimage.gaussian_gradient_magnitude(x, sigma=2, truncate=3.5)
    nonzero_indices = xp.nonzero(y != 0)[0]
    n = xp.max(nonzero_indices) - xp.min(nonzero_indices) + 1
    assert n == 15


@xfail_xp_backends("cupy", reason="cupy/cupy#8402")
def test_gaussian_radius(xp):
    # Test that Gaussian filters with radius argument produce the same
    # results as the filters with corresponding truncate argument.
    # radius = int(truncate * sigma + 0.5)
    # Test gaussian_filter1d
    x = np.zeros(7)
    x[3] = 1
    x = xp.asarray(x)
    f1 = ndimage.gaussian_filter1d(x, sigma=2, truncate=1.5)
    f2 = ndimage.gaussian_filter1d(x, sigma=2, radius=3)
    xp_assert_equal(f1, f2)

    # Test gaussian_filter when sigma is a number.
    a = np.zeros((9, 9))
    a[4, 4] = 1
    a = xp.asarray(a)
    f1 = ndimage.gaussian_filter(a, sigma=0.5, truncate=3.5)
    f2 = ndimage.gaussian_filter(a, sigma=0.5, radius=2)
    xp_assert_equal(f1, f2)

    # Test gaussian_filter when sigma is a sequence.
    a = np.zeros((50, 50))
    a[25, 25] = 1
    a = xp.asarray(a)
    f1 = ndimage.gaussian_filter(a, sigma=[0.5, 2.5], truncate=3.5)
    f2 = ndimage.gaussian_filter(a, sigma=[0.5, 2.5], radius=[2, 9])
    xp_assert_equal(f1, f2)


@xfail_xp_backends("cupy", reason="cupy/cupy#8402")
def test_gaussian_radius_invalid(xp):
    # radius must be a nonnegative integer
    with assert_raises(ValueError):
        ndimage.gaussian_filter1d(xp.zeros(8), sigma=1, radius=-1)
    with assert_raises(ValueError):
        ndimage.gaussian_filter1d(xp.zeros(8), sigma=1, radius=1.1)


@uses_output_array
class TestThreading:
    def check_func_thread(self, n, fun, args, out):
        from threading import Thread
        thrds = [Thread(target=fun, args=args, kwargs={'output': out[x, ...]})
                 for x in range(n)]
        [t.start() for t in thrds]
        [t.join() for t in thrds]

    def check_func_serial(self, n, fun, args, out):
        for i in range(n):
            fun(*args, output=out[i, ...])

    @xfail_xp_backends("cupy",
                       reason="XXX thread exception; cannot repro outside of pytest")
    def test_correlate1d(self, xp):
        d = np.random.randn(5000)
        os = np.empty((4, d.size))
        ot = np.empty_like(os)
        d = xp.asarray(d)
        os = xp.asarray(os)
        ot = xp.asarray(ot)
        k = xp.arange(5)
        self.check_func_serial(4, ndimage.correlate1d, (d, k), os)
        self.check_func_thread(4, ndimage.correlate1d, (d, k), ot)
        xp_assert_equal(os, ot)

    @xfail_xp_backends("cupy",
                       reason="XXX thread exception; cannot repro outside of pytest")
    def test_correlate(self, xp):
        d = xp.asarray(np.random.randn(500, 500))
        k = xp.asarray(np.random.randn(10, 10))
        os = xp.empty([4] + list(d.shape))
        ot = xp.empty_like(os)
        self.check_func_serial(4, ndimage.correlate, (d, k), os)
        self.check_func_thread(4, ndimage.correlate, (d, k), ot)
        xp_assert_equal(os, ot)

    @xfail_xp_backends("cupy",
                       reason="XXX thread exception; cannot repro outside of pytest")
    def test_median_filter(self, xp):
        d = xp.asarray(np.random.randn(500, 500))
        os = xp.empty([4] + list(d.shape))
        ot = xp.empty_like(os)
        self.check_func_serial(4, ndimage.median_filter, (d, 3), os)
        self.check_func_thread(4, ndimage.median_filter, (d, 3), ot)
        xp_assert_equal(os, ot)

    @xfail_xp_backends("cupy",
                       reason="XXX thread exception; cannot repro outside of pytest")
    def test_uniform_filter1d(self, xp):
        d = np.random.randn(5000)
        os = np.empty((4, d.size))
        ot = np.empty_like(os)
        d = xp.asarray(d)
        os = xp.asarray(os)
        ot = xp.asarray(ot)
        self.check_func_serial(4, ndimage.uniform_filter1d, (d, 5), os)
        self.check_func_thread(4, ndimage.uniform_filter1d, (d, 5), ot)
        xp_assert_equal(os, ot)

    @xfail_xp_backends("cupy",
                       reason="XXX thread exception; cannot repro outside of pytest")
    def test_minmax_filter(self, xp):
        d = xp.asarray(np.random.randn(500, 500))
        os = xp.empty([4] + list(d.shape))
        ot = xp.empty_like(os)
        self.check_func_serial(4, ndimage.maximum_filter, (d, 3), os)
        self.check_func_thread(4, ndimage.maximum_filter, (d, 3), ot)
        xp_assert_equal(os, ot)
        self.check_func_serial(4, ndimage.minimum_filter, (d, 3), os)
        self.check_func_thread(4, ndimage.minimum_filter, (d, 3), ot)
        xp_assert_equal(os, ot)


def test_minmaximum_filter1d(xp):
    # Regression gh-3898
    in_ = xp.arange(10)
    out = ndimage.minimum_filter1d(in_, 1)
    xp_assert_equal(in_, out)
    out = ndimage.maximum_filter1d(in_, 1)
    xp_assert_equal(in_, out)
    # Test reflect
    out = ndimage.minimum_filter1d(in_, 5, mode='reflect')
    xp_assert_equal(xp.asarray([0, 0, 0, 1, 2, 3, 4, 5, 6, 7]), out)
    out = ndimage.maximum_filter1d(in_, 5, mode='reflect')
    xp_assert_equal(xp.asarray([2, 3, 4, 5, 6, 7, 8, 9, 9, 9]), out)
    # Test constant
    out = ndimage.minimum_filter1d(in_, 5, mode='constant', cval=-1)
    xp_assert_equal(xp.asarray([-1, -1, 0, 1, 2, 3, 4, 5, -1, -1]), out)
    out = ndimage.maximum_filter1d(in_, 5, mode='constant', cval=10)
    xp_assert_equal(xp.asarray([10, 10, 4, 5, 6, 7, 8, 9, 10, 10]), out)
    # Test nearest
    out = ndimage.minimum_filter1d(in_, 5, mode='nearest')
    xp_assert_equal(xp.asarray([0, 0, 0, 1, 2, 3, 4, 5, 6, 7]), out)
    out = ndimage.maximum_filter1d(in_, 5, mode='nearest')
    xp_assert_equal(xp.asarray([2, 3, 4, 5, 6, 7, 8, 9, 9, 9]), out)
    # Test wrap
    out = ndimage.minimum_filter1d(in_, 5, mode='wrap')
    xp_assert_equal(xp.asarray([0, 0, 0, 1, 2, 3, 4, 5, 0, 0]), out)
    out = ndimage.maximum_filter1d(in_, 5, mode='wrap')
    xp_assert_equal(xp.asarray([9, 9, 4, 5, 6, 7, 8, 9, 9, 9]), out)


@xfail_xp_backends("cupy", reason="cupy/cupy#8401")
def test_uniform_filter1d_roundoff_errors(xp):
    # gh-6930
    in_ = np.repeat([0, 1, 0], [9, 9, 9])
    in_ = xp.asarray(in_)

    for filter_size in range(3, 10):
        out = ndimage.uniform_filter1d(in_, filter_size)
        xp_assert_equal(xp.sum(out), xp.asarray(10 - filter_size), check_0d=False)


def test_footprint_all_zeros(xp):
    # regression test for gh-6876: footprint of all zeros segfaults
    arr = xp.asarray(np.random.randint(0, 100, (100, 100)))
    kernel = xp.asarray(np.zeros((3, 3), dtype=bool))
    with assert_raises(ValueError):
        ndimage.maximum_filter(arr, footprint=kernel)


@xfail_xp_backends("cupy", reason="does not raise")
@skip_xp_backends("array_api_strict", reason="no float16")
@skip_xp_backends("dask.array", reason="no float16")
def test_gaussian_filter_float16(xp):
    # gh-8207
    data = xp.asarray([1], dtype=xp.float16)
    sigma = 1.0
    with assert_raises(RuntimeError):
        ndimage.gaussian_filter(data, sigma)


@xfail_xp_backends("cupy", reason="does not raise")
def test_rank_filter_noninteger_rank(xp):
    # regression test for issue 9388: ValueError for
    # non integer rank when performing rank_filter
    arr = xp.asarray(np.random.random((10, 20, 30)))
    footprint = xp.asarray(np.ones((1, 1, 10), dtype=bool))
    assert_raises(TypeError, ndimage.rank_filter, arr, 0.5,
                  footprint=footprint)


def test_size_footprint_both_set(xp):
    # test for input validation, expect user warning when
    # size and footprint is set
    with suppress_warnings() as sup:
        sup.filter(UserWarning,
                   "ignoring size because footprint is set")
        arr = xp.asarray(np.random.random((10, 20, 30)))
        footprint = xp.asarray(np.ones((1, 1, 10), dtype=bool))
        ndimage.rank_filter(
            arr, 5, size=2, footprint=footprint
        )


# NumPy-only because 'byteorder is numpy-specific'
def test_byte_order_median():
    """Regression test for #413: median_filter does not handle bytes orders."""
    a = np.arange(9, dtype='<f4').reshape(3, 3)
    ref = ndimage.median_filter(a, (3, 3))
    b = np.arange(9, dtype='>f4').reshape(3, 3)
    t = ndimage.median_filter(b, (3, 3))
    assert_array_almost_equal(ref, t)


@pytest.mark.parametrize("filter_size, exp", [
    # expected results from SciPy 1.14.1
    (20, 0.25754605),
    (10,
     np.array([0.25266576, 0.27894721, 0.30445588, 0.30958242, 0.30445588, 0.30445588,
               0.27894721, 0.30445588, 0.27894721, 0.30445588, 0.30445588, 0.25754605,
               0.22183391, 0.18015438, 0.22183391, 0.25266576, 0.25754605, 0.25266576,
               0.25266576, 0.25266576]),
     ),
     # a median filter size of 1 is just an identity operation
     (1,
      np.array([0.30958242, 0.17555138, 0.34343917, 0.27894721, 0.03767094, 0.39024894,
                0.30445588, 0.31442572, 0.05124545, 0.18015438, 0.14831921, 0.370706,
                0.25754605, 0.32910465, 0.17736568, 0.09089549, 0.22183391, 0.0255269,
                0.33105247, 0.25266576]),
     ),
     # testing odd-sized filters >1 makes sense too
     (3,
      np.array([0.25266576, 0.30958242, 0.27894721, 0.27894721, 0.27894721, 0.30445588,
                0.31442572, 0.30445588, 0.18015438, 0.14831921, 0.18015438, 0.25754605,
                0.32910465, 0.25754605, 0.17736568, 0.17736568, 0.09089549, 0.22183391,
                0.25266576, 0.30958242]),
     ),
     (15,
      np.array([0.27894721, 0.25266576, 0.25266576, 0.25266576, 0.27894721, 0.27894721,
                0.27894721, 0.27894721, 0.25754605, 0.25754605, 0.22183391, 0.22183391,
                0.25266576, 0.25266576, 0.22183391, 0.22183391, 0.25266576, 0.25266576,
                0.25754605, 0.25754605]),
     ),
])
def test_gh_22250(filter_size, exp):
    rng = np.random.default_rng(42)
    image = np.zeros((20,))
    noisy_image = image + 0.4 * rng.random(image.shape)
    result = ndimage.median_filter(noisy_image, size=filter_size, mode='wrap')
    assert_allclose(result, exp)


def test_gh_22333():
    x = np.array([272, 58, 67, 163, 463, 608, 87, 108, 1378])
    expected = [58, 67, 87, 108, 163, 108, 108, 108, 87]
    actual = ndimage.median_filter(x, size=9, mode='constant')
    assert_array_equal(actual, expected)


@pytest.mark.filterwarnings("ignore:The given NumPy array is not writable:UserWarning")
@pytest.mark.skip_xp_backends(cpu_only=True, exceptions=['cupy'])
class TestVectorizedFilter:
    @pytest.mark.parametrize("axes, size",
                             [(None, (3, 4, 5)), ((0, 2), (3, 4)), ((-1,), (5,))])
    @pytest.mark.parametrize("origin", [-1, 0, 1])
    @pytest.mark.parametrize("mode",
                             ['reflect', 'nearest', 'mirror', 'wrap', 'constant'])
    @pytest.mark.parametrize("use_output", [False, True])
    def test_against_generic_filter(self, axes, size, origin, mode, use_output, xp):
        rng = np.random.default_rng(435982456983456987356)

        if use_output and (is_dask(xp) or is_jax(xp)):
            pytest.skip("Requires mutable arrays.")

        input = rng.random(size=(11, 12, 13))
        input_copy = input.copy()  # check that it is not modified
        output = xp.zeros(input.shape) if use_output else None

        kwargs = dict(axes=axes, size=size, origin=origin, mode=mode)
        ref = ndimage.generic_filter(input, np.mean, **kwargs)
        kwargs['output'] = output
        res = ndimage.vectorized_filter(xp.asarray(input.tolist()),
                                        xp.mean, **kwargs)
        xp_assert_close(res, xp.asarray(ref.tolist()), atol=1e-15)
        if use_output:
            xp_assert_equal(output, res)

        if not (is_array_api_strict(xp) or is_dask(xp)):
            # currently requires support for [..., mask] indexing
            kwargs.pop('size')
            kwargs.pop('output')
            kwargs['footprint'] = rng.random(size=size or input.shape) > 0.5
            ref = ndimage.generic_filter(input, np.mean, **kwargs)
            kwargs['footprint'] = xp.asarray(kwargs['footprint'])
            kwargs['output'] = output
            res = ndimage.vectorized_filter(xp.asarray(input.tolist()),
                                            xp.mean, **kwargs)
            xp_assert_close(res, xp.asarray(ref.tolist()), atol=1e-15)
            if use_output:
                xp_assert_equal(output, res)

        xp_assert_equal(xp.asarray(input), xp.asarray(input_copy))

    @pytest.mark.parametrize("dtype",
                             ["uint8", "uint16", "uint32", "uint64",
                              "int8", "int16", "int32", "int64",
                              "float32", "float64", "complex64", "complex128"])
    @pytest.mark.parametrize("batch_memory", [1, 16*3, np.inf])
    @pytest.mark.parametrize("use_footprint", [False, True])
    def test_dtype_batch_memory(self, dtype, batch_memory, use_footprint, xp):
        rng = np.random.default_rng(435982456983456987356)
        w = 3

        if is_jax(xp) and not (batch_memory == 1):
            pytest.skip("Requires mutable array.")
        if is_torch(xp) and dtype in {'uint16', 'uint32', 'uint64'}:
            pytest.skip("Needs uint support.")

        dtype = getattr(xp, dtype)

        if use_footprint:
            if (is_dask(xp) or is_array_api_strict(xp)):
                pytest.skip("Requires [..., mask] indexing.")
            footprint = xp.asarray([True, False, True])
            kwargs = dict(footprint=footprint, batch_memory=batch_memory)
        else:
            footprint = xp.asarray([True, True, True])
            kwargs = dict(size=w, batch_memory=batch_memory)

        # The intent here is to exercise all the code paths involved in `batch_memory`
        # and `output` handling. To test the limited-memory case, `batch_memory=16*3`
        # is chosen to be just large enough for a *single* window of `complex128` to
        # fit, and `n` is large enough that a whole sliding window view of `uint8`s
        # *won't* fit.
        n = 16*3 + 1
        input = rng.integers(0, 42, size=(n,))
        input = input + input*1j if xp.isdtype(dtype, 'complex floating') else input
        input_padded = xp.asarray(np.pad(input, [(1, 1)], mode='symmetric'),
                                  dtype=dtype)
        input = xp.asarray(input, dtype=dtype)

        ref = [xp.sum(input_padded[i: i + w][footprint]) for i in range(n)]
        sum_dtype = xp.sum(input_padded).dtype

        message = "`batch_memory` is insufficient for minimum chunk size."
        context = (pytest.raises(ValueError, match=message)
                   if batch_memory == 1 else contextlib.nullcontext())
        with context:
            res = ndimage.vectorized_filter(input, xp.sum, **kwargs)
            xp_assert_close(res, xp.astype(xp.stack(ref), sum_dtype))
            assert res.dtype == sum_dtype

            output = xp.empty_like(input)
            res = ndimage.vectorized_filter(input, xp.sum, output=output, **kwargs)
            xp_assert_close(res, xp.astype(xp.stack(ref), dtype))
            assert res.dtype == dtype

    def test_mode_valid(self, xp):
        rng = np.random.default_rng(435982456983456987356)
        input = rng.random(size=(10, 11))
        input_xp = xp.asarray(input)
        input_xp_copy = xp_copy(input_xp)  # check that it is not modified
        size = (3, 5)

        res = ndimage.vectorized_filter(input_xp, xp.mean, size=size, mode='valid')

        view = np.lib.stride_tricks.sliding_window_view(input, size)
        ref = np.mean(view, axis=(-2, -1))

        xp_assert_close(res, xp.asarray(ref))
        assert res.shape == tuple(input.shape - np.asarray(size) + 1)
        xp_assert_equal(input_xp, input_xp_copy)

    def test_input_validation(self, xp):
        input = xp.ones((10, 10))
        function = xp.mean
        size = 2
        footprint = xp.ones((2, 2))

        message = "`function` must be a callable."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, "eggplant", size=size)

        message = "Either `size` or `footprint` must be provided."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function)

        message = "Either `size` or `footprint` may be provided, not both."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=size, footprint=footprint)

        message = "All elements of `size` must be positive integers."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=(1, -1))
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=0)

        message = "The length of `axes` may not exceed "
        axes = (0, 1, 2)
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=(1, 2), axes=axes)
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, footprint=xp.ones((2, 2)),
                                      axes=axes)

        message = "`axes` must be compatible with the dimensionality..."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=(1,))
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=(2,), axes=(0,1))

        message = "All elements of `origin` must be integers"
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=size, origin=(1, 1.5))

        message = "`origin` must be an integer or tuple of integers with length..."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=size, origin=(1, 2, 3))

        message = "`mode` must be one of..."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=size, mode='coconut')

        message = "`mode='valid'` is incompatible with use of `origin`."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=size,
                                      mode='valid', origin=1)

        message = "Use of `cval` is compatible only with `mode='constant'`."
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=size, mode='valid', cval=1)

        other_messages = "|Unsupported|The array_api_strict|new|Value 'a duck'"
        message = "`cval` must include only numbers." + other_messages
        with pytest.raises((ValueError, TypeError), match=message):
            ndimage.vectorized_filter(input, function, size=size,
                              mode='constant', cval='a duck')

        message = "`batch_memory` must be positive number." + other_messages
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=size, batch_memory=0)
        with pytest.raises(ValueError, match=message):
            ndimage.vectorized_filter(input, function, size=size, batch_memory=(1, 2))
        with pytest.raises((ValueError, TypeError), match=message):
            ndimage.vectorized_filter(input, function, size=size, batch_memory="a duck")

    @pytest.mark.parametrize('shape', [(0,), (1, 0), (0, 1, 0)])
    def test_zero_size(self, shape, xp):
        input = xp.empty(shape)
        res = ndimage.vectorized_filter(input, xp.mean, size=1)
        xp_assert_equal(res, input)

    @pytest.mark.filterwarnings("ignore:Mean of empty slice.:RuntimeWarning")
    def test_edge_cases(self, xp):
        rng = np.random.default_rng(4835982345234982)
        function = xp.mean

        # 0-D input
        input = xp.asarray(1.)
        res = ndimage.vectorized_filter(input, function, size=())
        xp_assert_equal(res, xp.asarray(function(input, axis=())))

        if not (is_array_api_strict(xp) or is_dask(xp)):
            res = ndimage.vectorized_filter(input, function, footprint=True)
            xp_assert_equal(res, xp.asarray(function(input[True], axis=())))

            res = ndimage.vectorized_filter(input, function, footprint=False)
            xp_assert_equal(res, xp.asarray(function(input[False], axis=())))

        # 1x1 window
        input = xp.asarray(rng.random((5, 5)))
        res = ndimage.vectorized_filter(input, function, size=1)
        xp_assert_equal(res, input)

        # window is bigger than input shouldn't be a problem
        res = ndimage.vectorized_filter(input, function, size=21)
        ref = ndimage.vectorized_filter(input, function, size=21)
        xp_assert_close(res, ref)

    def test_gh23046_feature(self, xp):
        # The intent of gh-23046 was to always allow `size` to be a scalar.
        rng = np.random.default_rng(45982734597824)
        img = xp.asarray(rng.random((5, 5)))

        ref = ndimage.vectorized_filter(img, xp.mean, size=2)
        res = ndimage.vectorized_filter(img, xp.mean, size=2, axes=(0, 1))
        xp_assert_close(res, ref)

        ref = ndimage.vectorized_filter(img, xp.mean, size=(2,), axes=(0,))
        res = ndimage.vectorized_filter(img, xp.mean, size=2, axes=0)
        xp_assert_close(res, ref)

    def test_gh23046_fix(self, xp):
        # While investigating the feasibility of gh-23046, I noticed a bug when the
        # length of an `axes` tuple equals the dimensionality of the image.
        rng = np.random.default_rng(45982734597824)
        img = xp.asarray(rng.random((5, 5)))
        size = (2, 3)
        ref = ndimage.vectorized_filter(img.T, xp.mean, size=size).T
        res = ndimage.vectorized_filter(img, xp.mean, size=size, axes=(1, 0))
        xp_assert_close(res, ref)

        ref = ndimage.vectorized_filter(img, xp.mean, size=size, mode='constant')
        res = ndimage.vectorized_filter(img, xp.mean, size=size[::-1], axes=(1, 0),
                                        mode='constant')
        xp_assert_close(res, ref)



@given(x=npst.arrays(dtype=np.float64,
                     shape=st.integers(min_value=1, max_value=1000)),
       size=st.integers(min_value=1, max_value=50),
       mode=st.sampled_from(["constant", "mirror", "wrap", "reflect",
                             "nearest"]),
      )
def test_gh_22586_crash_property(x, size, mode):
    # property-based test for median_filter resilience to hard crashing
    ndimage.median_filter(x, size=size, mode=mode)
