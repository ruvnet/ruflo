# Copyright (c) 2017, The Chancellor, Masters and Scholars of the University
# of Oxford, and the Chebfun Developers. All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
#     * Redistributions of source code must retain the above copyright
#       notice, this list of conditions and the following disclaimer.
#     * Redistributions in binary form must reproduce the above copyright
#       notice, this list of conditions and the following disclaimer in the
#       documentation and/or other materials provided with the distribution.
#     * Neither the name of the University of Oxford nor the names of its
#       contributors may be used to endorse or promote products derived from
#       this software without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
# ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
# WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
# DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
# ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
# (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
# LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
# ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
# (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
# SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

from math import factorial

import numpy as np
from numpy.testing import assert_allclose, assert_equal, assert_array_less
import pytest
import scipy
from scipy.interpolate import AAA, FloaterHormannInterpolator, BarycentricInterpolator

TOL = 1e4 * np.finfo(np.float64).eps
UNIT_INTERVAL = np.linspace(-1, 1, num=1000)
PTS = np.logspace(-15, 0, base=10, num=500)
PTS = np.concatenate([-PTS[::-1], [0], PTS])


@pytest.mark.parametrize("method", [AAA, FloaterHormannInterpolator])
@pytest.mark.parametrize("dtype", [np.float32, np.float64, np.complex64, np.complex128])
def test_dtype_preservation(method, dtype):
    rtol = np.finfo(dtype).eps ** 0.75 * 100
    if method is FloaterHormannInterpolator:
        rtol *= 100
    rng = np.random.default_rng(59846294526092468)

    z = np.linspace(-1, 1, dtype=dtype)
    r = method(z, np.sin(z))

    z2 = rng.uniform(-1, 1, size=100).astype(dtype)
    assert_allclose(r(z2), np.sin(z2), rtol=rtol)
    assert r(z2).dtype == dtype

    if method is AAA:
        assert r.support_points.dtype == dtype
        assert r.support_values.dtype == dtype
        assert r.errors.dtype == z.real.dtype
    assert r.weights.dtype == dtype
    assert r.poles().dtype == np.result_type(dtype, 1j)
    assert r.residues().dtype == np.result_type(dtype, 1j)
    assert r.roots().dtype == np.result_type(dtype, 1j)


@pytest.mark.parametrize("method", [AAA, FloaterHormannInterpolator])
@pytest.mark.parametrize("dtype", [np.int16, np.int32, np.int64])
def test_integer_promotion(method, dtype):
    z = np.arange(10, dtype=dtype)
    r = method(z, z)
    assert r.weights.dtype == np.result_type(dtype, 1.0)
    if method is AAA:
        assert r.support_points.dtype == np.result_type(dtype, 1.0)
        assert r.support_values.dtype == np.result_type(dtype, 1.0)
        assert r.errors.dtype == np.result_type(dtype, 1.0)
    assert r.poles().dtype == np.result_type(dtype, 1j)
    assert r.residues().dtype == np.result_type(dtype, 1j)
    assert r.roots().dtype == np.result_type(dtype, 1j)

    assert r(z).dtype == np.result_type(dtype, 1.0)


class TestAAA:
    def test_input_validation(self):
        with pytest.raises(ValueError, match="same size"):
            AAA([0], [1, 1])
        with pytest.raises(ValueError, match="1-D"):
            AAA([[0], [0]], [[1], [1]])
        with pytest.raises(ValueError, match="finite"):
            AAA([np.inf], [1])
        with pytest.raises(TypeError):
            AAA([1], [1], max_terms=1.0)
        with pytest.raises(ValueError, match="greater"):
            AAA([1], [1], max_terms=-1)

    @pytest.mark.thread_unsafe
    def test_convergence_error(self):
        with pytest.warns(RuntimeWarning, match="AAA failed"):
            AAA(UNIT_INTERVAL, np.exp(UNIT_INTERVAL),  max_terms=1)

    # The following tests are based on:
    # https://github.com/chebfun/chebfun/blob/master/tests/chebfun/test_aaa.m
    def test_exp(self):
        f = np.exp(UNIT_INTERVAL)
        r = AAA(UNIT_INTERVAL, f)

        assert_allclose(r(UNIT_INTERVAL), f, atol=TOL)
        assert_equal(r(np.nan), np.nan)
        assert np.isfinite(r(np.inf))

        m1 = r.support_points.size
        r = AAA(UNIT_INTERVAL, f, rtol=1e-3)
        assert r.support_points.size < m1

    def test_tan(self):
        f = np.tan(np.pi * UNIT_INTERVAL)
        r = AAA(UNIT_INTERVAL, f)

        assert_allclose(r(UNIT_INTERVAL), f, atol=10 * TOL, rtol=1.4e-7)
        assert_allclose(np.min(np.abs(r.roots())), 0, atol=3e-10)
        assert_allclose(np.min(np.abs(r.poles() - 0.5)), 0, atol=TOL)
        # Test for spurious poles (poles with tiny residue are likely spurious)
        assert np.min(np.abs(r.residues())) > 1e-13

    def test_short_cases(self):
        # Computed using Chebfun:
        # >> format long
        # >> [r, pol, res, zer, zj, fj, wj, errvec] = aaa([1 2], [0 1])
        z = np.array([0, 1])
        f = np.array([1, 2])
        r = AAA(z, f, rtol=1e-13)
        assert_allclose(r(z), f, atol=TOL)
        assert_allclose(r.poles(), 0.5)
        assert_allclose(r.residues(), 0.25)
        assert_allclose(r.roots(), 1/3)
        assert_equal(r.support_points, z)
        assert_equal(r.support_values, f)
        assert_allclose(r.weights, [0.707106781186547, 0.707106781186547])
        assert_equal(r.errors, [1, 0])

        # >> format long
        # >> [r, pol, res, zer, zj, fj, wj, errvec] = aaa([1 0 0], [0 1 2])
        z = np.array([0, 1, 2])
        f = np.array([1, 0, 0])
        r = AAA(z, f, rtol=1e-13)
        assert_allclose(r(z), f, atol=TOL)
        assert_allclose(np.sort(r.poles()),
                        np.sort([1.577350269189626, 0.422649730810374]))
        assert_allclose(np.sort(r.residues()),
                        np.sort([-0.070441621801729, -0.262891711531604]))
        assert_allclose(np.sort(r.roots()), np.sort([2, 1]))
        assert_equal(r.support_points, z)
        assert_equal(r.support_values, f)
        assert_allclose(r.weights, [0.577350269189626, 0.577350269189626,
                                    0.577350269189626])
        assert_equal(r.errors, [1, 1, 0])

    def test_scale_invariance(self):
        z = np.linspace(0.3, 1.5)
        f = np.exp(z) / (1 + 1j)
        r1 = AAA(z, f)
        r2 = AAA(z, (2**311 * f).astype(np.complex128))
        r3 = AAA(z, (2**-311 * f).astype(np.complex128))
        assert_equal(r1(0.2j), 2**-311 * r2(0.2j))
        assert_equal(r1(1.4), 2**311 * r3(1.4))

    def test_log_func(self):
        rng = np.random.default_rng(1749382759832758297)
        z = rng.standard_normal(10000) + 3j * rng.standard_normal(10000)

        def f(z):
            return np.log(5 - z) / (1 + z**2)

        r = AAA(z, f(z))
        assert_allclose(r(0), f(0), atol=TOL)

    def test_infinite_data(self):
        z = np.linspace(-1, 1)
        r = AAA(z, scipy.special.gamma(z))
        assert_allclose(r(0.63), scipy.special.gamma(0.63), atol=1e-15)

    def test_nan(self):
        x = np.linspace(0, 20)
        with np.errstate(invalid="ignore"):
            f = np.sin(x) / x
        r = AAA(x, f)
        assert_allclose(r(2), np.sin(2) / 2, atol=1e-15)

    def test_residues(self):
        x = np.linspace(-1.337, 2, num=537)
        r = AAA(x, np.exp(x) / x)
        ii = np.flatnonzero(np.abs(r.poles()) < 1e-8)
        assert_allclose(r.residues()[ii], 1, atol=1e-15)

        r = AAA(x, (1 + 1j) * scipy.special.gamma(x))
        ii = np.flatnonzero(abs(r.poles() - (-1)) < 1e-8)
        assert_allclose(r.residues()[ii], -1 - 1j, atol=1e-15)

    # The following tests are based on:
    # https://github.com/complexvariables/RationalFunctionApproximation.jl/blob/main/test/interval.jl
    @pytest.mark.parametrize("func,atol,rtol",
                             [(lambda x: np.abs(x + 0.5 + 0.01j), 5e-13, 1e-7),
                              (lambda x: np.sin(1/(1.05 - x)), 2e-13, 1e-7),
                              (lambda x: np.exp(-1/(x**2)), 3.5e-12, 0),
                              (lambda x: np.exp(-100*x**2), 2e-12, 0),
                              (lambda x: np.exp(-10/(1.2 - x)), 1e-14, 0),
                              (lambda x: 1/(1+np.exp(100*(x + 0.5))), 2e-13, 1e-7),
                              (lambda x: np.abs(x - 0.95), 1e-6, 1e-7)])
    def test_basic_functions(self, func, atol, rtol):
        with np.errstate(divide="ignore"):
            f = func(PTS)
        assert_allclose(AAA(UNIT_INTERVAL, func(UNIT_INTERVAL))(PTS),
                        f, atol=atol, rtol=rtol)

    def test_poles_zeros_residues(self):
        def f(z):
            return (z+1) * (z+2) / ((z+3) * (z+4))
        r = AAA(UNIT_INTERVAL, f(UNIT_INTERVAL))
        assert_allclose(np.sum(r.poles() + r.roots()), -10, atol=1e-12)

        def f(z):
            return 2/(3 + z) + 5/(z - 2j)
        r = AAA(UNIT_INTERVAL, f(UNIT_INTERVAL))
        assert_allclose(r.residues().prod(), 10, atol=1e-8)

        r = AAA(UNIT_INTERVAL, np.sin(10*np.pi*UNIT_INTERVAL))
        assert_allclose(np.sort(np.abs(r.roots()))[18], 0.9, atol=1e-12)

        def f(z):
            return (z - (3 + 3j))/(z + 2)
        r = AAA(UNIT_INTERVAL, f(UNIT_INTERVAL))
        assert_allclose(r.poles()[0]*r.roots()[0],  -6-6j, atol=1e-12)

    @pytest.mark.parametrize("func",
                             [lambda z: np.zeros_like(z), lambda z: z, lambda z: 1j*z,
                              lambda z: z**2 + z, lambda z: z**3 + z,
                              lambda z: 1/(1.1 + z), lambda z: 1/(1 + 1j*z),
                              lambda z: 1/(3 + z + z**2), lambda z: 1/(1.01 + z**3)])
    def test_polynomials_and_reciprocals(self, func):
        assert_allclose(AAA(UNIT_INTERVAL, func(UNIT_INTERVAL))(PTS),
                        func(PTS), atol=2e-13)

    # The following tests are taken from:
    # https://github.com/macd/BaryRational.jl/blob/main/test/test_aaa.jl
    def test_spiral(self):
        z = np.exp(np.linspace(-0.5, 0.5 + 15j*np.pi, num=1000))
        r = AAA(z, np.tan(np.pi*z/2))
        assert_allclose(np.sort(np.abs(r.poles()))[:4], [1, 1, 3, 3], rtol=9e-7)

    @pytest.mark.thread_unsafe
    def test_spiral_cleanup(self):
        z = np.exp(np.linspace(-0.5, 0.5 + 15j*np.pi, num=1000))
        # here we set `rtol=0` to force froissart doublets, without cleanup there
        # are many spurious poles
        with pytest.warns(RuntimeWarning):
            r = AAA(z, np.tan(np.pi*z/2), rtol=0, max_terms=60, clean_up=False)
        n_spurious = np.sum(np.abs(r.residues()) < 1e-14)
        with pytest.warns(RuntimeWarning):
            assert r.clean_up() >= 1
        # check there are less potentially spurious poles than before
        assert np.sum(np.abs(r.residues()) < 1e-14) < n_spurious
        # check accuracy
        assert_allclose(r(z), np.tan(np.pi*z/2), atol=6e-12, rtol=3e-12)


class TestFloaterHormann:
    def runge(self, z):
        return 1/(1 + z**2)

    def scale(self, n, d):
        return (-1)**(np.arange(n) + d) * factorial(d)

    def test_iv(self):
        with pytest.raises(ValueError, match="`x`"):
            FloaterHormannInterpolator([[0]], [0], d=0)
        with pytest.raises(ValueError, match="`y`"):
            FloaterHormannInterpolator([0], 0, d=0)
        with pytest.raises(ValueError, match="dimension"):
            FloaterHormannInterpolator([0], [[1, 1], [1, 1]], d=0)
        with pytest.raises(ValueError, match="finite"):
            FloaterHormannInterpolator([np.inf], [1], d=0)
        with pytest.raises(ValueError, match="`d`"):
            FloaterHormannInterpolator([0], [0], d=-1)
        with pytest.raises(ValueError, match="`d`"):
            FloaterHormannInterpolator([0], [0], d=10)
        with pytest.raises(TypeError):
            FloaterHormannInterpolator([0], [0], d=0.0)

    # reference values from Floater and Hormann 2007 page 8.
    @pytest.mark.parametrize("d,expected", [
        (0, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
        (1, [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1]),
        (2, [1, 3, 4, 4, 4, 4, 4, 4, 4, 3, 1]),
        (3, [1, 4, 7, 8, 8, 8, 8, 8, 7, 4, 1]),
        (4, [1, 5, 11, 15, 16, 16, 16, 15, 11, 5, 1])
    ])
    def test_uniform_grid(self, d, expected):
        # Check against explicit results on an uniform grid
        x = np.arange(11)
        r = FloaterHormannInterpolator(x, 0.0*x, d=d)
        assert_allclose(r.weights.ravel()*self.scale(x.size, d), expected,
                        rtol=1e-15, atol=1e-15)

    @pytest.mark.parametrize("d", range(10))
    def test_runge(self, d):
        x = np.linspace(0, 1, 51)
        rng = np.random.default_rng(802754237598370893)
        xx = rng.uniform(0, 1, size=1000)
        y = self.runge(x)
        h = x[1] - x[0]

        r = FloaterHormannInterpolator(x, y, d=d)

        tol = 10*h**(d+1)
        assert_allclose(r(xx), self.runge(xx), atol=1e-10, rtol=tol)
        # check interpolation property
        assert_equal(r(x), self.runge(x))

    def test_complex(self):
        x = np.linspace(-1, 1)
        z = x + x*1j
        r = FloaterHormannInterpolator(z, np.sin(z), d=12)
        xx = np.linspace(-1, 1, num=1000)
        zz = xx + xx*1j
        assert_allclose(r(zz), np.sin(zz), rtol=1e-12)

    def test_polyinterp(self):
        # check that when d=n-1 FH gives a polynomial interpolant
        x = np.linspace(0, 1, 11)
        xx = np.linspace(0, 1, 1001)
        y = np.sin(x)
        r = FloaterHormannInterpolator(x, y, d=x.size-1)
        p = BarycentricInterpolator(x, y)
        assert_allclose(r(xx), p(xx), rtol=1e-12, atol=1e-12)

    @pytest.mark.parametrize("y_shape", [(2,), (2, 3, 1), (1, 5, 6, 4)])
    @pytest.mark.parametrize("xx_shape", [(100), (10, 10)])
    def test_trailing_dim(self, y_shape, xx_shape):
        x = np.linspace(0, 1)
        y = np.broadcast_to(
            np.expand_dims(np.sin(x), tuple(range(1, len(y_shape) + 1))),
            x.shape + y_shape
        )

        r = FloaterHormannInterpolator(x, y)

        rng = np.random.default_rng(897138947238097528091759187597)
        xx = rng.random(xx_shape)
        yy = np.broadcast_to(
            np.expand_dims(np.sin(xx), tuple(range(xx.ndim, len(y_shape) + xx.ndim))),
            xx.shape + y_shape
        )
        rr = r(xx)
        assert rr.shape == xx.shape + y_shape
        assert_allclose(rr, yy, rtol=1e-6)

    def test_zeros(self):
        x = np.linspace(0, 10, num=100)
        r = FloaterHormannInterpolator(x, np.sin(np.pi*x))

        err = np.abs(np.subtract.outer(r.roots(), np.arange(11))).min(axis=0)
        assert_array_less(err, 1e-5)

    def test_no_poles(self):
        x = np.linspace(-1, 1)
        r = FloaterHormannInterpolator(x, 1/x**2)
        p = r.poles()
        mask = (p.real >= -1) & (p.real <= 1) & (np.abs(p.imag) < 1.e-12)
        assert np.sum(mask) == 0
