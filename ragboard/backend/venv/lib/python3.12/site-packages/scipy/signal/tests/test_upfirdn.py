# Code adapted from "upfirdn" python library with permission:
#
# Copyright (c) 2009, Motorola, Inc
#
# All Rights Reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are
# met:
#
# * Redistributions of source code must retain the above copyright notice,
# this list of conditions and the following disclaimer.
#
# * Redistributions in binary form must reproduce the above copyright
# notice, this list of conditions and the following disclaimer in the
# documentation and/or other materials provided with the distribution.
#
# * Neither the name of Motorola nor the names of its contributors may be
# used to endorse or promote products derived from this software without
# specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
# IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
# THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
# PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
# CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
# EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
# PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
# PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
# LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
# NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
# SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


import numpy as np
from itertools import product

from pytest import raises as assert_raises
import pytest

from scipy._lib import array_api_extra as xpx
from scipy._lib._array_api import (
    xp_assert_close, array_namespace
)
from scipy.signal import upfirdn, firwin
from scipy.signal._upfirdn import _output_len, _upfirdn_modes
from scipy.signal._upfirdn_apply import _pad_test

skip_xp_backends = pytest.mark.skip_xp_backends



def upfirdn_naive(x, h, up=1, down=1):
    """Naive upfirdn processing in Python.

    Note: arg order (x, h) differs to facilitate apply_along_axis use.
    """
    x = np.asarray(x)
    h = np.asarray(h)
    out = np.zeros(len(x) * up, x.dtype)
    out[::up] = x
    out = np.convolve(h, out)[::down][:_output_len(len(h), len(x), up, down)]
    return out


class UpFIRDnCase:
    """Test _UpFIRDn object"""
    def __init__(self, up, down, h, x_dtype):
        self.up = up
        self.down = down
        self.h = np.atleast_1d(h)
        self.x_dtype = x_dtype
        self.rng = np.random.RandomState(17)

    def __call__(self):
        # tiny signal
        self.scrub(np.ones(1, self.x_dtype))
        # ones
        self.scrub(np.ones(10, self.x_dtype))  # ones
        # randn
        x = self.rng.randn(10).astype(self.x_dtype)
        if self.x_dtype in (np.complex64, np.complex128):
            x += 1j * self.rng.randn(10)
        self.scrub(x)
        # ramp
        self.scrub(np.arange(10).astype(self.x_dtype))
        # 3D, random
        size = (2, 3, 5)
        x = self.rng.randn(*size).astype(self.x_dtype)
        if self.x_dtype in (np.complex64, np.complex128):
            x += 1j * self.rng.randn(*size)
        for axis in range(len(size)):
            self.scrub(x, axis=axis)
        x = x[:, ::2, 1::3].T
        for axis in range(len(size)):
            self.scrub(x, axis=axis)

    def scrub(self, x, axis=-1):
        yr = np.apply_along_axis(upfirdn_naive, axis, x,
                                 self.h, self.up, self.down)
        want_len = _output_len(len(self.h), x.shape[axis], self.up, self.down)
        assert yr.shape[axis] == want_len
        y = upfirdn(self.h, x, self.up, self.down, axis=axis)
        assert y.shape[axis] == want_len
        assert y.shape == yr.shape
        dtypes = (self.h.dtype, x.dtype)
        if all(d == np.complex64 for d in dtypes):
            assert y.dtype == np.complex64
        elif np.complex64 in dtypes and np.float32 in dtypes:
            assert y.dtype == np.complex64
        elif all(d == np.float32 for d in dtypes):
            assert y.dtype == np.float32
        elif np.complex128 in dtypes or np.complex64 in dtypes:
            assert y.dtype == np.complex128
        else:
            assert y.dtype == np.float64
        xp_assert_close(yr.astype(y.dtype), y)


_UPFIRDN_TYPES = ("int64", "float32", "complex64", "float64", "complex128")


@skip_xp_backends(cpu_only=True, reason='Cython implementation')
class TestUpfirdn:

    @skip_xp_backends(np_only=True, reason="enough to only test on numpy")
    def test_valid_input(self, xp):
        assert_raises(ValueError, upfirdn, [1], [1], 1, 0)  # up or down < 1
        assert_raises(ValueError, upfirdn, [], [1], 1, 1)  # h.ndim != 1
        assert_raises(ValueError, upfirdn, [[1]], [1], 1, 1)

    @pytest.mark.parametrize('len_h', [1, 2, 3, 4, 5])
    @pytest.mark.parametrize('len_x', [1, 2, 3, 4, 5])
    def test_singleton(self, len_h, len_x, xp):
        # gh-9844: lengths producing expected outputs
        h = xp.zeros(len_h)
        h = xpx.at(h)[len_h // 2].set(1.)  # make h a delta
        x = xp.ones(len_x)
        y = upfirdn(h, x, 1, 1)
        want = xpx.pad(x, (len_h // 2, (len_h - 1) // 2), 'constant', xp=xp)
        xp_assert_close(y, want)

    def test_shift_x(self, xp):
        # gh-9844: shifted x can change values?
        y = upfirdn(xp.asarray([1, 1]), xp.asarray([1.]), 1, 1)
        xp_assert_close(
            y, xp.asarray([1.0, 1.0], dtype=xp.float64)  # was [0, 1] in the issue
        )
        y = upfirdn(xp.asarray([1, 1]), xp.asarray([0., 1.]), 1, 1)
        xp_assert_close(y, xp.asarray([0.0, 1.0, 1.0], dtype=xp.float64))

    # A bunch of lengths/factors chosen because they exposed differences
    # between the "old way" and new way of computing length, and then
    # got `expected` from MATLAB
    @pytest.mark.parametrize('len_h, len_x, up, down, expected', [
        (2, 2, 5, 2, [1, 0, 0, 0]),
        (2, 3, 6, 3, [1, 0, 1, 0, 1]),
        (2, 4, 4, 3, [1, 0, 0, 0, 1]),
        (3, 2, 6, 2, [1, 0, 0, 1, 0]),
        (4, 11, 3, 5, [1, 0, 0, 1, 0, 0, 1]),
    ])
    def test_length_factors(self, len_h, len_x, up, down, expected, xp):
        # gh-9844: weird factors
        h = xp.zeros(len_h)
        h = xpx.at(h)[0].set(1.)
        x = xp.ones(len_x, dtype=xp.float64)
        y = upfirdn(h, x, up, down)
        expected = xp.asarray(expected, dtype=xp.float64)
        xp_assert_close(y, expected)

    @pytest.mark.parametrize(
        'dtype', ["int64", "float32", "complex64", "float64", "complex128"]
    )
    @pytest.mark.parametrize('down, want_len', [  # lengths from MATLAB
        (2, 5015),
        (11, 912),
        (79, 127),
    ])
    def test_vs_convolve(self, down, want_len, dtype, xp):
        # Check that up=1.0 gives same answer as convolve + slicing
        random_state = np.random.RandomState(17)
        size = 10000

        np_dtype = getattr(np, dtype)
        x = random_state.randn(size).astype(np_dtype)
        if np_dtype in (np.complex64, np.complex128):
            x += 1j * random_state.randn(size)

        dtype = getattr(xp, dtype)
        x = xp.asarray(x, dtype=dtype)

        h = xp.asarray(firwin(31, 1. / down, window='hamming'))
        yl = xp.asarray(upfirdn_naive(x, h, 1, down))
        y = upfirdn(h, x, up=1, down=down)
        assert y.shape == (want_len,)
        assert yl.shape[0] == y.shape[0]
        xp_assert_close(yl, y, atol=1e-7, rtol=1e-7)

    @skip_xp_backends(np_only=True, reason="apply_along_axis")
    @pytest.mark.parametrize('x_dtype', _UPFIRDN_TYPES)
    @pytest.mark.parametrize('h', (1., 1j))
    @pytest.mark.parametrize('up, down', [(1, 1), (2, 2), (3, 2), (2, 3)])
    def test_vs_naive_delta(self, x_dtype, h, up, down, xp):
        UpFIRDnCase(up, down, h, x_dtype)()

    @skip_xp_backends(np_only=True, reason="apply_along_axis")
    @pytest.mark.parametrize('x_dtype', _UPFIRDN_TYPES)
    @pytest.mark.parametrize('h_dtype', _UPFIRDN_TYPES)
    @pytest.mark.parametrize('p_max, q_max',
                             list(product((10, 100), (10, 100))))
    def test_vs_naive(self, x_dtype, h_dtype, p_max, q_max, xp):
        tests = self._random_factors(p_max, q_max, h_dtype, x_dtype)
        for test in tests:
            test()

    def _random_factors(self, p_max, q_max, h_dtype, x_dtype):
        n_rep = 3
        longest_h = 25
        random_state = np.random.RandomState(17)
        tests = []

        for _ in range(n_rep):
            # Randomize the up/down factors somewhat
            p_add = q_max if p_max > q_max else 1
            q_add = p_max if q_max > p_max else 1
            p = random_state.randint(p_max) + p_add
            q = random_state.randint(q_max) + q_add

            # Generate random FIR coefficients
            len_h = random_state.randint(longest_h) + 1
            h = np.atleast_1d(random_state.randint(len_h))
            h = h.astype(h_dtype)
            if h_dtype is complex:
                h += 1j * random_state.randint(len_h)

            tests.append(UpFIRDnCase(p, q, h, x_dtype))

        return tests

    @pytest.mark.parametrize('mode', _upfirdn_modes)
    def test_extensions(self, mode, xp):
        """Test vs. manually computed results for modes not in numpy's pad."""
        x = np.asarray([1, 2, 3, 1], dtype=np.float64)
        npre, npost = 6, 6
        y = _pad_test(x, npre=npre, npost=npost, mode=mode)

        x = xp.asarray(x)
        y = xp.asarray(y)
        if mode == 'antisymmetric':
            y_expected = xp.asarray(
                [3.0, 1, -1, -3, -2, -1, 1, 2, 3, 1, -1, -3, -2, -1, 1, 2])
        elif mode == 'antireflect':
            y_expected = xp.asarray(
                [1.0, 2, 3, 1, -1, 0, 1, 2, 3, 1, -1, 0, 1, 2, 3, 1])
        elif mode == 'smooth':
            y_expected = xp.asarray(
                [-5.0, -4, -3, -2, -1, 0, 1, 2, 3, 1, -1, -3, -5, -7, -9, -11])
        elif mode == "line":
            lin_slope = (x[-1] - x[0]) / (x.shape[0] - 1)
            left = x[0] + xp.arange(-npre, 0, 1, dtype=xp.float64) * lin_slope
            right = x[-1] + xp.arange(1, npost + 1, dtype=xp.float64) * lin_slope
            concat = array_namespace(left).concat
            y_expected = concat((left, x, right))
        else:
            y_expected = np.pad(np.asarray(x), (npre, npost), mode=mode)
            y_expected = xp.asarray(y_expected)

        y_expected = xp.asarray(y_expected, dtype=xp.float64)
        xp_assert_close(y, y_expected)

    @pytest.mark.parametrize(
        'size, h_len, mode, dtype',
        product(
            [8],
            [4, 5, 26],  # include cases with h_len > 2*size
            _upfirdn_modes,
            ["float32", "float64", "complex64", "complex128"],
        )
    )
    def test_modes(self, size, h_len, mode, dtype, xp):
        dtype_np = getattr(np, dtype)
        dtype_xp = getattr(xp, dtype)

        random_state = np.random.RandomState(5)
        x = random_state.randn(size).astype(dtype_np)
        if dtype in ("complex64", "complex128"):
            x += 1j * random_state.randn(size)
        h = np.arange(1, 1 + h_len, dtype=x.real.dtype)

        x = xp.asarray(x, dtype=dtype_xp)
        h = xp.asarray(h)

        y = upfirdn(h, x, up=1, down=1, mode=mode)
        # expected result: pad the input, filter with zero padding, then crop
        npad = h_len - 1
        if mode in ['antisymmetric', 'antireflect', 'smooth', 'line']:
            # use _pad_test test function for modes not supported by np.pad.
            xpad = _pad_test(np.asarray(x), npre=npad, npost=npad, mode=mode)
        else:
            xpad = np.pad(np.asarray(x), npad, mode=mode)

        xpad = xp.asarray(xpad)
        ypad = upfirdn(h, xpad, up=1, down=1, mode='constant')
        y_expected = ypad[npad:-npad]

        atol = rtol = xp.finfo(dtype_xp).eps * 1e2
        xp_assert_close(y, y_expected, atol=atol, rtol=rtol)


@skip_xp_backends(cpu_only=True, reason='Cython implementation')
def test_output_len_long_input(xp):
    # Regression test for gh-17375.  On Windows, a large enough input
    # that should have been well within the capabilities of 64 bit integers
    # would result in a 32 bit overflow because of a bug in Cython 0.29.32.
    len_h = 1001
    in_len = 10**8
    up = 320
    down = 441
    out_len = _output_len(len_h, in_len, up, down)
    # The expected value was computed "by hand" from the formula
    #   (((in_len - 1) * up + len_h) - 1) // down + 1
    assert out_len == 72562360
