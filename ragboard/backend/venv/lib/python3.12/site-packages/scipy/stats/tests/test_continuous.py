import itertools as it
import os
import pickle
from copy import deepcopy

import numpy as np
from numpy import inf
import pytest
from numpy.testing import assert_allclose, assert_equal
from hypothesis import strategies, given, reproduce_failure, settings  # noqa: F401
import hypothesis.extra.numpy as npst

from scipy import special
from scipy import stats
from scipy.stats._fit import _kolmogorov_smirnov
from scipy.stats._ksstats import kolmogn
from scipy.stats import qmc
from scipy.stats._distr_params import distcont, distdiscrete
from scipy.stats._distribution_infrastructure import (
    _Domain, _RealInterval, _Parameter, _Parameterization, _RealParameter,
    ContinuousDistribution, ShiftedScaledDistribution, _fiinfo,
    _generate_domain_support, Mixture)
from scipy.stats._new_distributions import StandardNormal, _LogUniform, _Gamma
from scipy.stats._new_distributions import DiscreteDistribution
from scipy.stats import Normal, Uniform, Binomial


class Test_RealInterval:
    rng = np.random.default_rng(349849812549824)

    def test_iv(self):
        domain = _RealInterval(endpoints=('a', 'b'))
        message = "The endpoints of the distribution are defined..."
        with pytest.raises(TypeError, match=message):
            domain.get_numerical_endpoints(dict)


    @pytest.mark.parametrize('x', [rng.uniform(10, 10, size=(2, 3, 4)),
                                   -np.inf, np.pi])
    def test_contains_simple(self, x):
        # Test `contains` when endpoints are defined by constants
        a, b = -np.inf, np.pi
        domain = _RealInterval(endpoints=(a, b), inclusive=(False, True))
        assert_equal(domain.contains(x), (a < x) & (x <= b))

    @pytest.mark.slow
    @given(shapes=npst.mutually_broadcastable_shapes(num_shapes=3, min_side=0),
           inclusive_a=strategies.booleans(),
           inclusive_b=strategies.booleans(),
           data=strategies.data())
    @pytest.mark.thread_unsafe
    def test_contains(self, shapes, inclusive_a, inclusive_b, data):
        # Test `contains` when endpoints are defined by parameters
        input_shapes, result_shape = shapes
        shape_a, shape_b, shape_x = input_shapes

        # Without defining min and max values, I spent forever trying to set
        # up a valid test without overflows or similar just drawing arrays.
        a_elements = dict(allow_nan=False, allow_infinity=False,
                          min_value=-1e3, max_value=1)
        b_elements = dict(allow_nan=False, allow_infinity=False,
                          min_value=2, max_value=1e3)
        a = data.draw(npst.arrays(npst.floating_dtypes(),
                                  shape_a, elements=a_elements))
        b = data.draw(npst.arrays(npst.floating_dtypes(),
                                  shape_b, elements=b_elements))
        # ensure some points are to the left, some to the right, and some
        # are exactly on the boundary
        d = b - a
        x = np.concatenate([np.linspace(a-d, a, 10),
                            np.linspace(a, b, 10),
                            np.linspace(b, b+d, 10)])
        # Domain is defined by two parameters, 'a' and 'b'
        domain = _RealInterval(endpoints=('a', 'b'),
                             inclusive=(inclusive_a, inclusive_b))
        domain.define_parameters(_RealParameter('a', domain=_RealInterval()),
                                 _RealParameter('b', domain=_RealInterval()))
        # Check that domain and string evaluation give the same result
        res = domain.contains(x, dict(a=a, b=b))

        # Apparently, `np.float16([2]) < np.float32(2.0009766)` is False
        # but `np.float16([2]) < np.float32([2.0009766])` is True
        # dtype = np.result_type(a.dtype, b.dtype, x.dtype)
        # a, b, x = a.astype(dtype), b.astype(dtype), x.astype(dtype)
        # unclear whether we should be careful about this, since it will be
        # fixed with NEP50. Just do what makes the test pass.
        left_comparison = '<=' if inclusive_a else '<'
        right_comparison = '<=' if inclusive_b else '<'
        ref = eval(f'(a {left_comparison} x) & (x {right_comparison} b)')
        assert_equal(res, ref)

    @pytest.mark.parametrize("inclusive", list(it.product([True, False], repeat=2)))
    @pytest.mark.parametrize("a,b", [(0, 1), (3, 1)])
    def test_contains_function_endpoints(self, inclusive, a, b):
        # Test `contains` when endpoints are defined by functions.
        endpoints = (lambda a, b: (a - b) / 2, lambda a, b: (a + b) / 2)
        domain = _RealInterval(endpoints=endpoints, inclusive=inclusive)
        x = np.asarray([(a - 2*b)/2, (a - b)/2, a/2, (a + b)/2, (a + 2*b)/2])
        res = domain.contains(x, dict(a=a, b=b))

        numerical_endpoints = ((a - b) / 2, (a + b) / 2)
        assert numerical_endpoints == domain.get_numerical_endpoints(dict(a=a, b=b))
        alpha, beta = numerical_endpoints

        above_left = alpha <= x if inclusive[0] else alpha < x
        below_right = x <= beta if inclusive[1] else x < beta
        ref = above_left & below_right
        assert_equal(res, ref)


    @pytest.mark.parametrize('case', [
        (-np.inf, np.pi, False, True, r"(-\infty, \pi]"),
        ('a', 5, True, False, "[a, 5)")
    ])
    def test_str(self, case):
        domain = _RealInterval(endpoints=case[:2], inclusive=case[2:4])
        assert str(domain) == case[4]

    @pytest.mark.slow
    @given(a=strategies.one_of(
        strategies.decimals(allow_nan=False),
        strategies.characters(whitelist_categories="L"),  # type: ignore[arg-type]
        strategies.sampled_from(list(_Domain.symbols))),
           b=strategies.one_of(
        strategies.decimals(allow_nan=False),
        strategies.characters(whitelist_categories="L"),  # type: ignore[arg-type]
        strategies.sampled_from(list(_Domain.symbols))),
           inclusive_a=strategies.booleans(),
           inclusive_b=strategies.booleans(),
           )
    @pytest.mark.thread_unsafe
    def test_str2(self, a, b, inclusive_a, inclusive_b):
        # I wrote this independently from the implementation of __str__, but
        # I imagine it looks pretty similar to __str__.
        a = _Domain.symbols.get(a, a)
        b = _Domain.symbols.get(b, b)
        left_bracket = '[' if inclusive_a else '('
        right_bracket = ']' if inclusive_b else ')'
        domain = _RealInterval(endpoints=(a, b),
                             inclusive=(inclusive_a, inclusive_b))
        ref = f"{left_bracket}{a}, {b}{right_bracket}"
        assert str(domain) == ref

    def test_symbols_gh22137(self):
        # `symbols` was accidentally shared between instances originally
        # Check that this is no longer the case
        domain1 = _RealInterval(endpoints=(0, 1))
        domain2 = _RealInterval(endpoints=(0, 1))
        assert domain1.symbols is not domain2.symbols


def draw_distribution_from_family(family, data, rng, proportions, min_side=0):
    # If the distribution has parameters, choose a parameterization and
    # draw broadcastable shapes for the parameter arrays.
    n_parameterizations = family._num_parameterizations()
    if n_parameterizations > 0:
        i = data.draw(strategies.integers(0, max_value=n_parameterizations-1))
        n_parameters = family._num_parameters(i)
        shapes, result_shape = data.draw(
            npst.mutually_broadcastable_shapes(num_shapes=n_parameters,
                                               min_side=min_side))
        dist = family._draw(shapes, rng=rng, proportions=proportions,
                            i_parameterization=i)
    else:
        dist = family._draw(rng=rng)
        result_shape = tuple()

    # Draw a broadcastable shape for the arguments, and draw values for the
    # arguments.
    x_shape = data.draw(npst.broadcastable_shapes(result_shape,
                                                  min_side=min_side))
    x = dist._variable.draw(x_shape, parameter_values=dist._parameters,
                            proportions=proportions, rng=rng, region='typical')
    x_result_shape = np.broadcast_shapes(x_shape, result_shape)
    y_shape = data.draw(npst.broadcastable_shapes(x_result_shape,
                                                  min_side=min_side))
    y = dist._variable.draw(y_shape, parameter_values=dist._parameters,
                            proportions=proportions, rng=rng, region='typical')
    xy_result_shape = np.broadcast_shapes(y_shape, x_result_shape)
    p_domain = _RealInterval((0, 1), (True, True))
    p_var = _RealParameter('p', domain=p_domain)
    p = p_var.draw(x_shape, proportions=proportions, rng=rng)
    with np.errstate(divide='ignore', invalid='ignore'):
        logp = np.log(p)

    return dist, x, y, p, logp, result_shape, x_result_shape, xy_result_shape


continuous_families = [
    StandardNormal,
    Normal,
    Uniform,
    _LogUniform
]

discrete_families = [
    Binomial,
]

families = continuous_families + discrete_families


class TestDistributions:
    @pytest.mark.fail_slow(60)  # need to break up check_moment_funcs
    @settings(max_examples=20)
    @pytest.mark.parametrize('family', families)
    @given(data=strategies.data(), seed=strategies.integers(min_value=0))
    @pytest.mark.thread_unsafe
    def test_support_moments_sample(self, family, data, seed):
        rng = np.random.default_rng(seed)

        # relative proportions of valid, endpoint, out of bounds, and NaN params
        proportions = (0.7, 0.1, 0.1, 0.1)
        tmp = draw_distribution_from_family(family, data, rng, proportions)
        dist, x, y, p, logp, result_shape, x_result_shape, xy_result_shape = tmp
        sample_shape = data.draw(npst.array_shapes(min_dims=0, min_side=0,
                                                   max_side=20))

        with np.errstate(invalid='ignore', divide='ignore'):
            check_support(dist)
            check_moment_funcs(dist, result_shape)  # this needs to get split up
            check_sample_shape_NaNs(dist, 'sample', sample_shape, result_shape, rng)
            qrng = qmc.Halton(d=1, seed=rng)
            check_sample_shape_NaNs(dist, 'sample', sample_shape, result_shape, qrng)

    @pytest.mark.fail_slow(10)
    @pytest.mark.parametrize('family', families)
    @pytest.mark.parametrize('func, methods, arg',
                             [('entropy', {'log/exp', 'quadrature'}, None),
                              ('logentropy', {'log/exp', 'quadrature'}, None),
                              ('median', {'icdf'}, None),
                              ('mode', {'optimization'}, None),
                              ('mean', {'cache'}, None),
                              ('variance', {'cache'}, None),
                              ('skewness', {'cache'}, None),
                              ('kurtosis', {'cache'}, None),
                              ('pdf', {'log/exp'}, 'x'),
                              ('logpdf', {'log/exp'}, 'x'),
                              ('logcdf', {'log/exp', 'complement', 'quadrature'}, 'x'),
                              ('cdf', {'log/exp', 'complement', 'quadrature'}, 'x'),
                              ('logccdf', {'log/exp', 'complement', 'quadrature'}, 'x'),
                              ('ccdf', {'log/exp', 'complement', 'quadrature'}, 'x'),
                              ('ilogccdf', {'complement', 'inversion'}, 'logp'),
                              ('iccdf', {'complement', 'inversion'}, 'p'),
                              ])
    @settings(max_examples=20)
    @given(data=strategies.data(), seed=strategies.integers(min_value=0))
    @pytest.mark.thread_unsafe
    def test_funcs(self, family, data, seed, func, methods, arg):
        if family == Uniform and func == 'mode':
            pytest.skip("Mode is not unique; `method`s disagree.")

        rng = np.random.default_rng(seed)

        # relative proportions of valid, endpoint, out of bounds, and NaN params
        proportions = (0.7, 0.1, 0.1, 0.1)
        tmp = draw_distribution_from_family(family, data, rng, proportions)
        dist, x, y, p, logp, result_shape, x_result_shape, xy_result_shape = tmp

        args = {'x': x, 'p': p, 'logp': p}
        with np.errstate(invalid='ignore', divide='ignore', over='ignore'):
            if arg is None:
                check_dist_func(dist, func, None, result_shape, methods)
            elif arg in args:
                check_dist_func(dist, func, args[arg], x_result_shape, methods)

        if func == 'variance':
            assert_allclose(dist.standard_deviation()**2, dist.variance())

        # invalid and divide are to be expected; maybe look into over
        with np.errstate(invalid='ignore', divide='ignore', over='ignore'):
            if not isinstance(dist, ShiftedScaledDistribution):
                if func == 'cdf':
                    methods = {'quadrature'}
                    check_cdf2(dist, False, x, y, xy_result_shape, methods)
                    check_cdf2(dist, True, x, y, xy_result_shape, methods)
                elif func == 'ccdf':
                    methods = {'addition'}
                    check_ccdf2(dist, False, x, y, xy_result_shape, methods)
                    check_ccdf2(dist, True, x, y, xy_result_shape, methods)

    @pytest.mark.thread_unsafe
    def test_plot(self):
        try:
            import matplotlib.pyplot as plt
        except ImportError:
            return

        X = Uniform(a=0., b=1.)
        ax = X.plot()
        assert ax == plt.gca()

    @pytest.mark.parametrize('method_name', ['cdf', 'ccdf'])
    def test_complement_safe(self, method_name):
        X = stats.Normal()
        X.tol = 1e-12
        p = np.asarray([1e-4, 1e-3])
        func = getattr(X, method_name)
        ifunc = getattr(X, 'i'+method_name)
        x = ifunc(p, method='formula')
        p1 = func(x, method='complement_safe')
        p2 = func(x, method='complement')
        assert_equal(p1[1], p2[1])
        assert p1[0] != p2[0]
        assert_allclose(p1[0], p[0], rtol=X.tol)

    @pytest.mark.parametrize('method_name', ['cdf', 'ccdf'])
    def test_icomplement_safe(self, method_name):
        X = stats.Normal()
        X.tol = 1e-12
        p = np.asarray([1e-4, 1e-3])
        func = getattr(X, method_name)
        ifunc = getattr(X, 'i'+method_name)
        x1 = ifunc(p, method='complement_safe')
        x2 = ifunc(p, method='complement')
        assert_equal(x1[1], x2[1])
        assert x1[0] != x2[0]
        assert_allclose(func(x1[0]), p[0], rtol=X.tol)

    def test_subtraction_safe(self):
        X = stats.Normal()
        X.tol = 1e-12

        # Regular subtraction is fine in either tail (and of course, across tails)
        x = [-11, -10, 10, 11]
        y = [-10, -11, 11, 10]
        p0 = X.cdf(x, y, method='quadrature')
        p1 = X.cdf(x, y, method='subtraction_safe')
        p2 = X.cdf(x, y, method='subtraction')
        assert_equal(p2, p1)
        assert_allclose(p1, p0, rtol=X.tol)

        # Safe subtraction is needed in special cases
        x = np.asarray([-1e-20, -1e-21, 1e-20, 1e-21, -1e-20])
        y = np.asarray([-1e-21, -1e-20, 1e-21, 1e-20, 1e-20])


        p0 = X.pdf(0)*(y-x)
        p1 = X.cdf(x, y, method='subtraction_safe')
        p2 = X.cdf(x, y, method='subtraction')
        assert_equal(p2, 0)
        assert_allclose(p1, p0, rtol=X.tol)

    def test_logentropy_safe(self):
        # simulate an `entropy` calculation over/underflowing with extreme parameters
        class _Normal(stats.Normal):
            def _entropy_formula(self, **params):
                out = np.asarray(super()._entropy_formula(**params))
                out[0] = 0
                out[-1] = np.inf
                return out

        X = _Normal(sigma=[1, 2, 3])
        with np.errstate(divide='ignore'):
            res1 = X.logentropy(method='logexp_safe')
            res2 = X.logentropy(method='logexp')
        ref = X.logentropy(method='quadrature')
        i_fl = [0, -1]  # first and last
        assert np.isinf(res2[i_fl]).all()
        assert res1[1] == res2[1]
        # quadrature happens to be perfectly accurate on some platforms
        # assert res1[1] != ref[1]
        assert_equal(res1[i_fl], ref[i_fl])

    def test_logcdf2_safe(self):
        # test what happens when 2-arg `cdf` underflows
        X = stats.Normal(sigma=[1, 2, 3])
        x = [-301, 1, 300]
        y = [-300, 2, 301]
        with np.errstate(divide='ignore'):
            res1 = X.logcdf(x, y, method='logexp_safe')
            res2 = X.logcdf(x, y, method='logexp')
        ref = X.logcdf(x, y, method='quadrature')
        i_fl = [0, -1]  # first and last
        assert np.isinf(res2[i_fl]).all()
        assert res1[1] == res2[1]
        # quadrature happens to be perfectly accurate on some platforms
        # assert res1[1] != ref[1]
        assert_equal(res1[i_fl], ref[i_fl])

    @pytest.mark.parametrize('method_name', ['logcdf', 'logccdf'])
    def test_logexp_safe(self, method_name):
        # test what happens when `cdf`/`ccdf` underflows
        X = stats.Normal(sigma=2)
        x = [-301, 1] if method_name == 'logcdf' else [301, 1]
        func = getattr(X, method_name)
        with np.errstate(divide='ignore'):
            res1 = func(x, method='logexp_safe')
            res2 = func(x, method='logexp')
        ref = func(x, method='quadrature')
        assert res1[0] == ref[0]
        assert res1[0] != res2[0]
        assert res1[1] == res2[1]
        assert res1[1] != ref[1]

def check_sample_shape_NaNs(dist, fname, sample_shape, result_shape, rng):
    full_shape = sample_shape + result_shape
    if fname == 'sample':
        sample_method = dist.sample

    methods = {'inverse_transform'}
    if dist._overrides(f'_{fname}_formula') and not isinstance(rng, qmc.QMCEngine):
        methods.add('formula')

    for method in methods:
        res = sample_method(sample_shape, method=method, rng=rng)
        valid_parameters = np.broadcast_to(get_valid_parameters(dist),
                                           res.shape)
        assert_equal(res.shape, full_shape)
        np.testing.assert_equal(res.dtype, dist._dtype)

        if full_shape == ():
            # NumPy random makes a distinction between a 0d array and a scalar.
            # In stats, we consistently turn 0d arrays into scalars, so
            # maintain that behavior here. (With Array API arrays, this will
            # change.)
            assert np.isscalar(res)
        assert np.all(np.isfinite(res[valid_parameters]))
        assert_equal(res[~valid_parameters], np.nan)

        sample1 = sample_method(sample_shape, method=method, rng=42)
        sample2 = sample_method(sample_shape, method=method, rng=42)
        if not isinstance(dist, DiscreteDistribution):
            # The idea is that it's very unlikely that the random sample
            # for a randomly chosen seed will match that for seed 42,
            # but it is not so unlikely if `dist` is a discrete distribution.
            assert not np.any(np.equal(res, sample1))
        assert_equal(sample1, sample2)


def check_support(dist):
    a, b = dist.support()
    check_nans_and_edges(dist, 'support', None, a)
    check_nans_and_edges(dist, 'support', None, b)
    assert a.shape == dist._shape
    assert b.shape == dist._shape
    assert a.dtype == dist._dtype
    assert b.dtype == dist._dtype


def check_dist_func(dist, fname, arg, result_shape, methods):
    # Check that all computation methods of all distribution functions agree
    # with one another, effectively testing the correctness of the generic
    # computation methods and confirming the consistency of specific
    # distributions with their pdf/logpdf.

    args = tuple() if arg is None else (arg,)
    methods = methods.copy()

    if "cache" in methods:
        # If "cache" is specified before the value has been evaluated, it
        # raises an error. After the value is evaluated, it will succeed.
        with pytest.raises(NotImplementedError):
            getattr(dist, fname)(*args, method="cache")

    ref = getattr(dist, fname)(*args)
    check_nans_and_edges(dist, fname, arg, ref)

    # Remove this after fixing `draw`
    tol_override = {'atol': 1e-15}
    # Mean can be 0, which makes logmean -inf.
    if fname in {'logmean', 'mean', 'logskewness', 'skewness'}:
        tol_override = {'atol': 1e-15}
    elif fname in {'mode'}:
        # can only expect about half of machine precision for optimization
        # because math
        tol_override = {'atol': 1e-6}
    elif fname in {'logcdf'}:  # gh-22276
        tol_override = {'rtol': 2e-7}

    if dist._overrides(f'_{fname}_formula'):
        methods.add('formula')

    np.testing.assert_equal(ref.shape, result_shape)
    # Until we convert to array API, let's do the familiar thing:
    # 0d things are scalars, not arrays
    if result_shape == tuple():
        assert np.isscalar(ref)

    for method in methods:
        res = getattr(dist, fname)(*args, method=method)
        if 'log' in fname:
            np.testing.assert_allclose(np.exp(res), np.exp(ref),
                                       **tol_override)
        else:
            np.testing.assert_allclose(res, ref, **tol_override)

        # for now, make sure dtypes are consistent; later, we can check whether
        # they are correct.
        np.testing.assert_equal(res.dtype, ref.dtype)
        np.testing.assert_equal(res.shape, result_shape)
        if result_shape == tuple():
            assert np.isscalar(res)

def check_cdf2(dist, log, x, y, result_shape, methods):
    # Specialized test for 2-arg cdf since the interface is a bit different
    # from the other methods. Here, we'll use 1-arg cdf as a reference, and
    # since we have already checked 1-arg cdf in `check_nans_and_edges`, this
    # checks the equivalent of both `check_dist_func` and
    # `check_nans_and_edges`.
    methods = methods.copy()

    if log:
        if dist._overrides('_logcdf2_formula'):
            methods.add('formula')
        if dist._overrides('_logcdf_formula') or dist._overrides('_logccdf_formula'):
            methods.add('subtraction')
        if (dist._overrides('_cdf_formula')
                or dist._overrides('_ccdf_formula')):
            methods.add('log/exp')
    else:
        if dist._overrides('_cdf2_formula'):
            methods.add('formula')
        if dist._overrides('_cdf_formula') or dist._overrides('_ccdf_formula'):
            methods.add('subtraction')
        if (dist._overrides('_logcdf_formula')
                or dist._overrides('_logccdf_formula')):
            methods.add('log/exp')

    ref = dist.cdf(y) - dist.cdf(x)
    np.testing.assert_equal(ref.shape, result_shape)

    if result_shape == tuple():
        assert np.isscalar(ref)

    for method in methods:
        if isinstance(dist, DiscreteDistribution):
            message = ("Two argument cdf functions are currently only supported for "
                       "continuous distributions.")
            with pytest.raises(NotImplementedError, match=message):
                res = (np.exp(dist.logcdf(x, y, method=method)) if log
                       else dist.cdf(x, y, method=method))
            continue
        res = (np.exp(dist.logcdf(x, y, method=method)) if log
               else dist.cdf(x, y, method=method))
        np.testing.assert_allclose(res, ref, atol=1e-14)
        if log:
            np.testing.assert_equal(res.dtype, (ref + 0j).dtype)
        else:
            np.testing.assert_equal(res.dtype, ref.dtype)
        np.testing.assert_equal(res.shape, result_shape)
        if result_shape == tuple():
            assert np.isscalar(res)


def check_ccdf2(dist, log, x, y, result_shape, methods):
    # Specialized test for 2-arg ccdf since the interface is a bit different
    # from the other methods. Could be combined with check_cdf2 above, but
    # writing it separately is simpler.
    methods = methods.copy()

    if dist._overrides(f'_{"log" if log else ""}ccdf2_formula'):
        methods.add('formula')

    ref = dist.cdf(x) + dist.ccdf(y)
    np.testing.assert_equal(ref.shape, result_shape)

    if result_shape == tuple():
        assert np.isscalar(ref)

    for method in methods:
        message = ("Two argument cdf functions are currently only supported for "
                   "continuous distributions.")
        if isinstance(dist, DiscreteDistribution):
            with pytest.raises(NotImplementedError, match=message):
                res = (np.exp(dist.logccdf(x, y, method=method)) if log
                       else dist.ccdf(x, y, method=method))
            continue
        res = (np.exp(dist.logccdf(x, y, method=method)) if log
               else dist.ccdf(x, y, method=method))
        np.testing.assert_allclose(res, ref, atol=1e-14)
        np.testing.assert_equal(res.dtype, ref.dtype)
        np.testing.assert_equal(res.shape, result_shape)
        if result_shape == tuple():
            assert np.isscalar(res)


def check_nans_and_edges(dist, fname, arg, res):

    valid_parameters = get_valid_parameters(dist)
    if fname in {'icdf', 'iccdf'}:
        arg_domain = _RealInterval(endpoints=(0, 1), inclusive=(True, True))
    elif fname in {'ilogcdf', 'ilogccdf'}:
        arg_domain = _RealInterval(endpoints=(-inf, 0), inclusive=(True, True))
    else:
        arg_domain = dist._variable.domain

    classified_args = classify_arg(dist, arg, arg_domain)
    valid_parameters, *classified_args = np.broadcast_arrays(valid_parameters,
                                                             *classified_args)
    valid_arg, endpoint_arg, outside_arg, nan_arg = classified_args
    all_valid = valid_arg & valid_parameters

    # Check NaN pattern and edge cases
    assert_equal(res[~valid_parameters], np.nan)
    assert_equal(res[nan_arg], np.nan)

    a, b = dist.support()
    a = np.broadcast_to(a, res.shape)
    b = np.broadcast_to(b, res.shape)

    outside_arg_minus = (outside_arg == -1) & valid_parameters
    outside_arg_plus = (outside_arg == 1) & valid_parameters
    endpoint_arg_minus = (endpoint_arg == -1) & valid_parameters
    endpoint_arg_plus = (endpoint_arg == 1) & valid_parameters

    is_discrete = isinstance(dist, DiscreteDistribution)
    # Writing this independently of how the are set in the distribution
    # infrastructure. That is very compact; this is very verbose.
    if fname in {'logpdf'}:
        assert_equal(res[outside_arg_minus], -np.inf)
        assert_equal(res[outside_arg_plus], -np.inf)
        ref = -np.inf if not is_discrete else np.inf
        assert_equal(res[endpoint_arg_minus & ~valid_arg], ref)
        assert_equal(res[endpoint_arg_plus & ~valid_arg], ref)
    elif fname in {'pdf'}:
        assert_equal(res[outside_arg_minus], 0)
        assert_equal(res[outside_arg_plus], 0)
        ref = 0 if not is_discrete else np.inf
        assert_equal(res[endpoint_arg_minus & ~valid_arg], ref)
        assert_equal(res[endpoint_arg_plus & ~valid_arg], ref)
    elif fname in {'logcdf'} and not is_discrete:
        assert_equal(res[outside_arg_minus], -inf)
        assert_equal(res[outside_arg_plus], 0)
        assert_equal(res[endpoint_arg_minus], -inf)
        assert_equal(res[endpoint_arg_plus], 0)
    elif fname in {'cdf'} and not is_discrete:
        assert_equal(res[outside_arg_minus], 0)
        assert_equal(res[outside_arg_plus], 1)
        assert_equal(res[endpoint_arg_minus], 0)
        assert_equal(res[endpoint_arg_plus], 1)
    elif fname in {'logccdf'} and not is_discrete:
        assert_equal(res[outside_arg_minus], 0)
        assert_equal(res[outside_arg_plus], -inf)
        assert_equal(res[endpoint_arg_minus], 0)
        assert_equal(res[endpoint_arg_plus], -inf)
    elif fname in {'ccdf'} and not is_discrete:
        assert_equal(res[outside_arg_minus], 1)
        assert_equal(res[outside_arg_plus], 0)
        assert_equal(res[endpoint_arg_minus], 1)
        assert_equal(res[endpoint_arg_plus], 0)
    elif fname in {'ilogcdf', 'icdf'} and not is_discrete:
        assert_equal(res[outside_arg == -1], np.nan)
        assert_equal(res[outside_arg == 1], np.nan)
        assert_equal(res[endpoint_arg == -1], a[endpoint_arg == -1])
        assert_equal(res[endpoint_arg == 1], b[endpoint_arg == 1])
    elif fname in {'ilogccdf', 'iccdf'} and not is_discrete:
        assert_equal(res[outside_arg == -1], np.nan)
        assert_equal(res[outside_arg == 1], np.nan)
        assert_equal(res[endpoint_arg == -1], b[endpoint_arg == -1])
        assert_equal(res[endpoint_arg == 1], a[endpoint_arg == 1])

    exclude = {'logmean', 'mean', 'logskewness', 'skewness', 'support'}
    if isinstance(dist, DiscreteDistribution):
        exclude.update({'pdf', 'logpdf'})

    if (
            fname not in exclude
            and not (isinstance(dist, Binomial)
                     and np.any((dist.n == 0) | (dist.p == 0) | (dist.p == 1)))):
        # This can fail in degenerate case where Binomial distribution is a point
        # distribution. Further on, we could factor out an is_degenerate function
        # for the tests, or think about storing info about degeneracy in the
        # instances.
        assert np.isfinite(res[all_valid & (endpoint_arg == 0)]).all()


def check_moment_funcs(dist, result_shape):
    # Check that all computation methods of all distribution functions agree
    # with one another, effectively testing the correctness of the generic
    # computation methods and confirming the consistency of specific
    # distributions with their pdf/logpdf.

    atol = 1e-9  # make this tighter (e.g. 1e-13) after fixing `draw`

    def check(order, kind, method=None, ref=None, success=True):
        if success:
            res = dist.moment(order, kind, method=method)
            assert_allclose(res, ref, atol=atol*10**order)
            assert res.shape == ref.shape
        else:
            with pytest.raises(NotImplementedError):
                dist.moment(order, kind, method=method)

    def has_formula(order, kind):
        formula_name = f'_moment_{kind}_formula'
        overrides = dist._overrides(formula_name)
        if not overrides:
            return False
        formula = getattr(dist, formula_name)
        orders = getattr(formula, 'orders', set(range(6)))
        return order in orders

    dist.reset_cache()

    ### Check Raw Moments ###
    for i in range(6):
        check(i, 'raw', 'cache', success=False)  # not cached yet
        ref = dist.moment(i, 'raw', method='quadrature')
        check_nans_and_edges(dist, 'moment', None, ref)
        assert ref.shape == result_shape
        check(i, 'raw','cache', ref, success=True)  # cached now
        check(i, 'raw', 'formula', ref, success=has_formula(i, 'raw'))
        check(i, 'raw', 'general', ref, success=(i == 0))
        if dist.__class__ == stats.Normal:
            check(i, 'raw', 'quadrature_icdf', ref, success=True)


    # Clearing caches to better check their behavior
    dist.reset_cache()

    # If we have central or standard moment formulas, or if there are
    # values in their cache, we can use method='transform'
    dist.moment(0, 'central')  # build up the cache
    dist.moment(1, 'central')
    for i in range(2, 6):
        ref = dist.moment(i, 'raw', method='quadrature')
        check(i, 'raw', 'transform', ref,
              success=has_formula(i, 'central') or has_formula(i, 'standardized'))
        dist.moment(i, 'central')  # build up the cache
        check(i, 'raw', 'transform', ref)

    dist.reset_cache()

    ### Check Central Moments ###

    for i in range(6):
        check(i, 'central', 'cache', success=False)
        ref = dist.moment(i, 'central', method='quadrature')
        assert ref.shape == result_shape
        check(i, 'central', 'cache', ref, success=True)
        check(i, 'central', 'formula', ref, success=has_formula(i, 'central'))
        check(i, 'central', 'general', ref, success=i <= 1)
        if dist.__class__ == stats.Normal:
            check(i, 'central', 'quadrature_icdf', ref, success=True)
        if not (dist.__class__ == stats.Uniform and i == 5):
            # Quadrature is not super accurate for 5th central moment when the
            # support is really big. Skip this one failing test. We need to come
            # up with a better system of skipping individual failures w/ hypothesis.
            check(i, 'central', 'transform', ref,
                  success=has_formula(i, 'raw') or (i <= 1))
        if not has_formula(i, 'raw'):
            dist.moment(i, 'raw')
            check(i, 'central', 'transform', ref)

    variance = dist.variance()
    dist.reset_cache()

    # If we have standard moment formulas, or if there are
    # values in their cache, we can use method='normalize'
    dist.moment(0, 'standardized')  # build up the cache
    dist.moment(1, 'standardized')
    dist.moment(2, 'standardized')
    for i in range(3, 6):
        ref = dist.moment(i, 'central', method='quadrature')
        check(i, 'central', 'normalize', ref,
              success=has_formula(i, 'standardized') and not np.any(variance == 0))
        dist.moment(i, 'standardized')  # build up the cache
        check(i, 'central', 'normalize', ref, success=not np.any(variance == 0))

    ### Check Standardized Moments ###

    var = dist.moment(2, 'central', method='quadrature')
    dist.reset_cache()

    for i in range(6):
        check(i, 'standardized', 'cache', success=False)
        ref = dist.moment(i, 'central', method='quadrature') / var ** (i / 2)
        assert ref.shape == result_shape
        check(i, 'standardized', 'formula', ref,
              success=has_formula(i, 'standardized'))
        if not (
                isinstance(dist, Binomial)
                and np.any((dist.n == 0) | (dist.p == 0) | (dist.p == 1))
        ):
            # This test will fail for degenerate case where binomial distribution
            # is a point distribution.
            check(i, 'standardized', 'general', ref, success=i <= 2)
        check(i, 'standardized', 'normalize', ref)

    if isinstance(dist, ShiftedScaledDistribution):
        # logmoment is not fully fleshed out; no need to test
        # ShiftedScaledDistribution here
        return

    # logmoment is not very accuate, and it's not public, so skip for now
    # ### Check Against _logmoment ###
    # logmean = dist._logmoment(1, logcenter=-np.inf)
    # for i in range(6):
    #     ref = np.exp(dist._logmoment(i, logcenter=-np.inf))
    #     assert_allclose(dist.moment(i, 'raw'), ref, atol=atol*10**i)
    #
    #     ref = np.exp(dist._logmoment(i, logcenter=logmean))
    #     assert_allclose(dist.moment(i, 'central'), ref, atol=atol*10**i)
    #
    #     ref = np.exp(dist._logmoment(i, logcenter=logmean, standardized=True))
    #     assert_allclose(dist.moment(i, 'standardized'), ref, atol=atol*10**i)


@pytest.mark.parametrize('family', (Normal,))
@pytest.mark.parametrize('x_shape', [tuple(), (2, 3)])
@pytest.mark.parametrize('dist_shape', [tuple(), (4, 1)])
@pytest.mark.parametrize('fname', ['sample'])
@pytest.mark.parametrize('rng_type', [np.random.Generator, qmc.Halton, qmc.Sobol])
def test_sample_against_cdf(family, dist_shape, x_shape, fname, rng_type):
    rng = np.random.default_rng(842582438235635)
    num_parameters = family._num_parameters()

    if dist_shape and num_parameters == 0:
        pytest.skip("Distribution can't have a shape without parameters.")

    dist = family._draw(dist_shape, rng)

    n = 1024
    sample_size = (n,) + x_shape
    sample_array_shape = sample_size + dist_shape

    if fname == 'sample':
        sample_method = dist.sample

    if rng_type != np.random.Generator:
        rng = rng_type(d=1, seed=rng)
    x = sample_method(sample_size, rng=rng)
    assert x.shape == sample_array_shape

    # probably should give `axis` argument to ks_1samp, review that separately
    statistic = _kolmogorov_smirnov(dist, x, axis=0)
    pvalue = kolmogn(x.shape[0], statistic, cdf=False)
    p_threshold = 0.01
    num_pvalues = pvalue.size
    num_small_pvalues = np.sum(pvalue < p_threshold)
    assert num_small_pvalues < p_threshold * num_pvalues


def get_valid_parameters(dist):
    # Given a distribution, return a logical array that is true where all
    # distribution parameters are within their respective domains. The code
    # here is probably quite similar to that used to form the `_invalid`
    # attribute of the distribution, but this was written about a week later
    # without referring to that code, so it is a somewhat independent check.

    # Get all parameter values and `_Parameter` objects
    parameter_values = dist._parameters
    parameters = {}
    for parameterization in dist._parameterizations:
        parameters.update(parameterization.parameters)

    all_valid = np.ones(dist._shape, dtype=bool)
    for name, value in parameter_values.items():
        if name not in parameters:  # cached value not part of parameterization
            continue
        parameter = parameters[name]

        # Check that the numerical endpoints and inclusivity attribute
        # agree with the `contains` method about which parameter values are
        # within the domain.
        a, b = parameter.domain.get_numerical_endpoints(
            parameter_values=parameter_values)
        a_included, b_included = parameter.domain.inclusive
        valid = (a <= value) if a_included else a < value
        valid &= (value <= b) if b_included else value < b
        assert_equal(valid, parameter.domain.contains(
            value, parameter_values=parameter_values))

        # Form `all_valid` mask that is True where *all* parameters are valid
        all_valid &= valid

    # Check that the `all_valid` mask formed here is the complement of the
    # `dist._invalid` mask stored by the infrastructure
    assert_equal(~all_valid, dist._invalid)

    return all_valid

def classify_arg(dist, arg, arg_domain):
    if arg is None:
        valid_args = np.ones(dist._shape, dtype=bool)
        endpoint_args = np.zeros(dist._shape, dtype=bool)
        outside_args = np.zeros(dist._shape, dtype=bool)
        nan_args = np.zeros(dist._shape, dtype=bool)
        return valid_args, endpoint_args, outside_args, nan_args

    a, b = arg_domain.get_numerical_endpoints(
        parameter_values=dist._parameters)

    a, b, arg = np.broadcast_arrays(a, b, arg)
    a_included, b_included = arg_domain.inclusive

    inside = (a <= arg) if a_included else a < arg
    inside &= (arg <= b) if b_included else arg < b
    # TODO: add `supported` method and check here
    on = np.zeros(a.shape, dtype=int)
    on[a == arg] = -1
    on[b == arg] = 1
    outside = np.zeros(a.shape, dtype=int)
    outside[(arg < a) if a_included else arg <= a] = -1
    outside[(b < arg) if b_included else b <= arg] = 1
    nan = np.isnan(arg)

    return inside, on, outside, nan


def test_input_validation():
    class Test(ContinuousDistribution):
        _variable = _RealParameter('x', domain=_RealInterval())

    message = ("The `Test` distribution family does not accept parameters, "
               "but parameters `{'a'}` were provided.")
    with pytest.raises(ValueError, match=message):
        Test(a=1, )

    message = "Attribute `tol` of `Test` must be a positive float, if specified."
    with pytest.raises(ValueError, match=message):
        Test(tol=np.asarray([]))
    with pytest.raises(ValueError, match=message):
        Test(tol=[1, 2, 3])
    with pytest.raises(ValueError, match=message):
        Test(tol=np.nan)
    with pytest.raises(ValueError, match=message):
        Test(tol=-1)

    message = ("Argument `order` of `Test.moment` must be a "
               "finite, positive integer.")
    with pytest.raises(ValueError, match=message):
        Test().moment(-1)
    with pytest.raises(ValueError, match=message):
        Test().moment(np.inf)

    message = "Argument `kind` of `Test.moment` must be one of..."
    with pytest.raises(ValueError, match=message):
        Test().moment(2, kind='coconut')

    class Test2(ContinuousDistribution):
        _p1 = _RealParameter('c', domain=_RealInterval())
        _p2 = _RealParameter('d', domain=_RealInterval())
        _parameterizations = [_Parameterization(_p1, _p2)]
        _variable = _RealParameter('x', domain=_RealInterval())

    message = ("The provided parameters `{a}` do not match a supported "
               "parameterization of the `Test2` distribution family.")
    with pytest.raises(ValueError, match=message):
        Test2(a=1)

    message = ("The `Test2` distribution family requires parameters, but none "
               "were provided.")
    with pytest.raises(ValueError, match=message):
        Test2()

    message = ("The parameters `{c, d}` provided to the `Test2` "
               "distribution family cannot be broadcast to the same shape.")
    with pytest.raises(ValueError, match=message):
        Test2(c=[1, 2], d=[1, 2, 3])

    message = ("The argument provided to `Test2.pdf` cannot be be broadcast to "
              "the same shape as the distribution parameters.")
    with pytest.raises(ValueError, match=message):
        dist = Test2(c=[1, 2, 3], d=[1, 2, 3])
        dist.pdf([1, 2])

    message = "Parameter `c` must be of real dtype."
    with pytest.raises(TypeError, match=message):
        Test2(c=[1, object()], d=[1, 2])

    message = "Parameter `convention` of `Test2.kurtosis` must be one of..."
    with pytest.raises(ValueError, match=message):
        dist = Test2(c=[1, 2, 3], d=[1, 2, 3])
        dist.kurtosis(convention='coconut')


def test_rng_deepcopy_pickle():
    # test behavior of `rng` attribute and copy behavior
    kwargs = dict(a=[-1, 2], b=10)
    dist1 = Uniform(**kwargs)
    dist2 = deepcopy(dist1)
    dist3 = pickle.loads(pickle.dumps(dist1))

    res1, res2, res3 = dist1.sample(), dist2.sample(), dist3.sample()
    assert np.all(res2 != res1)
    assert np.all(res3 != res1)

    res1, res2, res3 = dist1.sample(rng=42), dist2.sample(rng=42), dist3.sample(rng=42)
    assert np.all(res2 == res1)
    assert np.all(res3 == res1)


class TestAttributes:
    def test_cache_policy(self):
        dist = StandardNormal(cache_policy="no_cache")
        # make error message more appropriate
        message = "`StandardNormal` does not provide an accurate implementation of the "
        with pytest.raises(NotImplementedError, match=message):
            dist.mean(method='cache')
        mean = dist.mean()
        with pytest.raises(NotImplementedError, match=message):
            dist.mean(method='cache')

        # add to enum
        dist.cache_policy = None
        with pytest.raises(NotImplementedError, match=message):
            dist.mean(method='cache')
        mean = dist.mean()  # method is 'formula' by default
        cached_mean = dist.mean(method='cache')
        assert_equal(cached_mean, mean)

        # cache is overridden by latest evaluation
        quadrature_mean = dist.mean(method='quadrature')
        cached_mean = dist.mean(method='cache')
        assert_equal(cached_mean, quadrature_mean)
        assert not np.all(mean == quadrature_mean)

        # We can turn the cache off, and it won't change, but the old cache is
        # still available
        dist.cache_policy = "no_cache"
        mean = dist.mean(method='formula')
        cached_mean = dist.mean(method='cache')
        assert_equal(cached_mean, quadrature_mean)
        assert not np.all(mean == quadrature_mean)

        dist.reset_cache()
        with pytest.raises(NotImplementedError, match=message):
            dist.mean(method='cache')

        message = "Attribute `cache_policy` of `StandardNormal`..."
        with pytest.raises(ValueError, match=message):
            dist.cache_policy = "invalid"

    def test_tol(self):
        x = 3.
        X = stats.Normal()

        message = "Attribute `tol` of `StandardNormal` must..."
        with pytest.raises(ValueError, match=message):
            X.tol = -1.
        with pytest.raises(ValueError, match=message):
            X.tol = (0.1,)
        with pytest.raises(ValueError, match=message):
            X.tol = np.nan

        X1 = stats.Normal(tol=1e-1)
        X2 = stats.Normal(tol=1e-12)
        ref = X.cdf(x)
        res1 = X1.cdf(x, method='quadrature')
        res2 = X2.cdf(x, method='quadrature')
        assert_allclose(res1, ref, rtol=X1.tol)
        assert_allclose(res2, ref, rtol=X2.tol)
        assert abs(res1 - ref) > abs(res2 - ref)

        p = 0.99
        X1.tol, X2.tol = X2.tol, X1.tol
        ref = X.icdf(p)
        res1 = X1.icdf(p, method='inversion')
        res2 = X2.icdf(p, method='inversion')
        assert_allclose(res1, ref, rtol=X1.tol)
        assert_allclose(res2, ref, rtol=X2.tol)
        assert abs(res2 - ref) > abs(res1 - ref)

    def test_iv_policy(self):
        X = Uniform(a=0, b=1)
        assert X.pdf(2) == 0

        X.validation_policy = 'skip_all'
        assert X.pdf(np.asarray(2.)) == 1

        # Tests _set_invalid_nan
        a, b = np.asarray(1.), np.asarray(0.)  # invalid parameters
        X = Uniform(a=a, b=b, validation_policy='skip_all')
        assert X.pdf(np.asarray(2.)) == -1

        # Tests _set_invalid_nan_property
        class MyUniform(Uniform):
            def _entropy_formula(self, *args, **kwargs):
                return 'incorrect'

            def _moment_raw_formula(self, order, **params):
                return 'incorrect'

        X = MyUniform(a=a, b=b, validation_policy='skip_all')
        assert X.entropy() == 'incorrect'

        # Tests _validate_order_kind
        assert X.moment(kind='raw', order=-1) == 'incorrect'

        # Test input validation
        message = "Attribute `validation_policy` of `MyUniform`..."
        with pytest.raises(ValueError, match=message):
            X.validation_policy = "invalid"

    def test_shapes(self):
        X = stats.Normal(mu=1, sigma=2)
        Y = stats.Normal(mu=[2], sigma=3)

        # Check that attributes are available as expected
        assert X.mu == 1
        assert X.sigma == 2
        assert Y.mu[0] == 2
        assert Y.sigma[0] == 3

        # Trying to set an attribute raises
        # message depends on Python version
        with pytest.raises(AttributeError):
            X.mu = 2

        # Trying to mutate an attribute really mutates a copy
        Y.mu[0] = 10
        assert Y.mu[0] == 2


class TestMakeDistribution:
    @pytest.mark.parametrize('i, distdata', enumerate(distcont + distdiscrete))
    def test_rv_generic(self, i, distdata):
        distname = distdata[0]

        slow = {'argus', 'exponpow', 'exponweib', 'genexpon', 'gompertz', 'halfgennorm',
                'johnsonsb', 'kappa4', 'ksone', 'kstwo', 'kstwobign', 'norminvgauss',
                'powerlognorm', 'powernorm', 'recipinvgauss', 'studentized_range',
                'vonmises_line', # continuous
                'betanbinom', 'logser', 'skellam', 'zipf'}  # discrete
        if not int(os.environ.get('SCIPY_XSLOW', '0')) and distname in slow:
            pytest.skip('Skipping as XSLOW')

        if distname in {              # skip these distributions
            'levy_stable',            # private methods seem to require >= 1d args
            'vonmises',               # circular distribution; shouldn't work
            'poisson_binom',          # vector shape parameter
            'hypergeom',              # distribution functions need interpolation
            'nchypergeom_fisher',     # distribution functions need interpolation
            'nchypergeom_wallenius',  # distribution functions need interpolation
        }:
            return

        # skip single test, mostly due to slight disagreement
        custom_tolerances = {'ksone': 1e-5, 'kstwo': 1e-5}  # discontinuous PDF
        skip_entropy = {'kstwobign', 'pearson3'}  # tolerance issue
        skip_skewness = {'exponpow', 'ksone', 'nchypergeom_wallenius'}  # tolerance
        skip_kurtosis = {'chi', 'exponpow', 'invgamma',  # tolerance
                         'johnsonsb', 'ksone', 'kstwo',  # tolerance
                         'nchypergeom_wallenius'}  # tolerance
        skip_logccdf = {'arcsine', 'skewcauchy', 'trapezoid', 'triang'}  # tolerance
        skip_raw = {2: {'alpha', 'foldcauchy', 'halfcauchy', 'levy', 'levy_l'},
                    3: {'pareto'},  # stats.pareto is just wrong
                    4: {'invgamma'}}  # tolerance issue
        skip_standardized = {'exponpow', 'ksone'}  # tolerances

        dist = getattr(stats, distname)
        params = dict(zip(dist.shapes.split(', '), distdata[1])) if dist.shapes else {}
        rng = np.random.default_rng(7548723590230982)
        CustomDistribution = stats.make_distribution(dist)
        X = CustomDistribution(**params)
        Y = dist(**params)
        x = X.sample(shape=10, rng=rng)
        p = X.cdf(x)
        rtol = custom_tolerances.get(distname, 1e-7)
        atol = 1e-12

        with np.errstate(divide='ignore', invalid='ignore'):
            m, v, s, k = Y.stats('mvsk')
            assert_allclose(X.support(), Y.support())
            if distname not in skip_entropy:
                assert_allclose(X.entropy(), Y.entropy(), rtol=rtol)
            if isinstance(Y, stats.rv_discrete):
                # some continuous distributions have trouble with `logentropy` because
                # it uses complex numbers
                assert_allclose(np.exp(X.logentropy()), Y.entropy(), rtol=rtol)
            assert_allclose(X.median(), Y.median(), rtol=rtol)
            assert_allclose(X.mean(), m, rtol=rtol, atol=atol)
            assert_allclose(X.variance(), v, rtol=rtol, atol=atol)
            if distname not in skip_skewness:
                assert_allclose(X.skewness(), s, rtol=rtol, atol=atol)
            if distname not in skip_kurtosis:
                assert_allclose(X.kurtosis(convention='excess'), k,
                                rtol=rtol, atol=atol)
            if isinstance(dist, stats.rv_continuous):
                assert_allclose(X.logpdf(x), Y.logpdf(x), rtol=rtol)
                assert_allclose(X.pdf(x), Y.pdf(x), rtol=rtol)
            else:
                assert_allclose(X.logpmf(x), Y.logpmf(x), rtol=rtol)
                assert_allclose(X.pmf(x), Y.pmf(x), rtol=rtol)
            assert_allclose(X.logcdf(x), Y.logcdf(x), rtol=rtol)
            assert_allclose(X.cdf(x), Y.cdf(x), rtol=rtol)
            if distname not in skip_logccdf:
                assert_allclose(X.logccdf(x), Y.logsf(x), rtol=rtol)
            assert_allclose(X.ccdf(x), Y.sf(x), rtol=rtol)

            # old infrastructure convention for ppf(p=0) and isf(p=1) is different than
            # new infrastructure. Adjust reference values accordingly.
            a, _ = Y.support()
            ref_ppf = Y.ppf(p)
            ref_ppf[p == 0] = a
            ref_isf = Y.isf(p)
            ref_isf[p == 1] = a

            assert_allclose(X.icdf(p), ref_ppf, rtol=rtol)
            assert_allclose(X.iccdf(p), ref_isf, rtol=rtol)

            for order in range(5):
                if distname not in skip_raw.get(order, {}):
                    assert_allclose(X.moment(order, kind='raw'),
                                    Y.moment(order), rtol=rtol, atol=atol)
            for order in range(3, 4):
                if distname not in skip_standardized:
                    assert_allclose(X.moment(order, kind='standardized'),
                                    Y.stats('mvsk'[order-1]), rtol=rtol, atol=atol)
            if isinstance(dist, stats.rv_continuous):
                # For discrete distributions, these won't agree at the far left end
                # of the support, and the new infrastructure is slow there (for now).
                seed = 845298245687345
                assert_allclose(X.sample(shape=10, rng=seed),
                                Y.rvs(size=10,
                                      random_state=np.random.default_rng(seed)),
                                rtol=rtol)

    def test_custom(self):
        rng = np.random.default_rng(7548723590230982)

        class MyLogUniform:
            @property
            def __make_distribution_version__(self):
                return "1.16.0"

            @property
            def parameters(self):
                return {'a': {'endpoints': (0, np.inf), 'inclusive': (False, False)},
                        'b': {'endpoints': ('a', np.inf), 'inclusive': (False, False)}}

            @property
            def support(self):
                return {'endpoints': ('a', 'b')}

            def pdf(self, x, a, b):
                return 1 / (x * (np.log(b) - np.log(a)))

            def sample(self, shape, *, a, b, rng=None):
                p = rng.uniform(size=shape)
                return np.exp(np.log(a) + p * (np.log(b) - np.log(a)))

            def moment(self, order, kind='raw', *, a, b):
                if order == 1 and kind == 'raw':
                    # quadrature is perfectly accurate here; add 1e-10 error so we
                    # can tell the difference between the two
                    return (b - a) / np.log(b/a) + 1e-10

        LogUniform = stats.make_distribution(MyLogUniform())

        X = LogUniform(a=np.exp(1), b=np.exp(3))
        Y = stats.exp(Uniform(a=1., b=3.))
        x = X.sample(shape=10, rng=rng)
        p = X.cdf(x)

        assert_allclose(X.support(), Y.support())
        assert_allclose(X.entropy(), Y.entropy())
        assert_allclose(X.median(), Y.median())
        assert_allclose(X.logpdf(x), Y.logpdf(x))
        assert_allclose(X.pdf(x), Y.pdf(x))
        assert_allclose(X.logcdf(x), Y.logcdf(x))
        assert_allclose(X.cdf(x), Y.cdf(x))
        assert_allclose(X.logccdf(x), Y.logccdf(x))
        assert_allclose(X.ccdf(x), Y.ccdf(x))
        assert_allclose(X.icdf(p), Y.icdf(p))
        assert_allclose(X.iccdf(p), Y.iccdf(p))
        for kind in ['raw', 'central', 'standardized']:
            for order in range(5):
                assert_allclose(X.moment(order, kind=kind),
                                Y.moment(order, kind=kind))

        # Confirm that the `sample` and `moment` methods are overriden as expected
        sample_formula = X.sample(shape=10, rng=0, method='formula')
        sample_inverse = X.sample(shape=10, rng=0, method='inverse_transform')
        assert_allclose(sample_formula, sample_inverse)
        assert not np.all(sample_formula == sample_inverse)

        assert_allclose(X.mean(method='formula'), X.mean(method='quadrature'))
        assert not X.mean(method='formula') == X.mean(method='quadrature')

    # pdf and cdf formulas below can warn on boundary of support in some cases.
    # See https://github.com/scipy/scipy/pull/22560#discussion_r1962763840.
    @pytest.mark.slow
    @pytest.mark.filterwarnings("ignore::RuntimeWarning")
    @pytest.mark.parametrize("c", [-1, 0, 1, np.asarray([-2.1, -1., 0., 1., 2.1])])
    def test_custom_variable_support(self, c):
        rng = np.random.default_rng(7548723590230982)

        class MyGenExtreme:
            @property
            def __make_distribution_version__(self):
                return "1.16.0"

            @property
            def parameters(self):
                return {
                    'c': {'endpoints': (-np.inf, np.inf), 'inclusive': (False, False)},
                    'mu': {'endpoints': (-np.inf, np.inf), 'inclusive': (False, False)},
                    'sigma': {'endpoints': (0, np.inf), 'inclusive': (False, False)}
                }

            @property
            def support(self):
                def left(*, c, mu, sigma):
                    c, mu, sigma = np.broadcast_arrays(c, mu, sigma)
                    result = np.empty_like(c)
                    result[c >= 0] = -np.inf
                    result[c < 0] = mu[c < 0] + sigma[c < 0] / c[c < 0]
                    return result[()]

                def right(*, c, mu, sigma):
                    c, mu, sigma = np.broadcast_arrays(c, mu, sigma)
                    result = np.empty_like(c)
                    result[c <= 0] = np.inf
                    result[c > 0] = mu[c > 0] + sigma[c > 0] / c[c > 0]
                    return result[()]

                return {"endpoints": (left, right), "inclusive": (False, False)}

            def pdf(self, x, *, c, mu, sigma):
                x, c, mu, sigma = np.broadcast_arrays(x, c, mu, sigma)
                t = np.empty_like(x)
                mask = (c == 0)
                t[mask] = np.exp(-(x[mask] - mu[mask])/sigma[mask])
                t[~mask] = (
                    1  - c[~mask]*(x[~mask] - mu[~mask])/sigma[~mask]
                )**(1/c[~mask])
                result = 1/sigma * t**(1 - c)*np.exp(-t)
                return result[()]

            def cdf(self, x, *, c, mu, sigma):
                x, c, mu, sigma = np.broadcast_arrays(x, c, mu, sigma)
                t = np.empty_like(x)
                mask = (c == 0)
                t[mask] = np.exp(-(x[mask] - mu[mask])/sigma[mask])
                t[~mask] = (
                    1  - c[~mask]*(x[~mask] - mu[~mask])/sigma[~mask]
                )**(1/c[~mask])
                return np.exp(-t)[()]

        GenExtreme1 = stats.make_distribution(MyGenExtreme())
        GenExtreme2 = stats.make_distribution(stats.genextreme)

        X1 = GenExtreme1(c=c, mu=0, sigma=1)
        X2 = GenExtreme2(c=c)

        x = X1.sample(shape=10, rng=rng)
        p = X1.cdf(x)

        assert_allclose(X1.support(), X2.support())
        assert_allclose(X1.entropy(), X2.entropy(), rtol=5e-6)
        assert_allclose(X1.median(), X2.median())
        assert_allclose(X1.logpdf(x), X2.logpdf(x))
        assert_allclose(X1.pdf(x), X2.pdf(x))
        assert_allclose(X1.logcdf(x), X2.logcdf(x))
        assert_allclose(X1.cdf(x), X2.cdf(x))
        assert_allclose(X1.logccdf(x), X2.logccdf(x))
        assert_allclose(X1.ccdf(x), X2.ccdf(x))
        assert_allclose(X1.icdf(p), X2.icdf(p))
        assert_allclose(X1.iccdf(p), X2.iccdf(p))

    @pytest.mark.slow
    @pytest.mark.parametrize("a", [0.5, np.asarray([0.5, 1.0, 2.0, 4.0, 8.0])])
    @pytest.mark.parametrize("b", [0.5, np.asarray([0.5, 1.0, 2.0, 4.0, 8.0])])
    def test_custom_multiple_parameterizations(self, a, b):
        rng = np.random.default_rng(7548723590230982)
        class MyBeta:
            @property
            def __make_distribution_version__(self):
                return "1.16.0"

            @property
            def parameters(self):
                return (
                    {"a": (0, np.inf), "b": (0, np.inf)},
                    {"mu": (0, 1), "nu": (0, np.inf)},
                )

            def process_parameters(self, a=None, b=None, mu=None, nu=None):
                if a is not None and b is not None and mu is None and nu is None:
                    nu = a + b
                    mu = a / nu
                else:
                    a = mu * nu
                    b = nu - a
                return {"a": a, "b": b, "mu": mu, "nu": nu}

            @property
            def support(self):
                return {'endpoints': (0, 1)}

            def pdf(self, x, a, b, mu, nu):
                return special._ufuncs._beta_pdf(x, a, b)

            def cdf(self, x, a, b, mu, nu):
                return special.betainc(a, b, x)

        Beta = stats.make_distribution(stats.beta)
        MyBeta = stats.make_distribution(MyBeta())

        mu = a / (a + b)
        nu = a + b

        X = MyBeta(a=a, b=b)
        Y = MyBeta(mu=mu, nu=nu)
        Z = Beta(a=a, b=b)

        x = Z.sample(shape=10, rng=rng)
        p = Z.cdf(x)

        assert_allclose(X.support(), Z.support())
        assert_allclose(X.median(), Z.median())
        assert_allclose(X.pdf(x), Z.pdf(x))
        assert_allclose(X.cdf(x), Z.cdf(x))
        assert_allclose(X.ccdf(x), Z.ccdf(x))
        assert_allclose(X.icdf(p), Z.icdf(p))
        assert_allclose(X.iccdf(p), Z.iccdf(p))

        assert_allclose(Y.support(), Z.support())
        assert_allclose(Y.median(), Z.median())
        assert_allclose(Y.pdf(x), Z.pdf(x))
        assert_allclose(Y.cdf(x), Z.cdf(x))
        assert_allclose(Y.ccdf(x), Z.ccdf(x))
        assert_allclose(Y.icdf(p), Z.icdf(p))
        assert_allclose(Y.iccdf(p), Z.iccdf(p))

    def test_input_validation(self):
        message = '`levy_stable` is not supported.'
        with pytest.raises(NotImplementedError, match=message):
            stats.make_distribution(stats.levy_stable)

        message = '`vonmises` is not supported.'
        with pytest.raises(NotImplementedError, match=message):
            stats.make_distribution(stats.vonmises)

        message = "The argument must be an instance of..."
        with pytest.raises(ValueError, match=message):
            stats.make_distribution(object())

    def test_repr_str_docs(self):
        from scipy.stats._distribution_infrastructure import _distribution_names
        for dist in _distribution_names.keys():
            assert hasattr(stats, dist)

        dist = stats.make_distribution(stats.gamma)
        assert str(dist(a=2)) == "Gamma(a=2.0)"
        if np.__version__ >= "2":
            assert repr(dist(a=2)) == "Gamma(a=np.float64(2.0))"
        assert 'Gamma' in dist.__doc__

        dist = stats.make_distribution(stats.halfgennorm)
        assert str(dist(beta=2)) == "HalfGeneralizedNormal(beta=2.0)"
        if np.__version__ >= "2":
            assert repr(dist(beta=2)) == "HalfGeneralizedNormal(beta=np.float64(2.0))"
        assert 'HalfGeneralizedNormal' in dist.__doc__


class TestTransforms:

    def test_ContinuousDistribution_only(self):
        X = stats.Binomial(n=10, p=0.5)
        # This is applied at the top level TransformedDistribution,
        # so testing one subclass is enough
        message = "Transformations are currently only supported for continuous RVs."
        with pytest.raises(NotImplementedError, match=message):
            stats.exp(X)

    def test_truncate(self):
        rng = np.random.default_rng(81345982345826)
        lb = rng.random((3, 1))
        ub = rng.random((3, 1))
        lb, ub = np.minimum(lb, ub), np.maximum(lb, ub)

        Y = stats.truncate(Normal(), lb=lb, ub=ub)
        Y0 = stats.truncnorm(lb, ub)

        y = Y0.rvs((3, 10), random_state=rng)
        p = Y0.cdf(y)

        assert_allclose(Y.logentropy(), np.log(Y0.entropy() + 0j))
        assert_allclose(Y.entropy(), Y0.entropy())
        assert_allclose(Y.median(), Y0.ppf(0.5))
        assert_allclose(Y.mean(), Y0.mean())
        assert_allclose(Y.variance(), Y0.var())
        assert_allclose(Y.standard_deviation(), np.sqrt(Y0.var()))
        assert_allclose(Y.skewness(), Y0.stats('s'))
        assert_allclose(Y.kurtosis(), Y0.stats('k') + 3)
        assert_allclose(Y.support(), Y0.support())
        assert_allclose(Y.pdf(y), Y0.pdf(y))
        assert_allclose(Y.cdf(y), Y0.cdf(y))
        assert_allclose(Y.ccdf(y), Y0.sf(y))
        assert_allclose(Y.icdf(p), Y0.ppf(p))
        assert_allclose(Y.iccdf(p), Y0.isf(p))
        assert_allclose(Y.logpdf(y), Y0.logpdf(y))
        assert_allclose(Y.logcdf(y), Y0.logcdf(y))
        assert_allclose(Y.logccdf(y), Y0.logsf(y))
        assert_allclose(Y.ilogcdf(np.log(p)), Y0.ppf(p))
        assert_allclose(Y.ilogccdf(np.log(p)), Y0.isf(p))
        sample = Y.sample(10)
        assert np.all((sample > lb) & (sample < ub))

    @pytest.mark.fail_slow(10)
    @given(data=strategies.data(), seed=strategies.integers(min_value=0))
    @pytest.mark.thread_unsafe
    def test_loc_scale(self, data, seed):
        # Need tests with negative scale
        rng = np.random.default_rng(seed)

        class TransformedNormal(ShiftedScaledDistribution):
            def __init__(self, *args, **kwargs):
                super().__init__(StandardNormal(), *args, **kwargs)

        tmp = draw_distribution_from_family(
            TransformedNormal, data, rng, proportions=(1, 0, 0, 0), min_side=1)
        dist, x, y, p, logp, result_shape, x_result_shape, xy_result_shape = tmp

        loc = dist.loc
        scale = dist.scale
        dist0 = StandardNormal()
        dist_ref = stats.norm(loc=loc, scale=scale)

        x0 = (x - loc) / scale
        y0 = (y - loc) / scale

        a, b = dist.support()
        a0, b0 = dist0.support()
        assert_allclose(a, a0 + loc)
        assert_allclose(b, b0 + loc)

        with np.errstate(invalid='ignore', divide='ignore'):
            assert_allclose(np.exp(dist.logentropy()), dist.entropy())
            assert_allclose(dist.entropy(), dist_ref.entropy())
            assert_allclose(dist.median(), dist0.median() + loc)
            assert_allclose(dist.mode(), dist0.mode() + loc)
            assert_allclose(dist.mean(), dist0.mean() + loc)
            assert_allclose(dist.variance(), dist0.variance() * scale**2)
            assert_allclose(dist.standard_deviation(), dist.variance()**0.5)
            assert_allclose(dist.skewness(), dist0.skewness() * np.sign(scale))
            assert_allclose(dist.kurtosis(), dist0.kurtosis())
            assert_allclose(dist.logpdf(x), dist0.logpdf(x0) - np.log(scale))
            assert_allclose(dist.pdf(x), dist0.pdf(x0) / scale)
            assert_allclose(dist.logcdf(x), dist0.logcdf(x0))
            assert_allclose(dist.cdf(x), dist0.cdf(x0))
            assert_allclose(dist.logccdf(x), dist0.logccdf(x0))
            assert_allclose(dist.ccdf(x), dist0.ccdf(x0))
            assert_allclose(dist.logcdf(x, y), dist0.logcdf(x0, y0))
            assert_allclose(dist.cdf(x, y), dist0.cdf(x0, y0))
            assert_allclose(dist.logccdf(x, y), dist0.logccdf(x0, y0))
            assert_allclose(dist.ccdf(x, y), dist0.ccdf(x0, y0))
            assert_allclose(dist.ilogcdf(logp), dist0.ilogcdf(logp)*scale + loc)
            assert_allclose(dist.icdf(p), dist0.icdf(p)*scale + loc)
            assert_allclose(dist.ilogccdf(logp), dist0.ilogccdf(logp)*scale + loc)
            assert_allclose(dist.iccdf(p), dist0.iccdf(p)*scale + loc)
            for i in range(1, 5):
                assert_allclose(dist.moment(i, 'raw'), dist_ref.moment(i))
                assert_allclose(dist.moment(i, 'central'),
                                dist0.moment(i, 'central') * scale**i)
                assert_allclose(dist.moment(i, 'standardized'),
                                dist0.moment(i, 'standardized') * np.sign(scale)**i)

        # Transform back to the original distribution using all arithmetic
        # operations; check that it behaves as expected.
        dist = (dist - 2*loc) + loc
        dist = dist/scale**2 * scale
        z = np.zeros(dist._shape)  # compact broadcasting

        a, b = dist.support()
        a0, b0 = dist0.support()
        assert_allclose(a, a0 + z)
        assert_allclose(b, b0 + z)

        with np.errstate(invalid='ignore', divide='ignore'):
            assert_allclose(dist.logentropy(), dist0.logentropy() + z)
            assert_allclose(dist.entropy(), dist0.entropy() + z)
            assert_allclose(dist.median(), dist0.median() + z)
            assert_allclose(dist.mode(), dist0.mode() + z)
            assert_allclose(dist.mean(), dist0.mean() + z)
            assert_allclose(dist.variance(), dist0.variance() + z)
            assert_allclose(dist.standard_deviation(), dist0.standard_deviation() + z)
            assert_allclose(dist.skewness(), dist0.skewness() + z)
            assert_allclose(dist.kurtosis(), dist0.kurtosis() + z)
            assert_allclose(dist.logpdf(x), dist0.logpdf(x)+z)
            assert_allclose(dist.pdf(x), dist0.pdf(x) + z)
            assert_allclose(dist.logcdf(x), dist0.logcdf(x) + z)
            assert_allclose(dist.cdf(x), dist0.cdf(x) + z)
            assert_allclose(dist.logccdf(x), dist0.logccdf(x) + z)
            assert_allclose(dist.ccdf(x), dist0.ccdf(x) + z)
            assert_allclose(dist.ilogcdf(logp), dist0.ilogcdf(logp) + z)
            assert_allclose(dist.icdf(p), dist0.icdf(p) + z)
            assert_allclose(dist.ilogccdf(logp), dist0.ilogccdf(logp) + z)
            assert_allclose(dist.iccdf(p), dist0.iccdf(p) + z)
            for i in range(1, 5):
                assert_allclose(dist.moment(i, 'raw'), dist0.moment(i, 'raw'))
                assert_allclose(dist.moment(i, 'central'), dist0.moment(i, 'central'))
                assert_allclose(dist.moment(i, 'standardized'),
                                dist0.moment(i, 'standardized'))

            # These are tough to compare because of the way the shape works
            # rng = np.random.default_rng(seed)
            # rng0 = np.random.default_rng(seed)
            # assert_allclose(dist.sample(x_result_shape, rng=rng),
            #                 dist0.sample(x_result_shape, rng=rng0) * scale + loc)
            # Should also try to test fit, plot?

    @pytest.mark.fail_slow(5)
    @pytest.mark.parametrize('exp_pow', ['exp', 'pow'])
    def test_exp_pow(self, exp_pow):
        rng = np.random.default_rng(81345982345826)
        mu = rng.random((3, 1))
        sigma = rng.random((3, 1))

        X = Normal()*sigma + mu
        if exp_pow == 'exp':
            Y = stats.exp(X)
        else:
            Y = np.e ** X
        Y0 = stats.lognorm(sigma, scale=np.exp(mu))

        y = Y0.rvs((3, 10), random_state=rng)
        p = Y0.cdf(y)

        assert_allclose(Y.logentropy(), np.log(Y0.entropy()))
        assert_allclose(Y.entropy(), Y0.entropy())
        assert_allclose(Y.median(), Y0.ppf(0.5))
        assert_allclose(Y.mean(), Y0.mean())
        assert_allclose(Y.variance(), Y0.var())
        assert_allclose(Y.standard_deviation(), np.sqrt(Y0.var()))
        assert_allclose(Y.skewness(), Y0.stats('s'))
        assert_allclose(Y.kurtosis(), Y0.stats('k') + 3)
        assert_allclose(Y.support(), Y0.support())
        assert_allclose(Y.pdf(y), Y0.pdf(y))
        assert_allclose(Y.cdf(y), Y0.cdf(y))
        assert_allclose(Y.ccdf(y), Y0.sf(y))
        assert_allclose(Y.icdf(p), Y0.ppf(p))
        assert_allclose(Y.iccdf(p), Y0.isf(p))
        assert_allclose(Y.logpdf(y), Y0.logpdf(y))
        assert_allclose(Y.logcdf(y), Y0.logcdf(y))
        assert_allclose(Y.logccdf(y), Y0.logsf(y))
        assert_allclose(Y.ilogcdf(np.log(p)), Y0.ppf(p))
        assert_allclose(Y.ilogccdf(np.log(p)), Y0.isf(p))
        seed = 3984593485
        assert_allclose(Y.sample(rng=seed), np.exp(X.sample(rng=seed)))


    @pytest.mark.fail_slow(10)
    @pytest.mark.parametrize('scale', [1, 2, -1])
    @pytest.mark.xfail_on_32bit("`scale=-1` fails on 32-bit; needs investigation")
    def test_reciprocal(self, scale):
        rng = np.random.default_rng(81345982345826)
        a = rng.random((3, 1))

        # Separate sign from scale. It's easy to scale the resulting
        # RV with negative scale; we want to test the ability to divide
        # by a RV with negative support
        sign, scale = np.sign(scale), abs(scale)

        # Reference distribution
        InvGamma = stats.make_distribution(stats.invgamma)
        Y0 = sign * scale * InvGamma(a=a)

        # Test distribution
        X = _Gamma(a=a) if sign > 0 else -_Gamma(a=a)
        Y = scale / X

        y = Y0.sample(shape=(3, 10), rng=rng)
        p = Y0.cdf(y)
        logp = np.log(p)

        assert_allclose(Y.logentropy(), np.log(Y0.entropy()))
        assert_allclose(Y.entropy(), Y0.entropy())
        assert_allclose(Y.median(), Y0.median())
        # moments are not finite
        assert_allclose(Y.support(), Y0.support())
        assert_allclose(Y.pdf(y), Y0.pdf(y))
        assert_allclose(Y.cdf(y), Y0.cdf(y))
        assert_allclose(Y.ccdf(y), Y0.ccdf(y))
        assert_allclose(Y.icdf(p), Y0.icdf(p))
        assert_allclose(Y.iccdf(p), Y0.iccdf(p))
        assert_allclose(Y.logpdf(y), Y0.logpdf(y))
        assert_allclose(Y.logcdf(y), Y0.logcdf(y))
        assert_allclose(Y.logccdf(y), Y0.logccdf(y))
        with np.errstate(divide='ignore', invalid='ignore'):
            assert_allclose(Y.ilogcdf(logp), Y0.ilogcdf(logp))
            assert_allclose(Y.ilogccdf(logp), Y0.ilogccdf(logp))
        seed = 3984593485
        assert_allclose(Y.sample(rng=seed), scale/(X.sample(rng=seed)))

    @pytest.mark.fail_slow(5)
    def test_log(self):
        rng = np.random.default_rng(81345982345826)
        a = rng.random((3, 1))

        X = _Gamma(a=a)
        Y0 = stats.loggamma(a)
        Y = stats.log(X)
        y = Y0.rvs((3, 10), random_state=rng)
        p = Y0.cdf(y)

        assert_allclose(Y.logentropy(), np.log(Y0.entropy()))
        assert_allclose(Y.entropy(), Y0.entropy())
        assert_allclose(Y.median(), Y0.ppf(0.5))
        assert_allclose(Y.mean(), Y0.mean())
        assert_allclose(Y.variance(), Y0.var())
        assert_allclose(Y.standard_deviation(), np.sqrt(Y0.var()))
        assert_allclose(Y.skewness(), Y0.stats('s'))
        assert_allclose(Y.kurtosis(), Y0.stats('k') + 3)
        assert_allclose(Y.support(), Y0.support())
        assert_allclose(Y.pdf(y), Y0.pdf(y))
        assert_allclose(Y.cdf(y), Y0.cdf(y))
        assert_allclose(Y.ccdf(y), Y0.sf(y))
        assert_allclose(Y.icdf(p), Y0.ppf(p))
        assert_allclose(Y.iccdf(p), Y0.isf(p))
        assert_allclose(Y.logpdf(y), Y0.logpdf(y))
        assert_allclose(Y.logcdf(y), Y0.logcdf(y))
        assert_allclose(Y.logccdf(y), Y0.logsf(y))
        with np.errstate(invalid='ignore'):
            assert_allclose(Y.ilogcdf(np.log(p)), Y0.ppf(p))
            assert_allclose(Y.ilogccdf(np.log(p)), Y0.isf(p))
        seed = 3984593485
        assert_allclose(Y.sample(rng=seed), np.log(X.sample(rng=seed)))

    def test_monotonic_transforms(self):
        # Some tests of monotonic transforms that are better to be grouped or
        # don't fit well above

        X = Uniform(a=1, b=2)
        X_str = "Uniform(a=1.0, b=2.0)"

        assert str(stats.log(X)) == f"log({X_str})"
        assert str(1 / X) == f"1/({X_str})"
        assert str(stats.exp(X)) == f"exp({X_str})"

        X = Uniform(a=-1, b=2)
        message = "Division by a random variable is only implemented when the..."
        with pytest.raises(NotImplementedError, match=message):
            1 / X
        message = "The logarithm of a random variable is only implemented when the..."
        with pytest.raises(NotImplementedError, match=message):
            stats.log(X)
        message = "Raising an argument to the power of a random variable is only..."
        with pytest.raises(NotImplementedError, match=message):
            (-2) ** X
        with pytest.raises(NotImplementedError, match=message):
            1 ** X
        with pytest.raises(NotImplementedError, match=message):
            [0.5, 1.5] ** X

        message = "Raising a random variable to the power of an argument is only"
        with pytest.raises(NotImplementedError, match=message):
            X ** (-2)
        with pytest.raises(NotImplementedError, match=message):
            X ** 0
        with pytest.raises(NotImplementedError, match=message):
            X ** [0.5, 1.5]

    def test_arithmetic_operators(self):
        rng = np.random.default_rng(2348923495832349834)

        a, b, loc, scale = 0.294, 1.34, 0.57, 1.16

        x = rng.uniform(-3, 3, 100)
        Y = _LogUniform(a=a, b=b)

        X = scale*Y + loc
        assert_allclose(X.cdf(x), Y.cdf((x - loc) / scale))
        X = loc + Y*scale
        assert_allclose(X.cdf(x), Y.cdf((x - loc) / scale))

        X = Y/scale - loc
        assert_allclose(X.cdf(x), Y.cdf((x + loc) * scale))
        X = loc -_LogUniform(a=a, b=b)/scale
        assert_allclose(X.cdf(x), Y.ccdf((-x + loc)*scale))

    def test_abs(self):
        rng = np.random.default_rng(81345982345826)
        loc = rng.random((3, 1))

        Y = stats.abs(Normal() + loc)
        Y0 = stats.foldnorm(loc)

        y = Y0.rvs((3, 10), random_state=rng)
        p = Y0.cdf(y)

        assert_allclose(Y.logentropy(), np.log(Y0.entropy() + 0j))
        assert_allclose(Y.entropy(), Y0.entropy())
        assert_allclose(Y.median(), Y0.ppf(0.5))
        assert_allclose(Y.mean(), Y0.mean())
        assert_allclose(Y.variance(), Y0.var())
        assert_allclose(Y.standard_deviation(), np.sqrt(Y0.var()))
        assert_allclose(Y.skewness(), Y0.stats('s'))
        assert_allclose(Y.kurtosis(), Y0.stats('k') + 3)
        assert_allclose(Y.support(), Y0.support())
        assert_allclose(Y.pdf(y), Y0.pdf(y))
        assert_allclose(Y.cdf(y), Y0.cdf(y))
        assert_allclose(Y.ccdf(y), Y0.sf(y))
        assert_allclose(Y.icdf(p), Y0.ppf(p))
        assert_allclose(Y.iccdf(p), Y0.isf(p))
        assert_allclose(Y.logpdf(y), Y0.logpdf(y))
        assert_allclose(Y.logcdf(y), Y0.logcdf(y))
        assert_allclose(Y.logccdf(y), Y0.logsf(y))
        assert_allclose(Y.ilogcdf(np.log(p)), Y0.ppf(p))
        assert_allclose(Y.ilogccdf(np.log(p)), Y0.isf(p))
        sample = Y.sample(10)
        assert np.all(sample > 0)

    def test_abs_finite_support(self):
        # The original implementation of `FoldedDistribution` might evaluate
        # the private distribution methods outside the support. Check that this
        # is resolved.
        Weibull = stats.make_distribution(stats.weibull_min)
        X = Weibull(c=2)
        Y = abs(-X)
        assert_equal(X.logpdf(1), Y.logpdf(1))
        assert_equal(X.pdf(1), Y.pdf(1))
        assert_equal(X.logcdf(1), Y.logcdf(1))
        assert_equal(X.cdf(1), Y.cdf(1))
        assert_equal(X.logccdf(1), Y.logccdf(1))
        assert_equal(X.ccdf(1), Y.ccdf(1))

    def test_pow(self):
        rng = np.random.default_rng(81345982345826)

        Y = Normal()**2
        Y0 = stats.chi2(df=1)

        y = Y0.rvs(10, random_state=rng)
        p = Y0.cdf(y)

        assert_allclose(Y.logentropy(), np.log(Y0.entropy() + 0j), rtol=1e-6)
        assert_allclose(Y.entropy(), Y0.entropy(), rtol=1e-6)
        assert_allclose(Y.median(), Y0.median())
        assert_allclose(Y.mean(), Y0.mean())
        assert_allclose(Y.variance(), Y0.var())
        assert_allclose(Y.standard_deviation(), np.sqrt(Y0.var()))
        assert_allclose(Y.skewness(), Y0.stats('s'))
        assert_allclose(Y.kurtosis(), Y0.stats('k') + 3)
        assert_allclose(Y.support(), Y0.support())
        assert_allclose(Y.pdf(y), Y0.pdf(y))
        assert_allclose(Y.cdf(y), Y0.cdf(y))
        assert_allclose(Y.ccdf(y), Y0.sf(y))
        assert_allclose(Y.icdf(p), Y0.ppf(p))
        assert_allclose(Y.iccdf(p), Y0.isf(p))
        assert_allclose(Y.logpdf(y), Y0.logpdf(y))
        assert_allclose(Y.logcdf(y), Y0.logcdf(y))
        assert_allclose(Y.logccdf(y), Y0.logsf(y))
        assert_allclose(Y.ilogcdf(np.log(p)), Y0.ppf(p))
        assert_allclose(Y.ilogccdf(np.log(p)), Y0.isf(p))
        sample = Y.sample(10)
        assert np.all(sample > 0)

class TestOrderStatistic:
    @pytest.mark.fail_slow(20)  # Moments require integration
    def test_order_statistic(self):
        rng = np.random.default_rng(7546349802439582)
        X = Uniform(a=0, b=1)
        n = 5
        r = np.asarray([[1], [3], [5]])
        Y = stats.order_statistic(X, n=n, r=r)
        Y0 = stats.beta(r, n + 1 - r)

        y = Y0.rvs((3, 10), random_state=rng)
        p = Y0.cdf(y)

        # log methods need some attention before merge
        assert_allclose(np.exp(Y.logentropy()), Y0.entropy())
        assert_allclose(Y.entropy(), Y0.entropy())
        assert_allclose(Y.mean(), Y0.mean())
        assert_allclose(Y.variance(), Y0.var())
        assert_allclose(Y.skewness(), Y0.stats('s'), atol=1e-15)
        assert_allclose(Y.kurtosis(), Y0.stats('k') + 3, atol=1e-15)
        assert_allclose(Y.median(), Y0.ppf(0.5))
        assert_allclose(Y.support(), Y0.support())
        assert_allclose(Y.pdf(y), Y0.pdf(y))
        assert_allclose(Y.cdf(y, method='formula'), Y.cdf(y, method='quadrature'))
        assert_allclose(Y.ccdf(y, method='formula'), Y.ccdf(y, method='quadrature'))
        assert_allclose(Y.icdf(p, method='formula'), Y.icdf(p, method='inversion'))
        assert_allclose(Y.iccdf(p, method='formula'), Y.iccdf(p, method='inversion'))
        assert_allclose(Y.logpdf(y), Y0.logpdf(y))
        assert_allclose(Y.logcdf(y), Y0.logcdf(y))
        assert_allclose(Y.logccdf(y), Y0.logsf(y))
        with np.errstate(invalid='ignore', divide='ignore'):
            assert_allclose(Y.ilogcdf(np.log(p),), Y0.ppf(p))
            assert_allclose(Y.ilogccdf(np.log(p)), Y0.isf(p))

        message = "`r` and `n` must contain only positive integers."
        with pytest.raises(ValueError, match=message):
            stats.order_statistic(X, n=n, r=-1)
        with pytest.raises(ValueError, match=message):
            stats.order_statistic(X, n=-1, r=r)
        with pytest.raises(ValueError, match=message):
            stats.order_statistic(X, n=n, r=1.5)
        with pytest.raises(ValueError, match=message):
            stats.order_statistic(X, n=1.5, r=r)

    def test_support_gh22037(self):
        # During review of gh-22037, it was noted that the `support` of
        # an `OrderStatisticDistribution` returned incorrect results;
        # this was resolved by overriding `_support`.
        Uniform = stats.make_distribution(stats.uniform)
        X = Uniform()
        Y = X*5 + 2
        Z = stats.order_statistic(Y, r=3, n=5)
        assert_allclose(Z.support(), Y.support())

    def test_composition_gh22037(self):
        # During review of gh-22037, it was noted that an error was
        # raised when creating an `OrderStatisticDistribution` from
        # a `TruncatedDistribution`. This was resolved by overriding
        # `_update_parameters`.
        Normal = stats.make_distribution(stats.norm)
        TruncatedNormal = stats.make_distribution(stats.truncnorm)
        a, b = [-2, -1], 1
        r, n = 3, [[4], [5]]
        x = [[[-0.3]], [[0.1]]]
        X1 = Normal()
        Y1 = stats.truncate(X1, a, b)
        Z1 = stats.order_statistic(Y1, r=r, n=n)
        X2 = TruncatedNormal(a=a, b=b)
        Z2 = stats.order_statistic(X2, r=r, n=n)
        np.testing.assert_allclose(Z1.cdf(x), Z2.cdf(x))


class TestFullCoverage:
    # Adds tests just to get to 100% test coverage; this way it's more obvious
    # if new lines are untested.
    def test_Domain(self):
        with pytest.raises(NotImplementedError):
            _Domain.contains(None, 1.)
        with pytest.raises(NotImplementedError):
            _Domain.get_numerical_endpoints(None, 1.)
        with pytest.raises(NotImplementedError):
            _Domain.__str__(None)

    def test_Parameter(self):
        with pytest.raises(NotImplementedError):
            _Parameter.validate(None, 1.)

    @pytest.mark.parametrize(("dtype_in", "dtype_out"),
                              [(np.float16, np.float16),
                               (np.int16, np.float64)])
    def test_RealParameter_uncommon_dtypes(self, dtype_in, dtype_out):
        domain = _RealInterval((-1, 1))
        parameter = _RealParameter('x', domain=domain)

        x = np.asarray([0.5, 2.5], dtype=dtype_in)
        arr, dtype, valid = parameter.validate(x, parameter_values={})
        assert_equal(arr, x)
        assert dtype == dtype_out
        assert_equal(valid, [True, False])

    def test_ContinuousDistribution_set_invalid_nan(self):
        # Exercise code paths when formula returns wrong shape and dtype
        # We could consider making this raise an error to force authors
        # to return the right shape and dytpe, but this would need to be
        # configurable.
        class TestDist(ContinuousDistribution):
            _variable = _RealParameter('x', domain=_RealInterval(endpoints=(0., 1.)))
            def _logpdf_formula(self, x, *args, **kwargs):
                return 0

        X = TestDist()
        dtype = np.float32
        X._dtype = dtype
        x = np.asarray([0.5], dtype=dtype)
        assert X.logpdf(x).dtype == dtype

    def test_fiinfo(self):
        assert _fiinfo(np.float64(1.)).max == np.finfo(np.float64).max
        assert _fiinfo(np.int64(1)).max == np.iinfo(np.int64).max

    def test_generate_domain_support(self):
        msg = _generate_domain_support(StandardNormal)
        assert "accepts no distribution parameters" in msg

        msg = _generate_domain_support(Normal)
        assert "accepts one parameterization" in msg

        msg = _generate_domain_support(_LogUniform)
        assert "accepts two parameterizations" in msg

    def test_ContinuousDistribution__repr__(self):
        X = Uniform(a=0, b=1)
        if np.__version__ < "2":
            assert repr(X) == "Uniform(a=0.0, b=1.0)"
        else:
            assert repr(X) == "Uniform(a=np.float64(0.0), b=np.float64(1.0))"
        if np.__version__ < "2":
            assert repr(X*3 + 2) == "3.0*Uniform(a=0.0, b=1.0) + 2.0"
        else:
            assert repr(X*3 + 2) == (
                "np.float64(3.0)*Uniform(a=np.float64(0.0), b=np.float64(1.0))"
                " + np.float64(2.0)"
            )

        X = Uniform(a=np.zeros(4), b=1)
        assert repr(X) == "Uniform(a=array([0., 0., 0., 0.]), b=1)"

        X = Uniform(a=np.zeros(4, dtype=np.float32), b=np.ones(4, dtype=np.float32))
        assert repr(X) == (
            "Uniform(a=array([0., 0., 0., 0.], dtype=float32),"
            " b=array([1., 1., 1., 1.], dtype=float32))"
        )


class TestReprs:
    U = Uniform(a=0, b=1)
    V = Uniform(a=np.float32(0.0), b=np.float32(1.0))
    X = Normal(mu=-1, sigma=1)
    Y = Normal(mu=1, sigma=1)
    Z = Normal(mu=np.zeros(1000), sigma=1)

    @pytest.mark.parametrize(
        "dist",
        [
            U,
            U - np.array([1.0, 2.0]),
            pytest.param(
                V,
                marks=pytest.mark.skipif(
                    np.__version__ < "2",
                    reason="numpy 1.x didn't have dtype in repr",
                )
            ),
            pytest.param(
                np.ones(2, dtype=np.float32)*V + np.zeros(2, dtype=np.float64),
                marks=pytest.mark.skipif(
                    np.__version__ < "2",
                    reason="numpy 1.x didn't have dtype in repr",
                )
            ),
            3*U + 2,
            U**4,
            (3*U + 2)**4,
            (3*U + 2)**3,
            2**U,
            2**(3*U + 1),
            1 / (1 + U),
            stats.order_statistic(U, r=3, n=5),
            stats.truncate(U, 0.2, 0.8),
            stats.Mixture([X, Y], weights=[0.3, 0.7]),
            abs(U),
            stats.exp(U),
            stats.log(1 + U),
            np.array([1.0, 2.0])*U + np.array([2.0, 3.0]),
        ]
    )
    def test_executable(self, dist):
        # Test that reprs actually evaluate to proper distribution
        # provided relevant imports are made.
        from numpy import array  # noqa: F401
        from numpy import float32  # noqa: F401
        from scipy.stats import abs, exp, log, order_statistic, truncate # noqa: F401
        from scipy.stats import Mixture, Normal # noqa: F401
        from scipy.stats._new_distributions import Uniform # noqa: F401
        new_dist = eval(repr(dist))
        # A basic check that the distributions are the same
        sample1 = dist.sample(shape=10, rng=1234)
        sample2 = new_dist.sample(shape=10, rng=1234)
        assert_equal(sample1, sample2)
        assert sample1.dtype is sample2.dtype

    @pytest.mark.parametrize(
        "dist",
        [
            Z,
            np.full(1000, 2.0) * X + 1.0,
            2.0 * X + np.full(1000, 1.0),
            np.full(1000, 2.0) * X + 1.0,
            stats.truncate(Z, -1, 1),
            stats.truncate(Z, -np.ones(1000), np.ones(1000)),
            stats.order_statistic(X, r=np.arange(1, 1000), n=1000),
            Z**2,
            1.0 / (1 + stats.exp(Z)),
            2**Z,
        ]
    )
    def test_not_too_long(self, dist):
        # Tests that array summarization is working to ensure reprs aren't too long.
        # None of the reprs above will be executable.
        assert len(repr(dist)) < 250


class MixedDist(ContinuousDistribution):
    _variable = _RealParameter('x', domain=_RealInterval(endpoints=(-np.inf, np.inf)))
    def _pdf_formula(self, x, *args, **kwargs):
        return (0.4 * 1/(1.1 * np.sqrt(2*np.pi)) * np.exp(-0.5*((x+0.25)/1.1)**2)
                + 0.6 * 1/(0.9 * np.sqrt(2*np.pi)) * np.exp(-0.5*((x-0.5)/0.9)**2))


class TestMixture:
    def test_input_validation(self):
        message = "`components` must contain at least one random variable."
        with pytest.raises(ValueError, match=message):
            Mixture([])

        message = "Each element of `components` must be an instance..."
        with pytest.raises(ValueError, match=message):
            Mixture((1, 2, 3))

        message = "All elements of `components` must have scalar shapes."
        with pytest.raises(ValueError, match=message):
            Mixture([Normal(mu=[1, 2]), Normal()])

        message = "`components` and `weights` must have the same length."
        with pytest.raises(ValueError, match=message):
            Mixture([Normal()], weights=[0.5, 0.5])

        message = "`weights` must have floating point dtype."
        with pytest.raises(ValueError, match=message):
            Mixture([Normal()], weights=[1])

        message = "`weights` must have floating point dtype."
        with pytest.raises(ValueError, match=message):
            Mixture([Normal()], weights=[1])

        message = "`weights` must sum to 1.0."
        with pytest.raises(ValueError, match=message):
            Mixture([Normal(), Normal()], weights=[0.5, 1.0])

        message = "All `weights` must be non-negative."
        with pytest.raises(ValueError, match=message):
            Mixture([Normal(), Normal()], weights=[1.5, -0.5])

    @pytest.mark.parametrize('shape', [(), (10,)])
    def test_basic(self, shape):
        rng = np.random.default_rng(582348972387243524)
        X = Mixture((Normal(mu=-0.25, sigma=1.1), Normal(mu=0.5, sigma=0.9)),
                    weights=(0.4, 0.6))
        Y = MixedDist()
        x = rng.random(shape)

        def assert_allclose(res, ref, **kwargs):
            if shape == ():
                assert np.isscalar(res)
            np.testing.assert_allclose(res, ref, **kwargs)

        assert_allclose(X.logentropy(), Y.logentropy())
        assert_allclose(X.entropy(), Y.entropy())
        assert_allclose(X.mode(), Y.mode())
        assert_allclose(X.median(), Y.median())
        assert_allclose(X.mean(), Y.mean())
        assert_allclose(X.variance(), Y.variance())
        assert_allclose(X.standard_deviation(), Y.standard_deviation())
        assert_allclose(X.skewness(), Y.skewness())
        assert_allclose(X.kurtosis(), Y.kurtosis())
        assert_allclose(X.logpdf(x), Y.logpdf(x))
        assert_allclose(X.pdf(x), Y.pdf(x))
        assert_allclose(X.logcdf(x), Y.logcdf(x))
        assert_allclose(X.cdf(x), Y.cdf(x))
        assert_allclose(X.logccdf(x), Y.logccdf(x))
        assert_allclose(X.ccdf(x), Y.ccdf(x))
        assert_allclose(X.ilogcdf(x), Y.ilogcdf(x))
        assert_allclose(X.icdf(x), Y.icdf(x))
        assert_allclose(X.ilogccdf(x), Y.ilogccdf(x))
        assert_allclose(X.iccdf(x), Y.iccdf(x))
        for kind in ['raw', 'central', 'standardized']:
            for order in range(5):
                assert_allclose(X.moment(order, kind=kind),
                                Y.moment(order, kind=kind),
                                atol=1e-15)

        # weak test of `sample`
        shape = (10, 20, 5)
        y = X.sample(shape, rng=rng)
        assert y.shape == shape
        assert stats.ks_1samp(y.ravel(), X.cdf).pvalue > 0.05

    def test_default_weights(self):
        a = 1.1
        Gamma = stats.make_distribution(stats.gamma)
        X = Gamma(a=a)
        Y = stats.Mixture((X, -X))
        x = np.linspace(-4, 4, 300)
        assert_allclose(Y.pdf(x), stats.dgamma(a=a).pdf(x))

    def test_properties(self):
        components = [Normal(mu=-0.25, sigma=1.1), Normal(mu=0.5, sigma=0.9)]
        weights = (0.4, 0.6)
        X = Mixture(components, weights=weights)

        # Replacing properties doesn't work
        # Different version of Python have different messages
        with pytest.raises(AttributeError):
            X.components = 10
        with pytest.raises(AttributeError):
            X.weights = 10

        # Mutation doesn't work
        X.components[0] = components[1]
        assert X.components[0] == components[0]
        X.weights[0] = weights[1]
        assert X.weights[0] == weights[0]

    def test_inverse(self):
        # Originally, inverse relied on the mean to start the bracket search.
        # This didn't work for distributions with non-finite mean. Check that
        # this is resolved.
        rng = np.random.default_rng(24358934657854237863456)
        Cauchy = stats.make_distribution(stats.cauchy)
        X0 = Cauchy()
        X = stats.Mixture([X0, X0])
        p = rng.random(size=10)
        np.testing.assert_allclose(X.icdf(p), X0.icdf(p))
        np.testing.assert_allclose(X.iccdf(p), X0.iccdf(p))
        np.testing.assert_allclose(X.ilogcdf(p), X0.ilogcdf(p))
        np.testing.assert_allclose(X.ilogccdf(p), X0.ilogccdf(p))
