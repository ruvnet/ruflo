import math

import numpy as np

import pytest
from numpy.testing import (assert_equal, assert_almost_equal, assert_array_almost_equal,
    assert_allclose, suppress_warnings)

from scipy import special
from scipy.special import (legendre_p, legendre_p_all, assoc_legendre_p,
    assoc_legendre_p_all, sph_legendre_p, sph_legendre_p_all)

# The functions lpn, lpmn, clpmn, appearing below are
# deprecated in favor of legendre_p_all, assoc_legendre_p_all, and
# assoc_legendre_p_all (assoc_legendre_p_all covers lpmn and clpmn)
# respectively. The deprecated functions listed above are implemented as
# shims around their respective replacements. The replacements are tested
# separately, but tests for the deprecated functions remain to verify the
# correctness of the shims.

# Base polynomials come from Abrahmowitz and Stegan
class TestLegendre:
    def test_legendre(self):
        leg0 = special.legendre(0)
        leg1 = special.legendre(1)
        leg2 = special.legendre(2)
        leg3 = special.legendre(3)
        leg4 = special.legendre(4)
        leg5 = special.legendre(5)
        assert_equal(leg0.c, [1])
        assert_equal(leg1.c, [1,0])
        assert_almost_equal(leg2.c, np.array([3,0,-1])/2.0, decimal=13)
        assert_almost_equal(leg3.c, np.array([5,0,-3,0])/2.0)
        assert_almost_equal(leg4.c, np.array([35,0,-30,0,3])/8.0)
        assert_almost_equal(leg5.c, np.array([63,0,-70,0,15,0])/8.0)

    @pytest.mark.parametrize('n', [1, 2, 3, 4, 5])
    @pytest.mark.parametrize('zr', [0.5241717, 12.80232, -9.699001,
                                    0.5122437, 0.1714377])
    @pytest.mark.parametrize('zi', [9.766818, 0.2999083, 8.24726, -22.84843,
                                    -0.8792666])
    def test_lpn_against_clpmn(self, n, zr, zi):
        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            reslpn = special.lpn(n, zr + zi*1j)
            resclpmn = special.clpmn(0, n, zr+zi*1j)

        assert_allclose(reslpn[0], resclpmn[0][0])
        assert_allclose(reslpn[1], resclpmn[1][0])

class TestLegendreP:
    @pytest.mark.parametrize("shape", [(10,), (4, 9), (3, 5, 7)])
    def test_ode(self, shape):
        rng = np.random.default_rng(1234)

        n = rng.integers(0, 100, shape)
        x = rng.uniform(-1, 1, shape)

        p, p_jac, p_hess = legendre_p(n, x, diff_n=2)

        assert p.shape == shape
        assert p_jac.shape == p.shape
        assert p_hess.shape == p_jac.shape

        err = (1 - x * x) * p_hess - 2 * x * p_jac + n * (n + 1) * p
        np.testing.assert_allclose(err, 0, atol=1e-10)

    @pytest.mark.parametrize("n_max", [1, 2, 4, 8, 16, 32])
    @pytest.mark.parametrize("x_shape", [(10,), (4, 9), (3, 5, 7)])
    def test_all_ode(self, n_max, x_shape):
        rng = np.random.default_rng(1234)

        x = rng.uniform(-1, 1, x_shape)
        p, p_jac, p_hess = legendre_p_all(n_max, x, diff_n=2)

        n = np.arange(n_max + 1)
        n = np.expand_dims(n, axis = tuple(range(1, x.ndim + 1)))

        assert p.shape == (len(n),) + x.shape
        assert p_jac.shape == p.shape
        assert p_hess.shape == p_jac.shape

        err = (1 - x * x) * p_hess - 2 * x * p_jac + n * (n + 1) * p
        np.testing.assert_allclose(err, 0, atol=1e-10)

    def test_legacy(self):
        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            p, pd = special.lpn(2, 0.5)

        assert_array_almost_equal(p, [1.00000, 0.50000, -0.12500], 4)
        assert_array_almost_equal(pd, [0.00000, 1.00000, 1.50000], 4)

class TestAssocLegendreP:
    @pytest.mark.parametrize("shape", [(10,), (4, 9), (3, 5, 7, 10)])
    @pytest.mark.parametrize("m_max", [5, 4])
    @pytest.mark.parametrize("n_max", [7, 10])
    def test_lpmn(self, shape, n_max, m_max):
        rng = np.random.default_rng(1234)

        x = rng.uniform(-0.99, 0.99, shape)
        p_all, p_all_jac, p_all_hess = \
            assoc_legendre_p_all(n_max, m_max, x, diff_n=2)

        n = np.arange(n_max + 1)
        n = np.expand_dims(n, axis = tuple(range(1, x.ndim + 2)))

        m = np.concatenate([np.arange(m_max + 1), np.arange(-m_max, 0)])
        m = np.expand_dims(m, axis = (0,) + tuple(range(2, x.ndim + 2)))

        x = np.expand_dims(x, axis = (0, 1))
        p, p_jac, p_hess = assoc_legendre_p(n, m, x, diff_n=2)

        np.testing.assert_allclose(p, p_all)
        np.testing.assert_allclose(p_jac, p_all_jac)
        np.testing.assert_allclose(p_hess, p_all_hess)

    @pytest.mark.parametrize("shape", [(10,), (4, 9), (3, 5, 7, 10)])
    @pytest.mark.parametrize("norm", [True, False])
    def test_ode(self, shape, norm):
        rng = np.random.default_rng(1234)

        n = rng.integers(0, 10, shape)
        m = rng.integers(-10, 10, shape)
        x = rng.uniform(-1, 1, shape)

        p, p_jac, p_hess = assoc_legendre_p(n, m, x, norm=norm, diff_n=2)

        assert p.shape == shape
        assert p_jac.shape == p.shape
        assert p_hess.shape == p_jac.shape

        np.testing.assert_allclose((1 - x * x) * p_hess,
            2 * x * p_jac - (n * (n + 1) - m * m / (1 - x * x)) * p,
            rtol=1e-05, atol=1e-08)

    @pytest.mark.parametrize("shape", [(10,), (4, 9), (3, 5, 7)])
    def test_all(self, shape):
        rng = np.random.default_rng(1234)

        n_max = 20
        m_max = 20

        x = rng.uniform(-0.99, 0.99, shape)

        p, p_jac, p_hess = assoc_legendre_p_all(n_max, m_max, x, diff_n=2)

        m = np.concatenate([np.arange(m_max + 1), np.arange(-m_max, 0)])
        n = np.arange(n_max + 1)

        n = np.expand_dims(n, axis = tuple(range(1, x.ndim + 2)))
        m = np.expand_dims(m, axis = (0,) + tuple(range(2, x.ndim + 2)))
        np.testing.assert_allclose((1 - x * x) * p_hess,
            2 * x * p_jac - (n * (n + 1) - m * m / (1 - x * x)) * p,
            rtol=1e-05, atol=1e-08)

    @pytest.mark.parametrize("shape", [(10,), (4, 9), (3, 5, 7)])
    @pytest.mark.parametrize("norm", [True, False])
    def test_specific(self, shape, norm):
        rng = np.random.default_rng(1234)

        x = rng.uniform(-0.99, 0.99, shape)

        p, p_jac = assoc_legendre_p_all(4, 4, x, norm=norm, diff_n=1)

        np.testing.assert_allclose(p[0, 0],
            assoc_legendre_p_0_0(x, norm=norm))
        np.testing.assert_allclose(p[0, 1], 0)
        np.testing.assert_allclose(p[0, 2], 0)
        np.testing.assert_allclose(p[0, 3], 0)
        np.testing.assert_allclose(p[0, 4], 0)
        np.testing.assert_allclose(p[0, -3], 0)
        np.testing.assert_allclose(p[0, -2], 0)
        np.testing.assert_allclose(p[0, -1], 0)

        np.testing.assert_allclose(p[1, 0],
            assoc_legendre_p_1_0(x, norm=norm))
        np.testing.assert_allclose(p[1, 1],
            assoc_legendre_p_1_1(x, norm=norm))
        np.testing.assert_allclose(p[1, 2], 0)
        np.testing.assert_allclose(p[1, 3], 0)
        np.testing.assert_allclose(p[1, 4], 0)
        np.testing.assert_allclose(p[1, -4], 0)
        np.testing.assert_allclose(p[1, -3], 0)
        np.testing.assert_allclose(p[1, -2], 0)
        np.testing.assert_allclose(p[1, -1],
            assoc_legendre_p_1_m1(x, norm=norm))

        np.testing.assert_allclose(p[2, 0],
            assoc_legendre_p_2_0(x, norm=norm))
        np.testing.assert_allclose(p[2, 1],
            assoc_legendre_p_2_1(x, norm=norm))
        np.testing.assert_allclose(p[2, 2],
            assoc_legendre_p_2_2(x, norm=norm))
        np.testing.assert_allclose(p[2, 3], 0)
        np.testing.assert_allclose(p[2, 4], 0)
        np.testing.assert_allclose(p[2, -4], 0)
        np.testing.assert_allclose(p[2, -3], 0)
        np.testing.assert_allclose(p[2, -2],
            assoc_legendre_p_2_m2(x, norm=norm))
        np.testing.assert_allclose(p[2, -1],
            assoc_legendre_p_2_m1(x, norm=norm))

        np.testing.assert_allclose(p[3, 0],
            assoc_legendre_p_3_0(x, norm=norm))
        np.testing.assert_allclose(p[3, 1],
            assoc_legendre_p_3_1(x, norm=norm))
        np.testing.assert_allclose(p[3, 2],
            assoc_legendre_p_3_2(x, norm=norm))
        np.testing.assert_allclose(p[3, 3],
            assoc_legendre_p_3_3(x, norm=norm))
        np.testing.assert_allclose(p[3, 4], 0)
        np.testing.assert_allclose(p[3, -4], 0)
        np.testing.assert_allclose(p[3, -3],
            assoc_legendre_p_3_m3(x, norm=norm))
        np.testing.assert_allclose(p[3, -2],
            assoc_legendre_p_3_m2(x, norm=norm))
        np.testing.assert_allclose(p[3, -1],
            assoc_legendre_p_3_m1(x, norm=norm))

        np.testing.assert_allclose(p[4, 0],
            assoc_legendre_p_4_0(x, norm=norm))
        np.testing.assert_allclose(p[4, 1],
            assoc_legendre_p_4_1(x, norm=norm))
        np.testing.assert_allclose(p[4, 2],
            assoc_legendre_p_4_2(x, norm=norm))
        np.testing.assert_allclose(p[4, 3],
            assoc_legendre_p_4_3(x, norm=norm))
        np.testing.assert_allclose(p[4, 4],
            assoc_legendre_p_4_4(x, norm=norm))
        np.testing.assert_allclose(p[4, -4],
            assoc_legendre_p_4_m4(x, norm=norm))
        np.testing.assert_allclose(p[4, -3],
            assoc_legendre_p_4_m3(x, norm=norm))
        np.testing.assert_allclose(p[4, -2],
            assoc_legendre_p_4_m2(x, norm=norm))
        np.testing.assert_allclose(p[4, -1],
            assoc_legendre_p_4_m1(x, norm=norm))

        np.testing.assert_allclose(p_jac[0, 0],
            assoc_legendre_p_0_0_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[0, 1], 0)
        np.testing.assert_allclose(p_jac[0, 2], 0)
        np.testing.assert_allclose(p_jac[0, 3], 0)
        np.testing.assert_allclose(p_jac[0, 4], 0)
        np.testing.assert_allclose(p_jac[0, -4], 0)
        np.testing.assert_allclose(p_jac[0, -3], 0)
        np.testing.assert_allclose(p_jac[0, -2], 0)
        np.testing.assert_allclose(p_jac[0, -1], 0)

        np.testing.assert_allclose(p_jac[1, 0],
            assoc_legendre_p_1_0_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[1, 1],
            assoc_legendre_p_1_1_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[1, 2], 0)
        np.testing.assert_allclose(p_jac[1, 3], 0)
        np.testing.assert_allclose(p_jac[1, 4], 0)
        np.testing.assert_allclose(p_jac[1, -4], 0)
        np.testing.assert_allclose(p_jac[1, -3], 0)
        np.testing.assert_allclose(p_jac[1, -2], 0)
        np.testing.assert_allclose(p_jac[1, -1],
            assoc_legendre_p_1_m1_jac(x, norm=norm))

        np.testing.assert_allclose(p_jac[2, 0],
            assoc_legendre_p_2_0_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[2, 1],
            assoc_legendre_p_2_1_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[2, 2],
            assoc_legendre_p_2_2_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[2, 3], 0)
        np.testing.assert_allclose(p_jac[2, 4], 0)
        np.testing.assert_allclose(p_jac[2, -4], 0)
        np.testing.assert_allclose(p_jac[2, -3], 0)
        np.testing.assert_allclose(p_jac[2, -2],
            assoc_legendre_p_2_m2_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[2, -1],
            assoc_legendre_p_2_m1_jac(x, norm=norm))

        np.testing.assert_allclose(p_jac[3, 0],
            assoc_legendre_p_3_0_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[3, 1],
            assoc_legendre_p_3_1_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[3, 2],
            assoc_legendre_p_3_2_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[3, 3],
            assoc_legendre_p_3_3_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[3, 4], 0)
        np.testing.assert_allclose(p_jac[3, -4], 0)
        np.testing.assert_allclose(p_jac[3, -3],
            assoc_legendre_p_3_m3_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[3, -2],
            assoc_legendre_p_3_m2_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[3, -1],
            assoc_legendre_p_3_m1_jac(x, norm=norm))

        np.testing.assert_allclose(p_jac[4, 0],
            assoc_legendre_p_4_0_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[4, 1],
            assoc_legendre_p_4_1_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[4, 2],
            assoc_legendre_p_4_2_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[4, 3],
            assoc_legendre_p_4_3_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[4, 4],
            assoc_legendre_p_4_4_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[4, -4],
            assoc_legendre_p_4_m4_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[4, -3],
            assoc_legendre_p_4_m3_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[4, -2],
            assoc_legendre_p_4_m2_jac(x, norm=norm))
        np.testing.assert_allclose(p_jac[4, -1],
            assoc_legendre_p_4_m1_jac(x, norm=norm))

    @pytest.mark.parametrize("m_max", [7])
    @pytest.mark.parametrize("n_max", [10])
    @pytest.mark.parametrize("x", [1, -1])
    def test_all_limits(self, m_max, n_max, x):
        p, p_jac = assoc_legendre_p_all(n_max, m_max, x, diff_n=1)

        n = np.arange(n_max + 1)

        np.testing.assert_allclose(p_jac[:, 0],
            pow(x, n + 1) * n * (n + 1) / 2)
        np.testing.assert_allclose(p_jac[:, 1],
            np.where(n >= 1, pow(x, n) * np.inf, 0))
        np.testing.assert_allclose(p_jac[:, 2],
            np.where(n >= 2, -pow(x, n + 1) * (n + 2) * (n + 1) * n * (n - 1) / 4, 0))
        np.testing.assert_allclose(p_jac[:, -2],
            np.where(n >= 2, -pow(x, n + 1) / 4, 0))
        np.testing.assert_allclose(p_jac[:, -1],
            np.where(n >= 1, -pow(x, n) * np.inf, 0))

        for m in range(3, m_max + 1):
            np.testing.assert_allclose(p_jac[:, m], 0)
            np.testing.assert_allclose(p_jac[:, -m], 0)

    @pytest.mark.parametrize("m_max", [3, 5, 10])
    @pytest.mark.parametrize("n_max", [10])
    def test_legacy(self, m_max, n_max):
        x = 0.5
        p, p_jac = assoc_legendre_p_all(n_max, m_max, x, diff_n=1)

        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)

            p_legacy, p_jac_legacy = special.lpmn(m_max, n_max, x)
            for m in range(m_max + 1):
                np.testing.assert_allclose(p_legacy[m], p[:, m])

            p_legacy, p_jac_legacy = special.lpmn(-m_max, n_max, x)
            for m in range(m_max + 1):
                np.testing.assert_allclose(p_legacy[m], p[:, -m])

class TestMultiAssocLegendreP:
    @pytest.mark.parametrize("shape", [(1000,), (4, 9), (3, 5, 7)])
    @pytest.mark.parametrize("branch_cut", [2, 3])
    @pytest.mark.parametrize("z_min, z_max", [(-10 - 10j, 10 + 10j),
        (-1, 1), (-10j, 10j)])
    @pytest.mark.parametrize("norm", [True, False])
    def test_specific(self, shape, branch_cut, z_min, z_max, norm):
        rng = np.random.default_rng(1234)

        z = rng.uniform(z_min.real, z_max.real, shape) + \
            1j * rng.uniform(z_min.imag, z_max.imag, shape)

        p, p_jac = assoc_legendre_p_all(4, 4,
            z, branch_cut=branch_cut, norm=norm, diff_n=1)

        np.testing.assert_allclose(p[0, 0],
            assoc_legendre_p_0_0(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[0, 1], 0)
        np.testing.assert_allclose(p[0, 2], 0)
        np.testing.assert_allclose(p[0, 3], 0)
        np.testing.assert_allclose(p[0, 4], 0)
        np.testing.assert_allclose(p[0, -4], 0)
        np.testing.assert_allclose(p[0, -3], 0)
        np.testing.assert_allclose(p[0, -2], 0)
        np.testing.assert_allclose(p[0, -1], 0)

        np.testing.assert_allclose(p[1, 0],
            assoc_legendre_p_1_0(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[1, 1],
            assoc_legendre_p_1_1(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[1, 2], 0)
        np.testing.assert_allclose(p[1, 3], 0)
        np.testing.assert_allclose(p[1, 4], 0)
        np.testing.assert_allclose(p[1, -4], 0)
        np.testing.assert_allclose(p[1, -3], 0)
        np.testing.assert_allclose(p[1, -2], 0)
        np.testing.assert_allclose(p[1, -1],
            assoc_legendre_p_1_m1(z, branch_cut=branch_cut, norm=norm))

        np.testing.assert_allclose(p[2, 0],
            assoc_legendre_p_2_0(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[2, 1],
            assoc_legendre_p_2_1(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[2, 2],
            assoc_legendre_p_2_2(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[2, 3], 0)
        np.testing.assert_allclose(p[2, 4], 0)
        np.testing.assert_allclose(p[2, -4], 0)
        np.testing.assert_allclose(p[2, -3], 0)
        np.testing.assert_allclose(p[2, -2],
            assoc_legendre_p_2_m2(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[2, -1],
            assoc_legendre_p_2_m1(z, branch_cut=branch_cut, norm=norm))

        np.testing.assert_allclose(p[3, 0],
            assoc_legendre_p_3_0(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[3, 1],
            assoc_legendre_p_3_1(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[3, 2],
            assoc_legendre_p_3_2(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[3, 3],
            assoc_legendre_p_3_3(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[3, 4], 0)
        np.testing.assert_allclose(p[3, -4], 0)
        np.testing.assert_allclose(p[3, -3],
            assoc_legendre_p_3_m3(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[3, -2],
            assoc_legendre_p_3_m2(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[3, -1],
            assoc_legendre_p_3_m1(z, branch_cut=branch_cut, norm=norm))

        np.testing.assert_allclose(p[4, 0],
            assoc_legendre_p_4_0(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[4, 1],
            assoc_legendre_p_4_1(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[4, 2],
            assoc_legendre_p_4_2(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[4, 3],
            assoc_legendre_p_4_3(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[4, 4],
            assoc_legendre_p_4_4(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[4, -4],
            assoc_legendre_p_4_m4(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[4, -3],
            assoc_legendre_p_4_m3(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[4, -2],
            assoc_legendre_p_4_m2(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p[4, -1],
            assoc_legendre_p_4_m1(z, branch_cut=branch_cut, norm=norm))

        np.testing.assert_allclose(p_jac[0, 0],
            assoc_legendre_p_0_0_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[0, 1], 0)
        np.testing.assert_allclose(p_jac[0, 2], 0)
        np.testing.assert_allclose(p_jac[0, 3], 0)
        np.testing.assert_allclose(p_jac[0, 4], 0)
        np.testing.assert_allclose(p_jac[0, -4], 0)
        np.testing.assert_allclose(p_jac[0, -3], 0)
        np.testing.assert_allclose(p_jac[0, -2], 0)
        np.testing.assert_allclose(p_jac[0, -1], 0)

        np.testing.assert_allclose(p_jac[1, 0],
            assoc_legendre_p_1_0_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[1, 1],
            assoc_legendre_p_1_1_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[1, 2], 0)
        np.testing.assert_allclose(p_jac[1, 3], 0)
        np.testing.assert_allclose(p_jac[1, 4], 0)
        np.testing.assert_allclose(p_jac[1, -4], 0)
        np.testing.assert_allclose(p_jac[1, -3], 0)
        np.testing.assert_allclose(p_jac[1, -2], 0)
        np.testing.assert_allclose(p_jac[1, -1],
            assoc_legendre_p_1_m1_jac(z, branch_cut=branch_cut, norm=norm))

        np.testing.assert_allclose(p_jac[2, 0],
            assoc_legendre_p_2_0_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[2, 1],
            assoc_legendre_p_2_1_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[2, 2],
            assoc_legendre_p_2_2_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[2, 3], 0)
        np.testing.assert_allclose(p_jac[2, 4], 0)
        np.testing.assert_allclose(p_jac[2, -4], 0)
        np.testing.assert_allclose(p_jac[2, -3], 0)
        np.testing.assert_allclose(p_jac[2, -2],
            assoc_legendre_p_2_m2_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[2, -1],
            assoc_legendre_p_2_m1_jac(z, branch_cut=branch_cut, norm=norm))

        np.testing.assert_allclose(p_jac[3, 0],
            assoc_legendre_p_3_0_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[3, 1],
            assoc_legendre_p_3_1_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[3, 2],
            assoc_legendre_p_3_2_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[3, 3],
            assoc_legendre_p_3_3_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[3, 4], 0)
        np.testing.assert_allclose(p_jac[3, -4], 0)
        np.testing.assert_allclose(p_jac[3, -3],
            assoc_legendre_p_3_m3_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[3, -2],
            assoc_legendre_p_3_m2_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[3, -1],
            assoc_legendre_p_3_m1_jac(z, branch_cut=branch_cut, norm=norm))

        np.testing.assert_allclose(p_jac[4, 0],
            assoc_legendre_p_4_0_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[4, 1],
            assoc_legendre_p_4_1_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[4, 2],
            assoc_legendre_p_4_2_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[4, 3],
            assoc_legendre_p_4_3_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[4, 4],
            assoc_legendre_p_4_4_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[4, -4],
            assoc_legendre_p_4_m4_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[4, -3],
            assoc_legendre_p_4_m3_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[4, -2],
            assoc_legendre_p_4_m2_jac(z, branch_cut=branch_cut, norm=norm))
        np.testing.assert_allclose(p_jac[4, -1],
            assoc_legendre_p_4_m1_jac(z, branch_cut=branch_cut, norm=norm))

class TestSphLegendreP:
    @pytest.mark.parametrize("shape", [(10,), (4, 9), (3, 5, 7)])
    def test_specific(self, shape):
        rng = np.random.default_rng(1234)

        theta = rng.uniform(-np.pi, np.pi, shape)

        p, p_jac = sph_legendre_p_all(4, 4, theta, diff_n=1)

        np.testing.assert_allclose(p[0, 0],
            sph_legendre_p_0_0(theta))
        np.testing.assert_allclose(p[0, 1], 0)
        np.testing.assert_allclose(p[0, 2], 0)
        np.testing.assert_allclose(p[0, 3], 0)
        np.testing.assert_allclose(p[0, 4], 0)
        np.testing.assert_allclose(p[0, -3], 0)
        np.testing.assert_allclose(p[0, -2], 0)
        np.testing.assert_allclose(p[0, -1], 0)

        np.testing.assert_allclose(p[1, 0],
            sph_legendre_p_1_0(theta))
        np.testing.assert_allclose(p[1, 1],
            sph_legendre_p_1_1(theta))
        np.testing.assert_allclose(p[1, 2], 0)
        np.testing.assert_allclose(p[1, 3], 0)
        np.testing.assert_allclose(p[1, 4], 0)
        np.testing.assert_allclose(p[1, -4], 0)
        np.testing.assert_allclose(p[1, -3], 0)
        np.testing.assert_allclose(p[1, -2], 0)
        np.testing.assert_allclose(p[1, -1],
            sph_legendre_p_1_m1(theta))

        np.testing.assert_allclose(p[2, 0],
            sph_legendre_p_2_0(theta))
        np.testing.assert_allclose(p[2, 1],
            sph_legendre_p_2_1(theta))
        np.testing.assert_allclose(p[2, 2],
            sph_legendre_p_2_2(theta))
        np.testing.assert_allclose(p[2, 3], 0)
        np.testing.assert_allclose(p[2, 4], 0)
        np.testing.assert_allclose(p[2, -4], 0)
        np.testing.assert_allclose(p[2, -3], 0)
        np.testing.assert_allclose(p[2, -2],
            sph_legendre_p_2_m2(theta))
        np.testing.assert_allclose(p[2, -1],
            sph_legendre_p_2_m1(theta))

        np.testing.assert_allclose(p[3, 0],
            sph_legendre_p_3_0(theta))
        np.testing.assert_allclose(p[3, 1],
            sph_legendre_p_3_1(theta))
        np.testing.assert_allclose(p[3, 2],
            sph_legendre_p_3_2(theta))
        np.testing.assert_allclose(p[3, 3],
            sph_legendre_p_3_3(theta))
        np.testing.assert_allclose(p[3, 4], 0)
        np.testing.assert_allclose(p[3, -4], 0)
        np.testing.assert_allclose(p[3, -3],
            sph_legendre_p_3_m3(theta))
        np.testing.assert_allclose(p[3, -2],
            sph_legendre_p_3_m2(theta))
        np.testing.assert_allclose(p[3, -1],
            sph_legendre_p_3_m1(theta))

        np.testing.assert_allclose(p[4, 0],
            sph_legendre_p_4_0(theta))
        np.testing.assert_allclose(p[4, 1],
            sph_legendre_p_4_1(theta))
        np.testing.assert_allclose(p[4, 2],
            sph_legendre_p_4_2(theta))
        np.testing.assert_allclose(p[4, 3],
            sph_legendre_p_4_3(theta))
        np.testing.assert_allclose(p[4, 4],
            sph_legendre_p_4_4(theta))
        np.testing.assert_allclose(p[4, -4],
            sph_legendre_p_4_m4(theta))
        np.testing.assert_allclose(p[4, -3],
            sph_legendre_p_4_m3(theta))
        np.testing.assert_allclose(p[4, -2],
            sph_legendre_p_4_m2(theta))
        np.testing.assert_allclose(p[4, -1],
            sph_legendre_p_4_m1(theta))

        np.testing.assert_allclose(p_jac[0, 0],
            sph_legendre_p_0_0_jac(theta))
        np.testing.assert_allclose(p_jac[0, 1], 0)
        np.testing.assert_allclose(p_jac[0, 2], 0)
        np.testing.assert_allclose(p_jac[0, 3], 0)
        np.testing.assert_allclose(p_jac[0, 4], 0)
        np.testing.assert_allclose(p_jac[0, -3], 0)
        np.testing.assert_allclose(p_jac[0, -2], 0)
        np.testing.assert_allclose(p_jac[0, -1], 0)

        np.testing.assert_allclose(p_jac[1, 0],
            sph_legendre_p_1_0_jac(theta))
        np.testing.assert_allclose(p_jac[1, 1],
            sph_legendre_p_1_1_jac(theta))
        np.testing.assert_allclose(p_jac[1, 2], 0)
        np.testing.assert_allclose(p_jac[1, 3], 0)
        np.testing.assert_allclose(p_jac[1, 4], 0)
        np.testing.assert_allclose(p_jac[1, -4], 0)
        np.testing.assert_allclose(p_jac[1, -3], 0)
        np.testing.assert_allclose(p_jac[1, -2], 0)
        np.testing.assert_allclose(p_jac[1, -1],
            sph_legendre_p_1_m1_jac(theta))

        np.testing.assert_allclose(p_jac[2, 0],
            sph_legendre_p_2_0_jac(theta))
        np.testing.assert_allclose(p_jac[2, 1],
            sph_legendre_p_2_1_jac(theta))
        np.testing.assert_allclose(p_jac[2, 2],
            sph_legendre_p_2_2_jac(theta))
        np.testing.assert_allclose(p_jac[2, 3], 0)
        np.testing.assert_allclose(p_jac[2, 4], 0)
        np.testing.assert_allclose(p_jac[2, -4], 0)
        np.testing.assert_allclose(p_jac[2, -3], 0)
        np.testing.assert_allclose(p_jac[2, -2],
            sph_legendre_p_2_m2_jac(theta))
        np.testing.assert_allclose(p_jac[2, -1],
            sph_legendre_p_2_m1_jac(theta))

        np.testing.assert_allclose(p_jac[3, 0],
            sph_legendre_p_3_0_jac(theta))
        np.testing.assert_allclose(p_jac[3, 1],
            sph_legendre_p_3_1_jac(theta))
        np.testing.assert_allclose(p_jac[3, 2],
            sph_legendre_p_3_2_jac(theta))
        np.testing.assert_allclose(p_jac[3, 3],
            sph_legendre_p_3_3_jac(theta))
        np.testing.assert_allclose(p_jac[3, 4], 0)
        np.testing.assert_allclose(p_jac[3, -4], 0)
        np.testing.assert_allclose(p_jac[3, -3],
            sph_legendre_p_3_m3_jac(theta))
        np.testing.assert_allclose(p_jac[3, -2],
            sph_legendre_p_3_m2_jac(theta))
        np.testing.assert_allclose(p_jac[3, -1],
            sph_legendre_p_3_m1_jac(theta))

        np.testing.assert_allclose(p_jac[4, 0],
            sph_legendre_p_4_0_jac(theta))
        np.testing.assert_allclose(p_jac[4, 1],
            sph_legendre_p_4_1_jac(theta))
        np.testing.assert_allclose(p_jac[4, 2],
            sph_legendre_p_4_2_jac(theta))
        np.testing.assert_allclose(p_jac[4, 3],
            sph_legendre_p_4_3_jac(theta))
        np.testing.assert_allclose(p_jac[4, 4],
            sph_legendre_p_4_4_jac(theta))
        np.testing.assert_allclose(p_jac[4, -4],
            sph_legendre_p_4_m4_jac(theta))
        np.testing.assert_allclose(p_jac[4, -3],
            sph_legendre_p_4_m3_jac(theta))
        np.testing.assert_allclose(p_jac[4, -2],
            sph_legendre_p_4_m2_jac(theta))
        np.testing.assert_allclose(p_jac[4, -1],
            sph_legendre_p_4_m1_jac(theta))

    @pytest.mark.parametrize("shape", [(10,), (4, 9), (3, 5, 7, 10)])
    def test_ode(self, shape):
        rng = np.random.default_rng(1234)

        n = rng.integers(0, 10, shape)
        m = rng.integers(-10, 10, shape)
        theta = rng.uniform(-np.pi, np.pi, shape)

        p, p_jac, p_hess = sph_legendre_p(n, m, theta, diff_n=2)

        assert p.shape == shape
        assert p_jac.shape == p.shape
        assert p_hess.shape == p_jac.shape

        np.testing.assert_allclose(np.sin(theta) * p_hess, -np.cos(theta) * p_jac
            - (n * (n + 1) * np.sin(theta) - m * m / np.sin(theta)) * p,
            rtol=1e-05, atol=1e-08)

class TestLegendreFunctions:
    def test_clpmn(self):
        z = 0.5+0.3j

        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            clp = special.clpmn(2, 2, z, 3)

        assert_array_almost_equal(clp,
                   (np.array([[1.0000, z, 0.5*(3*z*z-1)],
                           [0.0000, np.sqrt(z*z-1), 3*z*np.sqrt(z*z-1)],
                           [0.0000, 0.0000, 3*(z*z-1)]]),
                    np.array([[0.0000, 1.0000, 3*z],
                           [0.0000, z/np.sqrt(z*z-1), 3*(2*z*z-1)/np.sqrt(z*z-1)],
                           [0.0000, 0.0000, 6*z]])),
                    7)

    def test_clpmn_close_to_real_2(self):
        eps = 1e-10
        m = 1
        n = 3
        x = 0.5

        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            clp_plus = special.clpmn(m, n, x+1j*eps, 2)[0][m, n]
            clp_minus = special.clpmn(m, n, x-1j*eps, 2)[0][m, n]

        assert_array_almost_equal(np.array([clp_plus, clp_minus]),
                                  np.array([special.lpmv(m, n, x),
                                         special.lpmv(m, n, x)]),
                                  7)

    def test_clpmn_close_to_real_3(self):
        eps = 1e-10
        m = 1
        n = 3
        x = 0.5

        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            clp_plus = special.clpmn(m, n, x+1j*eps, 3)[0][m, n]
            clp_minus = special.clpmn(m, n, x-1j*eps, 3)[0][m, n]

        assert_array_almost_equal(np.array([clp_plus, clp_minus]),
                                  np.array([special.lpmv(m, n, x)*np.exp(-0.5j*m*np.pi),
                                         special.lpmv(m, n, x)*np.exp(0.5j*m*np.pi)]),
                                  7)

    def test_clpmn_across_unit_circle(self):
        eps = 1e-7
        m = 1
        n = 1
        x = 1j

        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            for type in [2, 3]:
                assert_almost_equal(special.clpmn(m, n, x+1j*eps, type)[0][m, n],
                                special.clpmn(m, n, x-1j*eps, type)[0][m, n], 6)

    def test_inf(self):
        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            for z in (1, -1):
                for n in range(4):
                    for m in range(1, n):
                        lp = special.clpmn(m, n, z)
                        assert np.isinf(lp[1][1,1:]).all()
                        lp = special.lpmn(m, n, z)
                        assert np.isinf(lp[1][1,1:]).all()

    def test_deriv_clpmn(self):
        # data inside and outside of the unit circle
        zvals = [0.5+0.5j, -0.5+0.5j, -0.5-0.5j, 0.5-0.5j,
                 1+1j, -1+1j, -1-1j, 1-1j]
        m = 2
        n = 3

        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            for type in [2, 3]:
                for z in zvals:
                    for h in [1e-3, 1e-3j]:
                        approx_derivative = (special.clpmn(m, n, z+0.5*h, type)[0]
                                            - special.clpmn(m, n, z-0.5*h, type)[0])/h
                        assert_allclose(special.clpmn(m, n, z, type)[1],
                                        approx_derivative,
                                        rtol=1e-4)

    """
    @pytest.mark.parametrize("m_max", [3])
    @pytest.mark.parametrize("n_max", [5])
    @pytest.mark.parametrize("z", [-1])
    def test_clpmn_all_limits(self, m_max, n_max, z):
        rng = np.random.default_rng(1234)

        type = 2

        p, p_jac = special.clpmn_all(m_max, n_max, type, z, diff_n=1)

        n = np.arange(n_max + 1)

        np.testing.assert_allclose(p_jac[0], pow(z, n + 1) * n * (n + 1) / 2)
        np.testing.assert_allclose(p_jac[1], np.where(n >= 1, pow(z, n) * np.inf, 0))
        np.testing.assert_allclose(p_jac[2], np.where(n >= 2,
            -pow(z, n + 1) * (n + 2) * (n + 1) * n * (n - 1) / 4, 0))
        np.testing.assert_allclose(p_jac[-2], np.where(n >= 2, -pow(z, n + 1) / 4, 0))
        np.testing.assert_allclose(p_jac[-1], np.where(n >= 1, -pow(z, n) * np.inf, 0))

        for m in range(3, m_max + 1):
            np.testing.assert_allclose(p_jac[m], 0)
            np.testing.assert_allclose(p_jac[-m], 0)
    """

    def test_lpmv(self):
        lp = special.lpmv(0,2,.5)
        assert_almost_equal(lp,-0.125,7)
        lp = special.lpmv(0,40,.001)
        assert_almost_equal(lp,0.1252678976534484,7)

        # XXX: this is outside the domain of the current implementation,
        #      so ensure it returns a NaN rather than a wrong answer.
        with np.errstate(all='ignore'):
            lp = special.lpmv(-1,-1,.001)
        assert lp != 0 or np.isnan(lp)

    def test_lqmn(self):
        lqmnf = special.lqmn(0,2,.5)
        lqf = special.lqn(2,.5)
        assert_array_almost_equal(lqmnf[0][0],lqf[0],4)
        assert_array_almost_equal(lqmnf[1][0],lqf[1],4)

    def test_lqmn_gt1(self):
        """algorithm for real arguments changes at 1.0001
           test against analytical result for m=2, n=1
        """
        x0 = 1.0001
        delta = 0.00002
        for x in (x0-delta, x0+delta):
            lq = special.lqmn(2, 1, x)[0][-1, -1]
            expected = 2/(x*x-1)
            assert_almost_equal(lq, expected)

    def test_lqmn_shape(self):
        a, b = special.lqmn(4, 4, 1.1)
        assert_equal(a.shape, (5, 5))
        assert_equal(b.shape, (5, 5))

        a, b = special.lqmn(4, 0, 1.1)
        assert_equal(a.shape, (5, 1))
        assert_equal(b.shape, (5, 1))

    def test_lqn(self):
        lqf = special.lqn(2,.5)
        assert_array_almost_equal(lqf,(np.array([0.5493, -0.7253, -0.8187]),
                                       np.array([1.3333, 1.216, -0.8427])),4)

    @pytest.mark.parametrize("function", [special.lpn, special.lqn])
    @pytest.mark.parametrize("n", [1, 2, 4, 8, 16, 32])
    @pytest.mark.parametrize("z_complex", [False, True])
    @pytest.mark.parametrize("z_inexact", [False, True])
    @pytest.mark.parametrize(
        "input_shape",
        [
            (), (1, ), (2, ), (2, 1), (1, 2), (2, 2), (2, 2, 1), (2, 2, 2)
        ]
    )
    def test_array_inputs_lxn(self, function, n, z_complex, z_inexact, input_shape):
        """Tests for correct output shapes."""
        rng = np.random.default_rng(1234)
        if z_inexact:
            z = rng.integers(-3, 3, size=input_shape)
        else:
            z = rng.uniform(-1, 1, size=input_shape)

        if z_complex:
            z = 1j * z + 0.5j * z

        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            P_z, P_d_z = function(n, z)
        assert P_z.shape == (n + 1, ) + input_shape
        assert P_d_z.shape == (n + 1, ) + input_shape

    @pytest.mark.parametrize("function", [special.lqmn])
    @pytest.mark.parametrize(
        "m,n",
        [(0, 1), (1, 2), (1, 4), (3, 8), (11, 16), (19, 32)]
    )
    @pytest.mark.parametrize("z_inexact", [False, True])
    @pytest.mark.parametrize(
        "input_shape", [
            (), (1, ), (2, ), (2, 1), (1, 2), (2, 2), (2, 2, 1)
        ]
    )
    def test_array_inputs_lxmn(self, function, m, n, z_inexact, input_shape):
        """Tests for correct output shapes and dtypes."""
        rng = np.random.default_rng(1234)
        if z_inexact:
            z = rng.integers(-3, 3, size=input_shape)
        else:
            z = rng.uniform(-1, 1, size=input_shape)

        P_z, P_d_z = function(m, n, z)
        assert P_z.shape == (m + 1, n + 1) + input_shape
        assert P_d_z.shape == (m + 1, n + 1) + input_shape

    @pytest.mark.parametrize("function", [special.clpmn, special.lqmn])
    @pytest.mark.parametrize(
        "m,n",
        [(0, 1), (1, 2), (1, 4), (3, 8), (11, 16), (19, 32)]
    )
    @pytest.mark.parametrize(
        "input_shape", [
            (), (1, ), (2, ), (2, 1), (1, 2), (2, 2), (2, 2, 1)
        ]
    )
    def test_array_inputs_clxmn(self, function, m, n, input_shape):
        """Tests for correct output shapes and dtypes."""
        rng = np.random.default_rng(1234)
        z = rng.uniform(-1, 1, size=input_shape)
        z = 1j * z + 0.5j * z

        with suppress_warnings() as sup:
            sup.filter(category=DeprecationWarning)
            P_z, P_d_z = function(m, n, z)

        assert P_z.shape == (m + 1, n + 1) + input_shape
        assert P_d_z.shape == (m + 1, n + 1) + input_shape

def assoc_legendre_factor(n, m, norm):
    if norm:
        return (math.sqrt((2 * n + 1) *
            math.factorial(n - m) / (2 * math.factorial(n + m))))

    return 1

def assoc_legendre_p_0_0(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(0, 0, norm)

    return np.full_like(z, fac)

def assoc_legendre_p_1_0(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(1, 0, norm)

    return fac * z

def assoc_legendre_p_1_1(z, *, branch_cut=2, norm=False):
    branch_sign = np.where(branch_cut == 3, np.where(np.signbit(np.real(z)), 1, -1), -1)
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(1, 1, norm)

    w = np.sqrt(np.where(branch_cut == 3, z * z - 1, 1 - z * z))

    return branch_cut_sign * branch_sign * fac * w

def assoc_legendre_p_1_m1(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(1, -1, norm)

    return (-branch_cut_sign * fac *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut) / 2)

def assoc_legendre_p_2_0(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(2, 0, norm)

    return fac * (3 * z * z - 1) / 2

def assoc_legendre_p_2_1(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(2, 1, norm)

    return (3 * fac * z *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut))

def assoc_legendre_p_2_2(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(2, 2, norm)

    return 3 * branch_cut_sign * fac * (1 - z * z)

def assoc_legendre_p_2_m2(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(2, -2, norm)

    return branch_cut_sign * fac * (1 - z * z) / 8

def assoc_legendre_p_2_m1(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(2, -1, norm)

    return (-branch_cut_sign * fac * z *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut) / 2)

def assoc_legendre_p_3_0(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(3, 0, norm)

    return fac * (5 * z * z - 3) * z / 2

def assoc_legendre_p_3_1(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(3, 1, norm)

    return (3 * fac * (5 * z * z - 1) *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut) / 2)

def assoc_legendre_p_3_2(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(3, 2, norm)

    return 15 * branch_cut_sign * fac * (1 - z * z) * z

def assoc_legendre_p_3_3(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(3, 3, norm)

    return (15 * branch_cut_sign * fac * (1 - z * z) *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut))

def assoc_legendre_p_3_m3(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(3, -3, norm)

    return (fac * (z * z - 1) *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut) / 48)

def assoc_legendre_p_3_m2(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(3, -2, norm)

    return branch_cut_sign * fac * (1 - z * z) * z / 8

def assoc_legendre_p_3_m1(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(3, -1, norm)

    return (branch_cut_sign * fac * (1 - 5 * z * z) *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut) / 8)

def assoc_legendre_p_4_0(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, 0, norm)

    return fac * ((35 * z * z - 30) * z * z + 3) / 8

def assoc_legendre_p_4_1(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, 1, norm)

    return (5 * fac * (7 * z * z - 3) * z *
       assoc_legendre_p_1_1(z, branch_cut=branch_cut) / 2)

def assoc_legendre_p_4_2(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(4, 2, norm)

    return 15 * branch_cut_sign * fac * ((8 - 7 * z * z) * z * z - 1) / 2

def assoc_legendre_p_4_3(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(4, 3, norm)

    return (105 * branch_cut_sign * fac * (1 - z * z) * z *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut))

def assoc_legendre_p_4_4(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, 4, norm)

    return 105 * fac * np.square(z * z - 1)

def assoc_legendre_p_4_m4(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, -4, norm)

    return fac * np.square(z * z - 1) / 384

def assoc_legendre_p_4_m3(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, -3, norm)

    return (fac * (z * z - 1) * z *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut) / 48)

def assoc_legendre_p_4_m2(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(4, -2, norm)

    return branch_cut_sign * fac * ((8 - 7 * z * z) * z * z - 1) / 48

def assoc_legendre_p_4_m1(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(4, -1, norm)

    return (branch_cut_sign * fac * (3 - 7 * z * z) * z *
        assoc_legendre_p_1_1(z, branch_cut=branch_cut) / 8)

def assoc_legendre_p_1_1_jac_div_z(z, branch_cut=2):
    branch_sign = np.where(branch_cut == 3, np.where(np.signbit(np.real(z)), 1, -1), -1)

    out11_div_z = (-branch_sign /
        np.sqrt(np.where(branch_cut == 3, z * z - 1, 1 - z * z)))

    return out11_div_z

def assoc_legendre_p_0_0_jac(z, *, branch_cut=2, norm=False):
    return np.zeros_like(z)

def assoc_legendre_p_1_0_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(1, 0, norm)

    return np.full_like(z, fac)

def assoc_legendre_p_1_1_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(1, 1, norm)

    return (fac * z *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut))

def assoc_legendre_p_1_m1_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(1, -1, norm)

    return (-branch_cut_sign * fac * z *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut) / 2)

def assoc_legendre_p_2_0_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(2, 0, norm)

    return 3 * fac * z

def assoc_legendre_p_2_1_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(2, 1, norm)

    return (3 * fac * (2 * z * z - 1) *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut))

def assoc_legendre_p_2_2_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(2, 2, norm)

    return -6 * branch_cut_sign * fac * z

def assoc_legendre_p_2_m1_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(2, -1, norm)

    return (branch_cut_sign * fac * (1 - 2 * z * z) *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut) / 2)

def assoc_legendre_p_2_m2_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(2, -2, norm)

    return -branch_cut_sign * fac * z / 4

def assoc_legendre_p_3_0_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(3, 0, norm)

    return 3 * fac * (5 * z * z - 1) / 2

def assoc_legendre_p_3_1_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(3, 1, norm)

    return (3 * fac * (15 * z * z - 11) * z *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut) / 2)

def assoc_legendre_p_3_2_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(3, 2, norm)

    return 15 * branch_cut_sign * fac * (1 - 3 * z * z)

def assoc_legendre_p_3_3_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(3, 3, norm)

    return (45 * branch_cut_sign * fac * (1 - z * z) * z *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut))

def assoc_legendre_p_3_m3_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(3, -3, norm)

    return (fac * (z * z - 1) * z *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut) / 16)

def assoc_legendre_p_3_m2_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(3, -2, norm)

    return branch_cut_sign * fac * (1 - 3 * z * z) / 8

def assoc_legendre_p_3_m1_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(3, -1, norm)

    return (branch_cut_sign * fac * (11 - 15 * z * z) * z *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut) / 8)

def assoc_legendre_p_4_0_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, 0, norm)

    return 5 * fac * (7 * z * z - 3) * z / 2

def assoc_legendre_p_4_1_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, 1, norm)

    return (5 * fac * ((28 * z * z - 27) * z * z + 3) *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut) / 2)

def assoc_legendre_p_4_2_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(4, 2, norm)

    return 30 * branch_cut_sign * fac * (4 - 7 * z * z) * z

def assoc_legendre_p_4_3_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(4, 3, norm)

    return (105 * branch_cut_sign * fac * ((5 - 4 * z * z) * z * z - 1) *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut))

def assoc_legendre_p_4_4_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, 4, norm)

    return 420 * fac * (z * z - 1) * z

def assoc_legendre_p_4_m4_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, -4, norm)

    return fac * (z * z - 1) * z / 96

def assoc_legendre_p_4_m3_jac(z, *, branch_cut=2, norm=False):
    fac = assoc_legendre_factor(4, -3, norm)

    return (fac * ((4 * z * z - 5) * z * z + 1) *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut) / 48)

def assoc_legendre_p_4_m2_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(4, -2, norm)

    return branch_cut_sign * fac * (4 - 7 * z * z) * z / 12

def assoc_legendre_p_4_m1_jac(z, *, branch_cut=2, norm=False):
    branch_cut_sign = np.where(branch_cut == 3, -1, 1)
    fac = assoc_legendre_factor(4, -1, norm)

    return (branch_cut_sign * fac * ((27 - 28 * z * z) * z * z - 3) *
        assoc_legendre_p_1_1_jac_div_z(z, branch_cut=branch_cut) / 8)

def sph_legendre_factor(n, m):
    return assoc_legendre_factor(n, m, norm=True) / np.sqrt(2 * np.pi)

def sph_legendre_p_0_0(theta):
    fac = sph_legendre_factor(0, 0)

    return np.full_like(theta, fac)

def sph_legendre_p_1_0(theta):
    fac = sph_legendre_factor(1, 0)

    return fac * np.cos(theta)

def sph_legendre_p_1_1(theta):
    fac = sph_legendre_factor(1, 1)

    return -fac * np.abs(np.sin(theta))

def sph_legendre_p_1_m1(theta):
    fac = sph_legendre_factor(1, -1)

    return fac * np.abs(np.sin(theta)) / 2

def sph_legendre_p_2_0(theta):
    fac = sph_legendre_factor(2, 0)

    return fac * (3 * np.square(np.cos(theta)) - 1) / 2

def sph_legendre_p_2_1(theta):
    fac = sph_legendre_factor(2, 1)

    return -3 * fac * np.abs(np.sin(theta)) * np.cos(theta)

def sph_legendre_p_2_2(theta):
    fac = sph_legendre_factor(2, 2)

    return 3 * fac * (1 - np.square(np.cos(theta)))

def sph_legendre_p_2_m2(theta):
    fac = sph_legendre_factor(2, -2)

    return fac * (1 - np.square(np.cos(theta))) / 8

def sph_legendre_p_2_m1(theta):
    fac = sph_legendre_factor(2, -1)

    return fac * np.cos(theta) * np.abs(np.sin(theta)) / 2

def sph_legendre_p_3_0(theta):
    fac = sph_legendre_factor(3, 0)

    return (fac * (5 * np.square(np.cos(theta)) - 3) *
        np.cos(theta) / 2)

def sph_legendre_p_3_1(theta):
    fac = sph_legendre_factor(3, 1)

    return (-3 * fac * (5 * np.square(np.cos(theta)) - 1) *
        np.abs(np.sin(theta)) / 2)

def sph_legendre_p_3_2(theta):
    fac = sph_legendre_factor(3, 2)

    return (-15 * fac * (np.square(np.cos(theta)) - 1) *
        np.cos(theta))

def sph_legendre_p_3_3(theta):
    fac = sph_legendre_factor(3, 3)

    return -15 * fac * np.power(np.abs(np.sin(theta)), 3)

def sph_legendre_p_3_m3(theta):
    fac = sph_legendre_factor(3, -3)

    return fac * np.power(np.abs(np.sin(theta)), 3) / 48

def sph_legendre_p_3_m2(theta):
    fac = sph_legendre_factor(3, -2)

    return (-fac * (np.square(np.cos(theta)) - 1) *
        np.cos(theta) / 8)

def sph_legendre_p_3_m1(theta):
    fac = sph_legendre_factor(3, -1)

    return (fac * (5 * np.square(np.cos(theta)) - 1) *
        np.abs(np.sin(theta)) / 8)

def sph_legendre_p_4_0(theta):
    fac = sph_legendre_factor(4, 0)

    return (fac * (35 * np.square(np.square(np.cos(theta))) -
        30 * np.square(np.cos(theta)) + 3) / 8)

def sph_legendre_p_4_1(theta):
    fac = sph_legendre_factor(4, 1)

    return (-5 * fac * (7 * np.square(np.cos(theta)) - 3) *
        np.cos(theta) * np.abs(np.sin(theta)) / 2)

def sph_legendre_p_4_2(theta):
    fac = sph_legendre_factor(4, 2)

    return (-15 * fac * (7 * np.square(np.cos(theta)) - 1) *
        (np.square(np.cos(theta)) - 1) / 2)

def sph_legendre_p_4_3(theta):
    fac = sph_legendre_factor(4, 3)

    return -105 * fac * np.power(np.abs(np.sin(theta)), 3) * np.cos(theta)

def sph_legendre_p_4_4(theta):
    fac = sph_legendre_factor(4, 4)

    return 105 * fac * np.square(np.square(np.cos(theta)) - 1)

def sph_legendre_p_4_m4(theta):
    fac = sph_legendre_factor(4, -4)

    return fac * np.square(np.square(np.cos(theta)) - 1) / 384

def sph_legendre_p_4_m3(theta):
    fac = sph_legendre_factor(4, -3)

    return (fac * np.power(np.abs(np.sin(theta)), 3) *
        np.cos(theta) / 48)

def sph_legendre_p_4_m2(theta):
    fac = sph_legendre_factor(4, -2)

    return (-fac * (7 * np.square(np.cos(theta)) - 1) *
        (np.square(np.cos(theta)) - 1) / 48)

def sph_legendre_p_4_m1(theta):
    fac = sph_legendre_factor(4, -1)

    return (fac * (7 * np.square(np.cos(theta)) - 3) *
        np.cos(theta) * np.abs(np.sin(theta)) / 8)

def sph_legendre_p_0_0_jac(theta):
    return np.zeros_like(theta)

def sph_legendre_p_1_0_jac(theta):
    fac = sph_legendre_factor(1, 0)

    return -fac * np.sin(theta)

def sph_legendre_p_1_1_jac(theta):
    fac = sph_legendre_factor(1, 1)

    return -fac * np.cos(theta) * (2 * np.heaviside(np.sin(theta), 1) - 1)

def sph_legendre_p_1_m1_jac(theta):
    fac = sph_legendre_factor(1, -1)

    return fac * np.cos(theta) * (2 * np.heaviside(np.sin(theta), 1) - 1) / 2

def sph_legendre_p_2_0_jac(theta):
    fac = sph_legendre_factor(2, 0)

    return -3 * fac * np.cos(theta) * np.sin(theta)

def sph_legendre_p_2_1_jac(theta):
    fac = sph_legendre_factor(2, 1)

    return (3 * fac * (-np.square(np.cos(theta)) *
        (2 * np.heaviside(np.sin(theta), 1) - 1) +
        np.abs(np.sin(theta)) * np.sin(theta)))

def sph_legendre_p_2_2_jac(theta):
    fac = sph_legendre_factor(2, 2)

    return 6 * fac * np.sin(theta) * np.cos(theta)

def sph_legendre_p_2_m2_jac(theta):
    fac = sph_legendre_factor(2, -2)

    return fac * np.sin(theta) * np.cos(theta) / 4

def sph_legendre_p_2_m1_jac(theta):
    fac = sph_legendre_factor(2, -1)

    return (-fac * (-np.square(np.cos(theta)) *
        (2 * np.heaviside(np.sin(theta), 1) - 1) +
        np.abs(np.sin(theta)) * np.sin(theta)) / 2)

def sph_legendre_p_3_0_jac(theta):
    fac = sph_legendre_factor(3, 0)

    return 3 * fac * (1 - 5 * np.square(np.cos(theta))) * np.sin(theta) / 2

def sph_legendre_p_3_1_jac(theta):
    fac = sph_legendre_factor(3, 1)

    return (3 * fac * (11 - 15 * np.square(np.cos(theta))) * np.cos(theta) *
        (2 * np.heaviside(np.sin(theta), 1) - 1) / 2)

def sph_legendre_p_3_2_jac(theta):
    fac = sph_legendre_factor(3, 2)

    return 15 * fac * (3 * np.square(np.cos(theta)) - 1) * np.sin(theta)

def sph_legendre_p_3_3_jac(theta):
    fac = sph_legendre_factor(3, 3)

    return -45 * fac * np.abs(np.sin(theta)) * np.sin(theta) * np.cos(theta)

def sph_legendre_p_3_m3_jac(theta):
    fac = sph_legendre_factor(3, -3)

    return fac * np.abs(np.sin(theta)) * np.sin(theta) * np.cos(theta) / 16

def sph_legendre_p_3_m2_jac(theta):
    fac = sph_legendre_factor(3, -2)

    return fac * (3 * np.square(np.cos(theta)) - 1) * np.sin(theta) / 8

def sph_legendre_p_3_m1_jac(theta):
    fac = sph_legendre_factor(3, -1)

    return (-fac * (11 - 15 * np.square(np.cos(theta))) *
        np.cos(theta) *
        (2 * np.heaviside(np.sin(theta), 1) - 1) / 8)

def sph_legendre_p_4_0_jac(theta):
    fac = sph_legendre_factor(4, 0)

    return (-5 * fac * (7 * np.square(np.cos(theta)) - 3) *
        np.sin(theta) * np.cos(theta) / 2)

def sph_legendre_p_4_1_jac(theta):
    fac = sph_legendre_factor(4, 1)

    return (5 * fac * (-3 + 27 * np.square(np.cos(theta)) -
        28 * np.square(np.square(np.cos(theta)))) *
        (2 * np.heaviside(np.sin(theta), 1) - 1) / 2)

def sph_legendre_p_4_2_jac(theta):
    fac = sph_legendre_factor(4, 2)

    return (30 * fac * (7 * np.square(np.cos(theta)) - 4) *
        np.sin(theta) * np.cos(theta))

def sph_legendre_p_4_3_jac(theta):
    fac = sph_legendre_factor(4, 3)

    return (-105 * fac * (4 * np.square(np.cos(theta)) - 1) *
        np.abs(np.sin(theta)) * np.sin(theta))

def sph_legendre_p_4_4_jac(theta):
    fac = sph_legendre_factor(4, 4)

    return (-420 * fac * (np.square(np.cos(theta)) - 1) *
        np.sin(theta) * np.cos(theta))

def sph_legendre_p_4_m4_jac(theta):
    fac = sph_legendre_factor(4, -4)

    return (-fac * (np.square(np.cos(theta)) - 1) *
        np.sin(theta) * np.cos(theta) / 96)

def sph_legendre_p_4_m3_jac(theta):
    fac = sph_legendre_factor(4, -3)

    return (fac * (4 * np.square(np.cos(theta)) - 1) *
        np.abs(np.sin(theta)) * np.sin(theta) / 48)

def sph_legendre_p_4_m2_jac(theta):
    fac = sph_legendre_factor(4, -2)

    return (fac * (7 * np.square(np.cos(theta)) - 4) * np.sin(theta) *
        np.cos(theta) / 12)

def sph_legendre_p_4_m1_jac(theta):
    fac = sph_legendre_factor(4, -1)

    return (-fac * (-3 + 27 * np.square(np.cos(theta)) -
        28 * np.square(np.square(np.cos(theta)))) *
        (2 * np.heaviside(np.sin(theta), 1) - 1) / 8)
