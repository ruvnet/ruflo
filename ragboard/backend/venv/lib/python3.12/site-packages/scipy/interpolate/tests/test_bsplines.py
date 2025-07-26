import os
import operator
import itertools
import math
import threading
import copy

import numpy as np
from numpy.testing import suppress_warnings
from scipy._lib._array_api import xp_assert_equal, xp_assert_close
from pytest import raises as assert_raises
import pytest

from scipy.interpolate import (
        BSpline, BPoly, PPoly, make_interp_spline, make_lsq_spline,
        splev, splrep, splprep, splder, splantider, sproot, splint, insert,
        CubicSpline, NdBSpline, make_smoothing_spline, RegularGridInterpolator,
)
import scipy.linalg as sl
import scipy.sparse.linalg as ssl

from scipy.interpolate._bsplines import (_not_a_knot, _augknt,
                                        _woodbury_algorithm, _periodic_knots,
                                         _make_interp_per_full_matr)

from scipy.interpolate import generate_knots, make_splrep, make_splprep

import scipy.interpolate._fitpack_impl as _impl
from scipy._lib._util import AxisError
from scipy._lib._testutils import _run_concurrent_barrier

# XXX: move to the interpolate namespace
from scipy.interpolate._ndbspline import make_ndbspl

from scipy.interpolate import _dfitpack as dfitpack
from scipy.interpolate import _bsplines as _b
from scipy.interpolate import _dierckx


class TestBSpline:

    def test_ctor(self):
        # knots should be an ordered 1-D array of finite real numbers
        assert_raises((TypeError, ValueError), BSpline,
                **dict(t=[1, 1.j], c=[1.], k=0))
        with np.errstate(invalid='ignore'):
            assert_raises(ValueError, BSpline, **dict(t=[1, np.nan], c=[1.], k=0))
        assert_raises(ValueError, BSpline, **dict(t=[1, np.inf], c=[1.], k=0))
        assert_raises(ValueError, BSpline, **dict(t=[1, -1], c=[1.], k=0))
        assert_raises(ValueError, BSpline, **dict(t=[[1], [1]], c=[1.], k=0))

        # for n+k+1 knots and degree k need at least n coefficients
        assert_raises(ValueError, BSpline, **dict(t=[0, 1, 2], c=[1], k=0))
        assert_raises(ValueError, BSpline,
                **dict(t=[0, 1, 2, 3, 4], c=[1., 1.], k=2))

        # non-integer orders
        assert_raises(TypeError, BSpline,
                **dict(t=[0., 0., 1., 2., 3., 4.], c=[1., 1., 1.], k="cubic"))
        assert_raises(TypeError, BSpline,
                **dict(t=[0., 0., 1., 2., 3., 4.], c=[1., 1., 1.], k=2.5))

        # basic interval cannot have measure zero (here: [1..1])
        assert_raises(ValueError, BSpline,
                **dict(t=[0., 0, 1, 1, 2, 3], c=[1., 1, 1], k=2))

        # tck vs self.tck
        n, k = 11, 3
        t = np.arange(n+k+1, dtype=np.float64)
        c = np.random.random(n)
        b = BSpline(t, c, k)

        xp_assert_close(t, b.t)
        xp_assert_close(c, b.c)
        assert k == b.k

    def test_tck(self):
        b = _make_random_spline()
        tck = b.tck

        xp_assert_close(b.t, tck[0], atol=1e-15, rtol=1e-15)
        xp_assert_close(b.c, tck[1], atol=1e-15, rtol=1e-15)
        assert b.k == tck[2]

        # b.tck is read-only
        with pytest.raises(AttributeError):
            b.tck = 'foo'

    def test_degree_0(self):
        xx = np.linspace(0, 1, 10)

        b = BSpline(t=[0, 1], c=[3.], k=0)
        xp_assert_close(b(xx), np.ones_like(xx) * 3.0)

        b = BSpline(t=[0, 0.35, 1], c=[3, 4], k=0)
        xp_assert_close(b(xx), np.where(xx < 0.35, 3.0, 4.0))

    def test_degree_1(self):
        t = [0, 1, 2, 3, 4]
        c = [1, 2, 3]
        k = 1
        b = BSpline(t, c, k)

        x = np.linspace(1, 3, 50)
        xp_assert_close(c[0]*B_012(x) + c[1]*B_012(x-1) + c[2]*B_012(x-2),
                        b(x), atol=1e-14)
        xp_assert_close(splev(x, (t, c, k)), b(x), atol=1e-14)

    def test_bernstein(self):
        # a special knot vector: Bernstein polynomials
        k = 3
        t = np.asarray([0]*(k+1) + [1]*(k+1))
        c = np.asarray([1., 2., 3., 4.])
        bp = BPoly(c.reshape(-1, 1), [0, 1])
        bspl = BSpline(t, c, k)

        xx = np.linspace(-1., 2., 10)
        xp_assert_close(bp(xx, extrapolate=True),
                        bspl(xx, extrapolate=True), atol=1e-14)
        xp_assert_close(splev(xx, (t, c, k)),
                        bspl(xx), atol=1e-14)

    def test_rndm_naive_eval(self):
        # test random coefficient spline *on the base interval*,
        # t[k] <= x < t[-k-1]
        b = _make_random_spline()
        t, c, k = b.tck
        xx = np.linspace(t[k], t[-k-1], 50)
        y_b = b(xx)

        y_n = [_naive_eval(x, t, c, k) for x in xx]
        xp_assert_close(y_b, y_n, atol=1e-14)

        y_n2 = [_naive_eval_2(x, t, c, k) for x in xx]
        xp_assert_close(y_b, y_n2, atol=1e-14)

    def test_rndm_splev(self):
        b = _make_random_spline()
        t, c, k = b.tck
        xx = np.linspace(t[k], t[-k-1], 50)
        xp_assert_close(b(xx), splev(xx, (t, c, k)), atol=1e-14)

    def test_rndm_splrep(self):
        rng = np.random.RandomState(1234)
        x = np.sort(rng.random(20))
        y = rng.random(20)

        tck = splrep(x, y)
        b = BSpline(*tck)

        t, k = b.t, b.k
        xx = np.linspace(t[k], t[-k-1], 80)
        xp_assert_close(b(xx), splev(xx, tck), atol=1e-14)

    def test_rndm_unity(self):
        b = _make_random_spline()
        b.c = np.ones_like(b.c)
        xx = np.linspace(b.t[b.k], b.t[-b.k-1], 100)
        xp_assert_close(b(xx), np.ones_like(xx))

    def test_vectorization(self):
        rng = np.random.RandomState(1234)
        n, k = 22, 3
        t = np.sort(rng.random(n))
        c = rng.random(size=(n, 6, 7))
        b = BSpline(t, c, k)
        tm, tp = t[k], t[-k-1]
        xx = tm + (tp - tm) * rng.random((3, 4, 5))
        assert b(xx).shape == (3, 4, 5, 6, 7)

    def test_len_c(self):
        # for n+k+1 knots, only first n coefs are used.
        # and BTW this is consistent with FITPACK
        rng = np.random.RandomState(1234)
        n, k = 33, 3
        t = np.sort(rng.random(n+k+1))
        c = rng.random(n)

        # pad coefficients with random garbage
        c_pad = np.r_[c, rng.random(k+1)]

        b, b_pad = BSpline(t, c, k), BSpline(t, c_pad, k)

        dt = t[-1] - t[0]
        xx = np.linspace(t[0] - dt, t[-1] + dt, 50)
        xp_assert_close(b(xx), b_pad(xx), atol=1e-14)
        xp_assert_close(b(xx), splev(xx, (t, c, k)), atol=1e-14)
        xp_assert_close(b(xx), splev(xx, (t, c_pad, k)), atol=1e-14)

    def test_endpoints(self, num_parallel_threads):
        # base interval is closed
        b = _make_random_spline()
        t, _, k = b.tck
        tm, tp = t[k], t[-k-1]
        # atol = 1e-9 if num_parallel_threads == 1 else 1e-7
        for extrap in (True, False):
            xp_assert_close(b([tm, tp], extrap),
                            b([tm + 1e-10, tp - 1e-10], extrap), atol=1e-9, rtol=1e-7)

    def test_continuity(self, num_parallel_threads):
        # assert continuity at internal knots
        b = _make_random_spline()
        t, _, k = b.tck
        xp_assert_close(b(t[k+1:-k-1] - 1e-10), b(t[k+1:-k-1] + 1e-10),
                atol=1e-9)

    def test_extrap(self):
        b = _make_random_spline()
        t, c, k = b.tck
        dt = t[-1] - t[0]
        xx = np.linspace(t[k] - dt, t[-k-1] + dt, 50)
        mask = (t[k] < xx) & (xx < t[-k-1])

        # extrap has no effect within the base interval
        xp_assert_close(b(xx[mask], extrapolate=True),
                        b(xx[mask], extrapolate=False))

        # extrapolated values agree with FITPACK
        xp_assert_close(b(xx, extrapolate=True),
                splev(xx, (t, c, k), ext=0))

    def test_default_extrap(self):
        # BSpline defaults to extrapolate=True
        b = _make_random_spline()
        t, _, k = b.tck
        xx = [t[0] - 1, t[-1] + 1]
        yy = b(xx)
        assert not np.all(np.isnan(yy))

    def test_periodic_extrap(self):
        rng = np.random.RandomState(1234)
        t = np.sort(rng.random(8))
        c = rng.random(4)
        k = 3
        b = BSpline(t, c, k, extrapolate='periodic')
        n = t.size - (k + 1)

        dt = t[-1] - t[0]
        xx = np.linspace(t[k] - dt, t[n] + dt, 50)
        xy = t[k] + (xx - t[k]) % (t[n] - t[k])
        xp_assert_close(b(xx), splev(xy, (t, c, k)))

        # Direct check
        xx = [-1, 0, 0.5, 1]
        xy = t[k] + (xx - t[k]) % (t[n] - t[k])
        xp_assert_equal(b(xx, extrapolate='periodic'), b(xy, extrapolate=True))

    def test_ppoly(self):
        b = _make_random_spline()
        t, c, k = b.tck
        pp = PPoly.from_spline((t, c, k))

        xx = np.linspace(t[k], t[-k], 100)
        xp_assert_close(b(xx), pp(xx), atol=1e-14, rtol=1e-14)

    def test_derivative_rndm(self):
        b = _make_random_spline()
        t, c, k = b.tck
        xx = np.linspace(t[0], t[-1], 50)
        xx = np.r_[xx, t]

        for der in range(1, k+1):
            yd = splev(xx, (t, c, k), der=der)
            xp_assert_close(yd, b(xx, nu=der), atol=1e-14)

        # higher derivatives all vanish
        xp_assert_close(b(xx, nu=k+1), np.zeros_like(xx), atol=1e-14)

    def test_derivative_jumps(self):
        # example from de Boor, Chap IX, example (24)
        # NB: knots augmented & corresp coefs are zeroed out
        # in agreement with the convention (29)
        k = 2
        t = [-1, -1, 0, 1, 1, 3, 4, 6, 6, 6, 7, 7]
        rng = np.random.RandomState(1234)
        c = np.r_[0, 0, rng.random(5), 0, 0]
        b = BSpline(t, c, k)

        # b is continuous at x != 6 (triple knot)
        x = np.asarray([1, 3, 4, 6])
        xp_assert_close(b(x[x != 6] - 1e-10),
                        b(x[x != 6] + 1e-10))
        assert not np.allclose(b(6.-1e-10), b(6+1e-10))

        # 1st derivative jumps at double knots, 1 & 6:
        x0 = np.asarray([3, 4])
        xp_assert_close(b(x0 - 1e-10, nu=1),
                        b(x0 + 1e-10, nu=1))
        x1 = np.asarray([1, 6])
        assert not np.allclose(b(x1 - 1e-10, nu=1), b(x1 + 1e-10, nu=1))

        # 2nd derivative is not guaranteed to be continuous either
        assert not np.allclose(b(x - 1e-10, nu=2), b(x + 1e-10, nu=2))

    def test_basis_element_quadratic(self):
        xx = np.linspace(-1, 4, 20)
        b = BSpline.basis_element(t=[0, 1, 2, 3])
        xp_assert_close(b(xx),
                        splev(xx, (b.t, b.c, b.k)), atol=1e-14)
        xp_assert_close(b(xx),
                        B_0123(xx), atol=1e-14)

        b = BSpline.basis_element(t=[0, 1, 1, 2])
        xx = np.linspace(0, 2, 10)
        xp_assert_close(b(xx),
                np.where(xx < 1, xx*xx, (2.-xx)**2), atol=1e-14)

    def test_basis_element_rndm(self):
        b = _make_random_spline()
        t, c, k = b.tck
        xx = np.linspace(t[k], t[-k-1], 20)
        xp_assert_close(b(xx), _sum_basis_elements(xx, t, c, k), atol=1e-14)

    def test_cmplx(self):
        b = _make_random_spline()
        t, c, k = b.tck
        cc = c * (1. + 3.j)

        b = BSpline(t, cc, k)
        b_re = BSpline(t, b.c.real, k)
        b_im = BSpline(t, b.c.imag, k)

        xx = np.linspace(t[k], t[-k-1], 20)
        xp_assert_close(b(xx).real, b_re(xx), atol=1e-14)
        xp_assert_close(b(xx).imag, b_im(xx), atol=1e-14)

    def test_nan(self):
        # nan in, nan out.
        b = BSpline.basis_element([0, 1, 1, 2])
        assert np.isnan(b(np.nan))

    def test_derivative_method(self):
        b = _make_random_spline(k=5)
        t, c, k = b.tck
        b0 = BSpline(t, c, k)
        xx = np.linspace(t[k], t[-k-1], 20)
        for j in range(1, k):
            b = b.derivative()
            xp_assert_close(b0(xx, j), b(xx), atol=1e-12, rtol=1e-12)

    def test_antiderivative_method(self):
        b = _make_random_spline()
        t, c, k = b.tck
        xx = np.linspace(t[k], t[-k-1], 20)
        xp_assert_close(b.antiderivative().derivative()(xx),
                        b(xx), atol=1e-14, rtol=1e-14)

        # repeat with N-D array for c
        c = np.c_[c, c, c]
        c = np.dstack((c, c))
        b = BSpline(t, c, k)
        xp_assert_close(b.antiderivative().derivative()(xx),
                        b(xx), atol=1e-14, rtol=1e-14)

    def test_integral(self):
        b = BSpline.basis_element([0, 1, 2])  # x for x < 1 else 2 - x
        xp_assert_close(b.integrate(0, 1), np.asarray(0.5))
        xp_assert_close(b.integrate(1, 0), np.asarray(-1 * 0.5))
        xp_assert_close(b.integrate(1, 0), np.asarray(-0.5))

        # extrapolate or zeros outside of [0, 2]; default is yes
        xp_assert_close(b.integrate(-1, 1), np.asarray(0.0))
        xp_assert_close(b.integrate(-1, 1, extrapolate=True), np.asarray(0.0))
        xp_assert_close(b.integrate(-1, 1, extrapolate=False), np.asarray(0.5))
        xp_assert_close(b.integrate(1, -1, extrapolate=False), np.asarray(-1 * 0.5))

        # Test ``_fitpack._splint()``
        xp_assert_close(b.integrate(1, -1, extrapolate=False),
                        np.asarray(_impl.splint(1, -1, b.tck)))

        # Test ``extrapolate='periodic'``.
        b.extrapolate = 'periodic'
        i = b.antiderivative()
        period_int = np.asarray(i(2) - i(0))

        xp_assert_close(b.integrate(0, 2), period_int)
        xp_assert_close(b.integrate(2, 0), np.asarray(-1 * period_int))
        xp_assert_close(b.integrate(-9, -7), period_int)
        xp_assert_close(b.integrate(-8, -4), np.asarray(2 * period_int))

        xp_assert_close(b.integrate(0.5, 1.5),
                        np.asarray(i(1.5) - i(0.5)))
        xp_assert_close(b.integrate(1.5, 3),
                        np.asarray(i(1) - i(0) + i(2) - i(1.5)))
        xp_assert_close(b.integrate(1.5 + 12, 3 + 12),
                        np.asarray(i(1) - i(0) + i(2) - i(1.5)))
        xp_assert_close(b.integrate(1.5, 3 + 12),
                        np.asarray(i(1) - i(0) + i(2) - i(1.5) + 6 * period_int))

        xp_assert_close(b.integrate(0, -1), np.asarray(i(0) - i(1)))
        xp_assert_close(b.integrate(-9, -10), np.asarray(i(0) - i(1)))
        xp_assert_close(b.integrate(0, -9),
                        np.asarray(i(1) - i(2) - 4 * period_int))

    def test_integrate_ppoly(self):
        # test .integrate method to be consistent with PPoly.integrate
        x = [0, 1, 2, 3, 4]
        b = make_interp_spline(x, x)
        b.extrapolate = 'periodic'
        p = PPoly.from_spline(b)

        for x0, x1 in [(-5, 0.5), (0.5, 5), (-4, 13)]:
            xp_assert_close(b.integrate(x0, x1),
                            p.integrate(x0, x1))

    def test_integrate_0D_always(self):
        # make sure the result is always a 0D array (not a python scalar)
        b = BSpline.basis_element([0, 1, 2])
        for extrapolate in (True, False):
            res = b.integrate(0, 1, extrapolate=extrapolate)
            assert isinstance(res, np.ndarray)
            assert res.ndim == 0

    def test_subclassing(self):
        # classmethods should not decay to the base class
        class B(BSpline):
            pass

        b = B.basis_element([0, 1, 2, 2])
        assert b.__class__ == B
        assert b.derivative().__class__ == B
        assert b.antiderivative().__class__ == B

    @pytest.mark.parametrize('axis', range(-4, 4))
    def test_axis(self, axis):
        n, k = 22, 3
        t = np.linspace(0, 1, n + k + 1)
        sh = [6, 7, 8]
        # We need the positive axis for some of the indexing and slices used
        # in this test.
        pos_axis = axis % 4
        sh.insert(pos_axis, n)   # [22, 6, 7, 8] etc
        sh = tuple(sh)
        rng = np.random.RandomState(1234)
        c = rng.random(size=sh)
        b = BSpline(t, c, k, axis=axis)
        assert b.c.shape == (sh[pos_axis],) + sh[:pos_axis] + sh[pos_axis+1:]

        xp = rng.random((3, 4, 5))
        assert b(xp).shape == sh[:pos_axis] + xp.shape + sh[pos_axis+1:]

        # -c.ndim <= axis < c.ndim
        for ax in [-c.ndim - 1, c.ndim]:
            assert_raises(AxisError, BSpline,
                          **dict(t=t, c=c, k=k, axis=ax))

        # derivative, antiderivative keeps the axis
        for b1 in [BSpline(t, c, k, axis=axis).derivative(),
                   BSpline(t, c, k, axis=axis).derivative(2),
                   BSpline(t, c, k, axis=axis).antiderivative(),
                   BSpline(t, c, k, axis=axis).antiderivative(2)]:
            assert b1.axis == b.axis

    def test_neg_axis(self):
        k = 2
        t = [0, 1, 2, 3, 4, 5, 6]
        c = np.array([[-1, 2, 0, -1], [2, 0, -3, 1]])

        spl = BSpline(t, c, k, axis=-1)
        spl0 = BSpline(t, c[0], k)
        spl1 = BSpline(t, c[1], k)
        xp_assert_equal(spl(2.5), [spl0(2.5), spl1(2.5)])

    @pytest.mark.thread_unsafe
    def test_design_matrix_bc_types(self):
        '''
        Splines with different boundary conditions are built on different
        types of vectors of knots. As far as design matrix depends only on
        vector of knots, `k` and `x` it is useful to make tests for different
        boundary conditions (and as following different vectors of knots).
        '''
        def run_design_matrix_tests(n, k, bc_type):
            '''
            To avoid repetition of code the following function is provided.
            '''
            rng = np.random.RandomState(1234)
            x = np.sort(rng.random_sample(n) * 40 - 20)
            y = rng.random_sample(n) * 40 - 20
            if bc_type == "periodic":
                y[0] = y[-1]

            bspl = make_interp_spline(x, y, k=k, bc_type=bc_type)

            c = np.eye(len(bspl.t) - k - 1)
            des_matr_def = BSpline(bspl.t, c, k)(x)
            des_matr_csr = BSpline.design_matrix(x,
                                                 bspl.t,
                                                 k).toarray()
            xp_assert_close(des_matr_csr @ bspl.c, y, atol=1e-14)
            xp_assert_close(des_matr_def, des_matr_csr, atol=1e-14)

        # "clamped" and "natural" work only with `k = 3`
        n = 11
        k = 3
        for bc in ["clamped", "natural"]:
            run_design_matrix_tests(n, k, bc)

        # "not-a-knot" works with odd `k`
        for k in range(3, 8, 2):
            run_design_matrix_tests(n, k, "not-a-knot")

        # "periodic" works with any `k` (even more than `n`)
        n = 5  # smaller `n` to test `k > n` case
        for k in range(2, 7):
            run_design_matrix_tests(n, k, "periodic")

    @pytest.mark.parametrize('extrapolate', [False, True, 'periodic'])
    @pytest.mark.parametrize('degree', range(5))
    def test_design_matrix_same_as_BSpline_call(self, extrapolate, degree):
        """Test that design_matrix(x) is equivalent to BSpline(..)(x)."""
        rng = np.random.RandomState(1234)
        x = rng.random_sample(10 * (degree + 1))
        xmin, xmax = np.amin(x), np.amax(x)
        k = degree
        t = np.r_[np.linspace(xmin - 2, xmin - 1, degree),
                  np.linspace(xmin, xmax, 2 * (degree + 1)),
                  np.linspace(xmax + 1, xmax + 2, degree)]
        c = np.eye(len(t) - k - 1)
        bspline = BSpline(t, c, k, extrapolate)
        xp_assert_close(
            bspline(x), BSpline.design_matrix(x, t, k, extrapolate).toarray()
        )

        # extrapolation regime
        x = np.array([xmin - 10, xmin - 1, xmax + 1.5, xmax + 10])
        if not extrapolate:
            with pytest.raises(ValueError):
                BSpline.design_matrix(x, t, k, extrapolate)
        else:
            xp_assert_close(
                bspline(x),
                BSpline.design_matrix(x, t, k, extrapolate).toarray()
            )

    def test_design_matrix_x_shapes(self):
        # test for different `x` shapes
        rng = np.random.RandomState(1234)
        n = 10
        k = 3
        x = np.sort(rng.random_sample(n) * 40 - 20)
        y = rng.random_sample(n) * 40 - 20

        bspl = make_interp_spline(x, y, k=k)
        for i in range(1, 4):
            xc = x[:i]
            yc = y[:i]
            des_matr_csr = BSpline.design_matrix(xc,
                                                 bspl.t,
                                                 k).toarray()
            xp_assert_close(des_matr_csr @ bspl.c, yc, atol=1e-14)

    def test_design_matrix_t_shapes(self):
        # test for minimal possible `t` shape
        t = [1., 1., 1., 2., 3., 4., 4., 4.]
        des_matr = BSpline.design_matrix(2., t, 3).toarray()
        xp_assert_close(des_matr,
                        [[0.25, 0.58333333, 0.16666667, 0.]],
                        atol=1e-14)

    def test_design_matrix_asserts(self):
        rng = np.random.RandomState(1234)
        n = 10
        k = 3
        x = np.sort(rng.random_sample(n) * 40 - 20)
        y = rng.random_sample(n) * 40 - 20
        bspl = make_interp_spline(x, y, k=k)
        # invalid vector of knots (should be a 1D non-descending array)
        # here the actual vector of knots is reversed, so it is invalid
        with assert_raises(ValueError):
            BSpline.design_matrix(x, bspl.t[::-1], k)
        k = 2
        t = [0., 1., 2., 3., 4., 5.]
        x = [1., 2., 3., 4.]
        # out of bounds
        with assert_raises(ValueError):
            BSpline.design_matrix(x, t, k)

    @pytest.mark.parametrize('bc_type', ['natural', 'clamped',
                                         'periodic', 'not-a-knot'])
    def test_from_power_basis(self, bc_type):
        rng = np.random.RandomState(1234)
        x = np.sort(rng.random(20))
        y = rng.random(20)
        if bc_type == 'periodic':
            y[-1] = y[0]
        cb = CubicSpline(x, y, bc_type=bc_type)
        bspl = BSpline.from_power_basis(cb, bc_type=bc_type)
        xx = np.linspace(0, 1, 20)
        xp_assert_close(cb(xx), bspl(xx), atol=1e-15)
        bspl_new = make_interp_spline(x, y, bc_type=bc_type)
        xp_assert_close(bspl.c, bspl_new.c, atol=1e-15)

    @pytest.mark.parametrize('bc_type', ['natural', 'clamped',
                                         'periodic', 'not-a-knot'])
    def test_from_power_basis_complex(self, bc_type):
        rng = np.random.RandomState(1234)
        x = np.sort(rng.random(20))
        y = rng.random(20) + rng.random(20) * 1j
        if bc_type == 'periodic':
            y[-1] = y[0]
        cb = CubicSpline(x, y, bc_type=bc_type)
        bspl = BSpline.from_power_basis(cb, bc_type=bc_type)
        bspl_new_real = make_interp_spline(x, y.real, bc_type=bc_type)
        bspl_new_imag = make_interp_spline(x, y.imag, bc_type=bc_type)
        xp_assert_close(bspl.c, bspl_new_real.c + 1j * bspl_new_imag.c, atol=1e-15)

    def test_from_power_basis_exmp(self):
        '''
        For x = [0, 1, 2, 3, 4] and y = [1, 1, 1, 1, 1]
        the coefficients of Cubic Spline in the power basis:

        $[[0, 0, 0, 0, 0],\\$
        $[0, 0, 0, 0, 0],\\$
        $[0, 0, 0, 0, 0],\\$
        $[1, 1, 1, 1, 1]]$

        It could be shown explicitly that coefficients of the interpolating
        function in B-spline basis are c = [1, 1, 1, 1, 1, 1, 1]
        '''
        x = np.array([0, 1, 2, 3, 4])
        y = np.array([1, 1, 1, 1, 1])
        bspl = BSpline.from_power_basis(CubicSpline(x, y, bc_type='natural'),
                                        bc_type='natural')
        xp_assert_close(bspl.c, [1.0, 1, 1, 1, 1, 1, 1], atol=1e-15)

    def test_read_only(self):
        # BSpline must work on read-only knots and coefficients.
        t = np.array([0, 1])
        c = np.array([3.0])
        t.setflags(write=False)
        c.setflags(write=False)

        xx = np.linspace(0, 1, 10)
        xx.setflags(write=False)

        b = BSpline(t=t, c=c, k=0)
        xp_assert_close(b(xx), np.ones_like(xx) * 3.0)

    @pytest.mark.thread_unsafe
    def test_concurrency(self):
        # Check that no segfaults appear with concurrent access to BSpline
        b = _make_random_spline()

        def worker_fn(_, b):
            t, _, k = b.tck
            xx = np.linspace(t[k], t[-k-1], 10000)
            b(xx)

        _run_concurrent_barrier(10, worker_fn, b)


    def test_memmap(self, tmpdir):
        # Make sure that memmaps can be used as t and c atrributes after the
        # spline has been constructed. This is similar to what happens in a
        # scikit-learn context, where joblib can create read-only memmap to
        # share objects between workers. For more details, see
        # https://github.com/scipy/scipy/issues/22143
        b = _make_random_spline()
        xx = np.linspace(0, 1, 10)

        expected = b(xx)

        tid = threading.get_native_id()
        t_mm = np.memmap(str(tmpdir.join(f't{tid}.dat')), mode='w+',
                         dtype=b.t.dtype, shape=b.t.shape)
        t_mm[:] = b.t
        c_mm = np.memmap(str(tmpdir.join(f'c{tid}.dat')), mode='w+',
                         dtype=b.c.dtype, shape=b.c.shape)
        c_mm[:] = b.c
        b.t = t_mm
        b.c = c_mm

        xp_assert_close(b(xx), expected)


class TestInsert:

    @pytest.mark.parametrize('xval', [0.0, 1.0, 2.5, 4, 6.5, 7.0])
    def test_insert(self, xval):
        # insert a knot, incl edges (0.0, 7.0) and exactly at an existing knot (4.0)
        x = np.arange(8)
        y = np.sin(x)**3
        spl = make_interp_spline(x, y, k=3)

        spl_1f = insert(xval, spl)     # FITPACK
        spl_1 = spl.insert_knot(xval)

        xp_assert_close(spl_1.t, spl_1f.t, atol=1e-15)
        xp_assert_close(spl_1.c, spl_1f.c[:-spl.k-1], atol=1e-15)

        # knot insertion preserves values, unless multiplicity >= k+1
        xx = x if xval != x[-1] else x[:-1]
        xx = np.r_[xx, 0.5*(x[1:] + x[:-1])]
        xp_assert_close(spl(xx), spl_1(xx), atol=1e-15)

        # ... repeat with ndim > 1
        y1 = np.cos(x)**3
        spl_y1 = make_interp_spline(x, y1, k=3)
        spl_yy = make_interp_spline(x, np.c_[y, y1], k=3)
        spl_yy1 = spl_yy.insert_knot(xval)

        xp_assert_close(spl_yy1.t, spl_1.t, atol=1e-15)
        xp_assert_close(spl_yy1.c, np.c_[spl.insert_knot(xval).c,
                                         spl_y1.insert_knot(xval).c], atol=1e-15)

        xx = x if xval != x[-1] else x[:-1]
        xx = np.r_[xx, 0.5*(x[1:] + x[:-1])]
        xp_assert_close(spl_yy(xx), spl_yy1(xx), atol=1e-15)


    @pytest.mark.parametrize(
        'xval, m', [(0.0, 2), (1.0, 3), (1.5, 5), (4, 2), (7.0, 2)]
    )
    def test_insert_multi(self, xval, m):
        x = np.arange(8)
        y = np.sin(x)**3
        spl = make_interp_spline(x, y, k=3)

        spl_1f = insert(xval, spl, m=m)
        spl_1 = spl.insert_knot(xval, m)

        xp_assert_close(spl_1.t, spl_1f.t, atol=1e-15)
        xp_assert_close(spl_1.c, spl_1f.c[:-spl.k-1], atol=1e-15)

        xx = x if xval != x[-1] else x[:-1]
        xx = np.r_[xx, 0.5*(x[1:] + x[:-1])]
        xp_assert_close(spl(xx), spl_1(xx), atol=1e-15)

    def test_insert_random(self):
        rng = np.random.default_rng(12345)
        n, k = 11, 3

        t = np.sort(rng.uniform(size=n+k+1))
        c = rng.uniform(size=(n, 3, 2))
        spl = BSpline(t, c, k)

        xv = rng.uniform(low=t[k+1], high=t[-k-1])
        spl_1 = spl.insert_knot(xv)

        xx = rng.uniform(low=t[k+1], high=t[-k-1], size=33)
        xp_assert_close(spl(xx), spl_1(xx), atol=1e-15)

    @pytest.mark.parametrize('xv', [0, 0.1, 2.0, 4.0, 4.5,      # l.h. edge
                                    5.5, 6.0, 6.1, 7.0]         # r.h. edge
    )
    def test_insert_periodic(self, xv):
        x = np.arange(8)
        y = np.sin(x)**3
        tck = splrep(x, y, k=3)
        spl = BSpline(*tck, extrapolate="periodic")

        spl_1 = spl.insert_knot(xv)
        tf, cf, k = insert(xv, spl.tck, per=True)

        xp_assert_close(spl_1.t, tf, atol=1e-15)
        xp_assert_close(spl_1.c[:-k-1], cf[:-k-1], atol=1e-15)

        xx = np.random.default_rng(1234).uniform(low=0, high=7, size=41)
        xp_assert_close(spl_1(xx), splev(xx, (tf, cf, k)), atol=1e-15)

    @pytest.mark.parametrize('extrapolate', [None, 'periodic'])
    def test_complex(self, extrapolate):
        x = np.arange(8)*2*np.pi
        y_re, y_im = np.sin(x), np.cos(x)

        spl = make_interp_spline(x, y_re + 1j*y_im, k=3)
        spl.extrapolate = extrapolate

        spl_re = make_interp_spline(x, y_re, k=3)
        spl_re.extrapolate = extrapolate

        spl_im = make_interp_spline(x, y_im, k=3)
        spl_im.extrapolate = extrapolate

        xv = 3.5
        spl_1 = spl.insert_knot(xv)
        spl_1re = spl_re.insert_knot(xv)
        spl_1im = spl_im.insert_knot(xv)

        xp_assert_close(spl_1.t, spl_1re.t, atol=1e-15)
        xp_assert_close(spl_1.t, spl_1im.t, atol=1e-15)
        xp_assert_close(spl_1.c, spl_1re.c + 1j*spl_1im.c, atol=1e-15)

    def test_insert_periodic_too_few_internal_knots(self):
        # both FITPACK and spl.insert_knot raise when there's not enough
        # internal knots to make a periodic extension.
        # Below the internal knots are 2, 3,    , 4, 5
        #                                     ^
        #                              2, 3, 3.5, 4, 5
        #   so two knots from each side from the new one, while need at least
        #   from either left or right.
        xv = 3.5
        k = 3
        t = np.array([0]*(k+1) + [2, 3, 4, 5] + [7]*(k+1))
        c = np.ones(len(t) - k - 1)
        spl = BSpline(t, c, k, extrapolate="periodic")

        with assert_raises(ValueError):
            insert(xv, (t, c, k), per=True)

        with assert_raises(ValueError):
            spl.insert_knot(xv)

    def test_insert_no_extrap(self):
        k = 3
        t = np.array([0]*(k+1) + [2, 3, 4, 5] + [7]*(k+1))
        c = np.ones(len(t) - k - 1)
        spl = BSpline(t, c, k)

        with assert_raises(ValueError):
            spl.insert_knot(-1)

        with assert_raises(ValueError):
            spl.insert_knot(8)

        with assert_raises(ValueError):
            spl.insert_knot(3, m=0)


def test_knots_multiplicity():
    # Take a spline w/ random coefficients, throw in knots of varying
    # multiplicity.

    def check_splev(b, j, der=0, atol=1e-14, rtol=1e-14):
        # check evaluations against FITPACK, incl extrapolations
        t, c, k = b.tck
        x = np.unique(t)
        x = np.r_[t[0]-0.1, 0.5*(x[1:] + x[:1]), t[-1]+0.1]
        xp_assert_close(splev(x, (t, c, k), der), b(x, der),
                atol=atol, rtol=rtol, err_msg=f'der = {der}  k = {b.k}')

    # test loop itself
    # [the index `j` is for interpreting the traceback in case of a failure]
    for k in [1, 2, 3, 4, 5]:
        b = _make_random_spline(k=k)
        for j, b1 in enumerate(_make_multiples(b)):
            check_splev(b1, j)
            for der in range(1, k+1):
                check_splev(b1, j, der, 1e-12, 1e-12)


### stolen from @pv, verbatim
def _naive_B(x, k, i, t):
    """
    Naive way to compute B-spline basis functions. Useful only for testing!
    computes B(x; t[i],..., t[i+k+1])
    """
    if k == 0:
        return 1.0 if t[i] <= x < t[i+1] else 0.0
    if t[i+k] == t[i]:
        c1 = 0.0
    else:
        c1 = (x - t[i])/(t[i+k] - t[i]) * _naive_B(x, k-1, i, t)
    if t[i+k+1] == t[i+1]:
        c2 = 0.0
    else:
        c2 = (t[i+k+1] - x)/(t[i+k+1] - t[i+1]) * _naive_B(x, k-1, i+1, t)
    return (c1 + c2)


### stolen from @pv, verbatim
def _naive_eval(x, t, c, k):
    """
    Naive B-spline evaluation. Useful only for testing!
    """
    if x == t[k]:
        i = k
    else:
        i = np.searchsorted(t, x) - 1
    assert t[i] <= x <= t[i+1]
    assert i >= k and i < len(t) - k
    return sum(c[i-j] * _naive_B(x, k, i-j, t) for j in range(0, k+1))


def _naive_eval_2(x, t, c, k):
    """Naive B-spline evaluation, another way."""
    n = len(t) - (k+1)
    assert n >= k+1
    assert len(c) >= n
    assert t[k] <= x <= t[n]
    return sum(c[i] * _naive_B(x, k, i, t) for i in range(n))


def _sum_basis_elements(x, t, c, k):
    n = len(t) - (k+1)
    assert n >= k+1
    assert len(c) >= n
    s = 0.
    for i in range(n):
        b = BSpline.basis_element(t[i:i+k+2], extrapolate=False)(x)
        s += c[i] * np.nan_to_num(b)   # zero out out-of-bounds elements
    return s


def B_012(x):
    """ A linear B-spline function B(x | 0, 1, 2)."""
    x = np.atleast_1d(x)
    return np.piecewise(x, [(x < 0) | (x > 2),
                            (x >= 0) & (x < 1),
                            (x >= 1) & (x <= 2)],
                           [lambda x: 0., lambda x: x, lambda x: 2.-x])


def B_0123(x, der=0):
    """A quadratic B-spline function B(x | 0, 1, 2, 3)."""
    x = np.atleast_1d(x)
    conds = [x < 1, (x > 1) & (x < 2), x > 2]
    if der == 0:
        funcs = [lambda x: x*x/2.,
                 lambda x: 3./4 - (x-3./2)**2,
                 lambda x: (3.-x)**2 / 2]
    elif der == 2:
        funcs = [lambda x: 1.,
                 lambda x: -2.,
                 lambda x: 1.]
    else:
        raise ValueError(f'never be here: der={der}')
    pieces = np.piecewise(x, conds, funcs)
    return pieces


def _make_random_spline(n=35, k=3):
    rng = np.random.RandomState(123)
    t = np.sort(rng.random(n+k+1))
    c = rng.random(n)
    return BSpline.construct_fast(t, c, k)


def _make_multiples(b):
    """Increase knot multiplicity."""
    c, k = b.c, b.k

    t1 = b.t.copy()
    t1[17:19] = t1[17]
    t1[22] = t1[21]
    yield BSpline(t1, c, k)

    t1 = b.t.copy()
    t1[:k+1] = t1[0]
    yield BSpline(t1, c, k)

    t1 = b.t.copy()
    t1[-k-1:] = t1[-1]
    yield BSpline(t1, c, k)


class TestInterop:
    #
    # Test that FITPACK-based spl* functions can deal with BSpline objects
    #
    def setup_method(self):
        xx = np.linspace(0, 4.*np.pi, 41)
        yy = np.cos(xx)
        b = make_interp_spline(xx, yy)
        self.tck = (b.t, b.c, b.k)
        self.xx, self.yy, self.b = xx, yy, b

        self.xnew = np.linspace(0, 4.*np.pi, 21)

        c2 = np.c_[b.c, b.c, b.c]
        self.c2 = np.dstack((c2, c2))
        self.b2 = BSpline(b.t, self.c2, b.k)

    def test_splev(self):
        xnew, b, b2 = self.xnew, self.b, self.b2

        # check that splev works with 1-D array of coefficients
        # for array and scalar `x`
        xp_assert_close(splev(xnew, b),
                        b(xnew), atol=1e-15, rtol=1e-15)
        xp_assert_close(splev(xnew, b.tck),
                        b(xnew), atol=1e-15, rtol=1e-15)
        xp_assert_close(np.asarray([splev(x, b) for x in xnew]),
                        b(xnew), atol=1e-15, rtol=1e-15)

        # With N-D coefficients, there's a quirck:
        # splev(x, BSpline) is equivalent to BSpline(x)
        with assert_raises(ValueError, match="Calling splev.. with BSpline"):
            splev(xnew, b2)

        # However, splev(x, BSpline.tck) needs some transposes. This is because
        # BSpline interpolates along the first axis, while the legacy FITPACK
        # wrapper does list(map(...)) which effectively interpolates along the
        # last axis. Like so:
        sh = tuple(range(1, b2.c.ndim)) + (0,)   # sh = (1, 2, 0)
        cc = b2.c.transpose(sh)
        tck = (b2.t, cc, b2.k)
        xp_assert_close(np.asarray(splev(xnew, tck)),
                        b2(xnew).transpose(sh), atol=1e-15, rtol=1e-15)

    def test_splrep(self):
        x, y = self.xx, self.yy
        # test that "new" splrep is equivalent to _impl.splrep
        tck = splrep(x, y)
        t, c, k = _impl.splrep(x, y)
        xp_assert_close(tck[0], t, atol=1e-15)
        xp_assert_close(tck[1], c, atol=1e-15)
        assert tck[2] == k

        # also cover the `full_output=True` branch
        tck_f, _, _, _ = splrep(x, y, full_output=True)
        xp_assert_close(tck_f[0], t, atol=1e-15)
        xp_assert_close(tck_f[1], c, atol=1e-15)
        assert tck_f[2] == k

        # test that the result of splrep roundtrips with splev:
        # evaluate the spline on the original `x` points
        yy = splev(x, tck)
        xp_assert_close(y, yy, atol=1e-15)

        # ... and also it roundtrips if wrapped in a BSpline
        b = BSpline(*tck)
        xp_assert_close(y, b(x), atol=1e-15)

    def test_splrep_errors(self):
        # test that both "old" and "new" splrep raise for an N-D ``y`` array
        # with n > 1
        x, y = self.xx, self.yy
        y2 = np.c_[y, y]
        with assert_raises(ValueError):
            splrep(x, y2)
        with assert_raises(ValueError):
            _impl.splrep(x, y2)

        # input below minimum size
        with assert_raises(TypeError, match="m > k must hold"):
            splrep(x[:3], y[:3])
        with assert_raises(TypeError, match="m > k must hold"):
            _impl.splrep(x[:3], y[:3])

    def test_splprep(self):
        x = np.arange(15, dtype=np.float64).reshape((3, 5))
        b, u = splprep(x)
        tck, u1 = _impl.splprep(x)

        # test the roundtrip with splev for both "old" and "new" output
        xp_assert_close(u, u1, atol=1e-15)
        xp_assert_close(np.asarray(splev(u, b)), x, atol=1e-15)
        xp_assert_close(np.asarray(splev(u, tck)), x, atol=1e-15)

        # cover the ``full_output=True`` branch
        (b_f, u_f), _, _, _ = splprep(x, s=0, full_output=True)
        xp_assert_close(u, u_f, atol=1e-15)
        xp_assert_close(np.asarray(splev(u_f, b_f)), x, atol=1e-15)

    def test_splprep_errors(self):
        # test that both "old" and "new" code paths raise for x.ndim > 2
        x = np.arange(3*4*5).reshape((3, 4, 5))
        with assert_raises(ValueError, match="too many values to unpack"):
            splprep(x)
        with assert_raises(ValueError, match="too many values to unpack"):
            _impl.splprep(x)

        # input below minimum size
        x = np.linspace(0, 40, num=3)
        with assert_raises(TypeError, match="m > k must hold"):
            splprep([x])
        with assert_raises(TypeError, match="m > k must hold"):
            _impl.splprep([x])

        # automatically calculated parameters are non-increasing
        # see gh-7589
        x = [-50.49072266, -50.49072266, -54.49072266, -54.49072266]
        with assert_raises(ValueError, match="Invalid inputs"):
            splprep([x])
        with assert_raises(ValueError, match="Invalid inputs"):
            _impl.splprep([x])

        # given non-increasing parameter values u
        x = [1, 3, 2, 4]
        u = [0, 0.3, 0.2, 1]
        with assert_raises(ValueError, match="Invalid inputs"):
            splprep(*[[x], None, u])

    def test_sproot(self):
        b, b2 = self.b, self.b2
        roots = np.array([0.5, 1.5, 2.5, 3.5])*np.pi
        # sproot accepts a BSpline obj w/ 1-D coef array
        xp_assert_close(sproot(b), roots, atol=1e-7, rtol=1e-7)
        xp_assert_close(sproot((b.t, b.c, b.k)), roots, atol=1e-7, rtol=1e-7)

        # ... and deals with trailing dimensions if coef array is N-D
        with assert_raises(ValueError, match="Calling sproot.. with BSpline"):
            sproot(b2, mest=50)

        # and legacy behavior is preserved for a tck tuple w/ N-D coef
        c2r = b2.c.transpose(1, 2, 0)
        rr = np.asarray(sproot((b2.t, c2r, b2.k), mest=50))
        assert rr.shape == (3, 2, 4)
        xp_assert_close(rr - roots, np.zeros_like(rr), atol=1e-12)

    def test_splint(self):
        # test that splint accepts BSpline objects
        b, b2 = self.b, self.b2

        xp_assert_close(splint(0, 1, b),
                        splint(0, 1, b.tck), atol=1e-14, check_0d=False)
        xp_assert_close(splint(0, 1, b),
                        b.integrate(0, 1), atol=1e-14, check_0d=False)

        # ... and deals with N-D arrays of coefficients
        with assert_raises(ValueError, match="Calling splint.. with BSpline"):
            splint(0, 1, b2)

        # and the legacy behavior is preserved for a tck tuple w/ N-D coef
        c2r = b2.c.transpose(1, 2, 0)
        integr = np.asarray(splint(0, 1, (b2.t, c2r, b2.k)))
        assert integr.shape == (3, 2)
        xp_assert_close(integr,
                        splint(0, 1, b), atol=1e-14, check_shape=False)

    def test_splder(self):
        for b in [self.b, self.b2]:
            # pad the c array (FITPACK convention)
            ct = len(b.t) - len(b.c)
            b_c = b.c.copy()
            if ct > 0:
                b_c = np.r_[b_c, np.zeros((ct,) + b_c.shape[1:])]

            for n in [1, 2, 3]:
                bd = splder(b)
                tck_d = _impl.splder((b.t.copy(), b_c, b.k))
                xp_assert_close(bd.t, tck_d[0], atol=1e-15)
                xp_assert_close(bd.c, tck_d[1], atol=1e-15)
                assert bd.k == tck_d[2]
                assert isinstance(bd, BSpline)
                assert isinstance(tck_d, tuple)  # back-compat: tck in and out

    def test_splantider(self):
        for b in [self.b, self.b2]:
            # pad the c array (FITPACK convention)
            ct = len(b.t) - len(b.c)
            b_c = b.c.copy()
            if ct > 0:
                b_c = np.r_[b_c, np.zeros((ct,) + b_c.shape[1:])]

            for n in [1, 2, 3]:
                bd = splantider(b)
                tck_d = _impl.splantider((b.t.copy(), b_c, b.k))
                xp_assert_close(bd.t, tck_d[0], atol=1e-15)
                xp_assert_close(bd.c, tck_d[1], atol=1e-15)
                assert bd.k == tck_d[2]
                assert isinstance(bd, BSpline)
                assert isinstance(tck_d, tuple)  # back-compat: tck in and out

    def test_insert(self):
        b, b2, xx = self.b, self.b2, self.xx

        j = b.t.size // 2
        tn = 0.5*(b.t[j] + b.t[j+1])

        bn, tck_n = insert(tn, b), insert(tn, (b.t, b.c, b.k))
        xp_assert_close(splev(xx, bn),
                        splev(xx, tck_n), atol=1e-15)
        assert isinstance(bn, BSpline)
        assert isinstance(tck_n, tuple)   # back-compat: tck in, tck out

        # for N-D array of coefficients, BSpline.c needs to be transposed
        # after that, the results are equivalent.
        sh = tuple(range(b2.c.ndim))
        c_ = b2.c.transpose(sh[1:] + (0,))
        tck_n2 = insert(tn, (b2.t, c_, b2.k))

        bn2 = insert(tn, b2)

        # need a transpose for comparing the results, cf test_splev
        xp_assert_close(np.asarray(splev(xx, tck_n2)).transpose(2, 0, 1),
                        bn2(xx), atol=1e-15)
        assert isinstance(bn2, BSpline)
        assert isinstance(tck_n2, tuple)   # back-compat: tck in, tck out


class TestInterp:
    #
    # Test basic ways of constructing interpolating splines.
    #
    xx = np.linspace(0., 2.*np.pi)
    yy = np.sin(xx)

    def test_non_int_order(self):
        with assert_raises(TypeError):
            make_interp_spline(self.xx, self.yy, k=2.5)

    def test_order_0(self):
        b = make_interp_spline(self.xx, self.yy, k=0)
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)
        b = make_interp_spline(self.xx, self.yy, k=0, axis=-1)
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)

    def test_linear(self):
        b = make_interp_spline(self.xx, self.yy, k=1)
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)
        b = make_interp_spline(self.xx, self.yy, k=1, axis=-1)
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)

    @pytest.mark.parametrize('k', [0, 1, 2, 3])
    def test_incompatible_x_y(self, k):
        x = [0, 1, 2, 3, 4, 5]
        y = [0, 1, 2, 3, 4, 5, 6, 7]
        with assert_raises(ValueError, match="Shapes of x"):
            make_interp_spline(x, y, k=k)

    @pytest.mark.parametrize('k', [0, 1, 2, 3])
    def test_broken_x(self, k):
        x = [0, 1, 1, 2, 3, 4]      # duplicates
        y = [0, 1, 2, 3, 4, 5]
        with assert_raises(ValueError, match="x to not have duplicates"):
            make_interp_spline(x, y, k=k)

        x = [0, 2, 1, 3, 4, 5]      # unsorted
        with assert_raises(ValueError, match="Expect x to be a 1D strictly"):
            make_interp_spline(x, y, k=k)

        x = [0, 1, 2, 3, 4, 5]
        x = np.asarray(x).reshape((1, -1))     # 1D
        with assert_raises(ValueError, match="Expect x to be a 1D strictly"):
            make_interp_spline(x, y, k=k)

    def test_not_a_knot(self):
        for k in [2, 3, 4, 5, 6, 7]:
            b = make_interp_spline(self.xx, self.yy, k)
            xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)

    def test_periodic(self):
        # k = 5 here for more derivatives
        b = make_interp_spline(self.xx, self.yy, k=5, bc_type='periodic')
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)
        # in periodic case it is expected equality of k-1 first
        # derivatives at the boundaries
        for i in range(1, 5):
            xp_assert_close(b(self.xx[0], nu=i), b(self.xx[-1], nu=i), atol=1e-11)
        # tests for axis=-1
        b = make_interp_spline(self.xx, self.yy, k=5, bc_type='periodic', axis=-1)
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)
        for i in range(1, 5):
            xp_assert_close(b(self.xx[0], nu=i), b(self.xx[-1], nu=i), atol=1e-11)

    @pytest.mark.parametrize('k', [2, 3, 4, 5, 6, 7])
    def test_periodic_random(self, k):
        # tests for both cases (k > n and k <= n)
        n = 5
        rng = np.random.RandomState(1234)
        x = np.sort(rng.random_sample(n) * 10)
        y = rng.random_sample(n) * 100
        y[0] = y[-1]
        b = make_interp_spline(x, y, k=k, bc_type='periodic')
        xp_assert_close(b(x), y, atol=1e-14)

    def test_periodic_axis(self):
        n = self.xx.shape[0]
        rng = np.random.RandomState(1234)
        x = rng.random_sample(n) * 2 * np.pi
        x = np.sort(x)
        x[0] = 0.
        x[-1] = 2 * np.pi
        y = np.zeros((2, n))
        y[0] = np.sin(x)
        y[1] = np.cos(x)
        b = make_interp_spline(x, y, k=5, bc_type='periodic', axis=1)
        for i in range(n):
            xp_assert_close(b(x[i]), y[:, i], atol=1e-14)
        xp_assert_close(b(x[0]), b(x[-1]), atol=1e-14)

    def test_periodic_points_exception(self):
        # first and last points should match when periodic case expected
        rng = np.random.RandomState(1234)
        k = 5
        n = 8
        x = np.sort(rng.random_sample(n))
        y = rng.random_sample(n)
        y[0] = y[-1] - 1  # to be sure that they are not equal
        with assert_raises(ValueError):
            make_interp_spline(x, y, k=k, bc_type='periodic')

    def test_periodic_knots_exception(self):
        # `periodic` case does not work with passed vector of knots
        rng = np.random.RandomState(1234)
        k = 3
        n = 7
        x = np.sort(rng.random_sample(n))
        y = rng.random_sample(n)
        t = np.zeros(n + 2 * k)
        with assert_raises(ValueError):
            make_interp_spline(x, y, k, t, 'periodic')

    @pytest.mark.parametrize('k', [2, 3, 4, 5])
    def test_periodic_splev(self, k):
        # comparison values of periodic b-spline with splev
        b = make_interp_spline(self.xx, self.yy, k=k, bc_type='periodic')
        tck = splrep(self.xx, self.yy, per=True, k=k)
        spl = splev(self.xx, tck)
        xp_assert_close(spl, b(self.xx), atol=1e-14)

        # comparison derivatives of periodic b-spline with splev
        for i in range(1, k):
            spl = splev(self.xx, tck, der=i)
            xp_assert_close(spl, b(self.xx, nu=i), atol=1e-10)

    def test_periodic_cubic(self):
        # comparison values of cubic periodic b-spline with CubicSpline
        b = make_interp_spline(self.xx, self.yy, k=3, bc_type='periodic')
        cub = CubicSpline(self.xx, self.yy, bc_type='periodic')
        xp_assert_close(b(self.xx), cub(self.xx), atol=1e-14)

        # edge case: Cubic interpolation on 3 points
        rng = np.random.RandomState(1234)
        n = 3
        x = np.sort(rng.random_sample(n) * 10)
        y = rng.random_sample(n) * 100
        y[0] = y[-1]
        b = make_interp_spline(x, y, k=3, bc_type='periodic')
        cub = CubicSpline(x, y, bc_type='periodic')
        xp_assert_close(b(x), cub(x), atol=1e-14)

    def test_periodic_full_matrix(self):
        # comparison values of cubic periodic b-spline with
        # solution of the system with full matrix
        k = 3
        b = make_interp_spline(self.xx, self.yy, k=k, bc_type='periodic')
        t = _periodic_knots(self.xx, k)
        c = _make_interp_per_full_matr(self.xx, self.yy, t, k)
        b1 = np.vectorize(lambda x: _naive_eval(x, t, c, k))
        xp_assert_close(b(self.xx), b1(self.xx), atol=1e-14)

    def test_quadratic_deriv(self):
        der = [(1, 8.)]  # order, value: f'(x) = 8.

        # derivative at right-hand edge
        b = make_interp_spline(self.xx, self.yy, k=2, bc_type=(None, der))
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)
        xp_assert_close(
            b(self.xx[-1], 1), der[0][1], atol=1e-14, rtol=1e-14, check_0d=False
        )

        # derivative at left-hand edge
        b = make_interp_spline(self.xx, self.yy, k=2, bc_type=(der, None))
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)
        xp_assert_close(
            b(self.xx[0], 1), der[0][1], atol=1e-14, rtol=1e-14, check_0d=False
        )

    def test_cubic_deriv(self):
        k = 3

        # first derivatives at left & right edges:
        der_l, der_r = [(1, 3.)], [(1, 4.)]
        b = make_interp_spline(self.xx, self.yy, k, bc_type=(der_l, der_r))
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)
        xp_assert_close(np.asarray([b(self.xx[0], 1), b(self.xx[-1], 1)]),
                        np.asarray([der_l[0][1], der_r[0][1]]), atol=1e-14, rtol=1e-14)

        # 'natural' cubic spline, zero out 2nd derivatives at the boundaries
        der_l, der_r = [(2, 0)], [(2, 0)]
        b = make_interp_spline(self.xx, self.yy, k, bc_type=(der_l, der_r))
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)

    def test_quintic_derivs(self):
        k, n = 5, 7
        x = np.arange(n).astype(np.float64)
        y = np.sin(x)
        der_l = [(1, -12.), (2, 1)]
        der_r = [(1, 8.), (2, 3.)]
        b = make_interp_spline(x, y, k=k, bc_type=(der_l, der_r))
        xp_assert_close(b(x), y, atol=1e-14, rtol=1e-14)
        xp_assert_close(np.asarray([b(x[0], 1), b(x[0], 2)]),
                        np.asarray([val for (nu, val) in der_l]))
        xp_assert_close(np.asarray([b(x[-1], 1), b(x[-1], 2)]),
                        np.asarray([val for (nu, val) in der_r]))

    @pytest.mark.xfail(reason='unstable')
    def test_cubic_deriv_unstable(self):
        # 1st and 2nd derivative at x[0], no derivative information at x[-1]
        # The problem is not that it fails [who would use this anyway],
        # the problem is that it fails *silently*, and I've no idea
        # how to detect this sort of instability.
        # In this particular case: it's OK for len(t) < 20, goes haywire
        # at larger `len(t)`.
        k = 3
        t = _augknt(self.xx, k)

        der_l = [(1, 3.), (2, 4.)]
        b = make_interp_spline(self.xx, self.yy, k, t, bc_type=(der_l, None))
        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)

    def test_knots_not_data_sites(self):
        # Knots need not coincide with the data sites.
        # use a quadratic spline, knots are at data averages,
        # two additional constraints are zero 2nd derivatives at edges
        k = 2
        t = np.r_[(self.xx[0],)*(k+1),
                  (self.xx[1:] + self.xx[:-1]) / 2.,
                  (self.xx[-1],)*(k+1)]
        b = make_interp_spline(self.xx, self.yy, k, t,
                               bc_type=([(2, 0)], [(2, 0)]))

        xp_assert_close(b(self.xx), self.yy, atol=1e-14, rtol=1e-14)
        xp_assert_close(b(self.xx[0], 2), np.asarray(0.0), atol=1e-14)
        xp_assert_close(b(self.xx[-1], 2), np.asarray(0.0), atol=1e-14)

    def test_minimum_points_and_deriv(self):
        # interpolation of f(x) = x**3 between 0 and 1. f'(x) = 3 * xx**2 and
        # f'(0) = 0, f'(1) = 3.
        k = 3
        x = [0., 1.]
        y = [0., 1.]
        b = make_interp_spline(x, y, k, bc_type=([(1, 0.)], [(1, 3.)]))

        xx = np.linspace(0., 1.)
        yy = xx**3
        xp_assert_close(b(xx), yy, atol=1e-14, rtol=1e-14)

    def test_deriv_spec(self):
        # If one of the derivatives is omitted, the spline definition is
        # incomplete.
        x = y = [1.0, 2, 3, 4, 5, 6]

        with assert_raises(ValueError):
            make_interp_spline(x, y, bc_type=([(1, 0.)], None))

        with assert_raises(ValueError):
            make_interp_spline(x, y, bc_type=(1, 0.))

        with assert_raises(ValueError):
            make_interp_spline(x, y, bc_type=[(1, 0.)])

        with assert_raises(ValueError):
            make_interp_spline(x, y, bc_type=42)

        # CubicSpline expects`bc_type=(left_pair, right_pair)`, while
        # here we expect `bc_type=(iterable, iterable)`.
        l, r = (1, 0.0), (1, 0.0)
        with assert_raises(ValueError):
            make_interp_spline(x, y, bc_type=(l, r))

    def test_deriv_order_too_large(self):
        x = np.arange(7)
        y = x**2
        l, r = [(6, 0)], [(1, 0)]    # 6th derivative = 0 at x[0] for k=3
        with assert_raises(ValueError, match="Bad boundary conditions at 0."):
            # cannot fix 6th derivative at x[0]: does not segfault
            make_interp_spline(x, y, bc_type=(l, r))

        l, r = [(1, 0)], [(-6, 0)]    # derivative order < 0 at x[-1]
        with assert_raises(ValueError, match="Bad boundary conditions at 6."):
            # does not segfault
            make_interp_spline(x, y, bc_type=(l, r))

    def test_complex(self):
        k = 3
        xx = self.xx
        yy = self.yy + 1.j*self.yy

        # first derivatives at left & right edges:
        der_l, der_r = [(1, 3.j)], [(1, 4.+2.j)]
        b = make_interp_spline(xx, yy, k, bc_type=(der_l, der_r))
        xp_assert_close(b(xx), yy, atol=1e-14, rtol=1e-14)
        xp_assert_close(
            b(xx[0], 1), der_l[0][1], atol=1e-14, rtol=1e-14, check_0d=False
        )
        xp_assert_close(
            b(xx[-1], 1), der_r[0][1], atol=1e-14, rtol=1e-14, check_0d=False
        )

        # also test zero and first order
        for k in (0, 1):
            b = make_interp_spline(xx, yy, k=k)
            xp_assert_close(b(xx), yy, atol=1e-14, rtol=1e-14)

    def test_int_xy(self):
        x = np.arange(10).astype(int)
        y = np.arange(10).astype(int)

        # Cython chokes on "buffer type mismatch" (construction) or
        # "no matching signature found" (evaluation)
        for k in (0, 1, 2, 3):
            b = make_interp_spline(x, y, k=k)
            b(x)

    def test_sliced_input(self):
        # Cython code chokes on non C contiguous arrays
        xx = np.linspace(-1, 1, 100)

        x = xx[::5]
        y = xx[::5]

        for k in (0, 1, 2, 3):
            make_interp_spline(x, y, k=k)

    def test_check_finite(self):
        # check_finite defaults to True; nans and such trigger a ValueError
        x = np.arange(10).astype(float)
        y = x**2

        for z in [np.nan, np.inf, -np.inf]:
            y[-1] = z
            assert_raises(ValueError, make_interp_spline, x, y)

    @pytest.mark.parametrize('k', [1, 2, 3, 5])
    def test_list_input(self, k):
        # regression test for gh-8714: TypeError for x, y being lists and k=2
        x = list(range(10))
        y = [a**2 for a in x]
        make_interp_spline(x, y, k=k)

    def test_multiple_rhs(self):
        yy = np.c_[np.sin(self.xx), np.cos(self.xx)]
        der_l = [(1, [1., 2.])]
        der_r = [(1, [3., 4.])]

        b = make_interp_spline(self.xx, yy, k=3, bc_type=(der_l, der_r))
        xp_assert_close(b(self.xx), yy, atol=1e-14, rtol=1e-14)
        xp_assert_close(b(self.xx[0], 1), der_l[0][1], atol=1e-14, rtol=1e-14)
        xp_assert_close(b(self.xx[-1], 1), der_r[0][1], atol=1e-14, rtol=1e-14)

    def test_shapes(self):
        rng = np.random.RandomState(1234)
        k, n = 3, 22
        x = np.sort(rng.random(size=n))
        y = rng.random(size=(n, 5, 6, 7))

        b = make_interp_spline(x, y, k)
        assert b.c.shape == (n, 5, 6, 7)

        # now throw in some derivatives
        d_l = [(1, rng.random((5, 6, 7)))]
        d_r = [(1, rng.random((5, 6, 7)))]
        b = make_interp_spline(x, y, k, bc_type=(d_l, d_r))
        assert b.c.shape == (n + k - 1, 5, 6, 7)

    def test_string_aliases(self):
        yy = np.sin(self.xx)

        # a single string is duplicated
        b1 = make_interp_spline(self.xx, yy, k=3, bc_type='natural')
        b2 = make_interp_spline(self.xx, yy, k=3, bc_type=([(2, 0)], [(2, 0)]))
        xp_assert_close(b1.c, b2.c, atol=1e-15)

        # two strings are handled
        b1 = make_interp_spline(self.xx, yy, k=3,
                                bc_type=('natural', 'clamped'))
        b2 = make_interp_spline(self.xx, yy, k=3,
                                bc_type=([(2, 0)], [(1, 0)]))
        xp_assert_close(b1.c, b2.c, atol=1e-15)

        # one-sided BCs are OK
        b1 = make_interp_spline(self.xx, yy, k=2, bc_type=(None, 'clamped'))
        b2 = make_interp_spline(self.xx, yy, k=2, bc_type=(None, [(1, 0.0)]))
        xp_assert_close(b1.c, b2.c, atol=1e-15)

        # 'not-a-knot' is equivalent to None
        b1 = make_interp_spline(self.xx, yy, k=3, bc_type='not-a-knot')
        b2 = make_interp_spline(self.xx, yy, k=3, bc_type=None)
        xp_assert_close(b1.c, b2.c, atol=1e-15)

        # unknown strings do not pass
        with assert_raises(ValueError):
            make_interp_spline(self.xx, yy, k=3, bc_type='typo')

        # string aliases are handled for 2D values
        yy = np.c_[np.sin(self.xx), np.cos(self.xx)]
        der_l = [(1, [0., 0.])]
        der_r = [(2, [0., 0.])]
        b2 = make_interp_spline(self.xx, yy, k=3, bc_type=(der_l, der_r))
        b1 = make_interp_spline(self.xx, yy, k=3,
                                bc_type=('clamped', 'natural'))
        xp_assert_close(b1.c, b2.c, atol=1e-15)

        # ... and for N-D values:
        rng = np.random.RandomState(1234)
        k, n = 3, 22
        x = np.sort(rng.random(size=n))
        y = rng.random(size=(n, 5, 6, 7))

        # now throw in some derivatives
        d_l = [(1, np.zeros((5, 6, 7)))]
        d_r = [(1, np.zeros((5, 6, 7)))]
        b1 = make_interp_spline(x, y, k, bc_type=(d_l, d_r))
        b2 = make_interp_spline(x, y, k, bc_type='clamped')
        xp_assert_close(b1.c, b2.c, atol=1e-15)

    def test_full_matrix(self):
        rng = np.random.RandomState(1234)
        k, n = 3, 7
        x = np.sort(rng.random(size=n))
        y = rng.random(size=n)
        t = _not_a_knot(x, k)

        b = make_interp_spline(x, y, k, t)
        cf = make_interp_full_matr(x, y, t, k)
        xp_assert_close(b.c, cf, atol=1e-14, rtol=1e-14)

    def test_woodbury(self):
        '''
        Random elements in diagonal matrix with blocks in the
        left lower and right upper corners checking the
        implementation of Woodbury algorithm.
        '''
        rng = np.random.RandomState(1234)
        n = 201
        for k in range(3, 32, 2):
            offset = int((k - 1) / 2)
            a = np.diagflat(rng.random((1, n)))
            for i in range(1, offset + 1):
                a[:-i, i:] += np.diagflat(rng.random((1, n - i)))
                a[i:, :-i] += np.diagflat(rng.random((1, n - i)))
            ur = rng.random((offset, offset))
            a[:offset, -offset:] = ur
            ll = rng.random((offset, offset))
            a[-offset:, :offset] = ll
            d = np.zeros((k, n))
            for i, j in enumerate(range(offset, -offset - 1, -1)):
                if j < 0:
                    d[i, :j] = np.diagonal(a, offset=j)
                else:
                    d[i, j:] = np.diagonal(a, offset=j)
            b = rng.random(n)
            xp_assert_close(_woodbury_algorithm(d, ur, ll, b, k),
                            np.linalg.solve(a, b), atol=1e-14)


def make_interp_full_matr(x, y, t, k):
    """Assemble an spline order k with knots t to interpolate
    y(x) using full matrices.
    Not-a-knot BC only.

    This routine is here for testing only (even though it's functional).
    """
    assert x.size == y.size
    assert t.size == x.size + k + 1
    n = x.size

    A = np.zeros((n, n), dtype=np.float64)

    for j in range(n):
        xval = x[j]
        if xval == t[k]:
            left = k
        else:
            left = np.searchsorted(t, xval) - 1

        # fill a row
        bb = _dierckx.evaluate_all_bspl(t, k, xval, left)
        A[j, left-k:left+1] = bb

    c = sl.solve(A, y)
    return c


def make_lsq_full_matrix(x, y, t, k=3):
    """Make the least-square spline, full matrices."""
    x, y, t = map(np.asarray, (x, y, t))
    m = x.size
    n = t.size - k - 1

    A = np.zeros((m, n), dtype=np.float64)

    for j in range(m):
        xval = x[j]
        # find interval
        if xval == t[k]:
            left = k
        else:
            left = np.searchsorted(t, xval) - 1

        # fill a row
        bb = _dierckx.evaluate_all_bspl(t, k, xval, left)
        A[j, left-k:left+1] = bb

    # have observation matrix, can solve the LSQ problem
    B = np.dot(A.T, A)
    Y = np.dot(A.T, y)
    c = sl.solve(B, Y)

    return c, (A, Y)


parametrize_lsq_methods = pytest.mark.parametrize("method", ["norm-eq", "qr"])

class TestLSQ:
    #
    # Test make_lsq_spline
    #
    rng = np.random.RandomState(1234)
    n, k = 13, 3
    x = np.sort(rng.random(n))
    y = rng.random(n)
    t = _augknt(np.linspace(x[0], x[-1], 7), k)

    @parametrize_lsq_methods
    def test_lstsq(self, method):
        # check LSQ construction vs a full matrix version
        x, y, t, k = self.x, self.y, self.t, self.k

        c0, AY = make_lsq_full_matrix(x, y, t, k)
        b = make_lsq_spline(x, y, t, k, method=method)

        xp_assert_close(b.c, c0)
        assert b.c.shape == (t.size - k - 1,)

        # also check against numpy.lstsq
        aa, yy = AY
        c1, _, _, _ = np.linalg.lstsq(aa, y, rcond=-1)
        xp_assert_close(b.c, c1)

    @parametrize_lsq_methods
    def test_weights(self, method):
        # weights = 1 is same as None
        x, y, t, k = self.x, self.y, self.t, self.k
        w = np.ones_like(x)

        b = make_lsq_spline(x, y, t, k, method=method)
        b_w = make_lsq_spline(x, y, t, k, w=w, method=method)

        xp_assert_close(b.t, b_w.t, atol=1e-14)
        xp_assert_close(b.c, b_w.c, atol=1e-14)
        assert b.k == b_w.k

    def test_weights_same(self):
        # both methods treat weights
        x, y, t, k = self.x, self.y, self.t, self.k
        w = np.random.default_rng(1234).uniform(size=x.shape[0])

        b_ne = make_lsq_spline(x, y, t, k, w=w, method="norm-eq")
        b_qr = make_lsq_spline(x, y, t, k, w=w, method="qr")
        b_no_w = make_lsq_spline(x, y, t, k, method="qr")

        xp_assert_close(b_ne.c, b_qr.c, atol=1e-14)
        assert not np.allclose(b_no_w.c, b_qr.c, atol=1e-14)

    @parametrize_lsq_methods
    def test_multiple_rhs(self, method):
        x, t, k, n = self.x, self.t, self.k, self.n
        rng = np.random.RandomState(1234)
        y = rng.random(size=(n, 5, 6, 7))
        b = make_lsq_spline(x, y, t, k, method=method)
        assert b.c.shape == (t.size-k-1, 5, 6, 7)

    @parametrize_lsq_methods
    def test_multiple_rhs_2(self, method):
        x, t, k, n = self.x, self.t, self.k, self.n
        nrhs = 3
        rng = np.random.RandomState(1234)
        y = rng.random(size=(n, nrhs))
        b = make_lsq_spline(x, y, t, k, method=method)

        bb = [make_lsq_spline(x, y[:, i], t, k, method=method)
              for i in range(nrhs)]
        coefs = np.vstack([bb[i].c for i in range(nrhs)]).T

        xp_assert_close(coefs, b.c, atol=1e-15)

    def test_multiple_rhs_3(self):
        x, t, k, n = self.x, self.t, self.k, self.n
        nrhs = 3
        y = np.random.random(size=(n, nrhs))
        b_qr = make_lsq_spline(x, y, t, k, method="qr")
        b_neq = make_lsq_spline(x, y, t, k, method="norm-eq")
        xp_assert_close(b_qr.c, b_neq.c, atol=1e-15)

    @parametrize_lsq_methods
    def test_complex(self, method):
        # cmplx-valued `y`
        x, t, k = self.x, self.t, self.k
        yc = self.y * (1. + 2.j)

        b = make_lsq_spline(x, yc, t, k, method=method)
        b_re = make_lsq_spline(x, yc.real, t, k, method=method)
        b_im = make_lsq_spline(x, yc.imag, t, k, method=method)

        xp_assert_close(b(x), b_re(x) + 1.j*b_im(x), atol=1e-15, rtol=1e-15)

    def test_complex_2(self):
        # test complex-valued y with y.ndim > 1

        x, t, k = self.x, self.t, self.k
        yc = self.y * (1. + 2.j)
        yc = np.stack((yc, yc), axis=1)

        b = make_lsq_spline(x, yc, t, k)
        b_re = make_lsq_spline(x, yc.real, t, k)
        b_im = make_lsq_spline(x, yc.imag, t, k)

        xp_assert_close(b(x), b_re(x) + 1.j*b_im(x), atol=1e-15, rtol=1e-15)

        # repeat with num_trailing_dims > 1 : yc.shape[1:] = (2, 2)
        yc = np.stack((yc, yc), axis=1)

        b = make_lsq_spline(x, yc, t, k)
        b_re = make_lsq_spline(x, yc.real, t, k)
        b_im = make_lsq_spline(x, yc.imag, t, k)

        xp_assert_close(b(x), b_re(x) + 1.j*b_im(x), atol=1e-15, rtol=1e-15)

    @parametrize_lsq_methods
    def test_int_xy(self, method):
        x = np.arange(10).astype(int)
        y = np.arange(10).astype(int)
        t = _augknt(x, k=1)
        # Cython chokes on "buffer type mismatch"
        make_lsq_spline(x, y, t, k=1, method=method)

    @parametrize_lsq_methods
    def test_f32_xy(self, method):
        x = np.arange(10, dtype=np.float32)
        y = np.arange(10, dtype=np.float32)
        t = _augknt(x, k=1)
        spl_f32 = make_lsq_spline(x, y, t, k=1, method=method)
        spl_f64 = make_lsq_spline(
            x.astype(float), y.astype(float), t.astype(float), k=1, method=method
        )

        x2 = (x[1:] + x[:-1]) / 2.0
        xp_assert_close(spl_f32(x2), spl_f64(x2), atol=1e-15)

    @parametrize_lsq_methods
    def test_sliced_input(self, method):
        # Cython code chokes on non C contiguous arrays
        xx = np.linspace(-1, 1, 100)

        x = xx[::3]
        y = xx[::3]
        t = _augknt(x, 1)
        make_lsq_spline(x, y, t, k=1, method=method)

    @parametrize_lsq_methods
    def test_checkfinite(self, method):
        # check_finite defaults to True; nans and such trigger a ValueError
        x = np.arange(12).astype(float)
        y = x**2
        t = _augknt(x, 3)

        for z in [np.nan, np.inf, -np.inf]:
            y[-1] = z
            assert_raises(ValueError, make_lsq_spline, x, y, t, method=method)

    @parametrize_lsq_methods
    def test_read_only(self, method):
        # Check that make_lsq_spline works with read only arrays
        x, y, t = self.x, self.y, self.t
        x.setflags(write=False)
        y.setflags(write=False)
        t.setflags(write=False)
        make_lsq_spline(x=x, y=y, t=t, method=method)

    @pytest.mark.parametrize('k', list(range(1, 7)))
    def test_qr_vs_norm_eq(self, k):
        # check that QR and normal eq solutions match
        x, y = self.x, self.y
        t = _augknt(np.linspace(x[0], x[-1], 7), k)
        spl_norm_eq = make_lsq_spline(x, y, t, k=k, method='norm-eq')
        spl_qr = make_lsq_spline(x, y, t, k=k, method='qr')

        xx = (x[1:] + x[:-1]) / 2.0
        xp_assert_close(spl_norm_eq(xx), spl_qr(xx), atol=1e-15)

    def test_duplicates(self):
        # method="qr" can handle duplicated data points
        x = np.repeat(self.x, 2)
        y = np.repeat(self.y, 2)
        spl_1 = make_lsq_spline(self.x, self.y, self.t, k=3, method='qr')
        spl_2 = make_lsq_spline(x, y, self.t, k=3, method='qr')

        xx = (x[1:] + x[:-1]) / 2.0
        xp_assert_close(spl_1(xx), spl_2(xx), atol=1e-15)


class PackedMatrix:
    """A simplified CSR format for when non-zeros in each row are consecutive.

    Assuming that each row of an `(m, nc)` matrix 1) only has `nz` non-zeros, and
    2) these non-zeros are consecutive, we only store an `(m, nz)` matrix of
    non-zeros and a 1D array of row offsets. This way, a row `i` of the original
    matrix A is ``A[i, offset[i]: offset[i] + nz]``.

    """
    def __init__(self, a, offset, nc):
        self.a = a
        self.offset = offset
        self.nc = nc

        assert a.ndim == 2
        assert offset.ndim == 1
        assert a.shape[0] == offset.shape[0]

    @property
    def shape(self):
        return self.a.shape[0], self.nc

    def todense(self):
        out = np.zeros(self.shape)
        nelem = self.a.shape[1]
        for i in range(out.shape[0]):
            nel = min(self.nc - self.offset[i], nelem)
            out[i, self.offset[i]:self.offset[i] + nel] = self.a[i, :nel]
        return out


def _qr_reduce_py(a_p, y, startrow=1):
    """This is a python counterpart of the `_qr_reduce` routine,
    declared in interpolate/src/__fitpack.h
    """
    from scipy.linalg.lapack import dlartg

    # unpack the packed format
    a = a_p.a
    offset = a_p.offset
    nc = a_p.nc

    m, nz = a.shape

    assert y.shape[0] == m
    R = a.copy()
    y1 = y.copy()

    for i in range(startrow, m):
        oi = offset[i]
        for j in range(oi, nc):
            # rotate only the lower diagonal
            if j >= min(i, nc):
                break

            # In dense format: diag a1[j, j] vs a1[i, j]
            c, s, r = dlartg(R[j, 0], R[i, 0])

            # rotate l.h.s.
            R[j, 0] = r
            for l in range(1, nz):
                R[j, l], R[i, l-1] = fprota(c, s, R[j, l], R[i, l])
            R[i, -1] = 0.0

            # rotate r.h.s.
            for l in range(y1.shape[1]):
                y1[j, l], y1[i, l] = fprota(c, s, y1[j, l], y1[i, l])

    # convert to packed
    offs = list(range(R.shape[0]))
    R_p = PackedMatrix(R, np.array(offs, dtype=np.int64), nc)

    return R_p, y1


def fprota(c, s, a, b):
    """Givens rotate [a, b].

    [aa] = [ c s] @ [a]
    [bb]   [-s c]   [b]

    """
    aa =  c*a + s*b
    bb = -s*a + c*b
    return aa, bb


def fpback(R_p, y):
    """Backsubsitution solve upper triangular banded `R @ c = y.`

    `R` is in the "packed" format: `R[i, :]` is `a[i, i:i+k+1]`
    """
    R = R_p.a
    _, nz = R.shape
    nc = R_p.nc
    assert y.shape[0] == R.shape[0]

    c = np.zeros_like(y[:nc])
    c[nc-1, ...] = y[nc-1] / R[nc-1, 0]
    for i in range(nc-2, -1, -1):
        nel = min(nz, nc-i)
        # NB: broadcast R across trailing dimensions of `c`.
        summ = (R[i, 1:nel, None] * c[i+1:i+nel, ...]).sum(axis=0)
        c[i, ...] = ( y[i] - summ ) / R[i, 0]
    return c


class TestGivensQR:
    # Test row-by-row QR factorization, used for the LSQ spline construction.
    # This is implementation detail; still test it separately.
    def _get_xyt(self, n):
        k = 3
        x = np.arange(n, dtype=float)
        y = x**3 + 1/(1+x)
        t = _not_a_knot(x, k)
        return x, y, t, k

    def test_vs_full(self):
        n = 10
        x, y, t, k = self._get_xyt(n)

        # design matrix
        a_csr = BSpline.design_matrix(x, t, k)

        # dense QR
        q, r = sl.qr(a_csr.todense())
        qTy = q.T @ y

        # prepare the PackedMatrix to factorize
        # convert to "packed" format
        m, nc = a_csr.shape
        assert nc == t.shape[0] - k - 1

        offset = a_csr.indices[::(k+1)]
        offset = np.ascontiguousarray(offset, dtype=np.int64)
        A = a_csr.data.reshape(m, k+1)

        R = PackedMatrix(A, offset, nc)
        y_ = y[:, None]     # _qr_reduce requires `y` a 2D array
        _dierckx.qr_reduce(A, offset, nc, y_)      # modifies arguments in-place

        # signs may differ
        xp_assert_close(np.minimum(R.todense() + r,
                                   R.todense() - r), np.zeros_like(r), atol=1e-15)
        xp_assert_close(np.minimum(abs(qTy - y_[:, 0]),
                                   abs(qTy + y_[:, 0])), np.zeros_like(qTy), atol=2e-13)

        # sign changes are consistent between Q and R:
        c_full = sl.solve(r, qTy)
        c_banded = _dierckx.fpback(R.a, R.nc, y_)
        xp_assert_close(c_full, c_banded[:, 0], atol=5e-13)

    def test_py_vs_compiled(self):
        # test _qr_reduce vs a python implementation
        n = 10
        x, y, t, k = self._get_xyt(n)

        # design matrix
        a_csr = BSpline.design_matrix(x, t, k)
        m, nc = a_csr.shape
        assert nc == t.shape[0] - k - 1

        offset = a_csr.indices[::(k+1)]
        offset = np.ascontiguousarray(offset, dtype=np.int64)
        A = a_csr.data.reshape(m, k+1)

        R = PackedMatrix(A, offset, nc)
        y_ = y[:, None]

        RR, yy = _qr_reduce_py(R, y_)
        _dierckx.qr_reduce(A, offset, nc , y_)   # in-place

        xp_assert_close(RR.a, R.a, atol=1e-15)
        xp_assert_equal(RR.offset, R.offset, check_dtype=False)
        assert RR.nc == R.nc
        xp_assert_close(yy, y_, atol=1e-15)

    # Test C-level construction of the design matrix

    def test_data_matrix(self):
        n = 10
        x, y, t, k = self._get_xyt(n)
        w = np.arange(1, n+1, dtype=float)

        A, offset, nc = _dierckx.data_matrix(x, t, k, w)

        m = x.shape[0]
        a_csr = BSpline.design_matrix(x, t, k)
        a_w = (a_csr * w[:, None]).tocsr()
        A_ = a_w.data.reshape((m, k+1))
        offset_ = a_w.indices[::(k+1)].astype(np.int64)

        xp_assert_close(A, A_, atol=1e-15)
        xp_assert_equal(offset, offset_)
        assert nc == t.shape[0] - k - 1

    def test_fpback(self):
        n = 10
        x, y, t, k = self._get_xyt(n)
        y = np.c_[y, y**2]
        A, offset, nc = _dierckx.data_matrix(x, t, k, np.ones_like(x))
        R = PackedMatrix(A, offset, nc)
        _dierckx.qr_reduce(A, offset, nc, y)

        c = fpback(R, y)
        cc = _dierckx.fpback(A, nc, y)

        xp_assert_close(cc, c, atol=1e-14)


def data_file(basename):
    return os.path.join(os.path.abspath(os.path.dirname(__file__)),
                        'data', basename)


class TestSmoothingSpline:
    #
    # test make_smoothing_spline
    #
    def test_invalid_input(self):
        rng = np.random.RandomState(1234)
        n = 100
        x = np.sort(rng.random_sample(n) * 4 - 2)
        y = x**2 * np.sin(4 * x) + x**3 + rng.normal(0., 1.5, n)

        # ``x`` and ``y`` should have same shapes (1-D array)
        with assert_raises(ValueError):
            make_smoothing_spline(x, y[1:])
        with assert_raises(ValueError):
            make_smoothing_spline(x[1:], y)
        with assert_raises(ValueError):
            make_smoothing_spline(x.reshape(1, n), y)

        # ``x`` should be an ascending array
        with assert_raises(ValueError):
            make_smoothing_spline(x[::-1], y)

        x_dupl = np.copy(x)
        x_dupl[0] = x_dupl[1]

        with assert_raises(ValueError):
            make_smoothing_spline(x_dupl, y)

        # x and y length must be >= 5
        x = np.arange(4)
        y = np.ones(4)
        exception_message = "``x`` and ``y`` length must be at least 5"
        with pytest.raises(ValueError, match=exception_message):
            make_smoothing_spline(x, y)

    def test_compare_with_GCVSPL(self):
        """
        Data is generated in the following way:
        >>> np.random.seed(1234)
        >>> n = 100
        >>> x = np.sort(np.random.random_sample(n) * 4 - 2)
        >>> y = np.sin(x) + np.random.normal(scale=.5, size=n)
        >>> np.savetxt('x.csv', x)
        >>> np.savetxt('y.csv', y)

        We obtain the result of performing the GCV smoothing splines
        package (by Woltring, gcvspl) on the sample data points
        using its version for Octave (https://github.com/srkuberski/gcvspl).
        In order to use this implementation, one should clone the repository
        and open the folder in Octave.
        In Octave, we load up ``x`` and ``y`` (generated from Python code
        above):

        >>> x = csvread('x.csv');
        >>> y = csvread('y.csv');

        Then, in order to access the implementation, we compile gcvspl files in
        Octave:

        >>> mex gcvsplmex.c gcvspl.c
        >>> mex spldermex.c gcvspl.c

        The first function computes the vector of unknowns from the dataset
        (x, y) while the second one evaluates the spline in certain points
        with known vector of coefficients.

        >>> c = gcvsplmex( x, y, 2 );
        >>> y0 = spldermex( x, c, 2, x, 0 );

        If we want to compare the results of the gcvspl code, we can save
        ``y0`` in csv file:

        >>> csvwrite('y0.csv', y0);

        """
        # load the data sample
        with np.load(data_file('gcvspl.npz')) as data:
            # data points
            x = data['x']
            y = data['y']

            y_GCVSPL = data['y_GCVSPL']
        y_compr = make_smoothing_spline(x, y)(x)

        # such tolerance is explained by the fact that the spline is built
        # using an iterative algorithm for minimizing the GCV criteria. These
        # algorithms may vary, so the tolerance should be rather low.
        # Not checking dtypes as gcvspl.npz stores little endian arrays, which
        # result in conflicting dtypes on big endian systems.
        xp_assert_close(y_compr, y_GCVSPL, atol=1e-4, rtol=1e-4, check_dtype=False)

    def test_non_regularized_case(self):
        """
        In case the regularization parameter is 0, the resulting spline
        is an interpolation spline with natural boundary conditions.
        """
        # create data sample
        rng = np.random.RandomState(1234)
        n = 100
        x = np.sort(rng.random_sample(n) * 4 - 2)
        y = x**2 * np.sin(4 * x) + x**3 + rng.normal(0., 1.5, n)

        spline_GCV = make_smoothing_spline(x, y, lam=0.)
        spline_interp = make_interp_spline(x, y, 3, bc_type='natural')

        grid = np.linspace(x[0], x[-1], 2 * n)
        xp_assert_close(spline_GCV(grid),
                        spline_interp(grid),
                        atol=1e-15)

    @pytest.mark.fail_slow(2)
    def test_weighted_smoothing_spline(self):
        # create data sample
        rng = np.random.RandomState(1234)
        n = 100
        x = np.sort(rng.random_sample(n) * 4 - 2)
        y = x**2 * np.sin(4 * x) + x**3 + rng.normal(0., 1.5, n)

        spl = make_smoothing_spline(x, y)

        # in order not to iterate over all of the indices, we select 10 of
        # them randomly
        for ind in rng.choice(range(100), size=10):
            w = np.ones(n)
            w[ind] = 30.
            spl_w = make_smoothing_spline(x, y, w)
            # check that spline with weight in a certain point is closer to the
            # original point than the one without weights
            orig = abs(spl(x[ind]) - y[ind])
            weighted = abs(spl_w(x[ind]) - y[ind])

            if orig < weighted:
                raise ValueError(f'Spline with weights should be closer to the'
                                 f' points than the original one: {orig:.4} < '
                                 f'{weighted:.4}')


################################
# NdBSpline tests
def bspline2(xy, t, c, k):
    """A naive 2D tensort product spline evaluation."""
    x, y = xy
    tx, ty = t
    nx = len(tx) - k - 1
    assert (nx >= k+1)
    ny = len(ty) - k - 1
    assert (ny >= k+1)
    res = sum(c[ix, iy] * B(x, k, ix, tx) * B(y, k, iy, ty)
              for ix in range(nx) for iy in range(ny))
    return np.asarray(res)


def B(x, k, i, t):
    if k == 0:
        return 1.0 if t[i] <= x < t[i+1] else 0.0
    if t[i+k] == t[i]:
        c1 = 0.0
    else:
        c1 = (x - t[i])/(t[i+k] - t[i]) * B(x, k-1, i, t)
    if t[i+k+1] == t[i+1]:
        c2 = 0.0
    else:
        c2 = (t[i+k+1] - x)/(t[i+k+1] - t[i+1]) * B(x, k-1, i+1, t)
    return c1 + c2


def bspline(x, t, c, k):
    n = len(t) - k - 1
    assert (n >= k+1) and (len(c) >= n)
    return sum(c[i] * B(x, k, i, t) for i in range(n))


class NdBSpline0:
    def __init__(self, t, c, k=3):
        """Tensor product spline object.

        c[i1, i2, ..., id] * B(x1, i1) * B(x2, i2) * ... * B(xd, id)

        Parameters
        ----------
        c : ndarray, shape (n1, n2, ..., nd, ...)
            b-spline coefficients
        t : tuple of 1D ndarrays
            knot vectors in directions 1, 2, ... d
            ``len(t[i]) == n[i] + k + 1``
        k : int or length-d tuple of integers
            spline degrees.
        """
        ndim = len(t)
        assert ndim <= len(c.shape)

        try:
            len(k)
        except TypeError:
            # make k a tuple
            k = (k,)*ndim

        self.k = tuple(operator.index(ki) for ki in k)
        self.t = tuple(np.asarray(ti, dtype=float) for ti in t)
        self.c = c

    def __call__(self, x):
        ndim = len(self.t)
        # a single evaluation point: `x` is a 1D array_like, shape (ndim,)
        assert len(x) == ndim

        # get the indices in an ndim-dimensional vector
        i = ['none', ]*ndim
        for d in range(ndim):
            td, xd = self.t[d], x[d]
            k = self.k[d]

            # find the index for x[d]
            if xd == td[k]:
                i[d] = k
            else:
                i[d] = np.searchsorted(td, xd) - 1
            assert td[i[d]] <= xd <= td[i[d]+1]
            assert i[d] >= k and i[d] < len(td) - k
        i = tuple(i)

        # iterate over the dimensions, form linear combinations of
        # products B(x_1) * B(x_2) * ... B(x_N) of (k+1)**N b-splines
        # which are non-zero at `i = (i_1, i_2, ..., i_N)`.
        result = 0
        iters = [range(i[d] - self.k[d], i[d] + 1) for d in range(ndim)]
        for idx in itertools.product(*iters):
            term = self.c[idx] * np.prod([B(x[d], self.k[d], idx[d], self.t[d])
                                          for d in range(ndim)])
            result += term
        return np.asarray(result)


class TestNdBSpline:

    def test_1D(self):
        # test ndim=1 agrees with BSpline
        rng = np.random.default_rng(12345)
        n, k = 11, 3
        n_tr = 7
        t = np.sort(rng.uniform(size=n + k + 1))
        c = rng.uniform(size=(n, n_tr))

        b = BSpline(t, c, k)
        nb = NdBSpline((t,), c, k)

        xi = rng.uniform(size=21)
        # NdBSpline expects xi.shape=(npts, ndim)
        xp_assert_close(nb(xi[:, None]),
                        b(xi), atol=1e-14)
        assert nb(xi[:, None]).shape == (xi.shape[0], c.shape[1])

    def make_2d_case(self):
        # make a 2D separable spline
        x = np.arange(6)
        y = x**3
        spl = make_interp_spline(x, y, k=3)

        y_1 = x**3 + 2*x
        spl_1 = make_interp_spline(x, y_1, k=3)

        t2 = (spl.t, spl_1.t)
        c2 = spl.c[:, None] * spl_1.c[None, :]

        return t2, c2, 3

    def make_2d_mixed(self):
        # make a 2D separable spline w/ kx=3, ky=2
        x = np.arange(6)
        y = x**3
        spl = make_interp_spline(x, y, k=3)

        x = np.arange(5) + 1.5
        y_1 = x**2 + 2*x
        spl_1 = make_interp_spline(x, y_1, k=2)

        t2 = (spl.t, spl_1.t)
        c2 = spl.c[:, None] * spl_1.c[None, :]

        return t2, c2, spl.k, spl_1.k

    def test_2D_separable(self):
        xi = [(1.5, 2.5), (2.5, 1), (0.5, 1.5)]
        t2, c2, k = self.make_2d_case()
        target = [x**3 * (y**3 + 2*y) for (x, y) in xi]

        # sanity check: bspline2 gives the product as constructed
        xp_assert_close(np.asarray([bspline2(xy, t2, c2, k) for xy in xi]),
                        np.asarray(target),
                        check_shape=False,
                        atol=1e-14)

        # check evaluation on a 2D array: the 1D array of 2D points
        bspl2 = NdBSpline(t2, c2, k=3)
        assert bspl2(xi).shape == (len(xi), )
        xp_assert_close(bspl2(xi),
                        target, atol=1e-14)

        # test that a nan in -> nan out
        xi = np.asarray(xi)
        xi[0, 1] = np.nan
        xp_assert_equal(np.isnan(bspl2(xi)), np.asarray([True, False, False]))

        # now check on a multidim xi
        rng = np.random.default_rng(12345)
        xi = rng.uniform(size=(4, 3, 2)) * 5
        result = bspl2(xi)
        assert result.shape == (4, 3)

        # also check the values
        x, y = xi.reshape((-1, 2)).T
        xp_assert_close(result.ravel(),
                        x**3 * (y**3 + 2*y), atol=1e-14)

    def test_2D_separable_2(self):
        # test `c` with trailing dimensions, i.e. c.ndim > ndim
        ndim = 2
        xi = [(1.5, 2.5), (2.5, 1), (0.5, 1.5)]
        target = [x**3 * (y**3 + 2*y) for (x, y) in xi]

        t2, c2, k = self.make_2d_case()
        c2_4 = np.dstack((c2, c2, c2, c2))   # c22.shape = (6, 6, 4)

        xy = (1.5, 2.5)
        bspl2_4 = NdBSpline(t2, c2_4, k=3)
        result = bspl2_4(xy)
        val_single = NdBSpline(t2, c2, k)(xy)
        assert result.shape == (4,)
        xp_assert_close(result,
                        [val_single, ]*4, atol=1e-14)

        # now try the array xi : the output.shape is (3, 4) where 3
        # is the number of points in xi and 4 is the trailing dimension of c
        assert bspl2_4(xi).shape == np.shape(xi)[:-1] + bspl2_4.c.shape[ndim:]
        xp_assert_close(bspl2_4(xi),  np.asarray(target)[:, None],
                        check_shape=False,
                        atol=5e-14)

        # two trailing dimensions
        c2_22 = c2_4.reshape((6, 6, 2, 2))
        bspl2_22 = NdBSpline(t2, c2_22, k=3)

        result = bspl2_22(xy)
        assert result.shape == (2, 2)
        xp_assert_close(result,
                        [[val_single, val_single],
                         [val_single, val_single]], atol=1e-14)

        # now try the array xi : the output shape is (3, 2, 2)
        # for 3 points in xi and c trailing dimensions being (2, 2)
        assert (bspl2_22(xi).shape ==
                np.shape(xi)[:-1] + bspl2_22.c.shape[ndim:])
        xp_assert_close(bspl2_22(xi), np.asarray(target)[:, None, None],
                        check_shape=False,
                        atol=5e-14)


    def test_2D_separable_2_complex(self):
        # test `c` with c.dtype == complex, with and w/o trailing dims
        xi = [(1.5, 2.5), (2.5, 1), (0.5, 1.5)]
        target = [x**3 * (y**3 + 2*y) for (x, y) in xi]

        target = [t + 2j*t for t in target]

        t2, c2, k = self.make_2d_case()
        c2 = c2 * (1 + 2j)
        c2_4 = np.dstack((c2, c2, c2, c2))   # c2_4.shape = (6, 6, 4)

        xy = (1.5, 2.5)
        bspl2_4 = NdBSpline(t2, c2_4, k=3)
        result = bspl2_4(xy)
        val_single = NdBSpline(t2, c2, k)(xy)
        assert result.shape == (4,)
        xp_assert_close(result,
                        [val_single, ]*4, atol=1e-14)

    def test_2D_random(self):
        rng = np.random.default_rng(12345)
        k = 3
        tx = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=7)) * 3, 3, 3, 3, 3]
        ty = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=8)) * 4, 4, 4, 4, 4]
        c = rng.uniform(size=(tx.size-k-1, ty.size-k-1))

        spl = NdBSpline((tx, ty), c, k=k)

        xi = (1., 1.)
        xp_assert_close(spl(xi),
                        bspline2(xi, (tx, ty), c, k), atol=1e-14)

        xi = np.c_[[1, 1.5, 2],
                   [1.1, 1.6, 2.1]]
        xp_assert_close(spl(xi),
                        [bspline2(xy, (tx, ty), c, k) for xy in xi],
                        atol=1e-14)

    def test_2D_mixed(self):
        t2, c2, kx, ky = self.make_2d_mixed()
        xi = [(1.4, 4.5), (2.5, 2.4), (4.5, 3.5)]
        target = [x**3 * (y**2 + 2*y) for (x, y) in xi]
        bspl2 = NdBSpline(t2, c2, k=(kx, ky))
        assert bspl2(xi).shape == (len(xi), )
        xp_assert_close(bspl2(xi),
                        target, atol=1e-14)

    def test_2D_derivative(self):
        t2, c2, kx, ky = self.make_2d_mixed()
        xi = [(1.4, 4.5), (2.5, 2.4), (4.5, 3.5)]
        bspl2 = NdBSpline(t2, c2, k=(kx, ky))

        der = bspl2(xi, nu=(1, 0))
        xp_assert_close(der,
                        [3*x**2 * (y**2 + 2*y) for x, y in xi], atol=1e-14)

        der = bspl2(xi, nu=(1, 1))
        xp_assert_close(der,
                        [3*x**2 * (2*y + 2) for x, y in xi], atol=1e-14)

        der = bspl2(xi, nu=(0, 0))
        xp_assert_close(der,
                        [x**3 * (y**2 + 2*y) for x, y in xi], atol=1e-14)

        with assert_raises(ValueError):
            # all(nu >= 0)
            der = bspl2(xi, nu=(-1, 0))

        with assert_raises(ValueError):
            # len(nu) == ndim
            der = bspl2(xi, nu=(-1, 0, 1))

    def test_2D_mixed_random(self):
        rng = np.random.default_rng(12345)
        kx, ky = 2, 3
        tx = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=7)) * 3, 3, 3, 3, 3]
        ty = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=8)) * 4, 4, 4, 4, 4]
        c = rng.uniform(size=(tx.size - kx - 1, ty.size - ky - 1))

        xi = np.c_[[1, 1.5, 2],
                   [1.1, 1.6, 2.1]]

        bspl2 = NdBSpline((tx, ty), c, k=(kx, ky))
        bspl2_0 = NdBSpline0((tx, ty), c, k=(kx, ky))

        xp_assert_close(bspl2(xi),
                        [bspl2_0(xp) for xp in xi], atol=1e-14)

    def test_tx_neq_ty(self):
        # 2D separable spline w/ len(tx) != len(ty)
        x = np.arange(6)
        y = np.arange(7) + 1.5

        spl_x = make_interp_spline(x, x**3, k=3)
        spl_y = make_interp_spline(y, y**2 + 2*y, k=3)
        cc = spl_x.c[:, None] * spl_y.c[None, :]
        bspl = NdBSpline((spl_x.t, spl_y.t), cc, (spl_x.k, spl_y.k))

        values = (x**3)[:, None] * (y**2 + 2*y)[None, :]
        rgi = RegularGridInterpolator((x, y), values)

        xi = [(a, b) for a, b in itertools.product(x, y)]
        bxi = bspl(xi)

        assert not np.isnan(bxi).any()
        xp_assert_close(bxi, rgi(xi), atol=1e-14)
        xp_assert_close(bxi.reshape(values.shape), values, atol=1e-14)

    def make_3d_case(self):
        # make a 3D separable spline
        x = np.arange(6)
        y = x**3
        spl = make_interp_spline(x, y, k=3)

        y_1 = x**3 + 2*x
        spl_1 = make_interp_spline(x, y_1, k=3)

        y_2 = x**3 + 3*x + 1
        spl_2 = make_interp_spline(x, y_2, k=3)

        t2 = (spl.t, spl_1.t, spl_2.t)
        c2 = (spl.c[:, None, None] *
              spl_1.c[None, :, None] *
              spl_2.c[None, None, :])

        return t2, c2, 3

    def test_3D_separable(self):
        rng = np.random.default_rng(12345)
        x, y, z = rng.uniform(size=(3, 11)) * 5
        target = x**3 * (y**3 + 2*y) * (z**3 + 3*z + 1)

        t3, c3, k = self.make_3d_case()
        bspl3 = NdBSpline(t3, c3, k=3)

        xi = [_ for _ in zip(x, y, z)]
        result = bspl3(xi)
        assert result.shape == (11,)
        xp_assert_close(result, target, atol=1e-14)

    def test_3D_derivative(self):
        t3, c3, k = self.make_3d_case()
        bspl3 = NdBSpline(t3, c3, k=3)
        rng = np.random.default_rng(12345)
        x, y, z = rng.uniform(size=(3, 11)) * 5
        xi = [_ for _ in zip(x, y, z)]

        xp_assert_close(bspl3(xi, nu=(1, 0, 0)),
                        3*x**2 * (y**3 + 2*y) * (z**3 + 3*z + 1), atol=1e-14)

        xp_assert_close(bspl3(xi, nu=(2, 0, 0)),
                        6*x * (y**3 + 2*y) * (z**3 + 3*z + 1), atol=1e-14)

        xp_assert_close(bspl3(xi, nu=(2, 1, 0)),
                        6*x * (3*y**2 + 2) * (z**3 + 3*z + 1), atol=1e-14)

        xp_assert_close(bspl3(xi, nu=(2, 1, 3)),
                        6*x * (3*y**2 + 2) * (6), atol=1e-14)

        xp_assert_close(bspl3(xi, nu=(2, 1, 4)),
                        np.zeros(len(xi)), atol=1e-14)

    def test_3D_random(self):
        rng = np.random.default_rng(12345)
        k = 3
        tx = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=7)) * 3, 3, 3, 3, 3]
        ty = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=8)) * 4, 4, 4, 4, 4]
        tz = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=8)) * 4, 4, 4, 4, 4]
        c = rng.uniform(size=(tx.size-k-1, ty.size-k-1, tz.size-k-1))

        spl = NdBSpline((tx, ty, tz), c, k=k)
        spl_0 = NdBSpline0((tx, ty, tz), c, k=k)

        xi = (1., 1., 1)
        xp_assert_close(spl(xi), spl_0(xi), atol=1e-14)

        xi = np.c_[[1, 1.5, 2],
                   [1.1, 1.6, 2.1],
                   [0.9, 1.4, 1.9]]
        xp_assert_close(spl(xi), [spl_0(xp) for xp in xi], atol=1e-14)

    def test_3D_random_complex(self):
        rng = np.random.default_rng(12345)
        k = 3
        tx = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=7)) * 3, 3, 3, 3, 3]
        ty = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=8)) * 4, 4, 4, 4, 4]
        tz = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=8)) * 4, 4, 4, 4, 4]
        c = (rng.uniform(size=(tx.size-k-1, ty.size-k-1, tz.size-k-1)) +
             rng.uniform(size=(tx.size-k-1, ty.size-k-1, tz.size-k-1))*1j)

        spl = NdBSpline((tx, ty, tz), c, k=k)
        spl_re = NdBSpline((tx, ty, tz), c.real, k=k)
        spl_im = NdBSpline((tx, ty, tz), c.imag, k=k)

        xi = np.c_[[1, 1.5, 2],
                   [1.1, 1.6, 2.1],
                   [0.9, 1.4, 1.9]]
        xp_assert_close(spl(xi),
                        spl_re(xi) + 1j*spl_im(xi), atol=1e-14)

    @pytest.mark.parametrize('cls_extrap', [None, True])
    @pytest.mark.parametrize('call_extrap', [None, True])
    def test_extrapolate_3D_separable(self, cls_extrap, call_extrap):
        # test that extrapolate=True does extrapolate
        t3, c3, k = self.make_3d_case()
        bspl3 = NdBSpline(t3, c3, k=3, extrapolate=cls_extrap)

        # evaluate out of bounds
        x, y, z = [-2, -1, 7], [-3, -0.5, 6.5], [-1, -1.5, 7.5]
        x, y, z = map(np.asarray, (x, y, z))
        xi = [_ for _ in zip(x, y, z)]
        target = x**3 * (y**3 + 2*y) * (z**3 + 3*z + 1)

        result = bspl3(xi, extrapolate=call_extrap)
        xp_assert_close(result, target, atol=1e-14)

    @pytest.mark.parametrize('extrap', [(False, True), (True, None)])
    def test_extrapolate_3D_separable_2(self, extrap):
        # test that call(..., extrapolate=None) defers to self.extrapolate,
        # otherwise supersedes self.extrapolate
        t3, c3, k = self.make_3d_case()
        cls_extrap, call_extrap = extrap
        bspl3 = NdBSpline(t3, c3, k=3, extrapolate=cls_extrap)

        # evaluate out of bounds
        x, y, z = [-2, -1, 7], [-3, -0.5, 6.5], [-1, -1.5, 7.5]
        x, y, z = map(np.asarray, (x, y, z))
        xi = [_ for _ in zip(x, y, z)]
        target = x**3 * (y**3 + 2*y) * (z**3 + 3*z + 1)

        result = bspl3(xi, extrapolate=call_extrap)
        xp_assert_close(result, target, atol=1e-14)

    def test_extrapolate_false_3D_separable(self):
        # test that extrapolate=False produces nans for out-of-bounds values
        t3, c3, k = self.make_3d_case()
        bspl3 = NdBSpline(t3, c3, k=3)

        # evaluate out of bounds and inside
        x, y, z = [-2, 1, 7], [-3, 0.5, 6.5], [-1, 1.5, 7.5]
        x, y, z = map(np.asarray, (x, y, z))
        xi = [_ for _ in zip(x, y, z)]
        target = x**3 * (y**3 + 2*y) * (z**3 + 3*z + 1)

        result = bspl3(xi, extrapolate=False)
        assert np.isnan(result[0])
        assert np.isnan(result[-1])
        xp_assert_close(result[1:-1], target[1:-1], atol=1e-14)

    def test_x_nan_3D(self):
        # test that spline(nan) is nan
        t3, c3, k = self.make_3d_case()
        bspl3 = NdBSpline(t3, c3, k=3)

        # evaluate out of bounds and inside
        x = np.asarray([-2, 3, np.nan, 1, 2, 7, np.nan])
        y = np.asarray([-3, 3.5, 1, np.nan, 3, 6.5, 6.5])
        z = np.asarray([-1, 3.5, 2, 3, np.nan, 7.5, 7.5])
        xi = [_ for _ in zip(x, y, z)]
        target = x**3 * (y**3 + 2*y) * (z**3 + 3*z + 1)
        mask = np.isnan(x) | np.isnan(y) | np.isnan(z)
        target[mask] = np.nan

        result = bspl3(xi)
        assert np.isnan(result[mask]).all()
        xp_assert_close(result, target, atol=1e-14)

    def test_non_c_contiguous(self):
        # check that non C-contiguous inputs are OK
        rng = np.random.default_rng(12345)
        kx, ky = 3, 3
        tx = np.sort(rng.uniform(low=0, high=4, size=16))
        tx = np.r_[(tx[0],)*kx, tx, (tx[-1],)*kx]
        ty = np.sort(rng.uniform(low=0, high=4, size=16))
        ty = np.r_[(ty[0],)*ky, ty, (ty[-1],)*ky]

        assert not tx[::2].flags.c_contiguous
        assert not ty[::2].flags.c_contiguous

        c = rng.uniform(size=(tx.size//2 - kx - 1, ty.size//2 - ky - 1))
        c = c.T
        assert not c.flags.c_contiguous

        xi = np.c_[[1, 1.5, 2],
                   [1.1, 1.6, 2.1]]

        bspl2 = NdBSpline((tx[::2], ty[::2]), c, k=(kx, ky))
        bspl2_0 = NdBSpline0((tx[::2], ty[::2]), c, k=(kx, ky))

        xp_assert_close(bspl2(xi),
                        [bspl2_0(xp) for xp in xi], atol=1e-14)

    def test_readonly(self):
        t3, c3, k = self.make_3d_case()
        bspl3 = NdBSpline(t3, c3, k=3)

        for i in range(3):
            t3[i].flags.writeable = False
        c3.flags.writeable = False

        bspl3_ = NdBSpline(t3, c3, k=3)

        assert bspl3((1, 2, 3)) == bspl3_((1, 2, 3))

    def test_design_matrix(self):
        t3, c3, k = self.make_3d_case()

        xi = np.asarray([[1, 2, 3], [4, 5, 6]])
        dm = NdBSpline(t3, c3, k).design_matrix(xi, t3, k)
        dm1 = NdBSpline.design_matrix(xi, t3, [k, k, k])
        assert dm.shape[0] == xi.shape[0]
        xp_assert_close(dm.todense(), dm1.todense(), atol=1e-16)

        with assert_raises(ValueError):
            NdBSpline.design_matrix([1, 2, 3], t3, [k]*3)

        with assert_raises(ValueError, match="Data and knots*"):
            NdBSpline.design_matrix([[1, 2]], t3, [k]*3)

    @pytest.mark.thread_unsafe
    def test_concurrency(self):
        rng = np.random.default_rng(12345)
        k = 3
        tx = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=7)) * 3, 3, 3, 3, 3]
        ty = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=8)) * 4, 4, 4, 4, 4]
        tz = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=8)) * 4, 4, 4, 4, 4]
        c = rng.uniform(size=(tx.size-k-1, ty.size-k-1, tz.size-k-1))

        spl = NdBSpline((tx, ty, tz), c, k=k)

        def worker_fn(_, spl):
            xi = np.c_[[1, 1.5, 2],
                       [1.1, 1.6, 2.1],
                       [0.9, 1.4, 1.9]]
            spl(xi)

        _run_concurrent_barrier(10, worker_fn, spl)


class TestMakeND:
    def test_2D_separable_simple(self):
        x = np.arange(6)
        y = np.arange(6) + 0.5
        values = x[:, None]**3 * (y**3 + 2*y)[None, :]
        xi = [(a, b) for a, b in itertools.product(x, y)]

        bspl = make_ndbspl((x, y), values, k=1)
        xp_assert_close(bspl(xi), values.ravel(), atol=1e-15)

        # test the coefficients vs outer product of 1D coefficients
        spl_x = make_interp_spline(x, x**3, k=1)
        spl_y = make_interp_spline(y, y**3 + 2*y, k=1)
        cc = spl_x.c[:, None] * spl_y.c[None, :]
        xp_assert_close(cc, bspl.c, atol=1e-11, rtol=0)

        # test against RGI
        from scipy.interpolate import RegularGridInterpolator as RGI
        rgi = RGI((x, y), values, method='linear')
        xp_assert_close(rgi(xi), bspl(xi), atol=1e-14)

    def test_2D_separable_trailing_dims(self):
        # test `c` with trailing dimensions, i.e. c.ndim > ndim
        x = np.arange(6)
        y = np.arange(6)
        xi = [(a, b) for a, b in itertools.product(x, y)]

        # make values4.shape = (6, 6, 4)
        values = x[:, None]**3 * (y**3 + 2*y)[None, :]
        values4 = np.dstack((values, values, values, values))
        bspl = make_ndbspl((x, y), values4, k=3, solver=ssl.spsolve)

        result = bspl(xi)
        target = np.dstack((values, values, values, values)).astype(float)
        assert result.shape == (36, 4)
        xp_assert_close(result.reshape(6, 6, 4),
                        target, atol=1e-14)

        # now two trailing dimensions
        values22 = values4.reshape((6, 6, 2, 2))
        bspl = make_ndbspl((x, y), values22, k=3, solver=ssl.spsolve)

        result = bspl(xi)
        assert result.shape == (36, 2, 2)
        xp_assert_close(result.reshape(6, 6, 2, 2),
                        target.reshape((6, 6, 2, 2)), atol=1e-14)

    @pytest.mark.parametrize('k', [(3, 3), (1, 1), (3, 1), (1, 3), (3, 5)])
    def test_2D_mixed(self, k):
        # make a 2D separable spline w/ len(tx) != len(ty)
        x = np.arange(6)
        y = np.arange(7) + 1.5
        xi = [(a, b) for a, b in itertools.product(x, y)]

        values = (x**3)[:, None] * (y**2 + 2*y)[None, :]
        bspl = make_ndbspl((x, y), values, k=k, solver=ssl.spsolve)
        xp_assert_close(bspl(xi), values.ravel(), atol=1e-15)

    def test_2D_nans(self):
        x = np.arange(6)
        y = np.arange(6) + 0.5
        y[-1] = np.nan
        values = x[:, None]**3 * (y**3 + 2*y)[None, :]

        with assert_raises(ValueError):
            make_ndbspl((x, y), values, k=1)

    def _get_sample_2d_data(self):
        # from test_rgi.py::TestIntepN
        x = np.array([.5, 2., 3., 4., 5.5, 6.])
        y = np.array([.5, 2., 3., 4., 5.5, 6.])
        z = np.array(
            [
                [1, 2, 1, 2, 1, 1],
                [1, 2, 1, 2, 1, 1],
                [1, 2, 3, 2, 1, 1],
                [1, 2, 2, 2, 1, 1],
                [1, 2, 1, 2, 1, 1],
                [1, 2, 2, 2, 1, 1],
            ]
        )
        return x, y, z

    def test_2D_vs_RGI_linear(self):
        x, y, z = self._get_sample_2d_data()
        bspl = make_ndbspl((x, y), z, k=1)
        rgi = RegularGridInterpolator((x, y), z, method='linear')

        xi = np.array([[1, 2.3, 5.3, 0.5, 3.3, 1.2, 3],
                       [1, 3.3, 1.2, 4.0, 5.0, 1.0, 3]]).T

        xp_assert_close(bspl(xi), rgi(xi), atol=1e-14)

    def test_2D_vs_RGI_cubic(self):
        x, y, z = self._get_sample_2d_data()
        bspl = make_ndbspl((x, y), z, k=3, solver=ssl.spsolve)
        rgi = RegularGridInterpolator((x, y), z, method='cubic_legacy')

        xi = np.array([[1, 2.3, 5.3, 0.5, 3.3, 1.2, 3],
                       [1, 3.3, 1.2, 4.0, 5.0, 1.0, 3]]).T

        xp_assert_close(bspl(xi), rgi(xi), atol=1e-14)

    @pytest.mark.parametrize('solver', [ssl.gmres, ssl.gcrotmk])
    def test_2D_vs_RGI_cubic_iterative(self, solver):
        # same as `test_2D_vs_RGI_cubic`, only with an iterative solver.
        # Note the need to add an explicit `rtol` solver_arg to achieve the
        # target accuracy of 1e-14. (the relation between solver atol/rtol
        # and the accuracy of the final result is not direct and needs experimenting)
        x, y, z = self._get_sample_2d_data()
        bspl = make_ndbspl((x, y), z, k=3, solver=solver, rtol=1e-6)
        rgi = RegularGridInterpolator((x, y), z, method='cubic_legacy')

        xi = np.array([[1, 2.3, 5.3, 0.5, 3.3, 1.2, 3],
                       [1, 3.3, 1.2, 4.0, 5.0, 1.0, 3]]).T

        xp_assert_close(bspl(xi), rgi(xi), atol=1e-14, rtol=1e-7)

    def test_2D_vs_RGI_quintic(self):
        x, y, z = self._get_sample_2d_data()
        bspl = make_ndbspl((x, y), z, k=5, solver=ssl.spsolve)
        rgi = RegularGridInterpolator((x, y), z, method='quintic_legacy')

        xi = np.array([[1, 2.3, 5.3, 0.5, 3.3, 1.2, 3],
                       [1, 3.3, 1.2, 4.0, 5.0, 1.0, 3]]).T

        xp_assert_close(bspl(xi), rgi(xi), atol=1e-14)

    @pytest.mark.parametrize(
        'k, meth', [(1, 'linear'), (3, 'cubic_legacy'), (5, 'quintic_legacy')]
    )
    def test_3D_random_vs_RGI(self, k, meth):
        rndm = np.random.default_rng(123456)
        x = np.cumsum(rndm.uniform(size=6))
        y = np.cumsum(rndm.uniform(size=7))
        z = np.cumsum(rndm.uniform(size=8))
        values = rndm.uniform(size=(6, 7, 8))

        bspl = make_ndbspl((x, y, z), values, k=k, solver=ssl.spsolve)
        rgi = RegularGridInterpolator((x, y, z), values, method=meth)

        xi = np.random.uniform(low=0.7, high=2.1, size=(11, 3))
        xp_assert_close(bspl(xi), rgi(xi), atol=1e-14)

    def test_solver_err_not_converged(self):
        x, y, z = self._get_sample_2d_data()
        solver_args = {'maxiter': 1}
        with assert_raises(ValueError, match='solver'):
            make_ndbspl((x, y), z, k=3, **solver_args)

        with assert_raises(ValueError, match='solver'):
            make_ndbspl((x, y), np.dstack((z, z)), k=3, **solver_args)


class TestFpchec:
    # https://github.com/scipy/scipy/blob/main/scipy/interpolate/fitpack/fpchec.f

    def test_1D_x_t(self):
        k = 1
        t = np.arange(12).reshape(2, 6)
        x = np.arange(12)

        with pytest.raises(ValueError, match="1D sequence"):
            _b.fpcheck(x, t, k)

        with pytest.raises(ValueError, match="1D sequence"):
            _b.fpcheck(t, x, k)

    def test_condition_1(self):
        # c      1) k+1 <= n-k-1 <= m
        k = 3
        n  = 2*(k + 1) - 1    # not OK
        m = n + 11            # OK
        t = np.arange(n)
        x = np.arange(m)

        assert dfitpack.fpchec(x, t, k) == 10
        with pytest.raises(ValueError, match="Need k+1*"):
            _b.fpcheck(x, t, k)

        n = 2*(k+1) + 1   # OK
        m = n - k - 2     # not OK
        t = np.arange(n)
        x = np.arange(m)

        assert dfitpack.fpchec(x, t, k) == 10
        with pytest.raises(ValueError, match="Need k+1*"):
            _b.fpcheck(x, t, k)

    def test_condition_2(self):
        # c      2) t(1) <= t(2) <= ... <= t(k+1)
        # c         t(n-k) <= t(n-k+1) <= ... <= t(n)
        k = 3
        t = [0]*(k+1) + [2] + [5]*(k+1)   # this is OK
        x = [1, 2, 3, 4, 4.5]

        assert dfitpack.fpchec(x, t, k) == 0
        assert _b.fpcheck(x, t, k) is None    # does not raise

        tt = t.copy()
        tt[-1] = tt[0]   # not OK
        assert dfitpack.fpchec(x, tt, k) == 20
        with pytest.raises(ValueError, match="Last k knots*"):
            _b.fpcheck(x, tt, k)

        tt = t.copy()
        tt[0] = tt[-1]   # not OK
        assert dfitpack.fpchec(x, tt, k) == 20
        with pytest.raises(ValueError, match="First k knots*"):
            _b.fpcheck(x, tt, k)

    def test_condition_3(self):
        # c      3) t(k+1) < t(k+2) < ... < t(n-k)
        k = 3
        t = [0]*(k+1) + [2, 3] + [5]*(k+1)   # this is OK
        x = [1, 2, 3, 3.5, 4, 4.5]
        assert dfitpack.fpchec(x, t, k) == 0
        assert _b.fpcheck(x, t, k) is None

        t = [0]*(k+1) + [2, 2] + [5]*(k+1)   # this is not OK
        assert dfitpack.fpchec(x, t, k) == 30
        with pytest.raises(ValueError, match="Internal knots*"):
            _b.fpcheck(x, t, k)

    def test_condition_4(self):
        # c      4) t(k+1) <= x(i) <= t(n-k)
        # NB: FITPACK's fpchec only checks x[0] & x[-1], so we follow.
        k = 3
        t = [0]*(k+1) + [5]*(k+1)
        x = [1, 2, 3, 3.5, 4, 4.5]      # this is OK
        assert dfitpack.fpchec(x, t, k) == 0
        assert _b.fpcheck(x, t, k) is None

        xx = x.copy()
        xx[0] = t[0]    # still OK
        assert dfitpack.fpchec(xx, t, k) == 0
        assert _b.fpcheck(x, t, k) is None

        xx = x.copy()
        xx[0] = t[0] - 1    # not OK
        assert dfitpack.fpchec(xx, t, k) == 40
        with pytest.raises(ValueError, match="Out of bounds*"):
            _b.fpcheck(xx, t, k)

        xx = x.copy()
        xx[-1] = t[-1] + 1    # not OK
        assert dfitpack.fpchec(xx, t, k) == 40
        with pytest.raises(ValueError, match="Out of bounds*"):
            _b.fpcheck(xx, t, k)

    # ### Test the S-W condition (no 5)
    # c      5) the conditions specified by schoenberg and whitney must hold
    # c         for at least one subset of data points, i.e. there must be a
    # c         subset of data points y(j) such that
    # c             t(j) < y(j) < t(j+k+1), j=1,2,...,n-k-1
    def test_condition_5_x1xm(self):
        # x(1).ge.t(k2) .or. x(m).le.t(nk1)
        k = 1
        t = [0, 0, 1, 2, 2]
        x = [1.1, 1.1, 1.1]
        assert dfitpack.fpchec(x, t, k) == 50
        with pytest.raises(ValueError, match="Schoenberg-Whitney*"):
            _b.fpcheck(x, t, k)

        x = [0.5, 0.5, 0.5]
        assert dfitpack.fpchec(x, t, k) == 50
        with pytest.raises(ValueError, match="Schoenberg-Whitney*"):
            _b.fpcheck(x, t, k)

    def test_condition_5_k1(self):
        # special case nk3 (== n - k - 2) < 2
        k = 1
        t = [0, 0, 1, 1]
        x = [0.5, 0.6]
        assert dfitpack.fpchec(x, t, k) == 0
        assert _b.fpcheck(x, t, k) is None

    def test_condition_5_1(self):
        # basically, there can't be an interval of t[j]..t[j+k+1] with no x
        k = 3
        t = [0]*(k+1) + [2] + [5]*(k+1)
        x = [3]*5
        assert dfitpack.fpchec(x, t, k) == 50
        with pytest.raises(ValueError, match="Schoenberg-Whitney*"):
            _b.fpcheck(x, t, k)

        t = [0]*(k+1) + [2] + [5]*(k+1)
        x = [1]*5
        assert dfitpack.fpchec(x, t, k) == 50
        with pytest.raises(ValueError, match="Schoenberg-Whitney*"):
            _b.fpcheck(x, t, k)

    def test_condition_5_2(self):
        # same as _5_1, only the empty interval is in the middle
        k = 3
        t = [0]*(k+1) + [2, 3] + [5]*(k+1)
        x = [1.1]*5 + [4]

        assert dfitpack.fpchec(x, t, k) == 50
        with pytest.raises(ValueError, match="Schoenberg-Whitney*"):
            _b.fpcheck(x, t, k)

        # and this one is OK
        x = [1.1]*4 + [4, 4]
        assert dfitpack.fpchec(x, t, k) == 0
        assert _b.fpcheck(x, t, k) is None

    def test_condition_5_3(self):
        # similar to _5_2, covers a different failure branch
        k = 1
        t = [0, 0, 2, 3, 4, 5, 6, 7, 7]
        x = [1, 1, 1, 5.2, 5.2, 5.2, 6.5]

        assert dfitpack.fpchec(x, t, k) == 50
        with pytest.raises(ValueError, match="Schoenberg-Whitney*"):
            _b.fpcheck(x, t, k)


# ### python replicas of generate_knots(...) implementation details, for testing.
# ### see TestGenerateKnots::test_split_and_add_knot
def _split(x, t, k, residuals):
    """Split the knot interval into "runs".
    """
    ix = np.searchsorted(x, t[k:-k])
    # sum half-open intervals
    fparts = [residuals[ix[i]:ix[i+1]].sum() for i in range(len(ix)-1)]
    carries = residuals[ix[1:-1]]

    for i in range(len(carries)):     # split residuals at internal knots
        carry = carries[i] / 2
        fparts[i] += carry
        fparts[i+1] -= carry

    fparts[-1] += residuals[-1]       # add the contribution of the last knot

    xp_assert_close(sum(fparts), sum(residuals), atol=1e-15)

    return fparts, ix


def _add_knot(x, t, k, residuals):
    """Insert a new knot given reduals."""
    fparts, ix = _split(x, t, k, residuals)

    # find the interval with max fparts and non-zero number of x values inside
    idx_max = -101
    fpart_max = -1e100
    for i in range(len(fparts)):
        if ix[i+1] - ix[i] > 1 and fparts[i] > fpart_max:
            idx_max = i
            fpart_max = fparts[i]

    if idx_max == -101:
        raise ValueError("Internal error, please report it to SciPy developers.")

    # round up, like Dierckx does? This is really arbitrary though.
    idx_newknot = (ix[idx_max] + ix[idx_max+1] + 1) // 2
    new_knot = x[idx_newknot]
    idx_t = np.searchsorted(t, new_knot)
    t_new = np.r_[t[:idx_t], new_knot, t[idx_t:]]
    return t_new


class TestGenerateKnots:
    def test_split_add_knot(self):
        # smoke test implementation details: insert a new knot given residuals
        x = np.arange(8, dtype=float)
        y = x**3 + 1./(1 + x)
        k = 3
        t = np.array([0.]*(k+1) + [7.]*(k+1))
        spl = make_lsq_spline(x, y, k=k, t=t)
        residuals = (spl(x) - y)**2

        from scipy.interpolate import _fitpack_repro as _fr
        new_t = _fr.add_knot(x, t, k, residuals)
        new_t_py = _add_knot(x, t, k, residuals)

        xp_assert_close(new_t, new_t_py, atol=1e-15)

        # redo with new knots
        spl2 = make_lsq_spline(x, y, k=k, t=new_t)
        residuals2 = (spl2(x) - y)**2

        new_t2 = _fr.add_knot(x, new_t, k, residuals2)
        new_t2_py = _add_knot(x, new_t, k, residuals2)

        xp_assert_close(new_t2, new_t2_py, atol=1e-15)

    @pytest.mark.parametrize('k', [1, 2, 3, 4, 5])
    def test_s0(self, k):
        x = np.arange(8, dtype=np.float64)
        y = np.sin(x*np.pi/8)
        t = list(generate_knots(x, y, k=k, s=0))[-1]

        tt = splrep(x, y, k=k, s=0)[0]
        xp_assert_close(t, tt, atol=1e-15)

    def test_s0_1(self):
        # with these data, naive algorithm tries to insert >= nmax knots
        n = 10
        x = np.arange(n)
        y = x**3
        knots = list(generate_knots(x, y, k=3, s=0))   # does not error out
        xp_assert_close(knots[-1], _not_a_knot(x, 3), atol=1e-15)

    def test_s0_n20(self):
        n = 20
        x = np.arange(n)
        y = x**3
        knots = list(generate_knots(x, y, k=3, s=0))
        xp_assert_close(knots[-1], _not_a_knot(x, 3), atol=1e-15)

    def test_s0_nest(self):
        # s=0 and non-default nest: not implemented, errors out
        x = np.arange(10)
        y = x**3
        with assert_raises(ValueError):
            list(generate_knots(x, y, k=3, s=0, nest=10))

    def test_s_switch(self):
        # test the process switching to interpolating knots when len(t) == m + k + 1
        """
        To generate the `wanted` list below apply the following diff and rerun
        the test. The stdout will contain successive iterations of the `t`
        array.

$ git diff scipy/interpolate/fitpack/fpcurf.f
diff --git a/scipy/interpolate/fitpack/fpcurf.f b/scipy/interpolate/fitpack/fpcurf.f
index 1afb1900f1..d817e51ad8 100644
--- a/scipy/interpolate/fitpack/fpcurf.f
+++ b/scipy/interpolate/fitpack/fpcurf.f
@@ -216,6 +216,9 @@ c  t(j+k) <= x(i) <= t(j+k+1) and store it in fpint(j),j=1,2,...nrint.
         do 190 l=1,nplus
 c  add a new knot.
           call fpknot(x,m,t,n,fpint,nrdata,nrint,nest,1)
+          print*, l, nest, ': ', t
+          print*, "n, nmax = ", n, nmax
+
 c  if n=nmax we locate the knots as for interpolation.
           if(n.eq.nmax) go to 10
 c  test whether we cannot further increase the number of knots.
        """  # NOQA: E501
        x = np.arange(8)
        y = np.sin(x*np.pi/8)
        k = 3

        knots = list(generate_knots(x, y, k=k, s=1e-7))
        wanted = [[0., 0., 0., 0., 7., 7., 7., 7.],
                  [0., 0., 0., 0., 4., 7., 7., 7., 7.],
                  [0., 0., 0., 0., 2., 4., 7., 7., 7., 7.],
                  [0., 0., 0., 0., 2., 4., 6., 7., 7., 7., 7.],
                  [0., 0., 0., 0., 2., 3., 4., 5., 7, 7., 7., 7.]
        ]

        assert len(knots) == len(wanted)
        for t, tt in zip(knots, wanted):
            xp_assert_close(t, tt, atol=1e-15)

        # also check that the last knot vector matches FITPACK
        t, _, _ = splrep(x, y, k=k, s=1e-7)
        xp_assert_close(knots[-1], t, atol=1e-15)

    def test_list_input(self):
        # test that list inputs are accepted
        x = list(range(8))
        gen = generate_knots(x, x, s=0.1, k=1)
        next(gen)

    def test_nest(self):
        # test that nest < nmax stops the process early (and we get 10 knots not 12)
        x = np.arange(8)
        y = np.sin(x*np.pi/8)
        s = 1e-7

        knots = list(generate_knots(x, y, k=3, s=s, nest=10))
        xp_assert_close(knots[-1],
                        [0., 0., 0., 0., 2., 4., 7., 7., 7., 7.], atol=1e-15)

        with assert_raises(ValueError):
            # nest < 2*(k+1)
            list(generate_knots(x, y, k=3, nest=4))

    def test_weights(self):
        x = np.arange(8)
        y = np.sin(x*np.pi/8)

        with assert_raises(ValueError):
            list(generate_knots(x, y, w=np.arange(11)))   # len(w) != len(x)

        with assert_raises(ValueError):
            list(generate_knots(x, y, w=-np.ones(8)))    # w < 0

    @pytest.mark.parametrize("npts", [30, 50, 100])
    @pytest.mark.parametrize("s", [0.1, 1e-2, 0])
    def test_vs_splrep(self, s, npts):
        # XXX this test is brittle: differences start apearing for k=3 and s=1e-6,
        # also for k != 3. Might be worth investigating at some point.
        # I think we do not really guarantee exact agreement with splrep. Instead,
        # we guarantee it is the same *in most cases*; otherwise slight differences
        # are allowed. There is no theorem, it is al heuristics by P. Dierckx.
        # The best we can do it to best-effort reproduce it.
        rndm = np.random.RandomState(12345)
        x = 10*np.sort(rndm.uniform(size=npts))
        y = np.sin(x*np.pi/10) + np.exp(-(x-6)**2)

        k = 3
        t = splrep(x, y, k=k, s=s)[0]
        tt = list(generate_knots(x, y, k=k, s=s))[-1]

        xp_assert_close(tt, t, atol=1e-15)

    @pytest.mark.thread_unsafe
    def test_s_too_small(self):
        n = 14
        x = np.arange(n)
        y = x**3

        # XXX splrep warns that "s too small": ier=2
        knots = list(generate_knots(x, y, k=3, s=1e-50))

        with suppress_warnings() as sup:
            r = sup.record(RuntimeWarning)
            tck = splrep(x, y, k=3, s=1e-50)
            assert len(r) == 1
        xp_assert_equal(knots[-1], tck[0])


def disc_naive(t, k):
    """Straitforward way to compute the discontinuity matrix. For testing ONLY.

    This routine returns a dense matrix, while `_fitpack_repro.disc` returns
    a packed one.
    """
    n = t.shape[0]

    delta = t[n - k - 1] - t[k]
    nrint = n - 2*k - 1

    ti = t[k+1:n-k-1]   # internal knots
    tii = np.repeat(ti, 2)
    tii[::2] += 1e-10
    tii[1::2] -= 1e-10
    m = BSpline(t, np.eye(n - k - 1), k)(tii, nu=k)

    matr = np.empty((nrint-1, m.shape[1]), dtype=float)
    for i in range(0, m.shape[0], 2):
        matr[i//2, :] = m[i, :] - m[i+1, :]

    matr *= (delta/nrint)**k / math.factorial(k)
    return matr


class F_dense:
    """ The r.h.s. of ``f(p) = s``, an analog of _fitpack_repro.F
    Uses full matrices, so is for tests only.
    """
    def __init__(self, x, y, t, k, s, w=None):
        self.x = x
        self.y = y
        self.t = t
        self.k = k
        self.w = np.ones_like(x, dtype=float) if w is None else w
        assert self.w.ndim == 1

        # lhs
        a_dense = BSpline(t, np.eye(t.shape[0] - k - 1), k)(x)
        self.a_dense = a_dense * self.w[:, None]

        from scipy.interpolate import _fitpack_repro as _fr
        self.b_dense = PackedMatrix(*_fr.disc(t, k)).todense()

        # rhs
        assert y.ndim == 1
        yy = y * self.w
        self.yy = np.r_[yy, np.zeros(self.b_dense.shape[0])]

        self.s = s

    def __call__(self, p):
        ab = np.vstack((self.a_dense, self.b_dense / p))

        # LSQ solution of ab @ c = yy
        from scipy.linalg import qr, solve
        q, r = qr(ab, mode='economic')

        qy = q.T @ self.yy

        nc = r.shape[1]
        c = solve(r[:nc, :nc], qy[:nc])

        spl = BSpline(self.t, c, self.k)
        fp = np.sum(self.w**2 * (spl(self.x) - self.y)**2)

        self.spl = spl   # store it

        return fp - self.s


class TestMakeSplrep:
    def test_input_errors(self):
        x = np.linspace(0, 10, 11)
        y = np.linspace(0, 10, 12)
        with assert_raises(ValueError):
            # len(x) != len(y)
            make_splrep(x, y)

        with assert_raises(ValueError):
            # 0D inputs
            make_splrep(1, 2, s=0.1)

        with assert_raises(ValueError):
            # y.ndim > 2
            y = np.ones((x.size, 2, 2, 2))
            make_splrep(x, y, s=0.1)

        w = np.ones(12)
        with assert_raises(ValueError):
            # len(weights) != len(x)
            make_splrep(x, x**3, w=w, s=0.1)

        w = -np.ones(12)
        with assert_raises(ValueError):
            # w < 0
            make_splrep(x, x**3, w=w, s=0.1)

        w = np.ones((x.shape[0], 2))
        with assert_raises(ValueError):
            # w.ndim != 1
            make_splrep(x, x**3, w=w, s=0.1)

        with assert_raises(ValueError):
            # x not ordered
            make_splrep(x[::-1], x**3, s=0.1)

        with assert_raises(TypeError):
            # k != int(k)
            make_splrep(x, x**3, k=2.5, s=0.1)

        with assert_raises(ValueError):
            # s < 0
            make_splrep(x, x**3, s=-1)

        with assert_raises(ValueError):
            # nest < 2*k + 2
            make_splrep(x, x**3, k=3, nest=2, s=0.1)

        with assert_raises(ValueError):
            # nest not None and s==0
            make_splrep(x, x**3, s=0, nest=11)

        with assert_raises(ValueError):
            # len(x) != len(y)
            make_splrep(np.arange(8), np.arange(9), s=0.1)

    def _get_xykt(self):
        x = np.linspace(0, 5, 11)
        y  = np.sin(x*3.14 / 5)**2
        k = 3
        s = 1.7e-4
        tt = np.array([0]*(k+1) + [2.5, 4.0] + [5]*(k+1))

        return x, y, k, s, tt

    def test_fitpack_F(self):
        # test an implementation detail: banded/packed linalg vs full matrices
        from scipy.interpolate._fitpack_repro import F

        x, y, k, s, t = self._get_xykt()
        f = F(x, y[:, None], t, k, s)    # F expects y to be 2D
        f_d = F_dense(x, y, t, k, s)
        for p in [1, 10, 100]:
            xp_assert_close(f(p), f_d(p), atol=1e-15)

    def test_fitpack_F_with_weights(self):
        # repeat test_fitpack_F, with weights
        from scipy.interpolate._fitpack_repro import F

        x, y, k, s, t = self._get_xykt()
        w = np.arange(x.shape[0], dtype=float)
        fw = F(x, y[:, None], t, k, s, w=w)       # F expects y to be 2D
        fw_d = F_dense(x, y, t, k, s, w=w)

        f_d = F_dense(x, y, t, k, s)   # no weights

        for p in [1, 10, 100]:
            xp_assert_close(fw(p), fw_d(p), atol=1e-15)
            assert not np.allclose(f_d(p), fw_d(p), atol=1e-15)

    def test_disc_matrix(self):
        # test an implementation detail: discontinuity matrix
        # (jumps of k-th derivative at knots)
        import scipy.interpolate._fitpack_repro as _fr

        rng = np.random.default_rng(12345)
        t = np.r_[0, 0, 0, 0, np.sort(rng.uniform(size=7))*5, 5, 5, 5, 5]

        n, k = len(t), 3
        D = PackedMatrix(*_fr.disc(t, k)).todense()
        D_dense = disc_naive(t, k)
        assert D.shape[0] == n - 2*k - 2   # number of internal knots
        xp_assert_close(D, D_dense, atol=1e-15)

    def test_simple_vs_splrep(self):
        x, y, k, s, tt = self._get_xykt()
        tt = np.array([0]*(k+1) + [2.5, 4.0] + [5]*(k+1))

        t,c,k = splrep(x, y, k=k, s=s)
        assert all(t == tt)

        spl = make_splrep(x, y, k=k, s=s)
        xp_assert_close(c[:spl.c.size], spl.c, atol=1e-15)

    def test_with_knots(self):
        x, y, k, s, _ = self._get_xykt()

        t = list(generate_knots(x, y, k=k, s=s))[-1]

        spl_auto = make_splrep(x, y, k=k, s=s)
        spl_t = make_splrep(x, y, t=t, k=k, s=s)

        xp_assert_close(spl_auto.t, spl_t.t, atol=1e-15)
        xp_assert_close(spl_auto.c, spl_t.c, atol=1e-15)
        assert spl_auto.k == spl_t.k

    def test_no_internal_knots(self):
        # should not fail if there are no internal knots
        n = 10
        x = np.arange(n)
        y = x**3
        k = 3
        spl = make_splrep(x, y, k=k, s=1)
        assert spl.t.shape[0] == 2*(k+1)

    def test_default_s(self):
        n = 10
        x = np.arange(n)
        y = x**3
        spl = make_splrep(x, y, k=3)
        spl_i = make_interp_spline(x, y, k=3)

        xp_assert_close(spl.c, spl_i.c, atol=1e-15)

    @pytest.mark.thread_unsafe
    def test_s_too_small(self):
        # both splrep and make_splrep warn that "s too small": ier=2
        n = 14
        x = np.arange(n)
        y = x**3

        with suppress_warnings() as sup:
            r = sup.record(RuntimeWarning)
            tck = splrep(x, y, k=3, s=1e-50)
            spl = make_splrep(x, y, k=3, s=1e-50)
            assert len(r) == 2
            xp_assert_equal(spl.t, tck[0])
            xp_assert_close(np.r_[spl.c, [0]*(spl.k+1)],
                            tck[1], atol=5e-13)

    def test_issue_22704(self):
        # Reference - https://github.com/scipy/scipy/issues/22704
        x = np.asarray([20.00, 153.81, 175.57, 202.47, 237.11,
             253.61, 258.56, 273.40, 284.54, 293.61,
             298.56, 301.86, 305.57, 307.22, 308.45,
             310.10, 310.10, 310.50], dtype=np.float64)
        y = np.asarray([53.00, 49.50, 48.60, 46.80, 43.20,
             40.32, 39.60, 36.00, 32.40, 28.80,
             25.20, 21.60, 18.00, 14.40, 10.80,
             7.20, 3.60, 0.0], dtype=np.float64)
        w = np.asarray([1.38723] * y.shape[0], dtype=np.float64)
        with assert_raises(ValueError):
            make_splrep(x, y, w=w, k=2, s=12)

    def test_shape(self):
        # make sure coefficients have the right shape (not extra dims)
        n, k = 10, 3
        x = np.arange(n)
        y = x**3

        spl = make_splrep(x, y, k=k)
        spl_1 = make_splrep(x, y, k=k, s=1e-5)

        assert spl.c.ndim == 1
        assert spl_1.c.ndim == 1

        # force the general code path, not shortcuts
        spl_2 = make_splrep(x, y + 1/(1+y), k=k, s=1e-5)
        assert spl_2.c.ndim == 1

    def test_s0_vs_not(self):
        # check that the shapes are consistent
        n, k = 10, 3
        x = np.arange(n)
        y = x**3

        spl_0 = make_splrep(x, y, k=3, s=0)
        spl_1 = make_splrep(x, y, k=3, s=1)

        assert spl_0.c.ndim == 1
        assert spl_1.c.ndim == 1

        assert spl_0.t.shape[0] == n + k + 1
        assert spl_1.t.shape[0] == 2 * (k + 1)


class TestMakeSplprep:
    def _get_xyk(self, m=10, k=3):
        x = np.arange(m) * np.pi / m
        y = [np.sin(x), np.cos(x)]
        return x, y, k

    @pytest.mark.parametrize('s', [0, 0.1, 1e-3, 1e-5])
    def test_simple_vs_splprep(self, s):
        # Check/document the interface vs splPrep
        # The four values of `s` are to probe all code paths and shortcuts
        m, k = 10, 3
        x = np.arange(m) * np.pi / m
        y = [np.sin(x), np.cos(x)]

        # the number of knots depends on `s` (this is by construction)
        num_knots = {0: 14, 0.1: 8, 1e-3: 8 + 1, 1e-5: 8 + 2}

        # construct the splines
        (t, c, k), u_ = splprep(y, s=s)
        spl, u = make_splprep(y, s=s)

        # parameters
        xp_assert_close(u, u_, atol=1e-15)

        # knots
        xp_assert_close(spl.t, t, atol=1e-15)
        assert len(t) == num_knots[s]

        # coefficients: note the transpose
        cc = np.asarray(c).T
        xp_assert_close(spl.c, cc, atol=1e-15)

        # values: note axis=1
        xp_assert_close(spl(u),
                        BSpline(t, c, k, axis=1)(u), atol=1e-15)

    @pytest.mark.parametrize('s', [0, 0.1, 1e-3, 1e-5])
    def test_array_not_list(self, s):
        # the argument of splPrep is either a list of arrays or a 2D array (sigh)
        _, y, _ = self._get_xyk()
        assert isinstance(y, list)
        assert np.shape(y)[0] == 2

        # assert the behavior of FITPACK's splrep
        tck, u = splprep(y, s=s)
        tck_a, u_a = splprep(np.asarray(y), s=s)
        xp_assert_close(u, u_a, atol=s)
        xp_assert_close(tck[0], tck_a[0], atol=1e-15)
        assert len(tck[1]) == len(tck_a[1])
        for c1, c2 in zip(tck[1], tck_a[1]):
            xp_assert_close(c1, c2, atol=1e-15)
        assert tck[2] == tck_a[2]
        assert np.shape(splev(u, tck)) == np.shape(y)

        spl, u = make_splprep(y, s=s)
        xp_assert_close(u, u_a, atol=1e-15)
        xp_assert_close(spl.t, tck_a[0], atol=1e-15)
        xp_assert_close(spl.c.T, tck_a[1], atol=1e-15)
        assert spl.k == tck_a[2]
        assert spl(u).shape == np.shape(y)

        spl, u = make_splprep(np.asarray(y), s=s)
        xp_assert_close(u, u_a, atol=1e-15)
        xp_assert_close(spl.t, tck_a[0], atol=1e-15)
        xp_assert_close(spl.c.T, tck_a[1], atol=1e-15)
        assert spl.k == tck_a[2]
        assert spl(u).shape == np.shape(y)

        with assert_raises(ValueError):
            make_splprep(np.asarray(y).T, s=s)

    def test_default_s_is_zero(self):
        x, y, k = self._get_xyk(m=10)

        spl, u = make_splprep(y)
        xp_assert_close(spl(u), y, atol=1e-15)

    def test_s_zero_vs_near_zero(self):
        # s=0 and s \approx 0 are consistent
        x, y, k = self._get_xyk(m=10)

        spl_i, u_i = make_splprep(y, s=0)
        spl_n, u_n = make_splprep(y, s=1e-15)

        xp_assert_close(u_i, u_n, atol=1e-15)
        xp_assert_close(spl_i(u_i), y, atol=1e-15)
        xp_assert_close(spl_n(u_n), y, atol=1e-7)
        assert spl_i.axis == spl_n.axis
        assert spl_i.c.shape == spl_n.c.shape

    def test_1D(self):
        x = np.arange(8, dtype=float)
        with assert_raises(ValueError):
            splprep(x)

        with assert_raises(ValueError):
            make_splprep(x, s=0)

        with assert_raises(ValueError):
            make_splprep(x, s=0.1)

        tck, u_ = splprep([x], s=1e-5)
        spl, u = make_splprep([x], s=1e-5)

        assert spl(u).shape == (1, 8)
        xp_assert_close(spl(u), [x], atol=1e-15)


class BatchSpline:
    # BSpline-line class with reference batch behavior
    def __init__(self, x, y, axis, *, spline, **kwargs):
        y = np.moveaxis(y, axis, -1)
        self._batch_shape = y.shape[:-1]
        self._splines = [spline(x, yi, **kwargs) for yi in y.reshape(-1, y.shape[-1])]
        self._axis = axis

    def __call__(self, x):
        y = [spline(x) for spline in self._splines]
        y = np.reshape(y, self._batch_shape + x.shape)
        return np.moveaxis(y, -1, self._axis) if x.shape else y

    def integrate(self, a, b, extrapolate=None):
        y = [spline.integrate(a, b, extrapolate) for spline in self._splines]
        return np.reshape(y, self._batch_shape)

    def derivative(self, nu):
        res = copy.deepcopy(self)
        res._splines = [spline.derivative(nu) for spline in res._splines]
        return res

    def antiderivative(self, nu):
        res = copy.deepcopy(self)
        res._splines = [spline.antiderivative(nu) for spline in res._splines]
        return res


class TestBatch:
    @pytest.mark.parametrize('make_spline, kwargs',
        [(make_interp_spline, {}),
         (make_smoothing_spline, {}),
         (make_smoothing_spline, {'lam': 1.0}),
         (make_lsq_spline, {'method': "norm-eq"}),
         (make_lsq_spline, {'method': "qr"}),
         ])
    @pytest.mark.parametrize('eval_shape', [(), (1,), (3,)])
    @pytest.mark.parametrize('axis', [-1, 0, 1])
    def test_batch(self, make_spline, kwargs, axis, eval_shape):
        rng = np.random.default_rng(4329872134985134)
        n = 10
        shape = (2, 3, 4, n)
        domain = (0, 10)

        x = np.linspace(*domain, n)
        y = np.moveaxis(rng.random(shape), -1, axis)

        if make_spline == make_lsq_spline:
            k = 3  # spline degree, if needed
            t = (x[0],) * (k + 1) + (x[-1],) * (k + 1)  # valid knots, if needed
            kwargs = kwargs | dict(t=t, k=k)

        res = make_spline(x, y, axis=axis, **kwargs)
        ref = BatchSpline(x, y, axis=axis, spline=make_spline, **kwargs)

        x = rng.uniform(*domain, size=eval_shape)
        np.testing.assert_allclose(res(x), ref(x))

        res, ref = res.antiderivative(1), ref.antiderivative(1)
        np.testing.assert_allclose(res(x), ref(x))

        res, ref = res.derivative(2), ref.derivative(2)
        np.testing.assert_allclose(res(x), ref(x))

        np.testing.assert_allclose(res.integrate(*domain), ref.integrate(*domain))
