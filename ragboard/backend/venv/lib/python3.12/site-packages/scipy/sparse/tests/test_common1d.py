"""Test of 1D aspects of sparse array classes"""

import pytest

import numpy as np
from numpy.testing import assert_equal, assert_allclose
from numpy.exceptions import ComplexWarning

from scipy.sparse import (
        bsr_array, csc_array, dia_array, lil_array,
        coo_array, csr_array, dok_array,
    )
from scipy.sparse._sputils import supported_dtypes, matrix


sup_complex = np.testing.suppress_warnings()
sup_complex.filter(ComplexWarning)


spcreators = [coo_array, csr_array, dok_array]
math_dtypes = [np.int64, np.float64, np.complex128]


@pytest.fixture
def dat1d():
    return np.array([3, 0, 1, 0], 'd')


@pytest.fixture
def datsp_math_dtypes(dat1d):
    dat_dtypes = {dtype: dat1d.astype(dtype) for dtype in math_dtypes}
    return {
        spcreator: [(dtype, dat, spcreator(dat)) for dtype, dat in dat_dtypes.items()]
        for spcreator in spcreators
    }


# Test init with 1D dense input
# sparrays which do not plan to support 1D
@pytest.mark.parametrize("spcreator", [bsr_array, csc_array, dia_array, lil_array])
def test_no_1d_support_in_init(spcreator):
    with pytest.raises(ValueError, match="arrays don't support 1D input"):
        spcreator([0, 1, 2, 3])


# Test init with nD dense input
# sparrays which do not yet support nD
@pytest.mark.parametrize(
    "spcreator", [csr_array, dok_array, bsr_array, csc_array, dia_array, lil_array]
)
def test_no_nd_support_in_init(spcreator):
    with pytest.raises(ValueError, match="arrays don't.*support 3D"):
        spcreator(np.ones((3, 2, 4)))


# Main tests class
@pytest.mark.parametrize("spcreator", spcreators)
class TestCommon1D:
    """test common functionality shared by 1D sparse formats"""

    def test_create_empty(self, spcreator):
        assert_equal(spcreator((3,)).toarray(), np.zeros(3))
        assert_equal(spcreator((3,)).nnz, 0)
        assert_equal(spcreator((3,)).count_nonzero(), 0)

    def test_invalid_shapes(self, spcreator):
        with pytest.raises(ValueError, match='elements cannot be negative'):
            spcreator((-3,))

    def test_repr(self, spcreator, dat1d):
        repr(spcreator(dat1d))

    def test_str(self, spcreator, dat1d):
        str(spcreator(dat1d))

    def test_neg(self, spcreator):
        A = np.array([-1, 0, 17, 0, -5, 0, 1, -4, 0, 0, 0, 0], 'd')
        assert_equal(-A, (-spcreator(A)).toarray())

    def test_1d_supported_init(self, spcreator):
        A = spcreator([0, 1, 2, 3])
        assert A.ndim == 1

    def test_reshape_1d_tofrom_row_or_column(self, spcreator):
        # add a dimension 1d->2d
        x = spcreator([1, 0, 7, 0, 0, 0, 0, -3, 0, 0, 0, 5])
        y = x.reshape(1, 12)
        desired = [[1, 0, 7, 0, 0, 0, 0, -3, 0, 0, 0, 5]]
        assert_equal(y.toarray(), desired)

        # remove a size-1 dimension 2d->1d
        x = spcreator(desired)
        y = x.reshape(12)
        assert_equal(y.toarray(), desired[0])
        y2 = x.reshape((12,))
        assert y.shape == y2.shape

        # make a 2d column into 1d. 2d->1d
        y = x.T.reshape(12)
        assert_equal(y.toarray(), desired[0])

    def test_reshape(self, spcreator):
        x = spcreator([1, 0, 7, 0, 0, 0, 0, -3, 0, 0, 0, 5])
        y = x.reshape((4, 3))
        desired = [[1, 0, 7], [0, 0, 0], [0, -3, 0], [0, 0, 5]]
        assert_equal(y.toarray(), desired)

        y = x.reshape((12,))
        assert y is x

        y = x.reshape(12)
        assert_equal(y.toarray(), x.toarray())

    def test_sum(self, spcreator):
        np.random.seed(1234)
        dat_1 = np.array([0, 1, 2, 3, -4, 5, -6, 7, 9])
        dat_2 = np.random.rand(5)
        dat_3 = np.array([])
        dat_4 = np.zeros((40,))
        arrays = [dat_1, dat_2, dat_3, dat_4]

        for dat in arrays:
            datsp = spcreator(dat)
            with np.errstate(over='ignore'):
                assert np.isscalar(datsp.sum())
                assert_allclose(dat.sum(), datsp.sum())
                assert_allclose(dat.sum(axis=None), datsp.sum(axis=None))
                assert_allclose(dat.sum(axis=0), datsp.sum(axis=0))
                assert_allclose(dat.sum(axis=-1), datsp.sum(axis=-1))

        # test `out` parameter
        datsp.sum(axis=0, out=np.zeros(()))

    def test_sum_invalid_params(self, spcreator):
        out = np.zeros((3,))  # wrong size for out
        dat = np.array([0, 1, 2])
        datsp = spcreator(dat)

        with pytest.raises(ValueError, match='axis out of range'):
            datsp.sum(axis=1)
        with pytest.raises(ValueError, match='axis out of range'):
            datsp.sum(axis=(0, 3))
        with pytest.raises(TypeError, match='axis must be an integer'):
            datsp.sum(axis=1.5)
        with pytest.raises(ValueError, match='output parameter.*wrong.*dimension'):
            datsp.sum(axis=0, out=out)

    def test_numpy_sum(self, spcreator):
        dat = np.array([0, 1, 2])
        datsp = spcreator(dat)

        dat_sum = np.sum(dat)
        datsp_sum = np.sum(datsp)

        assert_allclose(dat_sum, datsp_sum)

    def test_mean(self, spcreator):
        dat = np.array([0, 1, 2])
        datsp = spcreator(dat)

        assert_allclose(dat.mean(), datsp.mean())
        assert np.isscalar(datsp.mean(axis=None))
        assert_allclose(dat.mean(axis=None), datsp.mean(axis=None))
        assert_allclose(dat.mean(axis=0), datsp.mean(axis=0))
        assert_allclose(dat.mean(axis=-1), datsp.mean(axis=-1))

        with pytest.raises(ValueError, match='axis'):
            datsp.mean(axis=1)
        with pytest.raises(ValueError, match='axis'):
            datsp.mean(axis=-2)

    def test_mean_invalid_params(self, spcreator):
        out = np.asarray(np.zeros((1, 3)))
        dat = np.array([[0, 1, 2], [3, -4, 5], [-6, 7, 9]])

        datsp = spcreator(dat)
        with pytest.raises(ValueError, match='axis out of range'):
            datsp.mean(axis=3)
        with pytest.raises(ValueError, match='axis out of range'):
            datsp.mean(axis=(0, 3))
        with pytest.raises(TypeError, match='axis must be an integer'):
            datsp.mean(axis=1.5)
        with pytest.raises(ValueError, match='out.*not match shape'):
            datsp.mean(axis=1, out=out)

    def test_sum_dtype(self, spcreator):
        dat = np.array([0, 1, 2])
        datsp = spcreator(dat)

        for dtype in supported_dtypes:
            dat_sum = dat.sum(dtype=dtype)
            datsp_sum = datsp.sum(dtype=dtype)

            assert_allclose(dat_sum, datsp_sum)
            assert_equal(dat_sum.dtype, datsp_sum.dtype)

    def test_mean_dtype(self, spcreator):
        dat = np.array([0, 1, 2])
        datsp = spcreator(dat)

        for dtype in supported_dtypes:
            dat_mean = dat.mean(dtype=dtype)
            datsp_mean = datsp.mean(dtype=dtype)

            assert_allclose(dat_mean, datsp_mean)
            assert_equal(dat_mean.dtype, datsp_mean.dtype)

    def test_mean_out(self, spcreator):
        dat = np.array([0, 1, 2])
        datsp = spcreator(dat)

        dat_out = np.array(0)
        datsp_out = np.array(0)

        dat.mean(out=dat_out)
        datsp.mean(out=datsp_out)
        assert_allclose(dat_out, datsp_out)

        dat.mean(axis=0, out=dat_out)
        datsp.mean(axis=0, out=datsp_out)
        assert_allclose(dat_out, datsp_out)

        with pytest.raises(ValueError, match="output parameter.*dimension"):
            datsp.mean(out=np.array([0]))
        with pytest.raises(ValueError, match="output parameter.*dimension"):
            datsp.mean(out=np.array([[0]]))

    def test_numpy_mean(self, spcreator):
        dat = np.array([0, 1, 2])
        datsp = spcreator(dat)

        dat_mean = np.mean(dat)
        datsp_mean = np.mean(datsp)

        assert_allclose(dat_mean, datsp_mean)
        assert_equal(dat_mean.dtype, datsp_mean.dtype)

    @pytest.mark.thread_unsafe
    @sup_complex
    def test_from_array(self, spcreator):
        A = np.array([2, 3, 4])
        assert_equal(spcreator(A).toarray(), A)

        A = np.array([1.0 + 3j, 0, -1])
        assert_equal(spcreator(A).toarray(), A)
        assert_equal(spcreator(A, dtype='int16').toarray(), A.astype('int16'))

    @pytest.mark.thread_unsafe
    @sup_complex
    def test_from_list(self, spcreator):
        A = [2, 3, 4]
        assert_equal(spcreator(A).toarray(), A)

        A = [1.0 + 3j, 0, -1]
        assert_equal(spcreator(A).toarray(), np.array(A))
        assert_equal(
            spcreator(A, dtype='int16').toarray(), np.array(A).astype('int16')
        )

    @pytest.mark.thread_unsafe
    @sup_complex
    def test_from_sparse(self, spcreator):
        D = np.array([1, 0, 0])
        S = coo_array(D)
        assert_equal(spcreator(S).toarray(), D)
        S = spcreator(D)
        assert_equal(spcreator(S).toarray(), D)

        D = np.array([1.0 + 3j, 0, -1])
        S = coo_array(D)
        assert_equal(spcreator(S).toarray(), D)
        assert_equal(spcreator(S, dtype='int16').toarray(), D.astype('int16'))
        S = spcreator(D)
        assert_equal(spcreator(S).toarray(), D)
        assert_equal(spcreator(S, dtype='int16').toarray(), D.astype('int16'))

    def test_toarray(self, spcreator, dat1d):
        datsp = spcreator(dat1d)
        # Check C- or F-contiguous (default).
        chk = datsp.toarray()
        assert_equal(chk, dat1d)
        assert chk.flags.c_contiguous == chk.flags.f_contiguous

        # Check C-contiguous (with arg).
        chk = datsp.toarray(order='C')
        assert_equal(chk, dat1d)
        assert chk.flags.c_contiguous
        assert chk.flags.f_contiguous

        # Check F-contiguous (with arg).
        chk = datsp.toarray(order='F')
        assert_equal(chk, dat1d)
        assert chk.flags.c_contiguous
        assert chk.flags.f_contiguous

        # Check with output arg.
        out = np.zeros(datsp.shape, dtype=datsp.dtype)
        datsp.toarray(out=out)
        assert_equal(out, dat1d)

        # Check that things are fine when we don't initialize with zeros.
        out[...] = 1.0
        datsp.toarray(out=out)
        assert_equal(out, dat1d)

        # np.dot does not work with sparse matrices (unless scalars)
        # so this is testing whether dat1d matches datsp.toarray()
        a = np.array([1.0, 2.0, 3.0, 4.0])
        dense_dot_dense = np.dot(a, dat1d)
        check = np.dot(a, datsp.toarray())
        assert_equal(dense_dot_dense, check)

        b = np.array([1.0, 2.0, 3.0, 4.0])
        dense_dot_dense = np.dot(dat1d, b)
        check = np.dot(datsp.toarray(), b)
        assert_equal(dense_dot_dense, check)

        # Check bool data works.
        spbool = spcreator(dat1d, dtype=bool)
        arrbool = dat1d.astype(bool)
        assert_equal(spbool.toarray(), arrbool)

    def test_add(self, spcreator, datsp_math_dtypes):
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            a = dat.copy()
            a[0] = 2.0
            b = datsp
            c = b + a
            assert_equal(c, b.toarray() + a)

            # test broadcasting
            # Note: cant add nonzero scalar to sparray. Can add len 1 array
            c = b + a[0:1]
            assert_equal(c, b.toarray() + a[0])

    def test_radd(self, spcreator, datsp_math_dtypes):
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            a = dat.copy()
            a[0] = 2.0
            b = datsp
            c = a + b
            assert_equal(c, a + b.toarray())

    def test_rsub(self, spcreator, datsp_math_dtypes):
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            if dtype == np.dtype('bool'):
                # boolean array subtraction deprecated in 1.9.0
                continue

            assert_equal((dat - datsp), [0, 0, 0, 0])
            assert_equal((datsp - dat), [0, 0, 0, 0])
            assert_equal((0 - datsp).toarray(), -dat)

            A = spcreator([1, -4, 0, 2], dtype='d')
            assert_equal((dat - A), dat - A.toarray())
            assert_equal((A - dat), A.toarray() - dat)
            assert_equal(A.toarray() - datsp, A.toarray() - dat)
            assert_equal(datsp - A.toarray(), dat - A.toarray())

            # test broadcasting
            assert_equal(dat[:1] - datsp, dat[:1] - dat)

    def test_matmul_basic(self, spcreator):
        A = np.array([[2, 0, 3.0], [0, 0, 0], [0, 1, 2]])
        v = np.array([1, 0, 3])
        Asp = spcreator(A)
        vsp = spcreator(v)

        # sparse result when both args are sparse and result not scalar
        assert_equal((Asp @ vsp).toarray(), A @ v)
        assert_equal(A @ vsp, A @ v)
        assert_equal(Asp @ v, A @ v)
        assert_equal((vsp @ Asp).toarray(), v @ A)
        assert_equal(vsp @ A, v @ A)
        assert_equal(v @ Asp, v @ A)

        assert_equal(vsp @ vsp, v @ v)
        assert_equal(v @ vsp, v @ v)
        assert_equal(vsp @ v, v @ v)
        assert_equal((Asp @ Asp).toarray(), A @ A)
        assert_equal(A @ Asp, A @ A)
        assert_equal(Asp @ A, A @ A)

    def test_matvec(self, spcreator):
        A = np.array([2, 0, 3.0])
        Asp = spcreator(A)
        col = np.array([[1, 2, 3]]).T

        assert_allclose(Asp @ col, Asp.toarray() @ col)

        assert (A @ np.array([1, 2, 3])).shape == ()
        assert Asp @ np.array([1, 2, 3]) == 11
        assert (Asp @ np.array([1, 2, 3])).shape == ()
        assert (Asp @ np.array([[1], [2], [3]])).shape == (1,)
        # check result type
        assert isinstance(Asp @ matrix([[1, 2, 3]]).T, np.ndarray)

        # ensure exception is raised for improper dimensions
        bad_vecs = [np.array([1, 2]), np.array([1, 2, 3, 4]), np.array([[1], [2]])]
        for x in bad_vecs:
            with pytest.raises(ValueError, match='dimension mismatch'):
                Asp @ x

        # The current relationship between sparse matrix products and array
        # products is as follows:
        dot_result = np.dot(Asp.toarray(), [1, 2, 3])
        assert_allclose(Asp @ np.array([1, 2, 3]), dot_result)
        assert_allclose(Asp @ [[1], [2], [3]], dot_result.T)
        # Note that the result of Asp @ x is dense if x has a singleton dimension.

    def test_rmatvec(self, spcreator, dat1d):
        M = spcreator(dat1d)
        assert_allclose([1, 2, 3, 4] @ M, np.dot([1, 2, 3, 4], M.toarray()))
        row = np.array([[1, 2, 3, 4]])
        assert_allclose(row @ M, row @ M.toarray())

    def test_transpose(self, spcreator, dat1d):
        for A in [dat1d, np.array([])]:
            B = spcreator(A)
            assert_equal(B.toarray(), A)
            assert_equal(B.transpose().toarray(), A)
            assert_equal(B.dtype, A.dtype)

    def test_add_dense_to_sparse(self, spcreator, datsp_math_dtypes):
        for dtype, dat, datsp in datsp_math_dtypes[spcreator]:
            sum1 = dat + datsp
            assert_equal(sum1, dat + dat)
            sum2 = datsp + dat
            assert_equal(sum2, dat + dat)

    def test_iterator(self, spcreator):
        # test that __iter__ is compatible with NumPy
        B = np.arange(5)
        A = spcreator(B)

        if A.format not in ['coo', 'dia', 'bsr']:
            for x, y in zip(A, B):
                assert_equal(x, y)

    def test_resize(self, spcreator):
        # resize(shape) resizes the matrix in-place
        D = np.array([1, 0, 3, 4])
        S = spcreator(D)
        assert S.resize((3,)) is None
        assert_equal(S.toarray(), [1, 0, 3])
        S.resize((5,))
        assert_equal(S.toarray(), [1, 0, 3, 0, 0])
