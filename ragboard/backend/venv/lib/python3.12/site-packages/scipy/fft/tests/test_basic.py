import queue
import threading
import multiprocessing
import numpy as np
import pytest
from numpy.random import random
from numpy.testing import assert_array_almost_equal, assert_allclose
from pytest import raises as assert_raises
import scipy.fft as fft
from scipy._lib._array_api import (
    is_numpy, xp_size, xp_assert_close, xp_assert_equal
)

skip_xp_backends = pytest.mark.skip_xp_backends


# Expected input dtypes. Note that `scipy.fft` is more flexible for numpy,
# but for C2C transforms like `fft.fft`, the array API standard only mandates
# that complex dtypes should work, float32/float64 aren't guaranteed to.
def get_expected_input_dtype(func, xp):
    if func in [fft.fft, fft.fftn, fft.fft2,
                fft.ifft, fft.ifftn, fft.ifft2,
                fft.hfft, fft.hfftn, fft.hfft2,
                fft.irfft, fft.irfftn, fft.irfft2]:
        dtype = xp.complex128
    elif func in [fft.rfft, fft.rfftn, fft.rfft2,
                  fft.ihfft, fft.ihfftn, fft.ihfft2]:
        dtype = xp.float64
    else:
        raise ValueError(f'Unknown FFT function: {func}')

    return dtype


def fft1(x):
    L = len(x)
    phase = -2j*np.pi*(np.arange(L)/float(L))
    phase = np.arange(L).reshape(-1, 1) * phase
    return np.sum(x*np.exp(phase), axis=1)

class TestFFT:

    def test_identity(self, xp):
        maxlen = 512
        x = xp.asarray(random(maxlen) + 1j*random(maxlen))
        xr = xp.asarray(random(maxlen))
        # Check some powers of 2 and some primes
        for i in [1, 2, 16, 128, 512, 53, 149, 281, 397]:
            xp_assert_close(fft.ifft(fft.fft(x[0:i])), x[0:i])
            xp_assert_close(fft.irfft(fft.rfft(xr[0:i]), i), xr[0:i])

    @skip_xp_backends(np_only=True, reason='significant overhead for some backends')
    def test_identity_extensive(self, xp):
        maxlen = 512
        x = xp.asarray(random(maxlen) + 1j*random(maxlen))
        xr = xp.asarray(random(maxlen))
        for i in range(1, maxlen):
            xp_assert_close(fft.ifft(fft.fft(x[0:i])), x[0:i])
            xp_assert_close(fft.irfft(fft.rfft(xr[0:i]), i), xr[0:i])

    def test_fft(self, xp):
        x = random(30) + 1j*random(30)
        expect = xp.asarray(fft1(x))
        x = xp.asarray(x)
        xp_assert_close(fft.fft(x), expect)
        xp_assert_close(fft.fft(x, norm="backward"), expect)
        xp_assert_close(fft.fft(x, norm="ortho"),
                        expect / xp.sqrt(xp.asarray(30, dtype=xp.float64)),)
        xp_assert_close(fft.fft(x, norm="forward"), expect / 30)

    @skip_xp_backends(np_only=True, reason='some backends allow `n=0`')
    def test_fft_n(self, xp):
        x = xp.asarray([1, 2, 3], dtype=xp.complex128)
        assert_raises(ValueError, fft.fft, x, 0)

    def test_ifft(self, xp):
        x = xp.asarray(random(30) + 1j*random(30))
        xp_assert_close(fft.ifft(fft.fft(x)), x)
        for norm in ["backward", "ortho", "forward"]:
            xp_assert_close(fft.ifft(fft.fft(x, norm=norm), norm=norm), x)

    def test_fft2(self, xp):
        x = xp.asarray(random((30, 20)) + 1j*random((30, 20)))
        expect = fft.fft(fft.fft(x, axis=1), axis=0)
        xp_assert_close(fft.fft2(x), expect)
        xp_assert_close(fft.fft2(x, norm="backward"), expect)
        xp_assert_close(fft.fft2(x, norm="ortho"),
                        expect / xp.sqrt(xp.asarray(30 * 20, dtype=xp.float64)))
        xp_assert_close(fft.fft2(x, norm="forward"), expect / (30 * 20))

    def test_ifft2(self, xp):
        x = xp.asarray(random((30, 20)) + 1j*random((30, 20)))
        expect = fft.ifft(fft.ifft(x, axis=1), axis=0)
        xp_assert_close(fft.ifft2(x), expect)
        xp_assert_close(fft.ifft2(x, norm="backward"), expect)
        xp_assert_close(fft.ifft2(x, norm="ortho"),
                        expect * xp.sqrt(xp.asarray(30 * 20, dtype=xp.float64)))
        xp_assert_close(fft.ifft2(x, norm="forward"), expect * (30 * 20))

    def test_fftn(self, xp):
        x = xp.asarray(random((30, 20, 10)) + 1j*random((30, 20, 10)))
        expect = fft.fft(fft.fft(fft.fft(x, axis=2), axis=1), axis=0)
        xp_assert_close(fft.fftn(x), expect)
        xp_assert_close(fft.fftn(x, norm="backward"), expect)
        xp_assert_close(fft.fftn(x, norm="ortho"),
                        expect / xp.sqrt(xp.asarray(30 * 20 * 10, dtype=xp.float64)))
        xp_assert_close(fft.fftn(x, norm="forward"), expect / (30 * 20 * 10))

    def test_ifftn(self, xp):
        x = xp.asarray(random((30, 20, 10)) + 1j*random((30, 20, 10)))
        expect = fft.ifft(fft.ifft(fft.ifft(x, axis=2), axis=1), axis=0)
        xp_assert_close(fft.ifftn(x), expect, rtol=1e-7)
        xp_assert_close(fft.ifftn(x, norm="backward"), expect, rtol=1e-7)
        xp_assert_close(
            fft.ifftn(x, norm="ortho"),
            fft.ifftn(x) * xp.sqrt(xp.asarray(30 * 20 * 10, dtype=xp.float64))
        )
        xp_assert_close(fft.ifftn(x, norm="forward"),
                        expect * (30 * 20 * 10),
                        rtol=1e-7)

    def test_rfft(self, xp):
        x = xp.asarray(random(29), dtype=xp.float64)
        for n in [xp_size(x), 2*xp_size(x)]:
            for norm in [None, "backward", "ortho", "forward"]:
                xp_assert_close(fft.rfft(x, n=n, norm=norm),
                                fft.fft(xp.asarray(x, dtype=xp.complex128),
                                        n=n, norm=norm)[:(n//2 + 1)])
            xp_assert_close(
                fft.rfft(x, n=n, norm="ortho"),
                fft.rfft(x, n=n) / xp.sqrt(xp.asarray(n, dtype=xp.float64))
            )

    def test_irfft(self, xp):
        x = xp.asarray(random(30))
        xp_assert_close(fft.irfft(fft.rfft(x)), x)
        for norm in ["backward", "ortho", "forward"]:
            xp_assert_close(fft.irfft(fft.rfft(x, norm=norm), norm=norm), x)

    def test_rfft2(self, xp):
        x = xp.asarray(random((30, 20)), dtype=xp.float64)
        expect = fft.fft2(xp.asarray(x, dtype=xp.complex128))[:, :11]
        xp_assert_close(fft.rfft2(x), expect)
        xp_assert_close(fft.rfft2(x, norm="backward"), expect)
        xp_assert_close(fft.rfft2(x, norm="ortho"),
                        expect / xp.sqrt(xp.asarray(30 * 20, dtype=xp.float64)))
        xp_assert_close(fft.rfft2(x, norm="forward"), expect / (30 * 20))

    def test_irfft2(self, xp):
        x = xp.asarray(random((30, 20)))
        xp_assert_close(fft.irfft2(fft.rfft2(x)), x)
        for norm in ["backward", "ortho", "forward"]:
            xp_assert_close(fft.irfft2(fft.rfft2(x, norm=norm), norm=norm), x)

    def test_rfftn(self, xp):
        x = xp.asarray(random((30, 20, 10)), dtype=xp.float64)
        expect = fft.fftn(xp.asarray(x, dtype=xp.complex128))[:, :, :6]
        xp_assert_close(fft.rfftn(x), expect)
        xp_assert_close(fft.rfftn(x, norm="backward"), expect)
        xp_assert_close(fft.rfftn(x, norm="ortho"),
                        expect / xp.sqrt(xp.asarray(30 * 20 * 10, dtype=xp.float64)))
        xp_assert_close(fft.rfftn(x, norm="forward"), expect / (30 * 20 * 10))

    def test_irfftn(self, xp):
        x = xp.asarray(random((30, 20, 10)))
        xp_assert_close(fft.irfftn(fft.rfftn(x)), x)
        for norm in ["backward", "ortho", "forward"]:
            xp_assert_close(fft.irfftn(fft.rfftn(x, norm=norm), norm=norm), x)

    def test_hfft(self, xp):
        x = random(14) + 1j*random(14)
        x_herm = np.concatenate((random(1), x, random(1)))
        x = np.concatenate((x_herm, x[::-1].conj()))
        x = xp.asarray(x)
        x_herm = xp.asarray(x_herm)
        expect = xp.real(fft.fft(x))
        xp_assert_close(fft.hfft(x_herm), expect)
        xp_assert_close(fft.hfft(x_herm, norm="backward"), expect)
        xp_assert_close(fft.hfft(x_herm, norm="ortho"),
                        expect / xp.sqrt(xp.asarray(30, dtype=xp.float64)))
        xp_assert_close(fft.hfft(x_herm, norm="forward"), expect / 30)

    def test_ihfft(self, xp):
        x = random(14) + 1j*random(14)
        x_herm = np.concatenate((random(1), x, random(1)))
        x = np.concatenate((x_herm, x[::-1].conj()))
        x = xp.asarray(x)
        x_herm = xp.asarray(x_herm)
        xp_assert_close(fft.ihfft(fft.hfft(x_herm)), x_herm)
        for norm in ["backward", "ortho", "forward"]:
            xp_assert_close(fft.ihfft(fft.hfft(x_herm, norm=norm), norm=norm), x_herm)

    def test_hfft2(self, xp):
        x = xp.asarray(random((30, 20)))
        xp_assert_close(fft.hfft2(fft.ihfft2(x)), x)
        for norm in ["backward", "ortho", "forward"]:
            xp_assert_close(fft.hfft2(fft.ihfft2(x, norm=norm), norm=norm), x)

    def test_ihfft2(self, xp):
        x = xp.asarray(random((30, 20)), dtype=xp.float64)
        expect = fft.ifft2(xp.asarray(x, dtype=xp.complex128))[:, :11]
        xp_assert_close(fft.ihfft2(x), expect)
        xp_assert_close(fft.ihfft2(x, norm="backward"), expect)
        xp_assert_close(
            fft.ihfft2(x, norm="ortho"),
            expect * xp.sqrt(xp.asarray(30 * 20, dtype=xp.float64))
        )
        xp_assert_close(fft.ihfft2(x, norm="forward"), expect * (30 * 20))

    def test_hfftn(self, xp):
        x = xp.asarray(random((30, 20, 10)))
        xp_assert_close(fft.hfftn(fft.ihfftn(x)), x)
        for norm in ["backward", "ortho", "forward"]:
            xp_assert_close(fft.hfftn(fft.ihfftn(x, norm=norm), norm=norm), x)

    def test_ihfftn(self, xp):
        x = xp.asarray(random((30, 20, 10)), dtype=xp.float64)
        expect = fft.ifftn(xp.asarray(x, dtype=xp.complex128))[:, :, :6]
        xp_assert_close(expect, fft.ihfftn(x))
        xp_assert_close(expect, fft.ihfftn(x, norm="backward"))
        xp_assert_close(
            fft.ihfftn(x, norm="ortho"),
            expect * xp.sqrt(xp.asarray(30 * 20 * 10, dtype=xp.float64))
        )
        xp_assert_close(fft.ihfftn(x, norm="forward"), expect * (30 * 20 * 10))

    def _check_axes(self, op, xp):
        dtype = get_expected_input_dtype(op, xp)
        x = xp.asarray(random((30, 20, 10)), dtype=dtype)
        axes = [(0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)]

        for a in axes:
            op_tr = op(xp.permute_dims(x, axes=a))
            tr_op = xp.permute_dims(op(x, axes=a), axes=a)
            xp_assert_close(op_tr, tr_op)

    @pytest.mark.parametrize("op", [fft.fftn, fft.ifftn, fft.rfftn, fft.irfftn])
    def test_axes_standard(self, op, xp):
        self._check_axes(op, xp)

    @pytest.mark.parametrize("op", [fft.hfftn, fft.ihfftn])
    def test_axes_non_standard(self, op, xp):
        self._check_axes(op, xp)

    @pytest.mark.parametrize("op", [fft.fftn, fft.ifftn,
                                    fft.rfftn, fft.irfftn])
    def test_axes_subset_with_shape_standard(self, op, xp):
        dtype = get_expected_input_dtype(op, xp)
        x = xp.asarray(random((16, 8, 4)), dtype=dtype)
        axes = [(0, 1, 2), (0, 2, 1), (1, 2, 0)]

        for a in axes:
            # different shape on the first two axes
            shape = tuple([2*x.shape[ax] if ax in a[:2] else x.shape[ax]
                           for ax in range(x.ndim)])
            # transform only the first two axes
            op_tr = op(xp.permute_dims(x, axes=a),
                       s=shape[:2], axes=(0, 1))
            tr_op = xp.permute_dims(op(x, s=shape[:2], axes=a[:2]),
                                         axes=a)
            xp_assert_close(op_tr, tr_op)

    @pytest.mark.parametrize("op", [fft.fft2, fft.ifft2,
                                    fft.rfft2, fft.irfft2,
                                    fft.hfft2, fft.ihfft2,
                                    fft.hfftn, fft.ihfftn])
    def test_axes_subset_with_shape_non_standard(self, op, xp):
        dtype = get_expected_input_dtype(op, xp)
        x = xp.asarray(random((16, 8, 4)), dtype=dtype)
        axes = [(0, 1, 2), (0, 2, 1), (1, 2, 0)]

        for a in axes:
            # different shape on the first two axes
            shape = tuple([2*x.shape[ax] if ax in a[:2] else x.shape[ax]
                           for ax in range(x.ndim)])
            # transform only the first two axes
            op_tr = op(xp.permute_dims(x, axes=a), s=shape[:2], axes=(0, 1))
            tr_op = xp.permute_dims(op(x, s=shape[:2], axes=a[:2]), axes=a)
            xp_assert_close(op_tr, tr_op)

    def test_all_1d_norm_preserving(self, xp):
        # verify that round-trip transforms are norm-preserving
        x = xp.asarray(random(30), dtype=xp.float64)

        x_norm = xp.linalg.vector_norm(x)
        n = xp_size(x) * 2
        func_pairs = [(fft.rfft, fft.irfft),
                      # hfft: order so the first function takes x.size samples
                      #       (necessary for comparison to x_norm above)
                      (fft.ihfft, fft.hfft),
                      # functions that expect complex dtypes at the end
                      (fft.fft, fft.ifft),
                      ]
        for forw, back in func_pairs:
            if forw == fft.fft:
                x = xp.asarray(x, dtype=xp.complex128)
                x_norm = xp.linalg.vector_norm(x)
            for n in [xp_size(x), 2*xp_size(x)]:
                for norm in ['backward', 'ortho', 'forward']:
                    tmp = forw(x, n=n, norm=norm)
                    tmp = back(tmp, n=n, norm=norm)
                    xp_assert_close(xp.linalg.vector_norm(tmp), x_norm)

    @skip_xp_backends(np_only=True)
    @pytest.mark.parametrize("dtype", [np.float16, np.longdouble])
    def test_dtypes_nonstandard(self, dtype, xp):
        x = random(30).astype(dtype)
        out_dtypes = {np.float16: np.complex64, np.longdouble: np.clongdouble}
        x_complex = x.astype(out_dtypes[dtype])

        res_fft = fft.ifft(fft.fft(x))
        res_rfft = fft.irfft(fft.rfft(x))
        res_hfft = fft.hfft(fft.ihfft(x), x.shape[0])
        # Check both numerical results and exact dtype matches
        assert_array_almost_equal(res_fft, x_complex)
        assert_array_almost_equal(res_rfft, x)
        assert_array_almost_equal(res_hfft, x)
        assert res_fft.dtype == x_complex.dtype
        assert res_rfft.dtype == np.result_type(np.float32, x.dtype)
        assert res_hfft.dtype == np.result_type(np.float32, x.dtype)

    @pytest.mark.parametrize("dtype", ["float32", "float64"])
    def test_dtypes_real(self, dtype, xp):
        x = xp.asarray(random(30), dtype=getattr(xp, dtype))

        res_rfft = fft.irfft(fft.rfft(x))
        res_hfft = fft.hfft(fft.ihfft(x), x.shape[0])
        # Check both numerical results and exact dtype matches
        xp_assert_close(res_rfft, x)
        xp_assert_close(res_hfft, x)

    @pytest.mark.parametrize("dtype", ["complex64", "complex128"])
    def test_dtypes_complex(self, dtype, xp):
        rng = np.random.default_rng(1234)
        x = xp.asarray(rng.random(30), dtype=getattr(xp, dtype))

        res_fft = fft.ifft(fft.fft(x))
        # Check both numerical results and exact dtype matches
        xp_assert_close(res_fft, x)

    @skip_xp_backends(np_only=True,
                      reason='array-likes only supported for NumPy backend')
    @pytest.mark.parametrize("op", [fft.fft, fft.ifft,
                                    fft.fft2, fft.ifft2,
                                    fft.fftn, fft.ifftn,
                                    fft.rfft, fft.irfft,
                                    fft.rfft2, fft.irfft2,
                                    fft.rfftn, fft.irfftn,
                                    fft.hfft, fft.ihfft,
                                    fft.hfft2, fft.ihfft2,
                                    fft.hfftn, fft.ihfftn,])
    def test_array_like(self, xp, op):
        x = [[[1.0, 1.0], [1.0, 1.0]],
             [[1.0, 1.0], [1.0, 1.0]],
             [[1.0, 1.0], [1.0, 1.0]]]
        xp_assert_close(op(x), op(xp.asarray(x)))


@skip_xp_backends(np_only=True)
@pytest.mark.parametrize(
        "dtype",
        [np.float32, np.float64, np.longdouble,
         np.complex64, np.complex128, np.clongdouble])
@pytest.mark.parametrize("order", ["F", 'non-contiguous'])
@pytest.mark.parametrize(
        "fft",
        [fft.fft, fft.fft2, fft.fftn,
         fft.ifft, fft.ifft2, fft.ifftn])
def test_fft_with_order(dtype, order, fft, xp):
    # Check that FFT/IFFT produces identical results for C, Fortran and
    # non contiguous arrays
    rng = np.random.RandomState(42)
    X = rng.rand(8, 7, 13).astype(dtype, copy=False)
    if order == 'F':
        Y = np.asfortranarray(X)
    else:
        # Make a non contiguous array
        Y = X[::-1]
        X = np.ascontiguousarray(X[::-1])

    if fft.__name__.endswith('fft'):
        for axis in range(3):
            X_res = fft(X, axis=axis)
            Y_res = fft(Y, axis=axis)
            assert_array_almost_equal(X_res, Y_res)
    elif fft.__name__.endswith(('fft2', 'fftn')):
        axes = [(0, 1), (1, 2), (0, 2)]
        if fft.__name__.endswith('fftn'):
            axes.extend([(0,), (1,), (2,), None])
        for ax in axes:
            X_res = fft(X, axes=ax)
            Y_res = fft(Y, axes=ax)
            assert_array_almost_equal(X_res, Y_res)
    else:
        raise ValueError


@skip_xp_backends(cpu_only=True)
class TestFFTThreadSafe:
    threads = 16
    input_shape = (800, 200)

    def _test_mtsame(self, func, *args, xp=None):
        def worker(args, q):
            q.put(func(*args))

        q = queue.Queue()
        expected = func(*args)

        # Spin off a bunch of threads to call the same function simultaneously
        t = [threading.Thread(target=worker, args=(args, q))
             for i in range(self.threads)]
        [x.start() for x in t]

        [x.join() for x in t]

        # Make sure all threads returned the correct value
        for i in range(self.threads):
            xp_assert_equal(
                q.get(timeout=5), expected,
                err_msg='Function returned wrong value in multithreaded context'
            )

    def test_fft(self, xp):
        a = xp.ones(self.input_shape, dtype=xp.complex128)
        self._test_mtsame(fft.fft, a, xp=xp)

    def test_ifft(self, xp):
        a = xp.full(self.input_shape, 1+0j)
        self._test_mtsame(fft.ifft, a, xp=xp)

    def test_rfft(self, xp):
        a = xp.ones(self.input_shape)
        self._test_mtsame(fft.rfft, a, xp=xp)

    def test_irfft(self, xp):
        a = xp.full(self.input_shape, 1+0j)
        self._test_mtsame(fft.irfft, a, xp=xp)

    def test_hfft(self, xp):
        a = xp.ones(self.input_shape, dtype=xp.complex64)
        self._test_mtsame(fft.hfft, a, xp=xp)

    def test_ihfft(self, xp):
        a = xp.ones(self.input_shape)
        self._test_mtsame(fft.ihfft, a, xp=xp)


@skip_xp_backends(np_only=True)
@pytest.mark.parametrize("func", [fft.fft, fft.ifft, fft.rfft, fft.irfft])
def test_multiprocess(func, xp):
    # Test that fft still works after fork (gh-10422)

    with multiprocessing.Pool(2) as p:
        res = p.map(func, [np.ones(100) for _ in range(4)])

    expect = func(np.ones(100))
    for x in res:
        assert_allclose(x, expect)


class TestIRFFTN:

    def test_not_last_axis_success(self, xp):
        ar, ai = np.random.random((2, 16, 8, 32))
        a = ar + 1j*ai
        a = xp.asarray(a)

        axes = (-2,)

        # Should not raise error
        fft.irfftn(a, axes=axes)


@pytest.mark.parametrize("func", [fft.fft, fft.ifft, fft.rfft, fft.irfft,
                                  fft.fftn, fft.ifftn,
                                  fft.rfftn, fft.irfftn, fft.hfft, fft.ihfft])
def test_non_standard_params(func, xp):
    if func in [fft.rfft, fft.rfftn, fft.ihfft]:
        dtype = xp.float64
    else:
        dtype = xp.complex128

    x = xp.asarray([1, 2, 3], dtype=dtype)
    # func(x) should not raise an exception
    func(x)

    if is_numpy(xp):
        func(x, workers=2)
    else:
        assert_raises(ValueError, func, x, workers=2)

    # `plan` param is not tested since SciPy does not use it currently
    # but should be tested if it comes into use


@pytest.mark.parametrize("dtype", ['float32', 'float64'])
@pytest.mark.parametrize("func", [fft.fft, fft.ifft, fft.irfft,
                                  fft.fftn, fft.ifftn,
                                  fft.irfftn, fft.hfft,])
def test_real_input(func, dtype, xp):
    x = xp.asarray([1, 2, 3], dtype=getattr(xp, dtype))
    # func(x) should not raise an exception
    func(x)
