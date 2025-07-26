import sys

import numpy as np
from numpy import inf

from scipy import special
from scipy.stats._distribution_infrastructure import (
    ContinuousDistribution, DiscreteDistribution, _RealInterval, _IntegerInterval,
    _RealParameter, _Parameterization, _combine_docs)

__all__ = ['Normal', 'Uniform', 'Binomial']


class Normal(ContinuousDistribution):
    r"""Normal distribution with prescribed mean and standard deviation.

    The probability density function of the normal distribution is:

    .. math::

        f(x) = \frac{1}{\sigma \sqrt{2 \pi}} \exp {
            \left( -\frac{1}{2}\left( \frac{x - \mu}{\sigma} \right)^2 \right)}

    """
    # `ShiftedScaledDistribution` allows this to be generated automatically from
    # an instance of `StandardNormal`, but the normal distribution is so frequently
    # used that it's worth a bit of code duplication to get better performance.
    _mu_domain = _RealInterval(endpoints=(-inf, inf))
    _sigma_domain = _RealInterval(endpoints=(0, inf))
    _x_support = _RealInterval(endpoints=(-inf, inf))

    _mu_param = _RealParameter('mu',  symbol=r'\mu', domain=_mu_domain,
                               typical=(-1, 1))
    _sigma_param = _RealParameter('sigma', symbol=r'\sigma', domain=_sigma_domain,
                                  typical=(0.5, 1.5))
    _x_param = _RealParameter('x', domain=_x_support, typical=(-1, 1))

    _parameterizations = [_Parameterization(_mu_param, _sigma_param)]

    _variable = _x_param
    _normalization = 1/np.sqrt(2*np.pi)
    _log_normalization = np.log(2*np.pi)/2

    def __new__(cls, mu=None, sigma=None, **kwargs):
        if mu is None and sigma is None:
            return super().__new__(StandardNormal)
        return super().__new__(cls)

    def __init__(self, *, mu=0., sigma=1., **kwargs):
        super().__init__(mu=mu, sigma=sigma, **kwargs)

    def _logpdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._logpdf_formula(self, (x - mu)/sigma) - np.log(sigma)

    def _pdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._pdf_formula(self, (x - mu)/sigma) / sigma

    def _logcdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._logcdf_formula(self, (x - mu)/sigma)

    def _cdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._cdf_formula(self, (x - mu)/sigma)

    def _logccdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._logccdf_formula(self, (x - mu)/sigma)

    def _ccdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._ccdf_formula(self, (x - mu)/sigma)

    def _icdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._icdf_formula(self, x) * sigma + mu

    def _ilogcdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._ilogcdf_formula(self, x) * sigma + mu

    def _iccdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._iccdf_formula(self, x) * sigma + mu

    def _ilogccdf_formula(self, x, *, mu, sigma, **kwargs):
        return StandardNormal._ilogccdf_formula(self, x) * sigma + mu

    def _entropy_formula(self, *, mu, sigma, **kwargs):
        return StandardNormal._entropy_formula(self) + np.log(abs(sigma))

    def _logentropy_formula(self, *, mu, sigma, **kwargs):
        lH0 = StandardNormal._logentropy_formula(self)
        with np.errstate(divide='ignore'):
            # sigma = 1 -> log(sigma) = 0 -> log(log(sigma)) = -inf
            # Silence the unnecessary runtime warning
            lls = np.log(np.log(abs(sigma))+0j)
        return special.logsumexp(np.broadcast_arrays(lH0, lls), axis=0)

    def _median_formula(self, *, mu, sigma, **kwargs):
        return mu

    def _mode_formula(self, *, mu, sigma, **kwargs):
        return mu

    def _moment_raw_formula(self, order, *, mu, sigma, **kwargs):
        if order == 0:
            return np.ones_like(mu)
        elif order == 1:
            return mu
        else:
            return None
    _moment_raw_formula.orders = [0, 1]  # type: ignore[attr-defined]

    def _moment_central_formula(self, order, *, mu, sigma, **kwargs):
        if order == 0:
            return np.ones_like(mu)
        elif order % 2:
            return np.zeros_like(mu)
        else:
            # exact is faster (and obviously more accurate) for reasonable orders
            return sigma**order * special.factorial2(int(order) - 1, exact=True)

    def _sample_formula(self, full_shape, rng, *, mu, sigma, **kwargs):
        return rng.normal(loc=mu, scale=sigma, size=full_shape)[()]


def _log_diff(log_p, log_q):
    return special.logsumexp([log_p, log_q+np.pi*1j], axis=0)


class StandardNormal(Normal):
    r"""Standard normal distribution.

    The probability density function of the standard normal distribution is:

    .. math::

        f(x) = \frac{1}{\sqrt{2 \pi}} \exp \left( -\frac{1}{2} x^2 \right)

    """
    _x_support = _RealInterval(endpoints=(-inf, inf))
    _x_param = _RealParameter('x', domain=_x_support, typical=(-5, 5))
    _variable = _x_param
    _parameterizations = []
    _normalization = 1/np.sqrt(2*np.pi)
    _log_normalization = np.log(2*np.pi)/2
    mu = np.float64(0.)
    sigma = np.float64(1.)

    def __init__(self, **kwargs):
        ContinuousDistribution.__init__(self, **kwargs)

    def _logpdf_formula(self, x, **kwargs):
        return -(self._log_normalization + x**2/2)

    def _pdf_formula(self, x, **kwargs):
        return self._normalization * np.exp(-x**2/2)

    def _logcdf_formula(self, x, **kwargs):
        return special.log_ndtr(x)

    def _cdf_formula(self, x, **kwargs):
        return special.ndtr(x)

    def _logccdf_formula(self, x, **kwargs):
        return special.log_ndtr(-x)

    def _ccdf_formula(self, x, **kwargs):
        return special.ndtr(-x)

    def _icdf_formula(self, x, **kwargs):
        return special.ndtri(x)

    def _ilogcdf_formula(self, x, **kwargs):
        return special.ndtri_exp(x)

    def _iccdf_formula(self, x, **kwargs):
        return -special.ndtri(x)

    def _ilogccdf_formula(self, x, **kwargs):
        return -special.ndtri_exp(x)

    def _entropy_formula(self, **kwargs):
        return (1 + np.log(2*np.pi))/2

    def _logentropy_formula(self, **kwargs):
        return np.log1p(np.log(2*np.pi)) - np.log(2)

    def _median_formula(self, **kwargs):
        return 0

    def _mode_formula(self, **kwargs):
        return 0

    def _moment_raw_formula(self, order, **kwargs):
        raw_moments = {0: 1, 1: 0, 2: 1, 3: 0, 4: 3, 5: 0}
        return raw_moments.get(order, None)

    def _moment_central_formula(self, order, **kwargs):
        return self._moment_raw_formula(order, **kwargs)

    def _moment_standardized_formula(self, order, **kwargs):
        return self._moment_raw_formula(order, **kwargs)

    def _sample_formula(self, full_shape, rng, **kwargs):
        return rng.normal(size=full_shape)[()]


# currently for testing only
class _LogUniform(ContinuousDistribution):
    r"""Log-uniform distribution.

    The probability density function of the log-uniform distribution is:

    .. math::

        f(x; a, b) = \frac{1}
                          {x (\log(b) - \log(a))}

    If :math:`\log(X)` is a random variable that follows a uniform distribution
    between :math:`\log(a)` and :math:`\log(b)`, then :math:`X` is log-uniformly
    distributed with shape parameters :math:`a` and :math:`b`.

    """

    _a_domain = _RealInterval(endpoints=(0, inf))
    _b_domain = _RealInterval(endpoints=('a', inf))
    _log_a_domain = _RealInterval(endpoints=(-inf, inf))
    _log_b_domain = _RealInterval(endpoints=('log_a', inf))
    _x_support = _RealInterval(endpoints=('a', 'b'), inclusive=(True, True))

    _a_param = _RealParameter('a', domain=_a_domain, typical=(1e-3, 0.9))
    _b_param = _RealParameter('b', domain=_b_domain, typical=(1.1, 1e3))
    _log_a_param = _RealParameter('log_a', symbol=r'\log(a)',
                                  domain=_log_a_domain, typical=(-3, -0.1))
    _log_b_param = _RealParameter('log_b', symbol=r'\log(b)',
                                  domain=_log_b_domain, typical=(0.1, 3))
    _x_param = _RealParameter('x', domain=_x_support, typical=('a', 'b'))

    _b_domain.define_parameters(_a_param)
    _log_b_domain.define_parameters(_log_a_param)
    _x_support.define_parameters(_a_param, _b_param)

    _parameterizations = [_Parameterization(_log_a_param, _log_b_param),
                          _Parameterization(_a_param, _b_param)]
    _variable = _x_param

    def __init__(self, *, a=None, b=None, log_a=None, log_b=None, **kwargs):
        super().__init__(a=a, b=b, log_a=log_a, log_b=log_b, **kwargs)

    def _process_parameters(self, a=None, b=None, log_a=None, log_b=None, **kwargs):
        a = np.exp(log_a) if a is None else a
        b = np.exp(log_b) if b is None else b
        log_a = np.log(a) if log_a is None else log_a
        log_b = np.log(b) if log_b is None else log_b
        kwargs.update(dict(a=a, b=b, log_a=log_a, log_b=log_b))
        return kwargs

    # def _logpdf_formula(self, x, *, log_a, log_b, **kwargs):
    #     return -np.log(x) - np.log(log_b - log_a)

    def _pdf_formula(self, x, *, log_a, log_b, **kwargs):
        return ((log_b - log_a)*x)**-1

    # def _cdf_formula(self, x, *, log_a, log_b, **kwargs):
    #     return (np.log(x) - log_a)/(log_b - log_a)

    def _moment_raw_formula(self, order, log_a, log_b, **kwargs):
        if order == 0:
            return self._one
        t1 = self._one / (log_b - log_a) / order
        t2 = np.real(np.exp(_log_diff(order * log_b, order * log_a)))
        return t1 * t2


class Uniform(ContinuousDistribution):
    r"""Uniform distribution.

    The probability density function of the uniform distribution is:

    .. math::

        f(x; a, b) = \frac{1}
                          {b - a}

    """

    _a_domain = _RealInterval(endpoints=(-inf, inf))
    _b_domain = _RealInterval(endpoints=('a', inf))
    _x_support = _RealInterval(endpoints=('a', 'b'), inclusive=(True, True))

    _a_param = _RealParameter('a', domain=_a_domain, typical=(1e-3, 0.9))
    _b_param = _RealParameter('b', domain=_b_domain, typical=(1.1, 1e3))
    _x_param = _RealParameter('x', domain=_x_support, typical=('a', 'b'))

    _b_domain.define_parameters(_a_param)
    _x_support.define_parameters(_a_param, _b_param)

    _parameterizations = [_Parameterization(_a_param, _b_param)]
    _variable = _x_param

    def __init__(self, *, a=None, b=None, **kwargs):
        super().__init__(a=a, b=b, **kwargs)

    def _process_parameters(self, a=None, b=None, ab=None, **kwargs):
        ab = b - a
        kwargs.update(dict(a=a, b=b, ab=ab))
        return kwargs

    def _logpdf_formula(self, x, *, ab, **kwargs):
        return np.where(np.isnan(x), np.nan, -np.log(ab))

    def _pdf_formula(self, x, *, ab, **kwargs):
        return np.where(np.isnan(x), np.nan, 1/ab)

    def _logcdf_formula(self, x, *, a, ab, **kwargs):
        with np.errstate(divide='ignore'):
            return np.log(x - a) - np.log(ab)

    def _cdf_formula(self, x, *, a, ab, **kwargs):
        return (x - a) / ab

    def _logccdf_formula(self, x, *, b, ab, **kwargs):
        with np.errstate(divide='ignore'):
            return np.log(b - x) - np.log(ab)

    def _ccdf_formula(self, x, *, b, ab, **kwargs):
        return (b - x) / ab

    def _icdf_formula(self, p, *, a, ab, **kwargs):
        return a + ab*p

    def _iccdf_formula(self, p, *, b, ab, **kwargs):
        return b - ab*p

    def _entropy_formula(self, *, ab, **kwargs):
        return np.log(ab)

    def _mode_formula(self, *, a, b, ab, **kwargs):
        return a + 0.5*ab

    def _median_formula(self, *, a, b, ab, **kwargs):
        return a + 0.5*ab

    def _moment_raw_formula(self, order, a, b, ab, **kwargs):
        np1 = order + 1
        return (b**np1 - a**np1) / (np1 * ab)

    def _moment_central_formula(self, order, ab, **kwargs):
        return ab**2/12 if order == 2 else None

    _moment_central_formula.orders = [2]  # type: ignore[attr-defined]

    def _sample_formula(self, full_shape, rng, a, b, ab, **kwargs):
        try:
            return rng.uniform(a, b, size=full_shape)[()]
        except OverflowError:  # happens when there are NaNs
            return rng.uniform(0, 1, size=full_shape)*ab + a


class _Gamma(ContinuousDistribution):
    # Gamma distribution for testing only
    _a_domain = _RealInterval(endpoints=(0, inf))
    _x_support = _RealInterval(endpoints=(0, inf), inclusive=(False, False))

    _a_param = _RealParameter('a', domain=_a_domain, typical=(0.1, 10))
    _x_param = _RealParameter('x', domain=_x_support, typical=(0.1, 10))

    _parameterizations = [_Parameterization(_a_param)]
    _variable = _x_param

    def _pdf_formula(self, x, *, a, **kwargs):
        return x ** (a - 1) * np.exp(-x) / special.gamma(a)


class Binomial(DiscreteDistribution):
    r"""Binomial distribution with prescribed success probability and number of trials

    The probability density function of the binomial distribution is:

    .. math::

        f(x) = {n \choose x} p^x (1 - p)^{n-x}

    """
    _n_domain = _IntegerInterval(endpoints=(0, inf), inclusive=(False, False))
    _p_domain = _RealInterval(endpoints=(0, 1), inclusive=(False, False))
    _x_support = _IntegerInterval(endpoints=(0, 'n'), inclusive=(True, True))

    _n_param = _RealParameter('n', domain=_n_domain, typical=(10, 20))
    _p_param = _RealParameter('p', domain=_p_domain, typical=(0.25, 0.75))
    _x_param = _RealParameter('x', domain=_x_support, typical=(0, 10))

    _parameterizations = [_Parameterization(_n_param, _p_param)]
    _variable = _x_param

    def __init__(self, *, n, p, **kwargs):
        super().__init__(n=n, p=p, **kwargs)

    def _pmf_formula(self, x, *, n, p, **kwargs):
        return special._ufuncs._binom_pmf(x, n, p)

    def _logpmf_formula(self, x, *, n, p, **kwargs):
        # This implementation is from the ``scipy.stats.binom`` and could be improved
        # by using a more numerically sound implementation of the absolute value of
        # the binomial coefficient.
        combiln = (
            special.gammaln(n+1) - (special.gammaln(x+1) + special.gammaln(n-x+1))
        )
        return combiln + special.xlogy(x, p) + special.xlog1py(n-x, -p)

    def _cdf_formula(self, x, *, n, p, **kwargs):
        return special._ufuncs._binom_cdf(x, n, p)

    def _ccdf_formula(self, x, *, n, p, **kwargs):
        return special._ufuncs._binom_sf(x, n, p)

    def _icdf_formula(self, x, *, n, p, **kwargs):
        return special._ufuncs._binom_ppf(x, n, p)

    def _iccdf_formula(self, x, *, n, p, **kwargs):
        return special._ufuncs._binom_isf(x, n, p)

    def _mode_formula(self, *, n, p, **kwargs):
        # https://en.wikipedia.org/wiki/Binomial_distribution#Mode
        mode = np.floor((n+1)*p)
        mode = np.where(p == 1, mode - 1, mode)
        return mode[()]

    def _moment_raw_formula(self, order, *, n, p, **kwargs):
        # https://en.wikipedia.org/wiki/Binomial_distribution#Higher_moments
        if order == 1:
            return n*p
        if order == 2:
            return n*p*(1 - p + n*p)
        return None
    _moment_raw_formula.orders = [1, 2]  # type: ignore[attr-defined]

    def _moment_central_formula(self, order, *, n, p, **kwargs):
        # https://en.wikipedia.org/wiki/Binomial_distribution#Higher_moments
        if order == 1:
            return np.zeros_like(n)
        if order == 2:
            return n*p*(1 - p)
        if order == 3:
            return n*p*(1 - p)*(1 - 2*p)
        if order == 4:
            return n*p*(1 - p)*(1 + (3*n - 6)*p*(1 - p))
        return None
    _moment_central_formula.orders = [1, 2, 3, 4]  # type: ignore[attr-defined]


# Distribution classes need only define the summary and beginning of the extended
# summary portion of the class documentation. All other documentation, including
# examples, is generated automatically.
_module = sys.modules[__name__].__dict__
for dist_name in __all__:
    _module[dist_name].__doc__ = _combine_docs(_module[dist_name])
