#
# Created by: Pearu Peterson, March 2002
#
""" Test functions for linalg.matfuncs module

"""
import functools
import pytest

import numpy as np
from numpy import array, identity, sqrt
from numpy.testing import (assert_array_almost_equal, assert_allclose, assert_,
                           assert_array_less, assert_array_equal, assert_warns,
                           suppress_warnings)

import scipy.linalg
from scipy.linalg import (funm, signm, logm, sqrtm, fractional_matrix_power,
                          expm, expm_frechet, expm_cond, norm, khatri_rao,
                          cosm, sinm, tanm, coshm, sinhm, tanhm)

from scipy.linalg import _matfuncs_inv_ssq
from scipy.linalg._matfuncs import pick_pade_structure
from scipy.linalg._matfuncs_inv_ssq import LogmExactlySingularWarning
import scipy.linalg._expm_frechet
from scipy.linalg import LinAlgWarning
from scipy.optimize import minimize


def _get_al_mohy_higham_2012_experiment_1():
    """
    Return the test matrix from Experiment (1) of [1]_.

    References
    ----------
    .. [1] Awad H. Al-Mohy and Nicholas J. Higham (2012)
           "Improved Inverse Scaling and Squaring Algorithms
           for the Matrix Logarithm."
           SIAM Journal on Scientific Computing, 34 (4). C152-C169.
           ISSN 1095-7197

    """
    A = np.array([
        [3.2346e-1, 3e4, 3e4, 3e4],
        [0, 3.0089e-1, 3e4, 3e4],
        [0, 0, 3.2210e-1, 3e4],
        [0, 0, 0, 3.0744e-1]], dtype=float)
    return A


class TestSignM:

    def test_nils(self):
        a = array([[29.2, -24.2, 69.5, 49.8, 7.],
                   [-9.2, 5.2, -18., -16.8, -2.],
                   [-10., 6., -20., -18., -2.],
                   [-9.6, 9.6, -25.5, -15.4, -2.],
                   [9.8, -4.8, 18., 18.2, 2.]])
        cr = array([[11.94933333,-2.24533333,15.31733333,21.65333333,-2.24533333],
                    [-3.84266667,0.49866667,-4.59066667,-7.18666667,0.49866667],
                    [-4.08,0.56,-4.92,-7.6,0.56],
                    [-4.03466667,1.04266667,-5.59866667,-7.02666667,1.04266667],
                    [4.15733333,-0.50133333,4.90933333,7.81333333,-0.50133333]])
        r = signm(a)
        assert_array_almost_equal(r,cr)

    def test_defective1(self):
        a = array([[0.0,1,0,0],[1,0,1,0],[0,0,0,1],[0,0,1,0]])
        signm(a)
        #XXX: what would be the correct result?

    def test_defective2(self):
        a = array((
            [29.2,-24.2,69.5,49.8,7.0],
            [-9.2,5.2,-18.0,-16.8,-2.0],
            [-10.0,6.0,-20.0,-18.0,-2.0],
            [-9.6,9.6,-25.5,-15.4,-2.0],
            [9.8,-4.8,18.0,18.2,2.0]))
        signm(a)
        #XXX: what would be the correct result?

    def test_defective3(self):
        a = array([[-2., 25., 0., 0., 0., 0., 0.],
                   [0., -3., 10., 3., 3., 3., 0.],
                   [0., 0., 2., 15., 3., 3., 0.],
                   [0., 0., 0., 0., 15., 3., 0.],
                   [0., 0., 0., 0., 3., 10., 0.],
                   [0., 0., 0., 0., 0., -2., 25.],
                   [0., 0., 0., 0., 0., 0., -3.]])
        signm(a)
        #XXX: what would be the correct result?


class TestLogM:
    def setup_method(self):
        self.rng = np.random.default_rng(1738098768840254)

    @pytest.mark.filterwarnings("ignore:.*inaccurate.*:RuntimeWarning")
    def test_nils(self):
        a = array([[-2., 25., 0., 0., 0., 0., 0.],
                   [0., -3., 10., 3., 3., 3., 0.],
                   [0., 0., 2., 15., 3., 3., 0.],
                   [0., 0., 0., 0., 15., 3., 0.],
                   [0., 0., 0., 0., 3., 10., 0.],
                   [0., 0., 0., 0., 0., -2., 25.],
                   [0., 0., 0., 0., 0., 0., -3.]])
        m = (identity(7)*3.1+0j)-a
        logm(m)
        #XXX: what would be the correct result?

    @pytest.mark.filterwarnings("ignore:.*inaccurate.*:RuntimeWarning")
    def test_al_mohy_higham_2012_experiment_1_logm(self):
        # The logm completes the round trip successfully.
        # Note that the expm leg of the round trip is badly conditioned.
        A = _get_al_mohy_higham_2012_experiment_1()
        A_logm = logm(A)
        A_round_trip = expm(A_logm)
        assert_allclose(A_round_trip, A, rtol=5e-5, atol=1e-14)

    def test_al_mohy_higham_2012_experiment_1_funm_log(self):
        # The raw funm with np.log does not complete the round trip.
        # Note that the expm leg of the round trip is badly conditioned.
        A = _get_al_mohy_higham_2012_experiment_1()
        A_funm_log = funm(A, np.log)
        A_round_trip = expm(A_funm_log)
        assert_(not np.allclose(A_round_trip, A, rtol=1e-5, atol=1e-14))

    def test_round_trip_random_float(self):
        for n in range(1, 6):
            M_unscaled = self.rng.uniform(size=(n, n))
            for scale in np.logspace(-4, 4, 9):
                M = M_unscaled * scale

                # Eigenvalues are related to the branch cut.
                W = np.linalg.eigvals(M)
                err_msg = f'M:{M} eivals:{W}'

                # Check sqrtm round trip because it is used within logm.
                M_sqrtm = sqrtm(M)
                M_sqrtm_round_trip = M_sqrtm @ M_sqrtm
                assert_allclose(M_sqrtm_round_trip, M)

                # Check logm round trip.
                with suppress_warnings() as sup:
                    sup.filter(category=RuntimeWarning)

                    M_logm = logm(M)
                    M_logm_round_trip = expm(M_logm)
                    assert_allclose(M_logm_round_trip, M, err_msg=err_msg)

    def test_round_trip_random_complex(self):

        for n in range(1, 6):
            M_unscaled = (self.rng.standard_normal((n, n)) +
                          1j*self.rng.standard_normal((n, n)))
            for scale in np.logspace(-4, 4, 9):
                M = M_unscaled * scale
                M_logm = logm(M)
                M_round_trip = expm(M_logm)
                assert_allclose(M_round_trip, M)

    def test_logm_type_preservation_and_conversion(self):
        # The logm matrix function should preserve the type of a matrix
        # whose eigenvalues are positive with zero imaginary part.
        # Test this preservation for variously structured matrices.
        complex_dtype_chars = ('F', 'D', 'G')
        for matrix_as_list in (
                [[1, 0], [0, 1]],
                [[1, 0], [1, 1]],
                [[2, 1], [1, 1]],
                [[2, 3], [1, 2]]):

            # check that the spectrum has the expected properties
            W = scipy.linalg.eigvals(matrix_as_list)
            assert_(not any(w.imag or w.real < 0 for w in W))

            # check float type preservation
            A = np.array(matrix_as_list, dtype=float)
            A_logm = logm(A)
            assert_(A_logm.dtype.char not in complex_dtype_chars)

            # check complex type preservation
            A = np.array(matrix_as_list, dtype=complex)
            A_logm = logm(A)
            assert_(A_logm.dtype.char in complex_dtype_chars)

            # check float->complex type conversion for the matrix negation
            A = -np.array(matrix_as_list, dtype=float)
            A_logm = logm(A)
            assert_(A_logm.dtype.char in complex_dtype_chars)

    def test_complex_spectrum_real_logm(self):
        # This matrix has complex eigenvalues and real logm.
        # Its output dtype depends on its input dtype.
        M = [[1, 1, 2], [2, 1, 1], [1, 2, 1]]
        for dt in float, complex:
            X = np.array(M, dtype=dt)
            w = scipy.linalg.eigvals(X)
            assert_(1e-2 < np.absolute(w.imag).sum())
            Y = logm(X)
            assert_(np.issubdtype(Y.dtype, np.inexact))
            assert_allclose(expm(Y), X)

    def test_real_mixed_sign_spectrum(self):
        # These matrices have real eigenvalues with mixed signs.
        # The output logm dtype is complex, regardless of input dtype.
        for M in (
                [[1, 0], [0, -1]],
                [[0, 1], [1, 0]]):
            for dt in float, complex:
                A = np.array(M, dtype=dt)
                A_logm, info = logm(A)
                assert_(np.issubdtype(A_logm.dtype, np.complexfloating))

    @pytest.mark.thread_unsafe
    def test_exactly_singular(self):
        A = np.array([[0, 0], [1j, 1j]])
        B = np.asarray([[1, 1], [0, 0]])
        for M in A, A.T, B, B.T:
            expected_warning = _matfuncs_inv_ssq.LogmExactlySingularWarning
            L = assert_warns(expected_warning, logm, M)
            E = expm(L)
            assert_allclose(E, M, atol=1e-14)

    @pytest.mark.thread_unsafe
    def test_nearly_singular(self):
        M = np.array([[1e-100]])
        expected_warning = _matfuncs_inv_ssq.LogmNearlySingularWarning
        L = assert_warns(expected_warning, logm, M)
        E = expm(L)
        assert_allclose(E, M, atol=1e-14)

    def test_opposite_sign_complex_eigenvalues(self):
        # See gh-6113
        E = [[0, 1], [-1, 0]]
        L = [[0, np.pi*0.5], [-np.pi*0.5, 0]]
        assert_allclose(expm(L), E, atol=1e-14)
        assert_allclose(logm(E), L, atol=1e-14)
        E = [[1j, 4], [0, -1j]]
        L = [[1j*np.pi*0.5, 2*np.pi], [0, -1j*np.pi*0.5]]
        assert_allclose(expm(L), E, atol=1e-14)
        assert_allclose(logm(E), L, atol=1e-14)
        E = [[1j, 0], [0, -1j]]
        L = [[1j*np.pi*0.5, 0], [0, -1j*np.pi*0.5]]
        assert_allclose(expm(L), E, atol=1e-14)
        assert_allclose(logm(E), L, atol=1e-14)

    def test_readonly(self):
        n = 5
        a = np.ones((n, n)) + np.identity(n)
        a.flags.writeable = False
        logm(a)

    @pytest.mark.xfail(reason="ValueError: attempt to get argmax of an empty sequence")
    @pytest.mark.parametrize('dt', [int, float, np.float32, complex, np.complex64])
    def test_empty(self, dt):
        a = np.empty((0, 0), dtype=dt)
        log_a = logm(a)
        a0 = np.eye(2, dtype=dt)
        log_a0 = logm(a0)

        assert log_a.shape == (0, 0)
        assert log_a.dtype == log_a0.dtype

    @pytest.mark.thread_unsafe
    @pytest.mark.parametrize('dtype', [int, float, np.float32, complex, np.complex64])
    def test_no_ZeroDivisionError(self, dtype):
        # gh-17136 reported inconsistent behavior in `logm` depending on input dtype:
        # sometimes it raised an error, and sometimes it printed a warning message.
        # check that this is resolved and that the warning is emitted properly.
        with (pytest.warns(RuntimeWarning, match="logm result may be inaccurate"),
              pytest.warns(LogmExactlySingularWarning)):
            logm(np.zeros((2, 2), dtype=dtype))


class TestSqrtM:

    def test_round_trip_random_float(self):
        rng = np.random.default_rng(1738151906092735)
        for n in range(1, 6):
            M_unscaled = rng.standard_normal((n, n))
            for scale in np.logspace(-4, 4, 9):
                M = M_unscaled * scale
                M_sqrtm = sqrtm(M)
                M_sqrtm_round_trip = M_sqrtm.dot(M_sqrtm)
                assert_allclose(M_sqrtm_round_trip, M)

    def test_round_trip_random_complex(self):
        rng = np.random.default_rng(1738151906092736)
        for n in range(1, 6):
            M_unscaled = (rng.standard_normal((n, n)) +
                          1j * rng.standard_normal((n, n)))
            for scale in np.logspace(-4, 4, 9):
                M = M_unscaled * scale
                M_sqrtm = sqrtm(M)
                M_sqrtm_round_trip = M_sqrtm.dot(M_sqrtm)
                assert_allclose(M_sqrtm_round_trip, M)

    def test_bad(self):
        # See https://web.archive.org/web/20051220232650/http://www.maths.man.ac.uk/~nareports/narep336.ps.gz
        e = 2**-5
        se = sqrt(e)
        a = array([[1.0,0,0,1],
                   [0,e,0,0],
                   [0,0,e,0],
                   [0,0,0,1]])
        sa = array([[1,0,0,0.5],
                    [0,se,0,0],
                    [0,0,se,0],
                    [0,0,0,1]])
        assert_array_almost_equal(sa @ sa, a)
        # Check default sqrtm.
        esa = sqrtm(a)
        assert_array_almost_equal(esa @ esa, a)

    def test_sqrtm_type_preservation_and_conversion(self):
        # The sqrtm matrix function should preserve the type of a matrix
        # whose eigenvalues are nonnegative with zero imaginary part.
        # Test this preservation for variously structured matrices.
        complex_dtype_chars = ('F', 'D', 'G')
        for matrix_as_list in (
                [[1, 0], [0, 1]],
                [[1, 0], [1, 1]],
                [[2, 1], [1, 1]],
                [[2, 3], [1, 2]],
                [[1, 1], [1, 1]]):

            # check that the spectrum has the expected properties
            W = scipy.linalg.eigvals(matrix_as_list)
            assert_(not any(w.imag or w.real < 0 for w in W))

            # Last test matrix is singular so suppress the warning
            with suppress_warnings() as sup:
                sup.filter(category=LinAlgWarning)

                # check float type preservation
                A = np.array(matrix_as_list, dtype=float)
                A_sqrtm = sqrtm(A)
                assert_(A_sqrtm.dtype.char not in complex_dtype_chars)

                # check complex type preservation
                A = np.array(matrix_as_list, dtype=complex)
                A_sqrtm = sqrtm(A)
                assert_(A_sqrtm.dtype.char in complex_dtype_chars)

                # check float->complex type conversion for the matrix negation
                A = -np.array(matrix_as_list, dtype=float)
                A_sqrtm = sqrtm(A)
                assert_(A_sqrtm.dtype.char in complex_dtype_chars)

    def test_sqrtm_type_conversion_mixed_sign_or_complex_spectrum(self):
        complex_dtype_chars = ('F', 'D', 'G')
        for matrix_as_list in (
                [[1, 0], [0, -1]],
                [[0, 1], [1, 0]],
                [[0, 1, 0], [0, 0, -1], [1, 0, 0]]):

            # check that the spectrum has the expected properties
            W = scipy.linalg.eigvals(matrix_as_list)
            assert_(any(w.imag or w.real < 0 for w in W))

            # check complex->complex
            A = np.array(matrix_as_list, dtype=complex)
            A_sqrtm = sqrtm(A)
            assert_(A_sqrtm.dtype.char in complex_dtype_chars)

            # check float->complex
            A = np.array(matrix_as_list, dtype=float)
            A_sqrtm = sqrtm(A)
            assert_(A_sqrtm.dtype.char in complex_dtype_chars)

    def test_al_mohy_higham_2012_experiment_1(self):
        # Matrix square root of a tricky upper triangular matrix.
        A = _get_al_mohy_higham_2012_experiment_1()
        A_sqrtm = sqrtm(A)
        A_round_trip = A_sqrtm @ A_sqrtm
        assert_allclose(A_round_trip, A, rtol=1e-5)
        assert_allclose(np.tril(A_round_trip), np.tril(A))

    def test_strict_upper_triangular(self):
        # This matrix has no square root but upper triangular hence upper
        # triangle will be filled with junk values.
        for dt in int, float:
            A = np.array([
                [0, 3, 0, 0],
                [0, 0, 3, 0],
                [0, 0, 0, 3],
                [0, 0, 0, 0]], dtype=dt)
            with suppress_warnings() as sup:
                sup.filter(category=LinAlgWarning)

                A_sqrtm = sqrtm(A)
                assert_allclose(np.tril(A_sqrtm), np.zeros((4, 4)))
                assert np.isnan(A_sqrtm).any()
                assert np.isinf(A_sqrtm).any()

    # Future edit: This squareroot is not possible to find algorithmically
    # with the current methods. Now sqrtm docstring has another example of
    # such matrix whose squareroot is not a polynomial in it. Hence no need
    # to test it here.
    """
    def test_weird_matrix(self):
        # The square root of matrix B exists.
        for dt in int, float:
            A = np.array([
                [0, 0, 1],
                [0, 0, 0],
                [0, 1, 0]], dtype=dt)
            B = np.array([
                [0, 1, 0],
                [0, 0, 0],
                [0, 0, 0]], dtype=dt)
            assert_array_equal(B, A @ A)

            # But scipy sqrtm is not clever enough to find it.
            B_sqrtm, info = sqrtm(B, disp=False)
            assert_(np.isnan(B_sqrtm).all())
    """

    def test_opposite_sign_complex_eigenvalues(self):
        M = [[2j, 4], [0, -2j]]
        R = [[1+1j, 2], [0, 1-1j]]
        assert_allclose(np.dot(R, R), M, atol=1e-14)
        assert_allclose(sqrtm(M), R, atol=1e-14)

    def test_gh4866(self):
        M = np.array([[1, 0, 0, 1],
                      [0, 0, 0, 0],
                      [0, 0, 0, 0],
                      [1, 0, 0, 1]])
        R = np.array([[sqrt(0.5), 0, 0, sqrt(0.5)],
                      [0, 0, 0, 0],
                      [0, 0, 0, 0],
                      [sqrt(0.5), 0, 0, sqrt(0.5)]])
        assert_allclose(R @ R, M, atol=1e-14)
        with suppress_warnings() as sup:
            sup.filter(category=LinAlgWarning)

            assert_allclose(sqrtm(M), R, atol=1e-14)

    def test_gh5336(self):
        M = np.diag([2, 1, 0])
        R = np.diag([sqrt(2), 1, 0])
        assert_allclose(R @ R, M, atol=1e-14)
        with suppress_warnings() as sup:
            sup.filter(category=LinAlgWarning)
            assert_allclose(sqrtm(M), R, atol=1e-14)

    def test_gh7839(self):
        M = np.zeros((2, 2))
        R = np.zeros((2, 2))
        # Catch and silence LinAlgWarning
        with suppress_warnings() as sup:
            sup.filter(category=LinAlgWarning)

            assert_allclose(sqrtm(M), R, atol=1e-14)

    def test_gh17918(self):
        M = np.empty((19, 19))
        M.fill(0.94)
        np.fill_diagonal(M, 1)
        assert np.isrealobj(sqrtm(M))

    def test_data_size_preservation_uint_in_float_out(self):
        M = np.eye(10, dtype=np.uint8)
        assert sqrtm(M).dtype == np.float64
        M = np.eye(10, dtype=np.uint16)
        assert sqrtm(M).dtype == np.float64
        M = np.eye(10, dtype=np.uint32)
        assert sqrtm(M).dtype == np.float64
        M = np.eye(10, dtype=np.uint64)
        assert sqrtm(M).dtype == np.float64

    def test_data_size_preservation_int_in_float_out(self):
        M = np.eye(10, dtype=np.int8)
        assert sqrtm(M).dtype == np.float64
        M = np.eye(10, dtype=np.int16)
        assert sqrtm(M).dtype == np.float64
        M = np.eye(10, dtype=np.int32)
        assert sqrtm(M).dtype == np.float64
        M = np.eye(10, dtype=np.int64)
        assert sqrtm(M).dtype == np.float64

    def test_data_size_preservation_int_in_comp_out(self):
        M = np.array([[2, 4], [0, -2]], dtype=np.int8)
        assert sqrtm(M).dtype == np.complex128
        M = np.array([[2, 4], [0, -2]], dtype=np.int16)
        assert sqrtm(M).dtype == np.complex128
        M = np.array([[2, 4], [0, -2]], dtype=np.int32)
        assert sqrtm(M).dtype == np.complex128
        M = np.array([[2, 4], [0, -2]], dtype=np.int64)
        assert sqrtm(M).dtype == np.complex128

    def test_data_size_preservation_float_in_float_out(self):
        M = np.eye(10, dtype=np.float16)
        assert sqrtm(M).dtype == np.float32
        M = np.eye(10, dtype=np.float32)
        assert sqrtm(M).dtype == np.float32
        M = np.eye(10, dtype=np.float64)
        assert sqrtm(M).dtype == np.float64
        if hasattr(np, 'float128'):
            M = np.eye(10, dtype=np.float128)
            assert sqrtm(M).dtype == np.float64

    def test_data_size_preservation_float_in_comp_out(self):
        M = np.array([[2, 4], [0, -2]], dtype=np.float16)
        assert sqrtm(M).dtype == np.complex64
        M = np.array([[2, 4], [0, -2]], dtype=np.float32)
        assert sqrtm(M).dtype == np.complex64
        M = np.array([[2, 4], [0, -2]], dtype=np.float64)
        assert sqrtm(M).dtype == np.complex128
        if hasattr(np, 'float128') and hasattr(np, 'complex256'):
            M = np.array([[2, 4], [0, -2]], dtype=np.float128)
            assert sqrtm(M).dtype == np.complex128

    def test_data_size_preservation_comp_in_comp_out(self):
        M = np.array([[2j, 4], [0, -2j]], dtype=np.complex64)
        assert sqrtm(M).dtype == np.complex64
        M = np.array([[2j, 4], [0, -2j]], dtype=np.complex128)
        assert sqrtm(M).dtype == np.complex128
        if hasattr(np, 'complex256'):
            M = np.array([[2j, 4], [0, -2j]], dtype=np.complex256)
            assert sqrtm(M).dtype == np.complex128

    @pytest.mark.parametrize('dt', [int, float, np.float32, complex, np.complex64])
    def test_empty(self, dt):
        a = np.empty((0, 0), dtype=dt)
        s = sqrtm(a)
        a0 = np.eye(2, dtype=dt)
        s0 = sqrtm(a0)

        assert s.shape == (0, 0)
        assert s.dtype == s0.dtype

    def test_cf_noncontig_nd_inputs(self):
        # Check that non-contiguous arrays are handled correctly.
        # Generate an L, U pair for invertible random matrix.
        rng = np.random.default_rng(1738151906092737)
        n = 13
        A = rng.uniform(size=(3, 2*n, 2*n))
        L, U = np.tril(A, k=-1) + np.eye(2*n), np.triu(A)
        A = L @ U
        # Create strided views of 3D array.
        A_noncontig_c = A[:, ::2, ::2]
        A_noncontig_f = np.asfortranarray(A)[:, 1::2, 1::2]
        assert_allclose(sqrtm(A[:, ::2, ::2]), sqrtm(A_noncontig_c))
        assert_allclose(sqrtm(A[:, 1::2, 1::2]), sqrtm(A_noncontig_f))

    def test_empty_sizes(self):
        A = np.empty(shape=[4, 0, 5, 5], dtype=float)
        assert_array_equal(sqrtm(A), A)

    def test_negative_strides(self):
        rng = np.random.default_rng(1738151906092738)
        A = rng.uniform(size=(3, 5, 5))
        A_negneg_orig = A[:, ::-1, ::-1]
        A_negneg_copy = A[:, ::-1, ::-1].copy()
        assert_allclose(sqrtm(A_negneg_orig), sqrtm(A_negneg_copy))

        A_posneg_orig = A[:, :, ::-1]
        A_posneg_copy = A[:, :, ::-1].copy()
        assert_allclose(sqrtm(A_posneg_orig), sqrtm(A_posneg_copy))

        A_negpos_orig = A[:, ::-1, :]
        A_negpos_copy = A[:, ::-1, :].copy()
        assert_allclose(sqrtm(A_negpos_orig), sqrtm(A_negpos_copy))


class TestFractionalMatrixPower:
    def test_round_trip_random_complex(self):
        np.random.seed(1234)
        for p in range(1, 5):
            for n in range(1, 5):
                M_unscaled = np.random.randn(n, n) + 1j * np.random.randn(n, n)
                for scale in np.logspace(-4, 4, 9):
                    M = M_unscaled * scale
                    M_root = fractional_matrix_power(M, 1/p)
                    M_round_trip = np.linalg.matrix_power(M_root, p)
                    assert_allclose(M_round_trip, M)

    def test_round_trip_random_float(self):
        # This test is more annoying because it can hit the branch cut;
        # this happens when the matrix has an eigenvalue
        # with no imaginary component and with a real negative component,
        # and it means that the principal branch does not exist.
        np.random.seed(1234)
        for p in range(1, 5):
            for n in range(1, 5):
                M_unscaled = np.random.randn(n, n)
                for scale in np.logspace(-4, 4, 9):
                    M = M_unscaled * scale
                    M_root = fractional_matrix_power(M, 1/p)
                    M_round_trip = np.linalg.matrix_power(M_root, p)
                    assert_allclose(M_round_trip, M)

    def test_larger_abs_fractional_matrix_powers(self):
        np.random.seed(1234)
        for n in (2, 3, 5):
            for i in range(10):
                M = np.random.randn(n, n) + 1j * np.random.randn(n, n)
                M_one_fifth = fractional_matrix_power(M, 0.2)
                # Test the round trip.
                M_round_trip = np.linalg.matrix_power(M_one_fifth, 5)
                assert_allclose(M, M_round_trip)
                # Test a large abs fractional power.
                X = fractional_matrix_power(M, -5.4)
                Y = np.linalg.matrix_power(M_one_fifth, -27)
                assert_allclose(X, Y)
                # Test another large abs fractional power.
                X = fractional_matrix_power(M, 3.8)
                Y = np.linalg.matrix_power(M_one_fifth, 19)
                assert_allclose(X, Y)

    def test_random_matrices_and_powers(self):
        # Each independent iteration of this fuzz test picks random parameters.
        # It tries to hit some edge cases.
        rng = np.random.default_rng(1726500458620605)
        nsamples = 20
        for i in range(nsamples):
            # Sample a matrix size and a random real power.
            n = rng.integers(1, 5)
            p = rng.random()

            # Sample a random real or complex matrix.
            matrix_scale = np.exp(rng.integers(-4, 5))
            A = rng.random(size=[n, n])
            if [True, False][rng.choice(2)]:
                A = A + 1j * rng.random(size=[n, n])
            A = A * matrix_scale

            # Check a couple of analytically equivalent ways
            # to compute the fractional matrix power.
            # These can be compared because they both use the principal branch.
            A_power = fractional_matrix_power(A, p)
            A_logm = logm(A)
            A_power_expm_logm = expm(A_logm * p)
            assert_allclose(A_power, A_power_expm_logm)

    def test_al_mohy_higham_2012_experiment_1(self):
        # Fractional powers of a tricky upper triangular matrix.
        A = _get_al_mohy_higham_2012_experiment_1()

        # Test remainder matrix power.
        A_funm_sqrt = funm(A, np.sqrt)
        A_sqrtm = sqrtm(A)
        A_rem_power = _matfuncs_inv_ssq._remainder_matrix_power(A, 0.5)
        A_power = fractional_matrix_power(A, 0.5)
        assert_allclose(A_rem_power, A_power, rtol=1e-11)
        assert_allclose(A_sqrtm, A_power)
        assert_allclose(A_sqrtm, A_funm_sqrt)

        # Test more fractional powers.
        for p in (1/2, 5/3):
            A_power = fractional_matrix_power(A, p)
            A_round_trip = fractional_matrix_power(A_power, 1/p)
            assert_allclose(A_round_trip, A, rtol=1e-2)
            assert_allclose(np.tril(A_round_trip, 1), np.tril(A, 1))

    def test_briggs_helper_function(self):
        np.random.seed(1234)
        for a in np.random.randn(10) + 1j * np.random.randn(10):
            for k in range(5):
                x_observed = _matfuncs_inv_ssq._briggs_helper_function(a, k)
                x_expected = a ** np.exp2(-k) - 1
                assert_allclose(x_observed, x_expected)

    def test_type_preservation_and_conversion(self):
        # The fractional_matrix_power matrix function should preserve
        # the type of a matrix whose eigenvalues
        # are positive with zero imaginary part.
        # Test this preservation for variously structured matrices.
        complex_dtype_chars = ('F', 'D', 'G')
        for matrix_as_list in (
                [[1, 0], [0, 1]],
                [[1, 0], [1, 1]],
                [[2, 1], [1, 1]],
                [[2, 3], [1, 2]]):

            # check that the spectrum has the expected properties
            W = scipy.linalg.eigvals(matrix_as_list)
            assert_(not any(w.imag or w.real < 0 for w in W))

            # Check various positive and negative powers
            # with absolute values bigger and smaller than 1.
            for p in (-2.4, -0.9, 0.2, 3.3):

                # check float type preservation
                A = np.array(matrix_as_list, dtype=float)
                A_power = fractional_matrix_power(A, p)
                assert_(A_power.dtype.char not in complex_dtype_chars)

                # check complex type preservation
                A = np.array(matrix_as_list, dtype=complex)
                A_power = fractional_matrix_power(A, p)
                assert_(A_power.dtype.char in complex_dtype_chars)

                # check float->complex for the matrix negation
                A = -np.array(matrix_as_list, dtype=float)
                A_power = fractional_matrix_power(A, p)
                assert_(A_power.dtype.char in complex_dtype_chars)

    def test_type_conversion_mixed_sign_or_complex_spectrum(self):
        complex_dtype_chars = ('F', 'D', 'G')
        for matrix_as_list in (
                [[1, 0], [0, -1]],
                [[0, 1], [1, 0]],
                [[0, 1, 0], [0, 0, 1], [1, 0, 0]]):

            # check that the spectrum has the expected properties
            W = scipy.linalg.eigvals(matrix_as_list)
            assert_(any(w.imag or w.real < 0 for w in W))

            # Check various positive and negative powers
            # with absolute values bigger and smaller than 1.
            for p in (-2.4, -0.9, 0.2, 3.3):

                # check complex->complex
                A = np.array(matrix_as_list, dtype=complex)
                A_power = fractional_matrix_power(A, p)
                assert_(A_power.dtype.char in complex_dtype_chars)

                # check float->complex
                A = np.array(matrix_as_list, dtype=float)
                A_power = fractional_matrix_power(A, p)
                assert_(A_power.dtype.char in complex_dtype_chars)

    @pytest.mark.xfail(reason='Too unstable across LAPACKs.')
    def test_singular(self):
        # Negative fractional powers do not work with singular matrices.
        for matrix_as_list in (
                [[0, 0], [0, 0]],
                [[1, 1], [1, 1]],
                [[1, 2], [3, 6]],
                [[0, 0, 0], [0, 1, 1], [0, -1, 1]]):

            # Check fractional powers both for float and for complex types.
            for newtype in (float, complex):
                A = np.array(matrix_as_list, dtype=newtype)
                for p in (-0.7, -0.9, -2.4, -1.3):
                    A_power = fractional_matrix_power(A, p)
                    assert_(np.isnan(A_power).all())
                for p in (0.2, 1.43):
                    A_power = fractional_matrix_power(A, p)
                    A_round_trip = fractional_matrix_power(A_power, 1/p)
                    assert_allclose(A_round_trip, A)

    def test_opposite_sign_complex_eigenvalues(self):
        M = [[2j, 4], [0, -2j]]
        R = [[1+1j, 2], [0, 1-1j]]
        assert_allclose(np.dot(R, R), M, atol=1e-14)
        assert_allclose(fractional_matrix_power(M, 0.5), R, atol=1e-14)


class TestExpM:
    def test_zero(self):
        a = array([[0.,0],[0,0]])
        assert_array_almost_equal(expm(a),[[1,0],[0,1]])

    def test_single_elt(self):
        elt = expm(1)
        assert_allclose(elt, np.array([[np.e]]))

    @pytest.mark.parametrize('func', [expm, cosm, sinm, tanm, coshm, sinhm, tanhm])
    @pytest.mark.parametrize('dt',[int, float, np.float32, complex, np.complex64])
    @pytest.mark.parametrize('shape', [(0, 0), (1, 1)])
    def test_small_empty_matrix_input(self, func, dt, shape):
        # regression test for gh-11082 / gh-20372 - test behavior of expm
        # and related functions for small and zero-sized arrays.
        A = np.zeros(shape, dtype=dt)
        A0 = np.zeros((10, 10), dtype=dt)
        result = func(A)
        result0 = func(A0)
        assert result.shape == shape
        assert result.dtype == result0.dtype

    def test_2x2_input(self):
        E = np.e
        a = array([[1, 4], [1, 1]])
        aa = (E**4 + 1)/(2*E)
        bb = (E**4 - 1)/E
        assert_allclose(expm(a), array([[aa, bb], [bb/4, aa]]))
        assert expm(a.astype(np.complex64)).dtype.char == 'F'
        assert expm(a.astype(np.float32)).dtype.char == 'f'

    def test_nx2x2_input(self):
        E = np.e
        # These are integer matrices with integer eigenvalues
        a = np.array([[[1, 4], [1, 1]],
                      [[1, 3], [1, -1]],
                      [[1, 3], [4, 5]],
                      [[1, 3], [5, 3]],
                      [[4, 5], [-3, -4]]], order='F')
        # Exact results are computed symbolically
        a_res = np.array([
                          [[(E**4+1)/(2*E), (E**4-1)/E],
                           [(E**4-1)/4/E, (E**4+1)/(2*E)]],
                          [[1/(4*E**2)+(3*E**2)/4, (3*E**2)/4-3/(4*E**2)],
                           [E**2/4-1/(4*E**2), 3/(4*E**2)+E**2/4]],
                          [[3/(4*E)+E**7/4, -3/(8*E)+(3*E**7)/8],
                           [-1/(2*E)+E**7/2, 1/(4*E)+(3*E**7)/4]],
                          [[5/(8*E**2)+(3*E**6)/8, -3/(8*E**2)+(3*E**6)/8],
                           [-5/(8*E**2)+(5*E**6)/8, 3/(8*E**2)+(5*E**6)/8]],
                          [[-3/(2*E)+(5*E)/2, -5/(2*E)+(5*E)/2],
                           [3/(2*E)-(3*E)/2, 5/(2*E)-(3*E)/2]]
                         ])
        assert_allclose(expm(a), a_res)

    def test_readonly(self):
        n = 7
        a = np.ones((n, n))
        a.flags.writeable = False
        expm(a)

    @pytest.mark.thread_unsafe
    @pytest.mark.fail_slow(5)
    def test_gh18086(self):
        A = np.zeros((400, 400), dtype=float)
        rng = np.random.default_rng(100)
        i = rng.integers(0, 399, 500)
        j = rng.integers(0, 399, 500)
        A[i, j] = rng.random(500)
        # Problem appears when m = 9
        Am = np.empty((5, 400, 400), dtype=float)
        Am[0] = A.copy()
        m, s = pick_pade_structure(Am)
        assert m == 9
        # Check that result is accurate
        first_res = expm(A)
        np.testing.assert_array_almost_equal(logm(first_res), A)
        # Check that result is consistent
        for i in range(5):
            next_res = expm(A)
            np.testing.assert_array_almost_equal(first_res, next_res)


class TestExpmFrechet:

    def test_expm_frechet(self):
        # a test of the basic functionality
        M = np.array([
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [0, 0, 1, 2],
            [0, 0, 5, 6],
            ], dtype=float)
        A = np.array([
            [1, 2],
            [5, 6],
            ], dtype=float)
        E = np.array([
            [3, 4],
            [7, 8],
            ], dtype=float)
        expected_expm = scipy.linalg.expm(A)
        expected_frechet = scipy.linalg.expm(M)[:2, 2:]
        for kwargs in ({}, {'method':'SPS'}, {'method':'blockEnlarge'}):
            observed_expm, observed_frechet = expm_frechet(A, E, **kwargs)
            assert_allclose(expected_expm, observed_expm)
            assert_allclose(expected_frechet, observed_frechet)

    def test_small_norm_expm_frechet(self):
        # methodically test matrices with a range of norms, for better coverage
        M_original = np.array([
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [0, 0, 1, 2],
            [0, 0, 5, 6],
            ], dtype=float)
        A_original = np.array([
            [1, 2],
            [5, 6],
            ], dtype=float)
        E_original = np.array([
            [3, 4],
            [7, 8],
            ], dtype=float)
        A_original_norm_1 = scipy.linalg.norm(A_original, 1)
        selected_m_list = [1, 3, 5, 7, 9, 11, 13, 15]
        m_neighbor_pairs = zip(selected_m_list[:-1], selected_m_list[1:])
        for ma, mb in m_neighbor_pairs:
            ell_a = scipy.linalg._expm_frechet.ell_table_61[ma]
            ell_b = scipy.linalg._expm_frechet.ell_table_61[mb]
            target_norm_1 = 0.5 * (ell_a + ell_b)
            scale = target_norm_1 / A_original_norm_1
            M = scale * M_original
            A = scale * A_original
            E = scale * E_original
            expected_expm = scipy.linalg.expm(A)
            expected_frechet = scipy.linalg.expm(M)[:2, 2:]
            observed_expm, observed_frechet = expm_frechet(A, E)
            assert_allclose(expected_expm, observed_expm)
            assert_allclose(expected_frechet, observed_frechet)

    def test_fuzz(self):
        rng = np.random.default_rng(1726500908359153)
        # try a bunch of crazy inputs
        rfuncs = (
                np.random.uniform,
                np.random.normal,
                np.random.standard_cauchy,
                np.random.exponential)
        ntests = 100
        for i in range(ntests):
            rfunc = rfuncs[rng.choice(4)]
            target_norm_1 = rng.exponential()
            n = rng.integers(2, 16)
            A_original = rfunc(size=(n,n))
            E_original = rfunc(size=(n,n))
            A_original_norm_1 = scipy.linalg.norm(A_original, 1)
            scale = target_norm_1 / A_original_norm_1
            A = scale * A_original
            E = scale * E_original
            M = np.vstack([
                np.hstack([A, E]),
                np.hstack([np.zeros_like(A), A])])
            expected_expm = scipy.linalg.expm(A)
            expected_frechet = scipy.linalg.expm(M)[:n, n:]
            observed_expm, observed_frechet = expm_frechet(A, E)
            assert_allclose(expected_expm, observed_expm, atol=5e-8)
            assert_allclose(expected_frechet, observed_frechet, atol=1e-7)

    def test_problematic_matrix(self):
        # this test case uncovered a bug which has since been fixed
        A = np.array([
                [1.50591997, 1.93537998],
                [0.41203263, 0.23443516],
                ], dtype=float)
        E = np.array([
                [1.87864034, 2.07055038],
                [1.34102727, 0.67341123],
                ], dtype=float)
        scipy.linalg.norm(A, 1)
        sps_expm, sps_frechet = expm_frechet(
                A, E, method='SPS')
        blockEnlarge_expm, blockEnlarge_frechet = expm_frechet(
                A, E, method='blockEnlarge')
        assert_allclose(sps_expm, blockEnlarge_expm)
        assert_allclose(sps_frechet, blockEnlarge_frechet)

    @pytest.mark.slow
    @pytest.mark.skip(reason='this test is deliberately slow')
    def test_medium_matrix(self):
        # profile this to see the speed difference
        n = 1000
        A = np.random.exponential(size=(n, n))
        E = np.random.exponential(size=(n, n))
        sps_expm, sps_frechet = expm_frechet(
                A, E, method='SPS')
        blockEnlarge_expm, blockEnlarge_frechet = expm_frechet(
                A, E, method='blockEnlarge')
        assert_allclose(sps_expm, blockEnlarge_expm)
        assert_allclose(sps_frechet, blockEnlarge_frechet)


def _help_expm_cond_search(A, A_norm, X, X_norm, eps, p):
    p = np.reshape(p, A.shape)
    p_norm = norm(p)
    perturbation = eps * p * (A_norm / p_norm)
    X_prime = expm(A + perturbation)
    scaled_relative_error = norm(X_prime - X) / (X_norm * eps)
    return -scaled_relative_error


def _normalized_like(A, B):
    return A * (scipy.linalg.norm(B) / scipy.linalg.norm(A))


def _relative_error(f, A, perturbation):
    X = f(A)
    X_prime = f(A + perturbation)
    return norm(X_prime - X) / norm(X)


class TestExpmConditionNumber:
    def test_expm_cond_smoke(self):
        np.random.seed(1234)
        for n in range(1, 4):
            A = np.random.randn(n, n)
            kappa = expm_cond(A)
            assert_array_less(0, kappa)

    def test_expm_bad_condition_number(self):
        A = np.array([
            [-1.128679820, 9.614183771e4, -4.524855739e9, 2.924969411e14],
            [0, -1.201010529, 9.634696872e4, -4.681048289e9],
            [0, 0, -1.132893222, 9.532491830e4],
            [0, 0, 0, -1.179475332],
            ])
        kappa = expm_cond(A)
        assert_array_less(1e36, kappa)

    def test_univariate(self):
        np.random.seed(12345)
        for x in np.linspace(-5, 5, num=11):
            A = np.array([[x]])
            assert_allclose(expm_cond(A), abs(x))
        for x in np.logspace(-2, 2, num=11):
            A = np.array([[x]])
            assert_allclose(expm_cond(A), abs(x))
        for i in range(10):
            A = np.random.randn(1, 1)
            assert_allclose(expm_cond(A), np.absolute(A)[0, 0])

    @pytest.mark.slow
    def test_expm_cond_fuzz(self):
        rng = np.random.RandomState(12345)
        eps = 1e-5
        nsamples = 10
        for i in range(nsamples):
            n = rng.randint(2, 5)
            A = rng.randn(n, n)
            A_norm = scipy.linalg.norm(A)
            X = expm(A)
            X_norm = scipy.linalg.norm(X)
            kappa = expm_cond(A)

            # Look for the small perturbation that gives the greatest
            # relative error.
            f = functools.partial(_help_expm_cond_search,
                    A, A_norm, X, X_norm, eps)
            guess = np.ones(n*n)
            out = minimize(f, guess, method='L-BFGS-B')
            xopt = out.x
            yopt = f(xopt)
            p_best = eps * _normalized_like(np.reshape(xopt, A.shape), A)
            p_best_relerr = _relative_error(expm, A, p_best)
            assert_allclose(p_best_relerr, -yopt * eps)

            # Check that the identified perturbation indeed gives greater
            # relative error than random perturbations with similar norms.
            for j in range(5):
                p_rand = eps * _normalized_like(rng.randn(*A.shape), A)
                assert_allclose(norm(p_best), norm(p_rand))
                p_rand_relerr = _relative_error(expm, A, p_rand)
                assert_array_less(p_rand_relerr, p_best_relerr)

            # The greatest relative error should not be much greater than
            # eps times the condition number kappa.
            # In the limit as eps approaches zero it should never be greater.
            assert_array_less(p_best_relerr, (1 + 2*eps) * eps * kappa)


class TestKhatriRao:

    def test_basic(self):
        a = khatri_rao(array([[1, 2], [3, 4]]),
                       array([[5, 6], [7, 8]]))

        assert_array_equal(a, array([[5, 12],
                                     [7, 16],
                                     [15, 24],
                                     [21, 32]]))

        b = khatri_rao(np.empty([2, 2]), np.empty([2, 2]))
        assert_array_equal(b.shape, (4, 2))

    def test_number_of_columns_equality(self):
        with pytest.raises(ValueError):
            a = array([[1, 2, 3],
                       [4, 5, 6]])
            b = array([[1, 2],
                       [3, 4]])
            khatri_rao(a, b)

    def test_to_assure_2d_array(self):
        with pytest.raises(ValueError):
            # both arrays are 1-D
            a = array([1, 2, 3])
            b = array([4, 5, 6])
            khatri_rao(a, b)

        with pytest.raises(ValueError):
            # first array is 1-D
            a = array([1, 2, 3])
            b = array([
                [1, 2, 3],
                [4, 5, 6]
            ])
            khatri_rao(a, b)

        with pytest.raises(ValueError):
            # second array is 1-D
            a = array([
                [1, 2, 3],
                [7, 8, 9]
            ])
            b = array([4, 5, 6])
            khatri_rao(a, b)

    def test_equality_of_two_equations(self):
        a = array([[1, 2], [3, 4]])
        b = array([[5, 6], [7, 8]])

        res1 = khatri_rao(a, b)
        res2 = np.vstack([np.kron(a[:, k], b[:, k])
                          for k in range(b.shape[1])]).T

        assert_array_equal(res1, res2)

    def test_empty(self):
        a = np.empty((0, 2))
        b = np.empty((3, 2))
        res = khatri_rao(a, b)
        assert_allclose(res, np.empty((0, 2)))

        a = np.empty((3, 0))
        b = np.empty((5, 0))
        res = khatri_rao(a, b)
        assert_allclose(res, np.empty((15, 0)))

@pytest.mark.parametrize('func',
                         [logm, sqrtm, signm])
def test_disp_dep(func):
    with pytest.deprecated_call():
        func(np.eye(2), disp=False)

def test_blocksize_dep():
    with pytest.deprecated_call():
        sqrtm(np.eye(2), blocksize=10)
