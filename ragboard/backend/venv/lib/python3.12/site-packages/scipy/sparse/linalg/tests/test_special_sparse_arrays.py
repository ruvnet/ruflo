import pytest
import numpy as np
from numpy.testing import assert_array_equal, assert_allclose

from scipy.sparse import diags, csgraph
from scipy.linalg import eigh

from scipy.sparse.linalg import LaplacianNd
from scipy.sparse.linalg._special_sparse_arrays import Sakurai
from scipy.sparse.linalg._special_sparse_arrays import MikotaPair

INT_DTYPES = [np.int8, np.int16, np.int32, np.int64]
REAL_DTYPES = [np.float32, np.float64]
COMPLEX_DTYPES = [np.complex64, np.complex128]
ALLDTYPES = INT_DTYPES + REAL_DTYPES + COMPLEX_DTYPES


class TestLaplacianNd:
    """
    LaplacianNd tests
    """

    @pytest.mark.parametrize('bc', ['neumann', 'dirichlet', 'periodic'])
    def test_1d_specific_shape(self, bc):
        lap = LaplacianNd(grid_shape=(6, ), boundary_conditions=bc)
        lapa = lap.toarray()
        if bc == 'neumann':
            a = np.array(
                [
                    [-1, 1, 0, 0, 0, 0],
                    [1, -2, 1, 0, 0, 0],
                    [0, 1, -2, 1, 0, 0],
                    [0, 0, 1, -2, 1, 0],
                    [0, 0, 0, 1, -2, 1],
                    [0, 0, 0, 0, 1, -1],
                ]
            )
        elif bc == 'dirichlet':
            a = np.array(
                [
                    [-2, 1, 0, 0, 0, 0],
                    [1, -2, 1, 0, 0, 0],
                    [0, 1, -2, 1, 0, 0],
                    [0, 0, 1, -2, 1, 0],
                    [0, 0, 0, 1, -2, 1],
                    [0, 0, 0, 0, 1, -2],
                ]
            )
        else:
            a = np.array(
                [
                    [-2, 1, 0, 0, 0, 1],
                    [1, -2, 1, 0, 0, 0],
                    [0, 1, -2, 1, 0, 0],
                    [0, 0, 1, -2, 1, 0],
                    [0, 0, 0, 1, -2, 1],
                    [1, 0, 0, 0, 1, -2],
                ]
            )
        assert_array_equal(a, lapa)

    def test_1d_with_graph_laplacian(self):
        n = 6
        G = diags(np.ones(n - 1), 1, format='dia')
        Lf = csgraph.laplacian(G, symmetrized=True, form='function')
        La = csgraph.laplacian(G, symmetrized=True, form='array')
        grid_shape = (n,)
        bc = 'neumann'
        lap = LaplacianNd(grid_shape, boundary_conditions=bc)
        assert_array_equal(lap(np.eye(n)), -Lf(np.eye(n)))
        assert_array_equal(lap.toarray(), -La.toarray())
        # https://github.com/numpy/numpy/issues/24351
        assert_array_equal(lap.tosparse().toarray(), -La.toarray())

    @pytest.mark.parametrize('grid_shape', [(6, ), (2, 3), (2, 3, 4)])
    @pytest.mark.parametrize('bc', ['neumann', 'dirichlet', 'periodic'])
    def test_eigenvalues(self, grid_shape, bc):
        lap = LaplacianNd(grid_shape, boundary_conditions=bc, dtype=np.float64)
        L = lap.toarray()
        eigvals = eigh(L, eigvals_only=True)
        n = np.prod(grid_shape)
        eigenvalues = lap.eigenvalues()
        dtype = eigenvalues.dtype
        atol = n * n * np.finfo(dtype).eps
        # test the default ``m = None``
        assert_allclose(eigenvalues, eigvals, atol=atol)
        # test every ``m > 0``
        for m in np.arange(1, n + 1):
            assert_array_equal(lap.eigenvalues(m), eigenvalues[-m:])

    @pytest.mark.parametrize('grid_shape', [(6, ), (2, 3), (2, 3, 4)])
    @pytest.mark.parametrize('bc', ['neumann', 'dirichlet', 'periodic'])
    def test_eigenvectors(self, grid_shape, bc):
        lap = LaplacianNd(grid_shape, boundary_conditions=bc, dtype=np.float64)
        n = np.prod(grid_shape)
        eigenvalues = lap.eigenvalues()
        eigenvectors = lap.eigenvectors()
        dtype = eigenvectors.dtype
        atol = n * n * max(np.finfo(dtype).eps, np.finfo(np.double).eps)
        # test the default ``m = None`` every individual eigenvector
        for i in np.arange(n):
            r = lap.toarray() @ eigenvectors[:, i] - eigenvectors[:, i] * eigenvalues[i]
            assert_allclose(r, np.zeros_like(r), atol=atol)
        # test every ``m > 0``
        for m in np.arange(1, n + 1):
            e = lap.eigenvalues(m)
            ev = lap.eigenvectors(m)
            r = lap.toarray() @ ev - ev @ np.diag(e)
            assert_allclose(r, np.zeros_like(r), atol=atol)

    @pytest.mark.parametrize('grid_shape', [(6, ), (2, 3), (2, 3, 4)])
    @pytest.mark.parametrize('bc', ['neumann', 'dirichlet', 'periodic'])
    def test_toarray_tosparse_consistency(self, grid_shape, bc):
        lap = LaplacianNd(grid_shape, boundary_conditions=bc)
        n = np.prod(grid_shape)
        assert_array_equal(lap.toarray(), lap(np.eye(n)))
        assert_array_equal(lap.tosparse().toarray(), lap.toarray())

    @pytest.mark.parametrize('dtype', ALLDTYPES)
    @pytest.mark.parametrize('grid_shape', [(6, ), (2, 3), (2, 3, 4)])
    @pytest.mark.parametrize('bc', ['neumann', 'dirichlet', 'periodic'])
    def test_linearoperator_shape_dtype(self, grid_shape, bc, dtype):
        lap = LaplacianNd(grid_shape, boundary_conditions=bc, dtype=dtype)
        n = np.prod(grid_shape)
        assert lap.shape == (n, n)
        assert lap.dtype == dtype
        assert_array_equal(
            LaplacianNd(
                grid_shape, boundary_conditions=bc, dtype=dtype
            ).toarray(),
            LaplacianNd(grid_shape, boundary_conditions=bc)
            .toarray()
            .astype(dtype),
        )
        assert_array_equal(
            LaplacianNd(grid_shape, boundary_conditions=bc, dtype=dtype)
            .tosparse()
            .toarray(),
            LaplacianNd(grid_shape, boundary_conditions=bc)
            .tosparse()
            .toarray()
            .astype(dtype),
        )

    @pytest.mark.parametrize('dtype', ALLDTYPES)
    @pytest.mark.parametrize('grid_shape', [(6, ), (2, 3), (2, 3, 4)])
    @pytest.mark.parametrize('bc', ['neumann', 'dirichlet', 'periodic'])
    def test_dot(self, grid_shape, bc, dtype):
        """ Test the dot-product for type preservation and consistency.
        """
        lap = LaplacianNd(grid_shape, boundary_conditions=bc)
        n = np.prod(grid_shape)
        x0 = np.arange(n)
        x1 = x0.reshape((-1, 1))
        x2 = np.arange(2 * n).reshape((n, 2))
        input_set = [x0, x1, x2]
        for x in input_set:
            y = lap.dot(x.astype(dtype))
            assert x.shape == y.shape
            assert y.dtype == dtype
            if x.ndim == 2:
                yy = lap.toarray() @ x.astype(dtype)
                assert yy.dtype == dtype
                np.array_equal(y, yy)

    def test_boundary_conditions_value_error(self):
        with pytest.raises(ValueError, match="Unknown value 'robin'"):
            LaplacianNd(grid_shape=(6, ), boundary_conditions='robin')

            
class TestSakurai:
    """
    Sakurai tests
    """

    def test_specific_shape(self):
        sak = Sakurai(6)
        assert_array_equal(sak.toarray(), sak(np.eye(6)))
        a = np.array(
            [
                [ 5, -4,  1,  0,  0,  0],
                [-4,  6, -4,  1,  0,  0],
                [ 1, -4,  6, -4,  1,  0],
                [ 0,  1, -4,  6, -4,  1],
                [ 0,  0,  1, -4,  6, -4],
                [ 0,  0,  0,  1, -4,  5]
            ]
        )

        np.array_equal(a, sak.toarray())
        np.array_equal(sak.tosparse().toarray(), sak.toarray())
        ab = np.array(
            [
                [ 1,  1,  1,  1,  1,  1],
                [-4, -4, -4, -4, -4, -4],
                [ 5,  6,  6,  6,  6,  5]
            ]
        )
        np.array_equal(ab, sak.tobanded())
        e = np.array(
                [0.03922866, 0.56703972, 2.41789479, 5.97822974,
                 10.54287655, 14.45473055]
            )
        np.array_equal(e, sak.eigenvalues())
        np.array_equal(e[:2], sak.eigenvalues(2))

    # `Sakurai` default `dtype` is `np.int8` as its entries are small integers
    @pytest.mark.parametrize('dtype', ALLDTYPES)
    def test_linearoperator_shape_dtype(self, dtype):
        n = 7
        sak = Sakurai(n, dtype=dtype)
        assert sak.shape == (n, n)
        assert sak.dtype == dtype
        assert_array_equal(sak.toarray(), Sakurai(n).toarray().astype(dtype))
        assert_array_equal(sak.tosparse().toarray(),
                           Sakurai(n).tosparse().toarray().astype(dtype))

    @pytest.mark.parametrize('dtype', ALLDTYPES)
    @pytest.mark.parametrize('argument_dtype', ALLDTYPES)
    def test_dot(self, dtype, argument_dtype):
        """ Test the dot-product for type preservation and consistency.
        """
        result_dtype = np.promote_types(argument_dtype, dtype)
        n = 5
        sak = Sakurai(n)
        x0 = np.arange(n)
        x1 = x0.reshape((-1, 1))
        x2 = np.arange(2 * n).reshape((n, 2))
        input_set = [x0, x1, x2]
        for x in input_set:
            y = sak.dot(x.astype(argument_dtype))
            assert x.shape == y.shape
            assert np.can_cast(y.dtype, result_dtype)
            if x.ndim == 2:
                ya = sak.toarray() @ x.astype(argument_dtype)
                np.array_equal(y, ya)
                assert np.can_cast(ya.dtype, result_dtype)
                ys = sak.tosparse() @ x.astype(argument_dtype)
                np.array_equal(y, ys)
                assert np.can_cast(ys.dtype, result_dtype)

class TestMikotaPair:
    """
    MikotaPair tests
    """
    # both MikotaPair `LinearOperator`s share the same dtype
    # while `MikotaK` `dtype` can be as small as its default `np.int32`
    # since its entries are integers, the `MikotaM` involves inverses
    # so its smallest still accurate `dtype` is `np.float32`
    tested_types = REAL_DTYPES + COMPLEX_DTYPES

    def test_specific_shape(self):
        n = 6
        mik = MikotaPair(n)
        mik_k = mik.k
        mik_m = mik.m
        assert_array_equal(mik_k.toarray(), mik_k(np.eye(n)))
        assert_array_equal(mik_m.toarray(), mik_m(np.eye(n)))

        k = np.array(
            [
                [11, -5,  0,  0,  0,  0],
                [-5,  9, -4,  0,  0,  0],
                [ 0, -4,  7, -3,  0,  0],
                [ 0,  0, -3,  5, -2,  0],
                [ 0,  0,  0, -2,  3, -1],
                [ 0,  0,  0,  0, -1,  1]
            ]
        )
        np.array_equal(k, mik_k.toarray())
        np.array_equal(mik_k.tosparse().toarray(), k)
        kb = np.array(
            [
                [ 0, -5, -4, -3, -2, -1],
                [11,  9,  7,  5,  3,  1]
            ]
        )
        np.array_equal(kb, mik_k.tobanded())

        minv = np.arange(1, n + 1)
        np.array_equal(np.diag(1. / minv), mik_m.toarray())
        np.array_equal(mik_m.tosparse().toarray(), mik_m.toarray())
        np.array_equal(1. / minv, mik_m.tobanded())

        e = np.array([ 1,  4,  9, 16, 25, 36])
        np.array_equal(e, mik.eigenvalues())
        np.array_equal(e[:2], mik.eigenvalues(2))

    @pytest.mark.parametrize('dtype', tested_types)
    def test_linearoperator_shape_dtype(self, dtype):
        n = 7
        mik = MikotaPair(n, dtype=dtype)
        mik_k = mik.k
        mik_m = mik.m
        assert mik_k.shape == (n, n)
        assert mik_k.dtype == dtype
        assert mik_m.shape == (n, n)
        assert mik_m.dtype == dtype
        mik_default_dtype = MikotaPair(n)
        mikd_k = mik_default_dtype.k
        mikd_m = mik_default_dtype.m
        assert mikd_k.shape == (n, n)
        assert mikd_k.dtype == np.float64
        assert mikd_m.shape == (n, n)
        assert mikd_m.dtype == np.float64
        assert_array_equal(mik_k.toarray(),
                           mikd_k.toarray().astype(dtype))
        assert_array_equal(mik_k.tosparse().toarray(),
                           mikd_k.tosparse().toarray().astype(dtype))

    @pytest.mark.parametrize('dtype', tested_types)
    @pytest.mark.parametrize('argument_dtype', ALLDTYPES)
    def test_dot(self, dtype, argument_dtype):
        """ Test the dot-product for type preservation and consistency.
        """
        result_dtype = np.promote_types(argument_dtype, dtype)
        n = 5
        mik = MikotaPair(n, dtype=dtype)
        mik_k = mik.k
        mik_m = mik.m
        x0 = np.arange(n)
        x1 = x0.reshape((-1, 1))
        x2 = np.arange(2 * n).reshape((n, 2))
        lo_set = [mik_k, mik_m]
        input_set = [x0, x1, x2]
        for lo in lo_set:
            for x in input_set:
                y = lo.dot(x.astype(argument_dtype))
                assert x.shape == y.shape
                assert np.can_cast(y.dtype, result_dtype)
                if x.ndim == 2:
                    ya = lo.toarray() @ x.astype(argument_dtype)
                    np.array_equal(y, ya)
                    assert np.can_cast(ya.dtype, result_dtype)
                    ys = lo.tosparse() @ x.astype(argument_dtype)
                    np.array_equal(y, ys)
                    assert np.can_cast(ys.dtype, result_dtype)
