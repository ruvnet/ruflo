import math

import numpy as np
from numpy import array
from numpy.testing import suppress_warnings
import pytest
from pytest import raises as assert_raises

from scipy.fft import fft
from scipy.signal import windows, get_window, resample
from scipy._lib._array_api import (
     xp_assert_close, xp_assert_equal, array_namespace, is_torch, is_jax, is_cupy,
     assert_array_almost_equal, SCIPY_DEVICE, is_numpy
)

skip_xp_backends = pytest.mark.skip_xp_backends
xfail_xp_backends = pytest.mark.xfail_xp_backends


window_funcs = [
    ('boxcar', ()),
    ('triang', ()),
    ('parzen', ()),
    ('bohman', ()),
    ('blackman', ()),
    ('nuttall', ()),
    ('blackmanharris', ()),
    ('flattop', ()),
    ('bartlett', ()),
    ('barthann', ()),
    ('hamming', ()),
    ('kaiser', (1,)),
    ('dpss', (2,)),
    ('gaussian', (0.5,)),
    ('general_gaussian', (1.5, 2)),
    ('chebwin', (1,)),
    ('cosine', ()),
    ('hann', ()),
    ('exponential', ()),
    ('taylor', ()),
    ('tukey', (0.5,)),
    ('lanczos', ()),
    ]


class TestBartHann:

    def test_basic(self, xp):
        xp_assert_close(windows.barthann(6, sym=True, xp=xp),
                        xp.asarray([0, 0.35857354213752, 0.8794264578624801,
                         0.8794264578624801, 0.3585735421375199, 0], dtype=xp.float64),
                        rtol=1e-15, atol=1e-15)
        xp_assert_close(windows.barthann(7, xp=xp),
                        xp.asarray([0, 0.27, 0.73, 1.0, 0.73, 0.27, 0],
                                   dtype=xp.float64),
                        rtol=1e-15, atol=1e-15)
        xp_assert_close(windows.barthann(6, False, xp=xp),
                        xp.asarray([0, 0.27, 0.73, 1.0, 0.73, 0.27], dtype=xp.float64),
                        rtol=1e-15, atol=1e-15)


class TestBartlett:

    def test_basic(self, xp):
        xp_assert_close(windows.bartlett(6, xp=xp),
                        xp.asarray([0, 0.4, 0.8, 0.8, 0.4, 0], dtype=xp.float64))
        xp_assert_close(windows.bartlett(7, xp=xp),
                        xp.asarray([0, 1/3, 2/3, 1.0, 2/3, 1/3, 0], dtype=xp.float64))
        xp_assert_close(windows.bartlett(6, False, xp=xp),
                        xp.asarray([0, 1/3, 2/3, 1.0, 2/3, 1/3], dtype=xp.float64))


class TestBlackman:

    def test_basic(self, xp):
        xp_assert_close(windows.blackman(6, sym=False, xp=xp),
                        xp.asarray([0, 0.13, 0.63, 1.0, 0.63, 0.13], dtype=xp.float64),
                        atol=1e-14)
        xp_assert_close(windows.blackman(7, sym=False, xp=xp),
                        xp.asarray([0, 0.09045342435412804, 0.4591829575459636,
                                    0.9203636180999081, 0.9203636180999081,
                                    0.4591829575459636, 0.09045342435412804],
                                    dtype=xp.float64),
                        atol=1e-8)
        xp_assert_close(windows.blackman(6, xp=xp),
                        xp.asarray([0, 0.2007701432625305, 0.8492298567374694,
                                    0.8492298567374694, 0.2007701432625305, 0],
                                    dtype=xp.float64),
                        atol=1e-14)
        xp_assert_close(windows.blackman(7, True, xp=xp),
                        xp.asarray([0, 0.13, 0.63, 1.0, 0.63, 0.13, 0],
                        dtype=xp.float64), atol=1e-14)


class TestBlackmanHarris:

    def test_basic(self, xp):
        xp_assert_close(windows.blackmanharris(6, False, xp=xp),
                        xp.asarray([6.0e-05, 0.055645, 0.520575,
                                    1.0, 0.520575, 0.055645], dtype=xp.float64))
        xp_assert_close(windows.blackmanharris(7, sym=False, xp=xp),
                        xp.asarray([6.0e-05, 0.03339172347815117, 0.332833504298565,
                                    0.8893697722232837, 0.8893697722232838,
                                    0.3328335042985652, 0.03339172347815122],
                                    dtype=xp.float64))
        xp_assert_close(windows.blackmanharris(6, xp=xp),
                        xp.asarray([6.0e-05, 0.1030114893456638, 0.7938335106543362,
                                    0.7938335106543364, 0.1030114893456638, 6.0e-05],
                                    dtype=xp.float64))
        xp_assert_close(windows.blackmanharris(7, sym=True, xp=xp),
                        xp.asarray([6.0e-05, 0.055645, 0.520575, 1.0, 0.520575,
                                    0.055645, 6.0e-05], dtype=xp.float64))


@skip_xp_backends('jax.numpy', reason='item assignment')
class TestTaylor:

    def test_normalized(self, xp):
        """Tests windows of small length that are normalized to 1. See the
        documentation for the Taylor window for more information on
        normalization.
        """
        xp_assert_close(windows.taylor(1, 2, 15, xp=xp),
                        xp.asarray([1.0], dtype=xp.float64))
        xp_assert_close(
            windows.taylor(5, 2, 15, xp=xp),
            xp.asarray([0.75803341, 0.90757699, 1.0, 0.90757699, 0.75803341],
                       dtype=xp.float64)
        )
        xp_assert_close(
            windows.taylor(6, 2, 15, xp=xp),
            xp.asarray([
                0.7504082, 0.86624416, 0.98208011, 0.98208011, 0.86624416,
                0.7504082
            ], dtype=xp.float64)
        )

    def test_non_normalized(self, xp):
        """Test windows of small length that are not normalized to 1. See
        the documentation for the Taylor window for more information on
        normalization.
        """
        xp_assert_close(
            windows.taylor(5, 2, 15, norm=False, xp=xp),
            xp.asarray([
                0.87508054, 1.04771499, 1.15440894, 1.04771499, 0.87508054
            ], dtype=xp.float64)
        )
        xp_assert_close(
            windows.taylor(6, 2, 15, norm=False, xp=xp),
            xp.asarray([
                0.86627793, 1.0, 1.13372207, 1.13372207, 1.0, 0.86627793
            ], dtype=xp.float64)
        )

    @skip_xp_backends(cpu_only=True)
    def test_correctness(self, xp):
        """This test ensures the correctness of the implemented Taylor
        Windowing function. A Taylor Window of 1024 points is created, its FFT
        is taken, and the Peak Sidelobe Level (PSLL) and 3dB and 18dB bandwidth
        are found and checked.

        A publication from Sandia National Laboratories was used as reference
        for the correctness values [1]_.

        References
        -----
        .. [1] Armin Doerry, "Catalog of Window Taper Functions for
               Sidelobe Control", 2017.
               https://www.researchgate.net/profile/Armin_Doerry/publication/316281181_Catalog_of_Window_Taper_Functions_for_Sidelobe_Control/links/58f92cb2a6fdccb121c9d54d/Catalog-of-Window-Taper-Functions-for-Sidelobe-Control.pdf
        """
        M_win = 1024
        N_fft = 131072
        # Set norm=False for correctness as the values obtained from the
        # scientific publication do not normalize the values. Normalizing
        # changes the sidelobe level from the desired value.
        w = windows.taylor(M_win, nbar=4, sll=35, norm=False, sym=False, xp=xp)
        f = fft(w, N_fft)

        f_np = np.asarray(f)
        spec = 20 * np.log10(np.abs(f_np / np.max(f_np)))

        first_zero = np.argmax(np.diff(spec) > 0)

        PSLL = np.max(spec[first_zero:-first_zero])

        BW_3dB = 2*np.argmax(spec <= -3.0102999566398121) / N_fft * M_win
        BW_18dB = 2*np.argmax(spec <= -18.061799739838872) / N_fft * M_win

        assert math.isclose(PSLL, -35.1672, abs_tol=1)
        assert math.isclose(BW_3dB, 1.1822, abs_tol=0.1)
        assert math.isclose(BW_18dB, 2.6112, abs_tol=0.1)


class TestBohman:

    def test_basic(self, xp):
        xp_assert_close(windows.bohman(6, xp=xp),
                        xp.asarray([0, 0.1791238937062839, 0.8343114522576858,
                                    0.8343114522576858, 0.1791238937062838, 0],
                                    dtype=xp.float64))
        xp_assert_close(windows.bohman(7, sym=True, xp=xp),
                        xp.asarray([0, 0.1089977810442293, 0.6089977810442293, 1.0,
                                    0.6089977810442295, 0.1089977810442293, 0],
                                    dtype=xp.float64))
        xp_assert_close(windows.bohman(6, False, xp=xp),
                        xp.asarray([0, 0.1089977810442293, 0.6089977810442293, 1.0,
                                    0.6089977810442295, 0.1089977810442293],
                                    dtype=xp.float64))


class TestBoxcar:

    def test_basic(self, xp):
        xp_assert_close(windows.boxcar(6, xp=xp),
                        xp.asarray([1.0, 1, 1, 1, 1, 1], dtype=xp.float64))
        xp_assert_close(windows.boxcar(7, xp=xp),
                        xp.asarray([1.0, 1, 1, 1, 1, 1, 1], dtype=xp.float64))
        xp_assert_close(windows.boxcar(6, False, xp=xp),
                        xp.asarray([1.0, 1, 1, 1, 1, 1], dtype=xp.float64))


cheb_odd_true = [0.200938, 0.107729, 0.134941, 0.165348,
                 0.198891, 0.235450, 0.274846, 0.316836,
                 0.361119, 0.407338, 0.455079, 0.503883,
                 0.553248, 0.602637, 0.651489, 0.699227,
                 0.745266, 0.789028, 0.829947, 0.867485,
                 0.901138, 0.930448, 0.955010, 0.974482,
                 0.988591, 0.997138, 1.000000, 0.997138,
                 0.988591, 0.974482, 0.955010, 0.930448,
                 0.901138, 0.867485, 0.829947, 0.789028,
                 0.745266, 0.699227, 0.651489, 0.602637,
                 0.553248, 0.503883, 0.455079, 0.407338,
                 0.361119, 0.316836, 0.274846, 0.235450,
                 0.198891, 0.165348, 0.134941, 0.107729,
                 0.200938]

cheb_even_true = [0.203894, 0.107279, 0.133904,
                  0.163608, 0.196338, 0.231986,
                  0.270385, 0.311313, 0.354493,
                  0.399594, 0.446233, 0.493983,
                  0.542378, 0.590916, 0.639071,
                  0.686302, 0.732055, 0.775783,
                  0.816944, 0.855021, 0.889525,
                  0.920006, 0.946060, 0.967339,
                  0.983557, 0.994494, 1.000000,
                  1.000000, 0.994494, 0.983557,
                  0.967339, 0.946060, 0.920006,
                  0.889525, 0.855021, 0.816944,
                  0.775783, 0.732055, 0.686302,
                  0.639071, 0.590916, 0.542378,
                  0.493983, 0.446233, 0.399594,
                  0.354493, 0.311313, 0.270385,
                  0.231986, 0.196338, 0.163608,
                  0.133904, 0.107279, 0.203894]


@skip_xp_backends('jax.numpy', reason='item assignment')
@skip_xp_backends('dask.array', reason='data-dependent output shapes')
class TestChebWin:

    def test_basic(self, xp):
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "This window is not suitable")
            xp_assert_close(windows.chebwin(6, 100, xp=xp),
                            xp.asarray([0.1046401879356917, 0.5075781475823447,
                                        1.0, 1.0,
                                        0.5075781475823447, 0.1046401879356917],
                                        dtype=xp.float64),
                            atol=1e-8
            )
            xp_assert_close(windows.chebwin(7, 100, xp=xp),
                            xp.asarray([0.05650405062850233, 0.316608530648474,
                                        0.7601208123539079, 1.0, 0.7601208123539079,
                                        0.316608530648474, 0.05650405062850233],
                                        dtype=xp.float64))
            xp_assert_close(windows.chebwin(6, 10, xp=xp),
                            xp.asarray([1.0, 0.6071201674458373, 0.6808391469897297,
                                        0.6808391469897297, 0.6071201674458373, 1.0],
                                        dtype=xp.float64))
            xp_assert_close(windows.chebwin(7, 10, xp=xp),
                            xp.asarray([1.0, 0.5190521247588651, 0.5864059018130382,
                                        0.6101519801307441, 0.5864059018130382,
                                        0.5190521247588651, 1.0], dtype=xp.float64))
            xp_assert_close(windows.chebwin(6, 10, False, xp=xp),
                            xp.asarray([1.0, 0.5190521247588651, 0.5864059018130382,
                                        0.6101519801307441, 0.5864059018130382,
                                        0.5190521247588651], dtype=xp.float64))

    def test_cheb_odd_high_attenuation(self, xp):
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "This window is not suitable")
            cheb_odd = windows.chebwin(53, at=-40, xp=xp)
        assert_array_almost_equal(cheb_odd, xp.asarray(cheb_odd_true), decimal=4)

    def test_cheb_even_high_attenuation(self, xp):
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "This window is not suitable")
            cheb_even = windows.chebwin(54, at=40, xp=xp)
        assert_array_almost_equal(cheb_even, xp.asarray(cheb_even_true), decimal=4)

    def test_cheb_odd_low_attenuation(self, xp):
        cheb_odd_low_at_true = xp.asarray([1.000000, 0.519052, 0.586405,
                                           0.610151, 0.586405, 0.519052,
                                           1.000000], dtype=xp.float64)
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "This window is not suitable")
            cheb_odd = windows.chebwin(7, at=10, xp=xp)
        assert_array_almost_equal(cheb_odd, cheb_odd_low_at_true, decimal=4)

    def test_cheb_even_low_attenuation(self, xp):
        cheb_even_low_at_true = xp.asarray([1.000000, 0.451924, 0.51027,
                                            0.541338, 0.541338, 0.51027,
                                            0.451924, 1.000000], dtype=xp.float64)
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "This window is not suitable")
            cheb_even = windows.chebwin(8, at=-10, xp=xp)
        assert_array_almost_equal(cheb_even, cheb_even_low_at_true, decimal=4)


exponential_data = {
    (4, None, 0.2, False):
        array([4.53999297624848542e-05,
               6.73794699908546700e-03, 1.00000000000000000e+00,
               6.73794699908546700e-03]),
    (4, None, 0.2, True): array([0.00055308437014783, 0.0820849986238988,
                                 0.0820849986238988, 0.00055308437014783]),
    (4, None, 1.0, False): array([0.1353352832366127, 0.36787944117144233, 1.,
                                  0.36787944117144233]),
    (4, None, 1.0, True): array([0.22313016014842982, 0.60653065971263342,
                                 0.60653065971263342, 0.22313016014842982]),
    (4, 2, 0.2, False):
        array([4.53999297624848542e-05, 6.73794699908546700e-03,
               1.00000000000000000e+00, 6.73794699908546700e-03]),
    (4, 2, 0.2, True): None,
    (4, 2, 1.0, False): array([0.1353352832366127, 0.36787944117144233, 1.,
                               0.36787944117144233]),
    (4, 2, 1.0, True): None,
    (5, None, 0.2, True):
        array([4.53999297624848542e-05,
               6.73794699908546700e-03, 1.00000000000000000e+00,
               6.73794699908546700e-03, 4.53999297624848542e-05]),
    (5, None, 1.0, True): array([0.1353352832366127, 0.36787944117144233, 1.,
                                 0.36787944117144233, 0.1353352832366127]),
    (5, 2, 0.2, True): None,
    (5, 2, 1.0, True): None
}


def test_exponential(xp):
    for k, v in exponential_data.items():
        if v is None:
            assert_raises(ValueError, windows.exponential, *k, xp=xp)
        else:
            win = windows.exponential(*k, xp=xp)
            xp_assert_close(win, xp.asarray(v), rtol=1e-14)


class TestFlatTop:

    def test_basic(self, xp):
        xp_assert_close(windows.flattop(6, sym=False, xp=xp),
                        xp.asarray([-0.000421051, -0.051263156, 0.19821053, 1.0,
                                     0.19821053, -0.051263156], dtype=xp.float64))
        xp_assert_close(windows.flattop(7, sym=False, xp=xp),
                        xp.asarray([-0.000421051, -0.03684078115492348,
                                     0.01070371671615342, 0.7808739149387698,
                                     0.7808739149387698, 0.01070371671615342,
                                    -0.03684078115492348], dtype=xp.float64))
        xp_assert_close(windows.flattop(6, xp=xp),
                        xp.asarray([-0.000421051, -0.0677142520762119,
                                     0.6068721525762117, 0.6068721525762117,
                                    -0.0677142520762119, -0.000421051],
                                    dtype=xp.float64))
        xp_assert_close(windows.flattop(7, True, xp=xp),
                        xp.asarray([-0.000421051, -0.051263156, 0.19821053, 1.0,
                                     0.19821053, -0.051263156, -0.000421051],
                                     dtype=xp.float64))


class TestGaussian:

    def test_basic(self, xp):
        xp_assert_close(windows.gaussian(6, 1.0, xp=xp),
                        xp.asarray([0.04393693362340742, 0.3246524673583497,
                                    0.8824969025845955, 0.8824969025845955,
                                    0.3246524673583497, 0.04393693362340742],
                                    dtype=xp.float64))
        xp_assert_close(windows.gaussian(7, 1.2, xp=xp),
                        xp.asarray([0.04393693362340742, 0.2493522087772962,
                                    0.7066482778577162, 1.0, 0.7066482778577162,
                                    0.2493522087772962, 0.04393693362340742],
                                    dtype=xp.float64))
        xp_assert_close(windows.gaussian(7, 3, xp=xp),
                        xp.asarray([0.6065306597126334, 0.8007374029168081,
                                    0.9459594689067654, 1.0, 0.9459594689067654,
                                    0.8007374029168081, 0.6065306597126334],
                                    dtype=xp.float64))
        xp_assert_close(windows.gaussian(6, 3, False, xp=xp),
                        xp.asarray([0.6065306597126334, 0.8007374029168081,
                                    0.9459594689067654, 1.0, 0.9459594689067654,
                                    0.8007374029168081], dtype=xp.float64))


class TestGeneralCosine:

    def test_basic(self, xp):
        a = xp.asarray([0.5, 0.3, 0.2])
        xp_assert_close(windows.general_cosine(5, a),
                        xp.asarray([0.4, 0.3, 1, 0.3, 0.4], dtype=xp.float64))

        a = xp.asarray([0.5, 0.3, 0.2])
        xp_assert_close(windows.general_cosine(4, a, sym=False),
                        xp.asarray([0.4, 0.3, 1, 0.3], dtype=xp.float64))


class TestGeneralHamming:

    def test_basic(self, xp):
        xp_assert_close(windows.general_hamming(5, 0.7, xp=xp),
                        xp.asarray([0.4, 0.7, 1.0, 0.7, 0.4], dtype=xp.float64))
        xp_assert_close(windows.general_hamming(5, 0.75, sym=False, xp=xp),
                        xp.asarray([0.5, 0.6727457514, 0.9522542486,
                                    0.9522542486, 0.6727457514], dtype=xp.float64))
        xp_assert_close(windows.general_hamming(6, 0.75, sym=True, xp=xp),
                        xp.asarray([0.5, 0.6727457514, 0.9522542486,
                                    0.9522542486, 0.6727457514, 0.5], dtype=xp.float64))


class TestHamming:

    def test_basic(self, xp):
        xp_assert_close(windows.hamming(6, False, xp=xp),
                        xp.asarray([0.08, 0.31, 0.77, 1.0, 0.77, 0.31],
                                   dtype=xp.float64))
        xp_assert_close(windows.hamming(7, sym=False, xp=xp),
                        xp.asarray([0.08, 0.2531946911449826, 0.6423596296199047,
                                    0.9544456792351128, 0.9544456792351128,
                                    0.6423596296199047, 0.2531946911449826],
                                    dtype=xp.float64))
        xp_assert_close(windows.hamming(6, xp=xp),
                        xp.asarray([0.08, 0.3978521825875242, 0.9121478174124757,
                                    0.9121478174124757, 0.3978521825875242, 0.08],
                                    dtype=xp.float64))
        xp_assert_close(windows.hamming(7, sym=True, xp=xp),
                        xp.asarray([0.08, 0.31, 0.77, 1.0, 0.77, 0.31, 0.08],
                                   dtype=xp.float64))


class TestHann:

    def test_basic(self, xp):
        xp_assert_close(windows.hann(6, sym=False, xp=xp),
                        xp.asarray([0, 0.25, 0.75, 1.0, 0.75, 0.25], dtype=xp.float64),
                        rtol=1e-15, atol=1e-15)
        xp_assert_close(windows.hann(7, sym=False, xp=xp),
                        xp.asarray([0, 0.1882550990706332, 0.6112604669781572,
                                    0.9504844339512095, 0.9504844339512095,
                                    0.6112604669781572, 0.1882550990706332],
                                    dtype=xp.float64),
                        rtol=1e-15, atol=1e-15)
        xp_assert_close(windows.hann(6, True, xp=xp),
                        xp.asarray([0, 0.3454915028125263, 0.9045084971874737,
                                    0.9045084971874737, 0.3454915028125263, 0],
                                    dtype=xp.float64),
                        rtol=1e-15, atol=1e-15)
        xp_assert_close(windows.hann(7, xp=xp),
                        xp.asarray([0, 0.25, 0.75, 1.0, 0.75, 0.25, 0],
                        dtype=xp.float64),
                        rtol=1e-15, atol=1e-15)


class TestKaiser:

    def test_basic(self, xp):
        xp_assert_close(windows.kaiser(6, 0.5, xp=xp),
                        xp.asarray([0.9403061933191572, 0.9782962393705389,
                                    0.9975765035372042, 0.9975765035372042,
                                    0.9782962393705389, 0.9403061933191572],
                                    dtype=xp.float64))
        xp_assert_close(windows.kaiser(7, 0.5, xp=xp),
                        xp.asarray([0.9403061933191572, 0.9732402256999829,
                                    0.9932754654413773, 1.0, 0.9932754654413773,
                                    0.9732402256999829, 0.9403061933191572],
                                    dtype=xp.float64))
        xp_assert_close(windows.kaiser(6, 2.7, xp=xp),
                        xp.asarray([0.2603047507678832, 0.6648106293528054,
                                    0.9582099802511439, 0.9582099802511439,
                                    0.6648106293528054, 0.2603047507678832],
                                    dtype=xp.float64))
        xp_assert_close(windows.kaiser(7, 2.7, xp=xp),
                        xp.asarray([0.2603047507678832, 0.5985765418119844,
                                    0.8868495172060835, 1.0, 0.8868495172060835,
                                    0.5985765418119844, 0.2603047507678832],
                                    dtype=xp.float64))
        xp_assert_close(windows.kaiser(6, 2.7, False, xp=xp),
                        xp.asarray([0.2603047507678832, 0.5985765418119844,
                                    0.8868495172060835, 1.0, 0.8868495172060835,
                                    0.5985765418119844], dtype=xp.float64))


class TestKaiserBesselDerived:

    def test_basic(self, xp):
        # cover case `M < 1`
        w = windows.kaiser_bessel_derived(0.5, beta=4.0, xp=xp)
        xp_assert_equal(w, xp.asarray([]))

        M = 100
        w = windows.kaiser_bessel_derived(M, beta=4.0, xp=xp)
        w2 = windows.get_window(('kaiser bessel derived', 4.0),
                                M, fftbins=False, xp=xp)
        xp_assert_close(w, w2)

        # Test for Princen-Bradley condition
        actual = w[:M // 2] ** 2 + w[-M // 2:] ** 2
        xp_assert_close(actual, xp.ones(actual.shape, dtype=actual.dtype))

        # Test actual values from other implementations
        # M = 2:  sqrt(2) / 2
        # M = 4:  0.518562710536, 0.855039598640
        # M = 6:  0.436168993154, 0.707106781187, 0.899864772847
        # Ref:https://github.com/scipy/scipy/pull/4747#issuecomment-172849418
        actual = windows.kaiser_bessel_derived(2, beta=np.pi / 2, xp=xp)[:1]
        desired = xp.ones_like(actual) * math.sqrt(2) / 2.0
        xp_assert_close(actual, desired)

        xp_assert_close(windows.kaiser_bessel_derived(4, beta=np.pi / 2, xp=xp)[:2],
                        xp.asarray([0.518562710536, 0.855039598640], dtype=xp.float64))

        xp_assert_close(windows.kaiser_bessel_derived(6, beta=np.pi / 2, xp=xp)[:3],
                        xp.asarray([0.436168993154, 0.707106781187, 0.899864772847],
                                   dtype=xp.float64))

    def test_exceptions(self, xp):
        M = 100
        # Assert ValueError for odd window length
        msg = ("Kaiser-Bessel Derived windows are only defined for even "
               "number of points")
        with assert_raises(ValueError, match=msg):
            windows.kaiser_bessel_derived(M + 1, beta=4., xp=xp)

        # Assert ValueError for non-symmetric setting
        msg = ("Kaiser-Bessel Derived windows are only defined for "
               "symmetric shapes")
        with assert_raises(ValueError, match=msg):
            windows.kaiser_bessel_derived(M + 1, beta=4., sym=False, xp=xp)


class TestNuttall:

    def test_basic(self, xp):
        xp_assert_close(windows.nuttall(6, sym=False, xp=xp),
                        xp.asarray([0.0003628, 0.0613345, 0.5292298, 1.0, 0.5292298,
                                    0.0613345], dtype=xp.float64))
        xp_assert_close(windows.nuttall(7, sym=False, xp=xp),
                        xp.asarray([0.0003628, 0.03777576895352025,
                                    0.3427276199688195,
                                    0.8918518610776603, 0.8918518610776603,
                                    0.3427276199688196, 0.0377757689535203],
                                    dtype=xp.float64))
        xp_assert_close(windows.nuttall(6, xp=xp),
                        xp.asarray([0.0003628, 0.1105152530498718,
                                    0.7982580969501282, 0.7982580969501283,
                                    0.1105152530498719, 0.0003628], dtype=xp.float64))
        xp_assert_close(windows.nuttall(7, True, xp=xp),
                        xp.asarray([0.0003628, 0.0613345, 0.5292298, 1.0,
                                    0.5292298, 0.0613345, 0.0003628], dtype=xp.float64))


class TestParzen:

    def test_basic(self, xp):
        xp_assert_close(windows.parzen(6, xp=xp),
                        xp.asarray([0.009259259259259254, 0.25, 0.8611111111111112,
                                    0.8611111111111112, 0.25, 0.009259259259259254],
                                    dtype=xp.float64))
        xp_assert_close(windows.parzen(7, sym=True, xp=xp),
                        xp.asarray([0.00583090379008747, 0.1574344023323616,
                                    0.6501457725947521, 1.0, 0.6501457725947521,
                                    0.1574344023323616, 0.00583090379008747],
                                    dtype=xp.float64))
        xp_assert_close(windows.parzen(6, False, xp=xp),
                        xp.asarray([0.00583090379008747, 0.1574344023323616,
                                    0.6501457725947521, 1.0, 0.6501457725947521,
                                    0.1574344023323616], dtype=xp.float64))


class TestTriang:

    def test_basic(self, xp):

        xp_assert_close(windows.triang(6, True, xp=xp),
                        xp.asarray([1/6, 1/2, 5/6, 5/6, 1/2, 1/6], dtype=xp.float64))
        xp_assert_close(windows.triang(7, xp=xp),
                        xp.asarray([1/4, 1/2, 3/4, 1, 3/4, 1/2, 1/4], dtype=xp.float64))
        xp_assert_close(windows.triang(6, sym=False, xp=xp),
                        xp.asarray([1/4, 1/2, 3/4, 1, 3/4, 1/2], dtype=xp.float64))


tukey_data = {
    (4, 0.5, True): array([0.0, 1.0, 1.0, 0.0]),
    (4, 0.9, True): array([0.0, 0.84312081893436686,
                           0.84312081893436686, 0.0]),
    (4, 1.0, True): array([0.0, 0.75, 0.75, 0.0]),
    (4, 0.5, False): array([0.0, 1.0, 1.0, 1.0]),
    (4, 0.9, False): array([0.0, 0.58682408883346526,
                            1.0, 0.58682408883346526]),
    (4, 1.0, False): array([0.0, 0.5, 1.0, 0.5]),
    (5, 0.0, True): array([1.0, 1.0, 1.0, 1.0, 1.0]),
    (5, 0.8, True): array([0.0, 0.69134171618254492,
                           1.0, 0.69134171618254492, 0.0]),
    (5, 1.0, True): array([0.0, 0.5, 1.0, 0.5, 0.0]),

    (6, 0): [1.0, 1, 1, 1, 1, 1],
    (7, 0): [1.0, 1, 1, 1, 1, 1, 1],
    (6, .25): [0.0, 1, 1, 1, 1, 0],
    (7, .25): [0.0, 1, 1, 1, 1, 1, 0],
    (6,): [0, 0.9045084971874737, 1.0, 1.0, 0.9045084971874735, 0],
    (7,): [0, 0.75, 1.0, 1.0, 1.0, 0.75, 0],
    (6, .75): [0, 0.5522642316338269, 1.0, 1.0, 0.5522642316338267, 0],
    (7, .75): [0, 0.4131759111665348, 0.9698463103929542, 1.0,
               0.9698463103929542, 0.4131759111665347, 0],
    (6, 1): [0, 0.3454915028125263, 0.9045084971874737, 0.9045084971874737,
             0.3454915028125263, 0],
    (7, 1): [0, 0.25, 0.75, 1.0, 0.75, 0.25, 0],
}


class TestTukey:

    def test_basic(self, xp):
        # Test against hardcoded data
        for k, v in tukey_data.items():
            if v is None:
                assert_raises(ValueError, windows.tukey, *k, xp=xp)
            else:
                if is_torch(xp) and k in [(6,), (6, .75), (7, .75), (6,1)]:
                     atol_rtol = {'rtol': 3e-8, 'atol': 1e-8}
                else:
                     atol_rtol = {'rtol': 1e-15, 'atol': 1e-15 }

                win = windows.tukey(*k, xp=xp)
                xp_assert_close(win, xp.asarray(v),
                                check_dtype=False, **atol_rtol)

    def test_extremes(self, xp):
        # Test extremes of alpha correspond to boxcar and hann
        tuk0 = windows.tukey(100, 0, xp=xp)
        box0 = windows.boxcar(100, xp=xp)
        xp_assert_close(tuk0, box0)

        tuk1 = windows.tukey(100, 1, xp=xp)
        han1 = windows.hann(100, xp=xp)
        xp_assert_close(tuk1, han1)


dpss_data = {
    # All values from MATLAB:
    # * taper[1] of (3, 1.4, 3) sign-flipped
    # * taper[3] of (5, 1.5, 5) sign-flipped
    (4, 0.1, 2): ([[0.497943898, 0.502047681, 0.502047681, 0.497943898], [0.670487993, 0.224601537, -0.224601537, -0.670487993]], [0.197961815, 0.002035474]),  # noqa: E501
    (3, 1.4, 3): ([[0.410233151, 0.814504464, 0.410233151], [0.707106781, 0.0, -0.707106781], [0.575941629, -0.580157287, 0.575941629]], [0.999998093, 0.998067480, 0.801934426]),  # noqa: E501
    (5, 1.5, 5): ([[0.1745071052, 0.4956749177, 0.669109327, 0.495674917, 0.174507105], [0.4399493348, 0.553574369, 0.0, -0.553574369, -0.439949334], [0.631452756, 0.073280238, -0.437943884, 0.073280238, 0.631452756], [0.553574369, -0.439949334, 0.0, 0.439949334, -0.553574369], [0.266110290, -0.498935248, 0.600414741, -0.498935248, 0.266110290147157]], [0.999728571, 0.983706916, 0.768457889, 0.234159338, 0.013947282907567]),  # noqa: E501
    (100, 2, 4): ([[0.0030914414, 0.0041266922, 0.005315076, 0.006665149, 0.008184854, 0.0098814158, 0.011761239, 0.013829809, 0.016091597, 0.018549973, 0.02120712, 0.02406396, 0.027120092, 0.030373728, 0.033821651, 0.037459181, 0.041280145, 0.045276872, 0.049440192, 0.053759447, 0.058222524, 0.062815894, 0.067524661, 0.072332638, 0.077222418, 0.082175473, 0.087172252, 0.092192299, 0.097214376, 0.1022166, 0.10717657, 0.11207154, 0.11687856, 0.12157463, 0.12613686, 0.13054266, 0.13476986, 0.13879691, 0.14260302, 0.14616832, 0.14947401, 0.1525025, 0.15523755, 0.15766438, 0.15976981, 0.16154233, 0.16297223, 0.16405162, 0.16477455, 0.16513702, 0.16513702, 0.16477455, 0.16405162, 0.16297223, 0.16154233, 0.15976981, 0.15766438, 0.15523755, 0.1525025, 0.14947401, 0.14616832, 0.14260302, 0.13879691, 0.13476986, 0.13054266, 0.12613686, 0.12157463, 0.11687856, 0.11207154, 0.10717657, 0.1022166, 0.097214376, 0.092192299, 0.087172252, 0.082175473, 0.077222418, 0.072332638, 0.067524661, 0.062815894, 0.058222524, 0.053759447, 0.049440192, 0.045276872, 0.041280145, 0.037459181, 0.033821651, 0.030373728, 0.027120092, 0.02406396, 0.02120712, 0.018549973, 0.016091597, 0.013829809, 0.011761239, 0.0098814158, 0.008184854, 0.006665149, 0.005315076, 0.0041266922, 0.0030914414], [0.018064449, 0.022040342, 0.026325013, 0.030905288, 0.035764398, 0.040881982, 0.046234148, 0.051793558, 0.057529559, 0.063408356, 0.069393216, 0.075444716, 0.081521022, 0.087578202, 0.093570567, 0.099451049, 0.10517159, 0.11068356, 0.11593818, 0.12088699, 0.12548227, 0.12967752, 0.1334279, 0.13669069, 0.13942569, 0.1415957, 0.14316686, 0.14410905, 0.14439626, 0.14400686, 0.14292389, 0.1411353, 0.13863416, 0.13541876, 0.13149274, 0.12686516, 0.12155045, 0.1155684, 0.10894403, 0.10170748, 0.093893752, 0.08554251, 0.076697768, 0.067407559, 0.057723559, 0.04770068, 0.037396627, 0.026871428, 0.016186944, 0.0054063557, -0.0054063557, -0.016186944, -0.026871428, -0.037396627, -0.04770068, -0.057723559, -0.067407559, -0.076697768, -0.08554251, -0.093893752, -0.10170748, -0.10894403, -0.1155684, -0.12155045, -0.12686516, -0.13149274, -0.13541876, -0.13863416, -0.1411353, -0.14292389, -0.14400686, -0.14439626, -0.14410905, -0.14316686, -0.1415957, -0.13942569, -0.13669069, -0.1334279, -0.12967752, -0.12548227, -0.12088699, -0.11593818, -0.11068356, -0.10517159, -0.099451049, -0.093570567, -0.087578202, -0.081521022, -0.075444716, -0.069393216, -0.063408356, -0.057529559, -0.051793558, -0.046234148, -0.040881982, -0.035764398, -0.030905288, -0.026325013, -0.022040342, -0.018064449], [0.064817553, 0.072567801, 0.080292992, 0.087918235, 0.095367076, 0.10256232, 0.10942687, 0.1158846, 0.12186124, 0.12728523, 0.13208858, 0.13620771, 0.13958427, 0.14216587, 0.14390678, 0.14476863, 0.1447209, 0.14374148, 0.14181704, 0.13894336, 0.13512554, 0.13037812, 0.1247251, 0.11819984, 0.11084487, 0.10271159, 0.093859853, 0.084357497, 0.074279719, 0.063708406, 0.052731374, 0.041441525, 0.029935953, 0.018314987, 0.0066811877, -0.0048616765, -0.016209689, -0.027259848, -0.037911124, -0.048065512, -0.05762905, -0.066512804, -0.0746338, -0.081915903, -0.088290621, -0.09369783, -0.098086416, -0.10141482, -0.10365146, -0.10477512, -0.10477512, -0.10365146, -0.10141482, -0.098086416, -0.09369783, -0.088290621, -0.081915903, -0.0746338, -0.066512804, -0.05762905, -0.048065512, -0.037911124, -0.027259848, -0.016209689, -0.0048616765, 0.0066811877, 0.018314987, 0.029935953, 0.041441525, 0.052731374, 0.063708406, 0.074279719, 0.084357497, 0.093859853, 0.10271159, 0.11084487, 0.11819984, 0.1247251, 0.13037812, 0.13512554, 0.13894336, 0.14181704, 0.14374148, 0.1447209, 0.14476863, 0.14390678, 0.14216587, 0.13958427, 0.13620771, 0.13208858, 0.12728523, 0.12186124, 0.1158846, 0.10942687, 0.10256232, 0.095367076, 0.087918235, 0.080292992, 0.072567801, 0.064817553], [0.14985551, 0.15512305, 0.15931467, 0.16236806, 0.16423291, 0.16487165, 0.16426009, 0.1623879, 0.1592589, 0.15489114, 0.14931693, 0.14258255, 0.13474785, 0.1258857, 0.11608124, 0.10543095, 0.094041635, 0.082029213, 0.069517411, 0.056636348, 0.043521028, 0.030309756, 0.017142511, 0.0041592774, -0.0085016282, -0.020705223, -0.032321494, -0.043226982, -0.053306291, -0.062453515, -0.070573544, -0.077583253, -0.083412547, -0.088005244, -0.091319802, -0.093329861, -0.094024602, -0.093408915, -0.091503383, -0.08834406, -0.08398207, -0.078483012, -0.071926192, -0.064403681, -0.056019215, -0.046886954, -0.037130106, -0.026879442, -0.016271713, -0.005448, 0.005448, 0.016271713, 0.026879442, 0.037130106, 0.046886954, 0.056019215, 0.064403681, 0.071926192, 0.078483012, 0.08398207, 0.08834406, 0.091503383, 0.093408915, 0.094024602, 0.093329861, 0.091319802, 0.088005244, 0.083412547, 0.077583253, 0.070573544, 0.062453515, 0.053306291, 0.043226982, 0.032321494, 0.020705223, 0.0085016282, -0.0041592774, -0.017142511, -0.030309756, -0.043521028, -0.056636348, -0.069517411, -0.082029213, -0.094041635, -0.10543095, -0.11608124, -0.1258857, -0.13474785, -0.14258255, -0.14931693, -0.15489114, -0.1592589, -0.1623879, -0.16426009, -0.16487165, -0.16423291, -0.16236806, -0.15931467, -0.15512305, -0.14985551]], [0.999943140, 0.997571533, 0.959465463, 0.721862496]),  # noqa: E501
}


@skip_xp_backends(np_only=True, reason='banded linear algebra is numpy-only')
class TestDPSS:

    def test_basic(self, xp):
        # Test against hardcoded data
        for k, v in dpss_data.items():
            win, ratios = windows.dpss(*k, return_ratios=True, xp=xp)
            xp_assert_close(win, v[0], atol=1e-7, err_msg=k)
            xp_assert_close(ratios, v[1], rtol=1e-5, atol=1e-7, err_msg=k)

    def test_unity(self, xp):
        # Test unity value handling (gh-2221)
        for M in range(1, 21):
            # corrected w/approximation (default)
            win = windows.dpss(M, M / 2.1, xp=xp)
            expected = M % 2  # one for odd, none for even
            xp_assert_equal(np.isclose(win, 1.).sum(), expected,
                         err_msg=f'{win}')
            # corrected w/subsample delay (slower)
            win_sub = windows.dpss(M, M / 2.1, norm='subsample', xp=xp)
            if M > 2:
                # @M=2 the subsample doesn't do anything
                xp_assert_equal(np.isclose(win_sub, 1.).sum(), expected,
                             err_msg=f'{win_sub}')
                xp_assert_close(win, win_sub, rtol=0.03)  # within 3%
            # not the same, l2-norm
            win_2 = windows.dpss(M, M / 2.1, norm=2, xp=xp)
            expected = 1 if M == 1 else 0
            xp_assert_equal(np.isclose(win_2, 1.).sum(), expected,
                         err_msg=f'{win_2}')

    def test_extremes(self, xp):
        # Test extremes of alpha
        lam = windows.dpss(31, 6, 4, return_ratios=True, xp=xp)[1]
        xp_assert_close(lam, xp.ones_like(lam))
        lam = windows.dpss(31, 7, 4, return_ratios=True, xp=xp)[1]
        xp_assert_close(lam, xp.ones_like(lam))
        lam = windows.dpss(31, 8, 4, return_ratios=True, xp=xp)[1]
        xp_assert_close(lam, xp.ones_like(lam))

    def test_degenerate(self, xp):
        # Test failures
        assert_raises(ValueError, windows.dpss, 4, 1.5, -1)  # Bad Kmax
        assert_raises(ValueError, windows.dpss, 4, 1.5, -5)
        assert_raises(TypeError, windows.dpss, 4, 1.5, 1.1)
        assert_raises(ValueError, windows.dpss, 3, 1.5, 3)  # NW must be < N/2.
        assert_raises(ValueError, windows.dpss, 3, -1, 3)  # NW must be pos
        assert_raises(ValueError, windows.dpss, 3, 0, 3)
        assert_raises(ValueError, windows.dpss, -1, 1, 3)  # negative M

    @skip_xp_backends(np_only=True)
    def test_degenerate_signle_samples(self, xp):
        # Single samples
        w = windows.dpss(1, 1.)
        xp_assert_equal(w, [1.])
        w, ratio = windows.dpss(1, 1., return_ratios=True)
        xp_assert_equal(w, [1.])
        assert ratio == 1.
        w, ratio = windows.dpss(1, 1., Kmax=4, return_ratios=True)
        xp_assert_equal(w, [1.])
        assert isinstance(ratio, np.ndarray)
        xp_assert_equal(ratio, [1.])

        assert_raises(ValueError, windows.dpss, 4, 1.5, -1, xp=xp)  # Bad Kmax
        assert_raises(ValueError, windows.dpss, 4, 1.5, -5, xp=xp)
        assert_raises(TypeError, windows.dpss, 4, 1.5, 1.1, xp=xp)
        assert_raises(ValueError, windows.dpss, 3, 1.5, 3, xp=xp)  # NW must be < N/2.
        assert_raises(ValueError, windows.dpss, 3, -1, 3, xp=xp)  # NW must be pos
        assert_raises(ValueError, windows.dpss, 3, 0, 3, xp=xp)
        assert_raises(ValueError, windows.dpss, -1, 1, 3, xp=xp)  # negative M


class TestLanczos:

    def test_basic(self, xp):
        # Analytical results:
        # sinc(x) = sinc(-x)
        # sinc(pi) = 0, sinc(0) = 1
        # Hand computation on WolframAlpha:
        # sinc(2 pi / 3) = 0.413496672
        # sinc(pi / 3) = 0.826993343
        # sinc(3 pi / 5) = 0.504551152
        # sinc(pi / 5) = 0.935489284
        xp_assert_close(windows.lanczos(6, sym=False, xp=xp),
                        xp.asarray([0., 0.413496672,
                                    0.826993343, 1., 0.826993343,
                                    0.413496672], dtype=xp.float64),
                        atol=1e-9)
        xp_assert_close(windows.lanczos(6, xp=xp),
                        xp.asarray([0., 0.504551152,
                                    0.935489284, 0.935489284,
                                    0.504551152, 0.], dtype=xp.float64),
                        atol=1e-9)
        xp_assert_close(windows.lanczos(7, sym=True, xp=xp),
                        xp.asarray([0., 0.413496672,
                                    0.826993343, 1., 0.826993343,
                                    0.413496672, 0.], dtype=xp.float64),
                        atol=1e-9)

    def test_array_size(self, xp):
        for n in [0, 10, 11]:
            assert windows.lanczos(n, sym=False, xp=xp).shape[0] == n
            assert windows.lanczos(n, sym=True, xp=xp).shape[0] == n


class TestGetWindow:

    def test_boxcar(self, xp):
        w = windows.get_window('boxcar', 12, xp=xp)
        xp_assert_equal(w, xp.ones_like(w))

        # window is a tuple of len 1
        w = windows.get_window(('boxcar',), 16, xp=xp)
        xp_assert_equal(w, xp.ones_like(w))

    @skip_xp_backends('jax.numpy', reason='item assignment')
    @skip_xp_backends('dask.array', reason='data-dependent output shapes')
    def test_cheb_odd(self, xp):
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "This window is not suitable")
            w = windows.get_window(('chebwin', -40), 53, fftbins=False, xp=xp)
        assert_array_almost_equal(
            w, xp.asarray(cheb_odd_true, dtype=xp.float64), decimal=4
        )

    @skip_xp_backends('jax.numpy', reason='item assignment')
    @skip_xp_backends('dask.array', reason='data-dependent output shapes')
    def test_cheb_even(self, xp):
        with suppress_warnings() as sup:
            sup.filter(UserWarning, "This window is not suitable")
            w = windows.get_window(('chebwin', 40), 54, fftbins=False, xp=xp)
        assert_array_almost_equal(w, xp.asarray(cheb_even_true), decimal=4)

    @skip_xp_backends(cpu_only=True, reason='eigh_tridiagonal is CPU-only')
    def test_dpss(self, xp):
        win1 = windows.get_window(('dpss', 3), 64, fftbins=False, xp=xp)
        win2 = windows.dpss(64, 3, xp=xp)
        assert_array_almost_equal(win1, win2, decimal=4)

    def test_kaiser_float(self, xp):
        win1 = windows.get_window(7.2, 64, xp=xp)
        win2 = windows.kaiser(64, 7.2, False, xp=xp)
        xp_assert_close(win1, win2)

    def test_invalid_inputs(self, xp):
        # Window is not a float, tuple, or string
        assert_raises(ValueError, windows.get_window, set('hann'), 8, xp=xp)

        # Unknown window type error
        assert_raises(ValueError, windows.get_window, 'broken', 4, xp=xp)

    @xfail_xp_backends(np_only=True, reason='TODO: make resample array API ready')
    def test_array_as_window(self, xp):
        # github issue 3603
        osfactor = 128
        sig = xp.arange(128)

        win = windows.get_window(('kaiser', 8.0), osfactor // 2, xp=xp)
        with assert_raises(ValueError, match='^window.shape='):
            resample(sig, len(sig) * osfactor, window=win)

    def test_general_cosine(self, xp):
        xp_assert_close(get_window(('general_cosine', xp.asarray([0.5, 0.3, 0.2])), 4),
                        xp.asarray([0.4, 0.3, 1, 0.3], dtype=xp.float64))
        xp_assert_close(get_window(('general_cosine', xp.asarray([0.5, 0.3, 0.2])), 4,
                                   fftbins=False),
                        xp.asarray([0.4, 0.55, 0.55, 0.4], dtype=xp.float64))

        with pytest.raises(ValueError):
            get_window(('general_cosine', [0.5, 0.3, 0.2]), 4, xp=xp)

    def test_general_hamming(self, xp):
        xp_assert_close(get_window(('general_hamming', 0.7), 5, xp=xp),
                        xp.asarray([0.4, 0.6072949, 0.9427051, 0.9427051, 0.6072949],
                                   dtype=xp.float64))
        xp_assert_close(get_window(('general_hamming', 0.7), 5, fftbins=False, xp=xp),
                        xp.asarray([0.4, 0.7, 1.0, 0.7, 0.4], dtype=xp.float64))

    def test_lanczos(self, xp):
        xp_assert_close(get_window('lanczos', 6, xp=xp),
                        xp.asarray([0., 0.413496672, 0.826993343, 1., 0.826993343,
                                    0.413496672], dtype=xp.float64), atol=1e-9)
        xp_assert_close(get_window('lanczos', 6, fftbins=False, xp=xp),
                        xp.asarray([0., 0.504551152, 0.935489284, 0.935489284,
                                    0.504551152, 0.], dtype=xp.float64), atol=1e-9)
        xp_assert_close(get_window('lanczos', 6, xp=xp),
                        get_window('sinc', 6, xp=xp))

    def test_xp_default(self, xp):
        # no explicit xp= argument, default to numpy
        win = get_window('lanczos', 6)
        assert isinstance(win, np.ndarray)

        win = get_window('lanczos', 6, xp=xp)
        if not is_numpy(xp):
            assert not isinstance(win, np.ndarray)


@skip_xp_backends("dask.array", reason="https://github.com/dask/dask/issues/2620")
def test_windowfunc_basics(xp):
    for window_name, params in window_funcs:
        window = getattr(windows, window_name)
        if is_jax(xp) and window_name in ['taylor', 'chebwin']:
            pytest.skip(reason=f'{window_name = }: item assignment')
        if window_name in ['dpss']:
            if is_cupy(xp):
                pytest.skip(reason='dpss window is not implemented for cupy')
            if is_torch(xp) and SCIPY_DEVICE != 'cpu':
                pytest.skip(reason='needs eight_tridiagonal which is CPU only')

        with suppress_warnings() as sup:
            sup.filter(UserWarning, "This window is not suitable")
            # Check symmetry for odd and even lengths
            w1 = window(8, *params, sym=True, xp=xp)
            w2 = window(7, *params, sym=False, xp=xp)
            xp_assert_close(w1[:-1], w2)

            w1 = window(9, *params, sym=True, xp=xp)
            w2 = window(8, *params, sym=False, xp=xp)
            xp_assert_close(w1[:-1], w2)

            # Check that functions run and output lengths are correct
            assert window(6, *params, sym=True, xp=xp).shape[0] == 6
            assert window(6, *params, sym=False, xp=xp).shape[0] == 6
            assert window(7, *params, sym=True, xp=xp).shape[0] == 7
            assert window(7, *params, sym=False, xp=xp).shape[0] == 7

            # Check invalid lengths
            assert_raises(ValueError, window, 5.5, *params, xp=xp)
            assert_raises(ValueError, window, -7, *params, xp=xp)

            # Check degenerate cases
            xp_assert_equal(window(0, *params, sym=True, xp=xp),
                            xp.asarray([], dtype=xp.float64))
            xp_assert_equal(window(0, *params, sym=False, xp=xp),
                            xp.asarray([], dtype=xp.float64))
            xp_assert_equal(window(1, *params, sym=True, xp=xp),
                            xp.asarray([1.], dtype=xp.float64))
            xp_assert_equal(window(1, *params, sym=False, xp=xp),
                            xp.asarray([1.], dtype=xp.float64))

            # Check dtype
            assert window(0, *params, sym=True, xp=xp).dtype == xp.float64
            assert window(0, *params, sym=False, xp=xp).dtype == xp.float64
            assert window(1, *params, sym=True, xp=xp).dtype == xp.float64
            assert window(1, *params, sym=False, xp=xp).dtype == xp.float64
            assert window(6, *params, sym=True, xp=xp).dtype == xp.float64
            assert window(6, *params, sym=False, xp=xp).dtype == xp.float64

            # Check normalization
            assert xp.all(window(10, *params, sym=True, xp=xp) < 1.01)
            assert xp.all(window(10, *params, sym=False, xp=xp) < 1.01)
            assert xp.all(window(9, *params, sym=True, xp=xp) < 1.01)
            assert xp.all(window(9, *params, sym=False, xp=xp) < 1.01)

            # Check that DFT-even spectrum is purely real for odd and even
            res = fft(window(10, *params, sym=False, xp=xp))
            res = xp.imag(res)
            xp_assert_close(res, xp.zeros_like(res), atol=1e-14)

            res = fft(window(11, *params, sym=False, xp=xp))
            res = xp.imag(res)
            xp_assert_close(res, xp.zeros_like(res), atol=1e-14)


def test_needs_params(xp):
    for winstr in ['kaiser', 'ksr', 'kaiser_bessel_derived', 'kbd',
                   'gaussian', 'gauss', 'gss',
                   'general gaussian', 'general_gaussian',
                   'general gauss', 'general_gauss', 'ggs',
                   'dss', 'dpss', 'general cosine', 'general_cosine',
                   'chebwin', 'cheb', 'general hamming', 'general_hamming',
                   ]:
        assert_raises(ValueError, get_window, winstr, 7, xp=xp)


_winstr = ['barthann',
           'bartlett',
           'blackman',
           'blackmanharris',
           'bohman',
           'boxcar',
           'cosine',
           'flattop',
           'hamming',
           'nuttall',
           'parzen',
           'taylor',
           'exponential',
           'poisson',
           'tukey',
           'tuk',
           'triangle',
           'lanczos',
           'sinc',
]


@pytest.mark.parametrize('winstr', _winstr)
def test_not_needs_params(xp, winstr):
    if is_jax(xp) and winstr in ['taylor']:
        pytest.skip(reason=f'{winstr}: item assignment')
    win = get_window(winstr, 7, xp=xp)
    assert win.shape[0] == 7


def test_symmetric(xp):

    for win in [windows.lanczos]:
        # Even sampling points
        w = win(4096, xp=xp)
        flip = array_namespace(w).flip
        error = xp.max(xp.abs(w - flip(w)))
        xp_assert_equal(error, xp.asarray(0.0), check_dtype=False, check_0d=False)

        # Odd sampling points
        w = win(4097, xp=xp)
        error = xp.max(xp.abs(w - flip(w)))
        xp_assert_equal(error, xp.asarray(0.0), check_dtype=False, check_0d=False)
