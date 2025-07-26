import numpy as np
import pytest

from numpy.testing import assert_allclose
import scipy.special as sc

class TestSphHarm:
    @pytest.mark.slow
    def test_p(self):
        m_max = 20
        n_max = 10

        theta = np.linspace(0, np.pi)
        phi = np.linspace(0, 2*np.pi)
        theta, phi = np.meshgrid(theta, phi)

        y, y_jac, y_hess = sc.sph_harm_y_all(n_max, m_max, theta, phi, diff_n=2)
        p, p_jac, p_hess = sc.sph_legendre_p_all(n_max, m_max, theta, diff_n=2)

        m = np.concatenate([np.arange(m_max + 1), np.arange(-m_max, 0)])
        m = np.expand_dims(m, axis=(0,)+tuple(range(2,theta.ndim+2)))

        assert_allclose(y, p * np.exp(1j * m * phi))

        assert_allclose(y_jac[..., 0], p_jac * np.exp(1j * m * phi))
        assert_allclose(y_jac[..., 1], 1j * m * p * np.exp(1j * m * phi))

        assert_allclose(y_hess[..., 0, 0], p_hess * np.exp(1j * m * phi))
        assert_allclose(y_hess[..., 0, 1], 1j * m * p_jac * np.exp(1j * m * phi))
        assert_allclose(y_hess[..., 1, 0], y_hess[..., 0, 1])
        assert_allclose(y_hess[..., 1, 1], -m * m * p * np.exp(1j * m * phi))

    @pytest.mark.parametrize("n_max", [7, 10, 50])
    @pytest.mark.parametrize("m_max", [1, 4, 5, 9, 14])
    def test_all(self, n_max, m_max):
        theta = np.linspace(0, np.pi)
        phi = np.linspace(0, 2 * np.pi)

        n = np.arange(n_max + 1)
        n = np.expand_dims(n, axis=tuple(range(1,theta.ndim+2)))

        m = np.concatenate([np.arange(m_max + 1), np.arange(-m_max, 0)])
        m = np.expand_dims(m, axis=(0,)+tuple(range(2,theta.ndim+2)))

        y_actual = sc.sph_harm_y_all(n_max, m_max, theta, phi)
        y_desired = sc.sph_harm_y(n, m, theta, phi)

        np.testing.assert_allclose(y_actual, y_desired, rtol=1e-05)

@pytest.mark.filterwarnings("ignore::DeprecationWarning")
def test_first_harmonics():
    # Test against explicit representations of the first four
    # spherical harmonics which use `theta` as the azimuthal angle,
    # `phi` as the polar angle, and include the Condon-Shortley
    # phase.

    # sph_harm is deprecated and is implemented as a shim around sph_harm_y.
    # This test is maintained to verify the correctness of the shim.

    # Notation is Ymn
    def Y00(theta, phi):
        return 0.5*np.sqrt(1/np.pi)

    def Yn11(theta, phi):
        return 0.5*np.sqrt(3/(2*np.pi))*np.exp(-1j*theta)*np.sin(phi)

    def Y01(theta, phi):
        return 0.5*np.sqrt(3/np.pi)*np.cos(phi)

    def Y11(theta, phi):
        return -0.5*np.sqrt(3/(2*np.pi))*np.exp(1j*theta)*np.sin(phi)

    harms = [Y00, Yn11, Y01, Y11]
    m = [0, -1, 0, 1]
    n = [0, 1, 1, 1]

    theta = np.linspace(0, 2*np.pi)
    phi = np.linspace(0, np.pi)
    theta, phi = np.meshgrid(theta, phi)

    for harm, m, n in zip(harms, m, n):
        assert_allclose(sc.sph_harm(m, n, theta, phi),
                        harm(theta, phi),
                        rtol=1e-15, atol=1e-15,
                        err_msg=f"Y^{m}_{n} incorrect")
