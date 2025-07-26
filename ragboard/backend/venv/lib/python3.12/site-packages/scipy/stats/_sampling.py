import math
import numbers
import numpy as np
from scipy import stats
from scipy import special as sc
from ._qmc import (check_random_state as check_random_state_qmc,
                   Halton, QMCEngine)
from ._unuran.unuran_wrapper import NumericalInversePolynomial
from scipy._lib._util import check_random_state


__all__ = ['FastGeneratorInversion', 'RatioUniforms']


# define pdfs and other helper functions to create the generators

def argus_pdf(x, chi):
    # approach follows Baumgarten/Hoermann: Generating ARGUS random variates
    # for chi > 5, use relationship of the ARGUS distribution to Gamma(1.5)
    if chi <= 5:
        y = 1 - x * x
        return x * math.sqrt(y) * math.exp(-0.5 * chi**2 * y)
    return math.sqrt(x) * math.exp(-x)


def argus_gamma_trf(x, chi):
    if chi <= 5:
        return x
    return np.sqrt(1.0 - 2 * x / chi**2)


def argus_gamma_inv_trf(x, chi):
    if chi <= 5:
        return x
    return 0.5 * chi**2 * (1 - x**2)


def betaprime_pdf(x, a, b):
    if x > 0:
        logf = (a - 1) * math.log(x) - (a + b) * math.log1p(x) - sc.betaln(a, b)
        return math.exp(logf)
    else:
        # return pdf at x == 0 separately to avoid runtime warnings
        if a > 1:
            return 0
        elif a < 1:
            return np.inf
        else:
            return 1 / sc.beta(a, b)


def beta_valid_params(a, b):
    return (min(a, b) >= 0.1) and (max(a, b) <= 700)


def gamma_pdf(x, a):
    if x > 0:
        return math.exp(-math.lgamma(a) + (a - 1.0) * math.log(x) - x)
    else:
        return 0 if a >= 1 else np.inf


def invgamma_pdf(x, a):
    if x > 0:
        return math.exp(-(a + 1.0) * math.log(x) - math.lgamma(a) - 1 / x)
    else:
        return 0 if a >= 1 else np.inf


def burr_pdf(x, cc, dd):
    # note: we use np.exp instead of math.exp, otherwise an overflow
    # error can occur in the setup, e.g., for parameters
    # 1.89128135, 0.30195177, see test test_burr_overflow
    if x > 0:
        lx = math.log(x)
        return np.exp(-(cc + 1) * lx - (dd + 1) * math.log1p(np.exp(-cc * lx)))
    else:
        return 0


def burr12_pdf(x, cc, dd):
    if x > 0:
        lx = math.log(x)
        logterm = math.log1p(math.exp(cc * lx))
        return math.exp((cc - 1) * lx - (dd + 1) * logterm + math.log(cc * dd))
    else:
        return 0


def chi_pdf(x, a):
    if x > 0:
        return math.exp(
            (a - 1) * math.log(x)
            - 0.5 * (x * x)
            - (a / 2 - 1) * math.log(2)
            - math.lgamma(0.5 * a)
        )
    else:
        return 0 if a >= 1 else np.inf


def chi2_pdf(x, df):
    if x > 0:
        return math.exp(
            (df / 2 - 1) * math.log(x)
            - 0.5 * x
            - (df / 2) * math.log(2)
            - math.lgamma(0.5 * df)
        )
    else:
        return 0 if df >= 1 else np.inf


def alpha_pdf(x, a):
    if x > 0:
        return math.exp(-2.0 * math.log(x) - 0.5 * (a - 1.0 / x) ** 2)
    return 0.0


def bradford_pdf(x, c):
    if 0 <= x <= 1:
        return 1.0 / (1.0 + c * x)
    return 0.0


def crystalball_pdf(x, b, m):
    if x > -b:
        return math.exp(-0.5 * x * x)
    return math.exp(m * math.log(m / b) - 0.5 * b * b - m * math.log(m / b - b - x))


def weibull_min_pdf(x, c):
    if x > 0:
        return c * math.exp((c - 1) * math.log(x) - x**c)
    return 0.0


def weibull_max_pdf(x, c):
    if x < 0:
        return c * math.exp((c - 1) * math.log(-x) - ((-x) ** c))
    return 0.0


def invweibull_pdf(x, c):
    if x > 0:
        return c * math.exp(-(c + 1) * math.log(x) - x ** (-c))
    return 0.0


def wald_pdf(x):
    if x > 0:
        return math.exp(-((x - 1) ** 2) / (2 * x)) / math.sqrt(x**3)
    return 0.0


def geninvgauss_mode(p, b):
    if p > 1:  # equivalent mode formulas numerical more stable versions
        return (math.sqrt((1 - p) ** 2 + b**2) - (1 - p)) / b
    return b / (math.sqrt((1 - p) ** 2 + b**2) + (1 - p))


def geninvgauss_pdf(x, p, b):
    m = geninvgauss_mode(p, b)
    lfm = (p - 1) * math.log(m) - 0.5 * b * (m + 1 / m)
    if x > 0:
        return math.exp((p - 1) * math.log(x) - 0.5 * b * (x + 1 / x) - lfm)
    return 0.0


def invgauss_mode(mu):
    return 1.0 / (math.sqrt(1.5 * 1.5 + 1 / (mu * mu)) + 1.5)


def invgauss_pdf(x, mu):
    m = invgauss_mode(mu)
    lfm = -1.5 * math.log(m) - (m - mu) ** 2 / (2 * m * mu**2)
    if x > 0:
        return math.exp(-1.5 * math.log(x) - (x - mu) ** 2 / (2 * x * mu**2) - lfm)
    return 0.0


def powerlaw_pdf(x, a):
    if x > 0:
        return x ** (a - 1)
    return 0.0


# Define a dictionary: for a given distribution (keys), another dictionary
# (values) specifies the parameters for NumericalInversePolynomial (PINV).
# The keys of the latter dictionary are:
# - pdf: the pdf of the distribution (callable). The signature of the pdf
#   is float -> float (i.e., the function does not have to be vectorized).
#   If possible, functions like log or exp from the module math should be
#   preferred over functions from numpy since the PINV setup will be faster
#   in that case.
# - check_pinv_params: callable f that returns true if the shape parameters
#   (args) are recommended parameters for PINV (i.e., the u-error does
#   not exceed the default tolerance)
# - center: scalar if the center does not depend on args, otherwise
#   callable that returns the center as a function of the shape parameters
# - rvs_transform: a callable that can be used to transform the rvs that
#   are distributed according to the pdf to the target distribution
#   (as an example, see the entry for the beta distribution)
# - rvs_transform_inv: the inverse of rvs_transform (it is required
#   for the transformed ppf)
# - mirror_uniform: boolean or a callable that returns true or false
#   depending on the shape parameters. If True, the ppf is applied
#   to 1-u instead of u to generate rvs, where u is a uniform rv.
#   While both u and 1-u are uniform, it can be required to use 1-u
#   to compute the u-error correctly. This is only relevant for the argus
#   distribution.
# The only required keys are "pdf" and "check_pinv_params".
# All other keys are optional.

PINV_CONFIG = {
    "alpha": {
        "pdf": alpha_pdf,
        "check_pinv_params": lambda a: 1.0e-11 <= a < 2.1e5,
        "center": lambda a: 0.25 * (math.sqrt(a * a + 8.0) - a),
    },
    "anglit": {
        "pdf": lambda x: math.cos(2 * x) + 1.0e-13,
        # +1.e-13 is necessary, otherwise PINV has strange problems as
        # f(upper border) is very close to 0
        "center": 0,
    },
    "argus": {
        "pdf": argus_pdf,
        "center": lambda chi: 0.7 if chi <= 5 else 0.5,
        "check_pinv_params": lambda chi: 1e-20 < chi < 901,
        "rvs_transform": argus_gamma_trf,
        "rvs_transform_inv": argus_gamma_inv_trf,
        "mirror_uniform": lambda chi: chi > 5,
    },
    "beta": {
        "pdf": betaprime_pdf,
        "center": lambda a, b: max(0.1, (a - 1) / (b + 1)),
        "check_pinv_params": beta_valid_params,
        "rvs_transform": lambda x, *args: x / (1 + x),
        "rvs_transform_inv": lambda x, *args: x / (1 - x) if x < 1 else np.inf,
    },
    "betaprime": {
        "pdf": betaprime_pdf,
        "center": lambda a, b: max(0.1, (a - 1) / (b + 1)),
        "check_pinv_params": beta_valid_params,
    },
    "bradford": {
        "pdf": bradford_pdf,
        "check_pinv_params": lambda a: 1.0e-6 <= a <= 1e9,
        "center": 0.5,
    },
    "burr": {
        "pdf": burr_pdf,
        "center": lambda a, b: (2 ** (1 / b) - 1) ** (-1 / a),
        "check_pinv_params": lambda a, b: (min(a, b) >= 0.3) and (max(a, b) <= 50),
    },
    "burr12": {
        "pdf": burr12_pdf,
        "center": lambda a, b: (2 ** (1 / b) - 1) ** (1 / a),
        "check_pinv_params": lambda a, b: (min(a, b) >= 0.2) and (max(a, b) <= 50),
    },
    "cauchy": {
        "pdf": lambda x: 1 / (1 + (x * x)),
        "center": 0,
    },
    "chi": {
        "pdf": chi_pdf,
        "check_pinv_params": lambda df: 0.05 <= df <= 1.0e6,
        "center": lambda a: math.sqrt(a),
    },
    "chi2": {
        "pdf": chi2_pdf,
        "check_pinv_params": lambda df: 0.07 <= df <= 1e6,
        "center": lambda a: a,
    },
    "cosine": {
        "pdf": lambda x: 1 + math.cos(x),
        "center": 0,
    },
    "crystalball": {
        "pdf": crystalball_pdf,
        "check_pinv_params": lambda b, m: (0.01 <= b <= 5.5)
        and (1.1 <= m <= 75.1),
        "center": 0.0,
    },
    "expon": {
        "pdf": lambda x: math.exp(-x),
        "center": 1.0,
    },
    "gamma": {
        "pdf": gamma_pdf,
        "check_pinv_params": lambda a: 0.04 <= a <= 1e6,
        "center": lambda a: a,
    },
    "gennorm": {
        "pdf": lambda x, b: math.exp(-abs(x) ** b),
        "check_pinv_params": lambda b: 0.081 <= b <= 45.0,
        "center": 0.0,
    },
    "geninvgauss": {
        "pdf": geninvgauss_pdf,
        "check_pinv_params": lambda p, b: (abs(p) <= 1200.0)
        and (1.0e-10 <= b <= 1200.0),
        "center": geninvgauss_mode,
    },
    "gumbel_l": {
        "pdf": lambda x: math.exp(x - math.exp(x)),
        "center": -0.6,
    },
    "gumbel_r": {
        "pdf": lambda x: math.exp(-x - math.exp(-x)),
        "center": 0.6,
    },
    "hypsecant": {
        "pdf": lambda x: 1.0 / (math.exp(x) + math.exp(-x)),
        "center": 0.0,
    },
    "invgamma": {
        "pdf": invgamma_pdf,
        "check_pinv_params": lambda a: 0.04 <= a <= 1e6,
        "center": lambda a: 1 / a,
    },
    "invgauss": {
        "pdf": invgauss_pdf,
        "check_pinv_params": lambda mu: 1.0e-10 <= mu <= 1.0e9,
        "center": invgauss_mode,
    },
    "invweibull": {
        "pdf": invweibull_pdf,
        "check_pinv_params": lambda a: 0.12 <= a <= 512,
        "center": 1.0,
    },
    "laplace": {
        "pdf": lambda x: math.exp(-abs(x)),
        "center": 0.0,
    },
    "logistic": {
        "pdf": lambda x: math.exp(-x) / (1 + math.exp(-x)) ** 2,
        "center": 0.0,
    },
    "maxwell": {
        "pdf": lambda x: x * x * math.exp(-0.5 * x * x),
        "center": 1.41421,
    },
    "moyal": {
        "pdf": lambda x: math.exp(-(x + math.exp(-x)) / 2),
        "center": 1.2,
    },
    "norm": {
        "pdf": lambda x: math.exp(-x * x / 2),
        "center": 0.0,
    },
    "pareto": {
        "pdf": lambda x, b: x ** -(b + 1),
        "center": lambda b: b / (b - 1) if b > 2 else 1.5,
        "check_pinv_params": lambda b: 0.08 <= b <= 400000,
    },
    "powerlaw": {
        "pdf": powerlaw_pdf,
        "center": 1.0,
        "check_pinv_params": lambda a: 0.06 <= a <= 1.0e5,
    },
    "t": {
        "pdf": lambda x, df: (1 + x * x / df) ** (-0.5 * (df + 1)),
        "check_pinv_params": lambda a: 0.07 <= a <= 1e6,
        "center": 0.0,
    },
    "rayleigh": {
        "pdf": lambda x: x * math.exp(-0.5 * (x * x)),
        "center": 1.0,
    },
    "semicircular": {
        "pdf": lambda x: math.sqrt(1.0 - (x * x)),
        "center": 0,
    },
    "wald": {
        "pdf": wald_pdf,
        "center": 1.0,
    },
    "weibull_max": {
        "pdf": weibull_max_pdf,
        "check_pinv_params": lambda a: 0.25 <= a <= 512,
        "center": -1.0,
    },
    "weibull_min": {
        "pdf": weibull_min_pdf,
        "check_pinv_params": lambda a: 0.25 <= a <= 512,
        "center": 1.0,
    },
}


def _validate_qmc_input(qmc_engine, d, seed):
    # Input validation for `qmc_engine` and `d`
    # Error messages for invalid `d` are raised by QMCEngine
    # we could probably use a stats.qmc.check_qrandom_state
    if isinstance(qmc_engine, QMCEngine):
        if d is not None and qmc_engine.d != d:
            message = "`d` must be consistent with dimension of `qmc_engine`."
            raise ValueError(message)
        d = qmc_engine.d if d is None else d
    elif qmc_engine is None:
        d = 1 if d is None else d
        qmc_engine = Halton(d, seed=seed)
    else:
        message = (
            "`qmc_engine` must be an instance of "
            "`scipy.stats.qmc.QMCEngine` or `None`."
        )
        raise ValueError(message)

    return qmc_engine, d


class CustomDistPINV:
    def __init__(self, pdf, args):
        self._pdf = lambda x: pdf(x, *args)

    def pdf(self, x):
        return self._pdf(x)


class FastGeneratorInversion:
    """
    Fast sampling by numerical inversion of the CDF for a large class of
    continuous distributions in `scipy.stats`.

    Parameters
    ----------
    dist : rv_frozen object
        Frozen distribution object from `scipy.stats`. The list of supported
        distributions can be found in the Notes section. The shape parameters,
        `loc` and `scale` used to create the distributions must be scalars.
        For example, for the Gamma distribution with shape parameter `p`,
        `p` has to be a float, and for the beta distribution with shape
        parameters (a, b), both a and b have to be floats.
    domain : tuple of floats, optional
        If one wishes to sample from a truncated/conditional distribution,
        the domain has to be specified.
        The default is None. In that case, the random variates are not
        truncated, and the domain is inferred from the support of the
        distribution.
    ignore_shape_range : boolean, optional.
        If False, shape parameters that are outside of the valid range
        of values to ensure that the numerical accuracy (see Notes) is
        high, raise a ValueError. If True, any shape parameters that are valid
        for the distribution are accepted. This can be useful for testing.
        The default is False.
    random_state : {None, int, `numpy.random.Generator`,
                        `numpy.random.RandomState`}, optional

            A NumPy random number generator or seed for the underlying NumPy
            random number generator used to generate the stream of uniform
            random numbers.
            If `random_state` is None, it uses ``self.random_state``.
            If `random_state` is an int,
            ``np.random.default_rng(random_state)`` is used.
            If `random_state` is already a ``Generator`` or ``RandomState``
            instance then that instance is used.

    Attributes
    ----------
    loc : float
        The location parameter.
    random_state : {`numpy.random.Generator`, `numpy.random.RandomState`}
        The random state used in relevant methods like `rvs` (unless
        another `random_state` is passed as an argument to these methods).
    scale : float
        The scale parameter.

    Methods
    -------
    cdf
    evaluate_error
    ppf
    qrvs
    rvs
    support

    Notes
    -----
    The class creates an object for continuous distributions specified
    by `dist`. The method `rvs` uses a generator from
    `scipy.stats.sampling` that is created when the object is instantiated.
    In addition, the methods `qrvs` and `ppf` are added.
    `qrvs` generate samples based on quasi-random numbers from
    `scipy.stats.qmc`. `ppf` is the PPF based on the
    numerical inversion method in [1]_ (`NumericalInversePolynomial`) that is
    used to generate random variates.

    Supported distributions (`distname`) are:
    ``alpha``, ``anglit``, ``argus``, ``beta``, ``betaprime``, ``bradford``,
    ``burr``, ``burr12``, ``cauchy``, ``chi``, ``chi2``, ``cosine``,
    ``crystalball``, ``expon``, ``gamma``, ``gennorm``, ``geninvgauss``,
    ``gumbel_l``, ``gumbel_r``, ``hypsecant``, ``invgamma``, ``invgauss``,
    ``invweibull``, ``laplace``, ``logistic``, ``maxwell``, ``moyal``,
    ``norm``, ``pareto``, ``powerlaw``, ``t``, ``rayleigh``, ``semicircular``,
    ``wald``, ``weibull_max``, ``weibull_min``.

    `rvs` relies on the accuracy of the numerical inversion. If very extreme
    shape parameters are used, the numerical inversion might not work. However,
    for all implemented distributions, the admissible shape parameters have
    been tested, and an error will be raised if the user supplies values
    outside of the allowed range. The u-error should not exceed 1e-10 for all
    valid parameters. Note that warnings might be raised even if parameters
    are within the valid range when the object is instantiated.
    To check numerical accuracy, the method `evaluate_error` can be used.

    Note that all implemented distributions are also part of `scipy.stats`, and
    the object created by `FastGeneratorInversion` relies on methods like
    `ppf`, `cdf` and `pdf` from `rv_frozen`. The main benefit of using this
    class can be summarized as follows: Once the generator to sample random
    variates is created in the setup step, sampling and evaluation of
    the PPF using `ppf` are very fast,
    and performance is essentially independent of the distribution. Therefore,
    a substantial speed-up can be achieved for many distributions if large
    numbers of random variates are required. It is important to know that this
    fast sampling is achieved by inversion of the CDF. Thus, one uniform
    random variate is transformed into a non-uniform variate, which is an
    advantage for several simulation methods, e.g., when
    the variance reduction methods of common random variates or
    antithetic variates are be used ([2]_).

    In addition, inversion makes it possible to
    - to use a QMC generator from `scipy.stats.qmc` (method `qrvs`),
    - to generate random variates truncated to an interval. For example, if
    one aims to sample standard normal random variates from
    the interval (2, 4), this can be easily achieved by using the parameter
    `domain`.

    The location and scale that are initially defined by `dist`
    can be reset without having to rerun the setup
    step to create the generator that is used for sampling. The relation
    of the distribution `Y` with `loc` and `scale` to the standard
    distribution `X` (i.e., ``loc=0`` and ``scale=1``) is given by
    ``Y = loc + scale * X``.

    References
    ----------
    .. [1] Derflinger, Gerhard, Wolfgang Hörmann, and Josef Leydold.
           "Random variate  generation by numerical inversion when only the
           density is known." ACM Transactions on Modeling and Computer
           Simulation (TOMACS) 20.4 (2010): 1-25.
    .. [2] Hörmann, Wolfgang, Josef Leydold and Gerhard Derflinger.
           "Automatic nonuniform random number generation."
           Springer, 2004.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats
    >>> from scipy.stats.sampling import FastGeneratorInversion

    Let's start with a simple example to illustrate the main features:

    >>> gamma_frozen = stats.gamma(1.5)
    >>> gamma_dist = FastGeneratorInversion(gamma_frozen)
    >>> r = gamma_dist.rvs(size=1000)

    The mean should be approximately equal to the shape parameter 1.5:

    >>> r.mean()
    1.52423591130436  # may vary

    Similarly, we can draw a sample based on quasi-random numbers:

    >>> r = gamma_dist.qrvs(size=1000)
    >>> r.mean()
    1.4996639255942914  # may vary

    Compare the PPF against approximation `ppf`.

    >>> q = [0.001, 0.2, 0.5, 0.8, 0.999]
    >>> np.max(np.abs(gamma_frozen.ppf(q) - gamma_dist.ppf(q)))
    4.313394796895409e-08

    To confirm that the numerical inversion is accurate, we evaluate the
    approximation error (u-error), which should be below 1e-10 (for more
    details, refer to the documentation of `evaluate_error`):

    >>> gamma_dist.evaluate_error()
    (7.446320551265581e-11, nan)  # may vary

    Note that the location and scale can be changed without instantiating a
    new generator:

    >>> gamma_dist.loc = 2
    >>> gamma_dist.scale = 3
    >>> r = gamma_dist.rvs(size=1000)

    The mean should be approximately 2 + 3*1.5 = 6.5.

    >>> r.mean()
    6.399549295242894  # may vary

    Let us also illustrate how truncation can be applied:

    >>> trunc_norm = FastGeneratorInversion(stats.norm(), domain=(3, 4))
    >>> r = trunc_norm.rvs(size=1000)
    >>> 3 < r.min() < r.max() < 4
    True

    Check the mean:

    >>> r.mean()
    3.250433367078603  # may vary

    >>> stats.norm.expect(lb=3, ub=4, conditional=True)
    3.260454285589997

    In this particular, case, `scipy.stats.truncnorm` could also be used to
    generate truncated normal random variates.

    """

    def __init__(
        self,
        dist,
        *,
        domain=None,
        ignore_shape_range=False,
        random_state=None,
    ):

        if isinstance(dist, stats.distributions.rv_frozen):
            distname = dist.dist.name
            if distname not in PINV_CONFIG.keys():
                raise ValueError(
                    f"Distribution '{distname}' is not supported."
                    f"It must be one of {list(PINV_CONFIG.keys())}"
                    )
        else:
            raise ValueError("`dist` must be a frozen distribution object")

        loc = dist.kwds.get("loc", 0)
        scale = dist.kwds.get("scale", 1)
        args = dist.args
        if not np.isscalar(loc):
            raise ValueError("loc must be scalar.")
        if not np.isscalar(scale):
            raise ValueError("scale must be scalar.")

        self._frozendist = getattr(stats, distname)(
            *args,
            loc=loc,
            scale=scale,
        )
        self._distname = distname

        nargs = np.broadcast_arrays(args)[0].size
        nargs_expected = self._frozendist.dist.numargs
        if nargs != nargs_expected:
            raise ValueError(
                f"Each of the {nargs_expected} shape parameters must be a "
                f"scalar, but {nargs} values are provided."
            )

        self.random_state = random_state

        if domain is None:
            self._domain = self._frozendist.support()
            self._p_lower = 0.0
            self._p_domain = 1.0
        else:
            self._domain = domain
            self._p_lower = self._frozendist.cdf(self._domain[0])
            _p_domain = self._frozendist.cdf(self._domain[1]) - self._p_lower
            self._p_domain = _p_domain
        self._set_domain_adj()
        self._ignore_shape_range = ignore_shape_range

        # the domain to be passed to NumericalInversePolynomial
        # define a separate variable since in case of a transformation,
        # domain_pinv will not be the same as self._domain
        self._domain_pinv = self._domain

        # get information about the distribution from the config to set up
        # the generator
        dist = self._process_config(distname, args)

        if self._rvs_transform_inv is not None:
            d0 = self._rvs_transform_inv(self._domain[0], *args)
            d1 = self._rvs_transform_inv(self._domain[1], *args)
            if d0 > d1:
                # swap values if transformation if decreasing
                d0, d1 = d1, d0
            # only update _domain_pinv and not _domain
            # _domain refers to the original distribution, _domain_pinv
            # to the transformed distribution
            self._domain_pinv = d0, d1

        # self._center has been set by the call self._process_config
        # check if self._center is inside the transformed domain
        # _domain_pinv, otherwise move it to the endpoint that is closer
        if self._center is not None:
            if self._center < self._domain_pinv[0]:
                self._center = self._domain_pinv[0]
            elif self._center > self._domain_pinv[1]:
                self._center = self._domain_pinv[1]

        self._rng = NumericalInversePolynomial(
            dist,
            random_state=self.random_state,
            domain=self._domain_pinv,
            center=self._center,
            )

    @property
    def random_state(self):
        return self._random_state

    @random_state.setter
    def random_state(self, random_state):
        self._random_state = check_random_state_qmc(random_state)

    @property
    def loc(self):
        return self._frozendist.kwds.get("loc", 0)

    @loc.setter
    def loc(self, loc):
        if not np.isscalar(loc):
            raise ValueError("loc must be scalar.")
        self._frozendist.kwds["loc"] = loc
        # update the adjusted domain that depends on loc and scale
        self._set_domain_adj()

    @property
    def scale(self):
        return self._frozendist.kwds.get("scale", 0)

    @scale.setter
    def scale(self, scale):
        if not np.isscalar(scale):
            raise ValueError("scale must be scalar.")
        self._frozendist.kwds["scale"] = scale
        # update the adjusted domain that depends on loc and scale
        self._set_domain_adj()

    def _set_domain_adj(self):
        """ Adjust the domain based on loc and scale. """
        loc = self.loc
        scale = self.scale
        lb = self._domain[0] * scale + loc
        ub = self._domain[1] * scale + loc
        self._domain_adj = (lb, ub)

    def _process_config(self, distname, args):
        cfg = PINV_CONFIG[distname]
        if "check_pinv_params" in cfg:
            if not self._ignore_shape_range:
                if not cfg["check_pinv_params"](*args):
                    msg = ("No generator is defined for the shape parameters "
                           f"{args}. Use ignore_shape_range to proceed "
                           "with the selected values.")
                    raise ValueError(msg)

        if "center" in cfg.keys():
            if not np.isscalar(cfg["center"]):
                self._center = cfg["center"](*args)
            else:
                self._center = cfg["center"]
        else:
            self._center = None
        self._rvs_transform = cfg.get("rvs_transform", None)
        self._rvs_transform_inv = cfg.get("rvs_transform_inv", None)
        _mirror_uniform = cfg.get("mirror_uniform", None)
        if _mirror_uniform is None:
            self._mirror_uniform = False
        else:
            self._mirror_uniform = _mirror_uniform(*args)

        return CustomDistPINV(cfg["pdf"], args)

    def rvs(self, size=None):
        """
        Sample from the distribution by inversion.

        Parameters
        ----------
        size : int or tuple, optional
            The shape of samples. Default is ``None`` in which case a scalar
            sample is returned.

        Returns
        -------
        rvs : array_like
            A NumPy array of random variates.

        Notes
        -----
        Random variates are generated by numerical inversion of the CDF, i.e.,
        `ppf` computed by `NumericalInversePolynomial` when the class
        is instantiated. Note that the
        default ``rvs`` method of the rv_continuous class is
        overwritten. Hence, a different stream of random numbers is generated
        even if the same seed is used.
        """
        # note: we cannot use self._rng.rvs directly in case
        # self._mirror_uniform is true
        u = self.random_state.uniform(size=size)
        if self._mirror_uniform:
            u = 1 - u
        r = self._rng.ppf(u)
        if self._rvs_transform is not None:
            r = self._rvs_transform(r, *self._frozendist.args)
        return self.loc + self.scale * r

    def ppf(self, q):
        """
        Very fast PPF (inverse CDF) of the distribution which
        is a very close approximation of the exact PPF values.

        Parameters
        ----------
        u : array_like
            Array with probabilities.

        Returns
        -------
        ppf : array_like
            Quantiles corresponding to the values in `u`.

        Notes
        -----
        The evaluation of the PPF is very fast but it may have a large
        relative error in the far tails. The numerical precision of the PPF
        is controlled by the u-error, that is,
        ``max |u - CDF(PPF(u))|`` where the max is taken over points in
        the interval [0,1], see `evaluate_error`.

        Note that this PPF is designed to generate random samples.
        """
        q = np.asarray(q)
        if self._mirror_uniform:
            x = self._rng.ppf(1 - q)
        else:
            x = self._rng.ppf(q)
        if self._rvs_transform is not None:
            x = self._rvs_transform(x, *self._frozendist.args)
        return self.scale * x + self.loc

    def qrvs(self, size=None, d=None, qmc_engine=None):
        """
        Quasi-random variates of the given distribution.

        The `qmc_engine` is used to draw uniform quasi-random variates, and
        these are converted to quasi-random variates of the given distribution
        using inverse transform sampling.

        Parameters
        ----------
        size : int, tuple of ints, or None; optional
            Defines shape of random variates array. Default is ``None``.
        d : int or None, optional
            Defines dimension of uniform quasi-random variates to be
            transformed. Default is ``None``.
        qmc_engine : scipy.stats.qmc.QMCEngine(d=1), optional
            Defines the object to use for drawing
            quasi-random variates. Default is ``None``, which uses
            `scipy.stats.qmc.Halton(1)`.

        Returns
        -------
        rvs : ndarray or scalar
            Quasi-random variates. See Notes for shape information.

        Notes
        -----
        The shape of the output array depends on `size`, `d`, and `qmc_engine`.
        The intent is for the interface to be natural, but the detailed rules
        to achieve this are complicated.

        - If `qmc_engine` is ``None``, a `scipy.stats.qmc.Halton` instance is
          created with dimension `d`. If `d` is not provided, ``d=1``.
        - If `qmc_engine` is not ``None`` and `d` is ``None``, `d` is
          determined from the dimension of the `qmc_engine`.
        - If `qmc_engine` is not ``None`` and `d` is not ``None`` but the
          dimensions are inconsistent, a ``ValueError`` is raised.
        - After `d` is determined according to the rules above, the output
          shape is ``tuple_shape + d_shape``, where:

              - ``tuple_shape = tuple()`` if `size` is ``None``,
              - ``tuple_shape = (size,)`` if `size` is an ``int``,
              - ``tuple_shape = size`` if `size` is a sequence,
              - ``d_shape = tuple()`` if `d` is ``None`` or `d` is 1, and
              - ``d_shape = (d,)`` if `d` is greater than 1.

        The elements of the returned array are part of a low-discrepancy
        sequence. If `d` is 1, this means that none of the samples are truly
        independent. If `d` > 1, each slice ``rvs[..., i]`` will be of a
        quasi-independent sequence; see `scipy.stats.qmc.QMCEngine` for
        details. Note that when `d` > 1, the samples returned are still those
        of the provided univariate distribution, not a multivariate
        generalization of that distribution.

        """
        qmc_engine, d = _validate_qmc_input(qmc_engine, d, self.random_state)
        # mainly copied from unuran_wrapper.pyx.templ
        # `rvs` is flexible about whether `size` is an int or tuple, so this
        # should be, too.
        try:
            if size is None:
                tuple_size = (1,)
            else:
                tuple_size = tuple(size)
        except TypeError:
            tuple_size = (size,)
        # we do not use rng.qrvs directly since we need to be
        # able to apply the ppf to 1 - u
        N = 1 if size is None else np.prod(size)
        u = qmc_engine.random(N)
        if self._mirror_uniform:
            u = 1 - u
        qrvs = self._ppf(u)
        if self._rvs_transform is not None:
            qrvs = self._rvs_transform(qrvs, *self._frozendist.args)
        if size is None:
            qrvs = qrvs.squeeze()[()]
        else:
            if d == 1:
                qrvs = qrvs.reshape(tuple_size)
            else:
                qrvs = qrvs.reshape(tuple_size + (d,))
        return self.loc + self.scale * qrvs

    def evaluate_error(self, size=100000, random_state=None, x_error=False):
        """
        Evaluate the numerical accuracy of the inversion (u- and x-error).

        Parameters
        ----------
        size : int, optional
            The number of random points over which the error is estimated.
            Default is ``100000``.
        random_state : {None, int, `numpy.random.Generator`,
                        `numpy.random.RandomState`}, optional

            A NumPy random number generator or seed for the underlying NumPy
            random number generator used to generate the stream of uniform
            random numbers.
            If `random_state` is None, use ``self.random_state``.
            If `random_state` is an int,
            ``np.random.default_rng(random_state)`` is used.
            If `random_state` is already a ``Generator`` or ``RandomState``
            instance then that instance is used.

        Returns
        -------
        u_error, x_error : tuple of floats
            A NumPy array of random variates.

        Notes
        -----
        The numerical precision of the inverse CDF `ppf` is controlled by
        the u-error. It is computed as follows:
        ``max |u - CDF(PPF(u))|`` where the max is taken `size` random
        points in the interval [0,1]. `random_state` determines the random
        sample. Note that if `ppf` was exact, the u-error would be zero.

        The x-error measures the direct distance between the exact PPF
        and `ppf`. If ``x_error`` is set to ``True`, it is
        computed as the maximum of the minimum of the relative and absolute
        x-error:
        ``max(min(x_error_abs[i], x_error_rel[i]))`` where
        ``x_error_abs[i] = |PPF(u[i]) - PPF_fast(u[i])|``,
        ``x_error_rel[i] = max |(PPF(u[i]) - PPF_fast(u[i])) / PPF(u[i])|``.
        Note that it is important to consider the relative x-error in the case
        that ``PPF(u)`` is close to zero or very large.

        By default, only the u-error is evaluated and the x-error is set to
        ``np.nan``. Note that the evaluation of the x-error will be very slow
        if the implementation of the PPF is slow.

        Further information about these error measures can be found in [1]_.

        References
        ----------
        .. [1] Derflinger, Gerhard, Wolfgang Hörmann, and Josef Leydold.
               "Random variate  generation by numerical inversion when only the
               density is known." ACM Transactions on Modeling and Computer
               Simulation (TOMACS) 20.4 (2010): 1-25.

        Examples
        --------

        >>> import numpy as np
        >>> from scipy import stats
        >>> from scipy.stats.sampling import FastGeneratorInversion

        Create an object for the normal distribution:

        >>> d_norm_frozen = stats.norm()
        >>> d_norm = FastGeneratorInversion(d_norm_frozen)

        To confirm that the numerical inversion is accurate, we evaluate the
        approximation error (u-error and x-error).

        >>> u_error, x_error = d_norm.evaluate_error(x_error=True)

        The u-error should be below 1e-10:

        >>> u_error
        8.785783212061915e-11  # may vary

        Compare the PPF against approximation `ppf`:

        >>> q = [0.001, 0.2, 0.4, 0.6, 0.8, 0.999]
        >>> diff = np.abs(d_norm_frozen.ppf(q) - d_norm.ppf(q))
        >>> x_error_abs = np.max(diff)
        >>> x_error_abs
        1.2937954707581412e-08

        This is the absolute x-error evaluated at the points q. The relative
        error is given by

        >>> x_error_rel = np.max(diff / np.abs(d_norm_frozen.ppf(q)))
        >>> x_error_rel
        4.186725600453555e-09

        The x_error computed above is derived in a very similar way over a
        much larger set of random values q. At each value q[i], the minimum
        of the relative and absolute error is taken. The final value is then
        derived as the maximum of these values. In our example, we get the
        following value:

        >>> x_error
        4.507068014335139e-07  # may vary

        """
        if not isinstance(size, numbers.Integral | np.integer):
            raise ValueError("size must be an integer.")
        # urng will be used to draw the samples for testing the error
        # it must not interfere with self.random_state. therefore, do not
        # call self.rvs, but draw uniform random numbers and apply
        # self.ppf (note: like in rvs, consider self._mirror_uniform)
        urng = check_random_state_qmc(random_state)
        u = urng.uniform(size=size)
        if self._mirror_uniform:
            u = 1 - u
        x = self.ppf(u)
        uerr = np.max(np.abs(self._cdf(x) - u))
        if not x_error:
            return uerr, np.nan
        ppf_u = self._ppf(u)
        x_error_abs = np.abs(self.ppf(u)-ppf_u)
        x_error_rel = x_error_abs / np.abs(ppf_u)
        x_error_combined = np.array([x_error_abs, x_error_rel]).min(axis=0)
        return uerr, np.max(x_error_combined)

    def support(self):
        """Support of the distribution.

        Returns
        -------
        a, b : float
            end-points of the distribution's support.

        Notes
        -----

        Note that the support of the distribution depends on `loc`,
        `scale` and `domain`.

        Examples
        --------

        >>> from scipy import stats
        >>> from scipy.stats.sampling import FastGeneratorInversion

        Define a truncated normal distribution:

        >>> d_norm = FastGeneratorInversion(stats.norm(), domain=(0, 1))
        >>> d_norm.support()
        (0, 1)

        Shift the distribution:

        >>> d_norm.loc = 2.5
        >>> d_norm.support()
        (2.5, 3.5)

        """
        return self._domain_adj

    def _cdf(self, x):
        """Cumulative distribution function (CDF)

        Parameters
        ----------
        x : array_like
            The values where the CDF is evaluated

        Returns
        -------
        y : ndarray
            CDF evaluated at x

        """
        y = self._frozendist.cdf(x)
        if self._p_domain == 1.0:
            return y
        return np.clip((y - self._p_lower) / self._p_domain, 0, 1)

    def _ppf(self, q):
        """Percent point function (inverse of `cdf`)

        Parameters
        ----------
        q : array_like
            lower tail probability

        Returns
        -------
        x : array_like
            quantile corresponding to the lower tail probability q.

        """
        if self._p_domain == 1.0:
            return self._frozendist.ppf(q)
        x = self._frozendist.ppf(self._p_domain * np.array(q) + self._p_lower)
        return np.clip(x, self._domain_adj[0], self._domain_adj[1])


class RatioUniforms:
    """
    Generate random samples from a probability density function using the
    ratio-of-uniforms method.

    Parameters
    ----------
    pdf : callable
        A function with signature `pdf(x)` that is proportional to the
        probability density function of the distribution.
    umax : float
        The upper bound of the bounding rectangle in the u-direction.
    vmin : float
        The lower bound of the bounding rectangle in the v-direction.
    vmax : float
        The upper bound of the bounding rectangle in the v-direction.
    c : float, optional.
        Shift parameter of ratio-of-uniforms method, see Notes. Default is 0.
    random_state : {None, int, `numpy.random.Generator`,
                    `numpy.random.RandomState`}, optional

        If `seed` is None (or `np.random`), the `numpy.random.RandomState`
        singleton is used.
        If `seed` is an int, a new ``RandomState`` instance is used,
        seeded with `seed`.
        If `seed` is already a ``Generator`` or ``RandomState`` instance then
        that instance is used.

    Methods
    -------
    rvs

    Notes
    -----
    Given a univariate probability density function `pdf` and a constant `c`,
    define the set ``A = {(u, v) : 0 < u <= sqrt(pdf(v/u + c))}``.
    If ``(U, V)`` is a random vector uniformly distributed over ``A``,
    then ``V/U + c`` follows a distribution according to `pdf`.

    The above result (see [1]_, [2]_) can be used to sample random variables
    using only the PDF, i.e. no inversion of the CDF is required. Typical
    choices of `c` are zero or the mode of `pdf`. The set ``A`` is a subset of
    the rectangle ``R = [0, umax] x [vmin, vmax]`` where

    - ``umax = sup sqrt(pdf(x))``
    - ``vmin = inf (x - c) sqrt(pdf(x))``
    - ``vmax = sup (x - c) sqrt(pdf(x))``

    In particular, these values are finite if `pdf` is bounded and
    ``x**2 * pdf(x)`` is bounded (i.e. subquadratic tails).
    One can generate ``(U, V)`` uniformly on ``R`` and return
    ``V/U + c`` if ``(U, V)`` are also in ``A`` which can be directly
    verified.

    The algorithm is not changed if one replaces `pdf` by k * `pdf` for any
    constant k > 0. Thus, it is often convenient to work with a function
    that is proportional to the probability density function by dropping
    unnecessary normalization factors.

    Intuitively, the method works well if ``A`` fills up most of the
    enclosing rectangle such that the probability is high that ``(U, V)``
    lies in ``A`` whenever it lies in ``R`` as the number of required
    iterations becomes too large otherwise. To be more precise, note that
    the expected number of iterations to draw ``(U, V)`` uniformly
    distributed on ``R`` such that ``(U, V)`` is also in ``A`` is given by
    the ratio ``area(R) / area(A) = 2 * umax * (vmax - vmin) / area(pdf)``,
    where `area(pdf)` is the integral of `pdf` (which is equal to one if the
    probability density function is used but can take on other values if a
    function proportional to the density is used). The equality holds since
    the area of ``A`` is equal to ``0.5 * area(pdf)`` (Theorem 7.1 in [1]_).
    If the sampling fails to generate a single random variate after 50000
    iterations (i.e. not a single draw is in ``A``), an exception is raised.

    If the bounding rectangle is not correctly specified (i.e. if it does not
    contain ``A``), the algorithm samples from a distribution different from
    the one given by `pdf`. It is therefore recommended to perform a
    test such as `~scipy.stats.kstest` as a check.

    References
    ----------
    .. [1] L. Devroye, "Non-Uniform Random Variate Generation",
       Springer-Verlag, 1986.

    .. [2] W. Hoermann and J. Leydold, "Generating generalized inverse Gaussian
       random variates", Statistics and Computing, 24(4), p. 547--557, 2014.

    .. [3] A.J. Kinderman and J.F. Monahan, "Computer Generation of Random
       Variables Using the Ratio of Uniform Deviates",
       ACM Transactions on Mathematical Software, 3(3), p. 257--260, 1977.

    Examples
    --------
    >>> import numpy as np
    >>> from scipy import stats

    >>> from scipy.stats.sampling import RatioUniforms
    >>> rng = np.random.default_rng()

    Simulate normally distributed random variables. It is easy to compute the
    bounding rectangle explicitly in that case. For simplicity, we drop the
    normalization factor of the density.

    >>> f = lambda x: np.exp(-x**2 / 2)
    >>> v = np.sqrt(f(np.sqrt(2))) * np.sqrt(2)
    >>> umax = np.sqrt(f(0))
    >>> gen = RatioUniforms(f, umax=umax, vmin=-v, vmax=v, random_state=rng)
    >>> r = gen.rvs(size=2500)

    The K-S test confirms that the random variates are indeed normally
    distributed (normality is not rejected at 5% significance level):

    >>> stats.kstest(r, 'norm')[1]
    0.250634764150542

    The exponential distribution provides another example where the bounding
    rectangle can be determined explicitly.

    >>> gen = RatioUniforms(lambda x: np.exp(-x), umax=1, vmin=0,
    ...                     vmax=2*np.exp(-1), random_state=rng)
    >>> r = gen.rvs(1000)
    >>> stats.kstest(r, 'expon')[1]
    0.21121052054580314

    """
    
    def __init__(self, pdf, *, umax, vmin, vmax, c=0, random_state=None):
        if vmin >= vmax:
            raise ValueError("vmin must be smaller than vmax.")

        if umax <= 0:
            raise ValueError("umax must be positive.")
        
        self._pdf = pdf
        self._umax = umax
        self._vmin = vmin
        self._vmax = vmax
        self._c = c
        self._rng = check_random_state(random_state)

    def rvs(self, size=1):
        """Sampling of random variates

        Parameters
        ----------
        size : int or tuple of ints, optional
            Number of random variates to be generated (default is 1).

        Returns
        -------
        rvs : ndarray
            The random variates distributed according to the probability
            distribution defined by the pdf.

        """
        size1d = tuple(np.atleast_1d(size))
        N = np.prod(size1d)  # number of rvs needed, reshape upon return

        # start sampling using ratio of uniforms method
        x = np.zeros(N)
        simulated, i = 0, 1

        # loop until N rvs have been generated: expected runtime is finite.
        # to avoid infinite loop, raise exception if not a single rv has been
        # generated after 50000 tries. even if the expected number of iterations
        # is 1000, the probability of this event is (1-1/1000)**50000
        # which is of order 10e-22
        while simulated < N:
            k = N - simulated
            # simulate uniform rvs on [0, umax] and [vmin, vmax]
            u1 = self._umax * self._rng.uniform(size=k)
            v1 = self._rng.uniform(self._vmin, self._vmax, size=k)
            # apply rejection method
            rvs = v1 / u1 + self._c
            accept = (u1**2 <= self._pdf(rvs))
            num_accept = np.sum(accept)
            if num_accept > 0:
                x[simulated:(simulated + num_accept)] = rvs[accept]
                simulated += num_accept

            if (simulated == 0) and (i*N >= 50000):
                msg = (
                    f"Not a single random variate could be generated in {i*N} "
                    "attempts. The ratio of uniforms method does not appear "
                    "to work for the provided parameters. Please check the "
                    "pdf and the bounds."
                )
                raise RuntimeError(msg)
            i += 1

        return np.reshape(x, size1d)
