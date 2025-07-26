import numpy as np
import pytest
from numpy.testing import assert_array_almost_equal
from scipy.sparse import csr_array, csr_matrix, coo_array, coo_matrix
from scipy.sparse.csgraph import (breadth_first_tree, depth_first_tree,
    csgraph_to_dense, csgraph_from_dense, csgraph_masked_from_dense)


def test_graph_breadth_first():
    csgraph = np.array([[0, 1, 2, 0, 0],
                        [1, 0, 0, 0, 3],
                        [2, 0, 0, 7, 0],
                        [0, 0, 7, 0, 1],
                        [0, 3, 0, 1, 0]])
    csgraph = csgraph_from_dense(csgraph, null_value=0)

    bfirst = np.array([[0, 1, 2, 0, 0],
                       [0, 0, 0, 0, 3],
                       [0, 0, 0, 7, 0],
                       [0, 0, 0, 0, 0],
                       [0, 0, 0, 0, 0]])

    for directed in [True, False]:
        bfirst_test = breadth_first_tree(csgraph, 0, directed)
        assert_array_almost_equal(csgraph_to_dense(bfirst_test),
                                  bfirst)


def test_graph_depth_first():
    csgraph = np.array([[0, 1, 2, 0, 0],
                        [1, 0, 0, 0, 3],
                        [2, 0, 0, 7, 0],
                        [0, 0, 7, 0, 1],
                        [0, 3, 0, 1, 0]])
    csgraph = csgraph_from_dense(csgraph, null_value=0)

    dfirst = np.array([[0, 1, 0, 0, 0],
                       [0, 0, 0, 0, 3],
                       [0, 0, 0, 0, 0],
                       [0, 0, 7, 0, 0],
                       [0, 0, 0, 1, 0]])

    for directed in [True, False]:
        dfirst_test = depth_first_tree(csgraph, 0, directed)
        assert_array_almost_equal(csgraph_to_dense(dfirst_test), dfirst)


def test_return_type():
    from .._laplacian import laplacian
    from .._min_spanning_tree import minimum_spanning_tree

    np_csgraph = np.array([[0, 1, 2, 0, 0],
                           [1, 0, 0, 0, 3],
                           [2, 0, 0, 7, 0],
                           [0, 0, 7, 0, 1],
                           [0, 3, 0, 1, 0]])
    csgraph = csr_array(np_csgraph)
    assert isinstance(laplacian(csgraph), coo_array)
    assert isinstance(minimum_spanning_tree(csgraph), csr_array)
    for directed in [True, False]:
        assert isinstance(depth_first_tree(csgraph, 0, directed), csr_array)
        assert isinstance(breadth_first_tree(csgraph, 0, directed), csr_array)

    csgraph = csgraph_from_dense(np_csgraph, null_value=0)
    assert isinstance(csgraph, csr_array)
    assert isinstance(laplacian(csgraph), coo_array)
    assert isinstance(minimum_spanning_tree(csgraph), csr_array)
    for directed in [True, False]:
        assert isinstance(depth_first_tree(csgraph, 0, directed), csr_array)
        assert isinstance(breadth_first_tree(csgraph, 0, directed), csr_array)

    csgraph = csgraph_masked_from_dense(np_csgraph, null_value=0)
    assert isinstance(csgraph, np.ma.MaskedArray)
    assert csgraph._baseclass is np.ndarray
    # laplacian doesnt work with masked arrays so not here
    assert isinstance(minimum_spanning_tree(csgraph), csr_array)
    for directed in [True, False]:
        assert isinstance(depth_first_tree(csgraph, 0, directed), csr_array)
        assert isinstance(breadth_first_tree(csgraph, 0, directed), csr_array)

    # start of testing with matrix/spmatrix types
    with np.testing.suppress_warnings() as sup:
        sup.filter(DeprecationWarning, "the matrix subclass.*")
        sup.filter(PendingDeprecationWarning, "the matrix subclass.*")

        nm_csgraph = np.matrix([[0, 1, 2, 0, 0],
                                [1, 0, 0, 0, 3],
                                [2, 0, 0, 7, 0],
                                [0, 0, 7, 0, 1],
                                [0, 3, 0, 1, 0]])

    csgraph = csr_matrix(nm_csgraph)
    assert isinstance(laplacian(csgraph), coo_matrix)
    assert isinstance(minimum_spanning_tree(csgraph), csr_matrix)
    for directed in [True, False]:
        assert isinstance(depth_first_tree(csgraph, 0, directed), csr_matrix)
        assert isinstance(breadth_first_tree(csgraph, 0, directed), csr_matrix)

    csgraph = csgraph_from_dense(nm_csgraph, null_value=0)
    assert isinstance(csgraph, csr_matrix)
    assert isinstance(laplacian(csgraph), coo_matrix)
    assert isinstance(minimum_spanning_tree(csgraph), csr_matrix)
    for directed in [True, False]:
        assert isinstance(depth_first_tree(csgraph, 0, directed), csr_matrix)
        assert isinstance(breadth_first_tree(csgraph, 0, directed), csr_matrix)

    mm_csgraph = csgraph_masked_from_dense(nm_csgraph, null_value=0)
    assert isinstance(mm_csgraph, np.ma.MaskedArray)
    # laplacian doesnt work with masked arrays so not here
    assert isinstance(minimum_spanning_tree(csgraph), csr_matrix)
    for directed in [True, False]:
        assert isinstance(depth_first_tree(csgraph, 0, directed), csr_matrix)
        assert isinstance(breadth_first_tree(csgraph, 0, directed), csr_matrix)
    # end of testing with matrix/spmatrix types


def test_graph_breadth_first_trivial_graph():
    csgraph = np.array([[0]])
    csgraph = csgraph_from_dense(csgraph, null_value=0)

    bfirst = np.array([[0]])

    for directed in [True, False]:
        bfirst_test = breadth_first_tree(csgraph, 0, directed)
        assert_array_almost_equal(csgraph_to_dense(bfirst_test), bfirst)


def test_graph_depth_first_trivial_graph():
    csgraph = np.array([[0]])
    csgraph = csgraph_from_dense(csgraph, null_value=0)

    bfirst = np.array([[0]])

    for directed in [True, False]:
        bfirst_test = depth_first_tree(csgraph, 0, directed)
        assert_array_almost_equal(csgraph_to_dense(bfirst_test),
                                  bfirst)


@pytest.mark.parametrize('directed', [True, False])
@pytest.mark.parametrize('tree_func', [breadth_first_tree, depth_first_tree])
def test_int64_indices(tree_func, directed):
    # See https://github.com/scipy/scipy/issues/18716
    g = csr_array(([1], np.array([[0], [1]], dtype=np.int64)), shape=(2, 2))
    assert g.indices.dtype == np.int64
    tree = tree_func(g, 0, directed=directed)
    assert_array_almost_equal(csgraph_to_dense(tree), [[0, 1], [0, 0]])

