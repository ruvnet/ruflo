import numpy as np
from scipy._lib._array_api import (
    xp_assert_equal, xp_assert_close
)
import pytest
from pytest import raises as assert_raises

from scipy.interpolate import (griddata, NearestNDInterpolator,
                               LinearNDInterpolator,
                               CloughTocher2DInterpolator)
from scipy._lib._testutils import _run_concurrent_barrier


parametrize_interpolators = pytest.mark.parametrize(
    "interpolator", [NearestNDInterpolator, LinearNDInterpolator,
                     CloughTocher2DInterpolator]
)
parametrize_methods = pytest.mark.parametrize(
    'method',
    ('nearest', 'linear', 'cubic'),
)
parametrize_rescale = pytest.mark.parametrize(
    'rescale',
    (True, False),
)


class TestGriddata:
    def test_fill_value(self):
        x = [(0,0), (0,1), (1,0)]
        y = [1, 2, 3]

        yi = griddata(x, y, [(1,1), (1,2), (0,0)], fill_value=-1)
        xp_assert_equal(yi, [-1., -1, 1])

        yi = griddata(x, y, [(1,1), (1,2), (0,0)])
        xp_assert_equal(yi, [np.nan, np.nan, 1])

    @parametrize_methods
    @parametrize_rescale
    def test_alternative_call(self, method, rescale):
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = (np.arange(x.shape[0], dtype=np.float64)[:,None]
             + np.array([0,1])[None,:])

        msg = repr((method, rescale))
        yi = griddata((x[:,0], x[:,1]), y, (x[:,0], x[:,1]), method=method,
                      rescale=rescale)
        xp_assert_close(y, yi, atol=1e-14, err_msg=msg)

    @parametrize_methods
    @parametrize_rescale
    def test_multivalue_2d(self, method, rescale):
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = (np.arange(x.shape[0], dtype=np.float64)[:,None]
             + np.array([0,1])[None,:])

        msg = repr((method, rescale))
        yi = griddata(x, y, x, method=method, rescale=rescale)
        xp_assert_close(y, yi, atol=1e-14, err_msg=msg)

    @parametrize_methods
    @parametrize_rescale
    def test_multipoint_2d(self, method, rescale):
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)

        xi = x[:,None,:] + np.array([0,0,0])[None,:,None]

        msg = repr((method, rescale))
        yi = griddata(x, y, xi, method=method, rescale=rescale)

        assert yi.shape == (5, 3), msg
        xp_assert_close(yi, np.tile(y[:,None], (1, 3)),
                        atol=1e-14, err_msg=msg)

    @parametrize_methods
    @parametrize_rescale
    def test_complex_2d(self, method, rescale):
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 2j*y[::-1]

        xi = x[:,None,:] + np.array([0,0,0])[None,:,None]

        msg = repr((method, rescale))
        yi = griddata(x, y, xi, method=method, rescale=rescale)

        assert yi.shape == (5, 3)
        xp_assert_close(yi, np.tile(y[:,None], (1, 3)),
                        atol=1e-14, err_msg=msg)

    @parametrize_methods
    def test_1d(self, method):
        x = np.array([1, 2.5, 3, 4.5, 5, 6])
        y = np.array([1, 2, 0, 3.9, 2, 1])

        xp_assert_close(griddata(x, y, x, method=method), y,
                        err_msg=method, atol=1e-14)
        xp_assert_close(griddata(x.reshape(6, 1), y, x, method=method), y,
                        err_msg=method, atol=1e-14)
        xp_assert_close(griddata((x,), y, (x,), method=method), y,
                        err_msg=method, atol=1e-14)

    def test_1d_borders(self):
        # Test for nearest neighbor case with xi outside
        # the range of the values.
        x = np.array([1, 2.5, 3, 4.5, 5, 6])
        y = np.array([1, 2, 0, 3.9, 2, 1])
        xi = np.array([0.9, 6.5])
        yi_should = np.array([1.0, 1.0])

        method = 'nearest'
        xp_assert_close(griddata(x, y, xi,
                                 method=method), yi_should,
                        err_msg=method,
                        atol=1e-14)
        xp_assert_close(griddata(x.reshape(6, 1), y, xi,
                                 method=method), yi_should,
                        err_msg=method,
                        atol=1e-14)
        xp_assert_close(griddata((x, ), y, (xi, ),
                                 method=method), yi_should,
                        err_msg=method,
                        atol=1e-14)

    @parametrize_methods
    def test_1d_unsorted(self, method):
        x = np.array([2.5, 1, 4.5, 5, 6, 3])
        y = np.array([1, 2, 0, 3.9, 2, 1])

        xp_assert_close(griddata(x, y, x, method=method), y,
                        err_msg=method, atol=1e-10)
        xp_assert_close(griddata(x.reshape(6, 1), y, x, method=method), y,
                        err_msg=method, atol=1e-10)
        xp_assert_close(griddata((x,), y, (x,), method=method), y,
                        err_msg=method, atol=1e-10)

    @parametrize_methods
    def test_square_rescale_manual(self, method):
        points = np.array([(0,0), (0,100), (10,100), (10,0), (1, 5)], dtype=np.float64)
        points_rescaled = np.array([(0,0), (0,1), (1,1), (1,0), (0.1, 0.05)],
                                   dtype=np.float64)
        values = np.array([1., 2., -3., 5., 9.], dtype=np.float64)

        xx, yy = np.broadcast_arrays(np.linspace(0, 10, 14)[:,None],
                                     np.linspace(0, 100, 14)[None,:])
        xx = xx.ravel()
        yy = yy.ravel()
        xi = np.array([xx, yy]).T.copy()

        msg = method
        zi = griddata(points_rescaled, values, xi/np.array([10, 100.]),
                      method=method)
        zi_rescaled = griddata(points, values, xi, method=method,
                               rescale=True)
        xp_assert_close(zi, zi_rescaled, err_msg=msg,
                        atol=1e-12)

    @parametrize_methods
    def test_xi_1d(self, method):
        # Check that 1-D xi is interpreted as a coordinate
        x = np.array([(0,0), (-0.5,-0.5), (-0.5,0.5), (0.5, 0.5), (0.25, 0.3)],
                     dtype=np.float64)
        y = np.arange(x.shape[0], dtype=np.float64)
        y = y - 2j*y[::-1]

        xi = np.array([0.5, 0.5])

        p1 = griddata(x, y, xi, method=method)
        p2 = griddata(x, y, xi[None,:], method=method)
        xp_assert_close(p1, p2, err_msg=method)

        xi1 = np.array([0.5])
        xi3 = np.array([0.5, 0.5, 0.5])
        assert_raises(ValueError, griddata, x, y, xi1,
                      method=method)
        assert_raises(ValueError, griddata, x, y, xi3,
                      method=method)


class TestNearestNDInterpolator:
    def test_nearest_options(self):
        # smoke test that NearestNDInterpolator accept cKDTree options
        npts, nd = 4, 3
        x = np.arange(npts*nd).reshape((npts, nd))
        y = np.arange(npts)
        nndi = NearestNDInterpolator(x, y)

        opts = {'balanced_tree': False, 'compact_nodes': False}
        nndi_o = NearestNDInterpolator(x, y, tree_options=opts)
        xp_assert_close(nndi(x), nndi_o(x), atol=1e-14)

    def test_nearest_list_argument(self):
        nd = np.array([[0, 0, 0, 0, 1, 0, 1],
                       [0, 0, 0, 0, 0, 1, 1],
                       [0, 0, 0, 0, 1, 1, 2]])
        d = nd[:, 3:]

        # z is np.array
        NI = NearestNDInterpolator((d[0], d[1]), d[2])
        xp_assert_equal(NI([0.1, 0.9], [0.1, 0.9]), [0.0, 2.0])

        # z is list
        NI = NearestNDInterpolator((d[0], d[1]), list(d[2]))
        xp_assert_equal(NI([0.1, 0.9], [0.1, 0.9]), [0.0, 2.0])

    def test_nearest_query_options(self):
        nd = np.array([[0, 0.5, 0, 1],
                       [0, 0, 0.5, 1],
                       [0, 1, 1, 2]])
        delta = 0.1
        query_points = [0 + delta, 1 + delta], [0 + delta, 1 + delta]

        # case 1 - query max_dist is smaller than
        # the query points' nearest distance to nd.
        NI = NearestNDInterpolator((nd[0], nd[1]), nd[2])
        distance_upper_bound = np.sqrt(delta ** 2 + delta ** 2) - 1e-7
        xp_assert_equal(NI(query_points, distance_upper_bound=distance_upper_bound),
                           [np.nan, np.nan])

        # case 2 - query p is inf, will return [0, 2]
        distance_upper_bound = np.sqrt(delta ** 2 + delta ** 2) - 1e-7
        p = np.inf
        xp_assert_equal(
            NI(query_points, distance_upper_bound=distance_upper_bound, p=p),
            [0.0, 2.0]
        )

        # case 3 - query max_dist is larger, so should return non np.nan
        distance_upper_bound = np.sqrt(delta ** 2 + delta ** 2) + 1e-7
        xp_assert_equal(
            NI(query_points, distance_upper_bound=distance_upper_bound),
            [0.0, 2.0]
        )

    def test_nearest_query_valid_inputs(self):
        nd = np.array([[0, 1, 0, 1],
                       [0, 0, 1, 1],
                       [0, 1, 1, 2]])
        NI = NearestNDInterpolator((nd[0], nd[1]), nd[2])
        with assert_raises(TypeError):
            NI([0.5, 0.5], query_options="not a dictionary")

    @pytest.mark.thread_unsafe
    def test_concurrency(self):
        npts, nd = 50, 3
        x = np.arange(npts * nd).reshape((npts, nd))
        y = np.arange(npts)
        nndi = NearestNDInterpolator(x, y)

        def worker_fn(_, spl):
            spl(x)

        _run_concurrent_barrier(10, worker_fn, nndi)


class TestNDInterpolators:
    @parametrize_interpolators
    def test_broadcastable_input(self, interpolator):
        # input data
        rng = np.random.RandomState(0)
        x = rng.random(10)
        y = rng.random(10)
        z = np.hypot(x, y)

        # x-y grid for interpolation
        X = np.linspace(min(x), max(x))
        Y = np.linspace(min(y), max(y))
        X, Y = np.meshgrid(X, Y)
        XY = np.vstack((X.ravel(), Y.ravel())).T
        interp = interpolator(list(zip(x, y)), z)
        # single array input
        interp_points0 = interp(XY)
        # tuple input
        interp_points1 = interp((X, Y))
        interp_points2 = interp((X, 0.0))
        # broadcastable input
        interp_points3 = interp(X, Y)
        interp_points4 = interp(X, 0.0)

        assert (interp_points0.size ==
                interp_points1.size ==
                interp_points2.size ==
                interp_points3.size ==
                interp_points4.size)

    @parametrize_interpolators
    def test_read_only(self, interpolator):
        # input data
        rng = np.random.RandomState(0)
        xy = rng.random((10, 2))
        x, y = xy[:, 0], xy[:, 1]
        z = np.hypot(x, y)

        # interpolation points
        XY = rng.random((50, 2))

        xy.setflags(write=False)
        z.setflags(write=False)
        XY.setflags(write=False)

        interp = interpolator(xy, z)
        interp(XY)
