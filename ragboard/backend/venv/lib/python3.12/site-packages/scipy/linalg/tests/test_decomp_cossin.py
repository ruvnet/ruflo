import pytest
import numpy as np
from numpy.random import default_rng
from numpy.testing import assert_allclose

from scipy import linalg
from scipy.linalg.lapack import _compute_lwork
from scipy.stats import ortho_group, unitary_group
from scipy.linalg import cossin, get_lapack_funcs

REAL_DTYPES = (np.float32, np.float64)
COMPLEX_DTYPES = (np.complex64, np.complex128)
DTYPES = REAL_DTYPES + COMPLEX_DTYPES


@pytest.mark.parametrize('dtype_', DTYPES)
@pytest.mark.parametrize('m, p, q',
                         [
                             (2, 1, 1),
                             (3, 2, 1),
                             (3, 1, 2),
                             (4, 2, 2),
                             (4, 1, 2),
                             (40, 12, 20),
                             (40, 30, 1),
                             (40, 1, 30),
                             (100, 50, 1),
                             (100, 50, 50),
                         ])
@pytest.mark.parametrize('swap_sign', [True, False])
def test_cossin(dtype_, m, p, q, swap_sign):
    rng = default_rng(1708093570726217)
    if dtype_ in COMPLEX_DTYPES:
        x = np.array(unitary_group.rvs(m, random_state=rng), dtype=dtype_)
    else:
        x = np.array(ortho_group.rvs(m, random_state=rng), dtype=dtype_)

    u, cs, vh = cossin(x, p, q,
                       swap_sign=swap_sign)
    assert_allclose(x, u @ cs @ vh, rtol=0., atol=m*1e3*np.finfo(dtype_).eps)
    assert u.dtype == dtype_
    # Test for float32 or float 64
    assert cs.dtype == np.real(u).dtype
    assert vh.dtype == dtype_

    u, cs, vh = cossin([x[:p, :q], x[:p, q:], x[p:, :q], x[p:, q:]],
                       swap_sign=swap_sign)
    assert_allclose(x, u @ cs @ vh, rtol=0., atol=m*1e3*np.finfo(dtype_).eps)
    assert u.dtype == dtype_
    assert cs.dtype == np.real(u).dtype
    assert vh.dtype == dtype_

    _, cs2, vh2 = cossin(x, p, q,
                         compute_u=False,
                         swap_sign=swap_sign)
    assert_allclose(cs, cs2, rtol=0., atol=10*np.finfo(dtype_).eps)
    assert_allclose(vh, vh2, rtol=0., atol=10*np.finfo(dtype_).eps)

    u2, cs2, _ = cossin(x, p, q,
                        compute_vh=False,
                        swap_sign=swap_sign)
    assert_allclose(u, u2, rtol=0., atol=10*np.finfo(dtype_).eps)
    assert_allclose(cs, cs2, rtol=0., atol=10*np.finfo(dtype_).eps)

    _, cs2, _ = cossin(x, p, q,
                       compute_u=False,
                       compute_vh=False,
                       swap_sign=swap_sign)
    assert_allclose(cs, cs2, rtol=0., atol=10*np.finfo(dtype_).eps)


def test_cossin_mixed_types():
    rng = default_rng(1708093736390459)
    x = np.array(ortho_group.rvs(4, random_state=rng), dtype=np.float64)
    u, cs, vh = cossin([x[:2, :2],
                        np.array(x[:2, 2:], dtype=np.complex128),
                        x[2:, :2],
                        x[2:, 2:]])

    assert u.dtype == np.complex128
    assert cs.dtype == np.float64
    assert vh.dtype == np.complex128
    assert_allclose(x, u @ cs @ vh, rtol=0.,
                    atol=1e4 * np.finfo(np.complex128).eps)


def test_cossin_error_incorrect_subblocks():
    with pytest.raises(ValueError, match="be due to missing p, q arguments."):
        cossin(([1, 2], [3, 4, 5], [6, 7], [8, 9, 10]))


def test_cossin_error_empty_subblocks():
    with pytest.raises(ValueError, match="x11.*empty"):
        cossin(([], [], [], []))
    with pytest.raises(ValueError, match="x12.*empty"):
        cossin(([1, 2], [], [6, 7], [8, 9, 10]))
    with pytest.raises(ValueError, match="x21.*empty"):
        cossin(([1, 2], [3, 4, 5], [], [8, 9, 10]))
    with pytest.raises(ValueError, match="x22.*empty"):
        cossin(([1, 2], [3, 4, 5], [2], []))


def test_cossin_error_missing_partitioning():
    with pytest.raises(ValueError, match=".*exactly four arrays.* got 2"):
        cossin(unitary_group.rvs(2))

    with pytest.raises(ValueError, match=".*might be due to missing p, q"):
        cossin(unitary_group.rvs(4))


def test_cossin_error_non_iterable():
    with pytest.raises(ValueError, match="containing the subblocks of X"):
        cossin(12j)

def test_cossin_error_invalid_shape():
    # Invalid x12 dimensions
    p, q = 3, 4
    invalid_x12 = np.ones((p, q + 2))
    valid_ones = np.ones((p, q))
    with pytest.raises(ValueError, 
            match=r"Invalid x12 dimensions: desired \(3, 4\), got \(3, 6\)"):
        cossin((valid_ones, invalid_x12, valid_ones, valid_ones))

    # Invalid x21 dimensions
    invalid_x21 = np.ones(p + 2)
    with pytest.raises(ValueError, 
            match=r"Invalid x21 dimensions: desired \(3, 4\), got \(1, 5\)"):
        cossin((valid_ones, valid_ones, invalid_x21, valid_ones))

def test_cossin_error_non_square():
    with pytest.raises(ValueError, match="only supports square"):
        cossin(np.array([[1, 2]]), 1, 1)


def test_cossin_error_partitioning():
    x = np.array(ortho_group.rvs(4), dtype=np.float64)
    with pytest.raises(ValueError, match="invalid p=0.*0<p<4.*"):
        cossin(x, 0, 1)
    with pytest.raises(ValueError, match="invalid p=4.*0<p<4.*"):
        cossin(x, 4, 1)
    with pytest.raises(ValueError, match="invalid q=-2.*0<q<4.*"):
        cossin(x, 1, -2)
    with pytest.raises(ValueError, match="invalid q=5.*0<q<4.*"):
        cossin(x, 1, 5)


@pytest.mark.parametrize("dtype_", DTYPES)
def test_cossin_separate(dtype_):
    rng = default_rng(1708093590167096)
    m, p, q = 98, 37, 61

    pfx = 'or' if dtype_ in REAL_DTYPES else 'un'
    X = (ortho_group.rvs(m, random_state=rng) if pfx == 'or'
         else unitary_group.rvs(m, random_state=rng))
    X = np.array(X, dtype=dtype_)

    drv, dlw = get_lapack_funcs((pfx + 'csd', pfx + 'csd_lwork'), [X])
    lwval = _compute_lwork(dlw, m, p, q)
    lwvals = {'lwork': lwval} if pfx == 'or' else dict(zip(['lwork',
                                                            'lrwork'],
                                                           lwval))

    *_, theta, u1, u2, v1t, v2t, _ = \
        drv(X[:p, :q], X[:p, q:], X[p:, :q], X[p:, q:], **lwvals)

    (u1_2, u2_2), theta2, (v1t_2, v2t_2) = cossin(X, p, q, separate=True)

    assert_allclose(u1_2, u1, rtol=0., atol=10*np.finfo(dtype_).eps)
    assert_allclose(u2_2, u2, rtol=0., atol=10*np.finfo(dtype_).eps)
    assert_allclose(v1t_2, v1t, rtol=0., atol=10*np.finfo(dtype_).eps)
    assert_allclose(v2t_2, v2t, rtol=0., atol=10*np.finfo(dtype_).eps)
    assert_allclose(theta2, theta, rtol=0., atol=10*np.finfo(dtype_).eps)


@pytest.mark.parametrize("m", [2, 5, 10, 15, 20])
@pytest.mark.parametrize("p", [1, 4, 9, 14, 19])
@pytest.mark.parametrize("q", [1, 4, 9, 14, 19])
@pytest.mark.parametrize("swap_sign", [True, False])
def test_properties(m, p, q, swap_sign):
    # Test all the properties advertised in `linalg.cossin` documentation.
    # There may be some overlap with tests above, but this is sensitive to
    # the bug reported in gh-19365 and more.
    if (p >= m) or (q >= m):
        pytest.skip("`0 < p < m` and `0 < q < m` must hold")

    # Generate unitary input
    rng = np.random.default_rng(329548272348596421)
    X = unitary_group.rvs(m, random_state=rng)
    np.testing.assert_allclose(X @ X.conj().T, np.eye(m), atol=1e-15)

    # Perform the decomposition
    u0, cs0, vh0 = linalg.cossin(X, p=p, q=q, separate=True, swap_sign=swap_sign)
    u1, u2 = u0
    v1, v2 = vh0
    v1, v2 = v1.conj().T, v2.conj().T

    # "U1, U2, V1, V2 are square orthogonal/unitary matrices
    # of dimensions (p,p), (m-p,m-p), (q,q), and (m-q,m-q) respectively"
    np.testing.assert_allclose(u1 @ u1.conj().T, np.eye(p), atol=1e-13)
    np.testing.assert_allclose(u2 @ u2.conj().T, np.eye(m-p), atol=1e-13)
    np.testing.assert_allclose(v1 @ v1.conj().T, np.eye(q), atol=1e-13)
    np.testing.assert_allclose(v2 @ v2.conj().T, np.eye(m-q), atol=1e-13)

    # "and C and S are (r, r) nonnegative diagonal matrices..."
    C = np.diag(np.cos(cs0))
    S = np.diag(np.sin(cs0))
    # "...satisfying C^2 + S^2 = I where r = min(p, m-p, q, m-q)."
    r = min(p, m-p, q, m-q)
    np.testing.assert_allclose(C**2 + S**2, np.eye(r))

    # "Moreover, the rank of the identity matrices are
    # min(p, q) - r, min(p, m - q) - r, min(m - p, q) - r,
    # and min(m - p, m - q) - r respectively."
    I11 = np.eye(min(p, q) - r)
    I12 = np.eye(min(p, m - q) - r)
    I21 = np.eye(min(m - p, q) - r)
    I22 = np.eye(min(m - p, m - q) - r)

    # From:
    #                            ┌                   ┐
    #                            │ I  0  0 │ 0  0  0 │
    # ┌           ┐   ┌         ┐│ 0  C  0 │ 0 -S  0 │┌         ┐*
    # │ X11 │ X12 │   │ U1 │    ││ 0  0  0 │ 0  0 -I ││ V1 │    │
    # │ ────┼──── │ = │────┼────││─────────┼─────────││────┼────│
    # │ X21 │ X22 │   │    │ U2 ││ 0  0  0 │ I  0  0 ││    │ V2 │
    # └           ┘   └         ┘│ 0  S  0 │ 0  C  0 │└         ┘
    #                            │ 0  0  I │ 0  0  0 │
    #                            └                   ┘

    # We can see that U and V are block diagonal matrices like so:
    U = linalg.block_diag(u1, u2)
    V = linalg.block_diag(v1, v2)

    # And the center matrix, which we'll call Q here, must be:
    Q11 = np.zeros((u1.shape[1], v1.shape[0]))
    IC11 = linalg.block_diag(I11, C)
    Q11[:IC11.shape[0], :IC11.shape[1]] = IC11

    Q12 = np.zeros((u1.shape[1], v2.shape[0]))
    SI12 = linalg.block_diag(S, I12) if swap_sign else linalg.block_diag(-S, -I12)
    Q12[-SI12.shape[0]:, -SI12.shape[1]:] = SI12

    Q21 = np.zeros((u2.shape[1], v1.shape[0]))
    SI21 = linalg.block_diag(-S, -I21) if swap_sign else linalg.block_diag(S, I21)
    Q21[-SI21.shape[0]:, -SI21.shape[1]:] = SI21

    Q22 = np.zeros((u2.shape[1], v2.shape[0]))
    IC22 = linalg.block_diag(I22, C)
    Q22[:IC22.shape[0], :IC22.shape[1]] = IC22

    Q = np.block([[Q11, Q12], [Q21, Q22]])

    # Confirm that `cossin` decomposes `X` as shown
    np.testing.assert_allclose(X, U @ Q @ V.conj().T)

    # And check that `separate=False` agrees
    U0, CS0, Vh0 = linalg.cossin(X, p=p, q=q, swap_sign=swap_sign)
    np.testing.assert_allclose(U, U0)
    np.testing.assert_allclose(Q, CS0)
    np.testing.assert_allclose(V, Vh0.conj().T)

    # Confirm that `compute_u`/`compute_vh` don't affect the results
    kwargs = dict(p=p, q=q, swap_sign=swap_sign)

    # `compute_u=False`
    u, cs, vh = linalg.cossin(X, separate=True, compute_u=False, **kwargs)
    assert u[0].shape == (0, 0)  # probably not ideal, but this is what it does
    assert u[1].shape == (0, 0)
    assert_allclose(cs, cs0, rtol=1e-15)
    assert_allclose(vh[0], vh0[0], rtol=1e-15)
    assert_allclose(vh[1], vh0[1], rtol=1e-15)

    U, CS, Vh = linalg.cossin(X, compute_u=False, **kwargs)
    assert U.shape == (0, 0)
    assert_allclose(CS, CS0, rtol=1e-15)
    assert_allclose(Vh, Vh0, rtol=1e-15)

    # `compute_vh=False`
    u, cs, vh = linalg.cossin(X, separate=True, compute_vh=False, **kwargs)
    assert_allclose(u[0], u[0], rtol=1e-15)
    assert_allclose(u[1], u[1], rtol=1e-15)
    assert_allclose(cs, cs0, rtol=1e-15)
    assert vh[0].shape == (0, 0)
    assert vh[1].shape == (0, 0)

    U, CS, Vh = linalg.cossin(X, compute_vh=False, **kwargs)
    assert_allclose(U, U0, rtol=1e-15)
    assert_allclose(CS, CS0, rtol=1e-15)
    assert Vh.shape == (0, 0)

    # `compute_u=False, compute_vh=False`
    u, cs, vh = linalg.cossin(X, separate=True, compute_u=False,
                              compute_vh=False, **kwargs)
    assert u[0].shape == (0, 0)
    assert u[1].shape == (0, 0)
    assert_allclose(cs, cs0, rtol=1e-15)
    assert vh[0].shape == (0, 0)
    assert vh[1].shape == (0, 0)

    U, CS, Vh = linalg.cossin(X, compute_u=False, compute_vh=False, **kwargs)
    assert U.shape == (0, 0)
    assert_allclose(CS, CS0, rtol=1e-15)
    assert Vh.shape == (0, 0)


def test_indexing_bug_gh19365():
    # Regression test for gh-19365, which reported a bug with `separate=False`
    rng = np.random.default_rng(32954827234421)
    m = rng.integers(50, high=100)
    p = rng.integers(10, 40)  # always p < m
    q = rng.integers(m - p + 1, m - 1)  # always m-p < q < m
    X = unitary_group.rvs(m, random_state=rng)  # random unitary matrix
    U, D, Vt = linalg.cossin(X, p=p, q=q, separate=False)
    assert np.allclose(U @ D @ Vt, X)
