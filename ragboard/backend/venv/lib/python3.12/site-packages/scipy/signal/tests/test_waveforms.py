import numpy as np
from pytest import raises as assert_raises
from scipy._lib._array_api import (
    assert_almost_equal, xp_assert_equal, xp_assert_close
)

import scipy.signal._waveforms as waveforms


# These chirp_* functions are the instantaneous frequencies of the signals
# returned by chirp().

def chirp_linear(t, f0, f1, t1):
    f = f0 + (f1 - f0) * t / t1
    return f


def chirp_quadratic(t, f0, f1, t1, vertex_zero=True):
    if vertex_zero:
        f = f0 + (f1 - f0) * t**2 / t1**2
    else:
        f = f1 - (f1 - f0) * (t1 - t)**2 / t1**2
    return f


def chirp_geometric(t, f0, f1, t1):
    f = f0 * (f1/f0)**(t/t1)
    return f


def chirp_hyperbolic(t, f0, f1, t1):
    f = f0*f1*t1 / ((f0 - f1)*t + f1*t1)
    return f


def compute_frequency(t, theta):
    """
    Compute theta'(t)/(2*pi), where theta'(t) is the derivative of theta(t).
    """
    # Assume theta and t are 1-D NumPy arrays.
    # Assume that t is uniformly spaced.
    dt = t[1] - t[0]
    f = np.diff(theta)/(2*np.pi) / dt
    tf = 0.5*(t[1:] + t[:-1])
    return tf, f


class TestChirp:

    def test_linear_at_zero(self):
        w = waveforms.chirp(t=0, f0=1.0, f1=2.0, t1=1.0, method='linear')
        assert_almost_equal(w, 1.0)

    def test_linear_freq_01(self):
        method = 'linear'
        f0 = 1.0
        f1 = 2.0
        t1 = 1.0
        t = np.linspace(0, t1, 100)
        phase = waveforms._chirp_phase(t, f0, t1, f1, method)
        tf, f = compute_frequency(t, phase)
        abserr = np.max(np.abs(f - chirp_linear(tf, f0, f1, t1)))
        assert abserr < 1e-6

    def test_linear_freq_02(self):
        method = 'linear'
        f0 = 200.0
        f1 = 100.0
        t1 = 10.0
        t = np.linspace(0, t1, 100)
        phase = waveforms._chirp_phase(t, f0, t1, f1, method)
        tf, f = compute_frequency(t, phase)
        abserr = np.max(np.abs(f - chirp_linear(tf, f0, f1, t1)))
        assert abserr < 1e-6

    def test_linear_complex_power(self):
        method = 'linear'
        f0 = 1.0
        f1 = 2.0
        t1 = 1.0
        t = np.linspace(0, t1, 100)
        w_real = waveforms.chirp(t, f0, t1, f1, method, complex=False)
        w_complex = waveforms.chirp(t, f0, t1, f1, method, complex=True)
        w_pwr_r = np.var(w_real)
        w_pwr_c = np.var(w_complex)

        # Making sure that power of the real part is not affected with
        # complex conversion operation
        err = w_pwr_r - np.real(w_pwr_c)

        assert(err < 1e-6)

    def test_linear_complex_at_zero(self):
        w = waveforms.chirp(t=0, f0=-10.0, f1=1.0, t1=1.0, method='linear',
                            complex=True)
        xp_assert_close(w, 1.0+0.0j)  # dtype must match

    def test_quadratic_at_zero(self):
        w = waveforms.chirp(t=0, f0=1.0, f1=2.0, t1=1.0, method='quadratic')
        assert_almost_equal(w, 1.0)

    def test_quadratic_at_zero2(self):
        w = waveforms.chirp(t=0, f0=1.0, f1=2.0, t1=1.0, method='quadratic',
                            vertex_zero=False)
        assert_almost_equal(w, 1.0)

    def test_quadratic_complex_at_zero(self):
        w = waveforms.chirp(t=0, f0=-1.0, f1=2.0, t1=1.0, method='quadratic',
                            complex=True)
        xp_assert_close(w, 1.0+0j)

    def test_quadratic_freq_01(self):
        method = 'quadratic'
        f0 = 1.0
        f1 = 2.0
        t1 = 1.0
        t = np.linspace(0, t1, 2000)
        phase = waveforms._chirp_phase(t, f0, t1, f1, method)
        tf, f = compute_frequency(t, phase)
        abserr = np.max(np.abs(f - chirp_quadratic(tf, f0, f1, t1)))
        assert abserr < 1e-6

    def test_quadratic_freq_02(self):
        method = 'quadratic'
        f0 = 20.0
        f1 = 10.0
        t1 = 10.0
        t = np.linspace(0, t1, 2000)
        phase = waveforms._chirp_phase(t, f0, t1, f1, method)
        tf, f = compute_frequency(t, phase)
        abserr = np.max(np.abs(f - chirp_quadratic(tf, f0, f1, t1)))
        assert abserr < 1e-6

    def test_logarithmic_at_zero(self):
        w = waveforms.chirp(t=0, f0=1.0, f1=2.0, t1=1.0, method='logarithmic')
        assert_almost_equal(w, 1.0)

    def test_logarithmic_freq_01(self):
        method = 'logarithmic'
        f0 = 1.0
        f1 = 2.0
        t1 = 1.0
        t = np.linspace(0, t1, 10000)
        phase = waveforms._chirp_phase(t, f0, t1, f1, method)
        tf, f = compute_frequency(t, phase)
        abserr = np.max(np.abs(f - chirp_geometric(tf, f0, f1, t1)))
        assert abserr < 1e-6

    def test_logarithmic_freq_02(self):
        method = 'logarithmic'
        f0 = 200.0
        f1 = 100.0
        t1 = 10.0
        t = np.linspace(0, t1, 10000)
        phase = waveforms._chirp_phase(t, f0, t1, f1, method)
        tf, f = compute_frequency(t, phase)
        abserr = np.max(np.abs(f - chirp_geometric(tf, f0, f1, t1)))
        assert abserr < 1e-6

    def test_logarithmic_freq_03(self):
        method = 'logarithmic'
        f0 = 100.0
        f1 = 100.0
        t1 = 10.0
        t = np.linspace(0, t1, 10000)
        phase = waveforms._chirp_phase(t, f0, t1, f1, method)
        tf, f = compute_frequency(t, phase)
        abserr = np.max(np.abs(f - chirp_geometric(tf, f0, f1, t1)))
        assert abserr < 1e-6

    def test_hyperbolic_at_zero(self):
        w = waveforms.chirp(t=0, f0=10.0, f1=1.0, t1=1.0, method='hyperbolic')
        assert_almost_equal(w, 1.0)

    def test_hyperbolic_freq_01(self):
        method = 'hyperbolic'
        t1 = 1.0
        t = np.linspace(0, t1, 10000)
        #           f0     f1
        cases = [[10.0, 1.0],
                 [1.0, 10.0],
                 [-10.0, -1.0],
                 [-1.0, -10.0]]
        for f0, f1 in cases:
            phase = waveforms._chirp_phase(t, f0, t1, f1, method)
            tf, f = compute_frequency(t, phase)
            expected = chirp_hyperbolic(tf, f0, f1, t1)
            xp_assert_close(f, expected, atol=1e-7)

    def test_hyperbolic_zero_freq(self):
        # f0=0 or f1=0 must raise a ValueError.
        method = 'hyperbolic'
        t1 = 1.0
        t = np.linspace(0, t1, 5)
        assert_raises(ValueError, waveforms.chirp, t, 0, t1, 1, method)
        assert_raises(ValueError, waveforms.chirp, t, 1, t1, 0, method)

    def test_unknown_method(self):
        method = "foo"
        f0 = 10.0
        f1 = 20.0
        t1 = 1.0
        t = np.linspace(0, t1, 10)
        assert_raises(ValueError, waveforms.chirp, t, f0, t1, f1, method)

    def test_integer_t1(self):
        f0 = 10.0
        f1 = 20.0
        t = np.linspace(-1, 1, 11)
        t1 = 3.0
        float_result = waveforms.chirp(t, f0, t1, f1)
        t1 = 3
        int_result = waveforms.chirp(t, f0, t1, f1)
        err_msg = "Integer input 't1=3' gives wrong result"
        xp_assert_equal(int_result, float_result, err_msg=err_msg)

    def test_integer_f0(self):
        f1 = 20.0
        t1 = 3.0
        t = np.linspace(-1, 1, 11)
        f0 = 10.0
        float_result = waveforms.chirp(t, f0, t1, f1)
        f0 = 10
        int_result = waveforms.chirp(t, f0, t1, f1)
        err_msg = "Integer input 'f0=10' gives wrong result"
        xp_assert_equal(int_result, float_result, err_msg=err_msg)

    def test_integer_f1(self):
        f0 = 10.0
        t1 = 3.0
        t = np.linspace(-1, 1, 11)
        f1 = 20.0
        float_result = waveforms.chirp(t, f0, t1, f1)
        f1 = 20
        int_result = waveforms.chirp(t, f0, t1, f1)
        err_msg = "Integer input 'f1=20' gives wrong result"
        xp_assert_equal(int_result, float_result, err_msg=err_msg)

    def test_integer_all(self):
        f0 = 10
        t1 = 3
        f1 = 20
        t = np.linspace(-1, 1, 11)
        float_result = waveforms.chirp(t, float(f0), float(t1), float(f1))
        int_result = waveforms.chirp(t, f0, t1, f1)
        err_msg = "Integer input 'f0=10, t1=3, f1=20' gives wrong result"
        xp_assert_equal(int_result, float_result, err_msg=err_msg)


class TestSweepPoly:

    def test_sweep_poly_quad1(self):
        p = np.poly1d([1.0, 0.0, 1.0])
        t = np.linspace(0, 3.0, 10000)
        phase = waveforms._sweep_poly_phase(t, p)
        tf, f = compute_frequency(t, phase)
        expected = p(tf)
        abserr = np.max(np.abs(f - expected))
        assert abserr < 1e-6

    def test_sweep_poly_const(self):
        p = np.poly1d(2.0)
        t = np.linspace(0, 3.0, 10000)
        phase = waveforms._sweep_poly_phase(t, p)
        tf, f = compute_frequency(t, phase)
        expected = p(tf)
        abserr = np.max(np.abs(f - expected))
        assert abserr < 1e-6

    def test_sweep_poly_linear(self):
        p = np.poly1d([-1.0, 10.0])
        t = np.linspace(0, 3.0, 10000)
        phase = waveforms._sweep_poly_phase(t, p)
        tf, f = compute_frequency(t, phase)
        expected = p(tf)
        abserr = np.max(np.abs(f - expected))
        assert abserr < 1e-6

    def test_sweep_poly_quad2(self):
        p = np.poly1d([1.0, 0.0, -2.0])
        t = np.linspace(0, 3.0, 10000)
        phase = waveforms._sweep_poly_phase(t, p)
        tf, f = compute_frequency(t, phase)
        expected = p(tf)
        abserr = np.max(np.abs(f - expected))
        assert abserr < 1e-6

    def test_sweep_poly_cubic(self):
        p = np.poly1d([2.0, 1.0, 0.0, -2.0])
        t = np.linspace(0, 2.0, 10000)
        phase = waveforms._sweep_poly_phase(t, p)
        tf, f = compute_frequency(t, phase)
        expected = p(tf)
        abserr = np.max(np.abs(f - expected))
        assert abserr < 1e-6

    def test_sweep_poly_cubic2(self):
        """Use an array of coefficients instead of a poly1d."""
        p = np.array([2.0, 1.0, 0.0, -2.0])
        t = np.linspace(0, 2.0, 10000)
        phase = waveforms._sweep_poly_phase(t, p)
        tf, f = compute_frequency(t, phase)
        expected = np.poly1d(p)(tf)
        abserr = np.max(np.abs(f - expected))
        assert abserr < 1e-6

    def test_sweep_poly_cubic3(self):
        """Use a list of coefficients instead of a poly1d."""
        p = [2.0, 1.0, 0.0, -2.0]
        t = np.linspace(0, 2.0, 10000)
        phase = waveforms._sweep_poly_phase(t, p)
        tf, f = compute_frequency(t, phase)
        expected = np.poly1d(p)(tf)
        abserr = np.max(np.abs(f - expected))
        assert abserr < 1e-6


class TestGaussPulse:

    def test_integer_fc(self):
        float_result = waveforms.gausspulse('cutoff', fc=1000.0)
        int_result = waveforms.gausspulse('cutoff', fc=1000)
        err_msg = "Integer input 'fc=1000' gives wrong result"
        xp_assert_equal(int_result, float_result, err_msg=err_msg)

    def test_integer_bw(self):
        float_result = waveforms.gausspulse('cutoff', bw=1.0)
        int_result = waveforms.gausspulse('cutoff', bw=1)
        err_msg = "Integer input 'bw=1' gives wrong result"
        xp_assert_equal(int_result, float_result, err_msg=err_msg)

    def test_integer_bwr(self):
        float_result = waveforms.gausspulse('cutoff', bwr=-6.0)
        int_result = waveforms.gausspulse('cutoff', bwr=-6)
        err_msg = "Integer input 'bwr=-6' gives wrong result"
        xp_assert_equal(int_result, float_result, err_msg=err_msg)

    def test_integer_tpr(self):
        float_result = waveforms.gausspulse('cutoff', tpr=-60.0)
        int_result = waveforms.gausspulse('cutoff', tpr=-60)
        err_msg = "Integer input 'tpr=-60' gives wrong result"
        xp_assert_equal(int_result, float_result, err_msg=err_msg)


class TestUnitImpulse:

    def test_no_index(self):
        xp_assert_equal(waveforms.unit_impulse(7),
                        np.asarray([1.0, 0, 0, 0, 0, 0, 0]))
        xp_assert_equal(waveforms.unit_impulse((3, 3)),
                        np.asarray([[1.0, 0, 0], [0, 0, 0], [0, 0, 0]]))

    def test_index(self):
        xp_assert_equal(waveforms.unit_impulse(10, 3),
                        np.asarray([0.0, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
        xp_assert_equal(waveforms.unit_impulse((3, 3), (1, 1)),
                        np.asarray([[0.0, 0, 0], [0, 1, 0], [0, 0, 0]]))

        # Broadcasting
        imp = waveforms.unit_impulse((4, 4), 2)
        xp_assert_equal(imp, np.asarray([[0.0, 0, 0, 0],
                                         [0.0, 0, 0, 0],
                                         [0.0, 0, 1, 0],
                                         [0.0, 0, 0, 0]]))

    def test_mid(self):
        xp_assert_equal(waveforms.unit_impulse((3, 3), 'mid'),
                        np.asarray([[0.0, 0, 0], [0, 1, 0], [0, 0, 0]]))
        xp_assert_equal(waveforms.unit_impulse(9, 'mid'),
                        np.asarray([0.0, 0, 0, 0, 1, 0, 0, 0, 0]))

    def test_dtype(self):
        imp = waveforms.unit_impulse(7)
        assert np.issubdtype(imp.dtype, np.floating)

        imp = waveforms.unit_impulse(5, 3, dtype=int)
        assert np.issubdtype(imp.dtype, np.integer)

        imp = waveforms.unit_impulse((5, 2), (3, 1), dtype=complex)
        assert np.issubdtype(imp.dtype, np.complexfloating)


class TestSawtoothWaveform:
    def test_dtype(self):
        waveform = waveforms.sawtooth(
            np.array(1, dtype=np.float32), width=np.float32(1)
        )
        assert waveform.dtype == np.float64

        waveform = waveforms.sawtooth(1)
        assert waveform.dtype == np.float64


class TestSquareWaveform:
    def test_dtype(self):
        waveform = waveforms.square(np.array(1, dtype=np.float32), duty=np.float32(0.5))
        assert waveform.dtype == np.float64

        waveform = waveforms.square(1)
        assert waveform.dtype == np.float64
