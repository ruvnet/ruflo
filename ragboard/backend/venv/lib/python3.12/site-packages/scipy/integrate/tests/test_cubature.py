import math
import scipy
import itertools

import pytest

from scipy._lib._array_api import (
    array_namespace,
    xp_assert_close,
    xp_size,
    np_compat,
    is_array_api_strict,
)
from scipy.integrate import cubature
from scipy.integrate._cubature import _InfiniteLimitsTransform
from scipy.integrate._rules import (
    Rule, FixedRule,
    NestedFixedRule,
    GaussLegendreQuadrature, GaussKronrodQuadrature,
    GenzMalikCubature,
)

skip_xp_backends = pytest.mark.skip_xp_backends
boolean_index_skip_reason = 'JAX/Dask arrays do not support boolean assignment.'

# The integrands ``genz_malik_1980_*`` come from the paper:
#   A.C. Genz, A.A. Malik, Remarks on algorithm 006: An adaptive algorithm for
#   numerical integration over an N-dimensional rectangular region, Journal of
#   Computational and Applied Mathematics, Volume 6, Issue 4, 1980, Pages 295-302,
#   ISSN 0377-0427, https://doi.org/10.1016/0771-050X(80)90039-X.


def basic_1d_integrand(x, n, xp):
    x_reshaped = xp.reshape(x, (-1, 1, 1))
    n_reshaped = xp.reshape(n, (1, -1, 1))

    return x_reshaped**n_reshaped


def basic_1d_integrand_exact(n, xp):
    # Exact only for integration over interval [0, 2].
    return xp.reshape(2**(n+1)/(n+1), (-1, 1))


def basic_nd_integrand(x, n, xp):
    return xp.reshape(xp.sum(x, axis=-1), (-1, 1))**xp.reshape(n, (1, -1))


def basic_nd_integrand_exact(n, xp):
    # Exact only for integration over interval [0, 2].
    return (-2**(3+n) + 4**(2+n))/((1+n)*(2+n))


def genz_malik_1980_f_1(x, r, alphas, xp):
    r"""
    .. math:: f_1(\mathbf x) = \cos\left(2\pi r + \sum^n_{i = 1}\alpha_i x_i\right)

    .. code-block:: mathematica

        genzMalik1980f1[x_List, r_, alphas_List] := Cos[2*Pi*r + Total[x*alphas]]
    """

    npoints, ndim = x.shape[0], x.shape[-1]

    alphas_reshaped = alphas[None, ...]
    x_reshaped = xp.reshape(x, (npoints, *([1]*(len(alphas.shape) - 1)), ndim))

    return xp.cos(2*math.pi*r + xp.sum(alphas_reshaped * x_reshaped, axis=-1))


def genz_malik_1980_f_1_exact(a, b, r, alphas, xp):
    ndim = xp_size(a)
    a = xp.reshape(a, (*([1]*(len(alphas.shape) - 1)), ndim))
    b = xp.reshape(b, (*([1]*(len(alphas.shape) - 1)), ndim))

    return (
        (-2)**ndim
        * 1/xp.prod(alphas, axis=-1)
        * xp.cos(2*math.pi*r + xp.sum(alphas * (a+b) * 0.5, axis=-1))
        * xp.prod(xp.sin(alphas * (a-b)/2), axis=-1)
    )


def genz_malik_1980_f_1_random_args(rng, shape, xp):
    r = xp.asarray(rng.random(shape[:-1]))
    alphas = xp.asarray(rng.random(shape))

    difficulty = 9
    normalisation_factors = xp.sum(alphas, axis=-1)[..., None]
    alphas = difficulty * alphas / normalisation_factors

    return (r, alphas)


def genz_malik_1980_f_2(x, alphas, betas, xp):
    r"""
    .. math:: f_2(\mathbf x) = \prod^n_{i = 1} (\alpha_i^2 + (x_i - \beta_i)^2)^{-1}

    .. code-block:: mathematica

        genzMalik1980f2[x_List, alphas_List, betas_List] :=
            1/Times @@ ((alphas^2 + (x - betas)^2))
    """
    npoints, ndim = x.shape[0], x.shape[-1]

    alphas_reshaped = alphas[None, ...]
    betas_reshaped = betas[None, ...]

    x_reshaped = xp.reshape(x, (npoints, *([1]*(len(alphas.shape) - 1)), ndim))

    return 1/xp.prod(alphas_reshaped**2 + (x_reshaped-betas_reshaped)**2, axis=-1)


def genz_malik_1980_f_2_exact(a, b, alphas, betas, xp):
    ndim = xp_size(a)
    a = xp.reshape(a, (*([1]*(len(alphas.shape) - 1)), ndim))
    b = xp.reshape(b, (*([1]*(len(alphas.shape) - 1)), ndim))

    return (
        (-1)**ndim * 1/xp.prod(alphas, axis=-1)
        * xp.prod(
            xp.atan((a - betas)/alphas) - xp.atan((b - betas)/alphas),
            axis=-1,
        )
    )


def genz_malik_1980_f_2_random_args(rng, shape, xp):
    ndim = shape[-1]
    alphas = xp.asarray(rng.random(shape))
    betas = xp.asarray(rng.random(shape))

    difficulty = 25.0
    products = xp.prod(alphas**xp.asarray(-2.0), axis=-1)
    normalisation_factors = (products**xp.asarray(1 / (2*ndim)))[..., None]
    alphas = alphas * normalisation_factors * math.pow(difficulty, 1 / (2*ndim))

    # Adjust alphas from distribution used in Genz and Malik 1980 since denominator
    # is very small for high dimensions.
    alphas *= 10

    return alphas, betas


def genz_malik_1980_f_3(x, alphas, xp):
    r"""
    .. math:: f_3(\mathbf x) = \exp\left(\sum^n_{i = 1} \alpha_i x_i\right)

    .. code-block:: mathematica

        genzMalik1980f3[x_List, alphas_List] := Exp[Dot[x, alphas]]
    """

    npoints, ndim = x.shape[0], x.shape[-1]

    alphas_reshaped = alphas[None, ...]
    x_reshaped = xp.reshape(x, (npoints, *([1]*(len(alphas.shape) - 1)), ndim))

    return xp.exp(xp.sum(alphas_reshaped * x_reshaped, axis=-1))


def genz_malik_1980_f_3_exact(a, b, alphas, xp):
    ndim = xp_size(a)
    a = xp.reshape(a, (*([1]*(len(alphas.shape) - 1)), ndim))
    b = xp.reshape(b, (*([1]*(len(alphas.shape) - 1)), ndim))

    return (
        (-1)**ndim * 1/xp.prod(alphas, axis=-1)
        * xp.prod(xp.exp(alphas * a) - xp.exp(alphas * b), axis=-1)
    )


def genz_malik_1980_f_3_random_args(rng, shape, xp):
    alphas = xp.asarray(rng.random(shape))
    normalisation_factors = xp.sum(alphas, axis=-1)[..., None]
    difficulty = 12.0
    alphas = difficulty * alphas / normalisation_factors

    return (alphas,)


def genz_malik_1980_f_4(x, alphas, xp):
    r"""
    .. math:: f_4(\mathbf x) = \left(1 + \sum^n_{i = 1} \alpha_i x_i\right)^{-n-1}

    .. code-block:: mathematica
        genzMalik1980f4[x_List, alphas_List] :=
            (1 + Dot[x, alphas])^(-Length[alphas] - 1)
    """

    npoints, ndim = x.shape[0], x.shape[-1]

    alphas_reshaped = alphas[None, ...]
    x_reshaped = xp.reshape(x, (npoints, *([1]*(len(alphas.shape) - 1)), ndim))

    return (1 + xp.sum(alphas_reshaped * x_reshaped, axis=-1))**(-ndim-1)


def genz_malik_1980_f_4_exact(a, b, alphas, xp):
    ndim = xp_size(a)

    def F(x):
        x_reshaped = xp.reshape(x, (*([1]*(len(alphas.shape) - 1)), ndim))

        return (
            (-1)**ndim/xp.prod(alphas, axis=-1)
            / math.factorial(ndim)
            / (1 + xp.sum(alphas * x_reshaped, axis=-1))
        )

    return _eval_indefinite_integral(F, a, b, xp)


def _eval_indefinite_integral(F, a, b, xp):
    """
    Calculates a definite integral from points `a` to `b` by summing up over the corners
    of the corresponding hyperrectangle.
    """

    ndim = xp_size(a)
    points = xp.stack([a, b], axis=0)

    out = 0
    for ind in itertools.product(range(2), repeat=ndim):
        selected_points = xp.asarray(
            [float(points[i, j]) for i, j in zip(ind, range(ndim))]
        )
        out += pow(-1, sum(ind) + ndim) * F(selected_points)

    return out


def genz_malik_1980_f_4_random_args(rng, shape, xp):
    ndim = shape[-1]

    alphas = xp.asarray(rng.random(shape))
    normalisation_factors = xp.sum(alphas, axis=-1)[..., None]
    difficulty = 14.0
    alphas = (difficulty / ndim) * alphas / normalisation_factors

    return (alphas,)


def genz_malik_1980_f_5(x, alphas, betas, xp):
    r"""
    .. math::

        f_5(\mathbf x) = \exp\left(-\sum^n_{i = 1} \alpha^2_i (x_i - \beta_i)^2\right)

    .. code-block:: mathematica

        genzMalik1980f5[x_List, alphas_List, betas_List] :=
            Exp[-Total[alphas^2 * (x - betas)^2]]
    """

    npoints, ndim = x.shape[0], x.shape[-1]

    alphas_reshaped = alphas[None, ...]
    betas_reshaped = betas[None, ...]

    x_reshaped = xp.reshape(x, (npoints, *([1]*(len(alphas.shape) - 1)), ndim))

    return xp.exp(
        -xp.sum(alphas_reshaped**2 * (x_reshaped - betas_reshaped)**2, axis=-1)
    )


def genz_malik_1980_f_5_exact(a, b, alphas, betas, xp):
    ndim = xp_size(a)
    a = xp.reshape(a, (*([1]*(len(alphas.shape) - 1)), ndim))
    b = xp.reshape(b, (*([1]*(len(alphas.shape) - 1)), ndim))

    return (
        (1/2)**ndim
        * 1/xp.prod(alphas, axis=-1)
        * (math.pi**(ndim/2))
        * xp.prod(
            scipy.special.erf(alphas * (betas - a))
            + scipy.special.erf(alphas * (b - betas)),
            axis=-1,
        )
    )


def genz_malik_1980_f_5_random_args(rng, shape, xp):
    alphas = xp.asarray(rng.random(shape))
    betas = xp.asarray(rng.random(shape))

    difficulty = 21.0
    normalisation_factors = xp.sqrt(xp.sum(alphas**xp.asarray(2.0), axis=-1))[..., None]
    alphas = alphas / normalisation_factors * math.sqrt(difficulty)

    return alphas, betas


def f_gaussian(x, alphas, xp):
    r"""
    .. math::

        f(\mathbf x) = \exp\left(-\sum^n_{i = 1} (\alpha_i x_i)^2 \right)
    """
    npoints, ndim = x.shape[0], x.shape[-1]
    alphas_reshaped = alphas[None, ...]
    x_reshaped = xp.reshape(x, (npoints, *([1]*(len(alphas.shape) - 1)), ndim))

    return xp.exp(-xp.sum((alphas_reshaped * x_reshaped)**2, axis=-1))


def f_gaussian_exact(a, b, alphas, xp):
    # Exact only when `a` and `b` are one of:
    #   (-oo, oo), or
    #   (0, oo), or
    #   (-oo, 0)
    # `alphas` can be arbitrary.

    ndim = xp_size(a)
    double_infinite_count = 0
    semi_infinite_count = 0

    for i in range(ndim):
        if xp.isinf(a[i]) and xp.isinf(b[i]):   # doubly-infinite
            double_infinite_count += 1
        elif xp.isinf(a[i]) != xp.isinf(b[i]):  # exclusive or, so semi-infinite
            semi_infinite_count += 1

    return (math.sqrt(math.pi) ** ndim) / (
        2**semi_infinite_count * xp.prod(alphas, axis=-1)
    )


def f_gaussian_random_args(rng, shape, xp):
    alphas = xp.asarray(rng.random(shape))

    # If alphas are very close to 0 this makes the problem very difficult due to large
    # values of ``f``.
    alphas *= 100

    return (alphas,)


def f_modified_gaussian(x_arr, n, xp):
    r"""
    .. math::

        f(x, y, z, w) = x^n \sqrt{y} \exp(-y-z^2-w^2)
    """
    x, y, z, w = x_arr[:, 0], x_arr[:, 1], x_arr[:, 2], x_arr[:, 3]
    res = (x ** n[:, None]) * xp.sqrt(y) * xp.exp(-y-z**2-w**2)

    return res.T


def f_modified_gaussian_exact(a, b, n, xp):
    # Exact only for the limits
    #   a = (0, 0, -oo, -oo)
    #   b = (1, oo, oo, oo)
    # but defined here as a function to match the format of the other integrands.
    return 1/(2 + 2*n) * math.pi ** (3/2)


def f_with_problematic_points(x_arr, points, xp):
    """
    This emulates a function with a list of singularities given by `points`.

    If no `x_arr` are one of the `points`, then this function returns 1.
    """

    for point in points:
        if xp.any(x_arr == point):
            raise ValueError("called with a problematic point")

    return xp.ones(x_arr.shape[0])


class TestCubature:
    """
    Tests related to the interface of `cubature`.
    """

    @pytest.mark.parametrize("rule_str", [
        "gauss-kronrod",
        "genz-malik",
        "gk21",
        "gk15",
    ])
    def test_pass_str(self, rule_str, xp):
        n = xp.arange(5, dtype=xp.float64)
        a = xp.asarray([0, 0], dtype=xp.float64)
        b = xp.asarray([2, 2], dtype=xp.float64)

        res = cubature(basic_nd_integrand, a, b, rule=rule_str, args=(n, xp))

        xp_assert_close(
            res.estimate,
            basic_nd_integrand_exact(n, xp),
            rtol=1e-8,
            atol=0,
        )

    @skip_xp_backends(np_only=True,
                      reason='array-likes only supported for NumPy backend')
    def test_pass_array_like_not_array(self, xp):
        n = np_compat.arange(5, dtype=np_compat.float64)
        a = [0]
        b = [2]

        res = cubature(
            basic_1d_integrand,
            a,
            b,
            args=(n, xp)
        )

        xp_assert_close(
            res.estimate,
            basic_1d_integrand_exact(n, xp),
            rtol=1e-8,
            atol=0,
        )

    def test_stops_after_max_subdivisions(self, xp):
        a = xp.asarray([0])
        b = xp.asarray([1])
        rule = BadErrorRule()

        res = cubature(
            basic_1d_integrand,  # Any function would suffice
            a,
            b,
            rule=rule,
            max_subdivisions=10,
            args=(xp.arange(5, dtype=xp.float64), xp),
        )

        assert res.subdivisions == 10
        assert res.status == "not_converged"

    def test_a_and_b_must_be_1d(self, xp):
        a = xp.asarray([[0]], dtype=xp.float64)
        b = xp.asarray([[1]], dtype=xp.float64)

        with pytest.raises(Exception, match="`a` and `b` must be 1D arrays"):
            cubature(basic_1d_integrand, a, b, args=(xp,))

    def test_a_and_b_must_be_nonempty(self, xp):
        a = xp.asarray([])
        b = xp.asarray([])

        with pytest.raises(Exception, match="`a` and `b` must be nonempty"):
            cubature(basic_1d_integrand, a, b, args=(xp,))

    def test_zero_width_limits(self, xp):
        n = xp.arange(5, dtype=xp.float64)

        a = xp.asarray([0], dtype=xp.float64)
        b = xp.asarray([0], dtype=xp.float64)

        res = cubature(
            basic_1d_integrand,
            a,
            b,
            args=(n, xp),
        )

        xp_assert_close(
            res.estimate,
            xp.asarray([[0], [0], [0], [0], [0]], dtype=xp.float64),
            rtol=1e-8,
            atol=0,
        )

    def test_limits_other_way_around(self, xp):
        n = xp.arange(5, dtype=xp.float64)

        a = xp.asarray([2], dtype=xp.float64)
        b = xp.asarray([0], dtype=xp.float64)

        res = cubature(
            basic_1d_integrand,
            a,
            b,
            args=(n, xp),
        )

        xp_assert_close(
            res.estimate,
            -basic_1d_integrand_exact(n, xp),
            rtol=1e-8,
            atol=0,
        )

    def test_result_dtype_promoted_correctly(self, xp):
        result_dtype = cubature(
            basic_1d_integrand,
            xp.asarray([0], dtype=xp.float64),
            xp.asarray([1], dtype=xp.float64),
            points=[],
            args=(xp.asarray([1], dtype=xp.float64), xp),
        ).estimate.dtype

        assert result_dtype == xp.float64

        result_dtype = cubature(
            basic_1d_integrand,
            xp.asarray([0], dtype=xp.float32),
            xp.asarray([1], dtype=xp.float32),
            points=[],
            args=(xp.asarray([1], dtype=xp.float32), xp),
        ).estimate.dtype

        assert result_dtype == xp.float32

        result_dtype = cubature(
            basic_1d_integrand,
            xp.asarray([0], dtype=xp.float32),
            xp.asarray([1], dtype=xp.float64),
            points=[],
            args=(xp.asarray([1], dtype=xp.float32), xp),
        ).estimate.dtype

        assert result_dtype == xp.float64


@pytest.mark.parametrize("rtol", [1e-4])
@pytest.mark.parametrize("atol", [1e-5])
@pytest.mark.parametrize("rule", [
    "gk15",
    "gk21",
    "genz-malik",
])
class TestCubatureProblems:
    """
    Tests that `cubature` gives the correct answer.
    """

    @skip_xp_backends("dask.array",
                      reason="Dask hangs/takes a long time for some test cases")
    @pytest.mark.parametrize("problem", [
        # -- f1 --
        (
            # Function to integrate, like `f(x, *args)`
            genz_malik_1980_f_1,

            # Exact solution, like `exact(a, b, *args)`
            genz_malik_1980_f_1_exact,

            # Coordinates of `a`
            [0],

            # Coordinates of `b`
            [10],

            # Arguments to pass to `f` and `exact`
            (
                1/4,
                [5],
            )
        ),
        (
            genz_malik_1980_f_1,
            genz_malik_1980_f_1_exact,
            [0, 0],
            [1, 1],
            (
                1/4,
                [2, 4],
            ),
        ),
        (
            genz_malik_1980_f_1,
            genz_malik_1980_f_1_exact,
            [0, 0],
            [5, 5],
            (
                1/2,
                [2, 4],
            )
        ),
        (
            genz_malik_1980_f_1,
            genz_malik_1980_f_1_exact,
            [0, 0, 0],
            [5, 5, 5],
            (
                1/2,
                [1, 1, 1],
            )
        ),

        # -- f2 --
        (
            genz_malik_1980_f_2,
            genz_malik_1980_f_2_exact,
            [-1],
            [1],
            (
                [5],
                [4],
            )
        ),
        (
            genz_malik_1980_f_2,
            genz_malik_1980_f_2_exact,

            [0, 0],
            [10, 50],
            (
                [-3, 3],
                [-2, 2],
            ),
        ),
        (
            genz_malik_1980_f_2,
            genz_malik_1980_f_2_exact,
            [0, 0, 0],
            [1, 1, 1],
            (
                [1, 1, 1],
                [1, 1, 1],
            )
        ),
        (
            genz_malik_1980_f_2,
            genz_malik_1980_f_2_exact,
            [0, 0, 0],
            [1, 1, 1],
            (
                [2, 3, 4],
                [2, 3, 4],
            )
        ),
        (
            genz_malik_1980_f_2,
            genz_malik_1980_f_2_exact,
            [-1, -1, -1],
            [1, 1, 1],
            (
                [1, 1, 1],
                [2, 2, 2],
            )
        ),
        (
            genz_malik_1980_f_2,
            genz_malik_1980_f_2_exact,
            [-1, -1, -1, -1],
            [1, 1, 1, 1],
            (
                [1, 1, 1, 1],
                [1, 1, 1, 1],
            )
        ),

        # -- f3 --
        (
            genz_malik_1980_f_3,
            genz_malik_1980_f_3_exact,
            [-1],
            [1],
            (
                [1/2],
            ),
        ),
        (
            genz_malik_1980_f_3,
            genz_malik_1980_f_3_exact,
            [0, -1],
            [1, 1],
            (
                [5, 5],
            ),
        ),
        (
            genz_malik_1980_f_3,
            genz_malik_1980_f_3_exact,
            [-1, -1, -1],
            [1, 1, 1],
            (
                [1, 1, 1],
            ),
        ),

        # -- f4 --
        (
            genz_malik_1980_f_4,
            genz_malik_1980_f_4_exact,
            [0],
            [2],
            (
                [1],
            ),
        ),
        (
            genz_malik_1980_f_4,
            genz_malik_1980_f_4_exact,
            [0, 0],
            [2, 1],
            ([1, 1],),
        ),
        (
            genz_malik_1980_f_4,
            genz_malik_1980_f_4_exact,
            [0, 0, 0],
            [1, 1, 1],
            ([1, 1, 1],),
        ),

        # -- f5 --
        (
            genz_malik_1980_f_5,
            genz_malik_1980_f_5_exact,
            [-1],
            [1],
            (
                [-2],
                [2],
            ),
        ),
        (
            genz_malik_1980_f_5,
            genz_malik_1980_f_5_exact,
            [-1, -1],
            [1, 1],
            (
                [2, 3],
                [4, 5],
            ),
        ),
        (
            genz_malik_1980_f_5,
            genz_malik_1980_f_5_exact,
            [-1, -1],
            [1, 1],
            (
                [-1, 1],
                [0, 0],
            ),
        ),
        (
            genz_malik_1980_f_5,
            genz_malik_1980_f_5_exact,
            [-1, -1, -1],
            [1, 1, 1],
            (
                [1, 1, 1],
                [1, 1, 1],
            ),
        ),
    ])
    def test_scalar_output(self, problem, rule, rtol, atol, xp):
        f, exact, a, b, args = problem

        a = xp.asarray(a, dtype=xp.float64)
        b = xp.asarray(b, dtype=xp.float64)
        args = tuple(xp.asarray(arg, dtype=xp.float64) for arg in args)

        ndim = xp_size(a)

        if rule == "genz-malik" and ndim < 2:
            pytest.skip("Genz-Malik cubature does not support 1D integrals")

        res = cubature(
            f,
            a,
            b,
            rule=rule,
            rtol=rtol,
            atol=atol,
            args=(*args, xp),
        )

        assert res.status == "converged"

        est = res.estimate
        exact_sol = exact(a, b, *args, xp)

        xp_assert_close(
            est,
            exact_sol,
            rtol=rtol,
            atol=atol,
            err_msg=f"estimate_error={res.error}, subdivisions={res.subdivisions}",
        )

    @skip_xp_backends("dask.array",
                      reason="Dask hangs/takes a long time for some test cases")
    @pytest.mark.parametrize("problem", [
        (
            # Function to integrate, like `f(x, *args)`
            genz_malik_1980_f_1,

            # Exact solution, like `exact(a, b, *args)`
            genz_malik_1980_f_1_exact,

            # Function that generates random args of a certain shape.
            genz_malik_1980_f_1_random_args,
        ),
        (
            genz_malik_1980_f_2,
            genz_malik_1980_f_2_exact,
            genz_malik_1980_f_2_random_args,
        ),
        (
            genz_malik_1980_f_3,
            genz_malik_1980_f_3_exact,
            genz_malik_1980_f_3_random_args
        ),
        (
            genz_malik_1980_f_4,
            genz_malik_1980_f_4_exact,
            genz_malik_1980_f_4_random_args
        ),
        (
            genz_malik_1980_f_5,
            genz_malik_1980_f_5_exact,
            genz_malik_1980_f_5_random_args,
        ),
    ])
    @pytest.mark.parametrize("shape", [
        (2,),
        (3,),
        (4,),
        (1, 2),
        (1, 3),
        (1, 4),
        (3, 2),
        (3, 4, 2),
        (2, 1, 3),
    ])
    def test_array_output(self, problem, rule, shape, rtol, atol, xp):
        rng = np_compat.random.default_rng(1)
        ndim = shape[-1]

        if rule == "genz-malik" and ndim < 2:
            pytest.skip("Genz-Malik cubature does not support 1D integrals")

        if rule == "genz-malik" and ndim >= 5:
            pytest.mark.slow("Gauss-Kronrod is slow in >= 5 dim")

        f, exact, random_args = problem
        args = random_args(rng, shape, xp)

        a = xp.asarray([0] * ndim, dtype=xp.float64)
        b = xp.asarray([1] * ndim, dtype=xp.float64)

        res = cubature(
            f,
            a,
            b,
            rule=rule,
            rtol=rtol,
            atol=atol,
            args=(*args, xp),
        )

        est = res.estimate
        exact_sol = exact(a, b, *args, xp)

        xp_assert_close(
            est,
            exact_sol,
            rtol=rtol,
            atol=atol,
            err_msg=f"estimate_error={res.error}, subdivisions={res.subdivisions}",
        )

        err_msg = (f"estimate_error={res.error}, "
                   f"subdivisions= {res.subdivisions}, "
                   f"true_error={xp.abs(res.estimate - exact_sol)}")
        assert res.status == "converged", err_msg

        assert res.estimate.shape == shape[:-1]

    @pytest.mark.parametrize("problem", [
        (
            # Function to integrate
            lambda x, xp: x,

            # Exact value
            [50.0],

            # Coordinates of `a`
            [0],

            # Coordinates of `b`
            [10],

            # Points by which to split up the initial region
            None,
        ),
        (
            lambda x, xp: xp.sin(x)/x,
            [2.551496047169878],  # si(1) + si(2),
            [-1],
            [2],
            [
                [0.0],
            ],
        ),
        (
            lambda x, xp: xp.ones((x.shape[0], 1)),
            [1.0],
            [0, 0, 0],
            [1, 1, 1],
            [
                [0.5, 0.5, 0.5],
            ],
        ),
        (
            lambda x, xp: xp.ones((x.shape[0], 1)),
            [1.0],
            [0, 0, 0],
            [1, 1, 1],
            [
                [0.25, 0.25, 0.25],
                [0.5, 0.5, 0.5],
            ],
        ),
        (
            lambda x, xp: xp.ones((x.shape[0], 1)),
            [1.0],
            [0, 0, 0],
            [1, 1, 1],
            [
                [0.1, 0.25, 0.5],
                [0.25, 0.25, 0.25],
                [0.5, 0.5, 0.5],
            ],
        )
    ])
    def test_break_points(self, problem, rule, rtol, atol, xp):
        f, exact, a, b, points = problem

        a = xp.asarray(a, dtype=xp.float64)
        b = xp.asarray(b, dtype=xp.float64)
        exact = xp.asarray(exact, dtype=xp.float64)

        if points is not None:
            points = [xp.asarray(point, dtype=xp.float64) for point in points]

        ndim = xp_size(a)

        if rule == "genz-malik" and ndim < 2:
            pytest.skip("Genz-Malik cubature does not support 1D integrals")

        if rule == "genz-malik" and ndim >= 5:
            pytest.mark.slow("Gauss-Kronrod is slow in >= 5 dim")

        res = cubature(
            f,
            a,
            b,
            rule=rule,
            rtol=rtol,
            atol=atol,
            points=points,
            args=(xp,),
        )

        xp_assert_close(
            res.estimate,
            exact,
            rtol=rtol,
            atol=atol,
            err_msg=f"estimate_error={res.error}, subdivisions={res.subdivisions}",
            check_dtype=False,
        )

        err_msg = (f"estimate_error={res.error}, "
                   f"subdivisions= {res.subdivisions}, "
                   f"true_error={xp.abs(res.estimate - exact)}")
        assert res.status == "converged", err_msg

    @pytest.mark.skip_xp_backends('jax.numpy', reason=boolean_index_skip_reason)
    @pytest.mark.skip_xp_backends('dask.array', reason=boolean_index_skip_reason)
    @pytest.mark.parametrize("problem", [
        (
            # Function to integrate
            f_gaussian,

            # Exact solution
            f_gaussian_exact,

            # Arguments passed to f
            f_gaussian_random_args,
            (1, 1),

            # Limits, have to match the shape of the arguments
            [-math.inf],  # a
            [math.inf],   # b
        ),
        (
            f_gaussian,
            f_gaussian_exact,
            f_gaussian_random_args,
            (2, 2),
            [-math.inf, -math.inf],
            [math.inf, math.inf],
        ),
        (
            f_gaussian,
            f_gaussian_exact,
            f_gaussian_random_args,
            (1, 1),
            [0],
            [math.inf],
        ),
        (
            f_gaussian,
            f_gaussian_exact,
            f_gaussian_random_args,
            (1, 1),
            [-math.inf],
            [0],
        ),
        (
            f_gaussian,
            f_gaussian_exact,
            f_gaussian_random_args,
            (2, 2),
            [0, 0],
            [math.inf, math.inf],
        ),
        (
            f_gaussian,
            f_gaussian_exact,
            f_gaussian_random_args,
            (2, 2),
            [0, -math.inf],
            [math.inf, math.inf],
        ),
        (
            f_gaussian,
            f_gaussian_exact,
            f_gaussian_random_args,
            (1, 4),
            [0, 0, -math.inf, -math.inf],
            [math.inf, math.inf, math.inf, math.inf],
        ),
        (
            f_gaussian,
            f_gaussian_exact,
            f_gaussian_random_args,
            (1, 4),
            [-math.inf, -math.inf, -math.inf, -math.inf],
            [0, 0, math.inf, math.inf],
        ),
        (
            lambda x, xp: 1/xp.prod(x, axis=-1)**2,

            # Exact only for the below limits, not for general `a` and `b`.
            lambda a, b, xp: xp.asarray(1/6, dtype=xp.float64),

            # Arguments
            lambda rng, shape, xp: tuple(),
            tuple(),

            [1, -math.inf, 3],
            [math.inf, -2, math.inf],
        ),

        # This particular problem can be slow
        pytest.param(
            (
                # f(x, y, z, w) = x^n * sqrt(y) * exp(-y-z**2-w**2) for n in [0,1,2,3]
                f_modified_gaussian,

                # This exact solution is for the below limits, not in general
                f_modified_gaussian_exact,

                # Constant arguments
                lambda rng, shape, xp: (xp.asarray([0, 1, 2, 3, 4], dtype=xp.float64),),
                tuple(),

                [0, 0, -math.inf, -math.inf],
                [1, math.inf, math.inf, math.inf]
            ),

            marks=pytest.mark.xslow,
        ),
    ])
    def test_infinite_limits(self, problem, rule, rtol, atol, xp):
        rng = np_compat.random.default_rng(1)
        f, exact, random_args_func, random_args_shape, a, b = problem

        a = xp.asarray(a, dtype=xp.float64)
        b = xp.asarray(b, dtype=xp.float64)
        args = random_args_func(rng, random_args_shape, xp)

        ndim = xp_size(a)

        if rule == "genz-malik" and ndim < 2:
            pytest.skip("Genz-Malik cubature does not support 1D integrals")

        if rule == "genz-malik" and ndim >= 4:
            pytest.mark.slow("Genz-Malik is slow in >= 5 dim")

        if rule == "genz-malik" and ndim >= 4 and is_array_api_strict(xp):
            pytest.mark.xslow("Genz-Malik very slow for array_api_strict in >= 4 dim")

        res = cubature(
            f,
            a,
            b,
            rule=rule,
            rtol=rtol,
            atol=atol,
            args=(*args, xp),
        )

        assert res.status == "converged"

        xp_assert_close(
            res.estimate,
            exact(a, b, *args, xp),
            rtol=rtol,
            atol=atol,
            err_msg=f"error_estimate={res.error}, subdivisions={res.subdivisions}",
            check_0d=False,
        )

    @pytest.mark.skip_xp_backends('jax.numpy', reason=boolean_index_skip_reason)
    @pytest.mark.skip_xp_backends('dask.array', reason=boolean_index_skip_reason)
    @pytest.mark.parametrize("problem", [
        (
            # Function to integrate
            lambda x, xp: (xp.sin(x) / x)**8,

            # Exact value
            [151/315 * math.pi],

            # Limits
            [-math.inf],
            [math.inf],

            # Breakpoints
            [[0]],

        ),
        (
            # Function to integrate
            lambda x, xp: (xp.sin(x[:, 0]) / x[:, 0])**8,

            # Exact value
            151/315 * math.pi,

            # Limits
            [-math.inf, 0],
            [math.inf, 1],

            # Breakpoints
            [[0, 0.5]],

        )
    ])
    def test_infinite_limits_and_break_points(self, problem, rule, rtol, atol, xp):
        f, exact, a, b, points = problem

        a = xp.asarray(a, dtype=xp.float64)
        b = xp.asarray(b, dtype=xp.float64)
        exact = xp.asarray(exact, dtype=xp.float64)

        ndim = xp_size(a)

        if rule == "genz-malik" and ndim < 2:
            pytest.skip("Genz-Malik cubature does not support 1D integrals")

        if points is not None:
            points = [xp.asarray(point, dtype=xp.float64) for point in points]

        res = cubature(
            f,
            a,
            b,
            rule=rule,
            rtol=rtol,
            atol=atol,
            points=points,
            args=(xp,),
        )

        assert res.status == "converged"

        xp_assert_close(
            res.estimate,
            exact,
            rtol=rtol,
            atol=atol,
            err_msg=f"error_estimate={res.error}, subdivisions={res.subdivisions}",
            check_0d=False,
        )


class TestRules:
    """
    Tests related to the general Rule interface (currently private).
    """

    @pytest.mark.parametrize("problem", [
        (
            # 2D problem, 1D rule
            [0, 0],
            [1, 1],
            GaussKronrodQuadrature,
            (21,),
        ),
        (
            # 1D problem, 2D rule
            [0],
            [1],
            GenzMalikCubature,
            (2,),
        )
    ])
    def test_incompatible_dimension_raises_error(self, problem, xp):
        a, b, quadrature, quadrature_args = problem
        rule = quadrature(*quadrature_args, xp=xp)

        a = xp.asarray(a, dtype=xp.float64)
        b = xp.asarray(b, dtype=xp.float64)

        with pytest.raises(Exception, match="incompatible dimension"):
            rule.estimate(basic_1d_integrand, a, b, args=(xp,))

    def test_estimate_with_base_classes_raise_error(self, xp):
        a = xp.asarray([0])
        b = xp.asarray([1])

        for base_class in [Rule(), FixedRule()]:
            with pytest.raises(Exception):
                base_class.estimate(basic_1d_integrand, a, b, args=(xp,))


class TestRulesQuadrature:
    """
    Tests underlying quadrature rules (ndim == 1).
    """

    @pytest.mark.parametrize(("rule", "rule_args"), [
        (GaussLegendreQuadrature, (3,)),
        (GaussLegendreQuadrature, (5,)),
        (GaussLegendreQuadrature, (10,)),
        (GaussKronrodQuadrature, (15,)),
        (GaussKronrodQuadrature, (21,)),
    ])
    def test_base_1d_quadratures_simple(self, rule, rule_args, xp):
        quadrature = rule(*rule_args, xp=xp)

        n = xp.arange(5, dtype=xp.float64)

        def f(x):
            x_reshaped = xp.reshape(x, (-1, 1, 1))
            n_reshaped = xp.reshape(n, (1, -1, 1))

            return x_reshaped**n_reshaped

        a = xp.asarray([0], dtype=xp.float64)
        b = xp.asarray([2], dtype=xp.float64)

        exact = xp.reshape(2**(n+1)/(n+1), (-1, 1))
        estimate = quadrature.estimate(f, a, b)

        xp_assert_close(
            estimate,
            exact,
            rtol=1e-8,
            atol=0,
        )

    @pytest.mark.parametrize(("rule_pair", "rule_pair_args"), [
        ((GaussLegendreQuadrature, GaussLegendreQuadrature), (10, 5)),
    ])
    def test_base_1d_quadratures_error_from_difference(self, rule_pair, rule_pair_args,
                                                       xp):
        n = xp.arange(5, dtype=xp.float64)
        a = xp.asarray([0], dtype=xp.float64)
        b = xp.asarray([2], dtype=xp.float64)

        higher = rule_pair[0](rule_pair_args[0], xp=xp)
        lower = rule_pair[1](rule_pair_args[1], xp=xp)

        rule = NestedFixedRule(higher, lower)
        res = cubature(
            basic_1d_integrand,
            a, b,
            rule=rule,
            rtol=1e-8,
            args=(n, xp),
        )

        xp_assert_close(
            res.estimate,
            basic_1d_integrand_exact(n, xp),
            rtol=1e-8,
            atol=0,
        )

    @pytest.mark.parametrize("quadrature", [
        GaussLegendreQuadrature
    ])
    def test_one_point_fixed_quad_impossible(self, quadrature, xp):
        with pytest.raises(Exception):
            quadrature(1, xp=xp)


class TestRulesCubature:
    """
    Tests underlying cubature rules (ndim >= 2).
    """

    @pytest.mark.parametrize("ndim", range(2, 11))
    def test_genz_malik_func_evaluations(self, ndim, xp):
        """
        Tests that the number of function evaluations required for Genz-Malik cubature
        matches the number in Genz and Malik 1980.
        """

        nodes, _ = GenzMalikCubature(ndim, xp=xp).nodes_and_weights

        assert nodes.shape[0] == (2**ndim) + 2*ndim**2 + 2*ndim + 1

    def test_genz_malik_1d_raises_error(self, xp):
        with pytest.raises(Exception, match="only defined for ndim >= 2"):
            GenzMalikCubature(1, xp=xp)


@pytest.mark.skip_xp_backends('jax.numpy', reason=boolean_index_skip_reason)
@pytest.mark.skip_xp_backends('dask.array', reason=boolean_index_skip_reason)
class TestTransformations:
    @pytest.mark.parametrize(("a", "b", "points"), [
        (
            [0, 1, -math.inf],
            [1, math.inf, math.inf],
            [
                [1, 1, 1],
                [0.5, 10, 10],
            ]
        )
    ])
    def test_infinite_limits_maintains_points(self, a, b, points, xp):
        """
        Test that break points are correctly mapped under the _InfiniteLimitsTransform
        transformation.
        """

        points = [xp.asarray(p, dtype=xp.float64) for p in points]

        f_transformed = _InfiniteLimitsTransform(
            # Bind `points` and `xp` argument in f
            lambda x: f_with_problematic_points(x, points, xp),
            xp.asarray(a, dtype=xp.float64),
            xp.asarray(b, dtype=xp.float64),
            xp=xp,
        )

        for point in points:
            transformed_point = f_transformed.inv(xp.reshape(point, (1, -1)))

            with pytest.raises(Exception, match="called with a problematic point"):
                f_transformed(transformed_point)


class BadErrorRule(Rule):
    """
    A rule with fake high error so that cubature will keep on subdividing.
    """

    def estimate(self, f, a, b, args=()):
        xp = array_namespace(a, b)
        underlying = GaussLegendreQuadrature(10, xp=xp)

        return underlying.estimate(f, a, b, args)

    def estimate_error(self, f, a, b, args=()):
        xp = array_namespace(a, b)
        return xp.asarray(1e6, dtype=xp.float64)
