#
# Author: Damian Eads
# Date: April 17, 2008
#
# Copyright (C) 2008 Damian Eads
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions
# are met:
#
# 1. Redistributions of source code must retain the above copyright
#    notice, this list of conditions and the following disclaimer.
#
# 2. Redistributions in binary form must reproduce the above
#    copyright notice, this list of conditions and the following
#    disclaimer in the documentation and/or other materials provided
#    with the distribution.
#
# 3. The name of the author may not be used to endorse or promote
#    products derived from this software without specific prior
#    written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS
# OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
# WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
# DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
# DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
# GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
# INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
# WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
# NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
# SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
import numpy as np
from numpy.testing import assert_allclose, assert_equal, assert_array_equal, assert_
import pytest
from pytest import raises as assert_raises

from scipy.cluster.hierarchy import (
    ClusterWarning, linkage, from_mlab_linkage, to_mlab_linkage,
    num_obs_linkage, inconsistent, cophenet, fclusterdata, fcluster,
    is_isomorphic, single, ward, leaders,
    correspond, is_monotonic, maxdists, maxinconsts, maxRstat,
    is_valid_linkage, is_valid_im, to_tree, leaves_list, dendrogram,
    set_link_color_palette, cut_tree, optimal_leaf_ordering,
    _order_cluster_tree, _hierarchy, _EUCLIDEAN_METHODS, _LINKAGE_METHODS)
from scipy.cluster._hierarchy import Heap
from scipy.spatial.distance import pdist
from scipy._lib._array_api import (eager_warns, make_xp_test_case, 
                                   xp_assert_close, xp_assert_equal)
import scipy._lib.array_api_extra as xpx

from threading import Lock

from . import hierarchy_test_data

class eager:
    # Bypass xpx.testing.lazy_xp_function when calling
    # these functions from this namespace
    is_valid_im = is_valid_im
    is_valid_linkage = is_valid_linkage


# Matplotlib is not a scipy dependency but is optionally used in dendrogram, so
# check if it's available
try:
    import matplotlib
    # and set the backend to be Agg (no gui)
    matplotlib.use('Agg')
    # before importing pyplot
    import matplotlib.pyplot as plt
    have_matplotlib = True
except Exception:
    have_matplotlib = False

skip_xp_backends = pytest.mark.skip_xp_backends


@make_xp_test_case(linkage)
class TestLinkage:

    @skip_xp_backends("jax.numpy", reason="Can't raise inside jax.pure_callback")
    def test_linkage_non_finite_elements_in_distance_matrix(self, xp):
        # Tests linkage(Y) where Y contains a non-finite element (e.g. NaN or Inf).
        # Exception expected.
        y = xp.asarray([xp.nan] + [0.0]*5)
        assert_raises(ValueError, linkage, y)

    def test_linkage_empty_distance_matrix(self, xp):
        # Tests linkage(Y) where Y is a 0x4 linkage matrix. Exception expected.
        y = xp.zeros((0,))
        assert_raises(ValueError, linkage, y)

    def test_linkage_tdist(self, xp):
        for method in ['single', 'complete', 'average', 'weighted']:
            self.check_linkage_tdist(method, xp)

    def check_linkage_tdist(self, method, xp):
        # Tests linkage(Y, method) on the tdist data set.
        Z = linkage(xp.asarray(hierarchy_test_data.ytdist), method)
        expectedZ = getattr(hierarchy_test_data, 'linkage_ytdist_' + method)
        xp_assert_close(Z, xp.asarray(expectedZ), atol=1e-10)

    def test_linkage_X(self, xp):
        for method in ['centroid', 'median', 'ward']:
            self.check_linkage_q(method, xp)

    def check_linkage_q(self, method, xp):
        # Tests linkage(Y, method) on the Q data set.
        Z = linkage(xp.asarray(hierarchy_test_data.X), method)
        expectedZ = getattr(hierarchy_test_data, 'linkage_X_' + method)
        xp_assert_close(Z, xp.asarray(expectedZ), atol=1e-06)

        X = xp.asarray(hierarchy_test_data.X)
        y = pdist(X, metric="euclidean")
        Z = linkage(y, method)
        xp_assert_close(Z, xp.asarray(expectedZ), atol=1e-06)

    def test_compare_with_trivial(self, xp):
        rng = np.random.RandomState(0)
        n = 20
        X = rng.rand(n, 2)
        d = pdist(X)

        for method, code in _LINKAGE_METHODS.items():
            Z_trivial = _hierarchy.linkage(d, n, code)
            Z = linkage(xp.asarray(d), method)
            xp_assert_close(Z, xp.asarray(Z_trivial), rtol=1e-14, atol=1e-15)

    def test_optimal_leaf_ordering(self, xp):
        Z = linkage(xp.asarray(hierarchy_test_data.ytdist), optimal_ordering=True)
        expectedZ = getattr(hierarchy_test_data, 'linkage_ytdist_single_olo')
        xp_assert_close(Z, xp.asarray(expectedZ), atol=1e-10)

    @pytest.mark.parametrize("method,expect", [
        ('single',   [[0, 1, 1.41421356, 2],
                      [2, 3, 1.41421356, 3]]),
        ('complete', [[0, 1, 1.41421356, 2],
                      [2, 3, 2.82842712, 3]]),
        ('average',  [[0, 1, 1.41421356, 2],
                      [2, 3, 2.12132034, 3]]),
        ('weighted', [[0, 1, 1.41421356, 2],
                      [2, 3, 2.12132034, 3]]),
        ('centroid', [[0, 1, 1.41421356, 2],
                      [2, 3, 2.12132034, 3]]),
        ('median',   [[0, 1, 1.41421356, 2],
                      [2, 3, 2.12132034, 3]]),
        ('ward',     [[0, 1, 1.41421356, 2],
                      [2, 3, 2.44948974, 3]]),
    ])
    def test_linkage_ties(self, method, expect, xp):
        X = xp.asarray([[-1, -1], [0, 0], [1, 1]])
        Z = linkage(X, method=method)
        expect = xp.asarray(expect, dtype=xp.float64)
        xp_assert_close(Z, expect, atol=1e-06)

    def test_unsupported_uncondensed_distance_matrix_linkage_warning(self, xp):
        X = xp.asarray([[0, 1], [1, 0]])
        with eager_warns(X, ClusterWarning):
            linkage(X)

    @pytest.mark.parametrize("method", _EUCLIDEAN_METHODS)
    def test_euclidean_linkage_value_error(self, method, xp):
        X = xp.asarray([[1, 1], [1, 1]])
        with pytest.raises(ValueError):
            linkage(X, method=method, metric='cityblock')

    def test_2x2_linkage(self, xp):
        Z1 = linkage(xp.asarray([1]), method='single', metric='euclidean')
        Z2 = linkage(xp.asarray([[0, 1], [0, 0]]), method='single', metric='euclidean')
        xp_assert_close(Z1, Z2, rtol=1e-15)

    @skip_xp_backends("jax.numpy", reason="Can't raise inside jax.pure_callback")
    def test_centroid_neg_distance(self, xp):
        # gh-21011
        values = xp.asarray([0, 0, -1])
        with pytest.raises(ValueError):
            # This is just checking that this doesn't crash
            linkage(values, method='centroid')


@make_xp_test_case(inconsistent)
class TestInconsistent:

    def test_inconsistent_tdist(self, xp):
        for depth in hierarchy_test_data.inconsistent_ytdist:
            self.check_inconsistent_tdist(depth, xp)

    def check_inconsistent_tdist(self, depth, xp):
        Z = xp.asarray(hierarchy_test_data.linkage_ytdist_single)
        xp_assert_close(inconsistent(Z, depth),
                        xp.asarray(hierarchy_test_data.inconsistent_ytdist[depth]))


@make_xp_test_case(cophenet)
class TestCopheneticDistance:

    def test_linkage_cophenet_tdist_Z(self, xp):
        # Tests cophenet(Z) on tdist data set.
        expectedM = xp.asarray([268, 295, 255, 255, 295, 295, 268, 268, 295, 295,
                                295, 138, 219, 295, 295])
        Z = xp.asarray(hierarchy_test_data.linkage_ytdist_single)
        M = cophenet(Z)
        xp_assert_close(M, xp.asarray(expectedM, dtype=xp.float64), atol=1e-10)

    def test_linkage_cophenet_tdist_Z_Y(self, xp):
        # Tests cophenet(Z, Y) on tdist data set.
        Z = xp.asarray(hierarchy_test_data.linkage_ytdist_single)
        (c, M) = cophenet(Z, xp.asarray(hierarchy_test_data.ytdist))
        expectedM = xp.asarray([268, 295, 255, 255, 295, 295, 268, 268, 295, 295,
                                295, 138, 219, 295, 295], dtype=xp.float64)
        expectedc = xp.asarray(0.639931296433393415057366837573, dtype=xp.float64)[()]
        xp_assert_close(c, expectedc, atol=1e-10)
        xp_assert_close(M, expectedM, atol=1e-10)

    @skip_xp_backends("jax.numpy", reason="Can't raise inside jax.pure_callback")
    def test_gh_22183(self, xp):
        # check for lack of segfault
        # (out of bounds memory access)
        # and correct interception of
        # invalid linkage matrix
        arr=[[0.0, 1.0, 1.0, 2.0],
             [2.0, 12.0, 1.0, 3.0],
             [3.0, 4.0, 1.0, 2.0],
             [5.0, 14.0, 1.0, 3.0],
             [6.0, 7.0, 1.0, 2.0],
             [8.0, 16.0, 1.0, 3.0],
             [9.0, 10.0, 1.0, 2.0],
             [11.0, 18.0, 1.0, 3.0],
             [13.0, 15.0, 2.0, 6.0],
             [17.0, 20.0, 2.0, 32.0],
             [19.0, 21.0, 2.0, 12.0]]
        with pytest.raises(ValueError, match="excessive observations"):
            cophenet(xp.asarray(arr))


@make_xp_test_case(from_mlab_linkage, to_mlab_linkage)
class TestMLabLinkageConversion:

    def test_mlab_linkage_conversion_empty(self, xp):
        # Tests from/to_mlab_linkage on empty linkage array.
        X = xp.asarray([], dtype=xp.float64)
        xp_assert_equal(from_mlab_linkage(X), X)
        xp_assert_equal(to_mlab_linkage(X), X)

    def test_mlab_linkage_conversion_single_row(self, xp):
        # Tests from/to_mlab_linkage on linkage array with single row.
        Z = xp.asarray([[0., 1., 3., 2.]])
        Zm = xp.asarray([[1, 2, 3]])
        xp_assert_close(from_mlab_linkage(Zm), xp.asarray(Z, dtype=xp.float64),
                        rtol=1e-15)
        xp_assert_close(to_mlab_linkage(Z), xp.asarray(Zm, dtype=xp.float64),
                        rtol=1e-15)

    def test_mlab_linkage_conversion_multiple_rows(self, xp):
        # Tests from/to_mlab_linkage on linkage array with multiple rows.
        Zm = xp.asarray([[3, 6, 138], [4, 5, 219],
                         [1, 8, 255], [2, 9, 268], [7, 10, 295]])
        Z = xp.asarray([[2., 5., 138., 2.],
                        [3., 4., 219., 2.],
                        [0., 7., 255., 3.],
                        [1., 8., 268., 4.],
                        [6., 9., 295., 6.]],
                       dtype=xp.float64)
        xp_assert_close(from_mlab_linkage(Zm), Z, rtol=1e-15)
        xp_assert_close(to_mlab_linkage(Z), xp.asarray(Zm, dtype=xp.float64),
                        rtol=1e-15)


@make_xp_test_case(fclusterdata)
class TestFclusterData:

    @make_xp_test_case(is_isomorphic)
    @pytest.mark.parametrize("criterion,t",
        [("inconsistent", t) for t in hierarchy_test_data.fcluster_inconsistent]
        + [("distance", t) for t in hierarchy_test_data.fcluster_distance]
        + [("maxclust", t) for t in hierarchy_test_data.fcluster_maxclust]
    )
    def test_fclusterdata(self, t, criterion, xp):
        # Tests fclusterdata(X, criterion=criterion, t=t) on a random 3-cluster data set
        expectedT = xp.asarray(getattr(hierarchy_test_data, 'fcluster_' + criterion)[t])
        X = xp.asarray(hierarchy_test_data.Q_X)
        T = fclusterdata(X, criterion=criterion, t=t)
        assert is_isomorphic(T, expectedT)


@make_xp_test_case(fcluster)
class TestFcluster:

    @make_xp_test_case(single, is_isomorphic)
    @pytest.mark.parametrize("criterion,t",
        [("inconsistent", t) for t in hierarchy_test_data.fcluster_inconsistent]
        + [("distance", t) for t in hierarchy_test_data.fcluster_distance]
        + [("maxclust", t) for t in hierarchy_test_data.fcluster_maxclust]
    )
    def test_fcluster(self, t, criterion, xp):
        # Tests fcluster(Z, criterion=criterion, t=t) on a random 3-cluster data set.
        expectedT = xp.asarray(getattr(hierarchy_test_data, 'fcluster_' + criterion)[t])
        Z = single(xp.asarray(hierarchy_test_data.Q_X))
        T = fcluster(Z, criterion=criterion, t=t)
        assert_(is_isomorphic(T, expectedT))

    @make_xp_test_case(single, is_isomorphic, maxdists)
    @pytest.mark.parametrize("t", hierarchy_test_data.fcluster_distance)
    def test_fcluster_monocrit(self, t, xp):
        expectedT = xp.asarray(hierarchy_test_data.fcluster_distance[t])
        Z = single(xp.asarray(hierarchy_test_data.Q_X))
        T = fcluster(Z, t, criterion='monocrit', monocrit=maxdists(Z))
        assert_(is_isomorphic(T, expectedT))

    @make_xp_test_case(single, is_isomorphic, maxdists)
    @pytest.mark.parametrize("t", hierarchy_test_data.fcluster_maxclust)
    def test_fcluster_maxclust_monocrit(self, t, xp):
        expectedT = xp.asarray(hierarchy_test_data.fcluster_maxclust[t])
        Z = single(xp.asarray(hierarchy_test_data.Q_X))
        T = fcluster(Z, t, criterion='maxclust_monocrit', monocrit=maxdists(Z))
        assert_(is_isomorphic(T, expectedT))

    @make_xp_test_case(single)
    def test_fcluster_maxclust_gh_12651(self, xp):
        y = xp.asarray([[1], [4], [5]])
        Z = single(y)
        assert_array_equal(fcluster(Z, t=1, criterion="maxclust"),
                           xp.asarray([1, 1, 1]))
        assert_array_equal(fcluster(Z, t=2, criterion="maxclust"),
                           xp.asarray([2, 1, 1]))
        assert_array_equal(fcluster(Z, t=3, criterion="maxclust"),
                           xp.asarray([1, 2, 3]))
        assert_array_equal(fcluster(Z, t=5, criterion="maxclust"),
                           xp.asarray([1, 2, 3]))


@make_xp_test_case(leaders)
class TestLeaders:

    def test_leaders_single(self, xp):
        # Tests leaders using a flat clustering generated by single linkage.
        X = hierarchy_test_data.Q_X
        Y = pdist(X)
        Z = linkage(Y)
        T = fcluster(Z, criterion='maxclust', t=3)
        Z = xp.asarray(Z)
        T = xp.asarray(T, dtype=xp.int32)
        L = leaders(Z, T)
        expect = xp.asarray([53, 55, 56, 2, 3, 1], dtype=xp.int32)
        xp_assert_close(xp.concat(L), expect, rtol=1e-15)


@make_xp_test_case(is_isomorphic)
class TestIsIsomorphic:

    def test_array_like(self):
        assert is_isomorphic([1, 1, 1], [2, 2, 2])
        assert is_isomorphic([], [])

    def test_is_isomorphic_1(self, xp):
        # Tests is_isomorphic on test case #1 (one flat cluster, different labellings)
        a = xp.asarray([1, 1, 1])
        b = xp.asarray([2, 2, 2])
        assert is_isomorphic(a, b)
        assert is_isomorphic(b, a)

    def test_is_isomorphic_2(self, xp):
        # Tests is_isomorphic on test case #2 (two flat clusters, different labelings)
        a = xp.asarray([1, 7, 1])
        b = xp.asarray([2, 3, 2])
        assert is_isomorphic(a, b)
        assert is_isomorphic(b, a)

    def test_is_isomorphic_3(self, xp):
        # Tests is_isomorphic on test case #3 (no flat clusters)
        a = xp.asarray([])
        b = xp.asarray([])
        assert is_isomorphic(a, b)

    def test_is_isomorphic_4A(self, xp):
        # Tests is_isomorphic on test case #4A
        # (3 flat clusters, different labelings, isomorphic)
        a = xp.asarray([1, 2, 3])
        b = xp.asarray([1, 3, 2])
        assert is_isomorphic(a, b)
        assert is_isomorphic(b, a)

    def test_is_isomorphic_4B(self, xp):
        # Tests is_isomorphic on test case #4B
        # (3 flat clusters, different labelings, nonisomorphic)
        a = xp.asarray([1, 2, 3, 3])
        b = xp.asarray([1, 3, 2, 3])
        assert not is_isomorphic(a, b)
        assert not is_isomorphic(b, a)

    def test_is_isomorphic_4C(self, xp):
        # Tests is_isomorphic on test case #4C
        # (3 flat clusters, different labelings, isomorphic)
        a = xp.asarray([7, 2, 3])
        b = xp.asarray([6, 3, 2])
        assert is_isomorphic(a, b)
        assert is_isomorphic(b, a)

    @pytest.mark.parametrize("nclusters", [2, 3, 5])
    def test_is_isomorphic_5(self, nclusters, xp):
        # Tests is_isomorphic on test case #5 (1000 observations, 2/3/5 random
        # clusters, random permutation of the labeling).
        self.is_isomorphic_randperm(1000, nclusters, xp=xp)

    @pytest.mark.parametrize("nclusters", [2, 3, 5])
    def test_is_isomorphic_6(self, nclusters, xp):
        # Tests is_isomorphic on test case #5A (1000 observations, 2/3/5 random
        # clusters, random permutation of the labeling, slightly
        # nonisomorphic.)
        self.is_isomorphic_randperm(1000, nclusters, True, 5, xp=xp)

    def test_is_isomorphic_7(self, xp):
        # Regression test for gh-6271
        a = xp.asarray([1, 2, 3])
        b = xp.asarray([1, 1, 1])
        assert not is_isomorphic(a, b)

    def is_isomorphic_randperm(self, nobs, nclusters, noniso=False, nerrors=0, *, xp):
        for _ in range(3):
            a = (np.random.rand(nobs) * nclusters).astype(int)
            b = np.zeros(a.size, dtype=int)
            P = np.random.permutation(nclusters)
            for i in range(0, a.shape[0]):
                b[i] = P[a[i]]
            if noniso:
                Q = np.random.permutation(nobs)
                b[Q[0:nerrors]] += 1
                b[Q[0:nerrors]] %= nclusters
            a = xp.asarray(a)
            b = xp.asarray(b)
            assert is_isomorphic(a, b) == (not noniso)
            assert is_isomorphic(b, a) == (not noniso)


@make_xp_test_case(is_valid_linkage)
class TestIsValidLinkage:

    @pytest.mark.parametrize("nrow, ncol, valid", [(2, 5, False), (2, 3, False),
                                                  (1, 4, True), (2, 4, True)])
    def test_is_valid_linkage_various_size(self, nrow, ncol, valid, xp):
        # Tests is_valid_linkage(Z) with linkage matrices of various sizes
        Z = xp.asarray([[0, 1, 3.0, 2, 5],
                        [3, 2, 4.0, 3, 3]], dtype=xp.float64)
        Z = Z[:nrow, :ncol]
        xp_assert_equal(is_valid_linkage(Z), valid, check_namespace=False)
        if not valid:
            assert_raises(ValueError, is_valid_linkage, Z, throw=True)

    def test_is_valid_linkage_int_type(self, xp):
        # Tests is_valid_linkage(Z) with integer type.
        Z = xp.asarray([[0, 1, 3.0, 2],
                        [3, 2, 4.0, 3]], dtype=xp.int64)
        xp_assert_equal(is_valid_linkage(Z), False, check_namespace=False)
        assert_raises(TypeError, is_valid_linkage, Z, throw=True)

    def test_is_valid_linkage_empty(self, xp):
        # Tests is_valid_linkage(Z) with empty linkage.
        Z = xp.zeros((0, 4), dtype=xp.float64)
        xp_assert_equal(is_valid_linkage(Z), False, check_namespace=False)
        assert_raises(ValueError, is_valid_linkage, Z, throw=True)

    def test_is_valid_linkage_4_and_up(self, xp):
        # Tests is_valid_linkage(Z) on linkage on observation sets between
        # sizes 4 and 15 (step size 3).
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = xp.asarray(linkage(y))
            y = xp.asarray(y)
            xp_assert_equal(is_valid_linkage(Z), True, check_namespace=False)

    def test_is_valid_linkage_4_and_up_neg_index_left(self, xp):
        # Tests is_valid_linkage(Z) on linkage on observation sets between
        # sizes 4 and 15 (step size 3) with negative indices (left).
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = xp.asarray(linkage(y))
            y = xp.asarray(y)
            Z = xpx.at(Z)[i//2, 0].set(-2)
            xp_assert_equal(is_valid_linkage(Z), False, check_namespace=False)
            with pytest.raises(ValueError):
                eager.is_valid_linkage(Z, throw=True)

    def test_is_valid_linkage_4_and_up_neg_index_right(self, xp):
        # Tests is_valid_linkage(Z) on linkage on observation sets between
        # sizes 4 and 15 (step size 3) with negative indices (right).
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = xp.asarray(linkage(y))
            y = xp.asarray(y)
            Z = xpx.at(Z)[i//2, 1].set(-2)
            xp_assert_equal(is_valid_linkage(Z), False, check_namespace=False)
            with pytest.raises(ValueError):
                eager.is_valid_linkage(Z, throw=True)

    def test_is_valid_linkage_4_and_up_neg_dist(self, xp):
        # Tests is_valid_linkage(Z) on linkage on observation sets between
        # sizes 4 and 15 (step size 3) with negative distances.
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = xp.asarray(linkage(y))
            y = xp.asarray(y)
            Z = xpx.at(Z)[i//2, 2].set(-0.5)
            xp_assert_equal(is_valid_linkage(Z), False, check_namespace=False)
            with pytest.raises(ValueError):
                eager.is_valid_linkage(Z, throw=True)

    def test_is_valid_linkage_4_and_up_neg_counts(self, xp):
        # Tests is_valid_linkage(Z) on linkage on observation sets between
        # sizes 4 and 15 (step size 3) with negative counts.
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = xp.asarray(linkage(y))
            y = xp.asarray(y)
            Z = xpx.at(Z)[i//2, 3].set(-2)
            xp_assert_equal(is_valid_linkage(Z), False, check_namespace=False)
            with pytest.raises(ValueError):
                eager.is_valid_linkage(Z, throw=True)


@make_xp_test_case(is_valid_im)
class TestIsValidInconsistent:

    def test_is_valid_im_int_type(self, xp):
        # Tests is_valid_im(R) with integer type.
        R = xp.asarray([[0, 1, 3.0, 2],
                        [3, 2, 4.0, 3]], dtype=xp.int64)
        xp_assert_equal(is_valid_im(R), False, check_namespace=False)
        assert_raises(TypeError, is_valid_im, R, throw=True)

    @pytest.mark.parametrize("nrow, ncol, valid", [(2, 5, False), (2, 3, False),
                                                  (1, 4, True), (2, 4, True)])
    def test_is_valid_im_various_size(self, nrow, ncol, valid, xp):
        # Tests is_valid_im(R) with linkage matrices of various sizes
        R = xp.asarray([[0, 1, 3.0, 2, 5],
                        [3, 2, 4.0, 3, 3]], dtype=xp.float64)
        R = R[:nrow, :ncol]
        xp_assert_equal(is_valid_im(R), valid, check_namespace=False)
        if not valid:
            assert_raises(ValueError, is_valid_im, R, throw=True)

    def test_is_valid_im_empty(self, xp):
        # Tests is_valid_im(R) with empty inconsistency matrix.
        R = xp.zeros((0, 4), dtype=xp.float64)
        xp_assert_equal(is_valid_im(R), False, check_namespace=False)
        assert_raises(ValueError, is_valid_im, R, throw=True)

    def test_is_valid_im_4_and_up(self, xp):
        # Tests is_valid_im(R) on im on observation sets between sizes 4 and 15
        # (step size 3).
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = linkage(y)
            R = inconsistent(Z)
            R = xp.asarray(R)
            xp_assert_equal(is_valid_im(R), True, check_namespace=False)

    def test_is_valid_im_4_and_up_neg_index_left(self, xp):
        # Tests is_valid_im(R) on im on observation sets between sizes 4 and 15
        # (step size 3) with negative link height means.
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = linkage(y)
            R = inconsistent(Z)
            R = xpx.at(R)[i//2 , 0].set(-2.0)
            R = xp.asarray(R)
            xp_assert_equal(is_valid_im(R), False, check_namespace=False)
            with pytest.raises(ValueError):
                eager.is_valid_im(R, throw=True)

    def test_is_valid_im_4_and_up_neg_index_right(self, xp):
        # Tests is_valid_im(R) on im on observation sets between sizes 4 and 15
        # (step size 3) with negative link height standard deviations.
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = linkage(y)
            R = inconsistent(Z)
            R = xpx.at(R)[i//2 , 1].set(-2.0)
            R = xp.asarray(R)
            xp_assert_equal(is_valid_im(R), False, check_namespace=False)
            with pytest.raises(ValueError):
                eager.is_valid_im(R, throw=True)

    def test_is_valid_im_4_and_up_neg_dist(self, xp):
        # Tests is_valid_im(R) on im on observation sets between sizes 4 and 15
        # (step size 3) with negative link counts.
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = linkage(y)
            R = inconsistent(Z)
            R = xpx.at(R)[i//2, 2].set(-0.5)
            R = xp.asarray(R)
            xp_assert_equal(is_valid_im(R), False, check_namespace=False)
            with pytest.raises(ValueError):
                eager.is_valid_im(R, throw=True)


class TestNumObsLinkage:

    def test_num_obs_linkage_empty(self, xp):
        # Tests num_obs_linkage(Z) with empty linkage.
        Z = xp.zeros((0, 4), dtype=xp.float64)
        assert_raises(ValueError, num_obs_linkage, Z)

    def test_num_obs_linkage_1x4(self, xp):
        # Tests num_obs_linkage(Z) on linkage over 2 observations.
        Z = xp.asarray([[0, 1, 3.0, 2]], dtype=xp.float64)
        assert num_obs_linkage(Z) == 2

    def test_num_obs_linkage_2x4(self, xp):
        # Tests num_obs_linkage(Z) on linkage over 3 observations.
        Z = xp.asarray([[0, 1, 3.0, 2],
                        [3, 2, 4.0, 3]], dtype=xp.float64)
        assert num_obs_linkage(Z) == 3

    def test_num_obs_linkage_4_and_up(self, xp):
        # Tests num_obs_linkage(Z) on linkage on observation sets between sizes
        # 4 and 15 (step size 3).
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = xp.asarray(linkage(y))
            assert num_obs_linkage(Z) == i

    def test_num_obs_linkage_multi_matrix(self, xp):
        # Tests num_obs_linkage with observation matrices of multiple sizes.
        for n in range(2, 10):
            X = np.random.rand(n, 4)
            Y = pdist(X)
            Z = xp.asarray(linkage(Y))
            assert num_obs_linkage(Z) == n


@make_xp_test_case(leaves_list, to_tree)
class TestLeavesList:

    def test_leaves_list_1x4(self, xp):
        # Tests leaves_list(Z) on a 1x4 linkage.
        Z = xp.asarray([[0, 1, 3.0, 2]], dtype=xp.float64)
        to_tree(Z)
        assert_allclose(leaves_list(Z), [0, 1], rtol=1e-15)

    def test_leaves_list_2x4(self, xp):
        # Tests leaves_list(Z) on a 2x4 linkage.
        Z = xp.asarray([[0, 1, 3.0, 2],
                        [3, 2, 4.0, 3]], dtype=xp.float64)
        to_tree(Z)
        assert_allclose(leaves_list(Z), [0, 1, 2], rtol=1e-15)

    @pytest.mark.parametrize("method", 
        ['single', 'complete', 'average', 'weighted', 'centroid', 'median', 'ward'])
    def test_leaves_list_Q(self, method, xp):
        # Tests leaves_list(Z) on the Q data set
        X = hierarchy_test_data.Q_X
        Z = xp.asarray(linkage(X, method))
        node = to_tree(Z)
        assert_allclose(node.pre_order(), leaves_list(Z), rtol=1e-15)

    def test_Q_subtree_pre_order(self, xp):
        # Tests that pre_order() works when called on sub-trees.
        X = hierarchy_test_data.Q_X
        Z = xp.asarray(linkage(X, 'single'))
        node = to_tree(Z)
        assert_allclose(node.pre_order(),
                        (node.get_left().pre_order() + node.get_right().pre_order()),
                        rtol=1e-15)


@make_xp_test_case(correspond)
class TestCorrespond:

    def test_correspond_empty(self, xp):
        # Tests correspond(Z, y) with empty linkage and condensed distance matrix.
        y = xp.zeros((0,), dtype=xp.float64)
        Z = xp.zeros((0,4), dtype=xp.float64)
        assert_raises(ValueError, correspond, Z, y)

    def test_correspond_2_and_up(self, xp):
        # Tests correspond(Z, y) on linkage and CDMs over observation sets of
        # different sizes.
        for i in range(2, 4):
            y = np.random.rand(i*(i-1)//2)
            Z = xp.asarray(linkage(y))
            y = xp.asarray(y)
            assert_(correspond(Z, y))
        for i in range(4, 15, 3):
            y = np.random.rand(i*(i-1)//2)
            Z = xp.asarray(linkage(y))
            y = xp.asarray(y)
            assert_(correspond(Z, y))

    def test_correspond_4_and_up(self, xp):
        # Tests correspond(Z, y) on linkage and CDMs over observation sets of
        # different sizes. Correspondence should be false.
        for (i, j) in (list(zip(list(range(2, 4)), list(range(3, 5)))) +
                       list(zip(list(range(3, 5)), list(range(2, 4))))):
            y = np.random.rand(i*(i-1)//2)
            y2 = np.random.rand(j*(j-1)//2)
            Z = xp.asarray(linkage(y))
            Z2 = xp.asarray(linkage(y2))
            y = xp.asarray(y)
            y2 = xp.asarray(y2)
            assert not correspond(Z, y2)
            assert not correspond(Z2, y)

    def test_correspond_4_and_up_2(self, xp):
        # Tests correspond(Z, y) on linkage and CDMs over observation sets of
        # different sizes. Correspondence should be false.
        for (i, j) in (list(zip(list(range(2, 7)), list(range(16, 21)))) +
                       list(zip(list(range(2, 7)), list(range(16, 21))))):
            y = np.random.rand(i*(i-1)//2)
            y2 = np.random.rand(j*(j-1)//2)
            Z = xp.asarray(linkage(y))
            Z2 = xp.asarray(linkage(y2))
            y = xp.asarray(y)
            y2 = xp.asarray(y2)
            assert not correspond(Z, y2)
            assert not correspond(Z2, y)


@make_xp_test_case(is_monotonic)
class TestIsMonotonic:

    def test_is_monotonic_empty(self, xp):
        # Tests is_monotonic(Z) on an empty linkage.
        Z = xp.zeros((0, 4), dtype=xp.float64)
        assert_raises(ValueError, is_monotonic, Z)

    def test_is_monotonic_1x4(self, xp):
        # Tests is_monotonic(Z) on 1x4 linkage. Expecting True.
        Z = xp.asarray([[0, 1, 0.3, 2]], dtype=xp.float64)
        assert is_monotonic(Z)

    def test_is_monotonic_2x4_T(self, xp):
        # Tests is_monotonic(Z) on 2x4 linkage. Expecting True.
        Z = xp.asarray([[0, 1, 0.3, 2],
                        [2, 3, 0.4, 3]], dtype=xp.float64)
        assert is_monotonic(Z)

    def test_is_monotonic_2x4_F(self, xp):
        # Tests is_monotonic(Z) on 2x4 linkage. Expecting False.
        Z = xp.asarray([[0, 1, 0.4, 2],
                        [2, 3, 0.3, 3]], dtype=xp.float64)
        assert not is_monotonic(Z)

    def test_is_monotonic_3x4_T(self, xp):
        # Tests is_monotonic(Z) on 3x4 linkage. Expecting True.
        Z = xp.asarray([[0, 1, 0.3, 2],
                        [2, 3, 0.4, 2],
                        [4, 5, 0.6, 4]], dtype=xp.float64)
        assert is_monotonic(Z)

    def test_is_monotonic_3x4_F1(self, xp):
        # Tests is_monotonic(Z) on 3x4 linkage (case 1). Expecting False.
        Z = xp.asarray([[0, 1, 0.3, 2],
                        [2, 3, 0.2, 2],
                        [4, 5, 0.6, 4]], dtype=xp.float64)
        assert not is_monotonic(Z)

    def test_is_monotonic_3x4_F2(self, xp):
        # Tests is_monotonic(Z) on 3x4 linkage (case 2). Expecting False.
        Z = xp.asarray([[0, 1, 0.8, 2],
                        [2, 3, 0.4, 2],
                        [4, 5, 0.6, 4]], dtype=xp.float64)
        assert not is_monotonic(Z)

    def test_is_monotonic_3x4_F3(self, xp):
        # Tests is_monotonic(Z) on 3x4 linkage (case 3). Expecting False
        Z = xp.asarray([[0, 1, 0.3, 2],
                        [2, 3, 0.4, 2],
                        [4, 5, 0.2, 4]], dtype=xp.float64)
        assert not is_monotonic(Z)

    def test_is_monotonic_tdist_linkage1(self, xp):
        # Tests is_monotonic(Z) on clustering generated by single linkage on
        # tdist data set. Expecting True.
        Z = xp.asarray(linkage(hierarchy_test_data.ytdist, 'single'))
        assert is_monotonic(Z)

    def test_is_monotonic_tdist_linkage2(self, xp):
        # Tests is_monotonic(Z) on clustering generated by single linkage on
        # tdist data set. Perturbing. Expecting False.
        Z = xp.asarray(linkage(hierarchy_test_data.ytdist, 'single'))
        Z = xpx.at(Z)[2, 2].set(0.0)
        assert not is_monotonic(Z)

    def test_is_monotonic_Q_linkage(self, xp):
        # Tests is_monotonic(Z) on clustering generated by single linkage on
        # Q data set. Expecting True.
        X = hierarchy_test_data.Q_X
        Z = xp.asarray(linkage(X, 'single'))
        assert is_monotonic(Z)


@make_xp_test_case(maxdists)
class TestMaxDists:

    def test_maxdists_empty_linkage(self, xp):
        # Tests maxdists(Z) on empty linkage. Expecting exception.
        Z = xp.zeros((0, 4), dtype=xp.float64)
        assert_raises(ValueError, maxdists, Z)

    def test_maxdists_one_cluster_linkage(self, xp):
        # Tests maxdists(Z) on linkage with one cluster.
        Z = xp.asarray([[0, 1, 0.3, 4]], dtype=xp.float64)
        MD = maxdists(Z)
        expectedMD = calculate_maximum_distances(Z, xp)
        xp_assert_close(MD, expectedMD, atol=1e-15)

    @pytest.mark.parametrize(
        "method", ['single', 'complete', 'ward', 'centroid', 'median'])
    def test_maxdists_Q_linkage(self, method, xp):
        # Tests maxdists(Z) on the Q data set
        X = hierarchy_test_data.Q_X
        Z = xp.asarray(linkage(X, method))
        MD = maxdists(Z)
        expectedMD = calculate_maximum_distances(Z, xp)
        xp_assert_close(MD, expectedMD, atol=1e-15)


@make_xp_test_case(maxinconsts)
class TestMaxInconsts:

    def test_maxinconsts_empty_linkage(self, xp):
        # Tests maxinconsts(Z, R) on empty linkage. Expecting exception.
        Z = xp.zeros((0, 4), dtype=xp.float64)
        R = xp.zeros((0, 4), dtype=xp.float64)
        assert_raises(ValueError, maxinconsts, Z, R)

    def test_maxinconsts_difrow_linkage(self, xp):
        # Tests maxinconsts(Z, R) on linkage and inconsistency matrices with
        # different numbers of clusters. Expecting exception.
        Z = xp.asarray([[0, 1, 0.3, 4]], dtype=xp.float64)
        R = np.random.rand(2, 4)
        R = xp.asarray(R)
        assert_raises(ValueError, maxinconsts, Z, R)

    def test_maxinconsts_one_cluster_linkage(self, xp):
        # Tests maxinconsts(Z, R) on linkage with one cluster.
        Z = xp.asarray([[0, 1, 0.3, 4]], dtype=xp.float64)
        R = xp.asarray([[0, 0, 0, 0.3]], dtype=xp.float64)
        MD = maxinconsts(Z, R)
        expectedMD = calculate_maximum_inconsistencies(Z, R, xp=xp)
        xp_assert_close(MD, expectedMD, atol=1e-15)

    @pytest.mark.parametrize(
        "method", ['single', 'complete', 'ward', 'centroid', 'median'])
    def test_maxinconsts_Q_linkage(self, method, xp):
        # Tests maxinconsts(Z, R) on the Q data set
        X = hierarchy_test_data.Q_X
        Z = linkage(X, method)
        R = xp.asarray(inconsistent(Z))
        Z = xp.asarray(Z)
        MD = maxinconsts(Z, R)
        expectedMD = calculate_maximum_inconsistencies(Z, R, xp=xp)
        xp_assert_close(MD, expectedMD, atol=1e-15)


@make_xp_test_case(maxRstat)
class TestMaxRStat:

    def test_maxRstat_invalid_index(self, xp):
        # Tests maxRstat(Z, R, i). Expecting exception.
        Z = xp.asarray([[0, 1, 0.3, 4]], dtype=xp.float64)
        R = xp.asarray([[0, 0, 0, 0.3]], dtype=xp.float64)
        with pytest.raises(TypeError):
            maxRstat(Z, R, 3.3)
        with pytest.raises(ValueError):
            maxRstat(Z, R, -1)
        with pytest.raises(ValueError):
            maxRstat(Z, R, 4)

    @pytest.mark.parametrize("i", range(4))
    def test_maxRstat_empty_linkage(self, i, xp):
        # Tests maxRstat(Z, R, i) on empty linkage. Expecting exception.
        Z = xp.zeros((0, 4), dtype=xp.float64)
        R = xp.zeros((0, 4), dtype=xp.float64)
        assert_raises(ValueError, maxRstat, Z, R, i)

    @pytest.mark.parametrize("i", range(4))
    def test_maxRstat_difrow_linkage(self, i, xp):
        # Tests maxRstat(Z, R, i) on linkage and inconsistency matrices with
        # different numbers of clusters. Expecting exception.
        Z = xp.asarray([[0, 1, 0.3, 4]], dtype=xp.float64)
        R = np.random.rand(2, 4)
        R = xp.asarray(R)
        assert_raises(ValueError, maxRstat, Z, R, i)

    def test_maxRstat_one_cluster_linkage(self, xp):
        # Tests maxRstat(Z, R, i) on linkage with one cluster.
        Z = xp.asarray([[0, 1, 0.3, 4]], dtype=xp.float64)
        R = xp.asarray([[0, 0, 0, 0.3]], dtype=xp.float64)
        MD = maxRstat(Z, R, 1)
        expectedMD = calculate_maximum_inconsistencies(Z, R, 1, xp)
        xp_assert_close(MD, expectedMD, atol=1e-15)

    @pytest.mark.parametrize(
        "method", ['single', 'complete', 'ward', 'centroid', 'median'])
    def test_maxRstat_Q_linkage(self, method, xp):
        # Tests maxRstat(Z, R, 1) on the Q data set
        X = hierarchy_test_data.Q_X
        Z = linkage(X, method)
        R = xp.asarray(inconsistent(Z))
        Z = xp.asarray(Z)
        MD = maxRstat(Z, R, 1)
        expectedMD = calculate_maximum_inconsistencies(Z, R, 1, xp)
        xp_assert_close(MD, expectedMD, atol=1e-15)


@make_xp_test_case(dendrogram)
class TestDendrogram:

    def test_dendrogram_single_linkage_tdist(self, xp):
        # Tests dendrogram calculation on single linkage of the tdist data set.
        Z = xp.asarray(linkage(hierarchy_test_data.ytdist, 'single'))
        R = dendrogram(Z, no_plot=True)
        leaves = R["leaves"]
        assert_equal(leaves, [2, 5, 1, 0, 3, 4])

    def test_valid_orientation(self, xp):
        Z = xp.asarray(linkage(hierarchy_test_data.ytdist, 'single'))
        assert_raises(ValueError, dendrogram, Z, orientation="foo")

    def test_labels_as_array_or_list(self, xp):
        # test for gh-12418
        Z = xp.asarray(linkage(hierarchy_test_data.ytdist, 'single'))
        labels = [1, 3, 2, 6, 4, 5]
        result1 = dendrogram(Z, labels=xp.asarray(labels), no_plot=True)
        result2 = dendrogram(Z, labels=labels, no_plot=True)
        assert result1 == result2

    @pytest.mark.skipif(not have_matplotlib, reason="no matplotlib")
    def test_valid_label_size(self, xp):
        link = xp.asarray([
            [0, 1, 1.0, 4],
            [2, 3, 1.0, 5],
            [4, 5, 2.0, 6],
        ])
        plt.figure()
        with pytest.raises(ValueError) as exc_info:
            dendrogram(link, labels=list(range(100)))
        assert "Dimensions of Z and labels must be consistent."\
               in str(exc_info.value)

        with pytest.raises(
                ValueError,
                match="Dimensions of Z and labels must be consistent."):
            dendrogram(link, labels=[])

        plt.close()

    @skip_xp_backends('torch',
         reason='MPL 3.9.2 & torch DeprecationWarning from __array_wrap__'
                ' and NumPy 2.0'
    )
    @skip_xp_backends('dask.array',
         reason='dask.array has bad interaction with matplotlib'
    )
    @pytest.mark.skipif(not have_matplotlib, reason="no matplotlib")
    @pytest.mark.parametrize("orientation", ['top', 'bottom', 'left', 'right'])
    def test_dendrogram_plot(self, orientation, xp):
        # Tests dendrogram plotting.
        Z = xp.asarray(linkage(hierarchy_test_data.ytdist, 'single'))
        expected = {'color_list': ['C1', 'C0', 'C0', 'C0', 'C0'],
                    'dcoord': [[0.0, 138.0, 138.0, 0.0],
                               [0.0, 219.0, 219.0, 0.0],
                               [0.0, 255.0, 255.0, 219.0],
                               [0.0, 268.0, 268.0, 255.0],
                               [138.0, 295.0, 295.0, 268.0]],
                    'icoord': [[5.0, 5.0, 15.0, 15.0],
                               [45.0, 45.0, 55.0, 55.0],
                               [35.0, 35.0, 50.0, 50.0],
                               [25.0, 25.0, 42.5, 42.5],
                               [10.0, 10.0, 33.75, 33.75]],
                    'ivl': ['2', '5', '1', '0', '3', '4'],
                    'leaves': [2, 5, 1, 0, 3, 4],
                    'leaves_color_list': ['C1', 'C1', 'C0', 'C0', 'C0', 'C0'],
                    }

        fig = plt.figure()
        ax = fig.add_subplot(221)

        # test that dendrogram accepts ax keyword
        R1 = dendrogram(Z, ax=ax, orientation=orientation)
        R1['dcoord'] = np.asarray(R1['dcoord'])
        assert_equal(R1, expected)

        # test that dendrogram accepts and handle the leaf_font_size and
        # leaf_rotation keywords
        dendrogram(Z, ax=ax, orientation=orientation,
                   leaf_font_size=20, leaf_rotation=90)
        testlabel = (
            ax.get_xticklabels()[0]
            if orientation in ['top', 'bottom']
            else ax.get_yticklabels()[0]
        )
        assert_equal(testlabel.get_rotation(), 90)
        assert_equal(testlabel.get_size(), 20)
        dendrogram(Z, ax=ax, orientation=orientation,
                   leaf_rotation=90)
        testlabel = (
            ax.get_xticklabels()[0]
            if orientation in ['top', 'bottom']
            else ax.get_yticklabels()[0]
        )
        assert_equal(testlabel.get_rotation(), 90)
        dendrogram(Z, ax=ax, orientation=orientation,
                   leaf_font_size=20)
        testlabel = (
            ax.get_xticklabels()[0]
            if orientation in ['top', 'bottom']
            else ax.get_yticklabels()[0]
        )
        assert_equal(testlabel.get_size(), 20)
        plt.close()

        # test plotting to gca (will import pylab)
        R2 = dendrogram(Z, orientation=orientation)
        plt.close()
        R2['dcoord'] = np.asarray(R2['dcoord'])
        assert_equal(R2, expected)

    @skip_xp_backends('torch',
          reason='MPL 3.9.2 & torch DeprecationWarning from __array_wrap__'
                 ' and NumPy 2.0'
     )
    @skip_xp_backends('dask.array',
         reason='dask.array has bad interaction with matplotlib'
    )
    @pytest.mark.skipif(not have_matplotlib, reason="no matplotlib")
    def test_dendrogram_truncate_mode(self, xp):
        Z = xp.asarray(linkage(hierarchy_test_data.ytdist, 'single'))

        R = dendrogram(Z, 2, 'lastp', show_contracted=True)
        plt.close()
        R['dcoord'] = np.asarray(R['dcoord'])
        assert_equal(R, {'color_list': ['C0'],
                         'dcoord': [[0.0, 295.0, 295.0, 0.0]],
                         'icoord': [[5.0, 5.0, 15.0, 15.0]],
                         'ivl': ['(2)', '(4)'],
                         'leaves': [6, 9],
                         'leaves_color_list': ['C0', 'C0'],
                         })

        R = dendrogram(Z, 2, 'mtica', show_contracted=True)
        plt.close()
        R['dcoord'] = np.asarray(R['dcoord'])
        assert_equal(R, {'color_list': ['C1', 'C0', 'C0', 'C0'],
                         'dcoord': [[0.0, 138.0, 138.0, 0.0],
                                    [0.0, 255.0, 255.0, 0.0],
                                    [0.0, 268.0, 268.0, 255.0],
                                    [138.0, 295.0, 295.0, 268.0]],
                         'icoord': [[5.0, 5.0, 15.0, 15.0],
                                    [35.0, 35.0, 45.0, 45.0],
                                    [25.0, 25.0, 40.0, 40.0],
                                    [10.0, 10.0, 32.5, 32.5]],
                         'ivl': ['2', '5', '1', '0', '(2)'],
                         'leaves': [2, 5, 1, 0, 7],
                         'leaves_color_list': ['C1', 'C1', 'C0', 'C0', 'C0'],
                         })

    @pytest.fixture
    def dendrogram_lock(self):
        return Lock()

    def test_dendrogram_colors(self, xp, dendrogram_lock):
        # Tests dendrogram plots with alternate colors
        Z = xp.asarray(linkage(hierarchy_test_data.ytdist, 'single'))

        with dendrogram_lock:
            # Global color palette might be changed concurrently
            set_link_color_palette(['c', 'm', 'y', 'k'])
            R = dendrogram(Z, no_plot=True,
                           above_threshold_color='g', color_threshold=250)
            set_link_color_palette(['g', 'r', 'c', 'm', 'y', 'k'])

            color_list = R['color_list']
            assert_equal(color_list, ['c', 'm', 'g', 'g', 'g'])

            # reset color palette (global list)
            set_link_color_palette(None)

    def test_dendrogram_leaf_colors_zero_dist(self, xp):
        # tests that the colors of leafs are correct for tree
        # with two identical points
        X = np.asarray([[1, 0, 0],
                        [0, 0, 1],
                        [0, 2, 0],
                        [0, 0, 1],
                        [0, 1, 0],
                        [0, 1, 0]])
        Z = xp.asarray(linkage(X, "single"))
        d = dendrogram(Z, no_plot=True)
        exp_colors = ['C0', 'C1', 'C1', 'C0', 'C2', 'C2']
        colors = d["leaves_color_list"]
        assert_equal(colors, exp_colors)

    def test_dendrogram_leaf_colors(self, xp):
        # tests that the colors are correct for a tree
        # with two near points ((0, 0, 1.1) and (0, 0, 1))
        X = np.asarray([[1, 0, 0],
                        [0, 0, 1.1],
                        [0, 2, 0],
                        [0, 0, 1],
                        [0, 1, 0],
                        [0, 1, 0]])
        Z = xp.asarray(linkage(X, "single"))
        d = dendrogram(Z, no_plot=True)
        exp_colors = ['C0', 'C1', 'C1', 'C0', 'C2', 'C2']
        colors = d["leaves_color_list"]
        assert_equal(colors, exp_colors)


def calculate_maximum_distances(Z, xp):
    # Used for testing correctness of maxdists.
    n = Z.shape[0] + 1
    B = xp.zeros((n-1,), dtype=Z.dtype)
    for i in range(0, n - 1):
        q = xp.zeros((3,))
        left = Z[i, 0]
        right = Z[i, 1]
        if left >= n:
            b_left = B[xp.asarray(left, dtype=xp.int64) - n]
            q = xpx.at(q, 0).set(b_left)
        if right >= n:
            b_right = B[xp.asarray(right, dtype=xp.int64) - n]
            q = xpx.at(q, 1).set(b_right)
        q = xpx.at(q, 2).set(Z[i, 2])
        B = xpx.at(B, i).set(xp.max(q))
    return B


def calculate_maximum_inconsistencies(Z, R, k=3, xp=np):
    # Used for testing correctness of maxinconsts.
    n = Z.shape[0] + 1
    dtype = xp.result_type(Z, R)
    B = xp.zeros((n-1,), dtype=dtype)
    for i in range(0, n - 1):
        q = xp.zeros((3,))
        left = Z[i, 0]
        right = Z[i, 1]
        if left >= n:
            b_left = B[xp.asarray(left, dtype=xp.int64) - n]
            q = xpx.at(q, 0).set(b_left)
        if right >= n:
            b_right = B[xp.asarray(right, dtype=xp.int64) - n]
            q = xpx.at(q, 1).set(b_right)
        q = xpx.at(q, 2).set(R[i, k])
        B = xpx.at(B, i).set(xp.max(q))
    return B


@make_xp_test_case(to_tree)
def test_node_compare(xp):
    np.random.seed(23)
    nobs = 50
    X = np.random.randn(nobs, 4)
    Z = xp.asarray(ward(X))
    tree = to_tree(Z)
    assert_(tree > tree.get_left())
    assert_(tree.get_right() > tree.get_left())
    assert_(tree.get_right() == tree.get_right())
    assert_(tree.get_right() != tree.get_left())


@make_xp_test_case(cut_tree)
def test_cut_tree(xp):
    np.random.seed(23)
    nobs = 50
    X = np.random.randn(nobs, 4)
    Z = xp.asarray(ward(X))
    cutree = cut_tree(Z)

    # cutree.dtype varies between int32 and int64 over platforms
    xp_assert_close(cutree[:, 0], xp.arange(nobs), rtol=1e-15, check_dtype=False)
    xp_assert_close(cutree[:, -1], xp.zeros(nobs), rtol=1e-15, check_dtype=False)
    assert_equal(np.asarray(cutree).max(0), np.arange(nobs - 1, -1, -1))

    xp_assert_close(cutree[:, [-5]], cut_tree(Z, n_clusters=5), rtol=1e-15)
    xp_assert_close(cutree[:, [-5, -10]], cut_tree(Z, n_clusters=[5, 10]), rtol=1e-15)
    xp_assert_close(cutree[:, [-10, -5]], cut_tree(Z, n_clusters=[10, 5]), rtol=1e-15)

    nodes = _order_cluster_tree(Z)
    heights = xp.asarray([node.dist for node in nodes])

    xp_assert_close(cutree[:, np.searchsorted(heights, [5])],
                    cut_tree(Z, height=5), rtol=1e-15)
    xp_assert_close(cutree[:, np.searchsorted(heights, [5, 10])],
                    cut_tree(Z, height=[5, 10]), rtol=1e-15)
    xp_assert_close(cutree[:, np.searchsorted(heights, [10, 5])],
                    cut_tree(Z, height=[10, 5]), rtol=1e-15)


@make_xp_test_case(optimal_leaf_ordering)
def test_optimal_leaf_ordering(xp):
    # test with the distance vector y
    Z = optimal_leaf_ordering(xp.asarray(linkage(hierarchy_test_data.ytdist)),
                              xp.asarray(hierarchy_test_data.ytdist))
    expectedZ = hierarchy_test_data.linkage_ytdist_single_olo
    xp_assert_close(Z, xp.asarray(expectedZ), atol=1e-10)

    # test with the observation matrix X
    Z = optimal_leaf_ordering(xp.asarray(linkage(hierarchy_test_data.X, 'ward')),
                              xp.asarray(hierarchy_test_data.X))
    expectedZ = hierarchy_test_data.linkage_X_ward_olo
    xp_assert_close(Z, xp.asarray(expectedZ), atol=1e-06)


@skip_xp_backends(np_only=True, reason='`Heap` only supports NumPy backend')
def test_Heap(xp):
    values = xp.asarray([2, -1, 0, -1.5, 3])
    heap = Heap(values)

    pair = heap.get_min()
    assert_equal(pair['key'], 3)
    assert_equal(pair['value'], -1.5)

    heap.remove_min()
    pair = heap.get_min()
    assert_equal(pair['key'], 1)
    assert_equal(pair['value'], -1)

    heap.change_value(1, 2.5)
    pair = heap.get_min()
    assert_equal(pair['key'], 2)
    assert_equal(pair['value'], 0)

    heap.remove_min()
    heap.remove_min()

    heap.change_value(1, 10)
    pair = heap.get_min()
    assert_equal(pair['key'], 4)
    assert_equal(pair['value'], 3)

    heap.remove_min()
    pair = heap.get_min()
    assert_equal(pair['key'], 1)
    assert_equal(pair['value'], 10)
