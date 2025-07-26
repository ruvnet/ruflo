# pylint: disable=missing-docstring
import math
import numpy as np

from scipy._lib._array_api import (
    assert_almost_equal, xp_assert_close, xp_assert_equal
)
import pytest
from pytest import raises

from scipy import signal

skip_xp_backends = pytest.mark.skip_xp_backends
xfail_xp_backends = pytest.mark.xfail_xp_backends


class TestBSplines:
    """Test behaviors of B-splines. Some of the values tested against were
    returned as of SciPy 1.1.0 and are included for regression testing
    purposes. Others (at integer points) are compared to theoretical
    expressions (cf. Unser, Aldroubi, Eden, IEEE TSP 1993, Table 1)."""

    @skip_xp_backends(cpu_only=True, exceptions=["cupy"])
    def test_spline_filter(self, xp):
        rng = np.random.RandomState(12457)
        # Test the type-error branch
        raises(TypeError, signal.spline_filter, xp.asarray([0]), 0)
        # Test the real branch
        data_array_real = rng.rand(12, 12)
        # make the magnitude exceed 1, and make some negative
        data_array_real = 10*(1-2*data_array_real)
        data_array_real = xp.asarray(data_array_real)
        result_array_real = xp.asarray(
            [[-.463312621, 8.33391222, .697290949, 5.28390836,
              5.92066474, 6.59452137, 9.84406950, -8.78324188,
              7.20675750, -8.17222994, -4.38633345, 9.89917069],
             [2.67755154, 6.24192170, -3.15730578, 9.87658581,
              -9.96930425, 3.17194115, -4.50919947, 5.75423446,
              9.65979824, -8.29066885, .971416087, -2.38331897],
             [-7.08868346, 4.89887705, -1.37062289, 7.70705838,
              2.51526461, 3.65885497, 5.16786604, -8.77715342e-03,
              4.10533325, 9.04761993, -.577960351, 9.86382519],
             [-4.71444301, -1.68038985, 2.84695116, 1.14315938,
              -3.17127091, 1.91830461, 7.13779687, -5.35737482,
              -9.66586425, -9.87717456, 9.93160672, 4.71948144],
             [9.49551194, -1.92958436, 6.25427993, -9.05582911,
              3.97562282, 7.68232426, -1.04514824, -5.86021443,
              -8.43007451, 5.47528997, 2.06330736, -8.65968112],
             [-8.91720100, 8.87065356, 3.76879937, 2.56222894,
              -.828387146, 8.72288903, 6.42474741, -6.84576083,
              9.94724115, 6.90665380, -6.61084494, -9.44907391],
             [9.25196790, -.774032030, 7.05371046, -2.73505725,
              2.53953305, -1.82889155, 2.95454824, -1.66362046,
              5.72478916, -3.10287679, 1.54017123, -7.87759020],
             [-3.98464539, -2.44316992, -1.12708657, 1.01725672,
              -8.89294671, -5.42145629, -6.16370321, 2.91775492,
              9.64132208, .702499998, -2.02622392, 1.56308431],
             [-2.22050773, 7.89951554, 5.98970713, -7.35861835,
              5.45459283, -7.76427957, 3.67280490, -4.05521315,
              4.51967507, -3.22738749, -3.65080177, 3.05630155],
             [-6.21240584, -.296796126, -8.34800163, 9.21564563,
              -3.61958784, -4.77120006, -3.99454057, 1.05021988e-03,
              -6.95982829, 6.04380797, 8.43181250, -2.71653339],
             [1.19638037, 6.99718842e-02, 6.72020394, -2.13963198,
              3.75309875, -5.70076744, 5.92143551, -7.22150575,
              -3.77114594, -1.11903194, -5.39151466, 3.06620093],
             [9.86326886, 1.05134482, -7.75950607, -3.64429655,
              7.81848957, -9.02270373, 3.73399754, -4.71962549,
              -7.71144306, 3.78263161, 6.46034818, -4.43444731]], dtype=xp.float64)
        xp_assert_close(signal.spline_filter(data_array_real, 0),
                        result_array_real)

    @skip_xp_backends(cpu_only=True, exceptions=["cupy"])
    def test_spline_filter_complex(self, xp):
        rng = np.random.RandomState(12457)
        data_array_complex = rng.rand(7, 7) + rng.rand(7, 7)*1j
        # make the magnitude exceed 1, and make some negative
        data_array_complex = 10*(1+1j-2*data_array_complex)
        data_array_complex = xp.asarray(data_array_complex)

        result_array_complex = xp.asarray(
            [[-4.61489230e-01-1.92994022j, 8.33332443+6.25519943j,
              6.96300745e-01-9.05576038j, 5.28294849+3.97541356j,
              5.92165565+7.68240595j, 6.59493160-1.04542804j,
              9.84503460-5.85946894j],
             [-8.78262329-8.4295969j, 7.20675516+5.47528982j,
              -8.17223072+2.06330729j, -4.38633347-8.65968037j,
              9.89916801-8.91720295j, 2.67755103+8.8706522j,
              6.24192142+3.76879835j],
             [-3.15627527+2.56303072j, 9.87658501-0.82838702j,
              -9.96930313+8.72288895j, 3.17193985+6.42474651j,
              -4.50919819-6.84576082j, 5.75423431+9.94723988j,
              9.65979767+6.90665293j],
             [-8.28993416-6.61064005j, 9.71416473e-01-9.44907284j,
              -2.38331890+9.25196648j, -7.08868170-0.77403212j,
              4.89887714+7.05371094j, -1.37062311-2.73505688j,
              7.70705748+2.5395329j],
             [2.51528406-1.82964492j, 3.65885472+2.95454836j,
              5.16786575-1.66362023j, -8.77737999e-03+5.72478867j,
              4.10533333-3.10287571j, 9.04761887+1.54017115j,
              -5.77960968e-01-7.87758923j],
             [9.86398506-3.98528528j, -4.71444130-2.44316983j,
              -1.68038976-1.12708664j, 2.84695053+1.01725709j,
              1.14315915-8.89294529j, -3.17127085-5.42145538j,
              1.91830420-6.16370344j],
             [7.13875294+2.91851187j, -5.35737514+9.64132309j,
              -9.66586399+0.70250005j, -9.87717438-2.0262239j,
              9.93160629+1.5630846j, 4.71948051-2.22050714j,
              9.49550819+7.8995142j]], dtype=xp.complex128)
        # FIXME: for complex types, the computations are done in
        # single precision (reason unclear). When this is changed,
        # this test needs updating.
        xp_assert_close(signal.spline_filter(data_array_complex, 0),
                        result_array_complex, rtol=1e-6)

    def test_gauss_spline(self, xp):
        assert math.isclose(signal.gauss_spline(0, 0), 1.381976597885342)

        xp_assert_close(signal.gauss_spline(xp.asarray([1.]), 1),
                        xp.asarray([0.04865217]), atol=1e-9
        )

    @skip_xp_backends(np_only=True, reason="deliberate: array-likes are accepted")
    def test_gauss_spline_list(self, xp):
        # regression test for gh-12152 (accept array_like)
        knots = [-1.0, 0.0, -1.0]
        assert_almost_equal(signal.gauss_spline(knots, 3),
                            np.asarray([0.15418033, 0.6909883, 0.15418033])
        )

    @skip_xp_backends(cpu_only=True)
    def test_cspline1d(self, xp):
        xp_assert_equal(signal.cspline1d(xp.asarray([0])),
                        xp.asarray([0.], dtype=xp.float64))
        c1d = xp.asarray([1.21037185, 1.86293902, 2.98834059, 4.11660378,
                          4.78893826], dtype=xp.float64)
        # test lamda != 0
        xp_assert_close(signal.cspline1d(xp.asarray([1., 2, 3, 4, 5]), 1), c1d)
        c1d0 = xp.asarray([0.78683946, 2.05333735, 2.99981113, 3.94741812,
                           5.21051638], dtype=xp.float64)
        xp_assert_close(signal.cspline1d(xp.asarray([1., 2, 3, 4, 5])), c1d0)

    @skip_xp_backends(cpu_only=True)
    def test_qspline1d(self, xp):
        xp_assert_equal(signal.qspline1d(xp.asarray([0])),
                        xp.asarray([0.], dtype=xp.float64))
        # test lamda != 0
        raises(ValueError, signal.qspline1d, xp.asarray([1., 2, 3, 4, 5]), 1.)
        raises(ValueError, signal.qspline1d, xp.asarray([1., 2, 3, 4, 5]), -1.)
        q1d0 = xp.asarray([0.85350007, 2.02441743, 2.99999534, 3.97561055,
                           5.14634135], dtype=xp.float64)
        xp_assert_close(
            signal.qspline1d(xp.asarray([1., 2, 3, 4, 5], dtype=xp.float64)), q1d0
        )

    @skip_xp_backends(cpu_only=True)
    def test_cspline1d_eval(self, xp):
        r = signal.cspline1d_eval(xp.asarray([0., 0], dtype=xp.float64),
                               xp.asarray([0.], dtype=xp.float64))
        xp_assert_close(r, xp.asarray([0.], dtype=xp.float64))

        r = signal.cspline1d_eval(xp.asarray([1., 0, 1], dtype=xp.float64),
                               xp.asarray([], dtype=xp.float64))
        xp_assert_equal(r, xp.asarray([], dtype=xp.float64))
        x = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6]
        dx = x[1] - x[0]
        newx = [-6., -5.5, -5., -4.5, -4., -3.5, -3., -2.5, -2., -1.5, -1.,
                -0.5, 0., 0.5, 1., 1.5, 2., 2.5, 3., 3.5, 4., 4.5, 5., 5.5, 6.,
                6.5, 7., 7.5, 8., 8.5, 9., 9.5, 10., 10.5, 11., 11.5, 12.,
                12.5]
        y = xp.asarray([4.216, 6.864, 3.514, 6.203, 6.759, 7.433, 7.874, 5.879,
                        1.396, 4.094])
        cj = signal.cspline1d(y)
        newy = xp.asarray([6.203, 4.41570658, 3.514, 5.16924703, 6.864, 6.04643068,
                           4.21600281, 6.04643068, 6.864, 5.16924703, 3.514,
                           4.41570658, 6.203, 6.80717667, 6.759, 6.98971173, 7.433,
                           7.79560142, 7.874, 7.41525761, 5.879, 3.18686814, 1.396,
                           2.24889482, 4.094, 2.24889482, 1.396, 3.18686814, 5.879,
                           7.41525761, 7.874, 7.79560142, 7.433, 6.98971173, 6.759,
                           6.80717667, 6.203, 4.41570658], dtype=xp.float64)
        xp_assert_close(
            signal.cspline1d_eval(cj, xp.asarray(newx), dx=dx, x0=x[0]), newy
        )

        with pytest.raises(ValueError,
                            match="Spline coefficients 'cj' must not be empty."):
            signal.cspline1d_eval(xp.asarray([], dtype=xp.float64), 
                                  xp.asarray([0.0], dtype=xp.float64))

    @skip_xp_backends(cpu_only=True)
    def test_qspline1d_eval(self, xp):
        xp_assert_close(signal.qspline1d_eval(xp.asarray([0., 0]), xp.asarray([0.])),
                        xp.asarray([0.])
        )
        xp_assert_equal(signal.qspline1d_eval(xp.asarray([1., 0, 1]), xp.asarray([])),
                        xp.asarray([])
        )
        x = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6]
        dx = x[1] - x[0]
        newx = [-6., -5.5, -5., -4.5, -4., -3.5, -3., -2.5, -2., -1.5, -1.,
                -0.5, 0., 0.5, 1., 1.5, 2., 2.5, 3., 3.5, 4., 4.5, 5., 5.5, 6.,
                6.5, 7., 7.5, 8., 8.5, 9., 9.5, 10., 10.5, 11., 11.5, 12.,
                12.5]
        y = xp.asarray([4.216, 6.864, 3.514, 6.203, 6.759, 7.433, 7.874, 5.879,
                        1.396, 4.094])
        cj = signal.qspline1d(y)
        newy = xp.asarray([6.203, 4.49418159, 3.514, 5.18390821, 6.864, 5.91436915,
                           4.21600002, 5.91436915, 6.864, 5.18390821, 3.514,
                           4.49418159, 6.203, 6.71900226, 6.759, 7.03980488, 7.433,
                           7.81016848, 7.874, 7.32718426, 5.879, 3.23872593, 1.396,
                           2.34046013, 4.094, 2.34046013, 1.396, 3.23872593, 5.879,
                           7.32718426, 7.874, 7.81016848, 7.433, 7.03980488, 6.759,
                           6.71900226, 6.203, 4.49418159], dtype=xp.float64)
        r = signal.qspline1d_eval(
            cj, xp.asarray(newx, dtype=xp.float64), dx=dx, x0=x[0]
        )
        xp_assert_close(r, newy)

        with pytest.raises(ValueError, 
                           match="Spline coefficients 'cj' must not be empty."):
            signal.qspline1d_eval(xp.asarray([], dtype=xp.float64), 
                                  xp.asarray([0.0], dtype=xp.float64))


# i/o dtypes with scipy 1.9.1, likely fixed by backwards compat
sepfir_dtype_map = {np.uint8: np.float32, int: np.float64,
                    np.float32: np.float32, float: float,
                    np.complex64: np.complex64, complex: complex}


@skip_xp_backends(np_only=True)
class TestSepfir2d:
    def test_sepfir2d_invalid_filter(self, xp):
        filt = xp.asarray([1.0, 2.0, 4.0, 2.0, 1.0])
        image = np.random.rand(7, 9)
        image = xp.asarray(image)
        # No error for odd lengths
        signal.sepfir2d(image, filt, filt[2:])

        # Row or column filter must be odd
        with pytest.raises(ValueError, match="odd length"):
            signal.sepfir2d(image, filt, filt[1:])
        with pytest.raises(ValueError, match="odd length"):
            signal.sepfir2d(image, filt[1:], filt)

        # Filters must be 1-dimensional
        with pytest.raises(ValueError, match="object too deep"):
            signal.sepfir2d(image, xp.reshape(filt, (1, -1)), filt)
        with pytest.raises(ValueError, match="object too deep"):
            signal.sepfir2d(image, filt, xp.reshape(filt, (1, -1)))

    def test_sepfir2d_invalid_image(self, xp):
        filt = xp.asarray([1.0, 2.0, 4.0, 2.0, 1.0])
        image = np.random.rand(8, 8)
        image = xp.asarray(image)

        # Image must be 2 dimensional
        with pytest.raises(ValueError, match="object too deep"):
            signal.sepfir2d(xp.reshape(image, (4, 4, 4)), filt, filt)

        with pytest.raises(ValueError, match="object of too small depth"):
            signal.sepfir2d(image[0, :], filt, filt)

    @pytest.mark.parametrize('dtyp',
        [np.uint8, int, np.float32, float, np.complex64, complex]
    )
    def test_simple(self, dtyp, xp):
        # test values on a paper-and-pencil example
        a = np.array([[1, 2, 3, 3, 2, 1],
                      [1, 2, 3, 3, 2, 1],
                      [1, 2, 3, 3, 2, 1],
                      [1, 2, 3, 3, 2, 1]], dtype=dtyp)
        h1 = [0.5, 1, 0.5]
        h2 = [1]
        result = signal.sepfir2d(a, h1, h2)
        dt = sepfir_dtype_map[dtyp]
        expected = np.asarray([[2.5, 4. , 5.5, 5.5, 4. , 2.5],
                               [2.5, 4. , 5.5, 5.5, 4. , 2.5],
                               [2.5, 4. , 5.5, 5.5, 4. , 2.5],
                               [2.5, 4. , 5.5, 5.5, 4. , 2.5]], dtype=dt)
        xp_assert_close(result, expected, atol=1e-16)

        result = signal.sepfir2d(a, h2, h1)
        expected = np.asarray([[2., 4., 6., 6., 4., 2.],
                               [2., 4., 6., 6., 4., 2.],
                               [2., 4., 6., 6., 4., 2.],
                               [2., 4., 6., 6., 4., 2.]], dtype=dt)
        xp_assert_close(result, expected, atol=1e-16)

    @skip_xp_backends(np_only=True, reason="TODO: convert this test")
    @pytest.mark.parametrize('dtyp',
        [np.uint8, int, np.float32, float, np.complex64, complex]
    )
    def test_strided(self, dtyp, xp):
        a = np.array([[1, 2, 3, 3, 2, 1, 1, 2, 3],
                     [1, 2, 3, 3, 2, 1, 1, 2, 3],
                     [1, 2, 3, 3, 2, 1, 1, 2, 3],
                     [1, 2, 3, 3, 2, 1, 1, 2, 3]])
        h1, h2 = [0.5, 1, 0.5], [1]
        result_strided = signal.sepfir2d(a[:, ::2], h1, h2)
        result_contig = signal.sepfir2d(a[:, ::2].copy(), h1, h2)
        xp_assert_close(result_strided, result_contig, atol=1e-15)
        assert result_strided.dtype == result_contig.dtype

    @skip_xp_backends(np_only=True, reason="TODO: convert this test")
    @pytest.mark.xfail(reason="XXX: filt.size > image.shape: flaky")
    def test_sepfir2d_strided_2(self, xp):
        # XXX: this test is flaky: fails on some reruns, with
        # result[0, 1] and result[1, 1] being ~1e+224.
        filt = np.array([1.0, 2.0, 4.0, 2.0, 1.0, 3.0, 2.0])
        image = np.random.rand(4, 4)

        expected = np.asarray([[36.018162, 30.239061, 38.71187 , 43.878183],
                                [38.180999, 35.824583, 43.525247, 43.874945],
                                [43.269533, 40.834018, 46.757772, 44.276423],
                                [49.120928, 39.681844, 43.596067, 45.085854]])
        xp_assert_close(signal.sepfir2d(image, filt, filt[::3]), expected)

    @skip_xp_backends(np_only=True, reason="TODO: convert this test")
    @pytest.mark.xfail(reason="XXX: flaky. pointers OOB on some platforms")
    @pytest.mark.parametrize('dtyp',
        [np.uint8, int, np.float32, float, np.complex64, complex]
    )
    def test_sepfir2d_strided_3(self, dtyp, xp):
        # NB: 'image' and 'filt' dtypes match here. Otherwise we can run into
        # unsafe casting errors for many combinations. Historically, dtype handling
        # in `sepfir2d` is a tad baroque; fixing it is an enhancement.
        filt = np.array([1, 2, 4, 2, 1, 3, 2], dtype=dtyp)
        image = np.asarray([[0, 3, 0, 1, 2],
                            [2, 2, 3, 3, 3],
                            [0, 1, 3, 0, 3],
                            [2, 3, 0, 1, 3],
                            [3, 3, 2, 1, 2]], dtype=dtyp)

        expected = [[123., 101.,  91., 136., 127.],
                    [133., 125., 126., 152., 160.],
                    [136., 137., 150., 162., 177.],
                    [133., 124., 132., 148., 147.],
                    [173., 158., 152., 164., 141.]]
        expected = np.asarray(expected)
        result = signal.sepfir2d(image, filt, filt[::3])
        xp_assert_close(result, expected, atol=1e-15)
        assert result.dtype == sepfir_dtype_map[dtyp]

        expected = [[22., 35., 41., 31., 47.],
                    [27., 39., 48., 47., 55.],
                    [33., 42., 49., 53., 59.],
                    [39., 44., 41., 36., 48.],
                    [67., 62., 47., 34., 46.]]
        expected = np.asarray(expected)
        result = signal.sepfir2d(image, filt[::3], filt[::3])
        xp_assert_close(result, expected, atol=1e-15)
        assert result.dtype == sepfir_dtype_map[dtyp]


def test_cspline2d(xp):
    rng = np.random.RandomState(181819142)
    image = rng.rand(71, 73)
    signal.cspline2d(image, 8.0)


def test_qspline2d(xp):
    rng = np.random.RandomState(181819143)
    image = rng.rand(71, 73)
    signal.qspline2d(image)
