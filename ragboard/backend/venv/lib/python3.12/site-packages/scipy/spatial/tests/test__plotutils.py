import pytest
import numpy as np
from numpy.testing import assert_, assert_array_equal, assert_allclose

try:
    import matplotlib
    matplotlib.rcParams['backend'] = 'Agg'
    import matplotlib.pyplot as plt
    has_matplotlib = True
except Exception:
    has_matplotlib = False

from scipy.spatial import \
     delaunay_plot_2d, voronoi_plot_2d, convex_hull_plot_2d, \
     Delaunay, Voronoi, ConvexHull


@pytest.mark.skipif(not has_matplotlib, reason="Matplotlib not available")
class TestPlotting:
    points = [(0,0), (0,1), (1,0), (1,1)]

    def test_delaunay(self):
        # Smoke test
        fig = plt.figure()
        obj = Delaunay(self.points)
        s_before = obj.simplices.copy()
        r = delaunay_plot_2d(obj, ax=fig.gca())
        assert_array_equal(obj.simplices, s_before)  # shouldn't modify
        assert_(r is fig)
        delaunay_plot_2d(obj, ax=fig.gca())

    def test_voronoi(self):
        # Smoke test
        fig = plt.figure()
        obj = Voronoi(self.points)
        r = voronoi_plot_2d(obj, ax=fig.gca())
        assert_(r is fig)
        voronoi_plot_2d(obj)
        voronoi_plot_2d(obj, show_vertices=False)

    def test_convex_hull(self):
        # Smoke test
        fig = plt.figure()
        tri = ConvexHull(self.points)
        r = convex_hull_plot_2d(tri, ax=fig.gca())
        assert_(r is fig)
        convex_hull_plot_2d(tri)

    def test_gh_19653(self):
        # aspect ratio sensitivity of voronoi_plot_2d
        # infinite Voronoi edges
        points = np.array([[245.059986986012, 10.971011721360075],
                           [320.49044143557785, 10.970258360366753],
                           [239.79023081978914, 13.108487516946218],
                           [263.38325791238833, 12.93241352743668],
                           [219.53334398353175, 13.346107628161008]])
        vor = Voronoi(points)
        fig = voronoi_plot_2d(vor)
        ax = fig.gca()
        infinite_segments = ax.collections[1].get_segments()
        expected_segments = np.array([[[282.77256, -254.76904],
                                       [282.729714, -4544.744698]],
                                      [[282.77256014, -254.76904029],
                                       [430.08561382, 4032.67658742]],
                                      [[229.26733285,  -20.39957514],
                                       [-168.17167404, -4291.92545966]],
                                      [[289.93433364, 5151.40412217],
                                       [330.40553385, 9441.18887532]]])
        assert_allclose(infinite_segments, expected_segments)

    def test_gh_19653_smaller_aspect(self):
        # reasonable behavior for less extreme aspect
        # ratio
        points = np.array([[24.059986986012, 10.971011721360075],
                           [32.49044143557785, 10.970258360366753],
                           [23.79023081978914, 13.108487516946218],
                           [26.38325791238833, 12.93241352743668],
                           [21.53334398353175, 13.346107628161008]])
        vor = Voronoi(points)
        fig = voronoi_plot_2d(vor)
        ax = fig.gca()
        infinite_segments = ax.collections[1].get_segments()
        expected_segments = np.array([[[28.274979, 8.335027],
                                       [28.270463, -42.19763338]],
                                      [[28.27497869, 8.33502697],
                                       [43.73223829, 56.44555501]],
                                      [[22.51805823, 11.8621754],
                                       [-12.09266506, -24.95694485]],
                                      [[29.53092448, 78.46952378],
                                       [33.82572726, 128.81934455]]])
        assert_allclose(infinite_segments, expected_segments)
