import numpy as np
from numpy.testing import assert_array_equal, assert_array_almost_equal

import scipy.signal._wavelets as wavelets


class TestWavelets:
    def test_ricker(self):
        w = wavelets._ricker(1.0, 1)
        expected = 2 / (np.sqrt(3 * 1.0) * (np.pi ** 0.25))
        assert_array_equal(w, expected)

        lengths = [5, 11, 15, 51, 101]
        for length in lengths:
            w = wavelets._ricker(length, 1.0)
            assert len(w) == length
            max_loc = np.argmax(w)
            assert max_loc == (length // 2)

        points = 100
        w = wavelets._ricker(points, 2.0)
        half_vec = np.arange(0, points // 2)
        # Wavelet should be symmetric
        assert_array_almost_equal(w[half_vec], w[-(half_vec + 1)])

        # Check zeros
        aas = [5, 10, 15, 20, 30]
        points = 99
        for a in aas:
            w = wavelets._ricker(points, a)
            vec = np.arange(0, points) - (points - 1.0) / 2
            exp_zero1 = np.argmin(np.abs(vec - a))
            exp_zero2 = np.argmin(np.abs(vec + a))
            assert_array_almost_equal(w[exp_zero1], 0)
            assert_array_almost_equal(w[exp_zero2], 0)

    def test_cwt(self):
        widths = [1.0]
        def delta_wavelet(s, t):
            return np.array([1])
        len_data = 100
        test_data = np.sin(np.pi * np.arange(0, len_data) / 10.0)

        # Test delta function input gives same data as output
        cwt_dat = wavelets._cwt(test_data, delta_wavelet, widths)
        assert cwt_dat.shape == (len(widths), len_data)
        assert_array_almost_equal(test_data, cwt_dat.flatten())

        # Check proper shape on output
        widths = [1, 3, 4, 5, 10]
        cwt_dat = wavelets._cwt(test_data, wavelets._ricker, widths)
        assert cwt_dat.shape == (len(widths), len_data)

        widths = [len_data * 10]
        # Note: this wavelet isn't defined quite right, but is fine for this test
        def flat_wavelet(l, w):
            return np.full(w, 1 / w)
        cwt_dat = wavelets._cwt(test_data, flat_wavelet, widths)
        assert_array_almost_equal(cwt_dat, np.mean(test_data))
