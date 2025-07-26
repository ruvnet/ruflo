import math

import pytest
import numpy as np

from scipy._lib._array_api import array_namespace
from scipy._lib._array_api_no_0d import xp_assert_close, xp_assert_less, xp_assert_equal
from scipy.stats._continued_fraction import _continued_fraction


@pytest.mark.skip_xp_backends('array_api_strict', reason='No fancy indexing assignment')
@pytest.mark.skip_xp_backends('jax.numpy', reason="Don't support mutation")
# dask doesn't like lines like this
# n = int(xp.real(xp_ravel(n))[0])
# (at some point in here the shape becomes nan)
@pytest.mark.skip_xp_backends('dask.array', reason="dask has issues with the shapes")
class TestContinuedFraction:
    rng = np.random.default_rng(5895448232066142650)
    p = rng.uniform(1, 10, size=10)

    def a1(self, n, x=1.5):
        if n == 0:
            y = 0*x
        elif n == 1:
            y = x
        else:
            y = -x**2
        if np.isscalar(y) and np.__version__ < "2.0":
            y = np.full_like(x, y)  # preserve dtype pre NEP 50
        return y

    def b1(self, n, x=1.5):
        if n == 0:
            y = 0*x
        else:
            one = x/x  # gets array of correct type, dtype, and shape
            y = one * (2*n - 1)
        if np.isscalar(y) and np.__version__ < "2.0":
            y = np.full_like(x, y)  # preserve dtype pre NEP 50
        return y

    def log_a1(self, n, x):
        xp = array_namespace(x)
        if n == 0:
            y = xp.full_like(x, -xp.asarray(math.inf, dtype=x.dtype))
        elif n == 1:
            y = xp.log(x)
        else:
            y = 2 * xp.log(x) + math.pi * 1j
        return y

    def log_b1(self, n, x):
        xp = array_namespace(x)
        if n == 0:
            y = xp.full_like(x, -xp.asarray(math.inf, dtype=x.dtype))
        else:
            one = x - x  # gets array of correct type, dtype, and shape
            y = one + math.log(2 * n - 1)
        return y

    def test_input_validation(self, xp):
        a1 = self.a1
        b1 = self.b1

        message = '`a` and `b` must be callable.'
        with pytest.raises(ValueError, match=message):
            _continued_fraction(1, b1)
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, 1)

        message = r'`eps` and `tiny` must be \(or represent the logarithm of\)...'
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, b1, tolerances={'eps': -10})
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, b1, tolerances={'eps': np.nan})
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, b1, tolerances={'eps': 1+1j}, log=True)
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, b1, tolerances={'tiny': 0})
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, b1, tolerances={'tiny': np.inf})
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, b1, tolerances={'tiny': np.inf}, log=True)
        # this should not raise
        kwargs = dict(args=xp.asarray(1.5+0j), log=True, maxiter=0)
        _continued_fraction(a1, b1, tolerances={'eps': -10}, **kwargs)
        _continued_fraction(a1, b1, tolerances={'tiny': -10}, **kwargs)

        message = '`maxiter` must be a non-negative integer.'
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, b1, maxiter=-1)

        message = '`log` must be boolean.'
        with pytest.raises(ValueError, match=message):
            _continued_fraction(a1, b1, log=2)

    @pytest.mark.parametrize('dtype', ['float32', 'float64', 'complex64', 'complex128'])
    @pytest.mark.parametrize('shape', [(), (1,), (3,), (3, 2)])
    def test_basic(self, shape, dtype, xp):
        np_dtype = getattr(np, dtype)
        xp_dtype = getattr(xp, dtype)
        rng = np.random.default_rng(2435908729190400)

        x = rng.random(shape).astype(np_dtype)
        x = x + rng.random(shape).astype(np_dtype)*1j if dtype.startswith('c') else x
        x = xp.asarray(x, dtype=xp_dtype)

        res = _continued_fraction(self.a1, self.b1, args=(x,))
        ref = xp.tan(x)
        xp_assert_close(res.f, ref)

    @pytest.mark.skip_xp_backends('torch', reason='pytorch/pytorch#136063')
    @pytest.mark.parametrize('dtype', ['float32', 'float64'])
    @pytest.mark.parametrize('shape', [(), (1,), (3,), (3, 2)])
    def test_log(self, shape, dtype, xp):
        if (np.__version__ < "2") and (dtype == 'float32'):
            pytest.skip("Scalar dtypes only respected after NEP 50.")
        np_dtype = getattr(np, dtype)
        rng = np.random.default_rng(2435908729190400)
        x = rng.random(shape).astype(np_dtype)
        x = xp.asarray(x)

        res = _continued_fraction(self.log_a1, self.log_b1, args=(x + 0j,), log=True)
        ref = xp.tan(x)
        xp_assert_close(xp.exp(xp.real(res.f)), ref)

    def test_maxiter(self, xp):
        rng = np.random.default_rng(2435908729190400)
        x = xp.asarray(rng.random(), dtype=xp.float64)
        ref = xp.tan(x)

        res1 = _continued_fraction(self.a1, self.b1, args=(x,), maxiter=3)
        assert res1.nit == 3

        res2 = _continued_fraction(self.a1, self.b1, args=(x,), maxiter=6)
        assert res2.nit == 6

        xp_assert_less(xp.abs(res2.f - ref), xp.abs(res1.f - ref))

    def test_eps(self, xp):
        x = xp.asarray(1.5, dtype=xp.float64)  # x = 1.5 is the default defined above
        ref = xp.tan(x)
        res1 = _continued_fraction(self.a1, self.b1, args=(x,),
                                   tolerances={'eps': 1e-6})
        res2 = _continued_fraction(self.a1, self.b1, args=(x,))
        xp_assert_less(res1.nit, res2.nit)
        xp_assert_less(xp.abs(res2.f - ref), xp.abs(res1.f - ref))

    def test_feval(self, xp):
        def a(n, x):
            a.nfev += 1
            return n * x

        def b(n, x):
            b.nfev += 1
            return n * x

        a.nfev, b.nfev = 0, 0

        res = _continued_fraction(a, b, args=(xp.asarray(1.),))
        assert res.nfev == a.nfev == b.nfev == res.nit + 1

    def test_status(self, xp):
        x = xp.asarray([1, 10, np.nan], dtype=xp.float64)
        res = _continued_fraction(self.a1, self.b1, args=(x,), maxiter=15)
        xp_assert_equal(res.success, xp.asarray([True, False, False]))
        xp_assert_equal(res.status, xp.asarray([0, -2, -3], dtype=xp.int32))

    def test_special_cases(self, xp):
        one = xp.asarray(1)
        res = _continued_fraction(lambda x: one, lambda x: one, maxiter=0)
        xp_assert_close(res.f, xp.asarray(1.))
        assert res.nit == res.nfev - 1 == 0
