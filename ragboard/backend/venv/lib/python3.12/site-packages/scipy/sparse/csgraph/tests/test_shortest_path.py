from io import StringIO
import warnings
import numpy as np
from numpy.testing import assert_array_almost_equal, assert_array_equal, assert_allclose
from pytest import raises as assert_raises
from scipy.sparse.csgraph import (shortest_path, dijkstra, johnson,
                                  bellman_ford, construct_dist_matrix, yen,
                                  NegativeCycleError)
import scipy.sparse
from scipy.io import mmread
import pytest

directed_G = np.array([[0, 3, 3, 0, 0],
                       [0, 0, 0, 2, 4],
                       [0, 0, 0, 0, 0],
                       [1, 0, 0, 0, 0],
                       [2, 0, 0, 2, 0]], dtype=float)

# Undirected version of directed_G
undirected_G = np.array([[0, 3, 3, 1, 2],
                         [3, 0, 0, 2, 4],
                         [3, 0, 0, 0, 0],
                         [1, 2, 0, 0, 2],
                         [2, 4, 0, 2, 0]], dtype=float)

unweighted_G = (directed_G > 0).astype(float)

# Correct shortest path lengths for directed_G and undirected_G
directed_SP = [[0, 3, 3, 5, 7],
               [3, 0, 6, 2, 4],
               [np.inf, np.inf, 0, np.inf, np.inf],
               [1, 4, 4, 0, 8],
               [2, 5, 5, 2, 0]]

directed_2SP_0_to_3 = [[-9999, 0, -9999, 1, -9999],
                       [-9999, 0, -9999, 4, 1]]

undirected_SP = np.array([[0, 3, 3, 1, 2],
                          [3, 0, 6, 2, 4],
                          [3, 6, 0, 4, 5],
                          [1, 2, 4, 0, 2],
                          [2, 4, 5, 2, 0]], dtype=float)

undirected_SP_limit_2 = np.array([[0, np.inf, np.inf, 1, 2],
                                  [np.inf, 0, np.inf, 2, np.inf],
                                  [np.inf, np.inf, 0, np.inf, np.inf],
                                  [1, 2, np.inf, 0, 2],
                                  [2, np.inf, np.inf, 2, 0]], dtype=float)

undirected_SP_limit_0 = np.ones((5, 5), dtype=float) - np.eye(5)
undirected_SP_limit_0[undirected_SP_limit_0 > 0] = np.inf

# Correct predecessors for directed_G and undirected_G
directed_pred = np.array([[-9999, 0, 0, 1, 1],
                          [3, -9999, 0, 1, 1],
                          [-9999, -9999, -9999, -9999, -9999],
                          [3, 0, 0, -9999, 1],
                          [4, 0, 0, 4, -9999]], dtype=float)

undirected_pred = np.array([[-9999, 0, 0, 0, 0],
                            [1, -9999, 0, 1, 1],
                            [2, 0, -9999, 0, 0],
                            [3, 3, 0, -9999, 3],
                            [4, 4, 0, 4, -9999]], dtype=float)

# Other graphs
directed_sparse_zero_G = scipy.sparse.csr_array(
    (
        [0, 1, 2, 3, 1],
        ([0, 1, 2, 3, 4], [1, 2, 0, 4, 3]),
    ),
    shape=(5, 5),
)

directed_sparse_zero_SP = [[0, 0, 1, np.inf, np.inf],
                      [3, 0, 1, np.inf, np.inf],
                      [2, 2, 0, np.inf, np.inf],
                      [np.inf, np.inf, np.inf, 0, 3],
                      [np.inf, np.inf, np.inf, 1, 0]]

undirected_sparse_zero_G = scipy.sparse.csr_array(
    (
        [0, 0, 1, 1, 2, 2, 1, 1],
        ([0, 1, 1, 2, 2, 0, 3, 4], [1, 0, 2, 1, 0, 2, 4, 3])
    ),
    shape=(5, 5),
)

undirected_sparse_zero_SP = [[0, 0, 1, np.inf, np.inf],
                        [0, 0, 1, np.inf, np.inf],
                        [1, 1, 0, np.inf, np.inf],
                        [np.inf, np.inf, np.inf, 0, 1],
                        [np.inf, np.inf, np.inf, 1, 0]]

directed_negative_weighted_G = np.array([[0, 0, 0],
                                         [-1, 0, 0],
                                         [0, -1, 0]], dtype=float)

directed_negative_weighted_SP = np.array([[0, np.inf, np.inf],
                                          [-1, 0, np.inf],
                                          [-2, -1, 0]], dtype=float)

methods = ['auto', 'FW', 'D', 'BF', 'J']


def test_dijkstra_limit():
    limits = [0, 2, np.inf]
    results = [undirected_SP_limit_0,
               undirected_SP_limit_2,
               undirected_SP]

    def check(limit, result):
        SP = dijkstra(undirected_G, directed=False, limit=limit)
        assert_array_almost_equal(SP, result)

    for limit, result in zip(limits, results):
        check(limit, result)


def test_directed():
    def check(method):
        SP = shortest_path(directed_G, method=method, directed=True,
                           overwrite=False)
        assert_array_almost_equal(SP, directed_SP)

    for method in methods:
        check(method)


def test_undirected():
    def check(method, directed_in):
        if directed_in:
            SP1 = shortest_path(directed_G, method=method, directed=False,
                                overwrite=False)
            assert_array_almost_equal(SP1, undirected_SP)
        else:
            SP2 = shortest_path(undirected_G, method=method, directed=True,
                                overwrite=False)
            assert_array_almost_equal(SP2, undirected_SP)

    for method in methods:
        for directed_in in (True, False):
            check(method, directed_in)


def test_directed_sparse_zero():
    # test directed sparse graph with zero-weight edge and two connected components
    def check(method):
        SP = shortest_path(directed_sparse_zero_G, method=method, directed=True,
                           overwrite=False)
        assert_array_almost_equal(SP, directed_sparse_zero_SP)

    for method in methods:
        check(method)


def test_undirected_sparse_zero():
    def check(method, directed_in):
        if directed_in:
            SP1 = shortest_path(directed_sparse_zero_G, method=method, directed=False,
                                overwrite=False)
            assert_array_almost_equal(SP1, undirected_sparse_zero_SP)
        else:
            SP2 = shortest_path(undirected_sparse_zero_G, method=method, directed=True,
                                overwrite=False)
            assert_array_almost_equal(SP2, undirected_sparse_zero_SP)

    for method in methods:
        for directed_in in (True, False):
            check(method, directed_in)


@pytest.mark.parametrize('directed, SP_ans',
                         ((True, directed_SP),
                          (False, undirected_SP)))
@pytest.mark.parametrize('indices', ([0, 2, 4], [0, 4], [3, 4], [0, 0]))
def test_dijkstra_indices_min_only(directed, SP_ans, indices):
    SP_ans = np.array(SP_ans)
    indices = np.array(indices, dtype=np.int64)
    min_ind_ans = indices[np.argmin(SP_ans[indices, :], axis=0)]
    min_d_ans = np.zeros(SP_ans.shape[0], SP_ans.dtype)
    for k in range(SP_ans.shape[0]):
        min_d_ans[k] = SP_ans[min_ind_ans[k], k]
    min_ind_ans[np.isinf(min_d_ans)] = -9999

    SP, pred, sources = dijkstra(directed_G,
                                 directed=directed,
                                 indices=indices,
                                 min_only=True,
                                 return_predecessors=True)
    assert_array_almost_equal(SP, min_d_ans)
    assert_array_equal(min_ind_ans, sources)
    SP = dijkstra(directed_G,
                  directed=directed,
                  indices=indices,
                  min_only=True,
                  return_predecessors=False)
    assert_array_almost_equal(SP, min_d_ans)


@pytest.mark.parametrize('n', (10, 100, 1000))
def test_dijkstra_min_only_random(n):
    rng = np.random.default_rng(7345782358920239234)
    data = scipy.sparse.random_array((n, n), density=0.5, format='lil',
                                     rng=rng, dtype=np.float64)
    data.setdiag(np.zeros(n, dtype=np.bool_))
    # choose some random vertices
    v = np.arange(n)
    rng.shuffle(v)
    indices = v[:int(n*.1)]
    ds, pred, sources = dijkstra(data,
                                 directed=True,
                                 indices=indices,
                                 min_only=True,
                                 return_predecessors=True)
    for k in range(n):
        p = pred[k]
        s = sources[k]
        while p != -9999:
            assert sources[p] == s
            p = pred[p]


@pytest.mark.parametrize('n', (10, 100))
@pytest.mark.parametrize("method", ['FW', 'J', 'BF'])
@pytest.mark.parametrize('directed', (True, False))
def test_star_graph(n, method, directed):
    # Build the star graph
    star_arr = np.zeros((n, n), dtype=float)
    star_center_idx = 0
    star_arr[star_center_idx, :] = star_arr[:, star_center_idx] = range(n)
    G = scipy.sparse.csr_matrix(star_arr, shape=(n, n))
    # Build the distances matrix
    SP_solution = np.zeros((n, n), dtype=float)
    SP_solution[:] = star_arr[star_center_idx]
    for idx in range(1, n):
        SP_solution[idx] += star_arr[idx, star_center_idx]
    np.fill_diagonal(SP_solution, 0)

    SP = shortest_path(G, method=method, directed=directed)
    assert_allclose(
        SP_solution, SP
    )


def test_dijkstra_random():
    # reproduces the hang observed in gh-17782
    n = 10
    indices = [0, 4, 4, 5, 7, 9, 0, 6, 2, 3, 7, 9, 1, 2, 9, 2, 5, 6]
    indptr = [0, 0, 2, 5, 6, 7, 8, 12, 15, 18, 18]
    data = [0.33629, 0.40458, 0.47493, 0.42757, 0.11497, 0.91653, 0.69084,
            0.64979, 0.62555, 0.743, 0.01724, 0.99945, 0.31095, 0.15557,
            0.02439, 0.65814, 0.23478, 0.24072]
    graph = scipy.sparse.csr_array((data, indices, indptr), shape=(n, n))
    dijkstra(graph, directed=True, return_predecessors=True)


def test_gh_17782_segfault():
    text = """%%MatrixMarket matrix coordinate real general
                84 84 22
                2 1 4.699999809265137e+00
                6 14 1.199999973177910e-01
                9 6 1.199999973177910e-01
                10 16 2.012000083923340e+01
                11 10 1.422000026702881e+01
                12 1 9.645999908447266e+01
                13 18 2.012000083923340e+01
                14 13 4.679999828338623e+00
                15 11 1.199999973177910e-01
                16 12 1.199999973177910e-01
                18 15 1.199999973177910e-01
                32 2 2.299999952316284e+00
                33 20 6.000000000000000e+00
                33 32 5.000000000000000e+00
                36 9 3.720000028610229e+00
                36 37 3.720000028610229e+00
                36 38 3.720000028610229e+00
                37 44 8.159999847412109e+00
                38 32 7.903999328613281e+01
                43 20 2.400000000000000e+01
                43 33 4.000000000000000e+00
                44 43 6.028000259399414e+01
    """
    data = mmread(StringIO(text), spmatrix=False)
    dijkstra(data, directed=True, return_predecessors=True)


def test_shortest_path_indices():
    indices = np.arange(4)

    def check(func, indshape):
        outshape = indshape + (5,)
        SP = func(directed_G, directed=False,
                  indices=indices.reshape(indshape))
        assert_array_almost_equal(SP, undirected_SP[indices].reshape(outshape))

    for indshape in [(4,), (4, 1), (2, 2)]:
        for func in (dijkstra, bellman_ford, johnson, shortest_path):
            check(func, indshape)

    assert_raises(ValueError, shortest_path, directed_G, method='FW',
                  indices=indices)


def test_predecessors():
    SP_res = {True: directed_SP,
              False: undirected_SP}
    pred_res = {True: directed_pred,
                False: undirected_pred}

    def check(method, directed):
        SP, pred = shortest_path(directed_G, method, directed=directed,
                                 overwrite=False,
                                 return_predecessors=True)
        assert_array_almost_equal(SP, SP_res[directed])
        assert_array_almost_equal(pred, pred_res[directed])

    for method in methods:
        for directed in (True, False):
            check(method, directed)


def test_construct_shortest_path():
    def check(method, directed):
        SP1, pred = shortest_path(directed_G,
                                  directed=directed,
                                  overwrite=False,
                                  return_predecessors=True)
        SP2 = construct_dist_matrix(directed_G, pred, directed=directed)
        assert_array_almost_equal(SP1, SP2)

    for method in methods:
        for directed in (True, False):
            check(method, directed)

@pytest.mark.parametrize("directed", [True, False])
def test_construct_dist_matrix_predecessors_error(directed):
    SP1, pred = shortest_path(directed_G,
                                directed=directed,
                                overwrite=False,
                                return_predecessors=True)
    assert_raises(TypeError, construct_dist_matrix,
                  directed_G, pred.astype(np.int64), directed)


def test_unweighted_path():
    def check(method, directed):
        SP1 = shortest_path(directed_G,
                            directed=directed,
                            overwrite=False,
                            unweighted=True)
        SP2 = shortest_path(unweighted_G,
                            directed=directed,
                            overwrite=False,
                            unweighted=False)
        assert_array_almost_equal(SP1, SP2)

    for method in methods:
        for directed in (True, False):
            check(method, directed)


def test_negative_cycles():
    # create a small graph with a negative cycle
    graph = np.ones([5, 5])
    graph.flat[::6] = 0
    graph[1, 2] = -2

    def check(method, directed):
        assert_raises(NegativeCycleError, shortest_path, graph, method,
                      directed)

    for directed in (True, False):
        for method in ['FW', 'J', 'BF']:
            check(method, directed)

        assert_raises(NegativeCycleError, yen, graph, 0, 1, 1,
                      directed=directed)


@pytest.mark.parametrize("method", ['FW', 'J', 'BF'])
def test_negative_weights(method):
    SP = shortest_path(directed_negative_weighted_G, method, directed=True)
    assert_allclose(SP, directed_negative_weighted_SP, atol=1e-10)


def test_masked_input():
    np.ma.masked_equal(directed_G, 0)

    def check(method):
        SP = shortest_path(directed_G, method=method, directed=True,
                           overwrite=False)
        assert_array_almost_equal(SP, directed_SP)

    for method in methods:
        check(method)


def test_overwrite():
    G = np.array([[0, 3, 3, 1, 2],
                  [3, 0, 0, 2, 4],
                  [3, 0, 0, 0, 0],
                  [1, 2, 0, 0, 2],
                  [2, 4, 0, 2, 0]], dtype=float)
    foo = G.copy()
    shortest_path(foo, overwrite=False)
    assert_array_equal(foo, G)


@pytest.mark.parametrize('method', methods)
def test_buffer(method):
    # Smoke test that sparse matrices with read-only buffers (e.g., those from
    # joblib workers) do not cause::
    #
    #     ValueError: buffer source array is read-only
    #
    G = scipy.sparse.csr_array([[1.]])
    G.data.flags['WRITEABLE'] = False
    shortest_path(G, method=method)


def test_NaN_warnings():
    with warnings.catch_warnings(record=True) as record:
        shortest_path(np.array([[0, 1], [np.nan, 0]]))
    for r in record:
        assert r.category is not RuntimeWarning


def test_sparse_matrices():
    # Test that using lil,csr and csc sparse matrix do not cause error
    G_dense = np.array([[0, 3, 0, 0, 0],
                        [0, 0, -1, 0, 0],
                        [0, 0, 0, 2, 0],
                        [0, 0, 0, 0, 4],
                        [0, 0, 0, 0, 0]], dtype=float)
    SP = shortest_path(G_dense)
    G_csr = scipy.sparse.csr_array(G_dense)
    G_csc = scipy.sparse.csc_array(G_dense)
    G_lil = scipy.sparse.lil_array(G_dense)
    assert_array_almost_equal(SP, shortest_path(G_csr))
    assert_array_almost_equal(SP, shortest_path(G_csc))
    assert_array_almost_equal(SP, shortest_path(G_lil))


def test_yen_directed():
    distances, predecessors = yen(
                            directed_G,
                            source=0,
                            sink=3,
                            K=2,
                            return_predecessors=True
                        )
    assert_allclose(distances, [5., 9.])
    assert_allclose(predecessors, directed_2SP_0_to_3)


def test_yen_dense():
    dense_undirected_G = np.array([
                       [0, 3, 3, 1, 2],
                       [3, 0, 7, 6, 5],
                       [3, 7, 0, 4, 0],
                       [1, 6, 4, 0, 2],
                       [2, 5, 0, 2, 0]], dtype=float)
    distances = yen(
                dense_undirected_G,
                source=0,
                sink=4,
                K=5,
                directed=False,
            )
    assert_allclose(distances, [2., 3., 8., 9., 11.])


def test_yen_undirected():
    distances = yen(
        undirected_G,
        source=0,
        sink=3,
        K=4,
        directed=False,
    )
    assert_allclose(distances, [1., 4., 5., 8.])


def test_yen_unweighted():
    # Ask for more paths than there are, verify only the available paths are returned
    distances, predecessors = yen(
        directed_G,
        source=0,
        sink=3,
        K=4,
        unweighted=True,
        return_predecessors=True,
    )
    assert_allclose(distances, [2., 3.])
    assert_allclose(predecessors, directed_2SP_0_to_3)


def test_yen_no_paths():
    distances = yen(
        directed_G,
        source=2,
        sink=3,
        K=1,
    )
    assert distances.size == 0


def test_yen_negative_weights():
    distances = yen(
        directed_negative_weighted_G,
        source=2,
        sink=0,
        K=1,
    )
    assert_allclose(distances, [-2.])


@pytest.mark.parametrize("min_only", (True, False))
@pytest.mark.parametrize("directed", (True, False))
@pytest.mark.parametrize("return_predecessors", (True, False))
@pytest.mark.parametrize("index_dtype", (np.int32, np.int64))
@pytest.mark.parametrize("indices", (None, [1]))
def test_20904(min_only, directed, return_predecessors, index_dtype, indices):
    """Test two failures from gh-20904: int32 and indices-as-None."""
    adj_mat = scipy.sparse.eye_array(4, format="csr")
    adj_mat = scipy.sparse.csr_array(
        (
            adj_mat.data,
            adj_mat.indices.astype(index_dtype),
            adj_mat.indptr.astype(index_dtype),
        ),
    )
    dijkstra(
        adj_mat,
        directed,
        indices=indices,
        min_only=min_only,
        return_predecessors=return_predecessors,
    )
