import sys
import threading

import numpy as np
from numpy import array, finfo, arange, eye, all, unique, ones, dot
from numpy.exceptions import ComplexWarning
from numpy.testing import (
        assert_array_almost_equal, assert_almost_equal,
        assert_equal, assert_array_equal, assert_, assert_allclose,
        assert_warns, suppress_warnings)
import pytest
from pytest import raises as assert_raises

import scipy.linalg
from scipy.linalg import norm, inv
from scipy.sparse import (dia_array, SparseEfficiencyWarning, csc_array,
        csr_array, eye_array, issparse, dok_array, lil_array, bsr_array, kron)
from scipy.sparse.linalg import SuperLU
from scipy.sparse.linalg._dsolve import (spsolve, use_solver, splu, spilu,
        MatrixRankWarning, _superlu, spsolve_triangular, factorized,
        is_sptriangular, spbandwidth)
import scipy.sparse

from scipy._lib._testutils import check_free_memory


sup_sparse_efficiency = suppress_warnings()
sup_sparse_efficiency.filter(SparseEfficiencyWarning)

# scikits.umfpack is not a SciPy dependency but it is optionally used in
# dsolve, so check whether it's available
try:
    import scikits.umfpack as umfpack
    has_umfpack = True
except ImportError:
    has_umfpack = False

def toarray(a):
    if issparse(a):
        return a.toarray()
    else:
        return a


def setup_bug_8278():
    N = 2 ** 6
    h = 1/N
    Ah1D = dia_array(([-1, 2, -1], [-1, 0, 1]), shape=(N-1, N-1))/(h**2)
    eyeN = eye_array(N - 1)
    A = (kron(eyeN, kron(eyeN, Ah1D))
         + kron(eyeN, kron(Ah1D, eyeN))
         + kron(Ah1D, kron(eyeN, eyeN)))
    b = np.random.rand((N-1)**3)
    return A, b


class TestFactorized:
    def setup_method(self):
        n = 5
        d = arange(n) + 1
        self.n = n
        self.A = dia_array(((d, 2*d, d[::-1]), (-3, 0, 5)), shape=(n,n)).tocsc()

    def _check_singular(self):
        A = csc_array((5,5), dtype='d')
        b = ones(5)
        assert_array_almost_equal(0. * b, factorized(A)(b))

    def _check_non_singular(self):
        # Make a diagonal dominant, to make sure it is not singular
        n = 5
        rng = np.random.default_rng(14332)
        a = csc_array(rng.random((n, n)))
        b = ones(n)

        expected = splu(a).solve(b)
        assert_array_almost_equal(factorized(a)(b), expected)

    def test_singular_without_umfpack(self):
        use_solver(useUmfpack=False)
        with assert_raises(RuntimeError, match="Factor is exactly singular"):
            self._check_singular()

    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_singular_with_umfpack(self):
        use_solver(useUmfpack=True)
        with suppress_warnings() as sup:
            sup.filter(RuntimeWarning, "divide by zero encountered in double_scalars")
            assert_warns(umfpack.UmfpackWarning, self._check_singular)

    def test_non_singular_without_umfpack(self):
        use_solver(useUmfpack=False)
        self._check_non_singular()

    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_non_singular_with_umfpack(self):
        use_solver(useUmfpack=True)
        self._check_non_singular()

    def test_cannot_factorize_nonsquare_matrix_without_umfpack(self):
        use_solver(useUmfpack=False)
        msg = "can only factor square matrices"
        with assert_raises(ValueError, match=msg):
            factorized(self.A[:, :4])

    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_factorizes_nonsquare_matrix_with_umfpack(self):
        use_solver(useUmfpack=True)
        # does not raise
        factorized(self.A[:,:4])

    def test_call_with_incorrectly_sized_matrix_without_umfpack(self):
        use_solver(useUmfpack=False)
        solve = factorized(self.A)

        rng = np.random.default_rng(230498)
        b = rng.random(4)
        B = rng.random((4, 3))
        BB = rng.random((self.n, 3, 9))

        with assert_raises(ValueError, match="is of incompatible size"):
            solve(b)
        with assert_raises(ValueError, match="is of incompatible size"):
            solve(B)
        with assert_raises(ValueError,
                           match="object too deep for desired array"):
            solve(BB)

    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_call_with_incorrectly_sized_matrix_with_umfpack(self):
        use_solver(useUmfpack=True)
        solve = factorized(self.A)

        rng = np.random.default_rng(643095823)
        b = rng.random(4)
        B = rng.random((4, 3))
        BB = rng.random((self.n, 3, 9))

        # does not raise
        solve(b)
        msg = "object too deep for desired array"
        with assert_raises(ValueError, match=msg):
            solve(B)
        with assert_raises(ValueError, match=msg):
            solve(BB)

    def test_call_with_cast_to_complex_without_umfpack(self):
        use_solver(useUmfpack=False)
        solve = factorized(self.A)
        rng = np.random.default_rng(23454)
        b = rng.random(4)
        for t in [np.complex64, np.complex128]:
            with assert_raises(TypeError, match="Cannot cast array data"):
                solve(b.astype(t))

    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_call_with_cast_to_complex_with_umfpack(self):
        use_solver(useUmfpack=True)
        solve = factorized(self.A)
        rng = np.random.default_rng(23454)
        b = rng.random(4)
        for t in [np.complex64, np.complex128]:
            assert_warns(ComplexWarning, solve, b.astype(t))

    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_assume_sorted_indices_flag(self):
        # a sparse matrix with unsorted indices
        unsorted_inds = np.array([2, 0, 1, 0])
        data = np.array([10, 16, 5, 0.4])
        indptr = np.array([0, 1, 2, 4])
        A = csc_array((data, unsorted_inds, indptr), (3, 3))
        b = ones(3)

        # should raise when incorrectly assuming indices are sorted
        use_solver(useUmfpack=True, assumeSortedIndices=True)
        with assert_raises(RuntimeError,
                           match="UMFPACK_ERROR_invalid_matrix"):
            factorized(A)

        # should sort indices and succeed when not assuming indices are sorted
        use_solver(useUmfpack=True, assumeSortedIndices=False)
        expected = splu(A.copy()).solve(b)

        assert_equal(A.has_sorted_indices, 0)
        assert_array_almost_equal(factorized(A)(b), expected)

    @pytest.mark.slow
    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_bug_8278(self):
        check_free_memory(8000)
        use_solver(useUmfpack=True)
        A, b = setup_bug_8278()
        A = A.tocsc()
        f = factorized(A)
        x = f(b)
        assert_array_almost_equal(A @ x, b)


class TestLinsolve:
    def setup_method(self):
        use_solver(useUmfpack=False)

    def test_singular(self):
        A = csc_array((5,5), dtype='d')
        b = array([1, 2, 3, 4, 5],dtype='d')
        with suppress_warnings() as sup:
            sup.filter(MatrixRankWarning, "Matrix is exactly singular")
            x = spsolve(A, b)
        assert_(not np.isfinite(x).any())

    def test_singular_gh_3312(self):
        # "Bad" test case that leads SuperLU to call LAPACK with invalid
        # arguments. Check that it fails moderately gracefully.
        ij = np.array([(17, 0), (17, 6), (17, 12), (10, 13)], dtype=np.int32)
        v = np.array([0.284213, 0.94933781, 0.15767017, 0.38797296])
        A = csc_array((v, ij.T), shape=(20, 20))
        b = np.arange(20)

        try:
            # should either raise a runtime error or return value
            # appropriate for singular input (which yields the warning)
            with suppress_warnings() as sup:
                sup.filter(MatrixRankWarning, "Matrix is exactly singular")
                x = spsolve(A, b)
            assert not np.isfinite(x).any()
        except RuntimeError:
            pass

    @pytest.mark.parametrize('format', ['csc', 'csr'])
    @pytest.mark.parametrize('idx_dtype', [np.int32, np.int64])
    def test_twodiags(self, format: str, idx_dtype: np.dtype):
        A = dia_array(([[1, 2, 3, 4, 5], [6, 5, 8, 9, 10]], [0, 1]),
                        shape=(5, 5)).asformat(format)
        b = array([1, 2, 3, 4, 5])

        # condition number of A
        cond_A = norm(A.toarray(), 2) * norm(inv(A.toarray()), 2)

        for t in ['f','d','F','D']:
            eps = finfo(t).eps  # floating point epsilon
            b = b.astype(t)
            Asp = A.astype(t)
            Asp.indices = Asp.indices.astype(idx_dtype, copy=False)
            Asp.indptr = Asp.indptr.astype(idx_dtype, copy=False)

            x = spsolve(Asp, b)
            assert_(norm(b - Asp@x) < 10 * cond_A * eps)

    def test_bvector_smoketest(self):
        Adense = array([[0., 1., 1.],
                        [1., 0., 1.],
                        [0., 0., 1.]])
        As = csc_array(Adense)
        rng = np.random.default_rng(1234)
        x = rng.standard_normal(3)
        b = As@x
        x2 = spsolve(As, b)

        assert_array_almost_equal(x, x2)

    def test_bmatrix_smoketest(self):
        Adense = array([[0., 1., 1.],
                        [1., 0., 1.],
                        [0., 0., 1.]])
        As = csc_array(Adense)
        rng = np.random.default_rng(1234)
        x = rng.standard_normal((3, 4))
        Bdense = As.dot(x)
        Bs = csc_array(Bdense)
        x2 = spsolve(As, Bs)
        assert_array_almost_equal(x, x2.toarray())

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_non_square(self):
        # A is not square.
        A = ones((3, 4))
        b = ones((4, 1))
        assert_raises(ValueError, spsolve, A, b)
        # A2 and b2 have incompatible shapes.
        A2 = csc_array(eye(3))
        b2 = array([1.0, 2.0])
        assert_raises(ValueError, spsolve, A2, b2)

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_example_comparison(self):
        row = array([0,0,1,2,2,2])
        col = array([0,2,2,0,1,2])
        data = array([1,2,3,-4,5,6])
        sM = csr_array((data,(row,col)), shape=(3,3), dtype=float)
        M = sM.toarray()

        row = array([0,0,1,1,0,0])
        col = array([0,2,1,1,0,0])
        data = array([1,1,1,1,1,1])
        sN = csr_array((data, (row,col)), shape=(3,3), dtype=float)
        N = sN.toarray()

        sX = spsolve(sM, sN)
        X = scipy.linalg.solve(M, N)

        assert_array_almost_equal(X, sX.toarray())

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_shape_compatibility(self):
        use_solver(useUmfpack=True)
        A = csc_array([[1., 0], [0, 2]])
        bs = [
            [1, 6],
            array([1, 6]),
            [[1], [6]],
            array([[1], [6]]),
            csc_array([[1], [6]]),
            csr_array([[1], [6]]),
            dok_array([[1], [6]]),
            bsr_array([[1], [6]]),
            array([[1., 2., 3.], [6., 8., 10.]]),
            csc_array([[1., 2., 3.], [6., 8., 10.]]),
            csr_array([[1., 2., 3.], [6., 8., 10.]]),
            dok_array([[1., 2., 3.], [6., 8., 10.]]),
            bsr_array([[1., 2., 3.], [6., 8., 10.]]),
            ]

        for b in bs:
            x = np.linalg.solve(A.toarray(), toarray(b))
            for spmattype in [csc_array, csr_array, dok_array, lil_array]:
                x1 = spsolve(spmattype(A), b, use_umfpack=True)
                x2 = spsolve(spmattype(A), b, use_umfpack=False)

                # check solution
                if x.ndim == 2 and x.shape[1] == 1:
                    # interprets also these as "vectors"
                    x = x.ravel()

                assert_array_almost_equal(toarray(x1), x,
                                          err_msg=repr((b, spmattype, 1)))
                assert_array_almost_equal(toarray(x2), x,
                                          err_msg=repr((b, spmattype, 2)))

                # dense vs. sparse output  ("vectors" are always dense)
                if issparse(b) and x.ndim > 1:
                    assert_(issparse(x1), repr((b, spmattype, 1)))
                    assert_(issparse(x2), repr((b, spmattype, 2)))
                else:
                    assert_(isinstance(x1, np.ndarray), repr((b, spmattype, 1)))
                    assert_(isinstance(x2, np.ndarray), repr((b, spmattype, 2)))

                # check output shape
                if x.ndim == 1:
                    # "vector"
                    assert_equal(x1.shape, (A.shape[1],))
                    assert_equal(x2.shape, (A.shape[1],))
                else:
                    # "matrix"
                    assert_equal(x1.shape, x.shape)
                    assert_equal(x2.shape, x.shape)

        A = csc_array((3, 3))
        b = csc_array((1, 3))
        assert_raises(ValueError, spsolve, A, b)

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_ndarray_support(self):
        A = array([[1., 2.], [2., 0.]])
        x = array([[1., 1.], [0.5, -0.5]])
        b = array([[2., 0.], [2., 2.]])

        assert_array_almost_equal(x, spsolve(A, b))

    def test_gssv_badinput(self):
        N = 10
        d = arange(N) + 1.0
        A = dia_array(((d, 2*d, d[::-1]), (-3, 0, 5)), shape=(N, N))

        for container in (csc_array, csr_array):
            A = container(A)
            b = np.arange(N)

            def not_c_contig(x):
                return x.repeat(2)[::2]

            def not_1dim(x):
                return x[:,None]

            def bad_type(x):
                return x.astype(bool)

            def too_short(x):
                return x[:-1]

            badops = [not_c_contig, not_1dim, bad_type, too_short]

            for badop in badops:
                msg = f"{container!r} {badop!r}"
                # Not C-contiguous
                assert_raises((ValueError, TypeError), _superlu.gssv,
                              N, A.nnz, badop(A.data), A.indices, A.indptr,
                              b, int(A.format == 'csc'), err_msg=msg)
                assert_raises((ValueError, TypeError), _superlu.gssv,
                              N, A.nnz, A.data, badop(A.indices), A.indptr,
                              b, int(A.format == 'csc'), err_msg=msg)
                assert_raises((ValueError, TypeError), _superlu.gssv,
                              N, A.nnz, A.data, A.indices, badop(A.indptr),
                              b, int(A.format == 'csc'), err_msg=msg)

    def test_sparsity_preservation(self):
        ident = csc_array([
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]])
        b = csc_array([
            [0, 1],
            [1, 0],
            [0, 0]])
        x = spsolve(ident, b)
        assert_equal(ident.nnz, 3)
        assert_equal(b.nnz, 2)
        assert_equal(x.nnz, 2)
        assert_allclose(x.toarray(), b.toarray(), atol=1e-12, rtol=1e-12)

    def test_dtype_cast(self):
        A_real = scipy.sparse.csr_array([[1, 2, 0],
                                          [0, 0, 3],
                                          [4, 0, 5]])
        A_complex = scipy.sparse.csr_array([[1, 2, 0],
                                             [0, 0, 3],
                                             [4, 0, 5 + 1j]])
        b_real = np.array([1,1,1])
        b_complex = np.array([1,1,1]) + 1j*np.array([1,1,1])
        x = spsolve(A_real, b_real)
        assert_(np.issubdtype(x.dtype, np.floating))
        x = spsolve(A_real, b_complex)
        assert_(np.issubdtype(x.dtype, np.complexfloating))
        x = spsolve(A_complex, b_real)
        assert_(np.issubdtype(x.dtype, np.complexfloating))
        x = spsolve(A_complex, b_complex)
        assert_(np.issubdtype(x.dtype, np.complexfloating))

    @pytest.mark.slow
    @pytest.mark.skipif(not has_umfpack, reason="umfpack not available")
    def test_bug_8278(self):
        check_free_memory(8000)
        use_solver(useUmfpack=True)
        A, b = setup_bug_8278()
        x = spsolve(A, b)
        assert_array_almost_equal(A @ x, b)


class TestSplu:
    def setup_method(self):
        use_solver(useUmfpack=False)
        n = 40
        d = arange(n) + 1
        self.n = n
        self.A = dia_array(((d, 2*d, d[::-1]), (-3, 0, 5)), shape=(n, n)).tocsc()

    def _smoketest(self, spxlu, check, dtype, idx_dtype):
        if np.issubdtype(dtype, np.complexfloating):
            A = self.A + 1j*self.A.T
        else:
            A = self.A

        A = A.astype(dtype)
        A.indices = A.indices.astype(idx_dtype, copy=False)
        A.indptr = A.indptr.astype(idx_dtype, copy=False)
        lu = spxlu(A)

        rng = np.random.RandomState(1234)

        # Input shapes
        for k in [None, 1, 2, self.n, self.n+2]:
            msg = f"k={k!r}"

            if k is None:
                b = rng.rand(self.n)
            else:
                b = rng.rand(self.n, k)

            if np.issubdtype(dtype, np.complexfloating):
                b = b + 1j*rng.rand(*b.shape)
            b = b.astype(dtype)

            x = lu.solve(b)
            check(A, b, x, msg)

            x = lu.solve(b, 'T')
            check(A.T, b, x, msg)

            x = lu.solve(b, 'H')
            check(A.T.conj(), b, x, msg)

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_splu_smoketest(self):
        self._internal_test_splu_smoketest()

    def _internal_test_splu_smoketest(self):
        # Check that splu works at all
        def check(A, b, x, msg=""):
            eps = np.finfo(A.dtype).eps
            r = A @ x
            assert_(abs(r - b).max() < 1e3*eps, msg)

        for dtype in [np.float32, np.float64, np.complex64, np.complex128]:
            for idx_dtype in [np.int32, np.int64]:
                self._smoketest(splu, check, dtype, idx_dtype)

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_spilu_smoketest(self):
        self._internal_test_spilu_smoketest()

    def _internal_test_spilu_smoketest(self):
        errors = []

        def check(A, b, x, msg=""):
            r = A @ x
            err = abs(r - b).max()
            assert_(err < 1e-2, msg)
            if b.dtype in (np.float64, np.complex128):
                errors.append(err)

        for dtype in [np.float32, np.float64, np.complex64, np.complex128]:
            for idx_dtype in [np.int32, np.int64]:
                self._smoketest(spilu, check, dtype, idx_dtype)

        assert_(max(errors) > 1e-5)

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_spilu_drop_rule(self):
        # Test passing in the drop_rule argument to spilu.
        A = eye_array(2)

        rules = [
            b'basic,area'.decode('ascii'),  # unicode
            b'basic,area',  # ascii
            [b'basic', b'area'.decode('ascii')]
        ]
        for rule in rules:
            # Argument should be accepted
            assert_(isinstance(spilu(A, drop_rule=rule), SuperLU))

    def test_splu_nnz0(self):
        A = csc_array((5,5), dtype='d')
        assert_raises(RuntimeError, splu, A)

    def test_spilu_nnz0(self):
        A = csc_array((5,5), dtype='d')
        assert_raises(RuntimeError, spilu, A)

    def test_splu_basic(self):
        # Test basic splu functionality.
        n = 30
        rng = np.random.RandomState(12)
        a = rng.rand(n, n)
        a[a < 0.95] = 0
        # First test with a singular matrix
        a[:, 0] = 0
        a_ = csc_array(a)
        # Matrix is exactly singular
        assert_raises(RuntimeError, splu, a_)

        # Make a diagonal dominant, to make sure it is not singular
        a += 4*eye(n)
        a_ = csc_array(a)
        lu = splu(a_)
        b = ones(n)
        x = lu.solve(b)
        assert_almost_equal(dot(a, x), b)

    def test_splu_perm(self):
        # Test the permutation vectors exposed by splu.
        n = 30
        rng = np.random.default_rng(1342354)
        a = rng.random((n, n))
        a[a < 0.95] = 0
        # Make a diagonal dominant, to make sure it is not singular
        a += 4*eye(n)
        a_ = csc_array(a)
        lu = splu(a_)
        # Check that the permutation indices do belong to [0, n-1].
        for perm in (lu.perm_r, lu.perm_c):
            assert_(all(perm > -1))
            assert_(all(perm < n))
            assert_equal(len(unique(perm)), len(perm))

        # Now make a symmetric, and test that the two permutation vectors are
        # the same
        # Note: a += a.T relies on undefined behavior.
        a = a + a.T
        a_ = csc_array(a)
        lu = splu(a_)
        assert_array_equal(lu.perm_r, lu.perm_c)

    @pytest.mark.parametrize("splu_fun, rtol", [(splu, 1e-7), (spilu, 1e-1)])
    def test_natural_permc(self, splu_fun, rtol):
        # Test that the "NATURAL" permc_spec does not permute the matrix
        rng = np.random.RandomState(42)
        n = 500
        p = 0.01
        A = scipy.sparse.random(n, n, p, random_state=rng)
        x = rng.rand(n)
        # Make A diagonal dominant to make sure it is not singular
        A += (n+1)*scipy.sparse.eye_array(n)
        A_ = csc_array(A)
        b = A_ @ x

        # without permc_spec, permutation is not identity
        lu = splu_fun(A_)
        assert_(np.any(lu.perm_c != np.arange(n)))

        # with permc_spec="NATURAL", permutation is identity
        lu = splu_fun(A_, permc_spec="NATURAL")
        assert_array_equal(lu.perm_c, np.arange(n))

        # Also, lu decomposition is valid
        x2 = lu.solve(b)
        assert_allclose(x, x2, rtol=rtol)

    @pytest.mark.skipif(not hasattr(sys, 'getrefcount'), reason="no sys.getrefcount")
    def test_lu_refcount(self):
        # Test that we are keeping track of the reference count with splu.
        n = 30
        rng = np.random.default_rng(1342354)
        a = rng.random((n, n))
        a[a < 0.95] = 0
        # Make a diagonal dominant, to make sure it is not singular
        a += 4*eye(n)
        a_ = csc_array(a)
        lu = splu(a_)

        # And now test that we don't have a refcount bug
        rc = sys.getrefcount(lu)
        for attr in ('perm_r', 'perm_c'):
            perm = getattr(lu, attr)
            assert_equal(sys.getrefcount(lu), rc + 1)
            del perm
            assert_equal(sys.getrefcount(lu), rc)

    def test_bad_inputs(self):
        A = self.A.tocsc()
        rng = np.random.default_rng(235634)

        assert_raises(ValueError, splu, A[:,:4])
        assert_raises(ValueError, spilu, A[:,:4])

        for lu in [splu(A), spilu(A)]:
            b = rng.random(42)
            B = rng.random((42, 3))
            BB = rng.random((self.n, 3, 9))
            assert_raises(ValueError, lu.solve, b)
            assert_raises(ValueError, lu.solve, B)
            assert_raises(ValueError, lu.solve, BB)
            assert_raises(TypeError, lu.solve,
                          b.astype(np.complex64))
            assert_raises(TypeError, lu.solve,
                          b.astype(np.complex128))

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_superlu_dlamch_i386_nan(self):
        # SuperLU 4.3 calls some functions returning floats without
        # declaring them. On i386@linux call convention, this fails to
        # clear floating point registers after call. As a result, NaN
        # can appear in the next floating point operation made.
        #
        # Here's a test case that triggered the issue.
        n = 8
        d = np.arange(n) + 1
        A = dia_array(((d, 2*d, d[::-1]), (-3, 0, 5)), shape=(n, n))
        A = A.astype(np.float32)
        spilu(A)
        A = A + 1j*A
        B = A.toarray()
        assert_(not np.isnan(B).any())

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_lu_attr(self):

        def check(dtype, complex_2=False):
            A = self.A.astype(dtype)

            if complex_2:
                A = A + 1j*A.T

            n = A.shape[0]
            lu = splu(A)

            # Check that the decomposition is as advertised

            Pc = np.zeros((n, n))
            Pc[np.arange(n), lu.perm_c] = 1

            Pr = np.zeros((n, n))
            Pr[lu.perm_r, np.arange(n)] = 1

            Ad = A.toarray()
            lhs = Pr.dot(Ad).dot(Pc)
            rhs = (lu.L @ lu.U).toarray()

            eps = np.finfo(dtype).eps

            assert_allclose(lhs, rhs, atol=100*eps)

        check(np.float32)
        check(np.float64)
        check(np.complex64)
        check(np.complex128)
        check(np.complex64, True)
        check(np.complex128, True)

    @pytest.mark.thread_unsafe
    @pytest.mark.slow
    @sup_sparse_efficiency
    def test_threads_parallel(self):
        oks = []

        def worker():
            try:
                self.test_splu_basic()
                self._internal_test_splu_smoketest()
                self._internal_test_spilu_smoketest()
                oks.append(True)
            except Exception:
                pass

        threads = [threading.Thread(target=worker)
                   for k in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert_equal(len(oks), 20)

    @pytest.mark.thread_unsafe
    def test_singular_matrix(self):
        # Test that SuperLU does not print to stdout when a singular matrix is
        # passed. See gh-20993.
        A = eye_array(10, format='csr')
        A[-1, -1] = 0
        b = np.zeros(10)
        with pytest.warns(MatrixRankWarning):
            res = spsolve(A, b)
            assert np.isnan(res).all()


class TestGstrsErrors:
    def setup_method(self):
      self.A = array([[1.0,2.0,3.0],[4.0,5.0,6.0],[7.0,8.0,9.0]], dtype=np.float64)
      self.b = np.array([[1.0],[2.0],[3.0]], dtype=np.float64)

    def test_trans(self):
        L = scipy.sparse.tril(self.A, format='csc')
        U = scipy.sparse.triu(self.A, k=1, format='csc')
        with assert_raises(ValueError, match="trans must be N, T, or H"):
            _superlu.gstrs('X', L.shape[0], L.nnz, L.data, L.indices, L.indptr,
                                U.shape[0], U.nnz, U.data, U.indices, U.indptr, self.b)

    def test_shape_LU(self):
        L = scipy.sparse.tril(self.A[0:2,0:2], format='csc')
        U = scipy.sparse.triu(self.A, k=1, format='csc')
        with assert_raises(ValueError, match="L and U must have the same dimension"):
            _superlu.gstrs('N', L.shape[0], L.nnz, L.data, L.indices, L.indptr,
                                U.shape[0], U.nnz, U.data, U.indices, U.indptr, self.b)

    def test_shape_b(self):
        L = scipy.sparse.tril(self.A, format='csc')
        U = scipy.sparse.triu(self.A, k=1, format='csc')
        with assert_raises(ValueError, match="right hand side array has invalid shape"):
            _superlu.gstrs('N', L.shape[0], L.nnz, L.data, L.indices, L.indptr,
                                U.shape[0], U.nnz, U.data, U.indices, U.indptr,
                                self.b[0:2])

    def test_types_differ(self):
        L = scipy.sparse.tril(self.A.astype(np.float32), format='csc')
        U = scipy.sparse.triu(self.A, k=1, format='csc')
        with assert_raises(TypeError, match="nzvals types of L and U differ"):
            _superlu.gstrs('N', L.shape[0], L.nnz, L.data, L.indices, L.indptr,
                                U.shape[0], U.nnz, U.data, U.indices, U.indptr, self.b)

    def test_types_unsupported(self):
        L = scipy.sparse.tril(self.A.astype(np.uint8), format='csc')
        U = scipy.sparse.triu(self.A.astype(np.uint8), k=1, format='csc')
        with assert_raises(TypeError, match="nzvals is not of a type supported"):
            _superlu.gstrs('N', L.shape[0], L.nnz, L.data, L.indices, L.indptr,
                                U.shape[0], U.nnz, U.data, U.indices, U.indptr,
                                self.b.astype(np.uint8))

class TestSpsolveTriangular:
    def setup_method(self):
        use_solver(useUmfpack=False)

    @pytest.mark.parametrize("fmt",["csr","csc"])
    def test_zero_diagonal(self,fmt):
        n = 5
        rng = np.random.default_rng(43876432987)
        A = rng.standard_normal((n, n))
        b = np.arange(n)
        A = scipy.sparse.tril(A, k=0, format=fmt)

        x = spsolve_triangular(A, b, unit_diagonal=True, lower=True)

        A.setdiag(1)
        assert_allclose(A.dot(x), b)

        # Regression test from gh-15199
        A = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0]], dtype=np.float64)
        b = np.array([1., 2., 3.])
        with suppress_warnings() as sup:
            sup.filter(SparseEfficiencyWarning, "CSC or CSR matrix format is")
            spsolve_triangular(A, b, unit_diagonal=True)

    @pytest.mark.parametrize("fmt",["csr","csc"])
    def test_singular(self,fmt):
        n = 5
        if fmt == "csr":
            A = csr_array((n, n))
        else:
            A = csc_array((n, n))
        b = np.arange(n)
        for lower in (True, False):
            assert_raises(scipy.linalg.LinAlgError,
                          spsolve_triangular, A, b, lower=lower)

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_bad_shape(self):
        # A is not square.
        A = np.zeros((3, 4))
        b = ones((4, 1))
        assert_raises(ValueError, spsolve_triangular, A, b)
        # A2 and b2 have incompatible shapes.
        A2 = csr_array(eye(3))
        b2 = array([1.0, 2.0])
        assert_raises(ValueError, spsolve_triangular, A2, b2)

    @pytest.mark.thread_unsafe
    @sup_sparse_efficiency
    def test_input_types(self):
        A = array([[1., 0.], [1., 2.]])
        b = array([[2., 0.], [2., 2.]])
        for matrix_type in (array, csc_array, csr_array):
            x = spsolve_triangular(matrix_type(A), b, lower=True)
            assert_array_almost_equal(A.dot(x), b)

    @pytest.mark.thread_unsafe
    @pytest.mark.slow
    @sup_sparse_efficiency
    @pytest.mark.parametrize("n", [10, 10**2, 10**3])
    @pytest.mark.parametrize("m", [1, 10])
    @pytest.mark.parametrize("lower", [True, False])
    @pytest.mark.parametrize("format", ["csr", "csc"])
    @pytest.mark.parametrize("unit_diagonal", [False, True])
    @pytest.mark.parametrize("choice_of_A", ["real", "complex"])
    @pytest.mark.parametrize("choice_of_b", ["floats", "ints", "complexints"])
    def test_random(self, n, m, lower, format, unit_diagonal, choice_of_A, choice_of_b):
        def random_triangle_matrix(n, lower=True, format="csr", choice_of_A="real"):
            if choice_of_A == "real":
                dtype = np.float64
            elif choice_of_A == "complex":
                dtype = np.complex128
            else:
                raise ValueError("choice_of_A must be 'real' or 'complex'.")
            rng = np.random.default_rng(789002319)
            rvs = rng.random
            A = scipy.sparse.random(n, n, density=0.1, format='lil', dtype=dtype,
                    random_state=rng, data_rvs=rvs)
            if lower:
                A = scipy.sparse.tril(A, format="lil")
            else:
                A = scipy.sparse.triu(A, format="lil")
            for i in range(n):
                A[i, i] = np.random.rand() + 1
            if format == "csc":
                A = A.tocsc(copy=False)
            else:
                A = A.tocsr(copy=False)
            return A

        rng = np.random.default_rng(1234)
        A = random_triangle_matrix(n, lower=lower)
        if choice_of_b == "floats":
            b = rng.random((n, m))
        elif choice_of_b == "ints":
            b = rng.integers(-9, 9, (n, m))
        elif choice_of_b == "complexints":
            b = rng.integers(-9, 9, (n, m)) + rng.integers(-9, 9, (n, m)) * 1j
        else:
            raise ValueError(
                "choice_of_b must be 'floats', 'ints', or 'complexints'.")
        x = spsolve_triangular(A, b, lower=lower, unit_diagonal=unit_diagonal)
        if unit_diagonal:
            A.setdiag(1)
        assert_allclose(A.dot(x), b, atol=1.5e-6)


@pytest.mark.thread_unsafe
@sup_sparse_efficiency
@pytest.mark.parametrize("nnz", [10, 10**2, 10**3])
@pytest.mark.parametrize("fmt", ["csr", "csc", "coo", "dia", "dok", "lil"])
def test_is_sptriangular_and_spbandwidth(nnz, fmt):
    rng = np.random.default_rng(42)

    N = nnz // 2
    dens = 0.1
    A = scipy.sparse.random_array((N, N), density=dens, format="csr", rng=rng)
    A[1, 3] = A[3, 1] = 22  # ensure not upper or lower
    A = A.asformat(fmt)
    AU = scipy.sparse.triu(A, format=fmt)
    AL = scipy.sparse.tril(A, format=fmt)
    D = 0.1 * scipy.sparse.eye_array(N, format=fmt)

    assert is_sptriangular(A) == (False, False)
    assert is_sptriangular(AL) == (True, False)
    assert is_sptriangular(AU) == (False, True)
    assert is_sptriangular(D) == (True, True)

    assert spbandwidth(A) == scipy.linalg.bandwidth(A.toarray())
    assert spbandwidth(AU) == scipy.linalg.bandwidth(AU.toarray())
    assert spbandwidth(AL) == scipy.linalg.bandwidth(AL.toarray())
    assert spbandwidth(D) == scipy.linalg.bandwidth(D.toarray())
