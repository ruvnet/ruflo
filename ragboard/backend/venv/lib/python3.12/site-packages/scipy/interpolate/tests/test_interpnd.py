import os
import sys

import numpy as np
from numpy.testing import suppress_warnings
from pytest import raises as assert_raises
import pytest
from scipy._lib._array_api import xp_assert_close, assert_almost_equal

from scipy._lib._testutils import check_free_memory
import scipy.interpolate._interpnd as interpnd
import scipy.spatial._qhull as qhull

import pickle
import threading

_IS_32BIT = (sys.maxsize < 2**32)


def data_file(basename):
    return os.path.join(os.path.abspath(os.path.dirname(__file__)),
                        'data', basename)


class TestLinearNDInterpolation:
    def test_smoketest(self):
        # Test at single points
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)

        yi = interpnd.LinearNDInterpolator(x, y)(x)
        assert_almost_equal(y, yi)

    def test_smoketest_alternate(self):
        # Test at single points, alternate calling convention
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)

        yi = interpnd.LinearNDInterpolator((x[:,0], x[:,1]), y)(x[:,0], x[:,1])
        assert_almost_equal(y, yi)

    def test_complex_smoketest(self):
        # Test at single points
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 3j*y

        yi = interpnd.LinearNDInterpolator(x, y)(x)
        assert_almost_equal(y, yi)

    def test_tri_input(self):
        # Test at single points
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 3j*y

        tri = qhull.Delaunay(x)
        interpolator = interpnd.LinearNDInterpolator(tri, y)
        yi = interpolator(x)
        assert_almost_equal(y, yi)
        assert interpolator.tri is tri

    def test_square(self):
        # Test barycentric interpolation on a square against a manual
        # implementation

        points = np.array([(0,0), (0,1), (1,1), (1,0)], dtype=np.float64)
        values = np.array([1., 2., -3., 5.], dtype=np.float64)

        # NB: assume triangles (0, 1, 3) and (1, 2, 3)
        #
        #  1----2
        #  | \  |
        #  |  \ |
        #  0----3

        def ip(x, y):
            t1 = (x + y <= 1)
            t2 = ~t1

            x1 = x[t1]
            y1 = y[t1]

            x2 = x[t2]
            y2 = y[t2]

            z = 0*x

            z[t1] = (values[0]*(1 - x1 - y1)
                     + values[1]*y1
                     + values[3]*x1)

            z[t2] = (values[2]*(x2 + y2 - 1)
                     + values[1]*(1 - x2)
                     + values[3]*(1 - y2))
            return z

        xx, yy = np.broadcast_arrays(np.linspace(0, 1, 14)[:,None],
                                     np.linspace(0, 1, 14)[None,:])
        xx = xx.ravel()
        yy = yy.ravel()

        xi = np.array([xx, yy]).T.copy()
        zi = interpnd.LinearNDInterpolator(points, values)(xi)

        assert_almost_equal(zi, ip(xx, yy))

    def test_smoketest_rescale(self):
        # Test at single points
        x = np.array([(0, 0), (-5, -5), (-5, 5), (5, 5), (2.5, 3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)

        yi = interpnd.LinearNDInterpolator(x, y, rescale=True)(x)
        assert_almost_equal(y, yi)

    def test_square_rescale(self):
        # Test barycentric interpolation on a rectangle with rescaling
        # agaings the same implementation without rescaling

        points = np.array([(0,0), (0,100), (10,100), (10,0)], dtype=np.float64)
        values = np.array([1., 2., -3., 5.], dtype=np.float64)

        xx, yy = np.broadcast_arrays(np.linspace(0, 10, 14)[:,None],
                                     np.linspace(0, 100, 14)[None,:])
        xx = xx.ravel()
        yy = yy.ravel()
        xi = np.array([xx, yy]).T.copy()
        zi = interpnd.LinearNDInterpolator(points, values)(xi)
        zi_rescaled = interpnd.LinearNDInterpolator(points, values,
                rescale=True)(xi)

        assert_almost_equal(zi, zi_rescaled)

    def test_tripoints_input_rescale(self):
        # Test at single points
        x = np.array([(0,0), (-5,-5), (-5,5), (5, 5), (2.5, 3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 3j*y

        tri = qhull.Delaunay(x)
        yi = interpnd.LinearNDInterpolator(tri.points, y)(x)
        yi_rescale = interpnd.LinearNDInterpolator(tri.points, y,
                rescale=True)(x)
        assert_almost_equal(yi, yi_rescale)

    def test_tri_input_rescale(self):
        # Test at single points
        x = np.array([(0,0), (-5,-5), (-5,5), (5, 5), (2.5, 3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 3j*y

        tri = qhull.Delaunay(x)
        match = ("Rescaling is not supported when passing a "
                 "Delaunay triangulation as ``points``.")
        with pytest.raises(ValueError, match=match):
            interpnd.LinearNDInterpolator(tri, y, rescale=True)(x)

    def test_pickle(self):
        # Test at single points
        np.random.seed(1234)
        x = np.random.rand(30, 2)
        y = np.random.rand(30) + 1j*np.random.rand(30)

        ip = interpnd.LinearNDInterpolator(x, y)
        ip2 = pickle.loads(pickle.dumps(ip))

        assert_almost_equal(ip(0.5, 0.5), ip2(0.5, 0.5))

    @pytest.mark.slow
    @pytest.mark.thread_unsafe
    @pytest.mark.skipif(_IS_32BIT, reason='it fails on 32-bit')
    def test_threading(self):
        # This test was taken from issue 8856
        # https://github.com/scipy/scipy/issues/8856
        check_free_memory(10000)

        r_ticks = np.arange(0, 4200, 10)
        phi_ticks = np.arange(0, 4200, 10)
        r_grid, phi_grid = np.meshgrid(r_ticks, phi_ticks)

        def do_interp(interpolator, slice_rows, slice_cols):
            grid_x, grid_y = np.mgrid[slice_rows, slice_cols]
            res = interpolator((grid_x, grid_y))
            return res

        points = np.vstack((r_grid.ravel(), phi_grid.ravel())).T
        values = (r_grid * phi_grid).ravel()
        interpolator = interpnd.LinearNDInterpolator(points, values)

        worker_thread_1 = threading.Thread(
            target=do_interp,
            args=(interpolator, slice(0, 2100), slice(0, 2100)))
        worker_thread_2 = threading.Thread(
            target=do_interp,
            args=(interpolator, slice(2100, 4200), slice(0, 2100)))
        worker_thread_3 = threading.Thread(
            target=do_interp,
            args=(interpolator, slice(0, 2100), slice(2100, 4200)))
        worker_thread_4 = threading.Thread(
            target=do_interp,
            args=(interpolator, slice(2100, 4200), slice(2100, 4200)))

        worker_thread_1.start()
        worker_thread_2.start()
        worker_thread_3.start()
        worker_thread_4.start()

        worker_thread_1.join()
        worker_thread_2.join()
        worker_thread_3.join()
        worker_thread_4.join()


class TestEstimateGradients2DGlobal:
    def test_smoketest(self):
        x = np.array([(0, 0), (0, 2),
                      (1, 0), (1, 2), (0.25, 0.75), (0.6, 0.8)], dtype=float)
        tri = qhull.Delaunay(x)

        # Should be exact for linear functions, independent of triangulation

        funcs = [
            (lambda x, y: 0*x + 1, (0, 0)),
            (lambda x, y: 0 + x, (1, 0)),
            (lambda x, y: -2 + y, (0, 1)),
            (lambda x, y: 3 + 3*x + 14.15*y, (3, 14.15))
        ]

        for j, (func, grad) in enumerate(funcs):
            z = func(x[:,0], x[:,1])
            dz = interpnd.estimate_gradients_2d_global(tri, z, tol=1e-6)

            assert dz.shape == (6, 2)
            xp_assert_close(
                dz, np.array(grad)[None, :] + 0*dz, rtol=1e-5, atol=1e-5, 
                err_msg=f"item {j}"
            )

    def test_regression_2359(self):
        # Check regression --- for certain point sets, gradient
        # estimation could end up in an infinite loop
        points = np.load(data_file('estimate_gradients_hang.npy'))
        values = np.random.rand(points.shape[0])
        tri = qhull.Delaunay(points)

        # This should not hang
        with suppress_warnings() as sup:
            sup.filter(interpnd.GradientEstimationWarning,
                       "Gradient estimation did not converge")
            interpnd.estimate_gradients_2d_global(tri, values, maxiter=1)


class TestCloughTocher2DInterpolator:

    def _check_accuracy(self, func, x=None, tol=1e-6, alternate=False,
                        rescale=False, **kw):
        rng = np.random.RandomState(1234)
        # np.random.seed(1234)
        if x is None:
            x = np.array([(0, 0), (0, 1),
                          (1, 0), (1, 1), (0.25, 0.75), (0.6, 0.8),
                          (0.5, 0.2)],
                         dtype=float)

        if not alternate:
            ip = interpnd.CloughTocher2DInterpolator(x, func(x[:,0], x[:,1]),
                                                     tol=1e-6, rescale=rescale)
        else:
            ip = interpnd.CloughTocher2DInterpolator((x[:,0], x[:,1]),
                                                     func(x[:,0], x[:,1]),
                                                     tol=1e-6, rescale=rescale)

        p = rng.rand(50, 2)

        if not alternate:
            a = ip(p)
        else:
            a = ip(p[:,0], p[:,1])
        b = func(p[:,0], p[:,1])

        try:
            xp_assert_close(a, b, **kw)
        except AssertionError:
            print("_check_accuracy: abs(a-b):", abs(a - b))
            print("ip.grad:", ip.grad)
            raise

    def test_linear_smoketest(self):
        # Should be exact for linear functions, independent of triangulation
        funcs = [
            lambda x, y: 0*x + 1,
            lambda x, y: 0 + x,
            lambda x, y: -2 + y,
            lambda x, y: 3 + 3*x + 14.15*y,
        ]

        for j, func in enumerate(funcs):
            self._check_accuracy(
                func, tol=1e-13, atol=1e-7, rtol=1e-7, err_msg=f"Function {j}"
            )
            self._check_accuracy(
                func, tol=1e-13, atol=1e-7, rtol=1e-7, alternate=True, 
                err_msg=f"Function (alternate) {j}"
            )
            # check rescaling
            self._check_accuracy(
                func, tol=1e-13, atol=1e-7, rtol=1e-7, 
                err_msg=f"Function (rescaled) {j}", rescale=True
            )
            self._check_accuracy(
                func, tol=1e-13, atol=1e-7, rtol=1e-7, alternate=True, rescale=True, 
                err_msg=f"Function (alternate, rescaled) {j}"
            )

    def test_quadratic_smoketest(self):
        # Should be reasonably accurate for quadratic functions
        funcs = [
            lambda x, y: x**2,
            lambda x, y: y**2,
            lambda x, y: x**2 - y**2,
            lambda x, y: x*y,
        ]

        for j, func in enumerate(funcs):
            self._check_accuracy(
                func, tol=1e-9, atol=0.22, rtol=0, err_msg=f"Function {j}"
            )
            self._check_accuracy(
                func, tol=1e-9, atol=0.22, rtol=0, err_msg=f"Function {j}", rescale=True
            )

    def test_tri_input(self):
        # Test at single points
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 3j*y

        tri = qhull.Delaunay(x)
        yi = interpnd.CloughTocher2DInterpolator(tri, y)(x)
        assert_almost_equal(y, yi)

    def test_tri_input_rescale(self):
        # Test at single points
        x = np.array([(0,0), (-5,-5), (-5,5), (5, 5), (2.5, 3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 3j*y

        tri = qhull.Delaunay(x)
        match = ("Rescaling is not supported when passing a "
                 "Delaunay triangulation as ``points``.")
        with pytest.raises(ValueError, match=match):
            interpnd.CloughTocher2DInterpolator(tri, y, rescale=True)(x)

    def test_tripoints_input_rescale(self):
        # Test at single points
        x = np.array([(0,0), (-5,-5), (-5,5), (5, 5), (2.5, 3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 3j*y

        tri = qhull.Delaunay(x)
        yi = interpnd.CloughTocher2DInterpolator(tri.points, y)(x)
        yi_rescale = interpnd.CloughTocher2DInterpolator(tri.points, y, rescale=True)(x)
        assert_almost_equal(yi, yi_rescale)

    @pytest.mark.fail_slow(5)
    def test_dense(self):
        # Should be more accurate for dense meshes
        funcs = [
            lambda x, y: x**2,
            lambda x, y: y**2,
            lambda x, y: x**2 - y**2,
            lambda x, y: x*y,
            lambda x, y: np.cos(2*np.pi*x)*np.sin(2*np.pi*y)
        ]

        rng = np.random.RandomState(4321)  # use a different seed than the check!
        grid = np.r_[np.array([(0,0), (0,1), (1,0), (1,1)], dtype=float),
                     rng.rand(30*30, 2)]

        for j, func in enumerate(funcs):
            self._check_accuracy(
                func, x=grid, tol=1e-9, atol=5e-3, rtol=1e-2, err_msg=f"Function {j}"
            )
            self._check_accuracy(
                func, x=grid, tol=1e-9, atol=5e-3, rtol=1e-2, 
                err_msg=f"Function {j}", rescale=True
            )

    def test_wrong_ndim(self):
        x = np.random.randn(30, 3)
        y = np.random.randn(30)
        assert_raises(ValueError, interpnd.CloughTocher2DInterpolator, x, y)

    def test_pickle(self):
        # Test at single points
        rng = np.random.RandomState(1234)
        x = rng.rand(30, 2)
        y = rng.rand(30) + 1j*rng.rand(30)

        ip = interpnd.CloughTocher2DInterpolator(x, y)
        ip2 = pickle.loads(pickle.dumps(ip))

        assert_almost_equal(ip(0.5, 0.5), ip2(0.5, 0.5))

    def test_boundary_tri_symmetry(self):
        # Interpolation at neighbourless triangles should retain
        # symmetry with mirroring the triangle.

        # Equilateral triangle
        points = np.array([(0, 0), (1, 0), (0.5, np.sqrt(3)/2)])
        values = np.array([1, 0, 0])

        ip = interpnd.CloughTocher2DInterpolator(points, values)

        # Set gradient to zero at vertices
        ip.grad[...] = 0

        # Interpolation should be symmetric vs. bisector
        alpha = 0.3
        p1 = np.array([0.5 * np.cos(alpha), 0.5 * np.sin(alpha)])
        p2 = np.array([0.5 * np.cos(np.pi/3 - alpha), 0.5 * np.sin(np.pi/3 - alpha)])

        v1 = ip(p1)
        v2 = ip(p2)
        xp_assert_close(v1, v2)

        # ... and affine invariant
        rng = np.random.RandomState(1)
        A = rng.randn(2, 2)
        b = rng.randn(2)

        points = A.dot(points.T).T + b[None,:]
        p1 = A.dot(p1) + b
        p2 = A.dot(p2) + b

        ip = interpnd.CloughTocher2DInterpolator(points, values)
        ip.grad[...] = 0

        w1 = ip(p1)
        w2 = ip(p2)
        xp_assert_close(w1, v1)
        xp_assert_close(w2, v2)
