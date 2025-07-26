# mypy: disable-error-code="attr-defined"
import pytest
import numpy as np
from numpy.testing import assert_equal, assert_almost_equal, assert_allclose
from hypothesis import given
import hypothesis.strategies as st
import hypothesis.extra.numpy as hyp_num

from scipy.integrate import (romb, newton_cotes,
                             cumulative_trapezoid, trapezoid,
                             quad, simpson, fixed_quad,
                             qmc_quad, cumulative_simpson)
from scipy.integrate._quadrature import _cumulative_simpson_unequal_intervals

from scipy import stats, special, integrate
from scipy.conftest import skip_xp_invalid_arg
from scipy._lib._array_api_no_0d import xp_assert_close

skip_xp_backends = pytest.mark.skip_xp_backends


class TestFixedQuad:
    def test_scalar(self):
        n = 4
        expected = 1/(2*n)
        got, _ = fixed_quad(lambda x: x**(2*n - 1), 0, 1, n=n)
        # quadrature exact for this input
        assert_allclose(got, expected, rtol=1e-12)

    def test_vector(self):
        n = 4
        p = np.arange(1, 2*n)
        expected = 1/(p + 1)
        got, _ = fixed_quad(lambda x: x**p[:, None], 0, 1, n=n)
        assert_allclose(got, expected, rtol=1e-12)


class TestQuadrature:
    def quad(self, x, a, b, args):
        raise NotImplementedError

    def test_romb(self):
        assert_equal(romb(np.arange(17)), 128)

    def test_romb_gh_3731(self):
        # Check that romb makes maximal use of data points
        x = np.arange(2**4+1)
        y = np.cos(0.2*x)
        val = romb(y)
        val2, err = quad(lambda x: np.cos(0.2*x), x.min(), x.max())
        assert_allclose(val, val2, rtol=1e-8, atol=0)

    def test_newton_cotes(self):
        """Test the first few degrees, for evenly spaced points."""
        n = 1
        wts, errcoff = newton_cotes(n, 1)
        assert_equal(wts, n*np.array([0.5, 0.5]))
        assert_almost_equal(errcoff, -n**3/12.0)

        n = 2
        wts, errcoff = newton_cotes(n, 1)
        assert_almost_equal(wts, n*np.array([1.0, 4.0, 1.0])/6.0)
        assert_almost_equal(errcoff, -n**5/2880.0)

        n = 3
        wts, errcoff = newton_cotes(n, 1)
        assert_almost_equal(wts, n*np.array([1.0, 3.0, 3.0, 1.0])/8.0)
        assert_almost_equal(errcoff, -n**5/6480.0)

        n = 4
        wts, errcoff = newton_cotes(n, 1)
        assert_almost_equal(wts, n*np.array([7.0, 32.0, 12.0, 32.0, 7.0])/90.0)
        assert_almost_equal(errcoff, -n**7/1935360.0)

    def test_newton_cotes2(self):
        """Test newton_cotes with points that are not evenly spaced."""

        x = np.array([0.0, 1.5, 2.0])
        y = x**2
        wts, errcoff = newton_cotes(x)
        exact_integral = 8.0/3
        numeric_integral = np.dot(wts, y)
        assert_almost_equal(numeric_integral, exact_integral)

        x = np.array([0.0, 1.4, 2.1, 3.0])
        y = x**2
        wts, errcoff = newton_cotes(x)
        exact_integral = 9.0
        numeric_integral = np.dot(wts, y)
        assert_almost_equal(numeric_integral, exact_integral)

    def test_simpson(self):
        y = np.arange(17)
        assert_equal(simpson(y), 128)
        assert_equal(simpson(y, dx=0.5), 64)
        assert_equal(simpson(y, x=np.linspace(0, 4, 17)), 32)

        # integral should be exactly 21
        x = np.linspace(1, 4, 4)
        def f(x):
            return x**2

        assert_allclose(simpson(f(x), x=x), 21.0)

        # integral should be exactly 114
        x = np.linspace(1, 7, 4)
        assert_allclose(simpson(f(x), dx=2.0), 114)

        # test multi-axis behaviour
        a = np.arange(16).reshape(4, 4)
        x = np.arange(64.).reshape(4, 4, 4)
        y = f(x)
        for i in range(3):
            r = simpson(y, x=x, axis=i)
            it = np.nditer(a, flags=['multi_index'])
            for _ in it:
                idx = list(it.multi_index)
                idx.insert(i, slice(None))
                integral = x[tuple(idx)][-1]**3 / 3 - x[tuple(idx)][0]**3 / 3
                assert_allclose(r[it.multi_index], integral)

        # test when integration axis only has two points
        x = np.arange(16).reshape(8, 2)
        y = f(x)
        r = simpson(y, x=x, axis=-1)

        integral = 0.5 * (y[:, 1] + y[:, 0]) * (x[:, 1] - x[:, 0])
        assert_allclose(r, integral)

        # odd points, test multi-axis behaviour
        a = np.arange(25).reshape(5, 5)
        x = np.arange(125).reshape(5, 5, 5)
        y = f(x)
        for i in range(3):
            r = simpson(y, x=x, axis=i)
            it = np.nditer(a, flags=['multi_index'])
            for _ in it:
                idx = list(it.multi_index)
                idx.insert(i, slice(None))
                integral = x[tuple(idx)][-1]**3 / 3 - x[tuple(idx)][0]**3 / 3
                assert_allclose(r[it.multi_index], integral)

        # Tests for checking base case
        x = np.array([3])
        y = np.power(x, 2)
        assert_allclose(simpson(y, x=x, axis=0), 0.0)
        assert_allclose(simpson(y, x=x, axis=-1), 0.0)

        x = np.array([3, 3, 3, 3])
        y = np.power(x, 2)
        assert_allclose(simpson(y, x=x, axis=0), 0.0)
        assert_allclose(simpson(y, x=x, axis=-1), 0.0)

        x = np.array([[1, 2, 4, 8], [1, 2, 4, 8], [1, 2, 4, 8]])
        y = np.power(x, 2)
        zero_axis = [0.0, 0.0, 0.0, 0.0]
        default_axis = [170 + 1/3] * 3   # 8**3 / 3 - 1/3
        assert_allclose(simpson(y, x=x, axis=0), zero_axis)
        # the following should be exact
        assert_allclose(simpson(y, x=x, axis=-1), default_axis)

        x = np.array([[1, 2, 4, 8], [1, 2, 4, 8], [1, 8, 16, 32]])
        y = np.power(x, 2)
        zero_axis = [0.0, 136.0, 1088.0, 8704.0]
        default_axis = [170 + 1/3, 170 + 1/3, 32**3 / 3 - 1/3]
        assert_allclose(simpson(y, x=x, axis=0), zero_axis)
        assert_allclose(simpson(y, x=x, axis=-1), default_axis)


    @pytest.mark.parametrize('droplast', [False, True])
    def test_simpson_2d_integer_no_x(self, droplast):
        # The inputs are 2d integer arrays.  The results should be
        # identical to the results when the inputs are floating point.
        y = np.array([[2, 2, 4, 4, 8, 8, -4, 5],
                      [4, 4, 2, -4, 10, 22, -2, 10]])
        if droplast:
            y = y[:, :-1]
        result = simpson(y, axis=-1)
        expected = simpson(np.array(y, dtype=np.float64), axis=-1)
        assert_equal(result, expected)


class TestCumulative_trapezoid:
    def test_1d(self):
        x = np.linspace(-2, 2, num=5)
        y = x
        y_int = cumulative_trapezoid(y, x, initial=0)
        y_expected = [0., -1.5, -2., -1.5, 0.]
        assert_allclose(y_int, y_expected)

        y_int = cumulative_trapezoid(y, x, initial=None)
        assert_allclose(y_int, y_expected[1:])

    def test_y_nd_x_nd(self):
        x = np.arange(3 * 2 * 4).reshape(3, 2, 4)
        y = x
        y_int = cumulative_trapezoid(y, x, initial=0)
        y_expected = np.array([[[0., 0.5, 2., 4.5],
                                [0., 4.5, 10., 16.5]],
                               [[0., 8.5, 18., 28.5],
                                [0., 12.5, 26., 40.5]],
                               [[0., 16.5, 34., 52.5],
                                [0., 20.5, 42., 64.5]]])

        assert_allclose(y_int, y_expected)

        # Try with all axes
        shapes = [(2, 2, 4), (3, 1, 4), (3, 2, 3)]
        for axis, shape in zip([0, 1, 2], shapes):
            y_int = cumulative_trapezoid(y, x, initial=0, axis=axis)
            assert_equal(y_int.shape, (3, 2, 4))
            y_int = cumulative_trapezoid(y, x, initial=None, axis=axis)
            assert_equal(y_int.shape, shape)

    def test_y_nd_x_1d(self):
        y = np.arange(3 * 2 * 4).reshape(3, 2, 4)
        x = np.arange(4)**2
        # Try with all axes
        ys_expected = (
            np.array([[[4., 5., 6., 7.],
                       [8., 9., 10., 11.]],
                      [[40., 44., 48., 52.],
                       [56., 60., 64., 68.]]]),
            np.array([[[2., 3., 4., 5.]],
                      [[10., 11., 12., 13.]],
                      [[18., 19., 20., 21.]]]),
            np.array([[[0.5, 5., 17.5],
                       [4.5, 21., 53.5]],
                      [[8.5, 37., 89.5],
                       [12.5, 53., 125.5]],
                      [[16.5, 69., 161.5],
                       [20.5, 85., 197.5]]]))

        for axis, y_expected in zip([0, 1, 2], ys_expected):
            y_int = cumulative_trapezoid(y, x=x[:y.shape[axis]], axis=axis,
                                         initial=None)
            assert_allclose(y_int, y_expected)

    def test_x_none(self):
        y = np.linspace(-2, 2, num=5)

        y_int = cumulative_trapezoid(y)
        y_expected = [-1.5, -2., -1.5, 0.]
        assert_allclose(y_int, y_expected)

        y_int = cumulative_trapezoid(y, initial=0)
        y_expected = [0, -1.5, -2., -1.5, 0.]
        assert_allclose(y_int, y_expected)

        y_int = cumulative_trapezoid(y, dx=3)
        y_expected = [-4.5, -6., -4.5, 0.]
        assert_allclose(y_int, y_expected)

        y_int = cumulative_trapezoid(y, dx=3, initial=0)
        y_expected = [0, -4.5, -6., -4.5, 0.]
        assert_allclose(y_int, y_expected)

    @pytest.mark.parametrize(
        "initial", [1, 0.5]
    )
    def test_initial_error(self, initial):
        """If initial is not None or 0, a ValueError is raised."""
        y = np.linspace(0, 10, num=10)
        with pytest.raises(ValueError, match="`initial`"):
            cumulative_trapezoid(y, initial=initial)

    def test_zero_len_y(self):
        with pytest.raises(ValueError, match="At least one point is required"):
            cumulative_trapezoid(y=[])


class TestTrapezoid:
    def test_simple(self, xp):
        x = xp.arange(-10, 10, .1)
        r = trapezoid(xp.exp(-.5 * x ** 2) / xp.sqrt(2 * xp.asarray(xp.pi)), dx=0.1)
        # check integral of normal equals 1
        xp_assert_close(r, xp.asarray(1.0))

    @skip_xp_backends('jax.numpy',
                      reason="JAX arrays do not support item assignment")
    def test_ndim(self, xp):
        x = xp.linspace(0, 1, 3)
        y = xp.linspace(0, 2, 8)
        z = xp.linspace(0, 3, 13)

        wx = xp.ones_like(x) * (x[1] - x[0])
        wx[0] /= 2
        wx[-1] /= 2
        wy = xp.ones_like(y) * (y[1] - y[0])
        wy[0] /= 2
        wy[-1] /= 2
        wz = xp.ones_like(z) * (z[1] - z[0])
        wz[0] /= 2
        wz[-1] /= 2

        q = x[:, None, None] + y[None,:, None] + z[None, None,:]

        qx = xp.sum(q * wx[:, None, None], axis=0)
        qy = xp.sum(q * wy[None, :, None], axis=1)
        qz = xp.sum(q * wz[None, None, :], axis=2)

        # n-d `x`
        r = trapezoid(q, x=x[:, None, None], axis=0)
        xp_assert_close(r, qx)
        r = trapezoid(q, x=y[None,:, None], axis=1)
        xp_assert_close(r, qy)
        r = trapezoid(q, x=z[None, None,:], axis=2)
        xp_assert_close(r, qz)

        # 1-d `x`
        r = trapezoid(q, x=x, axis=0)
        xp_assert_close(r, qx)
        r = trapezoid(q, x=y, axis=1)
        xp_assert_close(r, qy)
        r = trapezoid(q, x=z, axis=2)
        xp_assert_close(r, qz)

    @skip_xp_backends('jax.numpy',
                      reason="JAX arrays do not support item assignment")
    def test_gh21908(self, xp):
        # extended testing for n-dim arrays
        x = xp.reshape(xp.linspace(0, 29, 30), (3, 10))
        y = xp.reshape(xp.linspace(0, 29, 30), (3, 10))

        out0 = xp.linspace(200, 380, 10)
        xp_assert_close(trapezoid(y, x=x, axis=0), out0)
        xp_assert_close(trapezoid(y, x=xp.asarray([0, 10., 20.]), axis=0), out0)
        # x needs to be broadcastable against y
        xp_assert_close(
            trapezoid(y, x=xp.asarray([0, 10., 20.])[:, None], axis=0),
            out0
        )
        with pytest.raises(Exception):
            # x is not broadcastable against y
            trapezoid(y, x=xp.asarray([0, 10., 20.])[None, :], axis=0)

        out1 = xp.asarray([ 40.5, 130.5, 220.5])
        xp_assert_close(trapezoid(y, x=x, axis=1), out1)
        xp_assert_close(
            trapezoid(y, x=xp.linspace(0, 9, 10), axis=1),
            out1
        )

    @skip_xp_invalid_arg
    def test_masked(self, xp):
        # Testing that masked arrays behave as if the function is 0 where
        # masked
        x = np.arange(5)
        y = x * x
        mask = x == 2
        ym = np.ma.array(y, mask=mask)
        r = 13.0  # sum(0.5 * (0 + 1) * 1.0 + 0.5 * (9 + 16))
        assert_allclose(trapezoid(ym, x), r)

        xm = np.ma.array(x, mask=mask)
        assert_allclose(trapezoid(ym, xm), r)

        xm = np.ma.array(x, mask=mask)
        assert_allclose(trapezoid(y, xm), r)

    @skip_xp_backends(np_only=True,
                      reason='array-likes only supported for NumPy backend')
    def test_array_like(self, xp):
        x = list(range(5))
        y = [t * t for t in x]
        xarr = xp.asarray(x, dtype=xp.float64)
        yarr = xp.asarray(y, dtype=xp.float64)
        res = trapezoid(y, x)
        resarr = trapezoid(yarr, xarr)
        xp_assert_close(res, resarr)


class TestQMCQuad:
    @pytest.mark.thread_unsafe
    def test_input_validation(self):
        message = "`func` must be callable."
        with pytest.raises(TypeError, match=message):
            qmc_quad("a duck", [0, 0], [1, 1])

        message = "`func` must evaluate the integrand at points..."
        with pytest.raises(ValueError, match=message):
            qmc_quad(lambda: 1, [0, 0], [1, 1])

        def func(x):
            assert x.ndim == 1
            return np.sum(x)
        message = "Exception encountered when attempting vectorized call..."
        with pytest.warns(UserWarning, match=message):
            qmc_quad(func, [0, 0], [1, 1])

        message = "`n_points` must be an integer."
        with pytest.raises(TypeError, match=message):
            qmc_quad(lambda x: 1, [0, 0], [1, 1], n_points=1024.5)

        message = "`n_estimates` must be an integer."
        with pytest.raises(TypeError, match=message):
            qmc_quad(lambda x: 1, [0, 0], [1, 1], n_estimates=8.5)

        message = "`qrng` must be an instance of scipy.stats.qmc.QMCEngine."
        with pytest.raises(TypeError, match=message):
            qmc_quad(lambda x: 1, [0, 0], [1, 1], qrng="a duck")

        message = "`qrng` must be initialized with dimensionality equal to "
        with pytest.raises(ValueError, match=message):
            qmc_quad(lambda x: 1, [0, 0], [1, 1], qrng=stats.qmc.Sobol(1))

        message = r"`log` must be boolean \(`True` or `False`\)."
        with pytest.raises(TypeError, match=message):
            qmc_quad(lambda x: 1, [0, 0], [1, 1], log=10)

    def basic_test(self, n_points=2**8, n_estimates=8, signs=None):
        if signs is None:
            signs = np.ones(2)
        ndim = 2
        mean = np.zeros(ndim)
        cov = np.eye(ndim)

        def func(x):
            return stats.multivariate_normal.pdf(x.T, mean, cov)

        rng = np.random.default_rng(2879434385674690281)
        qrng = stats.qmc.Sobol(ndim, seed=rng)
        a = np.zeros(ndim)
        b = np.ones(ndim) * signs
        res = qmc_quad(func, a, b, n_points=n_points,
                       n_estimates=n_estimates, qrng=qrng)
        ref = stats.multivariate_normal.cdf(b, mean, cov, lower_limit=a)
        atol = special.stdtrit(n_estimates-1, 0.995) * res.standard_error  # 99% CI
        assert_allclose(res.integral, ref, atol=atol)
        assert np.prod(signs)*res.integral > 0

        rng = np.random.default_rng(2879434385674690281)
        qrng = stats.qmc.Sobol(ndim, seed=rng)
        logres = qmc_quad(lambda *args: np.log(func(*args)), a, b,
                          n_points=n_points, n_estimates=n_estimates,
                          log=True, qrng=qrng)
        assert_allclose(np.exp(logres.integral), res.integral, rtol=1e-14)
        assert np.imag(logres.integral) == (np.pi if np.prod(signs) < 0 else 0)
        assert_allclose(np.exp(logres.standard_error),
                        res.standard_error, rtol=1e-14, atol=1e-16)

    @pytest.mark.parametrize("n_points", [2**8, 2**12])
    @pytest.mark.parametrize("n_estimates", [8, 16])
    def test_basic(self, n_points, n_estimates):
        self.basic_test(n_points, n_estimates)

    @pytest.mark.parametrize("signs", [[1, 1], [-1, -1], [-1, 1], [1, -1]])
    def test_sign(self, signs):
        self.basic_test(signs=signs)

    @pytest.mark.thread_unsafe
    @pytest.mark.parametrize("log", [False, True])
    def test_zero(self, log):
        message = "A lower limit was equal to an upper limit, so"
        with pytest.warns(UserWarning, match=message):
            res = qmc_quad(lambda x: 1, [0, 0], [0, 1], log=log)
        assert res.integral == (-np.inf if log else 0)
        assert res.standard_error == 0

    def test_flexible_input(self):
        # check that qrng is not required
        # also checks that for 1d problems, a and b can be scalars
        def func(x):
            return stats.norm.pdf(x, scale=2)

        res = qmc_quad(func, 0, 1)
        ref = stats.norm.cdf(1, scale=2) - stats.norm.cdf(0, scale=2)
        assert_allclose(res.integral, ref, 1e-2)


def cumulative_simpson_nd_reference(y, *, x=None, dx=None, initial=None, axis=-1):
    # Use cumulative_trapezoid if length of y < 3
    if y.shape[axis] < 3:
        if initial is None:
            return cumulative_trapezoid(y, x=x, dx=dx, axis=axis, initial=None)
        else:
            return initial + cumulative_trapezoid(y, x=x, dx=dx, axis=axis, initial=0)

    # Ensure that working axis is last axis
    y = np.moveaxis(y, axis, -1)
    x = np.moveaxis(x, axis, -1) if np.ndim(x) > 1 else x
    dx = np.moveaxis(dx, axis, -1) if np.ndim(dx) > 1 else dx
    initial = np.moveaxis(initial, axis, -1) if np.ndim(initial) > 1 else initial

    # If `x` is not present, create it from `dx`
    n = y.shape[-1]
    x = dx * np.arange(n) if dx is not None else x
    # Similarly, if `initial` is not present, set it to 0
    initial_was_none = initial is None
    initial = 0 if initial_was_none else initial

    # `np.apply_along_axis` accepts only one array, so concatenate arguments
    x = np.broadcast_to(x, y.shape)
    initial = np.broadcast_to(initial, y.shape[:-1] + (1,))
    z = np.concatenate((y, x, initial), axis=-1)

    # Use `np.apply_along_axis` to compute result
    def f(z):
        return cumulative_simpson(z[:n], x=z[n:2*n], initial=z[2*n:])
    res = np.apply_along_axis(f, -1, z)

    # Remove `initial` and undo axis move as needed
    res = res[..., 1:] if initial_was_none else res
    res = np.moveaxis(res, -1, axis)
    return res


class TestCumulativeSimpson:
    x0 = np.arange(4)
    y0 = x0**2

    @pytest.mark.parametrize('use_dx', (False, True))
    @pytest.mark.parametrize('use_initial', (False, True))
    def test_1d(self, use_dx, use_initial):
        # Test for exact agreement with polynomial of highest
        # possible order (3 if `dx` is constant, 2 otherwise).
        rng = np.random.default_rng(82456839535679456794)
        n = 10

        # Generate random polynomials and ground truth
        # integral of appropriate order
        order = 3 if use_dx else 2
        dx = rng.random()
        x = (np.sort(rng.random(n)) if order == 2
             else np.arange(n)*dx + rng.random())
        i = np.arange(order + 1)[:, np.newaxis]
        c = rng.random(order + 1)[:, np.newaxis]
        y = np.sum(c*x**i, axis=0)
        Y = np.sum(c*x**(i + 1)/(i + 1), axis=0)
        ref = Y if use_initial else (Y-Y[0])[1:]

        # Integrate with `cumulative_simpson`
        initial = Y[0] if use_initial else None
        kwarg = {'dx': dx} if use_dx else {'x': x}
        res = cumulative_simpson(y, **kwarg, initial=initial)

        # Compare result against reference
        if not use_dx:
            assert_allclose(res, ref, rtol=2e-15)
        else:
            i0 = 0 if use_initial else 1
            # all terms are "close"
            assert_allclose(res, ref, rtol=0.0025)
            # only even-interval terms are "exact"
            assert_allclose(res[i0::2], ref[i0::2], rtol=2e-15)

    @pytest.mark.parametrize('axis', np.arange(-3, 3))
    @pytest.mark.parametrize('x_ndim', (1, 3))
    @pytest.mark.parametrize('x_len', (1, 2, 7))
    @pytest.mark.parametrize('i_ndim', (None, 0, 3,))
    @pytest.mark.parametrize('dx', (None, True))
    def test_nd(self, axis, x_ndim, x_len, i_ndim, dx):
        # Test behavior of `cumulative_simpson` with N-D `y`
        rng = np.random.default_rng(82456839535679456794)

        # determine shapes
        shape = [5, 6, x_len]
        shape[axis], shape[-1] = shape[-1], shape[axis]
        shape_len_1 = shape.copy()
        shape_len_1[axis] = 1
        i_shape = shape_len_1 if i_ndim == 3 else ()

        # initialize arguments
        y = rng.random(size=shape)
        x, dx = None, None
        if dx:
            dx = rng.random(size=shape_len_1) if x_ndim > 1 else rng.random()
        else:
            x = (np.sort(rng.random(size=shape), axis=axis) if x_ndim > 1
                 else np.sort(rng.random(size=shape[axis])))
        initial = None if i_ndim is None else rng.random(size=i_shape)

        # compare results
        res = cumulative_simpson(y, x=x, dx=dx, initial=initial, axis=axis)
        ref = cumulative_simpson_nd_reference(y, x=x, dx=dx, initial=initial, axis=axis)
        np.testing.assert_allclose(res, ref, rtol=1e-15)

    @pytest.mark.parametrize(('message', 'kwarg_update'), [
        ("x must be strictly increasing", dict(x=[2, 2, 3, 4])),
        ("x must be strictly increasing", dict(x=[x0, [2, 2, 4, 8]], y=[y0, y0])),
        ("x must be strictly increasing", dict(x=[x0, x0, x0], y=[y0, y0, y0], axis=0)),
        ("At least one point is required", dict(x=[], y=[])),
        ("`axis=4` is not valid for `y` with `y.ndim=1`", dict(axis=4)),
        ("shape of `x` must be the same as `y` or 1-D", dict(x=np.arange(5))),
        ("`initial` must either be a scalar or...", dict(initial=np.arange(5))),
        ("`dx` must either be a scalar or...", dict(x=None, dx=np.arange(5))),
    ])
    def test_simpson_exceptions(self, message, kwarg_update):
        kwargs0 = dict(y=self.y0, x=self.x0, dx=None, initial=None, axis=-1)
        with pytest.raises(ValueError, match=message):
            cumulative_simpson(**dict(kwargs0, **kwarg_update))

    def test_special_cases(self):
        # Test special cases not checked elsewhere
        rng = np.random.default_rng(82456839535679456794)
        y = rng.random(size=10)
        res = cumulative_simpson(y, dx=0)
        assert_equal(res, 0)

        # Should add tests of:
        # - all elements of `x` identical
        # These should work as they do for `simpson`

    def _get_theoretical_diff_between_simps_and_cum_simps(self, y, x):
        """`cumulative_simpson` and `simpson` can be tested against other to verify
        they give consistent results. `simpson` will iteratively be called with
        successively higher upper limits of integration. This function calculates
        the theoretical correction required to `simpson` at even intervals to match
        with `cumulative_simpson`.
        """
        d = np.diff(x, axis=-1)
        sub_integrals_h1 = _cumulative_simpson_unequal_intervals(y, d)
        sub_integrals_h2 = _cumulative_simpson_unequal_intervals(
            y[..., ::-1], d[..., ::-1]
        )[..., ::-1]

        # Concatenate to build difference array
        zeros_shape = (*y.shape[:-1], 1)
        theoretical_difference = np.concatenate(
            [
                np.zeros(zeros_shape),
                (sub_integrals_h1[..., 1:] - sub_integrals_h2[..., :-1]),
                np.zeros(zeros_shape),
            ],
            axis=-1,
        )
        # Differences only expected at even intervals. Odd intervals will
        # match exactly so there is no correction
        theoretical_difference[..., 1::2] = 0.0
        # Note: the first interval will not match from this correction as
        # `simpson` uses the trapezoidal rule
        return theoretical_difference

    @pytest.mark.fail_slow(10)
    @pytest.mark.thread_unsafe
    @pytest.mark.slow
    @given(
        y=hyp_num.arrays(
            np.float64,
            hyp_num.array_shapes(max_dims=4, min_side=3, max_side=10),
            elements=st.floats(-10, 10, allow_nan=False).filter(lambda x: abs(x) > 1e-7)
        )
    )
    def test_cumulative_simpson_against_simpson_with_default_dx(
        self, y
    ):
        """Theoretically, the output of `cumulative_simpson` will be identical
        to `simpson` at all even indices and in the last index. The first index
        will not match as `simpson` uses the trapezoidal rule when there are only two
        data points. Odd indices after the first index are shown to match with
        a mathematically-derived correction."""
        def simpson_reference(y):
            return np.stack(
                [simpson(y[..., :i], dx=1.0) for i in range(2, y.shape[-1]+1)], axis=-1,
            )

        res = cumulative_simpson(y, dx=1.0)
        ref = simpson_reference(y)
        theoretical_difference = self._get_theoretical_diff_between_simps_and_cum_simps(
            y, x=np.arange(y.shape[-1])
        )
        np.testing.assert_allclose(
            res[..., 1:], ref[..., 1:] + theoretical_difference[..., 1:], atol=1e-16
        )

    @pytest.mark.fail_slow(10)
    @pytest.mark.thread_unsafe
    @pytest.mark.slow
    @given(
        y=hyp_num.arrays(
            np.float64,
            hyp_num.array_shapes(max_dims=4, min_side=3, max_side=10),
            elements=st.floats(-10, 10, allow_nan=False).filter(lambda x: abs(x) > 1e-7)
        )
    )
    def test_cumulative_simpson_against_simpson(
        self, y
    ):
        """Theoretically, the output of `cumulative_simpson` will be identical
        to `simpson` at all even indices and in the last index. The first index
        will not match as `simpson` uses the trapezoidal rule when there are only two
        data points. Odd indices after the first index are shown to match with
        a mathematically-derived correction."""
        interval = 10/(y.shape[-1] - 1)
        x = np.linspace(0, 10, num=y.shape[-1])
        x[1:] = x[1:] + 0.2*interval*np.random.uniform(-1, 1, len(x) - 1)

        def simpson_reference(y, x):
            return np.stack(
                [simpson(y[..., :i], x=x[..., :i]) for i in range(2, y.shape[-1]+1)],
                axis=-1,
            )

        res = cumulative_simpson(y, x=x)
        ref = simpson_reference(y, x)
        theoretical_difference = self._get_theoretical_diff_between_simps_and_cum_simps(
            y, x
        )
        np.testing.assert_allclose(
            res[..., 1:], ref[..., 1:] + theoretical_difference[..., 1:]
        )

class TestLebedev:
    def test_input_validation(self):
        # only certain rules are available
        message = "Order n=-1 not available..."
        with pytest.raises(NotImplementedError, match=message):
            integrate.lebedev_rule(-1)

    def test_quadrature(self):
        # Test points/weights to integrate an example function

        def f(x):
            return np.exp(x[0])

        x, w = integrate.lebedev_rule(15)
        res = w @ f(x)
        ref = 14.7680137457653  # lebedev_rule reference [3]
        assert_allclose(res, ref, rtol=1e-14)
        assert_allclose(np.sum(w), 4 * np.pi)

    @pytest.mark.parametrize('order', list(range(3, 32, 2)) + list(range(35, 132, 6)))
    def test_properties(self, order):
        x, w = integrate.lebedev_rule(order)
        # dispersion should be maximal; no clear spherical mean
        with np.errstate(divide='ignore', invalid='ignore'):
            res = stats.directional_stats(x.T, axis=0)
            assert_allclose(res.mean_resultant_length, 0, atol=1e-15)
        # weights should sum to 4*pi (surface area of unit sphere)
        assert_allclose(np.sum(w), 4*np.pi)
