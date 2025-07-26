"""Test of 1D arithmetic operations"""

import pytest

import numpy as np
from numpy.testing import assert_equal, assert_allclose

from scipy.sparse import coo_array, csr_array
from scipy.sparse._sputils import isscalarlike


spcreators = [coo_array, csr_array]
math_dtypes = [np.int64, np.float64, np.complex128]


def toarray(a):
    if isinstance(a, np.ndarray) or isscalarlike(a):
        return a
    return a.toarray()

@pytest.fixture
def dat1d():
    return np.array([3, 0, 1, 0], 'd')


@pytest.fixture
def datsp_math_dtypes(dat1d):
    dat_dtypes = {dtype: dat1d.astype(dtype) for dtype in math_dtypes}
    return {
        sp: [(dtype, dat, sp(dat)) for dtype, dat in dat_dtypes.items()]
        for sp in spcreators
    }


@pytest.mark.parametrize("spcreator", spcreators)
class TestArithmetic1D:
    def test_empty_arithmetic(self, spcreator):
        shape = (5,)
        for mytype in [
            np.dtype('int32'),
            np.dtype('float32'),
            np.dtype('float64'),
            np.dtype('complex64'),
            np.dtype('complex128'),
        ]:
            a = spcreator(shape, dtype=mytype)
            b = a + a
            c = 2 * a
            assert isinstance(a @ a.tocsr(), np.ndarray)
            assert isinstance(a @ a.tocoo(), np.ndarray)
            for m in [a, b, c]:
                assert m @ m == a.toarray() @ a.toarray()
                assert m.dtype == mytype
                assert toarray(m).dtype == mytype

    def test_abs(self, spcreator):
        A = np.array([-1, 0, 17, 0, -5, 0, 1, -4, 0, 0, 0, 0], 'd')
        assert_equal(abs(A), abs(spcreator(A)).toarray())

    def test_round(self, spcreator):
        A = np.array([-1.35, 0.56, 17.25, -5.98], 'd')
        Asp = spcreator(A)
        assert_equal(np.around(A, decimals=1), round(Asp, ndigits=1).toarray())

    def test_elementwise_power(self, spcreator):
        A = np.array([-4, -3, -2, -1, 0, 1, 2, 3, 4], 'd')
        Asp = spcreator(A)
        assert_equal(np.power(A, 2), Asp.power(2).toarray())

        # element-wise power function needs a scalar power
        with pytest.raises(NotImplementedError, match='input is not scalar'):
            spcreator(A).power(A)

    def test_real(self, spcreator):
        D = np.array([1 + 3j, 2 - 4j])
        A = spcreator(D)
        assert_equal(A.real.toarray(), D.real)

    def test_imag(self, spcreator):
        D = np.array([1 + 3j, 2 - 4j])
        A = spcreator(D)
        assert_equal(A.imag.toarray(), D.imag)

    def test_mul_scalar(self, spcreator, datsp_math_dtypes):
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            assert_equal(dat * 2, (datsp * 2).toarray())
            assert_equal(dat * 17.3, (datsp * 17.3).toarray())

    def test_rmul_scalar(self, spcreator, datsp_math_dtypes):
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            assert_equal(2 * dat, (2 * datsp).toarray())
            assert_equal(17.3 * dat, (17.3 * datsp).toarray())

    def test_sub(self, spcreator, datsp_math_dtypes):
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            if dtype == np.dtype('bool'):
                # boolean array subtraction deprecated in 1.9.0
                continue

            assert_equal((datsp - datsp).toarray(), np.zeros(4))
            assert_equal((datsp - 0).toarray(), dat)

            A = spcreator([1, -4, 0, 2], dtype='d')
            assert_equal((datsp - A).toarray(), dat - A.toarray())
            assert_equal((A - datsp).toarray(), A.toarray() - dat)

            # test broadcasting
            assert_equal(datsp.toarray() - dat[0], dat - dat[0])

    def test_add0(self, spcreator, datsp_math_dtypes):
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            # Adding 0 to a sparse matrix
            assert_equal((datsp + 0).toarray(), dat)
            # use sum (which takes 0 as a starting value)
            sumS = sum([k * datsp for k in range(1, 3)])
            sumD = sum([k * dat for k in range(1, 3)])
            assert_allclose(sumS.toarray(), sumD)

    def test_elementwise_multiply(self, spcreator):
        # real/real
        A = np.array([4, 0, 9])
        B = np.array([0, 7, -1])
        Asp = spcreator(A)
        Bsp = spcreator(B)
        assert_allclose(Asp.multiply(Bsp).toarray(), A * B)  # sparse/sparse
        assert_allclose(Asp.multiply(B).toarray(), A * B)  # sparse/dense

        # complex/complex
        C = np.array([1 - 2j, 0 + 5j, -1 + 0j])
        D = np.array([5 + 2j, 7 - 3j, -2 + 1j])
        Csp = spcreator(C)
        Dsp = spcreator(D)
        assert_allclose(Csp.multiply(Dsp).toarray(), C * D)  # sparse/sparse
        assert_allclose(Csp.multiply(D).toarray(), C * D)  # sparse/dense

        # real/complex
        assert_allclose(Asp.multiply(Dsp).toarray(), A * D)  # sparse/sparse
        assert_allclose(Asp.multiply(D).toarray(), A * D)  # sparse/dense

    def test_elementwise_multiply_broadcast(self, spcreator):
        A = np.array([4])
        B = np.array([[-9]])
        C = np.array([1, -1, 0])
        D = np.array([[7, 9, -9]])
        E = np.array([[3], [2], [1]])
        F = np.array([[8, 6, 3], [-4, 3, 2], [6, 6, 6]])
        G = [1, 2, 3]
        H = np.ones((3, 4))
        J = H.T
        K = np.array([[0]])
        L = np.array([[[1, 2], [0, 1]]])

        # Some arrays can't be cast as spmatrices (A, C, L) so leave
        # them out.
        Asp = spcreator(A)
        Csp = spcreator(C)
        Gsp = spcreator(G)
        # 2d arrays
        Bsp = spcreator(B)
        Dsp = spcreator(D)
        Esp = spcreator(E)
        Fsp = spcreator(F)
        Hsp = spcreator(H)
        Hspp = spcreator(H[0, None])
        Jsp = spcreator(J)
        Jspp = spcreator(J[:, 0, None])
        Ksp = spcreator(K)

        matrices = [A, B, C, D, E, F, G, H, J, K, L]
        spmatrices = [Asp, Bsp, Csp, Dsp, Esp, Fsp, Gsp, Hsp, Hspp, Jsp, Jspp, Ksp]
        sp1dmatrices = [Asp, Csp, Gsp]

        # sparse/sparse
        for i in sp1dmatrices:
            for j in spmatrices:
                try:
                    dense_mult = i.toarray() * j.toarray()
                except ValueError:
                    with pytest.raises(ValueError, match='inconsistent shapes'):
                        i.multiply(j)
                    continue
                sp_mult = i.multiply(j)
                assert_allclose(sp_mult.toarray(), dense_mult)

        # sparse/dense
        for i in sp1dmatrices:
            for j in matrices:
                try:
                    dense_mult = i.toarray() * j
                except TypeError:
                    continue
                except ValueError:
                    matchme = 'broadcast together|inconsistent shapes'
                    with pytest.raises(ValueError, match=matchme):
                        i.multiply(j)
                    continue
                try:
                    sp_mult = i.multiply(j)
                except ValueError:
                    continue
                assert_allclose(toarray(sp_mult), dense_mult)

    def test_elementwise_divide(self, spcreator, dat1d):
        datsp = spcreator(dat1d)
        expected = np.array([1, np.nan, 1, np.nan])
        actual = datsp / datsp
        # need assert_array_equal to handle nan values
        np.testing.assert_array_equal(actual, expected)

        denom = spcreator([1, 0, 0, 4], dtype='d')
        expected = [3, np.nan, np.inf, 0]
        np.testing.assert_array_equal(datsp / denom, expected)

        # complex
        A = np.array([1 - 2j, 0 + 5j, -1 + 0j])
        B = np.array([5 + 2j, 7 - 3j, -2 + 1j])
        Asp = spcreator(A)
        Bsp = spcreator(B)
        assert_allclose(Asp / Bsp, A / B)

        # integer
        A = np.array([1, 2, 3])
        B = np.array([0, 1, 2])
        Asp = spcreator(A)
        Bsp = spcreator(B)
        with np.errstate(divide='ignore'):
            assert_equal(Asp / Bsp, A / B)

        # mismatching sparsity patterns
        A = np.array([0, 1])
        B = np.array([1, 0])
        Asp = spcreator(A)
        Bsp = spcreator(B)
        with np.errstate(divide='ignore', invalid='ignore'):
            assert_equal(Asp / Bsp, A / B)

    def test_pow(self, spcreator):
        A = np.array([1, 0, 2, 0])
        B = spcreator(A)

        # unusual exponents
        with pytest.raises(ValueError, match='negative integer powers'):
            B**-1
        with pytest.raises(NotImplementedError, match='zero power'):
            B**0

        for exponent in [1, 2, 3, 2.2]:
            ret_sp = B**exponent
            ret_np = A**exponent
            assert_equal(ret_sp.toarray(), ret_np)
            assert_equal(ret_sp.dtype, ret_np.dtype)

    def test_dot_scalar(self, spcreator, dat1d):
        A = spcreator(dat1d)
        scalar = 10
        actual = A.dot(scalar)
        expected = A * scalar

        assert_allclose(actual.toarray(), expected.toarray())

    def test_matmul(self, spcreator):
        Msp = spcreator([2, 0, 3.0])
        B = spcreator(np.array([[0, 1], [1, 0], [0, 2]], 'd'))
        col = np.array([[1, 2, 3]]).T

        # check sparse @ dense 2d column
        assert_allclose(Msp @ col, Msp.toarray() @ col)

        # check sparse1d @ sparse2d, sparse1d @ dense2d, dense1d @ sparse2d
        assert_allclose((Msp @ B).toarray(), (Msp @ B).toarray())
        assert_allclose(Msp.toarray() @ B, (Msp @ B).toarray())
        assert_allclose(Msp @ B.toarray(), (Msp @ B).toarray())

        # check sparse1d @ dense1d, sparse1d @ sparse1d
        V = np.array([0, 0, 1])
        assert_allclose(Msp @ V, Msp.toarray() @ V)

        Vsp = spcreator(V)
        Msp_Vsp = Msp @ Vsp
        assert isinstance(Msp_Vsp, np.ndarray)
        assert Msp_Vsp.shape == ()

        # output is 0-dim ndarray
        assert_allclose(np.array(3), Msp_Vsp)
        assert_allclose(np.array(3), Msp.toarray() @ Vsp)
        assert_allclose(np.array(3), Msp @ Vsp.toarray())
        assert_allclose(np.array(3), Msp.toarray() @ Vsp.toarray())

        # check error on matrix-scalar
        with pytest.raises(ValueError, match='Scalar operands are not allowed'):
            Msp @ 1
        with pytest.raises(ValueError, match='Scalar operands are not allowed'):
            1 @ Msp

    def test_sub_dense(self, spcreator, datsp_math_dtypes):
        # subtracting a dense matrix to/from a sparse matrix
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            if dtype == np.dtype('bool'):
                # boolean array subtraction deprecated in 1.9.0
                continue

            # Manually add to avoid upcasting from scalar
            # multiplication.
            sum1 = (dat + dat + dat) - datsp
            assert_equal(sum1, dat + dat)
            sum2 = (datsp + datsp + datsp) - dat
            assert_equal(sum2, dat + dat)

    def test_size_zero_matrix_arithmetic(self, spcreator):
        # Test basic matrix arithmetic with shapes like 0, (1, 0), (0, 3), etc.
        mat = np.array([])
        a = mat.reshape(0)
        d = mat.reshape((1, 0))
        f = np.ones([5, 5])

        asp = spcreator(a)
        dsp = spcreator(d)
        # bad shape for addition
        with pytest.raises(ValueError, match='inconsistent shapes'):
            asp.__add__(dsp)

        # matrix product.
        assert_equal(asp.dot(asp), np.dot(a, a))

        # bad matrix products
        with pytest.raises(ValueError, match='dimension mismatch|shapes.*not aligned'):
            asp.dot(f)

        # elemente-wise multiplication
        assert_equal(asp.multiply(asp).toarray(), np.multiply(a, a))

        assert_equal(asp.multiply(a).toarray(), np.multiply(a, a))

        assert_equal(asp.multiply(6).toarray(), np.multiply(a, 6))

        # bad element-wise multiplication
        with pytest.raises(ValueError, match='inconsistent shapes'):
            asp.multiply(f)

        # Addition
        assert_equal(asp.__add__(asp).toarray(), a.__add__(a))
