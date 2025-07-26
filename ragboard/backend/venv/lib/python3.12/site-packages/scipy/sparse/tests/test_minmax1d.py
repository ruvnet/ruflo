"""Test of min-max 1D features of sparse array classes"""

import pytest

import numpy as np

from numpy.testing import assert_equal, assert_array_equal

from scipy.sparse import coo_array, csr_array, csc_array, bsr_array
from scipy.sparse import coo_matrix, csr_matrix, csc_matrix, bsr_matrix
from scipy.sparse._sputils import isscalarlike


def toarray(a):
    if isinstance(a, np.ndarray) or isscalarlike(a):
        return a
    return a.toarray()


formats_for_minmax = [bsr_array, coo_array, csc_array, csr_array]
formats_for_minmax_supporting_1d = [coo_array, csr_array]


@pytest.mark.parametrize("spcreator", formats_for_minmax_supporting_1d)
class Test_MinMaxMixin1D:
    def test_minmax(self, spcreator):
        D = np.arange(5)
        X = spcreator(D)

        assert_equal(X.min(), 0)
        assert_equal(X.max(), 4)
        assert_equal((-X).min(), -4)
        assert_equal((-X).max(), 0)

    def test_minmax_axis(self, spcreator):
        D = np.arange(50)
        X = spcreator(D)

        for axis in [0, -1]:
            assert_array_equal(
                toarray(X.max(axis=axis)), D.max(axis=axis, keepdims=True)
            )
            assert_array_equal(
                toarray(X.min(axis=axis)), D.min(axis=axis, keepdims=True)
            )
        for axis in [-2, 1]:
            with pytest.raises(ValueError, match="axis out of range"):
                X.min(axis=axis)
            with pytest.raises(ValueError, match="axis out of range"):
                X.max(axis=axis)

    def test_numpy_minmax(self, spcreator):
        dat = np.array([0, 1, 2])
        datsp = spcreator(dat)
        assert_array_equal(np.min(datsp), np.min(dat))
        assert_array_equal(np.max(datsp), np.max(dat))


    def test_argmax(self, spcreator):
        D1 = np.array([-1, 5, 2, 3])
        D2 = np.array([0, 0, -1, -2])
        D3 = np.array([-1, -2, -3, -4])
        D4 = np.array([1, 2, 3, 4])
        D5 = np.array([1, 2, 0, 0])

        for D in [D1, D2, D3, D4, D5]:
            mat = spcreator(D)

            assert_equal(mat.argmax(), np.argmax(D))
            assert_equal(mat.argmin(), np.argmin(D))

            assert_equal(mat.argmax(axis=0), np.argmax(D, axis=0))
            assert_equal(mat.argmin(axis=0), np.argmin(D, axis=0))

        D6 = np.empty((0,))

        for axis in [None, 0]:
            mat = spcreator(D6)
            with pytest.raises(ValueError, match="to an empty matrix"):
                mat.argmin(axis=axis)
            with pytest.raises(ValueError, match="to an empty matrix"):
                mat.argmax(axis=axis)


@pytest.mark.parametrize("spcreator", formats_for_minmax)
class Test_ShapeMinMax2DWithAxis:
    def test_minmax(self, spcreator):
        dat = np.array([[-1, 5, 0, 3], [0, 0, -1, -2], [0, 0, 1, 2]])
        datsp = spcreator(dat)

        for (spminmax, npminmax) in [
            (datsp.min, np.min),
            (datsp.max, np.max),
            (datsp.nanmin, np.nanmin),
            (datsp.nanmax, np.nanmax),
        ]:
            for ax, result_shape in [(0, (4,)), (1, (3,))]:
                assert_equal(toarray(spminmax(axis=ax)), npminmax(dat, axis=ax))
                assert_equal(spminmax(axis=ax).shape, result_shape)
                assert spminmax(axis=ax).format == "coo"

        for spminmax in [datsp.argmin, datsp.argmax]:
            for ax in [0, 1]:
                assert isinstance(spminmax(axis=ax), np.ndarray)

        # verify spmatrix behavior
        spmat_form = {
            'coo': coo_matrix,
            'csr': csr_matrix,
            'csc': csc_matrix,
            'bsr': bsr_matrix,
        }
        datspm = spmat_form[datsp.format](dat)

        for spm, npm in [
            (datspm.min, np.min),
            (datspm.max, np.max),
            (datspm.nanmin, np.nanmin),
            (datspm.nanmax, np.nanmax),
        ]:
            for ax, result_shape in [(0, (1, 4)), (1, (3, 1))]:
                assert_equal(toarray(spm(axis=ax)), npm(dat, axis=ax, keepdims=True))
                assert_equal(spm(axis=ax).shape, result_shape)
                assert spm(axis=ax).format == "coo"

        for spminmax in [datspm.argmin, datspm.argmax]:
            for ax in [0, 1]:
                assert isinstance(spminmax(axis=ax), np.ndarray)
